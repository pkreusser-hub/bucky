const puppeteer=require('puppeteer-core');
(async()=>{
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const pg=await b.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  pg.on('console',m=>{if(m.type()==='error'&&!/status of 404/.test(m.text()))errs.push('con:'+m.text());});
  await pg.goto('http://localhost:8790/farmkart.html',{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__KART__ && window.__KART__.state && window.__KART__.ACTIVE_TRACK',{timeout:25000});
  await new Promise(r=>setTimeout(r,500));
  async function run(sy,sz,spd,holdAll){
    return await pg.evaluate(async(sy,sz,spd,holdAll)=>{
      const K=window.__KART__; K.forceRace(); const s=K.state, AT=K.ACTIVE_TRACK;
      const th=s.theta, fx=Math.sin(th), fz=Math.cos(th);
      const trackY=K.sampleHeight(s.pos.x, s.pos.z);
      const cx=s.pos.x + fx*(sz/2+5), cz=s.pos.z + fz*(sz/2+5);
      AT.objects=(AT.objects||[]).filter(o=>o.id!=='tr');
      AT.objects.push({ id:'tr', type:'ramp', x:cx, y:trackY+sy/2, z:cz, rotY:th, sx:12, sy, sz, color:0xb8863f });
      const raf=()=>new Promise(r=>requestAnimationFrame(r));
      let peakY=-999, airFrames=0, boostSeen=0, launched=false;
      for(let i=0;i<120;i++){ if(holdAll || !launched){ s.v.x=fx*spd; s.v.z=fz*spd; } await raf();  // bot keeps throttle until airborne
        if(s.airborne){ launched=true; airFrames++; } if(s.y>peakY)peakY=s.y; if(s.boostT>0)boostSeen++;
      }
      AT.objects=AT.objects.filter(o=>o.id!=='tr');
      return { airAboveLaunch:+(peakY-trackY).toFixed(2), airFrames, boostSeen };
    }, sy, sz, spd, holdAll);
  }
  const player = await run(3.5,18,20,false);
  const botlike = await run(3.5,18,12,false);   // sustained until launch (bot behavior)
  let pass=[],fail=[];
  (player.airAboveLaunch>4.5?pass:fail).push('player (fast): big air — '+player.airAboveLaunch+'u above launch');
  (player.boostSeen>0?pass:fail).push('player: ramp = boost ('+player.boostSeen+' frames)');
  (botlike.airFrames>=8?pass:fail).push('bot-like (slow) gets real air time — '+botlike.airFrames+' frames');
  (botlike.airAboveLaunch>4?pass:fail).push('bot-like: clears above the ramp top — '+botlike.airAboveLaunch+'u (ramp top 3.5)');
  (botlike.boostSeen>0?pass:fail).push('bot-like: ramp = boost ('+botlike.boostSeen+' frames)');
  (errs.length===0?pass:fail).push('0 JS pageerrors ('+errs.length+')');
  console.log('PASS:'); pass.forEach(p=>console.log('  ✓ '+p));
  if(fail.length){ console.log('FAIL:'); fail.forEach(p=>console.log('  ✗ '+p)); }
  if(errs.length) console.log(errs.slice(0,4).join('|'));
  console.log('player:',JSON.stringify(player),' botlike:',JSON.stringify(botlike));
  await b.close(); process.exit(fail.length?1:0);
})().catch(e=>{console.error('HARNESS FAIL',e.message);process.exit(2)});
