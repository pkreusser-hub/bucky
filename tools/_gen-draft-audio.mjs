// Draft Day audio generator (ElevenLabs), assets/audio/draft/.
// The job list lives HERE; three ways to run it, because the machines involved
// each see a different slice of the network:
//
//   --fire      POST the jobs to the deployed audiogen-background function and
//               exit (202 = the server is generating). Run from anywhere that
//               can reach amenfarms.netlify.app — a GitHub Actions runner via
//               .github/workflows/draft-audio.yml; sandboxed agents can't.
//   --collect   Poll Firestore for the finished chunks, assemble the mp3s into
//               assets/audio/draft/ + manifest.json, delete the temp docs.
//               Works from the agent sandbox (Firestore IS reachable there).
//   --direct    Straight to the ElevenLabs API with ELEVENLABS_API_KEY from
//               tools/.env — the branch-manager pattern, for a human machine.
//
// The family secret for --fire is read out of ffdraft.html rather than
// duplicated here; it is the same one every page ships to the browser.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "audio", "draft");
const FN = "https://amenfarms.netlify.app/.netlify/functions/audiogen-background";
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const COLL = "ffdraft_fam2jan2g";

// One shared aesthetic: an NFL-broadcast draft night. Punchy stingers, and two
// background beds (lobby = pre-draft hang, live = on the clock) that stay OUT
// of the way — they are underneath eight people talking.
const JOBS = [
  { name: "ffd-sfx-fanfare", kind: "sfx", duration_s: 3.5, prompt_influence: 0.55,
    prompt: "triumphant sports television draft pick announcement stinger, punchy brass fanfare hit with snare drum flourish, quick rising sweep into a big impact, stadium energy, clean tail, no voices" },
  { name: "ffd-sfx-yourturn", kind: "sfx", duration_s: 2, prompt_influence: 0.5,
    prompt: "bright confident broadcast alert chime, two rising bell tones with a soft whoosh, on-the-clock notification, clean and short, no voices" },
  { name: "ffd-sfx-buzzer", kind: "sfx", duration_s: 1.5, prompt_influence: 0.7,
    prompt: "arena game clock buzzer, single harsh sustained electric buzz, sharp attack, abrupt clean stop, no voices" },
  { name: "ffd-sfx-done", kind: "sfx", duration_s: 4.5, prompt_influence: 0.5,
    prompt: "stadium championship celebration, triumphant brass fanfare finale with big crowd cheer and confetti cannon pops, no voices" },
  { name: "ffd-music-lobby", kind: "music", length_ms: 95000,
    prompt: "smooth confident sports studio bed, warm electric piano and laid-back head-nod beat, subtle brass accents, pre-game anticipation, background music, instrumental, seamless loop" },
  { name: "ffd-music-live", kind: "music", length_ms: 100000,
    prompt: "energetic sports television draft night broadcast bed, driving percussion, pulsing synth bass, confident brass section hits, hype but restrained enough to sit under conversation, background music, instrumental, seamless loop" },
];

// ---- player-name announcements (TTS, voice James, eleven_v3) --------------
// --fire-tts asks the deployed sports function for the live pool and sends the
// first N players in draft order as tts jobs; --collect-tts assembles them into
// assets/audio/draft/say/<pid>.mp3 + say.json for the page's pick reveal.
const SAY_N = Number(process.env.SAY_N || 6);
const SAY_DIR = path.join(OUT_DIR, "say");
const SPORTS_FN = "https://amenfarms.netlify.app/.netlify/functions/sports";

async function poolTop(n) {
  const res = await fetch(SPORTS_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), action: "ff_draftpool", format: "ppr" }),
  });
  const j = await res.json();
  if (!j || !j.ok || !Array.isArray(j.players)) throw new Error("ff_draftpool failed: " + JSON.stringify(j).slice(0, 200));
  return j.players.slice(0, n);   // the pool arrives in draft (rank) order
}
function sayJobs(players) {
  return players.map((p) => ({
    name: "ffd-say-" + p.pid, kind: "tts", voice: "James", model: "eleven_v3",
    prompt: p.name, pid: p.pid, player: p.name,
  }));
}
async function fireTts() {
  const players = await poolTop(SAY_N);
  console.log("firing TTS for:", players.map((p) => p.name).join(", "));
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs: sayJobs(players) }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating in the background)" : await res.text());
  if (res.status !== 202) process.exit(1);
}
async function collectTts() {
  const status = await fsGet("audio_status");
  if (!status) { console.log("no audio_status doc"); process.exit(2); }
  const done = String(status.done || "").split(",").filter(Boolean);
  console.log(`status: ${done.length}/${status.total} done` + (status.failed ? ` · FAILED: ${status.failed}` : ""));
  fs.mkdirSync(SAY_DIR, { recursive: true });
  const sayPath = path.join(SAY_DIR, "say.json");
  const say = fs.existsSync(sayPath) ? JSON.parse(fs.readFileSync(sayPath, "utf8"))
    : { note: "Player-name announcements: ElevenLabs eleven_v3, voice James. tools/_gen-draft-audio.mjs --fire-tts/--collect-tts.", voices: {} };
  let wrote = 0;
  for (const nm of done) {
    if (!/^ffd-say-/.test(nm)) continue;
    const pid = nm.replace("ffd-say-", "");
    const first = await fsGet(`audio_${nm}_c0`);
    if (!first) { console.log(`  ?? ${nm} chunk 0 missing`); continue; }
    let b64 = first.b64;
    for (let i = 1; i < first.parts; i++) { const c = await fsGet(`audio_${nm}_c${i}`); if (!c) { b64 = null; break; } b64 += c.b64; }
    if (!b64) { console.log(`  ?? ${nm} incomplete`); continue; }
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(path.join(SAY_DIR, pid + ".mp3"), buf);
    say.voices[pid] = { file: pid + ".mp3", bytes: buf.length };
    wrote++;
    console.log(`  ok say/${pid}.mp3 (${buf.length} bytes)`);
    for (let i = 0; i < first.parts; i++) await fsDelete(`audio_${nm}_c${i}`);
  }
  if (wrote) {
    fs.writeFileSync(sayPath, JSON.stringify(say, null, 2) + "\n");
    await fsDelete("audio_status");
    console.log(`say.json updated (${Object.keys(say.voices).length} voiced players) — commit assets/audio/draft/say/`);
  } else { console.log("nothing collected"); process.exit(3); }
}

function familySecret() {
  const src = fs.readFileSync(path.join(ROOT, "ffdraft.html"), "utf8");
  const m = /var FAMILY_PASSWORD = "([^"]+)"/.exec(src);
  if (!m) throw new Error("FAMILY_PASSWORD not found in ffdraft.html");
  return m[1];
}

async function fire() {
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs: JOBS }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating in the background)" : await res.text());
  if (res.status !== 202) process.exit(1);
}

async function fsGet(docId) {
  const r = await fetch(`${FS_BASE}/${COLL}/${docId}?key=${FS_KEY}`);
  if (r.status === 404) return null;
  const j = await r.json();
  const out = {};
  for (const [k, v] of Object.entries(j.fields || {})) out[k] = v.stringValue ?? Number(v.integerValue);
  return out;
}
async function fsDelete(docId) {
  await fetch(`${FS_BASE}/${COLL}/${docId}?key=${FS_KEY}`, { method: "DELETE" });
}

async function collect() {
  const status = await fsGet("audio_status");
  if (!status) { console.log("no audio_status doc — has the workflow fired?"); process.exit(2); }
  const done = String(status.done || "").split(",").filter(Boolean);
  console.log(`status: ${done.length}/${status.total} done` + (status.failed ? ` · FAILED: ${status.failed}` : ""));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { note: "Generated by tools/_gen-draft-audio.mjs (ElevenLabs). Regenerate with --fire (Actions) + --collect, or --direct with tools/.env.", files: [] };
  let all = true;
  for (const job of JOBS) {
    if (!done.includes(job.name)) { console.log(`  … ${job.name} not finished`); all = false; continue; }
    const first = await fsGet(`audio_${job.name}_c0`);
    if (!first) { console.log(`  ?? ${job.name} marked done but chunk 0 missing`); all = false; continue; }
    let b64 = first.b64;
    for (let i = 1; i < first.parts; i++) {
      const c = await fsGet(`audio_${job.name}_c${i}`);
      if (!c) { b64 = null; break; }
      b64 += c.b64;
    }
    if (!b64) { console.log(`  ?? ${job.name} chunk missing`); all = false; continue; }
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(path.join(OUT_DIR, job.name + ".mp3"), buf);
    manifest.files.push({ file: job.name + ".mp3", key: job.name.replace(/^ffd-(sfx|music)-/, "$1-"),
      kind: job.kind, bytes: buf.length, prompt: job.prompt });
    console.log(`  ok ${job.name}.mp3 (${buf.length} bytes)`);
  }
  if (all && manifest.files.length === JOBS.length) {
    fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    for (const job of JOBS) {
      const first = await fsGet(`audio_${job.name}_c0`);
      for (let i = 0; i < ((first && first.parts) || 1); i++) await fsDelete(`audio_${job.name}_c${i}`);
    }
    await fsDelete("audio_status");
    console.log("manifest written, temp docs cleaned up — commit assets/audio/draft/");
  } else {
    console.log("incomplete — re-run --collect in a minute, or check audio_status for failures");
    process.exit(3);
  }
}

async function direct() {
  const envPath = path.join(ROOT, "tools", ".env");
  const line = fs.readFileSync(envPath, "utf8").split("\n").find((l) => l.startsWith("ELEVENLABS_API_KEY="));
  const key = line && line.slice(line.indexOf("=") + 1).trim();
  if (!key) throw new Error("ELEVENLABS_API_KEY not found in tools/.env");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const manifest = { note: "Generated by tools/_gen-draft-audio.mjs (ElevenLabs).", files: [] };
  for (const job of JOBS) {
    const isMusic = job.kind === "music";
    const res = await fetch("https://api.elevenlabs.io/v1" + (isMusic ? "/music" : "/sound-generation") + "?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify(isMusic
        ? { prompt: job.prompt, music_length_ms: job.length_ms, force_instrumental: true }
        : { text: job.prompt, model_id: "eleven_text_to_sound_v2", prompt_influence: job.prompt_influence, loop: false, duration_seconds: job.duration_s }),
    });
    if (!res.ok) throw new Error(`${job.name}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(OUT_DIR, job.name + ".mp3"), buf);
    manifest.files.push({ file: job.name + ".mp3", key: job.name.replace(/^ffd-(sfx|music)-/, "$1-"), kind: job.kind, bytes: buf.length, prompt: job.prompt });
    console.log(`  ok ${job.name}.mp3 (${buf.length} bytes)`);
  }
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

const mode = process.argv[2];
if (mode === "--fire") fire();
else if (mode === "--collect") collect();
else if (mode === "--direct") direct();
else if (mode === "--fire-tts") fireTts();
else if (mode === "--collect-tts") collectTts();
else { console.log("usage: node tools/_gen-draft-audio.mjs --fire | --collect | --direct | --fire-tts | --collect-tts"); process.exit(1); }
