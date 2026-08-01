// Parent research mode suite — in-process farmgpt.mjs vs fake Anthropic/Google/Firestore.
// Verifies research requests from EXACTLY "Dad"/"Mom" get the direct-answer/answer-key prompt,
// every other identity (kids, variants, missing) keeps the tutor prompt, and no other mode is
// affected by the user field. Nothing touches real services.
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
  ev({ type: "content_block_delta", delta: { type: "text_delta", text: "An answer." } });
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
const sysOf = (a) => typeof a.system === "string" ? a.system : JSON.stringify(a.system || "");
const PARENT_MARK = "ANSWER KEYS (a core job";
const TUTOR_MARK = "TUTOR, not a homework machine";
const ask = (user) => call({ mode: "research", user, messages: [{ role: "user", content: "Make an answer key for problems 1-10." }] });

console.log("— parents get direct answers + answer keys —");
for (const user of ["Dad", "Mom"]) {
  const r = await ask(user);
  const a = lastAnt(); const sys = sysOf(a);
  ok(r.status === 200, user + ": research streams (200)");
  ok(sys.includes(PARENT_MARK), user + ": parent prompt selected (answer keys are a core job)");
  ok(sys.includes("complete, direct answers"), user + ": direct answers allowed");
  ok(!sys.includes(TUTOR_MARK), user + ": tutor restrictions absent");
  ok(sys.includes("CONTENT RULES (absolute"), user + ": FAMILY_RULES still apply");
  ok(sys.includes("===ANSWERS==="), user + ": practice-problem tap-button protocol still available");
  ok(a.max_tokens === 4096, user + ": research token budget unchanged");
}

console.log("— everyone else keeps the tutor —");
for (const user of ["Eleanor", "Isaac", "Grandma", "dad", "Dad ( :", "Mom!", "", undefined]) {
  await ask(user);
  const sys = sysOf(lastAnt());
  ok(sys.includes(TUTOR_MARK) && !sys.includes(PARENT_MARK), JSON.stringify(user ?? "(absent)") + ": tutor prompt, no parent language");
}

console.log("— other modes ignore the parent switch —");
{
  await call({ mode: "story", user: "Dad", messages: [{ role: "user", content: "A farm story." }] });
  const sys = sysOf(lastAnt());
  ok(!sys.includes(PARENT_MARK) && !sys.includes(TUTOR_MARK), "story as Dad: story prompt untouched");
  await call({ mode: "summary", user: "Dad", messages: [{ role: "user", content: "Notes.\n\nRewrite the continuity notes now." }] });
  ok(!sysOf(lastAnt()).includes(PARENT_MARK), "summary as Dad: untouched");
  await call({ mode: "kidstory", user: "Dad", messages: [{ role: "user", content: "A goat story." }] });
  ok(!sysOf(lastAnt()).includes(PARENT_MARK), "kidstory as Dad: untouched");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const srv of [tokenSrv, fsSrv, antSrv]) srv.close();
process.exit(fail ? 1 : 0);
