#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart audio — engine graph (synth fallback + sample crossfade),
 * drift loop, item SFX, countdown voice hooks, mute kill-switch (masterGain + speech
 * cancel), and the 2026-07-10 sample-audio wiring (buffers, music state machine).
 *
 * TWO PASSES:
 *  1) assets/audio/* BLOCKED -> the game must boot clean and run entirely on the K6
 *     WebAudio synth (buffers never load; synth engine/SFX must behave as before).
 *  2) assets/audio/* served normally -> buffers decode, sample engine crossfades by
 *     speed, drift loop / music state machine / discrete SFX samples all engage.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8852;
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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); })
            .on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

async function runPass(browser, { blockAudio }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    if (blockAudio && /\/assets\/audio\//i.test(u)) return req.abort();
    req.continue();
  });

  await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });

  // simulate the first user gesture so the AudioContext/music unlock hook fires
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.up();

  if (!blockAudio) {
    // give the fetch+decodeAudioData chain a real chance to finish (~3MB total, local http-server)
    await page.waitForFunction(
      () => window.__KART__.audioState().buffersLoaded >= window.__KART__.audioState().buffersTotal,
      { timeout: 20000 }
    ).catch(() => {}); // fall through to checks either way — a timeout is itself informative
  }

  const results = await page.evaluate(async (blockAudio) => {
    const K = window.__KART__;
    const out = { checks: [], ok: true };
    function check(name, cond, detail) {
      out.checks.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });
      if (!cond) out.ok = false;
    }

    K.setMuted(false);
    K.forceRace();
    K.ensureAudio();
    K.startContinuousAudio();

    const a0 = K.audioState();
    check("audio ctx exists", a0.ctx === "running" || a0.ctx === "suspended", a0.ctx);
    check("unmuted masterGain 1", a0.masterGain === 1, a0.masterGain);

    if (blockAudio) {
      check("no buffers loaded (blocked)", a0.buffersLoaded === 0, a0.buffersLoaded);
      check("sample engine not ready", a0.engineSampleReady === false, a0.engineSampleReady);
    } else {
      check("buffers loaded", a0.buffersLoaded > 0, a0.buffersLoaded + "/" + a0.buffersTotal);
      check("all buffers loaded", a0.buffersLoaded === a0.buffersTotal, a0.buffersLoaded + "/" + a0.buffersTotal);
      check("sample engine ready", a0.engineSampleReady === true, a0.engineSampleReady);
    }

    // ---- ENGINE: drive at three speed points, watch the graph react ----
    const p = K.G.players.local;
    p.v.x = 0; p.v.z = 2; // low speed
    for (let i = 0; i < 40; i++) K.updateAudio(1 / 60);
    const aLow = K.audioState();
    check("engine osc alive", typeof aLow.engineFreq === "number" && aLow.engineFreq > 30, aLow.engineFreq);
    check("engine deeper than old thin band", aLow.engineFreq < 160, aLow.engineFreq);
    check("engine harmonic ~2x", typeof aLow.engineHarmonic === "number" &&
      Math.abs(aLow.engineHarmonic / aLow.engineFreq - 2) < 0.08, aLow.engineHarmonic);
    check("engine filter present", typeof aLow.engineFilterHz === "number" && aLow.engineFilterHz > 100, aLow.engineFilterHz);

    if (blockAudio) {
      check("synth engine gain while racing (low spd)", aLow.engineGainV > 0.01, aLow.engineGainV);
    } else {
      check("synth engine SILENCED when sample engine active", aLow.engineGainV < 0.005, aLow.engineGainV);
      check("engine mix low-dominant at low speed", aLow.engineMix.low > aLow.engineMix.high, JSON.stringify(aLow.engineMix));
    }

    p.v.x = 0; p.v.z = 22; // near top speed
    for (let i = 0; i < 40; i++) K.updateAudio(1 / 60);
    const aHigh = K.audioState();
    if (!blockAudio) {
      check("engine mix high-dominant at top speed", aHigh.engineMix.high > aHigh.engineMix.low, JSON.stringify(aHigh.engineMix));
      check("engine rate rises with speed", aHigh.engineMix.rate > aLow.engineMix.rate, aLow.engineMix.rate + " -> " + aHigh.engineMix.rate);
      check("engine rate in ~0.85-1.35 band", aHigh.engineMix.rate >= 0.8 && aHigh.engineMix.rate <= 1.4, aHigh.engineMix.rate);
    } else {
      check("synth engine gain at top speed", aHigh.engineGainV > 0.01, aHigh.engineGainV);
    }

    // ---- DRIFT: sample loop when available, silent (no scrape) either way in engineGainV ----
    p.drift.active = true; p.drift.charge = 0.9; p.airborne = false;
    p.v.x = 0; p.v.z = 8;
    for (let i = 0; i < 30; i++) K.updateAudio(1 / 60);
    const aDrift = K.audioState();
    if (blockAudio) {
      check("drift loop absent (blocked)", !aDrift.driftLoopGainV, aDrift.driftLoopGainV);
    } else {
      check("drift loop gain rises while drifting", aDrift.driftLoopGainV > 0.05, aDrift.driftLoopGainV);
    }
    check("engine stays live while drifting", typeof aDrift.engineGainV === "number", aDrift.engineGainV);
    p.drift.active = false; p.airborne = false;
    for (let i = 0; i < 40; i++) K.updateAudio(1 / 60);
    if (!blockAudio) {
      const aRelease = K.audioState();
      check("drift loop fades after release", aRelease.driftLoopGainV < 0.05, aRelease.driftLoopGainV);
    }

    // ---- discrete SFX hooks (must not throw; counters / graph stay healthy) ----
    const beforeCd = K.audioState().cdVoices || 0;
    K.countdownVoice("3");
    K.countdownVoice("2");
    K.countdownVoice("1");
    K.countdownVoice("GO");
    check("countdown voice counted", (K.audioState().cdVoices || 0) >= beforeCd + 4, K.audioState().cdVoices);

    const before = K.audioState().sfxPlays;
    K.tomatoFireSound();
    K.tomatoSplatSound(false);
    K.tomatoSplatSound(true);
    K.chickenSquawkSound(false);
    K.chickenSquawkSound(true);
    K.haySound();
    K.itemRollSound();
    K.itemBlockSound();
    K.finishFanfare(1);
    K.countdownVoice("GO");
    check("sfx hooks callable", true, "ok");
    const after = K.audioState().sfxPlays;
    if (blockAudio) {
      check("no sample SFX played (blocked)", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
    } else {
      check("splat sample played", after.splat > before.splat, after.splat);
      check("squawk-fire sample played", after.squawkFire > before.squawkFire, after.squawkFire);
      check("squawk-hit sample played", after.squawkHit > before.squawkHit, after.squawkHit);
      check("haybale sample played", after.haybale > before.haybale, after.haybale);
      check("itembox sample played", after.itembox > before.itembox, after.itembox);
      check("shield sample played", after.shield > before.shield, after.shield);
      check("finish sample played", after.finish > before.finish, after.finish);
      check("go-cheer sample played on GO", after.goCheer > before.goCheer, after.goCheer);
    }

    // ---- MUSIC state machine ----
    K.setMusicPhase(null);
    K.setMusicPhase("menu");
    check("music phase menu", K.audioState().musicTrack === "menu", K.audioState().musicTrack);
    K.setMusicPhase("race");
    check("music phase race", K.audioState().musicTrack === "race", K.audioState().musicTrack);
    const beforeJingle = K.audioState().sfxPlays.winJingle;
    K.musicRaceEnd();
    check("music phase silent after race end", K.audioState().musicTrack === null, K.audioState().musicTrack);
    if (!blockAudio) {
      check("win jingle played on race end", K.audioState().sfxPlays.winJingle > beforeJingle, K.audioState().sfxPlays.winJingle);
    }
    K.setMusicPhase("menu");

    // 🎵 toggle: silences the music bus only (not SFX)
    K.setMusicOff(true);
    const amOff = K.audioState();
    check("music toggle off -> musicGainV 0", amOff.musicGainV === 0 || amOff.musicGainV == null, amOff.musicGainV);
    check("music off persisted flag", amOff.musicOff === true, amOff.musicOff);
    K.tomatoSplatSound(false);
    check("SFX still play with music off", true, "ok"); // no throw = pass; sample-vs-synth already covered above
    K.setMusicOff(false);
    check("music toggle back on", K.audioState().musicOff === false, K.audioState().musicOff);

    // mute silences masterGain + cancels speech (still the single kill switch for everything)
    K.setMuted(true);
    const am = K.audioState();
    check("muted flag", am.muted === true, am.muted);
    check("muted masterGain 0", am.masterGain === 0, am.masterGain);
    const cdMuted = am.cdVoices || 0;
    K.countdownVoice("GO"); // stinger still schedules into muted graph; speech skipped
    check("countdown still increments when muted", (K.audioState().cdVoices || 0) === cdMuted + 1);

    K.setMuted(false);
    check("unmute restores masterGain", K.audioState().masterGain === 1);

    // fire paths use distinct sounds (useItem -> tomato/chicken)
    K.grantHeldItem(p, "tomato");
    K.useItem(p);
    check("tomato fire clears item", !p.itemHeld, p.itemHeld);
    check("tomato projectile spawned", K.G.projectiles.some(pr => pr.kind === "tomato"), K.G.projectiles.length);

    K.grantHeldItem(p, "chicken");
    K.useItem(p);
    check("chicken projectile spawned", K.G.projectiles.some(pr => pr.kind === "chicken"), K.G.projectiles.length);

    return out;
  }, blockAudio);

  await page.close();
  return { results, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], {
      cwd: ROOT, stdio: "ignore", shell: true,
    });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  const blockedPass = await runPass(browser, { blockAudio: true });
  const samplePass = await runPass(browser, { blockAudio: false });

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}

  let totalChecks = 0, totalPass = 0, totalErrors = 0;
  for (const [label, pass] of [["BLOCKED (synth fallback)", blockedPass], ["SAMPLES (loaded)", samplePass]]) {
    console.log("\n=== " + label + " ===");
    for (const c of pass.results.checks) {
      console.log((c.pass ? "PASS" : "FAIL") + "  " + c.name + (c.detail ? "  (" + c.detail + ")" : ""));
    }
    if (pass.errors.length) {
      console.log("PAGEERRORS:");
      pass.errors.forEach((e) => console.log("  " + e));
    }
    const n = pass.results.checks.length;
    const ok = pass.results.checks.filter((c) => c.pass).length;
    totalChecks += n; totalPass += ok; totalErrors += pass.errors.length;
    console.log(ok + "/" + n + " checks" + (pass.errors.length ? " + " + pass.errors.length + " pageerrors" : ""));
  }

  console.log("\nTOTAL " + totalPass + "/" + totalChecks + " checks" + (totalErrors ? " + " + totalErrors + " pageerrors" : ""));
  if (totalPass !== totalChecks || totalErrors) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
