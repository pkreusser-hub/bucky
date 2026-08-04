#!/usr/bin/env node
// Validates Story Time universe packs against the pack subset of Ledger schema v1
// (see storytime-continuity-plan.md → "Ledger schema v1" / "Universe packs").
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

  const diskKb = Buffer.byteLength(raw, "utf8") / 1024;
  const seedKb = Buffer.byteLength(JSON.stringify(pack), "utf8") / 1024;
  console.log(`\n${file} — ${seedKb.toFixed(1)} KB seed (${diskKb.toFixed(1)} KB on disk)`);
  assert(seedKb <= SEED_FAIL_KB, file,
    `seed is ${seedKb.toFixed(1)} KB, over the ${SEED_FAIL_KB} KB ceiling — no room to grow under the ~30 KB ledger cap`);
  if (seedKb > SEED_WARN_KB && seedKb <= SEED_FAIL_KB) {
    console.log(`  note: ${seedKb.toFixed(1)} KB seed leaves under ${(30 - seedKb).toFixed(1)} KB of ledger headroom`);
  }

  // ---- meta -------------------------------------------------------------
  assert(pack.meta && typeof pack.meta === "object", file, "meta missing");
  if (pack.meta) {
    for (const f of META_FIELDS) assert(str(pack.meta[f]), file, `meta.${f} missing or empty`);
    assert(pack.meta.schema_version === 1, file, "meta.schema_version must be 1");
    assert(basename(file, ".json") === pack.meta.universe, file,
      `meta.universe "${pack.meta.universe}" must match the filename`);
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
