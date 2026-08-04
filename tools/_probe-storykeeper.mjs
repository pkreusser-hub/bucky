#!/usr/bin/env node
/**
 * Story-ledger KEEPER live probe — build-order step 3's hand-tuning gate, run against a REAL model.
 *
 *   node tools/_probe-storykeeper.mjs --promo 8      # keeper-only reliability trials (cheap)
 *   node tools/_probe-storykeeper.mjs --play 20      # a real 20-turn story, every diff printed
 *   node tools/_probe-storykeeper.mjs --promo 8 --play 12
 *
 * It hosts the REAL netlify/functions/farmgpt.mjs in process, with the API key from tools/.env and
 * Firestore/Google pointed at a dead host — so nothing here touches the family's Story Log, and the
 * cap query fails open exactly as designed. It spends a few cents of Haiku.
 *
 * WHY TWO MODES.
 *   --promo isolates the KEEPER. Each trial sends the SAME fixed scene with the same ledger, so the
 *           only thing varying is the keeper's own judgement — which is the only way to get an
 *           honest promotion rate. Narrator variance would otherwise dominate the number.
 *   --play  drives the real page end to end (real narrator, real keeper, real applyLedgerDiff,
 *           real diff log) and prints every diff, because the plan's instruction for this step is
 *           literally "play 20 turns, read every diff". The tripwires below are not the gate; the
 *           printed diffs are.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const args = process.argv.slice(2);
const flagN = (name, dflt) => {
  const i = args.indexOf("--" + name);
  if (i === -1) return 0;
  const v = +args[i + 1];
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const PROMO = flagN("promo", 8);
const PLAY = flagN("play", 20);
const PORT = +((args.indexOf("--port") >= 0 && args[args.indexOf("--port") + 1]) || 8795);
const SECRET = "amenfarms";

for (const line of fs.readFileSync(path.join(ROOT, "tools/.env"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}
if (!process.env.ANTHROPIC_API_KEY) { console.error("No ANTHROPIC_API_KEY in tools/.env"); process.exit(2); }
process.env.BUCKY_NOTIFY_SECRET = SECRET;
process.env.FARMGPT_FIRESTORE_BASE = "http://127.0.0.1:9/dead";
process.env.FARMGPT_GOOGLE_TOKEN_URL = "http://127.0.0.1:9/dead";
delete process.env.STORY_PROVIDER;

const handler = (await import("file:///" + path.join(ROOT, "netlify/functions/farmgpt.mjs").replace(/\\/g, "/"))).default;

// ---------------------------------------------------------------------------
// The probe world: a small cosy mystery with ONE secret, sized so a whole scene fits on screen.
// ---------------------------------------------------------------------------
const SECRET_FACT = "the lighthouse keeper Maren is the one who has been putting out the harbour lamps";
const baseLedger = () => JSON.parse(JSON.stringify({
  meta: { title: "The Dark Lamps", universe: "original", timeline_point: "the first week of the autumn fogs",
          genre_and_tone: "cosy seaside mystery, warm and funny",
          narrative_voice: "second person, past tense", turn: 3, schema_version: 1 },
  canon: [
    { id: "C1", rule: "Nobody in Saltmere can swim; it is simply not a thing anyone here has ever learned.", source: "pack", turn: 0 },
    { id: "C2", rule: "The harbour lamps burn green, and only green.", source: "pack", turn: 0 },
  ],
  characters: [
    { id: "CH1", name: "Bramblewick", origin: "pack", role: "the harbour's lamplighter",
      physical: "short and sooty, with enormous grey eyebrows", status: "well",
      voice: "Clipped and gruff. Never uses two words where one will do. Answers questions with questions.",
      motivation: "keep every lamp on the quay burning", possessions: ["a brass tinder-hook"],
      knows: ["which lamps went dark first"], does_not_know: ["who is putting them out"],
      last_seen: { turn: 3, location: "the quay", state: "grumbling at a dark lamp" } },
    { id: "CH2", name: "Maren", origin: "pack", role: "the lighthouse keeper",
      physical: "tall, always in an oilskin coat", status: "friendly, a little too helpful",
      voice: "Warm and chatty, tells long stories that wander off the point, apologises constantly.",
      motivation: "keep ships away from the shoal", possessions: [], knows: ["everything about the lamps"], does_not_know: [],
      last_seen: { turn: 2, location: "the lighthouse steps", state: "offering to help" } },
    { id: "CH3", name: "Wren", origin: "reader", role: "the hero of this story — the reader's own character",
      status: "curious", physical: "", voice: "", motivation: "find out why the lamps keep going dark",
      possessions: ["a cracked lantern"], knows: [], does_not_know: [],
      last_seen: { turn: 3, location: "the quay", state: "" } },
  ],
  locations: [
    { id: "L1", name: "Saltmere quay", description: "a crooked stone harbour lined with green lamps", state: "half-dark", visited_turns: [1, 2, 3] },
    { id: "L2", name: "the lighthouse", description: "white, peeling, at the end of the shoal path", state: "lit", visited_turns: [2] },
  ],
  protagonist: { name: "Wren", inventory: [{ item: "a cracked lantern", acquired_turn: 1, notes: "" }],
                 conditions: [], abilities: [], reputation: { quay: "new here" } },
  relationships: [
    { id: "R1", between: ["Bramblewick", "Wren"], state: "prickly but warming", changed_turn: 3, history: "he lent you the lantern" },
    { id: "R2", between: ["Maren", "Wren"], state: "friendly on the surface", changed_turn: 2, history: "she offered to help before you asked" },
  ],
  player_knowledge: {
    known: ["three lamps on the quay have gone dark this week"],
    suspected: ["someone is putting the lamps out on purpose"],
    hidden_from_player: [SECRET_FACT],
  },
  open_threads: [{ id: "T1", thread: "who is putting out the harbour lamps", opened_turn: 1, status: "unresolved", urgency: "slow burn" }],
  flags: { lampsOut: 3 },
  timeline: [{ turn: 1, event: "arrived at Saltmere" }, { turn: 2, event: "met Maren at the lighthouse" }],
}));

// ---------------------------------------------------------------------------
// The server, in process (static files + the real function).
// ---------------------------------------------------------------------------
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json",
               ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer(async (req, res) => {
      if (req.url.startsWith("/.netlify/functions/farmgpt")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const fReq = new Request("http://localhost" + req.url, {
          method: req.method, headers: req.headers,
          body: req.method === "GET" ? undefined : Buffer.concat(chunks).toString("utf8"),
        });
        const out = await handler(fReq, {});
        res.writeHead(out.status, Object.fromEntries(out.headers));
        if (out.body) {
          const rd = out.body.getReader();
          for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(Buffer.from(value)); }
        }
        return res.end();
      }
      const p = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(ROOT, p === "/" ? "index.html" : p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.statusCode = 404; return res.end("not found");
      }
      res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

const post = async (body) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/.netlify/functions/farmgpt`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret: SECRET, ...body }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " — " + (await r.text()).slice(0, 200));
  return await r.text();
};
function parseKeeperJSON(raw) {
  if (typeof raw !== "string") return null;
  let t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a === -1 || b <= a) return null;
  try { const v = JSON.parse(t.slice(a, b + 1)); return v && typeof v === "object" && !Array.isArray(v) ? v : null; }
  catch { return null; }
}
const bar = (t) => console.log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78));

// ---------------------------------------------------------------------------
// MODE 1 — keeper-only reliability. Same scene every trial; only the keeper varies.
// ---------------------------------------------------------------------------
const FIXTURES = [
  {
    name: "INTERROGATION → suspected",
    why: "The reader accuses Maren to her face and the scene gives them real reason to wonder. The\n" +
         "     keeper must move the secret HIDDEN → SUSPECTED. Promoting straight to KNOWN is WRONG:\n" +
         "     nothing was confirmed. Leaving it hidden is the failure this whole step exists to fix.",
    want: "suspected",
    seen: ["CH2", "CH3"],
    choice: "Ask Maren straight out: is she the one putting out the lamps?",
    scene: `You planted your boots on the lighthouse steps and asked her outright.

"Maren. Are you the one putting the lamps out?"

For a moment the wind was the loudest thing on the shoal path. Maren's hands went still on the coil
of rope in her lap — completely still, the way a bird goes still when a shadow crosses it — and then
she laughed, a beat too late, and went on winding.

"Oh — oh, goodness. What a thing to ask." She smiled at the rope rather than at you. "You know, my
grandmother used to say the fog itself pinched them out, and she'd have told you so for an hour if
you let her, and honestly I've never been sure she was wrong—"

"Maren."

"—and it IS a terrible week for wicks." She stood up rather quickly, and brushed nothing off her
oilskin coat, and did not answer.`,
  },
  {
    name: "REVEAL → known",
    why: "The scene states it plainly on the page. The keeper must move it to KNOWN. Recording only\n" +
         "     'suspected' here would leave the storyteller hiding something the reader just watched.",
    want: "known",
    seen: ["CH2", "CH3"],
    choice: "Wait for her to say it.",
    scene: `Maren sat down on the step, all at once, like a sail losing its wind.

"It was me," she said. "Every lamp. I've been going out at dusk and pinching them out one by one."

She said it plainly, without a story wrapped round it for once, and looked at the cracked lantern in
your hands rather than at your face.

"You may as well know the whole of it. I've been doing it since the fogs came in."`,
  },
  {
    name: "NOTHING → leave it alone",
    why: "An ordinary scene that touches the secret not at all. The keeper must NOT promote — a\n" +
         "     keeper that promotes on any scene mentioning the suspect is useless.",
    want: "none",
    seen: ["CH1", "CH3"],
    choice: "Look at the wick of the third lamp.",
    scene: `The third lamp's wick was cut clean through, a neat little diagonal, as though someone had done
it thoughtfully and taken their time.

Bramblewick came up behind you and looked at it over your shoulder for a while.

"Hm," he said.

"Does that mean something?"

"You tell me."`,
  },
  {
    name: "SEARCH (physical clue, nobody present) → suspected",
    why: "The harder half of the promotion rule: the reader INVESTIGATED toward the fact and found\n" +
         "     real evidence, but nobody said anything and nobody was caught. That earns suspicion —\n" +
         "     it does not earn certainty, and it is the case a keeper is most likely to skip because\n" +
         "     no one on the page names the secret out loud.",
    want: "suspected",
    seen: ["CH3"],
    choice: "Search the lighthouse store-room while Maren is up the stairs.",
    scene: `The store-room smelled of tar and cold stone. You went along the shelf with the lantern held low.

Rope. A tin of grease. A folded chart with the shoal marked in three different hands.

And, pushed to the back behind the tin, a pair of long black wick-snuffers — the sort a lamplighter
carries — with a rime of green wax on the cup of them. Fresh wax. The harbour lamps burn green, and
only green.

Above you, somewhere up the spiral, Maren was still talking cheerfully to nobody in particular.`,
  },
  {
    name: "WRONG SUSPECT → leave it alone",
    why: "The reader accuses the wrong person, at length. A keeper that treats any accusation as\n" +
         "     evidence would promote the Maren secret here, which would be a lie about what the\n" +
         "     reader has earned.",
    want: "none",
    seen: ["CH1", "CH3"],
    choice: "Accuse Bramblewick — tell him you think HE has been putting the lamps out.",
    scene: `"It's you," you said. "You put them out and light them again in the morning so everyone thanks you."

Bramblewick's eyebrows came down so far they very nearly met his moustache. He turned the brass hook
over once in his hand, and then handed it to you, handle first.

"Go on then," he said. "Pinch one."

You looked at the hook. You looked at the lamp, which was three feet over your head and burning
perfectly well.

"That's what I thought," he said, and took it back.`,
  },
];

// A second, smaller battery for the three defects the 20-turn playthrough surfaced. Each one was a
// real diff read by hand off the first live run, not an invented worry.
const HABITS = [
  {
    name: "a reader QUESTION mints no canon",
    why: "The live run recorded [C6] \"Wren asked Maren directly if she is putting out the lamps\"\n" +
         "     as permanent world canon, source \"reader\". A question is not an assertion, and canon\n" +
         "     is append-only — every one of these is permanent.",
    assert: true,
    choice: "Ask Maren straight out: is she the one putting out the lamps?",
    scene: `"Maren. Are you the one putting the lamps out?"

She laughed a beat too late, and went on winding her rope, and did not answer.`,
    score: (d) => (((d.add || {}).canon || []).length === 0),
    what: "canon entries added (want 0)",
    got: (d) => String((((d.add || {}).canon) || []).length),
  },
  {
    name: "a reader ACTION mints no canon",
    why: "The same rule as the question case, and the one that survived the first tightening: a\n" +
         "     live run recorded [C3] \"Wren walks from the quay to the lighthouse via the shoal\n" +
         "     path\" as a permanent RULE OF THE WORLD, from a write-in that just said where to go.",
    assert: true,
    choice: "Walk out to the lighthouse and knock on Maren's door.",
    scene: `The shoal path was slick underfoot, and the lighthouse door was older than you expected.

You knocked. After a moment, Maren opened it, already apologising for the state of the place.`,
    score: (d) => (((d.add || {}).canon || []).length === 0),
    what: "canon entries added (want 0)",
    got: (d) => JSON.stringify((((d.add || {}).canon) || []).map((c) => c && c.rule)).slice(0, 120),
  },
  {
    name: "a reader STATEMENT does mint canon",
    why: "The other half of the same rule — tightening 'a question is not an assertion' must not\n" +
         "     cost the feature the user actually asked for.",
    assert: true,
    choice: "My cracked lantern was my grandmother's, and it only ever burns blue.",
    scene: `You held the cracked lantern up, and its blue flame leaned in the wind.

Bramblewick looked at it for a long moment. "Hm," he said.`,
    score: (d) => (((d.add || {}).canon || []).some((c) => c && c.source === "reader" && /blue/i.test(c.rule || ""))),
    what: "a reader-sourced canon rule about the blue flame",
    got: (d) => JSON.stringify(((d.add || {}).canon || []).map((c) => c && c.source)),
  },
  {
    name: "a denial is not a fact",
    why: "The live run wrote \"Maren is not the one putting out the lamps\" into KNOWN while that\n" +
         "     very fact was still on the HIDDEN list — the ledger contradicting itself, from a\n" +
         "     character's denial. A suspect's word is a claim.",
    assert: false,
    choice: "Ask her again.",
    scene: `"It isn't me," Maren said. "It has never been me. I walk the quay at night because I worry about
it, that's all. I've been trying to catch whoever it is."

She said it very steadily, and looked you right in the eye while she said it.`,
    score: (d) => {
      const k = ((d.add || {}).player_knowledge || {}).known || [];
      return !k.some((s) => /maren\b[^.]{0,40}(is not|isn't|not the one|innocent)/i.test(String(s)));
    },
    what: "no 'Maren is innocent' written into known",
    got: (d) => JSON.stringify((((d.add || {}).player_knowledge || {}).known) || []).slice(0, 120),
  },
  {
    name: "known stays short",
    why: "The live run added five known facts on a single ordinary scene and had 35 by turn 9 —\n" +
         "     every one of them re-read on every later scene, for the rest of the story.",
    assert: false,
    choice: "Ask him how many lamps he lights each evening.",
    scene: `"Fifteen," said Bramblewick. "Twelve on the quay. One at the south breakwater. One by the fish
market. And the tower."

He said it the way a man recites something he has said ten thousand times, and the fog moved past
the lamp behind him, and a gull complained somewhere out on the water.

"And how many are dark?"

"Three." He looked at the nearest one. "Nine burning. Rest are fine."`,
    score: (d) => ((((d.add || {}).player_knowledge || {}).known) || []).length <= 2,
    what: "at most 2 new known facts",
    got: (d) => String(((((d.add || {}).player_knowledge || {}).known) || []).length),
  },
];

async function modeHabits(n) {
  bar(`KEEPER HABITS — ${n} trials per fixture, ${HABITS.length} fixtures\n` +
      `Every one of these is a defect read off a real 20-turn playthrough, not an invented worry.`);
  let tot = 0, totN = 0;
  for (const f of HABITS) {
    console.log(`\n--- ${f.name} ---\n     ${f.why}`);
    let right = 0; const misses = [];
    for (let i = 0; i < n; i++) {
      let diff = null;
      try {
        diff = parseKeeperJSON(await post({
          mode: "ledger", ledger: baseLedger(), scene: f.scene, choice: f.choice,
          readerAssert: f.assert, turn: 4,
        }));
      } catch { /* counted as a miss below */ }
      const good = diff ? !!f.score(diff) : false;
      if (good) right++; else misses.push(diff ? f.got(diff) : "unparseable");
      process.stdout.write(good ? "·" : "✗");
    }
    console.log(`\n     ${right}/${n} — ${f.what}` + (misses.length ? `\n     got: ${misses.join(" | ")}` : ""));
    tot += right; totN += n;
  }
  console.log(`\n  HABITS ${tot}/${totN}  (failure rate ${(100 * (1 - tot / totN)).toFixed(0)}%)`);
  return { tot, totN };
}

async function modePromo(n) {
  bar(`KEEPER RELIABILITY — ${n} trials per fixture, ${FIXTURES.length} fixtures\n` +
      `Same scene every trial, so the only thing varying is the keeper's own judgement.`);
  const results = [];
  for (const f of FIXTURES) {
    console.log(`\n--- ${f.name} ---\n     ${f.why}`);
    let right = 0, wrong = [], seenRight = 0, badId = 0;
    for (let i = 0; i < n; i++) {
      let diff = null, err = "";
      try {
        diff = parseKeeperJSON(await post({
          mode: "ledger", ledger: baseLedger(), scene: f.scene, choice: f.choice, turn: 4,
        }));
      } catch (e) { err = String((e && e.message) || e); }
      if (!diff) { wrong.push(err || "unparseable"); process.stdout.write("✗"); continue; }
      // The OTHER most-missed update: last_seen for everyone who was on the page.
      const upd = (diff.update || {}).characters || [];
      const known = new Set(baseLedger().characters.map((c) => c.id));
      for (const u of upd) if (!u || !known.has(u.id)) badId++;
      if ((f.seen || []).every((id) => upd.some((u) => u && u.id === id && u.last_seen))) seenRight++;
      const promos = Array.isArray(diff.promote_knowledge) ? diff.promote_knowledge : [];
      const mine = promos.filter((p) => p && typeof p.fact === "string" &&
        p.fact.toLowerCase().includes("maren"));
      const addedKnown = ((diff.add || {}).player_knowledge || {}).known || [];
      const addedSusp = ((diff.add || {}).player_knowledge || {}).suspected || [];
      const leak = (arr) => arr.some((s) => typeof s === "string" && /maren[^.]{0,60}(putting|put|snuff|extinguish)/i.test(s));
      let got = "none";
      if (mine.length) got = mine[0].to;
      else if (leak(addedKnown)) got = "known(via add)";
      else if (leak(addedSusp)) got = "suspected(via add)";
      const okTrial = f.want === "none"
        ? got === "none"
        : got === f.want || got === f.want + "(via add)";
      if (okTrial) right++; else wrong.push(got + (mine[0] ? ` — "${String(mine[0].fact).slice(0, 60)}…"` : ""));
      process.stdout.write(okTrial ? "·" : "✗");
    }
    console.log(`\n     promotion ${right}/${n}` +
      `   ·   last_seen for everyone on stage ${seenRight}/${n}` +
      `   ·   invented ids ${badId}` +
      (wrong.length ? `\n     misses: ${wrong.join(" | ")}` : ""));
    results.push({ name: f.name, right, seenRight, badId, n });
  }
  console.log("\nSUMMARY");
  let tot = 0, totN = 0, seenTot = 0, ids = 0;
  for (const r of results) {
    console.log(`  promotion ${r.right}/${r.n} · last_seen ${r.seenRight}/${r.n}   ${r.name}`);
    tot += r.right; totN += r.n; seenTot += r.seenRight; ids += r.badId;
  }
  console.log(`  PROMOTION ${tot}/${totN}  (failure rate ${(100 * (1 - tot / totN)).toFixed(0)}%)`);
  console.log(`  LAST_SEEN  ${seenTot}/${totN}  (failure rate ${(100 * (1 - seenTot / totN)).toFixed(0)}%)`);
  console.log(`  INVENTED IDS ${ids} (any of these would throw a whole diff away)`);
  return { tot, totN, seenTot, ids };
}

// ---------------------------------------------------------------------------
// MODE 2 — a real playthrough in the real page. Every diff printed, by hand, to be read.
// ---------------------------------------------------------------------------
const TURNS = [
  { pick: 1 },
  { pick: 2 },
  { write: "Ask Bramblewick who else is out on the quay after dark." },
  { pick: 1 },
  { pick: 3 },
  { write: "Walk out to the lighthouse and knock on Maren's door." },
  { pick: 1 },
  { write: "Ask Maren straight out: is she the one putting out the lamps?" },
  { pick: 2 },
  { write: "My cracked lantern was my grandmother's, and it only ever burns blue." },
  { pick: 1 },
  { pick: 2 },
  { redo: "Bramblewick has a wooden leg — he always has, since before I got here." },
  { pick: 1 },
  { write: "Tell Bramblewick what Maren said on the steps." },
  { pick: 3 },
  { pick: 1 },
  { write: "Go back to the lighthouse at dusk and wait to see who comes." },
  { pick: 1 },
  { pick: 2 },
];

async function modePlay(n) {
  // puppeteer-core here is CommonJS (the house convention — see the tools/_verify-*.cjs suites).
  const { createRequire } = await import("node:module");
  const puppeteer = createRequire(path.join(ROOT, "tools/x.cjs"))("puppeteer-core");
  bar(`A REAL ${n}-TURN STORY — real narrator, real keeper, real diff log.\n` +
      `Every diff is printed. Read them: that is the gate, not the tripwires at the end.`);
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/cdn\.jsdelivr\.net/.test(url)) {
      return req.respond({ status: 200, contentType: "text/javascript",
        body: "window.marked={setOptions(){},parse:(s)=>String(s)};window.DOMPurify={sanitize:(s)=>String(s)};window.katex={};window.renderMathInElement=function(){};" });
    }
    if (/googleapis|firestore|firebase|gstatic/.test(url)) return req.abort();
    if (url.startsWith(`http://127.0.0.1:${PORT}`)) return req.continue();
    return req.abort();
  });
  await page.goto(`http://127.0.0.1:${PORT}/farmgpt.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("!!window.__STORY__", { timeout: 15000 });

  // THE PROBE IS DAD. Not decoration: STORY_DAILY_CAP is 15, the client counts every scene it
  // renders, and a 20-turn run therefore walks into the cap notice at turn 16 and stops dead —
  // which is the cap working correctly and cost three runs before it was recognised. Only the
  // exact string "Dad" is exempt, client and server both. (The probe still sends no `user` on the
  // wire, so the server counts and logs nothing either way.)
  await page.evaluate(() => {
    localStorage.setItem("choreUser", "Dad");
    localStorage.removeItem("farmgpt_story_count_v1");
  });
  // Seed the story straight into the page with the probe world, then let the real machinery run.
  await page.evaluate((led) => {
    window.__STORY__.setStory({
      id: "probe", title: "The Dark Lamps", created: Date.now(), done: false, chapter: 1, closing: false,
      schemaVersion: 1, ledger: led, ledgerDiffs: [{ scene: 0, diff: null, ok: false, reason: "seeded" }],
      messages: [
        { role: "user", content: "A cosy seaside mystery in the little harbour town of Saltmere, where the lamps keep going dark. My name is Wren." },
        { role: "assistant", content: "The third lamp went out just as you reached it.\n\nBramblewick was already there, brass hook in hand, eyebrows drawn down like a pair of storm clouds. He did not look up.\n\n\"You,\" he said. \"Again.\"\n\n===CHOICES===\n1. Ask him which lamp went dark first.\n2. Take the cracked lantern out and look at the wick.\n3. Walk out along the quay toward the lighthouse." },
      ],
    });
    document.getElementById("viewStory").classList.add("on");
  }, baseLedger());

  const stats = { scenes: 0, applied: 0, failed: 0, promos: [], readerCanon: [], leak: [] };
  for (let t = 0; t < Math.min(n, TURNS.length); t++) {
    const spec = TURNS[t];
    const before = await page.evaluate(() => JSON.stringify(window.__STORY__.story.ledger));
    const idx = await page.evaluate(() => window.__STORY__.story.messages.filter((m) => m.role === "assistant").length);
    let label = "";
    // A chapter can close under the reader at any point (CHAPTER_HARD_WORDS), and when it does the
    // page shows "Read the next chapter →" instead of choices. That IS the turn — an earlier
    // version of this probe tried to tap a choice button that wasn't there and stalled twice at
    // exactly turn 16, which is where a chapter reliably ends on this world.
    const atChapterEnd = await page.evaluate(() =>
      getComputedStyle(document.getElementById("chapterEndRow")).display !== "none");
    if (atChapterEnd && spec.redo === undefined) {
      label = "NEXT CHAPTER  (the chapter closed)";
      await page.evaluate(() => document.getElementById("nextChapterBtn").click());
    } else if (spec.redo !== undefined) {
      label = `REDO  note: "${spec.redo}"`;
      await page.evaluate((note) => window.__STORY__.redoScene(note), spec.redo);
    } else if (spec.write) {
      label = `WRITE-IN  "${spec.write}"`;
      await page.evaluate((v) => window.__STORY__.takeTurn(v, { writeIn: true }), spec.write);
    } else {
      // Tap the real button when the page has painted one. The seeded first turn has no buttons yet
      // (the story was injected rather than streamed), so that one turn reads its choices out of the
      // last scene's own text and goes through takeTurn — the same path a tap ends up on.
      const res = await page.evaluate((want) => {
        const btns = [...document.querySelectorAll("#choiceBtns .choiceBtn")];
        if (btns.length) {
          const i = Math.min(want, btns.length) - 1;
          const t = btns[i].textContent.replace(/^\d+\./, "").trim();
          btns[i].click();
          return { via: "tap", text: t };
        }
        const s = window.__STORY__.story;
        const last = s.messages[s.messages.length - 1].content;
        const lines = last.split("===CHOICES===")[1] || "";
        const opts = lines.split("\n").map((l) => l.trim()).filter((l) => /^\d+\.\s+\S/.test(l))
          .map((l) => l.replace(/^\d+\.\s*/, ""));
        const t = opts[Math.min(want, opts.length) - 1] || "Look around.";
        window.__STORY__.takeTurn(t);
        return { via: "seeded", text: t };
      }, spec.pick);
      label = `CHOICE ${spec.pick}  ${res.text}`;
    }
    const targetIdx = spec.redo !== undefined ? idx - 1 : idx;
    await page.waitForFunction((i) => window.__STORY__.story.messages.filter((m) => m.role === "assistant").length > i,
      { timeout: 180000 }, targetIdx);
    await page.waitForFunction((i) => {
      const s = window.__STORY__.story;
      return s.ledgerDiffs[i] && s.ledgerDiffs[i].reason !== "keeper pending";
    }, { timeout: 180000 }, targetIdx);

    const out = await page.evaluate((b, i, secret) => {
      const s = window.__STORY__.story;
      const scene = s.messages[s.messages.length - 1].content;
      const prose = scene.split("===CHOICES===")[0].replace(/^===CHAPTER===.*\n/, "").trim();
      const entry = s.ledgerDiffs[i];
      const pk = s.ledger.player_knowledge;
      return {
        prose, entry, pk,
        canon: s.ledger.canon.map((c) => ({ id: c.id, source: c.source, rule: c.rule })),
        changed: JSON.stringify(s.ledger) !== b,
        stillHidden: pk.hidden_from_player.includes(secret),
        // Only a leak while the fact is STILL hidden. Once the keeper has promoted it the narrator
        // is entitled to play with it — flagging that would be flagging the feature working.
        leaked: pk.hidden_from_player.includes(secret) &&
          /maren[^.]{0,70}(putting|put them out|snuff|extinguish|is the one|confess)/i.test(prose),
      };
    }, before, targetIdx, SECRET_FACT);

    stats.scenes++;
    if (out.entry.ok) stats.applied++; else stats.failed++;
    console.log("\n" + "-".repeat(78));
    console.log(`TURN ${t + 1} — ${label}`);
    console.log("-".repeat(78));
    console.log("SCENE (trimmed):\n" + out.prose.split("\n").slice(0, 8).join("\n").slice(0, 900) + (out.prose.length > 900 ? " …" : ""));
    console.log("\nDIFF: " + (out.entry.ok ? JSON.stringify(out.entry.diff, null, 2) : "✗ NOT APPLIED — " + out.entry.reason));
    console.log("\nPLAYER KNOWLEDGE NOW:");
    console.log("  known:     " + (out.pk.known.join(" · ") || "(none)"));
    console.log("  suspected: " + (out.pk.suspected.join(" · ") || "(none)"));
    console.log("  hidden:    " + (out.pk.hidden_from_player.join(" · ") || "(none)"));
    const reader = out.canon.filter((c) => c.source === "reader");
    if (reader.length) console.log("READER CANON: " + reader.map((c) => `[${c.id}] ${c.rule}`).join(" | "));
    if (out.entry.ok && out.entry.diff && out.entry.diff.promote_knowledge) {
      stats.promos.push({ turn: t + 1, p: out.entry.diff.promote_knowledge });
      console.log("★ PROMOTION on this turn: " + JSON.stringify(out.entry.diff.promote_knowledge));
    }
    stats.readerCanon = reader;
    if (out.leaked) { stats.leak.push(t + 1); console.log("⚠ POSSIBLE LEAK — the prose may have stated the secret. Read it."); }
  }

  bar("PLAYTHROUGH SUMMARY");
  console.log(`  scenes: ${stats.scenes} · keeper diffs applied: ${stats.applied} · not applied: ${stats.failed}`);
  console.log(`  promotions: ${stats.promos.length ? stats.promos.map((p) => "turn " + p.turn).join(", ") : "NONE — read the diffs above and ask why"}`);
  console.log(`  reader canon recorded: ${stats.readerCanon.length}`);
  console.log(`  possible leaks: ${stats.leak.length ? stats.leak.join(", ") : "none"}`);
  console.log(`  page errors: ${errors.length ? errors.join(" | ") : "none"}`);
  const final = await page.evaluate((secret) => {
    const s = window.__STORY__.story, L = s.ledger;
    return { diffs: s.ledgerDiffs.length, ordered: s.ledgerDiffs.every((d, i) => d && d.scene === i),
             scenes: s.messages.filter((m) => m.role === "assistant").length,
             valid: window.__STORY__.validateLedger(L).ok,
             chars: L.characters.length, threads: L.open_threads.length,
             timeline: L.timeline.length,
             known: L.player_knowledge.known.length,
             knownChars: JSON.stringify(L.player_knowledge.known).length,
             wire: JSON.stringify(window.__STORY__.ledgerForSend(L)).length,
             readerCanon: L.canon.filter((c) => c.source === "reader").map((c) => c.rule),
             // The two contradictions the first live run produced, both worth counting again.
             questionCanon: L.canon.filter((c) => c.source === "reader" && /\b(asked|ask|whether|if she|if he)\b/i.test(c.rule)).length,
             denials: L.player_knowledge.known.filter((k) => /\b(is not|isn't|not the one|innocent)\b/i.test(k)),
             stillHidden: L.player_knowledge.hidden_from_player.includes(secret) };
  }, SECRET_FACT);
  console.log(`  final ledger: valid=${final.valid} · ${final.chars} characters · ${final.threads} threads · ${final.timeline} timeline entries`);
  console.log(`  diff log: ${final.diffs} entries for ${final.scenes} scenes, ordered=${final.ordered}`);
  console.log(`  KNOWN list: ${final.known} entries / ${final.knownChars} chars   ·   whole ledger on the wire: ${final.wire} bytes`);
  console.log(`  reader canon (${final.readerCanon.length}): ${final.readerCanon.map((r) => JSON.stringify(r)).join(" | ") || "(none)"}`);
  console.log(`  ⚠ canon minted from a QUESTION rather than a statement: ${final.questionCanon}`);
  console.log(`  ⚠ "known" entries that read as a DENIAL of something: ${final.denials.length ? final.denials.map((d) => JSON.stringify(d)).join(" | ") : "none"}`);
  await browser.close();
  return stats;
}

// ---------------------------------------------------------------------------
const srv = await serve();
try {
  if (args.includes("--promo") || (!args.includes("--play") && !args.includes("--habits"))) await modePromo(PROMO);
  if (args.includes("--habits")) await modeHabits(flagN("habits", 8));
  if (args.includes("--play")) await modePlay(PLAY);
} catch (err) {
  console.log("\n✗ PROBE ERROR: " + ((err && err.stack) || err));
  process.exitCode = 2;
} finally { srv.close(); }
