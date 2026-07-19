#!/usr/bin/env node
"use strict";
/**
 * Headless verify: "Bucky's Midnight Run" (midnight-run) — a drift-focused night-city builtin.
 *  1) pure-node : sanitize round-trips ALL its keys; sanitize byte-identical vs HEAD for tracks
 *     WITHOUT the new keys; the midnight-run def carries theme/sky/wallMargin/traffic/tunnels/
 *     boostPads/objects/itemRows.
 *  2) geometry  : resample@400 — closure kink <12deg, max|slope|<0.35, no near-overlap between
 *     different sections within 14u XZ unless Ygap>5 (only the intended viaduct crossing), corner
 *     radii sane.
 *  3) drivability: ?track=midnight-run, 3 bots, forceRace, ~90s of soloRaceTick — every bot laps
 *     >=1, none stuck (>5s at ~0 speed), no NaN / fall-through.
 *  4) drift-worthiness: drive the local kart (real stepKart + look-ahead steer, drift held) through
 *     T1 / Skyline Loop / Last Call — drift charge reaches mini-turbo tier >=2 in >=2 of the 3.
 *  5) city kit : night sky, CITY_GROUP, lane marks, 8 traffic vehicles, tunnel bbox spans the
 *     S-bend, ramp renders + aligned, both boost pads on-road, 0 pageerrors.
 *  6) over/under: kart on the home straight resolves y~0 UNDER the viaduct; on the viaduct resolves
 *     y~8 OVER it; both passages drivable (not wall-blocked).
 *  7) menu     : the course grid builds a midnight-run card + drawTrackPreview renders non-blank.
 *  8) screenshots -> shots/.
 * Cloud domains blocked throughout. deviceScaleFactor 1.5.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { execSync } = require("child_process");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8874;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = "midnight-run";

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
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

const CHECKS = [];
function check(name, cond, detail) { CHECKS.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) }); }

// ---------- 1) pure-node ----------
function loadModule(code) { const win = {}; const fn = new Function("window", "document", code); fn(win, undefined); return win.FK_TRACK; }
function pureNodeChecks() {
  const NEW = loadModule(fs.readFileSync(path.join(ROOT, "assets/farmkart-track.js"), "utf8"));
  const OLD = loadModule(execSync("git show HEAD:assets/farmkart-track.js", { cwd: ROOT, maxBuffer: 1 << 24 }).toString());
  // byte-identical for tracks WITHOUT the new keys (adding midnight-run must not perturb them). NOTE:
  // wario-stadium + rainbow-road were re-themed in the wave-2 theme pack (they now carry the new `decor`
  // key), so they are no longer valid "untouched control" tracks here — swapped for tracks that carry
  // none of the new keys, which still proves the sanitize-code change doesn't perturb plain tracks.
  for (const id of ["__default__", "mario-raceway", "royal-raceway", "moo-moo-farm"]) {
    const t = id === "__default__" ? NEW.DEFAULT_TRACK : NEW.BUILTIN_TRACKS[id];
    const a = JSON.stringify(OLD.sanitize(JSON.parse(JSON.stringify(t))));
    const b = JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(t))));
    check("sanitize byte-identical vs HEAD: " + (t.name || id), a === b);
  }
  const raw = NEW.BUILTIN_TRACKS[ID];
  check("midnight-run is a builtin", !!raw, ID);
  const s = NEW.sanitize(JSON.parse(JSON.stringify(raw)));
  check("midnight-run sanitizes (non-null)", !!s);
  // round-trip: re-sanitizing the sanitized track is idempotent (all keys preserved)
  const s2 = NEW.sanitize(JSON.parse(JSON.stringify(s)));
  check("sanitize is idempotent / round-trips all keys", JSON.stringify(s) === JSON.stringify(s2));
  check("keeps sky:night", s.sky === "night", s.sky);
  check("keeps theme:city", s.theme === "city", s.theme);
  check("keeps wallMargin:6", s.wallMargin === 6, s.wallMargin);
  check("keeps traffic {8,9}", s.traffic && s.traffic.count === 8 && s.traffic.speed === 9, JSON.stringify(s.traffic));
  check("keeps itemRows (4 rows)", Array.isArray(s.itemRows) && s.itemRows.length === 4, JSON.stringify(s.itemRows));
  check("keeps 1 tunnel spanning the S-bend", Array.isArray(s.tunnels) && s.tunnels.length === 1 && s.tunnels[0].s > 0.6 && s.tunnels[0].s < 0.75 && s.tunnels[0].len >= 55, JSON.stringify(s.tunnels));
  check("keeps 2 boost pads", Array.isArray(s.boostPads) && s.boostPads.length === 2, JSON.stringify(s.boostPads));
  check("keeps 1 ramp object", Array.isArray(s.objects) && s.objects.length === 1 && s.objects[0].type === "ramp", JSON.stringify(s.objects && s.objects.map((o) => o.type)));
  check("laps 3, width 18, gridSide left", s.laps === 3 && s.width === 18 && s.gridSide === "left");
}

async function main() {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  pureNodeChecks();

  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  const errorsAll = [];
  async function newPage(mobile) {
    const page = await browser.newPage();
    if (mobile) await page.evaluateOnNewDocument(() => {
      const real = window.matchMedia ? window.matchMedia.bind(window) : null;
      window.matchMedia = (q) => (/coarse/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : (real ? real(q) : { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    });
    await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 1.5 } : { width: 1280, height: 800, deviceScaleFactor: 1.5 });
    const errs = [];
    page.on("pageerror", (e) => { errs.push(String(e.message || e)); errorsAll.push(String(e.message || e)); });
    await page.setRequestInterception(true);
    page.on("request", (req) => { if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort(); req.continue(); });
    page._errs = errs;
    return page;
  }

  // ============ PASS A: desktop, ?track=midnight-run — geometry + city + drift + over/under ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace && window.__KART__.CITY_GROUP), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1400));
    await page.screenshot({ path: path.join(SHOTS, "fk_midnight_start.png") });

    // ---- 2) GEOMETRY ----
    const geo = await page.evaluate(() => {
      const K = window.__KART__;
      const smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
      const C = smp.centerPts, T = smp.tangents, L = smp.trackLen, N = 400;
      const az = (t) => Math.atan2(t.x, t.z) * 180 / Math.PI;
      const angDiff = (a, b) => { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d; };
      let maxSlope = 0, maxKink = 0, closureKink = angDiff(az(T[N - 1]), az(T[0]));
      for (let i = 0; i < N; i++) { const a = C[i], b = C[(i + 1) % N]; const h = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6; maxSlope = Math.max(maxSlope, Math.abs(b.y - a.y) / h); maxKink = Math.max(maxKink, angDiff(az(T[i]), az(T[(i + 1) % N]))); }
      // near-overlap between DIFFERENT sections
      const GAP = 22; let bad = [], closestD = 1e9, closest = null;
      for (let i = 0; i < N; i++) for (let j = i + GAP; j < N; j++) {
        if (Math.min(j - i, N - (j - i)) < GAP) continue;
        const a = C[i], b = C[j], d = Math.hypot(a.x - b.x, a.z - b.z), yg = Math.abs(a.y - b.y);
        if (d < closestD) { closestD = d; closest = { i, j, d: +d.toFixed(1), yg: +yg.toFixed(1) }; }
        if (d < 14 && yg < 5) bad.push({ i, j, d: +d.toFixed(1), yg: +yg.toFixed(1) });
      }
      // corner radii at landmarks
      const nearest = (px, pz) => { let bi = 0, bd = 1e18; for (let i = 0; i < N; i++) { const dx = C[i].x - px, dz = C[i].z - pz, dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; bi = i; } } return bi; };
      const curv = (i) => { const a = C[(i - 3 + N) % N], b = C[i], c = C[(i + 3) % N]; const A = Math.hypot(b.x - a.x, b.z - a.z), B = Math.hypot(c.x - b.x, c.z - b.z), Cc = Math.hypot(c.x - a.x, c.z - a.z); const ar = Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2; if (ar < 1e-6 || A < 1e-6 || B < 1e-6 || Cc < 1e-6) return 1e9; return (A * B * Cc) / (4 * ar); };
      const rAt = (px, pz) => { const bi = nearest(px, pz); let m = 1e9; for (let d = -4; d <= 4; d++) m = Math.min(m, curv((bi + d + N) % N)); return +m.toFixed(1); };
      return {
        L: +L.toFixed(0), maxSlope: +maxSlope.toFixed(3), maxKink: +maxKink.toFixed(1), closureKink: +closureKink.toFixed(1),
        nBad: bad.length, closest, radii: { T1: rAt(48, 165), esses: rAt(196, 152), skyline: rAt(345, 118), hairpin: rAt(-159, -178), lastCall: rAt(40, -84) }
      };
    });
    check("A geometry: closure kink < 12deg", geo.closureKink < 12, geo.closureKink + "deg");
    check("A geometry: max |slope| < 0.35", geo.maxSlope < 0.35, geo.maxSlope);
    check("A geometry: no different-section overlap within 14u & Ygap<5", geo.nBad === 0, JSON.stringify(geo.closest));
    check("A geometry: only close approach is the viaduct crossing (Ygap>5)", geo.closest && geo.closest.yg > 5, JSON.stringify(geo.closest));
    check("A geometry: max per-sample kink sane (<18deg)", geo.maxKink < 18, geo.maxKink);
    check("A geometry: hairpin tightest but drivable (18<r<30)", geo.radii.hairpin > 16 && geo.radii.hairpin < 32, geo.radii.hairpin);
    check("A geometry: T1 & Last Call are wide sweepers (r>38)", geo.radii.T1 > 38 && geo.radii.lastCall > 38, JSON.stringify(geo.radii));
    check("A track length in range (1400-1900)", geo.L > 1400 && geo.L < 1900, geo.L);

    // ---- 5) CITY KIT ----
    const city = await page.evaluate(() => {
      const K = window.__KART__;
      const info = K.CITY_GROUP && K.CITY_GROUP.userData.info;
      let laneVerts = 0; if (K.LANE_GROUP) K.LANE_GROUP.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) laneVerts += o.geometry.attributes.position.count; });
      // tunnel bbox vs S-bend samples
      const smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
      const tg = K.TUNNEL_GROUP; const box = tg ? new THREE.Box3().setFromObject(tg) : null;
      let sbendIn = 0, sbendTotal = 0;
      // S-bend samples ~ arc s 0.66..0.73 (the tunnel run)
      const arcS = smp.arcS, L = smp.trackLen;
      for (let i = 0; i < 400; i++) { const s = arcS[i] / L; if (s >= 0.66 && s <= 0.73) { sbendTotal++; const c = smp.centerPts[i]; if (box && c.x >= box.min.x - 1 && c.x <= box.max.x + 1 && c.z >= box.min.z - 1 && c.z <= box.max.z + 1) sbendIn++; } }
      // ramp object rendered + aligned (rotY set by alignRampsToTrack, not the raw 0)
      const rampObj = (K.ACTIVE_TRACK.objects || []).find((o) => o.type === "ramp");
      let rampInScene = false;
      K.scene.traverse((o) => { if (o.userData && o.userData.rampId) rampInScene = true; });
      // boost pads on-road: each pad's world pos within half-width of the centerline
      const pads = K.boostPads || [];
      let padsOnRoad = 0;
      for (const p of pads) { if (p && p.mesh) { const pos = p.mesh.position; const info2 = FK_TRACK.nearestOnCenter ? null : null; padsOnRoad += 1; } }
      return {
        sky: K.sky, theme: K.theme, lamps: info && info.lamps, buildings: info && info.buildings, billboards: info && info.billboards,
        laneVerts, traffic: K.trafficVehicles.length, tunnelBox: !!box, sbendIn, sbendTotal, rampObjRotY: rampObj ? +rampObj.rotY.toFixed(3) : null, rampInScene, nPads: pads.length
      };
    });
    check("A city: sky is night", city.sky === "night", city.sky);
    check("A city: theme is city", city.theme === "city", city.theme);
    check("A city: CITY_GROUP has lamps>20 & buildings>40", city.lamps > 20 && city.buildings > 40, JSON.stringify({ lamps: city.lamps, buildings: city.buildings }));
    check("A city: billboards >= 8", city.billboards >= 8, city.billboards);
    check("A city: lane marks present (verts>0)", city.laneVerts > 0, city.laneVerts);
    check("A city: 8 traffic vehicles", city.traffic === 8, city.traffic);
    check("A city: tunnel bbox spans the S-bend samples", city.tunnelBox && city.sbendIn > 0 && city.sbendIn >= city.sbendTotal * 0.4, `${city.sbendIn}/${city.sbendTotal}`);
    check("A city: ramp aligned to track (rotY != 0)", city.rampObjRotY !== null && Math.abs(city.rampObjRotY) > 0.01, city.rampObjRotY);
    check("A city: 2 boost pads built", city.nPads === 2, city.nPads);

    // boost pads on-road (compute distance to centerline for each pad world position)
    const padCheck = await page.evaluate(() => {
      const K = window.__KART__; const smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
      const pads = K.boostPads || []; const res = [];
      for (const p of pads) { if (!p || !isFinite(p.x) || !isFinite(p.z)) { res.push(null); continue; } const info = FK_TRACK.nearestOnCenter(smp, p.x, p.z); res.push(+info.dist.toFixed(1)); }
      return { half: K.TRACK_WIDTH / 2, res };
    });
    check("A boost pads on-road (dist to centerline < half+2)", padCheck.res.every((d) => d !== null && d < padCheck.half + 2), JSON.stringify(padCheck));

    // ---- 6) OVER/UNDER ----
    const ou = await page.evaluate(() => {
      const K = window.__KART__;
      // home straight (y0) UNDER the viaduct near (8,52); viaduct (y8) OVER it near (12,54)
      const under = K.nearestOnCenterAtY(8, 52, 0);
      const over = K.nearestOnCenterAtY(12, 54, 8);
      // drive test: teleport onto each, step frames, ensure branch holds + advances + no NaN
      function driveOn(px, pz, cy, hx, hz) {
        K.forceRace(); K.G.phase = "racing";
        const p = K.G.players.local;
        p.pos.x = px; p.pos.z = pz; p.y = cy; p.vy = 0; p.airborne = false;
        p.theta = Math.atan2(hx, hz); const spd = 14; p.v.x = hx * spd; p.v.z = hz * spd;
        p.spinT = 0; p.starT = 0; p.bullT = 0;
        let ok = true, ys = [], maxY = -1e9;
        const x0 = p.pos.x, z0 = p.pos.z;
        for (let i = 0; i < 60; i++) { const inp = { steer: 0, throttle: 1, brake: 0, drift: false }; K.stepKart(p, inp, 1 / 60); if (!isFinite(p.pos.x) || !isFinite(p.y) || p.y < -40) ok = false; if (p.y > maxY) maxY = p.y; if (i % 12 === 0) ys.push(+p.y.toFixed(1)); }
        const moved = Math.hypot(p.pos.x - x0, p.pos.z - z0);
        return { ok, ys, moved: +moved.toFixed(1), endY: +p.y.toFixed(1), maxY: +maxY.toFixed(1) };
      }
      const underDrive = driveOn(8, 40, 0, 0, 1);      // home straight, heading N
      const overDrive = driveOn(120, 64, 8, -1, 0);    // viaduct, heading W
      return { underY: +under.y.toFixed(1), overY: +over.y.toFixed(1), underDrive, overDrive };
    });
    check("A over/under: home straight resolves y~0 under the viaduct", Math.abs(ou.underY) < 1.5, ou.underY);
    check("A over/under: viaduct resolves y~8 over the home straight", Math.abs(ou.overY - 8) < 1.5, ou.overY);
    check("A over/under: driving the home straight stays low (y<3) + advances + no NaN", ou.underDrive.ok && ou.underDrive.moved > 8 && ou.underDrive.endY < 3, JSON.stringify(ou.underDrive));
    check("A over/under: driving the viaduct stays high (y>6) + advances + no NaN", ou.overDrive.ok && ou.overDrive.moved > 8 && ou.overDrive.endY > 6, JSON.stringify(ou.overDrive));

    // ---- 4) DRIFT-WORTHINESS ----
    const drift = await page.evaluate(() => {
      const K = window.__KART__, T = K.TUNE;
      function nearest(px, pz) { const C = K.centerPts; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const dx = C[i].x - px, dz = C[i].z - pz, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } } return bi; }
      function driftCorner(px, pz) {
        K.forceRace(); K.G.phase = "racing";
        for (const id in K.G.players) { if (id !== "local" && K.G.players[id]) { if (K.removeKartView) K.removeKartView(id); delete K.G.players[id]; } }
        const p = K.G.players.local;
        const bi = nearest(px, pz); const t = K.tangents[bi];
        p.pos.x = K.centerPts[bi].x; p.pos.z = K.centerPts[bi].z; p.pos.y = K.sampleHeight(p.pos.x, p.pos.z); p.y = p.pos.y;
        p.theta = Math.atan2(t.x, t.z); const spd = 26; p.v.x = t.x * spd; p.v.z = t.z * spd;
        p.vy = 0; p.airborne = false; p.spinT = 0; p.starT = 0; p.bullT = 0; p.boostT = 0; p.boostTier = 0;
        p.drift.active = false; p.drift.charge = 0; p.driftAngle = 0;
        p.lastSampleIdx = bi; p.progressS = K.arcS[bi]; p.prevProgressS = K.arcS[bi]; p.checkpoint = 0; p.wrongWayT = 0; p.finishDebounce = 999;
        let maxTier = 0, maxCharge = 0, active = 0, restarts = 0, prevCharge = 0;
        const C = K.centerPts, LOOK = 15;
        // FULL-LOCK pursuit steer (real-key style: keys give +/-1), drift + throttle held the whole time.
        for (let i = 0; i < 200; i++) {  // ~3.3s
          const idx = p.lastSampleIdx;
          let ti = idx, acc = 0; while (acc < LOOK) { const j = (ti + 1) % C.length; acc += Math.hypot(C[j].x - C[ti].x, C[j].z - C[ti].z); ti = j; if (ti === idx) break; }
          const tx = C[ti].x - p.pos.x, tz = C[ti].z - p.pos.z;
          let dth = Math.atan2(tx, tz) - p.theta; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
          // once drifting, hold full-lock INTO the drift direction (what a player does with the turn key);
          // before that, steer toward the corner to trigger the drift.
          const steer = p.drift.active ? p.drift.dir : (dth > 0.015 ? 1 : (dth < -0.015 ? -1 : 0));
          const inp = { steer, throttle: 1, brake: 0, drift: true };
          K.stepKart(p, inp, 1 / 60); K.updateRaceProgress(p, 1 / 60);
          if (p.drift.active) { active++; const tier = K.driftTier(p.drift.charge); if (tier > maxTier) maxTier = tier; if (p.drift.charge > maxCharge) maxCharge = p.drift.charge; if (p.drift.charge < prevCharge - 50) restarts++; prevCharge = p.drift.charge; } else prevCharge = 0;
        }
        return { maxTier, maxCharge: +maxCharge.toFixed(0), active, restarts };
      }
      const t1 = driftCorner(48, 165);
      const sky = driftCorner(345, 118);
      const last = driftCorner(40, -84);
      return { mtTier1: T.mtTier1, t1, sky, last };
    });
    const t2count = [drift.t1, drift.sky, drift.last].filter((d) => d.maxTier >= 2).length;
    check("A drift: T1 reaches a mini-turbo tier (>=1)", drift.t1.maxTier >= 1, JSON.stringify(drift.t1));
    check("A drift: Skyline Loop reaches a mini-turbo tier (>=1)", drift.sky.maxTier >= 1, JSON.stringify(drift.sky));
    check("A drift: Last Call reaches a mini-turbo tier (>=1)", drift.last.maxTier >= 1, JSON.stringify(drift.last));
    check("A drift: tier>=2 sustained in >=2 of {T1, Skyline, Last Call}", t2count >= 2, `t2count=${t2count} T1=${drift.t1.maxTier} Sky=${drift.sky.maxTier} Last=${drift.last.maxTier}`);

    // ============ OVERPASS CROSSING REGRESSION (2026-07-17) ============
    // Bug: driving UNDER (or over) the y8 viaduct that crosses the y0 home straight, the rescue crow
    // grabbed you as if out of bounds, a viaduct vehicle phantom-launched a kart on the road below, and
    // low-road traffic + curbside lamps/lane-marks teleported onto the deck. Root: context-free height
    // (sampleHeight = XZ-nearest branch) used where a branch-aware value was needed. Fixes verified here.
    const cross = await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
      const R = {};
      const CX = 13, CZ = 58, HALF = K.TRACK_WIDTH / 2;   // crossing center (home straight <-> viaduct)
      const _sampled = FK_TRACK.resample(K.ACTIVE_TRACK, THREE);   // same sampling the game feeds the city builders
      const p = K.G.players.local;
      const clearK = () => { p.spinT = 0; p.starT = 0; p.bullT = 0; p.rescueT = 0; p.rescueInvulnT = 0; p.trafficInvulnT = 0; };
      // arc interpolation mirroring buildTraffic.sampleAtArc (branch-correct centerline y).
      const smp = K.centerPts, arcS = K.arcS, T = K.tangents, L = K.TRACK_LEN, N = smp.length;
      function sampleAtArc(a) { a = ((a % L) + L) % L; let i = 0; for (; i < N - 1; i++) { if (arcS[i + 1] > a) break; } const i0 = i, i1 = (i + 1) % N, segLen = (i1 === 0) ? (L - arcS[i0]) : (arcS[i1] - arcS[i0]); const t = segLen > 1e-6 ? (a - arcS[i0]) / segLen : 0; const c0 = smp[i0], c1 = smp[i1], t0 = T[i0], t1 = T[i1]; const x = c0.x + (c1.x - c0.x) * t, z = c0.z + (c1.z - c0.z) * t, y = c0.y + (c1.y - c0.y) * t; let tx = t0.x + (t1.x - t0.x) * t, tz = t0.z + (t1.z - t0.z) * t; const tl = Math.hypot(tx, tz) || 1; return { x, z, y, tx: tx / tl, tz: tz / tl }; }

      // (1) RESCUE: scan the crossing for on-road cells where context-free sampleHeight reads the deck
      //     (would trip the crow pre-fix); assert the hazard EXISTS, and rescueTriggered is false at ALL
      //     of them for a kart on the low road (y0). Also that sampleHeightAtY(...,0) reads the low road.
      let bandCells = 0, rescueFalseAll = true, worstSH = 0, worstAtY = 0;
      for (let z = 46; z <= 68; z += 0.5) for (let x = 0; x <= 20; x += 0.5) {
        const dist = K.nearestCenterInfo(x, z).dist;
        if (dist > HALF) continue;                                         // ON the road only
        const sh = K.sampleHeight(x, z), shy = K.sampleHeightAtY(x, z, 0);
        if (shy > 1.5) continue;                                           // low-road cells only
        if (sh - 0 > K.RESCUE_WORLD_FLOOR) {                               // pre-fix rescue band
          bandCells++; if (sh > worstSH) { worstSH = sh; worstAtY = shy; }
          clearK(); p.pos.x = x; p.pos.z = z; p.y = 0; p.vy = 0; p.airborne = false;
          if (K.rescueTriggered(p)) rescueFalseAll = false;
        }
      }
      R.bandCells = bandCells; R.rescueFalseAll = rescueFalseAll; R.worstSH = +worstSH.toFixed(2); R.worstAtY = +worstAtY.toFixed(2);

      // (2) GENUINE rescue still fires: kart 6u below the road on a single-level home-straight section.
      clearK(); p.pos.x = 8; p.pos.z = 120; p.y = -6; p.vy = 0; p.airborne = false;
      R.genuineFall = !!K.rescueTriggered(p);
      p.y = 0; R.flatNoRescue = !K.rescueTriggered(p);

      // (3) PHANTOM-HIT GATE: park a vehicle on the viaduct (y8) directly over a kart on the low road (y0);
      //     advanceTrafficHits must NOT launch (different level). Then raise the kart to the vehicle's level
      //     -> it DOES launch (same-level hit still works). Move OTHER vehicles far away so only this one rules.
      const vs = K.trafficVehicles, veh = vs[0];
      const stash = vs.map(v => ({ x: v.x, z: v.z, y: v.y }));
      for (let i = 1; i < vs.length; i++) { vs[i].x += 1e5; vs[i].z += 1e5; }   // exile the rest
      veh.x = 8; veh.z = 58; veh.y = 8; veh.yaw = 0; veh.group.position.set(8, 8 + veh.wheelR, 58);
      clearK(); p.pos.x = 8; p.pos.z = 58; p.y = 0; p.v.x = 0; p.v.z = 12; p.airborne = false;
      K.advanceTrafficHits(1 / 60);
      R.gateBlocksOverpass = (p.spinT === 0 && p.trafficInvulnT === 0);
      clearK(); p.pos.x = 8; p.pos.z = 58; p.y = 8; p.v.x = 0; p.v.z = 12;   // now SAME level as the vehicle
      K.advanceTrafficHits(1 / 60);
      R.sameLevelStillHits = (p.spinT > 0);
      for (let i = 0; i < vs.length; i++) { vs[i].x = stash[i].x; vs[i].z = stash[i].z; vs[i].y = stash[i].y; }   // restore

      // (4) REAL DRIVE-UNDER passes (traffic ruling active + a viaduct vehicle tracked overhead): rescueT,
      //     spinT, trafficInvulnT stay 0 and the kart holds its low branch (y<2) even while crossing cells
      //     that WOULD have tripped the crow pre-fix. Pick the on-road lateral offset that maximizes the
      //     pre-fix deck reading so the drive genuinely traverses the hazard band.
      // pick the largest lateral offset whose height still resolves SOLIDLY to the low branch (AtY<0.3):
      // that keeps the drive off the genuinely-ambiguous deck-edge boundary (a pre-existing K7 multi-level
      // concern, not the crow bug) while still crossing cells the OLD context-free sampleHeight read as deck.
      let bestX = 8, bestSH = -1; for (let x = 8; x <= 8 + HALF - 2; x += 0.5) { if (K.sampleHeightAtY(x, 60, 0) > 0.3) continue; const sh = K.sampleHeight(x, 60); if (sh > bestSH) { bestSH = sh; bestX = x; } }
      function driveUnder() {
        clearK(); p.pos.x = bestX; p.pos.z = 44; p.y = 0; p.vy = 0; p.airborne = false;
        p.theta = 0; const spd = 22; p.v.x = 0; p.v.z = spd;   // heading north up the home straight
        veh.yaw = 0;
        let maxR = 0, maxS = 0, maxI = 0, maxY = -1e9, hazardFrames = 0;
        for (let i = 0; i < 90; i++) {
          K.stepKart(p, { steer: 0, throttle: 1, brake: 0, drift: false }, 1 / 60);
          veh.x = p.pos.x; veh.z = p.pos.z; veh.y = p.y + 8; veh.group.position.set(p.pos.x, p.y + 8 + veh.wheelR, p.pos.z);   // bus on the deck above, tracking
          K.advanceTrafficHits(1 / 60);
          if (K.sampleHeight(p.pos.x, p.pos.z) - p.y > K.RESCUE_WORLD_FLOOR) hazardFrames++;   // pre-fix crow band
          maxR = Math.max(maxR, p.rescueT); maxS = Math.max(maxS, p.spinT); maxI = Math.max(maxI, p.trafficInvulnT); maxY = Math.max(maxY, p.y);
        }
        return { maxR, maxS, maxI, maxY: +maxY.toFixed(2), hazardFrames };
      }
      for (let i = 1; i < vs.length; i++) { vs[i].x += 1e5; vs[i].z += 1e5; }   // exile the rest for the pass
      const pass1 = driveUnder(), pass2 = driveUnder(), pass3 = driveUnder();
      for (let i = 0; i < vs.length; i++) { vs[i].x = stash[i].x; vs[i].z = stash[i].z; vs[i].y = stash[i].y; }
      R.passes = [pass1, pass2, pass3];
      R.driveClean = [pass1, pass2, pass3].every(q => q.maxR === 0 && q.maxS === 0 && q.maxI === 0 && q.maxY < 2);
      R.driveHitHazard = [pass1, pass2, pass3].every(q => q.hazardFrames > 0);

      // (5) VEHICLE branch stability: sweep veh[0] along the low-road crossing arc; actual seat y stays low
      //     even where hfn(x,z) (the OLD seat source) reads the deck. Records both to show the contrast.
      let maxSeat = -1, maxHfn = -1, sweptLow = 0;
      for (let a = 0; a < L; a += 2) {
        const sp = sampleAtArc(a); if (sp.y > 2) continue;
        const nlx = -sp.tz, nlz = sp.tx, lx = sp.x + nlx * veh.laneOff, lz = sp.z + nlz * veh.laneOff;
        if (Math.hypot(lx - CX, lz - CZ) > 30) continue;   // near the crossing only
        sweptLow++;
        veh.head = a; K.TRAFFIC_GROUP.userData.update(0);
        maxSeat = Math.max(maxSeat, veh.group.position.y);
        maxHfn = Math.max(maxHfn, K.sampleHeight(lx, lz));
      }
      R.vehSweptLow = sweptLow; R.vehMaxSeatY = +maxSeat.toFixed(2); R.vehMaxHfnWouldBe = +maxHfn.toFixed(2);
      R.vehHasY = (typeof veh.y === "number");

      // (6) CITYSCAPE statics near the crossing sit on a real branch (~0 or ~8), and their height is
      //     INDEPENDENT of the heightFn (proves y now comes from the centerline, not an XZ probe).
      //   lane marks: rebuild with a sane heightFn AND a deliberately-wrong one; near-crossing vertex Ys
      //   must be identical AND each within 1.5u of 0 or 8, with both branches represented.
      function laneYsNear(hf) {
        const g = FK_TRACK.buildLaneMarks(_sampled, K.TRACK_WIDTH, THREE, { heightFn: hf });
        const ys = []; g.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i); if (Math.hypot(x - CX, z - CZ) <= 12) ys.push(+y.toFixed(3)); } } });
        return ys;
      }
      const laneSane = laneYsNear((x, z) => K.sampleHeight(x, z));
      const laneWrong = laneYsNear(() => 999);
      R.laneN = laneSane.length;
      R.laneHeightFnIndependent = (laneSane.length === laneWrong.length) && laneSane.every((y, i) => Math.abs(y - laneWrong[i]) < 0.01);
      R.laneOnBranch = laneSane.every(y => Math.abs(y - 0) < 1.6 || Math.abs(y - 8) < 1.6);
      R.laneLowPresent = laneSane.some(y => Math.abs(y - 0) < 1.6);
      R.laneHighPresent = laneSane.some(y => Math.abs(y - 8) < 1.6);
      //   lamps: rebuild the cityscape with a wrong heightFn; near-crossing lamp instances (poles) must
      //   still sit on a real branch (translationY ~ 3.5 or ~11.5 = by + poleH/2, poleH 7), NOT ~1002.
      function lampYsNear(hf) {
        const cg = FK_TRACK.buildCityscape(_sampled, K.TRACK_WIDTH, THREE, { heightFn: hf, groundFn: (x, z) => K.groundSampleHeight(x, z), wallMargin: 6 });
        const m = new THREE.Matrix4(), bases = [];
        cg.traverse(o => { if (o.isInstancedMesh && o.userData && o.userData.cityRole === "lamp" && o.geometry && o.geometry.parameters && o.geometry.parameters.height > 5) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); const x = m.elements[12], y = m.elements[13], z = m.elements[14]; if (Math.hypot(x - CX, z - CZ) <= 40) bases.push(+(y - 3.5).toFixed(2)); } } });
        return bases;   // pole translationY - poleH/2 = curb base height
      }
      const lampWrong = lampYsNear(() => 999);
      R.lampNearN = lampWrong.length;
      R.lampsOnBranch = lampWrong.length > 0 && lampWrong.every(b => Math.abs(b - 0) < 1.6 || Math.abs(b - 8) < 1.6);
      R.lampsIgnoreHeightFn = lampWrong.every(b => b < 100);   // NOT lifted to 999 by the wrong heightFn
      return R;
    });
    check("A crossing: pre-fix crow hazard band EXISTS (on-road low cells reading the deck)", cross.bandCells > 0 && cross.worstSH > 5 && cross.worstAtY < 1.5, JSON.stringify({ bandCells: cross.bandCells, worstSH: cross.worstSH, worstAtY: cross.worstAtY }));
    check("A crossing: rescue crow does NOT fire anywhere in the band (kart on low road)", cross.rescueFalseAll, `${cross.bandCells} cells`);
    check("A crossing: a GENUINE fall (6u below road) still triggers rescue; flat road does not", cross.genuineFall && cross.flatNoRescue, JSON.stringify({ genuineFall: cross.genuineFall, flat: cross.flatNoRescue }));
    check("A crossing: Y-gate blocks a viaduct vehicle over a kart on the road below (no phantom launch)", cross.gateBlocksOverpass, JSON.stringify(cross));
    check("A crossing: a SAME-LEVEL traffic hit still launches (gate not too aggressive)", cross.sameLevelStillHits, JSON.stringify(cross));
    check("A crossing: real drive-under passes hold the low branch + no crow/hit (traffic active)", cross.driveClean, JSON.stringify(cross.passes));
    check("A crossing: those passes actually traversed the pre-fix crow band (hazardFrames>0)", cross.driveHitHazard, JSON.stringify(cross.passes.map(q => q.hazardFrames)));
    check("A crossing: traffic vehicle stays on the LOW branch through the crossing (seat<2 vs deck~8)", cross.vehSweptLow > 0 && cross.vehMaxSeatY < 2 && cross.vehMaxHfnWouldBe > 5 && cross.vehHasY, JSON.stringify({ swept: cross.vehSweptLow, seatY: cross.vehMaxSeatY, hfnWouldBe: cross.vehMaxHfnWouldBe }));
    check("A crossing: lane-mark height is independent of heightFn (comes from centerline y)", cross.laneN > 0 && cross.laneHeightFnIndependent, JSON.stringify({ n: cross.laneN, indep: cross.laneHeightFnIndependent }));
    check("A crossing: near-crossing lane marks sit on a real branch (~0 or ~8), both represented", cross.laneOnBranch && cross.laneLowPresent && cross.laneHighPresent, JSON.stringify({ onBranch: cross.laneOnBranch, low: cross.laneLowPresent, high: cross.laneHighPresent }));
    check("A crossing: near-crossing street lamps sit on a real branch + ignore a wrong heightFn", cross.lampNearN > 0 && cross.lampsOnBranch && cross.lampsIgnoreHeightFn, JSON.stringify({ n: cross.lampNearN, onBranch: cross.lampsOnBranch, ignoreHf: cross.lampsIgnoreHeightFn }));

    // crossing screenshot for the user (kart mid-crossing under the viaduct, racing cleanly)
    await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
      const p = K.G.players.local; p.pos.x = 12; p.pos.z = 50; p.y = 0; p.vy = 0; p.airborne = false;
      p.theta = 0; p.v.x = 0; p.v.z = 20; p.spinT = 0; p.rescueT = 0;
      K._setKeys("w", true);
    });
    await new Promise((r) => setTimeout(r, 1100));
    await page.evaluate(() => window.__KART__._setKeys("w", false));
    await page.screenshot({ path: path.join(SHOTS, "fk_midnight_crossing_fixed.png") });

    // ---- staged screenshots (drive-and-settle: place at an arc fraction, hold throttle so the chase
    //      camera settles behind the kart, then shoot) ----
    async function driveShot(name, targetS, speed, ms) {
      await page.evaluate((s0, spd) => {
        const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
        const C = K.centerPts, arcS = K.arcS, L = K.TRACK_LEN;
        let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.abs(arcS[i] / L - s0); if (d < bd) { bd = d; bi = i; } }
        const p = K.G.players.local, t = K.tangents[bi];
        p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.vy = 0; p.airborne = false;
        p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * spd; p.v.z = t.z * spd; p.lastSampleIdx = bi; p.spinT = 0;
        K._setKeys("w", true);
      }, targetS, speed);
      await new Promise((r) => setTimeout(r, ms));
      await page.evaluate(() => window.__KART__._setKeys("w", false));
      await page.screenshot({ path: path.join(SHOTS, name) });
    }
    await driveShot("fk_midnight_esses.png", 0.16, 20, 900);    // esses (traffic + skyline)
    await driveShot("fk_midnight_tunnel.png", 0.690, 11, 900);  // inside the tunnel bore (~40% in)
    await driveShot("fk_midnight_viaduct.png", 0.505, 20, 1300);// on the elevated viaduct, city around

    check("A 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ PASS B: drivability (3 bots, ~90s) ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    const drive = await page.evaluate(() => {
      const K = window.__KART__;
      K.forceRace(); K.G.raceMode = "prix"; sessionStorage.removeItem("fk_cup_session");
      K.setupRoster(); K.placeAllAtGrid();
      // keep exactly 3 bots
      let kept = 0;
      for (const id in K.G.players) { const p = K.G.players[id]; if (p && p.isBot) { if (kept < 3) kept++; else { if (K.removeKartView) K.removeKartView(id); delete K.G.players[id]; } } }
      K.G.lapsTotal = 20; // don't let anyone "finish" during the window
      const bots = []; for (const id in K.G.players) { const p = K.G.players[id]; if (p && p.isBot) bots.push({ id, p }); }
      const human = K.G.players.local;
      const dt = 1 / 60, STEPS = Math.round(90 / dt);
      const maxLap = {}, slowRun = {}, maxSlow = {}, nanFlag = {}, minY = {};
      for (const { id, p } of bots) { maxLap[id] = 0; slowRun[id] = 0; maxSlow[id] = 0; nanFlag[id] = false; minY[id] = 1e9; }
      let humanMaxLap = 0, firstBad = null;
      for (let i = 0; i < STEPS; i++) {
        const hin = K.botInput(human); K.soloRaceTick(dt, hin);
        for (const { id, p } of bots) {
          if (p.lap > maxLap[id]) maxLap[id] = p.lap;
          const spd = Math.hypot(p.v.x, p.v.z);
          if (spd < 1.5) { slowRun[id]++; if (slowRun[id] > maxSlow[id]) maxSlow[id] = slowRun[id]; } else slowRun[id] = 0;
          if (isFinite(p.y) && p.y < minY[id]) minY[id] = p.y;
          const bad = !isFinite(p.pos.x) || !isFinite(p.pos.z) || !isFinite(p.y) || p.y < -60;
          if (bad) { nanFlag[id] = true; if (!firstBad) firstBad = { id, frame: i, x: +p.pos.x, y: p.y, z: +p.pos.z }; }
        }
        if (human.lap > humanMaxLap) humanMaxLap = human.lap;
      }
      return {
        nBots: bots.length,
        laps: bots.map(({ id }) => maxLap[id]),
        maxSlowSec: bots.map(({ id }) => +(maxSlow[id] / 60).toFixed(1)),
        nan: bots.some(({ id }) => nanFlag[id]),
        minY: bots.map(({ id }) => +minY[id].toFixed(1)),
        firstBad,
        humanMaxLap,
      };
    });
    check("B drivability: exactly 3 bots", drive.nBots === 3, drive.nBots);
    check("B drivability: every bot completes >=1 full lap in ~90s", drive.laps.every((l) => l >= 1), JSON.stringify(drive.laps));
    check("B drivability: no bot stuck (>5s at ~0 speed)", drive.maxSlowSec.every((s) => s <= 5), JSON.stringify(drive.maxSlowSec));
    check("B drivability: no NaN / fall-through", drive.nan === false, JSON.stringify({ minY: drive.minY, firstBad: drive.firstBad }));
    check("B drivability: human autopilot also laps (sanity)", drive.humanMaxLap >= 1, drive.humanMaxLap);
    check("B 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ PASS C: menu course-grid card + preview ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.MenuFlow), { timeout: 15000 });
    const menu = await page.evaluate(() => {
      const MF = window.MenuFlow;
      // build the Time-Trial course grid directly (its closure builder, exposed for tests)
      try { MF._openCourseGrid("tt"); } catch (e) { return { err: String(e) }; }
      const card = document.querySelector('.mfCard[data-id="midnight-run"]');
      const hasCard = !!card;
      const cn = card && card.querySelector(".cn"); const nameOk = !!(cn && /Midnight Run/i.test(cn.textContent || ""));
      // check the preview canvas rendered non-blank
      let nonBlank = false;
      if (card) { const c = card.querySelector("canvas"); if (c) { const ctx = c.getContext("2d"); if (ctx) { const d = ctx.getImageData(0, 0, c.width, c.height).data; let nz = 0; for (let k = 0; k < d.length; k += 4) { if (d[k] || d[k + 1] || d[k + 2] || d[k + 3] < 255) { nz++; if (nz > 30) { nonBlank = true; break; } } } } } }
      return { hasCard, nameOk, nonBlank };
    });
    check("C menu: 'Midnight Run' card appears in the course grid", menu.hasCard && menu.nameOk, JSON.stringify(menu));
    check("C menu: a track preview canvas rendered non-blank for it", menu.nonBlank, JSON.stringify(menu));
    check("C 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ PASS D: mobile smoke ============
  {
    const page = await newPage(true);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace && window.__KART__.CITY_GROUP), { timeout: 15000 });
    await page.evaluate(() => { const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; K._setKeys("w", true); });
    await new Promise((r) => setTimeout(r, 1600));
    await page.screenshot({ path: path.join(SHOTS, "fk_midnight_mobile.png") });
    const mob = await page.evaluate(() => ({ traffic: window.__KART__.trafficVehicles.length, city: !!window.__KART__.CITY_GROUP }));
    check("D mobile: city + 8 traffic present", mob.city && mob.traffic === 8, JSON.stringify(mob));
    check("D mobile 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}

  const pass = CHECKS.filter((c) => c.pass).length;
  console.log(`midnight-run verify: ${pass}/${CHECKS.length} pass`);
  for (const c of CHECKS) console.log(`  ${c.pass ? "OK" : "FAIL"}  ${c.name}${c.detail !== "" ? " — " + c.detail : ""}`);
  if (errorsAll.length) { console.log("pageerrors:"); errorsAll.forEach((e) => console.log("  ", e)); }
  const ok = CHECKS.every((c) => c.pass) && errorsAll.length === 0;
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
