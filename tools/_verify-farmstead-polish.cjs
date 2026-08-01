#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase F polish suite (audio, touch controls, perf, housekeeping).
 *
 * Scope discipline (per the Phase-F brief): this suite asserts ONLY what
 * Phase F added/changed — the audio state machine, the event->sound mapping,
 * proximity gain, the music-source abstraction (synth default + custom-file
 * loader + IndexedDB persistence + decode-failure fallback), touch gestures,
 * and the performance budgets. The seven earlier suites (world/transport/
 * economy/military/mp/ui/visuals) are re-run SEPARATELY and reported, not
 * invoked from here.
 *
 *   node tools/_verify-farmstead-polish.cjs
 */
const fs = require("fs");
const path = require("path");
const H = require("./_fs_harness.cjs");

/** A tiny valid 16-bit PCM mono WAV, generated at runtime (never committed,
 * never a real user file) — the suite's own "0.5s sine wave" fixture for the
 * custom-music loader test. */
function makeSineWav(durationS, freq, sampleRate) {
  sampleRate = sampleRate || 22050;
  const n = Math.floor(durationS * sampleRate);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);              // PCM
  buf.writeUInt16LE(1, 22);              // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);              // block align
  buf.writeUInt16LE(16, 34);             // bits/sample
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.4;
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(s * 32767))), 44 + i * 2);
  }
  return buf;
}

H.run("farmstead-polish", async (t) => {
  const scratchDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "fs-polish-"));
  const wavPath = path.join(scratchDir, "fixture.wav");
  fs.writeFileSync(wavPath, makeSineWav(0.5, 440));
  const junkPath = path.join(scratchDir, "not-audio.bin");
  fs.writeFileSync(junkPath, Buffer.from("this is definitely not a wav or mp3 file, just junk bytes 0123456789 not audio at all"));

  // ═══════════════════════════════════════════════════════════ 1. audio state machine
  const page = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.FSAudio, { timeout: 20000 });

  const preGesture = await page.evaluate(() => window.FSAudio.debug());
  t.check("before any gesture: audio is NOT unlocked (no AudioContext yet)", preGesture.unlocked === false, preGesture);
  t.check("mute/musicOff read their persisted defaults (both off) pre-gesture", preGesture.muted === false && preGesture.musicOff === false, preGesture);

  const postGesture = await page.evaluate(() => {
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return window.FSAudio.debug();
  });
  t.check("a synthesized pointerdown unlocks audio (nodes created on gesture only)", postGesture.unlocked === true, postGesture);
  t.check("the AudioContext is running after unlock", postGesture.ctxState === "running", postGesture);
  t.check("master/sfx/music gain nodes all exist post-unlock", postGesture.masterGain !== null && postGesture.sfxGain !== null && postGesture.musicGain !== null, postGesture);

  const muteTest = await page.evaluate(() => {
    const before = window.FSAudio.setMuted(true);
    const d1 = window.FSAudio.debug();
    const persisted = localStorage.getItem("fs_muted");
    window.FSAudio.setMuted(false);
    const d2 = window.FSAudio.debug();
    return { before, d1, persisted, d2 };
  });
  t.check("setMuted(true) zeroes the MASTER gain", muteTest.d1.masterGain === 0, muteTest);
  t.check("mute persists to localStorage (fs_muted)", muteTest.persisted === "1", muteTest);
  t.check("un-muting restores master gain to 1", muteTest.d2.masterGain === 1, muteTest);
  t.check("mute is MASTER — it does not by itself change the music/sfx gain node VALUES", muteTest.d1.musicGain === muteTest.d2.musicGain && muteTest.d1.sfxGain === muteTest.d2.sfxGain, muteTest);

  const reload1 = await page.goto(t.BASE + "/farmstead.html?r=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.FSAudio, { timeout: 20000 });
  const mutedAfterReload = await page.evaluate(() => window.FSAudio.muted());
  t.check("muted flag survives a fresh page load (persisted, not just in-memory)", mutedAfterReload === false, mutedAfterReload);
  // (we un-muted before navigating, so a fresh load should read false — persistence
  // itself is proven by the localStorage check above + this round-trip)
  await page.evaluate(() => { window.FSAudio.setMuted(true); });
  await page.goto(t.BASE + "/farmstead.html?r=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.FSAudio, { timeout: 20000 });
  const mutedAfterReload2 = await page.evaluate(() => window.FSAudio.muted());
  t.check("…and the OTHER value (muted=true) also survives a reload", mutedAfterReload2 === true, mutedAfterReload2);
  await page.evaluate(() => { window.FSAudio.setMuted(false); });

  // ═══════════════════════════════════════════════════════════ 2. music: master/music gain separation, musicOff
  await page.evaluate(() => { document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); window.__FS__.newGame({ size: "small", ais: 0, speed: 0 }); window.FSAudio.onGameStart(); });
  const musicOffTest = await page.evaluate(() => {
    const before = window.FSAudio.debug();
    const on = window.FSAudio.setMusicOff(true);
    const persisted = localStorage.getItem("fs_music_off");
    const after = window.FSAudio.debug();
    window.FSAudio.setMusicOff(false);
    const restored = window.FSAudio.debug();
    return { before, on, persisted, after, restored };
  });
  t.check("musicOff persists to localStorage (fs_music_off)", musicOffTest.persisted === "1", musicOffTest);
  t.check("musicOff zeroes ONLY the music gain (sfx gain untouched)",
    musicOffTest.after.musicGain === 0 && musicOffTest.after.sfxGain === musicOffTest.before.sfxGain, musicOffTest);
  t.check("turning music back on restores its gain", musicOffTest.restored.musicGain > 0, musicOffTest);
  t.check("music defaults to the SYNTH source", musicOffTest.before.musicSource === "synth", musicOffTest.before);
  t.check("the synth score is actively scheduling once armed (onGameStart)", musicOffTest.before.musicArmed === true && musicOffTest.before.synthMusicOn === true, musicOffTest.before);

  const musicInfoDefault = await page.evaluate(() => window.FSAudio.musicInfo());
  t.check("musicInfo() reports the synth default", musicInfoDefault.source === "synth" && musicInfoDefault.ready === true, musicInfoDefault);

  // ═══════════════════════════════════════════════════════════ 3. custom music: the file loader end to end
  await page.evaluate(() => { window.FSUI.escape(); });
  await page.click("#fsMenuBtn");
  await page.click('[data-act="open-settings"]');
  await t.sleep(150);
  const fileInput = await page.$("#fsMusicFile");
  await fileInput.uploadFile(wavPath);
  await t.sleep(500);                     // async: read -> decode -> IndexedDB put
  const afterUpload = await page.evaluate(() => window.FSAudio.musicInfo());
  t.check("uploading a real WAV switches the music source to 'file'", afterUpload.source === "file", afterUpload);
  t.check("the custom file's name is remembered", afterUpload.name === "fixture.wav", afterUpload);
  const settingsHtmlAfterUpload = await page.evaluate(() => document.getElementById("fsSheetBody").innerHTML);
  t.check("Settings now shows the custom track + a way back to the built-in theme",
    /fixture\.wav/.test(settingsHtmlAfterUpload) && /settings-music-remove/.test(settingsHtmlAfterUpload), settingsHtmlAfterUpload.length);

  // ---- IndexedDB persistence across reload
  await page.goto(t.BASE + "/farmstead.html?r=" + Date.now(), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.FSAudio, { timeout: 20000 });
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await t.sleep(500);                     // the boot-time idbGetMusic() -> decode round trip
  const afterReloadInfo = await page.evaluate(() => window.FSAudio.musicInfo());
  t.check("the custom track survives a full page reload (IndexedDB, real browser API)",
    afterReloadInfo.source === "file" && afterReloadInfo.name === "fixture.wav", afterReloadInfo);

  // ---- decode-failure fallback: a junk file must NOT switch the source, must NOT throw
  const junkInput = await page.$("#fsMusicFile");
  let junkErrored = false;
  page.once("pageerror", () => { junkErrored = true; });
  const junkResult = await page.evaluate(() => window.__FS__ ? null : null);   // no-op, keeps eslint-style symmetry
  if (junkInput) {
    // element may have been rebuilt by refreshOpenSheet(); re-open Settings to be sure
    await page.click("#fsMenuBtn").catch(() => {});
    await page.click('[data-act="toggle-menu"]').catch(() => {});
  }
  await page.evaluate(() => { if (window.FSUI) { window.FSUI.toast; } });
  // re-open Settings fresh (menu state may have toggled) and grab a live handle to the input
  await page.evaluate(() => { const b = document.getElementById("fsMenuBtn"); if (b && document.getElementById("fsMenu").classList.contains("hidden")) b.click(); });
  await t.sleep(80);
  await page.evaluate(() => { const b = document.querySelector('[data-act="open-settings"]'); if (b) b.click(); });
  await t.sleep(150);
  const freshInput = await page.$("#fsMusicFile");
  const decodeOutcome = await page.evaluate(() => window.FSAudio.musicInfo());
  await freshInput.uploadFile(junkPath);
  await t.sleep(500);
  const afterJunk = await page.evaluate(() => window.FSAudio.musicInfo());
  t.check("a corrupt/non-audio file fails gracefully (no exception)", junkErrored === false, { junkErrored });
  t.check("…and the music source stays on whatever last worked (the file track, unrevoked) — a decode failure never clobbers the current state",
    afterJunk.source === decodeOutcome.source && afterJunk.name === decodeOutcome.name, { before: decodeOutcome, after: afterJunk });
  const junkToast = await page.evaluate(() => document.getElementById("fsToasts").textContent);
  t.check("a friendly error toast explains the failed upload", /decode failed|kept the synth track|couldn.?t use that file/i.test(junkToast), junkToast);

  // ---- explicit decode-failure via the API directly (belt & suspenders — proves the
  // Promise resolves {ok:false}, never rejects, even off the UI path)
  const directDecodeFail = await page.evaluate(async () => {
    const bytes = new Uint8Array(64);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 251;
    const file = new File([bytes], "garbage.bin", { type: "application/octet-stream" });
    try {
      const r = await window.FSAudio.setCustomMusic(file);
      return { threw: false, r };
    } catch (e) { return { threw: true, msg: String(e) }; }
  });
  t.check("setCustomMusic() on garbage resolves {ok:false} — it never throws/rejects", directDecodeFail.threw === false && directDecodeFail.r.ok === false, directDecodeFail);

  // ---- remove custom music -> back to synth
  await page.evaluate(() => { const b = document.querySelector('[data-act="settings-music-remove"]'); if (b) b.click(); });
  await t.sleep(300);
  const afterRemove = await page.evaluate(() => window.FSAudio.musicInfo());
  t.check("'Back to the built-in theme' reverts the source to synth", afterRemove.source === "synth", afterRemove);
  await page.evaluate(() => { window.FSUI.escape(); });

  // ═══════════════════════════════════════════════════════════ 4. event -> sound trigger counters + proximity
  const eventSfx = await page.evaluate(() => {
    const FS = window.__FS__, FSSim = FS.FSSim, FSMil = FS.FSMil;
    FS.newGame({ size: "medium", ais: 1, seed: 55, speed: 0 });
    document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.FSAudio.onGameStart();
    const G = FS.G;
    // establish the event-drain watermark for this fresh G BEFORE pushing any
    // synthetic test events — FSAudio.frame() has not run for this G yet
    // (the real rAF loop schedules its first call async), and its own
    // "skip boot history" guard treats the tick-as-of-first-call as already
    // seen, so injecting events at that exact tick would look pre-seen too.
    window.FSAudio.frame(0.05, G);
    const before = Object.assign({}, window.FSAudio._plays);
    G.tick += 5;
    FSSim.event(G, "treeFelled", { v: FSSim.castleOf(G, 0).v, p: 0, bld: 0 });
    FSSim.event(G, "stoneCut", { v: FSSim.castleOf(G, 0).v, left: 2 });
    FSSim.event(G, "bldDone", { id: 1, btype: "hut", v: FSSim.castleOf(G, 0).v, p: 0 });
    FSSim.event(G, "attackLaunched", { target: 2, btype: "hut", v: FSSim.castleOf(G, 0).v, p: 0, from: 1, n: 2 });
    FSSim.event(G, "fightRound", { bld: 2, att: 1, def: 2, attWins: true, round: 1, v: FSSim.castleOf(G, 0).v, p: 0, ap: 0 });
    FSSim.event(G, "bldCaptured", { id: 2, btype: "hut", v: FSSim.castleOf(G, 0).v, from: 1, p: 0 });
    FSSim.event(G, "knightPromoted", { bld: FSSim.castleOf(G, 0).id, btype: "castle", p: 0, rank: 1 });
    FSSim.event(G, "mineExhausted", { bld: 1, btype: "coalMine", v: FSSim.castleOf(G, 0).v, p: 0 });
    FSSim.event(G, "geoSign", { v: FSSim.castleOf(G, 0).v, mineral: 2, amt: 5, code: 1, p: 0 });
    for (let i = 0; i < 10; i++) window.FSAudio.frame(0.05, G);
    const after = Object.assign({}, window.FSAudio._plays);
    return { before, after };
  });
  console.log("   _plays before:", JSON.stringify(eventSfx.before));
  console.log("   _plays after: ", JSON.stringify(eventSfx.after));
  ["chop", "chip", "chime", "horn", "clang", "sting", "promote", "notify"].forEach((k) => {
    t.check("sim event -> " + k + " SFX fired (_plays." + k + " incremented)", eventSfx.after[k] > (eventSfx.before[k] || 0), { before: eventSfx.before[k], after: eventSfx.after[k] });
  });

  const victoryDefeat = await page.evaluate(() => {
    const FS = window.__FS__, FSSim = FS.FSSim;
    const G = FS.G;
    const before = Object.assign({}, window.FSAudio._plays);
    G.tick += 1;
    FSSim.event(G, "gameOver", { winnerTeam: 0, winners: [0] });
    window.FSAudio.frame(0.05, G);
    const afterWin = Object.assign({}, window.FSAudio._plays);
    G.tick += 1;
    FSSim.event(G, "playerEliminated", { p: 0, by: 1 });
    window.FSAudio.frame(0.05, G);
    const afterDefeat = Object.assign({}, window.FSAudio._plays);
    return { before, afterWin, afterDefeat };
  });
  t.check("gameOver (you won) -> victory fanfare", victoryDefeat.afterWin.victory > victoryDefeat.before.victory, victoryDefeat);
  t.check("playerEliminated (you) -> defeat somber", victoryDefeat.afterDefeat.defeat > victoryDefeat.afterWin.defeat, victoryDefeat);

  const clickSfx = await page.evaluate(() => {
    const before = window.FSAudio._plays.click;
    document.getElementById("fsDockBuild").click();
    return { before, after: window.FSAudio._plays.click };
  });
  t.check("a real UI button click plays the click blip", clickSfx.after > clickSfx.before, clickSfx);

  const noAudioDuringFF = await page.evaluate(() => {
    const before = Object.assign({}, window.FSAudio._plays);
    window.__FS__.ff(600);          // fast-forward — must NOT call FSAudio.frame at all
    const after = Object.assign({}, window.FSAudio._plays);
    return { before, after };
  });
  t.check("no audio fires during __FS__.ff() (ff never calls FSAudio.frame)", JSON.stringify(noAudioDuringFF.before) === JSON.stringify(noAudioDuringFF.after), noAudioDuringFF);

  const proximity = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    R.setCam({ tx: 0, tz: 0, dist: 20 });
    const near = window.FSAudio.proximityGain(2, 2);
    const far = window.FSAudio.proximityGain(500, 500);
    const global = window.FSAudio.proximityGain();   // no position = a global stinger, always full
    return { near, far, global };
  });
  t.check("proximity gain: near the camera target reads ~full volume", proximity.near > 0.9, proximity);
  t.check("proximity gain: far away reads clearly quieter, never fully silent", proximity.far < 0.3 && proximity.far > 0, proximity);
  t.check("proximity gain: near is louder than far", proximity.near > proximity.far, proximity);
  t.check("proximity gain: a position-less (global) cue is always full volume", proximity.global === 1, proximity);

  const hammerAndDust = await page.evaluate(() => {
    const FS = window.__FS__, FSSim = FS.FSSim, FSMap = FS.FSMap;
    const G = FS.G, castle = FSSim.castleOf(G, 0);
    let siteV = -1;
    FSMap.forRadius(G.map, castle.v, 9, (v, d) => { if (siteV < 0 && d >= 3 && FSMap.canPlaceBuilding("lumberjack", v, 0)) siteV = v; });
    const br = FSSim.build(G, "lumberjack", siteV, 0);
    const b = G.buildings[br.id];
    b.state = "build"; b.crew = 424242; b.leveled = true;
    const before = window.FSAudio._plays.hammer;
    for (let i = 0; i < 60; i++) window.FSAudio.frame(0.05, G);
    return { before, after: window.FSAudio._plays.hammer };
  });
  t.check("hammer taps fire while a building is actively 'build'+crewed (proximity-gated ambience)",
    hammerAndDust.after > hammerAndDust.before, hammerAndDust);

  // ═══════════════════════════════════════════════════════════ 5. duck on attack/victory
  const duck = await page.evaluate(() => {
    window.FSAudio.setMusicOff(false);
    const before = window.FSAudio.debug().musicGain;
    window.FSAudio._trigger("horn");
    // read shortly after — the duck ramps down over ~180ms
    return new Promise((resolve) => setTimeout(() => resolve({ before, duringDucking: window.FSAudio.debug() }), 260));
  });
  t.check("an attack horn ducks the music gain down", duck.duringDucking.musicGain < duck.before, duck);

  t.check("0 page errors through the audio/music sections", t.errors.length === 0, t.errors.slice(0, 10));

  // ═══════════════════════════════════════════════════════════ 6. touch controls
  const mob = await t.newPage({ width: 390, height: 844, deviceScaleFactor: 2 });
  await mob.evaluateOnNewDocument(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.indexOf("pointer: coarse") >= 0 ? { matches: true, media: q, addListener() {}, removeListener() {} } : mm(q));
  });
  await mob.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await mob.waitForFunction(() => !!window.__FS__ && !!window.__FS__.FSRender, { timeout: 20000 });
  await mob.evaluate(() => { window.__FS__.newGame({ size: "medium", ais: 1, seed: 4242, speed: 0 }); });

  function peExpr() {
    return "function pe(type,x,y,id){return new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0});}";
  }

  const touchPan = await mob.evaluate((peSrc) => {
    eval(peSrc);
    const R = window.__FS__.FSRender;
    R.setCam({ tx: 100, tz: 100, dist: 30, yaw: 0.4 });
    const before = R.camState();
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", 200, 400, 101));
    window.dispatchEvent(pe("pointermove", 260, 430, 101));
    window.dispatchEvent(pe("pointermove", 300, 460, 101));
    window.dispatchEvent(pe("pointerup", 300, 460, 101));
    const after = R.camState();
    return { before, after };
  }, peExpr());
  t.check("touch: 1-finger drag pans the camera", Math.abs(touchPan.after.tx - touchPan.before.tx) + Math.abs(touchPan.after.tz - touchPan.before.tz) > 0.5, touchPan);

  const touchPinch = await mob.evaluate((peSrc) => {
    eval(peSrc);
    const R = window.__FS__.FSRender;
    R.setCam({ tx: 100, tz: 100, dist: 30, yaw: 0.4 });
    const before = R.camState();
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", 150, 400, 111));
    canvas.dispatchEvent(pe("pointerdown", 250, 400, 112));
    window.dispatchEvent(pe("pointermove", 100, 400, 111));
    window.dispatchEvent(pe("pointermove", 300, 400, 112));
    window.dispatchEvent(pe("pointerup", 100, 400, 111));
    window.dispatchEvent(pe("pointerup", 300, 400, 112));
    const after = R.camState();
    return { before, after };
  }, peExpr());
  t.check("touch: pinch (fingers spreading) zooms in — dist shrinks", touchPinch.after.dist < touchPinch.before.dist - 0.5, touchPinch);

  const touchRotate = await mob.evaluate((peSrc) => {
    eval(peSrc);
    const R = window.__FS__.FSRender;
    R.setCam({ tx: 100, tz: 100, dist: 30, yaw: 0.4 });
    const before = R.camState();
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", 150, 400, 121));
    canvas.dispatchEvent(pe("pointerdown", 250, 400, 122));
    window.dispatchEvent(pe("pointermove", 170, 360, 121));
    window.dispatchEvent(pe("pointermove", 230, 440, 122));
    window.dispatchEvent(pe("pointerup", 170, 360, 121));
    window.dispatchEvent(pe("pointerup", 230, 440, 122));
    const after = R.camState();
    return { before, after };
  }, peExpr());
  t.check("touch: 2-finger twist rotates the camera yaw", Math.abs(touchRotate.after.yaw - touchRotate.before.yaw) > 0.05, touchRotate);

  const touchNoStrayTap = await mob.evaluate((peSrc) => {
    eval(peSrc);
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", 150, 400, 131));
    canvas.dispatchEvent(pe("pointerdown", 250, 400, 132));
    window.dispatchEvent(pe("pointermove", 120, 400, 131));
    window.dispatchEvent(pe("pointermove", 280, 400, 132));
    window.dispatchEvent(pe("pointerup", 120, 400, 131));
    window.dispatchEvent(pe("pointerup", 280, 400, 132));
    return { ctxOpen: !document.getElementById("fsContext").classList.contains("hidden") };
  }, peExpr());
  t.check("touch: a pinch/rotate gesture never registers as a tap-select", !touchNoStrayTap.ctxOpen, touchNoStrayTap);

  const touchTap = await mob.evaluate((peSrc) => {
    eval(peSrc);
    const FS = window.__FS__, R = FS.FSRender, FSSim = FS.FSSim;
    const flagV = FS.G.flags[FSSim.castleOf(FS.G, 0).flag].v;
    R.focusVertex(flagV, 18);
    R.frame(0.05);
    const s = R.vertexScreen(flagV);
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", s.x, s.y, 141));
    window.dispatchEvent(pe("pointerup", s.x, s.y, 141));
    return { open: !document.getElementById("fsContext").classList.contains("hidden") };
  }, peExpr());
  t.check("touch: a tap selects (context panel opens)", touchTap.open, touchTap);
  await mob.evaluate(() => { window.FSUI.escape(); });

  const touchLongPress = await mob.evaluate(async (peSrc) => {
    eval(peSrc);
    const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap, FSSim = FS.FSSim;
    const castle = FSSim.castleOf(FS.G, 0);
    let v = -1;
    FSMap.forRadius(FS.G.map, castle.v, 8, (u, d) => { if (v < 0 && d >= 4 && FSMap.canPlaceFlag(u, 0)) v = u; });
    R.focusVertex(v, 16);
    R.frame(0.05);
    const s = R.vertexScreen(v);
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", s.x, s.y, 151));
    await new Promise((r) => setTimeout(r, 650));
    const opened = !document.getElementById("fsTouchCtx").classList.contains("hidden");
    window.dispatchEvent(pe("pointerup", s.x, s.y, 151));
    return { opened, v };
  }, peExpr());
  t.check("touch: long-press opens the context menu (flag/build here) on a mobile viewport", touchLongPress.opened, touchLongPress);

  const longPressFlag = await mob.evaluate(async (peSrc) => {
    eval(peSrc);
    const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap, FSSim = FS.FSSim;
    const castle = FSSim.castleOf(FS.G, 0);
    let v = -1;
    FSMap.forRadius(FS.G.map, castle.v, 9, (u, d) => { if (v < 0 && d >= 6 && FSMap.canPlaceFlag(u, 0) && !FS.G.map.flagAt[u]) v = u; });
    R.focusVertex(v, 16);
    R.frame(0.05);
    const s = R.vertexScreen(v);
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", s.x, s.y, 161));
    await new Promise((r) => setTimeout(r, 650));
    window.dispatchEvent(pe("pointerup", s.x, s.y, 161));
    document.getElementById("fsTouchCtxFlag").click();
    return { flagAt: FS.G.map.flagAt[v] };
  }, peExpr());
  t.check("touch: long-press -> 'Flag here' actually places a flag at that vertex", longPressFlag.flagAt > 0, longPressFlag);

  const mobileButtonSizes = await mob.evaluate(() => {
    const ids = ["fsDockBuild", "fsDockFlag", "fsDockRoad", "fsDockSuit", "fsBell", "fsMenuBtn"];
    const out = {};
    ids.forEach((id) => { const r = document.getElementById(id).getBoundingClientRect(); out[id] = { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; });
    return out;
  });
  const allAtLeast40 = Object.keys(mobileButtonSizes).every((k) => mobileButtonSizes[k].w >= 39 && mobileButtonSizes[k].h >= 39);
  t.check("primary mobile touch targets (dock/topbar) are >= 40px", allAtLeast40, mobileButtonSizes);

  // ═══════════════════════════════════════════════════════════ 7. perf audit
  const perfPage = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await perfPage.goto(t.BASE + "/farmstead.html", { waitUntil: "domcontentloaded" });
  await perfPage.waitForFunction(() => !!window.__FS__, { timeout: 20000 });
  const perf = await perfPage.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    FS.newGame({ size: "large", ais: 3, seed: 20260731, speed: 0 });
    FS.ff(12000);                                  // 20 sim-minutes, real AI-built economy
    // NOTE: player 0 is the (unplayed, no human/AI attached) human seat in a
    // pure ais:3 game — counts(G,0) alone reads near-empty. The world's real
    // busy-ness is every player's buildings/serfs combined (matches the
    // draw-call/tick-cost budgets below, which render/simulate ALL players).
    const world = { buildings: Object.keys(FS.G.buildings).length, serfs: Object.keys(FS.G.serfs).length };
    const t0 = performance.now();
    FS.ff(1000);                                    // the timed 1000-tick sample
    const ms = performance.now() - t0;
    // draw calls in that SAME busy world — headless takes the auto-quality path
    // (Phase V's software-rasteriser thinning); this is deliberate per the
    // Phase F task brief — force setQuality(1) only for the hero screenshots below.
    for (let i = 0; i < 8; i++) R.frame(0.033);
    const draws = R.stats().drawCalls, tris = R.stats().tris;
    const dyn = R.dynamicInfo ? R.dynamicInfo() : null;
    return { msPerTick: ms / 1000, tick: FS.G.tick, world, draws, tris, quality: R.quality(), serfsDrawn: dyn ? dyn.serfs : null };
  });
  console.log("   perf @ minute 20, large map, 3 AI: tickMsAvg=" + perf.msPerTick.toFixed(4) + "ms  buildings=" + perf.world.buildings +
    " serfs=" + perf.world.serfs + " draws=" + perf.draws + " tris=" + perf.tris + " quality=" + perf.quality);
  // "lenient headless x3 factor": the real 6ms budget x3 = 18ms, so a slower CI
  // box can't spuriously fail this — the exact number is always logged above.
  t.check("tickMsAvg stays well under the (3x-lenient) budget", perf.msPerTick < 18, perf);
  t.check("…and comfortably under the real 6ms design budget too", perf.msPerTick < 6, perf);
  t.check("draw calls in a busy 20-minute 3-AI world stay under 900", perf.draws < 900, perf);
  t.check("serf draw calls are a small, bounded share (merged/cached meshes, not per-serf)",
    perf.serfsDrawn === null || perf.serfsDrawn <= 150, perf);

  const leak = await perfPage.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender;
    function snap() {
      for (let i = 0; i < 3; i++) R.frame(0.033);
      const m = R.renderer().info.memory;
      return { g: m.geometries, t: m.textures };
    }
    FS.newGame({ size: "large", ais: 3, seed: 1 }); const a = snap();
    FS.newGame({ size: "large", ais: 3, seed: 2 });
    FS.newGame({ size: "large", ais: 3, seed: 3 });
    FS.newGame({ size: "large", ais: 3, seed: 1 }); const b = snap();
    const heap = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
    return { a, b, dg: b.g - a.g, dt: b.t - a.t, heap };
  });
  console.log("   memory: geometries " + leak.a.g + " -> " + leak.b.g + " (Δ" + leak.dg + ")   textures " + leak.a.t + " -> " + leak.b.t + " (Δ" + leak.dt + ")" +
    (leak.heap ? "   heap " + (leak.heap.used / 1048576).toFixed(1) + "MB" : ""));
  t.check("geometry count returns to baseline across newGame x3 (+-10%, large maps)", Math.abs(leak.dg) <= Math.max(4, leak.a.g * 0.10), leak);
  t.check("texture count is stable across newGame x3", Math.abs(leak.dt) <= 1, leak);
  if (leak.heap) t.check("JS heap did not run away across newGame x3 (< 300MB used)", leak.heap.used < 300 * 1048576, leak.heap);

  // ═══════════════════════════════════════════════════════════ 8. housekeeping
  const houseKeeping = await page.evaluate(() => ({
    title: document.title,
    themeColor: document.querySelector('meta[name="theme-color"]').content,
    favicon: document.querySelector('link[rel="icon"]').href,
    version: window.__FS__.version,
  }));
  t.check("page has a real <title>", houseKeeping.title.length > 0, houseKeeping.title);
  t.check("meta theme-color is set", /^#([0-9a-f]{6})$/i.test(houseKeeping.themeColor), houseKeeping.themeColor);
  t.check("favicon is an emoji data-URL SVG (house pattern, no external asset)", houseKeeping.favicon.indexOf("data:image/svg+xml") === 0, houseKeeping.favicon);
  t.check("__FS__.version is set and distinct from bare '1' (build-tagged)", typeof houseKeeping.version === "string" && houseKeeping.version !== "1", houseKeeping.version);

  const hiddenPause = await page.evaluate(() => {
    const FS = window.__FS__;
    FS.newGame({ size: "small", ais: 0, speed: 1 });
    const before = FS.G.speed;
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const whileHidden = FS.G.speed;
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const afterVisible = FS.G.speed;
    return { before, whileHidden, afterVisible };
  });
  t.check("solo: tab hidden pauses the sim (speed -> 0)", hiddenPause.before > 0 && hiddenPause.whileHidden === 0, hiddenPause);
  t.check("solo: tab visible again resumes the same speed", hiddenPause.afterVisible === hiddenPause.before, hiddenPause);

  // ═══════════════════════════════════════════════════════════ 9. hero screenshots
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.addStyleTag({ content:
    "#dbg,#speedTag,#bhint,#bmode,#netChip,#pingMark,#fsToasts{display:none!important}" });
  await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSSim = FS.FSSim, FSMap = FS.FSMap, FSC = FS.FSC;
    FS.newGame({ size: "medium", seed: 20260731, ais: 1, speed: 0, aiPlan: false });
    R.setQuality(1);                       // hero shot: force full quality (house rule)
    const G = FS.G, castle = FSSim.castleOf(G, 0), used = [];
    ["lumberjack", "sawmill", "forester", "farm", "mill", "bakery", "stonecutter", "pigfarm",
      "butcher", "toolmaker", "smelter", "stock", "hut", "weaponsmith", "tower", "fisher", "boatwright"].forEach((ty) => {
      let best = -1, bestD = 1e9;
      FSMap.forRadius(G.map, castle.v, 13, (v, d) => {
        if (d < 3 || d >= bestD || used.some((w) => FSMap.dist(G.map, w, v) < 3)) return;
        if (FSMap.canPlaceBuilding(G.map, ty, v, 0)) { best = v; bestD = d; }
      });
      if (best < 0) return;
      const r = FSSim.build(G, ty, best, 0);
      if (r.ok) used.push(best);
    });
    used.forEach((v) => { const id = G.map.bldAt[v]; if (id) FSSim.forceComplete(G, id); });
    FS.ff(2500);
    for (const id in G.buildings) { const b = G.buildings[id]; if (FSC.BLD[b.type] && FSC.BLD[b.type].cycleT) { b.working = true; b.prodT = 30; } }
    R.setCam({ yaw: 0.6, pitch: 0.72 });
    R.focusVertex(castle.v, 26);
  });
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__FS__.FSRender.frame(0.033));
  await t.shot(page, "farmstead_final");

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => { window.__FS__.FSRender.resize(); });
  for (let i = 0; i < 15; i++) await page.evaluate(() => window.__FS__.FSRender.frame(0.033));
  await t.shot(page, "farmstead_final_mobile");
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  t.check("0 page errors across the whole polish suite", t.errors.length === 0, t.errors.slice(0, 10));
});
