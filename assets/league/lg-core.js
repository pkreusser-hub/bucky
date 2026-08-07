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

  // ---------------- time ----------------
  LG.nowOverride = null; // test hook
  LG.now = () => LG.nowOverride || Date.now();
  LG.currentWeek = function () {
    const start = new Date(LG.SEASON_START + "T05:00:00-05:00").getTime();
    const w = 1 + Math.floor((LG.now() - start) / (7 * 24 * 3600 * 1000));
    return Math.max(1, Math.min(18, w));
  };
  LG.fmtPts = (n) => (n == null ? "—" : (Math.round(n * 100) / 100).toFixed(1));
})();
