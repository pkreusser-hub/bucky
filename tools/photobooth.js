#!/usr/bin/env node
/*
 * photobooth.js — headless PNG capture for BUCKY's 3D games.
 *
 * Renders a game page (with ?photo=1 and friends) in headless Chrome and saves
 * screenshots of the <canvas> to shots/, so art/animation can be reviewed by
 * reading image files instead of eyeballing a live browser tab.
 *
 * Usage:
 *   node photobooth.js [--url URL | --game goatcare] [--out shots/name.png]
 *                       [--w 900 --h 900] [--frames N --every MS]
 *                       [--params "pose=pronk&hour=14&cam=three4"]
 *
 * Examples:
 *   node photobooth.js --params "pose=stand&hour=14&cam=three4"
 *   node photobooth.js --params "pose=lie&hour=23&cam=front"
 *   node photobooth.js --params "pose=pronk&cam=three4" --frames 6 --every 100 --out shots/pronk.png
 *
 * Notes:
 *   - Uses puppeteer-core with the system-installed Chrome (channel: 'chrome').
 *     No bundled Chromium is downloaded.
 *   - If http://localhost:8790 isn't already serving the game files, this script
 *     spawns `npx http-server -p 8790 -c-1` in the BUCKY root and tears it down
 *     on exit.
 */

"use strict";

const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, ".."); // BUCKY root
const SHOTS_DIR = path.join(ROOT, "shots");
const PORT = 8790;
const BASE_URL = `http://localhost:${PORT}`;

// ---------------------------------------------------------------- CLI args
function parseArgs(argv){
  const out = {
    url: null,
    game: "goatcare",
    out: null,
    w: 900,
    h: 900,
    frames: 1,
    every: 200,
    params: "",
  };
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    const next = () => argv[++i];
    switch (a){
      case "--url": out.url = next(); break;
      case "--game": out.game = next(); break;
      case "--out": out.out = next(); break;
      case "--w": out.w = parseInt(next(), 10); break;
      case "--h": out.h = parseInt(next(), 10); break;
      case "--frames": out.frames = parseInt(next(), 10); break;
      case "--every": out.every = parseInt(next(), 10); break;
      case "--params": out.params = next(); break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(1);
    }
  }
  return out;
}

function slugifyParams(params){
  if (!params) return "shot";
  return params
    .replace(/&/g, "_")
    .replace(/=/g, "-")
    .replace(/[^a-zA-Z0-9_\-.]/g, "");
}

// ------------------------------------------------------------ http-server
function isPortOpen(port){
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { resolve(false); });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
  });
}

function waitForServer(port, timeoutMs){
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll(){
      const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) reject(new Error(`Timed out waiting for server on port ${port}`));
        else setTimeout(poll, 200);
      });
      req.on("timeout", () => { req.destroy(); });
    })();
  });
}

async function ensureServer(){
  const open = await isPortOpen(PORT);
  if (open) return null; // already running, nothing to spawn/kill

  console.log(`Port ${PORT} not responding — starting http-server in ${ROOT} ...`);
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";
  const child = spawn(cmd, ["http-server", "-p", String(PORT), "-c-1", "-s"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: isWin,
  });

  let out = "";
  child.stdout && child.stdout.on("data", (d) => { out += d.toString(); });
  child.stderr && child.stderr.on("data", (d) => { out += d.toString(); });

  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !child._killedByUs){
      console.error("http-server exited unexpectedly:\n" + out);
    }
  });

  await waitForServer(PORT, 15000);
  console.log(`http-server ready on ${BASE_URL}`);
  return child;
}

function stopServer(child){
  if (!child) return;
  child._killedByUs = true;
  try {
    if (process.platform === "win32"){
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (e){
    console.error("Failed to stop http-server:", e.message);
  }
}

// -------------------------------------------------------------- puppeteer
async function launchBrowser(){
  const launchOpts = {
    channel: "chrome",
    headless: "new",
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--disable-gpu-sandbox",
      "--no-sandbox",
    ],
  };
  try {
    return await puppeteer.launch(launchOpts);
  } catch (e){
    console.error("Failed to launch Chrome via channel:'chrome'. Is Google Chrome installed?");
    throw e;
  }
}

async function canvasHasContent(page){
  // Non-black / non-empty heuristic: sample pixels off the canvas via toDataURL
  // and check we got a reasonably sized, non-trivial image.
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return { ok: false, reason: "no canvas element" };
    try {
      const ctx = canvas.getContext("2d") || canvas.getContext("webgl") || canvas.getContext("webgl2");
      // For WebGL canvases we can't read pixels this way reliably without extra work;
      // rely on toDataURL length as a cheap non-blank heuristic instead.
      const dataUrl = canvas.toDataURL("image/png");
      return { ok: dataUrl.length > 5000, reason: "dataUrl length " + dataUrl.length };
    } catch (e){
      return { ok: false, reason: e.message };
    }
  });
}

async function waitForPhotoReady(page, timeoutMs){
  try {
    await page.waitForFunction("window.__photoReady === true", { timeout: timeoutMs });
  } catch (e){
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for window.__photoReady === true. ` +
      `Check that ?photo=1 is set and that goatcare.html's photo-mode block ran without errors.`
    );
  }
}

async function screenshotCanvas(page, outPath){
  const canvas = await page.$("canvas");
  if (!canvas) throw new Error("No <canvas> element found on the page.");
  await canvas.screenshot({ path: outPath });
}

// ------------------------------------------------------------------ main
async function main(){
  const args = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  let serverChild = null;
  let browser = null;
  const writtenFiles = [];

  try {
    // Build the URL
    let url;
    if (args.url){
      url = args.url;
    } else {
      serverChild = await ensureServer();
      const qs = new URLSearchParams(args.params || "");
      qs.set("photo", "1");
      url = `${BASE_URL}/${args.game}.html?${qs.toString()}`;
    }
    // If a URL was explicitly given, still make sure something's listening
    // (only relevant for the default localhost case — explicit --url is the caller's responsibility).
    if (!args.url && !serverChild){
      // ensureServer already confirmed port is open in this branch
    }

    console.log(`Loading ${url}`);
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: args.w, height: args.h, deviceScaleFactor: 1 });

    page.on("pageerror", (err) => console.error("[page error]", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("[console.error]", msg.text());
    });

    await page.goto(url, { waitUntil: "load", timeout: 30000 });

    await waitForPhotoReady(page, 10000);

    const content = await canvasHasContent(page);
    if (!content.ok){
      console.error(`Warning: canvas content check failed (${content.reason}). Screenshot may be blank/black.`);
    }

    // Determine output path(s)
    const slug = args.out ? null : `${args.game}-${slugifyParams(args.params)}`;
    const baseOut = args.out ? args.out : path.join("shots", `${slug}.png`);
    const baseOutAbs = path.isAbsolute(baseOut) ? baseOut : path.join(ROOT, baseOut);
    const baseDir = path.dirname(baseOutAbs);
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

    if (args.frames <= 1){
      await screenshotCanvas(page, baseOutAbs);
      writtenFiles.push(baseOutAbs);
    } else {
      const ext = path.extname(baseOutAbs) || ".png";
      const withoutExt = baseOutAbs.slice(0, -ext.length);
      for (let i = 0; i < args.frames; i++){
        const framePath = `${withoutExt}-f${String(i).padStart(2, "0")}${ext}`;
        await screenshotCanvas(page, framePath);
        writtenFiles.push(framePath);
        if (i < args.frames - 1) await new Promise((r) => setTimeout(r, args.every));
      }
    }

    // Report file sizes for a quick non-black sanity check
    console.log("\nFiles written:");
    for (const f of writtenFiles){
      const size = fs.statSync(f).size;
      console.log(`  ${f}  (${size} bytes)${size < 20000 ? "  <-- suspiciously small, check for a black/blank frame" : ""}`);
    }
  } finally {
    if (browser) await browser.close();
    if (serverChild) stopServer(serverChild);
  }
}

main().catch((err) => {
  console.error("\nphotobooth.js failed:", err.message);
  process.exit(1);
});
