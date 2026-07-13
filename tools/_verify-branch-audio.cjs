#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Branch Manager generated audio (assets/audio/branch/, ElevenLabs)
 * layered on top of the existing Karplus-Strong synth (the game's original Korobeiniki
 * banjo tune, kept as the 'play' phase's fallback). Mirrors the Farm Kart / Hayhem
 * audio-verify pattern: TWO PASSES.
 *
 *  1) BLOCKED — assets/audio/branch/* aborted. Buffers never decode; every sample-aware
 *     wrapper must fall straight back to its ORIGINAL synth call (move/rotate/lock/line-
 *     clear/level-up/game-over all synth beeps; gameplay music = the original plucked-
 *     banjo scheduler). A full game (start -> move -> rotate -> soft-drop -> lock a piece
 *     -> game over) must still play with 0 pageerrors.
 *  2) SAMPLES — served normally. All 10 wired files decode (bm-music-play-alt.mp3 is
 *     intentionally NOT wired, so buffersTotal stays 10), gesture-unlock starts menu
 *     music, Start crossfades to the gameplay loop, per-event samples fire (move/rotate/
 *     lock/line-clear/tetris/level-up/game-over/ui), the danger crossfade kicks in when
 *     the stack is forced near the top, and both the 🔊 mute + 🎵 music toggle work and
 *     persist.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8865;
const BASE = `http://127.0.0.1:${PORT}`;

function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) {
      try {
        await new Promise((res, rej) => {
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

async function runPass(browser, { blockAudio, viewport, label }) {
  console.log(`\n=== PASS: ${label} ===`);
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    if (blockAudio && /\/assets\/audio\/branch\//i.test(u)) return req.abort();
    req.continue();
  });

  await page.goto(BASE + "/branchmanager.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!window.__BM_AUDIO__, { timeout: 20000 });

  // first real gesture (unlocks AudioContext playback + starts menu music if buffers ready)
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.up();

  if (!blockAudio) {
    await page.waitForFunction(
      () => { const a = window.__BM_AUDIO__.audioState(); return a.buffersLoaded >= a.buffersTotal; },
      { timeout: 20000 }
    ).catch(() => {});
  }

  const boot = await page.evaluate((blockAudio) => {
    const A = window.__BM_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const a0 = A.audioState();
    check("audio ctx exists", a0.ctxState === "running" || a0.ctxState === "suspended", a0.ctxState);
    check("unmuted masterGain 1", a0.masterGain === 1, a0.masterGain);
    check("gesture registered", a0.audioGestured === true, a0.audioGestured);
    check("buffersTotal is 11 (3 music + 8 sfx; play-alt intentionally unwired)", a0.buffersTotal === 11, a0.buffersTotal);
    if (blockAudio) {
      check("no buffers loaded (blocked)", a0.buffersLoaded === 0, a0.buffersLoaded);
    } else {
      check("all 11 buffers loaded", a0.buffersLoaded === 11, a0.buffersLoaded);
    }
    check("music phase is menu (title screen)", a0.musicTrack === "menu", a0.musicTrack);
    if (!blockAudio) check("menu music source present", a0.menuOn === true, a0.menuOn);
    else check("menu music source absent (blocked)", a0.menuOn === false, a0.menuOn);
    return out;
  }, blockAudio).catch((e) => [{ name: "boot checks", pass: false, detail: String(e && e.message || e) }]);

  // real UI flow: click Start (a real user gesture too), then drive real keyboard input.
  await page.click("#startBtn");
  await page.waitForFunction(() => document.getElementById("startOverlay").classList.contains("show") === false, { timeout: 5000 }).catch(() => {});

  const playFlow = await page.evaluate(async (blockAudio) => {
    const A = window.__BM_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    await sleep(150);
    const a1 = A.audioState();
    check("music phase is play after Start", a1.musicTrack === "play", a1.musicTrack);
    if (!blockAudio) {
      check("play music source present", a1.playOn === true, a1.playOn);
      check("synth fallback NOT running (sample covers it)", a1.synthPlaying === false, a1.synthPlaying);
    } else {
      check("synth fallback running (blocked, sample missing)", a1.synthPlaying === true, a1.synthPlaying);
    }
    return out;
  }, blockAudio).catch((e) => [{ name: "play-phase checks", pass: false, detail: String(e && e.message || e) }]);

  // real keyboard input: move left/right, rotate both ways, soft-drop, wait for a lock.
  const before = await page.evaluate(() => Object.assign({}, window.__BM_AUDIO__.audioState().sfxPlays));
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");    // rotate CW
  await page.keyboard.down("KeyZ"); await page.keyboard.up("KeyZ"); // rotate CCW
  await page.keyboard.down("ArrowDown");
  await new Promise((r) => setTimeout(r, 900));
  await page.keyboard.up("ArrowDown");
  const afterInput = await page.evaluate(() => Object.assign({}, window.__BM_AUDIO__.audioState().sfxPlays));

  const inputChecks = [
    { name: "move sfx counter ticked", pass: afterInput.move > before.move, detail: before.move + "->" + afterInput.move },
    { name: "rotate sfx counter ticked", pass: afterInput.rotate > before.rotate, detail: before.rotate + "->" + afterInput.rotate },
    { name: "soft-drop sfx counter ticked", pass: afterInput.softDrop > before.softDrop, detail: before.softDrop + "->" + afterInput.softDrop },
  ];

  // force a deterministic lock + line clear + level-up + danger + game-over via the real
  // functions (exposed as test hooks) — real timing for a natural piece to fall + clear a
  // full row is slow/non-deterministic to drive through key input alone; the move/rotate/
  // soft-drop counters above already prove the real-input path.
  const hookChecks = await page.evaluate(async (blockAudio) => {
    const A = window.__BM_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    let threw = null;
    try {
      const b1 = Object.assign({}, A.audioState().sfxPlays);
      A._testLock();
      const a1 = A.audioState().sfxPlays;
      check("lock sfx counter ticked", a1.lock > b1.lock, b1.lock + "->" + a1.lock);

      A._testLineClear(2);
      const a2 = A.audioState().sfxPlays;
      check("2-line clear sfx counter ticked (not tetris)", a2.lineClear > b1.lineClear && a2.tetris === b1.tetris, JSON.stringify({ lineClear: a2.lineClear, tetris: a2.tetris }));

      A._testLineClear(4);
      const a3 = A.audioState().sfxPlays;
      check("4-line (tetris) clear plays the bigger flourish", a3.tetris > a2.tetris, a2.tetris + "->" + a3.tetris);

      A._testLevelUp();
      const a4 = A.audioState().sfxPlays;
      check("level-up sfx counter ticked", a4.levelUp > a3.levelUp, a3.levelUp + "->" + a4.levelUp);

      // danger crossfade — fill the real board's top danger row so the genuine per-frame
      // computeDanger()/updateDanger() path (which runs every frame off the real board and
      // would otherwise immediately overwrite any manually-poked flag) drives the crossfade.
      // fadeGainTo schedules a WebAudio ramp (linearRampToValueAtTime) — gain.value only
      // catches up as the audio clock renders + a couple of rAF frames tick updateDanger(),
      // so the check must wait past that before reading it back.
      A._testFillTop();
      await sleep(900);   // real crossfade ramp is 0.7s (non-snap, updateDanger() doesn't pass snap)
      const dangerOn = A.audioState();
      check("dangerActive flag set (real board top-row fill)", dangerOn.dangerActive === true, dangerOn.dangerActive);
      if (!blockAudio) {
        check("danger crossfade raises dangerGainV", (dangerOn.dangerGainV || 0) > 0.5, dangerOn.dangerGainV);
        check("danger crossfade lowers playGainV", (dangerOn.playGainV != null ? dangerOn.playGainV : 1) < 0.5, dangerOn.playGainV);
      }
      A._testClearTop();
      await sleep(900);
      const dangerOff = A.audioState();
      check("dangerActive flag cleared (real board top-row cleared)", dangerOff.dangerActive === false, dangerOff.dangerActive);
      if (!blockAudio) check("danger crossfade restores playGainV", (dangerOff.playGainV || 0) > 0.5, dangerOff.playGainV);

      // game over: stop + womp, then menu music eases back in
      const b5 = Object.assign({}, A.audioState().sfxPlays);
      A._testGameOver();
      const a5 = A.audioState();
      check("game-over sfx counter ticked", a5.sfxPlays.gameOver > b5.gameOver, b5.gameOver + "->" + a5.sfxPlays.gameOver);
      check("music phase silenced immediately on game over", a5.musicTrack === null, a5.musicTrack);
      check("game-over overlay shown", document.getElementById("overlay").classList.contains("show"), true);
    } catch (e) { threw = String(e && e.message || e); }
    check("no exceptions thrown across the whole hook-driven sequence", threw === null, threw);

    return out;
  }, blockAudio).catch((e) => [{ name: "hook checks", pass: false, detail: String(e && e.message || e) }]);

  await page.close();
  const allChecks = [].concat(boot, playFlow, inputChecks, hookChecks);
  return { checks: allChecks, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  let totalPass = 0, totalFail = 0;
  const passes = [];
  passes.push(["BLOCKED desktop", await runPass(browser, { blockAudio: true, viewport: { width: 1280, height: 800 }, label: "BLOCKED desktop" })]);
  passes.push(["SAMPLES desktop", await runPass(browser, { blockAudio: false, viewport: { width: 1280, height: 800 }, label: "SAMPLES desktop" })]);
  passes.push(["SAMPLES mobile", await runPass(browser, { blockAudio: false, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, label: "SAMPLES mobile" })]);
  passes.push(["BLOCKED mobile", await runPass(browser, { blockAudio: true, viewport: { width: 390, height: 844, isMobile: true, hasTouch: true }, label: "BLOCKED mobile" })]);

  for (const [label, pass] of passes) {
    console.log(`\n--- ${label} ---`);
    for (const c of pass.checks) {
      console.log("  " + (c.pass ? "✓" : "✗ FAIL") + " " + c.name + (c.detail !== "" ? "  [" + c.detail + "]" : ""));
      if (c.pass) totalPass++; else totalFail++;
    }
    console.log("  pageerrors: " + pass.errors.length + (pass.errors.length ? "  " + JSON.stringify(pass.errors.slice(0, 5)) : ""));
    if (pass.errors.length) totalFail += pass.errors.length;
  }

  // ---- separate quick pass: danger crossfade + mute/music toggle persistence ----
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (/googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
      req.continue();
    });
    await page.goto(BASE + "/branchmanager.html?t=" + Date.now(), { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!window.__BM_AUDIO__, { timeout: 20000 });
    await page.mouse.move(200, 200); await page.mouse.down(); await page.mouse.up();
    await page.waitForFunction(() => { const a = window.__BM_AUDIO__.audioState(); return a.buffersLoaded >= a.buffersTotal; }, { timeout: 20000 }).catch(() => {});
    await page.click("#startBtn");
    await new Promise((r) => setTimeout(r, 200));

    const toggleChecks = await page.evaluate(async () => {
      const A = window.__BM_AUDIO__;
      const out = [];
      function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
      function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

      // music toggle
      document.getElementById("musicBtn").click();
      const off = A.audioState();
      check("music toggle drops musicGainV toward 0", off.musicGainV === 0, off.musicGainV);
      check("music toggle persists bm_music_off", localStorage.getItem("bm_music_off") === "1", localStorage.getItem("bm_music_off"));
      document.getElementById("musicBtn").click();
      await sleep(30);
      const on = A.audioState();
      check("music toggle restores musicGainV", on.musicGainV > 0.2, on.musicGainV);

      // mute toggle
      document.getElementById("muteBtn").click();
      const muted = A.audioState();
      check("mute button zeroes masterGain", muted.masterGain === 0, muted.masterGain);
      check("mute persists bm_muted", localStorage.getItem("bm_muted") === "1", localStorage.getItem("bm_muted"));
      document.getElementById("muteBtn").click();
      const unmuted = A.audioState();
      check("mute button restores masterGain", unmuted.masterGain === 1, unmuted.masterGain);

      return out;
    }).catch((e) => [{ name: "toggle checks", pass: false, detail: String(e && e.message || e) }]);

    console.log("\n--- TOGGLES (mute + music, persistence) ---");
    for (const c of toggleChecks) {
      console.log("  " + (c.pass ? "✓" : "✗ FAIL") + " " + c.name + (c.detail !== "" ? "  [" + c.detail + "]" : ""));
      if (c.pass) totalPass++; else totalFail++;
    }
    console.log("  pageerrors: " + errors.length);
    if (errors.length) totalFail += errors.length;
    await page.close();
  }

  await browser.close();
  if (server) server.kill();

  console.log(`\n${totalPass} passed, ${totalFail} failed`);
  if (totalFail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
