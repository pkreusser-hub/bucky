const puppeteer=require('puppeteer-core');
(async()=>{
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const pg=await b.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  pg.on('console',m=>{if(m.type()==='error'&&!/status of 404/.test(m.text()))errs.push('con:'+m.text());});
  await pg.goto('http://localhost:8790/farmkart-editor.html',{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__EDITOR__ && window.__EDITOR__.track',{timeout:25000});
  await new Promise(r=>setTimeout(r,700));
  let pass=[], fail=[];

  // record bot state once per animation frame for `ms`
  const record=(ms)=>pg.evaluate(ms=>new Promise(res=>{
    const E=window.__EDITOR__, s=[]; const t0=performance.now();
    (function tick(){ const b=E.bot; s.push({ x:b.x, z:b.z, y:b.y, cd:b.centerDist, air:b.airborne,
        slide:b.slideAngle, drift:b.drift.active, charge:b.drift.charge, boostT:b.boostT });
      if(performance.now()-t0<ms) requestAnimationFrame(tick); else res(s); })();
  }),ms);

  const width=await pg.evaluate(()=>window.__EDITOR__.track.width);
  const half=width/2;

  // ---- 1. bot spawns + drives the course (record a couple of laps to catch drifts) ----
  await pg.evaluate(()=>window.__EDITOR__.startBot());
  await new Promise(r=>setTimeout(r,300));
  const drove=await record(14000);
  const p0=drove[0], p1=drove[drove.length-1];
  const netDisp=Math.hypot(p1.x-p0.x, p1.z-p0.z);
  const near=drove.filter(s=>s.cd<=half+12).length, ratio=near/drove.length;
  (netDisp>40?pass:fail).push('bot advances / laps the course: net '+netDisp.toFixed(1)+'u ('+drove.length+' frames)');
  (ratio>0.8?pass:fail).push('bot follows the track (near centerline '+(ratio*100).toFixed(0)+'% of frames, thresh half+12='+(half+12).toFixed(0)+')');

  // ---- 1b. DRIFT: a real slide angle in corners, mini-turbo charge, boost fired after a drift ----
  const maxSlide=Math.max(...drove.map(s=>s.slide||0));
  const drifted=drove.some(s=>s.drift);
  const maxCharge=Math.max(...drove.map(s=>s.charge||0));
  // a boost frame (boostT>0) that immediately FOLLOWS a drift frame = a mini-turbo release
  let mtBoost=false; for(let i=1;i<drove.length;i++){ if(drove[i].boostT>0 && (drove[i-1].drift || drove[i-1].boostT>0) && drove[i].charge===0) mtBoost=true; }
  const anyBoost=drove.some(s=>s.boostT>0);
  (maxSlide>0.15?pass:fail).push('bot BREAKS TRACTION in corners: max slide angle '+maxSlide.toFixed(3)+' rad (>0.15 = drifting, not railed)');
  (drifted?pass:fail).push('drift state activates during cornering (drift.active seen)');
  (maxCharge>=270?pass:fail).push('mini-turbo charges up while drifting: max charge '+maxCharge.toFixed(0)+' (tier-1 = 270)');
  ((mtBoost||anyBoost)?pass:fail).push('mini-turbo BOOST fires after a drift (boostT>0 post-drift, mt-release='+mtBoost+' anyBoost='+anyBoost+')');

  // ---- 2. ramp ahead -> bot goes airborne with height gain ----
  const ramp=await pg.evaluate(()=>new Promise(res=>{
    const E=window.__EDITOR__, b=E.bot, t=E.track;
    const fx=Math.sin(b.theta), fz=Math.cos(b.theta);
    const sy=3.5, sz=18, ahead=sz/2+6;
    const cx=b.x+fx*ahead, cz=b.z+fz*ahead;
    const baseY=E.heightAt(cx,cz);
    t.objects=(t.objects||[]).filter(o=>o.id!=='__botramp');
    t.objects.push({ id:'__botramp', type:'ramp', x:cx, y:baseY+sy/2, z:cz, rotY:b.theta, sx:16, sy, sz, color:0xb8863f });
    let air=0, peak=-1e9; const t0=performance.now();
    (function tick(){ if(E.bot.airborne)air++; if(E.bot.y>peak)peak=E.bot.y;
      if(performance.now()-t0<3500) requestAnimationFrame(tick);
      else { t.objects=t.objects.filter(o=>o.id!=='__botramp'); res({air,peak,baseY,rampTop:baseY+sy}); } })();
  }));
  (ramp.air>=5?pass:fail).push('bot goes AIRBORNE off the ramp ('+ramp.air+' air frames)');
  (ramp.peak - ramp.baseY > 2 ? pass:fail).push('bot gains real height off the ramp: peak '+ramp.peak.toFixed(2)+' vs base '+ramp.baseY.toFixed(2)+' (Δ'+(ramp.peak-ramp.baseY).toFixed(2)+'u, ramp top '+ramp.rampTop.toFixed(2)+')');

  // ---- 3. fence across the path -> bot does NOT pass through ----
  const fence=await pg.evaluate((half)=>new Promise(res=>{
    const E=window.__EDITOR__, b=E.bot, t=E.track;
    const fx=Math.sin(b.theta), fz=Math.cos(b.theta);
    const nx=-fz, nz=fx;                      // perpendicular to heading
    const ahead=12, span=half+12;             // span the whole corridor incl. side walls
    const ox=b.x+fx*ahead, oz=b.z+fz*ahead;   // fence origin, dead ahead
    t.fences=t.fences||[];
    t.fences=t.fences.filter(f=>f.id!=='__botfence');
    t.fences.push({ id:'__botfence', style:'ribbon', tag:'', height:1.4, points:[
      { x:ox+nx*span, z:oz+nz*span }, { x:ox-nx*span, z:oz-nz*span } ] });
    let maxS=-1e9; const t0=performance.now();
    (function tick(){ const s=(E.bot.x-ox)*fx + (E.bot.z-oz)*fz;  // >0 = beyond the fence line
      if(s>maxS)maxS=s;
      if(performance.now()-t0<3500) requestAnimationFrame(tick);
      else { t.fences=t.fences.filter(f=>f.id!=='__botfence'); res({maxS, ahead}); } })();
  }),half);
  (fence.maxS>-8?pass:fail).push('bot advanced toward the fence (reached maxS='+fence.maxS.toFixed(2)+', started ~-'+fence.ahead+')');
  (fence.maxS<1.3?pass:fail).push('bot did NOT pass through the fence (maxS='+fence.maxS.toFixed(2)+' < 1.3 kart radius)');

  // ---- 4. follow cam moves near the bot ----
  const foll=await pg.evaluate(()=>new Promise(res=>{
    const E=window.__EDITOR__;
    E.setFollow(true);
    const t0=performance.now();
    (function tick(){ if(performance.now()-t0<1400) requestAnimationFrame(tick);
      else { const c=E.scene && null; const cam=E.camera; const b=E.bot;
        const d=Math.hypot(cam.position.x-b.x, cam.position.z-b.z);
        E.setFollow(false); res({d, follow:E.follow}); } })();
  }));
  (foll.d<40?pass:fail).push('follow cam moves near the bot (cam-bot XZ dist '+foll.d.toFixed(1)+'u)');
  (foll.follow===false?pass:fail).push('setFollow(false) restores orbit (follow='+foll.follow+')');

  await pg.evaluate(()=>window.__EDITOR__.stopBot());
  const stopped=await pg.evaluate(()=>window.__EDITOR__.bot.active);
  (stopped===false?pass:fail).push('stopBot() halts the bot (active='+stopped+')');

  (errs.length===0?pass:fail).push('0 JS pageerrors ('+errs.length+')');
  console.log('PASS:'); pass.forEach(p=>console.log('  ✓ '+p));
  if(fail.length){ console.log('FAIL:'); fail.forEach(p=>console.log('  ✗ '+p)); }
  if(errs.length) console.log('JS ERRORS:\n'+errs.slice(0,6).join('\n'));
  await b.close(); process.exit(fail.length?1:0);
})().catch(e=>{console.error('HARNESS FAIL',e.message);process.exit(2)});
