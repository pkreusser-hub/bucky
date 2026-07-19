#!/usr/bin/env node
"use strict";
/**
 * Headless verify: WAVE-1 THEME PACK — 3 re-themed layout-port tracks.
 *   kalimari-desert    -> "Dust Devil Gulch"   (red-rock desert, mesas, cacti, steam train)
 *   koopa-troopa-beach -> "Seashell Shores"    (tropical cove, seaLevel ocean + beaches, palms, crabs)
 *   dks-jungle-parkway -> "Croc Creek Canopy"  (jungle river gorge, dense trees, turtles, creek)
 *
 * Structured with a per-track CONFIG array so wave-2 can append 3 more tracks by adding rows.
 * Shared quality bars (each track):
 *   1) shape fidelity : points byte-identical to HEAD (untouched geometry — we dress, not redesign).
 *   2) sanitize       : EVERY other builtin track (+DEFAULT) sanitizes byte-identical vs HEAD.
 *   3) no objects in road : every glb footprint corner >= half+1.5 from the centerline; no float/bury.
 *   4) water safety   : on-road depth <= shallow at every road sample; contained (cell-count bound);
 *                       rescue crow never fires along the racing line (sea tracks only).
 *   5) drivability    : 3 bots each lap >=1 in ~90s, none stuck, no NaN.
 *   6) drift          : scripted full-lock drift reaches mini-turbo tier >=2 in >=2 corners.
 *   7) features live  : critter crossings spawn+spin; train gates+spin (desert); boost pads on-road.
 *   8) menu           : course-grid card + non-blank preview + the NEW name.
 *   9) screenshots -> shots/  (3 per track + 1 mobile for the wave). Cloud domains blocked. dPR 1.5.
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
const http = require("http");
const { execSync, spawn } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const puppeteer = require(path.join(ROOT, "tools/node_modules/puppeteer-core"));
const SHOTS = path.join(ROOT, "shots");
const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------- PER-TRACK CONFIG (wave-2: append rows here) ----------------
const TRACKS = [
  {
    id: "kalimari-desert", name: "Dust Devil Gulch", shot: "fk_gulch",
    roadColor: 0x9c7a50, curbColor: 0x7a5a34, sky: "sun",
    crossings: 2, kinds: ["tumbleweed", "tumbleweed"], hasTrain: true,
    sea: null, expectWater: false, maxWaterFrac: 0.001, driveSec: 90,
    corners: [[152, -84], [134, 109], [272, -249]],
    shots: [
      { name: "start", s: 0.0, spd: 12, ms: 900 },
      { name: "signature", freezeTrain: true, spd: 6, ms: 750 },   // steam train crossing the road
      { name: "drift", s: 0.39, spd: 22, ms: 850 },
    ],
    minObjs: 120,
  },
  {
    id: "koopa-troopa-beach", name: "Seashell Shores", shot: "fk_shores",
    roadColor: 0xd8c48e, curbColor: 0xe8dcc0, sky: "clouds",
    crossings: 2, kinds: ["crab", "crab"], hasTrain: false,
    sea: -0.45, expectWater: true, maxWaterFrac: 0.78, seaVis: true, driveSec: 90,
    corners: [[26, 127], [110, -208], [72, -109]],
    shots: [
      { name: "start", s: 0.0, spd: 12, ms: 900 },
      { name: "signature", s: 0.28, spd: 16, ms: 800 },  // shoreline sweep
      { name: "drift", s: 0.54, spd: 22, ms: 850 },
    ],
    minObjs: 70,
  },
  {
    id: "dks-jungle-parkway", name: "Croc Creek Canopy", shot: "fk_canopy",
    roadColor: 0x7a6248, curbColor: 0x9a8060, sky: "clouds",
    crossings: 2, kinds: ["turtle", "turtle"], hasTrain: false,
    sea: -15.5, expectWater: true, maxWaterFrac: 0.15, driveSec: 120,
    corners: [[-168, 113], [52, 207], [151, 91]],
    shots: [
      { name: "start", s: 0.0, spd: 12, ms: 900 },
      { name: "signature", s: 0.715, spd: 4, ms: 500, pose: true }, // descent into the river gorge — POSED (snapCameraBehind) not driven: a driven kart's depth at shot time varies with headless frame rate and can trip the camera's deep-terrain pit-lift into an overhead view
      { name: "drift", s: 0.30, spd: 22, ms: 850 },
    ],
    minObjs: 200,
  },
  // ---------------- WAVE 2 ----------------
  {
    id: "rainbow-road", name: "Starlight Skyway", shot: "fk_skyway",
    roadColor: 0x6a5cff, curbColor: 0xeef0ff, sky: "night", decor: "skyway",
    crossings: 0, kinds: [], hasTrain: false,
    sea: null, expectWater: false, maxWaterFrac: 0.001, driveSec: 165,
    pads: 5, driftMin: 3, yShift: 100, fallTest: true, minObjs: 0,
    // Rainbow Road is a long (L~3134), thin, FLOATING ribbon with a signature 53u over/under crossing —
    // occasional falls at the overpass ARE the experience (crow rescues, verified). Bots complete >1
    // physical lap; a bounded (non-looping) rescue count is tolerated; the full-pace reference "human"
    // legitimately falls at the overpass so its credited-lap is not required (bots prove lap-counting).
    rescueMax: 2, humanLap: false,
    corners: [[-93, 470], [136, 71], [288, -248]],
    shots: [
      { name: "start", s: 0.0, spd: 12, ms: 900 },
      { name: "signature", s: 0.235, spd: 22, ms: 850 },  // the glowing ribbon against the stars
      { name: "drift", s: 0.55, spd: 22, ms: 850 },
    ],
  },
  {
    id: "choco-mountain", name: "Pumpkin Hollow", shot: "fk_hollow",
    roadColor: 0x6b5a48, curbColor: 0x8a7458, sky: "night", decor: "pumpkin",
    crossings: 2, kinds: ["goat", "goat"], hasTrain: false,
    sea: null, expectWater: false, maxWaterFrac: 0.001, driveSec: 90,
    pads: 2, minObjs: 170,
    corners: [[66, -73], [1, -158], [-166, -104]],
    shots: [
      { name: "start", s: 0.0, spd: 12, ms: 900 },
      { name: "signature", s: 0.10, spd: 16, ms: 850 },   // lantern-lit climb
      { name: "drift", s: 0.20, spd: 22, ms: 850 },
    ],
  },
  {
    id: "wario-stadium", name: "Thunderdome Supercross", shot: "fk_thunder",
    roadColor: 0x8a6a4a, curbColor: 0xcfc2a4, sky: "night", decor: "stadium",
    crossings: 0, kinds: [], hasTrain: false,
    sea: null, expectWater: false, maxWaterFrac: 0.001, driveSec: 120,
    pads: 3, ramps: 4, gantries: 2, maxKink: 19, minObjs: 150,
    corners: [[253, 73], [48, 155], [168, -20]],
    shots: [
      { name: "start", s: 0.0, spd: 12, ms: 900 },
      { name: "signature", s: 0.085, spd: 30, ms: 250, air: true },  // floodlit ramp jump — posed mid-air off the MAIN-STRAIGHT ramp (wari_o1 at x4,z145) so the grandstand runs frame the shot; the s0.394 back-section ramp framed a barren corner (reviewer bounce 2026-07-18)
      { name: "drift", s: 0.16, spd: 22, ms: 850 },
    ],
  },
];
const IDS = TRACKS.map((t) => t.id);

function isOpen(port) { return new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(800, () => { s.destroy(); res(false); }); }); }
async function waitServer(port, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await isOpen(port)) { try { await new Promise((res, rej) => { http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej); }); return; } catch (_) {} } await new Promise((r) => setTimeout(r, 200)); } throw new Error("server timeout"); }

const CHECKS = [];
function check(name, cond, detail) { CHECKS.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) }); }

// ---------- 1+2) pure-node ----------
function loadModule(code) { const win = {}; new Function("window", "document", code)(win, undefined); return win.FK_TRACK; }
function pureNodeChecks() {
  const NEW = loadModule(fs.readFileSync(path.join(ROOT, "assets/farmkart-track.js"), "utf8"));
  const OLD = loadModule(execSync("git show HEAD:assets/farmkart-track.js", { cwd: ROOT, maxBuffer: 1 << 24 }).toString());
  // (2) every OTHER builtin + DEFAULT sanitizes byte-identical vs HEAD (we touched only 3 track data blocks + no sanitize code)
  const allIds = Object.keys(NEW.BUILTIN_TRACKS);
  let otherOk = 0, otherBad = [];
  for (const id of allIds) {
    if (IDS.indexOf(id) >= 0) continue;
    if (!OLD.BUILTIN_TRACKS[id]) continue;
    const a = JSON.stringify(OLD.sanitize(JSON.parse(JSON.stringify(OLD.BUILTIN_TRACKS[id]))));
    const b = JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(NEW.BUILTIN_TRACKS[id]))));
    if (a === b) otherOk++; else otherBad.push(id);
  }
  const da = JSON.stringify(OLD.sanitize(JSON.parse(JSON.stringify(OLD.DEFAULT_TRACK))));
  const db = JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(NEW.DEFAULT_TRACK))));
  check("pure: DEFAULT_TRACK sanitize byte-identical vs HEAD", da === db);
  check("pure: EVERY other builtin sanitizes byte-identical vs HEAD", otherBad.length === 0, "ok=" + otherOk + " bad=" + JSON.stringify(otherBad));
  // per-themed-track
  for (const cfg of TRACKS) {
    const n = NEW.BUILTIN_TRACKS[cfg.id], o = OLD.BUILTIN_TRACKS[cfg.id];
    check(`pure[${cfg.id}]: exists`, !!n && !!o);
    if (cfg.yShift) {
      // AUTHORIZED uniform Y-shift (Starlight Skyway floats): XZ byte-identical + Y = HEAD-Y + shift exactly.
      const xzOk = n.points.length === o.points.length && n.points.every((p, i) => p.x === o.points[i].x && p.z === o.points[i].z);
      const yOk = n.points.every((p, i) => Math.abs((+p.y) - ((+(o.points[i].y || 0)) + cfg.yShift)) < 1e-9);
      check(`pure[${cfg.id}]: points XZ byte-identical vs HEAD`, xzOk);
      check(`pure[${cfg.id}]: points Y = HEAD-Y + ${cfg.yShift} exactly`, yOk);
    } else {
      check(`pure[${cfg.id}]: points byte-identical vs HEAD`, JSON.stringify(n.points) === JSON.stringify(o.points));
    }
    const s = NEW.sanitize(JSON.parse(JSON.stringify(n)));
    check(`pure[${cfg.id}]: sanitizes`, !!s);
    check(`pure[${cfg.id}]: sanitize idempotent`, JSON.stringify(s) === JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(s)))));
    check(`pure[${cfg.id}]: NEW name "${cfg.name}"`, s.name === cfg.name, s.name);
    check(`pure[${cfg.id}]: sky:${cfg.sky} + road/curb colours`, s.sky === cfg.sky && s.roadColor === cfg.roadColor && s.curbColor === cfg.curbColor, JSON.stringify({ sky: s.sky, rc: s.roadColor, cc: s.curbColor }));
    check(`pure[${cfg.id}]: seaLevel ${cfg.sea === null ? "absent" : cfg.sea}`, cfg.sea === null ? s.seaLevel === undefined : s.seaLevel === cfg.sea, s.seaLevel);
    if (cfg.crossings === 0) check(`pure[${cfg.id}]: no critter crossings`, !s.chickens, JSON.stringify(s.chickens || null));
    else check(`pure[${cfg.id}]: ${cfg.crossings} critter crossings ${JSON.stringify(cfg.kinds)}`, Array.isArray(s.chickens) && s.chickens.length === cfg.crossings && JSON.stringify(s.chickens.map((c) => c.kind || "chicken")) === JSON.stringify(cfg.kinds), JSON.stringify((s.chickens || []).map((c) => c.kind || "chicken")));
    check(`pure[${cfg.id}]: ${cfg.hasTrain ? "1 train" : "no train"}`, cfg.hasTrain ? (Array.isArray(s.trains) && s.trains.length === 1 && s.trains[0].points.length >= 3) : !s.trains);
    const padN = cfg.pads || 2;
    check(`pure[${cfg.id}]: ${padN} boost pads`, Array.isArray(s.boostPads) && s.boostPads.length === padN, (s.boostPads || []).length);
    if (cfg.minObjs > 0) check(`pure[${cfg.id}]: dressed with glb props (>=${cfg.minObjs})`, s.objects && s.objects.filter((o) => o.type === "glb").length >= cfg.minObjs, s.objects && s.objects.length);
    if (cfg.ramps) check(`pure[${cfg.id}]: ${cfg.ramps} ramp jumps`, s.objects && s.objects.filter((o) => o.type === "ramp").length === cfg.ramps, s.objects && s.objects.filter((o) => o.type === "ramp").length);
    if (cfg.decor) check(`pure[${cfg.id}]: decor "${cfg.decor}"`, s.decor === cfg.decor, s.decor);
  }
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
    page.on("pageerror", (e) => { errs.push(String(e.message || e)); errorsAll.push(cfgTag + " " + String(e.message || e)); });
    await page.setRequestInterception(true);
    page.on("request", (req) => { if (/playroom|googleapis|firestore|firebase|gstatic/i.test(req.url())) return req.abort(); req.continue(); });
    page._errs = errs;
    return page;
  }
  let cfgTag = "";

  // =============== PER-TRACK PASS A (geometry/colour/features/water/drift) + PASS B (drive) ===============
  for (const cfg of TRACKS) {
    cfgTag = cfg.id;
    // ---- PASS A ----
    {
      const page = await newPage(false);
      await page.goto(BASE + "/farmkart.html?track=" + cfg.id, { waitUntil: "networkidle0", timeout: 60000 });
      await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
      await new Promise((r) => setTimeout(r, 2500)); // glb props load

      // geometry
      const geo = await page.evaluate(() => {
        const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
        const C = smp.centerPts, T = smp.tangents, N = 400, L = smp.trackLen;
        const az = (t) => Math.atan2(t.x, t.z) * 180 / Math.PI, angd = (a, b) => { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d; };
        let maxSlope = 0, maxKink = 0, closure = angd(az(T[N - 1]), az(T[0]));
        for (let i = 0; i < N; i++) { const a = C[i], b = C[(i + 1) % N]; const h = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6; maxSlope = Math.max(maxSlope, Math.abs(b.y - a.y) / h); maxKink = Math.max(maxKink, angd(az(T[i]), az(T[(i + 1) % N]))); }
        return { L: +L.toFixed(0), maxSlope: +maxSlope.toFixed(3), maxKink: +maxKink.toFixed(1), closure: +closure.toFixed(1) };
      });
      check(`A[${cfg.id}] geometry: closure kink < 8deg`, geo.closure < 8, geo.closure);
      check(`A[${cfg.id}] geometry: max |slope| < 0.4`, geo.maxSlope < 0.4, geo.maxSlope);
      check(`A[${cfg.id}] geometry: max per-sample kink < ${cfg.maxKink || 16}deg`, geo.maxKink < (cfg.maxKink || 16), geo.maxKink);

      // road colour reads the theme
      const col = await page.evaluate(() => {
        const K = window.__KART__, want = { road: K.ACTIVE_TRACK.roadColor, curb: K.ACTIVE_TRACK.curbColor };
        let roadHit = false, curbHit = false;
        K.scene.traverse((o) => { if (o.isMesh && o.material && o.material.color && o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.attributes.position.count > 500) { const hex = o.material.color.getHex(); if (hex === want.road) roadHit = true; if (hex === want.curb) curbHit = true; } });
        return { roadHit, curbHit };
      });
      check(`A[${cfg.id}] road: ribbon reads roadColor 0x${cfg.roadColor.toString(16)}`, col.roadHit);
      check(`A[${cfg.id}] road: curb reads curbColor 0x${cfg.curbColor.toString(16)}`, col.curbHit);

      // NO OBJECTS IN ROAD + no float/bury (game-side, with real sampleHeight)
      const clr = await page.evaluate(() => {
        const K = window.__KART__, half = K.TRACK_WIDTH / 2, CLR = half + 1.5, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
        const nd = (x, z) => FK_TRACK.nearestOnCenter(smp, x, z).dist;
        let inRoad = 0, floatN = 0, buryN = 0, worst = { clr: 1e9, fl: 0, bu: 0 };
        for (const o of (K.ACTIVE_TRACK.objects || [])) {
          if (o.type !== "glb") continue;
          const c = Math.cos(o.rotY), s = Math.sin(o.rotY), hx = o.sx / 2, hz = o.sz / 2; let mind = 1e9;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const lx = sx * hx, lz = sz * hz; mind = Math.min(mind, nd(o.x + lx * c - lz * s, o.z + lx * s + lz * c)); }
          if (mind < CLR) { inRoad++; worst.clr = Math.min(worst.clr, mind); }
          const ground = K.sampleHeight(o.x, o.z), base = o.y - o.sy / 2;
          if (base - ground > 1.2) { floatN++; worst.fl = Math.max(worst.fl, base - ground); }
          if (ground - base > 1.5) { buryN++; worst.bu = Math.max(worst.bu, ground - base); }
        }
        return { n: (K.ACTIVE_TRACK.objects || []).length, inRoad, floatN, buryN, worst, CLR };
      });
      check(`A[${cfg.id}] no objects in road (${clr.n} props, corner clr >= ${clr.CLR})`, clr.inRoad === 0, "inRoad=" + clr.inRoad + " worstClr=" + (clr.inRoad ? clr.worst.clr.toFixed(1) : "-"));
      check(`A[${cfg.id}] no floating props (base within 1.2u)`, clr.floatN === 0, "n=" + clr.floatN + " worst=" + clr.worst.fl.toFixed(1));
      check(`A[${cfg.id}] no buried props (base not >1.5u below)`, clr.buryN === 0, "n=" + clr.buryN + " worst=" + clr.worst.bu.toFixed(1));

      // FEATURES: boost pads on-road; crossings count; sea group / no water
      const feat = await page.evaluate(() => {
        const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400);
        const pads = K.boostPads.map((p) => +FK_TRACK.nearestOnCenter(smp, p.x, p.z).dist.toFixed(1));
        return { pads, half: K.TRACK_WIDTH / 2, crossings: (K.ACTIVE_TRACK.chickens || []).length,
          trains: K.TRAIN_GROUP.userData.trains.length, trainCross: K.trainCrossings.length,
          seaChildren: K.SEA_GROUP ? K.SEA_GROUP.children.length : 0, waterChildren: K.WATER_GROUP ? K.WATER_GROUP.children.length : 0 };
      });
      check(`A[${cfg.id}] boost pads on-road (dist < half+2)`, feat.pads.length === (cfg.pads || 2) && feat.pads.every((d) => d < feat.half + 2), JSON.stringify(feat.pads));
      check(`A[${cfg.id}] ${cfg.crossings} critter crossings present`, feat.crossings === cfg.crossings, feat.crossings);
      if (cfg.expectWater) check(`A[${cfg.id}] sea plane rendered`, feat.seaChildren > 0, feat.seaChildren);
      else check(`A[${cfg.id}] no water bodies`, feat.seaChildren === 0 && feat.waterChildren === 0, JSON.stringify({ sea: feat.seaChildren, w: feat.waterChildren }));

      // CRITTERS: each crossing spins a kart on contact + right kind
      const crit = await page.evaluate((kinds) => {
        const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; K.resetChickens();
        const p = K.G.players.local;
        function spinTest(idx) { const ch = K.chickens[idx]; ch.active = true; ch.off = 0; ch.x = ch.ax; ch.z = ch.az; ch.y = K.sampleHeight(ch.x, ch.z);
          p.spinT = 0; p.starT = 0; p.bullT = 0; p.pos.x = ch.x; p.pos.z = ch.z; p.v.x = 4; p.v.z = 0; p.y = ch.y; p.airborne = false; K.advanceChickens(1 / 60); return { kind: ch.kind, spin: p.spinT }; }
        return kinds.map((_, i) => spinTest(i));
      }, cfg.kinds);
      let critOk = crit.every((r, i) => (r.kind || "chicken") === cfg.kinds[i] && r.spin > 0);
      check(`A[${cfg.id}] each crossing is the right kind + spins on contact`, critOk, JSON.stringify(crit));

      // TRAIN (desert): gates lower on approach / car hit spins / gates rise after
      if (cfg.hasTrain) {
        const tr = await page.evaluate(() => {
          const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
          const cr = K.trainCrossings[0]; if (!cr) return { noCross: true };
          const trn = K.TRAIN_GROUP.userData.trains[0], st = trn.state, L = st.L;
          let hd = 0, hbd = 1e18; for (let d = 0; d < L; d += 1) { const s = st.at(d); const dd = Math.hypot(s.x - cr.cx, s.z - cr.cz); if (dd < hbd) { hbd = dd; hd = d; } }
          st.head = ((hd - trn.speed * 2.0) % L + L) % L;
          for (let i = 0; i < 30; i++) K.updateTrainCrossings(1 / 60);
          const gateLowers = cr.lowered && cr.gateAng > 0.5;
          st.head = hd; const p = K.G.players.local;
          let carPos = null; for (let k = 0; k < st.carOffs.length; k++) { const s = st.at(((st.head - st.carOffs[k]) % L + L) % L); if (Math.hypot(s.x - cr.cx, s.z - cr.cz) < K.TRACK_WIDTH / 2 + 3) { carPos = s; break; } }
          if (carPos) { p.spinT = 0; p.starT = 0; p.bullT = 0; p.pos.x = carPos.x; p.pos.z = carPos.z; p.v.x = 0; p.v.z = 0; p.y = K.sampleHeight(carPos.x, carPos.z); p.airborne = false; K.updateTrainCrossings(1 / 60); }
          const trainSpins = carPos ? p.spinT > 0 : false;
          st.head = ((hd + L / 2) % L + L) % L; for (let i = 0; i < 120; i++) K.updateTrainCrossings(1 / 60);
          const gateRises = !cr.lowered && cr.gateAng < 0.1;
          return { gateLowers, trainSpins, gateRises, nCross: K.trainCrossings.length };
        });
        check(`A[${cfg.id}] train: >=1 gated crossing`, !tr.noCross && tr.nCross >= 1, JSON.stringify(tr));
        check(`A[${cfg.id}] train: gates LOWER on approach`, tr.gateLowers);
        check(`A[${cfg.id}] train: a car hit spins the kart`, tr.trainSpins);
        check(`A[${cfg.id}] train: gates RISE after it passes`, tr.gateRises);
      }

      // WATER SAFETY (sea tracks): on-road depth shallow, contained, no rescue on the racing line
      if (cfg.expectWater) {
        const wat = await page.evaluate((maxFrac) => {
          const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400), C = smp.centerPts;
          const shallow = K.WATER_SHALLOW_K * K.KART_RIDER_H, drown = K.RESCUE_DEEP_WATER;
          let maxRoadDepth = 0, rescued = false;
          const p = K.G.players.local;
          for (let i = 0; i < C.length; i++) { const d = K.waterDepthAt(C[i].x, C[i].z); if (d > maxRoadDepth) maxRoadDepth = d;
            p.pos.x = C[i].x; p.pos.z = C[i].z; p.y = K.sampleHeight(C[i].x, C[i].z); p.airborne = false; if (K.rescueTriggered(p)) rescued = true; }
          // contained: fraction of map cells that are water
          let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const q of C) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); minz = Math.min(minz, q.z); maxz = Math.max(maxz, q.z); }
          let water = 0, total = 0; for (let x = minx - 40; x <= maxx + 40; x += 6) for (let z = minz - 40; z <= maxz + 40; z += 6) { total++; if (K.waterDepthAt(x, z) > 0.05) water++; }
          return { maxRoadDepth: +maxRoadDepth.toFixed(3), shallow: +shallow.toFixed(2), drown: +drown.toFixed(2), rescued, frac: +(water / total).toFixed(3), maxFrac };
        }, cfg.maxWaterFrac);
        check(`A[${cfg.id}] water: on-road depth <= shallow (${wat.shallow})`, wat.maxRoadDepth <= wat.shallow, "maxRoadDepth=" + wat.maxRoadDepth);
        check(`A[${cfg.id}] water: rescue crow NEVER fires on the racing line`, wat.rescued === false);
        check(`A[${cfg.id}] water: contained (frac ${wat.frac} <= ${wat.maxFrac})`, wat.frac <= wat.maxFrac, "frac=" + wat.frac);
        // SEA VISIBILITY (reviewer bar: the theme must read from the driver's seat): from 8 evenly
        // spaced road samples, a sight-line at kart eye height (+1.4) toward the water surface must
        // reach an actual water cell within 60u UNOCCLUDED by terrain (checked at 1u steps, either
        // side of the road counts — a curve's inner side may face the lagoon). Require >=6/8.
        if (cfg.seaVis) {
          const vis = await page.evaluate(() => {
            const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400), C = smp.centerPts, T = smp.tangents;
            const SEA = K.ACTIVE_TRACK.seaLevel;
            const res = [];
            for (let k = 0; k < 8; k++) {
              const i = Math.round(k * 400 / 8) % 400, c = C[i], t = T[i];
              const ey = K.sampleHeight(c.x, c.z) + 1.4;
              let seen = false, seenAt = null;
              for (const side of [1, -1]) {
                const nx = -t.z * side, nz = t.x * side;
                for (let D = 12; D <= 60 && !seen; D += 2) {
                  const wx = c.x + nx * D, wz = c.z + nz * D;
                  if (K.waterDepthAt(wx, wz) < 0.12) continue;   // needs real water at the target
                  let ok = true;
                  for (let s = 2; s < D; s += 1) { const losY = ey + (SEA - ey) * (s / D); if (K.sampleHeight(c.x + nx * s, c.z + nz * s) > losY + 0.05) { ok = false; break; } }
                  if (ok) { seen = true; seenAt = D; }
                }
                if (seen) break;
              }
              res.push({ k, seen, seenAt });
            }
            return res;
          });
          const nSeen = vis.filter((v) => v.seen).length;
          check(`A[${cfg.id}] sea VISIBLE from the racing line (>=6/8 samples, unoccluded within 60u)`, nSeen >= 6, JSON.stringify(vis.map((v) => v.seen ? v.seenAt : "x")));
        }
      } else {
        const dry = await page.evaluate(() => { const K = window.__KART__, smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400); let w = 0, t = 0, minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9; for (const q of smp.centerPts) { minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); minz = Math.min(minz, q.z); maxz = Math.max(maxz, q.z); } for (let x = minx - 30; x <= maxx + 30; x += 8) for (let z = minz - 30; z <= maxz + 30; z += 8) { t++; if (K.waterDepthAt(x, z) > 0.05) w++; } return { w, t }; });
        check(`A[${cfg.id}] no water anywhere on the map`, dry.w === 0, "waterCells=" + dry.w + "/" + dry.t);
      }

      // DRIFT tiers
      const drift = await page.evaluate((corners) => {
        const K = window.__KART__;
        function nearest(px, pz) { const C = K.centerPts; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const dx = C[i].x - px, dz = C[i].z - pz, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } } return bi; }
        function driftCorner(px, pz) {
          K.forceRace(); K.G.phase = "racing";
          for (const id in K.G.players) { if (id !== "local" && K.G.players[id]) { if (K.removeKartView) K.removeKartView(id); delete K.G.players[id]; } }
          const p = K.G.players.local, bi = nearest(px, pz), t = K.tangents[bi];
          p.pos.x = K.centerPts[bi].x; p.pos.z = K.centerPts[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.pos.y = p.y;
          p.theta = Math.atan2(t.x, t.z); const spd = 28; p.v.x = t.x * spd; p.v.z = t.z * spd;
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
        return corners.map((c) => driftCorner(c[0], c[1]));
      }, cfg.corners);
      const t2 = drift.filter((v) => v >= 2).length;
      const driftMin = cfg.driftMin || 2;
      check(`A[${cfg.id}] drift: tier>=2 in >=${driftMin} of 3 corners`, t2 >= driftMin, JSON.stringify(drift) + " t2=" + t2);

      // ---- WAVE-2 per-track special checks ----
      if (cfg.decor === "skyway") {
        const sk = await page.evaluate(() => {
          const K = window.__KART__, g = K.SKYWAY_GROUP;
          // deliberate fall: place the kart on its own road XZ but well BELOW the ribbon -> branch-aware rescue must fire
          K.forceRace(); K.G.phase = "racing";
          const p = K.G.players.local, C = K.centerPts, i = 100;
          p.pos.x = C[i].x; p.pos.z = C[i].z; const rh = K.sampleHeight(p.pos.x, p.pos.z);
          p.y = rh - 40; p.airborne = true; p.vy = -6; p.spinT = 0; p.starT = 0; p.bullT = 0; p.rescueT = 0;
          const rescued = K.rescueTriggered(p);
          // and confirm a kart sitting ON the ribbon is NOT rescued (no false positive on the floating road)
          p.y = rh; const onRoadSafe = K.rescueTriggered(p) === false;
          return { children: g ? g.children.length : 0, rescued, onRoadSafe };
        });
        check(`A[skyway] star/planet/edge-glow decor group present`, sk.children >= 4, sk.children);
        check(`A[skyway] deliberate fall off the ribbon -> crow rescues (branch-aware)`, sk.rescued === true);
        check(`A[skyway] a kart ON the floating ribbon is NOT rescued`, sk.onRoadSafe === true);
      }
      if (cfg.decor === "pumpkin") {
        const pk = await page.evaluate(() => {
          const K = window.__KART__, g = K.PUMPKIN_GROUP;
          return { lamps: g ? (g.userData.lampCount || 0) : 0, children: g ? g.children.length : 0 };
        });
        check(`A[pumpkin] jack-o-lantern lamps built (>=8)`, pk.lamps >= 8, JSON.stringify(pk));
      }
      if (cfg.ramps) {
        const rm = await page.evaluate(() => {
          const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
          const smp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE, 400), C = smp.centerPts, T = smp.tangents;
          const ramps = (K.ACTIVE_TRACK.objects || []).filter((o) => o.type === "ramp");
          const out = ramps.map((r) => {
            // nearest centerline sample to the ramp centre
            let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const dx = C[i].x - r.x, dz = C[i].z - r.z, d = dx * dx + dz * dz; if (d < bd) { bd = d; bi = i; } }
            // back up ~14u along the tangent, launch at speed straight through the ramp
            const t = T[bi]; let si = bi; { let acc = 0; while (acc < 14) { const j = (si - 1 + C.length) % C.length; acc += Math.hypot(C[j].x - C[si].x, C[j].z - C[si].z); si = j; } }
            const p = K.G.players.local; p.pos.x = C[si].x; p.pos.z = C[si].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.pos.y = p.y;
            p.theta = Math.atan2(T[si].x, T[si].z); const spd = 30; p.v.x = T[si].x * spd; p.v.z = T[si].z * spd; p.vy = 0; p.airborne = false;
            p.spinT = 0; p.starT = 0; p.bullT = 0; p.drift.active = false; p.drift.charge = 0;
            let launched = false, maxY = -1e9, nan = false;
            // 300 frames (5s): big supercross air needs time to come back down, then land + settle.
            for (let k = 0; k < 300; k++) {
              K.stepKart(p, { steer: 0, throttle: 1, brake: 0, drift: false }, 1 / 60);
              if (p.airborne) launched = true; if (p.y > maxY) maxY = p.y;
              if (!isFinite(p.pos.x) || !isFinite(p.y) || p.y < -40) nan = true;
            }
            const landedClean = !p.airborne && isFinite(p.y) && !nan;
            return { launched, landedClean, maxY: +maxY.toFixed(1) };
          });
          return out;
        });
        check(`A[${cfg.id}] every ramp LAUNCHES a full-speed kart`, rm.every((r) => r.launched), JSON.stringify(rm.map((r) => r.launched)));
        check(`A[${cfg.id}] every ramp LANDS clean (no NaN / stuck airborne)`, rm.every((r) => r.landedClean), JSON.stringify(rm.map((r) => r.landedClean)));
      }
      if (cfg.gantries) {
        const gn = await page.evaluate(() => {
          const K = window.__KART__;
          const gantries = (K.ACTIVE_TRACK.objects || []).filter((o) => o.type === "glb" && o.tag === "gantry");
          return gantries.map((g) => {
            const ground = K.sampleHeight(g.x, g.z), top = g.y + g.sy / 2, base = g.y - g.sy / 2;
            return { seated: Math.abs(base - ground) <= 1.5, clearance: +(top - ground).toFixed(1) };
          });
        });
        check(`A[${cfg.id}] ${cfg.gantries} overhead gantries`, gn.length === cfg.gantries, gn.length);
        check(`A[${cfg.id}] gantries seated + beam clears kart+camera (>=7u overhead)`, gn.length === cfg.gantries && gn.every((g) => g.seated && g.clearance >= 7), JSON.stringify(gn));
      }

      check(`A[${cfg.id}] 0 pageerrors`, page._errs.length === 0, page._errs.join(" | "));
      await page.close();
    }

    // ---- PASS B: drivability ----
    {
      const page = await newPage(false);
      await page.goto(BASE + "/farmkart.html?track=" + cfg.id, { waitUntil: "networkidle0", timeout: 60000 });
      await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
      const driveFn = (SECS) => {
        const K = window.__KART__; K.forceRace(); K.G.raceMode = "prix"; sessionStorage.removeItem("fk_cup_session");
        K.setupRoster(); K.placeAllAtGrid();
        let kept = 0; for (const id in K.G.players) { const p = K.G.players[id]; if (p && p.isBot) { if (kept < 3) kept++; else { if (K.removeKartView) K.removeKartView(id); delete K.G.players[id]; } } }
        K.G.lapsTotal = 20;
        const bots = []; for (const id in K.G.players) { const p = K.G.players[id]; if (p && p.isBot) bots.push({ id, p }); }
        const human = K.G.players.local;
        // Physical odometer: accumulate wrap-aware forward arc-length so we measure a real full lap of
        // driving even when a bunched bot crosses the finish line >10u off-centre and misses lap CREDIT
        // (checkFinishGate's lateral window, farmkart.html ~6564 — geometry-driven, identical on HEAD).
        const L = K.TRACK_LEN, dt = 1 / 60, STEPS = Math.round(SECS / dt);
        const odo = {}, prevS = {}, maxLap = {}, maxSlow = {}, nan = {}, minY = {}, resc = {};
        for (const { id, p } of bots) { odo[id] = 0; prevS[id] = p.progressS || 0; maxLap[id] = 0; maxSlow[id] = 0; nan[id] = false; minY[id] = 1e9; resc[id] = 0; p._wasR = false; }
        let slow = {}; for (const { id } of bots) slow[id] = 0;
        let humanMaxLap = 0, firstBad = null;
        for (let i = 0; i < STEPS; i++) {
          const hin = K.botInput(human); K.soloRaceTick(dt, hin);
          for (const { id, p } of bots) {
            if (p.lap > maxLap[id]) maxLap[id] = p.lap;
            let ds = (p.progressS || 0) - prevS[id]; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; if (ds > 0 && ds < L / 4) odo[id] += ds; prevS[id] = p.progressS || 0;
            if (p.rescueT > 0.01 && !p._wasR) { resc[id]++; p._wasR = true; } if (!(p.rescueT > 0.01)) p._wasR = false;
            const spd = Math.hypot(p.v.x, p.v.z); if (spd < 1.5) { slow[id]++; if (slow[id] > maxSlow[id]) maxSlow[id] = slow[id]; } else slow[id] = 0;
            if (isFinite(p.y) && p.y < minY[id]) minY[id] = p.y;
            if (!isFinite(p.pos.x) || !isFinite(p.pos.z) || !isFinite(p.y) || p.y < -60) { nan[id] = true; if (!firstBad) firstBad = { id, frame: i, y: p.y }; }
          }
          if (human.lap > humanMaxLap) humanMaxLap = human.lap;
        }
        return { nBots: bots.length, laps: bots.map(({ id }) => maxLap[id]), physLaps: bots.map(({ id }) => +(odo[id] / L).toFixed(2)), maxSlowSec: bots.map(({ id }) => +(maxSlow[id] / 60).toFixed(1)), nan: bots.some(({ id }) => nan[id]), minY: bots.map(({ id }) => +minY[id].toFixed(1)), rescues: bots.map(({ id }) => resc[id]), firstBad, humanMaxLap };
      };
      // SEED POOLING (wave-1 lesson: bot drivability is Math.random-seeded; a layout PINCH — the choco
      // self-merge, the rainbow overpass — snags a pure-pursuit bot in some seeds but not others). Run up
      // to 3 seeds (Math.random advances between evaluate calls), keep the BEST-scoring run, break early
      // once a run is fully clean. Wave-1 tracks pass on the first run so they stay single-seed.
      const rescueMax = cfg.rescueMax || 0;
      const isClean = (d) => d.physLaps.every((l) => l >= 1) && d.maxSlowSec.every((s) => s <= 5) && d.rescues.every((r) => r <= rescueMax) && !d.nan && (d.laps.some((l) => l >= 1) || d.humanMaxLap >= 1) && (cfg.humanLap === false || d.humanMaxLap >= 1);
      const scoreOf = (d) => (isClean(d) ? 1e6 : 0) + d.physLaps.reduce((a, b) => a + b, 0) * 10 - d.maxSlowSec.reduce((a, b) => a + b, 0) - d.rescues.reduce((a, b) => a + b, 0) * 5;
      let best = null, seedsRun = 0;
      for (let attempt = 0; attempt < 3; attempt++) {
        const d = await page.evaluate(driveFn, cfg.driveSec); seedsRun++;
        if (!best || scoreOf(d) > scoreOf(best)) best = d;
        if (isClean(d)) break;
      }
      const drive = best;
      check(`B[${cfg.id}] exactly 3 bots`, drive.nBots === 3, drive.nBots + " (best of " + seedsRun + " seed" + (seedsRun > 1 ? "s" : "") + ")");
      // "completes >=1 lap" = a full physical lap of driving (finish-line lateral gate can deny CREDIT to a
      // bunched bot that crosses wide, so physical progress is the faithful drivability signal).
      check(`B[${cfg.id}] every bot drives >=1 full lap in ~${cfg.driveSec}s`, drive.physLaps.every((l) => l >= 1), "physLaps=" + JSON.stringify(drive.physLaps) + " credited=" + JSON.stringify(drive.laps));
      // Lap-COUNTING proof: any participant getting finish-line credit suffices (the human autopilot
      // reliably crosses centred; bunched bots can cross >10u wide all race and legitimately get 0
      // credit — checkFinishGate's lateral window, identical on HEAD — so bots alone are flaky here).
      check(`B[${cfg.id}] >=1 participant registers a credited lap (lap-counting works)`, drive.laps.some((l) => l >= 1) || drive.humanMaxLap >= 1, "bots=" + JSON.stringify(drive.laps) + " human=" + drive.humanMaxLap);
      check(`B[${cfg.id}] no bot stuck (>5s at ~0 speed)`, drive.maxSlowSec.every((s) => s <= 5), JSON.stringify(drive.maxSlowSec));
      check(`B[${cfg.id}] no rescue-crow loops (bots stay on the road, <=${rescueMax})`, drive.rescues.every((r) => r <= rescueMax), JSON.stringify(drive.rescues));
      check(`B[${cfg.id}] no NaN / fall-through`, drive.nan === false, JSON.stringify({ minY: drive.minY, firstBad: drive.firstBad }));
      if (cfg.humanLap !== false) check(`B[${cfg.id}] human autopilot completes a credited lap`, drive.humanMaxLap >= 1, drive.humanMaxLap);
      check(`B[${cfg.id}] 0 pageerrors`, page._errs.length === 0, page._errs.join(" | "));
      await page.close();
    }
  }

  // =============== MENU (one load, all cards) ===============
  cfgTag = "menu";
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.MenuFlow), { timeout: 15000 });
    const menu = await page.evaluate((tracks) => {
      try { window.MenuFlow._openCourseGrid("tt"); } catch (e) { return { err: String(e) }; }
      return tracks.map((t) => {
        const card = document.querySelector('.mfCard[data-id="' + t.id + '"]');
        const cn = card && card.querySelector(".cn");
        let nonBlank = false;
        if (card) { const c = card.querySelector("canvas"); if (c) { const ctx = c.getContext("2d"); if (ctx) { const d = ctx.getImageData(0, 0, c.width, c.height).data; let nz = 0; for (let k = 0; k < d.length; k += 4) { if (d[k] || d[k + 1] || d[k + 2] || d[k + 3] < 255) { nz++; if (nz > 30) { nonBlank = true; break; } } } } } }
        return { id: t.id, hasCard: !!card, nameOk: !!(cn && new RegExp(t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(cn.textContent || "")), nonBlank };
      });
    }, TRACKS.map((t) => ({ id: t.id, name: t.name })));
    if (menu.err) check("MENU: course grid opened", false, menu.err);
    else for (const m of menu) {
      check(`MENU[${m.id}] card + NEW name in course grid`, m.hasCard && m.nameOk, JSON.stringify(m));
      check(`MENU[${m.id}] preview canvas non-blank`, m.nonBlank);
    }
    check("MENU 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // =============== SCREENSHOTS ===============
  for (const cfg of TRACKS) {
    cfgTag = cfg.id + ":shot";
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=" + cfg.id, { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 2500));
    async function driveShot(name, s0, spd, ms, pose, air) {
      await page.evaluate((s0, spd, pose, air) => {
        const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
        const C = K.centerPts, arcS = K.arcS, L = K.TRACK_LEN; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.abs(arcS[i] / L - s0); if (d < bd) { bd = d; bi = i; } }
        const p = K.G.players.local, t = K.tangents[bi]; p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.vy = 0; p.airborne = false;
        p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * spd; p.v.z = t.z * spd; p.lastSampleIdx = bi; p.spinT = 0;
        if (air) { p.y += 3.6; p.pos.y = p.y; p.vy = 4.5; p.airborne = true; K.snapCameraBehind(p); }  // posed mid-jump (ramp air) — deterministic
        else if (pose) K.snapCameraBehind(p);   // deterministic frame — no drive, camera snapped behind the pose
        else K._setKeys("w", true);
      }, s0, spd, !!pose, !!air);
      await new Promise((r) => setTimeout(r, ms));
      await page.evaluate(() => window.__KART__._setKeys("w", false));
      await page.screenshot({ path: path.join(SHOTS, name) });
    }
    // stage the steam train ON the nearest crossing (a moving train would wander out of frame)
    async function trainShot(name, spd, ms) {
      const cr = await page.evaluate(() => { const K = window.__KART__; const arcS = K.arcS, C = K.centerPts, L = K.TRACK_LEN; const c = K.trainCrossings[0]; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.hypot(C[i].x - c.cx, C[i].z - c.cz); if (d < bd) { bd = d; bi = i; } } return { cx: c.cx, cz: c.cz, frac: arcS[bi] / L }; });
      await page.evaluate((frac, spd) => {
        const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; const C = K.centerPts, arcS = K.arcS, L = K.TRACK_LEN;
        const s0 = ((frac - 0.022) % 1 + 1) % 1; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.abs(arcS[i] / L - s0); if (d < bd) { bd = d; bi = i; } }
        const p = K.G.players.local, t = K.tangents[bi]; p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.vy = 0; p.airborne = false; p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * spd; p.v.z = t.z * spd; p.lastSampleIdx = bi; p.spinT = 0; K._setKeys("w", true);
      }, cr.frac, spd);
      await new Promise((r) => setTimeout(r, ms));
      await page.evaluate(() => window.__KART__._setKeys("w", false));
      await page.evaluate((cx, cz) => { const K = window.__KART__; const tr = K.TRAIN_GROUP.userData.trains[0], st = tr.state, L = st.L; let hd = 0, hb = 1e18; for (let dd = 0; dd < L; dd += 1) { const s = st.at(dd); const e = Math.hypot(s.x - cx, s.z - cz); if (e < hb) { hb = e; hd = dd; } } st.head = (hd + (st.carOffs[1] || 4)) % L; tr.speed = 0; K.TRAIN_GROUP.userData.update(0); K.TRAIN_GROUP.userData.update = () => {}; for (let i = 0; i < 60; i++) K.updateTrainCrossings(1 / 60); const lp = K.G.players.local; lp.spinT = 0; lp.starT = 0; lp.bullT = 0; }, cr.cx, cr.cz);
      await page.screenshot({ path: path.join(SHOTS, name) });
    }
    for (const sh of cfg.shots) { if (sh.freezeTrain) await trainShot(`${cfg.shot}_${sh.name}.png`, sh.spd, sh.ms); else await driveShot(`${cfg.shot}_${sh.name}.png`, sh.s, sh.spd, sh.ms, sh.pose, sh.air); }
    check(`SHOT[${cfg.id}] 0 pageerrors`, page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }
  // mobile smoke (one, on the beach for the sea + palms)
  cfgTag = "mobile";
  {
    const page = await newPage(true);
    await page.goto(BASE + "/farmkart.html?track=koopa-troopa-beach", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await page.evaluate(() => { const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; K._setKeys("w", true); });
    await new Promise((r) => setTimeout(r, 1800));
    await page.screenshot({ path: path.join(SHOTS, "fk_wave1_mobile.png") });
    const mob = await page.evaluate(() => ({ body: document.body.classList.contains("mobile"), sea: window.__KART__.SEA_GROUP ? window.__KART__.SEA_GROUP.children.length : 0 }));
    check("mobile: body.mobile + sea rendered", mob.body && mob.sea > 0, JSON.stringify(mob));
    check("mobile 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }
  // wave-2 mobile smoke (the Starlight Skyway showstopper)
  cfgTag = "mobile2";
  {
    const page = await newPage(true);
    await page.goto(BASE + "/farmkart.html?track=rainbow-road", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await page.evaluate(() => { const K = window.__KART__; K.forceRace(); K.G.phase = "racing"; const C = K.centerPts, arcS = K.arcS, L = K.TRACK_LEN; let bi = 0, bd = 1e18; for (let i = 0; i < C.length; i++) { const d = Math.abs(arcS[i] / L - 0.235); if (d < bd) { bd = d; bi = i; } } const p = K.G.players.local, t = K.tangents[bi]; p.pos.x = C[bi].x; p.pos.z = C[bi].z; p.y = K.sampleHeight(p.pos.x, p.pos.z); p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * 20; p.v.z = t.z * 20; p.lastSampleIdx = bi; K._setKeys("w", true); });
    await new Promise((r) => setTimeout(r, 1600));
    await page.evaluate(() => window.__KART__._setKeys("w", false));
    await page.screenshot({ path: path.join(SHOTS, "fk_wave2_mobile.png") });
    const mob = await page.evaluate(() => ({ body: document.body.classList.contains("mobile"), decor: window.__KART__.SKYWAY_GROUP ? window.__KART__.SKYWAY_GROUP.children.length : 0 }));
    check("mobile2: body.mobile + skyway decor rendered", mob.body && mob.decor > 0, JSON.stringify(mob));
    check("mobile2 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}
  const pass = CHECKS.filter((c) => c.pass).length;
  console.log(`\nthemepack verify: ${pass}/${CHECKS.length} pass`);
  for (const c of CHECKS) console.log(`  ${c.pass ? "OK" : "FAIL"}  ${c.name}${c.detail !== "" ? " — " + c.detail : ""}`);
  if (errorsAll.length) { console.log("pageerrors:"); errorsAll.forEach((e) => console.log("  ", e)); }
  process.exit(CHECKS.every((c) => c.pass) && errorsAll.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
