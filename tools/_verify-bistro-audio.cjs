#!/usr/bin/env node
"use strict";
/**
 * Barnyard Bistro generated-audio verify suite.
 *
 * Two passes against the SAME page, each in a fresh browser context:
 *   BLOCKED  — assets/audio/bistro/* aborted -> every Snd.* call must fall back to its
 *              original synth tone, 0 sample counters ever tick, game stays fully playable.
 *   SAMPLES  — real files served -> buffers decode, gesture unlocks playback, sample
 *              counters tick for the mapped events, music phase machine walks
 *              menu -> cook -> rush -> (silent on day_end) -> menu, 🎵 toggle works +
 *              persists, 🔊 mute still masters everything.
 *
 * Both passes always block Playroom (unpkg) + Firebase/Firestore/gstatic so the game
 * deterministically falls back to solo mode (see initNet()'s `typeof Playroom === "undefined"`
 * branch) — no production data touched, no network flakiness in the assertions.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8865;
const BASE = `http://127.0.0.1:${PORT}`;

const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".mjs": "application/javascript",
  ".json": "application/json", ".css": "text/css", ".mp3": "audio/mpeg", ".png": "image/png",
  ".jpg": "image/jpeg", ".glb": "model/gltf-binary", ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        let filePath = path.join(ROOT, urlPath);
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, "index.html");
        if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("not found"); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
        fs.createReadStream(filePath).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

let PASS = 0, TOTAL = 0;
function check(cond, msg) {
  TOTAL++;
  if (!cond) { console.log("  ✗ " + msg); throw new Error("FAIL: " + msg); }
  PASS++;
  console.log("  ✓ " + msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Blocks Playroom + any Firebase/Firestore/gstatic network so the game deterministically
// falls back to solo mode and never touches production data. `blockAudio` additionally
// aborts assets/audio/bistro/* (the BLOCKED pass).
async function setupInterception(page, blockAudio) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/unpkg\.com\/playroomkit/i.test(url)) { req.abort(); return; }
    if (/googleapis|firestore|firebase|gstatic/i.test(url)) { req.abort(); return; }
    if (blockAudio && /\/assets\/audio\/bistro\//i.test(url)) { req.abort(); return; }
    req.continue();
  });
}

async function bootPage(browser, blockAudio) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  page.on("console", (msg) => { if (msg.type() === "error" && /audio|decode/i.test(msg.text())) { /* informational only */ } });
  await setupInterception(page, blockAudio);
  await page.goto(BASE + "/barnyardbistro.html?fam=famtestbb", { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => !!window.__BB_AUDIO__, { timeout: 30000 });
  await page.waitForFunction(() => window.__BB_AUDIO__.net.ready === true, { timeout: 15000 });
  return { page, errors };
}

// Real OS-level click via CDP — counts as a genuine user gesture for the autoplay policy,
// same trick used by every other headless audio suite in this repo (Farm Kart, Hayhem).
async function unlockGesture(page) {
  await page.mouse.click(640, 400);
  await sleep(150);
}

async function driveGameplayEvents(page) {
  // Enter "playing" phase directly via the debug hook + hostStartLevel (mirrors what the
  // title screen's COOK! button + a level-select card click would do), then drive a handful
  // of safe G-state diffs that the REAL updateSoundReactions() render loop reacts to every
  // frame — this exercises the actual reactive wiring, not just calling Snd.* directly.
  await page.evaluate(() => {
    const A = window.__BB_AUDIO__;
    A.G.titleOpen = false;
    A.hostStartLevel(0, false);
  });
  await sleep(120);
  await page.evaluate(() => {
    const A = window.__BB_AUDIO__, G = A.G;
    // deliver: served++ (dish-serve + coin)
    G.stats.served++;
  });
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.stats.missed++; });   // miss: gentle-miss
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.stats.thrown++; });   // throw: throw-whoosh (fallback path, G.flying stays empty)
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.stats.caught++; });   // catch: catch-thump
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.trashSwishId = (window.__BB_AUDIO__.G.trashSwishId || 0) + 1; });   // trash: trash-swish
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.streakCelebId = (window.__BB_AUDIO__.G.streakCelebId || 0) + 1; window.__BB_AUDIO__.G.streakCelebTier = 3; });   // streak: crowd-cheer layered
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.pan.state = "cooking"; });   // sizzle-start (wiring path)
  await sleep(80);
  // wash tick + wash done: washingChef=me with progress>0 for a frame, then clean++ .
  await page.evaluate(() => {
    const A = window.__BB_AUDIO__, G = A.G;
    G.sink.washingChef = A.net.myChefId;
    G.sink.progress = 0.4;
  });
  await sleep(200);   // several frames so the scrub-tick throttle fires at least once
  await page.evaluate(() => {
    const A = window.__BB_AUDIO__, G = A.G;
    G.plates.clean = (G.plates.clean || 0) + 1;
  });
  await sleep(80);
  await page.evaluate(() => { window.__BB_AUDIO__.G.sink.washingChef = null; window.__BB_AUDIO__.G.sink.progress = 0; });
}

async function runPass(browser, name, blockAudio) {
  console.log(`\n=== PASS: ${name} ===`);
  const { page, errors } = await bootPage(browser, blockAudio);

  console.log(`[${name} 1] boot + buffer state`);
  const boot = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  check(boot.buffersTotal === 16, "manifest declares 16 audio files (13 sfx + 3 music)");
  if (blockAudio) {
    check(boot.buffersLoaded === 0 || boot.buffersLoaded < 16, "BLOCKED: buffers did not fully load yet at boot (aborted)");
  }

  await unlockGesture(page);
  console.log(`[${name} 2] gesture unlock`);
  const afterGesture = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  check(afterGesture.gestured === true, "gesture flag set after a real click");
  check(afterGesture.ctx === "running", "AudioContext resumed to 'running' after the gesture");

  if (!blockAudio) {
    console.log(`[${name} 3] wait for all 16 sample buffers to decode`);
    await page.waitForFunction(() => window.__BB_AUDIO__.Snd.audioState().buffersLoaded === 16, { timeout: 20000 });
    const loaded = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
    check(loaded.buffersLoaded === 16, "all 16 buffers decoded (16/16)");
  } else {
    console.log(`[${name} 3] confirm buffers stay blocked (abort never resolves to a decoded buffer)`);
    await sleep(1200);
    const stillBlocked = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
    check(stillBlocked.buffersLoaded === 0, "BLOCKED: buffersLoaded stayed 0 the whole pass");
  }

  console.log(`[${name} 4] direct Snd.* calls (chop/place/throw/catch/trash/miss/wash/sizzle/munch/streak/deliver)`);
  const direct = await page.evaluate(() => {
    const Snd = window.__BB_AUDIO__.Snd;
    Snd.chopTick();
    Snd.place();
    Snd.whoosh(1);
    Snd.bop();
    Snd.swish();
    Snd.miss();
    Snd.washTick();
    Snd.washDone();
    Snd.sizzleStart();
    Snd.munch();
    Snd.streak();
    Snd.chaChing();
    return Snd.audioState().sfxPlays;
  });
  if (blockAudio) {
    check(Object.values(direct).every((n) => n === 0), "BLOCKED: 0 sample counters ticked from any direct call (all fell back to synth)");
  } else {
    check(direct.chopImpact >= 1, "SAMPLES: chopTick() played bb-sfx-chop-impact");
    check(direct.plateClatter >= 1, "SAMPLES: place() played bb-sfx-plate-clatter");
    check(direct.throwWhoosh >= 1, "SAMPLES: whoosh() played bb-sfx-throw-whoosh");
    check(direct.catchThump >= 1, "SAMPLES: bop() played bb-sfx-catch-thump");
    check(direct.trashSwish >= 1, "SAMPLES: swish() played bb-sfx-trash-swish");
    check(direct.gentleMiss >= 1, "SAMPLES: miss() played bb-sfx-gentle-miss");
    check(direct.splash >= 2, "SAMPLES: washTick()+washDone() both played bb-sfx-splash");
    check(direct.sizzleStart >= 1, "SAMPLES: sizzleStart() played bb-sfx-sizzle-start");
    check(direct.customerMunch >= 1, "SAMPLES: munch() played bb-sfx-customer-munch");
    check(direct.crowdCheer >= 1, "SAMPLES: streak() layered bb-sfx-crowd-cheer on top of the synth flourish");
    check(direct.dishServe >= 1 && direct.coin >= 1, "SAMPLES: chaChing() layered bb-sfx-dish-serve + bb-sfx-coin");
  }

  console.log(`[${name} 5] game is fully playable + real G-state reactive wiring (deliver/miss/throw/catch/trash/streak/sizzle/wash)`);
  const before = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState().sfxPlays);
  await driveGameplayEvents(page);
  const after = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState().sfxPlays);
  const phaseNow = await page.evaluate(() => window.__BB_AUDIO__.G.phase);
  check(phaseNow === "playing", "hostStartLevel(0,false) reached G.phase==='playing' (game is playable)");
  if (blockAudio) {
    check(Object.keys(after).every((k) => after[k] === before[k]), "BLOCKED: reactive wiring drove real gameplay events with 0 new sample plays (still synth-only)");
  } else {
    check(after.dishServe > before.dishServe, "SAMPLES: G.stats.served++ reactively triggered dish-serve (real render-loop wiring)");
    check(after.coin > before.coin, "SAMPLES: G.stats.served++ reactively triggered coin");
    check(after.gentleMiss > before.gentleMiss, "SAMPLES: G.stats.missed++ reactively triggered gentle-miss");
    check(after.throwWhoosh > before.throwWhoosh, "SAMPLES: G.stats.thrown++ reactively triggered throw-whoosh");
    check(after.catchThump > before.catchThump, "SAMPLES: G.stats.caught++ reactively triggered catch-thump");
    check(after.trashSwish > before.trashSwish, "SAMPLES: G.trashSwishId++ reactively triggered trash-swish");
    check(after.crowdCheer > before.crowdCheer, "SAMPLES: streak celebration reactively layered crowd-cheer");
    check(after.sizzleStart > before.sizzleStart, "SAMPLES: G.pan.state->'cooking' reactively triggered sizzle-start");
    check(after.splash > before.splash, "SAMPLES: sink washing reactively triggered splash (tick and/or done)");
  }

  console.log(`[${name} 6] pot-bubble loop (reactive, gain-gated)`);
  await page.evaluate(() => { window.__BB_AUDIO__.G.pot.state = "cooking"; });
  await sleep(250);
  const potOn = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  if (!blockAudio) {
    check(potOn.potLoopOn === true, "SAMPLES: pot-bubble loop source started while G.pot.state==='cooking'");
    check(potOn.potGainV > 0.05, "SAMPLES: pot-bubble loop gain faded up while cooking");
  } else {
    check(potOn.potLoopOn !== true, "BLOCKED: pot-bubble loop never starts without its buffer (synth-fallback tick path only)");
  }
  await page.evaluate(() => { window.__BB_AUDIO__.G.pot.state = "empty"; });
  await sleep(500);
  const potOff = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  if (!blockAudio) check(potOff.potGainV < 0.05, "SAMPLES: pot-bubble loop gain faded back down after cooking stopped");

  console.log(`[${name} 7] music state machine: menu -> cook -> rush -> silent(day_end) -> menu`);
  await page.evaluate(() => { window.__BB_AUDIO__.G.titleOpen = true; });
  await sleep(150);
  const mMenu = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState().musicTrack);
  check(mMenu === "menu", "title screen -> music phase 'menu'");

  await page.evaluate(() => { const G = window.__BB_AUDIO__.G; G.titleOpen = false; G.levelSelectOpen = false; G.phase = "playing"; G.endlessMode = false; G.dayLeft = 120; });
  await sleep(150);
  const mCook = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState().musicTrack);
  check(mCook === "cook", "playing + dayLeft>30 -> music phase 'cook'");

  await page.evaluate(() => { window.__BB_AUDIO__.G.dayLeft = 20; });
  await sleep(150);
  const mRush = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState().musicTrack);
  check(mRush === "rush", "playing + dayLeft<=30 (non-endless) -> music phase 'rush'");

  await page.evaluate(() => { window.__BB_AUDIO__.G.phase = "day_end"; });
  await sleep(150);
  const mEnd = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  check(mEnd.musicTrack === null, "day_end -> music phase silent (null) — victory() fanfare plays over silence, layered not replaced");

  await page.evaluate(() => { const G = window.__BB_AUDIO__.G; G.phase = "playing"; G.levelSelectOpen = true; });
  await sleep(150);
  const mBack = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState().musicTrack);
  check(mBack === "menu", "level-select re-open -> music phase back to 'menu'");

  if (!blockAudio) {
    // crossfade sanity: after settling on 'cook', its own gain should be > any other track's.
    await page.evaluate(() => { const G = window.__BB_AUDIO__.G; G.titleOpen = false; G.levelSelectOpen = false; G.dayLeft = 120; });
    await sleep(700);
    const st = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
    check(st.musicTrack === "cook" && st.musicGainV > 0, "SAMPLES: musicBus audible on the active 'cook' track after the crossfade settles");
  }

  // close the level-select overlay (z-index 51) so the top-right HUD buttons (z-index 31)
  // are actually clickable again — it was reopened by the music-phase test above.
  await page.evaluate(() => { const G = window.__BB_AUDIO__.G; G.levelSelectOpen = false; G.titleOpen = false; });
  await sleep(100);

  console.log(`[${name} 8] 🎵 music toggle (independent of 🔊 mute, persists)`);
  const musicOffBefore = await page.evaluate(() => window.__BB_AUDIO__.Snd.isMusicOff());
  check(musicOffBefore === false, "music starts NOT off by default");
  await page.click("#musicBtn");
  await sleep(80);
  const afterToggle = await page.evaluate(() => ({ off: window.__BB_AUDIO__.Snd.isMusicOff(), gain: window.__BB_AUDIO__.Snd.audioState().musicGainV, ls: localStorage.getItem("bb_music_off") }));
  check(afterToggle.off === true, "🎵 click toggled Snd.isMusicOff() to true");
  check(afterToggle.gain === 0, "🎵 off instantly zeroed the music bus gain");
  check(afterToggle.ls === "1", "🎵 off persisted to localStorage bb_music_off");
  await page.click("#musicBtn");
  await sleep(80);
  const afterToggle2 = await page.evaluate(() => ({ off: window.__BB_AUDIO__.Snd.isMusicOff(), ls: localStorage.getItem("bb_music_off") }));
  check(afterToggle2.off === false, "🎵 click again toggled music back on");
  check(afterToggle2.ls === "0", "music-on persisted to localStorage");

  console.log(`[${name} 9] 🔊 mute still masters everything (SFX + music)`);
  const muteBefore = await page.evaluate(() => window.__BB_AUDIO__.Snd.isMuted());
  check(muteBefore === false, "starts unmuted");
  await page.click("#muteBtn");
  await sleep(80);
  const muteState = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  // Bistro's original mute design (pre-dating this batch, kept unchanged) is an early-return
  // inside tone()/noiseTock()/playSample() rather than a gain node zeroed to 0 — muted===true
  // is the single kill switch every sound-producing function checks, for both synth AND samples.
  check(muteState.muted === true, "🔊 click set Snd.isMuted() true (single kill switch checked by every Snd.* call, synth + samples)");
  const mutedPlay = await page.evaluate(() => {
    const before = window.__BB_AUDIO__.Snd.audioState().sfxPlays.coin;
    window.__BB_AUDIO__.Snd.chaChing();
    const after = window.__BB_AUDIO__.Snd.audioState().sfxPlays.coin;
    return after === before;
  });
  check(mutedPlay, "playSample() refuses to play (and count) while muted — 🔊 masters samples same as synth");
  await page.click("#muteBtn");
  await sleep(80);
  const unmuted = await page.evaluate(() => window.__BB_AUDIO__.Snd.audioState());
  check(unmuted.muted === false, "🔊 click again restored Snd.isMuted() to false (unmuted)");

  console.log(`[${name} 10] pageerrors`);
  check(errors.length === 0, `0 JS pageerrors this pass (got ${errors.length}${errors.length ? ": " + errors[0] : ""})`);

  await page.close();
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) server = await startServer();
  else console.log(`(reusing server already listening on ${PORT})`);

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  try {
    await runPass(browser, "BLOCKED", true);
    await runPass(browser, "SAMPLES", false);
  } finally {
    await browser.close();
    if (server) server.close();
  }

  console.log(`\n${PASS}/${TOTAL} checks passed.`);
  if (PASS !== TOTAL) process.exit(1);
}

main().catch((e) => { console.error("\nFATAL:", e.message); process.exit(1); });
