const http=require('http'),fs=require('fs'),path=require('path'),puppeteer=require('puppeteer-core');
const ROOT='C:/Users/pkreu/OneDrive/Documents/BUCKY';
const MIME={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary'};
const server=http.createServer((q,r)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';const fp=path.join(ROOT,p);fs.readFile(fp,(e,d)=>{if(e){r.writeHead(404);r.end();return;}r.writeHead(200,{'content-type':MIME[path.extname(fp)]||'application/octet-stream'});r.end(d);});});
async function run(b,port,track,spread){const pg=await b.newPage();const errs=[];pg.on('pageerror',e=>errs.push(e.message));
  await pg.goto(`http://localhost:${port}/farmkart.html?track=${track}`,{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__KART__ && window.__KART__.setupRoster',{timeout:20000});
  const res=await pg.evaluate(async(spread)=>{const K=window.__KART__;K.TUNE.botLaneSpread=spread;K.G.botCount=3;K.setupRoster();K.placeAllAtGrid();K.startCountdown();K._setKeys('w',true);
    const bots=Object.values(K.G.players).filter(p=>p.isBot);const C=K.centerPts,N=C.length;const half=K.TRACK_WIDTH/2;
    const lanes=bots.map(b=>+((b.laneBias)||0).toFixed(2)), skills=bots.map(b=>+(b.botSkill).toFixed(2));
    function lateral(bt){const info=K.nearestCenterInfo(bt.pos.x,bt.pos.z);const i=info.idx;const a=C[i],c=C[(i+1)%N];let tx=c.x-a.x,tz=c.z-a.z;const tl=Math.hypot(tx,tz)||1;tx/=tl;tz/=tl;const nx=-tz,nz=tx;return (bt.pos.x-a.x)*nx+(bt.pos.z-a.z)*nz;}
    let spreadSum=0,minSepSum=0,fr=0,grassFr=0;
    for(let f=0;f<1800;f++){await new Promise(r=>requestAnimationFrame(r));fr++;
      const lats=bots.map(lateral);spreadSum+=Math.max(...lats)-Math.min(...lats);
      let minSep=1e9;for(let a=0;a<bots.length;a++)for(let c=a+1;c<bots.length;c++){const d=Math.hypot(bots[a].pos.x-bots[c].pos.x,bots[a].pos.z-bots[c].pos.z);if(d<minSep)minSep=d;}minSepSum+=minSep;
      for(const bt of bots)if(K.nearestCenterInfo(bt.pos.x,bt.pos.z).dist>half)grassFr++;
    }
    K._setKeys('w',false);
    return {lanes,skills,avgLateralSpread:+(spreadSum/fr).toFixed(1),avgMinSeparation:+(minSepSum/fr).toFixed(1),grassPct:Math.round(100*grassFr/(fr*bots.length))};});
  await pg.close();return {res,errs:errs.length};}
(async()=>{await new Promise(r=>server.listen(0,r));const port=server.address().port;
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  for(const track of ['mario-raceway','kalimari-desert']){
    const off=await run(b,port,track,0); const on=await run(b,port,track,0.5);
    console.log(`=== ${track} ===`);
    console.log(`  spread OFF: lateralSpread ${off.res.avgLateralSpread}m · minSep ${off.res.avgMinSeparation}m · grass ${off.res.grassPct}% · errs ${off.errs}`);
    console.log(`  spread ON : lateralSpread ${on.res.avgLateralSpread}m · minSep ${on.res.avgMinSeparation}m · grass ${on.res.grassPct}% · lanes ${JSON.stringify(on.res.lanes)} skills ${JSON.stringify(on.res.skills)} · errs ${on.errs}`);
  }
  await b.close();server.close();})().catch(e=>{console.error('FAIL',e.message);server.close();process.exit(1)});
