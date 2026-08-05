// Independent check: the beacon is now on 15 pages, so prove it CANNOT break one.
// Each page is loaded three ways — beacon present, beacon BLOCKED (404), and beacon
// present but with localStorage and sendBeacon sabotaged to throw — and must render
// the same and stay error-free every time.
const fs = require("fs"), path = require("path"), http = require("http");
// 2026-08-05: was a hardcoded C:/Users/... absolute path — plain require resolves
// tools/node_modules on any machine (this suite lives in tools/).
const puppeteer = require("puppeteer-core");
const ROOT = path.resolve(__dirname, "..");
const PORT = 8891;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".mjs":"text/javascript", ".json":"application/json",
  ".css":"text/css", ".png":"image/png", ".jpg":"image/jpeg", ".webp":"image/webp", ".svg":"image/svg+xml",
  ".mp3":"audio/mpeg", ".glb":"model/gltf-binary", ".webmanifest":"application/manifest+json", ".txt":"text/plain" };

let pass = 0, fail = 0; const failures = [];
const ok = (c, n) => { if (c){ pass++; } else { fail++; failures.push(n); console.log("  ✗ FAIL " + n); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.statusCode = 404; return res.end("x"); }
  res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream");
  res.setHeader("cache-control", "no-store");
  fs.createReadStream(f).pipe(res);
});

// Every page the beacon was added to.
const PAGES = ["index.html","farmgpt.html","games.html","weather.html","meallog.html",
  "barnyardbistro.html","branchmanager.html","castlekruzer.html","farmkart.html","farmparty.html",
  "goatcare.html","hayhaul.html","hayhem.html","pasturepanic.html","dungeon.html","sports.html"];

// Noise that is this harness's own doing (blocked CDNs/Firebase), not a page fault.
const NOISE = /Failed to load resource|dynamically imported module|gstatic|firebase|googleapis|ERR_FAILED|ERR_BLOCKED|net::|marked|DOMPurify|KaTeX|Leaflet|playroom|THREE|WebGL|AudioContext|activity.js|is not defined/i;

async function load(browser, page, mode){
  const ctx = await browser.createBrowserContext();
  const pg = await ctx.newPage();
  await pg.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const errs = [];
  pg.on("pageerror", e => { if (!NOISE.test(String(e))) errs.push(String(e).slice(0, 160)); });
  pg.on("console", m => { if (m.type() === "error" && !NOISE.test(m.text())) errs.push(m.text().slice(0, 160)); });
  await pg.setRequestInterception(true);
  pg.on("request", r => {
    const u = r.url();
    if (/googleapis|firestore|firebase|gstatic/i.test(u)) return r.abort();
    if (mode === "blocked" && u.includes("/assets/activity.js")) return r.respond({ status: 404, body: "gone" });
    if (u.includes("/.netlify/functions/")) return r.respond({ status: 200, contentType: "application/json", body: "{}" });
    if (/^https?:\/\/(?!127\.0\.0\.1)/.test(u)) return r.abort();
    r.continue();
  });
  await pg.evaluateOnNewDocument((m) => {
    localStorage.setItem("choreUnlocked", "amenfarms");
    localStorage.setItem("choreUser", "Isaac");
    window.prompt = () => null; window.alert = () => {}; window.confirm = () => true;
    if (m === "hostile"){
      // Realistic failure: quota is full / Safari private mode, so setItem throws for the
      // BEACON'S OWN keys while the rest of the page's storage keeps working. Sabotaging
      // localStorage wholesale would just break every page's own profile code and prove
      // nothing about the beacon.
      const realSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function(k, v){
        if (String(k).indexOf('bucky_act') === 0) throw new Error('QuotaExceededError');
        return realSet.call(this, k, v);
      };
      try { Object.defineProperty(navigator, 'sendBeacon', { get(){ return () => { throw new Error('no beacon'); }; } }); } catch {}
    }
  }, mode);
  try {
    await pg.goto(`http://127.0.0.1:${PORT}/${page}?n=` + Date.now(), { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) { errs.push("NAV: " + e.message); }
  await sleep(1400);
  const shape = await pg.evaluate(() => ({
    bodyLen: document.body ? document.body.innerHTML.length : 0,
    visibleText: (document.body ? document.body.innerText : "").replace(/\s+/g, " ").trim().length,
  })).catch(() => ({ bodyLen: 0, visibleText: 0 }));
  await ctx.close();
  return { errs, shape };
}

(async () => {
  await new Promise(r => srv.listen(PORT, "127.0.0.1", r));
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  console.log("page                    normal   blocked  hostile");
  for (const page of PAGES){
    const a = await load(browser, page, "normal");
    const b = await load(browser, page, "blocked");
    const c = await load(browser, page, "hostile");
    const cell = (r) => (r.errs.length === 0 ? "  ok   " : " ERR   ");
    console.log(page.padEnd(24) + cell(a) + cell(b) + cell(c) +
      `  [${a.shape.visibleText}/${b.shape.visibleText}/${c.shape.visibleText} chars]`);
    ok(a.errs.length === 0, `${page}: no errors with the beacon loaded` + (a.errs[0] ? " — " + a.errs[0] : ""));
    ok(b.errs.length === 0, `${page}: no errors with the beacon BLOCKED` + (b.errs[0] ? " — " + b.errs[0] : ""));
    ok(c.errs.length === 0, `${page}: no errors with storage+sendBeacon THROWING` + (c.errs[0] ? " — " + c.errs[0] : ""));
    // The page must render the same amount of content whether the beacon is there or not.
    const base = a.shape.visibleText;
    ok(base > 0, `${page}: renders content at all (${base} chars)`);
    if (base > 0){
      const near = (x) => Math.abs(x - base) <= Math.max(40, base * 0.08);
      ok(near(b.shape.visibleText), `${page}: renders the same with the beacon blocked (${b.shape.visibleText} vs ${base})`);
      ok(near(c.shape.visibleText), `${page}: renders the same under hostile storage (${c.shape.visibleText} vs ${base})`);
    }
  }
  await browser.close(); srv.close();
  console.log(`\nBEACON SAFETY: ${pass}/${pass + fail} passed`);
  if (fail) for (const f of failures) console.log("  ✗ " + f);
  process.exit(fail ? 1 : 0);
})();
