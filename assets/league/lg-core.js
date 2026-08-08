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
  // ⭐ WHEN THE FAMILY IS READY FOR THE REAL 2026 SEASON: set SIM_2025_DEFAULT to false — and
  // nothing else. LG.SEASON / LG.SEASON_START / LG.now() all revert together, the replay
  // banner disappears, live polling comes back, and the 2026 docs are visible again.
  const SIM_2025_DEFAULT = true;
  // ?sim=0 / ?sim=1 is a QA + preview override ONLY (same posture as ?fam=): it is never
  // persisted anywhere, so it can't leave a device stuck in the wrong season, and it survives
  // location.reload() the same way ?fam= does. The family never needs it.
  LG.SIM_2025 = qs.get("sim") === "0" ? false : qs.get("sim") === "1" ? true : SIM_2025_DEFAULT;
  if (LG.SIM_2025) {
    LG.SEASON = 2025;
    LG.SEASON_START = "2025-09-02"; // the Tuesday before the real Sept-4 2025 opener
  }
  // The pinned instant: Thursday 2025-09-04, 9:00 AM America/Chicago. Deliberately chosen so
  // BOTH of these are true at once (asserted in the suite, not eyeballed):
  //   · LG.currentWeek() === 1 — it sits inside week 1's own Tue(05:00)->next-Tue window, and
  //     the night's opener has NOT kicked off yet, so every NFL game reads as upcoming.
  //   · week 1's waiver deadline (default Wed 8:00 AM) has already PASSED, so free agency is
  //     OPEN — LG.faAdd is exercisable with zero extra clicks the moment the app loads.
  // A fixed constant, not a stored one: no localStorage flag, no per-device state, so every
  // family device is looking at the exact same moment of the exact same week.
  LG.SIM_NOW = new Date("2025-09-04T09:00:00-05:00").getTime();

  // ---------------- identity ----------------
  // One key each, no per-mode namespacing (the old per-sandbox key suffixing died with the
  // sandbox — the 2025 replay uses the family's OWN 8 teams, so a claim genuinely carries across).
  const teamKey = () => "gffl_team";
  const whoKey = () => "gffl_who";
  LG.who = () => localStorage.getItem(whoKey()) || localStorage.getItem("choreUser") || "";
  LG.setWho = (n) => localStorage.setItem(whoKey(), n);
  LG.myTeamId = () => { const v = parseInt(localStorage.getItem(teamKey()) || "", 10); return v >= 1 ? v : null; };
  LG.setMyTeamId = (id) => localStorage.setItem(teamKey(), String(id));

  LG.unlocked = () => localStorage.getItem("choreUnlocked") === LG.PASS || localStorage.getItem("gffl_pass") === LG.PASS;
  LG.tryUnlock = (phrase) => {
    if ((phrase || "").trim().toLowerCase() === LG.PASS) { localStorage.setItem("gffl_pass", LG.PASS); return true; }
    return false;
  };

  // Commissioner = Dad's PIN, same hash scheme index.html/farmgpt.html sync
  // (sha256(pin + ":" + PASS) in localStorage dadPinHash). Create-on-first-use
  // mirrors index.html's gateDad. Session unlock flag scoped to this page.
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  LG.commishUnlocked = () => sessionStorage.getItem("gfflCommish") === "1";
  LG.gateCommish = async function () {
    if (LG.commishUnlocked()) return true;
    const have = localStorage.getItem("dadPinHash") || "";
    const pin = window.prompt(have ? "Commissioner PIN:" : "Set a commissioner PIN (first time):");
    if (!pin) return false;
    const h = await sha256Hex(pin + ":" + LG.PASS);
    if (!have) { localStorage.setItem("dadPinHash", h); sessionStorage.setItem("gfflCommish", "1"); return true; }
    if (h === have) { sessionStorage.setItem("gfflCommish", "1"); return true; }
    window.alert("Wrong PIN.");
    return false;
  };

  // ---------------- backend (Firestore, localStorage fallback) ----------------
  // One collection (LG.COLL); every doc carries {kind} so lists are queries.
  // Cloud unreachable (or blocked, as in every suite) -> local mode, same API.
  const local = {
    key: (id) => "lg_" + LG.COLL + "_" + id,
    async get(id) { const s = localStorage.getItem(this.key(id)); return s ? JSON.parse(s) : null; },
    async set(id, data) {
      const cur = (await this.get(id)) || {};
      localStorage.setItem(this.key(id), JSON.stringify({ ...cur, ...data }));
    },
    async del(id) { localStorage.removeItem(this.key(id)); },
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
    watch(id, cb) { // local mode: poll — good enough for tests + offline
      let last = localStorage.getItem(this.key(id));
      cb(last ? JSON.parse(last) : null);
      const t = setInterval(() => {
        const cur = localStorage.getItem(this.key(id));
        if (cur !== last) { last = cur; cb(cur ? JSON.parse(cur) : null); }
      }, 1200);
      return () => clearInterval(t);
    },
  };

  let cloud = null;
  LG.backendMode = "local";
  // ---------------- SERVER-CONFIRMED EMPTINESS (live bug, 2026-08-08) ----------------
  // The live site showed the first-run "Import the league from ESPN" card against a Firestore
  // collection that demonstrably HAS 8 teams. Root cause: NOTHING in this file distinguished
  // "the league really is empty" from "we never actually heard back from the league store".
  // Two ways to land on a silent, unexplained empty read, both of which end in
  // `LG.teams.length === 0` and therefore in the first-run card:
  //   1. the Firebase ESM import / initializeFirestore / the reachability probe throws (a
  //      blocked gstatic, an ad-blocker, an offline first paint, a cold IndexedDB failure) —
  //      the catch below silently drops to the LOCAL backend, and localStorage on a cold
  //      device holds no league docs at all;
  //   2. cloud mode, but Firestore served the QUERY from an empty offline cache. getDocs()
  //      with the default source tries the server and FALLS BACK TO THE CACHE — and unlike
  //      getDoc(), a query never rejects for a cache miss: a cold cache legitimately looks
  //      exactly like "a query with zero results" (snap.empty === true, metadata.fromCache
  //      === true). So even a working cloud path could report an empty league.
  // This is the same lesson index.html learned twice with the goat herd (see CLAUDE.md's
  // `serverConfirmed` rule): EMPTINESS MUST BE SERVER-CONFIRMED before any destructive or
  // "let's set it up from scratch" UI is offered. LG.backendDegraded is that signal — true
  // whenever this session is NOT provably reading the real league store — and lg-ui.js shows
  // an honest "couldn't reach the league" card with a Retry instead of the first-run card
  // whenever an empty read is unconfirmed.
  LG.backendDegraded = true;   // until a real backend read proves otherwise
  LG.backendError = "";        // the reason, verbatim, shown on that card so the next report identifies itself
  LG.dataConfirmed = () => !LG.backendDegraded;
  function markDegraded(e) {
    LG.backendDegraded = true;
    LG.backendError = String((e && e.message) || e || "unknown");
  }
  // A read that provably reached the SERVER (not the offline cache) clears the flag — a single
  // blip must not leave a session marked unconfirmed for the rest of its life.
  function markHealthy() { LG.backendDegraded = false; LG.backendError = ""; }
  LG._markDegraded = markDegraded; // test hook
  async function initCloud() {
    const appMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const fs = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const app = appMod.initializeApp({
      apiKey: "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU",
      authDomain: "amen-farms-app.firebaseapp.com",
      projectId: "amen-farms-app",
      storageBucket: "amen-farms-app.firebasestorage.app",
      messagingSenderId: "321230755979",
      appId: "1:321230755979:web:d362c56aaf7e50b4ab5c8e",
    }, "gffl");
    let db;
    try {
      db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (e) { db = fs.getFirestore(app); }
    cloud = {
      async get(id) {
        const ref = fs.doc(db, LG.COLL, id);
        let snap = await fs.getDoc(ref);
        // An "it isn't there" answer served from an EMPTY offline cache is not an answer.
        // Confirm it against the server before anyone treats it as absence (see the header
        // note above); if the server can't be reached, say so rather than reporting absence.
        if (!snap.exists() && snap.metadata && snap.metadata.fromCache && fs.getDocFromServer) {
          try { snap = await fs.getDocFromServer(ref); markHealthy(); } catch (e) { markDegraded(e); }
        }
        return snap.exists() ? snap.data() : null;
      },
      async set(id, data) { await fs.setDoc(fs.doc(db, LG.COLL, id), data, { merge: true }); },
      async del(id) { await fs.deleteDoc(fs.doc(db, LG.COLL, id)); },
      async list(kind) {
        const q = kind
          ? fs.query(fs.collection(db, LG.COLL), fs.where("kind", "==", kind))
          : fs.collection(db, LG.COLL);
        let snap = await fs.getDocs(q);
        // THE bug from the header note: an EMPTY query result that came out of the cache is
        // indistinguishable from a real empty league. Re-ask the server once; if that fails we
        // are genuinely offline, so mark the session degraded rather than reporting "empty".
        if (snap.empty && snap.metadata && snap.metadata.fromCache && fs.getDocsFromServer) {
          try { snap = await fs.getDocsFromServer(q); markHealthy(); } catch (e) { markDegraded(e); }
        }
        const out = []; snap.forEach((d) => out.push({ ...d.data(), id: d.id })); // id LAST — see local.list()'s note
        return out;
      },
      watch(id, cb) {
        return fs.onSnapshot(fs.doc(db, LG.COLL, id), { includeMetadataChanges: true },
          (snap) => cb(snap.exists() ? snap.data() : null));
      },
    };
    // Prove reachability with one read before claiming cloud mode. getDoc REJECTS (rather
    // than answering from an empty cache) when the client is offline with nothing cached, so
    // this really is a reachability probe — but only for the doc path; the query path needs
    // its own guard, above.
    await cloud.get("settings");
    LG.backendMode = "cloud";
    LG.backendDegraded = false;
    LG.backendError = "";
  }
  LG.backendReady = (async () => {
    try { await initCloud(); }
    catch (e) {
      // A test harness may have swapped a working fake cloud in underneath us while the real
      // Firebase import was failing (_installFakeCloud — gstatic is blocked in every suite
      // page). Only a genuinely un-swapped session drops to local: initCloud() leaves
      // backendMode at "local" on every one of its own failure paths, so "already cloud" can
      // only mean somebody else installed a reachable backend.
      if (LG.backendMode === "cloud") return;
      LG.backendMode = "local"; markDegraded(e);
    }
  })();
  // The Retry the "couldn't reach the league" card offers. Re-runs the whole cloud init (the
  // failure may have been the ESM import itself, so retrying only the probe wouldn't help) and
  // drops every cached read on success — a cache filled while degraded is a cache of answers
  // nobody could confirm.
  LG.retryBackend = async function () {
    try {
      // If the cloud object was built and only the NETWORK was down, re-probing it is the whole
      // retry — re-importing the ESM modules would be wasted work. Only a session that never
      // got that far (a blocked/failed import) needs the full init.
      if (cloud) { await cloud.get("settings"); LG.backendMode = "cloud"; markHealthy(); }
      else await initCloud();
      LG.db.clearCache();
      return true;
    } catch (e) {
      try { await initCloud(); LG.db.clearCache(); return true; } // the probe failed — maybe the whole handle is stale
      catch (e2) { LG.backendMode = "local"; markDegraded(e2 || e); return false; }
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
  const CACHE_STALE_MS = 15000; // cloud-only: how old a cached list()/doc may be before a quiet background refresh
  function backend() { return LG.backendMode === "cloud" ? cloud : local; }
  // Every doc-id in this app is `<kind>_<...>` (or the bare "settings"), so a doc's kind is
  // inferable from its id — which is what lets a cached list() answer "does this exist?"
  // without a network read AND without ever caching a null.
  const ID_KIND = {
    team: "team", roster: "roster", weekly: "weekly", claims: "claims", claim: "claim",
    trade: "trade", tx: "tx", hist: "hist", bracket: "bracket", sched: "sched",
    projsnap: "projsnap", settings: "settings",
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
    if (doc) { docCache.set(id, doc); docAt.set(id, { at: LG.now(), refreshing: false }); }
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
  LG.db = {
    stats: { gets: 0, lists: 0, sets: 0, dels: 0, fresh: 0, missGets: 0 }, // real (non-cache) backend calls — perf test hook
    onChange: null, // (kind) => void — lg-ui registers this to quietly repaint after a background refresh finds new data
    async get(id) {
      if (docCache.has(id)) {
        // Same quiet background refresh list() has had all along — a positive doc read once
        // at boot must not stay frozen for the life of the tab either (finding 4).
        const meta = docAt.get(id);
        if (LG.backendMode === "cloud" && meta && !meta.refreshing && LG.now() - meta.at > CACHE_STALE_MS) {
          meta.refreshing = true;
          LG.db.stats.gets++;
          backend().get(id).then((fresh) => {
            meta.refreshing = false; meta.at = LG.now();
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
      if (v) { docCache.set(id, v); docAt.set(id, { at: LG.now(), refreshing: false }); }
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
    // Bypasses the list cache — every "did someone else already do this?" guard and every
    // read-modify-write MUST see the real current backend state, not this page's snapshot.
    async listFresh(kind) {
      LG.db.stats.fresh++;
      const docs = await backend().list(kind);
      const key = kind || "";
      listCache.set(key, { docs, at: LG.now(), refreshing: false });
      for (const d of docs) { docCache.set(d.id, d); docAt.set(d.id, { at: LG.now(), refreshing: false }); }
      return docs;
    },
    async set(id, data) {
      LG.db.stats.sets++;
      const cur = docCache.get(id) || {};
      cacheUpsert(id, { ...cur, ...data }); // optimistic — instantly visible to this page's own next read
      await backend().set(id, data);
    },
    async del(id) {
      LG.db.stats.dels++;
      cacheUpsert(id, null);
      await backend().del(id);
    },
    async list(kind) {
      if (kind === "chat") { LG.db.stats.lists++; return backend().list(kind); } // see the note above
      const key = kind || "";
      const entry = listCache.get(key);
      if (entry) {
        if (LG.backendMode === "cloud" && !entry.refreshing && LG.now() - entry.at > CACHE_STALE_MS) {
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
            entry.docs = fresh; entry.at = LG.now();
            for (const d of fresh) { docCache.set(d.id, d); docAt.set(d.id, { at: LG.now(), refreshing: false }); }
            if (changed && LG.db.onChange) LG.db.onChange(kind);
          }).catch(() => { entry.refreshing = false; });
        }
        return entry.docs;
      }
      LG.db.stats.lists++;
      const docs = await backend().list(kind);
      listCache.set(key, { docs, at: LG.now(), refreshing: false });
      for (const d of docs) { docCache.set(d.id, d); docAt.set(d.id, { at: LG.now(), refreshing: false }); }
      return docs;
    },
    watch: (id, cb) => backend().watch(id, cb),
    // Test-only: swaps the underlying "cloud" implementation + forces cloud mode, so the perf
    // suite can exercise the background-refresh/quiet-repaint path without a real Firestore.
    // Never called by production code.
    // A fake cloud IS a reachable backend — clear the degraded flag with it, or every test
    // that installs one would look like an offline session.
    _installFakeCloud(impl) { cloud = impl; LG.backendMode = "cloud"; LG.backendDegraded = false; LG.backendError = ""; docCache.clear(); docAt.clear(); listCache.clear(); },
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
    scoring: {
      pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
      rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
      rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2,
      fum_lost: -2,
      fg_0_39: 3, fg_40_49: 4, fg_50: 5, fg_miss: -1, xp_made: 1, xp_miss: -1,
      bonus_pass_300: 0, bonus_pass_400: 0, bonus_rush_100: 0, bonus_rush_200: 0,
      bonus_rec_100: 0, bonus_rec_200: 0, off_fum_td: 0, fg_made_yd: 0, dst_2pt_ret: 0, one_pt_safety: 0,
      dst_sack: 1, dst_int: 2, dst_fum_rec: 2, dst_td: 6, dst_safety: 2, dst_blk: 2,
      dst_pa_0: 5, dst_pa_1_6: 4, dst_pa_7_13: 3, dst_pa_14_17: 1,
      dst_pa_18_27: 0, dst_pa_28_34: -1, dst_pa_35_45: -3, dst_pa_46: -5,
    },
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1, BENCH: 7, IR: 3 },
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
    // Event post (plan §4.5) — the transparency rule from §4.2 lands in chat
    // too, never just the change log. Must never break a rules save.
    try {
      if (changes.length) {
        const preview = changes.slice(0, 4).join("; ") + (changes.length > 4 ? "…" : "");
        await LG.postSys(`${who || LG.who() || "The commissioner"} updated the rules (${changes.length}): ${preview}`);
      }
    } catch (e) { /* chat is never load-bearing */ }
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
  LG.saveTeam = async function (t) {
    const { id: _stray, ...rest } = t || {};
    const docId = "team_" + rest.teamId;
    let cur = null;
    try { cur = await LG.db.getFresh(docId); } catch (e) { /* offline: fall through to a plain write */ }
    const { id: _stray2, ...curClean } = cur || {};
    return LG.db.set(docId, { ...curClean, kind: "team", ...rest });
  };
  LG.teamById = (id) => LG.teams.find((t) => t.id === Number(id)) || null;

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
  LG.loadStandings = async function () {
    const sw = (LG.rules || LG.DEFAULT_RULES).seasonWeeks;
    const weekly = (await LG.db.list("weekly")).filter((wd) => (wd.week || 0) <= sw);
    const st = {};
    for (const t of LG.teams) st[t.id] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
    for (const wd of weekly) {
      for (const m of (wd.matchups || [])) {
        const [h, a] = [m.home, m.away];
        if (!st[h] || !st[a]) continue;
        st[h].pf += m.homePts; st[h].pa += m.awayPts;
        st[a].pf += m.awayPts; st[a].pa += m.homePts;
        if (m.homePts > m.awayPts) { st[h].w++; st[a].l++; }
        else if (m.awayPts > m.homePts) { st[a].w++; st[h].l++; }
        else { st[h].t++; st[a].t++; }
      }
    }
    return st;
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
  // generateSchedule's in-memory shape ([week][game] = [homeId, awayId]) is an array
  // DIRECTLY containing arrays two levels deep — weeks[i] is itself an array of [h,a]
  // pairs. Cloud Firestore's document model explicitly forbids an array value containing
  // another array value (verified live against the real project: setDoc throws "Nested
  // arrays are not allowed"), so saving `weeks` raw silently threw inside the #schedGen
  // click handler on the deployed (cloud-backend) site — no toast, no saved schedule, the
  // button just "didn't work." Every suite run stays in LOCAL mode (gstatic/firebase
  // requests are aborted), so localStorage's plain JSON.stringify never caught this.
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
  LG.loadRoster = async function (week, teamId, opts) {
    const id = LG.rosterId(week, teamId);
    const doc = opts && opts.fresh ? await LG.db.getFresh(id) : await LG.db.get(id);
    return doc?.players || null;
  };
  LG.saveRoster = (week, teamId, players) =>
    LG.db.set(LG.rosterId(week, teamId), { kind: "roster", week, teamId, players });
  LG.ensureRoster = async function (week, teamId, opts) {
    let p = await LG.loadRoster(week, teamId, opts);
    if (p) return p;
    for (let w = week - 1; w >= 1 && !p; w--) p = await LG.loadRoster(w, teamId, opts);
    if (p) await LG.saveRoster(week, teamId, p);
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
  LG.irEligible = (injury) => ["IR", "O", "Out", "PUP", "NFI", "SUS", "Doubtful"].includes(String(injury || ""));

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
    const { id: claimId, ...rest } = claim || {};
    await LG.db.set(LG.claimDocId(LG.SEASON, week, claimId), { kind: "claim", season: LG.SEASON, week, claimId, ...rest });
    return { ok: true };
  };
  LG.cancelClaim = async function (week, claimId, byTeamId) {
    const wk = await LG.db.getFresh(LG.claimsId(LG.SEASON, week));
    if (wk && wk.processed) return { ok: false, reason: "already-processed" };
    const id = LG.claimDocId(LG.SEASON, week, claimId);
    const c = await LG.db.getFresh(id);
    if (c && c.teamId === byTeamId) { await LG.db.del(id); return { ok: true }; }
    // Legacy array-shaped week: fall back to rewriting it (single-doc, pre-split data only).
    const legacy = ((wk && wk.claims) || []).find((x) => x.id === claimId);
    if (!legacy || legacy.teamId !== byTeamId) return { ok: false, reason: "not-found" };
    await LG.saveClaims(week, { claims: wk.claims.filter((x) => x.id !== claimId), processed: false, results: null });
    return { ok: true };
  };

  // Free agency (first-come, no bid) once claims have cleared for the week.
  LG.faAdd = async function (week, teamId, addPlayer, dropKey) {
    // FRESH: this both writes a roster and decides "is he already owned?" — a cached roster
    // makes it possible to add a player another team just won (finding 4).
    const ros = await LG.ensureRoster(week, teamId, { fresh: true });
    for (const t of LG.teams) {
      const r = t.id === teamId ? ros : await LG.ensureRoster(week, t.id, { fresh: true });
      if (r.some((p) => p.key === addPlayer.key)) return { ok: false, reason: "player-taken" };
    }
    const idx = ros.findIndex((p) => p.key === dropKey);
    if (idx < 0) return { ok: false, reason: "drop-not-found" };
    const dropped = ros[idx];
    const next = ros.slice();
    next.splice(idx, 1, { key: addPlayer.key, name: addPlayer.name, pos: addPlayer.pos, team: addPlayer.team, slot: "BENCH" });
    await LG.saveRoster(week, teamId, next);
    await LG.logTx("fa_add", week, teamId, { addKey: addPlayer.key, addName: addPlayer.name });
    await LG.logTx("drop", week, teamId, { dropKey, dropName: dropped ? dropped.name : dropKey });
    return { ok: true };
  };

  // Process one week's blind-bid claims. PURE (given the same claims/rosters/
  // standings it always resolves the same way) and IDEMPOTENT (a processed
  // doc is returned untouched — re-read right before the final write so two
  // clients racing the deadline can't double-run it). Sort by bid desc, tie
  // by worse standings first; a claim wins iff its target isn't already
  // owned/awarded-this-run, its drop is still on the roster, and the bid fits
  // the team's remaining FAAB. Winners: drop out/add in (BENCH), FAAB
  // deducted, one "waiver" tx logged. Losers get a reason, no tx (nothing
  // moved).
  LG.processWaivers = async function (week) {
    // FRESH from the first read: this run permanently settles the week, so it must resolve
    // the claim set that actually EXISTS, not the one this page happened to cache hours ago
    // (finding 2 — the cached read here is what let a stale page process a subset and stamp
    // the week processed with everyone else's bids missing).
    const doc = await LG.loadClaims(week, { fresh: true });
    if (doc.processed) return doc;
    await LG.loadTeams();
    const claims = doc.claims || [];
    if (!claims.length) {
      const fresh = await LG.loadClaims(week, { fresh: true });
      if (fresh.processed) return fresh;
      const done = { claims: [], processed: true, results: [] };
      await LG.saveClaims(week, done);
      return { kind: "claims", week, ...done };
    }
    const order = await LG.waiverPriorityOrder();
    const rank = new Map(order.map((id, i) => [id, i]));
    const sorted = [...claims].sort((a, b) => (b.bid - a.bid) || ((rank.get(a.teamId) ?? 999) - (rank.get(b.teamId) ?? 999)));

    const rosterMap = new Map();
    for (const t of LG.teams) rosterMap.set(t.id, (await LG.ensureRoster(week, t.id, { fresh: true })).map((p) => ({ ...p })));
    const faabMap = new Map();
    for (const t of LG.teams) faabMap.set(t.id, LG.teamFaab(t));
    const owned = new Set();
    for (const [, ros] of rosterMap) for (const p of ros) owned.add(p.key);
    const wonThisRun = new Set();
    const dirtyTeams = new Set();
    const results = [];
    const txs = [];

    for (const c of sorted) {
      let reason = null;
      if (owned.has(c.addKey)) reason = wonThisRun.has(c.addKey) ? "outbid" : "player-taken";
      if (!reason) {
        const ros = rosterMap.get(c.teamId) || [];
        if (!ros.some((p) => p.key === c.dropKey)) reason = "drop-gone";
        else if (c.bid > (faabMap.get(c.teamId) ?? 0)) reason = "insufficient-faab";
      }
      if (!reason) {
        const ros = rosterMap.get(c.teamId);
        const dropIdx = ros.findIndex((p) => p.key === c.dropKey);
        const dropped = ros[dropIdx];
        ros.splice(dropIdx, 1, { key: c.addKey, name: c.addName, pos: c.addPos, team: c.addTeam, slot: "BENCH" });
        owned.delete(c.dropKey);
        owned.add(c.addKey);
        wonThisRun.add(c.addKey);
        faabMap.set(c.teamId, (faabMap.get(c.teamId) ?? 0) - c.bid);
        dirtyTeams.add(c.teamId);
        results.push({ id: c.id, teamId: c.teamId, ok: true, reason: "won" });
        txs.push({ teamId: c.teamId, detail: { addKey: c.addKey, addName: c.addName, dropKey: c.dropKey, dropName: dropped ? dropped.name : c.dropKey, bid: c.bid } });
      } else {
        results.push({ id: c.id, teamId: c.teamId, ok: false, reason });
      }
    }

    for (const tid of dirtyTeams) await LG.saveRoster(week, tid, rosterMap.get(tid));
    // DELTA only — spreading the whole in-memory team here wrote this page's (possibly
    // stale) name/logo/trophies back over good data (finding 10's blast radius).
    for (const tid of dirtyTeams) await LG.saveTeam({ teamId: tid, faab: faabMap.get(tid) });
    for (const tx of txs) await LG.logTx("waiver", week, tx.teamId, tx.detail);
    // Event post (plan §4.5) — waiver results in the league timeline.
    try {
      if (txs.length) {
        const nm = (id) => (LG.teamById(id) || {}).name || ("Team " + id);
        const winners = txs.map((tx) => `${nm(tx.teamId)} added ${tx.detail.addName}`).join("; ");
        await LG.postSys(`Waivers processed for week ${week}: ${txs.length} claim(s) won — ${winners}.`);
      }
    } catch (e) { /* chat is never load-bearing */ }

    const fresh = await LG.loadClaims(week, { fresh: true }); // guard: someone else may have processed while we worked
    if (fresh.processed) return fresh;
    const done = { claims, processed: true, results };
    await LG.saveClaims(week, done);
    await LG.loadTeams(); // refresh in-memory FAAB for the caller
    return { kind: "claims", week, ...done };
  };

  // ---------------- trades (plan §4.4) ----------------
  // Offer -> accept (starts a review window) -> auto-executes once the window
  // passes, unless enough OTHER owners veto it first. Player-for-player only;
  // uneven trades (2-for-1) are allowed, no roster-size cap in v1.
  LG.tradeId = (t) => `trade_${t}_${Math.random().toString(36).slice(2, 6)}`;
  // opts.fresh bypasses LG.db's cache — see LG.loadClaims' note; executeTrade's own
  // "someone else already executed/cancelled this" re-check needs the real backend state.
  LG.loadTrade = (id, opts) => (opts && opts.fresh ? LG.db.getFresh(id) : LG.db.get(id));
  LG.saveTrade = (doc) => LG.db.set(doc.id, doc);
  LG.loadTrades = async function () {
    return (await LG.db.list("trade")).sort((a, b) => b.t - a.t);
  };
  LG.tradeDeadlinePassed = () => LG.currentWeek() > ((LG.rules && LG.rules.trades.deadlineWeek) || 99);
  LG.offerTrade = async function (from, to, give, get, note) {
    if (LG.tradeDeadlinePassed()) return { ok: false, reason: "deadline-passed" };
    give = give || []; get = get || [];
    if (!give.length || !get.length || give.length > 3 || get.length > 3) return { ok: false, reason: "invalid-players" };
    const t = LG.now();
    const id = LG.tradeId(t);
    const doc = { kind: "trade", id, from, to, give, get, note: note || "", status: "offered", t, acceptedAt: null, reviewEndsAt: null, vetoes: [] };
    await LG.saveTrade(doc);
    return { ok: true, trade: doc };
  };
  // Every status transition below is a read-modify-write on one shared trade doc, so each
  // reads FRESH (adversarial review 2026-08-08): a cached copy let one device resurrect a
  // status another device had already moved on from.
  LG.cancelTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "offered" || doc.from !== byTeamId) return null;
    const next = { ...doc, status: "cancelled" };
    await LG.saveTrade(next);
    return next;
  };
  LG.declineTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "offered" || doc.to !== byTeamId) return null;
    const next = { ...doc, status: "declined" };
    await LG.saveTrade(next);
    return next;
  };
  LG.acceptTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true });
    if (!doc || doc.status !== "offered" || doc.to !== byTeamId) return null;
    const now = LG.now();
    const reviewMs = ((LG.rules && LG.rules.trades.reviewHours) || 24) * 3600e3;
    const next = { ...doc, status: "accepted", acceptedAt: now, reviewEndsAt: now + reviewMs };
    await LG.saveTrade(next);
    return next;
  };
  // Any owner NOT a party to the trade may add one veto vote; enough votes
  // (rules.trades.vetoVotes, default 4) kills it before it ever executes.
  LG.vetoTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id, { fresh: true }); // vetoes accumulate in an array — a stale read drops other owners' votes
    if (!doc || doc.status !== "accepted") return doc;
    if (byTeamId === doc.from || byTeamId === doc.to) return doc;
    if ((doc.vetoes || []).includes(byTeamId)) return doc;
    const vetoes = [...(doc.vetoes || []), byTeamId];
    const needed = (LG.rules && LG.rules.trades.vetoVotes) || 4;
    const status = vetoes.length >= needed ? "vetoed" : "accepted";
    const next = { ...doc, vetoes, status };
    await LG.saveTrade(next);
    if (status === "vetoed") {
      await LG.logTx("trade", LG.currentWeek(), doc.from, { tradeId: id, from: doc.from, to: doc.to, give: doc.give, get: doc.get, result: "vetoed" });
      // Event post (plan §4.5).
      try {
        const nm = (tid) => (LG.teamById(tid) || {}).name || ("Team " + tid);
        await LG.postSys(`Trade between ${nm(doc.from)} and ${nm(doc.to)} was vetoed by the league.`);
      } catch (e) { /* chat is never load-bearing */ }
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
    if (LG.now() < (doc.reviewEndsAt ?? Infinity)) return doc;
    const fresh = await LG.loadTrade(id, { fresh: true });
    if (!fresh || fresh.status !== "accepted") return fresh;
    const week = LG.currentWeek();
    // FRESH: executeTrade's own "roster-changed -> cancel" fail-safe exists precisely to
    // catch a player who has moved since the offer — reading it through the cache made that
    // guard read the stale data it was written to detect (finding 4).
    const fromRoster = await LG.ensureRoster(week, fresh.from, { fresh: true });
    const toRoster = await LG.ensureRoster(week, fresh.to, { fresh: true });
    const giveOk = fresh.give.every((k) => fromRoster.some((p) => p.key === k));
    const getOk = fresh.get.every((k) => toRoster.some((p) => p.key === k));
    if (!giveOk || !getOk) {
      const failed = { ...fresh, status: "cancelled", cancelReason: "roster-changed" };
      await LG.saveTrade(failed);
      return failed;
    }
    const movedFrom = fresh.give.map((k) => fromRoster.find((p) => p.key === k));
    const movedTo = fresh.get.map((k) => toRoster.find((p) => p.key === k));
    const newFromRoster = fromRoster.filter((p) => !fresh.give.includes(p.key)).concat(movedTo.map((p) => ({ ...p, slot: "BENCH" })));
    const newToRoster = toRoster.filter((p) => !fresh.get.includes(p.key)).concat(movedFrom.map((p) => ({ ...p, slot: "BENCH" })));
    await LG.saveRoster(week, fresh.from, newFromRoster);
    await LG.saveRoster(week, fresh.to, newToRoster);
    const executed = { ...fresh, status: "executed" };
    await LG.saveTrade(executed);
    await LG.logTx("trade", week, fresh.from, {
      tradeId: id, from: fresh.from, to: fresh.to, give: fresh.give, get: fresh.get,
      giveNames: movedFrom.map((p) => (p ? p.name : "?")), getNames: movedTo.map((p) => (p ? p.name : "?")), result: "executed",
    });
    // Event post (plan §4.5) — same names the transactions log shows.
    try {
      const nm = (tid) => (LG.teamById(tid) || {}).name || ("Team " + tid);
      await LG.postSys(`Trade: ${nm(fresh.from)} sent ${movedFrom.map((p) => (p ? p.name : "?")).join(", ")} to ${nm(fresh.to)} for ${movedTo.map((p) => (p ? p.name : "?")).join(", ")}.`);
    } catch (e) { /* chat is never load-bearing */ }
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
    const t = LG.now();
    const doc = {
      kind: "chat", t, who: LG.who() || "?", teamId: LG.myTeamId(),
      thread: opts.thread || null, reactions: {},
    };
    if (text) doc.text = text;
    if (opts.img) doc.img = opts.img;
    if (opts.gif && opts.gif.url) doc.gif = { url: opts.gif.url, preview: opts.gif.preview || opts.gif.url };
    if (opts.replyTo) doc.replyTo = opts.replyTo;
    await LG.db.set(LG.chatId(t), doc);
    return { ok: true, msg: doc };
  };
  // Every mode-"story"-style event post below routes through here. Wrapped so
  // a chat outage can NEVER break the flow it's narrating (waivers/trades/
  // rules still complete even if this throws) — callers additionally wrap
  // their own call in try/catch as a second layer, this is the first.
  LG.postSys = async function (text) {
    try {
      const t = LG.now();
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
  LG.recentChatImages = async function (limit) {
    const all = await LG.loadAllChat();
    const seen = new Set(), out = [];
    for (const m of all) {
      if (!m.img || seen.has(m.img)) continue;
      seen.add(m.img); out.push(m.img);
      if (out.length >= (limit || 12)) break;
    }
    return out;
  };
  LG.toggleReaction = async function (id, emoji, teamId) {
    const doc = await LG.db.getFresh(id); // read-modify-write on a shared reactions map — must see other devices' taps
    if (!doc || doc.kind !== "chat") return null;
    const cur = new Set((doc.reactions && doc.reactions[emoji]) || []);
    if (cur.has(teamId)) cur.delete(teamId); else cur.add(teamId);
    const next = { ...doc, reactions: { ...(doc.reactions || {}), [emoji]: [...cur] } };
    await LG.db.set(id, next);
    return next;
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
  LG.nowOverride = null; // test hook — always wins, the 2025 replay's own pin included
  // Under the 2025 replay the clock is PINNED (LG.SIM_NOW, see the flag block at the top of
  // this file) — a fixed constant, identical on every device, so "week 1, before kickoff" is a
  // property of the app rather than of when you happened to open it. Off the replay this is
  // the real wall clock, exactly as it always was.
  LG.now = () => LG.nowOverride != null ? LG.nowOverride : (LG.SIM_2025 ? LG.SIM_NOW : Date.now());
  LG.currentWeek = function () {
    const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
    const w = 1 + Math.floor((LG.now() - start) / (7 * 24 * 3600 * 1000));
    return Math.max(1, Math.min(18, w));
  };
  // Waiver processing deadline for a given week, from rules.waivers.processDow
  // /processHour (default Wed/8am — plan §4.3). SEASON_START anchors week N's
  // Tuesday at the same "05:00 in a fixed -05:00 frame" clock reading
  // currentWeek() uses; walk forward to the configured weekday+hour from there
  // (Tuesday=dow 2, so the default Wed/8am is +1 day +3h).
  LG.waiverDeadline = function (week) {
    const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
    const wkStart = start + (week - 1) * 7 * 24 * 3600 * 1000; // that week's Tuesday, clock=05:00
    const TUESDAY = 2;
    const w = (LG.rules || LG.DEFAULT_RULES).waivers;
    const dowOffsetDays = ((w.processDow ?? 3) - TUESDAY + 7) % 7;
    const hourOffset = (w.processHour ?? 8) - 5; // wkStart's own clock reads 05:00
    return wkStart + dowOffsetDays * 24 * 3600 * 1000 + hourOffset * 3600 * 1000;
  };
  LG.fmtPts = (n) => (n == null ? "—" : (Math.round(n * 100) / 100).toFixed(1));

  // ---------------- weekly finalization + projections + power rankings + awards (S5) ----------------
  // The server-side truth of a completed week (plan §3/§4.6/§4.9/§5): once every one of THAT
  // WEEK's starters' NFL games reads "post" (final), LG.finalizeWeek computes the official
  // matchup totals from the SAME live engine rows the matchup page already shows (LG.data,
  // loaded by lg-data.js before this is ever called), writes them as a write-once doc, and
  // everything downstream (standings, power rankings, the accuracy scoreboard) is re-derived
  // from that doc forever — no single mutable doc whose loss loses the season (plan §8).
  LG.weeklyId = (season, week) => `weekly_${season}_w${week}`;
  LG.loadWeekly = (week) => LG.db.get(LG.weeklyId(LG.SEASON, week));
  LG.projSnapId = (season, week) => `projsnap_${season}_w${week}`;
  LG.loadProjSnap = (week) => LG.db.get(LG.projSnapId(LG.SEASON, week));

  async function fzStarters(week, teamId) {
    const ros = await LG.ensureRoster(week, teamId);
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
    return row && row.pts != null ? row.pts : 0;
  }
  // The engine's own authoritative week, or null when unknown / the providers disagree.
  function fzEngineWeek() {
    const d = LG.data;
    return d && d.engineWeek ? d.engineWeek() : null;
  }
  function fzGameState(team) {
    const d = LG.data;
    if (!d || !d.S || !d.slpTeam) return null;
    const g = d.S.games.get(d.slpTeam(team));
    return g ? g.state : null;
  }
  async function fzTeamTotal(week, teamId, ptsOf) {
    const pts = ptsOf || fzPts;
    let total = 0;
    for (const p of await fzStarters(week, teamId)) total += pts(p.key);
    return Math.round(total * 100) / 100;
  }
  // The optimal LEGAL lineup's total — what LG.slotEligible would have allowed, at maximum —
  // used only by the Bench Blunder award. Fill every dedicated position slot with its own top
  // scorers first (dedicated slots never compete with each other, so that's always at least as
  // good as any alternative), then FLEX with the single best REMAINING RB/WR/TE: provably
  // optimal for this "one shared slot" roster shape (an exchange argument — swapping a worse
  // player into a dedicated slot to "free up" a better one for FLEX can never help, since the
  // vacated dedicated slot can only be re-filled by another player of that same position).
  async function fzOptimalTotal(week, teamId, ptsOf) {
    const fz = ptsOf || fzPts;
    const ros = (await LG.ensureRoster(week, teamId)).filter((p) => p.slot !== "IR");
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
    const doc = { kind: "projsnap", week, players: rows, at: LG.now() };
    const fresh = await LG.db.getFresh(id); // idempotency race guard — bypasses LG.db's cache
    if (fresh && fresh.kind === "projsnap") return fresh;
    await LG.db.set(id, doc);
    return doc;
  };

  // Bust of the Week (min proj 8 — plan §5) + Top Score + Bench Blunder, computed against
  // THIS week's just-settled matchups.
  async function fzAwards(week, matchups, ptsOf, projOf) {
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
      for (const p of await fzStarters(week, tid)) {
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
      const optimal = await fzOptimalTotal(week, tid, fz);
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
    const weekly = (await LG.db.list("weekly")).filter((w) => !throughWeek || (w.week || 0) <= throughWeek);
    const all = extraWeeklyDocs && extraWeeklyDocs.length ? [...weekly, ...extraWeeklyDocs] : weekly;
    const st = {};
    for (const t of LG.teams) st[t.id] = { w: 0, pf: 0, results: [] };
    for (const wd of [...all].sort((a, b) => (a.week || 0) - (b.week || 0))) {
      for (const m of (wd.matchups || [])) {
        const h = m.home, a = m.away;
        if (!st[h] || !st[a]) continue;
        st[h].pf += m.homePts; st[a].pf += m.awayPts;
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
    const weekly = await LG.db.list("weekly");
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
    if (existing && existing.kind === "weekly") return { ok: true, ...existing };
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
      ptsOf = (key) => (map.has(key) ? map.get(key) : 0);
    } else {
      // Explicit belt-and-suspenders for the 2025 replay: its own poll path never sets
      // D.S.espnWeek/D.S.slpWeek, which already makes fzEngineWeek() return null and the check
      // below refuse naturally — this is a SECOND, independent refusal so the guard holds even
      // if that path ever changes. Nothing has been PLAYED in the replay (it is pinned before
      // kickoff), so a live-path finalize could only ever write a week of zeroes into a
      // write-once doc. The archived-stats backfill above stays available — that's a
      // deliberate commissioner action against real numbers, not a guess off the board.
      if (LG.SIM_2025) return { ok: false, reason: "sim-replay" };
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

    // The archived-stats path is its own proof that the week is over (Sleeper only serves a
    // completed week's box), so the live "is every game post?" gate applies to the live path.
    if (!opts.force && !opts.backfill) {
      const pending = [];
      for (const [h, a] of wkGames) {
        for (const tid of [h, a]) {
          for (const p of await fzStarters(week, tid)) {
            if (fzGameState(p.team) !== "post") pending.push(p.name);
          }
        }
      }
      if (pending.length) return { ok: false, reason: "not-final", pending };
    }

    const pts = ptsOf || fzPts;
    const matchups = [];
    for (const [h, a] of wkGames) {
      matchups.push({ home: h, away: a, homePts: await fzTeamTotal(week, h, pts), awayPts: await fzTeamTotal(week, a, pts) });
    }
    const awards = await fzAwards(week, matchups, pts, opts.backfill ? () => null : null);
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
      accuracy, finalizedAt: LG.now(),
      source: opts.backfill ? "archived" : "live", // provenance, on the record
    };

    const fresh = await LG.db.getFresh(id); // idempotency race guard — bypasses LG.db's cache
    if (fresh && fresh.kind === "weekly") return { ok: true, ...fresh };
    await LG.db.set(id, doc);

    try {
      const lines = matchups.map((m) => `${fzTeamName(m.away)} ${LG.fmtPts(m.awayPts)} — ${LG.fmtPts(m.homePts)} ${fzTeamName(m.home)}`);
      let msg = `Week ${week} is official: ` + lines.join(" · ") + ".";
      if (awards.topScore) msg += ` Top score: ${fzTeamName(awards.topScore.teamId)} (${LG.fmtPts(awards.topScore.pts)}).`;
      if (awards.bust) msg += ` Bust of the week: ${awards.bust.name} (${fzTeamName(awards.bust.teamId)}) — projected ${LG.fmtPts(awards.bust.proj)}, scored ${LG.fmtPts(awards.bust.actual)}.`;
      if (awards.benchBlunder) msg += ` Bench blunder: ${fzTeamName(awards.benchBlunder.teamId)} left ${LG.fmtPts(awards.benchBlunder.diff)} points on the bench.`;
      await LG.postSys(msg);
    } catch (e) { /* chat is never load-bearing */ }

    return { ok: true, ...doc };
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
    try {
      const nm = (tid) => (LG.teamById(tid) || {}).name || ("Team " + tid);
      const byeLine = byeSeeds.length ? `Byes: ${byeSeeds.map(nm).join(", ")}. ` : "";
      const playInLine = playInGames.length
        ? playInGames.map((g) => `#${g.seedHome} ${nm(g.home)} vs #${g.seedAway} ${nm(g.away)}`).join(", ") + "." : "";
      await LG.postSys(`The playoff bracket is set! ${byeLine}Play-in: ${playInLine}`);
    } catch (e) { /* chat is never load-bearing */ }
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
  LG.advanceBracket = async function () {
    const bracket = await LG.loadBracket();
    if (!bracket) return { ok: false, reason: "no-bracket" };
    if (bracket.champion != null) return { ok: true, ...bracket }; // fully resolved already
    const rules = LG.rules || LG.DEFAULT_RULES;
    const sw = rules.seasonWeeks;
    const wk1doc = await LG.loadWeekly(sw + 1);
    const wk2doc = await LG.loadWeekly(sw + 2);
    const wk3doc = await LG.loadWeekly(sw + 3);
    let changed = false;

    const fillFrom = (games, weeklyDoc) => {
      for (const g of games || []) {
        if (g.home == null && g.homeFrom) {
          const src = bkFindGame(bracket, g.homeFrom.game);
          const r = src && src.home != null && src.away != null ? bkResult(weeklyDoc, src.home, src.away) : null;
          if (r) { g.home = r[g.homeFrom.result]; changed = true; }
        }
        if (g.away == null && g.awayFrom) {
          const src = bkFindGame(bracket, g.awayFrom.game);
          const r = src && src.home != null && src.away != null ? bkResult(weeklyDoc, src.home, src.away) : null;
          if (r) { g.away = r[g.awayFrom.result]; changed = true; }
        }
      }
    };
    if (wk1doc) fillFrom(bracket.rounds.r2, wk1doc); // play-in winner -> the waiting semi
    if (wk2doc) fillFrom(bracket.rounds.r3, wk2doc); // semi winners/losers -> champ + 3rd place

    if (bracket.champion == null && wk3doc) {
      const champG = bkFindGame(bracket, "champ");
      if (champG && champG.home != null && champG.away != null) {
        const r = bkResult(wk3doc, champG.home, champG.away);
        if (r) {
          bracket.champion = r.winner;
          changed = true;
          const thirdG = bkFindGame(bracket, "third");
          if (thirdG && thirdG.home != null && thirdG.away != null) {
            const r3 = bkResult(wk3doc, thirdG.home, thirdG.away);
            if (r3) bracket.thirdPlace = r3.winner;
          }
          // Toilet Bowl: aggregate W/L across the 3 consolation round-robin games (one per
          // playoff week); fewest wins loses it, tied by worse regular-season standing (later
          // in bracket.seeds).
          const consGames = [...(bracket.rounds.r1 || []), ...(bracket.rounds.r2 || []), ...(bracket.rounds.r3 || [])]
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
            if (rec[tid].w === rec[toiletId].w && bracket.seeds.indexOf(tid) > bracket.seeds.indexOf(toiletId)) toiletId = tid;
          }
          bracket.toilet = toiletId;

          const nm = (tid) => (LG.teamById(tid) || {}).name || ("Team " + tid);
          // FRESH + DEDUPED + DELTA (adversarial review 2026-08-08, finding 10): this used to
          // spread a possibly-stale in-memory team, rolling that team's FAAB and everything
          // else back to whatever this page had cached, and could append a second trophy for
          // the same season on a re-run.
          const champDoc = await LG.db.getFresh("team_" + bracket.champion);
          if (champDoc || LG.teamById(bracket.champion)) {
            const have = (champDoc && champDoc.trophies) || [];
            const trophies = have.some((t) => t.year === LG.SEASON && t.kind === "champion")
              ? have : [...have, { year: LG.SEASON, kind: "champion" }];
            await LG.saveTeam({ teamId: bracket.champion, trophies });
            await LG.loadTeams(); // refresh the in-memory cache so the trophy shows immediately (same posture as processWaivers' FAAB refresh)
          }
          try {
            await LG.postSys(`${nm(bracket.champion)} are the ${LG.SEASON} GFFL CHAMPIONS!`);
            if (bracket.toilet != null) await LG.postSys(`${nm(bracket.toilet)} finish the season in the Toilet Bowl basement. Wear it proudly.`);
          } catch (e) { /* chat is never load-bearing */ }
        }
      }
    }
    if (changed) await LG.db.set(LG.bracketId(LG.SEASON), bracket);
    return { ok: true, ...bracket };
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
        out.aPts += a; out.bPts += b;
        if (a > b) out.aWins++; else if (b > a) out.bWins++; else out.ties++;
      }
    };
    for (const h of await LG.loadHistory()) tally(h.matchups);
    for (const w of await LG.db.list("weekly")) tally(w.matchups);
    out.aPts = Math.round(out.aPts * 100) / 100;
    out.bPts = Math.round(out.bPts * 100) / 100;
    return out;
  };
  // The record book: every superlative computed purely from imported
  // history + this season's finalized weeklies, combined. hasData is false
  // only when there's genuinely nothing on file yet (fresh league, no
  // import, no finalized week) — the UI's cue to show the empty state
  // instead of a table of zeroes.
  LG.recordBook = async function () {
    const hist = await LG.loadHistory();
    const weekly = await LG.db.list("weekly");
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
      if (!highestWeek || pts > highestWeek.pts) {
        highestWeek = { teamId, name: nameOf(teamId) || fallbackName || ("Team " + teamId), pts, week, season };
      }
    };
    const noteBlowout = (home, away, homePts, awayPts, week, season, homeName, awayName) => {
      const margin = Math.round(Math.abs(homePts - awayPts) * 100) / 100;
      if (!biggestBlowout || margin > biggestBlowout.margin) {
        biggestBlowout = { margin, week, season, homeId: home, awayId: away, homeName, awayName, homePts, awayPts };
      }
    };

    for (const h of hist) {
      for (const t of (h.teams || [])) {
        const rec = touch(t.id, t.name);
        rec.w += t.w || 0; rec.l += t.l || 0; rec.t += t.t || 0; rec.pf += t.pf || 0;
        const pf = t.pf || 0;
        if (!bestSeasonPF || pf > bestSeasonPF.pf) bestSeasonPF = { teamId: t.id, name: displayName(t.id, h), pf, season: h.season };
      }
      if (h.champion) {
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
        const hRec = touch(m.home, null), aRec = touch(m.away, null);
        hRec.pf += m.homePts; aRec.pf += m.awayPts;
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
    return { champs, highestWeek, biggestBlowout, bestSeasonPF, standings, hasData: hist.length > 0 || weekly.length > 0 };
  };
})();
