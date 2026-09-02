# The GFFL — the family fantasy football league

`league.html` + `assets/league/lg-{core,data,ui}.js` + `netlify/functions/league.mjs`,
plus `sports.html` / `netlify/functions/sports.mjs` (NFL scores) and `ffdraft.html`
(the live draft board). Lives at goatfantasyleague.com, an alias of the same Netlify site.

This is the most active surface in the repo. Read it before touching any of those files —
several of its entries are corrections to earlier entries in the same file, and the money
paths (waivers, FAAB, trades) have documented races behind them.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

---

# 🏈 SPORTS — NFL scores page + live game detail (2026-08-05, branch claude/fantasy-nfl-sports-integration-9uc6z1, PR #21)

Stage 1+2 of `sports-plan.md` (the plan of record — fantasy + home cards are later stages).
Files: `sports.html` · `netlify/functions/sports.mjs` · `tools/_sports_fixtures.cjs` ·
`tools/_verify-sports.cjs` (**96/96**, 0 page errors) · `tools/_probe-sports.mjs`.

**THE FUNCTION** (stocks.mjs pattern, zero deps, no new env vars): actions `nfl_scoreboard
{week,seasontype,year}` and `nfl_game {eventId}` proxy ESPN's unofficial site API
(site.api.espn.com — free, keyless) and SLIM aggressively (raw scoreboard ~1MB → a few KB;
the suite pins slim < raw/2). Odds/pickcenter/news are never mapped (family app). Every read
is optional-chained; upstream failure = `{ok:false, reason}` at HTTP 200 → honest cards, never
a blank page. `SPORTS_NFL_BASE_URL` points tests at a fake server. **The live `situation` is
DERIVED server-side from the current drive's last play `end`** — the summary endpoint carries
no reliable top-level situation; `end.yardsToEndzone` is the field visual's anchor.

**THE PAGE**: week list (games grouped by Chicago day, LIVE NOW pinned first, away team
listed first, possession ◂, loser dimmed on finals, kickoff+TV on upcoming) with a week
picker driven by the response's flattened season `calendar`; hash-routed game detail
(`sports.html#game=<id>`) with score header + linescore, the SVG FIELD (end zones in team
colors, drive band from `startYardsToEndzone`, gold first-down line, LOS + ball marker,
direction arrow), last-play callout, this-drive plays NEWEST FIRST, previous drives, win-prob
sparkline (server thins the series to ≤80 pts), team stat bars matched by stat `name`, player
box-score tables in `.panner`s, scoring plays. **FIELD MATH** (unit-tested through the DOM):
field coord 0..100 from the LEFT (away) goal line; away possession → `pos = 100 − yTE`
(drives →), home possession → `pos = yTE` (drives ←); first down = pos ± distance;
`x = 83.33 + pos·8.3334` on the 1000-wide viewBox. POLLING: 15s live game / 25s live week /
2min pregame detail / 5min quiet week; document.hidden clears the timer and visibilitychange
refreshes immediately (both asserted). localStorage `bucky_nfl_sb` caches the default week for
instant paint; a failed refresh keeps the stale copy + shows a note. `window.__SPORTS__` hook.

**NAV: 13 AREAS NOW** — `sports` (🏈, `url:"sports.html"`, the gpt-style url area) inserted
after News in index.html's NAV_GROUPS + NAV_PATHS AND the 5 mirrored navs (farmgpt, games,
weather, activity, status) + sports.html's own. Two-row phone bar balances 7+6 for Dad
(ceil(13/2)); measured 0 clipped at 390px. RESTAGED for the 13th area: `_verify-activity.cjs`
links 12→13, navRows(=columns) 6→7, rail 12→13; `_verify-beacon-safety.cjs` PAGES gained
sports.html (`data-feature="sports"` beacon on the page). chore-care needed NO restage (its
counts are per-gated-user and float).

**FANTASY (stage 3, same day)**: `ff_league` / `ff_scoreboard` / `ff_matchup` proxy the
fantasy v3 API (lm-api-reads.fantasy.espn.com) for the family's PRIVATE league — **league
705063, team "Battle Kreussers", both baked as defaults** (env overrides ESPN_LEAGUE_ID /
ESPN_TEAM_NAME / ESPN_SEASON). Private = cookies: **ESPN_S2 + ESPN_SWID env vars** (from a
logged-in espn.com browser's cookies; SWID braces added server-side if missing; espn_s2
expires ~yearly). Cookies are read AT CALL TIME (env update + redeploy = fixed, no code
change), sent upstream only, never echoed. Missing → `fantasy-not-configured`; ESPN 401/403
→ `fantasy-auth-expired` — the page renders a Dad-facing setup/fix card for each, and the
suite pins both. `ffSeason()`: Jan/Feb belong to the PREVIOUS league year. `ff_matchup`
returns both lineups (slot-sorted via SLOT_ORDER, actual + projected from the player stats
array: statSourceId 0=actual 1=projection at the scoringPeriodId) AND joins each player's
REAL NFL game state by fetching the site scoreboard — **fantasy proTeamId and the site
API's team ids are the same id space** (PRO_ABBREV map in sports.mjs; the probe cross-checks
it against the live scoreboard's own id↔abbrev pairs). Page: 🏆 Fantasy pill / `#fantasy`
hash → family matchup pinned with side-by-side lineups (live dots, muted "proj N" until a
player's game starts, injury letter), Around-the-league matchups, standings from a ~1h-cached
`ff_league` (localStorage `bucky_ff_league`). Poll 60s during NFL game windows (ESPN's own
fantasy scoring lags ~30-60s — faster buys nothing), 15min otherwise.

**⚠ NOT LIVE-VERIFIED**: ESPN hosts are egress-blocked from this sandbox, so
`_sports_fixtures.cjs` is authored from documented shapes, not captured. POST-DEPLOY:
`node tools/_probe-sports.mjs --site https://amenfarms.netlify.app` from a normal machine —
it checks every field the app reads incl. the fantasy league + pro-team map (run once during
a LIVE game for the situation/drive fields) and flags drift. The slimmer is defensive, so
drift = missing sections, not crashes. Suite now **138/138**.

**🚨 THE UA GOTCHA (2026-08-05, found live — the site shipped broken for ~20 min)**:
site.api.espn.com's Akamai edge **403s datacenter requests with a BROWSER User-Agent but
answers `curl/*` with 200** — the EXACT INVERSE of the Yahoo/stocks.mjs lesson this function
originally copied. Measured twice from GitHub runners: browser UA / empty / "node" /
"bucky-family-app" all 403, default curl 200 both times. `NFL_UA = "curl/8.6.0"` in
sports.mjs (suite-pinned); the fantasy host (lm-api-reads) is FINE with the browser UA and
keeps it — don't unify. DIAGNOSIS PATTERN when the sandbox can't reach a host:
`.github/workflows/sports-diag.yml` (hand-dispatched) curls ESPN + the live function from a
GitHub runner and prints bodies — that's how both the 403 and the fix were proven (the live
fix confirmed the same way: function returns ok:true with real events post-deploy).

**TEST GOTCHAS (new)**: (1) seeding `choreUser="Dad"` makes index.html AUTO-PROMPT for the
Dad PIN on load — a native `prompt()` wedges headless Chrome silently (no error, no render);
stub `window.prompt/alert/confirm` in every init script (chore-care already knew this — copy
its harness, don't re-derive it). (2) A blanket "abort everything non-localhost" interception
also kills `data:` URLs and wedges index.html's boot — abort only external http(s) +
firebase-ish hosts. (3) In THIS cloud env suites' `channel:"chrome"` needs
`mkdir -p /opt/google/chrome && ln -sf /opt/pw-browsers/chromium-1194/chrome-linux/chrome
/opt/google/chrome/chrome` once per container; `_verify-sports.cjs` itself falls back to
`/opt/pw-browsers/chromium` (or `BUCKY_CHROME`) automatically.

**HOME CARDS (stage 4, same day)**: `nflcard` + `ffcard` in renderDashboard, slotted right
after the weather card (wxcard discipline: instant localStorage paint from `bucky_nfl_home`/
`bucky_ff_home`, quiet refresh when stale — 60s during live windows via `sportsHomeAnyLive()`,
10 min otherwise — repaint only if still on dashboard). NFL card: up to 3 live games
(away @ home scores, possession ◂, red clock, situation line on the featured game only),
else next kickoffs, else last finals; "+N more this week ›" footer; tap → sports.html.
Fantasy card: the family matchup (trailing side dimmed), proj line + "N starters yet to
play"; tap → sports.html#fantasy. **BOTH CARDS START `hidden` AND STAY HIDDEN when there is
nothing to show** — off-season/empty scoreboard, fantasy not configured, a failed fetch with
no cache, or another suite's blanket `{}` function mock (all five states asserted; the
`.home2 .nflcard` `display:block` rule outweighs the UA's `[hidden]` rule, so a
`[hidden]{display:none}` restatement is REQUIRED). All card text renders via textContent
(API text is external data). Suite section G; **156/156** total.

**STAGE 5 — FANTASY SCOREBOARD + MATCHUP DETAIL · PER-USER TEAMS · COLLEGE FOOTBALL
(2026-08-05)**: three user asks in one batch.
- **Fantasy is a SCOREBOARD now** (`#fantasy`): every matchup in the 8-team league as a
  tappable row (`.gbtn[data-ffteam]`, away side on top like the NFL rows), the family's
  pinned under "Your matchup", the rest under "Around the league", standings (all 8) below.
  Tapping opens **`#ffm=<teamId>`** — the matchup LINEUP detail (the old paintFf body moved
  to `paintFfm`/`#ffmView`; server `ff_matchup` already took `teamId`, so ANY matchup opens).
  The `ff` view loads only `ff_scoreboard` (+cached `ff_league`); `ffm` loads `ff_matchup`.
  Gate cards (not-configured/expired) factored into `ffGateHTML()` shared by both views.
- **PER-USER TEAMS**: `FF_TEAM_BY_USER` = { isaac: "The Goat Kids", grandpa: "Wyoming
  Cowboys" }, default Battle Kreussers — matched by `choreUser`, lowercased. DUPLICATED in
  three places, keep in sync: sports.html `myFfTeamName()`, index.html `sportsHomeFfTeam()`
  (the home ffcard passes `teamName` and treats a cached copy for ANOTHER team as stale via
  the cache's `team` field), and the server resolves `body.teamName` (exact → includes →
  env-default fallback; "End Zone Goats" vs "The Goat Kids" is the near-name trap the exact
  pass exists for). Server-side `ffWantedName`/`ffFamilyTeamId` in sports.mjs.
- **COLLEGE (`#college`, 🎓 pill)**: same shared week-list machinery — `siteScoreboard/
  siteGame` were already league-parameterized, so `ncaa_scoreboard`/`ncaa_game` are the same
  code on `college-football`. **The upstream default is the FULL FBS slate (measured live
  2026-08-05), NOT a Top-25 cut** — "Top 25" is the CLIENT's filter on `curatedRank`
  (slimmed to `team.rank`, 1-25 else null; rendered as `#N` badges). **PRESEASON has NO
  ranks at all** (live 2026-08-05: 99 events, 0 ranked) — Top 25 falls back to the full
  slate with a friendly note instead of an empty tab, and re-engages once rankings publish
  (suite fakes it via `upstream.cfbUnranked`). Conference dropdown
  (`#cfbGroup`, persisted `bucky_cfb_group`, default top25): real ESPN `groups=` ids —
  80 all-FBS · 8 SEC · 5 B1G · 4 B12 · 1 ACC · 9 Pac-12 · 151 AAC · 17 MWC · 37 Sun Belt ·
  15 MAC · 12 CUSA · 18 Indep. College games deep-link **`#cgame=<id>`** ("cgame" contains
  "game", so the router matches cgame FIRST); the game view is sport-aware via `gameSport`
  (back button reads "‹ College"). College has its own week picker (`flatWeeksOf`/
  `weekIndexOf`/`stepWeekOf` — the old NFL-only fns parameterized) + stale-note/error card.
- **RACE FIXED (`cfbReload` latch)**: changing the filter while a fetch is in flight used to
  no-op on the `cfbLoading` guard and paint the STALE in-flight group; now the latch re-runs
  `loadCfb` with the latest group when the in-flight one lands (suite polls the URL rather
  than reading `lastUrl` once).
- **BUG FIXED — `.pills[hidden]`**: `.pills { display:flex }` beat the UA `[hidden]` rule, so
  the "hidden" top pills stayed painted on every game detail since stage 1 (same class as
  the `.nflcard` note above — THIRD time this class of bug has bitten; any styled container
  toggled via the `hidden` attribute needs a `[hidden]{display:none}` restatement, and
  suites must assert GEOMETRY (`offsetParent === null`), not the attribute).
- One delegated document click handler routes all score rows (`data-eid`+`data-sport` →
  game/cgame, `data-ffteam` → ffm) — per-paint handlers are gone.
- Fixtures: the real "Nerd Fantasy Football League" shape (8 teams incl. the two per-user
  ones + the near-name trap), 4 live + 4 decided matchups, small rosters on the extra live
  ones; college slate (ranked live/pre + unranked pre/final, SEC filter on groups=8) + a
  college summary. Suite **212/212** (+A college/rank/groups checks, +E per-user resolution,
  F rewritten for scoreboard→detail incl. Isaac/Grandpa contexts, +H the college view,
  +G Isaac's home card). Probe extended (ncaa actions, ff_scoreboard, both per-user names
  must resolve). chore-care 50/50 regression green.

**STAGE 6 — SPREADS · RECORDS · MY-STARTERS BADGES · FANTASY WIN% + POLISH (2026-08-05)**:
- Game rows (NFL + college): team RECORD beside the name (`.trec`, data was already
  slimmed); the BETTING LINE on upcoming rows (new `spread` field — scoreboard from
  `comp.odds[0].details`, game detail from `pickcenter[0].details`, DISPLAY STRING ONLY,
  provider/prices asserted never to leak; pregame detail card gains a "Spread:" line);
  and **🏆 N of yours** — how many of MY fantasy starters play in each NFL game
  (`loadMyFfCounts()` fires once at boot via ff_matchup w/ the per-user teamName, builds
  a proTeam→count map, repaints the week; NFL-ONLY by `sport` gate — college MIA/etc.
  abbrevs collide with pro ones). Live rows append the badge to the situation line;
  pre rows get spread+badge on their own `.situ` line; finals badge-only.
- Fantasy scoreboard: **estimated win% beside each score** (`ffWinPct` — normal model on
  projected finals, σ=30, Φ≈logistic 1.702x; OUR estimate, not ESPN's; decided matchups
  skip it). Matchup rows got air (`.ffvs` padding 10px + divider between stacked rows —
  the wpct span carries `margin-left:auto` so rows WITHOUT one keep the old score
  alignment). Standings: usernames REMOVED (team name only) and the W-L wrap fixed
  (`table.stand th,td { white-space:nowrap }` + the name column takes `width:100%;
  max-width:0; ellipsis` so nowrap can't blow the table wide).
- Suite **227/227** (spread string-only leak checks, records/spread/badge row checks incl.
  live-vs-pre placement, win% hand-computed 31%/69%, separation + nowrap + no-owner).

**TAB HEADERS UNIFIED (2026-08-05, user: "AI and Sports … have a green header with a back
button, they should have the same header as every other tab")**: sports.html + farmgpt.html
headers re-styled to index.html's app header — cream `--bg`, 1px `--line` bottom border,
"Bucky" Fraunces-green wordmark + "Family Farm Hub" subtitle on one baseline (the wordmark
IS the link home, keeping the `#backLink` id so nothing else moved), the page/view name as
a QUIET right-aligned muted label (`#bar .t`; farmgpt's `#barTitle` still swaps per view and
the 🧹 Clear button restyled as a light chip). Desktop (≥1024px): wordmark hidden (the rail
carries it) and `.t` becomes the ink crumb — index's exact pattern. farmgpt's green came
from its `farmstead-theme-page` OVERRIDE block (appended last, wins) — that had to be
emptied, not just the head rule. **SPECIFICITY GOTCHA**: the head rule `#bar a#backLink`
(2 ids) beats the desktop media block's old `#backLink { display:none }` (1 id) — media
queries don't add specificity; the hider had to become `#bar a#backLink` too. games.html +
weather.html deliberately untouched (not direct nav tabs; user scoped the ask). Suites:
sports 227/227 · storyledger 683/683.

**⚡ FIRESTORE PERSISTENT CACHE (2026-08-05, user: "when I go between the sports page or AI
page and any other page it makes me reconnect to Bucky")**: Sports + AI are the only two
bottom-nav tabs that are REAL PAGES, so hopping to one and back fully reloads index.html —
and `makeCloudBackend` used `getFirestore()` (memory cache), so every return re-downloaded
the whole chores collection over the network behind "Connecting…" + empty content: the
"reconnect". FIX: `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager:
persistentMultipleTabManager() }) })` — a reload paints the family's data instantly from
IndexedDB, the server snapshot follows quietly. try/catch falls back to `getFirestore()`
(the exact old behavior). Status honesty: a `fromCache` snapshot sets a quiet "Syncing…"
(never "live" over unconfirmed data, never "Connecting…" over real data); the server
snapshot flips to live (which tucks). SAFE BY PRIOR HARDENING: seeding + `serverConfirmed`
(→ allowance mint, importHerd) already gate on `!snap.metadata.fromCache` — the 2026-07
herd-duplication lessons are exactly why cache-first snapshots can't corrupt anything.
CHECKED: push-client.js uses a NAMED app ("bucky-push") and the photo-email uploader is
Storage-only, so nothing calls `getFirestore` on the default app before `initializeFirestore`
(which would failed-precondition it into the fallback). The cloud path can't be exercised
headless (house rule: Firebase blocked), so post-deploy: open the app, bounce to Sports and
back — content should be there instantly with a brief "Syncing…" instead of "Connecting…".
chore-care 50/50 · sports 227/227.
**🚨 THE STUCK-ON-SYNCING BUG (same day, user report, live for ~1 deploy)**: the listener
MUST pass **`{ includeMetadataChanges: true }`**. Without it, when the server confirms the
cached data UNCHANGED (the overwhelmingly common case), that confirmation is a metadata-only
change (fromCache true→false) and **no snapshot event fires at all** — the status sticks on
"Syncing…" forever AND `serverConfirmed` never flips, silently blocking the allowance mint
and importHerd. Invisible pre-cache because the first snapshot always came from the server.
Cost: one extra (ack) event per local write — one render, already-guarded seeding. RULE:
any Firestore listener whose logic branches on `snap.metadata.fromCache` needs the flag.

**🖼 SPORTS + AI ARE REAL IN-APP TABS NOW — persistent iframes (2026-08-05, user: "still
stuck on syncing 10-15s sometimes, is there a way to get sports and AI in the app the same
way as the other tabs")**: NAV_GROUPS' sports/gpt areas lost their `url:` and became
pseudo-tabs (`members:["sports"]/["farmgpt"]`, in DEEP_LINK_TABS → `#sports`/`#farmgpt`
deep links). `renderEmbedTab` hosts each page in a PERSISTENT same-origin iframe
(`ensureEmbed` creates on first visit, then only hides/shows) — index.html never reloads on
tab hops, and the framed page's own state (open game, chat mid-stream) survives leaving.
- **Frame geometry is MEASURED, not assumed**: `.embedwrap` is fixed between the sticky
  header and #bnav via `--embed-top/--embed-bottom` set by `sizeEmbeds()` + a
  ResizeObserver on the header (the status line tucking changes its height 4s in);
  desktop `left: var(--sidenav-w)`, bnav 0. `body.embed-open { overflow:hidden }`.
- **Framed pages self-detect** (`window.self !== window.top` in an inline script BEFORE
  first paint or the standalone chrome flashes) → `.embedded` on <html>: sports hides its
  whole header+navs; farmgpt hides wordmark+navs but KEEPS its bar as a slim toolbar (the
  view title + 🧹 Clear live there).
- **A hidden iframe's document NEVER reports hidden** (visibilityState follows the TOP
  page, not CSS display) — so index sets `w.__buckyEmbedVisible` + dispatches
  "bucky-embed-visibility" on the frame's window: sports pauses/resumes its polling
  (schedule() also guards on the flag), and assets/activity.js's dwell accrue() returns 0
  while covered (else Dad's dashboard counts covered time as reading). The flag dies with
  the window on a frame reload — syncEmbedTabs re-reconciles it on every render.
- Home cards route in-app: `openSportsAt(hash)` (existing frame = set contentWindow hash,
  drives the framed router without a reload); the ask bar's `openFarmgptWith("?ask=…")`
  reloads only the FRAME so farmgpt's ?ask boot path runs (sessionStorage photo handoff is
  shared with a same-origin frame). Satellite pages' nav entries for sports/AI now point at
  `index.html#sports`/`#farmgpt`.
- **Syncing quieted**: `setStatus` gained kind "quiet" (tucks like live); a fromCache
  snapshot over real data shows a tucking "Syncing…" instead of hanging over the header
  (the 10-15s wait is the Firestore watch stream confirming — content is already painted).
- Pre-existing fix spotted on a plate: index's desktop `.crumb` was still `color:#fff`
  (navy-header era) — invisible on the cream header since the re-skin. Now `var(--ink)`.
- **SUITE HARNESS**: embedding farmgpt means index.html contexts now need the CDN stubs
  (marked/DOMPurify/renderMathInElement) or the frame's top-level script dies (storyledger
  lesson); `evaluateOnNewDocument` + request interception both apply to same-origin frames.
- Suites: sports **234/234** (embed create/hide/show-without-reload, pause/resume, exact
  header↔nav geometry, embedded-chrome checks both pages, desktop rail geometry, home-card
  routing) · chore-care 50 · activity 147 · beacon-safety 96 · news 200 · fitness 253 ·
  storyledger 683. Shots: sports_embed_390 / ai_embed_390 / sports_embed_desktop.

**DEFERRED** (per plan): status.html registry rows for ESPN (free NFL row + a
cookie-configured fantasy row surfacing `fantasy-auth-expired` on the ops page).

**FANTASY AI BATCH (2026-08-06)**: Grok 4.5 advice + the weekly columnist + the lineup guard;
Mom follows **"Nails for Breakfast"** (FF_TEAM_BY_USER in sports.html + sportsHomeFfTeam in
index.html — keep in sync). SERVER (farmgpt.mjs, not sports.mjs — that's where the model
plumbing lives): modes `fantasy` (FANTASY_SYSTEM: lineup checks name the exact bench
replacement, waivers pick 2-4 with drops, ONLY the data in the payload, ≤300 words, maxTokens
1400) + `ffrecap` (FFRECAP_SYSTEM "The Nerd Report": 200-300 words, EVERY matchup covered,
roast TEAMS never people). Both on **Grok 4.5 (XAI_MODEL)** → RESEARCH_MODEL Sonnet at both
the no-key degrade AND the mid-request outage fallback (the story pattern). League data rides
in NAMED BODY FIELDS (`matchup`/`freeAgents`/`matchups`/`standings`) and the user turn is
built SERVER-SIDE (`buildFantasyMessages`/`buildRecapMessages`) — the ledger lesson:
MAX_CONTENT_CHARS would slice JSON stuffed into messages[]. Kinds lineup/waivers/question
(question capped 400; unknown → question). **THE RECAP GENERATES ONCE PER FINISHED WEEK,
family-wide**: the handler checks `farmgpt_ffrecap/<season>_w<week>` BEFORE building messages
(hit → JSON `{ok:true,cached:true,text}`, no model call); the first device streams the
generation and the stream's finally{} saves the doc (`captureReply` gained ffrecap);
buildRecapMessages 400s unless EVERY matchup is decided. Usage bucket **"w"** (+ per-model
`w_grok45_*`), 🏈 "Fantasy AI" row in farmgpt.html's dashboard. sports.mjs: `ff_freeagents` —
kona_player_info view filtered through the **X-Fantasy-Filter HEADER** (FREEAGENT+WAIVERS,
sortPercOwned desc, limit 75 → slimmed to 50: {name,pos,proTeam,injury,pctOwned,proj,
seasonProj}); `ffFetch` gained an extraHeaders arg. CLIENT (sports.html fantasy tab):
**guard card** (`ffLineupWarnings`: a STARTER whose game is still `pre` and who is on bye /
OUT / IR / suspended / Doubtful (🚫) / Questionable (🟡) — once his game starts, no nagging)
leads the page; **🧠 Fantasy AI card** (🩺 lineup / 🔎 waivers / free-text ask → streams
mode-fantasy into `.aians`; lineup skips the FA fetch, waivers/question load `ff_freeagents`
cached 30 min; `ffFmt` = tiny **bold**+bullet formatter, no markdown lib); **📰 Nerd Report**
collapsed `<details class="recapcard">` (client picks the finished week = current-if-all-
decided else week-1-verified-decided, caches localStorage `bucky_ffrecap`); paintFf preserves
the typed `#ffAiQ` across the 60s repaint. index.html home ffcard gets `.ffwarnline` (same
guard rules — keep in sync). VERIFY: `node tools/_verify-ffai.cjs` (32: wire/degrade/
fallback/recap-cache-no-second-call/w-bucket really incremented — SNAPSHOT the fake-Firestore
fields before comparing, the increments mutate in place) + sports suite now **262** (fake ff
upstream serves ffFreeAgentsDoc on view=kona_player_info + records the filter header; fake
farmgpt route mock answers canned advice/column and counts calls NODE-side — the mock answers
instantly, so "the second ask happened" must be waited for node-side, not on the DOM; fixture
team 7 renamed Nails for Breakfast/NAIL). Regressions: storyledger 683 · kidstory 54 · dnd 47.
TEST GOTCHA (new): background repaints replace #ffBody nodes — a coordinate `page.click` right
after `hasFf` can land on a stale spot; wait for the guard card (ffMyM landed) and dispatch
`el.click()` in-page. Diag workflow gained live ff_freeagents + ONE real Grok fantasy smoke
(never trigger live ffrecap from CI — it would WRITE a junk preseason column the family reads).
**LIVE-VERIFIED 2026-08-06** (diag runs 31059976938/31060131978): real ff_freeagents = 50
players through the real X-Fantasy-Filter (top: Jahmyr Gibbs 99.9% owned — PRE-DRAFT, everyone
is a free agent, that's correct); real Grok answered the fantasy smoke ("**Yes — start Josh
Allen.**"). AND THE LIVE RUN CAUGHT A REAL BUG: the league's team is literally **"Nails  For
Breakfast" — a DOUBLE SPACE** — so the exact-match resolver silently fell back to Battle
Kreussers for Mom. Fix: `ffNorm` in sports.mjs collapses whitespace runs before matching
(client config keeps the natural single-space spelling); the fixture now carries the
double-space name verbatim so the suite (263) proves the normalization against the shape that
actually broke. Real league ids: Goat Kids 12 · Wyoming Cowboys 3 · Nails For Breakfast 5.

---

# 🏈 THE GFFL — league.html playtest batch 2 (2026-08-08, UNCOMMITTED)

`league.html` (+ `assets/league/lg-{core,data,ui}.js`) is the family's fantasy-LEAGUE app —
distinct from `sports.html`'s NFL-scores/ESPN-fantasy-viewer above and from `ffdraft.html`'s
standalone live keeper-draft board (its own page, its own broadcast-dark theme, untouched by
this batch except as a design reference). Ten user-reported playtest items, all landed in one
pass, `node --check` clean, **533/533 green** (519 baseline + 14 new). No commits made, no push
(house rule — league.html/lg-*.js auto-deploy on push to main; awaiting user preview).

1. **Free agents = a real browsable table**, not just search. `D.searchFA(q, ownedKeys, {limit,
   pos})` gained an empty-query BROWSE mode (top-N by Sleeper `search_rank`) + a position
   filter; Moves' Waivers card gained `.poschips` (ALL/QB/RB/WR/TE/K/DST) feeding a
   `table.tbl.faTable` (name+team / `.posbadge` + injury / weekly PROJ / ADD-or-CLAIM button),
   paginated 40-at-a-time via "Show more ↓". Tapping any row opens the same claim sheet a
   search hit does.
2. **Scores tab reads like an ESPN scoreboard**: day-grouped `.sccard` cards (network, live/
   Final/kickoff state, both scores, betting line when ESPN has one, a new "MINE: N players ·
   OPP: N players" line — how many of the viewer's OWN current-matchup starters, and how many
   of their opponent's, play in that specific real NFL game). `.scgrid` goes 2-column at
   `≥1024px`.
3. **Matchup page is a strict mirrored 3-column grid** now: my player LEFT / slot badge CENTER
   / opponent RIGHT, EVERY slot renders for both sides (an empty slot shows "Empty", not a gap,
   so both columns stay row-aligned), a fixed-width points column, a TOTAL row, and the bench
   section in the same paired layout — `pairByIndex`/`halfCell`/`totalHalfCell` in lg-ui.js.
4. **Chat GIF search audited against the real Tenor v2 API** (fixture rewritten to mirror
   Tenor's documented response shape exactly — id/media_formats/tags/`next` cursor) — no server
   bug was found (`lg_gif_search` in league.mjs was already correct); hardened the test fixture
   instead and added a friendly inline retry state ("GIF search hiccuped — try again") instead
   of silent failure on a transient hit.
5. **Bigger chat composer**: `<textarea>` (1↔~5 rows, auto-grows via `autoGrowChatText`), Enter
   sends / Shift+Enter newlines, ≥44px touch target — both the main chat and the matchup-page
   "trash talk" thread composer.
6. **Active-tab underline, off-center** — root cause: the desktop `.bnav` had ASYMMETRIC padding
   (`0 16px 0 0`), so the border-bottom (spanning the button's full border-box) sat centered on
   a box whose content — and therefore its centered label — wasn't itself centered in that box.
   Fixed to symmetric `0 12px`; the underline is provably centered under the label at ANY label
   width without measuring text at all. Verified via a `Range`-measured text-node center vs the
   button's own box center, two different-width labels, both mobile and desktop.
7. **Rules tab restructured like ESPN's settings page** — `RULE_LABELS` (one flat map, every
   `DEFAULT_RULES` key → a plain-English fragment) + `SCORING_GROUPS` (Passing/Rushing/
   Receiving/Kicking/Defense-Special-Teams/Misc) + a `PA_BRACKETS` points-allowed mini-table
   (never hidden). View mode hides zero-valued scoring keys (noise) and renders Roster/Waivers/
   Trades/Keepers/Playoffs/Schedule as derived plain sentences; edit mode shows EVERY key
   (including zero-valued ones) with the same friendly label, same `data-k` attributes the save
   path already reads. Suite proves no raw key (`bonus_pass_300`, `dst_pa_0`, …) is ever visible
   in view mode, and spot-checks a handful of exact plain-English lines both modes.
8. **A Draft tab** — a plain `<a class="bnavlink" href="ffdraft.html">` styled identically to
   the button tabs (shared `.bnav button, .bnav .bnavlink` selector), living in the SAME bar on
   both mobile and desktop (fits at 390px with 0 clipped labels and every target still ≥44px —
   chose "same bar" over a league-home card since it fit cleanly and keeps Draft one tap from
   anywhere, matching how the other 7 tabs behave). Never carries `.on` — it navigates away, it's
   never "the current view."
9. **Retheme to `ffdraft.html`'s aesthetic** (done LAST, per the brief). ffdraft's own look:
   a cold near-black navy (`#0c1017`, not true black) broadcast-dark theme — cards a shade
   lighter (`#151b26`) on a cool blue-grey border/line color, Barlow Condensed for all display
   type (headings/scores/tabs — both apps already shared this font), Inter for body copy, a hot
   saturated red accent (`#d50a0a`), a deep NFL navy (`#013369`) used for "selected" chip fills,
   and a warm gold (`#ffb612`) for standout moments; position-colored badges
   (`--pos-QB/RB/WR/TE/K/DST/X`, lifted straight from ffdraft's draft-board cell palette). The
   retheme is a **pure token-value swap** — every existing CSS custom-property NAME in
   league.html (`--bg`/`--card`/`--accent`/`--nested`/etc.) is untouched, only the hex VALUES
   assigned to them moved, so every component rule below still just reads `var(--whatever)`.
   New pieces added while doing the pass (previously-unstyled gaps this batch's own new markup
   had left, plus one pre-existing dead selector): `.posbadge[data-pos]` per-position colors,
   `.poschip`/`.poschips` (ffdraft's own outlined-pill/filled-navy-when-`.on` chip language),
   `.rzdot` (a small pulsing CSS dot — the red-zone indicator that used to be a 🔴 emoji before
   item 10) and `.conflictflag` ("sources disagree" — used to be ⚠), `.scgrid`/`.sccard`/etc.
   for item 2's new Scores markup (had never been styled at all before this batch — was
   rendering as unstyled block divs), a 3px accent top-border on `<header>` (ffdraft's own
   broadcast signature), and a dead `.rv input.redit` selector fixed to plain `input.redit`
   (`.rv` never existed in any markup — the rule had never once applied). Verified clean via a
   Node script scanning the `<style>` block (comments excluded) for every old Gridiron hex
   literal (`#131315`/`#0C0D0E`/`#1B1C1F`/`#D0454C`/etc.) — zero hits outside the batch's own
   explanatory comment.
10. **Zero emoji anywhere in app chrome.** Every nav label, view title, card heading, button,
    chip, toast, sys-chat post (waiver/trade/rules-changed/champion/Toilet-Bowl announcements),
    award name (Top Score/Bust of the Week/Bench Blunder), importer button, bracket/champion
    banner, and empty state across `league.html` + `lg-ui.js` + `lg-core.js`'s `postSys()`
    templates had its emoji stripped and replaced with plain text or a CSS affordance (the
    red-zone dot and "sources disagree" flag above are the two cases where an emoji was doing
    real visual work). Exempt by spec: user-typed chat content and family-chosen team names —
    theirs, not the app's. New standing regression guard: **section U** in
    `tools/_verify-gffl.cjs` renders all 8 real views (league/matchup/moves/chat/rules-view/
    rules-EDIT/locker×2/scores/bracket-unbuilt/bracket-built) against populated fixtures (incl.
    a real processed waiver claim so a genuine sys-post + tx-log sentence are on screen, not
    just empty-state copy) and scans the DOM for any `\p{Extended_Pictographic}` codepoint.
    Scoped to be robust rather than merely fixture-clean: it clones `<body>`, removes the
    handful of containers that hold literal free-typed user content (`.chatText2`/`.chatQuote`/
    `.lockermotto`/the poster's own identity name/every `input`/`textarea`/`option`), then
    strips every CURRENT team name at the TEXT level (not by selector — team names recur in
    dozens of hard-to-enumerate places: mucard, teamrow, `.lockername`, standings, bracket
    rows, rivalries, and the sys-post/tx-log sentences that splice one into an app sentence) —
    so a future family naming their team with an emoji, or typing one in chat, can never
    false-positive this suite, while sys posts/tx-log sentences/banners/award names stay fully
    IN SCOPE (per spec they must be clean; they only read clean here because their app-authored
    template text was hand-verified emoji-free and the fixture's own team names are plain
    ASCII).

Two real, pre-existing CSS gaps were found and fixed along the way (not asked for, but the
retheme pass touched every rule in the file so they surfaced): item 2's `.scgrid`/`.sccard`/
etc. markup had NO CSS at all until this batch (rendered as unstyled block `<div>`s — the
desktop "2-column card grid" requirement literally could not have passed without adding the
grid rule), and `.rv input.redit` (item 7's numeric rule-edit inputs) had been scoped under a
`.rv` ancestor class that never existed anywhere in the markup, so it had never applied since
the day it was written.

VERIFY: `node tools/_verify-gffl.cjs [--shots]` — 533/533, 0 page errors. Shots:
`shots/gffl_theme_league_390.png` / `gffl_theme_bracket_390.png` (new this batch) plus every
pre-existing `shots/gffl_*.png` plate, all now rendering in the retheme'd look (moves/FA table,
rules view+edit, matchup, desktop league home + top-nav).

## 🛡 GFFL — the adversarial-review fix batch (2026-08-08, UNCOMMITTED)

An adversarial Opus review plus a full-season simulation confirmed **14 findings across 8 root
causes** in `league.html` + `assets/league/lg-{core,data,ui}.js`. All eight are fixed, each with
a regression test built from that finding's own reproduction steps. `netlify/functions/league.mjs`
was NOT touched (finding 11's fix is client-side). Suite: **_verify-gffl.cjs 533 → 603**.
**Pre-fix verification is not a claim: the three app files were stashed to `HEAD` and the whole
suite re-run — 44 checks fail against the old code, 0 against the new.** The pre-fix run's own
output is the evidence quoted below.

### 1 · The week the engine is holding is now a FACT, not an assumption (findings 1/3/7)
`finalizeWeek(week)` used `week` for the ROSTER lookup only and multiplied it by whatever the
live engine happened to be polling — the engine has no week dimension at all (`/scoreboard` bare,
Sleeper's stats bucket from its own `state.week`). It then wrote a **write-once** doc that
standings, waiver priority, power rankings, playoff seeding, the record book and the champion all
derive from forever. The "is every game final?" guard read the SAME current-week board, so it
passed exactly when the board held a different week's finals.
**Measured pre-fix, from the suite's own repro**: week-3 rosters, an engine on week 4 →
`finalizeWeek(3)` returned `ok:true` with `homePts:1, awayPts:28` (week 4's numbers, the opposite
result), and `loadStandings()` charged team 1 a loss it had actually won. Permanently.
- `D.S.espnWeek` / `D.S.slpWeek` are recorded from `/scoreboard`'s own `week.number` and Sleeper's
  `state.week`; **`D.engineWeek()`** returns null when unknown OR when the two DISAGREE — a
  disagreement means the rows in memory are a mix of two weeks, which is a refusal, not a guess.
- Gates, in order: `bracket-unresolved` (below) → `stale-week` / `no-live-data` → `not-final`.
  **`opts.force` does not bypass the week gate** — force only ever meant "some games aren't final",
  never "score it from a different week".
- **The missed week is refused LOUDLY, then settled CORRECTLY.** `D.weekStats(week)` reads
  Sleeper's archived `/stats/nfl/<type>/<season>/<week>`, which still holds any completed week's
  real lines; `finalizeWeek(w, {backfill:true})` scores from that map (`ptsOf` is threaded through
  `fzTeamTotal`/`fzOptimalTotal`/`fzAwards`/accuracy) and stamps `source:"archived"` on the doc.
  Bust of the Week is SKIPPED on a backfill — it grades against a pre-game projection and the
  engine only ever holds the current week's, so there is no honest one to grade against.
- The league home states it plainly ("Live scoring has already moved on…") with a per-week
  commissioner button; the Finalize button offers the same fallback when it hits `stale-week`.
- **`maybeAutoFinalizeWeeks` now includes the CURRENT week** (`w <= cw`, was `w < cw`). That
  exclusion is what made the bug the DEFAULT path: the engine rolls over on the same Tuesday
  `currentWeek()` does, so "a past week" and "the week the engine is holding" were almost never
  the same week. With provenance enforced, the correct moment is Monday night of week N itself.
- **`pollScoreboard` REBUILDS `D.S.games`** instead of only `.set()`ing into it (finding 1's
  widening note — a tab open across the rollover kept last week's `post` entries forever, so the
  finality guard passed for any past week, in any week, byes included). Red-zone state carries
  across by eventId so it doesn't flicker.

### 2 · The read-modify-write class is gone structurally (findings 2/4/5/12)
`LG.db.get` cached by `docCache.has(id)` — **true for a cached null** — with no TTL and no
invalidation, so the first read of a not-yet-existing doc froze "it doesn't exist" for the page's
whole life. Writers then rebuilt shared arrays from that frozen base, and both backends replace an
array field wholesale (local `JSON.stringify`; Firestore `setDoc merge:true`).
**Measured pre-fix**: another owner's $40 waiver bid was DELETED from storage by this page
submitting a $5 bid, which then WON the player; and a stale tab's lineup tap reverted a processed
waiver (the won player gone, the dropped player back) with the FAAB still spent and the tx log
still narrating the move.
- **ONE DOC PER CLAIM** — `claim_<season>_w<week>_<claimId>`, kind `claim`. There is no shared
  array to rebuild, so two devices writing at the same instant write two different documents and
  neither can destroy the other. The weekly `claims_*` doc survives as the PROCESSING RECORD
  only. A claim's own id is stored as **`claimId`**, never `id` — list() rows are `{...doc, id}`,
  so a field literally called `id` is clobbered by the doc-id (finding 10 from the other side).
  Legacy array-shaped weeks are merged on read and can still be cancelled, so nothing in flight
  on deploy day is lost.
- **A null is NEVER cached.** Absence is DERIVED from a cached `list()` of that doc's own kind
  (`kindOf`/`knownAbsent`), which carries its own 15s cloud background refresh — so "this doc
  doesn't exist" self-heals on the same cadence as everything else instead of never. Positive
  docs got that background refresh too (`docAt`). **Tab-switch speed is unchanged**: `renderLeague`
  lists weekly/bracket up front and `loadWeekRosters` lists `roster` once, so a warm view still
  makes ZERO backend reads (section P1 still asserts exactly that).
- **Every read that precedes a write is FRESH**: `loadRoster`/`ensureRoster` gained `{fresh:true}`
  and it is taken by `processWaivers`, `executeTrade` (whose "roster-changed → cancel" fail-safe
  was reading the very cache it exists to detect), `faAdd`, and the locker's lineup tap — which
  now re-reads and carries only the SLOT ASSIGNMENTS across by player key, so a tap changes only
  what it meant to change. Also fresh: every trade status transition, `toggleReaction`,
  `deleteChat`, and `processWaivers`' first read of the claim set.
- `LG.saveTeam` merges onto a fresh read and strips the stray `id`; the hot callers now write
  DELTAS (`{teamId, faab}`) instead of spreading a whole in-memory team.

### 3 · The playoff bracket can no longer be stranded (findings 6/8)
`gamesForWeek` omits an unresolved pairing and the weekly doc is write-once, so finalizing a
semifinal week before the play-in had been advanced **permanently deleted that semifinal** and no
champion could ever be crowned. **Measured pre-fix**: week 16 written with 2 games (the #1 seed's
semi absent), week 17 with 0, `champion: null` — and a cold catch-up over the whole postseason
ended the same way.
- `maybeAutoFinalizeWeeks` advances the bracket **immediately after each playoff week finalizes,
  inside the loop** (it used to interleave only between whole passes).
- `finalizeWeek` REFUSES a playoff week with any unresolved pairing, **force included** — a
  write-once doc a game short is a game lost forever.
- The commissioner's archived-stats path advances between weeks the same way.
- Regression: the season sim (V5b) plays the postseason on the ordinary cadence and asserts every
  bracket game is on the record and a champion is crowned; V5c does the same from a cold
  catch-up where nothing can auto-finalize at all.

### 4 · The Sleeper bucket can never lock onto week 1 (finding 9)
`cands = [wk, wk+1, "1"]` rotated to the first candidate that returned anything, and week 1's
bucket is the one bucket that is ALWAYS full — so between the Tuesday rollover and the week's
first kickoff (all of Tue/Wed/Thu, every week) it locked onto week 1's completed lines and served
them as live scoring for the life of the tab. **Measured pre-fix**: with week 11 empty, the bucket
locked on `"1"` and P. Passer's live line read week 1's 150 pass yds.
`cands` is now EXACTLY the authoritative week, or **empty** when Sleeper never said one — no week
is polled at all rather than the wrong one, which reads honestly as a degraded source (health
flips to espn-only). Projections follow the same single candidate, so stats and projections can no
longer come from different weeks.

### 5 · `list()` no longer lets a doc's own `id` clobber its doc-id (finding 10)
Both implementations built rows as `{id, ...doc}`. `cacheUpsert` had this exact fix already, with
a comment explaining the hazard — the two functions that FEED it did not, so it survived one layer
down. **Measured pre-fix**: a cold list returned a row keyed by the numeric team id, the next save
pushed a duplicate, and `LG.teams` held 2 rows for team 1. Now `{...doc, id}` in both.
**Honest scope, as the finding itself notes**: a doc that already carries the stray field keeps it
— both backends merge, so a write cannot delete a field. It is now inert (the doc-id is attached
last and nothing reads `.id` off a `get()`), and no new stray is ever minted.

### 6 · The ESPN import REPLACES scoring (finding 11)
`Object.assign(next.scoring, j.scoring)` left every key the real league doesn't configure at its
GFFL default. The family league scores field goals ONLY by made YARDS (statId 214 at 0.1/yd,
reconciled to the penny against a real season) and carries no conventional FG-made ids at all, so
`fg_0_39/40_49/50` survived at 3/4/5 alongside the imported 0.1/yd and `D.score()` paid BOTH.
**Measured pre-fix**: an ordinary kicker day (25/45/52-yd FGs + 2 XP) scored **26.2** where the
league's real value is **14.2** — every kicker, every week, straight into the write-once doc.
Scoring is now built from a zeroed union of the current + default keys, then the import's own
values laid over it, and the preview says so out loud (every key dropping to 0 is already listed
in `diffRules`' change list).

### 7 · Every tracked game gets refreshed (finding 13)
`[...wanted.keys()].slice(0, 8)` over a Map rebuilt from a Set with frozen insertion order fetched
the SAME eight games forever; everything past the eighth was never fetched again, silently, since
health only counts fetches that FAILED, not fetches never attempted. **Measured pre-fix**: 8 of 14
games covered, 6 never fetched. A rotating cursor (`D.S.sumCursor`) keeps the cap at 8 per cycle
and guarantees full coverage within `ceil(n/8)` cycles.

### 8 · A game that hasn't kicked off scores nothing (finding 14)
`deriveEspnDst` read the header score, which is `"0"` pre-game → `dst_pa 0` → `dst_pa_0` → **a free
5-point shutout for every starting D/ST, all week**; and the completion handler struck ANY non-live
game off the fetch list, so a game polled while `pre` consumed its one "read the final box" token
and its real final was never read. **Measured pre-fix**: `dst_SF` read 5.0 before kickoff and was
STILL 5.0 after the game went final. Now the DST derivation is gated on the summary's own header
state, and only a genuinely `post` game consumes the token.

**Suite**: `node tools/_verify-gffl.cjs` — **603/603, 0 page errors**. New section **V** (70
checks) is one block per finding, each built from that finding's own repro. New fixture knobs
(all default OFF, so sections A-U see exactly the fixture they always did): `espnWeekNum`,
`sleeperWeek`, `emptyWeekBucket`, `noFgBuckets`, `bigSlate`, `pregame`. `slpStatsFix(week)` is
week-aware now — the pre-fix suite could not tell week N from week N+1 by construction, which is
precisely why 533/533 green gave no protection against the batch's three critical findings.
**Restaged, each with its reason in the file, never bent**: I1/I5 (a claim is its own doc now);
O4 (must state its own engine week — the fixture says week 1 and it finalizes week 15); P2 (the
"LG.db caches nulls too" narration is exactly the mechanism that was removed — the point it makes
is unchanged, since a list-derived absence is still a snapshot and that is why the five
idempotency guards use `getFresh`).
**KNOWN / DEFERRED**: an existing league's already-poisoned team docs keep their inert stray `id`
(a merging write cannot delete a field — a migration would need a delete-and-rewrite); the
archived-stats backfill grades no Bust of the Week; and `staleFinalizeWeeks` stays silent while
the engine's week is unknown, so a cold boot never flashes a false alarm.

## 🏈 GFFL — screenshot polish pass + boot speed (2026-08-08, UNCOMMITTED)

Two jobs against the same three files (`league.html`, `assets/league/lg-{core,data,ui}.js`
untouched, suite `tools/_verify-gffl.cjs` — 603 → **605/605, 0 page errors**).

**JOB 1 — every view, screenshotted at 390×844 and 1440×900, looked at, fixed.** 14 views ×
2 widths = 28 plates in `shots/gffl_polish_<view>_<w>.png` (gate/first-run/claim/league-home
populated/matchup/matchup-thread/locker-own/locker-other/moves/chat/scores/rules-view/
rules-edit/bracket-champion). **Five real defects found and fixed:**
1. **Chat composer squeezed to ~40px.** `.chatRow` had no `flex-wrap`/basis discipline, so the
   icon buttons + textarea + send button fought for a fixed-width row and the `<textarea>` lost
   almost everything. Fixed: `.chatRow{flex-wrap:wrap;row-gap:8px}`, icons `flex:0 0 auto`,
   `.chatText{flex:1 1 200px;min-width:0}`, send `flex:0 0 auto` — same fix serves BOTH the
   main league chat and the matchup-page "trash talk" thread composer (`chatWidgetHtml` is
   shared).
2. **Matchup card team names truncated to a single letter** at both widths — `.mugrid`'s
   `grid-template-columns:repeat(auto-fit,minmax(140px,1fr))` let a column collapse to 140px,
   too narrow for "Waffle House Warriors". Raised to `minmax(260px,1fr)`.
3. **Bottom nav bar visible on gate/claim/first-run** — screens an unauthenticated or
   not-yet-claimed visitor sees before there's a league to navigate. `hideBnav()`/`showBnav()`
   helpers wired into `renderGate`/`renderClaim`/`renderFirstRun` (`UI.show()` already calls
   `showBnav()` on every real view transition).
4. **`.bnav[hidden]` did nothing** — `.bnav{display:flex}` beats the UA `[hidden]` stylesheet
   rule (the same class of bug this codebase has hit repeatedly elsewhere: Home cards, Farmstead
   panels — any `display`-styled container toggled via the `hidden` attribute needs an explicit
   `[hidden]{display:none}` restatement). Added right after the base `.bnav` rule; this is what
   actually made fix #3 work.
5. **`input.redit` truncating "last-round" to "last-roun"** in Rules edit mode — a 76px fixed
   width sized only for short numeric scoring values, applied uniformly to every rule field
   including the longer keeper-cost strings. Measured `scrollWidth` 110px vs the old 76px width;
   raised to 112px.
   **One thing investigated and correctly left alone**: "TRASH TALK" appeared to have its
   header text clipped at the top in the matchup-thread screenshot, unlike "AI READ"/"THE FEED"
   above it in the same card stack. Measured live: the `h2`'s position relative to its own
   `.card` is byte-identical across all four cards (17px gap, every time) — no real layout bug.
   Root-caused instead to `.chatcompose{position:sticky;bottom:0}` colliding with the sweep
   script's `fullPage:true` capture (Puppeteer resizes the viewport to the full document height
   mid-capture, and a `position:sticky` element's sticky math briefly disagrees with the
   pre-resize viewport) — proven by disabling `position:sticky` on that element and reshooting,
   which renders identically crisp. This is the exact class of screenshot-only false positive
   already documented elsewhere in this file ("Puppeteer `fullPage:true` screenshot artifacts
   with `position:fixed`/`position:sticky` elements... without being a real rendering bug") —
   no code change made, because a real user scrolling the page never sees it.

**JOB 2 — boot speed.** Root problem: `UI.boot()` stacked its ENTIRE backend read chain
(rules → teams → schedule → per-team rosters, one at a time → 2000-word record-book walk →
tx log → league chat → auto-checks) as a strict serial `await` sequence BEFORE the first
paint, and `league.html` additionally gated the whole call behind `LG.backendReady.then(...)`
— an extra async hop even for an unauthenticated visitor whose gate screen (`LG.unlocked()`
is a plain localStorage read) needs no backend at all.
- **`league.html`**: `LG.backendReady.then(() => LG.ui.boot())` → `LG.ui.boot()` called
  directly; `UI.boot()` itself now awaits `backendReady` only once it knows it's actually
  unlocked, right before its first real `LG.db` read.
- **`UI.boot()`**: the independent settings/teams/schedule reads batch into one
  `Promise.all` (were three sequential awaits); `runAutoChecks(true)` — the
  waiver/trade/finalize/bracket-advance chain — moved to run **after** the first paint
  instead of before it. `UI.boot()`'s returned promise still fully awaits it before
  resolving (a direct re-`await UI.boot()`, e.g. simulating "reopen the app past a
  deadline," still guarantees the league is caught up by the time it returns — this
  is the one test contract (I3) that could not be relaxed, so auto-checks moved
  AFTER render but stayed INSIDE `boot()`'s own await chain, not detached to an idle
  callback).
- **`loadWeekRosters()`**: per-team `await LG.ensureRoster(...)` in a `for` loop →
  `Promise.all(LG.teams.map(...))` — N independent round trips collapsed to one.
- **`renderLeague()`**'s fetch chain: 8 sequential awaits (weekly list → bracket list →
  rosters → standings → weekly doc → accuracy → record book → bracket → tx → chat →
  week's games → stale-week check) → 2 parallel `Promise.all` batches.
- **Record book / recent moves / league chat are now LAZY.** All three were unconditionally
  fetched on every League-home render even though they render inside collapsed `<details>`
  cards most opens never expand — the record book walk in particular re-derives standings
  across every imported season plus every finalized week. `recordBookHtml`/`recentMovesHtml`/
  `recentChatHtml` now render a collapsed placeholder shell when their `UI._recordBook`/
  `UI._tx`/`UI._recentChat` is `undefined` (a real "not loaded" sentinel, distinct from
  "loaded but empty"); `wireLazyLeagueDetails()` binds a `toggle` listener per `<details>` that
  fires the real `LG.recordBook()`/`LG.loadTx()`/`LG.loadChat(null)` call the first time it's
  actually opened, then repaints in place (preserving which other `<details>` were already
  open). Reset to `undefined` on every genuine (non-repaint) League visit, so a real navigation
  back always reflects what's currently true once opened — it just costs nothing until then.
- **Suite**: new section **W** — `tools/_verify-gffl.cjs` cold-boots the app under an
  `LG.db._installFakeCloud` 80ms-per-call fake slow backend (same mechanism as the pre-existing
  P4 test, armed via a zero-race-window `Object.defineProperty` getter/setter chain on
  `window.LG` → `LG.db` so the fake cloud lands in the same synchronous statement that creates
  the real one) and asserts nav-to-`.mucard`-painted stays **under a 900ms budget** — measured
  299–360ms across repeated runs (a naive 12-call serial chain against that same fake cloud
  would need 960ms+ on its own).
- **MEASURED, before vs after, 5-run medians** (`gffl_boot_speed.cjs`, in the session scratchpad
  — reverses this session's exact edits onto a copy of the tree via `build_before.cjs` so the
  two trees differ ONLY in the boot/render shape, everything else byte-identical): under the
  **local backend** (Firebase blocked, matches every suite run — the realistic floor, since
  almost all of boot's cost there is unavoidable localStorage/sync work) cold **153ms → 148ms**
  (~3%, inside run-to-run noise), warm **115ms → 104ms** (~10%); under a **fake slow cloud**
  (80ms/call — representative of a real network backend, and the scenario these changes were
  actually aimed at) cold **1,779ms → 360ms**, an **80% reduction** (~4.9× faster). The
  local-backend numbers barely move because there wasn't much serial network latency to remove
  there in the first place; the real win is for anyone on the real Firestore backend, where the
  old code paid for every one of ~15 sequential round trips before the first pixel and the new
  code pays for at most 2–3 parallel batches.
- **Restaged, 4 tests, each for a documented reason** (never bent to make a check pass): **I3**
  (`await UI.boot(); return LG.loadClaims(1);` expecting `processed:true`) — unaffected, since
  auto-checks still complete before `boot()` resolves; test itself needed no change, but is the
  reason auto-checks stayed inside the awaited chain rather than moving to a detached idle
  callback. **P3** (auto-check throttle) — was reading `UI._autoCheckRuns` immediately after
  `.mucard` appeared, which used to reliably imply auto-checks had already run; now render can
  land before they finish, so the check waits on `UI._autoCheckRuns >= 1` via
  `page.waitForFunction` instead of an immediate read. **N3/N7** (record book, real + empty
  states) and **R** (recent moves + league chat cards) — all four now `open` their `<details>`
  and wait for the placeholder text to clear (`openDetails()` helper) before reading rendered
  content, since that data no longer arrives unconditionally with the page.
- **fonts/preconnect/critical-CSS**: reviewed and left alone — `league.html` already has no
  external font `<link>` (Barlow Condensed/Inter are loaded how the rest of the app's pages
  load fonts, unaffected by this pass) and the Sleeper 14MB directory load was already
  fire-and-forget, never awaited by anything on the paint path (confirmed via the boot-speed
  script's request interception, which aborts every non-same-origin request including Sleeper's
  and still reaches first paint fine).

**KNOWN / DEFERRED**: the first-run screen's header meta briefly shows "Week 1 · 2026" before
any team exists — noticed while reviewing screenshots, judged too low-severity to chase (a
one-time first-boot state, not a returning-user path) and left as-is.

## 🏈 GFFL — "2025 TEST SEASON" mode (2026-08-08, UNCOMMITTED)

A commissioner-gated sandbox: open the app as if it's week 4 of the REAL 2025 NFL season,
before any week-4 kickoff, with weeks 1-3 already finalized from Sleeper's real ARCHIVED
stats — so waivers/FA/trades/lineups can all be exercised against real rosters and real
scoring, without touching a single byte of the live league. `assets/league/lg-{core,data,
ui}.js` + `league.html` only — `netlify/functions/league.mjs` needed NO changes at all (the
existing `lg_espn_rosters_season` action, built for the pre-existing "Import 2025 rosters
(test run)" button, already does everything the guided setup needs). Suite:
`tools/_verify-gffl.cjs` **605 → 639** (34 new checks, section X), 0 page errors.

**TOTAL ISOLATION, and it's a COLLECTION switch, not a season-number switch.** `LG.TEST_FLAG`
(`localStorage["gffl_test2025"]`) gates `applyTestModeVars()`, which derives `LG.COLL` (a
"_t25" suffix on the real collection name), `LG.SEASON` (2025) and `LG.SEASON_START`
("2025-09-02", the Tuesday before the real Sept-4 opener) PURELY from the flag — called once
at module load (a returning visitor's flag applies from the very first read) and again inside
`LG.enterTestMode()`/`LG.exitTestMode()`. Every doc id this app mints threads through `LG.COLL`
at call time (not captured in a closure), so the switch reaches every backend call with zero
other code changes. `LG.db.clearCache()` (new — the doc/list caches are keyed by id/kind alone,
with NO collection component, so switching `LG.COLL` without clearing them would let a real-
collection doc answer a test-collection read straight out of cache) is called on every
enter/exit/reset. TEAM IDENTITY is isolated too: `LG.myTeamId()`/`LG.setMyTeamId()`/`LG.who()`/
`LG.setWho()` read/write `gffl_team`/`gffl_who` with the SAME "_t25" suffix while
`LG.testMode()` — the real 2026 rosters and the real 2025 rosters are different teams, so a
real-season claim must never silently apply in the sandbox (and a fresh test collection
therefore always starts with NO claimed team, which is exactly what makes the guided setup's
"land on the claim screen once ready" handoff work with zero extra code).

**NO IN-MEMORY HOT-SWAP — enter/exit/reset all end in a hard `location.reload()`.** Matches
the house precedent (P6 layout-hash reloads, the family-lobby room-adoption reload) rather than
trying to patch `LG.teams`/`UI._rosters`/`schedule`/etc. in place, which would be a much larger
surface to get right for a rare, deliberate, commissioner-gated action. `LG.resetTestMode()`
wipes every doc in the CURRENT collection (`LG.db.list()` with no kind filter — refuses outright
if `!LG.testMode()`, so it can never accidentally target the real collection) and returns
`{ok, wiped}`; the caller (a Rules-page button) reloads after. **BUG CAUGHT BY THE SUITE, not by
review**: the first cut iterated `LG.db.list()`'s return value directly while deleting from it —
`LG.db.del()`'s `cacheUpsert()` splices the just-deleted doc straight out of that SAME array (the
list-cache's own `.docs`, returned BY REFERENCE, not a copy), so a live `for...of` over it skips
every other element as the array shifts underneath the loop (measured: 29 docs on the board, only
14 actually deleted). Fixed with a `[...docs]` copy before the loop.

**THE PINNED CLOCK, and the ambiguity the task handed me to resolve.** `LG.now()` = `LG.
nowOverride` (the pre-existing test hook, unchanged priority) else, while `LG.testMode()`, a
FIXED constant `LG.TEST_NOW` — 2025-09-24T09:00 CDT, one hour past week 4's default Wednesday-
8am waiver deadline, two days before the first week-4 kickoff. This is a "persisted override"
with zero storage: it's just a constant gated on the same flag `LG.testMode()` already reads, so
it survives every reload for free and reads identically on every device. THE CHOICE: pinning
AFTER the deadline (rather than before) means week 4's Moves page shows free agency OPEN the
moment setup finishes — `LG.faAdd` testable with zero extra clicks, the more immediately
discoverable of the app's two waiver UX modes. Blind-bid CLAIM queueing doesn't lose anything
for it: `LG.addClaim`/`cancelClaim`/`processWaivers` all take an explicit week and never consult
the clock themselves, and a small **test-mode-only "Testing week" switch** on the Moves page
(two buttons, `UI.week = 4 | 5`) makes the ordinary bid-a-claim form reachable too — week 5's own
Wednesday deadline is still six days away at the pinned instant. Both paths are therefore
reachable from the real UI, not just from test code, which is what the task's own note ("make
whichever choice lets BOTH be exercised, and document it") was asking for.

**THE ONE-TAP GUIDED SETUP, and why it needed a real fix in `D.weekStats` to work at all.**
`UI.boot()` gained one check: `if (LG.testMode() && await testSeasonNeedsSetup())
{ renderTestSeasonSetup(); return; }` — `testSeasonNeedsSetup()` looks for exactly the
artifacts the wizard itself writes (teams, a schedule, weekly docs for 1-3), so a run that stops
partway (a flaky ESPN read, a closed tab) resumes on the very next boot rather than duplicating
or erroring. `runTestSeasonSetup()`: (1) `lg_espn_rosters_season({season:2025})` — the SAME
server action the pre-existing manual "test run" button already calls; (2) seeds every returned
team via `LG.saveTeam`; (3) `applyImportedRosters(j, week)` — gained an explicit `week` param
(defaults to `UI.week`, so every EXISTING caller is byte-for-byte unaffected) so the wizard can
seed WEEK 1 regardless of whatever `UI.week` happens to be showing (`LG.ensureRoster` copies
forward lazily from there, so nothing else needs to write weeks 2-4 explicitly); (4) generates +
saves the season schedule if absent; (5) `LG.finalizeWeek(w, {backfill:true})` for w=1..3.
Step 5 is where the REAL bug lived: `LG.finalizeWeek`'s backfill path called `LG.data.
weekStats(week)` with no season argument, and `D.weekStats` defaulted its season from **Sleeper's
own live `/state/nfl` reading** — i.e. always the REAL CURRENT NFL season, regardless of which
season this league doc claims to be. In the real (non-test) case that's harmless (the live
season and `LG.SEASON` already agree), but for the 2025 sandbox it would have silently queried
`/stats/nfl/regular/<current-real-year>/<week>` instead of 2025's — the wrong year's archived
stats, or none at all. Fixed narrowly: `D.weekStats(week, opts)` now takes an optional
`{season, seasonType}` override (no `opts` = byte-identical to the old priority for every
existing caller), and `LG.finalizeWeek`'s backfill branch passes `{season: LG.SEASON,
seasonType:"regular"}` explicitly — `LG.SEASON` is this league's own single source of truth
already, for the real league AND the sandbox alike. A SECOND small fix rode along:
`LG.loadRules()`'s no-settings-doc-yet fallback used to stamp the rules object's `.season` field
from the `LG.DEFAULT_RULES` literal (frozen at whatever `LG.SEASON` read at MODULE-EVAL time —
always 2026), so a fresh test collection with no settings doc would have displayed "season 2026"
everywhere the rules doc's own field is shown, inside a 2025 sandbox. Now stamps `LG.SEASON` at
READ time instead.

**WEEK 4 STAYS HONESTLY UPCOMING, no special-casing needed.** The live (non-backfill)
`LG.finalizeWeek` path is gated on the live engine's OWN reported week matching the week being
finalized (`fzEngineWeek() === week`, the adversarial-review provenance fix from the same day) —
since the live engine only ever reports the REAL current NFL week (there is no way to make ESPN's
public API serve "live" data for a week that happened a year ago), it can never equal 4 by
coincidence, so `maybeAutoFinalizeWeeks` (which runs on every boot/render) always correctly
refuses week 4 with "stale-week" and writes nothing. No test-mode branch was needed in that code
path at all — it already does the right thing by construction. The league home's existing
"these weeks can't be settled from what's on the board" card DOES surface week 4 there with a
commissioner-only "Finalize week 4 from archived stats" button (the same affordance that offers
the archived-stats fallback for a REAL missed week) — deliberately left un-suppressed: it's a
genuine, correct action (Sleeper really does have week 4's real 2025 numbers on file) and a
commissioner exploring the sandbox may well want to finalize further weeks, not just the
first three. Tapping it early defeats the "before kickoff" scenario but doesn't break anything.

**MEASURED, hand-checked** (the fixture's `ffRosterDoc2025Rich()`, armed only behind a NEW
`fixture.test2025Rich` flag so the pre-existing section Q's own 1-team roster fixture is
completely untouched): a 2-team, real-player-id fixture (all ids already present in the
suite's `slpPlayersFix`, so Sleeper's archived-stats endpoint scores them for real) — team 1
(Battle Kreussers) wins all three weeks, **4.0–41.0 / 41.0–4.0 / 20.0–2.0** (home/away flips
between week 1 and weeks 2-3, per `LG.generateSchedule`'s own circle method for a 2-team
league), landing standings at **3-0/102 PF vs 0-3/10 PF**. Verified end-to-end against the real
`LG.faAdd`/`LG.addClaim`+`processWaivers`/`offerTrade`→`acceptTrade`→`executeTrade` calls (a
trade needed the review window fast-forwarded via a temporary `LG.nowOverride`, cleared right
after) — every roster mutation checked by re-reading the actual saved roster doc, not just the
function's return value.

**Suite gotchas, both cost a full run to find**: (1) the FIRST "real docs untouched" comparison
failed with an EMPTY diff (`added=[] removed=[] changed=[]`) — a plain `JSON.stringify()`
comparison of two localStorage snapshots is sensitive to key INSERTION ORDER, which isn't a
content guarantee across two separate reads even when nothing actually changed; fixed with a
`canon()`/`stableStr()` helper that recursively sorts every object's keys before stringifying,
used for all three "byte-identical" comparisons in the section. Also folded into the SAME
snapshot: `D.initSleeper()`'s background fetch chain (kicked off during the real league's own
FIRST boot, well before test mode is ever entered) and the `snapshotProjections()` it triggers
can still be in flight at the moment a naive "before" snapshot is taken — the fix explicitly
awaits `D.slpReady` + re-calls `snapshotProjections()` (idempotent — a no-op if it already ran)
+ calls `D.stop()` before snapshotting, so the "before" picture is genuinely settled and nothing
can write to the real collection in the background for the rest of the section. (2) a
`page.waitForNavigation()` raced against a `clickIn()` for a button that wasn't actually on
screen (the section had navigated to Moves in between and never returned to Rules before trying
to click "Exit") — `clickIn()` fails SILENTLY (`if (!el) return false`), so the click never
fired and `waitForNavigation()` timed out after 30s with an uncaught rejection that crashed the
whole suite process. Fixed by re-navigating to Rules immediately before the exit click, same as
every other commissioner-button test in this file already does.

**KNOWN / DEFERRED**: a partial-setup RESUME (e.g. weeks 1-2 finalized, week 3 failed) is only
exercised indirectly, via the reset→reload→fresh-guided-setup-reappears path — a targeted
"delete just one artifact from an otherwise-complete sandbox and confirm the wizard repairs only
that piece" test would be a reasonable follow-up but wasn't built here; and tapping the league
home's "Finalize week 4" button (see above) is a real, working, deliberately-unsuppressed way to
short-circuit the "before kickoff" scenario — noted, not prevented.

## 🏈 GFFL — "2025 TEST SEASON" mode grows a switchable CLOCK (2026-08-08, UNCOMMITTED)

The single-instant sandbox above is now three commissioner-selectable PHASES of the same
Sunday, so waivers, a live in-progress slate, AND the Tuesday morning after can all be exercised
without leaving the sandbox. `assets/league/lg-{core,data,ui}.js` only — `netlify/functions/
league.mjs` untouched. Suite: `tools/_verify-gffl.cjs` **639 → 677** (new section X2, 38
checks), 0 page errors, `node --check` clean on all three files.

**THE THREE PHASES** (`LG.TEST_PHASES`, `LG.testPhase()`/`LG.setTestPhase(n)`, persisted in
`localStorage["gffl_test2025_phase"]`, default 1 when absent/invalid — an old sandbox, or a
brand-new one, always opens on the ORIGINAL pinned instant, byte-identical to before this
batch): **1** "Week 4 · before games" (the existing pin, untouched) · **2** "Week 4 · games LIVE
(replay)" — Sunday 2025-09-28 13:30 CT, still inside week 4's Tue→Mon window
(`currentWeek()===4`, verified against `LG.currentWeek()`'s own math, not eyeballed) · **3**
"Tuesday after week 4" — 2025-09-30 10:00 CT, one tick into week 5's window
(`currentWeek()===5`, well before its own Wednesday waiver deadline). `LG.now()` now reads
`LG.TEST_PHASES[LG.testPhase()].now` instead of the old fixed `LG.TEST_NOW` constant (kept as a
plain alias to phase 1's own value — nothing else reads it directly any more). Switching is
commissioner-gated (`LG.gateCommish()`), a new "Test-season clock" card on the Rules page (3
buttons, the current phase's own button disabled), and hard-reloads exactly like Enter/Exit/
Reset — no in-memory hot-swap of `D.S`/`UI._rosters`/etc. is attempted, same cold-boot posture
as every other test-mode transition in this file.

**PHASE 2 IS A TEST-MODE-ONLY DATA-LAYER BRANCH, not a UI overlay.** `D.pollOnce` now checks
`LG.testMode()` FIRST: phase 2 routes to a new `D.testLiveSync()`; phases 1 and 3 poll NOTHING
at all (a past-season sandbox has no business hitting the real, current-NFL-week endpoints —
real 2026 data could otherwise leak onto a 2025 board for any player id that happens to recur).
`testLiveSync()` makes ZERO live ESPN/Sleeper requests — it fetches the SAME archived-per-week
endpoint `D.weekStats`/`LG.finalizeWeek`'s backfill already trust (Sleeper's own `/stats/nfl/
<type>/<season>/<week>`, which serves ANY completed week, real 2025 included) and synthesizes an
in-progress Sunday out of it:
- **Bucket is per NFL TEAM**, not per player — `D.testTeamBucket(ab)`, the standard 32
  abbreviations alphabetical, split into even thirds (ARI..DET="post"/early-final, GB..NE="in"/
  live, NO..WAS="pre"/night). Fully deterministic, no real schedule/kickoff data needed (a
  replay is a synthesized snapshot, not a live-time-accurate simulation — a hard reload on any
  phase change resets `D.S` fresh regardless). Exposed as a test hook (`D.testTeamBucket`) so
  the suite hand-checks against the real function rather than re-deriving a hash independently.
- **EARLY bucket**: the real archived line in FULL, "post"/Final.
- **LIVE ("3:25 window") bucket**: the archived line scaled to a deterministic 55-65% baseline
  (`D.testPlayerScale(pid, tickN)`, an FNV-1a-ish hash of the Sleeper pid — also exposed as a
  hook), creeping **+1%/poll** up to a 0.95 cap that never reaches "final" — the stretch goal
  ("a slow tick so the feed moves") landed clean: every changed stat routes through the SAME
  `applySide()` the real live poll uses, so a tick that actually changes a rounded value emits a
  REAL feed event, hand-verified against the real API (1 → 7 events over 6 explicit ticks).
- **NIGHT bucket**: zero stats, "pre" — hasn't kicked off in the replay.
- **Auto-finalize does NOT fire mid-replay**, and it's guarded TWICE: `testLiveSync()`
  deliberately never touches `D.S.espnWeek`/`D.S.slpWeek` (they stay at their null default),
  which already makes `fzEngineWeek()` return null and the live-path gate in `LG.finalizeWeek`
  refuse naturally (the adversarial-review finding 1/3/7 guard, reused rather than duplicated) —
  PLUS an explicit belt-and-suspenders line (`if (LG.testMode() && LG.testPhase()===2) return
  {ok:false, reason:"test-live-replay"}`) right at the top of the live (non-backfill) branch, so
  the guard holds even if the synthesis code ever changes to set those fields for some other
  reason. Verified both ways: `UI.maybeAutoFinalizeWeeks()` leaves week 4 unfinalized, and a
  direct `LG.finalizeWeek(4)` call returns the explicit refusal reason.
- **Health reads "dual"/normal throughout** — `testLiveSync()` never touches `failN`/`lastOk`,
  which is exactly what makes `updateHealth()`'s `bad()` check short-circuit false on both
  sides; called anyway at the end of every sync for hygiene.

**PHASE 3 finalizes week 4 the moment you land on it.** `LG.setTestPhase(3)` calls
`LG.finalizeWeek(4, {backfill:true})` — the SAME archived-stats path the guided setup already
uses for weeks 1-3 — before returning, so the commissioner never has to remember a separate
step. Idempotent by `finalizeWeek`'s own write-once guard (an existing doc returns untouched,
never recomputed) — re-entering phase 3 twice in a row is a no-op the second time, verified via
a direct byte-for-byte re-read. Reverting to phase 1 or 2 afterward does NOT "un-finalize" week
4 — that record is append-only by design (plan §8: no single mutable doc whose loss loses the
season), so the board may then show week 4 as already-decided even while the clock reads
"before games"; a documented, accepted quirk of testing phase transitions out of order, not a
bug guarded against. Waivers: at the Tuesday clock, week 5's own Wednesday deadline hasn't
passed, so a submitted claim genuinely QUEUES rather than instant-processing — and the existing
commissioner "Process now" affordance (item 1's `#mvProcessNow`, PIN-gated, deadline-independent
by design) is exactly the "jump past Wednesday 8AM" lever the task asked for; nothing new was
built for it, it was already there.

**REQUIRED PROJECTIONS — the source that actually worked, measured not assumed.** The real
live-poll projections fetch resolves off Sleeper's CURRENT `/state/nfl` reading (the real,
current NFL week), meaningless for a 2025 sandbox and disabled outright anyway (phase 1/3 poll
nothing, phase 2 routes elsewhere). `D.testEnsureProj(week)` is the replacement: (1) try
Sleeper's real forward-projections endpoint for THIS season+week explicitly; (2) if that comes
back genuinely empty — the expected case, and the one this batch actually hit, since forward
projections aren't retained for a week two seasons gone — FALL BACK to that week's own real
ARCHIVED ACTUAL stats (the identical `/stats/nfl/<season>/<week>` endpoint the live replay and
the backfill both already trust); same raw pid→stat-row shape either way, so `D.projFor`'s
existing `D.score(normSlp(st))` scoring path needed no branching at all — only the `source`
field differs (`"projection"` vs `"actual"`), cached per week (`D.S.testProjCache`, de-duped
in-flight requests) and surfaced HONESTLY rather than silently presented as a real forward
projection: the persistent test banner reads it and says so plainly ("projections are a proxy
from week 4's real final stats (no forward projection exists for a completed season)"). Verified
BOTH paths for real: week 4 (empty fixture) → `source:"actual"`; week 5 (a real fixture entry) →
`source:"projection"`. `D.projFor` itself is now test-mode-aware, resolving the CURRENTLY
DISPLAYED week (`LG.ui.week`, read at call time — no load-order dependency on lg-ui.js) rather
than a single module-global map, since the sandbox has TWO real weeks in play at once (4 via the
phase clock, 5 via the Moves page's own testWkBtn switch). Every page that shows a projection
(matchup's proj column, the FA table's PROJ column, the locker's own lineup rows) warms its OWN
week via a shared, loop-safe `testProjEnsureAndRepaint(week, viewName)` helper — cache-miss
kicks off the fetch and repaints once (`UI.show(viewName)`) if still on that view; cache-hit is
an instant no-op, which is what keeps the repaint from looping on itself. `syncTestBanner()`
warms it too (so the banner's own honesty note is self-sufficient, correct even before any
matchup/moves/locker page has been visited), and `startData()` warms the phase's own canonical
week at boot before running the pre-game projection snapshot (S5), so that snapshot never runs
against a still-cold cache and silently captures nothing.

**Two real bugs, both in the TEST, not the product** — worth keeping as house lessons:
1. `UI.openLocker(teamId)` sets `location.hash = "#locker=" + teamId` (`UI.show()` alone never
   touches the hash). A later JS-only `UI.show("rules")` doesn't clear it, so the NEXT hard
   reload's `routeInitial()` read the STALE hash and landed back on the locker view instead of
   the league home every subsequent `.mucard` wait in the test expected — `.mucard` is a
   league-home-specific matchup-row class, absent on the locker page, so the wait turned a
   9-second timeout into a full `SUITE CRASH` rather than a clean assertion failure. Fixed by
   clearing `location.hash` in the test right after the locker check, before triggering the next
   phase-switch reload.
2. Comparing two `LG.loadWeekly(4)` reads with a raw `JSON.stringify()` failed even though the
   STORED content was byte-identical: a doc answered through a list-cache path carries a
   runtime-attached `{...doc, id}` (the id-LAST convention from the earlier adversarial-review
   batch, findings 2/4/5/12) while a doc answered through a plain `get()` never does — a genuine,
   benign artifact of WHICH cache path answered the read, not a difference in the record's own
   persisted content. Fixed with the file's own `stableStr()` (canon-sorted) PLUS an explicit
   `.id`-stripping helper before comparing.

**Suite**: section X2, 38 checks — phase persistence across a real reload (all three, both
directions, plus a second live↔before cycle to prove order-independence beyond the tuesday↔
before pair already exercised); bucket assignment for the three rostered NFL teams landing in
all three buckets from ONE roster (PHI=night, DAL=early/final, KC=live); the early/final and
night players hand-checked exact (Q. Rival 400yd/3TD=28.0 Final; P. Passer zero/upcoming); the
live-window player hand-checked against the EXPOSED `D.testPlayerScale` itself across 6 explicit
ticks (creeps up, never regresses, lands real feed events); health stays "dual"; the matchup
page's live totals/win-prob/players-remaining/feed/yet-to-play-proj; auto-finalize's silence
during phase 2 plus the explicit guard's reason string; the FA table's PROJ column for a
genuinely unrostered free agent (via the actual-stats fallback); the locker's own lineup proj
(unscaled — projections don't vary with the live replay's bucket); phase 3's unprompted
week-4 backfill hand-checked exact (10.0–28.0, team 2 wins — the SAME "opposite result" fixture
shape the original adversarial-review finding used) plus the resulting standings; idempotent
re-entry; queued-vs-processed waivers at the Tuesday clock; and the full round trip back to
phase 1 leaving the already-finalized week 4 record untouched (the documented quirk, not a bug).
Its own fresh page/context, deliberately not chained onto section X's flow (which consumes F.
Agent/A. Vail for ITS OWN checks — reusing that running state here would leave neither free
agent for this section to find in the FA table). `WEEK_STATS_FIX[4]` gained two entries for
this batch (T. Tight/KC — the live-window hand-check subject; F. Agent/KC — the FA-table
subject) — confirmed inert for every pre-existing assertion (grep: nothing else in the file read
`WEEK_STATS_FIX[4]`/`D.weekStats(4)`/`finalizeWeek(4)` before this batch, and the two sections
that DO poll a week-4 fixture for the real 2026 league use a week-3-only-QB roster that never
touches KC).

**KNOWN / DEFERRED**: phase 2's bucket assignment is a fixed alphabetical split, not a real NFL
schedule — a team's "kickoff window" in the replay has no relationship to when that team
actually plays in the real 2025 slate (deliberate — the replay is a snapshot for testing, not a
time-accurate simulation, and the task's own phrasing treats the three windows as flavor rather
than a scheduling contract); the +1%/poll creep has no natural stopping point beyond its 0.95
cap (a very long-lived phase-2 session would eventually look almost final without ever quite
getting there — harmless, since nothing auto-finalizes from it); and `D.testEnsureProj`'s
fallback-to-actual-stats source is a genuine approximation (a player's "projection" during
phase 2 can read HIGHER than what the live replay currently shows them scoring, since the
fallback is always the FULL final line regardless of the replay's own scaled-down bucket) —
flagged in the banner's own honesty note, not hidden.

## 🏈 GFFL — the player stats card + Moves MOVE-button split (2026-08-08, UNCOMMITTED)

Clicking a player ANYWHERE now opens a full-screen stats overlay instead of silently doing
double duty as an action trigger. `assets/league/lg-{data,ui}.js` + `league.html` only —
`netlify/functions/league.mjs` untouched. Suite: `tools/_verify-gffl.cjs` **677 → 706** (new
section Y, 29 checks), 0 page errors, `node --check` clean on all three JS files.

**THE CARD** (`UI.openPlayerCard(key)`/`UI.closePlayerCard()`, `#playerCard` overlay — a
persistent sibling of `#main`, wired ONCE at boot like `#imgOverlay`): name/pos-badge/team/
injury header, a "This week" line (live/final points + projection + game state, the exact
`d.S.players`/`d.projFor`/`d.S.games` reads `halfCell`/`lrow` already use elsewhere), three stat
tiles (season total / avg per week / best week), and a per-week game-log table, newest first.
Closes on Escape, on a backdrop tap (`e.target === e.currentTarget` — a tap on the card's own
content never closes it), or its own ✕ button.

**DATA — two new `lg-data.js` helpers, no new state.** `D.metaForKey(key)` resolves name/pos/
team/injury for ANY key (rostered, benched, a rival's, or a genuine unrostered free agent) —
roster data first (authoritative, same precedence `askAiRead`'s `buildSide()` already uses),
then the Sleeper directory (`D.S.slpPlayers`/`slpByEspn` — what makes a free agent's card work
at all), then the live-poll row as a last resort. `D.gameLog(key)` is the one honest source for
the table: weekly docs only ever store TEAM totals (`LG.finalizeWeek`'s `matchups`), never a
per-player breakdown, so the log re-queries Sleeper's ARCHIVED per-week stats endpoint (the same
one `finalizeWeek`'s `backfill` path and the 2025 test season already trust) once per finalized
week, with the league's own explicit `{season: LG.SEASON, seasonType:"regular"}` — the same
override `finalizeWeek`'s backfill passes, so a 2025-test-season week and a real-league week
both resolve against the correct year. A week the archived endpoint has no entry for that key is
**OMITTED, not zeroed** — this app tracks no historical roster membership, so "no stat line"
honestly could mean bye/inactive/not-yet-in-the-league, and fabricating a 0 would be a guess
nothing else here makes. `D.oppForWeek(week, teamAbbrev)` is "opponent-if-known" taken
literally: this app tracks no historical NFL schedule at all, so it only ever answers for the
live engine's OWN current week (`D.engineWeek()`), reading the same `D.S.nflEvents` the Scores
tab already polls — every other week honestly reads "—", never a guess.

**THE SPLIT — a row that used to both inform and act now does exactly one or the other, on two
different elements.** Matchup lineup rows (`halfCell`, both sides, starters + bench — never had
a click action to begin with, so this was pure addition): the `.pcellgrid` carries `data-pk`
when it holds a real player. Locker: the owner's own `.lrow` split into `.linfo` (stats) +
`.lswap` (the swap sheet, unchanged behavior — including the "already started" lock toast);
an EMPTY slot has no player to show a card for, so it's still one tap-to-fill `.lswap.lswapfill`
button, exactly as before. A non-owner's read-only roster table has no action to preserve, so
the whole `<tr data-pk>` opens the card. Moves free-agent table: the row (`data-pk`) opens the
card, an explicit accent-outlined `.faMoveBtn` (kept its `.faAddBtn` class + "Add"/"Claim"
wording — the spec's "MOVE button" describes the split, not new copy) does the add/claim; its
own index attribute is `data-mi`, deliberately NOT `data-fi` — the generic `#faResults [data-fi]`
selector several existing tests already used to count/list ROWS would otherwise match twice per
row (caught live: browse mode reported "8" free agents instead of 4 on the first run). Trade
builder pick chips (`chip()`): `.pcinfo` (stats) + `.pcpick` (the give/get toggle, now its own
button — flips the OUTER `.pickchip`'s `picked` class same as before). "My pending" claims/
trades rows: player names became `.pcinline` text-buttons (Cancel/Accept/Decline/Veto stay the
buttons they always were). One idempotent `wirePlayerCardTaps(root)` (a `data-pk-wired` dataset
guard) wires every `[data-pk]` anywhere — safe to call more than once over overlapping DOM,
which `renderMoves()` genuinely does (once scoped to the FA table inside `refreshFa()`, once
unscoped at the end for the claims/trade-builder rows rendered alongside it).

**Suite** hand-seeds 4 weeks of finalized history directly as `weekly_2026_wN` docs (the
section M4/S7 technique — bypasses `finalizeWeek`'s live-data gate entirely, since the game log
only cares that a week is finalized, not its `matchups` content) paired with the existing
`slpStatsFix` fixture's own per-week shape, giving P. Passer a hand-computable 4-week history:
weeks 1-2 generic (150yd/1TD/1INT/1-2pt = 10.0), week 3's override (300yd/2TD = 20.0), week 4's
(25yd = 1.0) → total 41.0, avg 10.25 (renders "10.3" — `LG.fmtPts` rounds to 1dp), best 20.0 —
all individually asserted against the rendered table, newest week first. Also caught, live, that
week 1 genuinely IS the fixture's own current engine week (no `espnWeekNum` override + Sleeper's
default `state.week:1`), so PHI's opponent is honestly knowable there ("vs DAL") while weeks
2-4 correctly read "—" — a real exercise of the honesty design, not a contrived case. Restaged 8
existing click sites (all pre-existing tests that used to click the row itself to trigger an
action) via a new `clickChildIn(page, containerSel, childSel, filterText)` helper (finds the
CONTAINER by its text, then clicks a specific child inside it — `clickIn`'s filter can't reach a
nested button whose own text, e.g. "Add"/"Pick"/"Swap", is identical across every row): 4 FA-row
claim-sheet opens (`.faMoveBtn`), 2 trade-builder pick-chip toggles (`.pcpick`), and the
locker's 4 lineup-swap taps across sections E and V4 (`.lswap`) — each restage documented in
place with the reason (item 3/1's row/action split), never silently bent. Every pre-existing
check in the 677-check baseline still passes unchanged.

**KNOWN / DEFERRED**: the card doesn't live-refresh while open (a live game's points can move
underneath a still-open card — no spec requirement to do otherwise, and closing/reopening always
shows the current number); the claim sheet's own drop-picker rows and the swap sheet's own
candidate-list rows were deliberately left as plain selection buttons (not split) — they're a
"pick one of my own roster to drop/bench," not a "browse and act on any player" surface, and
splitting them would add a stats-card detour to an already-committed selection flow; and
`D.oppForWeek`'s abbreviation match is a straight `slpTeam()` normalization (handles the one
documented ESPN/Sleeper divergence, Washington) rather than a full alias table.

## PERF REGRESSION FIX + ESPN-style sortable players table + Scores-tab GFFL card (2026-08-08, same session, UNCOMMITTED)

**PRIORITY DIAGNOSIS FIRST** (coordinator report: the live site went "super laggy" right after
the "test-mode phases + projections + stats card" merge, commit `5c93b22`). Traced every new
network caller that commit introduced. Everything about test-mode clock phases and always-on
sandbox projections is gated behind `LG.testMode()` and provably makes zero real-league network
calls (re-confirmed by the new boot-hygiene test below). The one genuinely real-league-affecting
addition was the **player stats card**, reachable from any row anywhere (matchup/locker/FA/
trade-builder/claims): `D.gameLog(key)` called `D.weekStats(week, opts)` — Sleeper's archived
per-week endpoint, a **whole-league payload** — once per finalized week, with **zero caching and
zero in-flight dedupe**. A season N weeks deep fires N fresh multi-hundred-KB fetches EVERY
SINGLE TIME any card is opened; a curious user tapping through 3-4 players re-downloads the
entire season's archive 3-4 times over, saturating the browser's connection pool to
`api.sleeper.app` and starving the live-poll's own ESPN/Sleeper requests in the process. That
reads as a whole-page slowdown (not an isolated stats-card one) because the pool is shared —
exactly "taking a long time to load anything." **ROOT CAUSE, stated plainly: a missing cache.**
**FIX** (`lg-data.js`): `D.weekStats` now caches its resolved `Map` per `(season,seasonType,
week)` **indefinitely** — a finalized week's archived stats never change once Sleeper publishes
them — with an **in-flight-promise dedupe** (`D._weekStatsInFlight`) for concurrent callers of
the same not-yet-cached week. Only a REAL (non-null) result is cached, so a genuine outage can
still retry. `D.gameLog` needed no changes at all — it just calls `D.weekStats` per week, so it
inherits the cache for free, and so does `LG.finalizeWeek`'s backfill path and the new players
table below. A new `D.S.loopStarts` counter (incremented only where `D.start()` actually arms a
fresh loop, past its own `if (D.S.running) return` guard) makes the main poll loop's
single-instance behavior provable rather than argued from reading the guard clause — traced and
found NOT to be stacking (`D.start()` is called from exactly one place, `startData()`, itself
called exactly once per successful `UI.boot()`), but the coordinator explicitly asked for a
suite counter. **VERIFIED, before/after, via the suite itself**: opening one player's card
fetches each finalized week exactly once; opening a SECOND, different player's card reuses the
cache (0 new fetches); two gameLog() calls fired at the exact same tick share one in-flight
fetch per week (0 duplicates); an ordinary boot + League/Scores/Matchup navigation (never
opening a stats card, never visiting Moves) makes **zero** archived fetches; the main poll loop
arms exactly once and stays at 1 across repeated tab navigation AND a second full `UI.boot()`
call. This closes the exact "what does the existing boot-budget check NOT intercept" gap the
coordinator flagged — Section W's own budget test aborts every non-`BASE` request uniformly, so
it can't distinguish "0 Sleeper archived calls" from "20"; the new Section W2 actually counts
them by name via the existing `D.EP[name].n` endpoint-bookkeeping map.

**PLAYERS TABLE REBUILT — ESPN-style sortable stats** (the FA table from the prior playtest
batch restructured, per spec, `league.html` + `lg-ui.js`'s `renderMoves`). Columns: **PLAYER**
(pos badge + name + injury + NFL team, one cell) · **TYPE** (`FA`, or the owning GFFL team's own
`abbrev`/initials-fallback for a rostered player) · **OPP** (`D.oppForWeek`, `@`-prefixed away /
`vs`-prefixed home) · **STATUS** (live clock, `Final`, or a kickoff day+time — `D.S.games`, the
FULL-SLATE map `pollScoreboard()` already builds, so this works for ANY NFL team regardless of
fantasy-roster tracking) · **PROJ** (unchanged, `D.projFor`) · **SCORE** (this week's live
points, `D.S.players`) · **FPTS/AVG/LAST** (season total / per-game average / most-recent-week
points, derived from `D.gameLog` — cached client-side in `UI._faStats`, a persistent Map so a
sort click or "Show more" never re-derives a player already seen this session). ESPN fields we
can't source (%ST/%ROST/OPRK/+-) are omitted, not faked, matching the app's existing honesty
posture. **Filter: Available/All** toggle (`#faFilterChips`, default Available — same behavior
as before the rework: `D.searchFA`'s own `ownedKeys` exclusion, passed an EMPTY Set for "All" so
nothing new had to be added to `D.searchFA` itself) — a rostered row shows the owner's abbrev and
carries **no MOVE button** (claiming an already-owned player isn't a supported flow; that's a
trade, a different part of the page).
- **Every header is a real sort control** (`th.thsort[data-sort]`): first click on a column
  sorts it **desc** (active-column `.active` + a `▼`/`▲` arrow), a second click on the SAME
  column flips to **asc**. Numeric columns treat a missing value as `-Infinity` (sorts last on
  desc / first on asc, no special-casing needed); a tie (most commonly: two players with no
  season stats yet) falls back to Sleeper's own `search_rank` ascending — the spec's literal
  words ("falling back to search_rank when no stats"), generalized as the tie-break for EVERY
  column rather than just the default one. **Default landing sort = season FPTS desc.**
  Sorting runs over the WHOLE fetched pool (bounded by `faState.limit`, the same pool "Show
  more" grows — `D.searchFA` already slices to that limit before anything else touches it), not
  just whatever's scrolled into view; re-sorting an already-cached pool is fully synchronous
  (no re-fetch).
- **BUG FOUND BY THE SUITE, not by review**: the first comparator wrote `cmp = va - vb` for
  numeric columns. Two players who BOTH lack season stats both read `-Infinity`, and
  `-Infinity - (-Infinity)` is `NaN` in JavaScript — which is `!== 0`, so the tie-break to
  `search_rank` silently never fired for that (extremely common — every unstatted free agent)
  case, and `Array.prototype.sort`'s behavior with a `NaN` comparator return is unspecified.
  Fixed to an explicit `va < vb ? -1 : va > vb ? 1 : 0` (no subtraction at all) — the exact
  "two missing values should tie, not NaN" case is now what the fix targets. Caught by a
  three-real-value hand-check (`P. Passer`/`Q. Rival`/`T. Tight`'s season lines from
  `seedWithWeeklyHistory()`) whose ASC ordering came out with a real player's name missing from
  the expected tail-3 slot — a `null` where a name should have been, from the regex match
  failing against a row that had silently drifted out of position.
- **Sticky player column** (`position:sticky;left:0`, cheap since the table already lives in a
  `.panner`) so the name stays in view while the rest of the row pans on a phone; the wide
  10-column table (9 stat/info columns + a trailing blank MOVE-button one) never causes
  page-level sideways scroll — it pans inside its own `overflow-x:auto` container, the same
  house convention every other wide table here already relies on.
- **Lazy, batched, cached season-stat fetching**: `ensureFaStatsBatch(list)` kicks off
  `D.gameLog` only for keys not already in `UI._faStats`, in parallel, for the CURRENTLY
  RENDERED page of rows — "compute lazily per rendered page of rows," per spec. Because
  `D.weekStats` is now cached at the WEEK level (the perf fix above), a 40-row page with, say,
  4 finalized weeks costs **4 real fetches total**, shared across every row that needs those
  weeks, not 40×4. A `#faResults` still open when the batch resolves gets one repaint; nothing
  fires if the reader has since navigated away.
- **Stats-card, MOVE-button and claim-sheet behavior is UNCHANGED** — Section Y's whole
  player-card battery (matchup/locker/FA/trade-builder/claims, MOVE button, swap, Escape/
  backdrop) passed against the new table with no edits at all, which is the real proof: the row
  still carries `data-pk` (opens the stats card), the MOVE button still stops its own click from
  bubbling and still opens the claim/add flow — only its LOOKUP changed (from an index into the
  unsorted fetch order, `data-mi`, to reading the row's own `data-pk` and finding that key in
  the fetched `list` — since sorting reorders the DOM, an index-based lookup would silently grab
  the wrong player after any sort).

**Suite restaging, each with the reason recorded in place**: I0's browse-mode/PROJ-column
checks needed no changes at all (Available stays the default, matching pre-rework behavior
exactly); the phase-2 live-replay PROJ hand-check (Section X2, "F. Agent 6.0") targets `.faproj`
specifically now rather than the whole row's text, since the row carries many more numbers than
it used to. New Section **I2** (24 checks): column-set-in-order, Available/All toggle incl. "no
MOVE button on a rostered row," OPP `@`/`vs` both directions hand-checked against `sbFix()`'s
real slate, STATUS live-vs-upcoming, PROJ sort desc+asc (T. Tight is the fixture's only player
with a real projection — sorts to the very top on desc, the very bottom on asc), FPTS/AVG/LAST
sort desc+asc via THREE hand-computed real season lines compared by RELATIVE INDEX among the
three named players (not an assumed absolute leaderboard position — `seedWithWeeklyHistory()`'s
own default per-week bucket turns out to give several OTHER rostered players real season lines
too, e.g. W. Receiver/PHI D/ST/K. Kicker, discovered live via a debug dump when a first,
absolute-position version of this check failed for the wrong reason), PLAYER-name alpha sort
both directions across the WHOLE pool, and 390px pan-not-page-scroll incl. an assertion that the
`.panner` is doing REAL work (the table genuinely overflows it, not just present-but-unused).
Section W2 (12 checks, perf) inserted right after the existing boot-speed section W. One of
W2's OWN checks needed restaging in the same session it was written: "boot + League/Moves/
Scores/Matchup navigation makes zero archived fetches" was written BEFORE the players-table
rework existed, and the rework makes visiting Moves legitimately (and cheaply, thanks to the
cache) fetch archived stats — split into "League/Scores/Matchup alone: zero fetches" +
"visiting Moves: exactly one fetch per finalized week, and a second visit fetches nothing new."

**Scores-tab addendum** (coordinator, from a live screenshot: "ESPN LEAGUE (LIVE)" showing every
matchup 0-0/0.0, and no GFFL scores at all): (1) a **"GFFL — Week N" card, first on the tab**,
showing the family's own current-week matchups with live totals — built by literally reusing
`LG.gamesForWeek` + the league home's own `matchupCard()` function, so the numbers are provably
the SAME numbers the league home shows, not a second computation that could disagree; tapping a
card opens the real matchup view. `renderScores()` now fetches `LG.gamesForWeek(UI.week)` ONCE
and shares it between the new card and the pre-existing "mine/opp" NFL-game counts (was two
separate calls). (2) The **ESPN card now hides itself** when either (a) every matchup reads
`0-0` record AND `0.0` points on both sides (`ffAllZero` — preseason/pre-draft has no real
signal to show, not a broken card) or (b) `LG.testMode()` is true (a real ESPN scoreboard for a
2025 sandbox that was never drafted is meaningless there, unconditionally, even against an
otherwise normal scored fixture). Verified: the GFFL card renders with hand-checked totals
(`4.0 — 41.0`, identical to Section C's own league-home hand-check) and taps through to the real
matchup view; the ESPN card hides on an all-zero fixture (GFFL + NFL cards keep working); the
ESPN card hides in the test sandbox entered through the REAL `#testEnter` button + guided setup
(same proven path Section X uses), even fed a normal scored fixture, proving the hide is keyed
on test-mode itself and not on the fixture's own shape.

**Full battery**: `node tools/_verify-gffl.cjs` — **767/767, 0 page errors** (was 706 before this
batch — 61 net new checks: 14 in the new Section W2 perf-regression suite, ~11 folded into/
after Section S for the Scores-tab addendum, ~36 in the new Section I2 players-table suite;
two intermediate
runs during this session surfaced and fixed one real product bug — the NaN comparator above —
and one test-authoring bug — a bare `#faResults tr` selector silently matching the `<thead>`
row instead of the first body row, which produced a `waitForFunction` timeout rather than a
wrong assertion; every OTHER `#faResults tr` usage in the suite already used `.find()`/`.some()`
with a text filter, which is immune to the same trap since the header row's text never matches
a player's name). `netlify/functions/league.mjs` untouched — everything in this batch is
client-side (`lg-data.js`/`lg-ui.js`) plus the test file. No commits made.

**KNOWN / DEFERRED**: `D.EP`'s per-call bookkeeping (`n`/`okN`/`status`/etc., the health-page
data source) accumulates for the life of a tab exactly as it always has — the perf fix caches
the underlying FETCH, it doesn't touch that bookkeeping map, so a long session's health page
still shows an honest, ever-growing call count even though most of those calls after the first
per-week one are now free; the "Show more" + re-sort interaction (growing the pool, then
sorting the LARGER pool) is exercised functionally by the alpha-sort test but the suite's own
`slpPlayersFix` pool (19 players) never actually exceeds the default 40-row limit, so "Show
more" itself doesn't trigger in that specific check — the underlying mechanism (re-fetch a
bigger `list`, re-sort the same way) is unchanged code shared with every other sort, so this is
a coverage gap in breadth rather than a known-risky path; and OPP/STATUS still only ever read
"if-known" (this app tracks no historical NFL schedule), so a player whose NFL team isn't on the
current week's slate at all (a bye, or simply not tracked) reads "—" in both columns, honestly.

## 🚨 GFFL — THE EMPTY-LEAGUE BUG: emptiness must be the league's own answer (2026-08-08, UNCOMMITTED)

The live site opened on the first-run **"Import the league from ESPN"** card against a Firestore
collection that has eight teams in it, and the import then "wasn't working". Files:
`assets/league/lg-{core,ui}.js` · `league.html` · `tools/_verify-gffl.cjs` (767 → **818**).
`lg-data.js` and `netlify/functions/league.mjs` untouched. `node --check` clean on all three JS
files. No commits, no push.

**THE DATA WAS NEVER THE PROBLEM — I checked it first.** A Firestore REST read of
`gffl_fam2jan2g` with nothing but the public web key returns **29 docs: 8 × `kind:"team"`,
8 rosters, 8 history seasons, sched, settings, claims, projsnap, chat** — present, well-formed,
and readable unauthenticated. (`gffl_fam2jan2g_t25`, the 2025 sandbox, holds another 56.) So the
league store had the league; the app's read path failed to deliver it, and then **misread its own
silence as an answer.**

### Root cause: NOTHING distinguished "the league says there are no teams" from "we never heard back"
`renderLeague()` branched on `LG.teams.length === 0` alone, and `LG.teams` is whatever
`LG.db.list("team")` last returned. Two ways to get an empty list that means nothing at all, and
BOTH end on the first-run card:
1. **The silent local fallback.** `LG.backendReady`'s catch dropped to the localStorage backend
   on ANY failure — a blocked/failed gstatic ESM import, an ad-blocker, an offline first paint, a
   cold IndexedDB — and said so to nobody. A device that has never cached this league then reads
   zero docs, truthfully, from the wrong store.
2. **A cache-served empty QUERY.** `getDocs()` with the default source tries the server and falls
   back to the cache, and — unlike `getDoc()` — **a query never rejects for a cache miss**: an
   empty cold cache is byte-identical to "a query with zero results" (`snap.empty` true,
   `metadata.fromCache` true). So even a working cloud path could report an empty league.

This is the `serverConfirmed` lesson index.html learned twice with the goat herd, in a new place:
**emptiness must be SERVER-CONFIRMED before any "let's set this up from scratch" UI appears.**
Offering the import there is the worst possible answer — it tells an owner their league doesn't
exist, and every write it then makes lands in whatever degraded store we fell back to.

### The fix, in four parts
- **`LG.backendDegraded` / `LG.backendError` / `LG.dataConfirmed()`** (lg-core): true until a real
  backend read proves otherwise. `initCloud()` was extracted from the `backendReady` IIFE so the
  same path can be re-run; it clears the flag only after the reachability probe genuinely
  answers. The reason is kept verbatim and **printed on screen**, so the next report identifies
  itself instead of needing this forensics pass again.
- **The cloud reader confirms its own negatives.** An empty `getDocs` that came `fromCache` is
  re-asked with `getDocsFromServer` (and a missing `getDoc` with `getDocFromServer`); if that
  fails the session is marked degraded rather than reporting absence. A server-confirmed read
  clears the flag again — one blip must not brand a whole session.
- **`LG.teamsConfirmed`**, recorded inside `loadTeams()` **at read time** (not re-read at render
  time, so a later unrelated degradation can't retroactively change what an already-answered read
  meant). `UI.boot()` refuses to route into the claim screen or first-run on an unconfirmed empty
  read — checked BEFORE those branches so no hash (`#moves`, `#rules`, …) slips past — and
  `renderFirstRun()` carries the same guard as a second line.
- **`renderOffline()`** — "Couldn't reach the league", the reason, "your teams, rosters and
  results are all still there", a **Retry**, and no nav. Retry re-probes the existing cloud handle
  first (if only the network was down, re-importing the ESM modules is wasted work) and falls back
  to a full re-init, then drops every cached read — a cache filled while degraded is a cache of
  answers nobody could confirm.

**EXEMPT, deliberately: the 2025 test sandbox.** Its whole premise is a throwaway namespace that
STARTS empty and is built by its own idempotent, resumable wizard, so "empty" there is the
expected state rather than a claim about the family's league — and being wrong about it costs
nothing (Reset + re-run is the normal flow). Without the exemption, entering the sandbox on a
degraded backend showed the outage card and the wizard could never run. The outage card still
carries an **Exit the 2025 test season** button when the flag is set, so a degraded sandbox is
never a dead end (the Exit button otherwise lives on a Rules page you can't reach from there).

### Two more real defects the work turned up
- **A THROWING boot read left the page on "Loading the league…" forever.** `UI.boot()`'s
  `Promise.all([loadRules, loadTeams, loadSchedule])` had no catch and `league.html` called
  `LG.ui.boot()` without one either, so a backend that *rejects* mid-boot (a dropped connection, a
  Firestore error) produced an unhandled rejection and a permanent placeholder. Both now end on
  the same honest outage card. **Found by the new suite, not by reading** — Z3's
  "reachable-then-broken backend" case.
- **`knownAbsent()` could derive absence from an unconfirmed snapshot.** The negative-absence
  shortcut answers `get()` straight out of a cached `list()`; a list taken while the cloud was
  unreachable can be an empty offline-cache answer, which would make every doc of that kind read
  as missing for the life of the tab. It now refuses to answer while a CLOUD session is degraded.
  The local backend is exempt on purpose — localStorage answers truthfully, so an empty local list
  really does mean "not on this device", and the perf shortcut every warm view depends on is
  intact (section P still measures zero extra reads). The quiet background list-refresh also
  refuses to REPLACE real cached rows with an empty result from a read that went degraded — better
  the last known-good league than a blank one behind the user's back.

### "The import isn't working" — it was failing silently, in two different ways
- Every importer opened with `$("#importOut").innerHTML = …`, which **throws on a null element**.
  The first-run card calls `importFromEspn()` straight after `UI.show("rules")`; one
  missing/renamed container and the tap does nothing, forever, with no error a person can see.
  There is now a single `importOut()` helper that creates the container if the view doesn't carry
  one and can never return null.
- **The APPLY half had no catch at all.** `saveRules`/`saveTeam`/`saveRoster`/`db.set` — exactly
  the calls a degraded backend rejects — left the button dead and the screen unchanged. Every
  import write path now routes failures through `importFail()` (a real error card naming the
  reason + a toast), the Apply button disables itself while it runs, and both taps that START an
  import catch a throw instead of dropping it on the floor. The test-season wizard got the same
  treatment: a thrown write used to leave "Starting…" up forever.

### Test-mode namespace audit (the second suspect) — clean, and now asserted
Every `LG.COLL` / `LG.SEASON` consumer reads them AT CALL TIME (`local.key` is an arrow, every
cloud method takes them per call, `rosterId`/`weeklyId`/`claimsId`/`bracketId` are all functions),
so nothing captures a stale namespace. `applyTestModeVars()` always derives from `LG.REAL_COLL`,
never from the current value, so it is idempotent and can't double-suffix; it runs at module eval
**before `LG.db` exists**, so a returning visitor's flag applies from the very first read;
enter/exit/reset each clear every cache and hard-reload. Nothing here explained the live bug, and
section Z7 now pins all of it — including a genuine stale-flag boot into the sandbox and an exit
that reads the real league on the very next boot.

### Suite: 767 → **818/818, 0 page errors**
New **section Z** (51 checks), one block per failure shape, plus a reusable `armFakeCloud()`
harness (the section-W setter technique, generalized) and a tolerant `waitOr()`.
- **Z1** cold cloud boot — data in the cloud, NOTHING in local storage, 250ms/call: a loading
  state, then the real league, and the first-run card **never** appears, not for one sampled frame.
- **Z2** THE BUG — cloud unreachable, nothing local: the outage card, never first-run, with the
  flags and the recorded reason. **Z3** reachable-then-broken, plus a Retry that fails honestly
  and then recovers in place. **Z4** a CONFIRMED-empty backend still offers first run (setup must
  keep working). **Z5** a backend WITH teams can't reach first run via any hash. **Z6**
  `knownAbsent` before/after degradation. **Z7** the test-mode round trip. **Z8/Z9** import
  failures visible, `#importOut` never null, both taps caught.
- **VERIFIED PRE-FIX by stashing `lg-core.js`/`lg-ui.js`/`league.html` back to HEAD and re-running
  the same suite: 792 pass / 26 fail, and every one of the 26 is in section Z** — so the fix is
  what closes them and the B2 restage isn't masking anything (all 767 pre-existing checks pass on
  both sides). Among the 26: all three "…NOT the first-run import card" checks, "the honest
  couldn't-reach card", the whole retry cycle, `knownAbsent`-while-degraded, and every
  import-visibility check. Pre-fix, Z1's cold-cloud boot ALSO shows the first-run card — old
  `backendReady` unconditionally stamps `backendMode = "local"` when the gstatic import fails,
  even with a working backend installed underneath, which is the exact "silent local fallback →
  empty → first-run" shape reproducing with the league's data sitting right there.
- **RESTAGED, with the reason recorded in the file: B2 only.** "First run — empty league → import
  → claim" used to run on the LOCAL backend, which the app now (correctly) refuses to take an
  empty read from; it arms an EMPTY fake cloud instead, so the premise it always relied on —
  *the backend says there are no teams* — is now stated honestly rather than assumed. The
  behaviour under test is unchanged.

**TEST GOTCHAS worth keeping** (both cost a run): `document.body.textContent.slice(0, 60)` never
reaches `#main` — the sticky header and the 8-entry nav contribute ~60 characters of their own
first, so a short slice silently tests nothing; read the element you mean. And the LOCAL backend
lists by key PREFIX, where `lg_gffl_<fam>_` is itself a prefix of `lg_gffl_<fam>_t25_`, so a
real-collection list also picks up sandbox docs — a harness artifact of localStorage (Firestore
collections are genuinely separate), already documented above `snapshotRealDocs`.

**KNOWN / DEFERRED**: the outage card is only reached when the league is EMPTY — a degraded
session that still has cached rows renders them (stale data beats no data), it just can't be
confirmed; `LG.backendDegraded` starts `true` and is only cleared by a real answer, so anything
reading `dataConfirmed()` before `backendReady` settles sees false by design; and the deployed
site is not observable from here, so which of the two unconfirmed-read shapes the user actually
hit is still unknown — the card now prints `LG.backendError`, which will say so the next time.

## 🏈 GFFL — the matchup row finally lays out (2026-08-08, ESPN-reference alignment fix)

User screenshot: the left team's players didn't line up with the right team's — left half read
name→points top-to-bottom, right half read points→name. ROOT CAUSE: `.pcellgrid`/`.pinfo`/`.ppts`
(the item-3 "mirrored 3-column grid" markup) shipped with **no layout CSS at all** — the same
unstyled-new-markup family as `.scgrid` — so both halves stacked their two divs in raw DOM order.
Files: `league.html` (CSS) + `assets/league/lg-ui.js` (statSummary) + suite (818 → **822**).
- **Flex row restores the design**: `.pinfo` takes the slack, `.ppts` is a fixed 56px column
  (42px ≤560px) whose numbers sit on the INNER edge of both halves, hugging the slot badge.
  Per the ESPN reference only the column ORDER mirrors — text stays LEFT-aligned on both sides,
  so the right team's names all start at one consistent x. `table.mutable td` vertical-align
  top → middle; `.totalrow` points 17px. Dead `.pwrap` rules removed (grep: zero users).
- **`td.slotcell`, not `.slotcell`** — `.tbl td`'s `text-align:left` (0,1,1) outweighed the
  class selector (0,1,0), so the slot badge label had rendered left-of-center since the day it
  shipped. Same lesson as `[hidden]`: a rule that LOOKS applied can be losing the cascade —
  the suite asserts the COMPUTED style now.
- **ESPN stat summary line** (`statSummary` in lg-ui.js): a compact position-aware line under
  the meta line ("150 pass yds, 1 TD, 1 INT" / "6 rec, 84 yds" / "14 PA, 1 sack" / "80 FG yds,
  1 XP"), built from `row[row.src].stats` — the SAME picked-source stats `row.pts` was scored
  from, so the line can never disagree with the points beside it. Returns "" until any stat
  lands, so pre-game rows stay two lines.
- Suite: 4 new checks in the matchup section, all GEOMETRY not markup — name/points render
  BESIDE each other on both halves (vertical-band overlap), points hug the inner edge mirrored,
  slot label computed text-align center, and the Passer statline exact. The old shots sweep's
  "zero teams on the local backend → first-run card" scenario is superseded by the
  server-confirmed-emptiness fix (first-run needs a CONFIRMED empty read now).

## 🏈 GFFL — THE SANDBOX IS GONE; THE APP *IS* WEEK 1 OF 2025 (2026-08-08, UNCOMMITTED)

User: *"the sandbox isn't working, I want to ditch that and I just want you to load into the app
all the data we need to completely simulate week 1 of the 2025 season, prior to any games
starting… see all the rosters as though we just finished the 2025 draft, see all the nfl matchups
coming up that weekend and all the projections (if those dont exist anymore just make some up)."*
Files: `league.html` + `assets/league/lg-{core,data,ui}.js` + `tools/_verify-gffl.cjs`.
**`netlify/functions/league.mjs` was NOT touched — the existing `lg_espn_rosters_season` action
already had everything the auto-setup needed, including its past-season `scoringPeriodId=0` retry
ladder.** `node --check` clean on all four JS files. No commits, no push.

### The whole sandbox is deleted, not disabled
Gone from the shipping files: the `_t25` collection-suffix switching (`applyTestModeVars`,
`LG.REAL_COLL/REAL_SEASON/REAL_SEASON_START`, `enterTestMode`/`exitTestMode`/`resetTestMode`,
`LG.testMode()`), the switchable clock (`TEST_PHASES`/`testPhase`/`setTestPhase`/`TEST_NOW`), the
per-mode identity keys (`gffl_team_t25`/`gffl_who_t25` — the suffixing is gone, so a claim is one
key again), the localStorage flags (`gffl_test2025`, `gffl_test2025_phase`, now dead keys on
family devices, which is harmless), the persistent test banner, the Rules-page Enter/Exit/Reset
buttons and the "Test-season clock" card, the Moves-page "Testing week" switch, the guided wizard
(`testSeasonNeedsSetup`/`runTestSeasonSetup`), the whole live-replay layer in lg-data
(`testLiveSync`/`testTeamBucket`/`testPlayerScale`/`testEnsureProj`/`testProjCache`), the outage
card's test-mode exemption and Exit escape, and the Scores tab's test-mode ESPN-card branch.
**GREP EVIDENCE, and the suite asserts it too (section X6):**
`grep -n "testMode|TEST_PHASES|_t25|test2025|testLive|testProj|testWk|testSeason|testTeamBucket|
testPlayerScale" league.html assets/league/lg-*.js` → **zero hits**. Four historical mentions of
the word "sandbox" survive, all inside the new flag's own header comment explaining what it
replaced; they name no removed identifier. `ffdraft.html`, `sports.html`, `index.html` and
`netlify/functions/sports.mjs` were not opened. Net **−273 lines** across the three app files.

### ONE switch, and the arithmetic behind the pin
```js
const SIM_2025_DEFAULT = true;   // ⭐ set to false for the real 2026 season — and nothing else
LG.SIM_2025 = qs.get("sim") === "0" ? false : qs.get("sim") === "1" ? true : SIM_2025_DEFAULT;
```
When on: `LG.SEASON = 2025`, `LG.SEASON_START = "2025-09-02"` (the Tuesday before the real Sept-4
opener), and `LG.now()` returns a **fixed** `LG.SIM_NOW` = Thursday **2025-09-04 09:00
America/Chicago**. No localStorage, no per-device state — a code-side constant, so every family
device is looking at the same moment. `?sim=0` / `?sim=1` is a QA/preview override with the same
posture as `?fam=`: never persisted (asserted — nothing matching `/sim/i` lands in localStorage),
and it survives `location.reload()` because it lives in the query string.
**The instant is chosen so two things are true at once, both asserted rather than eyeballed:**
`LG.currentWeek() === 1` (it sits inside week 1's own Tue-05:00→Tue window, and the night's opener
has not kicked off), AND week 1's default Wed-8am waiver deadline has already passed, so **free
agency is OPEN** — `LG.faAdd` is exercisable the moment the app loads, and the Moves page really
renders "Free agency is open" rather than the pre-deadline claims-process line.

### It runs in the REAL collection, and that is safe by construction
Not a second collection — **every per-season doc id this app mints is already season-scoped**
(`roster_<season>_*`, `weekly_<season>_*`, `claims_<season>_*`, `sched_<season>`,
`bracket_<season>`, `projsnap_<season>_*`), so the family's existing 2026 docs simply become
invisible. Nothing is deleted; flipping the flag back brings them all straight back (the suite
asserts no 2026 doc is written during a replay boot). Season-NEUTRAL docs (`team_<id>`, `settings`,
`chat`, `tx`) are deliberately SHARED: **the 8 real teams already in Firestore are the replay's
teams**, so a claim carries across and nobody re-picks.

### Auto-setup: zero taps, any device, deterministic
On boot, if the week-1 2025 rosters are absent, `runSimSetup()` runs itself: `lg_espn_rosters_
season {season: 2025}` → `saveTeam` per team (MERGE — they already exist, so this only refreshes
names) → `applyImportedRosters(j, 1)` (post-draft rosters at WEEK 1 — starters slotted, an OUT
player on IR; `LG.ensureRoster` copies forward lazily from there) → generate + save the season
schedule → repaint. A visible progress card carries it; a failure paints a real error card naming
the reason with a working **Try again**.
- **NOT commissioner-gated, on purpose** — the user wants the season to just be there, and gating
  it would leave a kid staring at an empty league until Dad opened the app. Two devices racing it
  is harmless because every write is deterministic: the rosters come from one ESPN import, and
  the schedule is generated from the team ids **sorted** (`LG.teams`' own order comes off a
  backend `list()` and is not stable between devices; the circle method is order-sensitive, so
  feeding it an unsorted list would let two devices generate two different seasons).
- **The confirmed-emptiness fix is NOT weakened.** The setup check sits *after* the
  `!teams.length && !teamsConfirmed → renderOffline()` guard, so an unreachable backend still gets
  the honest outage card and never a setup run that could only fail. A CONFIRMED-empty backend
  gets the setup (it imports the teams too) instead of the first-run import card.
- **`UI._simSetupDone` is a LOOP GUARD, not a cache.** `renderSimSetup()` ends by calling
  `UI.boot()`; if a run finished while `simNeedsSetup()` were still true — the ESPN import
  legitimately returning fewer teams than the league carries, say — the two would bounce off each
  other forever with the setup card on screen. One successful run per page load; a genuinely
  partial seed resumes on the NEXT boot, which is the contract the function documents.
- `simNeedsSetup()` reads rosters via `loadRoster`, never `ensureRoster` — ensureRoster copies a
  previous week forward and WRITES, which is exactly wrong for a question that must not have side
  effects.

### The NFL slate: real week-1 2025 games, presented as upcoming
`pollScoreboard`'s bare endpoint means "the current week", so the replay asks for an explicit
slate instead: `/scoreboard?dates=2025&seasontype=2&week=1`. Every event is presented **state
"pre", score 0-0**, with its REAL kickoff datetime and TV network intact — not a fiction: those
games genuinely were upcoming at the pinned instant. Fetched **once per session and cached** (it
is static history; the poll loop must not hammer it), and Sleeper live-stat polling is off
entirely — before kickoff there are no stats to have.
- **`D.S.espnWeek`/`D.S.slpWeek` are deliberately never set** (the latter needed a guard inside
  `initSleeper`, which otherwise records the REAL current week from `/state/nfl`). So
  `D.engineWeek()` stays null and the week-provenance guards from the adversarial review keep
  `maybeAutoFinalizeWeeks` and the stale-week alarm silent for the whole replay. `finalizeWeek`
  also carries an explicit belt-and-suspenders refusal (`reason: "sim-replay"`) on the LIVE path —
  nothing has been played, so it could only ever write a week of zeroes into a write-once doc. The
  archived-stats BACKFILL stays available: that is a deliberate commissioner action against real
  numbers.
- **Health reads "dual"/nominal, not an outage** — `failN`/`lastOk` are never touched and
  `anyLive()` is false, so `bad()` short-circuits on both sides. Nothing is failing; there is
  simply nothing to poll.
- `D.oppForWeek` special-cases week 1 under the replay (it keys on `engineWeek`, which is now
  null by design), so the players table's OPP column works.
- The Scores tab shows the GFFL week-1 card, then the real slate grouped by day with kickoff
  times and networks and the MINE/OPP starter counts; the live **ESPN fantasy card is hidden**
  (`LG.SIM_2025`) — a live fantasy scoreboard inside a 2025 replay is meaningless.

### Projections: real if they exist, an honest derivation if not
`D.simEnsureProj()` fills one session cache: **try** Sleeper's forward-projections endpoint for
2025 week 1; if it comes back empty — the expected reality for a season this far gone — **derive**
each player's projection from their REAL week-1 2025 final line, scored through the league's own
`D.score`. Same raw pid→stat-row shape either way, so `D.projFor` needed no branching; only the
SOURCE differs, and a real final is the most plausible possible estimate *and* deterministic.
Rounded to 1dp — an estimate should not wear two decimals of false precision. It reaches the
matchup header totals + per-row proj, the win-probability bar, the locker's lineup rows, and the
players table's PROJ column and its sorting.

### TWO REAL BUGS the replay exposed, both fixed
1. **`D.liveProj` returned 0 for every player with no live row.** It resolved a player's NFL team
   from `D.S.players` — which is only ever populated by polling stats. The replay polls none, so
   the `D.S.games` lookup missed, the "hasn't kicked off → use the projection" branch never ran,
   and the matchup page showed **proj 0.0 for everybody** while the locker (which calls
   `D.projFor` directly) showed the right number. It now falls back to `D.metaForKey(key).team`,
   which resolves from the roster or the Sleeper directory. **Not sim-specific**: that is the
   state of any board before the first stat of the week lands.
2. **The projection repaint could bounce a brand-new owner off the claim screen.**
   `simProjEnsureAndRepaint` fired `UI.show(UI.view)` when projections landed — and `UI.view`
   defaults to `"league"` at module load and is only ever written by `UI.show`, so on the gate,
   the claim screen, the setup card or the outage card it still read "league". The moment
   projections resolved, the LEAGUE HOME was painted over them: a device with no claimed team
   landed in a league it hadn't picked a team in, and a setup-FAILURE card was wiped before
   anyone could read it (both symptoms, one line). It now keys on `main().dataset.view` — what is
   actually painted, stamped by every one of those screens — checked at call time AND again on
   landing. Found by instrumenting `UI.show` with a stack capture, not by reading.

### One more honesty fix, found by LOOKING at the plates
The league home's `#healthChip` read **"● live"** next to a week that has not kicked off. It is
the DATA-SOURCE health chip, not "a game is live" — but under the replay there is nothing live to
be healthy about (one static historical slate, no stat polling at all), so beside the replay
banner it was a small lie. Same chip, same ok/warn/bad states, honest word: **"● replay"**.

### The banner
One sticky line under the header, always on while the replay is: **"2025 SEASON REPLAY — Week 1,
before kickoff. Projections are estimates."** No emoji (the app-chrome rule). `#simBanner` reuses
the old test banner's slot/styling, including the `[hidden]{display:none}` restatement the house
lesson requires. Asserted present, correctly worded and non-overlapping at 390px and 1440px.

### Suite: 822 → ****837/837****, 0 page errors
- **SECTIONS X AND X2 DELETED OUTRIGHT** (449 lines) — they tested the sandbox's collection
  isolation, guided wizard and clock phases, none of which exist. **Z7 deleted** for the same
  reason (it was 100% `_t25` namespace round-tripping; there is no second collection to isolate
  any more). The dead `snapshotRealDocs`/`snapshotTestDocs` helpers went with them.
- **NEW section X** ("the 2025 week-1 replay", 99 checks) is the ONLY section that boots
  WITHOUT `?sim=0` — i.e. exactly as a family device will. It covers: the flag driving
  season/start/`now()`/`currentWeek()===1`/waivers-open (and `?sim=0` reverting all of it, and
  persisting nothing); auto-setup on a teams-present-rosters-absent backend running to completion
  and writing week-1 2025 rosters + a 14-week schedule + nothing under 2026; a second boot costing
  **zero** roster/schedule/team writes (counted at the backend, not the UI); a partial seed
  resuming; a setup failure being VISIBLE with a working retry; a confirmed-empty backend getting
  the setup rather than the first-run card while an UNCONFIRMED one still gets the outage card;
  the historical-slate request carrying `dates=2025&seasontype=2&week=1` and rendering as upcoming
  games with kickoffs and networks; `engineWeek` staying null with no auto-finalize and no
  stale-week card; both projection paths hand-computed exactly (derived **10.0** for P. Passer
  from 150yd·1TD·1INT·1×2pt, **6.0** for an unrostered free agent, and **18.0** on the
  real-projection path so the two can never be confused) on the matchup, locker and FA table; the
  banner at both widths; and the sandbox's absence from the shipping files.
- **RESTAGED, each with its reason recorded in place:** every pre-existing section's boot now
  carries `?sim=0` via a `SIMOFF` constant (they were all written against the real 2026 league —
  2026 seeds, 2026 hand-computed expectations); section Q's Rules-copy check (the old sentence
  explained the test-run importer as "2026 is pre-draft, so seed from 2025" — the replay now does
  that automatically, so the copy, and the check, describe what the button is actually for now);
  section S's ESPN-card-hidden-in-the-sandbox block (deleted — the same rule keys on `LG.SIM_2025`
  and the check moved into section X, where it boots the replay the way a device really will);
  W2's narration of what else shipped in that commit.
- **Fixture changes, all inert for the sections that existed:** `fixture.test2025Rich` →
  `rich2025` (same 2-team past-season roster doc); new `fixture.simProjReal` (default FALSE = the
  expected reality, which is what makes the DERIVED path the default under test); the 2025
  forward-projections fixture; a historical `sbSim2025Fix()` slate (5 real week-1 games across
  three days, every competitor carrying a real FINAL score in the document — which is what makes
  "the replay presents them all as 0-0 upcoming" a real assertion rather than a tautology) served
  only to a URL carrying `dates=`, with every such URL recorded so the params can be asserted; a
  **season-2025-only** week-1 stats overlay giving one unrostered player a real line (added as an
  overlay precisely so section I2's own sorting expectations, which run at season 2026, cannot
  move); and a `__fakeCloudFailWrites` switch on the shared fake cloud (reads fine, writes reject
  — the exact shape a degraded backend presents to a setup run).

### TEST GOTCHAS worth keeping
- **The setup card is genuinely fleeting on an instant backend** — it can be gone before a
  post-navigation query runs, so "did the user see a progress card?" is answered by a
  MutationObserver installed at document-start that records whether it was EVER in the DOM. That
  is the real question and it is immune to how fast the run happens to be.
- **The local backend is a DEGRADED fallback by definition** (`markDegraded` on the Firebase
  import failure → `teamsConfirmed` false), so an empty read there is correctly an outage, not a
  new league. Any check about a CONFIRMED-empty league must arm a fake cloud, exactly as section
  B2 already does.
- **A day-grouping assertion cannot be an exact count**: the label comes from
  `toLocaleDateString` in the BROWSER's timezone, and a Thursday-night/Sunday-night kickoff lands
  on a different calendar day under UTC than under Central. Assert that grouping happened and
  that two same-window games share a group.
- A boot helper that waits on `LG.rules` cannot boot a DEGRADED page at all (rules are never set
  — boot catches and renders the outage card). Wait on the hook, then on each check's own outcome.

### KNOWN / DEFERRED, and the LIVE checks this sandbox could not do
**ESPN and Sleeper are egress-blocked from this environment, so the fixtures carry the whole
burden.** Two things must be spot-checked on the real host after deploy:
1. **The historical scoreboard params.** `GET https://site.api.espn.com/apis/site/v2/sports/
   football/nfl/scoreboard?dates=2025&seasontype=2&week=1` must return the real week-1 2025 slate.
   In the app: open the Scores tab and confirm the games are the real ones (DAL@PHI Thursday, the
   Friday game, the Sunday slate) with sane kickoff times and networks. If ESPN wants
   `dates=20250904-20250909` instead of a bare year, that is the ONE line to change
   (`D.simScoreboardUrl`).
2. **Whether Sleeper still serves 2025 week-1 projections.** `/projections/nfl/regular/2025/1` —
   if it does, projections read `source: "projection"` and are real; if it is empty, the derived
   path fires. Either is correct; check `LG.data.S.simProj.source` in the console, and sanity-check
   a couple of numbers against what those players actually did in week 1.
Also deferred: the auto-setup imports whatever teams ESPN returns, so if the real import ever
returns fewer teams than the league carries, that boot's `simNeedsSetup()` stays true and the
setup re-runs once per page load (bounded by the loop guard, never a loop); and the replay's
Scores tab shows the GFFL card for week 1 only, since that is the only week with a slate.

## 🏈 GFFL — player names are ALWAYS "J. Surname" (2026-08-08)

User: *"player names should always be first initial and then last name."* Files:
`assets/league/lg-{core,ui}.js` + suite (841 → **859**). `league.mjs`/`lg-data.js` untouched.

**A DISPLAY formatter, deliberately not a data rewrite.** `LG.shortName(name)` (lg-core, beside
`fmtPts`) is applied at every render site through `escn()` in lg-ui. Stored rosters, the tx log's
own `addName`/`dropName` records, every already-written history doc, and the AI-read wire payload
all keep FULL names — so nothing that MATCHES on a name breaks (`askAiRead` keys the model's reply
off the names it sent), and history written before today shortens on screen too.
**Rules, each one asserted:** a D/ST is a TEAM not a person (`Bills D/ST` whole) · idempotent
(`J. Allen` untouched) · suffixes ride along (`Kenneth Walker III` → `K. Walker III`,
`Marvin Harrison Jr.` → `M. Harrison Jr.`) · surname PARTICLES stay with the surname
(`Amon-Ra St. Brown` → **`A. St. Brown`**, not the wrong `A. Brown`) · the surname is otherwise the
LAST token, which is what makes a double first name (`Ray Ray McCloud`) come out `R. McCloud`
rather than `R. Ray McCloud` · single tokens / empty / null are safe.
**Sites**: matchup starters + bench, the feed, the player stats card heading, the FA table (and
its PLAYER **sort key** — sort by what you see, so an alpha sort groups by surname), claim sheet +
its drop picker, trade-builder chips, claims/trade inline name buttons (one choke point:
`pcName`), waiver result lines, locker lineup rows + a rival's read-only roster table, the lineup
swap sheet, the AI read's rendered lines, and `txSentence`. Two SYS-POST sentences in lg-core
(waivers processed, trade executed) bake the short form in at WRITE time — a stored sentence
cannot be shortened later, and it is prose, not a record anything matches on.
**THE SUITE COULD HAVE PASSED WITH THE FORMATTER DOING NOTHING**: every pre-existing fixture
player is already written short (`P. Passer`, `Q. Rival`). New **section N** therefore seeds its
own roster of FULL names and asserts the rendered DOM — `J. Passer` present *and* `Joshua Passer`
absent, plus the suffix/particle cases in a real row, the D/ST row still whole, the player card
heading, a tx sentence, and that `UI._rosters` still holds the full name (display-only proven, not
asserted in prose). Plus 10 unit checks on the formatter itself.
**Restaged, each with its reason in place:** the locker tx check (`Someone New` → `S. New`), and
the recent-moves trimming fixture — `"Add Number <i>"` was never a plausible player name and reads
as `A. 10` once shortened, so it became ten real-shaped names with distinct surnames (`J. Jones`
present, `A. Ashby`/`B. Baker` trimmed), which keeps the ordering assertion legible AND exercises
the shipped format. A third reference to the old fixture string in a `waitForFunction` came with
it — a stale literal there fails as a 5s TIMEOUT + suite crash, not as a readable assertion.
**KNOWN**: the player stats card follows "always" literally (ESPN shows the full name there) — one
line if the family wants the card full; and `sports.html`'s ESPN-fantasy viewer is a separate app
surface, deliberately not touched.

## 🩹 GFFL — the Firestore IndexedDB assertion bug heals itself (2026-08-08, live desktop report)

User: the league worked on their phone and dead-ended on their desktop showing the outage card
with **"FIRESTORE (10.12.2) INTERNAL ASSERTION FAILED: Unexpected state"**. Files:
`assets/league/lg-core.js` + suite (859 → **875**).

**THE OUTAGE CARD WAS RIGHT ABOUT THE FACTS AND WRONG ABOUT THE ANSWER** — and it named its own
cause, which is exactly what the 2026-08-08 server-confirmed-emptiness fix built it to do. That
assertion is a long-standing SDK bug in the PERSISTENT (IndexedDB) cache layer: a property of
**that browser profile's stored database**, not of the network or the league. Same account, same
code, clean IndexedDB on the phone → fine; poisoned IndexedDB on the desktop → every read throws.
The read throwing is what (correctly) stopped the app calling the league empty, but "couldn't
reach the league" is the wrong conclusion when the league is perfectly reachable and only the
local cache is broken. **The device's only way out was clearing site data, which no family member
should ever have to know about.**

**HEAL, DON'T DEAD-END.** Every cloud read/write now goes out through a wrapper: on this specific
failure the session re-inits on an **in-memory cache** and re-runs the same call once, so the
reader never sees it. Details that make it safe rather than hopeful:
- **A different Firebase app name** (`gffl-mem`) for the healed handle — `initializeFirestore` may
  only be called once per app, so healing in place would throw "Firestore has already been started".
- **`healed` latches once per session**, and the retry dispatches through the module-level `cloud`
  (which the re-init repoints), so it cannot loop.
- **The poisoned database is terminated + cleared** best-effort, so a later load can have
  persistence back; both calls legitimately fail in plenty of states and neither is allowed to
  stop the re-init that actually unblocks the reader.
- **A suppression stamp** (`gffl_nopersist`) makes the very next load skip the poisoned cache
  outright — and **expires after 7 days** rather than punishing the device forever.
- **A global `unhandledrejection`/`error` listener** stamps too: the SDK can throw this from its
  own internals, off any promise we awaited. We cannot retry a call we never made, but we can
  make sure the next load doesn't repeat it.
- **The classifier is narrow** (`/INTERNAL ASSERTION FAILED|Unexpected state/i`): an ordinary
  failure still reaches the honest outage card with its own reason. Asserted both ways.

**THE SEAM**: `LG._fbLoad` is now `LG._fbLoad || (real dynamic imports)` — a pre-seeded
`window.LG = { _fbLoad }` wins, because lg-core does `window.LG = window.LG || {}`. That one `||`
is what makes the bug testable at all: it only exists across a real module boundary, and gstatic
is blocked in every suite page. (First attempt used an `Object.defineProperty` setter trick on
`window.LG` and silently never engaged — the seam has to be cooperative, not ambushed.)

**Suite section AB** drives the REAL failure through a fake Firestore whose persistent handle
throws the genuine assertion string and whose memory handle works: a first boot tries persistent →
heals to memory → ends in confirmed CLOUD mode → **never shows the outage card** → terminates and
clears the poisoned db → stamps; a second boot goes STRAIGHT to memory and heals nothing; the
stamp expires at 7 days; and an ordinary failure still produces the outage card. Its own fake
initially ignored the `where` filter (so `LG.teams` counted the settings doc) — fixed in the
fake, not by weakening the assertion.

**KNOWN / DEFERRED**: `index.html`'s own cloud backend uses the same `persistentLocalCache` and
could hit the same bug on a poisoned profile — it is a DIFFERENT Firebase app name and therefore a
different IndexedDB, and nothing has been reported there, so it is untouched; the same heal is a
straight port if it ever bites. A healed session runs without an offline cache (slightly slower
cold paint, no offline reads) until the stamp expires — the accepted cost of working at all.

## 🌐 GFFL — THE FIREBASE SDK IS OUT; THE TRANSPORT IS PLAIN REST (2026-08-08, UNCOMMITTED)

The Firebase JS SDK caused **three live desktop incidents in one day**, every one of them in
machinery this league never asked for. Files: `assets/league/lg-{core,ui}.js` · `league.html` ·
`tools/_verify-gffl.cjs` (875 → **941**). `lg-data.js` and `netlify/functions/league.mjs`
untouched. `node --check` clean on all four. No commits, no push.

### The three incidents, and the one thing they have in common
1. **The gstatic ESM import failing silently** → the catch dropped to the localStorage backend
   without telling anyone → an empty read → the first-run "Import the league from ESPN" card
   offered to a league with eight teams in Firestore.
2. **The persistent IndexedDB cache corrupting** → `FIRESTORE (10.12.2) INTERNAL ASSERTION
   FAILED: Unexpected state` on every read, on one desktop profile only. Same account, clean
   IndexedDB on the phone → fine.
3. **TODAY, right after that morning's heal shipped**: the outage card with **no reason line**
   and a Retry stuck on **"TRYING…" forever**. The corrupted-cache bug can also manifest as a
   HANG (an SDK deadlock, or `clearIndexedDbPersistence` blocking while another tab holds the
   database) — **and a hung promise sails past every try/catch the heal wrapped around it.**

None of the three is a network fault, a Firestore fault, or a fault in this league's data. All
three live in the SDK's offline-cache layer. The user's directive, verbatim: *"we have to design
the site so no user could ever get this sort of caching issue, they always need to be able to
reach the site and see all the data."* So the layer came out.

### The transport: five operations, plain `fetch`
`get/set/del/list` are now the Firestore REST API. (`watch` had **zero callers** — grepped
across all three JS files, `league.html` and the suite — so it is deleted rather than ported.)
CORS is proven live from a browser's perspective (GitHub-runner **diag run 31276897340**,
2026-08-08): a GET with an `Origin` answers 200 + `access-control-allow-origin`, the OPTIONS
preflight for a JSON POST answers 200 with POST + content-type allowed, and a real `:runQuery`
POST answers 200 + ACAO with the league's 8 team docs. Auth is the public web API key already
in the page; the rules are public — the same posture the SDK had.
- `get` → `GET …/documents/<COLL>/<id>?key=…`
- `set` → `PATCH` with `updateMask.fieldPaths` naming **exactly** the top-level keys being
  written. That IS `setDoc(merge:true)`: listed fields replaced, unlisted fields left alone.
  An EMPTY mask means "replace the whole document" to Firestore — the opposite of a zero-field
  merge — so a `set` with no fields is a no-op rather than a wire call.
- `del` → `DELETE` (404 = already gone, not an error)
- `list` → `POST …/documents:runQuery` with a `kind` `fieldFilter` (no composite index needed).
  Rows without a `document` are skipped — a zero-result query really does answer with one
  document-less row — and each id is attached **LAST** (the established clobber rule).

**Two structural upgrades fall out, and they are the reason this is a rework rather than a port:**
- **A 404 IS SERVER-CONFIRMED ABSENCE.** The entire "cache-served empty" ambiguity class — the
  thing incident (1) turned on, and the reason `getDocsFromServer` re-asks had to be bolted onto
  every read — *ceases to exist*. There is no cache that could invent an empty answer.
- **NOTHING CAN HANG.** Every request goes through one wrapper with an **AbortController, 12s**.
  Boot and Retry are each a bounded number of those, so both always complete. Incident (3)'s
  stuck-"TRYING…" is not fixed, it is unreachable.

### The codec, exactly
Encode: `null`/`undefined`→`nullValue` · boolean→`booleanValue` · **`Number.isInteger`→
`integerValue` (a STRING, per the API)**, other finite number→`doubleValue`, non-finite→
`nullValue` · string→`stringValue` · array→`arrayValue.values` · plain object→`mapValue.fields`
(keys with `undefined` skipped). **An array directly inside an array THROWS, loudly** —
Firestore forbids it, our shapes already comply (the schedule doc's `{g:[{h,a}]}` encoding
exists precisely for this), and a silent mangle would be far worse than a crash.
Decode: the reverse; **both `integerValue` and `doubleValue` → `Number`** (this house has been
burned by the other choice: a whole number written as a double made `rounds === 2` silently
false after a round trip); `timestampValue`→ISO string; an **unknown value kind → `null` with
one `console.warn`, never a throw mid-decode** — one odd field must not lose a whole document.
Every field path is **backtick-quoted** (`` `name` ``, URL-encoded, backslash/backtick escaped).
Firestore's grammar only accepts a bare `[a-zA-Z_][a-zA-Z_0-9]*` segment, and this house has
already lost twelve silent hours to field-path grammar (activity.mjs's `03_news_v` 400s), so no
key is trusted to be a bare identifier.

### The snapshot mirror — data is always visible
Every successful REST read writes through into the LOCAL backend's own `lg_<COLL>_<id>` keys,
plus one stamp, `lg_snapstamp_<fam>`. **That stamp is the whole distinction**, and it is what
keeps the entire existing suite architecture valid:
- a store **WITH** the stamp is a MIRROR → when the cloud can't be reached, the league renders
  **normally** from it, with a persistent clay chip ("Offline — showing this device's saved copy
  (from 9 minutes ago) · reconnecting…") and a 20s auto-retry, and **every mutation is refused**;
- a store **WITHOUT** the stamp is a genuine local-backend store — which is exactly what every
  suite page seeds — so it stays fully read-write, no chip, behaviour unchanged.
Refusals happen at the `LG.db.set/del` seam (before the optimistic cache update, so no phantom
change is ever painted) by throwing an error carrying `offlineReadOnly`; lg-ui toasts from
`LG.onOfflineWrite` and swallows **only that flag** in an `unhandledrejection` listener, so one
tap gives one clear sentence instead of a console error, and every other rejection is untouched.
A write into a mirror would be overwritten by the next successful cloud read — it would appear
to work and then vanish, which is worse than being told no.
**Mirror with no league in it** (stamped but teamless, or a cold device) → the honest outage
card, exactly as before. Server-confirmed emptiness is **not weakened**: a 200-with-zero-rows is
confirmed empty, a failed or timed-out call is not, and `LG.teamsConfirmed` still gates first-run.
The chip's sticky top offset is **MEASURED** off the replay banner rather than hard-coded (the
house's `--fs-topbar-h` / `--subnav-top` pattern) — the two strips would otherwise pin to the
same top and overlap the moment the page scrolls.

### THREE REAL DEFECTS the work found, none of them in the brief
1. **`retryBackend` rebuilt the transport.** The first cut called `initCloud()` unconditionally,
   which reassigns `cloud` — **throwing away a fake cloud a test had installed underneath it**,
   and in production discarding a perfectly good handle to rebuild an identical one. Caught by
   section Z3 failing ("Retry once the connection is back re-boots straight into the real
   league"). It re-probes the existing handle and only builds one when there is none.
2. **The 2025 replay's auto-setup would have run against a read-only mirror.** `UI.boot` reaches
   `simNeedsSetup()` after the emptiness guard, so an offline device with a 2026-shaped mirror
   would have launched a write-heavy ESPN import that could only fail — a setup card where the
   league should be. Now gated on `!LG.mirrorOffline`: a device that has been online already
   holds the seeded season, one that hasn't runs the setup the moment it reconnects.
3. **The outage card's Retry could still be left dead by an unexpected throw.** Bounded time is
   now structural, but the button is *also* restored in a `finally` — the live incident was a
   dead control, and no failure shape, expected or not, may leave one on screen.
4. **Opening the app on a mirror raised the offline toast with nobody having touched anything**
   — found by LOOKING at the desktop plate, not by a test. The boot chain does its own internal
   writes (`runAutoChecks` carrying the league forward; `ensureRoster` copying a previous week
   forward), each of which was refused and toasted for. Both are now skipped on a mirror, which
   is the correct behaviour anyway: a device reading a stale, read-only copy has no business
   processing waivers or finalizing weeks, and a copied-forward roster still resolves in memory,
   it just isn't persisted. `LG.snapshotProjections` was a third — found by instrumenting
   `LG.db.set` with a stack capture on a real mirror boot rather than by guessing a fourth time
   (the mirror boot now records **zero** writes, asserted). The toast is for what a PERSON did.

### SUITE TALLY, and the numbers behind it
875 (baseline, exit 0) → **948/948**. Section AB deleted (−18) → 857 with the app files swapped
to HEAD, i.e. **every pre-existing check survives the transport swap**; new section AB adds 91.

### MEASURED
The never-responds test, against the real shipped 12s budget: **boot 12,046 ms** to a screen a
person can act on (budget 12,000), reason on screen `Firestore read timed out after 12s`;
**Retry 12,011 ms** and back to a tappable "Try again". Both asserted `> budget × 0.5` as well as
`< budget + 8s`, so the test proves it really waited for the timeout rather than failing fast for
some unrelated reason. Diff: lg-core **−452/+? net restructure**, lg-ui +103, league.html +10.

### THE NEW SECTION AB
Section **AB deleted outright** (the IndexedDB heal and its fake-Firestore-module fixtures — the
bug class no longer exists), and a new **AB** written in its place (**84 checks**) driving the
REST transport end to end through puppeteer request interception against real wire-shape
fixtures. The fixture's encoder is deliberately an **INDEPENDENT** implementation of the same
rules, which is what makes the round-trip checks real rather than a function agreeing with
itself. Covered: a real REST boot (probe URL, runQuery kind-filter and collection id **on the
wire**, decode, mirror write-through + stamp) · 404 as confirmed absence with first-run still
reachable · `set()`'s updateMask (exactly the top-level keys, every path backtick-quoted) and
integer-vs-double hand-checked in the PATCH body, plus a round trip and a real merge · `del()`
as a DELETE with the follow-up read 404ing to null · the hang → bounded → tappable-Retry
regression · codec unit tests (round trip, 0 and negatives as integers, nested maps,
arrays-of-maps, the nested-array loud throw, an unknown kind → null) · the mirror rendering the
league offline with the chip and refusing a real chat post with a toast and zero writes · the
same store **without** the stamp behaving exactly as today (writes fine, no chip) · the auto-
retry recovering on its own through the real `setInterval` when the connection returns · a cold
store still getting the outage card · and a grep proving the SDK is gone.
**Verified: with the new section absent the suite reads 857 pass / 2 fail — and the 2 were Z3's,
from defect 1 above, now fixed. Every one of the 857 pre-existing checks survives the transport
swap untouched.**
**RESTAGED — one thing, with its reason in the file**: the "no SDK survives" grep strips
comments before applying the ban (the header note deliberately NARRATES the three outages and
names the machinery that caused them; a `//` preceded by `:` is a URL, not a comment, so
stripping those naively would delete the REST endpoint the very next check looks for).
Sections Z (server-confirmed emptiness) and every `armFakeCloud` section needed **no changes** —
they operate above the transport, which is the point of `_installFakeCloud` living where it does.
Shots: `shots/gffl_rest_offline_{390,desktop}.png` — viewport, not `fullPage`: the chip is
`position:sticky` and this repo has already been bitten by `fullPage` disagreeing with a sticky
element's real placement.

### KNOWN / DEFERRED
There is no offline cache at all now, so every read is a real round trip — the in-memory
`LG.db` cache (15s background refresh) is the only thing between a warm view and the network,
exactly as it was for the SDK's cloud path, and section P's zero-extra-reads budget still holds.
A mirror is refreshed only by reads this app actually makes, so a doc never read on this device
is not in it. The mirror is per-browser-profile `localStorage`, so quota/private mode degrade it
silently (deliberately — the mirror is a bonus, never a requirement). And `index.html`'s own
cloud backend still uses the SDK with `persistentLocalCache`; nothing has been reported there,
and it is a different Firebase app and therefore a different IndexedDB, but this transport is a
straight port if it ever bites.

## 🏈 GFFL — THE REPLAY'S CLOCK RUNS: mid-week-1, games in progress (2026-08-08, UNCOMMITTED)

User: *"now let's advance to the middle of week 1 with live stats and live games, you can generate
fake stats if that is easier"*. `league.html` untouched; `assets/league/lg-{core,data,ui}.js` +
`tools/_verify-gffl.cjs` (948 → **1028**). `netlify/functions/league.mjs` untouched. `node --check`
clean on all three JS files. No commits, no push.

### Two named phases, and `live` is the default
`LG.SIM_2025` is unchanged (the master switch; `?sim=0` still reverts to the real 2026 season).
Beneath it, `LG.SIM_PHASES`:
- **`pre`** — Thursday 2025-09-04 14:00Z. The old pinned instant, unchanged: week 1, nothing kicked
  off, and week 1's Wed-8am waiver deadline already past so free agency is open.
- **`live`** — Sunday **2025-09-07 19:00:00Z** (1:00 PM CT), and it is now the **DEFAULT**
  (`SIM_PHASE_DEFAULT`, one commented literal beside `SIM_2025_DEFAULT`). Chosen against the REAL
  slate: Thursday (Sep 5 00:20Z) and Friday (Sep 6 00:00Z) are FINAL, the Sunday early window
  (17:00Z) is ~2 hours in and LIVE, the late window (~20:25Z) and the Monday-night finale
  (2025-09-09T00:15Z) have not kicked. That mix is the whole point.

`?simphase=pre|live` is a non-persisted QA override (same posture as `?sim=`/`?fam=`); the
commissioner's **Replay clock** card on the Rules page persists the choice per device
(`gffl_simphase`) and hard-reloads into it — the same posture every other reload-y action here
uses, because a phase change moves `LG.now()` and every cached roster/game/stat in memory was
derived against it. A non-commissioner sees the card and no switch.

### ONE clock, and it is clamped inside week 1
`LG.now()` precedence is unchanged at the top (`nowOverride` still always wins) and underneath it
is now `LG.simNow()` = `phaseStart + (Date.now() − SIM_LOADED_AT) × SIM_SPEED`, **SIM_SPEED 8** by
default (a quarter in ~2 real minutes, the slate done in ~25). `SIM_SPEED = 0` freezes on the phase
instant — a real setting AND the deterministic mode for plates; `?simspeed=N` is the same
non-persisted override family. Game state, `playerLocked` and every stat line derive from this one
clock, so they cannot disagree.
**THE CLAMP** is `min(last kickoff + 4h, week 2 − 1h)`. The second term is what makes
`currentWeek() === 1` unconditional — asserted at the phase instant AND at the ceiling. The first
starts as a constant (the real 2025 MNF, 2025-09-09T00:15Z) and lg-data **RAISES** it from the
slate it actually loads, **never lowers it**, so the clock can never jump backwards when the slate
lands mid-session. Leave a tab open all day and week 1 completes and sits there.

### Game state from real kickoffs — no bucketing
The slate already carries every kickoff, so the deleted sandbox's alphabetical team-bucketing has
no reason to exist and none was rebuilt. `D.simGameState(kickoff, now)` returns
`{state, period, clock, detail, progress}`: 60 game-minutes over **185 wall minutes** with a
**13-minute halftime**, so 172 wall minutes carry 60 game minutes (1 game-min ≈ 2.867 wall-min).
Halftime is a real state ("Half"). The period is `min(4, …)` so it can never read Q5+, and the last
tick of regulation is Q4 0:00. Hand-verified in the suite at nine instants (kickoff, Q1 4:32 at 30
min, Half at 86 and 95, Q3 15:00 at 99, Q4 12:12 at 150, still Q4 at 184, Final at 185, still Q4
hours later). `pollSimSlate` splits into a **fetch-once** (static history) and an
**apply-every-tick**, which is what makes the board move.
**Scoreboard scores are SYNTHETIC** and deterministic: the historical document's REAL final scaled
by `progress` while a game runs, then the exact real final once it is over, 0 before kickoff. No
play-by-play is invented — only the number on the scoreboard.

### Live stats are the REAL finals, scaled — and monotonicity is load-bearing
Not invented: each line is that player's real week-1 2025 final from the same archived Sleeper
endpoint `D.weekStats` and `finalizeWeek`'s backfill already trust (`D.simEnsureFinals`, fetched
once — `simEnsureProj`'s own fallback now reuses it rather than fetching the identical payload
twice).
- game **pre** → **no stat line at all** (absent, not a row of zeros)
- game **in** → `scale = min(0.98, progress × f(pid))`, `f` a stable per-player draw in [0.75, 1.35]
  from an FNV hash of the id, so some players front-load and others finish strong
- game **post** → the exact real final, unscaled
Counting stats and yardage are **integers at every scale** (`Math.round`).
**WHY MONOTONICITY MATTERS**: `applySide` builds the feed by DIFFING consecutive polls, so a value
that ticks down emits a negative delta and a nonsense line. Every term is non-decreasing in
`progress` alone — `f` is drawn once and never re-rolled per poll, `min()` with a constant preserves
it, `Math.round` preserves it. Asserted over a 12-poll walk: every counting stat non-decreasing,
never above the final, landing EXACTLY on the final once the game ends, **0 events with `to < from`
and 0 negative deltas**. The one legitimate exception, stated rather than hidden: a DEFENSE's
POINTS fall as the points it has allowed climb — real football, and the live engine already does it;
the stat itself still only rises.
Feed entries are stamped in **LEAGUE time** (`t: LG.now()`, display-only — off the replay that IS
wall time), so a Sunday-afternoon board's feed reads as a Sunday afternoon. Freshness fields
(`side.last`, `health.lastChange`) deliberately stay on `Date.now()`.

### One real fix the 8× clock forced, and one deliberately NOT taken
- **`LG.db`'s cache staleness moved to wall time.** Cache freshness is a fact about the NETWORK,
  not the league calendar; on `LG.now()` an 8× clock fired every background refresh eight times as
  often, for the whole session, on a real cloud backend.
- **`runAutoChecks`' throttle STAYS on league time** — tried the other way and reverted. Everything
  that chain does is keyed to a LEAGUE deadline (waiver deadline passed, trade review window
  elapsed), and sections J and P drive exactly that with `nowOverride`; switching it to `Date.now()`
  broke five checks. Cost is 60 league seconds ≈ 7.5 wall seconds at 8×, against a chain of cached
  reads plus a finalize that refuses outright under the replay.

### What must NOT change, and is asserted still true
`D.S.espnWeek`/`slpWeek` are still never set, so `engineWeek()` stays null and the provenance
guards stay silent — re-asserted **with the whole slate final**: `maybeAutoFinalizeWeeks` writes
nothing, no week is reported stale, `finalizeWeek`'s live path still refuses with `sim-replay`, and
the archived-stats backfill remains the only way to settle the week. Health stays `dual`/nominal
(`updateHealth` is deliberately not called under the replay) and the chip still reads "replay".
The REST transport, the offline mirror, server-confirmed emptiness, the auto-setup and both
projection paths are untouched.

### Suite: 948 → **1028/1028, 0 page errors**
New **section X8** (80 checks): phase default/override/persistence + the commissioner card and its
gate; the clock measurably running at ~8×, frozen at speed 0, and clamped (a tab "open a fortnight"
stops dead on the ceiling, week 1 at both ends); game state at the live instant across all six
games — **the two live games differ by exactly their 15-minute kickoff stagger, Q3 12:54 vs
Q3 7:40, which is what proves the clock is per-game**; the nine hand-computed clock instants; the
scaler hand-checked at 50% (6 rec/62 yds/1 TD → 3/31/1); a pre-game player with NO line; a finished
player at his exact hand-computed final (P. Passer 150 yds ×0.04 + 4 − 2 + 2 = **10.0**); a live
player cross-checked against `62 × min(0.98, progress×f)` multiplied **in the test**; the 12-poll
monotonicity walk; lineup locks agreeing with game state before and after kickoff; the matchup
page's live clocks and per-side "0 to play · 2 live" / "4 to play · 0 live"; and the guards above.
**RESTAGED, each with its reason recorded in place**: `sbSim2025Fix` reshaped to 6 games so the four
NFL teams the roster fixture uses land in three different states at the live instant (KC@LAC moved
from its real Friday slot into the Sunday early window on purpose, so the VIEWER's own team has a
player mid-game rather than a board of finals) — X3's counts follow (5→6 games/networks, the
day-group check becomes "the Sunday games share a group", the date regex reaches Sep 9); X1/X3/X4
pinned to `&simphase=pre&simspeed=0` (they encode the before-kickoff contract, and under `live`
P. Passer's derived projection and his live score are the SAME number, so "the row shows the
projection" would stop being a real assertion); X1's "now === the pinned instant" became a
frozen-clock check plus a new phase check; X5's banner copy now names the phase and the speed.
**Plates**: `shots/gffl_live_{league,matchup,scores}_390.png` + `gffl_live_matchup_desktop.png`,
taken at `simspeed=0` (hence "The clock is paused" in the banner — that is the deterministic mode
being honest).

**TWO GOTCHAS worth keeping.** (1) **A feed cannot be screenshotted without a walk, and the walk
must never rewind.** The first cut of the plate stepped the clock BACK 40 minutes to fill the feed
— against a page that had already polled at the live instant — and produced exactly the negative
deltas the whole monotonicity rule exists to prevent (`T. Tight rec TD 1→0 −6.0`). Caught by LOOKING
at the plate, not by a test. The fix re-baselines (`players.clear()` + `slpSeeded = false`) at the
earlier instant so the catch-up poll is a silent baseline again, then walks forward. (2) A template
literal that wraps across lines puts its own newline + indentation into `textContent`, so a copy
assertion has to normalise whitespace first.

**⚠ NOT LIVE-VERIFIED HERE — ESPN and Sleeper are egress-blocked from this sandbox**, so the
fixtures carry the whole burden, exactly as the original replay entry warns. Post-deploy eyeballs:
open the app on a Sunday-shaped board and confirm (a) the real slate's kickoffs put games into the
three states the fixture predicts, (b) real archived week-1 lines scale sensibly rather than
producing absurd partials, and (c) the clamp lands on the real Monday-night finale — the constant
is `2025-09-09T00:15:00Z` and lg-data raises it from whatever the real slate says.

## 🚨 GFFL — "the scores say NaN and the projections are 0" (2026-08-09)

User report, verbatim: *"none of the scores for players are showing up they are saying 'nan' and
all the projections are 0"*. TWO independent defects, both fixed, both with a reproduction.
Files: `assets/league/lg-{core,data,ui}.js` + `tools/_verify-gffl.cjs` (1028 → **1084**).
`netlify/functions/league.mjs` untouched. `node --check` clean on all four. No commits, no push.
GROUND TRUTH throughout is GitHub diag run **31287998467** against the family's own league —
ESPN/Sleeper/Firestore are egress-blocked from the sandbox, so the fixtures MODEL those numbers
rather than re-deriving them.

### #1 · IDENTITY — half the league was invisible, and it is not replay-specific
A GFFL roster keys its players by **ESPN id** (`roster_2025_w1_t1` holds `"4430807"` for Bijan
Robinson — that is what `applyImportedRosters` writes). Sleeper's directory is the only whole-NFL
player list this app has, and **only 6,727 of its 12,217 entries carry an `espn_id`**. Every
lookup in both directions went through that field alone, so it lost the other half:
- `D.projFor` found no pid → **no projection**, and the matchup page's `liveProj` then fell back
  to the live score, which is literally where "all the projections are 0" came from;
- `pollSleeper`/`pollSimStats` had nowhere to put the stats, so they landed under a synthetic
  `slp_<pid>` key **no roster row ever reads** — an orphan row.

MEASURED on the first 12 players of the real roster: **4 resolved, 8 lost.** Reproduced in the
harness (scratchpad `nanprobe.cjs`, production-shaped): of team 1's 11 rows, **2 had a live stat
row and 6 had a projection; 6 rostered players were orphaned into `slp_` rows.** After the fix:
**11 of 11 projections, 0 orphans.** This would silently zero **every rookie in the real 2026
season** for the same reason — a rookie is exactly the player Sleeper has not yet given an
espn_id — so it is fixed as a product bug, not a sim patch.

**`D.pidForKey(key)` is now the ONE answer**, used by `projFor`, both pollers and `weekStats`.
Three methods, cheapest and most certain first: (1) an explicit `dst_`/`slp_` **prefix**;
(2) the **`slpByEspn` INDEX**, O(1) — `projFor` used to walk all 12,217 entries looking for a
matching espn_id, per player, per render; (3) **NAME + TEAM from what the ROSTER already knows**.
That third method is the half that had to be new: the pre-existing name fallback only worked once
a LIVE ROW for that key existed, which is the exact chicken-and-egg that kept those players dark
(no pid → no stats → no row → no name to match on → no pid). Names normalise through the existing
`normName` (apostrophes, suffixes, punctuation, case), which is what makes the two real-world
spelling splits work — ESPN's "De'Von Achane" vs a roster spelling it "DeVon", and a roster's
"Marvin Harrison Jr." vs Sleeper's "Marvin Harrison".
- **Positives memoize, negatives do not.** The directory and the rosters both arrive
  asynchronously, so a "no" cached before either landed would be permanent; `_pidGen` invalidates
  the memo when either source changes. Measured: 20 lookups of one key cost **exactly one** index
  read; 60 uncached calls iterate the directory **0** times.
- **SYMMETRICALLY**, `D.S.keyByName` (registered from `LG.loadRoster`/`saveRoster` — the one
  choke point every caller funnels through) lets a stat row land on the **roster's own key**
  instead of an orphan. When the roster keys a player by his espn_id — the ordinary case — the
  registry returns that same string, so it is a no-op for everyone who already worked.
- `D.weekStats` keys the same way, so a season history / FPTS column resolves too. Its cache now
  holds the **RAW payload** and re-derives the keyed Map on a `_pidGen` change — the registry can
  legitimately land after the first derivation, and re-deriving costs no network, so the
  2026-08-08 perf fix is intact.
- **`D.idCoverage()`** reports the split honestly (`{total, resolved, unresolved, byMethod,
  missing}`); a key that still resolves to nothing is NAMED, not swallowed. On the suite fixture:
  **before 7/17 (prefix 2 + espn 5), after 16/17** — the 17th is a deliberately unknowable player.

### #2 · THE NaN — found empirically, and `|| 0` is what looked like a guard
```js
for (const k of KEYS) p += (st[k] || 0) * (sc[k] || 0);   // D.score, the poisoning expression
```
`x || 0` DOES catch a NaN (NaN is falsy) — and passes a **truthy non-number** straight through.
`0 * "x"` is NaN, and the multiply runs for all 28 keys on every row, so **ONE bad value anywhere
in the scoring table makes every player NaN, including players who have none of that stat.** That
is the shape of "none of the scores for players are showing up".
```js
if (pa <= 27) return sc.dst_pa_18_27 ?? 0;                 // paPoints, the second hole
```
`??` catches null/undefined but **not NaN** — and passes `""` through, which turns the running
total into a STRING and every later `+=` into concatenation. Measured pre-fix: a blank
`dst_pa_18_27` scored a D/ST **5000** instead of 5.0. Silently, catastrophically wrong, and not
even NaN.
```js
LG.fmtPts = (n) => (n == null ? "—" : (Math.round(n * 100) / 100).toFixed(1));   // the render
```
`NaN == null` is false, so a non-finite number reached the family as the literal text **"NaN"**.

**THE WRITER that arms it** — reproduced end to end, and the reason production could get there:
```js
next[g][k] = raw !== "" && !isNaN(num) ? num : raw;        // the rules editor's Save
```
A blank or fat-fingered scoring box **persisted the RAW STRING into the rules doc**, and it
survives everything (Firestore stores a `stringValue`; `JSON.stringify` keeps it). Pre-fix, the
suite drives Rules → Edit → blank `scoring.rec`, type `"4 pts"` into `pass_td`, `"abc"` into
`dst_pa_0` → Save, and the very next `D.score(5 rec + 50 yd)` returns **NaN**. From that one save
every player in the league reads NaN, forever, on every device.

**FIXES, defence in depth** — the brief's rule is that a displayed "NaN" is never acceptable, so
the boundary is closed as well as the causes:
- `D.num()` coerces **every** factor in `D.score`/`paPoints`/the yardage bonuses to a finite
  number, and the return is finite-guarded. A clean line still scores exactly what it always did
  (21.64 on the suite's own QB, asserted).
- **`LG.fmtPts` renders "—" for NaN / Infinity / a non-numeric string.** ONE funnel covering ~30
  render sites (every score, projection, total, PF/PA, record-book superlative, bracket cell).
  New `LG.fmtNum` does the same for the 5 raw `.toFixed()` sites (all-time PF, standings PF/PA,
  the AI-read multiplier, feed deltas, the locker record) — there are now **zero** raw `toFixed`
  calls in `lg-ui.js`.
- **`LG.n()` at every accumulation**: `st[h].pf += m.homePts` (standings), the power-rankings
  tally, `headToHead`, and the record book's all-time PF. A matchup written without points — a
  bye row, a half-imported history season — used to turn a whole team's points-for into NaN for
  the rest of the table. The family has 8 imported history seasons feeding exactly those.
- **The rules editor decides by the CURRENT value's type**: a field that is a number today must
  stay one; an unparseable box keeps its old value and toasts which ones. The raw-string branch
  survives for the fields that are legitimately text (`keepers.waiverCost` "last-round",
  `waivers.type`, `trades.veto`) — that is why it existed at all.
- `D.winProb` returns 0.5 rather than a non-finite (the bar's width goes straight into a `style`
  attribute — `width:NaN%`), and `liveProj`'s clock arithmetic is coerced.
- **`D.livePts`/`D.liveProj` return null → "—" for a key that resolves to NOBODY.** "0.0" is a
  claim we cannot back; a player we cannot identify has no score, he has no answer.

### Suite: 1028 → **1084/1084, 0 page errors** — and 35 of the new ones FAIL pre-fix
New **section AC** (56 checks) drives production-shaped data behind `fixture.prod2025`: 14 real
players under their real names, **only 4 carrying an espn_id in the directory**, roster keys that
are real ESPN ids, archived stat rows and forward projections carrying the real non-fantasy noise
(`gp`, `off_snp`, `rec_drop`, `pos_rank_std`, `bonus_fd_wr`, `adp_dd_ppr`, `fum`…), a slate that
puts some games final / some live / some not yet kicked at the replay's own live instant, and one
**deliberately unknowable** player. Hand-computed exactly: Bijan Robinson (no espn_id, game
final) **21.7** and his separate forward projection **15.5**; Chase McLaughlin (no espn_id)
**10.0**. Plus: every roster player gets a projection and none reads 0; the espn_id control is
unchanged; a whole-DOM text scan finds **no "NaN"** on the league home / matchup / players table
/ Scores tab / locker; both team totals finite; the unknowable player's cell reads `—proj —`;
the NaN mechanics as unit checks on the real functions; the rules-editor writer; the directory is
never iterated; and the orphan-key half.
**VERIFIED PRE-FIX** by stashing the three app files back to HEAD: **1049 pass / 35 fail, and all
35 are in section AC** — every pre-existing check survives the change untouched. Among the 35:
Bijan `{pts:null, proj:null, live:0}` (the reported symptom exactly), 4 of team 1 with no
projection, 6 rostered players orphaned into `slp_` rows, 50 directory iterations for 60 calls,
standings PF `null`→NaN, the blank PA bracket scoring **5000**, and the rules-editor save leaving
`{rec:"", pass_td:"4 pts", dst_pa_0:"abc"}` followed by a score of **NaN**.
Section AC is deliberately **pre-fix tolerant** (section Z's own lesson): every hook it exercises
is new, and a bare call to a missing one aborts the whole run with one stack trace instead of the
readable list a pre-fix verification exists to produce.

**TEST GOTCHAS** (both cost a run): the two spans in a lineup cell are adjacent in the markup, so
`textContent` runs them together — the empty cell reads `"—proj —"`, not `"— proj —"`. And
`LG.fmtPts` rounds to 2dp and then prints 1dp, so `fmtPts(12.345)` is `"12.3"`, not `"12.35"`.
**HARNESS NOTE**: the suite's own fixture players are all named "P. Passer"-style and all carry an
espn_id, so it could have passed with the resolver doing nothing — the production-shaped fixture
is what makes these assertions real.

**KNOWN / DEFERRED**: while the Sleeper directory is still loading (or if it fails outright) an
unresolved key reads "—" rather than "0.0" — honest, and it self-corrects on the next poll, but it
is a visible difference from before. **A LEAGUE ALREADY POISONED STAYS POISONED**: a string sitting
in the family's live `settings` doc is now rendered harmless (it scores 0 instead of NaN) but is
still the wrong VALUE — post-deploy, open Rules and check the scoring table for anything that
isn't a number, and re-import from ESPN if so. And the exact production trigger could not be
confirmed from here (no egress): the mechanisms above are all reproduced, but **which** of them
the family actually hit needs one look at the live rules doc.

**POST-DEPLOY EYEBALL**: (1) open the matchup page and confirm every player carries a real score
AND a real projection — the rookies especially; (2) `window.__GFFL__.D.idCoverage()` in the
console should report `unresolved: 0` (anything listed under `missing` is a real gap worth a
name-spelling look); (3) confirm the Rules scoring table holds only numbers.

## 🏈 GFFL — matchup + my-team + moves playtest batch, thirteen items (2026-08-09)

One playtest pass over the Matchup, My Team and Moves tabs. Files: `league.html` +
`assets/league/lg-{ui,data}.js` + `tools/_verify-gffl.cjs` (1084 → **1190**).
`lg-core.js` and `netlify/functions/league.mjs` untouched.

**MATCHUP.** The feed is a bounded scroll box, every event attributed to the team it came from
(the team's own `abbrev` via the existing `teamTag`), with a Both/away/home filter that
re-renders the already-annotated `UI._feedAll` — no refetch, and `paintFeed()` repaints `#mufeed`
alone so the AI-read card and trash-talk composer survive. Filter resets to Both when the matchup
changes. Slot badges take the draft's own `--pos-*` palette; **the first cut tinted the whole
12%-wide cell and the screenshot killed it** (a ~75px slab of saturated colour per row on
desktop), so the colour moved onto a compact centred `.slotbadge`. Header **220px → 111px** with
nothing dropped (crest beside the name, projection beside the score); cost is that long team
names ellipsize to one line, `title` added. **Pressing the Matchup TAB always returns to the
user's own game** — new `UI.navTo`, wired to the nav buttons; only a tab press clears
`UI.matchup`, so card taps and live repaints never yank you out of a game you opened.

**THE BENCH KNOCK-ON, worth keeping.** Giving the bench the starters' `mutable` formatting
(fixed layout + wrapping cells) exposed that the old nowrap bench was making both halves of a row
two lines BY ACCIDENT — so a wrapping name beside an "Empty" produced two different-height boxes.
Fixed with `.pcell{height:1px}` + `.pcellgrid{height:100%}`: **`height:100%` alone silently does
nothing**, a percentage needs a definite height to resolve against (39 vs 59 before, 59/59 after).

**TWO ITEMS NEEDED THE DATA LAYER FIRST.** Crests: the logo URL was never captured — added to
`pollScoreboard`'s `side()` **and** to `fetchSimSlate`'s (the replay uses a different parser),
rendered at a fixed 22×22 with `onerror` → `visibility:hidden` so a missing crest can't shift the
score; a team with no logo renders no `<img>` at all. Possession: `possAb` was already computed in
`pollEspnGame` for the red-zone flag and thrown away — now stored as `g.poss` and carried across
`pollScoreboard`'s rebuild by `eventId` exactly like `rz` (the scoreboard carries no drive, so
without that it flickers off between summary polls). **A D/ST is never highlighted** — its side has
the ball, so the defence is off the field. The replay sets `poss:false`, nobody highlighted, no
errors.

**MY TEAM.** Names were clipped: a 52px slot chip + ~72px Swap + a nowrap points column left the
name **94px**, wrapping three deep with one case overflowing. Now **163px**, 0 clipped; `.linfo`
stacks ≤700px and `.lname small` wraps as a unit so "QB · PHI" can't split. LOCKED span gone —
Swap is `disabled` + title/aria + greyed; `openSwap` keeps its own guard for the paths a disabled
button can't reach. Locker header **182px → 97px**.

**INJURIES.** One `injLabel()` (exported as `LG.injLabel`), four callers (`injChip` for the locker
+ swap sheet, the players table, the stats card). Active/""/ACT/Healthy → **nothing at all**;
Questionable→Q, Doubtful→D, Out→OUT; an unanticipated status (PUP/SUS/IR) still shows a short form
rather than reading as healthy. Case-insensitive, idempotent. **`LG.irEligible` still gets the RAW
value** — asserted.

**MOVES.** The list cap goes on the existing `.panner`, **not a wrapper**: a sticky cell only
sticks to the scrollport it lives in, so wrapping it would have pinned the PLAYER column to the
wrong box. Header row gained `top:0`, top-left cell z-index 3. Measured: 0px column drift after a
220px horizontal scroll, 0px header drift after 90px vertical, Show more grows 40→64 rows with the
box height unchanged. "My pending" **190px → 57px empty, 359px → 268px populated**, and its
actions went **32px → 44px** (under the tap floor). A latent trap: `.pendcard .rowline button`
gave every inline player-name link a 44px box and pushed the card to 424px — scoped to `> button`.

**VERIFIED**: **1190/1190, 0 page errors**. Proven real — with the app files stashed back to HEAD
the run is **1127 pass / 63 fail**, every failure on-point across all thirteen items, and the
before-numbers above (220/182/94px, 190/359px, 32px) are what the OLD code actually measured.
43 of the new section AD's 104 checks pass either way and are deliberate regression invariants
(0 page errors, no sideways scroll, "tapping another card still opens THAT matchup", IR
eligibility, the sticky column). Restaged with reasons in place: the `.mutable tbody tr` selector
(two such tables now), section E's two LOCKED checks, and X8e's `.lrow .lock` count (now counts
disabled Swaps — the old form would be a vacuous 0 forever).

**A CHECK THAT WAS A RACE, NOT AN ASSERTION** (found on the independent re-run — it passed for the
agent and failed for me, which is the signature): the crest test sampled `img.complete` the instant
the card appeared and read `loaded:false / visibility:visible` — **`onerror` had not fired either**,
i.e. the intercepted image was simply still in flight. It now waits for every crest to SETTLE, so a
genuinely broken one still fails, just deterministically. General rule: a real (even intercepted)
network image cannot be sampled at first paint.

**A FIXTURE ARTIFACT THAT ALMOST BECAME A REGRESSION**: the feed review plate shows team chips
reading `T1`/`T2`, which looks exactly like the abstract labels the user asked NOT to ship. It is
`seedTeams()` — it literally assigns `abbrev: "T" + (i+1)`. The code renders each team's own
abbrev, so the real league shows BK/EZG. Checking before editing is the only reason working code
wasn't "fixed".

Plates: `shots/gffl_pt_{matchup_390,matchup_desktop,myteam_390,scores_390,moves_390,moves_desktop,
feed_390}.png`.
**KNOWN, PRE-EXISTING, UNTOUCHED**: the bottom nav clips DRAFT to "DR" at 390px (8 tabs, one row).
Nav markup/labels are unchanged by this batch — only the click handler moved — so it predates it.

## 🏈 GFFL — the ESPN matchup layout, chat, and six tabs (2026-08-09)

User sent a screenshot of the REAL ESPN fantasy app's matchup tab: *"I want to mimic this
matchup layout… team a hugs left, team b hug right, exactly even height for every player, all
fits on 3 total rows… we need the little team logos, need the clean scores at the top."* Plus
three follow-ups (chat anchoring, no system messages, drop two tabs) and one defect found by
reviewing the plates. Files: `league.html` + `assets/league/lg-{core,ui,data}.js` +
`tools/_verify-gffl.cjs` (1190 → **1287**). `netlify/functions/league.mjs` untouched.

**THE MIRROR REVERSES A CALL MADE THE DAY BEFORE.** The previous batch shipped a comment
asserting *"only the column ORDER mirrors — text stays LEFT-aligned on BOTH sides, not
ragged-right"*, inferred from a lower-resolution screenshot. The real app hugs: team A's text
left, team B's **right**. Flipped, and the comment REWRITTEN to record the correction — a
comment asserting the opposite of the code is worse than no comment. Measured at 390px: every
left name starts at x=49, every right name ends at x=341.

**THREE FIXED LINES, AND EVEN ROWS COST THE WRAP.** Each half is exactly three nowrap
`.pline` blocks — name + NFL crest / opponent + kickoff / stat summary — with line 3 rendered
unconditionally so its height is RESERVED even when empty. Every starter half-cell is 45px
across all 18 cells, with an empty slot, a live stat line and a pre-game blank in the same
asserted set. **Even height and wrapping are mutually exclusive**, so a long name ellipsises
here where the My Team rows (a different surface, a different fix) still wrap to two lines.
Empty halves render the same three lines or the columns stop aligning, which is the whole point.

**THE CENTRE BAND KEEPS THE DRAFT COLOURS.** ESPN's own band is plain grey; the user's earlier
request for `--pos-*` position colours wins. The CELL is painted `--nested2` with a transparent
bottom border — measured 0px gap between consecutive cells, so it reads as one continuous strip
— with the coloured badge inside it. Both worked; no compromise was needed.

**CRESTS COST NO FETCH.** `D.teamLogo()` builds an abbrev→URL map from `D.S.nflEvents` already
in memory (the per-competitor `logo` landed in the previous batch), `slpTeam()`-normalised. A
crest-less team renders **no `<img>` but keeps a 14px placeholder span** — without it that row's
name starts 19px off every other row's, so the consistent-edge property would hold only for
teams that happen to have a crest. home/away is recorded in **both** parsers (`pollScoreboard`
AND the replay's `applySimSlate`) so line 2 reads `@DEN` away, bare `KC` home.

**HEADER 111px → 107px** (220px two batches ago): crest outer, big score inner with a bare
smaller projection beneath (no "Proj" label), name, `owner · record`. Paid for by tightening
type, not by dropping the to-play/live line.

**ITEM 17 — THE MOBILE TRUNCATION, AND WHY THE FIRST ANSWER WAS WRONG.** The first cut shipped
names reading **"M. Ha…", "J. Smi…", "C. McLaug…"** with the note *"ESPN does the same; the
title covers it."* Neither half was true: the user's own reference fits `T. Etienne Jr.` and
`C. Williams` in full at the same 390px, and **a `title` is unreachable on a phone** — there is
no hover. Caught by LOOKING at the plate, not by a test. The fix was measured, not guessed —
at 390px, name budget **83.8px → 102.7px** (and **51px → 102.7px** on the rows carrying pips):
+20px from the lineup card's own 16px side padding (by far the largest slack, and it costs no
text — the reference's rows are near full-bleed), +12px from a points column holding 28px of
text in 36px, +8px from cell padding and gaps. **Nothing came from the name's font, the crest,
the band, the colours or either point value.** `J. Smith-Njigba` needs 97px and now has 103.
Ceiling ~15-16 chars; a name like `A. Rodriguez-Williams` would need 143px and still truncates.
**The pips were a SECOND, independent cause** — the possession + red-zone dots cost ~31px on
exactly the rows whose names are longest-pressed. They moved to **line 2**, where they belong:
all three markers are facts about the GAME's state, and a live row's line 2 is the short
`Q2 5:00`, so they cost nothing there.

**CHAT — THE DESKTOP BUG WAS NEVER ORDERING.** `.chatlist` is `max-height:52vh` and scrolls to
the newest. On a phone 52vh is short, the list overflows, the scroll pins the newest to the
bottom — correct. On a desktop a few messages **do not fill the box**, there is nothing to
scroll, and the flex column top-aligns them with dead space beneath. Same code, different box
height. Fixed by bottom-anchoring with an `auto` top margin — **deliberately NOT
`justify-content:flex-end`**, which on an overflowing flex column makes the earliest messages
unreachable when you scroll up. Both halves asserted: newest 8px off the bottom with 3 messages,
and with 30 messages the FIRST is still fully visible at scrollTop 0; a reader scrolled up is
not yanked down when a message lands.

**CHAT IS USER MESSAGES ONLY.** Filtered at RENDER on all three surfaces (Chat tab, matchup
thread, league-home preview) with `byId` built from the filtered set, so a reply quoting a sys
post degrades to no quote. Then **all seven `postSys` writes removed** — each was checked
against "would this lose its ONLY record", and none does: rules changes persist in
`settings.log` and render as the Rules page's own **Change log** card, the champion is written
as a team trophy AND onto the bracket doc, waivers/trades/vetoes are in the transaction log.
`LG.postSys` itself stays as the API and as what the suite seeds. The matchup feed's own sys
lines (`.fline.sys`, from `e.msg`) are a different surface and untouched.

**SIX TABS.** Rules and Draft left the nav for the League page — Rules through `UI.navTo`,
Draft as a real `<a href>` so middle-click and open-in-new-tab still work. Per-tab width at
390px **62/68/62/62/62/62**, against 39-68px for seven buttons plus a link. **The DRAFT→"DR"
clipping never reproduced headless** (eight entries measured 0 clipped labels — a real-device
font difference), so that check is a regression invariant and the WIDTH is the honest measure,
not a proof the clipping is fixed.

**TWO CLIPPING BUGS FOUND ON THE WAY**: `BENCH` had been spilling 10px out of the centre band
since the band shipped (39px of text in a 29px box; now 35 into 37), and the TOTAL row would
have been clipped by narrowing the players' column, so it keeps its own 44px basis.

**VERIFIED**: **1287/1287, 0 page errors** (1289 with `--shots`). Pre-fix on the main batch,
app files stashed to HEAD: **1218 pass / 63 fail**, every failure on-point across all sixteen
items; item 17's own three checks fail pre-fix at the recorded widths (`97>51`, budget 84 vs 97).

**THREE TEST BUGS FIXED, all of the same family — a check that passes for the wrong reason:**
(1) the `#rules` deep-link check used a hash-only `goto`, which is a **same-document
navigation**, so it had been passing because the page was already on Rules (now carries a `?n=`
nonce — the same lesson the farmgpt nav suite learned). (2) Two hard `waitForSelector`s turned a
missing element into a whole-run crash instead of a readable failure. (3) `scrollWidth` reports
**no overflow on an `overflow:visible` element**, so the first TOTAL/BENCH checks read as
comfortable fits while genuinely overflowing — they now measure a `Range` around the text node,
and the BENCH one compares against the CELL that constrains the badge, not the inline-block
badge itself (which always looks like a perfect fit). The name check keeps `scrollWidth`
legitimately, because `.pname b` carries its own `overflow:hidden`.

Plates: `shots/gffl_espn_matchup_{390,desktop}.png`, `gffl_chat_{390,desktop}.png`,
`gffl_league_links_390.png`.

## 🕐 GFFL — THE REPLAY CLOCK WAS PER-DEVICE, AND IT CORRUPTED CHAT ORDER (2026-08-09)

User: *"I did a total hard refresh on desktop and deleted all messages and then did 4 messages in
a row and they came in correct, then I went to mobile and added a message and it went on TOP of
those, so we clearly aren't sorting by time received."* Files: `assets/league/lg-{core,ui}.js` +
`league.html` + `tools/_verify-gffl.cjs` (1287 → **1313**).

**TWO WRONG DIAGNOSES BEFORE THE RIGHT ONE, and the user's test is what settled it.** First I
read it as the chat-anchoring bug from the previous batch; then, when the harness proved that
case green at 1440×900, as a stale deploy. Both were wrong. "Four in order from one device, then
a fifth from a SECOND device on top" cannot be anchoring or caching — it is the timestamp.

**ROOT CAUSE — mine, from the replay batch.** `LG.SIM_LOADED_AT = Date.now()` is set **at module
load, per page load**, and `LG.simNow()` returns `SIM_NOW + (Date.now() − SIM_LOADED_AT) × 8`. So
the replay clock **restarts at the phase instant every time a device opens the page** and then
runs at 8× only for as long as that tab has been open. A desktop open 20 minutes reads phase +
160 sim-minutes; a freshly-loaded phone reads ≈ phase. `postChat` stamped `t = LG.now()` and
`loadChat` sorts on it, so the phone's message was genuinely stamped 160 sim-minutes EARLIER and
sorted to the top. The sort was always right; the clock lied.

**IT WAS NEVER ONLY CHAT.** Anything persisted and then ordered or compared across devices
inherited a per-device clock. The audit found one site beyond the ones I listed:
`maybeAutoExecuteTrades` in **lg-ui** makes the same expiry comparison as `executeTrade` in
lg-core — leaving it would have had the UI and the core disagree about whether a review window
had closed. **Pre-fix the suite reproduces the trade bug for real**: a long-open device EXECUTED
a trade the accepting device had started seconds earlier.

**THE RULE, now written at `LG.SIM_LOADED_AT` itself:**
> `LG.now()` answers *"where are we in the league's SEASON?"* — current week, waiver and trade
> deadlines, lineup locks, game state. It is the replay clock and it is per-device BY DESIGN.
> `Date.now()` answers *"when did this actually happen?"* — and is the ONLY acceptable stamp for
> anything persisted and then ordered or compared across devices.

Moved to `Date.now()`: `postChat.t`, `postSys.t`, `offerTrade.t` (it also seeds the doc id),
`acceptTrade.acceptedAt`/`reviewEndsAt`, the expiry compares in BOTH `executeTrade` and
`maybeAutoExecuteTrades`, `snapshotProjections.at`, `finalizeWeek.finalizedAt`. Already correct
and untouched: `logTx.t`, `addClaim.t`, the rules change-log, `LG.db` cache freshness. **Left on
`LG.now()` deliberately** (league-calendar or game-state, none persisted-and-cross-device):
`currentWeek`, `tradeDeadlinePassed`, waiver-deadline compares, lineup locking, the whole slate
layer, in-memory feed stamps, the auto-check throttle. One judgement call named rather than
fixed: `UI._aiRead.at` is an in-memory 5-min TTL that under 8× expires in ~37 real seconds —
neither persisted nor cross-device, costs at worst a repeated AI call.

**MIGRATION: NONE NEEDED, and it is proven rather than assumed.** A sim stamp is a FIXED 2025
instant (~1.757e12); a wall stamp is now (~1.786e12) and only grows — so legacy always sorts
before new, which IS the true chronology. Verified with a seeded mixed history, and the check is
not vacuous: pre-fix the same fixture reads `legacy one > legacy two > posted right now >
already migrated`, because the new message got a 2025 stamp. **Nothing of the family's was
normalised or rewritten.**

**WHY THE SUITE COULD NOT HAVE CAUGHT THIS.** Every section boots `?sim=0`, where `LG.now()` IS
`Date.now()` — and everything runs in ONE page, where a per-page-load clock never varies. The
bug was structurally invisible. New section **AF** runs with the **replay ON at 8×** and
simulates a second device by rewriting `SIM_LOADED_AT` mid-run, in both directions, plus a guard
asserting a stored chat stamp is within seconds of real `Date.now()` and nowhere near `SIM_NOW`.

**THE BANNER IS GONE (user: "I know we are in a test environment")** — `#simBanner`, its CSS,
`syncSimBanner()` and the now-dead `banner` field on both phase entries. The
projections-are-estimates note goes with it and was NOT reinvented elsewhere. **Both hazards I
flagged were real**: the paint function was also warming the replay's projection cache on every
view change (survives as `simWarmProjections()`, same three call sites — without it projections
silently stop resolving on a screen reached before any matchup/moves/locker page), and the
offline chip measured its own sticky `top` off the banner's height (now 46px desktop / 52px
mobile, asserted at both widths).

**VERIFIED**: **1313/1313, 0 page errors** (1315 with `--shots`). Pre-fix, app files stashed to
HEAD: **1292 / 21**, and two of the failures are the user's report verbatim — *"the phone's
message is stamped AFTER the desktop's, though the phone's replay clock reads far earlier
(−9600000ms apart)"* and *"…and it renders BELOW it, not on top — the reported symptom (DOM rows
1 then 0)"*.

**A LONG-STANDING VACUOUS CHECK SURFACED**: `ok(/Proj/.test(mu.head), "the header carries a
projected total")` had been matching the BANNER's "**Proj**ections are estimates." — never the
header, whose label is lowercase. Removing the banner is what exposed it. It now reads
`.muhproj` and asserts both sides are bare numbers. Restaged with reasons: sections J and K aged
a trade's review with `LG.nowOverride`, which only moves the LEAGUE clock — they now age the
wall-time deadline, and J additionally has to drive `maybeAutoExecuteTrades()` because the old
staging defeated the auto-check throttle as a side effect. Section X's phase assertions read the
banner's copy; they read the phase itself now. AB7b's chip-below-banner geometry became
chip-under-header.

Plates: `shots/gffl_replay_nobanner_{390,desktop}.png`, `gffl_rest_offline_desktop.png` (re-taken
— the chip no longer needs the banner hidden first).

**THE HEALTH CHIP IS A WARNING, NOT A BADGE** (2026-08-09, same day, user: *"get rid of it"* —
the `● REPLAY` pill left on the League page after the banner went). `paintHealth` now returns
early and HIDES `#healthChip` whenever `h.mode === "dual"`, so a healthy board says nothing at
all; the ok/warn/bad classification is otherwise untouched and the chip still appears — and
still names the surviving source — the moment a source degrades. Rationale written at the
function: under the replay the "healthy" state was also a standing test-environment reminder,
the same one the banner was removed for. **Three suite checks restaged with the reason in
place** (league home, and the two replay sections that asserted it read "replay"); the three
DEGRADED checks — `ESPN only` / `Sleeper only` / `STALE out loud` — are unchanged and are what
still prove it speaks up when it matters. Suite **1313/1313** (a straight swap, no net change).

## 🏆 GFFL-CONNECT — Bucky drops the old ESPN league and adopts the GFFL (2026-08-13)

User: *"we need to connect Bucky to the GFFL now, it is currently connected to our old ESPN
league."* Two user decisions shaped it: the GFFL is **its own Bucky bottom-nav tab embedding
the real league app** (the sports/farmgpt persistent-iframe pattern — league.html is
SAME-ORIGIN, goatfantasyleague.com being an alias of this Netlify site), and the ESPN-specific
extras (Fantasy AI ask box, Nerd Report, free agents) are **retired outright** (the GFFL app
has its own AI). Files: `index.html` + `sports.html` + `league.html` + the 5 mirrored-nav
satellites (farmgpt/games/weather/activity/status) + 4 suites. **Server untouched** —
sports.mjs's ff_* actions and farmgpt.mjs's fantasy/ffrecap modes remain (unused by any
client now; the server suite sections and the diag workflow's live ff smokes keep passing).
Built split: index/league/satellites/suites by the main session, the sports.html excision +
its suite restage by a delegated opus agent (its report re-verified by an independent run).
- **THE 14th NAV AREA `gffl`** (🏆, an SVG trophy in NAV_PATHS, entry after Sports) — a
  pseudo-tab like sports/gpt: DEEP_LINK_TABS `#gffl`, `renderEmbedTab("gffl")`, EMBEDS entry
  `league.html`. UNLIKE sports/farmgpt the league KEEPS its own header + internal nav inside
  the frame — it is a full sub-app whose tabs Bucky's bar doesn't replicate. First use on a
  Bucky device asks the GFFL gate password once (localStorage is per-origin). The 5 satellite
  navs + sports.html's own each gained the entry + the path (all say keep-in-sync).
- **league.html listens for Bucky's `bucky-embed-visibility`**: covered → `D.stop()` (no 8s
  live polling behind another tab), uncovered → `D.start()` (whose loop's first tick IS the
  catch-up poll). Guarded on `loopStarts > 0` so a pre-boot event (the gate screen) can never
  arm a loop the boot hasn't started. Standalone the event never fires. Suite AY7 proves all
  three (stop / resume / pre-boot guard).
- **THE HOME FANTASY CARD IS GFFL-NATIVE** (`gfflHomeFetch`/`paintFfCard` in index.html):
  five public-key Firestore REST GETs against `gffl_fam2jan2g` — `settings` (draftAt),
  `sched_<season>` (this week's pairing; decoded via the SAME `{g:[{h,a}]}`-or-legacy rule as
  lg-core's loadSchedule), `weekly_<season>_w<N>` (the real final once the write-once record
  exists), and the two team docs. Shows "🏆 GFFL · Week N", my team + "vs <opp>", the draft
  countdown while `draftAt` is ahead, finals once a week settles. NO live totals — live
  scoring is the league app's engine, one tap away (the card's tap → the GFFL tab). Hidden
  when the team doc can't be read (honest absence, never a guess). Cache `bucky_gffl_home`
  keyed by team id (a profile switch invalidates). **Which franchise is mine = TEAM ID**:
  `gfflMyTeamId()` { isaac:12 GOAT Kids, grandpa:3 Wyoming, mom:5 Nails } default 1 (BK) —
  DUPLICATED as sports.html's `GFFL_TEAM_BY_USER`, keep in sync (the third copy of this
  house-convention duplication; the retired ESPN name-map was the same shape).
- **sports.html's ESPN fantasy stack is GONE** (−761 lines): the Fantasy pill, both fantasy
  views, all loaders/renderers/gate cards, the lineup guard, the whole Grok-advice block, the
  Nerd Report, the fantasy CSS families, the ff state + hook fields. `#fantasy`/`#ffm=…`
  hashes (old bookmarks, the old home-card handoff) fall through SILENTLY to the NFL week
  view. **The "🏆 N of yours" badges survive, re-sourced**: `loadMyGfflCounts()` reads
  `roster_<season>_w<wk>_t<myId>` straight from the GFFL's Firestore (week via lg-core's own
  formula), counts non-BENCH/non-IR rows per NFL team with **WAS→WSH normalized** (rosters
  mix ESPN-imported "WSH" and Sleeper-sourced "WAS" spellings; the scoreboard speaks ESPN).
  404 = no badges, silently — badges are a bonus, never break the scores.
- **SUITES**: sports **229/229** (section F rewritten as a retirement contract — pill gone,
  hashes fall through, no ff_* request on a normal boot; badges re-fixtured with the
  arithmetic stated — PHI@DAL "2 of yours" with BENCH+IR counting nothing, `ffMine.WSH===1`
  proving the normalization; section G = the GFFL home card incl. Isaac→GOAT Kids and
  tap→embed_gffl) · gffl **2580/2580** (AY7) · activity **147/147** (13→14 links/rail,
  columns stay 7 = ceil(14/2)) · chore-care **50/50** (the 55px button floor restaged 55→48
  WITH the arithmetic: the 14th area pushes a kid's bar from 6 to 7 columns → ~51px buttons,
  still well over the app-wide 44px touch floor) · beacon-safety **96/96** · a 10/10
  scratchpad smoke (gffl_connect_smoke.cjs: nav+icon, embed create/hide/flag, honest-absence
  card, Dad's card "Battle Kreussers vs Elanikan Skywalkers · Draft: Sun, Sep 6, 3:00 PM CT",
  tap→tab).
- **GOTCHAS worth keeping**: index.html's unlock seed is `choreUnlocked = "amenfarms"` (the
  PASSWORD, not a flag — a "1" leaves the lock up and reads as "the app is broken");
  `goTo()` navigates via `history.pushState(STATE)` with NO URL, so in-app taps never move
  `location.hash` — assert the embed/currentTab, never the hash; `document.body.textContent`
  INCLUDES `display:none` content, so "the lock screen is showing" can never be read from
  body text (the lock's copy is always in the DOM); and a cross-origin `req.respond` mock
  needs `access-control-allow-origin: *` or the fetch dies before any logic runs.
- **THE LIVE-DOC PROBE CAUGHT A SPEC ERROR the suites could not** (same night): the settings
  doc's `draftAt` lives INSIDE the `rules` map (`LG.rules = doc.rules` is the league's own
  read path) — the home card's first reader and the suite fixture both used a flat top-level
  shape from my own spec, and the fixture faithfully encoding the wrong shape kept the suite
  green. Probing the REAL doc surfaced it. Fixed three layers: the reader
  (`settings.rules.draftAt` first, bare top-level tolerated), the fixture (restaged with the
  reason), and the LIVE DOC — which predated S2's field entirely — via backup → masked PATCH
  (`updateMask=draftAt&rules.draftAt`, body carrying only the nested one, so the stray
  top-level from the first attempt was DELETED in the same call) → canonical re-read proving
  every rules sibling byte-identical (raw JSON.stringify of a Firestore read is key-order
  noise — canon-sort before comparing, the stableStr lesson again). Also proven live: week-1
  pairings 12v1 · 11v2 · 9v3 · 5v4 (GOAT Kids @ Battle Kreussers).
- **KNOWN / FOLLOW-UPS**: league.html's own Scores tab still carries the ESPN-league card
  (self-hides while all-zero; worth removing now that league is abandoned — flagged, not
  done); the ESPN cookies (ESPN_S2/SWID) stop mattering for Bucky's UI and can be left to
  expire; `_probe-sports.mjs` still exercises the ff_* server actions (they exist) — retire
  those probe checks whenever the actions themselves go.

## 🏟 GFFL — THE GAMECAST GOES BROADCAST-STYLE (2026-08-13/14, user's ESPN-screenshot brief)

User (with a reference screenshot): *"modify our nfl game cast to be a clone of ESPN — note
the isometric view, the drive progress, the current drive description and team logo, the very
clear down and distance in the middle, and win probability."* Layout CONCEPTS mirrored, every
pixel our OWN drawing in the GFFL's broadcast language (own SVG, house tokens, the team
crests/colors already in use). Files: `netlify/functions/sports.mjs` + `assets/league/
lg-ui.js` + `league.html` + `tools/_verify-gffl.cjs` (2580 → **2595**).
- **SERVER (`slimPlay`)**: plays gain `type` (play-type text), `yds` (statYardage) and
  `start.yardsToEndzone` — the dotted per-play path needs where each play BEGAN, the headline
  needs "<n>-yd <Type>", and kicked plays (punt/kickoff/FG by type regex) draw ARCS.
  Backward-compatible (defaults ""/null) — sports suite 229/229 untouched.
- **THE FIELD (`nflFieldSvg`) is a SIDE-VIEW slab now**, not a top-down gridiron: skewX(-10)
  lean, end-zone slabs in the teams' real colors wearing rotated NICKNAME wordmarks
  (`textLength` pins long ones), goalposts BEHIND each end zone (drawn first so the slab
  occludes below the turf line; counter-skewed upright), alternating 10-yd shading, the gold
  first-down line poking above the strip, the yard row BELOW it (abbrev 10..50..10 abbrev),
  and the ball as a team-crest PIN (teardrop, counter-skewed upright, disc fallback if the
  logo never decodes). THE DRIVE renders as DOTTED PER-PLAY SEGMENTS along the surface (arcs
  for kicks, peak scaled by distance); the container keeps the superseded progress-arrow's
  exact data contract (`data-x0` = drive start, `data-x1` = ball) so the suite's hand-computed
  691.7→183.3 numbers read off `.nfldpath` unchanged.
- **FRAME MATH, learned from plate 1**: the skew leans the slab past the viewBox (both end
  zones' corners CLIPPED, and the right goalpost cut through the EAGLES slab when drawn
  outside the group). Fix: `translate(FY.bot·tan)` puts the slab's bottom-left at x=0 and a
  `scale(1000/(extent))` fits the lean inside the 1000-unit width; the yard row shares the
  scale (bottom edge lands at 0 by construction). The strip is TALL (118 units) because at
  390px the viewBox is ~366px wide and a thin slab made the wordmarks/numbers illegible.
  GEOMETRY CONTRACT: fieldX/fieldPos/firstDownPos untouched; data-* attrs carry MATH x —
  the suite asserts arithmetic, never pixels, so the frame can't invalidate a check.
- **THE CHROME** (nflGameHtml's live card): CURRENT DRIVE header (possessing crest + the
  drive's own "N plays, N yards, M:SS" description), the last play's TYPE as a centered event
  label, the very clear **Down: 1st & 10 · Ball on: DAL 12** strip (ball-on derived: past
  midfield = the opponent's numbers, before it = the offense's own), and the LAST-PLAY card —
  headline "<n>-yd <Type>", live **Win %** off the winprob series' newest point with the
  leading crest, a "Last Play" chip, the full play text. `.nflsitu`/`.nfllast` retired.
- **SUITE**: AH3's arrow checks RESTAGED to the path (same data contract + "dotted per-play
  segments, not a solid bar"), + skew/pin/wordmark/yard-row checks, + the chrome hand-derived
  from the fixture (drive header text, event label, Down/Ball-on centered, headline
  "49-yd Pass Reception", Win % 66.0 with crest). Fixture's `nflPlay` helper gained OPTIONAL
  startYTE/type/yds params (old call sites byte-identical); the current drive's plays carry
  the real chain 73→64→61→12. ONE own-goal on the first run: `/Down: 1st/` with a literal
  space — label and value are ADJACENT elements and textContent runs them together (the AE
  lesson, again); the visible gap is the flex gap. `\s*`.
- **FOUR-FIX ROUND (2026-08-14, user, from the deployed look)**: (1) **goalposts** moved from
  inside the end zones to the field's own FAR EDGES — x=0 and x=1000 ARE the two back lines —
  standing at `FY.mid`, the middle of the field's depth, counter-skewed upright and drawn LAST
  so the whole post reads instead of being half-buried; the frame gained `FPAD` 26 (solved, not
  tuned: leftmost slab point is (0, FY.bot), rightmost (1000, FY.top)) so the overhanging
  crossbars can't clip. (2) **The gold and white lines span EXACTLY the strip** (`FY.top`→
  `FY.bot`) — they used to poke above it like a broadcast overlay, which read as floating.
  (3) **A DASHED white line marks where the drive started** (`.nflstart`, suppressed when it
  would sit on the line of scrimmage). (4) **THE END ZONE WEARS THE NICKNAME ALONE** — and this
  was a REAL BUG the fixture was hiding: probed live, the summary endpoint's header competitors
  carry `nickname`/`name` ("Broncos"), `location` and `displayName` ("Denver Broncos") but NO
  `shortDisplayName`, so slimGame's `shortDisplayName || displayName` chain fell through to the
  full name on every real game while the fixture — which invented a `shortDisplayName` — kept
  rendering "EAGLES" on every plate. Server now prefers `nickname || name`; the fixture MIRRORS
  the real payload; and the suite's check is an EXACT match (a contains-check would have passed
  on the very bug reported). Also fixes sports.html's own field, which `.slice(0,10)`s that
  string into "DENVER BRO". Suite 2595 → **2602**.
- **DOWN · DISTANCE · POSSESSION ON THE SCORE CARDS (2026-08-14, user: "on the summary score
  for each game, we need to show down, distance and who has possession")** — and the enabling
  finding is that **the SCOREBOARD endpoint carries `competition.situation`**: probed live,
  three in-progress games returned `shortDownDistanceText` "4th & 7", `possessionText`
  "DEN 38", `possession` (the team id) and `isRedZone`. lg-data's parser had a note saying the
  scoreboard "carries no drive at all" — TRUE of drives, and it had been read as ruling out
  situation too. `pollScoreboard` now slims it onto each event, **resolving the possessing
  SIDE at parse time** against that event's own competitor ids so no renderer ever matches ids
  again. The card gains a centered `.scsitu` line ("PHI ball · 1st & 10 · DAL 12 · RED ZONE")
  plus a `.scposs` gold pip on the possessing team's nickname (the at-a-glance half; the
  matchup rows' own gold-means-possession language), both accent-red in the red zone. LIVE
  ONLY — a final or upcoming card carries neither, asserted.
- **A FREE WIN FROM THE SAME PARSE**: `games.poss` (what the matchup's possession ring reads)
  came only from the per-game SUMMARY poll, which reaches ≤8 games a cycle on a rotating
  cursor — so on a full Sunday the 9th+ game's ring could be minutes stale. The scoreboard
  carries possession for EVERY live game on every 8s tick, so it now feeds the map, falling
  back to the carried-across summary value when unknown (strictly additive; AD5/AD5b/AG7 all
  green unchanged).
- Fixture: competitor `id`s (ESPN's real team ids, PHI 21 / DAL 6 — matching the summary
  fixture so both endpoints tell ONE story about who has the ball) + a live `situation`
  spotted at DAL 12, which is inside the 20, so the RED-ZONE branch is a real case rather than
  an untested one. Suite 2602 → **2607**.
- **KNOWN / FOLLOW-UPS**: sports.html's own game view still renders the OLD flat field — port
  after the family approves this look (the rendering exists twice by documented choice); the
  drive path only draws the CURRENT drive's own plays (the reference sometimes shows the
  punt that handed the ball over — that play belongs to the previous drive and stays there);
  fixture arcs are unexercised (all ground plays) — the kicked-arc branch is regex-gated and
  live preseason games will exercise it, worth an eyeball on the first real punt.
  Plates: `shots/gffl_nflgame_{390,desktop}.png`.
---

## 🏈 GFFL — moves rework, Suggest a trade, and the matchup's colour language (2026-08-09)

Eight items from one playtest pass. Files: `league.html` + `assets/league/lg-ui.js` +
`tools/_verify-gffl.cjs` (1313 → **1420**). `lg-core.js`, `lg-data.js` and
`netlify/functions/league.mjs` untouched.

**MOVES — the Waivers card is three data blocks**, both prose paragraphs gone: FAAB budget ·
Free agency · Waivers, with the regime in force outlined and tagged "Now", the other visibly
stood down, and the deadline moved INSIDE the waiver block as its value. "Process now" survives
for the commissioner. **One fact was genuinely dropped** — "adding/dropping isn't locked by
kickoff, only your starting lineup is." It is a standing rule rather than a fact about this
week, and the locker already says it at the point it bites, by disabling a locked Swap.

**THE TRADE BUILDER STARTS COLLAPSED.** Each side is the players already chosen plus a `+`; the
picker's rows are **built only while open**, so a collapsed side costs no DOM. Card height
~1100px → **388px**. Chosen players survive a collapse; at the 3-cap the `+` becomes the limit
line. `UI._tradeGive`/`_tradeGet` and the send path are untouched.

**⭐ SUGGEST A TRADE — local and deterministic, deliberately NOT an AI call.** It has to be
instant, and *a suggestion nobody can predict cannot be asserted*. A player is worth
**0.65 × season average + 0.35 × this week's projection** (whichever exists). Per position,
strength is the summed value of the top N where N is the starting requirement, so
`edge(pos) = mine − theirs` makes "weaker" computable: it sends from a POSITIVE edge and
receives at a NEGATIVE one, which makes "helps both sides where they are weaker" true by
construction rather than by hope. **Tolerance: 1.5 points or 15% of the larger side, whichever
is bigger**, then the lowest RELATIVE imbalance wins — so a real swap of starters beats a
trivially equal swap of bench bodies. Locked and IR players excluded; both rosters must still
meet every positional minimum (flex pool included) afterwards. Falls back 1-for-1 → 2-for-2 →
relaxed → says plainly that nothing fits. **It never sends.** Suite asserts the arithmetic
against hand-built rosters whose right answer is derived in the comments (20 for 19, gap 1.0,
inside the stated tolerance), plus the locked-player fall-through and the 2-for-2 case.

**PLAYERS TABLE re-ordered to PLAYER · ADD · TYPE · PROJ · LAST · OPP · AVG.** PLAYER stays in
front as the row's label — the user's list was of the DATA columns, and anonymous rows are
useless. **⚠ STATUS, SCORE and FPTS are DROPPED — a real loss, not a tidy-up**: SCORE was this
week's live points, FPTS the season total. Both survive on the player's own stats card, which
any row opens; AVG and LAST still carry the season. The ADD button is a real `disabled` control
naming the reason ("Already on your team", the owning team, "You have nobody to drop") rather
than an empty cell; **an empty FAAB purse is NOT a reason, because a $0 blind bid is legal**.
Default sort FPTS → AVG desc. **Mobile at 390px**: PLAYER/ADD/TYPE/PROJ right edges at
**116/174/210/252** in a 342px box — all four visible with no panning at all.

**MATCHUP — the centre band's colour IS the column**: badge at full width and height, zero cell
padding, consecutive cells still meeting with no seam. Type 11→**16px** desktop, 9→**13px**
mobile, with 4+ character labels stepping to 0.72em so BENCH/FLEX stay inside an 11%-of-390px
column (the previous batch found BENCH spilling 10px; asserted against a `Range`, not
`scrollWidth`, which reports nothing on an `overflow:visible` element).

**RED MEANS ONE THING NOW.** The live clock gave up `--accent` for the ordinary muted stat
colour (keeping its bold weight); `.inj` took the accent, on the single shared rule all five
surfaces read. **And the matchup had no injury designation at all** — the ESPN-layout batch cut
the row to three fixed lines and it did not survive. Restored on **line 2**, not after the name:
line 1 is the width-constrained one (item 17 fought to fit `J. Smith-Njigba`, and the possession
ring had already taken 3px of its 6px slack). The designation **LEADS** line 2 — that ordering
is load-bearing, because the line is `nowrap` + ellipsis, so whatever sits last is what gets
cut, and "this man might not play" must never be the thing cut; the kickoff time loses its tail
instead. Measured: line 2's box is 116px, the tightest real case (`OUT` + `@DEN Fri 1:00 AM`) is
116px of ink in 116px, and the designation costs **9px** (it inherits line 2's own 9.5px type
rather than the 10.5px first tried, which put that row 2px over).

**POSSESSION IS AN INSET GOLD RING**, replacing the pip and row tint — painted, not laid out, so
a highlighted row measures exactly its neighbours. Never a D/ST, never under the replay.
Knock-on paid back: the ring wanted 3px a side, so the cell handed the same 3px back (1px cell +
2px grid padding); name budget re-measured at **101px against a 97px need**, 0 of 26 clipped.

**VERIFIED**: **1420/1420, 0 page errors**. Pre-fix with the app files reverted to `main`:
**1335 / 85** — every new check across all eight items fails, each on-point (the old 9-column
header, the prose still present, the band not filling, no gold ring, line 2 absent, the card not
yet three blocks).

**TWO MEASUREMENT LESSONS worth keeping.** (1) `.pmeta` is a BLOCK, so its `scrollWidth` is
floored at `clientWidth` and reports "116 of 116" for anything that fits — a number that cannot
tell you how much room is LEFT. Headroom must come from a `Range` over the line's contents using
`getBoundingClientRect` (the union); **summing `getClientRects()` double-counts on mixed inline
content** and produced a nonsense 224px. `scrollWidth` is still the right overflow assertion.
(2) A designation and the game text sharing one line with only a CSS margin between them run
together in `textContent` (`"D" + "KC Fri…"` reads `"DKC Fri…"`), which silently broke an
existing `^KC` check — `gameLineHtml` now wraps in `.gline` so the game half can be read alone.

**RESTAGED, each with its reason at the check**: I2's column-set/rostered-row/dropped-column
block, J1 and Y4's trade-picker staging (sides must be expanded first), X's replay free-agency
copy (now reads the two blocks' on/off state — a stronger check than the sentence), AD2 and AE's
"compact badge" (superseded and INVERTED by item 23), AD5's possession pip, the players-table
sticky-column pan (three fewer columns, so a hardcoded 220px scroll now clamps short), and three
AE line-2 reads for `.gline`.

**EIGHT self-caught false passes** across the two rounds — an element that does not exist is not
"not red"; a missing `suggestTradePair` is not "returned null"; a `waitFnOr` followed by
`ok(true, …)` asserts nothing; "out of the picker" is free when there is no picker; and both
"the clock is not red" and "a healthy team-mate shows nothing" are free on a page where nobody
carries a designation, so each is now paired with the `Q` actually being present.

Plates: `shots/gffl_moves_{390,desktop}.png`, `gffl_trade_suggest.png`, `gffl_matchup_390.png`.

## 🏈 GFFL — every game gets the full card, and an NFL game view inside the league (2026-08-09)

User: *"every single game in the league should have the same score card that's like the one you
have now for the current user"* + *"clicking an NFL game should take you to a scoreboard style
thing … box scores, the play by play, and the field."* Files: `league.html` +
`assets/league/lg-ui.js` + `tools/_verify-gffl.cjs` (1420 → **1514**). `lg-core.js`,
`lg-data.js`, `sports.html` and `netlify/functions/sports.mjs` all byte-untouched.

**ITEM 27 — the state strip is on every card.** `matchupCard` renders `matchupHeroExtra`
unconditionally; `.mine` keeps its class and its bigger hero layout. **Two bugs it exposed, both
found by LOOKING at the plate**: (1) the hero's explicit `grid-row:3` would have parked the
strip in an empty third row on the compact card — scoped under `.mine`; (2) **a matchup with no
roster data announced itself as FINAL** — `allDone` was `!anyLive && left===0` on both sides,
which is TRUE when zero starters are known. On the viewer's own card that never happened;
across every card it does. Now gated on `counted > 0`. And with nothing to weigh, `winProb`
returns 0.5, so three stacked bold half-bars read as three real results — those render an empty
`.wpbar.unknown` track instead. **KNOWN, deliberately not restaged**: the same `allDone`
expression exists on the Matchup page header (a different surface); noted in the comment there.
Cost: three in-memory reads per game instead of one, nothing hoistable (each call is a different
team), asserted at **zero** extra backend reads against section P's budget.

**ITEM 28 — `#nflgame=<id>`, a sub-view of Scores** (same hash-carries-its-subject shape as
`#locker=`). Back sets `#scores` AND the view, so a reload after backing out stays on Scores.
Score cards are real `<button>`s with aria-labels; a slate row with no id renders inert rather
than opening a `bad-event-id`.
**THE BACKEND IS REUSED, NOT REBUILT**: `sports.mjs`'s existing `nfl_game` action, reached with
`LG.PASS` — which IS `BUCKY_NOTIFY_SECRET`, so the league can call it with no server work at
all. Renders the field (drive band, LOS, gold first-down line, direction arrow, ball), the
play-by-play (current drive newest-first then previous drives), per-team box scores, linescore,
win-prob sparkline, team stat bars, scoring plays. Pre/live/final each get their OWN shape —
pre-game is a kickoff card (when/where/line) with **no** field or drive shells, final drops the
field and keeps the rest. Polling 25s live / 120s pre (so kickoff is noticed) / **never** for a
final, cleared on view change. A failure gets a named reason and a working retry.
**THE DUPLICATION COST, stated plainly**: the RENDERING now exists twice, here and in
`sports.html`, so an ESPN payload drift needs two updates. Genuinely shared rather than
duplicated: one server, one slimmer, one secret, and one field-coordinate convention — **ported
verbatim, not re-derived** (`x = 83.33 + pos·8.3334`, possession flips the direction; the suite
hand-computes ball 183.3 and first-down 150.0 IN THE TEST).

**A PRE-EXISTING BUG FOUND OFF THE PLATE'S PIXELS**: the bare `.live { color:var(--accent) }`
rule cascades into `.sccard.live`, so a live game's abbrevs and scores rendered
`rgb(213,10,10)` while an upcoming card's rendered `rgb(233,237,244)` — the whole card went red,
not just the clock. Fixed with an explicit `color` on `.sccard`; the live clock keeps the accent.
Two more plate fixes: desktop was full-bleed (the field stood 338px tall, scores marooned in a
1150px row — `#nflBody` is a 720px reading column now), and pre-game showed two big "0"s with
the kickoff time in the LIVE red and the venue printed twice.

**VERIFIED**: **1514/1514, 0 page errors** (1516 with `--shots`). Pre-fix with the app files at
HEAD: **1457 / 57, every failure in the new section AH** — and 1457 = 1420 + 37, so all 1420
pre-existing checks pass on BOTH sides and **no restaging was required**. The 37 invariants are
the thirteen "0 page errors", the no-sideways-scroll pairs, the card/`.mine` counts and the
`db.stats` budget.
**FIXTURE NOTE**: the game fixture is a real RAW ESPN summary shaped to what `slimGame`
consumes, served by a 5th fake upstream — the page's request interception cannot reach it,
because `siteGame`'s fetch runs in Node, not the browser.
**A SUITE STAGING BUG FIXED**: `gffl_scores_390.png` had been photographing the LEAGUE HOME
since it was added — the poll-cleared check immediately above it navigates away. It navigates
back before shooting now.
**NOT LIVE-VERIFIED**: ESPN is egress-blocked here, so the fixture carries the whole burden.
Post-deploy, open one real live game and confirm the ball lands where the situation says.

Plates: `shots/gffl_scores_390.png`, `gffl_nflgame_{390,desktop}.png`, `gffl_nflgame_pre_390.png`.

## 🏈 GFFL — THE 2026 FLIP, AND THE PRESEASON TRAP IT UNCOVERED (2026-08-09)

User: *"lets clear out all the 2025 data and reset to 2026, lets fill each roster with 2nd and
3rd stringers and run the app live on this upcoming week 1 of preseason"*, and separately chose
**shakedown** over scoring it for real. Files: `assets/league/lg-{core,data,ui}.js` +
`tools/_verify-gffl.cjs` (1514 → **1620**). `league.html` needed nothing.

**"FLIP ONE LINE AND NOTHING ELSE" WAS TRUE ABOUT WHAT IT NAMED, AND DANGEROUSLY INCOMPLETE.**
All fourteen `LG.SIM_2025` consumers were walked and the comment held exactly — `SEASON`/
`SEASON_START`/`now()` revert together, the auto-setup, phase card and projection warmers all
early-return, the historical-slate parser never fires, live polling returns, the doc ids address
2026. **None needed touching**, asserted on the wire (zero `dates=` requests, `simProj` never
built, no setup card, Sleeper's own week recorded). What the comment could not cover is that
**nothing had ever run this code in August**.

**⭐ THE TRAP: PRESEASON WEEK 1 AND REGULAR WEEK 1 ARE BOTH "1".** Before `SEASON_START` the
league-week arithmetic goes negative and clamps to 1, so from the start of preseason until the
real opener `LG.currentWeek()` and `D.engineWeek()` **agree exactly** while the board holds
exhibition football. Every existing gate was therefore satisfied — the weeks match, and by
Sunday night every starter's game reads Final — and `weekly_2026_w1` is **WRITE-ONCE**.
Standings, waiver priority, power rankings, playoff seeding and the record book would have
carried a preseason result all season with no way back. Flipping the flag alone would have
permanently corrupted the season the first Sunday of preseason.
**THE FIX is a second provenance dimension**, the same shape as the week one: `D.engineSeasonType()`
/ `D.engineRegular()`, read from ESPN's `season.type` (numeric AND slug AND the nested legacy
shape) and Sleeper's `season_type`, with the same disagreement-means-null rule. `finalizeWeek`'s
live path requires **positively regular** — unknown fails CLOSED, and `force` does not bypass it
(force only ever meant "some games aren't final"). Strict over permissive deliberately: a closed
failure lands on the stale-weeks card the league already knows how to recover from; the
permissive failure is a silently-wrong permanent document.
**TWO MORE PRESEASON HOLES from the same audit, both of which would have written zeroes**: once
the engine rolls to preseason week 2, week 1 was listed "stale" and the card's button would
backfill `/stats/nfl/regular/2026/1`, a week nobody has played (`staleFinalizeWeeks` now returns
nothing outside the regular season); and Sleeper answers **200 with `{}`** for an unplayed week,
and an empty Map is truthy, so the backfill took it as real data (an empty payload is now "no
archived stats").
Everything else follows the NFL on its own, asserted on the wire: `/stats/nfl/pre/2026/1` and
`/projections/nfl/pre/2026/1`, never the regular bucket. Hand-computed from the preseason box
(P. Passer 7.0 not his regular 10.0; totals 13.2 / 3.0).

**BACKUPS, BECAUSE STARTERS DO NOT PLAY IN PRESEASON.** `depth_chart_order` was already in the
Sleeper payload and nothing read it — two field reads per entry, no new network. Pool = order 2
or 3, real NFL team, fantasy position, not genuinely out — **Questionable is KEPT**, a dinged 2
plays plenty of preseason. Ordered depth → search_rank → pid (a TOTAL order, so two runs cannot
disagree). Team defenses have no depth chart and are drafted from their own list. Distribution
is a **snake over sorted team ids** — a straight pass would hand team 1 the best player at every
position. Same slot script for everyone, sized from `LG.rules.roster`. Exhaustion is reported,
never silent. Commissioner-gated Rules-page action with a **two-step confirm** naming the week,
the teams, each roster's current size and a sample of who is about to be dropped; re-running is
byte-identical. **It REPLACES the existing 2026 rosters** (starters, from the earlier ESPN
import) — backed up to the session scratchpad before the real run.

**A GENUINE PRODUCT BUG FOUND BY THE PLATES**: `startData()` builds the tracked-team set once at
boot and `pollSleeper` FILTERS stats by it, so after a wholesale roster replacement half the new
players read 0.0 until a page reload. `retrackTeams()` extracted and called after the fill.
(Waiver adds and trades have the same staleness — pre-existing, deliberately not widened into,
noted in the code.) Two fixture/plate bugs with it: the ESPN fixture credited each defense from
its own stat block, but those numbers are OFFENSIVE (sacks *allowed*, picks *thrown*), so the
two D/STs came out swapped; and the confirm plate had photographed the button row rather than
the card, which renders at the bottom of a long page.

**VERIFIED**: **1620/1620, 0 page errors** (1624 with `--shots`). Pre-fix on the identical
suite: **1551 / 69** — 68 in the new section AI, 1 a restaged literal. All 1514 pre-existing
checks pass in both worlds. Restaging was mechanical `?sim=1` (section X, AC, two AD/AE replay
blocks) plus two literal restages, each with its reason at the check. AI4 is the one to read: it
stages the state so **every other gate would have passed** (engine week 1 = league week 1, every
game Final) and asserts the season-type guard is the only thing refusing — the mechanism, not
the outcome.

**WHAT ONLY THE REAL FEEDS CAN SETTLE** (ESPN and Sleeper are egress-blocked here): that ESPN's
bare `/scoreboard` really carries `season.type: 1` in preseason — the whole guard hangs on it,
and if ESPN sends nothing readable the guard still refuses (safe) but the stale card also goes
quiet, so check `__GFFL__.D.engineSeasonType()` reads `"pre"` on the live site; that Sleeper's
`/state/nfl` says `pre`/week 1 and `/stats/nfl/pre/2026/1` has lines in it; whether Sleeper
serves preseason PROJECTIONS at all (if not, the PROJ column reads "—" everywhere — bare, not
broken); the real depth-chart pool's size (the success card reports `ran out at:` if a minimum
cannot be met); and the roster size, which comes from the LIVE rules doc.
`sched_2026` was checked and EXISTS (14 weeks, 4 week-1 pairings), so the league has matchups
the moment the flag flips — no Generate-schedule step needed.
Flagged rather than changed: the league home's FINALIZE WEEK 1 button stays visible in preseason
and refuses with *"the NFL is still in preseason — nothing counts yet"* — a clear refusal beats
a hidden control.

Plates: `shots/gffl_2026_{league,matchup}_390.png`, `gffl_backups_confirm_390.png`.

## 📱 GFFL — BACK WALKS THE APP, AND IT INSTALLS AS ONE (2026-08-10)

User: *"clicking back takes you to the previous page you were on in the app, not out of chrome
entirely… we also need to hide the browser bar at the top so it truly behaves like an app."*
Files: `league.html` + `assets/league/lg-ui.js` + NEW `league.webmanifest` +
`tools/_verify-gffl.cjs` (1620 → **1716**). The family's own `manifest.webmanifest` and
`index.html` are untouched.

**THE TWO ARE CONNECTED, AND THE ORDER MATTERS.** In standalone there is no browser chrome, so
on Android the SYSTEM back button is the only back there is — and it fires `popstate`. Shipping
standalone without history would have made things WORSE: Back would close the whole app from
any view. History is a prerequisite for standalone being pleasant, not an independent nicety.

**THE CAUSE WAS NOT MISSING HISTORY — IT WAS TWO HALF-SYSTEMS.** Five views wrote
`location.hash` (which pushes an entry for free, so Back stepped back a view) while the other
five changed view through a bare `UI.show()` that touched history not at all. Sometimes one,
sometimes the other. That inconsistency WAS the bug.

**ONE MECHANISM: `history.pushState`, with the view's own hash written as that entry's URL.**
Chosen over extending hash routing because it is the only one of the two that can carry a
**non-URL** entry, which the overlay sentinels need — "the player card is open" is not a place
you can link to and must not appear in the address bar; hash routing would have forced a second
mechanism back in for overlays. Writing the hash as the entry's URL keeps every deep link and
reload working, so the URL stays the source of truth for WHICH view. **Nothing listens for
`hashchange`** — traversal between two entries differing only by fragment fires BOTH popstate
and hashchange, so a listener would double-route every Back press.
**THE ENABLING SPLIT: `UI.show()` is a pure render, `UI.go()` is the one navigator.** Repaints
(the live poll, `LG.db.onChange`, the replay's projection repaint) keep calling `show` and
correctly leave history alone; anything a PERSON did goes through `go`.

**WHAT BACK DOES**: previous view in order, Forward re-walks it · from the root or a deep-linked
entry it **leaves** (boot is a `replaceState`, so it adds zero entries — asserted) · an open
overlay (player card, swap sheet, claim sheet, chat lightbox) closes with the **view not
moving**, and the next Back is a real view change · closing an overlay by its own ✕/Cancel/
backdrop/Escape steps off the entry it pushed, so the stack stays clean · the NFL game's
"‹ Scores" steps BACK over the game rather than pushing a second Scores (an entry field
distinguishes "tapped in from Scores" from "deep-linked straight here").

**FOUR BUGS FOUND ON THE WAY, none in the brief**: (1) `UI.show` could leave the URL naming a
different screen than the one painted — a locker mid-edit jumped to the league home when a swap
sheet closed; fixed structurally (`syncUrlToView`) so the invariant holds whoever calls what.
(2) `history.back()` inside a repaint RACES the URL write in the same turn — the traversal lands
a beat later and undoes the navigation; replacing the sentinel is synchronous. (3) `resolveView`
mutated `UI.lockerTeamId` before the "am I already here?" comparison, so a Back onto `#team`
decided nothing had moved; made pure. (4) The same trap in `UI.go` — tapping "My Team" from
another owner's locker replaced instead of pushed, costing that Back. Also hardened: popstate
refuses to route unless a REAL view is painted (`UI.view` defaults to `"league"` at module load,
so on the gate/claim/outage/setup screens it would have painted a league home over them).

**STANDALONE**: `league.webmanifest` — `display: standalone`, `start_url: /league.html`
(pointing it at `/` would install a goat that opens the FARM app), `id`, theme + background
`#0c1017` (the league's own `--bg`, so nothing flashes cream). **No `scope` deliberately** — the
default `/` keeps the Draft link (`ffdraft.html`) inside the installed window. Plus the four iOS
metas, since iOS reads none of the manifest for display mode.
**SAFE AREAS**: the header GROWS BY and pads by the top inset (a sticky `top:0` strip must still
paint to the edge, or the page scrolling past shows through); the offline chip and the desktop
sticky tab strip follow the header's new height; `.sheet` carries the bottom inset (its last row
is Cancel, exactly where the home indicator sits); `main`, `.bnav`, `.pcoverlay` and
`.imgoverlay` carry the side insets for landscape. Verified byte-identical at zero insets, so
the tabbed-browser layout does not move.
**TESTING SAFE AREAS NEEDED A REAL TECHNIQUE**: headless resolves every inset to 0, so a rule
that FORGOT one measures identically to one that carries it. The harness serves `league.html`
with its own stylesheet mechanically substituted — a rule that never asked for the inset is
untouched by the substitution, which is what makes it a genuine detector. Pre-fix it catches the
header under the notch (wordmark at 17px vs a 47px inset) and the sheet clearing by 22px not 34.

**~~⚠ THE ICON GAP~~ — CLOSED 2026-08-10**, see "THE CREST" below: the user drew it a football.
The manifest no longer reuses the family app's Bucky goat.

**VERIFIED**: **1716/1716, 0 page errors** (1720 with `--shots`). Pre-fix with the app files at
`main` and the manifest removed: **1671 / 45**, every failure inside the new section AJ — so all
1620 pre-existing checks pass in BOTH worlds and **no restaging was required at all**.
**TEST GOTCHAS**: `history.length` does NOT shrink on `back()` (a traversal doesn't truncate),
so three assertions were rewritten to check where the reader is STANDING, not a dead sentinel;
and a deep-link check needs a NONCE, because `page.goto` to a URL differing only in fragment is
a same-document navigation and would silently exercise popstate instead of the cold-boot path a
tapped bookmark takes (both paths are covered now).

**WHAT ONLY A REAL INSTALLED DEVICE CAN SETTLE**: whether Android/iOS actually OFFER the install
(Chrome wants engagement heuristics; iOS is Share → Add to Home Screen and reads no manifest for
it); whether the real notch/home-indicator values match the 47/34 modelled; whether Android's
system back GESTURE drives popstate identically to a button press; and how the splash renders
from the goat icon on `#0c1017`.
**KNOWN, documented cost**: a background cloud repaint of the SAME view while a sheet is open
leaves one dead history entry, so a single Back closes nothing visible before the next walks the
app. Neither locker nor Moves is live-repainted, so this is cloud-only and rare — and strictly
better than the race the alternative reintroduces.
**PROCESS LESSON**: `league.webmanifest` was created untracked and was LOST in a worker-process
restart mid-review; it survived only because its contents were already in context. Commit new
untracked files promptly.

Plates: `shots/gffl_standalone_safearea_390.png`, `gffl_standalone_desktop.png`.

## 🐐 GFFL — THE CREST: a league icon at last, and it rides the header (2026-08-10)

User supplied the GFFL crest (a leaping white goat on a red shield, wordmark below) and asked for
it as **the app icon** and **top-right on every page, desktop and mobile**. Files: NEW
`assets/league/gffl-logo-source.jpg` (the user's own artwork — commit-safe, same standing as their
Tripo models and the Castle Kruzer track) · NEW `tools/_gffl_icons.cjs` (the bake) · NEW
`icons/gffl-*.png` (6 files) · `league.webmanifest` · `league.html` · `ffdraft.html` · NEW
`tools/_gffl_crest_shots.cjs` (**56/56**). This CLOSES the icon gap the standalone batch flagged.

**THE KEY IS A FLOOD FILL, NOT A THRESHOLD — and that is the whole trick.** The source is a JPEG
on white paper, but the crest is a two-colour mark whose **goat, wordmark and inner ring are also
white**. "Make white transparent" would have punched the goat and the letters straight out of the
shield. Only white REACHABLE FROM THE BORDER is paper, so the key floods in from the edges: the
interior white is unreachable and survives untouched (999,230 px cleared, 1,320 feathered). The
outer shield stroke is solid red, so the fill cannot leak inward. A linear alpha ramp across the
JPEG's anti-aliased rim (min-channel 240→180) keeps the edge clean — verified against both a dark
and a white backdrop, no halo either way.

**NEW FILES, NEVER OVERWRITES.** `icons/icon-192/512` + `maskable-*` are the FAMILY app's Bucky
goat and `manifest.webmanifest` still points at them — overwriting them would have silently
re-skinned the farm app's install. Everything here is `gffl-`-prefixed and only
`league.webmanifest` references it. The suite asserts the family manifest and all four family
icons are untouched.
**Backgrounds are per purpose, not per taste**: `any` + apple-touch sit on the league's own
`#0c1017` (so icon, splash and theme are one surface, and iOS — which composites transparency onto
black — has nothing to guess at); `maskable` uses the same full-bleed background with the crest at
0.62 of the tile so a circular launcher crop cannot clip it; only the header mark is transparent.

**THE HEADER BUG THE PLATES CAUGHT, which is the one worth remembering.** First cut pinned the
crest by letting `.hmeta` (WEEK N · YEAR + avatar) keep its `margin-left:auto` and zeroing the
crest's on desktop — two auto margins otherwise SPLIT the free space and strand `.hmeta`
mid-header. But `#hMeta` ships with the **`hidden` attribute** until data lands, so on every
pre-data, gate, claim, outage and setup screen nothing pinned anything and the crest sat 1,125px
from the right edge. The fix keys the handover to the STATE, not the width:
`header .hmeta:not([hidden]) ~ .hcrest { margin-left:0 }` inside the desktop query only — mobile
never runs it, because there `.hmeta` is `display:none` by width regardless of the attribute, and
`:not([hidden])` would wrongly match. The crest owns `margin-left:auto` in every other case.
`ffdraft.html` needed a different mechanism: its header is a block, and `#soundBtn` already pins
itself right inside `.brand`, so an absolutely-positioned crest would land on top of it — the
header's right PADDING is widened to reserve the crest's column instead, and the crest is centred
vertically (`top:50%`) because TV mode (`body.tv`) hides `#phaseLine` and a fixed offset would sit
off-centre there.

**WEIGHT.** The header mark is fetched on EVERY page load (manifest icons are read once, at
install), so it is sized to its job — a 34px slot, so 136px tall covers a 4x screen — and the flat
two-colour art palette-quantises with no visible loss: **59.3 KB → 9.4 KB**, whole set 392 → 172 KB.

**VERIFY**: `node tools/_gffl_icons.cjs` re-bakes from source (idempotent); `node
tools/_gffl_crest_shots.cjs` — **56/56, 0 page errors** — asserts before it photographs: crest
present and DECODED, inside the header box, in its right half, clear of the wordmark, hugging the
right edge, no sideways scroll, on league.html AND ffdraft.html at 390 and 1440, plus the desktop
state **with `.hmeta` un-hidden** (the case the bug hid) proving the meta tucks immediately left of
the crest as one group. Regression: `_verify-gffl.cjs` **1716/1716**.
Plates: `shots/gffl_crest_{league_390,league_desktop,league_desktop_meta,draft_390,draft_desktop}.png`.

**KNOWN**: at 30px the shield and goat carry the identity and the "GFFL" lettering inside it is
decorative rather than legible — correct for a crest at that size, but it is why the wordmark
beside it stays. The crest is `alt=""` on purpose (the wordmark already names the app; announcing
it twice is noise). `ffdraft.html` gets the touch icon and favicon but deliberately NO manifest of
its own — a second manifest would offer a second, competing install for one app.

### ⚠ THE INSTALL COLLISION: one origin can only ever hold ONE installed app (2026-08-10)

User, the same day the crest shipped: *"I am not able to install the app onto a phone that already
has bucky installed, it thinks they are the same app."* Not an icon bug — **a PWA's install identity
is its ORIGIN**, and both apps live on `amenfarms.netlify.app`.
`manifest.webmanifest` declares no `scope` and `start_url:"/"` → Bucky is installed with scope `/`.
`league.webmanifest` also declares no `scope`, so it defaults to the DIRECTORY of its `start_url`
(`/league.html`) → also `/`. Chrome will not install a second app whose scope is already covered by
an installed one; it offers *"open in Bucky"* instead. Whichever is installed first wins, forever.
**THE TWO FIXES THAT LOOK RIGHT AND ARE NOT**: a distinct `id` (GFFL already has `"/league.html"`,
Bucky's resolves to `/` — different, and it still collides; `id` governs identity, not the install
decision) and moving the league into a subdirectory (web.dev's *"multiple PWAs on the same domain"*
is explicit that an inner app gets NO install prompt while the outer app is installed, and that the
inner app's notifications are misattributed to the outer one; the W3C nested-scope issue #1180 is
still unresolved, so there is no spec-blessed same-origin escape).
**THE FIX IS A SEPARATE ORIGIN**, and the cheap form is a **domain ALIAS on the existing Netlify
site** — same functions, same env vars, one deploy, only the hostname differs, which is exactly
what identity keys on. A second Netlify site would work too but duplicates every secret and builds
twice. Activation steps, and the trap that `league.webmanifest` must NOT be edited (its `start_url`
is served from both hostnames and resolves against whichever loaded it — `"/"` would open Bucky on
the old one), are written out in `netlify.toml`'s GFFL custom-domain block. **Cost, stated up
front**: a new origin starts with empty `localStorage`, so every device re-enters the family
password and re-picks who it is (`gffl_pass`, `choreUser`, `choreUnlocked`, `dadPinHash`); league
data is in Firestore and is untouched. ~~BLOCKED ON: the user buying the domain~~ **DONE
2026-08-10**: goatfantasyleague.com bought, aliased, verified live (27/27 — root serves the
league, all assets/functions resolve, amenfarms untouched). Install from the new domain.

---

## 🏈 GFFL — 2010-2015 LEAGUE HISTORY, AND FOLDED FRANCHISES GO QUIET (2026-08-10)

Six seasons of the family's own pre-ESPN history loaded straight into the live league, then one
code change so the record book only ever speaks about franchises that still exist. Files:
`assets/league/lg-core.js` + `tools/_verify-gffl.cjs` (1716 → **1729**). `lg-ui.js`,
`lg-data.js`, `league.html` and `netlify/functions/league.mjs` untouched.

**THE DATA** (user-supplied: a 100-row W/L/PF/PA table, then a 752-row matchup spreadsheet).
Written to `hist_2010` … `hist_2015` — 2013 and 2014 created fresh, the other four keeping their
existing `champion` while their placeholder single-team `teams[]` was replaced. **736 games**
(78/95/148/148/149/118) and 12/12/20/20/20/16 teams. Plus `hist_2017` (Elanikan Skywalkers,
champion-only). All 13 pre-existing history docs backed up to
`scratchpad/gffl_backup/hist_before_2010_2015.json` first. 16 seasons on file now, all 14
champions counted.

**FRANCHISE IDENTITY was the only hard part, and the league's own imported data settled it.**
The 2010-15 league ran 12-20 teams under 47 different franchise names; the modern one has 8.
Confirmed by the user after the 2018 import was checked against their first note:
- **Dawn Treaders → 12**, the GOAT Kids lineage (Dawn Treaders → Space City Rockets → Little
  Rocket Farmers → Great Lords of Football → The GOAT Kids). The user's first note put it on
  Nails For Breakfast; the 2018 doc lists Dawn Treaders and ST Red Shirts as two separate
  franchises that year, and they also both appear in 2012/2013/2014, so they cannot be one team.
- **the Star-Trek shirt team → 5**, the Nails For Breakfast lineage (ST Red Shirts → The Scenic
  → Nails For Breakfast). The 2010-15 sheet spells it "TNG Yellow Shirts".
- **Kruz Control + Kruz Kontrol + Cruz Control → 11**, and *Krucial* / *Kruz Blues* are
  DIFFERENT franchises. Those three Kruz names never share a season (2010-11 / 2012 / 2015), so
  the merge is clean; team 11 went 68-68 → **83-82**.
- Battle Kreussers 1 · Elanikan Skywalkers 2 · Wyoming Cowboys 3 · Chula Vista Jaguarrams 4 ·
  Nerfherders 9. **The other 37 franchises are defunct and got synthetic ids in the 1000s** —
  deliberately outside 1-12, because an id collision would attribute a dead team's record to a
  living one.
- **The load asserts no duplicate id inside a season**, which is the failure the overlaps would
  have produced: `recordBook` aggregates by id, so two rows sharing one would double-count.

**A DISCREPANCY IN THE SOURCE DATA, recorded rather than papered over.** 2010 and 2011 reconcile
to the cent — every team's W-L-T *and* PF derived from the game log match the season table
exactly. In **2012-2015 the W-L-T still matches every team exactly** and the per-team game COUNT
equals W+L+T, but the game log totals **~88%** of the stated points-for (per team 79-97%). So the
season table counts weeks that produced no win or loss — consolation-bracket scoring, most
likely, given those years ran 20 teams with a bracket shrinking through week 17. It cannot
contradict itself inside the app: standings and all-time PF come from `teams[]`, while
`matchups[]` only feeds head-to-head, highest week and biggest blowout. The 2012-15 rivalry point
totals therefore run slightly under those seasons' official PF, by design.

**⭐ CURRENT FRANCHISES ONLY** (user: *"dont show any history for teams not currently active in
the league"*). `LG.recordBook` gained ONE gate, `live(id) = !!LG.teamById(id)`, and it is the
single choke point — `LG.headToHead`'s two callers already pass current ids only (the `LG.teams`
rivalry loop and the matchup's own two teams), and nothing else in the UI reads `loadHistory`.
A team the league does not currently roster contributes **nothing**: no standings row, no title,
no superlative — and **no half of one either**. A blowout is dropped when EITHER side is gone
(a margin against a stranger is not a league record), while the surviving team's own points still
count toward highest-week, which is a fact about them alone. `hasData` now asks what SURVIVED the
gate rather than what is on disk, so a league whose whole history belongs to folded teams shows
the empty state instead of a table of zeroes. **Nothing is deleted** — all 47 franchises stay in
Firestore, so re-admitting one (or widening the gate) brings its whole record back.

**The result, all 8 current franchises and nothing else:** Elanikan Skywalkers 104-91 **5 titles**
· Battle Kreussers 115-77 **4** · Nerfherders 113-72-1 **3** · Wyoming Cowboys 106-91 **1** ·
Kruz Control 83-82 **1** · GOAT Kids 90-91 · Chula Vista 56-67 · Nails For Breakfast 54-98.
Highest week Kruz Control **340.2** (2019 wk14) · biggest blowout GOAT Kids 234.5-103.8 Elanikan,
**130.7** (2018 wk14) · best season PF Wyoming Cowboys **2340.3** (2014). Rivalries reach back:
Battle Kreussers lead Elanikan **20-9**, 4256.8-3590.6 all-time.

**VERIFIED**: **1729/1729, 0 page errors**. New section **N8** builds its fixture so that EVERY
superlative would belong to a dead franchise if the gate were missing — the champion, the highest
week (260.4 vs a live best of 120.5), the biggest blowout (220.3 vs 20.25) and the best season PF
(1999.9 vs 1500.5) are all theirs by a clear margin — so a pass cannot be vacuous. **Pre-fix with
`lg-core.js` reverted to HEAD: 1720 pass / 9 fail, all nine inside N8**, each on-point (standings
listed 1099 and 1098, the folded champion was crowned, and all four superlatives were theirs).
1720 = 1716 + N8's 4 regression invariants, so **all 1716 pre-existing checks pass in both worlds
and no restaging was required**.

**KNOWN**: `LG.headToHead` itself has no gate — it does not need one at its two call sites, but a
future caller passing a folded id would get a real answer rather than an empty one. And the
2012-15 seasons carry 20-team `teams[]` arrays of which only 6 render, which is the intended cost
of keeping the raw record intact.

## 🏈 GFFL — THE SEPTEMBER BATCH, WEEK ONE (2026-08-10, one session: plan → P1/S1/S2/S3/S4)

Plan of record: `ffleague-plan.md` "GFFL SEPTEMBER PLAN" (Sleeper-gap features + the
readiness program; ordered proof-first around preseason W2/W3 as live windows, freeze Sep
3–10, draft SUN Sep 6 3PM CT — the plan first said "Sat" and the S2 build agent caught it).
Delegation per the user's split: Fable orchestrates + reviews + designs, Opus builds the hard
workstreams, Sonnet the mechanical ones; every agent report re-verified by the orchestrator's
own suite run before commit. Suite 1716 → **2009** across the batch, FAIL 0 at every commit.
- **P1 · `tools/_gffl_live_probe.mjs`** (sonnet) — read-only probe of REAL ESPN/Sleeper/
  Firestore through the app's own mirrored parsers (line-cited); `--selftest` = 40 network-free
  checks. FIRST REAL-FEED PROOF (Aug 10): season.type resolves `"pre"` (the finalize guard can
  see) · Sleeper agrees · **142/142 rostered ids resolve** · preseason projections are ADP-husks
  and preseason stats empty (PROJ reads "—" by design) · `fgm_yds` proven in a real 2025 payload
  (2026 pre-W1 stats not yet posted — re-probe during a W2 game). NOTE: the sports feeds ARE
  reachable from this sandbox now — the old egress-blocked note is stale.
- **S1 · owner PINs** (opus) — `claimTeam()`: first claim sets a 4+-digit PIN (hash on the team
  doc, `sha256(pin+":"+LG.PASS)` — the dadAuth formula); a claimed team demands it on any new
  device, refusal writes nothing; grandfathered claims nag once/session. Commish reset writes
  `pinHash:""` (NOT deletion — `LG.db.set` merges, an absent key leaves the old hash standing).
  **THE COMMISH PIN MOVED TO THE CLOUD** (`auth` doc, its own kind — never a rules field, the
  Rules editor renders+writes back what it renders): the domain move had opened first-set-per-
  device (any kid could self-seed commish on a fresh origin); migration runs AT BOOT from a
  device carrying `dadPinHash` and no-ops forever after. `gateCommish` reads FRESH at the
  boundary; cloud wins; local only when the league holds none. POSTURE unchanged: family-grade.
- **S2 · draft countdown** (sonnet) — `rules.draftAt` (commish-editable; the Rules editor's
  save handler generalized: a dot-less `data-k` writes top-level), league-home card first
  while future, LIVE within 6h, quiet "Drafted ✓" after. **Counts on the REAL clock,
  deliberately NOT LG.now()** — the one engine-clock exemption in the app, commented as such.
- **S3 · team colours** (opus) + **THE FABLE DESIGN PASS** (orchestrator's own hands, user:
  "needs your Fable High touch… modern, minimalist but impactful"): `team.colors =
  {primary, secondary, tertiary}` settable (extraction proposes, `colorsCustom` latch means a
  re-upload never clobbers a hand-pick, "↺" resets), ONE `teamPalette()` derivation with
  contrast floors, split stat bars from the NFL `.nflsbt` mechanic, `LOGO_CAP` 160k split from
  chat's 80k, 512px logos. THE PASS REVERSED TWO S3 CALLS, reasons in the plan: the blur-wash
  hero → a FLAT card cut by a px-based diagonal primary panel + secondary stripe (three
  translucent layers read as mud; every hero converged on the same smear), and colour-FILLED
  names → NEUTRAL ink at every size (eight coloured names = rainbow; colour lives on crests/
  rails/bars — one bold moment per screen). A tried name-underline was REMOVED (third accent =
  one more than minimal). **Design pass 2 (user): the pencil** — every identity control
  (Name/Motto/Logo, swatches, PIN reset) behind one SVG pencil disclosure top-right of the
  hero (zero-emoji chrome rule); hero opens quiet; owner/commish only. S3's review found a bug
  in S1's D (`.lockeredit` painted while `hidden` — own display:flex beats the UA rule, the
  recurring house lesson) and TWO more real ones: `logoTd`/`avatarHtml` read `.logo` only (an
  UPLOADED logo — `.logoData` — never left the locker; this is the LIVE bug the user reported
  as "changing the logo did not change in every other tab", fixed by `teamSrc()` unification +
  a standing no-reload propagation check across standings/matchup/header), and greyscale logos
  extracted no palette (lightness fallback). RESTAGE HONESTY: four checks that would have
  passed VACUOUSLY after the pencil (attribute reads while the FOOT above did the hiding) were
  rewritten to rendered geometry through the real pencil flow, and one check was INVERTED with
  its reason (names must now BE the sheet ink). The user's real Goat Kids crest is committed at
  `assets/league/goatkids-logo-example.webp` and plate 5 of `tools/_gffl_palette_shots.cjs`
  (66/66) runs it through the REAL upload path every run, asserting extraction lands in its
  warm family. `uploadLogo`'s `eval` became `await eval` (tolerates sync exprs, lets a fixture
  fetch real art — top-level `await` inside eval'd code is a SyntaxError, return a Promise).
- **S4 · push notifications** (opus) — the family FCM stack reused: `push-client.js` `enable()`
  gains an optional 4th arg `extra` → `{gfflTeam}` stamped on the token doc (family callers
  byte-identical; `merge:true` so one device carries BOTH audiences); `notify.mjs` allowlist →
  a SET of parsed origins (+goatfantasyleague.com/www; lookalikes still fall to DEFAULT_URL;
  `_verify-notify-url.mjs` 14 → 36). v1 producers, all client-side fire-and-forget after the
  action commits, never able to break it, actor never self-notified: trade offer → target,
  accept/veto → counterpart (veto only on the KILLING vote), waiver results → each owner with
  a claim from the client that ran processWaivers, finalize recap → league-wide (2 games +
  "+N more"), chat @mention (normalized, prefix-tolerant, ≥3 chars). Enable card on My Team
  (its own card, NOT in the pencil foot — alerts are a fact about THIS PHONE, not the team's
  identity), honest iOS line (web push needs the installed PWA), and an honest disable caveat:
  `BuckyPush.disable()` removes the device's ONE token doc, so it kills family alerts on that
  phone too — said in the UI. `gfflTeam` audience filtered IN CODE off an unfiltered query
  (a mismatched integerValue/doubleValue fieldFilter returns zero rows SILENTLY — worst
  possible failure for a notification path). Suite section AN (88 checks; producers drained
  before reading — fire-and-forget + immediate assert = 30 false failures the first time).
  NOT live-pushed to a real phone yet — that is the P4 drill. Deliberately not done:
  executeTrade push (S7's call), post-claim enable interstitial (competes with the PIN nag).
**KNOWN / NEXT**: S5 waiver-cron + S6 search/trending are the Aug 17 batch; the P2 game-night
drill runs during preseason W2 (Thu Aug 13+, `node tools/_gffl_live_probe.mjs --report`
during a live game); everything is on the feature branch, NOTHING deployed — deploy decision
is the user's, and the S1 note stands: after deploy, Dad opens the league on his phone FIRST
so the commish hash migrates before the kids get curious.
(SUPERSEDED same-day: the week-one batch DEPLOYED 2026-08-10 evening, and the Aug-17 batch
(S5-S10 + two matchup design passes) DEPLOYED 2026-08-11 — see the next entries.)

## 🏈 GFFL — WEEK-TWO BATCH SHIPS EARLY + THE READINESS PROGRAM'S FIRST DAY (2026-08-11)

ALL of S5-S10 built, verified and DEPLOYED in one day (commits 981e464 · bf951ad · 94c3fb6 ·
d021bde), plus two user-directed matchup passes (d1c30a8 header rework from a marked-up
screenshot: h2h card REMOVED, owner·record gone, series below the lineups, full-width
win bar in each team's own primary — the documented USER-ORDERED exception to S3's
"palette never colours verdict" law; 11e3cb7 tune 2: Week label above the bar, scores
inward, crest 54 phone/62 desktop, names 15px, ceiling restaged 132→140) and
`gffl-test-plan.md` — the family's dated test schedule through kickoff (setup night Aug 12
7PM · game-night drills Aug 13 + 20 · enrollment weekend Aug 15-16 · scrimmage Sep 1 ·
freeze Sep 3-10 · draft SUN Sep 6 3PM · cron's first real fire Sep 9 8AM · opener Sep 10).
S10 (user request mid-batch): both bottom sheets REPLACED by one centered #rosterCard
(player-card overlay pattern incl. the Back-history sentinel) showing PROJ + OWN% per row —
%owned via a new sports.mjs `ff_pct_owned` action (kona_playercard + filterIds; cookie loss
degrades to em dashes). SIM-C's build caught the read-after-close bid bug that would have
made EVERY FAAB claim bid $0.

**THE READINESS PROGRAM (user: "lots of things will slip through the cracks… robust
simulation and testing using agents"): FIVE season-breaking bugs found and closed in ONE
DAY, 29 days before week 1.**
- **`tools/_gffl_shadow_score.mjs`** (SIM-C, sonnet build): an INDEPENDENT scoring
  re-implementation (line-cited mirrors, own arithmetic) diffed against the DEPLOYED site,
  read-only with write-interception PROVEN in its own output; 50-check selftest. ITS FIRST
  PRODUCTION READ found the live rules doc holding the literal string "undefined" in
  fg_made_yd (the signature FG-by-yards rule!), one_pt_safety and dst_2pt_ret, WITH the FG
  brackets armed at 3/4/5 — every kicker mis-scored every week into write-once records from
  week 1. Root cause: the rules editor rendered String(absentKey) and a save stored it.
  REPAIRED in production (backup → masked PATCH of six fields → values grounded in the real
  ESPN league via the read-only settings proxy → siblings verified → scorer re-run green)
  and GUARDED both ends (redval renders absent/poison as EMPTY; the save path rejects
  "undefined"/"null" and an empty box over a poisoned key HEALS to 0; suite AC5b reproduces
  the exact production doc state through a real saveRules). Nightly in-season job: weeks 1-2.
- **`tools/_gffl_season_sim.cjs`** (SIM-A, opus build, 1,929 lines): "the season in a day" —
  17 weeks through the REAL UI, four persona devices genuinely racing ONE store (the REST
  fixture, deliberately NOT per-context localStorage), chaos owner, invariant engine after
  every phase (FAAB conservation from the harness's OWN ledger · roster conservation ·
  write-once hashes · independently re-derived standings · DOM NaN sweeps · push ledger ·
  COVERAGE AS AN INVARIANT — a flow exercised zero times fails the run). 17 weeks = 5.7 min.
  HONEST LIMIT in every footer: the seed reproduces persona CHOICES, not the season — these
  are timing bugs and a clean run is not proof of absence; --fast searches harder.
- **FOUR RACES found by its first runs, all fixed (af5c574 → deployed as 38b7b84)** — this
  is the "FAAB write-ordering… worth a dedicated pass" the 2026-08-08 adversarial review
  deferred, delivered: (1) ensureRoster's copy-forward was an UNGUARDED BLIND WRITE (551 of
  622 roster writes/season) — waiver results silently undone, a player on TWO teams weeks
  8→17; now getFresh-before-write, existing docs ADOPTED, +1 read only when writing, read
  path free; (2) finalizeWeek scored the write-once doc from a CACHED roster (Δ9.66
  observed) — now ONE fresh per-run snapshot threaded through fzStarters/totals/awards;
  (3) processWaivers wrote FAAB as an ABSOLUTE from a 15s-cached read (an owner $54 up,
  error direction favours the owner) — saveTeam gained opts.from(cur), purse written as a
  DELTA off the store's fresh value (increment transforms REJECTED at the call site: the
  REST transport speaks documents, the local backend has no atomic); (4) two concurrent
  waiver runs doubled the tx log — per-week single-flight latch + the idempotency guard
  moved IN FRONT of all writes (cross-device check-then-act limit stated plainly, not
  papered over). Advisory closed: #claimGo disarms first-statement. EVIDENCE: three
  promoted repros `tools/_gffl_race_{clobber,doublespend,dbltap}.cjs` each FAIL pre-fix /
  pass post-fix; suite section AS (+29, races staged deterministically — no sleep decides
  an outcome); the 17-week sim 30 failures → 0 across 15,753 checks. THE UNMASKING LESSON:
  the fixes surfaced 1,669 chaos-owner "failures" that were the bid CLAMP working correctly
  once money stopped leaking (faab.conservation never fired = the tell) — restaged to
  expect min(typed, cap), never chased as a bug.
- Battery now **2265/0**. Deploys 2026-08-11: d1c30a8+11e3cb7 (matchup passes, with S5-S10),
  then 38b7b84 (the safety batch, REBASED over a parallel session's ffdraft.html
  draft-countdown commits — 4 foreign commits, zero file overlap, third clean interleave on
  this branch). **KNOWN / NEXT**: cross-device waiver concurrency is NARROWED not eliminated
  (true CAS = transport surgery, argued at the call site); race battery D + soak and the
  S1-S10 adversarial fan-out review remain queued; Saturday = first clean-by-construction
  17-week run as the formal P3 milestone; the sim + shadow scorer + race repros are
  PERMANENT EQUIPMENT — rerun the sim after any future change.

## 🏈 GFFL — THE DESKTOP DASHBOARD + THE RAIL BALANCE (2026-08-11, b88025c + e25e117, UNDEPLOYED)

User: the League tab's desktop view "looks too much like an app" — then, after review, "lets
add more to the rail so we have equal to main." Files: `league.html` + `assets/league/lg-ui.js`
+ `tools/_gffl_desk_shots.cjs` (NEW, 27 checks) + `tools/_verify-gffl.cjs` (→ **2364**).

**THE SHAPE: two columns with JOBS.** ≥1024px the league home is `.lgdesk` — `.lgmain` is the
league's STATE (draft countdown hero → Rules/Draft links row → stale-weeks alarm → week card →
playoffs → standings → all-time) and the fixed-width `.lgrail` is its PULSE (chat → injury
report → hot pickups → projection accuracy → recent moves). The old masonry column-count dealt
cards out by height, so the page read as a scatter with no left-to-right meaning — that was the
complaint. The phone keeps its stacked card list byte-identical (asserted at 390).
- **Matchup cards** carry the team-colour probability bar everywhere (`.mupbar.mini`, each
  half in that team's own primary).
- **Standings: no scroller, ever, plus Streak / Pwr / Playoff%** columns (loadStreaks /
  powerRanking / playoffOdds — Monte Carlo 1000 seasons, strength = avg PF with a Bayesian
  prior, deterministic seed from the data-state hash). The separate Power-rankings card is
  GONE on desktop (it is a column now); the phone keeps it.
- **Chat is the top-right panel, always expanded**, composer and all — and a LIVE REPAINT MUST
  NOT TOUCH THE RAIL: `renderLeague(true)` (every scoring poll tick) rewrites `.lgmain` only,
  so a half-typed message and the reader's scroll survive; a FULL rebuild (cloud refresh)
  preserves the composer text + scroll explicitly. Player names inside chat messages are
  tappable controls (`linkPlayerNames` — full name AND the rendered short form both match;
  teams win ties; escaping proven against a literal script tag).
- **Record book on desktop = the all-time aggregate table only** — champions list and
  superlatives hidden (the user's own words); absent entirely with no history, never an empty
  table.
**THE RAIL BALANCE** (e25e117): injury report + projection accuracy MOVED from MAIN into the
rail (they are pulse, not state — and the moved cards repaint only on full rebuilds, which
their cadence suits); a **Hot-pickups card** joined (the Moves page's own trending renderer
REUSED — paints from cache into an unconditional `#railHot` shell, once more when
`D.loadTrending()` lands, self-hides to nothing on a dead endpoint, chips WRAP in the narrow
rail instead of panning sideways); **Recent moves deepened 8 → 14** on desktop; rail chat
376 → 440px. Fixture measure: rail 1157px vs MAIN 1621px (**71%**, was ~40%) with ZERO injury/
trending data — live data closes the rest. A 45% floor is the regression guard.
**VERIFY**: `node tools/_gffl_desk_shots.cjs` 27/27 (14-row cap proven off 16 seeded, MAIN
emptied of both moved cards, shell presence, balance floor, all at 1440/1280/390) + battery
**2364/2364** — confirmed across two clean full runs; one intermediate run crashed on the
known puppeteer "Promise was collected" flake and another read 2362/2 on two timing-shaped
checks (an AF same-millisecond chat-stamp tie + the AT8 chat-tap 8s-poll repaint race), both
green on identical check code either side — the flake pattern, not a regression. RESTAGED with
reasons: AT's rail composition (moves now CLOSES the rail, children ≥ 3 — middle cards
self-hide), AT3 seeds 16 names so the 14 cap is what trims (Ashby + Baker fall off).
Plates: `shots/gffl_desk_league_{1440,1280}.png`, `gffl_desk_mobile_390.png`.
**KNOWN**: the playoff% column is points-driven and can read counterintuitively early (an 0-2
team above a 1-1 team when its PF is far higher) — the model working as specified, but the
family will ask; and both commits are on the branch only, awaiting the user's deploy word.

## 🏈 GFFL — THE DESKTOP LAYOUT EDITOR (2026-08-11, follows the dashboard entry above)

User: *"give me the ability to make edits directly to the desktop page layouts … not just
cards but also formatting of text and text size."* Files: `league.html` +
`assets/league/lg-ui.js` + `tools/_gffl_desk_shots.cjs` (27 → 30) + `tools/_verify-gffl.cjs`
(2364 → **2388**, new section AU).

**EVERY DASHBOARD CARD IS A REGISTRY ENTRY NOW** — the wide branch renders through a named
`renderCard` map into `.deskcard[data-card=<id>]` wrappers, and the ARRANGEMENT is a
per-DEVICE preference (`localStorage gffl_desklayout` — layout is a viewing preference like
the calendar view was, never league state: no cloud write, no offline-mirror interaction, no
race surface). A pencil (SVG, zero-emoji chrome) above the dashboard opens edit mode: per-card
▴▾ reorder (swaps with the nearest VISIBLE neighbour — stepping onto a hidden card's slot
would be an invisible move that reads as a dead button), ◂▸ column move, per-card text size
(100→115→130→85% cycle), Hide with a Show tray in the bar — plus GLOBAL text size
(85–125% in steps) and a Comfortable/Compact density toggle. The global size rides EVERY
league.html tab on a desktop; phones are byte-untouched (wide branch only).
- **TEXT SIZE IS CSS `zoom`, NOT font-size — load-bearing.** The stylesheet is px-based
  throughout, so a font-size multiplier on an ancestor moves NOTHING. Zoom scales text and
  boxes together. Global = `#main.style.zoom` (header/nav/overlay siblings stay 100%, so
  modal geometry and sticky chrome are never distorted); per-card =
  `.deskcard[data-cz] > :not(.deskedit) { zoom:… }` — it must target the CHILDREN because the
  wrapper is `display:contents` and zoom on a boxless element does nothing.
- **`display:contents` wrappers are the other load-bearing choice**: every non-hidden card
  emits a wrapper even when it renders "" (self-hiding injury/trending/countdown), costing no
  box and no flex-gap slot — so a card that GAINS data mid-session appears on the next live
  repaint instead of waiting for a full rebuild. KNOCK-ON: `.lgmain > .card` child selectors
  stopped matching (the wrapper is in the DOM tree even without a box) → `.lgdesk .card`.
  In edit mode wrappers switch to `display:block` with dashed borders + control strips, and
  empty cards render labelled placeholder shells so they can still be positioned.
- **SANITIZED ON EVERY READ**: unknown ids dropped, junk hidden entries dropped, off-step
  scale/cz snapped to 100 — and a card the saved layout has never heard of (a future
  addition) lands at the END of its default column rather than vanishing (the fitness-plan
  tombstone lesson, applied to layout).
- **THE TWO CONTRACTS SURVIVE ANY ARRANGEMENT**, both asserted: (1) a live repaint is
  PER-WRAPPER and skips `data-card="chat"` wherever it sits — chat can be moved into MAIN
  and the composer still survives every scoring tick; (2) a live repaint under the OPEN
  editor is a no-op (scores wait the few seconds an arrangement takes). Leaving the League
  view closes the editor; a reload lands on the arranged page, never mid-edit.
- Restaged with reasons: AT1's chatIsFirst/movesIsLast + desk-shots' chatFirst read the
  wrapper's card id now (same fact, new architecture).
**VERIFY**: battery **2388/2388** (AU: pencil→edit, reorder persisting across a real reload,
column move, hide/show tray, global size on League AND Scores and NEVER at 390, per-card
zoom with the strip pinned at 100%, density, reset-to-default, the sanitizer against a
stale/corrupt saved layout, both contracts) + desk shots **30/30** with the edit-mode plate
reviewed. Plate: `shots/gffl_desk_edit_1440.png`.
**KNOWN**: the strip label duplicates a card's own h2 while editing (deliberate — the strip
is the control row and it must identify empty cards too); per-card size is dashboard-only
(other tabs take the global size); and CSS zoom needs Chrome/Edge/Safari or Firefox ≥126 —
the family's browsers all qualify.

## 🏈 GFFL — THE DESIGN-HANDOFF REFINEMENT: the muhero matchup header (2026-08-11, DEPLOYED)

The user brought "GFFL desktop view refinement.zip" — a Claude-Design handoff of DOCUMENTED
DELTAS against our shipped code (not a full-file copy: a README naming exact rules, a
prototype, three target screenshots), built pixel-faithfully FROM the real app. Files:
`league.html` + `assets/league/lg-ui.js` + `tools/_gffl_palette_shots.cjs` (restaged).
Handoff extracted at the session scratchpad `refine/`.

**THREE DELTAS, all ≥1024px except the tagline copy** (the handoff's own rule: the phone
header stays inside its measured cap — and it held: the battery needed ZERO restages, every
phone matchup check passed untouched):
1. **The MUHERO matchup header**: the `.muhead` carries `muhero` + the two teams' palettes as
   inline CSS vars (`--tpa/--tsa/--tph/--tsh` from `LG.teamPalette`); at desktop each team
   gets the locker-hero colour slash (primary diagonal + thin secondary stripe, away left,
   home mirrored), a **104px rounded-square crest** (radius 18, locker shadow, `mine` ring
   kept) sitting ON its slash, a **30px nowrap name**, and the score block at the INNER edge
   (rail preserved). **ONE MARKUP SERVES BOTH BREAKPOINTS**: `.muhtop { display:contents }` +
   explicit `order` per side produces the one-row crest→name→score arrangement (mirrored via
   order, replacing the row-reverse) with no JS branching — the phone renders the exact same
   DOM as before. The per-side "N to play · N live" line moves into a `.muplayline` rowline
   at the top of the lineup card on desktop (hidden on phones, where the header's own
   `.muhsub` still carries it — both are in body text, so X8e's count checks pass at any
   width). Win bar inset `3px 180px 0` to clear the slashes; card padding 12px 16px.
2. **My Team slot chips** take the draft's `--pos-*` colours via `data-pos="${slotPos(slot)}"`
   (added to BOTH rowHtml branches) + attribute-selector fills — desktop-gated, so the phone
   chip is byte-identical.
3. **Tagline**: "G.O.A.T. Fantasy Football League", centered/white/700 on desktop
   (`flex:1 1 auto` between the wordmark and the right meta group). Copy change is the one
   thing that isn't width-gated — `.sub` is `display:none` on phones anyway.

**RESTAGED, each with its reason in the file — `_gffl_palette_shots.cjs` only** (the one
suite asserting desktop header geometry; the battery's matchup assertions all run at 390):
the TUNE-2 140px ceiling is now THE PHONE'S contract with a measured desktop ceiling of 175
(muhero measures 156-161 on the fixtures); the crest band splits 50-68 phone / 100-108
desktop; and "the win bar spans the card" INVERTED at 1440 — the inset is the design, so the
desktop assertion is that the bar genuinely does NOT span. Plate-gate literals moved onto the
same per-width ceiling.

**VERIFY**: battery **2388/2388** (zero restages — the width gate is what made that true) ·
palette shots **74/74** · desk shots 30/30 · crest shots 56/56 (the tagline restyle left the
crest pinning intact) + a chip plate (every chip filled with ITS position's own token at
1440, the phone chip unfilled). Plates: `shots/gffl_pal_matchup_1440.png` (the muhero),
`gffl_refine_myteam_1440.png` — both reviewed against the handoff's own screenshots.
**KNOWN**: at 1024-1200px two long team names ellipsise beside the 104px crests (nowrap +
min-width:0 — the handoff's prototype was 1366px); and the muhero's slash geometry is fixed
px (172/124), so it doesn't scale with the per-card text-size zoom — harmless, the slash is
an edge decoration.

## 🏈 GFFL — REFINEMENT 2: three colours, names that fit, the slash goes mobile (2026-08-11, DEPLOYED)

User, on the muhero/locker heroes: the TERTIARY strip joins (all three team colours), the
name may never overlap any colour, it reads CENTERED in up to TWO ROWS and FIT-SIZES down
instead of ellipsizing, "est." leaves the win bar everywhere, and the slash comes to the
PHONE matchup header as an experiment. Files: `league.html` + `assets/league/lg-ui.js` +
restages in `tools/_verify-gffl.cjs` + `tools/_gffl_palette_shots.cjs`.

- **SIX PSEUDO-HOSTS, two per stripe** on the matchup card (its own ::before/::after =
  primary, `.muhrow`'s = secondary, `.mupweek`'s = tertiary — each abs/inset:0 against the
  positioned card, its host unpositioned); the locker's tertiary rides
  `.lockerhead-inner::before`. Palettes: muhead inline vars gained `--tta/--tth`; the locker
  already had `--tt` via palStyle. Desktop tertiary at 196-202→148-154 (locker identical);
  MOBILE matchup geometry is slim (38/16 primary, 44-49/22-27 secondary, 55-58/33-36
  tertiary) — slimmed once from a first cut precisely to buy the name column width.
- **FIT, DON'T CLIP** (`fitText`/`fitHeroNames` in lg-ui): reset to the stylesheet size,
  step down 1px until the text fits ≤2 wrapped lines with no sideways overflow; the reset
  is what makes it idempotent across live repaints. Matchup names min 16px desktop / 10px
  phone, locker 14px; re-run once on `document.fonts.ready` (Barlow landing late moves every
  measurement). Names are `white-space:normal`, centered, with a SLASH-SIDE CLEARANCE PAD
  (matchup 66px desktop / 46px phone; lockerid 44px desktop / 32px phone) so the INK never
  sits on colour — and the probe measures the ink via a **Range**, not the padding box,
  because the padding IS the clearance (first probe run failed on exactly that).
- **TWO ROWS AT EVERY WIDTH.** The first cut capped phones at one line and the probe showed
  a 28-char name ground to 9px; two ≥10px rows read better and the header still fits. The
  cost is honest: the ordered-layout phone ceiling moved **140 → 148** (a short name still
  measures ~132; the stress name ≤146) — three battery ceilings + the palette suite restaged
  with that reason, and AQ6 ("the bar carries 'est.' — honest, not oracular") is INVERTED by
  the owner's own order.
- Probe: scratchpad `refine2_probe.cjs` — **50/50** over matchup 390/1024/1440 + locker
  390/1440 with stress names ("Waffle House Warriors" vs "The Undefeated Breakfast Crew"):
  tertiary painted in the team's own colour, ink-clear of the computed slash outer edge at
  the text's own y, unclipped, ≤2 rows, no est., playline/muhsub swap right, ceilings,
  no sideways scroll.
**VERIFY**: battery **2388/2388** + palette **74/74** (one AF same-millisecond flake passed
on rerun, the established pattern). Plates reviewed: `shots/gffl_refine2_matchup_{390,1440}`,
`gffl_refine2_locker_{390,1440}`.
**KNOWN**: the phone win bar spans full width, so its flanking % labels can graze the slash
bottom bands — left as part of the experiment for the family's reaction; and the slash
geometry is fixed px, so the per-card text-size zoom scales type but not the slash (edge
decoration, harmless).

## 🏈 GFFL — REFINEMENT 3: the band goes quiet, the composer grows up (2026-08-11, DEPLOYED)

Three user asks. Files: `league.html` + `assets/league/lg-{ui,core}.js` +
`netlify/functions/league.mjs` + restages in `tools/_verify-gffl.cjs` (→ **2396**).

- **MATCHUP SLOT COLOURS REMOVED** ("too much color clash… leave them on my team, just remove
  on matchup"): item 2's per-position band fills are gone — every matchup slot badge takes ONE
  neutral fill; the full-cell geometry (item 23) is untouched. The --pos-* tokens live on where
  a single surface carries them: the My Team chips (desktop) and the players-table .posbadge.
  TWO battery sections restaged+INVERTED with reasons (AD2, AE's "colours KEPT" → "GONE").
- **THE GIF PROXY MIGRATED OFF A DEAD SERVICE.** The live probe answered `gif-not-configured`;
  the REAL cause is that **Google killed the public Tenor API** (announced 2026-01-13, every
  key terminated 2026-06-30 — post-cutoff knowledge, WebSearch-confirmed; WhatsApp/X → GIPHY,
  Bluesky → Klipy). `lgGifSearch` now speaks BOTH survivors, picked by whichever key is set —
  `GIPHY_API_KEY` (developers.giphy.com; `rating=pg` on the wire, family posture) or
  `KLIPY_API_KEY` (klipy.com/developers; the key rides the PATH) — GIPHY wins when both. The
  wire contract ({ok, gifs:[{url,preview}]}) is unchanged, so the client never learns the
  vendor. The suite's fake upstream serves BOTH providers' real documented shapes routed by
  path; checks cover no-key/empty-q/field-mapping/rating-on-the-wire/key-in-path/precedence.
  USER ACTION taken same day: a key loaded into Netlify env (applies on next deploy).
- **EMOJI PICKER, MESSENGER-STYLE**: an SVG-smiley trigger (zero-emoji chrome) opens a
  ~60-emoji keyboard that inserts AT THE CURSOR (`setRangeText` + a bubbled input event so
  autoGrow runs); one open tray at a time with the GIF box. **THE GRID RENDERS LAZILY on
  first open — load-bearing**: until someone opens it the emojis would be app-authored glyphs
  in the DOM, exactly what section U's chrome scan exists to catch (hidden elements still
  contribute textContent). Empty-until-opened = clean by construction, and asserted.
- **THE "Images" (recent-images) BUTTON IS GONE** — markup, wiring, `toggleMemeLibrary`, the
  `.chatmeme` CSS family, and `LG.recentChatImages` in lg-core (it existed only to feed the
  button). The battery's meme-library check INVERTS to prove the dead API is really gone; the
  hidden-geometry sweep swaps the meme panel for the emoji panel.
**SUITE-HARNESS LESSONS, again**: `node -e` multi-line replaces silently no-op on CRLF files
(tools/*.cjs are CRLF — use the Edit tool); and a killed battery leaves ONE process squatting
all five fixture ports (EADDRINUSE 8844) — find the PID via netstat and kill THAT, never
taskkill-all-node.
**VERIFY**: battery **2396/2396** (net +8: emoji/Images checks + the two-provider GIF matrix).

## 🏈 GFFL — REFINEMENT 4: reactions become real emoji (2026-08-11, DEPLOYED)

User: *"get rid of the fire, dead, goat buttons and just add an Emoji button where you can
emoji response directly on to someone's chat."* Files: `assets/league/lg-ui.js` +
`league.html` + K3 restaged in `tools/_verify-gffl.cjs` (→ **2400**).

Item 10's four fixed text chips are GONE. Each message carries ONE SVG smiley-plus
(`.chatReactAdd`); tapping it opens the composer's own emoji keyboard as a `.reactPalette`
anchored to THAT message (one palette at a time, LAZILY rendered — the section-U discipline
again), and any pick lands via the unchanged `LG.toggleReaction(id, emoji, teamId)`. A chip
(`.chatReact`) exists ONLY because someone reacted: emoji + count + a lit `.on` ring when
YOUR team is in it; tapping a chip toggles your team, and the last leaver takes the chip
with them. Reaction glyphs are USER content (someone reacted) — exempt from the app-chrome
emoji ban exactly like message text. **LEGACY word-keys (FIRE/DEAD/LOL/GOAT) display as
🔥/💀/😂/🐐 but keep their STORED key on the wire (`LEGACY_REACTS`), so an old FIRE and a
new tap land in the same bucket** — nothing already reacted is lost or split.
K3 restaged to the full new flow with reasons: empty state (no chips, no fixed words, lazy
palette), palette-on-message, chip + ring, doc keyed by the emoji itself, toggle-off
disappearance, and the legacy-word rendering (seeded doc, unlit for a team not in it).
Battery **2400/2400**.

## 🏈 GFFL — WYSIWYG TEAM COLOURS: hand-picks render verbatim (2026-08-11, DEPLOYED)

User: *"the team color picker colors dont match what actually shows up, I pick a very dark
color in the selecter and it comes out much lighter."* Files: `assets/league/lg-core.js` +
restages in `tools/_verify-gffl.cjs` (→ **2403**) + one palette-shots message.

**ROOT CAUSE**: `palClampFill` — S3's contrast guardrail — walks EVERY fill toward WHITE
until it clears `PAL_FILL_MIN` (1.5:1) against the near-black page. Right for a
machine-EXTRACTED palette (a muddy guess needs rescuing); wrong for a colour a person chose.
And the arithmetic is unforgiving: the page is so dark that ANY luminance floor turns a deep
navy into slate grey (1.5:1 needs luminance a saturated navy cannot have while staying navy —
blue barely counts toward luminance — and the 8% white-mix steps DESATURATE on the way up).
**FIX**: with `colorsCustom` latched, a slot the owner's own hex filled renders VERBATIM;
still clamped for everyone/everything else: extracted palettes, DERIVED companion slots of a
custom primary, and every INK derivation (`palClampInk`/`onDark` — a team colour used AS TEXT
is a legibility contract, not a fill; `inkOn` also still derives from the ACTUAL fill, so the
name on a near-black hero flips to white and stays AA).
**A DESIGN LAW WAS REPEALED, on the record**: the S3 pass's "a near-black pick's hero still
separates from the page (≥1.5:1)" on-screen check is INVERTED for hand-picks — owner order,
the same precedent as the est./win-bar/AQ6 inversions — with the arithmetic above written at
the check. The law survives for extraction (case 2, no latch — still clamped) and ink. New
battery checks reproduce the user's exact report: a dark-navy swatch pick asserted verbatim in
the STORE, the PALETTE, and the hero's own painted `--tp` (wait for store AND paint — reading
between the save and the repaint is a race, not a finding), plus "the same hex arriving as an
extraction still clamps" and "onDark still clamps".
Battery **2403/2403** · palette **74/74**.

## 🏈 GFFL — TRANSPARENT LOGOS STAY TRANSPARENT (2026-08-11, DEPLOYED)

User: *"I would like to be able to upload logos with transparent backgrounds, right now when I
do that it makes the background black."* Files: `assets/league/lg-ui.js` +
`tools/_verify-gffl.cjs` (→ **2410**, new section AM4b).

**ROOT CAUSE, one line**: `resizeImageToDataUrl` ends `cv.toDataURL("image/jpeg", …)` — and
**JPEG HAS NO ALPHA CHANNEL**. A cut-out PNG drawn onto a fresh canvas composites against
transparent-BLACK, so every transparent pixel encoded as pure black: the reported box behind
the mark. Nothing else in the chain was at fault — `paletteFromPixels` already skips
`alpha < 128`, so extraction was alpha-aware the whole time.
**FIX**: `opts.alpha` on the resizer (the LOGO path passes it; chat passes nothing, so photo
behaviour is byte-identical). `hasTransparency()` scans the drawn canvas and short-circuits on
the first pixel under alpha 250 — for a logo with clear corners that is the first pixel it
reads. Transparent → **PNG**; opaque → **JPEG**, which is far smaller and what a photo-ish
mark wants. Transparency is DETECTED, never assumed.
**SIZE**: PNG has no quality dial, so `resizeLogoToDataUrl(file, cap)` shrinks the DIMENSION
(512 → ×0.75, up to 4 passes) until it fits `LOGO_CAP`, rather than flattening — losing
pixels is recoverable, losing transparency is the bug. An opaque logo fits on pass 1 and
never sees the loop.
**THE PAYOFF is free**: `.tcrest` already paints `background:var(--tp)` — the team's OWN
primary — so a cut-out mark now sits on its team's colour instead of in a hole. Measured on
the fixture: crest bg `rgb(49,165,97)`, extracted from the transparent logo's own disc.
**VERIFY** (AM4b, its own page so it can't disturb the colour/latch walk above it): a real
cut-out fixture (`TRANSPARENT_LOGO` — a disc on a cleared field) uploaded through the REAL
input, then the STORED dataURL decoded and read pixel-by-pixel — stored as PNG (1,734 chars),
**corner alpha 0** (it was black), mark intact in its own colour, inside the 160KB budget,
the crest painting the team primary behind it, and the no-regression half: an OPAQUE logo
still takes the JPEG path. Battery **2410/2410** · palette **74/74**.
**TEST GOTCHA**: `.tcrest` is the league home's crest element — the locker hero uses its own
`.lockerlogo` `<img>`, so a `.tcrest` query on the locker returns null and an UNGUARDED
`getComputedStyle(null)` crashes the whole suite instead of failing one check (it did, once).
**KNOWN**: a logo uploaded BEFORE this fix is already flattened in storage — re-upload it.

## 🏈 GFFL — A CUT-OUT LOGO HAS NO BORDER (2026-08-11, DEPLOYED)

User, with a screenshot of their own locker hero: *"we also need to get rid of the transparent
image border, a picture with transparent background should blend seamlessly with the color
behind, no borders at all."* Files: `assets/league/lg-ui.js` + `league.html`. Follows the
transparent-upload fix directly above — that made transparency SURVIVE, this makes it READ.

**WHAT THE "BORDER" ACTUALLY WAS**, three separate things stacked: `.lockerlogo`'s own
`background:rgba(255,255,255,.14)` (the lighter rounded square in the screenshot), its inset
hairline ring, and its **drop shadow** — which on a transparent image traces the ELEMENT'S
SQUARE rather than the mark, so it drew a second hard edge. All three come off for a cut-out;
`object-fit` goes `cover` → **`contain`** so the mark is never cropped by the hero's rounded
corners or the crest's circle.
**DETECTION NEEDS NO NEW FIELD AND NO MIGRATION**: the upload path emits PNG *only* when
`hasTransparency()` actually found transparency and JPEG otherwise, so a stored
`data:image/png` IS the flag. `isCutoutLogo(src)` (also matches a legacy `.png` URL in the old
`logo` field) stamps `.cutout` in `crestHtml` and on the hero `<img>`.
**CASCADE, and it bit**: `.muavatar.mine` (0,2,0) and `.muhead.muhero .muavatar[.mine]`
(0,4,0) both out-rank or tie a bare `.tcrest.cutout`, so the rings survived the first cut —
the overrides are repeated in BOTH blocks, each placed AFTER the `.mine` rule it has to beat.
**KEPT ON PURPOSE**: `.tcrest` holds its `background:var(--tp)` — that IS "the colour behind",
and without it a dark mark would vanish into the dark card. **DROPPED on purpose**: a cut-out
crest loses even the "this one is yours" ring — a ring is a border, and the ask was none.
**OPAQUE LOGOS ARE UNTOUCHED** (panel, ring and shadow all stay): a mark with its own hard
edges wants the frame, and that is the no-regression half of every check.
**VERIFY**: scratchpad `cutout_plate.cjs` **8/8** — a real cut-out shield uploaded through the
REAL input, then computed styles read on the hero (panel `rgba(0,0,0,0)`, shadow `none`, fit
`contain`) and on the matchup crest (shadow `none`, background still the team primary
`rgb(192,57,43)`), plus the opaque case keeping both. Plates REVIEWED:
`shots/gffl_cutout_{locker,matchup}_1440.png`. Battery **2410/2410** · palette **74/74**.
**FLAGGED to the user, not hidden**: with the panel gone a mark's own colours can merge into
the slash, because the slash colour is EXTRACTED FROM THE MARK — that is what "seamless"
costs. Pulling the slash toward the secondary behind cut-outs is the fix if the family dislikes
it.

## 🏈 GFFL — THE ANALYST TAKES OVER TRADE SUGGESTIONS (2026-08-12, Grok 4.5)

User: *"right now its mathematical, I want to connect it to Grok 4.5 and actually have it
analyze both rosters strengths and weaknesses, player future projections and come up with a
fair trade."* Files: `netlify/functions/farmgpt.mjs` + `assets/league/lg-ui.js` +
`league.html` + `tools/_verify-gffl.cjs` (2410 → **2427**).

**SERVER — mode `gffltrade`**, the established Grok pattern verbatim (provider "xai"/XAI_MODEL,
no-key degrade AND mid-request outage fallback to Sonnet, league data in NAMED BODY FIELDS —
never messages[], MAX_CONTENT_CHARS slices JSON — user turn built server-side by
`buildGfflTradeMessages`). `GFFLTRADE_SYSTEM`: size up both rosters (strengths/weaknesses, 2-3
sentences each side), then propose ONE fair trade, 1-for-1 up to 3-for-3, drawing on the
model's own NFL knowledge for trajectories PLUS the league's numbers (avg/last/total/proj/
injury per player, records, the STARTING LINEUP REQUIREMENTS json — the legal-lineup rule is
in the prompt); injury honesty; ≤250 words; **bold** names; and it ends with exactly one
MACHINE TAIL — `===TRADE=== {"give":[...],"get":[...]}` quoting the payload's own keys
verbatim (the ===CHOICES=== protocol family), empty arrays = no fair trade exists. maxTokens
1400, thinking disabled, cache off, usage bucket "w" beside gfflproj.

**CLIENT — the ⭐ Suggest button is AI-FIRST, math-as-fallback.** `packSide` ships each roster
(key/name/pos/team/slot/injury via d.metaForKey + avg/last/total via UI._faStats + proj via
d.projFor) with records and `LG.rules.roster` (which IS the slot map — no .slots subkey, a
trap already stepped on once). The stream splits on the tail: prose renders into a new
`.mvsugai` panel through `aiProseFmt` (esc-first, then only **bold** and paragraphs — no
markdown lib), the tail's keys go through `applySuggestedKeys` which VALIDATES every key
against the real rosters (≤3 a side) before filling the trade builder — a hallucinated key
falls back rather than half-filling a proposal. Empty arrays render the analyst's "no even
trade here" prose with the builder untouched. ANY failure — endpoint down, unparseable tail,
invalid keys — lands on the old `suggestTradePair` with an honest label ("The AI analyst
isn't available right now — here's the numbers-based suggestion."), so the button never dies.

**SUITE**: the fake xai upstream answers the ===TRADE=== system prompt by parsing keys out of
the request's own user turn (give from the MY TEAM block, get from THEIRS) — so the assertion
that the builder fills with the right keys on the right sides is real, not an echo. AG3a/AG3b
(the math contract) restaged to run under a new `fixture.farmgptDown` flag with reasons —
they now ALSO prove the honest fallback label. New block: wire shape (both rosters + stats +
requirements on the turn), builder filled m_/t_ on correct sides, prose with <b> and without
the tail, status line, and loadTrades still 0 (suggest never sends).

**THE FIRST LIVE PROBE 504'd, AND THE FIX IS THREE WIRE PARAMS + A HEARTBEAT** (same day,
second deploy). The CDN answers "Inactivity Timeout" at exactly 30s of byte-less response —
and grok-4.5 at DEFAULT effort reasoned **56 seconds** before its first token on a two-roster
analysis (74KB of reasoning SSE), with the reasoning tokens ALSO eating the 1400 max_tokens
cap and cutting the ===TRADE=== tail. The `fantasy` mode never hit this (5.6s control probe —
same model, but a Q&A prompt doesn't trigger long reasoning; an ANALYSIS prompt does).
Measured through direct xAI probes: `reasoning_effort:"low"` + `temperature:0.2` +
`max_tokens:4000` lands TTFB 13-33s / totals 17-38s with the tail present and key-valid every
run (0.2 also curbs — not cures — grok's fast-path name mangling, "Pukaacua"-style; a
residual cosmetic artifact). TTFB can still cross 30s, so the stream gained a **gffltrade-
scoped 8s heartbeat** (a space until the first real token — aiProseFmt trims; DELIBERATELY on
no other mode, the story path's marker parsing must never see bytes the model didn't write).
xAI extras are mode-gated in openUpstream's xaiReq; suite asserts all three params on the
wire. **LIVE-VERIFIED end-to-end through goatfantasyleague.com**: first byte 11.2s (2
heartbeat spaces), total 32.3s, clean prose, valid 2-for-2 tail on the correct sides
(Waddle+BRob for Achane+Odunze — a genuinely sensible read of the fixture rosters).
KNOWN: totals of 25-40s flirt with the ~45s function ceiling the teachergpt saga measured —
the client's math fallback with its honest label is the net under every such failure.

## 🏆 GFFL — THE TROPHY CASE + SEVENTEEN SEASONS OF AWARDS (2026-08-12)

User: *"add a trophy case to each My Team page, Champion, Runner Up and Point total champion"*
+ the 2009-2015 award table from the family's own records + *"you should be able to get the
results from ESPN directly for the other years, note that Point Total Champion is regular
season points only."* Files: `assets/league/lg-ui.js` + `league.html` +
`tools/_verify-gffl.cjs` + production data via `scratchpad/load_awards.mjs`.

**THE CASE** (`trophyCaseHtml` in renderLocker): four shelves in fixed order — League
Champion (gold cup) · Runner-Up (silver medal) · Points Champion (green bars) · Toilet Bowl
Champion (muted toilet) — all inline SVG (zero-emoji chrome), year chips newest-first with a
×N count, a shelf absent when empty, the whole card absent when the case is. **Champion years
MERGE two sources deduped by season**: the hist docs' own champions (the existing `banners`
mechanism — so the 2010-2025 titles already on file need no trophy rows) + the team doc's new
`trophies[]` (`[{year, kind}]`, kinds champion/runnerup/points/toilet). The old
"Championships" card is superseded by the case.

**THE DATA** — every doc backed up to the session scratchpad before writing, masked PATCHes,
verified by re-read:
- Per-team `trophies` on the 8 current docs per the confirmed lineage (Dawn Treaders→GOAT
  Kids 12, Scruffy Looking Nerfherders 9, ST-shirts→Nails For Breakfast 5, three Kruz
  spellings→11); a defunct winner gets NO case — but nothing is lost:
- **`awards_history`** (kind "awards") holds the COMPLETE raw table, defunct franchises
  included, so the family record survives the franchise mapping.
- **hist_2009's champion CORRECTED to Cruise Missiles** — the doc said Battle Kreussers, the
  user's own award table says Cruise Missiles, and the family's table wins. **BK drops 4→3
  all-time titles** (flagged to the user, veto invited). hist_2013 (Outlaws) and hist_2014
  (Alley Cats) get their missing champions as synthetic defunct ids (1901-1903, outside 1-12
  so the record book's live() gate drops them correctly).
- ESPN-era points champions DERIVED as regular-season-only (weeks ≤14 matchup sums — proven
  exact against the standings pf for 2020-2025; for 2018/2019 the hist matchup points run
  ~1.3x the table so the TABLE wins there, documented in the loader).
- **GAPS awaiting the user's next batch**: all of 2016, and 2017's runner-up + points champ
  (ESPN history 404s pre-2018; 2017 has only a champion on file).

**SUITE**: three Championships checks restaged to the case with reasons; a full trophy-case
block seeds team_1 with 7 trophies across all 4 kinds + a hist champion and asserts shelf
order, the hist+trophies merge dedupe ("2023,2020,2011"), counts, SVG-only, and
placement above the roster.

**A CHECK-HARNESS BUG THE BATCH EXPOSED, worth its own line**: AM3's "no render site reads
team.colors" grep strips comments with the naive `/\/\*[\s\S]*?\*\//` — which paired the `/*`
inside the chat markup's `accept="image/*"` STRING with a `*/` **110KB later**, silently
skipping a third of lg-ui.js. The check had been passing VACUOUSLY; my edits re-paired the
blocks and a legitimate saveTeam write (`delta.colors = …`) surfaced as a false failure.
Fixed both halves: the stripper now requires whitespace/`*`/`!` after `/*` (a glob in a
string can never open a block), and an assignment target is exempt — the honest scan over the
WHOLE file then found zero real reads, so the S3 contrast law genuinely held everywhere.
RULE: a comment-stripping grep over a file containing markup strings must never use the naive
block regex — `image/*` is sitting in every file-input's accept attribute.

## 🏆 GFFL — LINEAGE CORRECTIONS, from the commissioner's own mouth (2026-08-13)

Four user rulings, applied to production via `scratchpad/fix_awards2.mjs` (backup →
masked PATCH → 16/16 re-read verification). Data only — no code changed.
- **Cruise Missiles IS Battle Kreussers.** hist_2009's champion went back to franchise 1
  (the historical NAME stays "Cruise Missiles"; the id is the franchise). BK is back to
  **4 all-time titles** — yesterday's flagged 4→3 demotion is reversed.
- **Dawn Treaders / Space City Rockets are DEFUNCT.** The GOAT Kids lineage is Little
  Rocket Farmers → Great Lords of Football → The GOAT Kids, and NOT the Dawn Treaders era
  the 2026-08-10 history load had merged in. Every Dawn Treaders row in hist_2011..2015
  re-id'd 12 → **1904** — in `teams[]` AND `matchups[]` (74 games), or head-to-head and
  highest-week would still attribute those games to the GOAT Kids. Their all-time record
  sheds the 2011-2015 Dawn Treaders seasons, and their trophy case drops that era's two
  awards (2015 points, 2014 toilet — now defunct-held in awards_history).
- **2016 runner-up = Nails For Breakfast** (whose lineage — ST Red Shirts / TNG Yellow
  Shirts — was verified already correctly mapped to id 5 in the hist docs; no change
  needed there). **2017 runner-up = Scruffy**, **2017 points champ = Elanikan Skywalkers**.
- awards_history updated to match on every row + the three additions (54 rows). STILL
  UNKNOWN: 2016's champion, points champ and toilet bowl.

## 🏈 GFFL — THE PLAYTEST-4 BATCH: eight items from one sitting at the wheel (2026-08-13)

Eight user asks arriving mid-session, all landed together. Files: `league.html` +
`assets/league/lg-{core,data,ui}.js` + `tools/_verify-gffl.cjs` (2427 → **2468**, FAIL 0).
`netlify/functions/*` untouched.

1. **THE ANALYST'S READ SURVIVES REPAINTS** (user: "as I was reading the reasoning it
   disappeared"). The Moves page live-repaints on poll ticks and the panel was painted only
   by the click handler — every repaint wiped it. The rendered analysis is SESSION STATE now
   (`UI._aiSuggest`, re-rendered by the markup itself), leaving only two ways: a new Suggest
   run replaces it, or its own ✕ (a module-level DELEGATED listener — the button is re-created
   by every repaint, so a per-render bind would go stale). A FAILED run clears it outright:
   an old analysis under the math-fallback label would be two answers at once. Streaming
   writes go through the same setter, so a repaint mid-stream re-renders the partial.
2. **CHAT ALWAYS LANDS ON THE NEWEST MESSAGE** (user: "halfway scrolled up"). The
   scroll-to-bottom ran before the GIFs and photos DECODED — every late image grew the
   content and stranded the viewport. Each incomplete image now re-pins the bottom on load,
   until the reader takes over (wheel/touchstart = a person; our own scrollTop writes fire
   neither). SUITE: a 400ms-late 300px SVG served by the harness's own server — first cut
   used a 1px png the fix's growth-assertion would have passed VACUOUSLY on, and put it above
   the fold where `loading="lazy"` never fetched it (crashed the run); the image is the
   NEWEST message now, whose growth un-pins a naive scroller from the other end.
3. **RULES/DRAFT ROW TO THE BOTTOM** — phone (last card) and desktop (DESK_MAIN reordered,
   links last) with a ONE-TIME layout migration: a saved layout still wearing the old
   default's head (`countdown, links, …`) was never deliberately arranged, so links moves to
   the end; a layout where someone MOVED links keeps their placement. The old "high on the
   page, <900px" check INVERTED with its reason — the owner's own order supersedes it.
4. **THE TROPHY CASE DROPS THE TOILET BOWL AND COUNTS IN CUPS** (user: two follow-ups). The
   toilet rows STAY on the team docs and in awards_history — the case just doesn't hang
   them (the fixture still seeds one, which is what makes "it does not render" a real
   assertion). A repeat winner is a ROW OF ICONS, one per year, each wearing its year — no
   ×N anywhere (`.tctoken`, the four-titles case reads as four cups).
5. **EVERY SCORE CARD WEARS THE MATCHUP SLASH.** GFFL matchup cards (league home + Scores
   tab, hero and compact alike) take the muhero's exact three-stripe mobile geometry via the
   same six-pseudo-host trick — hosts are `.muscore` and `.herorow` (always-rendered,
   unpositioned, UNCLIPPED — `.muteam` can't host, its overflow:hidden clips pseudos) —
   with each team's own palette inline. NFL `.sccard`s take a two-stripe version in each
   NFL team's REAL colours: `team.color`/`alternateColor` slimmed in ALL THREE parsers
   (live poll, replay slate, replay apply) through `D.nflHex` (bare 6-hex or nothing —
   a colour ESPN never sent paints no band, `var(--tpa, transparent)`), and the home side
   MIRRORED (crest on the outer edge) exactly like the matchup layout.
6. **WEEK CYCLING ON THE SCORES TAB** (user: "cycle to view future weeks for both").
   `UI._scoresWeek` null = NOW (the live board, polling as ever); ‹ › browse GFFL weeks
   1..seasonWeeks+3. A browsed week is A PAGE, NOT A FEED: the GFFL pairings render as
   STATIC slash cards — real totals off the week's own write-once record when it exists,
   an honest "— vs —" when unplayed, and never tappable (the Matchup view belongs to the
   live week) — and the NFL slate comes from `D.fetchWeekSlate(w)`:
   `?dates=<season>&seasontype=2&week=N` (GFFL week N IS NFL regular week N), same event
   shape as pollScoreboard (deliberately side-by-side, NOT extracted — pollScoreboard's loop
   also feeds D.S.games, which a browsed week must never touch), fetched once per week per
   session with in-flight dedupe, only a REAL slate cached so an outage can retry. Stepping
   ONTO the live week returns to the live board, never a frozen copy.
7. **THE GATE PASSWORD IS "thegoatleague"** — and LG.PASS could NOT simply change with it:
   it is the server functions' secret, the famKey seed (roomId(LG.PASS) IS the Firestore
   collection name) and the salt in every PIN hash; changing it would point the app at an
   EMPTY collection. `LG.GATE_PASS` is the door, `LG.PASS` stays the plumbing. Typed
   "amenfarms" is now REFUSED at the gate; a device already inside is GRANDFATHERED (a
   stored session is not a typed entry — nobody gets bounced by a deploy), which the whole
   battery proves incidentally since every seed stores the old value.
8. (With #1:) the `.mvsugai` panel gained its ✕ + `.mvsugbody` chrome.

**SUITE**: new section AV (33 checks) + the restages above, each with its reason in place.
TWO OWN-GOAL LESSONS from this batch's first runs, both now written at the checks:
a raw `page.waitForFunction` in a section (instead of the tolerant helper) turns a staging
miss into a SUITE CRASH; and `await waitFnOr(...)` followed by `ok(true, …)` asserts
NOTHING — the previous run "passed" the finalized-totals check while the browsed week had
zero pairings at all (the shared seedSchedule carries ONE week; AV5 seeds its own two-week
sched now, and the check captures the wait's own result).

## 🏈 GFFL — THE FULL RULES RECONCILIATION vs ESPN'S REAL 2025 SEASON (2026-08-13, pre-week-1 proof)

User: *"did you confirm that all of our rules produce the same results as ESPN did for games
last season?"* The honest answer was NO — the settings had been imported and the FG rule
reconciled, but nobody had ever re-scored a real season through our rules and diffed it
against ESPN's own numbers. Now it has been, and it caught a REAL, season-corrupting bug 28
days before week 1. Files: `netlify/functions/league.mjs` + `assets/league/lg-data.js` +
`tools/_gffl_shadow_score.mjs` + NEW `tools/_gffl_rules_reconcile.mjs` (permanent equipment).

**THE HARNESS**: `lg_espn_rules_audit` (the kicker audit widened to every position — though
its slot-filtered kona recipe, which worked 2026-08-07, 400s today and past-season kona lines
come back with EMPTY appliedStats; ESPN moved) + `lg_espn_probe` (a bounded, ALLOWLISTED,
family-secret-gated read-only passthrough — the iteration loop that found the recipe that DOES
work: **past-season mBoxscore per scoringPeriod** serves every rostered player-week's raw
stats + `appliedStats` — the per-statId points ESPN actually paid — + ESPN's own player and
matchup totals). `node tools/_gffl_rules_reconcile.mjs [season] [weeks]` walks all 17 weeks:
every exercised coefficient vs the live rules doc (through the server's own STAT_MAP, regex-
extracted so there is ONE source of truth), paid-but-unmapped statIds, per-player re-scores vs
`appliedStatTotal`, per-team starter sums vs `totalPoints`, and the unexercised-rules list.

**WHAT IT CAUGHT — the pointsOverrides[16] trap.** ESPN stores every DEFENSIVE rule's real
value in `pointsOverrides["16"]` (the D/ST position group) while `points` is a genuine 0 —
and the importer's `points ?? override` NEVER falls through on 0. So the live rules doc had
**six defensive rules at ZERO** (sack 1, int 2, fum_rec 1, fum_forced 1, blk 3, safety 4 —
154 paid sack samples in 2025 alone), return TDs at 6 where the override pays **8**,
dst_2pt_ret at 2 where the override pays **4** (the 2026-08-08 shadow-scorer repair had
inherited this same parse bug for that field), armed PA brackets in a league that **scores no
points allowed at all**, and an armed xp_miss (-1) for a rule ESPN's scoringItems don't carry.
Every D/ST would have under-scored every week of the real season. FIXED three layers deep:
the parse (override wins when present), the LIVE DOC (backup → masked PATCH → verified), and
the app.

**THE LAST 5 OF 2,497 TAUGHT THE SEMANTICS**: the overrides apply ONLY when a stat scores for
a D/ST SLOT. An individual player's kick-return TD paid the base 6 (Shaheed's real rows), and
a player credited with a fumble recovery paid the base **0** (Hurts w14, id 96 applied 0).
So `normSlp` is POSITION-AWARE now (`normSlp(st, isDst)`, callers pass `meta.pos === "DEF"`,
pts_allow-presence as the backstop): defensive keys are D/ST-only; a player row maps its
`st_td` into dst_td (6) and nothing else defensive. Two NEW scorer keys — `dst_fum_forced`
and `dst_kr_td` (the unit's kick/punt-return bucket at 8; Sleeper never splits KR from PR and
ESPN pays both 8, so one bucket is exact) — with `deriveEspnDst`'s scoring-play regex split
the same way. The shadow scorer mirrors all of it (selftest 50/50; its "6 drift keys" check
restaged to 4 — two were PROMOTED into the scorer because the league really pays them).

**THE RESULT**: **RECONCILED — zero discrepancies.** Every exercised coefficient to the
penny, all **2,497 player-week totals**, all **136 matchup totals**, across the family
league's entire real 2025 season. ESPN internal-consistency (Σ appliedStats = appliedTotal)
0 mismatches. Unexercised in 2025 and grounded through the settings instead: one_pt_safety 1,
dst_2pt_ret 4, dst_td 6, xp_miss 0.

**LESSONS**: `0 ?? x` is the whole bug class — a real zero never falls through, and ESPN uses
real zeros next to overrides; a coefficient audit over one position (the kicker audit) proves
that position only — the D/ST family was broken the entire time it was green; and the
recipe that works on ESPN's past seasons CHANGES (slot filters worked Aug 7, 400 Aug 13) —
which is why lg_espn_probe exists. Battery **2468/2468** over the position-aware
normalization, zero restages needed. RE-RUN `_gffl_rules_reconcile.mjs` after ANY scoring
change, and against 2026 itself once real weeks exist.

## 🏈 GFFL — THE NFL SCORE CARD, FROM THE USER'S OWN SCREENSHOT (2026-08-13)

User, with a DET@CIN card attached: *"center the vegas line and the player count, center the
time and add timezone, make the logos much bigger and move them off of the color slashes and
spell out the whole team name using 2 rows centered."* Files: `league.html` +
`assets/league/lg-{data,ui}.js` + `tools/_verify-gffl.cjs` (2468 → **2474**, FAIL 0).

- **CITY IS SLIMMED IN ALL THREE SLATE PARSERS** (`comp.team?.location`) — pollScoreboard,
  fetchWeekSlate AND fetchSimSlate + the applySimSlate away/home passthrough; miss any one
  and a browsed/replay week's cards silently fall back to abbrevs while the live board reads
  full names. Two-row name = `.sccity` (12px) over `.scnick` (700 15px), both ellipsised;
  **a team ESPN sent no location for falls back to the bare abbrev as the nick row** — never
  a blank line (the fixture keeps DEN name-less on purpose, the same discipline as its
  crest-less/colour-less role).
- **CRESTS 24 → 44px, in a FIXED 44px box** — a crest-less team renders `.sclogo-none`, the
  same-size empty span, or every column with no logo starts 44px higher than its neighbour
  (the matchup layout's placeholder lesson). The columns are centered flex, and
  `.scteams { padding:0 34px }` walks both columns OFF the slashes — the slash pseudo-hosts
  themselves are untouched, the content just clears their reach (asserted: crest left edge
  ≥44px from the card edge).
- **Kickoff pinned to America/Chicago + " CT"** (`kickTimeStr` toLocaleTimeString with an
  explicit timeZone — the family is one league in one timezone; a viewer's device zone was
  never the right answer). State row / vegas line / MINE-OPP all centered — the spread and
  count assertions are **Range-measured** (a block element's own midpoint is always centered;
  only the INK's midpoint proves anything — the AE lesson again).
- **RESTAGE LESSONS, two, both from the first run's 2472/2**: a fixture that stops sending
  abbrevs as the visible name breaks every abbrev-text FINDER, not just the card checks —
  sweep the whole suite for /DAL/&&/PHI/-style finders (line 5252's Scores-tab finder was the
  straggler → /Cowboys/&&/Eagles/); and "both cards' crests at equal heights" became
  **within-card crestsLevel** — a live card now legitimately stands taller than an upcoming
  one (scores render beneath the names), so cross-card height equality stopped being true
  for a good reason. Fixture: `NFL_NAMES` map spread into all four competitor sites, DEN
  deliberately absent (the no-name/no-crest/no-colour fallback case in one team).

## 🏈 GFFL — PLAYER HEADSHOTS (2026-08-13)

User: *"would it be possible to bring in player images?"* → *"do it."* Files: `league.html` +
`assets/league/lg-{data,ui}.js` + `tools/_verify-gffl.cjs` (2474 → **2507**, FAIL 0, new
section AW). No server work, no keys, no cost — **two CDNs keyed by ids the app already
holds, both verified LIVE before a line was written**: ESPN hosts a headshot for every espn
player id the rosters key on (`/i/headshots/nfl/players/full/<id>.png` answered 200 for real
roster ids; their COMBINER resizes server-side — 8KB at 96px, 20KB at 160, vs a 260KB
original; a bad id answers a clean 404), and Sleeper's thumb CDN covers slp_/name-resolved
keys via the same `D.pidForKey` the scoring already trusts. A D/ST wears its team crest.
- **`D.headshotUrl(key, px)`** (lg-data, beside teamLogo) is the one answer: dst_ → crest ·
  numeric → combiner at the asked size · else pidForKey → sleeper thumb · "" otherwise.
- **`pshotHtml`/`pshotPh`** (lg-ui): ONE fixed-size circular box, ALWAYS rendered — the box
  is what keeps every row's name on one left edge whether ESPN has shot this man or not (the
  crest-placeholder discipline's third outing); a 404'ing face hides ITSELF via onerror and
  leaves the disc standing.
- **WHERE, and the width rule that decides it**: the players table (22px, sticky PLAYER
  column widened 116→144 phone / 150→180 desktop — the phone budget re-cut in the CSS
  comment lands at 336 of 342, still no panning for PLAYER/ADD/TYPE/PROJ), the stats card
  (72px, fetched at 160 for retina), the claim-card header + every drop/swap-candidate row,
  and a rival's read-only roster — at EVERY width. The matchup rows (`.mushot`, 38px, OUTER
  edge both sides — the score cards' crest convention; empty halves and the TOTAL row carry
  the placeholder so the desktop columns keep one edge) and My Team rows (`.lkshot`, 30px)
  render at **≥1024px ONLY**: the phone matchup row's 101px name budget and AD8's measured
  ≥140px locker name floor were both bought by measurement, and a face + gap costs exactly
  that width. Both halves of the rule are ASSERTED — painted on a desktop,
  in-the-DOM-but-not-painted at 390 with AD8's floor re-measured on the same page.
- **SUITE**: the two headshot CDNs are FIXTURED (the crest-CDN precedent — an aborted <img>
  can only ever be asserted as "the element exists"): a real SVG face by default, and a 404
  under `fixture.headshotsDown` proving the onerror-placeholder path against the real
  failure shape. FIXTURE FACT that shaped AW1: the browse pool's two non-D/ST free agents
  deliberately carry NO espn_id (item 1's own note), so the espn-combiner row assertion has
  to click the All filter to find a rostered numeric key — the Available pool exercises the
  SLEEPER path, which is the one worth proving there anyway.
Plates: `shots/gffl_headshots_moves_390.png`, `gffl_headshots_matchup_1440.png`.
**KNOWN**: a brand-new signing ESPN hasn't photographed 404s to the disc (by design); the
face discs sit on `--nested2` so a transparent-PNG headshot never floats on the card colour.

## 🏈 GFFL — THE GROK PROJECTION ADJUSTER (2026-08-13)

User: *"ESPN projections are always bad, they basically project everyone will get about 10
points"* → investigate better sources vs an AI machine → *"skip fantasypros for now and go
with the grok adjusting from espn projection."* Files: `netlify/functions/{farmgpt,league}.mjs`
+ `assets/league/lg-{core,data,ui}.js` + `league.html` + `tools/_verify-gffl.cjs`
(2507 → **2535**, new section AX). farmgpt regressions all green (storyledger 683 · kidstory
54 · dnd 47 · ffai 32).

**MEASURED FIRST, BUILT SECOND.** Both candidate baselines were graded against the family
league's REAL 2025 boxscores (the reconcile machinery): ESPN MAE ~5.3-6.3 / sd ±3.6-4.4,
Sleeper ~5.4-6.1 / ±3.4-3.8, against actuals at ±7.3-8.9 — the user's "everyone ~10" is a
real 13.5±4 compression, and a naive 2-source blend buys NOTHING (pooled 5.91 vs ESPN's own
5.84; skill positions only after the first run's kicker-scoring contamination). Weekly MAE
~5 is near the industry ceiling (FFA's decade study), so the design goal is RANK ORDERING +
RESPONSIVENESS, not halving the error. Also measured: **Sleeper DOES retain past-season
projections now** (regular/2025/N answers real stat lines — the X8-era "not retained"
finding is stale), which is what made the backtest possible at all.

**THE PIPELINE** — one doc per week, `proj_<season>_w<week>` (kind "proj"):
- **`lg_espn_projections {week}`** (league.mjs): kona_player_info + X-Fantasy-Filter
  sortPercOwned (limit ≤400) → each player's weekly PROJECTION line (statSourceId 1,
  statSplitTypeId 1) whose `appliedTotal` is ALREADY in the league's reconciled-to-the-penny
  scoring — rostered players AND free agents in one bounded call. **Verified LIVE on the
  current season before a line was written** (Achane 17.0/Adams 12.3 at week 1 2026) —
  past-season kona is the recipe that broke; current-season works.
- **farmgpt mode `gffladjust`** (Grok 4.5, the full gffltrade lesson set: reasoning_effort
  low + temp 0.2 + maxTokens 6000 — reasoning bills against the cap — + the 8s heartbeat,
  safe here because JSON.parse tolerates leading whitespace; no-key degrade + mid-request
  fallback to Sonnet; usage bucket "w"). GFFLADJUST_SYSTEM is built around CALIBRATION
  DISCIPLINE: base is the anchor, ±35% unless a concrete fed fact, OUT/IR→0-2, moves must
  roughly balance across the list, short log = less reason to move. Named body field
  `adjust` (the ledger lesson), server-re-validated per player.
- **`LG.ensureAdjustedProj()`** (lg-core): single-flight, adopt-existing-first, 20h TTL,
  10-min failure floor, skipped under the replay and on a mirror. Context per player: ESPN
  base + last-5 finalized-week log (D.weekStats, cached) + injury designation + depth order
  + opponent. Batches of 35, ≤150 players (every rostered numeric key + top-owned FAs).
  **VALIDATED, NOT TRUSTED**: only keys we sent are kept (hallucinations dropped), and the
  UPWARD clamp is max(2×base, base+6) — inflation is the damage direction; a downward move
  (injury news) is self-limiting at 0 and deliberately unclamped. Triggered from UI.boot
  post-paint, detached, repaint-when-ready.
- **`D.projFor` consults the doc FIRST** (week-gated to LG.currentWeek(), never under the
  replay) — so the adjustment flows through the matchup, locker, players table, win
  probability and the pre-game accuracy snapshot with no surface knowing it exists. The
  stats card gains `.pcadj`: "AI-adjusted from ESPN's 9.8 — <the model's ≤10-word reason>"
  — the explanation line no external source could give us. **SCOPE, stated**: only NUMERIC
  (espn-id) keys are adjustable — a slp_ key exists precisely because the player has no espn
  id; D/STs and slp_ FAs keep the old Sleeper-scored path.

**SUITE**: the fake xai's gffladjust branch answers from the request's OWN players (inj →
base×0.2, else base+1.5) PLUS two deliberate poisons — a never-sent key and an 80-on-a-base-
of-8 inflation — so validation/clamping is proven, not assumed. **`fixture.espnProj` defaults
OFF and this is load-bearing**: UI.boot auto-runs the adjuster on EVERY suite page, and an
armed baseline would silently move T. Tight's hand-computed 8.5 (present in dozens of
assertions) to 10.0 across the whole battery — the empty-kona default makes generation fail
open at "no-baseline" on every pre-existing page, byte-identical projections everywhere.
TEST BUG caught pre-run: `waitFnOr(page, fn, ...args)` has a FIXED 9s timeout — passing
`15000` as a third arg feeds it to the browser fn as its first ARGUMENT (getItem(15000),
never true).

**HONESTY NOTE for the season**: Grok's accuracy CANNOT be backtested on 2025 (the season is
inside its training data — any such number would be contaminated); it is judged live-forward.
The clamps + fail-open guarantee it can never be worse than the ESPN baseline by more than
the calibration band it was given.

**KNOWN / DEFERRED**: regeneration is client-driven (first device of the day pays ~5 Grok
calls ≈ $0.10-0.25/wk; two devices racing = double-spend + last-write-wins, family-scale
acceptable, noted at the writer); the FA table's PROJ column for slp_-keyed FAs stays on the
old path; and Bust of the Week now grades against the ADJUSTED projection wherever the
snapshot captured one — the projection of record is the adjusted one, which is the point.

## 🏈 GFFL — THE FIRST LIVE GAME NIGHT'S FIXES (2026-08-13, preseason wk1 on real screens)

Three findings from the family's first night watching REAL games through the app. Files:
`assets/league/lg-{data,ui}.js` + `league.html` + `netlify/functions/sports.mjs` +
`tools/_verify-gffl.cjs` (2536 → **2559**, new section AY) + `tools/_verify-sports.cjs`
(→ 275; its ONE failure, a standings W-L nowrap check, is PRE-EXISTING — proven by stash-
revert-rerun at HEAD: fails 273/274 there too).

**1 · "SCORES GO TO ZERO EVERY 30-40s, THEN COME BACK" — two stacked defects, diagnosed by
booting the real page against the LIVE feeds** (scratchpad zero_probe.cjs — both raw wires
were proven STABLE first, so the flicker had to be ours; the repro's own health flap
mid-run was the tell):
- **failN accounting**: every failed ESPN summary bumped `failN` individually — six live
  games meant ONE flaky cycle jumped it past the ≥3 threshold in a single pass → health
  flapped into sleeper-only → next scoreboard success reset it → dual again. 15-45s
  oscillation, exactly the reported period. failN now moves AT MOST ONE per cycle, and only
  when EVERY summary in the cycle failed — a partial summary failure is not an outage.
- **mergeRow's degraded pin**: sleeper-only pinned EVERY player to the Sleeper side — and
  Sleeper's live preseason bucket (946 rows that night) was missing rostered vets outright →
  `pick` empty → row.pts null → **livePts coerces null→0** → literal 0.0 on screen. The pin
  now falls back to the OTHER side when the surviving source has nothing for a player: a
  stale number beats a fabricated zero, and the pin's real intent (no display flip-flop
  during an outage) is untouched when the surviving side genuinely has him.
**2 · FLASH-FREE LIVE REPAINTS** — every poll tick replaced innerHTML wholesale, re-creating
every node: headshots/crests re-decode (the visible flash), scroll resets, an open details
snaps shut. **`patchInto()` — a ~70-line keyed DOM morph** (lg-ui, beside paintLive): same-
shape nodes are KEPT and only changed attributes/text move. Rules, each load-bearing:
children align by `data-mkey` when present (else index); a DETAILS' `open` is the READER'S
state, never synced; `data-wired`/`data-pc-wired` never synced (survivors keep their
listeners; only NEW nodes re-wire — **the guard is `data-pc-wired`, wirePlayerCardTaps' own
camelCase dataset key, and the first cut wrote `data-pk-wired` into the keep-set: one tap
would have opened N cards after N ticks**); morph ONLY on a same-view repaint (each caller
checks a structural sentinel — morphing another view's tree lets old nodes with old
listeners survive by shape coincidence). Applied to: **renderMatchup(repaint)** (the three
volatile card interiors get ids muHead/muLineup/muBench and morph; feed/AI-read/trash-talk
untouched on repaint — which also fixed a latent composer-wipe; the repaint branch skips ALL
re-wiring except the guarded wirePlayerCardTaps), **paintScores** (morph + wireOnce guards;
handlers RE-READ data-mu/data-eid at CLICK time — a surviving node's morph may have removed
the attribute that made it tappable), and **paintNflGame**.
**3 · DRIVE DROPDOWNS + THE PROGRESS ARROW** (nflgame view): previous drives with plays on
file are native `<details class="nfldrvd">` (summary = the exact old one-line card + "N
plays"; a drive the payload carried no plays for stays a plain line, never an empty
disclosure), KEYED by from-game-start ordinal — `previous[]` is newest-first, so an INDEX
key would slide the reader's open state onto a sibling every time a drive completes.
sports.mjs's slimGame forwards per-drive `plays` (capped 20, same slimPlay). And the field's
fixed direction glyph is SUPERSEDED by the **drive-progress arrow**: tail at the drive's own
start, head AT THE BALL — its length is the drive, and a drive that lost ground honestly
points backwards; the old glyph survives as the fallback for a too-young drive (<~2yd span).
**SUITE**: section AY — the one-source-row survival matrix under forced health modes, the
summary-blackout accounting (fixture.espnSummariesDown: 3 cycles, mode stays dual, failN
[1,1,1], P. Passer's 10.0 never wavers), same-node-across-repaint proofs via JS-property
marks (a property survives a morph, never an innerHTML replace — the exact distinction under
test), composer text+focus through a tick, ONE card per tap after three repaints, the
dropdown surviving a poll AND a new drive prepending (data-mkey drv_2 stable), and the
arrow's tail/head hand-computed from the fixture (691.7 → 183.3). RESTAGED with reasons: AH3
(the fixed glyph is superseded — tail/head asserted instead), AH4 + the AH2 shapeOf helper
(play counts scope to `.card > .nflplays`, the current drive's own list), and the fixture's
TD drive gained 2 plays (the Punt deliberately none — the degrade case).
**KNOWN**: the sports suite's W-L nowrap failure predates this batch (fails at HEAD);
morph-surviving nodes keep listeners by DESIGN, so any future per-node wiring on a morphed
view must use wireOnce/dataset guards — the rule is written at MORPH_KEEP_ATTR.

## 🏈 GFFL — THE OTHER REPAINT SEAM (2026-08-13, same night, user: "the nfl matchup view is
still doing the full screen refresh instead of the morph")

The morph work covered each view's own POLL path — but `LG.db.onChange`'s ~15s background
refresh still rode `UI.show(view)` → the FULL renderers: `renderNflGame()` wipes to "Loading
the game…" and refetches, `renderScores()` wipes to "Loading scores…", `renderMatchup()`
rebuilds wholesale. Every 15 seconds, on the screen the family was actively watching — the
exact flash the morphs had just removed, resurfacing through a different door. Files:
`assets/league/lg-ui.js` + `tools/_verify-gffl.cjs` (2559 → **2563**, AY5).
- **`UI.quietRepaint()`** is the background-refresh dispatcher now (onChange + the projection
  adjuster's landing both route through it): matchup → refresh rosters (the background change
  may BE a waiver landing) then the MORPH branch · **nflgame → skip entirely** (nothing on
  that screen reads LG.db — it is pure ESPN payload, so a db change has nothing to repaint;
  its own 25s poll morphs) · scores → the ordinary renderScores, whose loading-card wipe is
  now ARRIVING-ONLY (skipped when the Scores view is already painted, so the .scweeknav
  sentinel survives and paintScores' morph engages) · every other view keeps the full repaint
  it always had.
- **THE MORPH BUG THE WIPE-SKIP EXPOSED — an ID is an IDENTITY.** With renderScores no longer
  wiping, the week-nav's buttons started surviving live↔browse morphs by SHAPE: `#scNext`
  survived as "#scNow" — id rewritten by the attribute sync, `data-wired` preserved by the
  keep-set, and the node still firing its original `step(+1)` listener. "Back to now" paged
  FORWARD instead (AV5 caught it: 2561/2). morphChildren now REPLACES a same-shape survivor
  whose id differs from the incoming node's — morphing across ids is how a control becomes a
  different control wearing someone else's listener. Note the ORDER of discovery: the
  previous battery was 2559/0 because the old always-wipe path made fresh nodes every render
  — the bug was born WITH the morph but only reachable once the wipe stopped.
- **AY5** proves the seam with a MutationObserver armed BEFORE the refresh (a transient
  loading-card flash cannot be caught by sampling after): nflgame untouched + no "Loading the
  game…" ever, matchup same-crest-node through onChange, scores same-node + no "Loading
  scores…". The 2 AV5 failures the id-clash caused are green again with zero restaging —
  they were correct all along.

## 🏈 GFFL — SCORES AT THE API'S OWN FLOOR: the light/full poll split (2026-08-13, same night)

User: *"it looks like our nfl score is about 30 seconds delayed from ESPN, any way to lower
that delay?"* MEASURED FIRST, during a live game: ESPN's public scoreboard is **edge-cached at
`cache-control: max-age=7-9s`**, and a cache-busted query param returns byte-identical data —
so ~8s is the freshest that API ever gets (ESPN's own app rides a private FastCast push
channel; single-digit parity is unreachable from the public REST). The family's ~30s was
their ~8s + OUR cadence (15s main poll, 25s game-view poll). Files: `assets/league/lg-{data,
ui}.js` + `tools/_verify-gffl.cjs` (2563 → **2567**, new AY6).
- **`D.pollOnce({light:true})`** fetches the SCOREBOARD ONLY — score/clock/state, the thing
  the eye compares against ESPN's app — then merges + paints; it skips the injury refresh,
  Sleeper, and the up-to-8 per-game summaries. **A DIRECT `pollOnce()` is always FULL**, which
  is the load-bearing design choice: dozens of suite sections stage state with `poll(page)`
  and every one keeps its meaning — ZERO restages.
- **The loop runs 8s ticks while live, alternating FULL/LIGHT** (tick 0 always full — boot
  needs the Sleeper seed; an explicit `D.start(ms)` stays full at that cadence; idle stays
  60s full). Net: scores refresh every ~8s, the heavy half keeps its old ~16s volume — total
  upstream summary/Sleeper load UNCHANGED, scoreboard fetches 2x (fine at family scale).
  Sleeper's health `lastOk` deliberately doesn't move on a light tick (full ticks land every
  ~16s, inside every staleness window; a light tick learned nothing about Sleeper).
- **`startNflGamePoll` 25s → 12s while THAT game is live** (pre 120s / final never, unchanged).
- Expected on screen: ~9-17s behind ESPN's app instead of ~15-34s.
- **AY6** asserts via the app's OWN `D.EP` endpoint bookkeeping (no new fixture recorder): a
  light pollOnce bumps "espn scoreboard" and neither "espn summary" nor "sleeper stats"; the
  game map is live off it; a plain pollOnce() still fetches both heavies. waitLive already
  stops the loop, so the counts are race-free between the check's own calls.

## 🏈 GFFL — POSSESSION RINGS THE PICTURE, THE MATCHUP SCORES RIDE THE OUTER EDGE (2026-08-13, same night)

Two live-test tweaks, `league.html` CSS + a two-site reorder in `assets/league/lg-ui.js` +
`tools/_verify-gffl.cjs`. User: *"if a player's team has the ball, their whole card gets
highlighted in yellow and I found that to be too much — just highlight the player's picture
in gold. also the away team's PLAYER SCORES IN THE MATCHUP should be all the way to the
left."* (The first pass mis-read #2 as the NFL score cards; the user corrected — it's the
matchup lineup rows. The `.scteam` score-card change was reverted, unshipped.)
- **POSSESSION**: ITEM 25's whole-cell inset gold ring PLUS a faint gold row WASH
  (`rgba(255,182,18,.07)`) — the wash is the "too much". The gold now rides the HEADSHOT:
  gold border + inset gold rim on `.mushot`/`.lkshot`. INSET, not an outset halo — the image
  is circular `overflow:hidden` and `.pcellgrid` sits tight against neighbours, so an outset
  ring could clip; inset can never clip or shift the "exactly even height for every player"
  row layout. **The picture is desktop-only (>=1024px)**, so MOBILE (no headshot) keeps a
  QUIET ball-side gold EDGE (`inset ±3px 0 0`) on the possessing cell — far lighter than the
  old full-card wash, and still a gold box-shadow so section AD5's 390px read is unchanged.
- **MATCHUP SCORES**: item 3/AE put the `.ppts` column INNER (both scores flanking the centre
  slot, names on the outer edges) per the ESPN head-to-head reference. The user wants the
  reverse: the SCORE rides the OUTER edge, the face just inside it, the name inner toward the
  slot — away = `[score][face][name→]`, home = `[←name][face][score]`. So away scores form a
  clean LEFT column, home a clean RIGHT column, names flank the slot. ONE reorder in
  `halfCell`/`totalHalfCell` (`side==="right" ? infoDiv+shot+ptsDiv : ptsDiv+shot+infoDiv`) +
  `.pcellgrid.left .ppts{text-align:left}` (away number hugs the far-left edge; home keeps
  `text-align:right`). The total fixed width (52px score + 38px face) is unchanged, so the
  flex:1 name budget the phone rows were tuned to is UNTOUCHED — no name-clip regression.
- SUITE: AD5 (390px) stays green on the mobile edge (restaged to say so); NEW **AD5b** boots
  1440px and proves the picture ring + no card wash. The item-3 geometry check and AW4's
  desktop face-outer check both INVERT (now score-outer/face-inside), restaged with reason;
  AE's points-column comment + right-name-edge message restaged (the assertions —
  score-on-name's-line, consistent name edges — still hold, only the wording moved). The
  header (muhero) keeps crest-outer/score-inner, untouched. Plates:
  `shots/gffl_pt_matchup_{390,desktop}.png` (gold-ringed faces, scores at the outer edges).

## 🏈 GFFL — READABLE SCORE NUMBERS: matchup scores move to Inter (2026-08-13, same night)

User: the matchup scoring number font *"is hard to read because it's so compact."* The scores
used `--font-display` = Barlow **Condensed** — the narrow digits were the "compact". RESEARCHED
ESPN: their own site uses proprietary A2 Beckett / Klavika; the freely-available sports-stat
standard for aligning number columns is Inter or IBM Plex Sans with tabular figures. Built a
4-panel side-by-side (Barlow / Inter / IBM Plex / Roboto) rendered with real Chrome + the GFFL
colors (scratchpad `fontcompare.html`); user picked **Inter** — already loaded (zero new font),
non-condensed, tabular. New **`--font-num`** token (Inter stack, distinct from `--font-body` so
the number font can move independently and it's one place to extend) applied to the matchup
score elements: `.pcellgrid .ppts .pts` (row + total scores), `.bigpts` + `.muhead .muhproj`
(muhero header), `.muscore` (the small matchup cards on league home / Scores tab). `.pproj`
already inherited Inter (no font-family set), so it needed nothing.
- WIDTH CHECKED before running the suite (scratchpad `widthcheck.html` — rendered pixel widths
  of realistic scores in Inter tabular vs the column budgets): a 4-char score ("41.0" = 24.5px)
  fits the 30px mobile `.ppts` comfortably; only a theoretical 5-char PLAYER score (100+ or
  ≤ -10, essentially never in one week) is 31.5px and the existing `.pline overflow:hidden`
  clips it gracefully; the total column (44px) fits "148.0" at 38.3px, desktop (52px) fits
  everything. Sizes UNCHANGED — the readability win is the non-condensed SHAPE, not the size.
- No suite check asserted the score font-family (grep-confirmed), so NO restage; the AE
  total-fits check confirms Inter still fits its box. Battery **2579/2579**.
- SCOPED to the matchup: player stats-card scores (`.pcweekrow .pts`, generic `.pts`) and the
  standings / players-table numbers stay on Barlow Condensed — different surfaces, and a
  one-token extension if the family later wants them to match. Plates:
  `shots/gffl_pt_matchup_{390,desktop}.png` (open, readable Inter digits).

## 🏈 GFFL — PLAYTEST-5: the players table grows up, and a big game shows itself (2026-08-15)

Five items from one sitting. Files: `league.html` + `assets/league/lg-ui.js` +
`netlify/functions/sports.mjs` + `tools/_verify-gffl.cjs` (2607 → **2653**, FAIL 0).

**1 · %ROST / %START, AND FIXED COLUMN WIDTHS.** New server action **`nfl_ownership`** —
DELIBERATELY NOT `ff_pct_owned`'s cousin: that one asks the private LEAGUE endpoint about a
handful of ids and therefore needs the cookies; this reads ESPN's **PUBLIC per-season player
pool**, no auth at all, and returns the top 300 by ownership in one call, which is what a
BROWSABLE table wants. **PROBED LIVE BEFORE A LINE WAS WRITTEN, and the finding is the whole
feature**: the `x-fantasy-filter` here must be **TOP-LEVEL** — the nested `{players:{…}}`
shape every other call in that file uses is silently IGNORED and the server answers 200 with
all ~11,573 players and **~39 MB**; `{filterActive, limit, sortPercOwned}` at the top level is
honoured (300 rows, ~8.8 MB, ~950 ms). The response is a **bare array**, not `{players:[…]}`
and not per-row `{player:{…}}` (both tolerated anyway — ESPN has moved a recipe under us
before). Browser UA, which is lm-api-reads' rule and the INVERSE of site.api.espn.com's
`curl/8.6.0` — do not unify. 30-min warm cache keyed season+limit, **success only** (a failure
must be retryable on the next call — `D.weekStats`' discipline). A player with no ownership
figure is **absent**, so the table renders "—" rather than a fabricated 0.
Client: `UI._ownership` + `bucky_gffl_own` (6h localStorage, 10-min failure floor), columns
via a real `<colgroup>` so phone and desktop share one width contract, and **default sort is
PROJ desc** (the column you actually shop by; FPTS/AVG were the old default).
**2 · CHAT FILLS THE PHONE SCREEN** — `sizeChatList()` measures the gap to the tab bar into
`--chatlist-h`. **THE DESKTOP GUARD IS LOAD-BEARING and the agent's own suite caught it
missing**: at ≥1024px `.bnav` is a sticky TOP strip, so `navTop − listTop` goes negative and
clamps to the 200px floor — the desktop chat pane collapsed. The measurer now runs on phones
only and CLEARS the root var otherwise (`UI.show` re-runs it, so the var self-heals on a
resize into desktop).
**3 · Down/distance on the scores MOBILE view** — already shipping. The checks run at 390 by
default and pass; no CSS hides it. The family's phone was holding a stale cache.
**4 · PHONE LEAGUE ORDER** = week matchups → recent moves → standings → injury report. Desktop
untouched (its two-column dashboard is user-arrangeable).
**5 · THE BIG-GAME EMBER** (the user's own experiment): `bigGame(pts, proj)` → 0/1/2 from
`HEAT = {ptsHot:18, ptsBlaze:28, ratioHot:1.5, ratioBlaze:2.0}` — a floor AND a ratio, so a
20-point stud meeting his projection stays quiet while a 20 on a 9 glows. Rendered as
`data-heat` on the matchup row with a warm **outline** + a 2.6s ember pulse (1.7s blazing) and
an orange score; `prefers-reduced-motion` gets the static rim. **Outline, not box-shadow, on
purpose — box-shadow is possession's gold ring**, and the two must be able to fire on the same
row. The row's name and stat line keep their ordinary ink: the ask was "immediately shows a
player is having a big game" WITHOUT hurting readability.
**THE BUG A PLATE CAUGHT, NOT A TEST**: the first cut divided by `d.liveProj(...)`, which
already folds in points scored — so the ratio can never exceed 1 mid-game and the ember could
never fire. The denominator is the PRE-GAME `d.projFor(p.key)`.
**AND MY OWN ARITHMETIC WAS WRONG IN THE SUITE**: I asserted 32.0 for the fixture's monster
line (400 yds × 0.04 + 4 TD × 4) and forgot its 2-pt conversion — 34.0. The TIER was right
either way, which is exactly how a hand-checked expectation hides: derive the number from the
fixture, then check the tier separately.
**VERIFY**: battery **2653/2653** (+46: I2b's 41 ownership/column checks incl. a real
server-level `nfl_ownership` call, AD5c's ember block) · sports **229/229** · plates
`shots/gffl_biggame_{390,desktop}.png` reviewed.
**POST-DEPLOY MEASUREMENT changed a constant, which is why the eyeball was flagged**: live,
300 rows returned 241 players with a figure and **bottomed out at 24.5% owned** — and a
FREE-AGENT table shops BELOW the rostered crowd, so most of the pool it browses would have
read "—". 500 rows reach a **5.8% floor** (423 players) at the SAME cost — 1.7s cold / 104ms
warm / ~8.9 KB down the wire, because the slimming happens server-side. `OWN_LIMIT_DEFAULT`
is 500; the CAP stays 500 too, since that is the depth actually probed and deeper is
speculation. The suite passes its own explicit `limit`, so no restage.
**KNOWN**: a player owned in under ~6% of leagues still reads "—" (genuinely fringe, and one
constant if the family wants deeper).

## 🏈 GFFL — THE PRESEASON PROJECTION TEST, GRADED: Grok lost, and the split says why (2026-08-15)

`tools/_gffl_preseason_test.mjs --grade` against Sleeper's real `pre/2026/1` (1,712 stat rows,
scored through the LIVE rules doc). Projections were LOCKED before kickoff in
`tools/_gffl_preseason_lock.json`, so this is a genuine forward test, not a backfit — and it
is the only kind of Grok measurement that CAN be honest, since 2025 is inside its training
data.
**HEADLINE: Grok MAE 3.36 vs the crude prior's 2.41 on 11 players. It did not beat the prior.**
**THE AGGREGATE HIDES THE WHOLE LESSON, and the split is unanimous both ways:**
- **Every STARTER, Grok won** (5/5): Conner 1.2 vs prior 2.5 · Higgins 2.0 vs 3.5 · Pittman
  1.8 vs 3.5 · Deebo 1.5 vs 3.5 · Njoku 1.5 vs 2.5 — actual **0.0 on all five**. It understood
  that starters barely dress in week 1 of preseason; the flat prior had no idea.
- **Every BACKUP, Grok lost** (6/6), and always by OVER-projecting volume: Tyrod 9.0 → 1.2 ·
  Dobbs 8.5 → 2.2 · Rudolph 9.5 → 3.7 · Perine 6.5 → 2.9 · Flacco 9.0 → 6.0 · Cousins 3.5 →
  6.0. It priced them as if they would play most of a game; they got a series or two.
**WHAT IT DOES AND DOESN'T TELL US.** The failure mode is *guessing exhibition snap counts for
backups* — which does not exist in the regular season, where the depth chart IS the volume
signal and the adjuster's own context (last-5 log, depth order, injury) speaks to exactly that.
A flat "everyone ~5" prior is also freakishly well calibrated for a week where nobody plays,
which will not be true again after Sep 10. So this is **weak evidence against Grok for
preseason and near-zero evidence either way for the season** — which is why the adjuster's
clamps (±35% band, upward ceiling `max(2×base, base+6)`, fail-open to the ESPN baseline)
matter more than this number: the one thing the test DOES confirm is that its errors run
UPWARD, which is the direction those clamps bound.
**NEXT**: re-grade on regular-season week 1 (Sep 10), where the measurement is finally the one
we care about.

## 🏈 GFFL — `?demo=ember`: a look-only score override so a rendering experiment can be SEEN (2026-08-15)

User: *"since I can't see an example right now, lets override a player result to 40 points so I
can see it in action."* Out of season nothing scores 40, and the big-game ember is an
experiment the family has to judge on their own phone. Files: `assets/league/lg-{data,ui}.js` +
`assets/league/lg-core.js` + `tools/_verify-gffl.cjs` (2653 → **2663**, new AD5d).
**THE URL**: `…/league.html?demo=ember#matchup` — query BEFORE hash (this repo has put the
query inside the hash before, and `location.hash` then reads `matchup?demo=ember` and the deep
link silently lands on the league home). It arms the viewer's OWN first two non-D/ST starters
at **40 on a 12 projection** (blazing: 40≥28 and 3.3×) and **20 on 12** (hot: 20≥18 and 1.7×),
leaving every other row untouched as the control.
**THREE RULES, all load-bearing, and the third is why this is safe to ship rather than a debug
branch to sneak in:**
1. **URL-ONLY, never persisted.** Unlike `?sim=` and `?look=`, which deliberately write a flag,
   this writes NOTHING — a demo you cannot remember switching on is a demo that misreports the
   league at 3am. Closing the tab ends it.
2. **It overrides the two DISPLAY funnels only** (`D.livePts` / `D.projFor`), so the ember, the
   score, the team total and the win bar all move together the way a real big game would — and
   `bigGame()` still does its own arithmetic on those numbers. The demo supplies a score; it
   does not paint the effect on directly, so what you see is the real rule firing.
3. **A DEMO BOARD REFUSES TO FINALIZE.** Fabricated points reach `D.livePts`, so without this
   they could reach `weekly_<season>_w1` — **write-once** — and stand there all season.
   `finalizeWeek`'s live path returns `{ok:false, reason:"demo-board"}`, **force included**,
   beside the existing `sim-replay` and preseason guards. The archived-stats BACKFILL is
   untouched: it scores from Sleeper's own records and never consults the live board.
`D.demoArm(keys)` is idempotent and called from `renderMatchup` BEFORE the totals are summed,
so it lands on real on-screen players rather than guessing at ids, and a poll tick keeps the
same set. Absent the param `D.demo` is `null` and every funnel is byte-identical — which is the
state the other 2654 checks already run in, now asserted explicitly once so it cannot drift.

## 🏈 GFFL — THE LOOT LADDER: WoW rarity colours replace the ember (2026-08-15)

User: *"lets try something similar but this time lets use the color convention for world of
warcraft loot, where baseline is white, then green, blue, purple and then orange."* SUPERSEDES
the two-tier ember shipped the day before. Files: `assets/league/lg-{data,ui}.js` +
`league.html` + `tools/_verify-gffl.cjs` (2663 → **2675**). Demo param renamed `?demo=loot`
(`ember` kept as an alias so the link already handed out keeps working).

**THE JUDGEMENT IS UNCHANGED — only the scale got longer.** Still a FLOOR and a RATIO, both
required at every rung, so a stud doing his job stays white (24 pts on a 20 projection: nothing)
and a kicker beating a 1.0 projection sixfold stays white too. `LOOT` is a plain table —
**uncommon 12/1.25 · rare 18/1.5 · epic 26/1.8 · legendary 36/2.1** — and `rarity()` walks it,
so adding or moving a rung is one line. The ember's two rungs survive INSIDE the ladder (its
"hot" is rare, its "blazing" ≈ epic), so nothing that used to light up has gone quiet. With NO
projection to judge against (a rookie, a replay board) the ratio gate is WAIVED and the floors
alone decide — the old code returned 0 in that case for anything under 28, which quietly made
an unprojected 40-point game look ordinary.

**THE PALETTE IS WoW's, LIFTED ONLY WHERE IT HAD TO BE — and the numbers are measured against
our own card (`--nested2` #151b26), in the suite, not eyeballed:**

| rung | WoW | on our card | shipped |
|---|---|---|---|
| uncommon | `#1eff00` | **12.62:1** | WoW exact |
| rare | `#0070dd` | **3.59:1** ✗ | `#1f8fff` → 5.29:1 |
| epic | `#a335ee` | **3.54:1** ✗ | `#c56bff` → 5.69:1 |
| legendary | `#ff8000` | **6.85:1** | WoW exact |

WoW paints those two on near-black chat text; our card is lighter, and at ~3.5:1 the middle two
rungs would have been **the hardest to read on the whole ladder** — backwards, and under the
4.5:1 AA bar for the row's most-scanned number. Lifting the luminance keeps both hues
unmistakably rare-blue and epic-purple. The suite recomputes the contrast IN PAGE from the
rendered colour (5.69:1 for epic, matching the prediction exactly), so a future edit that
quietly restores the true WoW values fails rather than merely looking wrong.

**TWO DELIBERATE DEVIATIONS, both stated at the code:**
1. **The colour rides the SCORE, not the name.** WoW tints the item NAME — but the name is the
   row's most-read text and the brief that started this was "doesn't interfere with
   readability". The score is the number that earned the tier, and in a lineup you scan by
   score the way you scan a loot list by name, so it is the true analogue.
2. **No row wash at any rung, and a breathing rim on LEGENDARY alone.** Five tinted numbers
   down a lineup read as a scale; five washed rows would be a paint chart. An orange drop
   stops the raid, so the top rung — which nobody hits most weeks — keeps the ember's outline
   flourish (still an `outline`, never a `box-shadow`: that property belongs to the mobile
   possession edge and an animation on it would erase the gold has-the-ball cue for exactly the
   players most likely to have both).
The `title` NAMES the tier ("Epic — 34.0 pts") because a colour alone means nothing to a
screen reader *or* to anyone who has never played WoW.

**VERIFY**: **2675/2675, 0 page errors**. AD5c restaged rung by rung with the reason in place
(the two conditions are unchanged, so every old case kept its meaning and just resolves further
along a longer scale) plus the in-page contrast measurement, "the rim is legendary's alone", and
the no-projection case. AD5d arms one starter on EVERY coloured rung (42/12 · 30/12 · 20/12 ·
14/10 — each clearing its own gates and neither of the rung above's) and asserts four DISTINCT
rendered colours, all ≥4.5:1. Plates: `shots/gffl_loot_{390,desktop}.png` (a real epic in a
live lineup) and `gffl_loot_ladder_{390,desktop}.png` (all five steps in one frame).
**KNOWN, and it is WoW's own trait rather than ours**: `#1eff00` is the brightest thing on the
ladder, so the LOWEST coloured rung slightly out-shouts rare and epic above it. Faithful to the
convention the family asked for; a desaturated green is the fix if it grates.

## 🏈 GFFL — DRAFT DAY IMPORT + the end-of-2025 roster reset (2026-08-15)

Two asks: *"reset all rosters to their end of 2025 positions"* and *"create an import roster
from Draft Day button in the comissioner rules view."* Files: `assets/league/lg-{core,ui}.js` +
`tools/_verify-gffl.cjs` (2675 → **2701**). No server work — see below, the join was free.

### THE DRAFT DAY IMPORT — the join costs nothing, and that is the finding
The draft happens in `ffdraft.html`, a SEPARATE app with its own collection
(`ffdraft_<famKey>/draft_<season>`, picks keyed `r<round>_t<teamId>`). **Probed before a line was
written**: that app takes its teams from ESPN (`ff_draftinfo` → `t.id`) and its players from ESPN
(`ff_draftpool` → `p.id`), which are the SAME team ids and the SAME player ids this league already
keys rosters by, and both apps hash the same family password so the collection name is derivable.
So the whole feature is **one document read plus a reshape** — no id mapping, no new server
action, no new secret.
- **`LG.db.foreignGet(coll, id)`** (both backends) is the only new plumbing: read-only, always
  fresh, and deliberately NEVER cached or mirrored — this league's doc/list caches must not be
  able to answer for another app's data.
- It reshapes into **`applyImportedRosters`' own wire shape** and hands off, so the slotting rule
  is not duplicated and cannot drift from the ESPN importers beside it. Sorting by ROUND is
  load-bearing: slots fill in list order, so a first-round pick has to arrive first or slotting
  would depend on object key order, which nothing guarantees.
- **REFUSALS, all before any write** (the real room is sitting at phase "keepers" with 0 picks
  right now, so the empty case is not hypothetical): no draft room · a room with no picks, naming
  the phase · **week 1 already finalized** (that record is write-once — a re-import over a played
  week would leave the roster and the result telling different stories). An UNFINISHED draft
  warns and still offers, because a commissioner may well want the picks made so far.
- Week **1** always, whatever week is on screen — a draft sets the opening roster. Two-step
  confirm (the backup-fill pattern): the first tap only ever SHOWS. Hand-typed "custom" picks
  (ffdraft writes `pid: "c_<slug>"`) can never be scored, so the confirm NAMES them rather than
  letting them turn up as em dashes on a Sunday.

### THE RESET — and the bug the word "positions" caught
`lg_espn_rosters_season` with no scoring period returns a PAST season's FINAL state, so the
existing "Import 2025 rosters (test run)" button already was this. Done as a script (backup →
masked PATCH → canonical re-read verify, the house pattern) since a button needs a browser:
all 8 teams, **156 players**, every one landing on exactly the legal shape (11 starters matching
the rules table, 7 bench, 1-2 IR), verified against what was sent.
**But the first run put Marvin Harrison Jr. in a starting WR slot when ESPN had him BENCHED.**
`applyImportedRosters` honoured the source's `lineupSlot` for IR *only* and re-derived everyone
else greedily from roster order — right players, wrong lineup, which is not "end of 2025
**positions**". Now **TWO PASSES**: honour the source's own slot where the rules have it, the
player is eligible and it has room; then fill whatever starting slots are STILL EMPTY, greedily,
in list order. A full source lineup leaves pass 2 nothing to do; a thin or absent one still
produces a LEGAL lineup instead of holes — and pass 2 alone is what the Draft Day import runs on,
where draft order IS the ranking. **The battery passed 2701/0 with ZERO restaging**, which is the
tell that this is the right rule rather than a bent test: the one check that failed under
honour-only (a fixture whose own comment read "bench-tagged; slotting is re-derived") passes
untouched under two passes, because its bench player legitimately fills an empty slot while
Harrison — benched on a FULL roster — correctly stays put.

**VERIFY**: battery **2701/2701, 0 page errors** (+26, section AI14: the button, no-draft /
empty-draft / finalized-week refusals each proving nothing was written, the confirm's counts and
custom-pick warning, Cancel, then a real import checked key-by-key — ESPN ids, `dst_<team>` for a
defense, draft-order slotting — plus a team that did NOT draft left untouched, and the
hidden-AND-gated non-commissioner path). Backup: session scratchpad
`gffl_backup/rosters_before_2025reset.json`.
**KNOWN**: the reset writes week 1 only, which is the only week that exists right now (no
later-week roster docs — checked); and a `?fam=` test league would read that same league's own
draft room, which is correct by construction.

## 🏈 GFFL — THE IR RULE: half of it did not exist (2026-08-15)

User: *"can you confirm that our IR position is working? you should only be able to put a player
on IR if they are designated as Out, IR, our doubtful, and if a player becomes healthy you can't
add players to your roster until you remove the now healthy player from your IR slot."*
**Half one worked. Half two was entirely absent** — grep found ZERO IR references in `faAdd`,
`addClaim`, `processWaivers` or `executeTrade`, and the pre-fix suite run says it in the old
code's own words: the free-agent add returned `{ok:true}`, the claim returned `{ok:true}`, and
the waiver claim **won**, all with a healthy man parked on IR. Files:
`assets/league/lg-{core,data,ui}.js` + `tools/_verify-gffl.cjs` (2701 → **2726**).

**HALF ONE — eligibility, which was already right and is now a RULE rather than an affordance.**
`LG.irEligible` is Out/IR/Doubtful **plus PUP/NFI/SUS** — a superset of the three the family
named, which is correct (a PUP player is not available either) and worth knowing. The locker
gated it in the two places a person can reach — the "→ IR" button isn't rendered for a healthy
man, and he isn't offered in the IR slot's candidate list — but **`doMove` itself did not check**,
so it was a hidden button, not a rule. It refuses now, with the reason.

**HALF TWO — `LG.illegalIR(roster)`, and why the gate cannot live at the moment of the move.**
An IR spot is EXTRA capacity (3 on top of 18), so a healthy man parked there is a 19th roster
spot nobody else in the league can use. The eligibility gate on the way IN can never catch this
by itself, because he is put there *legitimately* and then GETS BETTER — nothing about the roster
changes at that moment. So every ACQUISITION is blocked until it is resolved, which forces the
honest choice: bench him (costing a real roster spot) or drop him.
- Blocked in **`faAdd`**, **`addClaim`** (submit) and **`executeTrade`** (a trade is an
  acquisition for both sides, so both rosters are judged) — each returning `ir-illegal` and the
  offending NAMES, so the refusal is one tap from a fix rather than a hunt.
- **AND AGAIN in `processWaivers`**, because a man ruled out on Tuesday can be cleared on
  Wednesday morning: checking only at submit would let a legal claim become an illegal
  acquisition while it sat in the queue. The claim LOSES with a reason rather than erroring —
  it is one bid among many and the run must still resolve everyone else. Ordered AFTER
  `drop-gone`/`insufficient-faab`, which is what the suite's own staging tripped over.
- **`D.injuryFor(key, fallback)`** is the new seam: a roster row's stored `injury` is a snapshot
  from whenever the player was imported, so it goes stale exactly when this rule turns on. The
  live poll row is the truth, the stored value the fallback, and `LG.injuryOf` reads through it
  so the RULE and the LOCKER can never disagree about whether a man is hurt.
- **The owner is told on their own team, before they go shopping.** `irWarnHtml` names the player
  on My Team (where the fix is) and on Moves (where the block bites); a clean roster renders
  nothing at all. Also fixed in passing: the claim handler **threw away `addClaim`'s return
  value** and toasted "Claim submitted" whatever came back, so a refused claim looked accepted
  and simply never appeared in My pending.

**VERIFY**: **2726/2726, 0 page errors**. Pre-fix, with only the three app files reverted:
**2716 / 10, every failure inside the new section AI15** — so all 2701 pre-existing checks pass
in BOTH worlds and **no restaging was required**. Rule one's checks pass on both sides, which is
what confirms that half was genuinely already working. Section (g) is the anti-vacuity half: a
CLEAN roster shows no warning and an ordinary add still goes through, so the section cannot pass
by blocking everything.
**TWO STAGING BUGS OF MY OWN, both worth keeping.** (1) The IR player's key was `111333`, which
the fixture's `INJURY_FIX` quietly maps to **PUP** — IR-eligible, so he was legally stashed and
the rule correctly said nothing; worse, the locker check still "passed" because it ran before the
injury feed landed. A test whose subject has a designation supplied by the harness is testing the
harness's timing. The key is now one the engine has never heard of, so the fixture controls
"healthy" outright. (2) The late-stash claim used `dropKey: null`, so `drop-gone` refused it
before the IR gate ever ran — it passed for the wrong reason. And the Moves assertion missed a
warning that was plainly on screen because the template literal wraps across source lines and
puts its own newline into `textContent` — **the whitespace-normalisation gotcha already recorded
in this file, walked into anyway.**
**KNOWN**: `applyImportedRosters` still trusts a source's `lineupSlot === "IR"` without an
eligibility check — deliberate, since ESPN's own IR designation is the authority at import time
and the roster is judged the moment anyone tries to act on it.

## 🏈 GFFL — DROPPING ONCE THE BALL IS IN THE AIR (2026-08-15)

User: *"lets make it so you can drop players from your bench even if their game has started, but
you still cant drop players you started until waivers clear."* Files:
`assets/league/lg-{core,data,ui}.js` + `tools/_verify-gffl.cjs` (2726 → **2746**).
Starting point: the drop picker listed the WHOLE roster with no filtering at all, so the bench
half was already true — and a started STARTER could be dropped mid-game, which is the abuse.

**THE RULE**: `LG.dropBlocked(p)` = p is in a STARTING slot (not BENCH, not IR) **and** his game
has kicked off. Bench and IR are droppable at any time — they are not earning anything this
week, and freezing them only stops an owner reacting to news.

**"UNTIL WAIVERS CLEAR" NEEDED NO SECOND CLOCK — it falls out of the league's own rhythm**, and
that is the part worth keeping. Week N runs Tue 05:00 → Mon, and **week N's waiver deadline is
the Wednesday at its START, before that week's games**. So: a man started on Sunday is frozen
for the rest of week N, which is exactly when free agency is open and adds are instant — the
moment the block has to bite. When the week rolls on Tuesday he becomes a week N+1 player whose
N+1 game has not kicked off, so he unfreezes — but adds are back on the blind-bid queue until
Wednesday 08:00, so the earliest any drop of him can TAKE EFFECT is the waiver run itself.

**⭐ THE MISTAKE WORTH RECORDING: I first gated `processWaivers` too, and it contradicts the
rule.** A claim's drop lands AT the waiver run, which IS "once waivers clear" — so dropping a
started player BY CLAIM is the permitted route, not the abuse. Gating it also lost a claim
whenever a commissioner hit "Process now" on a Sunday, punishing an owner for someone else's
timing. **Nine pre-existing waiver checks failed and that is what surfaced it** — the collateral
damage was the signal, not a set of tests to restage. The gate lives on the INSTANT add alone
(`LG.faAdd`), and the picker only disables a row when `past` (instant-add mode) is true; before
the deadline the same card submits a claim and blocks nothing. Suite (c) now asserts the
inverse — a claim dropping a started player WINS — so the correction is pinned.
**ONE DEFINITION OF "UNDERWAY"**: `D.gameStarted(team)` lifted out of lg-ui's `playerLocked`
(which now delegates to it), so lg-core's rule and the locker's lineup locks cannot disagree.
An untracked team reads "not started" — the safe answer, unfreezing rather than freezing a
roster on missing data. Refusal is `drop-started`, carrying the player's NAME; the picker shows
him disabled with "Started — drop after waivers" rather than hiding him.

**VERIFY**: **2746/2746, 0 page errors**. Pre-fix, only the three app files reverted:
**2737 / 9, every failure in the new section AI16** — all 2726 pre-existing checks pass in BOTH
worlds, no restaging. The old code says it in its own words: `faAdd` returned `{ok:true}` and
the roster came back without P. Passer. The section tests all four combinations of
{started, benched} × {underway, not}, and the BENCH cases are the anti-vacuity half — a rule
that froze everything would satisfy a block-only test and would be the opposite of what was
asked for.
**KNOWN**: trades still exclude every locked player, bench included (`TRADE_POS … &&
!playerLocked(p)`, unchanged) — the ask was about drops, so that is left alone; say the word if
the bench should be tradeable mid-game too.

## 🏈 GFFL — A DEDICATED DROP BUTTON, AND THE OPEN SPOT IT CREATES (2026-08-15)

User: *"the swap button wont let me drop a player that has started, we need a dedicated drop
button."* Files: `assets/league/lg-{core,ui}.js` + `league.html` +
`tools/_verify-gffl.cjs` (2746 → **2773**). Both halves of the report were right: Swap is a
LINEUP move and is correctly greyed at kickoff, and there was **no drop affordance anywhere**
except as the drop-side of an add on Moves.

**IT HAD TO SHIP AS TWO CHANGES, and the second one is why.** Every add SPLICED — one player
out for the one coming in — so the roster could never be short and `faAdd` demanded a drop
unconditionally. A standalone drop leaves an open spot, so a bare Drop button would have cost
the owner a player on every subsequent add. **The live league is already under cap** (21 slots,
teams carrying 19-20 after the 2025 reset), so this was a real limitation before the button
existed, not a hypothetical one. So: `LG.rosterCap()`/`LG.rosterRoom()` derived from the slot
script, `faAdd(…, dropKey = null)` appends when there is room and returns `roster-full` when
there isn't, `processWaivers` honours a drop-less claim (re-checked at run time — an earlier
claim of theirs in the SAME run may have taken the spot), and the claim card grows a **"No drop
needed — N open spots"** row. That row reverses a documented decision (the old comment said a
no-drop row would need roster-cap logic that "doesn't exist") — the premise changed.
- `LG.dropPlayer(week, teamId, key)` is the standalone drop: fresh read, `LG.dropBlocked`, one
  `drop` tx. Confirmed in the UI, because it is irreversible — the man goes to free agency.
- The waiver tx sentence can now end after the add ("…into an open spot.") instead of trailing
  "dropped ." with nobody's name in it.

**THE ROW HAD NO ROOM FOR A THIRD BUTTON — measured, not guessed.** At 390px the locker row is
332px: chip 52 + name + Swap 52 + Drop 52 + gaps, and a 52px "Drop" drove the name column to
**120px**, under the **≥140px** floor AD8 measured and this app already paid to reach (two
separate checks enforce it). On a phone the button keeps its tap height but shows **✕**; the
word "Drop" stays in the DOM for a screen reader and the title/aria-label name the player. Name
back to exactly 140. Desktop has room and keeps the word.

**VERIFY**: **2773/2773, 0 page errors**. Pre-fix, app files reverted: **2757 / 16**. New
section AI17: the button exists on every row · ⭐ the report itself — a BENCH player whose game
has started has Swap greyed and Drop LIVE, while a started player has both greyed with the
reason · a real click through the confirm removes him and logs the tx · the core refuses a
started player driven directly · the no-drop add grows the roster by one and drops nobody · a
FULL roster still refuses it · the claim card offers the no-drop row only when there is room and
arming it enables submit.
**THREE STAGING COLLISIONS, all mine, each restaged with its reason in the file**: two existing
counts (`nobody hidden`, `every drop-candidate row carries a face box`) now had the no-drop row
as a sibling — excluded via `:not(.rcnodrop)`, since it is a choice and not a roster line; and
the claim card's question softens to "Drop anyone?" when a drop is optional, so the copy check
accepts either wording. Plus one bug of my own the suite caught by its page-error check: the
handler used `teamId`, but the locker's wiring function is `wireLockerLineup(tid, ros)` — the
drop threw and silently did nothing.
**KNOWN**: the ✕ is 32px wide on a phone (44px tall) — narrower than the 44px ideal, and the
deliberate trade against the name-column floor, which is the contract with a test behind it.
---

## 🏈 GFFL — PLAYER ON FIRE: the Legendary row literally burns (2026-08-17)

A pure rendering pass on top of the loot ladder above — Legendary (`data-loot="4"`) rows gain
a glow bed, flame tongues along the bottom edge, and rising embers, all behind the row's own
text. Files: `league.html` + `assets/league/lg-ui.js` + `tools/_verify-gffl.cjs` (2775 →
**2785**).

**THE LAYERING PROBLEM WAS THE WHOLE DESIGN.** `box-shadow` is spoken for by the mobile
possession edge (`.pcellgrid.hasball.left/right`, inset gold) and `outline` by the Legendary
rim right above this entry — an animation on either would silently win over an existing one on
exactly the rows most likely to carry both. Fire lives on `::before` (glow bed) + `::after`
(flame tongues) + one real child, `.fembers` (embers), appended by `halfCell()` only when
`heat === 4`. Every layer is `position:absolute` + `z-index:-1`, and the row itself gets
`isolation:isolate` so that negative z-index can't leak past `.pcellgrid` to the card behind
it — the fire is guaranteed to paint behind the row's flex-item content, not merely likely to.
`overflow:hidden` clips the flame/ember layers at the row edge; safe on this element
specifically because both possession shadows are inset, the headshot ring is inset, and —the
one that would have mattered — `outline` is painted outside the element's own clipping box, so
the Legendary rim is untouched by it.

**PERF: every animation touches ONLY `transform` and/or `opacity`.** The "exactly even height
for every player" row rule survives because nothing here can trigger layout — the suite walks
the actual CSSOM `@keyframes` declarations and fails on any other property, not just an eyeball
check.

**THE SEAMLESS-LOOP INVARIANT**: every tongue layer's tile period must divide the per-loop
drift distance exactly, or the loop point jumps. The drift is `3 x --gffl-fp` and the three
layers tile at `fp/2` (yellow core), `fp` (orange), and `1.5fp` (deep-orange backdrop) — 6, 3
and 2 whole tiles per loop. `--gffl-fp` is one CSS custom property driving every tile size AND
the drift distance, so they cannot drift apart from each other, and it gets a smaller value
(and a faster `animation-duration`) under `max-width:1023px` — the same tongue width stretched
across a wider desktop row read as a slow, mushy wave rather than fire, and px/s is what the
eye reads (both judged from the plates, not guessed).

**THE FIRST CUT HAD TWO LAYERS (orange + yellow at exactly half its period, drift = 1fp) and
the review plates killed it**: one 26px silhouette repeated 20+ times across a 520px desktop
row reads as a uniform awning fringe, not fire. Mixed periods that beat against each other are
what make it read as flame — the combined silhouette now only repeats every `3fp` = 78px. The
scaleY flicker rides intermediate keyframes of the same animation (one element gets one
transform timeline); `translateX` stays linear across those frames by advancing it
`3fp x` the frame's own percentage.

**VERIFY**: **2785/2785, 0 page errors**. Pre-fix, app files reverted to HEAD (tools kept):
**2776 / 9** — every new failure is one of this entry's own checks, and nothing pre-existing
broke. New checks, extending AD5d's `?demo=loot` fixture: the three `@keyframes` exist and
touch only transform/opacity · `position:relative` + `overflow:hidden` + `isolation:isolate`
on the tier-4 row · the flame strip is a thin band (≤16px), not a wash · `pointer-events:none`
+ `z-index:-1` on all three layers · `.fembers` exists on tier 4 and nowhere else · the glow
gradient's stops parsed from the CSSOM, hand-interpolated at 50% of row height and composited
over the card, still clear 4.5:1 for the player name · `prefers-reduced-motion: reduce` turns
off all three animations.
**ONE STAGING BUG OF MY OWN, caught by my own new check**: the glow gradient's first stop was
written as bare `0` rather than `0%` — functionally identical CSS, but it broke the stop-parsing
regex in the CSSOM-based contrast check (which requires every stop to carry a unit), silently
dropping the darkest stop and reading only 2 of 3. Restaged to `0%`.
**Plates** (scratchpad, not committed): a forced `data-loot="4"` + `.fembers` row with all three
animations pinned to a mid-cycle frame via negative `animation-delay` (headless keyframes
otherwise always render frame 0), cropped to the row + its neighbours and as a full matchup
card, at 390px and 1280px. The flame reads as flame at both sizes without touching the name or
score's legibility.
---

## 🔥 GFFL — THE FIRE IS DRAWN, NOT COMPUTED (2026-08-17, same day: "looks more like rolling lava")

The scallop-drift cut above shipped and the user killed it on sight: radial-gradient bumps
drifting SIDEWAYS are lava's grammar. Fire's grammar is vertical — tapered tongues, irregular
heights, licking UP, shaded red at the base through orange to a yellow-cream core. Round
gradient stops cannot draw a tapered tip, so the redesign stops computing the silhouette and
draws it: each layer is an inline-SVG strip (~1KB data URI) of bezier tongues carrying its own
base-to-tip vertical gradient.

**Four layers now, and the stacking is tree-order, which makes halfCell()'s markup order
LOAD-BEARING** (all four share z-index:-1; ::before, then children in DOM order, then ::after):

    ::before   red back tongues (#9e1c00→#e84c00, 20px strip) + the glow bed, slow lick
    .fflames   orange mid tongues (#d95400→#ffa03c, 15px), medium lick        } real children,
    .fembers   the rising embers, unchanged                                    } THIS order
    ::after    yellow-cream core tongues (#ff9d1e→#ffe89a, 10px), fastest lick

**Motion**: no horizontal drift at all any more. gfflLickA/B/C are scaleY licks + a small
skewX sway, transform-origin:bottom, at 2.3s/1.6s/1.15s with negative delays — the PHASE
DISAGREEMENT between layers is what reads as licking, not any one layer's motion. All still
transform/opacity only; the CSSOM walk in the suite is unchanged in what it forbids.

**Geometry restage (same-day, reason at the check)**: the layers are inset:0 full-height
elements now — scaleY from the bottom needs the element's own box — so the "thin band, not a
wash" assertion moved from element height to the drawn strip height in background-size, plus
a new depth-order assertion (back 20 > mid 15 > core 10, mobile 14/10/7). The seamless-drift
invariant died with the drift; tiling is static, each strip's edges meet at its trough height,
and the 64/52/44px tile widths keep the anti-awning-fringe lesson from the scallop cut.

The glow bed, its contrast arithmetic (the suite interpolates the gradient's own stops at 50%
row height and composites over the card), reduced-motion, and the embers all carried over
untouched.
---

## 🏈 GFFL — THE SEAM HUNT AND THE THREE-GUARD TRADE RULING (2026-08-17, pre-season battery)

**`tools/_gffl_seams.cjs` (120 checks) hunts INTERACTIONS, not mechanisms** — places where two
systems, or a system and the clock, could disagree about the truth: the kickoff-millisecond
boundary across every path, bye weeks, feed glitches ("in"→"pre"), every submit-vs-run waiver
seam, cron double-fire, DST, trade expiry, double finalize, ties, the `??`/`||` scoring traps,
non-contiguous team ids, week rollover. Built on `_gffl_race_kit.cjs`'s harness. The engine
passed all of it clean on first contact except what follows.

**THE RULING (user, same day): three guards trades never had.** `executeTrade` had no
roster-cap check ("no roster-size cap in v1", said its own comment), no startable-lineup
check, and no clock check. All three now live in ONE pure validator, `LG.tradeBlockers`
(reasons `over-cap` / `lineup-unfillable` / `player-started`), run three times: the Moves
composer and `LG.acceptTrade` for early UX refusal, and `LG.executeTrade` as the
AUTHORITATIVE gate on fresh rosters — rosters move between offer, accept, and the review
window closing, so only the last read counts. Refusal copy is composed in `tradeBlockLabel`
(lg-ui.js) and names the team or player; raw reason codes never reach the screen.

- **LINEUP is an exact bipartite matching** (`LG.canFillLineup`, augmenting paths), not a
  greedy pass — greedy can hand the only TE to FLEX and falsely refuse a legal trade, and a
  false refusal is as much a bug as a false pass; the suite carries a fixture for each
  direction. Judged as a TRANSITION (fillable before → unfillable after), so a roster that
  was already short a lineup isn't frozen by a guard its trade had nothing to do with.
- **CLOCK is deliberately STRICTER than `LG.dropBlocked`**: it blocks ANY traded player whose
  game is underway, bench and IR included — the shenanigan is trading for a player mid-game,
  and that's about the player, not his slot. Same `D.gameStarted` clock as drops, never a
  second one. The suite pins the contrast against dropBlocked's own verdict on the identical
  fixture, so the difference stays deliberate.
- Proof of bite: on the pre-ruling engine, exactly the 12 ruling checks fail, all 108
  pre-existing pass (120/0 after).

**Pinned, NOT fixed — the deferred findings, for whoever picks them up:**
- A trade executing concurrently with a waiver run can lose the trade's roster write — same
  no-CAS root cause the 2026-08-11 race work documented as "narrowed, not eliminated". The
  season sim catches its FAAB face intermittently (one purse-conservation cascade in five
  full-season runs, 2026-08-17). The fix is transport-level compare-and-swap; scheduled as
  its own effort, sim as proof harness.
- An exact PLAYOFF tie advances the HOME team (`bkResult` `hp >= ap`), while the regular
  season records a symmetric T — two interpretations of one score, commissioner-acknowledged,
  home-advances kept, not yet stated in the Rules view.
- The trade fail-safe's "roster changed" check is by PLAYER KEY only; a slot-only change
  does not cancel — correct-for-scope (incoming players re-slot to BENCH regardless), pinned.

Also from the hunt: `maybeAutoExecuteTrades` used `|| Infinity` where `executeTrade` uses
`?? Infinity` for the same deadline (unreachable mismatch, fixed, and the suite now asserts
the comparators MATCH by reading both sources); the season sim's exact-16 roster assertion
was stale since add-without-drop and drowned its own signal under 82 spurious reds — restaged
to the band draft 16 ≤ n ≤ cap 19, reason at the check.
---

## 🏈 GFFL — COMPARE-AND-SWAP: THE LOST-UPDATE WINDOW CLOSES (2026-08-18, pre-season)

The last known money bug. Every write in this app was read-fresh, compute, write — and between
the read and the write another device could land its own. The second writer's whole-document
PATCH then put the first one back. Narrowed four times (getFresh before every write, FAAB as a
delta rather than an absolute, the idempotency guard moved in front of the writes, a per-week
single-flight latch) and never closed, because closing it needs the transport to be able to say
*only if it is still exactly what I read*. Proven twice: the seam suite's C4 (a trade and a
waiver run on one roster, one write erasing the other — pinned as a SEAM-FINDING for a day),
and the season sim's intermittent `faab.conservation` cascade, roughly one full-season run in
five. Files: `assets/league/lg-core.js` + the four fixtures + `tools/_gffl_seams.cjs`.

**THE PRECONDITION WAS THERE ALL ALONG.** `LG.saveTeam`'s own comment argued against an
increment TRANSFORM, and that argument still stands — a transform is a request shape the
transport, the codec, the local backend and the mirror would all have to learn, and the local
backend has no atomic primitive to build one with. But a *precondition* is neither. Firestore
returns an `updateTime` on every read and honours `currentDocument.updateTime` on every write;
this transport had been discarding that field since the day it was written. localStorage can
carry a version integer beside each doc. So both backends can express the same contract:

- **`getV(id) → {doc, v}`** — the same GET, plus the version. A doc that isn't there has
  `v: null`.
- **`setIf(id, data, v)`** — the same PATCH + `updateMask`, plus `currentDocument.updateTime=v`,
  or `currentDocument.exists=false` when `v` is null (create-only). A refused write comes back
  as `{conflict:true}`, never a throw: the answer to contention is to re-read, not to give up.
  Every other non-ok status still throws — a 500 is not contention.
- **`LG.db.update(id, mutate)`** — the ONE read-modify-write primitive. Up to six attempts of
  getV → mutate → setIf, with jittered backoff; `mutate` returning `null` ABORTS with nothing
  written and hands back the fresh doc it refused against; exhaustion throws
  `cas-contention:<id>` rather than silently letting the last writer win.
- **`mutate` MUST BE PURE AND REENTRANT — it can run six times.** Written loudly at the
  definition, because that is the one way to misuse this: a `logTx`, a push or a toast inside a
  mutate fires once per attempt. Every adopter fires its side effects after a successful loop
  and recomputes its refusal from the returned doc rather than smuggling it out of the mutate.

**THE ADOPTERS** — seven paths, each with the modify now running against the loop's own fresh
document:

1. `LG.saveTeam` (the FAAB deduction) — `opts.from(cur)` is unchanged and still gets the fresh
   doc; it now gets the fresh doc of the attempt that actually commits. Offline still falls
   through to a plain write, because CAS needs a backend — but only when the READ failed; a
   write failure, contention included, is fatal exactly as it always was.
2. `LG.dropPlayer` — the drop as a delta; both refusals (`drop-not-found`, `drop-started`)
   re-judged inside the loop and re-derived from the doc it returns.
3. `LG.faAdd` — same, plus the IR-stash and cap gates.
4. `processWaivers` — every roster write is now the run's own list of `{dropKey, incoming}` ops
   re-applied to the store's current array, idempotent in both halves. **And the commit point
   moved in front of the money**: the week's processing record is written under a CAS that
   aborts if it already says processed, so of two devices exactly one gets past it. The roster
   deltas stay above it (idempotent, so both devices applying them costs nothing, and a run that
   dies before committing can simply be re-run); the FAAB deductions, the append-only tx log and
   the push moved below it, because none of those are idempotent and two devices deducting one
   winning bid is the family paying twice.
5. `LG.acceptTrade` — offered → accepted, mutate aborting unless still offered and still
   addressed to this team. A cancel that landed in between now wins instead of being overwritten.
6. `LG.executeTrade` — the swap as two idempotent deltas, and accepted → executed as a real
   commit rather than a check-then-act, so exactly one device logs the transaction and sends the
   pushes. The three cancellations (`roster-changed`, the three trade guards, `ir-illegal`) each
   CAS too — a cancellation may only move a trade that is still accepted, or a device could
   write `cancelled` over an `executed` whose swap has physically happened on both rosters.
7. `LG.finalizeWeek` — the weekly doc is now CREATE-ONLY (`exists=false`). Write-once stopped
   being a convention the code re-checks and became something the server enforces.

Every refusal reason and every returned shape is byte-for-byte what it was; the suites pin them
and none needed restaging.

**THE FAKES LEARNED TO REFUSE, and without that everything above is vacuous green.** All four
node-side fixtures — `_gffl_race_kit.cjs`, `_gffl_season_sim.cjs`, `_verify-gffl.cjs`'s REST
fixture (the seams suite rides the race kit) — now version every doc, stamp `updateTime` on
every read, and answer a stale PATCH with a real 409 `FAILED_PRECONDITION` body. The version is
a MONOTONIC COUNTER rendered as a timestamp string, not a clock: a wall-clock stamp cannot
distinguish two writes inside one millisecond, which is the only case these harnesses exist to
produce. `_verify-gffl.cjs`'s in-page `_installFakeCloud` fakes speak only get/set/del/list, so
`_installFakeCloud` wraps them in a **real** page-local CAS shim (compare and version bump in
one synchronous run, no await between) rather than a permissive stub — those stores are
page-local by construction, and every SHARED fixture does it on the wire instead.

**PROOF OF BITE, from the fixture side.** Flip the race kit's `ignorePreconditions` on so the
store accepts every write, exactly as it did before this work: **119/2** — the restaged C4 and
the new C6 fail, every one of the other 119 checks still passes. Restore it: **121/0**. That
split is the evidence; the passing run alone is not.

- **C4 restaged** from "SEAM-FINDING pinned: a lost update" to the arithmetic: ten starting
  players − two leaving (p107 traded, p110 dropped) + two arriving = **ten**, the eight men
  neither operation touched included. A nine-key roster is one op's write erased.
- **The collision in C4 is now STAGED, and that is a strengthening.** Pre-CAS each operation
  carried seconds of resolution work between its fresh read and its write, so the two windows
  overlapped on their own. `LG.db.update` reads immediately before it writes, and a window that
  small stopped overlapping by itself — which would have quietly turned the check into a test of
  nothing. The first roster PATCH out of the page is now held 600ms while the other operation
  completes its whole read-modify-write, so the released write provably carries a dead base.
- **C6 is new**: two FAAB deductions genuinely interleaved on ONE purse, device A's PATCH parked
  on a gate across the whole of device B's write. $100 − $30 − $20 = **$50**, with the store
  recording the refusal that made it so. $70 would be A erasing B; $80 the reverse.

**Counts**: seams **121/0** (120 + C6; C4's restage kept its one check) · `_verify-gffl.cjs`
**2785/0**, clean first run · the three race repros green (clobber 9/0, doublespend 12/0,
dbltap 9/0) · season sim **three consecutive clean 17-week runs** (0 failures across 14,942 /
15,400 / 15,632 checks; six post-fix runs in all, five of them clean).
`faab.conservation` — the check this whole effort exists to satisfy — **did not fire once in
six full-season runs**, against roughly one cascade in five before it.

**WHAT IS DELIBERATELY NOT PROTECTED, and why that is the honest scope.** This is per-document
compare-and-swap. It cannot give CROSS-document atomicity, because the transport has no
multi-document transaction and the local backend has nothing to build one from — Firestore's
`:commit` with a real transaction is a different request shape, a second codec and a lock the
localStorage backend cannot honour, which is the same argument that ruled out increment
transforms and it is still correct. So three things stay as they were:

- **`faAdd`'s "is he already owned somewhere else"** reads eight other roster documents. Only
  this team's own document is under the precondition; the ownership scan is still a fresh read
  followed by an act.
- **The two roster writes in `executeTrade`** are two documents. Neither can be lost, but a
  process that dies between them still leaves a half-swap — which is why the mutates deliberately
  do NOT cancel from inside: the guards above are the authoritative gate, and a refusal raised
  between the first write and the second would manufacture a half-swap this code cannot produce
  today.
- **`processWaivers` spans rosters, purses, the tx log and the record.** Exactly one device now
  holds the week, but the four writes it then makes are four writes.

**FOUND, NOT FIXED — the same bug one document over.** `LG.advanceBracket` reads the bracket
through the CACHE, fills what it can, and writes the WHOLE document: a device that resolves r2
from a cached copy whose r3 was still null writes those nulls back over another device's r3
result. The season sim's `writeOnce.bracket` catches it — champ/third home and away reverting
from a real team id to null at w17 — and it reproduces **2 of 2 runs on unmodified HEAD**, so it
is pre-existing and not a consequence of this work (1 of 6 post-fix). The primitive to fix it now
exists; the work is restructuring `advanceBracket` so its side effects (the champion's trophy
write, the `loadTeams` refresh) sit outside a mutate that can run six times. Left for its own
pass rather than improvised into this one.

Also open, unattributed: one transient `roster.dupAcrossTeams` in six post-fix runs (0 in 2
baseline runs) — a player on two teams for three sweeps of one week, self-healed by the next
phase. Not enough occurrences to place; `persistLineup` (lg-ui) is the one remaining whole-array
roster write, though it already applies only slot changes onto a fresh read, so it cannot
resurrect a traded-away player. The sim stays the harness for it.
---

## ffdraft.html — audio, the pick reveal, and the ADP unit bug (2026-08-18)

- **Audio is committed files over synth fallbacks.** `assets/audio/draft/` (ElevenLabs; job
  list in `tools/_gen-draft-audio.mjs`) played through the page's `DAudio` module — every
  trigger keeps its old WebAudio beep as fallback, so missing files degrade to beeps, never
  silence. Music (`ffd_music`, its own header toggle next to SOUND) plays a lobby bed
  pre-draft and a live bed during, at 0.3 gain, and TV mode is deliberately silent (no
  toggle on a wall board = a trap). **Generation pipeline for sandboxed agents**:
  `audiogen-background.mjs` (Netlify, 15-min background allowance — sync functions time out
  on music) → mp3s land base64-chunked in Firestore `ffdraft_fam2jan2g/audio_*` → `--collect`
  assembles and cleans up; `--fire` runs from a GitHub Actions runner
  (`.github/workflows/draft-audio.yml`) because the sandbox can reach neither the site nor
  ElevenLabs, but CAN reach Firestore. **ELEVENLABS_API_KEY must exist in Netlify env** —
  it lives only in `tools/.env` on a human machine until someone adds it (first fire failed
  exactly there, 2026-08-18).
- **The pick reveal is `pickReveal`, NOT `spotlight`** — TV mode's `#tvSpot` already owns
  `function spotlight(label, p)` and the duplicate declaration silently won the hoist; the
  collision shipped a TypeError before the suite caught it. Reveal = full-screen card +
  confetti on every non-TV device via `watchPicks` (+1 jumps only — keeper materialization
  arrives as one +N jump and gets one note, no reveal), then FLIP-shrinks to its board cell.
  Dedup key is `slotKey:pid`, not slotKey — an undone slot re-picked with someone else is a
  new announcement.
- **ESPN ADP is a 10-team number and every raw comparison against it was structurally
  wrong.** Live-measured (sports-diag prints the drift): ADP ≈ 1.25 × rank through the
  middle rounds — ESPN lobbies draft 10 a round to our 8 — and ADP hard-caps at ~171. The
  old `overall − adp ≥ 10` badges called half of a best-available mock a REACH. Everything
  ADP-flavored now converts through `adpRoundOf()` (`ceil(adp/10)`, clamped to the room's
  rounds) and compares ROUNDS, each draft in its own shape, both sides clamped; badges need
  a 2+ round disconnect. `keeperAdpBadge` divided by OUR team count (8) for the same reason
  and overstated every keeper's market round — same conversion now. The recap grades in
  round units too. Fixture ADPs all sit under ~30 where /8 and /10 agree — which is why the
  suite never caught it; the divergent region is pinned via hook checks at the live shape
  (overall 60 / adp 73 = no badge).

## ffdraft.html — Billy in the Booth (2026-08-18)

The robo commentator: Grok 4.5 through `farmgpt.mjs` mode `ffcommentary` (same xai routing +
Sonnet fallback as the fantasy analyst; usage bucket "w"). Personality and guardrails live in
`FFBOOTH_SYSTEM` — good-natured family smack talk, 45-word cap, react only to facts in the
JSON, no emoji. The COMMISSIONER'S device is the only generator (same posture as mock bots):
triggers are draft-start, every 3rd pick, a STEAL/REACH badge (shortened cooldown), and
draft-done, all behind a 75s cooldown. Lines land in their own doc (`booth_<season>` — NOT the
chat, which belongs to the humans; not the draft doc, which belongs to the picks) and every
screen renders the newest into `#boothBar`, a fixed lower-third top-middle (25s auto-hide; TV
shows it bigger). A dead upstream = a silently quiet booth, asserted in the suite along with
the exactly-one-line-per-3-picks cadence. The suite's farmgpt fake answers with the real shape
(plain text on 200) and has a `boothFake.down` refusal knob.
---

## 🏈 GFFL — THE COMMISSIONER'S RULING: the zero floor + mathematical finality (2026-08-20)

Two locked-together halves, both from the commissioner directly. Files:
`assets/league/lg-{core,data,ui}.js` + `league.html` + `tools/_verify-gffl.cjs` (2785 →
**2836**, new section AZ). No commits, no push.

**RULE 1 — THE ZERO FLOOR.** No player score may go below zero, ever. `LG.floorPts(n)`
(`n==null?null:Math.max(0,n)`, lg-core.js) is the ONE clamp, applied as a RULE-LAYER step, not a
formula change — the stats→points map (`D.score`/STAT_MAP) computes whatever the real formula
says, negative included (a QB with 2 INT and no yards genuinely reads -4.0 there), and stays
ESPN-faithful and untouched. `tools/_gffl_rules_reconcile.mjs` keeps proving that raw number
against ESPN's real 2025 season and reads through none of the sites below — it queries ESPN's
own boxscores directly and never calls into the client engine at all.

The floor landed at: **`D.livePts`'s return** (lg-data.js, the score column's own funnel);
**`fzPts`**, finalizeWeek's live-path default `ptsOf` (lg-core.js); **finalizeWeek's
archived-stats backfill `ptsOf`** (lg-core.js, defence in depth); **`weekStatsMap`'s per-player
value** (lg-data.js — one source that feeds the backfill map, the player stats card's game log,
and the players table's FPTS/AVG/LAST columns); and **`liveTotal`** in lg-ui.js, which used to
read `row.pts` straight off `D.S.players` — the one matchup-total summation that bypassed both
the floor and the `?demo` override every other score cell already went through, now routed
through `D.livePts` instead. Raw survives deliberately at `row.pts` itself (mergeRow's own
storage — the funnel is at the READ, not the write) and at `applySide`'s `dPts` (the delta-events
feed narrates stat changes, not totals).

**RULE 2 — MATHEMATICAL FINALITY.** `LG.matchupDecided(sideA, sideB)` (pure, lg-core.js) — each
side is `[{pts, done}]` per STARTING slot (BENCH/IR excluded). `LG.bankedOf(side)` sums FLOORED
points over done players (a guaranteed MINIMUM — a not-done player can only ever add, never
subtract, which is what makes the floor load-bearing here); `LG.totalOf(side)` sums floored
points over everyone. Decided for A ⟺ every B player done AND `bankedOf(A) > totalOf(B)`; both
sides done → winner by total, exact tie → decided with no winner; the TRAILING side having ANY
not-done player refuses decision no matter the gap, because a live player has no upside bound.
`D.gameDone(team)` (lg-data.js) is the one new seam beside `D.gameStarted` — "post", or no
tracked game at all (a bye, which contributes its floored zero and can never add to it, so it
counts as done). Reader side in lg-ui.js: `matchupSides`/`matchupDecidedFor` build the slot
arrays and wire a small inline SVG gold star (house law: no emoji in app chrome) into the
matchup hero and the matchup-list card, absolutely positioned so it costs the row no height.

**STANDINGS ARE PROVISIONAL DISPLAY ONLY.** `LG.loadStandings()` itself is untouched — it only
ever reads finalized `weekly` docs, and `finalizeWeek` stays the one write-once record; stat
corrections still land Tuesdays via the archived-stats backfill exactly as before this ruling.
`renderLeague`'s own overlay counts a regular-season week's DECIDED-but-unfinalized matchups as
W/L/PF/PA on a CLONE of the base standings the moment the arithmetic says so — the permanent
record never sees this, and neither does any other reader of `UI._standings` (waiver priority,
playoff odds). Rows carrying a provisional result are marked with the table's own existing
`mut`-idiom asterisk + a footnote, not new chrome.

**`?demo=clinch`** extends the `?demo=loot` plumbing: `D.demo` gains a `done` Map (per-player,
alongside the existing `pts`/`proj`), armed by `D.demoArmClinch` — the trailer's real starters
forced all-post at a fixed total, the leader forced banked above it on every starter but one,
left live — called from `ensureClinchDemo` (lg-ui.js), a no-op unless the URL param is set, URL
only, never persisted. `LG.finalizeWeek`'s existing `demoActive()` guard (kind-agnostic already)
covers it for free.

### THE DEMO-COHERENCE LESSON (same day, coordinator review, caught on the review plate)

**A demo that forks truth per consumer contradicts the feature it demos.** The first cut armed
`D.demo.done` and had `matchupSides` (the RULE 2 MATH) read it correctly — but four DISPLAY
surfaces still read `D.S.games` raw: the matchup row's status subtitle (`gameLineHtml`), the "N
to play · N live" strips (`D.remaining`'s `rem.left`/`rem.playing`, which also feed the hero's
Live/Final badge), `gameStateText` (the swap/drop card rows), and `playerCardHtml`'s state line.
The review plate caught it directly: `gffl_democlinch_1280.png` showed the TRAILER still
ticking "Q2 5:00" with a "2 to play · 1 live" strip — under a gold star claiming the whole
matchup decided. That is a state the theorem can never actually produce (a trailer with anyone
left to play is never decided), so the demo was showing the family a live contradiction of the
very rule it exists to demonstrate.

**Fixed the single-seam way.** `D.demoGameView(key)` (lg-data.js, beside `D.gameDone`) is the
ONE seam every one of those five consumers (the four display surfaces plus `D.remaining`, and
`matchupSides` itself was refactored onto it too, so there is exactly one place that knows about
`D.demo.done` rather than two independently-written checks that could drift apart) now reads a
player's "game" through, instead of `D.S.games` directly. It returns a game-SHAPED stand-in
(`{state:"post"}` for done, `{state:"in",period:2,clock:"5:00"}` for still-live — a FIXED clock,
never wall-clock-derived, so a repaint mid-demo can't flicker the display while nothing about
the row has genuinely changed) rather than a pre-formatted label. That shape choice is what kept
every existing caller's OWN formatting untouched for the byte-identical no-demo path: the three
real callers already disagreed on how to render the same state (`playerCardHtml` prepends
"Live — ", `gameLineHtml` wraps the clock in a `.gclock` span, `gameStateText` renders it bare)
— unifying those into one pre-formatted label string would have changed real (non-demo) output
on at least two of the three surfaces, which the coordinator's own requirement forbade. Handing
back a `g`-shaped object instead of a label meant each caller's pre-existing `g.state`/
`g.period`/`g.clock` branching just runs unmodified against a possibly-synthetic object; a key
with no demo entry gets `null`, so every fallback is the exact pre-existing `D.S.games` read.

**New standing regression guard**: section AZ's demo-coherence group renders `?demo=clinch`,
then re-derives `{pts, done}` for every STARTER SLOT straight from the RENDERED DOM (each row's
own `.pts`/`.gline` text, not `D.demo`'s internals) and calls `LG.matchupDecided` on THAT —
proving the star is never showing a claim the rows themselves don't back. Also pins: every real
trailer row's status text reads exactly "Final" (whitespace-normalised); the trailer's own strip
reads "0 to play · 0 live"; the leader's reads "0 to play · 1 live" (8 Final + the one live
starter, on screen); the star sits on the leader only. This is the check that makes a forked
demo unshippable in general, not just this one bug.

**VERIFY**: `node tools/_verify-gffl.cjs` **2836/2836, 0 page errors** (a rare "Promise was
collected" Puppeteer flake surfaced twice while building this batch — both were REAL, at a
double `page.goto` re-navigation the demo block no longer does, see below — not the usual
documented rare flake; rerun-once did not fix either occurrence, the code fix did).
`node tools/_gffl_seams.cjs` **121/0, unrestaged**. `node tools/_gffl_season_sim.cjs`: 15,644
checks across 89 sweeps, 0 failures.

**TWO REAL INFRASTRUCTURE BUGS FOUND WHILE BUILDING THIS, both worth keeping**: (1)
`ensureClinchDemo` awaited inside `renderLeague`/`renderMatchup`'s always-executed synchronous
tail destabilized Puppeteer even on its cheap no-op path (the common case — no `?demo=` at all)
— fixed by moving the guard to a synchronous check at the call site so an ordinary render never
suspends there at all, plus an in-flight promise guard (the `D._weekStatsInFlight` pattern)
against re-entrant calls. (2) The demo suite block's own double `page.goto()` — boot plain, then
re-navigate the SAME page with `?demo=clinch` — was intermittently fatal to the Puppeteer target
even after (1); fixed by booting straight into the demo URL in one navigation instead of chasing
the flake itself.

**Proof of bite**: app files reverted to HEAD, new suite kept — 2790 pre-existing checks passed,
exactly the 5 floor-arithmetic checks failed against old code, then a clean crash on `D.gameDone
is not a function` (RULE 2 doesn't exist in old code at all).
---

## 🏈 GFFL — THE PLAYTEST-6 BATCH: eight items from the commissioner at the wheel (2026-08-22)

Files: `assets/league/lg-ui.js` + `league.html` + `netlify/functions/sports.mjs` +
`tools/_verify-gffl.cjs` + `tools/_verify-sports.cjs` + `tools/_sports_fixtures.cjs` (2836 →
2836 → **2866**, new section BA). No commits, no push.

**ITEM 1 — MATCHUP TAP OPENS A LIVE GAME.** `halfCell` (the matchup lineup/bench cell) already
reads a player's game (`g`) for its own clock/red-zone cues — a `data-live-eid` attribute now
rides the same read, set only when `g.state === "in"`. `wirePlayerCardTaps`' one click handler
branches on it (read at click time, not render time) — `UI.openNflGame(eid)` instead of
`UI.openPlayerCard(key)`. Every other `data-pk` source (league feed, locker, injury report, hot
picks, moves) never sets the attribute, so nothing else changed. **Ripple, not a bug**: the
default scoreboard fixture has been DAL@PHI live since section AY — the whole cast (P. Passer,
Q. Rival, R. Rusher, X. Wideout, K. Kicker) is live by default, so every pre-existing test that
tapped one of THEIR rows expecting the card broke on contact. Restaged: section Y's card-content
checks now open the card directly via `UI.openPlayerCard()` (they test the card, not the tap
routing — item 1 gets its own dedicated check); AJ3's overlay/Back-stack checks mark DAL@PHI
`post` before tapping (unrelated to the live-tap feature); AY2's duplicate-listener check now
stubs both `openPlayerCard` and `openNflGame` and asserts the total is 1, since which branch
fires is no longer the thing under test there.

**ITEM 2 — GAMECAST SCORES STAY WHITE UNTIL FINAL.** `losing` (the score-dimming predicate) was
`(live || done) && …` — a losing team dimmed the moment the game went live, before the outcome
meant anything. Now `done && …` only. No existing check had pinned the live-grey behaviour, so
nothing to restage.

**ITEM 3 — THE UPRIGHTS FACE THE RIGHT WAY.** The goalpost crossbar used to draw inside the
COUNTER-skewed local group (`x` ±20), which put it along the field's LENGTH — reads as facing
the wrong way. The commissioner: "they should be parallel with the end zone." Redrawn: the
crossbar is now a direct `<line>` in SLAB coordinates (x=0/x=1000, y spanning `FY.mid`±26) — a
fixed-x, varying-y segment that inherits the slab's own `skewX(-SKEW)` and is parallel to the
end line (the rect edge at that same x) BY CONSTRUCTION. The base post still drops from the
crossbar's centre and the two uprights still rise from its ends, each its own counter-skewed
(screen-true-vertical) group — the "stand upright" trick the ball pin already uses. RESTAGED:
AH3's `posts[].upright` check read `skewX(10)` off the `.nflpost` WRAPPER, which no longer
carries a transform at all (the crossbar is now a direct child, not counter-skewed itself) —
replaced with a geometry check: the crossbar's screen-space direction (via `getScreenCTM` on
its rendered endpoints) vs. the end line's own screen-space direction (read the same way off
the away end-zone rect), asserted parallel within 2°.

**ITEM 4 — LIVE GAMES FLOAT TO THE TOP OF SCORES.** `nflScoresHtml` now splits events into
`state==="in"` (a new "Live now" group, date-ordered, rendered first) and everything else (the
existing day-grouped, date-ordered layout, unchanged, rendered below it).

**ITEM 5 — "IN THIS GAME."** A new card between "This drive" and "Previous drives": every
GFFL-rostered player on either NFL team, AWAY then HOME, one row each — name · pos · owner tag
(`teamTag`) · slot marker (starter slot, or BENCH/IR muted) · points (`D.livePts`, or
`D.projFor` with the "proj" mut styling pre-game). Scans every team's roster (`UI._rosters`,
now loaded once by `renderNflGame` alongside the game itself — the matchup/locker convention),
matched to the game's teams via `D.slpTeam`. Sorted by points desc within each side; a side
with nobody rostered gets one muted "No GFFL players" line; the whole card is absent only when
BOTH sides are empty. Rows carry `data-pk`, so the existing card tap works (`wirePlayerCardTaps`
now runs on every `paintNflGame`, dataset-guarded).

**ITEM 6 — BOX-SCORE OWNER TAGS.** `sports.mjs` now carries `id: String(a?.athlete?.id || "")`
on every shaped box-score athlete (the ESPN athlete id — league player keys ARE these id
strings). Every box-score row gets an Owner cell: `teamTag(owner)` when the id resolves to a
rostered key, `FA` when it resolves to nobody, blank when ESPN sent no id at all (never a
name-matched guess). Fixtures (`nflSummaryFix` in `_verify-gffl.cjs`, `players()` in
`_sports_fixtures.cjs`) were made "as real as the real payload" — carrying ids for rostered
athletes, an id for an unrostered one (proves FA), and one athlete with NO id field at all
(proves the blank case, not a fabricated one).

**ITEM 7 — INJURY REPORT: HEALTHY IS GREEN NOW.** A transition TO Healthy renders
`<b class="injok">Healthy</b>`. The app's own good/positive token is `--green` (`.ok`,
`.delta.up`, standings W-L) — but `--green` on `--card` measures 3.84:1, below AA's 4.5:1, for
the small un-bold text this label needs. `--green-lt` (`#4e9972`) is `--green` run through the
SAME palMix-toward-white clamp loop `lg-core.js`'s own contrast law already uses on extracted
team colours, stepped until it clears AA (lands at 5.03:1) — the existing token, lightened by
the existing derivation, not an invented hex. RESTAGED: AR4 used to assert Healthy rendered
PLAIN (deliberately un-tinted, on the theory that colour meant "needs attention"); the
commissioner's ruling inverts that — a clean bill of health is exactly the kind of news a
colour should announce, just the GOOD colour. The check now asserts `.injok` (never `.injto`)
and measures its live on-screen contrast against the card at ≥ 4.5:1.

**ITEM 8 — THE RECONNECT SEAM, DIAGNOSED.** "My team auto-refreshes and reloads," reported live
while a swap sheet was open. Root cause: `mirrorRetryTick` (the offline→online seam) called
`UI.boot()` outright the moment the backend became reachable again — a FULL re-boot that
re-runs the gate/claim/setup routing and wipes whatever view was on screen from "Loading…",
closing any open locker sheet with no warning. This is the one seam the 2026-08-13 quiet-repaint
work never covered (that batch fixed the poll/db.onChange paths; boot itself was untouched).
Fix: `reconnectAfterOffline()` (a) reloads the same league data `boot()` reads
(rules/teams/auth/schedule) WITHOUT boot's gate/render routing — `LG.retryBackend()` already
clears `LG.db`'s doc cache on success, so this is a real re-read, not stale confirmed-offline
data; (b) repaints IN PLACE — matchup/league/scores through `paintLive()` (the same lightweight
path the live poll already uses; matchup also reloads rosters first, since a background
reconnect may BE a waiver landing), and the locker only when no interaction is in progress
(`lockerInteractionBusy()` — the roster card open, or a logo upload mid-flight via the new
`UI._lockerUploadBusy` flag) — otherwise the repaint is deferred (`UI._lockerRepaintPending`)
and drained (`drainLockerRepaint()`) the moment the interaction closes, from both
`UI.closeRosterCard()` and the upload's own `finally`; (c) preserves `window.scrollY` across
any repaint it makes; (d) shows one quiet "Back online" toast. Every existing mirror/offline
test stayed green with no restaging — `mirrorRetryTick`'s own contract (`LG.mirrorOffline`,
`UI._mirrorTimerOn()`) never changed, only what it hands off to on success.

**Cheap insurance, the same item**: iOS can drop a backgrounded PWA's page and reload it
outright — a fresh page load the reconnect seam above has no way to see, since nothing about it
is a "the backend became reachable" event. `{view, lockerTeamId, scrollY}` now persists to
`sessionStorage` (not `localStorage` — a genuinely new tab/session starts clean) on scroll
(debounced) and on every navigation (`UI.go`); `armScrollRestoreOnce()`, called once from
`UI.boot()`, restores `scrollY` after the FIRST render of that SAME view settles (a
`MutationObserver` on `#main` with a 250ms quiet window, so the restore lands on the full page,
not a "Loading…" placeholder) — a no-op unless the saved `view` (and `lockerTeamId`, for the
locker) matches where boot actually landed.

**VERIFY**: `node tools/_verify-gffl.cjs` **2866/2866**, 0 page errors. `node
tools/_gffl_seams.cjs` **121/0, unrestaged**. `node tools/_verify-sports.cjs` **231/231** (229
→ 231, item 6's two new athlete-id checks).

**Proof of bite**: app files (`lg-ui.js`/`league.html`/`sports.mjs`) reverted to HEAD, the new
suite kept. `node tools/_verify-sports.cjs`: 229 pre-existing checks passed, exactly the 2 new
athlete-id checks (item 6) failed. `node tools/_verify-gffl.cjs`: 1602 pre-existing checks
passed untouched (through section AH2 — everything ahead of the gamecast), then item 3's
restaged geometry checks (the crossbar-parallel-to-end-line read) correctly went `undefined`
against the old crossbar shape, ending in a clean crash reading a property off that `undefined`
result — the same "a new check fails hard against old code" shape the 2026-08-20 zero-floor
entry above documents as the acceptable proof when a check depends on a symbol/shape the old
code never had. App files restored from the scratchpad backup afterward; `git diff --stat`
confirmed byte-identical to the pre-revert working tree.

Plates (scratchpad, not `shots/` — throwaway review artifacts never live in the repo):
`gffl_gamecast_{390,1280}.png` (uprights + top of the game view), `gffl_boxscore_owner_tags_390.png`,
`gffl_scores_livenow_390.png`, `gffl_injury_healthy_green_390.png`.

**REVIEW FOLLOW-UP (same day)**: two things the plates caught that the DOM checks alone hadn't.
(A) **The live scores plate read "QUNDEFINED UNDEFINED."** Two bugs stacked: the item-4 test
fixture's live event carried no `period`/`clock`/`detail` at all — thinner than any real ESPN
payload, which always sends all three for an in-progress game — and `scoreCardHtml`'s own state
line had no fallback for that gap (`"Q" + e.period + " " + e.clock"` prints the literal word
"undefined" when either is missing). Fixed both: the fixture now carries the real shape (period,
clock, detail, AND name/city/color per side, matching `sbFix()`'s own `mk()` shape) plus a SECOND
live event with no period/clock at all, to prove the fallback independently of any one fixture
being complete; `scoreCardHtml`'s state line now reads `period+clock` if both are present, else
the event's own `detail` string, else the plain word "Live" — never a printed `undefined`. New
checks: the no-period/clock event renders its `detail` text, and the string "undefined" appears
nowhere on the page.
(B) **Neither gamecast plate reached "In this game"** — both crops ended at This Drive, above
the fold. Three more plates, scrolled to the section: `gffl_gamecast_inthisgame_{390,1280}.png`
(both NFL sides, owner tags, slot markers, points — the full 4-row hand-built fixture) and
`gffl_gamecast_inthisgame_empty_390.png` (the "No GFFL players" line on the empty side, sitting
next to a real rostered row on the other).

**VERIFY (re-run after the follow-up)**: `node tools/_verify-gffl.cjs` **2872/2872**, 0 page
errors (with `--shots`). `node tools/_verify-sports.cjs` **231/231**, unaffected by either fix.
---

## 🏈 GFFL — FOUR MORE FROM THE COMMISSIONER: "In this game" narrows to your own matchup, the
## goalposts come down, the section reads at body scale, and the D/ST table catches up to the
## league's own 2026 settings sheet (2026-08-22, same day as the playtest-6 batch above)

Files: `assets/league/lg-ui.js` · `assets/league/lg-core.js` · `league.html` ·
`tools/_verify-gffl.cjs` (2882 → **2882**, no new checks added net — see the count note below) ·
NEW `tools/_gffl_scoring_2025.json` · `tools/_gffl_rules_reconcile.mjs`. No commits, no push.

**ITEM 1 — "IN THIS GAME" NARROWS TO THE VIEWER'S OWN MATCHUP, STARTERS ONLY.** The section
used to scan every GFFL team's roster (any slot, any team) for anyone on either NFL side — a
"who's rostered anywhere" list, not "who's in MY game this week." Now it shows only STARTERS
(never BENCH/IR) on either side of `LG.myTeamId()`'s own matchup this week. A new
`myMatchupThisWeekStrict()` reuses the matchup tab's own lookup (`LG.gamesForWeek`) but WITHOUT
its `wk[0]` fallback — the Matchup tab deliberately shows *some* game to a bye-week/no-team
viewer so the page isn't blank; "In this game" must go absent for exactly that viewer instead.
Loaded once at open (`UI._myMuGame`), alongside `UI._rosters`, the same convention. The
empty-side "No GFFL players" line is gone — a side with nobody rostered (or nobody in a starter
slot) now renders nothing for that side, and the WHOLE card is absent when: the viewer has no
team, has no matchup this week (a bye), or the matchup has no starters in this game at all.
RESTAGED (BA3, the "In this game" block): the row-count assertion (was 4, every roster slot; now
2, starters only), plus three NEW checks — a bench player on the user's own team in this game is
NOT listed, a starter on a THIRD team in this game is NOT listed, and a no-team viewer gets no
section at all. The "No GFFL players" checks flipped to their opposite (no line renders now) and
a new "no matchup this week (bye)" absence check was added.

**ITEM 2 — GOALPOSTS REMOVED ENTIRELY.** `post()` (the crossbar + base post + two uprights
function) and its two call sites (`post(0) + post(1000)`) are gone — `.nflpost` no longer exists
anywhere in the field markup. `FPAD` (the 26-unit margin the frame carried solely so the
goalposts' crossbar overhang didn't clip against the viewBox) goes to **0** — MEASURED, not
guessed: with FPAD at 0 the field rect's own corners exactly fill `[0,1000]` by the frame's
existing formula ("leftmost slab point is (0, FY.bot), rightmost is (1000, FY.top)"), and the
PIN — the one thing left that draws outside the field rect's own y-range — was hand-computed and
then measured live (`getBoundingClientRect` vs. the SVG's own box) to confirm it never overhangs
at either extreme of ball position, at 390px AND 1280px. RESTAGED (AH3): the two `.nflpost`
geometry checks (crossbar-parallel-to-end-line, post count/uprights, the goalpost `inFrame`
check) replaced with the opposite assertion (`nflpostCount === 0`) plus a live pin-bounding-box
check at both viewport widths — the field's end zones, chalk lines, drive path and pin are all
still asserted rendering correctly around it.

**ITEM 3 — "IN THIS GAME" FONT SIZES MATCH THE DRIVE ROWS.** `.nflgprow`'s row font-size was
already 13px, numerically equal to `.nfldrv`'s — but the global `button{}` reset
(`font:600 12.5px var(--font-display); text-transform:uppercase; letter-spacing:1px`) was
leaking through `.nflgprow`'s own `font:inherit` (inherit resets family/weight/size/line-height,
but NOT text-transform or letter-spacing), so the rows rendered in the app's BUTTON voice —
small-caps, letter-spaced — instead of its body/small row voice. `.nflgprow` now explicitly
resets `text-transform:none; letter-spacing:normal;`. NEW suite check (end of BA3): measures
`getComputedStyle` on a live row vs. a live `.nfldrv` row vs. `.seclabel` — row font-size equals
`.nfldrv`'s (13px = 13px, and NOT `.seclabel`'s 12px display scale), text-transform matches
`.nfldrv`'s (`none`, not `uppercase`), letter-spacing is back to `normal`, and the player NAME
(`<b>`, weight 700) is bold against the points span (weight 400) — the same bold/regular pattern
the drive rows use. Re-measured at 1280px too.

**ITEM 4 — D/ST SCORING vs. THE LEAGUE'S REAL 2026 ESPN SETTINGS SHEET.** The target table:
`dst_sack` 1 (unchanged) · `dst_int` 2 (unchanged) · `dst_fum_rec` 1 (code default was 2) ·
`dst_fum_forced` 1 · `dst_safety` 4 (code default was 2) · `dst_blk` 3 (code default was 2) ·
`dst_td` 6 (unchanged) · `dst_kr_td` 8 · every `dst_pa_*` bracket **0** (points allowed is not
scored at all) · no KR/PR-yardage or tackle key scores anything (confirmed — no such keys exist
in `D.KEYS`).

**THE COORDINATOR CAUGHT A REAL MISTAKE MID-TASK.** The first pass assumed the LIVE settings doc
still carried pre-reconciliation rates and needed a masked PATCH. It did not: **the live doc has
carried every one of these exact 2026 values since a 2026-08-14 commissioner edit (v=8)** — eight
days before this session. Read live (before touching anything): `dst_fum_rec:1, dst_fum_forced:1,
dst_safety:4, dst_blk:3, dst_kr_td:8, dst_pr_td:8`, and all eight `dst_pa_*` keys at `0`. **Item
4c is therefore a NO-OP** — backup taken (`settings_backup_2026-08-23T00-35-55Z.json`), no
weekly_2026_* docs exist yet (season hasn't started), NO PATCH sent, no version bump, no log
entry. A second backup taken later (`settings_backup_2026-08-23T01-22-04Z.json`) diffs
byte-identical (key-sorted) against the first — proof nothing drifted and nothing was written.

**THE SNAPSHOT MECHANISM (item 4a), and a SECOND coordinator catch.** `tools/_gffl_rules_reconcile.mjs`
now reads `tools/_gffl_scoring_2025.json` for `season === 2025` instead of the live doc (which
now carries whatever rate the league is CURRENTLY playing under) — protecting the 2025 proof from
any future live-doc edit. The coordinator's first version of this instruction proposed sourcing
the snapshot from `LG.DEFAULT_RULES.scoring` AS COMMITTED AT HEAD instead of the live doc, on the
theory that the live doc had moved past the 2025-reconciled rates. **Measured, not assumed**: ran
the reconciliation against that HEAD object verbatim — it does **NOT** reconcile. 1739
discrepancies: `rec:1` (full PPR) where ESPN paid 0.5/reception all season, every yardage
game-bonus at 0 where ESPN paid real points all season, `off_fum_td:0` where ESPN paid 6, and
`dst_blk_td`/`dst_kr_td`/`dst_pr_td`/`dst_fum_ret_td`/`dst_int_ret_td`/`dst_fum_forced`
**entirely absent as keys** (six D/ST rules that don't exist in `DEFAULT_RULES` at all). 1721 of
2497 player-weeks wrong. `LG.DEFAULT_RULES` is the code's generic new-league template — it was
never touched by the 2026-08-13 rules-reconciliation fix, which worked entirely through the LIVE
Firestore doc. The snapshot is therefore the verbatim `rules.scoring` map read from the live doc
on 2026-08-22 (the object actually proven, by running it, to reconcile 2025 exactly) — it happens
to already equal the 2026 target table, which is coincidence of timing (the commissioner
finalized 2026 rates eight days early, and they matched what 2025 was actually scored under), not
a 2026-into-2025 leak. The file's own header comment carries this full chain of reasoning so a
future reader doesn't repeat either mistake.

**RECONCILIATION BEFORE/AFTER.** BEFORE (original script, straight against the live doc, run
before any change this session): `RECONCILED — our rules reproduce ESPN's 2025 scoring exactly:
every exercised coefficient, every player-week total, every matchup total` — 2497/2497
player-weeks, 136/136 matchup totals, 0 unmapped-paid stat ids, 0 ESPN-internal-consistency
mismatches. AFTER (script now reads the frozen snapshot for season 2025; live doc for every other
season): **byte-for-byte the same result** — `RECONCILED`, same 2497/2497, same 136/136, same
dormant-rule list (`dst_2pt_ret, dst_td, one_pt_safety`, order differs only because the snapshot
is a plain object vs. Firestore's field order — the SET is identical).

**ITEM 4b — CODE DEFAULTS CATCH UP.** `LG.DEFAULT_RULES.scoring` (lg-core.js ~1070-1076) updated
to the 2026 table above — it was eight days stale relative to the live doc's own 2026-08-14 edit.
Comment names both the ESPN settings sheet and the staleness. RESTAGED: every suite check pinning
the old D/ST rates via a no-settings-doc fixture (which falls back to `DEFAULT_RULES`) — the
whole-team hand-computed matchup totals (away 4.0→**3.0**, home 41.0→**37.0**, phase-2 freshest-
source 48.2→**44.2**), `dst_PHI`'s and `dst_DAL`'s individual derived totals (9.0→**5.0**,
4.0→**3.0**), the preseason fixture's opponent total (3.0→**0.0**), the AC5 garbage-input-revert
check (`dst_pa_0` reverts to its "previous value," now **0** not 5), and a live-final-box D/ST
score (10.0→**7.0**). Every restage names "ESPN 2026 league settings sheet (commissioner,
2026-08-22)" as the reason. No stray key missing: `dst_fum_forced` and `dst_kr_td` are both
present in `DEFAULT_RULES` now.

**ITEM 4d — THE RULES VIEW COLLAPSES THE ZERO PA TABLE.** When every `dst_pa_*` is 0 (view mode
only — a commissioner editing still sees the real editable table, so PA scoring can be turned
back on), the "Points allowed" table is replaced by one muted line: "Points allowed are not
scored in this league." Genuinely data-driven, not hardcoded to 2026 — the SCORING_GROUPS'
Defense/Special Teams row now also lists `dst_fum_forced` ("Forced fumble") and `dst_kr_td`
("Kick/punt return TD"), previously absent from the view entirely despite being real, scored
keys. Two fixtures prove both directions: `fullSeed()`'s no-settings-doc DEFAULT_RULES (all-zero
PA) renders the muted line and no table; the suite's own ESPN-import fixture (its raw
`scoringItems` still carry a real nonzero PA ladder, exactly the shape a league that DOES score
PA would have) renders the full table unchanged — the same page, two different data shapes.

**D.SCORE HAND-COMPUTED PROOF.** A hand-built D/ST stat line — 3 sacks + 1 INT + 1 fumble
recovery + 1 forced fumble + 1 safety + 1 blocked kick + 1 defensive TD + 1 KR TD, with 35 points
allowed — run through `D.score()` against `LG.DEFAULT_RULES.scoring` (loaded in a Node `vm`
sandbox, not re-implemented by hand): `3×1 + 1×2 + 1×1 + 1×1 + 1×4 + 1×3 + 1×6 + 1×8 + 0 = `
**28.0**, matching the hand computation exactly. The same stat line against the frozen 2025
snapshot also scores **28.0** (the snapshot's D/ST rates equal the 2026 target on every key this
line exercises).

**`tools/_gffl_preseason_test.mjs --grade`**: ran it (grades against the live scoring doc, as
designed — not restaged). Result on the current preseason slate: `played: 10/11 · GROK MAE 3.98
vs PRIOR MAE 3.67` — **Grok did not beat the crude prior this slate**, an honest datapoint, no
D/ST rows in this particular grading batch.

**PROOF OF BITE, all four items in one pass.** `assets/league/lg-ui.js`, `assets/league/lg-core.js`
and `league.html` reverted to `HEAD` (test file kept at its restaged state); `node
tools/_verify-gffl.cjs` run against that mix: **2850 pre-existing checks passed untouched, 27
new/restaged checks failed** — item 4's fifteen D/ST-total restages (old code still pays the old
rates), item 2's goalpost check (`no .nflpost element exists` fails — old code still draws 2),
item 1's five "In this game" restages (old code lists a bench player, a third-team starter, and
never goes absent for a no-team/no-matchup viewer), and item 3's two font checks (old row reads
`uppercase`/`1px` letter-spacing against the drive row's `none`/`normal`). App files then restored
from the scratchpad backup (`cp` from a pre-revert copy, not `git stash`) and confirmed
byte-for-byte identical (`diff` clean on all three) to the edited working tree a prior full run
had already validated green.

**VERIFY (final, all edits in place)**: `node tools/_verify-gffl.cjs --shots` **2882/2882**, 0
page errors. `node tools/_gffl_seams.cjs` **121/0, unrestaged**. `node tools/_verify-sports.cjs`
**231/231**, unaffected.

Plates (scratchpad, throwaway review artifacts): `gffl_gamecast_{390,1280}.png` (no goalposts, pin
fully inside the frame), `gffl_gamecast_inthisgame_{390,1280}.png` and
`gffl_gamecast_inthisgame_empty_390.png` (starters-only rows at the drive-row font scale, one
side collapsing to nothing rather than a dead line), `gffl_rules_dst_2026_390.png` (the live 2026
D/ST table + the muted "Points allowed are not scored" line, on `DEFAULT_RULES`), `shots/gffl_rules_390.png`
(the SAME view, post-ESPN-import, proving the PA table still renders when the data genuinely has
nonzero brackets — the view is data-driven, not hardcoded).
---

## 🏈 GFFL — THE COMMISSIONER'S RULING: CONFLICT is commish-only, and mergeRow stops treating an empty feed as an opinion (2026-08-23)

"I don't want users to ever see that there is a conflict, that's only for the commissioner to
care about." Two changes, files `assets/league/lg-{data,ui}.js` + `tools/_verify-gffl.cjs`
(new section BB, 9 checks; suite now **2887/2887**).

**1 · DISPLAY IS COMMISH-ONLY.** `row.conflict` is still computed and tracked exactly as before
— it's the commissioner's own diagnostic. Only the DISPLAY changed: `halfCell` (lg-ui.js
~4258) now gates the `.conflictflag` badge behind `isCommish()`, the same helper that gates the
replay-phase card and the rest of the commish-only chrome. A non-commissioner's row renders
byte-identical to a `row.conflict === false` row — no badge, no title, nothing added to line 2.
Grepped every read of `row.conflict` in lg-ui.js: it is read in exactly ONE place for display
(`halfCell`, feeding the matchup starters/bench cells) — no tooltip, locker, players-table,
player-card, or health-chip surface exposes it, so there was nothing else to gate.

**2 · MERGEROW'S FEED ELIGIBILITY IS TIGHTENED (lg-data.js ~1182).** Preseason exposed Sleeper
thin on stats. Before this fix, the default two-feed (`e && s`) branch picked whichever side
had the LATER `last` stamp with no check that side actually carried any stats — so an empty
but fresher Sleeper row could beat a full ESPN row and show a finished player at 0.0. And
`row.conflict` fired whenever both sides merely EXISTED, so an empty Sleeper row sitting beside
a full ESPN row read as a "disagreement" it never was. Both are now gated on the existing
`hasStats()` helper (the same one the espn-only/sleeper-only branches already used): a side
with no stats is ABSENT for scoring — the fresher-wins rule only applies between two sides that
BOTH have stats, and a side with stats beats an empty fresher side outright. `row.conflict` now
additionally requires BOTH sides to have stats. An empty feed is an absent opinion, not a
dissenting one. Every other mode branch (`espn-only`, `sleeper-only`, one-side-only) is
untouched — this only touches the default dual-feed path.

**RESTAGED**: none of the pre-existing checks pinned the old behavior directly (no prior test
asserted "an empty fresher side wins" or "existence alone conflicts") — this is new coverage,
not a reversal of an asserted invariant, so nothing needed restaging.

**SUITE — section BB, 9 checks**: (a) non-commissioner + `conflict:true` synthetic row on
P. Passer (the real live starter, `key "3915511"`) → no `.conflictflag` in HIS OWN half-cell
(found by matching the `.pcell` containing his name, not just the row — a `<tr>` holds both
sides' half-cells, and the first check version accidentally read the wrong side's `.pmeta` and
had to be corrected before it caught anything real), no CONFLICT text, and his `.pmeta`
textContent byte-identical to the same cell rendered with `conflict:false`. (b) commissioner,
same row → badge renders with title "Sources disagree" and text "CONFLICT", exactly as before.
(c) `mergeRow`: ESPN full stats (`rec:3, rec_yd:30`, hand-computed 3×1 + 30×0.1 = **6.0**,
`last:100`) vs Sleeper EMPTY stats but FRESHER (`last:200`) → `pts===6`, `src==="espn"`,
`conflict===false` — pins the exact bug (pre-fix this returned `pts:0, src:"slp"`, the fresher
empty side winning). (d) both sides with stats, game post: ESPN 10.0 vs Sleeper 10.6 (diff 0.6)
→ `conflict===true`; ESPN 10.0 vs Sleeper 10.3 (diff 0.3) → `conflict===false`. (e) same 0.6-pt
gap, game "in" → `conflict===false` regardless (the existing live-play suppression, pinned
alongside the new checks).

**BITE, proven twice.** First pass: app files reverted to HEAD, suite re-run — only 2 of the 3
new-signal checks failed (`noBadge` and the mergeRow-c pts check), while a THIRD
(`byteIdentical`) passed for the wrong reason — the test read `tr.querySelector(".pmeta")`,
which grabbed the FIRST `.pmeta` in the row (the opponent's half-cell, which never had
`conflict` set) rather than P. Passer's own. Debug output confirmed the CONFLICT badge really
was rendering in his half-cell pre-fix; the check just wasn't looking there. Fixed to scope
every read to the `.pcell` containing "P. Passer" specifically, re-verified: fixed app files →
**2887/2887**; app files reverted to HEAD → **2884 pass / 3 fail**, exactly the three checks
that pin the new behavior (`noBadge`, `byteIdentical`, mergeRow-c), every one of the 2884
pre-existing checks (including the commissioner-badge-still-works and conflict-d/e checks, which
the old code already satisfied by coincidence) green either way. App files restored from the
scratchpad backup.

**VERIFY**: `node tools/_verify-gffl.cjs` **2887/2887**, 0 page errors. `node
tools/_gffl_seams.cjs` **121/0, unrestaged** — it calls `D.score` directly against stored stats
for its mergeRow-adjacent checks, never `D.mergeRow` itself, so the tightening doesn't touch it.
`node tools/_gffl_shadow_score.mjs --selftest` **50/50** — it's an independent re-implementation
of `D.score`/`normSlp` only; it never calls `mergeRow` and carries no conflict logic, so this
batch doesn't touch it either.
---

## 🏈 GFFL — THE SEASON-RESET BATCH: vacuous finality, the preseason re-target, and the real
## stats bleed it uncovered (2026-08-26)

The commissioner emptied every 2026 roster and deleted every preseason artifact on 2026-08-23
(the entry above this one is the last thing that ran before the reset). Report, post-reset: "in
the standings teams have ties for some reason, they should be at zero, and there shouldn't be a
comment about provisional wins since the season hasn't started. the matchups should now reflect
week 1 of the real season." Six items. Files: `assets/league/lg-{core,data,ui}.js` +
`tools/_verify-gffl.cjs` (2887 → **2942**, restaged AI2-AI5, new section BC). No commits, no push.

**ITEM 1/2 — VACUOUS FINALITY.** `LG.matchupDecided(sideA, sideB)` — `Array.prototype.every` on
`[]` is `true` BY DEFINITION, so "every player is done" held vacuously for a side with nobody on
it. An empty-vs-empty matchup therefore satisfied `aDone && bDone`, `totalOf` both sides read 0,
and the function returned `{decided:true, winner:null}` — a DECIDED 0-0 TIE. The standings'
provisional overlay (2026-08-20's own ruling) counted that tie for EVERY matchup in a freshly-
reset league, and the "* Provisional — decided this week, not yet official" footnote rendered for
a season that had not started. The theorem's own precondition — "every not-done player can only
ever add" — was never violated; the bug was upstream of it: a side with nobody on it was never
asked to prove anything, and the vacuous truth of `every()` answered for it anyway.

**THE FIX has two halves, because the {pts,done} array's SHAPE was the actual blind spot.**
`LG.matchupDecided` now checks `sideA.length + sideB.length === 0` FIRST and returns
`{decided:false, winner:null}` — a side with nobody on it has made no claim at all, it isn't
done. But `matchupSides` (lg-ui.js), the one caller, used to pad every unfilled starter slot with
a `{pts:0, done:true}` placeholder — so even a genuinely empty roster produced an ARRAY OF NINE
placeholders, never `[]`, and the new length check would never have fired. `matchupSides` was
changed alongside it to push NOTHING for an unfilled slot instead of padding it. The two forms
are mathematically identical to every summation below (`bankedOf`/`totalOf` never see the missing
entry either way, and a `done:true` placeholder can never turn `every()` false either way) for
ANY side with at least one real starter — a genuine bye/empty-slot on an otherwise-populated
roster is still "done, contributes zero," pinned by the pre-existing (d) check in section AZ3.
The two forms diverge ONLY when a side has NO starters at all, which is exactly the "nobody has
been drafted yet" case this fix exists for. The genuine one-side-empty semantics are untouched
and re-pinned with their own new checks: a real, banked side against a truly empty side (a bye,
or an opponent who forfeits by having nobody) IS still decided — `bDone` is vacuously true for
the EMPTY side specifically, which is the correct half of the same theorem, never disturbed.

**ITEM 3 — THE PRESEASON SLATE RE-TARGET.** `D.pollScoreboard`'s bare `${ESPN}/scoreboard` always
means "the current week" — preseason, in late August — so `D.S.games` (every game line, kickoff,
and the Scores tab's own "NFL this week") kept showing exhibition football straight through the
reset. Fixed: when the bare payload's season type normalizes to "pre," `pollScoreboard`
immediately fetches the explicit regular slate — `${ESPN}/scoreboard?dates=${LG.SEASON}
&seasontype=2&week=${LG.currentWeek()}`, the SAME URL family `D.fetchWeekSlate` has used for the
Scores week cycler since 2026-08-13 — and builds `D.S.games`/`espnWeek`/`espnSeasonType` from
THAT payload instead. A re-target failure falls back to the preseason payload already in hand
(health/the board still update off something that tick) rather than throwing the whole poll away.
When the bare payload is already regular/post the block is a genuine no-op: ONE fetch, byte-
identical to before — MEASURED on the wire (`D.EP`'s own per-endpoint call counts), not assumed.

**CONSEQUENCES, asserted rather than assumed** (section BC3): every game on the re-targeted board
reads "pre" with a real future kickoff; `D.gameStarted` reads false for every re-targeted team,
so nothing is locked; the matchup page's own game line shows the real kickoff text ("Sun 12:00
PM"), never the old preseason game's live clock or Final state; the Scores tab's NFL half lists
the SAME re-targeted week-1 slate. `finalizeWeek` still refuses — but MEASURED, not the mechanism
first assumed. Once ESPN's own read becomes "regular" (via the re-target) while Sleeper's real
`/state/nfl` stays genuinely "pre" (untouched — item 3 never touches the Sleeper side of
anything), `D.engineSeasonType()` reads a provider DISAGREEMENT (null), not "pre." `finalizeWeek`
refuses at the season-type gate with reason `"no-live-data"`, not `"preseason"` — a different gate
than the original "every game must be Final" guard, reached earlier in the function, but the same
outcome: nothing written, ever. This is exactly the Sleeper-side fail-closed posture staying
intact — the guard still refuses on the strength of Sleeper's own honest preseason read, just by
disagreement instead of agreement now that ESPN's own read has been deliberately re-targeted away
from it.

**RESTAGED, with the reversal named at every check (AI2-AI5, section AI, the 2026-08-09 entry):**
that whole section's ORIGINAL point was proving the app followed the NFL into preseason ON
PURPOSE, for a deliberate shakedown. This reset reverses that call outright — the league must
look like real week 1 the instant the reset lands, not whenever the NFL calendar happens to catch
up. AI2: `st.espn` was pinned `"pre"`, is now `"regular"` (re-targeted); `st.engine` was pinned
`"pre"`, is now `null` (disagreement); the Sleeper-side assertions (`st.slp`, the STATS bucket
URL) are UNCHANGED — item 4 gates what a preseason line may SCORE, never which bucket gets
fetched. AI4: the "every game reads Final" staging is no longer reachable at ALL (the re-targeted
slate is never final by construction) — replaced with the MEASURED disagreement path above. AI5:
the "engine rolls to preseason week 2" trap can no longer occur — the re-target always asks ESPN
for `LG.currentWeek()`, so `D.S.espnWeek` can never independently drift into a preseason week
number again; `D.engineWeek()` now reads a flat disagreement (null) instead, and
`staleFinalizeWeeks`' own "unknown is not stale" rule is what keeps week 1 quiet, a SHORTER path
to the exact same safe silence the original test proved.

**ITEM 4 — PRESEASON STATS BLEED, real and fixed.** Investigated before assuming: with rosters
refilled after the Sep 6 draft but before Sep 10 kickoff, does a Sleeper preseason stats poll
populate `row.pts`? YES — `D.pollSleeper`'s live stats fetch (`slpStatsUrl()`) picks its bucket
off Sleeper's OWN `/state/nfl` reading, completely independent of item 3's ESPN-side re-target;
it stays genuinely `"pre"` clear through real preseason. And `D.livePts` (the SCORE column's own
funnel, and the one `liveTotal`/matchup-total summation reads) has NO game-state check of its own
— unlike `D.liveProj`'s explicit pre/in/post branching, it returns `row.pts` verbatim whenever the
row exists with a non-null value, regardless of whether that player's real week-1 game has
kicked off. A drafted player's real preseason box score would therefore land directly on the
"week 1" board as if it were live. **FIXED at the ingestion point** (RULE-1-style — "the funnel
is at the READ, not the write" — except here the funnel IS the write, since nothing downstream
can tell a suppressed merge from a genuinely-quiet one): `D.pollSleeper` now skips `applySide`
entirely whenever `D.S.slpSeasonType === "pre"` — `row.pts`/`row.official` are never touched by a
preseason line at all. Identity/injury registration (`rowFor`, `row.injury`) is deliberately NOT
gated — the directory and injury report must not go blind just because the score is withheld.
`n` (the "did this bucket carry real data" signal that locks `D.S.slpBucket` and marks
`D.S.slpSeeded`) only counts an APPLIED player, so the guarded window never lies about holding a
real baseline — the first genuine merge once the season is truly regular sees itself correctly as
the first, not a live-play swing off a phantom zero. Pinned two ways: end-to-end (AI3, restaged —
the exact preseason box AI3 hand-computes at 7.0/5.2/1.0 now reads 0/0/0, matchup totals both
0.0, exactly like any pre-kickoff week) and at the mechanism itself (BC4 — `row.slp` is never
even CREATED, not merged-then-discarded).

**ITEM 5 — PROJECTIONS = REGULAR WEEK 1.** `D.projFor`'s priority: a Grok-adjusted
`proj_<season>_w<week>` doc first (`LG.ensureAdjustedProj`, regenerated on every boot + a 20h
TTL), then Sleeper's raw `D.S.slpProj` for everything the Grok adjuster doesn't touch (D/STs and
every `slp_`-keyed free agent — the adjuster only ever adjusts numeric espn-id keys). **The
Grok-adjusted doc's own ESPN "kona" anchor (`lg_espn_projections`) needed no fix**: it addresses
ESPN's FANTASY `scoringPeriodId`, a concept the real NFL calendar's preseason has no part in at
all (ESPN's fantasy game does not score preseason; `scoringPeriodId=1` already means real week 1,
regardless of what the raw NFL scoreboard's `season.type` says). Confirmed live, not assumed: read
the production `proj_2026_w1` doc directly (Firestore REST, GET-only) — generated 2026-08-26
11:40 UTC (within the last two hours of this session, self-healed via the 20h TTL + boot-time
regeneration), carrying sane, real week-1-caliber numbers for real 2026 players (Josh Allen
19.9→16.9, Lamar Jackson 20, CMC 16.8, etc.) — genuinely NOT preseason-scoped. **No write made to
it.** The FALLBACK (`D.S.slpProj`, from `D.initSleeper`'s own projections fetch) WAS genuinely
preseason-scoped — same shape as item 4's bleed, one layer up: it asks Sleeper's own "current"
bucket, which stays `"pre"` through real preseason. Fixed the same way item 3 re-targets the
scoreboard: when Sleeper's own read is `"pre"`, the fetch asks for the explicit REGULAR week-1
bucket instead (`/projections/nfl/regular/<season>/${LG.currentWeek()}`) — no second fetch needed
here (unlike item 3's bare-vs-explicit scoreboard shapes, this endpoint already takes an explicit
season/week/type triple, so the override is just which values get asked for). Pinned two ways:
AI2 restaged (Sleeper's own preseason week happens to read 1 there, so old and new coincide) and
BC5, new (Sleeper's own current week is deliberately 3 there — the fetch still asks for week 1,
proving the WEEK is genuinely overridden, not just the season type).

**THE proj_/projsnap_ STORE, READ LIVE (GET-only, no writes made anywhere in the store this
session):** `proj_2026_w1` — fresh and correct, above. `projsnap_2025_w1` — historical, inert for
the live 2026 season (`LG.loadProjSnap` always addresses `LG.SEASON`, which is 2026). **
`projsnap_2026_w1` — STALE AND WRONG, FLAGGED BUT NOT TOUCHED.** Written 2026-08-07 19:57 UTC,
weeks before this session, every one of its 30 rows carries `proj: 0`. `LG.snapshotProjections`
is WRITE-ONCE (compare-and-swap, `if (existing) return existing`) — because this doc already
exists, the pre-game accuracy snapshot `finalizeWeek` will read for week 1's Grok-accuracy grade
can NEVER be recaptured; the season's own accuracy stat for week 1 will compare real week-1
points against an all-zero snapshot the moment week 1 finalizes. This is real and worth a
decision, but it is not the doc the brief authorized touching ("if the proj_ cache is preseason-
scoped or stale, you may clear/refresh THAT ONE doc" — proj_, not projsnap_, and "touch nothing
else in the store"). Left exactly as found; flagged here for the commissioner's own call.

**ITEM 6 — THE POOL, VERIFIED, NOT LOCKED.** The commissioner's first message this batch proposed
a deterministic pool-lock (refuse claims/adds/waiver-processing until real kickoff); the
commissioner then OVERRULED that design mid-task, before any of it was built: draft is Sun Sep 6,
anyone undrafted is simply a free agent, instantly addable first-come-first-served, no waiting
period — players lock per the NORMAL started rules once their own real week-1 game kicks off
(Thu Sep 10, per item 3's re-target). **No lock code exists anywhere in this diff.** Verified
instead (section BC6, four checks, all pinning EXISTING behavior): (a) post-draft (Mon Sep 7),
`LG.faAdd` of an undrafted free agent succeeds instantly and lands on the roster with no queued
claim; the same player then refuses everywhere else as `"player-taken"`. (b) Nothing is locked
before kickoff: with the item-3 re-targeted week-1 slate ("pre," real future kickoffs),
`D.gameStarted` reads false for every re-targeted team, so a real starter stays freely droppable
and a free-agent add still works, straight through the Wed Sep 9 8am waiver window. (c) That
Wed 8am run, with zero claims queued, behaves exactly like any other quiet week —
`LG.processWaivers` marks the week `processed:true` with empty `claims`/`results`, and neither
team's roster moves a byte; PINNED, not changed, per the brief. (d) At the first real kickoff
(one game forced `"in"`), that game's own STARTING-slot players lock via the pre-existing
`LG.dropBlocked`/`D.gameStarted` pair exactly as they always have, while a starter on a team
whose game hasn't kicked off yet — and the bench, always — stays fully droppable.

**VERIFY**: `node tools/_verify-gffl.cjs --shots` **2942/2942**, 0 page errors. `node
tools/_gffl_seams.cjs` **121/0, unrestaged** — it sets `D.S.espnSeasonType`/`slpSeasonType`
directly in its own fixtures and never calls `D.pollScoreboard`/`D.pollSleeper`/`D.initSleeper`,
so none of this batch's pollers are in its path at all; confirmed by grep before touching
anything, and confirmed again by the empty-guard NOT breaking a single seam check.
`netlify/functions/sports.mjs` was NOT touched — every re-target in this batch is client-side —
so `_verify-sports.cjs` was not re-run.

**PROOF OF BITE.** `assets/league/lg-{core,data,ui}.js` reverted to `HEAD`, the restaged/new test
file kept, `node tools/_verify-gffl.cjs` run against that mix: **2874 pre-existing checks passed
untouched**, and every one of the 13 restaged AI2-AI5 checks plus every new BC1-BC6 check failed
— items 1/2's empty-vs-empty pure-function and all-empty-board checks (old code still returns a
decided 0-0 tie and renders the footnote), item 3's fetch-count/game-state/finalize-reason checks
(old code never re-targets, so the re-target endpoint is never created and the board still reads
the bare preseason payload), item 4's stats-bleed checks (old code still merges the preseason
line straight onto `row.pts`), item 5's projections checks (old code still asks the preseason
bucket), item 6's checks passed even against old code (no lock was ever built, so nothing there
COULD fail bite — noted rather than hidden: item 6 is a verification-only item, and its proof of
bite is that it needed none). App files then restored from the scratchpad backup.

Plates (scratchpad, throwaway review artifacts): `gffl_allempty_standings_390.png` (every team
0-0-0, no asterisk, no footnote), `gffl_week1_matchup_390.png` (real week-1 game line, future
kickoff), `gffl_scores_week1_390.png` (the Scores tab's re-targeted NFL slate).
---

## 🏈 GFFL — the player card's season schedule, and the moves-table OPP column's real bug
## (2026-08-26, same day as the season-reset batch)

Two commissioner asks. 1: "when clicking a player the card should show their season schedule
and their stats for each game" — today's card shows a game log of PLAYED weeks only. 2: "in the
moves page in the players section we need a column of who their opponent team is that week" —
except that column already existed (item 22, 2026-08-09). Files: `assets/league/lg-{data,ui}.js`
+ `tools/_verify-gffl.cjs` (new section BD, 20 checks + 2 restaged). **2957/2957, 0 FAIL.**

**THE REAL BUG BEHIND ITEM 2, found before writing a line**: the OPP column read
`D.oppForWeek(week, team)`, which answers "if-known" by comparing the viewed week against
`D.engineWeek()` — a genuine "not known yet" guard, not a display convenience. Reading it in
isolation looked fine; the season-reset batch's own preseason re-target (the entry directly
above this one) changed what that guard actually GUARDS. `D.engineWeek()` compares WEEK
NUMBERS (`D.S.espnWeek === D.S.slpWeek`), not season types — so it still agrees in the unit
tests, where `fixture.preseasonWeek` defaults to 1 and the re-target also asks for week 1. It
does **not** agree in the real app: **verified live** (`curl https://api.sleeper.app/v1/state/nfl`
just now) — Sleeper's own real preseason reads `week:3` in August, while ESPN's re-targeted
slate asks for `LG.currentWeek()` = 1. Two different week numbers, genuine disagreement,
`D.engineWeek()` = null, and `D.oppForWeek` returns null for every row, unconditionally, the
instant the reset landed. The column wasn't missing — it went silently dead, and "we need a
column" is exactly how a family member describes a column that never shows anything.

**THE FIX**: a new `D.oppForTeam(teamAbbrev)` (lg-data.js, beside `D.oppForWeek`) reads
`D.S.games` directly — no week-agreement gate at all. `D.S.games` is REBUILT every poll as
"whichever slate `pollScoreboard` just re-targeted to," so there is no "which week" ambiguity
for it to guard against; a team missing from it (a bye, or genuinely untracked) still answers
null, the same if-known honesty, just off the map that is actually live right now. `D.oppForWeek`
itself is UNCHANGED — it still backs the OLD game-log fallback and the Grok-adjuster's context
(lg-core.js), neither of which this session touched. Reformatted to match item 1's new schedule
table: bare abbrev home ("DAL"), "@ABBREV" away no space ("@DEN") — was "vs DAL"/"@ DEN".

**ITEM 1 — THE SCHEDULE.** `playerCardHtml` now fetches the player's NFL team schedule ON
DEMAND (`D.teamSchedule`, lg-data.js) and renders all 18 real NFL weeks, replacing the
played-weeks-only log. **PROBED LIVE before a line was written** (curl, 2026-08-26):
`site.api.espn.com/apis/site/v2/sports/football/nfl/teams/<ab>/schedule` — the SAME base this
file already calls for the scoreboard — with the bare endpoint defaulting to PRESEASON (3
events); `?season=2026&seasontype=2` is required for the real 18-week regular slate. Real shape
against PHI: top-level `team.abbreviation`/`byeWeek` (10 for PHI, the one week number missing
from `events`), and 17 `events[]` of `{date, week:{number}, seasonType, competitions:[
{competitors:[{homeAway, team:{abbreviation}}]}]}` — the exact competitor shape
`pollScoreboard` already parses for the live slate, so home/away and the opponent's own abbrev
read the same way.
- **Per-row logic**: a week already in `D.gameLog(key)`'s rows (finalized, real fantasy points)
  shows the POINTS; the row matching `UI.week` specifically (this week) falls back to the
  already-computed live state text (Live/Final/Kickoff — the same `gameStateText`-shaped value
  the card's own header line uses); every other unplayed week shows its own kickoff
  (`shortKick` off the schedule fetch's own date); a week with no event at all (the reported
  `byeWeek`, or genuinely absent) reads "Bye", muted. D/ST cards get the same table — their
  team IS the team, `D.metaForKey` already resolves it. A player whose team is unknown never
  even attempts the fetch — the card renders exactly as it did yesterday.
- **Cache: per NFL TEAM, not per player** (`D._teamSchedCache`/`D._teamSchedInFlight`, the
  EXACT shape `D.weekStats`'s own perf fix already established — only a real result is cached,
  concurrent callers for the same not-yet-cached team share one in-flight promise) — opening
  five PHI players' cards costs one fetch. **Proven, not assumed**: two different PHI players'
  cards, `D.EP["espn team schedule PHI"].n` stays 1.
- **Graceful degrade, the spec's own words** ("the card must never be emptier than it is now
  because a new fetch failed"): `D.teamSchedule` never throws (same try/catch-and-return-null
  shape as `D.weekStats`); `playerCardHtml` wraps the whole fetch pair in one more catch of its
  own, so a schedule failure downgrades ONLY this section, never the whole card. A fetch failure
  (proven with a SCOPED endpoint-only 503, mirroring `espnSummariesDown`'s own pattern) falls
  back to the exact pre-existing 4-row played-weeks table, byte for byte. Section Y's own
  pre-existing card test (`fixture.teamSched` never armed there) now doubles as proof of the
  SAME path for the ordinary "no fixture, no data" case — noted at the check rather than
  restaged, since nothing about it needed to change.

**SUITE**: new section BD (20 checks): the 18-row schedule hand-computed against
`seedWithWeeklyHistory()`'s own P. Passer numbers (10/10/20/1) — a played week's points merged
onto its own row, a DIFFERENT played week proving the merge isn't a repeat, the fixture's own
bye week, an away week's "@" format, and a future kickoff's weekday shape (never a clock time —
the same "not pinned to a timezone" rule section AI's re-target check already followed, since
`shortKick`'s `toLocaleString` has no explicit zone); the per-team cache (two cards, one team,
one fetch, via `D.EP` bookkeeping — the exact mechanism section W2 used for `D.weekStats`); a
SCOPED fetch-failure degrade; `D.oppForTeam` hand-computed straight off `sbFix()`'s own slate,
home/away/bye all three. **RESTAGED, reason at each check**: section I2's rendered-row OPP
check ("vs DAL"/"@ DEN" -> "DAL"/"@DEN"); section BC's own AI3 restage of the SAME column
("vs SEA" -> bare "SEA") — its own comment now also records why THIS fixture's `engineWeek`
happened to agree (`fixture.preseasonWeek` defaults to 1, matching the re-target's own ask)
even though the real app's does not, which is exactly why the old code passed this one unit
test while still failing in production.

`node tools/_gffl_seams.cjs` **121/0, unrestaged** — it sets `D.S.games` directly in its own
fixtures and never calls `D.pollScoreboard`/`initSleeper`, so neither `D.oppForTeam` nor
`D.teamSchedule` is anywhere in its path. `netlify/functions/sports.mjs` untouched — the
schedule fetch is client-side, the same way the app's other ESPN calls already are — so
`_verify-sports.cjs` was not re-run.

**PROOF OF BITE.** `assets/league/lg-{data,ui}.js` reverted to `HEAD` (the restaged/new test
file kept), full suite run against that mix: **2941 pre-existing checks passed untouched, and
exactly the 16 checks this session's own changes touch failed** — the schedule's 18-row/bye/
away/merge checks (old code renders the 4-row log, `undefined` past its bounds), the per-team
cache checks (0 fetches, old code never calls the endpoint), both restaged OPP checks (old
text: "vs DAL"/"@ DEN"/"vs SEA"), and all three direct `D.oppForTeam` checks (`undefined` —
the function doesn't exist yet). **One page.evaluate call needed a `typeof` guard first**
(`D.oppForTeam`/`D.EP[...]` called bare against code where they don't exist yet threw INSIDE
the browser and crashed the whole Node-side suite rather than failing one check) — fixed by
reading `undefined` instead of throwing, which still fails the assertions honestly. **One known
gap, stated rather than hidden**: the "future week's value is never a fabricated score" check
reads array index 5 of a 4-row old table (`undefined`, out of bounds) and passes vacuously
there — harmless, since the row-count and heading checks in the same cluster fail hard for the
identical reason, but not a strict indicator on its own. App files then restored from the
scratchpad backup, confirmed byte-identical (`diff`) before the count above was taken.

Plates (scratchpad): `gffl_playercard_schedule_390.png` (Jalen Hurts/PHI — two played weeks'
real points, the bye row, an away "@DEN" row, several future kickoffs), `gffl_moves_opp_390.png`
(the OPP column scrolled into frame: "@PHI"/"KC"/"@DEN"/"DAL"/"—"/"—"), `gffl_moves_opp_1280.png`
(the same table, OPP in its normal desktop position, no panning needed).
---

## 🔔 GFFL — THE COMMISSIONER'S RULING: league alerts default ON, enrolled at the login gesture
## (2026-08-31)

League push notifications are now ON by default. A browser's own permission prompt cannot be
skipped, and iOS refuses to fire it without a real user gesture — so "on by default" cannot mean
"silently enabled at boot." It means enrolled automatically at the one tap that already IS a
gesture: a successful team claim or PIN login (`claimTeam`, section AK). That tap resolves the
login, THEN — same async chain, unawaited — fires `BuckyPush.enable(nm || LG.who() || T.name,
LG.famKey, null, { gfflTeam: T.id })`, letting `enable()`'s own `Notification.requestPermission()`
fall out of it naturally. Success shows the same `"Alerts are on for <team> on this phone."` toast
the manual "Turn on" button always has.

**UNAWAITED ON PURPOSE.** `maybeEnrollPushOnLogin` is fired, never `await`ed, from `claimTeam`.
Awaiting it would mean a slow FCM round trip — a hung `getToken()`, a flaky service-worker
register — delays the login it rides in on. Section BE7 stubs `enable()` to hang forever and
proves the locker still renders on schedule (57ms, well inside the normal boot window); nothing
about login ever waits on push.

**THE GATE, all four conditions reusing `pushEnv()`** (the same helper the Alerts card's own
render already used): push supported in this context — which folds in the iOS-tab case
(`e.iOS && !e.standalone`) rather than leaving it to a thrown error, because real Safari can
report `PushManager` present in a plain tab with no working subscription outside the installed
app, and the ruling's "no enrollment attempt" is literal · `Notification.permission` is
`"default"` or `"granted"` — never re-asks someone already denied · no device is enrolled for a
`gfflTeam` yet (`BuckyPush.status().extra.gfflTeam`) — ANY existing league enrollment blocks a
new one, not just a match on this team, which is what makes a device that changed hands or
already alerts for a sibling's team a no-op rather than a second write · no sticky opt-out
recorded.

**THE STICKY OPT-OUT** — `localStorage["gffl_pushoptout"]`, following the file's existing
one-key-no-suffix identity convention (`gffl_team`/`gffl_who`, S1's own note). "Turn off" in the
Alerts card sets it; "Turn on" (manual, or a later successful login) clears it. A real browser
denial during login enrollment ALSO sets it — recorded from `maybeEnrollPushOnLogin`'s own catch
block, gated on `Notification.permission === "denied"` at catch time so a transient failure
(offline, a slow `getToken()`, a missing VAPID key) never gets mistaken for a considered no and
silently blocks every future login's attempt. The Alerts card gained a THIRD state for it: "Alerts
are off on this phone." + Turn-on button, distinct from the original "Get league alerts on this
phone." pitch a never-asked device still sees — reusing that pitch for an explicit opt-out would
read like the app forgot the reader's own choice. The ON card and both byte-identical no-support
cards (iOS-tab, unsupported browser) are untouched.

**CROSS-APP COURTESY, unchanged**: the enrollment call carries the SAME `user`/`gfflTeam` merge
shape the manual card's `enable()` call always has — `LG.who()`/name as `user` (family chore/bank
targeting on this device stays live), `{ gfflTeam: T.id }` as `extra`, `setDoc(..., {merge:true})`
underneath (push-client.js, untouched). Turning league alerts on at login never displaces family
targeting, and vice versa.

**A STALE ASSERTION, FOUND RUNNING THIS FEATURE'S OWN BATTERY, UNRELATED TO IT.** Section AN6
(`enable()`'s arity, and a regex over push-client.js's own `setDoc` call) has read FAIL since
Identity Phase 1 (2026-08-30, commit 91573e2) added `pid` as `enable()`'s 5th argument —
push-client.js is the family app's shared helper, and that commit's own suite never re-ran this
file's battery. Restaged with the reason at the check: arity 4 → 5, the `setDoc` regex now
expects `buildTokenDoc(token, userName, extra, pid)`. Neither line was touched by this session's
own feature.

**SUITE**: `tools/_verify-gffl.cjs`, new section BE (7 sub-sections, 43 checks): BE1 first claim
on a clean device, permission genuinely `"default"` (not stubbed — the real headless-Chrome
default on a secure `127.0.0.1` context, confirmed empirically before writing the check) —
`enable()` called once, right team, right name, the toast lands · BE2 a device already carrying
ANY `gfflTeam` enrollment gets no second call on a further login (an honest limit: this one
passes vacuously either side of the fix, since NEITHER a reverted `claimTeam` nor the new gate
ever calls `enable()` here — BE1/BE5/BE7's own call-count assertions are what actually prove the
gate fires at all) · BE3 the sticky flag blocks the attempt entirely and the card says so plainly
· BE4 "Turn on" clears the flag and repaints the card · BE5 a simulated browser denial (the stub
flips `Notification.permission` via a redefined getter — the real property is a read-only
accessor, confirmed empirically — then rejects, mirroring what `enable()`'s own
`requestPermission()` would do) records the sticky flag, never blocks the login, and puts nothing
in front of the reader to dismiss (the toast stays hidden) · BE6 an iPhone in a plain Safari tab
gets no enrollment attempt at all, and the byte-identical install-it card section AN already
proved · BE7 a hung `enable()` never delays the locker rendering. Battery **2957 → 3000/3000, 0
FAIL**. `node tools/_gffl_seams.cjs` **121/0, unrestaged** — it drives `lg-core`/`lg-data` directly
through a fake-Firestore kit and never touches `claimTeam`, `lg-ui.js`, or push at all.

**PROOF OF BITE.** `assets/league/lg-ui.js` reverted to `HEAD` (the new/restaged test file kept),
full suite run against that mix: **2989 pre-existing checks passed untouched, and exactly 11
checks — every one of them section BE's own (BE2 excepted, see its own note above) — failed**: no
enrollment call ever fires from a reverted `claimTeam` (BE1's call-count/team/name/toast
assertions, BE5's attempt/sticky-flag assertions, BE7's "call was genuinely made" assertion, all
read 0/`undefined`/never), and the sticky-off card copy never renders since `alertsCardHtml` has
no third branch — BE3's card-text checks fail, and BE4's "Turn on" never finds a flag to clear.
App file then restored, confirmed byte-identical (`diff` against the pre-revert backup) before the
after-count above was taken.

Files: `assets/league/lg-ui.js` (`claimTeam`'s two success points, fire-and-forget; the S4.1
block beside `pushEnv` — `PUSH_OPTOUT_KEY`/`pushOptedOut`/`setPushOptedOut`/
`maybeEnrollPushOnLogin`; `alertsCardHtml`'s new sticky-off branch; `wireAlertsCard`'s on/off
handlers now clear/set the flag) + `tools/_verify-gffl.cjs` (new section BE, and the AN6 restage
above).
---

## 📱 GFFL — THE FLOATING BOTTOM BAR, AND THE REPO'S FIRST REAL-WEBKIT RIG (2026-08-31)

Commissioner, from a real iPhone (the installed PWA): "the bottom button row is floating in
the middle when I scroll down, on all pages." The diagnosis trail, in order: .bnav's own CSS
is correct (position:fixed, bottom:0) and unchanged for weeks; no ancestor carries a
transform/filter/contain that would demote fixed; no overflow-x on html/body; no runtime
body style writes; no recent commit touches the bar. That left an ENGINE quirk, and the lead
suspect is the bar's own backdrop-filter: iOS WebKit has a documented bug family where a
backdrop-filtered position:fixed element's blur layer decouples from the viewport during
scroll — which reads exactly as "floating in the middle".

**THE RIG (new equipment):** scratchpad/bnav-rig — playwright-core@1.60.0 (scratchpad-
installed, never in the repo) driving the LOCAL webkit-2287 build already present in
%LOCALAPPDATA%/ms-playwright, iPhone-shaped context (390x844@3x, isMobile, hasTouch, iOS UA),
network blocked per the house pattern, .bnav's rect measured against the viewport at seven
scroll offsets plus wheel-cumulative scrolling. Result: 0.00px drift everywhere — COULD NOT
REPRODUCE, and honestly should not have: webkit-2287 on Windows is the WinCairo build, a
different compositor backend from the CoreAnimation pipeline an iPhone runs. A Windows rig
can falsify layout theories (it did — ours were already falsified statically) but cannot
prove or disprove an iOS compositing bug. The next iOS-only report starts from this rig
anyway: it settles every non-engine explanation in minutes.

**THE FIX, SPECULATIVE-BUT-SAFE:** .bnav is promoted to its own compositor layer up front
(translateZ(0) + will-change:transform) — the documented mitigation for exactly this iOS
class, a visual and layout no-op on every other platform (the rig's before/after numbers
prove 0.00px displacement). The suite pins the PROPERTY, not the bug — losing the promotion
in a refactor fails loudly, because the only machine that can prove it matters is the
commissioner's iPhone. **If the float persists on-device after this ships, the hypothesis is
wrong**: next stops are (a) dropping the blur for a solid var(--tabbar) on iOS standalone,
(b) a visualViewport-driven reposition. Report back either way — this entry is the ledger.
---

## 🏆 GFFL — LAWS RULE: the franchise at slot 5 changes families (2026-08-31)

Commissioner rulings, applied to production data only (backup → masked PATCH with CAS →
canonical re-read, the fix_awards2 protocol; no code changed):
- **Nails For Breakfast is renamed Laws Rule** (abbrev NF → LR), owner Sandy Laws
  (set with her email + PIN reset earlier the same day). Renamed in the league team doc
  AND the Draft Day doc.
- **Its history is the IN-LAWS franchise.** History joins by ESPN team id, so per the
  Dawn Treaders precedent (2026-08-13, defunct id 1904): every old-lineage id-5 row —
  TNG Yellow Shirts / ST Red Shirts / The Scenic / Nails For Breakfast, hist_2012-2014
  and 2018-2025 — re-id 5 → **1905** in teams[] AND matchups[] (177 references), so
  eleven seasons go defunct-quiet but stay on disk; IN-LAWS re-id 1016 → **5** in
  hist_2012-2015 (63 references), so Laws Rule's all-time record reads 2012-2015
  IN-LAWS (5-10, 6-9, 6-9, 7-7) and nothing again until 2026.
- **The silverware stays with the family that won it**: the 2009 points title and 2016
  runner-up move to defunct-held 1905 rows (names preserved), and team_5's trophy case
  is emptied — IN-LAWS won nothing. Re-admitting the old franchise under 1905 would
  bring its whole record and both awards back, per the folded-franchise design.
---

## 🏈 GFFL — THE VACUOUS FINALIZE: weekly_2026_w1 written as four 0-0 ties (2026-08-31)

Commissioner: "the standings are showing everyone with a tie but no games have been played
yet." Not a display bug — a real, WRITE-ONCE weekly_2026_w1 existed, created 2026-08-30
18:38Z by some device's boot auto-checks. THREE guards had to line up, and did:

1. **The every([]) hole, one layer deeper than the clinch fix.** finalizeWeek's live gate
   collects starters whose games aren't final and refuses if any are pending — over the
   season-reset's EMPTY rosters, zero starters means zero pending means the gate passes
   vacuously. Same disease matchupDecided was cured of on 2026-08-26; nobody checked the
   floor below.
2. **The week-1 re-target made ESPN answer "regular"** (by design — the board looks forward),
   so the positively-regular season-type guard saw a regular-season payload in preseason.
3. **Sleeper was unreachable at that moment**, and engineSeasonType trusts one-sided
   knowledge (by design, so a normal-season Sleeper outage can't block finalize) — the
   pre/regular contradiction that would have failed closed was never seen.

**Repair**: the doc was backed up (scratchpad weekly_2026_w1_vacuous_backup.json) and
deleted; standings read 0-0-0 again immediately. **Fix**: a compute-phase guard in
finalizeWeek — a week in which no matchup fielded a single starter refuses as
"empty-week", placed BELOW the force/backfill branching on purpose: no path, commissioner
force included, may record a week nobody played. (An archived backfill of a real week
always has starters, so this refuses nothing real.) The suite reproduces the empty-roster
half and asserts both plain and forced refusal, with the fixture's rosters
captured-and-restored around the probe. The one-sided season-type trust stays as designed
and is now DOCUMENTED here as a contributing factor rather than silently load-bearing.

If a bogus week-recap push went out on 2026-08-30, it cannot be unsent — the record it
described no longer exists.
---

## 🏈 GFFL — PRE-SEASON SERVERLESS HARDENING: timeouts, secrets, daily caps (2026-09-02)

A pre-season review of `netlify/functions/{sports,league,farmgpt,audiogen-background}.mjs`
found four gaps, all fixed here. Battery: `_verify-sports.cjs` 289/289, `_verify-ffai.cjs`
39/39, `_verify-leaguecron.mjs` 45/45, `_verify-notify-url.mjs` 36/36 — all green.
`_verify-ffdraft.cjs` is NOT green; see the D/ST finding below, which is the reason.

1. **No upstream fetch had a deadline.** `sports.mjs` and `league.mjs` both hit ESPN with
   plain `fetch()` — no `AbortController`, anywhere. Netlify kills a function at ~10s and
   returns a raw 502, which breaks both files' own documented promise ("a failure returns
   `{ok:false,reason}` at HTTP 200"). Both files now route every upstream call through one
   shared `timedFetch()` wrapper (the `stocks.mjs`/`news.mjs`/`health.mjs` pattern already in
   this repo). Single-call actions get a 7s budget (`FETCH_TIMEOUT_MS` / `LEAGUE_FETCH_TIMEOUT_MS`,
   env-overridable); the three sports.mjs actions that make TWO sequential calls
   (`ff_matchup`'s pro-game join, `ff_draftinfo`'s bye-week read, `ff_draftpool`'s D/ST+K sweep)
   and league.mjs's URL-ladder actions (`lg_espn_rosters_season`, `lg_espn_kicker_audit`,
   `lg_espn_history`) pass a SHORT budget (3.5s / 2.5s) on every call in the sequence, so a
   worst-case double-timeout still lands under Netlify's ceiling instead of one slow call
   eating the whole budget alone. `lg_espn_rules_audit`'s 6-slot diag loop (no suite fixture,
   commissioner-only) gets its own tighter per-slot budget (1.2s) for the same reason.
   `tools/_verify-sports.cjs` gained a "hang" fake-upstream mode (never responds, distinct from
   the existing "drop" — immediate reset) and two new sections: **T** (sports.mjs, 10 checks)
   and **L** (league.mjs — no dedicated function-level suite of its own exists; `_verify-gffl.cjs`
   section A covers league.mjs but is a 20k-line, `league.html`-driving suite out of this
   task's scope, so the coverage lives here instead, reusing the same fake fantasy upstream).
   Both sections assert the abort fires near the CONFIGURED budget (elapsed > budget×0.5,
   < budget+900ms) — proof it actually waited for the timeout, not a coincidental fast failure.
   Bite: reverted to HEAD, the new checks don't just fail — they HANG (no deadline exists to
   catch them), confirming the exact defect. `nflOwnership`'s catch also folds an AbortError into
   the honest `"timeout"` reason instead of a blanket `"unreachable"`.

2. **`audiogen-background.mjs` billed ElevenLabs credits behind the FAMILY password.** That
   secret ships in every page's client JS; anyone who read `ffdraft.html`'s source could fire an
   arbitrary batch of billed generation. It now gates on its OWN secret, `AUDIOGEN_SECRET`
   (server env only, never shipped to a page, never falls back to `BUCKY_NOTIFY_SECRET`) —
   unset or mismatched both refuse with 401, which is the correct default until an operator
   sets it. **OPERATOR ACTION REQUIRED: set `AUDIOGEN_SECRET` in Netlify's environment, or this
   function refuses every request.** `tools/_gen-draft-audio.mjs` now reads it from
   `process.env.AUDIOGEN_SECRET` or `tools/.env` (never scrapes `ffdraft.html`) for its own
   calls to this function specifically — its calls to `sports.mjs` (`ff_draftpool`/`ff_draftinfo`,
   for the player pool and team names) are untouched and still use the scraped family password,
   since that function's own gate wasn't part of this fix. The per-call job cap dropped from 220
   (arbitrary headroom) to 200 — the largest real batch this generator ever sends
   (`firePlayers()`'s `SAY_N` default, the 200-player announcement run); nothing else it fires
   comes close.

3. **The six gffl LLM modes had no server-side rate limit.** `fantasy`/`ffrecap`/`ffcommentary`/
   `gfflproj`/`gffltrade`/`gffladjust` were gated on the same public family secret with nothing
   bounding how many paid xAI/Anthropic calls a leaked or reused secret could trigger — unlike
   story mode's own `STORY_DAILY_CAP`. Added `GFFL_DAILY_CAP` = 300/day, shared across all six
   (the analyst on every trade suggestion, the adjuster per week, the booth every ~3rd draft
   pick — ~60/draft — comfortably fits under 300 even on a heavy family day). Mirrors the story
   cap's OWN mechanism exactly: a plain read-then-compare check before the model is ever called,
   no CAS (the story cap has none either — it's a query-count, not an atomic increment, so
   neither gets one). Rather than a second counter, it reads the field that ALREADY atomically
   tracks these six modes: `w_req` in `logUsage`'s daily rollup doc (`farmgpt_usage/<date>`,
   real Firestore `fieldTransforms.increment`, unrelated to CAS but genuinely atomic on write).
   Checked AFTER `ffrecap`'s cached-column early return (an already-generated recap costs
   nothing) and BEFORE any mode's messages are built. Fails OPEN on a Firestore read failure,
   matching every other read in this file (`storyBonusToday`, `countStoryToday`) — the
   alternative takes fantasy analysis off the site on any Firestore hiccup, worse than a bounded
   burst risk during a rare outage window. `tools/_verify-ffai.cjs` gained section E (7 checks):
   request #300 (counter at CAP−1) served normally and its OWN real usage-logging increment
   carries the counter to exactly 300; request #301 refused `{ok:false,reason:"daily-cap"}` at
   HTTP 200 with no model call; a DIFFERENT one of the six modes refused off the same shared
   counter; a cached `ffrecap` still returns free; story mode untouched with the gffl counter
   maxed; a reset counter (a new day's fresh doc) serves again. Bite: reverted to HEAD, exactly
   the 2 cap-enforcement checks fail (37/39) — every other check, including "story cap
   untouched," passes trivially with no cap at all, which is why only those 2 are the bite.

4. **Minor**: `goatfantasyleague.com` / `www.goatfantasyleague.com` added to `sports.mjs`'s and
   `farmgpt.mjs`'s `ALLOWED_ORIGINS`, matching `notify.mjs`'s existing set. Relative fetches make
   this inert today; consistency for the next reader.

### THE D/ST FINDING (urgent addition mid-task, FATAL) — and what it reopened

Coordinator flag, proven by `tools/_gffl_kickoff.cjs` PART A.4: `sports.mjs`'s `POS_LABEL[16]`
slimmed a drafted defense's `pos` to `"D/ST"`, while `league.mjs`'s own `POS_LABEL` and the
league app's own convention (`assets/league/lg-ui.js` `applyImportedRosters`:
`p.pos === "DST" ? "dst_"+team : ...`; `LG.slotEligible` compares `pos` against the roster's
own slot key, `"DST"`) both already used `"DST"`. The draft room sources its whole player pool
from `sports.mjs` (`ff_draftpool`/`ff_matchup`/`ff_player`/`ff_pct_owned`), so every drafted
defense reached the league keyed by its raw ESPN id instead of `dst_<team>`, and
`LG.canFillLineup` read false for all 8 teams post-import. Fixed: `POS_LABEL[16]` is `"DST"` in
`sports.mjs` now. `SLOT_LABEL[16]` (a DIFFERENT field — the roster's lineup-SLOT display name,
e.g. `ff_draftinfo`'s `slots` roster-needs object) is deliberately left `"D/ST"` — untouched, on
purpose, because of what running the suites actually found next.

**Running `tools/_verify-ffdraft.cjs` after the fix reopens a PREVIOUS incident (2026-08-06,
same file's own comment at line ~899-901).** `ffdraft.html` never re-derives `pos` — it carries
the pool's own string straight through into `D.picks[k].pos`, the position-filter chip, the
roster-needs counter, and the mock-bot's need-targeting logic, all hardcoded to `"D/ST"` at the
time each was fixed. Confirmed live by the suite itself, not by inspection alone: the D/ST
filter chip shows zero rows (data-pos was fixed to `"D/ST"` in 2026-08-06 specifically to match
the pool, `ffdraft.html:3070` `POS` array + `renderPlayers()`'s chip build), its CSS-color
check fails as a cascade of the same empty result, the player-pool 24h cache stops caching at
all (`poolHealthy()`, `ffdraft.html:~1216`, checks `pos === "D/ST"` to decide the fetched pool
is real — now always concludes "no defenses," same false-negative the 2026-08-06 incident was
originally about), and section B2's own `waitForFunction` on `pos === "D/ST"` times out and
CRASHES the suite, so sections after it (cloud-unreachable banner, live/TV gate) never ran at
all this pass. Worse: `tools/_gffl_kickoff.cjs`'s "0 of 8 teams drafted a D/ST" across 128 mock
picks — first read as cross-agent noise — is this SAME bug: `ffdraft.html:~2466`'s bot logic
filters `avail` by `pos === "D/ST"` to specifically target a defense, which now never matches,
so the mock bots have no need-driven way to draft one at all.

**Net effect of this fix alone: the FATAL post-draft import bug is solved, and a second, live,
in-room bug is opened in its place** — the draft room's own D/ST chip/cache/needs-bar/bot-need
targeting, broken from the moment this ships until `ffdraft.html` is patched to match.
`ffdraft.html` is out of this task's file scope (another agent's domain, per this session's own
restriction) and was not touched. The two files' idea of the position-16 label were ALREADY
out of sync with each other in different eras (`ffdraft.html`'s 2026-08-06 fix pinned it to
`"D/ST"`; `league.mjs`'s importer has apparently always expected `"DST"`) — sports.mjs can only
emit one string and satisfy at most one side. **`ffdraft.html` needs a companion patch before
the 2026-09-06 draft**: every `pos`-comparison site currently reading the literal `"D/ST"` needs
`"DST"` instead — `POS` (line ~625, also drives the chip's `data-pos` AND its label text),
`cssPos()` (~626, likely removable once `pos` is already CSS-safe), `poolHealthy()` (~1216),
`teamPosCounts`'s `counts` seed object (~2336), `needsFor()`'s pair (~2353 — becomes an
ASYMMETRIC `["D/ST", "DST"]`: the first element still indexes `info.slots`, which `sports.mjs`'s
UNCHANGED `SLOT_LABEL` still emits as `"D/ST"`; only the second, which indexes the pos-keyed
`counts`, needs to change), and the bot-targeting block (~2463-2477: `needSpecial`, the
`avail.filter`, the `c["D/ST"] >= 1` guard). `SLOT_LABEL` in `sports.mjs` must stay `"D/ST"`
unless `ffdraft.html`'s `needsFor()` first-element lookup is repointed too — the two label
families (position vs. roster-slot-display) are independent and don't both need the same value.
Restaged in `tools/_verify-sports.cjs` (a new pool-entry assertion, `pos === "DST"`) and
`tools/_verify-ffdraft.cjs` (Section A's pure wire-value pool check, `"D/ST"` → `"DST"`, with
this incident named at the change) — both are server-only checks unaffected by the client-side
gap. The THREE client-dependent `_verify-ffdraft.cjs` failures (chip, its CSS-color cascade,
pool caching) plus the section-B2 crash were left FAILING on purpose rather than restaged: they
are real, reproduced regressions in `ffdraft.html`'s current behavior, not stale assertions —
restaging them to pass would hide a live bug instead of documenting one.
---

## ffdraft.html — THE BACKDOOR PIN, NO GATE, and (mid-task) THE D/ST FINDING (2026-09-02)

Security review, Build C. Files: `ffdraft.html`, `tools/_verify-ffdraft.cjs` (295 → **314**).
File ownership was strict — only these two touched.

### 1 — THE BACKDOOR PIN, deleted
`var COMMISH_PIN = "14903"` shipped in every visitor's JS and `commishLogin` accepted
`k === COMMISH_PIN || k === D.commishKey` — a literal, static PIN valid on **any** draft room,
handing commissioner powers (rewrite picks, set keepers, pause/reorder) to anyone who read the
page source. The constant and its branch are gone; `commishLogin` now accepts **only**
`k === D.commishKey`. The inline PIN input (`#commishPinIn`, still there for a phone with no
native prompt dialog) is relabeled "Commissioner key" (`type="text"`, was `type="tel"` — the
key is alphanumeric, a numeric keypad was already wrong for it) since a short PIN doesn't exist
to type anymore.

**Commissioner-key recovery path (device changed, no PIN fallback left):** the room's own
Commish tab already has this solved — `renderCommish()`'s "Share links" card shows the
**Commissioner link** (`?c=<commishKey>`) with its own "Copy commissioner link" button, visible
any time to a device already signed in as commissioner. The primary path: on the OLD device,
open Commish → copy that link → send it to yourself → open it on the NEW device (the `?c=`
query param is auto-adopted into `localStorage["ffd_ckey_<season>"]` on load, no length limit).
The `#commishPinIn` field is the fallback for typing the raw key by hand (8 chars, fits its
`maxlength="24"` fine) or pasting a short link into it. Nothing new was built here — it already
existed; this fix only means it's now the *only* path, so it was worth confirming it actually
works end to end (suite: typing the real key signs in; the pasted-link hook path signs in too).

### 2 — NO GATE, closed
The board (and the Firestore listener that streams live picks into it) rendered to anyone with
the URL — no wall of any kind. Added the same one league.html already has: `LG.unlocked()`
(`assets/league/lg-core.js`) reads `localStorage.getItem("choreUnlocked") === LG.PASS` OR
`["thegoatleague","amenfarms"].includes(localStorage.getItem("gffl_pass"))`. `ffdraft.html`
duplicates this verbatim as `familyUnlocked()` — same key (`"gffl_pass"`), same accepted values
(`GATE_PASS = "thegoatleague"`, and `FAMILY_PASSWORD = "amenfarms"` for the family-app's own
`choreUnlocked` legacy check) — so **a family member who already unlocked league.html is
already unlocked here, one password, not two.** `GATE_PASS`/`GATE_KEY` are declared as their
own constants (not borrowed from lg-core.js — this page stays self-contained per house
convention) but `sectionGateStatic` in the suite reads both files' source and asserts the
literals actually match, so this can't silently drift.

Mechanically: a new `<section id="vGate" hidden>` (inside `<main>`, alongside `vLanding`/
`vBoard`/etc.), and the whole boot chain — `initBackend()` (which opens the Firestore listener)
plus `loadInfo/loadPool/loadLastDraft` — is now wrapped: `if (familyUnlocked()) startDraftApp();
else renderFfdGate();`. Nothing else in the file calls `renderAll()` outside that chain (checked
— every `watchPicks`/`watchMusic`/etc. only ever fires from inside `renderAll()`), so an
unlocked visitor triggers **zero network calls**, not just a hidden DOM — stronger than a pure
CSS gate. `renderFfdGate()` on success stores `gffl_pass = "thegoatleague"` (canonical value,
same as `LG.tryUnlock`'s own behavior — case-insensitive typed input, canonical stored value)
and calls `startDraftApp()` directly, no reload needed.

**TV/spectator mode is NOT exempt** — `?tv=1` hits the exact same `familyUnlocked()` check
before anything else runs, on purpose (a wall-mounted TV with no gate is a trap, same instinct
already applied to TV mode's silent-audio design). Suite proves it explicitly.

### 3 — Coordination note: FAMILY_PASSWORD untouched
`var FAMILY_PASSWORD = "amenfarms"` (the server-secret literal `tools/_gen-draft-audio.mjs:323`
regexes out of this file) was **not** renamed or moved — still the exact same `var
FAMILY_PASSWORD = "([^"]+)"` shape. Nothing for that migration to reconcile against on this end.

### 4 — (mid-task addition, FATAL, from the coordinator) THE D/ST FINDING
`sports.mjs`'s `POS_LABEL[16]` changed from `"D/ST"` to `"DST"` (another agent, same day) to
match `league.mjs`/`lg-ui.js`'s own convention — fixing the post-draft import (every drafted
defense was landing keyed by raw ESPN id instead of `dst_<team>`). That flipped a *different*
bug open here: `ffdraft.html` never re-derives `pos` — it carries the pool's string straight
through — and every comparison site was hardcoded to the OLD `"D/ST"`, dead from the moment
`sports.mjs` shipped: the D/ST filter chip (0 rows), the CSS-color check (cascading empty), the
24h pool cache (`poolHealthy()` always "unhealthy" → never cached, the exact 2026-08-06
incident reopened), the roster-needs bar, and the mock-bots' need-targeting (`tools/
_gffl_kickoff.cjs` caught it live: 0 of 8 teams drafted a D/ST across 128 picks).

**Fix, per the docs/gffl.md location list (read before touching anything):** every STORED-value
comparison now reads `"DST"` — `POS` array (now `["QB","RB","WR","TE","K","DST"]`, itself
CSS-safe so `cssPos()`'s slash-mapping was retired entirely, not just patched), `posClass`/
`posColor` (use `pos` directly), `poolHealthy()`, `teamPosCounts`'s seed key, the bot-targeting
block (`needSpecial`, the `avail.filter`, the `c.DST >= 1` guard), the position-filter chip's
`data-pos`, and the custom-player `<select>`'s new explicit `value=` (its option TEXT and the
`data-pos`/seed-key VALUE had been the same literal string doing double duty — they can't be
anymore, since "DST" the stored value and "D/ST" the display label are now two different
strings).

**`needsFor()` is asymmetric on purpose** — and this is the one place the two label families
genuinely diverge, not just a client-vs-server mismatch: `info.slots` (the roster-needs object,
`sports.mjs`'s `SLOT_LABEL`) is a **different field**, deliberately left `"D/ST"` by the
coordinator's fix (it's the ROSTER SLOT's display name, not a player's position), while
`teamPosCounts`'s keys (a player's actual `pos`) are `"DST"`. `needsFor()`'s row objects now
carry `{slot, key, label}` separately — `slot` indexes `info.slots` (stays `"D/ST"`), `key`
indexes the pos-keyed `counts` and drives `neededPositions()`'s NEED-filter set (now `"DST"`),
`label` is what the needs-bar chip actually renders (stays `"D/ST"` — unaffected, a pure display
field all along).

**"D/ST" survives everywhere else ONLY as a display label**, never a compared value — one new
helper, `posLabel(pos)` (`pos === "DST" ? "D/ST" : pos`), wraps every remaining `esc(...pos...)`
site that echoes a position as visible text: the pick-reveal card, TV ticker + spotlight, the
player detail card, board cells, keeper cards + roster-candidate chips, the player-list row's
colored dot, the confirm bar, the custom-position `<option>` text, and the team-roster
round-by-round view. Net effect: **zero visible change** for a human looking at the page — every
place that said "D/ST" before still says "D/ST" — only the underlying stored-value comparisons
that were silently broken now match the real data.

**Suite**: kept the other agent's already-restaged pure wire-value check in Section A (pool
entries read `pos === "DST"` straight off the real handler — untouched by this task). Restaged,
each with the finding named at the change: the D/ST-chip test's `data-pos` selector (now `===
"DST"`, guarded — a missing chip reads as "the check failed," not a crash), and all five
`p.pos === "D/ST"` reads in Section B2 (pool health) that check the REAL `window.__DRAFT__.pool`
shape — these were checking genuine server data, not app logic, so once `sports.mjs` changed
they were simply wrong regardless of anything in this file. Added: an assertion that the
DST-chip test's actual filtered rows still read "D/ST" in the DOM (proves the display map, not
just the comparison) and its CSS-color match (unchanged logic — passes once `posColor` resolves
right). Added new: inside the existing mock-bot full-draft test, an assertion that both of the
fixture's two D/ST players get drafted (the fixture pool only carries 2 defenses across 34
players, so "every one of 8 teams" isn't provable at this scale — but with the room shrunk to 4
rounds, a bot's very first pick already needs one, `needSpecial` trips from round 1, so both
should be gone; this is the same `pos==="DST"` bot-filter mechanism `tools/_gffl_kickoff.cjs`
proved dead at 8-team/128-pick scale, proven here at unit scale). "The chip lists defenses" is
covered by the existing (now-fixed) chip-filter test itself — judged redundant to duplicate.

Also fixed while in the neighborhood: three PIN/gate assertions that assumed the OLD, broken
behavior would leave DOM elements in place (`#commishPinIn` disappearing once "14903" secretly
succeeds; `#posChips [data-pos=DST]` simply not existing pre-fix; a pool-cache poisoning step
assuming a cache exists) were made defensive (guarded booleans feeding `ok()`, not bare
`.find(...).click()`/`JSON.parse(null)`) — a regression has to read as a failed check, not crash
the ~150 checks after it. Proven necessary, not decorative: the combined bite-proof run below
crashed twice before these guards existed.

**PROOF OF BITE (both items, one combined run)**: `ffdraft.html` reverted to `HEAD` (test file
kept at its fixed/restaged state) → `node tools/_verify-ffdraft.cjs` → **291 pass / 16 fail, 0
page crashes**, every failure exactly one of: the 5 gate/PIN source-literal checks, the 2
PIN-login checks, the 3 D/ST-chip checks, the D/ST bot-draft check, the 3 pool-cache checks, and
2 of the 3 live-gate checks (the third — "a device carrying league.html's own key boots
straight past this gate" — trivially passes on HEAD too, since HEAD has no gate to skip; not a
meaningful bite point, noted rather than hidden). Restored → **314/314, 0 page errors**, clean
process table (no orphaned Chrome/port squatters), re-run twice to confirm.

Battery: `node tools/_verify-ffdraft.cjs` — **314/314**.

**One incidental fix**, unrelated to security but blocking a green run today: `sectionPoolHealth`'s
post-reload `waitForFunction` was pinned at 15s and intermittently timed out — reproduced
identically on a fully pristine, untouched `HEAD` checkout of both files, so it predates this
task and isn't a content bug. Bumped to 30s with the reason named at the change; the assertion
itself is untouched.
---

## 🏈 GFFL — THE ENGINE REVIEW'S FIX BATCH: the money and auth paths, a week before kickoff (2026-09-02)

Fourteen proven defects in `assets/league/lg-core.js`, every one of them reproduced first by a
scratchpad probe (`lgsandbox.cjs` + `probe1..probe9b`) against the deployed engine, and every fix
carrying a check in `tools/_gffl_seams.cjs` built from that probe's own reproduction. Files:
`assets/league/lg-core.js` · `tools/_gffl_seams.cjs` (121 → **222**) · `tools/_gffl_season_sim.cjs`
(restages only). `lg-data.js`, `lg-ui.js`, `league.html`, `netlify/*` and `tools/_verify-gffl.cjs`
were NOT touched — three agents shared this worktree and the file ownership was strict.

### F1 · A DELTA CANNOT BE COMPUTED AGAINST A DOCUMENT NOBODY READ
`LG.saveTeam`'s offline fall-through called `build(null)` — and `null` goes straight to
`opts.from`, so a FAAB deduction expressed as *"take $10 off whatever the purse really holds"*
resolved `LG.teamFaab({})` to the RULES DEFAULT and wrote `budget − bid`. **Measured** (probe9b,
with the failure injected at the CAS READ so the real branch is reached): a team that had already
spent $60 took a $10 waiver hit and came out at **$90** — a $50 refund, silently, mid-run.
The fix is one line and its reason: when `opts.from` is present, a failed read THROWS. The
plain-field offline write survives for callers that pass no delta at all (a rename, a logo, a PIN,
a trophy) — those genuinely do not care what the doc used to hold, and the seam suite pins both.
processWaivers' own per-item handling (S1) is what records the throw by name.

### F2 · ONE FAILED AUTH READ USED TO HAND OVER THE LEAGUE
A null `LG.authDoc` meant two different things — *"the league has no commissioner PIN"* and
*"we never heard back"* — and `gateCommish` could not tell them apart. **Measured** (probe3): with
Dad's real hash on file and ONE `getFresh("auth")` failing, the gate offered **"Set a commissioner
PIN (first time)"**, took whatever was typed, wrote it over the real hash, and unlocked. Three
changes: (a) `LG.loadAuth` returns whether the read ANSWERED and latches `LG.authRead`, and
`gateCommish` refuses outright on an unanswered read — **no prompt at all**, because a first-time
prompt is itself the lie (a device carrying the legacy local hash is exempt, which is the pre-S1
offline behaviour); (b) the first-time set is CREATE-ONLY (`LG.db.update(AUTH_DOC, cur =>
(cur && cur.commishPinHash) ? null : {…})`) and an abort hands back the doc it refused against, so
the typed PIN is judged against THAT instead of overwriting it; (c) a refused write never unlocks
— the old code swallowed the failure and unlocked off a purely local hash, which on a read-only
mirror handed the commissioner's controls to whoever tapped one. `LG.migrateCommishPin` took the
same two guards: it is create-only now, and it will not migrate over an unanswered read (that path
would have pushed a legacy hash over the league's own on one timeout).

### F3 · A STARTER ON A BYE MADE THE WEEK PENDING FOREVER
The live finality gate asked `fzGameState(team) !== "post"` — a raw `D.S.games` read — while RULE
2's theorem (`LG.matchupDecided`, 2026-08-20) asks `D.gameDone(team)`. The two disagree on exactly
the case that happens to eight teams every week: a bye team has no entry in `D.S.games`, so
`fzGameState` returns null, `null !== "post"`, and the week never settles — while `D.gameDone` says
a bye is done. **Measured** (probe1): eight teams, every tracked game `post`, ONE bye starter →
`finalizeWeek` refused `not-final` naming him; the identical board without a bye starter finalized
cleanly. Every week from week 5 on has byes. The gate reads `fzGameDone` now — the same function —
and deliberately does not reimplement it, so it inherits the data layer's own concurrent tightening
(an EMPTY games map is not a finished board; `post` now requires `completed !== false`). Fail-closed
when the data layer is absent.

### S1 · ONE FAILING WRITE MUST NOT TAKE THE REST OF THE LEAGUE DOWN
Every write in `processWaivers`' tail was a bare `await` in a loop, so the first failure threw out
of the run and skipped every team after it. **Measured** (probe4 case B, `saveTeam` throwing on the
second dirty team): team 1's purse was never charged, **no transaction row was written for EITHER
winner**, and the week was left unprocessed with two players already moved. Now: each roster write,
each `logTx` and each `saveTeam` is attempted on its own, failures are collected by team and stage,
and **the transactions are logged BEFORE the money** — a tx row is append-only and independent of
the purse, so there is no reason for the only human-readable record of a move to depend on the
money landing. A ROSTER write that fails abandons the run *before* the commit point (the commit is
the point of no return for the money; the deltas are idempotent, so the next device simply re-runs
it). Failures ride back on the run's result AND onto the week's own processing document, where a
commissioner can find them.

### S2 · TWO OWNERS VETOING AT ONCE, ONE VOTE RECORDED
`LG.vetoTrade` was fresh-read → rebuild the array → BLIND whole-doc write: the read-modify-write
shape the 2026-08-18 CAS rework closed everywhere else and missed here. Two owners voting within
the same second is not a corner case for a veto — it is what a veto IS. **Measured** (probe7, the
first write held on a gate until the second completed its whole read-modify-write): two votes cast,
**one recorded**. With `vetoVotes` 4 of 6 eligible owners, a lost vote is a trade the league voted
down that goes through anyway. Moved onto `LG.db.update` with the same shape `acceptTrade` uses;
`logTx` and both pushes fire after a successful loop.

### S3 · THE DEADLINE BINDS THE WHOLE TRADE, NOT JUST THE OFFER
`LG.tradeDeadlinePassed()` was checked in `offerTrade` ONLY. **Measured** (probe6 §C): a NEW offer
at week 17 was correctly refused `deadline-passed` while an offer made legally in week 10 was
ACCEPTED and EXECUTED in the same breath. Both `acceptTrade` and `executeTrade` check it now, in
`offerTrade`'s own `{ok:false, reason:"deadline-passed"}` shape. Deliberately a REFUSAL, not a
cancellation — the trade stays visible and either party can cancel it. **Flagged, not hidden**:
nothing expires such a trade automatically, so a stranded one is retried, and refused, on every boot.

### S4 · THE LEAGUE RUNS ON CENTRAL TIME, NOT ON A FIXED OFFSET
`LG.currentWeek` and `LG.waiverDeadline` anchored on `new Date(SEASON_START + "T05:00:00-05:00")`
and then added whole 7-day and 24-hour spans — correct only while America/Chicago is on CDT. The US
falls back **Sunday 2026-11-01**, and from the very next league week (week 9, Tuesday Nov 3) the
Wednesday waiver deadline read **7:00 AM Central for the rest of the season** — an hour ahead of
the cron that nudges the league to run it (`leaguecron.mjs` fires on an Intl-derived 8:00 Central
band via a 13:00/14:00 UTC cross-product; the seam suite's own A4 already pins that). The engine and
the cron would have disagreed about the deadline for the whole back half of the season, playoffs
included. Both are derived in `America/Chicago` now, by the technique `leaguecron.mjs` and
`chorereminders.mjs` already use — never a hand-rolled offset. `chiInstant(y,m,d,hh,mm)` is the
inverse of `Intl`: the UTC instant at which Central's wall clock reads exactly that, resolved in two
passes because the offset depends on the answer (05:00 and 08:00 are far from the 02:00 transition,
so neither is ever ambiguous). Memoised — `currentWeek()` runs on every render and every poll tick.
`LG.simClampAt` now reads `LG.weekStart(2)` rather than keeping a second, fixed-offset copy of the
same boundary. **Hand-computed and asserted**: week 1 → `2026-09-09T13:00Z`, week 2 →
`2026-09-16T13:00Z`, week 8 → `2026-10-28T13:00Z` (the last CDT one), week 9 → `2026-11-04T14:00Z`
(the first CST one), week 10 → `2026-11-11T14:00Z`, week 14 → `2026-12-09T14:00Z` — every one of
them 08:00 Central, before and after the shift; week 9 starts 7 days **and one hour** of real time
after week 8, and `currentWeek()` still crosses cleanly on that real boundary.

### S5 · advanceBracket — the last read-modify-write, closed
Named as FOUND-NOT-FIXED by the 2026-08-18 CAS entry: it read the bracket through LG.db's CACHE,
mutated that object IN PLACE, and ended on a blind whole-document `LG.db.set`. Two failures rode on
it — `loadBracket` hands back the cache's own object, so every fill rewrote a document other readers
on the page were still holding; and a device whose cached copy still had r3 null wrote those nulls
over another device's resolved championship (the season sim's `writeOnce.bracket` sweep caught it as
champ/third reverting from a real team id to null at w17, 2 of 2 runs on unmodified HEAD). Now a
PURE `fill` over a clone, run inside `LG.db.update`; the trophy write and the `loadTeams` refresh
moved OUT, below a successful loop, because a mutate can run six times and a trophy appended six
times is six trophies. `fill` returning null when there is nothing to resolve means the common case
(boot, every render, every finalize) still writes nothing at all.

### S6 · A WEEK IS A UNIT
The 2026-08-31 `empty-week` guard is LEAGUE-WIDE: it fires only when EVERY matchup is empty. A board
where three matchups are ready and one pairing has nobody on either side sailed past it and recorded
that pairing as a **0-0 TIE** in the same write-once doc — the identical `every([])` hole one level
in. Refuse the WHOLE WEEK, naming the pairing in the teams' own names; force included, for the
empty-week guard's own reason. The commissioner fixes the roster and re-finalizes.

### S7 · ensureRoster's copy-forward was still a check-then-act
The 2026-08-11 fix made it getFresh-before-write, which is two round trips with a window between
them. Now one create-only compare-and-swap (`cur ? null : {the copied week}`): the server refuses the
write if the doc exists and the abort hands back the roster this call should have adopted, so two
devices copying the same week forward at the same instant produce ONE document and both get it.

### S8 · THE IR VOCABULARY, WRITTEN OUT
`LG.irEligible` was an EXACT-STRING `.includes()` over seven spellings, and the app reads two
upstreams that agree on none of them. **Measured** (probe6 §A/§B): a genuinely hurt man parked on IR
whose designation came through the ESPN import as `"OUT"` read HEALTHY — so `LG.illegalIR` flagged
him as an illegal stash and **blocked that team from every acquisition** (`faAdd`, `addClaim`,
`processWaivers`, `executeTrade` all refuse `ir-illegal`) for a stash that was perfectly legal. The
table is now explicit, lowercased and trimmed: Sleeper's `Out/Doubtful/IR/PUP/NFI/Sus`, ESPN's
`OUT/DOUBTFUL/INJURY_RESERVE/SUSPENSION`, and the `O`/`D` shorthands. **Deliberately NOT eligible**,
and this is the anti-vacuity half: `Questionable` (a Q plays most weeks — parking him on IR is
exactly the extra-roster-spot abuse the rule exists to stop), healthy/empty/null, and Sleeper's
ambiguous `NA`/`COV`/`DNR`, which are not on the commissioner's list and are not reliably "out".

### THE OWNERSHIP BELT · one man, two keys
A GFFL roster keys a player by whichever id seeded it: the ESPN import writes his numeric ESPN id,
and anything resolved through the Sleeper directory writes `slp_<pid>` (that prefix exists precisely
because Sleeper carries an `espn_id` for only about half its directory — the 2026-08-09 identity
batch). So the same footballer can sit on one roster as `4430807` and be offered on Moves as
`slp_6813`, and every *"is he already owned?"* check compared RAW KEYS — which answers no, and hands
two teams the same man. `LG.sameMan(a, b)` compares through `D.pidForKey`; **BOTH sides must
resolve**, because an unresolved key means *"we do not know who this is"*, never *"he is somebody
else"*, and treating a null as a match would collide every unknown key with every other one. Wired
into `faAdd` (the ownership scan and both mutates), `faAddRefusal`, and `processWaivers`' owned /
won-this-run sets.

### THE MINORS, folded in
- **`fzPts` coerces through `LG.n` first.** `LG.floorPts` is `Math.max(0, n)` and `Math.max(0, NaN)`
  is NaN, so one non-finite `row.pts` propagated straight into the write-once weekly doc (where the
  REST codec encodes it as `null`). Same at `fzTeamTotal`'s accumulation and the backfill's `ptsOf`.
- **`ID_KIND` gains `proj` and `awards`.** Both doc kinds were minted long after that map was
  written, so `kindOf` answered null for them and `knownAbsent` could never short-circuit their
  reads — every miss was a real round trip, on every render. Purely the perf shortcut every other
  kind already gets.
- **The claim-refusal chain is four independent checks, first refusal wins.** The last link read
  `if (!reason && overBudget) … else if (illegalIR)`, so when an EARLIER check had already set a
  reason the `else if` RAN and overwrote it — a claim refused for `drop-gone` was reported to its
  owner as `ir-illegal`, pointing them at a roster problem they did not have. The ORDER is unchanged
  and still deliberate.
- **`LG.DEFAULT_RULES` catches up with the live settings doc (v=8).** `roster` RB 2→3 and WR 2→3, so
  eleven starting slots and `LG.rosterCap()` **19 → 21**; `scoring.dst_2pt_ret` 0→**4** and
  `one_pt_safety` 0→**1**, the two rules the 2026-08-13 ESPN reconciliation found UNEXERCISED in the
  real 2025 season and grounded through the settings sheet instead. This object is what a brand-new
  league — and every fixture with no settings doc — starts from.
- **`LG.toggleReaction` onto `LG.db.update`.** getFresh-then-set is a check-then-act, and two owners
  tapping the same emoji within a second is what a reaction is.

### ⭐ THE ZOMBIE WEEKLY DOC HEALS ITSELF
Twice in one week (2026-08-30 and 2026-09-01) a family device still running a pre-guard build wrote
`weekly_2026_w1` as four 0-0 ties out of its own boot auto-checks, over the season-reset's empty
rosters. Both were backed up and deleted **by hand**. That repair does not scale and it does not
close the hole: a phone that has not reloaded is still running the old engine, and the weekly doc is
CREATE-ONLY — so a zombie written after the last manual cleanup would make the REAL finalize on
Sep 14 bounce off it with *"already finalized"*, and the week's true result would be unrecoverable.
- **`LG.weeklyIsVoid(doc)`** needs BOTH halves: every matchup 0-0 on both sides, AND every
  power-ranking score 0 (score = 4·wins + 0.05·PF + 2·last3, so one real win puts a team at 4 and one
  real point puts somebody above zero — a played week cannot have an all-zero power table). A doc
  with no power table at all falls back to the matchup half, which is the shape both real zombies had.
- **WHAT MAKES IT SAFE rather than a guess**: since the `empty-week` guard and S6's `empty-matchup`
  guard beside it, no path in this file — commissioner force included — can WRITE an all-zero week.
  The only documents that can now match the shape are zombies.
- **Every weekly reader treats a void doc as absent**, through one funnel. `LG.loadWeeklyDocs()`
  replaces `LG.db.list("weekly")` at all eight lg-core sites: `loadStandings`, `loadStreaks`,
  `playoffOdds`, `powerRankings`, `seasonAccuracy`, `headToHead`, `recordBook`,
  `ensureAdjustedProj`. `LG.loadWeekly(week)` returns null for one, which is what makes
  `buildBracket`'s missing-weeks scan, `advanceBracket`'s three round reads and lg-ui's own week card
  inherit the heal without knowing it exists. `LG.powerRanking(docs)` filters internally as well,
  because it is a PURE function whose docs come from lg-ui's `UI._allWeekly`.
- **`finalizeWeek` REPLACES a void doc** under the ordinary compare-and-swap, carrying
  `replacedVoid: true` so the repair is on the record; a REAL record stays untouchable (the mutate
  aborts and the caller gets it back, exactly as before). The idempotency guard at the top no longer
  answers `ok:true` for a zombie either.
- **KNOWN, and it belongs to lg-ui**: `staleFinalizeWeeks` builds its `have` set from
  `UI._allWeekly`, read straight off `LG.db.list("weekly")` in a file this batch does not own — so a
  void doc still counts as "have" there and no stale-week card is raised. That is the outcome the
  commissioner asked for, reached by lg-ui's own route rather than by this filter; the more correct
  behaviour (offer the archived backfill for a void week) is a one-line filter for whoever owns
  lg-ui next.

### VERIFY
`node tools/_gffl_seams.cjs` — **222/0** (was 121; new section F, 100 checks). Race repros green:
clobber **9/0** · doublespend **12/0** · dbltap **9/0**. `node tools/_gffl_season_sim.cjs` — 17
weeks, 89 sweeps, **15,878 checks, 0 failures** (no `push.produced` or claims intermittents fired).

**PROOF OF BITE.** `assets/league/lg-core.js` reverted to HEAD (the new/restaged suite kept), full
run against that mix: **168 pass / 54 fail** — and the split is the evidence. Of the 122 checks in
the pre-existing sections A–E, **120 pass in BOTH worlds** and the 2 that do not are exactly the two
restaged for the `DEFAULT_RULES` slot-script change. Of the 100 new section-F checks, 52 fail
pre-fix, each on-point, and the old code says it in its own numbers: the purse reads **$90** where
$40 was correct (F1); the gate **unlocks and overwrites Dad's hash** with the sha of a typed 9999
(F2); the week refuses `not-final` naming **Bye Guy** (F3); `processWaivers` **throws out of the
run** with 0 transaction rows (F4); the vetoes array reads **`[3]`** where two votes were cast (F5);
the post-deadline accept **executes** (F6); weeks 9/10/14 read **07:00 Central** (F7); device A's
stale write puts champ and third back to **null** and the store refuses **0** writes (F8), and the
object `loadBracket` handed out is mutated underneath its holder (F8b); the empty pairing is
recorded as a **0-0 tie** alongside three real matchups (F9); **two** roster writes are accepted
where one should have been refused (F10); `irEligible` matches **6 of 14** real spellings, `sameMan`
does not exist and `faAdd` allows the double-own, `DEFAULT_RULES` reads cap 19 / `dst_2pt_ret` 0,
`ID_KIND` costs **2** reads for two misses, and one of two reactions is lost (F11); the refusal reads
**`ir-illegal`** where `drop-gone` was the real problem (F12); the void doc counts a **TIE** in the
standings and `finalizeWeek` bounces off it (F13); a NaN reaches the stored record as **null** (F14).
App file restored from the scratchpad backup, confirmed byte-identical before the after-count.

### RESTAGED, each with its reason at the check
- **`tightNine` → `tightEleven`** and `cap = 19` → `21` (`tools/_gffl_seams.cjs`, C3/C5): the slot
  script gained two starting slots, so every fixture hand-built to exactly fill a lineup or to sit
  exactly at cap had to move with it. C3a's arithmetic becomes 21 −1 +2 = 22; C3b's hand check names
  eleven players; C3b-ii's naive-greedy trap is re-sized (and its `badOrder` with it); C3c's shortage
  moves from *"1 RB where 2 are required"* to *"2 where 3 are"*. C3 also gained a runtime assertion
  reading the booted engine's own `LG.rosterCap()`/`rules.roster`, so this file's constants can never
  silently drift from the engine again — which is exactly what had happened.
- **D4's fixture narrowed to a one-game week**: it finalized against the kit's 4-pairing schedule
  while only teams 1 and 2 carried rosters, so three matchups had zero starters on both sides.
  `finalizeWeek` now refuses the whole week for exactly that (S6) — the ruling working, not a
  regression. The hand-computed 12.4 is untouched.
- **`tools/_gffl_season_sim.cjs`: `ROSTER_SIZE`/`ROSTER_CAP` DERIVED**, not copied. Both were
  hand-computed constants lifted from `LG.DEFAULT_RULES.roster` when they were written, and went
  stale the moment that object moved. The sim now READS the roster block out of `lg-core.js` at
  startup, throws loudly if it cannot find it, and uses that one object for the constants, for the
  settings doc it seeds, and for `slotRoster`'s own script. `TEAM_COMP` grows by one RB and one WR —
  the two positions that gained a starting slot — and is asserted against the derived draft size
  rather than left to be re-derived by hand.
- **`scoreOfKey` applies RULE 1's zero floor** (`tools/_gffl_season_sim.cjs`). The sim's independent
  scorer has been a rule short since 2026-08-20: `nodeScore` mirrors the stats→points FORMULA only
  (which is right — it is the same number `_gffl_rules_reconcile.mjs` proves against ESPN's real 2025
  season, and that reads through no floor), but the value `weekly.totalsMatchRosters` compares
  against a WRITTEN weekly doc has to be the value the engine actually writes, and that one is
  floored. **Why it only surfaced now**: it needs a starter who genuinely scores negative, and seed
  1's old universe had none — the `TEAM_COMP` change shifts every pid and therefore every
  deterministic `hashRng` draw, and the new seed-1 universe has a kicker at −1.0 in week 2. The sweep
  reported team 3 at exactly **Δ1.00**. The engine was right; the mirror was stale.

### KNOWN / FLAGGED
- **`LG.DEFAULT_RULES.roster` has a blast radius outside this batch.** `tools/_verify-gffl.cjs`
  seeds no settings doc at all, so every one of its fixtures falls back to this object — cap 19→21,
  nine starting slots→eleven. Stored roster docs carry their own explicit slots, so team TOTALS are
  unaffected; what moves is `LG.rosterCap()` (roster-full refusals, the "N open spots" row),
  `LG.canFillLineup` (a 2-RB fixture is now "already unfillable", which makes the trade LINEUP guard
  inert rather than wrong), `fzOptimalTotal`'s Bench Blunder arithmetic (top-3 instead of top-2 at RB
  and WR), and the locker's rendered starting-slot count. That suite was not run here by
  arrangement — flagged for whoever does.
- **The live league is unaffected by the roster change**: its settings doc (v=8) already carries
  `{QB1 RB3 WR3 TE1 FLEX1 DST1 K1 BENCH7 IR3}`, which is where these values were read from.
- `xp_miss` is `-1` in `DEFAULT_RULES` and `0` in the same 2026-08-13 reconciliation's
  grounded-through-the-settings list. Observed, deliberately out of scope for this batch, not changed.
- A trade stranded past the deadline (S3) stays `accepted` and is refused on every boot; nothing
  expires it automatically.
- **HARNESS NOTE**: two seam-suite runs aborted with Puppeteer's *"Navigating frame was detached"*
  during a window in which another agent ran `taskkill /F /IM chrome.exe /T`. Both were re-run to
  completion; nothing was restaged for them. Never `taskkill` all chrome/node — find the squatting PID.
---

## 🏈 GFFL — THE WEEK-BOUNDARY BATCH: what "done" means, what a week is, and the ruling on screen (2026-09-02, one week before kickoff)

Twelve findings from a pre-kickoff review of the data layer and the UI, all landed together.
Files: `assets/league/lg-data.js` + `assets/league/lg-ui.js` + `tools/_verify-gffl.cjs`
(new section **BF**). `lg-core.js`, `league.html`, `netlify/functions/*` and `ffdraft.html`
untouched by this build — the engine half of two of these findings (finalizeWeek reading
`D.gameDone`) is a separate, concurrent piece of work.

### ⭐ D-F1 · ESPN's week boundary is not the league's, and the board now follows the LEAGUE's

`pollScoreboard`'s bare `/scoreboard` means "the current week" — **ESPN's** current week, which
rolls on a Wednesday ~07:00Z and rolls EARLY once a week's last game finishes. This league's week
runs Tue 05:00 America/Chicago → Tue. The two therefore disagree for several hours **every week,
in both directions**, and the bare payload is the only thing that decides which week's rows land
in `D.S.games` and `D.S.espnWeek`:

- ESPN rolls FIRST → Monday night's auto-finalize of week N sees `espnWeek` N+1 and refuses with
  `stale-week` for the whole window in which finalizing is actually correct;
- ESPN rolls LATER → Tuesday morning the league is on week N+1 while the board still holds week
  N's finals, and a finalize books last week's numbers into this week's **write-once** record —
  the exact shape of the 2026-08-08 findings 1/3/7.

The 2026-08-26 season-reset batch already re-targeted a PRESEASON payload to the explicit regular
slate. That block is now **generalized**: whenever the bare payload states a regular-season week
that is not `LG.currentWeek()`, the same explicit fetch is made
(`?dates=<season>&seasontype=2&week=<LG.currentWeek()>`). `D.S.espnWeek === LG.currentWeek()` by
construction rather than by luck. The week test is gated on a **finite stated week**, so a payload
naming no week at all (most of this suite's own fixtures, and any future ESPN shape change) does
not fire a second fetch on every tick — an unknown week is already handled, honestly, by
`espnWeek` reading null and every permanent write refusing.

**THE BELT** lives in `D.gameDone`, not in a second copy of the test: while
`D.S.espnWeek != null && D.S.espnWeek !== LG.currentWeek()` it returns false for every team, so
`matchupSides` → `LG.matchupDecided` refuses too and no gold clinch star can appear over a week
the board is not holding. `D.boardWeekMismatch()` is the one predicate.

### ⭐ D-S1 · An EMPTY board is not a finished one

`D.gameDone` answered **true** for a team with no tracked game — correct for a bye, catastrophic
for an empty map. `D.S.games` is empty on every cold boot until the first poll lands, and for the
whole life of a tab whose ESPN reads fail. So every matchup painted itself a **decided 0-0 tie**,
with a clinch star and a provisional standings row, before a single byte of the slate had been
read. A bye is a fact ABOUT a slate we have; no slate at all is not a fact about anything.
`D.S.games.size === 0` now returns false, and `D.remaining` already agreed (every starter reads
"to play"), so the strip and the star cannot contradict each other.

### D-S6 · Postponed and cancelled games

ESPN moves them to state **"post" with `completed:false`** and `name:"STATUS_POSTPONED"` — the
slate has passed the game, nobody played it. `pollScoreboard` recorded only `state`, so a
postponement read to this app exactly like a final. Both fields are slimmed now;
`D.gameDone` requires `state === "post" && completed !== false`, and `D.remaining` counts such a
game as still to play. **`!== false` rather than `=== true` deliberately**: the field is recorded
by `pollScoreboard` alone, so an entry written by any other producer (the 2025 replay's
synthesized slate, a seam/suite fixture that sets `D.S.games` directly) carries `null` and keeps
reading exactly as it did. This closes ESPN's own shape without inventing a refusal for everyone
who never states the field.

### D-S7 · `D.remaining` resolved a player's NFL team from a live row only

A starter with no stat row — every starter until his first line lands, and permanently for anyone
Sleeper's bucket never carries — counted as "still to play" with his game long over. That is what
kept the matchup hero off "Final" and `D.winProb` off its 100/0 pin all afternoon. It now falls
back to `D.metaForKey(key).team`, exactly as `D.liveProj` and `D.remainingProj` already did.

### D-S3 · The poll loop doubled on every visibility toggle

`D.S.running` cannot stop a chain already suspended inside its own `await D.pollOnce()`: `stop()`
clears the pending timer and flips the flag, the in-flight tick resumes afterwards, and by then a
`start()` has flipped the flag back. Each stop/start pair left the OLD chain running beside the
new one and armed a second timer. The GFFL rides inside Bucky's home-screen iframe, whose
visibility handler calls `D.stop()`/`D.start()` on **every tab hop** — so this doubled the whole
upstream poll volume per hop, indefinitely and invisibly, because `D.S.loopStarts` only ever
counted arms past the running guard and a resumed chain never passes through `start()`. Fixed with
a generation token (`D.S.loopGen`), checked at the top of each tick **and again after the await**
— the second check is the half that closes it. `D.S.timerArms` is the new counter that makes it
provable.

### ⭐ D-S4/S5 · The Tuesday rollover, on a tab that never reloads

`D.initSleeper` is memoized once per session and **nothing anywhere cleared `D.S.players`**. A
session is not a week. Across Tuesday 05:00 Central that tab kept polling last week's Sleeper
bucket, showed last week's projections, and — worst, because it looks like real scoring rather
than a stale number — kept every one of last week's stat ROWS in memory, so the new week's matchup
opened with last Sunday's points on it and stayed that way.

`readSleeperState()` and `loadSleeperProjections()` are split out of `initSleeper` (the directory
and its hourly refresh are NOT week-scoped and are untouched). `D.maybeRollWeek()`, called first
in `pollOnce`, clears the week-scoped memory — `players`, `events`, both seeded flags, the
name→row maps, `fetchedFinal`, the stats bucket, `slpProj`, the browsed-week slates, and the two
health `lastChange` markers — then re-reads `/state/nfl` and re-fetches projections at the new
week. Identities, the id memo and the archived-week cache all survive, so a rollover costs no
re-download of the 12,000-entry directory. The hourly injury-directory refresh now re-reads
`/state/nfl` too, which is what catches **Sleeper's** own boundary (days apart from the league's
in preseason) without a timer of its own.

### D-S8 · The injury designation the IR rule needs is in the DIRECTORY

`D.injuryFor` read `D.S.players` — which holds a row only for a player the stat poll has seen,
i.e. only for players who have **played**. The IR rule turns on exactly the opposite population: a
man ruled Out has no stat line by definition. So the read fell through to the roster doc's
import-time snapshot and a player the league listed Out all week read healthy, and
`LG.irEligible` refused the move the locker was offering him for. The Sleeper directory is where
`injury_status` actually lives; it is already fetched and already refreshed hourly, and
`D.pidForKey` resolves a roster key to its entry through all three methods, so this costs no
network and reaches the espn_id-less half of the directory.
**Narrowed deliberately**: only a NON-EMPTY directory designation wins. The directory states
"healthy" and "not carried" with the same empty string, so treating empty as an authoritative
all-clear would silently erase a designation a roster import legitimately carries for a player the
dump does not describe.
The locker's own two IR checks (`irOk`, and the IR candidate filter) read the live row **directly**
and now go through `LG.injuryOf` — the seam whose whole stated purpose since 2026-08-15 was that
"the RULE and the LOCKER can never disagree about whether a man is hurt". They had disagreed:
`doMove` used the seam and correctly allowed the move the list refused to offer.

### Washington: one team, two spellings

`slpTeam()` rewrites ESPN's `WSH` to Sleeper's `WAS` — right for every lookup against
Sleeper-keyed data, wrong for a URL addressed to ESPN, which answers `/teams/WSH/schedule` 200 and
`/teams/WAS/schedule` **400**. `D.teamSchedule` built the URL from the normalised form, so every
Washington player's card silently degraded to the old played-weeks log. There is now an inverse
map (`D.espnTeam`): the URL speaks ESPN, the cache key and the endpoint-bookkeeping name speak
Sleeper, so both spellings share one fetch.

### Minors, data layer

- **`applySide`'s feed delta** was the one multiply the 2026-08-09 NaN fix left open —
  `(nv - ov) * (scoring[k] || 0)` catches a NaN and passes a truthy non-number through, and a
  scoring table is commissioner-typed, Firestore-round-tripped data in which `"4 pts"` really does
  land. Every factor goes through `num()` now.
- **`normSlp`** normalises an EXTERNAL payload and used `x || 0` throughout: a string `"150"`
  survived into the line, and the `fg_0_39` SUM turned three of them into `"110"` by
  concatenation. Every field lands through `num()`.
- **`D.fetchWeekSlate` books under its own endpoint name** (`"espn week slate"`). Booking a
  browsed week under `"espn scoreboard"` made a reader idly paging through October count against
  the live poll in `D.EP` — the health page's data source, and the mechanism sections W2/AY6
  measure with.
- **ESPN's `scoringPlays[].type` is an OBJECT** (`{id, text, abbreviation}`), not a string.
  `String(p.type)` on the real payload is the literal `"[object Object]"`, so the app's own type
  branch had never once matched in production — every FG reached the parser through its text
  fallback alone, and the safety branch relied entirely on prose. Both shapes are read now.
- **`parseEspnBox` reads a player's own defensive/return touchdowns** — the `defensive`,
  `interceptions`, `kickReturns` and `puntReturns` categories all carry a TD column and this
  parser read none of them, so in ESPN-only mode (a real Sleeper outage; preseason, when Sleeper's
  bucket is thin) a pick-six scored the man who made it nothing. **De-duplicated, not summed**:
  ESPN's `defensive` TD column is the umbrella count and `interceptions` TD is a subset of it, so
  a pick-six appears in both — `max()` credits it once, and kick/punt returns add.

### ⭐ U-F1 · A rostered player could be claimed onto a second team

`D.searchFA` keyed each candidate `espn_id || "slp_" + pid`. Only ~55% of Sleeper's directory
carries an `espn_id` (measured live 2026-08-09: 6,727 of 12,217), so for the other half this minted
a key **no roster holds** — and the `owned` exclusion, which is the only thing making that pool a
free-agent list rather than an NFL directory, missed him. `LG.faAdd`'s own "is he already owned"
scan compares KEYS, so it did not catch it either: the two strings are different. Both `searchFA`
and the Hot-pickups strip now use the expression both pollers already use —
`D.S.keyByName.get(nameKey(name, team)) || espn_id || "slp_"+pid`.

### U-S2/U-S5 · A background refresh ate what someone was typing

`UI.quietRepaint`'s non-matchup branches end in `UI.show()`, whose first act is
`dropOverlayDom()`. So `LG.db.onChange`'s ~15s background refresh **closed** an open claim sheet,
swap sheet or player card and took the half-finished work with it: a typed FAAB bid, a chosen
drop, the row being read. On Wednesday morning — the one moment of the week when everyone is
typing a bid — the odds of losing one were even. `quietRepaint` now takes the reconnect seam's own
rule (ITEM 8, 2026-08-22): **defer while `UI._overlayOpen() || lockerInteractionBusy()`**, and
drain the moment the reader closes — deferring rather than dropping is what keeps it a repaint
instead of a lost update. The trade note (`#mvTradeNote`) became session state
(`UI._tradeNote`) like the AI analyst's panel beside it, since `renderMoves` runs on every
background refresh and on every chip, sort and team tap.

### U-S3 · Three money actions with no failure path

Drop, Send offer and Add/Submit-claim all handled the ENGINE's own `{ok:false, reason}` refusals
and let an **exception** — the Firestore 12s timeout, the offline mirror's read-only throw, a CAS
exhaustion — escape as an uncaught rejection. No toast; and on the two paths that disable their
own control first, a permanently dead button ("Dropping…") that only a page reload could clear.
All three now: disable, `try`, name the failure through `failWords()` (an `offlineReadOnly`
refusal degrades to the sentence `LG.onOfflineWrite` already toasts, never a second technical
one), restore in `finally`.

### U-S4 · The Matchup header announced "Final" over a week nobody played

`!anyLive && left === 0` is **vacuously true** with zero starters. The league home's card was
given a `counted > 0` guard on 2026-08-09 and the entry recorded the Matchup page's own copy of
the expression as "KNOWN, deliberately not restaged". It is the same expression and it now takes
the same guard — which matters because between the season reset and draft day it was true of
every matchup in the league.

### ⭐ U-S6 · The ruling and the screen disagreed

Ruled 2026-08-26: the draft is Sun Sep 6 and "anyone undrafted is simply a free agent, instantly
addable, first come first served, no waiting period". Section BC6 verified the ENGINE already
behaved that way (`LG.faAdd` consults no clock). The **Moves page did not**: it decided the whole
question on `LG.now() >= LG.waiverDeadline(week)` alone, so from the draft until Wednesday Sep 9
08:00 every undrafted player was offered as a blind-bid CLAIM and the card read "Free agency
Closed" — the ruling true of the code and false on screen.

The missing half is *why* a waiver window exists: to protect an order of preference over players
who became available during the week's games. **Before the season's first kickoff nothing has
become available and there is no order to protect.** So free agency is open when EITHER the week's
deadline has passed (unchanged) OR no game of the season has kicked off yet. "The season", not
"this week" — in week 2 the board holds week 2's slate, every game of which is still `pre` on the
Tuesday, and reading only that would reopen free agency every week and delete the waiver system.
Any league week past the first means week 1 has been and gone; inside week 1 the live slate's own
kickoffs answer it; a board with no slate in memory falls back to the ordinary deadline rule
rather than declaring the season unstarted off a board nobody has read.

### Minors, UI

- **`REASON_LABEL` gained `empty-week`, `empty-matchup` and `not-final`** — three engine refusals
  with no entry, so the RAW CODE reached the screen. `empty-week` reached the family's own board
  on 2026-08-31.
- **`tradeBlockLabel` shortens the player's name**, and the add/claim toasts do too — every other
  name on screen has gone through `LG.shortName` since 2026-08-08.
- **The stale-week card stops counting a ZOMBIE as a settled week.** Routed here from Build A's
  engine work (`LG.weeklyIsVoid` / `LG.loadWeeklyDocs`): every other weekly reader goes through
  `loadWeeklyDocs`, but `staleFinalizeWeeks` built its "already have it" set from the RAW
  `UI._allWeekly` list — so the two real 0-0 docs the 2026-08-31 vacuous finalize wrote would
  have kept their own weeks off the one screen that offers the archived-stats repair. The raw
  list stays raw (its other reader, the power-rankings card, filters for itself); the SET is
  what filters now.
- **`reconnectAfterOffline` repaints Moves, Chat, Rules and the bracket** as well as the three
  views it already handled — the four screens where a reconnect matters most (a waiver run that
  landed while this device was dark, the messages it missed, a rules edit, a bracket that
  advanced) were left showing the offline mirror's copy. They route through the now-guarded
  `UI.quietRepaint`, which is safe here for exactly the reason that routine exists: it defers
  while a sheet or an upload is open instead of wiping it.
- **The Draft Day import confirms itself.** `runDraftImport` wrote its success card into
  `#importOut` and then called `UI.show("rules")`, which rebuilds `main()` and destroys that node
  in the same synchronous turn — so the most consequential action in the app (it replaces all
  eight rosters) finished by looking like nothing had happened, on every run. The confirmation is
  a toast now (a sibling of `main()`, which outlives the render) and the card is written back
  afterwards.

### Suite — new section BF, and the restages

**RESTAGED, each with its reason at the check:**
- **Section V's five week-provenance stagings (V1/V1b/V1c/V5a/V5c).** D-F1 means a mismatched
  `D.S.espnWeek` can no longer arrive over the wire at all — which is the point of the fix. The
  premise those blocks test ("the engine is holding week N while the league is on week M") is
  still real: Sleeper's own `/state/nfl` says so independently, and the board really can be a week
  behind between the rollover and the first re-targeted poll. So it is **staged directly**
  (`pinEngineWeek`) instead of manufactured by the bare payload's own `week.number`, and the five
  blocks arm `fixture.retargetSlate` so the re-targeted board is byte-identical to the one they
  always had. Nothing they ASSERT moved, and the staging is equally true against the pre-fix
  engine — which is what makes it a staging restage rather than a bent assertion.
- **`sbFix`'s `status.type` gained `completed` and `name`**, which the real payload has always
  sent and this fixture simply omitted. The omission is what made a postponement indistinguishable
  from a final here, so the app could not have been tested against the difference.
- **`sumAFix`'s `scoringPlays[].type` became the real OBJECT**, and its DAL box gained the
  defensive/interceptions/kickReturns/puntReturns groups every real ESPN summary carries. The
  defensive athlete (`999777`, D. Backer) is deliberately UNROSTERED, so the more realistic
  fixture moves not one hand-computed team total anywhere in the file.
- **AI14's `waitFnOr(/Draft imported/)` was a BARE wait** — the "a `waitFnOr` followed by nothing
  asserts NOTHING" trap this file has already recorded twice. It could not have been asserted
  before today either, because the confirmation was destroyed in the same turn it was written. It
  is a real assertion now, plus the toast.

**RESTAGED FOR BUILD A's ENGINE WORK, landing the same day.** `tools/_verify-gffl.cjs` is this
build's file, so the suite-side consequences of the concurrent `lg-core.js` batch were absorbed
here, each with its reason at the check:
- **`LG.DEFAULT_RULES.roster` caught up with the live league** — RB2/WR2 → RB3/WR3, cap 19 → 21
  (the settings doc has been RB3/WR3 since the ESPN import; the CODE default was the stale one).
  Most fixtures seed no settings doc, so they fall back to the defaults: the starting lineup is
  **eleven** slots, not nine (two checks), the Rules page's own plain-English summary reads
  "1 QB, 3 RB, 3 WR…", and the **Bench Blunder** is re-derived by hand — optimal 135.0 → **140.0**
  (top THREE RB/WR now: 25 + 50/10/8 + 15/6/3 + 5 + 2 + 9 + 7), actual unchanged at 87.0, so the
  shortfall is **53.0**. The transaction-log block also needed one spare body on team 1: after
  its waiver drop and executed trade, twelve players fill eleven slots exactly, and the veto
  trade below gives away a WR — which now leaves FLEX unfillable and made `LG.acceptTrade`
  refuse the trade whose VETO that block is about.
- **`empty-matchup`: a week is a unit.** `finalizeWeek` now refuses the WHOLE week, force and
  backfill included, when any pairing has nobody on either side. `fullSeed()` rosters teams 1
  and 2 against a FOUR-pairing schedule, so nothing built on it could finalize at all any more.
  A new `seedAllFielded()` gives the other six teams a lineup — keys and names the Sleeper
  directory has never heard of, on a team that is on no fixture slate, so every one of them
  scores a real 0, is invisible to the free-agent pool, and counts as done (a bye), leaving every
  hand-computed number and every pending-count in those sections exactly where it was. Applied
  to the finalize sections (M1, M2, the get-vs-getFresh idempotency block, the zero-floor block)
  and to `seedWeekProvenance`/`seedFor7Playoffs`. The old check "an EMPTY-roster matchup
  finalizes at 0-0, not an error" is **inverted** and split: a FIELDED pairing that simply scores
  nothing still records an honest 0-0, and one empty pairing on an otherwise ready board refuses
  the whole week by name, force included.
- **`LG.weeklyIsVoid`**: two fixtures used `matchups: []` as shorthand for "this week is
  settled" — the power-rankings card's seed and the Draft Day importer's finalized-week refusal.
  A finalized week with no matchups at all is now (correctly) VOID, so both were handed real,
  non-zero results instead.
- **D-F1's own belt reached one staging**: the playoff block set the engine to week 15 while the
  league clock still read week 1. Since the re-target that state cannot arise, and `D.gameDone`
  refuses in exactly that window — so the block moves the LEAGUE clock to week 15 too, which is
  what a real playoff week looks like.

**New fixture knobs, all default OFF** so every pre-existing section sees exactly the fixture it
always did: `retargetSlate`, `postponed`, `espnIdGap` (a third of the ROSTERED players lose their
`espn_id` — the production shape), `safetyPlay` (a safety whose own prose never says the word, so
only the object-shaped `type.abbreviation` identifies it), `dirOutOnly`.

**Section BF, 15 blocks**, each built from its finding's own repro: the re-target and its belt
(with a CONTROL proving a same-week board still decides); the empty board with FULL rosters (the
anti-vacuity half); the postponement beside a genuine final on the same board; the row with no
live line; the stop/start seam counted in timer arms; the rollover measured across the real
Tuesday boundary (bucket, players, projections URL, and the stale 10.0 gone); the directory-only
designation driven through the real locker; Washington's URL asserted **on the wire**; the five
data minors hand-computed (DAL D/ST 1 sack + 1 int + PA 14 + 1 safety = **7.0**; D. Backer
max(1,1)+1+0 = 2 TDs × 6 = **12.0**); the FA pool with zero rostered players and the All filter's
own owner tag; the deferred repaint with a typed `$37` intact and drained on close; three money
actions against a store that rejects every write; the vacuous Final with its filled-roster
CONTROL; and the ruling read at three real instants — Mon Sep 7 (Open/Add, and the add really
lands with no claim queued), Tue Sep 15 (Claim), Wed Sep 16 08:01 CT (Add).

**VERIFY**: `node tools/_verify-gffl.cjs` — **3117 pass · 0 fail** on the real tree (Build A's
`lg-core.js` in place). Proof of bite, same suite against `HEAD` copies of `lg-data.js` /
`lg-ui.js` / `league.html`: **3043 pass · 67 fail** — 65 of them inside section BF, the other
two the Draft Day import restage in AI14. The seam suite, the race kit and the season sim were
NOT run from this build (a concurrent agent held those ports).

Plates (390 px, reviewed): `plates_bf/bf_coldboot_standings_390.png` — a cold boot with no games
on the board: four UPCOMING cards, 0-0-0 across the standings, no clinch star, no Provisional
footnote. `plates_bf/bf_moves_mon_sep7_390.png` — Mon Sep 7, FREE AGENCY **Open … NOW**, the
waiver strip greyed, every button reading ADD. `plates_bf/bf_matchup_empty_390.png` — the empty
week's matchup: no "Final", no star, an empty probability track.

**KNOWN / DEFERRED**
- The **finalize half** of D-S1 and D-S6 rides on `LG.finalizeWeek`'s own game-state read
  consulting `D.gameDone` — that is a concurrent `lg-core.js` change, not this build's, so BF3
  asserts the data contract and the matchup header rather than the finalize refusal.
- `D.injuryFor`'s narrowing means a player who **gets better** while his roster snapshot still
  says Out keeps reading Out (the directory's empty value is not treated as an all-clear). That
  direction was already broken independently — `pollSleeper`'s `row.injury = meta.injury || row.injury`
  never clears a designation either — and is left for its own pass.
- `D.maybeRollWeek` clears `D.S.players` wholesale, so a rollover that lands mid-Monday-night
  (a game still running past the Tuesday boundary) drops that game's in-memory line until the next
  poll re-reads it from the new week's bucket, where it will not be. Accepted: the league's week
  has genuinely moved on, and the archived-stats backfill is the honest way to settle it.
---
