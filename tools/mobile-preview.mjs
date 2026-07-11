#!/usr/bin/env node
/**
 * mobile-preview.mjs — reliable phone-viewport preview for Bucky pages & games.
 *
 * Starts/reuses the local static server (port 8790, same as photobooth / launch
 * "bucky-static"), opens system Chrome at a phone size, and stubs
 * matchMedia('(pointer: coarse)') so Farm Kart / touch UIs actually appear
 * (Chrome desktop never reports coarse pointer even in a narrow window).
 *
 * Usage (from BUCKY root):
 *   node tools/mobile-preview.mjs --picker
 *   node tools/mobile-preview.mjs farmkart.html
 *   node tools/mobile-preview.mjs index.html --shot
 *   node tools/mobile-preview.mjs --all
 *   node tools/mobile-preview.mjs weather.html --device se --dpr 3
 *
 * Flags:
 *   --picker        open phone-size chooser (big buttons → Bucky pages)
 *   --shot          save shots/mobile-<page>.png then exit (headless)
 *   --all           smoke-screenshot COMMON_PAGES (implies --shot)
 *   --list          print common pages and exit
 *   --device NAME    iphone14 (default) | se | pixel | ipad
 *   --w N --h N     override viewport CSS pixels
 *   --dpr N         deviceScaleFactor (default 2)
 *   --headed        keep a visible Chrome window (default without --shot/--all)
 *   --headless      force headless (default with --shot/--all)
 *   --no-coarse     skip the pointer:coarse stub (desktop touch detection)
 *   --port N        static server port (default 8790)
 *   --url URL       full URL override (skips path + server for that load)
 *   --wait MS       settle time before screenshot (default 1500)
 *   --help
 *
 * One-click: double-click Mobile Preview.bat at the repo root (runs --picker).
 *
 * Gotchas:
 *   - Never use file:// — assets and CORS break. Always http://localhost.
 *   - Farm Kart IS_MOBILE needs the coarse-pointer stub (on by default).
 *   - Cursor Launch preview tabs can be document.hidden → WebGL/rAF stall;
 *     this CLI opens a real Chrome window (or headless for shots).
 */

import path from "path";
import fs from "fs";
import net from "net";
import http from "http";
import { spawn } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const puppeteer = require("puppeteer-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SHOTS_DIR = path.join(ROOT, "shots");

const DEVICES = {
  iphone14: { w: 390, h: 844, label: "iPhone 14" },
  se: { w: 375, h: 667, label: "iPhone SE" },
  pixel: { w: 412, h: 915, label: "Pixel 7" },
  ipad: { w: 768, h: 1024, label: "iPad portrait" },
};

/** Pages worth a daily mobile glance. */
const COMMON_PAGES = [
  "index.html",
  "games.html",
  "farmgpt.html",
  "weather.html",
  "farmkart.html",
  "barnyardbistro.html",
  "goatcare.html",
  "pasturepanic.html",
];

const PICKER_PAGE = "tools/mobile-preview-picker.html";

function usage() {
  console.log(`mobile-preview — Bucky phone viewport

  node tools/mobile-preview.mjs --picker
  node tools/mobile-preview.mjs <page.html> [flags]
  node tools/mobile-preview.mjs --all
  node tools/mobile-preview.mjs --list

  Or double-click Mobile Preview.bat (opens --picker).

Devices: ${Object.keys(DEVICES).join(", ")}
Common:  ${COMMON_PAGES.join(", ")}

Examples:
  node tools/mobile-preview.mjs --picker
  node tools/mobile-preview.mjs farmkart.html
  node tools/mobile-preview.mjs index.html --shot
  node tools/mobile-preview.mjs --all --device se
`);
}

function parseArgs(argv) {
  const out = {
    page: null,
    shot: false,
    all: false,
    list: false,
    picker: false,
    help: false,
    device: "iphone14",
    w: null,
    h: null,
    dpr: 2,
    headed: null, // null = auto
    coarse: true,
    port: 8790,
    url: null,
    wait: 1500,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v == null) throw new Error(`Missing value after ${a}`);
      return v;
    };
    switch (a) {
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--picker":
        out.picker = true;
        break;
      case "--shot":
        out.shot = true;
        break;
      case "--all":
        out.all = true;
        out.shot = true;
        break;
      case "--list":
        out.list = true;
        break;
      case "--device":
        out.device = next();
        break;
      case "--w":
        out.w = parseInt(next(), 10);
        break;
      case "--h":
        out.h = parseInt(next(), 10);
        break;
      case "--dpr":
        out.dpr = parseFloat(next());
        break;
      case "--headed":
        out.headed = true;
        break;
      case "--headless":
        out.headed = false;
        break;
      case "--no-coarse":
        out.coarse = false;
        break;
      case "--port":
        out.port = parseInt(next(), 10);
        break;
      case "--url":
        out.url = next();
        break;
      case "--wait":
        out.wait = parseInt(next(), 10);
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        positionals.push(a);
    }
  }
  if (positionals.length > 1) throw new Error("Pass at most one page path");
  if (positionals[0]) out.page = positionals[0];
  return out;
}

function normalizePage(page) {
  if (!page) return null;
  let p = page.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p.includes(".") && !p.endsWith("/")) p += ".html";
  return p.replace(/^\//, "");
}

function shotName(pagePath) {
  const base = path.basename(pagePath || "page", path.extname(pagePath || ""))
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-|-$/g, "") || "page";
  return `mobile-${base}.png`;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function waitForServer(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (function poll() {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 1000 },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on("error", () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for server on port ${port}`));
        } else setTimeout(poll, 200);
      });
      req.on("timeout", () => {
        req.destroy();
      });
    })();
  });
}

async function ensureServer(port) {
  if (await isPortOpen(port)) return null;
  console.log(`Port ${port} free — starting http-server in ${ROOT} ...`);
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npx.cmd" : "npx";
  const child = spawn(cmd, ["-y", "http-server", "-p", String(port), "-c-1", "-s"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    shell: isWin,
  });
  let out = "";
  child.stdout?.on("data", (d) => {
    out += d.toString();
  });
  child.stderr?.on("data", (d) => {
    out += d.toString();
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !child._killedByUs) {
      console.error("http-server exited unexpectedly:\n" + out);
    }
  });
  await waitForServer(port, 20000);
  console.log(`http-server ready on http://localhost:${port}`);
  return child;
}

function stopServer(child) {
  if (!child) return;
  child._killedByUs = true;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (e) {
    console.error("Failed to stop http-server:", e.message);
  }
}

async function launchBrowser(headed) {
  const launchOpts = {
    channel: "chrome",
    headless: headed ? false : "new",
    defaultViewport: null,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      ...(headed ? [] : ["--disable-gpu-sandbox"]),
    ],
  };
  try {
    return await puppeteer.launch(launchOpts);
  } catch (e) {
    console.error("Failed to launch Chrome (channel:'chrome'). Is Google Chrome installed?");
    throw e;
  }
}

async function stubCoarsePointer(page) {
  await page.evaluateOnNewDocument(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      const s = String(q);
      if (s.includes("pointer: coarse") || s.includes("pointer:coarse")) {
        return {
          matches: true,
          media: q,
          addListener() {},
          removeListener() {},
          addEventListener() {},
          removeEventListener() {},
          onchange: null,
          dispatchEvent() {
            return false;
          },
        };
      }
      return real(q);
    };
  });
}

async function applyViewport(page, { w, h, dpr }) {
  await page.setViewport({
    width: w,
    height: h,
    deviceScaleFactor: dpr,
    isMobile: true,
    hasTouch: true,
  });
}

async function diagnose(page) {
  return page.evaluate(() => {
    const mm = (q) => {
      try {
        return window.matchMedia(q).matches;
      } catch {
        return null;
      }
    };
    const K = window.__KART__;
    return {
      title: document.title,
      vw: window.innerWidth,
      vh: window.innerHeight,
      bodyMobile: document.body?.classList?.contains("mobile") || false,
      coarse: mm("(pointer: coarse)"),
      isMobileKart: K ? !!K.IS_MOBILE : null,
      touchCtl: !!document.getElementById("touchCtl"),
      bnav: !!document.getElementById("bnav") || !!document.getElementById("buckyNav"),
    };
  });
}

async function openPage(browser, opts) {
  const page = await browser.newPage();
  page.on("pageerror", (e) => {
    console.warn("  pageerror:", e.message || e);
  });
  if (opts.coarse) await stubCoarsePointer(page);
  await applyViewport(page, opts);

  const url =
    opts.url ||
    `http://127.0.0.1:${opts.port}/${opts.pagePath.replace(/^\//, "")}`;
  console.log(`→ ${url}  (${opts.w}×${opts.h} @${opts.dpr}x${opts.coarse ? ", coarse stub" : ""})`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await new Promise((r) => setTimeout(r, opts.wait));

  const info = await diagnose(page);
  console.log(
    `  viewport ${info.vw}×${info.vh}` +
      (info.bodyMobile ? " · body.mobile" : "") +
      (info.coarse ? " · pointer:coarse" : "") +
      (info.isMobileKart === true ? " · FarmKart IS_MOBILE" : "") +
      (info.isMobileKart === false ? " · FarmKart NOT mobile (!)" : "") +
      (info.touchCtl ? " · #touchCtl" : "")
  );
  return page;
}

async function saveShot(page, pagePath) {
  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
  const outPath = path.join(SHOTS_DIR, shotName(pagePath));
  await page.screenshot({ path: outPath, type: "png", fullPage: false });
  const bytes = fs.statSync(outPath).size;
  console.log(`  shot ${outPath} (${bytes} bytes)`);
  if (bytes < 8000) console.warn("  warning: tiny PNG — may be blank/black");
  return outPath;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    usage();
    process.exit(1);
  }

  if (args.help) {
    usage();
    return;
  }
  if (args.list) {
    console.log("Common pages:");
    for (const p of COMMON_PAGES) console.log("  " + p);
    console.log("\nDevices:");
    for (const [k, v] of Object.entries(DEVICES)) {
      console.log(`  ${k.padEnd(10)} ${v.w}×${v.h}  (${v.label})`);
    }
    return;
  }

  const device = DEVICES[args.device];
  if (!device) {
    console.error(`Unknown --device ${args.device}. Choose: ${Object.keys(DEVICES).join(", ")}`);
    process.exit(1);
  }
  const w = args.w || device.w;
  const h = args.h || device.h;
  const dpr = args.dpr;
  const headed = args.headed === null ? !args.shot : args.headed;

  if (args.picker && (args.shot || args.all)) {
    console.error("--picker is interactive only (not with --shot / --all)");
    process.exit(1);
  }

  const pages = args.all
    ? COMMON_PAGES.slice()
    : args.picker
      ? [PICKER_PAGE]
      : args.url
        ? [args.page || "custom"]
        : [normalizePage(args.page)];

  if (!args.all && !args.url && !args.picker && !pages[0]) {
    usage();
    process.exit(1);
  }

  let serverChild = null;
  let browser = null;
  const startedServer = async () => {
    if (args.url) return; // caller owns hosting
    serverChild = await ensureServer(args.port);
  };

  const cleanup = async () => {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    stopServer(serverChild);
  };

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(130);
  });

  try {
    await startedServer();
    browser = await launchBrowser(headed);

    if (args.shot || args.all) {
      for (const pagePath of pages) {
        const page = await openPage(browser, {
          pagePath: args.url ? pagePath : pagePath,
          url: args.url && pages.length === 1 ? args.url : null,
          port: args.port,
          w,
          h,
          dpr,
          coarse: args.coarse,
          wait: args.wait,
        });
        await saveShot(page, args.url ? "custom" : pagePath);
        await page.close();
      }
      console.log("Done.");
      await cleanup();
      return;
    }

    // Interactive: one page (or picker), leave Chrome open until the user closes it
    const pagePath = pages[0];
    await openPage(browser, {
      pagePath,
      url: args.url,
      port: args.port,
      w,
      h,
      dpr,
      coarse: args.coarse,
      wait: Math.min(args.wait, 800),
    });
    if (args.picker) {
      console.log("\nPicker open — tap a page in Chrome. Close the window (or Ctrl+C here) when done.");
    } else {
      console.log("\nChrome is open at phone size. Close the window (or Ctrl+C here) when done.");
    }
    console.log(`DevTools tip: Ctrl+Shift+M also toggles device mode on http://localhost:${args.port}/`);
    await new Promise((resolve) => {
      browser.on("disconnected", resolve);
    });
    stopServer(serverChild);
  } catch (e) {
    console.error(e.message || e);
    await cleanup();
    process.exit(1);
  }
}

main();
