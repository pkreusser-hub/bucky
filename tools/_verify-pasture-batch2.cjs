#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic design-review Batch 2 (passive items + evolution recipes #2,
 * four new weapons + evolutions #6). See pasturepanic-design-review.md.
 * Drives gameplay deterministically through the window.__PP__ debug hook (extended for this batch)
 * — same convention as the batch-1 + audio suites. NOTE: #10 Harvest Blessing was HELD BACK by the
 * user and is intentionally NOT covered here.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8867;
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

// shared helper injected into the page: apply every upgrade line of a weapon to max
const HELPERS = `
  window.__T = {
    maxOutWeapon(id){
      const P = window.__PP__;
      for (const u of P.UPGRADES){ if (u.weapon === id){ for (let i=0;i<u.max;i++) P.applyUpgrade(u.id, 1); } }
    }
  };
`;

async function runDesktopChecks(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluate(HELPERS);
  const checks = [];
  const push = (arr) => { for (const c of arr) checks.push(c); };
  const fresh = async () => {
    await page.evaluate(() => window.__PP__.startGame());
    await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });
  };

  // ============ FEATURE #2: passives — cards, slots, effects ============
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    check("PASSIVES has 7 entries", P.PASSIVES.length === 7, P.PASSIVES.length);
    check("4 passive slots", P.PASSIVE_SLOTS === 4, P.PASSIVE_SLOTS);
    check("CRIT_MULT is 1.5", P.CRIT_MULT === 1.5, P.CRIT_MULT);
    // occupy a slot
    P.applyUpgrade("horseshoe", 1); P.updateHud();
    const slots = document.querySelectorAll("#passiveSlots .pSlot");
    check("passive-slot row renders 4 slots", slots.length === 4, slots.length);
    check("owned passive occupies a slot with its icon", slots[0].textContent.includes("🐴"), slots[0].textContent);
    check("ownedPassiveCount tracks the owned passive", P.ownedPassiveCount() === 1, P.ownedPassiveCount());
    return out;
  }));

  // passive appears as a level-up card (deterministic via the partner-bias path)
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    // corn to lvl 7 with no partner -> the level-up card screen must BIAS in the Feed Bag passive
    for (let i = 0; i < 6; i++) P.applyUpgrade("corn_damage", 1);
    P.applyUpgrade("corn_rate", 1);
    const corn = P.weaponById("corn");
    check("corn at lvl 7 but not evolved (no partner)", corn.evolved !== true, P.weaponLevel(corn));
    P.updateHud();
    const slot = document.querySelectorAll("#weapSlots .wSlot")[0];
    check("weapon chip pulses amber (needpartner class)", slot.className.includes("needpartner"), slot.className);
    check("weapon chip shows a recipe hint badge", !!slot.querySelector(".recipe"), slot.innerHTML.length);
    P.openLevelUp();
    const passiveCards = document.querySelectorAll("#cards .card.passive");
    const offersFeedbag = Array.from(passiveCards).some(c => c.textContent.includes("Feed Bag"));
    check("card bias offers the missing partner (Feed Bag) as a passive card", offersFeedbag, passiveCards.length);
    // acquiring the partner evolves instantly
    P.applyUpgrade("feedbag", 1);
    check("acquiring the partner passive evolves the weapon on the spot", corn.evolved === true, corn.evoName || "");
    return out;
  }));

  // 4-slot cap gates further passives (bias can't offer a 5th distinct passive)
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    for (const id of ["horseshoe", "tinpail", "hourglass", "jelly"]) P.applyUpgrade(id, 1);
    check("four distinct passives fill all slots", P.ownedPassiveCount() === 4, P.ownedPassiveCount());
    // corn to 7 without its partner (Feed Bag) — but all 4 slots are full, so the bias must NOT offer it
    for (let i = 0; i < 7; i++) P.applyUpgrade("corn_damage", 1);
    let sawFeedbag = false;
    for (let k = 0; k < 30; k++){ P.openLevelUp(); if (document.body.innerHTML.includes("Feed Bag") && document.querySelector("#cards .card.passive") && Array.from(document.querySelectorAll("#cards .card.passive")).some(c=>c.textContent.includes("Feed Bag"))) sawFeedbag = true; }
    check("a 5th distinct passive is never offered while all slots are full", sawFeedbag === false, sawFeedbag);
    return out;
  }));

  // ---- passive EFFECTS, each measurable ----
  // Horseshoe: exact contact-damage reduction
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    async function contactHit(armorLevels){
      P.startGame(); P.invulnT = 0;
      for (let i=0;i<armorLevels;i++) P.applyUpgrade("horseshoe", 1);
      P.weaponsArr = [];               // no weapons -> nothing else moves the numbers
      P.player.position.set(0,0,0);
      P.enemies.length = 0;
      P.spawnEnemy("rat", { at: [0, 0] });   // rat dmg 6, right on top of the player
      const before = P.hp;
      await new Promise(r=>setTimeout(r, 300));   // one contact hit (hitCd 0.8)
      return before - P.hp;
    }
    const d0 = await contactHit(0);
    check("no-armor rat contact deals 6", Math.abs(d0 - 6) < 0.01, d0);
    const d2 = await contactHit(2);
    check("Horseshoe x2 reduces 6 -> 2 (−4)", Math.abs(d2 - 2) < 0.01, d2);
    const d3 = await contactHit(3);
    check("Horseshoe x3 (−6) floors at 1, never 0", Math.abs(d3 - 1) < 0.01, d3);
    return out;
  }));

  // Tin Pail: scales sprinkler beam length
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    P.setSoleWeapon("sprinkler");
    await new Promise(r=>setTimeout(r, 120));   // one frame builds the beam
    const before = P.sprinklerBeams[0] ? P.sprinklerBeams[0].core.scale.z : 0;
    P.applyUpgrade("tinpail", 1);   // areaMul 1.12
    await new Promise(r=>setTimeout(r, 120));
    const after = P.sprinklerBeams[0] ? P.sprinklerBeams[0].core.scale.z : 0;
    check("sprinkler beam length grows ~12% with Tin Pail", before > 0 && Math.abs(after/before - 1.12) < 0.01, `${before.toFixed(2)} -> ${after.toFixed(2)}`);
    return out;
  }));

  // Hot Sauce: forced-100% crit deals 1.5x and paints the number orange
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    P.dmgNumEnabled = true;
    P.enemies.length = 0;
    P.spawnEnemy("turtle", { at: [3, 3] });
    const e = P.enemies[P.enemies.length - 1]; e.hp = 100000; e.ampT = 0;
    P.stats.critChance = 1;   // force every hit to crit
    const before = e.hp;
    P.damageEnemy(e, 40, new THREE.Vector3(1,0,0), "corn");
    const dealt = before - e.hp;
    check("forced crit deals 1.5x (40 -> 60)", Math.abs(dealt - 60) < 0.01, dealt);
    await new Promise(r=>setTimeout(r, 350));   // batch window flush
    const crits = Array.from(document.querySelectorAll("#dmgNumLayer .dmgNum")).filter(el => el.style.display === "block" && el.className.includes("crit"));
    check("crit damage number renders orange (.crit)", crits.length > 0, crits.length);
    P.stats.critChance = 0; P.enemies.length = 0;
    return out;
  }));

  // Hourglass: extends turret (Scarecrow) life
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    async function firstTurretLife(withHourglass){
      P.startGame();
      const w = P.setSoleWeapon("scarecrow"); w.deployTimer = 0.02; w.maxOut = 3;
      if (withHourglass) P.applyUpgrade("hourglass", 1);   // durMul 1.15
      // wait for a turret to deploy, then read its remaining life immediately
      for (let i=0;i<40 && P.turrets.length===0;i++) await new Promise(r=>setTimeout(r, 25));
      return P.turrets.length ? P.turrets[0].life : -1;
    }
    const base = await firstTurretLife(false);
    const withHg = await firstTurretLife(true);
    check("scarecrow turret deploys with ~15s life", base > 14 && base <= 15.1, base.toFixed(2));
    check("Hourglass extends turret life ~15% (to ~17.25s)", withHg > 16.5, withHg.toFixed(2));
    P.turrets.length = 0;
    return out;
  }));

  // Feed Bag: widens XP-orb pickup radius
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    P.weaponsArr = [];
    async function orbPulled(withFeedBag){
      P.startGame(); P.weaponsArr = [];
      if (withFeedBag) P.applyUpgrade("feedbag", 1);
      P.player.position.set(0,0,0);
      P.orbs.length = 0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.1,0.1,0.1), new THREE.MeshBasicMaterial());
      m.position.set(P.stats.magnet * 1.15, 0.5, 0);   // just outside base magnet, inside Feed Bag range
      P.orbs.push({ mesh: m, amount: 1, t: 0 });
      const d0 = m.position.x;
      await new Promise(r=>setTimeout(r, 500));
      const orb = P.orbs[0];
      return orb ? d0 - orb.mesh.position.x : d0;   // >0 means it was pulled toward the player (collected orbs leave >0 too)
    }
    const noBag = await orbPulled(false);
    const bag = await orbPulled(true);
    check("without Feed Bag an orb just outside base magnet is NOT pulled", Math.abs(noBag) < 0.3, noBag.toFixed(2));
    check("with Feed Bag the same orb is pulled in", bag > 0.5, bag.toFixed(2));
    P.orbs.length = 0;
    return out;
  }));

  // Royal Jelly: speeds cats
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    const w = P.setSoleWeapon("cats"); w.timer = 999;
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [5, 0] });
    P.cats.length = 0; P.fireWeapon(w);
    const base = P.cats.length ? P.cats[P.cats.length - 1].speed : 0;
    P.applyUpgrade("jelly", 1);   // projMul 1.12
    P.cats.length = 0; P.enemies.length = 0; P.spawnEnemy("turtle", { at: [5, 0] });
    P.fireWeapon(w);
    const boosted = P.cats.length ? P.cats[P.cats.length - 1].speed : 0;
    check("Royal Jelly speeds cats ~12% (13 -> 14.56)", base > 0 && Math.abs(boosted/base - 1.12) < 0.01, `${base.toFixed(2)} -> ${boosted.toFixed(2)}`);
    P.cats.length = 0; P.enemies.length = 0;
    return out;
  }));

  // Lucky Bell: raises pickup drop chance (seeded Math.random)
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    async function dropsWith(bellLevels){
      P.startGame(); P.weaponsArr = [];
      for (let i=0;i<bellLevels;i++) P.applyUpgrade("bell", 1);
      P.pickups.length = 0; P.enemies.length = 0;
      const orig = Math.random;
      Math.random = () => 0.03;   // between base 0.015 and base+bell(0.055)
      for (let i=0;i<8;i++){ P.spawnEnemy("rat", { at: [1+i, 0] }); const e = P.enemies[P.enemies.length-1]; P.damageEnemy(e, 99999, new THREE.Vector3(1,0,0)); }
      Math.random = orig;
      const n = P.pickups.length; P.pickups.length = 0; P.enemies.length = 0;
      return n;
    }
    const noBell = await dropsWith(0);
    const bell = await dropsWith(1);
    check("without Lucky Bell a 0.03 roll drops nothing (< 0.015 base)", noBell === 0, noBell);
    check("with Lucky Bell the same 0.03 roll drops pickups", bell > 0, bell);
    return out;
  }));

  // ---- Chest 35% partner-grant (seeded RNG) ----
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    // corn to lvl 7, no Feed Bag -> neediest weapon
    for (let i=0;i<7;i++) P.applyUpgrade("corn_damage", 1);
    const corn = P.weaponById("corn");
    check("neediestUnevolvedWeapon finds corn", P.neediestUnevolvedWeapon() === corn, !!P.neediestUnevolvedWeapon());
    const orig = Math.random;
    Math.random = () => 0.2;   // < 0.35 -> partner-grant path
    P.chests.length = 0; const g = new THREE.Group();
    P.openChest({ mesh: g });
    Math.random = orig;
    check("chest granted the partner passive (Feed Bag owned)", P.passiveLevel("feedbag") > 0, P.passiveLevel("feedbag"));
    check("granting it evolved the waiting weapon", corn.evolved === true, corn.evolved);
    check("chest title reads 'Just what you needed!'", document.getElementById("chestTitle").textContent.includes("Just what you needed"), document.getElementById("chestTitle").textContent);
    return out;
  }));
  // and the >=0.35 branch keeps the normal epic path
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    for (let i=0;i<7;i++) P.applyUpgrade("corn_damage", 1);
    const orig = Math.random;
    Math.random = () => 0.9;   // >= 0.35 -> normal chest
    P.chests.length = 0;
    P.openChest({ mesh: new THREE.Group() });
    Math.random = orig;
    check("no partner grant on a >=0.35 roll (Feed Bag not owned)", P.passiveLevel("feedbag") === 0, P.passiveLevel("feedbag"));
    check("normal chest title (not the partner one)", !document.getElementById("chestTitle").textContent.includes("Just what you needed"), document.getElementById("chestTitle").textContent);
    return out;
  }));

  // ============ FEATURE #6: the four new weapons ============
  // Egg Mortar: lob -> split into bomblets that bounce; upgrade + evolve
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    const w = P.setSoleWeapon("egg"); w.timer = 999;   // only our explicit fire
    P.player.position.set(0,0,0);
    // (a) DAMAGE: fire onto a dummy and let it land there
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [0, -6] });
    const dummy = P.enemies[P.enemies.length-1]; dummy.hp = 1e9;
    P.eggs.length = 0; P.bomblets.length = 0;
    P.fireWeapon(w);
    check("egg spawns a lobbed shot", P.eggs.length === 1, P.eggs.length);
    await new Promise(r=>setTimeout(r, 700));   // land + blast
    check("egg dealt damage to the dummy", dummy.hp < 1e9, Math.round(1e9 - dummy.hp));
    // (b) SPLIT + BOUNCE: fire again to capture a target, then clear enemies BEFORE it lands so the
    // bomblets don't detonate on the dummy they spawn atop the same frame — they survive and bounce
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [0, -6] });
    P.eggs.length = 0; P.bomblets.length = 0;
    P.fireWeapon(w);
    P.enemies.length = 0;   // clear immediately; the egg still lands at its captured target
    let maxB = 0, minY = 99, rose = false;
    for (let i=0;i<70;i++){
      P.enemies.length = 0;   // keep the field clear so bomblets bounce freely
      await new Promise(r=>setTimeout(r, 20));
      maxB = Math.max(maxB, P.bomblets.length);
      const b = P.bomblets[0];
      if (b){ const y = b.mesh.position.y; if (y < minY) minY = y; else if (minY < 0.3 && y > minY + 0.05) rose = true; }
    }
    check("egg splits into 3 bomblets (base)", maxB >= 3, maxB);
    check("a bomblet bounces (rises again after touching the ground)", rose, `min ${minY.toFixed(2)}`);
    // upgrade + evolve
    check("egg upgrade raises bomblet count", (function(){ const before = w.bomblets; P.applyUpgrade("egg_bomblet", 1); return w.bomblets === before + 1; })(), w.bomblets);
    for (let i=0;i<7;i++) P.applyUpgrade("egg_damage", 1);
    check("egg not evolved at 7 without Tin Pail", w.evolved !== true, P.weaponLevel(w));
    P.applyUpgrade("tinpail", 1);
    check("egg evolves to Rooster's Reveille with Tin Pail", w.evolved && w.stun === true, w.evoName || "");
    P.enemies.length = 0; P.eggs.length = 0; P.bomblets.length = 0;
    return out;
  }));

  // Chicken Flock: pets orbit, dart + return, cap respected; upgrade + evolve
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    const w = P.setSoleWeapon("chicken");
    P.player.position.set(0,0,0);
    await new Promise(r=>setTimeout(r, 150));
    check("2 pet chickens spawn (base)", P.chickens.length === 2, P.chickens.length);
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [4, 0] });
    const dummy = P.enemies[P.enemies.length-1]; dummy.hp = 1e9;
    let sawDart = false, sawReturn = false;
    for (let i=0;i<60;i++){ for (const c of P.chickens){ if (c.state === "dart") sawDart = true; if (c.state === "return") sawReturn = true; } await new Promise(r=>setTimeout(r, 25)); }
    check("a chicken darts out at the enemy", sawDart, sawDart);
    check("a chicken returns after pecking", sawReturn, sawReturn);
    check("chicken dealt peck damage", dummy.hp < 1e9, 1e9 - dummy.hp);
    // upgrade + cap
    P.applyUpgrade("chick_bird", 1); P.applyUpgrade("chick_bird", 1); P.applyUpgrade("chick_bird", 1);  // birds 2+3=5
    for (let i=0;i<7;i++) P.applyUpgrade("chick_damage", 1);
    P.applyUpgrade("feedbag", 1);   // partner -> Fowl Play (+2 birds -> 7)
    check("chicken evolves to Fowl Play with Feed Bag", w.evolved && w.splash === true, w.evoName || "");
    await new Promise(r=>setTimeout(r, 200));
    check("total pet chickens capped at 7", P.chickens.length <= 7, P.chickens.length);
    P.enemies.length = 0;
    return out;
  }));

  // Milk Splash: jar -> slowing/amplifying zone; measure slow + amp; evolve to Butter Churn
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    const w = P.setSoleWeapon("milk"); w.timer = 999;   // only our explicit fire
    P.player.position.set(0,0,0);
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [0, -5] });
    const dummy = P.enemies[P.enemies.length-1]; dummy.hp = 1e9;
    P.milkJars.length = 0; P.milkZones.length = 0;
    P.fireWeapon(w);
    check("milk spawns a lobbed jar", P.milkJars.length === 1, P.milkJars.length);
    await new Promise(r=>setTimeout(r, 900));  // land -> zone
    check("milk jar lands as a zone", P.milkZones.length === 1, P.milkZones.length);
    // keep the dummy sitting in the zone and read its slow + amp
    const z = P.milkZones[0];
    dummy.mesh.position.set(z.x, 0, z.z);
    await new Promise(r=>setTimeout(r, 120));
    check("enemy in the milk zone is slowed (25%)", (dummy.slowT||0) > 0 && Math.abs((dummy.slowPct||0) - 0.25) < 1e-6, `${(dummy.slowT||0).toFixed(2)}/${dummy.slowPct}`);
    check("enemy in the milk zone gets a +20% damage-amp mark", (dummy.ampT||0) > 0 && Math.abs((dummy.amp||0) - 0.20) < 1e-6, dummy.amp);
    // amp measured through damageEnemy: 40 -> 48
    dummy.hp = 1e9; const before = dummy.hp;
    P.damageEnemy(dummy, 40, new THREE.Vector3(1,0,0), "corn");
    check("milk amp makes a 40 hit deal 48 (+20%)", Math.abs((before - dummy.hp) - 48) < 0.01, before - dummy.hp);
    // evolve
    for (let i=0;i<7;i++) P.applyUpgrade("milk_radius", 1);
    check("milk not evolved at 7 without Hourglass", w.evolved !== true, P.weaponLevel(w));
    P.applyUpgrade("hourglass", 1);
    check("milk evolves to Butter Churn with Hourglass (churn + 35% slow)", w.evolved && w.churn === true && Math.abs(w.slowPct - 0.35) < 1e-6, w.evoName || "");
    P.enemies.length = 0; P.milkJars.length = 0; P.milkZones.length = 0;
    return out;
  }));

  // Hay Roller: rolls out, pierces with falloff, boomerangs back; evolve to Boulder Bale
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    const w = P.setSoleWeapon("hay"); w.timer = 999;   // only our explicit fire
    P.player.position.set(0,0,0);
    P.enemies.length = 0; P.bales.length = 0;
    for (let i=0;i<4;i++) P.spawnEnemy("turtle", { at: [0, -(3 + i*5)] });
    const dummies = P.enemies.slice(-4);
    for (const d of dummies) d.hp = 1e9;
    P.fireWeapon(w);
    check("hay spawns a rolling bale", P.bales.length === 1, P.bales.length);
    let wentBack = false;
    for (let i=0;i<70;i++){ if (P.bales[0] && P.bales[0].phase === "back") wentBack = true; await new Promise(r=>setTimeout(r, 25)); }
    check("bale boomerangs (phase flips to 'back')", wentBack, wentBack);
    const hits = dummies.map(d => 1e9 - d.hp);
    check("all 4 dummies were hit by the bale", hits.every(h => h > 0), JSON.stringify(hits.map(h=>Math.round(h))));
    check("bale pierce damage falls off per enemy (first hit hardest)", hits[0] >= hits[1] && hits[1] >= hits[2], JSON.stringify(hits.map(h=>Math.round(h))));
    // evolve
    for (let i=0;i<7;i++) P.applyUpgrade("hay_damage", 1);
    check("hay not evolved at 7 without Horseshoe", w.evolved !== true, P.weaponLevel(w));
    P.applyUpgrade("horseshoe", 1);
    check("hay evolves to Boulder Bale with Horseshoe (2 bales, heavy knockback)", w.evolved && w.bales === 2 && w.heavyKb === true, w.evoName || "");
    P.enemies.length = 0; P.bales.length = 0;
    return out;
  }));

  // weapon-pick screen can offer the 4 new weapons
  await fresh();
  push(await page.evaluate(() => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    const want = new Set(["Egg Mortar", "Chicken Flock", "Milk Splash", "Hay Roller"]);
    const seen = new Set();
    for (let k=0;k<80 && seen.size < want.size;k++){
      P.weaponsArr = [P.newWeapon("corn")];   // 11 remaining -> new weapons are eligible
      P.openWeaponPick();
      for (const nm of document.querySelectorAll("#cards .card .nm")) if (want.has(nm.textContent)) seen.add(nm.textContent);
    }
    check("all four new weapons can appear on the weapon-pick screen", seen.size === want.size, Array.from(seen).join(", "));
    document.getElementById("levelupOverlay").classList.remove("show");
    return out;
  }));

  // 12-weapon stats screen renders (incl. a new weapon's damage bar)
  await fresh();
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    check("WEAPON_SPECS now holds 12 weapons", Object.keys(P.WEAPON_SPECS).length === 12, Object.keys(P.WEAPON_SPECS).length);
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [2,2] });
    const e = P.enemies[P.enemies.length-1]; e.hp = 1e9;
    P.damageEnemy(e, 120, new THREE.Vector3(1,0,0), "hay");
    P.damageEnemy(e, 60, new THREE.Vector3(1,0,0), "egg");
    P.gameOver(true);
    await new Promise(r=>setTimeout(r, 600));
    const html = document.getElementById("statsPanel").innerHTML;
    check("stats panel lists a new weapon (Hay Roller)", html.includes("Hay Roller"), true);
    check("stats panel lists a new weapon (Egg Mortar)", html.includes("Egg Mortar"), true);
    return out;
  }));

  // ---- DPS parity table: MODERATE CROWD, fully invested + evolved ----
  // Pasture Panic is a horde game — the representative parity scenario is a small crowd, not one fat
  // dummy (which over-credits convergent-multishot weapons whose every projectile lands on the same
  // target, and under-credits scatter/AoE/pet weapons). We sustain damage into ~6 clustered turtles.
  push(await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    async function measure(id){
      P.startGame();
      const w = P.setSoleWeapon(id);
      window.__T.maxOutWeapon(id);       // fully invested
      const partner = P.EVO_PARTNER[id]; if (partner) P.applyUpgrade(partner, 1);   // + evolved (fully built)
      P.player.position.set(0,0,0);
      P.enemies.length = 0;
      for (let i=0;i<6;i++){ const a=i/6*Math.PI*2; P.spawnEnemy("turtle", { at: [Math.cos(a)*3, -5 + Math.sin(a)*3] }); }
      for (const e of P.enemies) e.hp = 1e12;   // survive the whole window
      for (const k of Object.keys(P.dmgByWeapon)) delete P.dmgByWeapon[k];
      const T = 5.0;
      await new Promise(r=>setTimeout(r, T*1000));
      const dmg = P.dmgByWeapon[id] || 0;
      P.enemies.length = 0;
      return dmg / T;
    }
    const table = {};
    for (const id of ["corn","cats","bolt","fork","egg","chicken","milk","hay"]) table[id] = await measure(id);
    // The existing roster itself spans ~4x (design review flags the multishot weapons as dominant),
    // so parity is judged against the existing-weapon ENVELOPE rather than a single point. A new
    // DAMAGE weapon should sit inside [min, max] of the existing damage roster and never exceed it.
    const existing = [table.corn, table.cats, table.bolt, table.fork];
    const rMin = Math.min(...existing), rMax = Math.max(...existing);
    const line = Object.keys(table).map(id => `${id}:${Math.round(table[id])}`).join("  ");
    check("DPS TABLE moderate-crowd (dps)", true, line);
    check("existing damage roster envelope (corn/cats/bolt/fork)", true, `${Math.round(rMin)}–${Math.round(rMax)} dps`);
    const inBand = (id) => table[id] >= rMin * 0.6 && table[id] <= rMax;   // >=60% of the weakest, never above the strongest
    check(`egg damage sits inside the roster envelope`, inBand("egg"), `${Math.round(table.egg)}dps (roster ${Math.round(rMin)}–${Math.round(rMax)})`);
    check(`hay damage sits inside the roster envelope`, inBand("hay"), `${Math.round(table.hay)}dps`);
    check(`chicken damage sits inside the roster envelope (pet weapon)`, inBand("chicken"), `${Math.round(table.chicken)}dps`);
    // milk is support/debuff — deliberately the lowest raw DPS; its budget is slow + damage-amp
    check(`milk is a low-DPS support/debuff weapon by design (value is slow + damage-amp)`, table.milk > 0 && table.milk < rMin, `${Math.round(table.milk)}dps`);
    return out;
  }));

  const canvasOk = await page.evaluate(() => { const c = document.querySelector("canvas"); return !!c && c.width > 0 && c.height > 0; });
  checks.push({ name: "game canvas rendered", pass: canvasOk, detail: canvasOk });

  await page.close();
  return { checks, errors };
}

async function runMobilePass(browser) {
  const { page, errors } = await openPage(browser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const checks = [];
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });
  const res = await page.evaluate(async () => {
    const P = window.__PP__; const out = [];
    const check = (n, c, d) => out.push({ name: n, pass: !!c, detail: d == null ? "" : String(d) });
    check("hud visible on mobile", document.getElementById("hud").style.display === "block", true);
    P.applyUpgrade("horseshoe", 1); P.updateHud();
    check("passive slots render on mobile", document.querySelectorAll("#passiveSlots .pSlot").length === 4, document.querySelectorAll("#passiveSlots .pSlot").length);
    // a new weapon fires without error on mobile
    const w = P.setSoleWeapon("egg"); w.timer = 999;
    P.enemies.length = 0; P.spawnEnemy("turtle", { at: [0,-6] });
    P.eggs.length = 0; P.bomblets.length = 0;
    P.fireWeapon(w);
    P.enemies.length = 0;   // clear before landing so bomblets survive to be counted
    let maxB = 0;
    for (let i=0;i<50;i++){ P.enemies.length = 0; await new Promise(r=>setTimeout(r, 20)); maxB = Math.max(maxB, P.bomblets.length); }
    check("egg weapon works on mobile (bomblets spawned)", maxB >= 3, maxB);
    P.enemies.length = 0; P.eggs.length = 0; P.bomblets.length = 0;
    return out;
  });
  checks.push(...res);
  const canvasOk = await page.evaluate(() => { const c = document.querySelector("canvas"); return !!c && c.width > 0 && c.height > 0; });
  checks.push({ name: "game canvas rendered (mobile)", pass: canvasOk, detail: canvasOk });
  await page.close();
  return { checks, errors };
}

async function runBotPlaytest(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  // normal run (default loadout — matches batch1 pacing exactly). New-weapon code paths are covered
  // exhaustively in the desktop checks; the bot's job here is a 75s stability/no-crash sweep.
  await page.evaluate(() => window.__PP__.startGame());
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
      if (P.state === "over") { P.startGame(); }
      await sleep(180);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kz }));
      const now = performance.now(); frameSamples.push(now - lastT); lastT = now;
    }
    const avgGap = frameSamples.reduce((a,b)=>a+b,0)/frameSamples.length;
    return { finalState: P.state, elapsed: P.elapsed, kills: P.kills, hp: P.hp, avgGap, enemyCount: P.enemies.length };
  });
  const checks = [
    { name: "bot session completed without hanging", pass: true, detail: JSON.stringify(result) },
    // elapsed is game-sim time; under headless swiftshader it tracks wall-clock at a load-dependent
    // fraction. The point of this check is to catch a FROZEN sim — any healthy advance clears it.
    { name: "sim advanced during the 75s session (not frozen)", pass: result.elapsed > 4, detail: result.elapsed },
    { name: "frame pacing sane (avg loop gap < 400ms)", pass: result.avgGap < 400, detail: result.avgGap.toFixed(1) },
    { name: "enemy count bounded (no runaway spawn)", pass: result.enemyCount < 400, detail: result.enemyCount }
  ];
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
    channel: "chrome", headless: "new",
    args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
  });
  let allOk = true;
  try {
    for (const [label, fn] of [
      ["DESKTOP feature checks", runDesktopChecks],
      ["MOBILE viewport checks", runMobilePass],
      ["BOT PLAYTEST (75s)", runBotPlaytest]
    ]) {
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
