#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD art-direction prototype — screenshot driver.
 * Uses the repo's own harness conventions (serveStatic from the repo root +
 * the same puppeteer launch), so it behaves exactly like tools/_verify-*.cjs.
 *
 *   node farmstead-proto/_shots.cjs            → all 12 shots into shots/
 *   node farmstead-proto/_shots.cjs 2b         → just one (style+proportions)
 *   node farmstead-proto/_shots.cjs probe      → boot info for every variant, no shots
 */
const path = require("path");
const H = require(path.resolve(__dirname, "..", "tools", "_fs_harness.cjs"));

const PORT = 8871;
const ARG = (process.argv[2] || "").toLowerCase();

async function shoot(browser, url, file, vp) {
  const page = await browser.newPage();
  await page.setViewport(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.message) || e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith(`http://127.0.0.1:${PORT}`) ? r.continue() : r.abort()));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__PROTO_READY__ || window.__PROTO_ERR__, { timeout: 60000 });
  const info = await page.evaluate(() => window.__PROTO_INFO__ || { err: window.__PROTO_ERR__ });
  if (file) {
    const fp = path.resolve(__dirname, "..", "shots", file);
    await page.screenshot({ path: fp });
  }
  await page.close();
  return { info, errs };
}

(async () => {
  const server = await H.serveStatic(PORT);
  const browser = await H.launch();
  const BASE = `http://127.0.0.1:${PORT}/farmstead-proto/proto.html`;
  const EXTRA = process.env.PROTO_EXTRA || "";     // e.g. "&yaw=1.2&dist=26"
  let bad = 0;

  const jobs = [];
  for (let s = 1; s <= 4; s++) {
    jobs.push({ q: `?style=${s}${EXTRA}`, f: `proto_s${s}_a.png`, id: `${s}a` });
    jobs.push({ q: `?style=${s}&proportions=b${EXTRA}`, f: `proto_s${s}_b.png`, id: `${s}b` });
  }
  for (let s = 1; s <= 4; s++) {
    jobs.push({ q: `?style=${s}&close=1${EXTRA}`, f: `proto_s${s}_close.png`, id: `${s}c` });
  }

  const run = ARG && ARG !== "probe" ? jobs.filter((j) => j.id === ARG) : jobs;
  for (const j of run) {
    const r = await shoot(browser, BASE + j.q, ARG === "probe" ? null : j.f, null);
    const i = r.info || {};
    console.log(
      `${j.f.padEnd(20)} ${String(i.styleName || i.err).padEnd(10)} prop=${i.proportions} ` +
      `serfs=${i.serfs} flags=${i.flags} roads=${i.roads} bld=${i.buildings} ` +
      `draws=${i.draws} ink=${i.outlined} yaw=${i.yaw} dist=${i.dist}` +
      (r.errs.length ? `\n   !! ${r.errs.slice(0, 3).join(" | ")}` : "")
    );
    if (r.errs.length || i.err) bad++;
  }

  await browser.close();
  server.close();
  console.log(bad ? `\n${bad} variant(s) reported page errors` : `\nall clean — ${run.length} render(s)`);
  process.exit(bad ? 1 : 0);
})();
