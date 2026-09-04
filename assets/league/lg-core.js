// lg-core.js — GFFL foundation: identity, storage backend, the rules doc,
// the schedule generator, and time helpers. Loaded by league.html before
// lg-data.js / lg-ui.js. Everything hangs off window.LG.
"use strict";
(function () {
  const LG = (window.LG = window.LG || {});

  // ---------------- config ----------------
  LG.PASS = "amenfarms"; // the family/league passphrase — gates the functions too
  LG.SEASON = 2026;
  // Tuesday before the NFL week-1 Thursday opener: league weeks run Tue->Mon.
  LG.SEASON_START = "2026-09-08";
  const qs = new URLSearchParams(location.search);
  LG.famKey = (qs.get("fam") || "").replace(/[^a-z0-9]/gi, "") || roomId(LG.PASS);
  LG.COLL = "gffl_" + LG.famKey;

  function roomId(s) {
    // index.html's roomId(): tiny deterministic hash -> "fam" + base36.
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
    return "fam" + Math.abs(h).toString(36);
  }

  // ---------------- ⭐ 2025 SEASON REPLAY (2026-08-08) ----------------
  // The whole app runs as WEEK 1 of the real 2025 NFL season, pinned to the Thursday morning
  // BEFORE any game kicks off: real post-draft rosters, the real week-1 NFL slate presented as
  // upcoming, real projections. This replaced the old commissioner-gated 2025 sandbox (its own
  // separate doc collection, its own switchable clock) outright — the family found the sandbox
  // unusable, and the thing they actually wanted was for the APP ITSELF to be a complete,
  // explorable week 1.
  //
  // It runs in the REAL collection. That is safe by construction because every per-season doc
  // id this file mints is already season-scoped (roster_<season>_*, weekly_<season>_*,
  // claims_<season>_*, sched_<season>, bracket_<season>, projsnap_<season>_*), so the existing
  // 2026 docs simply become invisible rather than being touched — nothing is deleted, and
  // flipping the flag back brings them all straight back. Season-NEUTRAL docs (team_<id>,
  // settings, chat, tx) are deliberately SHARED: the 8 real teams are the replay's teams.
  //
  // ⭐ SWITCHED OFF 2026-08-09 (ITEM 29) — THE APP IS THE REAL 2026 SEASON AGAIN.
  // The claim this comment used to make ("set SIM_2025_DEFAULT to false — and nothing else")
  // was AUDITED before it was trusted, and it held for exactly what it named: LG.SEASON,
  // LG.SEASON_START and LG.now() do all revert together, live polling comes back, the replay's
  // own auto-setup / phase card / projection warmers all early-return, and the 2026 docs are
  // visible again. Every LG.SIM_2025 consumer was walked; none of them needed touching.
  //
  // What the claim did NOT cover, because nothing had ever run this code in AUGUST, is
  // PRESEASON — see the season-type guard in LG.finalizeWeek and D.engineSeasonType(). Flipping
  // this flag on its own would have let the app write week 1's WRITE-ONCE regular-season record
  // from preseason box scores. That is a separate fix, in a separate place, and it is
  // permanent-season code rather than replay code: it protects the real September rollover too.
  //
  // The replay itself is NOT deleted — ?sim=1 still restores the whole 2025 week-1 experience
  // (its own season, clock, phases, historical slate and derived projections) for testing.
  const SIM_2025_DEFAULT = false;
  // ?sim=0 / ?sim=1 is a QA + preview override ONLY (same posture as ?fam=): it is never
  // persisted anywhere, so it can't leave a device stuck in the wrong season, and it survives
  // location.reload() the same way ?fam= does. The family never needs it.
  LG.SIM_2025 = qs.get("sim") === "0" ? false : qs.get("sim") === "1" ? true : SIM_2025_DEFAULT;
  if (LG.SIM_2025) {
    LG.SEASON = 2025;
    LG.SEASON_START = "2025-09-02"; // the Tuesday before the real Sept-4 2025 opener
  }
  // ---------------- ⭐ WHICH MOMENT OF WEEK 1, and a clock that RUNS (2026-08-08) ----------
  // Two named phases of the SAME week. `live` is the default — the family asked to advance to
  // the middle of week 1, with games actually in progress.
  //   · pre  — Thursday 2025-09-04, 9:00 AM America/Chicago. Nothing has kicked off. Chosen so
  //            BOTH of these hold at once (asserted, not eyeballed): currentWeek() === 1, and
  //            week 1's Wed-8am waiver deadline has already PASSED so free agency is OPEN.
  //   · live — Sunday 2025-09-07, 19:00:00Z (2:00 PM ET / 1:00 PM CT). Chosen against the REAL
  //            slate: the Thursday opener (Sep 5 00:20Z) and the Friday game (Sep 6 00:00Z) are
  //            FINAL; the Sunday early window (17:00Z) is ~2 hours in, i.e. late 3rd / early 4th
  //            quarter and LIVE; the late-afternoon window (~20:05/20:25Z) and Sunday night
  //            (Mon 00:20Z) have not kicked. That mix — some final, several live, some upcoming
  //            — is the entire point.
  // ⭐ THE ONE CONSTANT TO EDIT to change which moment the app opens on:
  const SIM_PHASE_DEFAULT = "live";
  // ITEM 18 (2026-08-09): each phase used to carry a second `banner` string for the "2025
  // SEASON REPLAY" strip. The strip is gone at the user's request, and nothing read that field
  // any more, so it went with it — `label` is what the commissioner's Rules-page switch shows.
  LG.SIM_PHASES = {
    pre: {
      id: "pre", at: Date.parse("2025-09-04T14:00:00Z"),
      label: "Thursday morning · before kickoff",
    },
    live: {
      id: "live", at: Date.parse("2025-09-07T19:00:00Z"),
      label: "Sunday afternoon · games in progress",
    },
  };
  // ?simphase=pre|live is a QA + preview override ONLY — never persisted, same posture as ?sim=
  // and ?fam=. The commissioner's own Rules-page switch DOES persist (per device), so a chosen
  // phase sticks across reloads; the URL param must not, or a shared link could strand a device.
  const SIM_PHASE_KEY = "gffl_simphase";
  LG.simPhase = function () {
    const q = (qs.get("simphase") || "").toLowerCase();
    if (LG.SIM_PHASES[q]) return q;
    let s = "";
    try { s = (localStorage.getItem(SIM_PHASE_KEY) || "").toLowerCase(); } catch (e) { /* private mode */ }
    if (LG.SIM_PHASES[s]) return s;
    return SIM_PHASE_DEFAULT;
  };
  LG.setSimPhase = function (p) {
    if (!LG.SIM_PHASES[p]) return false;
    try { localStorage.setItem(SIM_PHASE_KEY, p); } catch (e) { /* private mode — the URL param still works */ }
    return true;
  };
  LG.SIM_PHASE = LG.simPhase();
  // The phase's own starting instant. Kept under the historical name SIM_NOW because that is
  // what it still is: where the replay's clock STARTS.
  LG.SIM_NOW = LG.SIM_PHASES[LG.SIM_PHASE].at;
  // …and the clock RUNS from there. A pinned instant cannot demonstrate "live": every game would
  // sit at one frozen quarter forever. SIM_SPEED 8 means a quarter passes in ~2 real minutes and
  // the whole Sunday slate completes in ~25, which is fast enough to watch and slow enough to
  // read. ONE clock: game state, lineup locking and live stats all derive from LG.now(), so they
  // can never disagree with each other.
  //   · SIM_SPEED 0 = frozen at the phase instant — both a legitimate setting and the
  //     deterministic mode for screenshots.
  //   · ?simspeed=N is the same non-persisted QA override family as ?sim= / ?simphase=.
  const SIM_SPEED_DEFAULT = 8;
  LG.SIM_SPEED = qs.has("simspeed") ? Math.max(0, Number(qs.get("simspeed")) || 0) : SIM_SPEED_DEFAULT;
  // ⚠ PER-DEVICE AND PER-PAGE-LOAD. This is stamped when THIS TAB loaded, so simNow() below
  // restarts at the phase instant on every load and then runs at 8x only for as long as this
  // tab has been open. Two devices are therefore reading two different "now"s — a desktop tab
  // open 20 minutes is ~160 sim-minutes ahead of a phone that just opened the page.
  //
  //   LG.now()   answers "where are we in the league's SEASON?" — the current week, waiver
  //              deadlines, the trade deadline, lineup locks, game state. It is the replay
  //              clock, and being per-device is the whole point of it.
  //   Date.now() answers "when did this actually happen in the real world?" — and is the ONLY
  //              correct stamp for anything PERSISTED and then ORDERED OR COMPARED ACROSS
  //              DEVICES.
  //
  // Getting that backwards shipped a real bug (2026-08-09): chat messages were stamped with
  // LG.now(), so a message posted from a freshly-opened phone carried a timestamp ~160
  // sim-minutes EARLIER than messages already on the board and sorted to the TOP of the
  // conversation. Nothing persisted-and-cross-device-ordered may be stamped with this clock.
  LG.SIM_LOADED_AT = Date.now();
  // THE CLAMP. Leave a tab open all day and week 1 simply COMPLETES and sits there — it must
  // never roll into week 2, because every per-week doc id, the waiver deadline and the whole
  // UI would silently follow it. Two ceilings, whichever is lower:
  //   · the last kickoff + 4h (the real 2025 week-1 finale was Monday-night 2025-09-09T00:15Z;
  //     lg-data RAISES this from the slate it actually loads, never lowers it, so the clock can
  //     never jump backwards when the slate lands),
  //   · one hour before week 2 begins, which is what makes currentWeek() === 1 unconditional.
  LG.SIM_LAST_KICKOFF = Date.parse("2025-09-09T00:15:00Z");
  LG.SIM_CLAMP_PAD_MS = 4 * 3600 * 1000;
  LG.simNoteLastKickoff = function (ms) {
    if (isFinite(ms) && ms > LG.SIM_LAST_KICKOFF) LG.SIM_LAST_KICKOFF = ms;
  };
  LG.simClampAt = function () {
    // weekStart(2) is the SAME Central-resolved boundary LG.currentWeek() uses (2026-09-02, S4)
    // rather than a second, fixed-offset copy of it — the clamp's whole job is to keep
    // currentWeek() at 1, so the two must be derived from one function or they can disagree.
    const weekEnd = LG.weekStart(2);
    return Math.min(LG.SIM_LAST_KICKOFF + LG.SIM_CLAMP_PAD_MS, weekEnd - 3600 * 1000);
  };
  // The replay clock itself: where the phase started, plus real elapsed time × SIM_SPEED,
  // never past the clamp. Monotonic by construction (Date.now() is, the speed is positive, and
  // the clamp only ever rises), which is what the live feed's diffing depends on.
  LG.simNow = function () {
    const sp = Number(LG.SIM_SPEED) || 0;
    if (sp <= 0) return LG.SIM_NOW;
    const t = LG.SIM_NOW + (Date.now() - LG.SIM_LOADED_AT) * sp;
    const cap = LG.simClampAt();
    return t > cap ? cap : t;
  };

  // ---------------- identity ----------------
  // One key each, no per-mode namespacing (the old per-sandbox key suffixing died with the
  // sandbox — the 2025 replay uses the family's OWN 8 teams, so a claim genuinely carries across).
  const teamKey = () => "gffl_team";
  const whoKey = () => "gffl_who";
  LG.who = () => localStorage.getItem(whoKey()) || localStorage.getItem("choreUser") || "";
  LG.setWho = (n) => localStorage.setItem(whoKey(), n);
  LG.myTeamId = () => { const v = parseInt(localStorage.getItem(teamKey()) || "", 10); return v >= 1 ? v : null; };
  LG.setMyTeamId = (id) => localStorage.setItem(teamKey(), String(id));

  // THE TYPED GATE PASSWORD IS ITS OWN THING (2026-08-13, user: "change the password to
  // access gffl from amenfarms to thegoatleague"). LG.PASS could NOT simply change with it —
  // it is simultaneously the server functions' secret (BUCKY_NOTIFY_SECRET), the famKey seed
  // (roomId(LG.PASS) IS the Firestore collection name), and the salt inside every owner and
  // commissioner PIN hash. Changing LG.PASS would point the app at an EMPTY collection and
  // invalidate every PIN. So the gate gets its own phrase; the plumbing keeps its secret.
  LG.GATE_PASS = "thegoatleague";
  // A device already inside stays inside: choreUnlocked === LG.PASS is the family app's own
  // unlock on the shared origin (that password is unchanged), and a stored gffl_pass from
  // before the change is a SESSION, not a typed entry — grandfathered, so the whole family
  // isn't bounced to the gate by a deploy. Only the gate's INPUT demands the new phrase.
  LG.unlocked = () => localStorage.getItem("choreUnlocked") === LG.PASS ||
    [LG.GATE_PASS, LG.PASS].includes(localStorage.getItem("gffl_pass"));
  LG.tryUnlock = (phrase) => {
    if ((phrase || "").trim().toLowerCase() === LG.GATE_PASS) { localStorage.setItem("gffl_pass", LG.GATE_PASS); return true; }
    return false;
  };

  // Commissioner = Dad's PIN, same hash scheme index.html/farmgpt.html sync
  // (sha256(pin + ":" + PASS)). Session unlock flag scoped to this page.
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  LG.sha256Hex = sha256Hex; // lg-ui hashes owner PINs with the identical formula

  // ---------------- THE COMMISSIONER PIN LIVES IN THE CLOUD (S1, 2026-08-10) ----------------
  // It used to live ONLY in this device's localStorage `dadPinHash`, created on first use.
  // That was survivable on amenfarms.netlify.app, where Dad's devices already carried the hash
  // the family app had written — but the league moved to its own origin, localStorage is
  // per-origin, and on goatfantasyleague.com EVERY device starts blank. So the first kid to tap
  // a commissioner control on their own phone was offered "Set a commissioner PIN (first time)"
  // and became the commissioner. The authority has to be a fact about the LEAGUE, not about the
  // device asking.
  //
  // It gets its OWN doc (`auth`, kind "auth") rather than a field on the settings doc,
  // deliberately: the Rules editor renders the settings doc's `rules` object field-by-field and
  // writes back whatever it rendered, so a hash parked anywhere near it is one refactor away
  // from being displayed, edited, or wiped by a rules save. A separate doc cannot be reached by
  // any of that.
  //
  // POSTURE, stated plainly (unchanged, and the same as the family app's dadAuth): Firestore's
  // rules are public, so this is family-grade. It stops sibling mischief and honest mistakes,
  // not devtools. Server enforcement would be a different product.
  const AUTH_DOC = "auth";
  LG.authDoc = null;
  // ⭐ DID THE READ ANSWER? (2026-09-02, F2). A null authDoc used to mean two different things —
  // "the league has no commissioner PIN on file" and "we never heard back" — and gateCommish
  // below could not tell them apart, so ONE failed read on a device with no legacy hash offered
  // "Set a commissioner PIN (first time)" and then overwrote the real hash with whatever a kid
  // typed. Absence must be an ANSWER before anything acts on it: the same server-confirmed-
  // emptiness law this file already applies to the team list, in the one place where getting it
  // wrong hands over the league.
  LG.authRead = false;
  // Never throws. This is called from boot's Promise.all alongside rules/teams, and an auth
  // read that rejected there would turn a readable league into the outage card — the PIN is not
  // important enough to cost anyone the page. Returns TRUE iff the backend actually answered;
  // LG.authDoc still carries whatever was read (or whatever we last knew, on a failure).
  LG.loadAuth = async function (fresh) {
    try {
      LG.authDoc = (fresh ? await LG.db.getFresh(AUTH_DOC) : await LG.db.get(AUTH_DOC)) || null;
      LG.authRead = true;
    } catch (e) { LG.authRead = false; /* leave whatever we last knew */ }
    return LG.authRead;
  };
  LG.commishPinHash = () => (LG.authDoc && LG.authDoc.commishPinHash) || "";
  const legacyPinHash = () => { try { return localStorage.getItem("dadPinHash") || ""; } catch (e) { return ""; } };
  // MIGRATION — free, because LG.PASS === "amenfarms" is the same salt index.html's dadAuth
  // uses, so the hash Dad's device already carries IS the league's hash. The first time Dad
  // opens the league on a device that has it, it goes up. No re-enrolment, same PIN everywhere.
  // Runs at BOOT (not only on the first commissioner action) so the window in which a kid could
  // still seed the empty cloud field closes the moment Dad opens the app, rather than the moment
  // he happens to press a commissioner control.
  LG.migrateCommishPin = async function () {
    if (LG.commishPinHash()) return false;         // the league already has one — never overwrite
    // ⭐ AND NEVER MIGRATE OVER AN UNANSWERED READ (2026-09-02, F2). commishPinHash() reads ""
    // both when the league genuinely holds none AND when the auth read failed — so without this
    // latch a single Firestore timeout on Dad's phone would push HIS legacy hash over whatever
    // the league already had. Same rule as gateCommish below: absence has to be an answer.
    if (!LG.authRead) return false;
    const legacy = legacyPinHash();
    if (!legacy) return false;
    if (LG.mirrorOffline) return false;            // a mirror is read-only; a write here would toast and fail
    try {
      // CREATE-ONLY, for the same reason the first-time set below is: a hash written between
      // our read and this write is the league's, and a blind set would land on top of it.
      const r = await LG.db.update(AUTH_DOC, (cur) => ((cur && cur.commishPinHash) ? null : { kind: "auth", commishPinHash: legacy }));
      if (!r.ok) { LG.authDoc = r.doc || LG.authDoc; return false; } // somebody got there first — adopt theirs
      LG.authDoc = { ...(LG.authDoc || {}), kind: "auth", commishPinHash: legacy };
      return true;
    } catch (e) { return false; }
  };
  LG.commishUnlocked = () => sessionStorage.getItem("gfflCommish") === "1";
  LG.gateCommish = async function () {
    if (LG.commishUnlocked()) return true;
    // FRESH, not cached: this is the security boundary, and a hash read once at boot and then
    // held for the life of the tab is a hash a commissioner reset can't take away. One read.
    const answered = await LG.loadAuth(true);
    // ⭐ AN UNANSWERED READ IS A REFUSAL, NOT A FIRST TIME (2026-09-02, F2). Measured on the
    // pre-fix engine (scratchpad probe3_auth.cjs): with Dad's real hash on file and ONE
    // getFresh("auth") failing — a 12s Firestore timeout, one bad response mid-session — this
    // function offered "Set a commissioner PIN (first time)", took whatever a kid typed, wrote
    // it over DADS_REAL_HASH and unlocked the commissioner. The read failing tells us NOTHING
    // about whether the league has a PIN, so the only honest answer is to stop: no prompt at
    // all (a first-time prompt is itself the lie), nothing written, nothing unlocked. A device
    // that carries the legacy local hash is exempt — it can still prove itself against that,
    // which is the pre-S1 offline behaviour and costs nobody the page.
    if (!answered && !legacyPinHash()) {
      window.alert("Couldn't reach the league to check the commissioner PIN. Try again in a moment.");
      return false;
    }
    await LG.migrateCommishPin();
    // The cloud value WINS whenever there is one. A device-local hash is only consulted when
    // the league itself holds none — an offline session, or a genuine local backend (every
    // suite page), where the pre-S1 behaviour is exactly right.
    const have = LG.commishPinHash() || legacyPinHash();
    const pin = window.prompt(have ? "Commissioner PIN:" : "Set a commissioner PIN (first time):");
    if (!pin) return false;
    const h = await sha256Hex(pin + ":" + LG.PASS);
    if (!have) {
      // ⭐ FIRST-TIME SET IS CREATE-ONLY (2026-09-02, F2). It used to be an UNCONDITIONAL
      // LG.db.set — so any path that reached it with `have` empty (an unanswered read, above;
      // a doc written by another device in the seconds since our read) overwrote the league's
      // real hash rather than discovering it. The mutate aborts the moment it sees a hash on
      // file, and an abort hands back the doc it refused against, so this device can demand
      // THAT PIN instead of silently becoming the commissioner.
      let existing = null, wrote = false;
      try {
        const r = await LG.db.update(AUTH_DOC, (cur) => ((cur && cur.commishPinHash) ? null : { kind: "auth", commishPinHash: h }));
        if (r.ok) { wrote = true; LG.authDoc = { kind: "auth", commishPinHash: h }; }
        else { existing = (r.doc && r.doc.commishPinHash) || ""; LG.authDoc = r.doc || LG.authDoc; }
      } catch (e) { wrote = false; }
      if (wrote) {
        try { localStorage.setItem("dadPinHash", h); } catch (e) {}
        sessionStorage.setItem("gfflCommish", "1");
        // ACTIVITY LEDGER (2026-09-04). The one moment a league acquires a commissioner is
        // worth a row of its own, beside the unlock it also is. Unawaited, and it cannot throw.
        LG.logAct("commish_pin_set", LG.myTeamId(), { first: true });
        LG.logAct("commish_unlock", LG.myTeamId(), { first: true });
        return true;
      }
      if (existing) {
        // Somebody set one between our read and our write. The PIN just typed is judged against
        // THEIRS — if it happens to match, this device is the commissioner after all.
        if (h === existing) {
          try { localStorage.setItem("dadPinHash", h); } catch (e) {}
          sessionStorage.setItem("gfflCommish", "1");
          LG.logAct("commish_unlock", LG.myTeamId(), { raced: true });
          return true;
        }
        window.alert("Wrong PIN.");
        return false;
      }
      // ⭐ A REFUSED WRITE NEVER UNLOCKS (2026-09-02, F2, part c). The old code swallowed the
      // failure and unlocked anyway off a purely local hash — which on a read-only mirror, or
      // any offline session, handed the commissioner's controls to whoever tapped one. Nothing
      // was stored, so nothing may be claimed.
      window.alert("Couldn't save the commissioner PIN. Try again when the league is reachable.");
      return false;
    }
    if (h === have) {
      // Mirror the verified hash onto this device so a later offline session still unlocks.
      // It reveals nothing — a hash is not a PIN — and it is the same value the family app syncs.
      try { localStorage.setItem("dadPinHash", h); } catch (e) {}
      sessionStorage.setItem("gfflCommish", "1");
      // ACTIVITY LEDGER (2026-09-04) — a PIN was typed and it was right. The EARLY return at
      // the top of this function (already unlocked this session) deliberately logs nothing:
      // it is not an event, it is the absence of one, and logging it would put a row in the
      // ledger for every commissioner control pressed all afternoon.
      LG.logAct("commish_unlock", LG.myTeamId(), {});
      return true;
    }
    window.alert("Wrong PIN.");
    return false;
  };

  // ---------------- backend (Firestore, localStorage fallback) ----------------
  // One collection (LG.COLL); every doc carries {kind} so lists are queries.
  // Cloud unreachable (or blocked, as in every suite) -> local mode, same API.
  const local = {
    key: (id) => "lg_" + LG.COLL + "_" + id,
    // ---- THE VERSION KEY (2026-08-18, the CAS rework — see LG.db.update) ----
    // A doc's version lives in its OWN namespace, `lgv_<COLL>_<id>`, and deliberately NOT
    // under the doc prefix as `lg_<COLL>_<id>__v`: local.list() scans localStorage for every
    // key starting with `lg_<COLL>_` and JSON.parses it as a document, so a sibling version
    // key under that prefix would be returned from list() as a doc — a bare integer where a
    // team is expected. `lgv_` cannot collide with `lg_<COLL>_` by construction.
    vkey: (id) => "lgv_" + LG.COLL + "_" + id,
    async get(id) { const s = localStorage.getItem(this.key(id)); return s ? JSON.parse(s) : null; },
    // READ-ONLY escape hatch to a collection that is not this league's (2026-08-15). The one
    // caller is the Draft Day import: the draft board (ffdraft.html) is a separate app with
    // its own collection, ffdraft_<famKey>, and the league has to be able to read what was
    // drafted. Deliberately read-only and deliberately NOT mirrored/cached — it is somebody
    // else's data, and the league's own doc caches must never be able to answer for it.
    async foreignGet(coll, id) {
      const s = localStorage.getItem("lg_" + coll + "_" + id);
      return s ? JSON.parse(s) : null;
    },
    async set(id, data) {
      const cur = (await this.get(id)) || {};
      localStorage.setItem(this.key(id), JSON.stringify({ ...cur, ...data }));
      this.bump(id);
    },
    async del(id) { localStorage.removeItem(this.key(id)); try { localStorage.removeItem(this.vkey(id)); } catch (e) {} },
    // Every write through this backend moves the version, blind ones included — otherwise a
    // plain set() could land underneath a CAS holder and its setIf would still be accepted.
    bump(id) {
      try {
        const n = Number(localStorage.getItem(this.vkey(id)) || 0) || 0;
        localStorage.setItem(this.vkey(id), String(n + 1));
      } catch (e) { /* private mode / quota */ }
    },
    // The read half of compare-and-swap. `v` is a STRING (matching the REST backend, whose
    // version is Firestore's own `updateTime`), or null when the doc does not exist — which
    // is what setIf turns into a create-only precondition.
    async getV(id) {
      const doc = await this.get(id);
      if (!doc) return { doc: null, v: null };
      let v = null;
      try { v = localStorage.getItem(this.vkey(id)); } catch (e) {}
      return { doc, v: v == null ? "0" : String(v) };
    },
    // The write half. Refuses (rather than throws) when the version moved under us, so
    // LG.db.update can tell contention apart from a real failure. The compare, the bump and
    // the write all happen with NO await in between — localStorage is synchronous, so two
    // interleaved setIfs on one page genuinely cannot both win.
    async setIf(id, data, v) {
      const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
      if (!keys.length) return { ok: true };
      const s = localStorage.getItem(this.key(id));
      const cur = s ? JSON.parse(s) : null;
      let have = null;
      if (cur) { const raw = localStorage.getItem(this.vkey(id)); have = raw == null ? "0" : String(raw); }
      if (have !== (v == null ? null : String(v))) return { conflict: true };
      const next = { ...(cur || {}), ...data };
      localStorage.setItem(this.key(id), JSON.stringify(next));
      localStorage.setItem(this.vkey(id), String((Number(have) || 0) + 1));
      return { ok: true, doc: next };
    },
    async list(kind) {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(this.key(""))) {
          const d = JSON.parse(localStorage.getItem(k));
          // `id` LAST — a doc carrying its own stray `id` field must never clobber its real
          // doc-id (same hazard cacheUpsert documents below; the fix was applied there and
          // NOT here, so it survived one layer down — adversarial review 2026-08-08,
          // finding 10: a cold list() returned rows keyed by a numeric team id, the next
          // cacheUpsert couldn't find them, and LG.teams grew stale duplicates).
          if (!kind || d.kind === kind) out.push({ ...d, id: k.slice(this.key("").length) });
        }
      }
      return out;
    },
  };

  let cloud = null;
  LG.backendMode = "local";
  // ---------------- SERVER-CONFIRMED EMPTINESS (live bug, 2026-08-08) ----------------
  // The live site showed the first-run "Import the league from ESPN" card against a Firestore
  // collection that demonstrably HAS 8 teams. Root cause: NOTHING in this file distinguished
  // "the league really is empty" from "we never actually heard back from the league store".
  // This is the same lesson index.html learned twice with the goat herd (see CLAUDE.md's
  // `serverConfirmed` rule): EMPTINESS MUST BE SERVER-CONFIRMED before any destructive or
  // "let's set it up from scratch" UI is offered. LG.backendDegraded is that signal — true
  // whenever this session is NOT provably reading the real league store — and lg-ui.js shows
  // an honest "couldn't reach the league" card with a Retry instead of the first-run card
  // whenever an empty read is unconfirmed.
  //
  // ⭐ THE REST TRANSPORT (2026-08-08, third live desktop incident in one day). The Firebase
  // JS SDK is GONE from this app. It caused three outages in a single day, all of them in
  // machinery this league never asked for:
  //   1. its gstatic ESM import failing silently -> the silent local fallback -> an empty
  //      read -> the first-run card offered to a league with eight teams in it;
  //   2. its persistent IndexedDB cache corrupting -> "FIRESTORE (10.12.2) INTERNAL ASSERTION
  //      FAILED: Unexpected state" on every read, on one desktop profile only;
  //   3. the SAME corrupted-cache bug arriving as a HANG rather than a throw (an SDK deadlock,
  //      or clearIndexedDbPersistence blocking while another tab holds the database) — and a
  //      hung promise sails straight past every try/catch, which is why the outage card came
  //      up with no reason line and its Retry button stuck on "TRYING…" forever.
  // Every one of those is a property of the SDK's offline-cache layer, not of the network and
  // not of this league. So the five operations this app actually uses (get/set/del/list, and
  // watch — which had zero callers and is gone) are now plain `fetch` against the Firestore
  // REST API. No ESM import, no IndexedDB, no offline cache, no background sync thread.
  //
  // Structural consequences, both of them upgrades rather than trade-offs:
  //   · A 404 IS SERVER-CONFIRMED ABSENCE. The entire "cache-served empty" ambiguity class —
  //     the thing incident (1) turned on, and the reason getDocsFromServer re-asks had to be
  //     bolted onto every read — simply ceases to exist. There is no cache to be served from.
  //   · NOTHING CAN HANG. Every request goes through one wrapper with an AbortController
  //     timeout, so boot and Retry both complete in bounded time BY CONSTRUCTION. Incident
  //     (3)'s stuck-"TRYING…" state is not fixed, it is unreachable.
  // CORS is proven live from a browser's perspective (GitHub-runner diag run 31276897340,
  // 2026-08-08): a GET with an Origin header answers 200 + access-control-allow-origin, the
  // OPTIONS preflight for a JSON POST answers 200 with POST + content-type allowed, and a real
  // :runQuery POST answers 200 + ACAO with the league's 8 team docs. Auth is the public web
  // API key already in this page; the rules are public — the same posture the SDK had.
  const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
  const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";
  const FS_TIMEOUT_MS = 12000;
  LG.FS_TIMEOUT_MS = FS_TIMEOUT_MS; // test hook — the suite measures the bound, it doesn't assume it

  // ---- the value codec (JSON <-> Firestore `fields`) ----
  // Firestore's REST representation is typed, so both directions are explicit. Two rules here
  // are load-bearing rather than stylistic:
  //   · an integer MUST go out as integerValue (a STRING, per the API) and a non-integer as
  //     doubleValue — and BOTH come back as a JS Number. This house has been burned by the
  //     other choice before: writing a whole number as a double made `rounds === 2` silently
  //     false after a round trip (the fitness per-kid plan incident).
  //   · an array directly inside an array THROWS, loudly. Firestore forbids it outright; our
  //     data shapes already comply (the schedule doc's {g:[{h,a}]} encoding exists precisely
  //     for this), and silently mangling one would be far worse than a crash.
  function fsEnc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    const t = typeof v;
    if (t === "boolean") return { booleanValue: v };
    if (t === "number") return Number.isFinite(v)
      ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
      : { nullValue: null }; // NaN/Infinity have no Firestore representation
    if (t === "string") return { stringValue: v };
    if (Array.isArray(v)) {
      return { arrayValue: { values: v.map((x) => {
        if (Array.isArray(x)) throw new Error("Firestore forbids an array directly inside an array — wrap it in an object first");
        return fsEnc(x);
      }) } };
    }
    if (t === "object") return { mapValue: { fields: fsEncFields(v) } };
    return { nullValue: null }; // functions/symbols never appear in league docs
  }
  function fsEncFields(obj) {
    const out = {};
    for (const k of Object.keys(obj || {})) { if (obj[k] !== undefined) out[k] = fsEnc(obj[k]); }
    return out;
  }
  function fsDec(v) {
    if (!v || typeof v !== "object") return null;
    if ("nullValue" in v) return null;
    if ("booleanValue" in v) return !!v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("doubleValue" in v) return Number(v.doubleValue);
    if ("stringValue" in v) return v.stringValue;
    if ("timestampValue" in v) return String(v.timestampValue);
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsDec);
    if ("mapValue" in v) return fsDecFields(v.mapValue.fields);
    // An unknown value kind must never throw MID-DECODE — that would lose the whole doc over
    // one field. Drop the field to null and say so once in the console.
    console.warn("GFFL: unknown Firestore value kind", Object.keys(v).join(","));
    return null;
  }
  function fsDecFields(fields) {
    const out = {};
    for (const k of Object.keys(fields || {})) out[k] = fsDec(fields[k]);
    return out;
  }
  LG._fsEnc = fsEncFields; LG._fsDec = fsDecFields; // test hooks (codec unit tests)

  // Backtick-quote EVERY field path. Firestore's field-path grammar only accepts a bare
  // segment matching ([a-zA-Z_][a-zA-Z_0-9]*); anything else must be backtick-quoted. This
  // house has already been burned by field-path grammar once (activity.mjs's `03_news_v`
  // fields, which Firestore 400'd for twelve silent hours), so no key is ever trusted to be
  // a bare identifier — they all get quoted.
  const fsPath = (k) => "`" + String(k).replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";

  // ---- one fetch wrapper: bounded, typed, readable ----
  // The ONLY door to the network. An AbortController timeout is what makes "nothing can hang"
  // a structural property rather than a hope: boot and Retry are both a bounded number of
  // these, so both always complete.
  async function fsFetch(url, init, what) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), FS_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { ...(init || {}), signal: ac.signal });
    } catch (e) {
      // A DOMException named AbortError is our own timeout; anything else is the network.
      if (e && (e.name === "AbortError" || ac.signal.aborted)) {
        throw new Error(what + " timed out after " + Math.round(FS_TIMEOUT_MS / 1000) + "s");
      }
      throw new Error(what + " — network error: " + String((e && e.message) || e));
    } finally { clearTimeout(timer); }
    return res;
  }

  // ---- THE SNAPSHOT MIRROR ----
  // Every successful server read writes through into the LOCAL backend's own localStorage keys
  // (the same lg_<COLL>_<id> shape local.get/list already read), plus one stamp saying "this
  // device's local store is a mirror of the cloud, freshened at T". That stamp is the whole
  // distinction the offline UI turns on:
  //   · a store WITH the stamp is a mirror -> when the cloud can't be reached, render the
  //     league from it (read-only, with a chip saying so and an auto-retry running);
  //   · a store WITHOUT the stamp is a genuine local-backend store — which is exactly what
  //     every suite page seeds — so it stays fully read-write, no chip, unchanged behaviour.
  // The user's directive, verbatim: "we have to design the site so no user could ever get this
  // sort of caching issue, they always need to be able to reach the site and see all the data."
  const SNAPSTAMP_KEY = "lg_snapstamp_" + LG.famKey;
  function mirrorStampAt() {
    try { return Number(localStorage.getItem(SNAPSTAMP_KEY) || 0) || 0; } catch (e) { return 0; }
  }
  function mirrorPut(id, doc) {
    try {
      if (doc) localStorage.setItem(local.key(id), JSON.stringify(doc));
      else localStorage.removeItem(local.key(id));
      // The mirror writes the DOC around the local backend's own set(), so it has to move the
      // version too — a mirror refresh that changed a doc while leaving its version untouched
      // would let a later local-mode setIf commit against a base it never actually read.
      local.bump(id);
      localStorage.setItem(SNAPSTAMP_KEY, String(Date.now()));
    } catch (e) { /* private mode / quota — the mirror is a bonus, never a requirement */ }
  }
  // Does this device hold a mirror with an actual league in it? Stamp AND at least one team
  // doc: a stamped-but-teamless store has nothing to show, so that case correctly falls
  // through to the honest outage card instead of an empty league behind an offline chip.
  function mirrorHasLeague() {
    if (!mirrorStampAt()) return false;
    try {
      const pfx = local.key("team_");
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(pfx)) return true;
      }
    } catch (e) { /* private mode */ }
    return false;
  }
  LG.mirrorOffline = false;     // true = reading this device's saved copy, writes refused
  LG.mirrorStampAt = mirrorStampAt;
  LG.onOfflineWrite = null;     // lg-ui registers the toast
  // A mirror is a READ-ONLY copy of the cloud. Writing into it would be worse than refusing:
  // the next successful cloud read overwrites the mirror wholesale, so the write would appear
  // to work and then silently vanish. Refused at the LG.db seam so no call site can miss it;
  // the thrown error carries a flag lg-ui recognises, so the reader gets one clear toast
  // instead of an unhandled rejection.
  function refuseMirrorWrite() {
    if (!LG.mirrorOffline) return;
    try { if (LG.onOfflineWrite) LG.onOfflineWrite(); } catch (e) { /* never let the toast break the refusal */ }
    const err = new Error("offline-readonly");
    err.offlineReadOnly = true;
    throw err;
  }

  LG.backendDegraded = true;   // until a real backend read proves otherwise
  LG.backendError = "";        // the reason, verbatim, shown on that card so the next report identifies itself
  LG.dataConfirmed = () => !LG.backendDegraded;
  function markDegraded(e) {
    LG.backendDegraded = true;
    LG.backendError = String((e && e.message) || e || "unknown");
  }
  // A read that provably reached the SERVER clears the flag — a single blip must not leave a
  // session marked unconfirmed for the rest of its life.
  function markHealthy() { LG.backendDegraded = false; LG.backendError = ""; }
  LG._markDegraded = markDegraded; // test hook

  // ---- the five operations ----
  const rest = {
    async get(id) {
      const url = FS_BASE + "/" + encodeURIComponent(LG.COLL) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY;
      const r = await fsFetch(url, { method: "GET" }, "Firestore read");
      // 404 is a real answer from a real server: this doc does not exist. That is what makes
      // server-confirmed absence free here — there is no cache that could have invented it.
      if (r.status === 404) { markHealthy(); return null; }
      if (!r.ok) throw new Error("Firestore read failed (" + r.status + ")");
      const j = await r.json();
      const doc = fsDecFields(j && j.fields);
      markHealthy();
      mirrorPut(id, doc);
      return doc;
    },
    // ---- COMPARE-AND-SWAP (2026-08-18) ----
    // Same GET as above; the ONE addition is that the response's own `updateTime` — which
    // Firestore returns on every read and which this transport has been discarding since the
    // day it was written — comes back as the version. A doc that isn't there has version null,
    // which setIf turns into a create-only precondition.
    //
    // If an upstream ever answers a document with NO updateTime, v is null, the next setIf
    // sends `exists=false` against a document that plainly exists, and the write conflicts
    // until LG.db.update gives up with `cas-contention`. That is the RIGHT failure: loud, and
    // impossible to mistake for a write that landed.
    async getV(id) {
      const url = FS_BASE + "/" + encodeURIComponent(LG.COLL) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY;
      const r = await fsFetch(url, { method: "GET" }, "Firestore read");
      if (r.status === 404) { markHealthy(); return { doc: null, v: null }; }
      if (!r.ok) throw new Error("Firestore read failed (" + r.status + ")");
      const j = await r.json();
      const doc = fsDecFields(j && j.fields);
      markHealthy();
      mirrorPut(id, doc);
      return { doc, v: (j && j.updateTime) || null };
    },
    // rest.set's PATCH + updateMask, plus ONE precondition — and the precondition is the whole
    // point: Firestore evaluates it server-side against the document as it stands right now, so
    // a write whose base has moved is REFUSED rather than applied over the top. That is the
    // atomicity the local backend and this transport can both express, and it is what closes
    // the read-modify-write window every money path in this file sits in.
    //   · v non-null -> currentDocument.updateTime=<v>   ("only if it is still exactly this")
    //   · v null     -> currentDocument.exists=false     ("only if nobody has created it")
    // A refusal comes back as {conflict:true} rather than a throw, because the caller's answer
    // to it is to re-read and try again, not to give up. Every OTHER non-ok status still
    // throws — a 500 is not contention and must never be retried as if it were.
    async setIf(id, data, v) {
      const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
      if (!keys.length) return { ok: true };
      const mask = keys.map((k) => "updateMask.fieldPaths=" + encodeURIComponent(fsPath(k))).join("&");
      const pre = v == null
        ? "&currentDocument.exists=false"
        : "&currentDocument.updateTime=" + encodeURIComponent(v);
      const url = FS_BASE + "/" + encodeURIComponent(LG.COLL) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY + "&" + mask + pre;
      const r = await fsFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fsEncFields(data) }),
      }, "Firestore write");
      if (!r.ok) {
        // Google's own gRPC->HTTP mapping is not consistent across the two precondition kinds
        // (FAILED_PRECONDITION has been seen as both 400 and 409, ALREADY_EXISTS as 409), so
        // the STATUS STRING in the body is checked as well as the code. Anything else throws.
        const txt = await r.text().catch(() => "");
        if (r.status === 409 || r.status === 412 || /FAILED_PRECONDITION|ALREADY_EXISTS|ABORTED/.test(txt)) return { conflict: true };
        throw new Error("Firestore write failed (" + r.status + ")");
      }
      markHealthy();
      const j = await r.json().catch(() => null);
      if (j && j.fields) mirrorPut(id, fsDecFields(j.fields));
      return { ok: true, doc: j && j.fields ? fsDecFields(j.fields) : null, v: (j && j.updateTime) || null };
    },
    // See local.foreignGet — read-only, another app's collection, never mirrored. A 404 is a
    // real "there is no draft" rather than an error, exactly as it is for our own docs.
    async foreignGet(coll, id) {
      const url = FS_BASE + "/" + encodeURIComponent(coll) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY;
      const r = await fsFetch(url, { method: "GET" }, "Firestore read");
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("Firestore read failed (" + r.status + ")");
      const j = await r.json();
      return fsDecFields(j && j.fields);
    },
    async set(id, data) {
      const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
      // An empty updateMask means "replace the whole document" to Firestore, which is the
      // opposite of what a zero-field merge means here. Nothing to merge -> nothing to send.
      if (!keys.length) return;
      const mask = keys.map((k) => "updateMask.fieldPaths=" + encodeURIComponent(fsPath(k))).join("&");
      const url = FS_BASE + "/" + encodeURIComponent(LG.COLL) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY + "&" + mask;
      // PATCH + an updateMask naming exactly the top-level keys we are writing IS setDoc's
      // merge:true: listed fields are replaced, unlisted fields on the server are left alone.
      const r = await fsFetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fsEncFields(data) }),
      }, "Firestore write");
      if (!r.ok) throw new Error("Firestore write failed (" + r.status + ")");
      markHealthy();
      const j = await r.json().catch(() => null);
      // Keep the mirror tracking our own writes: the response carries the merged document.
      if (j && j.fields) mirrorPut(id, fsDecFields(j.fields));
    },
    async del(id) {
      const url = FS_BASE + "/" + encodeURIComponent(LG.COLL) + "/" + encodeURIComponent(id) + "?key=" + FS_KEY;
      const r = await fsFetch(url, { method: "DELETE" }, "Firestore delete");
      if (!r.ok && r.status !== 404) throw new Error("Firestore delete failed (" + r.status + ")"); // 404 = already gone
      markHealthy();
      mirrorPut(id, null);
    },
    async list(kind) {
      const q = { from: [{ collectionId: LG.COLL }] };
      if (kind) q.where = { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: kind } } };
      const r = await fsFetch(FS_BASE + ":runQuery?key=" + FS_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredQuery: q }),
      }, "Firestore query");
      if (!r.ok) throw new Error("Firestore query failed (" + r.status + ")");
      const rows = await r.json();
      const out = [];
      for (const row of (Array.isArray(rows) ? rows : [])) {
        // A runQuery stream legitimately contains rows with no `document` (a readTime-only
        // heartbeat, or the single {} a zero-result query answers with).
        if (!row || !row.document || !row.document.name) continue;
        const id = String(row.document.name).split("/").pop();
        const doc = fsDecFields(row.document.fields);
        mirrorPut(id, doc);
        out.push({ ...doc, id }); // id LAST — a doc's own stray `id` field must never clobber its doc-id
      }
      markHealthy();
      return out;
    },
  };

  async function initCloud() {
    cloud = rest;
    // Prove reachability with one read before claiming cloud mode. Under REST a 404 is a
    // perfectly good proof of reachability (a fresh league has no settings doc yet) — only a
    // network failure, a timeout or a non-404 error status throws.
    await cloud.get("settings");
    LG.backendMode = "cloud";
    LG.mirrorOffline = false;
    markHealthy();
  }
  LG.backendReady = (async () => {
    try { await initCloud(); }
    catch (e) {
      // A test harness may have swapped a working fake cloud in underneath us
      // (_installFakeCloud). Only a genuinely un-swapped session drops to local: initCloud()
      // leaves backendMode at "local" on its own failure path, so "already cloud" can only
      // mean somebody else installed a reachable backend.
      if (LG.backendMode === "cloud") return;
      LG.backendMode = "local";
      markDegraded(e);
      // If this device holds a mirror of the league, we can still SHOW everything — read-only,
      // with a chip and an auto-retry. A store with no stamp is a genuine local backend and
      // behaves exactly as it always has.
      LG.mirrorOffline = mirrorHasLeague();
    }
  })();
  // The Retry the "couldn't reach the league" card offers, and the auto-retry the offline chip
  // runs. Bounded by construction: it is one fsFetch, and every fsFetch has a timeout — the
  // stuck-"TRYING…" state that started this rework cannot occur.
  LG.retryBackend = async function () {
    try {
      // Re-probe the handle we already have rather than rebuilding one. initCloud() assigns
      // `cloud` BEFORE its probe, so a boot that failed at the probe still left the transport
      // in place — and, more importantly, a test harness may have installed a DIFFERENT
      // reachable backend underneath us (_installFakeCloud); rebuilding would throw it away.
      if (cloud) { await cloud.get("settings"); LG.backendMode = "cloud"; LG.mirrorOffline = false; markHealthy(); }
      else await initCloud();
      LG.db.clearCache(); // a cache filled while degraded is a cache of answers nobody could confirm
      return true;
    } catch (e) {
      LG.backendMode = "local";
      markDegraded(e);
      LG.mirrorOffline = mirrorHasLeague();
      return false;
    }
  };
  // ---------------- doc-level cache (perf — playtest: "not snappy moving between tabs") ----------------
  // Every view (league/matchup/locker/moves/chat/rules/bracket) re-reads teams/rosters/weekly/
  // tx/claims/trades through LG.db on EVERY tab switch — on the cloud backend each call is a
  // real network round-trip, and repeated full-view renders re-fetched everything from scratch.
  // LG.db now caches every doc AND every list() result in memory: a cache hit resolves in the
  // SAME microtask (no I/O), so a view can paint synchronously from cache and let fresh data
  // arrive quietly. Every set()/del() from THIS page updates the cache in place, so a local
  // write is instantly visible without waiting on the round trip.
  //
  // "chat" is the one kind EXEMPTED from list-caching: chat message ids are minted by any
  // client at any time (not just this page) and the app already has its own explicit poll
  // cadence for it (startChatPoll, 8s) — caching it would make new messages read as stale
  // exactly where staleness matters most, so LG.db.list("chat") always goes straight to the
  // backend, same as before this change.
  //
  // The 5 idempotency-race guards elsewhere in this file ("re-read right before the final
  // write, in case another device already processed it") must see the REAL current backend
  // state, not this page's own cache — LG.db.getFresh(id) bypasses the cache for exactly those
  // call sites (processWaivers/executeTrade/finalizeWeek/buildBracket/snapshotProjections).
  //
  // ADVERSARIAL REVIEW 2026-08-08 (findings 2/4/5/12) — the cache used to store NEGATIVE
  // results (`docCache.has(id)` is true for a cached null) with no TTL and no invalidation
  // path, so the FIRST read of a not-yet-existing doc froze "it doesn't exist" for the whole
  // page session. Combined with read-modify-write writers that rebuilt a shared array from
  // that frozen base, a device could silently DELETE other owners' waiver claims and revert
  // executed trades. Three structural changes:
  //   1. a null is NEVER stored in docCache (`del` clears the entry rather than caching null);
  //   2. absence is instead DERIVED from a cached list() snapshot of that doc's own kind —
  //      list caches already carry a 15s cloud background refresh, so "this doc doesn't
  //      exist" self-heals on the same cadence as every other read instead of never;
  //   3. positive docs get that same background refresh (docAt below), so a doc read once at
  //      boot can't stay frozen for hours either.
  // The paint path is untouched: a warm view still resolves every read in the same microtask.
  const docCache = new Map();   // id -> doc (NEVER null — see above)
  const docAt = new Map();      // id -> { at, refreshing } — cloud background-refresh bookkeeping
  const listCache = new Map();  // kind ("" = every doc) -> { docs:[...], at, refreshing }
  // Cloud-only: how old a cached list()/doc may be before a quiet background refresh.
  // MEASURED IN WALL TIME (Date.now()), deliberately NOT LG.now(). Cache freshness is a fact
  // about the NETWORK, not about the league's calendar — and under the 2025 replay LG.now()
  // runs at SIM_SPEED (8× by default), which would have fired every background refresh eight
  // times as often for the whole session. Same reasoning as runAutoChecks' own throttle.
  const CACHE_STALE_MS = 15000;
  function backend() { return LG.backendMode === "cloud" ? cloud : local; }
  // Every doc-id in this app is `<kind>_<...>` (or the bare "settings"), so a doc's kind is
  // inferable from its id — which is what lets a cached list() answer "does this exist?"
  // without a network read AND without ever caching a null.
  const ID_KIND = {
    team: "team", roster: "roster", weekly: "weekly", claims: "claims", claim: "claim",
    trade: "trade", tx: "tx", hist: "hist", bracket: "bracket", sched: "sched",
    projsnap: "projsnap", settings: "settings",
    injstate: "injstate", injfeed: "injfeed", // S9
    // 2026-09-02: `proj_<season>_w<week>` (the Grok adjuster's doc, kind "proj") and
    // `awards_history` (kind "awards") were both minted long after this map was written and
    // never added to it, so kindOf() answered null for them and knownAbsent() could never
    // short-circuit their reads — every miss was a real round trip, on every render, forever.
    // Adding them is purely the perf shortcut every other kind already gets; nothing else
    // reads this map.
    proj: "proj", awards: "awards",
  };
  function kindOf(id) {
    const s = String(id || "");
    if (s === "settings") return "settings";
    const u = s.indexOf("_");
    if (u < 0) return null;
    const k = ID_KIND[s.slice(0, u)];
    // "chat" is deliberately absent: chat is the one kind exempted from list-caching (new
    // messages are minted by any client at any time), so absence must never be derived for it.
    return k || null;
  }
  // true only when a cached list() for this doc's kind PROVES the doc isn't there.
  function knownAbsent(id) {
    // NEVER derive absence from a list snapshot taken while the cloud was unreachable — that
    // snapshot may be an empty offline-cache answer, not the league (see the SERVER-CONFIRMED
    // EMPTINESS note above). The local backend is exempt: localStorage answers truthfully, so
    // an empty local list really does mean "not on this device".
    if (LG.backendMode === "cloud" && LG.backendDegraded) return false;
    const kind = kindOf(id);
    if (!kind) return false;
    const entry = listCache.get(kind) || listCache.get("");
    if (!entry) return false;
    return !entry.docs.some((d) => d.id === id);
  }
  // Keeps every list() cache entry that could plausibly contain `id` in sync with a set/del —
  // upserts (or removes) the {id,...doc} row so a subsequent list() call for that kind sees it
  // without a real fetch.
  function cacheUpsert(id, doc) {
    // A deleted doc is REMOVED from the cache, never remembered as null — a cached null is
    // the exact mechanism findings 2/4/5/12 turn on.
    if (doc) { docCache.set(id, doc); docAt.set(id, { at: Date.now(), refreshing: false }); }
    else { docCache.delete(id); docAt.delete(id); }
    for (const [kind, entry] of listCache) {
      if (kind && (!doc || doc.kind !== kind)) {
        const i = entry.docs.findIndex((d) => d.id === id);
        if (i >= 0) entry.docs.splice(i, 1);
        continue;
      }
      // `id` must win over any stray `.id` FIELD already sitting inside `doc` — and there
      // often is one: LG.db.list() rows are shaped {id, ...doc}, and a LOT of call sites round-
      // trip an in-memory object straight back into set() (e.g. `LG.saveTeam({...T, teamId,
      // colors})`, where T itself carries the numeric `id` loadTeams() adds on top of the raw
      // doc). Spreading doc AFTER id (not before) is load-bearing: id-before-doc let a numeric
      // `.id` clobber the real string doc-id here, so the NEXT upsert's `findIndex` couldn't
      // find the row it had just written, pushed a stale DUPLICATE instead of updating in
      // place, and array-order made LG.teamById silently return the pre-edit team forever
      // (caught live: a saved team colour never stuck — playtest fix batch, item 1).
      const row = doc ? { ...doc, id } : null;
      const i = entry.docs.findIndex((d) => d.id === id);
      if (row) { if (i >= 0) entry.docs[i] = row; else entry.docs.push(row); }
      else if (i >= 0) entry.docs.splice(i, 1);
    }
  }
  // ---------------- the fake-cloud CAS shim (TEST-ONLY) ----------------
  // A fake installed by a suite implements the four operations it needs — get/set/del/list —
  // and knows nothing about versions, while LG.db.update needs getV/setIf. Letting such a
  // fake go without them would leave every CAS-dependent check on that page passing for the
  // wrong reason, which is the "a fixture kinder than reality hides bugs" failure this whole
  // rework is about. So the shim gives it REAL compare-and-swap rather than a permissive stub:
  // the version compare and the version bump happen in ONE synchronous run with no await
  // between them, so two setIfs interleaved on the same page genuinely cannot both win.
  //
  // It is PAGE-LOCAL, which is all an in-page Map store ever is — those fakes are not shared
  // between browser contexts, so there is no other writer for a page-local version to miss.
  // Every SHARED fixture (the node-side stores in _gffl_race_kit.cjs, _gffl_season_sim.cjs and
  // _verify-gffl.cjs's REST fixture) implements the precondition ON THE WIRE instead, which is
  // what makes the two-device race checks real.
  //
  // A fake that already speaks getV/setIf is returned untouched.
  function casShim(impl) {
    if (!impl || (impl.getV && impl.setIf)) return impl;
    const vers = new Map(); // id -> version number, or null meaning "this doc is not there"
    const seed = (id, doc) => { if (!vers.has(id)) vers.set(id, doc ? 0 : null); };
    return {
      ...impl,
      async getV(id) {
        const doc = await impl.get(id);
        seed(id, doc);
        const have = vers.get(id);
        return { doc: doc || null, v: have == null ? null : String(have) };
      },
      async setIf(id, data, v) {
        if (!vers.has(id)) seed(id, await impl.get(id));
        const have = vers.get(id);
        if ((have == null ? null : String(have)) !== (v == null ? null : String(v))) return { conflict: true };
        vers.set(id, (Number(have) || 0) + 1); // synchronous — nothing awaits between here and the compare
        await impl.set(id, data);
        return { ok: true };
      },
      // A blind write still has to move the version, or it could land underneath a CAS holder
      // whose setIf would then be accepted against a base that no longer exists.
      async set(id, data) { const had = vers.get(id); vers.set(id, had == null ? 0 : Number(had) + 1); return impl.set(id, data); },
      async del(id) { vers.set(id, null); return impl.del(id); },
    };
  }
  LG.db = {
    stats: { gets: 0, lists: 0, sets: 0, dels: 0, fresh: 0, missGets: 0 }, // real (non-cache) backend calls — perf test hook
    onChange: null, // (kind) => void — lg-ui registers this to quietly repaint after a background refresh finds new data
    async get(id) {
      if (docCache.has(id)) {
        // Same quiet background refresh list() has had all along — a positive doc read once
        // at boot must not stay frozen for the life of the tab either (finding 4).
        const meta = docAt.get(id);
        if (LG.backendMode === "cloud" && meta && !meta.refreshing && Date.now() - meta.at > CACHE_STALE_MS) {
          meta.refreshing = true;
          LG.db.stats.gets++;
          backend().get(id).then((fresh) => {
            meta.refreshing = false; meta.at = Date.now();
            const changed = JSON.stringify(fresh) !== JSON.stringify(docCache.get(id));
            if (fresh) docCache.set(id, fresh); else docCache.delete(id);
            if (changed && LG.db.onChange) LG.db.onChange(kindOf(id));
          }).catch(() => { meta.refreshing = false; });
        }
        return docCache.get(id);
      }
      // Absence derived from a cached list() of this doc's own kind — no round trip, and
      // (unlike a cached null) it expires with that list's own 15s background refresh.
      if (knownAbsent(id)) return null;
      LG.db.stats.gets++;
      const v = await backend().get(id);
      if (v) { docCache.set(id, v); docAt.set(id, { at: Date.now(), refreshing: false }); }
      else LG.db.stats.missGets++; // NEVER cached — a negative must not survive the read
      return v;
    },
    // Bypasses the cache entirely — for the handful of "someone else may have already done
    // this" idempotency guards, which must see the true current backend state.
    async getFresh(id) {
      LG.db.stats.fresh++;
      const v = await backend().get(id);
      cacheUpsert(id, v); // adopt the truth (and drop any stale row from every list cache)
      return v;
    },
    // Another app's collection, read-only, ALWAYS fresh and never cached here — this league's
    // doc/list caches must never be able to answer for data they do not own. Used only by the
    // Draft Day import to read ffdraft.html's own draft room.
    async foreignGet(coll, id) {
      LG.db.stats.fresh++;
      return backend().foreignGet(coll, id);
    },
    // Bypasses the list cache — every "did someone else already do this?" guard and every
    // read-modify-write MUST see the real current backend state, not this page's snapshot.
    async listFresh(kind) {
      LG.db.stats.fresh++;
      const docs = await backend().list(kind);
      const key = kind || "";
      listCache.set(key, { docs, at: Date.now(), refreshing: false });
      for (const d of docs) { docCache.set(d.id, d); docAt.set(d.id, { at: Date.now(), refreshing: false }); }
      return docs;
    },
    async set(id, data) {
      refuseMirrorWrite(); // BEFORE the optimistic cache update — never show a phantom change
      LG.db.stats.sets++;
      const cur = docCache.get(id) || {};
      cacheUpsert(id, { ...cur, ...data }); // optimistic — instantly visible to this page's own next read
      await backend().set(id, data);
    },
    async del(id) {
      refuseMirrorWrite();
      LG.db.stats.dels++;
      cacheUpsert(id, null);
      await backend().del(id);
    },
    // ================= THE ONE READ-MODIFY-WRITE PRIMITIVE (2026-08-18) =================
    // Every money path in this file used to be: read fresh, compute, write. Between the read
    // and the write sits a window in which another device can land its own write, and the
    // second writer's whole-document PATCH puts it back. Narrowed repeatedly (getFresh before
    // every write, deltas instead of absolutes, a single-flight latch) and never CLOSED,
    // because closing it needs the transport to be able to say "only if it is still exactly
    // what I read". Both backends can now say that (rest.setIf / local.setIf), so this is it.
    //
    //   const r = await LG.db.update(id, (doc) => next);
    //     · doc  — the CURRENT document, read fresh from the backend (never the cache), or
    //              null when it does not exist;
    //     · next — the whole document to write, merged the way set() merges;
    //     · null — ABORT: nothing is written at all, and the caller gets
    //              {ok:false, aborted:true, doc} with the fresh doc it refused against, which
    //              is how a guard ("already processed", "no longer offered", "he's already
    //              gone") re-decides against the truth instead of against a stale read.
    //   returns {ok:true, doc} on a successful write.
    //   throws  Error("cas-contention:"+id) if six attempts all lost the race — a real
    //           failure, never a silent last-writer-wins.
    //
    // ⚠⚠ `mutate` MUST BE PURE AND REENTRANT. IT CAN RUN UP TO SIX TIMES. ⚠⚠
    // It is called once per attempt, each time against a DIFFERENT fresh document. Anything
    // it does besides computing the next document — logging a transaction, sending a push,
    // showing a toast, appending to an array it captured from an earlier read, bumping a
    // counter in the closure — happens once per attempt and is a bug. Side effects belong
    // AFTER a successful loop, in the caller. Every adopter below is written that way, and a
    // refusal is recomputed from the returned `doc` rather than smuggled out of the mutate.
    async update(id, mutate, opts) {
      refuseMirrorWrite(); // a mirror is read-only, and it must refuse BEFORE any read work
      const be = backend();
      // A backend with no compare-and-swap must not be silently downgraded to a blind write:
      // that would be exactly the vacuous green this rework exists to remove.
      if (!be.getV || !be.setIf) throw new Error("cas-unsupported:" + id);
      const max = (opts && opts.attempts) || 6;
      for (let attempt = 1; attempt <= max; attempt++) {
        LG.db.stats.fresh++;
        const { doc, v } = await be.getV(id);
        cacheUpsert(id, doc); // adopt what we just read, exactly as getFresh does
        const next = mutate(doc == null ? null : doc);
        if (next == null) return { ok: false, aborted: true, doc: doc == null ? null : doc };
        LG.db.stats.sets++;
        const res = await be.setIf(id, next, v);
        if (res && res.conflict) {
          // Backoff with jitter: two devices that collide must not re-collide in lockstep.
          await new Promise((r) => setTimeout(r, 40 * attempt + Math.floor(Math.random() * 40)));
          continue;
        }
        const merged = { ...(doc || {}), ...next };
        cacheUpsert(id, merged);
        return { ok: true, doc: merged };
      }
      throw new Error("cas-contention:" + id);
    },
    async list(kind) {
      if (kind === "chat") { LG.db.stats.lists++; return backend().list(kind); } // see the note above
      const key = kind || "";
      const entry = listCache.get(key);
      if (entry) {
        if (LG.backendMode === "cloud" && !entry.refreshing && Date.now() - entry.at > CACHE_STALE_MS) {
          entry.refreshing = true;
          LG.db.stats.lists++;
          const wasOk = !LG.backendDegraded;
          backend().list(kind).then((fresh) => {
            entry.refreshing = false;
            // Never let a quiet background refresh REPLACE real cached rows with an empty
            // result that the read itself couldn't confirm (an offline-cache answer). Keeping
            // the last known-good rows is strictly better than blanking the league behind the
            // user's back (live bug 2026-08-08).
            if (!fresh.length && entry.docs.length && wasOk && LG.backendDegraded) return;
            const changed = JSON.stringify(fresh) !== JSON.stringify(entry.docs);
            entry.docs = fresh; entry.at = Date.now();
            for (const d of fresh) { docCache.set(d.id, d); docAt.set(d.id, { at: Date.now(), refreshing: false }); }
            if (changed && LG.db.onChange) LG.db.onChange(kind);
          }).catch(() => { entry.refreshing = false; });
        }
        return entry.docs;
      }
      LG.db.stats.lists++;
      const docs = await backend().list(kind);
      listCache.set(key, { docs, at: Date.now(), refreshing: false });
      for (const d of docs) { docCache.set(d.id, d); docAt.set(d.id, { at: Date.now(), refreshing: false }); }
      return docs;
    },
    // Test-only: swaps the underlying "cloud" implementation + forces cloud mode, so the perf
    // suite can exercise the background-refresh/quiet-repaint path without a real Firestore.
    // Never called by production code.
    // A fake cloud IS a reachable backend — clear the degraded flag with it, or every test
    // that installs one would look like an offline session.
    _installFakeCloud(impl) { cloud = casShim(impl); LG.backendMode = "cloud"; LG.backendDegraded = false; LG.backendError = ""; LG.mirrorOffline = false; docCache.clear(); docAt.clear(); listCache.clear(); },
    // Drop every cached read. Idempotent and safe to call at any time; used by the offline
    // card's Retry (a cache filled while degraded is a cache of answers nobody could confirm).
    clearCache() { docCache.clear(); docAt.clear(); listCache.clear(); },
  };

  // ---------------- the rules doc ----------------
  // DECIDED (plan §4/§8 + user 2026-08-07): FAAB $100 · 5-team playoffs · 3 IR
  // · ESPN-standard trade veto · the family keeper rule from ffdraft.html.
  // The ESPN import overwrites scoring/slots with the real league's values.
  LG.DEFAULT_RULES = {
    name: "The Goat Fantasy Football League",
    abbrev: "GFFL",
    season: LG.SEASON,
    seasonWeeks: 14,
    // S2 (draft countdown): an ISO string WITH ITS OWN OFFSET, never a bare date/time — the
    // league home's countdown card and the Rules editor both parse this directly with
    // `new Date(...)`, and an offset-less string parses as local-to-the-READER's device,
    // which would silently point every family member's countdown at a different real moment.
    // Commissioner-editable in Rules → Draft, so a reschedule is a field edit, not a deploy.
    // NOTE: 2026-09-06 is actually a SUNDAY (the plan's "Sat Sep 6" prose is off by a day) —
    // the countdown card derives its weekday from THIS value at render time rather than
    // hardcoding one, so it shows the correct "Sun, Sep 6" regardless of this comment.
    draftAt: "2026-09-06T15:00:00-05:00", // 3:00 PM CT
    scoring: {
      pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
      rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
      rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
      fum_lost: -2,
      fg_0_39: 3, fg_40_49: 4, fg_50: 5, fg_miss: -1, xp_made: 1, xp_miss: -1,
      bonus_pass_300: 0, bonus_pass_400: 0, bonus_rush_100: 0, bonus_rush_200: 0,
      // dst_2pt_ret 4 / one_pt_safety 1 (2026-09-02): both were left at 0 here because the
      // 2026-08-13 ESPN reconciliation found them UNEXERCISED in the real 2025 season — no
      // sample to reconcile against — so they were grounded through the league's own settings
      // sheet instead ("Unexercised in 2025 and grounded through the settings: one_pt_safety 1,
      // dst_2pt_ret 4, dst_td 6, xp_miss 0"). dst_td already read 6 here; these two did not.
      // A default that scores a real rule at zero is a default that mis-scores the first
      // league to start from it.
      bonus_rec_100: 0, bonus_rec_200: 0, off_fum_td: 0, fg_made_yd: 0, dst_2pt_ret: 4, one_pt_safety: 1,
      // ESPN 2026 league settings sheet (commissioner, 2026-08-22): fum_rec 2→1, safety 2→4,
      // blk 2→3, dst_fum_forced added at 1, dst_kr_td added at 8 (KR/PR return TDs share one
      // bucket, matching the live doc and dst_pr_td). Points allowed is NOT scored at all —
      // every dst_pa_* bracket is 0, not the old 5/4/3/1/0/-1/-3/-5 ladder. The LIVE settings
      // doc already carried every one of these exact values as of a 2026-08-14 commissioner
      // edit (v=8) — this code fallback was eight days stale; this brings the default a new
      // league (or a fixture with no settings doc) starts from back in line with what the
      // real league has been playing under.
      dst_sack: 1, dst_int: 2, dst_fum_rec: 1, dst_fum_forced: 1, dst_td: 6, dst_safety: 4, dst_blk: 3, dst_kr_td: 8,
      dst_pa_0: 0, dst_pa_1_6: 0, dst_pa_7_13: 0, dst_pa_14_17: 0,
      dst_pa_18_27: 0, dst_pa_28_34: 0, dst_pa_35_45: 0, dst_pa_46: 0,
    },
    // ⭐ THE LIVE LEAGUE'S OWN SLOT SCRIPT (2026-09-02). RB 2→3 and WR 2→3, so the sum — which
    // IS LG.rosterCap() — moves 19 → 21. Read off the live settings doc (v=8), the same doc the
    // 2026-08-22 D/ST catch-up was reconciled against: {QB1 RB3 WR3 TE1 FLEX1 DST1 K1 BENCH7
    // IR3} = 21. This object is what a brand-new league, and every fixture with no settings
    // doc, starts from; leaving it two slots short of what the family actually plays meant the
    // defaults could never field the league's own lineup.
    roster: { QB: 1, RB: 3, WR: 3, TE: 1, FLEX: 1, DST: 1, K: 1, BENCH: 7, IR: 3 },
    waivers: { type: "faab", budget: 100, processDow: 3, processHour: 8 },
    trades: { reviewHours: 48, veto: "vote", vetoVotes: 4, deadlineWeek: 11 },
    keepers: { max: 3, costRoundsEarlier: 1, costFloor: 1, maxYears: 3, waiverCost: "last-round", mustBeOnFinalRoster: true },
    playoffs: { teams: 5, startWeek: 15, byes: 3 },
  };
  LG.rules = null;
  LG.rulesDoc = null;
  LG.loadRules = async function () {
    const doc = await LG.db.get("settings");
    if (doc && doc.rules) { LG.rulesDoc = doc; LG.rules = doc.rules; }
    else {
      // season: LG.SEASON at READ time, not the DEFAULT_RULES literal (frozen at whatever
      // LG.SEASON read at module-eval time), so a league with no settings doc yet reads the
      // season it is actually running — the 2025 replay included — everywhere the rules
      // object's own .season field is displayed.
      const rules = { ...LG.DEFAULT_RULES, season: LG.SEASON };
      LG.rulesDoc = { kind: "settings", v: 0, rules, log: [] }; LG.rules = rules;
    }
    return LG.rules;
  };
  // Every save bumps the version and logs a human-readable change list — the
  // transparency rule from plan §4.2.
  LG.saveRules = async function (next, who) {
    const changes = diffRules(LG.rules || LG.DEFAULT_RULES, next);
    const doc = {
      kind: "settings",
      v: (LG.rulesDoc?.v || 0) + 1,
      rules: next,
      log: [...(LG.rulesDoc?.log || []), ...(changes.length ? [{ t: Date.now(), who: who || LG.who() || "?", changes }] : [])].slice(-200),
    };
    await LG.db.set("settings", doc);
    LG.rulesDoc = doc; LG.rules = next;
    // Item 15 (2026-08-09, user: "dont put rules changes in the chat or any other system
    // message, just users chats"). The sys chat post that used to go here is GONE. Every
    // postSys site was checked for whether its event would lose its ONLY record by not being
    // written, and none of the seven would: `doc.log` two lines above records who changed
    // what and when for THIS one (the Rules view renders it as its own Change log card), the
    // transaction log covers waivers and trades and vetoes, the weekly doc covers a finalized
    // week and all three of its awards, and the bracket doc covers the bracket, the champion
    // and the Toilet Bowl. So the writes could all go, not just the rendering.
    // LG.postSys itself stays — it is still the API, and it is what the suite seeds a sys
    // message with to prove the chat surfaces filter one out.
    return changes;
  };
  function flat(obj, pfx) {
    const out = {};
    for (const k of Object.keys(obj || {})) {
      const v = obj[k];
      if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(out, flat(v, pfx + k + "."));
      else out[pfx + k] = v;
    }
    return out;
  }
  function diffRules(a, b) {
    const fa = flat(a, ""), fb = flat(b, ""), out = [];
    for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
      if (JSON.stringify(fa[k]) !== JSON.stringify(fb[k])) out.push(`${k}: ${fa[k] ?? "—"} → ${fb[k] ?? "—"}`);
    }
    return out;
  }
  LG.diffRules = diffRules;

  // ---------------- teams ----------------
  LG.teams = [];
  // teamsConfirmed records, AT READ TIME, whether this team list came from the real league
  // store — the one question the first-run card must never guess at (see the SERVER-CONFIRMED
  // EMPTINESS note above). Captured here rather than re-read at render time so a later
  // unrelated degradation can't retroactively change what an already-answered read meant.
  LG.teamsConfirmed = false;
  LG.loadTeams = async function () {
    LG.teams = (await LG.db.list("team")).map((t) => ({ ...t, id: Number(t.teamId) }))
      .sort((a, b) => a.id - b.id);
    LG.teamsConfirmed = LG.dataConfirmed();
    return LG.teams;
  };
  // A team doc is written from several places that each own a DIFFERENT field (a rename, a
  // motto, a logo, a FAAB deduction, a trophy), and most callers used to spread a whole
  // in-memory team object back in — so a page holding a stale copy silently reverted every
  // other field (adversarial review 2026-08-08, findings 4/10). Two rules now:
  //   · the stray numeric `id` LG.loadTeams() stamps on every in-memory team is stripped, so
  //     it can never be persisted and can never clobber a doc-id downstream (finding 10);
  //   · the write merges onto a FRESH read of the doc, so fields the caller isn't changing
  //     come from the real current backend state rather than from this page's snapshot.
  // Callers should still pass the DELTA (`{teamId, faab}`) rather than a whole spread team.
  //
  // ⭐ SEASON-SIM BUG 3 (2026-08-11) — `opts.from`. The fresh read above protects the fields a
  // caller ISN'T changing; it cannot protect the one it IS, because an ABSOLUTE value computed
  // from this page's cache is still absolute when it lands. FAAB is the field where that costs
  // real money: processWaivers deducted a bid from its own cached purse and wrote the answer,
  // so a deduction another device had already made was simply restored (measured in the sim:
  // an owner $54 up over a season, and $6 up inside two weeks).
  //   `opts.from(cur)` is handed the SAME fresh doc this write is merging onto, and whatever
  // it returns is laid on last — so a caller can express "take $8 off whatever the purse
  // really holds" instead of "the purse is 92", within one read and one write.
  //   WHY NOT A FIRESTORE INCREMENT TRANSFORM: this app's REST transport speaks documents
  // only — get/set/del/runQuery, a hand-rolled codec, a PATCH with an updateMask. Field
  // transforms are a different request shape the transport, its codec, the local backend and
  // the offline mirror would ALL have to learn, and the local backend has no atomic primitive
  // to implement one with anyway. That is a transport rework for a hazard a compute-from-fresh
  // closes at one read. If FAAB ever needs to survive genuinely simultaneous writers (rather
  // than the seconds-apart ones a family league produces) that rework is the honest answer.
  //
  // ⭐ THAT REWORK ARRIVED (2026-08-18). The paragraph above is kept because it is still the
  // right reasoning about TRANSFORMS — this is not one. What both backends turned out to be
  // able to express, without a codec change and without an atomic primitive, is a
  // PRECONDITION: "apply this document, but only if the base is still exactly what I read"
  // (Firestore's `currentDocument.updateTime`; a version integer in localStorage). So the
  // read and the write below are now ONE compare-and-swap loop, LG.db.update, and the window
  // between them is closed rather than narrowed. `opts.from(cur)` is unchanged and still gets
  // the fresh doc — it now gets the fresh doc of the attempt that actually commits.
  LG.saveTeam = async function (t, opts) {
    const { id: _stray, ...rest } = t || {};
    const docId = "team_" + rest.teamId;
    // Pure and reentrant, as LG.db.update requires: it reads only its argument and the
    // caller's own delta. `readOk` is NOT part of the computed document — it is a monotonic
    // latch that records "the backend answered a read", which is the one thing the offline
    // fall-through below has to know and cannot learn from the error alone.
    let readOk = false;
    const build = (cur) => {
      readOk = true;
      const { id: _stray2, ...curClean } = cur || {};
      const derived = opts && opts.from ? opts.from(cur) : null;
      return { ...curClean, kind: "team", ...rest, ...(derived || {}) };
    };
    try {
      await LG.db.update(docId, build);
      return;
    } catch (e) {
      // A read that worked means this was a WRITE failure — fatal before this change, fatal
      // now, including a lost CAS race (`cas-contention`), which is a real refusal and must
      // never be quietly retried as a blind write.
      if (readOk) throw e;
      if (e && e.offlineReadOnly) throw e;                                  // mirror: refused, as always
      if (/^cas-unsupported:/.test(String((e && e.message) || ""))) throw e; // loud, never a silent downgrade
      // ⭐⭐ A DELTA CANNOT BE COMPUTED AGAINST A DOCUMENT NOBODY READ (2026-09-02, F1).
      // The offline fall-through below calls build(null) — and `null` is handed straight to
      // opts.from, so a FAAB deduction expressed as "take $10 off whatever the purse really
      // holds" resolves LG.teamFaab({}) to the RULES DEFAULT and writes budget − bid. Measured
      // on the pre-fix engine (scratchpad probe9b_faab.cjs, failure injected at the CAS READ so
      // the real branch is reached): a team that had already spent $60 (purse $40) took a $10
      // waiver hit and came out at $90 — a $50 refund, silently, in the middle of processWaivers.
      // A read that did not answer is not a zero balance. The only correct move is to THROW:
      // processWaivers' own per-item handling (2026-09-02, S1) records it by name, the week's
      // other deductions still land, and nobody is handed free money.
      // The plain-field offline write survives for callers that pass no delta at all (a rename,
      // a logo, a PIN, a trophy) — those genuinely do not care what the doc used to hold.
      if (opts && opts.from) throw e;
      // Cloud unreachable — exactly the case the pre-CAS `try { getFresh }` swallowed. The
      // plain write is what this function has always done there, unchanged.
      return LG.db.set(docId, build(null));
    }
  };
  LG.teamById = (id) => LG.teams.find((t) => t.id === Number(id)) || null;

  // ---------------- TEAM COLOURS (S3, 2026-08-10) ----------------
  // Every team carries `colors = {primary, secondary, tertiary}` — proposed by the logo
  // extractor, overridable by hand — and `colorsCustom`, the latch that says a human has
  // touched a swatch (so a logo re-upload never clobbers their pick).
  //
  // THE LAW: colours are stored EXACTLY AS CHOSEN, and NOTHING renders them raw. Every render
  // site goes through LG.teamPalette(t) → LG.palStyle(pal), which clamps for contrast against
  // the surface the colour is about to sit on. A white-on-white pick, or a near-black one that
  // would vanish into the page, cannot produce invisible chrome, because the derivation — not
  // the render site — decides what actually reaches the screen. Two different clamps, because
  // there are two different jobs:
  //   · FILL (a hero wash, a crest disc, a stat bar): keep the colour at full strength, floor
  //     its contrast against the PAGE so the block still reads as a block, then flip the INK
  //     on top of it to black or white by whichever wins. That is where saturation lives.
  //   · INK ON DARK (a team name on a card, a tinted row label): floor at AA 4.5:1 against the
  //     card. Mixing toward white preserves hue, so a deep navy arrives as a pale blue — a
  //     legible team colour rather than a vibrant invisible one. That is the deliberate trade:
  //     text pays for legibility, fills keep the punch.
  //
  // ⚠ PAL_PAGE / PAL_SURFACE / PAL_INK_DARK DUPLICATE league.html's :root tokens (--bg,
  // --card and the ink used on light fills). They cannot be read from CSS here — lg-core runs
  // with no DOM guarantee and the palette is a pure function — so the suite asserts the
  // literals still match league.html instead (section AM), which is what keeps them from
  // drifting apart.
  const PAL_PAGE = "#0c1017";     // --bg          — what a fill sits on
  const PAL_SURFACE = "#151b26";  // --card        — what tinted ink sits on
  const PAL_INK_DARK = "#0b0f16"; // ink for a LIGHT fill
  const PAL_FILL_MIN = 1.5;       // a fill must separate from the page this much
  const PAL_INK_MIN = 4.5;        // WCAG AA for normal text — tinted ink never goes below it
  function palHex(c) {
    const s = String(c == null ? "" : c).trim();
    let m = /^#?([0-9a-fA-F]{6})$/.exec(s);
    if (m) return "#" + m[1].toLowerCase();
    m = /^#?([0-9a-fA-F]{3})$/.exec(s);
    if (m) return "#" + m[1].toLowerCase().split("").map((ch) => ch + ch).join("");
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
    if (m) return palFromRgb(Number(m[1]), Number(m[2]), Number(m[3]));
    return null;
  }
  function palFromRgb(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }
  function palRgb(hex) {
    const h = palHex(hex) || "#000000";
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function palLum(hex) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const c = palRgb(hex);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  // Exposed so the suite can measure the SAME contrast the clamp used, rather than
  // re-implementing WCAG beside it and testing its own arithmetic.
  LG.contrast = function (a, b) {
    const la = palLum(a), lb = palLum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  LG.inkOn = function (bg) { return LG.contrast("#ffffff", bg) >= LG.contrast(PAL_INK_DARK, bg) ? "#ffffff" : PAL_INK_DARK; };
  function palMix(hex, target, t) {
    const a = palRgb(hex), b = palRgb(target);
    return palFromRgb(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
  }
  // Both clamps walk in small steps toward white and stop the moment the floor is cleared, so
  // a colour that already passes comes back BYTE-IDENTICAL — the common case costs nothing and
  // an already-legible pick is never quietly shifted.
  function palClampFill(hex) {
    let c = hex;
    for (let i = 0; i < 40 && LG.contrast(c, PAL_PAGE) < PAL_FILL_MIN; i++) c = palMix(c, "#ffffff", 0.08);
    return c;
  }
  function palClampInk(hex) {
    let c = hex;
    for (let i = 0; i < 40 && LG.contrast(c, PAL_SURFACE) < PAL_INK_MIN; i++) c = palMix(c, "#ffffff", 0.08);
    return c;
  }
  function palHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    const C = (1 - Math.abs(2 * l - 1)) * s, X = C * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - C / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = C; g = X; } else if (h < 120) { r = X; g = C; } else if (h < 180) { g = C; b = X; }
    else if (h < 240) { g = X; b = C; } else if (h < 300) { r = X; b = C; } else { r = C; b = X; }
    return palFromRgb((r + m) * 255, (g + m) * 255, (b + m) * 255);
  }
  function palToHsl(hex) {
    const c = palRgb(hex).map((v) => v / 255);
    const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === c[0]) h = (c[1] - c[2]) / d + (c[1] < c[2] ? 6 : 0);
      else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
      else h = (c[0] - c[1]) / d + 4;
      h *= 60;
    }
    return { h, s, l };
  }
  // A team with nothing on file still deserves an identity — eight teams that all render in the
  // app accent are eight teams that look the same. The hue wheel is keyed on the team NUMBER,
  // so it is stable forever and identical on every device, and it starts on BLUE rather than
  // red so a default never impersonates the app's own alarm colour.
  const PAL_DEFAULT_HUES = [210, 14, 145, 275, 34, 190, 320, 96, 250, 52, 168, 300];
  function palDefaultFor(id) {
    const n = Number(id);
    const h = PAL_DEFAULT_HUES[(Number.isFinite(n) ? Math.abs(Math.trunc(n)) : 0) % PAL_DEFAULT_HUES.length];
    return { primary: palHsl(h, 0.54, 0.42), secondary: palHsl(h + 26, 0.44, 0.26), tertiary: palHsl(h + 174, 0.58, 0.62) };
  }
  // Old team docs (and any logo that only ever yielded one bucket) carry a primary alone. The
  // two companions are DERIVED from it rather than left empty, so those teams get the same
  // three-colour treatment as everyone else without a migration.
  function palDeriveFrom(primary) {
    const c = palToHsl(primary);
    return {
      secondary: palHsl(c.h + 22, Math.max(0.25, c.s * 0.85), Math.max(0.14, c.l * 0.52)),
      tertiary: palHsl(c.h + 172, Math.max(0.3, c.s * 0.9), Math.min(0.72, Math.max(0.5, c.l * 1.5))),
    };
  }
  // THE one derivation. Render sites call this and then LG.palStyle(); none of them reads
  // team.colors, and section AM asserts that by reading the source.
  LG.teamPalette = function (t) {
    const raw = (t && t.colors) || {};
    const def = palDefaultFor(t ? (t.id != null ? t.id : t.teamId) : 0);
    const p0 = palHex(raw.primary) || def.primary;
    const derived = palHex(raw.primary) ? palDeriveFrom(p0) : def;
    const s0 = palHex(raw.secondary) || derived.secondary;
    const t0 = palHex(raw.tertiary) || derived.tertiary;
    // WYSIWYG FOR HAND-PICKS (2026-08-11, user: "I pick a very dark color in the selector and
    // it comes out much lighter"): the fill clamp brightens toward white until a colour clears
    // a contrast floor against the near-black page — the right guardrail for a MACHINE-
    // EXTRACTED palette (extraction is a guess, and a muddy guess needs rescuing), and exactly
    // the wrong move for a colour a person chose on purpose. With colorsCustom latched, a
    // slot the OWNER's own hex filled renders VERBATIM (their deliberate dark navy is their
    // deliberate dark navy — legibility is their call to make, the reader-is-law posture);
    // slots still DERIVED (a custom primary with untouched companions) keep the clamp, and so
    // does palClampInk below — a team colour used AS TEXT on a dark surface is a legibility
    // contract, not a fill, and stays protected for everyone.
    const custom = !!(t && t.colorsCustom);
    const primary = custom && palHex(raw.primary) ? p0 : palClampFill(p0);
    const secondary = custom && palHex(raw.secondary) ? s0 : palClampFill(s0);
    const tertiary = custom && palHex(raw.tertiary) ? t0 : palClampFill(t0);
    return {
      raw: { primary: p0, secondary: s0, tertiary: t0 },
      primary, secondary, tertiary,
      ink: LG.inkOn(primary), ink2: LG.inkOn(secondary), ink3: LG.inkOn(tertiary),
      onDark: palClampInk(p0), onDark2: palClampInk(s0), onDark3: palClampInk(t0),
      custom: !!(t && t.colorsCustom),
      isDefault: !palHex(raw.primary),
    };
  };
  // The palette as CSS custom properties, for an inline style attribute. Every tinted rule in
  // league.html reads these vars and nothing else, so a render site is one call and can never
  // invent its own colour rules.
  LG.palStyle = function (pal) {
    return "--tp:" + pal.primary + ";--ts:" + pal.secondary + ";--tt:" + pal.tertiary
      + ";--ti:" + pal.ink + ";--ti2:" + pal.ink2
      + ";--tpd:" + pal.onDark + ";--tsd:" + pal.onDark2 + ";--ttd:" + pal.onDark3;
  };
  LG.teamStyle = function (t) { return LG.palStyle(LG.teamPalette(t)); };

  // ---------------- OWNER PINs (S1, 2026-08-10) ----------------
  // A claim used to be "tap your team, type a name" — so on a shared iPad, or on any sibling's
  // phone, anyone could take anyone's team and then set its lineup. The team doc now carries a
  // `pinHash` (the SAME sha256(pin + ":" + LG.PASS) the commissioner PIN and the family app's
  // dadAuth both use), set by whoever claims the team first and demanded of every device that
  // claims it afterwards. Family-grade, same posture as the commissioner PIN above.
  //
  // The hash is read FRESH at every check rather than off the in-memory team list: a
  // commissioner may have reset it seconds ago on another device, and the whole point of the
  // reset is that the next claim is not gated on a hash nobody knows any more.
  LG.teamPinHash = async function (teamId) {
    let doc = null;
    try { doc = await LG.db.getFresh("team_" + Number(teamId)); } catch (e) { doc = null; }
    if (doc) return doc.pinHash || "";
    const t = LG.teamById(teamId); // offline: the last thing we read is better than nothing
    return (t && t.pinHash) || "";
  };
  LG.verifyTeamPin = async function (teamId, pin) {
    const have = await LG.teamPinHash(teamId);
    if (!have) return true; // no PIN set — nothing to prove (the claim flow sets one instead)
    return (await sha256Hex(String(pin) + ":" + LG.PASS)) === have;
  };
  // A PIN is at least 4 digits. Stated in the prompt, enforced here, so "1" can never become
  // somebody's team lock.
  LG.validPin = (pin) => /^\d{4,}$/.test(String(pin || "").trim());
  LG.setTeamPin = async function (teamId, pin, extra) {
    const pinHash = await sha256Hex(String(pin) + ":" + LG.PASS);
    await LG.saveTeam({ teamId: Number(teamId), pinHash, ...(extra || {}) });
    return pinHash;
  };
  // Commissioner reset. Written as "" rather than deleted: LG.db.set is a MERGE (a Firestore
  // PATCH with an updateMask), so an absent key would leave the old hash standing on the
  // server — the one shape this must never have.
  LG.clearTeamPin = async function (teamId) {
    await LG.saveTeam({ teamId: Number(teamId), pinHash: "" });
  };

  // ---------------- THE COMMISSIONER'S RULING, RULE 2 — MATHEMATICAL FINALITY (2026-08-20) ---
  // A pure function — no LG.data/D.S read here at all. Callers (the matchup page, the
  // matchup-list card, the standings' provisional overlay) build the per-STARTING-SLOT
  // {pts, done} arrays from D.livePts/D.gameDone (BENCH/IR excluded — only starters score; an
  // empty slot is {pts:0, done:true}, same reasoning as a bye: it can never add).
  //
  // bankedOf sums FLOORED points over players who are DONE — their number cannot go any lower,
  // so it is this side's guaranteed MINIMUM. totalOf sums FLOORED points over EVERYONE, done or
  // not — the live total right now, which is this side's guaranteed MAXIMUM only once every one
  // of its players is done (a not-done player's score can still rise, so totalOf(a live side) is
  // not a ceiling on anything). LG.floorPts is what makes the theorem hold: a not-done player
  // contributes >= 0 to whatever he adds later, never a negative correction, so bankedOf(A) can
  // only ever be a real floor under A's eventual total.
  LG.bankedOf = (side) => (side || []).reduce((s, p) => s + (p.done ? LG.n(LG.floorPts(p.pts)) : 0), 0);
  LG.totalOf = (side) => (side || []).reduce((s, p) => s + LG.n(LG.floorPts(p.pts)), 0);
  // Decided for A <=> every B player is done (B's total is now fixed) AND bankedOf(A) already
  // beats that fixed number — A's own not-done players can only ever add, never subtract, so A's
  // guaranteed minimum already clearing B's guaranteed maximum makes the outcome a certainty, not
  // a projection. Symmetric for B. Both sides all-done: the winner is whoever's fixed total is
  // higher; an exact tie is decided with no winner (no star for either side) — the arithmetic
  // gave a real answer, it just happens to be a draw. The TRAILING side having ANY not-done
  // player refuses decision no matter the gap: a live player has no upside bound, so nothing
  // about his side can be called fixed yet.
  LG.matchupDecided = function (sideA, sideB) {
    const a = sideA || [], b = sideB || [];
    // VACUOUS FINALITY, the season-reset fallout (2026-08-26). Array.prototype.every on an
    // empty array is true BY DEFINITION — "every player is done" holds vacuously for a side
    // with nobody on it. The commissioner emptied every 2026 roster on 2026-08-23, so every
    // matchup this week is empty-vs-empty: aDone/bDone both went true for free, totalOf both
    // sides read 0, and this returned {decided:true, winner:null} — a DECIDED 0-0 TIE. The
    // provisional standings overlay (lg-ui.js) counted that tie for every matchup in the
    // league, and the "* Provisional" footnote rendered for a season that hadn't started.
    // A side with nobody on it hasn't gone 0-0 and finished — it has made no claim at all.
    // matchupSides (lg-ui.js) was changed alongside this to OMIT an unfilled starter slot
    // from the array entirely, rather than padding it with {pts:0, done:true} — the two forms
    // are mathematically identical everywhere below (an omitted entry contributes nothing to
    // bankedOf/totalOf and can never make every() false, exactly like a done/0 placeholder), so
    // a REAL bye/empty-slot on an otherwise-populated side is still "done, contributes zero" —
    // pinned by its own existing (d) check below. The two arrays can only BOTH come back empty
    // when NEITHER side has a single rostered starter, which is exactly the nobody-plays case
    // this guard exists for.
    if (a.length + b.length === 0) return { decided: false, winner: null };
    const aDone = a.every((p) => p.done);
    const bDone = b.every((p) => p.done);
    if (aDone && bDone) {
      const totalA = LG.totalOf(sideA), totalB = LG.totalOf(sideB);
      if (totalA === totalB) return { decided: true, winner: null };
      return { decided: true, winner: totalA > totalB ? "A" : "B" };
    }
    if (bDone && LG.bankedOf(sideA) > LG.totalOf(sideB)) return { decided: true, winner: "A" };
    if (aDone && LG.bankedOf(sideB) > LG.totalOf(sideA)) return { decided: true, winner: "B" };
    return { decided: false, winner: null };
  };

  // Standings derived from finalized "weekly" docs (there are none yet pre-S2
  // finalization — every team reads 0-0-0 until then). Moved here (was a
  // private helper inside lg-ui's renderLeague) because S3 waiver priority
  // needs the exact same numbers for its tie-break.
  // REGULAR SEASON ONLY (week <= rules.seasonWeeks — S7): playoff weeks are a
  // separate single-elimination bracket, not more regular-season record — a
  // team's semifinal win must never inflate the standings/waiver-priority
  // numbers after seeding has already locked in. Playoff results still feed
  // the record book/head-to-head (LG.recordBook/headToHead read ALL weekly
  // docs) and, of course, LG.buildBracket's own seeding (which only ever
  // runs once weeks 1..seasonWeeks exist, before any playoff week does).
  // ================= THE ZOMBIE WEEKLY DOC, AND HOW THE ENGINE HEALS ITSELF (2026-09-02) =====
  // TWICE in one week (2026-08-30 and 2026-09-01) a family device still running a pre-guard
  // build wrote `weekly_2026_w1` as four 0-0 ties out of its own boot auto-checks, off the
  // season-reset's empty rosters. Both were backed up and deleted BY HAND. That repair does not
  // scale and it does not close the hole: a phone that has not reloaded is still running the old
  // engine, and the weekly doc is CREATE-ONLY — so a zombie written after the last manual
  // cleanup would make the REAL finalize on Sep 14 bounce off it with "already finalized", and
  // the week's true result would be unrecoverable.
  //
  // So the engine recognises the shape and treats it as ABSENT everywhere, and finalizeWeek
  // REPLACES it rather than refusing. The test is deliberately narrow and needs BOTH halves:
  //   · every matchup scored 0-0 on both sides, AND
  //   · every power-ranking score is 0 (score = 4·wins + 0.05·PF + 2·last3, so a single real
  //     win puts a team at 4 and a single real point puts somebody above zero — a genuinely
  //     played week cannot have an all-zero power table).
  // A doc that carries no power table at all falls back to the matchup half alone (that is the
  // shape a hand-seeded fixture has, and the shape the two real zombies had).
  // WHAT MAKES THIS SAFE rather than a guess: since the 2026-08-31 `empty-week` guard and the
  // `empty-matchup` guard beside it (2026-09-02, S6), no path in this file — commissioner force
  // included — can WRITE an all-zero week any more. The only documents that can now match this
  // shape are the zombies, and any future one an un-reloaded device mints.
  LG.weeklyIsVoid = function (doc) {
    if (!doc || doc.kind !== "weekly") return false;
    const ms = Array.isArray(doc.matchups) ? doc.matchups : [];
    if (!ms.length) return true; // a "finalized" week with no matchups at all is not a result
    if (!ms.every((m) => LG.n(m.homePts) === 0 && LG.n(m.awayPts) === 0)) return false;
    const power = Array.isArray(doc.power) ? doc.power : [];
    if (power.length && !power.every((p) => LG.n(p.score) === 0)) return false;
    return true;
  };
  // Every weekly-doc reader in this file goes through here instead of LG.db.list("weekly"), so
  // "treat a void doc as absent" is one rule in one place rather than eight copies.
  LG.loadWeeklyDocs = async function () {
    return (await LG.db.list("weekly")).filter((wd) => !LG.weeklyIsVoid(wd));
  };
  LG.loadStandings = async function () {
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    const weekly = (await LG.loadWeeklyDocs()).filter((wd) => (wd.week || 0) <= sw);
    const st = {};
    for (const t of LG.teams) st[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    for (const wd of weekly) {
      for (const m of (wd.matchups || [])) {
        const [h, a] = [m.home, m.away];
        if (!st[h] || !st[a]) continue;
        // LG.n() at every accumulation (2026-08-09): a matchup written without points would
        // otherwise turn this team's PF into NaN for the rest of the season's table.
        st[h].pf += LG.n(m.homePts); st[h].pa += LG.n(m.awayPts);
        st[a].pf += LG.n(m.awayPts); st[a].pa += LG.n(m.homePts);
        if (m.homePts > m.awayPts) { st[h].w++; st[a].l++; }
        else if (m.awayPts > m.homePts) { st[a].w++; st[h].l++; }
        else { st[h].t++; st[a].t++; }
      }
    }
    return st;
  };
  // ---------------- desktop standings: streak · power rank · playoff odds (2026-08-11) ----------------
  // The desktop League tab's standings table carries three columns the mobile one doesn't
  // (STREAK / PWR / PLAYOFF %). All three are DERIVED — nothing new is persisted, and every read
  // below is a cached list()/get() the league home has already made, so section P's
  // zero-extra-reads budget is untouched.
  //
  // A team's CURRENT run of results — "W3", "L2", "—" — read from the finalized weekly docs
  // newest week first. REGULAR SEASON ONLY, for exactly LG.loadStandings' own reason: a
  // semifinal win is not more regular-season record.
  LG.loadStreaks = async function () {
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    const weekly = (await LG.loadWeeklyDocs())
      .filter((wd) => (wd.week || 0) <= sw)
      .sort((a, b) => (b.week || 0) - (a.week || 0)); // newest first — the run reads backwards
    const out = {};
    for (const t of LG.teams) out[t.id] = null;
    const closed = {}; // the run has already been broken for this team — stop extending it
    for (const wd of weekly) {
      for (const m of (wd.matchups || [])) {
        for (const side of [[m.home, m.homePts, m.awayPts], [m.away, m.awayPts, m.homePts]]) {
          const id = side[0];
          if (!(id in out) || closed[id]) continue;
          const mine = LG.n(side[1]), theirs = LG.n(side[2]);
          const k = mine > theirs ? "W" : theirs > mine ? "L" : "T";
          if (!out[id]) out[id] = { k, n: 1 };
          else if (out[id].k === k) out[id].n++;
          else closed[id] = true;
        }
      }
    }
    return out;
  };
  LG.fmtStreak = (s) => (s && s.n ? s.k + s.n : "—");
  // The power-rankings LIST, extracted from lg-ui's powerRankingsHtml so the card (mobile) and
  // the standings table's PWR column (desktop) can never disagree about a team's rank — one
  // computation, two readers. Null until at least one week carries a real `power` snapshot.
  LG.powerRanking = function (weeklyDocs) {
    // The void filter is applied HERE as well as at every list() site, because this one is a
    // PURE function whose docs come from the caller — lg-ui hands it UI._allWeekly, read
    // straight off LG.db.list("weekly") in a file this change does not touch.
    const sorted = [...(weeklyDocs || [])]
      .filter((w) => w && Array.isArray(w.power) && w.power.length && !LG.weeklyIsVoid(w))
      .sort((a, b) => b.week - a.week);
    const latest = sorted[0];
    if (!latest) return null;
    const prior = sorted.find((w) => w.week === latest.week - 1);
    const rows = [...latest.power].sort((a, b) => a.rank - b.rank).map((r) => {
      const prev = prior ? (prior.power.find((p) => p.teamId === r.teamId) || {}).rank : null;
      return { teamId: r.teamId, rank: r.rank, score: r.score, prevRank: prev == null ? null : prev };
    });
    return { week: latest.week, rows };
  };
  // PLAYOFF ODDS — a Monte Carlo over the games that are actually left, seeded so it can never
  // flicker. 1000 seasons; each remaining scheduled game is decided by an Elo-shaped coin
  // (P(i beats j) = 1/(1+10^-((s_i-s_j)/40))) whose strengths are each team's average points-for
  // over its FINALIZED weeks, pulled toward the league mean by a one-game Bayesian prior so a
  // single week-1 blowout can't declare a season.
  //
  // DETERMINISTIC BY CONSTRUCTION: the PRNG is seeded from a hash of the exact data state
  // (season, spots, every team's W-L-PF, how many games remain), and the answer is cached under
  // that same key — so two renders of the same board return the identical object and the column
  // never changes under the reader's eye. A new finalized week changes the key, and only then.
  //
  // PRE-SEASON IS NOT A BUG: with nothing finalized every strength is the same prior, so every
  // game is a coin flip and eight teams chasing five spots land near 62% each. That is the
  // honest answer to "who makes the playoffs" before a ball is thrown.
  const PO_SIMS = 1000, PO_PRIOR_W = 1, PO_PRIOR_PTS = 100, PO_SCALE = 40, PO_PF_NOISE = 20;
  function poHash(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function poRng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  LG.playoffOdds = async function () {
    const rules = LG.rules || LG.DEFAULT_RULES;
    const sw = rules.seasonWeeks;
    const ids = LG.teams.map((t) => t.id).sort((a, b) => a - b);
    const spots = Math.max(0, Math.min((rules.playoffs || {}).teams || 0, ids.length));
    if (!ids.length || !spots) return {};
    const weekly = (await LG.loadWeeklyDocs()).filter((wd) => (wd.week || 0) <= sw);
    const finalized = new Set(weekly.map((wd) => wd.week));
    const base = {};
    for (const id of ids) base[id] = { w: 0, pf: 0, g: 0 };
    for (const wd of weekly) {
      for (const m of (wd.matchups || [])) {
        const h = base[m.home], a = base[m.away];
        if (!h || !a) continue;
        const hp = LG.n(m.homePts), ap = LG.n(m.awayPts);
        h.pf += hp; a.pf += ap; h.g++; a.g++;
        if (hp > ap) h.w++; else if (ap > hp) a.w++;
      }
    }
    const weeks = await LG.loadSchedule();
    const rem = [];
    for (let w = 1; w <= sw; w++) {
      if (finalized.has(w)) continue;
      for (const g of ((weeks && weeks[w - 1]) || [])) {
        if (base[g[0]] && base[g[1]]) rem.push([g[0], g[1]]);
      }
    }
    let totPF = 0, totG = 0;
    for (const id of ids) { totPF += base[id].pf; totG += base[id].g; }
    const mean = totG ? totPF / totG : PO_PRIOR_PTS;
    const s = {};
    for (const id of ids) s[id] = (base[id].pf + PO_PRIOR_W * mean) / (base[id].g + PO_PRIOR_W);
    const key = [LG.SEASON, sw, spots, rem.length, ids.join(",")].concat(
      ids.map((id) => id + ":" + base[id].w + ":" + Math.round(base[id].pf * 10) + ":" + base[id].g)).join("~");
    if (LG._poCache && LG._poCache.key === key) return LG._poCache.odds;
    const rnd = poRng(poHash(key));
    const counts = {}, wSim = {}, pfSim = {};
    for (const id of ids) counts[id] = 0;
    for (let n = 0; n < PO_SIMS; n++) {
      for (const id of ids) { wSim[id] = base[id].w; pfSim[id] = base[id].pf; }
      for (const g of rem) {
        const h = g[0], a = g[1];
        const p = 1 / (1 + Math.pow(10, -((s[h] - s[a]) / PO_SCALE)));
        if (rnd() < p) wSim[h]++; else wSim[a]++;
        // Simulated points-for, so the app's OWN seeding tiebreak (wins → PF → teamId) still
        // decides a tie. The noise is what keeps it from collapsing onto the teamId tiebreak in
        // the pre-season case, where every strength is identical.
        pfSim[h] += s[h] + (rnd() - 0.5) * PO_PF_NOISE;
        pfSim[a] += s[a] + (rnd() - 0.5) * PO_PF_NOISE;
      }
      // The app's own seeding rules — the same sort LG.buildBracket uses.
      const order = ids.slice().sort((x, y) => (wSim[y] - wSim[x]) || (pfSim[y] - pfSim[x]) || (x - y));
      for (let i = 0; i < spots; i++) counts[order[i]]++;
    }
    const odds = {};
    for (const id of ids) {
      const c = counts[id];
      // A LOCK is only ever reported when EVERY simulated season agreed. 99.6% rounding up to
      // "100%" would be the app claiming a clinch it hasn't got.
      odds[id] = c === PO_SIMS ? 100 : c === 0 ? 0 : Math.min(99, Math.max(1, Math.round((c / PO_SIMS) * 100)));
    }
    LG._poCache = { key, odds };
    return odds;
  };
  // Waiver priority order, WORST record first (plan §4.3's FAAB tie-break):
  // fewer wins, then fewer points-for, then lower teamId — deterministic even
  // on an untouched 0-0-0 season.
  LG.waiverPriorityOrder = async function () {
    const st = await LG.loadStandings();
    return LG.teams.map((t) => t.id).sort((a, b) => {
      const A = st[a] || { w: 0, pf: 0 }, B = st[b] || { w: 0, pf: 0 };
      return (A.w - B.w) || (A.pf - B.pf) || (a - b);
    });
  };
  // FAAB budget lives on the team doc; a team that's never spent reads full.
  LG.teamFaab = (t) => (t && t.faab != null ? t.faab : (LG.rules || LG.DEFAULT_RULES).waivers.budget);

  // ---------------- schedule ----------------
  // Double round robin for 8 teams by the circle method: 7 rounds twice = 14
  // weeks, everyone plays everyone twice, home/away flipped in the rematch.
  LG.generateSchedule = function (teamIds, weeks) {
    const ids = [...teamIds];
    if (ids.length % 2) ids.push(null);
    const n = ids.length, rounds = n - 1;
    const fixed = ids[0], rot = ids.slice(1);
    const singles = [];
    for (let r = 0; r < rounds; r++) {
      const wk = [];
      const row = [fixed, ...rot];
      for (let i = 0; i < n / 2; i++) {
        const a = row[i], b = row[n - 1 - i];
        if (a != null && b != null) wk.push(r % 2 ? [a, b] : [b, a]);
      }
      singles.push(wk);
      rot.unshift(rot.pop());
    }
    const out = [];
    for (let w = 0; w < (weeks || rounds * 2); w++) {
      const base = singles[w % rounds];
      out.push(w < rounds ? base : base.map(([h, a]) => [a, h]));
    }
    return out; // [week][game] = [homeId, awayId]
  };
  // ---------------- ⭐ ITEM 31: fill every roster from the backup pool (2026-08-09) ----------
  // A PURE function — no DOM, no network, no clock, no LG.db — so it can be asserted directly
  // and so re-running it against the same directory produces byte-identical rosters on every
  // device. lg-data's D.backupPool supplies the ordered pool; lg-ui wires the button and the
  // confirm step. It lives here beside generateSchedule because it is the same kind of thing:
  // a deterministic league-shaped builder.
  //
  // SNAKE ORDER is what makes the distribution even. The pool is strictly best-first, so a
  // straight repeated pass would hand team 1 the best player at every single position; snaking
  // (forward on even rounds, reversed on odd) means the team that picks last in one round picks
  // first in the next. Team ids are SORTED for the same reason runSimSetup sorts them before
  // generating a schedule — LG.teams' own order comes off a backend list() and is not stable
  // between devices, and a snake is order-sensitive.
  //
  // Every team gets exactly the same slot script, so the rosters are identical in SHAPE as well
  // as size. `short` names any slot the pool ran dry on rather than silently handing some teams
  // fewer players — an honest partial, reported, never a silent one.
  LG.buildBackupRosters = function (arg) {
    const roster = (arg && arg.roster) || LG.DEFAULT_RULES.roster;
    const pool = (arg && arg.pool) || [];
    const defenses = ((arg && arg.defenses) || []).slice();
    const ids = ((arg && arg.teamIds) || []).slice().sort((a, b) => a - b);
    // The pick script: one entry per roster spot, in the order they are drafted. IR is
    // deliberately absent — those three spots take genuinely-out players only (LG.irEligible),
    // and this pool excludes them on purpose.
    const script = [];
    for (const s of ["QB", "RB", "WR", "TE", "FLEX", "DST", "K"]) {
      for (let i = 0; i < (roster[s] || 0); i++) script.push(s);
    }
    for (let i = 0; i < (roster.BENCH || 0); i++) script.push("BENCH");

    const q = { QB: [], RB: [], WR: [], TE: [], K: [] };
    // _i falls back to the pool's own index, so a hand-built pool (or one that came through a
    // JSON round trip, which drops nothing but is easy to forget) still orders correctly.
    pool.forEach((p, i) => { if (q[p.pos]) q[p.pos].push({ ...p, _i: p._i != null ? p._i : i }); });
    // "The best remaining across these positions" — every queue shares one global order, so
    // comparing their heads by _i is the whole comparison. This is what FLEX and the bench need.
    const take = (positions) => {
      let best = null, bestPos = null;
      for (const pos of positions) {
        const head = q[pos] && q[pos][0];
        if (head && (best === null || head._i < best._i)) { best = head; bestPos = pos; }
      }
      if (!best) return null;
      q[bestPos].shift();
      return best;
    };
    const out = {}; ids.forEach((id) => { out[id] = []; });
    const short = [];
    for (let r = 0; r < script.length; r++) {
      const slot = script[r];
      const order = r % 2 === 0 ? ids : ids.slice().reverse();
      for (const id of order) {
        const p = slot === "DST" ? defenses.shift()
          : slot === "FLEX" ? take(["RB", "WR", "TE"])
            : slot === "BENCH" ? take(["QB", "RB", "WR", "TE", "K"])
              : take([slot]);
        if (!p) { if (!short.includes(slot)) short.push(slot); continue; }
        out[id].push({ key: p.key, name: p.name, pos: p.pos, team: p.team, slot, injury: p.injury || "" });
      }
    }
    return { rosters: out, size: script.length, short, teamIds: ids };
  };

  // generateSchedule's in-memory shape ([week][game] = [homeId, awayId]) is an array
  // DIRECTLY containing arrays two levels deep — weeks[i] is itself an array of [h,a]
  // pairs. Cloud Firestore's document model explicitly forbids an array value containing
  // another array value (verified live against the real project: setDoc throws "Nested
  // arrays are not allowed"), so saving `weeks` raw silently threw inside the #schedGen
  // click handler on the deployed (cloud-backend) site — no toast, no saved schedule, the
  // button just "didn't work." Every suite run stays in LOCAL mode (firestore.googleapis.com
  // is aborted), so localStorage's plain JSON.stringify never caught this. The REST codec
  // (fsEnc, above) now THROWS on a nested array rather than letting one reach the wire.
  // Fix at the boundary only: encode each week as {g:[{h,a},...]} for storage (array of
  // MAPS, never array-of-array) and decode back to the raw [[h,a],...] shape every reader
  // in this file already expects — old/seeded docs still holding the raw array shape are
  // read as-is for backward compatibility.
  LG.loadSchedule = async () => {
    const weeks = (await LG.db.get("sched_" + LG.SEASON))?.weeks;
    if (!weeks) return null;
    return weeks.map((wk) => (Array.isArray(wk) ? wk : (wk.g || []).map((g) => [g.h, g.a])));
  };
  LG.saveSchedule = (weeks) => LG.db.set("sched_" + LG.SEASON, {
    kind: "sched", season: LG.SEASON,
    weeks: weeks.map((wk) => ({ g: wk.map(([h, a]) => ({ h, a })) })),
  });

  // ---------------- rosters & lineups ----------------
  // One doc per team per week: { players: [{key,name,pos,team,slot}] }. `slot`
  // is a roster slot name (QB/RB/WR/TE/FLEX/DST/K/BENCH/IR). Week N+1 starts
  // as a copy of week N (done lazily by ensureRoster).
  // opts.fresh bypasses LG.db's cache. EVERY read that precedes a roster WRITE takes it
  // (adversarial review 2026-08-08, finding 4): saveRoster replaces the whole players array,
  // so a lineup tap, a trade or a waiver run computed from a cached pre-transaction roster
  // silently undoes whatever landed in between — with the FAAB still spent and the tx log
  // still narrating the move.
  LG.rosterId = (week, teamId) => `roster_${LG.SEASON}_w${week}_t${teamId}`;
  // Every roster read and write funnels its player list through the data layer's id registry
  // (2026-08-09, the "everything reads 0" bug): the pollers key a Sleeper stat row onto the
  // ROSTER's own key by (name, team), and D.pidForKey resolves the other direction the same
  // way — both need to know who is rostered, and this is the one place that is true for every
  // caller (loadWeekRosters, ensureRoster's copy-forward, the ESPN import, a waiver add).
  function registerRoster(players) {
    try { if (players && LG.data && LG.data.registerRosterPlayers) LG.data.registerRosterPlayers(players); } catch (e) {}
    return players;
  }
  LG.loadRoster = async function (week, teamId, opts) {
    const id = LG.rosterId(week, teamId);
    const doc = opts && opts.fresh ? await LG.db.getFresh(id) : await LG.db.get(id);
    return registerRoster(doc?.players || null);
  };
  LG.saveRoster = (week, teamId, players) => {
    registerRoster(players);
    return LG.db.set(LG.rosterId(week, teamId), { kind: "roster", week, teamId, players });
  };
  // ---------------- THE ROSTER COMPARE-AND-SWAP (2026-08-18) ----------------
  // LG.saveRoster replaces the WHOLE players array, which is why two owners' roster moves used
  // to be able to erase each other (the seam suite's C4: a trade and a waiver run touching one
  // roster, one write landing on top of the other with no complaint from anybody). Every write
  // that CHANGES a roster now goes through here instead: `mutate` is handed the players array
  // as it stands in the store this instant, and returns the array to write — so the change is
  // re-applied to the truth on every attempt rather than computed once against a snapshot.
  //
  //   mutate(players|null) -> nextPlayers | null (abort, nothing written)
  //
  // MUST BE PURE AND REENTRANT — see LG.db.update's own warning; it can run six times.
  // Express the change as a DELTA against the argument ("drop this key, add this man"), never
  // as "here is the array I computed earlier": an absolute array is a lost update wearing a
  // compare-and-swap.
  async function rosterUpdate(week, teamId, mutate) {
    const r = await LG.db.update(LG.rosterId(week, teamId), (cur) => {
      const next = mutate((cur && cur.players) || null);
      if (next == null) return null;
      return { kind: "roster", week, teamId, players: next };
    });
    if (r.ok) registerRoster(r.doc.players); // the id registry still sees every roster write
    return r;
  }
  LG._rosterUpdate = rosterUpdate; // test hook — the seam suite stages two writers against it
  LG.ensureRoster = async function (week, teamId, opts) {
    let p = await LG.loadRoster(week, teamId, opts);
    if (p) return p;
    for (let w = week - 1; w >= 1 && !p; w--) p = await LG.loadRoster(w, teamId, opts);
    // Copying a previous week forward is a CONVENIENCE write, not the answer itself — on a
    // read-only mirror the roster still resolves in memory, it just isn't persisted (and
    // must not raise the "you're offline" toast, which is for what a PERSON tried to do).
    //
    // ⭐ SEASON-SIM BUG 1 (2026-08-11): this write used to be BLIND, and it is by far the most
    // common roster write in a season (measured: 551 of 622). The absence that gets here is
    // usually derived, not observed — loadWeekRosters() lists the whole "roster" kind up front
    // precisely so knownAbsent() can answer get(rosterId) as null with NO round trip (that is
    // the "absence is free" perf note over there), so a list snapshot taken seconds ago is what
    // says "week N has no roster yet". Meanwhile another device wins a waiver, or an owner sets
    // a lineup, and writes that very doc. This render then copied week N-1 forward straight
    // over it: waiver results silently undone, and — because the previous week still held the
    // dropped player while the new roster held the added one — a player on TWO teams for the
    // rest of the season. So the write takes the same getFresh-before-write guard the five
    // idempotency guards elsewhere in this file take. The cost is bounded to the WRITE path:
    // a roster that already exists returned at the top, from cache, for free.
    //
    // ⭐ …AND THE GUARD WAS STILL A CHECK-THEN-ACT (2026-09-02, S7). The getFresh above and the
    // saveRoster below are two separate round trips: another device that creates this exact doc
    // in the window between them is overwritten by the copy-forward anyway, which is the same
    // lost update, narrowed. The primitive to close it has existed since 2026-08-18, so this is
    // now ONE create-only compare-and-swap — `cur ? null : {the copied week}`. The server
    // refuses the write if the doc exists, and the abort hands back the doc it refused against,
    // which is the roster this call should have adopted in the first place. Two devices copying
    // the same week forward at the same instant therefore produce ONE document, and both get it.
    if (p && !LG.mirrorOffline) {
      const r = await LG.db.update(LG.rosterId(week, teamId), (cur) => (cur ? null : { kind: "roster", week, teamId, players: p }));
      if (!r.ok) {
        const adopted = (r.doc && r.doc.players) || null;
        if (adopted) return registerRoster(adopted); // it existed after all — adopt it, never overwrite it
      } else registerRoster(p);
    }
    return p || [];
  };

  // Slot eligibility: which roster slots can a player of position P fill?
  LG.slotEligible = function (pos, slot) {
    if (slot === "BENCH") return true;
    if (slot === "IR") return false; // IR checked separately (injury-gated)
    if (slot === "FLEX") return pos === "RB" || pos === "WR" || pos === "TE";
    return pos === slot;
  };
  // The 3 IR spots take genuinely-out players only (standard rule).
  //
  // ⭐ THE VOCABULARY, WRITTEN OUT AND CASE-INSENSITIVE (2026-09-02, S8). The old form was an
  // EXACT-STRING `.includes()` over seven spellings, and the app reads two upstreams that do not
  // agree on any of them. Measured (scratchpad probe6_misc.cjs): a genuinely-hurt man parked on
  // IR whose designation came through the ESPN import as "OUT" read HEALTHY — so LG.illegalIR
  // flagged him as an illegal stash and BLOCKED that team from every acquisition (faAdd,
  // addClaim, processWaivers, executeTrade all refuse "ir-illegal"), for a stash that was
  // perfectly legal. The table below is every spelling the two feeds actually emit for "this man
  // is not available", written explicitly rather than inferred:
  //   Sleeper `injury_status`  : "Out", "Doubtful", "IR", "PUP", "NFI", "Sus"
  //   ESPN    `injuryStatus`   : "OUT", "DOUBTFUL", "INJURY_RESERVE", "SUSPENSION"
  //   single-letter shorthands : "O", "D" (what LG.injLabel renders, and what some rows carry raw)
  // Everything is lowercased and trimmed before the lookup, so case and stray whitespace are
  // irrelevant and a future feed's "Injury_Reserve" resolves the same way.
  // DELIBERATELY NOT ELIGIBLE, and this is the anti-vacuity half: "Questionable" (a Q plays most
  // weeks — parking him on IR is exactly the extra-roster-spot abuse the rule exists to stop),
  // "ACTIVE"/"Healthy"/"" (nothing wrong with him at all), and Sleeper's ambiguous "NA"/"COV"/
  // "DNR", which are not on the commissioner's list and are not reliably "out".
  const IR_ELIGIBLE = new Set([
    "out", "o",
    "doubtful", "d",
    "ir", "injury_reserve", "injuryreserve",
    "pup",
    "nfi",
    "sus", "susp", "suspension", "suspended",
  ]);
  LG.irEligible = (injury) => IR_ELIGIBLE.has(String(injury == null ? "" : injury).trim().toLowerCase());
  LG.IR_ELIGIBLE = IR_ELIGIBLE; // test hook — the suite asserts the table itself, not a re-derivation

  // ⭐ ONE MAN, TWO KEYS (2026-09-02, the ownership belt). A GFFL roster keys a player by
  // whichever id the source that seeded it had: the ESPN import writes his numeric ESPN id, and
  // anything resolved through the Sleeper directory writes `slp_<pid>` (that prefix exists
  // PRECISELY because Sleeper only carries an espn_id for about half its directory — see the
  // 2026-08-09 identity batch). So the same footballer can sit on one roster as "4430807" and be
  // offered on the Moves page as "slp_6813", and every "is he already owned?" check in this file
  // compared RAW KEYS — which answers no, and hands two teams the same man.
  // D.pidForKey is the app's one id resolver (prefix -> espn index -> name+team off the roster),
  // and it is what makes the two spellings comparable. BOTH sides must resolve: an unresolved key
  // means "we do not know who this is", never "he is somebody else", and treating a null as a
  // match would collide every unknown key with every other one.
  LG.sameMan = function (a, b) {
    const ka = String(a == null ? "" : a), kb = String(b == null ? "" : b);
    if (ka === kb) return true;
    if (!ka || !kb) return false;
    const d = LG.data;
    if (!d || !d.pidForKey) return false;
    const pa = d.pidForKey(ka), pb = d.pidForKey(kb);
    return pa != null && pb != null && String(pa) === String(pb);
  };
  // A player's CURRENT designation, live where the engine knows it (see D.injuryFor) and the
  // roster's own stored snapshot otherwise. lg-core has no player state of its own, so this is
  // the seam — and it means the RULE below and the LOCKER's own IR affordances judge a man by
  // exactly the same value.
  LG.injuryOf = (p) => (LG.data && LG.data.injuryFor ? LG.data.injuryFor(p.key, p.injury) : (p.injury || ""));
  // ⭐ THE OTHER HALF OF THE IR RULE (2026-08-15, user: "if a player becomes healthy you can't
  // add players to your roster until you remove the now healthy player from your IR slot").
  // An IR spot is EXTRA capacity — 3 on top of the 18 — so a healthy man parked there is a
  // 19th roster spot nobody else in the league can use. The eligibility gate on the way IN
  // (LG.irEligible, enforced by the locker) cannot catch this on its own, because a man is
  // put there legitimately and then GETS BETTER; nothing about the roster changes at that
  // moment. So every ACQUISITION is blocked until the stash is resolved, which forces the
  // honest choice: bench him (costing a real roster spot) or drop him.
  // Returns the offending players, so every caller can NAME them rather than just refusing.
  LG.illegalIR = (roster) => (roster || []).filter((p) => p.slot === "IR" && !LG.irEligible(LG.injuryOf(p)));

  // ⭐ WHO CAN BE DROPPED ONCE THE BALL IS IN THE AIR (2026-08-15, user: "lets make it so you
  // can drop players from your bench even if their game has started, but you still cant drop
  // players you started until waivers clear").
  //
  // A BENCH or IR player is droppable at any time, kickoff or not — he is not earning you
  // anything this week, and freezing him only stops an owner reacting to news. A player you
  // STARTED is a different matter: dropping him mid-game is the move this rule exists to
  // prevent (your back goes down on the first drive, you cut him and grab the handcuff before
  // anyone else has seen it), so he is frozen from his own kickoff.
  //
  // "UNTIL WAIVERS CLEAR" FALLS OUT OF THE LEAGUE'S OWN RHYTHM rather than needing a second
  // clock, and this is the part worth keeping: week N runs Tue 05:00 -> Mon, and week N's
  // waiver deadline is the WEDNESDAY AT ITS START, before that week's games. So a man started
  // on Sunday is locked here for the rest of week N (free agency is open, adds are instant —
  // exactly when the block has to bite). When the week rolls on Tuesday he is a week N+1
  // player whose N+1 game has not kicked off, so he unfreezes — but adds are back on the
  // blind-bid queue until Wednesday 08:00, so the earliest ANY drop of him can take effect is
  // the waiver run itself. Which is the rule, stated in the user's own words.
  const STARTING = (slot) => slot !== "BENCH" && slot !== "IR";
  LG.dropBlocked = (p) => !!p && STARTING(p.slot)
    && !!(LG.data && LG.data.gameStarted && LG.data.gameStarted(p.team));

  // How many players a roster may hold: the slot script's own total (2026-08-15). Until now
  // nothing needed it, because every add SPLICED one player out for the one coming in and the
  // roster could therefore never change size. A standalone drop makes size a real quantity.
  LG.rosterCap = () => Object.values(((LG.rules || LG.DEFAULT_RULES).roster) || {})
    .reduce((s, n) => s + (Number(n) || 0), 0);
  LG.rosterRoom = (roster) => Math.max(0, LG.rosterCap() - (roster || []).length);

  // ⭐ A STANDALONE DROP (2026-08-15, user: "the swap button wont let me drop a player that has
  // started, we need a dedicated drop button"). Swap is a LINEUP move and is correctly locked
  // at kickoff; dropping is a different act with a different rule (LG.dropBlocked), and there
  // was no way to do it at all except as the drop-side of an add on Moves.
  //
  // CAS (2026-08-18): the drop is expressed as a delta and BOTH refusals are re-judged inside
  // the loop, against the roster as it stands at the instant of the write — a man who was
  // dropped, traded away or whose game kicked off between the read and the write is refused
  // with the same reason the pre-read would have given, rather than being "dropped" out of an
  // array that no longer describes the team. The refusal is recomputed from the doc the loop
  // returns, so nothing has to be smuggled out of the mutate.
  LG.dropPlayer = async function (week, teamId, key) {
    const ros = await LG.ensureRoster(week, teamId, { fresh: true });
    const p = ros.find((x) => x.key === key);
    if (!p) return { ok: false, reason: "drop-not-found" };
    if (LG.dropBlocked(p)) return { ok: false, reason: "drop-started", players: [p.name] };
    const r = await rosterUpdate(week, teamId, (players) => {
      const cur = players || [];
      const q = cur.find((x) => x.key === key);
      if (!q || LG.dropBlocked(q)) return null;
      return cur.filter((x) => x.key !== key);
    });
    if (!r.ok) {
      const cur = (r.doc && r.doc.players) || [];
      const q = cur.find((x) => x.key === key);
      if (!q) return { ok: false, reason: "drop-not-found" };
      return { ok: false, reason: "drop-started", players: [q.name] };
    }
    // The side effect fires AFTER the loop committed — never inside a mutate that can run six
    // times, or one drop would read to the family as six transactions.
    await LG.logTx("drop", week, teamId, { dropKey: key, dropName: p.name });
    return { ok: true, name: p.name };
  };

  // ---------------- transactions log (append-only) ----------------
  // One doc per event, id tx_<t>_<rand4>. Only actual roster moves land here
  // (a losing waiver claim isn't a transaction) — kind:"tx" so LG.db.list("tx")
  // pulls the whole history.
  LG.txId = (t) => `tx_${t}_${Math.random().toString(36).slice(2, 6)}`;
  LG.logTx = async function (type, week, teamId, detail) {
    const t = Date.now();
    const id = LG.txId(t);
    await LG.db.set(id, { kind: "tx", t, week, type, teamId, detail: detail || {} });
    return id;
  };
  LG.loadTx = async function () {
    return (await LG.db.list("tx")).sort((a, b) => b.t - a.t);
  };

  // ---------------- THE ACTIVITY LEDGER (2026-09-04) ----------------
  // The transaction log above answers "what happened to the rosters". It cannot answer "who is
  // actually USING this thing" — which owner has never opened the app, who is setting a lineup
  // every Sunday, which device a kid is on, who unlocked the commissioner tools. Those are the
  // questions the commissioner asks a week into a season, and until now the only honest answer
  // was "no idea". So: a SECOND append-only ledger, one doc per event, id act_<t>_<rand4>,
  // kind:"act" so LG.db.list("act") pulls the whole thing and neither log can ever see the
  // other's rows.
  //
  // ⭐ IT IS A COURTESY, EXACTLY LIKE LG.pushNotify (read its rules below). A ledger write is
  // never the product; the ACTION is. So logAct swallows every failure — a thrown backend, a
  // read-only mirror, a localStorage that refuses, a currentWeek() that blows up — and returns
  // a promise that CANNOT reject. Callers fire it unawaited on the hot path; the two or three
  // that do await it still cannot be hurt by it. A lineup change must never be lost because
  // the log of it could not be written.
  //
  // Nothing here duplicates the tx log: fa_add / drop / waiver / trade-executed / trade-vetoed
  // are logTx's four types, and the dashboard MERGES the two ledgers rather than double-
  // counting them.
  LG.actId = (t) => `act_${t}_${Math.random().toString(36).slice(2, 6)}`;
  // A SHORT device tag, not a user-agent string. The commissioner wants "was that on the iPad
  // or the phone", not 180 characters of Chrome version — and a full UA stored per event is a
  // fingerprint this family app has no business keeping. Safe with no window and no navigator
  // (jsdom, a node harness), because logAct is called from paths that run in both.
  // KNOWN: iPadOS 13+ reports itself as "Macintosh", so an iPad reads "mac". Accepted — the
  // alternative is touch-point sniffing, which is a guess wearing a fact's clothes.
  LG.deviceTag = function () {
    let ua = "", standalone = false;
    try { ua = (typeof navigator !== "undefined" && navigator.userAgent) || ""; } catch (e) { ua = ""; }
    try {
      standalone = !!(typeof window !== "undefined" && window.matchMedia
        && window.matchMedia("(display-mode: standalone)").matches);
    } catch (e) { standalone = false; }
    try { if (typeof navigator !== "undefined" && navigator.standalone) standalone = true; } catch (e) {}
    let base = "other";
    if (/iPhone|iPad|iPod/i.test(ua)) base = "ios";
    else if (/Android/i.test(ua)) base = "android";
    else if (/Macintosh|Mac OS X/i.test(ua)) base = "mac";
    else if (/Windows/i.test(ua)) base = "win";
    return base + (standalone ? "-pwa" : "");
  };
  // Returns a promise for the SUITE's benefit (a check can await the write having landed);
  // it resolves to the doc id on success and to null on ANY failure, and never rejects.
  LG.logAct = function (type, teamId, detail) {
    let id = null, doc = null;
    // ⭐ A MIRROR IS READ-ONLY, AND HOUSEKEEPING DOES NOT ANNOUNCE ITSELF. LG.db.set on an
    // offline mirror calls refuseMirrorWrite, which raises the "You're offline" toast — and
    // LG.logOpen fires at every boot, so without this line simply OPENING the app on a mirror
    // would toast a refusal for a write nobody asked for. Skipped, not attempted: the rule this
    // file already applies to migrateCommishPin, and the reason a suite check has said since
    // 2026-08-08 that opening the app is not a mutation.
    try { if (LG.mirrorOffline) return Promise.resolve(null); } catch (e) { /* fall through and try */ }
    try {
      const t = Date.now();
      id = LG.actId(t);
      // Every field is read inside the try: each one of these is a localStorage or a rules
      // read, and any of them can throw on a locked-down device.
      doc = {
        kind: "act", t,
        week: LG.currentWeek(),
        type: String(type == null ? "" : type),
        teamId: teamId == null ? null : Number(teamId),
        actorTeam: LG.myTeamId(),
        who: LG.who() || "",
        commish: !!LG.commishUnlocked(),
        dev: LG.deviceTag(),
        detail: detail || {},
      };
    } catch (e) { return Promise.resolve(null); }
    try {
      return Promise.resolve(LG.db.set(id, doc)).then(() => id, () => null);
    } catch (e) { return Promise.resolve(null); }
  };
  LG.loadAct = async function () {
    return (await LG.db.list("act")).sort((a, b) => b.t - a.t);
  };
  // Roster KEYS are what a trade doc carries, and a key is unreadable in a sentence. This
  // resolves each one to a name through the live directory when it is loaded and falls back to
  // the key itself when it is not — never to "?", because a key at least identifies the man to
  // anyone willing to look him up. Wrapped, like everything else here: a ledger detail may not
  // be the thing that throws inside a trade.
  LG.actNames = function (keys) {
    return (keys || []).map((k) => {
      try {
        const m = LG.data && LG.data.metaForKey ? LG.data.metaForKey(k) : null;
        return (m && m.name) || String(k);
      } catch (e) { return String(k); }
    });
  };
  // ONE "open" per device per half hour. Without the throttle this would be the noisiest row
  // in the ledger by an order of magnitude — the app is an iframe inside the family home
  // screen and a tab hop re-boots it — and "who has opened the app lately" is answered just as
  // well by a half-hourly stamp as by every single paint.
  LG.ACT_OPEN_MS = 30 * 60 * 1000;
  LG.logOpen = function () {
    try {
      const now = Date.now();
      let last = 0;
      try { last = Number(localStorage.getItem("gffl_actopen_t")) || 0; } catch (e) { last = 0; }
      // `last <= now` deliberately: a stamp from the FUTURE (a device whose clock was wrong and
      // has since been corrected) would otherwise suppress this device's opens forever. A
      // future stamp logs, and the write below replaces it with a sane one.
      if (last && last <= now && now - last < LG.ACT_OPEN_MS) return Promise.resolve(null);
      try { localStorage.setItem("gffl_actopen_t", String(now)); } catch (e) {}
      // An anonymous device (nobody has claimed a team on it) still logs, with teamId null —
      // "somebody opened this and never claimed a team" is itself worth knowing.
      return LG.logAct("open", LG.myTeamId(), {});
    } catch (e) { return Promise.resolve(null); }
  };

  // ---------------- S4 · push notifications (plan "the one structural Sleeper gap") ----------
  // The whole FCM stack already exists for the family app — push-client.js writes a token doc,
  // notify.mjs sends. What is new here is only WHO a push is for and WHAT it says.
  //
  // Producers are CLIENT-side and fire AFTER the action has committed (the lobby-invite
  // precedent — no server watcher, and nothing to keep awake). Two rules make that safe:
  //
  //   1. FIRE-AND-FORGET, ALWAYS. Every producer goes through LG.pushNotify, which awaits
  //      nothing the caller can see and swallows every failure. A notify outage, a 500, a
  //      blocked fetch — none of them may cost the family a trade, a waiver run or a message.
  //      The action is the product; the buzz is a courtesy.
  //   2. ONE SENDER. Each producer sits at the point of a genuine STATE TRANSITION inside the
  //      action's own idempotency guard (executeTrade/processWaivers/finalizeWeek all re-read
  //      and bail if another device got there first), so a league where every phone runs the
  //      same auto-check chain still sends exactly one push per event, not one per phone.
  //
  // The actor never pushes themselves: they are looking at the screen the news is on.
  //
  // Deep links are ABSOLUTE on the league's own domain. A relative link would resolve against
  // notify.mjs's family origin and open the FARM app — the reader would tap "trade offer" and
  // land in the chores list. /league.html, not /, because "/" on that host is the family app.
  LG.PUSH_ORIGIN = "https://goatfantasyleague.com";
  LG.pushLink = (hash) => LG.PUSH_ORIGIN + "/league.html" + (hash || "");
  // opts: { toTeam } | { all: true } — plus title, body, link.
  // Returns a promise for the SUITE's benefit (so a check can await the call having been made);
  // no producer awaits it, and it never rejects.
  LG.pushNotify = function (opts) {
    opts = opts || {};
    const payload = {
      secret: LG.PASS, familyKey: LG.famKey,
      title: String(opts.title || ""), body: String(opts.body || ""),
      url: opts.link || LG.pushLink(),
    };
    if (opts.all) { payload.gfflAll = true; if (opts.excludeTeam != null) payload.excludeTeam = opts.excludeTeam; }
    else if (opts.toTeam != null) payload.gfflTeam = opts.toTeam;
    else return Promise.resolve(null); // no audience — nothing to do, and never an error
    return fetch("/.netlify/functions/notify", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then((r) => r.json().catch(() => null)).catch(() => null);
  };
  // Every producer routes through here so "don't buzz the person who just did it" is ONE rule
  // in ONE place rather than a condition repeated at six call sites.
  LG.pushTeam = function (teamId, title, body, link) {
    if (teamId == null) return Promise.resolve(null);
    if (Number(teamId) === Number(LG.myTeamId())) return Promise.resolve(null); // the actor
    return LG.pushNotify({ toTeam: Number(teamId), title, body, link });
  };
  LG.teamName = (id) => { if (id == null) return "Someone"; const t = LG.teamById(id); return (t && t.name) || ("Team " + id); };

  // @MENTION MATCHING. Deliberately simple and deliberately documented, because a matcher
  // nobody can predict is a matcher that buzzes the wrong person:
  //   · a mention is "@" followed by up to FOUR words (letters/digits and the punctuation real
  //     team names carry — apostrophes, dots, hyphens);
  //   · both the mention and each handle are normalised to letters+digits only, so case,
  //     spaces and punctuation are all irrelevant ("@nailsforbreakfast" == "Nails  For Breakfast");
  //   · it is PREFIX-tolerant one way — the typed mention must be a prefix of the handle, so
  //     "@Battle" reaches Battle Kreussers but "@Battleship" reaches nobody;
  //   · the LONGEST run of words is tried first and the first run that matches anything wins,
  //     which is what stops "@Battle you're up" collapsing into one unmatchable blob;
  //   · a handle is the team's NAME, its abbrev, its `owner`, or whoever `claimedBy` it —
  //     people say "@Peter" as readily as "@Battle Kreussers";
  //   · a run under 3 characters is ignored, or "@a" would mention half the league.
  const mNorm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]/g, "");
  LG.mentionTargets = function (text) {
    const out = [];
    const re = /@([A-Za-z0-9][A-Za-z0-9'._-]*(?:[ ][A-Za-z0-9][A-Za-z0-9'._-]*){0,3})/g;
    let m;
    while ((m = re.exec(String(text || "")))) {
      const words = m[1].split(" ").filter(Boolean);
      for (let n = words.length; n >= 1; n--) {
        const raw = mNorm(words.slice(0, n).join(""));
        if (raw.length < 3) continue;
        let hit = false;
        for (const t of LG.teams) {
          for (const h of [t.name, t.abbrev, t.owner, t.claimedBy]) {
            const hn = mNorm(h);
            if (hn && hn.length >= 3 && hn.startsWith(raw)) { if (!out.includes(t.id)) out.push(t.id); hit = true; }
          }
        }
        if (hit) break;
      }
    }
    return out;
  };

  // ---------------- weekly waivers (FAAB, plan §4.3) ----------------
  // One doc per week: claims:[{id,teamId,addKey,addName,addPos,addTeam,
  // dropKey,dropName,bid,t}]. Blind by UI convention only — the doc itself is
  // a normal shared read; lg-ui never shows another team's claim pre-process.
  //
  // ONE DOC PER CLAIM (adversarial review 2026-08-08, findings 2/5/12). Claims used to live
  // as an ARRAY inside a single shared weekly doc, written read-modify-write — and BOTH
  // backends replace an array field wholesale (local JSON.stringify; Firestore setDoc
  // merge:true). Two owners submitting from two phones therefore erased each other, silently
  // and permanently: no result row, no reason, no chat post, the FAAB bid simply never
  // existed. A per-claim doc has no shared array to rebuild, so two devices writing at the
  // same instant write two DIFFERENT documents and neither can destroy the other — the
  // hazard is gone structurally rather than narrowed by careful reads.
  //
  // The weekly `claims_<season>_w<week>` doc survives as the PROCESSING RECORD only
  // ({processed, results, claims: the snapshot processWaivers actually resolved}).
  LG.claimsId = (season, week) => `claims_${season}_w${week}`;
  LG.claimDocId = (season, week, claimId) => `claim_${season}_w${week}_${claimId}`;
  // opts.fresh bypasses LG.db's caches — taken by every writer and every idempotency race
  // guard, which must see the REAL current backend state, not this page's snapshot.
  LG.loadClaims = async function (week, opts) {
    const fresh = !!(opts && opts.fresh);
    const id = LG.claimsId(LG.SEASON, week);
    const doc = fresh ? await LG.db.getFresh(id) : await LG.db.get(id);
    if (doc && doc.processed) return doc; // settled: the doc's own snapshot is the record
    const rows = fresh ? await LG.db.listFresh("claim") : await LG.db.list("claim");
    // A claim's own `id` is stored as `claimId`, never as `id`: list() rows are shaped
    // {...doc, id: <doc-id>}, so a doc field literally called `id` would be clobbered by the
    // doc-id on every read (the same collision finding 10 is about, from the other side).
    const claims = rows
      .filter((c) => c.week === week && (c.season == null || c.season === LG.SEASON))
      .map(({ id: _docId, kind: _k, season: _s, claimId, ...c }) => ({ id: claimId, ...c }));
    // Legacy (pre-2026-08-08) weeks whose claims still live in the array — merged, never lost.
    for (const c of ((doc && doc.claims) || [])) if (!claims.some((x) => x.id === c.id)) claims.push(c);
    claims.sort((a, b) => (a.t || 0) - (b.t || 0));
    return { kind: "claims", week, claims, processed: false, results: (doc && doc.results) || null };
  };
  LG.saveClaims = (week, doc) => LG.db.set(LG.claimsId(LG.SEASON, week), { kind: "claims", week, ...doc });
  LG.addClaim = async function (week, claim) {
    const wk = await LG.db.getFresh(LG.claimsId(LG.SEASON, week));
    if (wk && wk.processed) return { ok: false, reason: "already-processed" };
    // Refused at SUBMIT, and again at PROCESSING (see processWaivers) — a man can perfectly
    // well be ruled out on Tuesday and cleared on Wednesday morning, so checking only here
    // would let a legal claim become an illegal acquisition while it sat in the queue.
    if (claim && claim.teamId != null) {
      const stashed = LG.illegalIR(await LG.ensureRoster(week, claim.teamId, { fresh: true }));
      if (stashed.length) return { ok: false, reason: "ir-illegal", players: stashed.map((p) => p.name) };
    }
    const { id: claimId, ...rest } = claim || {};
    await LG.db.set(LG.claimDocId(LG.SEASON, week, claimId), { kind: "claim", season: LG.SEASON, week, claimId, ...rest });
    // ACTIVITY LEDGER (2026-09-04) — AFTER the write, never before: a refused claim is not an
    // activity, and a row saying somebody claimed a player they did not get is a lie.
    LG.logAct("claim_placed", rest.teamId, {
      addKey: rest.addKey, addName: rest.addName, dropKey: rest.dropKey, dropName: rest.dropName, bid: rest.bid,
    });
    return { ok: true };
  };
  LG.cancelClaim = async function (week, claimId, byTeamId) {
    const wk = await LG.db.getFresh(LG.claimsId(LG.SEASON, week));
    if (wk && wk.processed) return { ok: false, reason: "already-processed" };
    const id = LG.claimDocId(LG.SEASON, week, claimId);
    const c = await LG.db.getFresh(id);
    if (c && c.teamId === byTeamId) {
      await LG.db.del(id);
      LG.logAct("claim_cancel", byTeamId, { addKey: c.addKey, addName: c.addName, bid: c.bid });
      return { ok: true };
    }
    // Legacy array-shaped week: fall back to rewriting it (single-doc, pre-split data only).
    const legacy = ((wk && wk.claims) || []).find((x) => x.id === claimId);
    if (!legacy || legacy.teamId !== byTeamId) return { ok: false, reason: "not-found" };
    await LG.saveClaims(week, { claims: wk.claims.filter((x) => x.id !== claimId), processed: false, results: null });
    LG.logAct("claim_cancel", byTeamId, { addKey: legacy.addKey, addName: legacy.addName, bid: legacy.bid, legacy: true });
    return { ok: true };
  };

  // Free agency (first-come, no bid) once claims have cleared for the week.
  LG.faAdd = async function (week, teamId, addPlayer, dropKey) {
    // FRESH: this both writes a roster and decides "is he already owned?" — a cached roster
    // makes it possible to add a player another team just won (finding 4).
    const ros = await LG.ensureRoster(week, teamId, { fresh: true });
    // Blocked while a healthy man is stashed on IR — see LG.illegalIR. Checked against the
    // FRESH roster above, so it can't be dodged by a stale cache.
    const stashed = LG.illegalIR(ros);
    if (stashed.length) return { ok: false, reason: "ir-illegal", players: stashed.map((p) => p.name) };
    // THE OWNERSHIP BELT (2026-09-02): compared through LG.sameMan, not by raw key — a player
    // keyed `slp_<pid>` on one roster and by his ESPN id on another is the SAME man, and a raw
    // comparison happily puts him on two teams. See LG.sameMan for why both sides must resolve.
    for (const t of LG.teams) {
      const r = t.id === teamId ? ros : await LG.ensureRoster(week, t.id, { fresh: true });
      if (r.some((p) => LG.sameMan(p.key, addPlayer.key))) return { ok: false, reason: "player-taken" };
    }
    const incoming = { key: addPlayer.key, name: addPlayer.name, pos: addPlayer.pos, team: addPlayer.team, slot: "BENCH" };
    // CAS (2026-08-18): the add is a DELTA re-applied to the roster as it stands at the
    // instant of the write, and every guard that reads THIS roster — the IR stash, the cap,
    // the drop target, that target's kickoff — is re-judged inside the loop. The one guard
    // that cannot be is "is he already owned somewhere else", because that is a question
    // about EIGHT OTHER DOCUMENTS and this transport has per-document atomicity only; it
    // stays where it was, above, against fresh reads. Said plainly in docs/gffl.md.
    //
    // NO DROP NEEDED when the roster is under its cap (2026-08-15). This used to be impossible
    // — every add spliced, so the roster could never be short — but a standalone drop can now
    // leave an open spot, and forcing a drop into it would cost the owner a player for every
    // add. A dropKey is still honoured when one is given.
    if (dropKey == null) {
      if (!LG.rosterRoom(ros)) return { ok: false, reason: "roster-full" };
      const r = await rosterUpdate(week, teamId, (players) => {
        const cur = players || [];
        if (LG.illegalIR(cur).length) return null;
        if (cur.some((p) => LG.sameMan(p.key, addPlayer.key))) return null;
        if (!LG.rosterRoom(cur)) return null;
        return cur.concat([incoming]);
      });
      if (!r.ok) return faAddRefusal(r.doc, addPlayer, null);
      await LG.logTx("fa_add", week, teamId, { addKey: addPlayer.key, addName: addPlayer.name });
      return { ok: true };
    }
    const idx = ros.findIndex((p) => p.key === dropKey);
    if (idx < 0) return { ok: false, reason: "drop-not-found" };
    const dropped = ros[idx];
    // A man you STARTED, whose game is underway — see LG.dropBlocked. The bench is free.
    if (LG.dropBlocked(dropped)) return { ok: false, reason: "drop-started", players: [dropped.name] };
    const r = await rosterUpdate(week, teamId, (players) => {
      const cur = players || [];
      if (LG.illegalIR(cur).length) return null;
      if (cur.some((p) => LG.sameMan(p.key, addPlayer.key))) return null;
      const i = cur.findIndex((p) => p.key === dropKey);
      if (i < 0 || LG.dropBlocked(cur[i])) return null;
      const next = cur.slice();
      next.splice(i, 1, incoming); // the incoming man takes the dropped man's place, as before
      return next;
    });
    if (!r.ok) return faAddRefusal(r.doc, addPlayer, dropKey);
    await LG.logTx("fa_add", week, teamId, { addKey: addPlayer.key, addName: addPlayer.name });
    await LG.logTx("drop", week, teamId, { dropKey, dropName: dropped ? dropped.name : dropKey });
    return { ok: true };
  };
  // Re-derives WHICH guard refused, from the fresh roster the aborted loop returned — the same
  // reasons and the same shapes the pre-read above produces, so a caller cannot tell whether it
  // was refused before the loop or inside it. Order matters and matches the checks themselves.
  function faAddRefusal(doc, addPlayer, dropKey) {
    const cur = (doc && doc.players) || [];
    const stashed = LG.illegalIR(cur);
    if (stashed.length) return { ok: false, reason: "ir-illegal", players: stashed.map((p) => p.name) };
    if (cur.some((p) => LG.sameMan(p.key, addPlayer.key))) return { ok: false, reason: "player-taken" };
    if (dropKey == null) return { ok: false, reason: "roster-full" };
    const i = cur.findIndex((p) => p.key === dropKey);
    if (i < 0) return { ok: false, reason: "drop-not-found" };
    return { ok: false, reason: "drop-started", players: [cur[i].name] };
  }

  // Process one week's blind-bid claims. PURE (given the same claims/rosters/
  // standings it always resolves the same way) and IDEMPOTENT (a processed
  // doc is returned untouched — re-read right before the final write so two
  // clients racing the deadline can't double-run it). Sort by bid desc, tie
  // by worse standings first; a claim wins iff its target isn't already
  // owned/awarded-this-run, its drop is still on the roster, and the bid fits
  // the team's remaining FAAB. Winners: drop out/add in (BENCH), FAAB
  // deducted, one "waiver" tx logged. Losers get a reason, no tx (nothing
  // moved).
  //
  // ⭐ SEASON-SIM BUG 4 (2026-08-11) — SINGLE FLIGHT PER WEEK, PER PAGE. The observed double
  // run was not two phones: it was ONE page, whose auto-check chain and whose own
  // carry-forward-on-open both reached this function for the same week while the first run was
  // still awaiting. Every write below then happened twice — including the append-only tx log,
  // where a duplicate is permanent and reads to the family as two identical transactions. A
  // per-week in-flight latch closes that class outright (a second caller in this page gets the
  // FIRST run's promise, not a second run), which no amount of re-reading can do: two runs in
  // one page share a cache, so they see the same "not processed yet" however fresh the read.
  // Cross-device concurrency is a different question and is answered by the pre-write guard
  // inside, plus the write-once results doc that has always been the commit point.
  const waiverRuns = new Map(); // week -> in-flight promise
  LG.processWaivers = function (week) {
    const k = String(week);
    if (waiverRuns.has(k)) return waiverRuns.get(k);
    const run = processWaiversRun(week).finally(() => waiverRuns.delete(k));
    waiverRuns.set(k, run);
    return run;
  };
  async function processWaiversRun(week) {
    // FRESH from the first read: this run permanently settles the week, so it must resolve
    // the claim set that actually EXISTS, not the one this page happened to cache hours ago
    // (finding 2 — the cached read here is what let a stale page process a subset and stamp
    // the week processed with everyone else's bids missing).
    const doc = await LG.loadClaims(week, { fresh: true });
    if (doc.processed) return doc;
    // FRESH TEAMS, for the same reason the claims are read fresh: this run both CHECKS bids
    // against each purse and DEDUCTS from it, and a cached team list is exactly how a page
    // decides a bid is affordable out of money another device already spent (bug 3's other
    // half). listFresh repopulates the list cache, so the loadTeams below is a cache hit on
    // real current data rather than a second round trip.
    await LG.db.listFresh("team");
    await LG.loadTeams();
    const claims = doc.claims || [];
    if (!claims.length) {
      // Same commit-under-CAS as the loaded path below: nothing to move, but the week is still
      // being permanently settled, and two devices must not both claim to have settled it.
      const empty = { kind: "claims", week, claims: [], processed: true, results: [] };
      const r = await LG.db.update(LG.claimsId(LG.SEASON, week), (cur) => (cur && cur.processed ? null : empty));
      if (!r.ok) return LG.loadClaims(week, { fresh: true });
      return { kind: "claims", week, claims: [], processed: true, results: [] };
    }
    const order = await LG.waiverPriorityOrder();
    const rank = new Map(order.map((id, i) => [id, i]));
    const sorted = [...claims].sort((a, b) => (b.bid - a.bid) || ((rank.get(a.teamId) ?? 999) - (rank.get(b.teamId) ?? 999)));

    const rosterMap = new Map();
    for (const t of LG.teams) rosterMap.set(t.id, (await LG.ensureRoster(week, t.id, { fresh: true })).map((p) => ({ ...p })));
    const faabMap = new Map();
    for (const t of LG.teams) faabMap.set(t.id, LG.teamFaab(t));
    const spend = new Map(); // teamId -> $ this run takes off them (bug 3 — a DELTA, not a total)
    // teamId -> the ordered roster CHANGES this run makes to that team ({dropKey, incoming}).
    // CAS (2026-08-18): the writes below re-apply THESE against whatever the roster really
    // holds at write time, instead of writing the array this run computed from its own opening
    // snapshot. An absolute array is what let a trade that executed mid-run vanish (seam C4).
    const rosterOps = new Map();
    const owned = new Set();
    for (const [, ros] of rosterMap) for (const p of ros) owned.add(p.key);
    const wonThisRun = new Set();
    // THE OWNERSHIP BELT (2026-09-02). `owned` holds raw roster keys, and a claim's addKey can
    // legitimately be the SAME man under a different spelling (`slp_<pid>` vs his ESPN id — see
    // LG.sameMan). A raw `owned.has(addKey)` therefore answers "no" for a player somebody
    // already has, and the claim WINS him onto a second roster. The scan below is O(roster) per
    // check, which is nothing at league scale, and D.pidForKey memoises every positive.
    const ownedByAnyone = (key) => {
      if (owned.has(key)) return true;
      for (const k of owned) if (LG.sameMan(k, key)) return true;
      return false;
    };
    const wonAlready = (key) => {
      if (wonThisRun.has(key)) return true;
      for (const k of wonThisRun) if (LG.sameMan(k, key)) return true;
      return false;
    };
    const dirtyTeams = new Set();
    const results = [];
    const txs = [];

    for (const c of sorted) {
      let reason = null;
      if (ownedByAnyone(c.addKey)) reason = wonAlready(c.addKey) ? "outbid" : "player-taken";
      if (!reason) {
        const ros = rosterMap.get(c.teamId) || [];
        // ⭐ FOUR INDEPENDENT CHECKS, FIRST REFUSAL WINS (2026-09-02, the minor fold-in). These
        // used to be an if/else-if chain whose LAST link read `if (!reason && overBudget) … else
        // if (illegalIR)`. When an EARLIER check had already set a reason, `!reason` is false,
        // so the `else if` RAN and OVERWROTE it — a claim refused for "drop-gone" was reported
        // to its owner as "ir-illegal", pointing them at a roster problem they did not have.
        // Written as four guarded, independent statements the order is explicit and the first
        // refusal is the one that survives; the ORDER itself is unchanged and deliberate
        // (drop-gone / insufficient-faab BEFORE ir-illegal — the 2026-08-15 IR entry's own note
        // about the suite's staging depends on it).
        //
        // A claim may carry NO drop when the team had an open spot — see faAdd's own note. It
        // still needs the spot to be there at RUN time, since another claim of theirs earlier in
        // this same run may have filled it.
        if (!reason && c.dropKey == null && !LG.rosterRoom(ros)) reason = "roster-full";
        if (!reason && c.dropKey != null && !ros.some((p) => p.key === c.dropKey)) reason = "drop-gone";
        if (!reason && c.bid > (faabMap.get(c.teamId) ?? 0)) reason = "insufficient-faab";
        // ⚠ NO drop-started GATE HERE, DELIBERATELY, and the reason is the rule itself: a
        // claim's drop takes effect AT THE WAIVER RUN, which IS "once waivers clear". Dropping
        // a started player by claim is therefore the PERMITTED route, not the abuse — the abuse
        // is the instant free-agent add, which is where LG.faAdd blocks it. A first cut gated
        // this too and it contradicted the rule (and lost a claim for a commissioner's early
        // "Process now", punishing an owner for somebody else's timing).
        // The second half of the IR gate: addClaim refused it at submit, but a player ruled
        // out on Tuesday can be cleared by Wednesday's run, so the claim is re-judged here
        // against the rosters this run actually read. The claim LOSES rather than erroring —
        // it is one bid among many and the run must still resolve everyone else.
        if (!reason && LG.illegalIR(ros).length) reason = "ir-illegal";
      }
      if (!reason) {
        const ros = rosterMap.get(c.teamId);
        const incoming = { key: c.addKey, name: c.addName, pos: c.addPos, team: c.addTeam, slot: "BENCH" };
        const dropIdx = c.dropKey == null ? -1 : ros.findIndex((p) => p.key === c.dropKey);
        const dropped = dropIdx < 0 ? null : ros[dropIdx];
        if (dropIdx < 0) ros.push(incoming); else ros.splice(dropIdx, 1, incoming);
        if (!rosterOps.has(c.teamId)) rosterOps.set(c.teamId, []);
        rosterOps.get(c.teamId).push({ dropKey: c.dropKey, incoming });
        if (c.dropKey != null) owned.delete(c.dropKey);
        owned.add(c.addKey);
        wonThisRun.add(c.addKey);
        faabMap.set(c.teamId, (faabMap.get(c.teamId) ?? 0) - c.bid);
        spend.set(c.teamId, (spend.get(c.teamId) || 0) + c.bid); // bug 3: what this run actually COSTS each team
        dirtyTeams.add(c.teamId);
        results.push({ id: c.id, teamId: c.teamId, ok: true, reason: "won" });
        txs.push({ teamId: c.teamId, detail: { addKey: c.addKey, addName: c.addName, dropKey: c.dropKey, dropName: dropped ? dropped.name : c.dropKey, bid: c.bid } });
      } else {
        results.push({ id: c.id, teamId: c.teamId, ok: false, reason });
      }
    }

    // ⭐ SEASON-SIM BUG 4 — THE GUARD MOVES IN FRONT OF THE WRITES. It used to sit only after
    // them (below), which made it a guard on the RESULTS DOC and on nothing else: a second
    // runner that lost the race had already rewritten every roster, re-deducted every purse
    // and appended a duplicate of every waiver tx before finding out it had lost, and the tx
    // log is append-only, so that duplicate is permanent. Reading fresh here narrows the
    // window from "the whole resolution" — the priority order, eight fresh roster reads, the
    // sort, seconds of work — to the microtask between this line and the first write. It is a
    // check-then-act and does not CLOSE the cross-device race (the transport has no
    // compare-and-swap to close it with, see the transform note at LG.saveTeam); the
    // same-page case, which is the one actually observed, is closed outright by the
    // single-flight latch above.
    //
    // ⭐ 2026-08-18: "the transport has no compare-and-swap to close it with" is no longer
    // true — it has one now (LG.db.update), and every write below goes through it. This
    // pre-read stays: it is still the cheapest way to abandon a run that is already settled,
    // before doing any writing at all. What changed is that losing the race no longer costs
    // anything, because each write re-applies its own delta against the truth.
    const pre = await LG.loadClaims(week, { fresh: true });
    if (pre.processed) return pre;

    // The roster writes, as DELTAS. Each op is re-applied to the roster as it stands at the
    // instant of the write, so a trade, a free-agent add or another device's waiver run that
    // landed while this one was resolving all survive alongside it — instead of one of the two
    // being silently replaced by the other's whole-array write (seam C4's lost update).
    // Idempotent by construction: an op whose add is already there, or whose drop is already
    // gone, applies the half that is still missing and nothing else.
    // ⭐ PER-ITEM, ALWAYS (2026-09-02, S1). Every write below used to be a bare `await` in a
    // loop, so the FIRST failure threw out of processWaivers and skipped every team after it —
    // one team's flaky roster write, or one team's FAAB write, silently abandoned the rest of
    // the league's results mid-run. Measured on the pre-fix engine (scratchpad probe4_waivers.cjs
    // case B, saveTeam throwing on the second dirty team): team 1's purse was never charged, no
    // transaction row was written for EITHER winner, and the week was left unprocessed with two
    // players already moved. Each write is now attempted on its own and a failure is RECORDED
    // by team and stage rather than ending the run.
    const failures = [];
    for (const tid of dirtyTeams) {
      const ops = rosterOps.get(tid) || [];
      try {
        await rosterUpdate(week, tid, (players) => {
          const next = (players || []).slice();
          for (const op of ops) {
            const i = op.dropKey == null ? -1 : next.findIndex((p) => p.key === op.dropKey);
            const has = next.some((p) => p.key === op.incoming.key);
            if (i < 0) { if (!has) next.push(op.incoming); }
            else if (has) next.splice(i, 1);
            else next.splice(i, 1, op.incoming); // in place, exactly as the resolution computed it
          }
          return next;
        });
      } catch (e) {
        failures.push({ teamId: tid, stage: "roster", error: String((e && e.message) || e) });
      }
    }
    // A ROSTER THIS RUN COULD NOT MOVE MUST NEVER BE PAID FOR. The commit below is the point of
    // no return for the money, so a roster failure abandons the run BEFORE it — every other
    // team's roster has still been attempted (that is the whole point of the per-item handling),
    // the week stays unprocessed, and the next device to open the app simply re-runs it: the
    // deltas above are idempotent, so replaying them costs nothing.
    if (failures.length) return { kind: "claims", week, claims, processed: false, results, failures };
    // ⭐ THE COMMIT POINT (2026-08-18) — and it MOVED, in front of the money.
    // The week's processing record is written under a compare-and-swap that ABORTS if the doc
    // already says processed, so of two devices resolving the same week EXACTLY ONE gets past
    // this line. That matters because of what is on either side of it:
    //   · ABOVE — the roster writes, which are IDEMPOTENT deltas. Two devices applying the same
    //     waiver results to a roster produce one roster, so it costs nothing to have run both,
    //     and leaving them ahead of the commit means a run that dies before committing has
    //     still moved no money and can simply be re-run.
    //   · BELOW — the FAAB deductions, the append-only transaction log and the push. NONE of
    //     those are idempotent: two devices deducting the same winning bid is the family
    //     paying twice for one player, and a duplicate tx is permanent. They now happen only
    //     for the device that actually holds the week.
    // The old order (write everything, then re-read to see whether we lost) could only NARROW
    // that: a loser had already spent the money by the time it found out. The residual risk
    // swaps for a far smaller and far more visible one — a run that dies between the commit
    // and the deductions leaves a purse unpaid, which the season sim's conservation sweep
    // reports by name, where a double-spend was silent.
    const commit = await LG.db.update(LG.claimsId(LG.SEASON, week), (cur) => {
      if (cur && cur.processed) return null; // another device settled this week while we worked
      return { kind: "claims", week, claims, processed: true, results };
    });
    if (!commit.ok) return LG.loadClaims(week, { fresh: true }); // theirs is the record; return it
    const done = { claims, processed: true, results };

    // DELTA only — spreading the whole in-memory team here wrote this page's (possibly
    // stale) name/logo/trophies back over good data (finding 10's blast radius).
    // ⭐ SEASON-SIM BUG 3 — and the FAAB is a delta too, now. `faabMap` is derived from this
    // page's view of the purse at the top of the run; writing it as an absolute simply undoes
    // any deduction that landed in between. `from` is handed saveTeam's OWN fresh read of the
    // doc, so what lands is "whatever the purse really holds, minus what this run cost" — and
    // since 2026-08-18 that read and the write it feeds are one compare-and-swap, so the
    // deduction cannot be computed from a purse that moves before it lands.
    // Floored at 0: a purse can never go negative even if the affordability check upstream
    // was computed against a figure that has since moved.
    //
    // ⭐ THE TRANSACTIONS ARE LOGGED FIRST (2026-09-02, S1), and that ORDER is the point. The
    // transaction log is this batch's only human-readable record of who won whom for how much —
    // and it used to be written AFTER the deductions, so a single failing purse write took every
    // remaining tx row down with it and the family was left with players who had moved and
    // nothing at all explaining why. A tx row is append-only and independent of the money, so
    // there is no reason for it to depend on the money landing. Each one is wrapped on its own.
    // Item 15 (2026-08-09): the sys chat post that used to go here is GONE — this logTx is the
    // event's real record, and it renders in Recent moves + each team's Transactions.
    for (const tx of txs) {
      try { await LG.logTx("waiver", week, tx.teamId, tx.detail); }
      catch (e) { failures.push({ teamId: tx.teamId, stage: "tx", error: String((e && e.message) || e) }); }
    }
    // DELTA only — spreading the whole in-memory team here wrote this page's (possibly stale)
    // name/logo/trophies back over good data. Per-item, so team 3's purse still gets charged
    // when team 2's write fails; and since 2026-09-02 (F1) LG.saveTeam THROWS rather than
    // falling through to a blind write when the CAS read fails on a delta caller, so a purse
    // that could not be read is a recorded failure here instead of a silent full-budget refund.
    for (const tid of dirtyTeams) {
      const sp = spend.get(tid) || 0;
      try { await LG.saveTeam({ teamId: tid }, { from: (cur) => ({ faab: Math.max(0, LG.teamFaab(cur || {}) - sp) }) }); }
      catch (e) { failures.push({ teamId: tid, stage: "faab", spend: sp, error: String((e && e.message) || e) }); }
    }
    // The week's record already says `processed` (the commit above), so the failures are written
    // onto it as their own field rather than being lost: a commissioner can see exactly which
    // team's purse or transaction did not land, by name, instead of discovering it in a
    // conservation sweep weeks later. Best-effort — a failure to record failures is not worth
    // taking the run down for.
    if (failures.length) {
      try { await LG.db.set(LG.claimsId(LG.SEASON, week), { failures }); } catch (e) { /* nothing more we can do */ }
    }
    try { await LG.loadTeams(); } catch (e) { /* refresh in-memory FAAB for the caller — a courtesy */ }
    // S4 producer. Sent by whichever client actually RAN the processing — the guard above is
    // what makes that exactly one client, so nobody gets the same results twice. Only owners
    // who bid hear anything at all, and each hears only their OWN claims resolve.
    LG.pushWaiverResults(week, claims, results);
    return { kind: "claims", week, ...done, ...(failures.length ? { failures } : {}) };
  }
  // Split out so the suite can drive the message-building on its own, and so processWaivers
  // itself keeps reading as the engine rather than the engine plus a mailer.
  LG.pushWaiverResults = function (week, claims, results) {
    try {
      const byId = new Map((results || []).map((r) => [r.id, r]));
      const perTeam = new Map();
      for (const c of claims || []) {
        const r = byId.get(c.id);
        if (!r) continue;
        if (!perTeam.has(c.teamId)) perTeam.set(c.teamId, { won: [], lost: [] });
        const bucket = perTeam.get(c.teamId);
        const nm = LG.shortName(c.addName || c.addKey);
        if (r.ok) bucket.won.push(nm + " for $" + c.bid);
        else bucket.lost.push(nm);
      }
      for (const [teamId, b] of perTeam) {
        const parts = [];
        if (b.won.length) parts.push("Won " + b.won.join(", "));
        if (b.lost.length) parts.push("lost " + b.lost.join(", "));
        LG.pushTeam(teamId, "Waivers — week " + week, parts.join(" · "), LG.pushLink("#moves"));
      }
    } catch (e) { /* a producer may never cost the run that produced it */ }
  };

  // ---------------- trades (plan §4.4) ----------------
  // Offer -> accept (starts a review window) -> auto-executes once the window
  // passes, unless enough OTHER owners veto it first. Player-for-player only;
  // uneven trades (2-for-1) are allowed — AS LONG AS neither roster ends up over cap or
  // unable to field a lineup (2026-08-17 ruling, below; this comment used to say "no
  // roster-size cap in v1", which the seam suite's own C3 quoted back as proof nothing
  // enforced it).

  // ⭐ THE THREE TRADE GUARDS (2026-08-17 RULING). The seam hunt (tools/_gffl_seams.cjs,
  // sections C3/C5) found executeTrade had NO roster-cap check, NO startable-lineup check, and
  // NO clock check — three ways a trade could execute and leave a roster that LOOKED accepted
  // but was actually broken. Pinned as findings with no ruling; the commissioner ruled the
  // same day, on all three.
  //
  // One PURE function, LG.tradeBlockers, is the single source of truth — called from
  // LG.acceptTrade and the Moves trade composer (lg-ui.js) for early UX refusal, and from
  // LG.executeTrade as the AUTHORITATIVE gate against the fresh rosters right before the swap
  // actually happens. No caller re-derives the rule; they all ask the same function.
  //
  // CAP — a trade may not leave EITHER roster over LG.rosterCap() (the slot script's own
  // total, incl. BENCH and IR — 19 today).
  //
  // LINEUP — a trade may not leave either roster unable to fill every STARTING slot (all of
  // rules.roster except BENCH/IR) with one player per slot. Judged as a TRANSITION (fillable
  // before, unfillable after) rather than an absolute post-trade fact — see the comment at
  // LG.tradeBlockers' own LINEUP section for why. See LG.canFillLineup just below for why the
  // fillable/not-fillable check itself needs real bipartite matching, not a greedy pass.
  //
  // CLOCK — deliberately STRICTER than LG.dropBlocked. dropBlocked only freezes a STARTER,
  // because the abuse it guards against (cutting a bad performance mid-drive) only exists for
  // a man in your lineup. A mid-game TRADE is a different shenanigan — watching a teammate's
  // guy implode in the first quarter and trading for him anyway before the rest of the league
  // has reacted — and that exists for a BENCHED or IR'd player just as much as a starter,
  // because it's the PLAYER that changed hands, not his slot. So this checks every traded
  // player regardless of slot, against the exact same clock LG.dropBlocked reads
  // (D.gameStarted via LG.data — never a second one).
  LG.canFillLineup = function (roster) {
    const rosterRules = (LG.rules || LG.DEFAULT_RULES).roster || {};
    const slots = [];
    for (const slot of Object.keys(rosterRules)) {
      if (slot === "BENCH" || slot === "IR") continue;
      const n = Number(rosterRules[slot]) || 0;
      for (let i = 0; i < n; i++) slots.push(slot);
    }
    const players = roster || [];
    // Fewest-eligible-first: a scheduling heuristic that keeps the search small (a TE slot with
    // one candidate is worth pinning down before a FLEX slot with six candidates). Correctness
    // does NOT depend on this order — the augmenting-path search below is EXACT for any order,
    // because it can always re-route a player already placed rather than committing to the
    // first match it finds. A plain greedy pass (place a player, never revisit) does not have
    // that property: it can hand a roster's only TE to FLEX before the TE slot is even
    // considered, and then wrongly refuse a trade a real assignment would have allowed.
    const eligibleCount = (slot) => players.reduce((n, p) => n + (LG.slotEligible(p.pos, slot) ? 1 : 0), 0);
    slots.sort((a, b) => eligibleCount(a) - eligibleCount(b));

    const slotOfPlayer = new Map(); // player key -> index into `slots` currently holding him
    function augment(slotIdx, seen) {
      for (const p of players) {
        if (seen.has(p.key) || !LG.slotEligible(p.pos, slots[slotIdx])) continue;
        seen.add(p.key);
        const holding = slotOfPlayer.get(p.key);
        if (holding === undefined || augment(holding, seen)) {
          slotOfPlayer.set(p.key, slotIdx);
          return true;
        }
      }
      return false;
    }
    for (let i = 0; i < slots.length; i++) {
      if (!augment(i, new Set())) return false; // no augmenting path exists — this slot cannot be filled, full stop
    }
    return true;
  };

  // Pure function of its inputs — no fetching inside. offerDoc needs only {from, to, give,
  // get}; rosterFrom/rosterTo are the CURRENT (pre-trade) rosters of those two teams, whatever
  // "current" means to the caller (in-memory for the composer's early check, freshly-read for
  // executeTrade's authoritative one). Returns [] when the trade is clean, else an array of
  // {reason, detail} — reason is one of "over-cap" / "lineup-unfillable" / "player-started",
  // detail carries whatever the reason needs to NAME (a team, a player) so no caller has to
  // re-derive it from the raw doc.
  LG.tradeBlockers = function (offerDoc, rosterFrom, rosterTo) {
    const give = (offerDoc && offerDoc.give) || [], get = (offerDoc && offerDoc.get) || [];
    const fromRoster = rosterFrom || [], toRoster = rosterTo || [];
    const blockers = [];

    // CAP — post-trade size is current length, minus what leaves, plus what arrives.
    const cap = LG.rosterCap();
    const fromSize = fromRoster.length - give.length + get.length;
    const toSize = toRoster.length - get.length + give.length;
    if (fromSize > cap) blockers.push({ reason: "over-cap", detail: { team: LG.teamName(offerDoc.from) } });
    if (toSize > cap) blockers.push({ reason: "over-cap", detail: { team: LG.teamName(offerDoc.to) } });

    // LINEUP — simulate the post-trade rosters the same way executeTrade actually builds them
    // (an incoming player lands on BENCH; the owner sets their own lineup afterwards).
    //
    // "May not LEAVE a roster unable to fill its lineup" is judged as a TRANSITION — blocked
    // only when the trade turns a roster that COULD fill its lineup into one that can't, not
    // whenever the post-trade roster merely fails the check in absolute terms. A roster that
    // was already short a full lineup before anyone proposed anything (an early-season roster
    // still mid-build, a family test league with a handful of players seeded) is not this
    // guard's business to freeze forever — it exists to stop a trade from BREAKING a working
    // lineup, not to punish a roster for a gap the trade had nothing to do with. Real, live
    // rosters are effectively always full (19-20 players, per the 2025 reset), so in practice
    // this is the same rule either way; the distinction only matters for a roster that could
    // never have fielded a lineup regardless of this trade.
    const incomingToFrom = toRoster.filter((p) => get.includes(p.key)).map((p) => ({ ...p, slot: "BENCH" }));
    const incomingToTo = fromRoster.filter((p) => give.includes(p.key)).map((p) => ({ ...p, slot: "BENCH" }));
    const newFromRoster = fromRoster.filter((p) => !give.includes(p.key)).concat(incomingToFrom);
    const newToRoster = toRoster.filter((p) => !get.includes(p.key)).concat(incomingToTo);
    if (LG.canFillLineup(fromRoster) && !LG.canFillLineup(newFromRoster)) {
      blockers.push({ reason: "lineup-unfillable", detail: { team: LG.teamName(offerDoc.from) } });
    }
    if (LG.canFillLineup(toRoster) && !LG.canFillLineup(newToRoster)) {
      blockers.push({ reason: "lineup-unfillable", detail: { team: LG.teamName(offerDoc.to) } });
    }

    // CLOCK — every player changing hands, ANY slot (see the block comment above this function
    // for why that's deliberately stricter than LG.dropBlocked).
    const traded = fromRoster.filter((p) => give.includes(p.key)).concat(toRoster.filter((p) => get.includes(p.key)));
    const started = traded.filter((p) => LG.data && LG.data.gameStarted && LG.data.gameStarted(p.team));
    if (started.length) {
      blockers.push({ reason: "player-started", detail: { player: started[0].name, players: started.map((p) => p.name) } });
    }

    return blockers;
  };

  LG.tradeId = (t) => `trade_${t}_${Math.random().toString(36).slice(2, 6)}`;
  // opts.fresh bypasses LG.db's cache — see LG.loadClaims' note; executeTrade's own
  // "someone else already executed/cancelled this" re-check needs the real backend state.
  LG.loadTrade = (id, opts) => (opts && opts.fresh ? LG.db.getFresh(id) : LG.db.get(id));
  LG.saveTrade = (doc) => LG.db.set(doc.id, doc);
  LG.loadTrades = async function () {
    return (await LG.db.list("trade")).sort((a, b) => b.t - a.t);
  };
  LG.tradeDeadlinePassed = () => LG.currentWeek() > ((LG.rules && LG.rules.trades.deadlineWeek) || 99);
  // opts (S7, optional — every pre-S7 call site passes nothing and is byte-identical):
  //   opts.counterOf — the trade doc id this offer answers. Stamped on the doc; it is what
  //                    makes a chain a chain, and the ONLY thing Moves needs to render one.
  //   opts.push      — {title, body} replacing the default offer wording, so a counter says
  //                    "countered" rather than arriving as a bare new offer.
  // A counter is an ORDINARY OFFER in the other direction, so it goes through this same
  // function rather than a parallel one: the deadline check, the 1-3-players validation, the
  // doc write and the S4 producer are all the existing path, and there is no second copy of
  // any of them to drift.
  LG.offerTrade = async function (from, to, give, get, note, opts) {
    opts = opts || {};
    if (LG.tradeDeadlinePassed()) return { ok: false, reason: "deadline-passed" };
    give = give || []; get = get || [];
    if (!give.length || !get.length || give.length > 3 || get.length > 3) return { ok: false, reason: "invalid-players" };
    // Date.now(), not LG.now(): this stamp is persisted, sorted (loadTrades) and compared on
    // OTHER devices. See the note at LG.SIM_LOADED_AT.
    const t = Date.now();
    const id = LG.tradeId(t);
    const doc = { kind: "trade", id, from, to, give, get, note: note || "", status: "offered", t, acceptedAt: null, reviewEndsAt: null, vetoes: [] };
    if (opts.counterOf) doc.counterOf = opts.counterOf;
    await LG.saveTrade(doc);
    // S4 producer — the offer's whole point is that the other owner doesn't know about it yet.
    const push = opts.push || { title: "Trade offer", body: LG.teamName(from) + " sent you a trade." };
    LG.pushTeam(to, push.title, push.body, LG.pushLink("#moves"));
    // ACTIVITY LEDGER (2026-09-04). ONE producer for both shapes: LG.counterTrade below routes
    // through this very function, so logging the counter separately there would put TWO rows in
    // the ledger for one gesture. opts.counterOf is what tells them apart, and it is the same
    // field the doc itself carries.
    LG.logAct(opts.counterOf ? "trade_counter" : "trade_offer", from,
      { tradeId: id, from, to, give: LG.actNames(give), get: LG.actNames(get), counterOf: opts.counterOf || null });
    return { ok: true, trade: doc };
  };
  // S7 — COUNTER-OFFER. The receiving owner answers an offer with their own, and the original
  // becomes terminal ("countered") rather than being edited: the doc model stays append-ish,
  // so nothing ever mutates a live offer under the person looking at it, and the whole
  // exchange is still readable afterwards by following counterOf up the chain.
  //
  // A counter may itself be countered — the chain just grows, with no cap. There is nothing
  // to cap: each link is one small doc, and Moves renders only the newest few (see the
  // "+N earlier" fold in renderMoves).
  //
  // ORDERING, and the race it is chosen for: the replacement is written FIRST and the original
  // is terminated SECOND, behind its own fresh re-read. If the proposer cancels or the trade
  // is accepted in the moment between the two, the loser of that race leaves the counter
  // standing as an ordinary offer the counterer can cancel — honest and recoverable. The other
  // order can lose the original to a counter that then fails to write, which is not.
  LG.counterTrade = async function (id, byTeamId, give, get, note) {
    const doc = await LG.loadTrade(id, { fresh: true }); // same fresh-read posture as every other transition
    if (!doc) return { ok: false, reason: "no-trade" };
    if (doc.to !== byTeamId) return { ok: false, reason: "not-yours" };       // only the RECEIVER may counter
    if (doc.status !== "offered") return { ok: false, reason: "not-pending" }; // already accepted/declined/cancelled/countered
    const r = await LG.offerTrade(byTeamId, doc.from, give, get, note, {
      counterOf: id,
      // S7 producer — to the ORIGINAL PROPOSER, who is waiting on an answer and is getting one.
      push: { title: "Trade countered", body: LG.teamName(byTeamId) + " countered your trade." },
    });
    if (!r.ok) return r; // deadline / invalid players — nothing written, the original is untouched
    const again = await LG.loadTrade(id, { fresh: true });
    if (again && again.status === "offered") await LG.saveTrade({ ...again, status: "countered", counteredBy: r.trade.id });
    return r;
  };
  // Every status transition below is a read-modify-write on one shared trade doc, so each
  // reads FRESH (adversarial review 2026-08-08): a cached copy let one device resurrect a
  // status another device had already moved on from.
  LG.cancelTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "offered" || doc.from !== byTeamId) return null;
    const next = { ...doc, status: "cancelled" };
    await LG.saveTrade(next);
    LG.logAct("trade_cancel", byTeamId, { tradeId: id, from: doc.from, to: doc.to, give: LG.actNames(doc.give), get: LG.actNames(doc.get) });
    return next;
  };
  LG.declineTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "offered" || doc.to !== byTeamId) return null;
    const next = { ...doc, status: "declined" };
    await LG.saveTrade(next);
    LG.logAct("trade_decline", byTeamId, { tradeId: id, from: doc.from, to: doc.to, give: LG.actNames(doc.give), get: LG.actNames(doc.get) });
    return next;
  };
  LG.acceptTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "offered" || doc.to !== byTeamId) return null;
    // ⭐ THE DEADLINE IS A DEADLINE ON THE WHOLE TRADE, NOT ON THE OFFER (2026-09-02, S3).
    // LG.tradeDeadlinePassed() was checked in LG.offerTrade ONLY, so an offer made legally in
    // week 10 could be ACCEPTED in week 12 — deep in the playoffs, weeks past the deadline the
    // league voted for — and then execute on rosters that are seeding a bracket. Measured on the
    // pre-fix engine (scratchpad probe6_misc.cjs section C): a NEW offer at week 17 was correctly
    // refused "deadline-passed" while the OLD one accepted and executed in the same breath. Same
    // refusal shape offerTrade uses, so every caller already knows how to read it.
    if (LG.tradeDeadlinePassed()) return { ok: false, reason: "deadline-passed" };
    // Early UX refusal (2026-08-17 ruling) — same LG.tradeBlockers executeTrade runs
    // authoritatively, against the rosters as they stand right now. This is NOT the last word:
    // a roster can still change between accept and the review window closing, so executeTrade
    // re-checks fresh at its own gate before the swap actually happens. Refusing here just
    // saves the accepting owner a 48-hour wait for a trade that was always going to bounce.
    {
      const week = LG.currentWeek();
      const fromRoster = await LG.ensureRoster(week, doc.from, { fresh: true });
      const toRoster = await LG.ensureRoster(week, doc.to, { fresh: true });
      const blockers = LG.tradeBlockers(doc, fromRoster, toRoster);
      if (blockers.length) return { ok: false, reason: blockers[0].reason, detail: blockers[0].detail };
    }
    // Date.now(), and the expiry check in executeTrade matches it. A "24 hour review" is a
    // real-world day the family waits for someone to veto — not a season-time duration. On
    // LG.now() an 8x replay clock would burn it in 3 real hours, and a freshly-loaded device
    // would judge the same trade as having far more time left than a long-open one.
    // (LG.tradeDeadlinePassed above is a DIFFERENT concept — the league-calendar trade
    // deadline — and correctly stays on the season clock.)
    const now = Date.now();
    const reviewMs = ((LG.rules && LG.rules.trades.reviewHours) || 24) * 3600e3;
    // CAS (2026-08-18): offered -> accepted is a STATUS TRANSITION, and the doc it transitions
    // is shared with the proposer's device (cancel), every other owner (veto) and the receiver
    // themselves on a second phone. The mutate re-tests the same two conditions the read above
    // tested — still offered, still addressed to this team — against the doc as it stands at
    // the instant of the write, so a cancel that landed in between wins instead of being
    // overwritten by an acceptance computed from before it. An abort returns null, which is
    // the SAME refusal shape the pre-read gives for exactly those conditions.
    const r = await LG.db.update(doc.id, (cur) => {
      if (!cur || cur.status !== "offered" || cur.to !== byTeamId) return null;
      return { ...cur, status: "accepted", acceptedAt: now, reviewEndsAt: now + reviewMs };
    });
    if (!r.ok) return null;
    // S4 producer — to the PROPOSER, who has been waiting on an answer. AFTER the loop: a push
    // fired inside a mutate would go out once per attempt.
    LG.pushTeam(doc.from, "Trade accepted", LG.teamName(doc.to) + " accepted your trade. It goes through after the review window.", LG.pushLink("#moves"));
    // ACTIVITY LEDGER — same placement rule as the push above: after the CAS loop committed,
    // never inside a mutate that can run six times.
    LG.logAct("trade_accept", byTeamId, { tradeId: doc.id, from: doc.from, to: doc.to, give: LG.actNames(doc.give), get: LG.actNames(doc.get) });
    return r.doc;
  };
  // Any owner NOT a party to the trade may add one veto vote; enough votes
  // (rules.trades.vetoVotes, default 4) kills it before it ever executes.
  // ⭐ A VOTE IS AN APPEND TO A SHARED ARRAY, SO IT NEEDS THE PRECONDITION (2026-09-02, S2).
  // This was fresh-read → rebuild the array → BLIND whole-doc write: exactly the read-modify-
  // write shape the 2026-08-18 CAS rework closed everywhere else and missed here. Two owners
  // voting within the same second is not a corner case for a veto — a veto is a thing owners do
  // when a trade lands, i.e. all at once, in a group chat — and the second write simply put the
  // first vote back. Reproduced on the pre-fix engine (scratchpad probe7_veto.cjs, the first
  // write held on a gate until the second had completed its whole read-modify-write): TWO votes
  // cast, ONE recorded. With vetoVotes at 4 out of 6 eligible owners, a lost vote is a trade the
  // league voted down that goes through anyway.
  // Now the same shape as acceptTrade: one LG.db.update, the mutate re-tests every condition the
  // pre-read tested against the doc as it stands at the instant of the write, and the logTx and
  // the pushes fire AFTER a successful loop — never inside a mutate that can run six times.
  LG.vetoTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true }); // cheap early refusal; the loop re-judges
    if (!doc || doc.status !== "accepted") return doc;
    if (byTeamId === doc.from || byTeamId === doc.to) return doc;
    if ((doc.vetoes || []).includes(byTeamId)) return doc;
    const needed = (LG.rules && LG.rules.trades.vetoVotes) || 4;
    const r = await LG.db.update(id, (cur) => {
      if (!cur || cur.status !== "accepted") return null;               // executed/cancelled/already vetoed
      if (byTeamId === cur.from || byTeamId === cur.to) return null;    // a party may not vote
      if ((cur.vetoes || []).includes(byTeamId)) return null;           // this owner has already voted
      const v = [...(cur.vetoes || []), byTeamId];
      return { ...cur, vetoes: v, status: v.length >= needed ? "vetoed" : "accepted" };
    });
    if (!r.ok) return r.doc || doc; // somebody moved it under us — theirs is the record
    const next = r.doc;
    const status = next.status;
    // ACTIVITY LEDGER — every VOTE, not only the one that kills the trade. Who voted and who
    // did not is the whole question a veto raises, and the tx log records only the outcome.
    // After the loop, for the same reason the pushes below are.
    LG.logAct("trade_veto_vote", byTeamId, { tradeId: id, from: doc.from, to: doc.to, votes: (next.vetoes || []).length, needed, killed: status === "vetoed" });
    if (status === "vetoed") {
      // Item 15 (2026-08-09): sys chat post removed — this logTx IS the veto's record.
      await LG.logTx("trade", LG.currentWeek(), doc.from, { tradeId: id, from: doc.from, to: doc.to, give: doc.give, get: doc.get, result: "vetoed" });
      // S4 producer — BOTH parties, because a trade they had both agreed to has just died.
      // Only on the vote that actually kills it: the earlier votes changed nothing.
      LG.pushTeam(doc.from, "Trade vetoed", "The league voted down your trade with " + LG.teamName(doc.to) + ".", LG.pushLink("#moves"));
      LG.pushTeam(doc.to, "Trade vetoed", "The league voted down your trade with " + LG.teamName(doc.from) + ".", LG.pushLink("#moves"));
    }
    return next;
  };
  // Client-triggered (no scheduled function in v1 — plan §6 deviation): any
  // client open past reviewEndsAt executes it. Re-reads right before writing
  // (idempotency guard, same pattern as processWaivers) and fails SAFE to
  // "cancelled" (never a half-swap) if either side's listed player has moved.
  LG.executeTrade = async function (id) {
    let doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "accepted") return doc;
    // The same deadline check acceptTrade now runs (2026-09-02, S3), and it belongs here too:
    // a trade accepted the day before the deadline whose 48-hour review window closes AFTER it
    // would otherwise swap rosters past the deadline, with nobody having done anything wrong.
    // A refusal, not a cancellation — the trade stays "accepted" and visible, and the
    // commissioner or either party can cancel it. (Flagged rather than hidden: nothing expires
    // it automatically, so a trade stranded this way is retried, and refused, on every boot.)
    if (LG.tradeDeadlinePassed()) return { ok: false, reason: "deadline-passed" };
    if (Date.now() < (doc.reviewEndsAt ?? Infinity)) return doc; // wall time — see acceptTrade
    const fresh = await LG.loadTrade(id, { fresh: true });
    if (!fresh || fresh.status !== "accepted") return fresh;
    const week = LG.currentWeek();
    // FRESH: executeTrade's own "roster-changed -> cancel" fail-safe exists precisely to
    // catch a player who has moved since the offer — reading it through the cache made that
    // guard read the stale data it was written to detect (finding 4).
    const fromRoster = await LG.ensureRoster(week, fresh.from, { fresh: true });
    const toRoster = await LG.ensureRoster(week, fresh.to, { fresh: true });
    // CAS (2026-08-18): every terminal transition below is a cancellation, and a cancellation
    // may only move a trade that is STILL accepted — otherwise a device that decided to cancel
    // could write over an `executed` another device had already committed, un-doing a swap
    // that has physically happened on both rosters. The mutate re-tests that; an abort returns
    // whatever the winner wrote, which is the honest answer to "what happened to my trade".
    // Refusal reasons and doc shapes are byte-for-byte what they were.
    const cancelWith = async (extra) => {
      const c = await LG.db.update(id, (cur) => (cur && cur.status === "accepted" ? { ...cur, status: "cancelled", ...extra } : null));
      return c.doc;
    };
    const giveOk = fresh.give.every((k) => fromRoster.some((p) => p.key === k));
    const getOk = fresh.get.every((k) => toRoster.some((p) => p.key === k));
    if (!giveOk || !getOk) return cancelWith({ cancelReason: "roster-changed" });
    // ⭐ THE THREE TRADE GUARDS (2026-08-17 ruling) — CAP, LINEUP, CLOCK; see LG.tradeBlockers'
    // own block comment for what each one is and why CLOCK is deliberately stricter than
    // LG.dropBlocked. This is the AUTHORITATIVE gate: acceptTrade and the Moves composer both
    // already ran the same validator for early UX refusal, but rosters move between offer,
    // accept, and the review window closing, so the last word belongs here, against the exact
    // fresh rosters the roster-changed check just read. Cancelled the same way as that check —
    // own reason on the doc, rosters left untouched — rather than executing silently.
    const blockers = LG.tradeBlockers(fresh, fromRoster, toRoster);
    if (blockers.length) {
      const b = blockers[0];
      return cancelWith({ cancelReason: b.reason, cancelDetail: b.detail });
    }
    // A trade is an ACQUISITION for both sides, so the IR rule applies to both. Judged here,
    // at execution, against the fresh rosters — a trade sits in a review window and a player
    // can perfectly well get healthy inside it. Cancelled with its own reason rather than
    // silently, so the owners can see which stash to resolve and re-offer.
    const stashed = LG.illegalIR(fromRoster).concat(LG.illegalIR(toRoster));
    if (stashed.length) return cancelWith({ cancelReason: "ir-illegal", cancelNames: stashed.map((p) => p.name) });
    const movedFrom = fresh.give.map((k) => fromRoster.find((p) => p.key === k));
    const movedTo = fresh.get.map((k) => toRoster.find((p) => p.key === k));
    // ⭐ CAS (2026-08-18) — THE SWAP, AS TWO IDEMPOTENT DELTAS.
    // These used to be two whole-array writes computed from the rosters read above, which is
    // exactly how the seam suite's C4 lost a trade: a waiver run resolving the same roster in
    // the same moment wrote its own whole array, and whichever landed second erased the other.
    // Now each side says only what it CHANGES — "these keys leave, these men arrive on the
    // bench" — re-applied to the roster as it stands at the instant of the write, so a waiver
    // add, a drop or another trade that landed in between survives alongside the swap.
    //
    // The mutate re-reads its side and does nothing when the swap is ALREADY THERE, which is
    // what makes a second device running the same execution harmless. It deliberately does NOT
    // cancel from in here: the guards above are the authoritative gate (against fresh reads,
    // unchanged), and a refusal raised between the first roster write and the second would
    // manufacture a HALF-SWAP this code cannot produce today. Cross-document atomicity is not
    // something a per-document precondition can give — stated plainly in docs/gffl.md.
    const swap = (leaving, arriving) => (players) => {
      const cur = players || [];
      const gone = leaving.every((k) => !cur.some((p) => p.key === k));
      const here = arriving.every((p) => p && cur.some((x) => x.key === p.key));
      if (gone && here) return null; // already applied (another device, or a retry) — nothing to do
      return cur.filter((p) => !leaving.includes(p.key))
        .concat(arriving.filter((p) => p && !cur.some((x) => x.key === p.key)).map((p) => ({ ...p, slot: "BENCH" })));
    };
    await rosterUpdate(week, fresh.from, swap(fresh.give, movedTo));
    await rosterUpdate(week, fresh.to, swap(fresh.get, movedFrom));
    // The accepted -> executed transition, under the same precondition acceptTrade uses. This
    // is what turns the "someone else may have executed it already" re-read at the top from a
    // check-then-act into a real commit: of two devices past the review window, exactly one
    // writes `executed`, and only that one logs the transaction and sends the pushes. The
    // rosters above are idempotent, so the loser having also applied them costs nothing.
    const committed = await LG.db.update(id, (cur) => {
      if (!cur || cur.status !== "accepted") return null;
      if (Date.now() < (cur.reviewEndsAt ?? Infinity)) return null;
      return { ...cur, status: "executed" };
    });
    if (!committed.ok) return committed.doc; // theirs is the executed record; nothing more to do
    const executed = committed.doc;
    await LG.logTx("trade", week, fresh.from, {
      tradeId: id, from: fresh.from, to: fresh.to, give: fresh.give, get: fresh.get,
      giveNames: movedFrom.map((p) => (p ? p.name : "?")), getNames: movedTo.map((p) => (p ? p.name : "?")), result: "executed",
    });
    // Item 15 (2026-08-09): sys chat post removed — the logTx above carries the same names.
    // S7 producer — the one S4 deliberately left out. This is the moment the rosters actually
    // change, and it is usually nobody's own doing: executeTrade runs off whichever device
    // happened to open the app past the review window, so BOTH parties are told. pushTeam's
    // one rule still applies — if the device running it IS a party, that party is looking at
    // the screen and hears nothing, exactly as with every other producer.
    try {
      const nm = (list) => list.map((p) => (p ? LG.shortName(p.name) : "?")).join(", ");
      const sent = nm(movedFrom), got = nm(movedTo);
      LG.pushTeam(fresh.from, "Trade executed", "You sent " + sent + " to " + LG.teamName(fresh.to) + " for " + got + ".", LG.pushLink("#moves"));
      LG.pushTeam(fresh.to, "Trade executed", "You sent " + got + " to " + LG.teamName(fresh.from) + " for " + sent + ".", LG.pushLink("#moves"));
    } catch (e) { /* a producer may never cost the swap that produced it */ }
    return executed;
  };

  // ---------------- chat (plan §4.5) ----------------
  // One doc per message, id chat_<t>_<rand4>, kind:"chat" so LG.db.list("chat")
  // pulls the whole history (as with tx — no id stored redundantly inside the
  // doc; list() attaches it from the key). thread:null (or absent) = the main
  // league channel; thread:"w<week>_<h>-<a>" = a per-matchup trash-talk thread.
  LG.chatId = (t) => `chat_${t}_${Math.random().toString(36).slice(2, 6)}`;
  LG.CHAT_MAX_TEXT = 500;
  // Text max 500 chars (server-side clamp too — the composer's maxlength is
  // just the UI half of this). ok:false/"empty" when there's truly nothing to
  // post (no text, no image, no gif).
  LG.postChat = async function (opts) {
    opts = opts || {};
    const text = String(opts.text || "").slice(0, LG.CHAT_MAX_TEXT).trim();
    if (!text && !opts.img && !(opts.gif && opts.gif.url)) return { ok: false, reason: "empty" };
    // Date.now(). A chat message is a real-world event, and loadAllChat SORTS on this across
    // every device in the family — stamping it with the per-device replay clock is what put a
    // phone's new message at the TOP of the conversation (see the note at LG.SIM_LOADED_AT).
    const t = Date.now();
    const doc = {
      kind: "chat", t, who: LG.who() || "?", teamId: LG.myTeamId(),
      thread: opts.thread || null, reactions: {},
    };
    if (text) doc.text = text;
    if (opts.img) doc.img = opts.img;
    if (opts.gif && opts.gif.url) doc.gif = { url: opts.gif.url, preview: opts.gif.preview || opts.gif.url };
    if (opts.replyTo) doc.replyTo = opts.replyTo;
    await LG.db.set(LG.chatId(t), doc);
    // S4 producer — @mentions only. A message nobody was named in pushes nobody: chat is a
    // room people drop into, and buzzing the whole league for every line would be the fastest
    // possible way to get every owner to turn alerts off.
    try {
      const from = LG.myTeamId() != null ? LG.teamName(LG.myTeamId()) : (LG.who() || "Someone");
      for (const tid of LG.mentionTargets(text)) {
        // pushTeam already drops the sender, so a self-mention is silent by construction.
        LG.pushTeam(tid, from + " mentioned you", text.slice(0, 140), LG.pushLink("#chat"));
      }
    } catch (e) { /* never costs the message */ }
    return { ok: true, msg: doc };
  };
  // Every mode-"story"-style event post below routes through here. Wrapped so
  // a chat outage can NEVER break the flow it's narrating (waivers/trades/
  // rules still complete even if this throws) — callers additionally wrap
  // their own call in try/catch as a second layer, this is the first.
  LG.postSys = async function (text) {
    try {
      const t = Date.now(); // same ordering rule as postChat
      const doc = { kind: "chat", t, who: "GFFL", teamId: null, text: String(text || "").slice(0, LG.CHAT_MAX_TEXT), sys: true, thread: null, reactions: {} };
      await LG.db.set(LG.chatId(t), doc);
      return doc;
    } catch (e) { return null; }
  };
  LG.loadAllChat = async function () {
    return (await LG.db.list("chat")).sort((a, b) => b.t - a.t); // newest first
  };
  LG.loadChat = async function (thread) {
    const key = thread || null;
    const all = await LG.loadAllChat();
    return all.filter((m) => (m.thread || null) === key).sort((a, b) => a.t - b.t); // oldest first for rendering top-to-bottom
  };
  // Meme library: the most recent DISTINCT images already posted anywhere in
  // chat (main channel or any thread) — house classics, not per-thread.
  // (LG.recentChatImages removed 2026-08-11 — it existed only to feed the chat composer's
  //  "Images" recent-images picker, which the user ordered gone in refinement 3.)
  // Read-modify-write on a shared reactions map, so it takes the same precondition every other
  // one in this file does (2026-09-02). getFresh-then-set is a check-then-act: two owners tapping
  // the same emoji on the same message within a second — which is exactly what a reaction IS —
  // and the second write puts the first one's toggle back. The mutate toggles against the doc as
  // it stands at the instant of the write, so both taps land, in whichever order they arrive.
  LG.toggleReaction = async function (id, emoji, teamId) {
    const r = await LG.db.update(id, (cur) => {
      if (!cur || cur.kind !== "chat") return null;
      const set = new Set((cur.reactions && cur.reactions[emoji]) || []);
      if (set.has(teamId)) set.delete(teamId); else set.add(teamId);
      return { ...cur, reactions: { ...(cur.reactions || {}), [emoji]: [...set] } };
    });
    return r.ok ? r.doc : null;
  };
  // Delete-own, or commissioner-delete-any (plan §4.5's moderation posture —
  // no infrastructure beyond these two). allowCommish is the CALLER'S PIN
  // check (LG.commishUnlocked()) — this fn doesn't gate the PIN itself.
  LG.deleteChat = async function (id, byTeamId, allowCommish) {
    const doc = await LG.db.getFresh(id);
    if (!doc || doc.kind !== "chat") return { ok: false, reason: "not-found" };
    if (!allowCommish && doc.teamId !== byTeamId) return { ok: false, reason: "not-yours" };
    await LG.db.del(id);
    return { ok: true };
  };

  // ---------------- time ----------------
  LG.nowOverride = null; // test hook — always wins, the 2025 replay's own clock included
  // Under the 2025 replay this is the replay's own accelerated clock, started at the chosen
  // phase's instant and clamped inside week 1 (see the phase block at the top of this file).
  // Off the replay it is the real wall clock, exactly as it always was. Precedence, highest
  // first: the test override, then the replay clock, then Date.now().
  LG.now = () => LG.nowOverride != null ? LG.nowOverride : (LG.SIM_2025 ? LG.simNow() : Date.now());

  // ================= THE LEAGUE RUNS ON CENTRAL TIME, NOT ON A FIXED OFFSET (2026-09-02, S4) ==
  // Both of the functions below used to anchor on `new Date(SEASON_START + "T05:00:00-05:00")`
  // and then add whole 7-day and 24-hour spans — i.e. they lived in a FIXED -05:00 frame. That
  // is correct only while America/Chicago happens to be on CDT. The US falls back on Sunday
  // 2026-11-01, and from the very next league week (week 9, Tuesday Nov 3) every one of these
  // instants slid an hour earlier in local terms: the Wednesday waiver deadline would have read
  // 7:00 AM Central for the rest of the season, an hour AHEAD of the cron that nudges the league
  // to run it (netlify/functions/leaguecron.mjs fires on an Intl-derived 8:00 AM Central band,
  // via a 13:00/14:00 UTC cross-product — see the seam suite's own A4). The engine and the cron
  // would have disagreed about the deadline for the whole back half of the season, playoffs
  // included.
  //
  // The technique is the one leaguecron.mjs and chorereminders.mjs already use: never hand-roll
  // an offset, ask Intl what the wall clock reads. `chiInstant` is the inverse — the UTC instant
  // at which Central's wall clock reads exactly this date and time — resolved by two passes,
  // because the offset itself depends on the answer. 05:00 and 08:00 are both far from the 02:00
  // transition, so neither is ever ambiguous or non-existent.
  const CHI_FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  function chiOffsetMs(ms) {
    const o = {};
    for (const p of CHI_FMT.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = p.value;
    let hh = Number(o.hour);
    if (hh === 24) hh = 0; // some engines emit 24 for midnight
    const asUtc = Date.UTC(Number(o.year), Number(o.month) - 1, Number(o.day), hh, Number(o.minute), Number(o.second));
    return asUtc - Math.floor(ms / 1000) * 1000;
  }
  // Memoised: currentWeek() is called on every render and every poll tick, and formatToParts is
  // not free. The key is the wall-clock reading being resolved, which is a pure function of its
  // own arguments, so a cached answer can never go stale.
  const chiCache = new Map();
  function chiInstant(y, m, d, hh, mm) {
    const key = y + "-" + m + "-" + d + "-" + hh + "-" + mm;
    if (chiCache.has(key)) return chiCache.get(key);
    const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
    let t = guess - chiOffsetMs(guess);
    t = guess - chiOffsetMs(t); // second pass, in case the first landed on the other side of a shift
    chiCache.set(key, t);
    return t;
  }
  LG._chiInstant = chiInstant; // test hook — the seam suite hand-computes against the same fn
  // SEASON_START + n CALENDAR days, as a y/m/d triple. The addition is done on a UTC-midnight
  // stamp (UTC has no DST, so +7×86400000 always lands on the right calendar date) and only THEN
  // resolved into a Central instant.
  function seasonDay(nDays) {
    const p = String(LG.SEASON_START).split("-").map(Number);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + nDays * 86400000);
    return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  }
  const weekStartCache = new Map();
  // The Tuesday that STARTS league week `week`, at 05:00 America/Chicago.
  function weekStartMs(week) {
    const key = LG.SEASON_START + "|" + week;
    if (weekStartCache.has(key)) return weekStartCache.get(key);
    const [y, m, d] = seasonDay((week - 1) * 7);
    const t = chiInstant(y, m, d, 5, 0);
    weekStartCache.set(key, t);
    return t;
  }
  LG.weekStart = weekStartMs; // test hook
  LG.currentWeek = function () {
    const now = LG.now();
    // A fixed-length estimate first (one subtraction), then confirmed against the REAL Central
    // boundaries either side — the DST shift can only ever move a boundary by one hour, so at
    // most one step in either direction is needed and every weekStartMs is memoised.
    let w = 1 + Math.floor((now - weekStartMs(1)) / (7 * 24 * 3600 * 1000));
    w = Math.max(1, Math.min(18, w));
    while (w > 1 && now < weekStartMs(w)) w--;
    while (w < 18 && now >= weekStartMs(w + 1)) w++;
    return Math.max(1, Math.min(18, w));
  };
  // Waiver processing deadline for a given week, from rules.waivers.processDow/processHour
  // (default Wed/8am — plan §4.3), resolved in America/Chicago so it reads the SAME wall-clock
  // time every week of the season. Hand-checked instants (2026 rules defaults, SEASON_START
  // 2026-09-08): week 1 -> Wed Sep 9 08:00 CDT = 13:00Z · week 2 -> Wed Sep 16 = 13:00Z ·
  // week 9 -> Wed Nov 4, the first Wednesday past the Nov 1 fall-back, 08:00 CST = 14:00Z.
  LG.waiverDeadline = function (week) {
    const TUESDAY = 2;
    const w = (LG.rules || LG.DEFAULT_RULES).waivers;
    const dowOffsetDays = ((w.processDow ?? 3) - TUESDAY + 7) % 7;
    const [y, m, d] = seasonDay((week - 1) * 7 + dowOffsetDays);
    return chiInstant(y, m, d, w.processHour ?? 8, 0);
  };
  // ⭐ THE DISPLAY BOUNDARY (2026-08-09). A family member must never be shown the string
  // "NaN" — if a number cannot be computed, the honest answer on screen is "—", the same thing
  // every "not known yet" already reads as. This one funnel covers ~30 render sites at once
  // (every score, projection, total, PF/PA, record-book superlative and bracket cell), so no
  // upstream oddity — a hand-typed rule, a half-written history doc, a provider field that
  // arrives as a string — can ever paint NaN again. It guards the VALUE, not the cause: the
  // causes are fixed at their own sources too (D.score's num(), the accumulators below, the
  // rules editor's numeric fields).
  LG.fmtPts = (n) => {
    if (n == null) return "—";
    const v = typeof n === "number" ? n : Number(n);
    return Number.isFinite(v) ? (Math.round(v * 100) / 100).toFixed(1) : "—";
  };
  // The same rule for anything formatted with a raw toFixed: a finite number, or a dash.
  LG.fmtNum = (n, dp) => {
    const v = typeof n === "number" ? n : Number(n);
    return Number.isFinite(v) ? v.toFixed(dp == null ? 1 : dp) : "—";
  };
  // Coerce persisted/untrusted numerics at the point of ACCUMULATION. `pf += m.homePts` on a
  // matchup written without points (a bye row, a half-imported history season) turns a whole
  // team's points-for into NaN for the rest of the table — one missing field, a column of "NaN".
  LG.n = (v) => { const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : 0; };

  // ---------------- THE COMMISSIONER'S RULING, RULE 1 — THE ZERO FLOOR (2026-08-20) ----------
  // "no player score may go below zero, ever." A RULE-LAYER step, not a formula change: the
  // stats->points map (D.score/STAT_MAP) stays ESPN-faithful and computes whatever the real
  // formula says, negative included (a QB with 2 INT and no yards genuinely reads -4.0 there,
  // and tools/_gffl_rules_reconcile.mjs must keep proving THAT number against ESPN's own 2025
  // season — it never reads through this floor). Everywhere a player's TOTAL points become
  // visible or recorded, this is the one funnel that clamps it. null passes through untouched —
  // "we don't know" and "he scored zero" are different claims (the 2026-08-09 NaN work's own
  // rule), and a floor must never turn the first into the second.
  LG.floorPts = (n) => (n == null ? null : Math.max(0, n));

  // ---------------- player names: ALWAYS "J. Allen" (2026-08-08, user) ----------------
  // A DISPLAY-layer formatter, deliberately not a data-layer rewrite: stored rosters, the
  // transaction log's own addName/dropName records, the wire payload the AI read matches its
  // reply against, and every already-written history doc all keep their FULL names. Formatting
  // at the render site means old records shorten too, and nothing that matches on a name breaks.
  //   · D/ST rows are TEAM names, not people — "Bills D/ST" stays whole (ESPN does the same).
  //   · Idempotent: an already-short "J. Allen" is returned untouched.
  //   · Suffixes ride along: "Kenneth Walker III" -> "K. Walker III".
  //   · Surname PARTICLES are kept with the surname, so "Amon-Ra St. Brown" -> "A. St. Brown"
  //     rather than the wrong "A. Brown"; the surname is otherwise the LAST token, which is what
  //     makes a double first name ("Ray Ray McCloud") come out "R. McCloud" and not "R. Ray McCloud".
  const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);
  const NAME_PARTICLES = new Set(["st", "st.", "van", "von", "de", "del", "della", "di", "du", "da", "dos", "la", "le", "den", "der", "ter"]);
  LG.shortName = function (name) {
    const raw = String(name == null ? "" : name).trim();
    if (!raw || raw.indexOf(" ") < 0) return raw;          // one token — a surname-only or a team
    if (/\bD\/ST\b|\bDST\b/i.test(raw)) return raw;         // a team defense, not a person
    let toks = raw.split(/\s+/);
    const suffix = [];
    while (toks.length > 2 && NAME_SUFFIXES.has(toks[toks.length - 1].toLowerCase().replace(/,$/, ""))) {
      suffix.unshift(toks.pop().replace(/,$/, ""));
    }
    if (toks.length < 2) return raw;
    if (/^[A-Za-z]\.?$/.test(toks[0]) && toks[0].length <= 2) return raw; // already "J. Allen"
    let surname = toks[toks.length - 1];
    if (toks.length > 2 && NAME_PARTICLES.has(toks[toks.length - 2].toLowerCase())) {
      surname = toks[toks.length - 2] + " " + surname;
    }
    const initial = toks[0].charAt(0).toUpperCase();
    return initial + ". " + surname + (suffix.length ? " " + suffix.join(" ") : "");
  };

  // ---------------- weekly finalization + projections + power rankings + awards (S5) ----------------
  // The server-side truth of a completed week (plan §3/§4.6/§4.9/§5): once every one of THAT
  // WEEK's starters' NFL games reads "post" (final), LG.finalizeWeek computes the official
  // matchup totals from the SAME live engine rows the matchup page already shows (LG.data,
  // loaded by lg-data.js before this is ever called), writes them as a write-once doc, and
  // everything downstream (standings, power rankings, the accuracy scoreboard) is re-derived
  // from that doc forever — no single mutable doc whose loss loses the season (plan §8).
  LG.weeklyId = (season, week) => `weekly_${season}_w${week}`;
  // A VOID doc reads as ABSENT here too (see LG.weeklyIsVoid) — which is what makes the bracket
  // builder's "is this week finalized?" scan, advanceBracket's three round reads and lg-ui's own
  // week card all inherit the self-heal without knowing it exists. finalizeWeek deliberately
  // does NOT read through this: it needs to SEE the zombie in order to replace it.
  LG.loadWeekly = async (week) => {
    const doc = await LG.db.get(LG.weeklyId(LG.SEASON, week));
    return LG.weeklyIsVoid(doc) ? null : doc;
  };
  LG.projSnapId = (season, week) => `projsnap_${season}_w${week}`;
  LG.loadProjSnap = (week) => LG.db.get(LG.projSnapId(LG.SEASON, week));

  // ⭐ SEASON-SIM BUG 2 (2026-08-11) — WHICH ROSTER A FINALIZE SCORES.
  // Every fz* helper used to read rosters through LG.db's cache, and finalizeWeek writes a
  // WRITE-ONCE doc that standings, waiver priority, power rankings, playoff seeding and the
  // record book all derive from forever. A commissioner whose page had cached a lineup before
  // that owner's last-minute change therefore stamped the WRONG lineup into the permanent
  // record (measured in the sim at Δ9.66 points, and there is no way back). So a finalize run
  // builds ONE fresh snapshot of the rosters it is about to score and threads it through every
  // helper. Two properties, both load-bearing:
  //   · FRESH — the roster of record at the instant of the write, not this page's snapshot;
  //   · CONSISTENT — fzTeamTotal, the Bust award and fzOptimalTotal all score the SAME lineup,
  //     which a per-call fresh read would not guarantee (an owner tapping Swap mid-finalize
  //     could otherwise have their optimal-lineup grade computed against a different roster
  //     than their score).
  // `rosters` is a Map(teamId -> players), lazily filled, created per finalizeWeek call and
  // NEVER shared between runs. Omit it (snapshotProjections, and any future caller) and every
  // read is the ordinary cached one, exactly as before.
  async function fzRosterOf(week, teamId, rosters) {
    if (!rosters) return LG.ensureRoster(week, teamId);
    if (!rosters.has(teamId)) rosters.set(teamId, await LG.ensureRoster(week, teamId, { fresh: true }));
    return rosters.get(teamId);
  }
  async function fzStarters(week, teamId, rosters) {
    const ros = await fzRosterOf(week, teamId, rosters);
    return ros.filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
  }
  // Reads whatever the live engine currently has for this player — at finalization time (every
  // relevant game "post" AND the engine's own week matching the week being finalized) that IS
  // the final score, same as the matchup page's own display. `ptsOf` is threaded through every
  // caller below so the commissioner's archived-stats backfill can substitute a REAL past
  // week's numbers for the live snapshot (adversarial review 2026-08-08, findings 1/3/7).
  function fzPts(key) {
    const d = LG.data;
    const row = d && d.S && d.S.players.get(key);
    // RULE 1 (2026-08-20): the write-once weekly record scores off the FLOORED number, same as
    // every other place a total reaches the family. `row.pts` itself stays raw in D.S — this
    // is the one funnel, not a second copy of the rule.
    // …and through LG.n FIRST (2026-09-02, the minor fold-in): floorPts is Math.max(0, n), and
    // Math.max(0, NaN) is NaN — so a single non-finite row.pts (a poisoned scoring key, a
    // provider field that arrived as a string) propagated straight into the WRITE-ONCE weekly
    // doc, where LG.fmtPts then renders it "—" forever and every standings accumulation reading
    // it has to defend itself. Coerce at the source, once. `null` still means "no row at all"
    // and still scores 0, exactly as before.
    return row && row.pts != null ? LG.floorPts(LG.n(row.pts)) : 0;
  }
  // The engine's own authoritative week, or null when unknown / the providers disagree.
  function fzEngineWeek() {
    const d = LG.data;
    return d && d.engineWeek ? d.engineWeek() : null;
  }
  // …and which part of the season those rows are from (ITEM 30). Same shape, same null rule.
  function fzSeasonType() {
    const d = LG.data;
    return d && d.engineSeasonType ? d.engineSeasonType() : null;
  }
  function fzGameState(team) {
    const d = LG.data;
    if (!d || !d.S || !d.slpTeam) return null;
    const g = d.S.games.get(d.slpTeam(team));
    return g ? g.state : null;
  }
  // ⭐ ONE CLOCK FOR "IS THIS MAN'S GAME OVER" (2026-09-02, F3). The live finality gate below
  // used to ask fzGameState(team) !== "post" — a RAW read of D.S.games — while RULE 2's
  // mathematical-finality theorem (LG.matchupDecided, 2026-08-20) asks D.gameDone(team). The two
  // disagree on exactly the case that happens to eight teams every single week: a starter on a
  // BYE has no entry in D.S.games at all, so fzGameState returns null, null !== "post", and the
  // week is PENDING FOREVER — while D.gameDone says a bye is done (a team not on the slate can
  // never add another point, which is what makes the theorem's floor hold). Measured on the
  // pre-fix engine (scratchpad probe1_bye.cjs): eight teams, every tracked game "post", ONE
  // starter on a bye -> finalizeWeek refused "not-final" naming him, while the identical board
  // with no bye starter finalized cleanly. Every week from week 5 on has byes.
  // So the gate reads the SAME function RULE 2 reads. It deliberately does NOT reimplement it:
  // D.gameDone is simultaneously being tightened in lg-data.js (an EMPTY games map is not
  // "everything is done", and "post" now requires the game to be genuinely completed) and this
  // gate inherits both by calling it. Fail-CLOSED when the data layer is not there at all: no
  // gameDone means nothing is provably done, which refuses rather than writes.
  function fzGameDone(team) {
    const d = LG.data;
    return !!(d && d.gameDone && d.gameDone(team));
  }
  async function fzTeamTotal(week, teamId, ptsOf, rosters) {
    const pts = ptsOf || fzPts;
    let total = 0;
    // LG.n at the accumulation as well as at fzPts' own source: `ptsOf` is caller-supplied on
    // the backfill path, and one non-finite value would otherwise make the whole team total NaN.
    for (const p of await fzStarters(week, teamId, rosters)) total += LG.n(pts(p.key));
    return Math.round(total * 100) / 100;
  }
  // The optimal LEGAL lineup's total — what LG.slotEligible would have allowed, at maximum —
  // used only by the Bench Blunder award. Fill every dedicated position slot with its own top
  // scorers first (dedicated slots never compete with each other, so that's always at least as
  // good as any alternative), then FLEX with the single best REMAINING RB/WR/TE: provably
  // optimal for this "one shared slot" roster shape (an exchange argument — swapping a worse
  // player into a dedicated slot to "free up" a better one for FLEX can never help, since the
  // vacated dedicated slot can only be re-filled by another player of that same position).
  async function fzOptimalTotal(week, teamId, ptsOf, rosters) {
    const fz = ptsOf || fzPts;
    const ros = (await fzRosterOf(week, teamId, rosters)).filter((p) => p.slot !== "IR");
    const r = (LG.rules || LG.DEFAULT_RULES).roster;
    const byPos = { QB: [], RB: [], WR: [], TE: [], DST: [], K: [] };
    for (const p of ros) { if (byPos[p.pos]) byPos[p.pos].push({ key: p.key, pts: fz(p.key) }); }
    for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => b.pts - a.pts);
    const used = new Set();
    let total = 0;
    const takeTop = (pos, n) => {
      let taken = 0;
      for (const e of byPos[pos]) {
        if (taken >= n) break;
        if (used.has(e.key)) continue;
        used.add(e.key); total += e.pts; taken++;
      }
    };
    takeTop("QB", r.QB || 0); takeTop("RB", r.RB || 0); takeTop("WR", r.WR || 0);
    takeTop("TE", r.TE || 0); takeTop("DST", r.DST || 0); takeTop("K", r.K || 0);
    const flexPool = [...byPos.RB, ...byPos.WR, ...byPos.TE]
      .filter((e) => !used.has(e.key)).sort((a, b) => b.pts - a.pts);
    for (let i = 0; i < (r.FLEX || 0) && i < flexPool.length; i++) { used.add(flexPool[i].key); total += flexPool[i].pts; }
    return Math.round(total * 100) / 100;
  }
  function fzTeamName(id) { return (LG.teamById(id) || {}).name || ("Team " + id); }

  // One-time, per-week, per-device-first-in snapshot of every rostered STARTER's pre-game
  // projection (plan §5 "ours" accuracy scoreboard). Skips anyone whose game has already
  // started — a mid-game read isn't a prediction any more. Returns null (writing nothing) when
  // there's nothing worth snapshotting yet (e.g. the live engine's projections aren't warm),
  // so a too-early attempt can never lock in a garbage/empty snapshot that blocks a real one.
  LG.snapshotProjections = async function (week) {
    // A read-only mirror can't persist one, and it is a background convenience the first
    // genuinely-connected client will write anyway — never a reason to raise the offline
    // toast at a reader who has only opened the app.
    if (LG.mirrorOffline) return null;
    const id = LG.projSnapId(LG.SEASON, week);
    const existing = await LG.db.get(id);
    if (existing && existing.kind === "projsnap") return existing;
    await LG.loadTeams();
    const d = LG.data;
    const rows = [];
    for (const t of LG.teams) {
      for (const p of await fzStarters(week, t.id)) {
        const st = fzGameState(p.team);
        if (st && st !== "pre") continue; // already underway or final — not a pre-game read
        const proj = d && d.projFor ? d.projFor(p.key) : null;
        if (proj == null) continue;
        rows.push({ key: p.key, name: p.name, teamId: t.id, proj: Math.round(proj * 100) / 100 });
      }
    }
    if (!rows.length) return null;
    // Provenance: when this snapshot was really taken. Persisted, so wall time.
    const doc = { kind: "projsnap", week, players: rows, at: Date.now() };
    const fresh = await LG.db.getFresh(id); // idempotency race guard — bypasses LG.db's cache
    if (fresh && fresh.kind === "projsnap") return fresh;
    await LG.db.set(id, doc);
    return doc;
  };

  // Bust of the Week (min proj 8 — plan §5) + Top Score + Bench Blunder, computed against
  // THIS week's just-settled matchups.
  async function fzAwards(week, matchups, ptsOf, projOf, rosters) {
    const fz = ptsOf || fzPts;
    // Bust of the Week grades an actual against a PRE-GAME PROJECTION, and the engine only
    // ever holds the CURRENT week's projections — so an archived-stats backfill of a past
    // week has no honest projection to grade against and simply skips the award rather than
    // inventing one from this week's numbers (adversarial review 2026-08-08).
    const proj = projOf || ((key) => (LG.data && LG.data.projFor ? LG.data.projFor(key) : null));
    const teamPts = {};
    for (const m of matchups) { teamPts[m.home] = m.homePts; teamPts[m.away] = m.awayPts; }
    const teamIds = Object.keys(teamPts).map(Number);
    let topScore = null;
    for (const tid of teamIds) if (!topScore || teamPts[tid] > topScore.pts) topScore = { teamId: tid, pts: teamPts[tid] };
    let bust = null;
    for (const tid of teamIds) {
      for (const p of await fzStarters(week, tid, rosters)) {
        const pj = proj(p.key);
        if (pj == null || pj < 8) continue;
        const shortfall = Math.round((pj - fz(p.key)) * 100) / 100;
        if (!bust || shortfall > bust.shortfall) {
          bust = { key: p.key, name: p.name, teamId: tid, proj: Math.round(pj * 100) / 100, actual: fz(p.key), shortfall };
        }
      }
    }
    let benchBlunder = null;
    for (const tid of teamIds) {
      const optimal = await fzOptimalTotal(week, tid, fz, rosters);
      const actual = teamPts[tid];
      const diff = Math.round((optimal - actual) * 100) / 100;
      if (diff > 0.01 && (!benchBlunder || diff > benchBlunder.diff)) benchBlunder = { teamId: tid, optimal, actual, diff };
    }
    return { topScore, bust, benchBlunder };
  }

  // Algorithmic power rankings (plan §4.9): score = 4×wins + 0.05×PF + 2×(wins in the last 3
  // games played). Pure function of the persisted "weekly" docs (+ optionally one not-yet-
  // persisted doc, so finalizeWeek can rank THROUGH the week it's currently writing before that
  // doc exists). throughWeek filters to weeks at or before it; omit for "every finalized week".
  LG.powerRankings = async function (throughWeek, extraWeeklyDocs) {
    await LG.loadTeams();
    const weekly = (await LG.loadWeeklyDocs()).filter((w) => !throughWeek || (w.week || 0) <= throughWeek);
    const all = extraWeeklyDocs && extraWeeklyDocs.length ? [...weekly, ...extraWeeklyDocs] : weekly;
    const st = {};
    for (const t of LG.teams) st[t.id] = { w: 0, pf: 0, results: [] };
    for (const wd of [...all].sort((a, b) => (a.week || 0) - (b.week || 0))) {
      for (const m of (wd.matchups || [])) {
        const h = m.home, a = m.away;
        if (!st[h] || !st[a]) continue;
        st[h].pf += LG.n(m.homePts); st[a].pf += LG.n(m.awayPts);
        if (m.homePts > m.awayPts) { st[h].w++; st[h].results.push(1); st[a].results.push(0); }
        else if (m.awayPts > m.homePts) { st[a].w++; st[a].results.push(1); st[h].results.push(0); }
        else { st[h].results.push(0); st[a].results.push(0); }
      }
    }
    const rows = LG.teams.map((t) => {
      const s = st[t.id] || { w: 0, pf: 0, results: [] };
      const last3 = s.results.slice(-3).reduce((sum, r) => sum + r, 0);
      const score = Math.round((4 * s.w + 0.05 * s.pf + 2 * last3) * 100) / 100;
      return { teamId: t.id, score, w: s.w, pf: Math.round(s.pf * 100) / 100, last3 };
    }).sort((a, b) => b.score - a.score || a.teamId - b.teamId);
    rows.forEach((r, i) => { r.rank = i + 1; });
    return rows;
  };

  // Season-to-date accuracy tally (plan §5), rolled up from every finalized week's own
  // `accuracy` field — HONEST LABELING: this is our miss vs OUR OWN pre-game snapshot, never
  // framed as a comparison to ESPN (that data isn't logged yet — see the S5 plan entry).
  LG.seasonAccuracy = async function () {
    const weekly = await LG.loadWeeklyDocs();
    let sum = 0, n = 0;
    for (const w of weekly) { if (w.accuracy && w.accuracy.n) { sum += w.accuracy.ours * w.accuracy.n; n += w.accuracy.n; } }
    return n ? { avg: Math.round((sum / n) * 100) / 100, n } : null;
  };

  // The prereq everything above feeds on. Idempotent — an existing doc is returned untouched,
  // never recomputed. Refuses (reason "not-final", pending: the still-live/unknown starters'
  // names) unless every one of this week's starters' games reads "post", UNLESS opts.force (the
  // commissioner override) — a missing/unknown game state counts as "not final": a week is never
  // guessed official from incomplete data. Posts ONE sys chat message with the scores + awards;
  // that must never break the save (try/catch, same posture as every other event post here).
  //
  // WEEK PROVENANCE (adversarial review 2026-08-08, findings 1/3/7). The live engine holds
  // exactly ONE week's rows, and this function writes a WRITE-ONCE doc that standings,
  // waiver priority, power rankings, playoff seeding, the record book and the champion are
  // all derived from forever. It used to take `week` only for the ROSTER lookup and multiply
  // it by whatever the engine happened to be polling — so the first unattended run after a
  // missed Tuesday stamped week N's permanent record with week N+1's points, silently, with
  // no repair path. Three gates now, in order:
  //   · opts.backfill — the commissioner's clearly-labelled fallback: points come from
  //     Sleeper's ARCHIVED per-week stats for THAT week, so a missed week finalizes with its
  //     own real numbers rather than today's;
  //   · otherwise the engine's own week MUST equal `week` ("stale-week" if it has rolled,
  //     "no-live-data" if it can't say) — even under opts.force, which only ever meant
  //     "some games aren't final yet", never "score it from a different week";
  //   · a playoff week whose bracket still has an unresolved pairing is refused outright,
  //     force included (findings 6/8) — the doc is write-once, so writing it a game short
  //     permanently deletes a semifinal or the championship itself.
  LG.finalizeWeek = async function (week, opts) {
    opts = opts || {};
    const id = LG.weeklyId(LG.SEASON, week);
    const existing = await LG.db.get(id);
    // ⭐ THE IDEMPOTENCY GUARD MUST NOT ANSWER FOR A ZOMBIE (2026-09-02). "A doc exists" used to
    // be the whole test, so a void 0-0 record written by an un-reloaded device made every later
    // finalize — the REAL one — return `ok:true` with the zombie, permanently. See LG.weeklyIsVoid.
    if (existing && existing.kind === "weekly" && !LG.weeklyIsVoid(existing)) return { ok: true, ...existing };
    await LG.loadTeams();
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    if (week > sw) {
      const bracket = await LG.loadBracket();
      const roundKey = week === sw + 1 ? "r1" : week === sw + 2 ? "r2" : week === sw + 3 ? "r3" : null;
      const round = (bracket && roundKey && bracket.rounds[roundKey]) || [];
      const unresolved = round.filter((g) => g.home == null || g.away == null);
      if (unresolved.length) {
        return { ok: false, reason: "bracket-unresolved", games: unresolved.map((g) => g.id) };
      }
    }
    let ptsOf = null;
    if (opts.backfill) {
      // Explicit season (not left to D.weekStats' own st.season fallback, which reads
      // Sleeper's LIVE /state/nfl — the REAL current NFL season, always, regardless of which
      // season this league doc claims to be). LG.SEASON is this league's own source of truth
      // (the 2025 replay, or the running real season) — passing it explicitly is what lets a
      // past-season backfill pull that season's own archived stats instead of silently querying
      // the wrong year. When the league IS the running live season the two already agree, so
      // this changes nothing there.
      const map = LG.data && LG.data.weekStats ? await LG.data.weekStats(week, { season: LG.SEASON, seasonType: "regular" }) : null;
      if (!map) return { ok: false, reason: "no-archived-stats" };
      // RULE 1: the backfill path writes the same write-once record the live path does, so it
      // floors too — belt-and-suspenders alongside weekStatsMap's own floor (D.weekStats'
      // per-player values are already floored at the source; LG.floorPts here is idempotent
      // and keeps this site self-evidently compliant without relying on that other file).
      ptsOf = (key) => LG.floorPts(LG.n(map.has(key) ? map.get(key) : 0)); // LG.n: see fzPts
    } else {
      // Explicit belt-and-suspenders for the 2025 replay: its own poll path never sets
      // D.S.espnWeek/D.S.slpWeek, which already makes fzEngineWeek() return null and the check
      // below refuse naturally — this is a SECOND, independent refusal so the guard holds even
      // if that path ever changes. Nothing has been PLAYED in the replay (it is pinned before
      // kickoff), so a live-path finalize could only ever write a week of zeroes into a
      // write-once doc. The archived-stats backfill above stays available — that's a
      // deliberate commissioner action against real numbers, not a guess off the board.
      if (LG.SIM_2025) return { ok: false, reason: "sim-replay" };
      // …and the same refusal for ?demo=ember (2026-08-15). That override forces two starters
      // to fabricated scores so a rendering experiment can be SEEN out of season; those numbers
      // reach D.livePts, so without this they could reach a WRITE-ONCE weekly record and stand
      // there all season. A demo must never be able to write. Backfill is untouched — it scores
      // from archived stats and never consults the live board.
      if (LG.data && LG.data.demoActive && LG.data.demoActive()) return { ok: false, reason: "demo-board" };
      // ⭐ ITEM 30 (2026-08-09) — PRESEASON. This is the guard the week check cannot be:
      // preseason week 1 and regular-season week 1 are both "1", and LG.currentWeek() clamps
      // to 1 before SEASON_START, so from the day preseason starts until the real opener the
      // two agree exactly while the board holds exhibition football. Everything downstream
      // would then have passed — every starter's game reads "post" by Sunday night — and
      // weekly_<season>_w1 is WRITE-ONCE: standings, waiver priority, power rankings, playoff
      // seeding and the record book would all have carried a preseason result permanently.
      // Positively-regular only (D.engineRegular), so an unknown season type refuses too.
      const est = fzSeasonType();
      if (est !== "regular") return { ok: false, reason: est ? "preseason" : "no-live-data", seasonType: est };
      const ew = fzEngineWeek();
      if (ew == null) return { ok: false, reason: "no-live-data" };
      if (ew !== week) return { ok: false, reason: "stale-week", engineWeek: ew };
    }
    // gamesForWeek is the ONE source of what's actually being played this week — the regular
    // schedule for weeks <= seasonWeeks, or the bracket's resolved pairings for playoff weeks
    // (S7). A playoff week with no bracket yet, or a round still waiting on an earlier upset to
    // resolve, simply has nothing to finalize.
    const wkGames = await LG.gamesForWeek(week);
    if (!wkGames || !wkGames.length) return { ok: false, reason: "no-schedule" };

    // ⭐ SEASON-SIM BUG 2 — the one fresh, consistent roster snapshot this run scores. Created
    // here (not at the top) so every early return above still costs nothing extra: the reads
    // only happen once a finalize is genuinely going to compute something. Deliberately
    // ordered BEFORE the "is every game post?" gate, so the gate judges the same lineups the
    // scoring will use rather than a cached set that might name a different player.
    const fzRosters = new Map();

    // The archived-stats path is its own proof that the week is over (Sleeper only serves a
    // completed week's box), so the live "is every game post?" gate applies to the live path.
    if (!opts.force && !opts.backfill) {
      const pending = [];
      for (const [h, a] of wkGames) {
        for (const tid of [h, a]) {
          for (const p of await fzStarters(week, tid, fzRosters)) {
            // fzGameDone, not a raw "post" read — the two finality seams must agree. See the
            // block comment at fzGameDone for the bye-week measurement that forced this.
            if (!fzGameDone(p.team)) pending.push(p.name);
          }
        }
      }
      if (pending.length) return { ok: false, reason: "not-final", pending };
    }

    // ⭐ A WEEK NOBODY PLAYED IS NOT A RESULT (2026-08-31). The live gate above asks "is any
    // starter's game still pending?" — and over ZERO starters that is vacuously satisfied,
    // the same every-empty-list hole matchupDecided closed on 2026-08-26 one layer up. On
    // 2026-08-30 the two remaining guards lined up behind it: the season-reset left every
    // roster empty, the week-1 re-target made ESPN answer "regular", Sleeper happened to be
    // unreachable so the one-sided season-type read was trusted — and a device's boot
    // auto-checks wrote weekly_2026_w1 as four 0-0 ties into a WRITE-ONCE record. (Repaired
    // by hand: backed up, deleted, this guard added the same hour.) The rule sits HERE, in
    // the compute phase, deliberately below force/backfill branching: no path — commissioner
    // force included — may record a week in which no matchup had a single starter. An
    // archived backfill of a real week always has starters, so this refuses nothing real.
    let fzStarterCount = 0;
    const emptyPairs = [];
    for (const [h, a] of wkGames) {
      const hn = (await fzStarters(week, h, fzRosters)).length;
      const an = (await fzStarters(week, a, fzRosters)).length;
      fzStarterCount += hn + an;
      if (hn === 0 && an === 0) emptyPairs.push([h, a]);
    }
    if (fzStarterCount === 0) return { ok: false, reason: "empty-week" };
    // ⭐ …AND A WEEK IS A UNIT (2026-09-02, S6). The guard above is LEAGUE-WIDE: it only fires
    // when EVERY matchup is empty, so a board where three real matchups are ready and ONE
    // pairing has nobody on either side sails straight past it and records that pairing as a
    // 0-0 TIE — into the same write-once doc, feeding standings, waiver priority, power
    // rankings and playoff seeding forever, with no way back. That is the identical every([])
    // hole one level further in, and the answer is the same one the empty-week guard gave: a
    // week nobody played is not a result. Refuse the WHOLE WEEK and NAME the pairing, because a
    // week is a unit — finalizing the other three and leaving this one out would write a
    // partial permanent record, which is precisely what the bracket findings (6/8) already
    // established must never happen. The commissioner fixes the roster and re-finalizes; the
    // reason tells them which one. Force included, for the empty-week guard's own reason: no
    // path may record a matchup nobody fielded.
    if (emptyPairs.length) {
      return {
        ok: false, reason: "empty-matchup",
        pairs: emptyPairs,
        matchups: emptyPairs.map(([h, a]) => fzTeamName(h) + " vs " + fzTeamName(a)),
      };
    }

    const pts = ptsOf || fzPts;
    const matchups = [];
    for (const [h, a] of wkGames) {
      matchups.push({ home: h, away: a, homePts: await fzTeamTotal(week, h, pts, fzRosters), awayPts: await fzTeamTotal(week, a, pts, fzRosters) });
    }
    const awards = await fzAwards(week, matchups, pts, opts.backfill ? () => null : null, fzRosters);
    const power = await LG.powerRankings(week, [{ week, matchups }]);

    const snap = await LG.loadProjSnap(week);
    let accuracy = null;
    if (snap && Array.isArray(snap.players) && snap.players.length) {
      let sum = 0;
      for (const row of snap.players) sum += Math.abs(row.proj - pts(row.key));
      accuracy = { ours: Math.round((sum / snap.players.length) * 100) / 100, n: snap.players.length };
    }

    const doc = {
      kind: "weekly", week, matchups, awards,
      power: power.map((r) => ({ teamId: r.teamId, score: r.score, rank: r.rank })),
      accuracy, finalizedAt: Date.now(), // provenance — persisted, so wall time
      source: opts.backfill ? "archived" : "live", // provenance, on the record
    };

    // ⭐ WRITE-ONCE, STRUCTURALLY (2026-08-18). This was a re-read followed by a write — a
    // check-then-act, so two devices finalizing the same week could both read "not there yet"
    // and both write, and a weekly doc is the league's permanent record of scores, awards,
    // standings input and playoff seeding. It is now a CREATE-ONLY compare-and-swap: the write
    // carries `currentDocument.exists=false`, so the SERVER refuses the second one. The mutate
    // aborts the moment it sees a weekly doc already there, and the caller answers exactly what
    // it answered before — ok:true with the record that exists, never an error.
    //
    // ⭐ …WITH ONE EXCEPTION, AND IT IS THE SELF-HEAL (2026-09-02). Create-only cannot repair a
    // week that a stale build already poisoned, and the two real zombies (2026-08-30 and
    // 2026-09-01) had to be deleted by hand. So: a REAL record is still untouchable (the mutate
    // aborts and the caller gets it back, exactly as before), and a VOID one is REPLACED under
    // the ordinary compare-and-swap — carrying `replacedVoid: true` so the repair is on the
    // record rather than invisible. LG.db.update sends `exists=false` when the doc is absent and
    // `updateTime=<what we read>` when it is present, so the replacement is still refused if
    // anybody else moves the doc between the read and the write.
    const r = await LG.db.update(id, (cur) => {
      if (cur && cur.kind === "weekly" && !LG.weeklyIsVoid(cur)) return null; // a real week is written once, forever
      if (cur && cur.kind === "weekly") return { ...doc, replacedVoid: true };
      return doc;
    });
    // ALWAYS the document the loop actually settled on — on an abort that is the record already
    // there, and on a success it is what was written, `replacedVoid` included. Returning the
    // locally-computed `doc` instead (as this did) silently dropped the repair stamp from the
    // caller's view even though it was correctly persisted.
    if (!r.ok) return { ok: true, ...r.doc };

    // Item 15 (2026-08-09): the "week N is official" sys chat post is GONE. The weekly doc
    // this function just wrote IS the record — the league home renders its scores and all
    // three awards straight off it, and the record book reads every one of them.

    // S4 producer — the one LEAGUE-WIDE send. It sits after the write-once race guard above,
    // so the client that actually wrote the doc is the only one that sends it. `excludeTeam`
    // is that client's own team: whoever's app happened to run the auto-finalize is, by
    // definition, looking at the league right now.
    LG.pushWeekRecap(week, matchups);

    return { ok: true, ...r.doc };
  };
  // "Battle Kreussers 112.4 — 98.1 End Zone Goats · …", winner first in each pairing so the
  // line reads as results rather than as the schedule. Trimmed to two games plus a count,
  // because a notification body is one glanceable line, not a scoreboard.
  LG.pushWeekRecap = function (week, matchups) {
    try {
      const lines = (matchups || []).map((m) => {
        const homeWon = m.homePts >= m.awayPts;
        const [wId, wPts, lId, lPts] = homeWon
          ? [m.home, m.homePts, m.away, m.awayPts]
          : [m.away, m.awayPts, m.home, m.homePts];
        return LG.teamName(wId) + " " + LG.fmtPts(wPts) + " — " + LG.fmtPts(lPts) + " " + LG.teamName(lId);
      });
      const shown = lines.slice(0, 2).join(" · ");
      const more = lines.length > 2 ? " · +" + (lines.length - 2) + " more" : "";
      LG.pushNotify({
        all: true, excludeTeam: LG.myTeamId(),
        title: "Week " + week + " is final",
        body: shown + more, link: LG.pushLink(),
      });
    } catch (e) { /* a producer may never cost the week it is announcing */ }
  };

  // ---------------- playoffs, bracket, trophies (S7, plan §4.10) ----------------
  // Format is entirely config-driven off LG.rules.playoffs {teams, byes} and
  // LG.rules.seasonWeeks — a future format change (more/fewer playoff teams,
  // a longer regular season) needs no code here, only a rules-doc edit.
  // Three playoff weeks, seasonWeeks+1..+3: week 1 = play-in (the non-bye
  // seeds, paired top-vs-bottom) + consolation game A; week 2 = semifinals
  // (bye seeds vs play-in winners, standard bracket seeding — #1 plays the
  // lowest surviving seed) + consolation game B; week 3 = championship +
  // 3rd-place game + consolation game C. The three non-playoff teams round-
  // robin across all three weeks (LG.generateSchedule, the same circle-method
  // generator the regular schedule uses — with an odd team count it already
  // produces exactly one game per team per round and a bye every round,
  // which is precisely the "seed8 idle" shape the format wants); the Toilet
  // Bowl loser is whoever has the worst record across those 3 games once
  // week 3 finalizes.
  LG.bracketId = (season) => `bracket_${season}`;
  LG.loadBracket = async function () {
    const doc = await LG.db.get(LG.bracketId(LG.SEASON));
    return doc && doc.kind === "bracket" ? doc : null;
  };
  // Playoff weeks look TWO levels deep (game -> its source game -> that game's own weekly
  // result), so every lookup goes through these two small, order-independent helpers rather
  // than duplicating the search/tie-rule in three places.
  function bkFindGame(bracket, id) {
    for (const k of ["r1", "r2", "r3"]) {
      const g = (bracket.rounds[k] || []).find((x) => x.id === id);
      if (g) return g;
    }
    return null;
  }
  // A tie (possible on a force-finalized week, or a genuine PPR-era tied score) goes to the
  // HOME side — arbitrary but deterministic, matching finalizeWeek's own W/L tie handling
  // nowhere favoring one side by rule (a real dead-even bracket game is vanishingly rare and
  // the alternative — refusing to advance — would strand the whole bracket on a coin flip).
  function bkResult(weeklyDoc, home, away) {
    if (!weeklyDoc) return null;
    const m = (weeklyDoc.matchups || []).find((x) => (x.home === home && x.away === away) || (x.home === away && x.away === home));
    if (!m) return null;
    const hp = m.home === home ? m.homePts : m.awayPts;
    const ap = m.home === home ? m.awayPts : m.homePts;
    return { winner: hp >= ap ? home : away, loser: hp >= ap ? away : home, homePts: hp, awayPts: ap };
  }
  LG.buildBracket = async function (opts) {
    opts = opts || {};
    const id = LG.bracketId(LG.SEASON);
    if (!opts.force) {
      const existing = await LG.db.get(id);
      if (existing && existing.kind === "bracket") return { ok: true, ...existing }; // idempotent
    }
    await LG.loadTeams();
    const rules = LG.rules || LG.DEFAULT_RULES;
    const seasonWeeks = rules.seasonWeeks;
    const missing = [];
    for (let w = 1; w <= seasonWeeks; w++) {
      const doc = await LG.loadWeekly(w);
      if (!doc || doc.kind !== "weekly") missing.push(w);
    }
    if (missing.length) return { ok: false, reason: "weeks-not-final", missing };

    // Seeds = final regular-season standings, wins -> PF -> teamId asc (a fully deterministic
    // tiebreak — LG.loadStandings() itself only sorts wins/PF, so the teamId tiebreak is added
    // here, not relied on from Array#sort stability).
    const st = await LG.loadStandings();
    const seeds = LG.teams.map((t) => t.id).sort((a, b) => {
      const A = st[a] || { w: 0, pf: 0 }, B = st[b] || { w: 0, pf: 0 };
      return (B.w - A.w) || (B.pf - A.pf) || (a - b);
    });

    const pf = rules.playoffs || {};
    const playoffCount = Math.max(0, Math.min(pf.teams || 0, seeds.length));
    const byes = Math.max(0, Math.min(pf.byes || 0, playoffCount));
    const playoffSeeds = seeds.slice(0, playoffCount);
    const byeSeeds = playoffSeeds.slice(0, byes);
    const nonByeSeeds = playoffSeeds.slice(byes);
    const consolationSeeds = seeds.slice(playoffCount);
    const wk1 = seasonWeeks + 1, wk2 = seasonWeeks + 2, wk3 = seasonWeeks + 3;

    // Play-in games (week 1): top-vs-bottom of the non-bye seeds — with the locked 5-team/
    // 3-bye format that's exactly ONE game, seed4 vs seed5.
    const playInGames = [];
    const half = Math.floor(nonByeSeeds.length / 2);
    for (let i = 0; i < half; i++) {
      const seedHome = byes + i + 1, seedAway = playoffCount - i;
      playInGames.push({
        id: "playin" + (i + 1), kind: "playin", week: wk1,
        home: nonByeSeeds[i], away: nonByeSeeds[nonByeSeeds.length - 1 - i], seedHome, seedAway,
      });
    }

    // Semis (week 2): standard bracket seeding over [bye seeds..., play-in winners...] —
    // pair position i with position (n-1-i), so the #1 seed always draws the LOWEST surviving
    // seed. With 3 byes + 1 play-in winner that's exactly semi1 = seed1 vs the play-in winner,
    // semi2 = seed2 vs seed3 (the plan's exact spec).
    const round2Slots = [
      ...byeSeeds.map((tid, i) => ({ resolved: true, teamId: tid, seed: i + 1 })),
      ...playInGames.map((g) => ({ resolved: false, from: g.id, label: `Winner of #${g.seedHome}/#${g.seedAway}` })),
    ];
    const semis = [];
    const shalf = Math.floor(round2Slots.length / 2);
    for (let i = 0; i < shalf; i++) {
      const s1 = round2Slots[i], s2 = round2Slots[round2Slots.length - 1 - i];
      const g = { id: "semi" + (i + 1), kind: "semi", week: wk2, home: null, away: null };
      if (s1.resolved) { g.home = s1.teamId; g.seedHome = s1.seed; } else { g.homeFrom = { game: s1.from, result: "winner" }; g.homeLabel = s1.label; }
      if (s2.resolved) { g.away = s2.teamId; g.seedAway = s2.seed; } else { g.awayFrom = { game: s2.from, result: "winner" }; g.awayLabel = s2.label; }
      semis.push(g);
    }

    // Championship + 3rd place (week 3) — both unresolved until the semis finalize.
    const champ = {
      id: "champ", kind: "championship", week: wk3, home: null, away: null,
      homeFrom: { game: "semi1", result: "winner" }, homeLabel: "Winner of Semifinal 1",
      awayFrom: { game: "semi2", result: "winner" }, awayLabel: "Winner of Semifinal 2",
    };
    const third = {
      id: "third", kind: "third", week: wk3, home: null, away: null,
      homeFrom: { game: "semi1", result: "loser" }, homeLabel: "Loser of Semifinal 1",
      awayFrom: { game: "semi2", result: "loser" }, awayLabel: "Loser of Semifinal 2",
    };

    // Consolation round robin over the SAME 3 weeks — reuses LG.generateSchedule verbatim
    // (odd team counts already produce one bye + one game per round via its null-padding).
    const rrTeams = consolationSeeds;
    const rrRounds = rrTeams.length >= 2 ? (rrTeams.length % 2 ? rrTeams.length : rrTeams.length - 1) : 0;
    const rrWeeks = rrRounds ? LG.generateSchedule(rrTeams, rrRounds) : [];
    const consWeekIds = [wk1, wk2, wk3];
    const consGames = [0, 1, 2].map((i) => (rrWeeks[i] || []).map(([h, a], gi) =>
      ({ id: "cons_w" + (i + 1) + "_" + gi, kind: "consolation", week: consWeekIds[i], home: h, away: a })));

    const doc = {
      kind: "bracket", season: LG.SEASON, seeds, playoffCount, byes,
      rounds: {
        r1: [...playInGames, ...consGames[0]],
        r2: [...semis, ...consGames[1]],
        r3: [champ, third, ...consGames[2]],
      },
      champion: null, thirdPlace: null, toilet: null,
    };
    const fresh = await LG.db.getFresh(id); // idempotency race guard — bypasses LG.db's cache
    if (fresh && fresh.kind === "bracket" && !opts.force) return { ok: true, ...fresh };
    await LG.db.set(id, doc);
    // Item 15 (2026-08-09): sys chat post removed — the bracket doc just written is the
    // record, and the Bracket tab renders every bye and every play-in pairing from it.
    return { ok: true, ...doc };
  };
  // The ONE source of "what's being played this week" — the regular schedule for
  // week <= seasonWeeks, or the bracket's currently-RESOLVED pairings for a playoff week
  // (an unresolved slot, e.g. a semifinal still waiting on the play-in winner, is simply
  // omitted — finalizeWeek and the matchup-card list both already treat "no games" honestly).
  LG.gamesForWeek = async function (week) {
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    if (week <= sw) {
      const weeks = await LG.loadSchedule();
      return weeks ? (weeks[week - 1] || []).map(([h, a]) => [h, a]) : [];
    }
    const bracket = await LG.loadBracket();
    if (!bracket) return [];
    const roundKey = week === sw + 1 ? "r1" : week === sw + 2 ? "r2" : week === sw + 3 ? "r3" : null;
    if (!roundKey) return [];
    return (bracket.rounds[roundKey] || []).filter((g) => g.home != null && g.away != null).map((g) => [g.home, g.away]);
  };
  // Fills in whatever the bracket can resolve from what's ALREADY finalized — one round at a
  // time, so calling this repeatedly (boot, every live update, after every finalizeWeek) is
  // cheap and self-limiting: nothing to fill -> nothing changes -> nothing is written. Sets
  // the champion + Toilet Bowl loser (and posts both, and awards the champion's trophy) the
  // moment week 3 finalizes.
  //
  // ⭐ THE BRACKET-CAS FINDING, CLOSED (2026-09-02, S5). This was the last read-modify-write in
  // the file, and the 2026-08-18 CAS entry named it as FOUND-NOT-FIXED: it read the bracket
  // through LG.db's CACHE, mutated that object IN PLACE, and ended on a BLIND whole-document
  // LG.db.set. Two failures rode on that:
  //   · loadBracket hands back the cache's OWN object, so every fill mutated a document other
  //     readers on this page were still holding — the aliasing hazard cacheUpsert has a comment
  //     about, one layer up;
  //   · a device whose cached copy still had r3 null wrote those nulls over another device's
  //     resolved championship. The season sim's writeOnce.bracket sweep catches it (champ/third
  //     home and away reverting from a real team id to null at w17) and it reproduced 2 of 2
  //     runs on unmodified HEAD.
  // The fix is the shape every other adopter already has: a PURE `fill` over a CLONE, run inside
  // LG.db.update so it re-applies to the document as it stands at the instant of the write, and
  // the two side effects — the champion's trophy and the loadTeams refresh — moved OUT, below a
  // successful loop, because a mutate can run six times and a trophy appended six times is six
  // trophies. `fill` returning null when there is nothing to resolve means the common case (the
  // boot/render/every-finalize call) writes NOTHING at all, exactly as before.
  LG.advanceBracket = async function () {
    const bracket = await LG.loadBracket();
    if (!bracket) return { ok: false, reason: "no-bracket" };
    if (bracket.champion != null) return { ok: true, ...bracket }; // fully resolved already
    const rules = LG.rules || LG.DEFAULT_RULES;
    const sw = rules.seasonWeeks;
    const wk1doc = await LG.loadWeekly(sw + 1);
    const wk2doc = await LG.loadWeekly(sw + 2);
    const wk3doc = await LG.loadWeekly(sw + 3);

    // PURE and REENTRANT (LG.db.update's own contract): it reads the three weekly docs captured
    // above and its own argument, clones, fills, and returns — never touching `bracket`, never
    // writing, never awaiting.
    const fill = (cur) => {
      if (!cur || cur.kind !== "bracket") return null;
      const b = JSON.parse(JSON.stringify(cur));
      let changed = false;
      const fillFrom = (games, weeklyDoc) => {
        for (const g of games || []) {
          if (g.home == null && g.homeFrom) {
            const src = bkFindGame(b, g.homeFrom.game);
            const r = src && src.home != null && src.away != null ? bkResult(weeklyDoc, src.home, src.away) : null;
            if (r) { g.home = r[g.homeFrom.result]; changed = true; }
          }
          if (g.away == null && g.awayFrom) {
            const src = bkFindGame(b, g.awayFrom.game);
            const r = src && src.home != null && src.away != null ? bkResult(weeklyDoc, src.home, src.away) : null;
            if (r) { g.away = r[g.awayFrom.result]; changed = true; }
          }
        }
      };
      if (wk1doc) fillFrom(b.rounds.r2, wk1doc); // play-in winner -> the waiting semi
      if (wk2doc) fillFrom(b.rounds.r3, wk2doc); // semi winners/losers -> champ + 3rd place

      if (b.champion == null && wk3doc) {
        const champG = bkFindGame(b, "champ");
        if (champG && champG.home != null && champG.away != null) {
          const r = bkResult(wk3doc, champG.home, champG.away);
          if (r) {
            b.champion = r.winner;
            changed = true;
            const thirdG = bkFindGame(b, "third");
            if (thirdG && thirdG.home != null && thirdG.away != null) {
              const r3 = bkResult(wk3doc, thirdG.home, thirdG.away);
              if (r3) b.thirdPlace = r3.winner;
            }
            // Toilet Bowl: aggregate W/L across the 3 consolation round-robin games (one per
            // playoff week); fewest wins loses it, tied by worse regular-season standing (later
            // in b.seeds).
            const consGames = [...(b.rounds.r1 || []), ...(b.rounds.r2 || []), ...(b.rounds.r3 || [])]
              .filter((g) => g.kind === "consolation");
            const byWeek = {}; byWeek[sw + 1] = wk1doc; byWeek[sw + 2] = wk2doc; byWeek[sw + 3] = wk3doc;
            const rec = {};
            for (const g of consGames) {
              const res = bkResult(byWeek[g.week], g.home, g.away);
              if (!res) continue;
              (rec[res.winner] = rec[res.winner] || { w: 0, l: 0 }).w++;
              (rec[res.loser] = rec[res.loser] || { w: 0, l: 0 }).l++;
            }
            let toiletId = null;
            for (const tid of Object.keys(rec).map(Number)) {
              if (toiletId == null || rec[tid].w < rec[toiletId].w) { toiletId = tid; continue; }
              if (rec[tid].w === rec[toiletId].w && b.seeds.indexOf(tid) > b.seeds.indexOf(toiletId)) toiletId = tid;
            }
            b.toilet = toiletId;
            // Item 15 (2026-08-09): sys chat posts removed — b.champion (plus the trophy saved
            // onto the team below) and b.toilet are both stored here and both render as banners
            // on the Bracket tab.
          }
        }
      }
      return changed ? b : null; // nothing to resolve -> abort, nothing written
    };

    const r = await LG.db.update(LG.bracketId(LG.SEASON), fill);
    const next = (r.doc && r.doc.kind === "bracket") ? r.doc : bracket;
    // THE SIDE EFFECTS, after a successful loop only, and only when THIS call is the one that
    // crowned the champion — a second device advancing the same bracket aborts and gets the
    // record back, so it neither re-writes the trophy nor re-reads the team list.
    if (r.ok && next.champion != null && bracket.champion == null) {
      // FRESH + DEDUPED + DELTA (adversarial review 2026-08-08, finding 10): this used to
      // spread a possibly-stale in-memory team, rolling that team's FAAB and everything else
      // back to whatever this page had cached, and could append a second trophy for the same
      // season on a re-run.
      const champDoc = await LG.db.getFresh("team_" + next.champion);
      if (champDoc || LG.teamById(next.champion)) {
        const have = (champDoc && champDoc.trophies) || [];
        const trophies = have.some((t) => t.year === LG.SEASON && t.kind === "champion")
          ? have : [...have, { year: LG.SEASON, kind: "champion" }];
        await LG.saveTeam({ teamId: next.champion, trophies });
        await LG.loadTeams(); // refresh the in-memory cache so the trophy shows immediately (same posture as processWaivers' FAAB refresh)
      }
    }
    return { ok: true, ...next };
  };

  // ---------------- history + record book + rivalries (S6, plan §4.8) ----------------
  // Imported ESPN seasons live as one doc per season, kind:"hist" id
  // `hist_<season>`: {season, leagueName, teams:[{id,name,abbrev,owner,w,l,t,
  // pf,pa,place}], champion:{teamId,name}|null, matchups:[{week,home,away,
  // homePts,awayPts}]}. Team identity is the ESPN team id — stable across
  // seasons AND into the live GFFL doc by construction (importFromEspn saves
  // every team under its real ESPN id), so joining history to a CURRENT
  // team is just `LG.teamById(id)`; a franchise that no longer exists here
  // falls back to whatever name that season's own doc recorded for it.
  LG.loadHistory = async function () {
    return (await LG.db.list("hist")).sort((a, b) => a.season - b.season);
  };
  // All-time head-to-head between two CURRENT team ids, from imported
  // history AND this season's own finalized ("weekly") matchups — so a
  // rivalry keeps growing the moment this season's games go official,
  // without waiting for a January re-import. aWins/bWins/aPts/bPts read
  // from teamA's / teamB's perspective (the order they were passed in).
  LG.headToHead = async function (teamA, teamB) {
    const out = { aWins: 0, bWins: 0, ties: 0, aPts: 0, bPts: 0 };
    const tally = (matchups) => {
      for (const m of (matchups || [])) {
        let a = null, b = null;
        if (m.home === teamA && m.away === teamB) { a = m.homePts; b = m.awayPts; }
        else if (m.home === teamB && m.away === teamA) { a = m.awayPts; b = m.homePts; }
        else continue;
        out.aPts += LG.n(a); out.bPts += LG.n(b);
        if (a > b) out.aWins++; else if (b > a) out.bWins++; else out.ties++;
      }
    };
    for (const h of await LG.loadHistory()) tally(h.matchups);
    for (const w of await LG.loadWeeklyDocs()) tally(w.matchups);
    out.aPts = Math.round(out.aPts * 100) / 100;
    out.bPts = Math.round(out.bPts * 100) / 100;
    return out;
  };
  // The record book: every superlative computed purely from imported
  // history + this season's finalized weeklies, combined. hasData is false
  // only when there's genuinely nothing on file yet (fresh league, no
  // import, no finalized week) — the UI's cue to show the empty state
  // instead of a table of zeroes.
  //
  // ⭐ CURRENT FRANCHISES ONLY (user, 2026-08-10). The 2010-15 seasons on file were a
  // 12-to-20-team league, so the history carries ~40 franchises that folded long ago. A
  // record book listing them is a wall of strangers, and one of them owning "biggest
  // blowout" tells nobody in this league anything. `live(id)` is the single gate: a team
  // the league does not currently roster contributes NOTHING — no standings row, no title,
  // no superlative, and no half of a superlative either (a blowout is dropped when EITHER
  // side is gone; the surviving team's own points still count toward highest-week, which
  // is a fact about them alone). Their seasons stay on disk untouched, so re-admitting a
  // franchise — or simply widening this gate — brings its whole record back with it.
  LG.recordBook = async function () {
    const hist = await LG.loadHistory();
    const weekly = await LG.loadWeeklyDocs();
    const live = (id) => !!LG.teamById(id);
    const nameOf = (id) => { const t = LG.teamById(id); return t ? t.name : null; };
    const histNameOf = (h, id) => { const t = (h.teams || []).find((x) => x.id === id); return t ? t.name : ("Team " + id); };
    const displayName = (id, h) => nameOf(id) || (h ? histNameOf(h, id) : ("Team " + id));

    const agg = new Map(); // teamId -> {w,l,t,pf,titles,fallbackName}
    const touch = (id, fallbackName) => {
      if (!agg.has(id)) agg.set(id, { w: 0, l: 0, t: 0, pf: 0, titles: 0, fallbackName: fallbackName || null });
      else if (fallbackName && !agg.get(id).fallbackName) agg.get(id).fallbackName = fallbackName;
      return agg.get(id);
    };

    const champs = [];
    let highestWeek = null, biggestBlowout = null, bestSeasonPF = null;
    const noteScore = (teamId, pts, week, season, fallbackName) => {
      if (!live(teamId)) return;
      if (!highestWeek || pts > highestWeek.pts) {
        highestWeek = { teamId, name: nameOf(teamId) || fallbackName || ("Team " + teamId), pts, week, season };
      }
    };
    const noteBlowout = (home, away, homePts, awayPts, week, season, homeName, awayName) => {
      if (!live(home) || !live(away)) return;
      const margin = Math.round(Math.abs(homePts - awayPts) * 100) / 100;
      if (!biggestBlowout || margin > biggestBlowout.margin) {
        biggestBlowout = { margin, week, season, homeId: home, awayId: away, homeName, awayName, homePts, awayPts };
      }
    };

    for (const h of hist) {
      for (const t of (h.teams || [])) {
        if (!live(t.id)) continue;
        const rec = touch(t.id, t.name);
        rec.w += t.w || 0; rec.l += t.l || 0; rec.t += t.t || 0; rec.pf += t.pf || 0;
        const pf = t.pf || 0;
        if (!bestSeasonPF || pf > bestSeasonPF.pf) bestSeasonPF = { teamId: t.id, name: displayName(t.id, h), pf, season: h.season };
      }
      if (h.champion && live(h.champion.teamId)) {
        champs.push({ season: h.season, teamId: h.champion.teamId, name: displayName(h.champion.teamId, h) });
        const rec = agg.get(h.champion.teamId);
        if (rec) rec.titles++;
      }
      for (const m of (h.matchups || [])) {
        noteScore(m.home, m.homePts, m.week, h.season, histNameOf(h, m.home));
        noteScore(m.away, m.awayPts, m.week, h.season, histNameOf(h, m.away));
        noteBlowout(m.home, m.away, m.homePts, m.awayPts, m.week, h.season, displayName(m.home, h), displayName(m.away, h));
      }
    }
    for (const w of weekly) {
      for (const m of (w.matchups || [])) {
        if (!live(m.home) || !live(m.away)) continue;
        const hRec = touch(m.home, null), aRec = touch(m.away, null);
        hRec.pf += LG.n(m.homePts); aRec.pf += LG.n(m.awayPts);
        if (m.homePts > m.awayPts) { hRec.w++; aRec.l++; }
        else if (m.awayPts > m.homePts) { aRec.w++; hRec.l++; }
        else { hRec.t++; aRec.t++; }
        noteScore(m.home, m.homePts, w.week, LG.SEASON, "Team " + m.home);
        noteScore(m.away, m.awayPts, w.week, LG.SEASON, "Team " + m.away);
        noteBlowout(m.home, m.away, m.homePts, m.awayPts, w.week, LG.SEASON, nameOf(m.home) || ("Team " + m.home), nameOf(m.away) || ("Team " + m.away));
      }
    }
    const standings = [...agg.entries()].map(([id, rec]) => ({
      teamId: id, name: nameOf(id) || rec.fallbackName || ("Team " + id),
      w: rec.w, l: rec.l, t: rec.t, pf: Math.round(rec.pf * 100) / 100, titles: rec.titles,
    })).sort((a, b) => (b.titles - a.titles) || (b.w - a.w) || (b.pf - a.pf));
    champs.sort((a, b) => a.season - b.season);
    // hasData asks what SURVIVED the live() gate, not what is on disk — a league whose whole
    // history belongs to folded franchises must show the empty state, not a table of zeroes.
    return { champs, highestWeek, biggestBlowout, bestSeasonPF, standings, hasData: standings.length > 0 || champs.length > 0 };
  };

  // ---------------- S9 · injury-status-change feed (plan "the news that is actually reachable") ----------------
  // Sleeper's real news feed is licensed content with no free API — not buildable. What IS
  // reachable is the injury designation already carried on the player directory this app
  // already polls for stats (D.S.slpPlayers.get(pid).injury). This keeps a league-wide
  // LAST-KNOWN state of every ROSTERED player's designation, diffs it against the directory's
  // CURRENT answer, and turns a genuine change into one feed line ("K. Walker: Questionable →
  // Out") + one push to the OWNING team. Rostered-only + designation-only (a healthy<->healthy
  // read never writes) keeps it signal, not noise.
  //
  // THE DIRECTORY NOW REFRESHES ON A SLOW CADENCE OF ITS OWN (see D.maybeRefreshInjuryDirectory
  // in lg-data.js, ridden off the same D.pollOnce tick the live-stat poll already runs on) —
  // without that, the directory this reads is fetched exactly ONCE at boot and nothing here
  // would ever observe a change for the life of the tab. checkInjuryChanges itself is cheap
  // regardless of that cadence (it only ever walks the currently-rostered keys, all already in
  // memory, no network of its own beyond the writes a real transition earns) — it is called
  // every poll tick from startData()'s d.onUpdate, exactly like runAutoChecks.
  //
  // THE MAP IS ONE DOCUMENT, BUT EVERY PLAYER IS ITS OWN TOP-LEVEL FIELD (p_<key>), not one
  // nested object under a single "keys" field. LG.db.set's updateMask lists exactly the
  // TOP-LEVEL keys of the payload (see lg-core's REST-transport note at the top of this file) —
  // a nested map field would be replaced WHOLESALE on every write, the exact "array field
  // replaced wholesale" hazard the adversarial review already found and fixed for waiver
  // claims (S1's "ONE DOC PER CLAIM" note). Two devices recording two DIFFERENT players'
  // transitions in the same window would otherwise be able to clobber each other and silently
  // LOSE one, which the plan explicitly rules out ("a lost line is not acceptable" — only a
  // duplicate is). Per-field writes only ever touch the fields actually named, so two different
  // players' transitions can never collide; only the SAME player changing on two devices in the
  // same instant can race at all, and the getFresh guard below makes even that a harmless
  // DUPLICATE at worst, never a loss — the field itself is untouched by whoever loses the race.
  //
  // ABSENT field = "never recorded" — the baseline-seeding case, the same idiom the live
  // poller's own espnSeeded/slpSeeded flags use for "don't feed-line what was already on the
  // board when the tab opened": the FIRST time this league ever sees a player is seeded
  // silently (no feed line, no push). Present-and-different = a real transition. Present-and-
  // same = nothing to do — no write at all, not even a needless refresh.
  LG.injStateId = () => "injstate_" + LG.SEASON;
  LG.injFeedId = () => "injfeed_" + LG.SEASON;
  const INJ_FIELD_PFX = "p_";
  const injField = (key) => INJ_FIELD_PFX + String(key);
  const INJ_FEED_CAP = 40;
  LG.checkInjuryChanges = async function () {
    // A read-only mirror can't persist a thing, and this is a background convenience the next
    // genuinely-connected client will pick up anyway (LG.snapshotProjections' own posture) —
    // never a reason to raise the "you're offline" toast at a reader who only opened the app.
    if (LG.mirrorOffline) return null;
    const d = LG.data;
    const rosters = LG.ui && LG.ui._rosters;
    if (!d || !d.S || !d.S.slpPlayers || !rosters || !LG.teams.length) return null; // not warm yet — next tick

    // Every currently-rostered key, with its owning team and the directory's CURRENT answer.
    const live = new Map(); // key -> {desig, teamId, name}
    for (const t of LG.teams) {
      for (const p of (rosters[t.id] || [])) {
        if (!p || !p.key) continue;
        const pid = d.pidForKey(p.key);
        if (pid == null) continue; // can't resolve to a real Sleeper player -> nothing to compare
        const meta = d.S.slpPlayers.get(pid);
        if (!meta) continue;
        live.set(String(p.key), { desig: LG.injLabel(meta.injury), teamId: t.id, name: p.name || meta.name || String(p.key) });
      }
    }
    if (!live.size) return null;

    const doc = await LG.db.get(LG.injStateId());
    const known = doc && doc.kind === "injstate" ? doc : null;

    // Split into: genuinely new transitions to record, vs never-before-seen keys to seed.
    const changed = [], seed = {};
    for (const [key, info] of live) {
      const field = injField(key);
      const prior = known ? known[field] : undefined;
      if (prior === undefined) { seed[field] = info.desig; continue; }
      if (prior !== info.desig) changed.push({ key, field, from: prior, to: info.desig, teamId: info.teamId, name: info.name });
    }

    // Seeding is race-tolerant on its own — two devices writing the SAME "first sighting"
    // value is a no-op either way — so it needs no fresh-read guard, unlike a real transition.
    if (Object.keys(seed).length) {
      for (const chunk of LG._chunkFields(seed, 30)) {
        if (!Object.keys(chunk).length) continue;
        try { await LG.db.set(LG.injStateId(), { kind: "injstate", season: LG.SEASON, ...chunk }); }
        catch (e) { /* best-effort — the next poll tick tries again */ }
      }
    }
    if (!changed.length) return { seeded: Object.keys(seed).length, changed: 0 };

    // MULTI-DEVICE DEDUPE: re-read right before writing. A field the fresh doc no longer shows
    // at OUR recorded "prior" value means another device already recorded this transition (or a
    // later one) — skip it here. Worst case is a DUPLICATE feed line/push if two devices both
    // read stale and raced to write at the exact same instant; never a LOST one, because a
    // field only this device is touching can't be clobbered by anyone else's write.
    const fresh = await LG.db.getFresh(LG.injStateId());
    const winners = changed.filter((c) => (fresh ? fresh[c.field] : undefined) === c.from);
    if (!winners.length) return { seeded: Object.keys(seed).length, changed: 0 };

    const write = { kind: "injstate", season: LG.SEASON };
    for (const w of winners) write[w.field] = w.to;
    try { await LG.db.set(LG.injStateId(), write); }
    catch (e) { return { seeded: Object.keys(seed).length, changed: 0 }; } // never break the poll loop

    // Feed + push only for what THIS device actually won.
    await LG.appendInjuryFeed(winners);
    for (const w of winners) LG.pushInjuryChange(w);
    return { seeded: Object.keys(seed).length, changed: winners.length, winners };
  };
  // Splits an arbitrary field map into ≤`size`-field chunks — a league's FIRST-EVER seed can
  // carry every one of its ~100+ rostered players at once, and naming all of them as separate
  // updateMask.fieldPaths params in one PATCH risks an unreasonably long request URL. A failed
  // chunk simply retries on the next poll tick; the others still land.
  LG._chunkFields = function (obj, size) {
    const ks = Object.keys(obj || {}), out = [];
    for (let i = 0; i < ks.length; i += size) {
      const chunk = {}; for (const k of ks.slice(i, i + size)) chunk[k] = obj[k];
      out.push(chunk);
    }
    return out.length ? out : [{}];
  };
  // Append is its own fresh-read/merge, capped to the newest 40. LOWER-STAKES than the state
  // map above (this is prose, not the source of truth the badges and the push both depend on) —
  // two devices appending in the exact same instant could still clobber one another's line, an
  // accepted residual given how rare that overlap is in practice; the injstate map itself can
  // never lose an entry (see above), which is the guarantee that actually matters.
  LG.appendInjuryFeed = async function (winners) {
    if (LG.mirrorOffline || !winners || !winners.length) return;
    try {
      const fresh = await LG.db.getFresh(LG.injFeedId());
      const rows = (fresh && fresh.kind === "injfeed" && Array.isArray(fresh.rows)) ? fresh.rows.slice() : [];
      for (const w of winners) {
        // Persisted AND ordered AND read across devices -> Date.now(), never LG.now() (the
        // 2026-08-09 chat-order lesson: a persisted, cross-device-compared stamp must be wall
        // time, or a device on a different replay clock sorts its own entries out of real
        // chronological order on someone else's screen).
        rows.unshift({ t: Date.now(), key: w.key, name: w.name, from: w.from, to: w.to, teamId: w.teamId });
      }
      await LG.db.set(LG.injFeedId(), { kind: "injfeed", season: LG.SEASON, rows: rows.slice(0, INJ_FEED_CAP) });
    } catch (e) { /* the feed is a courtesy — never worth failing the change it's recording */ }
  };
  LG.loadInjuryFeed = async function () {
    const doc = await LG.db.get(LG.injFeedId());
    return (doc && doc.kind === "injfeed" && Array.isArray(doc.rows)) ? doc.rows : [];
  };
  // S4 producer — no actor to exclude (nobody DID this; Sleeper just updated a designation), so
  // this is a plain per-team send. LG.pushTeam's own "never push the device's own claimed team"
  // rule still applies exactly as it does for every other producer.
  LG.pushInjuryChange = function (w) {
    try {
      LG.pushTeam(w.teamId, "Injury update",
        LG.shortName(w.name) + " is now " + LG.injWord(w.to) + ".", LG.pushLink("#league"));
    } catch (e) { /* a producer may never cost the change it is announcing */ }
  };

  // ---------------- THE GROK PROJECTION ADJUSTER (2026-08-13) ----------------
  // User: "go with the grok adjusting from espn projection" — after both sources were MEASURED
  // on the family league's real 2025 season (ESPN and Sleeper both MAE ~5.5-6, everyone
  // squeezed into a 13±4 band against reality's ±8). The shape: ESPN's own league-scored
  // weekly projection is the ANCHOR (lg_espn_projections — kona, already in the reconciled
  // scoring), each player's recent game log + injury designation + depth order + opponent ride
  // along, and Grok 4.5 (mode gffladjust, reasoning low) returns an adjusted number and a
  // ≤10-word reason. The result is ONE doc per week — proj_<season>_w<week> — that D.projFor
  // consults first, so the adjustment flows through every surface that reads a projection
  // (matchup, locker, players table, win probability, the pre-game accuracy snapshot) with no
  // other code knowing it exists.
  //
  // FAIL-OPEN, EVERY PATH: no cookies, a dead endpoint, an unparseable reply, a mirror, the
  // replay — the baseline (Sleeper-scored) projections simply stand, exactly as before. And
  // VALIDATED, not trusted: only keys we actually sent are kept, every number is finite and
  // CLAMPED UPWARD to max(2×base, base+6) — hallucination damage is inflation; a downward move
  // (injury news) is self-limiting at 0 and deliberately unclamped.
  //
  // Scope note, stated rather than hidden: only NUMERIC (espn-id) keys are adjustable — the
  // baseline is keyed by espn id, and a slp_-prefixed key exists precisely because the player
  // HAS no espn id. D/STs and slp_ free agents keep the old path.
  LG.projId = (season, week) => `proj_${season}_w${week}`;
  LG.loadAdjProj = async function (week) {
    const doc = await LG.db.get(LG.projId(LG.SEASON, week));
    return doc && doc.kind === "proj" ? doc : null;
  };
  const ADJ_TTL_MS = 20 * 3600e3;   // regenerate daily-ish, so Wed injury news reaches Thu screens
  const ADJ_RETRY_MS = 10 * 60e3;   // a failed generation is not retried for 10 minutes
  const ADJ_BATCH = 35, ADJ_MAX_PLAYERS = 150;
  let adjInFlight = null, adjFailAt = 0;
  LG.ensureAdjustedProj = async function (opts) {
    if (LG.SIM_2025 || LG.mirrorOffline) return null;
    if (adjInFlight) return adjInFlight;   // single-flight — two views asking = one generation
    adjInFlight = (async () => {
      const week = LG.currentWeek();
      const D = LG.data;
      // Adopt whatever is already on file FIRST — a fresh doc means no model call at all, and
      // even a stale one is better on screen than nothing while the regeneration runs.
      const existing = await LG.loadAdjProj(week);
      if (existing) D.setAdjProj(existing);
      const force = !!(opts && opts.force);
      if (existing && !force && Date.now() - (Number(existing.at) || 0) < ADJ_TTL_MS) return existing;
      if (!force && Date.now() - adjFailAt < ADJ_RETRY_MS) return existing || null;
      try {
        // 1 · the ESPN baseline (league-scored, rostered + free agents in one bounded call)
        const base = await fetch("/.netlify/functions/league", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secret: LG.PASS, action: "lg_espn_projections", week }),
        }).then((r) => r.json()).catch(() => null);
        if (!base || base.ok !== true || !Array.isArray(base.players) || !base.players.length) throw new Error((base && base.reason) || "no-baseline");
        const baseById = new Map(base.players.map((p) => [String(p.espnId), p]));
        // 2 · who to adjust: every rostered numeric key, then top-owned free agents to the cap
        const keys = [];
        const seen = new Set();
        for (const t of (LG.teams || [])) {
          const ros = await LG.ensureRoster(week, t.id).catch(() => null);
          for (const p of (ros || [])) {
            const k = String(p.key);
            if (!/^\d+$/.test(k) || seen.has(k) || !baseById.has(k)) continue;
            seen.add(k); keys.push(k);
          }
        }
        for (const p of base.players) {
          if (keys.length >= ADJ_MAX_PLAYERS) break;
          const k = String(p.espnId);
          if (seen.has(k) || !/^\d+$/.test(k)) continue;
          seen.add(k); keys.push(k);
        }
        if (!keys.length) throw new Error("no-adjustable-keys");
        // 3 · each player's recent log, from the archived weeks already cached by D.weekStats
        const weekly = (await LG.loadWeeklyDocs()).filter((w) => w && w.kind === "weekly").sort((a, b) => (a.week || 0) - (b.week || 0)).slice(-5);
        const maps = await Promise.all(weekly.map((w) => D.weekStats(w.week, { season: LG.SEASON, seasonType: "regular" }).catch(() => null)));
        const logFor = (k) => {
          const out = [];
          weekly.forEach((w, i) => { const m = maps[i]; if (m && m.has(k)) out.push({ w: w.week, pts: m.get(k) }); });
          return out;
        };
        // 4 · context + batches
        const ctx = keys.map((k) => {
          const meta = D.metaForKey(k) || {};
          const pid = D.pidForKey(k);
          const dir = pid != null && D.S.slpPlayers ? D.S.slpPlayers.get(pid) : null;
          const b = baseById.get(k);
          const row = { key: k, name: LG.shortName(meta.name || (b && b.name) || k), pos: meta.pos || "", team: meta.team || "",
            base: Math.round(((b && b.proj) || 0) * 10) / 10, log: logFor(k) };
          const opp = D.oppForWeek(week, meta.team);
          if (opp) row.opp = opp.replace("vs ", "");
          const inj = LG.injLabel ? LG.injLabel((dir && dir.injury) || meta.injury || "") : "";
          if (inj) row.inj = inj;
          if (dir && dir.depth != null) row.depth = dir.depth;
          return row;
        });
        const players = {};
        for (let i = 0; i < ctx.length; i += ADJ_BATCH) {
          const batch = ctx.slice(i, i + ADJ_BATCH);
          const sent = new Map(batch.map((p) => [p.key, p]));
          const r = await fetch("/.netlify/functions/farmgpt", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ secret: LG.PASS, mode: "gffladjust", adjust: { week, players: batch } }),
          });
          if (!r.ok) continue;   // one failed batch costs its own players only
          const text = (await r.text()).trim();
          let arr = null;
          try { arr = JSON.parse(text); } catch (e) { continue; }
          if (!Array.isArray(arr)) continue;
          for (const a of arr) {
            const k = a && String(a.key);
            const src = k && sent.get(k);
            if (!src) continue;                       // a key we never sent — hallucinated, dropped
            let p = Number(a.proj);
            if (!Number.isFinite(p) || p < 0) continue;
            p = Math.min(p, Math.max(src.base * 2, src.base + 6));   // the inflation clamp
            players[k] = { b: src.base, p: Math.round(p * 10) / 10, note: String((a && a.note) || "").slice(0, 90) };
          }
        }
        if (!Object.keys(players).length) throw new Error("no-adjustments");
        const doc = { kind: "proj", season: LG.SEASON, week, at: Date.now(), model: "grok", players };
        await LG.db.set(LG.projId(LG.SEASON, week), doc);
        D.setAdjProj(doc);
        adjFailAt = 0;
        return doc;
      } catch (e) {
        adjFailAt = Date.now();
        return existing || null;
      }
    })();
    try { return await adjInFlight; } finally { adjInFlight = null; }
  };
})();
