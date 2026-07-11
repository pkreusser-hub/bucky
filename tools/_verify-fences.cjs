const puppeteer=require('puppeteer-core');
const URL='http://localhost:8790/farmkart.html';
function minDist(fences,x,z){ let m=1e9; for(const f of fences){const p=f.points;for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];const abx=b.x-a.x,abz=b.z-a.z,L2=abx*abx+abz*abz||1e-6;let t=((x-a.x)*abx+(z-a.z)*abz)/L2;t=Math.max(0,Math.min(1,t));const cx=a.x+abx*t,cz=a.z+abz*t;const d=Math.hypot(x-cx,z-cz);if(d<m)m=d;}}return m; }
(async()=>{
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const pg=await b.newPage(); const errs=[], notfound=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  pg.on('console',m=>{if(m.type()==='error'&&!/status of 404/.test(m.text()))errs.push('console:'+m.text());});
  pg.on('response',r=>{ if(r.status()===404) notfound.push(r.url()); });
  await pg.goto(URL,{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__KART__ && window.__KART__.raceFences',{timeout:25000});
  await new Promise(r=>setTimeout(r,600));
  const info=await pg.evaluate(()=>{ const f=window.__KART__.raceFences; return { n:f.length, styles:[...new Set(f.map(x=>x.style))] }; });
  let pass=[], fail=[];
  (info.n>0?pass:fail).push('migrated fences present: '+info.n);
  (info.styles.length===1&&info.styles[0]==='ribbon'?pass:fail).push('all ribbon style: '+JSON.stringify(info.styles));
  const res=await pg.evaluate(async()=>{
    const K=window.__KART__; const f=K.raceFences; K.forceRace();
    const a=f[0].points[0], c=f[0].points[1]; const mx=(a.x+c.x)/2, mz=(a.z+c.z)/2;
    let nx=-(c.z-a.z), nz=(c.x-a.x); const nl=Math.hypot(nx,nz)||1; nx/=nl; nz/=nl;   // fence normal
    const s=K.state;
    s.pos.x=mx + nx*3; s.pos.z=mz + nz*3;          // start 3u OUTSIDE the fence on the +n side
    const spd=22;                                   // realistic top speed aimed straight at the fence
    const raf=()=>new Promise(r=>requestAnimationFrame(r));
    let maxCross=-9;
    for(let i=0;i<60;i++){ if(i<10){ s.v.x=-nx*spd; s.v.z=-nz*spd; } await raf();
      const cross=-((s.pos.x-mx)*nx+(s.pos.z-mz)*nz); if(cross>maxCross)maxCross=cross; }
    return { x:s.pos.x, z:s.pos.z, maxOut:maxCross };
  });
  const d=minDist(await pg.evaluate(()=>window.__KART__.raceFences), res.x, res.z);
  const rad=await pg.evaluate(()=>Math.max(0.6,window.__KART__.TUNE.kartRadius)+0.28);
  (res.maxOut < rad ? pass:fail).push('kart stopped at fence (no pass-through): deepestCrossing='+res.maxOut.toFixed(2)+' < rad '+rad.toFixed(2));
  (errs.length===0?pass:fail).push('0 JS pageerrors ('+errs.length+')');
  console.log('PASS:'); pass.forEach(p=>console.log('  ✓ '+p));
  if(fail.length){ console.log('FAIL:'); fail.forEach(p=>console.log('  ✗ '+p)); }
  if(errs.length) console.log('JS ERRORS:\n'+errs.slice(0,5).join('\n'));
  console.log('404s ('+notfound.length+'): '+[...new Set(notfound)].map(u=>u.split('/').pop()).join(', '));
  await b.close(); process.exit(fail.length?1:0);
})().catch(e=>{console.error('HARNESS FAIL',e.message);process.exit(2)});
