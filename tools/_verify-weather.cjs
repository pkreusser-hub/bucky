#!/usr/bin/env node
"use strict";
/**
 * Headless smoke: weather.html loads, forecast + radar UI exist, APIs respond
 * (or friendly errors). Radar timeline now spans past (RainViewer) → now →
 * future (NOAA HRRR via Iowa State Mesonet). Does NOT require CI network —
 * reports API status and degrades assertions gracefully when upstreams are down.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8851;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS_DIR = path.join(ROOT, "shots");

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

// Independent, node-side reachability probe of IEM/HRRR (mirrors weather.html's
// own probe logic) so the test knows which branch of behavior to expect.
async function probeIemReachable() {
  try {
    const url = "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0060-0/6/16/25.png";
    const r = await fetch(url, { cache: "no-store" });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function newBrowserPage(browser, opts) {
  const page = await browser.newPage();
  await page.setViewport(opts.viewport);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  const tileResponses = [];
  page.on("response", (r) => {
    if (/tilecache\.rainviewer\.com|mesonet\.agron\.iastate\.edu/i.test(r.url())) {
      tileResponses.push({ url: r.url(), status: r.status() });
    }
  });
  return { page, errors, tileResponses };
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], {
      cwd: ROOT, stdio: "ignore", shell: true,
    });
  }
  await waitServer(PORT, 20000);

  const iemReachable = await probeIemReachable();
  console.log("IEM/HRRR reachability probe:", iemReachable ? "UP" : "DOWN (degradation branch)");

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });

  // ---------------------------------------------------------------
  // PASS 1: normal network — mobile viewport, full assertion suite
  // ---------------------------------------------------------------
  const { page, errors, tileResponses } = await newBrowserPage(browser, {
    viewport: { width: 390, height: 844, deviceScaleFactor: 1 },
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
      nowMarker: !!document.getElementById("nowMarker"),
      segPast: !!document.getElementById("segPast"),
      segFuture: !!document.getElementById("segFuture"),
      farmRainLine: !!document.getElementById("farmRainLine"),
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
  assert(struct.nowMarker, "#nowMarker (now-marker) element exists");
  assert(struct.segPast, "#segPast timeline segment exists");
  assert(struct.segFuture, "#segFuture timeline segment exists");
  assert(struct.farmRainLine, "#farmRainLine element exists");
  assert(struct.navLinks >= 6, "bottom nav has tabs");
  assert(struct.farmActive, "Farm tab active");
  assert(/Woodville/i.test(struct.place), "Woodville label");
  assert(struct.leaflet, "Leaflet loaded");
  assert(struct.leafletCssLoaded, "leaflet.css stylesheet actually applied (SRI hash valid, not blocked)");

  // Wait for APIs (or friendly failure) — up to 25s (extra HRRR probing takes longer)
  await page.waitForFunction(
    () => window.__WX__ && window.__WX__.ready === true,
    { timeout: 25000 }
  ).catch(() => {});

  const wx = await page.evaluate(() => ({
    ready: !!(window.__WX__ && window.__WX__.ready),
    forecastOk: !!(window.__WX__ && window.__WX__.forecastOk),
    radarOk: !!(window.__WX__ && window.__WX__.radarOk),
    frames: (window.__WX__ && window.__WX__.frames) || 0,
    futureFrames: (window.__WX__ && window.__WX__.futureFrames) || 0,
    nowIdx: (window.__WX__ && typeof window.__WX__.nowIdx === "number") ? window.__WX__.nowIdx : -1,
    rainLineOk: !!(window.__WX__ && window.__WX__.rainLineOk),
    dayCount: document.querySelectorAll("#forecast .fday").length,
    playDisabled: document.getElementById("playBtn").disabled,
    scrubDisabled: document.getElementById("scrub").disabled,
    scrubMax: document.getElementById("scrub").max,
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

    // ---- future segment expectations, gated on the independent IEM probe ----
    if (iemReachable) {
      assert(wx.futureFrames >= 1, "future HRRR frames present when IEM is reachable (got " + wx.futureFrames + ")");
      assert(parseInt(wx.scrubMax, 10) === wx.frames - 1, "scrub range covers all frames incl. future (max=" +
        wx.scrubMax + " frames=" + wx.frames + ")");
    } else {
      assert(wx.futureFrames === 0, "no future frames when IEM is genuinely unreachable (graceful past-only)");
      console.log("WARN: IEM/HRRR unreachable from this environment — verified graceful past-only degradation instead.");
    }

    // Radar overlay actually mounted on the map (not just fetched) — give the
    // tile layer a beat to paint before sampling naturalWidth.
    await new Promise((r) => setTimeout(r, 900));
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

    // Now marker: visible + positioned when a past ("now") frame exists
    const markerState = await page.evaluate(() => {
      const marker = document.getElementById("nowMarker");
      const cs = getComputedStyle(marker);
      return { display: cs.display, left: marker.style.left };
    });
    if (wx.nowIdx >= 0) {
      assert(markerState.display !== "none", "now-marker visible when a past frame exists");
    }

    // Scrubbing into the future swaps to an HRRR tile layer + label says forecast
    if (wx.futureFrames >= 1) {
      const futureIdx = wx.nowIdx >= 0 ? wx.nowIdx + 1 : 0;
      const scrubToFuture = await page.evaluate((idx) => {
        const s = document.getElementById("scrub");
        s.value = String(idx);
        s.dispatchEvent(new Event("input", { bubbles: true }));
        return { val: s.value, frameTimeHTML: document.getElementById("frameTime").innerHTML };
      }, futureIdx);
      assert(/forecast/i.test(scrubToFuture.frameTimeHTML), "#frameTime says 'forecast' on a future frame");
      assert(/\+\s*\d+\s*min/i.test(scrubToFuture.frameTimeHTML), "#frameTime shows a '+N min' offset on a future frame");

      await new Promise((r) => setTimeout(r, 900));
      const hrrrTile = await page.evaluate(() => {
        const mapEl = document.getElementById("map");
        const imgs = Array.from(mapEl.querySelectorAll("img.leaflet-tile"));
        const hrrrImgs = imgs.filter((img) => /mesonet\.agron\.iastate\.edu/i.test(img.src));
        const loaded = hrrrImgs.filter((img) => img.complete && img.naturalWidth > 0);
        return { count: hrrrImgs.length, loaded: loaded.length };
      });
      assert(hrrrTile.count >= 1, "at least one HRRR (mesonet.agron.iastate.edu) tile <img> mounted after scrubbing to future");
      assert(hrrrTile.loaded >= 1, "at least one HRRR tile actually loaded (naturalWidth>0)");

      // Screenshot with the forecast frame visible
      try {
        const fs = require("fs");
        if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
      } catch (_) {}
      await page.evaluate(() => document.querySelector(".radar-ctl").scrollIntoView({ block: "end" }));
      await new Promise((r) => setTimeout(r, 150));
      await page.screenshot({ path: path.join(SHOTS_DIR, "wx_future_mobile.png") });
    }
  } else {
    const rerr = await page.evaluate(() =>
      /unavailable|Couldn/i.test(document.getElementById("frameTime").textContent +
        (document.querySelector(".radar-err") || {}).textContent || ""));
    assert(rerr, "friendly radar error visible");
  }

  // Play/pause + scrub smoke when radar works, incl. traversal past→future
  if (wx.radarOk && wx.frames >= 2) {
    // Play must actually advance the frame index over real time (not just toggle a class)
    const startIdx = await page.evaluate(() => parseInt(document.getElementById("scrub").value, 10));
    await page.click("#playBtn");
    const playingNow = await page.evaluate(() => document.getElementById("playBtn").classList.contains("playing"));
    assert(playingNow, "play starts animation (playing class set)");

    // Sample the frame index repeatedly to confirm the timeline traverses
    // past → future (not just oscillating near the start).
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 450));
      const idx = await page.evaluate(() => parseInt(document.getElementById("scrub").value, 10));
      seen.add(idx);
    }
    const maxSeen = Math.max(...seen);
    assert(seen.size >= 2, "frame index advanced while playing (saw " + seen.size + " distinct indices)");
    if (wx.futureFrames >= 1 && wx.nowIdx >= 0) {
      assert(maxSeen > wx.nowIdx, "play traversed past the 'now' boundary into the future segment (max seen idx=" +
        maxSeen + ", nowIdx=" + wx.nowIdx + ")");
    }

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

  // Farm rain line: renders with real content when the fetch succeeds
  const rainState = await page.evaluate(() => {
    const el = document.getElementById("farmRainLine");
    return { hidden: el.classList.contains("hidden"), text: el.textContent || "" };
  });
  if (wx.rainLineOk) {
    assert(!rainState.hidden, "farm rain line visible when Open-Meteo minutely fetch succeeds");
    assert(/rain|no rain/i.test(rainState.text), "farm rain line has rain/no-rain copy (got: \"" + rainState.text + "\")");
  } else {
    assert(rainState.hidden, "farm rain line hidden when the minutely fetch fails/unavailable");
  }

  // Mobile: timeline + now-marker usable, no overlap with the bottom nav
  const mobileLayout = await page.evaluate(() => {
    const timeline = document.getElementById("timeline");
    const nav = document.getElementById("buckyNav");
    if (!timeline || !nav) return null;
    const t = timeline.getBoundingClientRect();
    const n = nav.getBoundingClientRect();
    return { timelineBottom: t.bottom, navTop: n.top, timelineWidth: t.width };
  });
  if (mobileLayout) {
    assert(mobileLayout.timelineWidth > 100, "timeline has real width on mobile");
    assert(mobileLayout.timelineBottom <= mobileLayout.navTop,
      "radar timeline does not overlap the bottom nav (timelineBottom=" + mobileLayout.timelineBottom +
      " navTop=" + mobileLayout.navTop + ")");
  }

  const realErrors1 = errors.filter((e) => !/favicon|Failed to load/i.test(e));
  assert(realErrors1.length === 0, "no pageerrors (mobile pass): " + realErrors1.join(" | "));

  console.log("PASS weather smoke (mobile)", {
    forecastOk: wx.forecastOk,
    radarOk: wx.radarOk,
    frames: wx.frames,
    futureFrames: wx.futureFrames,
    nowIdx: wx.nowIdx,
    rainLineOk: wx.rainLineOk,
    days: wx.dayCount,
    nav: struct.navLinks,
    leafletCssLoaded: struct.leafletCssLoaded,
    tileResponses: tileResponses.length,
  });

  // ---------------------------------------------------------------
  // PASS 2: desktop viewport — screenshot + simulate a blocked farm-rain
  // route to confirm the rain line hides gracefully on failure.
  // ---------------------------------------------------------------
  const pass2 = await newBrowserPage(browser, {
    viewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
  });
  const page2 = pass2.page;
  await page2.setRequestInterception(true);
  page2.on("request", (req) => {
    if (/api\.open-meteo\.com\/v1\/forecast\?.*minutely_15/i.test(req.url())) {
      req.abort().catch(() => {});
    } else {
      req.continue().catch(() => {});
    }
  });

  await page2.goto(BASE + "/weather.html?n=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page2.waitForFunction(
    () => window.__WX__ && window.__WX__.ready === true,
    { timeout: 25000 }
  ).catch(() => {});

  const wx2 = await page2.evaluate(() => ({
    ready: !!(window.__WX__ && window.__WX__.ready),
    radarOk: !!(window.__WX__ && window.__WX__.radarOk),
    futureFrames: (window.__WX__ && window.__WX__.futureFrames) || 0,
    nowIdx: (window.__WX__ && typeof window.__WX__.nowIdx === "number") ? window.__WX__.nowIdx : -1,
    rainLineOk: !!(window.__WX__ && window.__WX__.rainLineOk),
  }));
  const rainState2 = await page2.evaluate(() => {
    const el = document.getElementById("farmRainLine");
    return { hidden: el.classList.contains("hidden"), text: el.textContent || "" };
  });
  assert(!wx2.rainLineOk, "rainLineOk false when the minutely route is blocked");
  assert(rainState2.hidden, "farm rain line hides entirely when its fetch fails (blocked-route simulation)");
  assert(rainState2.text === "", "farm rain line has no stale text when hidden on failure");

  // Scrub into the future on desktop for the second screenshot, if available
  if (wx2.radarOk && wx2.futureFrames >= 1) {
    const futureIdx2 = wx2.nowIdx >= 0 ? wx2.nowIdx + 1 : 0;
    await page2.evaluate((idx) => {
      const s = document.getElementById("scrub");
      s.value = String(idx);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    }, futureIdx2);
    await new Promise((r) => setTimeout(r, 900));
  }
  try {
    const fs = require("fs");
    if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });
  } catch (_) {}
  await page2.evaluate(() => document.querySelector(".radar-block").scrollIntoView({ block: "center" }));
  await new Promise((r) => setTimeout(r, 150));
  await page2.screenshot({ path: path.join(SHOTS_DIR, "wx_future_desktop.png") });

  const realErrors2 = pass2.errors.filter((e) => !/favicon|Failed to load|net::ERR_FAILED/i.test(e));
  assert(realErrors2.length === 0, "no pageerrors (desktop/blocked-rain pass): " + realErrors2.join(" | "));

  console.log("PASS weather smoke (desktop, blocked farm-rain route)", {
    radarOk: wx2.radarOk,
    futureFrames: wx2.futureFrames,
    rainLineOk: wx2.rainLineOk,
    rainLineHiddenOnFailure: rainState2.hidden,
  });

  await browser.close();
  if (server) try { process.kill(server.pid); } catch (_) {}
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
