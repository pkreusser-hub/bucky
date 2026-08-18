// ElevenLabs asset generator, background flavor. POST { secret, jobs:[...] } -> 202.
//
// Music generation runs 30-120s per track — far past the synchronous function
// cap that killed TeacherGPT's first in-function attempts, hence "-background"
// (15-minute allowance, caller gets its 202 immediately). Results are handed
// off through Firestore, the same channel TeacherGPT polls: each finished mp3
// is written base64-chunked into ffdraft_<famKey>/audio_<name>_c<i> (chunked
// because a 90s music track is ~2MB of base64 against Firestore's 1MB doc
// cap), with audio_status tracking done/failed for the collector to poll.
// Writes use the public web API key exactly as the pages do — that collection's
// rules are already open to it, and nothing here needs the service account.
//
// This is TOOLING, not a page dependency: tools/_gen-draft-audio.mjs fires it,
// collects the chunks into committed files under assets/audio/, and deletes
// the temp docs. The pages only ever play the committed files.
//
// jobs: [{ name, kind:"sfx"|"music", prompt,
//          duration_s?, prompt_influence?,   (sfx: 0.5-22s)
//          length_ms? }]                     (music: 10s-300s)

const XI = "https://api.elevenlabs.io/v1";
const PROJECT_ID = "amen-farms-app";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";   // the public web key every page carries
const COLL = "ffdraft_fam2jan2g";
const CHUNK = 700000;   // base64 chars per doc, comfortably under the 1MB doc cap

async function fsSet(docId, fields) {
  const props = {};
  for (const [k, v] of Object.entries(fields)) {
    props[k] = typeof v === "number" ? { integerValue: String(v) } : { stringValue: String(v) };
  }
  await fetch(`${FS_BASE}/${COLL}/${docId}?key=${FS_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: props }),
  });
}

async function xiAudio(key, pathSeg, body) {
  const res = await fetch(XI + pathSeg + "?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Voice lookup by name, cached per invocation — "James" etc. resolve against
// the account's voice list so nothing here hardcodes a voice id.
let voiceCache = null;
async function voiceIdByName(key, name) {
  if (!voiceCache) {
    const r = await fetch(XI + "/voices", { headers: { "xi-api-key": key } });
    if (!r.ok) throw new Error("voices HTTP " + r.status);
    voiceCache = (await r.json()).voices || [];
  }
  const want = String(name).toLowerCase();
  const hit = voiceCache.find((v) => String(v.name).toLowerCase() === want)
    || voiceCache.find((v) => String(v.name).toLowerCase().startsWith(want));
  if (!hit) throw new Error("voice '" + name + "' not in account; have: " +
    voiceCache.map((v) => v.name).slice(0, 20).join(", "));
  return hit.voice_id;
}

async function fsExists(docId) {
  const r = await fetch(`${FS_BASE}/${COLL}/${docId}?key=${FS_KEY}&mask.fieldPaths=name`);
  return r.ok;
}

async function runJobs(body) {
  const key = process.env.ELEVENLABS_API_KEY;
  // Cap raised from 12 for the 200-player announcement batch. Generation is
  // sequential (one in-flight ElevenLabs request), and jobs whose result
  // chunks already sit in Firestore are skipped — so if the 15-minute
  // background window dies mid-batch, firing the SAME list again resumes
  // where it stopped instead of paying for the first half twice.
  const jobs = Array.isArray(body.jobs) ? body.jobs.slice(0, 220) : [];
  const done = [], failed = [];
  const stamp = () => fsSet("audio_status", {
    done: done.join(","), failed: failed.map((f) => f.name + ": " + f.detail).join(" | "),
    total: jobs.length, at: Date.now(),
  });
  if (!key) { failed.push({ name: "*", detail: "ELEVENLABS_API_KEY is not set in Netlify" }); await stamp(); return; }
  await stamp();
  for (const job of jobs) {
    const name = String(job.name || "").replace(/[^a-z0-9-]/gi, "").slice(0, 60);
    if (!name || !job.prompt) { failed.push({ name: name || "?", detail: "bad job" }); await stamp(); continue; }
    try {
      if (await fsExists(`audio_${name}_c0`)) { done.push(name); await stamp(); continue; }
      let buf;
      if (job.kind === "tts") {
        // An explicit voice_id skips the lookup — /v1/voices needs its own key
        // permission ("Voices: Read") that a scoped key may not carry.
        const vid = job.voice_id || await voiceIdByName(key, job.voice || "James");
        buf = await xiAudio(key, "/text-to-speech/" + vid, {
          text: String(job.prompt).slice(0, 300),
          model_id: job.model || "eleven_v3",
        });
      } else if (job.kind === "music") {
        const ms = Math.max(10000, Math.min(300000, Number(job.length_ms) || 90000));
        buf = await xiAudio(key, "/music", {
          prompt: String(job.prompt).slice(0, 1000), music_length_ms: ms, force_instrumental: true,
        });
      } else {
        buf = await xiAudio(key, "/sound-generation", {
          text: String(job.prompt).slice(0, 1000),
          model_id: "eleven_text_to_sound_v2",
          prompt_influence: Math.max(0, Math.min(1, Number(job.prompt_influence) || 0.5)),
          loop: false,
          duration_seconds: Math.max(0.5, Math.min(22, Number(job.duration_s) || 2)),
        });
      }
      const b64 = buf.toString("base64");
      const parts = Math.ceil(b64.length / CHUNK);
      for (let i = 0; i < parts; i++) {
        await fsSet(`audio_${name}_c${i}`, {
          name, part: i, parts, bytes: buf.length, b64: b64.slice(i * CHUNK, (i + 1) * CHUNK),
        });
      }
      done.push(name);
    } catch (e) {
      failed.push({ name, detail: String((e && e.message) || e).slice(0, 200) });
    }
    await stamp();
  }
}

export default async (req) => {
  let body;
  try { body = await req.json(); } catch { return new Response("", { status: 400 }); }
  const familySecret = process.env.BUCKY_NOTIFY_SECRET;
  if (!familySecret || !body || body.secret !== familySecret) return new Response("", { status: 401 });
  await runJobs(body);
  return new Response("", { status: 202 });
};
