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

  const tileResponses = [];
  page.on("response", (r) => {
    if (/tilecache\.rainviewer\.com/i.test(r.url())) tileResponses.push({ url: r.url(), status: r.status() });
  });

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
      leafletCssLoaded: Array.from(document.styleSheets).some(function (ss) {
        try { return ss.href && ss.href.indexOf("leaflet.css") >= 0 && ss.cssRules && ss.cssRules.length > 0; }
        catch (e) { return false; }
      }),
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
  assert(struct.leafletCssLoaded, "leaflet.css stylesheet actually applied (SRI hash valid, not blocked)");

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

    // Radar overlay actually mounted on the map (not just fetched)
    const radarLayer = await page.evaluate(() => {
      const mapEl = document.getElementById("map");
      const tileImgs = Array.from(mapEl.querySelectorAll("img.leaflet-tile"));
      const radarImgs = tileImgs.filter((img) => /tilecache\.rainviewer\.com/i.test(img.src));
      const loaded = radarImgs.filter((img) => img.complete && img.naturalWidth > 0);
      return { radarTileCount: radarImgs.length, radarTileLoaded: loaded.length };
    });
    assert(radarLayer.radarTileCount >= 1, "at least one radar tile <img> mounted on the map");
    assert(radarLayer.radarTileLoaded >= 1, "at least one radar tile actually loaded (naturalWidth>0)");

    // Real tile HTTP status sample
    await new Promise((r) => setTimeout(r, 500));
    const okTiles = tileResponses.filter((t) => t.status === 200);
    assert(tileResponses.length >= 1, "radar tile HTTP request observed");
    assert(okTiles.length >= 1, "radar tile HTTP request returned 200 (sample: " +
      (tileResponses[0] && tileResponses[0].status) + " " + (tileResponses[0] && tileResponses[0].url) + ")");
  } else {
    const rerr = await page.evaluate(() =>
      /unavailable|Couldn/i.test(document.getElementById("frameTime").textContent +
        (document.querySelector(".radar-err") || {}).textContent || ""));
    assert(rerr, "friendly radar error visible");
  }

  // Play/pause + scrub smoke when radar works
  if (wx.radarOk && wx.frames >= 2) {
    // Play must actually advance the frame index over real time (not just toggle a class)
    const startIdx = await page.evaluate(() => parseInt(document.getElementById("scrub").value, 10));
    await page.click("#playBtn");
    const playingNow = await page.evaluate(() => document.getElementById("playBtn").classList.contains("playing"));
    assert(playingNow, "play starts animation (playing class set)");
    await new Promise((r) => setTimeout(r, 1600)); // ANIM_MS=450, so several steps should fire
    const midIdx = await page.evaluate(() => parseInt(document.getElementById("scrub").value, 10));
    assert(midIdx !== startIdx, "frame index advanced while playing (start=" + startIdx + " mid=" + midIdx + ")");

    await page.click("#playBtn");
    const pausedNow = await page.evaluate(() => document.getElementById("playBtn").classList.contains("playing"));
    assert(!pausedNow, "pause stops animation");
    const afterPauseIdx = await page.evaluate(() => parseInt(document.getElementById("scrub").value, 10));
    await new Promise((r) => setTimeout(r, 900));
    const stillIdx = await page.evaluate(() => parseInt(document.getElementById("scrub").value, 10));
    assert(stillIdx === afterPauseIdx, "frame index does not drift after pause");

    // Scrubber input changes the displayed frame (frameTime text updates)
    const scrubResult = await page.evaluate(() => {
      const s = document.getElementById("scrub");
      const before = document.getElementById("frameTime").textContent;
      s.value = "0";
      s.dispatchEvent(new Event("input", { bubbles: true }));
      const after = document.getElementById("frameTime").textContent;
      return { before, after, val: s.value };
    });
    assert(scrubResult.val === "0", "scrubber value set to 0");
    assert(scrubResult.before !== scrubResult.after || wx.frames === 1,
      "scrubbing changes the displayed frame time (before=\"" + scrubResult.before + "\" after=\"" + scrubResult.after + "\")");
  }

  const realErrors = errors.filter((e) => !/favicon|Failed to load/i.test(e));
  assert(realErrors.length === 0, "no pageerrors: " + realErrors.join(" | "));

  console.log("PASS weather smoke", {
    forecastOk: wx.forecastOk,
    radarOk: wx.radarOk,
    frames: wx.frames,
    days: wx.dayCount,
    nav: struct.navLinks,
    leafletCssLoaded: struct.leafletCssLoaded,
    tileResponses: tileResponses.length,
  });

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
