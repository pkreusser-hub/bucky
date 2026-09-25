#!/usr/bin/env node
// GFFL history load (2026-09-25). One-off, run from a machine that can reach Firestore:
//
//   node tools/_gffl_load_history.mjs            # dry run: prints every change, writes nothing
//   node tools/_gffl_load_history.mjs --apply    # backup -> masked PATCH -> canonical re-read
//
// What it writes (user rulings, 2026-09-25):
//   hist_2016, hist_2017  — full seasons from ESPN's leagueHistory (via the deployed league
//                           function), ESPN team ids mapped to the app's franchise ids.
//   hist_2018             — Dawn Treaders (ESPN 12) re-id'd 12 -> 1904 in teams + matchups;
//                           Space City Rockets (2019-2021) stays the GOAT Kids (12).
//   awards_history        — appended, never rewritten: 2016 champion + points (IN LAWS, now
//                           Laws Rule, id 5) and a "third" row for every season 2016-2025.
// Backups land in ./gffl_backup_<timestamp>/ next to where you run it.
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const FN = "https://amenfarms.netlify.app/.netlify/functions/league";
const KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU"; // the public web key lg-core.js already ships
const DOCS = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents/gffl_fam2jan2g";

// ESPN team id -> app franchise id. 2016/17: Lucky Number Seven is Battle Kreussers (user);
// IN LAWS / In and Out Laws (Sandra Laws) is Laws Rule 5; ST Red Shirts is the defunct 1905
// lineage; OUT LAWS -> Outlaws 1024 and Team Krucial -> Krucial 1018 (both already on file);
// Team Jones 1037 and Numbskulls and Nutz 1038 are new defunct ids.
const MAP_OLD = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1905, 6: 1037, 7: 5, 8: 1024, 9: 9, 10: 1018, 11: 11, 12: 1038 };
const MAP_NEW = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 1905, 9: 9, 11: 11, 12: 12 }; // 2018-2025, per the app's own hist docs
const clean = (s) => String(s || "").split(/\s+/).filter(Boolean).join(" ");

// ---- Firestore value codec (whole numbers as integerValue — CLAUDE.md "bites" #9) ----
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v) {
  if (!v) return null;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
const decDoc = (d) => (d && d.fields ? dec({ mapValue: { fields: d.fields } }) : null);
const canon = (x) => JSON.stringify(x, Object.keys(x && typeof x === "object" ? flatKeys(x) : {}).sort());
function flatKeys(o, acc = {}) { if (o && typeof o === "object") for (const k of Object.keys(o)) { acc[k] = 1; flatKeys(o[k], acc); } return acc; }

async function espn(season) {
  const r = await fetch(FN, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: "amenfarms", action: "lg_espn_history", season }) });
  const j = await r.json();
  if (!j.ok) throw new Error("ESPN " + season + ": " + j.reason);
  return j;
}
async function getDoc(id) {
  const r = await fetch(`${DOCS}/${id}?key=${KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("read " + id + ": HTTP " + r.status);
  return r.json();
}
async function patch(id, fields) {
  const mask = Object.keys(fields).map((f) => "updateMask.fieldPaths=" + encodeURIComponent(f)).join("&");
  const r = await fetch(`${DOCS}/${id}?key=${KEY}&${mask}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error("write " + id + ": HTTP " + r.status + " " + (await r.text()).slice(0, 300));
}

function seasonDoc(e, map) {
  return {
    kind: "hist", season: e.season, leagueName: e.leagueName || "",
    teams: e.teams.map((t) => ({ ...t, id: map[t.id], name: clean(t.name) })),
    champion: e.champion ? { teamId: map[e.champion.teamId], name: clean(e.champion.name) } : null,
    matchups: e.matchups.map((m) => ({ ...m, home: map[m.home], away: map[m.away] })),
  };
}

(async () => {
  const plan = []; // { id, fields (Firestore-encoded), expect (decoded values of those fields) }
  const seasons = {};
  for (let y = 2016; y <= 2025; y++) seasons[y] = await espn(y);
  for (const y of [2016, 2017]) {
    for (const t of seasons[y].teams) if (MAP_OLD[t.id] == null) throw new Error(`unmapped ESPN team ${t.id} in ${y}`);
    const doc = seasonDoc(seasons[y], MAP_OLD);
    plan.push({ id: "hist_" + y, fields: Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, enc(v)])), expect: doc });
  }
  // 2018: Dawn Treaders out of the GOAT Kids lineage.
  const h18raw = await getDoc("hist_2018");
  const h18 = decDoc(h18raw);
  if (!h18) throw new Error("hist_2018 missing");
  let nT = 0, nM = 0;
  const teams18 = h18.teams.map((t) => (t.name === "Dawn Treaders" && t.id === 12 ? (nT++, { ...t, id: 1904 }) : t));
  const dt = new Set(teams18.filter((t) => t.id === 1904).length ? [12] : []);
  const matchups18 = h18.matchups.map((m) => {
    const x = { ...m };
    if (dt.has(x.home)) { x.home = 1904; nM++; }
    if (dt.has(x.away)) { x.away = 1904; nM++; }
    return x;
  });
  if (nT) plan.push({ id: "hist_2018", fields: { teams: enc(teams18), matchups: enc(matchups18) }, expect: { teams: teams18, matchups: matchups18 } });
  // Awards: append only what is not already there (year + kind).
  const awRaw = await getDoc("awards_history");
  const aw = (decDoc(awRaw) || {}).awards || [];
  const have = new Set(aw.map((a) => a.year + ":" + a.kind));
  const add = [];
  const row = (year, teamId, name, kind) => ({ year, teamId, name: clean(name), kind });
  add.push(row(2016, 5, "IN LAWS", "champion"), row(2016, 5, "IN LAWS", "points"));
  for (let y = 2016; y <= 2025; y++) {
    const t3 = seasons[y].teams.find((t) => t.place === 3);
    if (!t3) continue;
    let id = (y < 2018 ? MAP_OLD : MAP_NEW)[t3.id];
    if (clean(t3.name) === "Dawn Treaders") id = 1904;
    add.push(row(y, id, t3.name, "third"));
  }
  const fresh = add.filter((a) => !have.has(a.year + ":" + a.kind));
  if (fresh.length) {
    const rawVals = awRaw.fields.awards.arrayValue.values; // existing rows kept byte-for-byte
    plan.push({ id: "awards_history", fields: { awards: { arrayValue: { values: rawVals.concat(fresh.map(enc)) } } },
      expect: { awards: aw.concat(fresh) } });
  }

  console.log(`hist_2016: ${plan[0].expect.teams.length} teams, ${plan[0].expect.matchups.length} games, champion ${plan[0].expect.champion.name}`);
  console.log(`hist_2017: ${plan[1].expect.teams.length} teams, ${plan[1].expect.matchups.length} games, champion ${plan[1].expect.champion.name}`);
  console.log(`hist_2018: Dawn Treaders ${nT} team row, ${nM} game sides -> 1904`);
  console.log(`awards_history: ${aw.length} rows + ${fresh.length} new:`);
  for (const a of fresh) console.log(`  ${a.year} ${a.kind.padEnd(8)} ${String(a.teamId).padEnd(5)} ${a.name}`);
  if (!APPLY) { console.log("\nDry run — nothing written. Re-run with --apply."); return; }

  const dir = "gffl_backup_" + new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(dir);
  for (const p of plan) fs.writeFileSync(`${dir}/${p.id}.json`, JSON.stringify(await getDoc(p.id), null, 1));
  console.log("\nbackups in " + dir + "/");
  for (const p of plan) {
    await patch(p.id, p.fields);
    const back = decDoc(await getDoc(p.id));
    const ok = Object.keys(p.expect).every((k) => canon(back[k]) === canon(p.expect[k]));
    console.log(`${ok ? "verified" : "MISMATCH"}  ${p.id}`);
    if (!ok) { console.log("Stopping. Restore from " + dir + " if needed."); process.exit(1); }
  }
  console.log("\nDone. Reload the league page to see 2016, 2017 and the Third Place shelves.");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
