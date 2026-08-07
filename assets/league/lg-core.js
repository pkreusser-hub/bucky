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

  // ---------------- identity ----------------
  LG.who = () => localStorage.getItem("gffl_who") || localStorage.getItem("choreUser") || "";
  LG.setWho = (n) => localStorage.setItem("gffl_who", n);
  LG.myTeamId = () => { const v = parseInt(localStorage.getItem("gffl_team") || "", 10); return v >= 1 ? v : null; };
  LG.setMyTeamId = (id) => localStorage.setItem("gffl_team", String(id));

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
          if (!kind || d.kind === kind) out.push({ id: k.slice(this.key("").length), ...d });
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
  LG.backendReady = (async () => {
    try {
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
          const snap = await fs.getDoc(fs.doc(db, LG.COLL, id));
          return snap.exists() ? snap.data() : null;
        },
        async set(id, data) { await fs.setDoc(fs.doc(db, LG.COLL, id), data, { merge: true }); },
        async del(id) { await fs.deleteDoc(fs.doc(db, LG.COLL, id)); },
        async list(kind) {
          const q = kind
            ? fs.query(fs.collection(db, LG.COLL), fs.where("kind", "==", kind))
            : fs.collection(db, LG.COLL);
          const snap = await fs.getDocs(q);
          const out = []; snap.forEach((d) => out.push({ id: d.id, ...d.data() }));
          return out;
        },
        watch(id, cb) {
          return fs.onSnapshot(fs.doc(db, LG.COLL, id), { includeMetadataChanges: true },
            (snap) => cb(snap.exists() ? snap.data() : null));
        },
      };
      // Prove reachability with one read before claiming cloud mode.
      await cloud.get("settings");
      LG.backendMode = "cloud";
    } catch (e) {
      LG.backendMode = "local";
    }
  })();
  LG.db = {
    get: (id) => (LG.backendMode === "cloud" ? cloud : local).get(id),
    set: (id, data) => (LG.backendMode === "cloud" ? cloud : local).set(id, data),
    del: (id) => (LG.backendMode === "cloud" ? cloud : local).del(id),
    list: (kind) => (LG.backendMode === "cloud" ? cloud : local).list(kind),
    watch: (id, cb) => (LG.backendMode === "cloud" ? cloud : local).watch(id, cb),
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
      bonus_rec_100: 0, bonus_rec_200: 0, off_fum_td: 0,
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
    else { LG.rulesDoc = { kind: "settings", v: 0, rules: LG.DEFAULT_RULES, log: [] }; LG.rules = LG.DEFAULT_RULES; }
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
        await LG.postSys(`📜 ${who || LG.who() || "The commissioner"} updated the rules (${changes.length}): ${preview}`);
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
  LG.loadTeams = async function () {
    LG.teams = (await LG.db.list("team")).map((t) => ({ ...t, id: Number(t.teamId) }))
      .sort((a, b) => a.id - b.id);
    return LG.teams;
  };
  LG.saveTeam = (t) => LG.db.set("team_" + t.teamId, { kind: "team", ...t });
  LG.teamById = (id) => LG.teams.find((t) => t.id === Number(id)) || null;

  // Standings derived from finalized "weekly" docs (there are none yet pre-S2
  // finalization — every team reads 0-0-0 until then). Moved here (was a
  // private helper inside lg-ui's renderLeague) because S3 waiver priority
  // needs the exact same numbers for its tie-break.
  LG.loadStandings = async function () {
    const weekly = await LG.db.list("weekly");
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
  LG.loadSchedule = async () => (await LG.db.get("sched_" + LG.SEASON))?.weeks || null;
  LG.saveSchedule = (weeks) => LG.db.set("sched_" + LG.SEASON, { kind: "sched", season: LG.SEASON, weeks });

  // ---------------- rosters & lineups ----------------
  // One doc per team per week: { players: [{key,name,pos,team,slot}] }. `slot`
  // is a roster slot name (QB/RB/WR/TE/FLEX/DST/K/BENCH/IR). Week N+1 starts
  // as a copy of week N (done lazily by ensureRoster).
  LG.rosterId = (week, teamId) => `roster_${LG.SEASON}_w${week}_t${teamId}`;
  LG.loadRoster = async (week, teamId) => (await LG.db.get(LG.rosterId(week, teamId)))?.players || null;
  LG.saveRoster = (week, teamId, players) =>
    LG.db.set(LG.rosterId(week, teamId), { kind: "roster", week, teamId, players });
  LG.ensureRoster = async function (week, teamId) {
    let p = await LG.loadRoster(week, teamId);
    if (p) return p;
    for (let w = week - 1; w >= 1 && !p; w--) p = await LG.loadRoster(w, teamId);
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
  LG.claimsId = (season, week) => `claims_${season}_w${week}`;
  LG.loadClaims = async function (week) {
    const doc = await LG.db.get(LG.claimsId(LG.SEASON, week));
    return doc || { kind: "claims", week, claims: [], processed: false, results: null };
  };
  LG.saveClaims = (week, doc) => LG.db.set(LG.claimsId(LG.SEASON, week), { kind: "claims", week, ...doc });
  LG.addClaim = async function (week, claim) {
    const doc = await LG.loadClaims(week);
    if (doc.processed) return { ok: false, reason: "already-processed" };
    await LG.saveClaims(week, { claims: [...(doc.claims || []), claim], processed: false, results: null });
    return { ok: true };
  };
  LG.cancelClaim = async function (week, claimId, byTeamId) {
    const doc = await LG.loadClaims(week);
    if (doc.processed) return { ok: false, reason: "already-processed" };
    const c = (doc.claims || []).find((x) => x.id === claimId);
    if (!c || c.teamId !== byTeamId) return { ok: false, reason: "not-found" };
    await LG.saveClaims(week, { claims: doc.claims.filter((x) => x.id !== claimId), processed: false, results: null });
    return { ok: true };
  };

  // Free agency (first-come, no bid) once claims have cleared for the week.
  LG.faAdd = async function (week, teamId, addPlayer, dropKey) {
    const ros = await LG.ensureRoster(week, teamId);
    for (const t of LG.teams) {
      const r = t.id === teamId ? ros : await LG.ensureRoster(week, t.id);
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
    const doc = await LG.loadClaims(week);
    if (doc.processed) return doc;
    await LG.loadTeams();
    const claims = doc.claims || [];
    if (!claims.length) {
      const fresh = await LG.loadClaims(week);
      if (fresh.processed) return fresh;
      const done = { claims: [], processed: true, results: [] };
      await LG.saveClaims(week, done);
      return { kind: "claims", week, ...done };
    }
    const order = await LG.waiverPriorityOrder();
    const rank = new Map(order.map((id, i) => [id, i]));
    const sorted = [...claims].sort((a, b) => (b.bid - a.bid) || ((rank.get(a.teamId) ?? 999) - (rank.get(b.teamId) ?? 999)));

    const rosterMap = new Map();
    for (const t of LG.teams) rosterMap.set(t.id, (await LG.ensureRoster(week, t.id)).map((p) => ({ ...p })));
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
    for (const tid of dirtyTeams) {
      const t = LG.teamById(tid);
      await LG.saveTeam({ ...t, teamId: tid, faab: faabMap.get(tid) });
    }
    for (const tx of txs) await LG.logTx("waiver", week, tx.teamId, tx.detail);
    // Event post (plan §4.5) — waiver results in the league timeline.
    try {
      if (txs.length) {
        const nm = (id) => (LG.teamById(id) || {}).name || ("Team " + id);
        const winners = txs.map((tx) => `${nm(tx.teamId)} added ${tx.detail.addName}`).join("; ");
        await LG.postSys(`🎯 Waivers processed for week ${week}: ${txs.length} claim(s) won — ${winners}.`);
      }
    } catch (e) { /* chat is never load-bearing */ }

    const fresh = await LG.loadClaims(week); // guard: someone else may have processed while we worked
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
  LG.loadTrade = (id) => LG.db.get(id);
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
  LG.cancelTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id);
    if (!doc || doc.status !== "offered" || doc.from !== byTeamId) return null;
    const next = { ...doc, status: "cancelled" };
    await LG.saveTrade(next);
    return next;
  };
  LG.declineTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id);
    if (!doc || doc.status !== "offered" || doc.to !== byTeamId) return null;
    const next = { ...doc, status: "declined" };
    await LG.saveTrade(next);
    return next;
  };
  LG.acceptTrade = async function (id, byTeamId) {
    const doc = await LG.loadTrade(id);
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
    const doc = await LG.loadTrade(id);
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
        await LG.postSys(`🚫 Trade between ${nm(doc.from)} and ${nm(doc.to)} was vetoed by the league.`);
      } catch (e) { /* chat is never load-bearing */ }
    }
    return next;
  };
  // Client-triggered (no scheduled function in v1 — plan §6 deviation): any
  // client open past reviewEndsAt executes it. Re-reads right before writing
  // (idempotency guard, same pattern as processWaivers) and fails SAFE to
  // "cancelled" (never a half-swap) if either side's listed player has moved.
  LG.executeTrade = async function (id) {
    let doc = await LG.loadTrade(id);
    if (!doc || doc.status !== "accepted") return doc;
    if (LG.now() < (doc.reviewEndsAt ?? Infinity)) return doc;
    const fresh = await LG.loadTrade(id);
    if (!fresh || fresh.status !== "accepted") return fresh;
    const week = LG.currentWeek();
    const fromRoster = await LG.ensureRoster(week, fresh.from);
    const toRoster = await LG.ensureRoster(week, fresh.to);
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
      await LG.postSys(`🔁 Trade: ${nm(fresh.from)} sent ${movedFrom.map((p) => (p ? p.name : "?")).join(", ")} to ${nm(fresh.to)} for ${movedTo.map((p) => (p ? p.name : "?")).join(", ")}.`);
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
    const doc = await LG.db.get(id);
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
    const doc = await LG.db.get(id);
    if (!doc || doc.kind !== "chat") return { ok: false, reason: "not-found" };
    if (!allowCommish && doc.teamId !== byTeamId) return { ok: false, reason: "not-yours" };
    await LG.db.del(id);
    return { ok: true };
  };

  // ---------------- time ----------------
  LG.nowOverride = null; // test hook
  LG.now = () => LG.nowOverride || Date.now();
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
})();
