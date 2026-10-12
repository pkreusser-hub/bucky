#!/usr/bin/env node
"use strict";
/**
 * Headless verify: fixes from the 2026-10-12 family playtest of the Storybook toon release.
 *   1. boost-pad chevrons point ALONG the driving direction (they always pointed backward)
 *   2. Harvest Hollow's hay ramp no longer throws karts off the course (ramp-jump guidance)
 *   3. no tall scenery stands in the Harvest Hollow road corridor (the open barn used to straddle it)
 * Physics for (2) is stepped synchronously through __KART__.soloRaceTick, so the result does not
 * depend on how slow a headless frame is.
 *
 *   node tools/_verify-fk-playtest.cjs
 */
const path = require("path");
const fs = require("fs");
const http = require("http");

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return require(p); } catch (_) {} }
  throw new Error("playwright not found");
}
const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };
function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
      rsp.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, "127.0.0.1", () => res(srv));
  });
}
let pass = 0, fail = 0;
function check(name, ok, detail) { if (ok) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (detail ? "  — " + detail : "")); } }

async function open(browser, base, track) {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/, (r) => r.abort());
  await page.goto(`${base}/farmkart.html?track=${track}`);
  await page.waitForFunction(() => window.__KART__ && window.__KART__.forceRace, null, { timeout: 60000 });
  return { page, errors };
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

  // ---- 1) boost-pad chevrons ----
  console.log("\n[1] boost-pad arrows point the way you drive");
  for (const track of ["harvest-hollow", "wario-stadium"]) {
    const { page, errors } = await open(browser, base, track);
    const r = await page.evaluate(() => {
      const K = __KART__; K.forceRace();
      const out = [];
      K.scene.traverse((m) => {
        if (!m.isMesh || !m.material || !m.material.map || m.geometry.type !== "PlaneGeometry" || m.renderOrder !== 3) return;
        m.updateMatrixWorld(true);
        // the chevron apex is drawn at the canvas top = plane local +Y; that must face down the road
        const apex = new THREE.Vector3(0, 1, 0).transformDirection(m.matrixWorld);
        const n = K.nearestCenterInfo(m.position.x, m.position.z), t = K.tangents[n.idx];
        out.push(+(apex.x * t.x + apex.z * t.z).toFixed(3));
      });
      return out;
    });
    check(`${track}: ${r.length} boost pads found`, r.length >= 1, JSON.stringify(r));
    check(`${track}: every chevron apex points along the track tangent (dot > 0.9)`, r.length && r.every((d) => d > 0.9), JSON.stringify(r));
    check(`${track}: 0 pageerrors`, errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---- 2) ramp jump stays on the course ----
  console.log("\n[2] Harvest Hollow hay ramp lands you on the road");
  {
    const { page, errors } = await open(browser, base, "harvest-hollow");
    const r = await page.evaluate(() => {
      const K = __KART__; K.forceRace();
      const G = K.G, p = G.players.local, ramp = K.ACTIVE_TRACK.objects.find((o) => o.id === "hh_ramp");
      const N = K.centerPts.length;
      let ri = 0, bd = 1e18;
      for (let j = 0; j < N; j++) { const c = K.centerPts[j], d = (c.x - ramp.x) ** 2 + (c.z - ramp.z) ** 2; if (d < bd) { bd = d; ri = j; } }
      const results = [];
      // approach from 12 samples back at three entry speeds; the bot AI drives (as every CPU racer does)
      for (const v0 of [16, 22, 28]) {
        const i = (ri - 12 + N) % N, c = K.centerPts[i], t = K.tangents[i];
        p.pos.x = c.x; p.pos.z = c.z; p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * v0; p.v.z = t.z * v0;
        p.y = K.sampleHeight(c.x, c.z) + 0.2; p.vy = 0; p.airborne = false; p.onRamp = false; p._rampBoosted = false;
        p.lastSampleIdx = i; p.progressS = K.arcS[i]; p.prevProgressS = K.arcS[i]; p.isBot = true; G.phase = "racing";
        for (const id in G.players) if (id !== "local") { const q = G.players[id]; q.pos.x = 9999; q.pos.z = 9999; }
        let jumped = false, landed = false, maxAir = 0, maxAfter = 0, air = 0, peakSpd = 0, landF = -1;
        for (let f = 0; f < 60 * 8; f++) {
          K.soloRaceTick(1 / 60, {});
          const d = K.nearestCenterInfo(p.pos.x, p.pos.z).dist;
          peakSpd = Math.max(peakSpd, Math.hypot(p.v.x, p.v.z));
          // only the RAMP flight counts (later crest hops on the windmill hill are a different, unguided case)
          if (p.airborne && !landed) { air++; if (air > 6) jumped = true; maxAir = Math.max(maxAir, d); }
          else if (p.airborne) { /* a later hop */ }
          else if (jumped) {
            if (!landed) landF = f;
            landed = true;
            // the ramp's share of the outcome = the landing + 1.5 s of recovery. Later wide runs are the bot's own
            // corner/item choices (traced: a boost item fired into the orchard esses ~2.5 s on) — not this bug.
            if (f - landF <= 90) maxAfter = Math.max(maxAfter, d);
          }
        }
        results.push({ v0, jumped, landed, maxAir: +maxAir.toFixed(2), maxAfter: +maxAfter.toFixed(2), airFrames: air, peakSpd: +peakSpd.toFixed(1) });
      }
      return { results, half: K.TRACK_WIDTH / 2 };
    });
    for (const x of r.results) {
      check(`entry ${x.v0} m/s: the ramp launches (${x.airFrames} airborne frames, peak ${x.peakSpd} m/s)`, x.jumped, JSON.stringify(x));
      // the road half-width is 9 u; the kart body must stay over the road for the whole flight and after landing
      check(`entry ${x.v0} m/s: whole flight + 1.5 s after landing stays over the road (max ${Math.max(x.maxAir, x.maxAfter)} u < ${r.half})`, x.landed && x.maxAir < r.half && x.maxAfter < r.half, JSON.stringify(x));
    }
    check("ramp run: 0 pageerrors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  // ---- 3) no tall scenery inside the Harvest Hollow road corridor ----
  console.log("\n[3] nothing tall stands on the Harvest Hollow road");
  {
    const { page, errors } = await open(browser, base, "harvest-hollow");
    // GLB props load async (each model independently, 10 s timeout x 3 tries)
    await page.waitForFunction(() => { let n = 0; __KART__.scene.traverse((o) => { if (o.isInstancedMesh) n++; }); return n > 40; }, null, { timeout: 90000 });
    await page.waitForTimeout(4000);
    const r = await page.evaluate(() => {
      const K = __KART__, half = K.TRACK_WIDTH / 2, hits = [];
      const M = new THREE.Matrix4(), bb = new THREE.Box3();
      // every GLB prop the track data places (the open barn included), measured from its instanced submeshes
      K.scene.traverse((m) => {
        if (!m.isInstancedMesh || m.userData.fkOutline) return;
        for (let q = m; q; q = q.parent) if (!q.visible) return;   // hidden (e.g. the art pass swaps the windmill GLB for its own)
        if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, M); bb.copy(m.geometry.boundingBox).applyMatrix4(M);
          const h = bb.max.y - bb.min.y;
          if (h < 3) continue;                                   // fences, crops, rocks, tufts: low, not walls
          const ground = K.sampleHeight((bb.min.x + bb.max.x) / 2, (bb.min.z + bb.max.z) / 2);
          if (bb.min.y > ground + 5) continue;                   // overhead (gantries) clears a kart
          // a 1 u grid over the footprint, shrunk 15% (AABB corners of a rotated model are empty air)
          const sx = (bb.max.x - bb.min.x) * 0.15, sz = (bb.max.z - bb.min.z) * 0.15;
          let best = 1e9;
          for (let x = bb.min.x + sx; x <= bb.max.x - sx; x += 1) for (let z = bb.min.z + sz; z <= bb.max.z - sz; z += 1) best = Math.min(best, K.nearestCenterInfo(x, z).dist);
          if (best < half) hits.push({ h: +h.toFixed(1), at: [+((bb.min.x + bb.max.x) / 2).toFixed(1), +((bb.min.z + bb.max.z) / 2).toFixed(1)], d: +best.toFixed(1) });
        }
      });
      const barn = K.ACTIVE_TRACK.objects.find((o) => o.id === "hh_barn_open");
      return { hits, barnD: barn ? +K.nearestCenterInfo(barn.x, barn.z).dist.toFixed(1) : null };
    });
    check("open barn stands beside the road (centre >= 20 u from the line)", r.barnD != null && r.barnD >= 20, String(r.barnD));
    check("no prop taller than 3 u has its footprint inside the road half-width", r.hits.length === 0, JSON.stringify(r.hits.slice(0, 6)));
    check("corridor run: 0 pageerrors", errors.length === 0, errors.slice(0, 2).join(" | "));
    await page.close();
  }

  await browser.close(); srv.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
