// TeacherGPT server suite — in-process farmgpt.mjs vs fake Anthropic (Opus JSON) + fake Google
// token/Firestore. The server's job ends at STRUCTURED QUIZ JSON (the page builds the .docx on
// the device — no Google Docs/Drive APIs anywhere). Verifies the Opus prompt rules, the quiz
// JSON contract, the background job + poll plumbing, validation/auth, and that other modes are
// untouched. Nothing touches real services.
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ✓ " + n); } else { fail++; console.log("  ✗ FAIL " + n); } };

const SECRET = "testsecret";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });
const DOCBASE = "projects/amen-farms-app/databases/(default)/documents";
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => r(b)); });

const QUIZ = {
  title: "Fractions Review", chapter: "Chapter 7: Fractions",
  instructions: "Answer every question. Show your work where lines are given.",
  questions: [
    { q: "What is $\\frac{1}{2} + \\frac{1}{4}$?", choices: ["$\\frac{3}{4}$", "$\\frac{2}{6}$", "$\\frac{1}{8}$", "$\\frac{2}{4}$"], lines: 0 },
    { q: "Evaluate $5^{2} \\times \\sqrt{9}$.", choices: null, lines: 1 },
    { q: "Maria cuts a pizza into 8 equal slices and eats 3. What fraction is left? Show your work.", choices: null, lines: 3 },
  ],
  answerKey: ["A — $\\frac{3}{4}$ (common denominator 4)", "75", "$\\frac{5}{8}$ (8 - 3 = 5 slices of 8)"],
};

const anthropicReqs = [];
let antBehavior = "ok";           // "ok" | "badjson" | "fail"

const tokenSrv = http.createServer(async (q, s) => {
  await readBody(q);
  s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ access_token: "t", expires_in: 3600 }));
});
const store = new Map();          // Firestore doc name -> fields (job-result docs need real reads)
const fsSrv = http.createServer(async (q, s) => {
  const body = await readBody(q);
  const send = (c, o) => { s.writeHead(c, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  if (q.url.includes(":commit")) {
    try { for (const w of JSON.parse(body).writes || []) if (w.update && w.update.fields) store.set(w.update.name, w.update.fields); } catch {}
    return send(200, {});
  }
  if (q.url.includes(":runQuery")) return send(200, [{}]);
  if (q.method === "GET") {
    const rel = q.url.split("?")[0].replace(/^.*documents\//, "");
    const full = `${DOCBASE}/${rel}`;
    if (store.has(full)) return send(200, { name: full, fields: store.get(full) });
    return send(404, { error: { code: 404 } });
  }
  send(200, {});
});
const antSrv = http.createServer(async (q, s) => {
  const j = JSON.parse(await readBody(q)); anthropicReqs.push(j);
  if (antBehavior === "fail") { s.writeHead(500, { "content-type": "application/json" }); return s.end("{}"); }
  const text = antBehavior === "badjson" ? "Here you go! (not JSON)" : JSON.stringify(QUIZ);
  s.writeHead(200, { "content-type": "application/json" });
  s.end(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 4200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
});
for (const srv of [tokenSrv, fsSrv, antSrv]) await new Promise((r) => srv.listen(0, "127.0.0.1", r));

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = "fake";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${antSrv.address().port}`;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${tokenSrv.address().port}/t`;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${fsSrv.address().port}/v1/${DOCBASE}`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@t", private_key: saPem });

const farmgptModule = await import(new URL("../netlify/functions/farmgpt.mjs", import.meta.url).href);
const handler = farmgptModule.default;
const { runTeacherJob } = farmgptModule;
const bgHandler = (await import(new URL("../netlify/functions/teachergpt-background.mjs", import.meta.url).href)).default;
async function call(body, secret = SECRET) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret, ...body }),
  });
  const resp = await handler(req);
  // teachergpt success/error responses are 200 keepalive streams — result JSON on the LAST
  // line; validation errors are plain JSON. Parsing the last line handles both.
  let json = null; const text = await resp.text();
  try { json = JSON.parse(text.trim().split("\n").pop()); } catch {}
  return { status: resp.status, json, text, ct: resp.headers.get("content-type") || "" };
}
const IMG = { media_type: "image/jpeg", data: Buffer.from("fake-jpeg-bytes").toString("base64") };

console.log("— happy path: photos → Opus → structured quiz JSON —");
{
  const r = await call({ mode: "teachergpt", images: [IMG, IMG], kind: "quiz", count: 3, notes: "focus on pizza problems" });
  ok(r.status === 200 && r.json && r.json.ok === true, "returns ok JSON (got " + r.status + ")");
  ok(r.ct.includes("text/plain") && r.text.startsWith(" "), "response is a keepalive STREAM (survives long Opus runs on the fallback path)");
  const a = anthropicReqs[0];
  ok(a.model === "claude-opus-5", "runs on Opus 5");
  ok(a.max_tokens === 8000, "big output budget for a full assessment");
  ok(a.system.includes("DIFFERENT numbers") && a.system.includes("Never copy a problem verbatim"), "prompt: existing quizzes are rebuilt with different numbers");
  ok(a.system.includes("CHAPTER"), "prompt: chapter identified from the material");
  ok(a.system.includes("MATCH it to the work") && a.system.includes("Err on the SMALL side"), "prompt: answer space scales with required work (compact bias)");
  ok(a.system.includes("MATH NOTATION") && a.system.includes("\\frac{3}{4}") && a.system.includes("\\sqrt{49}"), "prompt: $...$ math mini-notation required (frac/sqrt/exponents)");
  ok(a.system.includes("never a slash like 3/4") && a.system.includes("Money is NOT math"), "prompt: fractions always stacked; dollar amounts stay literal");
  const content = a.messages[0].content;
  ok(Array.isArray(content) && content.filter((b) => b.type === "image").length === 2, "both photos sent as image blocks");
  const txt = content.find((b) => b.type === "text").text;
  ok(txt.includes("QUIZ") && txt.includes("EXACTLY 3 questions") && txt.includes("pizza problems"), "request text carries kind, exact count, and teacher notes");
  ok(r.json.kind === "quiz" && r.json.questionCount === 3, "response reports kind + count");
  const q = r.json.quiz;
  ok(q && q.title === "Fractions Review" && q.chapter === "Chapter 7: Fractions", "quiz JSON carries title + chapter");
  ok(q.instructions.includes("Answer every question"), "…and instructions");
  ok(q.questions.length === 3 && q.questions[0].choices.length === 4 && q.questions[2].lines === 3, "…and questions with choices/answer-line counts");
  ok(q.answerKey.length === 3 && q.answerKey[2].includes("\\frac{5}{8}"), "…and a full answer key");
  ok(q.questions[0].q.includes("\\frac{1}{2}") && q.questions[1].q.includes("\\sqrt{9}"), "math markup survives the round trip untouched (typeset on-device)");
}
{
  const r = await call({ mode: "teachergpt", images: [IMG], kind: "test", count: 3 });
  ok(r.json.ok && r.json.kind === "test", "test kind flows through");
}

console.log("— validation + error surfaces —");
{
  const r0 = await call({ mode: "teachergpt", images: [], kind: "quiz", count: 5 });
  ok(r0.status === 400, "no photos → 400");
  const r1 = await call({ mode: "teachergpt", images: [{ media_type: "image/gif", data: "x" }], kind: "quiz", count: 5 });
  ok(r1.status === 400, "unsupported image type alone → 400");
  antBehavior = "fail";
  const r2 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 });
  ok(r2.json && r2.json.error && r2.json.error.includes("reach the model"), "model failure → friendly error");
  antBehavior = "badjson";
  const r3 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 });
  ok(r3.json && r3.json.error && r3.json.error.includes("format"), "unparseable reply → friendly error");
  antBehavior = "ok";
  const r5 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 }, "wrong");
  ok(r5.status === 401, "bad secret → 401");
}

console.log("— background job path (the primary one): runTeacherJob + poll —");
{
  const before = anthropicReqs.length;
  await runTeacherJob({ secret: "wrong", jobId: "jobbad1", images: [IMG], kind: "quiz", count: 3 });
  ok(anthropicReqs.length === before, "wrong secret → the job never runs (endpoint is public)");
  ok(!store.has(`${DOCBASE}/farmgpt_teacher_jobs/jobbad1`), "…and writes nothing");
  await runTeacherJob({ secret: SECRET, jobId: "not ok!", images: [IMG], kind: "quiz", count: 3 });
  ok(anthropicReqs.length === before, "bad jobId → refused");

  const p0 = await call({ mode: "teachergpt_result", jobId: "jobxyz1" });
  ok(p0.status === 200 && p0.json.pending === true, "polling before the job lands → pending");

  await runTeacherJob({ secret: SECRET, jobId: "jobxyz1", images: [IMG, IMG], kind: "test", count: 3 });
  ok(store.has(`${DOCBASE}/farmgpt_teacher_jobs/jobxyz1`), "job outcome written to the result doc");
  const p1 = await call({ mode: "teachergpt_result", jobId: "jobxyz1" });
  ok(p1.json.ok === true && p1.json.kind === "test" && p1.json.questionCount === 3, "poll returns kind + count");
  ok(p1.json.quiz && p1.json.quiz.title === "Fractions Review" && p1.json.quiz.questions.length === 3, "poll returns the FULL quiz JSON (docx is built on-device from it)");
  ok(p1.json.quiz.answerKey.length === 3, "…answer key included");

  antBehavior = "fail";
  await runTeacherJob({ secret: SECRET, jobId: "jobfail1", images: [IMG], kind: "quiz", count: 3 });
  const p2 = await call({ mode: "teachergpt_result", jobId: "jobfail1" });
  ok(p2.json.error && p2.json.error.includes("reach the model"), "a failed job's error reaches the poller");
  antBehavior = "ok";

  const bad = await call({ mode: "teachergpt_result", jobId: "###" });
  ok(bad.status === 400, "malformed jobId → 400");

  const resp = await bgHandler(new Request("http://localhost/.netlify/functions/teachergpt-background", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SECRET, jobId: "jobbg001", images: [IMG], kind: "quiz", count: 3 }),
  }));
  ok(resp.status === 200 && store.has(`${DOCBASE}/farmgpt_teacher_jobs/jobbg001`), "teachergpt-background endpoint runs the job end-to-end");
}

console.log("— other modes untouched —");
{
  const r = await call({ mode: "calories", text: "an apple" });
  ok(r.status === 200 || r.status === 502, "calories mode still routes");
  const s = await call({ mode: "story", user: "Isaac", storyId: "s1", messages: [{ role: "user", content: "A farm story." }] });
  ok(s.status === 200, "story mode still streams");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const srv of [tokenSrv, fsSrv, antSrv]) srv.close();
process.exit(fail ? 1 : 0);
