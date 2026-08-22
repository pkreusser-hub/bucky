#!/usr/bin/env node
/**
 * Universe merge — LIVE token probe.
 *
 *   node tools/_probe-storyuniverse.mjs
 *
 * MEASURES the input tokens of one HTTYD scene, before and after the universe merge, through the
 * REAL function and Anthropic's REAL token counter — not an estimate and not a character count.
 *
 * How it gets an exact number without paying for a scene: the function is hosted in process with
 * ANTHROPIC_BASE_URL pointed at a local proxy. The proxy captures the request the function built,
 * forwards the identical system + messages to Anthropic's /v1/messages/count_tokens with the live
 * key from tools/.env, and answers the function with a canned SSE. Nothing is generated, so a run
 * costs nothing beyond the free count_tokens calls.
 *
 * BEFORE is the HEAD copy of netlify/functions/farmgpt.mjs, written to a temp file and imported
 * alongside the current one — same request, same ledger, same pack, two functions.
 *
 * FIRESTORE IS POINTED AT A DEAD HOST, so the probe can never read or write the family's real
 * Story Log, usage documents or canon docs. It sends no `user`, so nothing is counted or logged.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SECRET = "amenfarms";
const PORT = 8791;

for (const line of fs.readFileSync(path.join(ROOT, "tools/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("No ANTHROPIC_API_KEY in tools/.env"); process.exit(2); }

process.env.BUCKY_NOTIFY_SECRET = SECRET;
// Firestore is a LOCAL FAKE, never the real project: the probe must not be able to read or write
// the family's Story Log, usage documents or canon docs even by accident.
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${PORT}/v1/projects/x/databases/(default)/documents`;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${PORT}/token`;
{
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "fake@test.iam.gserviceaccount.com", private_key: privateKey });
}
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
// The packs are served off disk by the little static server below.
process.env.FARMGPT_PACK_BASE = `http://127.0.0.1:${PORT}`;
process.env.STORY_PROVIDER = "haiku";   // keep the narrator on Anthropic so the proxy sees it

const SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
].join("");

let counted = null;
async function countTokens(body) {
  const r = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5", system: body.system, messages: body.messages }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("count_tokens: " + JSON.stringify(j));
  return j.input_tokens;
}

// A realistic family canon, the size the readers' own creations actually reach. The BEFORE
// function injected this into EVERY scene's system prompt; the AFTER function seeds it into the
// ledger once at creation. Measuring the before number against an EMPTY canon would flatter it —
// a fixture kinder than reality hides the very cost this merge removed.
const FAMILY_CANON = [
  "- Bree Haddock: an original rider, twelve, dark red hair in two braids, freckles, a green scaled flight-vest Gobber made her, carries a carved bone whistle and a short axe.",
  "- Nightsong: Bree's Light Fury, silver rather than white, one notched ear, cannot go invisible for as long as other Light Furies can. Bonded to Bree since the storm at Vanaheim.",
  "- Bree is Hiccup and Astrid's foster daughter; Astrid taught her the axe and Hiccup taught her to map.",
  "- The Whistling Caves: a cave system Bree found on the north face of Berk where the wind plays the rock like a flute; dragons gather there to listen.",
  "- Ember: Isaac's Monstrous Nightmare, orange with a black stripe, terrified of water, will only take off from a standing start.",
  "- The Riders now keep a fourth hut at Dragon's Edge, built for Bree, with her maps pinned across the whole back wall.",
  "- Nightsong and Toothless hunt together; Toothless treats her as his own and Hiccup finds this funny.",
  "- Bree cannot swim, which she has told exactly two people.",
].join("\n");
const sv = (s) => ({ stringValue: s });
const srv = http.createServer(async (req, res) => {
  const u = req.url.split("?")[0];
  if (u.includes("/farmgpt_canon/")) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ fields: { canon: sv(FAMILY_CANON), updatedAt: sv("2026-08-20T00:00:00.000Z") } }));
  }
  if (u.endsWith("/token")) { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ access_token: "x", expires_in: 3600 })); }
  if (u.endsWith(":commit") || u.endsWith(":runQuery")) { res.setHeader("content-type", "application/json"); return res.end("{}"); }
  if (u.startsWith("/assets/")) {
    const f = path.join(ROOT, u);
    if (fs.existsSync(f)) { res.setHeader("content-type", "application/json"); return res.end(fs.readFileSync(f)); }
    res.statusCode = 404; return res.end("{}");
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
  if (body.stream) {
    try { counted = await countTokens(body); } catch (e) { counted = "ERR " + e.message; }
    res.setHeader("content-type", "text/event-stream");
    return res.end(SSE);
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ content: [{ type: "text", text: "NO_CHANGES" }], usage: { input_tokens: 0, output_tokens: 0 } }));
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

// ---- the story under measurement -----------------------------------------
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, "assets/storytime/universes/httyd.json"), "utf8"));
function ledgerFromPack(p) {
  return {
    meta: { title: "Bree and the Night Fury", universe: "httyd", timeline_point: p.meta.timeline_point,
            genre_and_tone: p.meta.genre_and_tone, narrative_voice: p.meta.narrative_voice, turn: 6, schema_version: 1 },
    canon: p.canon.map((c) => ({ ...c })),
    characters: p.characters.slice(0, 6).map((c) => ({ ...c })),
    roster: p.characters.slice(6).map((c) => ({ id: c.id, name: c.name, role: c.role })),
    locations: p.locations.map((l) => ({ ...l })),
    protagonist: { name: "Bree", inventory: [{ item: "a carved bone whistle" }], conditions: [], abilities: ["can whistle a Night Fury down"], reputation: {} },
    relationships: p.relationships.map((r) => ({ ...r })),
    player_knowledge: { known: ["the hunters are watching the Edge"], suspected: [], hidden_from_player: ["Krogan is already on the island"] },
    open_threads: [{ id: "T1", thread: "who lit the signal fire", status: "unresolved", urgency: "soon" }],
    flags: {}, timeline: [{ turn: 1, event: "arrived at Berk" }],
  };
}
const messages = [
  { role: "user", content: "A story about a new Dragon Rider on Berk, with Hiccup and Toothless and Astrid. My name is Bree." },
  { role: "assistant", content: "The wind came off the sea cold.\n\n===CHOICES===\n1. Follow Hiccup.\n2. Wait.\n3. Whistle." },
  { role: "user", content: "Follow Hiccup to the cove." },
];

// `family` seeds the family canon INTO the ledger, which is where it lives after the merge. The
// before/after pair must both carry it, or the comparison would be measuring the canon being
// deleted rather than moved.
async function measure(handler, opts) {
  const o = opts || {};
  let led = null;
  if (o.withLedger) {
    led = ledgerFromPack(pack);
    if (o.family) {
      let n = led.canon.length;
      for (const line of FAMILY_CANON.split("\n")) led.canon.push({ id: "C" + (++n), rule: line.replace(/^- /, ""), source: "family", turn: 0 });
    }
  }
  counted = null;
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, mode: "story", messages, ...(led ? { ledger: led } : {}) }),
  });
  const resp = await handler(req);
  await resp.text();
  return counted;
}

// AFTER — the merged function, as it stands in this worktree.
const after = (await import("file:///" + path.join(ROOT, "netlify/functions/farmgpt.mjs").replace(/\\/g, "/"))).default;

// BEFORE — HEAD's copy, written out and imported alongside. Its UNIVERSE_BIBLES are baked in, so
// it needs no pack server; its family canon comes from the dead Firestore host and is empty,
// which UNDERSTATES the before number (live it is up to ~1.6K tokens more).
const tmp = path.join(os.tmpdir(), "farmgpt-head-" + Date.now() + ".mjs");
fs.writeFileSync(tmp, execFileSync("git", ["show", "HEAD:netlify/functions/farmgpt.mjs"], { cwd: ROOT, maxBuffer: 1 << 26 }));
const before = (await import("file:///" + tmp.replace(/\\/g, "/"))).default;

const rows = [];
// The like-for-like: the same story, carrying the same family canon. BEFORE the server injected
// it into every scene's prompt on top of the bible; AFTER it rides in the ledger the scene was
// already sending.
rows.push(["HTTYD ledger scene",
  await measure(before, { withLedger: true }), await measure(after, { withLedger: true, family: true })]);
rows.push(["HTTYD legacy scene (no ledger)",
  await measure(before, {}), await measure(after, {})]);

console.log("\n  input tokens per scene, counted by Anthropic\n");
console.log("  " + "scene".padEnd(34) + "before".padStart(9) + "after".padStart(9) + "change".padStart(11));
for (const [name, b, a] of rows) {
  const d = (typeof a === "number" && typeof b === "number") ? (a - b) : "";
  console.log("  " + name.padEnd(34) + String(b).padStart(9) + String(a).padStart(9) +
    (d === "" ? "" : (d > 0 ? "+" + d : String(d)).padStart(11)));
}
const [, b0, a0] = rows[0];
if (typeof a0 === "number" && typeof b0 === "number") {
  // The pace the family actually reads at, from the usage dashboard.
  const SCENES_PER_DAY = 32, DAYS = 30.4;
  // Haiku 4.5 input, $1/MTok — the narrator's tier for a ledger scene.
  const perMonth = (t) => (t * SCENES_PER_DAY * DAYS / 1e6) * 1.0;
  console.log(`\n  at ~${SCENES_PER_DAY} scenes/day, input alone: $${perMonth(b0).toFixed(2)}/mo → $${perMonth(a0).toFixed(2)}/mo` +
    `  (saves $${(perMonth(b0) - perMonth(a0)).toFixed(2)}/mo)`);
}
srv.close();
try { fs.unlinkSync(tmp); } catch {}
