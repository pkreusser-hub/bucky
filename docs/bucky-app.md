# The Bucky family app — index.html and its sections

Everything that lives inside `index.html` (chores, bank, calendar, plan, fitness, news,
finance, activity, meals) plus the standalone family pages that share its chrome:
`weather.html`, `status.html`, `activity.html`, and the app icon/manifest.

Read this before touching `index.html`, any `netlify/functions/` endpoint those sections
call, or the shared bottom-nav / desktop-rail chrome that every page mirrors.

> Split out of the single 12,800-line `CLAUDE.md` on 2026-08-16. Entries are verbatim and in
> their original order — the oldest at the top, the newest at the bottom. Later entries
> routinely correct earlier ones, so when two disagree, the lower one wins.

---

# 🎨 UI REDESIGN — modern app shell for index.html (ACTIVE, 2026-07-09)

Total UI overhaul of the main app "to conform with best practice modern app design"
built as `redesign/index.html` (a full COPY of the live `index.html`) so it NEVER
interferes with the live files. STRATEGY = re-skin, not rewrite: index.html is
token-based (~10 CSS custom properties) and all logic (Firebase backend, render
dispatch, sheets) is reused unchanged; only tokens + shell + Home get redesigned.
Final step: flip `index.html` to the finished redesign and push (ONE push, only when
the WHOLE project is done — user: "lets finish the project before we push to live").
DESIGN DECISIONS (user): red-white-blue "Old Glory" palette; keep the name **Bucky**
with subtext "Family Farm Hub"; goat logo top-left (`/bucky.png`); LIGHT MODE default;
colors extracted from the Bucky logo — **red #ba303e, navy #233357**; vanilla + design
tokens (no framework); regroup the 9 sections into ~5 areas.
- **P1 DONE — recolor**: copied index.html → redesign/index.html, global hex swap to the
  logo palette (#0a3161→#233357, #b31942→#ba303e, etc.), asset paths made root-absolute
  (`/bucky.png`, `/assets/dadjokes.js`, `/push-client.js`, `/manifest.webmanifest`).
- **P2 DONE — navigation** (2026-07-09): replaced the top 10-icon row with a fixed
  **5-area bottom tab bar** (`#bnav`, built from `NAV_GROUPS`): Home / Tasks / Bank /
  Farm / Play. Areas map to section keys — Home→dashboard · Tasks→[chores,workorders,
  shopping] · Bank→[farmbank] · Farm→[goathooves,goatcare,print3d] · Play→[play,game,
  catgame]. Multi-section areas (Tasks, Farm) render a segmented **sub-nav** (`#subnav`,
  `renderSubnav()`) whose chips switch `currentTab`; `groupLast[gid]` remembers the last
  sub-section so re-tapping the area returns there. `groupForTab()` maps currentTab→area;
  `syncTabsUI()` now highlights the bottom bar (still touches the hidden legacy `#tabs`
  for deep-link coherence). New pseudo-tab **"play"** → `renderPlay()` = in-app menu with
  2 cards linking out to games.html + farmgpt.html. Legacy top `#tabs` and header
  `.stripes` hidden via CSS; FAB lifted above the bar; body bottom-padding clears it.
  Desktop (≥700px): bar spans full width but clusters its 5 items centered under the
  760px content column. Verified headless (Firebase/gstatic BLOCKED per goat-dup lesson)
  23/23 nav checks on 390px + desktop 1280px; 0 JS pageerrors (only file:// asset-404
  console noise, resolves on the real host). Test: scratchpad/p2_nav_test.mjs.
- **P3 DONE — personalized Home** (2026-07-09): replaced the 9-tile grid with a
  data-driven dashboard (`renderDashboard`): greeting + a **hero card** (today's chore
  progress as an SVG completion ring, celebratory when all done) + a **2×2 stat grid**
  (Bank / Goats / open Work Orders + payout badge / hooves-due, red-alert when >0) +
  a **quick-pill row** (Shopping/3D Prints/Play with live counts) + the dad joke.
  Personalized by `myName()`: a BANK_KID sees their OWN balance ("Your balance"); a
  parent sees the kids' combined savings. Cards navigate via new `goTo(tab)` (sets
  currentTab + `groupLast` so the sub-nav lands right). Data pulled live from the
  existing model (isDone/kidBalance/careAt/daysSince); nothing new persisted.
- **P4 DONE — section polish** (2026-07-09): the section views already came through the
  P1 re-skin cohesive (token-based cards), so P4 was light — added short segmented
  sub-nav labels (`SUBNAV_LABEL`: Chores/Jobs/Shopping · Goats/Care/Prints; "Work
  Orders"/"3D Prints" were truncating in the 3-up control) and removed the now-dead
  `.dash-grid`/`.dash-tile` CSS. Also added the **"Family Farm Hub" subtitle** (missing
  from the P1 copy — only the mockup had it): header title is now "Bucky" + subtitle,
  and the lock card shows "Bucky" + red-uppercase "FAMILY FARM HUB".
- **P5 — DONE + WENT LIVE** (2026-07-09): full headless sweep (Firebase/gstatic BLOCKED)
  all green — lock→unlock 6/6, P2 nav 23/23, P3 home 14/14 (parent + kid), P4 sub-nav 0
  clipped, 0 JS pageerrors on mobile 390px + desktop 1280px. Before flipping, VERIFIED
  redesign/index.html was a clean SUPERSET of the live index.html: a parallel session had
  5 uncommitted "UI FIX BATCH" fixes in index.html (compact WO cards · .sheet scroll cap ·
  expanded DEEP_LINK_TABS · goat-care blank-when-never-logged · bank privacy showKids) and
  all 5 were already present in the redesign copy (P1 `cp` was taken after that batch), so
  the flip preserved them. FLIP = `cp redesign/index.html index.html`; the redundant
  redesign/index.html was then `git rm`'d (redesign IS index.html now). Committed +
  pushed index.html + CLAUDE.md ONLY (left the parallel session's farmgpt.html/games.html/
  farmkart.html/launch.json changes untouched/uncommitted). THE UI REDESIGN IS LIVE.
  Tests in scratchpad: p2_nav_test / p3_home_test / p4_verify / p5_qa .mjs.
- **HOME REBUILD to match the approved mockup** (2026-07-09, post-launch): the P3 Home I
  first shipped (ring + 2×2 stat grid + pills) DID NOT match the polished mockup the user
  had approved (scratchpad/redesign_home.html) — user: "isn't what I see on the current home
  page." Rebuilt renderDashboard to faithfully port the mockup, wired to real data: hero
  (eyebrow date + "Morning/Afternoon/Evening, <name>" + "N chores left today" + navy progress
  ring), a 3-up stat row (💰 Bank / 🔥 Streak / 🛠 Jobs), an INTERACTIVE "Today's chores" card
  (real chores; tapping a row toggles done via setSlot → ring updates), a 2×2 bento (Farm Bank
  + this-week delta · Needs care = first goat overdue on hooves · 3D prints · Play), styled
  dad-joke card + footer. Mockup class names scoped under `.home2` to avoid colliding with the
  app's global .check/.card/.row. New :root tokens (--ink-2/--line-2/--surface-2/--navy-soft/
  --red-soft/--good*). New helpers: bankMarkup, money2, homeChoreSub, toggleHomeChore,
  weeklyBankDelta, choreStreak (honest per-person localStorage consecutive-all-done-days
  counter), dayKey. #progress hidden on Home (greeting is in the hero), restored in render()
  for other tabs. Dropped the mockup's per-chore "+$1" reward chips — no per-chore reward field
  exists (only work orders have `value`). Verified headless (Firebase blocked): 20/20 across two
  suites, card nav routes correct, interactive toggle 0/6→1/6, 0 JS errors, mobile + desktop.
  Tests: p6_home / p6_nav .mjs.
- **HOME + NAV FIX BATCH** (2026-07-09, user playtest): (1) BACK BUTTON — in-app tab
  changes now `history.pushState({buckyTab})` (goTo is the single navigator; navGroup/
  sub-nav/homeBtn/legacy-tabs all route through it, push=false when restoring); the
  existing WO-sheet popstate guard kept as branch (1), new branch (2) restores the tab
  from history.state.buckyTab so phone Back walks Home←Tasks←Bank instead of jumping out
  to the last external page (FarmGPT/Games); baseline `history.replaceState` seeded at
  boot. (2) Today's chores render ALL chores but the `.rows` list is capped to ~4 rows
  (max-height 216px, overflow-y auto). (3) Jobs stat = the LOGGED-IN user's OPEN work
  orders only (`!done && assignee===myName()`; all-open if no name). (4) 3D Prints moved
  from the Farm area to Tasks (NAV_GROUPS: tasks=[chores,workorders,shopping,print3d],
  farm=[goathooves,goatcare]); segmented sub-nav tightened (font 13px, padding 9px 3px)
  so 4 Tasks chips fit at 390px with 0 clipped. Verified headless 14/14, 0 pageerrors.
  Test: p7_fixes.mjs (injects buckyData1 to control chores/jobs/goats).
- **CHORE/BANK AUDIENCE GATING + "Open Work Orders"** (2026-07-09, user): Home "Jobs"
  stat renamed → "Open Work Orders". CHORES + FARM BANK now only show for
  `CHORE_BANK_USERS = ["Eleanor","Isaac","Dad"]` (via `seesChoreBank()`); everyone else
  (Mom, guests) gets a farm-focused Home. Gated: the hero chore RING ("bubble" top-right),
  the "Today's chores" listing, the Bank + Streak stats, the Farm Bank bento (→ "The herd"
  mini instead), the **Bank bottom-nav area** (`navGroupVisible`), and the Tasks **Chores
  chip** (`navKeyVisible`). Non-allowed stat row = Open Work Orders / Goats / Care due
  (grid-template-columns set to statDefs.length). `navGroup` skips hidden sections (Tasks
  lands on Jobs when Chores is hidden); `render()` bounces a non-allowed user off chores/
  farmbank → dashboard; nav rebuilt on profile switch (buildBottomNav+syncTabsUI added to
  the meBtn handler). NOTE the Tasks sub-nav chip for work orders stays short ("Jobs") —
  "Open Work Orders" only fits on the Home stat card (wraps to 2 lines there, fine).
  Verified headless 19/19 (Eleanor full vs Mom gated) + p7 regression 14/14, 0 pageerrors.
  Test: p8_gate.mjs.
- **HOME REWORK: lists + FarmGPT ask bar** (2026-07-09, user): removed the 2×2 bento grid
  from renderDashboard. Home is now hero + stat row + a **FarmGPT research ask bar** +
  the **Today's chores** scroll list (chore/bank users only, ~4 rows) + an **Open work
  orders** scroll list (`.rows.short`, ~3 rows, the logged-in user's open WOs sorted by due
  date; each row = 🛠 name · "Due <date>"/"Open" · $value; taps → workorders) + dad joke.
  The ask bar submits to `farmgpt.html?ask=<q>`; farmgpt.html's new `handleAskParam()` reads
  `?ask=`, opens Research (`show("research")` + `submitResearch(q)`), and `replaceState`s the
  URL clean so a refresh doesn't re-ask. New CSS `.home2 .askbar/.wo-ic/.wo-amt/.chev` +
  `.rows.short`; dead bento CSS removed; empty2 selector fixed (`.home2 .empty2`). Verified
  headless 15/15 (layout + handoff + farmgpt opens Research) + p7 14/14 + p8 19/19, 0 real
  pageerrors. Test: p9_home2.mjs (routes farmgpt.html to capture the ?ask handoff).
- **7-TAB BOTTOM NAV + WEATHER WIDGET** (2026-07-09, user): bottom bar now has 7 areas —
  Home · Tasks · **Jobs (🛠 workorders)** · **Shop (🛒 shopping)** · Bank · Farm · Play.
  Shopping + Work Orders are their OWN areas now (pulled OUT of Tasks; Tasks = [chores,
  print3d]). `groupForTab` resolves workorders→wo / shopping→shop (each in exactly one
  group). Non-allowed users (Mom) still drop Bank → 6 tabs. 7 short labels fit 390px with 0
  clipped. WEATHER: a 3-day forecast card for the farm (Woodville, AL 34.6865,-86.2104) via
  **Open-Meteo** (free, no key, CORS ok — no CSP on the site so the client fetch works):
  `wxFetch()` caches to localStorage `bucky_wx` (refetch if >3h), paints a 3-col strip
  (Today/Wkday, WMO-code→emoji via `wxIcon`, hi°/lo° °F, America/Chicago), background-refresh
  only repaints while still on dashboard. Card sits between the stat row and the ask bar,
  shown for everyone. Verified: real API returns Woodville data; headless (7 tabs, no clip,
  Tasks sub=chores/print3d, wo/shop tabs, Mom 6 tabs) + p7/p8/p9 regressions updated & green.
  Test: p10_navwx.mjs (mocks open-meteo). UPDATED to **5-day + precip %** (user): daily adds
  `precipitation_probability_max`, forecast_days=5, cache key bumped to `bucky_wx2` (old
  3-day shape ignored); each cell now day/emoji/hi°/lo°/💧%; `.wxdays` = 5 cols, tighter
  cells (emoji 21px, temps nowrap) — fits 390px with 0 clip. p10 now 19/19.
- **AUDIENCE REWORK: chores for all, Mom banks, Prints→Jobs, Shopping stat** (2026-07-09,
  user): (1) CHORES UNGATED — the chores gate is fully reversed: every user (incl. guests)
  gets the hero ring, Today's-chores card, Streak stat, and the Chores tab; `CHORE_BANK_USERS/
  seesChoreBank` → `BANK_USERS = ["Eleanor","Isaac","Dad","Mom"]` / `seesBank()` gating ONLY
  Farm Bank (bank stat, Bank nav area, farmbank bounce). (2) MOM = family (in BANK_USERS →
  sees Bank; 7 tabs). Guests (e.g. Grandma): 6 tabs, no Bank stat. (3) HOME STAT ROW is now
  universal: 💰 Bank (family) / 🔥 Streak / 🛠 Open Work Orders / 🛒 **Shopping** (open
  shopping-list items — replaces the old goat/care-due guest stats; the goat counter is GONE
  per user request; "Open Work Orders" wraps 3 lines at 4-up, acceptable). (4) 3D PRINTS
  moved from Tasks → the **Jobs** area (wo members=[workorders,print3d] → Jobs gets a
  Jobs/Prints sub-nav); the tasks area holds only chores so its bottom label was renamed
  **"Chores"**. Dead helpers weeklyBankDelta/money2 removed. Verified headless: p10 30/30
  (4-stat row + shopping count, no Chores sub-nav, Jobs sub=workorders/print3d, Mom full w/
  bank, Grandma 6 tabs + ring + no bank), p7 13/13 / p8 18/18 / p9 15/15 updated to the new
  spec. 0 pageerrors.
- **TASTE-TEST FIX BATCH** (2026-07-09, Fable design sweep of all 14 screens; shots in
  scratchpad/taste/): (1) **FarmGPT + Games shell parity** — their #buckyNav arrays updated
  to the 7-tab set (Home/Chores/Jobs/Shop/Bank/Farm/Play) with the SAME BANK_USERS gate as
  index (duplicated list — keep all three in sync); candy `.stripes` hidden on both pages;
  "← BUCKY" → "← Bucky" (games markup + farmgpt markup AND its show() fn); AND both pages'
  token blocks were still the OLD palette — completed the P1 hex swap (#0a3161→#233357,
  #07223f→#18233b, #b31942→#ba303e incl. theme-color metas). (2) Home stat values BOTTOM-
  ALIGN (.stat flex column + .v margin-top:auto) so the 4 numbers form one line despite
  wrapped labels. (3) STATUS LINE auto-tucks 4s after a healthy "live" connect (.status.tucked
  max-height:0 transition; any non-live setStatus brings it back). (4) JOBS restyle: money
  cards' full green outline → 4px left accent stripe (li.wo has NO base border — 0px top is
  correct); OPEN pill mustard → red-soft/red; Reassign/Claim/Copy/Reopen switched from bare
  .iconbtn text to a real `.wo-ghost-btn` (bordered; .claim = navy). (5) TOASTS capped at 2
  (oldest evicted) + lifetime 5s→4s. (6) PLAY TAB furnished: FarmGPT card + inline 9-game
  `.pgrid/.ptile` arcade (PLAY_GAMES const MIRRORS games.html's GAMES list — keep in sync;
  in-app games route via goTo(game/catgame)) + a "games hub" link (lobby JOIN cards live
  there). (7) farmgpt chatInput placeholder shortened ("Ask me anything…" — old one clipped),
  Send button red→navy primary; games "Pick your poison"→"Pick a game!". Verified p11 24/24 +
  p7/p8/p9/p10 all green. Test: p11_taste.mjs.
- **POLISH BATCH 2** (2026-07-09, user playtest): (1) farmgpt.html DOCUMENT SCROLL LOCK — the
  bottom `#buckyNav` (an in-flow flex child, not `position:fixed`) could be dragged up on phones
  because `html,body` had no `overflow:hidden`/`overscroll-behavior:none`; a rubber-band drag
  chained past `main`'s/`#chatScroll`'s inner scrollers up to the document itself, moving the
  whole flex column. Fixed: `html,body{overflow:hidden;overscroll-behavior:none}` + added
  `overscroll-behavior:contain` to `main`, `#chatScroll`, `#storyScroll` so each scroller stops
  the chain at its own edge instead of bubbling up. (2) Home "Today's chores" card now hides
  DONE chores and sorts the rest daily-by-time-of-day (morning→noon→night) then any weekly/
  monthly/yearly chores, then `c.order` (`visibleChores` derived from `dayChores`; hero ring
  still counts done/total across ALL of today's chores unchanged); all-done state shows the
  reused `.empty2` row "All done — go play! 🎉". (3) Stat row cards are icon-only (`.k` = just
  the emoji, 17px, no label text) with `title` + `aria-label` set to the full name (Bank/Streak/
  Open Work Orders/Shopping) for accessibility; `.v` values stay bottom-aligned. (4) Hero ring
  numerator/denominator: `.val` switched from `display:grid;place-items:center` (which stacked
  the number and `<small>/total</small>` as two grid rows) to `display:flex;align-items:baseline;
  justify-content:center` + `small{margin-left:1px}` so "3/6" reads on one baseline, still
  centered in the ring. Updated STALE test assertions: p8_gate.mjs and p10_navwx.mjs switched
  their `.home2 .stat .k` textContent checks to `.home2 .stat` `aria-label` (icon-only `.k` no
  longer carries the label text); p7_fixes.mjs seeded chores all-not-done (unchanged) and gained
  a new check that tapping a row hides it (8→7) and increments the ring (0/8→1/8); p11_taste.mjs
  needed no changes (its `.v` bottom-alignment check still holds). New suite p12_polish.mjs
  (26 checks: done-chore hiding + tod sort + all-done empty state + ring-count-unchanged, icon-
  only stats + title/aria-label + font-size + alignment, ring single-baseline overlap, farmgpt
  document-scroll-lock on home + research incl. injected tall content + internal #chatScroll
  scroll + composer visibility above the nav). Verified: p7 15/15, p8 18/18, p9 15/15, p10
  30/30, p11 24/24, p12 26/26 — 128/128, 0 pageerrors.

---

# 📅 PLAN AREA — family calendar + animal care (2026-07-19, opus agent, UNPUSHED)

8th bottom-nav area "📅 Plan" (members ['calendar','animalcare']; nav mirrored on
farmgpt/games/weather — keep all four in sync; 8 areas = 46px each at 390px, blabel
10px). CALENDAR: netlify/functions/calendar.mjs (secret-gated like farmgpt, reuses
FIREBASE_SERVICE_ACCOUNT w/ calendar scope + GOOGLE_CALENDAR_ID env; actions
status/list/create/update/delete; status.saEmail feeds the in-app setup card; Google
401/403/404 → "calendar-not-shared"; CALENDAR_BASE_URL/CAL_GOOGLE_TOKEN_URL test
overrides). index.html renderCalendar ~L4195: month/week/day views (view persisted
bucky_cal_view), localStorage cache bucky_cal_cache for instant paint, add/edit/delete
sheet #calOverlay, times America/Chicago. SETUP (Dad, one-time): share family calendar
w/ the SA email shown on the setup card ("Make changes to events") + enable Calendar API
on amen-farms-app + set GOOGLE_CALENDAR_ID in Netlify + redeploy. ANIMAL CARE:
renderAnimalCare ~L4491 — backend.getSetting/setSetting("animalCare") JSON envelope
{defaults:{mon..sun:{am,pm}}, overrides:{"YYYY-MM-DD":{am/pm}}} (sparse, 30-day prune
on save); groups Kreussers(navy)/Joy(red)/Grandparents(amber); tap chip = cycle →
override (auto-removes when equal to default, ↺ resets); #careSchedOverlay = weekly
default editor; week paging. Test hooks __CAL__/__CARE__/__NAV__. Suites (scratchpad):
cal_server_test.mjs 57/57 (fake Google; SA key never leaked asserted) +
cal_ui_test.cjs 104/104 (needs PPT env var = path to puppeteer-core; Firebase blocked).
GOTCHA the tests caught: passing a slot OBJECT as a map key stringifies to
"[object Object]" and silently reads defaults wrong — pass slot.id.
RECURRING EVENTS (2026-07-19, sonnet agent): Google-native RRULE. Function: list/get
emit seriesId (recurringEventId); create/update take event.repeat {freq DAILY|WEEKLY|
BIWEEKLY|MONTHLY|YEARLY, until} → buildRRule (WEEKLY = no BYDAY, weekday implicit;
until timed = UNTIL=...T235959Z, all-day = value-date; NONE on update = explicit
recurrence:[] clear; absent = omit/unchanged; CUSTOM never clobbers); action "get"
parses RRULE back (exotic → freq:CUSTOM read-only in UI). UI: Repeats+Ends rows in the
sheet (weekly label live-follows date), ↻ marker on instances, instance tap = This day/
Whole series scope seg (series save = get master → apply form time-of-day onto master's
ORIGINAL dates → update master id; asserted ordering), dual delete buttons. Suites now
cal_server 130 / cal_ui 154 (PPT env var). Agent correctly refused live-pane index.html
verification (production-Firestore risk) — headless route-mocked only.
HOME CAL WIDGET (2026-07-20, user): the 4-up stat row (Bank/Streak/Open WO/Shopping) is
GONE from renderDashboard — replaced by a universal clickable calendar card in its slot
(hero → calwidget → weather): "📅 <Weekday, Month D>" + up to 3 upcoming events over
today→+7d from bucky_cal_cache (Today/Tomorrow/weekday chips, time or All day, ↻ for
recurring, "+N more this week", friendly empty state — never errors), whole card →
goTo('calendar'). ONE fetch path: calFetchEvents() shared by tab + widget;
bucky_cal_cache_ts stamp; widget refresh = wxcard pattern (>10min stale → one quiet
fetch, repaint only if still on dashboard). Dead code removed w/ grep evidence
(bankMarkup/choreStreak/dayKey); seesBank/kidBalance/woIsMine KEPT (shared). Suite:
scratchpad home_calwidget_test.cjs 64/64.
CARE WIDGET (2026-07-20, user; reworked same day to a GRID): .carewidget card below
.calwidget — HORIZONTAL 7-day grid (.caregrid, 22px + repeat(7,minmax(0,1fr))):
columns = next 7 days (2-letter weekday over date, TODAY filled red + column tinted),
rows = 🌅/🌙, cells = single-letter chips K/J/G (Kreussers navy — note --green IS the
navy · Joy red · Grandparents amber; full name in title tooltip), .ov::after override
dot; tap → goTo('animalcare'). ZERO duplicated logic: resolves via the Care tab's own
careSlotValue/careGroupById/defaultCareData/loadAnimalCare; deterministic clock shared
w/ calwidget (__CAL__.setHomeNow drives both). Override date-scoping proven by rolling
the clock so the same weekday's NEXT occurrence shows the default. Test gotcha: the
override dot legitimately overhangs the chip corner ~2px — measure text clipping via
Range width, not scrollWidth. home_calwidget_test.cjs now 114/114.
FIVE-CHANGE BATCH (2026-07-20, user; opus agent): (1) calendar controls STICKY
(.cal-controls, top=--cal-sticky-top measured from header.offsetHeight per render;
IntersectionObserver sentinel toggles .stuck shadow); (2) event tap → read-only PREVIEW
sheet (#calPreviewOverlay: title/date/time/repeat-description/notes + Close/✏️ Edit —
preview fetches the series master for exact cadence wording; FAB still edits directly);
(3) nav order = Home · Plan · Chores · Jobs · Shop · Bank · Farm · Play across all 4
mirrored navs; (4) CHORE REMINDERS gated server-side in chorereminders.mjs
getAllDeviceTokens(): CHORE_REMINDER_USERS={Isaac,Eleanor} filters pushTokens docs by
their .user field (written by push-client enable(userName); untagged legacy docs also
dropped); (5) BANK-CREDIT notifications: unified notifyBankCredit(kid,amount,source,
dedupeId) — kid∈{Isaac,Eleanor} + amount>0 only — hooked into allowance mint /
WO payout / manual deposit, in-app bell via notifs_<fam> keyed to the credit's
DETERMINISTIC id (idempotent vs self-healing sweeps) + targeted FCM via pushTokens.user;
bell renderer now type-aware (bank_credit rows → Farm Bank, not lobby-invite styling).
NOTE behavior change: payout alert text unified to "💰 $X added to your bank! (Work
order: <name>)". Suites: cal_ui 197 · notif_chore_test.mjs 18 · notif_bank_test.cjs 19.
CALENDAR UX REWORK (2026-07-23, two pushed batches): ‹ › nav buttons REMOVED (Today + ↻ stay).
MONTH: phones ≤700px swap title chips for event DOTS (.cal-dots; navy timed/red all-day) w/
34px cells so the tapped day's agenda shows 3+ events with no scrolling (desktop keeps chips);
swipe left/right (attachCalSwipe: pointer-based so mouse-drag + horizontal wheel work; real
swipe suppresses the day-cell click via a capture handler) changes month. WEEK: endless feed
BOTH directions — calWeeksBefore(1)/calWeekCount(3) grow ±2 per IntersectionObserver sentinel
(CAL_WEEK_MAX 26 each way); upward prepend compensates scroll (scrollHeight delta →
window.scrollTo) so content never jumps; opening the week tab ALWAYS snaps calFocus to today
+ aligns today's sep (data-anchor) under the sticky controls (calWeekScrollPending one-shot);
labeled .cal-weeksep per week, dates on every day card; fetch range = anchor±counts weeks.
DAY: full 30-min planner grid (CAL_SLOT_H 26px × 48 slots, hour gutter labels, timed events =
positioned blocks w/ PER-CLUSTER overlap lanes, all-day chip row, red .cal-nowline on today,
auto-scroll to now−1h/first event/7AM, tap empty slot → add sheet prefilled w/ that time,
swipe changes day). EVENT SHEET: end time defaults to start and FOLLOWS it until hand-edited
(calEndTouched); start past end snaps end up; save clamps en ≥ st. openCalEventSheet gained
(ev, opts{date,start}). Hooks: __CAL__.state() adds weekCount/weeksBefore. Suite: scratchpad
cal_batch_test.mjs 30/30 (SWIPE TEST GOTCHA: pick a pointer y clamped inside BOTH the element
and the viewport — a scrolled day grid has negative box.y and off-viewport coords silently
no-op; measure scroll compensation by capturing anchor position in the SAME evaluate as the
scrollTo, before the async observer fires).
PINNING BATCH (2026-07-23, pushed): MONTH page never scrolls — `body.cal-fixed` (toggled in
render() AND renderCalendar, keyed on tab+view so it never leaks to other tabs) zeroes the
body's 156px nav-clearance padding, and the agenda card gets class `scrolly` + a JS maxHeight
clamp (space to #bnav top, then a SECOND pass subtracts any remaining
scrollHeight−innerHeight overshoot — one pass alone left 31px of scroll from below-card
margins). DAY all-day chip row = sticky at --cal-allday-top (calStickyBase + controls height,
set in a rAF at the end of renderCalendar). #subnav (ALL area sub-navs, not just Plan) is now
sticky under the header (--subnav-top set in renderSubnav) + slimmed (5px chip padding);
.cal-controls stack below it — calStickyBase (module let) = headerH + subnavH feeds the
sticky top, the stuck-shadow rootMargin, and calStickyOffset(). Suite now 36/36.
🛠 WORK ORDERS REDESIGN (2026-07-23, taste-skill pass — user: "busy and not easy to
navigate"): buildWoCard rewritten to SUMMARY-FIRST accordion — a card is one row (.wo-sum:
thumb? · title · quiet meta · $value right · chevron) until tapped; `expandedWoId` (one at a
time) opens .wo-detail (desc, byline, progress bar→milestones, photo, actions). Actions = ONE
.wo-primary (assigned: "✓ Close work order" / unassigned: "✋ Claim this job") + .wo-link text
links (Update progress·Reassign/Assign·Close·Edit; closed: Progress history·Copy to new·
Reopen·Edit). Payout-pending cards PINNED open (page's real CTA), flattened — no more
card-in-card-in-card amber nesting; .payout-confirm-btn full-width + "Not yet" link;
non-admin = read-only "waiting for Dad's OK". Killed: red OPEN pill (open = default state,
no chrome; .wo-status kept quiet navy/green for the 3D PRINTS page which shares it),
green .wo-hasvalue stripe, "Assigned:" labels (group header carries it), "Created by" own
line (→ .wo-byline in detail), .wo-ghost-btn/.wo-close-btn/.wo-progress-btn/.payout-card.
woDuePhrase() = relative dues ("overdue by 2 days" red / "due today/tomorrow/Friday" /
"due Aug 12"); woDueInfo stays (chores-tab wo-row + toast use it). woGroupHeader: sentence
case ink name + quiet "· N" count (li.group-head.wo-group-head — DOUBLE class needed, the
base group-head uppercase rule comes later in the sheet); red .wo-badge ONLY on the payout
group (alert=true 4th param). Red = overdue + payout alert only; money = --good-d.
Suite: scratchpad wo_redesign_test.mjs 34/34 (collapse/expand/one-at-a-time, relative dues,
claim persists, progress sheet + milestones, close sheet, Dad confirm clears payoutPending,
reopen, quiet headers, 0 pageerrors ×2 users).
📈 STOCK WATCHLIST (2026-07-23, dashboard bottom): a per-device watchlist card at the end of
renderDashboard (after the dad joke, before the footer). Add/remove tickers (＋ Add toggles an
inline uppercase input; ✕ removes), each row shows ticker · company name · price · daily change
colored green ▲ / red ▼ (vs prior close) + %. DATA: localStorage bucky_stocks (["AAPL",...]) +
bucky_stocks_cache {ts,q:{SYM:quote}} for instant paint; stocksRefresh() repaints-if-still-on-
dashboard when stale >60s / a symbol has no quote / forced (weather-card pattern). Quotes come
through netlify/functions/stocks.mjs — a KEYLESS server proxy to Yahoo's /v8/finance/chart/<SYM>
endpoint (no API key, no new env var — just the existing BUCKY_NOTIFY_SECRET gate; server-side
because Yahoo sends no CORS headers so a direct browser fetch like the weather widget can't
work). Per-symbol parallel fetch (the batch /v7/quote endpoint now needs a crumb+cookie),
cleanSymbol() allows only [A-Z0-9.\-^=]{1,12} (blocks path injection; permits BRK-B/^GSPC), a
bad/unknown ticker returns {ok:false} without sinking the others, ≤20 symbols, browser UA (Yahoo
rate-limits the default). STOCKS_BASE_URL env override for tests. NOT live-tested vs real Yahoo
(env egress blocks finance hosts) — after deploy spot-check a couple tickers render live. VERIFY:
node tools/_verify-stocks-server.mjs (18: parse/change-math, unknown→ok:false, dedupe+upcase,
injection/over-long reject, 20-cap, secret gate) + scratchpad stocks_client_test.mjs (14,
playwright: add/upcase/persist, ▲green/▼red, Not-found, ✕ remove, cache paints with network
down). GOTCHA: `new Response(null,{status:204})` for the CORS preflight — Node's undici rejects a
204 with even an empty-STRING body (Netlify tolerated ""); and in playwright route mocks the
catch-all `**/.netlify/functions/**` must be registered BEFORE the specific `/stocks` route
(most-recently-added handler wins).
🍽 MEALS — Mom-only calorie tracker (2026-07-22, opus agent from Fable spec, UNPUSHED):
3rd Plan-area member `mealplan` (NAV_GROUPS plan=['calendar','animalcare','mealplan'];
chip via navKeyVisible gated on seesMeals()/MEAL_USERS=["Mom"]; render() bounces non-Mom
→ dashboard; farmgpt/games/weather navs untouched — areas unchanged). Source = the user's
Weekly_GF_Meal_Plan.docx baked in verbatim as consts (1,400 cal/day GF plan, Mon–Sun day
totals 1395/1350/1390/1430/1360-Fri-cheat/1395/1355 — suite asserts recomputed sums equal
these). renderMealPlan pill nav (bucky_meal_page): TODAY (day paging, eaten/1,400 summary
bar green→amber→red, tap-row toggle, ⇄ swap / ✕ remove+undo, Add sheet = catalog + doc
quick-adds + custom name+cal, future days read-only note) · WEEK (Mon–Sun grid, tap-through)
· PROGRESS (SVG bars 30/90/all vs 1400 line, 7-day avg/days-on-plan/streak, deficit
estimate vs ~1,850 maintenance, weigh-in sheet + SVG trend vs 150→125 goal line over 20
wks) · GUIDE (full plan tables + rules + tiers + swaps + grocery). DATA: getSetting docs
mealMeta {start,startWeight,goalWeight,target} · mealLog_<YYYY-MM> month-sharded
{days:{key:{items:[{id,meal,n,c,done,add?}]}}} · mealWeight sparse map. Days materialize
LAZILY on first interaction as self-contained snapshots (viewing never writes; history
immune to template edits); ~400ms debounced saves. Day keys America/Chicago en-CA via
UTC-noon arithmetic (NOT the siblings' dateKeyLocal). Test hook __MEAL__; CSS scoped
.mealwrap. Suite: scratchpad mealplan_test.cjs 76/76, 0 pageerrors (gating incl. Dad
gateDad() prompt auto-dismiss, template sums, toggle/add/swap−70/remove, reload persist +
setting_mealLog_ key + untouched-day-writes-nothing, 2-month shard seed, mobile 390 +
desktop). TEST GOTCHA: shared browser context leaks localStorage across "fresh" pages —
use an isolated incognito context per app open.
DAD + AI CALORIE LOOKUP (2026-07-31): MEAL_USERS now ["Mom","Dad"] — MEAL_PROFILES per-user
config {target, maintenance, template, suffix, start/goalWeight}: Mom = 1400/GF-template/legacy
doc ids (unchanged live data), Dad = 2500/freeform (days start EMPTY, no quick-adds/catalog/
swap/Guide — those are the GF-plan surface; deficit note + weight goal line also Mom-only).
Per-user docs via mealDocSuffix(): Dad's are mealMeta_Dad / mealLog_<month>_Dad / mealWeight_Dad.
mealResetForUser() (renderMealPlan + every ensure*) clears caches on profile switch and FIRST
flushes pending debounced saves to the OLD user's doc ids — a timer firing after the switch
would otherwise write Mom's day into Dad's log. ✨ AI ADD (both users, Add sheet): free-text
meal description → farmgpt mode "calories" (Sonnet 5, non-streaming strict-JSON action like
storylog_*, secret-gated; usage bucket c_* + 🍽 dashboard row) → item logged already-done w/
"✨ AI" badge; not-food → ok:false gentle toast; parse-fail 502 → toast + button re-enabled.
Suites: tools/_verify-calories-server.mjs 20/20 + scratchpad meal_dad_test.cjs 35/35 (Mom
regression, Dad gating/2500/empty, doc separation both directions, AI ok/error/not-food paths).
NOT live-tested vs real Sonnet (env blocks Anthropic) — post-deploy, spot-check a couple of
real estimates for sane numbers.
🎤 VOICE LOGGING + HOME-SCREEN WIDGET (2026-07-31, same batch): (1) in-app — the Add sheet AI
row gains a 🎤 dictation button (Web Speech API, absent where unsupported; final transcript
auto-runs Estimate & add). (2) meallog.html — standalone voice quick-log page ("the widget"):
tap mic (NO auto-listen on open — user request 2026-08-02: listening only ever starts from a
mic tap; the old meallog_mic_ok auto-listen gate is removed) → speak →
mode "calories" → entry QUEUED to settings doc mealInbox<suffix> {items:[{k,meal,n,c}]}
(meal-of-day by Chicago hour; cloud via inline-duplicated Firebase config w/ 4s race, else
localStorage setting_ fallback — same keys the app's local backend reads); result screen w/
breakdown + Undo; identity = meallog_who || choreUser-if-meal-user || Dad. DELIBERATELY NO
manifest link on the page — Chrome "Add to Home screen" then makes a plain shortcut straight
to meallog.html (that shortcut IS the android widget; a true widget needs a native APK).
manifest.webmanifest gains a shortcuts entry (long-press Bucky icon → "🍽 Log a meal").
MACROS (2026-07-31, user): mode "calories" also returns protein/carbs/fat GRAMS (meal-level
+ per-item p/cb/f, clamped 0..2000, maxTokens 600→800); AI-added items store {p,cb,f} (manual/
template items don't — macro totals count only what's tracked); MEAL_PROFILES.macros = daily
targets (Mom 90/155/47g, Dad 155/280/85g ≈ 25/45/30% of cal target); Today page renders 3
.mealmacros bars (eaten g vs target, >115% = .over tint); meallog result + toast show the
macro line; inbox items carry p/cb/f through the drain. Suites now calories-server 24 ·
meal_dad 38 · meallog 37.
⭐ ADD AGAIN — recents (2026-08-01, user: re-select previously entered foods next day): the Add
sheet gains an "Add again" chip row (below the AI row, both users) — mealRecentFoods() derives
recents straight from the month shards (this + last month, mealPrevMonthKey), add:true items
only (template plan meals excluded), deduped by normalized name w/ FRESHEST calories/macros
winning, sorted last-day-desc then count-desc, cap 14, fills async (hidden when empty). Tap =
mealAdd done:true carrying ai flag + macros → counts as eaten immediately. No new storage —
works retroactively on everything already logged. Hook __MEAL__.recents(). Suite: scratchpad
meal_recent_test.cjs 18/18 (dedupe/freshest/exclusions/order/macros/Mom-template-exclusion/
suffix separation).
VOICE MODE SAGA (2026-07-31, three iterations — the SURVIVOR is one-shot): (1) tap-to-finish
(continuous=true + onend restart-until-⏹) fixed thinking-pause cutoffs but on the user's
Android each restart REPLAYED THE MIC CHIME and dropped words between sessions; (2) a raw-audio
rework (MediaRecorder → server mode calories_audio → Gemini) killed the beeps but Gemini kept
rejecting the clips ("voice estimator isn't reachable") and the user vetoed Gemini — REVERTED
(PR #7 reverts PR #6; note the Anthropic API takes NO audio input, so "Sonnet transcribes" is
impossible — transcription must be on-device or Gemini). (3) FINAL: both mics are ONE-SHOT
Web Speech — continuous=false, say the meal in one go, recognizer self-ends on the first real
pause and auto-submits (tap ⏹ = finish early, submits what was heard); NO restart loop ever
(that's the beep source). User accepts speaking without pauses. Suite fake fires
__SR_LAST__.onresult then .onend().
(3) index.html mealDrainInbox() (renderMealPlan, 60s-throttled, __MEAL__.drainInbox forces):
drains the inbox through mealAdd (template-aware — the widget page can't materialize Mom's
plan days, which is WHY it queues instead of writing mealLog directly); applied-then-cleared
so a crash duplicates rather than loses; aborts mid-drain on profile switch. Suite:
scratchpad meallog_test.cjs 25/25. TEST GOTCHA: headless Chromium exposes UNPREFIXED
window.SpeechRecognition natively — a fake must override BOTH names or the real one shadows
it and errors not-allowed. Voice quality/mic UX not testable headless — playtest on the
actual phone. (Auto-listen on open was indeed unwanted — removed 2026-08-02, see above.)

---

# 🌤️ Weather — Woodville / Amen Farms (2026-07-09)

`weather.html` — dedicated farm weather page (no API keys). Lat/lon 34.686537,
-86.210417 (727 Co Rd 80, Woodville AL).
- **Forecast:** Open-Meteo (current + 7-day daily hi/lo/precip%/WMO emoji). Friendly
  error if fetch fails — page never blank.
- **Radar:** RainViewer Weather Maps API (`api.rainviewer.com/public/weather-maps.json`)
  + Leaflet OSM basemap. Past ~2h frames (10-min steps); nowcast appended when the API
  returns any (free tier often empty). Play/Pause + scrubber; farm pin on the map.
  Attribution: RainViewer + Open-Meteo + OSM.
- **Nav:** same 7-tab `#buckyNav` as games/farmgpt (Farm tab active). Home's weather
  card is a button → `weather.html` ("Radar & 7-day →").
- Smoke: `node tools/_verify-weather.cjs` (local http-server; network for real APIs).
- **RADAR MAP + PLAY-BAR BUG FIX (2026-07-09)**: user reported the radar map "not displaying
  properly" and the play bar "not working". Root cause: the `leaflet.css` `<link>`'s SRI
  `integrity` hash was WRONG (stale/typo'd), so Chrome silently BLOCKED the stylesheet
  (SRI mismatch — no visible error without opening DevTools). Without Leaflet's CSS,
  `.leaflet-*` panes/controls lose their `position:absolute` rules and render in normal
  document flow — the zoom control block pushed/overlapped content and tile panes stacked
  incorrectly, which also silently displaced the play/scrub row so clicks landed on the wrong
  spot (looked like "the play bar isn't working" but the click handler itself was fine).
  RainViewer's tile URL scheme (`host` field from `weather-maps.json` + `frame.path` +
  `/{size}/{z}/{x}/{y}/2/1_1.png`) was already correct — not the bug. FIX: corrected the CSS
  integrity hash to `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` (recomputed via
  `openssl dgst -sha256 -binary leaflet.css | openssl base64`; the JS `<script>` hash was
  already correct, untouched). `tools/_verify-weather.cjs` hardened to catch this class of bug
  again: asserts the stylesheet actually has `cssRules` (not just that the `<link>` tag exists),
  asserts ≥1 radar `<img class="leaflet-tile">` is mounted+loaded on the map, samples a real
  RainViewer tile HTTP response for 200, and the play/pause check now waits ~1.6s and asserts
  the scrub value actually ADVANCES (previously only checked the `.playing` CSS class toggled,
  which passed even during this SRI-block regression — a false-passing test). Verified fixed vs
  real network: 0 pageerrors, radar tiles load + render, play advances frames over time, pause
  halts, scrub jumps to a chosen frame and updates `#frameTime`; desktop + 390×844 screenshots
  confirm the map, farm pin, and unobstructed play/scrub controls.
- **FUTURE RADAR: −2h → now → +2h TIMELINE w/ NOAA HRRR (2026-07-09)**: the radar animation
  used to stop at "now" (RainViewer past frames only). Extended into the future with NOAA
  HRRR simulated-reflectivity model tiles, on ONE continuous scrubber. RainViewer's own
  nowcast is intentionally NOT used for the future segment (probed live: unreliable, often 0
  frames, ≤30 min when present) — dropped entirely; the server response's `radar.nowcast`
  array is no longer read.
  - **HRRR tile source + GOTCHA**: Iowa State Mesonet (`mesonet.agron.iastate.edu`) serves
    HRRR simulated reflectivity as Leaflet-compatible XYZ tiles at
    `/cache/tile.py/1.0.0/<layer>/{z}/{x}/{y}.png`. The layer name MUST be
    `hrrr::REFD-F<mmmm>-0` — **uppercase** `REFD`, and a trailing `-0` meaning "latest
    processed run" (`hrrrLayerName()` in weather.html). The lowercase form
    `hrrr::refd-fNNNN` (what seemed obviously right and is what got probed/shipped first)
    silently returns HTTP 200 for EVERY request with a fixed baked-in "Invalid TMS Request"
    error image (always exactly 20229 bytes at every z/x/y) — a false-positive trap for any
    `r.ok`-only probe. Verified real forecast steps exist every 15 min from f0000 through at
    least f0180 (HRRR's reflectivity product goes out further; untested steps not divisible
    by 15 min, e.g. f0500, correctly 503). `probeHrrrFrames()` in weather.html gently
    sequential-probes (not a burst) offsets 15/30/45/60/75/90/105/120 min against one tile at
    a low probe zoom (z=6, `lonLatToTile()`) and only adds steps that respond 200 — with the
    corrected layer name this is now a genuine existence check, not just status-200 theater.
  - **Timeline UX**: `frames` is now `past.concat(future)` (RainViewer past + HRRR future) as
    ONE array; `nowIdx` = index of the last past frame = the "now" boundary. A custom
    `.timeline-track` overlay (`#segPast` navy solid / `#segFuture` red diagonal-striped,
    widths set by `updateTimelineTrack()`) sits BEHIND `#scrub` and a `#nowMarker` tick+"NOW"
    label sits at the boundary — required stripping ALL native range-input chrome
    (`-webkit-appearance:none` on both the input AND `::-webkit-slider-runnable-track`, custom
    `::-webkit-slider-thumb`/`::-moz-range-thumb`) because Chrome's default track pill paints
    OVER a merely-`background:transparent` override and hides the custom colors underneath —
    found by comparing a rendered screenshot against `getComputedStyle` (the gradient WAS
    applied but invisible). `#frameTime` shows past frames as today's clock time + a "Now" tag
    on the boundary frame, future frames as `+N min · FORECAST` (no clock time — HRRR run
    timestamps aren't fetched, offsets are relative to page-load time). `playStep()` needed NO
    change — it already wraps 0..frames.length-1, so play now naturally traverses the whole
    past→future timeline and loops.
  - **Farm rain line**: new `#farmRainLine` strip under the radar card, from Open-Meteo
    `minutely_15` (`forecast_minutely_15=8` = 2h of 15-min slots). First slot with
    precipitation>0 → "🌧 Rain could reach the farm around 3:15 PM"; all-zero → "☀️ No rain
    expected...". Time parsed directly from the ISO string's `T HH:MM` (Open-Meteo returns
    local wall-clock for the requested `timezone`, no offset suffix) rather than through
    `Date()`, to avoid a double timezone conversion. **Hidden entirely** (not an error message)
    on fetch failure — `el.classList.add("hidden")` + empty text, no stale content.
  - **Degradation**: HRRR probe failing → `futureFrames:0`, timeline is past-only exactly as
    before (verified — the independent node-side reachability probe in
    `tools/_verify-weather.cjs` gates which branch the test expects). RainViewer failing but
    HRRR up → future-only timeline + an inline "Live radar is unavailable... showing HRRR
    forecast only" note. Both failing → the original full radar-err message. Page never blank.
  - **Verify**: `tools/_verify-weather.cjs` rewritten with 2 browser passes — mobile (full
    suite incl. future-frame presence gated on an independent IEM reachability probe, scrub-
    into-future swaps to a real loaded `mesonet.agron.iastate.edu` tile + `#frameTime` says
    "forecast", play traverses past the `nowIdx` boundary, now-marker visible, mobile
    timeline/nav non-overlap) and desktop (screenshot + a REQUEST-INTERCEPTION-blocked
    Open-Meteo `minutely_15` route to prove the rain line hides gracefully rather than
    aborting the page — request must stay pending-not-aborted-then-inspected per the
    farmgpt camera-ring lesson doesn't apply here since it's a fetch not a navigation, plain
    `req.abort()` is fine for a fetch). Screenshots `shots/wx_future_desktop.png` +
    `shots/wx_future_mobile.png` (scrubbed to a future frame first). Verified live against
    real RainViewer + real IEM + real Open-Meteo: 21 total frames (13 past + 8 future),
    nowIdx 12, all future steps 15–120 min found, 0 pageerrors both passes.

# 💪 FITNESS — the kids' daily 10-minute workout (2026-08-02)

A new `fitness` section in `index.html` (~1,370 lines) plus a baked exercise library in
`assets/fitness/`. Isaac and Eleanor open it, tap Start, and are walked through ~9 exercises
grouped into labelled muscle blocks, each with a target and a picture of the movement, resting
between. Dad builds the week behind the PIN. Nearest precedent throughout is the Meals section.

**USER DECISIONS** (asked up front, all four load-bearing): blocks *inside* each day (full-body,
Core → Chest → Legs) rather than a weekday split · library scoped to **bodyweight + dumbbells +
bands** · **Dad-only PIN gate** on editing · a section in the main app, not its own page.

## The source data is NOT animated — and that shaped the design
`free-exercise-db` (873 exercises, **Unlicense / public domain**) ships **exactly two static
JPEGs per exercise**: the start position and the end position. There are no animations in it to
pull. The player cross-fades frame 0 ↔ frame 1 on a 900 ms loop, which is what actually reads as
the movement (Plank: kneel → plank). Verified all 873 carry exactly 2 frames, so this is uniform.
Class-toggle + CSS transition, deliberately **not** `@keyframes` — those stall under headless
Chrome (the Bistro lesson). True video would be a different, paid source.

## The bake — `node tools/_fit_build_library.mjs [--force|--dry]`
Downloads, filters, downscales, writes `assets/fitness/`. Idempotent (skips images on disk), and
**validates the default week against the baked library before writing** — a typo fails the bake
instead of shipping a broken Monday.
- **311 exercises, 622 images, 9.8 MB.** Never downloaded wholesale by a user: images are
  per-exercise and `loading="lazy"`, so a day's workout costs ~18 files.
- **WebP 600px q72** — measured against the real photos: same total bytes as JPEG/480/q76 but 25%
  more resolution. (`sharp` WORKS in this environment; the repo's "sharp is broken, use
  System.Drawing" note is stale.)
- `equipment: null` on 76 non-expert entries does **not** mean "unknown" — they are all
  genuinely no-equipment (Mountain Climbers, walking lunges, the whole stretch catalogue).
  Normalised to `"none"` and KEPT; the stretches are what a warm-up/cool-down block is built from.
  Filtering them out silently (the obvious first pass) loses staples.
- Exclusion list: both neck isometrics + the loaded-spine moves (Good Mornings, Dumbbell Clean,
  Stiff-Legged Deadlift, Hyperextensions, neck stretches) — a physio's call for unsupervised kids.
- 8 muscle groups. **The Back group's icon is 🧗, NOT 🔙** — that emoji renders as a literal
  "BACK" arrow and reads as navigation next to the picker's own "← Back" button (caught in review).

## Data model
- **Plan** = ONE shared week, settings doc `fitPlan`; `assets/fitness/default-plan.json` is the
  fallback until Dad edits. Merely viewing never writes (mealplan rule). Shape takes a per-kid key
  later without a migration.
- **Log** = per kid, month-sharded `fitLog_<Kid>_<YYYY-MM>`, 400 ms debounced. Per-day snapshots
  are the whole point: chores overwrite `doneLog` in place and keep **no history**, which is
  exactly why the old `choreStreak` needed a fragile localStorage counter and got deleted.
- **Streak is DERIVED** by walking backwards (the `mealStreak` pattern) — stateless, cloud-synced,
  same on every device. **Rest days are stepped over: never counted, never a break.** One-day
  grace so an unfinished morning doesn't read as zero. Stops honestly at an unloaded month
  (under-reports rather than inventing days).
- Day keys are the Plan-area scheme (America/Chicago, UTC-noon anchored, `fitNowOverride` test
  clock) — NOT `dateKeyLocal`. Two kids logging from two devices into one cloud doc would
  otherwise disagree about which day "today" is.

## The player
Flat step list — `block card → exercise → rest → … → finish`. **Timing reads the wall clock**,
never accumulated ticks, so a slow frame can't turn a 40-second plank into 44. A hidden tab
**PAUSES rather than fast-forwarding** — coming back to three auto-completed exercises would be a
lie about what the kid did. Quitting part-way keeps the progress but does not mark the day done
("Keep going"). Timed sets auto-advance; rep sets wait for a tap. WebAudio synth cues (3-2-1 /
go / rest / fanfare, `bucky_fit_muted`), `navigator.wakeLock`, `prefers-reduced-motion` holds
frame 0 behind a "Show movement" tap.

## Budget
`fitDuration()` is the single source of truth for both the builder's meter and the player: time
sets count their seconds, rep sets estimate `max(20, reps × 3)`, plus rest between and 5 s per
block card. Default week measures **9:16–9:51, average 9:35** (band 9:00–11:00; the meter goes
amber outside it). Rep estimates are deliberately conservative, so real elapsed runs a touch longer.

## Builder + picker (Dad only)
Edits run against a **draft deep-copy**, so Cancel really cancels. `gateDad()` always prompts, so
the call site short-circuits on `dadUnlocked()` first. Non-Dad profiles get the same sheet
read-only and are never asked for a PIN. Picker shares the one sheet overlay (swap contents +
Back) rather than stacking — a sheet on a sheet on a phone is a scroll trap. Exercises are
**grouped under muscle-group headers** with search + equipment filter. A new exercise defaults to
a timed set when the library marks it `force:"static"` or a stretch, else reps — read from the
data, not guessed per name.

## Nav
**9 bottom-nav areas now** (Home · Plan · Chores · **Fit** · Jobs · Shop · Bank · Farm · Play) —
measured at 390 px: 0 clipped labels. The section is visible to everyone (Mom/Dad build it); only
the Home card is gated on `FITNESS_USERS = ["Isaac","Eleanor"]`.

## VERIFY: `node tools/_verify-fitness.cjs [--shots]` — **113/113, 0 page errors**
Section A is pure Node (library/plan integrity, all 622 images present and non-empty, no excluded
exercise shipped, every day in band — recomputed independently rather than asking the app to grade
its own homework). B–F drive real Chrome at 390×844 + desktop. **Firebase is blocked throughout**
(`googleapis|firestore|firebase|gstatic`) — an unblocked headless run against index.html has twice
duplicated the live goat herd, and this suite exercises first-run paths.
**THREE TEST GOTCHAS worth keeping:** (1) pages in a SHARED browser context share localStorage, so
a "fresh" page inherits the previous section's saved plan and completion log — every page gets its
own `createBrowserContext()`. (2) The test clock does **not** survive a reload; re-pin before
asserting on the day you edited. (3) `pinWorkoutDay()` exists because the suite otherwise tests
whatever day it happens to run on — a Sunday run hits the rest day and reads as a pile of bugs
(this produced 5 false failures on the first pass before the real ones showed).
Shots: `shots/fit_{today,week,progress,player,rest,finish,builder,picker,home_card,desktop}.png`.

**UNPUSHED** — awaiting user preview (`main` auto-deploys). Deferred: push reminders (would clone
`chorereminders.mjs` with its own allowlist), separate plans per kid, spoken exercise names,
rep-count progression.

## FITNESS follow-up — per-kid plans + phone preview (2026-08-02, same day)

**📱 `node tools/phone-preview.mjs [fitness|<page>] [--port N]`** — serves the repo on
**0.0.0.0** so the REAL phone loads it over wifi, and prints the LAN URL. Distinct from
`mobile-preview.mjs`, which only opens a phone-SIZED desktop Chrome on this machine. A bare
word argument is treated as an in-app tab and deep-links it (`index.html#fitness`), which
matters on a phone where hunting for a tab is the whole friction. `no-store` on everything
(a stale phone cache costs more than it saves) and, on Windows, prints the one-time
`netsh advfirewall` rule — the firewall silently dropping inbound is the likely failure.
DELIBERATELY NO QR CODE: no QR dep is installed, and a hand-rolled encoder can't be verified
to actually scan from here — a wrong QR is worse than typing 18 characters.

**👧🧒 PER-KID PLANS.** `fitPlan` is still the shared family plan (unchanged doc id, so
existing saves keep working); `fitPlan_<Kid>` is an optional override. A kid with no override
follows the shared plan, so the common case stays ONE plan to maintain and Dad forks a kid off
it only when they actually need something different.
- `fitPlanOf(who)` / `fitHasOwnPlan(who)` / `fitWhose()` are the whole contract. **`fitWhose()`
  returns a kid's OWN name always** — a kid can never be pointed at a sibling's plan, and the
  selector is not rendered for them.
- **TOMBSTONES:** neither settings backend has a delete and `setSetting` MERGES, so "put this
  kid back on the shared plan" writes `{none:true}` rather than removing the doc. `fitHasOwnPlan`
  is the single place that knows this. Suite asserts the revert survives a reload — a naive
  delete would silently restore the override.
- Everything that reasons about rest days is now per-kid: `fitStreak(kid)` uses
  `fitDayOf(key, kid)`, Week ticks skip a kid whose own plan rests that day, Progress grids
  read each kid's plan. Isaac resting while Eleanor works is a legal, handled state.
- `fitDuration(day, who)` and `fitBuildSteps(day, who)` take the owner because `rest` lives on
  the plan.
- UI: a **"Plan for: Everyone / Isaac / Eleanor"** selector (parents only), a banner stating
  shared-vs-own with a one-tap fork/revert (PIN-gated), and the builder carries a `.fitscope`
  line naming the plan the save will land on. Silence there is exactly how you change
  everyone's Monday meaning to change one kid's — so it is always stated.
- The Home card always reads the kid's OWN plan (`fitDayOf(key, kid)`), never the viewer's.

**Suite: `_verify-fitness.cjs` 113 → 141 checks**, new section E2 (fork isolation both
directions, persistence, reload, tombstoned revert, kid immunity to the selector).
**TEST GOTCHA (4th of the set):** `dataset` is a `DOMStringMap` and does NOT survive
puppeteer's structured clone — it arrives as `{}`. Read `el.dataset.foo` as a STRING inside
`evaluate`, never return the map. Cost two false failures.
Shot: `shots/fit_perkid.png`.

## FITNESS follow-up 2 — the big looping demo (2026-08-02, same day)

User: *"when a kid selects an exercise to do it should show a large version of the animation
on loop so they can see exactly how to do it."* New full-screen demo overlay `#fitDemoOverlay`
(`fitOpenDemo/fitCloseDemo/fitDemoToggleFreeze`) — **z-index 70, above the player's 60**, so
form can be checked mid-set without ending the workout.

**THREE ENTRY POINTS**, all the same component: every exercise row in Today/Week is now a real
`<button class="fitrow tap">` with a 🔍 affordance and a "Show me how" aria-label · the
player's own picture is tappable (`.fitp-anim.tappable` + a "tap for a closer look" hint) ·
the picker's THUMBNAIL previews while the rest of the row still adds. That last one forced a
markup change: a button inside a button is invalid and keyboard-unreachable, so a picker entry
is now `.fitpick-row` wrapping a `.fitpick-look` button and the original `.fitpick-item` button
(`data-group` moved onto the ROW, since the suite's grouping check walks `#fitPickList > *`).

**MID-WORKOUT IT PAUSES AND RESUMES.** Opening the demo from a running workout calls
`fitTogglePause()` and latches `fitDemoResume`; closing un-pauses. The button reads "Got it —
keep going". Measured: **0ms drift over 900ms** with the demo open, and the remaining time is
intact after resuming (45s → 45s). A kid asking "how do I do this?" costs nothing.

**LAYOUT — the box hugs the photo, it does not letterbox it.** First cut gave the animation
`flex:1` and got a 362×530 container holding a 362×241 photo: huge white bands, and the picture
no bigger for it. Frames are NOT a uniform aspect (measured: 111/120 are 3:2, but **6 are
portrait 2:3** plus a couple of odd ones), so a fixed `aspect-ratio` would have letterboxed the
portrait ones instead. Fix: frame 0 is a normal block `<img>` (`max-width:100%; max-height:52vh`)
that DEFINES the box; frame 1 is absolutely positioned on top. Full-bleed via
`width:calc(100% + 28px); margin:0 -14px`. Result 390×260 on a 390px screen — **0% dead space,
51× the list thumbnail's area**. `.fitdemo-act { margin-top:auto }` parks the button at the
bottom where a thumb reaches it.

Tap the picture to FREEZE on a frame (`.frozen` kills the transition) for "hold on, what are the
arms doing?" — badge toggles "Tap to pause"/"Tap to play". `prefers-reduced-motion` opens frozen
with "Tap to play". The demo runs its OWN flip interval, independent of the player's (which is
correctly stopped while paused).

**Suite 141 → 169.** New section C2. **TEST LESSON:** the first version used `__FIT__.warp()` to
fake elapsed time while paused and "found" two bugs that did not exist — warp rewinds
`stepStart`, which is precisely what pause accounting is designed to ignore, so it was testing
the harness. Rewritten to wait REAL wall time (900ms) and assert the countdown is frozen.
Also: measure the rendered `img`, never its container — a container larger than the photo is
dead letterbox space and must not count as "large" (that assertion is what caught the
letterboxing). Shot: `shots/fit_demo.png`.

## FITNESS follow-up 3 — the kids' real plans, as circuits (2026-08-02, same day)

Dad supplied Isaac's and Eleanor's actual programmes (5 exercises × 5 days; Eleanor's is
the volleyball cut, Isaac's the general-strength one). **All 25 named exercises already
existed in the baked library — zero substitutions.** They ship as
`assets/fitness/plan-{isaac,eleanor}.json`, validated at bake time like default-plan.json.

**PER-KID DEFAULTS.** `fitEnsurePlan(who)` now falls back to `plan-<kid>.json` when no
`fitPlan_<Kid>` override doc exists, so both kids arrive on their own programme with no
setup. Precedence: **override doc > baked per-kid plan > shared plan**. The `{none:true}`
tombstone suppresses BOTH the doc and the baked file, so "use the shared plan" still means
what it says.

**THREE ADDITIONS TO THE ITEM SHAPE**, all driven by what Dad actually wrote:
- `side` ("per leg", "per arm", "each way") — the number is PER SIDE. Displays as `×8 ea`
  and **doubles the time estimate**: eight per leg is sixteen reps of work, and counting
  eight would under-read every single-leg day by half.
- `note` — his ranges and swaps ("10–12 reps", "bodyweight lunges are fine", "hold 1–2 sec
  at the top"), shown under the exercise name in place of the equipment line.
- block `label` + `focus` — days carry their own names ("Legs & Jump Power") instead of a
  generic muscle label. The Today chip is suppressed when a lone block just repeats the
  day title.

**CIRCUITS (`day.rounds`).** Dad: *"each exercise gets done twice, but in a circuit, so if
there are 5 exercises then that's 10 total sets with rests between them."* `fitBuildSteps`
runs the whole list `rounds` times with a rest between EVERY set including across the round
boundary — 5 exercises × 2 rounds = 10 sets, 9 rests. A round card ("Round 2 of 2")
replaces the per-block cards when rounds > 1 (carding both interrupts the circuit twice);
it auto-advances on the same short timer the block card always used. Builder gets a
Rounds 1/2/3 control.

**THE ARITHMETIC, because the first two answers were wrong.** Plans as written: 4:24/day.
Raising rest 20s → 30s only reached 5:04 — **five exercises is four gaps, so +10s each buys
40 seconds**; the shortfall was never in the rests, it was ~3 minutes of actual work.
Running the list twice is what fixed it: **10:52 · 9:44 · 11:08 · 9:56 · 11:28** (avg 10:33).

**BUG THE CIRCUIT EXPOSED — progress was counted as DISTINCT EXERCISE IDS.** In a circuit the
same movement comes round again, so round two credited nothing: the bar would have stalled at
50% and the finish screen would have read "5 exercises" after ten sets. Now `setsDone` /
`setsSkipped` count sets (player, progress bar, finish screen, `rec.sets`) while the id
arrays stay unique — "which exercises did you do" is the useful question in the LOG, "how
many sets" is the useful question DURING. Suite asserts both.

**Suite 169 → 230.** New E3 (both plan files: 5 days Mon–Fri, weekend off, named blocks,
per-side marks, notes preserved, Eleanor's focus lines; per-side doubling for reps AND
timed holds; the circuit's step shape; a full 10-set walk reaching 100%). Restaged, with
reasons: E2 assumed kids START on the shared plan — the premise this change reverses — so it
now unforks Isaac first and asserts isolation as "Eleanor is UNAFFECTED" rather than "Eleanor
follows the shared plan"; section C's "opens on a block card" became "opens on an intro card"
(a circuit opens on a round card). **TEST GOTCHA:** `__FIT__.start()` is async — calling
`steps()` straight after returns null.

## FITNESS follow-up 4 — a stale fork shadowed the shipped plans (2026-08-02)

User, twice: *"I don't see the new set of exercises"* / *"I logged in from kid profile and
they still have the old 9 exercises."* **The deploy was fine; the cause was data.**

At 23:35 and 23:36 Dad had tapped "Give Isaac their own plan" / "Give Eleanor their own
plan" while looking at the FIRST fitness deploy. That forked a copy of the generic
9-exercise shared week into `settings_<fam>/fitPlan_Isaac` and `_Eleanor`. Precedence is
**override doc > baked plan > shared**, so those forks shadowed the real programmes for
both kids on every device.

TWO DESIGN FAULTS, both fixed:
1. **A parent landed on the shared week by default.** `fitWhose()` returned the selector's
   value, which defaulted to `""`. Once both kids are forked the shared week is the plan
   NOBODY does — so Dad opened Fitness, saw the old generic exercises, and reasonably
   concluded the deploy had failed. `fitPlanView` is now `null` until explicitly chosen and
   `fitViewNow()` resolves that to the first kid who HAS a plan. Choosing "Everyone" still
   works and now states who is actually on it ("Isaac and Eleanor are both on their own
   plans, so nobody is doing this one").
2. **There was no way back to a shipped plan.** The revert wrote a `{none:true}` tombstone
   which suppresses the baked file too, so "use the shared plan" was the only exit and it
   led somewhere wrong. `fitEnsureBaked` now loads `plan-<kid>.json` ALONGSIDE any override,
   and when they differ the banner offers **"Reset to <Kid>'s programme"** (PIN-gated,
   confirm-gated).

DATA FIX (user-approved, both docs backed up to the session scratchpad first): the two
override docs were OVERWRITTEN with the real plans via the Firestore REST API rather than
deleted — a replace keeps Dad's future edits working exactly as before, and an empty doc is
a state the app had never run against on live data. Read back and verified: 5 exercises ×
2 rounds = 10 sets, 30s rest, correct titles, Sat/Sun rest.
GOTCHA: Firestore REST needs `integerValue` for whole numbers — send `rounds` as a double
and `rounds === 2` stops being true in the app. And PATCH was given an explicit
`updateMask.fieldPaths` covering every field so no stale key survived the replace.

**Suite 230 → 233.** New: an undecided parent lands on a kid's real plan (not the unused
shared week), and "Everyone" still selectable and self-describing.
**TEST GOTCHA that cost the most time here:** `page.click()` scrolls only minimally, so a
control at the page bottom can be left under the fixed `#bnav` and the click lands on the
nav instead — silently, with no error. Symptom was "the builder never opens" with zero page
errors and zero unhandled rejections. New `tap(page, sel)` helper scrolls it to centre
first, the way a thumb would. Also restaged: the persistence check asserted
`setting_fitPlan`, but a save now lands on `setting_fitPlan_<Kid>` since Dad defaults to a
kid's view.

## FITNESS follow-up 5 — look an exercise up while BUILDING, not just from Today (2026-08-02)

User: *"When I am adding new exercises in the Dad account, I need to be able to click in and
see the animation and description from that view, not just in the today view."* Two real
gaps: the builder's own rows had **no way in at all**, and the picker's thumbnail opened the
demo but had nothing to say so, making it undiscoverable.

`fitThumbButton(id, opts)` is now the one control for "tap the picture to see it" — used
wherever a row can't itself be a button: the builder rows hold number inputs, and a picker
row's main tap already means *add this*. It carries a **🔍 badge**, which is the whole point;
without it the picture reads as decoration. `stopPropagation` keeps a look from becoming an
add. The demo it opens is the same full-screen looping view, and from the builder it also
shows the amount that row is set to ("🦵 Legs · 10 reps · No equipment").

Also: builder rows gained `.edit`, which lets the name WRAP. With a mode chip, a number
field and a remove button on the row, "Standing Dumbbell Calf Raise" was ellipsising to
"Standing Dumbbe…" — useless when you are choosing between similar movements. Notes now
show under the name in the builder too.

**Suite 233 → 251.** New: the picker badge exists and says what it does, tapping it opens a
full-size demo WITH the description and does NOT add the exercise, every builder row is
tappable, closing returns to the builder with edits intact, and no name is clipped.
Restaged three that the kids' real plans invalidated: the Today "chips" check (a day that is
one block named after itself suppresses the chip by design — the block heading names it
instead), the Home-card title regex (it names a kid's own plan now), and the image-serving
check (measure `blob().size`, not `content-length` — the suite's own server streams chunked
and sends no such header, so that assertion had been reading `1`).

**TOOLING GOTCHA, cost real time:** patching the suite via `node -e` with backticks inside a
bash double-quoted string lets the SHELL run command substitution on the template literals.
It silently produced `/S/` where `/\S/` was meant and emptied two `ok()` messages — the
checks then passed while testing almost nothing. Use the Edit tool for anything containing
backticks.

## FITNESS follow-up 6 — one plan per person, no "everybody" (2026-08-03)

User: *"lets also get rid of the shared plan, get rid of the reset programme, and add a dad
plan. there will never be an 'everybody' plan."* The shared plan was the root of the two
bugs above — a fork copied it, a tombstone reverted to it, and a parent landed on it — so
removing it deletes that whole class of problem rather than patching it again.

**THE MODEL IS NOW FLAT.** `FITNESS_USERS = ["Isaac","Eleanor","Dad"]` — each has
`settings_<fam>/fitPlan_<Name>` for Dad's edits, falling back to the plan they ship with,
`assets/fitness/plan-<name>.json`. `fitPlanOf(who)` returns **their plan or null**; there is
no inheritance. Someone not on the list (Mom, Grandma) has no plan and gets `null` — they
can still open the tab and look at someone else's.

GONE: `default-plan.json` (the bake now deletes it), the `fitPlan` doc id, `fitForkPlan`,
`fitUnforkPlan`, `fitBakedDiffers`, `fitResetToBaked`, `fitAppendForkNote`, the `{none:true}`
tombstone semantics (a legacy one now just reads as "no saved edits"), and the "Everyone"
option. Function count 89 → 85, and the removals are exactly those five.

**NEW: `FIT_LOCKED_USERS` / `fitLocked()`** splits two ideas that `seesFitness()` was
conflating — *has a plan* vs *may choose whose plan to look at*. The kids are LOCKED to
their own (no selector, no wandering into a sibling's); everyone else gets the selector, so
Dad can build all three. Dad defaults to **his own** plan, a non-participant to the first
person who has one. `fitViewNow()` also rejects a stale saved name, so a renamed profile
can't strand the view.

**DAD'S PLAN** is a deep copy of Isaac's general-strength programme — a starting point, not
something invented for him. Flagged to the user; he can edit or replace it.

**Suite 251 → 253.** E2 was rewritten from "fork/unfork/shared" (all deleted) to the new
model: no "Everyone" option, all three have plans, someone without one gets null with
nothing to inherit, editing one person cannot touch another, no `setting_fitPlan` doc is
ever written, the builder names the person it will change, the fork/reset controls AND their
hooks are gone, kids are locked, Dad gets a Home card. Section A dropped its default-plan
validation (E3 covers the three real plans) and now asserts the shared file is NOT shipped.

**INCIDENT WORTH REMEMBERING.** Deleting the fork helpers with an index-based
`cut(startMark, endMark)` swallowed ~100 lines beyond the intended range — the entire
duration / log / streak layer (`fitItemSecs`, `fitDuration`, `fitEnsureLog`, `fitRecord`,
`fitStreak`, `fitWriteRecord`, …). The syntax check still PASSED, because deleting whole
function declarations leaves valid JavaScript; only running the suite caught it
("fitEnsurePlan is not defined"). Recovered by extracting the exact span from
`git show HEAD:index.html` rather than retyping it from memory. Two lessons: a marker-pair
cut needs its end marker verified to be the NEXT occurrence, and after any bulk deletion,
diff the defined-function list against HEAD — `node --check` will not tell you.
---

# 📰 NEWS — the family's daily feed (2026-08-03)

A `news` section in `index.html` (~430 lines) plus `netlify/functions/news.mjs`. Dad pastes a
publication's web address, the server finds its RSS feed, and every day the section shows that
morning's articles from every subscribed publication in one feed, each with a short summary
written by Sonnet 5. Everyone reads it; only Dad changes the list.

**USER DECISIONS** (asked up front, all three load-bearing): AI summaries on **Sonnet 5** (not
Haiku) · **custom URLs only**, no curated starter list · visible to everyone, **Dad-PIN-gated
editing**. Nearest precedent throughout is Fitness (Dad-edits/everyone-reads) and stocks.mjs
(the server-proxy argument).

## Why a server proxy at all
Publishers send no CORS headers on their feeds, so a browser fetch of any RSS URL fails before
it starts — the same reason `stocks.mjs` exists for Yahoo. Server-side also lets us set a real
User-Agent (several publishers 403 the default) and is the only place the Anthropic key may
live. **No new env vars**: `BUCKY_NOTIFY_SECRET` and `ANTHROPIC_API_KEY` are both already set
for FarmGPT.

## TWO CALLS, NOT ONE — the shape the timeout forced
A Netlify function has ~10s to answer and Sonnet writing forty 40-word summaries is a minute of
generation, so one combined call would time out **every single day**. Split:
- `feed` — fetch + parse only (a few seconds), returning each article with the publisher's own
  blurb already in `summary`. The client paints headlines immediately.
- `summarize` — a batch of ≤8 articles. The client fires several in parallel (3 at a time) and
  swaps each card's text as its batch lands.

Progressive by necessity, better by accident: headlines in about a second instead of a spinner.
A batch that fails costs only its own cards, which keep the publisher's blurb — the feed
degrades, it never blanks.

## Storage — two docs, and the split is deliberate
- `newsSources` — the subscription list. Small, rarely changes, Dad-edited.
- `newsDigest` — TODAY's finished articles + summaries. **ONE doc, overwritten daily**, so it
  needs no pruning (the settings backend has no delete — which is why the Fitness revert had to
  invent a `{none:true}` tombstone).

The digest is **shared, not per-device**, and that is the whole cost story: the first person to
open News today pays for one set of calls and everyone else reads what they generated;
re-opening the app costs nothing. A device paints its `localStorage` copy instantly, reconciles
against the cloud (whoever generated more recently wins), and only calls the server when the day
rolls over or the subscription list actually changes (`newsSig`). Read state is per-device
(`bucky_news_read`) — reading is personal. Day keys are the Plan-area scheme
(America/Chicago, UTC-noon anchored), matching Meals/Fitness.

## SSRF — closed properly, not trusted
The function fetches a URL a person typed. Only Dad can add one, so the threat model is mild,
but "our server will GET any address you name" is exactly the shape of an SSRF. `guardUrl`:
https/http only, no credentials, no non-standard ports, and the hostname must **resolve**
(`dns.lookup`, all addresses checked) outside private/loopback/link-local ranges —
169.254.169.254 is the cloud metadata endpoint. `NEWS_ALLOW_PRIVATE=1` is the test-harness
escape hatch and is checked **before** the port rule so a fake publisher can serve on any
loopback port.

## Discovery ladder
The URL itself if it's already a feed → `<link rel="alternate" type=".../rss+xml">` on the page
(RSS preferred over Atom) → the well-known paths (`/feed`, `/rss`, `/rss.xml`, `/feed.xml`,
`/index.xml`, `/atom.xml`, …). The feed's own title is read from **before the first `<item>`**,
or a channel with a chatty first article gets named after that article.

## THREE BUGS WORTH REMEMBERING
1. **A synchronous claim, not an `await`-then-claim.** Deep-linking to `#news` renders the
   section twice in quick succession (boot, then the navigator). With `newsBusy = true` set
   after the first `await`, both renders got past the guard — two fetches, and the second
   landed on top of the digest the first one's summaries had just been written into. The claim
   is now taken before any await.
2. **The retry floor keyed on the wrong event.** A failed fetch leaves the digest stale and
   `renderNews` auto-refreshes on a stale digest, so a floor is needed or they spin forever.
   Keying it on the last *attempt* also blocked the legitimate day-rollover refetch. It keys on
   the last **failure** (`newsLastFail`), cleared on success.
3. **Double-escaped feeds need a second decode.** A feed carrying `&amp;ndash;` inside escaped
   HTML leaves `7&ndash;2` on the card after one pass. Safe to decode twice **here** and only
   here: this text is written with `textContent`, never `innerHTML`, so there is no markup to
   smuggle back in.

## Nav
**Ten bottom-nav areas now** (Home · Plan · Chores · Fit · News · Jobs · Shop · Bank · Farm ·
Play). Ten at 390px is ~36px each, which clips a 6-character label, so a `max-width:460px` rule
tightens the bar (gap 1px, label 9.5px, no letter-spacing). Measured: 0 clipped labels.

## VERIFY: `node tools/_verify-news.cjs [--shots]` — **136/136, 0 page errors**
Section A runs `news.mjs` **in process** against a fake publisher (RSS + Atom + a homepage
advertising its feed + a quiet weekly) and a fake Anthropic — no real internet, no real
publishers, no API spend. Covers the discovery ladder, RSS/Atom/CDATA/entity parsing, the SSRF
guard both ways, per-source caps, a broken publication not sinking healthy ones, batching
(one model call per batch, Sonnet 5, prompt content), and every summariser failure mode.
Sections B–G drive real Chrome at 390×844 + desktop with the function **route-mocked**, so the
client's caching, gating and two-phase flow are what's under test.
**FIREBASE IS BLOCKED THROUGHOUT** — this suite exercises first-run paths, and an unblocked
headless run against index.html has twice duplicated the live goat herd.

**TEST GOTCHAS** (all cost real time here):
- `page.goto(BASE + "/index.html#news?n=1")` puts the query **inside the hash**, so
  `location.hash.slice(1)` is `"news?n=1"`, not a deep-link tab — boot lands on Home and
  re-highlights it *after* you navigate. Query before hash. This produced a screenshot showing
  News content under a lit-up Home button, which reads exactly like a nav bug and wasn't one.
- Navigate by **tapping the nav button**, not just by calling `goTo` — that is what catches an
  area that renders its section but never lights up.
- A mock that answers instantly means a "before" snapshot can already be the "after". Compare
  against blurbs taken from the **mock**, not read off the screen.
- Mock feed handlers keyed to fixed source ids silently hand an empty feed to a
  newly-added publication, whose id is generated at runtime.
- The suite's own `hours` is clamped (min 6), so testing the quiet-publication fallback needs a
  genuinely stale feed, not a narrow window.

**Shots**: `shots/news_{empty,feed,sources,desktop}.png`.

**UNPUSHED** — awaiting user preview (`main` auto-deploys). Deferred: a Home dashboard card
(the weather/calendar/stocks slot is the obvious home for a headline or two), per-person
subscriptions, and a "read it here" reader view instead of opening the publisher's site.

---

# ✅ CHORE ROTA · FITNESS GATE · CHROME REWORK (2026-08-03, same session as News)

Four changes asked for before the News push. `index.html` only, plus a new suite
`tools/_verify-chore-care.cjs` (**40/40**).

## 1 · The daily chores follow the animal-care rota
The daily chores ARE the animal chores, so they only belong to the kids on the days the
Kreussers are actually covering. `choreOnDuty(c)`: **morning → the 🌅 am slot; noon AND
night → the 🌙 pm slot** (there are two care slots, not three). Only DAILY chores follow the
rota — a weekly barn muck-out is ours whoever fed the goats that morning.
- **USER DECISIONS**: off-duty chores are **hidden**, not greyed ("everything a kid can see
  is something they have to do, so 'all done' means all done"); a **partial day still pays**
  — finish the slots we DO have and the $2 lands. A day with no Kreusser slot has no chores
  and no allowance.
- One quiet `.care-off` line per uncovered slot says who has them, or the missing chores
  just look like a bug. It sits **above** the frequency loop deliberately: when a whole slot
  is someone else's there are no daily chores left to hang it off, which is exactly when the
  explanation matters most (first version put it inside the loop, which `continue`d past it).
- Applied in all three places that must agree: the Chores tab, the Home hero ring
  (`dayChores`), and `allDailyChoresDone()` → the allowance.
- **Failure directions are deliberately opposite.** Until the rota loads, the chore list
  shows everything (hiding a kid's real chores is worse than showing one extra) while the
  allowance *waits* (minting is irreversible in practice — see the 4x-mint incident).
  `loadAnimalCare()` now runs at boot from `afterBackendReady`, not only when someone opens
  the Animal Care tab.

**THE BUG THIS UNCOVERED — the most ordinary family never got paid.** `loadAnimalCare`
repainted only when the fetched rota *differed* from what was in memory. The shipped default
is "Kreussers on every slot", so for a family that never overrides anything the fetch matched
byte-for-byte, `changed` was false, and nothing re-rendered — even though `careLoaded` had
just flipped false→true. Everything gated on `careLoaded` (now: the chore list, the ring, the
allowance) therefore never re-evaluated, and `ensureDailyAllowance` ran exactly once, before
the rota existed. Fixed by repainting when `changed || !wasLoaded`. Also moved that `render()`
**out of the try/catch** that wraps the settings fetch — with it inside, any error render()
threw was swallowed silently, with no page error to show for it.
Found by tracing exit reasons, not by reading: the trace read `["no-care"]`, one entry, which
is what proved it was never called again rather than called-and-refused.

## 2 · Fitness is only for the three people who use it
`navKeyVisible("fitness")` and a new `navGroupVisible("fit")` branch both gate on
`seesFitness()` (`FITNESS_USERS` = Isaac, Eleanor, Dad), and `render()` bounces a stale
`#fitness` deep-link to Home. It used to be reachable by everyone; the fitness suite's
assertion to that effect was updated rather than bent.

## 3+4 · Half-height header paying for a two-row nav
**MEASURED before and after at 390x844, because "net result of space should be equal" is a
number**: header **90 → 55px**, nav **59 → 95px**, total **149 → 150px**.
- Header: the goat logo is gone; title and subtitle sit on ONE baseline (stacking them was
  most of the height); bell 34→28px, padding 16/14→5/5, stripes 6→3px, status 12→11px.
  `#toastWrap` moved up with it (88→56px).
- `#bnav` is a **grid** now, two rows on a phone. `--bnav-cols` is set in `buildBottomNav`
  to `ceil(shown/2)` so the rows stay BALANCED however many areas that person can see —
  10 → 5+5, 9 → 5+4, 8 → 4+4 (the Bank and Fit gates change the count). Desktop keeps ONE
  row via `--bnav-all`; the two-row layout solves a phone problem.
- Buttons went **38px → 72px** wide, so the `max-width:460px` label-shrinking hack the News
  entry added for ten one-row areas was deleted. Body clearance 156 → 196px.

## VERIFY
`node tools/_verify-chore-care.cjs [--shots]` — **40/40**, 0 page errors. Section A drives the
rota (full day / Joy on nights / Grandparents all day, incl. the Home ring agreeing with the
list and the weekly chore being exempt); B drives the allowance (unfinished pays nothing, the
DEFAULT rota pays with no prompting, a no-slot day never pays, a partial day does); C measures
the chrome and walks four profiles through the Fitness gate.
Firebase blocked throughout — this suite writes chores and allowance docs.
**Test notes**: the local backend keeps every chore (allowance rows included) in ONE
`buckyData1` array, not per-chore keys; a chore is done when `donePeriod` matches today's
period key and `doneLog` fills its target; and `rota("Kreussers")` is byte-identical to the
shipped default, which is precisely what makes it the important case to test.
Regressions: news **137/137**, fitness **253/253** (one assertion updated for the new Fitness
gate). New hook `window.__CHORES__` (careLoaded/onDuty/allDone/mine/mint).
Shots: `shots/chores_offduty.png`, `shots/chrome_2row.png`.

---

# 🖥 NAV ICONS · NEWS TOPICS · DESKTOP SITE (2026-08-03, orchestrated batch: sonnet nav/news + opus desktop)

Three user asks, all in index.html. Suites: news **157/157** · chore-care **49/49** · fitness
**253/253**, 0 page errors.

## Nav
- **🌾 AI** is its own bottom-nav area (NAV_GROUPS entry with `url:"farmgpt.html"` — a group
  with `.url` navigates instead of calling navGroup, never highlights). The FarmGPT feature
  card was removed from renderPlay.
- **🍽️ Meals** is its own area (pulled out of Plan), gated by seesMeals(); using the nav
  button forces `bucky_meal_page = "today"` before render so it always lands on Today.
- 12 areas now; the two-row phone grid balances automatically via `--bnav-cols`.

## News: topics, not publication names
- Each source carries a `topic` (preset list incl. US News/World/Defense/Sports/…; default
  "News"; legacy sources without the field read "News" via `NEWS_TOPIC_DEFAULT`). Dad sets it
  per-row in the Publications sheet; saves immediately.
- Filter chips = "All" + distinct topics of the user's ENABLED publications, `flex-wrap` so
  they all fit with no scrolling. Pick persisted in `bucky_news_topic`.
- **📰 dropdown** (everyone, not Dad-gated): checkbox per publication, per-USER via
  localStorage `bucky_news_off_<name>`. Disabling hides that pub's articles and its topic chip
  when orphaned; the SHARED digest fetch is untouched (other users still need those sources).
- Hook additions: `__NEWS__.topics/topic/offIds/togglePub/setTopic`.
- TEST GOTCHA (cost the sonnet agent real time): `newPage`'s `evaluateOnNewDocument` re-seeds
  `choreUser` on EVERY navigation, silently stomping a mid-test profile switch on reload — it
  now only seeds when nothing is set. And the 📰 dropdown stays open across its own re-render,
  so a test must not "reopen" it blindly.

## Desktop website layout (≥1024px only)
- **Left rail 230px** (`buildSideNav`, rebuilt from `syncTabsUI` so the highlight can't
  drift): wordmark + vertical nav from the SAME NAV_GROUPS/gates/SUBNAV_LABEL, active-group
  child links indented. Bell/who are NOT moved — `body{padding-left:230px}` slides the
  existing header right of the rail; its title hides and `#deskCrumb` names the open section
  (so "Bucky" appears once, in the rail). `#bnav` + `#subnav` hidden, body's 196px nav
  clearance returned.
- Content `main` max-width 900px centred right of the rail.
- **Home is two-column at desktop** — the ONE DOM change: renderDashboard builds
  `.home2-main`/`.home2-rail` wrappers ONLY when `matchMedia(min-width:1024px)` matches
  (below, both names alias the flat container, so the phone DOM is byte-identical — a pure
  CSS grid over the flat list left holes because columns share rows). A matchMedia change
  listener re-renders Home at the boundary crossing only.
- 390px behaviour is sacred and asserted unchanged; the 700–1023px band keeps the old
  clustered one-row bar.
- SUITE RESTAGE OF NOTE: chore-care's old "desktop keeps a single nav row" had become
  VACUOUS (hidden buttons all report top 0 → one-entry Set) — replaced with real assertions:
  bnav hidden, rail visible with ≥10 entries, active highlight, content clear of the rail,
  crumb correct, two-column Home, rail click switches tabs, and 390px restores everything.

Shots: worktree `shots/desk_{home,news,chores,mobile_unchanged}.png`.

---

# 📈 ACTIVITY — who's using Bucky, and how much (2026-08-03, Dad-only)

User: "how users are engaging with bucky — who is using the news app and how often, who is
using story time, are games being played, meals logged." Nothing recorded who OPENED
anything, so this is a NEW telemetry path: the dashboard starts empty and fills from deploy
day. **No backfill, nothing inferred** — `TRACKING_SINCE` in activity.html is the one date to
bump if the deploy slips.

## Three parts
- **`assets/activity.js`** — the beacon, one `<script src="/assets/activity.js" defer
  data-feature="…">` on 15 family pages (NOT the editors/demos, not activity.html). Identity =
  localStorage `choreUser`, else "Unknown" — never invented. Auto-view on load; **dwell** ticks
  every 30s only while `visibilityState === "visible"` (accumulating REAL elapsed), which is
  what separates "opened" from "played". Aggregates into localStorage `bucky_act_buf`, flushes
  on pagehide / hidden / ~90s via `sendBeacon` (fetch keepalive fallback), KEEPS the buffer on
  a failed flush, caps it so it can't grow unbounded offline.
- **`netlify/functions/activity.mjs`** — `log` + `stats`, zero deps, NO NEW ENV VARS
  (BUCKY_NOTIFY_SECRET gate + FIREBASE_SERVICE_ACCOUNT, same JWT/Firestore-REST technique as
  farmgpt.mjs). ONE DOC PER USER PER MONTH in `bucky_activity`, id `<YYYY-MM>__<userSlug>`,
  counter fields `<DD>_<feature>_v` / `_m` so every write is an INCREMENT fieldTransform and
  concurrent devices converge instead of clobbering. Minutes are `doubleValue` on purpose —
  rounding a 40-second visit to 0 would systematically erase exactly the short visits that
  distinguish opened from played. `log` ALWAYS returns 200 (it's a beacon on a page someone is
  mid-use of). 6-month retention pruned on read.
- **`activity.html`** — Dad-gated (same soft posture as the API-usage page: endpoint is
  family-secret gated, UI is `isDad()` + PIN). Day bars, per-person cards (sessions / time /
  last seen / top features), and a per-feature breakdown with a bar per user. Same chrome as
  weather.html (12-area nav + desktop rail); NO nav entry is marked active — it is a Dad tool,
  not one of the family areas. Unlinked, direct-URL only, like leveleditor.html.

## Index/farmgpt get finer-grained hits
`goTo(tab)` → `app_<tab>` and farmgpt's `show(name)` → `farmgpt_<name>`, both guarded with
`window.BuckyActivity &&` so a missing or blocked beacon can never break navigation.

## VERIFY
`node tools/_verify-activity.cjs` **147/147** (Section A drives the function in-process against
a FAKE Google token + FAKE Firestore that really APPLIES the transforms, so convergence is
measured not asserted; B+ drives real Chrome with Firebase blocked).
`node tools/_verify-beacon-safety.cjs` **90/90** — the important one, because the beacon now
sits on 15 pages: each page is loaded three ways (beacon present · beacon 404 · beacon present
with its own `setItem` and `sendBeacon` THROWING) and must render the same character count and
stay error-free every time.
**TEST GOTCHAS**: (1) sabotaging `localStorage` wholesale proves NOTHING about the beacon — it
just breaks every page's own profile code; scope the throw to keys starting `bucky_act`.
(2) weather.html reports `L is not defined` under a no-external-hosts harness because Leaflet's
CDN is blocked — it appears identically with the beacon 404'd, which is how you know it isn't
yours. (3) A percentage width on an inline `<span>` does nothing: the first dashboard bars
rendered flat AND the test passed because it read `style.width` ("100%") instead of geometry —
measure `getBoundingClientRect()` against the track.
Regressions green: news 157 · chore-care 49 · fitness 253.
Shots: `shots/activity_{desktop,mobile,empty}.png`.

---

# 🩺 STATUS — the ops dashboard (2026-08-04)

`status.html` (Dad-only, unlinked/direct-URL like `activity.html`/`leveleditor.html`) answers
one question: *"everything I've signed up for or paid for that could go dark and break one of my
tools."* Server half `netlify/functions/health.mjs` (its own top-comment is the API contract —
read that first, not this). No new env vars are REQUIRED — the page works and tells the truth
with zero of the optional ones set.

**THE REGISTRY IS THREE TIERS**, rendered as three sections in this order: 💳 **paid**
(Anthropic/xAI/Gemini/Netlify/Firebase/ElevenLabs/Tripo — an account with a bill or a login) ·
🔌 **free** (Open-Meteo/RainViewer/IEM HRRR/Yahoo Finance/jsDelivr/unpkg×2/gstatic/Google
Fonts — no account, but Bucky depends on them staying up) · ⚙️ **self** (this site's own sibling
functions, pinged with a harmless malformed request — farmgpt/news/stocks/calendar/activity/
goats/notify/teachergpt-background/chorereminders). Every row carries its own `breaks[]` list
("If this dies: …") — that mapping from "this account lapsed" to "here's what a kid notices
broken" is the entire point of the page, not a nice-to-have.

**UNCONFIGURED IS A FIRST-CLASS STATE, not an error.** A paid service with no key set renders as
a grey OUTLINE dot (visually distinct from "unknown"'s grey FILLED dot) with a dashed "🔧 How to
wire it" box carrying the server's `configHint` verbatim — literally which env var to add and
where to get it. Most of the paid tier is OPTIONAL (xAI/Gemini/ElevenLabs/Tripo — Story Time and
dev-time asset generation quietly degrade without them) and the page says so in plain words
rather than painting them red. Only Anthropic/Netlify/Firebase are load-bearing.

**OPTIONAL ENV VARS Dad can add later** (none required to ship): `NETLIFY_API_TOKEN` (bandwidth
usage bar — a Personal Access Token from app.netlify.com), `ELEVENLABS_API_KEY`/`TRIPO_API_KEY`
(dev-time asset generation only — nothing shipped ever depends on these staying set),
`XAI_API_KEY` (Story Time's Grok narrator experiment — falls back to Haiku silently). Every one
of these renders its own `configHint` when absent; adding one later needs no code change, only
the Netlify env var + a redeploy.

**TWO PAID PROBES, NEITHER EVER AUTO-RUNS**: `firestore_usage` (free to call, per-collection doc
count/size table, `>= N` when a collection's walk hit its page cap — the number is a FLOOR, not
an estimate) auto-loads its CACHED result on page open (24h TTL) so Dad sees an age-stamped
number without doing anything; the "Measure storage" button forces a fresh walk.
`probe_anthropic_credit` (~1¢, one real completion) is different — it costs real money, so it
NEVER fires from a page load or a Re-check, only an explicit button click, and says so in the
UI ("This makes one tiny real request… about a penny. It never runs on its own."). A
`credit-low` result renders in its own red state naming exactly where to go
(console.anthropic.com) — the one status this page is loudest about, because it's the one that
silently breaks everything downstream first.

**CACHING**: `summary` is Firestore-cached 10 minutes (`settings_fam2jan2g/opsHealth`);
`firestore_usage` 24 hours (`settings_fam2jan2g/opsFirestoreUsage`). The client's own "↻
Re-check" button is the only thing that sends `force:true` for summary; page load always asks
for the cached copy first. A `cached:true` response still shows its real `generatedAt` age
("Checked 4 min ago (cached)") — never re-stamped to "just now".

**SECRET HYGIENE**: the function never forwards an upstream body verbatim (every probe writes
its own headline/detail from known-safe fields), and `redactSecrets()` scrubs every response
text for the literal value of every secret env var plus any Bearer token, as a backstop. The
client only ever sends the family password + an action name — it never sees a raw API key.

**HONESTY RULES the client itself follows**: a service marked `unknown` (chorereminders) shows
the server's own explanation of *why* it can't be probed (it's on a cron, not a request) rather
than just labeling it mysteriously. If the health function itself is unreachable (bad network,
non-200, unparseable body) the page shows a dedicated "Couldn't reach the health function" state
with a retry — never a blank page, never fabricated numbers. If a Re-check fails but a previous
summary is still in memory, the stale data stays on screen with a small inline note instead of
being replaced by an error.

**Layout**: same activity.html shell — 12-area two-row bottom nav / navy rail at ≥1024px, but
with NO nav entry ever marked active (this is a Dad ops tool, not one of the family's sections).
The Firestore table pans inside its own `overflow-x:auto` container so it never widens the page
on a phone (the same `.panner` convention as `activity.html`'s day chart and the API-usage page).

**Verify**: `node tools/_verify-health.cjs [--shots]` — **204/204**, 0 page errors. Sections A-N
are the pre-existing pure-Node server suite (127 checks, unchanged, in-process against realistic
fakes for every upstream). New sections O-T drive real Chrome against `status.html` with
`/.netlify/functions/health` ROUTE-MOCKED (77 checks): the Dad gate (incl. a non-Dad visitor
triggering zero fetches), dot colors/counts/breaks/configHint across an all-ok and a
warn+down+unconfigured+unknown mixed fixture, Re-check's `force:true` + repaint, the credit
probe's never-on-load/fires-on-click/credit-low-is-red contract, the Firestore table (incl. a
truncated `>= ` row and its panner), the fetch-failure retry state, and layout at 390×844 +
1280×800. Firebase blocked throughout (googleapis/firestore/firebase/gstatic) per house rule,
even though `status.html` never talks to Firestore directly itself.

**TEST GOTCHA worth keeping**: a button positioned near the bottom of a short (844px) viewport
can be brought "into view" by Puppeteer's auto-scroll while still sitting BEHIND this page's
`position:fixed` bottom nav (z-index 40) — a synthetic mouse click at that screen point lands on
the nav, not the button, and silently does nothing (no error, no page error, just zero effect).
Fixed with a `clickSafely()` helper that `scrollIntoView({block:"center"})`s before clicking —
used for every button in the suite, not just the one that first exposed it.

Shots: `shots/ops_desktop.png` (the mixed fixture — the interesting one), `shots/ops_mobile.png`,
`shots/ops_gate.png` (non-Dad).
# 📰 NEWS — summaries that say something (2026-08-04)

The user asked for 4-5 sentence summaries instead of 1-2. Doing only that would have made the
feed WORSE, silently, so three changes shipped together. Files: `netlify/functions/news.mjs`,
`index.html` (the two batching constants), `netlify/functions/farmgpt.mjs` + `farmgpt.html`
(one dashboard bucket each), `tools/_verify-news.cjs` (157 → **200** checks).

## 1 · The brief: 4-5 sentences, 80-110 words
`SUMMARY_SYSTEM` moved from "1-2 plain sentences, 25-45 words". Every other rule survives
verbatim and the suite asserts each one individually rather than trusting the diff — lead with
substance, never open with "This article", use only what you were given, neutral, family-safe
(difficult news plain rather than vivid), plain prose, strict JSON array.
**The invent-nothing rule got STRONGER, not left alone.** A model asked for 95 words from a
teaser will pad, and padding a news summary is fabrication. Three additions: the ban now names
dates, causes, reactions and outcomes and explicitly forbids filling with background the model
happens to know or with what usually happens next; **"LENGTH IS A CEILING, NOT A QUOTA"**; and
the thin-excerpt escape hatch is spelled out as the RIGHT answer rather than a failure ("write
ONE neutral sentence… do not speculate about what the rest of the article probably says in
order to reach four sentences").
LIVE, it holds. A BBC story with a 78-character teaser got 28 words; a 1,379-character Ars
piece got 79. **Summary length tracks excerpt length almost linearly** — which is the whole
design working, and it means the source data, not the prompt, is what caps most cards.

## 2 · The output cap — a hard blocker, and the old one was ALREADY too small
`max_tokens: 220 + n*90` gave 940 for a batch of 8. **Measured against real Haiku, a batch of 8
rich articles produces 995 output tokens.** It would have been cut off mid-JSON, the array would
have failed to parse, and all 8 cards would have dropped silently back to the publisher's blurb
— shorter summaries, no error, nobody notices. The identical failure that was quietly losing
story-keeper scenes at 600 tokens. Now `SUMMARY_BASE_TOKENS 300 + n * SUMMARY_TOKENS_PER_ARTICLE
250` (1,800 for a batch of 6) against a measured worst case of 689-743. Output bills for what is
produced, never for the ceiling, so the headroom is free.
**A FOURTH CAP was hiding behind it**, not in the brief and not in the plan: `s.slice(0, 400)`
on each summary as it comes off the wire, sized for the 25-45 word version. At 80-110 words a
summary runs 500-700 characters, so every long one would have lost its last sentence — mid-word,
with no error anywhere. Now 900. **When a length target moves, grep for every cap between the
model and the screen, not just the one named in the ticket.**

## 3 · Richer source text — and the honest finding
`EXCERPT_CHARS` 700 → **1800**. 700 is ~120 words; asking for a 95-word summary from that is
padding, not summarising, and it fights rule 1 directly. 1800 is ~300 words, about three times
the summary — a real compression ratio, and where the returns stop, because news writing is an
inverted pyramid and the rest is quotes and background a family digest drops anyway.
**MEASURED on five real feeds (NPR, BBC, The Verge, Science Daily, Ars Technica): excerpt lengths
run min 78 / median 306 / max 1379.** So this only bites on publications that put real text in
`content:encoded` — Ars alone had four articles between 877 and 1,379 characters that were being
cut at 700. The rest ship a teaser and there is nothing more to have. Raising the cap further
would buy nothing; **the ceiling on summary length is the publishers, not us.**
The FALLBACK card is deliberately unchanged at 220 characters and the suite pins it there: 1,800
characters of raw article body on a phone card is not a fallback, it is a wall.

## MAX_SUMMARIZE 8 → 6, measured not guessed
Netlify answers a synchronous function in ~10s. Worst case (every excerpt at the full 1800, real
Haiku): **8 articles ran 4.4 / 4.4 / 6.3s; 6 ran 3.8 / 4.0 / 4.1s** — and an ordinary run of the
OLD code was once seen at 7.5s for a batch of 8. Eight works on a good day, which is exactly the
problem: an overrun fails WHOLE and every card in it reverts silently. Six keeps ~6s of margin.
The client pays in parallelism, not time: `NEWS_SUM_CHUNK` 8 → 6 and `NEWS_SUM_PARALLEL` 3 → 4,
so 40 articles still finish in two waves. **The chunk MUST equal the server's MAX_SUMMARIZE** —
ask for more and the overflow is dropped with nothing said — so the suite now reads both files
and compares them.

## Cost — measured on both sides, and it barely moved
Same 20 real articles through `origin/main`'s news.mjs and through this one:

| | input tok | output tok | 20 articles | 40-article digest | /month |
|---|---|---|---|---|---|
| before | 3,110 | 1,216 | $0.0092 | ~$0.018 | ~$0.55 |
| **after** | **4,197** | **1,483** | **$0.0116** | **~$0.024** | **~$0.73** |

**+32%, not the ~4x a first estimate suggested** — because the excerpt raise barely moves input
when the median feed ships 306 characters, and output only rose ~30% for the same reason.
Median summary went 30 → 41 words, max 48 → 92.

## Usage logging — bucket `n`
news.mjs received `usage` from the API and threw it away, which is why the cost above could only
ever have been estimated. It now writes `n_in/n_out/n_req/n_cw/n_cr` plus the per-model
`n_claudehaiku45_*` breakdown into the same `farmgpt_usage` / `farmgpt_usage_hourly` docs as
everything else, one commit for both, in a try/catch that can never break a summary.
`getGoogleAccessToken`/`logUsage` are DUPLICATED from farmgpt.mjs — separate Netlify functions
with no shared module, the same house convention that duplicates the Firebase config on every
page. Dashboard: `"n"` added to farmgpt.mjs's `USAGE_BUCKETS` and a 📰 **News summaries** row to
farmgpt.html's `BUCKETS`, priced at Haiku. The summarize response also returns `usage:{in,out}`,
which is what made the table above measurable. Bucket letters now in use: **s u r d k a g c l x
t f n**.

## Verified
`_verify-news.cjs` **200/200**, 0 page errors — the 157 that existed all still green, +43 in two
new sections. **A2** covers the length target, the old target's absence, all seven surviving
guardrails one at a time, the three strengthened rules, a full batch at the top of the band
fitting under the cap WITH headroom, an explicit tripwire that the old formula could not have
carried it, a 574-character summary surviving whole down to its last sentence, a full-text
article reaching the summariser past the old 700-char cut and still clamping at 1800, the
fallback card still short, and the client/server batch sizes matching. **A3** stands up a
throwaway RSA service account and fake Google token + Firestore endpoints and proves the commit:
both docs, both field shapes, the real token count, authenticated — plus the backend down and
the summaries still arriving. New fixtures: a `/long.xml` publication with its real body in
`content:encoded`, and an Anthropic `long` mode returning a genuine 4-5 sentence summary.
The browser mock's three summaries were LENGTHENED to real 85-100 word ones, because the
screenshots are the density review and reviewing placeholder strings would review the wrong
thing. LIVE: `scratchpad/news_live.mjs` + `news_worst.mjs` (real feeds, real Haiku, through the
real handler). Regressions: fitness **253/253**, storyledger **683/683**.
Shots: `shots/news_long_390.png` + `news_long_390_full.png`.

## DENSITY — flagged, not silently shipped
Measured at 390×844: cards **247 / 228 / 208px** where they were ~120, so **2.5 cards on screen
instead of ~5**, and a 40-article digest is roughly 9,000px of scroll. Each card reads well — 8
lines, not a wall — and a whole card still fits on screen (asserted). But **headline scanning got
harder**: you can no longer see four headlines at once. If that turns out to bother the family,
the fix is a `-webkit-line-clamp: 4` on `.newsc-sum` with a "more" affordance — and it needs a
design decision first, because the card is already a button that opens the article, so "more"
would have to be its own tap target rather than a tap on the card.

**KNOWN**: the model occasionally omits one article from a batch (19 of 20 summarised in two
consecutive live runs) — that card keeps the publisher's blurb, and it is PRE-EXISTING, not a
side effect of the longer format: `origin/main`'s code scored the identical 19 of 20 on the same
feeds. Two near-duplicate wire stories in one batch is the usual cause.

---

# 📈 FINANCE TAB + 🔔 EVENT NOTIFICATIONS (2026-08-09)

## Finance — one nav area, three faces
The money area now holds TWO sections and resolves per viewer, so nobody sees a tab they
can't use:
- **Kids (Isaac, Eleanor)** → 💰 **Bank** (Farm Bank only, as before).
- **Everyone else** (Mom, guests) → 📈 **Finance**.
- **Dad** → both, via the existing segmented sub-nav.
`BANK_USERS` dropped **Mom** — the user's explicit ruling ("kids get Bank, everyone else
Finance, Dad both"), flagged at the time as a real removal rather than a guess.
`seesFinance()` is EXCLUSION-based (everyone not in `BANK_KIDS`) so a new family member gets
Finance without editing a list. The per-viewer label/icon/href lives in
`navAreaLabel`/`navAreaEmoji`/`navAreaIconPath`, used by BOTH `buildBottomNav` and
`buildSideNav` — and duplicated into the five mirrored navs (farmgpt/games/weather/activity/
status), which would otherwise have left Mom tapping a Bank link that bounces her.

## Watchlists are PER ACCOUNT (user's call, better than either option offered)
`stockWatch_<Name>` settings doc + `bucky_stocks_<Name>` instant-paint cache — the
`fitPlan_<Name>` precedent exactly. One-time non-destructive migration seeds a person's list
from the legacy per-device `bucky_stocks` (never deleted). The Home card shows the LOGGED-IN
person's list, so switching profiles switches the card.

## stocks.mjs gained two actions (quote is byte-identical — the Home card depends on it)
- `series` — `range=3mo&interval=1d` per symbol in parallel; day/week/month derived from the
  closes (1/5/21 back). Yahoo embeds NULLs in `close[]`: pair timestamps to closes BY INDEX
  before filtering, never filter-then-zip. A series too short for the window is flagged
  `partial:true` and labelled "since <date>" rather than presenting a fake month.
  Markets strip = ^GSPC, ^DJI, CL=F (the existing `cleanSymbol` already permits ^ and =).
- `analyze` — one Haiku call, 15-min warm cache.
  **THE SYSTEM PROMPT IS A SAFETY SURFACE.** Descriptive and educational ONLY: what the
  company is, what the numbers show, general context. Explicitly forbids buy/sell/hold,
  price targets, forecasts, and "good/bad investment", with a fallback line telling the
  reader Bucky doesn't give investment advice; it is given only the numbers and has no news
  access, so it must not invent events. The suite GREPS THE CAPTURED REQUEST BODY for that
  language — a real check, not a cosmetic one. The UI renders a permanent disclaimer under
  every analysis state (loading, success, failure).

## Plan → event notifications
A 🔔 **Notify** section in the event sheet: a checkbox per roster member; ticked people get
an in-app bell notif, a push, AND an email — reusing `addNotif`/`liveNotify`,
`BuckyPush.notify`, and the EmailJS `sendEmail()` that already existed. Members with no
address show "in-app only — no email on file" so the sender isn't misled.
**The checkboxes are an ACTION, not stored state** — they reset unchecked every time the
sheet opens, so editing an event can never silently re-spam anyone; telling someone later is
a deliberate re-tick. The creator is never self-notified. Sends are individually wrapped and
happen AFTER the save: a failing email can never cost you the event (asserted by making one
recipient's send reject and checking the event and the other sends survived).
Recurring events notify ONCE at creation and name the cadence.
KNOWN: the "Told Mom, Isaac on Aug 6" record is per-device localStorage, because the record
would otherwise need a field on the Google Calendar event that `calendar.mjs` doesn't carry.

## Verify — 1,111 checks, nine suites
finance 87 · calnotify 85 · stocks-server 89 · chore-care 50 · news 200 · fitness 249 ·
activity 147 · health 208 · beacon-safety 96.
**FITNESS COUNT VARIES BY WEEKDAY** (249 today, 253 on a Monday) — conditional checks, not
missing assertions; confirm with `grep -c "  ok("` against HEAD before chasing it.
Also fixed a stale, PRE-EXISTING `_verify-health.cjs` failure (hardcoded "12 areas" vs the
13 the array now holds) — now property-based.
Shots: `shots/fin_*.png`, `shots/cal_notify.png`.

## 🐐 THE GOAT MARK: a new app icon, and the app stops shouting its own name (2026-08-10)

User supplied a green goat-head silhouette and asked for it as the Bucky logo, plus *"the app
subtitle to be 'Bucky' instead of 'BUCKY'"*. Files: NEW `assets/bucky-logo-source.jpg` (the
user's own artwork — commit-safe, same standing as the GFFL crest) · NEW `tools/_bucky_icons.cjs`
(the bake, replacing `tools/gen-icons.js`) · `bucky.png` + `icons/{icon,maskable}-{192,512}.png`
· `manifest.webmanifest` · every page's `<title>` · `firebase-messaging-sw.js`.

**ONE BAKE FEEDS EVERY LOGO SURFACE.** `bucky.png` is the favicon AND the apple-touch icon on all
~20 pages AND the lock screen's own `<img>`; `icons/icon-192` is also the push-notification icon
in `firebase-messaging-sw.js`. So regenerating those five files re-skins the whole app — no page
needed editing. `node tools/_bucky_icons.cjs [--check]` is idempotent and **asserts before it
ships**: exact dimensions, corners exactly cream (an installed tile must be opaque edge to edge),
the mark actually landed, its height is the intended fraction, it is centred, and — measured, not
eyeballed — a maskable's half-diagonal fits inside the 40%-radius safe circle, because "it looks
like it fits" is how horns get clipped. 30/30.

**THE FLOOD FILL IS BORROWED FROM THE GFFL CREST, INVERTED.** Keying "every light pixel"
transparent works for a silhouette right up until the art has an ENCLOSED light region (here the
notch under the ear, and the gap the beard cuts into the neck). Only light reachable from the
BORDER is paper. Ramp on the pixel's MAX channel (paper ~254, ink ~66), feathered across the
JPEG's anti-aliased edge or the mark comes out jagged.
Mark height 0.76 of the tile for `any`, **0.62 for maskable** (the launcher may crop to a circle).
Flat two-colour art palettises with no visible loss: **bucky.png 63 → 8.4 KB, icon-512 212 → 24 KB**.

**`tools/gen-icons.js` DELETED, not left lying around** — it upscaled the 256px `bucky.png` into a
512 icon, so re-running it after this batch would silently DEGRADE the icon set, and it never knew
about maskables. The new baker owns all five outputs from the 1408px source. `icons/gffl-*` is
untouched and asserted so — that is the LEAGUE's crest and only `league.webmanifest` points at it.

**"BUCKY" → "Bucky"** on the label surfaces: `manifest.webmanifest` name + short_name (the label
under the installed icon — the "subtitle" the user meant), every page's `<title>`, and the two
system-notification titles. **Deliberately NOT changed: stored DATA** — `by: "BUCKY"` on bank
ledger rows and `from: "BUCKY"` on notification docs are values already written across the
family's live Firestore, and new rows disagreeing with every historical row is worse than a shouty
string. Email CTA prose ("View in BUCKY") left alone too.
**A STALE MANIFEST FIXED WHILE IN THERE, and it was load-bearing**: `background_color` was still
the pre-re-skin `#eef2fa` and `theme_color` the old navy `#0a3161`, while index.html's own
`theme-color` meta has read `#3f5c46` since the re-skin. The splash screen composites the icon on
`background_color`, so a cream icon on a pale-blue splash shows a visible square — the new icon
needs `#f4f1e8` to sit seamlessly.

**VERIFY**: `node tools/_bucky_icons.cjs --check` (30) + the plate script in the session scratchpad
(11: the lock screen really shows /bucky.png decoded at 256², the tab title, the manifest as a
browser parses it, all five icons 200, and every launcher size rendering). Regressions green:
beacon-safety **96/96** (loads every page whose title changed) · chore-care **50/50** · news
**200/200** · activity **147/147**.
**TEST GOTCHA worth keeping**: a plate built with `page.setContent` on `about:blank` has a **null
origin**, and Chrome's private-network rules refuse a null-origin request to **loopback** — every
icon silently failed to load (`naturalWidth` 0) with only a console line to say why. Serve the
plate from the same origin (a `/__tiles` route on the suite's own server) instead.
Shots: `shots/bucky_logo_lock_390.png`, `shots/bucky_logo_tiles.png`.

---

## 📅 PLAN ALWAYS OPENS ON THE MONTH, ON TODAY (2026-08-10)

User: *"when opening plan in bucky, it should always default to the month view with the current
day selected. clicking week should always have the current day at the top of the screen."*
Files: `index.html` + NEW `tools/_verify-calview.cjs` (**25/25**, 0 page errors).

**THE VIEW IS NO LONGER PERSISTED.** `calView` used to initialise from
`localStorage["bucky_cal_view"]` and `calSetView` wrote it back, so Plan reopened on whatever
view you last used. The key is gone in both directions — with every entry forcing the month,
persisting it could only ever have described state nothing reads. `calView` initialises to
`"month"`, which also covers a cold page load / `#calendar` deep link with no extra code.

**THE RESET LIVES IN `goTo()`, AND THAT SEAM IS THE WHOLE DESIGN.** The calendar is reached six
ways — the bottom-nav button, the Home calendar widget, an event notification, the Plan sub-nav
chip, a `#calendar` link, and Back — and `goTo` is the one seam all six share (the Meals
precedent puts its equivalent in `navGroup`, which only the nav button runs through). **`render()`
is deliberately NOT a seam**: it also runs on every calendar data refresh, so resetting there
would yank a reader out of the month they were browsing the moment events arrived. `goTo` fires
only on real navigation. Unconditional (not gated on the tab CHANGING), so tapping Plan while
already on it means "back to today" — the same call the GFFL Matchup tab makes.
New helpers: `calAimAtToday()` (point every view at today + arm each view's one-shot scroll) and
`calResetToToday()` (month + aim), with `calGoToday()` rewritten onto the first.

**THE WEEK CHIP ANCHORS TODAY'S OWN CARD, NOT THE WEEK.** The one-shot alignment used to scroll
the week SEPARATOR under the sticky controls, which is only "today at the top" on a Sunday —
measured on a Monday it left today **328px** down with Sunday's card in the way; it is now
**216px**, directly under controls that end at 210. Today's card carries `data-today-anchor`;
`calWeekAnchorToday` decides which anchor the one-shot uses, because **paging to another week has
no today to show** and correctly keeps the separator.
Month and Day chips deliberately KEEP the date you were browsing — only entering the tab, or
Today, moves the anchor. Forcing today there would have broken the Day chip's existing behaviour
of following `calFocus`, which is outside what was asked for.

**VERIFIED PRE-FIX**, index.html stashed back to HEAD and the same suite re-run: **16/25**, and
all 9 failures are on-point — *"coming back through the nav is the month again (got week)"* is
the report verbatim. **A first cut of the week checks was weak evidence** and was rewritten: they
selected today's card by this change's OWN `data-today-anchor`, so pre-fix they failed merely
because the attribute did not exist. They now measure via `.cal-daycard.today` — the class the
feed has always carried — so the pre-fix run reports the real old position (328px) instead of
`NaN`. NOTE the "within 40% of the viewport" bound is DATE-DEPENDENT and passes pre-fix on a
Monday; the date-independent assertion is *"today's card is the FIRST one below the controls"*,
which fails pre-fix on any day.
**TWO TEST GOTCHAS, both self-inflicted, both worth keeping**: index.html's script is
`type="module"`, so `window.goToCalendar` is `undefined` and calling an app function off `window`
reads as "the click did nothing" — drive the real controls (the suite clicks the Home widget and
the sub-nav chip). And weeks start SUNDAY, so on a Monday the week label tucks *behind* the
sticky controls rather than scrolling off the document — an assertion of `top < 0` encodes a
wrong mental model; ask "is any other day's card above today's, in view?" instead.
Regressions green: calnotify **117** · chore-care **50** · news **200** · activity **147** ·
fitness **253** · finance **117**.
Shots: `shots/cal_open_month_390.png`, `cal_week_today_390.png`, `cal_week_today_desktop.png`.

## 🔎 THE CALENDAR COULD NOT SAY WHY IT FAILED (2026-08-10)

User: *"bucky plan is giving me an error when editing a calendar event saying it cant be reached
right now."* The live site is egress-blocked from the agent sandbox (403 through the proxy), so
the root cause could not be observed — **what shipped is the fix for why it was unobservable**,
plus three real defects found on the way. Files: `netlify/functions/calendar.mjs` · `index.html` ·
NEW `tools/_verify-calendar-errors.mjs` (**21/21**).

**FIRST, THE MAPPING** (scratchpad `caldiag.cjs` — drives the real page's edit flow against a
mocked function failing each way, and prints what the family actually sees). Worth keeping,
because the report was ambiguous between two messages that mean very different things:

| what the family sees | what it means |
|---|---|
| toast *"Couldn't reach the calendar — try again"* | the function reached Google and Google refused (`google-error`) |
| banner *"Can't reach the calendar right now"* | the `status`/`list` call itself failed — a dead network or a non-500/502 HTTP status |
| *"The family calendar isn't shared…"* | Google 401/403/404 |
| *"Couldn't save — check your connection"* | the function 500/502'd, or the fetch threw |

**THE REAL DEFECT: THE FAILURE WAS UNDIAGNOSABLE BY DESIGN.** `classifyGoogleError` collapsed
every non-auth Google refusal to a bare `{error:"google-error"}`, and the handler's catch-all did
the same **for a thrown exception in our own code** — with **no logging anywhere**, so a genuine
bug and a Google 400 were indistinguishable and neither left a trace. Now: Google's own one-line
reason (`invalid: Invalid recurrence rule`, `rateLimitExceeded: …`) rides back as `detail` and is
`console.error`'d into the Netlify function log; a thrown error is `server-bug` with its message,
logged with its stack, and named as OURS rather than Google's. **Secret hygiene is asserted, not
assumed** — the token rides in a request header and is never echoed, and the suite greps every
response and log line for the SA key, the access token and the calendar id.

**THREE MORE, all real:**
1. **A `google-error` on the LIST call rendered NOTHING.** `renderCalendar` named `network`,
   `server`, `calendar-not-shared` and `not-configured`; anything else matched no branch, so the
   tab painted stale cached events as if all was well. Any unhandled `calError` now gets a banner.
2. **A 404 on an EVENT was reported as "the family calendar isn't shared with Bucky yet".**
   `classifyGoogleError` is calendar-scoped by origin, but get/update/delete are EVENT-scoped —
   a 404 there means that event is gone (deleted elsewhere), which sent the family to a setup
   page for something setup cannot fix. `scope` is now a parameter; 404/410 on an event →
   `event-gone` ("that event isn't on the calendar any more"), while 401/403 still means sharing
   on either scope and a 404 LISTING still means the calendar.
3. **The HTTP status was thrown away.** "Couldn't reach the calendar" covered a dead network, a
   504 timeout and a 401 alike. `calPost` now carries `e.status` and every message shows it, so a
   family member can read back *"(HTTP 504)"* — which is the one fact that would have settled
   this report on its own.

**VERIFY**: `node tools/_verify-calendar-errors.mjs` — 21 checks, running the REAL handler in
process against a fake Google (its own `CAL_GOOGLE_TOKEN_URL`/`CALENDAR_BASE_URL` overrides) and a
throwaway generated RSA service account, so nothing touches the family's calendar. Covers the
reason passing through + being logged, event-404 vs calendar-404, 401/403 on both scopes, a 429
naming itself, a thrown error as `server-bug`, the no-leak greps, and the healthy path unchanged.
**TEST GOTCHA**: forcing a throw is harder than it looks — `JSON.stringify` never calls a throwing
`toString` (a bad id serialises to `{}`), and dropping the socket server-side leaves undici hanging
until the suite times out. A title that is a NUMBER is the clean one: `(ev.title || "").slice()` is
a TypeError before Google is ever called.
Regressions: calnotify **117** · calview **25** · chore-care **50** · news **200** · activity **147**.
**STILL OPEN**: the live cause. Post-deploy the message names itself, and the Netlify function log
now carries a `[calendar]` line for every failure.

## 🪪 IDENTITY, PHASE 1: NAMES STOPPED BEING PERMISSIONS (2026-08-30)

Every feature gate in this app was a literal string comparison against a family member's
CURRENT display name — `BANK_ADMIN = "Dad"`, `BANK_KIDS = ["Isaac","Eleanor"]`,
`FITNESS_USERS`, `isDadName()`, and eight more like them. That worked exactly until someone
got renamed, and it meant "who can do X" lived scattered across a dozen constants instead of
one place. Contract: **docs/identity.md**. Files: `index.html` · `push-client.js` ·
`sports.html` · `netlify/functions/eventreminders.mjs` · NEW `tools/_verify-identity.cjs`
(**169/169**) · extended `tools/_verify-eventreminders.mjs` (**62 → 68**).

**THE THREE LAYERS.** Identity (`pid` — a name slugged at migration time, then frozen forever;
`role` — parent/kid/extended/guest, assigned once) → Authorization (`can(capability)`, resolved
from role plus per-profile `grant`/`deny` overrides) → Preference (unbuilt this phase). Every
old name-gate became a capability: `seesFinance`, `kidBank`, `seesFit`, `fitLocked`,
`seesMeals`, `seesChores`, `bankAdminUI`, `approvePayouts`. **`bankAdminUI` is one flag doing
five jobs** — old `isDadName()` gated fitness editing, news-publication editing, the
roster-edit PIN trigger, the boot auto-unlock prompt, AND the 3D-print-request admin alert, all
off the same name check, so they now share the same capability rather than five near-identical
new ones granted to the same single profile.

**MIGRATION IS MERGE-ONLY AND RUNS FOREVER.** `migrateIdentity()` walks every profile doc on
each authoritative (non-cached) data load and fills in `pid`/`role`/(Dad's) `grant` ONLY when
absent — never overwrites an existing value, even when a profile's current name no longer
matches its pid's slug (that's what a rename looks like, and it's supposed to happen). This
also means a family that adds a NEW member six months from now gets it minted the same way, no
redeploy required.

**THE FALLBACK THAT MADE THIS SAFE TO SHIP: A NAME WITH NO PROFILE DOC STILL RESOLVES.**
`resolveProfile()`/`me()` fall back to `syntheticProfile(name)` — the exact role + grants
migration WOULD assign, computed on the fly from the same seed maps — whenever a name doesn't
match any real profile doc. Without this, every existing suite that only ever sets `choreUser`
in localStorage (no profile doc, because the old code never needed one) broke outright:
`can()` had nothing to resolve against and returned false for everyone, which is exactly what
`_verify-finance.cjs` caught first (`Isaac's shared nav area reads "Bank" (got "null")`). The
fallback is what the CURRENT STATE inventory's "suites that set only choreUser MUST STILL
WORK" requirement actually demanded — it's not a workaround, it's the compat mechanism.

**ORDER-PRESERVING ITERATION, NOT JUST BOOLEAN GATES.** `FITNESS_USERS`/`BANK_KIDS`/
`CHORE_USERS` weren't only gates — `fitDefaultView()` iterates them for a tie-break, bank-card
rendering iterates them for display order. Naively deriving the list from `profiles().filter(p
=> can(...))` would reorder it to whatever order profile docs happen to sort in (alphabetical
by name), silently changing `fitDefaultView()`'s fallback pick. `fitUsers()`/`kidBankUsers()`/
`choreUsers()` instead check `can()` against the HISTORICAL name order first (`FIT_ORDER` etc.,
kept only as a tie-break, never as the authorization list itself), appending anyone newly
granted after — so today's order is untouched and a future grant still shows up.

**bankAdmin() KEEPS ITS PIN — CAPABILITY REPLACES ONLY THE NAME HALF.** `bankAdmin() =
isDadName() && dadUnlocked()` became `can("approvePayouts") && dadUnlocked()`. The PIN session
flag is unchanged; it now guards a capability instead of a name.

**BANK_ADMIN THE STRING SURVIVES — AS DATA, NOT A GATE.** Ledger `by` fields and notification
`to` targets (`addLedgerEntry(..., BANK_ADMIN, ...)`, `notifyPayoutPending`'s recipient) still
address "Dad" literally. Converting these to "whoever currently holds bankAdminUI" was
explicitly out of scope — today there's exactly one such profile either way, and resolving
notification recipients by capability is a bigger, differently-shaped change than this phase's
"replace the GATES" mandate.

**PUSH TOKENS AND CALENDAR NOTIFY BOTH GAINED A PID, NAME STAYS THE FALLBACK.**
`BuckyPush.enable()` gained a 5th (optional) `pid` argument — token docs now
`{token, user, pid, ua, at}`, `user` untouched for legacy consumers. `eventreminders.mjs`
matches a notify entry against a token by pid first, normalized name second (never name alone)
— a token WITH a pid matches even if its `user` string is garbage; a legacy token with no pid
still resolves by name. The calendar Notify checkboxes now persist PIDS
(`payload.notify = checkedRows.map(r => r.pid || pidSlug(r.name))`), but the pre-tick
(`notifyEntryMatches`) and the immediate email/push/bell pipeline (still name-addressed, kept
that way deliberately — converting THAT to pid-addressing would ripple into `writeCloudNotif`/
`sendEmail`/`addNotif`, all of which are per-user-data-keyed by name across the whole file, a
change with a blast radius well outside this phase) both tolerate either form on read.
**RESTAGED, with reason, in `_verify-calnotify.cjs`**: two assertions that checked
`savedEv.notify` equalled `["Eleanor","Isaac","Mom"]` now expect `["eleanor","isaac","mom"]` —
the STORED form legitimately changed; the anti-spam / pre-tick / delivery behavior those checks
exist to prove did not, and the comment at each restaged check says so.

**sports.html's GFFL_TEAM_BY_USER already matched the pid scheme by accident** — it was keyed
by lowercased `choreUser`, which for every current single-word name IS the pid. Switched to
`chorePid || lowercased choreUser`, unchanged output for the whole family today.
`index.html`'s own `gfflMyTeamId()` (a near-duplicate, "keep the two in sync" per its own
comment) was deliberately LEFT AS-IS — not in this phase's file list, and it wasn't the thing
`_verify-sports.cjs` or the task actually asked to change.

**editAnimalCareSchedule WAS NEVER GATED** — checked, not assumed: the Animal Care rota has no
name check anywhere; anyone can edit it today. No capability was added for it, since adding one
now would be a NEW restriction, not a preserved one.

**A RENAME DOES NOT MIGRATE PER-NAME LEGACY DOCS, AND THIS PHASE DIDN'T CHANGE THAT.**
`fitPlan_<Name>`/`stockWatch_<Name>`/kidbank `kid` fields are still keyed off the CURRENT
display name (`myName()`), per the CURRENT STATE inventory's "most myName() call sites are
DISPLAY or per-user data keys; only the GATES change layer." A profile renamed today still
loses the app's OWN lookup of its old per-name docs (pre-existing behavior, not introduced
here) — what the new suite proves instead is narrower and load-bearing: pid/role/grant survive
a rename untouched, `can()` still resolves correctly by pid after one, and the rename never
DELETES the old doc (Section G, `_verify-identity.cjs`). Making per-name docs rename-safe by
re-keying them onto pid was explicitly out of scope (identity.md: pid-keyed docs are the ones
"already deriving from the 2026-08 names" — retrofitting fitPlan/stockWatch onto pid would
orphan every EXISTING doc immediately, the opposite of safe).

**LOAD-BEARING PROOFS, each broken and confirmed failing before being reverted:**
- `backfillChorePid()` turned into a no-op → the ONE check that exists for it fails
  (`chorePid was backfilled... got "null"`); the app itself still half-worked (`me()` has its
  own choreUser→name fallback independent of chorePid), proving the check isolates exactly
  the mechanism it names.
- `can()`'s `deny` branch removed → exactly the deny-override check fails (`got true`), the
  grant-override check next to it still passes untouched.
- `migrateIdentity()` made unconditional (`patch.pid = pidSlug(p.name)` always, no `!p.pid`
  guard) → the renamed-profile check fails (pid rewritten "isaac" → "zack"); the OWN
  "run twice, same result" check does NOT catch this on its own (an always-wrong value is
  still self-consistent across two runs) — both checks are needed, they prove different
  properties.

**AMBIGUOUS CALLS, documented here rather than guessed silently:** `bankAdminUI` doing five
jobs (above); `BANK_ADMIN`/`PRINT_ADMIN` kept as literal addressing values, not converted to
capability-resolved recipients; `gfflMyTeamId()` in index.html left untouched; per-name legacy
docs (fitPlan/stockWatch/kidbank) left name-keyed. `activity.html`'s own Dad-only gate (a
self-contained duplicate `isDadName()`, per the app's no-shared-JS convention) was also left
alone — it isn't in this phase's file list and has no capability layer of its own to plug into
yet.

**VERIFIED**: `_verify-identity.cjs` — migration idempotence (11 seeded profiles, exact
pid/role for all 10 real family members hand-derived from the OLD constants, a renamed
profile's pid untouched, two full reloads produce byte-identical profile docs); the full
capability matrix for all 10 real profiles (9 capabilities × 10 people = 90 checks) against a
real UI slice (Bank/Finance nav label, Fitness chip, Meals chip for 5 representative
profiles); grant/deny overrides; "This is me" setting pid+name together; boot backfill; the
zero-profile-docs synthetic-profile fallback; new-profile pid minting including a same-name
collision (`sam`/`sam2`); a rename's identity stability. **169/169.**
Regressions green: calnotify **122** · finance **117** · chore-care **50** · fitness **249** ·
sports **273** · activity **147** · calview **25** · news **200** · minis-audio **38** ·
arcade **23** · beacon-safety **96** · storyledger **854**. eventreminders extended
**62 → 68** (pid-first matching: a garbage-`user` token still matches by pid; a legacy
no-pid token still matches by name; a mixed pid+legacy-name notify list resolves both; a
pid-and-user token matches on a pid-only selection).

## 🪪 IDENTITY, PHASE 2: PERMITTED, VISIBLE, NOTIFIED, AND A DOOR THAT ISN'T LOCKED FOREVER (2026-08-30)

Three features on top of Phase 1's `pid`/`role`/`can()` layer. Contract unchanged:
**docs/identity.md**. Files: `index.html` · `netlify/functions/eventreminders.mjs` · NEW
`tools/_verify-profilepage.cjs` (**83/83**) · extended `tools/_verify-eventreminders.mjs`
(**68 → 78**).

**A. A PROFILE PAGE, WITH TWO LAYERS THAT NEVER TOUCH THE SAME SWITCH.** Permitted (parent-
controlled, `can()`-resolved, lives in the target's `deny` array — the Phase 1 mechanism, no new
one) decides which of the 13 non-Home nav areas a person MAY see; Visible (self-controlled,
`prefs.nav`, a hidden-area-id array) decides which of the PERMITTED areas actually show in THEIR
OWN nav. `navGroupPermitted(gid, who)` and `isNavHidden(gid, who)` are separate functions on
purpose — `navGroupVisible(gid)` (nav-building, current user only) ANDs them together, but
render()'s deep-link bounce checks PERMITTED ALONE, never VISIBLE: a denied area redirects Home,
a merely-hidden one still opens. That asymmetry is the whole point of "preference narrows,
never widens, authorization" — get it backwards (bounce on VISIBLE too) and a person who tidied
their own nav loses working deep links, which is exactly what load-bearing proof #1 breaks and
confirms fails (one check, cleanly isolated).

**THE CHORES-TAB CORRECTION — checked, not assumed.** The brief for this phase said Chores was
already "capability-gated" like Fit/Bank/Meals. Reading `navGroupVisible` (Phase 1) showed
otherwise: the Chores TAB had no gate at all — `seesChores` only ever controlled the
home-dashboard chore ring. Reusing `seesChores` as the nav-permission would have HIDDEN Chores
from Dad/Mom/extended today, a real regression. `seesChoresArea` is a NEW capability instead —
default true for parent/kid/extended (matches today), false for guest — documented at the CAPS
block with the correction spelled out. The other 8 previously-ungated areas (Plan/News/Sports/
GFFL/Jobs/Shop/Farm/AI/Play) got the same treatment: new `sees<Area>` capabilities, true for
every role except guest.

**GUEST DEFAULTS — the brief left three areas undecided; decided here, documented at the CAPS
block, not guessed silently.** GFFL: tight (a family fantasy league is a standings competition
among family, not general reading — closer to Bank/Jobs than to Sports). Shop: open (a shopping
list is low-sensitivity family logistics, closer to Plan/News). Meals: already tight from Phase
1 (parent-only role default, untouched). None of this touches the 10 REAL profiles' effective
view — nobody has role `guest` yet, so changing `CAPS.guest` (Phase 1 had provisionally set
`seesFinance:true` for guest; Phase 2 corrects it to the brief's "Bank/Finance...no") breaks no
existing behaviour.

**A LATENT STALENESS BUG, SURFACED BY THIS PHASE, FIXED IN THIS PHASE.** `buildBottomNav()`'s
FIRST call happens at top-level script-parse time — BEFORE `unlock()`/`bootApp()` even runs —
against `chores = []`. It resolves the signed-in profile through `syntheticProfile()`'s
seed-only fallback, which reproduces ROLE and the one SEEDED grant correctly (why this was
invisible through all of Phase 1 — no real profile had a custom deny), but has no way to know
about a real profile's `deny` array or a role a parent changed via the new role picker. Caught by
this phase's own suite (`Isaac's News is gone from HIS nav` failed against real nav DOM before
the fix, passed after) — not a hunch, a measured failure. Fix: `buildBottomNav(); syncTabsUI();`
now also runs once real data lands, in the SAME two places `migrateIdentity()` already does
(`afterBackendReady()` for the local backend, the cloud `onSnapshot` handler's non-cached branch
for the cloud one) — live permission/role changes now refresh a currently-open session's nav too,
not just a future reload.

**B. NOTIFICATIONS ON BY DEFAULT, PLUS FIVE CATEGORIES.** `desktopAlertsEnabled()` flipped from
`=== "1"` (opt-in) to `!== "0"` (opt-out) — one line, and every existing consumer
(`refreshPushRegistration`, `liveNotify`, the Settings toggle) already gates on it correctly, so
nothing else needed to change. Browser permission is requested EXACTLY ONCE, at the end of the
first-run gate's pick/create action (`requestNotifPermissionOnce()`, guarded by a plain JS flag
set BEFORE any await — the permission-state check alone is race-prone, see below) — the tap that
resolves the gate is the required user gesture. A device that already has permission granted
gets registered silently on the next boot (no code change needed — `desktopAlertsEnabled()`
being true by default plus the EXISTING `refreshPushRegistration()` scheduled calls in
`unlock()`/`refreshName()` already do it). A device with permission denied gets one quiet line on
the profile page and nothing else, ever.

**CALL-SITE INVENTORY — every `BuckyPush.notify`/`sendEmail`/`writeCloudNotif` call site in
`index.html`, mapped to its category, gated at the call site:**

| category | call sites | gate |
|---|---|---|
| `calendar` | `notifyCalEvent` (writeCloudNotif + BuckyPush.notify + sendEmail, all three, one filter) | `targets = names.filter(n => !isNotifMuted(n, "calendar"))` |
| `jobs` | `notifyAssignee`, `notifyCreatorClosed`, `notifyPrintAdmin`, `notifyPrintRequestorDone`, `notifyProgressIncrease` | early `if (isNotifMuted(recipient, "jobs")) return;` in each |
| `bank` | `notifyBankCredit`, `notifyPayoutPending`, `notifyPayoutConfirmed` (its OWN extra `sendEmail`, separately from `notifyBankCredit`'s internal gate), `notifyPayoutSentToKids` (per-recipient `continue`) | same pattern |
| `league` | none yet — no GFFL/fantasy-league push exists anywhere in `index.html` or `sports.html` (checked, not assumed) | toggle recorded in `NOTIF_CATEGORIES` for when one is added |
| `scores` | none yet, same as league | same |

The manual "Send test alert" button (`notifTestBtn`) is deliberately UNGATED — it's an explicit,
self-addressed diagnostic action, not a category delivery.

**PERMISSION REQUEST RACE — the guard has to be a plain flag, not just a permission-state
check.** `push-client.js`'s `BuckyPush.enable()` unconditionally calls
`Notification.requestPermission()` itself (pre-existing, shared by every OTHER `enable()` call
site: `toggleDesktopAlerts`/`refreshPushRegistration`/`notifTestBtn` already all do "request, then
enable()" too). `requestNotifPermissionOnce()` calls `enable()` on success, so
`Notification.requestPermission()` legitimately gets called TWICE per gate resolution — a real
browser makes the second call a no-op (permission already decided, no new UI), but a naive
`Notification.permission !== "default"` guard is race-prone against that (both calls can pass the
check before either's synchronous permission-flip lands). `notifPermissionRequestedThisLoad`
(set synchronously, before any `await`) makes OUR side of the double-call deterministic
regardless. The suite's fake `Notification` models the real one-prompt-then-idempotent behaviour
precisely (counts a "prompt" only when permission was still `"default"` at call time) rather than
raw call count, which is what actually matches the user-visible guarantee.

**C. FIRST-RUN GATE — index.html only.** A device with neither `chorePid` nor `choreUser` after
the family password unlocks sees a full-screen gate (reuses the `.lock`/`.lockcard` styling —
same visual family as the password screen, same z-index tier) before the app: tap yourself from
the roster, or "I'm new here — create my account" (name required, collision-checked
case-insensitively against both name and pid, offering the matching profile instead of a
duplicate). Create-account mints a real pid via the SAME `mintPid()` the Family sheet uses, and
role `"guest"`. Both paths call `refreshName()` (which also closes the gate — one choke point,
so ANY path that establishes an identity, not just the gate's own, closes it) then
`requestNotifPermissionOnce()`. `checkIdentityGate()` is guarded to fire exactly once per page
load, from the SAME two integration points as `migrateIdentity()`/`buildBottomNav()` above, for
the same "needs the authoritative roster" reason. Existing suites are unaffected — checked, not
assumed: none of the 13 suites in this phase's required battery boot with `choreUser` unset (all
default to a real name in their `newPage()` signature), so the gate never triggers for them.

**SELF-DEMOTION GUARD.** The role picker + Permitted editor render ONLY when `!isSelf &&
can("bankAdminUI") && dadUnlocked()` — never on your own profile page, even for Dad. A
bankAdminUI holder can promote/demote anyone else, never themselves, so nobody can mis-click
their own way into a lockout.

**LOAD-BEARING PROOFS, each broken and confirmed failing before being reverted:**
- `eventreminders.mjs`'s calendar-mute filter disabled → exactly the 6 section-10 checks fail
  (push got the muted token, bell got the muted pid, `mutedNames` came back empty); every other
  check (window/idempotency/targeted-delivery/pid-matching) stayed green — the mute logic is
  isolated from everything around it, not accidentally load-bearing for something else.
- `render()`'s deep-link bounce switched from `navGroupPermitted` to `navGroupVisible` (the
  narrow-only-rule violation: hiding an area would now ALSO block its deep link) → exactly the
  "merely-hidden area still WORKS" check fails, nothing else moves.
- `needsIdentityGate()` hardcoded to `true` → exactly the "existing identity never sees the
  gate" check fails; every pick/create/collision check downstream still passes (they all
  independently re-open the gate via their own flow, so they're not proof the gate-suppression
  logic works — this one specific check is).

**AMBIGUOUS CALLS, documented here rather than guessed silently:** guest GFFL/Shop defaults
(above); `seesChoresArea` as a NEW capability rather than reusing `seesChores` (above, the
"already gated" correction); the Bank area's Permitted checkbox denies/un-denies THREE
capabilities at once (`kidBank`, `bankAdminUI`, `seesFinance`) rather than one, because
`navGroupPermitted("bank")` is genuinely an OR of all three — a single-capability toggle would
silently fail to hide Bank from a kidBank-holding kid; Visible/notification prefs are self-only
(a parent cannot tidy a kid's own nav or mute their categories FOR them, even from the kid's
profile page) — narrower than it had to be, chosen to keep "self-controlled" meaning exactly
that; `chorereminders.mjs` stays a broadcast, untouched — it has no per-person model to hang a
mute on, out of scope per the brief.

**VERIFIED**: `_verify-profilepage.cjs` (**83/83**, NEW) — permitted-vs-visible separation with
real nav DOM AND deep-link redirect behavior (both denied and merely-hidden cases, proven
distinct); Home un-hideable in both the capability layer and the Visible UI; the full guest
capability matrix (14 capabilities) plus real nav DOM for a representative guest profile;
self-demotion guard; role-picker/Permitted-editor gating (a non-admin gets neither, a
PIN-unlocked admin gets both, and using the picker actually persists through `backend.update`);
prefs round-trip through a REAL page reload (not just in-memory); all 5 notification categories
defaulting unmuted with zero prefs seeded; three real call sites (`notifyBankCredit`,
`notifyAssignee`, `notifyCalEvent`) proven suppressed when muted AND still firing for an unmuted
person in the SAME run; the notification default flip; the first-run gate's existing-identity
suppression, roster listing, pick/create/collision paths (with the created guest's pid/role
checked directly against the roster, not just toast text), and the one-prompt-per-flow guarantee.
Regressions green: identity **169** (unmodified — the 10-profile parity table still passes
byte-for-byte) · calnotify **122** · finance **117** · chore-care **50** · fitness **249** ·
sports **273** · activity **147** · calview **25** · news **200** · arcade **23**.
eventreminders extended **68 → 78** (calendar-mute excludes both push and bell together, an
unmuted person on the SAME event unaffected, an empty `prefs.notifs` array reads identically to
no prefs at all, and a missing/empty profile-docs read fails OPEN rather than blocking delivery).
