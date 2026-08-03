/* FARMSTEAD fs-audio.js — PHASE-F: WebAudio synth SFX + background music.
 *
 * OWNERSHIP / HOUSE RULES (see farmstead-plan.md §10/§12 + the Phase-F brief):
 *   - Reads G / G.events ONLY. Never mutates the sim, never issues commands.
 *   - Math.random() is fine here (unlike the sim modules, which must stay on
 *     FSC.rng for cross-device determinism) — audio never needs to replay
 *     identically, and every co-op screen hears its OWN local mix.
 *   - SFX are synthesized (oscillators/noise/filters). Default BGM is the
 *     user's OWN ORIGINAL COMPOSITION — "Castle Kruzer" (assets/farmstead/
 *     music/castlekruzer-theme.mp3, 5.3MB/5:55) — looped via BufferSource.
 *     (2026-08-03: replaced the earlier Settlers-derived OGG/MIDI, which the
 *     project's own rule never permits — see CLAUDE.md FARMSTEAD section.)
 *     LAZY LOAD: the file is fetched+decoded only when music actually needs
 *     to start (see ensureBuiltinTheme(), called from startMusicNodes()) —
 *     never at boot/init, so the title screen never pays its 5.3MB. Users
 *     may still override with their OWN audio file via the file picker
 *     (never uploaded).
 *   - init/first-gesture-gated: browsers refuse to start an AudioContext
 *     before a real user gesture, so nothing gets created until unlock().
 *
 * Public API (window.FSAudio):
 *   init(FS)                         — wire the debug hook once at boot
 *   unlock()                         — call from the FIRST user gesture (idempotent)
 *   frame(dt, G)                     — once per rAF from the page's main loop
 *   onGameStart() / onGameEnd()      — gameplay boundary (music only plays in-game)
 *   muted() / setMuted(b) / toggleMuted()               — fs_muted (master)
 *   musicOff() / setMusicOff(b) / toggleMusicOff()      — fs_music_off (BGM only)
 *   setCustomMusic(file) -> Promise{ok,why?}            — "use my own music"
 *   clearCustomMusic() -> Promise<true>                 — back to the built-in theme
 *   musicInfo() -> {source, ready, name}
 *   proximityGain(wx, wz) -> 0..1    — the house gainAt pattern, exposed for tests
 *   debug() -> {...}                 — full state dump for the polish suite
 *   _plays: {kind: count, ...}       — per-kind trigger counters (test hook)
 *   version
 */
(function () {
  "use strict";

  const FSAudio = {};

  // ───────────────────────────────────────────────────────────── module state
  let FS = null, FSMap = null;
  let ctx = null;                 // AudioContext, created on first gesture only
  let masterGain = null, sfxGain = null, musicGain = null;
  let unlocked = false;
  let lastG = null;               // most recent G handed to frame() (test-friendly)

  let muted = false;              // fs_muted — silences EVERYTHING (master)
  let musicIsOff = false;         // fs_music_off — silences BGM only
  const MUSIC_LEVEL = 0.42;       // musicGain's un-muted, un-ducked resting level
  const MASTER_LEVEL = 1;

  try { muted = localStorage.getItem("fs_muted") === "1"; } catch (e) { /* noop */ }
  try { musicIsOff = localStorage.getItem("fs_music_off") === "1"; } catch (e) { /* noop */ }

  // ───────────────────────────────────────────────────────────── persistence
  function persistMuted() { try { localStorage.setItem("fs_muted", muted ? "1" : "0"); } catch (e) { /* noop */ } }
  function persistMusicOff() { try { localStorage.setItem("fs_music_off", musicIsOff ? "1" : "0"); } catch (e) { /* noop */ } }

  // ───────────────────────────────────────────────────────────── IndexedDB —
  // the user's own music track, browser-local only. NEVER uploaded, NEVER
  // committed, NEVER synced — see setCustomMusic() below.
  const IDB_NAME = "fs_music_custom", IDB_STORE = "files", IDB_KEY = "custom";
  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no indexedDB")); return; }
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => { try { req.result.createObjectStore(IDB_STORE); } catch (e) { /* noop */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("indexedDB open failed"));
    });
  }
  function idbPutMusic(arrayBuffer, name, type) {
    return idbOpen().then((db) => new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, "readwrite"); } catch (e) { db.close(); reject(e); return; }
      tx.objectStore(IDB_STORE).put({ data: arrayBuffer, name: name || "custom", type: type || "", ts: Date.now() }, IDB_KEY);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }
  function idbGetMusic() {
    return idbOpen().then((db) => new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, "readonly"); } catch (e) { db.close(); resolve(null); return; }
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => { db.close(); resolve(req.result || null); };
      req.onerror = () => { db.close(); resolve(null); };
    }));
  }
  function idbClearMusic() {
    return idbOpen().then((db) => new Promise((resolve, reject) => {
      let tx;
      try { tx = db.transaction(IDB_STORE, "readwrite"); } catch (e) { db.close(); resolve(true); return; }
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    }));
  }

  // ───────────────────────────────────────────────────────────── voice budget
  // "pooled" in spirit: WebAudio oscillators are cheap and self-disposing (GC
  // collects them once .stop()'d and disconnected), so there is no literal
  // object pool — instead every voice is admission-controlled against a small
  // concurrency cap, so a chaotic battle scene can never spawn unbounded nodes.
  let activeVoices = 0;
  const MAX_VOICES = 28;
  function admit(estMs) {
    if (activeVoices >= MAX_VOICES) return false;
    activeVoices++;
    setTimeout(() => { activeVoices = Math.max(0, activeVoices - 1); }, Math.max(30, estMs | 0));
    return true;
  }

  // ───────────────────────────────────────────────────────────── tiny synth kit
  function now() { return ctx ? ctx.currentTime : 0; }
  function mkGain(dest, v) { const g = ctx.createGain(); g.gain.value = v === undefined ? 1 : v; g.connect(dest); return g; }
  /** One-shot tone: osc(s) → gain envelope → dest (sfxGain by default). */
  function tone(freq, dur, opts) {
    if (!ctx || !admit(dur * 1000 + 60)) return null;
    opts = opts || {};
    const dest = opts.dest || sfxGain, mul = opts.mul === undefined ? 1 : opts.mul, pan = opts.pan;
    const t0 = now() + (opts.delay || 0);
    const g = mkGain(dest, 0);
    let out = g;
    if (pan !== undefined && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(dest); out = null; }
    const osc = ctx.createOscillator();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (opts.sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), t0 + dur);
    if (opts.detune) osc.detune.value = opts.detune;
    osc.connect(g);
    const peak = (opts.peak === undefined ? 0.5 : opts.peak) * mul;
    const atk = opts.atk === undefined ? 0.012 : opts.atk;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
    return { osc, gain: g };
  }
  /** Filtered noise burst — percussive/impact texture (hammer, chop, clang…). */
  function noiseBurst(dur, freq, opts) {
    if (!ctx || !admit(dur * 1000 + 60)) return null;
    opts = opts || {};
    const dest = opts.dest || sfxGain, mul = opts.mul === undefined ? 1 : opts.mul;
    const t0 = now() + (opts.delay || 0);
    const n = Math.max(1, Math.round(dur * ctx.sampleRate));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = opts.filterType || "bandpass";
    filt.frequency.setValueAtTime(freq, t0);
    if (opts.sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(1, opts.sweepTo), t0 + dur);
    filt.Q.value = opts.q === undefined ? 1.1 : opts.q;
    const g = mkGain(dest, 0);
    const peak = (opts.peak === undefined ? 0.5 : opts.peak) * mul;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + (opts.atk === undefined ? 0.006 : opts.atk));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(g);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    src.onended = () => { try { src.disconnect(); filt.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
    return { src, gain: g };
  }
  /** A short arpeggiated chime: N tones fired in quick succession. */
  function chime(freqs, opts) {
    opts = opts || {};
    const step = opts.step === undefined ? 0.09 : opts.step;
    for (let i = 0; i < freqs.length; i++) {
      tone(freqs[i], opts.dur === undefined ? 0.34 : opts.dur, Object.assign({}, opts, { delay: (opts.delay || 0) + i * step }));
    }
  }

  // ───────────────────────────────────────────────────────────── proximity —
  // the house "gainAt" pattern (see Farm Kart's proximity audio in CLAUDE.md):
  // full volume close to the camera's look-at point, linear falloff, a floor
  // so distant activity is never fully silent (keeps the world feeling alive).
  const PROX_FULL_R = 16, PROX_ZERO_R = 100, PROX_FLOOR = 0.08;
  function camTarget() {
    if (FS && FS.FSRender && FS.FSRender.camState) return FS.FSRender.camState();
    return { tx: 0, tz: 0 };
  }
  function proximityGain(wx, wz) {
    if (wx === undefined || wz === undefined || wx === null || wz === null) return 1;   // non-spatial cue
    const c = camTarget();
    const dx = wx - c.tx, dz = wz - c.tz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= PROX_FULL_R) return 1;
    if (d >= PROX_ZERO_R) return PROX_FLOOR;
    const u = (d - PROX_FULL_R) / (PROX_ZERO_R - PROX_FULL_R);
    return 1 + (PROX_FLOOR - 1) * u;
  }
  FSAudio.proximityGain = proximityGain;
  const worldTmp = [0, 0];
  function worldOfVertex(v) {
    if (v === undefined || v === null || v < 0 || !lastG || !FSMap) return null;
    try {
      FSMap.worldXZ(lastG.map, v, worldTmp);
      return worldTmp;
    } catch (e) { return null; }
  }

  // ───────────────────────────────────────────────────────────── SFX kinds —
  // one small function per cue, each bumping FSAudio._plays[kind] REGARDLESS
  // of mute (mute silences via gain, not by skipping — so _plays stays a
  // reliable "did this map to a sound" signal for tests either way).
  const plays = FSAudio._plays = {
    click: 0, hammer: 0, chop: 0, chip: 0, saw: 0, fish: 0, chime: 0, horn: 0,
    clang: 0, sting: 0, promote: 0, notify: 0, victory: 0, defeat: 0,
  };
  function bump(kind) { plays[kind] = (plays[kind] || 0) + 1; }

  function _clickBlip() {
    bump("click");
    if (!ctx) return;
    tone(1300, 0.05, { type: "triangle", sweepTo: 900, peak: 0.16, atk: 0.004 });
  }
  function _hammerTap(x, z) {
    bump("hammer");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    noiseBurst(0.05, 1900, { peak: 0.22 * mul, q: 2.2, atk: 0.003 });
    tone(130, 0.06, { type: "sine", peak: 0.14 * mul, atk: 0.002, sweepTo: 90 });
  }
  function _chop(x, z) {
    bump("chop");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    noiseBurst(0.09, 480, { peak: 0.30 * mul, q: 1.4, atk: 0.004 });
    tone(85, 0.11, { type: "sine", peak: 0.22 * mul, atk: 0.003, sweepTo: 55 });
  }
  function _chip(x, z) {
    bump("chip");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    tone(2100, 0.055, { type: "triangle", peak: 0.18 * mul, atk: 0.002, sweepTo: 1500 });
    noiseBurst(0.035, 3200, { peak: 0.10 * mul, q: 3, atk: 0.002 });
  }
  function _saw(x, z) {
    bump("saw");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    noiseBurst(0.16, 850, { peak: 0.20 * mul, q: 2.6, sweepTo: 1350, atk: 0.02 });
  }
  function _fishJump(x, z) {
    bump("fish");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    tone(700, 0.08, { type: "sine", peak: 0.10 * mul, sweepTo: 340, atk: 0.004 });
  }
  function _bldChime(x, z) {
    bump("chime");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    chime([784, 988, 1175], { type: "triangle", peak: 0.18 * mul, dur: 0.4, step: 0.10 });
  }
  function _attackHorn(x, z) {
    bump("horn");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    tone(130, 0.62, { type: "sawtooth", peak: 0.22 * mul, atk: 0.09, sweepTo: 172 });
    tone(131.5, 0.62, { type: "triangle", peak: 0.14 * mul, atk: 0.10, sweepTo: 174, delay: 0.02 });
    duckMusic(0.45, 1400);
  }
  function _duelClang(x, z) {
    bump("clang");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    noiseBurst(0.10, 2800, { peak: 0.22 * mul, q: 3.4, atk: 0.002 });
    tone(1900, 0.14, { type: "triangle", peak: 0.14 * mul, atk: 0.002, sweepTo: 1200 });
  }
  function _captureSting(x, z) {
    bump("sting");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    tone(220, 0.16, { type: "sawtooth", peak: 0.22 * mul, atk: 0.004, sweepTo: 140 });
    tone(440, 0.30, { type: "triangle", peak: 0.20 * mul, atk: 0.01, sweepTo: 620, delay: 0.14 });
  }
  function _promotionPing(x, z) {
    bump("promote");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    chime([1046, 1568], { type: "triangle", peak: 0.16 * mul, dur: 0.22, step: 0.09 });
  }
  function _notifyPing(x, z) {
    bump("notify");
    if (!ctx) return;
    const mul = proximityGain(x, z);
    tone(1000, 0.13, { type: "sine", peak: 0.13 * mul, atk: 0.006, sweepTo: 900 });
  }
  function _victoryFanfare() {
    bump("victory");
    if (!ctx) return;
    duckMusic(0.6, 2400);
    chime([523, 659, 784, 1046, 784, 1046, 1318], { type: "triangle", peak: 0.26, dur: 0.5, step: 0.16, dest: sfxGain });
  }
  function _defeatSomber() {
    bump("defeat");
    if (!ctx) return;
    duckMusic(0.5, 2400);
    chime([392, 349, 293, 261], { type: "sine", peak: 0.22, dur: 0.9, step: 0.42, dest: sfxGain });
  }

  // ───────────────────────────────────────────────────────────── music ducking
  let duckT = 0;   // ctx.currentTime the current duck expires (0 = not ducking)
  function duckMusic(amount, ms) {
    if (!ctx || !musicGain) return;
    const t0 = now();
    const base = musicLevel();
    const low = base * (1 - amount);
    musicGain.gain.cancelScheduledValues(t0);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), t0);
    musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, low), t0 + 0.18);
    musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, base), t0 + 0.18 + ms / 1000);
    duckT = t0 + 0.18 + ms / 1000;
  }
  function musicLevel() { return (muted || musicIsOff) ? 0 : MUSIC_LEVEL; }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== MUSIC — built-in "Castle Kruzer" theme (+ optional custom file / synth) ==
  // ═══════════════════════════════════════════════════════════════════════
  // MUSIC SOURCE ABSTRACTION:
  //   'theme' — the shipped MP3 (the user's own original composition), default
  //   'file'  — the user's own decoded track (uploaded override)
  //   'synth' — procedural fallback if the theme fails to load
  // Same onGameStart/onGameEnd/musicOff plumbing for all three.
  //
  // LAZY: nothing about this file is fetched at page load / init(). The fetch
  // only starts inside ensureBuiltinTheme(), which is only ever called from
  // startMusicNodes() — i.e. the moment music is actually about to play
  // (onGameStart, or a reload that resumes an already-armed game). A slow or
  // failed fetch degrades silently to the synth fallback; the title screen
  // and boot never pay the file's cost.
  const BUILTIN_THEME_URL = "assets/farmstead/music/castlekruzer-theme.mp3";
  const BUILTIN_THEME_NAME = "Castle Kruzer (theme)";
  let musicSource = "theme";
  let musicArmed = false;         // "should be audible" — true while in-game
  let synthMusicOn = false;       // the step-scheduler is actively generating
  let fileBuffer = null, fileSourceNode = null, customName = null;
  let themeBuffer = null;         // decoded built-in theme
  let themeRaw = null;            // fetched bytes awaiting AudioContext decode
  let themeLoadState = "idle";    // idle | loading | ready | error

  function ensureBuiltinTheme() {
    if (themeBuffer || themeLoadState === "loading" || themeLoadState === "ready") return;
    if (themeRaw) { decodeThemeBuffer(); return; }
    themeLoadState = "loading";
    fetch(BUILTIN_THEME_URL).then((r) => {
      if (!r.ok) throw new Error("theme fetch " + r.status);
      return r.arrayBuffer();
    }).then((buf) => {
      themeRaw = buf;
      decodeThemeBuffer();
    }).catch(() => {
      themeLoadState = "error";
      if (musicSource === "theme") {
        musicSource = "synth";
        if (musicArmed && ctx) restartMusicIfArmed();
      }
    });
  }
  function decodeThemeBuffer() {
    if (!themeRaw) return;
    if (!ctx) return; // wait for unlock — raw stays cached
    const copy = themeRaw.slice ? themeRaw.slice(0) : themeRaw;
    ctx.decodeAudioData(copy).then((decoded) => {
      themeBuffer = decoded;
      themeLoadState = "ready";
      themeRaw = null; // free the duplicate once decoded
      if (musicSource === "theme" && musicArmed) restartMusicIfArmed();
    }).catch(() => {
      themeLoadState = "error";
      if (musicSource === "theme") {
        musicSource = "synth";
        if (musicArmed && ctx) restartMusicIfArmed();
      }
    });
  }

  // Dorian mode from a warm mid-register root — a classic "folk/medieval" colour
  // (it's neither major nor minor: the natural 6th against a minor 3rd is what
  // gives modal folk tunes their character). Root D4.
  const ROOT_HZ = 293.66;
  const DORIAN_SEMITONES = [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19];   // 12 degrees, two octaves
  function degHz(deg, octave) {
    const semis = DORIAN_SEMITONES[((deg % DORIAN_SEMITONES.length) + DORIAN_SEMITONES.length) % DORIAN_SEMITONES.length];
    return ROOT_HZ * Math.pow(2, (semis + 12 * (octave || 0)) / 12);
  }
  // The chord progression (i – VII – iv – v, scale-degree roots into the mode)
  // — a gentle modal wander that never resolves too "pop", reads pastoral.
  const PROGRESSION = [0, 6, 3, 4];
  const STEP_DUR = 0.3125;         // one 8th note at 96 BPM
  const CHORD_STEPS = 28;          // ~8.75s/chord × 4 chords ≈ a 35s phrase, repeated
  // ^ the whole PROGRESSION cycles roughly every 35s; nothing about the piece
  //   is a literal fixed 60-90s recording — it is a small generative engine
  //   whose Math.random()-picked plucks/lead notes never repeat identically
  //   even though the chord skeleton loops, which is the "seeded-PRNG
  //   variation per loop so it doesn't fatigue" the brief asked for (see the
  //   Phase-F report for the fuller reasoning).

  let musicStep = 0, musicStepAcc = 0;
  let padVoices = null;            // the currently-sustaining pad triad (3 gain/osc pairs)
  let leadNextAllowedStep = 0;

  function padChordFor(step) {
    const chordIdx = Math.floor(step / CHORD_STEPS) % PROGRESSION.length;
    const root = PROGRESSION[chordIdx];
    return [root, root + 2, root + 4];   // stacked thirds within the mode
  }
  function startPad(degrees) {
    if (!ctx) return null;
    const g = mkGain(musicGain, 0);
    const voices = [];
    for (let i = 0; i < degrees.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = degHz(degrees[i], -1);
      osc.detune.value = (i - 1) * 4;
      const vg = mkGain(g, 0.0001);
      osc.connect(vg);
      osc.start();
      voices.push({ osc, vg });
    }
    const t0 = now();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.22, t0 + 2.2);     // slow swell in
    return { g, voices, bornAt: t0 };
  }
  function stopPad(pad) {
    if (!pad || !ctx) return;
    const t0 = now();
    pad.g.gain.cancelScheduledValues(t0);
    pad.g.gain.setValueAtTime(Math.max(0.0001, pad.g.gain.value), t0);
    pad.g.gain.linearRampToValueAtTime(0.0001, t0 + 1.8);
    const voices = pad.voices;
    setTimeout(() => {
      voices.forEach((v) => { try { v.osc.stop(); v.osc.disconnect(); v.vg.disconnect(); } catch (e) { /* noop */ } });
      try { pad.g.disconnect(); } catch (e) { /* noop */ }
    }, 2000);
  }

  /** One 8th-note step of the generative score: pluck / lead / percussion. */
  function musicStepFn() {
    const degrees = padChordFor(musicStep);
    // chord change → crossfade pads
    const chordIdx = Math.floor(musicStep / CHORD_STEPS) % PROGRESSION.length;
    const prevChordIdx = Math.floor((musicStep - 1) / CHORD_STEPS) % PROGRESSION.length;
    if (musicStep === 0 || chordIdx !== prevChordIdx) {
      const old = padVoices;
      padVoices = startPad(degrees);
      if (old) stopPad(old);
    }
    // gentle harp-like pluck — most steps get one, picked from the chord
    // (root/3rd/5th), occasionally an octave up for sparkle
    if (Math.random() < 0.62) {
      const deg = degrees[(Math.random() * degrees.length) | 0];
      const oct = Math.random() < 0.32 ? 1 : 0;
      const f = degHz(deg, oct);
      tone(f, 0.9, { type: "triangle", peak: 0.10, atk: 0.004, dest: musicGain, sweepTo: f * 0.998 });
      tone(f * 2.003, 0.5, { type: "sine", peak: 0.028, atk: 0.003, dest: musicGain });   // faint harmonic shimmer
    }
    // sparse woodwind lead — longer sustained notes, not every step, with a
    // soft attack + a slow vibrato so it reads as breath, not a synth beep
    if (musicStep >= leadNextAllowedStep && Math.random() < 0.34) {
      const deg = degrees[(Math.random() * degrees.length) | 0] + (Math.random() < 0.5 ? 2 : 0);
      const f = degHz(deg, 0);
      const dur = 1.1 + Math.random() * 1.0;
      if (ctx && admit(dur * 1000 + 80)) {
        const t0 = now();
        const g = mkGain(musicGain, 0.0001);
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, t0);
        const lfo = ctx.createOscillator(); lfo.frequency.value = 5.2;
        const lfoGain = ctx.createGain(); lfoGain.gain.value = 2.4;
        lfo.connect(lfoGain); lfoGain.connect(osc.detune);
        lfo.start(t0); lfo.stop(t0 + dur + 0.05);
        osc.connect(g);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(0.14, t0 + 0.18);
        g.gain.setValueAtTime(0.14, t0 + dur - 0.28);
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
        osc.start(t0); osc.stop(t0 + dur + 0.05);
        osc.onended = () => { try { osc.disconnect(); lfo.disconnect(); lfoGain.disconnect(); g.disconnect(); } catch (e) { /* noop */ } };
      }
      leadNextAllowedStep = musicStep + 5 + ((Math.random() * 4) | 0);
    }
    // light hand percussion — a soft pulse on the downbeat of every beat
    // (every 2 steps), an occasional quieter off-beat tap for a tambourine feel
    if (musicStep % 2 === 0) {
      noiseBurst(0.09, 190, { peak: 0.075, q: 1.6, atk: 0.006, dest: musicGain });
    } else if (Math.random() < 0.22) {
      noiseBurst(0.045, 720, { peak: 0.045, q: 2.4, atk: 0.003, dest: musicGain });
    }
    musicStep++;
  }

  function synthMusicFrame(dt) {
    if (!synthMusicOn || !ctx) return;
    musicStepAcc += dt;
    let guard = 0;
    while (musicStepAcc >= STEP_DUR && guard < 8) {   // guard: never spiral after a tab-hidden gap
      musicStepAcc -= STEP_DUR;
      musicStepFn();
      guard++;
    }
    if (guard >= 8) musicStepAcc = 0;
  }

  function stopMusicNodes() {
    if (fileSourceNode) { try { fileSourceNode.stop(); } catch (e) { /* noop */ } try { fileSourceNode.disconnect(); } catch (e) { /* noop */ } fileSourceNode = null; }
    synthMusicOn = false;
    if (padVoices) { stopPad(padVoices); padVoices = null; }
    musicStep = 0; musicStepAcc = 0; leadNextAllowedStep = 0;
  }
  function startLoopedBuffer(buf) {
    fileSourceNode = ctx.createBufferSource();
    fileSourceNode.buffer = buf;
    fileSourceNode.loop = true;
    fileSourceNode.connect(musicGain);
    fileSourceNode.start();
  }
  function startMusicNodes() {
    if (!ctx || !musicArmed) return;
    stopMusicNodes();
    if (musicSource === "file" && fileBuffer) {
      startLoopedBuffer(fileBuffer);
    } else if (musicSource === "theme" && themeBuffer) {
      startLoopedBuffer(themeBuffer);
    } else if (musicSource === "theme") {
      ensureBuiltinTheme(); // still loading — synth keeps silence from settling in
      synthMusicOn = true;
    } else {
      synthMusicOn = true;
    }
  }
  function restartMusicIfArmed() { if (musicArmed && ctx) startMusicNodes(); }

  function fadeMusicGainTo(v, secs) {
    if (!ctx || !musicGain) return;
    const t0 = now();
    musicGain.gain.cancelScheduledValues(t0);
    musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), t0);
    musicGain.gain.linearRampToValueAtTime(Math.max(0.0001, v), t0 + secs);
  }

  // ───────────────────────────────────────────────────────────── ambience —
  // sparse PRNG birdsong: a handful of short, high, pitch-swept chirps on a
  // random clock. Not tied to any world position (there is no single "where"
  // for ambient wildlife) — a gentle stereo pan gives it a little life instead.
  let birdT = 3 + Math.random() * 6;
  function birdChirp() {
    if (!ctx) return;
    const base = 2000 + Math.random() * 1600;
    const pan = (Math.random() * 2 - 1) * 0.6;
    for (let i = 0; i < 2 + ((Math.random() * 2) | 0); i++) {
      tone(base + Math.random() * 200, 0.075, {
        type: "sine", peak: 0.05, atk: 0.006, sweepTo: base * (1.15 + Math.random() * 0.3),
        delay: i * 0.09, pan: pan,
      });
    }
  }

  // ───────────────────────────────────────────────────────────── hammer scan
  // "hammer taps while any visible construction active, proximity-gated":
  // sampled from G, never from sim internals — a building mid-'build' with a
  // crew present is genuinely being hammered on (see fs-sim.js tickConstruction).
  const hammerTimers = new Map();   // building id -> seconds until next tap
  function hammerScan(G, dt) {
    if (!G || !G.buildings) return;
    const seen = new Set();
    let n = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.state !== "build" || !b.crew) continue;
      if (++n > 6) break;                    // bounded work per frame
      seen.add(id);
      let t = hammerTimers.get(id);
      if (t === undefined) t = 0.15 + Math.random() * 0.3;
      t -= dt;
      if (t <= 0) {
        const w = worldOfVertex(b.v);
        if (w) _hammerTap(w[0], w[1]);
        t = 0.5 + Math.random() * 0.35;
      }
      hammerTimers.set(id, t);
    }
    if (hammerTimers.size > 40) hammerTimers.forEach((v, k) => { if (!seen.has(k)) hammerTimers.delete(k); });
  }

  // ───────────────────────────────────────────────────────────── event drain
  // Mirrors the house pattern already used by fs-ui.js's pollNotifications /
  // syncPingMark: a TICK watermark (not an array index), since G.events is a
  // capped ring that splices old entries out (indices shift; ticks don't).
  let lastSeenTick = -1;
  const EVENT_SCAN_CAP = 80;
  const EVENT_SFX = {
    treeFelled: (e) => _chop.apply(null, worldOfVertex(e.v) || []),
    stoneCut: (e) => _chip.apply(null, worldOfVertex(e.v) || []),
    bldDone: (e) => _bldChime.apply(null, worldOfVertex(e.v) || []),
    attackLaunched: (e) => _attackHorn.apply(null, worldOfVertex(e.v) || []),
    fightRound: (e) => _duelClang.apply(null, worldOfVertex(e.v) || []),
    bldCaptured: (e) => _captureSting.apply(null, worldOfVertex(e.v) || []),
    knightPromoted: (e) => {
      const b = lastG && lastG.buildings ? lastG.buildings[e.bld] : null;
      const w = b ? worldOfVertex(b.v) : null;
      _promotionPing.apply(null, w || []);
    },
    mineExhausted: (e) => _notifyPing.apply(null, worldOfVertex(e.v) || []),
    siegeBroken: (e) => {
      const b = lastG && lastG.buildings ? lastG.buildings[e.bld] : null;
      const w = b ? worldOfVertex(b.v) : null;
      _notifyPing.apply(null, w || []);
    },
    geoSign: (e) => { if (e.mineral > 0) _notifyPing.apply(null, worldOfVertex(e.v) || []); },
    playerEliminated: (e, G) => { if (e.p === myPlayerOf(G)) _defeatSomber(); },
    gameOver: (e, G) => {
      const mine = myPlayerOf(G);
      const won = (e.winners || []).indexOf(mine) >= 0;
      if (won) _victoryFanfare(); else _defeatSomber();
    },
  };
  // sawmill's "produced" is filtered out of the generic table (produced fires
  // for EVERY producer, far too chatty) — only the saw accent rides on it.
  function handleProduced(e) { if (e.btype === "sawmill" && e.res === "plank") _saw.apply(null, worldOfVertex(e.bld ? (lastG.buildings[e.bld] || {}).v : -1) || []); }

  function myPlayerOf(G) {
    if (!G) return 0;
    const net = FS && FS.FSNet;
    const seat = (net && net.state) ? (net.state().seat || 0) : 0;
    return (G.seats && G.seats[seat] !== undefined) ? G.seats[seat] : 0;
  }

  function drainEvents(G) {
    const evs = G.events;
    if (!evs || !evs.length) return;
    const out = [];
    for (let i = evs.length - 1; i >= 0 && out.length < EVENT_SCAN_CAP; i--) {
      const e = evs[i];
      if (e.t <= lastSeenTick) break;   // append-only + tick-ordered: safe early-out
      out.push(e);
    }
    lastSeenTick = G.tick;
    if (!out.length) return;
    out.reverse();
    for (let i = 0; i < out.length; i++) {
      const e = out[i];
      if (e.type === "produced") { handleProduced(e); continue; }
      const fn = EVENT_SFX[e.type];
      if (fn) fn(e, G);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== unlock / gesture gate ==============================================
  // ═══════════════════════════════════════════════════════════════════════
  function buildGraph() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : MASTER_LEVEL;
    masterGain.connect(ctx.destination);
    sfxGain = mkGain(masterGain, 1);
    musicGain = mkGain(masterGain, musicLevel());
    return true;
  }
  FSAudio.unlock = function () {
    if (unlocked) { if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {}); return true; }
    if (!buildGraph()) return false;
    unlocked = true;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    // NOTE: the built-in theme is deliberately NOT fetched here — unlock()
    // fires on every gesture, including idle taps on the title screen, long
    // before music is meant to play. startMusicNodes() (called from
    // onGameStart / restartMusicIfArmed) is the one place that lazily kicks
    // off ensureBuiltinTheme(), so the 5.3MB file is only ever requested once
    // gameplay actually begins.
    // pick up a previously-saved custom track, if any (survives reloads);
    // never throws — a corrupt/unsupported stored file just stays on the
    // built-in theme.
    idbGetMusic().then((rec) => {
      if (!rec || !rec.data) return;
      return ctx.decodeAudioData(rec.data.slice ? rec.data.slice(0) : rec.data).then((decoded) => {
        fileBuffer = decoded; customName = rec.name || "custom track"; musicSource = "file";
        restartMusicIfArmed();
      });
    }).catch(() => { /* decode/storage failure — stays on the built-in theme */ });
    if (musicArmed) startMusicNodes();
    return true;
  };

  // ═══════════════════════════════════════════════════════════════════════
  // ===== public: mute / music-off / custom music ============================
  // ═══════════════════════════════════════════════════════════════════════
  FSAudio.muted = function () { return muted; };
  FSAudio.setMuted = function (b) {
    muted = !!b; persistMuted();
    /* Mute is a binary switch, not a musical event — it takes effect
     * INSTANTLY (direct value assignment, not a ramp). Besides matching the
     * player's expectation ("mute" should be immediate), a scheduled ramp
     * (setTargetAtTime/linearRampToValueAtTime) only reaches its target on
     * the audio thread's own clock — reading `.gain.value` back synchronously
     * right after would still show the OLD value, which is also just wrong
     * for a debug/test surface that wants to see the effect immediately. */
    if (masterGain) { masterGain.gain.cancelScheduledValues(now()); masterGain.gain.value = muted ? 0 : MASTER_LEVEL; }
    if (muted && ctx) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* noop */ } }
    return muted;
  };
  FSAudio.toggleMuted = function () { return FSAudio.setMuted(!muted); };

  FSAudio.musicOff = function () { return musicIsOff; };
  FSAudio.setMusicOff = function (b) {
    musicIsOff = !!b; persistMusicOff();
    // same reasoning as setMuted above — an instant, reliable on/off.
    if (musicGain) { musicGain.gain.cancelScheduledValues(now()); musicGain.gain.value = musicLevel(); }
    return musicIsOff;
  };
  FSAudio.toggleMusicOff = function () { return FSAudio.setMusicOff(!musicIsOff); };

  FSAudio.musicInfo = function () {
    const ready = musicSource === "synth"
      || (musicSource === "file" && !!fileBuffer)
      || (musicSource === "theme" && !!themeBuffer);
    const name = musicSource === "file" ? customName
      : (musicSource === "theme" ? BUILTIN_THEME_NAME : null);
    return { source: musicSource, ready: ready, name: name, themeLoad: themeLoadState };
  };
  FSAudio.setCustomMusic = function (file) {
    if (!file) return Promise.resolve({ ok: false, why: "no file" });
    if (!unlocked) FSAudio.unlock();
    if (!ctx) return Promise.resolve({ ok: false, why: "audio unavailable" });
    return file.arrayBuffer().then((buf) => {
      return ctx.decodeAudioData(buf.slice(0)).then((decoded) => {
        return idbPutMusic(buf, file.name, file.type).catch(() => { /* still usable this session */ }).then(() => {
          fileBuffer = decoded;
          customName = file.name || "custom track";
          musicSource = "file";
          restartMusicIfArmed();
          return { ok: true };
        });
      }, () => ({ ok: false, why: "decode failed — kept the built-in theme" }));
    }, () => ({ ok: false, why: "could not read the file" }));
  };
  FSAudio.clearCustomMusic = function () {
    return idbClearMusic().catch(() => {}).then(() => {
      fileBuffer = null; customName = null;
      musicSource = (themeBuffer || themeLoadState !== "error") ? "theme" : "synth";
      ensureBuiltinTheme();
      restartMusicIfArmed();
      return true;
    });
  };

  // ═══════════════════════════════════════════════════════════════════════
  // ===== gameplay boundary + per-frame drive =================================
  // ═══════════════════════════════════════════════════════════════════════
  FSAudio.onGameStart = function () {
    musicArmed = true;
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      startMusicNodes();
      fadeMusicGainTo(musicLevel(), 1.2);
    }
  };
  FSAudio.onGameEnd = function () {
    musicArmed = false;
    if (ctx) fadeMusicGainTo(0, 0.8);
    setTimeout(stopMusicNodes, 900);
  };

  FSAudio.frame = function (dt, G) {
    dt = Math.min(0.1, dt || 0);
    /* ===== a NEW G object (newGame / load / co-op adopt) means a fresh event
     * timeline — without this, `lastSeenTick` stays parked at whatever the
     * PREVIOUS game's tick counter last reached, which is almost always
     * HIGHER than a fresh game's tick (every new game starts near 0), so
     * every event-driven cue (chop/chime/horn/clang/…) would silently never
     * fire again for the rest of the session. Mirrors fs-fx.js's own
     * `g !== G` fresh-world detection. ===== */
    if (G && G !== lastG) { lastSeenTick = -1; hammerTimers.clear(); }
    lastG = G || lastG;
    if (G) {
      if (lastSeenTick < 0) lastSeenTick = G.tick;   // fresh world — skip its boot history
      drainEvents(G);
      hammerScan(G, dt);
    }
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      // once the real theme buffer is driving, drop temporary synth filler
      if (fileSourceNode && synthMusicOn && (musicSource === "theme" || musicSource === "file")) {
        synthMusicOn = false;
        if (padVoices) { stopPad(padVoices); padVoices = null; }
      } else if (synthMusicOn) {
        synthMusicFrame(dt);
      }
      birdT -= dt;
      if (birdT <= 0 && G) { birdT = 5 + Math.random() * 11; birdChirp(); }
    }
  };

  // ───────────────────────────────────────────────────────────── UI click blip
  // Self-contained: fs-audio owns this listener so no other Phase-F-owned
  // file needs to know about it. Any real user gesture also serves as the
  // unlock trigger. Delegated (capture) so it survives DOM rebuilds.
  function isInteractiveButton(el) {
    return el && el.closest && el.closest("#fsui-root button, #title button, #fsSheetWrap button");
  }
  document.addEventListener("pointerdown", (e) => { FSAudio.unlock(); }, { capture: true });
  document.addEventListener("keydown", (e) => { FSAudio.unlock(); }, { capture: true });
  document.addEventListener("click", (e) => {
    if (isInteractiveButton(e.target)) _clickBlip();
  }, true);

  // ═══════════════════════════════════════════════════════════════════════
  // ===== debug / test hook ===================================================
  // ═══════════════════════════════════════════════════════════════════════
  FSAudio.init = function (FSref) {
    FS = FSref;
    FSMap = FS && FS.FSMap;
    // deliberately NO ensureBuiltinTheme() here — this runs at page boot,
    // long before any gesture/gameplay; see the lazy-load note above.
    return FSAudio;
  };
  FSAudio.debug = function () {
    return {
      unlocked: unlocked,
      ctxState: ctx ? ctx.state : "none",
      muted: muted,
      musicOff: musicIsOff,
      masterGain: masterGain ? masterGain.gain.value : null,
      musicGain: musicGain ? musicGain.gain.value : null,
      sfxGain: sfxGain ? sfxGain.gain.value : null,
      musicSource: musicSource,
      musicArmed: musicArmed,
      synthMusicOn: synthMusicOn,
      customName: customName,
      themeLoad: themeLoadState,
      themeReady: !!themeBuffer,
      themePlaying: !!(fileSourceNode && musicSource === "theme"),
      activeVoices: activeVoices,
      ducking: duckT > now(),
    };
  };
  // test-only direct triggers (mirrors the private _xxx fns 1:1 so the polish
  // suite can exercise every SFX kind without scripting a full sim event)
  FSAudio._trigger = function (kind, x, z) {
    const map = {
      click: _clickBlip, hammer: _hammerTap, chop: _chop, chip: _chip, saw: _saw, fish: _fishJump,
      chime: _bldChime, horn: _attackHorn, clang: _duelClang, sting: _captureSting,
      promote: _promotionPing, notify: _notifyPing, victory: _victoryFanfare, defeat: _defeatSomber,
    };
    const fn = map[kind];
    if (fn) fn(x, z);
  };
  FSAudio.version = 1;

  window.FSAudio = FSAudio;
})();
