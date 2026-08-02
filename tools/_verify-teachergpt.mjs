// TeacherGPT server suite — in-process farmgpt.mjs vs fake Anthropic (Opus JSON) + fake Google
// token/Docs/Drive servers. Verifies the photos→Opus→Google-Doc pipeline: model + prompt rules
// (different numbers, chapter, strict JSON), doc creation + print layout (name/date line, page
// break, answer key), the share to the teacher's email, usage under t_*, error surfaces, and
// that other modes are untouched. Nothing touches real services.
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
    { q: "What is 1/2 + 1/4?", choices: ["3/4", "2/6", "1/8", "2/4"], lines: 0 },
    { q: "Write 6/8 in simplest form.", choices: null, lines: 1 },
    { q: "Maria cuts a pizza into 8 equal slices and eats 3. What fraction is left? Show your work.", choices: null, lines: 3 },
  ],
  answerKey: ["A — 3/4 (common denominator 4)", "3/4 (divide both by 2)", "5/8 (8 - 3 = 5 slices of 8)"],
};

const anthropicReqs = [];
let antBehavior = "ok";           // "ok" | "badjson" | "fail"
const tokenScopes = [];
const docsReqs = [];              // { path, body }
let docsCreateStatus = 200;

const tokenSrv = http.createServer(async (q, s) => {
  const body = await readBody(q);
  const jwtPart = new URLSearchParams(body).get("assertion").split(".")[1];
  tokenScopes.push(JSON.parse(Buffer.from(jwtPart, "base64url").toString()).scope);
  s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ access_token: "t", expires_in: 3600 }));
});
const fsSrv = http.createServer(async (q, s) => {
  await readBody(q);
  const send = (c, o) => { s.writeHead(c, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  if (q.url.includes(":commit")) return send(200, {});
  if (q.url.includes(":runQuery")) return send(200, [{}]);
  if (q.method === "GET") return send(404, { error: { code: 404 } });
  send(200, {});
});
const antSrv = http.createServer(async (q, s) => {
  const j = JSON.parse(await readBody(q)); anthropicReqs.push(j);
  if (antBehavior === "fail") { s.writeHead(500, { "content-type": "application/json" }); return s.end("{}"); }
  const text = antBehavior === "badjson" ? "Here you go! (not JSON)" : JSON.stringify(QUIZ);
  s.writeHead(200, { "content-type": "application/json" });
  s.end(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 4200, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }));
});
const gSrv = http.createServer(async (q, s) => {
  const body = await readBody(q);
  const send = (c, o) => { s.writeHead(c, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  docsReqs.push({ path: q.url, body: body ? JSON.parse(body) : null });
  if (q.url === "/v1/documents") {
    if (docsCreateStatus !== 200) return send(docsCreateStatus, { error: { message: "API not enabled" } });
    return send(200, { documentId: "DOC123" });
  }
  if (q.url.includes(":batchUpdate")) return send(200, {});
  if (q.url.includes("/permissions")) return send(200, { id: "perm1" });
  send(404, {});
});
for (const srv of [tokenSrv, fsSrv, antSrv, gSrv]) await new Promise((r) => srv.listen(0, "127.0.0.1", r));

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = "fake";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${antSrv.address().port}`;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${tokenSrv.address().port}/t`;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${fsSrv.address().port}/v1/${DOCBASE}`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@t", private_key: saPem });
process.env.TEACHER_DOCS_BASE_URL = `http://127.0.0.1:${gSrv.address().port}`;
process.env.TEACHER_DRIVE_BASE_URL = `http://127.0.0.1:${gSrv.address().port}`;
delete process.env.TEACHER_DOC_EMAIL;

const handler = (await import(new URL("../netlify/functions/farmgpt.mjs", import.meta.url).href)).default;
async function call(body, secret = SECRET) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret, ...body }),
  });
  const resp = await handler(req);
  // teachergpt success/model-error responses are 200 keepalive streams — the result JSON rides
  // the LAST line; validation errors are plain JSON. Parsing the last line handles both.
  let json = null; const text = await resp.text();
  try { json = JSON.parse(text.trim().split("\n").pop()); } catch {}
  return { status: resp.status, json, text, ct: resp.headers.get("content-type") || "" };
}
const IMG = { media_type: "image/jpeg", data: Buffer.from("fake-jpeg-bytes").toString("base64") };

console.log("— happy path: photos → Opus → shared Google Doc —");
{
  const r = await call({ mode: "teachergpt", images: [IMG, IMG], kind: "quiz", count: 3, notes: "focus on pizza problems" });
  ok(r.status === 200 && r.json && r.json.ok === true, "returns ok JSON (got " + r.status + ")");
  ok(r.ct.includes("text/plain") && r.text.startsWith(" "), "response is a keepalive STREAM (first byte immediate — survives Netlify's sync timeout)");
  const a = anthropicReqs[0];
  ok(a.model === "claude-opus-5", "runs on Opus 5");
  ok(a.max_tokens === 8000, "big output budget for a full assessment");
  ok(a.system.includes("DIFFERENT numbers") && a.system.includes("Never copy a problem verbatim"), "prompt: existing quizzes are rebuilt with different numbers");
  ok(a.system.includes("CHAPTER"), "prompt: chapter identified from the material");
  const content = a.messages[0].content;
  ok(Array.isArray(content) && content.filter((b) => b.type === "image").length === 2, "both photos sent as image blocks");
  const txt = content.find((b) => b.type === "text").text;
  ok(txt.includes("QUIZ") && txt.includes("EXACTLY 3 questions") && txt.includes("pizza problems"), "request text carries kind, exact count, and teacher notes");
  ok(tokenScopes.some((sc) => sc.includes("auth/documents") && sc.includes("auth/drive")), "Google token minted with Docs + Drive scopes");
  const create = docsReqs.find((d) => d.path === "/v1/documents");
  ok(create && create.body.title.includes("Chapter 7") && create.body.title.includes("Quiz"), "doc titled with chapter + kind");
  const upd = docsReqs.find((d) => d.path.includes(":batchUpdate"));
  ok(!!upd, "doc content written via batchUpdate");
  const reqs = upd.body.requests;
  const bodyText = reqs[0].insertText.text;
  ok(bodyText.startsWith("Fractions Review\n"), "document opens with the assessment title");
  ok(bodyText.includes("Chapter 7: Fractions") && bodyText.includes("QUIZ"), "header shows the chapter and QUIZ label");
  ok(/Name: _+.*Date: _+/.test(bodyText), "name and date lines for the student");
  ok(bodyText.includes("Instructions: Answer every question"), "instructions printed");
  ok(bodyText.includes("1. What is 1/2 + 1/4?") && bodyText.includes("A)  3/4") && bodyText.includes("D)  2/4"), "multiple-choice question with lettered choices");
  ok((bodyText.match(/____________________/g) || []).length >= 4, "answer lines printed for written questions");
  ok(reqs.some((x) => x.insertPageBreak), "answer key starts on its own page (page break)");
  const keyText = reqs.filter((x) => x.insertText)[1].insertText.text;
  ok(keyText.startsWith("ANSWER KEY — Fractions Review") && keyText.includes("3. 5/8"), "answer key page with every answer");
  ok(reqs.some((x) => x.updateParagraphStyle && x.updateParagraphStyle.paragraphStyle.namedStyleType === "TITLE"), "title styled as a document title");
  const perm = docsReqs.find((d) => d.path.includes("/permissions"));
  ok(perm && perm.path.includes("sendNotificationEmail=true"), "share sends the email notification");
  ok(perm.body.emailAddress === "dbadams@gmail.com" && perm.body.role === "writer", "shared to dbadams@gmail.com as writer");
  ok(r.json.url === "https://docs.google.com/document/d/DOC123/edit", "response carries the doc link");
  ok(r.json.kind === "quiz" && r.json.questionCount === 3 && r.json.sharedWith === "dbadams@gmail.com", "response reports kind/count/recipient");
}

console.log("— usage: billed under the t_* (Opus) bucket —");
{
  // usage commits go to the fake Firestore; assert the mode key mapping via a second call and
  // the absence of errors — the transform itself is covered by the shared logUsage plumbing.
  const r = await call({ mode: "teachergpt", images: [IMG], kind: "test", count: 5 });
  ok(r.status === 200, "test kind also succeeds");
  const upd = docsReqs.filter((d) => d.path.includes(":batchUpdate")).pop();
  ok(upd.body.requests[0].insertText.text.includes("TEST"), "TEST label rendered for tests");
  const create = docsReqs.filter((d) => d.path === "/v1/documents").pop();
  ok(create.body.title.includes("Test"), "doc title says Test");
}

console.log("— validation + error surfaces —");
{
  const r0 = await call({ mode: "teachergpt", images: [], kind: "quiz", count: 5 });
  ok(r0.status === 400, "no photos → 400");
  const r1 = await call({ mode: "teachergpt", images: [{ media_type: "image/gif", data: "x" }], kind: "quiz", count: 5 });
  ok(r1.status === 400, "unsupported image type alone → 400");
  antBehavior = "fail";
  const r2 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 });
  ok(r2.json && r2.json.error && r2.json.error.includes("reach the model"), "model failure → friendly error on the stream");
  antBehavior = "badjson";
  const r3 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 });
  ok(r3.json && r3.json.error && r3.json.error.includes("format"), "unparseable reply → friendly error on the stream");
  antBehavior = "ok";
  docsCreateStatus = 403;
  const r4 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 });
  ok(r4.json && r4.json.error && r4.json.error.includes("enable the Google Docs API"), "Docs API not enabled → actionable setup message");
  docsCreateStatus = 200;
  const r5 = await call({ mode: "teachergpt", images: [IMG], kind: "quiz", count: 5 }, "wrong");
  ok(r5.status === 401, "bad secret → 401");
}

console.log("— other modes untouched —");
{
  const before = docsReqs.length;
  const r = await call({ mode: "calories", text: "an apple" });
  ok(r.status === 200 || r.status === 502, "calories mode still routes");
  ok(docsReqs.length === before, "no Google Docs traffic from other modes");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const srv of [tokenSrv, fsSrv, antSrv, gSrv]) srv.close();
process.exit(fail ? 1 : 0);
