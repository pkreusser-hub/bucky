#!/usr/bin/env node
"use strict";
/**
 * Headless verify: "Harvest Hollow" (harvest-hollow) — the farm-life showcase circuit.
 *  1) pure-node : the NEW roadColor/curbColor sanitize keys round-trip + are omitted when absent +
 *     reject invalid values; adding them is byte-identical for tracks WITHOUT them (vs a module with my
 *     two lines stripped, so the this-session foundation keys don't confound it); harvest-hollow keeps
 *     roadColor/curbColor + every farm-feature key.
 *  2) geometry  : resample@400 — closure kink <8deg, max|slope|<0.35, no unintended near-overlap.
 *  3) road reads dirt: the ribbon road mesh material == roadColor, curbs == curbColor; the DEFAULT
 *     track's ribbon colours are unchanged (byte-identical) by the feature.
 *  4) features live: 3 chicken/critter crossings (incl. a goat), 2 pastures w/ cows, a circling train
 *     with 2 gated crossings, 2 waters (ford + pond), 2 on-road boost pads, an aligned ramp.
 *  5) ford      : wading slowdown + splash + NEVER the rescue crow (park 5s), depth never reaches drown;
 *     a full-speed ramp jump goes airborne over the creek and lands PAST the water; water fully
 *     contained (0 leak across the map).
 *  6) critters  : a chicken crossing spins a kart on contact; the goat crossing is kind 'goat' + spins;
 *     the train lowers its gates as it approaches, spins a kart hit by a car, and raises them after;
 *     cows spawn and NEVER sit inside road half+COW_ROAD_PAD over 30s.
 *  7) drift     : scripted full-lock drift reaches mini-turbo tier >=2 in >=2 of {T1, orchard, last sweeper}.
 *  8) drivability: 3 bots each lap >=1 in ~90s, none stuck, no NaN; a bot crosses the ford.
 *  9) menu      : the course-grid builds a harvest-hollow card + a non-blank preview.
 * 10) screenshots -> shots/. Cloud domains blocked throughout. deviceScaleFactor 1.5.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { execSync, spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const puppeteer = require(path.join(ROOT, "tools/node_modules/puppeteer-core"));
const SHOTS = path.join(ROOT, "shots");
const PORT = 8877;
const BASE = `http://127.0.0.1:${PORT}`;
const ID = "harvest-hollow";

function isOpen(port) { return new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(800, () => { s.destroy(); res(false); }); }); }
async function waitServer(port, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await isOpen(port)) { try { await new Promise((res, rej) => { http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej); }); return; } catch (_) {} } await new Promise((r) => setTimeout(r, 200)); } throw new Error("server timeout"); }

const CHECKS = [];
function check(name, cond, detail) { CHECKS.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) }); }

// ---------- 1) pure-node ----------
function loadModule(code) { const win = {}; new Function("window", "document", code)(win, undefined); return win.FK_TRACK; }
function pureNodeChecks() {
  const srcNew = fs.readFileSync(path.join(ROOT, "assets/farmkart-track.js"), "utf8");
  const NEW = loadModule(srcNew);
  const OLD = loadModule(execSync("git show HEAD:assets/farmkart-track.js", { cwd: ROOT, maxBuffer: 1 << 24 }).toString());
  // A version of the CURRENT module with ONLY my roadColor/curbColor sanitize lines removed — isolates
  // that adding them perturbs nothing (HEAD also lacks the foundation theme/traffic keys, so a raw HEAD
  // compare would false-fail on midnight-run; this compare is exact for my change).
  const srcNoMine = srcNew
    .replace(/\s*if \(isFinite\(\+data\.roadColor\)[^\n]*out\.roadColor[^\n]*\n/, "\n")
    .replace(/\s*if \(isFinite\(\+data\.curbColor\)[^\n]*out\.curbColor[^\n]*\n/, "\n");
  check("pure: my two sanitize lines were located + stripped for the isolation compare", srcNoMine !== srcNew && !/out\.roadColor/.test(srcNoMine) && !/out\.curbColor/.test(srcNoMine));
  const NOMINE = loadModule(srcNoMine);
  // byte-identical vs HEAD for tracks that predate this session (no theme/traffic/road-curb keys)
  for (const id of ["__default__", "wario-stadium", "royal-raceway", "goat-temple", "sunny-meadows", "frosty-flats", "barnyard-brawl"]) {
    const t = id === "__default__" ? NEW.DEFAULT_TRACK : NEW.BUILTIN_TRACKS[id];
    const a = JSON.stringify(OLD.sanitize(JSON.parse(JSON.stringify(t))));
    const b = JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(t))));
    check("pure: sanitize byte-identical vs HEAD — " + (t.name || id), a === b);
  }
  // isolation: my change perturbs NOTHING for a foundation track that uses this-session keys (midnight-run)
  const mr = NEW.BUILTIN_TRACKS["midnight-run"];
  if (mr) check("pure: roadColor/curbColor lines perturb nothing (midnight-run)", JSON.stringify(NOMINE.sanitize(JSON.parse(JSON.stringify(mr)))) === JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(mr)))));
  // new-key behaviour
  const pts = NEW.BUILTIN_TRACKS[ID].points;
  const rc = NEW.sanitize({ points: pts, roadColor: 0x8a6b45, curbColor: 0xb0996f });
  check("pure: roadColor/curbColor round-trip", rc.roadColor === 0x8a6b45 && rc.curbColor === 0xb0996f, JSON.stringify({ r: rc.roadColor, c: rc.curbColor }));
  const noc = NEW.sanitize({ points: pts });
  check("pure: colours OMITTED when absent", noc.roadColor === undefined && noc.curbColor === undefined);
  const bad = NEW.sanitize({ points: pts, roadColor: -5, curbColor: 0x1000000 });
  check("pure: invalid colours rejected", bad.roadColor === undefined && bad.curbColor === undefined);
  // harvest-hollow itself
  const raw = NEW.BUILTIN_TRACKS[ID];
  check("pure: harvest-hollow is a builtin", !!raw);
  const s = NEW.sanitize(JSON.parse(JSON.stringify(raw)));
  check("pure: harvest-hollow sanitizes", !!s);
  check("pure: sanitize idempotent / all keys round-trip", JSON.stringify(s) === JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(s)))));
  check("pure: keeps roadColor(dirt) + curbColor", s.roadColor === 0x8a6b45 && s.curbColor === 0xb0996f, JSON.stringify({ r: s.roadColor && s.roadColor.toString(16), c: s.curbColor && s.curbColor.toString(16) }));
  check("pure: keeps sky:sun + wallMargin:8 + laps:3 + width:18", s.sky === "sun" && s.wallMargin === 8 && s.laps === 3 && s.width === 18);
  check("pure: 3 critter crossings incl. a goat", Array.isArray(s.chickens) && s.chickens.length === 3 && s.chickens.some((c) => c.kind === "goat"), JSON.stringify(s.chickens.map((c) => c.kind || "chicken")));
  check("pure: 2 pastures w/ cows", Array.isArray(s.pastures) && s.pastures.length === 2 && s.pastures.every((p) => p.count > 0));
  check("pure: 1 closed-loop train (>=3 pts)", Array.isArray(s.trains) && s.trains.length === 1 && s.trains[0].points.length >= 3);
  check("pure: 2 waters (ford + pond)", Array.isArray(s.waters) && s.waters.length === 2);
  check("pure: 2 boost pads", Array.isArray(s.boostPads) && s.boostPads.length === 2);
  check("pure: 4 item rows", Array.isArray(s.itemRows) && s.itemRows.length === 4);
  check("pure: a ramp object present", Array.isArray(s.objects) && s.objects.some((o) => o.type === "ramp"));
  check("pure: dressed with glb farm props (>60)", s.objects.filter((o) => o.type === "glb").length > 60, s.objects.length);
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
    if (mobile) await page.evaluateOnNewDocument(() => { const real = window.matchMedia ? window.matchMedia.bind(window) : null; window.matchMedia = (q) => (/coarse/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : (real ? real(q) : { matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })); });
    await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 1.5 } : { width: 1280, height: 800, deviceScaleFactor: 1.5 });
    const errs = [];
    page.on("pageerror", (e) => { errs.push(String(e.message || e)); errorsAll.push(String(e.message || e)); });
    await page.setRequestInterception(true);
    page.on("request", (req) => { if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort(); req.continue(); });
    page._errs = errs;
    return page;
  }

  // ============ PASS A: desktop, ?track=harvest-hollow — geometry + colours + features + ford + drift ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace && window.__KART__.TRAIN_GROUP), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500)); // let glb props load

    // ---- 2) GEOMETRY ----
    const geo = await page.evaluate(() => {
      const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
      const C = smp.centerPts, T = smp.tangents, N = 400, L = smp.trackLen;
      const az = (t) => Math.atan2(t.x, t.z) * 180 / Math.PI, angd = (a, b) => { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d; };
      let maxSlope = 0, maxKink = 0, closure = angd(az(T[N - 1]), az(T[0]));
      for (let i = 0; i < N; i++) { const a = C[i], b = C[(i + 1) % N]; const h = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6; maxSlope = Math.max(maxSlope, Math.abs(b.y - a.y) / h); maxKink = Math.max(maxKink, angd(az(T[i]), az(T[(i + 1) % N]))); }
      const GAP = 26; let nBad = 0, closest = null, cd = 1e9;
      for (let i = 0; i < N; i++) for (let j = i + GAP; j < N; j++) { if (Math.min(j - i, N - (j - i)) < GAP) continue; const a = C[i], b = C[j], d = Math.hypot(a.x - b.x, a.z - b.z), yg = Math.abs(a.y - b.y); if (d < cd) { cd = d; closest = { d: +d.toFixed(1), yg: +yg.toFixed(1) }; } if (d < 20 && yg < 4) nBad++; }
      return { L: +L.toFixed(0), maxSlope: +maxSlope.toFixed(3), maxKink: +maxKink.toFixed(1), closure: +closure.toFixed(1), nBad, closest };
    });
    check("A geometry: closure kink < 8deg", geo.closure < 8, geo.closure + "deg");
    check("A geometry: max |slope| < 0.35", geo.maxSlope < 0.35, geo.maxSlope);
    check("A geometry: no unintended near-overlap (<20u, Ygap<4)", geo.nBad === 0, JSON.stringify(geo.closest));
    check("A geometry: max per-sample kink sane (<16deg)", geo.maxKink < 16, geo.maxKink);
    check("A geometry: length in range (800-1100)", geo.L > 800 && geo.L < 1100, geo.L);

    // ---- 3) ROAD READS DIRT (ribbon material colour == roadColor / curbColor) ----
    const col = await page.evaluate(() => {
      const K = window.__KART__;
      // the ribbon group = first non-offroad child added; find meshes with MeshLambert whose colour matches
      const want = { road: K.ACTIVE_TRACK.roadColor, curb: K.ACTIVE_TRACK.curbColor };
      let roadHit = false, curbHit = false, hexes = [];
      K.scene.traverse((o) => { if (o.isMesh && o.material && o.material.color && o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count > 500) {
        const hex = o.material.color.getHex(); if (Math.abs(hex - want.road) === 0) roadHit = true; if (Math.abs(hex - want.curb) === 0) curbHit = true; if (hexes.length < 12) hexes.push("0x" + hex.toString(16)); } });
      return { roadColor: "0x" + want.road.toString(16), curbColor: "0x" + want.curb.toString(16), roadHit, curbHit, hexes };
    });
    check("A dirt road: ribbon road mesh colour == track roadColor (0x8a6b45)", col.roadHit, JSON.stringify(col));
    check("A dirt road: ribbon curb mesh colour == track curbColor (0xb0996f)", col.curbHit, JSON.stringify(col));

    // default-track ribbon colours unchanged (build a ribbon for the DEFAULT track — no roadColor set)
    const def = await page.evaluate(() => {
      const K = window.__KART__, smp = FK_TRACK.resample(FK_TRACK.DEFAULT_TRACK, THREE, 200);
      const g = FK_TRACK.buildRibbonGeometry(smp, 18, THREE, { amp: 3.4, wave: 60, margin: 9 });
      const cols = []; g.traverse((o) => { if (o.isMesh && o.material && o.material.color) cols.push(o.material.color.getHex()); });
      return cols;
    });
    check("A dirt road: DEFAULT track ribbon keeps stock colours (0x33373d road + 0xdfe4ea curbs)", def.includes(0x33373d) && def.includes(0xdfe4ea), JSON.stringify(def.map((c) => "0x" + c.toString(16))));

    // ---- 4) FEATURES present ----
    const feat = await page.evaluate(() => {
      const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
      const pads = K.boostPads.map((p) => ({ dist: +FK_TRACK.nearestOnCenter(smp, p.x, p.z).dist.toFixed(1) }));
      const ramp = (K.ACTIVE_TRACK.objects || []).find((o) => o.type === "ramp");
      return { chickens: (K.ACTIVE_TRACK.chickens || []).length, pastures: (K.ACTIVE_TRACK.pastures || []).length,
        trains: K.TRAIN_GROUP.userData.trains.length, waters: K.WATER_GROUP.children.length, crossings: K.trainCrossings.length,
        pads, half: K.TRACK_WIDTH / 2, rampRotY: ramp ? +ramp.rotY.toFixed(3) : null };
    });
    check("A features: 3 critter crossings", feat.chickens === 3, feat.chickens);
    check("A features: 2 pastures", feat.pastures === 2, feat.pastures);
    check("A features: 1 train + >=1 gated crossing", feat.trains === 1 && feat.crossings >= 1, JSON.stringify({ trains: feat.trains, crossings: feat.crossings }));
    check("A features: 2 water bodies rendered", feat.waters === 2, feat.waters);
    check("A features: 2 boost pads both on-road (dist < half+2)", feat.pads.length === 2 && feat.pads.every((p) => p.dist < feat.half + 2), JSON.stringify(feat.pads));
    check("A features: ramp aligned to track (rotY != 0)", feat.rampRotY !== null && Math.abs(feat.rampRotY) > 0.01, feat.rampRotY);

    // ---- 5) FORD: wade + splash + no rescue + never drown + contained ----
    const ford = await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
      const R = {};
      // scan the ford + the whole map for depth + leaks
      let fordMax = 0, drown = K.RESCUE_DEEP_WATER;
      for (let x = 190; x <= 236; x += 1) for (let z = -102; z <= -56; z += 1) { const d = K.waterDepthAt(x, z); if (d > fordMax) fordMax = d; }
      let leak = 0;
      for (let x = -95; x <= 248; x += 3) for (let z = -158; z <= 196; z += 3) { const d = K.waterDepthAt(x, z); if (d > 0.06) { const inFord = (x >= 188 && x <= 238 && z >= -104 && z <= -54); const inPond = (x >= -96 && x <= -40 && z >= -66 && z <= -10); if (!inFord && !inPond) leak++; } }
      R.fordMaxDepth = +fordMax.toFixed(2); R.drownThresh = +drown.toFixed(2); R.leak = leak;
      R.fordCenterDepth = +K.waterDepthAt(213, -79).toFixed(2);
      R.fordWades = K.waterDepthAt(213, -79) > K.WATER_SHALLOW_K * K.KART_RIDER_H;
      // WADE SLOWDOWN: drive the SAME kart down a dry road stretch vs through the ford; compare top speed.
      const p = K.G.players.local;
      function runTop(x0, z0, hx, hz) { p.pos.x = x0; p.pos.z = z0; p.y = K.sampleHeight(x0, z0); p.vy = 0; p.airborne = false; p.theta = Math.atan2(hx, hz); p.v.x = 0; p.v.z = 0; p.spinT = 0; p.boostT = 0; let mx = 0; for (let i = 0; i < 150; i++) { K.stepKart(p, { steer: 0, throttle: 1, brake: 0, drift: false }, 1 / 60); mx = Math.max(mx, Math.hypot(p.v.x, p.v.z)); } return mx; }
      R.dryTop = +runTop(150, 143, 1, 0).toFixed(1);        // flat pasture straight (dry)
      // wade: pin the kart INSIDE the ford water and hold throttle; its top speed must be throttled
      p.pos.x = 213; p.pos.z = -79; p.y = K.sampleHeight(213, -79); p.vy = 0; p.airborne = false; p.theta = 0; p.v.x = 0; p.v.z = 0; p.spinT = 0;
      let wadeTop = 0, splashSeen = false;
      const origSplash = K.spawnWaterSplash;
      for (let i = 0; i < 150; i++) { p.pos.x = 213; p.pos.z = -79 + (i % 3) * 0.01; K.stepKart(p, { steer: 0, throttle: 1, brake: 0, drift: false }, 1 / 60); if (K.waterDepthAt(p.pos.x, p.pos.z) > K.WATER_SHALLOW_K * K.KART_RIDER_H) { const mul = K.waterSpeedMul(K.waterDepthAt(p.pos.x, p.pos.z)); if (mul < 0.99) splashSeen = true; } wadeTop = Math.max(wadeTop, Math.hypot(p.v.x, p.v.z)); }
      R.wadeMul = +K.waterSpeedMul(K.waterDepthAt(213, -79)).toFixed(3);
      R.wadeSlows = R.wadeMul < 0.95;
      // NO RESCUE even sitting in the ford 5s
      p.pos.x = 213; p.pos.z = -79; p.y = K.sampleHeight(213, -79); p.vy = 0; p.airborne = false; p.rescueT = 0; p.spinT = 0;
      let rescued = false; for (let i = 0; i < 300; i++) { if (K.rescueTriggered(p)) { rescued = true; break; } } R.noRescueSitting = !rescued;
      // SPLASH: waterAt returns a region at the ford (so spawnWaterSplash's entry FX + sound fire)
      R.waterAtFord = !!K.waterAt(213, -79);
      return R;
    });
    check("A ford: contained — 0 water leak across the map", ford.leak === 0, "leak=" + ford.leak);
    check("A ford: depth is WADING only, never drown", ford.fordMaxDepth > 0 && ford.fordMaxDepth < ford.drownThresh, JSON.stringify({ max: ford.fordMaxDepth, drown: ford.drownThresh }));
    check("A ford: centre depth wades (past the shallow boundary)", ford.fordWades && ford.fordCenterDepth > 0.4, ford.fordCenterDepth);
    check("A ford: measurable wade slowdown (speed mul < 0.95)", ford.wadeSlows, "mul=" + ford.wadeMul);
    check("A ford: sitting in the creek 5s never triggers the rescue crow", ford.noRescueSitting);
    check("A ford: waterAt() flags the ford (splash FX/sound fire)", ford.waterAtFord);

    // RAMP JUMP clears the water: full speed into the ramp -> airborne over the dip, lands past the creek
    const jump = await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
      const p = K.G.players.local, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400), C = smp.centerPts, Tn = smp.tangents;
      // start ~30u before the ramp on the approach (crop-esses exit heading toward the ford), max speed
      let bi = 0, bd = 1e18; for (let i = 0; i < 400; i++) { const dx = C[i].x - 235, dz = C[i].z - -40, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
      const t = Tn[bi]; p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.vy = 0; p.airborne = false; p.theta = Math.atan2(t.x, t.z);
      const spd = 30; p.v.x = t.x * spd; p.v.z = t.z * spd; p.spinT = 0; p.boostT = 0.6; p.boostTier = 1;
      let airborne = false, maxY = -1e9, overWater = false, landX = 0, landZ = 0, landedDry = false, everInWater = false;
      for (let i = 0; i < 220; i++) { K.stepKart(p, { steer: 0, throttle: 1, brake: 0, drift: false }, 1 / 60);
        if (p.airborne) { airborne = true; if (K.waterAt(p.pos.x, p.pos.z)) overWater = true; }
        if (p.y > maxY) maxY = p.y;
        if (K.waterDepthAt(p.pos.x, p.pos.z) > 0.05) everInWater = true;
        if (airborne && !p.airborne && !landX) { landX = p.pos.x; landZ = p.pos.z; landedDry = K.waterDepthAt(p.pos.x, p.pos.z) < 0.05; break; }
      }
      // did the flight actually pass OVER the creek's z-span? the creek is ~z -68..-90 near x205
      const clearedCreek = airborne && landZ < -88;   // landed south of the water span
      return { airborne, maxY: +maxY.toFixed(2), overWater, landX: +landX.toFixed(0), landZ: +landZ.toFixed(0), landedDry, clearedCreek };
    });
    check("A ramp jump: kart goes airborne off the hay ramp", jump.airborne && jump.maxY > 1.5, JSON.stringify(jump));
    check("A ramp jump: flight passes over the creek + lands on DRY ground past it", jump.landedDry && jump.clearedCreek, JSON.stringify(jump));

    // ---- 6) CRITTERS: chicken/goat contact spin + train gates/spin + cows off-road ----
    const crit = await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; K.resetChickens(); K.resetCows();
      const R = {};
      const p = K.G.players.local; const clr = () => { p.spinT = 0; p.starT = 0; p.bullT = 0; };
      // chicken (index 0) contact spin: force it active mid-road + park the kart on it
      function spinTest(idx) { const ch = K.chickens[idx]; ch.active = true; ch.off = 0; ch.x = ch.ax; ch.z = ch.az; ch.y = K.sampleHeight(ch.x, ch.z);
        clr(); p.pos.x = ch.x; p.pos.z = ch.z; p.v.x = 4; p.v.z = 0; p.y = ch.y; p.airborne = false; K.advanceChickens(1 / 60); return { kind: ch.kind, spin: p.spinT }; }
      R.chick = spinTest(0);
      R.goat = spinTest(1);
      R.chick3 = spinTest(2);
      // TRAIN: gates lower on approach, a car hit spins, gates rise after
      const cr = K.trainCrossings[0]; const st = K.TRAIN_GROUP.userData.trains[0].state, L = st.L;
      // find loop-distance where the NOSE is right at the crossing
      let hd = 0, hbd = 1e18; for (let d = 0; d < L; d += 1) { const s = st.at(d); const dd = Math.hypot(s.x - cr.cx, s.z - cr.cz); if (dd < hbd) { hbd = dd; hd = d; } }
      // (a) approaching: put the nose ~2.0s of travel BEFORE the crossing -> gates should lower
      st.head = ((hd - K.TRAIN_GROUP.userData.trains[0].speed * 2.0) % L + L) % L;
      for (let i = 0; i < 30; i++) K.updateTrainCrossings(1 / 60);
      R.gateLowersApproach = cr.lowered && cr.gateAng > 0.5;
      // (b) contact spin: nose AT the crossing (a car occupies it), park the kart on the nearest car
      st.head = hd;
      let carPos = null; for (let k = 0; k < st.carOffs.length; k++) { const s = st.at(((st.head - st.carOffs[k]) % L + L) % L); if (Math.hypot(s.x - cr.cx, s.z - cr.cz) < K.TRACK_WIDTH / 2 + 3) { carPos = s; break; } }
      if (carPos) { clr(); p.pos.x = carPos.x; p.pos.z = carPos.z; p.v.x = 0; p.v.z = 0; p.y = K.sampleHeight(carPos.x, carPos.z); p.airborne = false; K.updateTrainCrossings(1 / 60); }
      R.trainSpins = carPos ? p.spinT > 0 : false;
      // (c) gates rise after the train leaves (nose far away, animate)
      st.head = ((hd + L / 2) % L + L) % L;
      for (let i = 0; i < 120; i++) K.updateTrainCrossings(1 / 60);
      R.gateRisesAfter = !cr.lowered && cr.gateAng < 0.1;
      // COWS: advance 30s, assert none ever inside road half+COW_ROAD_PAD
      let minRoad = 1e9; for (let i = 0; i < 30 * 60; i++) { K.advanceCows(1 / 60); if (i % 20 === 0) for (const c of K.cows) { const d = K.nearestCenterInfo(c.x, c.z).dist; if (d < minRoad) minRoad = d; } }
      R.nCows = K.cows.length; R.minCowRoad = +minRoad.toFixed(1); R.cowPad = K.TRACK_WIDTH / 2 + 3.5;
      return R;
    });
    check("A critter: chicken crossing spins a kart on contact", crit.chick.kind === "chicken" && crit.chick.spin > 0, JSON.stringify(crit.chick));
    check("A critter: the goat crossing is kind 'goat' + spins a kart", crit.goat.kind === "goat" && crit.goat.spin > 0, JSON.stringify(crit.goat));
    check("A critter: 3rd (chicken) crossing spins too", crit.chick3.spin > 0, JSON.stringify(crit.chick3));
    check("A train: gates LOWER as the train approaches", crit.gateLowersApproach, JSON.stringify({ lowered: crit.gateLowersApproach }));
    check("A train: a car hit at the crossing spins the kart", crit.trainSpins, JSON.stringify({ spins: crit.trainSpins }));
    check("A train: gates RISE after the train leaves", crit.gateRisesAfter, JSON.stringify({ risen: crit.gateRisesAfter }));
    check("A cows: 6 cows, none ever inside road half+COW_ROAD_PAD over 30s", crit.nCows === 6 && crit.minCowRoad > crit.cowPad, JSON.stringify({ n: crit.nCows, minRoad: crit.minCowRoad, pad: crit.cowPad }));

    // ---- 7) DRIFT tiers on T1 / orchard / last sweeper ----
    const drift = await page.evaluate(() => {
      const K = window.__KART__;
      function nearest(px, pz) { const C = K.centerPts; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const dx = C[i].x - px, dz = C[i].z - pz, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } } return bi; }
      function driftCorner(px, pz) {
        K.forceRace(); K.G.phase = "racing";
        for (const id in K.G.players) { if (id !== "local" && K.G.players[id]) { if (K.removeKartView) K.removeKartView(id); delete K.G.players[id]; } }
        const p = K.G.players.local, bi = nearest(px, pz), t = K.tangents[bi];
        p.pos.x = K.centerPts[bi].x; p.pos.z = K.centerPts[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.pos.y = p.y;
        p.theta = Math.atan2(t.x, t.z); const spd = 26; p.v.x = t.x * spd; p.v.z = t.z * spd;
        p.vy = 0; p.airborne = false; p.spinT = 0; p.starT = 0; p.bullT = 0; p.boostT = 0; p.boostTier = 0;
        p.drift.active = false; p.drift.charge = 0; p.driftAngle = 0;
        p.lastSampleIdx = bi; p.progressS = K.arcS[bi]; p.prevProgressS = K.arcS[bi]; p.checkpoint = 0; p.wrongWayT = 0; p.finishDebounce = 999;
        let maxTier = 0; const C = K.centerPts, LOOK = 15;
        for (let i = 0; i < 220; i++) {
          const idx = p.lastSampleIdx; let ti = idx, acc = 0; while (acc < LOOK) { const j = (ti + 1) % C.length; acc += Math.hypot(C[j].x - C[ti].x, C[j].z - C[ti].z); ti = j; if (ti === idx) break; }
          const tx = C[ti].x - p.pos.x, tz = C[ti].z - p.pos.z; let dth = Math.atan2(tx, tz) - p.theta; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
          const steer = p.drift.active ? p.drift.dir : (dth > 0.015 ? 1 : (dth < -0.015 ? -1 : 0));
          K.stepKart(p, { steer, throttle: 1, brake: 0, drift: true }, 1 / 60); K.updateRaceProgress(p, 1 / 60);
          if (p.drift.active) { const tier = K.driftTier(p.drift.charge); if (tier > maxTier) maxTier = tier; }
        }
        return maxTier;
      }
      return { T1: driftCorner(42, 126), orchard: driftCorner(100, -98), last: driftCorner(-30, -20) };
    });
    const t2 = [drift.T1, drift.orchard, drift.last].filter((v) => v >= 2).length;
    check("A drift: T1 reaches a mini-turbo tier (>=1)", drift.T1 >= 1, "T1=" + drift.T1);
    check("A drift: tier>=2 sustained in >=2 of {T1, orchard, last sweeper}", t2 >= 2, JSON.stringify(drift) + " t2=" + t2);

    check("A 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ PASS B: drivability (3 bots, ~90s) + bot crosses the ford ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    const drive = await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.raceMode = "prix"; sessionStorage.removeItem("fk_cup_session");
      K.setupRoster(); K.placeAllAtGrid();
      let kept = 0; for (const id in K.G.players) { const p = K.G.players[id]; if (p && p.isBot) { if (kept < 3) kept++; else { if (K.removeKartView) K.removeKartView(id); delete K.G.players[id]; } } }
      K.G.lapsTotal = 20;
      const bots = []; for (const id in K.G.players) { const p = K.G.players[id]; if (p && p.isBot) bots.push({ id, p }); }
      const human = K.G.players.local;
      const dt = 1 / 60, STEPS = Math.round(90 / dt);
      const maxLap = {}, maxSlow = {}, nan = {}, minY = {}, fordCross = {};
      for (const { id, p } of bots) { maxLap[id] = 0; maxSlow[id] = 0; nan[id] = false; minY[id] = 1e9; fordCross[id] = false; }
      let slow = {}; for (const { id } of bots) slow[id] = 0;
      let humanMaxLap = 0, firstBad = null;
      for (let i = 0; i < STEPS; i++) {
        const hin = K.botInput(human); K.soloRaceTick(dt, hin);
        for (const { id, p } of bots) {
          if (p.lap > maxLap[id]) maxLap[id] = p.lap;
          const spd = Math.hypot(p.v.x, p.v.z); if (spd < 1.5) { slow[id]++; if (slow[id] > maxSlow[id]) maxSlow[id] = slow[id]; } else slow[id] = 0;
          if (isFinite(p.y) && p.y < minY[id]) minY[id] = p.y;
          if (p.pos.x > 190 && p.pos.x < 236 && p.pos.z > -100 && p.pos.z < -58) fordCross[id] = true;   // passed through the ford zone
          const bad = !isFinite(p.pos.x) || !isFinite(p.pos.z) || !isFinite(p.y) || p.y < -60;
          if (bad) { nan[id] = true; if (!firstBad) firstBad = { id, frame: i, y: p.y }; }
        }
        if (human.lap > humanMaxLap) humanMaxLap = human.lap;
      }
      return { nBots: bots.length, laps: bots.map(({ id }) => maxLap[id]), maxSlowSec: bots.map(({ id }) => +(maxSlow[id] / 60).toFixed(1)),
        nan: bots.some(({ id }) => nan[id]), minY: bots.map(({ id }) => +minY[id].toFixed(1)), firstBad,
        fordCrossed: bots.filter(({ id }) => fordCross[id]).length, humanMaxLap };
    });
    check("B drivability: exactly 3 bots", drive.nBots === 3, drive.nBots);
    check("B drivability: every bot completes >=1 lap in ~90s", drive.laps.every((l) => l >= 1), JSON.stringify(drive.laps));
    check("B drivability: no bot stuck (>5s at ~0 speed)", drive.maxSlowSec.every((s) => s <= 5), JSON.stringify(drive.maxSlowSec));
    check("B drivability: no NaN / fall-through", drive.nan === false, JSON.stringify({ minY: drive.minY, firstBad: drive.firstBad }));
    check("B ford: at least one bot drives through the ford zone (not trapped)", drive.fordCrossed >= 1, "crossed=" + drive.fordCrossed);
    check("B drivability: human autopilot also laps", drive.humanMaxLap >= 1, drive.humanMaxLap);
    check("B 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ PASS C: menu course-grid card + preview ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.MenuFlow), { timeout: 15000 });
    const menu = await page.evaluate(() => {
      try { window.MenuFlow._openCourseGrid("tt"); } catch (e) { return { err: String(e) }; }
      const card = document.querySelector('.mfCard[data-id="harvest-hollow"]');
      const cn = card && card.querySelector(".cn");
      let nonBlank = false;
      if (card) { const c = card.querySelector("canvas"); if (c) { const ctx = c.getContext("2d"); if (ctx) { const d = ctx.getImageData(0, 0, c.width, c.height).data; let nz = 0; for (let k = 0; k < d.length; k += 4) { if (d[k] || d[k + 1] || d[k + 2] || d[k + 3] < 255) { nz++; if (nz > 30) { nonBlank = true; break; } } } } } }
      return { hasCard: !!card, nameOk: !!(cn && /Harvest Hollow/i.test(cn.textContent || "")), nonBlank };
    });
    check("C menu: 'Harvest Hollow' card in the course grid", menu.hasCard && menu.nameOk, JSON.stringify(menu));
    check("C menu: track preview canvas renders non-blank", menu.nonBlank, JSON.stringify(menu));
    check("C 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ SCREENSHOTS ============
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));
    async function driveShot(name, targetS, speed, ms, prep) {
      await page.evaluate((s0, spd, prepStr) => {
        const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
        const C = K.centerPts, arcS = K.arcS, L = K.TRACK_LEN; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.abs(arcS[i] / L - s0); if (d < bd) { bd = d; bi = i; } }
        const p = K.G.players.local, t = K.tangents[bi]; p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.vy = 0; p.airborne = false;
        p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * spd; p.v.z = t.z * spd; p.lastSampleIdx = bi; p.spinT = 0;
        if (prepStr) { try { (new Function("K", prepStr))(K); } catch (e) {} }
        K._setKeys("w", true);
      }, targetS, speed, prep || "");
      await new Promise((r) => setTimeout(r, ms));
      await page.evaluate(() => window.__KART__._setKeys("w", false));
      await page.screenshot({ path: path.join(SHOTS, name) });
    }
    await driveShot("fk_harvest_start.png", 0.0, 12, 900);
    // pasture: a cow pasture on the left + chicken #1 mid-crossing just ahead (slow so it stays in frame)
    await driveShot("fk_harvest_pasture.png", 0.155, 9, 850, "K.resetCows(); K.resetChickens(); var ch=K.chickens[0]; ch.active=true; ch.dir=1; ch.off=-2; ch.x=ch.ax+ch.nx*ch.off; ch.z=ch.az+ch.nz*ch.off; ch.y=K.sampleHeight(ch.x,ch.z);");
    // train: settle the camera on the approach, THEN freeze the train ON the nearest crossing with gates
    // DOWN just before the shot (the live rAF loop keeps advancing a moving train past the crossing).
    await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
      const C = K.centerPts, arcS = K.arcS, L = K.TRACK_LEN; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.abs(arcS[i] / L - 0.175); if (d < bd) { bd = d; bi = i; } }
      const p = K.G.players.local, t = K.tangents[bi]; p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.vy = 0; p.airborne = false;
      p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * 8; p.v.z = t.z * 8; p.lastSampleIdx = bi; p.spinT = 0; K._setKeys("w", true);
    });
    await new Promise((r) => setTimeout(r, 750));
    await page.evaluate(() => window.__KART__._setKeys("w", false));
    await page.evaluate(() => {
      const K = window.__KART__; const lp0 = K.G.players.local, kp = lp0.pos;
      const f = { x: Math.sin(lp0.theta), z: Math.cos(lp0.theta) };   // stage the nearest crossing AHEAD of the kart (in view)
      let best = null, bd = 1e18; for (const c of K.trainCrossings) { const dx = c.cx - kp.x, dz = c.cz - kp.z; if (dx * f.x + dz * f.z < 2) continue; const d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = c; } }
      if (!best) for (const c of K.trainCrossings) { const d = Math.hypot(c.cx - kp.x, c.cz - kp.z); if (d < bd) { bd = d; best = c; } }
      if (best) { const tr = K.TRAIN_GROUP.userData.trains[0], st = tr.state, L = st.L; let hd = 0, hb = 1e18;
        for (let dd = 0; dd < L; dd += 1) { const s = st.at(dd); const e = Math.hypot(s.x - best.cx, s.z - best.cz); if (e < hb) { hb = e; hd = dd; } }
        st.head = (hd + (st.carOffs[1] || 4)) % L; tr.speed = 0;   // a boxcar sits on the crossing
        K.TRAIN_GROUP.userData.update(0);                          // seat the train mesh at the staged head
        K.TRAIN_GROUP.userData.update = () => {};                  // FREEZE: stop the rAF loop advancing it (the
        // real advance speed is a closure-local copy — no-op'ing update is the only way to hold it for the shot)
        for (let i = 0; i < 60; i++) K.updateTrainCrossings(1 / 60);
        const lp = K.G.players.local; lp.spinT = 0; lp.starT = 0; lp.bullT = 0;
      }
    });
    await page.screenshot({ path: path.join(SHOTS, "fk_harvest_train.png") });
    await driveShot("fk_harvest_ford.png", 0.545, 30, 560);   // airborne over the creek
    await driveShot("fk_harvest_windmill.png", 0.805, 15, 950);
    await driveShot("fk_harvest_barn.png", 0.875, 15, 950);
    check("SHOT 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ============ PASS D: mobile smoke ============
  {
    const page = await newPage(true);
    await page.goto(BASE + "/farmkart.html?track=" + ID, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await page.evaluate(() => { const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; K._setKeys("w", true); });
    await new Promise((r) => setTimeout(r, 1800));
    await page.screenshot({ path: path.join(SHOTS, "fk_harvest_mobile.png") });
    const mob = await page.evaluate(() => ({ body: document.body.classList.contains("mobile"), waters: window.__KART__.WATER_GROUP.children.length }));
    check("D mobile: body.mobile + water present", mob.body && mob.waters === 2, JSON.stringify(mob));
    check("D mobile 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}
  const pass = CHECKS.filter((c) => c.pass).length;
  console.log(`harvest-hollow verify: ${pass}/${CHECKS.length} pass`);
  for (const c of CHECKS) console.log(`  ${c.pass ? "OK" : "FAIL"}  ${c.name}${c.detail !== "" ? " — " + c.detail : ""}`);
  if (errorsAll.length) { console.log("pageerrors:"); errorsAll.forEach((e) => console.log("  ", e)); }
  process.exit(CHECKS.every((c) => c.pass) && errorsAll.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
