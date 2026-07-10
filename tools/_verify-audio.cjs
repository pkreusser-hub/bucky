#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart audio redesign — engine graph, drift loop, item SFX,
 * countdown voice hooks, mute kill-switch (masterGain + speech cancel).
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
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });

  await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });

  const results = await page.evaluate(async () => {
    const K = window.__KART__;
    const out = { checks: [], ok: true };
    function check(name, cond, detail) {
      out.checks.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) });
      if (!cond) out.ok = false;
    }

    // unmute for graph checks; mute tested separately
    K.setMuted(false);
    K.forceRace();
    K.ensureAudio();
    K.startContinuousAudio();

    // drive a bit so updateAudio raises engine RPM
    const p = K.G.players.local;
    p.v.x = 0; p.v.z = 22;
    for (let i = 0; i < 30; i++) K.updateAudio(1 / 60);

    const a0 = K.audioState();
    check("audio ctx exists", a0.ctx === "running" || a0.ctx === "suspended", a0.ctx);
    check("engine osc alive", typeof a0.engineFreq === "number" && a0.engineFreq > 30, a0.engineFreq);
    check("engine deeper than old thin band", a0.engineFreq < 160, a0.engineFreq);
    check("engine harmonic ~2x", typeof a0.engineHarmonic === "number" &&
      Math.abs(a0.engineHarmonic / a0.engineFreq - 2) < 0.08, a0.engineHarmonic);
    check("engine filter present", typeof a0.engineFilterHz === "number" && a0.engineFilterHz > 100, a0.engineFilterHz);
    check("engine gain while racing", typeof a0.engineGainV === "number" && a0.engineGainV > 0.01, a0.engineGainV);
    check("unmuted masterGain 1", a0.masterGain === 1, a0.masterGain);

    // drift scrape REMOVED 2026-07-09 (user request) — drifting must run clean with no scrape node
    p.drift.active = true; p.drift.charge = 0.9; p.airborne = false;
    for (let i = 0; i < 20; i++) K.updateAudio(1 / 60);
    const aDrift = K.audioState();
    check("drift scrape removed (no driftGainV)", aDrift.driftGainV === undefined, aDrift.driftGainV);
    check("engine stays live while drifting", typeof aDrift.engineGainV === "number" && aDrift.engineGainV > 0.01, aDrift.engineGainV);
    p.drift.active = false;
    for (let i = 0; i < 25; i++) K.updateAudio(1 / 60);

    // discrete SFX hooks (must not throw; counters / graph stay healthy)
    const beforeCd = K.audioState().cdVoices || 0;
    K.countdownVoice("3");
    K.countdownVoice("2");
    K.countdownVoice("1");
    K.countdownVoice("GO");
    check("countdown voice counted", (K.audioState().cdVoices || 0) >= beforeCd + 4, K.audioState().cdVoices);

    K.tomatoFireSound();
    K.tomatoSplatSound(false);
    K.tomatoSplatSound(true);
    K.chickenSquawkSound(false);
    K.chickenSquawkSound(true);
    check("sfx hooks callable", true, "ok");

    // mute silences masterGain + cancels speech
    K.setMuted(true);
    const am = K.audioState();
    check("muted flag", am.muted === true, am.muted);
    check("muted masterGain 0", am.masterGain === 0, am.masterGain);
    const cdMuted = am.cdVoices || 0;
    K.countdownVoice("GO"); // stinger still schedules into muted graph; speech skipped
    check("countdown still increments when muted", (K.audioState().cdVoices || 0) === cdMuted + 1);

    K.setMuted(false);
    check("unmute restores masterGain", K.audioState().masterGain === 1);

    // fire paths use distinct sounds (useItem → tomato/chicken)
    K.grantHeldItem(p, "tomato");
    K.useItem(p);
    check("tomato fire clears item", !p.itemHeld, p.itemHeld);
    check("tomato projectile spawned", K.G.projectiles.some(pr => pr.kind === "tomato"), K.G.projectiles.length);

    K.grantHeldItem(p, "chicken");
    K.useItem(p);
    check("chicken projectile spawned", K.G.projectiles.some(pr => pr.kind === "chicken"), K.G.projectiles.length);

    return out;
  });

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}

  for (const c of results.checks) {
    console.log((c.pass ? "PASS" : "FAIL") + "  " + c.name + (c.detail ? "  (" + c.detail + ")" : ""));
  }
  if (errors.length) {
    console.log("PAGEERRORS:");
    errors.forEach((e) => console.log("  " + e));
  }
  const n = results.checks.length;
  const pass = results.checks.filter((c) => c.pass).length;
  console.log("\n" + pass + "/" + n + " checks" + (errors.length ? " + " + errors.length + " pageerrors" : ""));
  if (!results.ok || errors.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
