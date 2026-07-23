// Dungeon-mode server suite — in-process farmgpt.mjs handler vs fake Google/Firestore/Anthropic.
// Nothing here touches real services. Pattern per CLAUDE.md (recreate fake services each session).
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log("  ✓ " + name); } else { fail++; console.log("  ✗ FAIL " + name); } };

// ---------- fake service state ----------
const SECRET = "testsecret";
const PIN = "4321";
const pinHash = crypto.createHash("sha256").update(PIN + ":" + SECRET).digest("hex");
function famKey(pw) { let h = 0; for (const ch of pw.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return "fam" + h.toString(36); }
const FAM = famKey(SECRET);

const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const saPem = privateKey.export({ type: "pkcs8", format: "pem" });

const store = new Map();          // firestore docs: full name → fields
const commits = [];               // every :commit body
const runQueries = [];            // every :runQuery body
let storyLogRowsForToday = [];    // rows the fake returns for farmgpt_story_log date queries

// Seed the dadAuth doc.
const DOCBASE = "projects/amen-farms-app/databases/(default)/documents";
store.set(`${DOCBASE}/settings_${FAM}/dadAuth`, { pinHash: { stringValue: pinHash } });

// ---------- fake Google token ----------
const tokenSrv = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ access_token: "fake-token", expires_in: 3600 }));
});

// ---------- fake Firestore ----------
function readBody(req) { return new Promise((r) => { let b = ""; req.on("data", (c) => b += c); req.on("end", () => r(b)); }); }
const fsSrv = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const url = req.url.split("?")[0];
  const send = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

  if (url.endsWith(":commit")) {
    const j = JSON.parse(body);
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
      if (w.transform) { /* usage increments — recorded via commits[] only */ }
    }
    return send(200, {});
  }
  if (url.endsWith(":runQuery")) {
    const j = JSON.parse(body);
    runQueries.push(j);
    const col = j.structuredQuery?.from?.[0]?.collectionId;
    if (col === "farmgpt_story_log") {
      return send(200, storyLogRowsForToday.map((u) => ({ document: { name: `${DOCBASE}/farmgpt_story_log/x`, fields: { user: { stringValue: u } } } })));
    }
    if (col === "farmgpt_dnd") {
      const rows = [];
      for (const [name, fields] of store) {
        if (!name.includes("/farmgpt_dnd/c_")) continue;
        if (fields.kind?.stringValue !== "campaign") continue;
        rows.push({ document: { name, fields } });
      }
      return send(200, rows.length ? rows : [{}]);
    }
    return send(200, [{}]);
  }
  // plain GETs — FIRESTORE_BASE ends in .../documents, so url is /<collection>[/<doc>]
  if (req.method === "GET") {
    const rel = url.replace(/^.*documents\//, "").replace(/^\//, "");
    const parts = rel.split("/");
    if (parts.length === 1) {   // collection listing (usage dashboards, story-log list)
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
const anthropicReqs = [];
const antSrv = http.createServer(async (req, res) => {
  const body = await readBody(req);
  const j = JSON.parse(body);
  anthropicReqs.push(j);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
  ev({ type: "message_start", message: { usage: { input_tokens: 100, cache_creation_input_tokens: 5, cache_read_input_tokens: 7 } } });
  const text = j.system.includes("bookkeeper")
    ? '{"name":"Torin","hp":9,"maxHp":11,"inventory":[{"item":"torch","qty":3}]}'
    : j.system.includes("transcribe scanned pages")
    ? "PAGE TRANSCRIPT: Area 1 — two goblins (AC 15)."
    : "The goblin snarls. What do you do?\n===ROLL=== d20+2|player|Initiative";
  ev({ type: "content_block_delta", delta: { type: "text_delta", text } });
  ev({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 42 } });
  res.end();
});

// ---------- boot ----------
await new Promise((r) => tokenSrv.listen(0, "127.0.0.1", r));
await new Promise((r) => fsSrv.listen(0, "127.0.0.1", r));
await new Promise((r) => antSrv.listen(0, "127.0.0.1", r));
process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.ANTHROPIC_API_KEY = "fake-key";
process.env.FARMGPT_GOOGLE_TOKEN_URL = `http://127.0.0.1:${tokenSrv.address().port}/token`;
process.env.FARMGPT_FIRESTORE_BASE = `http://127.0.0.1:${fsSrv.address().port}/v1/${DOCBASE}`;
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${antSrv.address().port}`;
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ client_email: "t@t", private_key: saPem });
delete process.env.STORY_PROVIDER;

const handler = (await import(new URL("../netlify/functions/farmgpt.mjs", import.meta.url))).default;

async function call(body) {
  const req = new Request("http://localhost/.netlify/functions/farmgpt", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://amenfarms.netlify.app" },
    body: JSON.stringify({ secret: SECRET, ...body }),
  });
  const resp = await handler(req);
  const text = await resp.text();
  return { status: resp.status, ct: resp.headers.get("Content-Type") || "", text };
}
const lastAnt = () => anthropicReqs[anthropicReqs.length - 1];
const msgs = [{ role: "user", content: "I open the door." }];

// =====================================================================
console.log("— PIN gate —");
{
  // Fail-closed FIRST, while the warm hash cache is still cold: no dadAuth doc reachable →
  // denied even with the right PIN. (After any successful fetch the 10-min warm cache
  // legitimately serves — verification succeeded recently — so this must run before it.)
  const saved = store.get(`${DOCBASE}/settings_${FAM}/dadAuth`);
  store.delete(`${DOCBASE}/settings_${FAM}/dadAuth`);
  const r = await call({ mode: "dnd", dndPin: PIN, messages: msgs });
  ok(r.status === 403 && /unavailable|isn't set up/.test(r.text), "no stored hash + cold cache → fails CLOSED");
  store.set(`${DOCBASE}/settings_${FAM}/dadAuth`, saved);
}
{
  const r = await call({ mode: "dnd", messages: msgs });
  ok(r.status === 403 && /PIN is required/.test(r.text), "dnd without PIN → 403");
}
{
  const r = await call({ mode: "dnd", dndPin: "9999", messages: msgs });
  ok(r.status === 403 && /Wrong PIN/.test(r.text), "wrong PIN → 403");
}
{
  const r = await call({ mode: "dnd_list", dndPin: "9999" });
  ok(r.status === 403, "storage actions also PIN-gated");
}

console.log("— dnd streaming: model, prompt, no guardrails —");
{
  const before = anthropicReqs.length;
  const r = await call({ mode: "dnd", dndPin: PIN, messages: msgs });
  ok(r.status === 200 && r.text.includes("goblin snarls"), "right PIN → streams the DM reply");
  ok(anthropicReqs.length === before + 1, "model called exactly once");
  const a = lastAnt();
  ok(a.model === "claude-sonnet-5", "runs on Sonnet 5");
  ok(a.max_tokens === 3000, "max_tokens 3000");
  ok(a.stream === true && a.cache_control && a.cache_control.type === "ephemeral", "streaming + prompt caching on");
  ok(a.thinking === undefined, "adaptive thinking (no thinking field)");
  ok(a.system.includes("PLAYER AGENCY — THE ABSOLUTE RULE"), "DM contract in system prompt");
  ok(a.system.includes("NEVER invent, assume, or narrate the result of any die roll"), "real-dice contract present");
  ok(!a.system.includes("CONTENT RULES"), "FAMILY_RULES NOT stamped (guardrail-free by design)");
  ok(!a.system.includes("swear words"), "no family content-rule text anywhere in system");
}
{
  const r = await call({ mode: "dnd", dndPin: PIN, messages: msgs, dndModule: "THE MODULE BODY: Cragmaw Castle has 3 goblins." });
  const a = lastAnt();
  ok(a.system.includes("ADVENTURE MODULE — RUN THIS ADVENTURE AS WRITTEN") && a.system.includes("Cragmaw Castle has 3 goblins"), "module text appended to system");
}
{
  const big = "M".repeat(700_000);
  await call({ mode: "dnd", dndPin: PIN, messages: msgs, dndModule: big });
  const a = lastAnt();
  const modLen = a.system.length;
  ok(modLen < 620_000 + 8000, "oversized module truncated at 600k chars (system " + modLen + ")");
}

console.log("— no cap, no story log —");
{
  storyLogRowsForToday = Array(20).fill("Eleanor");   // way over the 15/day story cap
  runQueries.length = 0;
  const r = await call({ mode: "dnd", dndPin: PIN, user: "Eleanor", messages: msgs });
  ok(r.status === 200 && r.text.includes("goblin"), "dnd streams even for a capped-out identity (no daily cap)");
  ok(!runQueries.some((q) => q.structuredQuery?.from?.[0]?.collectionId === "farmgpt_story_log"), "cap counter never even queried for dnd");
  const dndLogWrites = commits.flatMap((c) => c.writes || []).filter((w) => w.update && w.update.name.includes("farmgpt_story_log"));
  ok(dndLogWrites.length === 0, "nothing written to the story log for dnd");
}
{
  // usage IS logged, under the d_ prefix
  const usage = commits.flatMap((c) => c.writes || []).filter((w) => w.transform && w.transform.document.includes("farmgpt_usage/"));
  const fields = usage.length ? usage[usage.length - 1].transform.fieldTransforms.map((t) => t.fieldPath) : [];
  ok(fields.includes("d_in") && fields.includes("d_out") && fields.includes("d_req"), "usage logged with d_* prefix");
}

console.log("— bookkeeper + journal modes —");
{
  const r = await call({ mode: "dnd_update", dndPin: PIN, messages: [{ role: "user", content: "CURRENT SHEET JSON: {}" }] });
  const a = lastAnt();
  ok(r.status === 200 && r.text.includes('"Torin"'), "dnd_update streams JSON");
  ok(a.system.includes("bookkeeper") && a.model === "claude-sonnet-5", "bookkeeper prompt on Sonnet");
  ok(a.thinking && a.thinking.type === "disabled", "bookkeeper thinking off");
  ok(a.max_tokens === 1500, "bookkeeper max_tokens 1500");
}
{
  const r = await call({ mode: "dnd_summary", dndPin: PIN, messages: [{ role: "user", content: "JOURNAL SO FAR: none" }] });
  const a = lastAnt();
  ok(r.status === 200 && a.system.includes("campaign journal") && a.max_tokens === 600, "dnd_summary mode wired");
}
{
  const r = await call({ mode: "dnd", dndPin: PIN, messages: [{ role: "assistant", content: "nope" }] });
  ok(r.status === 400, "malformed messages still rejected (sanitizer active)");
}

console.log("— campaign storage round-trip —");
{
  const mod = "A".repeat(450_000) + "B".repeat(50_000);   // 500k → 2 shards
  const campaign = { id: "t1", name: "Test Campaign", charName: "Torin",
    sheet: '{"name":"Torin"}', journal: "day 1", turns: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] };
  const r = await call({ mode: "dnd_save", dndPin: PIN, id: "t1", module: mod, campaign });
  ok(r.status === 200 && JSON.parse(r.text).saved, "dnd_save ok");
  ok(store.has(`${DOCBASE}/farmgpt_dnd/c_t1`) && store.has(`${DOCBASE}/farmgpt_dnd/m_t1_0`) && store.has(`${DOCBASE}/farmgpt_dnd/m_t1_1`), "campaign + 2 module shards written");
  const g = await call({ mode: "dnd_get", dndPin: PIN, id: "t1" });
  const gd = JSON.parse(g.text);
  ok(gd.campaign.name === "Test Campaign" && gd.campaign.turns.length === 2, "dnd_get returns campaign + turns");
  ok(gd.module.length === 500_000 && gd.module.startsWith("A") && gd.module.endsWith("B"), "module reassembled from shards exactly");
  const l = await call({ mode: "dnd_list", dndPin: PIN });
  const ld = JSON.parse(l.text);
  ok(ld.campaigns.length === 1 && ld.campaigns[0].id === "t1" && ld.campaigns[0].hasModule === true, "dnd_list shows the campaign");
  // save WITHOUT module must preserve the shard count
  const r2 = await call({ mode: "dnd_save", dndPin: PIN, id: "t1", campaign: { ...campaign, journal: "day 2" } });
  ok(r2.status === 200, "module-less re-save ok");
  const g2 = JSON.parse((await call({ mode: "dnd_get", dndPin: PIN, id: "t1" })).text);
  ok(g2.campaign.journal === "day 2" && g2.module.length === 500_000, "re-save updated fields, module untouched");
  const d = await call({ mode: "dnd_delete", dndPin: PIN, id: "t1" });
  ok(JSON.parse(d.text).deleted && !store.has(`${DOCBASE}/farmgpt_dnd/c_t1`) && !store.has(`${DOCBASE}/farmgpt_dnd/m_t1_0`), "dnd_delete removes campaign + shards");
}

console.log("— story/research regression: guardrails + cap untouched —");
{
  storyLogRowsForToday = Array(15).fill("Eleanor");
  const r = await call({ mode: "story", user: "Eleanor", storyId: "s1", messages: msgs });
  ok(r.status === 200 && r.ct.includes("json") && JSON.parse(r.text).capped === true, "story cap still fires at 15");
}
{
  storyLogRowsForToday = ["Eleanor", "Eleanor"];
  const before = commits.length;
  const r = await call({ mode: "story", user: "Eleanor", storyId: "s1", storyTitle: "T", sceneIdx: 2, messages: msgs });
  const a = lastAnt();
  ok(r.status === 200 && a.model === "claude-haiku-4-5", "story still on Haiku");
  ok(a.system.includes("CONTENT RULES") && a.system.includes("swear words"), "story still gets FAMILY_RULES");
  const logWrites = commits.slice(before).flatMap((c) => c.writes || []).filter((w) => w.update && w.update.name.includes("farmgpt_story_log"));
  ok(logWrites.length === 1, "story scene still logged to the story log");
}
{
  const r = await call({ mode: "research", messages: msgs });
  const a = lastAnt();
  ok(r.status === 200 && a.model === "claude-sonnet-5" && a.system.includes("CONTENT RULES") && a.system.includes("TUTOR"), "research unchanged (Sonnet + rules + tutor)");
}
{
  const r = await call({ mode: "stats" });
  ok(r.status === 200 && JSON.parse(r.text).days !== undefined, "stats endpoint still works");
}

console.log("— dnd_ocr (scanned-module transcription) —");
{
  const r = await call({ mode: "dnd_ocr", messages: msgs });
  ok(r.status === 403, "dnd_ocr PIN-gated like the rest");
}
{
  const imgMsg = [{ role: "user", content: [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" } },
    { type: "text", text: "Transcribe this module page completely." },
  ] }];
  const r = await call({ mode: "dnd_ocr", dndPin: PIN, messages: imgMsg });
  const a = lastAnt();
  ok(r.status === 200 && r.text.includes("PAGE TRANSCRIPT"), "dnd_ocr streams a transcript");
  ok(a.model === "claude-sonnet-5" && a.max_tokens === 3000 && a.thinking && a.thinking.type === "disabled", "Sonnet vision, 3000 tok, thinking off");
  ok(a.system.includes("transcribe scanned pages"), "OCR system prompt stamped");
  ok(Array.isArray(a.messages[0].content) && a.messages[0].content.some((b) => b.type === "image"), "image block passes the sanitizer");
  ok(!a.system.includes("CONTENT RULES"), "no family rules on OCR either");
}

console.log("— brute-force brake (last: poisons the failure counter) —");
{
  for (let i = 0; i < 8; i++) await call({ mode: "dnd", dndPin: "0000", messages: msgs });
  const r = await call({ mode: "dnd", dndPin: PIN, messages: msgs });
  ok(r.status === 403 && /Too many/.test(r.text), "8 wrong tries → even the right PIN waits");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
tokenSrv.close(); fsSrv.close(); antSrv.close();
process.exit(fail ? 1 : 0);
