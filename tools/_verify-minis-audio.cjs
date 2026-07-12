#!/usr/bin/env node
"use strict";
/**
 * Integration smoke test: ElevenLabs-generated SFX/music for the two in-app mini-games
 * inside index.html — Bucky Jump ("game" tab) and Cat Rescue ("catgame" tab).
 *
 * House law: this page can seed PRODUCTION Firestore (herd-duplication incident, twice) —
 * every pass here blocks /googleapis|firestore|firebase|gstatic/ so the app always falls
 * back to the local (offline) backend. Never touches real family data.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8891;
const BASE = `http://127.0.0.1:${PORT}`;
const BLOCK_RE = /googleapis|firestore|firebase|gstatic/i;
const AUDIO_RE = /assets\/audio\/minis\//i;

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
let PASS = 0;
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); PASS++; console.log("  ✓ " + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Seed the family-hub lock + a harmless test identity BEFORE any script runs, and go
// straight into the requested tab via the hash the app already reads at boot.
async function primePage(page, { hash, blockAudio } = {}) {
  const requests = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (BLOCK_RE.test(url)) { req.abort(); return; }
    if (blockAudio && AUDIO_RE.test(url)) { requests.push(url); req.abort(); return; }
    requests.push(url);
    req.continue();
  });
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    localStorage.setItem("choreUser", "TestKid");
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const nonce = Date.now() + "_" + Math.floor(Math.random() * 1e6);
  const url = BASE + "/index.html?n=" + nonce + (hash ? "#" + hash : "");
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  return { requests, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });

  try {
    // ── (a) HUB SAFETY: dashboard boot must never touch audio ──
    console.log("\n[a] hub safety (dashboard)");
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      const { requests, errors } = await primePage(page, { hash: "dashboard" });
      await page.waitForSelector("#progress", { timeout: 15000 });
      await sleep(800);
      const audioReqs = requests.filter((u) => AUDIO_RE.test(u));
      const ctxState = await page.evaluate(() => (window.__MINIS_AUDIO__ ? window.__MINIS_AUDIO__.state : null));
      check(errors.length === 0, "0 pageerrors on dashboard boot (" + errors.join(" | ") + ")");
      check(!!ctxState, "MiniAudio debug hook present");
      check(ctxState.ctxCreated === false, "no AudioContext created on hub boot");
      check(audioReqs.length === 0, "no assets/audio/minis/* fetched on hub boot (" + audioReqs.length + ")");
      // nav tabs switch cleanly — real clicks (index.html's script is type="module", so
      // page.evaluate can't reach its goTo()/currentTab globals; drive the actual DOM).
      const gids = await page.evaluate(() => Array.from(document.querySelectorAll("#bnav .bnav-btn")).map((b) => b.dataset.gid));
      check(gids.length > 0, "bottom nav renders (" + gids.length + " areas: " + gids.join(",") + ")");
      for (const gid of gids) {
        await page.click(`#bnav .bnav-btn[data-gid="${gid}"]`);
        await sleep(150);
      }
      await page.click(`#bnav .bnav-btn[data-gid="home"]`);
      await sleep(150);
      check(errors.length === 0, "0 pageerrors after cycling nav tabs");
      const ctxState2 = await page.evaluate(() => window.__MINIS_AUDIO__.state);
      check(ctxState2.ctxCreated === false, "still no AudioContext after nav cycling (never entered a game tab)");
      await page.close();
    }

    // ── (b) BUCKY JUMP ──
    console.log("\n[b] bucky jump");
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      const { requests, errors } = await primePage(page, { hash: "game" });
      await page.waitForSelector("#gameCanvas", { timeout: 15000 });
      const pre = await page.evaluate(() => window.__MINIS_AUDIO__.state);
      check(pre.ctxCreated === false, "no AudioContext yet (canvas built, no gesture)");
      check(requests.filter((u) => AUDIO_RE.test(u)).length === 0, "no audio fetch yet (canvas built, no gesture)");

      // first gesture: tap the canvas -> unlock (creates ctx) + starts loading buffers,
      // and (state was "ready") starts the run.
      await page.click("#gameCanvas");
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.ctxCreated === true, { timeout: 5000 });
      check(true, "AudioContext created on first gesture");
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.filesFetched >= 15, { timeout: 15000 });
      const loaded = await page.evaluate(() => window.__MINIS_AUDIO__.state.filesFetched);
      check(loaded >= 15, "all 15 manifest files fetched+decoded on first game open (" + loaded + ")");
      await page.waitForFunction(() => window.__MINI_GAMES_TEST__.bj && window.__MINI_GAMES_TEST__.bj.state === "running", { timeout: 5000 });
      // music start is retried once the async buffer decode finishes, so poll rather than
      // sampling the instant the run began (decode can still be in flight at that instant)
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.musicKey === "bjMusic", { timeout: 5000 });
      check(true, "bj-music started once the run began (buffers finished decoding)");

      // one real jump via the game's real input (keyboard Space, matches the game's own listener)
      await page.keyboard.press("Space");
      await sleep(120);
      const afterJump = await page.evaluate(() => window.__MINIS_AUDIO__.state.played);
      check((afterJump.bjJump || 0) >= 1, "bjJump play counter ticked on a real jump input");

      // simple real-input "bot": jump (Space) whenever a ground obstacle is close ahead, so
      // the goat actually clears a few fences (real fence-ticks) before it eventually misses
      // one and the run ends naturally via collision.
      const t0b = Date.now();
      while (Date.now() - t0b < 15000) {
        const bj = await page.evaluate(() => window.__MINI_GAMES_TEST__.bj);
        if (!bj || bj.state !== "running") break;
        const near = bj.obstacles.find((o) => o.type !== "eagle" && o.x > bj.goatX && o.x - bj.goatX < 55);
        if (near && bj.onGround) await page.keyboard.press("Space");
        await sleep(45);
      }
      // let it settle to game-over (collision — the bot isn't perfect, that's the point)
      await page.waitForFunction(() => window.__MINI_GAMES_TEST__.bj && window.__MINI_GAMES_TEST__.bj.state === "over", { timeout: 20000 });
      await sleep(150);
      const end = await page.evaluate(() => window.__MINIS_AUDIO__.state);
      check((end.played.bjStumble || 0) >= 1, "bjStumble played on collision (" + (end.played.bjStumble||0) + ")");
      check((end.played.bjTick || 0) >= 1, "bjTick played for at least one passed obstacle (" + (end.played.bjTick||0) + ")");
      check((end.played.sharedWomp || 0) >= 1, "sharedWomp played on game over");
      check(end.musicKey === null, "music stopped on game over");
      check(end.musicStops >= 1, "musicStops counter ticked");

      // (b2) mute persists
      await page.click("#bjMuteBtn");
      const mutedNow = await page.evaluate(() => localStorage.getItem("bj_muted"));
      check(mutedNow === "1", "bj mute toggled + persisted to localStorage");
      await page.click("#bjMuteBtn");
      const unmutedNow = await page.evaluate(() => localStorage.getItem("bj_muted"));
      check(unmutedNow === "0", "bj mute toggled back off");

      // switch to Home tab -> music (already stopped) stays stopped, and no FURTHER audio fetches happen
      // (real click — the app's script is type="module", page.evaluate can't call goTo() directly)
      const beforeSwitchReqCount = requests.filter((u) => AUDIO_RE.test(u)).length;
      await page.click(`#bnav .bnav-btn[data-gid="home"]`);
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.activeGame === null, { timeout: 3000 }).catch(() => {});
      await sleep(200);
      const afterSwitchReqCount = requests.filter((u) => AUDIO_RE.test(u)).length;
      const finalState = await page.evaluate(() => window.__MINIS_AUDIO__.state);
      check(finalState.musicKey === null, "no music after leaving the tab");
      check(finalState.activeGame === null, "MiniAudio.activeGame cleared after leaving the tab (watchdog)");
      check(afterSwitchReqCount === beforeSwitchReqCount, "no new audio fetches triggered by leaving the tab (" + beforeSwitchReqCount + "->" + afterSwitchReqCount + ")");
      check(errors.length === 0, "0 pageerrors across the whole Bucky Jump pass");
      await page.close();
    }

    // ── (c) CAT RESCUE ──
    console.log("\n[c] cat rescue");
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      const { requests, errors } = await primePage(page, { hash: "catgame" });
      await page.waitForSelector("#catCanvas", { timeout: 15000 });
      const pre = await page.evaluate(() => window.__MINIS_AUDIO__.state);
      check(pre.ctxCreated === false, "no AudioContext yet (canvas built, no gesture)");

      await page.click("#catCanvas");
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.ctxCreated === true, { timeout: 5000 });
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.filesFetched >= 15, { timeout: 15000 });
      check(true, "AudioContext + buffers loaded on first gesture");
      await page.waitForFunction(() => window.__MINI_GAMES_TEST__.cr && window.__MINI_GAMES_TEST__.cr.state === "running", { timeout: 5000 });
      await page.waitForFunction(() => window.__MINIS_AUDIO__.state.musicKey === "crMusic", { timeout: 5000 });
      check(true, "cr-music started once the run began (buffers finished decoding)");

      // A cat is launched on the very first frame (launchTimer starts at 0), which can race
      // the buffer decode still in flight — MiniAudio.play() retries once loading settles
      // (see index.html), so this should land quickly even though it raced the decode.
      await page.waitForFunction(() => {
        const p = window.__MINIS_AUDIO__.state.played;
        return (p.crMeow1 || 0) + (p.crMeow2 || 0) >= 1;
      }, { timeout: 6000 });
      check(true, "a meow played for the first launched cat (via the load-race retry)");

      // simple real-input "bot": nudge the trampoline (arrow keys, the game's own control
      // scheme) to try to line up under a falling cat so bounce/rescue sounds get exercised
      // via genuine play rather than being skipped.
      let sawPop = false, sawChime = false, sawDanger = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 12000) {
        const s = await page.evaluate(() => ({ cr: window.__MINI_GAMES_TEST__.cr, played: window.__MINIS_AUDIO__.state.played }));
        if (!s.cr || s.cr.state !== "running") break;
        sawPop = sawPop || (s.played.crPop || 0) >= 1;
        sawChime = sawChime || (s.played.sharedChime || 0) >= 1;
        sawDanger = sawDanger || (s.played.crDanger || 0) >= 1;
        if (sawPop && sawChime) break;
        // steer toward the nearest falling cat's x
        const falling = s.cr.cats.filter((c) => c.vy >= 0 && c.y < 260);
        const target = falling.length ? falling[0].x : 200;
        if (target < s.cr.cx - 4) { await page.keyboard.down("ArrowLeft"); await sleep(60); await page.keyboard.up("ArrowLeft"); }
        else if (target > s.cr.cx + 4) { await page.keyboard.down("ArrowRight"); await sleep(60); await page.keyboard.up("ArrowRight"); }
        else await sleep(60);
      }
      const midPlay = await page.evaluate(() => window.__MINIS_AUDIO__.state.played);
      check((midPlay.crPop || 0) >= 1 || (midPlay.sharedChime || 0) >= 1, "at least one bounce (crPop) or rescue (sharedChime) landed via real play (pop=" + (midPlay.crPop||0) + " chime=" + (midPlay.sharedChime||0) + ")");

      // let the run finish naturally (5 lives lost) -> game over -> womp or fanfare + music stop
      await page.waitForFunction(() => window.__MINI_GAMES_TEST__.cr && window.__MINI_GAMES_TEST__.cr.state === "over", { timeout: 45000 });
      await sleep(150);
      const end = await page.evaluate(() => window.__MINIS_AUDIO__.state);
      check((end.played.sharedWomp || 0) + (end.played.crFanfare || 0) >= 1, "game-over sound played (womp or fanfare)");
      check(end.musicKey === null, "cr-music stopped on game over");

      // mute persists
      await page.click("#crMuteBtn");
      check((await page.evaluate(() => localStorage.getItem("cr_muted"))) === "1", "cr mute toggled + persisted");
      await page.click("#crMuteBtn");
      check((await page.evaluate(() => localStorage.getItem("cr_muted"))) === "0", "cr mute toggled back off");

      check(errors.length === 0, "0 pageerrors across the whole Cat Rescue pass");
      await page.close();
    }

    // ── (d) BLOCKED pass: audio files aborted -> both games fully playable ──
    console.log("\n[d] blocked-audio degradation");
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      const { errors } = await primePage(page, { hash: "game", blockAudio: true });
      await page.waitForSelector("#gameCanvas", { timeout: 15000 });
      await page.click("#gameCanvas");
      await sleep(300);
      await page.keyboard.press("Space");
      await page.waitForFunction(() => window.__MINI_GAMES_TEST__.bj && window.__MINI_GAMES_TEST__.bj.state === "running", { timeout: 5000 });
      await sleep(600);
      const bjSt = await page.evaluate(() => window.__MINI_GAMES_TEST__.bj);
      check(bjSt && bjSt.state === "running", "Bucky Jump fully playable with audio blocked (state=" + (bjSt && bjSt.state) + ")");
      const bjPlayed = await page.evaluate(() => window.__MINIS_AUDIO__.state.played);
      check(Object.keys(bjPlayed).length === 0, "no sample keys marked played when buffers never decoded");
      await page.close();

      const page2 = await browser.newPage();
      await page2.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
      const { errors: errors2 } = await primePage(page2, { hash: "catgame", blockAudio: true });
      await page2.waitForSelector("#catCanvas", { timeout: 15000 });
      await page2.click("#catCanvas");
      await page2.waitForFunction(() => window.__MINI_GAMES_TEST__.cr && window.__MINI_GAMES_TEST__.cr.state === "running", { timeout: 5000 });
      await sleep(600);
      const crSt = await page2.evaluate(() => window.__MINI_GAMES_TEST__.cr);
      check(crSt && crSt.state === "running", "Cat Rescue fully playable with audio blocked (state=" + (crSt && crSt.state) + ")");
      check(errors.length === 0 && errors2.length === 0, "0 pageerrors in either game with audio blocked (" + errors.concat(errors2).join(" | ") + ")");
      await page2.close();
    }

    console.log(`\n${PASS} checks passed.`);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
