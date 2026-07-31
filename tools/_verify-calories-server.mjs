// 🍽 Calorie-estimator server suite — in-process farmgpt.mjs vs fake Anthropic/Google/Firestore.
// Nothing here touches real services. The fake Anthropic answers SSE for streaming requests
// (body.stream) and plain JSON otherwise, so mode "calories" (callAnthropicOnce) and the
// streaming modes can share one server.
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });
const DOCBASE = "projects/amen-farms-app/databases/(default)/documents";
const anthropicReqs = [];
const commits = [];
let calorieReply = null;   // next non-streaming reply text

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => r(b)); });

const tokenSrv = http.createServer((q, s) => { s.writeHead(200, {"content-type":"application/json"}); s.end(JSON.stringify({ access_token: "t", expires_in: 3600 })); });
const fsSrv = http.createServer(async (q, s) => {
  const body = await readBody(q); const url = q.url.split("?")[0];
  const send = (c, o) => { s.writeHead(c, {"content-type":"application/json"}); s.end(JSON.stringify(o)); };
  if (url.endsWith(":commit")) { commits.push(JSON.parse(body)); return send(200, {}); }
  if (url.endsWith(":runQuery")) return send(200, [{}]);
  if (q.method === "GET") return send(404, { error: { code: 404 } });
  send(200, {});
});
const antSrv = http.createServer(async (q, s) => {
  const j = JSON.parse(await readBody(q)); anthropicReqs.push(j);
  if (!j.stream) {   // callAnthropicOnce path (calories)
    s.writeHead(200, {"content-type":"application/json"});
    return s.end(JSON.stringify({ content: [{ type: "text", text: calorieReply }],
      usage: { input_tokens: 120, output_tokens: 45, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
  }
  s.writeHead(200, {"content-type":"text/event-stream"});
  const ev = (o) => s.write("data: " + JSON.stringify(o) + "\n\n");
  ev({ type: "message_start", message: { usage: { input_tokens: 60 } } });
  ev({ type: "content_block_delta", delta: { type: "text_delta", text: "A reply.\n\n===CHOICES===\n1. a\n2. b\n3. c" } });
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
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: resp.status, text, json };
}
const lastAnt = () => anthropicReqs[anthropicReqs.length - 1];

console.log("— happy path —");
{
  calorieReply = JSON.stringify({ name: "Chipotle Steak Bowl", total: 1050, protein: 52, carbs: 118, fat: 38,
    items: [{ n: "steak", c: 250, p: 26, cb: 0, f: 16 }, { n: "black beans", c: 130, p: 8, cb: 23, f: 1 }, { n: "white rice", c: 210, p: 4, cb: 45, f: 0 }, { n: "fajita veggies", c: 20, p: 1, cb: 4, f: 0 }, { n: "salsa", c: 25, p: 1, cb: 5, f: 0 }, { n: "corn", c: 80, p: 3, cb: 16, f: 1 }, { n: "bowl extras", c: 335, p: 9, cb: 25, f: 20 }] });
  const r = await call({ mode: "calories", text: "chipotle steak bowl, black beans, white rice, fajita veggies, salsa and corn" });
  const a = lastAnt();
  ok(r.status === 200 && r.json && r.json.ok === true, "returns 200 ok:true");
  ok(r.json.name === "Chipotle Steak Bowl" && r.json.total === 1050, "name + total pass through");
  ok(r.json.protein === 52 && r.json.carbs === 118 && r.json.fat === 38, "meal macros pass through");
  ok(Array.isArray(r.json.items) && r.json.items.length === 7 && r.json.items[0].n === "steak", "per-item breakdown passes through");
  ok(r.json.items[0].p === 26 && r.json.items[2].cb === 45, "per-item macros pass through");
  ok(a.model === "claude-sonnet-5", "runs on Sonnet 5");
  ok(!a.stream, "non-streaming call");
  ok(String(a.system).includes("STRICT JSON"), "calorie system prompt on the wire");
  ok(a.messages.length === 1 && a.messages[0].content.includes("chipotle steak bowl"), "meal text is the single user turn");
}

console.log("— usage logged under c_* —");
{
  const c = commits[commits.length - 1];
  const fields = (c.writes || []).flatMap(w => (w.transform && w.transform.fieldTransforms || []).map(f => f.fieldPath));
  ok(fields.includes("c_in") && fields.includes("c_out") && fields.includes("c_req"), "commit increments c_in/c_out/c_req");
  ok(!fields.includes("r_in"), "not bucketed under research");
}

console.log("— defensive parsing —");
{
  calorieReply = "```json\n" + JSON.stringify({ name: "Tacos", total: 640, items: [{ n: "tacos", c: 640 }] }) + "\n```";
  const r = await call({ mode: "calories", text: "three carne asada tacos" });
  ok(r.status === 200 && r.json.ok === true && r.json.total === 640, "code-fenced JSON parses");
}
{
  calorieReply = JSON.stringify({ error: "not food" });
  const r = await call({ mode: "calories", text: "my homework folder" });
  ok(r.status === 200 && r.json.ok === false && /food/.test(r.json.message), "not-food → gentle ok:false message");
}
{
  calorieReply = "Sure! That's probably around 900 calories.";
  const r = await call({ mode: "calories", text: "a burger" });
  ok(r.status === 502, "prose reply (no JSON) → 502");
}
{
  calorieReply = JSON.stringify({ name: "X", total: -5 });
  const r = await call({ mode: "calories", text: "a burger" });
  ok(r.status === 502, "negative total rejected → 502");
}
{
  calorieReply = JSON.stringify({ name: "", total: 300, items: [{ n: "", c: 100 }, { n: "thing", c: "bad" }, { n: "kept", c: 300 }] });
  const r = await call({ mode: "calories", text: "mystery snack" });
  ok(r.json.ok === true && r.json.name === "Meal" && r.json.items.length === 1 && r.json.items[0].n === "kept", "empty name defaults, bad items filtered");
}
{
  calorieReply = JSON.stringify({ name: "Weird", total: 400, protein: -20, carbs: "lots", fat: 9000, items: [{ n: "x", c: 400, p: 12.6 }] });
  const r = await call({ mode: "calories", text: "a weird snack" });
  ok(r.json.ok === true && r.json.protein === 0 && r.json.carbs === 0 && r.json.fat === 0, "invalid macro grams clamp to 0 (negative / non-numeric / absurd)");
  ok(r.json.items[0].p === 13 && r.json.items[0].cb === 0, "item macros rounded, missing default 0");
}

console.log("— input validation + gating —");
{
  const r = await call({ mode: "calories", text: "   " });
  ok(r.status === 400, "empty text → 400");
  calorieReply = JSON.stringify({ name: "Big", total: 100, items: [] });
  await call({ mode: "calories", text: "y".repeat(2000) });
  ok(lastAnt().messages[0].content.length === 500, "over-long text truncated to 500 chars");
  const req = new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: "WRONG", mode: "calories", text: "a burger" }) });
  ok((await handler(req)).status === 401, "wrong secret → 401");
}

console.log("— streaming modes unaffected —");
{
  const r = await call({ mode: "story", messages: [{ role: "user", content: "Begin." }] });
  ok(r.status === 200 && r.text.includes("===CHOICES==="), "story still streams");
  ok(lastAnt().stream === true, "story request still stream:true");
  const r2 = await call({ mode: "research", messages: [{ role: "user", content: "Explain gravity." }] });
  ok(r2.status === 200, "research still streams");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const srv of [tokenSrv, fsSrv, antSrv]) srv.close();
process.exit(fail ? 1 : 0);
