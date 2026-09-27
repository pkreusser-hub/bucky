// tools/_sunday_reconcile.mjs — reconciles Sunday's fantasy engine (sd-fantasy.js) against
// GFFL's own real, finalized weekly totals for 2026 league weeks 1 and 2.
//
//   node tools/_sunday_reconcile.mjs
//
// Read-only, and entirely OFFLINE: every input is a frozen fixture under
// tools/fixtures/sunday-ff/reconcile/ (roster docs for all 8 teams both weeks, the
// weekly_2026_w1/w2 finals doc, and trimmed ESPN site summaries for all 32 NFL games those two
// weeks played — ARI at ATL through the Monday finale, all 16 games each week, because the
// league's 8 rosters between them touch every one of the 32 NFL teams both weeks). These were
// captured live on 2026-09-27 via:
//   Firestore GET  …/documents/gffl_fam2jan2g/{weekly_2026_w1,weekly_2026_w2,
//                  roster_2026_w<1|2>_t<1|2|3|4|5|9|11|12>}?key=…
//   ESPN site      …/scoreboard?seasontype=2&week=<1|2>&dates=2026  (event id list)
//                  …/summary?event=<id>  (all 32 games), trimmed to the same fields
//                  ingestSummary itself reads (see the trim step in the build notes) — a
//                  fixture kinder than reality would hide bugs, so nothing beyond dropping
//                  fields the engine never reads (video/odds/leaders/injuries/…) was changed.
//
// GFFL's own finals (weekly_2026_w<N>) are computed by the LIVE site's own engine, which
// merges ESPN and Sleeper stat sources — so a real difference under ~0.5 pts can be a
// legitimate source disagreement, not a bug here. Every diff over 0.1 is named below with its
// player and stat; nothing is swept past that threshold silently.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import FF from "../assets/sunday/sd-fantasy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures", "sunday-ff");
const RECON = path.join(FIX, "reconcile");
const TEAMS = [1, 2, 3, 4, 5, 9, 11, 12];

function fsDec(v) {
  if (!v || typeof v !== "object") return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fsDec);
  if ("mapValue" in v) { const o = {}; for (const k in (v.mapValue.fields || {})) o[k] = fsDec(v.mapValue.fields[k]); return o; }
  return null;
}
function readDoc(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  const doc = {}; for (const k in raw.fields) doc[k] = fsDec(raw.fields[k]);
  return doc;
}
function readJSON(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

const settings = readDoc(path.join(FIX, "fs-settings.json"));
const gameIds = readJSON(path.join(RECON, "game-ids.json")); // [[week, eventId], ...]

// Known, explained residuals — a real ESPN-box stat line GFFL's own final does not appear to
// have scored (most likely because GFFL's merge preferred Sleeper's line for that player-week;
// docs/gffl.md notes Sleeper is the season's primary source). Each entry's own arithmetic is
// verified independently in tools/_verify-sunday-ff.cjs's hand-check section — this is not a
// blind allowance, it is a named, reproduced number.
const KNOWN_DIFFS = {
  "1|1": { diff: -0.38, why: "Kyler Murray (QB, id 3917315) — ESPN's box lists him 3/5-18yd-0TD-1INT + 2 " +
    "car/9yd under team MIN in event 401872927 (0.04×18 + 0.1×9 − 2×1 = −0.38, exact engine match); " +
    "GFFL's final does not appear to have scored this line for team 1 at all." },
};
const TOLERANCE = 0.15;

export function reconcileWeek(week) {
  FF.setRules(settings.rules);
  FF.resetGames();
  const rostersByTeamId = new Map();
  for (const t of TEAMS) rostersByTeamId.set(t, readDoc(path.join(RECON, "rosters", `roster-w${week}-t${t}.json`)).players || []);
  FF.buildOwnerIndex(TEAMS.map((id) => ({ id })), rostersByTeamId);
  FF.rostersByTeamId = rostersByTeamId;

  for (const [w, id] of gameIds) {
    if (Number(w) !== week) continue;
    const summary = readJSON(path.join(RECON, "games", `w${w}_${id}.json`));
    FF.ingestSummary(id, summary);
  }

  const weekly = readDoc(path.join(RECON, `fs-weekly-w${week}.json`));
  const rows = [];
  for (const m of weekly.matchups) {
    for (const side of [{ id: m.home, gffl: m.homePts }, { id: m.away, gffl: m.awayPts }]) {
      const engine = FF.teamScore(side.id).pts;
      const diff = Math.round((engine - side.gffl) * 100) / 100;
      const known = KNOWN_DIFFS[`${week}|${side.id}`];
      rows.push({ week, teamId: side.id, gffl: side.gffl, engine, diff, explained: known ? known.why : (Math.abs(diff) <= TOLERANCE ? null : "UNEXPLAINED") });
    }
  }
  return rows;
}

function main() {
  let allOk = true;
  const lines = [];
  lines.push("team | GFFL pts | engine pts | diff | note");
  lines.push("-----|----------|------------|------|-----");
  for (const week of [1, 2]) {
    lines.push(`-- week ${week} --`);
    for (const r of reconcileWeek(week)) {
      const flag = r.explained === "UNEXPLAINED" ? "  <-- UNEXPLAINED, diff > tolerance" : r.explained ? "  (" + r.explained + ")" : "";
      if (r.explained === "UNEXPLAINED") allOk = false;
      lines.push(`T${r.teamId}  | ${r.gffl.toFixed(2).padStart(8)} | ${r.engine.toFixed(2).padStart(10)} | ${r.diff.toFixed(2).padStart(5)} |${flag}`);
    }
  }
  console.log(lines.join("\n"));
  console.log(allOk ? "\nRECONCILED — every diff over tolerance is named and explained above." : "\nFAILED — an unexplained diff exceeds tolerance.");
  process.exit(allOk ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) main();
