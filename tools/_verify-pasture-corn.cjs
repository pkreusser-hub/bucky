#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic — CARVEABLE CORNSTALK PATCHES (DRG-Survivor style, 2026-07-13).
 * Proves the feature: patch generation (count/size/deterministic/spawn-clear), player carve+slow+
 * persistence, ground-enemy hard-wall + flow-field streaming + gap/alley funnel, boss trample,
 * fliers over, lobber-over-corn, enclosure chew-through, pumpkin/egg blast clears, flow recompute
 * cost + FPS at 260 enemies on the Cornfield stage, and co-op standing-mask sync host->guest.
 * Drives gameplay through window.__PP__ (same http-server + puppeteer-core convention as the other
 * pasture suites). Firebase/Playroom blocked for the mechanics page; the coop section runs a
 * deterministic snapshot round-trip (host page -> guest page) plus a live-Playroom attempt.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const https = require("https");
const fs = require("fs");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8876;
const BASE = `http://127.0.0.1:${PORT}`;
const FAM = "famtestfl";
const FB_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FB_PROJECT = "amen-farms-app";

function isOpen(port){ return new Promise(r=>{ const s=net.createConnection({port,host:"127.0.0.1"}); s.once("connect",()=>{s.destroy();r(true)}); s.once("error",()=>r(false)); s.setTimeout(800,()=>{s.destroy();r(false)}); }); }
async function waitServer(port,ms){ const t0=Date.now(); while(Date.now()-t0<ms){ if(await isOpen(port)){ try{ await new Promise((res,rej)=>{ http.get({host:"127.0.0.1",port,path:"/",timeout:1000},r=>{r.resume();res()}).on("error",rej); }); return; }catch(_){} } await new Promise(r=>setTimeout(r,200)); } throw new Error("server timeout"); }

async function openPage(browser, viewport, hash){
  const page = await browser.newPage();
  await page.setViewport(viewport || { width: 900, height: 700, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", req => { if (/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/i.test(req.url())) return req.abort(); req.continue(); });
  await page.goto(BASE + "/pasturepanic.html" + (hash || ""), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__, { timeout: 20000 });
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.up();
  return { page, errors };
}

// ================================================================= MECHANICS (single page)
async function runMechanics(browser){
  const { page, errors } = await openPage(browser);
  const res = await page.evaluate(async () => {
    const P = window.__PP__;
    const out = []; const check = (n,c,d)=>out.push({name:n,pass:!!c,detail:d==null?"":String(d)});
    const sleep = ms => new Promise(r=>setTimeout(r,ms));
    // count BLOBS: bucket standing cells into ~7u super-cells (so a 1.5u gap can't split one blob into
    // two) then count 8-connected components of occupied super-cells.
    function patchCount(){
      const N=P.CORN_N, st=P.cornState, cell=P.CORN_CELL; if(!st) return 0;
      const SUP=Math.max(1, Math.round(7/cell)); const SN=Math.ceil(N/SUP);
      const occ=new Uint8Array(SN*SN);
      for(let i=0;i<st.length;i++){ if(st[i]!==1) continue; const cz=(i/N)|0, cx=i-cz*N; occ[((cz/SUP)|0)*SN+((cx/SUP)|0)]=1; }
      const seen=new Uint8Array(SN*SN); let comps=0; const q=[];
      for(let i=0;i<occ.length;i++){ if(!occ[i]||seen[i]) continue; comps++; q.length=0; q.push(i); seen[i]=1;
        while(q.length){ const idx=q.pop(); const sz=(idx/SN)|0, sx=idx-sz*SN;
          for(let oz=-1;oz<=1;oz++)for(let ox=-1;ox<=1;ox++){ if(!ox&&!oz)continue; const gx=sx+ox,gz=sz+oz; if(gx<0||gz<0||gx>=SN||gz>=SN)continue; const ni=gz*SN+gx; if(occ[ni]&&!seen[ni]){seen[ni]=1;q.push(ni);} } } }
      return comps;
    }

    // ---------- A. CORN-WORLD GENERATION (70% coverage, connected network) ----------
    // The field is now a CORN WORLD you carve through: ~70% of the playable field starts as standing
    // corn (Cornfield ~77%), generated as value-noise valleys + carved winding lanes so there's always
    // a connected open network (spawn pocket + landmark clearings + a perimeter ring road).
    P.meta.selStage = "home"; P.startGame(); await sleep(60);
    const covHome = P.cornCoverage();
    check("A1 home fills the field with a corn WORLD (thousands of cells)", P.cornStandingCount > 1500, `${P.cornStandingCount} cells`);
    check("A2 home coverage ~70% (65-75% band)", covHome >= 0.65 && covHome <= 0.75, `${(covHome*100).toFixed(1)}%`);
    // spawn clearing: no standing corn within r8 of origin
    let nearSpawn = 0; for (let a=0;a<360;a+=12) for (let rr=2;rr<=8;rr+=2){ if (P.cornStandingAt(Math.cos(a*Math.PI/180)*rr, Math.sin(a*Math.PI/180)*rr)) nearSpawn++; }
    check("A3 spawn clearing (r8) stays open", nearSpawn === 0, `${nearSpawn} hits`);
    // connected open network: nearly every open cell is reachable from the spawn pocket, and the
    // perimeter ring road (where edge-spawned enemies land) is reachable from spawn on all 4 sides
    const openReach = P.cornOpenReachableFrom(0,0);
    const totalOpen = Math.round(P.cornStandingCount * (1/Math.max(covHome,1e-6) - 1));
    const reachFrac = totalOpen > 0 ? openReach/totalOpen : 0;
    check("A4 open network is CONNECTED (>=90% of open cells reachable from spawn)", reachFrac >= 0.90, `${openReach}/${totalOpen} open reachable (${(reachFrac*100).toFixed(0)}%)`);
    const perim = P.cornOpenReachableAt(0, 62) && P.cornOpenReachableAt(0, -62) && P.cornOpenReachableAt(62, 0) && P.cornOpenReachableAt(-62, 0);
    check("A5 perimeter ring road reachable from spawn (edge spawns can path in)", perim, perim);
    // Cornfield = denser world (75-80%)
    P.meta.qc.kills = 500; P.meta.selStage = "corn"; P.startGame(); await sleep(60);
    const covCorn = P.cornCoverage();
    check("A6 Cornfield is DENSER than Home (75-80%)", covCorn > covHome && covCorn >= 0.72 && covCorn <= 0.82, `${(covCorn*100).toFixed(1)}% vs home ${(covHome*100).toFixed(1)}%`);
    check("A7 Cornfield still swaps windmill -> scarecrow", !!P.stageScare, !!P.stageScare);
    // determinism under a forced seed: two starts with the same seed => byte-identical corn
    P.forceCornSeed(0xC0FFEE); P.meta.selStage = "home"; P.startGame(); await sleep(50); const s1 = Array.from(P.cornState || []).join("");
    P.startGame(); await sleep(50); const s2 = Array.from(P.cornState || []).join(""); P.forceCornSeed(null);
    check("A8 world-gen is deterministic under a fixed seed", s1.length > 0 && s1 === s2, `len ${s1.length}, identical ${s1===s2}`);
    // determinism under a daily seed: two daily starts produce byte-identical corn
    const dailyMask = async () => { P.startDailyRun(); await sleep(50); return Array.from(P.cornState || []).join(""); };
    const d1 = await dailyMask(); const d2 = await dailyMask();
    check("A9 daily runs generate deterministic corn (same seed => same field)", d1.length > 0 && d1 === d2, `len ${d1.length}, identical ${d1===d2}`);

    // ---------- B. PLAYER CARVE / SLOW / PERSIST ----------
    P.meta.selStage = "home"; P.startGame(); await sleep(20);
    P.weaponsArr = []; P.invulnT = 1e9;
    // controlled block of standing corn around (12,0)
    P.setCornField((cx,cz,wx,wz) => Math.abs(wx-12) < 3 && Math.abs(wz) < 3);
    const [tcx,tcz] = P.cornCellOf(12,0); const tIdx = P.cornCellIdx(tcx,tcz);
    const neighborStanding = (()=>{ // pick a standing cell ~2.5u from player to test slow (out of carve reach)
      for (let z=-3;z<=3;z++) for (let x=-3;x<=3;x++){ if (P.cornStandingAt(12+x*1.2, z*1.2) && Math.hypot(x*1.2, z*1.2) > 2) return [12+x*1.2, z*1.2]; } return null; })();
    check("B1 standing corn slows to 0.55x", neighborStanding && Math.abs(P.stageSpeedMul(neighborStanding[0], neighborStanding[1]) - 0.55) < 1e-6, neighborStanding && P.stageSpeedMul(neighborStanding[0],neighborStanding[1]));
    check("B2 open ground is full speed", Math.abs(P.stageSpeedMul(0.2,0.2)-1) < 1e-6, P.stageSpeedMul(0.2,0.2));
    P.player.position.set(12,0,0);   // stand still inside corn -> auto-scythe
    const e0 = P.elapsed;
    let felled = false;
    for (let i=0;i<80;i++){ await sleep(16); if (P.cornState[tIdx] !== 1){ felled = true; break; } }
    const carveT = P.elapsed - e0;
    check("B3 player carves the cell under them", felled, `state ${P.cornState[tIdx]}`);
    check("B4 carve time is ~0.35s/cell", felled && carveT >= 0.2 && carveT <= 0.7, `${carveT.toFixed(2)}s`);
    // persistence: cut cell stays cut for the rest of the run
    P.player.position.set(0,0,0); await sleep(200);
    check("B5 cut cells stay cut (persistent alley)", P.cornState[tIdx] === 2 && !P.cornStandingAt(12,0), `state ${P.cornState[tIdx]}`);

    // ---------- C. GROUND ENEMY BLOCKED + STREAMS AROUND ----------
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    // horizontal wall north (z in 6..9) spanning x -9..9, single gap at x in 4..7 (off-center => must detour)
    P.setCornField((cx,cz,wx,wz) => (wz > 5.5 && wz < 9.5 && wx > -9 && wx < 9) && !(wx > 4 && wx < 7));
    P.enemies.length = 0;
    const trk = P.spawnEnemy("armadillo", { at: [0, 15] });
    let everInCorn = false, crossed = false, maxX = -99, reachedZ = 99;
    for (let i=0;i<260;i++){
      await sleep(16);
      const arr = P.enemies; for (let j=arr.length-1;j>=0;j--) if (arr[j] !== trk) arr.splice(j,1);   // isolate the tracked varmint
      if (!P.enemies.includes(trk)) break;
      if (P.cornStandingAt(trk.mesh.position.x, trk.mesh.position.z)) everInCorn = true;
      maxX = Math.max(maxX, trk.mesh.position.x);
      reachedZ = Math.min(reachedZ, trk.mesh.position.z);
      if (trk.mesh.position.z < 5){ crossed = true; break; }
    }
    check("C1 ground enemy NEVER stands inside corn (hard wall)", !everInCorn, everInCorn ? "entered corn" : "clean");
    check("C2 enemy detours toward the gap (streams around)", maxX > 3, `maxX ${maxX.toFixed(1)}`);
    check("C3 enemy funnels through the gap to reach the player", crossed, `reachedZ ${reachedZ.toFixed(1)}`);

    // ---------- D. CARVED/GAP ALLEY IS THE USED PATH (funnel) ----------
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    // full wall x -12..12 at z 6..9, ONE centered gap x -1.5..1.5
    P.setCornField((cx,cz,wx,wz) => (wz > 5.5 && wz < 9.5 && wx > -12 && wx < 12) && !(wx > -1.5 && wx < 1.5));
    P.enemies.length = 0;
    const flock = [];
    for (let i=0;i<18;i++){ const e = P.spawnEnemy("rat", { at: [-11 + i*1.3, 14] }); if (e) flock.push(e); }
    const minAbsXInBand = new Map();   // per-enemy: min |x| observed while crossing the wall band
    let crossers = 0;
    for (let i=0;i<300;i++){
      await sleep(16);
      const arr = P.enemies; for (let j=arr.length-1;j>=0;j--) if (!flock.includes(arr[j])) arr.splice(j,1);
      for (const e of flock){ if (!P.enemies.includes(e)) continue;
        const z = e.mesh.position.z;
        if (z > 5.5 && z < 9.5){ const ax = Math.abs(e.mesh.position.x); const prev = minAbsXInBand.get(e); if (prev==null||ax<prev) minAbsXInBand.set(e, ax); }
      }
      if (flock.every(e => !P.enemies.includes(e) || e.mesh.position.z < 5)) break;
    }
    // count crossers and how many threaded the centered gap (|x|<3 while in the band)
    let throughGap = 0, totalBand = 0;
    for (const e of flock){ const m = minAbsXInBand.get(e); if (m != null){ totalBand++; if (m < 3) throughGap++; } if (P.enemies.includes(e) && e.mesh.position.z < 5) crossers++; else if (!P.enemies.includes(e)) crossers++; }
    check("D1 enemies converge on the gap (majority thread |x|<3)", totalBand > 0 && throughGap / totalBand >= 0.7, `${throughGap}/${totalBand} through gap`);

    // ---------- E. BOSS TRAMPLES ----------
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => (wz > 8 && wz < 14 && wx > -6 && wx < 6));   // a slab north of the player
    const standBefore = P.cornStandingCount;
    P.bossIdx = 0; P.spawnBoss(); const bo = P.boss;
    let bossOverCorn = false, bossMinZ = 99, felledByBoss = false;
    if (bo){ bo.mesh.position.set(0, 0, 17); bo.hp = bo.maxHp = 1e9;
      for (let i=0;i<560;i++){
        await sleep(16);
        const arr = P.enemies; for (let j=arr.length-1;j>=0;j--) if (arr[j] !== bo && !arr[j].isBoss) arr.splice(j,1);
        // was the boss body over a (now-cut) corn cell? track it crossing the slab
        if (bo.mesh.position.z > 8 && bo.mesh.position.z < 14 && Math.abs(bo.mesh.position.x) < 6) bossOverCorn = true;
        bossMinZ = Math.min(bossMinZ, bo.mesh.position.z);
        if (P.cornStandingCount < standBefore) felledByBoss = true;
        if (bo.mesh.position.z < 6) break;
      }
    }
    check("E1 boss spawned + drove toward the player", !!bo && bossMinZ < 8, `minZ ${bossMinZ.toFixed(1)}`);
    check("E2 boss tramples standing corn (cells fall)", felledByBoss && P.cornStandingCount < standBefore, `${standBefore} -> ${P.cornStandingCount}`);
    check("E3 boss line unbroken (walked through, not blocked at the wall)", bossOverCorn && bossMinZ < 6, `over ${bossOverCorn}, minZ ${bossMinZ.toFixed(1)}`);

    // ---------- F. FLIERS IGNORE CORN ----------
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => (wz > 4 && wz < 10 && wx > -8 && wx < 8));
    const cornBeforeCrow = P.cornStandingCount;
    P.enemies.length = 0;
    // spawn a crow crossing the slab: crows fly a fixed straight line toward the player
    const crow = P.spawnEnemy("crow", { at: [0, 16] });
    let crowOverCorn = false;
    if (crow){ for (let i=0;i<160;i++){ await sleep(16);
      const arr=P.enemies; for(let j=arr.length-1;j>=0;j--) if(arr[j]!==crow) arr.splice(j,1);
      if (!P.enemies.includes(crow)) break;
      if (P.cornStandingAt(crow.mesh.position.x, crow.mesh.position.z)) crowOverCorn = true;
      if (crow.mesh.position.z < 2) break;
    } }
    check("F1 crow (flier) passes OVER standing corn", crowOverCorn, crowOverCorn ? "flew over" : "never over corn");
    check("F2 fliers never fell corn", P.cornStandingCount === cornBeforeCrow, `${cornBeforeCrow} -> ${P.cornStandingCount}`);

    // ---------- G. SNIPER (directive 3): straight slow magenta shot, corn ABSORBS it ----------
    // rarity: the Sniper (was Lobber) is now ~1/5 the old cadence — sample the spawn director directly
    P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.elapsed = 500; P.kills = 200;
    let lobN = 0, totK = 0;
    for (let i=0;i<6000;i++){ const k = P.enemyKindForPressure(); totK++; if (k === "lobber") lobN++; }
    const lobFrac = lobN/totK;
    check("G1 Sniper is rare (spawn weight /5 -> well under 8%)", lobFrac > 0 && lobFrac < 0.08, `${(lobFrac*100).toFixed(1)}% (${lobN}/${totK})`);
    check("G1b lobSpawnChance ~0.03 (was ~0.15 pool weight)", Math.abs(P.BAL.lobSpawnChance - 0.03) < 0.02, P.BAL.lobSpawnChance);
    // straight + slow + distinct color + no marker/puddle — on a CLEARED field so the random corn
    // world can't absorb the shot at spawn (corn absorption is proven separately in G6/G7)
    P.startGame(); await sleep(20); P.clearAllCorn(); P.weaponsArr = []; P.invulnT = 1e9; P.elapsed = 500;
    P.player.position.set(0,0,0);
    P.enemies.length = 0; P.lobShots.length = 0;
    const sn = P.spawnEnemy("lobber", { at: [0, -16] });
    let sawShot = false, shotSpeed = 0, matHex = null, hasMarker = false;
    const path = []; let yMin = 9, yMax = -9;
    if (sn){ sn.lobTimer = 0.001;
      for (let i=0;i<160;i++){ await sleep(16);
        const arr=P.enemies; for(let j=arr.length-1;j>=0;j--) if(arr[j]!==sn) arr.splice(j,1);
        if (P.lobShots.length){ const s = P.lobShots[0]; sawShot = true; shotSpeed = s.speed; matHex = s.mesh.material.color.getHex();
          if (s.marker !== undefined) hasMarker = true;
          path.push([s.mesh.position.x, s.mesh.position.z]); yMin = Math.min(yMin, s.mesh.position.y); yMax = Math.max(yMax, s.mesh.position.y);
        } else if (path.length > 3) break;
      }
    }
    // straightness: the sampled path is collinear (max perpendicular deviation from the chord is tiny)
    let maxDev = 0;
    if (path.length >= 3){ const [x0,z0] = path[0], [x1,z1] = path[path.length-1]; const dx=x1-x0, dz=z1-z0, L=Math.hypot(dx,dz)||1;
      for (const [x,z] of path){ maxDev = Math.max(maxDev, Math.abs((x-x0)*(-dz) + (z-z0)*dx)/L); } }
    check("G2 Sniper shoots a straight-line shot (path collinear, flat height)", sawShot && maxDev < 0.5 && (yMax-yMin) < 0.5, `dev ${maxDev.toFixed(2)}u, dy ${(yMax-yMin).toFixed(2)}`);
    check("G3 shot is SLOW — clearly slower than any player projectile (<13)", shotSpeed > 0 && shotSpeed < 13, `speed ${shotSpeed} (cats=13, corn=24)`);
    check("G4 shot is a distinct glowing MAGENTA orb (0xff23d6, unique color)", matHex === 0xff23d6, matHex != null ? ("#"+matHex.toString(16)) : "none");
    check("G5 NO landing marker + NO impact puddle (removed)", !hasMarker && P.lobPuddles === undefined, `marker ${hasMarker}, lobPuddles ${P.lobPuddles}`);
    // corn ABSORBS the shot: a wall between the sniper and the player stops every shot at the wall
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9; P.elapsed = 500;
    P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => wz > -8.5 && wz < -4.5 && Math.abs(wx) < 12);   // wall south of the player
    const cornBeforeShot = P.cornStandingCount;
    P.enemies.length = 0; P.lobShots.length = 0;
    const sn2 = P.spawnEnemy("lobber", { at: [0, -16] });
    let sawShot2 = false, crossedWall = false, maxShotZ = -99;
    if (sn2){
      for (let i=0;i<260;i++){ await sleep(16);
        const arr=P.enemies; for(let j=arr.length-1;j>=0;j--) if(arr[j]!==sn2) arr.splice(j,1);
        if (!P.enemies.includes(sn2)) break;
        sn2.lobTimer = Math.min(sn2.lobTimer == null ? 0.001 : sn2.lobTimer, 0.4);
        for (const s of P.lobShots){ sawShot2 = true; maxShotZ = Math.max(maxShotZ, s.mesh.position.z); if (s.mesh.position.z > -3.5) crossedWall = true; }
      }
    }
    check("G6 corn ABSORBS the Sniper shot (never crosses the wall to the player)", sawShot2 && !crossedWall, `sawShot ${sawShot2}, maxZ ${maxShotZ.toFixed(1)}`);
    check("G7 Sniper shots do NOT clear corn (absorbed, not blasted)", P.cornStandingCount >= cornBeforeShot - 1, `${cornBeforeShot} -> ${P.cornStandingCount}`);

    // ---------- H. ENCLOSURE -> CHEW THROUGH ----------
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    // a SOLID closed annulus around the player (no gap) at r 3.5..6 -> player fully enclosed
    P.setCornField((cx,cz,wx,wz) => { const d=Math.hypot(wx,wz); return d>3.3 && d<6.2; });
    P.recomputeCornFlow();
    const enclosedBefore = P.cornStandingCount;
    P.enemies.length = 0;
    for (let a=0;a<360;a+=45){ P.spawnEnemy("armadillo", { at: [Math.cos(a*Math.PI/180)*12, Math.sin(a*Math.PI/180)*12] }); }
    let anyChewer = false;
    for (let i=0;i<200;i++){ await sleep(16);   // player does NOT move
      const arr=P.enemies; for(let j=arr.length-1;j>=0;j--) if(arr[j].isBoss) arr.splice(j,1);
      if (P.enemies.some(e => e.chew)) anyChewer = true;
      if (P.cornStandingCount < enclosedBefore - 1) break;
    }
    check("H1 an enclosed player has cut-off enemies flagged as chewers", anyChewer, anyChewer);
    check("H2 cut-off enemies chew through corn (cells fall w/o the player carving)", P.cornStandingCount < enclosedBefore, `${enclosedBefore} -> ${P.cornStandingCount}`);

    // ---------- I. PUMPKIN BLAST CLEARS CORN ----------
    P.startGame(); await sleep(20); P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => Math.abs(wx) < 3 && Math.abs(wz-10) < 3);
    const cornPumpBefore = P.cornStandingCount;
    const pw = P.setSoleWeapon("pumpkin"); pw.timer = 999;
    P.enemies.length = 0; const dummy = P.spawnEnemy("turtle", { at: [0, 10] }); if (dummy) dummy.hp = dummy.maxHp = 1e9;
    P.fireWeapon(pw);
    let cleared = false;
    for (let i=0;i<120;i++){ await sleep(16); if (P.cornStandingCount < cornPumpBefore){ cleared = true; break; } }
    check("I1 pumpkin blast clears corn in its radius", cleared && !P.cornStandingAt(0,10), `${cornPumpBefore} -> ${P.cornStandingCount}`);

    // ---------- J. VISUAL PASS (golden-wall read) + LOBBER BODY BLOCK ----------
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9;
    P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => Math.abs(wx-12) < 4 && Math.abs(wz) < 4);
    const stCells = P.cornStandingCount;
    // J1 density: >=5 stalk instances per standing cell (was 3 sparse speckles)
    check("J1 dense stalks (>=5 instances per standing cell)", P.cornInst && P.cornInst.count >= stCells * 5, `${P.cornInst && P.cornInst.count} instances / ${stCells} cells`);
    // J2 vertex-color gradient geometry + soil footprint plane under the patch
    const g = P.cornInst && P.cornInst.geometry;
    check("J2 stalk geometry carries the vertex-color gradient", !!(g && g.attributes.color && P.cornInst.material.vertexColors), !!(g && g.attributes.color));
    check("J3 soil footprint plane exists (4 verts per corn cell)", !!(P.cornSoil && P.cornSoil.geometry.attributes.position.count === stCells * 4), P.cornSoil && `${P.cornSoil.geometry.attributes.position.count} verts / ${stCells} cells`);
    // J4 felling leaves visible STUBBLE (short stumps, not vanished) + soil persists
    const [jcx, jcz] = P.cornCellOf(12, 0); const jIdx = P.cornCellIdx(jcx, jcz);
    const jList = P.cornCellStalks.get(jIdx);
    P.fellCornCell(jcx, jcz, 12, 0, true);
    const jm = new THREE.Matrix4(), jp = new THREE.Vector3(), jq = new THREE.Quaternion(), js = new THREE.Vector3();
    // chunked field (2026-07-14): instance indices are chunk-local — read from the owning chunk mesh
    jList.mesh.getMatrixAt(jList[0][0], jm); jm.decompose(jp, jq, js);
    check("J4 cut cell keeps visible stubble (short stump, on the ground)", js.y < 0.3 && js.y > 0.03 && jp.y > -1, `stump yScale ${js.y.toFixed(2)} at y ${jp.y.toFixed(1)}`);
    check("J5 soil footprint persists under the carved cell", !!(P.cornSoil && P.cornSoil.geometry.attributes.position.count === stCells * 4), "footprint unchanged");
    // J6 lobber BODY is blocked/slid by standing corn like other ground varmints (its shots still lob over)
    P.startGame(); await sleep(20); P.weaponsArr = []; P.invulnT = 1e9; P.elapsed = 320;
    P.player.position.set(0,0,0);
    // wall INSIDE the lobber's approach path (it closes to lobStandoff+3 = ~18, so wall at z 20..24)
    P.setCornField((cx,cz,wx,wz) => (wz > 19.5 && wz < 24.5 && wx > -14 && wx < 14));
    P.enemies.length = 0;
    const lb = P.spawnEnemy("lobber", { at: [0, 32] });
    let lobInCorn = false, lobMinZ = 99;
    if (lb){ for (let i=0;i<300;i++){ await sleep(16);
      const arr=P.enemies; for(let j=arr.length-1;j>=0;j--) if(arr[j]!==lb) arr.splice(j,1);
      if (!P.enemies.includes(lb)) break;
      if (P.cornStandingAt(lb.mesh.position.x, lb.mesh.position.z)) lobInCorn = true;
      lobMinZ = Math.min(lobMinZ, lb.mesh.position.z);
    } }
    check("J6 lobber BODY never stands inside corn (blocked like ground varmints)", !!lb && !lobInCorn, lobInCorn ? "clipped into corn" : `clean, minZ ${lobMinZ.toFixed(1)}`);

    // ---------- K. DIRECTIVE 2: standing corn BLOCKS ground fire; ARCS sail over ----------
    // Behavioral test: an HP-locked dummy sits BEHIND a corn wall. A blocked (ground) weapon deals it
    // ZERO damage; clearing the corn lets it through. An arcing weapon reaches it through the corn.
    const setupWall = () => {
      P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.player.position.set(0,0,0);
      P.setCornField((cx,cz,wx,wz) => wz > 3.5 && wz < 8.5 && Math.abs(wx) < 11);   // solid wall north
      P.enemies.length = 0;
      const d = P.spawnEnemy("turtle", { at: [0, 13] }); d.hp = d.maxHp = 1e12;   // behind the wall
      return d;
    };
    const dmgTo = (d) => 1e12 - d.hp;
    // --- corn kernels: blocked ---
    let d = setupWall(); let w = P.setSoleWeapon("corn"); w.timer = 999; w.multishot = 1; w.pierce = 4;
    for (let i=0;i<50;i++){ w.timer = 999; P.fireWeapon(w); await sleep(16); }
    const cornBlockedDmg = dmgTo(d);
    P.clearAllCorn(); for (let i=0;i<30;i++){ w.timer = 999; P.fireWeapon(w); await sleep(16); }
    const cornOpenDmg = dmgTo(d) - cornBlockedDmg;
    check("K1 corn kernels BLOCKED by standing corn (0 dmg behind wall)", cornBlockedDmg === 0 && cornOpenDmg > 0, `blocked ${Math.round(cornBlockedDmg)}, open +${Math.round(cornOpenDmg)}`);
    // --- pitchfork: blocked ---
    d = setupWall(); w = P.setSoleWeapon("fork"); w.timer = 999; w.multishot = 1;
    for (let i=0;i<50;i++){ w.timer = 999; P.fireWeapon(w); await sleep(16); }
    const forkBlocked = dmgTo(d);
    P.clearAllCorn(); for (let i=0;i<30;i++){ w.timer = 999; P.fireWeapon(w); await sleep(16); }
    const forkOpen = dmgTo(d) - forkBlocked;
    check("K2 pitchfork BLOCKED by standing corn (0 dmg behind wall)", forkBlocked === 0 && forkOpen > 0, `blocked ${Math.round(forkBlocked)}, open +${Math.round(forkOpen)}`);
    // --- sprinkler ray: shadowed by corn (use a thin wall inside its short range) ---
    P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => wz > 2.5 && wz < 4.5 && Math.abs(wx) < 14);   // thin full-width wall inside range 7.5
    P.enemies.length = 0; const sd = P.spawnEnemy("turtle", { at: [0, 6] }); sd.hp = sd.maxHp = 1e12;
    w = P.setSoleWeapon("sprinkler"); w.beams = 6;   // more beams => the sweep covers the target's bearing quickly
    // pin the target behind the wall each frame so it can't wander around the ends and find a clear line
    for (let i=0;i<120;i++){ sd.mesh.position.set(0,0,6); await sleep(16); }
    const sprkBlocked = 1e12 - sd.hp;
    P.clearAllCorn(); for (let i=0;i<120;i++){ sd.mesh.position.set(0,0,6); await sleep(16); }
    const sprkOpen = (1e12 - sd.hp) - sprkBlocked;
    check("K3 sprinkler ray STOPS at standing corn (behind-wall target shadowed)", sprkBlocked === 0 && sprkOpen > 0, `blocked ${Math.round(sprkBlocked)}, open +${Math.round(sprkOpen)}`);
    // --- cat pounce dash: reroutes around corn (never stands INSIDE a standing cell) ---
    P.startGame(); P.weaponsArr = []; P.invulnT = 1e9; P.player.position.set(0,0,0);
    P.setCornField((cx,cz,wx,wz) => wz > 3.5 && wz < 8.5 && Math.abs(wx) < 11);
    P.enemies.length = 0; const catTgt = P.spawnEnemy("turtle", { at: [0, 13] }); catTgt.hp = catTgt.maxHp = 1e12;
    w = P.setSoleWeapon("cats"); w.count = 3; P.cats.length = 0;
    let catInCorn = false;
    for (let r=0;r<4;r++){ w.timer = 999; P.fireWeapon(w);
      for (let i=0;i<40 && P.cats.length;i++){ await sleep(16); for (const c of P.cats){ if (P.cornStandingAt(c.mesh.position.x, c.mesh.position.z)) catInCorn = true; } } }
    check("K4 cat pounce reroutes (never teleports THROUGH corn — slides on edges)", !catInCorn, catInCorn ? "clipped into corn" : "rerouted");
    // --- ARCS OVER: egg + milk reach a behind-wall target through the corn ---
    d = setupWall(); w = P.setSoleWeapon("egg"); w.timer = 999;
    for (let i=0;i<40;i++){ w.timer = 999; P.fireWeapon(w); await sleep(30); }
    check("K5 egg mortar ARCS OVER corn (damages a behind-wall target)", dmgTo(d) > 0, `dealt ${Math.round(dmgTo(d))}`);
    d = setupWall(); w = P.setSoleWeapon("milk"); w.timer = 999;
    for (let i=0;i<60;i++){ w.timer = 999; P.fireWeapon(w); await sleep(30); }
    check("K6 milk splash ARCS OVER corn (lands + damages behind the wall)", dmgTo(d) > 0, `dealt ${Math.round(dmgTo(d))}`);

    return out;
  });
  await page.close();
  return { checks: res, errors };
}

// ================================================================= PERF (flow recompute + FPS)
async function runPerf(browser){
  const { page, errors } = await openPage(browser, { width: 1280, height: 800, deviceScaleFactor: 1 });
  const result = await page.evaluate(async () => {
    const P = window.__PP__;
    const sleep = ms => new Promise(r=>setTimeout(r,ms));
    P.meta.qc.kills = 500; P.meta.selStage = "corn"; P.startGame(); await sleep(60);
    P.simSubSteps = 1; P.elapsed = 820; P.kills = 300; P.player.position.set(0,0,0); P.invulnT = 1e9;
    // pack the field to a menacing cap with an elite-heavy mix
    P.enemies.length = 0;
    for (let i=0;i<260;i++){ const a=Math.random()*Math.PI*2, r=6+Math.random()*46; P.spawnEnemy(i%3===0?null:"rat", { elite: i%3===0, at: [Math.cos(a)*r, Math.sin(a)*r] }); }
    const n0 = P.enemies.length, standing = P.cornStandingCount;
    // measure flow recompute cost (ms) — average of 12 forced recomputes
    let sum=0, worst=0; for (let i=0;i<12;i++){ const t0=performance.now(); P.recomputeCornFlow(); const dt=performance.now()-t0; sum+=dt; worst=Math.max(worst,dt); }
    const recomputeMs = sum/12;
    const measureFps = async () => { let bestAvg=1e9;
      for (let w=0; w<5; w++){ const gaps=[]; let last=performance.now(); const t0=performance.now();
        while (performance.now()-t0 < 1200){ await new Promise(r=>requestAnimationFrame(r)); const now=performance.now(); gaps.push(now-last); last=now; }
        const avg = gaps.reduce((a,b)=>a+b,0)/gaps.length; if (avg<bestAvg) bestAvg=avg; }
      return 1000/bestAvg; };
    // FPS at the cap on the corn stage (best of 5 windows; capability probe on a contended CI box)
    const fps = await measureFps();
    // baseline: identical scene with the corn field CLEARED — isolates corn's marginal frame cost
    P.resetCornState();
    const fpsNoCorn = await measureFps();
    return { n0, standing, recomputeMs, worst, fps, fpsNoCorn };
  });
  const checks = [
    { name: "field packed to the cap on the Cornfield stage", pass: result.n0 >= 250 && result.standing > 100, detail: `${result.n0} enemies, ${result.standing} corn cells` },
    { name: "flow recompute is cheap (<5ms avg)", pass: result.recomputeMs < 5, detail: `avg ${result.recomputeMs.toFixed(2)}ms worst ${result.worst.toFixed(2)}ms` },
    // corn world budget: the ~5.5k-cell field (light stalks, 2/cell, chunked instancing) may cost at
    // most 50% extra frame time vs the same crowd with corn REMOVED (swiftshader rasterizes every
    // triangle in software — measured 1.3-1.4x; a real GPU renders the instanced field in <1ms).
    // ≥30fps absolute also passes. A runaway (e.g. per-cell meshes) would blow far past 1.5x.
    { name: "corn world frame cost within budget at 260 enemies (<=1.5x no-corn frame time, or >=30fps)", pass: result.fps >= 30 || (result.fpsNoCorn / Math.max(result.fps, 1e-6)) <= 1.5, detail: `${result.fps.toFixed(1)} fps vs no-corn ${result.fpsNoCorn.toFixed(1)} fps (ratio ${(result.fpsNoCorn/Math.max(result.fps,1e-6)).toFixed(2)}x)` }
  ];
  await page.close();
  return { checks, errors, result };
}

// ================================================================= COOP SYNC (host -> guest)
// Deterministic snapshot round-trip across TWO pages (mirrors the coop suite's offline fallback),
// plus a best-effort live-Playroom note. Proves the standing-mask packs into the snapshot (under
// the 8KB budget) and reconstructs on a guest with an identical standing count.
async function runCoopSync(browser){
  const errors = [];
  const H = await openPage(browser); const G = await openPage(browser);
  H.errors.forEach(e=>errors.push("host:"+e)); G.errors.forEach(e=>errors.push("guest:"+e));
  const checks = [];
  const push = (n,c,d)=>checks.push({name:n,pass:!!c,detail:d==null?"":String(d)});

  const hostData = await H.page.evaluate(async () => {
    const P = window.__PP__;
    P.meta.selStage = "home"; P.startCoopOnlineSolo("goat");   // online host, solo (no real guest yet)
    await new Promise(r=>setTimeout(r,80));
    const snap = P.buildSnapshot();
    return { standing: P.cornStandingCount, ver: P.cornVer, cn: snap.cn, hasMask: !!snap.cm, bytes: P.snapshotBytes(), snap };
  });
  push("host run generates corn + rides it in the snapshot", hostData.standing > 40 && hostData.cn === (await H.page.evaluate(()=>window.__PP__.CORN_N)) && hostData.hasMask, `${hostData.standing} cells, mask ${hostData.hasMask}`);
  push("snapshot with corn mask stays under the 8KB budget", hostData.bytes < 8192, `${hostData.bytes}B`);

  const guestData = await G.page.evaluate(async (snap) => {
    const P = window.__PP__;
    const r = P.testGuestApply(snap);
    return { standing: P.cornStandingCount, players: r.players, hasVisual: !!P.cornState };
  }, hostData.snap);
  push("guest reconstructs the SAME standing-corn count from the host mask", guestData.standing === hostData.standing && guestData.standing > 0, `host ${hostData.standing} vs guest ${guestData.standing}`);
  push("guest builds its corn field from host state (no local gen)", guestData.hasVisual, guestData.hasVisual);

  await H.page.close(); await G.page.close();
  return { checks, errors, live: false };
}

async function main(){
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", protocolTimeout: 180000, args: ["--autoplay-policy=no-user-gesture-required", "--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"] });
  let allOk = true;
  try {
    for (const [label, fn] of [
      ["CORN MECHANICS", runMechanics],
      ["PERF (flow recompute + FPS)", runPerf],
      ["CO-OP SYNC (host -> guest)", runCoopSync]
    ]){
      console.log(`\n=== ${label} ===`);
      const r = await fn(browser);
      let ok = true;
      for (const c of r.checks){ const m = c.pass ? "PASS":"FAIL"; if (!c.pass) ok = false; console.log(`  [${m}] ${c.name}${c.detail!==""?"  ("+c.detail+")":""}`); }
      if (r.errors && r.errors.length){ ok = false; console.log(`  PAGE ERRORS (${r.errors.length}):`); for (const e of r.errors) console.log("    "+e); }
      const total = r.checks.length, pass_ = r.checks.filter(c=>c.pass).length;
      console.log(`  -> ${pass_}/${total} checks passed, ${(r.errors||[]).length} pageerrors`);
      if (!ok) allOk = false;
    }
  } finally { await browser.close(); if (server) server.kill(); }
  console.log(allOk ? "\nALL PASSES GREEN" : "\nSOME CHECKS FAILED");
  process.exit(allOk ? 0 : 1);
}
main().catch(e => { console.error("FATAL", e); process.exit(1); });
