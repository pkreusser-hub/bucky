const puppeteer=require('puppeteer-core');
(async()=>{
  const b=await puppeteer.launch({channel:'chrome',headless:'new',args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--ignore-gpu-blocklist']});
  const pg=await b.newPage(); const errs=[];
  pg.on('pageerror',e=>errs.push(String(e)));
  pg.on('console',m=>{if(m.type()==='error'&&!/status of 404/.test(m.text()))errs.push('console:'+m.text());});
  await pg.goto('http://localhost:8790/farmkart-editor.html',{waitUntil:'load',timeout:45000});
  await pg.waitForFunction('window.__EDITOR__ && window.__EDITOR__.track',{timeout:25000});
  await new Promise(r=>setTimeout(r,700));
  let pass=[], fail=[];
  // 1. auto-materialized ribbon fences on the default track
  const f=await pg.evaluate(()=>{ const t=window.__EDITOR__.track; return { n:(t.fences||[]).length, styles:[...new Set((t.fences||[]).map(x=>x.style))], tags:[...new Set((t.fences||[]).map(x=>x.tag))] }; });
  (f.n>0?pass:fail).push('auto-materialized corridor fences: '+f.n+' style='+JSON.stringify(f.styles)+' tag='+JSON.stringify(f.tags));
  // 2. new controls exist
  const dom=await pg.evaluate(()=>({ rail:!!document.getElementById('fStyleRail'), ribbon:!!document.getElementById('fStyleRibbon'), fromEdges:!!document.getElementById('fFromEdges'), world:!!document.getElementById('worldInp') }));
  (dom.rail&&dom.ribbon&&dom.fromEdges&&dom.world?pass:fail).push('new controls present: '+JSON.stringify(dom));
  // 3. fence style toggle → new fence gets ribbon style
  const styleTest=await pg.evaluate(()=>{ const E=window.__EDITOR__; E.setMode('fence');
    document.getElementById('fStyleRibbon').click();
    // simulate two ground clicks via the internal addFencePoint through mode? use a direct path:
    // draw by pushing to track.fences via the public flow isn't exposed; instead check the flag took by drawing:
    return document.getElementById('fStyleRibbon').classList.contains('on') && !document.getElementById('fStyleRail').classList.contains('on');
  });
  (styleTest?pass:fail).push('ribbon style button toggles active state');
  // 4. world size input sets groundMargin
  const wt=await pg.evaluate(()=>{ const i=document.getElementById('worldInp'); i.value='120'; i.dispatchEvent(new Event('change')); return window.__EDITOR__.track.groundMargin; });
  (wt===120?pass:fail).push('world size input sets groundMargin: '+wt);
  // 5. fFromEdges regenerates
  const fe=await pg.evaluate(()=>{ document.getElementById('fFromEdges').click(); const t=window.__EDITOR__.track; return (t.fences||[]).filter(x=>x.tag==='corridor').length; });
  (fe>0?pass:fail).push('⟲ from-edges regenerates ribbon walls: '+fe);
  (errs.length===0?pass:fail).push('0 JS pageerrors ('+errs.length+')');
  console.log('PASS:'); pass.forEach(p=>console.log('  ✓ '+p));
  if(fail.length){ console.log('FAIL:'); fail.forEach(p=>console.log('  ✗ '+p)); }
  if(errs.length) console.log('JS ERRORS:\n'+errs.slice(0,6).join('\n'));
  await b.close(); process.exit(fail.length?1:0);
})().catch(e=>{console.error('HARNESS FAIL',e.message);process.exit(2)});
