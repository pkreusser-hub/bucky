#!/usr/bin/env node
/**
 * THE SHIPPING STACK — live probe against the REAL models.
 *
 *   node tools/_probe-storyship.mjs                # everything
 *   node tools/_probe-storyship.mjs --gate seed    # seed | narrate | grant | fallback
 *
 * Hosts the REAL netlify/functions/farmgpt.mjs in process with the keys from tools/.env, against a
 * SMALL FAKE FIRESTORE (a doc store that honours increments and the exists:false precondition).
 * Real prose, real money — a few cents of Fable + Grok + Haiku — and no contact whatsoever with
 * the family's Story Log, usage documents or grant records.
 *
 * WHY A FAKE FIRESTORE RATHER THAN A DEAD ONE (which is what the keeper probe uses): the grant is
 * a Firestore write with a precondition, and "5 more scenes, once a day" cannot be demonstrated
 * against a host that answers nothing. Faking it also lets the cap be driven to an exact number
 * instead of waiting for a reader to burn fifteen real scenes.
 *
 * The automated checks below are TRIPWIRES. The transcripts are the deliverable — read them.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const GATE = (args.indexOf("--gate") >= 0 && args[args.indexOf("--gate") + 1]) || "all";
const want = (g) => GATE === "all" || GATE === g;
const SECRET = "amenfarms";
const GOOG_PORT = 8896;

for (const line of fs.readFileSync(path.join(ROOT, "tools/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
if (!process.env.ANTHROPIC_API_KEY || !process.env.XAI_API_KEY) {
  console.error("Need ANTHROPIC_API_KEY and XAI_API_KEY in tools/.env"); process.exit(2);
}

let pass = 0, fail = 0;
const failures = [];
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; failures.push(n); console.log("  ✗ FAIL " + n); } };
const rule = (t) => console.log("\n" + "=".repeat(72) + "\n" + t + "\n" + "=".repeat(72));

// ---- the fake Firestore ----------------------------------------------------
const docs = {};
const commits = [];
let runQueryRows = [];
const srv = http.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  let raw = ""; for await (const c of req) raw += c;
  res.setHeader("content-type", "application/json");
  if (url === "/token") return res.end(JSON.stringify({ access_token: "fake", expires_in: 3600 }));
  if (url.endsWith(":runQuery")) return res.end(JSON.stringify(runQueryRows));
  if (url.endsWith(":commit")) {
    let b = null; try { b = JSON.parse(raw); commits.push(b); } catch {}
    for (const w of ((b && b.writes) || [])) {
      if (w.update && w.update.name) {
        const id = w.update.name.split("/documents/")[1];
        if (w.currentDocument && w.currentDocument.exists === false && docs[id]) {
          res.statusCode = 400; return res.end(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }));
        }
        docs[id] = { fields: w.update.fields || {} };
      }
      if (w.transform && w.transform.document) {
        const id = w.transform.document.split("/documents/")[1];
        const d = docs[id] || (docs[id] = { fields: {} });
        for (const t of (w.transform.fieldTransforms || [])) {
          const prev = parseInt((d.fields[t.fieldPath] || {}).integerValue || "0", 10) || 0;
          d.fields[t.fieldPath] = { integerValue: String(prev + (parseInt((t.increment || {}).integerValue || "0", 10) || 0)) };
        }
      }
    }
    return res.end("{}");
  }
  const id = url.split("/documents/")[1];
  if (req.method === "GET" && id && docs[id]) return res.end(JSON.stringify(docs[id]));
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => srv.listen(GOOG_PORT, "127.0.0.1", r));

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${GOOG_PORT}/v1/projects/x/databases/(default)/documents`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  client_email: "fake@test.iam.gserviceaccount.com",
  private_key: (await import("node:crypto")).generateKeyPairSync("rsa", {
    modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey,
});

const handler = (await import(new URL("../netlify/functions/farmgpt.mjs", import.meta.url))).default;
async function call(body) {
  const resp = await handler(new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, ...body }),
  }));
  const text = await resp.text();
  let json = null;
  if ((resp.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(text); } catch {} }
  return { status: resp.status, text, json };
}
const rowsFor = (n, user) => Array.from({ length: n }, () => ({ document: { fields: { user: { stringValue: user } } } }));
const usedModels = () => {
  const day = Object.keys(docs).find((k) => k.startsWith("farmgpt_usage/"));
  if (!day) return [];
  return Object.keys(docs[day].fields).filter((k) => /_req$/.test(k) && k.split("_").length === 3);
};

const SETUP = "A girl called Nell who looks after the last lighthouse on a cold grey coast, "
  + "where the fishing boats have started coming back a day late and nobody will say why.";

let LEDGER = null;

// ===========================================================================
if (want("seed") || want("narrate") || want("grant")) {
  rule("GATE 1 — FABLE BUILDS THE WORLD (mode storyseed, no flags set)");
  const t0 = Date.now();
  const seed = await call({ mode: "storyseed", setup: SETUP, heroName: "Nell" });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(seed.status === 200, `the seeder answered 200 in ${secs}s`);
  let patch = null;
  try {
    const m = seed.text.match(/\{[\s\S]*\}/);
    patch = m ? JSON.parse(m[0]) : null;
  } catch {}
  ok(!!patch, "…with parseable JSON (an unparseable seed would silently start an empty story)");
  if (patch) {
    console.log("\n--- THE WORLD FABLE BUILT ---");
    console.log("canon:");
    for (const c of (patch.canon || [])) console.log("   · " + (c.rule || c));
    console.log("characters:");
    for (const c of (patch.characters || [])) console.log(`   · ${c.name} — ${c.role || ""}\n       voice: ${c.voice || "—"}`);
    console.log("locations: " + (patch.locations || []).map((l) => l.name).join(", "));
    console.log("threads:");
    for (const t of (patch.open_threads || [])) console.log("   · " + (t.thread || t));
    console.log("secrets (hidden_from_player):");
    for (const h of ((patch.player_knowledge || {}).hidden_from_player || [])) console.log("   · " + h);
    console.log("--- end ---\n");
    ok((patch.canon || []).length >= 2, "the seed plants canon rules");
    ok((patch.characters || []).length >= 2, "…a cast");
    ok(((patch.player_knowledge || {}).hidden_from_player || []).length >= 1, "…and at least one secret to reveal later");
    ok((patch.characters || []).every((c) => c.voice && c.voice.length > 5), "…every character with a real voice recorded");
    // Assemble a ledger the narrator can be handed, in the shape the client would build.
    LEDGER = {
      meta: { title: "The Late Boats", universe: "", timeline_point: (patch.meta || {}).timeline_point || "",
              genre_and_tone: (patch.meta || {}).genre_and_tone || "", narrative_voice: "second person, past tense",
              turn: 0, schema_version: 1 },
      canon: (patch.canon || []).map((c, i) => ({ id: "C" + (i + 1), rule: c.rule || String(c), source: "seed", turn: 0 })),
      characters: (patch.characters || []).map((c, i) => Object.assign({ id: "CH" + (i + 1), origin: "seed" }, c)),
      locations: (patch.locations || []).map((l, i) => Object.assign({ id: "L" + (i + 1) }, l)),
      protagonist: { name: "Nell", inventory: [], conditions: [], abilities: [], reputation: {} },
      relationships: [], player_knowledge: { known: [], suspected: [],
        hidden_from_player: ((patch.player_knowledge || {}).hidden_from_player || []) },
      open_threads: (patch.open_threads || []).map((t, i) => ({ id: "T" + (i + 1), thread: t.thread || String(t),
        opened_turn: 0, status: "unresolved", urgency: "slow burn" })),
      flags: {}, timeline: [],
    };
  }
}

// ===========================================================================
if (want("narrate")) {
  rule("GATE 2 — GROK NARRATES (no flags set: the shipping default)");
  const before = usedModels();
  const t0 = Date.now();
  const scene = await call({ mode: "story", newChapter: true, ledger: LEDGER, messages: [
    { role: "user", content: SETUP + " My name is Nell." },
  ] });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(scene.status === 200, `the narrator answered 200 in ${secs}s`);
  console.log("\n--- SCENE ONE, AS THE READER SEES IT ---\n" + scene.text.trim() + "\n--- end ---\n");
  const models = usedModels().filter((m) => !before.includes(m));
  console.log("usage recorded under: " + (usedModels().join(", ") || "(none)"));
  ok(usedModels().some((m) => /^s_grok45_req$/.test(m)),
    "the scene was written by GROK and the usage record says so");
  ok(/===CHAPTER===/.test(scene.text), "…opening a titled chapter, as asked");
  ok((scene.text.match(/^\s*\d[.)]\s+/gm) || []).length >= 3, "…and ending on three numbered choices");
  ok(/===CHOICES===/.test(scene.text), "…behind the ===CHOICES=== marker the client parses");
  const words = (scene.text.match(/\S+/g) || []).length;
  console.log(`scene length: ${words} words`);
  ok(words > 120, "…a real scene, not a stub");
  void models;
}

// ===========================================================================
if (want("grant")) {
  rule("GATE 3 — 'FIVE MORE SCENES' AGAINST THE REAL NARRATOR");
  const READER = "Eleanor";
  for (const k of Object.keys(docs)) if (/story_finish/.test(k)) delete docs[k];

  runQueryRows = rowsFor(15, READER);
  const capped = await call({ mode: "story", user: READER, ledger: LEDGER, messages: [
    { role: "user", content: SETUP }, { role: "assistant", content: "A scene.\n\n===CHOICES===\n1. a\n2. b\n3. c" },
    { role: "user", content: "Go down to the harbour." }] });
  ok(!!capped.json && capped.json.capped === true, "at 15 scenes the reader is stopped");
  console.log("  capped message: " + JSON.stringify(capped.json.message));
  ok(capped.json.finishSpent !== true, "…with the offer still available");

  const grant = await call({ mode: "story_finish_grant", user: READER });
  ok(!!grant.json && grant.json.ok === true && grant.json.granted === 5 && grant.json.cap === 20,
    "taking the grant gives 5 more and a cap of 20");
  const twice = await call({ mode: "story_finish_grant", user: READER });
  ok(!!twice.json && twice.json.already === true, "…and a second tap is refused (once per day, server-side)");

  // Scene 17 of 20: three to go. The narrator should be steering toward a landing.
  runQueryRows = rowsFor(17, READER);
  const mid = await call({ mode: "story", user: READER, ledger: LEDGER, messages: [
    { role: "user", content: SETUP }, { role: "assistant", content: "A scene.\n\n===CHOICES===\n1. a\n2. b\n3. c" },
    { role: "user", content: "Go down to the harbour." }] });
  ok(mid.status === 200, "inside the granted tail the story continues");
  console.log("\n--- SCENE 18 OF 20 (three to go — should be tying off, not opening) ---\n"
    + mid.text.trim() + "\n--- end ---\n");
  ok(/===CHOICES===/.test(mid.text), "…still offering choices — it isn't over yet");

  // The LAST granted scene must land and close the chapter.
  runQueryRows = rowsFor(19, READER);
  const last = await call({ mode: "story", user: READER, ledger: LEDGER, messages: [
    { role: "user", content: SETUP }, { role: "assistant", content: "A scene.\n\n===CHOICES===\n1. a\n2. b\n3. c" },
    { role: "user", content: "Walk back up to the lighthouse." }] });
  console.log("\n--- THE LAST GRANTED SCENE (must land, and close the chapter) ---\n"
    + last.text.trim() + "\n--- end ---\n");
  ok(/===CHAPTER END===/.test(last.text), "THE LAST SCENE CLOSES THE CHAPTER — a clean boundary on the shelf");
  ok(!/===CHOICES===/.test(last.text), "…and offers no choices, so there is nothing dangling");

  runQueryRows = rowsFor(20, READER);
  const done = await call({ mode: "story", user: READER, messages: [{ role: "user", content: "more" }] });
  ok(!!done.json && done.json.capped === true, "at 20 the day is genuinely done — 15 + one grant, no more");
  ok(done.json.finishSpent === true, "…and the page is told the offer is spent");
  console.log("  goodnight message: " + JSON.stringify(done.json.message));
  runQueryRows = [];
}

// ===========================================================================
if (want("fallback")) {
  rule("GATE 4 — THE FALLBACKS (a site with no xAI key, and an xAI outage)");

  // (a) an OUTAGE: the key is present and correct, the service is not reachable.
  process.env.XAI_BASE_URL = "http://127.0.0.1:9";
  const before = usedModels();
  const out = await call({ mode: "story", messages: [
    { role: "user", content: SETUP + " My name is Nell." }] });
  ok(out.status === 200, "an xAI outage still produces a scene — the reader never sees an error");
  ok(/===CHOICES===/.test(out.text), "…with its choices, so the story can continue");
  ok(usedModels().some((m) => /^s_claudehaiku45_req$/.test(m)),
    "…written by Haiku, and billed to Haiku, because that is who wrote it");
  console.log("\n--- THE FALLBACK SCENE (real Haiku, after a simulated xAI outage) ---\n"
    + out.text.trim().slice(0, 700) + "\n--- end (truncated for the log) ---\n");
  delete process.env.XAI_BASE_URL;
  void before;

  // (b) NO KEY AT ALL — the state every Netlify deploy is in until XAI_API_KEY is added.
  const key = process.env.XAI_API_KEY;
  delete process.env.XAI_API_KEY;
  const nokey = await call({ mode: "story", messages: [{ role: "user", content: "A short story about a cat." }] });
  ok(nokey.status === 200 && /===CHOICES===/.test(nokey.text),
    "with NO xAI key at all the site still tells stories (on Haiku) — shipping the code is safe");
  process.env.XAI_API_KEY = key;

  // (c) a seed that fails must leave story creation alone.
  process.env.STORY_SEED_PROVIDER = "off";
  const noSeed = await call({ mode: "storyseed", setup: SETUP, heroName: "Nell" });
  ok(!!noSeed.json && noSeed.json.seeded === false,
    "a disabled seeder answers {seeded:false} — the client starts on the pack/empty ledger");
  delete process.env.STORY_SEED_PROVIDER;
}

console.log("\n" + "=".repeat(72));
console.log(`LIVE PROBE: ${pass}/${pass + fail} tripwires passed`);
if (failures.length) { console.log("\nTripwires that did not fire as expected:"); for (const f of failures) console.log("  ✗ " + f); }
console.log("Models billed during this probe: " + (usedModels().join(", ") || "(none)"));
srv.close();
process.exit(fail ? 1 : 0);
