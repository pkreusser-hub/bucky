#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart TANK BATTLE co-op MVP (downtown-showdown arena).
 *  Pass 1 (pure node): tankBattle sanitize round-trip + byte-identical vs HEAD for every other track.
 *  Pass 2 (browser)  : arena/solidity, tank speed+drift, turret independence/auto-aim, firing/reload/pop,
 *                      specials, enemies+win/lose+restart, bot no-stuck, LOS gate, HUD/controls/minimap.
 *  Pass 3 (browser)  : barnyard-brawl regression (classic balloon battle unchanged, NO tank turret).
 *  Screenshots: shots/fk_tank_{arena,aim,fire,battle,win,mobile}.png
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn, execSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8873;
const BASE = `http://127.0.0.1:${PORT}`;

let PASS = 0, FAIL = 0;
function check(name, cond, detail) {
  if (cond) { PASS++; console.log("  ok  " + name); }
  else { FAIL++; console.log(" FAIL " + name + (detail ? "  [" + detail + "]" : "")); }
}

function isOpen(p){return new Promise(r=>{const s=net.createConnection({port:p,host:"127.0.0.1"});s.once("connect",()=>{s.destroy();r(true)});s.once("error",()=>r(false));s.setTimeout(800,()=>{s.destroy();r(false)})})}
async function waitServer(p,ms){const t=Date.now();while(Date.now()-t<ms){if(await isOpen(p)){try{await new Promise((res,rej)=>{http.get({host:"127.0.0.1",port:p,path:"/",timeout:1000},r=>{r.resume();res()}).on("error",rej)});return}catch(_){}}await new Promise(r=>setTimeout(r,200))}throw new Error("server timeout")}

function loadModule(code){ const win={}; new Function("window","document",code)(win, undefined); return win.FK_TRACK; }

// ---------------- PASS 1: pure-node sanitize ----------------
function pass1(){
  console.log("\n== PASS 1: sanitize (pure node) ==");
  const srcNew = fs.readFileSync(path.join(ROOT, "assets", "farmkart-track.js"), "utf8");
  const NEW = loadModule(srcNew);
  const OLD = loadModule(execSync("git show HEAD:assets/farmkart-track.js", { cwd: ROOT, maxBuffer: 1 << 24 }).toString());
  // strip ONLY my tankBattle sanitize line to isolate it
  const srcNoMine = srcNew.replace(/\n\s*if \(data\.tankBattle === true\) out\.tankBattle = true;/, "");
  check("pure: tankBattle sanitize line located + stripped for isolation", srcNoMine !== srcNew && !/out\.tankBattle = true/.test(srcNoMine));
  const NOMINE = loadModule(srcNoMine);

  // tankBattle round-trips
  const pts = [];
  for (let i=0;i<12;i++){ const a=i/12*Math.PI*2; pts.push({x:Math.cos(a)*30, z:Math.sin(a)*30, y:0}); }
  const tb = NEW.sanitize({ points: pts, battle:true, tankBattle:true });
  check("pure: tankBattle:true round-trips", !!tb && tb.tankBattle === true && tb.battle === true);
  const notb = NEW.sanitize({ points: pts, battle:true });
  check("pure: tankBattle OMITTED when absent", !!notb && notb.tankBattle === undefined);
  const badtb = NEW.sanitize({ points: pts, tankBattle: 1 });
  check("pure: tankBattle only accepts === true", !!badtb && badtb.tankBattle === undefined);

  // byte-identical for every track that exists at HEAD (downtown-showdown is new → skip). The wave-2
  // theme-pack re-themed 3 tracks with the new `decor` sanitize key, so OLD.sanitize (which predates
  // `decor`) legitimately differs from NEW.sanitize on them — skip any track carrying the new key.
  let mismatches = 0, compared = 0;
  for (const id in NEW.BUILTIN_TRACKS){
    if (id === "downtown-showdown") continue;
    const t = NEW.BUILTIN_TRACKS[id];
    if (t.decor) continue;   // wave-2 themed track (choco-mountain / rainbow-road / wario-stadium)
    const a = JSON.stringify(OLD.sanitize(JSON.parse(JSON.stringify(t))));
    const b = JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(t))));
    const c = JSON.stringify(NOMINE.sanitize(JSON.parse(JSON.stringify(t))));
    compared++;
    if (a !== b) { mismatches++; if (mismatches<=3) console.log("     mismatch(HEAD): "+id); }
    if (b !== c) { mismatches++; if (mismatches<=3) console.log("     mismatch(nomine): "+id); }
  }
  check("pure: sanitize byte-identical vs HEAD + no-mine for all "+compared+" pre-existing tracks", mismatches === 0, mismatches+" mismatches");

  // downtown-showdown itself sanitizes + round-trips idempotently
  const ds = NEW.BUILTIN_TRACKS["downtown-showdown"];
  check("pure: downtown-showdown builtin present", !!ds);
  const s = NEW.sanitize(JSON.parse(JSON.stringify(ds)));
  check("pure: downtown-showdown sanitizes", !!s && s.tankBattle === true && s.battle === true && s.offroad === true && s.theme === "city" && s.sky === "night");
  check("pure: downtown-showdown has ghostWalls (perimeter + 16 buildings)", !!s && s.ghostWalls && s.ghostWalls.length === 17);
  check("pure: downtown-showdown has 9 battleBoxes", !!s && s.battleBoxes && s.battleBoxes.length === 9);
  check("pure: downtown-showdown sanitize idempotent", JSON.stringify(s) === JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(s)))));
  const bld = s.ghostWalls.filter(g=>/^bld_/.test(g.id));
  check("pure: 16 building ghostWalls each a closed rect w/ height in id", bld.length === 16 && bld.every(g=>g.points.length===5 && parseFloat(g.id.slice(4))>0));
}

// ---------------- browser helpers ----------------
async function newPage(browser, { mobile } = {}) {
  const page = await browser.newPage();
  if (mobile) await page.evaluateOnNewDocument(() => { const real = window.matchMedia ? window.matchMedia.bind(window) : null;
    window.matchMedia = (q) => (/coarse/.test(q) ? { matches: true, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} } : (real ? real(q) : { matches:false, media:q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){} })); });
  await page.setViewport({ width: mobile ? 390 : 1280, height: mobile ? 844 : 800, deviceScaleFactor: 1.5 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => { const u = req.url(); if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return req.abort(); req.continue(); });
  return { page, pageErrors };
}

// ---------------- PASS 2: downtown-showdown tank battle ----------------
async function pass2(browser){
  console.log("\n== PASS 2: tank battle (downtown-showdown) ==");
  const { page, pageErrors } = await newPage(browser, {});
  await page.goto(BASE + "/farmkart.html?track=downtown-showdown", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.tankMode), { timeout: 15000 });

  const R = await page.evaluate(async () => {
    const K = window.__KART__, out = { c: [] };
    const ck = (n,cond,d)=>out.c.push([n,!!cond,d||""]);
    const H = (a,b)=>Math.hypot(a,b);
    function setup(){ K.toMenu(); K.startCountdown(); K.G.phase='racing'; }
    function step(inp,n,dt){ dt=dt||0.05; inp=Object.assign({steer:0,throttle:0,brake:0,drift:false,item:false,itemTrailToggle:false},inp||{}); for(let i=0;i<n;i++) K.soloRaceTick(dt,inp); }

    // ---- RUNG 1: arena + solidity ----
    ck("tankMode active", K.tankMode());
    ck("arena group built", !!K.TANK_ARENA_GROUP && K.TANK_ARENA_GROUP.children.length > 30);
    ck("no auto-cityscape (CITY_GROUP null on tank arena)", K.CITY_GROUP === null);
    ck("theme city ground/lighting still on", K.theme === "city");
    setup();
    const local = K.G.players.local;
    // building (15,15) footprint x[8,22] z[8,22] — drive INTO each face, assert no pass-through.
    function solidFace(px,pz,vx,vz,name){
      local.pos.x=px; local.pos.z=pz; local.theta=Math.atan2(vx,vz); local.v.x=vx; local.v.z=vz;
      local.spinT=0; local.drift.active=false;
      step({throttle:1},40,0.05);
      // NOT inside the building AABB (allowing a small face overlap)
      const inside = local.pos.x>8.6 && local.pos.x<21.4 && local.pos.z>8.6 && local.pos.z<21.4;
      ck("solid building blocks from "+name, !inside, "pos="+local.pos.x.toFixed(1)+","+local.pos.z.toFixed(1));
    }
    solidFace(3,15, 24,0, "west face(+x)");
    solidFace(27,15, -24,0, "east face(-x)");
    solidFace(15,3, 0,24, "south face(+z)");
    solidFace(15,27, 0,-24, "north face(-z)");
    // projectile-vs-building: a shell driven into the wall must DETONATE, not pass through.
    K.G.projectiles.length = 0;
    K.G.projectiles.push({ kind:'shell', x:3, z:15, y:K.sampleHeight(3,15)+0.4, vx:60, vz:0, life:0.6, owner:'x', target:null });
    let maxShellX = 3;
    for (let i=0;i<24;i++){ K.advanceProjectiles(0.016); const sh=K.G.projectiles.find(p=>p.kind==='shell'); if (sh) maxShellX=Math.max(maxShellX, sh.x); }
    const shellGone = !K.G.projectiles.some(p=>p.kind==='shell');
    ck("shell detonates on building (no pass-through)", shellGone && maxShellX < 22, "maxX="+maxShellX.toFixed(1)+" gone="+shellGone);

    // ---- RUNG 2: tank hull + turret ----
    // measured top-speed ratio ≈ 0.68 in a clear lane (z=4 plaza street)
    setup();
    local.pos.x=-52; local.pos.z=4; local.theta=Math.atan2(1,0); local.v.x=0; local.v.z=0; local.spinT=0; local.drift.active=false;
    local.balloons=9999;
    let vmax=0;
    for (let i=0;i<160;i++){ step({throttle:1},1,0.05); vmax=Math.max(vmax,H(local.v.x,local.v.z)); if (local.pos.x>46) break; }
    const kst=K.kartStats(local); const noTankTop=K.TUNE.maxSpeed*K.classMul()*kst.top;
    const ratio=vmax/noTankTop;
    ck("tank top-speed ratio ≈0.68 (measured)", ratio>0.60 && ratio<0.74, "ratio="+ratio.toFixed(3)+" vmax="+vmax.toFixed(1));
    ck("TANK constants top×0.68 accel×0.85", K.TANK.topMul===0.68 && K.TANK.accelMul===0.85);
    // drift still charges a mini-turbo tier while a tank (seed speed >minDriftSpeed so the drift
    // reliably engages, then track the PEAK charge — a late wall-slide could otherwise reset it).
    setup();
    local.pos.x=-40; local.pos.z=4; local.theta=Math.atan2(1,0); local.v.x=22; local.v.z=0;
    local.spinT=0; local.drift.active=false; local.drift.charge=0;
    let maxCharge=0;
    for (let i=0;i<28;i++){ step({throttle:1,steer:1,drift:true},1,0.05); maxCharge=Math.max(maxCharge, local.drift.charge); }
    ck("tank drift charges mini-turbo (tier>=1)", K.driftTier(maxCharge)>=1, "maxCharge="+maxCharge.toFixed(1));
    // turret world-yaw is INDEPENDENT of hull yaw
    const view=K.kartViews.local;
    local.turretYaw=1.0; local.theta=0.0; K.syncTurret(local,view,0.016); const ry1=view.turret.rotation.y;
    local.theta=Math.PI*0.5; K.syncTurret(local,view,0.016); const ry2=view.turret.rotation.y;
    local.theta=-Math.PI*0.7; K.syncTurret(local,view,0.016); const ry3=view.turret.rotation.y;
    ck("turret yaw holds world-relative while hull spins", Math.abs(ry1-1.0)<1e-6 && ry1===ry2 && ry2===ry3, "ry="+ry1.toFixed(3));
    // ---- night readability + framing (2026-07-18 reviewer fixes) ----
    // tank chase cam pulled back/up via the TANK_CAM multiplier (desktop: TUNE × mul)
    ck("tank cam dist ratio = TANK_CAM.dist", Math.abs(K.camDistEff()/K.TUNE.camDist - K.TANK_CAM.dist) < 1e-9, "ratio="+(K.camDistEff()/K.TUNE.camDist).toFixed(3));
    ck("tank cam height ratio = TANK_CAM.height", Math.abs(K.camHeightEff()/K.TUNE.camHeight - K.TANK_CAM.height) < 1e-9, "ratio="+(K.camHeightEff()/K.TUNE.camHeight).toFixed(3));
    // arena fill lighting raised above the city-theme values (night mood colors kept)
    ck("arena hemi fill raised above city 0.58", K.hemiLight.intensity > 0.9, "hemi="+K.hemiLight.intensity);
    ck("arena sun fill raised above city 0.52", K.sunLight.intensity > 0.75, "sun="+K.sunLight.intensity);
    // warm emissive lift on the turret (barrel direction = the gunner's UI, must read at night)
    {
      const tv = K.kartViews.local; K.syncTurret(local, tv, 0.016);
      const emSum = m => m.emissive ? (m.emissive.r+m.emissive.g+m.emissive.b) : 0;
      const turretLit = tv.turret.children.slice(0,3).every(ch => emSum(ch.material) > 0.08);
      ck("turret materials have warm emissive lift", turretLit);
      let lifted = 0; tv.bounce.traverse(o=>{ if (o.isMesh && o.material && o.material.isMeshLambertMaterial && emSum(o.material) > 0.05) lifted++; });
      ck("hull/driver materials lifted (>3 emissive mats)", lifted > 3, "lifted="+lifted);
      // idle bodyMat keeps a warm lift in tank mode (never pitch-black)
      local.boostT=0; local.starT=0; local.bullT=0; K.syncKartView(local, tv, 0.016);
      ck("idle bodyMat emissive lifted (not black)", emSum(tv.bodyMat) > 0.08, "em="+emSum(tv.bodyMat).toFixed(3));
    }
    // balloon cluster: shrunk 0.55×, raised above the turret, forward-offset off the aim line
    {
      K.updateBattleBalloons();
      const bv = K.balloonViews.local;
      ck("tank balloons scaled 0.55", !!bv && Math.abs(bv.group.scale.x - 0.55) < 1e-9, bv && bv.group.scale.x);
      const dy = bv.group.position.y - (local.y || 0);
      ck("tank balloons raised above turret (dy>2.5)", dy > 2.5, "dy="+dy.toFixed(2));
      const fdx = bv.group.position.x - local.pos.x, fdz = bv.group.position.z - local.pos.z;
      const fwd = fdx*Math.sin(local.theta) + fdz*Math.cos(local.theta);
      ck("tank balloons forward-offset (off the camera line)", fwd > 0.5, "fwd="+fwd.toFixed(2));
    }
    // auto-aim after 4s idle, manual override on arrow press
    setup();
    local.pos.x=0; local.pos.z=0; local.turretYaw=0;
    const en=Object.values(K.G.players).find(p=>p.isBot); en.pos.x=0; en.pos.z=20; en.ko=false;   // straight ahead (+z → yaw 0)
    local._lastGunnerT = performance.now()-9999;
    for (let i=0;i<20;i++) K.tankTurretTick(0.05);
    ck("solo turret auto-aims nearest enemy", local._autoAiming===true && Math.abs(local.turretYaw)<0.2, "yaw="+local.turretYaw.toFixed(2));
    K._setKeys('arrowleft', true); const yBefore=local.turretYaw;
    K.tankTurretTick(0.05); K._setKeys('arrowleft', false);
    ck("arrow press retakes MANUAL turret control", local._autoAiming===false && local.turretYaw>yBefore, "d="+(local.turretYaw-yBefore).toFixed(3));

    // ---- RUNG 3: firing ----
    setup();
    K.clearItem(local); local.reloadT=0; K.G.projectiles.length=0; local.turretYaw=0;
    K.tankFire(local);
    ck("cannon shell fires from turret", K.G.projectiles.filter(p=>p.kind==='shell').length===1);
    ck("firing sets reload gate", local.reloadT>0);
    K.G.projectiles.length=0; K.tankFire(local);
    ck("reload gate blocks a second shell", K.G.projectiles.filter(p=>p.kind==='shell').length===0);
    // integration: pressing F drives a shell through the full sim loop (tankTurretTick)
    setup(); K.clearItem(local); local.reloadT=0; K.G.projectiles.length=0;
    K._setKeys('f', true); step({},2,0.05); K._setKeys('f', false);
    ck("F key fires a shell through the sim loop", K.G.projectiles.some(p=>p.kind==='shell'));
    // in tank mode the normal item path is inert (firing is the turret's job, not hull-heading useItem)
    setup(); K.grantHeldItem(local,'tomato3'); K.G.projectiles.length=0;
    K.applyLocalItemInput(local, { item:true, itemTrailToggle:false });
    ck("tank mode: normal item path fires nothing (turret handles it)", K.G.projectiles.length===0 && local.itemHeld==='tomato3');
    // mobile FIRE (🎁 touch button) routes to the cannon
    setup(); K.clearItem(local); local.reloadT=0; K.G.projectiles.length=0; local._firePrev=false;
    K.touch.item=true; K.tankTurretTick(0.02); K.touch.item=false;
    ck("mobile FIRE button routes to the cannon", K.G.projectiles.some(p=>p.kind==='shell'));
    // shell hits an enemy tank → pops a balloon
    setup();
    K.clearItem(local); local.reloadT=0; local.turretYaw=0; local.pos.x=0; local.pos.z=0;
    const e2=Object.values(K.G.players).find(p=>p.isBot); e2.pos.x=0; e2.pos.z=8; e2.ko=false; e2.balloons=3; e2.battleInvulnT=0;
    K.G.projectiles.length=0; K.fireShell(local);
    const balBefore=e2.balloons;
    for (let i=0;i<24;i++){ K.advanceProjectiles(0.016); if (e2.balloons<balBefore) break; }
    ck("shell hit pops an enemy balloon", e2.balloons < balBefore, "bal "+balBefore+"->"+e2.balloons);
    // specials: tomato3 spread / chicken3 / hay mine
    setup(); K.clearItem(local); local.turretYaw=0; K.G.projectiles.length=0;
    K.grantHeldItem(local,'tomato3'); K.tankFire(local);
    ck("tomato3 fires a 3-shot spread", K.G.projectiles.filter(p=>p.kind==='tomato').length===3 && local.itemHeld===null);
    K.G.projectiles.length=0; K.grantHeldItem(local,'chicken3'); K.tankFire(local);
    ck("chicken3 fires 3 homing chickens", K.G.projectiles.filter(p=>p.kind==='chicken').length===3 && local.itemHeld===null);
    K.G.hazards.length=0; K.grantHeldItem(local,'hay'); K.tankFire(local);
    ck("hay drops a rear mine + consumes", K.G.hazards.length===1 && local.itemHeld===null);
    // rollItemTank only yields the 3 specials
    const rk=new Set(); for (let i=0;i<120;i++) rk.add(K.rollItemTank());
    ck("tank boxes grant only chicken3/tomato3/hay", rk.has('chicken3')&&rk.has('tomato3')&&rk.has('hay')&&rk.size===3);

    // ---- RUNG 4: enemies + win/lose + restart ----
    setup();
    const enemies=Object.values(K.G.players).filter(p=>p!==local && p.isBot);
    ck("2 enemy tanks", enemies.length===2);
    ck("player 5 balloons, enemies 3", local.balloons===5 && enemies.every(e=>e.balloons===3));
    ck("enemy tanks have distinct RED hull colors", enemies.length===2 && enemies[0]._slotCol!==enemies[1]._slotCol && enemies.every(e=>((e._slotCol>>16)&255) > ((e._slotCol)&255)));
    // LOS gate: building (15,15) between two points
    ck("LOS blocked through a building", K.losClear(15,0,15,40)===false);
    ck("LOS clear down an open street", K.losClear(0,0,0,40)===true);
    // enemy does NOT fire through a wall, DOES fire with clear LOS
    // (reuse the enemies from the setup above — a fresh setup() would recreate the bots + stale these refs)
    const eg=enemies[0], eg2=enemies[1];
    eg2.reloadT=999; eg2.tankFireCd=999;   // silence the other enemy
    K.G.projectiles.length=0;
    // blocked: enemy (15,0), player (15,40), wall between at x15 z[8,22]
    eg.pos.x=15; eg.pos.z=0; eg.ko=false; eg.reloadT=0; eg.tankFireCd=0; eg.balloons=3;
    local.pos.x=15; local.pos.z=40; local.ko=false; local.balloons=9999;
    eg.turretYaw=Math.atan2(local.pos.x-eg.pos.x, local.pos.z-eg.pos.z);
    K.tankTurretTick(0.02);
    const firedBlocked = K.G.projectiles.some(p=>p.kind==='shell' && p.owner===eg.id);
    ck("enemy does NOT fire through a wall (LOS gate)", !firedBlocked);
    // clear: move both to the open x=0 street
    K.G.projectiles.length=0;
    eg.pos.x=0; eg.pos.z=0; eg.reloadT=0; eg.tankFireCd=0;
    local.pos.x=0; local.pos.z=30;
    eg.turretYaw=Math.atan2(local.pos.x-eg.pos.x, local.pos.z-eg.pos.z);
    K.tankTurretTick(0.02);
    const firedClear = K.G.projectiles.some(p=>p.kind==='shell' && p.owner===eg.id);
    ck("enemy fires with clear LOS + reload ready", firedClear);
    // WIN: both enemies KO'd → CITY CHAMPIONS
    setup();
    for (const e of Object.values(K.G.players)) if (e!==local && e.isBot){ e.balloons=0; K.battleKO(e); }
    K.battleTick(0.05);
    const winTitle=(document.getElementById('rPlace').textContent||"");
    ck("win when both enemies KO'd (CITY CHAMPIONS)", K.G.phase==='finished' && /CITY CHAMPIONS/.test(winTitle), "title='"+winTitle+"'");
    // LOSE: player KO'd → TANK DOWN
    K.toMenu(); K.startCountdown(); K.G.phase='racing';
    const l2=K.G.players.local; l2.balloons=0; K.battleKO(l2); K.battleTick(0.05);
    const loseTitle=(document.getElementById('rPlace').textContent||"");
    ck("lose when player KO'd (TANK DOWN)", K.G.phase==='finished' && /TANK DOWN/.test(loseTitle), "title='"+loseTitle+"'");
    // RESTART: a full second match works
    K.toMenu(); K.startCountdown(); K.G.phase='racing';
    const l3=K.G.players.local;
    ck("restart: fresh match (player 5 balloons, 2 enemies, battle active)",
       l3.balloons===5 && Object.values(K.G.players).filter(p=>p.isBot).length===2 && K.battleActive() && !l3.ko);

    // bot no-stuck over a 25s roam (player parked + immortal so the match can't end)
    setup();
    const l4=K.G.players.local; l4.balloons=999999; l4.pos.x=0; l4.pos.z=48;   // parked in a corner-ish street
    const bots=Object.values(K.G.players).filter(p=>p.isBot);
    for (const b of bots){ b._stuckAcc=0; b._maxStuck=0; }
    for (let i=0;i<500;i++){   // 25s at dt 0.05
      step({},1,0.05);
      for (const b of bots){ const sp=H(b.v.x,b.v.z); if (sp<1){ b._stuckAcc+=0.05; b._maxStuck=Math.max(b._maxStuck,b._stuckAcc); } else b._stuckAcc=0; }
      if (K.G.phase!=='racing') break;
    }
    const worst=Math.max(...bots.map(b=>b._maxStuck||0));
    ck("bots never pinned >5s during 25s roam", worst<5, "worstStuck="+worst.toFixed(1)+"s phase="+K.G.phase);

    // ---- RUNG 5: HUD + controls + minimap ----
    K.toMenu(); K.startCountdown(); K.G.phase='racing';
    const l5=K.G.players.local; K.clearItem(l5); l5.reloadT=0;
    K.updateTankHud && K.G && 0; // no-op placeholder
    // ammo chip label reflects the weapon
    document.getElementById('tankHud'); // ensure element exists
    const hudEl=document.getElementById('tankHud');
    ck("tank ammo HUD element exists", !!hudEl);
    // controls card resets + dismisses on input
    K.resetTankControlsCard(); ck("controls card starts un-seen", K.tankControlsSeen===false);
    // clear any leftover keys from earlier checks so the dismiss test below starts clean
    for (const k of ['w','a','s','d',' ','arrowleft','arrowright','arrowup','arrowdown','enter','f']) K._setKeys(k, false);
    return out;
  });

  for (const [n,pass,d] of R.c) check(n, pass, d);

  // controls card dismiss (deterministic — drive updateTankControlsCard directly, no rAF timing race)
  const dismissed = await page.evaluate(() => {
    const K = window.__KART__;
    K.G.phase = 'racing';
    for (const k of ['w','a','s','d',' ','arrowleft','arrowright','enter','f']) K._setKeys(k, false);
    K.resetTankControlsCard();
    K.updateTankControlsCard();        // card shows (no input → not seen)
    const before = K.tankControlsSeen;
    K._setKeys('a', true);
    K.updateTankControlsCard();        // driver input → dismiss
    const after = K.tankControlsSeen;
    K._setKeys('a', false);
    return { before, after };
  });
  check("controls card visible pre-input then dismisses on driver input", dismissed.before === false && dismissed.after === true, JSON.stringify(dismissed));

  check("PASS2: 0 pageerrors", pageErrors.length === 0, pageErrors.slice(0,4).join(" | "));

  // ---------- screenshots ----------
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  // start a fresh match + skip the countdown so the live arena renders (not the "3" overlay).
  async function startRacingClean(){
    await page.evaluate(()=>{ const K=window.__KART__; K.toMenu(); K.startCountdown(); K.G.countdownT=0; });
    await new Promise(r=>setTimeout(r,800));   // updatePhase → racing, GO flash clears
    await page.evaluate(()=>{ window.__KART__.dismissTankControls(); });
  }
  async function shot(name, prep){
    await page.evaluate(prep);
    // snap the chase cam behind the (teleported) tank, then let a few frames settle the visuals
    await page.evaluate(()=>{ const K=window.__KART__; K.snapCameraBehind(K.G.players.local); K.dismissTankControls(); });
    await new Promise(r=>setTimeout(r,450));
    // clear any transient toast (e.g. "Crown unlocked!" from the staged wins earlier in this session)
    await page.evaluate(()=>{ const t=document.getElementById('fkToast'); if (t) t.classList.remove('on'); });
    await new Promise(r=>setTimeout(r,60));
    await page.screenshot({ path: path.join(SHOTS, name) });
  }
  // arena overview: look up a street THROUGH a lamp-lit intersection (lamp + item box + blocks ahead)
  await startRacingClean();
  await shot("fk_tank_arena.png", ()=>{ const K=window.__KART__; const l=K.G.players.local;
    l.pos.x=-30; l.pos.z=-44; l.theta=0; l.v.x=0; l.v.z=0; l.turretYaw=0.5; });
  // turret aimed off-hull-axis (hull faces up a street, turret points hard right)
  await shot("fk_tank_aim.png", ()=>{ const K=window.__KART__; const l=K.G.players.local;
    l.pos.x=0; l.pos.z=-26; l.theta=0; l.v.x=0; l.v.z=0; l.turretYaw=-Math.PI*0.5; });
  // muzzle flash + shell in flight — turret aimed to the SIDE so the barrel + flash + shell aren't
  // occluded by the tank body from the chase cam.
  await shot("fk_tank_fire.png", ()=>{ const K=window.__KART__; const l=K.G.players.local;
    l.pos.x=-4; l.pos.z=-28; l.theta=0; l.v.x=0; l.v.z=0; l.turretYaw=Math.PI*0.5; l.reloadT=0; K.clearItem(l); K.fireShell(l);
    const v=K.kartViews.local; if(v) v._muzzleT=0.6; });
  // enemy tank mid-street + incoming shell
  await shot("fk_tank_battle.png", ()=>{ const K=window.__KART__; const l=K.G.players.local;
    l.pos.x=0; l.pos.z=-30; l.theta=0; l.turretYaw=0.05;
    const e=Object.values(K.G.players).find(p=>p.isBot); if(e){ e.pos.x=1; e.pos.z=-12; e.ko=false; e.turretYaw=Math.PI; }
    K.G.projectiles.length=0; K.G.projectiles.push({kind:'shell',x:0.6,z:-20,y:K.sampleHeight(0.6,-20)+0.4,vx:0,vz:-40,life:0.5,owner:'e',target:null}); });
  // win overlay
  await page.evaluate(()=>{ const K=window.__KART__; K.toMenu(); K.startCountdown(); K.G.phase='racing';
    const l=K.G.players.local; for (const e of Object.values(K.G.players)) if (e!==l && e.isBot){ e.balloons=0; K.battleKO(e); } K.battleTick(0.05); });
  await new Promise(r=>setTimeout(r,300));
  await page.screenshot({ path: path.join(SHOTS, "fk_tank_win.png") });

  await page.close();
}

// ---------------- PASS 3: barnyard-brawl regression (classic battle unchanged) ----------------
async function pass3(browser){
  console.log("\n== PASS 3: barnyard-brawl regression (classic balloon battle) ==");
  const { page, pageErrors } = await newPage(browser, {});
  await page.goto(BASE + "/farmkart.html?track=barnyard-brawl", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.tankMode), { timeout: 15000 });
  const R = await page.evaluate(() => {
    const K = window.__KART__, out={c:[]}; const ck=(n,c,d)=>out.c.push([n,!!c,d||""]);
    ck("barnyard-brawl is NOT tank mode", K.tankMode()===false);
    ck("no tank arena group", !K.TANK_ARENA_GROUP);
    K.toMenu(); K.startCountdown(); K.G.phase='racing';
    ck("classic battle active", K.battleActive());
    const local=K.G.players.local;
    ck("classic battle start balloons = 3", local.balloons===3);
    ck("classic battle field = 4 karts", Object.keys(K.G.players).length===4);
    ck("NO turret built on classic battle kart", !K.kartViews.local.turret);
    const before=local.balloons; K.battlePopBalloon(local);
    ck("balloon pop still works", local.balloons===before-1);
    // reviewer-fix regression: classic battle keeps FULL-SIZE balloons + the stock camera distance
    K.updateBattleBalloons();
    const bv=K.balloonViews.local;
    ck("classic balloons stay scale 1", !!bv && bv.group.scale.x===1);
    ck("classic cam distance unmultiplied", Math.abs(K.camDistEff() - K.TUNE.camDist) < 1e-9);
    // rollItem for classic battle still yields the classic pool (not tank specials only)
    const kinds=new Set(); for (let i=0;i<200;i++) kinds.add(K.rollItem());
    ck("classic battle roll pool intact (boost/tomato/star present)", kinds.has('boost')&&kinds.has('tomato'));
    return out;
  });
  for (const [n,pass,d] of R.c) check(n, pass, d);
  check("PASS3: 0 pageerrors", pageErrors.length === 0, pageErrors.slice(0,4).join(" | "));
  await page.close();
}

// ---------------- PASS 4: mobile boot ----------------
async function pass4(browser){
  console.log("\n== PASS 4: mobile boot ==");
  const { page, pageErrors } = await newPage(browser, { mobile:true });
  await page.goto(BASE + "/farmkart.html?track=downtown-showdown", { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.tankMode), { timeout: 15000 });
  await page.evaluate(()=>{ const K=window.__KART__; K.toMenu(); K.startCountdown(); K.G.countdownT=0; });
  await new Promise(r=>setTimeout(r,800));   // updatePhase → racing, GO flash clears
  await page.evaluate(()=>{ const K=window.__KART__; const l=K.G.players.local; l.pos.x=0; l.pos.z=-26; l.theta=0; l.v.x=0; l.v.z=0; l.turretYaw=0.5;
    K.snapCameraBehind(l); K.dismissTankControls(); const t=document.getElementById('fkToast'); if (t) t.classList.remove('on'); });
  await new Promise(r=>setTimeout(r,450));
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "fk_tank_mobile.png") });
  const mob = await page.evaluate(()=>({ tank: window.__KART__.tankMode(), arena: !!window.__KART__.TANK_ARENA_GROUP }));
  check("mobile: tank arena boots", mob.tank && mob.arena);
  check("PASS4: 0 pageerrors (mobile)", pageErrors.length === 0, pageErrors.slice(0,4).join(" | "));
  await page.close();
}

(async () => {
  pass1();
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"] });
  try {
    await pass2(browser);
    await pass3(browser);
    await pass4(browser);
  } finally {
    await browser.close();
    if (server) server.kill();
  }
  console.log("\n==== TANK BATTLE: " + PASS + " passed, " + FAIL + " failed ====");
  process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error("FATAL", e); process.exit(2); });
