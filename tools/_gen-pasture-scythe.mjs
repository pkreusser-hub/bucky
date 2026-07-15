// One-off generator for Pasture Panic's scythe-swish SFX (directive 7, 2026-07-15).
// Run: node tools/_gen-pasture-scythe.mjs
// Reads ELEVENLABS_API_KEY from tools/.env (never printed). Writes assets/audio/pasture/
// pp-sfx-scythe-swish.mp3 and appends its entry to that folder's manifest.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "assets", "audio", "pasture");
const MANIFEST_PATH = path.join(OUT_DIR, "manifest.json");

function loadKey() {
  const envPath = path.join(ROOT, "tools", ".env");
  const txt = fs.readFileSync(envPath, "utf8");
  const m = txt.match(/ELEVENLABS_API_KEY\s*=\s*(\S+)/);
  if (!m) throw new Error("ELEVENLABS_API_KEY not found in tools/.env");
  return m[1].trim();
}

const API_KEY = loadKey();
const BASE = "https://api.elevenlabs.io/v1";
const NAME = "pp-sfx-scythe-swish";
const PROMPT = "kid-friendly, cute, cartoonish, family-game, no scary or harsh tones, a quick light scythe blade swish whooshing through tall corn stalks, a soft leafy swipe, playful farm sound";
const DURATION = 0.5;
const INFLUENCE = 0.7;

async function main() {
  const outFile = path.join(OUT_DIR, NAME + ".mp3");
  const res = await fetch(BASE + "/sound-generation?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify({ text: PROMPT, model_id: "eleven_text_to_sound_v2", prompt_influence: INFLUENCE, loop: false, duration_seconds: DURATION })
  });
  if (!res.ok) { const d = await res.text().catch(() => ""); throw new Error(`HTTP ${res.status}: ${d.slice(0, 500)}`); }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, buf);
  console.log(`wrote ${outFile} (${buf.length} bytes)`);
  if (buf.length > 80000) console.warn(`WARN: ${buf.length} bytes exceeds the 80KB budget`);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (!manifest.some(e => e.file === NAME + ".mp3")) {
    manifest.push({
      file: NAME + ".mp3", kind: "sfx", target: `~${DURATION}s`, prompt: PROMPT, bytes: buf.length,
      api: `POST /v1/sound-generation (duration_seconds=${DURATION}, prompt_influence=${INFLUENCE}, loop=false)`
    });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
    console.log("appended manifest entry");
  } else {
    console.log("manifest already has the entry (skipped)");
  }
}
main().catch(e => { console.error("FATAL", e.message); process.exit(1); });
