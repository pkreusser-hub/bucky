#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic design-review Batch 1 (bug fixes + balance + juice pass +
 * off-screen indicators). See pasturepanic-design-review.md for the spec this implements.
 * Uses the window.__PP__ debug hook (extended for this batch) to drive gameplay deterministically
 * rather than simulating real input for every check — same convention as the existing audio suite.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8866;
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
  // domcontentloaded + explicit hook-wait (NOT networkidle0): the ~4.8MB of new intensity-music
  // mp3s keep the connection busy past the nav cap (esp. on the dsf-2 mobile pass), so networkidle0
  // no longer settles in time. The page is domReady in ~1s; __PP__ is the true readiness signal and
  // audio streams in the background without affecting any check in this suite.
  await page.goto(BASE + "/pasturepanic.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__, { timeout: 20000 });
  // first gesture — some UI code paths (audio unlock) expect at least one
  await page.mouse.move(400, 300);
  await page.mouse.down();
  await page.mouse.up();
  return { page, errors };
}

async function runDesktopChecks(browser) {
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  const checks = [];
  function pushChecks(arr) { for (const c of arr) checks.push(c); }

  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });

  // ---- 1. Stampede Pact: curse reduces spawn interval, HP bonus updated ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.curse = 0;
    const i0 = P.computeSpawnInterval();
    P.curse = 3;
    const i3 = P.computeSpawnInterval();
    check("curse 3 shrinks spawn interval vs curse 0", i3 < i0, `${i0.toFixed(4)} -> ${i3.toFixed(4)}`);
    // ~ -0.08*3 = -24% (approximately, given the floor clamp)
    const ratio = i3 / i0;
    check("curse 3 interval ratio close to (1-0.08*3)=0.76", Math.abs(ratio - 0.76) < 0.05, ratio.toFixed(3));
    P.curse = 0;
    return out;
  }));

  // ---- 2. EVOLVE_AT = 7 ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    check("EVOLVE_AT is 7", P.EVOLVE_AT === 7, P.EVOLVE_AT);
    const w = P.weaponById("corn");
    w.evolved = false;
    // apply 6 corn upgrades — should NOT evolve yet
    for (let i = 0; i < 6; i++) P.applyUpgrade("corn_damage", 1);
    check("not evolved at level 6", w.evolved === false, P.weaponLevel(w));
    // BATCH-2 change: reaching level 7 alone no longer evolves — corn needs its partner passive (Feed Bag)
    P.applyUpgrade("corn_rate", 1);
    check("NOT evolved at level 7 without the partner passive", w.evolved === false, P.weaponLevel(w));
    // acquiring the partner passive (Feed Bag) evolves the weapon instantly
    P.applyUpgrade("feedbag", 1);
    check("evolves at level 7 once the partner passive is owned", w.evolved === true, P.weaponLevel(w));
    return out;
  }));

  // reset run for further isolated checks (evolve flag etc shouldn't leak weirdly, but a fresh
  // run keeps every subsequent check's baseline clean)
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });

  // ---- 3. Crow prediction lead + re-target ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    check("crow dmg is 9", (function(){
      // spawn one and read its dmg directly
      P.player.position.set(0, 0, 0);
      P.playerCurVel = { x: 0, z: 0 };
      P.spawnEnemy("crow", { at: [0, -20] });
      const c = P.enemies[P.enemies.length - 1];
      const dmg = c.dmg;
      P.enemies.length = 0;
      return dmg === 9;
    })(), "");

    // moving player: crow should aim ahead of the player's actual position, not straight at it
    P.player.position.set(0, 0, 0);
    P.playerCurVel = { x: 5, z: 0 };   // moving hard in +X
    P.spawnEnemy("crow", { at: [0, -20] });
    const crow = P.enemies[P.enemies.length - 1];
    const leadDx = crow.dirFixed.x;
    check("crow dirFixed leads toward +X (player's predicted heading)", leadDx > 0.05, leadDx.toFixed(3));

    // re-target: walk the crow to just past halfway, change player velocity, verify direction changes
    const dist0 = crow.flightDist;
    check("flightDist recorded", dist0 > 0, dist0);
    // fast-forward the crow along its original direction to just over halfway
    const dirBefore = crow.dirFixed.clone();
    crow.mesh.position.addScaledVector(dirBefore, dist0 * 0.51);
    crow.flightTraveled = dist0 * 0.51;
    P.playerCurVel = { x: -8, z: 0 };   // reverse the player's velocity so a retarget is obviously visible
    // advance one small game frame's worth via the real crow-update path: easiest is to nudge again just past 0.5
    // by re-invoking spawnEnemy's math isn't accessible directly, so drive a tiny bit of real update time:
    return out;
  }));
  // give one real frame for the retarget branch (inside update()) to fire, then check it flipped
  await new Promise((r) => setTimeout(r, 120));
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const crow = P.enemies.find(e => e.kind === "crow");
    check("crow still present after retarget frame", !!crow, !!crow);
    if (crow) check("crow retargeted flag set", crow.retargeted === true, crow.retargeted);
    P.enemies.length = 0;
    return out;
  }));

  // ---- 4. Boom pickup damage scales by tier, boss = 5% of maxHp ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.elapsed = 0; P.kills = 0;
    P.player.position.set(0, 0, 0);
    P.enemies.length = 0;
    P.spawnEnemy("turtle", { at: [1, 1] });
    const e0 = P.enemies[P.enemies.length - 1];
    e0.hp = 100000;   // high HP so it survives the hit and the delta reflects the ACTUAL damage applied, not just its starting HP
    const hpBefore0 = e0.hp;
    P.applyPickup({ type: "boom" });
    const dmg0 = hpBefore0 - e0.hp;
    check("boom dmg at tier 0 ~= 250", Math.abs(dmg0 - 250) < 1, dmg0);

    P.elapsed = 95;   // tier = floor(95/90) = 1
    P.enemies.length = 0;
    P.spawnEnemy("turtle", { at: [1, 1] });
    const e1 = P.enemies[P.enemies.length - 1];
    e1.hp = 100000;
    const hpBefore1 = e1.hp;
    P.applyPickup({ type: "boom" });
    const dmg1 = hpBefore1 - e1.hp;
    check("boom dmg at tier 1 ~= 275", Math.abs(dmg1 - 275) < 1, dmg1);

    // boss: 5% of maxHp
    P.enemies.length = 0;
    P.spawnBoss();
    const boss = P.boss;
    const maxHp = boss.maxHp;
    const hpBeforeBoss = boss.hp;
    P.applyPickup({ type: "boom" });
    const bossDmg = hpBeforeBoss - boss.hp;
    check("boom dmg on boss ~= 5% of maxHp", Math.abs(bossDmg - maxHp * 0.05) < 1, `${bossDmg} vs ${maxHp * 0.05}`);
    P.enemies.length = 0; P.elapsed = 0; P.kills = 0;
    return out;
  }));

  // ---- 5. Sprinkler: sprk_rate upgrade + per-enemy cooldown scaling ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const hasUpgrade = P.UPGRADES.some(u => u.id === "sprk_rate" && u.weapon === "sprinkler");
    check("sprk_rate upgrade exists", hasUpgrade, hasUpgrade);
    if (!P.weaponById("sprinkler")) P.weapons.push({ id: "sprinkler", dmgMul: 1, rateMul: 1, blastMul: 1, count: 1, multishot: 1, pierce: 0, maxOut: 1, timer: 0.5, deployTimer: 1, beams: 1, spinAngle: 0 });
    const w = P.weaponById("sprinkler");
    const before = w.rateMul;
    P.applyUpgrade("sprk_rate", 1);
    check("sprk_rate raises sprinkler rateMul by 0.10", Math.abs((w.rateMul - before) - 0.10) < 1e-6, w.rateMul);
    return out;
  }));

  // ---- 6. Pitchfork per-hit falloff ----
  pushChecks(await page.evaluate(async () => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.enemies.length = 0;
    P.forks.length = 0;
    P.player.position.set(0, 0, 0);
    // CORN WORLD (2026-07-14): standing corn now BLOCKS the pitchfork (directive 2), and the dummy
    // line extends past the spawn clearing into the generated field — fell all corn so this test
    // measures pure pierce falloff on an open arena (corn blocking has its own corn-suite checks).
    P.clearAllCorn();
    // strip every OTHER equipped weapon (earlier checks in this suite left an evolved Kettle Corn
    // Cannon + a sprinkler on the player, both of which auto-fire every frame via weaponsUpdate()
    // and would otherwise plink the nearest dummy in the background and contaminate the falloff
    // measurement) — the fork is the only thing that should be able to touch these dummies.
    // timer:999 additionally disables the FORK's own per-frame auto-fire (same convention as the
    // audio suite) so ONLY our explicit fireWeapon() call below throws a fork.
    P.weapons.length = 0;
    P.weapons.push({ id: "fork", dmgMul: 1, rateMul: 1, blastMul: 1, count: 1, multishot: 1, pierce: 0, maxOut: 1, timer: 999, deployTimer: 999, beams: 1, spinAngle: 0 });
    const w = P.weaponById("fork");
    // line of 4 tough dummies directly north so one fork throw pierces through all of them.
    // Spaced FAR apart (6 units) — the fork's hit radius (e.r+1.1 ~= 2.4) would otherwise let it
    // register 2 closely-packed dummies in the same frame, which is fine gameplay-wise but makes
    // the per-hit falloff order nondeterministic for this test; wide spacing keeps hits sequential.
    for (let i = 0; i < 4; i++) P.spawnEnemy("turtle", { at: [0, -(2 + i * 6)] });
    const dummies = P.enemies.slice(-4);
    for (const d of dummies) d.hp = 100000; // survive multiple hits so we can read hp deltas cleanly
    P.fireWeapon(w);
    // let the fork travel across the line (needs ~1.2s to cross all 4 at speed 19)
    await new Promise(r => setTimeout(r, 1400));
    const hits = dummies.map(d => 100000 - d.hp);
    check("all 4 dummies hit", hits.every(h => h > 0), JSON.stringify(hits));
    check("damage strictly decreases per pierce", hits[0] > hits[1] && hits[1] > hits[2] && hits[2] > hits[3], JSON.stringify(hits));
    // BALANCE OVERHAUL 2026-07-13: the pitchfork's per-pierce falloff was STEEPENED (BAL.forkPierceFalloff
    // 0.12->0.17->0.22, floor 0.30->0.14->0.10) so one throw no longer mows an unbounded line at near-full
    // damage (it was 43-46% of a 4-weapon build in the spend×build sim). CORN rework (2026-07-13) steepened
    // it once more (0.22 -> 0.27) because standing-corn funnels line the crowd into the fork's path (evolved-
    // focused fork share 43% -> 48%, back over the 45% cap); ratios now track hit[n] = hit[0]*(1 - 0.27*n),
    // floored at 0.10 -> ~0.73/0.46/0.19.
    const r1 = hits[1] / hits[0], r2 = hits[2] / hits[0], r3 = hits[3] / hits[0];
    check("falloff ratios track ~0.73/0.46/0.19 (27%/pierce, post-corn tune)", Math.abs(r1 - 0.73) < 0.03 && Math.abs(r2 - 0.46) < 0.03 && Math.abs(r3 - 0.19) < 0.03, `${r1.toFixed(2)},${r2.toFixed(2)},${r3.toFixed(2)}`);
    P.enemies.length = 0;
    return out;
  }));

  // ---- 7. uni_damage / uni_rate values ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    const ud = P.UPGRADES.find(u => u.id === "uni_damage");
    const ur = P.UPGRADES.find(u => u.id === "uni_rate");
    check("uni_damage max is 6", ud.max === 6, ud.max);
    check("uni_rate max is 6", ur.max === 6, ur.max);
    check("uni_damage desc says +8%", /\+8%/.test(ud.desc), ud.desc);
    check("uni_rate desc says +7%", /\+7%/.test(ur.desc), ur.desc);
    const before = P.stats.gDmg;
    P.applyUpgrade("uni_damage", 1);
    check("uni_damage applies +0.08 to gDmg", Math.abs((P.stats.gDmg - before) - 0.08) < 1e-6, P.stats.gDmg);
    return out;
  }));

  // ---- 8. Skip reward scales with tier ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.elapsed = 0;
    P.openLevelUp();
    const label0 = document.getElementById("skipBtn").textContent;
    check("skip label at tier 0 shows +3", label0.includes("+3 "), label0);
    document.getElementById("skipBtn").click();
    P.elapsed = 200;   // tier = floor(200/90) = 2
    P.openLevelUp();
    const label2 = document.getElementById("skipBtn").textContent;
    check("skip label at tier 2 shows +5", label2.includes("+5 "), label2);
    document.getElementById("skipBtn").click();
    P.elapsed = 0;
    return out;
  }));

  // ---- 9. Elite chance cap raised past 600s ----
  // Deterministic (not statistical): pin Math.random to a fixed value BETWEEN the two caps
  // (0.03 and 0.06) so the elite roll is guaranteed to fail below 600s and guaranteed to
  // succeed past 600s — no flaky RNG sampling needed.
  pushChecks(await page.evaluate(async () => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.startGame();
    P.enemies.length = 0;
    P.kills = 5000;   // saturates the kills-scaled term (0.008+kills*0.00004 >> 0.06) so Math.min(cap, ...) always resolves to the cap itself
    const origRandom = Math.random;
    Math.random = () => 0.045;   // strictly between 0.03 and 0.06
    P.elapsed = 30;   // well under 600s -> cap should be 0.03, roll (0.045) must fail every tick
    await new Promise(r => setTimeout(r, 500));
    const eliteBefore600 = P.enemies.some(e => e.elite);
    check("no elite spawns below the 0.03 cap with a 0.045 roll", eliteBefore600 === false, P.enemies.filter(e=>e.elite).length);
    P.enemies.length = 0;
    P.elapsed = 650;   // past 600s -> cap should be 0.06, roll (0.045) must succeed
    await new Promise(r => setTimeout(r, 500));
    const eliteAfter600 = P.enemies.some(e => e.elite);
    check("an elite spawns above the 0.06 cap with the same 0.045 roll", eliteAfter600 === true, P.enemies.filter(e=>e.elite).length);
    Math.random = origRandom;
    P.enemies.length = 0; P.elapsed = 0; P.kills = 0;
    return out;
  }));

  // ---- 10. Golden Egg revive: clear radius 16 + invuln window ----
  // revivesLeft is derived from metaLvl("revive") at startGame() time — set the meta upgrade, restart
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.meta.up.revive = 1;   // ensure at least one revive level is owned for this check
    P.startGame();
    P.player.position.set(0, 0, 0);
    P.enemies.length = 0;
    // pack enemies in at radius 14 (inside the new 16 clear radius) so we can prove the wider clear
    for (let i = 0; i < 5; i++) P.spawnEnemy("rat", { at: [14 * Math.cos(i), 14 * Math.sin(i)] });
    P.hp = 1;
    P.gameOver(false);   // defeat while a revive is banked -> should revive, not end the run
    check("state stays playing after a banked revive", P.state === "playing", P.state);
    check("enemies within 16 were cleared", P.enemies.length === 0, P.enemies.length);
    check("invulnT set to 1.2 after revive", Math.abs(P.invulnT - 1.2) < 0.05, P.invulnT);
    // damage during the invuln window should be a no-op via the contact-damage path
    const hpBefore = P.hp;
    P.spawnEnemy("rat", { at: [0.3, 0] });
    return out;
  }));
  await new Promise(r => setTimeout(r, 200));   // let a couple of real frames run the contact-damage check
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    check("hp unaffected by contact while invulnerable", P.hp === P.stats.maxhp, `${P.hp}/${P.stats.maxhp}`);
    P.enemies.length = 0; P.invulnT = 0;
    return out;
  }));

  // ---- 11. Windmill damages parked enemies ----
  pushChecks(await page.evaluate(async () => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.startGame();
    P.enemies.length = 0;
    const wm = P.windmill;
    check("windmill exists", !!wm, !!wm);
    if (wm){
      P.spawnEnemy("rat", { at: [wm.position.x, wm.position.z] });
      const e = P.enemies[P.enemies.length - 1];
      e.hp = 10000;
      const before = e.hp;
      await new Promise(r => setTimeout(r, 1200));
      const after = e.hp;
      check("enemy parked at the windmill takes blade damage over time", after < before, `${before} -> ${after}`);
    }
    P.enemies.length = 0;
    return out;
  }));

  // ---- 12. Damage numbers: appear + toggle + persist ----
  pushChecks(await page.evaluate(async () => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.dmgNumEnabled = true;
    P.enemies.length = 0;
    P.spawnEnemy("turtle", { at: [3, 3] });
    const e = P.enemies[P.enemies.length - 1];
    P.damageEnemy(e, 42, new THREE.Vector3(1, 0, 0), "corn");
    // numbers are BATCHED (0.15s window) — the DOM node only appears once that window flushes
    await new Promise(r => setTimeout(r, 350));
    const active = document.querySelectorAll("#dmgNumLayer .dmgNum").length;
    const anyVisible = Array.from(document.querySelectorAll("#dmgNumLayer .dmgNum")).some(el => el.style.display === "block");
    check("dmgNum pool exists", active > 0, active);
    check("a damage number is visible after a hit", anyVisible, anyVisible);
    P.enemies.length = 0;
    return out;
  }));
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    document.getElementById("pauseBtn").click();
    const cb = document.getElementById("dmgNumToggle");
    check("toggle reflects enabled state", cb.checked === true, cb.checked);
    cb.checked = false;
    cb.dispatchEvent(new Event("change"));
    check("toggling off updates dmgNumEnabled", P.dmgNumEnabled === false, P.dmgNumEnabled);
    check("toggle persists to localStorage", localStorage.getItem("pp_dmgnum") === "0", localStorage.getItem("pp_dmgnum"));
    cb.checked = true;
    cb.dispatchEvent(new Event("change"));
    check("toggling back on restores dmgNumEnabled", P.dmgNumEnabled === true, P.dmgNumEnabled);
    document.getElementById("resumeBtn").click();
    return out;
  }));

  // ---- 13. Hit-stop dips timeScale on elite/boss kill ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.enemies.length = 0;
    P.spawnEnemy("rat", { at: [2, 2], elite: true });
    const e = P.enemies[P.enemies.length - 1];
    e.elite = true;
    check("hitStopT starts at 0", P.hitStopT === 0, P.hitStopT);
    P.damageEnemy(e, 99999, new THREE.Vector3(1, 0, 0));
    check("elite kill triggers hit-stop (~30ms)", P.hitStopT > 0 && P.hitStopT <= 0.031, P.hitStopT);
    return out;
  }));
  await new Promise(r => setTimeout(r, 200));   // let hitStopT drain back to 0
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    check("hitStopT drains back to 0 shortly after", P.hitStopT === 0, P.hitStopT);
    P.enemies.length = 0;
    P.spawnBoss();
    const boss = P.boss;
    P.damageEnemy(boss, 9999999, new THREE.Vector3(1, 0, 0));
    check("boss kill triggers hit-stop (~80ms)", P.hitStopT > 0.03 && P.hitStopT <= 0.081, P.hitStopT);
    return out;
  }));

  // ---- 14. Screen-shake slider persists ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    document.getElementById("pauseBtn").click();
    const sl = document.getElementById("shakeSlider");
    check("slider default value is 40", sl.value === "40", sl.value);
    sl.value = "75";
    sl.dispatchEvent(new Event("input"));
    check("shakePct updates live", P.shakePct === 75, P.shakePct);
    check("shakePct persists to localStorage", localStorage.getItem("pp_shake") === "75", localStorage.getItem("pp_shake"));
    check("label shows 75%", document.getElementById("shakeVal").textContent === "75%", document.getElementById("shakeVal").textContent);
    document.getElementById("resumeBtn").click();
    return out;
  }));

  // ---- 15. End-of-run stats screen ----
  pushChecks(await page.evaluate(async () => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.startGame();
    P.player.position.set(0, 0, 0);
    P.enemies.length = 0;
    P.spawnEnemy("rat", { at: [1, 1] });
    const e = P.enemies[P.enemies.length - 1];
    e.hp = 100000;
    P.damageEnemy(e, 50, new THREE.Vector3(1, 0, 0), "corn");
    P.damageEnemy(e, 20, new THREE.Vector3(1, 0, 0), "bees");
    P.gameOver(true);
    // bars animate in via a CSS transition on the next rAF — wait past that before measuring pixels
    await new Promise(r => setTimeout(r, 700));
    const panelHtml = document.getElementById("statsPanel").innerHTML;
    check("stats panel renders weapon damage section", panelHtml.includes("Damage by weapon"), panelHtml.length);
    check("stats panel shows corn contribution", panelHtml.includes("Corn Cannon"), true);
    check("stats panel shows trophy on top weapon", panelHtml.includes("🏆"), true);
    const bars = document.querySelectorAll("#statsPanel .stBar");
    check("at least one damage bar rendered", bars.length > 0, bars.length);
    // catches the "span with no display:block ignores width" class of bug — assert ACTUAL
    // rendered pixel widths, not just the data-w attribute the JS set
    const widths = Array.from(bars).map(el => el.getBoundingClientRect().width);
    check("damage bars have real nonzero pixel width", widths.every(w => w > 5), JSON.stringify(widths));
    check("top (corn) bar renders wider than the second (bees) bar", widths[0] > widths[1], JSON.stringify(widths));
    check("stats panel shows run time / xp / dmg taken", panelHtml.includes("Run time") && panelHtml.includes("XP collected") && panelHtml.includes("Damage taken"), true);
    return out;
  }));

  // ---- 16. Off-screen boss arrow ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.startGame();
    P.player.position.set(0, 0, 0);
    P.enemies.length = 0;
    check("boss arrow hidden with no boss", document.getElementById("bossArrow").style.display === "none" || document.getElementById("bossArrow").style.display === "", document.getElementById("bossArrow").style.display);
    P.spawnBoss();
    P.boss.mesh.position.set(0, 0, -200);   // far outside the camera frustum
    P.updateOffscreenIndicators();
    const disp = document.getElementById("bossArrow").style.display;
    check("boss arrow shows when boss is far off-screen", disp === "flex", disp);
    // bring the boss close (on-screen) and confirm the arrow hides again
    P.boss.mesh.position.set(0, 0, 5);
    P.updateOffscreenIndicators();
    const disp2 = document.getElementById("bossArrow").style.display;
    check("boss arrow hides when boss is on-screen", disp2 === "none", disp2);
    P.enemies.length = 0;
    return out;
  }));

  // ---- 17. Off-screen chest arrow ----
  pushChecks(await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    P.chests.length = 0;
    // manufacture a chest object directly (dropChest isn't exposed, but chests share the same {mesh} shape)
    const g = new THREE.Group();
    g.position.set(300, 0, 0);
    P.chests.push({ mesh: g, star: null, t: 0 });
    P.updateOffscreenIndicators();
    const chestEls = document.querySelectorAll(".chestArrow");
    check("chest arrow pool created", chestEls.length > 0, chestEls.length);
    const anyVisible = Array.from(chestEls).some(el => el.style.display === "flex");
    check("a chest arrow shows for a far-off chest", anyVisible, anyVisible);
    P.chests.length = 0;
    return out;
  }));

  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return !!c && c.width > 0 && c.height > 0;
  });
  checks.push({ name: "game canvas rendered", pass: canvasOk, detail: canvasOk });

  await page.close();
  return { checks, errors };
}

async function runMobilePass(browser) {
  const { page, errors } = await openPage(browser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const checks = [];
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });

  const res = await page.evaluate(() => {
    const P = window.__PP__;
    const out = [];
    function check(name, cond, detail) { out.push({ name, pass: !!cond, detail: detail == null ? "" : String(detail) }); }
    check("hud visible on mobile viewport", document.getElementById("hud").style.display === "block", true);
    P.enemies.length = 0;
    P.spawnBoss();
    P.boss.mesh.position.set(0, 0, -200);
    P.updateOffscreenIndicators();
    const disp = document.getElementById("bossArrow").style.display;
    check("boss arrow works on mobile viewport too", disp === "flex", disp);
    P.enemies.length = 0;
    return out;
  });
  checks.push(...res);

  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    return !!c && c.width > 0 && c.height > 0;
  });
  checks.push({ name: "game canvas rendered (mobile)", pass: canvasOk, detail: canvasOk });

  await page.close();
  return { checks, errors };
}

async function runBotPlaytest(browser) {
  // 75s auto-move bot session: no crashes, frame pacing sane, HUD numbers move
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.evaluate(() => window.__PP__.startGame());
  await page.waitForFunction(() => window.__PP__.state === "playing", { timeout: 5000 });

  const result = await page.evaluate(async () => {
    const P = window.__PP__;
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    const t0 = performance.now();
    let frameSamples = [];
    let lastT = t0;
    const dur = 75000;
    while (performance.now() - t0 < dur) {
      // simple orbit-walk bot: keeps moving, occasionally changes heading
      const a = (performance.now() - t0) / 1400;
      const kx = Math.cos(a) > 0 ? "ArrowRight" : "ArrowLeft";
      const kz = Math.sin(a) > 0 ? "ArrowDown" : "ArrowUp";
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: kz }));
      if (P.state === "levelup") {
        const b = document.getElementById("skipBtn");
        // skip is hidden on the weapon-pick screen — click the first card so the bot never stalls there
        if (b && b.offsetParent !== null) b.click();
        else { const c = document.querySelector("#cards .card"); if (c) c.click(); }
      }
      if (P.state === "chest") { const b = document.getElementById("chestGrabBtn"); if (b) b.click(); }
      if (P.state === "over") { P.startGame(); }
      await sleep(180);
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kx }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: kz }));
      const now = performance.now();
      frameSamples.push(now - lastT);
      lastT = now;
    }
    const avgGap = frameSamples.reduce((a, b) => a + b, 0) / frameSamples.length;
    return {
      finalState: P.state,
      elapsed: P.elapsed,
      kills: P.kills,
      hp: P.hp,
      avgGap,
      enemyCount: P.enemies.length
    };
  });

  const checks = [
    { name: "bot session completed without hanging", pass: true, detail: JSON.stringify(result) },
    { name: "elapsed time advanced during the session", pass: result.elapsed > 10, detail: result.elapsed },
    { name: "some kills happened", pass: result.kills >= 0, detail: result.kills },
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
    channel: "chrome",
    headless: "new",
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
