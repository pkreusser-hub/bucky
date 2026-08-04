#!/usr/bin/env node
"use strict";
/**
 * Capture the usage dashboard as it looked BEFORE the 2026-08-04 cleanup, for the before/after
 * pair in shots/. It renders the dashboard from a given git ref against the SAME fixture month
 * section O of _verify-storyledger.cjs uses, so the two plates are genuinely comparable.
 *
 *   node tools/_shot-usage-before.cjs [ref]     # ref defaults to the commit before HEAD
 *
 * The old page is extracted to a temp file next to the repo root (the page fetches root-relative
 * paths, so it has to be served from there) and deleted again on the way out.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFileSync } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8891;
const BASE = `http://127.0.0.1:${PORT}`;

// The same month the suite's section O uses.
const DAYS = [
  { date: "2026-08-04",
    s_in: 900000, s_out: 300000, s_req: 120, s_cw: 0, s_cr: 0,
    s_grok45_in: 900000, s_grok45_out: 300000, s_grok45_req: 120,
    r_in: 200000, r_out: 40000, r_req: 30, r_cw: 0, r_cr: 0,
    t_in: 60000, t_out: 20000, t_req: 6, t_cw: 0, t_cr: 0,
    f_in: 4000, f_out: 5000, f_req: 2, f_cw: 0, f_cr: 0,
    k_in: 300, k_out: 120, k_req: 1, a_in: 200, a_out: 400, a_req: 1,
    g_req: 1, c_in: 100, c_out: 40, c_req: 1,
    u_in: 0, u_out: 0, u_req: 0, d_in: 0, d_out: 0, d_req: 0,
    l_in: 20000, l_out: 8000, l_req: 100, l_cw: 0, l_cr: 0,
    x_in: 0, x_out: 0, x_req: 0 },
  { date: "2026-07-02", s_in: 100000, s_out: 20000, s_req: 10, s_cw: 0, s_cr: 0,
    r_in: 0, r_out: 0, r_req: 0, u_in: 0, u_out: 0, u_req: 0, d_in: 0, d_out: 0, d_req: 0,
    k_in: 0, k_out: 0, k_req: 0, a_in: 0, a_out: 0, a_req: 0, g_req: 0,
    c_in: 0, c_out: 0, c_req: 0, l_in: 0, l_out: 0, l_req: 0, x_in: 0, x_out: 0, x_req: 0 },
];

const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" };

const REF = process.argv[2] || "HEAD";
const TMP = path.join(ROOT, "_usage_before_tmp.html");

(async () => {
  fs.writeFileSync(TMP, execFileSync("git", ["show", `${REF}:farmgpt.html`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }));
  process.on("exit", () => { try { fs.unlinkSync(TMP); } catch {} });

  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.statusCode = 404; return res.end("no"); }
    res.setHeader("content-type", MIME[path.extname(p)] || "application/octet-stream");
    res.end(fs.readFileSync(p));
  });
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

  const browser = await puppeteer.launch({ channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    if (/cdn\.jsdelivr\.net/.test(url)) {
      return req.respond({ status: 200, contentType: "text/javascript",
        body: "window.marked={setOptions(){},parse(s){return s}};window.DOMPurify={sanitize(s){return s}};window.renderMathInElement=function(){};" });
    }
    if (/functions\/farmgpt/.test(url)) {
      let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch {}
      if (b.mode === "stats") {
        return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ days: DAYS, hours: [] }) });
      }
      return req.respond({ status: 200, contentType: "text/plain", body: "ok" });
    }
    if (/googleapis|firestore|firebase|gstatic/.test(url)) return req.abort();
    if (url.startsWith(BASE)) return req.continue();
    return req.abort();
  });

  await page.goto(BASE + "/_usage_before_tmp.html", { waitUntil: "domcontentloaded" });
  // The usage view is Dad-gated — unlock it the way a Dad session does, then click the real button.
  await page.evaluate(() => { localStorage.setItem("choreUser", "Dad"); sessionStorage.setItem("dadUnlocked", "1"); });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#usageBtn", { timeout: 15000 });
  await page.evaluate(() => document.getElementById("usageBtn").click());
  await page.waitForFunction("document.querySelectorAll('#usageSplit .usplit').length > 0", { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 400));

  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, "st_usage_before_mobile.png"), fullPage: true });
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll("#usageSplit .usplit")].map((e) => e.querySelector(".un").textContent));
  const total = await page.evaluate(() => document.querySelector("#usageBig .amt").textContent);
  await page.setViewport({ width: 1100, height: 900 });
  await page.evaluate(() => document.getElementById("usageBtn").click());
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(SHOTS, "st_usage_before.png"), fullPage: true });

  console.log("BEFORE rows (" + rows.length + "):");
  for (const r of rows) console.log("  · " + r);
  console.log("BEFORE headline: " + total);

  await browser.close();
  srv.close();
})();
