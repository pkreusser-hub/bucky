// _gffl_crest_shots.cjs — prove the GFFL crest lands top-right on both league pages,
// at phone and desktop widths, and photograph it.
//
//   node tools/_gffl_crest_shots.cjs
//
// Every plate asserts what its filename claims BEFORE it is written (house rule).
// Serves the worktree root itself rather than relying on a preview server, so it can
// never photograph a different checkout by accident.
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8871;
const BASE = "http://127.0.0.1:" + PORT;

let pass = 0, fail = 0; const failures = [];
function ok(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; failures.push(msg); console.log("  ✗ " + msg); }
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml" };

function serve() {
  return http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const f = path.join(ROOT, rel || "index.html");
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); return res.end("nope");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  }).listen(PORT);
}

async function launch() {
  const cands = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"];
  const exe = cands.find((c) => c && fs.existsSync(c));
  const opts = { headless: "new", args: ["--no-sandbox", "--force-device-scale-factor=2"] };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}

// The crest must sit in the top-right of the header, inside it, clear of the wordmark,
// and must not push the page sideways.
async function measure(page, label) {
  return page.evaluate((lbl) => {
    const c = document.querySelector("header .hcrest");
    if (!c) return { label: lbl, missing: true };
    const r = c.getBoundingClientRect();
    const h = document.querySelector("header").getBoundingClientRect();
    const wm = document.querySelector("header .wordmark").getBoundingClientRect();
    return {
      label: lbl,
      missing: false,
      loaded: c.complete && c.naturalWidth > 0,
      w: Math.round(r.width), h: Math.round(r.height),
      rightGap: Math.round(h.right - r.right),
      insideHeader: r.top >= h.top - 1 && r.bottom <= h.bottom + 1,
      rightOfWordmark: r.left >= wm.right,
      inRightHalf: r.left > (h.left + h.width / 2),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      src: c.getAttribute("src"),
    };
  }, label);
}

function judge(m, maxGap) {
  ok(!m.missing, `${m.label}: the crest is in the header`);
  if (m.missing) return;
  ok(m.loaded, `${m.label}: the PNG actually decoded (not a broken image)`);
  ok(m.h > 20 && m.h < 60, `${m.label}: sized for a header bar (${m.w}x${m.h})`);
  ok(m.insideHeader, `${m.label}: it sits INSIDE the header box, not overflowing it`);
  ok(m.inRightHalf, `${m.label}: it is in the right half of the header — "top right"`);
  ok(m.rightOfWordmark, `${m.label}: it clears the wordmark rather than overlapping it`);
  ok(m.rightGap >= 0 && m.rightGap <= maxGap,
    `${m.label}: hugs the right edge (${m.rightGap}px inset)`);
  ok(m.scrollW <= m.clientW,
    `${m.label}: adding it caused no sideways scroll (${m.scrollW}/${m.clientW})`);
  ok(/gffl-mark\.png$/.test(m.src), `${m.label}: it is the GFFL crest (${m.src})`);
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = serve();
  const browser = await launch();
  const errs = [];

  async function open(url, w, h) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errs.push(url + ": " + e.message));
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      // keep it deterministic + offline: only our own origin is answered
      if (r.url().startsWith(BASE)) r.continue(); else r.abort();
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("header .hcrest", { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 600));
    return page;
  }

  async function plate(page, file, h) {
    await page.screenshot({ path: path.join(SHOTS, file), clip: { x: 0, y: 0, width: page.viewport().width, height: h } });
    console.log("    → shots/" + file);
  }

  console.log("\n== league.html · phone 390 ==");
  let p = await open(BASE + "/league.html", 390, 844);
  judge(await measure(p, "league/mobile"), 20);
  await plate(p, "gffl_crest_league_390.png", 160);
  await p.close();

  console.log("\n== league.html · desktop 1440 ==");
  p = await open(BASE + "/league.html", 1440, 900);
  judge(await measure(p, "league/desktop"), 30);
  await plate(p, "gffl_crest_league_desktop.png", 160);
  await p.close();

  // The state the first cut of the CSS got wrong: on desktop #hMeta un-hides once data
  // lands and brings its OWN margin-left:auto. The crest must still be the rightmost thing
  // in the bar, with the week/avatar meta tucked immediately to its left — not split across
  // the header by two competing auto margins.
  console.log("\n== league.html · desktop 1440, WITH the week/avatar meta shown ==");
  p = await open(BASE + "/league.html", 1440, 900);
  await p.evaluate(() => {
    const m = document.getElementById("hMeta");
    m.removeAttribute("hidden");
    document.getElementById("hWeekYear").textContent = "WEEK 1 · 2026";
    const a = document.getElementById("hAvatar");
    a.removeAttribute("hidden"); a.textContent = "PK";
  });
  await new Promise((r) => setTimeout(r, 200));
  const withMeta = await measure(p, "league/desktop+meta");
  judge(withMeta, 30);
  const order = await p.evaluate(() => {
    const c = document.querySelector("header .hcrest").getBoundingClientRect();
    const m = document.getElementById("hMeta").getBoundingClientRect();
    return { crestLeft: Math.round(c.left), metaRight: Math.round(m.right), gap: Math.round(c.left - m.right) };
  });
  ok(order.gap >= 0 && order.gap <= 24,
    `league/desktop+meta: the meta sits immediately left of the crest, one tidy group (${order.gap}px apart)`);
  await plate(p, "gffl_crest_league_desktop_meta.png", 160);
  await p.close();

  console.log("\n== ffdraft.html · phone 390 ==");
  p = await open(BASE + "/ffdraft.html", 390, 844);
  judge(await measure(p, "draft/mobile"), 22);
  await plate(p, "gffl_crest_draft_390.png", 160);
  await p.close();

  console.log("\n== ffdraft.html · desktop 1440 ==");
  p = await open(BASE + "/ffdraft.html", 1440, 900);
  judge(await measure(p, "draft/desktop"), 22);
  await plate(p, "gffl_crest_draft_desktop.png", 160);
  await p.close();

  console.log("\n== the icon set ==");
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "league.webmanifest"), "utf8"));
  ok(man.icons.every((i) => /gffl-/.test(i.src)), "league.webmanifest points only at gffl-* icons");
  ok(man.icons.every((i) => fs.existsSync(path.join(ROOT, i.src))), "every icon it names exists on disk");
  ok(man.icons.some((i) => i.purpose === "maskable"), "a maskable pair is still declared");
  const fam = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.webmanifest"), "utf8"));
  ok(fam.icons.every((i) => !/gffl-/.test(i.src)),
    "the FAMILY app's manifest is untouched — it still wears the Bucky goat");
  for (const f of ["icon-192.png", "icon-512.png", "maskable-192.png", "maskable-512.png"]) {
    ok(fs.existsSync(path.join(ROOT, "icons", f)), "the family icon " + f + " still exists");
  }
  const lg = fs.readFileSync(path.join(ROOT, "league.html"), "utf8");
  ok(/apple-touch-icon" href="icons\/gffl-apple-touch\.png"/.test(lg), "league.html's iOS touch icon is the crest");

  ok(errs.length === 0, "0 page errors across all four loads" + (errs.length ? " (" + errs[0] + ")" : ""));

  await browser.close(); srv.close();
  console.log("\n================================");
  console.log("PASS " + pass + " · FAIL " + fail);
  if (fail) { console.log("\nFAILURES:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
