// GFFL RULES RECONCILIATION vs ESPN's own scoring — PERMANENT EQUIPMENT (2026-08-13).
// Usage: node tools/_gffl_rules_reconcile.mjs [season] [weeks]   (defaults 2025 17)
// Re-run after ANY scoring-rule change, and against 2026 itself once real weeks exist.
// Original header: vs ESPN's own 2025 scoring (2026-08-13).
// Ground truth = the family league's REAL 2025 boxscores (lg_espn_probe → mBoxscore per
// scoringPeriod): every rostered player-week's raw stats + ESPN's appliedStats (what each
// statId actually PAID under the league's own settings) + ESPN's own player and team totals.
// Compared against the LIVE rules doc through the server's own STAT_MAP. Failure classes:
//   A. COEFFICIENT MISMATCH — a rule we carry pays a different rate than ESPN paid.
//   B. PAID-BUT-UNMAPPED — a statId ESPN paid that STAT_MAP doesn't carry (a missed rule).
//   T. TOTALS — per-player re-score vs appliedStatTotal; per-team starter sums vs
//      ESPN's own matchup totalPoints (the numbers that decided real 2025 games).
//   C. UNEXERCISED — rules of ours 2025 never triggered (listed; nothing proven either way).
import fs from "node:fs";

const SITE = "https://goatfantasyleague.com/.netlify/functions/league";
const SECRET = "amenfarms";
const KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents/gffl_fam2jan2g";
const SEASON = Number(process.argv[2]) || 2025;
const WEEKS = Number(process.argv[3]) || 17;

// ---- STAT_MAP straight out of the server source (one source of truth, not a copy) ----
const src = fs.readFileSync(new URL("../netlify/functions/league.mjs", import.meta.url), "utf8");
const mapSrc = (src.match(/const STAT_MAP = \{([\s\S]*?)\};/) || [])[1];
if (!mapSrc) { console.error("could not extract STAT_MAP"); process.exit(1); }
const STAT_MAP = {};
for (const m of mapSrc.matchAll(/(\d+):\s*"([a-z0-9_]+)"/g)) STAT_MAP[Number(m[1])] = m[2];

// ---- the LIVE rules doc ----
const dec = (v) => {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = dec(x); return o; }
  return null;
};
// The live settings doc now carries whatever rate the league is CURRENTLY playing under
// (2026 rules once the season starts). 2025 must keep reconciling against the rates it was
// actually played under — frozen in tools/_gffl_scoring_2025.json (a verbatim snapshot taken
// 2026-08-22, before any 2026-only rule edit) — so a later live-doc change can't silently
// break the 2025 proof. Every other season reconciles against the live doc, as before.
let scoring;
if (SEASON === 2025) {
  const snap = JSON.parse(fs.readFileSync(new URL("./_gffl_scoring_2025.json", import.meta.url), "utf8"));
  delete snap._comment;
  scoring = snap;
  console.log("STAT_MAP:", Object.keys(STAT_MAP).length, "ids · FROZEN 2025 scoring snapshot:", Object.keys(scoring).length, "keys · season", SEASON, "weeks 1.." + WEEKS, "\n");
} else {
  const setDoc = await fetch(`${FS_BASE}/settings?key=${KEY}`).then((r) => r.json());
  const settings = {}; for (const [k, v] of Object.entries(setDoc.fields || {})) settings[k] = dec(v);
  scoring = (settings.rules && settings.rules.scoring) || settings.scoring || {};
  console.log("STAT_MAP:", Object.keys(STAT_MAP).length, "ids · live rules doc:", Object.keys(scoring).length, "keys · season", SEASON, "weeks 1.." + WEEKS, "\n");
}

// ---- walk the season's boxscores ----
const byId = new Map();     // statId -> { samples, coeffs:Map(rounded->n), eg }
const playerFails = [];     // samples of |our re-score − ESPN appliedStatTotal| > 0.011
let pfCount = 0;
const teamRows = [];        // per matchup-side: starters-sum vs ESPN totalPoints
let playerWeeks = 0, sumChecked = 0, sumMismatch = 0;
const unmappedPaid = new Map();
for (let w = 1; w <= WEEKS; w++) {
  const j = await fetch(SITE, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SECRET, action: "lg_espn_probe", season: SEASON, scoringPeriodId: w, views: ["mBoxscore"] }) }).then((r) => r.json());
  if (!j.ok) { console.log("week", w, "probe failed:", j.reason || j.status); continue; }
  const d = JSON.parse(j.body);
  const sched = (d.schedule || []).filter((m) => m.matchupPeriodId === w || (m.home && m.home.rosterForCurrentScoringPeriod));
  let sides = 0;
  for (const m of (d.schedule || [])) {
    for (const sideKey of ["home", "away"]) {
      const side = m[sideKey];
      const rfcp = side && side.rosterForCurrentScoringPeriod;
      if (!rfcp || !Array.isArray(rfcp.entries) || !rfcp.entries.length) continue;
      sides++;
      let starterSum = 0;
      for (const e of rfcp.entries) {
        const ppe = e.playerPoolEntry || {};
        const p = ppe.player || {};
        const line = (p.stats || []).find((s) => s.statSourceId === 0 && s.statSplitTypeId === 1 && s.scoringPeriodId === w);
        if (!line) continue;
        playerWeeks++;
        const applied = line.appliedStats || {};
        const raw = line.stats || {};
        // ESPN internal consistency: Σ appliedStats ≈ appliedTotal ≈ appliedStatTotal
        const aSum = Object.values(applied).reduce((a, b) => a + (Number(b) || 0), 0);
        sumChecked++;
        if (Math.abs(aSum - (ppe.appliedStatTotal ?? line.appliedTotal ?? aSum)) > 0.02) sumMismatch++;
        // per-statId coefficients + our re-score. POSITION-AWARE (the last 5 of 2,497):
        // ESPN's pointsOverrides[16] values apply only to a D/ST slot — an individual
        // PLAYER's return TD pays the base 6 and his defensive counting stats pay 0. The
        // app's normalization now encodes exactly this (player st_td → dst_td at 6, no
        // other defensive keys), and the re-score models the same semantics.
        const isDst = p.defaultPositionId === 16;
        const PLAYER_DST_ZERO = new Set([95, 96, 97, 98, 99, 106]); // int/fum_rec/blk/safety/sack/fum_forced — base 0 for players
        const valFor = (idN) => {
          const key = STAT_MAP[idN];
          if (!key) return 0;
          if (!isDst) {
            if (PLAYER_DST_ZERO.has(idN)) return 0;
            if (idN === 101 || idN === 102) return Number(scoring.dst_td) || 0; // player return TD = base 6
          }
          return Number(scoring[key]) || 0;
        };
        let mine = 0;
        for (const [id, av] of Object.entries(applied)) {
          const idN = Number(id);
          const a = Number(av) || 0, r = Number(raw[id]) || 0;
          const key = STAT_MAP[idN];
          if (a && r) {
            const c = Math.round((a / r) * 1000) / 1000;
            if (!key) {
              const u = unmappedPaid.get(id) || { samples: 0, coeffs: new Set(), eg: p.fullName };
              u.samples++; u.coeffs.add(c); unmappedPaid.set(id, u);
            } else if (isDst || !(PLAYER_DST_ZERO.has(idN) || idN === 101 || idN === 102)) {
              // the coefficient TABLE stays the D/ST-slot view (the doc's own values);
              // player-row overrides are checked through the total, not the table
              const en = byId.get(id) || { samples: 0, coeffs: new Map(), eg: p.fullName };
              en.samples++; en.coeffs.set(c, (en.coeffs.get(c) || 0) + 1); byId.set(id, en);
            }
          }
          mine += (Number(raw[id]) || 0) * valFor(idN);
        }
        const espnTotal = ppe.appliedStatTotal ?? line.appliedTotal ?? 0;
        if (Math.abs(mine - espnTotal) > 0.011) {
          pfCount++;
          if (playerFails.length < 40) playerFails.push({ w, name: p.fullName, mine: Math.round(mine * 100) / 100, espn: espnTotal,
            ids: Object.keys(applied).filter((id) => !STAT_MAP[Number(id)]).join(",") || "-" });
        }
        // starters only feed the matchup total (20 bench, 21 IR)
        if (e.lineupSlotId !== 20 && e.lineupSlotId !== 21) starterSum += espnTotal;
      }
      const tp = side.totalPoints;
      teamRows.push({ w, side: sideKey, teamId: side.teamId, sum: Math.round(starterSum * 100) / 100, espn: tp,
        ok: tp != null && Math.abs(starterSum - tp) <= 0.011 });
    }
  }
  console.log("week " + w + ": " + sides + " roster-sides read");
}

console.log("\nplayer-weeks reconciled:", playerWeeks, "· ESPN internal sum mismatches:", sumMismatch, "of", sumChecked);

// ---- A: every exercised coefficient vs our doc ----
const eps = 0.006;
console.log("\n=== A · every coefficient ESPN paid in " + SEASON + " vs our live rules doc ===");
const aFail = [];
for (const [id, e] of [...byId.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
  // dominant coefficient (rounding noise on fractional yardage makes tiny satellites)
  const dom = [...e.coeffs.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const key = STAT_MAP[Number(id)];
  const ours = Number(scoring[key]);
  const match = Math.abs(dom - ours) <= eps;
  if (!match) aFail.push({ id, key, espn: dom, ours });
  console.log((match ? "  \u2713 " : "  \u2717 ") + "stat " + id + " (" + key + "): ESPN paid " + dom + "/unit · ours " + ours + " · " + e.samples + " samples (e.g. " + e.eg + ")");
}

console.log("\n=== B · statIds ESPN PAID that STAT_MAP does not carry ===");
if (!unmappedPaid.size) console.log("  none — every point ESPN paid flows through a rule we carry");
for (const [id, u] of unmappedPaid) console.log("  \u2717 stat " + id + " paid " + JSON.stringify([...u.coeffs]) + "/unit · " + u.samples + " samples (e.g. " + u.eg + ")");

console.log("\n=== T · totals ===");
const pf = pfCount;
console.log("players where OUR re-score \u2260 ESPN's own total (>1\u00a2):", pf, "of", playerWeeks);
for (const f of playerFails.slice(0, 12)) console.log("  \u2717 w" + f.w + " " + f.name + ": ours " + f.mine + " vs ESPN " + f.espn + " (unmapped ids: " + f.ids + ")");
const tFail = teamRows.filter((t) => !t.ok);
console.log("matchup sides where \u03a3 starters \u2260 ESPN's matchup total:", tFail.length, "of", teamRows.length);
for (const t of tFail.slice(0, 8)) console.log("  \u2717 w" + t.w + " team " + t.teamId + " (" + t.side + "): \u03a3 " + t.sum + " vs ESPN " + t.espn);

const exercised = new Set([...byId.keys()].map((id) => STAT_MAP[Number(id)]));
const dormant = Object.keys(scoring).filter((k) => Number(scoring[k]) !== 0 && !exercised.has(k));
console.log("\n=== C · rules of OURS " + SEASON + " never exercised ===");
console.log(dormant.length ? "  " + dormant.join(", ") : "  none — the season exercised every non-zero rule");

const fails = aFail.length + unmappedPaid.size + pf + tFail.length + sumMismatch;
console.log("\nRESULT:", fails === 0
  ? "RECONCILED — our rules reproduce ESPN's " + SEASON + " scoring exactly: every exercised coefficient, every player-week total, every matchup total"
  : "DISCREPANCIES: " + fails + " (A:" + aFail.length + " B:" + unmappedPaid.size + " player:" + pf + " team:" + tFail.length + " sum:" + sumMismatch + ")");
process.exit(fails ? 1 : 0);
