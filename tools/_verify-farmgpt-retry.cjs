/**
 * farmgpt.html callFarmGPT retry suite.
 *
 *   node tools/_verify-farmgpt-retry.cjs
 *
 * A single 504 from the farmgpt function used to surface straight to the reader as
 * "Request failed (504)" (seen live on Story Time 2026-08-19, upstream healthy on re-measure —
 * one gateway-timed-out response). callFarmGPT now retries ONCE on 502/503/504 and on a dropped
 * connection, and never on 4xx. This drives the REAL page in Chrome with the function
 * route-mocked to serve scripted status sequences.
 */
const fs = require("fs"), path = require("path"), http = require("http");
const puppeteer = require("C:/Users/pkreu/OneDrive/Documents/BUCKY/tools/node_modules/puppeteer-core");
const ROOT = path.resolve(__dirname, "..");
const PORT = 8897;
const MIME = { ".html":"text/html",".js":"text/javascript",".json":"application/json",".css":"text/css",".png":"image/png",".webmanifest":"application/manifest+json" };
const srv = http.createServer((req,res)=>{ let p=decodeURIComponent(req.url.split("?")[0]); if(p==="/")p="/farmgpt.html";
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.statusCode=404;return res.end("x");}
  res.setHeader("content-type",MIME[path.extname(f)]||"application/octet-stream"); res.setHeader("cache-control","no-store");
  fs.createReadStream(f).pipe(res); });
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let pass=0, fail=0; const bad=[];
const ok=(c,n)=>{ if(c){pass++;console.log("  ok  "+n);} else {fail++;bad.push(n);console.log("  FAIL "+n);} };

(async()=>{
  await new Promise(r=>srv.listen(PORT,"127.0.0.1",r));
  const browser = await puppeteer.launch({ channel:"chrome", headless:"new",
    args:["--use-angle=swiftshader","--enable-unsafe-swiftshader","--no-sandbox"] });
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  // Scripted per-call behaviour for the farmgpt function. hits[] records every attempt.
  const state = { plan: [], hits: [] };
  await pg.setRequestInterception(true);
  pg.on("request", r => { const u = r.url();
    if(/googleapis|firestore|firebase|gstatic/i.test(u)) return r.abort();   // MANDATORY (goat herd)
    if(u.includes("/.netlify/functions/farmgpt")){
      state.hits.push(Date.now());
      const step = state.plan.length ? state.plan.shift() : { status: 200 };
      if (step.drop) return r.abort("failed");
      if (step.status !== 200) return r.respond({ status: step.status, contentType:"application/json", body: JSON.stringify({}) });
      return r.respond({ status: 200, contentType:"text/plain; charset=utf-8", body: step.body || "Once upon a time, a goat." });
    }
    if(u.includes("/.netlify/functions/")) return r.respond({status:200,contentType:"application/json",body:"{}"});
    if(/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return r.abort();
    r.continue(); });
  await pg.evaluateOnNewDocument(()=>{ localStorage.setItem("choreUnlocked","amenfarms");
    localStorage.setItem("choreUser","Isaac");
    window.prompt=()=>null; window.alert=()=>{}; window.confirm=()=>true;
    window.DOMPurify={ sanitize:(x)=>x }; window.marked={ setOptions:()=>{}, parse:(x)=>x };
    window.katex={ render:()=>{} }; window.renderMathInElement=()=>{}; });
  await pg.goto(`http://127.0.0.1:${PORT}/farmgpt.html?n=`+Date.now(),{waitUntil:"domcontentloaded",timeout:60000});
  await sleep(1500);

  // callFarmGPT is module-scoped; reach it via a page-side driver that mirrors a story turn.
  const call = (plan) => pg.evaluate(async (p) => {
    window.__PLAN_SET__(p);
    const t0 = Date.now();
    try {
      const text = await window.__CALL__("story", [{role:"user",content:"test"}]);
      return { ok:true, text, ms: Date.now()-t0 };
    } catch(e){ return { ok:false, err:String(e && e.message || e), ms: Date.now()-t0 }; }
  }, plan);
  // Expose hooks: the plan setter proxies to node via a binding; callFarmGPT via a tiny shim.
  await pg.exposeFunction("__PLAN_PUSH__", (steps)=>{ state.plan = steps; state.hits = []; });
  await pg.evaluate(()=>{ window.__PLAN_SET__ = (p)=>window.__PLAN_PUSH__(p); });
  const hasHook = await pg.evaluate(()=>{
    // The page must give tests a handle on callFarmGPT. Prefer an existing export; else fail loudly.
    if (window.__FARMGPT__ && typeof window.__FARMGPT__.call === "function"){ window.__CALL__ = (m,msgs)=>window.__FARMGPT__.call(m,msgs,()=>{}); return "export"; }
    return "none";
  });
  ok(hasHook === "export", `farmgpt.html exposes callFarmGPT for tests (got: ${hasHook})`);

  if (hasHook === "export"){
    console.log("\n=== A. one 504 then success: the reader never sees the error ===");
    let r = await call([{status:504},{status:200,body:"The goat wins."}]);
    ok(r.ok, `succeeds despite a first-attempt 504 (${r.ok ? "text: "+r.text : "err: "+r.err})`);
    ok(state.hits.length === 2, `exactly two attempts were made (got ${state.hits.length})`);
    ok(r.ms >= 1400, `a backoff separated the attempts (${r.ms}ms total)`);

    console.log("\n=== B. two 504s: gives up with the honest status, not an infinite loop ===");
    r = await call([{status:504},{status:504}]);
    ok(!r.ok && /504/.test(r.err), `two consecutive 504s surface as an error (${r.err})`);
    ok(state.hits.length === 2, `…after exactly two attempts, never a third (got ${state.hits.length})`);

    console.log("\n=== C. a dropped connection retries too ===");
    r = await call([{drop:true},{status:200,body:"Recovered."}]);
    ok(r.ok && r.text === "Recovered.", `a network drop on attempt one recovers on attempt two`);

    console.log("\n=== D. 4xx is NOT retried — the request itself is wrong ===");
    r = await call([{status:403},{status:200}]);
    ok(!r.ok, "a 403 fails immediately");
    ok(state.hits.length === 1, `…with exactly one attempt (got ${state.hits.length})`);
  }

  await browser.close(); srv.close();
  console.log(`\nFARMGPT-RETRY: ${pass}/${pass+fail} passed`);
  if (fail) for (const f of bad) console.log("  FAIL " + f);
  process.exit(fail ? 1 : 0);
})();
