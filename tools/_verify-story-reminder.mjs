// Story-mode content-rules reminder suite — in-process farmgpt.mjs vs fake Anthropic/Google/
// Firestore. Verifies STORY_RULES_REMINDER rides the LAST user turn of every story request
// (after any chapter directive) and never leaks into other modes. Nothing touches real services.
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });
const DOCBASE = "projects/amen-farms-app/databases/(default)/documents";
const anthropicReqs = [];

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => r(b)); });

const tokenSrv = http.createServer((q, s) => { s.writeHead(200, {"content-type":"application/json"}); s.end(JSON.stringify({ access_token: "t", expires_in: 3600 })); });
const fsSrv = http.createServer(async (q, s) => {
  await readBody(q); const url = q.url.split("?")[0];
  const send = (c, o) => { s.writeHead(c, {"content-type":"application/json"}); s.end(JSON.stringify(o)); };
  if (url.endsWith(":commit")) return send(200, {});
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
for (const srv of [tokenSrv, fsSrv, antSrv]) await new Promise((r) => srv.listen(0, "127.0.0.1", r));

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
for (const srv of [tokenSrv, fsSrv, antSrv]) srv.close();
process.exit(fail ? 1 : 0);
