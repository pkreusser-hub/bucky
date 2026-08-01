#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD shared test harness — static server + headless browser + check counter.
 * Used by every tools/_verify-farmstead-*.cjs suite.
 *
 * Browser resolution order:
 *   1. env CHROME_PATH (explicit)
 *   2. /opt/pw-browsers/chromium (cloud container's bundled Chromium)
 *   3. puppeteer channel "chrome" (user's desktop Chrome, Windows/mac)
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json",
  ".glb": "model/gltf-binary", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".txt": "text/plain",
};

function serveStatic(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = decodeURIComponent(req.url.split("?")[0]);
        let fp = path.join(ROOT, u === "/" ? "index.html" : u);
        if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end("nf"); }
        res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
        fs.createReadStream(fp).pipe(res);
      } catch (e) { res.writeHead(500); res.end(String(e)); }
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const pw = "/opt/pw-browsers/chromium";
  if (fs.existsSync(pw)) {
    // playwright dir may be the folder containing chrome binary
    const cands = [pw, path.join(pw, "chrome"), path.join(pw, "chrome-linux", "chrome")];
    for (const c of cands) { try { if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; } catch (_) {} }
  }
  return null; // fall back to channel:chrome
}

async function launch(opts = {}) {
  const exe = chromePath();
  const base = {
    headless: "new",
    // single evaluates that render 1000+ SwiftShader frames (visual suite's
    // film-strips) sit near puppeteer's default 180s protocol ceiling under
    // load — give the CDP channel real headroom, timeouts stay per-check
    protocolTimeout: 600000,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-dev-shm-usage"],
  };
  if (exe) base.executablePath = exe; else base.channel = "chrome";
  return puppeteer.launch(Object.assign(base, opts));
}

/** Standard suite scaffold. usage: harness.run("name", async (t)=>{ ... t.check(...) }) */
async function run(suiteName, fn, opts = {}) {
  const port = opts.port || 8900 + Math.floor(Math.random() * 60);
  const server = await serveStatic(port);
  const browser = await launch();
  const results = { pass: 0, fail: 0, names: [] };
  const t = {
    BASE: `http://127.0.0.1:${port}`,
    browser,
    errors: [],
    check(name, cond, extra) {
      const ok = !!cond;
      results[ok ? "pass" : "fail"]++;
      results.names.push(`${ok ? "PASS" : "FAIL"} ${name}${!ok && extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 300) : ""}`);
      console.log(`${ok ? "  ok" : "FAIL"}  ${name}${!ok && extra !== undefined ? "  ::  " + JSON.stringify(extra).slice(0, 300) : ""}`);
      return ok;
    },
    async newPage(vp) {
      const page = await browser.newPage();
      await page.setViewport(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
      page.on("pageerror", (e) => t.errors.push(String((e && e.message) || e)));
      page.on("console", (m) => { if (m.type() === "error") t.errors.push("console: " + m.text()); });
      // deterministic: block everything off-origin (no CDNs, no cloud)
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (req.url().startsWith(`http://127.0.0.1:${port}`)) return req.continue();
        return req.abort();
      });
      return page;
    },
    async shot(page, name) {
      const dir = path.join(ROOT, "shots");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const fp = path.join(dir, name.endsWith(".png") ? name : name + ".png");
      await page.screenshot({ path: fp });
      console.log("  shot →", path.relative(ROOT, fp));
      return fp;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
  let crashed = null;
  try { await fn(t); } catch (e) { crashed = e; }
  await browser.close().catch(() => {});
  server.close();
  const total = results.pass + results.fail;
  if (crashed) { console.error(`\n${suiteName}: CRASH after ${results.pass}/${total}:`, crashed && crashed.stack || crashed); process.exit(2); }
  console.log(`\n${suiteName}: ${results.pass}/${total} ${results.fail === 0 ? "PASS" : "FAIL"}`);
  if (results.fail) { results.names.filter((n) => n.startsWith("FAIL")).forEach((n) => console.log(" ", n)); process.exit(1); }
  process.exit(0);
}

module.exports = { run, launch, serveStatic, ROOT, chromePath };
