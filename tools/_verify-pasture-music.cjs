#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic 4-TRACK INTENSITY MUSIC system.
 *
 * The music wiring already lives in pasturepanic.html (menu + battle1/battle2/battle3 + boss,
 * crossfaded through musicBus). This suite VERIFIES it end-to-end via the two debug hooks:
 *   - window.__PP__               game-state driver (startGame / elapsed / spawnBoss / damageEnemy /
 *                                 keepGoingEndless / endlessMode ...)
 *   - window.__PASTURE_AUDIO__    audioState() -> { musicPhase, trackGains:{menu,battle1,battle2,
 *                                 battle3,boss}, buffersLoaded, buffersTotal, masterGainV,
 *                                 musicBusV, ... }
 *
 * The music loop is polled ONCE PER FRAME from loop() *only after a real gesture* (bossMusicActive()
 * mutates its own latch each frame, so this suite NEVER calls musicPhaseForState() directly — it
 * drives game state and reads the module-level musicPhase the loop settles on). MUSIC_XFADE=0.7s, so
 * every phase assert waits ~850ms for the crossfade + poll to settle.
 *
 * Two passes:
 *   FULL     — all audio served. menu / tier bands / crossfade-gradient / boss override + anti-thrash
 *              dwell + return-to-tier (no source restart) / endless=battle3 / mute / music-toggle
 *              (music off keeps SFX) / back-to-menu. Asserts 39/39 buffers.
 *   ONE-BLOCKED — pp-music-battle2.mp3 aborted: that track decodes to null, so at tier 3 the LOGICAL
 *              phase is still 'battle2' but its gain node is never created (graceful silence) — game
 *              keeps playing with 0 pageerrors and the other tracks are unaffected.
 *
 * Firebase/Playroom/gstatic blocked (offline "this device only"). Reuses the running :8790 server.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8790; // reuse the persistent static server
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openPage(browser, { blockMusicFile } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/i.test(u)) return req.abort();
    if (blockMusicFile && u.includes("/assets/audio/pasture/" + blockMusicFile)) return req.abort();
    req.continue();
  });
  // domcontentloaded + hook-wait (NOT networkidle0 — the ~4.8MB of music mp3s never let it settle);
  // the game hook is the true readiness signal, audio streams in the background.
  await page.goto(BASE + "/pasturepanic.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__ && !!window.__PASTURE_AUDIO__, { timeout: 20000 });
  // first real gesture — unlocks the AudioContext + starts the per-frame music poll
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.up();
  return { page, errors };
}

// ---------------------------------------------------------------- FULL pass
async function runFull(browser) {
  const { page, errors } = await openPage(browser, {});
  const checks = [];
  const observed = {}; // state label -> musicPhase, for the report
  const push = (arr) => { for (const c of arr) checks.push(c); };

  // wait for all buffers to decode + the menu fade-up to settle
  await page.waitForFunction(
    () => window.__PASTURE_AUDIO__.audioState().buffersLoaded >= window.__PASTURE_AUDIO__.audioState().buffersTotal,
    { timeout: 20000 }
  ).catch(() => {});
  await sleep(850);

  // ---- 1. boot / menu music ----
  const menuRes = await page.evaluate(() => {
    const A = window.__PASTURE_AUDIO__;
    const out = [];
    const check = (name, cond, detail) => out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });
    const a = A.audioState();
    check("gesture registered", a.gestured === true, a.gestured);
    check("39/39 buffers decoded", a.buffersLoaded === 39 && a.buffersTotal === 39, a.buffersLoaded + "/" + a.buffersTotal);
    check("title screen -> musicPhase 'menu'", a.musicPhase === "menu", a.musicPhase);
    check("menu track gain rose (hot)", (a.trackGains.menu || 0) > 0.5, a.trackGains.menu);
    check("no run track playing on the title", (a.trackGains.battle1 || 0) < 0.3 && (a.trackGains.boss || 0) < 0.3, JSON.stringify(a.trackGains));
    return { out, phase: a.musicPhase };
  });
  push(menuRes.out); observed["title (menu)"] = menuRes.phase;

  // ---- 2. tier bands: battle1 (<=2) / battle2 (3-5) / battle3 (>=6) ----
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });

  async function tierPhase(elapsed) {
    await page.evaluate((e) => { window.__PP__.enemies.length = 0; window.__PP__.player.position.set(0, 0, 0); window.__PP__.elapsed = e; }, elapsed);
    await sleep(850);
    return page.evaluate(() => ({ phase: window.__PASTURE_AUDIO__.audioState().musicPhase, tier: window.__PP__.threatTier(), g: window.__PASTURE_AUDIO__.audioState().trackGains }));
  }

  let r = await tierPhase(0);
  observed["run tier 0"] = r.phase;
  checks.push({ name: "tier 0 (<=2) -> musicPhase 'battle1'", pass: r.phase === "battle1", detail: `tier=${r.tier} phase=${r.phase}` });
  checks.push({ name: "battle1 gain hot at tier 0", pass: (r.g.battle1 || 0) > 0.5, detail: r.g.battle1 });

  r = await tierPhase(90 * 1); // tier 1
  observed["run tier 1"] = r.phase;
  checks.push({ name: "tier 1 (<=2) -> musicPhase 'battle1'", pass: r.phase === "battle1", detail: `tier=${r.tier} phase=${r.phase}` });

  r = await tierPhase(90 * 4); // tier 4
  observed["run tier 4"] = r.phase;
  checks.push({ name: "tier 4 (3-5) -> musicPhase 'battle2'", pass: r.phase === "battle2", detail: `tier=${r.tier} phase=${r.phase}` });
  checks.push({ name: "battle2 gain hot at tier 4", pass: (r.g.battle2 || 0) > 0.5, detail: r.g.battle2 });

  r = await tierPhase(90 * 7); // tier 7
  observed["run tier 7"] = r.phase;
  checks.push({ name: "tier 7 (>=6) -> musicPhase 'battle3'", pass: r.phase === "battle3", detail: `tier=${r.tier} phase=${r.phase}` });
  checks.push({ name: "battle3 gain hot at tier 7", pass: (r.g.battle3 || 0) > 0.5, detail: r.g.battle3 });

  // ---- 3. crossfade is GRADUAL, not a hard cut ----
  // Settle on battle1, then switch to battle2 and densely sample the OUTGOING (battle1) gain: its
  // 0.7s linear ramp-down provably passes through intermediate values (a hard cut would drop it to 0
  // in a single frame). Reading a freshly-created node's .value returns its ramp target immediately
  // in headless Chrome, so the incoming rise is verified via before(0/null)->after(hot), not mid-ramp.
  const xf = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    P.enemies.length = 0; P.player.position.set(0, 0, 0);
    P.elapsed = 0; await sl(900);                 // battle1 fully up
    const beforeB2 = A.audioState().trackGains.battle2;   // faded/absent before the switch
    P.elapsed = 300;                              // -> battle2 on the next poll
    const b1 = [];
    for (let i = 0; i < 16; i++) { b1.push(A.audioState().trackGains.battle1); await sl(50); }
    await sl(400);
    const after = A.audioState().trackGains;
    return { beforeB2, b1, afterB1: after.battle1, afterB2: after.battle2 };
  });
  const b1nums = xf.b1.map((v) => (typeof v === "number" ? v : 0));
  const startedHigh = Math.max(...b1nums) >= 0.7;
  const endedLow = xf.afterB1 <= 0.15;
  const hasIntermediate = b1nums.some((v) => v > 0.15 && v < 0.85);
  checks.push({ name: "crossfade: outgoing battle1 gain STARTED high (>=0.7)", pass: startedHigh, detail: `max=${Math.max(...b1nums).toFixed(3)}` });
  checks.push({ name: "crossfade: outgoing battle1 gain PASSES THROUGH intermediate values (gradual, not a hard cut)", pass: hasIntermediate, detail: JSON.stringify(b1nums.map((v) => +v.toFixed(2))) });
  checks.push({ name: "crossfade: outgoing battle1 gain ENDED faded (<=0.15)", pass: endedLow, detail: xf.afterB1 });
  checks.push({ name: "crossfade: incoming battle2 rose from faded (<0.3) to hot (>0.5)", pass: (xf.beforeB2 || 0) < 0.3 && (xf.afterB2 || 0) > 0.5, detail: `${xf.beforeB2} -> ${xf.afterB2}` });

  // ---- 4. endless (post-COMBINE keepGoingEndless hook) forces battle3 even at a low tier ----
  const endl = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    P.startGame(); await sl(120);
    P.elapsed = 100;            // tier 1 -> would normally be battle1
    P.keepGoingEndless();       // the button's handler: endlessMode=true, state='playing'
    P.player.position.set(0, 0, 0);
    await sl(900);
    const a = A.audioState();
    return { phase: a.musicPhase, endless: P.endlessMode, tier: P.threatTier(), g: a.trackGains };
  });
  observed["endless (tier 1)"] = endl.phase;
  checks.push({ name: "endless mode active after keepGoingEndless()", pass: endl.endless === true, detail: endl.endless });
  checks.push({ name: "endless at tier 1 -> musicPhase 'battle3' (relentless override)", pass: endl.phase === "battle3", detail: `tier=${endl.tier} phase=${endl.phase}` });
  checks.push({ name: "battle3 gain hot in endless", pass: (endl.g.battle3 || 0) > 0.5, detail: endl.g.battle3 });
  await page.evaluate(() => { window.__PP__.endlessMode = false; });

  // ---- 5. boss override + anti-thrash dwell + return to the SAME tier track (no restart) ----
  // fresh run pinned to tier 6 (battle3) so the boss must RETURN to battle3.
  const bossSetup = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    P.startGame(); await sl(120);
    P.enemies.length = 0; P.player.position.set(0, 0, 0); P.elapsed = 540; // tier 6 -> battle3
    await sl(900);
    const bg = A.audioState().trackGains;
    return { tierPhase: A.audioState().musicPhase, battle3Before: bg.battle3 };
  });
  observed["run tier 6 (pre-boss)"] = bossSetup.tierPhase;
  checks.push({ name: "pre-boss background is battle3 (tier 6)", pass: bossSetup.tierPhase === "battle3", detail: bossSetup.tierPhase });

  const bossOn = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    P.enemies.length = 0;
    P.spawnBoss();
    await sl(900);
    const a = A.audioState();
    return { phase: a.musicPhase, g: a.trackGains, hasBoss: !!P.boss };
  });
  observed["boss active"] = bossOn.phase;
  checks.push({ name: "boss spawned -> musicPhase 'boss' (overrides tier)", pass: bossOn.phase === "boss", detail: bossOn.phase });
  checks.push({ name: "boss gain crossfaded IN (hot)", pass: (bossOn.g.boss || 0) > 0.5, detail: bossOn.g.boss });
  checks.push({ name: "battle3 gain crossfaded OUT under boss (faded)", pass: (bossOn.g.battle3 || 0) < 0.4, detail: bossOn.g.battle3 });
  // KEY 'no restart' proxy: battle3's gain node still EXISTS (numeric, not null) while silenced ->
  // its looping source was never torn down, so returning fades the SAME source back up.
  checks.push({ name: "battle3 source persists under boss (gain node numeric, not null -> no teardown)", pass: typeof bossOn.g.battle3 === "number", detail: bossOn.g.battle3 });

  // kill the boss, then assert the anti-thrash dwell HOLDS boss music (doesn't flip within the window)
  const dwell = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    P.hp = 1e9; // survive the dwell wait
    P.damageEnemy(P.boss, 1e9, new THREE.Vector3(1, 0, 0));
    await sl(300);
    const p300 = A.audioState().musicPhase;
    // keep the chef alive & world clear across the rest of the dwell window
    for (let w = 0; w < 2500; w += 150) { P.enemies.length = 0; P.player.position.set(0, 0, 0); P.hp = 1e9; await sl(150); }
    const pMid = A.audioState().musicPhase; // still well within BOSS_MIN_DWELL(6s from spawn)
    return { p300, pMid, bossGone: !P.boss };
  });
  observed["just after boss kill (dwell)"] = dwell.p300;
  checks.push({ name: "boss dead but within dwell (300ms after kill) -> STILL 'boss' (no thrash)", pass: dwell.p300 === "boss", detail: dwell.p300 });
  checks.push({ name: "still 'boss' ~2.8s after kill (inside BOSS_MIN_DWELL) -> anti-thrash holds", pass: dwell.pMid === "boss", detail: dwell.pMid });

  // wait past the full dwell (>6s from spawn + 2s tail) -> returns to battle3
  const ret = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let w = 0; w < 6000; w += 150) { P.enemies.length = 0; P.player.position.set(0, 0, 0); P.hp = 1e9; await sl(150); }
    const a = A.audioState();
    return { phase: a.musicPhase, g: a.trackGains, tier: P.threatTier() };
  });
  observed["after dwell (boss over)"] = ret.phase;
  checks.push({ name: "after dwell -> returns to the correct tier track 'battle3'", pass: ret.phase === "battle3", detail: `tier=${ret.tier} phase=${ret.phase}` });
  checks.push({ name: "battle3 gain hot again after boss (crossfaded back up, not restarted from silence-teardown)", pass: (ret.g.battle3 || 0) > 0.5, detail: ret.g.battle3 });
  checks.push({ name: "boss gain faded back out", pass: (ret.g.boss || 0) < 0.3, detail: ret.g.boss });

  // ---- 6. 🔊 mute zeroes master ----
  const mute = await page.evaluate(async () => {
    const A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    const check = (name, cond, detail) => out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });
    document.getElementById("muteBtn").click(); await sl(20);
    let a = A.audioState();
    check("🔊 mute zeroes masterGain (all audio killed)", a.masterGainV === 0, a.masterGainV);
    check("mute persists to localStorage pp_muted=1", localStorage.getItem("pp_muted") === "1", localStorage.getItem("pp_muted"));
    document.getElementById("muteBtn").click(); await sl(20);
    a = A.audioState();
    check("🔊 unmute restores masterGain to 1", a.masterGainV === 1, a.masterGainV);
    return out;
  });
  push(mute);

  // ---- 7. 🎵 music toggle: stops music, keeps SFX ----
  const mus = await page.evaluate(async () => {
    const A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    const check = (name, cond, detail) => out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });
    document.getElementById("musicBtn").click(); await sl(20);
    let a = A.audioState();
    check("🎵 toggle zeroes musicBus (music stops)", a.musicBusV === 0, a.musicBusV);
    check("music toggle persists to localStorage pp_music_off=1", localStorage.getItem("pp_music_off") === "1", localStorage.getItem("pp_music_off"));
    // SFX still work while music is off (master still 1, playSample routes to masterGain, not musicBus)
    check("masterGain untouched by music toggle (SFX bus alive)", a.masterGainV === 1, a.masterGainV);
    const played = A.playSample("pp-sfx-coin-pickup", { gain: 0.5 });
    check("an SFX still PLAYS with music off (playSample returns true)", played === true, played);
    document.getElementById("musicBtn").click(); await sl(20);
    a = A.audioState();
    check("🎵 toggle restores musicBus (>0.3)", a.musicBusV > 0.3, a.musicBusV);
    return out;
  });
  push(mus);

  // ---- 8. back to the title -> crossfades back to menu music ----
  const back = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    P.startGame(); P.gameOver(false); // -> state 'over'
    await sl(900);
    const a = A.audioState();
    return { phase: a.musicPhase, g: a.trackGains, state: P.state };
  });
  observed["game over (menu)"] = back.phase;
  checks.push({ name: "game over -> musicPhase back to 'menu'", pass: back.phase === "menu", detail: `state=${back.state} phase=${back.phase}` });
  checks.push({ name: "menu gain rose again on return", pass: (back.g.menu || 0) > 0.5, detail: back.g.menu });
  checks.push({ name: "run/boss tracks faded on return to menu", pass: (back.g.battle3 || 0) < 0.3 && (back.g.boss || 0) < 0.3, detail: JSON.stringify(back.g) });

  await page.close();
  return { checks, errors, observed };
}

// ---------------------------------------------------- ONE-MUSIC-BLOCKED pass
async function runOneBlocked(browser) {
  const { page, errors } = await openPage(browser, { blockMusicFile: "pp-music-battle2.mp3" });
  const checks = [];
  const observed = {};
  // let the other 38 buffers settle (the blocked one rejects fast)
  await page.waitForFunction(
    () => { const a = window.__PASTURE_AUDIO__.audioState(); return a.buffersLoaded >= a.buffersTotal - 1; },
    { timeout: 20000 }
  ).catch(() => {});
  await sleep(700);

  const res = await page.evaluate(async () => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const sl = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = [];
    const check = (name, cond, detail) => out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });
    const a0 = A.audioState();
    check("38/39 buffers decoded (one music file blocked)", a0.buffersLoaded === 38, a0.buffersLoaded + "/" + a0.buffersTotal);

    // menu still plays (its file wasn't blocked)
    check("menu music still plays with battle2 blocked", a0.musicPhase === "menu" && (a0.trackGains.menu || 0) > 0.5, JSON.stringify(a0.trackGains));

    // start a run, visit tier 0 (battle1 works) then tier 3 (battle2 blocked -> graceful silence)
    P.startGame(); await sl(120);
    P.enemies.length = 0; P.player.position.set(0, 0, 0); P.elapsed = 0; await sl(850);
    const t0 = A.audioState();
    check("tier 0 battle1 STILL works (its file was served)", t0.musicPhase === "battle1" && (t0.trackGains.battle1 || 0) > 0.5, JSON.stringify(t0.trackGains));

    P.enemies.length = 0; P.player.position.set(0, 0, 0); P.elapsed = 300; await sl(850);
    const t3 = A.audioState();
    check("tier 3 LOGICAL phase is still 'battle2' (phase machine unaffected by a missing buffer)", t3.musicPhase === "battle2", t3.musicPhase);
    check("battle2 gain node NEVER created (graceful silence -> null, no crash)", t3.trackGains.battle2 === null, t3.trackGains.battle2);
    check("game still playing through the silent band", P.state === "playing", P.state);

    // tier 7 -> battle3 works again (proves only the blocked track is silent)
    P.enemies.length = 0; P.player.position.set(0, 0, 0); P.elapsed = 640; await sl(850);
    const t7 = A.audioState();
    check("tier 7 battle3 works (only battle2 is silent)", t7.musicPhase === "battle3" && (t7.trackGains.battle3 || 0) > 0.5, JSON.stringify(t7.trackGains));
    return { out, phases: { title: a0.musicPhase, tier0: t0.musicPhase, tier3: t3.musicPhase, tier7: t7.musicPhase } };
  });
  checks.push(...res.out);
  Object.assign(observed, res.phases);

  // canvas rendered + still interactive
  const canvasOk = await page.evaluate(() => { const c = document.querySelector("canvas"); return !!c && c.width > 0 && c.height > 0; });
  checks.push({ name: "game canvas rendered (blocked-music pass)", pass: canvasOk, detail: canvasOk });

  await page.close();
  return { checks, errors, observed };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
  });

  let allOk = true;
  try {
    for (const [label, fn] of [
      ["FULL (all audio served)", runFull],
      ["ONE-BLOCKED (pp-music-battle2 aborted)", runOneBlocked],
    ]) {
      console.log(`\n=== PASS: ${label} ===`);
      const r = await fn(browser);
      let passOk = true;
      for (const c of r.checks) {
        const mark = c.pass ? "PASS" : "FAIL";
        if (!c.pass) passOk = false;
        console.log(`  [${mark}] ${c.name}${c.detail !== "" ? "  (" + c.detail + ")" : ""}`);
      }
      if (r.errors.length) {
        passOk = false;
        console.log(`  PAGE ERRORS (${r.errors.length}):`);
        for (const e of r.errors) console.log("    " + e);
      }
      if (r.observed) {
        console.log("  observed musicPhase per state:");
        for (const k of Object.keys(r.observed)) console.log(`     ${k.padEnd(28)} -> ${r.observed[k]}`);
      }
      const total = r.checks.length, pass_ = r.checks.filter((c) => c.pass).length;
      console.log(`  -> ${pass_}/${total} checks passed, ${r.errors.length} pageerrors`);
      if (!passOk) allOk = false;
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  console.log(allOk ? "\nALL PASSES GREEN" : "\nSOME CHECKS FAILED");
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
