// GFFL PRESEASON PROJECTION TEST (2026-08-13) — the Grok adjuster's first honest,
// contamination-free accuracy datapoint.
//
// WHY THIS EXISTS: no provider publishes preseason projections at all (verified live:
// Sleeper's pre/2026/1 bucket holds 0 real stat lines out of 9,379 rows; ESPN's fantasy game
// has no preseason scoring periods), and Grok's regular-season accuracy CANNOT be backtested
// on 2025 — that season is inside its training data, so any such number would be fake. But
// TONIGHT'S preseason games are past every model's cutoff, and the GFFL's rosters are
// literally the 2nd/3rd-stringers who play in them (the backup-fill). So: have Grok project
// them COLD before kickoff, lock the numbers to a file, grade them against the real box
// scores after — through the deployed gffladjust pipeline itself, so the test exercises the
// exact production path (batching, validation, the CONTEXT preamble).
//
// HONESTY NOTES, up front:
//   · Preseason is the hardest projection environment there is — snap counts are coach
//     whim, starters sit, scripts change at halftime. Treat the grade as a smoke test of
//     CALIBRATION (does it move sensibly off a crude prior, does it respect depth/injury),
//     never as a verdict on regular-season accuracy.
//   · The "base" fed to the model is a CRUDE POSITIONAL PRIOR (documented in the lock file),
//     with a CONTEXT note telling the model exactly that and to project freely. The grade
//     therefore reports Grok's MAE **against that prior's own MAE** — beating its own crude
//     anchor is the minimum bar for claiming any skill.
//   · Players who never take a snap (DNP) are reported BOTH ways: excluded (projection
//     skill among those who played) and included (a nonzero projection for a healthy scratch
//     is a real miss too).
//
// USAGE (from repo root):
//   node tools/_gffl_preseason_test.mjs --lock     # BEFORE kickoff — generate + freeze
//   node tools/_gffl_preseason_test.mjs --grade    # after the games — grade vs real boxes
// The lock lands in tools/_gffl_preseason_lock.json (committed — it's the test record).
import fs from "node:fs";

const SITE = "https://goatfantasyleague.com";
const SECRET = "amenfarms";
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents/gffl_fam2jan2g";
const LOCK_PATH = new URL("./_gffl_preseason_lock.json", import.meta.url);
const TEAM_IDS = [1, 2, 3, 4, 5, 9, 11, 12];
// The crude prior, by position and depth-chart order (1 = starter). Deliberately dumb — the
// whole point is measuring what Grok adds ON TOP of something this simple.
const PRIOR = {
  QB: { 1: 8, 2: 5, 3: 3 }, RB: { 1: 6, 2: 4, 3: 2.5 }, WR: { 1: 5, 2: 3.5, 3: 2 },
  TE: { 1: 4, 2: 2.5, 3: 1.5 }, K: { 1: 4, 2: 3, 3: 2 },
};
const priorFor = (pos, depth) => {
  const t = PRIOR[pos] || PRIOR.WR;
  return t[Math.min(Math.max(Number(depth) || 2, 1), 3)] ?? 3;
};

// ---- Firestore REST decode (the transport's own codec, read side only) ----
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
async function fsDoc(id) {
  const r = await fetch(`${FS_BASE}/${id}?key=${FS_KEY}`);
  if (!r.ok) return null;
  const j = await r.json();
  const o = {}; for (const [k, v] of Object.entries(j.fields || {})) o[k] = dec(v);
  return o;
}

// ---- league scoring (skill + K), from the LIVE rules doc — the reconcile's own key set ----
function scoreLine(st, sc) {
  const n = (k) => Number(st[k]) || 0;
  const c = (k) => Number(sc[k]) || 0;
  let p = n("pass_yd") * c("pass_yd") + n("pass_td") * c("pass_td") + n("pass_int") * c("pass_int")
    + n("pass_2pt") * c("pass_2pt")
    + n("rush_yd") * c("rush_yd") + n("rush_td") * c("rush_td") + n("rush_2pt") * c("rush_2pt")
    + n("rec") * c("rec") + n("rec_yd") * c("rec_yd") + n("rec_td") * c("rec_td") + n("rec_2pt") * c("rec_2pt")
    + n("fum_lost") * c("fum_lost")
    + (n("fgm_yds") || n("fg_made_yd")) * c("fg_made_yd") + n("xpm") * c("xp_made") + n("xpmiss") * c("xp_miss")
    + (n("fgmiss")) * c("fg_miss");
  // the league's yardage game bonuses
  const py = n("pass_yd"), ry = n("rush_yd"), cy = n("rec_yd");
  if (py >= 400) p += c("bonus_pass_400"); else if (py >= 300) p += c("bonus_pass_300");
  if (ry >= 200) p += c("bonus_rush_200"); else if (ry >= 100) p += c("bonus_rush_100");
  if (cy >= 200) p += c("bonus_rec_200"); else if (cy >= 100) p += c("bonus_rec_100");
  return Math.round(p * 100) / 100;
}

async function loadContext() {
  const [dirR, setDoc] = await Promise.all([
    fetch("https://api.sleeper.app/v1/players/nfl").then((r) => r.json()),
    fsDoc("settings"),
  ]);
  const byEspn = new Map();
  for (const [pid, m] of Object.entries(dirR)) if (m && m.espn_id) byEspn.set(String(m.espn_id), { pid, ...m });
  const scoring = (setDoc && setDoc.rules && setDoc.rules.scoring) || {};
  if (!Object.keys(scoring).length) throw new Error("could not read the live scoring rules");
  return { byEspn, scoring };
}

async function lock() {
  if (fs.existsSync(LOCK_PATH)) {
    const old = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
    if (!old.graded) { console.log("a lock already exists (locked " + old.lockedAt + ", ungraded) — grade it or delete the file first"); process.exit(1); }
  }
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  // tonight's slate — curl UA per the sports.mjs Akamai lesson
  const sb = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    { headers: { "user-agent": "curl/8.6.0" } }).then((r) => r.json());
  const seasonType = sb?.season?.type;
  const tonight = (sb.events || []).filter((e) =>
    new Date(e.date).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) === today);
  if (seasonType !== 1) console.log("WARNING: ESPN says season.type " + seasonType + " — this tool is for preseason");
  if (!tonight.length) { console.log("no games tonight (" + today + ") — nothing to lock"); process.exit(1); }
  const teamsTonight = new Set();
  const games = tonight.map((e) => {
    for (const c of e.competitions?.[0]?.competitors || []) teamsTonight.add(c.team?.abbreviation);
    return { id: e.id, name: e.shortName, kickoff: e.date };
  });
  console.log("tonight (" + today + "): " + games.map((g) => g.name).join(" · "));

  const { byEspn } = await loadContext();
  // the league's real rosters (week-1 docs), skill + K, playing tonight
  const seen = new Set(); const candidates = [];
  for (const tid of TEAM_IDS) {
    const doc = await fsDoc(`roster_2026_w1_t${tid}`);
    for (const p of (doc && doc.players) || []) {
      const k = String(p.key || "");
      if (!/^\d+$/.test(k) || seen.has(k)) continue;
      seen.add(k);
      const dir = byEspn.get(k);
      const team = (p.team || (dir && dir.team) || "").toUpperCase();
      const pos = p.pos || (dir && dir.position) || "";
      if (!teamsTonight.has(team) || !PRIOR[pos]) continue;
      const depth = dir && dir.depth_chart_order != null ? Number(dir.depth_chart_order) : 2;
      const injRaw = (dir && dir.injury_status) || p.injury || "";
      const inj = /out|ir|sus/i.test(injRaw) ? "OUT" : /doubt/i.test(injRaw) ? "D" : /quest/i.test(injRaw) ? "Q" : "";
      const row = { key: k, name: p.name || (dir && dir.full_name) || k, pos, team,
        base: priorFor(pos, depth), log: [] };
      if (inj) row.inj = inj;
      if (Number.isFinite(depth)) row.depth = depth;
      candidates.push(row);
    }
  }
  if (!candidates.length) { console.log("no rostered skill/K players play tonight"); process.exit(1); }
  console.log(candidates.length + " rostered players play tonight — asking Grok…");

  const NOTE = "These are NFL PRESEASON exhibition games tonight (preseason, not the regular season). "
    + "The 'base' numbers are NOT real projections — no provider publishes preseason projections — they are a crude positional prior. "
    + "Ignore the ±35% anchor discipline for this run: project each player's PRESEASON fantasy points freely from his depth-chart order, "
    + "injury status and what you know of how his team handles preseason snaps (starters usually sit or play a series; "
    + "2nd/3rd-stringers carry the middle quarters; late-round rookies fighting for a roster spot play most). Healthy scratches are common.";

  const players = [];
  for (let i = 0; i < candidates.length; i += 35) {
    const batch = candidates.slice(i, i + 35);
    const sent = new Map(batch.map((p) => [p.key, p]));
    const t0 = Date.now();
    const r = await fetch(SITE + "/.netlify/functions/farmgpt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: SECRET, mode: "gffladjust", adjust: { week: 1, note: NOTE, players: batch } }),
    });
    const text = (await r.text()).trim();
    let arr = [];
    try { arr = JSON.parse(text); } catch (e) { console.log("batch " + (i / 35 + 1) + " unparseable (" + r.status + "): " + text.slice(0, 120)); continue; }
    console.log("batch " + (i / 35 + 1) + ": " + arr.length + " rows in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
    for (const a of arr) {
      const src = sent.get(String(a && a.key));
      const p = Number(a && a.proj);
      if (!src || !Number.isFinite(p) || p < 0 || p > 60) continue;   // same spirit as the client's validation
      players.push({ ...src, proj: Math.round(p * 10) / 10, note: String((a && a.note) || "").slice(0, 90) });
    }
  }
  if (!players.length) { console.log("no valid projections came back — nothing locked"); process.exit(1); }
  const doc = { lockedAt: new Date().toISOString(), slateDate: today, games, prior: PRIOR,
    model: "grok via gffladjust (deployed)", note: NOTE, players, graded: null };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(doc, null, 2));
  console.log("\nLOCKED " + players.length + " projections → tools/_gffl_preseason_lock.json");
  for (const p of players.sort((a, b) => b.proj - a.proj).slice(0, 15)) {
    console.log("  " + (p.name + " (" + p.pos + " " + p.team + (p.depth ? " d" + p.depth : "") + (p.inj ? " " + p.inj : "") + ")").padEnd(40)
      + "prior " + String(p.base).padEnd(5) + "→ " + String(p.proj).padEnd(6) + (p.note || ""));
  }
  console.log("\nGrade after the games: node tools/_gffl_preseason_test.mjs --grade");
}

async function grade() {
  if (!fs.existsSync(LOCK_PATH)) { console.log("no lock file — run --lock before the games"); process.exit(1); }
  const doc = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  const { byEspn, scoring } = await loadContext();
  // Sleeper's own preseason week bucket — ESPN and Sleeper disagree about the preseason week
  // number (ESPN counted this slate as pre wk2 while Sleeper's state said wk1), so read the
  // state and take whichever bucket actually carries these games' stats.
  const st = await fetch("https://api.sleeper.app/v1/state/nfl").then((r) => r.json());
  const weeks = [...new Set([st.week, st.week - 1, st.week + 1].filter((w) => w >= 1 && w <= 4))];
  let stats = null, usedWeek = null;
  for (const w of weeks) {
    const j = await fetch(`https://api.sleeper.app/v1/stats/nfl/pre/2026/${w}`).then((r) => (r.ok ? r.json() : null));
    if (j && Object.keys(j).length > 50) { stats = j; usedWeek = w; break; }
  }
  if (!stats) { console.log("no preseason stats posted yet (tried pre weeks " + weeks.join(",") + ") — try again after the games"); process.exit(1); }
  console.log("grading vs sleeper pre/2026/" + usedWeek + " (" + Object.keys(stats).length + " stat rows) — league scoring from the live rules doc\n");
  const rows = [];
  for (const p of doc.players) {
    const dir = byEspn.get(String(p.key));
    const line = dir ? stats[dir.pid] : null;
    const actual = line ? scoreLine(line, scoring) : null;   // null = no stat line at all (DNP)
    rows.push({ ...p, actual });
  }
  const played = rows.filter((r) => r.actual != null);
  const mae = (list, f) => list.length ? list.reduce((s, r) => s + Math.abs(f(r) - r.actual), 0) / list.length : null;
  const gPlayed = mae(played, (r) => r.proj), pPlayed = mae(played, (r) => r.base);
  const all = rows.map((r) => ({ ...r, actual: r.actual ?? 0 }));
  const gAll = mae(all, (r) => r.proj), pAll = mae(all, (r) => r.base);
  rows.sort((a, b) => (b.actual ?? -1) - (a.actual ?? -1));
  for (const r of rows) {
    console.log("  " + (r.name + " (" + r.pos + " " + r.team + ")").padEnd(34)
      + "prior " + String(r.base).padEnd(5) + "grok " + String(r.proj).padEnd(6)
      + "actual " + (r.actual == null ? "DNP" : r.actual.toFixed(1)));
  }
  console.log("\nplayed: " + played.length + "/" + rows.length
    + " · GROK MAE " + (gPlayed == null ? "—" : gPlayed.toFixed(2)) + " vs PRIOR MAE " + (pPlayed == null ? "—" : pPlayed.toFixed(2)) + " (played only)"
    + " · incl. DNP-as-0: GROK " + gAll.toFixed(2) + " vs PRIOR " + pAll.toFixed(2));
  console.log(gPlayed != null && gPlayed < pPlayed
    ? "VERDICT: Grok beat its own crude prior — the minimum bar for claiming skill."
    : "VERDICT: Grok did NOT beat the crude prior on this slate — preseason noise or no edge; either way, an honest datapoint.");
  doc.graded = { at: new Date().toISOString(), sleeperWeek: usedWeek, played: played.length, of: rows.length,
    grokMaePlayed: gPlayed, priorMaePlayed: pPlayed, grokMaeAll: gAll, priorMaeAll: pAll,
    rows: rows.map(({ key, name, pos, team, base, proj, actual }) => ({ key, name, pos, team, base, proj, actual })) };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(doc, null, 2));
  console.log("graded results written back into tools/_gffl_preseason_lock.json");
}

const mode = process.argv.includes("--grade") ? "grade" : process.argv.includes("--lock") ? "lock" : null;
if (!mode) { console.log("usage: node tools/_gffl_preseason_test.mjs --lock | --grade"); process.exit(1); }
await (mode === "lock" ? lock() : grade());
