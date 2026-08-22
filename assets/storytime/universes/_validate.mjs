#!/usr/bin/env node
// Validates Story Time universe packs against the pack subset of Ledger schema v1, plus the
// PACK SCHEMA v2 additions — meta.triggers and meta.eras (see storytime-continuity-plan.md →
// "Ledger schema v1" / "Universe packs", and CLAUDE.md → "📖 STORY TIME CONTINUITY").
//
// v2 (2026-08-22, the universe merge) folded the server's UNIVERSE_BIBLES into these files, so a
// pack is now the ONLY place a franchise fact is written. Two fields carry that:
//   meta.triggers  — the detection regex SOURCE (a string, compiled with "i"). Auto-selects the
//                    pack from a story's setup text, and keeps a legacy story sticky to it.
//   meta.eras      — { default: "<id>", list: [ {id, label, timeline_point, triggers,
//                    canon_add, canon_remove, characters_add, character_overrides,
//                    locations_add} ] }. An era is a set of OVERRIDES applied to the pack before
//                    it seeds a ledger, so one file can hold "end of Race to the Edge" and
//                    "after the third film" without two copies of the cast.
//
//   node assets/storytime/universes/_validate.mjs            # validate every pack
//   node assets/storytime/universes/_validate.mjs httyd.json # validate one
//
// Exits 0 when every pack is clean, 1 otherwise. Reusable by future packs.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));

const META_FIELDS = ["universe", "title", "timeline_point", "genre_and_tone", "narrative_voice"];
const CHAR_STRINGS = ["id", "name", "origin", "role", "status", "physical", "voice", "motivation"];
const CHAR_ARRAYS = ["possessions", "knows", "does_not_know"];
const VALID_SOURCE = ["pack", "reader", "story"];
const VALID_ORIGIN = ["pack", "story", "reader"];
// Packs seed a story at turn 0; entries carrying a turn must say so.
// SIZE: what matters is the MINIFIED size, because that is what seeds the ledger and
// counts against the server's ~30KB ledger cap (storytime-continuity-plan.md → Server
// contract). A pack must leave room for the story that grows on top of it.
const SEED_WARN_KB = 24;   // warn: little headroom left under the 30KB ledger cap
const SEED_FAIL_KB = 28;   // fail: a story could not grow on this seed at all

let checks = 0, fails = 0;
const fail = (file, msg) => { checks++; fails++; console.log(`  FAIL  [${file}] ${msg}`); };
const ok = () => { checks++; };
const assert = (cond, file, msg) => { cond ? ok() : fail(file, msg); };

// A non-empty, non-whitespace string.
const str = (v) => typeof v === "string" && v.trim().length > 0;
// One sentence: no internal sentence break followed by a capital / new clause.
const oneSentence = (s) => !/[.!?]\s+\S/.test(s.trim());

// ---- schema v2: meta.triggers -------------------------------------------
// A STRING, not a literal, because JSON has no regex type — the client and the server both
// compile it with `new RegExp(src, "i")`. A source that does not compile would throw at pack
// load, so it is checked here rather than discovered by a child's story failing to start.
function validateTriggers(file, pack) {
  const src = pack.meta.triggers;
  assert(str(src), file, "meta.triggers missing or empty (schema v2)");
  if (!str(src)) return;
  let re = null;
  try { re = new RegExp(src, "i"); } catch (e) { return fail(file, `meta.triggers does not compile: ${e.message}`); }
  ok();
  // A trigger that matches the empty string matches EVERY story — the pack would be selected
  // for a story about a lost puppy. This has to be impossible, not merely unlikely.
  assert(!re.test(""), file, "meta.triggers matches the empty string — it would select this pack for every story");
  // The universe's own name must be one of its triggers, or naming the franchise outright
  // would not select it.
  assert(re.test(pack.meta.title), file,
    `meta.triggers does not match the pack's own title "${pack.meta.title}"`);
}

// ---- schema v2: meta.eras ------------------------------------------------
// The v1 packs pinned exactly one timeline point in meta and could not say anything else. An era
// is a named set of OVERRIDES over that base: it may retire canon rules that the later timeline
// makes false, add rules it makes true, add characters who did not exist yet, and rewrite the
// status / knowledge of characters who did. Everything else is inherited.
const ERA_OVERRIDE_FIELDS = ["role", "status", "knows", "does_not_know", "last_seen", "physical", "motivation"];
function validateEras(file, pack) {
  const eras = pack.meta.eras;
  assert(eras && typeof eras === "object" && !Array.isArray(eras), file, "meta.eras missing (schema v2)");
  if (!eras || typeof eras !== "object") return;
  const list = eras.list;
  assert(Array.isArray(list) && list.length > 0, file, "meta.eras.list must be a non-empty array");
  if (!Array.isArray(list)) return;
  const ids = new Set();
  const canonIds = new Set((pack.canon || []).map((c) => c && c.id));
  const charNames = new Set((pack.characters || []).map((c) => c && c.name));
  for (const [i, e] of list.entries()) {
    const where = `meta.eras.list[${i}] (${e && e.id})`;
    assert(str(e && e.id) && /^[a-z0-9_]+$/.test(e.id), file, `${where}: id must be lowercase [a-z0-9_]`);
    assert(!ids.has(e && e.id), file, `${where}: duplicate era id`);
    if (e && e.id) ids.add(e.id);
    for (const f of ["label", "timeline_point", "triggers"]) assert(str(e && e[f]), file, `${where}: ${f} missing or empty`);
    if (str(e && e.triggers)) {
      try { new RegExp(e.triggers, "i"); ok(); }
      catch (err) { fail(file, `${where}: triggers does not compile: ${err.message}`); }
    }
    for (const f of ["canon_add", "canon_remove", "characters_add", "character_overrides", "locations_add"]) {
      assert(Array.isArray(e && e[f]), file, `${where}: ${f} must be an array (use [] for none)`);
    }
    for (const [j, c] of ((e && e.canon_add) || []).entries()) {
      assert(str(c && c.rule), file, `${where}.canon_add[${j}]: rule missing`);
      assert(str(c && c.rule) && oneSentence(c.rule), file, `${where}.canon_add[${j}]: rule must be ONE sentence`);
      // Era canon ids are assigned when the era is applied, exactly as the client does for a pack.
      assert(!c.id, file, `${where}.canon_add[${j}]: never write an "id" — it is assigned on apply`);
    }
    // A canon_remove pointing at an id the pack does not have is a silent no-op, which is
    // exactly how an era stops doing what it says on the tin after a canon renumber.
    for (const id of ((e && e.canon_remove) || [])) {
      assert(canonIds.has(id), file, `${where}: canon_remove names "${id}", which this pack has no canon entry for`);
    }
    for (const [j, o] of ((e && e.character_overrides) || []).entries()) {
      assert(str(o && o.name) && charNames.has(o.name), file,
        `${where}.character_overrides[${j}]: name "${o && o.name}" is not a character in this pack`);
      const extra = Object.keys(o || {}).filter((k) => k !== "name" && !ERA_OVERRIDE_FIELDS.includes(k));
      assert(!extra.length, file,
        `${where}.character_overrides[${j}]: may only override ${ERA_OVERRIDE_FIELDS.join("/")} — saw ${extra.join(", ")}`);
      assert(Object.keys(o || {}).length > 1, file, `${where}.character_overrides[${j}]: overrides nothing`);
    }
    for (const [j, ch] of ((e && e.characters_add) || []).entries()) {
      const w = `${where}.characters_add[${j}] (${ch && ch.name})`;
      assert(!charNames.has(ch && ch.name), file, `${w}: this pack already has a character by that name`);
      for (const f of CHAR_STRINGS.filter((f) => f !== "id")) assert(str(ch && ch[f]), file, `${w}: ${f} missing or empty`);
      for (const f of CHAR_ARRAYS) assert(Array.isArray(ch && ch[f]) && ch[f].length > 0 && ch[f].every(str), file, `${w}: ${f} must be a non-empty array of strings`);
      assert(ch && ch.last_seen && ch.last_seen.turn === 0 && str(ch.last_seen.location) && str(ch.last_seen.state),
        file, `${w}: last_seen must be {turn:0, location, state}`);
      assert(!ch.id, file, `${w}: never write an "id" — it is assigned on apply`);
    }
    for (const [j, l] of ((e && e.locations_add) || []).entries()) {
      for (const f of ["name", "description", "state"]) assert(str(l && l[f]), file, `${where}.locations_add[${j}]: ${f} missing or empty`);
      assert(!l.id, file, `${where}.locations_add[${j}]: never write an "id" — it is assigned on apply`);
    }
  }
  assert(str(eras.default) && ids.has(eras.default), file,
    `meta.eras.default "${eras.default}" is not one of the era ids (${[...ids].join(", ")})`);
}

// The seed a story actually starts from, once an era has been applied. Deliberately a MINIMAL
// re-implementation of the client's applyPackEra — it exists only to make the size ceiling
// honest for the LARGEST era, not to be the second copy of the feature.
function eraSeedSize(pack, era) {
  const led = {
    meta: { universe: pack.meta.universe, title: pack.meta.title, timeline_point: era.timeline_point,
            genre_and_tone: pack.meta.genre_and_tone, narrative_voice: pack.meta.narrative_voice },
    canon: (pack.canon || []).filter((c) => !(era.canon_remove || []).includes(c.id))
      .concat((era.canon_add || []).map((c) => ({ ...c, id: "C99", source: "pack", turn: 0 }))),
    characters: (pack.characters || []).concat((era.characters_add || []).map((c) => ({ ...c, id: "CH99" }))),
    relationships: pack.relationships || [],
    locations: (pack.locations || []).concat((era.locations_add || []).map((l) => ({ ...l, id: "L99", visited_turns: [] }))),
  };
  return Buffer.byteLength(JSON.stringify(led), "utf8") / 1024;
}

function validatePack(file) {
  const path = join(DIR, file);
  let raw, pack;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    return fail(file, `unreadable: ${e.message}`);
  }
  try {
    pack = JSON.parse(raw);
  } catch (e) {
    return fail(file, `does not parse as JSON: ${e.message}`);
  }
  ok();

  // SIZE, schema v2: measured on the seed an era ACTUALLY produces, not on the file. meta.triggers
  // and meta.eras never ride the ledger — the pack file is now bigger than the ledger it seeds, and
  // measuring the file would have failed httyd for bytes no story ever carries. The ceiling is
  // applied to the LARGEST era, since that is the one a reader can actually land on.
  const diskKb = Buffer.byteLength(raw, "utf8") / 1024;
  const eraList = (pack.meta && pack.meta.eras && Array.isArray(pack.meta.eras.list)) ? pack.meta.eras.list : [];
  let seedKb = Buffer.byteLength(JSON.stringify({
    meta: pack.meta ? { ...pack.meta, triggers: undefined, eras: undefined } : {},
    canon: pack.canon, characters: pack.characters, relationships: pack.relationships, locations: pack.locations,
  }), "utf8") / 1024;
  let worstEra = "(no era)";
  for (const e of eraList) {
    const kb = eraSeedSize(pack, e);
    if (kb > seedKb) { seedKb = kb; worstEra = e.id; }
    else if (worstEra === "(no era)") worstEra = e.id;
  }
  console.log(`\n${file} — ${seedKb.toFixed(1)} KB seed at its largest era "${worstEra}" (${diskKb.toFixed(1)} KB on disk)`);
  assert(seedKb <= SEED_FAIL_KB, file,
    `seed is ${seedKb.toFixed(1)} KB, over the ${SEED_FAIL_KB} KB ceiling — no room to grow under the ~30 KB ledger cap`);
  if (seedKb > SEED_WARN_KB && seedKb <= SEED_FAIL_KB) {
    console.log(`  note: ${seedKb.toFixed(1)} KB seed leaves under ${(30 - seedKb).toFixed(1)} KB of ledger headroom`);
  }

  // ---- meta -------------------------------------------------------------
  assert(pack.meta && typeof pack.meta === "object", file, "meta missing");
  if (pack.meta) {
    for (const f of META_FIELDS) assert(str(pack.meta[f]), file, `meta.${f} missing or empty`);
    assert(pack.meta.schema_version === 2, file, "meta.schema_version must be 2");
    assert(basename(file, ".json") === pack.meta.universe, file,
      `meta.universe "${pack.meta.universe}" must match the filename`);
    validateTriggers(file, pack);
    validateEras(file, pack);
  }

  // ---- top-level pack subset -------------------------------------------
  for (const key of ["canon", "characters", "relationships", "locations"]) {
    assert(Array.isArray(pack[key]) && pack[key].length > 0, file, `${key} must be a non-empty array`);
  }

  const seen = new Set();
  const uniqueId = (id, pattern, where) => {
    assert(str(id) && pattern.test(id), file, `${where}: id "${id}" must match ${pattern}`);
    assert(!seen.has(id), file, `${where}: duplicate id "${id}"`);
    seen.add(id);
  };

  // ---- canon ------------------------------------------------------------
  for (const [i, c] of (pack.canon || []).entries()) {
    const where = `canon[${i}]`;
    uniqueId(c.id, /^C\d+$/, where);
    assert(str(c.rule), file, `${where}: rule missing or empty`);
    assert(str(c.rule) && oneSentence(c.rule), file, `${where}: rule must be ONE sentence — "${String(c.rule).slice(0, 60)}…"`);
    assert(VALID_SOURCE.includes(c.source), file, `${where}: source must be one of ${VALID_SOURCE.join("|")}`);
    assert(c.turn === 0, file, `${where}: pack entries must be turn 0`);
  }

  // ---- characters -------------------------------------------------------
  const names = new Set();
  for (const [i, ch] of (pack.characters || []).entries()) {
    const where = `characters[${i}] (${ch && ch.name})`;
    uniqueId(ch.id, /^CH\d+$/, where);
    for (const f of CHAR_STRINGS) assert(str(ch[f]), file, `${where}: ${f} missing or empty`);
    assert(VALID_ORIGIN.includes(ch.origin), file, `${where}: origin must be one of ${VALID_ORIGIN.join("|")}`);
    for (const f of CHAR_ARRAYS) {
      const arr = ch[f];
      assert(Array.isArray(arr) && arr.length > 0, file, `${where}: ${f} must be a non-empty array`);
      if (Array.isArray(arr)) assert(arr.every(str), file, `${where}: ${f} has an empty entry`);
    }
    const ls = ch.last_seen;
    assert(ls && typeof ls === "object", file, `${where}: last_seen missing`);
    if (ls) {
      assert(ls.turn === 0, file, `${where}: last_seen.turn must be 0 in a pack`);
      assert(str(ls.location), file, `${where}: last_seen.location missing or empty`);
      assert(str(ls.state), file, `${where}: last_seen.state missing or empty`);
    }
    if (str(ch.name)) {
      assert(!names.has(ch.name), file, `${where}: duplicate character name`);
      names.add(ch.name);
    }
  }

  // ---- relationships ----------------------------------------------------
  for (const [i, r] of (pack.relationships || []).entries()) {
    const where = `relationships[${i}]`;
    assert(Array.isArray(r.between) && r.between.length === 2 && r.between.every(str), file,
      `${where}: between must be two non-empty names`);
    assert(str(r.state), file, `${where}: state missing or empty`);
    assert(str(r.history), file, `${where}: history missing or empty`);
    assert(r.changed_turn === 0, file, `${where}: changed_turn must be 0 in a pack`);
  }

  // ---- locations --------------------------------------------------------
  for (const [i, l] of (pack.locations || []).entries()) {
    const where = `locations[${i}] (${l && l.name})`;
    uniqueId(l.id, /^L\d+$/, where);
    for (const f of ["name", "description", "state"]) assert(str(l[f]), file, `${where}: ${f} missing or empty`);
    assert(Array.isArray(l.visited_turns), file, `${where}: visited_turns must be an array`);
  }

  // ---- no stray keys outside the pack subset ---------------------------
  const allowed = new Set(["meta", "canon", "characters", "relationships", "locations"]);
  for (const k of Object.keys(pack)) {
    assert(allowed.has(k), file, `unexpected top-level key "${k}" (pack subset is ${[...allowed].join(", ")})`);
  }

  console.log(`  ${pack.characters?.length ?? 0} characters · ${pack.canon?.length ?? 0} canon · ` +
              `${pack.relationships?.length ?? 0} relationships · ${pack.locations?.length ?? 0} locations`);
}

const argv = process.argv.slice(2);
// NB: argv.map(basename) would hand basename() the array INDEX as its `suffix` arg.
const files = argv.length ? argv.map((f) => basename(f))
  : readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();

if (!files.length) {
  console.log("no packs found");
  process.exit(1);
}
for (const f of files) validatePack(f);

console.log(`\n${checks - fails}/${checks} checks passed across ${files.length} pack(s)`);
process.exit(fails ? 1 : 0);
