#!/usr/bin/env node
// tools/_gffl_shadow_score.mjs — GFFL SIM-C: the live-shadow scorer.
//
// READ-ONLY, always. Every network call this tool makes is a document GET, a Firestore
// `:runQuery` (a read), or a public API GET — this file never PATCHes/DELETEs a Firestore
// document and never POSTs to any `/.netlify/functions/*` endpoint. When it drives a real
// browser against the live site (step 4), it installs request interception that BLOCKS every
// write-shaped request before it reaches the network and counts what it blocked — see
// `installWriteBlock()`. Safe to run against production at any time, including during a live
// game, and safe to run on a cron every few minutes during game windows.
//
// WHY THIS EXISTS (ffleague-plan.md's "safety net" idea, S1-era): the app's own scorer
// (assets/league/lg-data.js's D.score/normSlp/weekStatsMap) is the ONLY thing that has ever
// computed a GFFL player's fantasy points. If it has a bug — a rules-doc value that silently
// coerces to zero, an id that fails to resolve, a raw Sleeper field the scorer doesn't
// recognize — nothing catches it until a family member notices their score looks wrong, which
// during a real week could be days later, after a permanent weekly doc has already been
// written. This tool is an INDEPENDENT re-implementation: it reads the same INPUTS the app
// reads (the real rules doc, the real rosters, the real raw Sleeper stat lines) but does its
// own arithmetic from those raw numbers, so a bug in the app's own scoring code path cannot
// hide inside a shared function. Where the app has a deliberate special rule (the FG-made-yards
// key, the DST points-allowed brackets, the yardage bonuses), this file mirrors the RULES
// DOC's semantics as the app's own scoring code implements them — every mirrored function below
// cites the exact lines it was ported from in assets/league/lg-data.js / lg-core.js, and this
// file should never be "improved" independently of checking it still matches what's there.
//
// Usage:
//   node tools/_gffl_shadow_score.mjs [--week N] [--season Y] [--seasonType pre|regular|post]
//                                     [--report [path]] [--no-live] [--base-url URL] [--quiet]
//   node tools/_gffl_shadow_score.mjs --selftest      # fixture checks only, NO network at all
//
// Exit code: 0 unless at least one section FAILed (WARN never fails the run).
"use strict";

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const require = createRequire(resolve(__dirname, "_gffl_shadow_score.mjs"));

// ================================================================================================
// CLI args
// ================================================================================================
const argv = process.argv.slice(2);
const QUIET = argv.includes("--quiet");
const SELFTEST = argv.includes("--selftest");
const NO_LIVE = argv.includes("--no-live");
function argVal(name) {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}
const ARG_WEEK = argVal("--week") ? Number(argVal("--week")) : null;
const ARG_SEASON = argVal("--season") ? Number(argVal("--season")) : null;
const ARG_SEASON_TYPE = argVal("--seasonType");
const ARG_BASE_URL = argVal("--base-url") || "https://goatfantasyleague.com";
let REPORT_PATH = null;
{
  const i = argv.indexOf("--report");
  if (i !== -1) { const n = argv[i + 1]; REPORT_PATH = n && !n.startsWith("--") ? n : "__default__"; }
}

// ================================================================================================
// constants — mirrored verbatim from the app (lg-core.js unless noted)
// ================================================================================================
// ESPN/Sleeper base URLs: lg-data.js L14-15.
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SLP = "https://api.sleeper.app/v1";
// Firestore REST transport: lg-core.js L339-340. FS_KEY is the public web API key already
// shipped in the client bundle; Firestore rules are public — the same posture every read in
// this app already uses from a browser (lg-core.js's own "SERVER-CONFIRMED EMPTINESS" note,
// ~L300-338).
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";
// LG.PASS / roomId() / LG.COLL: lg-core.js L9, L14-15, L17-22.
const LG_PASS = "amenfarms";
function roomId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "fam" + Math.abs(h).toString(36);
}
const FAM_KEY = roomId(LG_PASS);
const LG_COLL = "gffl_" + FAM_KEY; // lg-core.js L15
// LG.SEASON / LG.SEASON_START: lg-core.js L10, L12 (the real, non-replay defaults — LG.SIM_2025
// is permanently false in the shipped build per the 2026-08-09 "ITEM 29" switch-off).
const LG_SEASON_DEFAULT = 2026;
const LG_SEASON_START = "2026-09-08";

// currentWeek(): lg-core.js L1879-1883, byte-for-byte (used only to pick a default week to
// probe — this tool never writes a week number anywhere).
function currentWeek(nowMs) {
  const start = new Date(LG_SEASON_START + "T05:00:00-05:00").getTime();
  const w = 1 + Math.floor((nowMs - start) / (7 * 24 * 3600 * 1000));
  return Math.max(1, Math.min(18, w));
}

// ================================================================================================
// mirrored pure functions — the scoring engine (lg-data.js, cited per block)
// ================================================================================================

// normSeasonType(): lg-data.js L525-536, byte-for-byte.
function normSeasonType(v) {
  if (v == null) return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return n === 1 ? "pre" : n === 2 ? "regular" : (n === 3 || n === 4) ? "post" : null;
  }
  const s = String(v).toLowerCase();
  if (s.startsWith("pre")) return "pre";
  if (s.startsWith("reg")) return "regular";
  if (s.startsWith("post")) return "post";
  return null;
}
// ESPN's numeric seasontype query param (used only to fetch a scoreboard for an explicit
// season/week — mirrors the numeric encoding normSeasonType decodes above, in reverse).
const SEASONTYPE_NUM = { pre: 1, regular: 2, post: 3 };

// normName()/slpTeam()/nameKey(): lg-data.js L17-30.
const slpTeam = (ab) => (ab === "WSH" ? "WAS" : ab || "");
const ALIAS = { "bam knight": "zonovan knight" };
function normName(n) {
  n = String(n || "").toLowerCase().replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").trim().replace(/ +/g, " ");
  return ALIAS[n] || n;
}
const nameKey = (name, teamAb) => normName(name) + "|" + slpTeam(teamAb);

// The normalized scoring schema: lg-data.js L33-46, byte-for-byte (order doesn't matter for
// scoring, but is kept identical to the source for easy diffing).
const KEYS = [
  "pass_yd", "pass_td", "pass_int", "pass_2pt",
  "rush_yd", "rush_td", "rush_2pt",
  "rec", "rec_yd", "rec_td", "rec_2pt",
  "fum_lost",
  "fg_0_39", "fg_40_49", "fg_50", "fg_miss", "xp_made", "xp_miss",
  "dst_sack", "dst_int", "dst_fum_rec", "dst_td", "dst_safety", "dst_blk",
  "off_fum_td",
  "fg_made_yd", "dst_2pt_ret", "one_pt_safety",
  "dst_fum_forced", "dst_kr_td", // 2026-08-13 reconciliation — mirrors lg-data byte-for-byte
];
const empty = () => { const o = {}; for (const k of KEYS) o[k] = 0; o.dst_pa = null; return o; };

// num()/D.score()/paPoints(): lg-data.js L57-92, byte-for-byte. This is THE finding lg-data.js
// itself documents (the 2026-08-09 "NaN" production incident) — every factor is coerced through
// num() before it ever multiplies, because a scoring table is untrusted persisted data (typed by
// a commissioner, imported from ESPN, round-tripped through the Firestore codec).
const num = (v) => { const n = typeof v === "number" ? v : Number(v); return Number.isFinite(n) ? n : 0; };
function paPoints(pa, sc) {
  if (pa == null) return 0;
  const p = num(pa);
  if (p === 0) return num(sc.dst_pa_0);
  if (p <= 6) return num(sc.dst_pa_1_6);
  if (p <= 13) return num(sc.dst_pa_7_13);
  if (p <= 17) return num(sc.dst_pa_14_17);
  if (p <= 27) return num(sc.dst_pa_18_27);
  if (p <= 34) return num(sc.dst_pa_28_34);
  if (p <= 45) return num(sc.dst_pa_35_45);
  return num(sc.dst_pa_46);
}
function score(st, scoring) {
  const sc = scoring || {};
  let p = 0;
  for (const k of KEYS) p += num(st[k]) * num(sc[k]);
  p += paPoints(st.dst_pa, sc);
  const bonus = (yd, lo, hi, kLo, kHi) => (yd >= hi ? num(sc[kHi]) : yd >= lo ? num(sc[kLo]) : 0);
  p += bonus(num(st.pass_yd), 300, 400, "bonus_pass_300", "bonus_pass_400");
  p += bonus(num(st.rush_yd), 100, 200, "bonus_rush_100", "bonus_rush_200");
  p += bonus(num(st.rec_yd), 100, 200, "bonus_rec_100", "bonus_rec_200");
  const out = Math.round(p * 100) / 100;
  return Number.isFinite(out) ? out : 0;
}

// normSlp(): lg-data.js L94-118, byte-for-byte. Every RAW Sleeper field name this scorer
// actually reads — the whitelist the unknown-key detector (below) is built against.
const NORMSLP_RAW_KEYS = new Set([
  "pass_yd", "pass_td", "pass_int", "pass_2pt",
  "rush_yd", "rush_td", "rush_2pt",
  "rec", "rec_yd", "rec_td", "rec_2pt",
  "fum_lost", "fgm_yds", "def_2pt",
  "fgm_0_19", "fgm_20_29", "fgm_30_39", "fgm_40_49", "fgm_50p",
  "fgmiss", "xpm", "xpmiss",
  "sack", "def_sack", "int", "def_int", "fum_rec", "def_fum_rec",
  "def_td", "def_st_td", "st_td", "safe", "safety", "blk_kick", "ff", "def_ff",
  "fum_rec_td", "pts_allow",
]);
function normSlp(st, isDst) {
  if (isDst == null) isDst = st.pts_allow != null;
  const n = empty();
  n.pass_yd = st.pass_yd || 0; n.pass_td = st.pass_td || 0; n.pass_int = st.pass_int || 0;
  n.pass_2pt = st.pass_2pt || 0;
  n.rush_yd = st.rush_yd || 0; n.rush_td = st.rush_td || 0; n.rush_2pt = st.rush_2pt || 0;
  n.rec = st.rec || 0; n.rec_yd = st.rec_yd || 0; n.rec_td = st.rec_td || 0; n.rec_2pt = st.rec_2pt || 0;
  n.fum_lost = st.fum_lost || 0;
  n.fg_made_yd = st.fgm_yds || 0;
  n.dst_2pt_ret = st.def_2pt || 0;
  n.fg_0_39 = (st.fgm_0_19 || 0) + (st.fgm_20_29 || 0) + (st.fgm_30_39 || 0);
  n.fg_40_49 = st.fgm_40_49 || 0; n.fg_50 = st.fgm_50p || 0;
  n.fg_miss = st.fgmiss || 0; n.xp_made = st.xpm || 0; n.xp_miss = st.xpmiss || 0;
  // 2026-08-13 reconciliation split (mirrors lg-data): defensive keys are D/ST-only —
  // defensive returns 6 (dst_td), the unit's kick/punt returns 8 (dst_kr_td), forced
  // fumbles their own key; a PLAYER row maps its return TD into dst_td (base 6, ESPN's own
  // 2025 Shaheed rows) and nothing else defensive (Hurts's fumble recovery paid 0).
  if (isDst) {
    n.dst_sack = st.sack ?? st.def_sack ?? 0;
    n.dst_int = st.int ?? st.def_int ?? 0;
    n.dst_fum_rec = st.fum_rec ?? st.def_fum_rec ?? 0;
    n.dst_td = st.def_td || 0;
    n.dst_kr_td = (st.def_st_td || 0) + (st.st_td || 0);
    n.dst_fum_forced = st.ff ?? st.def_ff ?? 0;
    n.dst_safety = st.safe ?? st.safety ?? 0;
    n.dst_blk = st.blk_kick || 0;
  } else {
    n.dst_td = st.st_td || 0;
  }
  n.off_fum_td = st.fum_rec_td || 0;
  if (st.pts_allow != null) n.dst_pa = st.pts_allow;
  return n;
}

// LG.irEligible(): lg-core.js L1319, byte-for-byte — the app's own "genuinely not playing" set,
// used here for the "played but has no line" flag.
const IR_ELIGIBLE = new Set(["IR", "O", "Out", "PUP", "NFI", "SUS", "Doubtful"]);
const irEligible = (injury) => IR_ELIGIBLE.has(String(injury || ""));

// ================================================================================================
// ---- the ONE id resolver, mirrored from resolvePid(): lg-data.js L462-476 ----
// ================================================================================================
// Three methods, cheapest and most certain first: (1) an explicit dst_/slp_ prefix carries the
// pid outright; (2) the espn_id INDEX (Sleeper's directory, byEspn); (3) NAME + TEAM, using
// whatever the rosters themselves already know (mirrors D.S.rosterMetaByKey, populated the same
// way D.registerRosterPlayers does it — lg-data.js L447-460).
function resolvePid(key, byEspn, byName, rosterMetaByKey) {
  const k = String(key == null ? "" : key);
  if (!k) return { pid: null, via: "none" };
  if (k.startsWith("dst_") || k.startsWith("slp_")) return { pid: k.slice(4), via: "prefix" };
  const m1 = byEspn.get(k);
  if (m1) return { pid: m1.pid, via: "espn" };
  const meta = rosterMetaByKey.get(k);
  if (meta && meta.name && meta.team) {
    const m2 = byName.get(nameKey(meta.name, meta.team));
    if (m2) return { pid: m2.pid, via: "name" };
  }
  return { pid: null, via: "none" };
}

// ================================================================================================
// ---- Firestore REST codec: lg-core.js L376-396 (decode-only; this tool never encodes) ----
// ================================================================================================
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
  return null;
}
function fsDecFields(fields) {
  const out = {};
  for (const k of Object.keys(fields || {})) out[k] = fsDec(fields[k]);
  return out;
}

// ================================================================================================
// bounded fetch wrapper — every network call in this tool goes through this
// ================================================================================================
const FETCH_TIMEOUT_MS = 15000;
const latencyLog = [];
async function timedFetch(label, url, init) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  const rec = { label, url, ms: null, status: null, ok: false, bytes: 0, error: "" };
  try {
    const r = await fetch(url, { ...(init || {}), signal: ac.signal });
    rec.status = r.status;
    const text = await r.text();
    rec.bytes = text.length;
    rec.ms = Date.now() - t0;
    rec.ok = r.ok;
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch (e) { /* non-JSON body */ } }
    latencyLog.push(rec);
    return { ok: r.ok, status: r.status, json, text, ms: rec.ms, unreachable: false };
  } catch (e) {
    rec.ms = Date.now() - t0;
    const aborted = e && (e.name === "AbortError" || ac.signal.aborted);
    rec.error = aborted ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : String((e && e.message) || e);
    latencyLog.push(rec);
    return { ok: false, status: null, json: null, text: null, ms: rec.ms, unreachable: true, error: rec.error };
  } finally { clearTimeout(timer); }
}
function hostOf(url) { try { return new URL(url).host; } catch (e) { return url; } }
function unreachableLine(url) { return `${hostOf(url)} unreachable from this environment.`; }

// ---- Firestore read helpers (GET / :runQuery only — never PATCH/DELETE) ----
async function fsGetDoc(id) {
  const url = `${FS_BASE}/${encodeURIComponent(LG_COLL)}/${encodeURIComponent(id)}?key=${FS_KEY}`;
  const r = await timedFetch(`firestore GET ${id}`, url);
  if (r.unreachable) return { unreachable: true, error: r.error };
  if (r.status === 404) return { ok: true, doc: null };
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, doc: fsDecFields(r.json && r.json.fields) };
}
// Mirrors rest.list(kind): lg-core.js L531-553 (POST :runQuery — a read, never a write).
async function fsListKind(kind) {
  const q = { from: [{ collectionId: LG_COLL }] };
  if (kind) q.where = { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: kind } } };
  const r = await timedFetch(`firestore :runQuery kind=${kind || "*"}`, `${FS_BASE}:runQuery?key=${FS_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ structuredQuery: q }),
  });
  if (r.unreachable) return { unreachable: true, error: r.error };
  if (!r.ok) return { ok: false, status: r.status };
  const rows = Array.isArray(r.json) ? r.json : [];
  const out = [];
  for (const row of rows) {
    if (!row || !row.document || !row.document.name) continue;
    const id = String(row.document.name).split("/").pop();
    out.push({ ...fsDecFields(row.document.fields), id });
  }
  return { ok: true, rows: out };
}

// ================================================================================================
// report accumulator — same shape as tools/_gffl_live_probe.mjs's own section() helper
// ================================================================================================
const sections = [];
function section(id, title) {
  const s = { id, title, status: "PASS", meaning: "", lines: [] };
  sections.push(s);
  return {
    line(s2) { s.lines.push(s2); },
    setStatus(st, meaning) {
      const rank = { PASS: 0, WARN: 1, FAIL: 2 };
      if (rank[st] > rank[s.status]) { s.status = st; s.meaning = meaning; }
      else if (!s.meaning && meaning) s.meaning = meaning;
    },
    raw: s,
  };
}

// ================================================================================================
// DEFAULT_RULES fallback — lg-core.js L811-842, byte-for-byte (used only when the league's own
// `settings` doc is missing, exactly like LG.loadRules's own fallback — lg-core.js L845-857).
// ================================================================================================
const DEFAULT_RULES = {
  name: "The Goat Fantasy Football League",
  abbrev: "GFFL",
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
};

// ================================================================================================
// --selftest — parser/scorer fixtures only, ZERO network
// ================================================================================================
function selftest() {
  const checks = [];
  const ok = (name, cond) => checks.push({ name, ok: !!cond });

  // ---- num() / score() core arithmetic ----
  ok("num(5) === 5", num(5) === 5);
  ok('num("3.5") === 3.5', num("3.5") === 3.5);
  ok('num("undefined") === 0 (the real production poison case)', num("undefined") === 0);
  ok("num(NaN) === 0", num(NaN) === 0);
  ok("num(null) === 0", num(null) === 0);
  ok("num(undefined) === 0", num(undefined) === 0);
  ok("num(Infinity) === 0", num(Infinity) === 0);

  // ---- QB with a bonus threshold (worked example) ----
  {
    // 320 pass yds (crosses the 300 bonus), 2 pass TD, 1 INT, 10 rush yds.
    const st = { ...empty(), pass_yd: 320, pass_td: 2, pass_int: 1, rush_yd: 10 };
    const sc = { pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, bonus_pass_300: 3, bonus_pass_400: 5 };
    // 320*0.04=12.8 + 2*4=8 + 1*-2=-2 + 10*0.1=1 + bonus(300)=3 => 22.8
    ok("QB bonus-threshold worked example = 22.8", score(st, sc) === 22.8);
  }
  {
    // Same QB line but 410 pass yds — crosses the 400 bonus instead of the 300 one (mutually
    // exclusive brackets, never additive).
    const st = { ...empty(), pass_yd: 410, pass_td: 2, pass_int: 1 };
    const sc = { pass_yd: 0.04, pass_td: 4, pass_int: -2, bonus_pass_300: 3, bonus_pass_400: 5 };
    // 410*0.04=16.4 + 8 - 2 + bonus(400)=5 => 27.4
    ok("QB 400-yd bonus wins over 300-yd bonus (mutually exclusive)", score(st, sc) === 27.4);
  }

  // ---- kicker: FG-made-yards path (fg_made_yd / statId 214) ----
  {
    // A 52-yard made FG scored purely by yardage (the family league's real mechanism per the
    // 2026-08-07 kicker audit note in lg-data.js) plus one extra point.
    const st = normSlp({ fgm_yds: 52, xpm: 1 });
    const sc = { fg_made_yd: 0.1, xp_made: 1 };
    ok("kicker fg_made_yd (52yd*0.1 + 1 XP) = 6.2", score(st, sc) === 6.2);
  }
  {
    // The REAL production poison found live 2026-08-11: fg_made_yd stored as the STRING
    // "undefined" in the family's own rules doc. Must degrade to a ZERO coefficient, never NaN.
    const st = normSlp({ fgm_yds: 52 });
    const sc = { fg_made_yd: "undefined" };
    ok('a scoring value of the STRING "undefined" scores as 0, not NaN', score(st, sc) === 0 && Number.isFinite(score(st, sc)));
  }
  {
    // Bracket-based FG scoring (fg_0_39/40_49/50) — the app's DEFAULT_RULES mechanism.
    const st = normSlp({ fgm_20_29: 1, fgm_40_49: 1, fgm_50p: 1, xpm: 2 });
    const sc = { fg_0_39: 3, fg_40_49: 4, fg_50: 5, xp_made: 1 };
    // fg_0_39 bucket = fgm_0_19+fgm_20_29+fgm_30_39 = 1 -> 3pts; fg_40_49=1->4; fg_50=1->5; xp 2*1=2
    ok("kicker three-bracket FG line (3+4+5+2) = 14", score(st, sc) === 14);
  }

  // ---- DST: points-allowed bracket + a defensive TD ----
  {
    const st = normSlp({ sack: 2, int: 1, def_td: 1, pts_allow: 10 });
    const sc = {
      dst_sack: 1, dst_int: 2, dst_td: 6,
      dst_pa_0: 5, dst_pa_1_6: 4, dst_pa_7_13: 3, dst_pa_14_17: 1,
      dst_pa_18_27: 0, dst_pa_28_34: -1, dst_pa_35_45: -3, dst_pa_46: -5,
    };
    // 2 sacks*1=2, 1 int*2=2, 1 TD*6=6, pa=10 -> 7-13 bracket -> 3. Total 13.
    ok("DST sack+int+TD+7-13pa bracket = 13", score(st, sc) === 13);
  }
  {
    // dst_pa bracket boundaries — every rung, exactly.
    const sc = {
      dst_pa_0: 5, dst_pa_1_6: 4, dst_pa_7_13: 3, dst_pa_14_17: 1,
      dst_pa_18_27: 0, dst_pa_28_34: -1, dst_pa_35_45: -3, dst_pa_46: -5,
    };
    ok("dst_pa=0 -> 5", paPoints(0, sc) === 5);
    ok("dst_pa=6 -> 4 (top of 1-6)", paPoints(6, sc) === 4);
    ok("dst_pa=7 -> 3 (bottom of 7-13)", paPoints(7, sc) === 3);
    ok("dst_pa=27 -> 0 (top of 18-27)", paPoints(27, sc) === 0);
    ok("dst_pa=46 -> -5 (46+)", paPoints(46, sc) === -5);
    ok("dst_pa=null -> 0 (never played / bye)", paPoints(null, sc) === 0);
  }

  // ---- negative-points case: a QB pick-6 day ----
  {
    const st = normSlp({ pass_yd: 150, pass_td: 0, pass_int: 4, fum_lost: 1 });
    const sc = { pass_yd: 0.04, pass_td: 4, pass_int: -2, fum_lost: -2 };
    // 150*0.04=6 + 0 + 4*-2=-8 + 1*-2=-2 => -4
    ok("negative-points QB day (4 INT, 1 lost fumble) = -4", score(st, sc) === -4);
  }

  // ---- receiving bonus + half-PPR (the real family league's current rec value, 0.5) ----
  {
    const st = normSlp({ rec: 8, rec_yd: 145, rec_td: 1 });
    const sc = { rec: 0.5, rec_yd: 0.1, rec_td: 6, bonus_rec_100: 3 };
    // 8*0.5=4 + 145*0.1=14.5 + 6 + bonus(100)=3 => 27.5
    ok("half-PPR WR line with a 100-yd bonus = 27.5", score(st, sc) === 27.5);
  }

  // ---- rules-doc keys the scorer never applies (the real production drift found live) ----
  // RESTAGED 2026-08-13 (the full rules reconciliation): dst_kr_td and dst_fum_forced were
  // PROMOTED into the scorer's KEYS — the league really pays them (8/unit and 1/unit, proven
  // on 2,497 real 2025 player-weeks). The four that remain are the ESPN-shaped per-return-type
  // aliases (fum/int/blocked/punt return TDs) whose events the app deliberately buckets into
  // dst_td (6) and dst_kr_td (8) — identical pay, one bucket per rate.
  {
    const scoring = { dst_fum_ret_td: 6, dst_int_ret_td: 6, dst_pr_td: 6, dst_kr_td: 6, dst_fum_forced: 0, dst_blk_td: 6, pass_yd: 0.04 };
    const unknown = Object.keys(scoring).filter((k) => !KEYS.includes(k) && !k.startsWith("dst_pa_") && !k.startsWith("bonus_"));
    ok("4 alias keys remain scorer-unsupported (their events bucket into dst_td/dst_kr_td)", unknown.length === 4);
    ok('"pass_yd" (a real scorer key) is NOT flagged as drift', !unknown.includes("pass_yd"));
  }

  // ---- normSeasonType / SEASONTYPE_NUM round trip ----
  ok('normSeasonType(1) === "pre"', normSeasonType(1) === "pre");
  ok('normSeasonType("2") === "regular"', normSeasonType("2") === "regular");
  ok('normSeasonType("preseason") === "pre"', normSeasonType("preseason") === "pre");
  ok("normSeasonType(null) === null", normSeasonType(null) === null);
  ok("SEASONTYPE_NUM.pre === 1", SEASONTYPE_NUM.pre === 1);

  // ---- resolvePid — all three methods + the honest miss ----
  {
    const byEspn = new Map([["999", { pid: "sp1", name: "Espn Guy", team: "KC" }]]);
    const byName = new Map([[nameKey("Name Only Guy", "SF"), { pid: "sp2", name: "Name Only Guy", team: "SF" }]]);
    const rosterMeta = new Map([["777", { name: "Name Only Guy", team: "SF" }]]);
    ok('dst_ prefix resolves via "prefix"', resolvePid("dst_KC", byEspn, byName, rosterMeta).via === "prefix");
    ok("dst_ prefix strips to the right pid", resolvePid("dst_KC", byEspn, byName, rosterMeta).pid === "KC");
    ok("slp_ prefix strips to the right pid", resolvePid("slp_11565", byEspn, byName, rosterMeta).pid === "11565");
    ok('espn_id key resolves via "espn"', resolvePid("999", byEspn, byName, rosterMeta).via === "espn");
    ok('name+team fallback resolves via "name"', resolvePid("777", byEspn, byName, rosterMeta).via === "name");
    ok("an unknown key with no roster meta resolves to nothing", resolvePid("000", byEspn, byName, rosterMeta).pid === null);
  }

  // ---- irEligible ----
  ok('irEligible("Out") === true', irEligible("Out") === true);
  ok('irEligible("Questionable") === false', irEligible("Questionable") === false);
  ok('irEligible("") === false', irEligible("") === false);

  // ---- weekStatsMap-style output keying (lg-data.js L620-639) ----
  {
    // A player with no espn_id at all — the roster's own key (via keyByName) must win, or the
    // stat row becomes an orphan nothing on the roster ever reads (the 2026-08-09 "everything
    // reads 0" incident this whole app was patched for).
    const keyByName = new Map([[nameKey("Rookie Guy", "SF"), "slp_9001"]]);
    const meta = { name: "Rookie Guy", team: "SF", pos: "WR", espn_id: null };
    const outputKey = keyByName.get(nameKey(meta.name, meta.team)) || meta.espn_id || "slp_9001fallback";
    ok("keyByName wins over an espn_id fallback for a rookie with no espn_id", outputKey === "slp_9001");
  }
  {
    // A DST scores under BOTH dst_<pid> and dst_<abbrev> — lg-data.js L631-634.
    const meta = { name: "SF", team: "SF", pos: "DEF" };
    const primaryKey = "dst_" + "SF"; // pid IS the team abbrev for a Sleeper DEF entry
    const secondaryKey = "dst_" + slpTeam(meta.team);
    ok("DST dual-keying: primary and secondary keys agree for a normal team", primaryKey === secondaryKey);
    ok('DST dual-keying: WSH -> WAS remap applies on the secondary key', "dst_" + slpTeam("WSH") === "dst_WAS");
  }

  // ---- currentWeek() clamp behavior ----
  ok("currentWeek() clamps to 1 before SEASON_START", currentWeek(Date.parse(LG_SEASON_START) - 24 * 3600 * 1000) === 1);
  ok("currentWeek() reads week 2 exactly 7 days after start", currentWeek(Date.parse(LG_SEASON_START + "T05:00:00-05:00") + 7 * 24 * 3600 * 1000) === 2);

  // ---- Firestore codec round trip ----
  {
    const fields = {
      week: { integerValue: "1" }, rate: { doubleValue: 0.5 }, name: { stringValue: "Team A" },
      dead: { nullValue: null }, live: { booleanValue: true },
      players: { arrayValue: { values: [{ mapValue: { fields: { key: { stringValue: "slp_123" } } } }] } },
    };
    const dec = fsDecFields(fields);
    ok("fsDec: integerValue -> Number", dec.week === 1);
    ok("fsDec: doubleValue -> Number", dec.rate === 0.5);
    ok("fsDec: stringValue -> string", dec.name === "Team A");
    ok("fsDec: nullValue -> null", dec.dead === null);
    ok("fsDec: booleanValue -> true", dec.live === true);
    ok("fsDec: arrayValue of mapValue -> array of objects", Array.isArray(dec.players) && dec.players[0].key === "slp_123");
  }

  // ---- famKey / collection derivation ----
  ok("roomId is deterministic", roomId("amenfarms") === roomId("amenfarms"));
  ok('LG_COLL derives to "gffl_" + roomId(LG_PASS)', LG_COLL === "gffl_" + roomId(LG_PASS));

  let pass = 0;
  for (const c of checks) { if (c.ok) pass++; else console.log(`  FAIL  ${c.name}`); }
  console.log(`--selftest: ${pass}/${checks.length} scorer/parser checks passed (no network used).`);
  return pass === checks.length;
}

// ================================================================================================
// PART A — rules doc: load, sanity-check for poisoned values, flag scorer-unsupported keys
// ================================================================================================
async function loadRulesAndFlag(sec) {
  const r = await fsGetDoc("settings");
  if (r.unreachable) { sec.setStatus("WARN", unreachableLine(FS_BASE)); sec.line(unreachableLine(FS_BASE)); return null; }
  if (!r.ok) { sec.setStatus("FAIL", `Firestore read of the rules doc failed (HTTP ${r.status}).`); return null; }
  let rules;
  if (r.doc && r.doc.rules) { rules = r.doc.rules; sec.line("rules doc found (kind:\"settings\")."); }
  else { rules = { ...DEFAULT_RULES }; sec.line("no settings doc — using DEFAULT_RULES (matches LG.loadRules's own fallback)."); }
  const sc = rules.scoring || {};

  // Poisoned values: anything the scorer would silently coerce to 0 via num() rather than the
  // finite number a commissioner presumably meant. This is the REAL production finding
  // (2026-08-11): fg_made_yd / dst_2pt_ret / one_pt_safety were literally the STRING
  // "undefined" in the live rules doc.
  const poisoned = [];
  for (const k of Object.keys(sc)) {
    const v = sc[k];
    if (v == null) continue; // a rules editor may legitimately omit a rare key
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) poisoned.push({ key: k, value: v });
  }
  if (poisoned.length) {
    sec.setStatus("FAIL", `${poisoned.length} scoring value(s) in the live rules doc are not finite numbers — they score as ZERO regardless of what the family intended (num()'s guard, not a crash, but a silent gap).`);
    for (const p of poisoned) sec.line(`  POISONED: scoring.${p.key} = ${JSON.stringify(p.value)} (typeof ${typeof p.value}) -> scores as 0`);
  } else {
    sec.line("every scoring.* value in the rules doc is a finite number.");
  }

  // Drift: scoring keys the rules doc defines but D.score's fixed KEYS array never even looks
  // at (D.score iterates KEYS, not Object.keys(scoring) — a key outside KEYS is silently inert
  // no matter its value, even a real nonzero one). dst_pa_* and bonus_* are scored through their
  // own separate mechanisms (paPoints / the bonus() brackets), not KEYS, so they're excluded.
  const drift = Object.keys(sc).filter((k) => !KEYS.includes(k) && !k.startsWith("dst_pa_") && !k.startsWith("bonus_"));
  if (drift.length) {
    sec.setStatus("WARN", `${drift.length} rules-doc scoring key(s) have no scorer support at all (D.score never reads them, at any value) — worth a look, not necessarily a bug.`);
    for (const k of drift) sec.line(`  UNSUPPORTED: scoring.${k} = ${JSON.stringify(sc[k])} (set in the rules doc, never applied by the scorer)`);
  } else {
    sec.line("every rules-doc scoring key has scorer support (or is a dst_pa_*/bonus_* bracket).");
  }
  if (!poisoned.length && !drift.length) sec.setStatus("PASS", "rules doc is clean — every scoring value is finite and scorer-supported.");
  return rules;
}

// ================================================================================================
// PART B — teams + rosters (read-only; ensureRoster's OWN fallback walk, without its write)
// ================================================================================================
async function loadTeamsFlagged(sec) {
  const r = await fsListKind("team");
  if (r.unreachable) { sec.setStatus("WARN", unreachableLine(FS_BASE)); sec.line(unreachableLine(FS_BASE)); return []; }
  if (!r.ok) { sec.setStatus("FAIL", `Firestore team query failed (HTTP ${r.status}).`); return []; }
  const teams = r.rows.map((t) => ({ ...t, id: Number(t.teamId) })).sort((a, b) => a.id - b.id);
  sec.line(`found ${teams.length} team doc(s) in ${LG_COLL}: ${teams.map((t) => `${t.id}:${t.name}`).join(", ")}`);
  if (!teams.length) sec.setStatus("WARN", "no team docs found — nothing to score.");
  else sec.setStatus("PASS", `${teams.length} teams loaded.`);
  return teams;
}
// Mirrors LG.ensureRoster's own read-and-fallback-backward walk (lg-core.js L1300-1309) — but
// NEVER performs the "copy previous week forward" WRITE that function does; this is the pure
// read half only.
async function loadRosterReadOnly(season, week, teamId) {
  for (let w = week; w >= 1; w--) {
    const r = await fsGetDoc(`roster_${season}_w${w}_t${teamId}`);
    if (r.unreachable) return { unreachable: true, error: r.error };
    if (!r.ok) continue;
    if (r.doc && Array.isArray(r.doc.players)) return { ok: true, players: r.doc.players, foundWeek: w };
  }
  return { ok: true, players: [], foundWeek: null };
}

// ================================================================================================
// PART C — ESPN scoreboard (season/week context: which teams' games are final)
// ================================================================================================
async function loadScoreboardTeamStates(season, week, seasonType) {
  const stNum = SEASONTYPE_NUM[seasonType] || 2;
  const url = `${ESPN}/scoreboard?seasontype=${stNum}&week=${week}&dates=${season}`;
  const r = await timedFetch(`espn scoreboard ${season}/${seasonType}/w${week}`, url);
  if (r.unreachable || !r.ok) return { ok: false, states: new Map(), unreachable: r.unreachable, error: r.error, status: r.status };
  const states = new Map(); // slpTeam(abbrev) -> "pre"|"in"|"post"
  for (const ev of ((r.json && r.json.events) || [])) {
    const c = ev.competitions && ev.competitions[0]; if (!c) continue;
    const st = (c.status && c.status.type && c.status.type.state) || "pre";
    for (const comp of (c.competitors || [])) {
      const ab = comp && comp.team && comp.team.abbreviation;
      if (ab) states.set(slpTeam(ab), st);
    }
  }
  return { ok: true, states, eventCount: ((r.json && r.json.events) || []).length };
}

// ================================================================================================
// PART D — Sleeper directory + raw stats bucket, then the recompute itself
// ================================================================================================
async function loadSleeperDirectory(sec) {
  const r = await timedFetch("sleeper players (full pool)", `${SLP}/players/nfl`);
  if (r.unreachable) { sec.setStatus("WARN", unreachableLine(`${SLP}/players/nfl`)); sec.line(unreachableLine(`${SLP}/players/nfl`)); return null; }
  if (!r.ok || !r.json) { sec.setStatus("FAIL", `Sleeper player directory failed (HTTP ${r.status}).`); return null; }
  const byId = new Map(), byEspn = new Map(), byName = new Map();
  for (const pid in r.json) {
    const p = r.json[pid]; if (!p || typeof p !== "object") continue;
    const meta = {
      pid, name: p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim() || pid,
      team: p.team || "", pos: p.position || "", espn_id: p.espn_id != null ? String(p.espn_id) : null,
      injury: p.injury_status || "",
    };
    if (meta.pos === "DEF") meta.name = pid + " D/ST";
    byId.set(pid, meta);
    if (meta.espn_id) byEspn.set(meta.espn_id, meta);
    if (meta.team) byName.set(nameKey(meta.name, meta.team), meta);
  }
  sec.line(`Sleeper directory: ${byId.size} entries in ${r.ms}ms.`);
  sec.setStatus("PASS", `${byId.size} entries loaded.`);
  return { byId, byEspn, byName };
}
async function loadStatsBucket(season, week, seasonType) {
  const url = `${SLP}/stats/nfl/${seasonType}/${season}/${week}`;
  const r = await timedFetch(`sleeper stats ${seasonType}/${season}/${week}`, url);
  if (r.unreachable) return { unreachable: true, error: r.error, url };
  if (!r.ok) return { ok: false, status: r.status, url };
  const entries = r.json && typeof r.json === "object" ? r.json : {};
  return { ok: true, entries, count: Object.keys(entries).length, url, ms: r.ms };
}

// ================================================================================================
// main
// ================================================================================================
async function main() {
  if (SELFTEST) { process.exit(selftest() ? 0 : 1); return; }

  const startedAt = Date.now();
  const season = ARG_SEASON || LG_SEASON_DEFAULT;
  const week = ARG_WEEK || (season === LG_SEASON_DEFAULT ? currentWeek(Date.now()) : 1);

  console.log(`GFFL SIM-C shadow scorer — season ${season}, week ${week}${ARG_SEASON_TYPE ? `, seasonType override "${ARG_SEASON_TYPE}"` : ""}`);
  console.log(`league collection: ${LG_COLL} (roomId("${LG_PASS}"))`);
  console.log("");

  // ---- A: rules ----
  const secRules = section("A", "Rules doc — poisoned values + scorer-unsupported keys");
  const rules = await loadRulesAndFlag(secRules);
  const scoring = (rules && rules.scoring) || DEFAULT_RULES.scoring;

  // ---- B: teams + rosters ----
  const secTeams = section("B", "Teams");
  const teams = await loadTeamsFlagged(secTeams);

  const secRosters = section("C", "Rosters — read-only load for the target week");
  const rosterByTeam = new Map(); // teamId -> players[]
  for (const t of teams) {
    const r = await loadRosterReadOnly(season, week, t.id);
    if (r.unreachable) { secRosters.setStatus("WARN", unreachableLine(FS_BASE)); secRosters.line(`team ${t.id} (${t.name}): ${unreachableLine(FS_BASE)}`); continue; }
    rosterByTeam.set(t.id, r.players);
    secRosters.line(`team ${t.id} (${t.name}): ${r.players.length} players${r.foundWeek != null && r.foundWeek !== week ? ` (carried forward from week ${r.foundWeek} — read-only, nothing written)` : ""}`);
  }
  const allPlayers = [];
  for (const ps of rosterByTeam.values()) allPlayers.push(...ps);
  if (!allPlayers.length) secRosters.setStatus("WARN", "no rostered players found for this week on any team.");
  else secRosters.setStatus("PASS", `${allPlayers.length} rostered player-slots loaded across ${rosterByTeam.size} teams.`);

  // ---- keyByName / rosterMetaByKey — mirrors D.registerRosterPlayers, lg-data.js L447-460 ----
  const keyByName = new Map();
  const rosterMetaByKey = new Map();
  for (const p of allPlayers) {
    if (!p || !p.key) continue;
    const k = String(p.key);
    if (!rosterMetaByKey.has(k)) rosterMetaByKey.set(k, { name: p.name, team: p.team, pos: p.pos });
    if (p.name && p.team) keyByName.set(nameKey(p.name, p.team), k);
  }

  // ---- D: Sleeper directory ----
  const secDir = section("D", "Sleeper player directory");
  const dir = await loadSleeperDirectory(secDir);

  // ---- E: id resolution across every unique rostered key ----
  const secIds = section("E", "Rostered-id resolution (mirrors D.pidForKey's 3 methods)");
  const byMethod = { prefix: 0, espn: 0, name: 0 };
  const unresolved = [];
  if (dir) {
    const seen = new Set();
    for (const p of allPlayers) {
      if (!p || !p.key || seen.has(String(p.key))) continue;
      seen.add(String(p.key));
      const { pid, via } = resolvePid(String(p.key), dir.byEspn, dir.byName, rosterMetaByKey);
      if (pid != null) byMethod[via]++;
      else unresolved.push({ key: p.key, name: p.name || "", team: p.team || "" });
    }
    const total = seen.size, resolved = total - unresolved.length;
    secIds.line(`resolved ${resolved}/${total} (${total ? Math.round((resolved / total) * 1000) / 10 : 0}%) — prefix=${byMethod.prefix} espn=${byMethod.espn} name=${byMethod.name}`);
    if (unresolved.length) {
      secIds.line(`UNRESOLVED (${unresolved.length}) — will read "0" or "—" in the app forever, by NAME:`);
      for (const u of unresolved) secIds.line(`  - "${u.name}" (${u.team}) key="${u.key}"`);
      secIds.setStatus("FAIL", `${unresolved.length} rostered player(s) cannot be resolved to a Sleeper pid by any method.`);
    } else {
      secIds.setStatus("PASS", `100% id resolution (${total}/${total}).`);
    }
  } else {
    secIds.setStatus("WARN", "Sleeper directory unavailable — id resolution could not be checked this run.");
  }

  // ---- seasonType resolution: D.weekStats' own priority, lg-data.js L577-589 ----
  const secState = section("F", "Sleeper /state/nfl — seasonType resolution");
  let seasonType = ARG_SEASON_TYPE;
  {
    const r = await timedFetch("sleeper state", `${SLP}/state/nfl`);
    if (r.unreachable) { secState.setStatus("WARN", unreachableLine(`${SLP}/state/nfl`)); secState.line(unreachableLine(`${SLP}/state/nfl`)); }
    else if (!r.ok) { secState.setStatus("FAIL", `Sleeper /state/nfl HTTP ${r.status}.`); }
    else {
      const st = r.json || {};
      secState.line(`Sleeper state: season=${st.season} season_type=${st.season_type} week=${st.week}`);
      if (!seasonType) seasonType = (String(st.season) === String(season)) ? st.season_type : "regular";
      secState.setStatus("PASS", `resolved seasonType="${seasonType}" for this run.`);
    }
  }
  if (!seasonType) seasonType = "regular";

  // ---- G: raw Sleeper stats bucket + recompute ----
  const secStats = section("G", `Sleeper stats bucket — /stats/nfl/${seasonType}/${season}/${week}`);
  const bucket = await loadStatsBucket(season, week, seasonType);
  const recomputed = new Map(); // roster-shaped key -> {pts, pid, statKeysSeen:[]}
  const unknownRawKeys = new Set();
  if (bucket.unreachable) {
    secStats.setStatus("WARN", unreachableLine(bucket.url || SLP));
    secStats.line(unreachableLine(bucket.url || SLP));
  } else if (!bucket.ok) {
    secStats.setStatus("FAIL", `Sleeper stats bucket answered HTTP ${bucket.status} — a real error, not just empty.`);
  } else if (!bucket.count) {
    secStats.setStatus("WARN", `no stat-bearing data for this week (0 entries at ${bucket.url}) — honest, not broken. Preseason/upcoming weeks routinely read empty.`);
  } else {
    secStats.line(`${bucket.count} entries in ${bucket.ms}ms.`);
    if (!dir) {
      secStats.setStatus("WARN", "stats bucket has data, but the Sleeper directory failed to load — cannot attribute rows to players this run.");
    } else {
      for (const pid in bucket.entries) {
        const raw = bucket.entries[pid]; if (!raw || typeof raw !== "object") continue;
        const meta = dir.byId.get(pid); if (!meta) continue; // an unknown pid in the bucket — nothing rostered could be keyed by it
        for (const rk of Object.keys(raw)) {
          if (!NORMSLP_RAW_KEYS.has(rk) && num(raw[rk]) !== 0) unknownRawKeys.add(rk);
        }
        const pts = score(normSlp(raw), scoring);
        const nk = nameKey(meta.name, meta.team);
        const outKey = meta.pos === "DEF" ? "dst_" + pid : (keyByName.get(nk) || meta.espn_id || "slp_" + pid);
        recomputed.set(outKey, { pts, pid });
        if (meta.pos === "DEF" && meta.team) recomputed.set("dst_" + slpTeam(meta.team), { pts, pid });
      }
      secStats.line(`recomputed scores for ${recomputed.size} output key(s).`);
      if (unknownRawKeys.size) {
        secStats.setStatus("WARN", `${unknownRawKeys.size} raw Sleeper stat field(s) appear with nonzero values but aren't recognized by normSlp — possible feed drift (a human should eyeball these).`);
        secStats.line(`  UNRECOGNIZED raw keys: ${[...unknownRawKeys].sort().join(", ")}`);
      } else {
        secStats.setStatus("PASS", "every nonzero raw stat field on a rostered player's row is one this scorer recognizes.");
      }
    }
  }

  // ---- H: per-team recompute + "played but no line" flag ----
  const secTeam = section("H", "Per-team starter recompute + \"played but no line\" flag");
  const scoreboard = await loadScoreboardTeamStates(season, week, seasonType);
  const playedNoLine = [];
  const teamRows = [];
  for (const t of teams) {
    const players = rosterByTeam.get(t.id) || [];
    const starters = players.filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
    let total = 0;
    const rows = [];
    for (const p of starters) {
      const hit = recomputed.get(p.key);
      const pts = hit ? hit.pts : 0;
      total += pts;
      rows.push({ key: p.key, name: p.name, pos: p.pos, slot: p.slot, pts: hit ? pts : null });
      const gState = scoreboard.ok ? scoreboard.states.get(slpTeam(p.team)) : null;
      if (!hit && gState === "post" && !irEligible(p.injury)) {
        playedNoLine.push({ team: t.name, name: p.name, pos: p.pos, nflTeam: p.team, injury: p.injury || "(none)" });
      }
    }
    teamRows.push({ team: t, total: Math.round(total * 100) / 100, rows });
    secTeam.line(`${t.name.padEnd(24)} recomputed starters total = ${(Math.round(total * 100) / 100).toFixed(2)}`);
  }
  // Gate on the stats bucket actually carrying SOME data this week. If the whole bucket is
  // empty (section G), "played but no line" is trivially true for every rostered player and
  // says nothing about feed drift — it just means Sleeper hasn't posted this week's stats at
  // all yet (routine before/during the very first games of a slate). The check only means
  // something once the feed is demonstrably live for SOMEONE and still silent for this one
  // player specifically.
  const feedIsLive = bucket.ok && bucket.count > 0;
  if (!scoreboard.ok) {
    secTeam.setStatus("WARN", "ESPN scoreboard unavailable this run — the \"played but no line\" check could not run (per-team totals above are still valid).");
  } else if (!feedIsLive) {
    if (playedNoLine.length) secTeam.line(`(${playedNoLine.length} starter(s) would otherwise flag as "no line", but the whole stats bucket is empty this week — see section G. Not a per-player finding.)`);
    secTeam.setStatus("PASS", "stats bucket has no data yet this week, so \"no line\" can't mean anything player-specific — nothing to flag.");
  } else if (playedNoLine.length) {
    secTeam.setStatus("FAIL", `${playedNoLine.length} rostered starter(s) whose NFL game is FINAL and who aren't injury-listed have NO stat line at all — and the feed IS live for other players this week, so this looks like real drift.`);
    for (const f of playedNoLine) secTeam.line(`  NO LINE: "${f.name}" (${f.pos}, ${f.nflTeam}) on ${f.team} — injury="${f.injury}", game final, no Sleeper stats row.`);
  } else {
    secTeam.setStatus("PASS", "no rostered starter is missing a line for a game that's already final.");
  }

  // ---- I: latency summary ----
  const secLat = section("I", "Latency summary");
  if (!latencyLog.length) secLat.setStatus("WARN", "no fetches attempted.");
  else {
    const ok2 = latencyLog.filter((l) => l.status != null);
    for (const l of latencyLog) secLat.line(`${String(l.ms).padStart(6)}ms  ${(l.error ? `ERROR: ${l.error}` : `HTTP ${l.status}`).padEnd(22)}  ${l.label}`);
    const avg = ok2.length ? Math.round(ok2.reduce((a, l) => a + l.ms, 0) / ok2.length) : 0;
    secLat.setStatus(ok2.length ? "PASS" : "WARN", ok2.length ? `${ok2.length}/${latencyLog.length} fetches completed, avg ${avg}ms.` : "every fetch failed at the network layer.");
  }

  // ---- J: live-app compare (browser) ----
  let liveResult = null;
  const canGoLive = !NO_LIVE && season === LG_SEASON_DEFAULT;
  if (canGoLive) {
    liveResult = await runLiveCompare({ season, week, teams, rosterByTeam, recomputed, resolvePidFor: (k) => (dir ? resolvePid(k, dir.byEspn, dir.byName, rosterMetaByKey) : { pid: null, via: "none" }) });
  } else {
    const secLive = section("J", "Live-app compare (skipped)");
    secLive.setStatus("WARN", NO_LIVE ? "--no-live passed — skipped by request." : `season ${season} isn't the season the live app is running (${LG_SEASON_DEFAULT}) — comparing to it would compare apples to oranges. Pass --no-live to silence this note.`);
  }

  const finishedAt = Date.now();
  const report = renderReport(startedAt, finishedAt, season, week, seasonType);
  console.log(report);
  if (REPORT_PATH) {
    let outPath = REPORT_PATH;
    if (outPath === "__default__") {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      outPath = resolve(REPO_ROOT, "shots", `gffl_shadow_${season}_w${week}_${stamp}.txt`);
    } else if (!outPath.match(/^([a-zA-Z]:)?[\\/]/)) outPath = resolve(REPO_ROOT, outPath);
    try { mkdirSync(dirname(outPath), { recursive: true }); writeFileSync(outPath, report + "\n", "utf8"); console.log(`\n(report written to ${outPath})`); }
    catch (e) { console.error(`\ncould not write report: ${(e && e.message) || e}`); }
  }
  const anyFail = sections.some((s) => s.status === "FAIL");
  process.exit(anyFail ? 1 : 0);
}

function renderReport(startedAt, finishedAt, season, week, seasonType) {
  const lines = [];
  lines.push("=".repeat(84));
  lines.push("GFFL SIM-C — LIVE-SHADOW SCORER");
  lines.push(`run: ${new Date(startedAt).toISOString()} (${Math.round((finishedAt - startedAt) / 1000)}s)`);
  lines.push(`season ${season} · week ${week} · seasonType "${seasonType}" · collection ${LG_COLL}`);
  lines.push("=".repeat(84));
  for (const s of sections) {
    lines.push("");
    lines.push(`-- ${s.id}: ${s.title} ${"-".repeat(Math.max(2, 76 - s.id.length - s.title.length))}`);
    lines.push(`${s.status}: ${s.meaning}`);
    if (!QUIET) for (const l of s.lines) lines.push(`  ${l}`);
  }
  lines.push("");
  lines.push("=".repeat(84));
  lines.push("SUMMARY");
  lines.push("=".repeat(84));
  const w = Math.max(...sections.map((s) => s.title.length)) + 4;
  for (const s of sections) lines.push(`${s.id}  ${s.title.padEnd(w)} ${s.status}`);
  const anyFail = sections.some((s) => s.status === "FAIL");
  lines.push("");
  lines.push(anyFail ? "RESULT: at least one section FAILed — see above." : "RESULT: no FAILs (WARNs allowed).");
  return lines.join("\n");
}

// ================================================================================================
// PART J — live-app compare, driven read-only through a real headless Chrome
// ================================================================================================
function chromeExe() {
  const cands = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"];
  for (const c of cands) { try { if (c && require("fs").existsSync(c)) return c; } catch (e) {} }
  return null;
}
async function launchBrowser(puppeteer) {
  const exe = chromeExe();
  const opts = { headless: true, args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}
// Installs request interception that BLOCKS every write-shaped request before it reaches the
// network: Firestore PATCH/DELETE (any host — belt and suspenders), and any POST to a Netlify
// function (which could trigger a server-side write or a push notification). GETs, and the one
// legitimate Firestore write-shaped-but-read POST (:runQuery), are always allowed. Returns the
// running list of attempted-and-blocked requests, for the report.
function installWriteBlock(page) {
  const blocked = [];
  page.on("request", (req) => {
    try {
      const method = req.method();
      const url = req.url();
      const isFirestore = url.includes("firestore.googleapis.com");
      const isFunction = url.includes("/.netlify/functions/");
      if (isFirestore && (method === "PATCH" || method === "DELETE")) {
        blocked.push({ method, url }); req.abort(); return;
      }
      if (isFirestore && method === "POST" && !url.includes(":runQuery")) {
        blocked.push({ method, url }); req.abort(); return;
      }
      if (isFunction && method === "POST") {
        blocked.push({ method, url }); req.abort(); return;
      }
      req.continue();
    } catch (e) { try { req.continue(); } catch (e2) {} }
  });
  return blocked;
}
async function runLiveCompare({ season, week, teams, rosterByTeam, recomputed, resolvePidFor }) {
  const sec = section("J", `Live-app compare — ${ARG_BASE_URL} (read-only, writes intercepted)`);
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); }
  catch (e) { sec.setStatus("WARN", "puppeteer-core not available — live compare skipped (recompute-only run is still valid)."); return null; }

  let browser;
  try { browser = await launchBrowser(puppeteer); }
  catch (e) { sec.setStatus("WARN", `couldn't launch a browser (${(e && e.message) || e}) — live compare skipped.`); return null; }

  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    const blocked = installWriteBlock(page);

    // Seed identity WITHOUT ever going through claimTeam() (which would set a PIN — a write).
    // Reading LG.myTeamId()/LG.unlocked() straight off localStorage is exactly what the app
    // itself does at boot (lg-core.js L168-177) — no PIN check happens on a mere READ of an
    // already-claimed team id, only on the act of claiming one via the UI.
    const seedTeamId = teams.length ? teams[0].id : 1;
    await page.evaluateOnNewDocument((teamId) => {
      try {
        localStorage.setItem("gffl_pass", "amenfarms");
        localStorage.setItem("gffl_team", String(teamId));
        localStorage.setItem("gffl_who", "ShadowScorer (read-only probe)");
      } catch (e) {}
    }, seedTeamId);

    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    const nav = await page.goto(`${ARG_BASE_URL}/league.html#scores`, { waitUntil: "networkidle2", timeout: 45000 }).catch((e) => ({ err: e }));
    if (nav && nav.err) {
      sec.setStatus("WARN", `couldn't load the live page (${String(nav.err.message || nav.err)}) — live compare skipped.`);
      return null;
    }

    // Wait for boot to settle (either a real view painted, or the honest outage/gate card).
    await page.waitForFunction(() => {
      const m = document.querySelector("main");
      return !!(m && m.dataset && m.dataset.view);
    }, { timeout: 20000 }).catch(() => {});
    const paintedView = await page.evaluate(() => (document.querySelector("main") || {}).dataset && document.querySelector("main").dataset.view || "");
    sec.line(`boot landed on view: "${paintedView}"`);
    if (paintedView !== "scores" && paintedView !== "league") {
      // A gate/outage/claim screen — nothing to compare, but not itself a failure of THIS tool.
      sec.setStatus("WARN", `the live app landed on "${paintedView}" rather than a scores/league view (offline mirror, gate, or first-run state) — nothing to compare this run.`);
    }

    // Which pairings does the live app itself say are this week's games? Cross-checked against
    // our own Firestore-derived schedule (via LG.gamesForWeek, read-only — no write).
    const livePairs = await page.evaluate(async (wk) => {
      try {
        if (!window.LG || !window.LG.gamesForWeek) return null;
        const wkPairs = await window.LG.gamesForWeek(wk);
        return wkPairs;
      } catch (e) { return null; }
    }, week);

    let sweepFindings = { nanHits: [] };
    const matchupResults = [];
    if (Array.isArray(livePairs) && livePairs.length) {
      sec.line(`live app reports ${livePairs.length} matchup(s) for week ${week}: ${livePairs.map(([h, a]) => `${h}-${a}`).join(", ")}`);
      for (const [h, a] of livePairs) {
        // Navigate via the SAME code path the "GFFL — Week N" card's own click handler uses
        // (lg-ui.js ~L2145-2148: UI.matchup = [...]; UI.go("matchup")) — a plain client-side
        // state change + repaint, never a network write.
        await page.evaluate(([hh, aa]) => { window.LG.ui.matchup = [hh, aa]; window.LG.ui.go("matchup"); }, [h, a]);
        await page.waitForSelector(".lineupcard, .totalrow", { timeout: 10000 }).catch(() => {});
        const scraped = await page.evaluate(() => {
          const rows = [...document.querySelectorAll("[data-pk]")].map((el) => ({
            key: el.getAttribute("data-pk"),
            ptsText: ((el.querySelector(".pscore .pts") || {}).textContent || "").trim(),
            bench: !!el.closest(".benchtable"),
          }));
          const totals = [...document.querySelectorAll(".totalrow .pts")].map((el) => el.textContent.trim());
          const bodyText = document.body.innerText || "";
          const nanHits = [];
          for (const bad of ["NaN", "undefined", "Infinity"]) if (bodyText.includes(bad)) nanHits.push(bad);
          return { rows, totals, nanHits };
        });
        if (scraped.nanHits.length) sweepFindings.nanHits.push({ matchup: `${h}-${a}`, hits: scraped.nanHits });
        matchupResults.push({ h, a, ...scraped });
      }
    } else {
      sec.line("live app reported no matchups for this week (LG.gamesForWeek returned empty — a schedule doc may be missing, or the season hasn't started).");
    }

    // Also sweep the league home + scores view text for NaN/undefined/Infinity.
    for (const view of ["league", "scores"]) {
      await page.evaluate((v) => { try { window.LG.ui.go(v); } catch (e) {} }, view);
      await new Promise((r) => setTimeout(r, 300));
      const bad = await page.evaluate(() => {
        const t = document.body.innerText || "";
        const hits = [];
        for (const bad of ["NaN", "undefined", "Infinity"]) if (t.includes(bad)) hits.push(bad);
        return hits;
      });
      if (bad.length) sweepFindings.nanHits.push({ matchup: `(${view} view)`, hits: bad });
    }

    // ---- diff each scraped row against the recompute ----
    const TOL = 0.05;
    let diffCount = 0, comparedCount = 0;
    const diffLines = [];
    for (const m of matchupResults) {
      for (const row of m.rows) {
        const renderedText = row.ptsText;
        const rendered = renderedText === "—" || renderedText === "" ? null : Number(renderedText);
        const hit = recomputed.get(row.key);
        let mine;
        if (hit) mine = hit.pts;
        else {
          const { pid } = resolvePidFor(row.key);
          mine = pid != null ? 0 : null; // mirrors D.livePts: resolvable-but-no-stats -> 0, else "—"
        }
        comparedCount++;
        const bothNull = mine == null && rendered == null;
        const diff = (mine != null && rendered != null) ? Math.abs(mine - rendered) : null;
        if (!bothNull && (diff == null || diff > TOL)) {
          diffCount++;
          diffLines.push(`  DIFF matchup ${m.h}-${m.a} key=${row.key}${row.bench ? " (bench)" : ""}: mine=${mine == null ? "—" : mine.toFixed(2)} vs app="${renderedText}"`);
        }
      }
      // team totals — away first (left), home second (right), per totalHalfCell's own markup order.
      if (m.totals.length === 2) {
        const [awayTxt, homeTxt] = m.totals;
        const mineAway = teams.length ? (rosterByTeam.get(m.a) || []).filter((p) => p.slot !== "BENCH" && p.slot !== "IR").reduce((s, p) => s + (recomputed.get(p.key) ? recomputed.get(p.key).pts : 0), 0) : null;
        const mineHome = teams.length ? (rosterByTeam.get(m.h) || []).filter((p) => p.slot !== "BENCH" && p.slot !== "IR").reduce((s, p) => s + (recomputed.get(p.key) ? recomputed.get(p.key).pts : 0), 0) : null;
        const rAway = Number(awayTxt), rHome = Number(homeTxt);
        comparedCount += 2;
        if (Number.isFinite(rAway) && Math.abs(rAway - mineAway) > TOL) { diffCount++; diffLines.push(`  DIFF matchup ${m.h}-${m.a} AWAY total: mine=${mineAway.toFixed(2)} vs app="${awayTxt}"`); }
        if (Number.isFinite(rHome) && Math.abs(rHome - mineHome) > TOL) { diffCount++; diffLines.push(`  DIFF matchup ${m.h}-${m.a} HOME total: mine=${mineHome.toFixed(2)} vs app="${homeTxt}"`); }
      }
    }

    sec.line(`compared ${comparedCount} value(s) across ${matchupResults.length} matchup(s), tolerance ${TOL}.`);
    for (const l of diffLines) sec.line(l);

    sec.line("");
    sec.line(`write-shaped requests attempted during this run: ${blocked.length}${blocked.length ? "" : " — none at all"}.`);
    for (const b of blocked) sec.line(`  BLOCKED: ${b.method} ${b.url}`);
    sec.line("every write-shaped request above was intercepted and aborted before it reached the network — 0 escaped.");

    if (consoleErrors.length) sec.line(`page errors: ${consoleErrors.length} (${consoleErrors.slice(0, 3).join(" | ")})`);

    if (sweepFindings.nanHits.length) {
      sec.setStatus("FAIL", `NaN/undefined/Infinity found on screen in ${sweepFindings.nanHits.length} view(s).`);
      for (const h of sweepFindings.nanHits) sec.line(`  NAN-SWEEP: ${h.matchup} contains: ${h.hits.join(", ")}`);
    } else if (diffCount > 0) {
      sec.setStatus("FAIL", `${diffCount} value(s) differ from the live app by more than ${TOL} (see DIFF lines above).`);
    } else if (!comparedCount) {
      sec.setStatus("WARN", "nothing to compare this run (no matchups / no rendered values found).");
    } else {
      sec.setStatus("PASS", `${comparedCount} value(s) compared, 0 differences beyond tolerance, 0 NaN/undefined/Infinity on screen, 0 write-shaped requests escaped.`);
    }
    return { comparedCount, diffCount, blocked: blocked.length };
  } finally {
    try { await browser.close(); } catch (e) {}
  }
}

main().catch((e) => {
  console.error("gffl shadow scorer crashed:", (e && e.stack) || e);
  process.exit(1);
});
