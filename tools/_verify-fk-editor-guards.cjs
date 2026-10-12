#!/usr/bin/env node
"use strict";
/**
 * Farm Kart track editor — unsaved-work guards + blocked-storage boot (2026-10-12 review fixes).
 *
 *   - the Load picker and Import ask before discarding unsaved edits (the same guard ＋ New course
 *     already had); cancelling keeps the track AND puts the picker back on the open track;
 *   - with nothing unsaved they still load / import without a prompt;
 *   - the editor boots when localStorage throws (Safari private mode / blocked site data) — two
 *     bare getItem calls used to abort the whole script.
 * The background cloud pull's dirty guard can't be driven headlessly here (Firestore is blocked
 * on purpose); it is a two-branch if in fkEdPullCloud.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8963;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
function check(cond, msg, detail) {
  if (cond) { pass++; console.log("  ok   " + msg); }
  else { fail++; console.log("  FAIL " + msg + (detail !== undefined ? "  -> " + JSON.stringify(detail) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) {
      try { await new Promise((res, rej) => { http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej); }); return; } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}

async function openEditor(browser, { blockStorage = false } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (req) => (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url()) ? req.abort() : req.continue()));
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (blockStorage) {
    await page.evaluateOnNewDocument(() => {
      const deny = () => { throw new DOMException("The operation is insecure.", "SecurityError"); };
      Storage.prototype.getItem = deny; Storage.prototype.setItem = deny;
    });
  } else {
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  }
  await page.goto(BASE + "/farmkart-editor.html", { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => !!window.__EDITOR__, { timeout: 30000 });
  await sleep(400);
  return { page, errors };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1", "-s"], { cwd: ROOT, stdio: "ignore", shell: true, detached: true });
  }
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  try {
    const { page, errors } = await openEditor(browser);
    const sig = () => page.evaluate(() => JSON.stringify(window.__EDITOR__.track.points.slice(0, 3)) + "|" + window.__EDITOR__.track.name);
    // pick a builtin other than the open track for the load-picker tests
    const other = await page.evaluate(() => {
      const sel = document.getElementById("loadSel"); const cur = sel.value;
      const o = [...sel.options].find((x) => x.value && x.value !== cur); return o ? o.value : null;
    });
    check(!!other, "load picker offers another track", other);

    // ---- Load picker: dirty + cancel → nothing changes, picker restored ----
    await page.evaluate(() => { const E = window.__EDITOR__; E.dragPointTo(0, E.track.points[0].x + 7, E.track.points[0].z); E.markDirty(); });
    const before = await sig();
    const r1 = await page.evaluate((other) => {
      let asked = 0; window.confirm = () => { asked++; return false; };
      const sel = document.getElementById("loadSel"); const was = sel.value;
      sel.value = other; sel.dispatchEvent(new Event("change"));
      return { asked, selAfter: sel.value, was, dirty: window.__EDITOR__.dirty };
    }, other);
    check(r1.asked === 1, "Load with unsaved edits asks first", r1);
    check((await sig()) === before && r1.dirty, "cancelling keeps the edited track (still dirty)", r1);
    check(r1.selAfter === r1.was, "cancelling puts the picker back on the open track", r1);

    // ---- Load picker: dirty + OK → loads ----
    const r2 = await page.evaluate((other) => {
      let asked = 0; window.confirm = () => { asked++; return true; };
      const sel = document.getElementById("loadSel"); sel.value = other; sel.dispatchEvent(new Event("change"));
      return { asked, dirty: window.__EDITOR__.dirty };
    }, other);
    check(r2.asked === 1 && (await sig()) !== before && !r2.dirty, "confirming loads the other track (clean)", r2);

    // ---- Load picker: clean → no prompt ----
    const r3 = await page.evaluate(() => {
      let asked = 0; window.confirm = () => { asked++; return true; };
      const sel = document.getElementById("loadSel"); sel.value = ""; sel.dispatchEvent(new Event("change"));
      return { asked };
    });
    check(r3.asked === 0, "with nothing unsaved, Load never prompts", r3);

    // ---- Import: dirty + cancel → unchanged; clean → imports ----
    await page.evaluate(() => { const E = window.__EDITOR__; E.dragPointTo(1, E.track.points[1].x + 5, E.track.points[1].z); E.markDirty(); });
    const before2 = await sig();
    const payload = await page.evaluate(() => {
      const t = JSON.parse(JSON.stringify(window.__EDITOR__.track)); t.name = "Imported Loop"; return JSON.stringify(t);
    });
    const r4 = await page.evaluate((payload) => {
      let asked = 0; window.confirm = () => { asked++; return false; };
      document.getElementById("io").value = payload; document.getElementById("impBtn").click();
      return { asked, name: window.__EDITOR__.track.name };
    }, payload);
    check(r4.asked === 1 && (await sig()) === before2, "Import over unsaved edits asks; cancel keeps them", r4);
    const r5 = await page.evaluate((payload) => {
      window.__EDITOR__.clearDirty(); let asked = 0; window.confirm = () => { asked++; return true; };
      document.getElementById("io").value = payload; document.getElementById("impBtn").click();
      return { asked, name: window.__EDITOR__.track.name };
    }, payload);
    check(r5.asked === 0 && r5.name === "Imported Loop", "Import with nothing unsaved goes straight through", r5);
    check(errors.length === 0, "0 pageerrors", errors);
    await page.close();

    // ---- blocked storage: the editor still boots ----
    const { page: bp, errors: be } = await openEditor(browser, { blockStorage: true });
    const booted = await bp.evaluate(() => !!(window.__EDITOR__ && window.__EDITOR__.track && window.__EDITOR__.track.points.length >= 8));
    check(booted, "editor boots with localStorage throwing");
    const bootErrs = be.filter((e) => /insecure|SecurityError/i.test(e));
    check(bootErrs.length === 0, "no uncaught storage SecurityError at boot", bootErrs);
    await bp.close();
  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (e) {} }
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
