#!/usr/bin/env node
// tools/_gffl_asset_versions.mjs — records which bytes each GFFL script version stands for.
//
// Since 2026-10-04 netlify.toml serves /assets/league/*.js as `immutable` for a year: a phone that
// has lg-ui.js?v=X never asks for that URL again. An edit to an lg-*.js file that ships WITHOUT a
// new ?v= would therefore never reach phones that already hold the old file. The suite's AVG
// section compares the three files' sha-256 against tools/_gffl_asset_versions.json under the
// current gffl-v; this script writes that entry.
//
//   node tools/_gffl_asset_versions.mjs           # print current version + hashes, and whether they match
//   node tools/_gffl_asset_versions.mjs --record  # record them under the current version
//
// --record REFUSES when the current version is already recorded with different bytes: that is
// exactly the forgotten bump. Bump the version (gffl-version.txt, the gffl-v meta and the three
// ?v= strings in league.html), then record.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["lg-core.js", "lg-data.js", "lg-ui.js"];
const STORE = join(ROOT, "tools", "_gffl_asset_versions.json");

const html = readFileSync(join(ROOT, "league.html"), "utf8");
const v = (html.match(/<meta name="gffl-v" content="([^"]+)"/) || [])[1];
if (!v) { console.error("no gffl-v meta in league.html"); process.exit(1); }
const now = Object.fromEntries(FILES.map((f) => [f, createHash("sha256").update(readFileSync(join(ROOT, "assets", "league", f))).digest("hex")]));
const store = existsSync(STORE) ? JSON.parse(readFileSync(STORE, "utf8")) : {};
const had = store[v];
const same = had && FILES.every((f) => had[f] === now[f]);

console.log("gffl-v " + v + (had ? (same ? " — recorded, bytes match" : " — recorded with DIFFERENT bytes") : " — not recorded"));
for (const f of FILES) console.log("  " + f + "  " + now[f]);
if (!process.argv.includes("--record")) process.exit(had && !same ? 1 : 0);
if (had && !same) {
  console.error("\nRefusing: " + v + " already shipped with other bytes. Bump the version first (gffl-version.txt, the gffl-v meta, the three ?v= in league.html).");
  process.exit(1);
}
store[v] = now;
// keep the store small: the current version is the only one the suite reads
const keep = Object.keys(store).sort().slice(-5);
writeFileSync(STORE, JSON.stringify(Object.fromEntries(keep.map((k) => [k, store[k]])), null, 2) + "\n");
console.log("recorded " + v);
