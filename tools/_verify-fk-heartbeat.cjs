#!/usr/bin/env node
"use strict";
/**
 * Farm Kart MP host — hidden-tab heartbeat sub-steps the sim (2026-10-12 review fix).
 * A hidden host tab is throttled to ~1 Hz; the heartbeat used to hand that whole ~1s dt to
 * stepKart for every bot in ONE step (the rAF path clamps to 0.05). Here: a solo race is flipped
 * into "MP host" (net.mp/isHost — guests/Playroom not needed: the heartbeat only steps the host's
 * own world, and publishing no-ops without a Playroom player), document.hidden is faked, the main
 * thread is stalled 1.2s, and the next heartbeat must cover ≥0.9s in steps of ≤0.05s while the
 * bots keep racing.
 */
const path = require("path"), net = require("net"), http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");
const ROOT = path.resolve(__dirname, ".."), PORT = 8964, BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const check = (c, m, d) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m + (d !== undefined ? "  -> " + JSON.stringify(d) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isOpen = (port) => new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" });
  s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(800, () => { s.destroy(); res(false); }); });
async function waitServer(port, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await isOpen(port)) { try { await new Promise((r, j) => http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (x) => { x.resume(); r(); }).on("error", j)); return; } catch (_) {} } await sleep(200); } throw new Error("server timeout"); }

(async () => {
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1", "-s"], { cwd: ROOT, stdio: "ignore", shell: true, detached: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 600 });
    await page.setRequestInterception(true);
    page.on("request", (r) => (/playroom|googleapis|firestore|firebase|gstatic/i.test(r.url()) ? r.abort() : r.continue()));
    const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(BASE + "/farmkart.html?track=amen-farms", { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => window.__KART__ && window.__KART__.G.phase === "racing", { timeout: 60000 });
    const before = await page.evaluate(() => {
      const K = window.__KART__; window.__net.mp = true; window.__net.isHost = true;
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      const bots = Object.values(K.G.players).filter((p) => p.isBot);
      return { bots: bots.length, prog: bots.map((p) => p.progressS) };
    });
    check(before.bots > 0, "race has bots to step", before.bots);
    await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 1200) {} });   // stall ~1.2s
    await page.waitForFunction(() => (window.__net._hbLog || []).some((h) => h.dt >= 0.9), { timeout: 5000 }).catch(() => {});
    const log = await page.evaluate(() => window.__net._hbLog || []);
    const big = log.find((h) => h.dt >= 0.9);
    check(!!big, "the heartbeat after a ~1.2s stall covers ≥0.9s of sim", log);
    check(log.length > 0 && log.every((h) => h.maxStep <= 0.05 + 1e-9), "…and every heartbeat steps the sim at most 0.05s at a time (the rAF clamp)", log);
    await sleep(800);
    const after = await page.evaluate(() => Object.values(window.__KART__.G.players).filter((p) => p.isBot).map((p) => p.progressS));
    const moved = after.filter((v, i) => Number.isFinite(v) && v !== before.prog[i]).length;
    check(moved === before.bots, "every bot kept racing while the host tab was hidden", { moved, of: before.bots });
    check(errors.length === 0, "0 pageerrors", errors);
  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (e) {} }
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
