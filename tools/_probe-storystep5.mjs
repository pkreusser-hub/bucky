#!/usr/bin/env node
/**
 * Story-ledger STEP 5 live probe — rewind/branching and the contradiction audit, run against
 * REAL models rather than a fake server.
 *
 *   node tools/_probe-storystep5.mjs --rewind 8     # a real story, rewound, branched, diffs printed
 *   node tools/_probe-storystep5.mjs --audit        # a real audit over a PLANTED contradiction
 *   node tools/_probe-storystep5.mjs --rewind 8 --audit
 *
 * Hosts the real netlify/functions/farmgpt.mjs in process with the key from tools/.env and
 * Firestore pointed at a dead host, so nothing here touches the family's Story Log and the cap
 * query fails open exactly as designed. It spends a few cents (Haiku for the story, one Sonnet
 * call for the audit).
 *
 * WHAT EACH MODE IS FOR.
 *   --rewind is the reversibility gate. It prints every diff of a real playthrough, rewinds the
 *            story, prints the diffs again, and BYTE-COMPARES the rewound ledger against a fresh
 *            replay of seed + surviving diffs. The printed diffs are the deliverable; the
 *            comparison is the tripwire.
 *   --audit  is the usefulness gate. A planted contradiction (canon says nobody in Saltmere can
 *            swim; the story has the hero swimming the channel) plus a clean control. A checker
 *            that finds the plant and does NOT invent findings on the control is working.
 *
 * THE PROBE IS DAD — STORY_DAILY_CAP is 15 and the client counts every scene it renders.
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
  if (i === -1) return dflt;
  const v = +args[i + 1];
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const PORT = flagN("port", 8798);
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
  if (!r.ok) throw new Error("HTTP " + r.status + " — " + (await r.text()).slice(0, 300));
  return await r.text();
};
const bar = (t) => console.log("\n" + "=".repeat(84) + "\n" + t + "\n" + "=".repeat(84));

// ---------------------------------------------------------------------------
// The probe world — Saltmere, with ONE canon rule chosen because a story is very likely to
// break it if the reader pushes: nobody here can swim.
// ---------------------------------------------------------------------------
const CANON_NO_SWIM = "Nobody in Saltmere can swim; it is simply not a thing anyone here has ever learned.";
const baseLedger = () => JSON.parse(JSON.stringify({
  meta: { title: "The Dark Lamps", universe: "original", timeline_point: "the first week of the autumn fogs",
          genre_and_tone: "cosy seaside mystery, warm and funny",
          narrative_voice: "second person, past tense", turn: 1, schema_version: 1 },
  canon: [
    { id: "C1", rule: CANON_NO_SWIM, source: "pack", turn: 0 },
    { id: "C2", rule: "The harbour lamps burn green, and only green.", source: "pack", turn: 0 },
  ],
  characters: [
    { id: "CH1", name: "Bramblewick", origin: "pack", role: "the harbour's lamplighter",
      physical: "short and sooty, with enormous grey eyebrows", status: "well",
      voice: "Clipped and gruff. Never uses two words where one will do. Answers questions with questions.",
      motivation: "keep every lamp on the quay burning", possessions: ["a brass tinder-hook"],
      knows: ["which lamps went dark first"], does_not_know: ["who is putting them out"],
      last_seen: { turn: 1, location: "the quay", state: "grumbling at a dark lamp" } },
    { id: "CH2", name: "Maren", origin: "pack", role: "the lighthouse keeper",
      physical: "tall, always in an oilskin coat", status: "friendly, a little too helpful",
      voice: "Warm and chatty, tells long stories that wander off the point, apologises constantly.",
      motivation: "keep ships away from the shoal", possessions: [], knows: ["everything about the lamps"], does_not_know: [],
      last_seen: { turn: 0, location: "", state: "" } },
    { id: "CH3", name: "Wren", origin: "reader", role: "the hero of this story — the reader's own character",
      status: "curious", physical: "", voice: "", motivation: "find out why the lamps keep going dark",
      possessions: ["a cracked lantern"], knows: [], does_not_know: [],
      last_seen: { turn: 1, location: "the quay", state: "" } },
  ],
  locations: [
    { id: "L1", name: "Saltmere quay", description: "a crooked stone harbour lined with green lamps", state: "half-dark", visited_turns: [1] },
    { id: "L2", name: "the lighthouse", description: "white, peeling, at the end of the shoal path", state: "lit", visited_turns: [] },
  ],
  protagonist: { name: "Wren", inventory: [{ item: "a cracked lantern", acquired_turn: 1, notes: "" }],
                 conditions: [], abilities: [], reputation: { quay: "new here" } },
  relationships: [
    { id: "R1", between: ["Bramblewick", "Wren"], state: "prickly but warming", changed_turn: 1, history: "he lent you the lantern" },
  ],
  player_knowledge: {
    known: ["three lamps on the quay have gone dark this week"],
    suspected: ["someone is putting the lamps out on purpose"],
    hidden_from_player: ["the lighthouse keeper Maren is the one who has been putting out the harbour lamps"],
  },
  open_threads: [{ id: "T1", thread: "who is putting out the harbour lamps", opened_turn: 1, status: "unresolved", urgency: "slow burn" }],
  flags: { lampsOut: 3 },
  timeline: [{ turn: 1, event: "arrived at Saltmere" }],
}));
const OPENING = "The third lamp went out just as you reached it.\n\nBramblewick was already there, brass hook in hand, eyebrows drawn down like a pair of storm clouds. He did not look up.\n\n\"You,\" he said. \"Again.\"\n\n===CHOICES===\n1. Ask him which lamp went dark first.\n2. Take the cracked lantern out and look at the wick.\n3. Walk out along the quay toward the lighthouse.";

async function openPage() {
  const { createRequire } = await import("node:module");
  const puppeteer = createRequire(path.join(ROOT, "tools/_probe-storystep5.mjs"))("puppeteer-core");
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
  await page.evaluate(() => {
    localStorage.setItem("choreUser", "Dad");
    localStorage.removeItem("farmgpt_story_count_v1");
    localStorage.removeItem("farmgpt_stories_v1");
  });
  await page.evaluate((led, opening) => {
    window.__STORY__.setStory({
      id: "step5probe", title: "The Dark Lamps", created: Date.now(), done: false, chapter: 1, closing: false,
      schemaVersion: 1, ledger: led, ledgerSeed: JSON.parse(JSON.stringify(led)), ledgerDiffs: [],
      messages: [
        { role: "user", content: "A cosy seaside mystery in the little harbour town of Saltmere, where the lamps keep going dark. My name is Wren." },
        { role: "assistant", content: opening },
      ],
    });
    document.getElementById("viewStory").classList.add("on");
  }, baseLedger(), OPENING);
  return { browser, page, errors };
}

async function turn(page, pick) {
  const idx = await page.evaluate(() => window.__STORY__.story.messages.filter((m) => m.role === "assistant").length);
  await page.evaluate((want) => {
    const btns = [...document.querySelectorAll("#choiceBtns .choiceBtn")];
    if (btns.length) { btns[Math.min(want, btns.length) - 1].click(); return; }
    const s = window.__STORY__.story;
    const last = s.messages[s.messages.length - 1].content;
    const opts = (last.split("===CHOICES===")[1] || "").split("\n").map((l) => l.trim())
      .filter((l) => /^\d+\.\s+\S/.test(l)).map((l) => l.replace(/^\d+\.\s*/, ""));
    window.__STORY__.takeTurn(opts[Math.min(want, opts.length) - 1] || "Look around.");
  }, pick);
  await page.waitForFunction((i) => window.__STORY__.story.messages.filter((m) => m.role === "assistant").length > i,
    { timeout: 180000 }, idx);
  await page.waitForFunction((i) => {
    const s = window.__STORY__.story;
    return s.ledgerDiffs[i] && s.ledgerDiffs[i].reason !== "keeper pending";
  }, { timeout: 180000 }, idx);
}

function printDiffs(label, entries) {
  console.log("\n" + label);
  for (const e of entries) {
    console.log("  [" + e.scene + "] " + (e.ok ? JSON.stringify(e.diff) : "✗ " + e.reason).slice(0, 300));
  }
}

async function modeRewind(n) {
  bar(`REWIND / BRANCHING — a real ${n}-turn story, rewound to scene 3, branched, every diff printed.`);
  const { browser, page, errors } = await openPage();
  for (let i = 0; i < n; i++) await turn(page, [1, 2, 1, 3, 2, 1, 3, 2][i % 8]);

  const before = await page.evaluate(() => {
    const s = window.__STORY__.story;
    return {
      scenes: s.messages.filter((m) => m.role === "assistant").length,
      diffs: s.ledgerDiffs.map((e) => ({ scene: e.scene, ok: e.ok, reason: e.reason, diff: e.diff })),
      ledger: JSON.stringify(s.ledger),
      canon: s.ledger.canon.map((c) => `[${c.id}] ${c.rule}`),
      threads: s.ledger.open_threads.map((t) => `[${t.id}] ${t.thread}`),
      timeline: s.ledger.timeline.map((t) => `turn ${t.turn}: ${t.event}`),
      points: window.__STORY__.rewindPoints(s),
    };
  });
  console.log(`\nBEFORE: ${before.scenes} scenes · ${before.diffs.length} diff-log entries`);
  printDiffs("EVERY DIFF, AS WRITTEN:", before.diffs);
  console.log("\nCANON NOW:\n  " + before.canon.join("\n  "));
  console.log("OPEN THREADS NOW:\n  " + (before.threads.join("\n  ") || "(none)"));
  console.log("TIMELINE NOW:\n  " + (before.timeline.join("\n  ") || "(none)"));
  console.log("\nGO-BACK POINTS OFFERED (newest first):");
  for (const p of before.points) console.log(`  scene ${p.scene} (ch ${p.chapter}) — you chose: ${p.choice}`);

  const TO = 3;
  const rew = await page.evaluate((to) => {
    const S = window.__STORY__, s = S.story;
    const expected = JSON.stringify(S.replayLedgerDiffs(s.ledgerSeed, s.ledgerDiffs.slice(0, to), to - 1));
    const res = S.rewindToScene(s, to);
    const shelf = S.loadStories();
    const kept = shelf.find((x) => x.branchedFrom === s.id);
    return {
      res,
      scenes: s.messages.filter((m) => m.role === "assistant").length,
      diffs: s.ledgerDiffs.map((e) => ({ scene: e.scene, ok: e.ok, reason: e.reason, diff: e.diff })),
      turn: s.ledger.meta.turn,
      chapter: s.chapter,
      identical: JSON.stringify(s.ledger) === expected,
      canon: s.ledger.canon.map((c) => `[${c.id}] ${c.rule}`),
      keptTitle: kept && kept.title,
      keptScenes: kept ? kept.messages.filter((m) => m.role === "assistant").length : -1,
      valid: S.validateLedger(s.ledger).ok,
      lastScene: s.messages[s.messages.length - 1].content.split("===CHOICES===")[0].trim().slice(-260),
    };
  }, TO);
  bar(`AFTER GOING BACK TO SCENE ${TO}`);
  console.log(`  ${rew.scenes} scenes · ${rew.diffs.length} diff entries · meta.turn ${rew.turn} · chapter ${rew.chapter} · ledger valid: ${rew.valid}`);
  console.log(`  the version being unwritten was kept as "${rew.keptTitle}" (${rew.keptScenes} scenes)`);
  printDiffs("THE SURVIVING DIFFS:", rew.diffs);
  console.log("\nCANON AFTER THE REWIND:\n  " + rew.canon.join("\n  "));
  console.log("\nThe story now ends here, and the reader chooses again:\n  …" + rew.lastScene.replace(/\n/g, "\n  "));
  console.log(`\n  ★ REPLAY IDENTITY (rewound ledger === seed + surviving diffs, byte for byte): ${rew.identical ? "YES" : "NO ✗"}`);

  // Branch: a different choice from the same point.
  await turn(page, 3);
  const after = await page.evaluate(() => {
    const s = window.__STORY__.story;
    return {
      scenes: s.messages.filter((m) => m.role === "assistant").length,
      diffs: s.ledgerDiffs.map((e) => ({ scene: e.scene, ok: e.ok, reason: e.reason, diff: e.diff })),
      gapless: s.ledgerDiffs.every((d, i) => d && d.scene === i),
      chose: s.messages.filter((m) => m.role === "user").map((m) => m.content).slice(1),
      valid: window.__STORY__.validateLedger(s.ledger).ok,
      turn: s.ledger.meta.turn,
      newScene: s.messages[s.messages.length - 1].content.split("===CHOICES===")[0].replace(/^===CHAPTER===.*\n/, "").trim().slice(0, 500),
    };
  });
  bar("THE BRANCH — a different choice from the same moment");
  console.log("  choices now on record: " + after.chose.map((c) => JSON.stringify(c.slice(0, 60))).join(" → "));
  console.log(`  ${after.scenes} scenes · ${after.diffs.length} diffs · gapless: ${after.gapless} · meta.turn ${after.turn} · valid: ${after.valid}`);
  printDiffs("DIFFS ON THE NEW BRANCH:", after.diffs);
  console.log("\nTHE NEW SCENE:\n  " + after.newScene.replace(/\n/g, "\n  "));
  console.log("\n  page errors: " + (errors.length ? errors.join(" | ") : "none"));
  await browser.close();
  return { identical: rew.identical, gapless: after.gapless, errors };
}

// ---------------------------------------------------------------------------
// AUDIT — a planted contradiction, and a clean control.
// ---------------------------------------------------------------------------
const PLANTED = `[The world] A cosy seaside mystery in the little harbour town of Saltmere, where the lamps keep going dark. My name is Wren.

--- CHAPTER 1 — The Dark Lamps ---
SCENE 1:
The third lamp went out just as you reached it. Bramblewick was already there, brass hook in hand. "You," he said. "Again."

(the reader chose: Walk out along the quay toward the lighthouse.)

SCENE 2:
The shoal path was gone under the tide. You did not hesitate — you slid into the black water and struck out for the lighthouse with long, easy strokes, the way you had swum every summer of your life. Maren was waiting on the steps with a towel, as if she had known you were coming.

(the reader chose: Ask Maren whether she has been out on the quay tonight.)

SCENE 3:
"Me? On the quay?" Maren laughed her long, wandering laugh. "Not once all week, love. I've been up the tower every night." She said it clipped and short, the way Bramblewick would have, and turned the lamp down until the room went dark.`;

const CLEAN = `[The world] A cosy seaside mystery in the little harbour town of Saltmere, where the lamps keep going dark. My name is Wren.

--- CHAPTER 1 — The Dark Lamps ---
SCENE 1:
The third lamp went out just as you reached it. Bramblewick was already there, brass hook in hand. "You," he said. "Again."

(the reader chose: Ask him which lamp went dark first.)

SCENE 2:
"First?" He did not look up. "End of the quay. Tuesday." He worked the hook into the lamp housing and left it at that.

(the reader chose: Walk out along the quay toward the lighthouse.)

SCENE 3:
The shoal path was only just above the tide, and you went carefully, one hand on the wet stone. The lighthouse door stood open. Maren met you on the steps, apologising before you had said a word — for the weather, for the stairs, for the state of the kettle.`;

async function modeAudit() {
  bar("THE CONTRADICTION AUDIT — a real Sonnet pass over a PLANTED contradiction");
  const led = baseLedger();
  led.meta.turn = 3;
  console.log("PLANTED, deliberately, and all three are things a keeper reading one scene at a time would miss:");
  console.log("  1. CANON: [C1] " + CANON_NO_SWIM);
  console.log("     …and scene 2 has Wren swimming the channel \"the way you had swum every summer of your life\".");
  console.log("  2. VOICE: Maren's recorded voice is warm and wandering; scene 3 has her speaking \"clipped and short,");
  console.log("     the way Bramblewick would have\".");
  console.log("  3. HIDDEN: the ledger still hides that Maren is the one putting the lamps out, while scene 3");
  console.log("     has her turning the lamp down until the room goes dark.");
  const raw = await post({ mode: "audit", ledger: led, transcript: PLANTED });
  let parsed = null;
  try {
    const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch { /* printed raw below */ }
  console.log("\nWHAT THE CHECKER SAID:");
  if (!parsed) { console.log("  (unparseable) " + raw.slice(0, 900)); }
  else {
    console.log("  verdict: " + parsed.verdict);
    for (const f of parsed.findings || []) {
      console.log(`\n  [${f.severity}] ${f.kind}${f.where ? " — " + f.where : ""}`);
      console.log("    " + f.what);
      if (f.evidence) console.log("    evidence: " + f.evidence);
    }
  }
  const blob = JSON.stringify(parsed || raw).toLowerCase();
  const foundSwim = /swim|swum|swam|water/.test(blob);
  const foundVoice = /voice|clipped|bramblewick/.test(blob);
  console.log(`\n  ★ found the CANON break (swimming): ${foundSwim ? "YES" : "NO"}`);
  console.log(`  ★ found the VOICE break: ${foundVoice ? "YES" : "NO"}`);

  bar("THE CONTROL — the same world, a story that does NOT break anything");
  const raw2 = await post({ mode: "audit", ledger: baseLedger(), transcript: CLEAN });
  let p2 = null;
  try {
    const t = raw2.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    p2 = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch { /* printed raw below */ }
  if (!p2) console.log("  (unparseable) " + raw2.slice(0, 900));
  else {
    console.log("  verdict: " + p2.verdict);
    console.log("  findings: " + ((p2.findings || []).length));
    for (const f of p2.findings || []) console.log(`    [${f.severity}] ${f.kind}: ${f.what}`);
    console.log(`\n  ★ a clean story produces a clean report: ${(p2.findings || []).length === 0 ? "YES" : "NO — read the findings above and judge whether they are real"}`);
  }
  return { foundSwim, foundVoice, controlFindings: p2 ? (p2.findings || []).length : -1 };
}

const srv = await serve();
try {
  if (args.includes("--rewind")) await modeRewind(flagN("rewind", 8));
  if (args.includes("--audit") || !args.includes("--rewind")) await modeAudit();
} catch (err) {
  console.log("\n✗ PROBE ERROR: " + ((err && err.stack) || err));
  process.exitCode = 2;
} finally { srv.close(); }
