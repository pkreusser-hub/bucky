// READ-ONLY. Recomputes every starter D/ST in the stored weekly_<season>_w<n> docs with the
// FIXED mergeRow rule (lg-data.js dstReconcile) from real ESPN + Sleeper data, and prints the
// per-team stored -> corrected totals plus the exact Firestore field paths that would change.
// It performs GET requests only (Firestore documents, ESPN, Sleeper). It NEVER writes; the
// production correction (backup -> masked PATCH -> canonical re-read, CLAUDE.md #9) is a
// separate, deliberate step done from this output.
//
//   node tools/_gffl_dst_recheck.mjs [--season 2026] [--weeks 1,2,3] [--json out.json]
//
// How "old" is decided: a stored weekly doc holds only team totals, not per-player lines. For
// each team the old D/ST is whichever of {ESPN-derived line, Sleeper line} makes the team's
// recomputed starter total equal the stored total to the cent (ESPN-derived first - that is the
// line the old fresher-wins merge usually stored). "unreconciled" is printed when neither does.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i !== -1 && argv[i + 1] ? argv[i + 1] : d; };
const SEASON = Number(arg("season", "2026"));
const WEEKS = String(arg("weeks", "1,2,3")).split(",").map(Number).filter(Boolean);
const JSON_OUT = arg("json", "");

const ESPN = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SLP = "https://api.sleeper.app/v1";
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU"; // public web key, same as lg-core.js
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";
const LG_COLL = "gffl_fam2jan2g"; // roomId("amenfarms") - the family league (see _gffl_live_probe.mjs)

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url.replace(/key=[^&]+/, "key=...")} -> HTTP ${r.status}`);
  return r.json();
}
// Firestore REST value -> plain JS (read side only).
function dec(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = dec(v.mapValue.fields[k]); return o; }
  return null;
}
async function fsDoc(id) {
  const r = await fetch(`${FS_BASE}/${LG_COLL}/${encodeURIComponent(id)}?key=${FS_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore GET ${id} -> HTTP ${r.status}`);
  const j = await r.json();
  const o = {}; for (const k in (j.fields || {})) o[k] = dec(j.fields[k]);
  return o;
}

// lg-data.js in a vm, exactly as the app's own audits load it (read-only; nothing is written).
const here = path.dirname(fileURLToPath(import.meta.url));
let src = fs.readFileSync(path.join(here, "..", "assets", "league", "lg-data.js"), "utf8");
src = src.replace("D.deriveEspnDst = deriveEspnDst;", "D.deriveEspnDst = deriveEspnDst; D.applyScoringPlays = applyScoringPlays;");
const LG = { rules: null, SEASON, floorPts: (n) => (n == null ? null : Math.max(0, n)), n: (v) => (Number.isFinite(Number(v)) ? Number(v) : 0) };
const ctx = vm.createContext({ window: { LG }, document: {}, console, setTimeout, clearTimeout, setInterval, fetch,
  localStorage: { getItem() { return null; }, setItem() {} }, navigator: {}, location: { search: "", href: "" },
  URLSearchParams, Date, Math, JSON, Map, Set, Promise });
vm.runInContext(src, ctx, { filename: "lg-data.js" });
const D = LG.data;
if (!D || !D.mergeRow) throw new Error("lg-data.js did not expose D.mergeRow");

const settings = await fsDoc("settings");
const SC = settings && settings.rules && settings.rules.scoring;
if (!SC) throw new Error("settings.rules.scoring missing from production");
LG.rules = { scoring: SC };
const fl = (n) => Math.max(0, n);
const r2 = (n) => Math.round(n * 100) / 100;

console.log("loading Sleeper player pool...");
const pool = await getJson(`${SLP}/players/nfl`);
const byEspn = new Map(), byName = new Map();
for (const pid in pool) {
  const p = pool[pid]; if (!p || typeof p !== "object") continue;
  if (p.espn_id != null) byEspn.set(String(p.espn_id), pid);
  const nm = p.full_name || ((p.first_name || "") + " " + (p.last_name || "")).trim();
  if (p.team) byName.set(D.normName(nm) + "|" + D.slpTeam(p.team), pid);
}

const report = [];
for (const w of WEEKS) {
  const weekly = await fsDoc(`weekly_${SEASON}_w${w}`);
  if (!weekly) { console.log(`\nweek ${w}: no weekly_${SEASON}_w${w} doc`); continue; }
  const sb = await getJson(`${ESPN}/scoreboard?seasontype=2&week=${w}&dates=${SEASON}`);
  const slp = await getJson(`${SLP}/stats/nfl/regular/${SEASON}/${w}`);
  const espn = new Map(), state = new Map();
  for (const ev of sb.events || []) {
    const st = ev.competitions?.[0]?.status?.type?.state;
    if (st === "pre") continue;
    const s = await getJson(`${ESPN}/summary?event=${ev.id}`);
    const box = D.parseEspnBox(s); D.applyScoringPlays(s, box);
    for (const [id, rec] of box) espn.set(id, rec);
    for (const [k, rec] of D.deriveEspnDst(s)) { espn.set(k, rec); state.set(D.slpTeam(rec.meta.team), st); }
  }
  const espnByNameKey = new Map();
  for (const [id, rec] of espn) if (!id.startsWith("dst_")) espnByNameKey.set(D.normName(rec.meta.name) + "|" + D.slpTeam(rec.meta.team), id);

  // The corrected D/ST line: the REAL mergeRow, both sides populated, game final.
  function mergedDst(team) {
    const k = "dst_" + D.slpTeam(team);
    const e = espn.get(k), s = slp[D.slpTeam(team)];
    if (!e) return null;
    const row = { key: k, team, pos: "DST", name: team + " D/ST", espn: { stats: e.stats, raw: e.raw || {}, last: 2 },
      slp: s ? { stats: D.normSlp(s, true), raw: s, last: 1 } : null, official: null };
    D.S.games.set(D.slpTeam(team), { state: state.get(D.slpTeam(team)) || "post" });
    D.S.health.mode = "dual";
    D.mergeRow(row);
    return { merged: row.pts, espnOnly: D.score(e.stats, SC), slpOnly: s ? D.score(D.normSlp(s, true), SC) : null,
      // what the app's PRE-fix normSlp scored for the same Sleeper row (no def_st_fum_rec) - the stored value to match
      slpOld: s ? D.score(D.normSlp(Object.assign({}, s, { def_st_fum_rec: 0 }), true), SC) : null, row, e, s };
  }

  console.log(`\n===== ${SEASON} week ${w} =====`);
  const wkRes = { week: w, teams: [] };
  const newMatch = JSON.parse(JSON.stringify(weekly.matchups));
  for (const [mi, m] of weekly.matchups.entries()) {
    for (const side of ["home", "away"]) {
      const tid = m[side];
      const ros = await fsDoc(`roster_${SEASON}_w${w}_t${tid}`);
      if (!ros) { console.log(`team ${tid}: no roster doc`); continue; }
      const starters = (ros.players || []).filter((p) => p.slot !== "BENCH" && p.slot !== "IR");
      let nonDstE = 0, nonDstS = 0; const dsts = [];
      for (const p of starters) {
        const key = String(p.key);
        if (p.pos === "DST") { dsts.push(p); continue; }
        let eid = null, pid = null;
        if (key.startsWith("slp_")) {
          pid = key.slice(4); const mm = pool[pid];
          if (mm) { eid = mm.espn_id != null ? String(mm.espn_id) : null;
            if (!eid || !espn.has(eid)) eid = espnByNameKey.get(D.normName(mm.full_name || "") + "|" + D.slpTeam(mm.team)) || eid; }
        } else { eid = key; pid = byEspn.get(key) || byName.get(D.normName(p.name) + "|" + D.slpTeam(p.team)) || null; }
        const er = eid && espn.get(eid), sr = pid && slp[pid];
        nonDstE += er ? fl(D.score(er.stats, SC)) : 0;
        nonDstS += sr ? fl(D.score(D.normSlp(sr, false), SC)) : 0;
      }
      const stored = m[side + "Pts"];
      const perDst = [];
      let oldDstSum = 0, newDstSum = 0, matched = "unreconciled";
      const dm = dsts.map((p) => mergedDst(p.team));
      // which non-DST basis + which old DST line reproduces the stored total?
      const eDst = dm.reduce((a, x) => a + (x ? fl(x.espnOnly) : 0), 0);
      const sDst = dm.reduce((a, x) => a + (x && x.slpOld != null ? fl(x.slpOld) : 0), 0);
      let oldUse = "espn";
      for (const [nm, base, dst, use] of [["espn", nonDstE, eDst, "espn"], ["slp", nonDstS, sDst, "slp"], ["espn-non-dst/slp-dst", nonDstE, sDst, "slp"], ["slp-non-dst/espn-dst", nonDstS, eDst, "espn"]]) {
        if (Math.abs(r2(base + dst) - stored) < 0.006) { matched = nm; oldUse = use; break; }
      }
      dsts.forEach((p, i) => {
        const x = dm[i]; if (!x) { perDst.push({ name: p.name, old: null, now: null }); return; }
        const old = fl(oldUse === "slp" && x.slpOld != null ? x.slpOld : x.espnOnly), now = fl(x.merged);
        oldDstSum += old; newDstSum += now;
        perDst.push({ name: p.name, team: p.team, old: r2(old), now: r2(now), espnDerived: r2(x.espnOnly), sleeper: x.slpOnly == null ? null : r2(x.slpOnly) });
      });
      const corrected = r2(stored - oldDstSum + newDstSum);
      const delta = r2(corrected - stored);
      newMatch[mi][side + "Pts"] = corrected;
      wkRes.teams.push({ week: w, teamId: tid, matchIndex: mi, side, stored, corrected, delta, basis: matched, dst: perDst });
    }
  }
  // W/L, top score
  const flips = [];
  weekly.matchups.forEach((m, i) => {
    const so = Math.sign(m.homePts - m.awayPts), sn = Math.sign(newMatch[i].homePts - newMatch[i].awayPts);
    if (so !== sn) flips.push(`match ${i}: ${m.home} v ${m.away} ${m.homePts}-${m.awayPts} -> ${newMatch[i].homePts}-${newMatch[i].awayPts}`);
  });
  const top = (mm) => { let b = null; for (const x of mm) for (const s of ["home", "away"]) if (!b || x[s + "Pts"] > b.pts) b = { teamId: x[s], pts: x[s + "Pts"] }; return b; };
  const topOld = top(weekly.matchups), topNew = top(newMatch);

  console.log("team  stored   corrected  delta   basis                  D/ST old -> new");
  for (const t of wkRes.teams) {
    console.log(`t${String(t.teamId).padEnd(3)} ${String(t.stored).padStart(7)}  ${String(t.corrected).padStart(9)}  ${(t.delta >= 0 ? "+" : "") + t.delta}`.padEnd(40)
      + ` ${t.basis.padEnd(22)} ` + t.dst.map((d) => `${d.name} ${d.old} -> ${d.now}`).join("; "));
  }
  const changed = wkRes.teams.filter((t) => t.delta !== 0);
  console.log(`W/L flips: ${flips.length ? flips.join(" | ") : "none"}`);
  console.log(`top score: stored ${topOld.teamId}@${topOld.pts} -> corrected ${topNew.teamId}@${topNew.pts}` + (weekly.awards?.topScore ? ` (stored awards.topScore ${weekly.awards.topScore.teamId}@${weekly.awards.topScore.pts})` : ""));
  console.log("Firestore field paths that would change (documents: " + `weekly_${SEASON}_w${w}` + "):");
  for (const t of changed) console.log(`  matchups[${t.matchIndex}].${t.side}Pts  ${t.stored} -> ${t.corrected}`);
  if (changed.length) {
    console.log("  NOTE: matchups is a Firestore ARRAY - updateMask can only target the whole `matchups` field, so the PATCH must send the full corrected array.");
    console.log("  ALSO recompute from the new totals (not computed here): power[] (PF term), awards.topScore" + (topOld.pts !== topNew.pts || topOld.teamId !== topNew.teamId ? " (CHANGES)" : " (unchanged)") + ", awards.benchBlunder/bust if the D/ST was involved, and team-doc PF/PA aggregates if stored.");
  }
  wkRes.flips = flips; wkRes.newMatchups = newMatch;
  report.push(wkRes);
}
if (JSON_OUT) { fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 1)); console.log("\nwrote " + JSON_OUT + " (local file only)"); }
console.log("\nREAD-ONLY run complete - nothing was written to Firestore.");
