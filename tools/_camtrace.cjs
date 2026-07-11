const puppeteer=require('puppeteer-core');
(async()=>{
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const pg=await b.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  await pg.goto('http://localhost:8790/farmkart.html',{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__KART__ && window.__KART__.state && window.__KART__.ACTIVE_TRACK',{timeout:25000});
  await new Promise(r=>setTimeout(r,400));
  const res=await pg.evaluate(async()=>{
    const K=window.__KART__; K.forceRace(); const s=K.state, AT=K.ACTIVE_TRACK;
    const th=s.theta, fx=Math.sin(th), fz=Math.cos(th);
    // enable follow-terrain + sculpt a big hill straddling the track ~25u ahead
    AT.followTerrain=true;
    AT.terrain={cell:6,cells:{}};
    const hx=s.pos.x+fx*30, hz=s.pos.z+fz*30;
    for(let i=-8;i<=8;i++)for(let j=-8;j<=8;j++){ const d=Math.hypot(i,j); if(d<9){ const gx=Math.round((hx/6))+i, gz=Math.round((hz/6))+j; AT.terrain.cells[gx+','+gz]=Math.round(12*Math.cos(d*0.32)*100)/100; } }
    const raf=()=>new Promise(r=>requestAnimationFrame(r));
    const ys=[];
    for(let i=0;i<90;i++){ s.v.x=fx*16; s.v.z=fz*16; await raf(); ys.push(K.camera.position.y); }
    // measure oscillation: count sign reversals of the frame-to-frame delta + max |delta|
    let reversals=0, maxAbsDelta=0, prevSign=0;
    for(let i=1;i<ys.length;i++){ const d=ys[i]-ys[i-1]; if(Math.abs(d)>maxAbsDelta)maxAbsDelta=Math.abs(d);
      const sgn=Math.sign(d); if(sgn!==0){ if(prevSign!==0 && sgn!==prevSign) reversals++; prevSign=sgn; } }
    return { frames:ys.length, reversals, maxAbsDelta:+maxAbsDelta.toFixed(3), camYRange:+(Math.max(...ys)-Math.min(...ys)).toFixed(2) };
  });
  let pass=[],fail=[];
  // a spazz = many rapid up/down reversals + large per-frame jumps. Smooth = few reversals, small deltas.
  (res.reversals <= 10 ? pass:fail).push('camera does NOT spazz: '+res.reversals+' direction reversals over '+res.frames+' frames (smooth = few)');
  (res.maxAbsDelta < 1.5 ? pass:fail).push('no big per-frame camera jumps: max Δy='+res.maxAbsDelta+'u');
  (errs.length===0?pass:fail).push('0 JS pageerrors ('+errs.length+')');
  console.log('PASS:'); pass.forEach(p=>console.log('  ✓ '+p));
  if(fail.length){ console.log('FAIL:'); fail.forEach(p=>console.log('  ✗ '+p)); }
  console.log('raw:',JSON.stringify(res)); if(errs.length)console.log(errs.slice(0,3).join('|'));
  await b.close(); process.exit(fail.length?1:0);
})().catch(e=>{console.error('HARNESS FAIL',e.message);process.exit(2)});
