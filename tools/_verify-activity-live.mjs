#!/usr/bin/env node
/**
 * BUCKY activity — REAL Firestore contract check.
 *
 *   node tools/_verify-activity-live.mjs
 *
 * WHY THIS EXISTS. The mocked suite passed 147/147 while production recorded nothing for
 * twelve hours: the function wrote property paths like `03_news_v`, and Firestore rejects
 * any unquoted path that doesn't match ([a-zA-Z_][a-zA-Z_0-9]*). The fake Firestore didn't
 * enforce that grammar, so the bug was invisible. The fake now does — but a fake can only
 * ever encode the rules we already know about, so this check sends the function's REAL
 * write to the REAL service and reads it back.
 *
 * Safe to run any time: it writes to a scratch collection (`diag_activity`), never to
 * `bucky_activity`, and deletes what it wrote. It uses the public web API key (the app's
 * rules are public — same access the browser already has), NOT the service account.
 */
import { planWrites, parseDoc } from "../netlify/functions/activity.mjs";

const KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const HOST = "https://firestore.googleapis.com/v1/";
const DB = "projects/amen-farms-app/databases/(default)/documents";
const SCRATCH = "diag_activity";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

// The exact write the function emits, aimed at the scratch collection.
const plan = planWrites([
  { user: "DiagTest", day, feature: "news", v: 2, m: 1.5 },
  { user: "DiagTest", day, feature: "app_mealplan", v: 1, m: 0.25 },
], day);
ok(plan.docs.length === 1, "planWrites produced one document");

const doc = plan.docs[0];
const transforms = [];
for (const [k, val] of doc.fields) {
  if (val.v) transforms.push({ fieldPath: `${k}_v`, increment: { integerValue: String(val.v) } });
  if (val.m) transforms.push({ fieldPath: `${k}_m`, increment: { doubleValue: val.m } });
}
const paths = transforms.map((t) => t.fieldPath);
console.log("  · field paths: " + paths.join(", "));
ok(paths.every((p) => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(p)),
  "every property path satisfies Firestore's unquoted grammar");

const write = {
  update: { name: `${DB}/${SCRATCH}/${doc.docId}`, fields: { user: { stringValue: doc.user }, month: { stringValue: doc.month } } },
  updateMask: { fieldPaths: ["user", "month"] },
  updateTransforms: transforms,
};

const commit = await fetch(`${HOST}${DB}:commit?key=${KEY}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ writes: [write] }),
});
const commitBody = commit.ok ? "" : (await commit.text()).replace(/\s+/g, " ").slice(0, 200);
ok(commit.ok, "REAL Firestore ACCEPTS the write" + (commit.ok ? "" : " — " + commitBody));

if (commit.ok) {
  // Send it twice: increments must ADD, which is the whole reason for transforms.
  await fetch(`${HOST}${DB}:commit?key=${KEY}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ writes: [write] }),
  });

  const got = await (await fetch(`${HOST}${DB}/${SCRATCH}/${doc.docId}?key=${KEY}`)).json();
  ok(!!got.fields, "the document reads back");
  const parsed = parseDoc({ name: `x/y/${doc.docId}`, fields: got.fields });
  const cell = parsed.days[day] || {};
  ok(parsed.user === "DiagTest", `parseDoc recovers the display name (${parsed.user})`);
  ok(cell.news && cell.news.v === 4, `two commits ADDED: news views = 4 (${cell.news && cell.news.v})`);
  ok(cell.news && Math.abs(cell.news.m - 3) < 0.001, `minutes kept their fraction: 3 (${cell.news && cell.news.m})`);
  ok(cell.app_mealplan && cell.app_mealplan.v === 2, "an underscored feature name survives the round trip");

  await fetch(`${HOST}${DB}/${SCRATCH}/${doc.docId}?key=${KEY}`, { method: "DELETE" });
  const gone = await (await fetch(`${HOST}${DB}/${SCRATCH}/${doc.docId}?key=${KEY}`)).json();
  ok(!!gone.error, "the scratch document was cleaned up");
}

console.log(`\nACTIVITY LIVE: ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
