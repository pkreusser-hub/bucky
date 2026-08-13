// lg-ui.js — GFFL views: league home, matchup (the heart), team/lineup,
// rules (view/edit/import), claim + gate. Mobile-first; league.html carries
// the styles and the shell markup this module fills.
"use strict";
(function () {
  const LG = window.LG, D = () => LG.data;
  const UI = (LG.ui = {});
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // Every PLAYER name on screen renders through this (2026-08-08, user: "player names should
  // always be first initial and then last name"). Team names, owner names and chat text use
  // plain esc() — this one is only ever for a person on a roster. See LG.shortName's own note
  // for why the shortening is display-only and never touches stored or wire data.
  const escn = (s) => esc(LG.shortName(s));
  // ---------------- the desktop breakpoint (2026-08-11) ----------------
  // The League tab is TWO layouts, not one stylesheet: on a phone it is the stacked card list
  // it has always been (collapsed <details>, lazy data, six standings columns); at ≥1024px it
  // is a two-column dashboard with an always-expanded chat rail. The split is a real branch in
  // renderLeague — a CSS-only version can't turn a <details> into a panel, can't add table
  // columns, and can't decide what to fetch. 1024px is the SAME number league.html's own
  // desktop media block uses; the two must stay in step.
  const DESK_MQ = "(min-width:1024px)";
  const isWide = () => !!(window.matchMedia && window.matchMedia(DESK_MQ).matches);
  const FA_SEARCH_DEBOUNCE_MS = 180; // S6 — see the players-table search's own note
  const HOT_PICKUPS_N = 5;           // S6 — how many trending adds the Moves strip shows
  // Up to 2-letter initials for a team-avatar fallback (design system §"Team avatars are
  // initials on colored circles") — used only where a team has no logo on file.
  const initials = (name) => (String(name || "?").trim().split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?");
  // A GFFL team's short tag — its own abbrev, else initials of its name. The same convention
  // the FA table's TYPE column and the claim screen's logo placeholder already use; hoisted
  // here because the matchup feed's per-event team chips (2026-08-09) need it too.
  const teamTag = (t) => (t && (t.abbrev || initials(t.name))) || "?";
  // ---------------- injury designations (2026-08-09 playtest) ----------------
  // "never label a healthy player, and abbreviate the rest to Q / D / OUT." ONE function, four
  // callers (the locker lineup + swap sheet via injChip, the players table row, the player
  // stats card header) — the mapping must never be duplicated, or two surfaces will disagree
  // about what a status means.
  //   · ACTIVE / "" / null and friends -> "" (no chip, no span, no stray whitespace)
  //   · Questionable -> Q · Doubtful -> D · Out -> OUT
  //   · anything else that is a REAL designation still shows something. A status we did not
  //     anticipate must never be silently swallowed: a player who is genuinely unavailable
  //     rendering as healthy is the one failure mode that actually costs a family a week.
  // Case-insensitive, and tolerant of both the full words Sleeper sends (injury_status:
  // "Questionable") and the already-abbreviated forms ESPN sometimes does ("Q") — so it is
  // idempotent: injLabel("Q") === "Q".
  // NOTE this is DISPLAY only. LG.irEligible reads the RAW upstream value (it matches on
  // "Out"/"Doubtful"/"IR"/"PUP"/…), so every caller of it must keep passing the raw string.
  const INJ_HEALTHY = new Set(["", "active", "act", "a", "healthy", "ok", "none", "null", "undefined"]);
  const INJ_ABBR = {
    questionable: "Q", q: "Q",
    doubtful: "D", d: "D",
    out: "OUT", o: "OUT",
    probable: "P", p: "P",
    ir: "IR", injuredreserve: "IR", irr: "IR-R",
    pup: "PUP", nfi: "NFI",
    sus: "SUS", suspended: "SUS", suspension: "SUS",
    na: "NA", dnr: "DNR", cov: "COV", covid: "COV",
  };
  function injLabel(raw) {
    const s = String(raw ?? "").trim();
    if (!s) return "";
    const k = s.toLowerCase().replace(/[^a-z]/g, "");
    if (INJ_HEALTHY.has(k)) return "";
    if (INJ_ABBR[k]) return INJ_ABBR[k];
    // Unanticipated but real — keep a short uppercase form rather than dropping it.
    return s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  }
  LG.injLabel = injLabel; // test hook — the suite asserts the mapping directly as well as rendered
  // S9's injury feed reads better in words ("Questionable → Out") than in the app's own compact
  // Q/D/OUT badges — but WHICH VALUES COUNT AS A DESIGNATION is decided in exactly one place,
  // injLabel's own INJ_HEALTHY/INJ_ABBR tables, never re-derived here. injWord defers to
  // injLabel for the healthy/not-healthy question (idempotent, so it works equally well fed a
  // raw Sleeper string or an already-canonical abbreviation) and only spells the common short
  // codes out longhand for the feed's prose; anything else stays as its abbreviation, which
  // already reads fine on its own ("IR", "PUP", "SUS") rather than being dropped.
  const INJ_WORD = { Q: "Questionable", D: "Doubtful", OUT: "Out", P: "Probable" };
  function injWord(raw) {
    const abbr = injLabel(raw);
    if (!abbr) return "Healthy";
    return INJ_WORD[abbr] || abbr;
  }
  LG.injWord = injWord; // test hook — S9's feed card + LG.pushInjuryChange's push body
  // "Is this player's NFL team currently on offense?" (2026-08-09 playtest: "we need to
  // highlight players when their team has the ball and is on offense"). A D/ST is deliberately
  // never highlighted — its side has the ball, which means the defense is off the field, the
  // same reasoning the red-zone flag already uses. `poss` is only ever set by the per-game
  // summary poll, so under the 2025 replay (no drive data at all) this is false for everybody.
  function hasBall(p) {
    if (!p || p.pos === "DST") return false;
    const d = D();
    const g = d.S.games.get(d.slpTeam(p.team));
    return !!(g && g.state === "in" && g.poss);
  }

  UI.view = "league";
  UI.week = null;           // viewed league week
  UI.matchup = null;        // [homeTeamId, awayTeamId]
  UI.lockerTeamId = null;   // viewed locker
  UI._aiRead = null;        // {key, at, busy, error, mults:{name:{mult,why,proj,adj}}} — S5's AI read
  let schedule = null;
  // REFINEMENT 4 (2026-08-11, user: "get rid of the fire, dead, goat buttons and just add an
  // Emoji button where you can emoji response directly on to someone's chat") — item 10's four
  // fixed text chips are GONE. A message now shows only the reactions it HAS (any emoji,
  // straight from its own doc's keys, count + a lit ring when YOUR team is in it) plus one SVG
  // add-reaction button that opens a lazy emoji palette on that message. Reaction glyphs are
  // USER content (someone reacted), so they are exempt from the app-chrome emoji ban exactly
  // like message text; the PALETTE renders lazily on tap, the same section-U discipline as the
  // composer's picker. Legacy docs keyed by the old chip WORDS display as their emoji but keep
  // their STORED key on the wire, so an old FIRE and a new tap land in the same bucket.
  const LEGACY_REACTS = { FIRE: "🔥", DEAD: "💀", LOL: "😂", GOAT: "🐐" };
  const IMG_CAP = 80000; // ~80KB dataURL chars (design cap for CHAT images)
  // S3: the crest is now the biggest thing on a locker (96-128px) and the source of every
  // team's colour scheme, so it gets its own budget rather than sharing chat's. A logo lives
  // ONE PER TEAM DOC, and Firestore's 1MB-per-document limit laughs at 160KB of base64; a chat
  // image is one of hundreds in a thread, which is why that cap stays where it is.
  const LOGO_CAP = 160000;
  const LOGO_DIM = 512;  // was 240 — a 38px crest could live with that, a 128px hero cannot

  // ---------------- offline-with-a-mirror (2026-08-08, the REST transport) ----------------
  // When the cloud can't be reached but this device holds a mirror of the league (see
  // lg-core's SNAPSHOT MIRROR note), the league renders NORMALLY from that copy — the whole
  // point of the rework is that a person can always see their data. Two things make that
  // honest rather than misleading: a persistent chip saying which copy they're looking at and
  // how old it is, and a hard refusal on every mutation (a write into a mirror would be
  // overwritten by the next successful cloud read, so it would appear to work and then vanish).
  // lg-core throws for the refusal; this is the toast that goes with it, throttled because one
  // tap can legitimately reach LG.db.set more than once.
  let lastOfflineToastAt = 0;
  LG.onOfflineWrite = () => {
    if (Date.now() - lastOfflineToastAt < 3000) return;
    lastOfflineToastAt = Date.now();
    toast("You're offline — try again when you're reconnected.");
  };
  // The refusal has already been reported by the toast above, so its error must not also
  // surface as a page error. Deliberately NARROW: only the flag lg-core sets is swallowed —
  // every other rejection still reaches the console exactly as before.
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("unhandledrejection", (e) => {
      const r = e && e.reason;
      if (r && r.offlineReadOnly) e.preventDefault();
    });
  }
  function agoWords(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return "just now";
    if (m < 60) return m + " minute" + (m === 1 ? "" : "s") + " ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + " hour" + (h === 1 ? "" : "s") + " ago";
    const d = Math.round(h / 24);
    return d + " day" + (d === 1 ? "" : "s") + " ago";
  }
  function syncOfflineChip() {
    const el = $("#offlineChip");
    if (!el) return;
    if (!LG.mirrorOffline) { el.hidden = true; return; }
    const at = LG.mirrorStampAt();
    el.hidden = false;
    // ITEM 18 (2026-08-09): this used to add the replay banner's measured height, because the
    // two strips were both sticky under the header and would otherwise pin to the same top and
    // overlap on scroll. The banner is gone, so the chip sits directly under the header again —
    // no stale gap left where the strip used to be.
    el.style.top = (window.innerWidth >= 1024 ? 46 : 52) + "px";
    el.textContent = "Offline — showing this device's saved copy" +
      (at ? " (from " + agoWords(Date.now() - at) + ")" : "") + " · reconnecting…";
  }
  UI._syncOfflineChip = syncOfflineChip; // test hook
  // The auto-retry. Each attempt is one bounded fsFetch (lg-core's timeout wrapper), so this
  // loop can never pile up or hang; on success the caches full of unconfirmed answers are
  // dropped, the chip goes, and the screen repaints with the real league.
  const MIRROR_RETRY_MS = 20000;
  let mirrorTimer = null;
  function stopMirrorRetry() { if (mirrorTimer) { clearInterval(mirrorTimer); mirrorTimer = null; } }
  async function mirrorRetryTick() {
    if (!LG.mirrorOffline) { stopMirrorRetry(); return true; }
    let reached = false;
    try { reached = await LG.retryBackend(); } catch (e) { reached = false; }
    if (!reached) { syncOfflineChip(); return false; } // also refreshes the "from N minutes ago" wording
    stopMirrorRetry();
    syncOfflineChip();
    await UI.boot().catch(() => {});
    return true;
  }
  // `ms` is a test seam only — production always uses MIRROR_RETRY_MS. Re-arming with a
  // period clears any existing timer first, so the loop can never double up.
  function startMirrorRetry(ms) {
    if (ms) stopMirrorRetry();
    if (mirrorTimer || !LG.mirrorOffline) return;
    mirrorTimer = setInterval(mirrorRetryTick, ms || MIRROR_RETRY_MS);
  }
  UI._startMirrorRetry = startMirrorRetry;
  UI._mirrorRetryTick = mirrorRetryTick;
  UI._mirrorTimerOn = () => !!mirrorTimer;
  UI._mirrorRetryMs = MIRROR_RETRY_MS;

  // ---------------- auto-checks throttle (perf) ----------------
  // maybeAutoProcessWaivers/maybeAutoExecuteTrades/maybeAdvanceLeague are each cheap ONCE a
  // deadline/review-window has genuinely passed and idempotent otherwise, but chaining them
  // from every d.onUpdate (every live poll, as often as 15s during a game) AND every renderMoves
  // visit meant the league was re-running the whole check chain far more often than it could
  // ever have new work to do. They now run at most once per AUTO_CHECK_MS, except at boot
  // (force:true — always once, so "open the app past a deadline" still carries the league
  // forward immediately) and any DIRECT call a caller makes to the underlying functions
  // themselves (the test suite calls those directly in several places — this throttle only
  // gates the three places that ran them automatically as a side effect of rendering).
  const AUTO_CHECK_MS = 60000;
  let lastAutoCheckAt = 0;
  UI._autoCheckRuns = 0; // test hook — counts how many times the chain actually ran (past the throttle), not how many times it was CALLED
  async function runAutoChecks(force) {
    if (!LG.teams.length) return;
    // A device reading a stale, read-only mirror has no business carrying the league forward:
    // every one of these three WRITES (process waivers, execute trades, finalize/advance), and
    // they would each be refused — raising a "you're offline" toast for something no person
    // asked for. The first client that genuinely reconnects runs them.
    if (LG.mirrorOffline) return;
    // LEAGUE time, deliberately — and this was tried the other way round during the 2025-replay
    // clock work. Everything this chain does is keyed to a LEAGUE DEADLINE (has the waiver
    // deadline passed, has a trade's review window elapsed, is a week final), so the throttle has
    // to advance with the same clock those deadlines are measured against: a trade whose review
    // window has run out in league time must execute the moment the app next looks, which is
    // exactly what sections J and P assert by driving LG.nowOverride forward. Switching this to
    // Date.now() broke both. The cost under the replay is that the chain runs every 60 LEAGUE
    // seconds (7.5 wall seconds at the default 8x) instead of every 60 wall seconds; the chain is
    // cached reads plus a finalize that refuses outright under the replay, so that is affordable.
    // (LG.db's OWN cache staleness is the opposite case and is on wall time — see its note.)
    if (!force && LG.now() - lastAutoCheckAt < AUTO_CHECK_MS) return;
    lastAutoCheckAt = LG.now();
    UI._autoCheckRuns++;
    await maybeAutoProcessWaivers().catch(() => {});
    await maybeAutoExecuteTrades().catch(() => {});
    // Build it once the regular season is fully final, advance it once a playoff week is —
    // maybeAdvanceLeague also re-runs maybeAutoFinalizeWeeks, so this one call covers S5+S7.
    await maybeAdvanceLeague().catch(() => {});
  }
  UI._runAutoChecks = runAutoChecks; // test hook

  // ---------------- boot ----------------
  // Boot-speed pass (2026-08-08): league.html now calls UI.boot() immediately, WITHOUT
  // waiting on LG.backendReady first — the gate screen (an unauthenticated visitor) needs
  // no backend at all, and used to sit blocked behind the Firebase ESM import + reachability
  // probe for no reason. Only once we know we're actually unlocked do we await backendReady,
  // right before the first real LG.db read.
  UI.boot = async function () {
    if (!LG.unlocked()) { renderGate(); return; }
    await LG.backendReady;
    // Independent doc reads (a settings doc, a team list, a schedule doc) — no read depends
    // on another's result, so run them together instead of stacking three round trips.
    // A REJECTION here used to escape UI.boot() entirely: league.html calls it without a
    // catch, so a backend that throws mid-boot (a dropped connection, a Firestore error) left
    // the page on "Loading the league…" forever with nothing but an unhandled rejection in the
    // console. Caught here, it becomes the same honest outage card an unreachable backend gets.
    try {
      // LG.loadAuth() rides along here (S1's cloud commissioner PIN) — it is an independent
      // doc read like the other three, and it deliberately swallows its own failures, so it
      // can never be the reason this Promise.all rejects into the outage card.
      await Promise.all([LG.loadRules(), LG.loadTeams(), LG.loadAuth(), LG.loadSchedule().then((s) => { schedule = s; })]);
    } catch (e) {
      LG._markDegraded(e);
      LG.teamsConfirmed = false;
      renderOffline();
      return;
    }
    UI.week = LG.currentWeek() > (LG.rules.seasonWeeks + 3) ? LG.rules.seasonWeeks : LG.currentWeek();
    // S1: if the league holds no commissioner hash yet and THIS device carries Dad's family-app
    // one, hand it up now — the sooner it lands, the smaller the window in which anyone else
    // could be offered "set a commissioner PIN (first time)". Fire-and-forget: it is one small
    // write, it no-ops on every boot after the first, and nothing on screen waits for it.
    LG.migrateCommishPin().catch(() => {});
    // An empty league we could NOT confirm is an outage, not a new league — never route into
    // the claim screen or the first-run import off an unconfirmed read (live bug 2026-08-08;
    // see lg-core.js's SERVER-CONFIRMED EMPTINESS note). Checked here, before those branches,
    // so no hash (#moves, #rules, …) can slip past it either.
    if (!LG.teams.length && !LG.teamsConfirmed) { renderOffline(); return; }
    // Offline, but this device holds a mirror WITH a league in it: render everything as
    // normal and keep trying to reconnect in the background. (A mirror with no teams falls
    // through the guard above to the honest outage card — the one case with nothing to show.)
    if (LG.mirrorOffline) startMirrorRetry();
    // 2025 SEASON REPLAY: the app loads its own data. Checked AFTER the confirmed-emptiness
    // guard above, deliberately — an unreachable backend still gets the honest outage card
    // rather than a setup run that could only fail, so nothing about that fix is weakened.
    // simNeedsSetup() looks for exactly the artifacts runSimSetup() itself writes, so a run
    // that stops partway (a flaky ESPN read, a closed tab mid-import) resumes right here on the
    // very next boot instead of duplicating finished work.
    // UI._simSetupDone is a LOOP GUARD, not a cache: renderSimSetup() ends by calling
    // UI.boot() again, so if a run finished but simNeedsSetup() were still true (the ESPN
    // import legitimately returning fewer teams than the league carries, say) the two would
    // bounce off each other forever with the setup card on screen. One successful run per page
    // load is enough; a genuinely partial seed resumes on the NEXT boot, which is exactly the
    // contract the function's own comment states.
    // …and never in mirror-offline mode: the setup is a write-heavy import into a store that
    // is deliberately read-only, so it could only ever fail. A device that has been online
    // already holds the seeded season in its mirror; one that hasn't will run the setup the
    // moment it reconnects.
    if (LG.SIM_2025 && !LG.mirrorOffline && !UI._simSetupDone && await simNeedsSetup()) { renderSimSetup(); return; }
    if (!LG.myTeamId() && LG.teams.length) {
      // No claimed team yet — nothing to paint early (renderClaim needs only the teams we
      // just loaded, which is instant), and there's no live view for auto-checks to catch
      // up before. Same forced-once-per-boot posture as the claimed path below.
      await runAutoChecks(true).catch(() => {});
      renderClaim();
      return;
    }
    startData();
    routeInitial();
    // Any client past a deadline can carry the league forward — no scheduled function in v1
    // (plan §6 deviation). Forced (bypasses the throttle above) — this is the ONE guaranteed
    // run per app open, so "open the app past a deadline" always carries the league forward
    // on the spot. MOVED to run AFTER the first paint above (was: before it) — the render the
    // user actually SEES no longer waits on however many backend calls the waiver/trade/
    // finalize/bracket chain needs; UI.boot() still doesn't RESOLVE until this is done (a
    // direct re-await of UI.boot() — e.g. simulating "reopen the app past a deadline" — must
    // still guarantee the league is fully caught up by the time it returns). If it changed
    // anything, repaint so the screen the user is already looking at reflects it — the exact
    // same "quiet repaint after new data landed" pattern LG.db.onChange already uses.
    await runAutoChecks(true).catch(() => {});
    if (UI.view) UI.show(UI.view);
  };
  // Routes to whichever view the URL hash asks for (or the league home) — split out of
  // UI.boot() so it's the one place both the normal boot path and any future fast/cached
  // paint path can call to land on the same first screen.
  // Item 28 (2026-08-09): a sub-view carries its subject in the hash (#locker=<id>,
  // #nflgame=<id>), so a shared or reloaded link lands on the same locker/game.
  // ITEM 32 (2026-08-10): the parse moved into viewFromHash — ONE parser, shared with every
  // Back/Forward, so a deep link and a history entry can never be read differently. The landing
  // is a REPLACE, never a push: this is the entry point, there is nothing in the app behind it,
  // and Back from here must leave rather than consume an entry the reader never made.
  function routeInitial() {
    const v = viewFromHash(location.hash);
    if (v.locker != null) UI.lockerTeamId = v.locker;
    if (v.game != null) UI.nflGameId = v.game;
    UI.go(v.name, { replace: true });
  }

  // ---------------- 2025 SEASON REPLAY — the app loads its own data (2026-08-08) ----------------
  // Zero taps. Any device may run this: every write it makes is DETERMINISTIC (the rosters come
  // from one ESPN import, and the schedule is generated from the team ids in SORTED order), so
  // two devices racing the setup produce byte-identical documents and neither can corrupt the
  // other. That is why it is not commissioner-gated — the user wants the season to just be
  // there, and gating it would leave a kid staring at an empty league until Dad opened the app.
  //
  // Every step re-checks what already exists before writing, so re-running after a partial
  // failure resumes rather than repeating. Returns {ok:false, reason} on the FIRST thing that
  // didn't work — never a half-applied state reported as success.
  async function simNeedsSetup() {
    if (!LG.teams.length) return true;
    if (!(await LG.loadSchedule())) return true;
    // The real tell: week-1 rosters for THIS season (LG.rosterId is season-scoped). Read via
    // loadRoster, NOT ensureRoster — ensureRoster copies a previous week forward and WRITES,
    // which is exactly the wrong thing for a question that must not have side effects.
    for (const t of LG.teams) {
      const ros = await LG.loadRoster(1, t.id);
      if (!ros || !ros.length) return true;
    }
    return false;
  }
  UI.simNeedsSetup = simNeedsSetup; // test hook
  function renderSimSetup() {
    hideBnav();
    simWarmProjections();
    syncOfflineChip();
    if (main()) main().dataset.view = "simsetup";
    main().innerHTML = `<div class="card center">
      <h2>Loading the 2025 season</h2>
      <p class="mut" id="simSetupMsg">Starting…</p></div>`;
    runSimSetup((msg) => { const el = $("#simSetupMsg"); if (el) el.textContent = msg; })
      // A THROW anywhere (a rejected write, a backend that went away mid-run) must never leave
      // the "Starting…" card up forever with nothing said — same silent-failure family as the
      // import bug this file already carries a whole section about.
      .catch((e) => ({ ok: false, reason: String((e && e.message) || e) }))
      .then((r) => {
        if (!r.ok) {
          main().innerHTML = `<div class="card center"><h2>Couldn't load the 2025 season</h2>
            <p class="mut">${esc(r.reason || "?")}</p>
            <p class="mut small">Nothing was half-applied that a re-run won't fix — the parts that
            already finished won't repeat.</p>
            <button id="simSetupRetry" class="primary">Try again</button></div>`;
          $("#simSetupRetry").addEventListener("click", () => UI.boot());
          return;
        }
        UI._simSetupDone = true;
        UI.boot(); // teams + week-1 rosters + a schedule now exist -> the ordinary flow takes over
      });
  }
  UI.renderSimSetup = renderSimSetup; // test hook
  async function runSimSetup(onProgress) {
    const report = (msg) => { if (onProgress) onProgress(msg); };
    report("Importing the 2025 rosters from ESPN…");
    let j;
    try { j = await lgFn("lg_espn_rosters_season", { season: LG.SEASON }); } catch (e) { j = { ok: false, reason: String(e) }; }
    if (!j.ok) return { ok: false, reason: j.reason || "import-failed" };
    if (!(j.teams || []).length) return { ok: false, reason: "no-teams" };
    // MERGE, never replace: the family's 8 real teams already exist (team docs are season-
    // neutral and shared with the live league), so this only refreshes their names.
    for (const t of j.teams) await LG.saveTeam({ teamId: t.id, name: t.name });
    await LG.loadTeams();
    if (LG.teams.length < 2) return { ok: false, reason: "not-enough-teams" };
    report("Seeding the post-draft rosters…");
    await applyImportedRosters(j, 1);
    report("Building the season schedule…");
    let sched = await LG.loadSchedule();
    if (!sched) {
      // SORTED team ids. LG.teams' own order comes off a backend list() and is not guaranteed
      // stable between devices; the circle method is order-sensitive, so two devices racing
      // this must feed it the same sequence or they'd generate two different seasons.
      const ids = LG.teams.map((t) => t.id).slice().sort((a, b) => a - b);
      sched = LG.generateSchedule(ids, LG.rules.seasonWeeks);
      await LG.saveSchedule(sched);
    }
    schedule = sched;
    report("Ready — week 1 is up next.");
    UI.week = LG.currentWeek();
    return { ok: true };
  }
  UI.runSimSetup = runSimSetup; // test hook


  // Which NFL teams the engine bothers to poll. pollSleeper FILTERS stat rows by this set, so a
  // player on an untracked team scores nothing at all — which is correct while the set matches
  // the rosters and a silent zero the moment it doesn't. Extracted from startData (ITEM 31,
  // 2026-08-09) because the backup fill replaces EVERY roster in the league at once, and
  // leaving the engine tracking the teams the OLD rosters used left half the new players
  // reading 0.0 until the next page load. Found by looking at a review plate, not by a test.
  // KNOWN, and deliberately not widened here: a waiver add or a trade that brings in a player
  // from an untracked team has the same staleness until the next boot. That is pre-existing and
  // belongs to those flows; this call site is the one that changes all eight rosters at once.
  async function retrackTeams() {
    const d = D();
    const abs = new Set();
    for (const t of LG.teams) {
      const ros = await LG.ensureRoster(UI.week, t.id);
      for (const p of ros) if (p.team) abs.add(d.slpTeam(p.team));
    }
    d.trackTeams([...abs]);
  }
  UI.retrackTeams = retrackTeams; // test hook
  async function startData() {
    const d = D();
    d.initSleeper();
    // Track every team abbrev that appears in this week's league rosters.
    await retrackTeams();
    if (LG.SIM_2025) {
      // 2025 SEASON REPLAY: projections are REQUIRED, not optional — a week-1-before-kickoff
      // board with no projections is a board of dashes. The live path's own projections fetch
      // resolves off Sleeper's CURRENT /state/nfl reading (the real current week), which is
      // both the wrong week and the wrong season here, and is skipped outright under the
      // replay; d.simEnsureProj() is the replacement. Snapshotting waits on the SAME promise so
      // it never runs against a still-cold cache and silently captures nothing.
      d.simEnsureProj().then(() => { LG.snapshotProjections(UI.week).catch(() => {}); }).catch(() => {});
    } else {
      // Pre-game projection snapshot (S5): chained off the SAME initSleeper() promise
      // (memoized — this never triggers a second directory fetch), so it fires once the
      // engine's projections are actually warm rather than racing them.
      d.initSleeper().then(() => { LG.snapshotProjections(UI.week).catch(() => {}); });
    }
    // The real trigger for auto-finalization (+ S7's bracket build/advance): once live data
    // exists. Throttled (see runAutoChecks above) — this fires on every poll tick, not just
    // once a minute apart.
    d.onUpdate = () => {
      paintLive();
      runAutoChecks(false).catch(() => {});
      // S9 — runs every tick (cheap: it only ever walks the currently-rostered keys already in
      // memory; the expensive half, the directory refetch, is throttled separately inside
      // D.maybeRefreshInjuryDirectory). A genuine change re-fetches the feed doc THIS device
      // just wrote and repaints the league home if that's still what's on screen — mirrors
      // simProjEnsureAndRepaint's own "repaint once new data lands, only if still on that view"
      // idiom. A DIFFERENT device's change self-heals through the existing LG.db.onChange
      // background-refresh path, which already re-renders the current view from a fresh read.
      LG.checkInjuryChanges().then(async (r) => {
        if (r && r.changed) {
          UI._injFeed = await LG.loadInjuryFeed();
          if (UI.view === "league") renderLeague(true);
        }
      }).catch(() => {});
    };
    // Quiet repaint after a background (cloud-only) list() refresh notices new data — reruns
    // the current view's own full render, which now paints from the just-updated cache.
    LG.db.onChange = () => { if (UI.view) UI.show(UI.view); };
    d.start();
  }
  // 2025 SEASON REPLAY only — the "repaint once it lands" idiom the real league already uses
  // for the Sleeper directory (see renderMoves' own D().initSleeper().then(...) below), applied
  // to the replay's projections: a page that shows a projection calls this, and gets repainted
  // (once) the moment they land. The cache-existence check BEFORE calling d.simEnsureProj is
  // what makes it loop-safe — the repaint re-renders the SAME view, which calls this again, but
  // by then the cache is populated so the second call returns immediately with no new fetch and
  // no further repaint.
  function simProjEnsureAndRepaint(viewName) {
    if (!LG.SIM_2025 || !viewName) return;
    // WHAT IS ACTUALLY PAINTED, not UI.view. UI.view defaults to "league" at module load and
    // is only ever written by UI.show — so on the gate, the claim screen, the setup card or
    // the outage card (none of which go through UI.show) it still reads "league", and
    // simWarmProjections()'s own warm call would repaint the LEAGUE HOME over them the moment
    // projections landed: a brand-new owner was bounced off the claim screen into a league
    // they hadn't picked a team in, and a setup-failure card was wiped before it could be
    // read. main().dataset.view is stamped by every one of those screens, so it is the honest
    // answer to "which screen is the user looking at" — checked now AND again on landing.
    const painted = () => (main() && main().dataset ? main().dataset.view : "");
    if (painted() !== viewName) return;
    const d = D();
    if (d.S.simProj) return;
    d.simEnsureProj().then(() => { if (UI.view === viewName && painted() === viewName) UI.show(viewName); }).catch(() => {});
  }

  // Polish pass (2026-08-08): #bnav is static markup, always in the DOM regardless of auth
  // state — the gate/first-run/claim screens (none of which have a usable app behind them
  // yet) were rendering it fully visible AND tappable, and every one of its buttons wires
  // straight to UI.show() with no unlock/team-loaded check of its own — tapping "Matchup" (or
  // any other tab) from the gate screen, before a passphrase is even entered, rendered an
  // empty/broken view rather than doing nothing. hideBnav()/showBnav() are the one place that
  // toggles it; UI.show() (the ONLY path into a real, usable view) is what restores it, so a
  // successful unlock/import/claim always ends with the nav back — see UI.boot()'s claimed
  // path (which calls UI.show/routeInitial next) and renderFirstRun's own import button
  // (which calls UI.show("rules") before the import even finishes).
  function hideBnav() { const el = $("#bnav"); if (el) el.hidden = true; }
  function showBnav() { const el = $("#bnav"); if (el) el.hidden = false; }

  // ============ ITEM 32 (2026-08-10) — Back walks the app, not out of it ============
  // User: "clicking back takes you to the previous page you were on in the app, not out of
  // chrome entirely." Before this, the app ran TWO half-systems at once and that inconsistency
  // WAS the bug: five views wrote `location.hash = …` (which pushes an entry for free, so Back
  // stepped back a view) while the other five changed view through a bare UI.show() that
  // touched history not at all (so Back left the app). Sometimes one, sometimes the other,
  // with nothing to tell the reader which they were about to get.
  //
  // ONE MECHANISM NOW: history.pushState, with the view's own hash written as that entry's URL.
  //   · pushState is what index.html already uses for the same problem (its HOME + NAV FIX
  //     BATCH), and it is the only one of the two that can also carry a NON-URL entry — which
  //     the overlay sentinels below need, since "the player card is open" is not a place you
  //     can link to and must not change the address bar.
  //   · writing the hash as the entry's URL is what keeps every existing deep link
  //     (#locker=<id>, #nflgame=<id>, #rules, #scores, #bracket, and ?fam=) working, and what
  //     makes a reload on any view restore that view — the URL stays the source of truth for
  //     WHICH view, exactly as it was.
  // Nothing listens for `hashchange`: traversing between two entries whose URLs differ only by
  // fragment fires BOTH popstate and hashchange, so a hashchange listener would double-route
  // every single Back press. There are no `href="#…"` links in this app (checked), which is the
  // only thing that could change the fragment without a popstate.
  //
  // THE SPLIT THAT MAKES THIS WORK: UI.show() is now a PURE RENDER and UI.go() is the ONE
  // navigator. Everything that is a repaint rather than a navigation — the live-poll repaint,
  // LG.db.onChange's quiet refresh after a background list(), the replay's
  // projections-just-landed repaint — keeps calling UI.show() and correctly leaves history
  // alone. Anything a PERSON did goes through UI.go(). Getting that backwards is what would
  // fill the stack with dozens of dead entries during a live game.
  const VIEW_HASHES = ["league", "matchup", "team", "moves", "chat", "rules", "bracket", "scores"];
  let navSeq = 0;
  // ---- overlays. ONE sentinel at a time (this app can only ever have one modal up: the player
  // card, the swap sheet, the claim sheet, the chat lightbox — none of them contains a control
  // that opens another). Back closes what is on top and goes no further; closing by the
  // overlay's own button/backdrop/Escape CONSUMES that entry with history.back(), so the stack
  // never keeps a dead one that would make the NEXT Back appear to do nothing.
  let ovlHide = null;
  UI.overlayOpened = function (hide) {
    // A second overlay opening while one is registered reuses the ONE sentinel rather than
    // stacking a second (defensive — no path in the app does this today).
    if (ovlHide && ovlHide !== hide) { try { ovlHide(); } catch (_) {} }
    else if (!ovlHide) { try { history.pushState({ gfflOverlay: true }, ""); } catch (_) {} }
    ovlHide = hide;
  };
  // The overlay closed by something other than Back — its own button, the backdrop, Escape, or
  // a re-render that destroyed its DOM. Give the sentinel back.
  UI.overlayClosed = function () {
    if (!ovlHide) return;
    ovlHide = null;
    try { if (history.state && history.state.gfflOverlay) history.back(); } catch (_) {}
  };
  // Hide + consume in one go. league.html's Escape handler and its backdrop taps use this.
  UI.closeTopOverlay = function () {
    if (!ovlHide) return false;
    const h = ovlHide;
    try { h(); } catch (_) {}
    UI.overlayClosed();
    return true;
  };
  // Hide the DOM and forget the registration WITHOUT touching history — for a caller that is
  // about to write the current entry itself (UI.go, below).
  function dropOverlayDom() {
    const h = ovlHide;
    ovlHide = null;
    if (h) { try { h(); } catch (_) {} }
  }
  UI._overlayOpen = () => !!ovlHide; // test hook

  // Every screen that is a real VIEW — i.e. one this history layer may route to. The gate, the
  // claim screen, the outage card and the replay's setup card are NOT in here on purpose.
  const REAL_VIEWS = ["league", "matchup", "moves", "chat", "rules", "bracket", "scores", "locker", "nflgame"];
  // "My Team" is the owner's own locker (merged 2026-08-07) — kept as a distinct nav entry and
  // hash for muscle memory, but there is no separate team view any more. Resolved in ONE place
  // so the navigator, the first paint and a Back press can never disagree about it.
  // PURE — it returns the resolution rather than applying it. An earlier cut wrote
  // UI.lockerTeamId here, and because the popstate handler resolves BEFORE asking "am I already
  // on this screen?", that write made the answer yes: a Back onto #team from another team's
  // locker compared the target against a state the resolution had already changed, decided
  // nothing had moved, and left the URL naming a screen that was no longer on the page.
  function resolveView(name) {
    if (name === "team") {
      const mine = LG.myTeamId();
      if (mine != null) return { name: "locker", locker: mine };
    }
    return { name };
  }
  function applyView(name) {
    const r = resolveView(name);
    if (r.locker != null) UI.lockerTeamId = r.locker;
    return r.name;
  }
  // The canonical URL for a view. Sub-views carry their subject, exactly as they always did.
  UI.hashFor = function (name) {
    if (name === "locker") return "#locker=" + UI.lockerTeamId;
    if (name === "nflgame") return "#nflgame=" + UI.nflGameId;
    return "#" + name;
  };
  // The ONE hash parser — shared by the first paint and by every Back/Forward, so a deep link
  // and a history entry can never be read differently.
  function viewFromHash(h) {
    const lockerM = /^#locker=(\d+)$/.exec(h || "");
    if (lockerM) return { name: "locker", locker: Number(lockerM[1]) };
    const gameM = /^#nflgame=(\d+)$/.exec(h || "");
    if (gameM) return { name: "nflgame", game: gameM[1] };
    const key = (h || "").slice(1);
    return { name: VIEW_HASHES.indexOf(key) >= 0 ? key : "league" };
  }
  // What is on screen right now, as one comparable string — a view plus whatever subject makes
  // it a distinct screen. Used to skip a pointless full re-render when a pop lands us exactly
  // where we already are (which is what the sentinel-consuming history.back() above does).
  function viewSig(name, ex) {
    ex = ex || {};
    if (name === "locker") return "locker:" + (ex.locker != null ? ex.locker : UI.lockerTeamId);
    if (name === "nflgame") return "nflgame:" + (ex.game != null ? ex.game : UI.nflGameId);
    if (name === "matchup") return "matchup:" + ((ex.mu || []).join("-"));
    return name;
  }
  function paintedSig() {
    return viewSig(UI.view, { locker: UI.lockerTeamId, game: UI.nflGameId, mu: UI.matchup || [] });
  }
  // THE INVARIANT: the URL always describes what is PAINTED. UI.show() is the repaint
  // primitive and anything may call it — the live poll, LG.db.onChange's quiet refresh, a
  // test — so if it ever left the address bar naming a different screen than the one on the
  // page, the next Back would resolve that stale URL and land the reader somewhere nobody
  // asked for. (That is not hypothetical: the suite drives ~50 view changes through UI.show,
  // and the first cut of this batch, which left the URL alone, sent a locker mid-edit to the
  // league home the moment a swap sheet closed.) Always a REPLACE — a repaint is not a place —
  // and it keeps whatever UI.go already recorded on this entry rather than flattening it.
  function syncUrlToView(name) {
    const url = UI.hashFor(name);
    if (location.hash === url) return;
    const sig = viewSig(name, { mu: UI.matchup || [] });
    const prev = history.state;
    const st = prev && prev.gfflView
      ? Object.assign({}, prev, { gfflView: name, sig })
      : { gfflView: name, sig, from: null, mu: name === "matchup" ? (UI.matchup || null) : null, n: ++navSeq };
    try { history.replaceState(st, "", url); } catch (_) {}
  }
  // THE navigator. Every gesture that means "take me somewhere" ends here.
  //   opts.replace — write the current entry instead of pushing one (the first paint, and any
  //                  correction that must not be a place Back can return to).
  UI.go = function (name, opts) {
    opts = opts || {};
    // BEFORE applyView, for the same reason the popstate handler captures it before resolving:
    // resolving "team" writes UI.lockerTeamId, so a signature taken afterwards would already
    // describe the destination. Tapping "My Team" from ANOTHER owner's locker would then look
    // like re-selecting the screen you are on, replace instead of push, and quietly cost the
    // reader the Back that should have returned them to the locker they came from.
    const wasSig = paintedSig();
    name = applyView(name);
    const url = UI.hashFor(name);
    // Standing on an overlay sentinel? Navigating away means that overlay is gone, so REUSE its
    // slot rather than pushing on top of it — otherwise Back from the new view would land on a
    // sentinel for an overlay that no longer exists and appear to do nothing.
    const onSentinel = !!ovlHide;
    dropOverlayDom();
    const sig = viewSig(name, { mu: UI.matchup || [] });
    // `from` is what lets a sub-view's own UP button (the NFL game's "‹ Scores") tell "the
    // reader tapped in from Scores" apart from "the reader deep-linked straight here".
    const st = { gfflView: name, sig, from: UI.view || null, mu: name === "matchup" ? (UI.matchup || null) : null, n: ++navSeq };
    try {
      // Re-selecting the screen you are already on is not a place in the history — replace, so
      // Back never has to be pressed twice to leave one view.
      if (opts.replace || onSentinel || sig === wasSig) history.replaceState(st, "", url);
      else history.pushState(st, "", url);
    } catch (_) {}
    UI.show(name);
  };
  window.addEventListener("popstate", function (e) {
    // (1) An overlay was on top: Back closes it, and nothing else moves. The pop itself already
    // consumed the sentinel, so there is no history call to make here.
    if (ovlHide) { const h = ovlHide; ovlHide = null; try { h(); } catch (_) {} return; }
    // (2) Only route when a real VIEW is on the page. UI.view is NOT the honest answer to
    // that — it defaults to "league" at module load and is only ever written by UI.show, so on
    // the gate, the claim screen, the outage card or the replay's setup card it still reads
    // "league", and a Back press would paint a league home over a screen that deliberately has
    // no usable app behind it yet. main()'s own data-view is stamped by every one of those
    // screens (the lesson simProjEnsureAndRepaint's note already records).
    const painted = main() && main().dataset ? main().dataset.view : "";
    if (REAL_VIEWS.indexOf(painted) < 0) return;
    // Captured BEFORE resolving anything — see resolveView's note on why the comparison must
    // not be able to see its own resolution.
    const before = paintedSig();
    const st = e.state || {};
    const v = viewFromHash(location.hash);
    const r = resolveView(v.name);
    const name = r.name;
    const locker = v.locker != null ? v.locker : r.locker;
    // The matchup a card opened is sticky state, not part of the URL, so it rides in the entry.
    // Only an entry WE wrote may set it; anything else leaves the reader's current pick alone.
    const mu = st.gfflView === "matchup" ? (st.mu || null) : (name === "matchup" ? UI.matchup : null);
    if (viewSig(name, { locker, game: v.game, mu: mu || [] }) === before) return;
    if (locker != null) UI.lockerTeamId = locker;
    if (v.game != null) UI.nflGameId = v.game;
    if (name === "matchup") UI.matchup = mu;
    UI.show(name);
  });

  UI.show = function (name) {
    name = applyView(name);
    // A repaint that replaces main()'s innerHTML destroys any sheet rendered inside it (the
    // swap sheet, the claim sheet — the player card and the chat lightbox are siblings of
    // main() and survive), so its registration has to go with it.
    // DOM ONLY, never history.back(): back() is asynchronous, so a call that both traverses AND
    // rewrites the URL in the same turn lands them in the wrong order — the traversal completes
    // a beat later and undoes the navigation the repaint just made. (Measured: it sent a Moves
    // page straight back to the locker it came from.) The syncUrlToView below writes over the
    // sentinel's own slot whenever the view is actually changing, which removes it just as
    // cleanly and synchronously. The one case it can't tidy is a background repaint of the SAME
    // view with a sheet open (cloud-only: LG.db.onChange; neither locker nor moves is
    // live-repainted) — that leaves one dead entry, so one Back press closes nothing visible
    // before the next walks the app. Rare, and strictly better than a race that moves the
    // reader somewhere they didn't ask to go.
    dropOverlayDom();
    syncUrlToView(name); // never let the address bar describe a screen that isn't on the page
    showBnav();
    UI.view = name;
    stopChatPoll(); // leaving whatever view had one open — chat/matchup-thread restart their own
    stopScoresPoll(); // ditto for the Scores tab's fantasy-scoreboard poll
    stopNflGamePoll(); // …and item 28's NFL game view — a poll must never outlive its view
    stopDraftCountdown(); // S2 — the league home's own ticking clock, same rule
    const myLocker = name === "locker" && UI.lockerTeamId === LG.myTeamId();
    // The NFL game view (item 28) is a SUB-VIEW of Scores — it has no nav entry of its own, so
    // the Scores tab stays lit while you're inside a game, the same way the own-locker case
    // keeps "My team" lit above.
    const navName = name === "nflgame" ? "scores" : name;
    document.querySelectorAll(".bnav button").forEach((b) =>
      b.classList.toggle("on", myLocker ? b.dataset.v === "team" : b.dataset.v === navName));
    // Marks which screen main() holds so CSS alone can special-case a view's
    // layout (the desktop multi-column league-home treatment) without any
    // further JS — league.html's own stylesheet reads this attribute.
    if (main()) main().dataset.view = name;
    paintHeader();
    applyDeskDisplay(); // the layout editor's GLOBAL text size rides every desktop tab
    if (name !== "league") UI._deskEdit = false; // leaving the dashboard closes its editor
    if (name === "league") renderLeague();
    else if (name === "matchup") renderMatchup();
    else if (name === "moves") renderMoves();
    else if (name === "rules") renderRules();
    else if (name === "chat") renderChat();
    else if (name === "locker") renderLocker();
    else if (name === "bracket") renderBracket();
    else if (name === "scores") renderScores();
    else if (name === "nflgame") renderNflGame();
  };
  // Reachable from anywhere a team name is tapped (standings, matchup header,
  // "My locker" on the team page) — plan §4.7 says lockers need no nav entry
  // of their own.
  UI.openLocker = function (teamId) {
    UI.lockerTeamId = Number(teamId);
    UI.go("locker");
  };
  // ---------------- the bottom-nav gesture (2026-08-09) ----------------
  // "the matchup tab should always show the matchup for that users team." UI.matchup is
  // STICKY by design — tapping any matchup card (league home, Scores tab, bracket) sets it and
  // the page keeps showing THAT game, including across every live repaint, because
  // renderMatchup(true) must never yank a reader out of a game they deliberately opened. So
  // the reset belongs on the NAV ENTRY specifically: pressing the Matchup tab is the one
  // gesture that means "take me to MY game", and it is the only thing that clears it.
  UI.navTo = function (name) {
    if (name === "matchup") UI.matchup = null;
    UI.go(name);
  };
  // Reachable from the league home's  Playoffs card (S7) — same no-nav-entry-needed
  // posture as lockers.
  UI.openBracket = function () {
    UI.go("bracket");
  };
  function wireLockerTaps(root) {
    (root || document).querySelectorAll("[data-locker]").forEach((el) => el.addEventListener("click", (e) => {
      e.stopPropagation();
      UI.openLocker(Number(el.dataset.locker));
    }));
  }

  // ---------------- player stats card (2026-08-08) ----------------
  // ONE full-screen overlay, reachable from anywhere a player is shown — matchup lineup rows
  // (both sides), locker rosters (the owner's own editable lineup + every other team's
  // read-only roster), the Moves free-agent table, the trade builder's roster pickers, and
  // the claims/trades lists. Every caller goes through UI.openPlayerCard(key);
  // wirePlayerCardTaps() is the one place that wires the click — any element bearing
  // `data-pk="<key>"`, anywhere in `document` (or a narrower `root`, for a render that only
  // rebuilt a subtree — see refreshFa() in Moves). Every render function that shows players
  // calls this once at the end of its own wiring, the same convention wireLockerTaps() above
  // already established for `[data-locker]`.
  // Idempotent (a dataset flag guards re-binding) — some render functions call this more than
  // once against overlapping DOM in one pass (e.g. renderMoves wires the FA table's own rows
  // via refreshFa(), then calls this again, unscoped, for the claims/trade-builder rows that
  // render alongside it) and must never double-fire a single tap.
  function wirePlayerCardTaps(root) {
    (root || document).querySelectorAll("[data-pk]").forEach((el) => {
      if (el.dataset.pcWired) return;
      el.dataset.pcWired = "1";
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        UI.openPlayerCard(el.dataset.pk);
      });
    });
  }
  async function playerCardHtml(key) {
    const d = D();
    const meta = d.metaForKey(key);
    const row = d.S.players.get(key);
    const g = d.S.games.get(d.slpTeam(meta.team));
    const pts = row && row.pts != null ? row.pts : null;
    const proj = d.projFor(key);
    const state = !g ? ""
      : g.state === "in" ? "Live — Q" + g.period + " " + g.clock
      : g.state === "post" ? "Final"
      : (g.kickoff ? "Kickoff " + shortKick(g) : "");
    const log = await d.gameLog(key);
    const tile = (label, v) => `<div class="pctile"><div class="pctileval">${v}</div><div class="pctilelabel mut small">${esc(label)}</div></div>`;
    // Newest week first — the same "most recent first" convention the feed/tx-log/chat lists
    // already use everywhere else in this app.
    const logRows = log.rows.slice().reverse().map((r) => {
      const opp = d.oppForWeek(r.week, meta.team); // "if-known" — see D.oppForWeek's own comment
      return `<tr><td>Wk ${r.week}</td><td class="mut">${esc(opp || "—")}</td><td class="num">${LG.fmtPts(r.pts)}</td></tr>`;
    }).join("");
    return `<div class="pccard">
      <button type="button" class="pcclose" id="pcClose" aria-label="Close">✕</button>
      <div class="pchead">
        <h2 class="pcname">${escn(meta.name)}</h2>
        <div class="pcmeta"><span class="posbadge" data-pos="${esc(meta.pos)}">${esc(meta.pos || "?")}</span>
          <span class="mut">${esc(meta.team || "")}</span>${injLabel(meta.injury) ? ` <span class="inj">${esc(injLabel(meta.injury))}</span>` : ""}</div>
      </div>
      <div class="pcweek">
        <div class="mut small">This week${UI.week != null ? " · Week " + UI.week : ""}</div>
        <div class="pcweekrow">
          <span class="pts">${pts != null ? LG.fmtPts(pts) : "—"}</span>
          <span class="mut small">proj ${proj != null ? LG.fmtPts(proj) : "—"}</span>
          ${state ? `<span class="mut small">${esc(state)}</span>` : ""}
        </div>
      </div>
      <div class="pctiles">
        ${tile("Season total", log.total != null ? LG.fmtPts(log.total) : "—")}
        ${tile("Avg / week", log.avg != null ? LG.fmtPts(log.avg) : "—")}
        ${tile("Best week", log.best != null ? LG.fmtPts(log.best) : "—")}
      </div>
      <div class="pclog"><h2 class="small mut">Game log</h2>
        ${log.rows.length ? `<div class="panner"><table class="tbl"><thead><tr><th>Wk</th><th>Opp</th><th class="num">Pts</th></tr></thead><tbody>${logRows}</tbody></table></div>`
          : '<p class="mut">No games yet.</p>'}
      </div>
    </div>`;
  }
  function hidePlayerCardDom() {
    const ov = $("#playerCard");
    if (ov) { ov.hidden = true; ov.innerHTML = ""; delete ov.dataset.pk; }
  }
  UI.closePlayerCard = function () {
    hidePlayerCardDom();
    UI.overlayClosed(); // ITEM 32 — give back the history entry the open pushed
  };
  // The game log is a real fetch (Sleeper's archived per-week stats, one request per finalized
  // week) — a "Loading…" placeholder paints INSTANTLY so a tap never feels dead, and the real
  // content replaces it once the log resolves. Guarded against the overlay having been closed,
  // or reopened for a DIFFERENT player, while the fetch was in flight — a slow response for
  // player A must never paint over player B's card, or over a closed one.
  UI.openPlayerCard = async function (key) {
    const ov = $("#playerCard");
    if (!ov) return;
    ov.dataset.pk = key;
    ov.innerHTML = '<div class="pccard center mut">Loading…</div>';
    ov.hidden = false;
    // ITEM 32: registered on the OPEN, not on the resolve — the card is on screen (as
    // "Loading…") from this instant, so Back has to mean "close it" from this instant too.
    UI.overlayOpened(hidePlayerCardDom);
    let html;
    try { html = await playerCardHtml(key); }
    catch (e) { html = '<div class="pccard center mut">Couldn’t load that player.</div>'; }
    if (ov.hidden || ov.dataset.pk !== key) return; // closed, or a different player opened meanwhile
    ov.innerHTML = html;
    const closeBtn = $("#pcClose");
    if (closeBtn) closeBtn.addEventListener("click", UI.closePlayerCard);
  };

  // ---------------- S6: trending chrome (2026-08-11) ----------------
  // ZERO EMOJI, deliberately — the app's own chrome rule (section U scans every rendered view
  // for a pictographic codepoint), so "the rest of the league is picking this man up" is a
  // word on a chip, not a flame. HOT = trending ADD, COLD = trending DROP; the count rides in
  // the title/aria so the chip itself stays two or three characters wide on a phone row.
  // Absent — every time — when D.trendingFor returns null, which is what it returns whenever
  // the endpoint is down, blocked or simply hasn't landed yet.
  function trendChip(key) {
    const t = D().trendingFor(key);
    if (!t) return "";
    const n = t.count.toLocaleString();
    const label = t.dir === "add" ? "Added in " + n + " leagues in the last 24h"
      : "Dropped in " + n + " leagues in the last 24h";
    return ` <span class="trendchip ${t.dir === "add" ? "up" : "down"}" title="${esc(label)}" aria-label="${esc(label)}">${t.dir === "add" ? "HOT" : "COLD"}</span>`;
  }
  // The "Hot pickups" strip: the top trending ADDS who are genuinely FREE in THIS league.
  // Sleeper's list is the whole NFL, so a player eight of our own teams already roster is
  // noise here — the owned filter is what makes the strip actionable rather than a news
  // ticker. Returns "" (and the strip renders nothing at all) when there is no trending data
  // or nothing on it is available.
  function hotPickupsHtml(ownedKeys) {
    const d = D();
    if (!d.S.slpPlayers) return "";
    const out = [];
    for (const t of d.trendingAdds(HOT_PICKUPS_N * 4)) {
      const m = d.S.slpPlayers.get(t.pid);
      if (!m || !m.name || !m.team) continue;
      const pos = m.pos === "DEF" ? "DST" : m.pos;
      const key = m.pos === "DEF" ? "dst_" + t.pid : (m.espn_id || "slp_" + t.pid);
      if (ownedKeys.has(key)) continue;
      out.push(`<button type="button" class="hotpick" data-pk="${esc(key)}">
        <span class="posbadge" data-pos="${esc(pos)}">${esc(pos || "?")}</span>
        <b>${escn(m.name)}</b><small class="mut">${esc(m.team)}</small>
        <span class="hotn mut">+${t.count.toLocaleString()}</span></button>`);
      if (out.length >= HOT_PICKUPS_N) break;
    }
    if (!out.length) return "";
    return `<div class="card hotcard"><h2>Hot pickups <span class="mut small">— most added across fantasy, last 24h</span></h2>
      <div class="hotrow">${out.join("")}</div></div>`;
  }

  // ---------------- S10: the centered drop / swap card (2026-08-11) ----------------
  // User: "when someone clicks add or swap on a player, rather than have it pull up this big
  // wide window at the bottom of the screen, have it pull up a card in the middle of the
  // screen to select a player to drop and this card should include their projected points and
  // % owned."
  //
  // The two bottom sheets (#claimSheet / #swapSheet, class .sheet) are GONE — element, class
  // and stylesheet rule. Both flows now render into ONE persistent centered overlay,
  // #rosterCard, which is a SIBLING of #main exactly like #playerCard and reuses that card's
  // own .pcoverlay backdrop rule, so "centered modal" has one definition in the stylesheet
  // rather than two that can drift apart.
  //
  // IT RIDES THE PLAYER CARD'S MODAL CONTRACT VERBATIM (item 32): openRosterCard() registers
  // ONE history sentinel, so system Back closes the card and leaves the reader exactly where
  // they were; every close that is NOT Back (✕, Cancel, the backdrop, Escape, submitting)
  // hands that entry straight back so the reader's next Back is a real view change. A modal
  // that breaks Back is the regression this app has already paid for once.
  //
  // Being a sibling of main() is also strictly better than the sheets were: a background
  // repaint of the SAME view used to DESTROY a sheet's DOM while its sentinel survived (the
  // one dead-entry case UI.show's own note documents). The card survives that, and UI.show's
  // dropOverlayDom() still closes it cleanly on a real view change.
  function hideRosterCardDom() { const ov = $("#rosterCard"); if (ov) { ov.hidden = true; ov.innerHTML = ""; } }
  UI.closeRosterCard = function () { hideRosterCardDom(); UI.overlayClosed(); };
  // ⚠ THE HIDE FUNCTION PASSED TO overlayOpened MUST BE A STABLE REFERENCE. That registrar
  // treats a DIFFERENT function while one is already registered as "a second overlay opened"
  // and runs the first one's hide — which, since both flows share this one element, would
  // wipe the card that had just been written into it. (Handing it a fresh arrow per open did
  // exactly that: the card painted and vanished in the same turn.) The player card gets this
  // right for free by passing its own named hidePlayerCardDom; this does the same, so
  // re-opening the card simply reuses the ONE sentinel already on the stack.
  function openRosterCard(html) {
    const ov = $("#rosterCard");
    if (!ov) return null;
    ov.innerHTML = html;
    ov.hidden = false;
    UI.overlayOpened(hideRosterCardDom);
    const c = $("#rcClose");
    if (c) c.addEventListener("click", UI.closeRosterCard);
    return ov;
  }

  // ---- % OWNED (S10). One batched call per card open, cached 30 min in memory. ----------
  // The number comes from ESPN's own fantasy API through sports.mjs's ff_pct_owned — the
  // league's rosters key players by ESPN player id, which is exactly what that action takes.
  // A key that ISN'T an espn id resolves through the Sleeper directory's own espn_id (that is
  // what slp_-prefixed keys are for); a team defense has no ESPN player id at all and simply
  // reads "—". EVERY failure path — no cookies, an expired cookie, an unreachable function, a
  // shape we don't recognise — leaves the column reading "—" for everyone and the card fully
  // usable. Percent-owned is context, never a gate on making a move.
  const PCT_TTL_MS = 30 * 60e3;
  UI._pctOwn = new Map();  // espn id (string) -> {pct: number|null, at}  (null = ESPN doesn't know him)
  UI._pctGate = null;      // {reason, at} — a FAILURE, cached for the same TTL so an
                           // unconfigured/expired backend is asked once, not once per card open.
  function espnIdForKey(key) {
    const k = String(key == null ? "" : key);
    if (/^\d+$/.test(k)) return k;                       // the ordinary case: the key IS the espn id
    if (k.startsWith("slp_")) {
      const m = D().S.slpPlayers && D().S.slpPlayers.get(k.slice(4));
      if (m && m.espn_id) return String(m.espn_id);
    }
    return null;                                          // dst_* and anything unresolvable
  }
  UI._espnIdForKey = espnIdForKey; // test hook
  async function ensurePctOwned(keys) {
    if (UI._pctGate && Date.now() - UI._pctGate.at < PCT_TTL_MS) return;
    const now = Date.now();
    const want = new Set();
    for (const k of (keys || [])) {
      const id = espnIdForKey(k);
      if (!id) continue;
      const hit = UI._pctOwn.get(id);
      if (hit && now - hit.at < PCT_TTL_MS) continue;
      want.add(id);
    }
    if (!want.size) return;
    let j = null;
    try { j = await sportsFn("ff_pct_owned", { ids: [...want].map(Number) }); } catch (e) { j = null; }
    if (!j || j.ok !== true) {
      UI._pctGate = { reason: (j && j.reason) || "fetch-failed", at: now };
      return;
    }
    UI._pctGate = null;
    const own = j.own || {};
    // Cache the MISSES too (as null): an id ESPN doesn't know will never be known, and
    // re-asking for him on every card open would be a request per open, forever.
    for (const id of want) UI._pctOwn.set(id, { pct: own[id] != null ? own[id] : null, at: now });
  }
  function pctOwnedText(key) {
    const id = espnIdForKey(key);
    const hit = id ? UI._pctOwn.get(id) : null;
    return hit && hit.pct != null ? Math.round(hit.pct) + "%" : "—";
  }
  UI._pctOwnedText = pctOwnedText; // test hook

  // The card's list is a 3-column grid — who / this week's projection / how much of the
  // fantasy world rosters him — with ONE header line rather than a label repeated on every
  // row. .swaprow is kept as the row class (it names what the row IS, a tap-to-pick row, not
  // where it lives) so its .picked state and every existing behavioural check keep working.
  function rcHeadHtml() {
    return '<div class="rchead"><span>Player</span><span class="num">Proj</span><span class="num">Own</span></div>';
  }
  function gameStateText(teamAb) {
    const d = D();
    const g = d.S.games.get(d.slpTeam(teamAb));
    if (!g) return "";
    if (g.state === "in") return "Q" + g.period + " " + g.clock;
    if (g.state === "post") return "Final";
    return g.kickoff ? shortKick(g) : "";
  }
  // p: a roster/candidate player. attrs: the data-attribute the flow's own click handler reads
  // ("data-di"/"data-ci"). opts.blocked: a reason string -> the row renders DISABLED and says
  // why, instead of silently not being there.
  function rcRowHtml(p, attrs, opts) {
    opts = opts || {};
    const d = D();
    const proj = d.projFor(p.key);
    const meta = [p.pos, p.team, opts.slot === false ? null : p.slot].filter(Boolean).join(" · ");
    const state = opts.game === false ? "" : gameStateText(p.team);
    const sub = [meta, state].filter(Boolean).join(" · ");
    return `<button type="button" class="swaprow" ${attrs}${opts.blocked
      ? ` disabled title="${esc(opts.blocked)}" aria-label="${esc(opts.blocked)}"` : ""}>
      <span class="rcwho"><b>${escn(p.name)}</b>
        <small class="mut">${esc(sub)}</small>${injChip(d, p)}${opts.blocked ? ` <small class="rcblock">${esc(opts.blocked)}</small>` : ""}</span>
      <span class="rcnum">${proj != null ? LG.fmtPts(proj) : "—"}</span>
      <span class="rcnum mut" data-pctkey="${esc(p.key)}">${esc(pctOwnedText(p.key))}</span>
    </button>`;
  }
  // Fill the % owned column once the batched call lands, WITHOUT rebuilding the card — a
  // rebuild would throw away a drop the reader had already picked and any bid they had typed.
  // Every cell that carries a percentage tags itself with its own key, so this is one text
  // write per cell and touches nothing else on the card.
  function paintPctOwned() {
    const ov = $("#rosterCard");
    if (!ov || ov.hidden) return;
    ov.querySelectorAll("[data-pctkey]").forEach((el) => { el.textContent = pctOwnedText(el.dataset.pctkey); });
  }

  function main() { return $("#main"); }
  function paintLive() {
    if (UI.view === "matchup") renderMatchup(true);
    else if (UI.view === "league") renderLeague(true);
    // "team" is gone (merged into locker — item 3). Deliberately NOT live-repainted on every poll
    // tick the way the old team page's points/proj were: renderLocker() has no lightweight
    // "repaint" mode (it's always the full Promise.all, unlike renderTeam's old repaint=true fast
    // path), and replacing main().innerHTML out from under an in-progress interaction (the swap
    // sheet open, a logo upload mid-flight) is a real regression, not just a perf one. The
    // lineup's points/proj simply refresh next time the locker is opened/re-opened.
    else if (UI.view === "scores") paintScores(); // NFL half only — the fantasy half has its own poll (startScoresPoll)
    paintHealth();
  }
  function paintHealth() {
    const h = D().S.health;
    const el = $("#healthChip");
    if (!el) return;
    // 2026-08-09 (user: "get rid of it"): this is a WARNING, not a status badge. A healthy
    // board has nothing to tell the reader, and under the replay the chip was also a standing
    // "you are in a test environment" reminder — the same reminder the banner was removed for.
    // So it is SILENT when the data is fine and appears only when a source is degraded or gone.
    // The ok/warn/bad classification itself is unchanged; only the healthy case stops painting.
    if (h.mode === "dual") { el.hidden = true; el.textContent = ""; el.className = "health"; return; }
    el.textContent = " " + h.note;
    el.className = "health " + (h.mode === "none" ? "bad" : "warn");
    el.hidden = false;
  }
  // Desktop-only header chrome (design's top-nav "WEEK 8 · 2026" + team avatar) —
  // hidden by CSS below 1024px, so this is pure decoration on mobile. Reads
  // UI.week/LG.rules/LG.myTeamId, none of which this function ever writes.
  function paintHeader() {
    simWarmProjections();
    syncOfflineChip();
    const meta = $("#hMeta");
    if (!meta || !LG.rules) return;
    meta.hidden = false;
    const wkEl = $("#hWeekYear");
    if (wkEl) wkEl.textContent = UI.week != null ? "Week " + UI.week + (LG.rules.season ? " · " + LG.rules.season : "") : "";
    const av = $("#hAvatar");
    if (!av) return;
    const tid = LG.myTeamId(), T = tid ? LG.teamById(tid) : null;
    if (!T) { av.hidden = true; return; }
    av.hidden = false;
    // S3: the header avatar is the ONE piece of persistent chrome that says whose league this
    // is, so it wears the viewer's own team colours (and, at last, an uploaded logo — this
    // read used to be `.logo` only, so a crest a person had uploaded themselves never appeared
    // in their own header).
    const avSrc = teamSrc(T);
    av.innerHTML = avSrc ? `<img src="${esc(avSrc)}" alt="">` : esc(initials(T.name));
    const avPal = LG.teamPalette(T);
    av.style.background = avPal.primary;
    av.style.color = avPal.ink;
    av.title = T.name || "";
  }
  // ITEM 18 (2026-08-09, user: "lets also get rid of the yellow banner, I know we are in a
  // test environment dont need that reminder"). The "2025 SEASON REPLAY" strip is gone, and so
  // is its projections-are-estimates note — the user has explicitly accepted losing that
  // disclosure, so it is NOT reinvented in a tooltip or anywhere else.
  // WHAT SURVIVES IT: the strip's paint function also WARMED the replay's projection cache on
  // every view change, which is the only reason projections resolved on a screen reached
  // before any matchup/moves/locker page had been opened. Deleting the strip and its function
  // together would have taken that with it, and projections would have silently stopped
  // resolving on some views. It keeps its own name and its own three call sites.
  function simWarmProjections() {
    if (!LG.SIM_2025) return;
    simProjEnsureAndRepaint(UI.view); // idempotent + loop-safe; see its own note
  }

  // ---------------- gate + claim ----------------
  function renderGate() {
    hideBnav();
    main().innerHTML = `<div class="card center">
      <div class="logo"></div><h1>The GFFL</h1>
      <p class="mut">The Goat Fantasy Football League</p>
      <input id="gatePass" type="password" placeholder="league passphrase" autocomplete="off">
      <button id="gateGo" class="primary">Enter the league</button>
      <p id="gateErr" class="bad" hidden>That's not it.</p></div>`;
    $("#gateGo").addEventListener("click", () => {
      if (LG.tryUnlock($("#gatePass").value)) UI.boot();
      else $("#gateErr").hidden = false;
    });
  }
  function renderClaim() {
    hideBnav();
    if (main()) main().dataset.view = "claim";
    paintHeader();
    main().innerHTML = `<div class="card">
      <h2>Who are you?</h2><p class="mut">Claim your team — this device remembers.</p>
      <div id="claimList">${LG.teams.map((t) => `
        <button class="teamrow" data-tid="${t.id}" style="${esc(LG.teamStyle(t))}">
          ${crestHtml(t, "teamrowcrest")}
          <span>${teamNameHtml(t, { cls: "teamrowname" })}<br><small class="mut">${esc(t.owner || "")}${t.claimedBy ? " · claimed by " + esc(t.claimedBy) : ""}</small></span>
        </button>`).join("")}</div></div>`;
    document.querySelectorAll(".teamrow").forEach((b) => b.addEventListener("click", async () => {
      if (await claimTeam(Number(b.dataset.tid))) UI.boot();
    }));
  }
  // ---------------- claiming a team (S1: owner PINs) ----------------
  // Two flows, chosen by whether the TEAM DOC already carries a pinHash — never by whether this
  // device happens to think the team is claimed:
  //   · no hash  → this is the team's first claim. Take a name, then set the PIN that will
  //                protect it. A cancelled or too-short PIN writes NOTHING at all: a claim that
  //                banked the name and skipped the lock would be the hole, not the fix.
  //   · a hash   → someone already owns this team. Prove it before the local claim is written,
  //                so a refused attempt leaves this device exactly as it was.
  // Returns true only when a claim was actually written.
  async function claimTeam(tid) {
    const T = LG.teamById(tid) || {};
    const nameOf = T.name || ("team " + tid);
    const have = await LG.teamPinHash(tid);
    if (have) {
      const pin = window.prompt("Enter " + nameOf + "'s PIN:");
      if (!pin) return false;
      if (!(await LG.verifyTeamPin(tid, pin))) { window.alert("Wrong PIN."); return false; }
      const nm = window.prompt("Your name:", LG.who() || T.claimedBy || T.owner || "");
      if (!nm) return false;
      LG.setWho(nm); LG.setMyTeamId(tid);
      // The name may legitimately differ (a new device, a nickname) — keep the doc honest, but
      // don't write a doc just to store the value it already holds.
      if (T.claimedBy !== nm) { try { await LG.saveTeam({ teamId: tid, claimedBy: nm }); } catch (e) { /* offline: the local claim stands */ } }
      return true;
    }
    const nm = window.prompt("Your name:", LG.who() || T.owner || "");
    if (!nm) return false;
    const pin = window.prompt("Set a PIN for " + nameOf + " (numbers, 4+ digits):");
    if (!pin) return false;
    if (!LG.validPin(pin)) { window.alert("A PIN needs at least 4 numbers. Nothing was claimed — tap your team to try again."); return false; }
    // DELTA only (adversarial review 2026-08-08, findings 4/10) — spreading the whole
    // in-memory team wrote this page's snapshot of every OTHER field back over good data.
    await LG.setTeamPin(tid, pin, { claimedBy: nm });
    LG.setWho(nm); LG.setMyTeamId(tid);
    return true;
  }
  UI._claimTeam = claimTeam; // test hook

  // ---------------- league home ----------------
  function teamStarters(teamId) {
    return (UI._rosters && UI._rosters[teamId] || []).filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  }
  // Item 3's matchup-page bench section — BENCH only (not IR, which doesn't score and isn't
  // part of either team's week).
  function teamBench(teamId) {
    return (UI._rosters && UI._rosters[teamId] || []).filter((p) => p.slot === "BENCH");
  }
  function liveTotal(teamId) {
    const d = D();
    return teamStarters(teamId).reduce((s, p) => {
      const row = d.S.players.get(p.key);
      return s + LG.n(row && row.pts != null ? row.pts : 0);
    }, 0);
  }
  async function loadWeekRosters() {
    UI._rosters = UI._rosters || {};
    // ONE list() up front instead of N per-doc reads. LG.db never caches a negative result
    // any more (findings 2/4/5/12), so without this every render re-read a real backend miss
    // for each team that has no roster doc for this week — on the cloud backend that's one
    // round trip per team, per render. A cached list of the kind answers "absent" for free,
    // and refreshes on its own 15s cadence rather than never.
    await LG.db.list("roster");
    // Boot-speed pass (2026-08-08): each team's roster is its own independent doc (own id,
    // own kind) — nothing here reads or writes anything another team's iteration touches, so
    // fetching them together (instead of one-at-a-time) turns N round trips into one.
    await Promise.all(LG.teams.map(async (t) => { UI._rosters[t.id] = await LG.ensureRoster(UI.week, t.id); }));
  }
  UI.renderLeague = renderLeague;
  // ---------------- unconfirmed emptiness (live bug, 2026-08-08) ----------------
  // The league is empty on screen and we CANNOT prove the league store said so — a blocked/
  // failed Firebase load (silent local fallback), or a Firestore query answered out of an
  // empty offline cache (see lg-core.js's SERVER-CONFIRMED EMPTINESS note). Offering "Import
  // the league from ESPN" here is the worst possible answer: it tells an owner whose league
  // has eight teams in Firestore that their league doesn't exist, and every write the import
  // then makes lands in whatever degraded store we fell back to. Say what actually happened,
  // and offer the only useful action.
  function renderOffline() {
    hideBnav();
    simWarmProjections();
    syncOfflineChip();
    const why = LG.backendError ? `<p class="mut small">Reason: ${esc(LG.backendError)}</p>` : "";
    main().innerHTML = `<div class="card center">
      <h2>Couldn't reach the league</h2>
      <p class="mut">Your teams, rosters and results are all still there — this device just
        can't get to them right now, and hasn't saved a copy yet. Check the connection and
        try again.</p>
      ${why}
      <button id="offlineRetry" class="primary">Try again</button>
      <p class="mut"><small>Nothing has been changed or lost.</small></p></div>`;
    $("#offlineRetry").addEventListener("click", async () => {
      const b = $("#offlineRetry");
      b.disabled = true; b.textContent = "Trying…";
      // BOUNDED BY CONSTRUCTION, and the button must prove it. LG.retryBackend() is one
      // fsFetch and every fsFetch carries an AbortController timeout, so this can no longer
      // hang — but the live incident that started this rework WAS a Retry stuck on "Trying…"
      // forever, so the button is also restored in a finally: no failure shape, expected or
      // not, may leave a dead control on screen.
      let reached = false;
      try { reached = await LG.retryBackend(); }
      catch (e) { LG._markDegraded(e); reached = false; }
      finally { if (b.isConnected) { b.disabled = false; b.textContent = "Try again"; } }
      // Re-render either way: on failure that restores a live button with the (possibly new)
      // reason; on success UI.boot() paints the real league over the top.
      if (!reached) { renderOffline(); toast("Still can't reach the league."); return; }
      await UI.boot().catch((e) => { LG._markDegraded(e); renderOffline(); });
    });
  }
  UI.renderOffline = renderOffline; // test hook
  // A brand-new league has no teams until the commissioner runs the one-time
  // ESPN import — without this card a fresh device landed on an EMPTY home
  // with nothing to claim and no path forward (live 2026-08-07).
  function renderFirstRun(repaint) {
    // FIRST-RUN IS ONLY EVER SHOWN ON SERVER-CONFIRMED EMPTINESS. LG.teamsConfirmed records,
    // at the moment LG.loadTeams() read them, whether that read came from the real league
    // store; an unconfirmed empty read is an outage, not a new league.
    if (!LG.teamsConfirmed) { renderOffline(); return; }
    hideBnav(); // even on the early-return repaint path below — UI.show() may have just re-shown it
    if (repaint && $("#firstImport")) return; // never churn the button under a tap
    main().innerHTML = `<div class="card center">
      <div class="logo"></div><h2>Welcome to the GFFL</h2>
      <p class="mut">The league isn't set up yet — the teams, rules and scoring
        all come in from the family's ESPN league in one step.</p>
      <button id="firstImport" class="primary">Import the league from ESPN</button>
      <p class="mut"><small>Commissioner PIN required. Everyone claims their team right after.</small></p></div>`;
    $("#firstImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      UI.show("rules");
      // Never let this tap end in silence: a throw anywhere in the import chain used to be an
      // unhandled rejection with nothing on screen — the whole "the import isn't working"
      // report (live 2026-08-08).
      try { await importFromEspn(); } catch (e) { importFail(importOut(), "Import failed", e); }
    });
  }
  //  Power rankings card (plan §4.9): the LATEST finalized week's snapshot, ordered by rank,
  // with a movement arrow against the PRIOR finalized week's own snapshot for the same team
  // (blank on week 1 — nothing to move against). Renders nothing at all until at least one week
  // is official — a ranking of an unplayed season would be meaningless.
  // MOBILE ONLY since the desktop design pass (2026-08-11): on a desktop the rank is a column
  // in the standings table (PWR), so a whole second card restating the same order is redundant
  // chrome. The computation moved to LG.powerRanking() so the card and that column read from
  // ONE list and can never disagree.
  function powerRankingsHtml(weeklyDocs) {
    const pr = LG.powerRanking(weeklyDocs);
    if (!pr) return "";
    const rows = pr.rows.map((r) => {
      const T = LG.teamById(r.teamId);
      const move = r.prevRank == null ? '<span class="mut">–</span>'
        : r.prevRank > r.rank ? `<span class="delta up">▲${r.prevRank - r.rank}</span>`
        : r.prevRank < r.rank ? `<span class="delta down">▼${r.rank - r.prevRank}</span>`
        : '<span class="mut">–</span>';
      return `<div class="rowline"><span>#${r.rank} <span class="teamlink" data-locker="${r.teamId}">${logoTd(T)}${teamNameHtml(T)}</span></span>
        <span>${move} <span class="mut small">${r.score}</span></span></div>`;
    }).join("");
    return `<div class="card"><h2>Power rankings <span class="mut">— through week ${pr.week}</span></h2>${rows}</div>`;
  }
  // ---------------- standings (2026-08-11 desktop pass) ----------------
  // ONE builder, two shapes. MOBILE is byte-for-byte what it always was — # / Team / W / L /
  // PF / PA inside a .panner, because three more columns on a 390px phone is three more columns
  // to pan past. DESKTOP is the user's own list — "win/loss streak, power ranking, playoff
  // probability %" — and carries the batch's hardest constraint: NO SCROLL AT ALL. No .panner,
  // no max-height, and the whole table has to fit the MAIN column at 1024px (the tightest legal
  // desktop, ~620px of content). That is paid for out of the type and the padding (a .standtbl
  // rule in league.html), and out of PF/PA dropping their decimals — a tenth of a point in a
  // season total is not what anyone reads a standings table for, and the matchup pages carry
  // the exact figures.
  function standingsHtml(rows, st, opts) {
    opts = opts || {};
    const wide = !!opts.wide;
    const streaks = opts.streaks || {};
    const odds = opts.odds || {};
    const pwr = {};
    if (opts.power) for (const r of opts.power.rows) pwr[r.teamId] = r.rank;
    // The T column earns its place only if somebody has actually tied.
    const anyTie = wide && rows.some((t) => ((st[t.id] || {}).t || 0) > 0);
    const head = wide
      ? `<tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th>${anyTie ? '<th class="num">T</th>' : ""}
         <th class="num">PF</th><th class="num">PA</th><th class="num">Streak</th><th class="num">Pwr</th><th class="num">Playoff</th></tr>`
      : `<tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PF</th><th class="num">PA</th></tr>`;
    const body = rows.map((t, i) => {
      const s = st[t.id] || { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
      // S3: the standings row is where most people meet most teams, so the crest grew
      // 20 -> 28px and the name takes the team's own (contrast-clamped) ink. Fill-only
      // treatment at this size — see teamNameHtml.
      const idcell = `<tr><td class="mut">${i + 1}</td><td><span class="teamlink" data-locker="${t.id}">${logoTd(t)}${teamNameHtml(t)}</span></td>
        <td class="num">${s.w}</td><td class="num">${s.l}</td>`;
      if (!wide) return idcell + `<td class="num">${LG.fmtNum(s.pf)}</td><td class="num">${LG.fmtNum(s.pa)}</td></tr>`;
      const stk = streaks[t.id] || null;
      // A run is coloured by what it IS — the app's own good/bad language — but only ever
      // when there is a run; "—" stays quiet ink.
      const stkCls = !stk ? "mut" : stk.k === "W" ? "stkw" : stk.k === "L" ? "stkl" : "mut";
      const rank = pwr[t.id];
      const po = odds[t.id];
      const poCls = po == null ? "mut" : po >= 100 ? "poin" : po <= 0 ? "poout" : "";
      const poTxt = po == null ? "—" : po + "%";
      return idcell
        + (anyTie ? `<td class="num">${s.t || 0}</td>` : "")
        + `<td class="num">${Math.round(LG.n(s.pf))}</td><td class="num">${Math.round(LG.n(s.pa))}</td>
           <td class="num ${stkCls}">${esc(LG.fmtStreak(stk))}</td>
           <td class="num">${rank == null ? '<span class="mut">—</span>' : "#" + rank}</td>
           <td class="num ${poCls}">${poTxt}</td></tr>`;
    }).join("");
    const table = `<table class="tbl standtbl"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    // The whole point of the desktop table: it is NOT wrapped in a scroller.
    return `<div class="card standcard"><h2>Standings</h2>${wide ? table : `<div class="panner">${table}</div>`}</div>`;
  }
  // ---------------- ALL-TIME (2026-08-11 desktop pass) ----------------
  // The record book, reduced to the one thing the user asked to keep: "record book should show
  // all time standings, again no scrolling needed and everything else should be hidden." So on
  // a desktop the champions / highest week / biggest blowout / best-season-PF superlatives are
  // ABSENT — not collapsed, absent — and what remains is the aggregate table, open, unscrolled.
  // Mobile's record book keeps every one of them behind its own <details>; this is a second
  // reader of the SAME LG.recordBook() data, never a second computation.
  // The card renders NOTHING AT ALL when there is no history — an "all-time standings" heading
  // over an empty table is chrome, not information (matchupHeroExtra's own rule, applied to a
  // card).
  function allTimeHtml(rb) {
    if (!rb || !rb.hasData || !rb.standings || !rb.standings.length) return "";
    // The crest + the team's own ink, exactly as the standings table above it renders them —
    // the two tables sit one under the other on this page and must read as one family. Safe
    // because recordBook's own live() gate means every row here IS a current franchise, so
    // teamById always resolves (a folded team never reaches this list).
    const rows = rb.standings.map((s, i) => {
      const T = LG.teamById(s.teamId);
      return `<tr><td class="mut">${i + 1}</td>
        <td><span class="teamlink" data-locker="${s.teamId}">${logoTd(T)}${T ? teamNameHtml(T) : esc(s.name)}</span></td>
        <td class="num">${s.w}</td><td class="num">${s.l}</td>
        <td class="num">${Math.round(LG.n(s.pf))}</td><td class="num">${s.titles}</td></tr>`;
    }).join("");
    return `<div class="card alltimecard"><h2>All-time</h2>
      <table class="tbl standtbl"><thead><tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th>
        <th class="num">PF</th><th class="num">Titles</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }
  // ---------------- the desktop rail (2026-08-11) ----------------
  // "Chat should be in the top right and always expanded, recent moves should also start as
  // expanded." Neither is a <details> here: a disclosure whose answer is always "open" is a
  // control that does nothing. The chat panel is the FULL widget (list + composer), not the
  // six-line preview the phone shows — the rail is where the league's talk lives, so it has to
  // be talkable-in. Its message list keeps its own internal scroll (that is what "always
  // expanded" means about the PANEL, not about height): league.html caps the panel around
  // 560px so the moves card beneath it is never pushed off the fold.
  function deskChatPanelHtml() {
    return `<div class="card chatcard chatpanel" id="deskChatPanel"><h2>League chat</h2>${chatWidgetHtml("chat")}</div>`;
  }
  function deskMovesHtml(tx) {
    const recent = (tx || []).slice(0, 14); // 8 → 14 (2026-08-11 rail balance)
    return `<div class="card movespanel"><h2>Recent moves</h2>
      ${recent.length ? recent.map((t) => `<div class="fline sys"><span class="mut">${new Date(t.t).toLocaleDateString()}</span> ${esc(txSentence(t))}</div>`).join("")
        : '<p class="mut">No moves yet.</p>'}
      <button id="recentMovesAll" class="mut">View all →</button></div>`;
  }

  // ---------------- THE DESKTOP LAYOUT EDITOR (2026-08-11) ----------------
  // User: "give me the ability to make edits directly to the desktop page layouts …
  // not just cards but also formatting of text and text size."
  //
  // Every desktop dashboard card is a REGISTRY entry, and the arrangement is a per-DEVICE
  // preference (localStorage — layout is a viewing preference like the calendar view was,
  // not league state; no cloud write, no offline-mirror interaction, no race surface).
  // A pencil above the dashboard opens edit mode: per-card ▴▾ reorder, ◂▸ column move,
  // per-card text size, Hide (with a Show tray in the bar), plus GLOBAL text size and a
  // density toggle in the bar. Text size is implemented as CSS zoom — the stylesheet is
  // px-based throughout, so a font-size multiplier on an ancestor would move NOTHING; zoom
  // scales text and boxes together, which is what "bigger text" means on a dashboard.
  // The global size applies to every league.html tab on a desktop; per-card size and card
  // arrangement are the dashboard's own. Phones are byte-untouched (wide branch only).
  //
  // SANITIZED ON EVERY READ: unknown ids are dropped, and a card this device's saved layout
  // has never heard of (a future addition) lands at the END of its default column rather
  // than vanishing — the fitness-plan tombstone lesson, applied to layout.
  const DESK_LAYOUT_KEY = "gffl_desklayout";
  const DESK_MAIN = ["countdown", "links", "stale", "week", "playoffs", "standings", "alltime"];
  const DESK_RAIL = ["chat", "injury", "hot", "accuracy", "moves"];
  const DESK_LABELS = {
    countdown: "Draft countdown", links: "Rules & Draft links", stale: "Unsettled weeks",
    week: "This week's games", playoffs: "Playoffs", standings: "Standings", alltime: "All-time",
    chat: "League chat", injury: "Injury report", hot: "Hot pickups",
    accuracy: "Projection accuracy", moves: "Recent moves",
  };
  const DESK_SCALE_STEPS = [85, 92, 100, 108, 116, 125]; // global, %
  const DESK_CZ_STEPS = [100, 115, 130, 85];             // per-card cycle, %
  function deskLayoutDefault() {
    return { main: DESK_MAIN.slice(), rail: DESK_RAIL.slice(), hidden: [], scale: 100, density: "comfortable", cz: {} };
  }
  function deskLayout() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(DESK_LAYOUT_KEY) || "null"); } catch (e) { /* corrupt = default */ }
    const def = deskLayoutDefault();
    if (!raw || typeof raw !== "object") return def;
    const known = new Set([...DESK_MAIN, ...DESK_RAIL]);
    const seen = new Set();
    const col = (a) => (Array.isArray(a) ? a : []).filter((id) => {
      if (!known.has(id) || seen.has(id)) return false;
      seen.add(id); return true;
    });
    const out = {
      main: col(raw.main), rail: col(raw.rail),
      hidden: (Array.isArray(raw.hidden) ? raw.hidden : []).filter((id) => known.has(id)),
      scale: DESK_SCALE_STEPS.includes(raw.scale) ? raw.scale : 100,
      density: raw.density === "compact" ? "compact" : "comfortable",
      cz: {},
    };
    for (const id of DESK_MAIN) if (!seen.has(id)) { out.main.push(id); seen.add(id); }
    for (const id of DESK_RAIL) if (!seen.has(id)) { out.rail.push(id); seen.add(id); }
    if (raw.cz && typeof raw.cz === "object") {
      for (const k of Object.keys(raw.cz)) {
        if (known.has(k) && DESK_CZ_STEPS.includes(raw.cz[k]) && raw.cz[k] !== 100) out.cz[k] = raw.cz[k];
      }
    }
    return out;
  }
  function deskLayoutSave(l) { try { localStorage.setItem(DESK_LAYOUT_KEY, JSON.stringify(l)); } catch (e) { /* quota = this stays a session preference */ } }
  function deskLayoutIsDefault(l) { return JSON.stringify(l) === JSON.stringify(deskLayoutDefault()); }
  function deskCardWrap(id, lay, editing, renderCard) {
    const cz = lay.cz[id];
    const czAttr = cz ? ` data-cz="${cz}"` : "";
    const html = (renderCard[id] || (() => ""))();
    if (!editing) return `<div class="deskcard" data-card="${id}"${czAttr}>${html}</div>`;
    // Edit mode: an empty self-hiding card (no injuries, cold trending, drafted countdown)
    // still has to be POSITIONABLE, so it renders as a labelled placeholder shell.
    const col = lay.main.includes(id) ? "main" : "rail";
    const strip = `<div class="deskedit">
      <b>${esc(DESK_LABELS[id] || id)}</b>
      <button type="button" data-dla="up" data-dlid="${id}" title="Move up" aria-label="Move ${esc(DESK_LABELS[id] || id)} up">▴</button>
      <button type="button" data-dla="down" data-dlid="${id}" title="Move down" aria-label="Move ${esc(DESK_LABELS[id] || id)} down">▾</button>
      <button type="button" data-dla="side" data-dlid="${id}" title="${col === "main" ? "Move to the side rail" : "Move to the main column"}">${col === "main" ? "▸" : "◂"}</button>
      <button type="button" data-dla="cz" data-dlid="${id}" title="This card's text size">A ${cz || 100}%</button>
      <button type="button" data-dla="hide" data-dlid="${id}" title="Hide this card">Hide</button>
    </div>`;
    const bare = html.replace(/<[^>]*>/g, "").trim();
    const body = bare ? html : `<div class="card deskempty"><h2>${esc(DESK_LABELS[id] || id)}</h2><p class="mut small">Nothing to show right now — this card appears when it has data.</p></div>`;
    return `<div class="deskcard" data-card="${id}"${czAttr}>${strip}${body}</div>`;
  }
  function deskBarHtml(lay, editing) {
    if (!editing) {
      return `<div class="lgdeskbar"><button type="button" id="deskLayoutBtn" class="deskpencil" title="Edit this page's layout" aria-label="Edit this page's layout">
        <svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M14.06 2.94a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12L7.5 15.5 3 17l1.5-4.5 9.56-9.56Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Edit layout</button></div>`;
    }
    const hiddenChips = lay.hidden.map((id) => `<button type="button" data-dla="show" data-dlid="${id}">+ ${esc(DESK_LABELS[id] || id)}</button>`).join(" ");
    return `<div class="lgdeskbar editing">
      <b>Editing layout</b>
      <span class="dlgroup">Text size
        <button type="button" data-dla="scaledn" title="Smaller text everywhere">A−</button>
        <span class="dlval">${lay.scale}%</span>
        <button type="button" data-dla="scaleup" title="Bigger text everywhere">A+</button>
      </span>
      <span class="dlgroup">Spacing
        <button type="button" data-dla="density">${lay.density === "compact" ? "Compact" : "Comfortable"}</button>
      </span>
      ${lay.hidden.length ? `<span class="dlgroup">Hidden: ${hiddenChips}</span>` : ""}
      ${deskLayoutIsDefault(lay) ? "" : `<button type="button" data-dla="reset">Reset to default</button>`}
      <button type="button" data-dla="done" class="dldone">Done</button>
    </div>`;
  }
  function deskLayoutAction(a, id) {
    if (a === "done") { UI._deskEdit = false; renderLeague(); return; }
    if (a === "reset") { try { localStorage.removeItem(DESK_LAYOUT_KEY); } catch (e) {} renderLeague(); return; }
    const l = deskLayout();
    if (a === "scaleup" || a === "scaledn") {
      const i = DESK_SCALE_STEPS.indexOf(l.scale);
      l.scale = DESK_SCALE_STEPS[Math.min(DESK_SCALE_STEPS.length - 1, Math.max(0, i + (a === "scaleup" ? 1 : -1)))];
    } else if (a === "density") {
      l.density = l.density === "compact" ? "comfortable" : "compact";
    } else if (a === "cz") {
      const cur = l.cz[id] || 100;
      const next = DESK_CZ_STEPS[(DESK_CZ_STEPS.indexOf(cur) + 1) % DESK_CZ_STEPS.length];
      if (next === 100) delete l.cz[id]; else l.cz[id] = next;
    } else if (a === "hide") {
      if (!l.hidden.includes(id)) l.hidden.push(id);
    } else if (a === "show") {
      l.hidden = l.hidden.filter((x) => x !== id);
    } else if (a === "up" || a === "down") {
      const colName = l.main.includes(id) ? "main" : "rail";
      const arr = l[colName], i = arr.indexOf(id), dir = a === "up" ? -1 : 1;
      // Swap with the nearest VISIBLE neighbour — stepping onto a hidden card's slot would
      // be an invisible move that looks like a dead button.
      let j = i + dir;
      while (j >= 0 && j < arr.length && l.hidden.includes(arr[j])) j += dir;
      if (j < 0 || j >= arr.length) return;
      arr.splice(i, 1); arr.splice(Math.min(j, arr.length), 0, id);
    } else if (a === "side") {
      const from = l.main.includes(id) ? "main" : "rail", to = from === "main" ? "rail" : "main";
      l[from].splice(l[from].indexOf(id), 1); l[to].push(id);
    } else return;
    deskLayoutSave(l);
    renderLeague();
  }
  UI.deskLayoutAction = deskLayoutAction; // test hook
  UI.deskLayout = deskLayout;            // test hook
  let deskLayoutWired = false;
  function wireDeskLayout() {
    if (deskLayoutWired) return;
    deskLayoutWired = true;
    document.addEventListener("click", (e) => {
      if (UI.view !== "league") return;
      const btn = e.target.closest && e.target.closest("#deskLayoutBtn,[data-dla]");
      if (!btn) return;
      if (btn.id === "deskLayoutBtn") { UI._deskEdit = true; renderLeague(); return; }
      deskLayoutAction(btn.dataset.dla, btn.dataset.dlid);
    });
  }
  // The GLOBAL text size rides every league.html tab on a desktop. CSS zoom, not font-size:
  // the stylesheet is px-based, so only zoom actually moves the type. #main is the scope —
  // the header, nav and the overlay siblings (player card, roster card) stay at 100%, so
  // modal geometry and the sticky chrome are never distorted.
  function applyDeskDisplay() {
    const el = main();
    if (!el) return;
    const lay = deskLayout();
    el.style.zoom = isWide() && lay.scale !== 100 ? String(lay.scale / 100) : "";
    const desk = el.querySelector(".lgdesk");
    if (desk) desk.classList.toggle("compact", lay.density === "compact");
  }
  //  Projection accuracy card (plan §5's scoreboard): our own running miss vs OUR pre-game
  // snapshots. Never rendered as a comparison to ESPN — that data isn't logged (see the S5 plan
  // entry) — and never rendered at all until there's at least one real player-week to report,
  // so the card can never make an unbacked claim.
  function accuracyHtml(acc) {
    if (!acc) return "";
    return `<div class="card"><h2>Projection accuracy</h2>
      <p class="mut small">Our projections: avg miss ${acc.avg} pts/player over ${acc.n} player-week${acc.n === 1 ? "" : "s"}.</p></div>`;
  }
  // League injury report (S9, plan "the news that is actually reachable") — the last real
  // designation CHANGES this league has seen, newest first, off LG.loadInjuryFeed(). ABSENT
  // ENTIRELY when there's nothing to show (matchupHeroExtra's own reasoning for its "unknown"
  // state, applied to a whole card) — an empty "no injury news" card is more chrome to scroll
  // past, not information. Each row opens the player's own stats card (data-pk, wired by
  // wirePlayerCardTaps at the end of renderLeague — the same convention as every other player
  // row in this app), so "what's actually wrong with him" is one tap away.
  function injuryFeedCardHtml(rows) {
    if (!rows || !rows.length) return "";
    const line = (r) => {
      const from = injWord(r.from), to = injWord(r.to);
      const t = LG.teamById(r.teamId);
      // "to Healthy" is good news, not a warning — only an ongoing real designation gets the
      // accent tint (matches .inj's own "colour = needs your attention" convention elsewhere).
      const toHtml = to === "Healthy" ? esc(to) : `<b class="injto">${esc(to)}</b>`;
      return `<button type="button" class="fline injline" data-pk="${esc(r.key)}">
        <b>${escn(r.name)}</b>: ${esc(from)} → ${toHtml}${t ? ` <span class="mut small">· ${esc(teamTag(t))}</span>` : ""}
      </button>`;
    };
    return `<div class="card"><h2>League injury report</h2>${rows.slice(0, 8).map(line).join("")}</div>`;
  }
  //  Record book card (plan §4.8): collapsed by default so it doesn't crowd the home page —
  // champions, the biggest single-week score/blowout ever, best season PF, and the all-time
  // standings, all combined from imported ESPN history + this season's own finalized weeks.
  // Empty state (nothing imported, nothing finalized yet) points the commissioner at Rules.
  //
  // Boot-speed pass (2026-08-08): the DATA behind this card (LG.recordBook() — it walks the
  // whole imported history PLUS every finalized week) is no longer fetched as part of the
  // league home's own render at all. `rb === undefined` means "not loaded yet" — a real
  // sentinel distinct from "loaded, and there's genuinely nothing to show" (rb.hasData ===
  // false), so the card still renders its collapsed shell instantly and only does the real
  // work the moment someone actually opens it (wireLazyLeagueDetails below).
  function recordBookHtml(rb) {
    if (rb === undefined) {
      return `<div class="card"><details class="recordbook" id="rbDetails"><summary>Record book</summary>
        <p class="mut small">Champions, records, all-time standings — tap to load.</p></details></div>`;
    }
    if (!rb || !rb.hasData) {
      return `<div class="card"><details class="recordbook" id="rbDetails"><summary>Record book</summary>
        <p class="mut">No history imported yet.${isCommish() ? " Import it from the Rules page." : ""}</p></details></div>`;
    }
    const champRows = rb.champs.length
      ? rb.champs.map((c) => `<div class="fline">${c.season}: <span class="teamlink" data-locker="${c.teamId}">${esc(c.name)}</span></div>`).join("")
      : '<p class="mut small">No champions on file yet.</p>';
    const hwRow = rb.highestWeek
      ? `<div class="fline"><span class="teamlink" data-locker="${rb.highestWeek.teamId}">${esc(rb.highestWeek.name)}</span> —
          ${LG.fmtPts(rb.highestWeek.pts)} <span class="mut">(wk ${rb.highestWeek.week}, ${rb.highestWeek.season})</span></div>`
      : '<p class="mut small">—</p>';
    const bbRow = rb.biggestBlowout
      ? `<div class="fline"><span class="teamlink" data-locker="${rb.biggestBlowout.homeId}">${esc(rb.biggestBlowout.homeName)}</span>
          ${LG.fmtPts(rb.biggestBlowout.homePts)} — ${LG.fmtPts(rb.biggestBlowout.awayPts)}
          <span class="teamlink" data-locker="${rb.biggestBlowout.awayId}">${esc(rb.biggestBlowout.awayName)}</span>
          <span class="mut">(margin ${LG.fmtPts(rb.biggestBlowout.margin)}, wk ${rb.biggestBlowout.week}, ${rb.biggestBlowout.season})</span></div>`
      : '<p class="mut small">—</p>';
    const pfRow = rb.bestSeasonPF
      ? `<div class="fline"><span class="teamlink" data-locker="${rb.bestSeasonPF.teamId}">${esc(rb.bestSeasonPF.name)}</span> —
          ${LG.fmtPts(rb.bestSeasonPF.pf)} <span class="mut">(${rb.bestSeasonPF.season})</span></div>`
      : '<p class="mut small">—</p>';
    return `<div class="card"><details class="recordbook" id="rbDetails">
      <summary>Record book</summary>
      <h2 class="small mut">Champions</h2>${champRows}
      <h2 class="small mut">Highest single-week score ever</h2>${hwRow}
      <h2 class="small mut">Biggest blowout</h2>${bbRow}
      <h2 class="small mut">Best season, points for</h2>${pfRow}
      <h2 class="small mut">All-time standings</h2>
      <div class="panner"><table class="tbl">
        <thead><tr><th></th><th>Team</th><th class="num">W</th><th class="num">L</th><th class="num">PF</th><th class="num">Titles</th></tr></thead>
        <tbody>${rb.standings.map((s, i) => `<tr><td class="mut">${i + 1}</td>
            <td><span class="teamlink" data-locker="${s.teamId}">${esc(s.name)}</span></td>
            <td class="num">${s.w}</td><td class="num">${s.l}</td><td class="num">${LG.fmtNum(s.pf)}</td><td class="num">${s.titles}</td></tr>`).join("")}
        </tbody></table></div>
    </details></div>`;
  }
  //  Recent moves card — the last 8 transactions-log sentences on the league home, so the
  // drama is visible without a dedicated trip to Moves. Reuses txSentence (defined further
  // down, in the Moves section) — same wording as the full log.
  //
  // Boot-speed pass (2026-08-08): LG.loadTx() (the whole transaction log) is no longer fetched
  // up front — `tx === undefined` means "not loaded yet" (a real sentinel, distinct from
  // "loaded, and there are genuinely no moves") so the card renders instantly and only does
  // the real read once opened (wireLazyLeagueDetails). "View all →" needs no fetched data at
  // all — it's a plain nav link into the full Moves log — so it's present either way.
  function recentMovesHtml(tx) {
    if (tx === undefined) {
      return `<div class="card"><details class="collapsecard" id="txDetails"><summary>Recent moves</summary>
        <p class="mut small">Tap to load the latest waiver claims, drops and trades.</p>
        <button id="recentMovesAll" class="mut">View all →</button></details></div>`;
    }
    const recent = tx.slice(0, 8);
    return `<div class="card"><details class="collapsecard" id="txDetails">
      <summary>Recent moves</summary>
      ${recent.length ? recent.map((t) => `<div class="fline sys"><span class="mut">${new Date(t.t).toLocaleDateString()}</span> ${esc(txSentence(t))}</div>`).join("")
        : '<p class="mut">No moves yet.</p>'}
      <button id="recentMovesAll" class="mut">View all →</button>
    </details></div>`;
  }
  // Item 16 (2026-08-09): Rules and Draft came out of the bottom nav and live here, high on
  // the League page so neither needs hunting for. They are DELIBERATELY different elements
  // because they are different kinds of destination and should behave like it:
  //   · Rules is an in-app view — a <button> through UI.navTo, the same navigation the tab
  //     used, so nothing about how the view is entered changes.
  //   · Draft leaves league.html entirely for ffdraft.html — a real <a href>, so middle-click,
  //     long-press and open-in-new-tab all still work, which a JS handler would take away.
  // S2: once the draft is more than 6h behind us, the big countdown card (below) is gone
  // entirely and all that's left is this one quiet line — inside the existing links card, and
  // deliberately AFTER the two buttons (not first position), so it reads as a settled fact
  // rather than something still asking for attention.
  function leagueLinksHtml(rules) {
    const ds = draftState(rules);
    const draftedLine = ds && ds.phase === "drafted"
      ? `<p class="mut small draftedline">Drafted ✓ <span class="mut">${esc(draftDateLabel(ds.target))}</span></p>` : "";
    return `<div class="card leaguelinks">
      <button type="button" class="navlinkbtn" id="lnkRules">Rules &amp; settings
        <span class="mut small">Scoring, roster, waivers, keepers</span></button>
      <a class="navlinkbtn" id="lnkDraft" href="ffdraft.html">Draft room
        <span class="mut small">Opens the keeper draft board</span></a>
      ${draftedLine}
    </div>`;
  }
  //  League chat card — the last 6 main-channel messages, collapsed the same way the record
  // book is. Same lazy sentinel as recentMovesHtml above — `chat === undefined` means "not
  // loaded yet".
  // RESTAGED 2026-08-09 (item 15): sys posts used to be INCLUDED here on the grounds that they
  // "ARE the league's own timeline". The user's answer to that is the transactions card right
  // above this one — chat is for what people say. This is the third chat surface, so it
  // filters exactly like the other two.
  function recentChatHtml(chat) {
    const line = (m) => {
      const who = (LG.teamById(m.teamId) || {}).name || m.who || "?";
      const body = m.text || (m.img ? "[photo]" : m.gif ? "[gif]" : "");
      return `<div class="fline"><b>${esc(who)}:</b> ${linkPlayerNames(esc(body.slice(0, 120)))}</div>`;
    };
    if (chat === undefined) {
      return `<div class="card"><details class="collapsecard" id="chatDetails"><summary>League chat</summary>
        <p class="mut small">Tap to load the latest messages.</p>
        <button id="recentChatOpen" class="mut">Open chat →</button></details></div>`;
    }
    const recent = userChats(chat).slice(-6);
    return `<div class="card"><details class="collapsecard" id="chatDetails">
      <summary>League chat</summary>
      ${recent.length ? recent.map(line).join("") : '<p class="mut">No messages yet — say hi!</p>'}
      <button id="recentChatOpen" class="mut">Open chat →</button>
    </details></div>`;
  }
  //  Playoffs card (plan §4.10, S7): once the regular season has moved past week
  // seasonWeeks and there's no bracket yet, a prominent build prompt (commissioner-only
  // button, everyone else just sees it's coming); once a bracket exists, a quiet link
  // through to the bracket page — becomes the champion banner once one's crowned.
  function playoffsCardHtml(bracket, week, seasonWeeks, commish) {
    if (!bracket) {
      if (week <= seasonWeeks) return "";
      return `<div class="card"><h2>Playoffs</h2>
        <p class="mut">The playoff bracket hasn't been built yet.</p>
        ${commish ? '<button id="buildBracketBtn" class="primary">Build bracket</button>' : ""}</div>`;
    }
    const champTeam = bracket.champion != null ? LG.teamById(bracket.champion) : null;
    return `<div class="card"><h2>Playoffs</h2>
      ${champTeam ? `<p> <b>${esc(champTeam.name)}</b> are the ${bracket.season} GFFL Champions!</p>` : '<p class="mut">The bracket is set — best of luck.</p>'}
      <button id="openBracketBtn">${champTeam ? "View the bracket" : "View the bracket →"}</button></div>`;
  }
  // Weeks that have games on the board, no official result, and that the live engine can no
  // longer score because it has already rolled past them (adversarial review 2026-08-08,
  // findings 1/3/7). These are stated plainly on the league home instead of being silently
  // finalized from the wrong week's numbers — the commissioner finalizes them from Sleeper's
  // archived per-week stats, which is the only source that still holds their real totals.
  async function staleFinalizeWeeks() {
    if (!LG.teams.length) return [];
    const cw = LG.currentWeek();
    const d = D();
    const ew = d && d.engineWeek ? d.engineWeek() : null;
    // UNKNOWN IS NOT STALE. Until the engine has actually reported which week it's holding
    // (a cold boot, an outage, or the two providers disagreeing) we have no grounds to tell
    // anyone a week can't be settled — silence is the honest state, not an alarm.
    if (ew == null) return [];
    // ⭐ ITEM 30 (2026-08-09) — NEITHER IS PRESEASON. Once the engine rolls to preseason week
    // 2 its week (2) stops matching the league's clamped week (1), so week 1 would be listed
    // here as "needing finalizing" — and the button on that card backfills from
    // /stats/nfl/regular/<season>/1, a regular-season week nobody has played. No regular-season
    // week can be stale while the regular season hasn't started; the honest state is silence.
    if (!(d && d.engineRegular && d.engineRegular())) return [];
    const have = new Set((UI._allWeekly || []).filter((w) => w && w.kind === "weekly").map((w) => w.week));
    const out = [];
    for (let w = 1; w <= cw; w++) {
      if (have.has(w) || ew === w) continue;
      const games = await LG.gamesForWeek(w);
      if (games.length) out.push(w);
    }
    return out;
  }
  function staleWeeksHtml(weeks, commish) {
    if (!weeks || !weeks.length) return "";
    const list = weeks.map((w) => `<div class="rowline"><span>Week ${w}</span>${commish
      ? `<button class="staleFinBtn" data-w="${w}">Finalize week ${w} from archived stats</button>` : ""}</div>`).join("");
    // `.warn` is a COLOUR utility (gold text) — on the card it would paint the body copy and
    // every button label gold too. It marks the heading only.
    return `<div class="card"><h2 class="warn">${weeks.length === 1 ? "A week needs" : weeks.length + " weeks need"} finalizing</h2>
      <p class="mut small">Live scoring has already moved on, so these weeks can't be settled from
        what's on the board right now. ${commish
        ? "Finalizing pulls each week's own archived stat lines instead — the real numbers for that week."
        : "The commissioner can settle them from each week's own archived stats."}</p>
      ${list}</div>`;
  }
  // ---------------- S2: draft countdown ----------------
  // CLOCK RULE (the one exemption in this app): everything else that reads "now" goes through
  // LG.now(), which under the 2025 replay — or any test's LG.nowOverride — can read ANY moment
  // at all, including one nowhere near the real calendar. The draft is a real-world appointment
  // (a specific Saturday everyone actually shows up for), not a replay event, so it counts down
  // on the REAL wall clock, Date.now(), on purpose. This is the ONE place in the app that is
  // deliberately exempt from LG.now() — see LG.now()'s own comment in lg-core.js for the
  // precedence (test override -> replay clock -> Date.now()) this ignores wholesale.
  const DRAFT_LIVE_WINDOW_MS = 6 * 3600 * 1000;
  function draftState(rules) {
    const at = rules && rules.draftAt;
    const t = at ? new Date(at).getTime() : NaN;
    if (!Number.isFinite(t)) return null; // no draftAt set (or unparseable) — nothing to show anywhere
    const diff = t - Date.now(); // Date.now(), NEVER LG.now() — see the CLOCK RULE above
    if (diff > 0) return { phase: "future", target: t, diff };
    if (-diff <= DRAFT_LIVE_WINDOW_MS) return { phase: "live", target: t };
    return { phase: "drafted", target: t };
  }
  // "Sat, Sep 6 · 3:00 PM CT" — every part of this is DERIVED from the stored timestamp (never
  // hardcoded), so a commissioner reschedule updates the text with no code change, and it's
  // rendered in the READER's own device time zone (Intl's `timeZoneName:"short"` abbreviation,
  // whatever that is for whoever is looking at the screen — never assumed to be Central).
  function draftDateLabel(t) {
    const d = new Date(t);
    const wd = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d);
    const md = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
    const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" }).format(d);
    return `${wd}, ${md} · ${time}`;
  }
  function fmtDraftCountdown(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const days = Math.floor(s / 86400), hrs = Math.floor((s % 86400) / 3600), mins = Math.floor((s % 3600) / 60), secs = s % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return days > 0 ? `${days}d ${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s` : `${pad(hrs)}h ${pad(mins)}m ${pad(secs)}s`;
  }
  // The FIRST card on the league home while the draft is still ahead of us (plan §S2) — future
  // (a ticking D/H/M/S clock) or live (accent-styled "join" — the app's existing LIVE colour
  // language, same var(--accent) as .mulive/.sccard.live/.scstate.live). Once more than
  // DRAFT_LIVE_WINDOW_MS past, this card renders nothing at all — see leagueLinksHtml's quiet
  // "Drafted ✓" line for what replaces it.
  function draftCountdownCardHtml(rules) {
    const ds = draftState(rules);
    if (!ds || ds.phase === "drafted") return "";
    const when = draftDateLabel(ds.target);
    if (ds.phase === "live") {
      return `<div class="card draftcard draftlive" data-draft-phase="live">
        <h2>🏈 DRAFT DAY</h2>
        <p class="draftwhen mut small">${esc(when)}</p>
        <a class="navlinkbtn draftjoin" id="draftJoinBtn" href="ffdraft.html">Draft is LIVE — join ▶</a>
      </div>`;
    }
    return `<div class="card draftcard" data-draft-phase="future">
      <h2>🏈 DRAFT DAY</h2>
      <p class="draftwhen mut small">${esc(when)}</p>
      <div class="draftclock" id="draftClock">${esc(fmtDraftCountdown(ds.diff))}</div>
      <a class="navlinkbtn" id="draftJoinBtn" href="ffdraft.html">Draft room →</a>
    </div>`;
  }
  // Idempotent start/stop, the same shape as startChatPoll/stopChatPoll above — UI.show() stops
  // this alongside the other polls on every view change, and renderLeague() (re)starts it on
  // every render (repaint or not), always CLEARING any prior handle first so re-rendering the
  // league home three times in a row leaves exactly one interval alive, never a stack of them.
  UI._draftTimer = null;
  function stopDraftCountdown() { if (UI._draftTimer) { clearInterval(UI._draftTimer); UI._draftTimer = null; } }
  function startDraftCountdown() {
    stopDraftCountdown();
    const initial = draftState(LG.rules);
    // Nothing to ever tick: no draftAt at all, or already settled — a settled state can only
    // change via a commissioner reschedule, which is picked up fresh the next time this view
    // is rendered (renderLeague always recomputes from the CURRENT LG.rules.draftAt).
    if (!initial || initial.phase === "drafted") return;
    UI._draftTimer = setInterval(() => {
      const cur = draftState(LG.rules);
      const card = document.querySelector(".draftcard");
      const domPhase = card ? card.dataset.draftPhase : "drafted";
      if (!cur || cur.phase !== domPhase) { renderLeague(true); return; } // crossed a phase boundary — the card's whole shape changes
      if (cur.phase === "future") {
        const clock = $("#draftClock");
        if (clock) clock.textContent = fmtDraftCountdown(cur.diff);
      }
    }, 1000);
  }
  async function renderLeague(repaint) {
    if (!LG.teams.length) { renderFirstRun(repaint); return; }
    const wide = isWide();
    if (!repaint) {
      // Boot-speed pass (2026-08-08): this used to be TWELVE serial awaits before the first
      // pixel of the league home ever painted — on a real (non-instant) backend that's twelve
      // stacked round trips. Restructured into two batches:
      //   1) the two list()s everything else below reads from — "weekly"/"bracket" — run
      //      FIRST and TOGETHER so their caches are warm before anything else asks for them
      //      (same "list()s come first" guarantee as before, just no longer serial with
      //      each other either — they don't depend on one another).
      //   2) everything ABOVE THE FOLD (rosters/scores, standings, this week's finalize
      //      state, the accuracy line, the resolved bracket, this week's games, the
      //      stale-weeks banner) — none of these depend on each other's RESULT, only on the
      //      warm list caches from step 1, so they run together too.
      // Record book / recent moves / league chat are DELIBERATELY NOT fetched here any more —
      // all three are collapsed-by-default <details> cards (see recordBookHtml/
      // recentMovesHtml/recentChatHtml + wireLazyLeagueDetails below); their data now loads
      // only the moment someone actually opens one, via LG.recordBook()/LG.loadTx()/
      // LG.loadChat(null) — real reads (recordBook especially: it walks the whole imported
      // history PLUS every finalized week) that most app-opens never needed at all. Reset to
      // "not loaded" on every genuine (!repaint) visit — same freshness guarantee the old
      // always-eager fetch gave (a real navigation back to League always shows what's
      // CURRENTLY true, once opened), it just no longer costs anything until you look.
      UI._recordBook = undefined; UI._tx = undefined; UI._recentChat = undefined;
      [UI._allWeekly] = await Promise.all([LG.db.list("weekly"), LG.db.list("bracket")]);
      const [, standings, weeklyDoc, accuracy, bracket, wkGames, staleWeeks, injFeed] = await Promise.all([
        loadWeekRosters(),
        LG.loadStandings(),
        LG.loadWeekly(UI.week),
        LG.seasonAccuracy(),
        LG.loadBracket(),
        // The one source of "what's on this week" — the regular schedule for weeks <=
        // seasonWeeks, the bracket's currently-resolved pairings for a playoff week (S7).
        LG.gamesForWeek(UI.week),
        staleFinalizeWeeks(),
        // S9 — one small doc GET, eagerly fetched alongside the rest of this batch (unlike
        // record book/tx/chat below, which are genuinely expensive walks and stay lazy behind
        // a tap): the injury report is meant to be seen at a glance, not opened for.
        LG.loadInjuryFeed(),
      ]);
      UI._standings = standings; UI._weeklyDoc = weeklyDoc; UI._accuracy = accuracy;
      UI._bracket = bracket; UI._wkGames = wkGames; UI._staleWeeks = staleWeeks;
      UI._injFeed = injFeed;
      // DESKTOP EAGER-LOADS, in ONE more parallel batch (2026-08-11). The three lazy cards
      // above exist because most phone opens never look at them; on a desktop the record book
      // IS a card on the page (All-time) and the moves list is the right-hand rail, so there is
      // nothing to wait for a tap on — the reason for the laziness is gone, and keeping it
      // would just paint two placeholder shells. Bounded exactly as the cards were:
      // deskMovesHtml takes the newest 8, allTimeHtml the aggregate table only.
      // CHAT is deliberately NOT in this batch: on a desktop the rail carries the LIVE widget,
      // which fetches its own messages through refreshChatList after the paint — awaiting it
      // here would put a network round trip in front of the first pixel for no gain.
      if (wide) {
        const [rb, tx, streaks, odds] = await Promise.all([
          LG.recordBook(), LG.loadTx(), LG.loadStreaks(), LG.playoffOdds(),
        ]);
        UI._recordBook = rb; UI._tx = tx; UI._streaks = streaks; UI._odds = odds;
      }
    }
    const st = UI._standings || {};
    const wkGames = UI._wkGames || [];
    const seasonWeeks = LG.rules.seasonWeeks;
    const rows = [...LG.teams].sort((a, b) => {
      const A = st[a.id] || { w: 0, pf: 0 }, B = st[b.id] || { w: 0, pf: 0 };
      return (B.w - A.w) || (B.pf - A.pf);
    });
    const finalizeBtn = (wkGames.length && isCommish() && !UI._weeklyDoc)
      ? `<div class="rowline"><button id="finalizeBtn">Finalize week ${UI.week}</button></div>` : "";
    const noGamesMsg = !schedule ? `No schedule yet${isCommish() ? " — generate one in Rules" : ""}.`
      : UI.week > seasonWeeks ? "See the Playoffs card below." : "No games this week.";
    const weekCard = `
      <div class="card">
        <div class="rowline"><h2>Week ${UI.week}</h2><span id="healthChip" class="health" hidden></span></div>
        ${wkGames.length ? `<div class="mugrid">${wkGames.map(([h, a]) => matchupCard(h, a)).join("")}</div>` : `<p class="mut">${noGamesMsg}</p>`}
        ${finalizeBtn}
      </div>`;
    // ---------------- THE DESKTOP DASHBOARD (2026-08-11) ----------------
    // "it looks too much like an app." The masonry column-count treatment that used to do this
    // job dealt the cards out by height, so the page read as a scatter with no left-to-right
    // meaning. Two columns with jobs instead: MAIN is the league's STATE (what is being played,
    // where everyone stands, what has ever happened) and the RAIL is its PULSE (talk, and
    // transactions). The rail is fixed-width so the main column can't be squeezed by a long
    // chat message, and both are plain flex stacks with ONE gutter, so every card gutter on the
    // page is the same 16px.
    //
    // ORDER, and the one deviation from the brief recorded here: the countdown keeps FIRST
    // position when it exists (it is the page's hero while it lasts) and the Rules/Draft links
    // row sits directly beneath it rather than above — with no countdown the links row IS the
    // top of MAIN, which is what "compact at the top" asks for. The stale-weeks alarm follows
    // immediately, because it is the one card on this page that asks somebody to do something.
    if (wide) {
      // THE CARD REGISTRY (2026-08-11 layout editor). Each dashboard card renders through a
      // named entry; the ARRANGEMENT (which column, what order, hidden, per-card text size)
      // comes from deskLayout() — a sanitized per-device preference. Default order = the
      // rail-balance design: MAIN is the league's STATE, the RAIL its PULSE.
      const renderCard = {
        countdown: () => draftCountdownCardHtml(LG.rules),
        links: () => leagueLinksHtml(LG.rules),
        stale: () => staleWeeksHtml(UI._staleWeeks, isCommish()),
        week: () => weekCard,
        playoffs: () => playoffsCardHtml(UI._bracket, UI.week, seasonWeeks, isCommish()),
        standings: () => standingsHtml(rows, st, { wide: true, streaks: UI._streaks, odds: UI._odds, power: LG.powerRanking(UI._allWeekly) }),
        alltime: () => allTimeHtml(UI._recordBook),
        chat: () => deskChatPanelHtml(),
        injury: () => injuryFeedCardHtml(UI._injFeed),
        hot: () => `<div id="railHot">${hotPickupsHtml(allOwnedKeys())}</div>`,
        accuracy: () => accuracyHtml(UI._accuracy),
        moves: () => deskMovesHtml(UI._tx),
      };
      const lay = deskLayout();
      const editing = !!UI._deskEdit;
      // EVERY non-hidden card gets a wrapper, even when it renders "" — .deskcard is
      // display:contents, so an empty wrapper costs no box and no flex gap, and a card that
      // GAINS data mid-session (an injury lands, trending warms) appears on the next live
      // repaint instead of waiting for a full rebuild.
      const colHtml = (name) => lay[name].filter((id) => !lay.hidden.includes(id))
        .map((id) => deskCardWrap(id, lay, editing, renderCard)).join("");
      const el = main();
      const desk = el.querySelector(".lgdesk");
      // A LIVE REPAINT MUST NOT TOUCH CHAT — WHEREVER IT SITS. renderLeague(true) fires on
      // every scoring poll tick; rewriting the chat panel would blow away a half-typed
      // message, the composer's focus, and the reader's place in the list. With the layout
      // editable, chat can live in EITHER column, so the repaint is per-wrapper: every card
      // except chat is re-rendered in place. While the EDITOR is open the repaint is skipped
      // outright — scores can wait the few seconds an arrangement takes.
      if (repaint && desk) {
        if (!editing) {
          desk.querySelectorAll(".deskcard").forEach((w) => {
            const id = w.dataset.card;
            if (id === "chat") return;
            w.innerHTML = (renderCard[id] || (() => ""))();
          });
          wirePlayerCardTaps(desk); // injury rows / hot picks may have just repainted
        }
      } else {
        // A FULL rebuild still preserves what the reader had typed — a background cloud refresh
        // (LG.db.onChange -> UI.show) is not their doing and must not cost them a sentence.
        const liveChat = el.querySelector(".lgdesk #chatText");
        const keep = liveChat ? { text: liveChat.value, scroll: (el.querySelector("#chatList") || {}).scrollTop || 0 } : null;
        el.innerHTML = `${deskBarHtml(lay, editing)}<div class="lgdesk${editing ? " editing" : ""}">
          <div class="lgmain">${colHtml("main")}</div>
          <aside class="lgrail">${colHtml("rail")}</aside>
        </div>`;
        wireDeskLayout();
        if (!lay.hidden.includes("chat")) {
          wireChat("chat", null);
          if (keep) {
            const t = $("#chatText");
            if (t) { t.value = keep.text; autoGrowChatText(t); }
          }
          refreshChatList("chat", null).then(() => {
            const l = $("#chatList");
            if (l && keep && keep.scroll) l.scrollTop = keep.scroll;
          }).catch(() => {});
          startChatPoll("chat", null); // idempotent — see startChatPoll's own guard
        }
        // Hot pickups: paint from whatever trending is cached (often "" cold), then once more
        // when the fetch lands — the Moves page's own pattern. A dead endpoint = no card.
        // Skipped while editing (the placeholder shell owns that slot until Done).
        wirePlayerCardTaps($("#railHot"));
        if (!editing) D().loadTrending().then(() => {
          const hot = $("#railHot");
          if (!hot || UI.view !== "league" || UI._deskEdit) return;
          hot.innerHTML = hotPickupsHtml(allOwnedKeys());
          wirePlayerCardTaps(hot);
        }).catch(() => {});
      }
      applyDeskDisplay();
    } else {
      main().innerHTML = `
        ${draftCountdownCardHtml(LG.rules)}
        ${weekCard}
        ${injuryFeedCardHtml(UI._injFeed)}
        ${leagueLinksHtml(LG.rules)}
        ${staleWeeksHtml(UI._staleWeeks, isCommish())}
        ${playoffsCardHtml(UI._bracket, UI.week, seasonWeeks, isCommish())}
        ${powerRankingsHtml(UI._allWeekly)}
        ${accuracyHtml(UI._accuracy)}
        ${standingsHtml(rows, st, {})}
        ${recentMovesHtml(UI._tx)}
        ${recentChatHtml(UI._recentChat)}
        ${recordBookHtml(UI._recordBook)}`;
    }
    document.querySelectorAll("[data-mu]").forEach((el) => el.addEventListener("click", () => {
      UI.matchup = el.dataset.mu.split("-").map(Number);
      UI.go("matchup");
    }));
    // Item 16: the Rules link routes exactly like the tab did (UI.navTo), which also means it
    // does NOT clear UI.matchup — navTo only does that for the Matchup tab itself.
    $("#lnkRules") && $("#lnkRules").addEventListener("click", () => UI.navTo("rules"));
    $("#recentMovesAll") && $("#recentMovesAll").addEventListener("click", () => UI.go("moves"));
    $("#recentChatOpen") && $("#recentChatOpen").addEventListener("click", () => UI.go("chat"));
    $("#finalizeBtn") && $("#finalizeBtn").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      let r = await LG.finalizeWeek(UI.week);
      if (!r.ok && r.reason === "not-final") {
        const n = (r.pending || []).length;
        const msg = "Not every game is final yet (" + n + " starter" + (n === 1 ? "" : "s") + " still live or unresolved). Finalize anyway?";
        if (!window.confirm(msg)) return;
        r = await LG.finalizeWeek(UI.week, { force: true });
      }
      // The live board is on a DIFFERENT week — force would only score this week from that
      // week's numbers, so the only honest option is the archived-stats fallback
      // (adversarial review 2026-08-08, findings 1/3/7).
      if (!r.ok && (r.reason === "stale-week" || r.reason === "no-live-data")) {
        const wkNote = r.engineWeek ? " (it's showing week " + r.engineWeek + ")" : "";
        if (!window.confirm("Live scoring has already moved on from week " + UI.week + wkNote
          + ". Finalize it from week " + UI.week + "'s own archived stats instead?")) return;
        r = await LG.finalizeWeek(UI.week, { backfill: true });
      }
      if (r.ok) {
        toast("Week " + UI.week + " finalized.");
        await LG.advanceBracket().catch(() => {}); // a playoff week just went final — walk the bracket forward right away
        UI._standings = null; UI._bracket = null;
        renderLeague();
      } else toast("Couldn't finalize: " + reasonLabel(r.reason));
    });
    document.querySelectorAll(".staleFinBtn").forEach((b) => b.addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      const w = Number(b.dataset.w);
      if (!window.confirm("Finalize week " + w + " from its own archived stat lines? This is permanent.")) return;
      b.disabled = true;
      const r = await LG.finalizeWeek(w, { backfill: true });
      if (r.ok) {
        toast("Week " + w + " finalized from archived stats.");
        // A playoff week must walk the bracket forward BEFORE the next week is finalized —
        // see maybeAutoFinalizeWeeks' note (findings 6/8).
        await LG.advanceBracket().catch(() => {});
        UI._standings = null; UI._bracket = null; UI._allWeekly = null;
        renderLeague();
      } else { b.disabled = false; toast("Couldn't finalize week " + w + ": " + reasonLabel(r.reason)); }
    }));
    $("#buildBracketBtn") && $("#buildBracketBtn").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      const r = await LG.buildBracket();
      if (r.ok) { toast("Bracket built."); UI._bracket = null; renderLeague(); }
      else toast("Couldn't build bracket: " + (r.reason === "weeks-not-final" ? "week(s) " + (r.missing || []).join(", ") + " aren't final yet." : reasonLabel(r.reason)));
    });
    $("#openBracketBtn") && $("#openBracketBtn").addEventListener("click", () => UI.openBracket());
    wireLockerTaps();
    wirePlayerCardTaps(); // S9's injury feed rows — the league home's only [data-pk] elements
    wireLazyLeagueDetails();
    paintHealth();
    startDraftCountdown();
  }
  // Boot-speed pass (2026-08-08): record book / recent moves / league chat each load their
  // real data only the moment their <details> is actually opened for the first time — see
  // recordBookHtml/recentMovesHtml/recentChatHtml above. Re-called after EVERY renderLeague()
  // (repaint or not — same convention as wireLockerTaps), since each render replaces main()'s
  // whole innerHTML and any listener bound to the old nodes goes with it.
  function wireLazyLeagueDetails() {
    const bind = (id, key, loader) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("toggle", async () => {
        // Already loaded (a prior open — cached on UI, never re-fetched) or just closed:
        // nothing to do. `UI[key] !== undefined` is the real "has this been fetched" test —
        // every one of these loaders resolves to an array or a plain object, never undefined.
        if (!el.open || UI[key] !== undefined) return;
        UI[key] = await loader();
        // A full repaint is the only way the new data reaches the page (renderLeague builds
        // one HTML string from UI.* — there's no per-card patch path), which regenerates
        // every <details> node from scratch (closed, per its own template). Capture whatever
        // is open in the LIVE DOM right now (not just this one — the reader may have opened
        // a second lazy card while this one's fetch was still in flight, and its own toggle
        // handler may have already re-opened it once) and restore all of it after repainting,
        // so two cards expanded in quick succession can never make one snap back shut.
        const openIds = [...document.querySelectorAll("details[id]")].filter((d) => d.open).map((d) => d.id);
        if (!openIds.includes(id)) openIds.push(id);
        renderLeague(true);
        openIds.forEach((oid) => { const fresh = document.getElementById(oid); if (fresh) fresh.open = true; });
      });
    };
    bind("rbDetails", "_recordBook", LG.recordBook);
    bind("txDetails", "_tx", LG.loadTx);
    bind("chatDetails", "_recentChat", () => LG.loadChat(null));
  }
  // Crossing the desktop breakpoint changes which LAYOUT the league home is, not just how it is
  // painted (see isWide) — a window dragged from 900px to 1200px would otherwise keep the phone's
  // stacked cards until the next navigation, and one dragged the other way would leave a
  // fixed-width rail wedged into a narrow window. A genuine (!repaint) re-render is what picks
  // up the other branch's fetches too (the desktop batch above). Bound ONCE, at module scope.
  if (window.matchMedia) {
    const mq = window.matchMedia(DESK_MQ);
    const onFlip = () => { if (UI.view === "league") renderLeague(); };
    if (mq.addEventListener) mq.addEventListener("change", onFlip);
    else if (mq.addListener) mq.addListener(onFlip); // older Safari
  }
  // ---------------- S3: the crest and the name, everywhere ----------------
  // ONE notion of "the team's picture" and ONE of "the team's name in type". Before S3 there
  // were two of the first (logoTd read `.logo`, and a note under avatarHtml said matching that
  // precedence exactly was deliberate) — which meant an UPLOADED logo, which lands in
  // `logoData`, never appeared in the standings or on a matchup card at all. That was a bug
  // hiding behind a consistency rule, so the rule is now the other way round: every crest in
  // the app reads `logoData || logo`, and a team with neither gets its initials on its OWN
  // palette disc instead of nothing at all.
  //
  // Nothing here reads t.colors. LG.teamStyle(t) → LG.palStyle(LG.teamPalette(t)) is the only
  // path, and section AM reads this file to prove it.
  function teamSrc(t) { return (t && (t.logoData || t.logo)) || ""; }
  // A CUT-OUT logo — one with a genuinely transparent background — must sit DIRECTLY on the
  // colour behind it: no panel, no ring, no drop shadow, and never cropped (2026-08-11, user:
  // "a picture with transparent background should blend seamlessly with the color behind, no
  // borders at all"). Detecting it needs no new field and no migration: the upload path emits
  // PNG *only* when hasTransparency() actually found transparency and JPEG otherwise, so a
  // stored `data:image/png` IS the transparency flag. A legacy `.png` URL in the old `logo`
  // field is treated the same way — it is the only other shape that can carry alpha.
  function isCutoutLogo(src) {
    return /^data:image\/png/i.test(src || "") || /\.png(\?|#|$)/i.test(src || "");
  }
  function crestHtml(t, cls) {
    const src = teamSrc(t);
    const c = "tcrest " + (cls || "") + (isCutoutLogo(src) ? " cutout" : "");
    const style = LG.teamStyle(t || {});
    if (src) return `<span class="${c}" style="${esc(style)}"><img src="${esc(src)}" alt="" loading="lazy"></span>`;
    return `<span class="${c} tcrest-ph" style="${esc(style)}">${esc(initials(t && t.name))}</span>`;
  }
  UI.isCutoutLogo = isCutoutLogo; // test hook
  // The stylized name. `big` earns the edge treatment (a secondary-coloured offset behind the
  // fill); small row sizes get the FILL ONLY, because a 1px shadow under 12px condensed type
  // reads as a printing fault rather than a team's colours. Both take their ink from the
  // clamped ON-DARK derivation, never the raw pick.
  function teamNameHtml(t, opts) {
    opts = opts || {};
    const nm = (t && t.name) || "?";
    const cls = "tname" + (opts.big ? " big" : "") + (opts.cls ? " " + opts.cls : "");
    const attrs = opts.attrs || "";
    return `<span class="${cls}" style="${esc(LG.teamStyle(t || {}))}"${attrs}>${esc(nm)}</span>`;
  }
  function logoTd(t) { return crestHtml(t, "tlogo"); }
  // A team NAMED inside a row of prose or controls (the Moves page's trade rows, the veto
  // list). A team id that resolves to nothing — a folded franchise in imported history — gets
  // a plain muted label with no crest and no palette, for chatMsgHtml's reason.
  function teamMention(id) {
    const t = LG.teamById(id);
    if (!t) return `<span class="tmention mut">Team ${esc(String(id))}</span>`;
    return `<span class="tmention">${crestHtml(t, "tmini")}${teamNameHtml(t)}</span>`;
  }
  // The matchup header's crest (44px phone / 52px desktop — the S3 band, sized so the header
  // stays inside its measured 120px cap). `mine` keeps the "this one is yours" ring it always
  // had; the DISC beneath is now the team's own colour rather than one shared accent, which is
  // the whole point of the batch.
  function avatarHtml(t, mine) {
    return crestHtml(t, "muavatar" + (mine ? " mine" : ""));
  }
  // One side of the matchup header, in the ESPN reference's arrangement (2026-08-09): the
  // crest on the OUTER edge with the score block on the INNER (mirrored, so the two big
  // numbers face each other across the centre column), the current score LARGE with the
  // projection directly beneath it as a BARE muted number — no "proj" label; the reference
  // does not carry one and at this size the label costs more than it explains — then the team
  // name, then owner · record.
  // A team with no owner on file shows the record alone rather than a stray separator.
  // COSMETIC PASS (2026-08-11, user markup on a live screenshot): the owner-name · record
  // line is GONE — the header is crest, score, name, and the to-play line, nothing else —
  // and the freed space is spent on a bigger crest and a bigger score (the CSS side).
  function muTeamHead(T, id, mine, tot, proj, rem, sideCls) {
    // S3: the whole side carries its team's palette (crest disc, the score block's tint band,
    // the name's ink). The LIVE/Final badge keeps the app's own verdict colours.
    return `<div class="muhteam${sideCls}" style="${esc(LG.teamStyle(T || {}))}">
      <div class="muhtop">${avatarHtml(T, id === mine)}
        <div class="muhscore"><span class="bigpts">${LG.fmtPts(tot)}</span><span class="mut muhproj">${LG.fmtPts(proj)}</span></div></div>
      <b class="teamlink muhname tname big" data-locker="${id}" title="${esc(T?.name || "?")}">${esc(T?.name || "?")}</b>
      <div class="mut muhsub">${rem.left} to play · ${rem.playing} live</div></div>`;
  }
  // FIT, DON'T CLIP (2026-08-11, user: "instead of cutting off text it adjusts text size…
  // two rows and centered, that way we can see even the long names"). A hero name starts at
  // its stylesheet size and steps down 1px at a time until it fits its box in at most
  // maxLines wrapped lines with no sideways overflow (the single-long-word case). The reset
  // to "" first is what makes this idempotent across live repaints — without it a name that
  // once shrank could never grow back after a rename. Cheap: 2-3 elements, ≤40 steps, only
  // on renders that rebuild the header anyway. Re-run once when the display font finishes
  // loading — Barlow landing late changes every measurement.
  function fitText(el, maxLines, minPx) {
    if (!el) return;
    el.style.fontSize = "";
    let fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    let guard = 40;
    const fits = () => el.scrollWidth <= el.clientWidth + 1
      && el.getBoundingClientRect().height <= fs * 1.12 * maxLines + 3;
    while (!fits() && fs > minPx && guard-- > 0) { fs -= 1; el.style.fontSize = fs + "px"; }
  }
  function fitHeroNames() {
    // Two rows allowed at EVERY width — measured: the phone header still sits at ~136px of
    // its 140px cap with a two-row name, and two 10px+ rows read far better than one row
    // ground down to 9px (the first cut's floor, and the probe's own finding).
    const wide = isWide();
    document.querySelectorAll(".muhead.muhero .muhname").forEach((el) => fitText(el, 2, wide ? 16 : 10));
    fitText(document.querySelector(".lockername"), 2, 14);
  }
  let fitFontsHooked = false;
  function hookFitOnFonts() {
    if (fitFontsHooked || !document.fonts || !document.fonts.ready) return;
    fitFontsHooked = true;
    document.fonts.ready.then(() => fitHeroNames()).catch(() => {});
  }
  // "All-time series" line (plan §4.8's rivalries) — h2h is from the HOME
  // team's perspective (LG.headToHead(hId, aId)), so aWins is H's wins.
  // Omitted entirely when there's no shared history yet.
  function h2hLine(h2h, H, A) {
    if (!h2h) return "";
    const total = h2h.aWins + h2h.bWins + h2h.ties;
    if (!total) return "";
    const tieSuffix = h2h.ties ? ` (${h2h.ties} tie${h2h.ties === 1 ? "" : "s"})` : "";
    if (h2h.aWins === h2h.bWins) return `<div class="mut small h2hline">All-time series: tied ${h2h.aWins}–${h2h.bWins}${tieSuffix}</div>`;
    const leaderName = h2h.aWins > h2h.bWins ? (H ? H.name : "?") : (A ? A.name : "?");
    const lead = Math.max(h2h.aWins, h2h.bWins), trail = Math.min(h2h.aWins, h2h.bWins);
    return `<div class="mut small h2hline">All-time series: ${esc(leaderName)} leads ${lead}–${trail}${tieSuffix}</div>`;
  }
  // The state badge (Live/Final/Upcoming) + win-probability bar, reusing the same
  // d.remaining/d.winProb math the Matchup page already relies on (nothing new computed,
  // just invoked from a second spot) so a card never disagrees with what the dedicated
  // Matchup page shows.
  //
  // ITEM 27 (2026-08-09, user: "every single game in the league should have the same score
  // card that's like the one that you have now for the current user"). This used to render
  // ONLY on the viewer's own card, which left every other game as a bare row that said
  // nothing about whether it was live, done or hours away. Now every card carries it, on the
  // Scores tab and the league home alike (both go through matchupCard). The `.mine` class and
  // its bigger hero layout STAY — "this is your game" is still worth signalling; what changes
  // is that the others stop being second-class.
  //
  // COST: three in-memory reads per game instead of one — teamStarters() filters an array
  // already in UI._rosters, and d.remaining/d.winProb walk D.S.players/D.S.games, both Maps
  // already in memory. No backend read, no fetch, nothing hoistable (each call is against a
  // different team's starters). Section P's zero-extra-reads budget is unaffected and asserts
  // so directly.
  function matchupHeroExtra(h, a) {
    const d = D();
    const hKeys = teamStarters(h).map((p) => p.key), aKeys = teamStarters(a).map((p) => p.key);
    const wp = d.winProb(aKeys, hKeys); // away perspective, same convention as the matchup page
    const hRem = d.remaining(hKeys), aRem = d.remaining(aKeys);
    const anyLive = hRem.playing > 0 || aRem.playing > 0;
    // "Nobody left to play" is only FINAL if anybody was ever counted. On the viewer's own card
    // that was always true, so it never mattered; once EVERY card carries the strip (item 27) a
    // matchup whose rosters aren't set — or that hasn't loaded yet — has zero starters on both
    // sides and would announce itself as Final, which is a claim about a game nobody has played.
    // Caught on the review plate: four 0.0-0.0 games, all reading FINAL.
    // (The Matchup page's own header carries the same expression; it is left alone deliberately —
    // a different surface, reached one game at a time, and not this batch's to restage.)
    const counted = hRem.played + hRem.playing + hRem.left + aRem.played + aRem.playing + aRem.left;
    const allDone = counted > 0 && !anyLive && hRem.left === 0 && aRem.left === 0;
    const badge = anyLive ? '<span class="herobadge live"><span class="dot"></span>Live</span>'
      : allDone ? '<span class="herobadge">Final</span>' : '<span class="herobadge">Upcoming</span>';
    // THE DESKTOP DESIGN PASS (2026-08-11, user: "the matchups should have the same color
    // probability bar from their logos"). The card's bar used to be one flat accent fill on a
    // grey track — the same colour on every card, saying nothing about WHO was ahead. It is now
    // the matchup header's own mechanic (.mupbar): away's primary grows from the left, home's
    // from the right, meeting at the split. ONE CSS family, not a second dialect — the card just
    // adds `.mini` for its smaller height, and the header keeps its flanking percentages.
    // Applied on mobile too, deliberately: a bar that means one thing on a phone and another on
    // a desktop is worse than either, and the user's own wording is about the matchups, not
    // about a breakpoint.
    //
    // With nobody counted on either side, winProb has nothing to weigh and returns an
    // even-money 0.5 — and four stacked cards each painting a bold half-and-half bar reads as a
    // claim about four games. An empty track says "we can't separate these two yet", which is
    // the truth. Once rosters exist the bar is meaningful again even before kickoff, because
    // it is computed off projections.
    const pct = Math.round(wp * 100);
    const pa = LG.teamPalette(LG.teamById(a) || {}), ph = LG.teamPalette(LG.teamById(h) || {});
    const fill = counted > 0
      ? `<i style="width:${pct}%;background:${esc(pa.primary)}"></i><em style="width:${100 - pct}%;background:${esc(ph.primary)}"></em>`
      : "";
    const title = counted > 0 ? "" : ' title="No lineup data for this matchup yet"';
    return `<span class="herorow">${badge}<span class="mupbar mini${counted > 0 ? "" : " unknown"}"${title}>${fill}</span></span>`;
  }
  function matchupCard(h, a) {
    const H = LG.teamById(h), A = LG.teamById(a);
    const mine = LG.myTeamId();
    const isMine = h === mine || a === mine;
    // S3: each side carries ITS OWN team's colours — crest disc, name ink and the hairline
    // rule under the name. The card's own state chrome (the .mine accent border, the live
    // badge, the win-probability fill) is untouched: identity colours the teams, the verdict
    // colours the outcome, and where they meet the verdict wins.
    return `<button class="mucard ${isMine ? "mine" : ""}" data-mu="${h}-${a}">
      <span class="muteam">${logoTd(A)}${teamNameHtml(A, { cls: "muteamname" })}</span>
      <span class="muscore">${LG.fmtPts(liveTotal(a))} — ${LG.fmtPts(liveTotal(h))}</span>
      <span class="muteam right">${teamNameHtml(H, { cls: "muteamname" })}${logoTd(H)}</span>
      ${matchupHeroExtra(h, a)}</button>`;
  }

  // ----------------  playoff bracket (plan §4.10, S7) ----------------
  // #bracket — 3 columns (mobile: stacked, via league.html's .bracketrounds media query),
  // one per playoff week: play-in + a bye list + consolation game A, semis + consolation game
  // B, championship + 3rd place + the Toilet Bowl's consolation game C. Every resolved game is
  // a tappable link into the matchup page (for THAT game's own week — a bracket game's week
  // rides along on data-wk since it's rarely the week you're currently browsing); an unresolved
  // one renders its build-time placeholder label ("Winner of #4/#5") and isn't clickable.
  UI.renderBracket = renderBracket;
  async function renderBracket() {
    const bracket = await LG.loadBracket();
    if (!bracket) {
      main().innerHTML = `<div class="card"><p class="mut">No bracket yet${isCommish() ? " — build it from the League tab once every regular-season week is final." : "."}</p></div>`;
      return;
    }
    const sw = LG.rules.seasonWeeks;
    const weeklyByWeek = {};
    weeklyByWeek[sw + 1] = await LG.loadWeekly(sw + 1);
    weeklyByWeek[sw + 2] = await LG.loadWeekly(sw + 2);
    weeklyByWeek[sw + 3] = await LG.loadWeekly(sw + 3);
    const nm = (id) => (LG.teamById(id) || {}).name || ("Team " + id);
    const champTeam = bracket.champion != null ? LG.teamById(bracket.champion) : null;
    const toiletTeam = bracket.toilet != null ? LG.teamById(bracket.toilet) : null;

    function scoreFor(g) {
      const wd = weeklyByWeek[g.week];
      if (!wd || g.home == null || g.away == null) return null;
      const m = (wd.matchups || []).find((x) => (x.home === g.home && x.away === g.away) || (x.home === g.away && x.away === g.home));
      if (!m) return null;
      return { hp: m.home === g.home ? m.homePts : m.awayPts, ap: m.home === g.home ? m.awayPts : m.homePts };
    }
    function gameHtml(g) {
      const H = g.home != null ? LG.teamById(g.home) : null;
      const A = g.away != null ? LG.teamById(g.away) : null;
      const sc = scoreFor(g);
      const homeWon = !!sc && sc.hp > sc.ap, awayWon = !!sc && sc.ap > sc.hp;
      const homeTxt = H ? esc(H.name) : esc(g.homeLabel || "TBD");
      const awayTxt = A ? esc(A.name) : esc(g.awayLabel || "TBD");
      const clickable = H && A;
      return `<button class="bgame" ${clickable ? `data-mu="${g.home}-${g.away}" data-wk="${g.week}"` : "disabled"}>
        <div class="bside ${homeWon ? "winner" : ""}"><span>${g.seedHome ? "#" + g.seedHome + " " : ""}${homeTxt}</span><span class="mut">${sc ? LG.fmtPts(sc.hp) : ""}</span></div>
        <div class="bside ${awayWon ? "winner" : ""}"><span>${g.seedAway ? "#" + g.seedAway + " " : ""}${awayTxt}</span><span class="mut">${sc ? LG.fmtPts(sc.ap) : ""}</span></div>
      </button>`;
    }
    const byeRows = bracket.seeds.slice(0, bracket.byes).map((tid, i) =>
      `<div class="byerow">#${i + 1} ${esc(nm(tid))} — bye, advances to Round 2</div>`).join("");
    const playIn = bracket.rounds.r1.filter((g) => g.kind === "playin");
    const semis = bracket.rounds.r2.filter((g) => g.kind === "semi");
    const champG = bracket.rounds.r3.find((g) => g.kind === "championship");
    const thirdG = bracket.rounds.r3.find((g) => g.kind === "third");
    const consR1 = bracket.rounds.r1.filter((g) => g.kind === "consolation");
    const consR2 = bracket.rounds.r2.filter((g) => g.kind === "consolation");
    const consR3 = bracket.rounds.r3.filter((g) => g.kind === "consolation");

    main().innerHTML = `
      ${champTeam ? `<div class="champbanner">${esc(champTeam.name)} — ${bracket.season} GFFL CHAMPIONS!</div>` : ""}
      ${toiletTeam ? `<div class="toiletbanner">Toilet Bowl: ${esc(toiletTeam.name)}</div>` : ""}
      <div class="card"><h2>Playoff bracket</h2>
        <div class="bracketrounds">
          <div class="bracketcol">
            <h2 class="small mut">Week ${sw + 1} — play-in</h2>
            ${byeRows}
            ${playIn.map(gameHtml).join("")}
            <h2 class="small mut">Consolation</h2>
            ${consR1.map(gameHtml).join("") || '<p class="mut small">—</p>'}
          </div>
          <div class="bracketcol">
            <h2 class="small mut">Week ${sw + 2} — semifinals</h2>
            ${semis.map(gameHtml).join("")}
            <h2 class="small mut">Consolation</h2>
            ${consR2.map(gameHtml).join("") || '<p class="mut small">—</p>'}
          </div>
          <div class="bracketcol">
            <h2 class="small mut">Week ${sw + 3} — championship</h2>
            ${champG ? gameHtml(champG) : ""}
            <h2 class="small mut">3rd place</h2>
            ${thirdG ? gameHtml(thirdG) : ""}
            <h2 class="small mut">Toilet Bowl</h2>
            ${consR3.map(gameHtml).join("") || '<p class="mut small">—</p>'}
          </div>
        </div>
      </div>`;
    document.querySelectorAll("[data-mu]").forEach((el) => el.addEventListener("click", () => {
      const wk = Number(el.dataset.wk);
      if (wk) UI.week = wk;
      UI.matchup = el.dataset.mu.split("-").map(Number);
      UI.go("matchup");
    }));
    paintHealth();
  }

  // ----------------  Scores tab (item 5, 2026-08-08) ----------------
  // Real-NFL + family-ESPN-fantasy scoreboard, Gridiron-style — the same idea as the standalone
  // Bucky sports app's score strip, folded into the league so nobody needs a second tab open.
  // NFL half: D.S.nflEvents (lg-data.js's pollScoreboard, extended) — the SAME public no-key
  // ESPN endpoint + poll loop the matchup engine already runs continuously, so viewing Scores
  // costs no extra network call; it just paints whatever the engine currently has, and repaints
  // again on the engine's own d.onUpdate (paintLive, above). Fantasy half: a genuinely separate
  // call to the DEPLOYED sports function's ff_scoreboard action, which needs its own poll —
  // 25s while this tab is open and any game live, else 2min; cleared on tab switch (UI.show).
  async function sportsFn(action, extra) {
    const r = await fetch("/.netlify/functions/sports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: LG.PASS, action, ...(extra || {}) }),
    });
    return r.json();
  }
  UI.sportsFn = sportsFn;
  UI._ffSb = null; // last ff_scoreboard payload (or {ok:false,reason} — the card just hides)
  UI._scoresPoll = null;

  function kickTimeStr(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  // Item 2 (2026-08-08) — "MINE: N players · OPP: N players": how many of MY current-matchup
  // starters, and how many of my OPPONENT's, play for either team in a given real NFL game.
  // Computed off the SAME week-rosters cache every other view already loads (UI._rosters) — no
  // extra network call. Returns null (renders nothing) when there's no logged-in team or no
  // matchup this week; {mine,opp} otherwise, even when one side reads 0 — "your side has nobody
  // in this game, but your opponent has 4" is exactly the useful case to still show.
  UI._scoresMine = null; UI._scoresOpp = null; // team ids, set once per renderScores() mount
  function gameMineOppCounts(e) {
    if (UI._scoresMine == null && UI._scoresOpp == null) return null;
    const d = D();
    const ab1 = d.slpTeam((e.away && e.away.abbrev) || ""), ab2 = d.slpTeam((e.home && e.home.abbrev) || "");
    if (!ab1 && !ab2) return null;
    const inGame = (p) => { const t = d.slpTeam(p.team); return t === ab1 || t === ab2; };
    const mine = UI._scoresMine != null ? teamStarters(UI._scoresMine).filter(inGame).length : 0;
    const opp = UI._scoresOpp != null ? teamStarters(UI._scoresOpp).filter(inGame).length : 0;
    return (mine || opp) ? { mine, opp } : null;
  }
  function scoreCardHtml(e) {
    const live = e.state === "in", done = e.state === "post";
    // Team crests (2026-08-09 playtest: "the nfl scoreboard should show team logos"). The <img>
    // is only rendered when the slate actually carried a URL, so a logo-less game shows the
    // abbrev alone rather than a broken image; the fixed width/height (and visibility:hidden on
    // an error, never display:none) mean a missing or failed crest can never change the row's
    // height or shift the score beside it.
    const logoHtml = (t) => (t && t.logo)
      ? `<img class="sclogo" src="${esc(t.logo)}" alt="" width="22" height="22" loading="lazy" onerror="this.style.visibility='hidden'">`
      : "";
    const teamHtml = (t) => `<span class="scteam">${logoHtml(t)}<b>${esc((t && t.abbrev) || "?")}</b>
      ${live || done ? `<span class="scpts">${esc((t && t.score) || "0")}</span>` : ""}</span>`;
    const stateHtml = live ? `<span class="scstate live">${esc(e.detail || ("Q" + e.period + " " + e.clock))}</span>`
      : done ? '<span class="scstate mut">Final</span>'
      : `<span class="scstate mut">${esc(kickTimeStr(e.date))}</span>`;
    const net = e.broadcast ? `<span class="scnet">${esc(e.broadcast)}</span>` : "";
    const spread = e.spread ? `<div class="scspread mut small">${esc(e.spread)}</div>` : "";
    const mo = gameMineOppCounts(e);
    const moLine = mo ? `<div class="scmine mut small">MINE: ${mo.mine} player${mo.mine === 1 ? "" : "s"} · OPP: ${mo.opp} player${mo.opp === 1 ? "" : "s"}</div>` : "";
    // Item 28 (2026-08-09): the card is a real <button> — tapping it opens the game view.
    // A <div> with a click handler is unreachable by keyboard and announces nothing; the
    // button's own uppercase/letter-spacing is cancelled in league.html the same way .mucard
    // already cancels it, so the team abbrevs and times read exactly as they did.
    return `<button type="button" class="sccard ${live ? "live" : ""}" data-eid="${esc(e.id || "")}"
        aria-label="Open the ${esc((e.away && e.away.abbrev) || "?")} at ${esc((e.home && e.home.abbrev) || "?")} game">
      <div class="rowline">${net}${stateHtml}</div>
      <div class="scteams">${teamHtml(e.away)}<span class="mut small">at</span>${teamHtml(e.home)}</div>
      ${spread}${moLine}
    </button>`;
  }
  function nflScoresHtml(events) {
    if (!events || !events.length) return '<p class="mut">No games this week.</p>';
    const evs = [...events].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const byDay = new Map();
    for (const e of evs) {
      const day = e.date ? new Date(e.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "TBD";
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(e);
    }
    return [...byDay.entries()].map(([day, list]) =>
      `<div class="scoreday"><h2 class="small mut">${esc(day)}</h2><div class="scgrid">${list.map(scoreCardHtml).join("")}</div></div>`).join("");
  }
  // Our OWN league's current-week matchups (coordinator addendum, 2026-08-08 — the Scores tab
  // showed nothing but a blank ESPN-fantasy card, no GFFL scores at all). Reuses the EXACT same
  // data path + card renderer the league home already uses (LG.gamesForWeek + matchupCard,
  // both defined above) — the numbers here are provably the same numbers, not a second
  // computation that could disagree. Rendered ABOVE both the NFL slate and the ESPN card.
  function gfflScoresHtml(games) {
    if (!games || !games.length) return "";
    return `<div class="card"><h2>GFFL — Week ${UI.week}</h2><div class="mugrid">${games.map(([h, a]) => matchupCard(h, a)).join("")}</div></div>`;
  }
  // "Every matchup reads 0-0 with 0.0 points" — the exact preseason/pre-draft shape the
  // coordinator flagged from a live screenshot: nothing has been played yet, so the card has
  // no real signal to show. Meaningless inside the 2025 replay for the same reason (the family
  // ESPN league was never drafted for that past season) — hidden there always.
  function ffAllZero(matchups) {
    const zeroSide = (t) => !t || ((t.points == null || t.points === 0) && (!t.record || t.record === "0-0"));
    return matchups.every((m) => zeroSide(m.home) && zeroSide(m.away));
  }
  // Degrades to hiding the card entirely on any failure (unconfigured league, expired cookie,
  // network hiccup) — the brief's spec, and matches how every other AI/fantasy card here degrades.
  function ffScoresHtml(sb) {
    if (LG.SIM_2025) return ""; // a live ESPN fantasy scoreboard inside a 2025 replay is meaningless — always hidden
    if (!sb || !sb.ok || !Array.isArray(sb.matchups) || !sb.matchups.length) return "";
    if (ffAllZero(sb.matchups)) return ""; // preseason/pre-draft — no signal, not a broken card
    const side = (t) => t
      ? `<span class="ffside"><b>${esc(t.name)}</b> <span class="mut small">${esc(t.record || "")}</span>
          <span class="ffpts">${t.points != null ? LG.fmtPts(t.points) : "—"}</span></span>`
      : '<span class="ffside mut">—</span>';
    const rows = sb.matchups.map((m) => `<div class="fline ffrow">${side(m.away)}<span class="mut small">vs</span>${side(m.home)}</div>`).join("");
    return `<div class="card"><h2>ESPN league (live)</h2>${rows}</div>`;
  }
  UI.renderScores = renderScores;
  async function renderScores() {
    main().innerHTML = `<div class="card mut">Loading scores…</div>`;
    // Item 2's "mine/opp" line needs this week's rosters — load once per mount (cheap, cached),
    // never on every poll repaint (paintScores stays a pure re-render off what's already loaded).
    if (!UI._rosters) await loadWeekRosters();
    // ONE fetch of this week's games serves BOTH the "mine/opp" NFL-game counts below AND the
    // new GFFL matchups card — same array, not two separate reads that could disagree.
    const wk = await LG.gamesForWeek(UI.week);
    UI._scoresGfflGames = wk;
    const mine = LG.myTeamId();
    const myGame = mine ? (wk.find(([h, a]) => h === mine || a === mine) || null) : null;
    if (myGame) {
      const [h, a] = myGame;
      UI._scoresMine = mine; UI._scoresOpp = h === mine ? a : h;
    } else { UI._scoresMine = null; UI._scoresOpp = null; }
    await loadFfScoreboard();
    paintScores();
    startScoresPoll();
  }
  async function loadFfScoreboard() {
    const T = LG.teamById(LG.myTeamId());
    try { UI._ffSb = await sportsFn("ff_scoreboard", T ? { teamName: T.name } : {}); } catch (e) { UI._ffSb = { ok: false, reason: "fetch-failed" }; }
  }
  function paintScores() {
    const d = D();
    main().innerHTML = `
      ${gfflScoresHtml(UI._scoresGfflGames)}
      <div class="card"><div class="rowline"><h2>NFL this week</h2><span id="healthChip" class="health" hidden></span></div>
        ${nflScoresHtml(d.S && d.S.nflEvents)}
      </div>
      ${ffScoresHtml(UI._ffSb)}`;
    document.querySelectorAll("[data-mu]").forEach((el) => el.addEventListener("click", () => {
      UI.matchup = el.dataset.mu.split("-").map(Number);
      UI.go("matchup");
    }));
    // Item 28: tapping an NFL card opens that game. An event with no id (a slate row the
    // upstream gave us nothing to open) simply doesn't wire — better an inert card than a tap
    // that lands on a "bad-event-id" error.
    document.querySelectorAll(".sccard[data-eid]").forEach((el) => {
      if (!el.dataset.eid) { el.disabled = true; return; }
      el.addEventListener("click", () => UI.openNflGame(el.dataset.eid));
    });
    paintHealth();
  }
  UI.paintScores = paintScores; // called from paintLive() when this tab is open — NFL half only
  function startScoresPoll() {
    stopScoresPoll();
    const tick = async () => {
      await loadFfScoreboard();
      if (UI.view === "scores") paintScores();
      UI._scoresPoll = setTimeout(tick, D().anyLive() ? 25000 : 120000);
    };
    UI._scoresPoll = setTimeout(tick, D().anyLive() ? 25000 : 120000);
  }
  function stopScoresPoll() {
    if (UI._scoresPoll) { clearTimeout(UI._scoresPoll); UI._scoresPoll = null; }
  }

  // ================ ITEM 28 — the NFL game view (2026-08-09) ================
  // User: "clicking an NFL game should take you to a scoreboard style thing that we used in
  // Bucky where you can see all the box scores, the play by play, and the field."
  //
  // DATA: the EXISTING deployed sports function, action "nfl_game" — netlify/functions/
  // sports.mjs, which the standalone sports.html already consumes. No new backend, and
  // sports.mjs is not touched: it gates on BUCKY_NOTIFY_SECRET, which IS LG.PASS, so
  // sportsFn() reaches it exactly the way the Scores tab's ff_scoreboard already does. Every
  // field read below comes from that function's own slimGame() — the shape is its contract,
  // not a guess.
  //
  // RENDERING IS OURS, and that is a deliberate, stated cost. sports.html paints this same
  // payload, but it lives in the main Bucky shell (cream re-skin, its own tokens/classes);
  // the GFFL is a broadcast-dark app with its own. So the STRUCTURE AND MATHS are ported —
  // above all the field geometry, whose conventions are documented and were not re-derived —
  // and dressed in this app's tokens. The price: if ESPN's payload drifts, two renderers need
  // updating. What is genuinely SHARED rather than duplicated is everything below the render:
  // one server, one slimmer, one field-coordinate convention, one secret.
  UI.nflGameId = null;   // the event currently open (also what the #nflgame=<id> hash carries)
  UI._nflGame = null;    // last payload from nfl_game — {ok:true,...} or {ok:false,reason}
  UI._nflGamePoll = null;

  UI.openNflGame = function (eventId) {
    UI.nflGameId = String(eventId);
    UI._nflGame = null; // never show the PREVIOUS game's field while this one loads
    UI.go("nflgame");
  };

  // ---- field geometry. PORTED VERBATIM from sports.html (which is where it was worked out
  // and unit-tested); re-deriving it would be re-earning a subtlety that is already written
  // down. Field coordinate: 0..100 = yards from the LEFT goal line, away's end zone drawn
  // LEFT and home's RIGHT. ESPN's `yardsToEndzone` is the distance to the end zone the OFFENSE
  // is driving TOWARD, so:
  //   away possesses -> drives right (toward home's EZ) -> pos = 100 - yTE
  //   home possesses -> drives left  (toward away's EZ) -> pos = yTE
  const FLD = { EZ: 83.33, PER_YD: 8.3334, W: 1000, H: 300 };
  function fieldPos(possHomeAway, yTE) {
    const y = Math.max(0, Math.min(100, Number(yTE)));
    return possHomeAway === "home" ? y : 100 - y;
  }
  function firstDownPos(possHomeAway, ballPos, distance) {
    const d = Math.max(0, Number(distance) || 0);
    return Math.max(0, Math.min(100, possHomeAway === "home" ? ballPos - d : ballPos + d));
  }
  function fieldX(pos) { return FLD.EZ + pos * FLD.PER_YD; }
  UI._fieldX = fieldX; UI._fieldPos = fieldPos; UI._firstDownPos = firstDownPos; // test hooks

  // ESPN ships team colours as bare 6-hex with no "#". A junk/empty value must never reach a
  // style attribute as-is.
  function hexColor(c) {
    const v = String(c || "").replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    return v.length === 6 ? "#" + v : "#4a5468";
  }
  function kickFullStr(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) { return ""; }
  }
  const gSide = (g, ha) => (g.teams || []).find((t) => t.homeAway === ha) || (g.teams || [])[ha === "away" ? 0 : 1] || {};

  function nflFieldSvg(g) {
    const away = gSide(g, "away"), home = gSide(g, "home");
    const s = g.situation;
    const poss = s && s.possessionId ? (String(s.possessionId) === String(home.id) ? "home" : "away") : null;
    const awayC = hexColor(away.color), homeC = hexColor(home.color);
    let svg = `<svg class="nfldiag" viewBox="0 0 ${FLD.W} ${FLD.H}" role="img" aria-label="Field view">`;
    svg += `<rect x="0" y="0" width="1000" height="300" fill="var(--turf)"/>`;
    for (let i = 1; i < 10; i += 2) {
      svg += `<rect x="${(FLD.EZ + i * 10 * FLD.PER_YD).toFixed(1)}" y="0" width="${(10 * FLD.PER_YD).toFixed(1)}" height="300" fill="var(--turf-2)"/>`;
    }
    svg += `<rect x="0" y="0" width="83.3" height="300" fill="${awayC}" opacity="0.85"/>`;
    svg += `<rect x="916.7" y="0" width="83.3" height="300" fill="${homeC}" opacity="0.85"/>`;
    svg += `<text x="41" y="150" fill="#fff" font-size="24" font-weight="800" text-anchor="middle" transform="rotate(-90 41 150)" letter-spacing="3">${esc(String(away.abbrev || "").toUpperCase())}</text>`;
    svg += `<text x="958" y="150" fill="#fff" font-size="24" font-weight="800" text-anchor="middle" transform="rotate(90 958 150)" letter-spacing="3">${esc(String(home.abbrev || "").toUpperCase())}</text>`;
    // The drive band — from where this drive started to where the ball is now.
    let ballPos = null;
    if (poss && s && s.yardsToEndzone != null) {
      ballPos = fieldPos(poss, s.yardsToEndzone);
      const dr = g.drives && g.drives.current;
      if (dr && dr.startYardsToEndzone != null) {
        const startPos = fieldPos(poss, dr.startYardsToEndzone);
        const x0 = fieldX(Math.min(startPos, ballPos)), x1 = fieldX(Math.max(startPos, ballPos));
        if (x1 - x0 > 1) svg += `<rect x="${x0.toFixed(1)}" y="0" width="${(x1 - x0).toFixed(1)}" height="300" fill="${poss === "home" ? homeC : awayC}" opacity="0.18"/>`;
      }
    }
    svg += `<g stroke="var(--chalk)" stroke-width="1.4" opacity="0.7">`;
    for (let y = 10; y <= 90; y += 10) svg += `<line x1="${fieldX(y).toFixed(1)}" y1="0" x2="${fieldX(y).toFixed(1)}" y2="300"/>`;
    svg += `</g><g stroke="var(--chalk)" stroke-width="3" opacity="0.9"><line x1="83.3" y1="0" x2="83.3" y2="300"/><line x1="916.7" y1="0" x2="916.7" y2="300"/></g>`;
    svg += `<g fill="var(--chalk)" font-size="15" font-weight="700" text-anchor="middle" opacity="0.75">`;
    [10, 20, 30, 40, 50, 40, 30, 20, 10].forEach((n, i) => {
      svg += `<text x="${fieldX((i + 1) * 10).toFixed(1)}" y="282">${n}</text>`;
    });
    svg += `</g><g stroke="var(--chalk)" stroke-width="1" opacity="0.35">`
      + `<line x1="83.3" y1="105" x2="916.7" y2="105" stroke-dasharray="1 15.6"/>`
      + `<line x1="83.3" y1="195" x2="916.7" y2="195" stroke-dasharray="1 15.6"/></g>`;
    if (ballPos != null) {
      const bx = fieldX(ballPos);
      if (s.distance) {
        const fdx = fieldX(firstDownPos(poss, ballPos, s.distance)).toFixed(1);
        svg += `<line class="nflfd" x1="${fdx}" y1="0" x2="${fdx}" y2="300" stroke="var(--gold)" stroke-width="3.5"/>`;
      }
      svg += `<line class="nfllos" x1="${bx.toFixed(1)}" y1="0" x2="${bx.toFixed(1)}" y2="300" stroke="#eaf2ff" stroke-width="3" opacity="0.95"/>`;
      svg += poss === "away"
        ? `<g fill="#fff" opacity="0.9"><rect x="600" y="41" width="40" height="5" rx="2"/><path d="M 640 33 l 15 10.5 l -15 10.5 z"/></g>`
        : `<g fill="#fff" opacity="0.9"><rect x="360" y="41" width="40" height="5" rx="2"/><path d="M 360 33 l -15 10.5 l 15 10.5 z"/></g>`;
      svg += `<g class="nflball" data-x="${bx.toFixed(1)}" transform="translate(${bx.toFixed(1)},150)">`
        + `<ellipse rx="14" ry="9" fill="#6b3f23" stroke="#fff" stroke-width="1.5"/>`
        + `<line x1="-6" y1="0" x2="6" y2="0" stroke="#fff" stroke-width="1.4"/></g>`;
    }
    return svg + "</svg>";
  }

  function nflCrest(t) {
    return (t && t.logo) ? `<img class="nflcrest" src="${esc(t.logo)}" alt="" width="26" height="26" loading="lazy" onerror="this.style.visibility='hidden'">` : "";
  }
  function nflHeadHtml(g) {
    const away = gSide(g, "away"), home = gSide(g, "home");
    const st = g.status || {};
    const live = st.state === "in", done = st.state === "post", pre = st.state === "pre";
    const possId = live && g.situation ? String(g.situation.possessionId) : "";
    const sideHtml = (t) => `<span class="nflside">${nflCrest(t)}
      <b class="nflab">${esc(t.abbrev || "?")}${possId && String(t.id) === possId ? '<span class="nflposs" title="possession"></span>' : ""}</b>
      ${t.record ? `<span class="mut small">${esc(t.record)}</span>` : ""}</span>`;
    // A pre-game game reads "0" from ESPN for both sides. Painting two big zeroes is a lie
    // about a game that hasn't started (reviewed on the plate) — a dash says "no score yet".
    const score = (t) => (pre || t.score === "" || t.score == null) ? "–" : t.score;
    const losing = (t, o) => (live || done) && Number(t.score) < Number(o.score);
    // .nflq is the accent-red LIVE colour; a kickoff time in red reads as in-progress.
    let mid = pre ? `<span class="nflq done">${esc(kickTimeStr(g.date))}</span>`
      : `<span class="nflq${done ? " done" : ""}">${esc(st.detail || "")}</span>`;
    if (live && g.situation && g.situation.downDistanceText) mid += `<span class="mut small">${esc(g.situation.downDistanceText)}</span>`;
    let html = `<div class="nflhead">${sideHtml(away)}
      <span class="nflscores">
        <span class="nflbig${losing(away, home) ? " losing" : ""}">${esc(score(away))}</span>
        <span class="nflmid">${mid}</span>
        <span class="nflbig${losing(home, away) ? " losing" : ""}">${esc(score(home))}</span>
      </span>${sideHtml(home)}</div>`;
    // Linescore, once anything has actually been played.
    const aL = away.linescores || [], hL = home.linescores || [];
    if ((live || done) && (aL.length || hL.length)) {
      const n = Math.max(aL.length, hL.length, 4);
      let head = "<tr><th></th>";
      for (let i = 0; i < n; i++) head += `<th>${i < 4 ? i + 1 : "OT"}</th>`;
      head += "<th>T</th></tr>";
      const row = (t, L) => {
        let r = `<tr><td>${esc(t.abbrev || "?")}</td>`;
        for (let i = 0; i < n; i++) r += `<td>${esc(L[i] != null && L[i] !== "" ? L[i] : "–")}</td>`;
        return r + `<td class="nfltot">${esc(t.score || "0")}</td></tr>`;
      };
      html += `<div class="panner"><table class="tbl nflline">${head}${row(away, aL)}${row(home, hL)}</table></div>`;
    }
    return `<div class="card">${html}</div>`;
  }

  function nflGameHtml(g) {
    const st = g.status || {};
    const live = st.state === "in", pre = st.state === "pre";
    const away = gSide(g, "away"), home = gSide(g, "home");
    const abColor = (id) => hexColor(((g.teams || []).find((t) => String(t.id) === String(id)) || {}).color);
    let html = nflHeadHtml(g);

    // PRE-GAME: kickoff/venue/spread — deliberately NOT three empty cards. A game that hasn't
    // started has no field, no drives and no box score, and rendering their shells anyway is
    // how a view ends up only looking right during a live game.
    if (pre) {
      html += `<div class="card"><div class="seclabel"><b>Kickoff</b></div>
        <div class="nflkick"><div><span class="mut">When</span> ${esc(kickFullStr(g.date)) || "TBD"}</div>
        ${g.venue ? `<div><span class="mut">Where</span> ${esc(g.venue)}</div>` : ""}
        ${g.spread ? `<div><span class="mut">Line</span> ${esc(g.spread)}</div>` : ""}</div></div>`;
    }

    // THE FIELD — live only. Its whole content (ball, line of scrimmage, first-down line,
    // drive band, direction arrow) comes from `situation`, which slimGame only builds while
    // the game is in progress; drawing an empty gridiron after the final whistle says nothing.
    if (live) {
      html += `<div class="card nflfield">${nflFieldSvg(g)}`;
      const s = g.situation;
      if (s && s.downDistanceText) {
        html += `<div class="nflsitu"><b>${esc(s.downDistanceText)}</b>
          <span class="mut">${esc(s.possessionAbbrev || "")} ball · driving ${String(s.possessionId) === String(away.id) ? "→" : "←"}</span></div>`;
      } else {
        html += `<div class="nflsitu"><span class="mut">${esc(st.detail || "")}</span></div>`;
      }
      if (s && s.lastPlay) html += `<div class="nfllast"><span class="mut small">LAST PLAY</span> ${esc(s.lastPlay)}</div>`;
      html += `</div>`;
    }

    // PLAY-BY-PLAY — the current drive NEWEST FIRST (the freshest action needs no scroll),
    // then the previous drives. Rendered off what the payload actually carries rather than off
    // the game's state, so a just-finished game still shows its last drive.
    const cur = g.drives && g.drives.current;
    const curPlays = (cur && Array.isArray(cur.plays) ? cur.plays : []).filter((p) => p && p.text);
    if (curPlays.length) {
      html += `<div class="card"><div class="seclabel">
        <span class="nfltag" style="background:${abColor(cur.teamId)}">${esc(cur.teamAbbrev || "")}</span>
        <b>${live ? "This drive" : "Last drive"}</b>
        ${cur.description ? `<span class="mut small">${esc(cur.description)}</span>` : ""}</div>
        <div class="nflplays">`;
      curPlays.slice().reverse().forEach((p) => {
        html += `<div class="nflplay${p.scoring ? " score" : ""}"><span class="nfldd">${esc(p.downDistanceText || "—")}</span>
          <span class="nfltext">${esc(p.text)}</span><span class="nflck mut small">${esc(p.clock || "")}</span></div>`;
      });
      html += `</div></div>`;
    }
    const prev = (g.drives && Array.isArray(g.drives.previous) ? g.drives.previous : []);
    if (prev.length) {
      html += `<div class="card"><div class="seclabel"><b>${curPlays.length ? "Previous drives" : "Drives"}</b></div>`;
      prev.slice(0, 14).forEach((d) => {
        html += `<div class="nfldrv"><span class="nfltag" style="background:${abColor(d.teamId)}">${esc(d.teamAbbrev || "")}</span>
          <span class="nflres${d.scoring ? " scored" : ""}">${esc(d.result || "Drive")}</span>
          <span class="mut small">${esc(d.description || "")}</span></div>`;
      });
      html += `</div>`;
    }

    // Win probability + team stat bars — one card, both optional.
    let wp = "";
    if (Array.isArray(g.winprob) && g.winprob.length > 1 && !pre) {
      const pts = g.winprob;
      const poly = pts.map((p, i) => `${((i / (pts.length - 1)) * 220).toFixed(1)},${(52 - Math.max(0, Math.min(1, p)) * 48).toFixed(1)}`).join(" ");
      const last = pts[pts.length - 1], leadHome = last >= 0.5;
      const lead = leadHome ? home : away;
      wp = `<div class="nflwp"><svg viewBox="0 0 220 56" preserveAspectRatio="none" role="img" aria-label="Win probability">
          <line x1="0" y1="28" x2="220" y2="28" stroke="var(--divider)" stroke-width="1"/>
          <polyline points="${poly}" fill="none" stroke="var(--accent)" stroke-width="2"/></svg>
        <div class="nflwpv"><b>${esc(lead.abbrev || "?")} ${Math.round((leadHome ? last : 1 - last) * 100)}%</b><span class="mut small">win probability</span></div></div>`;
    }
    let bars = "";
    const bt = g.boxscore && Array.isArray(g.boxscore.teams) ? g.boxscore.teams : [];
    if (bt.length === 2) {
      const WANT = ["totalYards", "netPassingYards", "rushingYards", "turnovers", "possessionTime", "thirdDownEff"];
      const a = bt.find((t) => t.abbrev === away.abbrev) || bt[0], h = bt.find((t) => t.abbrev === home.abbrev) || bt[1];
      const statOf = (t, name) => (t.stats || []).find((x) => x.name === name) || null;
      let rows = "";
      WANT.forEach((name) => {
        const sa = statOf(a, name), sh = statOf(h, name);
        if (!sa || !sh) return;
        const na = parseFloat(String(sa.value).replace(/[^\d.]/g, "")) || 0;
        const nh = parseFloat(String(sh.value).replace(/[^\d.]/g, "")) || 0;
        const tot = na + nh || 1;
        rows += `<div class="nflsb"><div class="nflsbl"><b>${esc(sa.value)}</b><span class="mut small">${esc(sa.label)}</span><b>${esc(sh.value)}</b></div>
          <div class="nflsbt"><i style="width:${Math.round((na / tot) * 100)}%;background:${hexColor(away.color)}"></i><em style="width:${Math.round((nh / tot) * 100)}%;background:${hexColor(home.color)}"></em></div></div>`;
      });
      if (rows) bars = `<div class="nflbars">${rows}</div>`;
    }
    if (wp || bars) html += `<div class="card">${wp}${wp && bars ? '<div class="nflsplit"></div>' : ""}${bars}</div>`;

    // BOX SCORES — both teams. Wide, so each table pans inside its own .panner (the house
    // convention) and the page itself never scrolls sideways.
    const bp = g.boxscore && Array.isArray(g.boxscore.players) ? g.boxscore.players : [];
    if (bp.length && !pre) {
      const GROUPS = ["passing", "rushing", "receiving"];
      let box = "";
      bp.forEach((t) => {
        (t.groups || []).forEach((grp) => {
          if (GROUPS.indexOf(grp.name) < 0 || !grp.athletes || !grp.athletes.length) return;
          box += `<div class="nflboxt">${esc((t.abbrev + " " + grp.name).toUpperCase())}</div>
            <div class="panner"><table class="tbl nflbox"><tr><th></th>${(grp.labels || []).slice(0, 5).map((l) => `<th>${esc(l)}</th>`).join("")}</tr>`;
          grp.athletes.forEach((a2) => {
            box += `<tr><td>${escn(a2.name)}</td>${(a2.stats || []).slice(0, 5).map((s2) => `<td>${esc(s2)}</td>`).join("")}</tr>`;
          });
          box += `</table></div>`;
        });
      });
      if (box) html += `<div class="card nflboxcard"><div class="seclabel"><b>Box score</b></div>${box}</div>`;
    }

    if (Array.isArray(g.scoringPlays) && g.scoringPlays.length) {
      html += `<div class="card"><div class="seclabel"><b>Scoring plays</b></div>`;
      g.scoringPlays.forEach((s) => {
        html += `<div class="nflsc"><span class="nflqk mut small">Q${esc(s.period)} ${esc(s.clock || "")}</span>
          <span><b>${esc(s.team || "")}${s.type ? " " + esc(String(s.type).toUpperCase()) : ""}</b> — ${esc(s.text || "")}</span>
          <span class="nflafter mut small">${esc(s.away)}-${esc(s.home)}</span></div>`;
      });
      html += `</div>`;
    }
    return html;
  }

  function nflReasonLine(reason) {
    return reason === "bad-event-id" ? "That game id didn't look right."
      : reason === "unreachable" ? "We couldn't reach the scoreboard service."
      : reason === "bad-shape" || reason === "bad-json" || reason === "bad-payload" ? "The scoreboard sent something we couldn't read."
      : /^http-/.test(String(reason || "")) ? "The scoreboard service answered with an error (" + esc(reason) + ")."
      : "We couldn't load this game right now.";
  }

  UI.renderNflGame = renderNflGame;
  async function renderNflGame() {
    // A #nflgame= URL with nothing to open is a bad address, not a place — REPLACE it, so Back
    // doesn't have to step over an entry the reader never chose.
    if (!UI.nflGameId) { UI.go("scores", { replace: true }); return; }
    main().innerHTML = `<div class="rowline nflbar">
        <button type="button" id="nflBack" class="nflback">&lsaquo; Scores</button>
        <span id="nflChip" class="mut small"></span></div>
      <div id="nflBody"><div class="card mut">Loading the game…</div></div>`;
    $("#nflBack").addEventListener("click", nflBack);
    const id = UI.nflGameId;
    await loadNflGame();
    // The reader may have gone somewhere else (or opened a different game) while that was in
    // flight — repainting then would drop a stale game over whatever they're now looking at.
    if (UI.view !== "nflgame" || UI.nflGameId !== id) return;
    paintNflGame();
    startNflGamePoll();
  }
  function nflBack() {
    // A real UP button (ITEM 32). If Scores is genuinely the entry behind this one, step BACK
    // to it — that keeps the stack honest (tap in, tap out, and the reader is where they
    // started) instead of pushing a SECOND Scores entry that Back would then walk straight back
    // into the game they just left. Someone who deep-linked to #nflgame=<id> has no Scores
    // behind them at all, so they get a real forward navigation instead of leaving the app.
    const st = history.state || {};
    if (st.gfflView === "nflgame" && st.from === "scores") { history.back(); return; }
    UI.go("scores");
  }
  async function loadNflGame() {
    const id = UI.nflGameId;
    let j = null;
    try { j = await sportsFn("nfl_game", { eventId: String(id) }); } catch (e) { j = null; }
    if (UI.nflGameId !== id) return; // a different game was opened mid-flight — its own load owns the state
    UI._nflGame = (j && j.ok) ? j : { ok: false, reason: (j && j.reason) || "fetch-failed" };
  }
  function paintNflGame() {
    const body = $("#nflBody"), chip = $("#nflChip");
    if (!body) return;
    const g = UI._nflGame;
    if (!g || !g.ok) {
      // Honest and recoverable — never a blank card, never a thrown error.
      if (chip) chip.textContent = "";
      body.innerHTML = `<div class="card"><h2>Game unavailable</h2>
        <p class="mut">${nflReasonLine(g && g.reason)}</p>
        <p><button type="button" id="nflRetry" class="primary">Try again</button></p></div>`;
      const r = $("#nflRetry");
      if (r) r.addEventListener("click", async () => {
        r.disabled = true; r.textContent = "Trying…";
        await loadNflGame();
        if (UI.view === "nflgame") { paintNflGame(); startNflGamePoll(); }
      });
      return;
    }
    const st = g.status || {};
    // LIVE/FINAL only. The venue used to ride here too and simply repeated the kickoff card's
    // own "Where" line one row above it (caught on the review plate).
    if (chip) chip.textContent = st.state === "in" ? "LIVE" : st.state === "post" ? "FINAL" : "";
    if (chip) chip.className = st.state === "in" ? "nfllivechip" : "mut small";
    body.innerHTML = nflGameHtml(g);
  }
  UI.paintNflGame = paintNflGame;
  function nflGameLive() { const g = UI._nflGame; return !!(g && g.ok && g.status && g.status.state === "in"); }
  function nflGamePre() { const g = UI._nflGame; return !!(g && g.ok && g.status && g.status.state === "pre"); }
  // Cadence follows the Scores tab's own discipline (25s while anything is live, else slow) —
  // with one honest addition: a FINAL game is never polled at all, because its payload cannot
  // change again. A pre-game one is polled slowly so the view notices kickoff on its own
  // rather than sitting frozen until the reader backs out and comes in again.
  function startNflGamePoll() {
    stopNflGamePoll();
    const iv = nflGameLive() ? 25000 : nflGamePre() ? 120000 : 0;
    if (!iv) return;
    const tick = async () => {
      UI._nflGamePoll = null;
      if (UI.view !== "nflgame") return; // the view closed between the arm and the fire
      await loadNflGame();
      if (UI.view !== "nflgame") return;
      paintNflGame();
      startNflGamePoll(); // re-arms at the new state's cadence, or stops once the game is final
    };
    UI._nflGamePoll = setTimeout(tick, iv);
  }
  function stopNflGamePoll() {
    if (UI._nflGamePoll) { clearTimeout(UI._nflGamePoll); UI._nflGamePoll = null; }
  }

  // ---------------- matchup (the heart) ----------------
  // LG.gamesForWeek, not the raw schedule directly — during a playoff week (S7) that's the
  // bracket's own resolved pairings (a bye seed, or a not-yet-resolved slot, genuinely has no
  // matchup this week, which the "no matchup" fallback below already renders honestly).
  async function myMatchupThisWeek() {
    const mine = LG.myTeamId();
    if (!mine) return null;
    const wk = await LG.gamesForWeek(UI.week);
    return wk.find(([h, a]) => h === mine || a === mine) || wk[0] || null;
  }
  // ---------------- (removed 2026-08-11) the "Head to head" split-bar card ----------------
  // S3 ported the NFL box score's split-bar mechanic here as an 8-row category card. The user's
  // cosmetic pass removed it: every one of those numbers is readable in the player matchups
  // directly beneath, so the card was 300px of restatement. The per-team-colour split-bar idea
  // survives as the header's own full-width win-probability bar (each end in its side's
  // primary), and the .nflsbt original still lives on the NFL game page where the box score
  // has no per-player restatement.
  UI.renderMatchup = renderMatchup;
  async function renderMatchup(repaint) {
    if (!UI.matchup) UI.matchup = await myMatchupThisWeek();
    if (!UI.matchup) { main().innerHTML = `<div class="card"><p class="mut">No matchup — schedule missing.</p></div>`; return; }
    if (!repaint) await loadWeekRosters();
    const d = D();
    simProjEnsureAndRepaint("matchup"); // 2025 season replay — see startData()
    const [hId, aId] = UI.matchup;
    const muKey = hId + "-" + aId;
    if (!repaint || UI._h2hKey !== muKey) { UI._h2h = await LG.headToHead(hId, aId); UI._h2hKey = muKey; }
    const H = LG.teamById(hId), A = LG.teamById(aId);
    const hs = teamStarters(hId), as_ = teamStarters(aId);
    const hKeys = hs.map((p) => p.key), aKeys = as_.map((p) => p.key);
    const hTot = liveTotal(hId), aTot = liveTotal(aId);
    const wp = d.winProb(aKeys, hKeys); // away perspective, bar shows both
    const hRem = d.remaining(hKeys), aRem = d.remaining(aKeys);
    const projSum = (keys) => keys.reduce((s, k) => s + (d.projFor(k) || 0), 0);
    const hProj = projSum(hKeys), aProj = projSum(aKeys);
    const mine = LG.myTeamId();
    // (The "owner · record" line and its loadStandings() read left with the 2026-08-11
    // cosmetic pass — the standings table remains the one place a record is stated.)
    const anyLive = hRem.playing > 0 || aRem.playing > 0;
    const allDone = !anyLive && hRem.left === 0 && aRem.left === 0;
    const liveIndicator = anyLive ? '<div class="mulive"><span class="dot"></span>Live</div>'
      : allDone ? '<div class="mulive done">Final</div>' : "";
    const rows = pairBySlots(as_, hs);
    // Item 3 (2026-08-08): bench, in the same symmetric two-sided layout as the starters —
    // paired by roster order (bench has no fixed slot names to line up by), padded to whichever
    // side has more bench players so both columns stay the same length.
    const aBench = teamBench(aId), hBench = teamBench(hId);
    const benchRows = pairByIndex(aBench, hBench);
    // The feed (2026-08-09 playtest: "the feed needs to be a scrollable box and has to
    // indicate which team each feed item is from, maybe the ability to pick the team"). Each
    // event is ATTRIBUTED here, once, off the same starter-key sets the rest of the page is
    // built from — a "msg" (system) event belongs to neither side. The annotated array is
    // stashed so the Both/away/home filter is a pure re-render of what is already in memory:
    // picking a side must never refetch or recompute anything.
    const aSet = new Set(aKeys), hSet = new Set(hKeys);
    UI._feedAll = d.S.events
      .filter((e) => e.msg || hSet.has(e.key) || aSet.has(e.key))
      .slice(0, 60)
      .map((e) => ({ e, side: e.msg ? null : (aSet.has(e.key) ? "a" : "h") }));
    UI._feedTeams = { a: teamTag(A), h: teamTag(H) };
    // The filter is a per-matchup view control, persisted nowhere — opening a DIFFERENT
    // matchup starts on Both again rather than silently inheriting the last one's side.
    if (UI._feedKey !== muKey) { UI._feedKey = muKey; UI._feedSide = "both"; }
    const fside = UI._feedSide || "both";
    const fchip = (v, label) => `<button type="button" class="poschip ${fside === v ? "on" : ""}" data-fside="${v}">${esc(label)}</button>`;
    const threadKey = `w${UI.week}_${hId}-${aId}`;
    // COSMETIC PASS (2026-08-11, user markup): the win-probability bar leaves the narrow
    // middle column and stretches the FULL card width where the all-time-series line used to
    // sit, each end filled with THAT team's own primary meeting at the split — the one place
    // the matchup header spends team colour. Percentages flank the bar (no extra row). An
    // unknown probability (nobody counted yet) renders the track empty with no percentages —
    // a half-and-half bar is a claim about a game nobody has played (the .mini rule's lesson).
    const wpPct = Math.round(wp * 100);
    // "Known" needs BOTH rosters to exist — a probability against a side with no starters is
    // the half-and-half claim the .mini bar's unknown state was invented to refuse.
    const counted = aKeys.length > 0 && hKeys.length > 0;
    const pa = LG.teamPalette(A || {}), ph = LG.teamPalette(H || {});
    const wideBar = counted
      ? `<div class="mupbarrow"><b class="mupct">${wpPct}%</b>
           <div class="mupbar"><i style="width:${wpPct}%;background:${esc(pa.primary)}"></i><em style="width:${100 - wpPct}%;background:${esc(ph.primary)}"></em></div>
           <b class="mupct">${100 - wpPct}%</b></div>`
      : `<div class="mupbarrow"><div class="mupbar unknown"></div></div>`;
    // DESIGN HANDOFF (2026-08-11, "GFFL desktop view refinement"): the header carries the
    // muhero class + the two teams' palettes as CSS vars, and at ≥1024px becomes the
    // locker-hero treatment — 104px rounded-square crests on each team's own colour slash,
    // 30px names, scores at the inner edges. Pure CSS from this same markup (display:contents
    // + order), so the PHONE header stays byte-identical inside its measured cap. The
    // per-side "N to play · N live" line moves into the lineup card on desktop (.muplayline,
    // hidden on phones where the header's own .muhsub still carries it).
    main().innerHTML = `
      <div class="card muhead muhero" style="--tpa:${esc(pa.primary)};--tsa:${esc(pa.secondary)};--tta:${esc(pa.tertiary)};--tph:${esc(ph.primary)};--tsh:${esc(ph.secondary)};--tth:${esc(ph.tertiary)}">
        <div class="muhrow">
          ${muTeamHead(A, aId, mine, aTot, aProj, aRem, "")}
          <div class="muhmid">
            ${liveIndicator}
          </div>
          ${muTeamHead(H, hId, mine, hTot, hProj, hRem, " right")}
        </div>
        <div class="mut small mupweek">Week ${UI.week}</div>
        ${wideBar}
        <div class="rowline"><span id="healthChip" class="health" hidden></span></div>
      </div>
      <div class="card lineupcard"><div class="rowline muplayline">
          <span class="mut muhsub">${aRem.left} to play · ${aRem.playing} live</span>
          <span class="mut muhsub">${hRem.left} to play · ${hRem.playing} live</span>
        </div><div class="panner"><table class="tbl slottable mutable">
        <tbody>${rows.map(([pa, slot, ph]) => `<tr>
          <td class="pcell">${halfCell(pa, "left")}</td>
          <td class="slotcell" data-pos="${slotPos(slot)}">${slotBadge(slot)}</td>
          <td class="pcell right">${halfCell(ph, "right")}</td></tr>`).join("")}</tbody>
        <tfoot><tr class="totalrow">
          <td class="pcell">${totalHalfCell(aTot, "left")}</td>
          <td class="slotcell" data-pos="X">${slotBadge("TOT")}</td>
          <td class="pcell right">${totalHalfCell(hTot, "right")}</td>
        </tr></tfoot>
      </table></div></div>
      ${(aBench.length || hBench.length) ? `<div class="card lineupcard"><h2>Bench</h2><div class="panner"><table class="tbl slottable mutable benchtable"><tbody>
        ${benchRows.map(([pa, ph]) => `<tr>
          <td class="pcell">${halfCell(pa, "left")}</td>
          <td class="slotcell" data-pos="X">${slotBadge("BENCH")}</td>
          <td class="pcell right">${halfCell(ph, "right")}</td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
      ${h2hLine(UI._h2h, H, A) /* cosmetic pass 2026-08-11: the all-time series reads BELOW the player matchups now */}
      <div class="card"><h2>The feed</h2>
        <div class="poschips feedfilter" id="mufeedFilter">
          ${fchip("both", "Both")}${fchip("a", UI._feedTeams.a)}${fchip("h", UI._feedTeams.h)}
        </div>
        <div id="mufeed"></div></div>
      <div class="card" id="aiReadCard"><h2>AI read</h2>
        <button id="aiReadBtn" ${UI._aiRead && UI._aiRead.busy ? "disabled" : ""}>${UI._aiRead && UI._aiRead.busy ? "Reading the game…" : "Get an AI read"}</button>
        <div id="aiReadOut">${aiReadHtml()}</div>
      </div>
      <div class="card"><h2>Trash talk</h2>${chatWidgetHtml("muThread")}</div>`;
    paintFeed();
    document.querySelectorAll("#mufeedFilter .poschip").forEach((b) => b.addEventListener("click", () => {
      UI._feedSide = b.dataset.fside;
      document.querySelectorAll("#mufeedFilter .poschip").forEach((x) => x.classList.toggle("on", x.dataset.fside === UI._feedSide));
      paintFeed(); // a pure re-render of UI._feedAll — never a refetch
    }));
    $("#aiReadBtn") && $("#aiReadBtn").addEventListener("click", () => askAiRead(hId, aId, hs, as_));
    wireLockerTaps();
    wirePlayerCardTaps(); // every starter + bench half-cell that carries a real player (item 1)
    wireChat("muThread", threadKey);
    refreshChatList("muThread", threadKey);
    startChatPoll("muThread", threadKey);
    paintHealth();
    fitHeroNames(); hookFitOnFonts(); // fit-don't-clip, after the header is in the DOM
  }

  // ----------------  AI read (S5, plan §4.6's AI adjustment layer) ----------------
  // Button-triggered only — deliberately NOT auto-polling in v1 (preseason has no live data to
  // adjust against, and a matchup page that fires a Grok call every poll tick would spend real
  // money for nothing most of the season). One result is cached 5 minutes per matchup so a
  // second tap on the same matchup doesn't re-spend; a NEW matchup (or the cache going stale)
  // starts fresh. Degrades SILENTLY on any failure — a toast, never a broken card.
  const AI_READ_TTL = 5 * 60 * 1000;
  function aiReadKey(week, h, a) { return `w${week}_${h}-${a}`; }
  function aiReadHtml() {
    const st = UI._aiRead;
    const key = UI.matchup ? aiReadKey(UI.week, UI.matchup[0], UI.matchup[1]) : null;
    if (!st || st.key !== key) return '<p class="mut small">Tap for live adjustments to players still playing, with reasons.</p>';
    if (st.busy) return '<p class="mut small">Reading the game…</p>';
    if (st.error && !st.mults) return `<p class="mut small">${esc(st.error)}</p>`;
    const entries = Object.entries(st.mults || {});
    if (!entries.length) return '<p class="mut small">Nothing has changed enough to adjust right now.</p>';
    return entries.map(([name, m]) => {
      const projTxt = m.proj != null ? LG.fmtPts(m.proj) : "—";
      const adjTxt = m.adj != null ? LG.fmtPts(m.adj) : "—";
      return `<div class="fline"> <b>${escn(name)}</b> proj ${projTxt} → <b>${adjTxt}</b>
        <span class="delta ${m.mult >= 1 ? "up" : "down"}">×${LG.fmtNum(m.mult, 2)}</span><br>
        <small class="mut">${esc(m.why)}</small></div>`;
    }).join("");
  }
  async function askAiRead(hId, aId, hPlayers, aPlayers) {
    const key = aiReadKey(UI.week, hId, aId);
    const cur = UI._aiRead;
    if (cur && cur.busy) return;
    if (cur && cur.key === key && cur.mults && (LG.now() - cur.at) < AI_READ_TTL) return; // fresh cache
    const d = D();
    // Roster data (name/pos/team) is authoritative and ALWAYS present; the live-poll row layers
    // stats/game-state on top when it exists. A player the poll hasn't reached yet (e.g. no stat
    // line has arrived for them this cycle) must still show their real name, not their raw key.
    const buildSide = (players) => players.map((p) => {
      const row = d.S.players.get(p.key);
      const team = (row && row.team) || p.team;
      const g = d.S.games.get(d.slpTeam(team));
      return {
        name: (row && row.name) || p.name, pos: (row && row.pos) || p.pos, team,
        proj: d.projFor(p.key), actual: row && row.pts != null ? row.pts : 0,
        gameState: g ? g.state : "pre", clock: g && g.state === "in" ? `Q${g.period} ${g.clock}` : "",
      };
    });
    const H = LG.teamById(hId), A = LG.teamById(aId);
    const payload = { week: UI.week, teams: [
      { name: H ? H.name : "Home", players: buildSide(hPlayers) },
      { name: A ? A.name : "Away", players: buildSide(aPlayers) },
    ] };
    UI._aiRead = { key, at: 0, busy: true, error: null, mults: null };
    if (UI.view === "matchup") renderMatchup(true);
    try {
      const r = await fetch("/.netlify/functions/farmgpt", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: LG.PASS, mode: "gfflproj", matchup: payload }),
      });
      if (!r.ok) throw new Error("http-" + r.status);
      const reader = r.body.getReader(), dec = new TextDecoder();
      let text = "";
      for (;;) { const c = await reader.read(); if (c.done) break; text += dec.decode(c.value, { stream: true }); }
      const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      const byName = {};
      for (const side of payload.teams) for (const p of side.players) byName[p.name] = p;
      const mults = {};
      for (const p of (parsed.players || [])) {
        if (!p || typeof p.name !== "string") continue;
        const src = byName[p.name];
        const mult = Math.max(0.5, Math.min(1.5, Number(p.mult) || 1));
        const proj = src && src.proj != null ? src.proj : null;
        mults[p.name] = {
          mult, why: String(p.why || "").slice(0, 200), proj,
          adj: proj != null ? Math.round(proj * mult * 100) / 100 : null,
        };
      }
      UI._aiRead = { key, at: LG.now(), busy: false, error: null, mults };
    } catch (e) {
      UI._aiRead = { key, at: 0, busy: false, error: "AI read isn't available right now.", mults: null };
      toast("AI read isn't available right now.");
    }
    if (UI.view === "matchup") renderMatchup(true);
  }
  UI.askAiRead = askAiRead;

  function starterSlotList() {
    const r = (LG.rules && LG.rules.roster) || {};
    const out = [];
    for (const name of ["QB", "RB", "WR", "TE", "FLEX", "DST", "K"]) {
      for (let i = 0; i < (r[name] || 0); i++) out.push(name);
    }
    return out;
  }
  function pairBySlots(aList, hList) {
    const slots = starterSlotList();
    const take = (list, slot, taken) => {
      for (const p of list) if (p.slot === slot && !taken.has(p)) { taken.add(p); return p; }
      return null;
    };
    const ta = new Set(), th = new Set();
    return slots.map((s) => [take(aList, s, ta), s, take(hList, s, th)]);
  }
  // Item 3's bench section — bench has no fixed, enumerable slot names to line up by (unlike
  // starterSlotList's roster.QB/RB/WR/... counts), so it's paired by roster ORDER instead, out
  // to whichever side has more bench players — the shorter side's remaining rows render as
  // "Empty" so both columns still stay the same length and line up row-for-row.
  function pairByIndex(aList, hList) {
    const n = Math.max(aList.length, hList.length);
    const out = [];
    for (let i = 0; i < n; i++) out.push([aList[i] || null, hList[i] || null]);
    return out;
  }
  // The little NFL crest beside a player's name (2026-08-09). Comes off D.teamLogo, which is
  // derived from the slate ALREADY in memory — no new network call. Fixed dimensions and an
  // onerror handler for the same reason the Scores tab's crests carry them: a slow or dead
  // image must never shift a row. A team the payload carried no crest for renders NO <img> at
  // all rather than a broken box.
  function plogoHtml(team) {
    const src = D().teamLogo(team);
    // A crest-less team renders NO <img> — never a broken one. It DOES keep the 14px box:
    // without it, the row's name would start (left side) or end (right side) 19px further in
    // than every other row's, and "team B's names all end at one consistent x" would hold only
    // for whichever teams happen to have a crest on file. An empty span is not an image.
    if (!src) return '<span class="plogo plogoph" aria-hidden="true"></span>';
    return `<img class="plogo" src="${esc(src)}" alt="" width="14" height="14" loading="lazy" onerror="this.style.visibility='hidden'">`;
  }
  // Line 2 of a lineup row: the opponent and kickoff before the game, the live clock while it
  // is on, "Final" once it is done — exactly the ESPN reference's second line. "@DET" away,
  // bare "TB" at home (g.home, recorded by BOTH slate parsers).
  function gameLineHtml(g) {
    if (!g) return "";
    // ITEM 24 (2026-08-09): the live clock is NOT red. It used to carry .live, which paints
    // --accent — but "Q2 5:00" is an ordinary fact about the game, exactly like the opponent
    // and the kickoff it replaces on this same line, and red is a WARNING colour this app
    // spends on genuine alarms (the injury designation, an overdue deadline). .gclock keeps
    // the bold weight that made the clock scannable and inherits .pmeta's muted colour.
    // Wrapped in .gline (ITEM 26): the injury designation now shares this line, and without
    // its own element the two run together in textContent ("D" + "KC Fri 1:00 AM" reads
    // "DKC…"). The gap between them is a CSS margin, so only the markup can separate them for
    // anything that reads the line — a test, or a screen reader walking it.
    const inner = g.state === "in" ? `<span class="gclock">Q${g.period} ${esc(g.clock)}</span>`
      : g.state === "post" ? "Final"
      : (() => {
        const opp = g.oppAb ? (g.home ? esc(g.oppAb) : "@" + esc(g.oppAb)) : "";
        const kick = esc(shortKick(g));
        return opp && kick ? opp + " " + kick : (opp || kick);
      })();
    return inner ? `<span class="gline">${inner}</span>` : "";
  }
  // THE ESPN MATCHUP ROW (2026-08-09, rebuilt from the user's own screenshot of the real app).
  // EXACTLY THREE LINES per half, always the same three, so every row in the table is the same
  // height whatever it holds:
  //     1  the player's name, with his NFL team's little crest
  //     2  opponent + kickoff  ("@DET Sun 12:00 PM" / "TB Sun 12:00 PM"), or the live clock,
  //        or "Final"
  //     3  the game-stat summary — EMPTY before kickoff, but its height is RESERVED, which is
  //        what stops a pre-game row being shorter than a live one
  // Each line is a fixed-height, nowrap, ellipsised block (see .pline in league.html), so a
  // long name truncates on ONE line instead of wrapping and making its row taller than its
  // neighbours' — the "exactly even height for every player" the user asked for is structural,
  // not something that happens to hold for the names we tried.
  // The points column mirrors the same three lines (score / projection / reserved), which is
  // what keeps the big number on the name's own baseline.
  // An empty half renders the SAME three-line shape with a muted "Empty" — never a bare "—" —
  // so both columns stay aligned however the two rosters differ.
  function halfCell(p, side) {
    let nameHtml, metaHtml, statHtml, ptsHtml, projHtml, ball = false, titleAttr = "";
    if (!p) {
      // The empty half carries the crest's 14px slot too, so its "Empty" label starts at the
      // same x as every real name in the column — the point of the whole even-row rule.
      nameHtml = '<span class="plogo plogoph" aria-hidden="true"></span><b class="mut">Empty</b>';
      metaHtml = ""; statHtml = "";
      ptsHtml = '<span class="pts mut">—</span>'; projHtml = "";
    } else {
      const d = D();
      const row = d.S.players.get(p.key);
      const g = d.S.games.get(d.slpTeam(p.team));
      // d.livePts / d.liveProj return null — rendered "—" — for a key that resolves to no
      // player at all, rather than the fabricated "0.0" an unresolvable roster row used to
      // claim (2026-08-09). Both are guaranteed finite-or-null; fmtPts can never print NaN.
      const pts = d.livePts(p.key);
      const proj = d.liveProj(p.key);
      // Item 10 (no emoji in app chrome): red zone was " " — now a small CSS-drawn dot, not a
      // pictograph. Conflict was " " — now a plain text badge.
      // Red zone marks the OFFENSE in the red zone — a D/ST row isn't on the field.
      const rz = g && g.rz && g.state === "in" && p.pos !== "DST" ? '<span class="rzdot" title="Red zone"></span>' : "";
      // Possession (ITEM 25, 2026-08-09): a GOLD BORDER around the player's own half-cell.
      // It used to be a gold pip plus a faint row tint; the user asked for the border instead.
      // Still gold and not red — red is spoken for by the injury designation (item 24) — and
      // still only while that player's NFL team has the ball on offense, never a D/ST (a
      // defence is off the field), never under the replay (there is no drive data to read).
      // Drawn as an INSET ring (see .pcellgrid.hasball) so it costs the row no height.
      ball = hasBall(p);
      const conflict = row && row.conflict ? '<span class="conflictflag" title="Sources disagree">CONFLICT</span>' : "";
      // ESPN-style stat summary line ("312 pass yds, 2 TD" / "6 rec, 84 yds"), from whichever
      // source mergeRow picked. "" before any stat lands — the LINE still reserves its height.
      const sline = statSummary(p, row);
      // The row can no longer spell out "QB · PHI" (line 2 belongs to the opponent now), so the
      // position and team ride on the name's own tooltip. The crest carries the team visually,
      // and the centre band carries the slot.
      titleAttr = ` title="${esc(LG.shortName(p.name) + " · " + p.pos + " · " + p.team)}"`;
      nameHtml = `${plogoHtml(p.team)}<b${titleAttr}>${escn(p.name)}</b>`;
      // ITEM 17 (2026-08-09): the red-zone dot and the conflict flag ride on LINE 2, not beside
      // the name. They cost ~31px, and they appear on exactly the rows whose names are
      // longest-pressed — at 390px that was the difference between "J. Smith-Njigba" and
      // "J. Smi…". Line 2 is also where they belong: both are facts about the GAME's state,
      // which is what that line says, and a live row's line 2 is the short form ("Q2 5:00"),
      // so they cost nothing there. (The possession pip that used to ride here with them is
      // gone — item 25 replaced it with the half-cell's own gold ring, which costs no width
      // at all, so the longest names gained that space back too.)
      //
      // ITEM 26 (2026-08-09): Q / D / OUT joins them, and LINE 2 is the only place it can go.
      // Item 24 took red off the clock on this row; the half of the same sentence that says
      // what red is FOR ("What should be red is Q, D, our OUT status for players") had nothing
      // to attach to, because this row carries a name and nothing else on line 1 — and line 1
      // is the width-constrained one that two rounds of work went into. Line 2 is short.
      // It leads the line rather than trailing it: line 2 is nowrap + ellipsis, so whatever
      // sits last is what gets cut, and the one thing on this row that must never be cut is
      // "this man might not play". Same injLabel() every other surface reads, and the same
      // live-row-then-roster precedence the locker's injChip uses, so a status can never
      // render one way here and another way on My Team. A healthy player yields "" and gets
      // no span at all — not an empty one, and not a stray separator.
      const injTxt = injLabel((row && row.injury) || p.injury || "");
      const injHtml = injTxt ? `<span class="inj">${esc(injTxt)}</span>` : "";
      metaHtml = injHtml + gameLineHtml(g) + rz + conflict;
      statHtml = sline ? esc(sline) : "";
      ptsHtml = `<span class="pts">${LG.fmtPts(pts)}</span>`;
      projHtml = LG.fmtPts(proj);
    }
    const infoDiv = `<div class="pinfo">`
      + `<div class="pline pname">${nameHtml}</div>`
      + `<div class="pline pmeta mut">${metaHtml}</div>`
      + `<div class="pline pstatline mut">${statHtml}</div></div>`;
    const ptsDiv = `<div class="ppts">`
      + `<div class="pline pscore">${ptsHtml}</div>`
      + `<div class="pline pproj mut">${projHtml}</div>`
      + `<div class="pline pstatpad"></div></div>`;
    // data-pk only when there's a real player (never on an "Empty" half) — that's what
    // wirePlayerCardTaps() keys the click on, and it's also the whole "row-click" affordance
    // for the matchup lineup + bench tables (item 1's "matchup lineup rows both sides").
    // The gold ring is the only thing that says "this man has the ball", so it carries the
    // label the pip used to — a colour on its own is not an accessible statement.
    return `<div class="pcellgrid ${side}${ball ? " hasball" : ""}"${ball ? ' title="Has the ball"' : ""}${p ? ` data-pk="${esc(p.key)}"` : ""}>${side === "right" ? ptsDiv + infoDiv : infoDiv + ptsDiv}</div>`;
  }
  // The ESPN-reference stat summary for a matchup row: a compact position-aware line built
  // from the stats of whichever source mergeRow() picked for display (row.src — the same
  // stats row.pts was scored from, so the line can never disagree with the points beside it).
  // Returns "" until any stat has landed, so pre-game rows stay two lines tall.
  function statSummary(p, row) {
    if (!row || !row.src) return "";
    const side = row[row.src];
    const st = side && side.stats;
    if (!st) return "";
    const n = (k) => Number(st[k]) || 0;
    const parts = [];
    if (p.pos === "QB") {
      if (n("pass_yd")) parts.push(Math.round(n("pass_yd")) + " pass yds");
      const td = n("pass_td") + n("rush_td");
      if (td) parts.push(td + " TD");
      if (n("pass_int")) parts.push(n("pass_int") + " INT");
      if (n("rush_yd") >= 15) parts.push(Math.round(n("rush_yd")) + " rush yds");
    } else if (p.pos === "K") {
      if (n("fg_made_yd")) parts.push(Math.round(n("fg_made_yd")) + " FG yds");
      if (n("xp_made")) parts.push(n("xp_made") + " XP");
      if (n("fg_miss")) parts.push(n("fg_miss") + " FG miss");
    } else if (p.pos === "DST") {
      if (st.dst_pa != null) parts.push(st.dst_pa + " PA");
      if (n("dst_sack")) parts.push(n("dst_sack") + (n("dst_sack") === 1 ? " sack" : " sacks"));
      if (n("dst_int")) parts.push(n("dst_int") + " INT");
    } else { // RB / WR / TE / FLEX bodies
      if (n("rec")) parts.push(n("rec") + " rec");
      const yds = n("rush_yd") + n("rec_yd");
      if (yds) parts.push(Math.round(yds) + " yds");
      const td = n("rush_td") + n("rec_td");
      if (td) parts.push(td + " TD");
    }
    return parts.slice(0, 3).join(", ");
  }
  // The TOTAL row's own half-cell — deliberately NOT halfCell(), which resolves live points by
  // looking a player up by KEY; a plain number has no key to look up.
  function totalHalfCell(total, side) {
    const infoDiv = '<div class="pinfo"><div class="pline pname"><b class="mut">TOTAL</b></div>'
      + '<div class="pline pmeta mut"></div><div class="pline pstatline mut"></div></div>';
    const ptsDiv = `<div class="ppts"><div class="pline pscore"><span class="pts">${LG.fmtPts(total)}</span></div>`
      + '<div class="pline pproj mut"></div><div class="pline pstatpad"></div></div>';
    return `<div class="pcellgrid ${side}">${side === "right" ? ptsDiv + infoDiv : infoDiv + ptsDiv}</div>`;
  }
  function shortKick(g) {
    if (!g.kickoff) return "";
    const dt = new Date(g.kickoff);
    return dt.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  }
  const STAT_LABEL = {
    pass_yd: "pass yds", pass_td: "pass TD", pass_int: "INT", pass_2pt: "2-pt pass",
    rush_yd: "rush yds", rush_td: "rush TD", rush_2pt: "2-pt rush",
    rec: "catch", rec_yd: "rec yds", rec_td: "rec TD", rec_2pt: "2-pt catch",
    fum_lost: "fumble lost", fg_0_39: "FG", fg_40_49: "FG 40+", fg_50: "FG 50+", fg_miss: "FG miss",
    xp_made: "XP", xp_miss: "XP miss", dst_sack: "sack", dst_int: "INT", dst_fum_rec: "fumble rec",
    dst_td: "defensive TD", dst_safety: "safety", dst_blk: "block", dst_pa: "pts allowed",
  };
  // side is "a" (away) / "h" (home) / null (a system message, which belongs to neither team);
  // tags is {a,h} — the two teams' short tags, resolved once per render by the caller.
  function feedLine(e, side, tags) {
    // e.t is stamped in LEAGUE time at the source (see applySide) — off the replay that IS
    // wall time, and under it a Sunday-afternoon board's feed reads as a Sunday afternoon.
    const t = new Date(e.t).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (e.msg) return `<div class="fline sys"><span class="mut">${t}</span> ${esc(e.msg)}</div>`;
    const sign = e.dPts > 0 ? "+" : "";
    const cls = e.dPts > 0 ? "up" : e.dPts < 0 ? "down" : "flat";
    // The team chip is what "indicate which team each feed item is from" asks for — a colored
    // left accent alone would only ever say "one of the two", not which.
    const sideCls = side === "a" ? "away" : side === "h" ? "home" : "";
    const chip = side && tags ? `<span class="fteam ${sideCls}">${esc(side === "a" ? tags.a : tags.h)}</span>` : "";
    return `<div class="fline ${sideCls}"><span class="mut">${t}</span> ${chip}<b>${escn(e.name)}</b>
      ${esc(STAT_LABEL[e.stat] || e.stat)} ${e.from ?? 0}→${e.to ?? 0}
      <span class="delta ${cls}">${e.dPts ? sign + LG.fmtNum(e.dPts) : ""}</span></div>`;
  }
  // Repaints #mufeed alone from the already-annotated UI._feedAll. Called once per matchup
  // render and again on every filter tap — no network, no recomputation, nothing else on the
  // page touched (so an open trash-talk composer or a mid-stream AI read survives a filter tap).
  function paintFeed() {
    const box = $("#mufeed");
    if (!box) return;
    const side = UI._feedSide || "both";
    const tags = UI._feedTeams || { a: "?", h: "?" };
    const all = UI._feedAll || [];
    const rows = side === "both" ? all : all.filter((r) => r.side === side);
    if (rows.length) { box.innerHTML = rows.map((r) => feedLine(r.e, r.side, tags)).join(""); return; }
    box.innerHTML = side === "both"
      ? '<p class="mut">Quiet so far — events land here the moment a starter does anything.</p>'
      : `<p class="mut">Nothing from ${esc(side === "a" ? tags.a : tags.h)} yet.</p>`;
  }
  // The slot badge between the two teams takes the draft board's own position colors
  // (2026-08-09 playtest). A slot that is not a single position — FLEX, BENCH, TOT, IR, OP —
  // has no position color to take, so it falls back to the neutral --pos-X the players table's
  // own badge already uses for exactly the same case.
  const POS_SLOTS = ["QB", "RB", "WR", "TE", "K", "DST"];
  function slotPos(slot) { return POS_SLOTS.includes(String(slot)) ? String(slot) : "X"; }

  // ---------------- team / lineup ----------------
  // ITEM 23 (2026-08-09, user: "that font should be much larger and the color should take up
  // the width and height of the column so there isn't blank space"). The badge now FILLS its
  // cell (see td.slotcell in league.html), so the only thing left to decide per-label is the
  // type size: at the column's width a 3-character position label ("QB", "FLEX" is four) can
  // be set much larger than "BENCH" can. .sbwide is that one modifier — anything longer than
  // three characters steps down, which is what keeps BENCH inside the cell at 390px while a
  // QB reads at nearly half again the size it used to.
  function slotBadge(slot) {
    const s = String(slot || "");
    return `<span class="slotbadge${s.length > 3 ? " sbwide" : ""}">${esc(s)}</span>`;
  }
  // ============ ITEM 21 (2026-08-09): "Suggest a trade" ============
  // A LOCAL, DETERMINISTIC heuristic — deliberately NOT a model call. Three reasons, and none
  // of them is cost alone: it has to be instant (this is a button in a trade builder, not a
  // research query), it has to be TESTABLE (a suggestion nobody can predict cannot be
  // asserted against a fixture), and "roughly equal value" is literally arithmetic. Nothing
  // here fetches; it reads the projections and season logs the Moves page already has.
  //
  // It NEVER sends. It fills the give/get selections and says one line about why, and the
  // user reviews, adjusts and presses Send themselves.
  //
  //   value(p)      0.65 x season average + 0.35 x this week's projection, or whichever of
  //                 the two exists, or 0. Season average is the honest measure of a player
  //                 (a trade is not about one week) but the projection is the only number a
  //                 pre-season or freshly-added player has, so neither can be the sole input.
  //   strength      per position, the summed value of the top N players, N = that position's
  //                 STARTING requirement. "Weaker" is therefore relative and computable:
  //                 edge(pos) = myStrength - theirStrength.
  //   the trade     I send from a position where edge > 0 (my depth, their weakness) and
  //                 receive at a position where edge < 0 (their depth, my weakness), so a
  //                 legal, balanced pair helps both sides where they are weaker BY
  //                 CONSTRUCTION rather than by hoping.
  //   balanced      within TRADE_TOL_FLOOR points, or TRADE_TOL_FRAC of the larger side,
  //                 whichever is more generous. Among the survivors it picks the lowest
  //                 RELATIVE imbalance (balance / average value), so a meaningful swap of two
  //                 real starters beats a trivially equal swap of two bench bodies.
  //   legal         never a locked player, never an IR player, cap 3 a side, and both rosters
  //                 must still satisfy every positional minimum (including the FLEX pool)
  //                 after the swap.
  const TRADE_TOL_FLOOR = 1.5;   // points — two players inside this are "the same player"
  const TRADE_TOL_FRAC = 0.15;   // …or within 15% of the larger side, whichever is bigger
  const TRADE_POS = ["QB", "RB", "WR", "TE", "K", "DST"];
  function rosterReq() { return (LG.rules && LG.rules.roster) || LG.DEFAULT_RULES.roster; }
  // The value of one player. Exposed so the suite can cross-check the arithmetic it asserts
  // against rather than re-deriving it (and so a future tweak here fails loudly there).
  function tradeValueOf(p) {
    if (!p) return 0;
    const s = UI._faStats && UI._faStats.get(p.key);
    const avg = s && s.avg != null && isFinite(s.avg) ? Number(s.avg) : null;
    const pj = D().projFor(p.key);
    const proj = pj != null && isFinite(pj) ? Number(pj) : null;
    if (avg != null && proj != null) return 0.65 * avg + 0.35 * proj;
    if (avg != null) return avg;
    if (proj != null) return proj;
    return 0;
  }
  UI.tradeValueOf = tradeValueOf;
  function valuesAt(roster, pos) {
    return roster.filter((p) => p.pos === pos).map(tradeValueOf).sort((a, b) => b - a);
  }
  function posStrength(roster, pos) {
    const need = rosterReq()[pos] || 0;
    return valuesAt(roster, pos).slice(0, need).reduce((a, b) => a + b, 0);
  }
  // The value of the weakest man I currently START at this position — the bar a newcomer has
  // to clear to actually improve my lineup rather than merely join my bench. 0 when the
  // position isn't even filled, which is the strongest possible case for receiving one.
  function worstStarterValue(roster, pos) {
    const need = rosterReq()[pos] || 0;
    if (!need) return 0;
    const vs = valuesAt(roster, pos);
    return vs.length >= need ? vs[need - 1] : 0;
  }
  // Would this roster still be legal after sending `out` and receiving `in`? Positional
  // minimums INCLUDING the flex pool — a team that has to start RB2/WR2/TE1/FLEX1 needs six
  // bodies across those three positions, not just the per-position counts.
  function rosterStillLegal(roster, out, inn) {
    const gone = new Set(out.map((p) => p.key));
    const list = roster.filter((p) => !gone.has(p.key)).concat(inn);
    const R = rosterReq();
    const c = {};
    for (const p of list) c[p.pos] = (c[p.pos] || 0) + 1;
    for (const pos of TRADE_POS) if ((c[pos] || 0) < (R[pos] || 0)) return false;
    const pool = (c.RB || 0) + (c.WR || 0) + (c.TE || 0);
    return pool >= (R.RB || 0) + (R.WR || 0) + (R.TE || 0) + (R.FLEX || 0);
  }
  function tradeSendable(roster) {
    return roster.filter((p) => p && p.slot !== "IR" && TRADE_POS.includes(p.pos) && !playerLocked(p));
  }
  function tolFor(a, b) { return Math.max(TRADE_TOL_FLOOR, TRADE_TOL_FRAC * Math.max(a, b)); }
  function posPhrase(list) {
    const seen = [...new Set(list.map((p) => p.pos))];
    return seen.length === 1 ? seen[0] : seen.slice(0, 2).join(" and ");
  }
  // mine / theirs are roster arrays ([{key,name,pos,team,slot}]). Returns a suggestion or
  // null — "no reasonable trade exists" is a real answer here, not a failure to try harder.
  // The tiniest possible renderer for the analyst's prose: escape EVERYTHING first (model
  // output is external data), then allow exactly two shapes back — **bold** and paragraph
  // breaks. No markdown library; the prompt promises short paragraphs and bold names, nothing
  // else, and anything else the model tries stays visible as literal text rather than markup.
  function aiProseFmt(text) {
    const paras = esc(String(text || "").trim()).split(/\n{2,}/);
    return paras.filter((p) => p.trim()).map((p) =>
      "<p>" + p.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>") + "</p>").join("");
  }
  UI.aiProseFmt = aiProseFmt; // test hook
  function suggestTradePair(mine, theirs) {
    if (!mine || !theirs || !mine.length || !theirs.length) return null;
    const edge = {};
    for (const pos of TRADE_POS) edge[pos] = posStrength(mine, pos) - posStrength(theirs, pos);
    const myDepth = TRADE_POS.filter((p) => edge[p] > 0);
    const myNeed = TRADE_POS.filter((p) => edge[p] < 0);
    if (!myDepth.length || !myNeed.length) return null;
    const gAll = tradeSendable(mine).filter((p) => myDepth.includes(p.pos));
    const rAll = tradeSendable(theirs).filter((p) => myNeed.includes(p.pos));
    if (!gAll.length || !rAll.length) return null;
    const V = new Map([...gAll, ...rAll].map((p) => [p.key, tradeValueOf(p)]));
    const sum = (list) => list.reduce((a, p) => a + V.get(p.key), 0);
    // A candidate survives only if it is balanced, legal for BOTH rosters, and (on the strict
    // pass) upgrades each side's STARTING lineup at the position it is receiving.
    function consider(give, get, strict, out) {
      const vg = sum(give), vr = sum(get);
      const bal = Math.abs(vg - vr);
      if (bal > tolFor(vg, vr)) return;
      if (!rosterStillLegal(mine, give, get) || !rosterStillLegal(theirs, get, give)) return;
      if (strict) {
        for (const p of get) if (V.get(p.key) <= worstStarterValue(mine, p.pos)) return;
        for (const p of give) if (V.get(p.key) <= worstStarterValue(theirs, p.pos)) return;
      }
      // Lowest RELATIVE imbalance wins, so a 12.0-for-12.5 swap of two starters beats a
      // 3.0-for-3.2 swap of two spare parts even though the raw gap is larger.
      const rel = bal / Math.max(1, (vg + vr) / 2);
      out.push({ give, get, giveVal: vg, getVal: vr, balance: bal, rel, strict });
    }
    const pick = (cands) => {
      if (!cands.length) return null;
      // Deterministic to the last tie: relative imbalance, then raw size (prefer the bigger
      // trade), then the keys themselves, so the same two rosters always suggest the same swap.
      cands.sort((a, b) => (a.rel - b.rel)
        || ((b.giveVal + b.getVal) - (a.giveVal + a.getVal))
        || (a.give.map((p) => p.key).join() + "|" + a.get.map((p) => p.key).join())
             .localeCompare(b.give.map((p) => p.key).join() + "|" + b.get.map((p) => p.key).join()));
      return cands[0];
    };
    const ones = [];
    for (const g of gAll) for (const r of rAll) consider([g], [r], true, ones);
    let best = pick(ones);
    if (!best) {
      // 2-for-2, when no single pair can balance. Bounded to the six most valuable candidates
      // a side (15 pairs each, 225 combinations) — beyond that the extra options are all
      // bench filler and the cost is quadratic.
      const top = (list) => list.slice().sort((a, b) => V.get(b.key) - V.get(a.key)).slice(0, 6);
      const gT = top(gAll), rT = top(rAll), twos = [];
      for (let i = 0; i < gT.length; i++) for (let j = i + 1; j < gT.length; j++)
        for (let a = 0; a < rT.length; a++) for (let b = a + 1; b < rT.length; b++)
          consider([gT[i], gT[j]], [rT[a], rT[b]], true, twos);
      best = pick(twos);
    }
    if (!best) { const relaxed = []; for (const g of gAll) for (const r of rAll) consider([g], [r], false, relaxed); best = pick(relaxed); }
    if (!best) return null;
    best.kind = best.give.length === 1 ? "1-for-1" : best.give.length + "-for-" + best.get.length;
    best.why = "You're deep at " + posPhrase(best.give) + "; they're deep at " + posPhrase(best.get) + ".";
    return best;
  }
  UI.suggestTradePair = suggestTradePair;

  function playerLocked(p) {
    const d = D();
    const g = d.S.games.get(d.slpTeam(p.team));
    if (!g) return false;
    if (g.state === "in" || g.state === "post") return true;
    return g.kickoff ? LG.now() >= new Date(g.kickoff).getTime() : false;
  }
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  UI.toast = toast;

  // ---------------- chat (plan §4.5) — gifs, memes, event posts, threads ----------------
  // One reusable widget (list + composer) drives BOTH the league-wide Chat tab
  // and each matchup's trash-talk thread. Only one instance is ever mounted at
  // a time (main() is a single container; the matchup page mounts its own
  // thread widget alongside the scoreboard, never simultaneously with the
  // full-page Chat tab), so static id-prefixing per instance is enough —
  // idPfx is "chat" for the league channel, "muThread" for a matchup thread.
  UI._chatState = {};
  function chatState(idPfx) {
    return UI._chatState[idPfx] || (UI._chatState[idPfx] = { replyTo: null, pendingImg: null, pendingGif: null });
  }
  // REFINEMENT 3 (2026-08-11, user): the "Images" (recent-images) button is GONE — its meme
  // library went with it — and a messenger-style EMOJI PICKER joins. The picker's trigger is
  // an SVG smiley (the zero-emoji app-chrome rule), and its GRID IS RENDERED LAZILY on first
  // open: the panel's emojis are keyboard keys for USER content, but until someone opens it
  // they would be app-authored glyphs sitting in the DOM — which is exactly what section U's
  // chrome scan exists to catch. Empty until opened = clean by construction.
  function chatWidgetHtml(idPfx) {
    return `
      <div class="chatlist" id="${idPfx}List"></div>
      <div class="chatcompose">
        <div class="chatgifbox" id="${idPfx}GifBox" hidden>
          <input class="chatGifQ" id="${idPfx}GifQ" placeholder="Search GIFs…" autocomplete="off">
          <div class="chatGifGrid" id="${idPfx}GifGrid"></div>
        </div>
        <div class="chatEmojiBox" id="${idPfx}EmojiBox" hidden><div class="chatEmojiGrid" id="${idPfx}EmojiGrid"></div></div>
        <div class="chatReplyPreview" id="${idPfx}ReplyPreview" hidden></div>
        <div class="chatPending" id="${idPfx}Pending" hidden></div>
        <div class="chatRow">
          <button class="chaticon" id="${idPfx}ImgBtn" type="button" title="Add a photo">Photo</button>
          <input type="file" accept="image/*" class="chatFileInput" id="${idPfx}FileInput" hidden>
          <button class="chaticon" id="${idPfx}GifBtn" type="button" title="Search GIFs">GIF</button>
          <button class="chaticon chatEmojiBtn" id="${idPfx}EmojiBtn" type="button" title="Add an emoji" aria-label="Add an emoji">
            <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="7" cy="8" r="1.1" fill="currentColor"/><circle cx="13" cy="8" r="1.1" fill="currentColor"/><path d="M6.4 12.2c.9 1.3 2.1 2 3.6 2s2.7-.7 3.6-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </button>
          <textarea class="chatText" id="${idPfx}Text" maxlength="500" rows="1" placeholder="Say something…"></textarea>
          <button class="chatSend primary" id="${idPfx}Send" type="button">Send</button>
        </div>
      </div>`;
  }
  // The messenger set — league-flavoured. USER CONTENT once tapped (it lands in the composer
  // exactly as if typed), so the app-chrome emoji ban does not apply to what the reader picks.
  const CHAT_EMOJI = ["😂","🤣","😭","💀","🔥","🐐","🏈","💪","👑","🏆","🎯","💰","🙌","👏","🤝","👀","😤","😮‍💨","🥶","🥵","😈","🤡","🗑️","💩","🧊","❄️","📈","📉","🚀","🛬","😱","😴","🤯","🫡","🤞","🙏","💔","❤️","💯","✅","❌","⚠️","🍀","🎉","🍿","🧀","🥩","🍺","😬","🤔","🙄","😅","🤷","🤦","😎","🤓","🥴","🤢","😡","🤬"];
  function insertAtCursor(ta, s) {
    if (!ta) return;
    const st = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    const en = ta.selectionEnd == null ? st : ta.selectionEnd;
    ta.setRangeText(s, st, en, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true })); // autoGrowChatText listens here
    ta.focus();
  }
  // ≤320px longest side, JPEG q0.72 — the same shape as index.html's photo
  // pickers (goat/work-order), written inline here per house convention (no
  // shared JS module between pages/apps in this repo).
  //
  // ALPHA (2026-08-11, user: "when I upload a logo with a transparent background it makes the
  // background black"): JPEG HAS NO ALPHA CHANNEL, so a transparent PNG drawn onto a canvas
  // and encoded as JPEG composites against the canvas's own transparent-BLACK and comes out
  // with a black box behind the mark. `opts.alpha` (the logo path) encodes PNG *when the
  // source genuinely carries transparency* and stays on JPEG when it doesn't — JPEG is far
  // smaller and is what every photo wants. Chat passes no opts at all, so its behaviour is
  // byte-identical. The scan short-circuits on the first transparent pixel, which for a logo
  // with clear corners is the very first one it reads.
  function hasTransparency(ctx, w, h) {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }
  function resizeImageToDataUrl(file, maxDim, quality, opts) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w >= h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
          else if (h > w && h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
          const cv = document.createElement("canvas");
          cv.width = w || 1; cv.height = h || 1;
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          if (opts && opts.alpha && hasTransparency(ctx, cv.width, cv.height)) resolve(cv.toDataURL("image/png"));
          else resolve(cv.toDataURL("image/jpeg", quality || 0.72));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  // A logo, sized to fit its cap WITHOUT ever giving up transparency. PNG has no quality dial
  // the way JPEG does, so the only lever on an oversized transparent logo is PIXELS — and
  // shrinking is the right trade here: a slightly softer crest is recoverable, a black box
  // behind the mark is the bug being fixed. An opaque logo takes the JPEG path on the first
  // pass and almost never sees the loop at all.
  async function resizeLogoToDataUrl(file, cap) {
    let dim = LOGO_DIM, out = "";
    for (let i = 0; i < 4; i++) {
      out = await resizeImageToDataUrl(file, dim, 0.86, { alpha: true });
      if (out.length <= cap) return out;
      dim = Math.round(dim * 0.75);
    }
    return out; // still too big — the caller reports it rather than silently flattening
  }
  UI.resizeLogoToDataUrl = resizeLogoToDataUrl; // test hook
  // The single gate every image path (file pick, meme-library re-post) runs
  // through — exposed so tests can drive the oversized-refusal path directly
  // without needing a real >320px source image to prove the cap.
  UI.attachImage = function (idPfx, dataUrl) {
    if (!dataUrl || dataUrl.length > IMG_CAP) { toast("That photo is too big — try a smaller one."); return false; }
    const st = chatState(idPfx);
    st.pendingImg = dataUrl; st.pendingGif = null;
    showPendingPreview(idPfx, dataUrl);
    return true;
  };
  function showPendingPreview(idPfx, src) {
    const el = $("#" + idPfx + "Pending");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `<img src="${esc(src)}"><button class="chatPendingX" type="button">✕</button>`;
    el.querySelector(".chatPendingX").addEventListener("click", () => clearPendingPreview(idPfx));
  }
  function clearPendingPreview(idPfx) {
    const st = chatState(idPfx);
    st.pendingImg = null; st.pendingGif = null;
    const el = $("#" + idPfx + "Pending");
    if (el) { el.hidden = true; el.innerHTML = ""; }
  }
  function setReplyTo(idPfx, m) {
    const st = chatState(idPfx);
    const who = m.sys ? "GFFL" : ((LG.teamById(m.teamId) || {}).name || m.who || "?");
    const snippet = m.text || (m.img ? "[photo]" : m.gif ? "[gif]" : "");
    st.replyTo = { id: m.id, who, text: snippet };
    const el = $("#" + idPfx + "ReplyPreview");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `<span class="mut small">Replying to <b>${esc(who)}</b>: ${esc(snippet.slice(0, 60))}</span> <button class="chatReplyX" type="button">✕</button>`;
    el.querySelector(".chatReplyX").addEventListener("click", () => clearReplyPreview(idPfx));
  }
  function clearReplyPreview(idPfx) {
    chatState(idPfx).replyTo = null;
    const el = $("#" + idPfx + "ReplyPreview");
    if (el) { el.hidden = true; el.innerHTML = ""; }
  }
  // Probed once per page session on the first GIF-button tap (never on load —
  // a blocked/no-key Tenor should never cost a request nobody asked for).
  // Only the literal "gif-not-configured" reason hides the button for good;
  // any other hiccup (network blip, http-500) leaves it retryable.
  UI._gifAvailable = null;
  async function ensureGifAvailability() {
    if (UI._gifAvailable === false) return false;
    if (UI._gifAvailable === true) return true;
    try {
      const r = await lgFn("lg_gif_search", { q: "" });
      if (r && r.ok === false && r.reason === "gif-not-configured") { UI._gifAvailable = false; return false; }
      UI._gifAvailable = true;
      return true;
    } catch (e) { return true; }
  }
  async function runGifSearch(idPfx) {
    const qInp = $("#" + idPfx + "GifQ"), grid = $("#" + idPfx + "GifGrid");
    if (!qInp || !grid) return;
    const q = qInp.value.trim();
    if (q.length < 2) { grid.innerHTML = ""; return; }
    let r;
    try { r = await lgFn("lg_gif_search", { q }); } catch (e) { r = null; }
    if (!$("#" + idPfx + "GifGrid")) return; // widget torn down mid-search
    // Item 4 (2026-08-08): a transient failure (network blip, a non-2xx from Tenor) is never
    // silent — a friendly inline message with a real retry affordance, re-running the exact
    // same search. "gif-not-configured" is handled entirely by ensureGifAvailability (hides the
    // button before this ever runs), so any {ok:false} reaching here IS a transient one.
    if (!r || !r.ok) {
      grid.innerHTML = '<p class="mut small">GIF search hiccuped — try again. <button type="button" class="gifRetry">Retry</button></p>';
      const retryBtn = grid.querySelector(".gifRetry");
      if (retryBtn) retryBtn.addEventListener("click", () => runGifSearch(idPfx));
      return;
    }
    const gifs = r.gifs || [];
    grid.innerHTML = gifs.length
      ? gifs.map((g, i) => `<button class="gifThumb" type="button" data-gi="${i}"><img src="${esc(g.preview)}" loading="lazy" alt=""></button>`).join("")
      : '<p class="mut small">No results.</p>';
    grid.querySelectorAll("[data-gi]").forEach((b) => b.addEventListener("click", () => {
      const g = gifs[Number(b.dataset.gi)];
      const st = chatState(idPfx);
      st.pendingGif = g; st.pendingImg = null;
      const box = $("#" + idPfx + "GifBox");
      if (box) box.hidden = true;
      showPendingPreview(idPfx, g.preview);
    }));
  }
  // (toggleMemeLibrary — the "Images" recent-images picker — REMOVED 2026-08-11 by user
  // order, refinement 3. LG.recentChatImages, its data source, went with it in lg-core.)
  function hideImageOverlayDom() { const ov = $("#imgOverlay"); if (ov) ov.hidden = true; }
  function openImageOverlay(src) {
    const ov = $("#imgOverlay"), img = $("#imgOverlayImg");
    if (!ov || !img) return;
    img.src = src;
    ov.hidden = false;
    UI.overlayOpened(hideImageOverlayDom); // ITEM 32 — Back closes the lightbox, not the view
  }
  UI.openImageOverlay = openImageOverlay;
  UI.closeImageOverlay = function () { hideImageOverlayDom(); UI.overlayClosed(); };
  // ---------------- player names in chat are tappable (2026-08-11) ----------------
  // "any player names in chat should be clickable to see their player card." EVERYWHERE — the
  // Chat tab, a matchup's trash-talk thread, the locker wall, the desktop rail and the phone's
  // own league-home preview — because a name that is a link on one surface and dead text on the
  // next teaches nothing.
  //
  // SAFETY: chat is user content, so the match runs on the ESCAPED string and never on the raw
  // text — the only markup that can ever reach the page is the wrapper this function writes.
  // Entity runs (&amp; &lt; &gt; &quot;) are split out first and never matched INTO, so a name
  // can never be found inside an escape sequence and tear it in half.
  //
  // TEAMS WIN TIES: a player name that is also a CURRENT team's name is left alone. teamMention
  // is what that string means everywhere else in this app, and one word with two meanings is
  // worse than one missing link.
  function playerNameIndex() {
    const rosters = UI._rosters || {};
    const keys = [];
    for (const t of LG.teams) for (const p of (rosters[t.id] || [])) keys.push(p.key);
    const sig = keys.join(",");
    if (UI._pnIndex && UI._pnIndex.sig === sig) return UI._pnIndex;
    const teamNames = new Set(LG.teams.map((t) => String(t.name || "").trim().toLowerCase()));
    const byName = new Map(); // lowercased ESCAPED display form -> {key, form}
    for (const t of LG.teams) {
      for (const p of (rosters[t.id] || [])) {
        if (!p || !p.name || !p.key) continue;
        // BOTH forms: what the app renders (LG.shortName — "J. Allen") and what a person is
        // far more likely to actually type ("Josh Allen").
        for (const raw of [String(p.name), LG.shortName(p.name)]) {
          const form = raw.trim();
          if (form.length < 4) continue;                  // too short to be a name in prose
          if (teamNames.has(form.toLowerCase())) continue; // teams win ties
          const k = esc(form).toLowerCase();
          if (!byName.has(k)) byName.set(k, { key: p.key, form: esc(form) });
        }
      }
    }
    // Longest first, so "Amon-Ra St. Brown" is matched before a bare "St. Brown" ever could be.
    const forms = [...byName.values()].sort((a, b) => b.form.length - a.form.length);
    const idx = { sig, byName, re: null };
    if (forms.length) {
      const alt = forms.map((f) => f.form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      // Word-bounded by hand: \b is wrong here because these forms end in "." and "/" as often
      // as they end in a letter ("J. Allen", "Bills D/ST").
      idx.re = new RegExp("(^|[^A-Za-z0-9])(" + alt + ")(?![A-Za-z0-9])", "gi");
    }
    UI._pnIndex = idx;
    return idx;
  }
  const ENTITY_RE = /(&(?:amp|lt|gt|quot);)/;
  function linkPlayerNames(escaped) {
    const idx = playerNameIndex();
    if (!idx.re || !escaped) return escaped;
    return String(escaped).split(ENTITY_RE).map((seg) => {
      if (ENTITY_RE.test(seg)) return seg; // an escape sequence — never matched into
      idx.re.lastIndex = 0;
      return seg.replace(idx.re, (m, pre, name) => {
        const hit = idx.byName.get(String(name).toLowerCase());
        if (!hit) return m;
        // .pcinline is the app's existing inline player-name control (the claims/trade rows);
        // wirePlayerCardTaps picks it up off data-pk exactly like every other player row, so
        // Escape/Back/overlay behaviour is identical by construction.
        return pre + `<button type="button" class="pcinline chatname" data-pk="${esc(hit.key)}">${name}</button>`;
      });
    }).join("");
  }
  UI.linkPlayerNames = linkPlayerNames; // test hook
  function chatMsgHtml(m, byId, tid) {
    if (m.sys) {
      const when = new Date(m.t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
      return `<div class="chatRowMsg" data-mid="${esc(m.id || "")}"><div class="chatSys">${esc(m.text || "")} <span class="mut small">${when}</span></div></div>`;
    }
    const mine = m.teamId === tid;
    const team = LG.teamById(m.teamId);
    const name = esc((team && team.name) || m.who || "?");
    const when = new Date(m.t).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
    const replied = m.replyTo && byId && byId.get && byId.get(m.replyTo);
    const replyBlock = replied
      ? `<div class="chatQuote">${esc((LG.teamById(replied.teamId) || {}).name || replied.who || "?")}: ${esc((replied.text || (replied.img ? "[photo]" : replied.gif ? "[gif]" : "")).slice(0, 80))}</div>`
      : "";
    const imgSrc = m.img ? m.img : (m.gif ? (m.gif.preview || m.gif.url) : "");
    const imgFull = m.img ? m.img : (m.gif ? m.gif.url : "");
    const canDelete = mine || isCommish();
    // S3: the byline carries the team's crest and its colours. A message whose team is NOT on
    // the league's current roster — a folded franchise, an imported season's ghost — resolves
    // to no team at all, and keeps the plain stored name it always had: an identity treatment
    // is for teams that exist, and painting one here would put a franchise back on screen that
    // the record book deliberately drops (lg-core's `live(id)` gate, 92f7ffe).
    const byline = team
      ? `${crestHtml(team, "chatcrest")}<b class="tname chatwho" style="${esc(LG.teamStyle(team))}">${name}</b>`
      : `<b class="chatwho">${name}</b>`;
    return `<div class="chatRowMsg" data-mid="${esc(m.id || "")}">
      <div class="chatBubble ${mine ? "mine" : ""}">
        <div class="chatMeta">${byline} <span class="mut small">${when}</span></div>
        ${replyBlock}
        ${m.text ? `<div class="chatText2">${linkPlayerNames(esc(m.text))}</div>` : ""}
        ${imgSrc ? `<img class="chatImg" src="${esc(imgSrc)}" data-full="${esc(imgFull)}" loading="lazy" alt="">` : ""}
        <div class="chatActions">
          ${Object.entries(m.reactions || {}).filter(([, v]) => (v || []).length).map(([e, v]) =>
            `<button class="chatReact${v.includes(LG.myTeamId()) ? " on" : ""}" type="button" data-mid="${esc(m.id)}" data-e="${esc(e)}" title="React">${esc(LEGACY_REACTS[e] || e)} ${v.length}</button>`).join("")}
          <button class="chatReactAdd" type="button" data-mid="${esc(m.id)}" title="React with an emoji" aria-label="React with an emoji">
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="9" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6.8" cy="9.6" r=".95" fill="currentColor"/><circle cx="11.2" cy="9.6" r=".95" fill="currentColor"/><path d="M6.4 12.7c.7 1 1.6 1.5 2.6 1.5s1.9-.5 2.6-1.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M15.5 2.5v5M13 5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <button class="chatReply" type="button" data-mid="${esc(m.id)}" title="Reply">Reply</button>
          ${canDelete ? `<button class="chatDel" type="button" data-mid="${esc(m.id)}" title="Delete">Delete</button>` : ""}
        </div>
      </div></div>`;
  }
  function wireChatMsgEvents(idPfx, listEl, thread) {
    // An existing reaction chip is a TOGGLE for your own team — tap 🔥 2 to join or leave it.
    listEl.querySelectorAll(".chatReact").forEach((b) => b.addEventListener("click", async () => {
      await LG.toggleReaction(b.dataset.mid, b.dataset.e, LG.myTeamId());
      refreshChatList(idPfx, thread);
    }));
    // The add-reaction button: one lazy palette at a time, anchored to ITS message; a second
    // tap on the same button (or tapping another message's) closes/moves it. The refresh a
    // reaction triggers rebuilds the list, which removes the palette naturally.
    listEl.querySelectorAll(".chatReactAdd").forEach((b) => b.addEventListener("click", () => {
      const bubble = b.closest(".chatBubble");
      const existing = listEl.querySelector(".reactPalette");
      const wasHere = existing && existing.dataset.mid === b.dataset.mid;
      if (existing) existing.remove();
      if (wasHere || !bubble) return;
      const pal = document.createElement("div");
      pal.className = "reactPalette";
      pal.dataset.mid = b.dataset.mid;
      pal.innerHTML = CHAT_EMOJI.map((e) => `<button type="button" class="chatEmoji" data-em="${esc(e)}">${esc(e)}</button>`).join("");
      bubble.appendChild(pal);
      pal.querySelectorAll(".chatEmoji").forEach((x) => x.addEventListener("click", async () => {
        await LG.toggleReaction(b.dataset.mid, x.dataset.em, LG.myTeamId());
        refreshChatList(idPfx, thread);
      }));
    }));
    listEl.querySelectorAll(".chatReply").forEach((b) => b.addEventListener("click", async () => {
      const msgs = await LG.loadChat(thread || null);
      const m = msgs.find((x) => x.id === b.dataset.mid);
      if (m) setReplyTo(idPfx, m);
    }));
    listEl.querySelectorAll(".chatDel").forEach((b) => b.addEventListener("click", async () => {
      const r = await LG.deleteChat(b.dataset.mid, LG.myTeamId(), isCommish());
      if (r.ok) refreshChatList(idPfx, thread); else toast("Couldn't delete that.");
    }));
    listEl.querySelectorAll(".chatImg").forEach((img) => img.addEventListener("click", () => openImageOverlay(img.dataset.full)));
    // Player names inside message text (2026-08-11) — scoped to this list, the same narrow-root
    // convention refreshFa() uses. Idempotent, so the unscoped call some views also make later
    // can never double-fire a tap.
    wirePlayerCardTaps(listEl);
  }
  // Item 15 (2026-08-09, user: "dont put rules changes in the chat or any other system
  // message, just users chats"). The GUARANTEE is here, at RENDER, not at the write: every
  // sys post the family already has vanishes from the list immediately without a single doc
  // being deleted. byId is built from the SAME filtered set, so a user message that quotes an
  // old sys post degrades to no quote block rather than a dangling one.
  const userChats = (msgs) => (msgs || []).filter((m) => !m.sys);
  async function refreshChatList(idPfx, thread) {
    const listEl = $("#" + idPfx + "List");
    if (!listEl) return;
    const msgs = userChats(await LG.loadChat(thread || null));
    if (!$("#" + idPfx + "List")) return; // torn down mid-fetch (view switched)
    const wasNearBottom = !listEl.dataset.rendered || (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight) < 80;
    const last = msgs.slice(-80);
    const byId = new Map(msgs.map((m) => [m.id, m]));
    const tid = LG.myTeamId();
    listEl.innerHTML = last.length ? last.map((m) => chatMsgHtml(m, byId, tid)).join("") : '<p class="mut">No messages yet — say hi!</p>';
    listEl.dataset.rendered = "1";
    wireChatMsgEvents(idPfx, listEl, thread);
    if (wasNearBottom) listEl.scrollTop = listEl.scrollHeight;
  }
  UI.refreshChatList = refreshChatList;
  // Item 5 (2026-08-08): the composer is a <textarea> now — 1 row min, auto-grows to ~5 lines,
  // then scrolls internally rather than pushing the page around. CHAT_TEXTAREA_MAX_PX is
  // measured to ~5 lines at the composer's own font-size/line-height.
  const CHAT_TEXTAREA_MAX_PX = 118;
  function autoGrowChatText(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, CHAT_TEXTAREA_MAX_PX) + "px";
  }
  function wireChat(idPfx, thread) {
    const st = chatState(idPfx);
    st.replyTo = null; st.pendingImg = null; st.pendingGif = null;
    const textEl = $("#" + idPfx + "Text"), sendBtn = $("#" + idPfx + "Send");
    if (!textEl || !sendBtn) return;
    const send = async () => {
      const text = textEl.value.trim();
      const s = chatState(idPfx);
      if (!text && !s.pendingImg && !s.pendingGif) return;
      const payload = { thread: thread || null };
      if (text) payload.text = text;
      if (s.pendingImg) payload.img = s.pendingImg;
      if (s.pendingGif) payload.gif = s.pendingGif;
      if (s.replyTo) payload.replyTo = s.replyTo.id;
      const r = await LG.postChat(payload);
      if (!r || !r.ok) { toast("Couldn't send that."); return; }
      textEl.value = "";
      autoGrowChatText(textEl);
      clearPendingPreview(idPfx);
      clearReplyPreview(idPfx);
      await refreshChatList(idPfx, thread);
    };
    sendBtn.addEventListener("click", send);
    // Enter sends (matches the old <input> behavior); Shift+Enter inserts a real newline —
    // the textarea's own default keydown handling already does that, so Shift+Enter just
    // needs to NOT be intercepted here.
    textEl.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
    textEl.addEventListener("input", () => autoGrowChatText(textEl));
    autoGrowChatText(textEl);
    const imgBtn = $("#" + idPfx + "ImgBtn"), fileInput = $("#" + idPfx + "FileInput");
    if (imgBtn && fileInput) {
      imgBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try { UI.attachImage(idPfx, await resizeImageToDataUrl(file, 320, 0.72)); }
        catch (err) { toast("Couldn't read that photo."); }
      });
    }
    // The EMOJI PICKER (refinement 3). Grid renders LAZILY on first open — see
    // chatWidgetHtml's own note on why that laziness is load-bearing (section U). The gif
    // and emoji panels are mutually exclusive: one open tray at a time keeps the composer
    // from stacking into a wall.
    const emojiBtn = $("#" + idPfx + "EmojiBtn");
    if (emojiBtn) emojiBtn.addEventListener("click", () => {
      const box = $("#" + idPfx + "EmojiBox");
      if (!box) return;
      if (box.hidden) {
        const grid = $("#" + idPfx + "EmojiGrid");
        if (grid && !grid.childElementCount) {
          grid.innerHTML = CHAT_EMOJI.map((e) => `<button type="button" class="chatEmoji" data-em="${esc(e)}">${esc(e)}</button>`).join("");
          grid.querySelectorAll(".chatEmoji").forEach((b) => b.addEventListener("click", () => {
            insertAtCursor($("#" + idPfx + "Text"), b.dataset.em);
          }));
        }
        const gb = $("#" + idPfx + "GifBox");
        if (gb) gb.hidden = true;
        box.hidden = false;
      } else box.hidden = true;
    });
    const gifBtn = $("#" + idPfx + "GifBtn");
    if (gifBtn) {
      if (UI._gifAvailable === false) gifBtn.hidden = true;
      gifBtn.addEventListener("click", async () => {
        const avail = await ensureGifAvailability();
        if (!avail) { gifBtn.hidden = true; return; }
        const box = $("#" + idPfx + "GifBox");
        if (!box) return;
        box.hidden = !box.hidden;
        if (!box.hidden) {
          const eb = $("#" + idPfx + "EmojiBox");
          if (eb) eb.hidden = true; // one open tray at a time
          $("#" + idPfx + "GifQ").focus();
        }
      });
      const qInp = $("#" + idPfx + "GifQ");
      let gifDebounce;
      qInp.addEventListener("input", () => {
        clearTimeout(gifDebounce);
        gifDebounce = setTimeout(() => runGifSearch(idPfx), 300);
      });
    }
  }
  UI._chatTimer = null;
  function startChatPoll(idPfx, thread) {
    if (UI._chatTimer && UI._chatTimer.pfx === idPfx && UI._chatTimer.thread === (thread || null)) return; // already running
    stopChatPoll();
    const h = setInterval(() => refreshChatList(idPfx, thread), 8000);
    UI._chatTimer = { h, pfx: idPfx, thread: thread || null };
  }
  function stopChatPoll() {
    if (UI._chatTimer) { clearInterval(UI._chatTimer.h); UI._chatTimer = null; }
  }
  UI.renderChat = renderChat;
  async function renderChat() {
    main().innerHTML = `<div class="card chatcard"><h2>League chat</h2>${chatWidgetHtml("chat")}</div>`;
    wireChat("chat", null);
    await refreshChatList("chat", null);
    startChatPoll("chat", null);
  }

  // ---------------- moves (waivers, trades, transaction log) ----------------
  UI._tradeGive = new Set();
  UI._tradeGet = new Set();
  UI._counterOf = null; // S7 — the id of the offer the builder is currently answering, if any
  function allOwnedKeys() {
    const s = new Set();
    for (const t of LG.teams) for (const p of ((UI._rosters && UI._rosters[t.id]) || [])) s.add(p.key);
    return s;
  }
  function nameOfKey(key) {
    for (const t of LG.teams) {
      const p = ((UI._rosters && UI._rosters[t.id]) || []).find((x) => x.key === key);
      if (p) return p.name;
    }
    return key;
  }
  async function maybeAutoProcessWaivers() {
    if (!LG.teams.length) return;
    const wk = UI.week || LG.currentWeek();
    if (LG.now() < LG.waiverDeadline(wk)) return;
    const doc = await LG.loadClaims(wk);
    if (!doc.processed && (doc.claims || []).length) await LG.processWaivers(wk);
  }
  async function maybeAutoExecuteTrades() {
    if (!LG.teams.length) return;
    const trades = await LG.loadTrades();
    for (const tr of trades) {
      // Date.now(), matching acceptTrade/executeTrade. reviewEndsAt is a REAL-WORLD deadline
      // (see the note at LG.SIM_LOADED_AT); judging it on the per-device replay clock would
      // have this device disagree with the one that accepted the trade.
      if (tr.status === "accepted" && Date.now() >= (tr.reviewEndsAt || Infinity)) await LG.executeTrade(tr.id);
    }
  }
  // S5 + adversarial review 2026-08-08 (findings 1/3/6/7/8). Any week with no weekly doc yet
  // gets carried forward, and LG.finalizeWeek's own gates make that safe rather than
  // optimistic: it refuses unless the live engine's OWN week matches the week being written
  // AND every one of that week's games reads final. Two consequences worth stating:
  //   · the loop now includes the CURRENT week (w <= cw). It used to stop at cw-1 to avoid
  //     finalizing a week mid-flight — but the engine rolls over on the same Tuesday
  //     currentWeek() does, so "past week" and "the week the engine is holding" were almost
  //     never the same week, which is exactly how week N ended up scored from week N+1. With
  //     the provenance gate in place the correct moment is Monday night of week N itself.
  //   · a playoff week is advanced through the bracket IMMEDIATELY after it finalizes, inside
  //     the loop. Batching two playoff weeks and advancing afterwards wrote the second week's
  //     WRITE-ONCE doc while its semifinal pairing was still unresolved, permanently deleting
  //     that game and stranding the bracket with no champion (findings 6/8).
  // Weeks it legitimately can't finalize (the engine has already rolled past them) are
  // recorded for the league home to surface, never guessed at.
  async function maybeAutoFinalizeWeeks() {
    if (!LG.teams.length) return;
    const cw = LG.currentWeek();
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    const stale = [];
    for (let w = 1; w <= cw; w++) {
      const doc = await LG.loadWeekly(w);
      if (doc && doc.kind === "weekly") continue;
      const r = await LG.finalizeWeek(w);
      if (r && r.ok) { if (w > sw) await LG.advanceBracket().catch(() => {}); continue; }
      if (r && r.reason === "stale-week") stale.push(w);
    }
    // Same SHAPE staleFinalizeWeeks() produces (plain week numbers) — renderLeague repaints
    // straight off this field without recomputing, so the two writers must agree or the card
    // renders "[object Object]".
    UI._staleWeeks = stale;
  }
  // S7: once the regular season has moved on past it (currentWeek() > seasonWeeks) and no
  // bracket exists yet, build it. LG.buildBracket() itself refuses (harmlessly) until every
  // regular-season week is actually final, so calling this eagerly/often is safe.
  async function maybeAutoBuildBracket() {
    if (!LG.teams.length) return;
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    if (LG.currentWeek() <= sw) return;
    if (await LG.loadBracket()) return;
    await LG.buildBracket();
  }
  // S7: fills in whatever the bracket can resolve from finalized playoff weeks — a no-op once
  // a champion is crowned, and a no-op with no bracket built yet.
  async function maybeAutoAdvanceBracket() {
    if (!LG.teams.length) return;
    const bracket = await LG.loadBracket();
    if (!bracket || bracket.champion != null) return;
    await LG.advanceBracket();
  }
  // The one chain boot() and every live poll run: finalize whatever's ready, build the bracket
  // once the regular season is fully final, finalize again (that may have just unlocked a
  // playoff week's own games), advance the bracket a few times so a boot that lands well past
  // the whole postseason (all playoff weeks' data already sitting there final) can walk the
  // bracket all the way to a champion in one pass rather than needing 3 separate visits.
  async function maybeAdvanceLeague() {
    if (!LG.teams.length) return;
    await maybeAutoFinalizeWeeks().catch(() => {});
    await maybeAutoBuildBracket().catch(() => {});
    for (let i = 0; i < 3; i++) {
      await maybeAutoFinalizeWeeks().catch(() => {});
      await maybeAutoAdvanceBracket().catch(() => {});
    }
  }
  UI.maybeAutoProcessWaivers = maybeAutoProcessWaivers;
  UI.maybeAutoExecuteTrades = maybeAutoExecuteTrades;
  UI.maybeAutoFinalizeWeeks = maybeAutoFinalizeWeeks;
  UI.maybeAutoBuildBracket = maybeAutoBuildBracket;
  UI.maybeAutoAdvanceBracket = maybeAutoAdvanceBracket;
  UI.maybeAdvanceLeague = maybeAdvanceLeague;
  const REASON_LABEL = {
    outbid: "outbid by a higher blind bid", "player-taken": "taken by another claim",
    "drop-gone": "your drop player was gone", "insufficient-faab": "not enough FAAB",
    "already-processed": "this week's claims already processed", "drop-not-found": "that player isn't on your roster",
    "stale-week": "live scoring has moved on from that week", "no-live-data": "live scoring hasn't loaded yet",
    preseason: "the NFL is still in preseason — nothing counts yet",
    "no-archived-stats": "that week's archived stats aren't available", "bracket-unresolved": "an earlier playoff round hasn't been settled yet",
    "no-schedule": "there are no games on the board for that week",
    // S7 — the counter's own refusals. "deadline-passed" and "invalid-players" come back
    // through LG.offerTrade unchanged, so a counter refuses in exactly the words an offer does.
    "deadline-passed": "the trade deadline has passed",
    "invalid-players": "a trade needs 1-3 players on each side",
    "no-trade": "that offer is gone", "not-yours": "that offer wasn't sent to you",
    "not-pending": "that offer has already been answered",
  };
  function reasonLabel(r) { return REASON_LABEL[r] || r; }
  function txSentence(tx) {
    const nm = (id) => (LG.teamById(id) || {}).name || ("Team " + id);
    if (tx.type === "waiver") return `${nm(tx.teamId)} won a waiver claim: added ${LG.shortName(tx.detail.addName)} ($${tx.detail.bid}), dropped ${LG.shortName(tx.detail.dropName || tx.detail.dropKey)}.`;
    if (tx.type === "fa_add") return `${nm(tx.teamId)} added ${LG.shortName(tx.detail.addName)} (free agency).`;
    if (tx.type === "drop") return `${nm(tx.teamId)} dropped ${LG.shortName(tx.detail.dropName || tx.detail.dropKey)}.`;
    if (tx.type === "trade" && tx.detail.result === "executed")
      return `Trade: ${nm(tx.detail.from)} sent ${(tx.detail.giveNames || tx.detail.give || []).map(LG.shortName).join(", ")} to ${nm(tx.detail.to)} for ${(tx.detail.getNames || tx.detail.get || []).map(LG.shortName).join(", ")}.`;
    if (tx.type === "trade" && tx.detail.result === "vetoed")
      return `Trade between ${nm(tx.detail.from)} and ${nm(tx.detail.to)} was vetoed by the league.`;
    return "Transaction.";
  }
  UI.renderMoves = renderMoves;
  async function renderMoves() {
    const tid = LG.myTeamId();
    const T = LG.teamById(tid);
    simProjEnsureAndRepaint("moves"); // 2025 season replay — see startData(); covers
                                                 // the FA table's PROJ column below AND the
                                                 // Testing-week switch's own week-5 view
    await loadWeekRosters();
    await runAutoChecks(false).catch(() => {}); // throttled — see runAutoChecks' own note
    UI._trades = await LG.loadTrades();
    UI._claims = await LG.loadClaims(UI.week);
    UI._tx = await LG.loadTx();
    if (!T) { main().innerHTML = `<div class="card"><p class="mut">No team claimed.</p></div>`; return; }

    const past = LG.now() >= LG.waiverDeadline(UI.week);
    const myClaims = (UI._claims.claims || []).filter((c) => c.teamId === tid);
    const myTrades = (UI._trades || []).filter((tr) => (tr.from === tid || tr.to === tid) && (tr.status === "offered" || tr.status === "accepted"));
    // S7 — the counter CHAIN. Every link is between the same two teams, so a chain I am in is
    // entirely mine; walking `counterOf` up from a live offer gives its whole history, newest
    // first. Ancestors are terminal by construction ("countered"), so they never appear in
    // myTrades themselves — but the ancestor set is subtracted anyway, because a lost race
    // (see LG.counterTrade's ordering note) can leave one live, and one exchange must render
    // as one thread whatever state its links are in.
    const tradeById = new Map((UI._trades || []).map((tr) => [tr.id, tr]));
    const ancestorsOf = (tr) => {
      const out = [];
      let cur = tr.counterOf ? tradeById.get(tr.counterOf) : null;
      while (cur && out.length < 40) { out.push(cur); cur = cur.counterOf ? tradeById.get(cur.counterOf) : null; }
      return out;
    };
    const ancestorIds = new Set();
    myTrades.forEach((tr) => ancestorsOf(tr).forEach((a) => ancestorIds.add(a.id)));
    const tradeHeads = myTrades.filter((tr) => !ancestorIds.has(tr.id));
    // A counter I am composing right now points at a specific live offer. If that offer has
    // since been answered (or the counterparty was switched under it), the link is stale —
    // drop it rather than sending a counter to a trade that no longer exists.
    if (UI._counterOf) {
      const src = tradeById.get(UI._counterOf);
      if (!src || src.status !== "offered" || src.to !== tid) UI._counterOf = null;
    }
    const reviewTrades = (UI._trades || []).filter((tr) => tr.status === "accepted" && tr.from !== tid && tr.to !== tid);

    // Item 1's "claims list" — the player names in "My pending" are their own tappable stats
    // links (.pcinline, wired generically by wirePlayerCardTaps below) while Cancel/Accept/
    // Decline/Veto stay exactly the buttons they always were.
    const pcName = (key, label) => `<button type="button" class="pcinline" data-pk="${esc(key)}">${escn(label)}</button>`;
    const claimRow = (c) => `<div class="rowline"><span>${pcName(c.addKey, c.addName)} <span class="mut">(${esc(c.addPos)}·${esc(c.addTeam)})</span> ← drop ${pcName(c.dropKey, c.dropName || c.dropKey)} · $${c.bid}</span>
      <button class="mvcancel" data-cid="${esc(c.id)}">Cancel</button></div>`;
    // Both the live row and its quiet ancestors read from MY side of the deal, so a thread is
    // one consistent sentence all the way down: "You give … → get …", whichever end of the
    // original offer I happened to be on.
    const tradeSides = (tr) => {
      const mine = tr.from === tid;
      return { give: mine ? tr.give : tr.get, get: mine ? tr.get : tr.give, otherId: mine ? tr.to : tr.from };
    };
    const tradeRow = (tr) => {
      const s = tradeSides(tr);
      const nameBtns = (keys) => keys.map((k) => pcName(k, nameOfKey(k))).join(", ");
      const give = nameBtns(s.give);
      const get = nameBtns(s.get);
      let actions = "";
      let cls = "rowline";
      if (tr.status === "offered") {
        // S7 — Counter sits beside Accept/Decline, and ONLY for the owner the offer was sent
        // to: it is an answer to an offer, which is not something the sender can give.
        if (tr.to === tid) {
          actions = `<button class="mvaccept" data-tid="${tr.id}">Accept</button> <button class="mvcounter" data-tid="${tr.id}">Counter</button> <button class="mvdecline" data-tid="${tr.id}">Decline</button>`;
          cls += " tactions"; // three 44px buttons do not fit beside the sentence at 390px — see the CSS note
        } else if (tr.from === tid) actions = `<button class="mvcanceltrade" data-tid="${tr.id}">Cancel</button>`;
      } else if (tr.status === "accepted") {
        actions = `<span class="mut small">reviews until ${new Date(tr.reviewEndsAt).toLocaleString()}</span>`;
      }
      return `<div class="${cls}"><span>You give ${give} → get ${get} <span class="mut">(${teamMention(s.otherId)}) · ${esc(tr.status)}</span></span>${actions}</div>`;
    };
    // An ancestor is HISTORY, so it is one muted line and nothing more: what it was, and what
    // became of it. No player-stats links, no actions — the live offer above it is the thing
    // to act on.
    const ANCESTOR_SHOWN = 3;
    const STATUS_WORD = { countered: "Countered", declined: "Declined", cancelled: "Cancelled", accepted: "Accepted", executed: "Executed", vetoed: "Vetoed", offered: "Still open" };
    const ancestorLine = (tr) => {
      const s = tradeSides(tr);
      const nm = (keys) => keys.map((k) => LG.shortName(nameOfKey(k))).join(", ");
      // esc(), not escn(): nm() has already shortened each NAME, and escn would then run
      // LG.shortName over the whole joined "A. One, B. Two" string and read it as one name.
      return `<div class="tradeancline mut small">${esc(STATUS_WORD[tr.status] || tr.status)} — was: you give ${esc(nm(s.give))} → get ${esc(nm(s.get))}</div>`;
    };
    const tradeThread = (tr) => {
      const anc = ancestorsOf(tr);
      const shown = anc.slice(0, ANCESTOR_SHOWN);
      const more = anc.length - shown.length;
      return `<div class="tradethread">${tradeRow(tr)}${anc.length ? `<div class="tradeanc">${shown.map(ancestorLine).join("")}${more > 0 ? `<div class="tradeancline mut small">+${more} earlier</div>` : ""}</div>` : ""}</div>`;
    };
    const reviewRow = (tr) => {
      const already = (tr.vetoes || []).includes(tid);
      return `<div class="rowline"><span>${teamMention(tr.from)} vs ${teamMention(tr.to)}
        <span class="mut">· ${(tr.vetoes || []).length}/${LG.rules.trades.vetoVotes} vetoes</span></span>
        ${already ? '<span class="mut small">voted</span>' : `<button class="mvveto" data-tid="${tr.id}">Veto</button>`}</div>`;
    };
    const myResultsHtml = (() => {
      if (!UI._claims.processed) return "";
      const claimsById = new Map((UI._claims.claims || []).map((c) => [c.id, c]));
      const mine = (UI._claims.results || []).filter((r) => { const c = claimsById.get(r.id); return c && c.teamId === tid; });
      if (!mine.length) return "";
      return `<h2 class="small mut">Your results — week ${UI._claims.week}</h2><div id="mvResults">` + mine.map((r) => {
        const c = claimsById.get(r.id);
        return `<div class="fline">${r.ok ? "Won " + escn(c.addName) + "!" : "Missed " + escn(c.addName) + ": " + esc(reasonLabel(r.reason))}</div>`;
      }).join("") + "</div>";
    })();

    const others = LG.teams.filter((t) => t.id !== tid);
    const cpId = (UI._tradeCp && others.some((t) => t.id === UI._tradeCp)) ? UI._tradeCp : (others[0] && others[0].id);
    UI._tradeCp = cpId;
    const myRoster = (UI._rosters && UI._rosters[tid]) || [];
    const cpRoster = (UI._rosters && UI._rosters[cpId]) || [];
    // Split (2026-08-08): the pick chip used to BE the whole toggle button — tapping a player
    // to inspect them and tapping to add them to the trade were the same action. Now .pcinfo
    // (wired generically by wirePlayerCardTaps, item 1's "trade builder roster pickers") opens
    // the stats card, and .pcpick — a small, its-own button — carries the give/get toggle that
    // used to be the whole row's job. The outer .pickchip div keeps the same "picked" class +
    // border/background treatment it always had.
    // ITEM 20 (2026-08-09) puts these rows inside a collapsed picker: they are how you ADD a
    // player, and the wall of them is only worth its room once you are actually working a
    // trade. Everything else about them is unchanged.
    const chip = (p, set) => `<div class="swaprow pickchip ${set.has(p.key) ? "picked" : ""}" data-gk="${esc(p.key)}">
        <button type="button" class="pcinfo" data-pk="${esc(p.key)}">
          <b>${escn(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)} · ${esc(p.slot)}</small>
        </button>
        <button type="button" class="pcpick" data-gk="${esc(p.key)}">${set.has(p.key) ? "Picked" : "Pick"}</button>
      </div>`;

    // "My pending" (2026-08-09 playtest: "shrink My pending substantially"). Most of the time
    // it holds nothing at all, and it was still spending a whole card on THREE stacked
    // headings and three full paragraphs to say so. Nothing pending anywhere -> one short
    // quiet line. Something pending -> only the sub-lists that have content get a heading,
    // and an empty sibling shrinks to a single muted line instead of a paragraph.
    // The #mvMyClaims / #mvMyTrades ids and their "No pending …" wording survive BOTH shapes:
    // they are how a second device proves a blind claim really is invisible to it.
    // ---- ITEM 19 (2026-08-09, user: "remove all the text under 'waivers' and just have 3
    // data blocks: FAAB budget, and FA vs WAIVER"). The card used to carry two full
    // paragraphs of prose. It now carries three stat blocks, and the one that is IN FORCE
    // right now is marked — which is what the prose was for. Nothing is lost but the
    // sentences: the deadline moves INSIDE the waiver block as its own value (time on the
    // value line, date under it), and "first come, first served" / "blind bids" survive as
    // the blocks' own three-word sub-labels rather than as a paragraph each.
    // (The one fact that genuinely goes: "adding/dropping isn't locked by kickoff — only your
    // starting lineup is". It is a standing rule of the app rather than a fact about this
    // week, and the locker already says so at the point it bites, by disabling a locked Swap.)
    const wvDl = new Date(LG.waiverDeadline(UI.week));
    const wvBlock = (id, on, label, value, sub) => `<div class="mvblk ${on ? "on" : "off"}" id="${id}">
        <span class="mvblab">${esc(label)}</span>
        <span class="mvbval">${esc(value)}</span>
        <span class="mvbsub">${esc(sub)}</span>
        ${on ? '<span class="mvbtag">Now</span>' : ""}
      </div>`;
    const wvBlocksHtml = `<div class="mvblocks">
        <div class="mvblk" id="mvBlkFaab">
          <span class="mvblab">FAAB budget</span>
          <span class="mvbval">$<span id="mvFaab">${LG.teamFaab(T)}</span></span>
          <span class="mvbsub">remaining</span>
        </div>
        ${wvBlock("mvBlkFa", past, "Free agency", past ? "Open" : "Closed", "first come, first served")}
        ${wvBlock("mvBlkWaiver", !past, "Waivers", wvDl.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
          wvDl.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }))}
      </div>`;

    const pendEmpty = !myClaims.length && !tradeHeads.length && !reviewTrades.length && !myResultsHtml;
    const pendHtml = pendEmpty
      ? `<div class="card pendcard"><h2>My pending</h2>
          <p class="pendnone mut small"><span id="mvMyClaims">No pending claims.</span> <span id="mvMyTrades">No pending trades.</span></p>
        </div>`
      : `<div class="card pendcard"><h2>My pending</h2>
          ${myClaims.length ? '<h2 class="small mut">Your waiver claims</h2>' : ""}
          <div id="mvMyClaims">${myClaims.length ? myClaims.map(claimRow).join("") : '<p class="pendnone mut small">No pending claims.</p>'}</div>
          ${tradeHeads.length ? '<h2 class="small mut">Your trades</h2>' : ""}
          <div id="mvMyTrades">${tradeHeads.length ? tradeHeads.map(tradeThread).join("") : '<p class="pendnone mut small">No pending trades.</p>'}</div>
          ${reviewTrades.length ? `<h2 class="small mut">Trades under review — league vote</h2><div id="mvReviewTrades">${reviewTrades.map(reviewRow).join("")}</div>` : ""}
          ${myResultsHtml}
        </div>`;
    main().innerHTML = `
      <div id="hotStrip"></div>
      ${pendHtml}
      <div class="card"><h2>Waivers</h2>
        ${wvBlocksHtml}
        ${isCommish() ? '<div class="rowline mvprow"><button id="mvProcessNow">Process now</button></div>' : ""}
        <div class="rowline"><span class="mut small">Filter:</span>
          <div class="poschips" id="faFilterChips">
            <button type="button" class="poschip" data-filter="avail">Available</button>
            <button type="button" class="poschip" data-filter="all">All</button>
          </div>
        </div>
        <div class="poschips" id="faPosChips">${["ALL", "QB", "RB", "WR", "TE", "K", "DST"].map((p) => `<button type="button" class="poschip" data-pos="${p}">${p}</button>`).join("")}</div>
        <input id="faSearch" placeholder="Search players… (optional — browse below)" autocomplete="off">
        <div id="faResults"></div>
      </div>
      <div class="card" id="mvTradeCard"><h2>${UI._counterOf ? "Counter " + esc(LG.teamName(cpId)) + "'s offer" : "Propose a trade"}</h2>
        ${UI._counterOf ? `<p class="mut small" id="mvCounterNote">Their offer, with the sides swapped — change it however you like.
          <button type="button" id="mvCounterDrop" class="pcinline">Start a fresh offer instead</button></p>` : ""}
        <select id="mvTradeTeam">${others.map((t) => `<option value="${t.id}" ${t.id === cpId ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        <div class="rowline mvsugrow"><button id="mvSuggest" type="button">Suggest a trade</button>
          <span id="mvSuggestWhy" class="mut small"></span></div>
        <div id="mvSuggestAi" class="mvsugai" hidden></div>
        <h2 class="small mut">You give (up to 3)</h2>
        <div id="mvGive" class="tradeside"></div>
        <h2 class="small mut">You get (up to 3)</h2>
        <div id="mvGet" class="tradeside"></div>
        <input id="mvTradeNote" placeholder="Note (optional)">
        <button id="mvTradeSend" class="primary">${UI._counterOf ? "Send counter" : "Send offer"}</button>
      </div>
      <div class="card"><h2>Transaction log</h2><div id="mvLog">
        ${UI._tx.length ? UI._tx.map((tx) => `<div class="fline sys"><span class="mut">${new Date(tx.t).toLocaleString()}</span> ${esc(txSentence(tx))}</div>`).join("") : '<p class="mut">No moves yet.</p>'}
      </div></div>`;

    document.querySelectorAll(".mvcancel").forEach((b) => b.addEventListener("click", async () => {
      await LG.cancelClaim(UI.week, b.dataset.cid, tid);
      renderMoves();
    }));
    document.querySelectorAll(".mvaccept").forEach((b) => b.addEventListener("click", async () => {
      await LG.acceptTrade(b.dataset.tid, tid);
      toast("Trade accepted — review window started.");
      renderMoves();
    }));
    document.querySelectorAll(".mvdecline").forEach((b) => b.addEventListener("click", async () => {
      await LG.declineTrade(b.dataset.tid, tid);
      toast("Trade declined.");
      renderMoves();
    }));
    // ---- S7: Counter. This half only PREFILLS — it writes nothing. The owner reviews the
    // swapped sides in the builder they already know, edits them however they like, and
    // presses Send counter; LG.counterTrade is what finally links the two docs.
    // The prefill is intersected with the two rosters as they stand now, so a player who has
    // moved since the offer was made is simply absent rather than silently riding along in a
    // Set the picker can no longer show (executeTrade's own roster-changed fail-safe is the
    // backstop, but it should not be the first line of defence).
    document.querySelectorAll(".mvcounter").forEach((b) => b.addEventListener("click", () => {
      const tr = (UI._trades || []).find((x) => x.id === b.dataset.tid);
      if (!tr || tr.status !== "offered" || tr.to !== tid) { toast("That offer has already been answered."); renderMoves(); return; }
      const onRoster = (keys, teamId) => {
        const roster = (UI._rosters || {})[teamId] || [];
        return roster.length ? keys.filter((k) => roster.some((p) => p.key === k)) : keys.slice();
      };
      UI._tradeCp = tr.from;
      // Sides SWAPPED: what they asked me for is now what I am giving, and what they offered
      // is now what I am asking for. (`give` is always "what `from` sends" — see offerTrade.)
      UI._tradeGive = new Set(onRoster(tr.get, tid));
      UI._tradeGet = new Set(onRoster(tr.give, tr.from));
      UI._counterOf = tr.id;
      renderMoves().then(() => {
        const card = $("#mvTradeCard");
        if (card && card.scrollIntoView) card.scrollIntoView({ block: "center" });
      });
    }));
    document.querySelectorAll(".mvcanceltrade").forEach((b) => b.addEventListener("click", async () => {
      await LG.cancelTrade(b.dataset.tid, tid);
      toast("Offer cancelled.");
      renderMoves();
    }));
    document.querySelectorAll(".mvveto").forEach((b) => b.addEventListener("click", async () => {
      await LG.vetoTrade(b.dataset.tid, tid);
      renderMoves();
    }));
    $("#mvProcessNow") && $("#mvProcessNow").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await LG.processWaivers(UI.week);
      toast("Waivers processed.");
      renderMoves();
    });
    // ---------------- item 1 -> ESPN-style sortable stats table (2026-08-08 rework) ----------
    // Position chips + an OPTIONAL name search + an Available/All ownership filter all feed
    // ONE stats table — sorted, by whichever COLUMN was last clicked, across the WHOLE fetched
    // pool (not just what's on screen), defaulting to season FPTS desc. faState lives in this
    // renderMoves() closure (like UI._tradeGive/_tradeCp) — a chip tap, a sort click, or "show
    // more" only ever rebuilds #faResults' own subtree, never a full renderMoves(), so the
    // search box's focus/caret and the rest of the Moves page are untouched.
    // Default landing sort was season FPTS desc; FPTS is one of the three columns item 22
    // dropped, so it is season AVG desc now — the same "best players first" idea, on the
    // season column that survived. A remembered key from before the re-order (or from a
    // future re-order) is discarded rather than silently sorting by a column that is no
    // longer on the table.
    const faState = {
      q: "", pos: UI._faPos || "ALL", limit: 40,
      filter: UI._faFilter || "avail",
      sortKey: "avg", sortDir: UI._faSortDir || "desc",
    };
    const faInput = $("#faSearch");
    // Season stats (FPTS/AVG/LAST) come from D.gameLog — cached per-player here so a sort
    // click, a chip tap or "show more" never re-fetches/re-derives a player already seen this
    // session. undefined = not yet asked for (kicks off a fetch); null = fetched, genuinely no
    // games; {total,avg,last} = real numbers. D.gameLog itself is cheap to call repeatedly —
    // the archived per-week payload it reads is cached+deduped at the WEEK level inside
    // D.weekStats (2026-08-08 perf fix), so this is purely to avoid redundant re-derivation
    // and keep a re-sort of already-known players synchronous.
    UI._faStats = UI._faStats || new Map();
    // Split out of ensureFaStatsBatch (2026-08-09) so "Suggest a trade" can await the SAME
    // season figures the table paints — the suggestion values players by their season average
    // and must never guess at one it could have had for free. The repaint stays in the
    // table's own wrapper; a suggestion has no table to repaint.
    function ensureStats(list) {
      const need = list.filter((p) => !UI._faStats.has(p.key));
      if (!need.length) return Promise.resolve();
      return Promise.all(need.map((p) => D().gameLog(p.key).then((log) => {
        UI._faStats.set(p.key, log.rows.length ? { total: log.total, avg: log.avg, last: log.rows[log.rows.length - 1].pts } : null);
      }).catch(() => { UI._faStats.set(p.key, null); })));
    }
    function ensureFaStatsBatch(list) {
      const need = list.filter((p) => !UI._faStats.has(p.key));
      if (!need.length) return;
      ensureStats(list).then(() => {
        if (UI.view === "moves" && $("#faResults")) refreshFa();
      });
    }
    // TYPE column + the Available/All filter: "FA" for a genuine free agent, else the owning
    // GFFL team's own abbrev (falling back to initials of its name, same convention the claim
    // screen's logo-placeholder already uses). ownerMap is built once per refreshFa() call —
    // shared by both the render pass and the sort comparator so they can never disagree.
    function faOwnerMap() {
      const m = new Map();
      for (const t of LG.teams) for (const p of ((UI._rosters && UI._rosters[t.id]) || [])) m.set(p.key, t.id);
      return m;
    }
    function faTypeText(p, ownerMap) {
      const owningId = ownerMap.get(p.key);
      if (owningId == null) return "FA";
      const T = LG.teamById(owningId);
      return (T && (T.abbrev || initials(T.name))) || "FA";
    }
    const myAbbrev = (T && (T.abbrev || initials(T.name))) || "";
    // ---- ITEM 22 (2026-08-09, user: "the first column should be add, then type, then
    // projection, then last, the opp, then avg"). PLAYER stays in front of all of it as the
    // row's own label — the user's list is of the DATA columns, and a table of anonymous rows
    // is useless — and the MOVE button comes out of its old trailing column into second place.
    // ⚠ THREE COLUMNS ARE GONE, and they are a real loss, not a tidy-up: STATUS (the live
    // clock / Final / kickoff time), SCORE (this week's live points) and FPTS (the season
    // total). None of the three is in the user's list. AVG and LAST between them still carry
    // the season; the STATUS read survives in full on the player's own stats card, which any
    // row opens. Say so if it is ever missed rather than quietly putting them back.
    // faGameStatus() went with the column — the stats card computes its own.
    const FA_COLS = [
      { id: "player", label: "PLAYER" },
      // ADD is a real sort control like every other header, and sorting by it is genuinely
      // useful ("show me who I can actually add"), so it earns its arrow rather than being
      // the one dead header on the row.
      { id: "add", label: "ADD" },
      { id: "type", label: "TYPE" },
      { id: "proj", label: "PROJ", num: true },
      { id: "last", label: "LAST", num: true },
      { id: "opp", label: "OPP" },
      { id: "avg", label: "AVG", num: true },
    ];
    if (UI._faSortKey && FA_COLS.some((c) => c.id === UI._faSortKey)) faState.sortKey = UI._faSortKey;
    // Why a row's MOVE button is unavailable, or "" when it is available. A rostered player
    // used to render an EMPTY cell, which says nothing at all; he now gets a real disabled
    // button that names the owner. NOT a reason: an empty FAAB purse — a $0 blind bid is a
    // legal claim and always has been.
    function faAddBlocked(p, type) {
      if (type !== "FA") return type === myAbbrev ? "Already on your team" : "Owned by " + type;
      if (!myRoster.length) return "You have nobody to drop";
      return "";
    }
    // Every value a column can be SORTED by — numeric columns return a number (missing ->
    // -Infinity, so it naturally sorts last on desc / first on asc with no special-casing);
    // every other column returns a string. Used by both the comparator below and (for the
    // numeric ones) the rendered cell text, so display and sort order can never disagree.
    function faSortValue(p, colId, ownerMap) {
      const d = D();
      if (colId === "player") return LG.shortName(p.name || "");
      if (colId === "type") return faTypeText(p, ownerMap);
      // Addable first on desc — "who can I actually add" is the whole reason to sort on it.
      if (colId === "add") return faAddBlocked(p, faTypeText(p, ownerMap)) ? 0 : 1;
      if (colId === "opp") return d.oppForWeek(UI.week, p.team) || "";
      if (colId === "proj") { const v = d.projFor(p.key); return v == null ? -Infinity : v; }
      const s = UI._faStats.get(p.key);
      if (colId === "avg") return s && s.avg != null ? s.avg : -Infinity;
      if (colId === "last") return s && s.last != null ? s.last : -Infinity;
      return "";
    }
    // Default sort = season FPTS desc, "falling back to search_rank when no stats" (the
    // spec's own words) — implemented as the GENERAL tie-break for every column, not just
    // FPTS: two players reading identically on the active column (most commonly: neither has
    // a stat yet) fall back to Sleeper's own best-players-first ranking rather than an
    // arbitrary/unstable order.
    function compareFA(a, b, colId, dir, ownerMap) {
      const va = faSortValue(a, colId, ownerMap), vb = faSortValue(b, colId, ownerMap);
      // Explicit less/greater/equal, NOT subtraction — two missing values are both -Infinity,
      // and `-Infinity - (-Infinity)` is NaN, which silently breaks the tie-break below (NaN
      // !== 0) and leaves Array.sort's comparator returning NaN, whose ordering behavior is
      // unspecified. This is exactly the "no stats -> fall back to search_rank" case, which
      // is the single most common comparison in the whole table (every free agent with no
      // season stats yet), so it has to be exactly right.
      let cmp = typeof va === "number" ? (va < vb ? -1 : va > vb ? 1 : 0) : String(va).localeCompare(String(vb));
      if (cmp === 0) cmp = (a.searchRank ?? 1e9) - (b.searchRank ?? 1e9);
      return dir === "asc" ? cmp : -cmp;
    }
    function faHeadHtml() {
      const cells = FA_COLS.map((c) => {
        const active = faState.sortKey === c.id;
        const arrow = active ? (faState.sortDir === "desc" ? " ▼" : " ▲") : "";
        return `<th class="thsort${c.num ? " num" : ""}${active ? " active" : ""}" data-sort="${c.id}">${c.label}${arrow ? `<span class="sortarrow">${arrow}</span>` : ""}</th>`;
      }).join("");
      // No trailing unlabelled column any more — the MOVE button moved into its own real,
      // sortable ADD column in second place (item 22).
      return `<tr>${cells}</tr>`;
    }
    function faRowHtml(p, i, ownerMap) {
      const d = D();
      const type = faTypeText(p, ownerMap);
      const opp = d.oppForWeek(UI.week, p.team);
      const proj = d.projFor(p.key);
      const stats = UI._faStats.get(p.key); // undefined = still loading | null = no games | {total,avg,last}
      const seasonCell = (v) => stats === undefined ? "…" : (v != null ? LG.fmtPts(v) : "—");
      const blocked = faAddBlocked(p, type);
      const moveBtn = `<button type="button" class="faAddBtn faMoveBtn"${blocked
        ? ` disabled title="${esc(blocked)}" aria-label="${esc(blocked)}"` : ""}>${past ? "Add" : "Claim"}</button>`;
      return `<tr data-fi="${i}" data-pk="${esc(p.key)}">
        <td class="faname"><span class="posbadge" data-pos="${esc(p.pos)}">${esc(p.pos)}</span>
          <b>${escn(p.name)}</b>${trendChip(p.key)}${injLabel(p.injury) ? ' <span class="inj">' + esc(injLabel(p.injury)) + "</span>" : ""}
          <br><small class="mut">${esc(p.team)}</small></td>
        <td class="faadd">${moveBtn}</td>
        <td class="fatype">${esc(type)}</td>
        <td class="faproj num">${proj != null ? LG.fmtPts(proj) : "—"}</td>
        <td class="falast num">${seasonCell(stats && stats.last)}</td>
        <td class="faopp mut">${esc(opp || "—")}</td>
        <td class="faavg num">${seasonCell(stats && stats.avg)}</td>
      </tr>`;
    }
    function faResultsHtml(list) {
      if (list == null) return '<p class="mut">Player search is warming up — try again in a moment.</p>';
      // A 1-2 letter query is deliberately refused by D.searchFA (unfiltered substring
      // matching on two letters is mostly noise) — it used to read as the flat "No matches.",
      // which describes the league rather than the query and looks like the search is broken.
      if (!list.length && faState.q && faState.q.length < 3) return '<p class="mut">Keep typing — three letters or more.</p>';
      if (!list.length) return '<p class="mut">No matches.</p>';
      const ownerMap = faOwnerMap();
      // Sorted across the WHOLE fetched pool (bounded by faState.limit — the same pool "Show
      // more" grows), never just whatever happens to be scrolled into view.
      const sorted = list.slice().sort((a, b) => compareFA(a, b, faState.sortKey, faState.sortDir, ownerMap));
      const rows = sorted.map((p, i) => faRowHtml(p, i, ownerMap)).join("");
      const more = list.length >= faState.limit ? '<button id="faMore" type="button" class="mut">Show more ↓</button>' : "";
      return `<div class="panner"><table class="tbl faTable"><thead>${faHeadHtml()}</thead><tbody>${rows}</tbody></table></div>${more}`;
    }
    function refreshFa() {
      const posChips = $("#faPosChips"), filterChips = $("#faFilterChips"), resEl = $("#faResults");
      if (!posChips || !resEl) return;
      // Available (default) excludes every rostered key, same as the original behavior;
      // All passes an EMPTY owned set so D.searchFA's own exclusion never fires — nothing
      // else about the search needs to change for the toggle to work.
      const owned = faState.filter === "all" ? new Set() : allOwnedKeys();
      const list = D().searchFA(faState.q, owned, { limit: faState.limit, pos: faState.pos });
      posChips.querySelectorAll(".poschip").forEach((b) => b.classList.toggle("on", b.dataset.pos === faState.pos));
      if (filterChips) filterChips.querySelectorAll(".poschip").forEach((b) => b.classList.toggle("on", b.dataset.filter === faState.filter));
      resEl.innerHTML = faResultsHtml(list);
      resEl.querySelectorAll("th.thsort").forEach((th) => th.addEventListener("click", () => {
        const col = th.dataset.sort;
        if (faState.sortKey === col) faState.sortDir = faState.sortDir === "desc" ? "asc" : "desc";
        else { faState.sortKey = col; faState.sortDir = "desc"; }
        UI._faSortKey = faState.sortKey; UI._faSortDir = faState.sortDir;
        refreshFa();
      }));
      resEl.querySelectorAll(".faMoveBtn").forEach((btn) => btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (btn.disabled) return; // belt and braces — a disabled button fires no click anyway
        const key = btn.closest("tr").dataset.pk;
        const fa = list.find((x) => x.key === key);
        if (fa) openClaimCard(fa);
      }));
      wirePlayerCardTaps(resEl); // the row itself (data-pk) — see faRowHtml's own comment
      $("#faMore") && $("#faMore").addEventListener("click", () => { faState.limit += 40; refreshFa(); });
      if (list) ensureFaStatsBatch(list); // per-rendered-page, lazy — see ensureFaStatsBatch's own comment
    }
    $("#faPosChips").querySelectorAll(".poschip").forEach((b) => b.addEventListener("click", () => {
      faState.pos = b.dataset.pos; UI._faPos = faState.pos; faState.limit = 40; refreshFa();
    }));
    $("#faFilterChips").querySelectorAll(".poschip").forEach((b) => b.addEventListener("click", () => {
      faState.filter = b.dataset.filter; UI._faFilter = faState.filter; faState.limit = 40; refreshFa();
    }));
    // S6: DEBOUNCED. Every keystroke used to re-scan the whole 12,000-entry Sleeper directory
    // and rebuild the table; at typing speed that is a dozen full scans for one name. 180ms is
    // under the gap between deliberate keystrokes and far above the gap within a burst, so a
    // fast typist pays for one scan instead of eight and a slow one notices nothing.
    // WHAT SEARCH DOES NOT DO: re-sort. The column headers are the reader's own explicit
    // control, so typing FILTERS the pool and leaves the order they chose alone.
    faInput.addEventListener("input", () => {
      clearTimeout(UI._faSearchT);
      UI._faSearchT = setTimeout(() => {
        faState.q = faInput.value.trim(); faState.limit = 40; refreshFa();
      }, FA_SEARCH_DEBOUNCE_MS);
    });
    refreshFa();
    // S6: the trending strip + the table's HOT/COLD chips. Painted from whatever is already
    // cached (instant on a second visit inside the hour), then once more if a fetch lands.
    // Both repaints are no-ops when there is no trending data — the strip renders NOTHING
    // rather than an empty card, so a dead endpoint costs the page not one pixel.
    function paintHotStrip() {
      const el = $("#hotStrip");
      if (!el) return;
      el.innerHTML = hotPickupsHtml(allOwnedKeys());
      wirePlayerCardTaps(el);
    }
    paintHotStrip();
    D().loadTrending().then(() => {
      if (UI.view !== "moves") return;
      paintHotStrip();
      if ($("#faResults")) refreshFa();
    }).catch(() => {});
    // The Sleeper directory (D.searchFA's backing data) often isn't warm yet at the
    // moment Moves first mounts — searchFA returns null ("warming up") until it is.
    // Since browsing is now the DEFAULT state (not something the family has to type
    // into), repaint once it lands, but only if we're still looking at this page.
    D().initSleeper().then(() => { if (UI.view === "moves") refreshFa(); }).catch(() => {});
    // S10 (2026-08-11): the add/claim flow is a CENTERED CARD now — see openRosterCard's own
    // note. The modal contract is unchanged from the sheet it replaces (item 32): Back closes
    // it and leaves the reader on Moves; Cancel/Submit hand the sentinel back so the NEXT Back
    // is a real view change.
    //
    // ⚠ THERE IS NO "NO DROP NEEDED" ROW, and that is a fact about the league rather than an
    // omission: LG.faAdd SPLICES one player out for the one coming in (and refuses outright
    // with `drop-not-found` otherwise), and processWaivers does the same for a won claim — the
    // roster is a fixed-size slot script, so there is never a free spot to add into. A
    // no-drop row would need roster-cap logic in BOTH of those core paths that doesn't exist.
    // The one case where a drop is genuinely impossible (an empty roster) is already refused
    // upstream, on the table's own ADD button ("You have nobody to drop").
    function openClaimCard(fa) {
      const ros = myRoster;
      const d = D();
      let chosen = null;
      const faProj = d.projFor(fa.key);
      const faInj = injLabel(fa.injury);
      openRosterCard(`<div class="pccard rccard">
        <button type="button" class="pcclose" id="rcClose" aria-label="Close">✕</button>
        <div class="pchead">
          <h2 class="pcname">${past ? "Add" : "Claim"} ${escn(fa.name)}</h2>
          <div class="pcmeta"><span class="posbadge" data-pos="${esc(fa.pos)}">${esc(fa.pos || "?")}</span>
            <span class="mut">${esc(fa.team || "")}</span>${faInj ? ` <span class="inj">${esc(faInj)}</span>` : ""}</div>
          <div class="rcin"><span>proj <b>${faProj != null ? LG.fmtPts(faProj) : "—"}</b></span>
            <span>owned <b data-pctkey="${esc(fa.key)}">${esc(pctOwnedText(fa.key))}</b></span></div>
        </div>
        ${!past ? `<label class="rcbid" for="claimBid">FAAB bid ($, up to ${LG.teamFaab(T)})
          <input id="claimBid" type="number" min="0" max="${LG.teamFaab(T)}" value="0"></label>` : ""}
        <h2 class="rcq">Who do you drop?</h2>
        ${rcHeadHtml()}
        <div class="rclist">${ros.length ? ros.map((p, i) => rcRowHtml(p, `data-di="${i}"`)).join("")
          : '<p class="mut">Nobody on the roster to drop.</p>'}</div>
        <div class="rcfoot">
          <button id="claimGo" class="primary" disabled>${past ? "Add" : "Submit claim"}</button>
          <button type="button" id="claimCancel" class="rcghost">Cancel</button>
        </div>
      </div>`);
      const ov = $("#rosterCard");
      // ONE batched percent-owned call per open (the incoming player + the whole roster), then
      // a text-only repaint — never a rebuild, which would throw away a pick and a typed bid.
      ensurePctOwned([fa.key, ...ros.map((p) => p.key)]).then(paintPctOwned).catch(() => {});
      ov.querySelectorAll("[data-di]").forEach((b) => b.addEventListener("click", () => {
        chosen = ros[Number(b.dataset.di)];
        ov.querySelectorAll("[data-di]").forEach((x) => x.classList.remove("picked"));
        b.classList.add("picked");
        $("#claimGo").disabled = false;
      }));
      $("#claimCancel").addEventListener("click", UI.closeRosterCard);
      $("#claimGo").addEventListener("click", async () => {
        if (!chosen) return;
        // ⭐ DISARM FIRST (season-sim advisory, 2026-08-11). The fix below moved the bid READ
        // in front of the close; it did not stop the handler running TWICE. `chosen` is a
        // closure variable and survives the close, and #claimBid does not — so a second entry
        // files a duplicate claim for the same player at $0, silently, and the owner's real
        // bid is the one that loses. Not reachable by a real double-tap today (the button is
        // detached and hit-testing never delivers the second one — measured), but it becomes
        // live the moment anything puts an await, an animation or a confirm between the click
        // and the close. Disarming the control closes the whole class rather than this
        // instance; the disabled check is what makes the SECOND entry a no-op.
        const go = $("#claimGo");
        if (go) {
          if (go.disabled) return;
          go.disabled = true;
        }
        // Re-arm only where the card is genuinely still on screen and the action refused —
        // every path below closes it, so this is defensive rather than routine.
        const rearm = () => { if (go && go.isConnected) go.disabled = false; };
        // READ THE BID BEFORE CLOSING. The old bottom sheet only set `hidden`, so its input
        // survived the close and could be read afterwards; closing the card EMPTIES it (the
        // player card's own discipline — a modal must not hold a stale screen), so a bid read
        // after the close would silently be 0 on every claim.
        const rawBid = Number(($("#claimBid") || {}).value) || 0;
        UI.closeRosterCard();
        if (past) {
          const r = await LG.faAdd(UI.week, tid, fa, chosen.key);
          if (r.ok) { toast("Added " + fa.name + "."); UI._rosters = null; renderMoves(); }
          else { toast("Couldn't add: " + reasonLabel(r.reason)); rearm(); }
        } else {
          const bid = Math.max(0, Math.min(LG.teamFaab(T), rawBid));
          const claim = {
            id: "claim_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
            teamId: tid, addKey: fa.key, addName: fa.name, addPos: fa.pos, addTeam: fa.team,
            dropKey: chosen.key, dropName: chosen.name, bid, t: Date.now(),
          };
          await LG.addClaim(UI.week, claim);
          toast("Claim submitted: " + fa.name + " for $" + bid + ".");
          renderMoves();
        }
      });
    }

    $("#mvTradeTeam").addEventListener("change", (e) => {
      UI._tradeCp = Number(e.target.value);
      UI._tradeGet = new Set();
      UI._counterOf = null; // a counter answers ONE owner's offer — pick a different owner and it is a fresh proposal
      renderMoves();
    });
    $("#mvCounterDrop") && $("#mvCounterDrop").addEventListener("click", () => {
      UI._counterOf = null; UI._tradeGive = new Set(); UI._tradeGet = new Set();
      renderMoves();
    });
    // ---- ITEM 20 (2026-08-09, user: "the You give you get sections should start blank a plus
    // sign so it only takes up a lot of space if someone is working a trade"). Both sides used
    // to render EVERY player on both rosters the instant the tab mounted — two walls of chips
    // most visits scroll straight past. Each side is now: the players already chosen (you have
    // to be able to see what you are offering), then a "+" that expands the picker, and
    // nothing else. Tapping "+" again collapses it, and a chosen player survives a collapse
    // because the selection lives in UI._tradeGive/_tradeGet exactly as it always did — the
    // send path below is untouched.
    const tradeOpen = { give: false, get: false };
    const sideOf = (side) => (side === "give" ? UI._tradeGive : UI._tradeGet);
    const rosterOf = (side) => (side === "give" ? myRoster : cpRoster);
    function selChipHtml(p, side) {
      return `<span class="tradechip" data-gk="${esc(p.key)}">
          <button type="button" class="pcinline" data-pk="${esc(p.key)}">${escn(p.name)}</button>
          <small class="mut">${esc(p.pos)}</small>
          <button type="button" class="tradedrop" data-side="${side}" data-gk="${esc(p.key)}" aria-label="Remove ${escn(p.name)} from this offer" title="Remove">&times;</button>
        </span>`;
    }
    function renderTradeSide(side) {
      const el = $(side === "give" ? "#mvGive" : "#mvGet");
      if (!el) return;
      const roster = rosterOf(side), set = sideOf(side);
      if (!roster.length) { el.innerHTML = `<p class="mut small">${side === "give" ? "Empty roster." : "Nobody on their roster."}</p>`; return; }
      const chosen = roster.filter((p) => set.has(p.key));
      const rest = roster.filter((p) => !set.has(p.key));
      const open = tradeOpen[side];
      el.innerHTML = `<div class="tradesel">
          ${chosen.map((p) => selChipHtml(p, side)).join("")}
          ${set.size >= 3 ? '<span class="mut small">3 is the limit.</span>'
            : `<button type="button" class="tradeadd${open ? " open" : ""}" data-side="${side}" aria-expanded="${open}"
                 aria-label="${side === "give" ? "Add a player to give" : "Add a player to get"}">+</button>`}
        </div>
        ${open ? `<div class="tradepick">${rest.map((p) => chip(p, set)).join("") || '<p class="mut small">Nobody left to add.</p>'}</div>` : ""}`;
      // The picker's rows are BUILT only while it is open, not merely hidden — a collapsed
      // side costs no DOM at all, which is the difference between "you can't see the wall"
      // and "there is no wall".
      el.querySelectorAll(".tradeadd").forEach((b) => b.addEventListener("click", () => {
        tradeOpen[side] = !tradeOpen[side]; renderTradeSide(side);
      }));
      el.querySelectorAll(".tradedrop").forEach((b) => b.addEventListener("click", () => {
        set.delete(b.dataset.gk); renderTradeSide(side);
      }));
      // Split (2026-08-08) — see chip()'s own comment: .pcpick carries the give/get toggle,
      // .pcinfo (wired by wirePlayerCardTaps) opens the stats card. Picking re-renders the
      // side so the chosen player moves up into the selection strip; the picker stays open,
      // because picking two players in a row is the common case.
      el.querySelectorAll(".pcpick").forEach((b) => b.addEventListener("click", (e) => {
        e.stopPropagation();
        const k = b.dataset.gk;
        if (set.has(k)) set.delete(k);
        else { if (set.size >= 3) { toast("Up to 3 players."); return; } set.add(k); }
        renderTradeSide(side);
      }));
      wirePlayerCardTaps(el);
    }
    UI._renderTradeSide = renderTradeSide; // test hook — the suite drives the real affordances
    renderTradeSide("give");
    renderTradeSide("get");

    // ---- ITEM 21, UPGRADED (2026-08-12, user: "right now its mathematical, I want to
    // connect it to Grok 4.5 and actually have it analyze both rosters strengths and
    // weaknesses, player future projections and come up with a fair trade"). The button asks
    // THE ANALYST first — mode gffltrade in farmgpt.mjs (Grok 4.5, Anthropic fallback), the
    // rosters travelling as NAMED BODY FIELDS with each player's key/pos/slot/injury + the
    // league's own numbers, streaming its written read into #mvSuggestAi and pre-filling the
    // builder from the ===TRADE=== machine tail. The OLD deterministic heuristic
    // (suggestTradePair) survives as the honest FALLBACK — offline, an outage, an unparseable
    // tail: the owner still gets a numbers-based suggestion, labelled as such. Neither path
    // ever sends — the user reviews and presses Send themselves.
    const applySuggestedKeys = (giveKeys, getKeys) => {
      const mineOk = new Set(myRoster.map((p) => p.key)), theirsOk = new Set(cpRoster.map((p) => p.key));
      const give = (giveKeys || []).filter((k) => mineOk.has(k)).slice(0, 3);
      const get = (getKeys || []).filter((k) => theirsOk.has(k)).slice(0, 3);
      if (!give.length || !get.length) return false;
      UI._tradeGive = new Set(give); UI._tradeGet = new Set(get);
      tradeOpen.give = false; tradeOpen.get = false;
      renderTradeSide("give"); renderTradeSide("get");
      return true;
    };
    const mathFallback = async (why, note) => {
      await ensureStats(myRoster.concat(cpRoster));
      const s = suggestTradePair(myRoster, cpRoster);
      if (!s) { if (why) why.textContent = note + " No even trade fits these two rosters right now — try another team."; return; }
      applySuggestedKeys(s.give.map((p) => p.key), s.get.map((p) => p.key));
      if (why) why.textContent = note + " " + s.why + " " + LG.fmtPts(s.giveVal) + " for " + LG.fmtPts(s.getVal) + " — review it before you send.";
    };
    $("#mvSuggest") && $("#mvSuggest").addEventListener("click", async () => {
      const btn = $("#mvSuggest"), why = $("#mvSuggestWhy"), out = $("#mvSuggestAi");
      btn.disabled = true;
      if (why) why.textContent = "Asking the analyst…";
      if (out) { out.hidden = false; out.innerHTML = '<p class="mut small">Reading both rosters…</p>'; }
      try {
        await ensureStats(myRoster.concat(cpRoster));
        const d = D();
        const packSide = (ros) => ros.map((p) => {
          const s = UI._faStats.get(p.key), meta = d.metaForKey(p.key) || {};
          return { key: p.key, name: p.name, pos: p.pos, team: p.team, slot: p.slot,
            injury: meta.injury || "", avg: s ? s.avg : null, last: s ? s.last : null,
            total: s ? s.total : null, proj: d.projFor(p.key) };
        });
        const my = LG.teamById(tid), cp = LG.teamById(UI._tradeCp);
        const rec = (id) => { const st = (UI._standings || {})[id] || {}; return (st.w || 0) + "-" + (st.l || 0); };
        const payload = { week: UI.week, slots: LG.rules.roster || {}, // rules.roster IS the slot map ({QB:1,RB:2,…})
          mine: { name: my ? my.name : "My team", record: rec(tid), players: packSide(myRoster) },
          theirs: { name: cp ? cp.name : "Their team", record: rec(UI._tradeCp), players: packSide(cpRoster) } };
        const r = await fetch("/.netlify/functions/farmgpt", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: LG.PASS, mode: "gffltrade", trade: payload }),
        });
        if (!r.ok) throw new Error("http-" + r.status);
        const reader = r.body.getReader(), dec = new TextDecoder();
        let text = "";
        for (;;) {
          const c = await reader.read(); if (c.done) break;
          text += dec.decode(c.value, { stream: true });
          // Stream the PROSE as it lands; the machine tail is held back until the end.
          if (out) out.innerHTML = aiProseFmt(text.split("===TRADE===")[0]);
        }
        if (!text.trim()) throw new Error("empty");
        const prose = text.split("===TRADE===")[0].trim();
        if (out) out.innerHTML = aiProseFmt(prose);
        let applied = false;
        const tail = /===TRADE===\s*(\{[\s\S]*?\})/.exec(text);
        if (tail) {
          try {
            const t = JSON.parse(tail[1]);
            applied = applySuggestedKeys(t.give, t.get);
            if (!applied && Array.isArray(t.give) && !t.give.length) {
              if (why) why.textContent = "The analyst sees no even trade here — try another team.";
              return;
            }
          } catch (e) { /* unparseable tail → fall through */ }
        }
        if (applied) { if (why) why.textContent = "The analyst's pick is loaded below — review it before you send."; }
        else if (prose) { if (why) why.textContent = "Read the analysis — then pick the players yourself below."; }
        else throw new Error("no-content");
      } catch (e) {
        if (out) out.hidden = true;
        await mathFallback($("#mvSuggestWhy"), "The AI analyst isn't available right now — here's the numbers-based suggestion.");
      } finally { btn.disabled = false; }
    });
    $("#mvTradeSend").addEventListener("click", async () => {
      if (!UI._tradeGive.size || !UI._tradeGet.size) { toast("Pick at least one player on each side."); return; }
      // S7 — one button, two destinations. A counter carries the link that makes the exchange
      // a thread and terminates the offer it answers; everything else about the send (the
      // deadline check, the 1-3 validation, the doc write, the push) is the same path.
      const counterOf = UI._counterOf;
      const r = counterOf
        ? await LG.counterTrade(counterOf, tid, [...UI._tradeGive], [...UI._tradeGet], $("#mvTradeNote").value.trim())
        : await LG.offerTrade(tid, UI._tradeCp, [...UI._tradeGive], [...UI._tradeGet], $("#mvTradeNote").value.trim());
      if (r.ok) { toast(counterOf ? "Counter sent." : "Trade offer sent."); UI._tradeGive = new Set(); UI._tradeGet = new Set(); UI._counterOf = null; renderMoves(); }
      else toast((counterOf ? "Couldn't send counter: " : "Couldn't send offer: ") + reasonLabel(r.reason));
    });
    wirePlayerCardTaps(); // FA table already covered by refreshFa() above; this catches the
                           // claim/trade "My pending" .pcinline names + the trade-builder chips
  }

  // ---------------- rules (item 7, 2026-08-08: reads like ESPN's settings page — grouped, plain
  // English, no raw underscore rule codes anywhere in view mode) ----------------
  function isCommish() { return LG.commishUnlocked(); }
  // RULE_LABELS is the ONE source of truth for every key in LG.DEFAULT_RULES — covers every
  // group (scoring/roster/waivers/trades/keepers/playoffs), keyed exactly the way `data-k`
  // already is ("<group>.<key>"), so the SAME map drives both the grouped view-mode headings
  // and every edit-mode input's label. "draftAt" has no group — it's a flat top-level rules
  // field (S2) — and is keyed by its bare name for the same reason (see rowTop below).
  const RULE_LABELS = {
    draftAt: "Draft day (ISO date)",
    "scoring.pass_yd": "Passing yards", "scoring.pass_td": "Passing TD", "scoring.pass_int": "Interception thrown",
    "scoring.pass_2pt": "2-pt conversion (pass)", "scoring.bonus_pass_300": "300-399 yd passing game bonus",
    "scoring.bonus_pass_400": "400+ yd passing game bonus",
    "scoring.rush_yd": "Rushing yards", "scoring.rush_td": "Rushing TD", "scoring.rush_2pt": "2-pt conversion (rush)",
    "scoring.bonus_rush_100": "100-199 yd rushing game bonus", "scoring.bonus_rush_200": "200+ yd rushing game bonus",
    "scoring.rec": "Reception", "scoring.rec_yd": "Receiving yards", "scoring.rec_td": "Receiving TD",
    "scoring.rec_2pt": "2-pt conversion (catch)", "scoring.bonus_rec_100": "100-199 yd receiving game bonus",
    "scoring.bonus_rec_200": "200+ yd receiving game bonus",
    "scoring.fg_0_39": "Field goal made, 0-39 yds", "scoring.fg_40_49": "Field goal made, 40-49 yds",
    "scoring.fg_50": "Field goal made, 50+ yds", "scoring.fg_made_yd": "Field goal made (per yard)",
    "scoring.fg_miss": "Field goal missed", "scoring.xp_made": "Extra point made", "scoring.xp_miss": "Extra point missed",
    "scoring.dst_sack": "Sack", "scoring.dst_int": "Interception", "scoring.dst_fum_rec": "Fumble recovery",
    "scoring.dst_td": "Defensive/return TD", "scoring.dst_safety": "Safety", "scoring.dst_blk": "Blocked kick",
    "scoring.dst_2pt_ret": "2-pt return", "scoring.dst_pa_0": "0 points allowed", "scoring.dst_pa_1_6": "1-6 points allowed",
    "scoring.dst_pa_7_13": "7-13 points allowed", "scoring.dst_pa_14_17": "14-17 points allowed",
    "scoring.dst_pa_18_27": "18-27 points allowed", "scoring.dst_pa_28_34": "28-34 points allowed",
    "scoring.dst_pa_35_45": "35-45 points allowed", "scoring.dst_pa_46": "46+ points allowed",
    "scoring.fum_lost": "Fumble lost", "scoring.off_fum_td": "Offensive fumble return TD",
    "scoring.one_pt_safety": "1-pt safety",
    "roster.QB": "Starting QBs", "roster.RB": "Starting RBs", "roster.WR": "Starting WRs", "roster.TE": "Starting TEs",
    "roster.FLEX": "Starting FLEX spots", "roster.DST": "Starting D/ST", "roster.K": "Starting kickers",
    "roster.BENCH": "Bench spots", "roster.IR": "IR spots",
    "waivers.type": "Waiver type", "waivers.budget": "FAAB budget ($)",
    "waivers.processDow": "Claims process on (0=Sun...6=Sat)", "waivers.processHour": "Claims process at (hour, 24h)",
    "trades.reviewHours": "Trade review window (hours)", "trades.veto": "Veto method",
    "trades.vetoVotes": "Votes needed to veto", "trades.deadlineWeek": "Trade deadline (week)",
    "keepers.max": "Max keepers", "keepers.costRoundsEarlier": "Keeper cost — rounds earlier than drafted",
    "keepers.costFloor": "Keeper cost — floor round", "keepers.maxYears": "Max consecutive years kept",
    "keepers.waiverCost": "Waiver-pickup keeper cost", "keepers.mustBeOnFinalRoster": "Must be on final roster",
    "playoffs.teams": "Playoff teams", "playoffs.startWeek": "Playoffs start (week)", "playoffs.byes": "First-round byes",
  };
  const SCORING_GROUPS = [
    { title: "Passing", keys: ["pass_yd", "pass_td", "pass_int", "pass_2pt", "bonus_pass_300", "bonus_pass_400"] },
    { title: "Rushing", keys: ["rush_yd", "rush_td", "rush_2pt", "bonus_rush_100", "bonus_rush_200"] },
    { title: "Receiving", keys: ["rec", "rec_yd", "rec_td", "rec_2pt", "bonus_rec_100", "bonus_rec_200"] },
    { title: "Kicking", keys: ["fg_0_39", "fg_40_49", "fg_50", "fg_made_yd", "fg_miss", "xp_made", "xp_miss"] },
    { title: "Defense / Special Teams", keys: ["dst_sack", "dst_int", "dst_fum_rec", "dst_td", "dst_safety", "dst_blk", "dst_2pt_ret"] },
    { title: "Misc", keys: ["fum_lost", "off_fum_td", "one_pt_safety"] },
  ];
  // Points-allowed brackets are a structured VALUE TABLE, not a list of optional bonuses — a
  // bracket sitting at 0 ("18-27 points allowed → 0") is a real, meaningful breakpoint, so
  // unlike the rest of Scoring these are NEVER hidden at zero (the "noise" rule below is
  // deliberately scoped to SCORING_GROUPS only).
  const PA_BRACKETS = ["dst_pa_0", "dst_pa_1_6", "dst_pa_7_13", "dst_pa_14_17", "dst_pa_18_27", "dst_pa_28_34", "dst_pa_35_45", "dst_pa_46"];
  const DOW_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const hour12 = (h) => (((h % 12) || 12) + (h < 12 ? " AM" : " PM"));
  function rosterSummaryLine(r) {
    const ro = r.roster || {};
    const starters = ["QB", "RB", "WR", "TE", "FLEX"].map((k) => `${ro[k] || 0} ${k}`).concat([`${ro.DST || 0} D/ST`, `${ro.K || 0} K`]).join(", ");
    return `${starters} · ${ro.BENCH || 0} bench · ${ro.IR || 0} IR`;
  }
  function waiversSummaryLine(r) {
    const w = r.waivers || {};
    return `FAAB $${w.budget}, claims process ${DOW_NAMES[w.processDow] || "?"} ${hour12(w.processHour)}, ties go to the worse record.`;
  }
  function tradesSummaryLine(r) {
    const t = r.trades || {};
    return `${t.reviewHours}h review, ${t.vetoVotes} votes veto, deadline week ${t.deadlineWeek}.`;
  }
  // Kept as the app's original plain-English keeper sentence, verbatim (item 7's own spec).
  function keepersSummaryLine(r) {
    const k = r.keepers || {};
    return `keepers: max ${k.max}, cost = last round −${k.costRoundsEarlier} (floor R${k.costFloor}), ${k.maxYears} straight years max, waiver pickups cost your last pick`;
  }
  function playoffsSummaryLine(r) {
    const p = r.playoffs || {};
    const playIn = p.teams - p.byes;
    const playInTxt = playIn === 2 ? `, ${p.byes + 1}v${p.byes + 2} play-in` : "";
    return `${p.teams}-team playoffs (top ${p.byes} get byes${playInTxt}) · starts week ${p.startWeek}, week-by-week single elimination.`;
  }
  function scheduleSummaryLine(r) { return `${r.seasonWeeks}-week regular season, double round robin.`; }
  // S2: draftAt has no group (it's a flat top-level rules field), so it gets the same plain-
  // English treatment as the other summary lines above rather than a raw table row.
  function draftAtSummaryLine(r) {
    const ds = draftState(r);
    return ds ? `Draft day: ${draftDateLabel(ds.target)}` : "No draft day set.";
  }
  UI.renderRules = renderRules;
  async function renderRules(editing) {
    const r = LG.rules;
    const doc = LG.rulesDoc || { v: 0, log: [] };
    // THE "undefined" POISONING (found by the shadow scorer, 2026-08-11, IN PRODUCTION):
    // String(obj[key]) on an ABSENT key renders the literal text "undefined" into the input,
    // and one save later that string is IN THE DOC — which is exactly how the live league's
    // fg_made_yd (the signature kicker rule!), one_pt_safety and dst_2pt_ret came to score
    // as silent zeroes. redval() is the render-side guard: absent (and the poison strings a
    // historical save already wrote) render EMPTY; the save handler below is the write-side
    // guard. Both ends, because either alone leaves the other half of the loop open.
    const POISON = (s) => s === "undefined" || s === "null";
    const redval = (v) => (v === undefined || v === null || POISON(String(v))) ? "" : String(v);
    // View-mode row: label + value only, never the raw key. Edit-mode row: label + a `.redit`
    // input carrying the SAME data-k the save handler has always parsed — every key renders
    // here, zero or not (item 7's "still present in edit mode").
    const rowV = (group, key, obj) => `<tr><td>${esc(RULE_LABELS[group + "." + key] || key)}</td>
      <td class="num">${esc(redval(obj[key]))}</td></tr>`;
    const rowE = (group, key, obj) => `<tr><td>${esc(RULE_LABELS[group + "." + key] || key)}</td>
      <td class="num"><input class="redit" data-k="${group}.${key}" value="${esc(redval(obj[key]))}"></td></tr>`;
    const row = (group, key, obj) => (editing ? rowE : rowV)(group, key, obj);
    // S2's draftAt is TOP-LEVEL (no group to nest it under), so it gets its own tiny row pair
    // with a bare `data-k` (no dot) — the save handler below treats a dot-less data-k as a key
    // straight on `next` itself rather than on `next[group]`.
    const rowVTop = (key, obj) => `<tr><td>${esc(RULE_LABELS[key] || key)}</td>
      <td class="num">${esc(redval(obj[key]))}</td></tr>`;
    const rowETop = (key, obj) => `<tr><td>${esc(RULE_LABELS[key] || key)}</td>
      <td class="num"><input class="redit" data-k="${key}" value="${esc(redval(obj[key]))}"></td></tr>`;
    const rowTop = (key, obj) => (editing ? rowETop : rowVTop)(key, obj);
    UI._redval = redval; // test hook
    const scoringGroupsHtml = SCORING_GROUPS.map((g) => {
      const keys = editing ? g.keys : g.keys.filter((k) => Number(r.scoring[k]) !== 0);
      if (!keys.length) return ""; // a fully-zero group (view mode only) contributes nothing, not an empty heading
      return `<h2 class="small mut">${esc(g.title)}</h2><div class="panner"><table class="tbl">
        <tbody>${keys.map((k) => row("scoring", k, r.scoring)).join("")}</tbody></table></div>`;
    }).join("");
    const paHtml = `<h2 class="small mut">Points allowed</h2><div class="panner"><table class="tbl">
      <tbody>${PA_BRACKETS.map((k) => row("scoring", k, r.scoring)).join("")}</tbody></table></div>`;
    const simpleSection = (title, summaryLine, group, obj) => `<div class="card"><h2>${esc(title)}</h2>
      <p class="mut small">${esc(summaryLine)}</p>
      ${editing ? `<div class="panner"><table class="tbl"><tbody>${Object.keys(obj).map((k) => row(group, k, obj)).join("")}</tbody></table></div>` : ""}</div>`;
    main().innerHTML = `
      <div class="card rowline"><h2>League rules <span class="mut">v${doc.v}</span></h2>
        <span>
          <button id="rulesEdit">${isCommish() ? (editing ? "Save" : "Edit") : "Commissioner"}</button>
          ${editing ? '<button id="rulesCancel">Cancel</button>' : ""}
          <button id="rulesImport" ${isCommish() && !editing ? "" : "hidden"}>Import from ESPN</button>
          <button id="schedGen" ${isCommish() && !editing ? "" : "hidden"}>${schedule ? "Regenerate" : "Generate"} schedule</button>
          <button id="rostersImport" ${isCommish() && !editing ? "" : "hidden"}>Import ESPN rosters</button>
          <button id="testRostersImport" ${isCommish() && !editing ? "" : "hidden"}>Import 2025 rosters (test run)</button>
          <button id="backupsFill" ${isCommish() && !editing ? "" : "hidden"}>Fill rosters with backups</button>
          <button id="historyImport" ${isCommish() && !editing ? "" : "hidden"}>Import history</button>
        </span></div>
      ${isCommish() && !editing ? `<div class="card mut small">
        <b>Import from ESPN</b> — rules, scoring, and the 8 teams, from the real live league.<br>
        <b>Import ESPN rosters</b> — this week's rosters, from the real live (${r.season}) league.<br>
        <b>Import 2025 rosters (test run)</b> — re-seeds THIS week's rosters from the real,
        FINAL 2025 season. The 2025 replay already does this at week 1 automatically; this is
        the manual button for re-running it against whichever week is open.<br>
        <b>Fill rosters with backups</b> — REPLACES this week's rosters with NFL second and
        third stringers, spread evenly across all ${LG.teams.length} teams. Built for a
        preseason shakedown: the 2s and 3s are the players who actually take the snaps in an
        exhibition game, so the board shows real live scoring instead of a column of zeroes.<br>
        <b>Import history</b> — past seasons' standings/champions/scores, for the record book.
      </div>` : ""}
      ${simPhaseCardHtml()}
      <div class="card mut small">${esc(r.name)} · season ${r.season} · ${scheduleSummaryLine(r)}</div>
      <div class="card"><h2>Draft</h2>
        <p class="mut small">${esc(draftAtSummaryLine(r))}</p>
        ${editing ? `<div class="panner"><table class="tbl"><tbody>${rowTop("draftAt", r)}</tbody></table></div>` : ""}</div>
      <div class="card"><h2>Scoring</h2>${scoringGroupsHtml}${paHtml}</div>
      ${simpleSection("Roster", rosterSummaryLine(r), "roster", r.roster)}
      ${simpleSection("Waivers", waiversSummaryLine(r), "waivers", r.waivers)}
      ${simpleSection("Trades", tradesSummaryLine(r), "trades", r.trades)}
      ${simpleSection("Keepers", keepersSummaryLine(r), "keepers", r.keepers)}
      ${simpleSection("Playoffs", playoffsSummaryLine(r), "playoffs", r.playoffs)}
      <div class="card"><h2>Change log</h2>${(doc.log || []).slice(-15).reverse().map((e) =>
        `<div class="fline sys"><span class="mut">${new Date(e.t).toLocaleString()}</span> <b>${esc(e.who)}</b><br>
         <small>${e.changes.map(esc).join("<br>")}</small></div>`).join("") || '<p class="mut">No changes yet.</p>'}</div>
      <div id="importOut"></div>`;
    $("#rulesEdit").addEventListener("click", async () => {
      if (editing) {
        const next = JSON.parse(JSON.stringify(LG.rules));
        // A field that is a NUMBER today must stay a number (2026-08-09). This handler used to
        // fall back to the RAW STRING for anything unparseable — so one blank or fat-fingered
        // scoring box persisted a string into the rules doc, and a truthy non-number in the
        // scoring table makes D.score return NaN for EVERY player (the multiply runs for all 28
        // keys on every row, so `0 * "x"` poisons players who have none of that stat). The
        // string branch exists for the fields that are legitimately text — keepers.waiverCost
        // "last-round", waivers.type, trades.veto — so the CURRENT value's type decides, and an
        // unparseable numeric box keeps its old value and says so rather than corrupting scoring.
        const rejected = [];
        document.querySelectorAll(".redit").forEach((inp) => {
          // S2: draftAt's `data-k` carries no dot (it's top-level, not "group.key") — a
          // dot-less key writes straight onto `next` itself instead of `next[group]`.
          const parts = inp.dataset.k.split(".");
          const g = parts.length > 1 ? parts[0] : null;
          const k = parts.length > 1 ? parts[1] : parts[0];
          const target = g ? next[g] : next;
          if (!target || !(k in target)) return;
          const raw = inp.value.trim();
          const n = Number(raw);
          const label = RULE_LABELS[(g ? g + "." : "") + k] || k;
          if (typeof target[k] === "number") {
            if (raw !== "" && Number.isFinite(n)) target[k] = n;
            else rejected.push(label);
          } else {
            // WRITE-SIDE POISON GUARD (the production fg_made_yd incident): the string branch
            // exists for the legitimately-text fields, but it must never store the literal
            // "undefined"/"null" — that is how three scoring keys silently became zeroes in
            // the live league. A poison string is REJECTED like an unparseable number; an
            // EMPTY box over a currently-poisoned/absent value HEALS the key to 0 (numeric is
            // the only context an absent scoring key has); an empty box over a real text
            // value keeps it.
            const curPoison = target[k] === undefined || target[k] === null || (typeof target[k] === "string" && /^(undefined|null)$/.test(target[k]));
            if (/^(undefined|null)$/.test(raw)) rejected.push(label);
            else if (raw === "") { if (curPoison) target[k] = 0; }
            else target[k] = Number.isFinite(n) ? n : raw;
          }
        });
        if (rejected.length) toast("Left unchanged (needs a number): " + rejected.slice(0, 3).join(", "));
        const changes = await LG.saveRules(next, LG.who());
        toast(changes.length ? changes.length + " rule change(s) saved + logged." : "No changes.");
        renderRules(false);
        return;
      }
      if (!(await LG.gateCommish())) return;
      renderRules(true);
    });
    $("#rulesCancel") && $("#rulesCancel").addEventListener("click", () => renderRules(false));
    $("#rulesImport") && $("#rulesImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      try { await importFromEspn(); } catch (e) { importFail(importOut(), "Import failed", e); }
    });
    $("#schedGen") && $("#schedGen").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      const weeks = LG.generateSchedule(LG.teams.map((t) => t.id), LG.rules.seasonWeeks);
      await LG.saveSchedule(weeks);
      schedule = weeks;
      toast("Schedule saved: " + weeks.length + " weeks.");
      renderRules();
    });
    $("#rostersImport") && $("#rostersImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await importRosters();
    });
    $("#testRostersImport") && $("#testRostersImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await importTestRosters();
    });
    $("#backupsFill") && $("#backupsFill").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      try { await renderBackupFillConfirm(); } catch (e) { importFail(importOut(), "Couldn't read the current rosters", e); }
    });
    $("#historyImport") && $("#historyImport").addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      await importHistory();
    });
    wireSimPhaseCard();
  }
  // ---------------- 2025 replay: which moment of week 1 (2026-08-08) ----------------
  // Commissioner-gated, Rules page, hard reload on switch — the same posture every other
  // reload-y action here already uses (a phase change moves LG.now(), which every cached
  // roster/game/stat in memory was derived against; rebuilding from a clean boot is far
  // smaller a surface than trying to hot-swap all of it).
  function simPhaseCardHtml() {
    if (!LG.SIM_2025) return "";
    const cur = LG.SIM_PHASE;
    const btns = Object.keys(LG.SIM_PHASES).map((id) => {
      const p = LG.SIM_PHASES[id];
      return `<button class="simPhaseBtn${id === cur ? " primary" : ""}" data-phase="${id}"
        ${id === cur ? "disabled" : ""}>${esc(p.label)}</button>`;
    }).join(" ");
    return `<div class="card"><h2>Replay clock</h2>
      <p class="mut small">Which moment of week 1 the app opens on. The clock then runs
      ${Number(LG.SIM_SPEED) > 0 ? esc(String(LG.SIM_SPEED)) + "x real time" : "paused"} from there,
      and stops once week 1 is over.</p>
      <div class="rowline" id="simPhaseRow">${isCommish() ? btns : '<span class="mut small">Commissioner only.</span>'}</div></div>`;
  }
  function wireSimPhaseCard() {
    document.querySelectorAll(".simPhaseBtn").forEach((b) => b.addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      if (!LG.setSimPhase(b.dataset.phase)) return;
      location.reload();
    }));
  }

  // ---------------- lockers (plan §4.7) ----------------
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  // Chat messages that mention this team's name or its abbrev — "the wall".
  async function lockerWallMessages(T) {
    const all = await LG.loadAllChat(); // already newest-first
    const nameRe = T.name ? new RegExp(escapeRegex(T.name), "i") : null;
    const abRe = T.abbrev ? new RegExp("(^|[^a-z0-9])" + escapeRegex(T.abbrev) + "([^a-z0-9]|$)", "i") : null;
    return all.filter((m) => !m.sys && m.text && ((nameRe && nameRe.test(m.text)) || (abRe && abRe.test(m.text)))).slice(0, 15);
  }
  // Schedule + results so far — "—" for anything not yet finalized (weekly
  // docs don't exist until S5's finalization; this degrades honestly).
  async function lockerScheduleRows(teamId) {
    if (!schedule) return '<tr><td colspan="3" class="mut">No schedule yet.</td></tr>';
    const weekly = await LG.db.list("weekly");
    return schedule.map((wk, i) => {
      const g = wk.find(([h, a]) => h === teamId || a === teamId);
      if (!g) return `<tr><td>${i + 1}</td><td class="mut">BYE</td><td class="num mut">—</td></tr>`;
      const [h, a] = g;
      const oppId = h === teamId ? a : h;
      const opp = LG.teamById(oppId);
      const wd = weekly.find((w) => w.week === i + 1);
      let result = "—";
      if (wd) {
        const m = (wd.matchups || []).find((mm) => (mm.home === h && mm.away === a) || (mm.home === a && mm.away === h));
        if (m) {
          const mine = h === teamId ? m.homePts : m.awayPts;
          const other = h === teamId ? m.awayPts : m.homePts;
          result = `${mine > other ? "W" : mine < other ? "L" : "T"} ${LG.fmtPts(mine)}-${LG.fmtPts(other)}`;
        }
      }
      return `<tr><td>${i + 1}</td><td>${esc(opp ? opp.name : "?")}</td><td class="num mut">${esc(result)}</td></tr>`;
    }).join("");
  }
  // Rivalries (plan §4.8): this team's all-time head-to-head vs every OTHER
  // current franchise, skipping any pair with zero shared history (nothing
  // to show yet — not the same as "0-0"). Sorted by most wins first.
  async function lockerRivalries(teamId) {
    const rows = [];
    for (const t of LG.teams) {
      if (t.id === teamId) continue;
      const h2h = await LG.headToHead(teamId, t.id);
      if (h2h.aWins + h2h.bWins + h2h.ties === 0) continue;
      rows.push({ id: t.id, name: t.name, w: h2h.aWins, l: h2h.bWins, t: h2h.ties });
    }
    rows.sort((a, b) => (b.w - a.w) || (a.name || "").localeCompare(b.name || ""));
    return rows;
  }
  // Dominant SATURATED colour of a data: image, sampled from a small canvas —
  // one bucket-by-hue pass, mid-lightness pick. Computed ONCE at upload time
  // (never per render — plan §4.7); the upload flow always hands this a
  // data: URL (the just-resized logo), so canvas tainting never applies here.
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }
  // S3: THREE colours, not one. The buckets are population-ordered and the top three are taken
  // with a HUE-SEPARATION rule (>= PAL_HUE_SEP apart), because the three biggest buckets of a
  // logo with a big red field are otherwise three shades of the same red — a "scheme" that
  // looks like one colour applied three times. Anything the image genuinely cannot supply is
  // left null and LG.teamPalette derives it, so the caller never has to care how many the
  // picture happened to hold.
  //
  // The GREY FALLBACK matters as much as the colour path: a flat black-and-white crest filters
  // every pixel out of the saturated pass, and the old code answered {primary:null} — a team
  // whose logo is deliberately monochrome got no scheme at all. When nothing saturated
  // survives, the same pass runs again over LIGHTNESS buckets, so a black/white/grey mark
  // proposes black/white/grey.
  const PAL_HUE_SEP = 25;
  function paletteFromPixels(data) {
    const hue = new Map(), grey = new Map();
    let any = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue; // transparent
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const { h, s, l } = rgbToHsl(r, g, b);
      any = true;
      // Lightness buckets are collected on the SAME pass — free, and the only thing that can
      // answer a monochrome mark.
      const lb = Math.min(9, Math.floor(l * 10));
      const grec = grey.get(lb) || { count: 0, r: 0, g: 0, b: 0, key: l * 360 };
      grec.count++; grec.r += r; grec.g += g; grec.b += b; grey.set(lb, grec);
      if (s < 0.18 || l < 0.12 || l > 0.92) continue; // grayish / near-black / near-white
      const hb = Math.floor(h / 10) % 36;
      const rec = hue.get(hb) || { count: 0, r: 0, g: 0, b: 0, key: hb * 10 };
      rec.count++; rec.r += r; rec.g += g; rec.b += b; hue.set(hb, rec);
    }
    if (!any) return { primary: null, secondary: null, tertiary: null };
    const useHue = hue.size > 0;
    const src = useHue ? hue : grey;
    const sep = useHue ? PAL_HUE_SEP : 30; // lightness buckets are 36 "degrees" apart by construction
    const ranked = [...src.values()].sort((a, b) => b.count - a.count);
    const picked = [];
    for (const rec of ranked) {
      if (picked.length >= 3) break;
      // Circular distance for hues; a plain one for lightness (0 and 1 are opposites there,
      // not neighbours).
      const far = picked.every((p) => {
        const d = Math.abs(p.key - rec.key);
        return (useHue ? Math.min(d, 360 - d) : d) >= sep;
      });
      if (far) picked.push(rec);
    }
    const avg = (rec) => `rgb(${Math.round(rec.r / rec.count)},${Math.round(rec.g / rec.count)},${Math.round(rec.b / rec.count)})`;
    return {
      primary: picked[0] ? avg(picked[0]) : null,
      secondary: picked[1] ? avg(picked[1]) : null,
      tertiary: picked[2] ? avg(picked[2]) : null,
    };
  }
  function extractPalette(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        try {
          const S = 32;
          const cv = document.createElement("canvas");
          cv.width = S; cv.height = S;
          const ctx = cv.getContext("2d");
          ctx.drawImage(img, 0, 0, S, S);
          resolve(paletteFromPixels(ctx.getImageData(0, 0, S, S).data));
        } catch (e) { reject(e); }
      };
      img.src = src;
    });
  }
  UI.extractPalette = extractPalette;
  // S1: the identity edits render on the OWNER's locker as they always have, and additionally
  // on EVERY locker for a commissioner. `isOwner` is what decides whether a press has to pass
  // LG.gateCommish() first — an owner's own flow is byte-identical to what it was (no gate
  // call, no prompt consumed, nothing awaited that wasn't before).
  function wireLockerEdit(T, isOwner) {
    const gate = async () => isOwner || await LG.gateCommish();
    // Design pass 2 (2026-08-10, user): ALL the identity controls live behind the pencil.
    // The hero shows nothing but identity until the pencil is pressed; the pencil itself is
    // the only affordance, and it only renders for owner/commish (renderLocker's gate). The
    // disclosure is per-render — a locker always opens quiet.
    const pencil = $("#lockerEditToggle");
    if (pencil) pencil.addEventListener("click", () => {
      const foot = $(".lockerfoot");
      if (!foot) return;
      const open = foot.hidden;
      foot.hidden = !open;
      pencil.setAttribute("aria-expanded", String(open));
      pencil.classList.toggle("on", open);
    });
    const nameBtn = $("#lockerEditName");
    if (nameBtn) nameBtn.addEventListener("click", async () => {
      if (!(await gate())) return;
      const v = window.prompt("Team name:", T.name || "");
      if (v == null) return;
      const name = v.trim().slice(0, 60);
      if (!name) return;
      await LG.saveTeam({ teamId: T.id, name }); // delta only — see the claim handler's note
      await LG.loadTeams();
      UI.openLocker(T.id);
    });
    const mottoBtn = $("#lockerEditMotto");
    if (mottoBtn) mottoBtn.addEventListener("click", async () => {
      if (!(await gate())) return;
      const v = window.prompt("Team motto (max 80 chars):", T.motto || "");
      if (v == null) return;
      const motto = v.trim().slice(0, 80);
      await LG.saveTeam({ teamId: T.id, motto });
      await LG.loadTeams();
      UI.openLocker(T.id);
    });
    const logoBtn = $("#lockerEditLogo"), logoInput = $("#lockerLogoInput");
    if (logoBtn && logoInput) {
      // Gated BEFORE the file picker opens — a commissioner who fails the PIN must never get
      // as far as choosing an image only to be refused afterwards.
      logoBtn.addEventListener("click", async () => { if (await gate()) logoInput.click(); });
      logoInput.addEventListener("change", async (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (!file) return;
        try {
          // Alpha-preserving (2026-08-11): a transparent PNG stays transparent — .tcrest paints
          // the team's own primary behind it, so a cut-out mark sits on its team's colour
          // instead of in a black box.
          const dataUrl = await resizeLogoToDataUrl(file, LOGO_CAP);
          if (dataUrl.length > LOGO_CAP) { toast("That logo is too big — try a smaller image."); return; }
          // THE LATCH. Extraction proposes; a human's pick is final. Once anyone has touched a
          // swatch (colorsCustom) a new logo changes the PICTURE and nothing else — the team's
          // scheme is theirs, and silently repainting the whole app off a re-upload would be
          // the app overruling a deliberate choice. "↺ from logo" is the way back.
          const delta = { teamId: T.id, logoData: dataUrl };
          if (!T.colorsCustom) {
            try {
              const p = await extractPalette(dataUrl);
              if (p && p.primary) delta.colors = { primary: p.primary, secondary: p.secondary || null, tertiary: p.tertiary || null };
            } catch (e2) { /* keep whatever colours are already on file */ }
          }
          await LG.saveTeam(delta); // DELTA only — never a whole spread team (lg-core's saveTeam note)
          await LG.loadTeams();
          toast(T.colorsCustom ? "Logo updated — your colours were kept." : "Logo updated.");
          UI.openLocker(T.id);
        } catch (err) { toast("Couldn't read that image."); }
      });
    }
    wireColorEditor(T, gate);
  }
  // S3 — the three swatches on the locker. They ride wireLockerEdit's OWN gate (owner: free,
  // commissioner: LG.gateCommish, anyone else: refused), so there is exactly one answer in this
  // file to "may this person change this team's identity" and colours are not a second one.
  //
  // <input type="color"> is deliberate: it is the platform's picker on every device the family
  // owns, it needs no library, and it hands back a #rrggbb string — the storage format — with
  // no parsing. Its `change` event fires once the reader has settled on a colour (`input` fires
  // continuously while they drag, which would write a doc per frame).
  function wireColorEditor(T, gate) {
    const wrap = $("#lockerColors");
    if (!wrap) return;
    wrap.querySelectorAll(".tcswatch").forEach((inp) => {
      // The gate has to run BEFORE the native picker opens — same reasoning as the logo
      // button. A colour input opens on pointerdown, so the refusal is wired there and the
      // press is cancelled; the change handler can then trust that it is allowed to write.
      let allowed = false;
      inp.addEventListener("pointerdown", async (e) => {
        if (allowed) return;
        e.preventDefault();
        if (!(await gate())) return;
        allowed = true;
        inp.click();
      });
      // …and gated AGAIN on change, because pointerdown is not the only way into a colour
      // input: a keyboard user opens it with Space, and an assistive tool may set it outright.
      // A commissioner is never asked twice for the same session — LG.gateCommish() returns
      // immediately once unlocked — so the belt-and-braces costs nothing but closes the hole.
      inp.addEventListener("change", async () => {
        if (!allowed && !(await gate())) { inp.value = LG.teamPalette(T).raw[inp.dataset.slot]; return; }
        allowed = true;
        const which = inp.dataset.slot;
        const cur = LG.teamPalette(T).raw;
        const colors = { primary: cur.primary, secondary: cur.secondary, tertiary: cur.tertiary };
        colors[which] = inp.value;
        // colorsCustom latches TRUE here and only here — the one place a human hand reaches a
        // colour. Written as part of the same delta so a save can never land half-latched.
        await LG.saveTeam({ teamId: T.id, colors, colorsCustom: true });
        await LG.loadTeams();
        toast("Team colours saved.");
        UI.openLocker(T.id);
      });
    });
    const reset = $("#lockerColorReset");
    if (reset) reset.addEventListener("click", async () => {
      if (!(await gate())) return;
      const src = T.logoData || T.logo || "";
      if (!src) { toast("No logo to read colours from yet."); return; }
      let p = null;
      try { p = await extractPalette(src); } catch (e) { p = null; }
      if (!p || !p.primary) { toast("Couldn't read colours from that logo."); return; }
      // Clearing the latch is the WHOLE point of this button, so colorsCustom is written
      // FALSE explicitly rather than omitted — saveTeam merges onto the stored doc, so an
      // absent key would leave the old `true` sitting there.
      await LG.saveTeam({ teamId: T.id, colors: { primary: p.primary, secondary: p.secondary || null, tertiary: p.tertiary || null }, colorsCustom: false });
      await LG.loadTeams();
      toast("Colours re-read from the logo.");
      UI.openLocker(T.id);
    });
  }
  // My Team = Locker (merged 2026-08-07): the owner's OWN locker embeds the editable lineup
  // (tap-to-swap starters/bench/IR, kickoff locks — exactly what the old separate "team" page
  // did) as its roster section; every other team's locker keeps the plain read-only roster
  // table it always had. There is no more standalone renderTeam.
  // The locker lineup + the swap sheet. Routed through injLabel like every other site — an
  // ACTIVE player gets nothing at all here, not an "Active" chip.
  function injChip(d, p) {
    const row = d.S.players.get(p.key);
    const lab = injLabel((row && row.injury) || p.injury || "");
    return lab ? ` <span class="inj">${esc(lab)}</span>` : "";
  }
  // ---------------- S4: the league-alerts card (My Team only) ----------------
  // Deliberately its own card among Schedule/Transactions/Rivalries rather than a row inside
  // the pencil-disclosed hero foot. The foot is IDENTITY — what this team is called, what
  // colour it is, facts about the team that every owner sees. Alerts are a fact about THIS
  // PHONE: the same owner on a second device sees a different state here. Putting a
  // per-device toggle inside a per-team editor would have been the wrong drawer, and the
  // design pass's rule — the hero stays quiet until the pencil — is untouched either way.
  UI._pushEnv = pushEnv; // test hook
  function pushEnv() {
    const ua = navigator.userAgent || "";
    // iPadOS 13+ reports itself as a Mac; the touch-point count is what still gives it away.
    const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
    let standalone = false;
    try {
      standalone = !!((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true);
    } catch (e) { /* matchMedia can throw in odd embeddings */ }
    const P = window.BuckyPush;
    const st = P && P.status ? P.status() : null;
    const supported = !!(P && P.isSupported && P.isSupported());
    const onTeam = st && st.extra && st.extra.gfflTeam != null ? Number(st.extra.gfflTeam) : null;
    return { iOS, standalone, supported, st, onTeam, has: !!P };
  }
  const BELL_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" class="alertbell">' +
    '<path fill="currentColor" d="M12 22a2.05 2.05 0 0 0 2.05-2.05h-4.1A2.05 2.05 0 0 0 12 22zm6.2-6.2v-5.3a6.25 6.25 0 0 0-4.7-6.05V3.7a1.5 1.5 0 0 0-3 0v.75a6.25 6.25 0 0 0-4.7 6.05v5.3L4 17.5v.85h16v-.85z"/></svg>';
  function alertsCardHtml(T, isOwner) {
    if (!isOwner) return "";
    const e = pushEnv();
    const head = `<h2>${BELL_SVG} Alerts</h2>`;
    // iOS FIRST, and before the support test: Safari in a tab reports no PushManager at all,
    // so "this browser can't" would be technically true and completely useless — the honest
    // answer is that there IS a way and it runs through the installed app.
    if (e.iOS && !e.standalone) {
      return `<div class="card alertcard" id="alertCard">${head}
        <p class="mut small">On iPhone and iPad, alerts only work from the installed app. Add the league to your Home Screen from the Share menu (iOS 16.4 or newer), open it from there, and this card will offer to turn them on.</p></div>`;
    }
    if (!e.has || !e.supported) {
      return `<div class="card alertcard" id="alertCard">${head}
        <p class="mut small">This browser can't do push notifications.</p></div>`;
    }
    if (e.onTeam === T.id) {
      return `<div class="card alertcard" id="alertCard">${head}
        <p class="small">Alerts are on for ${esc(T.name)} on this phone.</p>
        <p class="mut small">Trade offers, waiver results, week recaps and chat mentions.</p>
        <div class="alertrow"><button id="alertOff">Turn off</button>
          <span class="mut small">That turns off every Bucky alert on this phone.</span></div></div>`;
    }
    return `<div class="card alertcard" id="alertCard">${head}
      <p class="small">Get league alerts on this phone.</p>
      <p class="mut small">Trade offers, waiver results, week recaps and chat mentions. Nothing else.</p>
      <div class="alertrow"><button id="alertOn" class="primary">Turn on league alerts</button></div></div>`;
  }
  function wireAlertsCard(T) {
    const on = $("#alertOn"), off = $("#alertOff");
    if (on) on.addEventListener("click", async () => {
      on.disabled = true;
      try {
        // `user` keeps the family app's own targeting working on this device — a phone that
        // gets chore reminders as "Isaac" keeps getting them. gfflTeam is what every S4 send
        // selects on, and setDoc merges, so neither audience displaces the other.
        await window.BuckyPush.enable(LG.who() || T.name, LG.famKey, null, { gfflTeam: T.id });
        toast("Alerts are on for " + T.name + " on this phone.");
        renderLocker();
      } catch (err) {
        on.disabled = false;
        toast(String((err && err.message) || "Couldn't turn alerts on."));
      }
    });
    if (off) off.addEventListener("click", async () => {
      off.disabled = true;
      try { await window.BuckyPush.disable(); toast("Alerts are off on this phone."); renderLocker(); }
      catch (err) { off.disabled = false; toast("Couldn't turn alerts off."); }
    });
  }

  UI.renderLocker = renderLocker;
  async function renderLocker() {
    const teamId = UI.lockerTeamId;
    const T = LG.teamById(teamId);
    if (!T) { main().innerHTML = `<div class="card"><p class="mut">Team not found.</p></div>`; return; }
    main().innerHTML = `<div class="card mut">Loading locker…</div>`;
    const d = D();
    simProjEnsureAndRepaint("locker"); // 2025 season replay — see startData(); covers
                                                  // the lineup rows' "proj" figures below
    const isOwner = LG.myTeamId() === teamId;
    const [standings, tx, wall, scheduleRows, roster, rivalries, recordBook] = await Promise.all([
      LG.loadStandings(), LG.loadTx(), lockerWallMessages(T), lockerScheduleRows(teamId), LG.ensureRoster(UI.week, teamId),
      lockerRivalries(teamId), LG.recordBook(),
    ]);
    // S7: the season's own GFFL playoff trophy lives on the team doc (advanceBracket writes it
    // the moment a champion's crowned — long before any January history import would pick it
    // up), so it's merged in alongside the S6 history banners here rather than waiting a year.
    // Dedupe by season, in case a January import ever re-adds the same season from history.
    const historyBanners = (recordBook.champs || []).filter((c) => c.teamId === teamId);
    const liveBanners = (T.trophies || []).filter((tr) => tr.kind === "champion").map((tr) => ({ season: tr.year, teamId, name: T.name }));
    const bannerSeasons = new Set(historyBanners.map((b) => b.season));
    const banners = [...historyBanners, ...liveBanners.filter((b) => !bannerSeasons.has(b.season))].sort((a, b) => a.season - b.season);
    const st = standings[teamId] || { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    const rows = [...LG.teams].sort((a, b) => { const A = standings[a.id] || { w: 0, pf: 0 }, B = standings[b.id] || { w: 0, pf: 0 }; return (B.w - A.w) || (B.pf - A.pf); });
    const place = rows.findIndex((t) => t.id === teamId) + 1;
    // THE TROPHY CASE (2026-08-12, user: "add a trophy case to each My Team page, Champion,
    // Runner Up and Point total champion" — plus the Toilet Bowl, which their own award
    // history carries and this family celebrates). It SUPERSEDES the plain Championships
    // card: the champion shelf keeps reading the merged `banners` above (hist champions +
    // live trophies, deduped by season — so a January import and advanceBracket can never
    // double-count), while the other shelves read the team doc's own trophies[]
    // ({year, kind}: "runnerup" | "points" | "toilet"). Every icon is inline SVG — the
    // zero-emoji app-chrome rule. A team with nothing on the shelf gets NO card, not an
    // empty cabinet. Points Champion is REGULAR SEASON points only (the award history's own
    // rule; the data loader derives it that way).
    const TROPHY_KINDS = [
      { kind: "champion", label: "League Champion", cls: "tk-champ",
        icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M7 6H4.5a3 3 0 0 0 3 4M17 6h2.5a3 3 0 0 1-3 4"/><path fill="currentColor" d="M11 14h2v3h-2z"/><path fill="none" stroke="currentColor" stroke-width="1.7" d="M8 19.5h8"/></svg>' },
      { kind: "runnerup", label: "Runner-Up", cls: "tk-silver",
        icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="14.5" r="5.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M8.5 10 6 3.5h4L12 8l2-4.5h4L15.5 10"/><path fill="currentColor" d="M11.2 17.5v-4.2l-1.4.9v-1.3l1.6-1h1.2v5.6z"/></svg>' },
      { kind: "points", label: "Points Champion", cls: "tk-points",
        icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M4 19.5h16"/><path fill="currentColor" d="M5.5 13h3v4.5h-3zM10.5 9h3v8.5h-3zM15.5 5h3v12.5h-3z"/></svg>' },
      { kind: "toilet", label: "Toilet Bowl Champion", cls: "tk-toilet",
        icon: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M8 3.5h5v6h-5zM6 11.5h12a6 6 0 0 1-6 6h-1.5l.8 3H8l.5-3.4A6 6 0 0 1 6 11.5Z"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M9.5 6.2h2"/></svg>' },
    ];
    const trophyCaseHtml = () => {
      const byKind = { champion: banners.map((b) => b.season) };
      for (const tr of (T.trophies || [])) {
        if (tr.kind === "champion") continue; // already merged into banners, deduped
        (byKind[tr.kind] = byKind[tr.kind] || []).push(tr.year);
      }
      const shelves = TROPHY_KINDS.filter((k) => (byKind[k.kind] || []).length).map((k) => {
        const years = [...new Set(byKind[k.kind])].sort((a, b) => b - a);
        return `<div class="tcshelf ${k.cls}">${k.icon}<b class="tclabel">${k.label}</b>
          ${years.length > 1 ? `<span class="tccount">×${years.length}</span>` : ""}
          <span class="tcyears">${years.map((y) => `<span class="trophyline">${y}</span>`).join("")}</span></div>`;
      });
      return shelves.length ? `<div class="card trophycase"><h2>Trophy case</h2>${shelves.join("")}</div>` : "";
    };
    const teamTx = tx.filter((t) => t.teamId === teamId || (t.type === "trade" && (t.detail.from === teamId || t.detail.to === teamId)));
    // S3: NOTHING here reads T.colors. The one derivation clamps for contrast and hands back
    // both the raw picks (what the swatches must show) and the safe rendered set.
    const pal = LG.teamPalette(T);
    const logoSrc = teamSrc(T);

    // Owner-only editable lineup — the exact tap-to-swap mechanic the old "team" page had,
    // operating on the SAME `roster` array (mutated in place by doMove/swap below, then
    // persisted with LG.saveRoster).
    let rosterHtml;
    if (isOwner) {
      const slots = starterSlotList();
      const taken = new Set();
      const starters = slots.map((s) => {
        for (const p of roster) if (p.slot === s && !taken.has(p)) { taken.add(p); return { slot: s, p }; }
        return { slot: s, p: null };
      });
      const bench = roster.filter((p) => p.slot === "BENCH");
      const ir = roster.filter((p) => p.slot === "IR");
      const irMax = (LG.rules.roster && LG.rules.roster.IR) || 0;
      // Split row (2026-08-08): tapping a FILLED slot used to open the swap sheet directly — a
      // row that both informs and acts. Now the row's player-info area (.linfo) opens the
      // stats card and a distinct .lswap button carries the swap affordance, so viewing a
      // player never requires committing to changing the lineup. An EMPTY slot has no player
      // to show a card for, so it stays a single tap-to-fill button, unchanged.
      // Item 9 (2026-08-09 playtest: "we dont need the word locked we just need to gray out
      // the swap button"). The LOCKED word is gone — a disabled Swap button says the same
      // thing in the place the reader would have acted, and it gives the row's ~60px back to
      // the player's name (item 8). .lrow.locked keeps dimming the row; openSwap keeps its own
      // lock guard as defence for every other path into it (an empty slot's candidate list, a
      // bumped starter), which a disabled button can no longer reach.
      const rowHtml = (slot, p, idx) => p
        ? `<div class="lrow ${playerLocked(p) ? "locked" : ""}${hasBall(p) ? " hasball" : ""}" data-slot="${slot}" data-idx="${idx}">
            <span class="slotchip" data-pos="${slotPos(slot)}">${slot}</span>
            <button type="button" class="linfo" data-pk="${esc(p.key)}">
              <span class="lname"><b>${escn(p.name)}</b> <small class="mut">${esc(p.pos)} · ${esc(p.team)}${injChip(d, p)}</small></span>
              <span class="lpts">${LG.fmtPts(d.livePts(p.key))}<small class="mut"> · proj ${LG.fmtPts(d.projFor(p.key))}</small></span>
            </button>
            <button type="button" class="lswap" data-slot="${slot}" data-idx="${idx}"${playerLocked(p)
              ? ' disabled title="Game started — this slot is locked" aria-label="Swap unavailable — this game has started"' : ""}>Swap</button>
          </div>`
        : `<div class="lrow" data-slot="${slot}" data-idx="${idx}">
            <span class="slotchip" data-pos="${slotPos(slot)}">${slot}</span>
            <button type="button" class="lswap lswapfill" data-slot="${slot}" data-idx="${idx}"><span class="mut">Empty — tap to fill</span></button>
          </div>`;
      rosterHtml = `
        <div class="card"><h2>Lineup — week ${UI.week}</h2><p class="mut small">Tap a player for their stats, or Swap to change the lineup. A greyed-out Swap means that game has started.</p>
          <div id="lockerStarters">${starters.map((s, i) => rowHtml(s.slot, s.p, i)).join("")}</div></div>
        <div class="card"><h2>Bench</h2><div id="lockerBench">${bench.length ? bench.map((p, i) => rowHtml("BENCH", p, i)).join("") : '<p class="mut">Empty bench.</p>'}</div></div>
        <div class="card"><h2>IR <span class="mut">(${ir.length}/${irMax})</span></h2>
          <div id="lockerIR">${ir.length ? ir.map((p, i) => rowHtml("IR", p, i)).join("") : '<p class="mut">Nobody stashed.</p>'}</div></div>`;
    } else {
      // Read-only — no swap affordance to split out, so the whole row (data-pk) opens the
      // stats card (item 1's "locker/My-Team roster rows").
      rosterHtml = `<div class="card"><h2>Roster — week ${UI.week}</h2>${roster.length ? `<div class="panner"><table class="tbl"><tbody>
        ${roster.map((p) => `<tr data-pk="${esc(p.key)}"><td>${esc(p.slot)}</td><td>${escn(p.name)}</td><td class="mut">${esc(p.pos)} · ${esc(p.team)}</td></tr>`).join("")}
      </tbody></table></div>` : '<p class="mut">No roster yet.</p>'}</div>`;
    }

    main().innerHTML = `
      <div class="lockerhead" style="${esc(LG.palStyle(pal))}">
        ${isOwner || isCommish() ? `<button id="lockerEditToggle" class="lockerpencil" aria-label="Edit team" aria-expanded="false" title="Edit team">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
        </button>` : ""}
        <div class="lockerhead-inner">
          ${logoSrc ? `<img class="lockerlogo${isCutoutLogo(logoSrc) ? " cutout" : ""}" src="${esc(logoSrc)}" alt="">` : `<div class="lockerlogo lockerlogo-ph">${esc(initials(T.name))}</div>`}
          <div class="lockerid">
            <h1 class="lockername tname big">${esc(T.name)}</h1>
            <p class="lockermotto">${T.motto ? esc(T.motto) : (isOwner ? '<span class="mut">Add a motto →</span>' : "")}</p>
            <p class="lockerrec">#${place} · ${st.w}-${st.l}${st.t ? "-" + st.t : ""} · ${LG.fmtNum(st.pf)} PF</p>
          </div>
        </div>
        <div class="lockerfoot" hidden>
        <div class="lockeredit"${isOwner || isCommish() ? "" : " hidden"}>
          <button id="lockerEditName">Name</button>
          <button id="lockerEditMotto">Motto</button>
          <button id="lockerEditLogo">Logo</button>
          ${isOwner ? "" : `<button id="lockerPinReset" class="lockerpin">Reset owner PIN</button>`}
          <input type="file" accept="image/*" id="lockerLogoInput" hidden></div>
        <div class="lockercolors" id="lockerColors"${isOwner || isCommish() ? "" : " hidden"}>
          <span class="tclabel">Colours</span>
          <span class="tcstate mut small">${pal.custom ? "hand-picked" : (pal.isDefault ? "league default" : "from the logo")}</span>
          <label class="tcslot"><input type="color" class="tcswatch" data-slot="primary" value="${esc(pal.raw.primary)}" aria-label="Primary colour" title="Primary"><span>1</span></label>
          <label class="tcslot"><input type="color" class="tcswatch" data-slot="secondary" value="${esc(pal.raw.secondary)}" aria-label="Secondary colour" title="Secondary"><span>2</span></label>
          <label class="tcslot"><input type="color" class="tcswatch" data-slot="tertiary" value="${esc(pal.raw.tertiary)}" aria-label="Tertiary colour" title="Tertiary"><span>3</span></label>
          <button id="lockerColorReset" class="tcreset" title="Re-read this team's colours from its logo">↺</button>
        </div>
        </div>
      </div>
      ${trophyCaseHtml()}
      ${rosterHtml}
      ${alertsCardHtml(T, isOwner)}
      <div class="card"><h2>Schedule</h2><div class="panner"><table class="tbl">
        <thead><tr><th>Wk</th><th>Opp</th><th class="num">Result</th></tr></thead>
        <tbody>${scheduleRows}</tbody></table></div></div>
      <div class="card"><h2>Transactions</h2>${teamTx.length ? teamTx.map((t) => `<div class="fline sys"><span class="mut">${new Date(t.t).toLocaleDateString()}</span> ${esc(txSentence(t))}</div>`).join("") : '<p class="mut">No moves yet.</p>'}</div>
      ${"" /* the Championships card is SUPERSEDED by the Trophy case above (2026-08-12) */}
      <div class="card"><h2>Rivalries</h2>${rivalries.length ? `<div class="panner"><table class="tbl">
          <thead><tr><th>Opponent</th><th class="num">W</th><th class="num">L</th><th class="num">T</th></tr></thead>
          <tbody>${rivalries.map((r) => `<tr><td><span class="teamlink" data-locker="${r.id}">${esc(r.name)}</span></td>
            <td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.t}</td></tr>`).join("")}</tbody></table></div>`
        : '<p class="mut">No history against current opponents yet.</p>'}</div>
      <div class="card"><h2>The wall</h2>${wall.length ? wall.map((m) => chatMsgHtml(m, new Map(), LG.myTeamId())).join("") : "<p class=\"mut\">Nobody's mentioned them yet.</p>"}</div>`;
    document.querySelectorAll(".chatImg").forEach((img) => img.addEventListener("click", () => openImageOverlay(img.dataset.full)));
    wireLockerTaps();
    wirePlayerCardTaps(); // owner's .linfo buttons + every other team's read-only roster rows
    // Wired on EVERY locker, commissioner or not (S1). A hidden button is still clickable from
    // devtools, so the PIN — not the `hidden` attribute — is what actually refuses; leaving the
    // non-commissioner's copy unwired would only hide the gate, not add one.
    wireLockerEdit(T, isOwner);
    if (!isOwner) wireLockerPinReset(T);
    if (isOwner) { wireLockerLineup(teamId, roster); wireAlertsCard(T); maybeOfferOwnerPin(T); }
    paintHealth();
    fitHeroNames(); hookFitOnFonts(); // the hero name fits, never clips
  }
  // S1 GRANDFATHERING. Devices that claimed a team before owner PINs existed stay valid — the
  // local claim is never revoked — but the team has no lock on it, so the next device to tap it
  // could take it. The owner is offered one, once, on their own locker.
  // Deliberately keyed on the team doc's own `claimedBy`: a team nobody has ever claimed has no
  // owner to ask, and this must never fire for a device whose claim exists only in localStorage.
  // The "asked" flag is set BEFORE the prompt, so declining is free and a repaint mid-prompt
  // can't ask twice.
  async function maybeOfferOwnerPin(T) {
    if (!T || !T.claimedBy) return;
    if (LG.mirrorOffline) return; // read-only session: the write could only fail
    const k = "gffl_pinask_" + T.id;
    try { if (sessionStorage.getItem(k) === "1") return; } catch (e) { return; }
    let have = "";
    try { have = await LG.teamPinHash(T.id); } catch (e) { return; }
    if (have) return;
    try { sessionStorage.setItem(k, "1"); } catch (e) {}
    const pin = window.prompt("Protect your team — set a PIN (numbers, 4+ digits):");
    if (!pin) return;
    if (!LG.validPin(pin)) { window.alert("A PIN needs at least 4 numbers."); return; }
    try { await LG.setTeamPin(T.id, pin); await LG.loadTeams(); toast("PIN set — another device needs it to claim " + T.name + "."); }
    catch (e) { toast("Couldn't save that PIN."); }
  }
  // S1 COMMISSIONER RESET — the way back in when an owner forgets their PIN, or a team changes
  // hands. Clears the hash; the next claim runs the first-claim flow and sets a fresh one.
  function wireLockerPinReset(T) {
    const b = $("#lockerPinReset");
    if (!b) return;
    b.addEventListener("click", async () => {
      if (!(await LG.gateCommish())) return;
      if (!window.confirm("Reset the owner PIN for " + (T.name || "this team") + "? Whoever claims it next will set a new one.")) return;
      try { await LG.clearTeamPin(T.id); await LG.loadTeams(); toast((T.name || "That team") + "'s owner PIN was reset."); }
      catch (e) { toast("Couldn't reset that PIN."); }
    });
  }
  // The tap-to-swap sheet, operating on THIS locker's `roster` array — same mechanic the old
  // "team" page had, just scoped as its own wiring function so renderLocker's owner branch
  // stays readable.
  function wireLockerLineup(tid, ros) {
    const d = D();
    // Split (2026-08-08): .lswap (a filled row's own swap button, or the whole button for an
    // empty slot) opens the swap sheet; .linfo (wired separately by wirePlayerCardTaps, above)
    // opens the stats card. Both live inside the same .lrow now, so each needs its own
    // stopPropagation — not that .lrow itself listens for anything any more, but a future
    // wrapper listener should never have to guess which of the two this bubbled from.
    document.querySelectorAll(".lswap").forEach((b) => b.addEventListener("click", (e) => {
      e.stopPropagation();
      openSwap(b.dataset.slot, Number(b.dataset.idx));
    }));
    const slots = starterSlotList();
    const taken = new Set();
    const starters = slots.map((s) => {
      for (const p of ros) if (p.slot === s && !taken.has(p)) { taken.add(p); return { slot: s, p }; }
      return { slot: s, p: null };
    });
    const bench = ros.filter((p) => p.slot === "BENCH");
    const ir = ros.filter((p) => p.slot === "IR");
    const irMax = (LG.rules.roster && LG.rules.roster.IR) || 0;
    // S10 (2026-08-11): the swap flow is the SAME centered card as the add/claim flow — one
    // component, one modal contract, one row layout with the same PROJ and OWN columns. The
    // bottom sheet it replaces is gone.
    // ITEM 32's contract is unchanged: openRosterCard registers ONE sentinel (so Back closes
    // the card and leaves the reader in the locker); every row in it, Cancel included, hands
    // that entry straight back so the following Back moves them to the previous VIEW.
    function closeSwap() { UI.closeRosterCard(); }
    function openSwap(slot, idx) {
      let cur = null;
      if (slot === "BENCH") cur = bench[idx];
      else if (slot === "IR") cur = ir[idx];
      else cur = (starters[idx] || {}).p || null;
      if (cur && playerLocked(cur)) { toast(cur.name + "'s game already started."); return; }
      // A bench tap picks a DESTINATION SLOT, not a player, so those rows carry no projection
      // or ownership — there is no player on them to have any.
      if (slot === "BENCH" && cur) {
        const opts = starterSlotList().filter((s) => LG.slotEligible(cur.pos, s));
        const irOk = ir.length < irMax && LG.irEligible((d.S.players.get(cur.key) || {}).injury || cur.injury);
        openRosterCard(`<div class="pccard rccard">
          <button type="button" class="pcclose" id="rcClose" aria-label="Close">✕</button>
          <div class="pchead"><h2 class="pcname">Move ${escn(cur.name)}</h2>
            <div class="pcmeta"><span class="posbadge" data-pos="${esc(cur.pos)}">${esc(cur.pos || "?")}</span>
              <span class="mut">${esc(cur.team || "")}</span>${injChip(d, cur)}</div></div>
          <h2 class="rcq">Move him where?</h2>
          <div class="rclist">
            ${[...new Set(opts)].map((s) => `<button type="button" class="swaprow rcslot" data-to="${s}">→ ${s}</button>`).join("")}
            ${irOk ? '<button type="button" class="swaprow rcslot" data-to="IR">→ IR</button>' : ""}
          </div>
          <div class="rcfoot"><button type="button" class="rcghost" data-to="">Cancel</button></div>
        </div>`);
        $("#rosterCard").querySelectorAll("[data-to]").forEach((b) => b.addEventListener("click", () => {
          closeSwap();
          if (b.dataset.to) doMove(cur, b.dataset.to);
        }));
        return;
      }
      // ⚠ A LOCKED CANDIDATE IS SHOWN, DISABLED, WITH THE REASON — it used to be filtered out
      // of the list entirely, so a player the reader was looking for simply wasn't there and
      // nothing said why. That is exactly the confusion item 9 fixed on the lineup row's own
      // Swap button; the same answer belongs here. A disabled button fires no click, so the
      // `cands` indices the handler below reads stay aligned with what is rendered.
      let cands;
      if (slot === "IR") cands = ros.filter((p) => p.slot !== "IR" && LG.irEligible((d.S.players.get(p.key) || {}).injury || p.injury));
      else if (slot === "BENCH") cands = []; // bench taps: move the player somewhere else via their target slot instead
      else cands = ros.filter((p) => p !== cur && (p.slot === "BENCH" || p.slot === "IR") && LG.slotEligible(p.pos, slot));
      openRosterCard(`<div class="pccard rccard">
        <button type="button" class="pcclose" id="rcClose" aria-label="Close">✕</button>
        <div class="pchead"><h2 class="pcname">${esc(slot)}</h2>
          <div class="pcmeta mut">${cur ? "Swap out " + escn(cur.name) : "Fill the slot"}</div></div>
        <h2 class="rcq">Who goes in?</h2>
        ${cands.length ? rcHeadHtml() : ""}
        <div class="rclist">${cands.length
          ? cands.map((p, i) => rcRowHtml(p, `data-ci="${i}"`, { blocked: playerLocked(p) ? "Game started" : "" })).join("")
          : '<p class="mut">Nobody eligible.</p>'}</div>
        <div class="rcfoot"><button type="button" class="rcghost" data-ci="">Cancel</button></div>
      </div>`);
      // ONE batched percent-owned call per open, then a text-only repaint (never a rebuild).
      ensurePctOwned(cands.map((p) => p.key)).then(paintPctOwned).catch(() => {});
      $("#rosterCard").querySelectorAll("[data-ci]").forEach((b) => b.addEventListener("click", async () => {
        closeSwap();
        if (b.dataset.ci === "") return;
        const incoming = cands[Number(b.dataset.ci)];
        await swap(cur, incoming, slot);
      }));
    }
    // A lineup tap used to write this page's CACHED roster array back wholesale — so a tab
    // left open across a processed waiver or an executed trade silently reverted it, with the
    // FAAB still spent and the transaction log still narrating the move (adversarial review
    // 2026-08-08, finding 4). Re-read the roster FRESH and carry only the SLOT ASSIGNMENTS
    // across by player key: anyone added since keeps their own slot, anyone dropped since
    // stays dropped, and this tap changes only what it meant to change.
    async function persistLineup() {
      const fresh = await LG.loadRoster(UI.week, tid, { fresh: true });
      if (!fresh || !fresh.length) { await LG.saveRoster(UI.week, tid, ros); return; }
      const slotBy = new Map(ros.map((p) => [p.key, p.slot]));
      await LG.saveRoster(UI.week, tid, fresh.map((p) => (slotBy.has(p.key) ? { ...p, slot: slotBy.get(p.key) } : p)));
    }
    async function doMove(p, toSlot) {
      if (toSlot === "IR" && ir.length >= irMax) { toast("IR is full (" + irMax + ")."); return; }
      if (toSlot !== "IR" && toSlot !== "BENCH") {
        const occ = starters.filter((s) => s.slot === toSlot).map((s) => s.p).filter(Boolean);
        const room = (LG.rules.roster[toSlot] || 0) - occ.length;
        if (room <= 0) {
          const bumped = occ[occ.length - 1];
          if (playerLocked(bumped)) { toast(bumped.name + " is locked in."); return; }
          bumped.slot = "BENCH";
        }
      }
      p.slot = toSlot;
      await persistLineup();
      await loadWeekRosters(); // keep the league-wide roster cache (trade builder, matchup, etc.) in sync
      renderLocker();
    }
    async function swap(outP, inP, slot) {
      if (inP.slot === "IR" && outP == null) { /* leaving IR into a starter slot directly */ }
      inP.slot = slot;
      if (outP) outP.slot = "BENCH";
      await persistLineup();
      await loadWeekRosters();
      renderLocker();
    }
  }

  async function lgFn(action, extra) {
    const r = await fetch("/.netlify/functions/league", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: LG.PASS, action, ...(extra || {}) }),
    });
    return r.json();
  }
  UI.lgFn = lgFn;
  // ---------------- import failures must be VISIBLE (live bug, 2026-08-08) ----------------
  // "The import isn't working" came with nothing on screen at all. Two silent-failure shapes
  // were live: (a) every importer started with `$("#importOut").innerHTML = …`, which THROWS
  // on a null element (the first-run card calls importFromEspn() straight after UI.show("rules")
  // — one missing/renamed container and the tap does nothing, forever, with no error a user can
  // see); and (b) the whole APPLY half (saveRules/saveTeam/saveRoster/db.set) had no catch at
  // all, so a rejected write — exactly what a degraded backend produces — left the button dead.
  // importOut() can never return null, and importFail() always paints something.
  function importOut() {
    let el = $("#importOut");
    if (!el && main()) { el = document.createElement("div"); el.id = "importOut"; main().appendChild(el); }
    return el || { set innerHTML(_v) {} }; // last resort: swallow rather than throw mid-import
  }
  function importFail(out, label, e) {
    const why = String((e && e.message) || e || "?");
    out.innerHTML = `<div class="card bad"><b>${esc(label)}</b><br>${esc(why)}
      <p class="mut small">Nothing was half-applied that a re-run won't fix — try again once the
      connection is back.</p></div>`;
    toast(label);
  }
  UI._importFail = importFail; // test hook
  async function importFromEspn() {
    const out = importOut();
    out.innerHTML = '<div class="card mut">Importing the real league from ESPN…</div>';
    let j;
    try { j = await lgFn("lg_espn_settings"); } catch (e) { j = { ok: false, reason: String(e) }; }
    if (!j.ok) { out.innerHTML = `<div class="card bad">Import failed: ${esc(j.reason || "?")}</div>`; return; }
    const next = JSON.parse(JSON.stringify(LG.rules));
    // REPLACE, don't merge (adversarial review 2026-08-08, finding 11). Object.assign left
    // every scoring key the real ESPN league does NOT configure sitting at its GFFL DEFAULT —
    // and the family league scores field goals ONLY by made-yards (statId 214), carrying no
    // conventional FG-made ids at all, so fg_0_39/40_49/50 survived at 3/4/5 alongside the
    // imported 0.1/yd and D.score() paid BOTH. That's ~+12 points on an ordinary kicker day,
    // every kicker, every week, straight into the write-once weekly doc. A key the real
    // league doesn't score is a key worth ZERO here; the import is the league's own rules,
    // not a patch over ours.
    const zeroed = {};
    for (const k of new Set([...Object.keys(LG.DEFAULT_RULES.scoring), ...Object.keys(next.scoring || {})])) zeroed[k] = 0;
    next.scoring = { ...zeroed, ...(j.scoring || {}) };
    // Roster slots from ESPN, but the GFFL decisions stay: 3 IR (user call).
    if (j.slots && Object.keys(j.slots).length) {
      next.roster = { ...j.slots };
      if (next.roster["Bench"] != null) { next.roster.BENCH = next.roster["Bench"]; delete next.roster["Bench"]; }
      next.roster.IR = 3;
    }
    if (j.regularSeasonWeeks) next.seasonWeeks = j.regularSeasonWeeks;
    if (j.trade && j.trade.reviewHours != null) next.trades.reviewHours = j.trade.reviewHours;
    if (j.trade && j.trade.vetoVotesRequired != null) next.trades.vetoVotes = j.trade.vetoVotesRequired;
    const changes = LG.diffRules(LG.rules, next);
    out.innerHTML = `<div class="card"><h2>ESPN import — ${esc(j.leagueName || "")} (${j.season})</h2>
      <p class="mut small">Scoring is REPLACED by the real league's own values — any rule ESPN
        doesn't score drops to 0, and every one of those is listed below.</p>
      ${changes.length ? `<small>${changes.map(esc).join("<br>")}</small>` : '<p class="mut">Everything already matches.</p>'}
      ${j.unmapped && j.unmapped.length ? `<p class="warn">Unmapped scoring items (review): ${esc(JSON.stringify(j.unmapped))}</p>` : '<p class="mut">Every ESPN scoring item mapped cleanly.</p>'}
      <button id="importApply" class="primary">Apply</button></div>`;
    $("#importApply").addEventListener("click", async () => {
      const btn = $("#importApply");
      if (btn) { btn.disabled = true; btn.textContent = "Applying…"; }
      try {
        await LG.saveRules(next, LG.who() + " (ESPN import)");
        // Seed/refresh the 8 teams too.
        for (const t of (j.teams || [])) {
          await LG.saveTeam({ teamId: t.id, name: t.name, abbrev: t.abbrev, logo: t.logo, owner: t.owner });
        }
        await LG.loadTeams();
      } catch (e) { importFail(importOut(), "Couldn't save the imported league", e); return; }
      toast("Rules + teams imported.");
      // Fresh league: the importer hasn't claimed a team yet — go straight to
      // the claim screen instead of leaving them on the rules page.
      if (!LG.myTeamId()) { UI.boot(); return; }
      renderRules();
    });
  }
  // Shared by importRosters()/importTestRosters()/runTestSeasonSetup() — same shape from
  // lg_espn_rosters and lg_espn_rosters_season, same slotting rule. `week` defaults to
  // UI.week (every existing caller's behavior, byte-for-byte); the 2025 replay's own setup
  // passes an explicit 1 — it seeds WEEK 1 regardless of whichever week UI.week happens to be
  // showing at that moment (LG.ensureRoster copies forward lazily from there).
  async function applyImportedRosters(j, week) {
    const wk = week != null ? week : UI.week;
    const slots = starterSlotList();
    for (const t of (j.teams || [])) {
      const taken = {};
      const players = (t.players || []).map((p) => {
        let slot = "BENCH";
        const want = p.lineupSlot === "IR" ? "IR" : slots.find((s) => LG.slotEligible(p.pos, s) && (taken[s] = (taken[s] || 0)) < (LG.rules.roster[s] || 0) && ++taken[s]);
        if (p.lineupSlot === "IR") slot = "IR";
        else if (want) slot = want;
        return {
          key: p.pos === "DST" ? "dst_" + D().slpTeam(p.proTeam) : String(p.espnId),
          name: p.name, pos: p.pos, team: p.proTeam, slot, injury: p.injury || "",
        };
      });
      await LG.saveRoster(wk, t.id, players);
    }
    UI._rosters = null;
    return (j.teams || []).length;
  }
  async function importRosters() {
    const out = importOut();
    out.innerHTML = '<div class="card mut">Importing current ESPN rosters…</div>';
    let j;
    try { j = await lgFn("lg_espn_rosters"); } catch (e) { j = { ok: false, reason: String(e) }; }
    if (!j.ok) { out.innerHTML = `<div class="card bad">Import failed: ${esc(j.reason || "?")}</div>`; return; }
    let n;
    try { n = await applyImportedRosters(j); } catch (e) { importFail(out, "Couldn't save the imported rosters", e); return; }
    out.innerHTML = `<div class="card ok">Rosters imported for ${n} teams (week ${UI.week}).</div>`;
  }
  //  Test-run rosters (2026-08-08): the real ${LG.rules.season} ESPN league is pre-draft
  // (every roster empty) until the season starts, so there's nothing real to exercise lineups/
  // waivers/trades/scoring against yet. This seeds this week's GFFL rosters from the real,
  // FINAL 2025 season instead — same slotting logic, same wire shape, a completely separate
  // server action (lg_espn_rosters_season) so the LIVE-season importer above stays untouched.
  async function importTestRosters() {
    const out = importOut();
    out.innerHTML = '<div class="card mut">Importing 2025 rosters for a test run…</div>';
    let j;
    try { j = await lgFn("lg_espn_rosters_season", { season: 2025 }); } catch (e) { j = { ok: false, reason: String(e) }; }
    if (!j.ok) { out.innerHTML = `<div class="card bad">Test import failed: ${esc(j.reason || "?")}</div>`; return; }
    let n;
    try { n = await applyImportedRosters(j); } catch (e) { importFail(out, "Couldn't save the imported test rosters", e); return; }
    out.innerHTML = `<div class="card ok">Test rosters imported from the real 2025 season for ${n} teams
      (week ${UI.week}). These are for testing — re-import real ${LG.rules.season} rosters once the
      season starts.</div>`;
  }
  // ---------------- ⭐ ITEM 31: fill every roster from the backup pool (2026-08-09) ----------
  // A real, re-runnable, commissioner-gated ACTION rather than a one-off script — it has to be
  // auditable, repeatable and testable, and a pick that turns out badly has to be fixable by
  // running it again. Two steps on purpose: the first tap only ever SHOWS what is about to be
  // destroyed (which teams, which week, how many players each carries right now, and a sample
  // of the names). A bare button that silently overwrote eight rosters would be the wrong
  // shape for the most destructive action in the app.
  async function backupFillState() {
    const wk = UI.week;
    const teams = LG.teams.slice().sort((a, b) => a.id - b.id);
    const rows = [];
    for (const t of teams) {
      const ros = (await LG.loadRoster(wk, t.id)) || [];
      rows.push({ id: t.id, name: t.name, n: ros.length, sample: ros.slice(0, 3).map((p) => LG.shortName(p.name)) });
    }
    return { week: wk, rows };
  }
  async function renderBackupFillConfirm() {
    const out = importOut();
    out.innerHTML = '<div class="card mut">Reading the current rosters…</div>';
    const st = await backupFillState();
    const have = st.rows.filter((r) => r.n > 0);
    const list = st.rows.map((r) => `<div class="rowline"><span>${esc(r.name)}</span>
      <span class="mut small">${r.n ? r.n + " player" + (r.n === 1 ? "" : "s") + (r.sample.length ? " · " + esc(r.sample.join(", ")) + "…" : "") : "empty"}</span></div>`).join("");
    out.innerHTML = `<div class="card"><h2>Fill rosters with backups</h2>
      <p>This REPLACES week ${st.week}'s rosters for all ${st.rows.length} teams with NFL second
        and third stringers, drafted evenly in a snake so nobody gets a lopsided team.</p>
      ${have.length ? `<p class="warn">The ${have.length} roster${have.length === 1 ? "" : "s"} below
        will be overwritten. Every player currently on them is dropped.</p>` : '<p class="mut">No team has a roster for this week yet.</p>'}
      ${list}
      <p class="mut small">Nothing else is touched — the schedule, standings, chat, transactions
        and every other week's rosters all stay exactly as they are. Run it again any time.</p>
      <div class="rowline"><button id="backupsGo" class="primary">Replace rosters with backups</button>
        <button id="backupsCancel">Cancel</button></div></div>`;
    $("#backupsCancel").addEventListener("click", () => { importOut().innerHTML = ""; });
    $("#backupsGo").addEventListener("click", async () => {
      const btn = $("#backupsGo");
      if (btn) { btn.disabled = true; btn.textContent = "Filling…"; }
      try { await runBackupFill(); } catch (e) { importFail(importOut(), "Couldn't fill the rosters", e); }
    });
  }
  UI.renderBackupFillConfirm = renderBackupFillConfirm; // test hook
  async function runBackupFill() {
    const out = importOut();
    out.innerHTML = '<div class="card mut">Reading the NFL depth charts…</div>';
    const d = D();
    // The pool comes out of the Sleeper directory, which the app loads once per session — this
    // waits on that SAME memoized promise rather than fetching anything of its own.
    await d.initSleeper();
    const pool = d.backupPool();
    if (!pool) { out.innerHTML = '<div class="card bad">The NFL player directory hasn\'t loaded — nothing was changed. Try again once it has.</div>'; return; }
    if (!pool.players.length) { out.innerHTML = '<div class="card bad">No second- or third-string players found in the directory — nothing was changed.</div>'; return; }
    const built = LG.buildBackupRosters({
      teamIds: LG.teams.map((t) => t.id), roster: (LG.rules || LG.DEFAULT_RULES).roster,
      pool: pool.players, defenses: pool.defenses,
    });
    const wk = UI.week;
    out.innerHTML = '<div class="card mut">Saving…</div>';
    let saved = 0;
    for (const id of built.teamIds) {
      await LG.saveRoster(wk, id, built.rosters[id] || []);
      saved++;
    }
    UI._rosters = null;
    // Every roster in the league just changed, so the set of NFL teams worth polling almost
    // certainly did too — without this the new players score nothing until the next page load
    // (see retrackTeams' own note).
    await retrackTeams().catch(() => {});
    const counts = built.teamIds.map((id) => (built.rosters[id] || []).length);
    const even = counts.every((n) => n === counts[0]);
    out.innerHTML = `<div class="card ok"><b>Week ${wk} rosters filled from the depth charts.</b><br>
      ${saved} teams · ${counts[0]} players each${even ? "" : " (uneven: " + counts.join("/") + ")"} ·
      drafted from ${pool.players.length} backups and ${pool.defenses.length} team defenses.
      ${built.short.length ? `<p class="warn">The pool ran out at: ${esc(built.short.join(", "))} — those
        spots are short on some teams.</p>` : ""}
      <p class="mut small">Running this again against the same depth charts produces exactly the
        same rosters.</p></div>`;
    toast("Rosters filled with backups.");
  }
  UI.runBackupFill = runBackupFill; // test hook

  // One-time (plus each January — plan §4.8) ESPN history import: walk
  // seasons backward from last year, one action call each, writing
  // `hist_<season>` docs as they land. Stops at the first miss ONCE at
  // least one season has actually imported (a January re-run naturally
  // stops right after the newest already-imported season, since that's
  // the first year it now finds nothing new); before any success, gives
  // up after 3 consecutive misses (an empty/never-existed league, or the
  // real league simply doesn't go back that far) rather than grinding all
  // the way to 2015 on every miss. Re-running always overwrites — the
  // January refresh case.
  async function importHistory() {
    const out = importOut();
    const startYear = ((LG.rules && LG.rules.season) || LG.SEASON) - 1;
    const imported = [];
    let consecFails = 0;
    for (let y = startYear; y >= 2015; y--) {
      out.innerHTML = `<div class="card mut">Importing ${y}…${imported.length ? " (" + imported.length + " season" + (imported.length === 1 ? "" : "s") + " so far)" : ""}</div>`;
      let j;
      try { j = await lgFn("lg_espn_history", { season: y }); } catch (e) { j = { ok: false, reason: String(e) }; }
      if (j.ok) {
        try {
          await LG.db.set("hist_" + y, {
            kind: "hist", season: y, leagueName: j.leagueName || "",
            teams: j.teams || [], champion: j.champion || null, matchups: j.matchups || [],
          });
        } catch (e) { importFail(out, "Couldn't save the imported " + y + " season", e); return; }
        imported.push(y);
        consecFails = 0;
      } else {
        if (imported.length) break; // stop at the first miss once we've had a success
        consecFails++;
        if (consecFails >= 3) break; // give up after 3 straight misses with nothing found yet
      }
    }
    if (!imported.length) {
      out.innerHTML = '<div class="card bad">No importable seasons found (checked back from ' + startYear + ').</div>';
      return;
    }
    imported.sort((a, b) => a - b);
    const range = imported.length > 1 ? `${imported[0]}–${imported[imported.length - 1]}` : `${imported[0]}`;
    out.innerHTML = `<div class="card ok">Imported ${imported.length} season${imported.length === 1 ? "" : "s"}: ${range}.</div>`;
    // Boot-speed pass (2026-08-08): `undefined`, not `null` — recordBookHtml's own "not
    // loaded yet" sentinel, so the card goes back to its lazy "tap to load" placeholder and
    // genuinely re-fetches (via wireLazyLeagueDetails) next time it's opened, picking up the
    // history that was just imported.
    UI._recordBook = undefined;
  }
})();
