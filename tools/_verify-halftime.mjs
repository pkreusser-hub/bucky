#!/usr/bin/env node
/**
 * halftime suite — netlify/functions/halftime.mjs + halftime-background.mjs (the Scores page's
 * halftime desk: one Opus-written script per game, stored in Firestore, replayed to everyone).
 *
 *   node tools/_verify-halftime.mjs
 *   HT_FN=/path/to/broken-copy.mjs node tools/_verify-halftime.mjs   (bite-proving runs)
 *
 * Imports the function's default export and runHalftimeJob directly and calls them with real
 * `Request` objects. One local node:http server plays every upstream, shaped like the real ones:
 *   ESPN     GET  /espn/summary?event=…      the fixtures below; any other event is a 404
 *   Google   POST /token                     checks the service-account JWT's RS256 signature
 *                                            against the key it issued, as Google does
 *   Firestore GET/POST under /v1/projects/amen-farms-app/databases/(default)/documents
 *                                            a bearer token is required; a missing doc is 404
 *                                            NOT_FOUND; a commit's `currentDocument`
 *                                            precondition is honoured the way Firestore does it
 *                                            (exists:false on a doc that exists -> 409
 *                                            ALREADY_EXISTS; a stale updateTime -> 400
 *                                            FAILED_PRECONDITION), so a lost claim really loses
 *   Anthropic POST /v1/messages              records the body and headers; replies per MODE
 *   background POST /bg                      answers 202 at once and runs halftime-background's
 *                                            default export afterwards, as Netlify does
 *
 * FIXTURES:
 *   tools/fixtures/halftime/sum-401872948-half.json — the real ESPN summary of ATL @ GB (2026 wk3)
 *     cut at the half: plays and scoring plays through Q2 (17-7), status moved to STATUS_HALFTIME.
 *     Its leaders and boxscore blocks are the FULL-game ones (the real feed carries first-half
 *     numbers at halftime); the suite checks only that they pass through.
 *   tools/fixtures/sunday/sum-401872948.json — the same game's trimmed FINAL summary: not halftime,
 *     and its eight scoring plays run into Q3 and Q4, which the facts must leave out.
 * Expected values are hand-read from those files (see each check).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FN = process.env.HT_FN ? path.resolve(process.env.HT_FN) : path.join(__dirname, "..", "netlify", "functions", "halftime.mjs");
const BG = path.join(path.dirname(FN), "halftime-background.mjs");

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); } };
const section = (t) => console.log("\n=== " + t + " ===");

const HALF = fs.readFileSync(path.join(__dirname, "fixtures", "halftime", "sum-401872948-half.json"), "utf8");
const FINAL = fs.readFileSync(path.join(__dirname, "fixtures", "sunday", "sum-401872948.json"), "utf8");
// Events: 401872948 at the half; 401872949 final; the rest are the half fixture under other ids so
// each scenario gets a fresh Firestore doc.
const SUMMARY = { "401872948": HALF, "401872949": FINAL };
for (const id of ["401872950", "401872951", "401872952", "401872953", "401872954", "401872955", "401872956"]) SUMMARY[id] = HALF;
// More games for the later sections (401872957 at the half is the countdown's).
SUMMARY["401872962"] = FINAL;                 // (section "Streamed, with its token counts")
SUMMARY["401872957"] = HALF; SUMMARY["401872958"] = FINAL; SUMMARY["401872959"] = FINAL; SUMMARY["401872960"] = HALF;


const DOC_BASE = "projects/amen-farms-app/databases/(default)/documents";
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA = { client_email: "bucky@amen-farms-app.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };

// Two replays, on plays the fixture's facts carry: McKinney's interception (401872948133, notable)
// and Love's 45-yard throw to Golden (401872948472, notable), each over the line that calls for it.
const LINES = [
  { who: 0, text: "Falcons 17, Packers 7 at the half.", replay: "" }, { who: 1, text: "Penix threw a pick on the first series.", replay: "401872948133" },
  { who: 2, text: "Deablo's sack at the three turned it.", replay: "" }, { who: 3, text: "Bijan's 55-yarder set up his own score.", replay: "" },
  { who: 1, text: "Love hit Golden deep for 45.", replay: "401872948472" }, { who: 2, text: "The line has to hold up.", replay: "" },
  { who: 3, text: "Four punts and a missed field goal since.", replay: "" }, { who: 0, text: "Second half is next.", replay: "" },
];
// A postgame reply: 30 lines (more than a halftime script may have), every speaker heard.
const POST_LINES = Array.from({ length: 30 }, (_, i) => ({ who: i % 4, text: `Postgame line ${i + 1} about the final.` }));
const log = { espn: [], token: 0, badJwt: 0, fsGet: [], commits: [], model: [], bg: [] };
const docs = new Map();              // doc path -> { fields, updateTime }
let clock = 0;
let MODE = "ok";
const bgJobs = [];
let bgHandler = null;
let BG_DEAD = false;                 // the background run dies (answers 202, never writes)

const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/espn/summary") {
    const ev = u.searchParams.get("event"); log.espn.push(ev);
    return SUMMARY[ev] ? (res.writeHead(200, { "content-type": "application/json" }), res.end(SUMMARY[ev])) : send(res, 404, { code: 404, message: "not found" });
  }
  if (u.pathname === "/token") {
    const form = new URLSearchParams(await body(req));
    const [h, c, sig] = (form.get("assertion") || "").split(".");
    const good = form.get("grant_type") === "urn:ietf:params:oauth:grant-type:jwt-bearer" && sig &&
      crypto.createVerify("RSA-SHA256").update(h + "." + c).verify(publicKey, Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    if (!good) { log.badJwt++; return send(res, 400, { error: "invalid_grant" }); }
    log.token++;
    return send(res, 200, { access_token: "tok-1", expires_in: 3600, token_type: "Bearer" });
  }
  if (u.pathname.startsWith("/v1/" + DOC_BASE)) {
    if (req.headers.authorization !== "Bearer tok-1") return send(res, 401, { error: { code: 401, status: "UNAUTHENTICATED" } });
    const rest = decodeURIComponent(u.pathname.slice(("/v1/" + DOC_BASE).length));
    if (req.method === "GET") {
      const name = DOC_BASE + rest; log.fsGet.push(rest);
      const d = docs.get(name);
      return d ? send(res, 200, { name, fields: d.fields, createTime: d.createTime, updateTime: d.updateTime }) : send(res, 404, { error: { code: 404, message: `No document to update: ${name}`, status: "NOT_FOUND" } });
    }
    if (req.method === "POST" && rest === ":commit") {
      const j = JSON.parse(await body(req));
      for (const w of j.writes || []) {
        log.commits.push(w);
        const name = w.update?.name, cur = docs.get(name), pre = w.currentDocument;
        if (pre && pre.exists === false && cur) return send(res, 409, { error: { code: 409, message: "Document already exists: " + name, status: "ALREADY_EXISTS" } });
        if (pre && pre.updateTime && (!cur || cur.updateTime !== pre.updateTime)) return send(res, 400, { error: { code: 400, message: "the stored version does not match the required base version", status: "FAILED_PRECONDITION" } });
        const t = new Date(Date.UTC(2026, 8, 28, 20, 0, 0) + ++clock * 1000).toISOString().replace("Z", "123456Z");
        docs.set(name, { fields: w.update.fields, createTime: cur?.createTime || t, updateTime: t });
      }
      return send(res, 200, { writeResults: [{ updateTime: "x" }], commitTime: "x" });
    }
  }
  if (u.pathname === "/v1/messages") {
    const b = JSON.parse(await body(req));
    log.model.push({ body: b, headers: req.headers });
    // A streamed request gets the Messages API's event stream, shaped as the real one: message_start
    // (input tokens), a thinking block, pings, the text in several deltas, message_delta (stop reason,
    // output tokens), message_stop. A request that isn't streamed gets the whole message.
    const sse = (text, stop = "end_turn", err) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      const ev = (type, d) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...d })}\n\n`);
      ev("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, usage: { input_tokens: 4512, output_tokens: 2 } } });
      ev("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "" } });
      ev("ping", {});
      ev("content_block_stop", { index: 0 });
      if (err) { ev("error", { error: { type: err, message: "Overloaded" } }); return res.end(); }
      ev("content_block_start", { index: 1, content_block: { type: "text", text: "" } });
      for (let i = 0; i < text.length; i += 37) ev("content_block_delta", { index: 1, delta: { type: "text_delta", text: text.slice(i, i + 37) } });
      ev("content_block_stop", { index: 1 });
      ev("message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 2841 } });
      ev("message_stop", {});
      res.end();
    };
    const reply = (text) => b.stream ? sse(text) : send(res, 200, { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "thinking", thinking: "" }, { type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });
    if (MODE === "fallback400" && b.fallbacks) return send(res, 400, { type: "error", error: { type: "invalid_request_error", message: "fallbacks: Extra inputs are not permitted" } });
    if (MODE === "refusal") return b.stream ? sse("", "refusal") : send(res, 200, { id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null } });
    if (MODE === "overloaded") return sse("", null, "overloaded_error");
    if (MODE === "post" || (MODE === "ok" && /postgame desk/.test(b.system))) return reply(JSON.stringify({ lines: POST_LINES }));
    if (MODE === "short") return reply(JSON.stringify({ lines: LINES.slice(0, 5) }));
    if (MODE === "badjson") return reply("Here is your script!");
    return reply(JSON.stringify({ lines: LINES }));
  }
  if (u.pathname === "/bg") {
    const raw = await body(req);
    log.bg.push(JSON.parse(raw));
    res.writeHead(202); res.end();
    if (!BG_DEAD) bgJobs.push(Promise.resolve().then(() => bgHandler(new Request("http://x/bg", { method: "POST", body: raw }))));
    return;
  }
  send(res, 404, {});
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const B = `http://127.0.0.1:${srv.address().port}`;
Object.assign(process.env, {
  HALFTIME_ESPN_BASE: B + "/espn", HALFTIME_FIRESTORE_BASE: `${B}/v1/${DOC_BASE}`, HALFTIME_GOOGLE_TOKEN_URL: B + "/token",
  HALFTIME_BG_URL: B + "/bg", ANTHROPIC_BASE_URL: B, ANTHROPIC_API_KEY: "sk-test", FIREBASE_SERVICE_ACCOUNT: JSON.stringify(SA), BUCKY_NOTIFY_SECRET: "fam-secret",
});
const mod = await import(pathToFileURL(FN).href);
bgHandler = (await import(pathToFileURL(BG).href)).default;
const get = async (event) => { const r = await mod.default(new Request(`https://amenfarms.netlify.app/.netlify/functions/halftime?event=${event}`)); return { j: await r.json(), h: Object.fromEntries(r.headers) }; };
const drain = async () => { while (bgJobs.length) await bgJobs.shift(); };
const doc = (ev) => docs.get(`${DOC_BASE}/sunday_desk3/${ev}`);
const fsv = (ev, k) => { const f = doc(ev)?.fields?.[k]; return f ? f.stringValue ?? f.integerValue : undefined; };

try {
  section("Facts: the first half only, from ESPN");
  {
    const half = mod.halftimeFacts(JSON.parse(HALF)), fin = mod.halftimeFacts(JSON.parse(FINAL));
    // Hand-read: ATL (away) 17, GB (home) 7 at the half; four scoring plays in Q1-Q2.
    ok(half.away.abbr === "ATL" && half.away.score === 17 && half.home.abbr === "GB" && half.home.score === 7 && half.away.name === "Atlanta Falcons",
      `teams and the halftime score (${half.away.abbr} ${half.away.score} - ${half.home.score} ${half.home.abbr})`);
    const want = ["Christian Watson 4 Yd pass from Jordan Love (Trey Smack Kick)", "Bijan Robinson 3 Yd Rush (Nick Folk Kick)", "Nick Folk 44 Yd Field Goal", "Austin Hooper 5 Yd pass from Michael Penix Jr. (Nick Folk Kick)"];
    ok(JSON.stringify(half.scoring.map((s) => s.play)) === JSON.stringify(want) && half.scoring[3].score === "ATL 17 - 7 GB",
      `the half's four scoring plays, with the score after each (${half.scoring.map((s) => s.team + " " + s.score).join("; ")})`);
    // The final's eight scoring plays run to Q4 (Brian Robinson Jr.'s Q3 run, Golden's Q4 catch …): only the first four belong to the half.
    ok(JSON.stringify(fin.scoring.map((s) => s.play)) === JSON.stringify(want) && fin.notable.every((p) => p.q <= 2) && fin.drives.length === half.drives.length,
      `given a later summary, nothing past Q2 gets in (${fin.scoring.length} scoring plays, notable quarters ${[...new Set(fin.notable.map((p) => p.q))]}, ${fin.drives.length} drives)`);
    // Hand-read: 13 first-half drives, the first ATL's (Interception), the last ATL's (End of Half).
    ok(half.drives.length === 13 && half.drives[0].team === "ATL" && half.drives[0].result === "Interception" && half.drives[12].result === "End of Half",
      `the half's 13 drives in order (${half.drives[0].team} ${half.drives[0].result} … ${half.drives[12].result})`);
    ok(half.notable.some((p) => /INTERCEPTED by X\.McKinney/.test(p.play)) && half.notable.some((p) => /for 55 yards/.test(p.play)) && half.notable.some((p) => /sacked at GB 3/.test(p.play)),
      `the half's big plays and turnovers are there: McKinney's interception, Robinson's 55-yard run, Love sacked at the 3 (${half.notable.length} notable)`);
    ok(half.leaders.some((l) => l.team === "ATL" && l.player === "Bijan Robinson" && /CAR/.test(l.line)) && half.teamStats.GB?.["total yards"] === "328",
      `ESPN's leaders and team stats pass through (Bijan Robinson ${half.leaders.find((l) => l.player === "Bijan Robinson")?.line}; GB total yards ${half.teamStats.GB?.["total yards"]})`);
    ok(mod.atHalftime(JSON.parse(HALF)) && !mod.atHalftime(JSON.parse(FINAL)), "halftime is ESPN's STATUS_HALFTIME; a final is not");
  }

  section("The model's script, checked");
  {
    const c = mod.cleanScript;
    ok(c({ lines: LINES })?.length === 8, "eight lines, all four speakers: kept");
    ok(c({ lines: LINES.slice(0, 7) }) === null, "seven lines: rejected (under a minute's worth)");
    ok(c({ lines: LINES.map((l) => ({ ...l, who: l.who === 3 ? 1 : l.who })) }) === null, "a speaker who never speaks: rejected");
    const odd = c({ lines: [...LINES, { who: 7, text: "who?" }, { who: 2, text: "Big hit! \u{1F525}\u{1F3C8}" }, { who: 1, text: "x".repeat(400) }] });
    ok(odd && odd.length === 10 && odd[8].text === "Big hit!" && odd[9].text.length === 220 && !odd.some((l) => l.who === 7),
      `an unknown speaker dropped, emoji stripped ("${odd?.[8]?.text}"), a 400-character line clipped to ${odd?.[9]?.text.length}`);
  }

  section("Requests: only a real game at halftime, one job per game");
  {
    const bad = await get("abc");
    ok(bad.j.reason === "bad-event" && log.espn.length === 0, `a malformed event id is refused before any upstream call (${JSON.stringify(bad.j)})`);
    const fin = await get("401872949");
    ok(fin.j.reason === "not-halftime" && log.commits.length === 0 && log.bg.length === 0 && log.model.length === 0,
      `a game that isn't at halftime gets no script: nothing claimed, no job, no model call (${JSON.stringify(fin.j)})`);
    ok(log.token === 1 && log.badJwt === 0, `the Firestore token comes from a correctly signed service-account JWT (${log.token} good, ${log.badJwt} bad)`);
    const first = await get("401872948");
    const claim = log.commits[0];
    ok(first.j.pending && claim?.currentDocument?.exists === false && claim?.update?.name === `${DOC_BASE}/sunday_desk3/401872948` && fsv("401872948", "status") === "pending" && fsv("401872948", "tries") === "1",
      `the first request at halftime claims the game's doc (create-only) and says pending (${JSON.stringify(first.j)}, ${JSON.stringify(claim?.currentDocument)})`);
    ok(log.bg.length === 1 && log.bg[0].secret === "fam-secret" && log.bg[0].event === "401872948" && log.model.length === 0,
      `…and starts the background job with the server's secret, writing nothing itself (${JSON.stringify(log.bg[0])})`);
    ok(first.h["netlify-cdn-cache-control"] === "public, s-maxage=4" && first.h["netlify-vary"] === "query=event|demo|kind", `a pending answer is cached 4 s at the edge, per event (${first.h["netlify-cdn-cache-control"]}, ${first.h["netlify-vary"]})`);
    const second = await get("401872948");
    ok(second.j.pending && log.bg.length === 1 && log.commits.length === 1, `a second viewer while it's being written waits on the same job (${log.bg.length} job, ${log.commits.length} write)`);
    await drain();
    const m = log.model[0];
    ok(m && m.body.model === "claude-opus-5-5" && m.headers["x-api-key"] === "sk-test" && m.headers["anthropic-version"] === "2023-06-01",
      `the job asks Opus 5.5 (${m?.body.model})`);
    ok(m && m.body.output_config?.format?.type === "json_schema" && JSON.stringify(m.body.output_config.format.schema.properties.lines.items.properties.who.enum) === "[0,1,2,3]" && m.body.output_config.effort === "low" && !("thinking" in m.body && m.body.thinking?.type !== "adaptive") && !JSON.stringify(m.body).includes("budget_tokens"),
      `…for structured JSON lines, each by one of the four speakers, at low effort, thinking left to the model (${JSON.stringify(m?.body.output_config?.format?.type)}, effort ${m?.body.output_config?.effort})`);
    ok(m && m.body.fallbacks === "default" && m.headers["anthropic-beta"] === "server-side-fallback-2026-07-01", `…with the server-side refusal fallback on (${m?.body.fallbacks}, ${m?.headers["anthropic-beta"]})`);
    const facts = m ? JSON.parse(m.body.messages[0].content.slice(m.body.messages[0].content.indexOf("\n") + 1)) : {};
    // (RESTAGED 2026-09-28, user: "replace Dot Keene with RoboGoat, and chuck varney with Force Ghost John Madden".)
    ok(["Hal Brandt", "Force Ghost John Madden", "Moose Tillman", "RoboGoat"].every((n) => m?.body.system.includes(n)) && /about one minute/.test(m?.body.system) && /Do not invent/.test(m?.body.system),
      "…the system prompt names the four at the desk, asks for about a minute and forbids inventing anything");
    ok(facts.away?.score === 17 && facts.home?.score === 7 && facts.scoring?.length === 4 && facts.scoring[3].play.startsWith("Austin Hooper 5 Yd pass"),
      `…and the message carries the half's facts, built from ESPN on the server (${facts.away?.abbr} ${facts.away?.score}-${facts.home?.score} ${facts.home?.abbr}, ${facts.scoring?.length} scoring plays)`);
    const done = await get("401872948");
    ok(done.j.ok && JSON.stringify(done.j.lines) === JSON.stringify(LINES) && JSON.stringify(done.j.cast) === JSON.stringify(["Hal Brandt", "Force Ghost John Madden", "Moose Tillman", "RoboGoat"]) && fsv("401872948", "status") === "done",
      `once written, the script is served: the model's ${done.j.lines?.length} lines and the cast`);
    ok(done.h["netlify-cdn-cache-control"] === "public, durable, s-maxage=2592000", `…cached for good at the edge (${done.h["netlify-cdn-cache-control"]})`);
    const again = await get("401872948");
    ok(JSON.stringify(again.j.lines) === JSON.stringify(LINES) && log.model.length === 1 && log.bg.length === 1, `a revisit gets the same dialogue, with no new job or model call (${log.model.length} call)`);
  }

  section("Races, retries and failures");
  {
    const both = await Promise.all([get("401872950"), get("401872950")]);
    await drain();
    ok(both.every((r) => r.j.pending) && log.bg.filter((b) => b.event === "401872950").length === 1,
      `two phones opening the game together start ONE job (the create-only claim: ${log.bg.filter((b) => b.event === "401872950").length} job)`);
    await mod.runHalftimeJob({ secret: "wrong", event: "401872951" });
    ok(!doc("401872951") && log.model.length === 2, "the job does nothing without the server's secret");
    MODE = "fallback400";
    const n0 = log.model.length;
    await get("401872951"); await drain();
    const f = log.model.slice(n0);
    ok(f.length === 2 && f[0].body.fallbacks && !("fallbacks" in f[1].body) && !f[1].headers["anthropic-beta"] && fsv("401872951", "status") === "done",
      `if the API refuses the fallback option (400), it asks again without it and the script lands (${f.length} calls, then ${fsv("401872951", "status")})`);
    MODE = "short";
    await get("401872952"); await drain();
    ok(fsv("401872952", "status") === "failed" && JSON.parse(fsv("401872952", "payload")).error === "bad-script", `a script too short to fill the desk is not kept (${fsv("401872952", "status")}, ${fsv("401872952", "payload")})`);
    const u1 = doc("401872952").updateTime;
    const r2 = await get("401872952");
    const reclaim = log.commits.at(-1);
    ok(r2.j.pending && reclaim.currentDocument?.updateTime === u1 && fsv("401872952", "tries") === "2", `…the next viewer's request tries again, taking over only that exact failed doc (${JSON.stringify(reclaim.currentDocument)}, try ${fsv("401872952", "tries")})`);
    await drain();
    await get("401872952"); await drain();
    const bgN = log.bg.length;
    const r4 = await get("401872952");
    ok(r4.j.reason === "failed" && fsv("401872952", "tries") === "3" && log.bg.length === bgN, `…three tries at most, then it stops asking (${JSON.stringify(r4.j)} after ${fsv("401872952", "tries")} tries)`);
    MODE = "refusal";
    await get("401872953"); await drain();
    ok(fsv("401872953", "status") === "failed" && JSON.parse(fsv("401872953", "payload")).error === "refusal", `a refusal is a failed try, not a script (${fsv("401872953", "payload")})`);
    MODE = "badjson";
    await get("401872954"); await drain();
    ok(JSON.parse(fsv("401872954", "payload") || "{}").error === "bad-json", `a reply that isn't JSON is a failed try (${fsv("401872954", "payload")})`);
    MODE = "ok";
    // A job that died: its pending claim is 5 minutes old.
    BG_DEAD = true;
    await get("401872955");
    BG_DEAD = false;
    const d = doc("401872955"); d.fields.at = { integerValue: String(Date.now() - 5 * 60 * 1000) };
    const st = await get("401872955");
    ok(st.j.pending && fsv("401872955", "tries") === "2" && log.bg.filter((b) => b.event === "401872955").length === 2, `a claim stuck pending for over 4 minutes is taken over (try ${fsv("401872955", "tries")})`);
    await drain();
    const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    await get("401872956"); await drain();
    process.env.ANTHROPIC_API_KEY = key;
    ok(JSON.parse(fsv("401872956", "payload") || "{}").error === "no-key", `with no Anthropic key the try fails cleanly (${fsv("401872956", "payload")})`);
  }
  section("Demo: a finished game's first half (?demo=1)");
  {
    // 2026-09-28, user: "give me a test link" (no game at halftime to test on). The trimmed final of
    // ATL @ GB (event 401872949 here): its last Q2 play (Penix's kneel, ATL 17 - 7 GB) sets the score.
    const r = await mod.default(new Request("https://amenfarms.netlify.app/.netlify/functions/halftime?event=401872949&demo=1"));
    const j = await r.json();
    const claim = log.commits.at(-1);
    ok(j.pending && claim.update.name === `${DOC_BASE}/sunday_desk3/demo-401872949` && log.bg.at(-1).demo === true && !doc("401872949"),
      `a final gets a demo script, stored apart from any real halftime one (${claim.update.name.split("/").pop()}, demo job ${log.bg.at(-1).demo})`);
    await drain();
    const m = log.model.at(-1), facts = JSON.parse(m.body.messages[0].content.slice(m.body.messages[0].content.indexOf("\n") + 1));
    ok(facts.away.score === 17 && facts.home.score === 7 && facts.leaders.length === 0 && Object.keys(facts.teamStats).length === 0 && facts.scoring.length === 4,
      `…from the half only: the score at the break (${facts.away.score}-${facts.home.score}, the final was 35-14), no full-game leaders or team stats, the half's 4 scoring plays`);
    const d2 = await mod.default(new Request("https://amenfarms.netlify.app/.netlify/functions/halftime?event=401872949&demo=1"));
    const j2 = await d2.json();
    ok(j2.ok && JSON.stringify(j2.lines) === JSON.stringify(LINES), `…and is served like any script (${j2.lines?.length} lines)`);
    const nf = await mod.default(new Request("https://amenfarms.netlify.app/.netlify/functions/halftime?event=401872950&demo=1"));
    ok((await nf.json()).reason === "not-final", "a game still in progress gets no demo");
  }
  section("The postgame desk (?kind=post)");
  {
    // 2026-09-28, user: "ok now we need a post game version and this can be about 2 minutes long, can
    // differentiate the commentators a bit with more personality". The trimmed final (401872949):
    // eight scoring plays, the last Bijan Robinson's two-yard run with a two-point try in Q4.
    ok(mod.cleanScript({ lines: POST_LINES }, true)?.length === 30 && mod.cleanScript({ lines: LINES }, true) === null && mod.cleanScript({ lines: POST_LINES }) === null,
      "a postgame script is 16 to 40 lines (30 kept; the halftime show's 8 too few); a halftime one stays 8 to 24 (30 too many)");
    const nf = await mod.default(new Request("https://amenfarms.netlify.app/.netlify/functions/halftime?event=401872948&kind=post"));
    ok((await nf.json()).reason === "not-final", "a game at halftime gets no postgame show");
    MODE = "post";
    const r = await mod.default(new Request("https://amenfarms.netlify.app/.netlify/functions/halftime?event=401872949&kind=post"));
    const j = await r.json(), claim = log.commits.at(-1);
    ok(j.pending && claim.update.name === `${DOC_BASE}/sunday_desk3/post-401872949` && claim.currentDocument?.exists === false && log.bg.at(-1).kind === "post",
      `a final's first request claims its own postgame doc and starts a postgame job (${claim.update.name.split("/").pop()}, kind ${log.bg.at(-1).kind})`);
    await drain();
    const m = log.model.at(-1), facts = JSON.parse(m.body.messages[0].content.slice(m.body.messages[0].content.indexOf("\n") + 1));
    ok(/postgame desk/.test(m.body.system) && /about two minutes/.test(m.body.system) && /26 to 32 lines, 300 to 370 words/.test(m.body.system) && /signs the show off/.test(m.body.system) && m.body.messages[0].content.startsWith("Final facts"),
      "…asking for about two minutes on the finished game (26 to 32 lines, 300 to 370 words), the host signing off");
    const want = ["Christian Watson 4 Yd pass from Jordan Love (Trey Smack Kick)", "Bijan Robinson 3 Yd Rush (Nick Folk Kick)", "Nick Folk 44 Yd Field Goal", "Austin Hooper 5 Yd pass from Michael Penix Jr. (Nick Folk Kick)", "Brian Robinson Jr. 7 Yd Rush (Nick Folk Kick)", "Nick Folk 31 Yd Field Goal", "Matthew Golden 15 Yd pass from Jordan Love (Trey Smack Kick)", "Bijan Robinson 2 Yd Rush (Michael Penix Jr. Pass to Chris Blair for Two-Point Conversion)"];
    ok(JSON.stringify(facts.scoring.map((x) => x.play)) === JSON.stringify(want) && facts.away.score === 35 && facts.home.score === 14 && facts.notable.some((p) => p.q === 4),
      `…with the whole game's facts: the final score (${facts.away.score}-${facts.home.score}), all eight scoring plays through Q4, the late big plays`);
    const d = await (await mod.default(new Request("https://amenfarms.netlify.app/.netlify/functions/halftime?event=401872949&kind=post"))).json();
    ok(d.ok && d.lines.length === 30 && fsv("401872949", "status") === undefined, `…served to everyone after, apart from any halftime script (${d.lines?.length} lines)`);
    MODE = "ok";
  }

  section("Four voices");
  {
    // Both shows describe the same four people, each with habits of their own.
    const sys = log.model.map((x) => x.body.system);
    const half = sys.find((x) => /halftime desk/.test(x)), post = sys.find((x) => /postgame desk/.test(x));
    // RESTAGED 2026-09-28: the new cast ("replace Dot Keene with RoboGoat, and chuck varney with Force
    // Ghost John Madden"), the ghost kept kind, and the tape: two replays at halftime, three after.
    const traits = [/Hal Brandt, the host: .*pun/, /Force Ghost John Madden: the late, great coach and broadcaster, back as a glowing blue Force ghost.*keep him kind/, /Moose Tillman, former linebacker: loud.*grown-man football.*RoboGoat/, /RoboGoat: the GFFL's robot goat.*beep or whirr.*zinger/, /never the same one twice/, /Go to the tape .* "replay"/];   // (the rule's wording moved into the catchphrase pool, 2026-09-28)
    ok(!!half && !!post && traits.every((t) => t.test(half) && t.test(post)) && /Go to the tape twice/.test(half) && /Go to the tape three times/.test(post),
      "both shows give the four their own voices (the punning host, the ghost of John Madden, the loud linebacker, RoboGoat), and ask for the tape twice at halftime, three times after the game");
  }
  section("Catchphrases: a bigger list, a different handful each game");
  {
    // 2026-09-28, user: "Lets give our analysts a larger database of catch phrases, its fun for them to
    // use them every so often but if its the same one over and over it gets tiring".
    ok(mod.PHRASES.length === 4 && mod.PHRASES.every((l) => l.length === 12 && new Set(l).size === 12), `each of the four has twelve catchphrases (${mod.PHRASES.map((l) => l.length)})`);
    const a = mod.phrasePool("1-9-post"), a2 = mod.phrasePool("1-9-post"), b = mod.phrasePool("25-14-post"), c = mod.phrasePool("1-9-half");
    ok(JSON.stringify(a) === JSON.stringify(a2) && a.every((p, i) => p.length === 4 && p.every((x) => mod.PHRASES[i].includes(x))), "a game's pool is four of each person's own, the same every time for that game (so a retry asks the same)");
    ok(JSON.stringify(a) !== JSON.stringify(b) && JSON.stringify(a) !== JSON.stringify(c), "another game, or the same game's other show, gets a different pool");
    const pm = log.model.find((x) => /postgame desk/.test(x.body.system)), f = JSON.parse(pm.body.messages[0].content.slice(pm.body.messages[0].content.indexOf("\n") + 1));
    const want = mod.phrasePool(`${f.away.id}-${f.home.id}-post`);
    ok(want.every((p, i) => pm.body.system.includes(`${["Hal Brandt", "Force Ghost John Madden", "Moose Tillman", "RoboGoat"][i]}: ${p.map((x) => JSON.stringify(x)).join(", ")}`)) && /one or two of their own.*never the same one twice.*most lines have none/.test(pm.body.system),
      "the prompt offers that game's four each, to use once or twice at most, most lines without one");
  }

  section("Replays: the plays the desk goes to the tape on");
  {
    const f = mod.halftimeFacts(JSON.parse(HALF));
    // Hand-read from the fixture: Hooper's touchdown is play 4018729482018; McKinney's pick 401872948133.
    ok(f.scoring[3].id === "4018729482018" && f.notable.find((p) => /INTERCEPTED by X\.McKinney/.test(p.play))?.id === "401872948133",
      `every scoring and notable play in the facts carries its ESPN id, for the model to name (${f.scoring[3].id}, ${f.notable.find((p) => /McKinney/.test(p.play))?.id})`);
    const m = log.model.find((x) => /halftime desk/.test(x.body.system));
    ok(JSON.stringify(m?.body.output_config.format.schema.properties.lines.items.required) === '["who","text","replay"]', "every line of the model's answer says which play, if any, it is spoken over");
    const ids = new Set(["a1", "b2", "c3", "d4"]);
    const mk = (reps) => ({ lines: reps.map((r, i) => ({ who: i % 4, text: `line ${i}`, replay: r })) });
    const c = mod.cleanScript(mk(["", "a1", "a1", "", "zz", "", "b2", "b2", "b2", "b2", "", "c3", "", "d4"]), false, ids);
    ok(JSON.stringify(c.map((l) => l.replay)) === JSON.stringify(["", "a1", "a1", "", "", "", "b2", "b2", "b2", "", "", "c3", "", ""]),
      `a replay is kept only for a play in the facts, three lines at most, three replays a show (${JSON.stringify(c.map((l) => l.replay || "-"))})`);
    const served = await get("401872948");
    ok(JSON.stringify(served.j.lines.filter((l) => l.replay).map((l) => l.replay)) === '["401872948133","401872948472"]', `the stored script keeps its replays (${JSON.stringify(served.j.lines.filter((l) => l.replay).map((l) => l.replay))})`);
  }

  section("Streamed, with its token counts; a rest after three failures");
  {
    // 2026-09-28: three of the week's postgame calls threw every try (the job's error was "job"): a
    // long answer sent whole sends no headers until Opus finishes, and Node's fetch gives up after
    // 5 minutes without them. The call is streamed now.
    const m = log.model.find((x) => /postgame desk/.test(x.body.system));
    ok(m && m.body.stream === true && log.model.every((x) => x.body.stream === true), `every call is streamed (${log.model.filter((x) => x.body.stream === true).length} of ${log.model.length})`);
    const pd = JSON.parse(fsv("post-401872949", "payload") || "{}");
    ok(JSON.stringify(pd.usage) === JSON.stringify({ input_tokens: 4512, output_tokens: 2841 }), `the stream's token counts are kept with the script, for costing (${JSON.stringify(pd.usage)})`);
    const rs = !mod.readStream ? {} : mod.readStream('event: ping\ndata: {"type":"ping"}\n\nevent: message_start\ndata: {"type":"message_start","message":{"model":"claude-opus-5-5","usage":{"input_tokens":9}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{\\"a\\":"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"1}"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    ok(rs.text === '{"a":1}' && rs.stop_reason === "end_turn" && rs.model === "claude-opus-5-5" && rs.usage.input_tokens === 9 && rs.usage.output_tokens === 5,
      `the stream is folded back into one message: text deltas joined (thinking left out), stop reason, model, token counts (${JSON.stringify(rs)})`);
    MODE = "overloaded";
    await get("401872962&kind=post"); await drain();
    ok(JSON.parse(fsv("post-401872962", "payload") || "{}").error === "api-overloaded_error", `an error inside the stream is a failed try, with its type (${fsv("post-401872962", "payload")})`);
    MODE = "ok";
    const d = doc("post-401872962");
    d.fields.tries = { integerValue: "3" }; d.fields.at = { integerValue: String(Date.now() - 61 * 60 * 1000) };
    const back = await get("401872962&kind=post");
    ok(back.j.pending && fsv("post-401872962", "tries") === "1", `a game whose three tries all failed tries again after an hour's rest (${JSON.stringify(back.j)}, try ${fsv("post-401872962", "tries")})`);
    await drain();
    const held = await get("401872952");
    ok(held.j.reason === "failed" && held.j.detail === "bad-script", `inside the hour it stays failed, and says why (${JSON.stringify(held.j)})`);
  }

  section("Written on first view, at low effort, with a shared countdown");
  {
    // 2026-09-28, user: "rather than pre generating the scripts, lets go back to the script generating
    // when the first person opens the game, but it shows a post game / half time show starts soon with
    // a countdown. That way we save cost if nobody watches them but the hope is that opus 5.5 low is
    // quick". This REVERSES the same day's scheduled sweep (deskcron, every 2 minutes), whose seven
    // checks stood here: nothing is written unless someone opens the game.
    const toml = fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8");
    ok(!/deskcron/.test(toml) && !fs.existsSync(path.join(path.dirname(FN), "deskcron.mjs")) && !("sweepDesks" in mod), "no scheduled sweep: a script is written only when someone opens the game");
    ok(log.model.length > 0 && log.model.every((x) => x.body.output_config?.effort === "low" && x.body.model === "claude-opus-5-5"), `every call is Opus 5.5 at low effort (${[...new Set(log.model.map((x) => x.body.model + "/" + x.body.output_config?.effort))]})`);
    MODE = "ok";
    const t0 = Date.now();
    BG_DEAD = true;
    const first = await get("401872957&kind=half");
    BG_DEAD = false;
    const claimAt = Number(doc("401872957")?.fields?.at?.integerValue);
    const later = await get("401872957");
    ok(first.j.pending && first.j.since >= t0 && first.j.since === claimAt && later.j.pending && later.j.since === claimAt,
      `a pending answer says when the first viewer started the script, so every viewer's countdown agrees (${first.j.since - t0} ms after the request; the second viewer gets the same ${later.j.since === claimAt})`);
    await mod.runHalftimeJob({ ...log.bg.at(-1), at: Date.now() - 31000 });
    const done = await get("401872957");
    ok(done.j.ok && done.j.ms >= 31000 && done.j.ms < 60000, `…and the finished script records how long it took to write, claim to script (${done.j.ms} ms)`);
  }
} finally {
  srv.close();
}
console.log(`\nhalftime: ${pass}/${pass + fail}`);
if (fail) { console.log("Failures:\n  " + failures.join("\n  ")); process.exit(1); }
