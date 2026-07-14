#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic design-review Batch 4a — character actives (#5), new characters
 * (#14), new bosses + elite affixes (#8), traveling merchant (#13), Little Sprout mode (#15).
 * (Co-op #1 is a SEPARATE run and is deliberately untouched here.)
 * Drives gameplay deterministically through window.__PP__ (extended for this batch), same convention
 * as the audio + batch-1/2/3 suites. Cloud domains are blocked so a fresh profile never touches
 * production Firestore.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8869;
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

const RESET = `(() => {
  const P = window.__PP__;
  const m = P.meta;
  m.coins = 0; m.up = {}; m.quests = {}; m.questsClaimed = {}; m.bonusReroll = 0; m.bonusBanish = 0;
  m.selStage = "home"; m.stageBest = {}; m.curse = 0; m.sprout = false; m.chars = {}; m.selChar = "farmer";
  m.qc = { kills:0, props:0, pickups:0, chests:0, bosses:0, elites:0, wins:0, windmillKills:0, bankedCoins:0, merchantBuys:0, evolvedIds:{}, charWins:{} };
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

  // ============ FEATURE #5: CHARACTER ACTIVE ABILITIES ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    // ability chip HUD element exists + SPACE is not otherwise bound in-game
    check("ability chip element exists in the HUD", !!document.getElementById("abilityChip"), true);

    // --- Farmer WHISTLE: knockback ring + boss takes 30 + non-elite stun ---
    P.selChar = "farmer"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("farmer active is Whistle @20s cd", P.ability && P.ability.id === "whistle" && P.abilityMax === 20, P.ability && P.ability.cd);
    check("ability starts READY (cd 0)", P.abilityCd === 0, P.abilityCd);
    // place two rats close, a boss too
    P.enemies.length = 0;
    const r1 = P.spawnEnemy("rat", { at: [3, 0] });
    P.enemies.length = 1; // keep just the rat for a clean displacement read
    const beforeD = Math.hypot(r1.mesh.position.x - P.player.position.x, r1.mesh.position.z - P.player.position.z);
    P.spawnBoss(); const bo = P.boss; bo.mesh.position.set(4, 0, 0); const bHp = bo.hp;
    P.abilityCd = 0; P.fireAbility();
    const afterD = Math.hypot(r1.mesh.position.x - P.player.position.x, r1.mesh.position.z - P.player.position.z);
    check("whistle knocks a near enemy outward (displacement)", afterD > beforeD + 1, `${beforeD.toFixed(2)} -> ${afterD.toFixed(2)}`);
    check("whistle stuns a non-elite (slowT set)", r1.slowT > 0.3, r1.slowT);
    check("whistle deals 30 to a boss (no displacement)", Math.abs((bHp - bo.hp) - 30) < 0.01, bHp - bo.hp);
    check("whistle puts the ability on cooldown", P.abilityCd > 19, P.abilityCd);

    // --- Bucky RAM DASH: i-frames + 40 contact damage during the dash ---
    P.selChar = "goat"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("bucky active is Ram Dash @12s cd", P.ability && P.ability.id === "ram" && P.abilityMax === 12, P.abilityMax);
    P.enemies.length = 0;
    // face +z and put an enemy along the path
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    await new Promise(r=>setTimeout(r,40));
    const target = P.spawnEnemy("turtle", { at: [P.player.position.x, P.player.position.z + 2.5] });
    const tHp0 = target.hp;
    P.abilityCd = 0; P.fireAbility();
    check("ram dash grants i-frames (invulnT > 0)", P.invulnT > 0, P.invulnT.toFixed(2));
    check("ram dash is active (dashT > 0)", P.dashT > 0, P.dashT.toFixed(2));
    // step a few frames so the dash sweeps the target
    for (let i=0;i<12;i++) await new Promise(r=>setTimeout(r,20));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowDown" }));
    check("ram dash dealt contact damage along its path", target.hp < tHp0, `${tHp0.toFixed(0)} -> ${target.hp.toFixed(0)}`);

    // --- Collie ROUND-UP: vacuum orbs + pull enemies ---
    P.selChar = "collie"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    // CORN WORLD (2026-07-14): the test rat 10u out can sit inside/behind standing corn, where the
    // hard-block + flow-steer counter the round-up pull — fell all corn so the pull is measured clean
    P.clearAllCorn();
    check("collie active is Round-Up @25s cd", P.ability && P.ability.id === "roundup" && P.abilityMax === 25, P.abilityMax);
    P.enemies.length = 0; P.orbs.length = 0;
    P.dropPickup; // noop guard
    P.dropOrb ? P.dropOrb(10, 10, 3) : null;
    // drop an orb via killing an enemy is heavy; use gainable orb through spawn+damage
    const oe = P.spawnEnemy("rat", { at: [10, 10] }); oe.hp = 1; P.damageEnemy(oe, 5, new THREE.Vector3(1,0,0), "corn");
    const anyOrb = P.orbs.length > 0;
    const farE = P.spawnEnemy("rat", { at: [P.player.position.x + 10, P.player.position.z] });
    const eD0 = Math.hypot(farE.mesh.position.x - P.player.position.x, farE.mesh.position.z - P.player.position.z);
    P.abilityCd = 0; P.fireAbility();
    check("round-up vacuums all XP orbs", P.orbs.every(o => o.vac), anyOrb ? "orbs vac'd" : "no orbs (ok)");
    check("round-up is active (roundupT > 0)", P.roundupT > 0, P.roundupT.toFixed(2));
    // sample the MINIMUM distance across the 0.8s pull window — the pull drags the rat to the
    // round-up point and past it, and the collie's own cats knock it back out afterward, so a
    // single post-hoc read is timing-fragile (got flaky under load); min-during-pull is the intent.
    let eDMin = eD0;
    for (let i=0;i<20;i++){ await new Promise(r=>setTimeout(r,20));
      eDMin = Math.min(eDMin, Math.hypot(farE.mesh.position.x - P.player.position.x, farE.mesh.position.z - P.player.position.z)); }
    check("round-up pulls a nearby enemy inward", eDMin < eD0 - 0.5, `${eD0.toFixed(2)} -> min ${eDMin.toFixed(2)}`);

    // --- Strawman DREAD AURA: fear + slow, enemies flee ---
    P.selChar = "straw"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("strawman active is Dread Aura @30s cd", P.ability && P.ability.id === "dread" && P.abilityMax === 30, P.abilityMax);
    P.enemies.length = 0;
    const fe = P.spawnEnemy("rat", { at: [P.player.position.x + 4, P.player.position.z] });
    const fD0 = Math.hypot(fe.mesh.position.x - P.player.position.x, fe.mesh.position.z - P.player.position.z);
    P.abilityCd = 0; P.fireAbility();
    check("dread sets fear on nearby enemies (fearT > 0)", fe.fearT > 0, fe.fearT);
    check("dread applies a 20% slow (slowPct 0.2)", Math.abs(fe.slowPct - 0.2) < 1e-6, fe.slowPct);
    for (let i=0;i<15;i++) await new Promise(r=>setTimeout(r,20));
    const fD1 = Math.hypot(fe.mesh.position.x - P.player.position.x, fe.mesh.position.z - P.player.position.z);
    check("dread makes a feared enemy FLEE (moves away)", fD1 > fD0, `${fD0.toFixed(2)} -> ${fD1.toFixed(2)}`);
    return out;
  }));

  // ============ FEATURE #14: NEW CHARACTERS (Henrietta, Piglet) ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    check("roster now holds 6 characters", P.CHARS.length === 6, P.CHARS.map(c=>c.id).join(","));
    const hen = P.CHARS.find(c=>c.id==="henrietta"), pig = P.CHARS.find(c=>c.id==="piglet");
    check("Henrietta costs 1200, starts Egg Mortar", hen && hen.cost === 1200 && hen.weapon === "egg", hen && hen.cost);
    check("Piglet costs 1500, starts Milk Splash", pig && pig.cost === 1500 && pig.weapon === "milk", pig && pig.cost);

    // UNLOCK flow via a rendered card click (needs coins)
    P.meta.coins = 5000; P.renderChars();
    const cards = document.querySelectorAll("#charRow .charcard");
    check("6 character cards render", cards.length === 6, cards.length);
    // click the Henrietta card (locked -> should buy + select)
    let henIdx = P.CHARS.findIndex(c=>c.id==="henrietta");
    cards[henIdx].click();
    check("clicking Henrietta unlocks + selects her", !!P.meta.chars.henrietta && P.meta.selChar === "henrietta", JSON.stringify(P.meta.chars));

    // Henrietta stats + start weapon
    P.selChar = "henrietta"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("Henrietta starts with Egg Mortar", P.weapons[0].id === "egg", P.weapons[0].id);
    check("Henrietta HP is 90", P.stats.maxhp === 90, P.stats.maxhp);
    check("Henrietta speed +5% (8.4)", Math.abs(P.stats.speed - 8.4) < 0.01, P.stats.speed);
    // egg-lay passive (#14): force the 60s timer to fire, confirm a pickup drops at her feet
    // (dropped AT her feet, so it's collected within a frame or two — measure via qc.pickups)
    P.enemies.length = 0; P.pickups.length = 0; P.meta.qc.pickups = 0;
    P.eggLayTimer = 0.02;
    for (let i=0;i<10 && P.meta.qc.pickups === 0 && P.pickups.length === 0;i++) await new Promise(r=>setTimeout(r,25));
    check("Henrietta lays an egg pickup on her 60s timer", P.meta.qc.pickups >= 1 || P.pickups.length >= 1, `qc ${P.meta.qc.pickups} field ${P.pickups.length}`);
    // fire the Egg Burst active which drops bomblets (also Henrietta-specific)
    P.enemies.length = 0;
    P.abilityCd = 0; const nb0 = P.bomblets.length; P.fireAbility();
    check("Henrietta active Egg Burst drops 5 bomblets", P.bomblets.length - nb0 === 5, P.bomblets.length - nb0);

    // Piglet stats + drop bonus + start weapon
    P.selChar = "piglet"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    check("Piglet starts with Milk Splash", P.weapons[0].id === "milk", P.weapons[0].id);
    check("Piglet HP is 85 (-15%)", P.stats.maxhp === 85, P.stats.maxhp);
    check("Piglet has +40% drop bonus", Math.abs(P.stats.dropBonus - 0.40) < 1e-6, P.stats.dropBonus);
    check("Piglet speed +10% (8.8)", Math.abs(P.stats.speed - 8.8) < 0.01, P.stats.speed);
    // Truffle Snuffle active: 1 guaranteed pickup + heal 10
    P.hp = 20; const pkc0 = P.pickups.length;
    P.abilityCd = 0; P.fireAbility();
    check("Piglet Truffle Snuffle digs up a pickup", P.pickups.length > pkc0, P.pickups.length - pkc0);
    check("Piglet Truffle Snuffle heals 10", P.hp === 30, P.hp);

    // WIN QUESTS for the new characters
    P.meta.qc.charWins.henrietta = true; P.meta.qc.charWins.piglet = true; P.checkQuests();
    check("win_henrietta quest completes", !!P.meta.quests.win_henrietta, true);
    check("win_piglet quest completes", !!P.meta.quests.win_piglet, true);
    return out;
  }));

  // ============ FEATURE #8: NEW BOSSES + ELITE AFFIXES ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    check("boss rotation grows to 5", P.BOSSES.length === 5, P.BOSSES.map(b=>b.kind).join(","));
    check("boss idx 3 is the Crow Matriarch", P.BOSSES[3].kind === "crow" && P.BOSSES[3].ability === "matriarch", P.BOSSES[3].name);
    check("boss idx 4 is the Mole Boss", P.BOSSES[4].kind === "mole" && P.BOSSES[4].ability === "burrow", P.BOSSES[4].name);

    P.selChar = "farmer"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    // walk the rotation to the crow (idx 3) then mole (idx 4)
    let seen = [];
    for (let i=0;i<5;i++){ P.enemies.length=0; P.boss=null; P.spawnBoss(); seen.push(P.boss.kind); }
    check("rotation reaches crow at index 3", seen[3] === "crow", seen.join(","));
    check("rotation reaches mole at index 4", seen[4] === "mole", seen.join(","));

    // --- CROW MATRIARCH: dives + summons ---
    P.enemies.length = 0; P.bossIdx = 3; P.spawnBoss();
    const mat = P.boss;
    check("Matriarch spawned (aerial boss)", mat && mat.ability === "matriarch", mat && mat.name);
    // force a summon
    mat.summonCd = 0.01;
    for (let i=0;i<6;i++) await new Promise(r=>setTimeout(r,25));
    const crows = P.enemies.filter(e => e.kind === "crow" && !e.isBoss).length;
    check("Matriarch summons a ring of crows", crows >= 6, crows);
    // force a dive telegraph->dive
    mat.diveCd = 0.01; mat.mPhase = "circle";
    let sawDive = false;
    for (let i=0;i<40 && !sawDive;i++){ await new Promise(r=>setTimeout(r,25)); if (mat.mPhase === "dive" || mat.mPhase === "telegraph") sawDive = true; }
    check("Matriarch telegraphs + dives", sawDive, mat.mPhase);

    // --- MOLE BOSS: burrow untargetable -> erupt -> surface targetable ---
    P.enemies.length = 0; P.bossIdx = 4; P.spawnBoss();
    const mole = P.boss;
    check("Mole boss spawned", mole && mole.ability === "burrow", mole && mole.name);
    // force into burrow: currently surface, drive its phase timer to 0
    mole.mPhase = "surface"; mole.phaseT = 0.02;
    for (let i=0;i<8 && mole.mPhase !== "burrow";i++) await new Promise(r=>setTimeout(r,25));
    check("Mole burrows and becomes untargetable", mole.mPhase === "burrow" && mole.untargetable === true, mole.mPhase + "/" + mole.untargetable);
    const mHp = mole.hp; P.damageEnemy(mole, 500, new THREE.Vector3(1,0,0), "corn");
    check("weapons cannot hit the Mole while burrowed", mole.hp === mHp, `${mHp.toFixed(0)} -> ${mole.hp.toFixed(0)}`);
    // put the player on top of the mole's erupt point, force rumble->erupt
    mole.phaseT = 0.02; mole.mPhase = "rumble"; mole.eruptX = P.player.position.x; mole.eruptZ = P.player.position.z; mole.rumbleRing = true;
    const hp0 = P.hp; P.invulnT = 0;
    for (let i=0;i<8 && mole.mPhase !== "surface";i++) await new Promise(r=>setTimeout(r,25));
    check("Mole eruption damages the player nearby", P.hp < hp0, `${hp0.toFixed(0)} -> ${P.hp.toFixed(0)}`);
    check("Mole is targetable again after surfacing", mole.mPhase === "surface" && mole.untargetable === false, mole.mPhase + "/" + mole.untargetable);
    const sHp = mole.hp; P.damageEnemy(mole, 50, new THREE.Vector3(1,0,0), "corn");
    check("weapons hit the Mole once surfaced", mole.hp < sHp, `${sHp.toFixed(0)} -> ${mole.hp.toFixed(0)}`);

    // --- ELITE AFFIXES ---
    P.enemies.length = 0; P.elapsed = 300;
    // shielded: 6 hits to crack, then damage lands
    const sh = P.spawnEnemy("rat", { elite: true, affix: "shielded" });
    check("shielded elite starts with a 6-hit husk", sh.shield === 6, sh.shield);
    const shHp = sh.hp;
    for (let i=0;i<6;i++) P.damageEnemy(sh, 5, new THREE.Vector3(1,0,0), "corn");
    check("husk soaks the first 6 hits (no HP lost)", sh.hp === shHp && sh.shield === 0, `hp ${sh.hp.toFixed(0)} shield ${sh.shield}`);
    P.damageEnemy(sh, 5, new THREE.Vector3(1,0,0), "corn");
    check("damage lands after the husk shatters", sh.hp < shHp, `${shHp.toFixed(0)} -> ${sh.hp.toFixed(0)}`);
    // splitting: two minis on death (clear first so we can count the split cleanly)
    P.enemies.length = 0;
    const sp = P.spawnEnemy("rat", { elite: true, affix: "splitting" });
    sp.hp = 1; P.damageEnemy(sp, 50, new THREE.Vector3(1,0,0), "corn");
    const minis = P.enemies.filter(e => !e.elite && e.baseScale === 0.5);
    check("splitting elite spawns 2 half-size minis", minis.length === 2, minis.length);
    // greedy: flees + drops 3x coins + 2 extra pickups
    P.enemies.length = 0; P.pickups.length = 0;
    const gr = P.spawnEnemy("rat", { elite: true, affix: "greedy" });
    check("greedy elite flees the player (flee flag)", gr.flee === true, gr.flee);
    gr.hp = 1; P.damageEnemy(gr, 50, new THREE.Vector3(1,0,0), "corn");
    const coins = P.pickups.filter(p => p.type === "coin").length;
    check("greedy elite drops 3x coins", coins >= 3, coins);
    check("greedy elite drops 2 extra pickups (>=5 total)", P.pickups.length >= 5, P.pickups.length);
    return out;
  }));

  // ============ FEATURE #13: TRAVELING MERCHANT ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    P.selChar = "farmer"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    P.invulnT = 1e9;   // 5:00 swarm pressure in the corn world can kill the farmer mid-walk (state "over" broke the overlay check)
    // spawns at 5:00
    P.elapsed = 300;
    for (let i=0;i<4 && !P.merchant;i++) await new Promise(r=>setTimeout(r,25));
    check("merchant cart spawns at 5:00", !!P.merchant, !!P.merchant);
    // walk into it -> overlay opens
    P.player.position.set(P.merchant.mesh.position.x, 0, P.merchant.mesh.position.z);
    for (let i=0;i<4 && P.state !== "merchant";i++) await new Promise(r=>setTimeout(r,25));
    check("walking up opens the merchant overlay (pauses sim)", P.state === "merchant", P.state);
    check("merchant overlay shows 4 offers", document.querySelectorAll("#merchantOffers .mOffer").length === 4, document.querySelectorAll("#merchantOffers .mOffer").length);

    // broke -> disabled buttons
    P.bonusCoins = 0; P.renderMerchant();
    const disabled = Array.from(document.querySelectorAll("#merchantOffers .mOffer")).filter(b => b.disabled).length;
    check("broke = all offers disabled", disabled === 4, disabled);

    // each purchase deducts + applies
    P.bonusCoins = 200;
    const hp0 = 20; P.hp = hp0;
    P.buyMerchant("heal"); check("heal: coins -15 + HP restored", P.bonusCoins === 185 && P.hp > hp0, `coins ${P.bonusCoins} hp ${P.hp}`);
    const rr0 = P.rerollsLeft; P.buyMerchant("reroll"); check("reroll: coins -20 + rerolls +2", P.bonusCoins === 165 && P.rerollsLeft === rr0 + 2, `coins ${P.bonusCoins} rr ${P.rerollsLeft}`);
    const bb0 = P.banishesLeft; P.buyMerchant("banish"); check("banish: coins -15 + banish +1", P.bonusCoins === 150 && P.banishesLeft === bb0 + 1, `coins ${P.bonusCoins} bn ${P.banishesLeft}`);
    check("buying flags the merchant quest counter", P.meta.qc.merchantBuys >= 3, P.meta.qc.merchantBuys);
    P.checkQuests();
    check("'Buy from the merchant' quest completes", !!P.meta.quests.merchant_buy, true);

    // MYSTERY WEAPON LEVEL can trigger evolution
    // set up a single Corn at level 6 with its partner passive owned (feedbag) so +1 level -> evolve
    P.weaponsArr = [P.newWeapon("corn")];
    const w = P.weaponsArr[0];
    // grant 6 corn upgrades directly via applyUpgrade + the partner passive
    P.applyUpgrade("feedbag", 1);
    for (let i=0;i<6;i++) P.applyUpgrade("corn_damage", 1);   // corn_damage max is 6
    check("corn is at evolve threshold (lvl 6, not yet 7)", P.weaponLevel(w) === 6 && !w.evolved, P.weaponLevel(w));
    P.bonusCoins = 100; P.buyMerchant("mystery");
    check("mystery weapon level pushes corn to evolve", w.evolved === true, w.evolved);

    P.closeMerchant();
    check("leaving the merchant resumes play", P.state === "playing", P.state);
    return out;
  }));

  // ============ FEATURE #15: LITTLE SPROUT MODE ============
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__);
    // toggle button
    P.renderSprout();
    document.getElementById("sproutBtn").click();
    check("Sprout toggle persists to meta", P.meta.sprout === true, P.meta.sprout);
    check("Sprout button reads On", /On/.test(document.getElementById("sproutBtn").textContent), document.getElementById("sproutBtn").textContent);

    // baseline (no sprout) farmer maxhp = 100, magnet = 4
    P.meta.sprout = false; P.selChar = "farmer"; P.startGame(); await new Promise(r=>setTimeout(r,40));
    const baseHp = P.stats.maxhp, baseMag = P.stats.magnet;
    // average many spawns so the per-spawn ±10% random speed jitter doesn't swamp the 0.8 factor
    const avgSpd = () => { let s = 0; P.enemies.length = 0; for (let i=0;i<24;i++){ const e = P.spawnEnemy("rat", { at: [20,20] }); s += e.speed; } P.enemies.length = 0; return s/24; };
    const baseSpd = avgSpd();
    // sprout on
    P.meta.sprout = true; P.startGame(); await new Promise(r=>setTimeout(r,40));
    check("Sprout: +30% max HP", P.stats.maxhp === Math.round(baseHp * 1.3), `${baseHp} -> ${P.stats.maxhp}`);
    check("Sprout: auto-magnet x4", Math.abs(P.stats.magnet - baseMag * 4) < 1e-6, `${baseMag} -> ${P.stats.magnet}`);
    check("Sprout run flag is set", P.sprout === true, P.sprout);
    const sproutSpd = avgSpd();
    check("Sprout: enemies crawl at ~80% speed", sproutSpd < baseSpd * 0.86 && sproutSpd > baseSpd * 0.74, `${baseSpd.toFixed(2)} -> ${sproutSpd.toFixed(2)} (${(sproutSpd/baseSpd).toFixed(3)})`);

    // scoreboard badge
    P.kills = 10; P.elapsed = 66; P.endlessMode = false; P.hp = 0.0001; P.gameOver();
    const scores = JSON.parse(localStorage.getItem("pasturePanicScores") || "[]");
    check("Sprout run recorded with a sprout flag", scores.some(s => s.sprout), JSON.stringify(scores.map(s=>s.sprout)));
    P.renderStages ? null : null;
    // render the over-screen scoreboard and confirm the 🌱 badge text
    const html = document.getElementById("scoresOver").textContent || "";
    check("scoreboard shows the 🌱 badge", html.indexOf("🌱") >= 0, html.slice(0,80));
    return out;
  }));

  // quest count + no pageerrors
  const qn = await page.evaluate(() => window.__PP__.QUESTS.length);
  checks.push({ name: "quest board totals 29", pass: qn === 29, detail: qn });

  await page.close();
  return { checks, errors };
}

// 75s bot with actives auto-firing — no crashes, sim advances, enemies bounded, 0 pageerrors
async function runBotPass(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluate((src) => { eval(src); const P = window.__PP__; P.selChar = "goat"; P.autoAbility = true; P.startGame(); }, RESET);
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });
  const result = await page.evaluate(async () => {
    const P = window.__PP__;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const t0 = performance.now();
    let fireCount = 0, lastCd = 0;
    while (performance.now() - t0 < 75000) {
      const a = (performance.now() - t0) / 1400;
      const kx = Math.cos(a) > 0 ? "ArrowRight" : "ArrowLeft";
      const kz = Math.sin(a) > 0 ? "ArrowDown" : "ArrowUp";
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kz }));
      // count auto-fires (cd jumps back up after hitting 0)
      if (P.abilityCd > lastCd + 1) fireCount++;
      lastCd = P.abilityCd;
      if (P.state === "levelup") { const b = document.getElementById("skipBtn"); if (b && b.offsetParent !== null) b.click(); else { const c = document.querySelector("#cards .card"); if (c) c.click(); } }
      if (P.state === "chest") { const b = document.getElementById("chestGrabBtn"); if (b) b.click(); }
      if (P.state === "merchant") { const b = document.getElementById("merchantLeaveBtn"); if (b) b.click(); }
      if (P.state === "secured") { document.getElementById("keepGoingBtn").click(); }
      if (P.state === "over") { P.startGame(); }
      await sleep(160);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kz }));
    }
    return { finalState: P.state, elapsed: P.elapsed, kills: P.kills, enemyCount: P.enemies.length, fireCount };
  });
  const checks = [
    { name: "75s actives-bot ran without hanging", pass: true, detail: JSON.stringify(result) },
    { name: "sim advanced during the actives-bot", pass: result.elapsed > 4, detail: result.elapsed },
    { name: "abilities auto-fired on cooldown", pass: result.fireCount >= 2, detail: result.fireCount },
    { name: "enemy count stayed bounded", pass: result.enemyCount < 400, detail: result.enemyCount },
  ];
  await page.close();
  return { checks, errors };
}

async function runMobilePass(browser) {
  const { page, errors } = await openPage(browser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const res = await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    eval(window.__RESET_SRC__ = `(() => {
      const m = window.__PP__.meta; m.coins=9999; m.chars={henrietta:true,piglet:true}; m.sprout=false;
    })();`);
    // 6-card roster wraps with no horizontal overflow
    P.renderChars();
    check("6-card roster renders on mobile with no h-overflow",
      document.querySelectorAll("#charRow .charcard").length === 6 && document.documentElement.scrollWidth <= window.innerWidth + 1,
      document.querySelectorAll("#charRow .charcard").length + " / " + document.documentElement.scrollWidth + "<=" + window.innerWidth);
    // ability chip shows in-game and is tappable
    P.selChar = "farmer"; P.startGame(); await new Promise(r=>setTimeout(r,60));
    const chip = document.getElementById("abilityChip");
    check("ability chip visible in-game on mobile", chip && getComputedStyle(chip).display !== "none", chip && getComputedStyle(chip).display);
    // simulate a tap on the chip -> fires
    P.abilityCd = 0;
    chip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    check("tapping the ability chip fires the ability (cd set)", P.abilityCd > 19, P.abilityCd);
    // merchant overlay fits on mobile
    P.bonusCoins = 100; P.spawnMerchant(); P.openMerchant();
    check("merchant overlay opens on mobile with 4 offers + no overflow",
      document.querySelectorAll("#merchantOffers .mOffer").length === 4 && document.documentElement.scrollWidth <= window.innerWidth + 1,
      document.documentElement.scrollWidth + "<=" + window.innerWidth);
    P.closeMerchant();
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
  let allOk = true;
  try {
    const passes = [
      ["DESKTOP — actives / new chars / bosses / affixes / merchant / sprout", runDesktopChecks],
      ["BOT — 75s with actives auto-firing", runBotPass],
      ["MOBILE — roster wrap / ability chip / merchant overlay", runMobilePass],
    ];
    for (const [label, fn] of passes) {
      const r = await fn(browser);
      console.log(`\n=== ${label} ===`);
      let passOk = true;
      for (const c of r.checks) {
        const mark = c.pass ? "PASS" : "FAIL";
        if (!c.pass) passOk = false;
        console.log(`  [${mark}] ${c.name}  (${c.detail})`);
      }
      if (r.errors.length) { passOk = false; console.log("  PAGEERRORS:", r.errors.join(" | ")); }
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
