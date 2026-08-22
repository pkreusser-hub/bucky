#!/usr/bin/env node
/**
 * The seeder's INPUT, before and after the roster diet — counted, not estimated.
 *
 *   node tools/_probe-seeddiet.mjs --base-only    # first: caches the real pack ledger
 *   node tools/_seeddiet_count.mjs [<pre-diet git rev>]
 *
 * Loads the working-tree farmgpt.mjs and the pre-diet copy side by side, sends each the
 * same real HTTYD pack ledger the browser would send, captures the exact user turn each one
 * builds (the upstream call is stubbed, so this costs nothing), and counts both with Anthropic's
 * own /v1/messages/count_tokens. Also prints the roster/full-sheet tell so the shape can be seen.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
for (const line of fs.readFileSync(path.join(ROOT, "tools/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
const KEY = process.env.ANTHROPIC_API_KEY;
process.env.BUCKY_NOTIFY_SECRET = "amenfarms";
{
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "f@t.iam.gserviceaccount.com", private_key: privateKey });
}

const base = JSON.parse(fs.readFileSync(path.join(HERE, "_seeddiet_base.json"), "utf8"));

// The pre-diet function, checked out beside the current one.
// The pre-diet revision, named so this stays reproducible after the diet is committed.
const OLD_REV = process.argv[2] || "d6530e6";
const OLD = path.join(HERE, "_seeddiet_old.mjs");
fs.writeFileSync(OLD, execFileSync("git", ["show", OLD_REV + ":netlify/functions/farmgpt.mjs"],
  { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));

const realFetch = globalThis.fetch;
let captured = null;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if (/api\.anthropic\.com\/v1\/messages$/.test(url) && init && typeof init.body === "string") {
    captured = JSON.parse(init.body);
    return new Response("event: x\ndata: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
  }
  if (/googleapis|firestore|oauth2/.test(url)) return new Response("{}", { status: 404 });
  return realFetch(input, init);
};

async function sentTurn(modPath, caseKey) {
  const handler = (await import("file:///" + modPath.replace(/\\/g, "/") + "?t=" + Date.now())).default;
  const b = base[caseKey];
  captured = null;
  const setup = caseKey === "httyd"
    ? "A How to Train Your Dragon story set after the third movie, when the dragons have gone to the Hidden World and Hiccup is Chief of New Berk. I want to find a dragon nobody thought was still around. My name is Wren."
    : "A story about a girl who finds a door in the back of her grandmother's barn that only opens when it rains. My name is Wren.";
  const resp = await handler(new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: "amenfarms", mode: "storyseed", setup, heroName: "Wren",
      packLedger: b.hasPack ? b.ledger : null, era: b.era, eras: b.eras }),
  }), {});
  if (resp.body) { const rd = resp.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) break; } }
  if (!captured) throw new Error("no upstream call captured for " + caseKey);
  return { system: captured.system, turn: String(captured.messages[0].content) };
}

async function count(system, turn) {
  const r = await realFetch("https://api.anthropic.com/v1/messages/count_tokens", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-fable-5", system, messages: [{ role: "user", content: turn }] }),
  });
  const j = await r.json();
  if (j.input_tokens == null) throw new Error(JSON.stringify(j));
  return j.input_tokens;
}

const out = [];
for (const caseKey of ["httyd", "original"]) {
  const oldT = await sentTurn(OLD, caseKey);
  const newT = await sentTurn(path.join(ROOT, "netlify/functions/farmgpt.mjs"), caseKey);
  const oldN = await count(oldT.system, oldT.turn);
  const newN = await count(newT.system, newT.turn);
  fs.writeFileSync(path.join(HERE, `_seeddiet_turn_${caseKey}_old.txt`), oldT.turn);
  fs.writeFileSync(path.join(HERE, `_seeddiet_turn_${caseKey}_new.txt`), newT.turn);
  out.push({ caseKey, oldChars: oldT.turn.length, newChars: newT.turn.length, oldN, newN,
    oldKnows: (oldT.turn.match(/knows:/g) || []).length, newKnows: (newT.turn.match(/knows:/g) || []).length });
}
console.table(out);
fs.unlinkSync(OLD);
