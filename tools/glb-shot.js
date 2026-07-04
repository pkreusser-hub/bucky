#!/usr/bin/env node
/*
 * glb-shot.js — render any GLB to PNG so results can be SEEN.
 *
 * Serves tools/glbview.html (a minimal three.js r128 + GLTFLoader page, same
 * CDN URLs as pasturepanic.html) over a local http-server, drives it with
 * headless Chrome via puppeteer-core, auto-frames the camera on the model's
 * bounding box, and screenshots the requested views.
 *
 * Usage:
 *   node tools/glb-shot.js assets/trough.glb [--out shots/trough.png] [--views front,three4,top]
 *   node tools/glb-shot.js assets/farmer.glb --anim 0 --frames 6 [--view three4]
 *
 * Default views: front,three4
 * Output naming: if --out is omitted, writes shots/<basename>-<view>.png per view.
 *                if --out is given and only one view is requested, writes exactly
 *                that path; with multiple views, "-<view>" is inserted before the extension.
 *
 * Animation strip mode (--anim <clipIndex>): steps an AnimationMixer through
 * N evenly-spaced points across one loop of the given clip (glTF animations[])
 * and captures one PNG per frame, writing shots/<basename>-anim<idx>-f<NN>.png.
 * Use --view (singular) to pick the camera angle for the strip (default three4).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, ".."); // BUCKY root
const SHOTS_DIR = path.join(ROOT, "shots");
const PORT = 8791;
const BASE_URL = `http://localhost:${PORT}`;

// ---------------------------------------------------------------- CLI args
function parseArgs(argv){
  const out = { glb: null, out: null, views: ["front", "three4"], w: 900, h: 900, anim: null, frames: 6, view: "three4" };
  const positional = [];
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    const next = () => argv[++i];
    switch (a){
      case "--out": out.out = next(); break;
      case "--views": out.views = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--w": out.w = parseInt(next(), 10); break;
      case "--h": out.h = parseInt(next(), 10); break;
      case "--anim": out.anim = parseInt(next(), 10); break;
      case "--frames": out.frames = parseInt(next(), 10); break;
      case "--view": out.view = next(); break;
      default:
        if (a.startsWith("--")){
          console.error(`Unknown argument: ${a}`);
          process.exit(1);
        }
        positional.push(a);
    }
  }
  out.glb = positional[0];
  return out;
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

async function waitForShotReady(page, timeoutMs){
  await page.waitForFunction("window.__shotReady === true", { timeout: timeoutMs });
  const err = await page.evaluate(() => window.__shotError);
  if (err) throw new Error(err);
}

// ------------------------------------------------------------------ main
function outPathForView(args, view, multiView){
  if (!args.out){
    const base = path.basename(args.glb, path.extname(args.glb));
    return path.join(SHOTS_DIR, `${base}-${view}.png`);
  }
  const outAbs = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  if (!multiView) return outAbs;
  const ext = path.extname(outAbs) || ".png";
  const withoutExt = outAbs.slice(0, -ext.length);
  return `${withoutExt}-${view}${ext}`;
}

async function main(){
  const args = parseArgs(process.argv.slice(2));
  if (!args.glb){
    console.error("Usage: node tools/glb-shot.js <path-to.glb> [--out shots/name.png] [--views front,three4,top]");
    process.exit(1);
  }

  const glbAbs = path.isAbsolute(args.glb) ? args.glb : path.join(ROOT, args.glb);
  if (!fs.existsSync(glbAbs)) throw new Error(`GLB not found: ${glbAbs}`);
  const glbRelFromRoot = path.relative(ROOT, glbAbs).split(path.sep).join("/");

  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  let serverChild = null;
  let browser = null;
  const written = [];

  try {
    serverChild = await ensureServer();
    browser = await launchBrowser();

    if (args.anim !== null){
      // Animation strip mode: N frames of one clip, same camera view for all.
      const base = path.basename(args.glb, path.extname(args.glb));
      for (let f = 0; f < args.frames; f++){
        const page = await browser.newPage();
        await page.setViewport({ width: args.w, height: args.h, deviceScaleFactor: 1 });
        page.on("pageerror", (err) => console.error("[page error]", err.message));
        page.on("console", (msg) => {
          if (msg.type() === "error") console.error("[console.error]", msg.text());
        });

        const qs = new URLSearchParams({
          glb: `/${glbRelFromRoot}`,
          view: args.view,
          w: String(args.w),
          h: String(args.h),
          anim: String(args.anim),
          frame: String(f),
          frames: String(args.frames),
        });
        const url = `${BASE_URL}/tools/glbview.html?${qs.toString()}`;
        console.log(`Rendering anim=${args.anim} frame ${f + 1}/${args.frames} from ${url}`);
        await page.goto(url, { waitUntil: "load", timeout: 30000 });
        await waitForShotReady(page, 20000);

        const frameLabel = String(f).padStart(2, "0");
        const outPath = args.out
          ? (() => {
              const outAbs = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
              const ext = path.extname(outAbs) || ".png";
              return `${outAbs.slice(0, -ext.length)}-f${frameLabel}${ext}`;
            })()
          : path.join(SHOTS_DIR, `${base}-anim${args.anim}-f${frameLabel}.png`);
        const outDir = path.dirname(outPath);
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        const canvas = await page.$("canvas");
        await canvas.screenshot({ path: outPath });
        written.push(outPath);

        await page.close();
      }

      console.log("\nFiles written:");
      for (const f of written){
        const size = fs.statSync(f).size;
        console.log(`  ${f}  (${size} bytes)${size < 5000 ? "  <-- suspiciously small, check for a blank frame" : ""}`);
      }
      return;
    }

    for (const view of args.views){
      const page = await browser.newPage();
      await page.setViewport({ width: args.w, height: args.h, deviceScaleFactor: 1 });
      page.on("pageerror", (err) => console.error("[page error]", err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") console.error("[console.error]", msg.text());
      });

      const qs = new URLSearchParams({ glb: `/${glbRelFromRoot}`, view, w: String(args.w), h: String(args.h) });
      const url = `${BASE_URL}/tools/glbview.html?${qs.toString()}`;
      console.log(`Rendering view "${view}" from ${url}`);
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await waitForShotReady(page, 20000);

      const outPath = outPathForView(args, view, args.views.length > 1);
      const outDir = path.dirname(outPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

      const canvas = await page.$("canvas");
      await canvas.screenshot({ path: outPath });
      written.push(outPath);

      await page.close();
    }

    console.log("\nFiles written:");
    for (const f of written){
      const size = fs.statSync(f).size;
      console.log(`  ${f}  (${size} bytes)${size < 5000 ? "  <-- suspiciously small, check for a blank frame" : ""}`);
    }
  } finally {
    if (browser) await browser.close();
    if (serverChild) stopServer(serverChild);
  }
}

main().catch((err) => {
  console.error("\nglb-shot.js failed:", err.message);
  process.exit(1);
});
