const http=require('http'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
const ROOT='C:/Users/pkreu/OneDrive/Documents/BUCKY';
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const server=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);fs.readFile(fp,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':MIME[path.extname(fp)]||'application/octet-stream'});r.end(d);});});
async function run(b,port,track){const pg=await b.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto(`http://localhost:${port}/farmkart.html?track=${track}`,{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__KART__ && window.__KART__.setupRoster',{timeout:20000});
  const res=await pg.evaluate(async()=>{const K=window.__KART__;K.G.botCount=3;K.setupRoster();K.placeAllAtGrid();K.startCountdown();K._setKeys('w',true);
    const bots=Object.values(K.G.players).filter(p=>p.isBot);
    const S=bots.map(b=>({driftFr:0,grassFr:0,fr:0,maxCharge:0,mt:0,prevA:false,prevC:0,maxLap:0,driftStints:0}));
    for(let f=0;f<3000;f++){await new Promise(r=>requestAnimationFrame(r));
      bots.forEach((bt,i)=>{const s=S[i];s.fr++;
        if(bt.drift.active)s.driftFr++;if(bt.drift.active&&!s.prevA)s.driftStints++;
        s.maxCharge=Math.max(s.maxCharge,bt.drift.charge||0);
        if(s.prevA&&!bt.drift.active&&s.prevC>=K.TUNE.mtTier1)s.mt++;s.prevA=bt.drift.active;s.prevC=bt.drift.charge||0;
        const cd=K.nearestCenterInfo(bt.pos.x,bt.pos.z).dist;if(cd>K.TRACK_WIDTH/2)s.grassFr++;
        if(typeof bt.lap==='number')s.maxLap=Math.max(s.maxLap,bt.lap);});}
    K._setKeys('w',false);
    return {bots:S.map(s=>({driftPct:Math.round(100*s.driftFr/s.fr),stints:s.driftStints,mt:s.mt,maxCharge:Math.round(s.maxCharge),grassPct:Math.round(100*s.grassFr/s.fr),lap:s.maxLap}))};});
  await pg.close();return {res,errs:errs.length};}
(async()=>{await new Promise(r=>server.listen(0,r));const port=server.address().port;
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  for(const track of ['mario-raceway','royal-raceway','kalimari-desert']){
    const {res,errs}=await run(b,port,track);
    console.log('=== '+track+' (errs='+errs+') ===');
    res.bots.forEach((s,i)=>console.log(`  bot${i}: drift ${s.driftPct}% (${s.stints} stints) · MT ${s.mt} · maxCharge ${s.maxCharge} · grass ${s.grassPct}% · lap ${s.lap}`));
  }
  await b.close();server.close();})().catch(e=>{console.error('FAIL',e.message);server.close();process.exit(1)});
