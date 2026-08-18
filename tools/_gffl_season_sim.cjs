// _gffl_season_sim.cjs — SIM-A of the GFFL season-readiness program: "The Season in a Day".
//
//   node tools/_gffl_season_sim.cjs [--weeks N] [--seed S] [--fast] [--report]
//
// WHY THIS EXISTS, and how it differs from tools/_verify-gffl.cjs.
// The 2200-check suite is fixture-driven and PER FEATURE: each section stands a world up,
// drives one flow, asserts, tears down. That shape provably cannot see three bug classes:
//   (a) UI-FLOW LIFECYCLE bugs — the FAAB bid input read AFTER the modal close had emptied it,
//       so every claim would have bid $0. Nothing was wrong with addClaim, processWaivers, or
//       the claim doc; the defect lived in the ORDER two correct things happened in.
//   (b) bugs that need WEEKS of accumulated state — a stale cache, a doc that only goes wrong
//       on its fourth rewrite, a ledger that drifts a dollar a week.
//   (c) MULTI-DEVICE races — two phones, one league, one shared store.
// So this is not more checks. It is one 17-week season played through the REAL UI by eight
// owner personas on four concurrent devices, with an INVARIANT ENGINE that re-states what must
// be true after EVERY phase. A season that ends with the invariants intact is evidence; a
// season that trips one prints the week, the phase, the persona and the action log that got
// there.
//
// ---------------------------------------------------------------------------------------
// DESIGN DECISIONS, and the reasons (every one of these was a fork in the road).
//
// 1. THE SHARED STORE IS THE FIRESTORE REST FIXTURE, NOT THE LOCAL BACKEND.
//    The suite's ordinary sections run on the LOCAL backend, which is per-CONTEXT
//    localStorage — two browser contexts there are two separate leagues, so bug class (c) is
//    unreachable by construction (the suite simulates a "second device" by copying a doc
//    snapshot across, which is a snapshot, not a race). lg-core's transport is plain REST
//    since the SDK was removed, and _verify-gffl.cjs already has the technique: `opts.rest`
//    intercepts firestore.googleapis.com and answers from a NODE-SIDE object. That object is
//    shared by every context, so four devices genuinely race one store — and the harness can
//    read it directly for the invariant sweep without asking any page. No real network: the
//    only thing that changed versus the suite is WHICH fake answers the read.
//
// 2. THE SEASON IS 2026 (the shipping default), TIME IS DRIVEN BY LG.nowOverride.
//    ?sim=0. The 2025 replay exists to present ONE pinned week; a season simulator needs to
//    walk 17 of them, and LG.nowOverride is the documented hook that always wins.
//    UI.week is set alongside it because it is only ever derived at boot (lg-ui:246) — moving
//    the clock does not move the viewed week, so the harness moves both. Setting a documented
//    test hook is a HARNESS action, not a product action, and is exempt from the drive-through-
//    the-real-UI rule below.
//
// 3. EVERY WEEK FINALIZES THROUGH THE ARCHIVED-STATS BACKFILL, VIA THE REAL COMMISSIONER
//    BUTTON. The ESPN fixture reports season type "regular" and week 18 — a week that can
//    never equal any week this season finalizes — so #finalizeBtn's live attempt returns
//    "stale-week" and the button's own confirm() offers the backfill, exactly as it does for a
//    real missed week. One code path for all 17 weeks, and the harness can re-derive every
//    number from the same archived fixture. (Letting the live path win for the current week
//    would mean two different scoring paths and two different re-derivations.)
//
// 4. PERSONAS ACT THROUGH THE REAL UI. Nav buttons, the FA table's own MOVE button, the
//    centered #rosterCard, the trade builder's +/pick chips, the locker's Swap, #chatSend,
//    #finalizeBtn. THE DOCUMENTED EXCEPTIONS, each because the suite itself established the
//    same driver as the only practical route:
//      · UI.openLocker(tid) / UI.go(view) — the suite's own navigation driver (sections AK5,
//        Y). Where a nav BUTTON exists (.bnav button[data-v=…]) the button is clicked instead.
//      · LG.nowOverride / UI.week — see (2).
//      · UI.maybeAdvanceLeague() and friends — these are what the 8-second live poll calls.
//        Polling is STOPPED on every device after boot (D.stop(), the suite's waitLive does
//        the same) so phases are deterministic and a failure is attributable; the auto-chains
//        are then driven explicitly at phase boundaries, which is the same code path.
//      · window.prompt/confirm/alert are stubbed with a scriptable answer queue (section AK's
//        armPrompts, generalized so the harness can push answers per action). A native prompt
//        wedges headless Chrome silently.
//
// 5. THE TRADE REVIEW WINDOW AND THE VETO THRESHOLD ARE COMPRESSED IN THE SEEDED RULES.
//    reviewHours is WALL time by deliberate product design (lg-core's note at acceptTrade: a
//    48-hour review is a real day the family waits, not a season-time duration). A 45-minute
//    simulated season can never cross it, so executeTrade would never run. Seeded to 0 so the
//    execution path is exercised on the next auto-check. vetoVotes is seeded to 2 because a
//    veto needs owners who are NOT parties to the trade and only four devices are live at a
//    time. Both are rules-doc values the commissioner can already edit; neither is code.
//
// 6. THE PLAYER UNIVERSE IS GENERATED, NOT LIVE — and the harness re-derives scores with its
//    own arithmetic (nodeScore below is an INDEPENDENT implementation of D.score∘normSlp over
//    the stat keys it emits, which is what makes "the team total equals the sum of its
//    starters" a real check rather than a function agreeing with itself). Real-feed fidelity is
//    a different job.
//
// 7. ⚠ WHAT --seed DOES AND DOES NOT GUARANTEE, stated plainly because it would be easy to
//    overclaim. The seed makes every PERSONA CHOICE reproducible: which player is claimed, what
//    is bid, who is traded with, which chaos action fires. It does NOT make the SEASON
//    reproducible, and it cannot: four browsers racing one store is genuinely concurrent, and
//    the bugs this thing exists to find are timing races. Measured: --weeks 2 --seed 1 --fast
//    fails, and the same seed at default pacing passes — the slower settle waits let the caches
//    refresh and the races resolve. So a green run is never proof of absence, --fast is the
//    more searching setting, and a failing season is reproduced by re-running the seed until it
//    recurs, not by expecting it on the first try.
//
// PORTS: 8880 (static). Nothing else listens — every upstream is answered by request
// interception inside the browser, and Firestore/Sleeper/ESPN all resolve to Node-side
// fixtures. gstatic/googleapis/firebase are aborted exactly as the suite aborts them.
//
// SCRATCH NAMESPACE: ?fam=seasonsim. Nothing here can reach family data.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SRV_PORT = 8880;
const BASE = "http://127.0.0.1:" + SRV_PORT;
const FAM = "seasonsim";
const PASS = "amenfarms";
const SEASON = 2026;
const SEASON_START = "2026-09-08";
const SEASON_WEEKS = 14;
const ROSTER_SIZE = 16;      // 9 starters + 7 bench (QB1 RB2 WR2 TE1 FLEX1 DST1 K1, BENCH 7) — the DRAFT size
// RESTAGED 2026-08-17: rosters are no longer exactly ROSTER_SIZE for a whole season. The
// 2026-08-15 add-without-drop feature legitimately grows a roster past 16 via no-drop adds,
// up to the rules' true capacity: 16 slots + IR 3 = 19 (sum lg-core's DEFAULT_RULES.roster —
// this constant is that sum hand-computed, and the sweep says the arithmetic in its message).
// The old exact-16 check failed 82 times across a sim season for that one reason — every
// failure was a roster at 19, none was a real leak. The invariant that still holds, and the
// one now asserted, is a BAND: never below the draft size (this sim never drops without
// adding — grep dropPlayer: 0 hits) and never above capacity.
const ROSTER_CAP = 19;       // 16 + IR 3
const FAAB_BUDGET = 100;
const COMMISH_PIN = "9090";
// The engine's reported week. Never equal to a week this season finalizes, which is what
// routes every finalize through the archived-stats backfill — see design decision 3.
const ENGINE_WEEK = 18;

// ---------------- args ----------------
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};
const WEEKS = Math.max(1, Math.min(17, Number(argOf("--weeks", 17)) || 17));
const SEED = Number(argOf("--seed", 1)) || 1;
const FAST = argv.includes("--fast");
const REPORT = argv.includes("--report");
const TRACE = argv.includes("--trace");
// ⭐ --fresh-finalize IS GONE (2026-08-11). It was a DIAGNOSTIC A/B: it dropped the finalizing
// device's caches before the tap, so running the same seed with and without it turned "the
// numbers differ" into "the numbers differ BECAUSE the read was cached". That question is
// settled — LG.finalizeWeek now builds one fresh, consistent roster snapshot and scores THAT
// (see its own ⭐ SEASON-SIM BUG 2 note), so the diagnostic has become the behaviour and
// keeping the flag would mean the sim could still be run in a mode the product no longer has.
// The evidence it produced is preserved where it belongs: FINALIZE_VIEW below still captures
// what the finalizing device BELIEVED the lineups were, and the weekly.totalsMatchRosters
// invariant still prints that view beside the store's own roster of record — so a future
// regression is self-proving on the first run, with no flag to remember.
const SETTLE = FAST ? 90 : 220;   // per-action settle wait

// ---------------- deterministic rng ----------------
// mulberry32 — small, fast, and reproducible from a 32-bit seed. Every persona choice draws
// from ONE stream so a --seed replays the identical season.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const rint = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
// A SEPARATE, position-independent stream for the stat fixtures: a persona making one more
// decision must not shift every player's stat line for the rest of the season.
function hashRng(...parts) {
  let h = 2166136261 >>> 0;
  const s = String(SEED) + "|" + parts.join("|");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return mulberry32(h >>> 0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (pin) => crypto.createHash("sha256").update(pin + ":" + PASS).digest("hex");
// A table cell's innerText carries the position, the name and the NFL team on three lines;
// a failure message that reproduces those newlines is unreadable.
const flat = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

// What the app will actually store for a bid of `typed` on a card whose purse cap was `cap`.
// This MIRRORS lg-ui's own `Math.max(0, Math.min(LG.teamFaab(T), rawBid))` — an owner may not
// bid money they do not have, and the claim card advertises the ceiling on #claimBid's `max`.
// `cap` null means the card offered no ceiling to read (a pre-clamp ledger row, or a
// post-deadline instant ADD with no bid input at all), in which case the typed figure stands.
const expectedBid = (typed, cap) =>
  (cap == null ? Number(typed) : Math.max(0, Math.min(Number(cap), Number(typed))));

// ---------------- log + failure collection ----------------
const t0 = Date.now();
const lines = [];
function log(s) { const m = String(s); lines.push(m); console.log(m); }
function banner(s) { log(""); log("=== " + s + " ==="); }

const FAILURES = [];
let CHECKS = 0;
// The action log since the last sweep — this is what a failure prints, because "FAAB is wrong"
// is useless and "FAAB is wrong, and here are the nine things four devices just did" is not.
let ACTIONS = [];
function actLog(dev, persona, what) {
  ACTIONS.push({ at: Date.now() - t0, dev, persona, what });
  if (TRACE) log("    · " + dev + " " + what);
}
// A persona that could not act is not a failure by itself — a week with no eligible free agent
// is a legitimate week. But it IS the difference between "the season exercised this flow" and
// "the season silently skipped it all year", so every no-op says why, and the run summary
// counts them. A flow that no-ops EVERY week is reported as a coverage gap at the end.
const NOOPS = new Map();
function noop(dev, what, why) {
  NOOPS.set(what, (NOOPS.get(what) || 0) + 1);
  actLog(dev ? dev.label : "-", dev ? dev.who : "-", "no-op " + what + " — " + why);
}
let CUR = { week: 0, phase: "boot" };
function fail(invariant, detail, repro) {
  FAILURES.push({
    week: CUR.week, phase: CUR.phase, invariant, detail, repro,
    actions: ACTIONS.slice(-24),
  });
  log("  ✗ [w" + CUR.week + " " + CUR.phase + "] " + invariant + " — " + detail);
  if (repro) log("      repro: " + repro);
}
function check(cond, invariant, detail, repro) {
  CHECKS++;
  if (!cond) fail(invariant, detail, repro);
  return !!cond;
}

// ---------------- the shared store (Firestore REST, node-side) ----------------
// The exact shape _verify-gffl.cjs's restFixture uses, with the wire codec re-implemented
// independently of lg-core's fsEnc/fsDec (that is what makes a round trip a real assertion).
const FS_DOC_ROOT = "projects/amen-farms-app/databases/(default)/documents";
// `vers` / `conflicts` are the CAS half (2026-08-18). Firestore stamps every read with an
// `updateTime` and honours `currentDocument.updateTime` / `currentDocument.exists` on every
// write; lg-core's LG.db.update is built on exactly that, so a fixture that accepted every
// PATCH would let this whole simulator report green over a transport with no compare-and-swap
// in it at all. The version is a monotonic counter rendered as a timestamp string, NOT a real
// clock: two writes inside one millisecond are the case this simulator exists to produce.
const STORE = { docs: {}, calls: 0, writes: [], vers: {}, conflicts: 0, ignorePreconditions: false };
let VER = 0;
const stampVer = () => "2026-01-01T00:00:00." + String(++VER).padStart(9, "0") + "Z";
const PRECON_FAIL = {
  error: { code: 409, message: "the stored version does not match the required base version", status: "FAILED_PRECONDITION" },
};
function precondition(u) {
  const mUt = /[?&]currentDocument\.updateTime=([^&]+)/.exec(u);
  if (mUt) return { updateTime: decodeURIComponent(mUt[1]) };
  const mEx = /[?&]currentDocument\.exists=(true|false)/.exec(u);
  if (mEx) return { exists: mEx[1] === "true" };
  return null;
}
function fsEnc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsEnc) } };
  if (typeof v === "object") { const f = {}; for (const k of Object.keys(v)) f[k] = fsEnc(v[k]); return { mapValue: { fields: f } }; }
  return { nullValue: null };
}
function fsDec(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsDec);
  if ("mapValue" in v) { const o = {}; const f = v.mapValue.fields || {}; for (const k of Object.keys(f)) o[k] = fsDec(f[k]); return o; }
  return null;
}
const fsDoc = (id, doc) => {
  const fields = {};
  for (const k of Object.keys(doc || {})) fields[k] = fsEnc(doc[k]);
  return {
    name: FS_DOC_ROOT + "/gffl_" + FAM + "/" + id, fields,
    updateTime: STORE.vers[id] || (STORE.vers[id] = stampVer()),
  };
};
function restRespond(req, u, devLabel) {
  const method = req.method();
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
  };
  STORE.calls++;
  if (method === "OPTIONS") return req.respond({ status: 200, headers: cors, body: "" });
  const json = (o, st) => req.respond({ status: st || 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
  if (u.includes(":runQuery")) {
    let q = {};
    try { q = (JSON.parse(req.postData() || "{}").structuredQuery) || {}; } catch (e) { /* malformed */ }
    const kind = q.where && q.where.fieldFilter ? q.where.fieldFilter.value.stringValue : null;
    const rows = Object.entries(STORE.docs)
      .filter(([, d]) => !kind || d.kind === kind)
      .map(([id, d]) => ({ document: fsDoc(id, d), readTime: "2026-01-01T00:00:00Z" }));
    return json(rows.length ? rows : [{ readTime: "2026-01-01T00:00:00Z" }]);
  }
  const m = /\/documents\/([^/?]+)\/([^/?]+)/.exec(u);
  const id = m ? decodeURIComponent(m[2]) : null;
  if (method === "GET") {
    const d = STORE.docs[id];
    if (!d) return json({ error: { code: 404, status: "NOT_FOUND", message: "Document not found." } }, 404);
    return json(fsDoc(id, d));
  }
  if (method === "PATCH") {
    let payload = {};
    try { payload = JSON.parse(req.postData() || ""); } catch (e) { /* malformed */ }
    // The precondition, evaluated against the document as it stands right now — the refusal
    // that makes a compare-and-swap a compare-and-swap. Answered with the real service's
    // FAILED_PRECONDITION body so lg-core's setIf classifies it the way it will in production.
    const pre = precondition(u);
    if (pre && !STORE.ignorePreconditions) {
      const bad = "exists" in pre
        ? (pre.exists ? !STORE.docs[id] : !!STORE.docs[id])
        : (!STORE.docs[id] || (STORE.vers[id] || null) !== pre.updateTime);
      if (bad) {
        STORE.conflicts++;
        STORE.writes.push({ at: Date.now() - t0, id, dev: devLabel, week: CUR.week, phase: CUR.phase, refused: true, sig: null });
        return json(PRECON_FAIL, 409);
      }
    }
    const patch = {};
    for (const k of Object.keys(payload.fields || {})) patch[k] = fsDec(payload.fields[k]);
    STORE.docs[id] = { ...(STORE.docs[id] || {}), ...patch }; // updateMask semantics
    STORE.vers[id] = stampVer();                              // every accepted write moves the version
    // WHO wrote it, and WHAT — a doc that ends up wrong is almost always a doc that two
    // devices wrote, and "which device, in which phase, with which contents" is the only
    // thing that turns that from a hunch into a finding.
    STORE.writes.push({
      at: Date.now() - t0, id, dev: devLabel, week: CUR.week, phase: CUR.phase,
      sig: Array.isArray(patch.players) ? patch.players.map((p) => p.slot + ":" + p.key).join(",") : null,
    });
    return json(fsDoc(id, STORE.docs[id]));
  }
  if (method === "DELETE") { delete STORE.docs[id]; delete STORE.vers[id]; return json({}); }
  return json({});
}
// Every write to one doc, in order, with the device that made it — the evidence a
// last-writer-wins failure needs and cannot be diagnosed without.
function writeHistory(id) {
  const w = STORE.writes.filter((x) => x.id === id);
  if (!w.length) return " (no writes recorded for " + id + ")";
  return "\n      write history of " + id + ":\n" + w.map((x) =>
    "        " + (x.at / 1000).toFixed(1) + "s  " + x.dev + "  [w" + x.week + " " + x.phase + "]" +
    (x.sig ? "  -> " + x.sig : "")).join("\n");
}
const sdoc = (id) => STORE.docs[id] || null;
const slist = (kind) => Object.entries(STORE.docs).filter(([, d]) => d && d.kind === kind).map(([id, d]) => ({ ...d, id }));

// ---------------- the player universe ----------------
const NFL = ["KC", "BUF", "PHI", "DAL", "SF", "DET", "BAL", "MIA", "CIN", "GB", "LAR", "NYJ", "HOU", "MIN", "SEA", "TB"];
// Roster composition: QB2 RB4 WR6 TE2 DST1 K1 = 16. Starters QB1 RB2 WR2 TE1 FLEX1 DST1 K1 = 9.
const TEAM_COMP = [["QB", 2], ["RB", 4], ["WR", 6], ["TE", 2], ["DST", 1], ["K", 1]];
const FA_COMP = [["QB", 4], ["RB", 10], ["WR", 14], ["TE", 6], ["K", 4]];

const PLAYERS = new Map();   // pid -> {pid, name, team, pos, espnId, key, searchRank, injury}
const OWNERS = [];           // persona records
const ROSTER0 = {};          // teamId -> [{key,name,pos,team,slot}]

function makePlayer(pid, name, team, pos, rank) {
  const espnId = pos === "DST" ? null : String(400000 + Number(pid));
  const key = pos === "DST" ? "dst_" + pid : espnId;
  const p = { pid: String(pid), name, team, pos, espnId, key, searchRank: rank, injury: "" };
  PLAYERS.set(String(pid), p);
  return p;
}
const SURNAMES = ["Archer", "Bloom", "Carver", "Dane", "Ellis", "Frost", "Gable", "Hoyt", "Innes", "Judd",
  "Keane", "Lomax", "Marsh", "Nash", "Orme", "Pike", "Quill", "Rennie", "Sable", "Thorn",
  "Urban", "Vance", "Whitby", "Xander", "York", "Zane", "Abbott", "Byrne", "Coyle", "Dunne",
  "Ewing", "Falk", "Grady", "Hurst", "Ives", "Joyce", "Kerr", "Lowry", "Mercer", "Noble",
  "Oakes", "Prior", "Ridley", "Slade", "Tate", "Vaughn", "Wexler", "Yates", "Ansell", "Brill"];
const FIRSTS = ["Adam", "Brett", "Cody", "Drew", "Eli", "Finn", "Gus", "Hank", "Ira", "Jonah",
  "Kai", "Levi", "Miles", "Noah", "Omar", "Pace", "Quinn", "Reid", "Sam", "Trey"];

function buildUniverse() {
  let pid = 1000, rank = 1;
  // D/STs use their NFL abbrev as the pid, exactly like _verify-gffl's PHI/DAL rows — that is
  // what makes the roster key `dst_<abbrev>` line up with weekStatsMap's own second write.
  for (const ab of NFL) makePlayer(ab, ab + " D/ST", ab, "DST", 900 + NFL.indexOf(ab));
  const nameAt = (i) => FIRSTS[i % FIRSTS.length] + " " + SURNAMES[Math.floor(i / FIRSTS.length) % SURNAMES.length] + (i >= FIRSTS.length * SURNAMES.length ? String(i) : "");
  let ni = 0;
  for (let t = 1; t <= 8; t++) {
    const list = [];
    for (const [pos, n] of TEAM_COMP) {
      for (let i = 0; i < n; i++) {
        if (pos === "DST") { list.push({ ...PLAYERS.get(NFL[(t - 1) % NFL.length]) }); continue; }
        const p = makePlayer(pid++, nameAt(ni++), NFL[(pid + t) % NFL.length], pos, rank++);
        list.push(p);
      }
    }
    ROSTER0[t] = slotRoster(list);
  }
  for (const [pos, n] of FA_COMP) {
    for (let i = 0; i < n; i++) makePlayer(pid++, nameAt(ni++), NFL[(pid * 3) % NFL.length], pos, 400 + rank++);
  }
}
// The slot script the app itself enforces (LG.DEFAULT_RULES.roster).
function slotRoster(list) {
  const want = [["QB", 1], ["RB", 2], ["WR", 2], ["TE", 1], ["DST", 1], ["K", 1]];
  const out = [], used = new Set();
  for (const [pos, n] of want) {
    let took = 0;
    for (const p of list) {
      if (took >= n || used.has(p.key) || p.pos !== pos) continue;
      used.add(p.key); out.push({ key: p.key, name: p.name, pos: p.pos, team: p.team, slot: pos }); took++;
    }
  }
  const flex = list.find((p) => !used.has(p.key) && ["RB", "WR", "TE"].includes(p.pos));
  if (flex) { used.add(flex.key); out.push({ key: flex.key, name: flex.name, pos: flex.pos, team: flex.team, slot: "FLEX" }); }
  for (const p of list) {
    if (used.has(p.key)) continue;
    used.add(p.key); out.push({ key: p.key, name: p.name, pos: p.pos, team: p.team, slot: "BENCH" });
  }
  return out;
}

// ---------------- stat + projection fixtures ----------------
// Deterministic per (seed, pid, week). Only the keys below are ever emitted, which is what
// keeps nodeScore an exact, readable mirror.
function statRow(pid, week) {
  const p = PLAYERS.get(String(pid));
  if (!p) return null;
  const r = hashRng("stat", pid, week);
  const ri = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  switch (p.pos) {
    case "QB": return { pass_yd: ri(120, 360), pass_td: ri(0, 3), pass_int: ri(0, 2), rush_yd: ri(0, 25) };
    case "RB": return { rush_yd: ri(10, 130), rush_td: ri(0, 2), rec: ri(0, 5), rec_yd: ri(0, 45) };
    case "WR": return { rec: ri(1, 9), rec_yd: ri(5, 125), rec_td: ri(0, 2) };
    case "TE": return { rec: ri(1, 7), rec_yd: ri(5, 85), rec_td: ri(0, 1) };
    case "K": return { fgm_20_29: ri(0, 2), fgm_40_49: ri(0, 2), xpm: ri(0, 4), fgmiss: ri(0, 1) };
    case "DST": return { pts_allow: ri(0, 34), sack: ri(0, 6), int: ri(0, 3), fum_rec: ri(0, 2) };
    default: return { rec: 1, rec_yd: 10 };
  }
}
function projRow(pid, week) {
  const p = PLAYERS.get(String(pid));
  if (!p) return null;
  const r = hashRng("proj", pid, week);
  const ri = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  switch (p.pos) {
    case "QB": return { pass_yd: ri(180, 300), pass_td: ri(1, 2) };
    case "RB": return { rush_yd: ri(30, 100), rec: ri(1, 3), rec_yd: ri(5, 25) };
    case "WR": return { rec: ri(3, 7), rec_yd: ri(30, 90) };
    case "TE": return { rec: ri(2, 5), rec_yd: ri(15, 55) };
    case "K": return { fgm_20_29: 1, fgm_40_49: 1, xpm: 2 };
    case "DST": return { pts_allow: ri(14, 24), sack: 2, int: 1 };
    default: return { rec: 1, rec_yd: 10 };
  }
}
const weekStatsPayload = (week) => {
  const out = {};
  for (const pid of PLAYERS.keys()) out[pid] = statRow(pid, week);
  return out;
};
const weekProjPayload = (week) => {
  const out = {};
  for (const pid of PLAYERS.keys()) out[pid] = projRow(pid, week);
  return out;
};
// INDEPENDENT re-implementation of D.score ∘ normSlp over exactly the keys statRow emits.
// Deliberately not shared with anything the app runs: a check that reuses the code under test
// is a function agreeing with itself.
const SCORING = {
  pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6,
  rec: 1, rec_yd: 0.1, rec_td: 6,
  fg_0_39: 3, fg_40_49: 4, fg_miss: -1, xp_made: 1,
  dst_sack: 1, dst_int: 2, dst_fum_rec: 2,
};
function paPoints(pa) {
  if (pa == null) return 0;
  if (pa <= 0) return 5;
  if (pa <= 6) return 4;
  if (pa <= 13) return 3;
  if (pa <= 17) return 1;
  if (pa <= 27) return 0;
  if (pa <= 34) return -1;
  if (pa <= 45) return -3;
  return -5;
}
function nodeScore(st) {
  if (!st) return 0;
  let p = 0;
  p += (st.pass_yd || 0) * SCORING.pass_yd + (st.pass_td || 0) * SCORING.pass_td + (st.pass_int || 0) * SCORING.pass_int;
  p += (st.rush_yd || 0) * SCORING.rush_yd + (st.rush_td || 0) * SCORING.rush_td;
  p += (st.rec || 0) * SCORING.rec + (st.rec_yd || 0) * SCORING.rec_yd + (st.rec_td || 0) * SCORING.rec_td;
  p += ((st.fgm_20_29 || 0)) * SCORING.fg_0_39 + (st.fgm_40_49 || 0) * SCORING.fg_40_49;
  p += (st.fgmiss || 0) * SCORING.fg_miss + (st.xpm || 0) * SCORING.xp_made;
  p += (st.sack || 0) * SCORING.dst_sack + (st.int || 0) * SCORING.dst_int + (st.fum_rec || 0) * SCORING.dst_fum_rec;
  if (st.pts_allow != null) p += paPoints(st.pts_allow);
  return Math.round(p * 100) / 100;
}
const scoreOfKey = (key, week) => {
  for (const p of PLAYERS.values()) if (p.key === key) return nodeScore(statRow(p.pid, week));
  return 0;
};

// ---------------- the ESPN slate fixture ----------------
// season.type 2 (regular) so the preseason guard passes, week ENGINE_WEEK so the week guard
// always refuses the LIVE path — see design decision 3. Every game reads "post" so nothing on
// screen looks broken and D.S.games is populated for the Scores tab.
// HALF THE SLATE HAS KICKED OFF, HALF HAS NOT — deliberately, and this took a run to learn:
// with every game "post" the app correctly disables EVERY lineup Swap (playerLocked), so the
// whole lineup flow no-ops all season and a green run proves nothing about it. A mixed slate
// exercises both branches: an editable lineup AND the disabled-with-a-reason row that item 9
// exists for. The backfill path skips the game-state gate entirely, so finalizing is unaffected.
const gameState = (i) => (i % 4 === 0 ? "post" : "pre");
function slateFixture() {
  const events = [];
  for (let i = 0; i < NFL.length; i += 2) {
    const a = NFL[i], h = NFL[i + 1];
    const state = gameState(i);
    const type = state === "post"
      ? { state: "post", completed: true, shortDetail: "Final" }
      : { state: "pre", completed: false, shortDetail: "Sun 1:00 PM" };
    events.push({
      id: "50000000" + i, date: "2026-12-20T18:00Z",
      status: { type, period: state === "post" ? 4 : 0, displayClock: "0:00" },
      competitions: [{
        id: "50000000" + i,
        competitors: [
          { homeAway: "home", score: state === "post" ? "24" : "0", team: { abbreviation: h, displayName: h, logo: "https://a.espncdn.com/i/teamlogos/nfl/500/" + h.toLowerCase() + ".png" }, records: [{ summary: "9-5" }] },
          { homeAway: "away", score: state === "post" ? "17" : "0", team: { abbreviation: a, displayName: a, logo: "https://a.espncdn.com/i/teamlogos/nfl/500/" + a.toLowerCase() + ".png" }, records: [{ summary: "7-7" }] },
        ],
        status: { type },
        broadcasts: [{ names: ["FOX"] }],
      }],
    });
  }
  return { season: { type: 2, year: SEASON }, week: { number: ENGINE_WEEK }, events };
}
const sleeperState = () => ({ season: String(SEASON), season_type: "regular", week: ENGINE_WEEK, leg: ENGINE_WEEK });
function directoryFixture() {
  const out = {};
  for (const p of PLAYERS.values()) {
    out[p.pid] = {
      full_name: p.pos === "DST" ? undefined : p.name,
      first_name: p.pos === "DST" ? undefined : p.name.split(" ")[0],
      last_name: p.pos === "DST" ? undefined : p.name.split(" ").slice(1).join(" "),
      team: p.team, position: p.pos === "DST" ? "DEF" : p.pos,
      espn_id: p.espnId ? Number(p.espnId) : null,
      search_rank: p.searchRank, injury_status: p.injury || null,
      depth_chart_order: 1,
    };
  }
  return out;
}

// ---------------- seeding the league ----------------
const OWNER_NAMES = [
  ["Battle Kreussers", "BK", "Peter"],
  ["The GOAT Kids", "GK", "Isaac"],
  ["Nails For Breakfast", "NFB", "Mom"],
  ["Wyoming Cowboys", "WYO", "Grandpa"],
  ["Elanikan Skywalkers", "ELK", "Eleanor"],
  ["Chula Vista Jaguarrams", "CVJ", "Joy"],
  ["Nerfherders", "NRF", "John"],
  ["Kruz Control", "KRZ", "Janae"],
];
const CHAOS_TEAM = 8; // Kruz Control — the deliberately pathological persona

function seedStore() {
  const rules = {
    name: "The Goat Fantasy Football League", abbrev: "GFFL", season: SEASON, seasonWeeks: SEASON_WEEKS,
    draftAt: "2026-09-06T15:00:00-05:00",
    scoring: {
      pass_yd: 0.04, pass_td: 4, pass_int: -2, pass_2pt: 2,
      rush_yd: 0.1, rush_td: 6, rush_2pt: 2,
      rec: 1, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
      fg_0_39: 3, fg_40_49: 4, fg_50: 5, fg_miss: -1, xp_made: 1, xp_miss: -1,
      bonus_pass_300: 0, bonus_pass_400: 0, bonus_rush_100: 0, bonus_rush_200: 0,
      bonus_rec_100: 0, bonus_rec_200: 0, off_fum_td: 0, fg_made_yd: 0, dst_2pt_ret: 0, one_pt_safety: 0,
      dst_sack: 1, dst_int: 2, dst_fum_rec: 2, dst_td: 6, dst_safety: 2, dst_blk: 2,
      dst_pa_0: 5, dst_pa_1_6: 4, dst_pa_7_13: 3, dst_pa_14_17: 1,
      dst_pa_18_27: 0, dst_pa_28_34: -1, dst_pa_35_45: -3, dst_pa_46: -5,
    },
    roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1, BENCH: 7, IR: 3 },
    waivers: { type: "faab", budget: FAAB_BUDGET, processDow: 3, processHour: 8 },
    // reviewHours 0 / vetoVotes 2 — see design decision 5.
    trades: { reviewHours: 0, veto: "vote", vetoVotes: 2, deadlineWeek: 11 },
    keepers: { max: 3, costRoundsEarlier: 1, costFloor: 1, maxYears: 3, waiverCost: "last-round", mustBeOnFinalRoster: true },
    playoffs: { teams: 5, startWeek: 15, byes: 3 },
  };
  STORE.docs.settings = { kind: "settings", rules, log: [] };
  STORE.docs.auth = { kind: "auth", commishPinHash: sha(COMMISH_PIN) };
  for (let t = 1; t <= 8; t++) {
    const [name, abbrev, owner] = OWNER_NAMES[t - 1];
    STORE.docs["team_" + t] = { kind: "team", teamId: t, name, abbrev, owner, faab: FAAB_BUDGET };
    STORE.docs["roster_" + SEASON + "_w1_t" + t] = { kind: "roster", week: 1, teamId: t, players: ROSTER0[t] };
    OWNERS.push({ id: t, name, abbrev, owner, pin: String(1000 + t * 111), pinSet: false });
  }
  STORE.docs["sched_" + SEASON] = { kind: "sched", season: SEASON, weeks: genSchedule([1, 2, 3, 4, 5, 6, 7, 8], SEASON_WEEKS) };
}
// The circle method, mirroring LG.generateSchedule's shape ({g:[{h,a}]} per week is what
// saveSchedule writes; loadSchedule unwraps it). Written here so the season exists before any
// page boots, which keeps the whole seed one Node-side operation.
function genSchedule(teamIds, weeks) {
  const ids = [...teamIds];
  const n = ids.length, rounds = n - 1;
  const out = [];
  const arr = ids.slice();
  for (let r = 0; r < weeks; r++) {
    const g = [];
    for (let i = 0; i < n / 2; i++) {
      const h = arr[i], a = arr[n - 1 - i];
      if (h == null || a == null) continue;
      g.push(r % 2 === 0 ? { h, a } : { h: a, a: h });
    }
    out.push({ g });
    const fixed = arr[0], rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.length = 0; arr.push(fixed, ...rest);
    if ((r + 1) % rounds === 0) { /* second half flips home/away via r%2 above */ }
  }
  return out;
}

// ---------------- the clock ----------------
const seasonStartMs = Date.parse(SEASON_START + "T05:00:00-05:00");
const weekStart = (w) => seasonStartMs + (w - 1) * 7 * 24 * 3600e3;
const waiverDeadline = (w) => weekStart(w) + 1 * 24 * 3600e3 + 3 * 3600e3; // Wed 08:00, per rules
const HOUR = 3600e3;

// ---------------- push ledger ----------------
// FIRE-AND-FORGET IS THE WHOLE PROBLEM: every producer here is deliberately un-awaited (a
// notification may never cost the action that produced it), so a check that reads the wire
// immediately after the click reads an empty array. PUSHES is DRAINED at each sweep, after the
// phase's own settle waits, which is the only honest window.
const PUSHES = [];   // {at, week, phase, dev, payload}
const PUSH_TOTAL = { n: 0 };
const COVER = { trade: 0, chat: 0, lineup: 0 };
function drainPushes() { const out = PUSHES.slice(); PUSHES.length = 0; return out; }

// ---------------- static server ----------------
function startStatic() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html");
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("nope"); return; }
    const mime = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json",
      ".json": "application/json", ".png": "image/png" }[path.extname(p)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => srv.listen(SRV_PORT, "127.0.0.1", () => r(srv)));
}

// ---------------- devices ----------------
const DEVICES = [];
async function newDevice(browser, label) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const dev = { label, ctx, page, errors: [], consoleErrors: [], teamId: null, who: null, commish: false };
  page.on("pageerror", (e) => dev.errors.push({ week: CUR.week, phase: CUR.phase, msg: String(e) }));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // The app's own honest degradations: a blocked CDN/analytics fetch is not a page fault, and
    // the harness deliberately 404s a few optional endpoints.
    if (/net::ERR_|Failed to load resource|favicon/.test(t)) return;
    dev.consoleErrors.push({ week: CUR.week, phase: CUR.phase, msg: t });
  });
  await page.evaluateOnNewDocument((pass) => {
    // The family passphrase, exactly as _verify-gffl's newTestPage seeds it. Without it every
    // device lands on the ENTER THE LEAGUE gate and nothing downstream exists — which is what
    // the first run of this harness spent its time discovering.
    try { localStorage.setItem("gffl_pass", pass); } catch (e) {}
    window.__ans = [];
    window.__promptLog = [];
    window.__alerts = [];
    window.__confirms = [];
    window.__confirmAnswer = true;
    window.prompt = (msg) => { window.__promptLog.push(String(msg)); return window.__ans.length ? window.__ans.shift() : null; };
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = (m) => { window.__confirms.push(String(m)); return window.__confirmAnswer; };
    // THE TOAST RECORDER, watched at the DOM. The app's whole failure posture is "say why,
    // never fail silently" (reasonLabel, importFail, the offline chip), so the harness has to
    // tell a REFUSAL apart from SILENCE — "Couldn't add: that player is already owned" on a
    // one-run-stale table is the app being RIGHT; an add that changes nothing and says nothing
    // is a bug. Watching #toast rather than wrapping UI.toast is deliberate and was learned the
    // hard way: every call site inside renderMoves/renderLocker calls the CLOSURE-LOCAL
    // `toast`, so wrapping the exported UI.toast intercepts nothing. #toast's textContent is
    // also literally what the family sees, which is the better thing to assert on anyway.
    window.__toasts = [];
    const armToast = () => {
      const el = document.getElementById("toast");
      if (!el) return;
      new MutationObserver(() => {
        const t = (el.textContent || "").trim();
        if (t && window.__toasts[window.__toasts.length - 1] !== t) window.__toasts.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", armToast);
    else armToast();
  }, PASS);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    const cors = { "Access-Control-Allow-Origin": "*" };
    const json = (o, st) => req.respond({ status: st || 200, contentType: "application/json", headers: cors, body: JSON.stringify(o) });
    (async () => {
      try {
        if (u.includes("/.netlify/functions/notify")) {
          let sent = null;
          try { sent = JSON.parse(req.postData() || "{}"); } catch (e) { sent = { unparseable: true }; }
          PUSHES.push({ at: Date.now() - t0, week: CUR.week, phase: CUR.phase, dev: label, payload: sent });
          PUSH_TOTAL.n++;
          return json({ sent: 1, pruned: 0 });
        }
        if (u.includes("/.netlify/functions/league")) {
          let body = {};
          try { body = JSON.parse(req.postData() || "{}"); } catch (e) { /* malformed */ }
          // pct-owned is the one action the pages call on every card open; answering it keeps
          // the modal free of a spurious failure path. Everything else honestly says no —
          // the app is built to render bare rather than broken when a function is unavailable.
          if (body.action === "lg_pct_owned") return json({ ok: true, owned: {} });
          return json({ ok: false, reason: "not-in-sim" });
        }
        if (u.includes("/.netlify/functions/")) return json({ ok: false, reason: "not-in-sim" });
        if (/firestore\.googleapis\.com/.test(u)) return restRespond(req, u, label);
        if (/gstatic|googleapis|firebase/.test(u)) return req.abort();
        if (/a\.espncdn\.com\/i\/teamlogos/.test(u)) {
          return req.respond({ status: 200, contentType: "image/svg+xml", headers: cors,
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="31" fill="#2a4f80"/></svg>' });
        }
        if (u.includes("site.api.espn.com")) {
          if (u.includes("/scoreboard")) return json(slateFixture());
          return json({});
        }
        if (u.includes("api.sleeper.app")) {
          if (u.includes("/players/nfl/trending/")) return json([]);
          if (u.endsWith("/state/nfl")) return json(sleeperState());
          if (u.endsWith("/players/nfl")) return json(directoryFixture());
          const sm = /\/stats\/nfl\/([^/]+)\/(\d+)\/(\d+)/.exec(u);
          if (sm) return json(weekStatsPayload(Number(sm[3])));
          const pm = /\/projections\/nfl\/([^/]+)\/(\d+)\/(\d+)/.exec(u);
          if (pm) return json(weekProjPayload(Number(pm[3])));
          return json({});
        }
        if (u.startsWith(BASE)) return req.continue();
        return req.abort();
      } catch (e) { /* page closed mid-flight */ }
    })();
  });
  DEVICES.push(dev);
  return dev;
}

// ---------------- page helpers ----------------
const ev = (dev, fn, ...args) => dev.page.evaluate(fn, ...args).catch(() => null);
async function boot(dev) {
  await dev.page.goto(BASE + "/league.html?fam=" + FAM + "&sim=0", { waitUntil: "domcontentloaded" });
  await dev.page.waitForFunction(() => !!window.__GFFL__, { timeout: 20000 });
  // Wait for either the league home or the claim screen — both are legitimate landings.
  await dev.page.waitForFunction(
    () => !!document.querySelector(".mucard") || !!document.querySelector(".teamrow") || !!document.querySelector("#offlineRetry"),
    { timeout: 25000 }).catch(() => {});
  // Polling OFF — see design decision 4. The auto-chains it runs are driven explicitly.
  await ev(dev, () => { try { window.__GFFL__.D.stop(); } catch (e) {} });
  // WHICH FUNCTION WROTE THIS ROSTER. A roster doc that ends up wrong is always a doc two
  // devices wrote, and the store can say who but not why — only the call site can. Wrapping
  // LG.saveRoster to record a stack is an OBSERVATION (the real function still runs, with the
  // same arguments); without it, "a device clobbered another team's roster" stays a hunch.
  await ev(dev, () => {
    const LG = window.__GFFL__.LG;
    if (LG.__saveRosterHooked) return;
    LG.__saveRosterHooked = true;
    window.__rosterWrites = [];
    const real = LG.saveRoster;
    LG.saveRoster = function (week, teamId, players) {
      const st = (new Error().stack || "").split("\n").slice(1, 6)
        .map((l) => (l.match(/at ([^ ]+)/) || [])[1] || "?").filter((n) => n && n !== "?").join(" < ");
      window.__rosterWrites.push({ week, teamId, via: st });
      return real.call(this, week, teamId, players);
    };
  });
}
const toasts = (dev) => ev(dev, () => (window.__toasts || []).slice());
const clearToasts = (dev) => ev(dev, () => { window.__toasts = []; });
async function setClock(ms, week) {
  for (const d of DEVICES) {
    if (!d.live) continue;
    await ev(d, (ts, wk) => {
      const G = window.__GFFL__;
      G.LG.nowOverride = ts;
      if (wk != null) G.UI.week = wk;
    }, ms, week);
  }
}
const answers = (dev, list) => ev(dev, (a) => { window.__ans = a.slice(); }, list);
const confirmWith = (dev, yes) => ev(dev, (y) => { window.__confirmAnswer = y; }, yes);
const waitFor = async (dev, sel, ms) => {
  try { await dev.page.waitForSelector(sel, { timeout: ms || 8000 }); return true; }
  catch (e) { return false; }
};
const waitGone = async (dev, sel, ms) => {
  try { await dev.page.waitForFunction((s) => !document.querySelector(s), { timeout: ms || 8000 }, sel); return true; }
  catch (e) { return false; }
};
const clickSel = (dev, sel, text) => ev(dev, (s, t) => {
  const els = [...document.querySelectorAll(s)];
  const el = t ? els.find((e) => e.textContent.includes(t)) : els[0];
  if (!el) return false;
  el.click(); return true;
}, sel, text || null);
const clickChild = (dev, containerSel, childSel, text) => ev(dev, (cs, chs, t) => {
  const els = [...document.querySelectorAll(cs)];
  const el = t ? els.find((e) => e.textContent.includes(t)) : els[0];
  if (!el) return false;
  const c = el.querySelector(chs);
  if (!c) return false;
  c.click(); return true;
}, containerSel, childSel, text || null);
const nav = async (dev, view) => {
  const okc = await clickSel(dev, '.bnav button[data-v="' + view + '"]');
  if (!okc) await ev(dev, (v) => window.__GFFL__.UI.go(v), view);
  await sleep(SETTLE);
};

// ---------------- identity: the REAL claim flow ----------------
async function claimOn(dev, teamId) {
  const o = OWNERS[teamId - 1];
  if (dev.teamId === teamId) return true;
  await ev(dev, () => { try { localStorage.removeItem("gffl_team"); localStorage.removeItem("gffl_who"); } catch (e) {} });
  await boot(dev);
  if (!(await waitFor(dev, ".teamrow", 15000))) {
    fail("claim.screen", dev.label + " never reached the claim screen for " + o.name,
      "boot " + BASE + "/league.html?fam=" + FAM + "&sim=0 with gffl_team cleared");
    return false;
  }
  // A team that already carries a pinHash asks for the PIN FIRST, then the name; an unclaimed
  // one asks for the name and then a PIN to set. Both are the real prompt order (lg-ui
  // claimTeam), which is why the harness has to know which one it is about to meet.
  await answers(dev, o.pinSet ? [o.pin, o.owner] : [o.owner, o.pin]);
  await clickSel(dev, ".teamrow", o.name);
  const landed = await waitFor(dev, ".mucard", 15000);
  if (!landed) {
    const log = await ev(dev, () => window.__promptLog);
    fail("claim.flow", dev.label + " could not claim " + o.name + " (prompts: " + JSON.stringify(log) + ")",
      "click .teamrow '" + o.name + "' with answers " + JSON.stringify(o.pinSet ? [o.pin, o.owner] : [o.owner, o.pin]));
    return false;
  }
  o.pinSet = true;
  dev.teamId = teamId; dev.who = o.owner; dev.live = true;
  actLog(dev.label, o.owner, "claimed " + o.name);
  return true;
}
// The only ungated route to a commissioner session is a commissioner control that gates on
// tap — Rules → Edit. Everything else (#finalizeBtn, "Process now") only RENDERS once
// unlocked, so this is the door.
async function unlockCommish(dev) {
  if (dev.commish) return true;
  await nav(dev, "rules");
  if (!(await waitFor(dev, "#rulesEdit", 9000))) { fail("commish.entry", "Rules page never offered #rulesEdit on " + dev.label); return false; }
  await answers(dev, [COMMISH_PIN]);
  await clickSel(dev, "#rulesEdit");
  await sleep(SETTLE);
  const unlocked = await ev(dev, () => window.__GFFL__.LG.commishUnlocked());
  if (!unlocked) {
    const alerts = await ev(dev, () => window.__alerts);
    fail("commish.unlock", dev.label + " was refused the commissioner PIN (alerts: " + JSON.stringify(alerts) + ")",
      "Rules → Edit → PIN " + COMMISH_PIN);
    return false;
  }
  await clickSel(dev, "#rulesCancel");
  dev.commish = true;
  actLog(dev.label, dev.who, "unlocked commissioner");
  return true;
}

// =========================================================================================
//                                  THE INVARIANT ENGINE
// =========================================================================================
// Everything below reads the SHARED STORE directly (Node side) plus one page for the DOM
// sweep. It runs after every phase, not just every week — a corruption that is repaired by
// the next phase is still a corruption, and only a per-phase sweep can attribute it.

const LEDGER = {
  // Every claim the harness SUBMITTED, with the bid it typed. This is what catches the
  // read-after-close class: the assertion is "the bid I typed is the bid that persisted",
  // which no amount of internally-consistent-but-zero data can satisfy.
  claims: [],        // {week, teamId, addKey, addName, bid, dev}
  faAdds: [],        // {week, teamId, addKey, dropKey, dev}
  expectPush: [],    // {kind, team|all, since, note}
};
const WEEKLY_HASH = new Map();   // weekly doc id -> sha of its first-seen content
const BRACKET_SEEN = { games: new Map(), champion: null };
const CLAIM_LANDING_SEEN = new Set();
const FINALIZE_VIEW = new Map();  // week -> the finalizing device's own cached view of every lineup
const ROSTER_WRITE_VIA = [];      // {dev, week, teamId, via} — which FUNCTION wrote each roster
// ADVISORIES are findings the sim is confident about but which it will NOT fail a season for,
// because the gesture that produced them is not one a person can actually make. They are
// printed in their own section with the evidence both ways — a latent hazard reported honestly
// is worth more than a red run nobody can act on.
const ADVISORIES = [];

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
};
const hashDoc = (d) => crypto.createHash("sha256").update(JSON.stringify(canon(d))).digest("hex").slice(0, 16);

// The roster in force for (week, team): the doc for that week, else the newest earlier one —
// exactly what LG.ensureRoster resolves to.
function effectiveRoster(week, teamId) {
  for (let w = week; w >= 1; w--) {
    const d = sdoc("roster_" + SEASON + "_w" + w + "_t" + teamId);
    if (d && Array.isArray(d.players)) return { week: w, players: d.players };
  }
  return null;
}

// ---- (a) FAAB conservation.
function sweepFaab(week) {
  // Authoritative spend: every WINNING bid on every processed week's own processing record.
  const spend = {}, byWeek = {};
  for (let w = 1; w <= 18; w++) {
    const doc = sdoc("claims_" + SEASON + "_w" + w);
    if (!doc || !doc.processed) continue;
    const byId = new Map((doc.claims || []).map((c) => [c.id, c]));
    for (const r of (doc.results || [])) {
      if (!r || !r.ok) continue;
      const c = byId.get(r.id);
      if (!c) { fail("faab.record", "week " + w + " has a WINNING result with no matching claim (" + r.id + ")"); continue; }
      spend[c.teamId] = (spend[c.teamId] || 0) + (Number(c.bid) || 0);
      (byWeek[c.teamId] = byWeek[c.teamId] || []).push("w" + w + " $" + c.bid);
    }
  }
  for (let t = 1; t <= 8; t++) {
    const td = sdoc("team_" + t) || {};
    const faab = td.faab == null ? FAAB_BUDGET : Number(td.faab);
    const want = FAAB_BUDGET - (spend[t] || 0);
    // The arithmetic, week by week, plus who wrote the team doc — a purse that disagrees with
    // the record is either a deduction with no win behind it or a win with no record left, and
    // only the per-week breakdown tells you which.
    check(faab === want, "faab.conservation",
      "team " + t + " (" + OWNER_NAMES[t - 1][0] + "): budget " + FAAB_BUDGET + " − won bids " + (spend[t] || 0) + " = " + want +
      ", but the team doc says " + faab + " (" + (want - faab) + " unaccounted). Per week: " +
      (byWeek[t] && byWeek[t].length ? byWeek[t].join(", ") : "no winning claims on record") + "." + writeHistory("team_" + t),
      "read STORE team_" + t + ".faab against every processed claims_" + SEASON + "_w*.results");
    check(faab >= 0, "faab.nonNegative", "team " + t + " FAAB is " + faab);
  }
  // ⭐ THE TYPED-BID CHECK — the lifecycle half, and the reason this simulator exists. Every
  // claim the harness submitted must exist as a doc carrying the bid that was TYPED into
  // #claimBid, not a bid of 0. Two rules, because the chaos owner legitimately produces MORE
  // docs than typed bids (a double-tapped #claimGo is one intention and can be two documents,
  // and the same owner racing two phones is two intentions on one player):
  //   · every typed bid must be findable as a stored bid on that (week, team, player);
  //   · every stored bid must be one somebody typed — a $0 that nobody typed is the bug.
  //
  // ⭐ RESTAGED 2026-08-11, and the reason is worth keeping. Both rules above compared the
  // TYPED figure to the STORED one, and that was only ever true because money leaked: the FAAB
  // lost update (season-sim bug 3) kept restoring spends, so no purse ever ran low enough for
  // the app's own bid clamp to bite. With the deductions made real, the chaos owner spends down
  // to a dollar and the app correctly clamps — `Math.max(0, Math.min(LG.teamFaab(T), rawBid))`,
  // with the same figure on the input's own `max` attribute — and the old rules called every one
  // of those a lost input (measured: 1654 false failures across one season, every incident the
  // same team, every stored bid exactly its remaining $1).
  //   So the expectation is the CLAMPED bid. `cap` is READ OFF THE CARD at the moment of typing,
  // never recomputed here, so this still measures the product rather than agreeing with it — and
  // the check keeps all of its teeth: a $0 nobody typed, a bid that silently became something
  // else, or an input lost to the modal close all still fail.
  const byTarget = new Map();
  for (const c of LEDGER.claims) {
    const k = c.week + "|" + c.teamId + "|" + c.addKey;
    if (!byTarget.has(k)) byTarget.set(k, { typed: [], any: c });
    byTarget.get(k).typed.push(expectedBid(c.bid, c.cap));
  }
  for (const [k, e] of byTarget) {
    const [wk, tid, addKey] = [Number(k.split("|")[0]), Number(k.split("|")[1]), k.split("|").slice(2).join("|")];
    const processed = sdoc("claims_" + SEASON + "_w" + wk);
    // Once a week is processed the per-claim docs are deleted; the processing record carries
    // the snapshot it actually resolved, which is the same evidence one layer on.
    const live = slist("claim").filter((d) => d.week === wk && d.teamId === tid && d.addKey === addKey);
    const snap = ((processed && processed.claims) || []).filter((x) => x.teamId === tid && x.addKey === addKey);
    const stored = (live.length ? live : snap).map((d) => ({ id: d.id || d.id, bid: Number(d.bid) }));
    if (!stored.length) continue; // not written yet, or cancelled — other invariants cover that
    for (const want of e.typed) {
      check(stored.some((s) => s.bid === want), "faab.bidPersisted",
        "week " + wk + " " + e.any.dev + " should have stored $" + want + " for " + e.any.addName +
        " (typed $" + e.any.bid + ", purse cap $" + e.any.cap + ")" +
        " but the stored bids for that player are " + JSON.stringify(stored.map((s) => s.bid)),
        "type " + e.any.bid + " into #claimBid FIRST, then pick a drop row, then press #claimGo — then read claim_" + SEASON + "_w" + wk + "_*");
    }
    for (const s of stored) {
      check(e.typed.includes(s.bid), "faab.bidInvented",
        "week " + wk + " team " + tid + " has a stored bid of $" + s.bid + " for " + e.any.addName +
        " that nobody asked for (expected, after the purse clamp: " + JSON.stringify(e.typed) + ")",
        "a bid nobody entered is either a lost input or a default that leaked — read claim_" + SEASON + "_w" + wk + "_*");
    }
  }
}

// ---- (b) roster conservation.
function sweepRosters(week) {
  const owner = new Map();
  for (let t = 1; t <= 8; t++) {
    const r = effectiveRoster(week, t);
    if (!r) { fail("roster.exists", "team " + t + " has no roster at or before week " + week); continue; }
    check(r.players.length >= ROSTER_SIZE && r.players.length <= ROSTER_CAP, "roster.size",
      "team " + t + " carries " + r.players.length + " players at week " + week +
      " (band is draft 16 ≤ n ≤ cap 19 = 16 slots + 3 IR; see the RESTAGED note at ROSTER_CAP)",
      "read STORE roster_" + SEASON + "_w" + r.week + "_t" + t);
    const seen = new Set();
    for (const p of r.players) {
      if (seen.has(p.key)) fail("roster.dupWithinTeam", "team " + t + " lists " + p.key + " twice at week " + week);
      seen.add(p.key);
      if (owner.has(p.key)) {
        fail("roster.dupAcrossTeams",
          p.key + " (" + (p.name || "?") + ") is on BOTH team " + owner.get(p.key) + " and team " + t + " at week " + week,
          "read roster_" + SEASON + "_w*_t" + owner.get(p.key) + " and _t" + t);
      } else owner.set(p.key, t);
    }
  }
  // A won claim must have LANDED — checked ONCE, at the first sweep after the week processed.
  // Deliberately not re-asserted forever: a player won on Wednesday can legitimately be
  // dropped again on Thursday's free agency, so "he is still on the roster in December" is a
  // statement about later moves, not about whether the waiver run worked.
  for (let w = 1; w <= week; w++) {
    const doc = sdoc("claims_" + SEASON + "_w" + w);
    if (!doc || !doc.processed) continue;
    if (CLAIM_LANDING_SEEN.has(w)) continue;
    CLAIM_LANDING_SEEN.add(w);
    const byId = new Map((doc.claims || []).map((c) => [c.id, c]));
    for (const r of (doc.results || [])) {
      if (!r || !r.ok) continue;
      const c = byId.get(r.id);
      if (!c) continue;
      const eff = effectiveRoster(w, c.teamId);
      if (!eff) continue;
      const keys = eff.players.map((p) => p.key);
      const rid = "roster_" + SEASON + "_w" + w + "_t" + c.teamId;
      check(keys.includes(c.addKey), "roster.claimAdded",
        "team " + c.teamId + " won " + flat(c.addName) + " in week " + w + " but he is not on the week-" + w + " roster." + writeHistory(rid),
        "read claims_" + SEASON + "_w" + w + " results, then " + rid);
      check(!keys.includes(c.dropKey), "roster.claimDropped",
        "team " + c.teamId + " won " + flat(c.addName) + " in week " + w + " but the dropped " + flat(c.dropName) + " is still on the roster." + writeHistory(rid));
    }
  }
  // Every FA add the harness performed must have landed too.
  for (const a of LEDGER.faAdds) {
    if (a.verified) continue;
    const eff = effectiveRoster(a.week, a.teamId);
    if (!eff) continue;
    const keys = eff.players.map((p) => p.key);
    check(keys.includes(a.addKey), "roster.faAdded",
      "week " + a.week + " " + a.dev + " added " + a.addName + " through the FA card but he is not on team " + a.teamId + "'s roster",
      "Moves → the free-agent table's own MOVE button → pick a drop → #claimGo");
    a.verified = true;
  }
}

// ---- (c) write-once.
function sweepWriteOnce() {
  for (const [id, d] of Object.entries(STORE.docs)) {
    if (!/^weekly_/.test(id)) continue;
    const h = hashDoc(d);
    if (!WEEKLY_HASH.has(id)) { WEEKLY_HASH.set(id, h); continue; }
    check(WEEKLY_HASH.get(id) === h, "writeOnce.weekly",
      id + " CHANGED after it was written (a weekly doc is the permanent record standings, seeding and the record book all derive from)",
      "diff STORE." + id + " against its first-seen content");
  }
  // A bracket legitimately GROWS (advanceBracket fills slots) — so the invariant is that
  // nothing already decided is ever re-decided.
  const b = sdoc("bracket_" + SEASON);
  if (b && b.rounds) {
    for (const rk of ["r1", "r2", "r3"]) {
      for (const g of (b.rounds[rk] || [])) {
        const prev = BRACKET_SEEN.games.get(g.id);
        if (prev) {
          if (prev.home != null) check(g.home === prev.home, "writeOnce.bracket", "bracket game " + g.id + " home changed " + prev.home + " → " + g.home);
          if (prev.away != null) check(g.away === prev.away, "writeOnce.bracket", "bracket game " + g.id + " away changed " + prev.away + " → " + g.away);
        }
        BRACKET_SEEN.games.set(g.id, { home: g.home, away: g.away });
      }
    }
    if (BRACKET_SEEN.champion != null && b.champion != null) {
      check(b.champion === BRACKET_SEEN.champion, "writeOnce.champion",
        "the champion changed from team " + BRACKET_SEEN.champion + " to team " + b.champion);
    }
    if (b.champion != null) BRACKET_SEEN.champion = b.champion;
  }
}

// ---- (d) independent re-derivation of the standings.
async function sweepStandings(dev, week) {
  const mine = {};
  for (let t = 1; t <= 8; t++) mine[t] = { w: 0, l: 0, t: 0, pf: 0, pa: 0 };
  for (let w = 1; w <= SEASON_WEEKS; w++) {
    const d = sdoc("weekly_" + SEASON + "_w" + w);
    if (!d) continue;
    for (const m of (d.matchups || [])) {
      const h = mine[m.home], a = mine[m.away];
      if (!h || !a) continue;
      const hp = Number(m.homePts) || 0, ap = Number(m.awayPts) || 0;
      h.pf += hp; h.pa += ap; a.pf += ap; a.pa += hp;
      if (hp > ap) { h.w++; a.l++; } else if (ap > hp) { a.w++; h.l++; } else { h.t++; a.t++; }
    }
  }
  const theirs = dev ? await ev(dev, () => window.__GFFL__.LG.loadStandings()) : null;
  if (!theirs) return;
  for (let t = 1; t <= 8; t++) {
    const A = mine[t], B = theirs[t] || {};
    const r = (x) => Math.round(x * 100) / 100;
    const same = A.w === B.w && A.l === B.l && A.t === B.t && r(A.pf) === r(B.pf) && r(A.pa) === r(B.pa);
    check(same, "standings.rederive",
      "team " + t + ": harness says " + A.w + "-" + A.l + "-" + A.t + " PF " + r(A.pf) + " PA " + r(A.pa) +
      ", the app says " + B.w + "-" + B.l + "-" + B.t + " PF " + r(B.pf) + " PA " + r(B.pa),
      "recompute from every weekly_" + SEASON + "_w* in the store and diff against LG.loadStandings()");
  }
}

// ---- (d2) a finalized week's team total must be the sum of its starters' own scores.
// Not asked for by name, but it is the same idea one level down, and it is what would catch
// "half the roster scored 0 because the id resolver missed them".
function sweepWeeklyTotals(week) {
  for (let w = 1; w <= week; w++) {
    const d = sdoc("weekly_" + SEASON + "_w" + w);
    if (!d || d.checkedTotals) continue;
    for (const m of (d.matchups || [])) {
      for (const side of ["home", "away"]) {
        const tid = m[side];
        const eff = effectiveRoster(w, tid);
        if (!eff) continue;
        let sum = 0;
        const detail = [];
        for (const p of eff.players) {
          if (p.slot === "BENCH" || p.slot === "IR") continue;
          const s = scoreOfKey(p.key, w);
          sum += s;
          detail.push(p.slot + " " + flat(p.name) + " " + s);
        }
        sum = Math.round(sum * 100) / 100;
        const got = Number(m[side + "Pts"]);
        // A bare "the numbers differ" is unactionable, and the difference is always either a
        // LINEUP disagreement (which roster was scored) or a SCORING one (which stat line was
        // read) — so the failure prints the lineup it scored and which roster doc it came from.
        // The two candidate explanations, separated: the finalizing device scored a DIFFERENT
        // lineup (a cache disagreement), or it scored the same lineup differently (a scoring
        // disagreement). The captured view answers it outright.
        const storeLineup = eff.players.filter((p) => p.slot !== "BENCH" && p.slot !== "IR").map((p) => p.slot + ":" + p.key);
        const devLineup = (FINALIZE_VIEW.get(w) || {})[tid] || null;
        const lineupDiff = devLineup && JSON.stringify([...devLineup].sort()) !== JSON.stringify([...storeLineup].sort());
        check(Math.abs(sum - got) < 0.02, "weekly.totalsMatchRosters",
          "week " + w + " team " + tid + ": the harness scores the roster of record at " + sum + ", the weekly doc says " + got +
          " (Δ " + (Math.round((got - sum) * 100) / 100) + "). " +
          (lineupDiff
            ? "THE FINALIZING DEVICE SCORED A DIFFERENT LINEUP — its own cached read said [" + devLineup.join(", ") +
              "] while the store's roster of record says [" + storeLineup.join(", ") + "]"
            : "The lineups agree, so the disagreement is in the SCORING, not the roster") +
          "; roster of record = roster_" + SEASON + "_w" + eff.week + "_t" + tid + "; starters: " + detail.join(" | "),
          "sum nodeScore(statRow(pid, " + w + ")) over the non-bench slots of roster_" + SEASON + "_w" + eff.week + "_t" + tid);
      }
    }
    Object.defineProperty(d, "checkedTotals", { value: true, enumerable: false });
  }
}

// ---- (e) DOM sweep.
const BAD_TEXT = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object Object\]/;
async function sweepDom(dev, week) {
  if (!dev || !dev.live) return;
  // THE OBSERVER IS ONE OF THE DEVICES. Rendering four views is exactly what an owner does,
  // and it goes through loadWeekRosters like any other render — so the sweep can itself write
  // roster docs. That is realistic rather than a flaw, but it must never be mistaken for a
  // persona's doing, so every write it causes is stamped with this phase name and shows up
  // labelled in the write history a failure prints.
  const realPhase = CUR.phase;
  CUR.phase = realPhase + "/observer-render";
  try { await sweepDomViews(dev, week); } finally { CUR.phase = realPhase; }
}
async function sweepDomViews(dev, week) {
  const views = [
    ["league", async () => { await nav(dev, "league"); }],
    ["matchup", async () => { await nav(dev, "league"); await clickSel(dev, ".mucard"); await sleep(SETTLE); }],
    ["moves", async () => { await nav(dev, "moves"); }],
    ["locker", async () => { await ev(dev, () => window.__GFFL__.UI.openLocker(window.__GFFL__.LG.myTeamId())); await sleep(SETTLE); }],
  ];
  for (const [name, go] of views) {
    await go();
    const res = await ev(dev, () => {
      const main = document.querySelector("main");
      const txt = main ? main.innerText : "";
      const hdr = document.querySelector("header");
      return { txt, headerH: hdr ? Math.round(hdr.getBoundingClientRect().height) : 0,
        docW: document.documentElement.scrollWidth, winW: window.innerWidth };
    });
    if (!res) continue;
    const hit = BAD_TEXT.exec(res.txt || "");
    check(!hit, "dom.noBadText",
      "the " + name + " view renders \"" + (hit ? hit[0] : "") + "\" at week " + week,
      "open " + name + " and read main.innerText — context: …" +
      String(res.txt || "").slice(Math.max(0, (hit ? hit.index : 0) - 60), (hit ? hit.index : 0) + 60).replace(/\s+/g, " ") + "…");
    check(res.docW <= res.winW + 1, "dom.noSidewaysScroll",
      "the " + name + " view scrolls sideways at 390px (" + res.docW + " > " + res.winW + ")");
    // The known-capped headers (playtest batches 2 and 3 measured these down and they must
    // not creep back up as the season accumulates content).
    check(res.headerH > 0 && res.headerH < 140, "dom.headerHeight",
      "the header measured " + res.headerH + "px on " + name + " (capped by design)");
  }
}

// ---- (f) push ledger.
function sweepPushes(week) {
  const drained = drainPushes();
  for (const p of drained) {
    const pay = p.payload || {};
    check(pay.secret === PASS && pay.familyKey === FAM, "push.envelope",
      "a push left with the wrong secret/family (" + JSON.stringify({ s: pay.secret, f: pay.familyKey }) + ")");
    check(!!pay.title && !!pay.body, "push.body", "a push left with no title/body: " + JSON.stringify(pay).slice(0, 160));
    // No self-push: the device that acted must never be the audience.
    const dev = DEVICES.find((d) => d.label === p.dev);
    if (dev && pay.gfflTeam != null) {
      check(Number(pay.gfflTeam) !== Number(dev.teamId), "push.noSelf",
        p.dev + " (team " + dev.teamId + ") sent itself a push: " + pay.title,
        "the actor is looking at the screen — LG.pushTeam's own rule");
    }
    if (pay.gfflAll && dev && pay.excludeTeam != null) {
      check(Number(pay.excludeTeam) === Number(dev.teamId), "push.excludeActor",
        "a league-wide push from " + p.dev + " excluded team " + pay.excludeTeam + ", not the sender's own " + dev.teamId);
    }
  }
  // Everything the harness said SHOULD have pushed.
  for (const e of LEDGER.expectPush) {
    if (e.done) continue;
    const hit = drained.find((p) => {
      const pay = p.payload || {};
      if (e.all) return !!pay.gfflAll;
      return Number(pay.gfflTeam) === Number(e.team);
    });
    check(!!hit, "push.produced",
      e.kind + " should have pushed " + (e.all ? "the league" : "team " + e.team) + " (week " + e.week + ") and did not",
      e.note);
    e.done = true;
  }
  LEDGER.expectPush.length = 0;
}

// ---- (g) console + page errors.
function sweepErrors() {
  for (const d of DEVICES) {
    for (const e of d.errors.splice(0)) {
      fail("errors.pageError", d.label + " threw during [w" + e.week + " " + e.phase + "]: " + e.msg);
    }
    for (const e of d.consoleErrors.splice(0)) {
      fail("errors.console", d.label + " logged an error during [w" + e.week + " " + e.phase + "]: " + e.msg);
    }
  }
}

let SWEEPS = 0;
async function sweep(phase, week, domDev) {
  CUR = { week, phase };
  SWEEPS++;
  const before = FAILURES.length;
  sweepErrors();
  sweepFaab(week);
  sweepRosters(week);
  sweepWriteOnce();
  sweepWeeklyTotals(week);
  sweepPushes(week);
  await sweepStandings(domDev, week);
  await sweepDom(domDev, week);
  sweepErrors(); // the DOM sweep itself renders four views — attribute anything it triggered
  // Attribute every roster write this phase made to the function that made it. Drained each
  // sweep so a failure's own detail can name the call site rather than the device alone.
  for (const d of DEVICES) {
    if (!d.live) continue;
    const w = await ev(d, () => { const o = window.__rosterWrites || []; window.__rosterWrites = []; return o; });
    for (const x of (w || [])) ROSTER_WRITE_VIA.push({ dev: d.label, week: x.week, teamId: x.teamId, via: x.via, phase, sweepWeek: week });
  }
  const added = FAILURES.length - before;
  log("  · sweep w" + week + "/" + phase + ": " + (added ? added + " FAILURE(S)" : "clean") + " (" + CHECKS + " checks so far)");
  ACTIONS = [];
}

// =========================================================================================
//                                     PERSONA ACTIONS
// =========================================================================================

// ---- lineup: a real Swap through the locker's own button and the centered #rosterCard.
async function doLineup(dev) {
  const o = OWNERS[dev.teamId - 1];
  await ev(dev, () => window.__GFFL__.UI.openLocker(window.__GFFL__.LG.myTeamId()));
  if (!(await waitFor(dev, ".lockerhead", 9000))) { noop(dev, "lineup", "the locker never rendered"); return; }
  const swaps = rint(1, 2);
  for (let i = 0; i < swaps; i++) {
    // A starter slot whose Swap button is live. Clicking it opens the card; the card lists
    // eligible bench candidates as .swaprow[data-ci].
    const opened = await ev(dev, () => {
      const btns = [...document.querySelectorAll(".lrow .lswap:not(.lswapfill):not([disabled])")];
      if (!btns.length) return false;
      btns[Math.floor(Math.random() * btns.length)].click();
      return true;
    });
    if (!opened) { noop(dev, "lineup", "no live Swap button on any starter row"); break; }
    if (!(await waitFor(dev, "#rosterCard", 6000))) { noop(dev, "lineup", "the swap card never opened"); break; }
    await sleep(SETTLE);
    const picked = await ev(dev, () => {
      const rows = [...document.querySelectorAll("#rosterCard [data-ci]")].filter((b) => b.dataset.ci !== "" && !b.disabled);
      if (!rows.length) { const c = document.querySelector("#rosterCard .rcghost"); if (c) c.click(); return false; }
      rows[Math.floor(Math.random() * rows.length)].click();
      return true;
    });
    await sleep(SETTLE);
    if (picked) { COVER.lineup++; actLog(dev.label, o.owner, "swapped a starter"); }
  }
}

// ---- moves: a blind claim with a typed FAAB bid, through the real free-agent table.
async function doClaim(dev, week) {
  const o = OWNERS[dev.teamId - 1];
  await nav(dev, "moves");
  if (!(await waitFor(dev, "#faResults", 12000))) { noop(dev, "claim", "the free-agent table never rendered"); return null; }
  // The position chip row and the Available/All ownership row are BOTH .poschip; the position
  // one carries data-pos. Reaching for the wrong "All" quietly showed rostered players and made
  // every row's button disabled.
  await ev(dev, () => { const c = document.querySelector('.poschip[data-pos="ALL"]'); if (c) c.click(); });
  await sleep(SETTLE);
  const target = await ev(dev, () => {
    const rows = [...document.querySelectorAll("#faResults tr[data-pk]")].filter((r) => {
      const b = r.querySelector(".faMoveBtn");
      return b && !b.disabled;
    });
    if (!rows.length) return null;
    const row = rows[Math.floor(Math.random() * rows.length)];
    const nameEl = row.querySelector(".pname b") || row.querySelector("td");
    return { pk: row.dataset.pk, name: nameEl ? nameEl.textContent.trim() : row.dataset.pk };
  });
  if (!target) {
    const why = await ev(dev, () => ({ rows: document.querySelectorAll("#faResults tr[data-pk]").length,
      btns: document.querySelectorAll("#faResults .faMoveBtn").length,
      live: document.querySelectorAll("#faResults .faMoveBtn:not([disabled])").length }));
    noop(dev, "claim", "no addable free agent " + JSON.stringify(why));
    return null;
  }
  const bid = rint(1, 18);
  const clicked = await ev(dev, (pk) => {
    const row = document.querySelector('#faResults tr[data-pk="' + CSS.escape(pk) + '"]');
    if (!row) return false;
    const b = row.querySelector(".faMoveBtn");
    if (!b || b.disabled) return false;
    b.click(); return true;
  }, target.pk);
  if (!clicked) { noop(dev, "claim", "the MOVE button vanished between read and tap"); return null; }
  if (!(await waitFor(dev, "#rosterCard [data-di]", 6000))) { noop(dev, "claim", "the claim card never opened"); return null; }
  // Type the bid into the REAL input, then pick a drop, then submit — in that order, which is
  // the order a person does it in and the order the lifecycle bug lived in.
  await clearToasts(dev);
  // ⭐ THE CAP IS READ FROM THE CARD, not recomputed here (restaged 2026-08-11 — see
  // expectedBid below). #claimBid carries max="<the team's remaining FAAB>", which is the same
  // figure the handler clamps against, so reading the attribute records what the app itself
  // was offering at the instant the bid was typed.
  const cap = await ev(dev, (v) => {
    const i = document.querySelector("#claimBid");
    if (!i) return null;
    i.value = String(v);
    i.dispatchEvent(new Event("input", { bubbles: true }));
    const m = Number(i.getAttribute("max"));
    return Number.isFinite(m) ? m : null;
  }, bid);
  // NEVER DROP A STARTER, and never fall back to one. The app happily lets you (an empty
  // starter slot is legal), but a persona that does it degrades every later week's lineup and
  // makes the roster-of-record checks measure the harness's own carelessness instead of the
  // product. The chaos owner is the one allowed to be careless.
  const dropped = await ev(dev, () => {
    const benchy = [...document.querySelectorAll("#rosterCard [data-di]")].filter((r) => /BENCH/i.test(r.textContent));
    if (!benchy.length) return false;
    benchy[Math.floor(Math.random() * benchy.length)].click();
    return true;
  });
  if (!dropped) { await clickSel(dev, "#claimCancel"); noop(dev, "claim", "no bench player to drop"); return null; }
  await sleep(80);
  await clickSel(dev, "#claimGo");
  await sleep(SETTLE);
  // ⭐ THE LIFECYCLE CHECK, AT THE UI LAYER. The claim toast quotes the bid back — so if the
  // input were read after the modal close emptied it (the exact bug this whole simulator was
  // commissioned for), the SCREEN would say "$0" while the ledger says "$N". This catches it
  // one layer above the store, independently of the doc check in sweepFaab.
  const tl = (await toasts(dev)) || [];
  const claimToast = tl.find((t) => /Claim submitted/i.test(t));
  const nm = flat(target.name);
  if (!claimToast) {
    check(false, "claim.saidSomething",
      "week " + week + " " + dev.label + " submitted a claim for " + nm + " and the app said NOTHING (toasts: " + JSON.stringify(tl) + ")",
      "Moves → MOVE button → type a bid → pick a drop → #claimGo");
    return null;
  }
  const want = expectedBid(bid, cap);
  check(new RegExp("\\$" + want + "\\b").test(claimToast), "claim.bidOnScreen",
    "week " + week + " " + dev.label + " typed $" + bid + " (purse cap $" + cap + ", so the app should say $" + want +
    ") but the confirmation reads \"" + claimToast + "\"",
    "type " + bid + " into #claimBid BEFORE picking the drop row, then press #claimGo");
  LEDGER.claims.push({ week, teamId: dev.teamId, addKey: target.pk, addName: nm, bid, cap, dev: dev.label });
  actLog(dev.label, o.owner, "claimed " + nm + " for $" + want + (want !== bid ? " (typed $" + bid + ", capped by the purse)" : ""));
  return { key: target.pk, name: nm, bid: want };
}

// ---- free agency: the same card, post-deadline (the button reads "Add" and adds instantly).
async function doFaAdd(dev, week) {
  const o = OWNERS[dev.teamId - 1];
  await nav(dev, "moves");
  if (!(await waitFor(dev, "#faResults", 12000))) { noop(dev, "faAdd", "the free-agent table never rendered"); return null; }
  await ev(dev, () => { const c = document.querySelector('.poschip[data-pos="ALL"]'); if (c) c.click(); });
  await sleep(SETTLE);
  const target = await ev(dev, () => {
    const rows = [...document.querySelectorAll("#faResults tr[data-pk]")].filter((r) => {
      const b = r.querySelector(".faMoveBtn");
      return b && !b.disabled;
    });
    if (!rows.length) return null;
    const row = rows[Math.floor(Math.random() * rows.length)];
    const nameEl = row.querySelector(".pname b") || row.querySelector("td");
    return { pk: row.dataset.pk, name: nameEl ? nameEl.textContent.trim() : row.dataset.pk };
  });
  if (!target) { noop(dev, "faAdd", "no addable free agent"); return null; }
  await ev(dev, (pk) => {
    const row = document.querySelector('#faResults tr[data-pk="' + CSS.escape(pk) + '"]');
    const b = row && row.querySelector(".faMoveBtn");
    if (b && !b.disabled) b.click();
  }, target.pk);
  if (!(await waitFor(dev, "#rosterCard [data-di]", 6000))) { noop(dev, "faAdd", "the add card never opened"); return null; }
  const drop = await ev(dev, () => {   // bench only — see doClaim's note
    const benchy = [...document.querySelectorAll("#rosterCard [data-di]")].filter((r) => /BENCH/i.test(r.textContent));
    if (!benchy.length) return null;
    benchy[0].click();
    return benchy[0].textContent.trim().slice(0, 40);
  });
  if (!drop) { await clickSel(dev, "#claimCancel"); noop(dev, "faAdd", "no bench player to drop"); return null; }
  await sleep(80);
  await clearToasts(dev);
  await clickSel(dev, "#claimGo");
  await sleep(SETTLE);
  // A REFUSAL IS CORRECT BEHAVIOUR, SILENCE IS NOT. The free-agent table is painted from
  // UI._rosters, which can legitimately be one waiver run out of date, so "that player is
  // already owned" is the app being right — and it must SAY so. The invariant is therefore
  // three-way: added (and it landed) / refused (with a reason on screen) / silent (a bug).
  const tl = (await toasts(dev)) || [];
  const nm = flat(target.name);
  const added = tl.find((t) => /^Added /i.test(t));
  const refused = tl.find((t) => /Couldn't add/i.test(t));
  if (added) {
    LEDGER.faAdds.push({ week, teamId: dev.teamId, addKey: target.pk, addName: nm, dropText: drop, dev: dev.label });
    actLog(dev.label, o.owner, "FA-added " + nm);
    return target;
  }
  if (refused) {
    check(!/undefined|NaN|:\s*$/.test(refused), "faAdd.refusalHasReason",
      "the FA add was refused with an unreadable reason: \"" + refused + "\"");
    noop(dev, "faAdd", "refused: " + refused);
    return null;
  }
  check(false, "faAdd.saidSomething",
    "week " + week + " " + dev.label + " submitted an FA add for " + nm + " and the app said NOTHING (toasts: " + JSON.stringify(tl) + ")",
    "Moves → MOVE button (post-deadline it reads \"Add\") → pick a drop → #claimGo");
  return null;
}

// ---- a trade: offer → counter → accept (or veto), all through the real builder.
async function doTradeRound(devs, week) {
  if (devs.length < 2) { noop(devs[0], "trade", "fewer than two devices are live"); return; }
  const proposer = devs[0], target = devs[1];
  await nav(proposer, "moves");
  if (!(await waitFor(proposer, "#mvTradeCard", 12000))) { noop(proposer, "trade", "the trade builder never rendered"); return; }
  await ev(proposer, (tid) => {
    const sel = document.querySelector("#mvTradeTeam");
    if (!sel) return;
    sel.value = String(tid);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, target.teamId);
  await sleep(SETTLE);
  // Expand both sides (they ship COLLAPSED — item 20) and pick one player each.
  for (const side of ["give", "get"]) {
    await ev(proposer, (s) => {
      const b = document.querySelector("#mv" + (s === "give" ? "Give" : "Get") + " .tradeadd");
      if (b) b.click();
    }, side);
    await sleep(120);
    // RESTAGED 2026-08-17 (second pass, same day as the three-guard ruling): a fully random
    // pick made a WHOLE SEASON execute zero trades — all 11 attempts drew a mid-game player
    // and refused, which starved coverage.trade and left the executed-trade path (the roster
    // swap, both pushes) unexercised for the entire run. Real owners do what this does now:
    // pick someone who hasn't kicked off. PREFER a clock-clean chip (the same
    // LG.data.gameStarted truth the guard reads), FALL BACK to random when none is clean —
    // the fallback keeps the refusal path genuinely exercised too, just not exclusively.
    const okPick = await ev(proposer, (s) => {
      const chips = [...document.querySelectorAll("#mv" + (s === "give" ? "Give" : "Get") + " .pickchip .pcpick")];
      if (!chips.length) return false;
      const LG = window.__GFFL__.LG;
      // UI._rosters is the composer's OWN data source for these chips (see renderMoves), so
      // resolving the chip's player through it can never disagree with what the chip shows.
      const started = (k) => {
        const R = window.__GFFL__.UI._rosters || {};
        for (const tid of Object.keys(R)) {
          const p = (R[tid] || []).find((x) => x.key === k);
          if (p) return !!(LG.data && LG.data.gameStarted && LG.data.gameStarted(p.team));
        }
        return false;
      };
      const clean = chips.filter((b) => !started(b.dataset.gk));
      const pool = clean.length ? clean : chips;
      pool[Math.floor(Math.random() * pool.length)].click();
      return true;
    }, side);
    if (!okPick) { noop(proposer, "trade", "the " + side + " side offered no pick chips"); return; }
    await sleep(120);
  }
  // RESTAGED 2026-08-17 (the three-guard trade ruling): the send is no longer unconditional.
  // This persona picks RANDOM players, and the new composer guard legitimately refuses a
  // player whose game is under way (or a cap/lineup break) with a toast and NO offer doc —
  // so "clicked send" stopped implying "offer exists", and expecting a push for a refused
  // offer is asserting the pre-ruling world. The store is the truth: only a grown trade_*
  // count is an offer. A refusal must still SAY something (same discipline as
  // claim.saidSomething) — a silent dead button is a real bug either way.
  const tradeDocs = () => Object.keys(STORE.docs).filter((k) => k.startsWith("trade_")).length;
  await clearToasts(proposer);
  const beforeSend = tradeDocs();
  await clickSel(proposer, "#mvTradeSend");
  await sleep(SETTLE + 120);
  if (tradeDocs() === beforeSend) {
    const said = ((await toasts(proposer)) || []).join(" | ");
    if (!said) {
      check(false, "trade.refusalSaidSomething",
        "week " + week + " " + proposer.label + " had a trade refused by a guard and the app said NOTHING",
        "Moves → pick players → #mvTradeSend");
    } else {
      COVER.tradeRefused = (COVER.tradeRefused || 0) + 1;
      noop(proposer, "trade", "composer guard refused the offer: " + said);
    }
    return;
  }
  LEDGER.expectPush.push({ kind: "trade offer", team: target.teamId, week,
    note: "Moves → pick a counterparty → expand both sides → pick a player each → #mvTradeSend" });
  COVER.trade++;
  actLog(proposer.label, proposer.who, "offered a trade to team " + target.teamId);

  // The receiver answers. Counter first (S7's chain), then the original proposer accepts it.
  await nav(target, "moves");
  await sleep(SETTLE);
  const countered = await clickSel(target, ".mvcounter");
  if (countered) {
    await sleep(SETTLE);
    // Same restage as the offer above: a counter rides the same composer and the same guards.
    await clearToasts(target);
    const beforeCounter = tradeDocs();
    await clickSel(target, "#mvTradeSend");
    await sleep(SETTLE + 120);
    if (tradeDocs() === beforeCounter) {
      const saidC = ((await toasts(target)) || []).join(" | ");
      if (!saidC) {
        check(false, "trade.refusalSaidSomething",
          "week " + week + " " + target.label + " had a counter refused by a guard and the app said NOTHING",
          "Moves → Counter → #mvTradeSend");
      } else {
        COVER.tradeRefused = (COVER.tradeRefused || 0) + 1;
        noop(target, "trade", "composer guard refused the counter: " + saidC);
      }
      return;
    }
    LEDGER.expectPush.push({ kind: "trade counter", team: proposer.teamId, week, note: "Moves → Counter → #mvTradeSend" });
    actLog(target.label, target.who, "countered the trade");
    // Now the ORIGINAL proposer is the receiver of the counter.
    await nav(proposer, "moves");
    await sleep(SETTLE);
    const vetoRound = rng() < 0.34;
    const accepted = await clickSel(proposer, ".mvaccept");
    if (accepted) {
      await sleep(SETTLE);
      LEDGER.expectPush.push({ kind: "trade accept", team: target.teamId, week, note: "Moves → Accept on the counter" });
      actLog(proposer.label, proposer.who, "accepted the counter");
      if (vetoRound) {
        // Two non-party owners veto (vetoVotes is seeded to 2 — design decision 5).
        let votes = 0;
        for (const d of devs.slice(2)) {
          await nav(d, "moves");
          await sleep(SETTLE);
          if (await clickSel(d, ".mvveto")) { votes++; actLog(d.label, d.who, "vetoed the trade"); await sleep(SETTLE); }
          if (votes >= 2) break;
        }
      }
    } else {
      await clickSel(proposer, ".mvdecline");
      actLog(proposer.label, proposer.who, "declined the counter");
      await sleep(SETTLE);
    }
  } else {
    const accepted = await clickSel(target, ".mvaccept");
    if (accepted) {
      LEDGER.expectPush.push({ kind: "trade accept", team: proposer.teamId, week, note: "Moves → Accept" });
      actLog(target.label, target.who, "accepted the trade");
    }
    await sleep(SETTLE);
  }
}

// ---- chat, including an @mention (which must push exactly the mentioned team).
async function doChat(dev, devs, week) {
  await nav(dev, "chat");
  if (!(await waitFor(dev, "#chatText", 9000))) { noop(dev, "chat", "the composer never rendered"); return; }
  const other = devs.find((d) => d.teamId !== dev.teamId);
  const mention = other ? "@" + OWNER_NAMES[other.teamId - 1][0] : "";
  const msg = pick(["good luck this week", "that lineup is a crime", "who benched their QB", "week " + week + " belongs to me"]);
  const text = (mention ? mention + " " : "") + msg;
  await ev(dev, (t) => {
    const el = document.querySelector("#chatText");
    if (!el) return;
    el.value = t;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
  await clickSel(dev, "#chatSend");
  await sleep(SETTLE);
  if (other) {
    LEDGER.expectPush.push({ kind: "chat @mention", team: other.teamId, week,
      note: "Chat → type \"" + text + "\" → #chatSend" });
  }
  COVER.chat++;
  actLog(dev.label, dev.who, "posted chat: " + text);
}

// =========================================================================================
//                                    THE CHAOS OWNER
// =========================================================================================
// One persona is deliberately pathological EVERY week. None of this may corrupt state — that
// is the whole point of the invariants above. Every action here is something a real, impatient
// person on a real phone does.
async function chaosRun(dev, week, phase, secondPhone) {
  if (!dev || !dev.live) return;
  const o = OWNERS[dev.teamId - 1];
  const menu = [
    // Double-tap submit — the classic phone mis-tap. REAL pointer clicks, not element.click():
    // a real second tap is hit-tested and the modal is already gone, which is the whole reason
    // this is the chaos owner's action and the programmatic form is only an advisory probe
    // (see probeLatentHazards).
    async () => {
      await nav(dev, "moves");
      if (!(await waitFor(dev, "#faResults", 9000))) return;
      const ok = await ev(dev, () => {
        const row = [...document.querySelectorAll("#faResults tr[data-pk]")].find((r) => { const b = r.querySelector(".faMoveBtn"); return b && !b.disabled; });
        if (!row) return null;
        row.querySelector(".faMoveBtn").click();
        return row.dataset.pk;
      });
      if (!ok || !(await waitFor(dev, "#rosterCard [data-di]", 5000))) return;
      const past = await ev(dev, () => !document.querySelector("#claimBid"));
      // The purse cap, read off the card exactly as doClaim reads it — the chaos owner is the
      // one who actually spends down to it, so this is the ledger row that most needs it.
      const cap7 = await ev(dev, () => {
        const i = document.querySelector("#claimBid");
        if (!i) return null;
        i.value = "7";
        const m = Number(i.getAttribute("max"));
        return Number.isFinite(m) ? m : null;
      });
      await ev(dev, () => { const r = document.querySelector("#rosterCard [data-di]"); if (r) r.click(); });
      const box = await ev(dev, () => {
        const g = document.querySelector("#claimGo");
        if (!g) return null;
        const b = g.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      if (box) { await dev.page.mouse.click(box.x, box.y).catch(() => {}); await dev.page.mouse.click(box.x, box.y).catch(() => {}); }
      await sleep(SETTLE);
      // Recorded in the SAME ledger as an ordinary claim: the chaos owner's bids are just as
      // real, and leaving them out made an honest duplicate look like a lost input.
      if (!past && box) LEDGER.claims.push({ week, teamId: dev.teamId, addKey: ok, addName: "(chaos double-tap)", bid: 7, cap: cap7, dev: dev.label });
      actLog(dev.label, o.owner, "CHAOS double-tapped the submit button");
    },
    // Open the claim card and Back out mid-flow — the modal must not leave the view behind.
    async () => {
      await nav(dev, "moves");
      if (!(await waitFor(dev, "#faResults", 9000))) return;
      await ev(dev, () => { const b = document.querySelector("#faResults tr[data-pk] .faMoveBtn:not([disabled])"); if (b) b.click(); });
      await waitFor(dev, "#rosterCard", 5000);
      await dev.page.goBack().catch(() => {});
      await sleep(SETTLE);
      const stuck = await ev(dev, () => {
        const ov = document.querySelector("#rosterCard");
        return !!(ov && !ov.hidden && ov.getBoundingClientRect().height > 0);
      });
      check(!stuck, "chaos.modalBack", "Back left the #rosterCard modal on screen (week " + week + ")",
        "Moves → a MOVE button → browser Back");
      actLog(dev.label, o.owner, "CHAOS backed out of the claim card");
    },
    // Cancel a PIN prompt: a commissioner control tapped and refused must change nothing.
    async () => {
      await nav(dev, "league");
      await answers(dev, []); // the queue is empty -> prompt() returns null, i.e. Cancel
      await ev(dev, async () => { try { await window.__GFFL__.LG.gateCommish(); } catch (e) {} });
      await sleep(SETTLE);
      const un = await ev(dev, () => window.__GFFL__.LG.commishUnlocked());
      check(un === false, "chaos.pinCancel", "cancelling the commissioner PIN prompt still unlocked " + dev.label,
        "LG.gateCommish() with prompt() returning null");
      actLog(dev.label, o.owner, "CHAOS cancelled a PIN prompt");
    },
    // Tab switch mid-render: navigate away the instant a heavy view starts painting.
    async () => {
      await ev(dev, () => { window.__GFFL__.UI.go("moves"); window.__GFFL__.UI.go("league"); window.__GFFL__.UI.go("chat"); });
      await sleep(SETTLE);
      await nav(dev, "league");
      actLog(dev.label, o.owner, "CHAOS thrashed the nav mid-render");
    },
    // Act exactly at the deadline boundary.
    async () => {
      await ev(dev, (ts) => { window.__GFFL__.LG.nowOverride = ts; }, waiverDeadline(week));
      await nav(dev, "moves");
      await sleep(SETTLE);
      await ev(dev, (ts) => { window.__GFFL__.LG.nowOverride = ts; }, waiverDeadline(week) - 60e3);
      actLog(dev.label, o.owner, "CHAOS acted on the deadline boundary");
    },
  ];
  await menu[rint(0, menu.length - 1)]();

  // THE RACE: the same owner, live in TWO contexts, both claiming the same free agent at once.
  // Neither device may corrupt the other's league — a duplicated claim doc is legitimate; a
  // lost bid, a negative purse or a doubled roster is not.
  if (secondPhone && phase === "claims") {
    const openFirst = (d) => (async () => {
      await nav(d, "moves");
      return ev(d, () => {
        const row = [...document.querySelectorAll("#faResults tr[data-pk]")].find((r) => { const b = r.querySelector(".faMoveBtn"); return b && !b.disabled; });
        if (!row) return null;
        row.querySelector(".faMoveBtn").click();
        return row.dataset.pk;
      });
    })();
    const [k1, k2] = await Promise.all([openFirst(dev), openFirst(secondPhone)]);
    await sleep(SETTLE);
    // Returns the purse cap the card was offering (or null if there was no bid input), so the
    // ledger row records the same ceiling the handler is about to clamp against.
    const submit = (d) => ev(d, () => {
      const i = document.querySelector("#claimBid"); if (i) i.value = "5";
      const cap = i ? Number(i.getAttribute("max")) : null;
      const r = document.querySelector("#rosterCard [data-di]"); if (r) r.click();
      const g = document.querySelector("#claimGo"); if (g) g.click();
      return i ? { ok: true, cap: Number.isFinite(cap) ? cap : null } : null;
    });
    const [s1, s2] = await Promise.all([submit(dev), submit(secondPhone)]);
    await sleep(SETTLE + 200);
    if (k1 && s1) LEDGER.claims.push({ week, teamId: dev.teamId, addKey: k1, addName: "(chaos race, phone 1)", bid: 5, cap: s1.cap, dev: dev.label });
    if (k2 && s2) LEDGER.claims.push({ week, teamId: secondPhone.teamId, addKey: k2, addName: "(chaos race, phone 2)", bid: 5, cap: s2.cap, dev: secondPhone.label });
    actLog(dev.label, o.owner, "CHAOS raced the same claim from two phones");
  }
}

// =========================================================================================
//                                   LATENT-HAZARD PROBES
// =========================================================================================
// Run ONCE, before the season. These are questions the season itself cannot ask — they need a
// gesture no person can make — so what they produce is an ADVISORY with the evidence both
// ways, never a season failure. A latent hazard is worth knowing about precisely because the
// next refactor is what makes it live.
async function probeLatentHazards(dev, week) {
  CUR = { week: 0, phase: "hazard-probe" };
  // HAZARD: #claimGo is not idempotent, and it reads #claimBid AFTER its own close has
  // emptied the card. The handler's own comment ("READ THE BID BEFORE CLOSING") records that
  // this exact failure was fixed once for the single-click case — by moving the read, not by
  // disarming the button. So a SECOND click on the same (now detached) button object re-runs
  // the handler with `chosen` still set and #claimBid gone, and files a duplicate claim at $0.
  await nav(dev, "moves");
  if (!(await waitFor(dev, "#faResults", 9000))) return;
  const key = await ev(dev, () => {
    const row = [...document.querySelectorAll("#faResults tr[data-pk]")].find((r) => { const b = r.querySelector(".faMoveBtn"); return b && !b.disabled; });
    if (!row) return null;
    row.querySelector(".faMoveBtn").click();
    return row.dataset.pk;
  });
  if (!key || !(await waitFor(dev, "#rosterCard [data-di]", 5000))) return;
  if (await ev(dev, () => !document.querySelector("#claimBid"))) return; // past the deadline: no bid to lose
  await ev(dev, () => { document.querySelector("#claimBid").value = "11"; document.querySelector("#rosterCard [data-di]").click(); });
  await clearToasts(dev);
  await ev(dev, () => { const g = document.querySelector("#claimGo"); g.click(); g.click(); });
  await sleep(SETTLE + 300);
  const tl = (await toasts(dev)) || [];
  const zero = tl.find((t) => /Claim submitted.*\$0\./.test(t));
  const docs = slist("claim").filter((d) => d.teamId === dev.teamId && d.addKey === key);
  if (zero || docs.some((d) => Number(d.bid) === 0)) {
    ADVISORIES.push({
      title: "#claimGo is not idempotent, and re-reads a bid input its own close destroyed",
      detail: "Two click events on the submit button inside ONE task file TWO claims for the same player — " +
        "the second at $0, because UI.closeRosterCard() has already emptied #rosterCard so `$(\"#claimBid\")` is null " +
        "and `Number(undefined) || 0` is 0. `chosen` is a closure variable and is still set, so the guard at the top " +
        "of the handler does not stop it. Toasts seen: " + JSON.stringify(tl),
      reach: "NOT reachable by a real double-tap — measured. A second REAL pointer tap is hit-tested and the button " +
        "is already detached from the DOM, so it never fires (verified: programmatic click()×2 files the $0 duplicate; " +
        "page.mouse.click()×2, at 0ms and at 60ms apart, file exactly one claim). It becomes live the moment anything " +
        "puts an await, an animation or a confirm step between the click and the close, or keeps the card mounted.",
      fix: "Disarm the control rather than relying on the read order: set `$(\"#claimGo\").disabled = true` as the " +
        "first statement of the handler (lg-ui.js ~4208). One line, and it closes the whole class rather than this instance.",
    });
  }
  // Clean up: whatever this probe filed is not part of the season's ledger.
  for (const d of docs) delete STORE.docs[d.id];
  await ev(dev, () => { try { window.__GFFL__.LG.db.clearCache(); } catch (e) {} });
}

// =========================================================================================
//                                      THE SEASON
// =========================================================================================
async function main() {
  banner("GFFL SEASON SIM — seed " + SEED + ", weeks " + WEEKS + (FAST ? ", fast" : ""));
  buildUniverse();
  seedStore();
  log("universe: " + PLAYERS.size + " players, 8 teams × " + ROSTER_SIZE + ", " + SEASON_WEEKS + "-week schedule");

  const srv = await startStatic();
  const exe = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"].find((c) => c && fs.existsSync(c));
  const browser = await puppeteer.launch(
    exe ? { headless: true, executablePath: exe, args: ["--no-sandbox"] }
        : { headless: true, channel: "chrome", args: ["--no-sandbox"] });

  const D = [];
  for (let i = 0; i < 4; i++) D.push(await newDevice(browser, "D" + i));
  const phone2 = await newDevice(browser, "D4-second-phone");   // the chaos owner's other phone
  for (const d of [...D, phone2]) await boot(d);

  // Device 0 is the commissioner's phone all season, and permanently carries the chaos team's
  // rival — the commissioner is owner 1 (Battle Kreussers).
  if (!(await claimOn(D[0], 1))) { log("FATAL: could not claim the commissioner's team"); }
  await unlockCommish(D[0]);
  // The chaos owner keeps its own device (D3) and a second phone, both all season.
  await claimOn(D[3], CHAOS_TEAM);
  await claimOn(phone2, CHAOS_TEAM);
  // Before a single week is played, ask the questions no persona can ask.
  await setClock(weekStart(1) + 4 * HOUR, 1);
  await probeLatentHazards(D[3], 1);

  const totalWeeks = Math.min(WEEKS, SEASON_WEEKS + 3);
  for (let week = 1; week <= totalWeeks; week++) {
    banner("WEEK " + week + (week > SEASON_WEEKS ? "  (playoffs)" : ""));

    // ---- rotate the two middle devices through the other owners, so every owner acts
    // through a real device repeatedly across the season.
    const rot = [2, 3, 4, 5, 6, 7];  // teams 2..7 (1 = commish, 8 = chaos, both fixed)
    const a = rot[(week * 2) % rot.length], b = rot[(week * 2 + 1) % rot.length];
    CUR = { week, phase: "identity" };
    await claimOn(D[1], a);
    await claimOn(D[2], b);
    const active = D.filter((d) => d.live);
    if (!active.length) { fail("season.noDevices", "week " + week + ": no device is claimed — the season cannot be played"); break; }

    // ---- PHASE 1: lineups (Tuesday morning, before the Wednesday deadline).
    CUR = { week, phase: "lineup" };
    await setClock(weekStart(week) + 4 * HOUR, week);
    for (const d of active) await doLineup(d);
    await chaosRun(D[3], week, "lineup", null);
    await sweep("lineup", week, D[0]);

    // ---- PHASE 2: moves — blind claims with typed bids, a trade round, chat.
    CUR = { week, phase: "claims" };
    await setClock(weekStart(week) + 8 * HOUR, week);
    for (const d of active) await doClaim(d, week);
    if (week <= 11) await doTradeRound(active, week);   // trades.deadlineWeek is 11
    await doChat(active[week % active.length], active, week);
    await chaosRun(D[3], week, "claims", phone2);
    await sweep("claims", week, D[0]);

    // ---- PHASE 3: the deadline. Any client past it carries the week forward.
    CUR = { week, phase: "waivers" };
    await setClock(waiverDeadline(week) + HOUR, week);
    // The commissioner's own "Process now" button on one week, the ordinary any-client
    // auto-process on the next — both are real paths and both must land the same result.
    if (week % 2 === 1) {
      await nav(D[0], "moves");
      await confirmWith(D[0], true);
      await clickSel(D[0], "#mvProcessNow");
      await sleep(SETTLE + 200);
      actLog(D[0].label, D[0].who, "pressed Process now");
    } else {
      const carrier = active[(week + 1) % active.length];
      await ev(carrier, async () => { await window.__GFFL__.UI.maybeAutoProcessWaivers(); });
      await sleep(SETTLE);
      actLog(carrier.label, carrier.who, "carried the waivers forward on open");
    }
    // Trade execution rides the same any-client chain.
    for (const d of active) await ev(d, async () => { await window.__GFFL__.UI.maybeAutoExecuteTrades(); });
    await sleep(SETTLE);
    // Waiver results push each owner who had a claim in.
    await sweep("waivers", week, D[0]);

    // ---- PHASE 4: free agency (post-deadline, first come).
    CUR = { week, phase: "freeagency" };
    await setClock(waiverDeadline(week) + 8 * HOUR, week);
    for (const d of active.slice(0, 2)) await doFaAdd(d, week);
    await chaosRun(D[3], week, "freeagency", null);
    await sweep("freeagency", week, D[0]);

    // ---- PHASE 5: finalize, through the REAL commissioner button.
    CUR = { week, phase: "finalize" };
    await setClock(weekStart(week) + 6 * 24 * 3600e3, week);
    await finalizeWeek(D[0], week);
    await sweep("finalize", week, D[0]);

    // ---- PHASE 6: bracket. Building it and walking it forward is the same any-client chain.
    if (week >= SEASON_WEEKS) {
      CUR = { week, phase: "bracket" };
      await setClock(weekStart(week + 1) + 4 * HOUR, Math.min(week + 1, SEASON_WEEKS + 3));
      await ev(D[0], async () => { await window.__GFFL__.UI.maybeAdvanceLeague(); });
      await sleep(SETTLE);
      const b = sdoc("bracket_" + SEASON);
      log("  bracket: " + (b ? "built" + (b.champion != null ? ", champion = team " + b.champion : "") : "not yet"));
      await sweep("bracket", week, D[0]);
    }
  }

  // ---- season report
  banner("SEASON COMPLETE");
  const b = sdoc("bracket_" + SEASON);
  const st = {};
  for (let t = 1; t <= 8; t++) st[t] = { w: 0, l: 0, pf: 0 };
  for (let w = 1; w <= SEASON_WEEKS; w++) {
    const d = sdoc("weekly_" + SEASON + "_w" + w);
    if (!d) continue;
    for (const m of (d.matchups || [])) {
      const hp = Number(m.homePts) || 0, ap = Number(m.awayPts) || 0;
      st[m.home].pf += hp; st[m.away].pf += ap;
      if (hp > ap) { st[m.home].w++; st[m.away].l++; } else { st[m.away].w++; st[m.home].l++; }
    }
  }
  log("final standings (harness-derived):");
  Object.keys(st).map(Number).sort((x, y) => st[y].w - st[x].w || st[y].pf - st[x].pf).forEach((t) => {
    const td = sdoc("team_" + t) || {};
    log("  " + String(st[t].w) + "-" + st[t].l + "  PF " + Math.round(st[t].pf * 10) / 10 +
        "  FAAB $" + (td.faab == null ? FAAB_BUDGET : td.faab) + "  " + OWNER_NAMES[t - 1][0]);
  });
  if (b && b.champion != null) log("champion: " + OWNER_NAMES[b.champion - 1][0]);
  const weekly = Object.keys(STORE.docs).filter((k) => /^weekly_/.test(k)).length;
  log("");
  log("weeks finalized: " + weekly + " · docs in the store: " + Object.keys(STORE.docs).length +
      " · firestore calls: " + STORE.calls);
  log("claims submitted: " + LEDGER.claims.length + " · FA adds: " + LEDGER.faAdds.length +
      " · trades offered: " + COVER.trade + " · chats: " + COVER.chat + " · lineup swaps: " + COVER.lineup +
      " · pushes seen: " + PUSH_TOTAL.n);
  if (NOOPS.size) {
    log("no-ops (a flow that could not act, and how often):");
    for (const [k, n] of [...NOOPS.entries()].sort((a, b) => b[1] - a[1])) log("  " + n + "×  " + k);
  }
  // COVERAGE IS PART OF THE RESULT. A season that never once claimed a player is not a season
  // that proved the claim flow — it is a harness that stopped driving it, and a green run in
  // that state is worse than a red one because it reads as evidence.
  for (const [flow, n] of Object.entries({
    claim: LEDGER.claims.length, faAdd: LEDGER.faAdds.length,
    trade: COVER.trade, chat: COVER.chat, lineup: COVER.lineup, finalize: weekly,
  })) {
    check(n > 0, "coverage." + flow,
      "the whole season exercised the " + flow + " flow ZERO times — the sim proved nothing about it",
      "run with --trace and read the no-op reasons for '" + flow + "'");
  }
  // WHO WRITES ROSTERS, AND HOW OFTEN. A roster doc is the one thing in this league that many
  // devices write and nothing arbitrates, so the shape of this table is itself a finding: a
  // call site that writes other teams' rosters, from many devices, is a last-writer-wins race
  // waiting to happen.
  if (ROSTER_WRITE_VIA.length) {
    const by = new Map();
    for (const r of ROSTER_WRITE_VIA) {
      const k = r.via || "(unknown)";
      const e = by.get(k) || { n: 0, devs: new Set(), teams: new Set() };
      e.n++; e.devs.add(r.dev); e.teams.add(r.teamId); by.set(k, e);
    }
    log("roster writes by call site:");
    for (const [k, e] of [...by.entries()].sort((a, b) => b[1].n - a[1].n)) {
      log("  " + String(e.n).padStart(4) + "×  " + k + "   (" + e.devs.size + " devices, " + e.teams.size + " teams)");
    }
  }
  log("invariant sweeps: " + SWEEPS + " · checks: " + CHECKS + " · FAILURES: " + FAILURES.length);
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  log("runtime: " + mins + " min");

  if (ADVISORIES.length) {
    banner("ADVISORIES (" + ADVISORIES.length + ") — latent, not currently user-reachable");
    for (const a of ADVISORIES) {
      log("  ⚠ " + a.title);
      log("    what:  " + a.detail);
      log("    reach: " + a.reach);
      log("    fix:   " + a.fix);
    }
  }
  if (FAILURES.length) {
    banner("FAILURES (" + FAILURES.length + ")");
    const byInv = new Map();
    for (const f of FAILURES) byInv.set(f.invariant, (byInv.get(f.invariant) || 0) + 1);
    for (const [k, n] of [...byInv.entries()].sort((x, y) => y[1] - x[1])) log("  " + n + "×  " + k);
    log("");
    for (const f of FAILURES.slice(0, 40)) {
      log("--- [w" + f.week + " " + f.phase + "] " + f.invariant);
      log("    " + f.detail);
      if (f.repro) log("    repro: " + f.repro);
      if (f.actions.length) {
        log("    actions since the last clean sweep:");
        for (const a of f.actions) log("      " + (a.at / 1000).toFixed(1) + "s  " + a.dev + " (" + (a.persona || "-") + ") " + a.what);
      }
    }
    if (FAILURES.length > 40) log("  … " + (FAILURES.length - 40) + " more (see the report)");
  } else {
    log("");
    log("ALL INVARIANTS HELD across " + SWEEPS + " sweeps.");
  }
  log("");
  log("seed: " + SEED + "   (re-run: --seed " + SEED + " --weeks " + WEEKS + (FAST ? " --fast" : "") + ")");
  log("NOTE: the seed reproduces every persona CHOICE, not the season — four devices racing one");
  log("      store is genuinely concurrent, and these are timing bugs. --fast searches harder;");
  log("      a clean run is not proof of absence.");

  if (REPORT) {
    const dir = path.join(ROOT, "shots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const file = path.join(dir, "gffl_season_report_" + stamp + ".txt");
    const full = lines.join("\n") + "\n\n" + "=== FULL FAILURE DETAIL ===\n" +
      FAILURES.map((f) => JSON.stringify(f, null, 1)).join("\n");
    fs.writeFileSync(file, full);
    log("report: " + path.relative(ROOT, file));
  }

  await browser.close();
  srv.close();
  process.exit(FAILURES.length ? 1 : 0);
}

// ---- the finalize flow, through #finalizeBtn (falls back to a named failure, never silence).
async function finalizeWeek(dev, week) {
  await nav(dev, "league");
  await sleep(SETTLE);
  const has = await waitFor(dev, "#finalizeBtn", 6000);
  if (!has) {
    const why = await ev(dev, () => ({
      commish: window.__GFFL__.LG.commishUnlocked(),
      week: window.__GFFL__.UI.week,
      already: !!window.__GFFL__.UI._weeklyDoc,
    }));
    // Already finalized is a legitimate no-op (a previous phase's auto-chain got there first).
    if (why && why.already) return;
    fail("finalize.button", "week " + week + ": #finalizeBtn never rendered (" + JSON.stringify(why) + ")",
      "league home as the commissioner with UI.week = " + week);
    return;
  }
  // ⭐ WHAT THE FINALIZING DEVICE'S OWN CACHE SAYS THE LINEUPS ARE — read through LG.db's
  // cache (LG.loadRoster with no {fresh:true}), which is how LG.finalizeWeek used to read them
  // and is therefore still the right thing to capture. Since the bug-2 fix the finalize scores
  // a FRESH snapshot instead, so this view and the store's roster of record should now agree
  // even when the cache is stale; kept, and still printed by weekly.totalsMatchRosters,
  // because a regression that reintroduces the cached read is then self-proving on the first
  // run — the failure names the two lineups side by side instead of merely reporting a Δ.
  FINALIZE_VIEW.set(week, await ev(dev, async (wk) => {
    const LG = window.__GFFL__.LG;
    const out = {};
    for (const t of LG.teams) {
      const r = (await LG.loadRoster(wk, t.id)) || [];
      out[t.id] = r.filter((p) => p.slot !== "BENCH" && p.slot !== "IR").map((p) => p.slot + ":" + p.key);
    }
    return out;
  }, week) || {});
  await confirmWith(dev, true);   // the button's own "finalize from archived stats instead?"
  await clickSel(dev, "#finalizeBtn");
  await sleep(SETTLE + 400);
  const doc = sdoc("weekly_" + SEASON + "_w" + week);
  const okDoc = check(!!doc, "finalize.wrote",
    "week " + week + " did not finalize — no weekly doc in the store",
    "league home → #finalizeBtn → confirm the archived-stats fallback");
  if (okDoc) {
    check(doc.source === "archived", "finalize.provenance",
      "week " + week + " finalized with source \"" + doc.source + "\" (the sim drives the archived backfill on purpose)");
    check((doc.matchups || []).length === 4 || week > SEASON_WEEKS, "finalize.matchups",
      "week " + week + " wrote " + (doc.matchups || []).length + " matchups (8 teams = 4 games)");
    LEDGER.expectPush.push({ kind: "week recap", all: true, week,
      note: "league home → #finalizeBtn (LG.pushWeekRecap sends the one league-wide push)" });
    actLog(dev.label, dev.who, "finalized week " + week);
  }
}

main().catch(async (e) => {
  log("");
  log("HARNESS CRASH: " + (e && e.stack ? e.stack : e));
  if (REPORT) {
    const dir = path.join(ROOT, "shots");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "gffl_season_report_crash.txt"), lines.join("\n") + "\n\n" + String(e && e.stack));
  }
  process.exit(2);
});
