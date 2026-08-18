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
  // SAY_VOICE_ID (workflow input) bypasses the by-name lookup for keys without
  // the "Voices: Read" permission.
  return players.map((p) => ({
    name: "ffd-say-" + p.pid, kind: "tts", voice: "James", model: "eleven_v3",
    voice_id: process.env.SAY_VOICE_ID || undefined,
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
// ---- the full player announcements: top-200, phonetic, full format ---------
// "[excitedly] JAH-meer GIBZ, Running Back, Detroit Lions!" — respellings from
// tools/_pronunciations.json (family-supplied broadcast guide; CAPITALS mark
// the stressed syllable), matched to the live pool by normalized name so every
// clip is keyed by the pid the room actually drafts. The pool's OWN proTeam is
// the team truth (trades move faster than spreadsheets).
const POS_FULL = { QB: "Quarterback", RB: "Running Back", WR: "Wide Receiver", TE: "Tight End", K: "Kicker" };
const NFL_FULL = {
  ARI: "Arizona Cardinals", ATL: "Atlanta Falcons", BAL: "Baltimore Ravens", BUF: "Buffalo Bills",
  CAR: "Carolina Panthers", CHI: "Chicago Bears", CIN: "Cincinnati Bengals", CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys", DEN: "Denver Broncos", DET: "Detroit Lions", GB: "Green Bay Packers",
  HOU: "Houston Texans", IND: "Indianapolis Colts", JAX: "Jacksonville Jaguars", KC: "Kansas City Chiefs",
  LAC: "Los Angeles Chargers", LAR: "Los Angeles Rams", LV: "Las Vegas Raiders", MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings", NE: "New England Patriots", NO: "New Orleans Saints", NYG: "New York Giants",
  NYJ: "New York Jets", PHI: "Philadelphia Eagles", PIT: "Pittsburgh Steelers", SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers", TB: "Tampa Bay Buccaneers", TEN: "Tennessee Titans", WSH: "Washington Commanders",
  WAS: "Washington Commanders",
};
const normName = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, "");
// Two variants per player. PLAIN (real spelling) is the DEFAULT the room
// plays — eleven_v3 turned out to read broadcast respellings worse than the
// names themselves (2026-08-18, the phonetic batch). The phonetic set is kept
// parked under say/ph/ as per-player alternates for names the plain read gets
// wrong. Distinct job prefixes (ffd-say- / ffd-sayph-) keep the two runs from
// ever colliding in the resume-skip logic.
function playerAnnounceJobs(pool, upTo, style) {
  const guide = JSON.parse(fs.readFileSync(path.join(__dirname, "_pronunciations.json"), "utf8")).players;
  const byName = new Map(pool.map((p) => [normName(p.name), p]));
  const jobs = [], missing = [];
  for (const row of guide) {
    if (row.rank > upTo) break;
    const p = byName.get(normName(row.player));
    if (!p) { missing.push(row.player); continue; }
    const posFull = POS_FULL[p.pos] || p.pos;
    const teamFull = NFL_FULL[p.proTeam] || NFL_FULL[row.team] || row.team;
    const phonetic = style === "phonetic";
    jobs.push({
      name: (phonetic ? "ffd-sayph-" : "ffd-say-") + p.pid, kind: "tts", voice: "James", model: "eleven_v3",
      voice_id: process.env.SAY_VOICE_ID || undefined,
      prompt: "[excitedly] " + (phonetic ? row.phonetic : p.name) + ", " + posFull + ", " + teamFull + "!",
    });
  }
  if (missing.length) console.log("NOT IN LIVE POOL (skipped):", missing.join(", "));
  return jobs;
}
async function firePlayers() {
  const pool = await poolTop(400);
  const jobs = playerAnnounceJobs(pool, Number(process.env.SAY_N || 200), process.env.SAY_STYLE || "plain");
  console.log(jobs.length, "announcement jobs; first:", jobs[0] && jobs[0].prompt, "| last:", jobs[jobs.length - 1] && jobs[jobs.length - 1].prompt);
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating in the background; re-fire resumes if the window dies)" : await res.text());
  if (res.status !== 202) process.exit(1);
}

// ---- defenses: "The Denver Broncos Defense!" -------------------------------
async function fireDst() {
  const pool = await poolTop(400);
  const dst = pool.filter((p) => p.pos === "D/ST").slice(0, Number(process.env.SAY_N || 20));
  const jobs = dst.map((p) => ({
    name: "ffd-say-" + p.pid, kind: "tts", voice: "James", model: "eleven_v3",
    voice_id: process.env.SAY_VOICE_ID || undefined,
    prompt: "[excitedly] The " + (NFL_FULL[p.proTeam] || p.name.replace(/ D\/ST$/, "")) + " Defense!",
  }));
  jobs.forEach((j) => console.log(" ", j.name, "→", j.prompt));
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating)" : await res.text());
  if (res.status !== 202) process.exit(1);
}

// ---- team lead-ins: "The <team> select..." ---------------------------------
// One clip per ESPN team, stitched in front of the player clip at play time.
// Spellings here are PHONETIC where the real name would misread — they are for
// the announcer's mouth, never for the screen.
const TEAM_PHONETIC = {
  "Battle Kreussers": "The Battle Kruzers select",
  "Elanikan Skywalkers": "The Elanikin Skywalkers select",
  "The GOAT Kids": "The Goat Kids select",   // caps would risk G-O-A-T
};
function teamLeadText(name) {
  const clean = String(name).replace(/\s+/g, " ").trim();
  if (TEAM_PHONETIC[clean]) return TEAM_PHONETIC[clean];
  if (/^the /i.test(clean)) return clean + " select";
  if (/s$/i.test(clean)) return "The " + clean + " select";
  return clean + " selects";   // singular-collective names ("Kruz Control")
}
async function fireTeams() {
  const res0 = await fetch(SPORTS_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), action: "ff_draftinfo" }),
  });
  const info = await res0.json();
  if (!info || !info.ok || !Array.isArray(info.teams)) throw new Error("ff_draftinfo failed");
  const jobs = info.teams.map((t) => ({
    name: "ffd-say-team-" + t.id, kind: "tts", voice: "James", model: "eleven_v3",
    voice_id: process.env.SAY_VOICE_ID || undefined,
    prompt: "[excitedly] " + teamLeadText(t.name) + "...",
  }));
  jobs.forEach((j) => console.log(" ", j.name, "→", j.prompt));
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating)" : await res.text());
  if (res.status !== 202) process.exit(1);
}

// One-off audition clip for the full announcement format — listen at
// /assets/audio/draft/say/test-announce.mp3 once collected and committed.
async function fireAnnounceTest() {
  const job = {
    name: "ffd-say-test-announce", kind: "tts", voice: "James", model: "eleven_v3",
    voice_id: process.env.SAY_VOICE_ID || undefined,
    prompt: "[excitedly] The Battle Kreussers select... CeeDee Lamb, Wide Receiver, Dallas Cowboys!",
  };
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs: [job] }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating)" : await res.text());
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
  // COLLECT_AS=ph routes everything into the phonetic alternates dir — the
  // one-time escape hatch for chunks generated under the plain prefix before
  // the prefixes split.
  const forcePh = process.env.COLLECT_AS === "ph";
  fs.mkdirSync(path.join(SAY_DIR, "ph"), { recursive: true });
  say.phonetic = say.phonetic || {};
  for (const nm of done) {
    const isPh = forcePh || /^ffd-sayph-/.test(nm);
    if (!/^ffd-say(ph)?-/.test(nm)) continue;
    const pid = nm.replace(/^ffd-say(ph)?-/, "");
    const first = await fsGet(`audio_${nm}_c0`);
    if (!first) { console.log(`  ?? ${nm} chunk 0 missing`); continue; }
    let b64 = first.b64;
    for (let i = 1; i < first.parts; i++) { const c = await fsGet(`audio_${nm}_c${i}`); if (!c) { b64 = null; break; } b64 += c.b64; }
    if (!b64) { console.log(`  ?? ${nm} incomplete`); continue; }
    const buf = Buffer.from(b64, "base64");
    const rel = isPh ? path.join("ph", pid + ".mp3") : pid + ".mp3";
    fs.writeFileSync(path.join(SAY_DIR, rel), buf);
    (isPh ? say.phonetic : say.voices)[pid] = { file: rel.replace(/\\/g, "/"), bytes: buf.length };
    wrote++;
    console.log(`  ok say/${rel} (${buf.length} bytes)`);
    for (let i = 0; i < first.parts; i++) await fsDelete(`audio_${nm}_c${i}`);
  }
  if (wrote) {
    fs.writeFileSync(sayPath, JSON.stringify(say, null, 2) + "\n");
    await fsDelete("audio_status");
    console.log(`say.json updated (${Object.keys(say.voices).length} voiced players) — commit assets/audio/draft/say/`);
  } else { console.log("nothing collected"); process.exit(3); }
}

// ---- extra live-draft beds: variety for a two-hour room --------------------
// Five more styles, all instrumental and all mixed to sit UNDER eight people
// talking. The page shuffles everything named music-live* into one rotation.
const MUSIC2_JOBS = [
  ["ffd-music-live2", "confident funky sports show bed, wah guitar, tight drum breaks, punchy horn stabs, head-nod groove, background music, instrumental, seamless loop", 110000],
  ["ffd-music-live3", "cinematic NFL Films style orchestral bed, noble french horns, rolling snare marches, sweeping strings, heroic but restrained, background music, instrumental, seamless loop", 115000],
  ["ffd-music-live4", "driving stadium rock bed, palm-muted electric guitars, punchy drums, big arena energy kept under conversation, background music, instrumental, seamless loop", 110000],
  ["ffd-music-live5", "pulsing synthwave sports bed, analog arpeggios, steady four-on-the-floor, neon late-night energy, background music, instrumental, seamless loop", 110000],
  // live6 (big band swing) was generated, auditioned, and CUT — the user's
  // call, 2026-08-18: it didn't fit the room. Don't regenerate it.
];
async function fireMusic2() {
  const jobs = MUSIC2_JOBS.map(([name, prompt, ms]) => ({ name, kind: "music", prompt, length_ms: ms }));
  const res = await fetch(FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: familySecret(), jobs }),
  });
  console.log("fire ->", res.status, res.status === 202 ? "(generating — music runs a few minutes a track)" : await res.text());
  if (res.status !== 202) process.exit(1);
}
async function collectMusic2() {
  const status = await fsGet("audio_status");
  if (!status) { console.log("no audio_status doc"); process.exit(2); }
  const done = String(status.done || "").split(",").filter(Boolean);
  console.log(`status: ${done.length}/${status.total} done` + (status.failed ? ` · FAILED: ${status.failed}` : ""));
  const manPath = path.join(OUT_DIR, "manifest.json");
  const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
  let wrote = 0;
  for (const [name, prompt] of MUSIC2_JOBS.map((j) => [j[0], j[1]])) {
    if (!done.includes(name)) { console.log(`  … ${name} not finished`); continue; }
    const first = await fsGet(`audio_${name}_c0`);
    if (!first) { console.log(`  ?? ${name} chunk 0 missing`); continue; }
    let b64 = first.b64;
    for (let i = 1; i < first.parts; i++) { const c = await fsGet(`audio_${name}_c${i}`); if (!c) { b64 = null; break; } b64 += c.b64; }
    if (!b64) { console.log(`  ?? ${name} incomplete`); continue; }
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(path.join(OUT_DIR, name + ".mp3"), buf);
    const key = name.replace(/^ffd-(sfx|music)-/, "$1-");
    man.files = man.files.filter((f) => f.key !== key);
    man.files.push({ file: name + ".mp3", key, kind: "music", bytes: buf.length, prompt });
    wrote++;
    console.log(`  ok ${name}.mp3 (${buf.length} bytes)`);
    for (let i = 0; i < first.parts; i++) await fsDelete(`audio_${name}_c${i}`);
  }
  if (wrote === MUSIC2_JOBS.length) {
    fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + "\n");
    await fsDelete("audio_status");
    console.log("manifest updated (" + man.files.length + " files) — commit assets/audio/draft/");
  } else { console.log("incomplete — re-run in a minute"); process.exit(3); }
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
else if (mode === "--fire-announce") fireAnnounceTest();
else if (mode === "--fire-teams") fireTeams();
else if (mode === "--fire-players") firePlayers();
else if (mode === "--fire-dst") fireDst();
else if (mode === "--fire-music2") fireMusic2();
else if (mode === "--collect-music2") collectMusic2();
else if (mode === "--collect-tts") collectTts();
else { console.log("usage: node tools/_gen-draft-audio.mjs --fire | --collect | --direct | --fire-tts | --collect-tts"); process.exit(1); }
