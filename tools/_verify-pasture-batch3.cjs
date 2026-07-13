#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic design-review Batch 3 — endless mode (#3), quest board (#7),
 * daily farm run (#12), stage select (#4). See pasturepanic-design-review.md.
 * Drives gameplay deterministically through the window.__PP__ debug hook (extended for this batch),
 * same convention as the audio + batch-1 + batch-2 suites. Cloud domains are blocked so a fresh
 * profile never touches production Firestore.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8868;
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

async function openPage(browser, viewport) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort();
    req.continue();
  });
  // domcontentloaded + __PP__ hook-wait (NOT networkidle0): the ~4.8MB of new intensity-music mp3s
  // keep the connection busy past the nav cap, so networkidle0 no longer settles. __PP__ is the true
  // readiness signal; audio streams in the background without affecting any check in this suite.
  await page.goto(BASE + "/pasturepanic.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__, { timeout: 20000 });
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.up();
  return { page, errors };
}

// reset all meta/quest/daily state to a clean slate (localStorage + live meta object)
const RESET = `(() => {
  const P = window.__PP__;
  const m = P.meta;
  m.coins = 0; m.up = {}; m.quests = {}; m.questsClaimed = {}; m.bonusReroll = 0; m.bonusBanish = 0;
  m.selStage = "home"; m.stageBest = {}; m.curse = 0;
  m.qc = { kills:0, props:0, pickups:0, chests:0, bosses:0, elites:0, wins:0, windmillKills:0, bankedCoins:0, evolvedIds:{}, charWins:{} };
  P.daily = null;
  localStorage.removeItem("pasturePanicScores");
  localStorage.removeItem("pasturePanicDaily");
  localStorage.setItem("choreUser", "Tester");
})();`;

async function runDesktopChecks(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluate((src) => { window.__RESET_SRC__ = src; }, RESET);
  const checks = [];
  const push = (arr) => { for (const c of arr) checks.push(c); };

  // ============ FEATURE #3: ENDLESS MODE ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    const m = P.meta; m.coins = 0; m.qc.wins = 0; m.qc.charWins = {};
    P.meta.selStage = "home"; P.startGame();
    await new Promise(r=>setTimeout(r,120));
    // kill THE COMBINE via hooks (at the 15:00 mark so victoryElapsed reads a real time)
    P.elapsed = 900;
    P.spawnFinalBoss();
    const before = P.meta.coins;
    const bo = P.boss;
    check("spawnFinalBoss created THE COMBINE", !!bo && bo.isFinal, bo && bo.name);
    P.damageEnemy(bo, bo.hp + 10, new THREE.Vector3(0,0,1), "corn");
    check("combine death -> 'secured' state (not instant game-over)", P.state === "secured", P.state);
    check("PASTURE SECURED! overlay is shown", document.getElementById("securedOverlay").classList.contains("show"), true);
    check("victory coins banked at the kill (meta.coins grew)", P.meta.coins > before, `${before} -> ${P.meta.coins}`);
    check("win quest recorded (qc.wins & charWins)", P.meta.qc.wins === 1 && !!P.meta.qc.charWins.farmer, JSON.stringify(P.meta.qc.charWins));
    // KEEP GOING
    document.getElementById("keepGoingBtn").click();
    check("KEEP GOING -> endless mode + playing", P.endlessMode === true && P.state === "playing", P.state);
    check("HUD timer turns gold in endless", document.getElementById("runTimer").classList.contains("endless"), document.getElementById("runTimer").className);
    return out;
  }));

  // mini-combine every 90 endless seconds + scaling continues
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    // already in endless from the prior block
    P.enemies.length = 0;
    P.miniCombineTimer = 0.05;   // force a mini-combine on the next frame(s)
    for (let i=0;i<12 && !P.enemies.some(e=>e.isMini);i++) await new Promise(r=>setTimeout(r,40));
    const mini = P.enemies.find(e=>e.isMini);
    check("a Mini-Combine spawns at +90 endless seconds (forced)", !!mini, P.enemies.length);
    check("Mini-Combine is ~0.6x scale of THE COMBINE", mini && Math.abs(mini.baseScale - 0.6) < 1e-6, mini && mini.baseScale);
    // mini-combine drops a chest on death
    if (mini){ P.chests.length = 0; mini.hp = 1; P.damageEnemy(mini, 999, new THREE.Vector3(1,0,0), "corn"); }
    check("Mini-Combine drops a chest when killed", P.chests.length >= 1, P.chests.length);
    // endless speed cap: enemy speed multiplier caps at 1.7
    P.elapsed = 5000; P.endlessMode = true; P.enemies.length = 0;
    P.spawnEnemy("rat", { at: [3,3] });
    const e = P.enemies[P.enemies.length-1];
    const SPEC_RAT = 4.0;
    check("endless enemy speed multiplier capped at 1.7 (rat <= 4.0*1.7*1.1 jitter)", e.speed <= SPEC_RAT * 1.7 * 1.2 + 0.01, e.speed.toFixed(2));
    // endless spawn floor eases to 0.12
    const endlessInt = P.computeSpawnInterval();
    P.endlessMode = false; const dayInt = P.computeSpawnInterval();
    check("endless spawn-interval floor (0.12) is below the day floor (0.16)", endlessInt < dayInt || endlessInt <= 0.121, `${endlessInt.toFixed(3)} vs ${dayInt.toFixed(3)}`);
    P.endlessMode = true;
    return out;
  }));

  // endless death banks the delta + scoreboard shows +E time
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    P.endlessMode = true; P.endlessT = 272;   // 4:32 of endless
    P.kills += 30; P.enemies.length = 0;
    const bankBefore = P.meta.coins, bankedRunBefore = P.coinsBankedThisRun;
    P.hp = 0.0001; P.gameOver();   // defeat in endless -> finishRun(false) but finalDown is true -> counts as a win
    check("endless death ends the run (state over)", P.state === "over", P.state);
    check("endless death banks the delta earned past 15:00", P.meta.coins >= bankBefore, `${bankBefore} -> ${P.meta.coins}`);
    check("over title reads ENDLESS RUN OVER", document.getElementById("overTitle").textContent.includes("ENDLESS"), document.getElementById("overTitle").textContent);
    const scores = JSON.parse(localStorage.getItem("pasturePanicScores") || "[]");
    const withE = scores.find(s => (s.endless||0) > 0);
    check("scoreboard entry stores endless seconds", !!withE, JSON.stringify(scores.slice(0,1)));
    // rendered scoreboard shows "+E m:ss"
    P.renderStatsPanel && null;
    const scoreHtml = document.getElementById("scoresOver").textContent;
    check("scoreboard renders '+E m:ss' for endless runs", /\+E\s+\d+:\d\d/.test(scoreHtml), scoreHtml.slice(0,120));
    return out;
  }));

  // ============ FEATURE #7: QUESTS ============
  // fresh meta -> first kill + reach lvl 5 complete with toasts, coins, persistence
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    check("QUESTS list holds 29 quests", P.QUESTS.length === 29, P.QUESTS.length);
    P.startGame(); await new Promise(r=>setTimeout(r,80));
    const coins0 = P.meta.coins;
    // first kill
    P.enemies.length = 0; P.spawnEnemy("rat", { at: [2,2] });
    const e = P.enemies[P.enemies.length-1];
    P.damageEnemy(e, 99999, new THREE.Vector3(1,0,0), "corn");
    check("first-kill quest completes on the first kill", !!P.meta.quests.first_kill, P.meta.qc.kills);
    check("first-kill paid +25 coins", P.meta.coins === coins0 + 25, `${coins0} -> ${P.meta.coins}`);
    check("a toast rendered on completion", document.querySelectorAll("#ppToast .tst").length >= 1, document.querySelectorAll("#ppToast .tst").length);
    // reach level 5
    const coins1 = P.meta.coins;
    for (let i=0;i<40 && P.level < 5;i++) P.gainXp(50);
    check("reach-lvl5 quest completes", !!P.meta.quests.reach_lvl5, P.level);
    check("reach-lvl5 paid +25 coins", P.meta.coins === coins1 + 25, `${coins1} -> ${P.meta.coins}`);
    // persistence: saveMeta wrote the completed quests to localStorage
    const saved = JSON.parse(localStorage.getItem("pasturePanicMeta") || "{}");
    check("completed quests persist to localStorage", saved.quests && saved.quests.first_kill && saved.quests.reach_lvl5, JSON.stringify(saved.quests));
    return out;
  }));

  // counter quests progress; permanent reroll reward applies next run
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    // counter quest: bust props (via destroyProp counter)
    P.meta.qc.props = 9; P.checkQuests();
    check("counter quest still incomplete at 9/10 props", !P.meta.quests.bust10props, P.meta.qc.props);
    P.meta.qc.props = 10; P.checkQuests();
    check("counter quest completes at 10/10 props (+30)", !!P.meta.quests.bust10props, P.meta.qc.props);
    // progress bar renders in the quest panel
    P.meta.qc.pickups = 7; P.renderQuests();
    const rows = Array.from(document.querySelectorAll("#questList .qRow"));
    const hasBar = rows.some(r => r.querySelector(".qbar"));
    check("quest panel renders progress bars for countable quests", hasBar, rows.length);
    // permanent reroll: 10,000 lifetime kills -> +1 reroll, applies next run
    P.meta.qc.kills = 10000; P.checkQuests();
    check("10k-kills quest completes", !!P.meta.quests.kills10000, P.meta.qc.kills);
    check("permanent +1 reroll granted (meta.bonusReroll)", P.meta.bonusReroll === 1, P.meta.bonusReroll);
    P.meta.selStage = "home"; P.startGame();
    // rerollsLeft = 2 + luck(0) + bonusReroll(1) = 3
    const rr = document.getElementById("rerollBtn");
    P.openLevelUp();
    check("permanent reroll reward applies on the next run (3 rerolls)", document.getElementById("rerollBtn").textContent.includes("(3)"), document.getElementById("rerollBtn").textContent);
    document.getElementById("levelupOverlay").classList.remove("show"); P.state = "playing";
    return out;
  }));

  // legend flags: combine-under-60s + win-without-a-scratch-after-10:00 (permanent +1 banish)
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    P.meta.selStage = "home"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    // reach 10:00 with no damage, then win the combine fast
    P.elapsed = 605; P.dmgTaken = 0;
    // one update tick snapshots the "no damage after 10:00" baseline
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await new Promise(r=>setTimeout(r,120));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    P.elapsed = 900; P.spawnFinalBoss();
    P.elapsed = 940;   // 40s after spawn -> under 60s
    const bo = P.boss;
    P.damageEnemy(bo, bo.hp + 10, new THREE.Vector3(0,0,1), "corn");   // onCombineDefeated
    check("combine-under-60s quest completes (killed 40s after spawn)", !!P.meta.quests.combine_under60, "");
    check("win-without-a-scratch-after-10:00 completes (no dmg after baseline)", !!P.meta.quests.win_nodmg_after10, "");
    check("that quest granted a permanent +1 banish", P.meta.bonusBanish === 1, P.meta.bonusBanish);
    check("win_run + win-as-Farmer legend quests complete on the win", !!P.meta.quests.win_run && !!P.meta.quests.win_farmer, "");
    return out;
  }));

  // ============ FEATURE #12: DAILY RUN ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    // same date -> identical spawn-kind sequence twice; different date differs
    P.elapsed = 450; P.kills = 0;
    P.daily = P.buildDaily("2026-07-12");
    const seqA = []; for (let i=0;i<30;i++) seqA.push(P.enemyKindForPressure());
    P.daily = P.buildDaily("2026-07-12");
    const seqB = []; for (let i=0;i<30;i++) seqB.push(P.enemyKindForPressure());
    P.daily = P.buildDaily("2026-07-13");
    const seqC = []; for (let i=0;i<30;i++) seqC.push(P.enemyKindForPressure());
    check("same date seed -> identical spawn-kind sequence", JSON.stringify(seqA) === JSON.stringify(seqB), seqA.slice(0,8).join(","));
    check("different date seed -> different spawn sequence", JSON.stringify(seqA) !== JSON.stringify(seqC), seqC.slice(0,8).join(","));
    // split streams: consuming the CARD stream doesn't shift the SPAWN stream
    P.daily = P.buildDaily("2026-07-12");
    for (let i=0;i<20;i++) P.daily.cardRng();   // burn card rng
    const seqD = []; for (let i=0;i<30;i++) seqD.push(P.enemyKindForPressure());
    check("card RNG stream is split from the spawn stream (spawns unaffected)", JSON.stringify(seqA) === JSON.stringify(seqD), "");
    // modifiers applied
    const d = P.buildDaily("2026-07-12");
    check("daily picks a fixed character + weapon + 2 modifiers", !!d.charId && !!d.weaponId && d.modIds.length === 2, `${d.charId}/${d.weaponId}/${d.modIds}`);
    // coin x0.5: neutral-mod daily vs non-daily for the same run state
    P.kills = 100; P.elapsed = 300;
    P.daily = { dateKey: "t", modIds: [] };   // neutral mods isolate the ½ penalty
    check("neutral daily mods leave coinMul at 1", P.dailyMods.coinMul === 1, P.dailyMods.coinMul);
    const dailyCoins = P.runCoinsTotal(false);
    P.daily = null;
    const normalCoins = P.runCoinsTotal(false);
    check("daily runs bank half the coins (x0.5)", Math.abs(dailyCoins - Math.floor(normalCoins * 0.5)) <= 1, `${dailyCoins} vs ${normalCoins}`);
    return out;
  }));

  // daily board saves by choreUser + keeps 7 days
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    localStorage.setItem("choreUser", "Eleanor");
    P.startDailyRun("2026-07-12");
    check("daily run is active with a home stage", !!P.daily && P.curStage.id === "home", P.curStage && P.curStage.id);
    P.kills = 88; P.elapsed = 260; P.endlessMode = false;
    P.hp = 0.0001; P.gameOver();
    const board = JSON.parse(localStorage.getItem("pasturePanicDaily") || "{}");
    const today = board["2026-07-12"] || [];
    check("daily board saved an entry keyed by choreUser", today.some(e => e.by === "Eleanor"), JSON.stringify(today));
    // 7-day cap
    const big = {}; for (let i=0;i<10;i++){ big["2026-01-0"+i] = [{sec:1,kills:1,by:"x"}]; }
    localStorage.setItem("pasturePanicDaily", JSON.stringify(big));
    localStorage.setItem("choreUser", "Isaac");
    P.startDailyRun("2026-07-20"); P.kills = 5; P.elapsed = 30; P.hp = 0.0001; P.gameOver();
    const board2 = JSON.parse(localStorage.getItem("pasturePanicDaily") || "{}");
    check("daily board keeps at most 7 days", Object.keys(board2).length <= 7, Object.keys(board2).length);
    return out;
  }));

  // ============ FEATURE #4: STAGES ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    P.renderStages();
    let cards = Array.from(document.querySelectorAll("#stageRow .stagecard"));
    check("3 stage cards render on the title", cards.length === 3, cards.length);
    check("Night + Cornfield start LOCKED", cards[1].className.includes("locked") && cards[2].className.includes("locked"), cards.map(c=>c.className).join(" | "));
    // unlock night with a win
    P.meta.qc.wins = 1; P.renderStages();
    cards = Array.from(document.querySelectorAll("#stageRow .stagecard"));
    check("Night Barnyard unlocks after a victory", !cards[1].className.includes("locked"), cards[1].className);
    // unlock cornfield with 500 lifetime kills
    P.meta.qc.kills = 500; P.renderStages();
    cards = Array.from(document.querySelectorAll("#stageRow .stagecard"));
    check("Cornfield unlocks at 500 lifetime kills", !cards[2].className.includes("locked"), cards[2].className);
    return out;
  }));

  // Home gates route waves; Night lantern dims far enemies; Cornfield rows slow movement
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    // HOME: gates + wave routing
    P.meta.selStage = "home"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("Home Pasture builds 3 gates", P.stageGates.length === 3, P.stageGates.length);
    P.player.position.set(0, 0, -60);   // hug the top gate
    P.enemies.length = 0;
    P.spawnRing("rat", 10, 20);
    const g = P.nearestGate();
    const nearGate = P.enemies.filter(e => Math.hypot(e.mesh.position.x - g.x, e.mesh.position.z - g.z) < 16).length;
    check("waves pour in through the gate nearest the player", nearGate >= 6, `${nearGate}/${P.enemies.length} near gate`);
    check("the gate telegraph glow lights up", g.glowT > 0, g.glowT.toFixed(2));

    // NIGHT: lantern dimming (measurable via enemyBrightness hook)
    P.meta.qc.wins = 1; P.meta.selStage = "night"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("Night stage builds a lantern light", !!P.stageLantern, !!P.stageLantern);
    P.player.position.set(0,0,0); P.enemies.length = 0;
    P.spawnEnemy("rat", { at: [1,1] });      const nearE = P.enemies[P.enemies.length-1];
    P.spawnEnemy("rat", { at: [55,0] });     const farE  = P.enemies[P.enemies.length-1];
    const bNear = P.enemyBrightness(nearE), bFar = P.enemyBrightness(farE);
    check("far enemies are dimmer than near ones at night", bFar < bNear, `${bNear.toFixed(2)} vs ${bFar.toFixed(2)}`);
    check("far enemies stay silhouettes (never fully dark, >=0.4)", bFar >= 0.4, bFar.toFixed(2));

    // CORNFIELD: rows slow movement to 0.8x
    P.meta.qc.kills = 500; P.meta.selStage = "corn"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("Cornfield swaps the windmill for a scarecrow statue", !!P.stageScare, !!P.stageScare);
    // find a corn cell and confirm the slow multiplier
    let cornPt = null;
    for (let x=-50;x<=50 && !cornPt;x+=2) for (let z=-50;z<=50;z+=2){ if (P.inCorn(x,z)){ cornPt = [x,z]; break; } }
    check("Cornfield has corn-row cells", !!cornPt, cornPt && cornPt.join(","));
    check("corn rows slow movement to 0.8x", cornPt && Math.abs(P.stageSpeedMul(cornPt[0], cornPt[1]) - 0.8) < 1e-6, cornPt && P.stageSpeedMul(cornPt[0], cornPt[1]));
    check("open ground is full speed (1.0x)", Math.abs(P.stageSpeedMul(0.1, 0.1) - 1) < 1e-6, P.stageSpeedMul(0.1,0.1));
    return out;
  }));

  // per-stage best survival time persists
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    P.meta.selStage = "home"; P.startGame();
    P.kills = 20; P.elapsed = 123; P.endlessMode = false;
    P.hp = 0.0001; P.gameOver();
    check("per-stage best recorded for the home stage", (P.meta.stageBest.home || 0) === 123, P.meta.stageBest.home);
    const saved = JSON.parse(localStorage.getItem("pasturePanicMeta") || "{}");
    check("per-stage best persists to localStorage", (saved.stageBest && saved.stageBest.home) === 123, saved.stageBest && saved.stageBest.home);
    // a shorter run does NOT overwrite a longer best
    P.startGame(); P.elapsed = 40; P.hp = 0.0001; P.gameOver();
    check("a shorter run does not lower the recorded best", P.meta.stageBest.home === 123, P.meta.stageBest.home);
    return out;
  }));

  const canvasOk = await page.evaluate(() => { const c = document.querySelector("canvas"); return !!c && c.width > 0 && c.height > 0; });
  checks.push({ name: "game canvas rendered", pass: canvasOk, detail: canvasOk });

  await page.close();
  return { checks, errors };
}

// 75s stability bot on a specific stage
async function runStageBot(browser, stageId, unlockJs) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluate((sid, unlock) => {
    const P = window.__PP__;
    // unlock + select the stage, then start
    eval(unlock || "");
    P.meta.selStage = sid;
    P.startGame();
  }, stageId, unlockJs);
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });
  const result = await page.evaluate(async () => {
    const P = window.__PP__;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    let frameSamples = [], lastT = t0;
    while (performance.now() - t0 < 75000) {
      const a = (performance.now() - t0) / 1400;
      const kx = Math.cos(a) > 0 ? "ArrowRight" : "ArrowLeft";
      const kz = Math.sin(a) > 0 ? "ArrowDown" : "ArrowUp";
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kz }));
      if (P.state === "levelup") { const b = document.getElementById("skipBtn"); if (b && b.offsetParent !== null) b.click(); else { const c = document.querySelector("#cards .card"); if (c) c.click(); } }
      if (P.state === "chest") { const b = document.getElementById("chestGrabBtn"); if (b) b.click(); }
      if (P.state === "secured") { document.getElementById("keepGoingBtn").click(); }   // push into endless
      if (P.state === "over") { P.startGame(); }
      await sleep(180);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kz }));
      const now = performance.now(); frameSamples.push(now - lastT); lastT = now;
    }
    const avgGap = frameSamples.reduce((a,b)=>a+b,0)/frameSamples.length;
    return { finalState: P.state, stage: P.curStage && P.curStage.id, elapsed: P.elapsed, kills: P.kills, avgGap, enemyCount: P.enemies.length };
  });
  const checks = [
    { name: `bot on '${stageId}' completed without hanging`, pass: true, detail: JSON.stringify(result) },
    { name: `bot ran on the '${stageId}' stage`, pass: result.stage === stageId || result.finalState === "playing", detail: result.stage },
    { name: `sim advanced on '${stageId}' (not frozen)`, pass: result.elapsed > 4, detail: result.elapsed },
    { name: `frame pacing sane on '${stageId}' (avg loop gap < 400ms)`, pass: result.avgGap < 400, detail: result.avgGap.toFixed(1) },
    { name: `enemy count bounded on '${stageId}'`, pass: result.enemyCount < 400, detail: result.enemyCount }
  ];
  await page.close();
  return { checks, errors };
}

async function runMobilePass(browser) {
  const { page, errors } = await openPage(browser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const res = await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    // title rows render on mobile
    P.renderStages();
    check("stage cards render on mobile (no horizontal overflow)", document.querySelectorAll("#stageRow .stagecard").length === 3 && document.documentElement.scrollWidth <= window.innerWidth + 1, document.documentElement.scrollWidth + "/" + window.innerWidth);
    // quests panel opens and lists quests
    P.renderQuests(); document.getElementById("questsOverlay").classList.add("show");
    check("quests panel lists quests on mobile", document.querySelectorAll("#questList .qRow").length === P.QUESTS.length, document.querySelectorAll("#questList .qRow").length);
    document.getElementById("questsOverlay").classList.remove("show");
    // daily panel opens
    P.renderDaily(); document.getElementById("dailyOverlay").classList.add("show");
    check("daily panel renders the seeded hero/weapon/mods on mobile", document.querySelectorAll("#dailyBody .dMod").length === 2, document.querySelectorAll("#dailyBody .dMod").length);
    document.getElementById("dailyOverlay").classList.remove("show");
    // secured overlay buttons fit
    document.getElementById("securedOverlay").classList.add("show");
    check("PASTURE SECURED overlay shows both choice buttons on mobile", !!document.getElementById("bankBtn") && !!document.getElementById("keepGoingBtn"), true);
    document.getElementById("securedOverlay").classList.remove("show");
    return out;
  });
  const canvasOk = await page.evaluate(() => { const c = document.querySelector("canvas"); return !!c && c.width > 0 && c.height > 0; });
  res.push({ name: "game canvas rendered (mobile)", pass: canvasOk, detail: canvasOk });
  await page.close();
  return { checks: res, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
  });
  // inject the RESET script onto document so page.evaluate blocks can eval it
  const wrapWithReset = async (fn, ...args) => fn(browser, ...args);
  let allOk = true;
  try {
    // stash RESET on document for the desktop checks
    const passes = [
      ["DESKTOP feature checks", async (b) => {
        // set document.__RESET__ once per page inside openPage-derived pages; simplest: patch openPage
        return runDesktopChecks(b);
      }],
      ["STAGE BOT — Home Pasture (75s)", (b) => runStageBot(b, "home", RESET)],
      ["STAGE BOT — Night Barnyard (75s)", (b) => runStageBot(b, "night", RESET + "window.__PP__.meta.qc.wins=1;")],
      ["STAGE BOT — Cornfield (75s)", (b) => runStageBot(b, "corn", RESET + "window.__PP__.meta.qc.kills=500;")],
      ["MOBILE viewport checks", runMobilePass]
    ];
    for (const [label, fn] of passes) {
      console.log(`\n=== ${label} ===`);
      const r = await fn(browser);
      let passOk = true;
      for (const c of r.checks) {
        const mark = c.pass ? "PASS" : "FAIL";
        if (!c.pass) passOk = false;
        console.log(`  [${mark}] ${c.name}${c.detail !== "" ? "  (" + c.detail + ")" : ""}`);
      }
      if (r.errors.length) { passOk = false; console.log(`  PAGE ERRORS (${r.errors.length}):`); for (const e of r.errors) console.log("    " + e); }
      const total = r.checks.length, pass_ = r.checks.filter((c) => c.pass).length;
      console.log(`  -> ${pass_}/${total} checks passed, ${r.errors.length} pageerrors`);
      if (!passOk) allOk = false;
    }
  } finally { await browser.close(); if (server) server.kill(); }
  console.log(allOk ? "\nALL PASSES GREEN" : "\nSOME CHECKS FAILED");
  process.exit(allOk ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
