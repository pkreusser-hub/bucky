// _verify-ffai.cjs — the fantasy-AI server modes in netlify/functions/farmgpt.mjs:
//
//   node tools/_verify-ffai.cjs
//
// mode "fantasy" (Grok lineup/waiver/question advice) + mode "ffrecap" (the weekly
// league column, generated once per finished week and Firestore-cached family-wide).
// Runs the REAL handler in process against a fake xAI (XAI_BASE_URL), a fake
// Anthropic (ANTHROPIC_BASE_URL — the degrade/fallback target), and a fake Google
// token + Firestore (FARMGPT_GOOGLE_TOKEN_URL / FARMGPT_FIRESTORE_BASE, throwaway
// RSA service account) whose :commit really APPLIES increments and honors document
// writes — so the recap cache and the w_* usage bucket are demonstrated, not assumed.
// The house pattern is _verify-storyledger.cjs section A / _verify-news.cjs A3.
"use strict";

const http = require("http");
const crypto = require("crypto");

const XAI_PORT = 8821, ANTH_PORT = 8822, GOOG_PORT = 8823;
const SECRET = "amenfarms";

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}
function section(name) { console.log("\n== " + name + " =="); }

// ---------------- fakes ----------------
const xaiReqs = [];      // every body the fake xAI was handed
const anthReqs = [];     // every body the fake Anthropic was handed
const fakeDocs = {};     // "<collection>/<id>" -> { fields } — the goog fake's doc store

const ADVICE = "**Bottom line:** bench Justin Jefferson, start De'Von Achane.\\n\\n- He is Questionable and Achane projects 13.1.";
const COLUMN = "**Week 1: the Kreussers strike first.**\\n\\nBattle Kreussers rolled 121.4-87.9 over End Zone Goats.";
function xaiSse(text) {
  return [
    'data: {"choices":[{"delta":{"role":"assistant","content":""}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"' + text + '"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":150}}\n\n',
    "data: [DONE]\n\n",
  ].join("");
}
const ANTH_SSE = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":800,"output_tokens":0}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Sonnet-fallback advice."}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":40}}\n\n',
].join("");

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => { b += c; });
    req.on("end", () => resolve(b));
  });
}

function startFakes() {
  const xai = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    let b = null; try { b = JSON.parse(raw); } catch { b = { parseError: raw }; }
    xaiReqs.push(b);
    res.setHeader("content-type", "text/event-stream");
    const sys = b && b.messages && b.messages[0] && b.messages[0].content || "";
    res.end(xaiSse(/Nerd Report/.test(sys) ? COLUMN : ADVICE));
  });
  const anth = http.createServer(async (req, res) => {
    const raw = await readBody(req);
    try { anthReqs.push(JSON.parse(raw)); } catch { anthReqs.push({ parseError: raw }); }
    res.setHeader("content-type", "text/event-stream");
    res.end(ANTH_SSE);
  });
  const goog = http.createServer(async (req, res) => {
    const url = req.url.split("?")[0];
    const raw = await readBody(req);
    res.setHeader("content-type", "application/json");
    if (url === "/token") return res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
    if (url.endsWith(":runQuery")) return res.end(JSON.stringify([]));
    if (url.endsWith(":commit")) {
      let body = null; try { body = JSON.parse(raw); } catch {}
      for (const w of ((body && body.writes) || [])) {
        if (w.update && w.update.name) fakeDocs[w.update.name.split("/documents/")[1]] = { fields: w.update.fields || {} };
        if (w.transform && w.transform.document) {
          const id = w.transform.document.split("/documents/")[1];
          const doc = fakeDocs[id] || (fakeDocs[id] = { fields: {} });
          for (const t of (w.transform.fieldTransforms || [])) {
            const prev = parseInt((doc.fields[t.fieldPath] || {}).integerValue || "0", 10) || 0;
            const add = parseInt(((t.increment || {}).integerValue) || "0", 10) || 0;
            doc.fields[t.fieldPath] = { integerValue: String(prev + add) };
          }
        }
      }
      return res.end("{}");
    }
    const docId = url.split("/documents/")[1];
    if (req.method === "GET" && docId && fakeDocs[docId]) return res.end(JSON.stringify(fakeDocs[docId]));
    res.statusCode = 404; res.end("{}");
  });
  return Promise.all([
    new Promise((r) => xai.listen(XAI_PORT, "127.0.0.1", () => r(xai))),
    new Promise((r) => anth.listen(ANTH_PORT, "127.0.0.1", () => r(anth))),
    new Promise((r) => goog.listen(GOOG_PORT, "127.0.0.1", () => r(goog))),
  ]);
}

function fakeServiceAccount() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return JSON.stringify({ client_email: "fake@test.iam.gserviceaccount.com", private_key: privateKey });
}

// A matchup shaped like sports.mjs's ff_matchup response (the client posts it verbatim).
function fixtureMatchup() {
  return {
    ok: true, leagueName: "Nerd Fantasy Football League", season: 2026, week: 2,
    familyTeamId: 1, anyProLive: true,
    matchup: {
      id: 5, winner: "",
      home: {
        teamId: 1, name: "Battle Kreussers", points: 87.4, proj: 112.6,
        roster: [
          { name: "Josh Allen", slot: "QB", starter: true, proTeam: "BUF", actual: 22.4, proj: 21.3, injury: "", game: { state: "in", detail: "8:42 - 3rd" } },
          { name: "Justin Jefferson", slot: "WR", starter: true, proTeam: "MIN", actual: 0, proj: 16.4, injury: "QUESTIONABLE", game: { state: "pre" } },
          { name: "De'Von Achane", slot: "FLEX", starter: true, proTeam: "MIA", actual: 0, proj: 13.1, injury: "", game: { state: "pre" } },
          { name: "Bijan Robinson", slot: "Bench", starter: false, proTeam: "ATL", actual: 0, proj: 14.8, injury: "", game: null },
        ],
      },
      away: {
        teamId: 2, name: "Waffle House Warriors", points: 76.2, proj: 98.1,
        roster: [{ name: "Jalen Hurts", slot: "QB", starter: true, proTeam: "PHI", actual: 19.9, proj: 20.1, injury: "", game: { state: "in" } }],
      },
    },
  };
}
const freeAgents = (n) => Array.from({ length: n }, (_, i) => ({
  name: "Free Agent " + (i + 1), pos: "RB", proTeam: "TEN", injury: "", pctOwned: 60 - i, proj: 11, seasonProj: 150,
}));
function decidedMatchups() {
  return [
    { id: 1, winner: "HOME", home: { teamId: 1, name: "Battle Kreussers", points: 121.4 }, away: { teamId: 4, name: "End Zone Goats", points: 87.9 } },
    { id: 2, winner: "AWAY", home: { teamId: 2, name: "Waffle House Warriors", points: 98.0 }, away: { teamId: 3, name: "The Goat Kids", points: 110.2 } },
    { id: 3, winner: "HOME", home: { teamId: 5, name: "Wyoming Cowboys", points: 104.6 }, away: { teamId: 6, name: "Draft Punks", points: 90.1 } },
    { id: 4, winner: "HOME", home: { teamId: 7, name: "Nails for Breakfast", points: 99.5 }, away: { teamId: 8, name: "Hay Bale Hail Marys", points: 95.2 } },
  ];
}
const standings = () => [{ name: "Battle Kreussers", wins: 1, losses: 0, pointsFor: 121.4 }];

async function main() {
  const servers = await startFakes();

  process.env.BUCKY_NOTIFY_SECRET = SECRET;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${ANTH_PORT}`;
  process.env.XAI_API_KEY = "test-xai-key";
  process.env.XAI_BASE_URL = `http://127.0.0.1:${XAI_PORT}`;
  process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${GOOG_PORT}/token`;
  process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${GOOG_PORT}/v1/projects/x/databases/(default)/documents`;
  process.env.FIREBASE_SERVICE_ACCOUNT = fakeServiceAccount();
  delete process.env.XAI_MODEL;

  const { pathToFileURL } = require("url");
  const path = require("path");
  const handler = (await import(pathToFileURL(path.join(__dirname, "..", "netlify", "functions", "farmgpt.mjs")).href)).default;

  async function call(body) {
    const req = new Request("http://localhost/.netlify/functions/farmgpt", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
      body: JSON.stringify({ secret: SECRET, ...body }),
    });
    const resp = await handler(req);
    const text = await resp.text();   // drain fully so the stream's finally{} (usage + recap save) runs
    let json = null;
    if ((resp.headers.get("content-type") || "").includes("json")) { try { json = JSON.parse(text); } catch {} }
    return { status: resp.status, text, json };
  }
  // SNAPSHOT, not a live reference — the fake's increments mutate the stored fields
  // object in place, so returning it directly would make before/after comparisons vacuous.
  const usageDoc = () => {
    const key = Object.keys(fakeDocs).find((k) => /^farmgpt_usage\/\d{4}-\d{2}-\d{2}$/.test(k));
    return key ? JSON.parse(JSON.stringify(fakeDocs[key].fields)) : {};
  };

  // ---------------- A · mode "fantasy": the wire ----------------
  section("A · mode \"fantasy\" — the Grok advice wire");

  let r = await call({ mode: "fantasy", kind: "lineup", matchup: fixtureMatchup(), freeAgents: [] });
  ok(r.status === 200 && r.text.includes("bench Justin Jefferson"), "a lineup check streams Grok's advice (200)");
  let w = xaiReqs[xaiReqs.length - 1];
  ok(!!w && w.model === "grok-4.5", "the request goes to Grok 4.5 (XAI_MODEL default)");
  const sys = w.messages && w.messages[0] || {};
  ok(sys.role === "system" && /fantasy football analyst/.test(sys.content) && /Never invent stats/.test(sys.content)
    && /name the exact bench player/.test(sys.content),
    "FANTASY_SYSTEM is stamped server-side (analyst role, invent-nothing, exact bench replacements)");
  const turn = w.messages && w.messages[1] && w.messages[1].content || "";
  ok(/MY MATCHUP/.test(turn) && turn.includes('"Justin Jefferson"') && turn.includes('"QUESTIONABLE"')
    && turn.includes('"Battle Kreussers"'),
    "the user turn is built SERVER-SIDE and carries the full matchup JSON");
  ok(/TASK: Check my starting lineup/.test(turn), "kind lineup gets the lineup TASK line");
  ok(!/BEST AVAILABLE FREE AGENTS/.test(turn), "a lineup check with no free agents sends no FA block");
  ok(w.max_tokens === 1400 && w.stream === true, "maxTokens 1400, streamed");

  r = await call({ mode: "fantasy", kind: "waivers", matchup: fixtureMatchup(), freeAgents: freeAgents(60) });
  w = xaiReqs[xaiReqs.length - 1];
  const wturn = w.messages[1].content;
  ok(/TASK: Recommend the best waiver-wire pickups/.test(wturn), "kind waivers gets the waiver TASK line");
  ok(/BEST AVAILABLE FREE AGENTS/.test(wturn) && wturn.includes("Free Agent 50") && !wturn.includes("Free Agent 51"),
    "the FA list rides along, capped at 50 (an oversized client list is sliced)");

  const longQ = "Should I trade for a running back? ".repeat(30);   // ~1000 chars
  r = await call({ mode: "fantasy", kind: "question", question: longQ, matchup: fixtureMatchup(), freeAgents: freeAgents(3) });
  w = xaiReqs[xaiReqs.length - 1];
  const qline = (w.messages[1].content.match(/QUESTION: .*/) || [""])[0];
  ok(qline.length > 0 && qline.length <= "QUESTION: ".length + 400, "a question is capped at 400 chars");
  r = await call({ mode: "fantasy", kind: "hack-the-prompt", matchup: fixtureMatchup() });
  w = xaiReqs[xaiReqs.length - 1];
  ok(/QUESTION: /.test(w.messages[1].content), "an unknown kind falls back to a plain question");

  r = await call({ mode: "fantasy", kind: "lineup" });
  ok(r.status === 400 && /Bad fantasy request/.test(r.text), "no matchup payload → 400 Bad fantasy request");
  r = await call({ mode: "fantasy", kind: "lineup", matchup: [1, 2, 3] });
  ok(r.status === 400, "an array where the matchup object belongs → 400");

  const u1 = usageDoc();
  ok(parseInt((u1.w_req || {}).integerValue || "0", 10) >= 4 && parseInt((u1.w_out || {}).integerValue || "0", 10) > 0,
    "usage lands in the w_* bucket (fantasy AI), really incremented in Firestore");
  ok(!u1.r_req && !u1.s_req, "…and NOT in research/story buckets");
  ok(Object.keys(u1).some((k) => /^w_grok45\b|^w_grok/.test(k)), "the per-model breakdown is written under w_<modelSlug>_*");

  // ---------------- B · fantasy degrade + fallback ----------------
  section("B · fantasy without Grok — degrade + outage fallback");

  delete process.env.XAI_API_KEY;
  const anthBefore = anthReqs.length;
  r = await call({ mode: "fantasy", kind: "lineup", matchup: fixtureMatchup() });
  ok(r.status === 200 && /Sonnet-fallback advice/.test(r.text), "with no XAI_API_KEY the advice degrades to Anthropic, never a 500");
  ok(anthReqs.length === anthBefore + 1 && anthReqs[anthReqs.length - 1].model === "claude-sonnet-5",
    "…on Sonnet (the quality tier for advice), with the same server-built turn");
  ok(/fantasy football analyst/.test(anthReqs[anthReqs.length - 1].system || ""), "…and the same FANTASY_SYSTEM");

  process.env.XAI_API_KEY = "test-xai-key";
  const goodXai = process.env.XAI_BASE_URL;
  process.env.XAI_BASE_URL = "http://127.0.0.1:9";   // discard port — nothing answers
  r = await call({ mode: "fantasy", kind: "lineup", matchup: fixtureMatchup() });
  ok(r.status === 200 && /Sonnet-fallback advice/.test(r.text), "a mid-request xAI outage retries once on Sonnet (200)");
  process.env.XAI_BASE_URL = goodXai;

  // ---------------- C · mode "ffrecap": generate once, cache family-wide ----------------
  section("C · mode \"ffrecap\" — the weekly column + its Firestore cache");

  r = await call({ mode: "ffrecap", season: 2026, week: 0, leagueName: "x", matchups: decidedMatchups() });
  ok(r.status === 400 && /Bad recap request/.test(r.text), "week 0 → 400 Bad recap request");
  r = await call({ mode: "ffrecap", season: 1990, week: 1, matchups: decidedMatchups() });
  ok(r.status === 400, "a nonsense season → 400");
  const undec = decidedMatchups(); undec[2].winner = "UNDECIDED";
  r = await call({ mode: "ffrecap", season: 2026, week: 1, leagueName: "Nerd", matchups: undec, standings: standings() });
  ok(r.status === 400 && /Bad recap request/.test(r.text), "a week with an UNDECIDED matchup gets no column (400)");

  const xaiBefore = xaiReqs.length;
  r = await call({ mode: "ffrecap", season: 2026, week: 1, leagueName: "Nerd Fantasy Football League",
    matchups: decidedMatchups(), standings: standings() });
  ok(r.status === 200 && /Kreussers strike first/.test(r.text), "the first device streams the generated column");
  ok(xaiReqs.length === xaiBefore + 1, "…from ONE Grok call");
  w = xaiReqs[xaiReqs.length - 1];
  ok(/Nerd Report/.test(w.messages[0].content) && /roast TEAMS, never people/.test(w.messages[0].content)
    && /Cover EVERY matchup/.test(w.messages[0].content),
    "FFRECAP_SYSTEM is stamped (columnist voice, every matchup, tease teams never people)");
  ok(/WEEK 1 FINAL RESULTS/.test(w.messages[1].content) && /SEASON STANDINGS/.test(w.messages[1].content)
    && w.messages[1].content.includes("Nails for Breakfast"),
    "the user turn carries the finished results + standings");

  const saved = fakeDocs["farmgpt_ffrecap/2026_w1"];
  ok(!!saved && /Kreussers strike first/.test((saved.fields.text || {}).stringValue || "")
    && (saved.fields.week || {}).integerValue === "1",
    "the stream's finally{} saves the column to farmgpt_ffrecap/<season>_w<week>");

  const xaiAfterGen = xaiReqs.length;
  r = await call({ mode: "ffrecap", season: 2026, week: 1, leagueName: "Nerd", matchups: decidedMatchups(), standings: standings() });
  ok(r.status === 200 && r.json && r.json.cached === true && /Kreussers strike first/.test(r.json.text),
    "every later device gets the SAVED column back as JSON {cached:true}");
  ok(xaiReqs.length === xaiAfterGen, "…with NO second model call — one generation per week, family-wide");

  const u2 = usageDoc();
  ok(parseInt((u2.w_req || {}).integerValue || "0", 10) > parseInt((u1.w_req || {}).integerValue || "0", 10),
    "the recap generation bills the same w_* bucket");

  // ---------------- D · gates ----------------
  section("D · gates");
  {
    const req = new Request("http://localhost/.netlify/functions/farmgpt", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "wrong", mode: "fantasy", kind: "lineup", matchup: fixtureMatchup() }),
    });
    const resp = await handler(req);
    ok(resp.status === 401, "a wrong family password is refused (401)");
  }

  for (const s of servers) s.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  if (fail) { console.log("FAILURES:\n  - " + failures.join("\n  - ")); process.exit(1); }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
