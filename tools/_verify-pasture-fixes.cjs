#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic — 4 PLAYTEST FIXES (2026-07-15).
 *   1. Pumpkin impact = wet SPLAT (pp-sfx-pumpkin-splat, reused from Farm Kart's fk-sfx-splat).
 *   2. Tank Dillo boss stays WHOLE after rolling (rotation.x no longer left upside-down -> body
 *      sank underground showing "only hands/feet"). 2 full roll cycles + a hit-during-roll.
 *   3. Direct-line weapons (corn/fork/hay/chicken/scarecrow turret) only FIRE at enemies in LOS —
 *      a nearer varmint behind standing corn is skipped for a farther one in the open; hold fire
 *      when only walled targets exist.
 *   4. All weapons default to the CLOSEST enemy (pumpkin/cats/bolt/egg/milk switched strongest->nearest).
 * Drives gameplay through window.__PP__ (same http-server + puppeteer-core convention as the other
 * pasture suites). Firebase/Playroom blocked; assets/audio is ALLOWED so the splat buffer decodes.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8877;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.resolve(ROOT, "shots");

function isOpen(port){ return new Promise(r=>{ const s=net.createConnection({port,host:"127.0.0.1"}); s.once("connect",()=>{s.destroy();r(true)}); s.once("error",()=>r(false)); s.setTimeout(800,()=>{s.destroy();r(false)}); }); }
async function waitServer(port,ms){ const t0=Date.now(); while(Date.now()-t0<ms){ if(await isOpen(port)){ try{ await new Promise((res,rej)=>{ http.get({host:"127.0.0.1",port,path:"/",timeout:1000},r=>{r.resume();res()}).on("error",rej); }); return; }catch(_){} } await new Promise(r=>setTimeout(r,200)); } throw new Error("server timeout"); }

async function openPage(browser){
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  // block only cloud backends — assets/audio stays reachable so the splat buffer decodes
  page.on("request", req => { if (/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/i.test(req.url())) return req.abort(); req.continue(); });
  await page.goto(BASE + "/pasturepanic.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__, { timeout: 20000 });
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.up();   // gesture -> audio unlock
  return { page, errors };
}

async function run(browser){
  const { page, errors } = await openPage(browser);

  // wait for the audio buffers to decode (assets/audio allowed) so the splat SFX can actually play
  try { await page.waitForFunction(() => {
    const a = window.__PASTURE_AUDIO__ && window.__PASTURE_AUDIO__.audioState();
    return a && a.buffersLoaded >= a.buffersTotal;
  }, { timeout: 30000 }); } catch(_){}

  const res = await page.evaluate(async () => {
    const P = window.__PP__;
    const A = window.__PASTURE_AUDIO__;
    const out = []; const check = (n,c,d)=>out.push({name:n,pass:!!c,detail:d==null?"":String(d)});
    const sleep = ms => new Promise(r=>setTimeout(r,ms));

    // ================= FIX 1: PUMPKIN IMPACT = SPLAT =================
    const aState = A.audioState();
    check("F1a splat sample registered in AUDIO_FILES/manifest (buffersTotal 41)", aState.buffersTotal === 41 && ('pumpkinSplat' in aState.sfxPlays), `total ${aState.buffersTotal}`);
    check("F1b all audio buffers decoded (splat included)", aState.buffersLoaded === aState.buffersTotal, `${aState.buffersLoaded}/${aState.buffersTotal}`);
    P.meta.selStage = "home"; P.startGame(); await sleep(20); P.clearAllCorn(); P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    const splatBefore = A.audioState().sfxPlays.pumpkinSplat;
    const blastBefore = A.audioState().sfxPlays.pumpkinBlast;
    const pw = P.setSoleWeapon("pumpkin"); pw.timer = 999;
    P.enemies.length = 0; const pd = P.spawnEnemy("turtle", { at: [0, 8] }); if (pd){ pd.hp = pd.maxHp = 1e12; }
    for (let r=0;r<3;r++){ pw.timer = 999; P.fireWeapon(pw); for (let i=0;i<26;i++){ if (pd) pd.mesh.position.set(0,0,8); await sleep(16); } }
    const splatAfter = A.audioState().sfxPlays.pumpkinSplat;
    const blastAfter = A.audioState().sfxPlays.pumpkinBlast;
    check("F1c pumpkin blast plays the SPLAT sample (counter ticks)", splatAfter > splatBefore, `pumpkinSplat ${splatBefore} -> ${splatAfter}`);
    check("F1d old pumpkin-blast sound no longer used", blastAfter === blastBefore, `pumpkinBlast ${blastBefore} -> ${blastAfter}`);

    // ================= FIX 2: TANK DILLO STAYS WHOLE AFTER ROLLING =================
    P.meta.selStage = "home"; P.startGame(); await sleep(20); P.clearAllCorn(); P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    P.enemies.length = 0;
    P.bossIdx = 1;   // BOSSES[1] = Tank Dillo (rollout)
    P.spawnBoss();
    const b = P.boss;
    check("F2a Tank Dillo boss spawned with the rollout ability", !!b && b.ability === "rollout", b && b.name);
    const usesSplitModel = !!(b && b.mesh && b.mesh.userData && b.mesh.userData.legPivots);
    check("F2b boss uses the split-quadruped model (body + 4 legs — the 'hands/feet')", usesSplitModel, usesSplitModel ? "legPivots present" : "procedural fallback (GLB not loaded)");

    // collect all mesh parts + a whole-boss bbox helper
    function parts(){ const ms=[]; b.mesh.traverse(o=>{ if(o.isMesh) ms.push(o); }); return ms; }
    function allVisible(){ return parts().every(m => m.visible); }
    function bbox(){ b.mesh.updateMatrixWorld(true); const box=new THREE.Box3().setFromObject(b.mesh); return { minY: box.min.y, maxY: box.max.y }; }

    // keep the boss huge + parked in front of the player, and force repeated rolls
    b.hp = b.maxHp = 1e12;
    let rollsCompleted = 0, sawTumble = false, everWentUnderground = false, everInvisiblePart = false;
    let lastPhase = b.abPhase; let maxRotXDuringRoll = 0;
    const restoredChecks = [];   // {rotX, minY, maxY, allVis} sampled just after each roll finished
    b.abTimer = 0;   // trigger the first windup immediately
    for (let i=0;i<420 && rollsCompleted < 3; i++){
      await sleep(16);
      // isolate the boss (no adds messing with the bbox) + keep it in frame
      const arr = P.enemies; for (let j=arr.length-1;j>=0;j--) if (arr[j] !== b) arr.splice(j,1);
      if (!P.enemies.includes(b)) break;
      // during rolling: record the tumble + damage it once (hit-during-roll on roll #2)
      if (b.abPhase === "rolling"){
        const rx = Math.abs(b.mesh.rotation.x % (Math.PI*2));
        maxRotXDuringRoll = Math.max(maxRotXDuringRoll, Math.abs(b.mesh.rotation.x));
        if (b.mesh.rotation.x !== 0) sawTumble = true;
        if (rollsCompleted === 1){ P.damageEnemy(b, 50, new THREE.Vector3(0,0,0), "corn"); }   // hit mid-roll
      }
      if (!allVisible()) everInvisiblePart = true;
      const bx = bbox(); if (bx.minY < -0.6) everWentUnderground = true;
      // detect a roll finishing (rolling -> dizzy)
      if (lastPhase === "rolling" && b.abPhase === "dizzy"){
        rollsCompleted++;
        // sample a couple of frames into dizzy to confirm the restore held
        b.mesh.position.set(0,0,6);
        const bx2 = bbox();
        restoredChecks.push({ rotX: b.mesh.rotation.x, minY: bx2.minY, maxY: bx2.maxY, allVis: allVisible() });
      }
      lastPhase = b.abPhase;
      // re-arm the next roll the moment it goes idle
      if (b.abPhase === "idle") b.abTimer = 0;
      // park it in front for a clean read/screenshot
      if (b.abPhase !== "rolling") b.mesh.position.set(0,0,6);
    }
    check("F2c drove >=2 full roll cycles (incl. a hit-during-roll on cycle 2)", rollsCompleted >= 2, `${rollsCompleted} rolls`);
    check("F2d the roll actually tumbles the body (rotation.x spins during rolling)", sawTumble && maxRotXDuringRoll > Math.PI, `maxRotX ${maxRotXDuringRoll.toFixed(1)} rad`);
    const allRestoredUpright = restoredChecks.length >= 2 && restoredChecks.every(r => Math.abs(r.rotX) < 1e-6);
    check("F2e after EVERY roll the body sits upright (rotation.x reset to 0)", allRestoredUpright, restoredChecks.map(r=>r.rotX.toFixed(2)).join(","));
    const allAbove = restoredChecks.length >= 2 && restoredChecks.every(r => r.minY > -0.6 && r.maxY > 1.5);
    check("F2f after EVERY roll the WHOLE body is above ground (not sunk -> 'hands/feet only')", allAbove, restoredChecks.map(r=>`[${r.minY.toFixed(1)},${r.maxY.toFixed(1)}]`).join(" "));
    check("F2g no model part ever turns invisible (visibility flags intact throughout)", !everInvisiblePart, everInvisiblePart ? "a part went invisible" : "all parts stayed visible");
    // final resting state: whole + upright
    b.mesh.position.set(0,0,6); b.abTimer = 999; await sleep(60);
    const finalVis = allVisible(); const fb = bbox();
    check("F2h final state: boss whole, upright, above ground", finalVis && Math.abs(b.mesh.rotation.x) < 1e-6 && fb.minY > -0.6 && fb.maxY > 1.5, `vis ${finalVis} rotX ${b.mesh.rotation.x.toFixed(2)} y [${fb.minY.toFixed(1)},${fb.maxY.toFixed(1)}]`);

    // ================= FIX 3: DIRECT-LINE WEAPONS ONLY FIRE AT ENEMIES IN LOS =================
    // Geometry: player at origin. A NEARER dummy behind a corn wall + a FARTHER dummy in the open.
    // A direct-line weapon must skip the walled (nearer) one and hit the open (farther) one; with ONLY
    // a walled target it holds fire (fireWeapon returns false, no shot).
    function losSetup(){
      P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.player.position.set(0,0,0);
      // wall band z 2..4 spanning x -8..8 (between player and the north dummy; clear of the east line z=0)
      P.setCornField((cx,cz,wx,wz) => wz > 1.5 && wz < 4.5 && Math.abs(wx) < 8);
      P.enemies.length = 0;
      const walled = P.spawnEnemy("turtle", { at: [0, 6] });  walled.hp = walled.maxHp = 1e12;   // nearer (dist 6), behind wall
      const open   = P.spawnEnemy("turtle", { at: [11, 0] }); open.hp = open.maxHp = 1e12;         // farther (dist 11), clear LOS
      return { walled, open };
    }
    const dmgOf = e => 1e12 - e.hp;
    for (const wid of ["corn","fork","hay"]){
      const { walled, open } = losSetup();
      const w = P.setSoleWeapon(wid); w.timer = 999; if (w.multishot!=null) w.multishot = 1;
      // fireWeapon returns TRUE (it found a visible target) and the OPEN one takes damage, walled stays 0
      let fired = false;
      for (let i=0;i<60;i++){ w.timer = 999; if (P.fireWeapon(w)) fired = true; walled.mesh.position.set(0,0,6); open.mesh.position.set(11,0,0); await sleep(16); }
      check(`F3 ${wid}: fires at the OPEN (farther) target, not the nearer WALLED one`, fired && dmgOf(open) > 0 && dmgOf(walled) === 0, `open +${Math.round(dmgOf(open))}, walled +${Math.round(dmgOf(walled))}`);
      // hold-fire: remove the open target — now only a walled one exists -> fireWeapon returns false
      P.enemies.length = 0; const only = P.spawnEnemy("turtle", { at: [0, 6] }); only.hp = only.maxHp = 1e12;
      let anyFired = false; const beforeDmg = dmgOf(only);
      for (let i=0;i<30;i++){ w.timer = 999; if (P.fireWeapon(w)) anyFired = true; only.mesh.position.set(0,0,6); await sleep(16); }
      check(`F3 ${wid}: HOLDS FIRE when only walled targets exist (no blind spray)`, !anyFired && dmgOf(only) === beforeDmg, `fired ${anyFired}, walled dmg ${Math.round(dmgOf(only))}`);
    }
    // scarecrow TURRET: turret->enemy LOS (fires from the turret, not the player)
    {
      P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.player.position.set(0,0,0);
      P.setCornField((cx,cz,wx,wz) => wz > 1.5 && wz < 4.5 && Math.abs(wx) < 8);   // wall north of the turret
      P.enemies.length = 0;
      const walled = P.spawnEnemy("turtle", { at: [0, 6] });  walled.hp = walled.maxHp = 1e12;
      const open   = P.spawnEnemy("turtle", { at: [11, 0] }); open.hp = open.maxHp = 1e12;
      const w = P.setSoleWeapon("scarecrow"); w.deployTimer = 0; w.maxOut = 1;
      P.turrets.length = 0;
      // plant one turret at the origin and pin it there
      for (let i=0;i<40 && !P.turrets.length;i++){ P.weaponsUpdate(0.05); await sleep(16); }
      let hadTurret = P.turrets.length > 0;
      for (let i=0;i<140;i++){ for (const t of P.turrets){ t.mesh.position.set(0,0,0); } walled.mesh.position.set(0,0,6); open.mesh.position.set(11,0,0); await sleep(16); }
      check("F3 scarecrow turret: shoots the OPEN target through clear LOS, skips the walled one", hadTurret && dmgOf(open) > 0 && dmgOf(walled) === 0, `turret ${hadTurret}, open +${Math.round(dmgOf(open))}, walled +${Math.round(dmgOf(walled))}`);
    }

    // ================= FIX 4: ALL WEAPONS DEFAULT TO CLOSEST =================
    // Two OPEN enemies: a NEAR + WEAK one and a FAR + TOUGH one. The audited weapons used to pick the
    // TOUGHEST (far); now they must pick the CLOSEST (near). Assert the near one takes the damage.
    function closestSetup(){
      P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.player.position.set(0,0,0);
      P.clearAllCorn();
      P.enemies.length = 0;
      const near = P.spawnEnemy("rat",    { at: [4, 0] });  near.hp = near.maxHp = 1e12; near.maxHp = 100;      // closest, WEAK
      const far  = P.spawnEnemy("turtle", { at: [17, 0] }); far.hp  = far.maxHp  = 1e12; far.maxHp  = 1e9;      // farther, TOUGHER
      return { near, far };
    }
    for (const wid of ["pumpkin","cats","bolt","egg","milk"]){
      const { near, far } = closestSetup();
      const w = P.setSoleWeapon(wid); w.timer = 999; if (w.count!=null) w.count = 1;
      if (wid === "cats") P.cats.length = 0;
      for (let r=0;r<4;r++){ w.timer = 999; P.fireWeapon(w); for (let i=0;i<24;i++){ near.mesh.position.set(4,0,0); far.mesh.position.set(17,0,0); await sleep(16); } }
      check(`F4 ${wid}: targets the CLOSEST enemy (near WEAK hit, not the far TOUGH one)`, dmgOf(near) > 0 && dmgOf(near) > dmgOf(far), `near +${Math.round(dmgOf(near))}, far +${Math.round(dmgOf(far))}`);
    }

    return out;
  });

  // ---- screenshot proof: Tank Dillo whole after rolling ----
  let shotOk = false, shotPath = path.join(SHOTS, "pasture-dillo-fixed.png");
  try {
    await page.evaluate(async () => {
      const P = window.__PP__;
      P.meta.selStage = "home"; P.startGame(); await new Promise(r=>setTimeout(r,20)); P.clearAllCorn(); P.invulnT = 1e9;
      P.player.position.set(0,0,0); P.enemies.length = 0; P.bossIdx = 1; P.spawnBoss();
      const b = P.boss; b.hp = b.maxHp = 1e12;
      // run one full roll, then park it whole in front for the shot
      b.abTimer = 0;
      for (let i=0;i<260;i++){ await new Promise(r=>requestAnimationFrame(r));
        const arr=P.enemies; for(let j=arr.length-1;j>=0;j--) if(arr[j]!==b) arr.splice(j,1);
        if (b.abPhase === "dizzy" || (i>200 && b.abPhase==='idle')) break;
      }
      b.abTimer = 999; b.mesh.position.set(0,0,7);
      for (let i=0;i<30;i++) await new Promise(r=>requestAnimationFrame(r));
    });
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: shotPath });
    shotOk = fs.existsSync(shotPath);
  } catch(_){}
  res.push({ name: "F2i screenshot of the whole post-roll dillo written", pass: shotOk, detail: shotOk ? shotPath : "screenshot failed" });

  await page.close();
  return { checks: res, errors };
}

async function main(){
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", protocolTimeout: 300000, args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  let allOk = true;
  try {
    console.log("\n=== PASTURE PANIC — 4 PLAYTEST FIXES ===");
    const r = await run(browser);
    let ok = true;
    for (const c of r.checks){ const m = c.pass ? "PASS":"FAIL"; if (!c.pass) ok = false; console.log(`  [${m}] ${c.name}${c.detail!==""?"  ("+c.detail+")":""}`); }
    if (r.errors && r.errors.length){ ok = false; console.log(`  PAGE ERRORS (${r.errors.length}):`); for (const e of r.errors) console.log("    "+e); }
    const total = r.checks.length, pass_ = r.checks.filter(c=>c.pass).length;
    console.log(`  -> ${pass_}/${total} checks passed, ${(r.errors||[]).length} pageerrors`);
    if (!ok) allOk = false;
  } finally { await browser.close(); if (server) server.kill(); }
  console.log(allOk ? "\nALL PASSES GREEN" : "\nSOME CHECKS FAILED");
  process.exit(allOk ? 0 : 1);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
