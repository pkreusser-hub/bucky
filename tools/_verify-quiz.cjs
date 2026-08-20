#!/usr/bin/env node
"use strict";
/**
 * BUCKY Team Quiz suite — quiz.html + the quizgen mode of netlify/functions/farmgpt.mjs.
 *
 *   node tools/_verify-quiz.cjs
 *
 * Section A runs farmgpt.mjs's quizgen mode IN PROCESS against a fake Anthropic server and
 * a fake Google (token + Firestore) server. Section B drives the real quiz.html page in
 * headless Chrome, host + two players as three tabs in ONE browser context (so localStorage
 * and 'storage' events are shared, matching the LOCAL-mode backend's design).
 *
 * FIREBASE/GOOGLE/GSTATIC ARE BLOCKED on every page — non-negotiable house rule.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8971, ANTH_PORT = 8972, GOOG_PORT = 8973;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "amenfarms";

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ fake Anthropic ============================== */
let anthMode = "twelve", anthLastBody = null;

function quizQuestion(i, opts) {
  opts = opts || {};
  return {
    q: "Question number " + i + "?",
    options: ["Option A" + i, "Option B" + i, "Option C" + i, "Option D" + i],
    correctIndex: opts.correctIndex != null ? opts.correctIndex : 1,
    category: "General knowledge",
    difficulty: "medium",
  };
}

function twelveQuestionQuiz() {
  const qs = [];
  for (let i = 1; i <= 11; i++) qs.push(quizQuestion(i));
  // The 12th question has correctIndex 0 — the regression fixture for the `||`-on-0 bug class.
  qs.push(quizQuestion(12, { correctIndex: 0 }));
  return { title: "Staff Trivia Night", questions: qs };
}

function junkQuiz() {
  return {
    title: "Junky",
    questions: [
      quizQuestion(1), // valid
      quizQuestion(2), // valid
      { q: "Missing options", options: [], correctIndex: 0, category: "x", difficulty: "easy" },
      { q: "Bad index", options: ["A", "B", "C", "D"], correctIndex: 7, category: "x", difficulty: "easy" },
      { q: "String index", options: ["A", "B", "C", "D"], correctIndex: "1", category: "x", difficulty: "easy" },
    ],
  };
}

function serveAnthropic() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        let body = null; try { body = JSON.parse(raw); } catch {}
        anthLastBody = body;
        res.setHeader("content-type", "application/json");
        if (anthMode === "refusal") {
          return res.end(JSON.stringify({
            content: [{ type: "text", text: "I can't help with generating that quiz content." }],
            usage: { input_tokens: 40, output_tokens: 12 },
          }));
        }
        if (anthMode === "junk") {
          return res.end(JSON.stringify({
            content: [{ type: "text", text: JSON.stringify(junkQuiz()) }],
            usage: { input_tokens: 80, output_tokens: 60 },
          }));
        }
        const quiz = twelveQuestionQuiz();
        const text = anthMode === "fenced"
          ? "```json\n" + JSON.stringify(quiz) + "\n```"
          : JSON.stringify(quiz);
        res.end(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 500, output_tokens: 900 } }));
      });
    });
    srv.listen(ANTH_PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ==================== fake Google token + fake Firestore ================== */
let usageCommits = [];
function makeServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({ client_email: "quiz-test@amen-farms-app.iam.gserviceaccount.com", private_key: privateKey });
}
function serveGoogle() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let raw = ""; req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        const p = req.url.split("?")[0];
        if (p === "/token") return res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
        if (p.endsWith(":commit")) {
          let b = null; try { b = JSON.parse(raw); } catch {}
          usageCommits.push({ auth: req.headers.authorization || "", body: b });
          return res.end(JSON.stringify({ writeResults: [] }));
        }
        res.statusCode = 404; res.end("{}");
      });
    });
    srv.listen(GOOG_PORT, "127.0.0.1", () => resolve(srv));
  });
}

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pw = "/opt/pw-browsers/chromium";
  if (fs.existsSync(pw)) {
    const cands = [pw, path.join(pw, "chrome"), path.join(pw, "chrome-linux", "chrome")];
    for (const c of cands) { try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (_) {} }
  }
  const pwGlob = "/opt/pw-browsers";
  if (fs.existsSync(pwGlob)) {
    for (const d of fs.readdirSync(pwGlob)) {
      const c = path.join(pwGlob, d, "chrome-linux", "chrome");
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}

/* ============================ static server =============================== */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".txt": "text/plain" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]);
      if (p === "/") p = "/quiz.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

/* ====================== A. quizgen, in process ============================= */
let handler = null;
async function call(body, origin) {
  const req = new Request("https://amenfarms.netlify.app/.netlify/functions/farmgpt", {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
  const res = await handler(req);
  let j = null; try { j = await res.json(); } catch {}
  return { status: res.status, body: j };
}

async function sectionA() {
  section("A. quizgen (in process, fake Anthropic + fake Google)");

  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ANTH_PORT}`;
  process.env.FIREBASE_SERVICE_ACCOUNT = makeServiceAccount();
  process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;
  process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${GOOG_PORT}/v1/projects/amen-farms-app/databases/(default)/documents`;

  const mod = await import("file://" + path.join(ROOT, "netlify", "functions", "farmgpt.mjs").replace(/\\/g, "/"));
  handler = mod.default;
  ok(typeof handler === "function", "farmgpt.mjs exports a handler");

  // 1. wrong secret
  const wrong = await call({ secret: "nope", mode: "quizgen", categories: ["Sports"] });
  ok(wrong.status === 401, "a wrong family password is rejected (401)");

  // 2. no categories
  const noCat = await call({ secret: SECRET, mode: "quizgen", categories: [] });
  ok(noCat.status === 400, "quizgen with no categories is rejected (400)");

  // 3. valid reply, 12 questions incl one correctIndex 0
  anthMode = "twelve";
  const good = await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"], count: 12 });
  ok(good.status === 200 && good.body.ok === true, "a valid model reply returns {ok:true, quiz}");
  const gq = (good.body.quiz || {}).questions || [];
  ok(gq.length === 12, `all 12 questions survive (${gq.length})`);
  const zeroQ = gq.find((q) => q.correctIndex === 0);
  ok(!!zeroQ, "the question with correctIndex 0 survives (the ||-on-0 regression)");

  // 4. same reply wrapped in ```json fences
  anthMode = "fenced";
  const fenced = await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"], count: 12 });
  ok(fenced.status === 200 && fenced.body.ok === true && (fenced.body.quiz.questions || []).length === 12,
    "a ```json-fenced reply still parses");

  // 5. realistic refusal
  anthMode = "refusal";
  const refusal = await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"] });
  ok(refusal.status === 200 && refusal.body && typeof refusal.body.error === "string" && !refusal.body.ok,
    "a realistic refusal text yields {error:...} at HTTP 200, not a throw");

  // 6. 2 valid + junk -> error (fewer than 3 survivors)
  anthMode = "junk";
  const junk = await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"] });
  ok(junk.status === 200 && junk.body && typeof junk.body.error === "string" && !junk.body.ok,
    "2 valid + 3 junk questions (missing options / bad index / string index) fails as a batch");

  // 7. count clamping — the PROMPT the fake Anthropic received
  anthMode = "twelve";
  await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"], count: 999 });
  const promptText999 = (anthLastBody && anthLastBody.messages && anthLastBody.messages[0] && anthLastBody.messages[0].content) || "";
  ok(/EXACTLY 25 questions/.test(promptText999), "count 999 is clamped to EXACTLY 25 in the prompt");

  await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"], count: 1 });
  const promptText1 = (anthLastBody && anthLastBody.messages && anthLastBody.messages[0] && anthLastBody.messages[0].content) || "";
  ok(/EXACTLY 5 questions/.test(promptText1), "count 1 is clamped up to EXACTLY 5 in the prompt");

  // 8. usage telemetry lands in bucket "q"
  usageCommits = [];
  const usageRes = await call({ secret: SECRET, mode: "quizgen", categories: ["General knowledge"] });
  ok(usageRes.status === 200 && usageRes.body.ok === true, "the usage-tracked call still succeeds");
  await sleep(50); // logUsage fires without being awaited by the response in some modes; give the commit a beat
  ok(usageCommits.length >= 1, "quizgen writes a usage commit");
  if (usageCommits.length) {
    const paths = ((usageCommits[usageCommits.length - 1].body || {}).writes || [])
      .flatMap((w) => ((w.transform && w.transform.fieldTransforms) || []).map((f) => f.fieldPath));
    ok(paths.some((p) => p.startsWith("q_in")), "usage commit carries a q_in field path");
    ok(paths.some((p) => p.startsWith("q_out")), "usage commit carries a q_out field path");
    ok(paths.some((p) => p.startsWith("q_req")), "usage commit carries a q_req field path");
  } else {
    ok(false, "usage commit carries q_in/q_out/q_req field paths");
  }

  delete process.env.ANTHROPIC_BASE_URL;
}

/* ============================ browser plumbing ============================ */
const contexts = [];
const EXPECTED_NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|googleapis|firestore|ERR_FAILED|ERR_BLOCKED|net::ERR/i;

async function newPage(browser, { viewport = { width: 390, height: 844, deviceScaleFactor: 1 }, ctx = null, pid = null, name = null, avatar = null } = {}) {
  const context = ctx || (browser.createBrowserContext ? await browser.createBrowserContext() : await browser.createIncognitoBrowserContext());
  if (!ctx) contexts.push(context);
  const page = await context.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => { if (!EXPECTED_NOISE.test(String(e))) errors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !EXPECTED_NOISE.test(m.text())) errors.push("console: " + m.text()); });

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const url = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) return r.abort();
    if (/^https?:\/\/fonts\.(googleapis|gstatic)\.com/i.test(url)) return r.abort(); // whitelisted noise
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(url)) return r.abort();
    r.continue();
  });

  if (pid || name || avatar) {
    await page.evaluateOnNewDocument((pidV, nameV, avV) => {
      if (pidV) localStorage.setItem("quiz_pid", pidV);
      if (nameV != null) localStorage.setItem("quiz_name", nameV);
      else localStorage.removeItem("quiz_name");
      if (avV) localStorage.setItem("quiz_avatar", avV);
    }, pid, name, avatar);
  }

  return { page, context, errors };
}

async function settle(page, ms) { await sleep(ms || 300); }
// Plain DOM click via evaluate — puppeteer's built-in page.click() polls for a stable,
// unobscured bounding box before dispatching, and under headless SwiftShader that poll can
// hang indefinitely against a CSS-animated tile (.pTile's popIn). A direct .click() is what
// the app's own event listeners care about anyway.
async function clickSel(page, sel) {
  const found = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    el.click();
    return true;
  }, sel);
  if (!found) throw new Error("clickSel: no element for " + sel);
}

/* ========================= B. the flow ===================================== */
async function sectionFlow(browser) {
  section("B. quiz.html — host + two players, one browser context");

  const host = await newPage(browser, { viewport: { width: 1280, height: 900 }, pid: "hostpid001" });
  const shared = host.context;

  await host.page.goto(BASE + "/quiz.html?host=1&local=1&fixture=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await host.page.waitForSelector("#hostPw", { timeout: 10000 });
  await host.page.type("#hostPw", "anything");
  await clickSel(host.page, "#hostGateBtn");
  await host.page.waitForSelector("#genBtn", { timeout: 10000 });
  ok(true, "the host builder renders after Continue");

  await clickSel(host.page, "#genBtn");
  await host.page.waitForSelector("#qList .qReview", { timeout: 10000 });
  const reviewCount = await host.page.evaluate(() => document.querySelectorAll("#qList .qReview").length);
  ok(reviewCount === 4, `the review list shows the fixture's 4 questions (${reviewCount})`);

  await clickSel(host.page, "#openLobbyBtn");
  await host.page.waitForSelector(".roomCode", { timeout: 10000 });
  const state1 = await host.page.evaluate(() => window.__QUIZ__.state());
  ok(state1.roomCode && /^[A-Z0-9]{4}$/.test(state1.roomCode), `the big screen shows a 4-char room code (${state1.roomCode})`);
  const CODE = state1.roomCode;

  // PLAYERS: two more tabs in the SAME context, sequenced pids so identities differ.
  const alice = await newPage(browser, { ctx: shared, pid: "alicepid02" });
  await alice.page.goto(BASE + "/quiz.html?room=" + CODE + "&local=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await alice.page.waitForSelector("#joinName", { timeout: 10000 });
  await alice.page.type("#joinName", "Alice");
  await alice.page.evaluate(() => { document.querySelector('#avGrid [data-av="🧀"]').click(); }).catch(() => {});
  await clickSel(alice.page, "#joinBtn");
  await alice.page.waitForSelector(".pStage", { timeout: 10000 });

  const bob = await newPage(browser, { ctx: shared, pid: "bobpid0003" });
  await bob.page.goto(BASE + "/quiz.html?room=" + CODE + "&local=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await bob.page.waitForSelector("#joinName", { timeout: 10000 });
  await bob.page.type("#joinName", "Bob");
  await clickSel(bob.page, "#joinBtn");
  await bob.page.waitForSelector(".pStage", { timeout: 10000 });

  const idents = await Promise.all([
    host.page.evaluate(() => window.__QUIZ__.state()),
    alice.page.evaluate(() => window.__QUIZ__.state()),
    bob.page.evaluate(() => window.__QUIZ__.state()),
  ]);
  ok(idents[0].isHost === true && idents[1].isHost === false && idents[2].isHost === false, "host and player identities differ (isHost)");

  await settle(host.page, 400);
  const lobbyText = await host.page.evaluate(() => document.body.textContent.replace(/\s+/g, " "));
  ok(/2 players joined/.test(lobbyText), "host lobby shows '2 players joined'");
  ok(/Alice/.test(lobbyText) && /Bob/.test(lobbyText), "…and both names");

  // AVATAR GRID / NO EMOJI checks, on Alice's join view — captured before Join was clicked
  // would be ideal, but the same markup is reachable on Bob's still-open join for a fresh
  // check: re-derive from a throwaway tab.
  const probe = await newPage(browser, { pid: "probepid01" });
  await probe.page.goto(BASE + "/quiz.html?local=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await probe.page.waitForSelector("#avGrid", { timeout: 10000 });
  const probeInfo = await probe.page.evaluate(() => {
    const avBtns = document.querySelectorAll("#avGrid .avatarBtn").length;
    const joinBtnText = document.getElementById("joinBtn").textContent;
    const heading = document.querySelector("h1.title").textContent;
    const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    return { avBtns, joinBtnText, heading, joinHasEmoji: EMOJI_RE.test(joinBtnText), headingHasEmoji: EMOJI_RE.test(heading) };
  });
  ok(probeInfo.avBtns === 24, `the avatar grid is exactly 24 buttons (${probeInfo.avBtns})`);
  ok(!probeInfo.joinHasEmoji, "the Join button carries no emoji");
  ok(!probeInfo.headingHasEmoji, "the join heading carries no emoji");
  await probe.context.close();

  // START
  await clickSel(host.page, "#startBtn");
  await host.page.waitForSelector(".qText", { timeout: 10000 });
  await Promise.all([
    alice.page.waitForSelector(".pQText", { timeout: 10000 }),
    bob.page.waitForSelector(".pQText", { timeout: 10000 }),
  ]);
  const q1Host = (await host.page.evaluate(() => document.querySelector(".qText").textContent)).replace(/\s+/g, " ").trim();
  const q1Alice = (await alice.page.evaluate(() => document.querySelector(".pQText").textContent)).replace(/\s+/g, " ").trim();
  const q1Bob = (await bob.page.evaluate(() => document.querySelector(".pQText").textContent)).replace(/\s+/g, " ").trim();
  ok(q1Host === "Which of these is a fruit?", `host shows Q1's full text ("${q1Host}")`);
  ok(q1Alice === q1Host && q1Bob === q1Host, "both players see the same full Q1 text");

  const liveHasNoAnswer = await alice.page.evaluate((code) => {
    const room = JSON.parse(localStorage.getItem("quiz_local_room_" + code) || "null");
    return room && room.live && !("correctIndex" in room.live);
  }, CODE);
  ok(liveHasNoAnswer, "the room doc's live object has NO correctIndex key");

  // ANSWER TIMING/SCORING — rewrite questionStartAt from the host page, then Alice answers.
  await host.page.evaluate((code) => {
    const key = "quiz_local_room_" + code;
    const cur = JSON.parse(localStorage.getItem(key));
    cur.questionStartAt = Date.now() - 5000;
    localStorage.setItem(key, JSON.stringify(cur));
  }, CODE);
  await settle(alice.page, 300); // let the storage event land in Alice's/Bob's tabs

  await clickSel(alice.page, ".pOptBtn.o1"); // fixture Q1 correctIndex 1 ("Apple")
  await clickSel(bob.page, ".pOptBtn.o0");   // wrong

  await settle(host.page, 300);
  const answerRec = await alice.page.evaluate((code) => {
    const answers = JSON.parse(localStorage.getItem("quiz_local_answers_" + code) || "{}");
    return answers["0_alicepid02"];
  }, CODE);
  ok(!!answerRec, "Alice's answer is recorded in local storage");
  ok(answerRec && answerRec.elapsedMs >= 4900 && answerRec.elapsedMs <= 6500,
    `Alice's stored elapsedMs is close to the forced 5000ms (${answerRec && answerRec.elapsedMs})`);

  // DOUBLE ANSWER: buttons disabled, and a forced re-click does not create a 2nd entry.
  const aliceDisabled = await alice.page.evaluate(() => [...document.querySelectorAll(".pOptBtn")].every((b) => b.disabled));
  ok(aliceDisabled, "Alice's option buttons are disabled after answering");
  await alice.page.evaluate(() => {
    const b = document.querySelector(".pOptBtn");
    if (b) { b.disabled = false; b.click(); }
  });
  await settle(alice.page, 200);
  const afterDup = await alice.page.evaluate((code) => {
    const answers = JSON.parse(localStorage.getItem("quiz_local_answers_" + code) || "{}");
    return answers["0_alicepid02"] || null;
  }, CODE);
  ok(!!afterDup && afterDup.choice === 1, `Alice's Q1 answer is still her ORIGINAL choice (1) after a forced double submit (got choice ${afterDup && afterDup.choice})`);

  // AUTO-ADVANCE — host reveals once both players answered.
  await host.page.waitForFunction(() => document.querySelector(".optCard.correct") != null, { timeout: 10000 });
  const reveal = await host.page.evaluate(() => {
    const cards = [...document.querySelectorAll(".optCard")];
    const correct = cards.find((c) => c.classList.contains("correct"));
    const dist = cards.map((c) => Number((c.querySelector(".distCount") || {}).textContent || "0"));
    return { correctIdx: correct ? cards.indexOf(correct) : -1, dist };
  });
  ok(reveal.correctIdx === 1, "host reveal highlights the correct option (index 1)");
  ok(reveal.dist[1] === 1 && reveal.dist[0] === 1, `distribution counts match (1 correct, 1 on Bob's wrong pick): ${JSON.stringify(reveal.dist)}`);

  const gained = await alice.page.evaluate((code) => {
    const answers = JSON.parse(localStorage.getItem("quiz_local_answers_" + code) || "{}");
    const room = JSON.parse(localStorage.getItem("quiz_local_room_" + code) || "{}");
    return { elapsedMs: answers["0_alicepid02"].elapsedMs, gained: (room.reveal && room.reveal.gained && room.reveal.gained["alicepid02"]) || 0, limitMs: room.timeLimitMs };
  }, CODE);
  const clamped = Math.max(0, Math.min(gained.limitMs, gained.elapsedMs));
  const expectedGained = Math.round(1000 * (1 - (clamped / gained.limitMs) / 2));
  ok(gained.gained === expectedGained, `Alice's gained points (${gained.gained}) match the hand-computed formula (${expectedGained})`);
  ok(gained.gained > 0, "…and it is a positive score for a correct answer");

  const bobGained = await bob.page.evaluate((code) => {
    const room = JSON.parse(localStorage.getItem("quiz_local_room_" + code) || "{}");
    return (room.reveal && room.reveal.gained && room.reveal.gained["bobpid0003"]) || 0;
  }, CODE);
  ok(bobGained === 0, "Bob's wrong answer gained 0");

  // Player reveal screens
  await Promise.all([
    alice.page.waitForFunction(() => /Correct!/.test(document.body.textContent), { timeout: 10000 }),
    bob.page.waitForFunction(() => /Not this time/.test(document.body.textContent), { timeout: 10000 }),
  ]);
  const aliceBig = await alice.page.evaluate(() => document.querySelector(".pResult .big").textContent);
  ok(new RegExp("^Correct! \\+" + gained.gained + "$").test(aliceBig), `Alice sees "Correct! +${gained.gained}" (got "${aliceBig}")`);
  const bobBig = await bob.page.evaluate(() => document.querySelector(".pResult .big").textContent);
  ok(bobBig === "Not this time", `Bob sees "Not this time" (got "${bobBig}")`);
  const bobSub = await bob.page.evaluate(() => (document.querySelector(".pResult .sub2") || {}).textContent || "");
  ok(/Apple/.test(bobSub), "Bob's reveal shows the correct answer text");

  // LEADERBOARD
  await clickSel(host.page, "#nextBtn");
  await host.page.waitForSelector(".lbRow", { timeout: 10000 });
  const board = await host.page.evaluate(() => [...document.querySelectorAll(".lbRow")].map((r) => ({
    name: (r.querySelector(".nm") || {}).textContent || "",
    score: (r.querySelector(".sc") || {}).textContent || "",
    gain: (r.querySelector(".gain") || {}).textContent || "",
  })));
  ok(board.length === 2 && board[0].name === "Alice" && board[1].name === "Bob", "board order: Alice rank 1, Bob rank 2");
  ok(board[0].gain === "+" + gained.gained, `Alice's row shows "+${gained.gained}" (got "${board[0].gain}")`);
  ok(board[1].score.replace(/,/g, "") === "0", "Bob's row shows a score of 0");

  await Promise.all([
    alice.page.waitForFunction(() => /You.re 1st/.test(document.body.textContent), { timeout: 10000 }),
    bob.page.waitForFunction(() => /You.re 2nd/.test(document.body.textContent), { timeout: 10000 }),
  ]);
  ok(true, "Alice's phone shows \"You're 1st\", Bob's shows \"You're 2nd\"");

  // Q2 REGRESSION: answered-count must reset to 0/2, not carry Q1's 2/2 forward.
  await clickSel(host.page, "#lbNextBtn");
  await host.page.waitForSelector(".qText", { timeout: 10000 });
  const answeredCountText = await host.page.evaluate(() => (document.getElementById("answeredCount") || {}).textContent || "");
  ok(/Answered: 0 \/ 2/.test(answeredCountText), `Q2 opens with "Answered: 0 / 2", not carried over (got "${answeredCountText}")`);
  await settle(host.page, 1500);
  const stillQuestion = await host.page.evaluate(() => document.querySelector(".qText") != null && document.querySelector(".optCard.correct") == null);
  ok(stillQuestion, "…and the host does NOT auto-reveal within ~1.5s with nobody answered");

  // Play Q2, Q3 quickly.
  async function playRound(correctIdxHint) {
    await alice.page.waitForSelector(".pOptBtn", { timeout: 10000 });
    await bob.page.waitForSelector(".pOptBtn", { timeout: 10000 });
    await clickSel(alice.page, ".pOptBtn.o0");
    await clickSel(bob.page, ".pOptBtn.o0");
    await host.page.waitForFunction(() => document.querySelector(".optCard.correct") != null, { timeout: 10000 });
    await clickSel(host.page, "#nextBtn");
    await host.page.waitForSelector(".lbRow", { timeout: 10000 });
    await clickSel(host.page, "#lbNextBtn");
  }
  await playRound(); // Q2 -> leaderboard -> Q3
  await settle(host.page, 300);
  await playRound(); // Q3 -> leaderboard -> Q4

  // Q4 (correctIndex 0): Alice answers option 0 -> correct, gains > 0.
  await alice.page.waitForSelector(".pOptBtn", { timeout: 10000 });
  const q4Text = (await host.page.evaluate(() => document.querySelector(".qText").textContent)).replace(/\s+/g, " ").trim();
  ok(q4Text === "Correct answer is A here.", `reached fixture Q4 ("${q4Text}")`);
  await clickSel(alice.page, ".pOptBtn.o0");
  await clickSel(bob.page, ".pOptBtn.o1");
  await host.page.waitForFunction(() => document.querySelector(".optCard.correct") != null, { timeout: 10000 });
  const q4gained = await alice.page.evaluate((code) => {
    const room = JSON.parse(localStorage.getItem("quiz_local_room_" + code) || "{}");
    return (room.reveal && room.reveal.gained && room.reveal.gained["alicepid02"]) || 0;
  }, CODE);
  ok(q4gained > 0, `Alice's option-0 answer on the correctIndex-0 question gains points (${q4gained}) — page-side regression check`);

  // PODIUM
  await clickSel(host.page, "#nextBtn");
  await host.page.waitForSelector(".lbRow", { timeout: 10000 });
  const lbNextText = await host.page.evaluate(() => document.getElementById("lbNextBtn").textContent);
  ok(lbNextText === "Final results", "the last leaderboard offers \"Final results\"");
  await clickSel(host.page, "#lbNextBtn");
  await host.page.waitForSelector(".podiumWrap", { timeout: 10000 });
  const podiumNames = await host.page.evaluate(() => [...document.querySelectorAll(".podBlock .nm")].map((n) => n.textContent));
  ok(podiumNames.length >= 2 && podiumNames.includes("Alice") && podiumNames.includes("Bob"), "podium shows top blocks with names");

  await Promise.all([
    alice.page.waitForFunction(() => /Final results/.test(document.body.textContent), { timeout: 10000 }),
    bob.page.waitForFunction(() => /Final results/.test(document.body.textContent), { timeout: 10000 }),
  ]);
  ok(true, "players see \"Final results\"");
  const aliceRankText = await alice.page.evaluate(() => (document.querySelector(".meRow") || {}).textContent || "");
  ok(/You.re/.test(aliceRankText), `Alice's own rank shows on her final screen ("${aliceRankText.trim()}")`);

  // HIDDEN GEOMETRY, checked back on a fresh question phase snapshot (Q4's still current
  // for host; use Alice's last question-phase page state captured via a re-check on Bob,
  // who is at the podium too — so re-derive on Alice's tab, which still holds a DOM from
  // the podium; the connBanner/localBadge checks apply regardless of phase).
  const geom = await alice.page.evaluate(() => {
    const cb = document.getElementById("connBanner");
    const lb = document.getElementById("localBadge");
    const cbStyle = getComputedStyle(cb);
    const lbRect = lb.getBoundingClientRect();
    return {
      connHidden: cb.hasAttribute("hidden"),
      connOffsetParentNull: cb.offsetParent === null,
      connDisplay: cbStyle.display,
      // position:fixed elements ALWAYS report offsetParent === null per spec, whether
      // visible or not — offsetParent can't distinguish localBadge's shown/hidden state.
      // display + a non-zero box can.
      localBadgeDisplay: getComputedStyle(lb).display,
      localBadgeVisible: getComputedStyle(lb).display !== "none" && lbRect.width > 0 && lbRect.height > 0,
    };
  });
  ok(geom.connOffsetParentNull, "connBanner (hidden, connected) has offsetParent === null");
  ok(geom.connDisplay === "none", "…and getComputedStyle(connBanner).display === 'none' — [hidden] really hides it");
  ok(geom.localBadgeVisible, `localBadge IS visible in local mode (display ${geom.localBadgeDisplay})`);

  // END ROOM
  await clickSel(host.page, "#endBtn");
  await settle(host.page, 400);
  const roomGone = await host.page.evaluate((code) => localStorage.getItem("quiz_local_room_" + code) == null, CODE);
  ok(roomGone, "ending the room removes its key from localStorage");
  await Promise.all([
    alice.page.waitForFunction(() => /Quiz ended/.test(document.body.textContent), { timeout: 10000 }),
    bob.page.waitForFunction(() => /Quiz ended/.test(document.body.textContent), { timeout: 10000 }),
  ]);
  ok(true, "player pages show \"Quiz ended\"");

  const allErrors = host.errors.concat(alice.errors, bob.errors);
  ok(allErrors.length === 0, "no unexpected page errors" + (allErrors.length ? ": " + allErrors[0] : ""));
}

async function sectionLayout(browser) {
  section("C. Layout smoke — player page at 390x844");
  const host = await newPage(browser, { viewport: { width: 1280, height: 900 }, pid: "layouthost1" });
  await host.page.goto(BASE + "/quiz.html?host=1&local=1&fixture=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await host.page.waitForSelector("#hostPw", { timeout: 10000 });
  await host.page.type("#hostPw", "x");
  await clickSel(host.page, "#hostGateBtn");
  await host.page.waitForSelector("#genBtn", { timeout: 10000 });
  await clickSel(host.page, "#genBtn");
  await host.page.waitForSelector("#openLobbyBtn", { timeout: 10000 });
  await clickSel(host.page, "#openLobbyBtn");
  await host.page.waitForSelector(".roomCode", { timeout: 10000 });
  const CODE = (await host.page.evaluate(() => window.__QUIZ__.state())).roomCode;

  const p = await newPage(browser, { ctx: host.context, pid: "layoutplyr1" });
  await p.page.goto(BASE + "/quiz.html?room=" + CODE + "&local=1", { waitUntil: "domcontentloaded", timeout: 30000 });
  await p.page.waitForSelector("#joinName", { timeout: 10000 });
  await p.page.type("#joinName", "Chip");
  await clickSel(p.page, "#joinBtn");
  await p.page.waitForSelector(".pStage", { timeout: 10000 });

  await clickSel(host.page, "#startBtn");
  await p.page.waitForSelector(".pOptBtn", { timeout: 10000 });
  const scrollWidth = await p.page.evaluate(() => document.documentElement.scrollWidth);
  ok(scrollWidth <= 390, `no horizontal overflow on the player question view (scrollWidth ${scrollWidth})`);

  await host.context.close();
  contexts.splice(contexts.indexOf(host.context), 1);
}

/* ============================ main ========================================= */
(async () => {
  const anthSrv = await serveAnthropic();
  const googSrv = await serveGoogle();
  const staticSrv = await serve();

  try {
    await sectionA();
  } catch (e) {
    fail++; failures.push("Section A threw: " + (e && e.stack || e));
    console.log("  ✗ FAIL Section A threw: " + (e && e.message || e));
  }

  let browser = null;
  try {
    const launchOpts = {
      headless: "new",
      protocolTimeout: 120000,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    };
    const exe = chromePath();
    if (exe) launchOpts.executablePath = exe; else launchOpts.channel = "chrome";
    browser = await puppeteer.launch(launchOpts);
    await sectionFlow(browser);
    await sectionLayout(browser);
  } catch (e) {
    fail++; failures.push("Browser sections threw: " + (e && e.stack || e));
    console.log("  ✗ FAIL Browser sections threw: " + (e && e.message || e));
  } finally {
    for (const c of contexts) { try { await c.close(); } catch {} }
    if (browser) { try { await browser.close(); } catch {} }
  }

  await new Promise((r) => anthSrv.close(r));
  await new Promise((r) => googSrv.close(r));
  await new Promise((r) => staticSrv.close(r));

  console.log("\nQUIZ: " + pass + "/" + (pass + fail) + " checks passed");
  if (fail) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log("  - " + f));
  }
  process.exit(fail ? 1 : 0);
})();
