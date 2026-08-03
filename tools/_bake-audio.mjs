// Bake the read-aloud for a Story Time Jr story: one narrated MP3 per page, with word timings.
//
//   node tools/_bake-audio.mjs tools/story-goat.json [--force] [--voice <id>]
//
// WHY THIS EXISTS. The page already reads aloud with the browser's own SpeechSynthesis, and it
// does it ONE UTTERANCE PER WORD — see storytime.html. That was a deliberate trade: speaking word
// by word makes the highlight exact by construction, because the next word cannot start until the
// previous one has finished. The cost is that it sounds like a word list. There is no sentence
// rhythm, and every word resets the intonation.
//
// The fix is not a nicer voice, it's real timings. ElevenLabs' with-timestamps endpoint returns
// the audio AND a start/end time for every character, so a whole sentence can be spoken naturally
// while the highlight still lands on the exact word being said.
//
// Because the stories are baked, the text never changes at read time — so the narration is
// generated once, costs nothing afterwards, works with no network, and sidesteps iOS Safari's
// SpeechSynthesis quirks entirely (an <audio> element is far more predictable on an iPad).
//
// OUTPUT — deliberately kept OUT of story.json, which _bake-story-local.mjs owns and rewrites on
// every picture bake. Audio lives beside it so re-baking the pictures can never destroy it:
//   assets/storytime/<id>/audio/<pageId>.mp3
//   assets/storytime/<id>/audio.json   { voice, model, pages: { <pageId>: { src, words[] } } }
//
// RESUMABLE: a page that already has an MP3 and timings is skipped, so a re-run after a failure
// costs nothing. --force regenerates everything.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const FORCE = process.argv.includes("--force");
const specPath = process.argv[2] || "tools/story-goat.json";

// Jessica — playful, bright, warm, American. Chosen by ear against George (British storyteller)
// and Alice (clear educator) on a real page of the goat book.
const VOICE_DEFAULT = "cgSgspJ2msm6clMCkdW9";
const vi = process.argv.indexOf("--voice");
const VOICE = vi > -1 && process.argv[vi + 1] ? process.argv[vi + 1] : VOICE_DEFAULT;
const MODEL = process.env.ELEVEN_MODEL || "eleven_multilingual_v2";

function envKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  try {
    const txt = readFileSync(join("tools", ".env"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i > 0 && line.slice(0, i).trim() === "ELEVENLABS_API_KEY") return line.slice(i + 1).trim();
    }
  } catch {}
  return null;
}
const KEY = envKey();
if (!KEY) { console.error("ELEVENLABS_API_KEY not set (env or tools/.env)"); process.exit(1); }

const spec = JSON.parse(readFileSync(specPath, "utf8"));
const OUT_DIR = join("assets", "storytime", spec.id);
const AUDIO_DIR = join(OUT_DIR, "audio");
const STORY_JSON = join(OUT_DIR, "story.json");
if (!existsSync(STORY_JSON)) {
  console.error(`No ${STORY_JSON} — bake the pictures first with tools/_bake-story-local.mjs`);
  process.exit(1);
}
// The BAKED story.json is the source of truth for the words, not the spec: it is exactly what the
// page renders, so the narration can never drift from what is on screen.
const story = JSON.parse(readFileSync(STORY_JSON, "utf8"));
mkdirSync(AUDIO_DIR, { recursive: true });

const manifestPath = join(OUT_DIR, "audio.json");
let manifest = { voice: VOICE, model: MODEL, pages: {} };
if (existsSync(manifestPath) && !FORCE) {
  try {
    const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (prev && prev.pages) manifest = prev;
  } catch {}
}
// A voice change invalidates every page — otherwise a half-swapped book reads in two voices.
if (manifest.voice !== VOICE || manifest.model !== MODEL) {
  if (Object.keys(manifest.pages || {}).length) console.log("voice/model changed — regenerating all pages");
  manifest = { voice: VOICE, model: MODEL, pages: {} };
}

// Turn per-CHARACTER alignment into per-WORD timings. The split is on whitespace, which is the
// SAME tokenisation storytime.html's paintText() uses to build its word spans — so index i here
// is index i there. The runtime asserts the counts match before trusting them.
function wordsFrom(alignment) {
  const ch = alignment.characters || [];
  const st = alignment.character_start_times_seconds || [];
  const en = alignment.character_end_times_seconds || [];
  const out = [];
  let cur = null;
  for (let i = 0; i < ch.length; i++) {
    if (/\s/.test(ch[i])) { if (cur) { out.push(cur); cur = null; } continue; }
    if (!cur) cur = { w: "", s: st[i], e: en[i] };
    cur.w += ch[i];
    cur.e = en[i];
  }
  if (cur) out.push(cur);
  return out.map((x) => ({ w: x.w, s: +x.s.toFixed(3), e: +x.e.toFixed(3) }));
}

async function speak(text, attempt = 1) {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({
      text, model_id: MODEL,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (j && j.audio_base64 && j.alignment) return j;
  const why = j && j.detail ? JSON.stringify(j.detail).slice(0, 160) : `HTTP ${r.status}`;
  if (attempt < 3) {
    console.log(`    attempt ${attempt} failed — ${why}`);
    await new Promise((s) => setTimeout(s, 1500 * attempt));
    return speak(text, attempt + 1);
  }
  throw new Error(why);
}

const ids = Object.keys(story.pages);
let made = 0, skipped = 0, chars = 0, failed = [];
console.log(`narrating "${story.title}" — ${ids.length} pages → ${AUDIO_DIR}  (voice ${VOICE}, ${MODEL})`);
const t0 = Date.now();

for (const id of ids) {
  const text = String(story.pages[id].text || "").trim();
  const file = join(AUDIO_DIR, id + ".mp3");
  if (!text) { skipped++; continue; }
  if (!FORCE && existsSync(file) && manifest.pages[id] && manifest.pages[id].words) { skipped++; continue; }
  process.stdout.write(`  ${id} … `);
  try {
    const j = await speak(text);
    const buf = Buffer.from(j.audio_base64, "base64");
    writeFileSync(file, buf);
    const words = wordsFrom(j.alignment);
    // Sanity: the characters we got back must rebuild the exact text we sent, or the word
    // indices cannot be trusted against the spans on screen.
    const rebuilt = (j.alignment.characters || []).join("");
    const onScreen = text.split(/\s+/).filter(Boolean).length;
    if (rebuilt !== text) console.log(`\n    ⚠ ${id}: alignment text differs from input — timings may drift`);
    if (words.length !== onScreen) console.log(`\n    ⚠ ${id}: ${words.length} timed words vs ${onScreen} on screen`);
    manifest.pages[id] = { src: `/${AUDIO_DIR}/${id}.mp3`.replace(/\\/g, "/"), words };
    chars += text.length;
    made++;
    console.log(`ok (${(buf.length / 1024).toFixed(0)}KB, ${words.length} words, ${words[words.length - 1].e.toFixed(1)}s)`);
  } catch (e) {
    failed.push(id);
    console.log(`FAILED — ${e.message}`);
  }
}

writeFileSync(manifestPath, JSON.stringify(manifest));
const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`\n${made} narrated, ${skipped} already done, ${failed.length} failed${failed.length ? " — " + failed.join(", ") : ""}`);
console.log(`${chars} characters billed this run · ${sec}s wall-clock`);
process.exit(failed.length ? 1 : 0);
