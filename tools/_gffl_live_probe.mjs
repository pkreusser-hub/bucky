#!/usr/bin/env node
// tools/_gffl_live_probe.mjs — GFFL R0/P1 live-feed probe (ffleague-plan.md ~L1296-1300).
//
// READ-ONLY. Every request here is a document GET, a Firestore :runQuery (read), or a public
// API GET — nothing here ever POSTs/PATCHes/DELETEs against Firestore or any league state, and
// nothing writes to disk except (optionally) the human-readable report this script itself
// prints. Safe to run against production at any time, including during a live game.
//
// It exists to answer ffleague-plan.md's "what is actually unproven" list (§R0, items 1-4) by
// running the APP'S OWN PARSE LOGIC against the REAL ESPN + Sleeper feeds and the REAL league's
// Firestore docs — not a re-imagining of that logic. Every parser below is a small, literal port
// of a function in assets/league/lg-data.js or assets/league/lg-core.js, with a comment naming
// the source. Do not "improve" the parsing here without checking it still matches the app; the
// whole point of this tool is that a probe PASS means the app's real code path would also pass.
//
// Usage:
//   node tools/_gffl_live_probe.mjs                 # run all probes, print report to stdout
//   node tools/_gffl_live_probe.mjs --report [path]  # also write the report under shots/
//   node tools/_gffl_live_probe.mjs --quiet          # summary + PASS/WARN/FAIL only, no detail lines
//   node tools/_gffl_live_probe.mjs --selftest       # parser fixtures only, NO network at all
//
// Exit code: 0 unless at least one section FAILed (WARN never fails the run).

"use strict";

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ---------------- CLI args ----------------
const argv = process.argv.slice(2);
const QUIET = argv.includes("--quiet");
const SELFTEST = argv.includes("--selftest");
let REPORT_PATH = null;
{
  const i = argv.indexOf("--report");
  if (i !== -1) {
    const next = argv[i + 1];
    REPORT_PATH = next && !next.startsWith("--") ? next : "__default__";
  }
}

// ---------------- constants (mirrored verbatim from the app) ----------------
// ESPN/SLP base URLs: assets/league/lg-data.js L14-15.
const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SLP = "https://api.sleeper.app/v1";
// Firestore REST transport: assets/league/lg-core.js L271-272 (FS_KEY is the public web API
// key already shipped in the client bundle; Firestore rules are public — same posture as every
// other read this app already performs from a browser).
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";
// LG.PASS + roomId(): lg-core.js L9, L14, L17-22. famKey defaults to roomId(LG.PASS) when no
// ?fam= override is present — the real family league's collection.
const LG_PASS = "amenfarms";
const LG_SEASON = 2026;
const LG_SEASON_START = "2026-09-08"; // lg-core.js L12
function roomId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "fam" + Math.abs(h).toString(36);
}
const FAM_KEY = roomId(LG_PASS);
const LG_COLL = "gffl_" + FAM_KEY; // lg-core.js L15

// currentWeek(): lg-core.js L1541-1545, ported verbatim (used only to pick which roster/week
// docs to read — never written).
function currentWeek(nowMs) {
  const start = new Date(LG_SEASON_START + "T05:00:00-05:00").getTime();
  const w = 1 + Math.floor((nowMs - start) / (7 * 24 * 3600 * 1000));
  return Math.max(1, Math.min(18, w));
}

// ---------------- mirrored parsers (each cites its source) ----------------

// normSeasonType(): lg-data.js L494-506, byte-for-byte.
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

// normName()/slpTeam()/nameKey(): lg-data.js L18-30.
const slpTeam = (ab) => (ab === "WSH" ? "WAS" : ab || "");
const ALIAS = { "bam knight": "zonovan knight" };
function normName(n) {
  n = String(n || "").toLowerCase().replace(/[^a-z ]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").trim().replace(/ +/g, " ");
  return ALIAS[n] || n;
}
const nameKey = (name, teamAb) => normName(name) + "|" + slpTeam(teamAb);

// The season.type resolution ladder used by pollScoreboard(): lg-data.js L883.
//   D.S.espnSeasonType = normSeasonType(j?.season?.type ?? j?.season?.slug ?? j?.leagues?.[0]?.season?.type?.type);
// This is a `??` FALLBACK CHAIN (first defined field wins), not "try all three independently" —
// mirrored exactly, plus we separately record which of the three raw fields were actually
// present, for diagnostic transparency the app itself doesn't need.
function resolveEspnSeasonType(j) {
  const numericType = j?.season?.type;
  const slug = j?.season?.slug;
  const nested = j?.leagues?.[0]?.season?.type?.type;
  const raw = numericType ?? slug ?? nested;
  return {
    resolved: normSeasonType(raw),
    raw,
    fields: {
      "season.type (numeric)": numericType,
      "season.slug": slug,
      "leagues[0].season.type.type (legacy nested)": nested,
    },
  };
}

// week.number: lg-data.js L876-877.
function resolveEspnWeek(j) {
  const wkNum = Number(j?.week?.number);
  return wkNum >= 1 && wkNum <= 22 ? wkNum : null;
}

// "Stat-bearing" projection/stats row check — mirrors D.simProjUsable(), lg-data.js L1338-1348,
// verbatim field list and the ≥25-row threshold (an ADP-only husk has zero of these fields; a
// genuine projection/stats week has hundreds). Used here for BOTH the projections buckets and
// the stats buckets (D.normSlp reads the identical key set for scoring — lg-data.js L95-118 —
// so the same "does this row carry real numbers" test applies to either endpoint shape).
function statBearingCount(map) {
  let n = 0;
  if (!map || typeof map !== "object") return 0;
  for (const k in map) {
    const r = map[k];
    if (r && (Number(r.pass_yd) || Number(r.rush_yd) || Number(r.rec_yd) || Number(r.rec) ||
              Number(r.pass_td) || Number(r.fgm_yds) || Number(r.xpm) || Number(r.def_sack) || Number(r.sack))) {
      n++;
    }
  }
  return n;
}
const STAT_BEARING_THRESHOLD = 25;

// ---- Firestore REST codec: lg-core.js L308-327, verbatim (decode-only; this tool never encodes). ----
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

// ---- the ONE id resolver, mirrored from D.pidForKey's resolvePid(): lg-data.js L431-444. ----
// Three methods, cheapest and most certain first: (1) an explicit dst_/slp_ prefix carries the
// pid outright; (2) the espn_id index (Sleeper's directory, byEspn); (3) NAME + TEAM, using
// whatever the roster doc itself already knows (mirrors D.S.rosterMetaByKey — here we build that
// map directly from the roster entries we just read, since a probe has no live poll to seed it).
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

// ---- kicking-category box parse, the subset of parseEspnBox() (lg-data.js L123-162) this
// probe needs: given an ESPN summary payload, return every kicker who made >=1 FG that game. ----
function parseEspnKickers(summary) {
  const out = [];
  for (const t of (summary?.boxscore?.players || [])) {
    const teamAb = t?.team?.abbreviation || "";
    for (const cat of (t?.statistics || [])) {
      if (cat.name !== "kicking") continue;
      const labels = cat.labels || [];
      const gi = {}; labels.forEach((l, i) => { gi[l] = i; });
      for (const a of (cat.athletes || [])) {
        const ath = a.athlete || {};
        const v = a.stats || [];
        const g = (lab) => (gi[lab] != null ? v[gi[lab]] : undefined);
        const fg = String(g("FG") || "");
        if (fg.includes("/")) {
          const [made, att] = fg.split("/").map(Number);
          if (made > 0) {
            out.push({
              espnId: ath.id != null ? String(ath.id) : null,
              name: ath.displayName || ath.shortName || "",
              team: teamAb, made, att: att || 0,
            });
          }
        }
      }
    }
  }
  return out;
}

// ---------------- fetch wrapper (bounded, timed — fx(): lg-data.js L296-315 / fsFetch(): ----
// lg-core.js L341-355). One AbortController timeout so a hung host can never hang this tool. ----
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
    // A DNS failure / connection refusal / fetch-blocked-by-sandbox all land here. This is the
    // one signal that turns into "<host> unreachable from this environment" per probe.
    return { ok: false, status: null, json: null, text: null, ms: rec.ms, unreachable: true, error: rec.error };
  } finally { clearTimeout(timer); }
}
function hostOf(url) { try { return new URL(url).host; } catch (e) { return url; } }
function unreachableLine(url) {
  return `${hostOf(url)} unreachable from this environment — run me from a normal shell.`;
}

// ---------------- report accumulator ----------------
const sections = [];
function section(id, title) {
  const s = { id, title, status: "PASS", meaning: "", lines: [] };
  sections.push(s);
  return {
    line(s2) { s.lines.push(s2); },
    setStatus(st, meaning) {
      // FAIL > WARN > PASS — never downgrade a section's status once it's been raised.
      const rank = { PASS: 0, WARN: 1, FAIL: 2 };
      if (rank[st] > rank[s.status]) { s.status = st; s.meaning = meaning; }
      else if (!s.meaning && meaning) s.meaning = meaning;
    },
    raw: s,
  };
}

// ==================================================================================
// PROBE 1 — ESPN scoreboard season.type
// ==================================================================================
async function probe1() {
  const sec = section("P1", "ESPN scoreboard — season.type resolution");
  const r = await timedFetch("espn scoreboard (bare)", `${ESPN}/scoreboard`);
  if (r.unreachable) {
    sec.setStatus("WARN", unreachableLine(`${ESPN}/scoreboard`));
    sec.line(unreachableLine(`${ESPN}/scoreboard`));
    return sec.raw;
  }
  if (!r.ok) {
    sec.setStatus("FAIL", `ESPN scoreboard answered HTTP ${r.status} — finalizeWeek's guard has nothing to read.`);
    sec.line(`HTTP ${r.status}, ${r.ms}ms`);
    return sec.raw;
  }
  const { resolved, raw, fields } = resolveEspnSeasonType(r.json);
  const wk = resolveEspnWeek(r.json);
  sec.line(`HTTP ${r.status} in ${r.ms}ms`);
  sec.line(`raw fields: ${JSON.stringify(fields)}`);
  sec.line(`resolved season.type -> ${resolved === null ? "null" : `"${resolved}"`} (from raw=${JSON.stringify(raw)})`);
  sec.line(`week.number -> ${wk === null ? "null" : wk}`);
  if (resolved === null) {
    sec.setStatus("FAIL", "resolved null — the finalize guard cannot see the season type and will refuse all finalizes.");
  } else if (resolved === "pre") {
    sec.setStatus("PASS", 'resolved "pre" as expected for today (Aug 10-23 2026 preseason window).');
  } else {
    sec.setStatus("WARN", `resolved "${resolved}", not "pre" — expected during the preseason window; confirm today's real-world date/slate before treating this as a problem.`);
  }
  sec.raw.espnResolved = resolved;
  return sec.raw;
}

// ==================================================================================
// PROBE 2 — Sleeper /v1/state/nfl
// ==================================================================================
async function probe2(espnResolved) {
  const sec = section("P2", "Sleeper /v1/state/nfl — week/season_type agreement with ESPN");
  const r = await timedFetch("sleeper state", `${SLP}/state/nfl`);
  if (r.unreachable) {
    sec.setStatus("WARN", unreachableLine(`${SLP}/state/nfl`));
    sec.line(unreachableLine(`${SLP}/state/nfl`));
    return { sec: sec.raw, week: null, seasonType: null, season: null };
  }
  if (!r.ok) {
    sec.setStatus("FAIL", `Sleeper /state/nfl answered HTTP ${r.status}.`);
    sec.line(`HTTP ${r.status}, ${r.ms}ms`);
    return { sec: sec.raw, week: null, seasonType: null, season: null };
  }
  const st = r.json || {};
  const slpResolved = normSeasonType(st.season_type);
  const week = Number.isFinite(Number(st.week)) ? Number(st.week) : null;
  sec.line(`HTTP ${r.status} in ${r.ms}ms — season=${st.season} season_type="${st.season_type}" week=${st.week} display_week=${st.display_week}`);
  sec.line(`resolved -> "${slpResolved}"`);
  if (espnResolved == null) {
    sec.setStatus("WARN", "ESPN's own season.type was unavailable this run — nothing to compare against.");
  } else if (slpResolved === espnResolved) {
    sec.setStatus("PASS", `agrees with ESPN ("${slpResolved}").`);
  } else {
    sec.setStatus("WARN", `disagrees with ESPN — ESPN="${espnResolved}" Sleeper="${slpResolved}". D.engineSeasonType() would read null (providers disagree -> refuse-to-write, by design).`);
  }
  return { sec: sec.raw, week, seasonType: st.season_type || null, season: st.season || String(LG_SEASON) };
}

// ==================================================================================
// PROBE 3 — Sleeper projections + stats presence (pre + regular buckets)
// ==================================================================================
async function probeBucket(label, url) {
  const r = await timedFetch(label, url);
  if (r.unreachable) return { label, url, unreachable: true, error: r.error };
  if (!r.ok) return { label, url, ok: false, status: r.status, ms: r.ms };
  const entries = r.json && typeof r.json === "object" ? Object.keys(r.json).length : 0;
  const statBearing = statBearingCount(r.json);
  return { label, url, ok: true, status: r.status, ms: r.ms, entries, statBearing, usable: statBearing >= STAT_BEARING_THRESHOLD };
}
async function probe3(slpState) {
  const sec = section("P3", "Sleeper projections + stats — presence & stat-bearing check");
  const week = slpState.week;
  const seasonType = slpState.seasonType; // e.g. "pre"
  const season = slpState.season || String(LG_SEASON);
  const results = [];

  if (week != null && seasonType) {
    results.push(await probeBucket(
      `sleeper projections ${seasonType}/${season}/${week} (current pre week)`,
      `${SLP}/projections/nfl/${seasonType}/${season}/${week}`));
    results.push(await probeBucket(
      `sleeper stats ${seasonType}/${season}/${week} (current pre week)`,
      `${SLP}/stats/nfl/${seasonType}/${season}/${week}`));
  } else {
    sec.line("no authoritative Sleeper week from Probe 2 — skipping the current-week pre buckets.");
  }
  results.push(await probeBucket(
    `sleeper projections regular/${LG_SEASON}/1 (forward regular-season bucket)`,
    `${SLP}/projections/nfl/regular/${LG_SEASON}/1`));

  let anyFail = false, anyUnreachable = false, anyNoData = false, anyUsable = false;
  for (const r of results) {
    if (r.unreachable) { anyUnreachable = true; sec.line(unreachableLine(r.url)); continue; }
    if (!r.ok) { anyFail = true; sec.line(`${r.label}: HTTP ${r.status} — FAIL`); continue; }
    const verdict = r.entries === 0 ? "EMPTY (no data — bare-not-broken)"
      : r.usable ? `USABLE (${r.statBearing}/${r.entries} rows carry real stat fields)`
      : `PRESENT BUT NOT STAT-BEARING — ADP-husk (${r.statBearing}/${r.entries} rows carry real stat fields, threshold ${STAT_BEARING_THRESHOLD})`;
    if (r.entries === 0 || !r.usable) anyNoData = true; else anyUsable = true;
    sec.line(`${r.label}: HTTP ${r.status} in ${r.ms}ms, ${r.entries} entries — ${verdict}`);
  }
  if (results.length === 0) {
    sec.setStatus("WARN", "nothing to probe (no authoritative week).");
  } else if (anyFail) {
    sec.setStatus("FAIL", "at least one Sleeper bucket answered a real HTTP error (not just empty).");
  } else if (anyUnreachable && !anyUsable) {
    sec.setStatus("WARN", "at least one bucket was unreachable from this sandbox.");
  } else if (anyNoData && !anyUsable) {
    sec.setStatus("WARN", "no bucket carried real (stat-bearing) data this run — PROJ will read \"—\" in the app; that is honest, not broken, but confirm this is expected right now.");
  } else {
    sec.setStatus("PASS", "at least one bucket carried real stat-bearing rows.");
  }
  return sec.raw;
}

// ==================================================================================
// Shared: Sleeper /v1/players/nfl pool (fetched once, lazily, reused by P4 + P5)
// ==================================================================================
let _playerPoolPromise = null;
function loadPlayerPool() {
  if (_playerPoolPromise) return _playerPoolPromise;
  _playerPoolPromise = (async () => {
    const r = await timedFetch("sleeper players (full pool, ~5-15MB)", `${SLP}/players/nfl`);
    if (r.unreachable || !r.ok || !r.json) return { byEspn: new Map(), byName: new Map(), ok: false, err: r.unreachable ? unreachableLine(`${SLP}/players/nfl`) : `HTTP ${r.status}`, ms: r.ms };
    const byEspn = new Map(), byName = new Map();
    for (const pid in r.json) {
      const p = r.json[pid]; if (!p || typeof p !== "object") continue;
      const name = p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim() || pid;
      const team = p.team || "";
      const espn_id = p.espn_id != null ? String(p.espn_id) : null;
      if (espn_id) byEspn.set(espn_id, { pid, name, team });
      if (team) byName.set(nameKey(name, team), { pid, name, team });
    }
    return { byEspn, byName, ok: true, ms: r.ms, count: Object.keys(r.json).length };
  })();
  return _playerPoolPromise;
}

// ==================================================================================
// Firestore read helpers (GET only — never a write)
// ==================================================================================
async function fsGetDoc(id) {
  const url = `${FS_BASE}/${encodeURIComponent(LG_COLL)}/${encodeURIComponent(id)}?key=${FS_KEY}`;
  const r = await timedFetch(`firestore GET ${id}`, url);
  if (r.unreachable) return { unreachable: true, error: r.error };
  if (r.status === 404) return { ok: true, doc: null };
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, doc: fsDecFields(r.json && r.json.fields) };
}
async function fsListKind(kind) {
  const body = { structuredQuery: { from: [{ collectionId: LG_COLL }], where: { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: kind } } } } };
  const r = await timedFetch(`firestore :runQuery kind=${kind}`, `${FS_BASE}:runQuery?key=${FS_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
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

// ==================================================================================
// PROBE 4 — id resolution against the real league's real rosters
// ==================================================================================
async function probe4() {
  const sec = section("P4", "Real roster id resolution vs the real Sleeper pool");
  sec.line(`league collection: ${LG_COLL} (fam key from roomId("${LG_PASS}"))`);

  const teamsRes = await fsListKind("team");
  if (teamsRes.unreachable) {
    sec.setStatus("WARN", unreachableLine(FS_BASE));
    sec.line(unreachableLine(FS_BASE));
    return sec.raw;
  }
  if (!teamsRes.ok) {
    sec.setStatus("FAIL", `Firestore team query answered HTTP ${teamsRes.status}.`);
    return sec.raw;
  }
  const teams = teamsRes.rows;
  sec.line(`found ${teams.length} team doc(s) (kind:"team") in ${LG_COLL}.`);
  if (!teams.length) {
    sec.setStatus("WARN", "no team docs found — nothing to resolve. (Empty league, or wrong collection.)");
    return sec.raw;
  }

  const wk = currentWeek(Date.now());
  sec.line(`computed current week (LG.currentWeek() mirror) = ${wk}`);

  // Read each team's roster for the current week, falling back to earlier weeks the same way
  // LG.ensureRoster does (lg-core.js L1039-1043) — read-only, never a write-forward.
  let allPlayers = [];
  const teamRosterNotes = [];
  for (const t of teams) {
    const teamId = t.teamId;
    let found = null, foundWeek = null;
    for (let w = wk; w >= 1 && !found; w--) {
      const id = `roster_${LG_SEASON}_w${w}_t${teamId}`;
      const r = await fsGetDoc(id);
      if (r.unreachable) { teamRosterNotes.push(`team ${teamId} (${t.name || "?"}): ${unreachableLine(FS_BASE)}`); found = "unreachable"; break; }
      if (!r.ok) { teamRosterNotes.push(`team ${teamId} (${t.name || "?"}): Firestore error reading roster`); break; }
      if (r.doc && Array.isArray(r.doc.players)) { found = r.doc.players; foundWeek = w; }
    }
    if (found === "unreachable") continue;
    if (!found) { teamRosterNotes.push(`team ${teamId} (${t.name || "?"}): no roster doc found for any week 1..${wk}.`); continue; }
    teamRosterNotes.push(`team ${teamId} (${t.name || "?"}): roster_${LG_SEASON}_w${foundWeek}_t${teamId} — ${found.length} players.`);
    allPlayers.push(...found);
  }
  for (const l of teamRosterNotes) sec.line(l);

  if (!allPlayers.length) {
    sec.setStatus("WARN", "no rostered players found on any team to test resolution against.");
    return sec.raw;
  }

  const pool = await loadPlayerPool();
  if (!pool.ok) {
    sec.setStatus("WARN", `Sleeper player pool unavailable — ${pool.err}`);
    return sec.raw;
  }
  sec.line(`Sleeper player pool: ${pool.count} entries, fetched in ${pool.ms}ms.`);

  // rosterMetaByKey mirrors D.S.rosterMetaByKey (populated from the roster docs themselves,
  // exactly what D.registerRosterPlayers does — lg-data.js L416-429).
  const rosterMetaByKey = new Map();
  for (const p of allPlayers) { if (p && p.key && !rosterMetaByKey.has(String(p.key))) rosterMetaByKey.set(String(p.key), { name: p.name, team: p.team }); }

  const seen = new Set();
  const byMethod = { prefix: 0, espn: 0, name: 0 };
  const missing = [];
  for (const p of allPlayers) {
    if (!p || !p.key) continue;
    const k = String(p.key);
    if (seen.has(k)) continue;
    seen.add(k);
    const { pid, via } = resolvePid(k, pool.byEspn, pool.byName, rosterMetaByKey);
    if (pid != null) byMethod[via]++;
    else missing.push({ key: k, name: p.name || "", team: p.team || "" });
  }

  const total = seen.size, resolved = total - missing.length;
  const pct = total ? Math.round((resolved / total) * 1000) / 10 : 0;
  sec.line(`total unique rostered players: ${total}`);
  sec.line(`resolved: ${resolved}/${total} (${pct}%) — by method: prefix=${byMethod.prefix} espn=${byMethod.espn} name=${byMethod.name}`);
  if (missing.length) {
    sec.line(`UNRESOLVED (${missing.length}):`);
    for (const m of missing) sec.line(`  - key="${m.key}" name="${m.name}" team="${m.team}"`);
  }

  if (missing.length === 0) {
    sec.setStatus("PASS", `100% id resolution (${total}/${total}).`);
  } else {
    sec.setStatus("FAIL", `${missing.length}/${total} rostered players did not resolve to a Sleeper pid — this is the NaN-class bug (#54); those players named above will read 0/NaN in the live app.`);
  }
  return sec.raw;
}

// ==================================================================================
// PROBE 5 — kicker FG-made-yards field (statId 214 / Sleeper's fgm_yds) in a real payload
// ==================================================================================
async function findFinalGameWithKicker(label, scoreboardUrl) {
  const r = await timedFetch(label, scoreboardUrl);
  if (r.unreachable) return { unreachable: true, error: r.error, note: unreachableLine(scoreboardUrl) };
  if (!r.ok) return { ok: false, status: r.status };
  const events = (r.json && r.json.events) || [];
  const finals = events.filter((ev) => ev?.competitions?.[0]?.status?.type?.state === "post");
  if (!finals.length) return { ok: true, found: false, eventsSeen: events.length };
  for (const ev of finals) {
    const sumR = await timedFetch(`espn summary ${ev.id}`, `${ESPN}/summary?event=${ev.id}`);
    if (sumR.unreachable) return { unreachable: true, error: sumR.error, note: unreachableLine(`${ESPN}/summary`) };
    if (!sumR.ok) continue;
    const kickers = parseEspnKickers(sumR.json);
    const hit = kickers.find((k) => k.made > 0);
    if (hit) return { ok: true, found: true, eventId: ev.id, shortName: ev.shortName, kicker: hit };
  }
  return { ok: true, found: false, eventsSeen: events.length, note: `${finals.length} final game(s) but no kicker with a made FG in the box.` };
}
async function probe5() {
  const sec = section("P5", "Kicker FG made-yards field (Sleeper fgm_yds, app's statId-214 concept) in a real payload");

  const attempts = [
    { label: "2026 preseason week 1", seasonType: "pre", season: "2026", url: `${ESPN}/scoreboard?seasontype=1&week=1&dates=2026` },
    { label: "2025 regular season week 1", seasonType: "regular", season: "2025", url: `${ESPN}/scoreboard?seasontype=2&week=1&dates=2025` },
  ];

  let pool = null;
  for (const at of attempts) {
    sec.line(`trying ${at.label}…`);
    const g = await findFinalGameWithKicker(`espn scoreboard (${at.label})`, at.url);
    if (g.unreachable) { sec.line(g.note); sec.setStatus("WARN", "ESPN unreachable — could not run this probe."); continue; }
    if (!g.ok) { sec.line(`  HTTP ${g.status}`); continue; }
    if (!g.found) { sec.line(`  no usable final game+kicker found (${g.note || `${g.eventsSeen} events seen`}).`); continue; }
    sec.line(`  final game: ${g.shortName} (event ${g.eventId}) — kicker ${g.kicker.name} (${g.kicker.team}) made ${g.kicker.made}/${g.kicker.att} FGs (ESPN id ${g.kicker.espnId}).`);

    if (!pool) pool = await loadPlayerPool();
    if (!pool.ok) { sec.line(`  ${pool.err}`); sec.setStatus("WARN", "Sleeper player pool unavailable — could not resolve the kicker to a pid."); continue; }

    let pidHit = g.kicker.espnId ? pool.byEspn.get(g.kicker.espnId) : null;
    let via = "espn";
    if (!pidHit) { pidHit = pool.byName.get(nameKey(g.kicker.name, g.kicker.team)); via = "name"; }
    if (!pidHit) { sec.line(`  could not resolve "${g.kicker.name}" (${g.kicker.team}) to a Sleeper pid by espn_id or name+team.`); sec.setStatus("WARN", "kicker found in ESPN box but not resolvable in Sleeper's directory this run."); continue; }
    sec.line(`  resolved to Sleeper pid ${pidHit.pid} via ${via}.`);

    const statsUrl = `${SLP}/stats/nfl/${at.seasonType}/${at.season}/1`;
    const statsR = await timedFetch(`sleeper stats ${at.seasonType}/${at.season}/1`, statsUrl);
    if (statsR.unreachable) { sec.line(`  ${unreachableLine(statsUrl)}`); sec.setStatus("WARN", "Sleeper stats bucket unreachable."); continue; }
    if (!statsR.ok) { sec.line(`  Sleeper stats HTTP ${statsR.status}`); continue; }
    const row = statsR.json && statsR.json[pidHit.pid];
    if (!row) { sec.line(`  no stats row for pid ${pidHit.pid} in ${statsUrl} yet (entries=${statsR.json ? Object.keys(statsR.json).length : 0}).`); sec.setStatus("WARN", `no Sleeper stats row yet for ${at.label} — the field couldn't be checked this run (not a schema break, just no data posted yet).`); continue; }
    if (!("fgm_yds" in row)) { sec.setStatus("FAIL", `fgm_yds is MISSING from the Sleeper stats row for a kicker who made ${g.kicker.made} FG(s) — this is a real schema break in the app's fg_made_yd scoring path.`); sec.line(`  row: ${JSON.stringify(row)}`); return sec.raw; }
    const yds = Number(row.fgm_yds);
    sec.line(`  Sleeper stats row fgm_yds = ${row.fgm_yds} (fgm=${row.fgm} fga=${row.fga}).`);
    if (yds > 0) {
      sec.setStatus("PASS", `fgm_yds=${yds} confirmed in a real Sleeper stats payload, proven on ${at.label}.`);
      return sec.raw;
    } else {
      sec.setStatus("WARN", `fgm_yds present but reads 0 despite ${g.kicker.made} made FG(s) — worth a second look, but the field itself exists.`);
      return sec.raw;
    }
  }
  if (sec.raw.status === "PASS") sec.setStatus("WARN", "neither 2026 preseason week 1 nor the 2025 regular-season fallback could prove the field this run.");
  return sec.raw;
}

// ==================================================================================
// PROBE 6 — latency summary
// ==================================================================================
function probe6() {
  const sec = section("P6", "Latency summary");
  if (!latencyLog.length) { sec.setStatus("WARN", "no fetches were attempted this run."); return sec.raw; }
  const ok = latencyLog.filter((l) => l.status != null);
  for (const l of latencyLog) {
    const status = l.error ? `ERROR: ${l.error}` : `HTTP ${l.status}`;
    sec.line(`${String(l.ms).padStart(6)}ms  ${status.padEnd(22)}  ${l.label}`);
  }
  const avgMs = ok.length ? Math.round(ok.reduce((a, l) => a + l.ms, 0) / ok.length) : 0;
  if (!ok.length) sec.setStatus("WARN", "every fetch this run failed at the network layer (sandbox egress, most likely).");
  else sec.setStatus("PASS", `${ok.length}/${latencyLog.length} fetches completed, avg ${avgMs}ms${QUIET ? "." : " (see the table below)."}`);
  return sec.raw;
}

// ==================================================================================
// --selftest — parser fixtures only, zero network
// ==================================================================================
function selftest() {
  const checks = [];
  const ok = (name, cond) => checks.push({ name, ok: !!cond });

  // normSeasonType ladder shapes.
  ok('normSeasonType(1) === "pre"', normSeasonType(1) === "pre");
  ok('normSeasonType("2") === "regular"', normSeasonType("2") === "regular");
  ok('normSeasonType(3) === "post"', normSeasonType(3) === "post");
  ok('normSeasonType(4) === "post"', normSeasonType(4) === "post");
  ok('normSeasonType(null) === null', normSeasonType(null) === null);
  ok('normSeasonType("preseason") === "pre"', normSeasonType("preseason") === "pre");
  ok('normSeasonType("regular-season") === "regular"', normSeasonType("regular-season") === "regular");
  ok('normSeasonType("postseason") === "post"', normSeasonType("postseason") === "post");
  ok('normSeasonType("gibberish") === null', normSeasonType("gibberish") === null);

  // resolveEspnSeasonType — numeric shape.
  {
    const r = resolveEspnSeasonType({ season: { type: 1 } });
    ok("numeric season.type=1 -> pre", r.resolved === "pre");
  }
  // slug shape (numeric type absent, slug present).
  {
    const r = resolveEspnSeasonType({ season: { slug: "preseason" } });
    ok("season.slug preseason -> pre", r.resolved === "pre");
  }
  // legacy nested shape (neither top-level field present).
  {
    const r = resolveEspnSeasonType({ leagues: [{ season: { type: { type: 2 } } }] });
    ok("nested leagues[0].season.type.type=2 -> regular", r.resolved === "regular");
  }
  // precedence: numeric wins over slug when both present.
  {
    const r = resolveEspnSeasonType({ season: { type: 2, slug: "preseason" } });
    ok("numeric type wins over conflicting slug (fallback-chain precedence)", r.resolved === "regular");
  }
  // nothing present anywhere -> null, loudly.
  {
    const r = resolveEspnSeasonType({});
    ok("no season fields at all -> null", r.resolved === null);
  }

  // resolveEspnWeek.
  ok("week.number=3 -> 3", resolveEspnWeek({ week: { number: 3 } }) === 3);
  ok("week.number=99 (out of range) -> null", resolveEspnWeek({ week: { number: 99 } }) === null);
  ok("no week field -> null", resolveEspnWeek({}) === null);

  // statBearingCount / usability threshold.
  {
    const adpHusk = {};
    for (let i = 0; i < 40; i++) adpHusk["p" + i] = { adp_dd_ppr: 100 + i };
    ok("40-row ADP-only husk has 0 stat-bearing rows", statBearingCount(adpHusk) === 0);
  }
  {
    const real = {};
    for (let i = 0; i < 30; i++) real["p" + i] = { pass_yd: 12 };
    ok("30-row real projection map has 30 stat-bearing rows (>= threshold)", statBearingCount(real) === 30 && 30 >= STAT_BEARING_THRESHOLD);
  }
  {
    const sparse = { p1: { pass_yd: 250 }, p2: { adp_dd_ppr: 5 } };
    ok("sparse mixed map counts only the real row", statBearingCount(sparse) === 1);
  }
  ok("empty map -> 0", statBearingCount({}) === 0);
  ok("null map -> 0", statBearingCount(null) === 0);

  // fsDec / fsDecFields round trip.
  {
    const fields = {
      week: { integerValue: "3" },
      rate: { doubleValue: 0.5 },
      name: { stringValue: "Team A" },
      dead: { nullValue: null },
      live: { booleanValue: true },
      players: { arrayValue: { values: [
        { mapValue: { fields: { key: { stringValue: "slp_123" }, name: { stringValue: "X" } } } },
        { mapValue: { fields: { key: { stringValue: "456" }, name: { stringValue: "Y" } } } },
      ] } },
    };
    const dec = fsDecFields(fields);
    ok("fsDec: integerValue -> Number", dec.week === 3);
    ok("fsDec: doubleValue -> Number", dec.rate === 0.5);
    ok("fsDec: stringValue -> string", dec.name === "Team A");
    ok("fsDec: nullValue -> null", dec.dead === null);
    ok("fsDec: booleanValue -> true", dec.live === true);
    ok("fsDec: arrayValue of mapValue -> array of objects", Array.isArray(dec.players) && dec.players.length === 2 && dec.players[0].key === "slp_123");
  }

  // resolvePid — all three methods + the honest miss.
  {
    const byEspn = new Map([["999", { pid: "sp1", name: "Espn Guy", team: "KC" }]]);
    const byName = new Map([[nameKey("Name Only Guy", "SF"), { pid: "sp2", name: "Name Only Guy", team: "SF" }]]);
    const rosterMeta = new Map([["777", { name: "Name Only Guy", team: "SF" }]]);
    ok('dst_ prefix resolves via "prefix"', resolvePid("dst_KC", byEspn, byName, rosterMeta).via === "prefix");
    ok('dst_ prefix strips to the right pid', resolvePid("dst_KC", byEspn, byName, rosterMeta).pid === "KC");
    ok('slp_ prefix resolves via "prefix"', resolvePid("slp_123", byEspn, byName, rosterMeta).pid === "123");
    ok('espn_id key resolves via "espn"', resolvePid("999", byEspn, byName, rosterMeta).via === "espn");
    ok('name+team fallback resolves via "name" when roster meta is present', resolvePid("777", byEspn, byName, rosterMeta).via === "name");
    ok("an unknown key with no roster meta resolves to nothing", resolvePid("000", byEspn, byName, rosterMeta).pid === null);
  }

  // parseEspnKickers — the FG "M/A" box shape.
  {
    const summary = {
      boxscore: { players: [
        { team: { abbreviation: "DAL" }, statistics: [
          { name: "kicking", labels: ["FG", "PCT", "LONG", "XP", "PTS"], athletes: [
            { athlete: { id: "111", displayName: "Made Some" }, stats: ["2/3", "66.7", "45", "3/3", "9"] },
            { athlete: { id: "112", displayName: "Missed All" }, stats: ["0/2", "0.0", "0", "1/1", "1"] },
          ] },
        ] },
      ] },
    };
    const kickers = parseEspnKickers(summary);
    ok("parseEspnKickers finds exactly the made-at-least-one kicker", kickers.length === 1 && kickers[0].name === "Made Some");
    ok("parseEspnKickers reads made count correctly", kickers[0].made === 2 && kickers[0].att === 3);
  }

  // currentWeek() clamp behavior.
  ok("currentWeek() clamps to 1 before SEASON_START", currentWeek(Date.parse(LG_SEASON_START) - 24 * 3600 * 1000) === 1);
  ok("currentWeek() reads week 2 exactly 7 days after start", currentWeek(Date.parse(LG_SEASON_START + "T05:00:00-05:00") + 7 * 24 * 3600 * 1000) === 2);

  // famKey / collection derivation (this is a pure function — safe, no network).
  ok("roomId is deterministic", roomId("amenfarms") === roomId("amenfarms"));
  ok(`LG_COLL derives to "gffl_" + roomId(LG_PASS)`, LG_COLL === "gffl_" + roomId(LG_PASS));

  let pass = 0;
  for (const c of checks) { if (c.ok) pass++; else console.log(`  FAIL  ${c.name}`); }
  console.log(`--selftest: ${pass}/${checks.length} parser checks passed (no network used).`);
  return pass === checks.length;
}

// ==================================================================================
// report rendering
// ==================================================================================
function renderReport(startedAt, finishedAt) {
  const lines = [];
  lines.push("=".repeat(78));
  lines.push("GFFL LIVE-FEED PROBE — ffleague-plan.md §R0 P1");
  lines.push(`run: ${new Date(startedAt).toISOString()}  (${Math.round((finishedAt - startedAt) / 1000)}s)`);
  lines.push(`league collection: ${LG_COLL}   season: ${LG_SEASON}   season_start: ${LG_SEASON_START}`);
  lines.push("=".repeat(78));
  for (const s of sections) {
    lines.push("");
    lines.push(`-- ${s.id}: ${s.title} ${"-".repeat(Math.max(2, 70 - s.id.length - s.title.length))}`);
    lines.push(`${s.status}: ${s.meaning}`);
    if (!QUIET) for (const l of s.lines) lines.push(`  ${l}`);
  }
  lines.push("");
  lines.push("=".repeat(78));
  lines.push("SUMMARY");
  lines.push("=".repeat(78));
  const w = Math.max(...sections.map((s) => s.title.length)) + 6;
  for (const s of sections) lines.push(`${s.id}  ${s.title.padEnd(w)} ${s.status}`);
  const anyFail = sections.some((s) => s.status === "FAIL");
  lines.push("");
  lines.push(anyFail ? "RESULT: at least one probe FAILed — see above." : "RESULT: no FAILs (WARNs allowed).");
  return lines.join("\n");
}

// ==================================================================================
// main
// ==================================================================================
async function main() {
  if (SELFTEST) {
    const ok = selftest();
    process.exit(ok ? 0 : 1);
    return;
  }

  const startedAt = Date.now();
  const p1 = await probe1();
  const p2 = await probe2(p1.espnResolved);
  const p3 = await probe3({ week: p2.week, seasonType: p2.seasonType, season: p2.season });
  await probe4();
  await probe5();
  probe6();
  const finishedAt = Date.now();

  const report = renderReport(startedAt, finishedAt);
  console.log(report);

  if (REPORT_PATH) {
    let outPath = REPORT_PATH;
    if (outPath === "__default__") {
      const d = new Date();
      const stamp = d.toISOString().slice(0, 19).replace(/[:T]/g, "-");
      outPath = resolve(REPO_ROOT, "shots", `gffl_probe_${stamp}.txt`);
    } else if (!outPath.match(/^([a-zA-Z]:)?[\\/]/)) {
      outPath = resolve(REPO_ROOT, outPath);
    }
    try {
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, report + "\n", "utf8");
      console.log(`\n(report written to ${outPath})`);
    } catch (e) {
      console.error(`\ncould not write report to ${outPath}: ${(e && e.message) || e}`);
    }
  }

  const anyFail = sections.some((s) => s.status === "FAIL");
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error("gffl live probe crashed:", (e && e.stack) || e);
  process.exit(1);
});
