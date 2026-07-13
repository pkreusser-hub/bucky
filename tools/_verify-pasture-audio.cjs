#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic generated audio (assets/audio/pasture/, ElevenLabs).
 * This game had NO prior audio at all — the rig built here (masterGain/musicBus,
 * pp_muted/pp_music_off localStorage, first-gesture unlock, playSample no-op when a
 * buffer isn't ready) has no synth fallback layer, so BLOCKED must simply mean silent,
 * never broken. Two passes, mirroring the Farm Kart / Hayhem audio-verify convention:
 *
 *  1) BLOCKED — assets/audio/pasture/* aborted. Buffers never decode; every playSample()
 *     call returns false and every sfxPlays counter stays 0. Game must still boot, start
 *     a run, and take core gameplay actions (fire weapons, kill enemies, collect pickups,
 *     level up, take damage, game over) with 0 pageerrors.
 *  2) SAMPLES — served normally. All 39 files decode, gesture-unlock starts menu music,
 *     starting a run crossfades to the tier band (battle1 at tier 0), every gameplay beat's
 *     sfxPlays counter ticks, the INTENSITY system selects battle1/2/3 by threatTier, a boss
 *     overrides with the Showdown track and returns to the tier track after the anti-thrash
 *     dwell, endless forces battle3, returning to the title crossfades back to menu music,
 *     and the 🔊 mute / 🎵 music toggle buttons both work and persist.
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

async function runPass(browser, { blockAudio, label }) {
  console.log(`\n=== PASS: ${label} ===`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    if (blockAudio && /\/assets\/audio\/pasture\//i.test(u)) return req.abort();
    req.continue();
  });

  // domcontentloaded + hook-wait (NOT networkidle0): the ~4.8MB of new intensity-music mp3s keep the
  // connection busy past the 60s nav cap, so networkidle0 never settles (this SAMPLES pass needs the
  // audio, so it explicitly waits on buffersLoaded below); the __PP__/__PASTURE_AUDIO__ hooks are the
  // real readiness signal.
  await page.goto(BASE + "/pasturepanic.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__ && !!window.__PASTURE_AUDIO__, { timeout: 20000 });

  // first real gesture — unlocks AudioContext playback + starts menu music if buffers are ready
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.up();

  if (!blockAudio) {
    await page.waitForFunction(
      () => window.__PASTURE_AUDIO__.audioState().buffersLoaded >= window.__PASTURE_AUDIO__.audioState().buffersTotal,
      { timeout: 20000 }
    ).catch(() => {});
    // late-decode retry + the 0.6s fade-up ramp both need a beat to actually settle
    await new Promise((r) => setTimeout(r, 800));
  }

  const checks = [];
  function pushChecks(arr) { for (const c of arr) checks.push(c); }

  // ---- boot / gesture / menu-music state ----
  pushChecks(await page.evaluate((blockAudio) => {
    const A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const a0 = A.audioState();
    check("audio ctx exists", a0.ctxState === "running" || a0.ctxState === "suspended", a0.ctxState);
    check("unmuted masterGain 1", a0.masterGainV === 1, a0.masterGainV);
    check("gesture registered", a0.gestured === true, a0.gestured);
    check("buffersTotal is 39", a0.buffersTotal === 39, a0.buffersTotal);
    if (blockAudio) {
      check("no buffers loaded (blocked)", a0.buffersLoaded === 0, a0.buffersLoaded);
    } else {
      check("all buffers loaded", a0.buffersLoaded === a0.buffersTotal, a0.buffersLoaded + "/" + a0.buffersTotal);
    }
    check("music phase is menu (still on title)", a0.musicPhase === "menu", a0.musicPhase);
    if (!blockAudio) {
      check("menu music gain rose", (a0.trackGains.menu || 0) > 0.3, a0.trackGains.menu);
    } else {
      check("menu music gain stays null/0 (blocked, no buffer)", !a0.trackGains.menu, a0.trackGains.menu);
    }
    return out;
  }, blockAudio));

  // ---- start a run: menu -> play music crossfade ----
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 700)); // let the crossfade + per-frame music poll settle

  pushChecks(await page.evaluate((blockAudio) => {
    const A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const a = A.audioState();
    check("state is playing", window.__PP__.state === "playing", window.__PP__.state);
    check("music phase switched to battle1 (tier 0)", a.musicPhase === "battle1", a.musicPhase);
    if (!blockAudio) {
      check("battle1 music gain rose", (a.trackGains.battle1 || 0) > 0.3, a.trackGains.battle1);
      check("menu music gain faded down", (a.trackGains.menu || 0) < 0.3, a.trackGains.menu);
    } else {
      check("battle1 music gain stays null/0 (blocked)", !a.trackGains.battle1, a.trackGains.battle1);
    }
    return out;
  }, blockAudio));

  // ---- core gameplay beats, each checked via its sfxPlays counter ----
  pushChecks(await page.evaluate(async (blockAudio) => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    function delta(before, after, key) { return after[key] - before[key]; }
    // orb pickups from the background wave/spawn system can trigger a genuine level-up mid-test
    // (update() pauses everything, incl. any in-flight pumpkin lob, while state !== "playing") —
    // that's real game behavior, not a bug, so waits poll and auto-dismiss it via the real Skip
    // button rather than block forever.
    async function pumpAndWait(totalMs) {
      const step = 100;
      for (let waited = 0; waited < totalMs; waited += step) {
        if (P.state === "levelup") { const b = document.getElementById("skipBtn"); if (b) b.click(); }
        await sleep(step);
      }
    }

    // --- weapon fire: corn (starting weapon), pumpkin, cats, fork, bolt ---
    P.player.position.set(0, 0, 0);
    P.spawnEnemy("rat", {});
    const e = P.enemies[P.enemies.length - 1];
    e.mesh.position.set(2, 0, 0);
    let before = Object.assign({}, A.audioState().sfxPlays);
    P.fireWeapon(P.weaponById("corn"));
    let after = A.audioState().sfxPlays;
    if (!blockAudio) check("corn fire sample ticked", delta(before, after, "cornFire") > 0, before.cornFire + "->" + after.cornFire);
    else check("corn fire sample stays 0 (blocked)", after.cornFire === 0, after.cornFire);

    // timer:999 keeps weaponsUpdate()'s own per-frame auto-fire (it runs every rAF regardless
    // of our manual test calls, since these weapons are now genuinely in P.weapons) from firing
    // independently and consuming/killing the test targets out from under the explicit calls below.
    for (const wid of ["pumpkin", "cats", "fork", "bolt"]) {
      P.weapons.push({ id: wid, dmgMul: 1, rateMul: 1, multishot: 1, pierce: 0, count: 2, blastMul: 1, spread: 1, evolved: false, timer: 999 });
    }
    P.enemies.length = 0;
    for (let i = 0; i < 3; i++) { P.spawnEnemy("rat", {}); P.enemies[P.enemies.length - 1].mesh.position.set(1 + i, 0, 1); }

    before = Object.assign({}, A.audioState().sfxPlays);
    P.fireWeapon(P.weaponById("cats"));
    P.fireWeapon(P.weaponById("fork"));
    P.fireWeapon(P.weaponById("bolt"));
    after = A.audioState().sfxPlays;
    if (!blockAudio) {
      check("cat pounce sample ticked", delta(before, after, "catPounce") > 0, before.catPounce + "->" + after.catPounce);
      check("fork throw sample ticked", delta(before, after, "forkThrow") > 0, before.forkThrow + "->" + after.forkThrow);
      check("bolt zap sample ticked", delta(before, after, "boltZap") > 0, before.boltZap + "->" + after.boltZap);
    } else {
      check("cat/fork/bolt sample counters stay 0 (blocked)", after.catPounce === 0 && after.forkThrow === 0 && after.boltZap === 0, JSON.stringify(after));
    }

    // pumpkin resolves its sound on impact (a timed lob), not on launch — fire then wait.
    // Use a FRESH high-hp target: the cats/fork/bolt volley above can one-shot the low-hp
    // rats it shared a target pool with, and toughestEnemy() returns null with no enemies left.
    P.enemies.length = 0;
    P.spawnEnemy("turtle", {});
    P.enemies[P.enemies.length - 1].mesh.position.set(2, 0, 2);
    before = Object.assign({}, A.audioState().sfxPlays);
    P.fireWeapon(P.weaponById("pumpkin"));
    await pumpAndWait(1800);
    after = A.audioState().sfxPlays;
    if (!blockAudio) check("pumpkin blast sample ticked after lob resolves", delta(before, after, "pumpkinBlast") > 0, before.pumpkinBlast + "->" + after.pumpkinBlast);
    else check("pumpkin blast sample stays 0 (blocked)", after.pumpkinBlast === 0, after.pumpkinBlast);

    // --- enemy death: varmint pop + elite pop ---
    before = Object.assign({}, A.audioState().sfxPlays);
    P.enemies.length = 0;
    P.spawnEnemy("rat", {});
    const r1 = P.enemies[P.enemies.length - 1];
    P.damageEnemy(r1, 9999, new THREE.Vector3(1,0,0));
    P.spawnEnemy("rat", { elite: true });
    const r2 = P.enemies[P.enemies.length - 1];
    r2.elite = true;
    P.damageEnemy(r2, 9999, new THREE.Vector3(1,0,0));
    after = A.audioState().sfxPlays;
    if (!blockAudio) {
      check("varmint pop sample ticked", delta(before, after, "varmintPop") > 0, before.varmintPop + "->" + after.varmintPop);
      check("elite pop sample ticked", delta(before, after, "elitePop") > 0, before.elitePop + "->" + after.elitePop);
    } else {
      check("death sample counters stay 0 (blocked)", after.varmintPop === 0 && after.elitePop === 0, JSON.stringify(after));
    }

    // --- boss spawn + boss death ---
    before = Object.assign({}, A.audioState().sfxPlays);
    P.spawnBoss();
    after = A.audioState().sfxPlays;
    if (!blockAudio) check("boss roar sample ticked on spawn", delta(before, after, "bossRoar") > 0, before.bossRoar + "->" + after.bossRoar);
    else check("boss roar sample stays 0 (blocked)", after.bossRoar === 0, after.bossRoar);

    before = Object.assign({}, A.audioState().sfxPlays);
    P.damageEnemy(P.boss, 999999, new THREE.Vector3(1,0,0));
    after = A.audioState().sfxPlays;
    if (!blockAudio) check("boss death sample ticked", delta(before, after, "bossDeath") > 0, before.bossDeath + "->" + after.bossDeath);
    else check("boss death sample stays 0 (blocked)", after.bossDeath === 0, after.bossDeath);

    // --- pickups: coin / milk / magnet / boom ---
    before = Object.assign({}, A.audioState().sfxPlays);
    P.applyPickup({ type: "coin" });
    P.applyPickup({ type: "milk" });
    P.applyPickup({ type: "magnet" });
    P.applyPickup({ type: "boom" });
    after = A.audioState().sfxPlays;
    if (!blockAudio) {
      check("coin pickup sample ticked", delta(before, after, "coinPickup") > 0, before.coinPickup + "->" + after.coinPickup);
      check("milk pickup sample ticked", delta(before, after, "milkPickup") > 0, before.milkPickup + "->" + after.milkPickup);
      check("magnet pickup sample ticked", delta(before, after, "magnetPickup") > 0, before.magnetPickup + "->" + after.magnetPickup);
      check("boom pickup sample ticked", delta(before, after, "boomPickup") > 0, before.boomPickup + "->" + after.boomPickup);
    } else {
      check("pickup sample counters stay 0 (blocked)", after.coinPickup === 0 && after.milkPickup === 0 && after.magnetPickup === 0 && after.boomPickup === 0, JSON.stringify(after));
    }

    // --- level up ding (openLevelUp) ---
    before = Object.assign({}, A.audioState().sfxPlays);
    P.openLevelUp();
    after = A.audioState().sfxPlays;
    if (!blockAudio) check("levelup sample ticked", delta(before, after, "levelup") > 0, before.levelup + "->" + after.levelup);
    else check("levelup sample stays 0 (blocked)", after.levelup === 0, after.levelup);
    document.getElementById("skipBtn").click(); // return to playing

    return out;
  }, blockAudio));

  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 }).catch(() => {});

  // ---- INTENSITY MUSIC: tier bands, boss override + anti-thrash dwell, endless, THE COMBINE ----
  // Drives __PP__.elapsed / spawnBoss / spawnFinalBoss / endlessMode and reads musicPhase +
  // per-track gains. Leaves the world dirty; the game-over section's startGame() fully resets it.
  pushChecks(await page.evaluate(async (blockAudio) => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
    // keep the lone chef alive across long waits: recenter + clear the field each tick
    async function safeWait(ms) { for (let w = 0; w < ms; w += 150) { P.enemies.length = 0; if (P.player) P.player.position.set(0, 0, 0); await sleep(150); } }
    const phase = () => A.audioState().musicPhase;
    const gains = () => A.audioState().trackGains;
    // one track's gain high, every OTHER created track's gain low (a completed crossfade)
    function onlyUp(hot) {
      const g = gains();
      if ((g[hot] || 0) <= 0.3) return false;
      for (const k of Object.keys(g)) if (k !== hot && (g[k] || 0) > 0.3) return false;
      return true;
    }
    if (P.state !== "playing") P.startGame();
    P.player.position.set(0, 0, 0);
    // flush any residual boss-music dwell left by the gameplay-beats boss kill above
    for (let w = 0; w < 8000 && phase() === "boss"; w += 150) { P.enemies.length = 0; P.player.position.set(0, 0, 0); await sleep(150); }

    // --- tier bands: battle1 (tier<=2) / battle2 (3-5) / battle3 (>=6) ---
    P.elapsed = 0; await sleep(850);
    check("tier 0 -> musicPhase battle1", phase() === "battle1", phase());
    if (!blockAudio) check("battle1 gain hot, others faded", onlyUp("battle1"), JSON.stringify(gains()));
    else check("battle1 gain null (blocked, graceful)", gains().battle1 === null, JSON.stringify(gains()));

    P.elapsed = 300; await sleep(850);
    check("tier 3 -> musicPhase battle2", phase() === "battle2", phase());
    if (!blockAudio) check("battle2 gain hot, others faded", onlyUp("battle2"), JSON.stringify(gains()));

    P.elapsed = 600; await sleep(850);
    check("tier 6 -> musicPhase battle3", phase() === "battle3", phase());
    if (!blockAudio) check("battle3 gain hot, others faded", onlyUp("battle3"), JSON.stringify(gains()));

    // --- boss override: crossfades in over the tier track ---
    P.enemies.length = 0;
    P.spawnBoss();
    await sleep(850);
    check("boss active -> musicPhase boss (overrides tier)", phase() === "boss", phase());
    if (!blockAudio) check("boss gain hot, battle3 faded", onlyUp("boss"), JSON.stringify(gains()));

    // --- boss death: anti-thrash dwell holds boss music, then returns to the tier track ---
    P.damageEnemy(P.boss, 1e9, new THREE.Vector3(1, 0, 0));
    await sleep(250);
    check("just after boss death -> still boss (dwell hold)", phase() === "boss", phase());
    await safeWait(7000); // > BOSS_MIN_DWELL(6) + tail
    check("after dwell -> back to correct tier track battle3", phase() === "battle3", phase());
    if (!blockAudio) check("battle3 gain hot again after boss, boss faded", onlyUp("battle3"), JSON.stringify(gains()));

    // --- endless forces battle3 even at a low tier ---
    P.endlessMode = true; P.elapsed = 100; await sleep(850);
    check("endless (tier 1) -> musicPhase battle3", phase() === "battle3", phase());
    P.endlessMode = false;

    // --- THE COMBINE (final boss) -> boss music ---
    P.enemies.length = 0;
    P.spawnFinalBoss();
    await sleep(350);
    check("THE COMBINE active -> musicPhase boss", phase() === "boss", phase());
    if (blockAudio) {
      const g = gains();
      check("all 4 new tracks silent under blocked (graceful)",
        g.battle1 === null && g.battle2 === null && g.battle3 === null && g.boss === null, JSON.stringify(g));
    }
    return out;
  }, blockAudio));

  // --- game over: victory + defeat, then back to menu music ---
  pushChecks(await page.evaluate(async (blockAudio) => {
    const P = window.__PP__, A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }

    let before = Object.assign({}, A.audioState().sfxPlays);
    P.startGame();
    P.gameOver(true);
    let after = A.audioState().sfxPlays;
    if (!blockAudio) check("victory sample ticked", after.victory > before.victory, before.victory + "->" + after.victory);
    else check("victory sample stays 0 (blocked)", after.victory === 0, after.victory);
    check("state is over after victory", P.state === "over", P.state);

    P.startGame();
    before = Object.assign({}, A.audioState().sfxPlays);
    P.gameOver(false);
    after = A.audioState().sfxPlays;
    if (!blockAudio) check("defeat sample ticked", after.defeat > before.defeat, before.defeat + "->" + after.defeat);
    else check("defeat sample stays 0 (blocked)", after.defeat === 0, after.defeat);
    check("state is over after defeat", P.state === "over", P.state);

    return out;
  }, blockAudio));

  // back on the title/over screen — music should crossfade back to menu (polled per-frame)
  await new Promise((r) => setTimeout(r, 700));
  pushChecks(await page.evaluate((blockAudio) => {
    const A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const a = A.audioState();
    check("music phase back to menu after game over", a.musicPhase === "menu", a.musicPhase);
    if (!blockAudio) check("menu music gain rose again", (a.trackGains.menu || 0) > 0.3, a.trackGains.menu);
    return out;
  }, blockAudio));

  // --- 🔊 mute / 🎵 music toggle, real button clicks ---
  pushChecks(await page.evaluate(() => {
    const A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }

    document.getElementById("muteBtn").click();
    let a = A.audioState();
    check("mute button zeroes masterGain", a.masterGainV === 0, a.masterGainV);
    check("mute persists to localStorage", localStorage.getItem("pp_muted") === "1", localStorage.getItem("pp_muted"));
    document.getElementById("muteBtn").click();
    a = A.audioState();
    check("mute button restores masterGain", a.masterGainV === 1, a.masterGainV);

    document.getElementById("musicBtn").click();
    a = A.audioState();
    check("music toggle zeroes musicBusV", a.musicBusV === 0, a.musicBusV);
    check("music toggle persists to localStorage", localStorage.getItem("pp_music_off") === "1", localStorage.getItem("pp_music_off"));
    document.getElementById("musicBtn").click();
    a = A.audioState();
    check("music toggle restores musicBusV", a.musicBusV > 0.3, a.musicBusV);

    return out;
  }));

  // --- UI click delegated listener (real DOM click on the Start Game button) ---
  pushChecks(await page.evaluate(async (blockAudio) => {
    const A = window.__PASTURE_AUDIO__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const before = A.audioState().sfxPlays.uiClick;
    document.getElementById("startBtn").click();
    await new Promise((r) => setTimeout(r, 50));
    const after = A.audioState().sfxPlays.uiClick;
    if (!blockAudio) check("ui click sample ticked on Start Game button", after > before, before + "->" + after);
    else check("ui click sample stays 0 (blocked)", after === 0, after);
    return out;
  }, blockAudio));

  // core loop still fully playable check: boot succeeded, canvas has pixels, 0 pageerrors
  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return !!c && c.width > 0 && c.height > 0;
  });
  checks.push({ name: "game canvas rendered", pass: canvasOk, detail: canvasOk });

  await page.close();
  return { checks, errors };
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
    args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
  });

  let allOk = true;
  const results = {};
  try {
    for (const pass of [
      { blockAudio: true, label: "BLOCKED (assets/audio/pasture aborted)" },
      { blockAudio: false, label: "SAMPLES (real files served)" }
    ]) {
      const r = await runPass(browser, pass);
      results[pass.label] = r;
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
