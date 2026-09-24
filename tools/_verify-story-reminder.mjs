// Story-mode content-rules reminder suite — in-process farmgpt.mjs vs fake Anthropic/Google/
// Firestore. Verifies STORY_RULES_REMINDER rides the LAST user turn of every story request
// (after any chapter directive) and never leaks into other modes. Nothing touches real services.
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });
const DOCBASE = "projects/amen-farms-app/databases/(default)/documents";
const anthropicReqs = [];

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => r(b)); });

const tokenSrv = http.createServer((q, s) => { s.writeHead(200, {"content-type":"application/json"}); s.end(JSON.stringify({ access_token: "t", expires_in: 3600 })); });
const commits = [];   // every :commit body, so the usage counters can be read back (2026-09-24)
const fsSrv = http.createServer(async (q, s) => {
  const raw = await readBody(q); const url = q.url.split("?")[0];
  const send = (c, o) => { s.writeHead(c, {"content-type":"application/json"}); s.end(JSON.stringify(o)); };
  if (url.endsWith(":commit")) { try { commits.push(JSON.parse(raw)); } catch {} return send(200, {}); }
  if (url.endsWith(":runQuery")) return send(200, [{}]);
  if (q.method === "GET") return send(404, { error: { code: 404 } });
  send(200, {});
});
const antSrv = http.createServer(async (q, s) => {
  const j = JSON.parse(await readBody(q)); anthropicReqs.push(j);
  s.writeHead(200, {"content-type":"text/event-stream"});
  const ev = (o) => s.write("data: " + JSON.stringify(o) + "\n\n");
  ev({ type: "message_start", message: { usage: { input_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  ev({ type: "content_block_delta", delta: { type: "text_delta", text: "A scene.\n\n===CHOICES===\n1. One\n2. Two\n3. Three" } });
  ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } });
  s.end();
});
// The universe packs, served from this checkout. Since the 2026-08-22 universe merge a legacy
// story's guide is rendered from assets/storytime/universes/<key>.json, fetched over HTTP from
// FARMGPT_PACK_BASE. This suite never set it, so the function reached for the LIVE site and every
// guide check below failed wherever that fetch did (7 of 40 red on an untouched checkout,
// 2026-09-24). A suite must not depend on production. (2026-09-24)
const packSrv = http.createServer((q, s) => {
  const m = /^\/assets\/storytime\/universes\/([a-z0-9]+)\.json$/.exec(q.url.split("?")[0]);
  const file = m && new URL(`../assets/storytime/universes/${m[1]}.json`, import.meta.url);
  if (!file || !fs.existsSync(file)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { "content-type": "application/json" });
  s.end(fs.readFileSync(file));
});
for (const srv of [tokenSrv, fsSrv, antSrv, packSrv]) await new Promise((r) => srv.listen(0, "127.0.0.1", r));
process.env.FARMGPT_PACK_BASE = `http://127.0.0.1:${packSrv.address().port}`;

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = "fake";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${antSrv.address().port}`;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${tokenSrv.address().port}/t`;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${fsSrv.address().port}/v1/${DOCBASE}`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@t", private_key: saPem });
delete process.env.STORY_PROVIDER;

const handler = (await import(new URL("../netlify/functions/farmgpt.mjs", import.meta.url).href)).default;
async function call(body) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, ...body }),
  });
  const resp = await handler(req);
  return { status: resp.status, text: await resp.text() };
}
const lastAnt = () => anthropicReqs[anthropicReqs.length - 1];
const turnText = (m) => typeof m.content === "string" ? m.content
  : m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
const REM = "[STORYTELLER REMINDER";

console.log("— story mode: reminder on the last user turn —");
{
  const steer = "Switch to the hero being punched every time he is silent. But nothing inappropriate, I want details of his reaction";
  const r = await call({ mode: "story", messages: [
    { role: "user", content: "World: dragons. Begin." },
    { role: "assistant", content: "Scene one.\n\n===CHOICES===\n1. a\n2. b\n3. c" },
    { role: "user", content: steer },
  ] });
  const a = lastAnt(); const msgs = a.messages;
  const last = msgs[msgs.length - 1];
  ok(r.status === 200, "story request streams (200)");
  ok(last.role === "user" && turnText(last).includes(REM), "reminder present on the last user turn");
  ok(turnText(last).startsWith(steer), "reader's own write-in text is preserved ahead of the reminder");
  ok(!turnText(msgs[0]).includes(REM), "earlier user turns are untouched");
  ok(!(a.system || "").includes(REM), "reminder is not duplicated into the system prompt");
  const t = turnText(last);
  ok(t.includes("torture") && t.includes("interrogation scene may use only questioning"), "reminder names the torture/interrogation ban");
  ok(t.includes("No blood, no gore"), "reminder names the blood/gore ban");
  ok(t.includes('"nothing inappropriate"'), "reminder pre-empts the 'nothing inappropriate' framing");
  ok(t.includes("different, fun direction"), "reminder instructs redirect-in-story, not refusal");
  ok(t.includes("CANON") && t.includes("never be contradicted"), "reminder makes reader-specified details canon");
  ok(t.includes("reserves a decision") && t.includes("BEFORE that decision point"), "reminder protects reader-reserved decisions");
  ok(t.includes("REDO") && t.includes("already been discarded"), "reminder explains redo semantics (old scene discarded)");
  ok(t.includes("CO-AUTHOR") && t.includes("LAW"), "reminder makes the reader's decisions law (collaboration)");
  ok(t.includes("crossovers") && t.includes("welcome"), "reminder welcomes franchise crossovers");
}

console.log("— universe bibles: auto-detected franchise fact sheets —");
{
  const sysOf = () => { const a = lastAnt(); return typeof a.system === "string" ? a.system : JSON.stringify(a.system || ""); };
  await call({ mode: "story", messages: [{ role: "user", content: "I am a girl named Bree in how to train your dragon race to the edge, with a light fury named Breeze." }] });
  let sys = sysOf();
  ok(sys.includes("UNIVERSE GUIDE"), "HTTYD setup attaches a universe guide");
  // RESTAGED (2026-09-24): the hard-coded bible's "DRAGONS NEVER TALK" became canon C1 of the HTTYD
  // pack in the 2026-08-22 universe merge, and the guide is rendered from the pack now.
  ok(sys.includes("No dragon ever speaks words"), "…with the no-talking-dragons rule");
  ok(sys.includes("Viggo Grimborn") && sys.includes("prosthetic"), "…with RTTE villains + Hiccup/Toothless prosthetic facts");
  ok(sys.includes("reader's version wins"), "guide yields to the reader's explicit changes");

  await call({ mode: "story", messages: [{ role: "user", content: "A story about a lonely lighthouse keeper and a mysterious storm." }] });
  ok(!sysOf().includes("UNIVERSE GUIDE"), "no franchise mentioned → no guide");
  await call({ mode: "story", messages: [{ role: "user", content: "We spent the day picking a ripe peach from the orchard tree." }] });
  ok(!sysOf().includes("UNIVERSE GUIDE"), "the word 'peach' alone never triggers Mario (needs 'princess peach')");

  await call({ mode: "story", messages: [{ role: "user", content: "Bowser stomped into the Mushroom Kingdom at dawn." }] });
  sys = sysOf();
  // RESTAGED (2026-09-24): the Mario pack's rule reads "a defeated enemy simply poofs away" — the
  // bible said "poof away". Same rule, the pack's words.
  ok(sys.includes("Super Mario") && sys.includes("poofs away"), "Mario guide attaches (cartoonish-enemies rule included)");

  await call({ mode: "story", messages: [
    { role: "user", content: "Hiccup opens a warp pipe and meets Mario." },
    { role: "assistant", content: "Scene.\n\n===CHOICES===\n1. a\n2. b\n3. c" },
    { role: "user", content: "keep going" },
  ] });
  sys = sysOf();
  // RESTAGED (2026-09-24): the HTTYD pack's own title is "How To Train Your Dragon" (capital T).
  ok(sys.includes("UNIVERSE GUIDES") && sys.includes("Super Mario") && sys.includes("How To Train Your Dragon"), "crossover attaches BOTH guides");

  await call({ mode: "story", messages: [
    { role: "user", content: "An adventure. (STORY SO FAR: Toothless purred beside the campfire.)" },
  ] });
  // RESTAGED (2026-09-24): same pack wording as above.
  ok(sysOf().includes("No dragon ever speaks words"), "a character name in the recap alone keeps the guide attached (sticky after windowing)");

  await call({ mode: "research", messages: [{ role: "user", content: "How does a lightsaber work in Star Wars physics terms?" }] });
  ok(!sysOf().includes("UNIVERSE GUIDE"), "research mode never gets story universe guides");
}

console.log("— summary mode: story-bible format —");
{
  await call({ mode: "summary", messages: [{ role: "user", content: "EARLIER NOTES:\n(none)\n\nNEWEST PART:\nA scene.\n\nRewrite the continuity notes now." }] });
  const a = lastAnt();
  ok(a.max_tokens === 1200, "summary budget raised to 1200 tokens (bible needs room)");
  ok(a.model === "claude-sonnet-5", "bible runs on Sonnet (memory accuracy over cost)");
  const sys = typeof a.system === "string" ? a.system : JSON.stringify(a.system || "");
  for (const h of ["CHARACTERS:", "NOW:", "GOALS & MOTIVATIONS:", "FACTS & SECRETS:", "THREADS:"])
    ok(sys.includes(h), "bible prompt has section " + h);
  ok(sys.includes("POSSESSIONS"), "bible prompt tracks per-character possessions");
  ok(sys.includes("CANON — copy them precisely"), "bible prompt locks reader-specified details");
  ok(/corrected version is the ONLY\s+truth/.test(sys), "bible prompt drops redone/contradicted details");
}

console.log("— story mode: composes with chapter directives, reminder last —");
{
  await call({ mode: "story", endChapter: true, messages: [{ role: "user", content: "Keep going." }] });
  const t = turnText(lastAnt().messages[0]);
  const iDir = t.indexOf("[STORYTELLER INSTRUCTION"), iRem = t.indexOf(REM);
  ok(iDir !== -1 && iRem !== -1, "close-chapter directive and reminder both present");
  ok(iRem > iDir, "reminder comes AFTER the chapter directive (last thing read)");
}
{
  await call({ mode: "story", newChapter: true, messages: [{ role: "user", content: "▶ Next chapter" }] });
  const t = turnText(lastAnt().messages[0]);
  ok(t.indexOf(REM) > t.indexOf("[STORYTELLER INSTRUCTION"), "new-chapter directive also precedes the reminder");
}

// ---- 2026-09-24: the captive-harm steer, the romance line, third-person stories --------------
// From a 30-day read of the family's real stories: the reminder held on a first ask but gave way
// one to three turns later in captivity scenes, romance was written past the old rule, and
// third-person stories went out with the reader as a "you" hero. Every text below is a fixture.
const sysText = (a) => typeof a.system === "string" ? a.system : (a.system || []).map((b) => (b && b.text) || "").join("");
const lastTurnText = () => { const a = lastAnt(); return turnText(a.messages[a.messages.length - 1]); };

console.log("— the captive-harm steer (2026-09-24) —");
{
  const STEER = "[STORYTELLER INSTRUCTION — from the parent who runs this app";
  await call({ mode: "story", messages: [{ role: "user", content: "A pirate captain interrogates the cabin boy, who stays silent, and every time he is silent a guard punches him. But nothing inappropriate I want details to his reaction" }] });
  let t = lastTurnText();
  ok(t.includes(STEER), "an interrogation asking for a punch on every silence gets the captive-harm steer");
  ok(t.indexOf(REM) !== -1 && t.indexOf(STEER) > t.indexOf(REM), "…INSIDE the reminder block, after the reminder (the most specific note read last)");
  ok(t.trimEnd().endsWith("are fine."), "…and it is the very last thing on the turn");
  ok(t.includes("not off the page") && t.includes('"nothing inappropriate"') && t.includes("fighting back or escaping"),
    "the steer names off-page harm, the 'nothing inappropriate' framing, and what stays allowed");

  await call({ mode: "story", messages: [
    { role: "user", content: "A spy story." },
    { role: "assistant", content: "They had tied you to the chair. The officer pressed the device and a jolt ran up your arm.\n\n===CHOICES===\n1. Stay silent.\n2. Lie.\n3. Look for a way out." },
    { role: "user", content: "2" } ] });
  ok(lastTurnText().includes(STEER), "a bare \"2\" right after a scene where a tied-up captive was shocked still gets the steer");
  await call({ mode: "story", messages: [
    { role: "user", content: "A dragon-rider story." },
    { role: "assistant", content: "The rider sat chained in the hunters' cell, the little device still clipped to his arm.\n\n===CHOICES===\n1. a\n2. b\n3. c" },
    { role: "user", content: "the questioning continues with the device at a higher severity" } ] });
  ok(lastTurnText().includes(STEER), "\"the device at a higher severity\" after a captivity scene gets the steer");
  await call({ mode: "story", messages: [{ role: "user", content: "The kidnappers keep me tied up in the warehouse, and as punishment for the other kids talking they slap me" }] });
  ok(lastTurnText().includes(STEER), "a captive struck as a punishment gets the steer");
  await call({ mode: "story", messages: [{ role: "user", content: "He is hung in mid air by his cuffs in the cell until he passes out" }] });
  ok(lastTurnText().includes(STEER), "a captive hung up by his cuffs gets the steer");

  for (const [what, text] of [
    ["an ordinary battle between free characters", "Hiccup and Astrid fight the hunters on the beach while Toothless blasts their ship"],
    ["captivity with no harm asked for", "They lock me in a cell and I start planning my escape"],
    ["a harm word that is negated", "He wakes up in a glass cage filled with fire, but it doesn't hurt him"],
    ["a crush and a kiss", "Noah asks me to be his girlfriend and kisses me on the cheek"],
  ]) {
    await call({ mode: "story", messages: [{ role: "user", content: text }] });
    const tt = lastTurnText();
    ok(tt.includes(REM) && !tt.includes(STEER), "no steer on " + what + " (the reminder still rides)");
  }
  await call({ mode: "research", messages: [{ role: "user", content: "In the book, why does the guard punch the prisoner in the cell?" }] });
  ok(!JSON.stringify(lastAnt().messages).includes(STEER), "research mode never gets the steer");

  commits.length = 0;
  await call({ mode: "story", messages: [{ role: "user", content: "The captors punch the prisoner in the cell every time he stays silent" }] });
  const steerWrites = commits.flatMap((c) => c.writes || []).flatMap((w) => (w.transform && w.transform.fieldTransforms) || [])
    .filter((f) => f.fieldPath === "s_steer");
  ok(steerWrites.length === 2 && steerWrites.every((f) => f.increment && f.increment.integerValue === "1"),
    "a steered scene is counted as s_steer, once in the daily doc and once in the hourly doc");
  commits.length = 0;
  await call({ mode: "story", messages: [{ role: "user", content: "A calm walk along the sea wall." }] });
  ok(!JSON.stringify(commits).includes("s_steer"), "…and an ordinary scene is not counted");
}

console.log("— romance: crushes and kissing, nothing more (Dad, 2026-09-24) —");
{
  await call({ mode: "story", messages: [{ role: "user", content: "A school story." }] });
  const a = lastAnt(), sys = sysText(a);
  ok(sys.includes("Romance in a story is limited to crushes and kissing") && sys.includes("Nothing more than a kiss"),
    "FAMILY_RULES states the new line: in a story, crushes and kissing, nothing more");
  ok(!sys.includes("No sexual or romantic content of any kind"), "…and the old blanket ban is gone");
  ok(lastTurnText().includes("Romance stops at a crush and a kiss"), "the every-turn reminder carries the romance ceiling");
  ok(sys.includes("Use the long dash (—) sparingly: at most two in a scene"), "style: the long dash is rationed");
  ok(sys.includes("settle what happened to anyone the story left in danger"), "style: nobody is left hanging before the next twist");
  // The decision was about stories. Research mode shares FAMILY_RULES and must keep its old answer.
  await call({ mode: "research", messages: [{ role: "user", content: "What is photosynthesis?" }] });
  ok(sysText(lastAnt()).includes("Outside a story, no romantic or sexual content at all"),
    "research mode keeps the old line: outside a story, no romantic or sexual content at all");
}

console.log("— third-person stories (2026-09-24) —");
{
  const POVL = "[POINT OF VIEW";
  const LED = () => ({ meta: { title: "T", universe: "original", narrative_voice: "second person, past tense", turn: 1, schema_version: 1 },
    canon: [], characters: [{ id: "CH1", name: "", origin: "reader" }, { id: "CH2", name: "Hiccup", origin: "pack", role: "a rider" }],
    locations: [], protagonist: { name: "", inventory: [], conditions: [], abilities: [], reputation: {} }, relationships: [],
    player_knowledge: { known: [], suspected: [], hidden_from_player: [] }, open_threads: [], flags: {}, timeline: [] });
  const turns = () => [{ role: "user", content: "A story on the Edge." },
    { role: "assistant", content: "Hiccup waited.\n\n===CHOICES===\n1. a\n2. b\n3. c" }, { role: "user", content: "2" }];
  await call({ mode: "story", messages: turns(), ledger: LED(), pov: "third" });
  let all = JSON.stringify(lastAnt().messages), t = lastTurnText();
  ok(t.includes(POVL) && t.indexOf(POVL) > t.indexOf(REM), "pov:\"third\" puts the POINT OF VIEW line in the reminder block, after the reminder");
  ok(all.includes("THE MAIN CHARACTER (third person") && !all.includes('write to them as \\"you\\"'),
    "…the ledger names a main character instead of a \"you\" hero");
  ok(all.includes("Narrative voice: third person") && !all.includes("second person, past tense"),
    "…its recorded voice reads third person, whatever the older ledger said");
  ok(!all.includes("the reader's own character; take the name"), "…and the empty reader placeholder sheet is dropped");

  await call({ mode: "story", messages: turns(), ledger: LED(), pov: "second" });
  all = JSON.stringify(lastAnt().messages); t = lastTurnText();
  ok(!t.includes(POVL) && all.includes('write to them as \\"you\\"') && all.includes("second person, past tense"),
    "a reader-hero story is exactly as before: no POV line, the \"you\" hero, second person");

  await call({ mode: "story", messages: [{ role: "user", content: "New story in 3rd person, im not in it, on a harbour" }] });
  ok(lastTurnText().includes(POVL), "with no pov field, a story is recognised from the setup's own words (older pages, older saves)");
  const led3 = LED(); led3.meta.narrative_voice = "third person, past tense";
  await call({ mode: "story", messages: [{ role: "user", content: "A harbour story." }], ledger: led3 });
  ok(lastTurnText().includes(POVL), "…or from the ledger's recorded voice");
  await call({ mode: "story", messages: [{ role: "user", content: "A harbour story where I am the hero." }] });
  ok(!lastTurnText().includes(POVL), "an ordinary story gets no POV line");

  const sys = sysText(lastAnt());
  ok(/the READER asks to follow other characters/.test(sys) && /second person unless it is told in the third/.test(sys),
    "the chapter clause allows a third-person story and the reader's own cutaways");
  await call({ mode: "story", messages: turns(), newChapter: true });
  ok(lastTurnText().includes("Continue with the SAME protagonist, told in the same person as the story so far"),
    "the new-chapter directive no longer forces second person");
}

console.log("— other modes: no reminder —");
{
  await call({ mode: "research", messages: [{ role: "user", content: "Explain photosynthesis." }] });
  ok(!JSON.stringify(lastAnt().messages).includes(REM), "research turns carry no reminder");
  await call({ mode: "summary", messages: [{ role: "user", content: "Summarize: a story." }] });
  ok(!JSON.stringify(lastAnt().messages).includes(REM), "summary turns carry no reminder");
  await call({ mode: "kidstory", messages: [{ role: "user", content: "A goat story." }] });
  ok(!JSON.stringify(lastAnt().messages).includes(REM), "kidstory turns carry no reminder");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const srv of [tokenSrv, fsSrv, antSrv, packSrv]) srv.close();
process.exit(fail ? 1 : 0);
