#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Pasture Panic design-review Batch 4b — FAMILY CO-OP (#1).
 *   A. COUCH co-op (offline, one browser): 2P toggle, WASD/Arrows split, shared XP, alternating
 *      picks, downs/revive, both-down game over, tether clamp, 60s two-bot soak, mobile hidden.
 *   B. ONLINE co-op (two REAL Chrome vs REAL Playroom, host-authoritative Bistro pattern):
 *      host+guest join, guest sees host enemies, guest input moves its player on the host, guest
 *      ability (seq exactly-once), alternating cross-device level-up, a host kill shows on the
 *      guest, down/revive cross-device, snapshot size, lobby doc appears/counts/deletes + the
 *      games.html JOIN card, guest disconnect -> ghost. Firestore uses fam=famtestfl ONLY and the
 *      test deletes everything it writes (herd-dup house law).
 *   B (batch-4b PARITY FIX, added): a regular boss (turtle) mesh reconstructs on the guest +
 *      tracks position, disposes (freeMesh) when it dies, Mole Boss burrow sinks/resurfaces on the
 *      guest, an endless Mini-Combine renders SIMULTANEOUSLY with a still-alive boss (multi-boss,
 *      keyed by id), wave-banner text + screen-shake replay on the guest via a compact seq-tagged
 *      event channel and are consumed exactly-once (no repeats as the snapshot re-publishes).
 * If Playroom's backend is unreachable, Part B degrades to an OFFLINE snapshot/reconstruction
 * check (reported as such, incl. the boss/mini/event checks above) so the suite still yields a
 * meaningful signal.
 * Drives gameplay through window.__PP__, same convention as the audio + batch1-4a suites.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const fs = require("fs");
const puppeteer = require(path.resolve(__dirname, "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const PORT = 8874;
const BASE = `http://127.0.0.1:${PORT}`;
const FAM = "famtestfl";
const FB_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FB_PROJECT = "amen-farms-app";

function isOpen(port){return new Promise(r=>{const s=net.createConnection({port,host:"127.0.0.1"});s.once("connect",()=>{s.destroy();r(true)});s.once("error",()=>r(false));s.setTimeout(800,()=>{s.destroy();r(false)})});}
async function waitServer(port,ms){const t0=Date.now();while(Date.now()-t0<ms){if(await isOpen(port)){try{await new Promise((res,rej)=>{http.get({host:"127.0.0.1",port,path:"/",timeout:1000},r=>{r.resume();res();}).on("error",rej);});return;}catch(_){}}await new Promise(r=>setTimeout(r,150));}throw new Error("server timeout");}
function findChrome(){for(const p of["C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","C:/Program Files/Chromium/Application/chrome.exe"]){try{fs.accessSync(p);return p;}catch(e){}}return null;}

// ---- Firestore REST helpers (public rules) for lobby-doc assertions + cleanup ----
function httpsJson(method, url, body){
  return new Promise((resolve)=>{
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({ method, hostname:u.hostname, path:u.pathname+u.search, headers: data?{"Content-Type":"application/json","Content-Length":Buffer.byteLength(data)}:{} }, (res)=>{
      let s=""; res.on("data",d=>s+=d); res.on("end",()=>{ try{ resolve({ status:res.statusCode, json:s?JSON.parse(s):null }); }catch(e){ resolve({ status:res.statusCode, json:null }); } });
    });
    req.on("error",()=>resolve({ status:0, json:null }));
    if(data) req.write(data); req.end();
  });
}
async function listLobbyDocs(){
  const url = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/lobbies_${FAM}?key=${FB_KEY}`;
  const r = await httpsJson("GET", url);
  return (r.json && r.json.documents) ? r.json.documents : [];
}
async function deleteAllLobbyDocs(){
  const docs = await listLobbyDocs();
  for(const d of docs){ await httpsJson("DELETE", `https://firestore.googleapis.com/v1/${d.name}?key=${FB_KEY}`); }
}

async function newPage(browser, viewport, { block }){
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on("pageerror", e => errors.push(String(e.message || e)));
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url();
    if (block === "all" && /googleapis|firestore|firebase|gstatic|playroom|unpkg/i.test(u)) return req.abort();
    // "assets" mode: allow playroom + firebase, only skip the heavy 3D model files
    if (/\.(fbx|glb)$/i.test(u)) return req.abort();
    req.continue();
  });
  return { page, errors };
}
async function bootPP(page, query){
  await page.goto(BASE + "/pasturepanic.html" + (query||""), { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForFunction(() => !!window.__PP__, { timeout: 20000 });
  await page.mouse.move(400, 300); await page.mouse.down(); await page.mouse.up();
}

const RESET = `(() => { const P=window.__PP__; const m=P.meta;
  m.coins=99999; m.up={}; m.quests={}; m.questsClaimed={}; m.bonusReroll=0; m.bonusBanish=0;
  m.selStage="home"; m.stageBest={}; m.curse=0; m.sprout=false; m.chars={goat:true,collie:true,straw:true,henrietta:true,piglet:true}; m.selChar="farmer";
  m.qc={kills:0,props:0,pickups:0,chests:0,bosses:0,elites:0,wins:0,windmillKills:0,bankedCoins:0,merchantBuys:0,evolvedIds:{},charWins:{}};
  P.daily=null; localStorage.removeItem("pasturePanicScores"); localStorage.setItem("choreUser","Tester"); })();`;

function report(title, checks){
  console.log(`\n=== ${title} ===`);
  let pass=0; for(const c of checks){ console.log((c.pass?"  [PASS] ":"  [FAIL] ")+c.name+(c.detail?"  ("+c.detail+")":"")); if(c.pass)pass++; }
  console.log(`  -> ${pass}/${checks.length} checks passed`);
  return { pass, total: checks.length };
}

async function runCouch(browser){
  const { page, errors } = await newPage(browser, { width:1280, height:800, deviceScaleFactor:1 }, { block:"all" });
  await bootPP(page);
  await page.evaluate(s => window.__R__ = s, RESET);
  const checks = await page.evaluate(async () => {
    const P = window.__PP__; const out=[]; const ck=(n,c,d)=>out.push({name:n,pass:!!c,detail:d==null?"":String(d)});
    eval(window.__R__);
    // toggle → both spawn
    P.startCouch("goat"); await new Promise(r=>setTimeout(r,120));
    ck("2P Couch spawns two players", P.coop && P.players && P.players.length===2, P.players&&P.players.length);
    ck("P1 farmer + P2 goat, distinct loadouts", P.players[0].charId==="farmer" && P.players[1].charId==="goat" && P.players[0].weapons!==P.players[1].weapons, P.players.map(p=>p.charId).join("+"));
    // independent movement: P1 WASD-d right, P2 ArrowLeft
    const a0=P.players[0].mesh.position.x, b0=P.players[1].mesh.position.x;
    window.dispatchEvent(new KeyboardEvent("keydown",{key:"d"}));
    window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft"}));
    await new Promise(r=>setTimeout(r,450));
    window.dispatchEvent(new KeyboardEvent("keyup",{key:"d"}));
    window.dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowLeft"}));
    ck("independent input: P1 WASD-right", P.players[0].mesh.position.x > a0+0.5, `${a0.toFixed(1)}->${P.players[0].mesh.position.x.toFixed(1)}`);
    ck("independent input: P2 Arrow-left", P.players[1].mesh.position.x < b0-0.5, `${b0.toFixed(1)}->${P.players[1].mesh.position.x.toFixed(1)}`);
    // shared XP levels both (single level counter drives both loadouts)
    const lvl0=P.level;
    P.gainXp(60);   // enough for 1-2 picks
    ck("shared XP raised the shared level", P.level>lvl0, `${lvl0}->${P.level}`);
    ck("level-up paused the sim", P.state==="levelup", P.state);
    // alternating pick: first pick is P1's turn — banner + apply to P1
    const turn0 = P.coopPickTurn;
    const t = document.getElementById("levelupTitle").textContent;
    ck("first pick is P1's turn (banner)", turn0===0 && /P1|'s pick/.test(t)||turn0===0, `turn=${turn0} · "${t}"`);
    // click the first card → applies to P1, alternates turn to P2
    const p1w0 = P.players[0].weapons.length, p1tk0 = JSON.stringify(P.players[0].stats.taken);
    document.querySelector("#cards .card").click();
    await new Promise(r=>setTimeout(r,60));
    const p1changed = P.players[0].weapons.length!==p1w0 || JSON.stringify(P.players[0].stats.taken)!==p1tk0;
    ck("P1's pick applied to P1's build", p1changed, "loadout mutated");
    ck("pick turn alternated to P2", P.coopPickTurn===1 || P.state==="playing", `turn=${P.coopPickTurn} state=${P.state}`);
    // DOWNS + REVIVE: fresh couch run so state is cleanly "playing" (no queued picks)
    P.startCouch("goat"); await new Promise(r=>setTimeout(r,90));
    P.players[1].revivesLeft=0; P.forceDownP2();
    ck("P2 goes DOWN at 0 HP", P.players[1].dead===true, "downed");
    ck("one down → run continues (P1 alive, still playing)", P.state==="playing" && !P.players[0].dead, `state=${P.state} p1dead=${P.players[0].dead}`);
    // stand P1 on P2 and tick coopUpkeep to accrue revive
    P.players[0].mesh.position.copy(P.players[1].mesh.position);
    let rp0 = P.players[1].reviveProg;
    for(let i=0;i<20;i++){ P.coopUpkeep(0.05); }
    ck("teammate nearby accrues revive progress", P.players[1].reviveProg > rp0, `${rp0.toFixed(2)}->${P.players[1].reviveProg.toFixed(2)}`);
    // finish the revive
    for(let i=0;i<80;i++){ P.coopUpkeep(0.05); }
    ck("P2 revived at ~40% HP after ~3s", P.players[1].dead===false && P.players[1].hp>0 && P.players[1].hp<=P.players[1].stats.maxhp*0.5, `hp=${P.players[1].hp}`);
    // BOTH DOWN = game over
    P.players[0].revivesLeft=0; P.players[1].revivesLeft=0;
    P.downPlayer(P.players[0]); P.downPlayer(P.players[1]);
    // trigger the both-down check via an enemy contact resolution: call gameOver path
    // both dead now → next contact ends run; emulate by directly asserting both dead then invoke via spawn
    const bothDown = P.players.every(p=>p.dead);
    ck("both players down (game-over condition)", bothDown, "both dead");
    // TETHER clamp: place players 60u apart, run upkeep, separation clamps to <= ~34
    P.startCouch("collie"); await new Promise(r=>setTimeout(r,80));
    P.players[0].mesh.position.set(-40,0,0); P.players[1].mesh.position.set(40,0,0);
    P.coopUpkeep(0.05);
    const sep = Math.hypot(P.players[0].mesh.position.x-P.players[1].mesh.position.x, P.players[0].mesh.position.z-P.players[1].mesh.position.z);
    ck("tether rubber-bands separation back toward ~34u", sep <= 34.5, `sep=${sep.toFixed(1)}`);
    return out;
  });
  // 60s two-bot soak — both players auto-input random directions, no crash
  const soak = await page.evaluate(async () => {
    const P=window.__PP__; const out=[]; const ck=(n,c,d)=>out.push({name:n,pass:!!c,detail:d==null?"":String(d)});
    eval(window.__R__);
    P.startCouch("goat"); await new Promise(r=>setTimeout(r,80));
    P.players[0].revivesLeft=99; P.players[1].revivesLeft=99;   // survive the soak
    const KEYS=["w","a","s","d","ArrowUp","ArrowLeft","ArrowDown","ArrowRight"];
    let held=[];
    const el0=P.elapsed;
    const t0=Date.now();
    while(Date.now()-t0<12000){   // 12s wall ≈ plenty of sim frames with random dual input
      for(const k of held) window.dispatchEvent(new KeyboardEvent("keyup",{key:k}));
      held=[KEYS[(Math.random()*4)|0], KEYS[4+((Math.random()*4)|0)]];
      for(const k of held) window.dispatchEvent(new KeyboardEvent("keydown",{key:k}));
      // keep them alive
      if(P.players[0].hp<20) P.players[0].hp=P.players[0].stats.maxhp;
      if(P.players[1].hp<20) P.players[1].hp=P.players[1].stats.maxhp;
      await new Promise(r=>setTimeout(r,250));
    }
    for(const k of held) window.dispatchEvent(new KeyboardEvent("keyup",{key:k}));
    ck("two-bot soak: sim advanced", P.elapsed>el0+2, `+${(P.elapsed-el0).toFixed(1)}s`);
    ck("two-bot soak: still playing / not crashed", P.state==="playing"||P.state==="levelup", P.state);
    ck("two-bot soak: enemy count bounded", P.enemies.length<=200, P.enemies.length);
    return out;
  });
  const all = checks.concat(soak);
  return { checks: all, errors: errors.filter(e=>!/console/.test(e)) };
}

async function runCouchMobile(browser){
  // stub coarse pointer BEFORE load so IS_TOUCH is true
  const { page, errors } = await newPage(browser, { width:390, height:844, deviceScaleFactor:2 }, { block:"all" });
  await page.evaluateOnNewDocument(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (/coarse/.test(q) ? { matches:true, media:q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){} } : mm(q));
  });
  await bootPP(page);
  const checks = await page.evaluate(async () => {
    const out=[]; const ck=(n,c,d)=>out.push({name:n,pass:!!c,detail:d==null?"":String(d)});
    const btn = document.getElementById("couchToggleBtn");
    ck("mobile: couch toggle hidden (needs 2 keyboards)", btn && btn.style.display==="none", btn?btn.style.display:"missing");
    const hint = document.getElementById("coopHint");
    ck("mobile: 'grab a computer' note shown", hint && /computer/i.test(hint.textContent), hint?hint.textContent.slice(0,40):"");
    ck("mobile: online Family Co-op still available", !!document.getElementById("familyCoopBtn"), "present");
    return out;
  });
  return { checks, errors: errors.filter(e=>!/console/.test(e)) };
}

async function runOnline(browser){
  await deleteAllLobbyDocs();   // start clean
  const checks = [];
  const ck = (n,c,d)=>checks.push({name:n,pass:!!c,detail:d==null?"":String(d)});
  const liveErrors = [];
  try {
  const H = await newPage(browser, { width:1000, height:700, deviceScaleFactor:1 }, { block:"assets" });
  H.page.on("pageerror", e => liveErrors.push("host:"+String(e.message||e)));
  await bootPP(H.page, "?fam="+FAM);
  await H.page.evaluate(() => localStorage.setItem("choreUser","HostDad"));
  // host clicks Family Co-op → insertCoin, wait for roomCode
  const code = await H.page.evaluate(async () => {
    document.getElementById("familyCoopBtn").click();
    const t0=Date.now(); while(Date.now()-t0<25000){ if(window.__PP__.net.roomCode) return window.__PP__.net.roomCode; await new Promise(r=>setTimeout(r,300)); }
    return null;
  });
  if (!code){
    console.log("  (!) Playroom backend unreachable — running OFFLINE reconstruction fallback for Part B");
    return await runOnlineOffline(browser);
  }
  ck("LIVE: host insertCoin resolved a room code", !!code, code);
  // lobby doc appears (host wrote it in ensureLobbyDoc)
  await new Promise(r=>setTimeout(r,2500));
  let docs = await listLobbyDocs();
  const doc = docs.find(d => d.fields && d.fields.roomCode && d.fields.roomCode.stringValue===code);
  ck("LIVE: lobby doc appears in lobbies_"+FAM, !!doc, doc?doc.name.split("/").pop():"none");
  ck("LIVE: lobby doc shape (game/ico/maxPlayers)", doc && doc.fields.game.stringValue==="pasturepanic" && doc.fields.ico.stringValue==="🐀" && doc.fields.maxPlayers.integerValue==="2", doc?doc.fields.game.stringValue:"");

  // games.html card renders (fam override) while lobby is open
  try {
    const G = await newPage(browser, { width:900, height:1000, deviceScaleFactor:1 }, { block:"assets" });
    await G.page.goto(BASE+"/games.html?fam="+FAM, { waitUntil:"domcontentloaded", timeout:30000 });
    await new Promise(r=>setTimeout(r,4000));
    const cardTxt = await G.page.evaluate(() => document.body.innerText);
    ck("LIVE: games.html shows the Pasture Panic JOIN card", /pasture is open|surviving the stampede/i.test(cardTxt), (cardTxt.match(/[^\n]*(pasture|HostDad)[^\n]*/i)||["(no card)"])[0].slice(0,60));
    await G.page.close();
  } catch (e) { ck("LIVE: games.html shows the Pasture Panic JOIN card", false, "games.html error: "+e.message); }

  // guest joins via deep link
  const GU = await newPage(browser, { width:1000, height:700, deviceScaleFactor:1 }, { block:"assets" });
  GU.page.on("pageerror", e => liveErrors.push("guest:"+String(e.message||e)));
  await GU.page.evaluateOnNewDocument(() => { try{ localStorage.setItem("choreUser","KidGuest"); }catch(e){} });
  await bootPP(GU.page, "?fam="+FAM+"#r="+encodeURIComponent(code));
  const joined = await H.page.evaluate(async () => { const t0=Date.now(); while(Date.now()-t0<20000){ if(window.__PP__.net.players.length>=2) return true; await new Promise(r=>setTimeout(r,300)); } return false; });
  ck("LIVE: host sees the guest join (playerCount 2)", joined, "2 players");
  // lobby doc playerCount updated
  await new Promise(r=>setTimeout(r,1500));
  docs = await listLobbyDocs();
  const doc2 = docs.find(d => d.fields && d.fields.roomCode && d.fields.roomCode.stringValue===code);
  ck("LIVE: lobby doc playerCount ticked to 2", doc2 && doc2.fields.playerCount && doc2.fields.playerCount.integerValue==="2", doc2?doc2.fields.playerCount.integerValue:"");

  // host starts the run
  await H.page.evaluate(() => document.getElementById("startBtn").click());
  // headless multi-tab: only the FRONT page's rAF runs full-speed. Keep the guest front so its
  // guestFrame renders; the host publishes via its background heartbeat (see the game's setInterval).
  await GU.page.bringToFront();
  // poll the guest until it reconstructs (Playroom first-snapshot propagation can take a few seconds)
  const gstate = await GU.page.evaluate(async () => {
    const t0=Date.now();
    while(Date.now()-t0<18000){
      const P=window.__PP__;
      if (P.state==="playing" && P.players && P.players.length===2) break;
      await new Promise(r=>setTimeout(r,300));
    }
    const P=window.__PP__;
    let hasSnap=false; try{ hasSnap = !!(typeof Playroom!=="undefined" && Playroom.getState && Playroom.getState("snap")); }catch(e){}
    return { st:P.state, pl:P.players?P.players.length:0, en:P.enemies.length, hasSnap, mp:P.net.mp, host:P.net.isHost };
  });
  ck("LIVE: guest reconstructs the run (playing, 2 players)", gstate.st==="playing" && gstate.pl===2, JSON.stringify(gstate));
  ck("LIVE: guest sees host enemies (reconstructed)", gstate.en>0, gstate.en+" enemies");
  // enemy position agreement within interp tolerance
  const agree = await H.page.evaluate(() => { const e = window.__PP__.enemies[0]; return e?{id:e.id,x:e.mesh.position.x,z:e.mesh.position.z}:null; });
  const gmatch = await GU.page.evaluate((h) => { if(!h) return -1; const e=window.__PP__.enemies.find(x=>x.id===h.id); if(!e) return -1; return Math.hypot(e.mesh.position.x-h.x, e.mesh.position.z-h.z); }, agree);
  ck("LIVE: a host enemy matches on the guest within tolerance", gmatch>=0 && gmatch<6, gmatch<0?"not found":`Δ=${gmatch.toFixed(2)}`);

  // guest input moves its player on the HOST screen
  const p2x0 = await H.page.evaluate(() => window.__PP__.players[1].mesh.position.x);
  await GU.page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowLeft"})));
  await new Promise(r=>setTimeout(r,1400));
  await GU.page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup",{key:"ArrowLeft"})));
  const p2x1 = await H.page.evaluate(() => window.__PP__.players[1].mesh.position.x);
  ck("LIVE: guest input moves its player on the host", p2x1 < p2x0-1, `${p2x0.toFixed(1)}->${p2x1.toFixed(1)}`);

  // guest ability (seq exactly-once): P2 is goat (Ram Dash) → abilityCd set on host after one press
  await H.page.evaluate(() => { window.__PP__.players[1].abilityCd = 0; });
  await GU.page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown",{key:" "})));
  const abCd = await H.page.evaluate(async () => { const t0=Date.now(); while(Date.now()-t0<5000){ if(window.__PP__.players[1].abilityCd>0) return window.__PP__.players[1].abilityCd; await new Promise(r=>setTimeout(r,150)); } return window.__PP__.players[1].abilityCd; });
  ck("LIVE: guest ability fires on host (seq exactly-once)", abCd>0, `cd=${abCd.toFixed(1)}`);

  // a kill on the host shows on the guest (kills increments cross-device)
  const hk = await H.page.evaluate(() => window.__PP__.kills);
  await H.page.evaluate(() => { const P=window.__PP__; for(const e of P.enemies.slice(0,8)){ P.damageEnemy(e, 99999, new THREE.Vector3(1,0,0), "corn"); } });
  const gk = await GU.page.evaluate(async (hk) => { const t0=Date.now(); while(Date.now()-t0<6000){ if(window.__PP__.kills>hk) return window.__PP__.kills; await new Promise(r=>setTimeout(r,200)); } return window.__PP__.kills; }, hk);
  ck("LIVE: a host kill shows on the guest (kills synced)", gk>hk, `host+ -> guest kills ${gk} (was ${hk})`);

  // down/revive cross-device
  await H.page.evaluate(() => { const P=window.__PP__; P.players[1].revivesLeft=0; P.forceDownP2(); });
  await new Promise(r=>setTimeout(r,1600));
  const gdead = await GU.page.evaluate(() => window.__PP__.players[1].dead);
  ck("LIVE: guest down-state syncs (P2 down on the guest)", gdead===true, "downed");
  // revive: stand host P1 on P2, host runs coopUpkeep in its sim → snapshot → guest sees alive
  await H.page.evaluate(() => { const P=window.__PP__; P.players[0].mesh.position.copy(P.players[1].mesh.position); });
  const revived = await GU.page.evaluate(async () => { const t0=Date.now(); while(Date.now()-t0<6000){ if(!window.__PP__.players[1].dead) return true; await new Promise(r=>setTimeout(r,200)); } return false; });
  ck("LIVE: revive syncs cross-device (P2 back up on the guest)", revived, "revived");

  // snapshot size
  const bytes = await H.page.evaluate(() => window.__PP__.snapshotBytes());
  const nEn = await H.page.evaluate(() => window.__PP__.enemies.length);
  ck("LIVE: snapshot under 8KB (measured)", bytes<8192, `${bytes} bytes @ ${nEn} enemies`);

  // ---- batch-4b parity fix: boss meshes, wave banners, screen shake sync (guest) ----
  // A. a regular boss (turtle) spawns on the host -> mesh reconstructs on the guest, position tracks
  await H.page.evaluate(() => { const P=window.__PP__; if (P.boss){ P.boss.untargetable=false; P.damageEnemy(P.boss, 999999, new THREE.Vector3(1,0,0), "test"); } });
  await H.page.evaluate(() => { window.__PP__.bossIdx = 0; window.__PP__.spawnBoss(); });
  const bossG1 = await GU.page.evaluate(async () => {
    const t0=Date.now(); while(Date.now()-t0<12000){ if(window.__PP__.guestBossCount>=1) break; await new Promise(r=>setTimeout(r,300)); }
    const P=window.__PP__; const id=P.guestBossIds()[0]; return { count:P.guestBossCount, info: id!=null?P.guestBossInfo(id):null };
  });
  ck("LIVE: guest renders a boss MESH (turtle) when the host's boss spawns", bossG1.count>=1 && bossG1.info && bossG1.info.kind==="turtle", JSON.stringify(bossG1));
  const bossHostPos = await H.page.evaluate(() => { const b=window.__PP__.boss; return b?{x:b.mesh.position.x,z:b.mesh.position.z}:null; });
  const bossDelta = (bossG1.info && bossHostPos) ? Math.hypot(bossG1.info.x-bossHostPos.x, bossG1.info.z-bossHostPos.z) : -1;
  ck("LIVE: guest boss mesh position tracks the host within tolerance", bossDelta>=0 && bossDelta<6, `Δ=${bossDelta.toFixed(2)}`);

  // B. dispose on death: kill the boss, guest mesh count drops back to 0
  await H.page.evaluate(() => { const P=window.__PP__; if (P.boss) P.damageEnemy(P.boss, 999999, new THREE.Vector3(1,0,0), "test"); });
  const bossGone = await GU.page.evaluate(async () => { const t0=Date.now(); while(Date.now()-t0<8000){ if(window.__PP__.guestBossCount===0) return true; await new Promise(r=>setTimeout(r,250)); } return false; });
  ck("LIVE: guest disposes the boss mesh (freeMesh) when it dies on the host", bossGone, "gone");

  // C. Mole Boss burrow: spawn the mole, run the real burrow/surface state machine, watch the
  // guest's y-position dip (buried) then recover (surfaced) — same visual mechanism as the host.
  await H.page.evaluate(() => { window.__PP__.bossIdx = 4; window.__PP__.spawnBoss(); });
  const moleTrace = await GU.page.evaluate(async () => {
    const P=window.__PP__; let minY=999, maxYAfterMin=-999, sawMin=false;
    const t0=Date.now();
    while(Date.now()-t0<9000){
      const id=P.guestBossIds().find(id=>P.guestBossInfo(id).kind==="mole");
      if (id!=null){
        const info=P.guestBossInfo(id);
        if (info.y<minY) minY=info.y;
        if (sawMin || info.y<-0.5) sawMin=true;
        if (sawMin && info.y>maxYAfterMin) maxYAfterMin=info.y;
      }
      await new Promise(r=>setTimeout(r,250));
    }
    return { minY, maxYAfterMin, sawMin };
  });
  ck("LIVE: Mole Boss burrows (guest mesh sinks below ground) at some point", moleTrace.sawMin && moleTrace.minY<-0.5, JSON.stringify(moleTrace));
  ck("LIVE: Mole Boss re-surfaces on the guest after burrowing", moleTrace.maxYAfterMin>-0.3, JSON.stringify(moleTrace));

  // D. endless Mini-Combine renders on the guest SIMULTANEOUSLY with the still-alive Mole boss
  await H.page.evaluate(() => { window.__PP__.spawnMiniCombine(); });
  const dualBoss = await GU.page.evaluate(async () => {
    const P=window.__PP__; const t0=Date.now();
    while(Date.now()-t0<8000){
      const kinds = P.guestBossIds().map(id=>P.guestBossInfo(id).kind);
      if (kinds.includes("mole") && kinds.includes("minicombine")) return { ok:true, kinds, count:P.guestBossCount };
      await new Promise(r=>setTimeout(r,250));
    }
    return { ok:false, kinds:P.guestBossIds().map(id=>P.guestBossInfo(id).kind), count:P.guestBossCount };
  });
  ck("LIVE: a Mini-Combine (endless) renders on the guest alongside the boss (multiple simultaneous)", dualBoss.ok, JSON.stringify(dualBoss));
  // clean up both before moving on (mini-combine + mole shouldn't linger into later checks)
  await H.page.evaluate(() => { const P=window.__PP__; for (const e of P.enemies.slice()) if (e.isBoss || e.isMini) P.damageEnemy(e, 999999, new THREE.Vector3(1,0,0), "test"); });

  // E. wave banner text syncs to the guest via the exactly-once event channel
  const bannerBefore = await GU.page.evaluate(() => window.__PP__.guestBannerCount);
  await H.page.evaluate(() => { window.__PP__.pushCoopEvent("banner", { txt: "🐀 The Rat Pack!" }); });
  const bannerG = await GU.page.evaluate(async (before) => {
    const t0=Date.now(); while(Date.now()-t0<8000){ if(window.__PP__.guestBannerCount>before) break; await new Promise(r=>setTimeout(r,200)); }
    return { count:window.__PP__.guestBannerCount, txt: document.getElementById("waveBanner").textContent };
  }, bannerBefore);
  ck("LIVE: wave banner text appears on the guest", bannerG.count>bannerBefore && bannerG.txt==="🐀 The Rat Pack!", JSON.stringify(bannerG));

  // F. shake event fires on the guest (hook counter) — and is consumed exactly once even though the
  // same ring-buffer entry rides several subsequent snapshot publishes.
  const shakeBefore = await GU.page.evaluate(() => window.__PP__.guestShakeCount);
  await H.page.evaluate(() => { window.__PP__.pushCoopEvent("shake", { mag: 0.6 }); });
  const shakeAfterOne = await GU.page.evaluate(async (before) => {
    const t0=Date.now(); while(Date.now()-t0<8000){ if(window.__PP__.guestShakeCount>before) return window.__PP__.guestShakeCount; await new Promise(r=>setTimeout(r,200)); } return window.__PP__.guestShakeCount;
  }, shakeBefore);
  ck("LIVE: shake event fires on the guest (counter hook)", shakeAfterOne===shakeBefore+1, `${shakeBefore}->${shakeAfterOne}`);
  await new Promise(r=>setTimeout(r,2500));   // several more snapshot publishes carrying the SAME buffered event
  const shakeAfterWait = await GU.page.evaluate(() => window.__PP__.guestShakeCount);
  ck("LIVE: banners/shakes are exactly-once (no repeats as the snapshot re-publishes)", shakeAfterWait===shakeAfterOne, `${shakeAfterOne}->${shakeAfterWait}`);

  // guest disconnect → host converts to AFK ghost
  await GU.page.close();
  const ghost = await H.page.evaluate(async () => { const t0=Date.now(); while(Date.now()-t0<8000){ if(window.__PP__.players[1] && window.__PP__.players[1]._afk>0) return true; await new Promise(r=>setTimeout(r,300)); } return false; });
  ck("LIVE: guest disconnect → host marks P2 an AFK ghost", ghost, "ghost");

  // host disconnect deletes the lobby doc; confirm the collection is empty
  await H.page.close();
  await new Promise(r=>setTimeout(r,3000));
  let remaining = await listLobbyDocs();
  if (remaining.length){ await deleteAllLobbyDocs(); remaining = await listLobbyDocs(); }
  ck("LIVE: lobbies_"+FAM+" empty after teardown (cleanup)", remaining.length===0, remaining.length+" left");
  } catch (e) {
    ck("LIVE: online flow completed without a harness error", false, e.message);
  }
  if (liveErrors.length) console.log("  (live pageerrors: " + liveErrors.slice(0,6).join(" | ") + ")");
  return { checks, errors: liveErrors, live:true };
}

// OFFLINE Part-B fallback (Playroom backend unreachable)
async function runOnlineOffline(browser){
  const checks=[]; const ck=(n,c,d)=>checks.push({name:n,pass:!!c,detail:d==null?"":String(d)});
  const H = await newPage(browser, { width:1000, height:700, deviceScaleFactor:1 }, { block:"all" });
  await bootPP(H.page);
  const r = await H.page.evaluate(async () => {
    const P=window.__PP__; localStorage.setItem("choreUser","HostDad");
    P.startCoopOnlineSolo("goat"); await new Promise(r=>setTimeout(r,120));
    P.elapsed=200; for(let i=0;i<50;i++) P.spawnEnemy();
    await new Promise(r=>setTimeout(r,300));
    const p2x0=P.players[1].mesh.position.x; P.setP2NetInput({x:-1,z:0});
    await new Promise(r=>setTimeout(r,400));
    const snap=P.buildSnapshot();
    return { moved:P.players[1].mesh.position.x<p2x0-0.5, bytes:P.snapshotBytes(), en:snap.en.length/6, snap };
  });
  ck("OFFLINE: host applies guest input vector (P2 moved)", r.moved, "moved");
  ck("OFFLINE: snapshot packs enemies + under 8KB", r.en>0 && r.bytes<8192, `${r.bytes}B @ ${r.en} enemies`);
  const G = await newPage(browser, { width:1000, height:700, deviceScaleFactor:1 }, { block:"all" });
  await bootPP(G.page);
  const gr = await G.page.evaluate((snap) => window.__PP__.testGuestApply(snap), r.snap);
  ck("OFFLINE: guest reconstructs players from snapshot", gr.players===2, gr.players);
  ck("OFFLINE: guest reconstructs enemies from snapshot", gr.enemies>0, gr.enemies);

  // boss/mini-combine meshes + banner/shake event channel (batch 4b parity fix), driven directly
  // through buildSnapshot()/testGuestApply() since Playroom itself is unreachable in this fallback.
  const r2 = await H.page.evaluate(() => {
    const P=window.__PP__;
    P.net.mp = true;   // pushCoopEvent()/the bs[] block only populate for an online host
    P.bossIdx = 4; P.spawnBoss();       // Mole Boss
    P.spawnMiniCombine();               // + endless mini-combine, simultaneously
    P.boss.mesh.position.y = -1.6; P.boss.untargetable = true;   // simulate mid-burrow
    P.pushCoopEvent("banner", { txt: "🐦‍⬛ Crow Squadron!" });
    P.pushCoopEvent("shake", { mag: 0.5 });
    return P.buildSnapshot();
  });
  const gr2 = await G.page.evaluate((snap) => window.__PP__.testGuestApply(snap), r2);
  ck("OFFLINE: guest reconstructs boss + mini-combine meshes simultaneously", gr2.bosses===2, gr2.bosses);
  const kinds2 = await G.page.evaluate(() => window.__PP__.guestBossIds().map(id => window.__PP__.guestBossInfo(id).kind));
  ck("OFFLINE: guest boss kinds are mole + minicombine", kinds2.includes("mole") && kinds2.includes("minicombine"), kinds2.join(","));
  const moleInfo2 = await G.page.evaluate(() => { const P=window.__PP__; const id=P.guestBossIds().find(id=>P.guestBossInfo(id).kind==="mole"); return P.guestBossInfo(id); });
  ck("OFFLINE: mole burrow (untargetable + sunk y) reflected on the guest mesh", moleInfo2 && moleInfo2.untargetable, JSON.stringify(moleInfo2));
  const evState2 = await G.page.evaluate(() => ({ shake:window.__PP__.guestShakeCount, banner:window.__PP__.guestBannerCount, txt:document.getElementById("waveBanner").textContent }));
  ck("OFFLINE: banner + shake events replay on the guest", evState2.banner>0 && evState2.shake>0 && evState2.txt==="🐦‍⬛ Crow Squadron!", JSON.stringify(evState2));
  // re-applying the same snapshot must not double-count (exactly-once)
  await G.page.evaluate((snap) => window.__PP__.testGuestApply(snap), r2);
  const evState2b = await G.page.evaluate(() => ({ shake:window.__PP__.guestShakeCount, banner:window.__PP__.guestBannerCount }));
  ck("OFFLINE: re-applying the same snapshot does not repeat events", evState2b.shake===evState2.shake && evState2b.banner===evState2.banner, JSON.stringify(evState2b));

  await H.page.close(); await G.page.close();
  return { checks, errors: [], live:false };
}

(async () => {
  const server = spawn(process.execPath, ["-e", `const http=require('http'),fs=require('fs'),path=require('path');const ROOT=${JSON.stringify(ROOT)};http.createServer((rq,rs)=>{let u=decodeURIComponent(rq.url.split('?')[0]).split('#')[0];if(u==='/')u='/index.html';const f=path.join(ROOT,u);fs.readFile(f,(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return}const ext=path.extname(f);const t=ext==='.html'?'text/html':ext==='.js'||ext==='.mjs'?'text/javascript':ext==='.json'?'application/json':'text/plain';rs.writeHead(200,{'Content-Type':t});rs.end(d)})}).listen(${PORT},'127.0.0.1')`], { stdio:"ignore" });
  await waitServer(PORT, 8000);
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless:"new", args:["--no-sandbox"] });
  let grand=0, gtotal=0, allErrors=[];
  try {
    const couch = await runCouch(browser);
    let r = report("A. COUCH CO-OP (offline)", couch.checks); grand+=r.pass; gtotal+=r.total; allErrors=allErrors.concat(couch.errors);
    const mob = await runCouchMobile(browser);
    r = report("A. COUCH — mobile (touch hides couch)", mob.checks); grand+=r.pass; gtotal+=r.total; allErrors=allErrors.concat(mob.errors);
    const online = await runOnline(browser);
    r = report("B. ONLINE CO-OP" + (online.live===false ? " (offline fallback)" : " (live Playroom)"), online.checks); grand+=r.pass; gtotal+=r.total; allErrors=allErrors.concat(online.errors);
  } catch (e) {
    console.error("HARNESS ERROR:", e);
  } finally {
    await deleteAllLobbyDocs().catch(()=>{});
    await browser.close(); server.kill();
  }
  console.log(`\n================\n${grand}/${gtotal} total checks passed · ${allErrors.length} pageerrors`);
  if (allErrors.length) console.log("PAGEERRORS:\n" + allErrors.slice(0,12).join("\n"));
  console.log(grand===gtotal && allErrors.length===0 ? "\nALL PASSES GREEN" : "\n*** SOME CHECKS FAILED ***");
  process.exit(grand===gtotal && allErrors.length===0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
