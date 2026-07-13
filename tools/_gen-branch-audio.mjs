// One-off generator for Branch Manager's ElevenLabs audio (music + SFX).
// Run: node tools/_gen-branch-audio.mjs [--only=name1,name2] [--skip-music] [--skip-sfx]
// Reads ELEVENLABS_API_KEY from tools/.env (never printed). Writes into assets/audio/branch/
// and appends entries to assets/audio/branch/manifest.json (house convention, mirrors
// assets/audio/manifest.json for Farm Kart).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "audio", "branch");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

function loadKey() {
  const envPath = path.join(ROOT, "tools", ".env");
  const line = fs.readFileSync(envPath, "utf8").trim();
  const eq = line.indexOf("=");
  const name = line.slice(0, eq).trim();
  const value = line.slice(eq + 1).trim();
  if (name !== "ELEVENLABS_API_KEY" || !value) throw new Error("ELEVENLABS_API_KEY not found in tools/.env");
  return value;
}

const API_KEY = loadKey();
const BASE = "https://api.elevenlabs.io/v1";

async function postAudio(pathSeg, body, outFile, query) {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const res = await fetch(BASE + pathSeg + qs, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} on ${pathSeg}: ${detail.slice(0, 500)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  return buf.length;
}

async function genMusic(name, prompt, lengthMs) {
  const outFile = path.join(OUT_DIR, name + ".mp3");
  const bytes = await postAudio("/music", {
    prompt,
    music_length_ms: lengthMs,
    force_instrumental: true
  }, outFile, { output_format: "mp3_44100_128" });
  return { file: name + ".mp3", kind: "music", prompt, targetMs: lengthMs, bytes,
    api: "POST /v1/music (music_v1, force_instrumental=true, music_length_ms=" + lengthMs + ")" };
}

async function genSfx(name, prompt, durationSeconds, promptInfluence) {
  const outFile = path.join(OUT_DIR, name + ".mp3");
  const bytes = await postAudio("/sound-generation", {
    text: prompt,
    model_id: "eleven_text_to_sound_v2",
    prompt_influence: promptInfluence,
    loop: false,
    duration_seconds: durationSeconds
  }, outFile, { output_format: "mp3_44100_128" });
  return { file: name + ".mp3", kind: "sfx", prompt, target: `~${durationSeconds}s`, bytes,
    api: `POST /v1/sound-generation (duration_seconds=${durationSeconds}, prompt_influence=${promptInfluence}, loop=false)` };
}

const MUSIC_JOBS = [
  ["bm-music-menu", "relaxed front-porch banjo picking, slow easygoing bluegrass, warm acoustic guitar and banjo duet, gentle and welcoming, instrumental, seamless loop", 62000],
  ["bm-music-play", "Korobeiniki, traditional 19th-century Russian folk dance melody, energetic bluegrass banjo arrangement, driving 3-finger picking roll, upright bass and fiddle accents, minor key, instrumental, seamless loop", 80000],
  ["bm-music-play-alt", "Korobeiniki Russian folk melody reimagined as a fast bluegrass hoedown, banjo lead with fiddle harmony, foot-stomping energy, minor key, instrumental, seamless loop", 78000],
  ["bm-music-danger", "A fast, frantic bluegrass banjo instrumental with tense, urgent, driving energy, featuring rapid picking in a minor key, designed as a seamless loop with an original melody inspired by traditional folk motifs.", 52000],
];

const SFX_JOBS = [
  ["bm-sfx-move", "soft wooden tap, small branch sliding on wood, subtle percussive click, no music", 0.5, 0.6],
  ["bm-sfx-rotate", "quick wood creak whoosh with a soft click, branch twisting, no music", 0.5, 0.6],
  ["bm-sfx-lock", "wooden clunk, a twig snapping down onto a woodpile, satisfying short thud, no music", 0.5, 0.7],
  ["bm-sfx-lineclear", "wood crackling burst with a bright magical chime, satisfying short wood-fire clear, no music", 1.0, 0.7],
  ["bm-sfx-tetris", "big satisfying wood crackling explosion with a triumphant sparkling chime flourish, richer and bigger than a small clear, no music", 1.4, 0.7],
  ["bm-sfx-levelup", "short cheerful fanfare, woodwind and bell chime, kid-friendly level-up game jingle, no music", 1.0, 0.65],
  ["bm-sfx-gameover", "gentle low wooden womp, soft sad descending tone, kid-friendly not scary, no music", 1.2, 0.65],
  ["bm-sfx-ui", "simple soft wooden UI click, clean short tap, no music", 0.5, 0.6],
];

function parseArgs() {
  const a = process.argv.slice(2);
  const only = a.find(x => x.startsWith("--only="));
  return {
    only: only ? only.slice(7).split(",") : null,
    skipMusic: a.includes("--skip-music"),
    skipSfx: a.includes("--skip-sfx"),
  };
}

async function main() {
  const { only, skipMusic, skipSfx } = parseArgs();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let manifest = [];
  if (fs.existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")); } catch (e) { manifest = []; }
  }
  const upsert = (entry) => {
    const i = manifest.findIndex(m => m.file === entry.file);
    if (i >= 0) manifest[i] = entry; else manifest.push(entry);
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  };

  const jobs = [];
  if (!skipMusic) for (const [name, prompt, ms] of MUSIC_JOBS) if (!only || only.includes(name)) jobs.push({ type: "music", name, prompt, ms });
  if (!skipSfx) for (const [name, prompt, dur, pi] of SFX_JOBS) if (!only || only.includes(name)) jobs.push({ type: "sfx", name, prompt, dur, pi });

  for (const job of jobs) {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        console.log(`[gen] ${job.name} (attempt ${attempt})...`);
        const entry = job.type === "music"
          ? await genMusic(job.name, job.prompt, job.ms)
          : await genSfx(job.name, job.prompt, job.dur, job.pi);
        upsert(entry);
        console.log(`  ok: ${entry.file} (${entry.bytes} bytes)`);
        break;
      } catch (e) {
        const msg = String(e.message || e);
        console.error(`  fail: ${msg}`);
        if (/HTTP 429/.test(msg) && attempt < 5) {
          const waitMs = 8000 * attempt;
          console.log(`  429 concurrency — backing off ${waitMs}ms and retrying...`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }
        if (attempt < 3 && /HTTP 5/.test(msg)) {
          await new Promise(r => setTimeout(r, 4000));
          continue;
        }
        console.error(`  giving up on ${job.name}`);
        break;
      }
    }
    // gentle pacing between calls regardless of outcome — be a good citizen since another
    // session may be generating audio for a different game concurrently.
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log("done.");
}

main().catch(e => { console.error(e); process.exit(1); });
