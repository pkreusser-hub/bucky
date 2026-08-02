// Story Log v2 (per-user-per-day AI summaries) server suite — in-process farmgpt.mjs handler vs
// fake Google/Firestore/Anthropic. Nothing here touches real services. Pattern per CLAUDE.md /
// tools/_verify-dnd-server.mjs (real Map-backed fake Firestore so list/commit/runQuery/delete all
// behave consistently across a whole test run).
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL " + name); } };

// ---------- fixed test config ----------
const SECRET = "testsecret";
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });
const DOCBASE = "projects/amen-farms-app/databases/(default)/documents";
const STORY_LOG = "farmgpt_story_log";
const STORY_SUMMARY = "farmgpt_story_summary";

// Mirrors of the server's own tiny field helpers, for seeding the fake store directly.
const sv = (s) => ({ stringValue: String(s == null ? "" : s) });
const iv = (n) => ({ integerValue: String(n | 0) });
const av = (arr) => ({ arrayValue: { values: (arr || []).map(sv) } });
// Mirrors canonStoryUser() in farmgpt.mjs — used only to compute EXPECTED bucket names in
// assertions, never fed back into the server.
const CAP_KNOWN = ["eleanor", "grandma", "grandpa", "janae", "isaac", "john", "joy", "mom"];
function canonStoryUser(user) {
  const n = String(user == null ? "" : user).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!n) return "";
  for (const k of CAP_KNOWN) if (n.includes(k)) return k;
  return "~other";
}
function farmDate() { return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); }
function daysAgo(n) { return new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); }

// ---------- fake state ----------
const store = new Map();          // full Firestore doc name -> fields object
const commits = [];               // every :commit body
const runQueries = [];            // every :runQuery body
const summaryReqs = [];           // every NON-streaming (summarizer) Anthropic request body
const anthropicReqs = [];         // every STREAMING Anthropic request body
let summaryBehavior = "ok";       // "ok" | "badjson" | "fail" — controls the fake summarizer reply
let summaryVerdict = { about: "Default about.", prompting: "Default prompting.", flagged: false, flagNote: "" };
let commitFailFor = null;         // collection name — :commit writes touching it are forced to fail

let seedSeq = 0;
function resetAll() {
  store.clear();
  commits.length = 0; runQueries.length = 0; summaryReqs.length = 0; anthropicReqs.length = 0;
  summaryBehavior = "ok"; commitFailFor = null; seedSeq = 0;
  summaryVerdict = { about: "Default about.", prompting: "Default prompting.", flagged: false, flagNote: "" };
}
function seedScene({ date, user, storyId, title, idx, choice, scene }) {
  seedSeq++;
  const id = `scene_${seedSeq}`;
  store.set(`${DOCBASE}/${STORY_LOG}/${id}`, {
    date: sv(date), user: sv(user), storyId: sv(storyId || "s1"), title: sv(title || "Test Story"),
    idx: iv(idx), choice: sv(choice || ""), scene: sv(scene || ""), ts: sv(new Date().toISOString()),
  });
  return id;
}
function seedSummary({ date, canon, users, titles, sceneCount, storyCount, about, prompting, flagged, flagNote, partial, idOverride }) {
  const canonId = canon === "~other" ? "other" : canon;
  const id = idOverride || `${date}__${canonId}`;
  store.set(`${DOCBASE}/${STORY_SUMMARY}/${id}`, {
    date: sv(date), canon: sv(canon), users: av(users || []), titles: av(titles || []),
    sceneCount: iv(sceneCount ?? 0), storyCount: iv(storyCount ?? 0),
    about: sv(about || ""), prompting: sv(prompting || ""),
    flagged: flagged === null ? { nullValue: null } : { booleanValue: !!flagged },
    flagNote: sv(flagNote || ""), partial: { booleanValue: !!partial }, updatedAt: sv(new Date().toISOString()),
  });
  return id;
}
function sceneDocExists(id) { return store.has(`${DOCBASE}/${STORY_LOG}/${id}`); }
function summaryDocExists(dateCanonId) { return store.has(`${DOCBASE}/${STORY_SUMMARY}/${dateCanonId}`); }

const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => r(b)); });

// ---------- fake Google token ----------
const tokenSrv = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
});

// ---------- fake Firestore ----------
const fsSrv = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = req.url.split("?")[0];
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (url.endsWith(":commit")) {
    const j = JSON.parse(body);
    if (commitFailFor && (j.writes || []).some((w) => w.update && w.update.name.includes(`/${commitFailFor}/`))) {
      return send(500, { error: { message: "forced failure for test" } });
    }
    commits.push(j);
    for (const w of j.writes || []) {
      if (w.update) {
        if (w.updateMask) {
          const cur = store.get(w.update.name) || {};
          for (const f of w.updateMask.fieldPaths) if (w.update.fields[f] !== undefined) cur[f] = w.update.fields[f];
          store.set(w.update.name, cur);
        } else if (w.update.fields) store.set(w.update.name, w.update.fields);
      }
      if (w.delete) store.delete(w.delete);
      if (w.transform) {   // integer increments applied for real (story-budget grants need them)
        const cur = store.get(w.transform.document) || {};
        for (const t of w.transform.fieldTransforms || []) {
          if (t.increment && t.increment.integerValue !== undefined) {
            const prev = parseInt((cur[t.fieldPath] && cur[t.fieldPath].integerValue) || "0", 10);
            cur[t.fieldPath] = { integerValue: String(prev + parseInt(t.increment.integerValue, 10)) };
          }
        }
        store.set(w.transform.document, cur);
      }
    }
    return send(200, {});
  }
  if (url.endsWith(":runQuery")) {
    const j = JSON.parse(body);
    runQueries.push(j);
    const col = j.structuredQuery?.from?.[0]?.collectionId;
    const ff = j.structuredQuery?.where?.fieldFilter;
    const rows = [];
    for (const [name, fields] of store) {
      if (!name.includes(`/${col}/`)) continue;
      if (ff) {
        const fv = fields[ff.field.fieldPath];
        if (!fv || fv.stringValue !== ff.value.stringValue) continue;
      }
      rows.push({ document: { name, fields } });
    }
    return send(200, rows.length ? rows : [{}]);
  }
  if (req.method === "GET") {
    const rel = url.replace(/^.*documents\//, "").replace(/^\//, "");
    const parts = rel.split("/");
    if (parts.length === 1) {
      const docs = [];
      for (const [name, fields] of store) if (name.includes(`/${parts[0]}/`)) docs.push({ name, fields });
      return send(200, { documents: docs });
    }
    const full = `${DOCBASE}/${rel}`;
    const doc = store.get(full);
    if (!doc) return send(404, { error: { code: 404 } });
    return send(200, { name: full, fields: doc });
  }
  send(404, { error: "unhandled " + req.method + " " + url });
});

// ---------- fake Anthropic ----------
// Streaming (stream:true) requests come from the normal per-mode reply path — unchanged from the
// other server suites. Non-streaming requests (no `stream` field) come ONLY from the new
// storylog_summaries summarizer (callAnthropicOnce) — the system prompt is the tell.
const antSrv = http.createServer(async (req, res) => {
  const j = JSON.parse(await readBody(req));
  const isSummary = typeof j.system === "string" && j.system.includes("You write a short report FOR A PARENT");
  if (j.stream === true) {
    anthropicReqs.push(j);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const ev = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
    ev({ type: "message_start", message: { usage: { input_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
    const text = j.system.includes("LITTLE-KID SAFETY")
      ? "Bo the goat ran fast.\n\n===CHOICES===\n1. 🦆 | Say hi\n2. 🌳 | Climb\n3. 🍪 | Snack"
      : j.system.includes("TUTOR")
      ? "Let's work through a similar example first."
      : "You step into the meadow.\n\n===CHOICES===\n1. Follow the path\n2. Climb the tree\n3. Call out";
    ev({ type: "content_block_delta", delta: { type: "text_delta", text } });
    ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 30 } });
    return res.end();
  }
  // non-streaming
  summaryReqs.push(j);
  if (isSummary) {
    if (summaryBehavior === "fail") {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "forced upstream failure" } }));
    }
    const text = summaryBehavior === "badjson" ? "Sorry, I can't format that as JSON right now!" : JSON.stringify(summaryVerdict);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({
      content: [{ type: "text", text }],
      usage: { input_tokens: 500, output_tokens: 120, cache_creation_input_tokens: 4, cache_read_input_tokens: 9 },
    }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } }));
});

for (const srv of [tokenSrv, fsSrv, antSrv]) await new Promise((r) => srv.listen(0, "127.0.0.1", r));

process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = "fake-key";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${antSrv.address().port}`;
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${tokenSrv.address().port}/token`;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${fsSrv.address().port}/v1/${DOCBASE}`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@t", private_key: saPem });
delete process.env.STORY_PROVIDER; delete process.env.KID_ART_PROVIDER; delete process.env.GEMINI_API_KEY;

const handler = (await import(new URL("../netlify/functions/farmgpt.mjs", import.meta.url))).default;

async function call(body) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, ...body }),
  });
  const resp = await handler(req);
  const text = await resp.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: resp.status, ct: resp.headers.get("Content-Type") || "", text, json };
}
async function callBadSecret(body) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: "nope", ...body }),
  });
  const resp = await handler(req);
  return { status: resp.status };
}
function summariesFor(list, date, canon) { return list.filter((s) => s.date === date && s.canon === canon); }

// =====================================================================
console.log("— grouping + prompt content (pick vs write-in) + verdict round-trip —");
{
  resetAll();
  const D = daysAgo(2);
  summaryVerdict = { about: "A young explorer found a hidden cave and made friends with a shy dragon.",
    prompting: "The reader mostly picked from the offered choices, but once typed their own idea.",
    flagged: false, flagNote: "" };
  seedScene({ date: D, user: "Eleanor", storyId: "sA", title: "The Hidden Cave", idx: 0,
    choice: "A story about a dragon in a cave", scene: "Once upon a time, a cave glowed at the meadow's edge.\n\n===CHOICES===\n1. Explore the cave\n2. Talk to the dragon\n3. Run home" });
  seedScene({ date: D, user: "Eleanor", storyId: "sA", title: "The Hidden Cave", idx: 1,
    choice: "Explore the cave", scene: "You explored the cave and found glittering treasure.\n\n===CHOICES===\n1. Take the gold\n2. Leave it\n3. Call for help" });
  seedScene({ date: D, user: "Eleanor", storyId: "sA", title: "The Hidden Cave", idx: 2,
    choice: "I want to fly to the moon instead!", scene: "Suddenly you sprouted wings and soared upward.\n\n===CHOICES===\n1. Land on a cloud\n2. Keep climbing\n3. Wave at a bird" });

  const r = await call({ mode: "storylog_summaries" });
  ok(r.status === 200, "storylog_summaries returns 200");
  ok(r.json && r.json.pending === 0, "single group fully processed in one request (pending 0)");
  const rows = summariesFor(r.json.summaries, D, "eleanor");
  ok(rows.length === 1, "exactly one summary doc for this (date, canon) group");
  const row = rows[0];
  ok(row.sceneCount === 3 && row.storyCount === 1, "sceneCount/storyCount computed from the raw scenes");
  ok(JSON.stringify(row.titles) === JSON.stringify(["The Hidden Cave"]), "titles collected");
  ok(JSON.stringify(row.users) === JSON.stringify(["Eleanor"]), "users collected");
  ok(row.about === summaryVerdict.about && row.prompting === summaryVerdict.prompting, "about/prompting round-trip exactly from the model's JSON");
  ok(row.flagged === false, "flagged:false round-trips as JS false (not null/string)");
  ok(row.partial === false, "a past-date group's report is final (partial:false)");

  ok(summaryReqs.length === 1, "exactly one summarizer call for one pending group");
  const sreq = summaryReqs[0];
  ok(sreq.model === "claude-haiku-4-5", "summarizer runs on Haiku (STORY_MODEL)");
  ok(sreq.max_tokens === 600, "summarizer max_tokens 600");
  ok(/NEVER a\s+reason to flag/.test(sreq.system) && sreq.system.includes("lightsaber"), "flag rules: franchises/crossovers + fantasy combat are never flag-worthy");
  ok(sreq.system.includes("REPEATEDLY pushing") && sreq.system.includes("GRAPHIC"), "flag rules: graphic content or escalating-violence pattern IS flag-worthy");
  ok(sreq.stream === undefined, "summarizer call is non-streaming");
  ok(typeof sreq.messages[0].content === "string" && sreq.messages[0].content.includes('Reader PICKED one of the offered choices: "Explore the cave"'),
    "prompt labels a picked choice as a PICK");
  ok(sreq.messages[0].content.includes('Reader TYPED THEIR OWN IDEA (a write-in): "I want to fly to the moon instead!"'),
    "prompt labels the free-typed idea as a WRITE-IN, and quotes it");
  ok(sreq.messages[0].content.includes("The Hidden Cave"), "story title present in the prompt");

  const scene0 = store.has(`${DOCBASE}/${STORY_LOG}/scene_1`);
  ok(scene0, "raw scenes for the (now-summarized) past date are RETAINED (transcript archive)");

  const usage = commits.flatMap((c) => c.writes || []).filter((w) => w.transform && w.transform.document.includes("farmgpt_usage/"));
  const fields = usage.length ? usage[usage.length - 1].transform.fieldTransforms.map((t) => t.fieldPath) : [];
  ok(fields.includes("u_in") && fields.includes("u_out") && fields.includes("u_req"), "summarizer usage logged under the u_* bucket (same as continuity summaries)");
}

console.log("— flagged verdict (redirected content) round-trips with a note —");
{
  resetAll();
  const D = daysAgo(3);
  summaryVerdict = { about: "A pirate adventure on the high seas.", prompting: "Mostly picks, one write-in pushed toward a fight scene.",
    flagged: true, flagNote: 'The reader typed "make the pirate fight get really bloody" — the story redirected to a funny sword-clash instead.' };
  seedScene({ date: D, user: "Isaac", storyId: "sB", title: "Pirate's Cove", idx: 0, choice: "Pirates", scene: "The ship set sail.\n\n===CHOICES===\n1. Man the helm\n2. Check the map\n3. Nap" });
  seedScene({ date: D, user: "Isaac", storyId: "sB", title: "Pirate's Cove", idx: 1, choice: "make the pirate fight get really bloody", scene: "A rival ship appeared! Cutlasses clashed in a silly duel.\n\n===CHOICES===\n1. Disarm them\n2. Retreat\n3. Offer tea" });

  const r = await call({ mode: "storylog_summaries" });
  const row = summariesFor(r.json.summaries, D, "isaac")[0];
  ok(row.flagged === true, "flagged:true round-trips");
  ok(row.flagNote === summaryVerdict.flagNote, "flagNote round-trips verbatim, including the quoted kid prompt");
}

console.log("— rename variants merge into ONE summary (same canonical bucket) —");
{
  resetAll();
  const D = daysAgo(4);
  seedScene({ date: D, user: "Eleanor", storyId: "sC1", title: "Story One", idx: 0, choice: "A space story", scene: "Stars twinkled overhead.\n\n===CHOICES===\n1. Fly up\n2. Look around\n3. Wait" });
  seedScene({ date: D, user: "Eleanor ( :", storyId: "sC2", title: "Story Two", idx: 0, choice: "A jungle story", scene: "Vines hung low.\n\n===CHOICES===\n1. Swing\n2. Walk\n3. Climb" });

  const r = await call({ mode: "storylog_summaries" });
  const rows = summariesFor(r.json.summaries, D, "eleanor");
  ok(rows.length === 1, "both raw identities land in exactly one report, not two");
  ok(rows[0].users.includes("Eleanor") && rows[0].users.includes("Eleanor ( :"), "report lists BOTH raw names seen that day");
  ok(rows[0].storyCount === 2, "both stories counted");
  ok(summaryReqs.length === 1, "one summarizer call covers both identities together");
}

console.log("— ordering guarantee: summary write must succeed BEFORE any scene is deleted —");
{
  resetAll();
  const D = daysAgo(5);
  seedScene({ date: D, user: "Grandma", storyId: "sD", title: "Ord Test", idx: 0, choice: "seed", scene: "Scene text.\n\n===CHOICES===\n1. A\n2. B\n3. C" });
  const sceneId = "scene_1";
  commitFailFor = STORY_SUMMARY;   // force the summary doc write itself to fail

  const r1 = await call({ mode: "storylog_summaries" });
  ok(summaryReqs.length === 1, "the model WAS called (only the doc write fails)");
  ok(sceneDocExists(sceneId), "raw scene NOT deleted when the summary write failed");
  ok(summariesFor(r1.json.summaries, D, "grandma").length === 0, "no summary doc appears (write never landed)");
  ok(r1.json.pending === 1, "group still counts as pending after a failed write");

  commitFailFor = null;   // let the write through this time
  const r2 = await call({ mode: "storylog_summaries" });
  ok(sceneDocExists(sceneId), "write succeeded and the raw scene is STILL retained (transcript)");
  ok(summariesFor(r2.json.summaries, D, "grandma").length === 1, "summary now appears");
  ok(r2.json.pending === 0, "group no longer pending");
}

console.log("— today's group: partial:true, scenes intact, and the daily cap still counts them —");
{
  resetAll();
  const T = farmDate();
  for (let i = 0; i < 15; i++) {
    seedScene({ date: T, user: "Isaac", storyId: "sE", title: "Today's Saga", idx: i, choice: "go " + i, scene: "Scene " + i + ".\n\n===CHOICES===\n1. A\n2. B\n3. C" });
  }
  // Regression: the daily cap (unrelated to summaries) must still fire — it queries the SAME
  // raw farmgpt_story_log collection, which must remain intact for today.
  const capped = await call({ mode: "story", user: "Isaac", storyId: "sZ", messages: [{ role: "user", content: "continue" }] });
  ok(capped.status === 200 && capped.ct.includes("json") && capped.json.capped === true, "a 15-scene-today user is still capped (regression)");

  const r = await call({ mode: "storylog_summaries" });
  const row = summariesFor(r.json.summaries, T, "isaac")[0];
  ok(!!row, "today's group gets a report too");
  ok(row.partial === true, "today's report is marked partial (not final)");
  ok(row.sceneCount === 15, "sceneCount reflects today's scenes so far");
  let allPresent = true;
  for (let i = 1; i <= 15; i++) if (!sceneDocExists(`scene_${i}`)) allPresent = false;
  ok(allPresent, "NONE of today's raw scenes were deleted (the cap counter needs them)");

  // stable once summarized for the same scene count
  const r2 = await call({ mode: "storylog_summaries" });
  ok(r2.json.pending === 0, "no more pending work once today's report matches the current scene count");
}

console.log("— model call fails (HTTP failure): no deletion, group stays re-attemptable —");
{
  resetAll();
  const D = daysAgo(6);
  seedScene({ date: D, user: "Grandpa", storyId: "sF", title: "Fail Test", idx: 0, choice: "seed", scene: "Text.\n\n===CHOICES===\n1. A\n2. B\n3. C" });
  summaryBehavior = "fail";

  const r1 = await call({ mode: "storylog_summaries" });
  ok(summaryReqs.length === 2, "one retry allowed: exactly 2 attempts in a single request");
  ok(sceneDocExists("scene_1"), "raw scene untouched after a model failure");
  ok(r1.json.pending === 1, "a written failure-placeholder still counts as pending (not resolved)");
  const row1 = summariesFor(r1.json.summaries, D, "grandpa")[0];
  ok(row1 && row1.flagged === null, "a failure doc is written with flagged:null so the parent sees SOMETHING (not silence)");
  ok(row1.partial === true, "failure doc is never marked final");
  const usageAfterFail = commits.flatMap((c) => c.writes || []).filter((w) => w.transform && w.transform.document.includes("farmgpt_usage/"));
  ok(usageAfterFail.length === 0, "no usage logged when the HTTP call itself failed (nothing was billed)");

  summaryReqs.length = 0;
  const r2 = await call({ mode: "storylog_summaries" });
  ok(summaryReqs.length === 2, "still re-attempted (2 more calls) on a later request — never permanently gives up");
  ok(sceneDocExists("scene_1"), "still untouched");

  summaryBehavior = "ok";
  const r3 = await call({ mode: "storylog_summaries" });
  ok(sceneDocExists("scene_1"), "scene retained after the model finally succeeds (transcript)");
  const row3 = summariesFor(r3.json.summaries, D, "grandpa")[0];
  ok(row3.flagged === summaryVerdict.flagged && row3.partial === false, "final report replaces the failure doc");
}

console.log("— model replies with unparseable JSON: flagged:null, but usage WAS billed —");
{
  resetAll();
  const D = daysAgo(7);
  seedScene({ date: D, user: "Grandma", storyId: "sG", title: "Parse Fail", idx: 0, choice: "seed", scene: "Text.\n\n===CHOICES===\n1. A\n2. B\n3. C" });
  summaryBehavior = "badjson";

  const r = await call({ mode: "storylog_summaries" });
  ok(summaryReqs.length === 2, "one retry allowed on unparseable JSON too");
  ok(sceneDocExists("scene_1"), "raw scene untouched on parse failure");
  ok(r.json.pending === 1, "still counted pending despite a successfully-written failure placeholder");
  const row = summariesFor(r.json.summaries, D, "grandma")[0];
  ok(row && row.flagged === null, "parse failure also lands in the flagged:null path");
  const usage = commits.flatMap((c) => c.writes || []).filter((w) => w.transform && w.transform.document.includes("farmgpt_usage/"));
  ok(usage.length > 0, "usage IS logged — the model responded (and was billed), it just didn't parse");
}

console.log("— resting state: final summary + retained scenes → ZERO model calls, nothing deleted —");
{
  resetAll();
  const D = daysAgo(8);
  seedSummary({ date: D, canon: "eleanor", users: ["Eleanor"], titles: ["Old Story"], sceneCount: 2, storyCount: 1,
    about: "Already summarized.", prompting: "Already summarized.", flagged: false, flagNote: "", partial: false });
  seedScene({ date: D, user: "Eleanor", storyId: "sH", title: "Old Story", idx: 0, choice: "seed", scene: "leftover" });
  seedScene({ date: D, user: "Eleanor", storyId: "sH", title: "Old Story", idx: 1, choice: "seed2", scene: "leftover2" });

  const r = await call({ mode: "storylog_summaries" });
  ok(summaryReqs.length === 0, "no model call — the report already exists");
  ok(sceneDocExists("scene_1") && sceneDocExists("scene_2"), "retained scenes beside a final summary are the NORMAL resting state (not re-deleted)");
  const row = summariesFor(r.json.summaries, D, "eleanor")[0];
  ok(row.about === "Already summarized.", "the existing final report is left exactly as it was, not rewritten");
  ok(r.json.pending === 0, "resting-state group is not pending");
}

console.log("— storylog_scenes: the day's transcript for one report card —");
{
  resetAll();
  const D = daysAgo(3);
  seedSummary({ date: D, canon: "eleanor", users: ["Eleanor"], titles: ["Two Tales"], sceneCount: 3, storyCount: 2, partial: false });
  seedScene({ date: D, user: "Eleanor", storyId: "sB", title: "Second Tale", idx: 0, choice: "world B", scene: "B0" });
  seedScene({ date: D, user: "Eleanor ( :", storyId: "sA", title: "First Tale", idx: 1, choice: "go", scene: "A1" });
  seedScene({ date: D, user: "Eleanor", storyId: "sA", title: "First Tale", idx: 0, choice: "world A", scene: "A0" });
  seedScene({ date: D, user: "Isaac", storyId: "sC", title: "Not Hers", idx: 0, choice: "x", scene: "C0" });
  seedScene({ date: daysAgo(4), user: "Eleanor", storyId: "sA", title: "First Tale", idx: 2, choice: "y", scene: "WRONG DAY" });

  const r = await call({ mode: "storylog_scenes", date: D, canon: "eleanor" });
  ok(r.status === 200 && Array.isArray(r.json.scenes), "returns a scenes array");
  ok(r.json.scenes.length === 3, "exactly the (date, canon) group's scenes — got " + r.json.scenes.length);
  ok(r.json.scenes.map((s) => s.scene).join(",") === "A0,A1,B0", "sorted by story then scene index (renamed identity merged in)");
  ok(r.json.scenes.some((s) => s.user === "Eleanor ( :"), "raw identity strings preserved in the transcript");
  ok(!r.json.scenes.some((s) => s.scene === "C0" || s.scene === "WRONG DAY"), "other readers and other days excluded");
  const bad = await call({ mode: "storylog_scenes", date: D });
  ok(bad.status === 400, "missing canon → 400");
  const noAuth = await callBadSecret({ mode: "storylog_scenes", date: D, canon: "eleanor" });
  ok(noAuth.status === 401, "bad secret → 401");
}

console.log("— pending arithmetic: 7 pending groups process in batches of 3, 3, then 1 —");
{
  resetAll();
  const dates = [];
  for (let i = 10; i < 17; i++) dates.push(daysAgo(i));   // 7 distinct past dates
  for (const d of dates) seedScene({ date: d, user: "Grandma", storyId: "s_" + d, title: "T " + d, idx: 0, choice: "seed", scene: "Text.\n\n===CHOICES===\n1. A\n2. B\n3. C" });

  const r1 = await call({ mode: "storylog_summaries" });
  const doneAfter1 = dates.filter((d) => summariesFor(r1.json.summaries, d, "grandma").length === 1).length;
  ok(doneAfter1 === 3, "first request processes exactly 3 of the 7 groups (" + doneAfter1 + ")");
  ok(r1.json.pending === 4, "pending reflects the 4 groups still remaining after this request (7-3)");

  const r2 = await call({ mode: "storylog_summaries" });
  const doneAfter2 = dates.filter((d) => summariesFor(r2.json.summaries, d, "grandma").length === 1).length;
  ok(doneAfter2 === 6, "second request brings the cumulative total to 6");
  ok(r2.json.pending === 1, "1 group remains (7-6)");

  const r3 = await call({ mode: "storylog_summaries" });
  const doneAfter3 = dates.filter((d) => summariesFor(r3.json.summaries, d, "grandma").length === 1).length;
  ok(doneAfter3 === 7, "third request finishes the last group");
  ok(r3.json.pending === 0, "nothing left pending — the client's poll loop would stop here");
}

console.log("— storylog_clear removes both scenes AND summaries for a date, and only that date —");
{
  resetAll();
  const D1 = daysAgo(20), D2 = daysAgo(21);
  seedScene({ date: D1, user: "Eleanor", storyId: "sI", title: "Keep Me Gone", idx: 0, choice: "x", scene: "y" });
  seedSummary({ date: D1, canon: "eleanor", users: ["Eleanor"], titles: ["Keep Me Gone"], sceneCount: 1, storyCount: 1, partial: false });
  seedScene({ date: D2, user: "Isaac", storyId: "sJ", title: "Stay", idx: 0, choice: "x", scene: "y" });
  seedSummary({ date: D2, canon: "isaac", users: ["Isaac"], titles: ["Stay"], sceneCount: 1, storyCount: 1, partial: false });

  const r = await call({ mode: "storylog_clear", date: D1 });
  ok(r.status === 200 && r.json.cleared === 2, "clear reports 2 docs removed (1 scene + 1 summary)");
  ok(!sceneDocExists("scene_1") && !summaryDocExists(`${D1}__eleanor`), D1 + "'s scene and summary are both gone");
  ok(sceneDocExists("scene_2") && summaryDocExists(`${D2}__isaac`), "the OTHER date's docs are untouched");
}

console.log("— retention: summaries AND raw scenes both pruned past 90 days —");
{
  resetAll();
  const oldSummaryDate = daysAgo(100);
  seedSummary({ date: oldSummaryDate, canon: "eleanor", users: ["Eleanor"], titles: ["Ancient"], sceneCount: 1, storyCount: 1, partial: false });
  const oldSceneDate = daysAgo(95);
  seedScene({ date: oldSceneDate, user: "Isaac", storyId: "sK", title: "Ancient Scene", idx: 0, choice: "x", scene: "y" });

  const r = await call({ mode: "storylog_summaries" });
  ok(!summaryDocExists(`${oldSummaryDate}__eleanor`), "a summary older than 90 days is pruned");
  ok(summariesFor(r.json.summaries, oldSummaryDate, "eleanor").length === 0, "…and absent from the response");
  ok(!sceneDocExists("scene_1"), "a raw scene older than 90 days is pruned (transcript retention window)");
  ok(summaryReqs.length === 0, "the pruned scene was never summarized (no model call)");
  ok(summariesFor(r.json.summaries, oldSceneDate, "isaac").length === 0, "…and never appears as a report either");
}

console.log("— story budget: Dad's refresh grant raises today's cap —");
{
  resetAll();
  const T = farmDate();
  for (let i = 0; i < 15; i++) {
    seedScene({ date: T, user: "Isaac", storyId: "sB", title: "Budget Saga", idx: i, choice: "go " + i, scene: "Scene " + i + ".\n\n===CHOICES===\n1. A\n2. B\n3. C" });
  }
  const capped = await call({ mode: "story", user: "Isaac", storyId: "sB", messages: [{ role: "user", content: "more" }] });
  ok(capped.json && capped.json.capped === true, "15 scenes today → capped before any grant");
  const b1 = await call({ mode: "story_budget", user: "Isaac" });
  ok(b1.json.ok && b1.json.used === 15 && b1.json.cap === 15 && b1.json.capped === true, "story_budget reports used 15 / cap 15 / capped");

  const g1 = await call({ mode: "story_budget_grant" });
  ok(g1.status === 200 && g1.json.ok && g1.json.granted === 15 && g1.json.cap === 30, "grant adds a fresh 15 → cap 30");
  const b2 = await call({ mode: "story_budget", user: "Isaac" });
  ok(b2.json.used === 15 && b2.json.cap === 30 && b2.json.capped === false, "after the grant the same reader is uncapped (15/30)");
  const streamNow = await call({ mode: "story", user: "Isaac", storyId: "sB", messages: [{ role: "user", content: "more" }] });
  ok(!streamNow.ct.includes("json"), "a story request now streams instead of the capped notice");

  const g2 = await call({ mode: "story_budget_grant" });
  ok(g2.json.cap === 45, "grants stack (second tap → cap 45)");
  const dadB = await call({ mode: "story_budget", user: "Dad" });
  ok(dadB.json.ok && dadB.json.capped === false, "Dad's own budget check is always uncapped");
  const noAuth = await callBadSecret({ mode: "story_budget_grant" });
  ok(noAuth.status === 401, "grant is secret-gated (401 on bad secret)");
}

console.log("— auth —");
{
  const r = await callBadSecret({ mode: "storylog_summaries" });
  ok(r.status === 401, "storylog_summaries: wrong secret → 401");
  const r2 = await callBadSecret({ mode: "storylog_clear", date: "2020-01-01" });
  ok(r2.status === 401, "storylog_clear: wrong secret → 401");
}

console.log("— regression: story / kidstory / research / stats untouched —");
{
  resetAll();
  const r = await call({ mode: "story", user: "Eleanor", storyId: "reg1", storyTitle: "Reg", sceneIdx: 0, messages: [{ role: "user", content: "A meadow story" }] });
  ok(r.status === 200 && r.text.includes("meadow"), "story mode streams normally");
  const logWrites = commits.flatMap((c) => c.writes || []).filter((w) => w.update && w.update.name.includes(STORY_LOG));
  ok(logWrites.length === 1, "story scene still logged to farmgpt_story_log (the raw-scene pipeline is unchanged)");
}
{
  const r = await call({ mode: "kidstory", messages: [{ role: "user", content: "A goat story" }] });
  ok(r.status === 200 && r.text.includes("Bo the goat"), "kidstory mode streams normally");
}
{
  const r = await call({ mode: "research", messages: [{ role: "user", content: "help with fractions" }] });
  ok(r.status === 200 && r.text.includes("similar example"), "research mode streams normally");
}
{
  const r = await call({ mode: "stats" });
  ok(r.status === 200 && r.json.days !== undefined, "usage stats endpoint unaffected");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
tokenSrv.close(); fsSrv.close(); antSrv.close();
process.exit(fail ? 1 : 0);
