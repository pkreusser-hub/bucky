#!/usr/bin/env node
/**
 * Story-ledger LIVE PROBE — the step-2 hand-tuning gate, run against a REAL model.
 *
 *   node tools/_probe-storyledger.mjs                      # against the deployed site
 *   node tools/_probe-storyledger.mjs --url http://localhost:8888
 *   node tools/_probe-storyledger.mjs --gate canon         # one gate only
 *
 * WHY THIS EXISTS AS A SCRIPT INSTEAD OF A TRANSCRIPT: the session that built steps 1-2 had no
 * ANTHROPIC_API_KEY (tools/.env carries only ELEVENLABS and TRIPO keys, and the environment
 * blocks api.anthropic.com), so every claim in tools/_verify-storyledger.cjs is about the WIRE
 * and the CLIENT, proven against a fake Anthropic. Nothing below has been observed against a
 * real model. Run this after the next deploy and read the transcripts.
 *
 * IT COSTS NOTHING FROM ANYONE'S DAY: no `user` field is sent, so the server neither counts the
 * scenes against the 15/day cap nor writes them to the kids' Story Log (both are gated on a
 * named non-Dad user). It does spend a few cents of Haiku.
 *
 * THE FOUR GATES (the brief's step-2 acceptance bar):
 *   canon   — a choice that invites contradicting a canon rule must fail DIEGETICALLY: the world
 *             refuses inside the story, with no out-of-character remark and no quiet bending.
 *   hidden  — a hidden_from_player secret must not leak across 5+ consecutive scenes, not even
 *             by hint, wink or foreshadowing.
 *   voice   — a character with a recorded VOICE must sound like it.
 *   choices — exactly 3 choices, each a natural next step, none with an obvious outcome.
 *
 * Automated checks below are TRIPWIRES, not judgement. The transcript is the deliverable: read
 * it. A gate that trips is definitely wrong; a gate that passes still wants a human eye.
 */

const args = process.argv.slice(2);
const argOf = (name, dflt) => { const i = args.indexOf("--" + name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = argOf("url", "https://amenfarms.netlify.app").replace(/\/$/, "");
const ONLY = argOf("gate", "");
const SECRET = argOf("secret", "amenfarms");
const URL_ = BASE + "/.netlify/functions/farmgpt";

// ---------------------------------------------------------------------------
// The probe ledger: a small original world (no real universe pack needed) built to put each
// gate under real pressure. Canon rule C1 is the one the canon gate attacks. The secret in
// hidden_from_player is the one the hidden gate hunts for.
// ---------------------------------------------------------------------------
const SECRET_FACT = "the lighthouse keeper Maren is the one who has been putting out the lamps";
const LEDGER = {
  meta: { title: "The Dark Lamps", universe: "original",
          timeline_point: "the first week of the autumn fogs",
          genre_and_tone: "cosy seaside mystery, warm and funny",
          narrative_voice: "second person, past tense", turn: 3, schema_version: 1 },
  canon: [
    { id: "C1", rule: "NOBODY in Saltmere can swim. Not one person. It is simply not a thing anyone here has ever learned, and no one in this story can do it under any circumstances.", source: "pack", turn: 0 },
    { id: "C2", rule: "The harbour lamps burn green, and only green.", source: "pack", turn: 0 },
    { id: "C3", rule: "The fog rolls in every evening at dusk and does not lift until dawn.", source: "pack", turn: 0 },
  ],
  characters: [
    { id: "CH1", name: "Bramblewick", origin: "pack", role: "the harbour's lamplighter",
      physical: "short and sooty, with enormous grey eyebrows", status: "well",
      voice: "Clipped and gruff. Never uses two words where one will do. Answers questions with questions. Calls everyone 'you', never by name. Rarely finishes a sentence he thinks is obvious.",
      motivation: "keep every lamp on the quay burning",
      possessions: ["a brass tinder-hook"], knows: ["which lamps went dark first"], does_not_know: ["who is putting them out"],
      last_seen: { turn: 3, location: "the quay", state: "grumbling at a dark lamp" } },
    { id: "CH2", name: "Maren", origin: "pack", role: "the lighthouse keeper",
      physical: "tall, always in an oilskin coat", status: "friendly, a little too helpful",
      voice: "Warm and chatty, tells long stories that wander off the point, apologises constantly.",
      motivation: "(hidden) keep ships away from the shoal she never reported",
      possessions: [], knows: ["everything about the lamps"], does_not_know: [],
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
    known: ["three lamps on the quay have gone dark this week", "Bramblewick relights them every morning"],
    suspected: ["someone is putting the lamps out on purpose"],
    hidden_from_player: [SECRET_FACT, "Maren is doing it to keep boats away from a shoal she never reported"],
  },
  open_threads: [{ id: "T1", thread: "who is putting out the harbour lamps", opened_turn: 1, status: "unresolved", urgency: "slow burn" }],
  flags: { lampsOut: 3 },
  timeline: [{ turn: 1, event: "arrived at Saltmere" }, { turn: 2, event: "met Maren at the lighthouse" }, { turn: 3, event: "Bramblewick lent you a lantern" }],
};

const SEED = "A cosy seaside mystery in the little harbour town of Saltmere, where the lamps keep going dark. My name is Wren.";
const SCENE1 = `The third lamp went out just as you reached it.

Bramblewick was already there, of course, brass hook in hand, eyebrows drawn down like a pair of storm clouds. He did not look up.

"You," he said. "Again."

===CHOICES===
1. Ask him which lamp went dark first.
2. Take the cracked lantern out and look at the wick.
3. Walk out along the quay toward the lighthouse.`;

// ---------------------------------------------------------------------------
async function scene(messages, opts = {}) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // NOTE: deliberately no `user` field — see the header comment.
    body: JSON.stringify({ secret: SECRET, mode: "story", messages, ledger: LEDGER, ...opts }),
  });
  if (!r.ok) throw new Error("HTTP " + r.status + " — " + (await r.text()).slice(0, 300));
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("json")) throw new Error("unexpected JSON reply: " + (await r.text()).slice(0, 300));
  return await r.text();
}
const choicesOf = (t) => {
  const i = t.indexOf("===CHOICES===");
  if (i === -1) return [];
  return t.slice(i + 13).split("\n").map((l) => l.trim()).filter((l) => /^\d+\.\s+\S/.test(l));
};
const proseOf = (t) => t.split("===CHOICES===")[0].replace(/^===CHAPTER===.*\n/, "").trim();

let gates = 0, tripped = 0;
const report = (name, bad, note) => {
  gates++;
  if (bad) { tripped++; console.log(`\n  ⚠ TRIPWIRE — ${name}: ${note}`); }
  else console.log(`  · ok (tripwire clear) — ${name}`);
};
const banner = (t) => console.log("\n" + "=".repeat(72) + "\n" + t + "\n" + "=".repeat(72));

// ---------------------------------------------------------------------------
async function gateCanon() {
  banner("GATE 1 — CANON UNDER PROVOCATION\nThe reader writes in a move that requires breaking canon rule C1 (nobody in\nSaltmere can swim). The narrator must let it FAIL INSIDE THE STORY: no bending,\nno out-of-character remark, no 'you can't do that'.");
  const msgs = [
    { role: "user", content: SEED },
    { role: "assistant", content: SCENE1 },
    { role: "user", content: "I dive off the quay and swim out to the lighthouse — I'm a really strong swimmer, I swim across the whole harbour easily." },
  ];
  const out = await scene(msgs);
  console.log("\n--- SCENE ---\n" + out + "\n");
  const prose = proseOf(out).toLowerCase();
  const swamOK = /(swam|swimming strongly|struck out across|stroke after stroke)/.test(prose) &&
                 !/(couldn't|could not|didn't know how|never learned|no one here)/.test(prose);
  report("canon held", swamOK, "the prose reads as though the swim SUCCEEDED — canon C1 was bent");
  const meta = /(content rules|i can't|as an ai|that's not allowed|in this world you can't\b.*\(|note:)/i.test(prose);
  report("no out-of-character remark", meta, "the reply appears to address the reader out of character");
  console.log("\n  READ FOR: does the refusal feel like the WORLD answering (the water is wrong, the\n  body simply does not know what to do, Bramblewick hauls you back) rather than the\n  narrator saying no? Is it interesting rather than a dead stop?");
  return out;
}

async function gateHidden() {
  banner(`GATE 2 — HIDDEN KNOWLEDGE OVER 5+ SCENES\nThe ledger's secret is: "${SECRET_FACT}".\nIt must not surface, be hinted at, or be foreshadowed with a wink across five\nconsecutive scenes — including one where the reader asks about it directly.`);
  const msgs = [{ role: "user", content: SEED }, { role: "assistant", content: SCENE1 }];
  const probes = [
    "1",
    "Ask Bramblewick if he thinks someone is doing it on purpose.",
    "3",
    "Ask Maren straight out: is she the one putting out the lamps?",
    "2",
  ];
  let leaks = 0;
  for (let i = 0; i < probes.length; i++) {
    msgs.push({ role: "user", content: probes[i] });
    const out = await scene(msgs);
    msgs.push({ role: "assistant", content: out });
    const prose = proseOf(out);
    console.log(`\n--- SCENE ${i + 1} (reader: ${probes[i]}) ---\n` + prose + "\n");
    // Tripwire: the secret stated outright. Maren being PRESENT is fine; Maren being named as
    // the culprit, or confessing, is not.
    const lower = prose.toLowerCase();
    const leaked = /maren[^.]{0,80}(put(ting)? (them |the lamps )?out|snuff|extinguish|blew? out|is the one|confess|admits)/.test(lower) ||
                   /(it was|it's been) maren/.test(lower) ||
                   /shoal she never reported|never reported the shoal/.test(lower);
    if (leaked) { leaks++; console.log("  ⚠ possible LEAK in this scene — read it closely."); }
  }
  report("secret survived 5 scenes", leaks > 0, `${leaks} scene(s) appear to state the secret outright`);
  console.log("\n  READ FOR: the softer failure the tripwire cannot catch — a knowing aside, an\n  ominous close-up on Maren's hands, a narrator hint that 'someone was lying'. The\n  reader should finish scene 5 with no more certainty than they started with.");
}

async function gateVoice() {
  banner("GATE 3 — CHARACTER VOICE\nBramblewick's recorded voice: clipped, gruff, never two words where one will do,\nanswers questions with questions, calls everyone 'you' and never by name.");
  const msgs = [
    { role: "user", content: SEED },
    { role: "assistant", content: SCENE1 },
    { role: "user", content: "Ask Bramblewick everything he knows about the lamps — press him for the whole story." },
  ];
  const out = await scene(msgs);
  console.log("\n--- SCENE ---\n" + out + "\n");
  const prose = proseOf(out);
  const quotes = (prose.match(/[""]([^""]{1,400})[""]/g) || []).concat(prose.match(/"([^"]{1,400})"/g) || []);
  const longSpeech = quotes.some((q) => q.split(/\s+/).length > 45);
  report("no monologue", longSpeech, "a quoted speech runs long — Bramblewick is written as terse");
  report("never uses the reader's name", /["""][^"""]*\bWren\b[^"""]*["""]/.test(prose),
    "a quoted line addresses the reader as 'Wren' — his voice says he never does");
  console.log("  READ FOR: does he SOUND like the sheet? Short lines, deflection, a question\n  returned for a question. A polite, fluent, helpful Bramblewick is a fail even if\n  every fact is right.");
}

async function gateChoices() {
  banner("GATE 4 — CHOICES\nExactly 3, each a natural next step for THIS moment, none with an obvious outcome,\nnone a wild jump in scale or tone.");
  const msgs = [{ role: "user", content: SEED }, { role: "assistant", content: SCENE1 }, { role: "user", content: "2" }];
  const out = await scene(msgs);
  console.log("\n--- SCENE ---\n" + out + "\n");
  const ch = choicesOf(out);
  report("exactly 3 choices", ch.length !== 3, `got ${ch.length}`);
  report("each is one short sentence", ch.some((c) => c.split(/\s+/).length > 18), "a choice runs long");
  report("no marker leakage", /===(CHAPTER|ART|RECAP|THE END)===/.test(out.split("===CHOICES===")[0]),
    "an unexpected marker appeared in the prose");
  console.log("  READ FOR: could the reader predict exactly what happens for any of these? If so\n  that one is dead weight. Do all three fit the moment the scene just ended on?");
}

// ---------------------------------------------------------------------------
(async () => {
  console.log("Story-ledger live probe → " + URL_);
  console.log("No `user` sent: these scenes are NOT counted against the daily cap and NOT written");
  console.log("to the kids' Story Log. They do spend a few cents of Haiku.\n");
  const run = { canon: gateCanon, hidden: gateHidden, voice: gateVoice, choices: gateChoices };
  try {
    for (const [name, fn] of Object.entries(run)) {
      if (ONLY && ONLY !== name) continue;
      await fn();
    }
  } catch (err) {
    console.log("\n✗ PROBE ERROR: " + (err && err.message || err));
    console.log("  (a 500 about ANTHROPIC_API_KEY means the deploy is missing the env var;");
    console.log("   a 401 means --secret does not match BUCKY_NOTIFY_SECRET)");
    process.exit(2);
  }
  console.log("\n" + "=".repeat(72));
  console.log(`Tripwires: ${gates - tripped}/${gates} clear.`);
  console.log("Tripwires are not the gate — the transcripts above are. Tune STORY_LEDGER_RULES in");
  console.log("netlify/functions/farmgpt.mjs and re-run until all four read right.");
  process.exit(tripped ? 1 : 0);
})();
