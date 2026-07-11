#!/usr/bin/env node
"use strict";
/**
 * Per-track "Follow terrain" mode (opt-in). Proves:
 *  1. OFF  = flat: a normal track's in-road sampleHeight equals the flat interpolated control-point
 *            elevation (NOT groundHills) — existing tracks unchanged.
 *  2. ON   = draped: a followTerrain:true track's in-road sampleHeight equals groundHills.
 *  3. Kart tilts on camber: on the draped track, kartNormal deviates from (0,1,0).
 *  4. Editor: 🏔 toggle sets track.followTerrain, ribbon bbox y-range grows (draped), bot still drives.
 *  5. 0 JS pageerrors everywhere.
 *
 * Targets the already-running static server on :8790 (does NOT start one).
 */
const path = require("path");
const puppeteer = require(path.join(__dirname, "node_modules", "puppeteer-core"));

const BASE = "http://localhost:8790";
const FOLLOW_ID = "_ftest_follow";   // injected into fk_tracks_v1

// wario-stadium data (mostly-flat authored y) reused as the draped test track. Pulled fresh from the
// page's FK_TRACK.BUILTIN_TRACKS at runtime so we never drift from the source.
async function main() {
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const results = [];
  const ok = (name, cond, extra) => { results.push({ name, pass: !!cond, extra }); };
  let allErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message || e)));

    // ---------- Test 1: OFF = flat (Wario Stadium, no followTerrain) ----------
    await page.goto(`${BASE}/farmkart.html?track=wario-stadium`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await page.evaluate(() => window.__KART__.forceRace());
    await new Promise((r) => setTimeout(r, 250));

    const offReport = await page.evaluate(() => {
      const K = window.__KART__;
      // TUNE-derived terrain opts to compute groundHills independently.
      const T = K.TUNE, AT = K.ACTIVE_TRACK;
      const opts = { amp: T.groundHillAmp, wave: T.groundHillWave, margin: T.heightBlendMargin,
        field: AT.terrain, paint: AT.paint, groundMargin: AT.groundMargin, followTerrain: AT.followTerrain };
      const gh = (x, z) => window.FK_TRACK.groundHills(x, z, opts);
      const C = K.centerPts, N = C.length;
      let checked = 0, flatMax = 0, ghDiffCount = 0, ghDiffMax = 0;
      // ~200 in-road points: near-centerline (small lateral offset within half width).
      const hw = K.TRACK_WIDTH / 2;
      for (let i = 0; i < N && checked < 220; i += Math.max(1, Math.floor(N / 110))) {
        const a = C[(i - 2 + N) % N], b = C[(i + 2) % N];
        const th = Math.atan2(b.x - a.x, b.z - a.z);
        const nx = Math.cos(th), nz = -Math.sin(th);   // left normal-ish in XZ
        for (const off of [-hw * 0.4, hw * 0.4]) {
          const x = C[i].x + nx * off, z = C[i].z + nz * off;
          // flat interpolated control-point elevation at (x,z) on the road
          const flatY = K.nearestOnCenterAtY(x, z, C[i].y).y;
          const sh = K.sampleHeight(x, z);
          flatMax = Math.max(flatMax, Math.abs(sh - flatY));
          const dGH = Math.abs(sh - gh(x, z));
          if (dGH > 0.15) { ghDiffCount++; ghDiffMax = Math.max(ghDiffMax, dGH); }
          checked++;
        }
      }
      return { checked, flatMax: +flatMax.toFixed(4), ghDiffCount, ghDiffMax: +ghDiffMax.toFixed(3),
        followTerrain: !!AT.followTerrain };
    });
    // OFF: sampleHeight tracks the FLAT control-point elevation (≈0 diff), and DIFFERS from groundHills
    // on most in-road points (proving the road is genuinely flat, not coincidentally equal to hills).
    ok("off-flag-absent", offReport.followTerrain === false, offReport);
    ok("off-road-is-flat (sh==flatY)", offReport.checked >= 150 && offReport.flatMax < 0.02, offReport);
    ok("off-road-differs-from-hills", offReport.ghDiffCount > offReport.checked * 0.5 && offReport.ghDiffMax > 0.3, offReport);

    // ---------- Inject a followTerrain:true track (wario + strong sculpt camber) ----------
    await page.evaluate((FOLLOW_ID) => {
      const src = window.FK_TRACK.BUILTIN_TRACKS["wario-stadium"];
      const t = JSON.parse(JSON.stringify(src));
      t.followTerrain = true;
      // strong deterministic cross-slope: a linear ramp in +x (gradient ~0.33/m across the grid area),
      // so the draped road picks up an unmistakable camber the kart leans on.
      const cells = {};
      for (let i = -34; i <= 34; i++) for (let j = -34; j <= 34; j++) { const v = 2.0 * i; if (Math.abs(v) >= 0.01) cells[i + "," + j] = v; }
      t.terrain = { cell: 6, cells };
      const map = JSON.parse(localStorage.getItem("fk_tracks_v1") || "{}") || {};
      map[FOLLOW_ID] = t;
      localStorage.setItem("fk_tracks_v1", JSON.stringify(map));
    }, FOLLOW_ID);

    // ---------- Test 2 + 3: ON = draped, kart tilts ----------
    await page.goto(`${BASE}/farmkart.html?track=${FOLLOW_ID}`, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await page.evaluate(() => window.__KART__.forceRace());
    await new Promise((r) => setTimeout(r, 250));

    const onReport = await page.evaluate(() => {
      const K = window.__KART__;
      const AT = K.ACTIVE_TRACK;
      const T = K.TUNE;
      const opts = { amp: T.groundHillAmp, wave: T.groundHillWave, margin: T.heightBlendMargin,
        field: AT.terrain, paint: AT.paint, groundMargin: AT.groundMargin, followTerrain: AT.followTerrain };
      const gh = (x, z) => window.FK_TRACK.groundHills(x, z, opts);
      const C = K.centerPts, N = C.length, hw = K.TRACK_WIDTH / 2;
      let checked = 0, drapeMax = 0, flatSame = 0;
      for (let i = 0; i < N && checked < 220; i += Math.max(1, Math.floor(N / 110))) {
        for (const off of [-hw * 0.4, hw * 0.4]) {
          const x = C[i].x + off, z = C[i].z;
          const sh = K.sampleHeight(x, z);
          drapeMax = Math.max(drapeMax, Math.abs(sh - gh(x, z)));      // should be ~0 (draped == hills)
          const flatY = K.nearestOnCenterAtY(x, z, C[i].y).y;
          if (Math.abs(sh - flatY) < 0.05) flatSame++;                 // should be RARE (not flat now)
          checked++;
        }
      }
      return { flag: !!AT.followTerrain, checked, drapeMax: +drapeMax.toFixed(4), flatSame };
    });
    ok("on-flag-set", onReport.flag === true, onReport);
    ok("on-road-is-draped (sh==hills)", onReport.checked >= 150 && onReport.drapeMax < 0.01, onReport);
    ok("on-road-not-flat", onReport.flatSame < onReport.checked * 0.25, onReport);

    // Kart tilt: teleport to the worst-camber in-road spot, pin it a few frames, read kartNormal.
    const tiltReport = await page.evaluate(async () => {
      const K = window.__KART__;
      const C = K.centerPts, N = C.length;
      let best = null;
      for (let i = 0; i < N; i += 2) {
        const a = C[(i - 2 + N) % N], b = C[(i + 2) % N];
        const th = Math.atan2(b.x - a.x, b.z - a.z);
        const c = C[i];
        const sy = K.sampleHeight(c.x, c.z);
        const pl = K.sampleKartPlane(c.x, c.z, th, sy);
        const tilt = 1 - Math.min(1, pl.normal.y);
        if (!best || tilt > best.tilt) best = { x: c.x, z: c.z, th, sy, tilt, ny: pl.normal.y };
      }
      // pin the local kart at the camber spot across ~40 frames so kartNormal converges there
      const p = K.state;
      for (let f = 0; f < 40; f++) {
        p.pos.x = best.x; p.pos.z = best.z; p.theta = best.th; p.y = best.sy;
        if (p.v) { p.v.x = 0; p.v.z = 0; }
        await new Promise((r) => requestAnimationFrame(r));
      }
      const kn = K.kartNormal;
      const horiz = Math.hypot(kn.x, kn.z);
      return { planeNy: +best.ny.toFixed(4), planeTilt: +best.tilt.toFixed(4),
        knx: +kn.x.toFixed(4), kny: +kn.y.toFixed(4), knz: +kn.z.toFixed(4), horiz: +horiz.toFixed(4) };
    });
    ok("kart-tilts-on-camber", tiltReport.horiz > 0.05 && tiltReport.kny < 0.999, tiltReport);

    allErrors = allErrors.concat(errors.map((e) => "[game] " + e));

    // ---------- Test 4: Editor ----------
    const epage = await browser.newPage();
    await epage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    const eerrors = [];
    epage.on("pageerror", (e) => eerrors.push(String(e.message || e)));
    await epage.goto(`${BASE}/farmkart-editor.html?track=wario-stadium`, { waitUntil: "networkidle0", timeout: 60000 });
    await epage.waitForFunction(() => !!(window.__EDITOR__ && window.__EDITOR__.rebuild), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 400));

    const edReport = await epage.evaluate(async () => {
      const ED = window.__EDITOR__;
      const t = ED.track;
      // editor's fixed terrain params (TERRAIN const) + live track fields -> groundHills opts
      const opts = { amp: 3.4, wave: 60, margin: 9, field: t.terrain, paint: t.paint,
        groundMargin: t.groundMargin, followTerrain: t.followTerrain };
      const gh = (x, z) => window.FK_TRACK.groundHills(x, z, opts);
      // per-vertex distance of the ribbon from the draped surface (min over the two curb-layer offsets
      // 0.08 / 0.12). Draped -> ~0 for every vertex; flat -> large where authored y != hills.
      // For each ribbon vertex, d = y - terrainHeight = how far it sits ABOVE the draped surface. A
      // DRAPED ribbon follows the terrain's shape, so d is a near-CONSTANT small offset (the render lift)
      // -> tiny offsetRange. A FLAT ribbon (authored elevations) deviates from the hills -> large
      // offsetRange. (Lift-agnostic: we check that the offset is CONSTANT, not that it's ~0.)
      const ribbonDrapeStats = () => {
        const g = ED.ribbonGroup; if (!g) return null;
        let sum = 0, n = 0, lo = Infinity, hi = -Infinity, dLo = Infinity, dHi = -Infinity;
        g.traverse((o) => {
          if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
            const pa = o.geometry.attributes.position;
            for (let k = 0; k < pa.count; k++) {
              const x = pa.getX(k), y = pa.getY(k), z = pa.getZ(k);
              const d = y - gh(x, z);
              sum += d; n++;
              if (d < dLo) dLo = d; if (d > dHi) dHi = d;
              if (y < lo) lo = y; if (y > hi) hi = y;
            }
          }
        });
        return { meanOffset: +(sum / n).toFixed(3), offsetRange: +(dHi - dLo).toFixed(3), yRange: +(hi - lo).toFixed(3) };
      };
      // ensure OFF first, measure, then ON.
      if (t.followTerrain) ED.toggleFollow();
      await new Promise((r) => setTimeout(r, 60));
      const offStats = ribbonDrapeStats();            // flat ribbon: does NOT follow hills
      const wasOff = !t.followTerrain;
      const nowOn = ED.toggleFollow();                // toggle ON -> rebuild draped ribbon
      opts.followTerrain = true;
      await new Promise((r) => setTimeout(r, 60));
      const onStats = ribbonDrapeStats();             // draped ribbon: follows hills (~0 offset)
      const flagSet = t.followTerrain === true;

      // bot still drives on the draped road (editor bot uses flat x/z fields, not .pos)
      ED.startBot && ED.startBot();
      const b0 = ED.bot ? { x: ED.bot.x, z: ED.bot.z } : null;
      for (let f = 0; f < 40; f++) await new Promise((r) => requestAnimationFrame(r));
      const b1 = ED.bot ? { x: ED.bot.x, z: ED.bot.z } : null;
      ED.stopBot && ED.stopBot();
      const moved = (b0 && b1) ? Math.hypot(b1.x - b0.x, b1.z - b0.z) : 0;

      return { wasOff, nowOn, flagSet, offStats, onStats, botMoved: +moved.toFixed(3) };
    });
    ok("editor-toggle-sets-flag", edReport.wasOff && edReport.nowOn && edReport.flagSet, edReport);
    // ON: the ribbon follows the terrain -> a near-CONSTANT small offset above it (tiny offsetRange).
    // OFF: the flat ribbon's offset from the hills varies a lot (large offsetRange).
    ok("editor-ribbon-drapes-to-hills", edReport.onStats && edReport.onStats.offsetRange < 0.6, edReport);
    ok("editor-flat-ribbon-not-draped", edReport.offStats && edReport.offStats.offsetRange > 1.5, edReport);
    ok("editor-bot-still-drives", edReport.botMoved > 0.5, edReport);

    allErrors = allErrors.concat(eerrors.map((e) => "[editor] " + e));
    ok("no-pageerrors", allErrors.length === 0, allErrors);

  } finally {
    await browser.close();
  }

  let pass = 0;
  for (const r of results) {
    console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.pass ? "" : "  " + JSON.stringify(r.extra)));
    if (r.pass) pass++;
  }
  if (allErrors.length) console.log("PAGEERRORS:", JSON.stringify(allErrors, null, 2));
  const allPass = pass === results.length;
  console.log(`\n${pass}/${results.length} ${allPass ? "ALL PASS" : "FAIL"}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
