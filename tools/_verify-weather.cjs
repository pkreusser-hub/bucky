#!/usr/bin/env node
"use strict";
/**
 * Headless smoke: weather.html loads, forecast + radar UI exist, APIs respond
 * (or friendly errors). Does NOT require CI network — reports API status.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8851;
const BASE = `http://127.0.0.1:${PORT}`;

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
      try {
        await new Promise((res, rej) => {
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); })
            .on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], {
      cwd: ROOT, stdio: "ignore", shell: true,
    });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.goto(BASE + "/weather.html", { waitUntil: "domcontentloaded", timeout: 60000 });

  // Structural checks (no network required)
  const struct = await page.evaluate(() => {
    const nav = document.getElementById("buckyNav");
    const farmActive = !!(nav && nav.querySelector("a.active .blabel") &&
      nav.querySelector("a.active .blabel").textContent === "Farm");
    return {
      title: document.title,
      now: !!document.getElementById("now"),
      forecast: !!document.getElementById("forecast"),
      map: !!document.getElementById("map"),
      playBtn: !!document.getElementById("playBtn"),
      scrub: !!document.getElementById("scrub"),
      frameTime: !!document.getElementById("frameTime"),
      navLinks: nav ? nav.querySelectorAll("a").length : 0,
      farmActive,
      place: (document.querySelector(".now .place") || {}).textContent || "",
      leaflet: typeof window.L !== "undefined",
    };
  });

  assert(/Weather/i.test(struct.title), "title mentions Weather");
  assert(struct.now, "#now exists");
  assert(struct.forecast, "#forecast exists");
  assert(struct.map, "#map exists");
  assert(struct.playBtn, "#playBtn exists");
  assert(struct.scrub, "#scrub exists");
  assert(struct.frameTime, "#frameTime exists");
  assert(struct.navLinks >= 6, "bottom nav has tabs");
  assert(struct.farmActive, "Farm tab active");
  assert(/Woodville/i.test(struct.place), "Woodville label");
  assert(struct.leaflet, "Leaflet loaded");

  // Wait for APIs (or friendly failure) — up to 20s
  await page.waitForFunction(
    () => window.__WX__ && window.__WX__.ready === true,
    { timeout: 20000 }
  ).catch(() => {});

  const wx = await page.evaluate(() => ({
    ready: !!(window.__WX__ && window.__WX__.ready),
    forecastOk: !!(window.__WX__ && window.__WX__.forecastOk),
    radarOk: !!(window.__WX__ && window.__WX__.radarOk),
    frames: (window.__WX__ && window.__WX__.frames) || 0,
    dayCount: document.querySelectorAll("#forecast .fday").length,
    playDisabled: document.getElementById("playBtn").disabled,
    scrubDisabled: document.getElementById("scrub").disabled,
    nowTemp: (document.getElementById("nowTemp") || {}).textContent || "",
    bodyText: document.body.innerText.slice(0, 200),
  }));

  assert(wx.ready, "__WX__.ready after load attempt");
  // Friendly fail is OK if offline; if online we expect real data
  if (wx.forecastOk) {
    assert(wx.dayCount === 7, "7 forecast day cards (got " + wx.dayCount + ")");
    assert(/\d/.test(wx.nowTemp), "current temp shown");
  } else {
    const ferr = await page.evaluate(() =>
      /unavailable|Couldn/i.test(
        (document.getElementById("forecast").textContent || "") +
        (document.getElementById("nowCond").textContent || "")
      ));
    assert(ferr, "friendly forecast error visible");
  }
  if (wx.radarOk) {
    assert(wx.frames >= 1, "radar frames loaded");
    assert(!wx.scrubDisabled, "scrubber enabled");
  } else {
    const rerr = await page.evaluate(() =>
      /unavailable|Couldn/i.test(document.getElementById("frameTime").textContent +
        (document.querySelector(".radar-err") || {}).textContent || ""));
    assert(rerr, "friendly radar error visible");
  }

  // Play/pause + scrub smoke when radar works
  if (wx.radarOk && wx.frames >= 2) {
    const playState = await page.evaluate(() => {
      const btn = document.getElementById("playBtn");
      btn.click();
      const playing = btn.classList.contains("playing");
      btn.click();
      const paused = !btn.classList.contains("playing");
      const s = document.getElementById("scrub");
      s.value = "0";
      s.dispatchEvent(new Event("input", { bubbles: true }));
      return { playing, paused, scrub: s.value };
    });
    assert(playState.playing, "play starts animation");
    assert(playState.paused, "pause stops animation");
    assert(playState.scrub === "0", "scrubber moves to 0");
  }

  const realErrors = errors.filter((e) => !/favicon|Failed to load/i.test(e));
  assert(realErrors.length === 0, "no pageerrors: " + realErrors.join(" | "));

  console.log("PASS weather smoke", {
    forecastOk: wx.forecastOk,
    radarOk: wx.radarOk,
    frames: wx.frames,
    days: wx.dayCount,
    nav: struct.navLinks,
  });

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
