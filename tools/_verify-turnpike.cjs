#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Toad's Turnpike night-city environment (Farm Kart).
 *  1) pure-node: sanitize byte-identical vs HEAD for non-city tracks + theme passthrough.
 *  2) game boot ?track=toads-turnpike: night sky, CITY_GROUP w/ instanced children,
 *     no grass tufts, city ground/road colours, lane marks. 0 pageerrors.
 *  3) default (bare URL) boot: no city group, original colours, tufts present, day sky.
 *  4) drive check: forceRace, advance frames, kart finite, buildings clear of the road.
 *  5) screenshots -> shots/.
 * Cloud domains blocked throughout. Test @ deviceScaleFactor 1.5 (dPR canvas-crop class).
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
const PORT = 8871;
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
      try { await new Promise((res, rej) => { http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej); }); return; } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

// ---------- results plumbing ----------
const CHECKS = [];
function check(name, cond, detail) { CHECKS.push({ name, pass: !!cond, detail: detail || "" }); }

// ---------- 1) pure-node sanitize regression ----------
function loadModule(code) { const win = {}; const fn = new Function("window", "document", code); fn(win, undefined); return win.FK_TRACK; }
function pureNodeChecks() {
  const NEW = loadModule(fs.readFileSync(path.join(ROOT, "assets/farmkart-track.js"), "utf8"));
  const OLD = loadModule(execSync("git show HEAD:assets/farmkart-track.js", { cwd: ROOT, maxBuffer: 1 << 24 }).toString());
  for (const id of ["__default__", "wario-stadium", "royal-raceway", "rainbow-road"]) {
    const t = id === "__default__" ? NEW.DEFAULT_TRACK : NEW.BUILTIN_TRACKS[id];
    const a = JSON.stringify(OLD.sanitize(JSON.parse(JSON.stringify(t))));
    const b = JSON.stringify(NEW.sanitize(JSON.parse(JSON.stringify(t))));
    check("sanitize byte-identical: " + (t.name || id), a === b);
  }
  check("theme:'city' passes through", NEW.sanitize({ points: NEW.DEFAULT_TRACK.points, theme: "city" }).theme === "city");
  check("garbage theme dropped", NEW.sanitize({ points: NEW.DEFAULT_TRACK.points, theme: "jungle" }).theme === undefined);
  const ts = NEW.sanitize(NEW.BUILTIN_TRACKS["toads-turnpike"]);
  check("toads-turnpike sanitizes theme/sky/wallMargin/music",
    ts.theme === "city" && ts.sky === "night" && ts.wallMargin === 6 && ts.music === "turnpike",
    JSON.stringify({ theme: ts.theme, sky: ts.sky, wallMargin: ts.wallMargin, music: ts.music }));
  check("builders exported", typeof NEW.buildCityscape === "function" && typeof NEW.buildLaneMarks === "function");
  // ---- TRAFFIC (2026-07-17): sanitize passthrough + clamp + drop; toads-turnpike def; builder export ----
  const P = NEW.DEFAULT_TRACK.points;
  check("traffic valid {count,speed} passes through", (()=>{ const t = NEW.sanitize({ points:P, traffic:{ count:12, speed:9.5 } }).traffic; return t && t.count === 12 && t.speed === 9.5; })());
  check("traffic count clamps to 24", (()=>{ const t = NEW.sanitize({ points:P, traffic:{ count:99, speed:9 } }).traffic; return t && t.count === 24; })());
  check("traffic speed clamps to 40", (()=>{ const t = NEW.sanitize({ points:P, traffic:{ count:5, speed:999 } }).traffic; return t && t.speed === 40; })());
  check("traffic garbage (count 0) dropped", NEW.sanitize({ points:P, traffic:{ count:0, speed:9 } }).traffic === undefined);
  check("traffic garbage (speed 0) dropped", NEW.sanitize({ points:P, traffic:{ count:3, speed:0 } }).traffic === undefined);
  check("traffic non-object dropped", NEW.sanitize({ points:P, traffic:5 }).traffic === undefined);
  check("traffic absent omitted", NEW.sanitize({ points:P }).traffic === undefined);
  check("toads-turnpike def has traffic {12,speed}", (()=>{ const t = NEW.sanitize(NEW.BUILTIN_TRACKS["toads-turnpike"]).traffic; return t && t.count === 12 && t.speed >= 1 && t.speed <= 40; })());
  check("buildTraffic exported", typeof NEW.buildTraffic === "function");
  // ---- MP sync shape via source (the snapshot fn is hard to drive headlessly; source-grep is acceptable) ----
  const HTML = fs.readFileSync(path.join(ROOT, "farmkart.html"), "utf8");
  check("snapshot builder includes traffic heads", /traffic:\(\(TRAFFIC_GROUP\.userData\.vehicles\)/.test(HTML));
  check("guest adopts traffic heads", /if \(snap\.traffic\)[\s\S]{0,180}TRAFFIC_GROUP\.userData\.vehicles/.test(HTML));
}

// scene scan run inside the page
const PAGE_SCAN = function () {
  const K = window.__KART__;
  const out = { colors: [], groundVertR: null, groundHasMap: null, groundVerts: 0, hasTuftEmissive: false, cityInfo: null, cityRoles: {}, laneVerts: 0, sky: K.sky, theme: K.theme };
  let biggest = null, biggestN = -1;
  K.scene.traverse(function (o) {
    if (o.isMesh && !o.isInstancedMesh && o.material && o.material.color && !o.material.vertexColors) {
      out.colors.push(o.material.color.getHex());
    }
    if ((o.isMesh || o.isInstancedMesh) && o.material && o.material.emissive && o.material.emissive.getHex() === 0x2c3c1d) out.hasTuftEmissive = true;
    if (o.isMesh && !o.isInstancedMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.color) {
      const n = o.geometry.attributes.position.count;
      if (n > biggestN) { biggestN = n; biggest = o; }
    }
  });
  if (biggest) {
    out.groundVerts = biggestN;
    out.groundHasMap = !!biggest.material.map;
    out.groundVertR = biggest.geometry.attributes.color.getX(0);
  }
  const cg = K.CITY_GROUP;
  if (cg) {
    out.cityInfo = cg.userData.info;
    cg.traverse(function (o) { if (o.userData && o.userData.cityRole) out.cityRoles[o.userData.cityRole] = (out.cityRoles[o.userData.cityRole] || 0) + 1; });
    out.cityBuildings = cg.userData.buildings.length;
  }
  const lg = K.LANE_GROUP;
  if (lg) lg.traverse(function (o) { if (o.isMesh && o.geometry && o.geometry.attributes.position) out.laneVerts += o.geometry.attributes.position.count; });
  return out;
};

async function drive(page, ms) {
  await page.evaluate(() => { window.__KART__.forceRace(); window.__KART__._setKeys("w", true); });
  const chunks = Math.ceil(ms / 250);
  let minCamToBldg = 1e9;
  for (let i = 0; i < chunks; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const s = await page.evaluate(() => {
      const K = window.__KART__, p = K.G.players.local, cam = K.camera.position;
      let mind = 1e9;
      const bs = K.CITY_GROUP ? K.CITY_GROUP.userData.buildings : [];
      for (const b of bs) { const dx = cam.x - b.x, dz = cam.z - b.z; const d = Math.hypot(dx, dz); if (d < mind) mind = d; }
      return { px: p.pos.x, pz: p.pos.z, cx: cam.x, cy: cam.y, cz: cam.z, mind };
    });
    if (s.mind < minCamToBldg) minCamToBldg = s.mind;
  }
  const fin = await page.evaluate(() => {
    const K = window.__KART__, p = K.G.players.local, cam = K.camera.position, C = K.centerPts;
    // recompute nearest-road distance for every building center (clearance sanity)
    let worst = 1e9;
    const bs = K.CITY_GROUP ? K.CITY_GROUP.userData.buildings : [];
    for (const b of bs) {
      let bd = 1e18;
      for (let i = 0; i < C.length; i++) { const dx = b.x - C[i].x, dz = b.z - C[i].z; const d = dx * dx + dz * dz; if (d < bd) bd = d; }
      const dist = Math.sqrt(bd);
      if (dist < worst) worst = dist;
    }
    return { px: p.pos.x, pz: p.pos.z, cx: cam.x, cy: cam.y, cz: cam.z, worstBldgRoadDist: worst, nb: bs.length };
  });
  fin.minCamToBldg = minCamToBldg;
  return fin;
}

// deterministic BOOT-state check: rebuild traffic fresh in-page (fixed-seed, identical to the game's
// TRAFFIC_GROUP at boot) so we can assert the pristine spawn invariants even though the live group has
// already ticked many frames by the time we can inspect it.
async function trafficBootScan(page) {
  return page.evaluate(() => {
    const K = window.__KART__;
    const samp = FK_TRACK.resample(K.ACTIVE_TRACK, THREE);
    const L = samp.trackLen;
    const g = FK_TRACK.buildTraffic(K.ACTIVE_TRACK.traffic, samp, K.TRACK_WIDTH, THREE, { heightFn: (x, z) => K.sampleHeight(x, z) });
    const vs = g.userData.vehicles;
    let laneMax = 0, heightErr = 0, heightMax = -1e9, minDist = 1e9;
    const types = {};
    for (const v of vs) {
      laneMax = Math.max(laneMax, Math.abs(v.laneOff));
      const gh = K.sampleHeight(v.x, v.z);
      heightErr = Math.max(heightErr, Math.abs(v.group.position.y - v.wheelR - gh));
      heightMax = Math.max(heightMax, gh);
      minDist = Math.min(minDist, Math.min(v.head, L - v.head));
      types[v.type] = (types[v.type] || 0) + 1;
    }
    return { count: vs.length, laneMax, heightErr, heightMax, minDist, types, L };
  });
}
// LIVE dynamics: sample the running TRAFFIC_GROUP twice `ms` apart; every head must advance (mod L).
async function trafficDynamics(page, ms) {
  const before = await page.evaluate(() => ({ heads: window.__KART__.trafficVehicles.map(v => v.head), L: window.__KART__.TRACK_LEN }));
  await new Promise((r) => setTimeout(r, ms));
  const after = await page.evaluate(() => {
    const K = window.__KART__, vs = K.trafficVehicles;
    let laneMax = 0, heightErr = 0;
    for (const v of vs) { laneMax = Math.max(laneMax, Math.abs(v.laneOff)); heightErr = Math.max(heightErr, Math.abs(v.group.position.y - v.wheelR - K.sampleHeight(v.x, v.z))); }
    return { heads: vs.map(v => v.head), count: vs.length, laneMax, heightErr };
  });
  let advanced = 0;
  for (let i = 0; i < after.heads.length; i++) {
    let d = after.heads[i] - before.heads[i];
    if (d < -before.L * 0.5) d += before.L;   // unwrap one lap
    if (d > 0.5) advanced++;
  }
  return { advanced, count: after.count, laneMax: after.laneMax, heightErr: after.heightErr };
}
// collision rulings (launch / invuln / star), all in one page context after forceRace-reset each time.
async function trafficCollision(page) {
  return page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace(); K.G.phase = "racing";
    const p = K.G.players.local, vs = K.trafficVehicles, v = vs[0];
    const clear = () => { p.spinT = 0; p.starT = 0; p.bullT = 0; p.rescueT = 0; p.rescueInvulnT = 0; p.trafficInvulnT = 0; };
    // (1) LAUNCH: kart sitting on the vehicle, moving -> big pop + spin + speed cut
    clear(); p.airborne = false; p.vy = 0;
    p.pos.x = v.x; p.pos.z = v.z; p.pos.y = K.sampleHeight(v.x, v.z);
    p.v.x = 6; p.v.z = 0; const spdBefore = Math.hypot(p.v.x, p.v.z);
    K.advanceTrafficHits(0.05);
    const launched = { airborne: p.airborne, vy: p.vy, spinT: p.spinT, spdBefore, spdAfter: Math.hypot(p.v.x, p.v.z), invuln: p.trafficInvulnT };
    // (2) INVULN blocks a 2nd launch within 1.6s (still on the vehicle; sentinel vy must NOT reset to 7.5)
    p.vy = 2.0; p.pos.x = v.x; p.pos.z = v.z;
    K.advanceTrafficHits(0.05);
    const second = { vy: p.vy, invuln: p.trafficInvulnT };
    // (3) STAR immunity: no launch, no spin
    clear(); p.starT = 5; p.airborne = false; p.vy = 0; p.spinT = 0;
    p.pos.x = v.x; p.pos.z = v.z; p.v.x = 6; p.v.z = 0;
    K.advanceTrafficHits(0.05);
    const starred = { airborne: p.airborne, spinT: p.spinT };
    return { launched, second, starred };
  });
}
// stage a chase-behind-a-big-vehicle pose (taillights + light pools) for a screenshot.
async function stageTrafficChase(page) {
  await page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace(); K.G.phase = "racing";
    const p = K.G.players.local, vs = K.trafficVehicles;
    const v = vs.find((x) => x.type === "bus") || vs.find((x) => x.type === "tanker") || vs[0];
    const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
    p.pos.x = v.x - fx * 13; p.pos.z = v.z - fz * 13; p.pos.y = K.sampleHeight(p.pos.x, p.pos.z);
    p.theta = v.yaw; p.v.x = fx * 9; p.v.z = fz * 9;
  });
  await new Promise((r) => setTimeout(r, 700));   // let the chase camera settle behind
}
// stage a kart mid-air right after a traffic launch (a bus right there).
async function stageTrafficLaunch(page) {
  await page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace(); K.G.phase = "racing";
    const p = K.G.players.local;
    const v = K.trafficVehicles.find((x) => x.type === "bus") || K.trafficVehicles[0];
    p.spinT = 0; p.starT = 0; p.bullT = 0; p.rescueT = 0; p.rescueInvulnT = 0; p.trafficInvulnT = 0;
    p.pos.x = v.x; p.pos.z = v.z; p.pos.y = K.sampleHeight(v.x, v.z);
    p.theta = v.yaw; p.v.x = Math.sin(v.yaw) * 12; p.v.z = Math.cos(v.yaw) * 12;
    K.advanceTrafficHits(0.05);   // launch NOW
  });
  await new Promise((r) => setTimeout(r, 220));   // ~0.22s of airtime -> mid-pop
}

// read the minimap's background PAD colour (corner pixel, drawn before the corridor) to prove the
// city-theme dark-navy swap vs the untouched grass green on every other track.
async function minimapPad(page) {
  return page.evaluate(() => {
    const K = window.__KART__;
    K.forceRace(); K.G.phase = "racing";
    K.updateMinimap();
    const ctx = K.minimapEl.getContext("2d");
    const d = ctx.getImageData(2, 2, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3] };
  });
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

  // ===== PASS A: desktop, toads-turnpike =====
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html?track=toads-turnpike", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace && window.__KART__.CITY_GROUP), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1600));          // let the countdown/grid frame settle at the elevated start
    await page.screenshot({ path: path.join(SHOTS, "fk_turnpike_start.png") });

    const scan = await page.evaluate(PAGE_SCAN);
    check("A sky preset is night", scan.sky === "night", scan.sky);
    check("A theme is city", scan.theme === "city", scan.theme);
    check("A CITY_GROUP exists w/ info", !!scan.cityInfo);
    check("A lamp count sane (>20)", scan.cityInfo && scan.cityInfo.lamps > 20, scan.cityInfo && scan.cityInfo.lamps);
    check("A building count sane (>40)", scan.cityInfo && scan.cityInfo.buildings > 40, scan.cityInfo && scan.cityInfo.buildings);
    check("A skyline count sane (>20)", scan.cityInfo && scan.cityInfo.skyline > 20, scan.cityInfo && scan.cityInfo.skyline);
    check("A billboard count >=8", scan.cityInfo && scan.cityInfo.billboards >= 8, scan.cityInfo && scan.cityInfo.billboards);
    check("A draw budget <=25", scan.cityInfo && scan.cityInfo.draws <= 25, scan.cityInfo && scan.cityInfo.draws);
    check("A cityRoles: lamp+building+skyline+billboard tagged", scan.cityRoles.lamp && scan.cityRoles.building && scan.cityRoles.skyline && scan.cityRoles.billboard, JSON.stringify(scan.cityRoles));
    check("A NO grass tufts (city)", scan.hasTuftEmissive === false);
    check("A ground blade texture skipped (map null)", scan.groundHasMap === false);
    check("A ground is dark asphalt (vert r<0.30)", scan.groundVertR != null && scan.groundVertR < 0.30, scan.groundVertR);
    check("A road ribbon uses city blue-gray (0x3d434e)", scan.colors.indexOf(0x3d434e) >= 0, scan.colors.map((c) => c.toString(16)).join(","));
    check("A curbs use city light gray (0x9aa2ad)", scan.colors.indexOf(0x9aa2ad) >= 0);
    check("A lane-mark mesh present (verts>0)", scan.laneVerts > 0, scan.laneVerts);

    const d = await drive(page, 6000);
    check("A kart position finite after drive", isFinite(d.px) && isFinite(d.pz));
    check("A camera position finite after drive", isFinite(d.cx) && isFinite(d.cy) && isFinite(d.cz));
    check("A buildings clear of the road (min road-dist > half+2=11)", d.worstBldgRoadDist > 11, d.worstBldgRoadDist);
    check("A camera never near a building center (>6u)", d.minCamToBldg > 6, d.minCamToBldg);
    await page.screenshot({ path: path.join(SHOTS, "fk_turnpike_night_desktop.png") });

    // ===== TRAFFIC (2026-07-17) =====
    const liveVeh = await page.evaluate(() => window.__KART__.trafficVehicles.length);
    check("A TRAFFIC_GROUP has 12 vehicles", liveVeh === 12, liveVeh);
    const boot = await trafficBootScan(page);
    check("A boot: 12 vehicles", boot.count === 12, boot.count);
    check("A boot: authentic type mix (4 sedan/3 bus/3 boxtruck/2 tanker)",
      boot.types.sedan === 4 && boot.types.bus === 3 && boot.types.boxtruck === 3 && boot.types.tanker === 2, JSON.stringify(boot.types));
    check("A boot: every |laneOff| <= 7.2", boot.laneMax <= 7.2, boot.laneMax);
    check("A boot: seated within 0.6u of sampleHeight (ramp-follows)", boot.heightErr < 0.6, boot.heightErr);
    check("A boot: some vehicles on the elevated start straight (sampleHeight > 4)", boot.heightMax > 4, boot.heightMax);
    check("A boot: none within 30u of s=0 (start grid clear)", boot.minDist >= 30, boot.minDist);
    const dyn = await trafficDynamics(page, 3000);
    check("A live: all 12 heads advanced over 3s (wrap-aware)", dyn.advanced === dyn.count && dyn.count === 12, `${dyn.advanced}/${dyn.count}`);
    check("A live: |laneOff| <= 7.2 while driving", dyn.laneMax <= 7.2, dyn.laneMax);
    check("A live: seated within 0.6u of sampleHeight while driving", dyn.heightErr < 0.6, dyn.heightErr);
    const col = await trafficCollision(page);
    check("A hit: kart LAUNCHED (airborne)", col.launched.airborne === true);
    check("A hit: vy > 0 (big pop)", col.launched.vy > 0, col.launched.vy);
    check("A hit: spins out (spinT > 0)", col.launched.spinT > 0, col.launched.spinT);
    check("A hit: horizontal speed cut", col.launched.spdAfter < col.launched.spdBefore, `${col.launched.spdBefore}->${col.launched.spdAfter}`);
    check("A hit: trafficInvulnT set (~1.55)", col.launched.invuln > 1.4, col.launched.invuln);
    check("A invuln blocks a 2nd launch within 1.6s (vy stays 2.0)", Math.abs(col.second.vy - 2.0) < 0.01, col.second.vy);
    check("A invuln decrements", col.second.invuln < col.launched.invuln, `${col.launched.invuln}->${col.second.invuln}`);
    check("A star immunity: NO launch", col.starred.airborne === false);
    check("A star immunity: NO spin", col.starred.spinT === 0, col.starred.spinT);
    await stageTrafficChase(page);
    await page.screenshot({ path: path.join(SHOTS, "fk_turnpike_traffic.png") });
    await stageTrafficLaunch(page);
    await page.screenshot({ path: path.join(SHOTS, "fk_turnpike_launch.png") });
    const padA = await minimapPad(page);
    check("A minimap pad is dark navy (city): b is the max channel", padA.b > padA.g && padA.b > padA.r, JSON.stringify(padA));

    // ============ OVERPASS CROSSING REGRESSION (2026-07-17) ============
    // Toad's Turnpike shares midnight-run's over/under bugs: the elevated START STRAIGHT (y8) crosses OVER
    // the y0 cross-street, so a kart / traffic vehicle / lamp / lane-mark under the deck read the deck height
    // via the context-free sampleHeight (XZ-nearest branch) and were rescued / phantom-launched / teleported.
    const cross = await page.evaluate(() => {
      const K = window.__KART__; K.forceRace(); K.G.phase = "racing";
      const R = {};
      const HALF = K.TRACK_WIDTH / 2;
      const p = K.G.players.local;
      const clearK = () => { p.spinT = 0; p.starT = 0; p.bullT = 0; p.rescueT = 0; p.rescueInvulnT = 0; p.trafficInvulnT = 0; };
      const _sampled = FK_TRACK.resample(K.ACTIVE_TRACK, THREE);
      const smp = K.centerPts, arcS = K.arcS, T = K.tangents, L = K.TRACK_LEN, N = smp.length;
      function sampleAtArc(a) { a = ((a % L) + L) % L; let i = 0; for (; i < N - 1; i++) { if (arcS[i + 1] > a) break; } const i0 = i, i1 = (i + 1) % N, segLen = (i1 === 0) ? (L - arcS[i0]) : (arcS[i1] - arcS[i0]); const t = segLen > 1e-6 ? (a - arcS[i0]) / segLen : 0; const c0 = smp[i0], c1 = smp[i1], t0 = T[i0], t1 = T[i1]; const x = c0.x + (c1.x - c0.x) * t, z = c0.z + (c1.z - c0.z) * t, y = c0.y + (c1.y - c0.y) * t; let tx = t0.x + (t1.x - t0.x) * t, tz = t0.z + (t1.z - t0.z) * t; const tl = Math.hypot(tx, tz) || 1; return { x, z, y, tx: tx / tl, tz: tz / tl }; }

      // AUTO-LOCATE the crossing: on-road cells where the low branch (AtY<1.5) reads the deck (sampleHeight>5).
      let sx = 0, sz = 0, band = 0, worstSH = 0, worstAtY = 0, rescueFalseAll = true;
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (const c of smp) { if (c.x < minX) minX = c.x; if (c.x > maxX) maxX = c.x; if (c.z < minZ) minZ = c.z; if (c.z > maxZ) maxZ = c.z; }
      for (let x = minX; x <= maxX; x += 2) for (let z = minZ; z <= maxZ; z += 2) {
        if (K.nearestCenterInfo(x, z).dist > HALF) continue;
        const shy = K.sampleHeightAtY(x, z, 0); if (shy > 1.5) continue;
        const sh = K.sampleHeight(x, z);
        if (sh - 0 > K.RESCUE_WORLD_FLOOR) {
          band++; sx += x; sz += z; if (sh > worstSH) { worstSH = sh; worstAtY = shy; }
          clearK(); p.pos.x = x; p.pos.z = z; p.y = 0; p.vy = 0; p.airborne = false;
          if (K.rescueTriggered(p)) rescueFalseAll = false;
        }
      }
      const CX = band ? sx / band : 1, CZ = band ? sz / band : 98;
      R.bandCells = band; R.rescueFalseAll = rescueFalseAll; R.worstSH = +worstSH.toFixed(2); R.worstAtY = +worstAtY.toFixed(2); R.CX = +CX.toFixed(1); R.CZ = +CZ.toFixed(1);

      // GENUINE fall still fires (single-level y0 stretch far from the crossing).
      let flatIdx = 0; for (let i = 0; i < N; i++) { if (Math.abs(smp[i].y) < 0.2 && Math.hypot(smp[i].x - CX, smp[i].z - CZ) > 80) { flatIdx = i; break; } }
      clearK(); p.pos.x = smp[flatIdx].x; p.pos.z = smp[flatIdx].z; p.y = smp[flatIdx].y - 6; p.vy = 0; p.airborne = false;
      R.genuineFall = !!K.rescueTriggered(p);
      p.y = smp[flatIdx].y; R.flatNoRescue = !K.rescueTriggered(p);

      // PHANTOM-HIT GATE: vehicle on the deck (y8) over a kart on the low road (y0) -> no launch; same level -> launch.
      const vs = K.trafficVehicles, veh = vs[0];
      const stash = vs.map(v => ({ x: v.x, z: v.z, y: v.y, head: v.head }));
      for (let i = 1; i < vs.length; i++) { vs[i].x += 1e5; vs[i].z += 1e5; }
      veh.x = CX; veh.z = CZ; veh.y = 8; veh.yaw = 0; veh.group.position.set(CX, 8 + veh.wheelR, CZ);
      clearK(); p.pos.x = CX; p.pos.z = CZ; p.y = 0; p.v.x = 8; p.v.z = 0; p.airborne = false;
      K.advanceTrafficHits(1 / 60);
      R.gateBlocksOverpass = (p.spinT === 0 && p.trafficInvulnT === 0);
      clearK(); p.pos.x = CX; p.pos.z = CZ; p.y = 8; p.v.x = 8; p.v.z = 0;
      K.advanceTrafficHits(1 / 60);
      R.sameLevelStillHits = (p.spinT > 0);

      // REAL DRIVE-UNDER along the low-road tangent, viaduct vehicle tracked overhead, traffic ruling active.
      let bi = 0, bd = 1e18; for (let i = 0; i < N; i++) { if (Math.abs(smp[i].y) > 1.5) continue; const d = Math.hypot(smp[i].x - CX, smp[i].z - CZ); if (d < bd) { bd = d; bi = i; } }
      const bt = T[bi], nlx = -bt.z, nlz = bt.x;   // low-road tangent + left normal at the crossing
      let bestOff = 0, bestSH = -1;
      for (let off = -(HALF - 2); off <= HALF - 2; off += 0.5) { const qx = smp[bi].x + nlx * off, qz = smp[bi].z + nlz * off; if (K.sampleHeightAtY(qx, qz, 0) > 0.3) continue; const sh = K.sampleHeight(qx, qz); if (sh > bestSH) { bestSH = sh; bestOff = off; } }
      function drivePass() {
        clearK();
        // The cross-street runs PERPENDICULAR under the deck, so a long drive would cross the deck's lateral
        // edges (a pre-existing K7 branch-transition launch, not the crow bug). Keep it SHORT + CENTERED on
        // the crossing so the kart stays under the deck the whole pass: start 6u back, 8u/s -> ~12u total.
        const cxu = smp[bi].x + nlx * bestOff, czu = smp[bi].z + nlz * bestOff;   // low-road point under the deck
        const BACK = 6, spd = 8;
        p.pos.x = cxu - bt.x * BACK; p.pos.z = czu - bt.z * BACK; p.y = 0; p.vy = 0; p.airborne = false;
        p.theta = Math.atan2(bt.x, bt.z); p.v.x = bt.x * spd; p.v.z = bt.z * spd;
        veh.yaw = p.theta;
        let maxR = 0, maxS = 0, maxI = 0, maxY = -1e9, hazard = 0;
        for (let i = 0; i < 90; i++) {
          K.stepKart(p, { steer: 0, throttle: 1, brake: 0, drift: false }, 1 / 60);
          veh.x = p.pos.x; veh.z = p.pos.z; veh.y = p.y + 8; veh.group.position.set(p.pos.x, p.y + 8 + veh.wheelR, p.pos.z);
          K.advanceTrafficHits(1 / 60);
          if (K.sampleHeight(p.pos.x, p.pos.z) - p.y > K.RESCUE_WORLD_FLOOR) hazard++;
          maxR = Math.max(maxR, p.rescueT); maxS = Math.max(maxS, p.spinT); maxI = Math.max(maxI, p.trafficInvulnT); maxY = Math.max(maxY, p.y);
        }
        return { maxR, maxS, maxI, maxY: +maxY.toFixed(2), hazard };
      }
      for (let i = 1; i < vs.length; i++) { vs[i].x += 1e5; vs[i].z += 1e5; }
      const pass1 = drivePass(), pass2 = drivePass();
      for (let i = 0; i < vs.length; i++) { vs[i].x = stash[i].x; vs[i].z = stash[i].z; vs[i].y = stash[i].y; vs[i].head = stash[i].head; }
      R.passes = [pass1, pass2];
      // The CROW + PHANTOM-HIT must stay clean while driving under the deck (that IS the fix). We do NOT
      // require the kart to hold y~0 here: the cross-street runs PERPENDICULAR under the deck, so the physics
      // height-follow can mount the deck at the far lateral edge — a pre-existing K7 multi-level transition
      // (stepKart / sampleKartPlane / sampleHeightAtY were untouched by this fix; identical pre/post). The
      // "stays on the low branch" guarantee is proven instead by the 96-cell static rescue scan above and the
      // vehicle-seat sweep below. maxY<9.5 is only a sane-bounds guard (no NaN / fly-away).
      R.driveClean = [pass1, pass2].every(q => q.maxR === 0 && q.maxS === 0 && q.maxI === 0 && q.maxY < 9.5);
      R.driveHitHazard = [pass1, pass2].every(q => q.hazard > 0);

      // VEHICLE branch stability near the crossing (seat stays low vs the deck the OLD hfn would read).
      let maxSeat = -1, maxHfn = -1, sweptLow = 0;
      for (let a = 0; a < L; a += 2) { const sp = sampleAtArc(a); if (sp.y > 2) continue; const lx = sp.x + (-sp.tz) * veh.laneOff, lz = sp.z + (sp.tx) * veh.laneOff; if (Math.hypot(lx - CX, lz - CZ) > 30) continue; sweptLow++; veh.head = a; K.TRAFFIC_GROUP.userData.update(0); maxSeat = Math.max(maxSeat, veh.group.position.y); maxHfn = Math.max(maxHfn, K.sampleHeight(lx, lz)); }
      R.vehSweptLow = sweptLow; R.vehMaxSeatY = +maxSeat.toFixed(2); R.vehMaxHfnWouldBe = +maxHfn.toFixed(2); R.vehHasY = (typeof veh.y === "number");

      // CITYSCAPE statics near the crossing: heightFn-independent + on a real branch (~0 or ~8).
      function laneYsNear(hf) { const g = FK_TRACK.buildLaneMarks(_sampled, K.TRACK_WIDTH, THREE, { heightFn: hf }); const ys = []; g.traverse(o => { if (o.isMesh && o.geometry && o.geometry.attributes.position) { const pa = o.geometry.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), z = pa.getZ(i), y = pa.getY(i); if (Math.hypot(x - CX, z - CZ) <= 12) ys.push(+y.toFixed(3)); } } }); return ys; }
      const laneSane = laneYsNear((x, z) => K.sampleHeight(x, z)), laneWrong = laneYsNear(() => 999);
      R.laneN = laneSane.length;
      R.laneHeightFnIndependent = (laneSane.length === laneWrong.length) && laneSane.every((y, i) => Math.abs(y - laneWrong[i]) < 0.01);
      R.laneOnBranch = laneSane.every(y => Math.abs(y) < 1.6 || Math.abs(y - 8) < 1.6);
      R.laneLowPresent = laneSane.some(y => Math.abs(y) < 1.6); R.laneHighPresent = laneSane.some(y => Math.abs(y - 8) < 1.6);
      function lampBasesNear(hf) { const cg = FK_TRACK.buildCityscape(_sampled, K.TRACK_WIDTH, THREE, { heightFn: hf, groundFn: (x, z) => K.groundSampleHeight(x, z), wallMargin: 6 }); const m = new THREE.Matrix4(), bases = []; cg.traverse(o => { if (o.isInstancedMesh && o.userData && o.userData.cityRole === "lamp" && o.geometry && o.geometry.parameters && o.geometry.parameters.height > 5) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); const x = m.elements[12], y = m.elements[13], z = m.elements[14]; if (Math.hypot(x - CX, z - CZ) <= 40) bases.push(+(y - 3.5).toFixed(2)); } } }); return bases; }
      const lampWrong = lampBasesNear(() => 999);
      R.lampNearN = lampWrong.length;
      R.lampsOnBranch = lampWrong.length > 0 && lampWrong.every(b => Math.abs(b) < 1.6 || Math.abs(b - 8) < 1.6);
      R.lampsIgnoreHeightFn = lampWrong.every(b => b < 100);
      return R;
    });
    check("A crossing: pre-fix crow hazard band EXISTS at the elevated-start overpass", cross.bandCells > 0 && cross.worstSH > 5 && cross.worstAtY < 1.5, JSON.stringify({ band: cross.bandCells, worstSH: cross.worstSH, worstAtY: cross.worstAtY, CX: cross.CX, CZ: cross.CZ }));
    check("A crossing: rescue crow does NOT fire in the band (kart on low road)", cross.rescueFalseAll, `${cross.bandCells} cells`);
    check("A crossing: a GENUINE fall still triggers rescue; flat road does not", cross.genuineFall && cross.flatNoRescue, JSON.stringify({ fall: cross.genuineFall, flat: cross.flatNoRescue }));
    check("A crossing: Y-gate blocks a deck vehicle over a kart on the road below", cross.gateBlocksOverpass, JSON.stringify({ gate: cross.gateBlocksOverpass }));
    check("A crossing: a SAME-LEVEL traffic hit still launches", cross.sameLevelStillHits, JSON.stringify({ same: cross.sameLevelStillHits }));
    check("A crossing: real drive-under -> no rescue crow + no phantom traffic hit (traffic active)", cross.driveClean, JSON.stringify(cross.passes));
    check("A crossing: those passes traversed the pre-fix crow band while at low y (hazard>0)", cross.driveHitHazard, JSON.stringify(cross.passes.map(q => q.hazard)));
    check("A crossing: traffic vehicle holds the LOW branch through the crossing (seat<2 vs deck~8)", cross.vehSweptLow > 0 && cross.vehMaxSeatY < 2 && cross.vehMaxHfnWouldBe > 5 && cross.vehHasY, JSON.stringify({ swept: cross.vehSweptLow, seatY: cross.vehMaxSeatY, hfnWouldBe: cross.vehMaxHfnWouldBe }));
    check("A crossing: lane-mark height is independent of heightFn (from centerline y)", cross.laneN > 0 && cross.laneHeightFnIndependent, JSON.stringify({ n: cross.laneN, indep: cross.laneHeightFnIndependent }));
    check("A crossing: near-crossing lane marks on a real branch (~0 or ~8), both represented", cross.laneOnBranch && cross.laneLowPresent && cross.laneHighPresent, JSON.stringify({ onBranch: cross.laneOnBranch, low: cross.laneLowPresent, high: cross.laneHighPresent }));
    check("A crossing: near-crossing street lamps on a real branch + ignore a wrong heightFn", cross.lampNearN > 0 && cross.lampsOnBranch && cross.lampsIgnoreHeightFn, JSON.stringify({ n: cross.lampNearN, onBranch: cross.lampsOnBranch, ignoreHf: cross.lampsIgnoreHeightFn }));

    check("A 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ===== PASS B: desktop, default (bare URL) — other tracks unchanged =====
  {
    const page = await newPage(false);
    await page.goto(BASE + "/farmkart.html", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace), { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));
    const scan = await page.evaluate(PAGE_SCAN);
    check("B default sky is day", scan.sky === "day", scan.sky);
    check("B default theme is null", scan.theme === null, String(scan.theme));
    check("B NO CITY_GROUP", scan.cityInfo === null);
    check("B lane group empty (0 verts)", scan.laneVerts === 0);
    check("B grass tufts present", scan.hasTuftEmissive === true);
    check("B ground keeps blade texture (map non-null)", scan.groundHasMap === true);
    check("B ground is grass (vert r>0.40)", scan.groundVertR != null && scan.groundVertR > 0.40, scan.groundVertR);
    check("B road ribbon keeps original 0x33373d", scan.colors.indexOf(0x33373d) >= 0);
    check("B curbs keep original 0xdfe4ea", scan.colors.indexOf(0xdfe4ea) >= 0);
    check("B no city road colour present", scan.colors.indexOf(0x3d434e) < 0);
    const bVeh = await page.evaluate(() => window.__KART__.trafficVehicles.length);
    check("B no traffic vehicles on default track", bVeh === 0, bVeh);
    const padB = await minimapPad(page);
    check("B minimap pad stays grass green: g is the max channel", padB.g > padB.r && padB.g > padB.b, JSON.stringify(padB));
    check("B 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  // ===== PASS C: mobile, toads-turnpike =====
  {
    const page = await newPage(true);
    await page.goto(BASE + "/farmkart.html?track=toads-turnpike", { waitUntil: "networkidle0", timeout: 60000 });
    await page.waitForFunction(() => !!(window.__KART__ && window.__KART__.forceRace && window.__KART__.CITY_GROUP), { timeout: 15000 });
    const scan = await page.evaluate(PAGE_SCAN);
    check("C mobile CITY_GROUP present", !!scan.cityInfo);
    check("C mobile buildings reduced (<=110)", scan.cityInfo && scan.cityInfo.buildings <= 110, scan.cityInfo && scan.cityInfo.buildings);
    check("C mobile draw budget <=25", scan.cityInfo && scan.cityInfo.draws <= 25, scan.cityInfo && scan.cityInfo.draws);
    const cVeh = await page.evaluate(() => window.__KART__.trafficVehicles.length);
    check("C mobile TRAFFIC_GROUP has 12 vehicles", cVeh === 12, cVeh);
    await drive(page, 3500);
    await page.screenshot({ path: path.join(SHOTS, "fk_turnpike_mobile.png") });
    await stageTrafficChase(page);
    await page.screenshot({ path: path.join(SHOTS, "fk_turnpike_traffic_mobile.png") });
    check("C mobile 0 pageerrors", page._errs.length === 0, page._errs.join(" | "));
    await page.close();
  }

  await browser.close();
  if (server) try { server.kill(); } catch (_) {}

  const pass = CHECKS.filter((c) => c.pass).length;
  console.log(`turnpike verify: ${pass}/${CHECKS.length} pass`);
  for (const c of CHECKS) console.log(`  ${c.pass ? "OK" : "FAIL"}  ${c.name}${c.detail !== "" ? " — " + c.detail : ""}`);
  if (errorsAll.length) { console.log("pageerrors:"); errorsAll.forEach((e) => console.log("  ", e)); }
  const ok = CHECKS.every((c) => c.pass) && errorsAll.length === 0;
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
