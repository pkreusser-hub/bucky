#!/usr/bin/env node
"use strict";
/**
 * Integration smoke test: Hayhem2 — turn system, slingshot aim, wind, AI,
 * direct hits, anti-tunnel, pond correctness, water-outs, framing.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8862;
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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}
let PASS = 0;
function check(cond, msg) { if (!cond) throw new Error("FAIL: " + msg); PASS++; console.log("  ✓ " + msg); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitPhase(page, phase, to) {
  await page.waitForFunction((p) => window.__HAYHEM__.phase === p, { timeout: to || 12000 }, phase);
}
async function waitResolve(page, to) {
  // wait until all projectiles gone and back to aim (turn advanced) or won
  await page.waitForFunction(() => {
    const H = window.__HAYHEM__;
    return H.G.projectiles.length === 0 && (H.phase === "aim" || H.phase === "won");
  }, { timeout: to || 25000 });
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.goto(BASE + "/hayhem.html", { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => !!window.__HAYHEM__, { timeout: 30000 });

  // ── 1) TITLE → PLAY → aim, HUD, 6 units, voxels ──
  console.log("\n[1] title / start");
  const t = await page.evaluate(() => {
    const el = document.getElementById("title");
    return { vis: el && !el.classList.contains("hidden"), logo: document.querySelector(".logo").textContent.includes("HAYHEM"),
      bar: !!(document.querySelector("#bar a") && document.querySelector("#bar .t")) };
  });
  check(t.vis, "title screen visible");
  check(t.logo, "logo reads HAYHEM");
  check(t.bar, "Bucky back bar present");
  await page.click("#playBtn");
  await waitPhase(page, "aim");
  const s = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    return { phase: H.phase, voxels: H.voxelCount(), units: H.G.units.length,
      goats: H.G.units.filter(u => u.kind === "goat").length, armas: H.G.units.filter(u => u.kind === "armadillo").length,
      hud: document.getElementById("hud").classList.contains("on"), activeTeam: H.activeTeam };
  });
  check(s.phase === "aim", "phase aim after PLAY");
  check(s.voxels > 800 && s.voxels < 20000, "voxel island sane (" + s.voxels + ")");
  check(s.units === 6 && s.goats === 3 && s.armas === 3, "6 units: 3 goats + 3 armadillos");
  check(s.hud, "HUD on");
  check(s.activeTeam === 0, "west starts");
  // camera: brief overview beat, then flies to 3rd-person behind shooter 1
  const cm0 = await page.evaluate(() => window.__HAYHEM__.camMode);
  check(cm0 === "overview" || cm0 === "fly", "match starts in overview (" + cm0 + ")");
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  const ci = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const u = H.G.units.find(x => x.id === H.activeUnitId);
    const c = H.camInfo();
    const foes = H.G.units.filter(x => x.team === 1 && !x.out);
    const ex = foes.reduce((a, f) => a + f.x, 0) / foes.length;
    const ey = foes.reduce((a, f) => a + f.y, 0) / foes.length;
    const ez = foes.reduce((a, f) => a + f.z, 0) / foes.length;
    let ax = ex - u.x, ay = ey - u.y, az = ez - u.z;
    const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
    const dot = c.fwd[0] * ax + c.fwd[1] * ay + c.fwd[2] * az;
    return { dist: Math.hypot(u.x - c.pos[0], u.y - c.pos[1], u.z - c.pos[2]), dot };
  });
  check(ci.dist < 10, "aim camera within 10 of the shooter (dist " + ci.dist.toFixed(1) + ")");
  check(ci.dot > 0.5, "camera looks toward the enemy yard (dot " + ci.dot.toFixed(2) + ")");

  // ── 2) POND correctness + splash (no carve) ──
  console.log("\n[2] pond / splash");
  const wi = await page.evaluate(() => window.__HAYHEM__.waterInfo());
  check(wi.waterY > wi.bedTopY, `waterY(${wi.waterY.toFixed(2)}) > bedTopY(${wi.bedTopY.toFixed(2)})`);
  check(wi.waterVisible, "water mesh visible");
  const splash = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const before = H.voxelCount();
    // lob from west muzzle to land in pond center: aim up+toward center, tuned power
    const u = H.G.units.find(x => x.id === H.activeUnitId);
    const o = H.muzzleOf(u.id);
    // pick a dir/power that peaks and drops into pond center (~x 0). Search:
    let best = null;
    for (let pw = 8; pw <= 22; pw += 0.5) {
      for (let p = 25; p <= 65; p += 5) {
        const pit = p * Math.PI / 180;
        const dir = [Math.cos(pit), Math.sin(pit), 0];
        const pts = H.simulate(pw, dir[0], dir[1], dir[2]);
        const end = pts[pts.length - 1];
        if (Math.abs(end.x) < 2.5 && Math.abs(end.z) < 5 && end.y < 3) { best = { pw, dir }; break; }
      }
      if (best) break;
    }
    return { before, best };
  });
  check(!!splash.best, "found a lob into the pond");
  await page.evaluate((b) => window.__HAYHEM__.fireAt(b.pw, b.dir[0], b.dir[1], b.dir[2]), splash.best);
  await page.waitForFunction(() => window.__HAYHEM__.G.lastImpact != null, { timeout: 15000 });
  const splashRes = await page.evaluate((before) => {
    const H = window.__HAYHEM__;
    return { kind: H.G.lastImpact.kind, after: H.voxelCount(), before };
  }, splash.before);
  check(splashRes.kind === "splash", "pumpkin into pond → splash (kind=" + splashRes.kind + ")");
  check(splashRes.after === splashRes.before, "splash carved 0 voxels (" + splashRes.before + "→" + splashRes.after + ")");
  await waitResolve(page);

  // ── 3) DIRECT HIT on an east critter ──
  console.log("\n[3] direct hit");
  const hit = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.startMatch();
    const o = H.muzzleOf(H.activeUnitId);
    const targetId = 4;
    const tp = H.critters[targetId].bodies.torso.position;
    // Real firing solution: search pitch/power for the arc that passes CLOSEST
    // (mid-air) to the torso, honoring gravity+wind — then fire that dir/power.
    const bearing = Math.atan2(tp.z - o.z, tp.x - o.x);
    let best = null;
    for (let pw = 8; pw <= 26; pw += 0.4) {
      for (let pd = 16; pd <= 70; pd += 1.5) {
        const pit = pd * Math.PI / 180;
        const dir = [Math.cos(pit) * Math.cos(bearing), Math.sin(pit), Math.cos(pit) * Math.sin(bearing)];
        const pts = H.simulate(pw, dir[0], dir[1], dir[2]);
        for (const p of pts) {
          const d = Math.hypot(p.x - tp.x, p.y - tp.y, p.z - tp.z);
          if (!best || d < best.d) best = { d, pw, dir };
        }
      }
    }
    const beforeMode = H.G.units[targetId].mode;
    const beforePos = { x: tp.x, y: tp.y, z: tp.z };
    H.fireAt(best.pw, best.dir[0], best.dir[1], best.dir[2]);
    return { targetId, beforeMode, beforePos, minD: best.d };
  });
  await page.waitForFunction((id) => {
    const H = window.__HAYHEM__;
    return H.G.units[id].mode === "ragdoll" || H.G.lastImpact != null;
  }, { timeout: 15000 }, hit.targetId);
  const hitRes = await page.evaluate((h) => {
    const H = window.__HAYHEM__;
    const tp = H.critters[h.targetId].bodies.torso.position;
    return { mode: H.G.units[h.targetId].mode, lastKind: H.G.lastImpact && H.G.lastImpact.kind,
      moved: Math.hypot(tp.x - h.beforePos.x, tp.y - h.beforePos.y, tp.z - h.beforePos.z) };
  }, hit);
  check(hit.beforeMode === "stiff", "target started stiff");
  check(hit.minD < 0.62, "firing solution passes THROUGH the torso (minD=" + hit.minD.toFixed(2) + " < HIT_R)");
  check(hitRes.mode === "ragdoll", "direct hit ragdolled the target");
  check(hitRes.lastKind === "hit", "impact registered as direct hit (kind=" + hitRes.lastKind + ")");
  await sleep(300);
  const hitMoved = await page.evaluate((h) => {
    const tp = window.__HAYHEM__.critters[h.targetId].bodies.torso.position;
    return Math.hypot(tp.x - h.beforePos.x, tp.z - h.beforePos.z) + Math.abs(tp.y - h.beforePos.y);
  }, hit);
  check(hitMoved > 0.15, "target displaced by the blast (" + hitMoved.toFixed(2) + ")");
  await waitResolve(page, 25000);

  // ── 4) TUNNELING: full-power flat-ish shot must detonate on the wall ──
  console.log("\n[4] anti-tunnel");
  const tun = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.startMatch();
    // Find a HIGH-power arc that ends on solid terrain (a bank/yard wall) — the
    // meaningful tunnel case. Substepping (≤0.22 < CELL) must catch the wall.
    let best = null;
    for (let pw = 26; pw >= 20; pw -= 0.5) {
      for (let pd = 20; pd <= 60; pd += 1.5) {
        const pit = pd * Math.PI / 180;
        const dir = [Math.cos(pit), Math.sin(pit), 0];
        const pts = H.simulate(pw, dir[0], dir[1], dir[2]);
        const end = pts[pts.length - 1];
        const inPond = Math.abs(end.x) < 3.0 && Math.abs(end.z) < 6.3;
        // terrain break on the near-side east bank (past pond, BEFORE the east
        // critters at x~11.6) so we exercise a pure terrain hit at high speed
        if (!inPond && end.y > 1.5 && end.x > 3.4 && end.x < 9.5) { best = { pw, dir, end }; break; }
      }
      if (best) break;
    }
    const before = H.voxelCount();
    if (best) H.fireAt(best.pw, best.dir[0], best.dir[1], best.dir[2]);
    return { before, best, power: best && best.pw };
  });
  check(!!tun.best, "found a high-power shot that lands on the far bank (pw=" + (tun.power || 0) + ")");
  await page.waitForFunction(() => window.__HAYHEM__.G.lastImpact != null, { timeout: 15000 });
  const tunRes = await page.evaluate((before) => {
    const H = window.__HAYHEM__;
    return { before, after: H.voxelCount(), kind: H.G.lastImpact.kind, ix: H.G.lastImpact.x };
  }, tun.before);
  check(tunRes.after < tunRes.before, "full-power shot detonated voxels (kind=" + tunRes.kind + ", " + tunRes.before + "→" + tunRes.after + ")");
  check(tunRes.ix < 21, "detonated inside bounds, did not exit far side (x=" + tunRes.ix.toFixed(1) + ")");
  await waitResolve(page, 25000);

  // ── 5) TURN cycling: west shot resolves → east turn → AI fires → back to a DIFFERENT west unit ──
  console.log("\n[5] turn system + AI");
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await waitPhase(page, "aim");
  const turn0 = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const firstWest = H.activeUnitId;
    // fire a harmless lob so the turn resolves
    H.fireAt(14, 0.7, 0.6, 0.05);
    return { firstWest };
  });
  await waitResolve(page, 25000);
  const afterWest = await page.evaluate(() => ({ team: window.__HAYHEM__.activeTeam, phase: window.__HAYHEM__.phase }));
  check(afterWest.phase === "aim" && afterWest.team === 1, "after west shot → east's turn");
  // AI fires
  const aiFired = await page.evaluate(() => window.__HAYHEM__.aiFireNow());
  check(aiFired, "AI fired a real projectile");
  await waitResolve(page, 25000);
  const afterEast = await page.evaluate((first) => {
    const H = window.__HAYHEM__;
    return { team: H.activeTeam, phase: H.phase, west: H.activeUnitId, first, won: H.phase === "won" };
  }, turn0.firstWest);
  if (!afterEast.won) {
    check(afterEast.team === 0, "after east/AI shot → back to west");
    check(afterEast.west !== afterEast.first, "west cycles to a DIFFERENT unit (" + afterEast.first + "→" + afterEast.west + ")");
  } else {
    check(true, "match ended during AI turn (cycling n/a) — acceptable");
  }

  // ── 6) WIND affects landing + preview matches flight ──
  console.log("\n[6] wind + preview honesty");
  const windRes = await page.evaluate(async () => {
    const H = window.__HAYHEM__;
    function landX(w) {
      H.startMatch();
      H.setWind(w);
      const pit = 45 * Math.PI / 180;
      const dir = [Math.cos(pit), Math.sin(pit), 0];
      const pts = H.simulate(16, dir[0], dir[1], dir[2]);
      return pts[pts.length - 1].x;
    }
    return { plus: landX(2.0), minus: landX(-2.0) };
  });
  check(Math.abs(windRes.plus - windRes.minus) > 1.0, "wind +2 vs -2 changes landing x by " + Math.abs(windRes.plus - windRes.minus).toFixed(2));
  // stub = first ~40% of the honest arc, and it matches the actual early flight (with wind)
  await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.startMatch();
    H.setAmmo("pumpkin");
    H.setWind(1.5);
    const pit = 42 * Math.PI / 180;
    const dir = [Math.cos(pit), Math.sin(pit), 0.05];
    window.__pvFull = H.previewShot(16, dir[0], dir[1], dir[2]).pts;
    window.__pvStub = H.previewStubPts(16, dir[0], dir[1], dir[2]);
    H.fireAt(16, dir[0], dir[1], dir[2]);
  });
  const frac = await page.evaluate(() => {
    function plen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z); return L; }
    return plen(window.__pvStub) / Math.max(1e-6, plen(window.__pvFull));
  });
  check(Math.abs(frac - 0.4) < 0.06, "preview stub ≈ 40% of full arc by path length (frac=" + frac.toFixed(3) + ")");
  // wait until the flight has covered the stub's x-range (or impacted)
  await page.waitForFunction(() => {
    const H = window.__HAYHEM__, pv = window.__pvStub, fl = H.G.flightLog;
    if (!pv || !pv.length) return true;
    const pvEndX = pv[pv.length - 1].x;
    const covered = fl.length && Math.abs(fl[fl.length - 1].x - fl[0].x) >= Math.abs(pvEndX - pv[0].x) * 0.98;
    return covered || !H.G.projectiles.length;
  }, { timeout: 12000 });
  const previewMatch = await page.evaluate(() => {
    const H = window.__HAYHEM__, pv = window.__pvStub, flight = H.G.flightLog.slice();
    let maxErr = 0;
    for (const a of pv) {
      let m = Infinity;
      for (const b of flight) { const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); if (d < m) m = d; }
      if (m > maxErr) maxErr = m;
    }
    return { maxErr, flightLen: flight.length };
  });
  check(previewMatch.flightLen > 6, "flight logged samples (" + previewMatch.flightLen + ")");
  check(previewMatch.maxErr < 0.35, "preview stub matches actual early flight w/ wind (maxErr=" + previewMatch.maxErr.toFixed(3) + ")");
  await waitResolve(page, 25000);

  // ── 7) WATER-OUT + WIN + PLAY AGAIN ──
  console.log("\n[7] water-out + win + reset");
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await waitPhase(page, "aim");
  const dunk1 = await page.evaluate(() => window.__HAYHEM__.dunk(4));
  check(dunk1, "dunked east unit 4 into pond");
  await page.waitForFunction(() => window.__HAYHEM__.G.units[4].out, { timeout: 8000 });
  const wout = await page.evaluate(() => ({ out: window.__HAYHEM__.G.units[4].out, outs: window.__HAYHEM__.G.outs[1], text: document.getElementById("eastVal").textContent }));
  check(wout.out, "pond water-out marked unit out");
  check(wout.outs >= 1 && /out/i.test(wout.text), "scoreboard shows east out (" + wout.text + ")");
  const win = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    for (const u of H.G.units) if (u.team === 1 && !u.out) H.forceWaterOut(u.id);
    return { winner: H.G.winner, phase: H.phase, banner: document.getElementById("win").classList.contains("on") };
  });
  check(win.winner === 0 && win.phase === "won", "west wins when all east out");
  check(win.banner, "win banner shown");
  await page.click("#againBtn");
  await waitPhase(page, "aim");
  const reset = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    return { units: H.G.units.filter(u => !u.out).length, voxels: H.voxelCount(), phase: H.phase };
  });
  check(reset.units === 6 && reset.phase === "aim", "PLAY AGAIN resets 6 units in, phase aim");
  check(reset.voxels > 800, "voxels restored (" + reset.voxels + ")");

  // ── 8) PORTRAIT framing (390×844) — OVERVIEW mode frames the whole island ──
  console.log("\n[8] portrait framing 390×844 (overview)");
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("resize"));
    window.__HAYHEM__.startMatch();
    window.__HAYHEM__.forceCamMode("overview", true);
  });
  await waitPhase(page, "aim");
  await sleep(150);
  const port = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.forceCamMode("overview", true);
    const vw = window.innerWidth, vh = window.innerHeight;
    const pts = H.G.units.map(u => H.unitScreenPos(u.id));
    const margin = 24;
    const inside = pts.every(p => p && p.x >= margin && p.x <= vw - margin && p.y >= 46 + margin && p.y <= vh - margin);
    const cards = ["teamWest", "teamEast"].map(id => document.getElementById(id).getBoundingClientRect().top);
    return { inside, cardsTop: cards, mode: H.camMode };
  });
  check(port.mode === "overview", "overview forced for framing check");
  check(port.inside, "all 6 spawns inside portrait viewport with ≥24px margin (overview)");
  check(port.cardsTop.every(y => y >= 46), "HUD team cards below the 46px bar (tops " + port.cardsTop.map(v => Math.round(v)).join(",") + ")");
  // 3rd-person portrait pose: enemy yard + pond must be in frame
  const portAim = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.forceCamMode("aim", true);
    const vw = window.innerWidth, vh = window.innerHeight;
    const foes = H.G.units.filter(x => x.team === 1 && !x.out).map(u => H.unitScreenPos(u.id));
    const cam = H.camInfo();
    const foesIn = foes.every(p => p && p.x >= 8 && p.x <= vw - 8 && p.y >= 46 && p.y <= vh - 8);
    return { foesIn, mode: cam.mode };
  });
  check(portAim.foesIn, "portrait 3rd-person pose keeps the enemy yard in frame");

  // ── 9) DESKTOP framing (1280×720, overview) ──
  console.log("\n[9] desktop framing 1280×720 (overview)");
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.evaluate(() => { window.dispatchEvent(new Event("resize")); window.__HAYHEM__.startMatch(); });
  await waitPhase(page, "aim");
  await sleep(150);
  const desk = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.forceCamMode("overview", true);
    const vw = window.innerWidth, vh = window.innerHeight, margin = 24;
    const pts = H.G.units.map(u => H.unitScreenPos(u.id));
    return { inside: pts.every(p => p && p.x >= margin && p.x <= vw - margin && p.y >= 46 + margin && p.y <= vh - margin) };
  });
  check(desk.inside, "all 6 spawns inside desktop viewport with ≥24px margin (overview)");
  const deskAim = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.forceCamMode("aim", true);
    const vw = window.innerWidth, vh = window.innerHeight;
    const foes = H.G.units.filter(x => x.team === 1 && !x.out).map(u => H.unitScreenPos(u.id));
    return { foesIn: foes.every(p => p && p.x >= 8 && p.x <= vw - 8 && p.y >= 46 && p.y <= vh - 8) };
  });
  check(deskAim.foesIn, "desktop 3rd-person pose keeps the enemy yard in frame");

  // ── 10) TAP-TO-AIM + sliders + FIRE / Space ──
  console.log("\n[10] tap-to-aim + sliders + FIRE");
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  const tap = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const c = document.querySelector("#stage canvas");
    function ptr(type, x, y, buttons) {
      c.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 3, pointerType: "mouse", isPrimary: true, button: 0, buttons }));
    }
    // tap near enemy unit 3 (off-center so yaw is measurable), then near unit 5
    const s1 = H.unitScreenPos(3), s2 = H.unitScreenPos(5);
    ptr("pointerdown", s1.x, s1.y, 1); ptr("pointerup", s1.x, s1.y, 0);
    const p1 = H.getAim().point;
    const az1 = H.getAim().az;
    const o = H.muzzleOf(H.activeUnitId);
    const wantAz1 = Math.atan2(p1.z - o.z, p1.x - o.x);
    ptr("pointerdown", s2.x, s2.y, 1); ptr("pointerup", s2.x, s2.y, 0);
    const p2 = H.getAim().point;
    const az2 = H.getAim().az;
    const t3 = H.critters[3].bodies.torso.position, t5 = H.critters[5].bodies.torso.position;
    return {
      p1, p2, az1, az2, wantAz1,
      d1: Math.hypot(p1.x - t3.x, p1.z - t3.z),
      d2: Math.hypot(p2.x - t5.x, p2.z - t5.z),
      flag: H.getAim().flagVisible, arc: H.getAim().arcVisible
    };
  });
  check(tap.d1 < 2.5, "tap on the battlefield sets the aim point near the tap (d=" + tap.d1.toFixed(2) + ")");
  check(Math.abs(tap.az1 - tap.wantAz1) < 0.02, "yaw = shooter→tapped-point direction");
  check(tap.d2 < 2.5 && Math.abs(tap.az2 - tap.az1) > 0.05, "second tap moves the aim point + yaw (Δaz=" + Math.abs(tap.az2 - tap.az1).toFixed(2) + ")");
  check(tap.flag && tap.arc, "target flag + preview stub visible while aiming");
  // sliders map to pitch/power
  const sl = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const lo = H.setSliders(0.0, 0.0);
    const hi = H.setSliders(1.0, 1.0);
    return { loPitch: lo.pitch, loPow: lo.power, hiPitch: hi.pitch, hiPow: hi.power };
  });
  check(Math.abs(sl.loPitch - 10 * Math.PI / 180) < 0.01 && Math.abs(sl.hiPitch - 70 * Math.PI / 180) < 0.01,
    "HEIGHT slider maps pitch 10°→70°");
  check(sl.loPow < 0.01 && Math.abs(sl.hiPow - 26) < 0.01, "POWER slider maps 0→MAX_POWER");
  // FIRE with near-zero power refuses gently
  const lowPow = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setSliders(0.5, 0.01);
    const before = H.G.shotCount;
    document.getElementById("fireBtn").click();
    return { before, after: H.G.shotCount, phase: H.phase, projs: H.G.projectiles.length };
  });
  check(lowPow.after === lowPow.before && lowPow.projs === 0 && lowPow.phase === "aim", "near-zero power FIRE refuses gently");
  // FIRE button fires
  const fired = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setSliders(0.5, 0.6);
    const before = H.G.shotCount;
    document.getElementById("fireBtn").click();
    return { before, after: H.G.shotCount, phase: H.phase, projs: H.G.projectiles.length };
  });
  check(fired.after > fired.before && (fired.projs > 0 || fired.phase !== "aim"), "FIRE button fires");
  await waitResolve(page, 25000);
  // Space fires (fresh match so it's the player's turn)
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  const spaceFire = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setSliders(0.5, 0.6);
    const before = H.G.shotCount;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true, repeat: false }));
    return { before, after: H.G.shotCount, projs: H.G.projectiles.length, phase: H.phase };
  });
  check(spaceFire.after > spaceFire.before || spaceFire.projs > 0 || spaceFire.phase === "flying", "Space fires");
  await waitResolve(page, 25000);

  // ── 11) AMMO system ──
  console.log("\n[11] ammo system");
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  // helper: find + fire a bank-landing shot with the SELECTED ammo, return voxels carved
  async function fireBankShot(ammoType) {
    const found = await page.evaluate((type) => {
      const H = window.__HAYHEM__;
      H.setAmmo(type);
      H.setWind(0);
      let best = null;
      for (let pw = 24; pw >= 10 && !best; pw -= 0.5) {
        for (let pd = 24; pd <= 60; pd += 2) {
          const pit = pd * Math.PI / 180, dir = [Math.cos(pit), Math.sin(pit), 0];
          const ps = H.previewShot(pw, dir[0], dir[1], dir[2]);
          if (ps.endKind === "carve" && ps.end.x > 3.4 && ps.end.x < 10) { best = { pw, dir }; break; }
        }
      }
      if (!best) return null;
      const before = H.voxelCount();
      H.fireAt(best.pw, best.dir[0], best.dir[1], best.dir[2]);
      return { before };
    }, ammoType);
    if (!found) return null;
    await page.waitForFunction(() => window.__HAYHEM__.G.projectiles.length === 0, { timeout: 20000 });
    const carved = await page.evaluate((b) => b - window.__HAYHEM__.voxelCount(), found.before);
    await waitResolve(page, 25000);
    return carved;
  }
  const selMelon = await page.evaluate(() => window.__HAYHEM__.setAmmo("melon"));
  check(selMelon === "melon", "selector: setAmmo('melon') → G reflects selection");
  const chipOn = await page.evaluate(() => document.getElementById("chip_melon").classList.contains("on"));
  check(chipOn, "melon chip highlighted when selected");
  const pumpkinCarve = await fireBankShot("pumpkin");
  check(pumpkinCarve != null && pumpkinCarve > 0, "pumpkin bank shot carved " + pumpkinCarve + " voxels");
  // melon next (west turn again after AI's turn — waitResolve already cycled once; force fresh match)
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  const melonCarve = await fireBankShot("melon");
  check(melonCarve != null && melonCarve > pumpkinCarve * 1.5,
    "melon carves measurably more than pumpkin (" + melonCarve + " vs " + pumpkinCarve + ")");
  const melonCount = await page.evaluate(() => window.__HAYHEM__.ammoCounts()[0].melon);
  check(melonCount === 2, "melon count decremented 3→2 after firing");
  const melonChipTxt = await page.evaluate(() => document.getElementById("chip_melon").textContent);
  check(/×2/.test(melonChipTxt), "melon chip shows ×2 (" + melonChipTxt + ")");
  // depletion → chip disabled + selection falls back to pumpkin
  const depleted = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setAmmo("melon");
    H.setAmmoCount(0, "melon", 0);
    return {
      disabled: document.getElementById("chip_melon").disabled,
      sel: H.G.selAmmo[0]
    };
  });
  check(depleted.disabled, "melon chip disabled at 0");
  check(depleted.sel === "pumpkin", "selection falls back to pumpkin when depleted");
  // egg splits at apex into 3 projectiles, then the turn still resolves
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setAmmo("egg");
    H.setWind(0);
    const pit = 58 * Math.PI / 180;
    H.fireAt(17, Math.cos(pit), Math.sin(pit), 0);
  });
  await page.waitForFunction(() => window.__HAYHEM__.G.projectiles.length === 3, { timeout: 10000 });
  check(true, "egg split at apex into 3 projectiles (G.projectiles hit 3 mid-flight)");
  await waitResolve(page, 25000);
  const eggAfter = await page.evaluate(() => ({
    projs: window.__HAYHEM__.G.projectiles.length, phase: window.__HAYHEM__.phase,
    egg: window.__HAYHEM__.ammoCounts()[0].egg
  }));
  check(eggAfter.projs === 0 && (eggAfter.phase === "aim" || eggAfter.phase === "won"), "egg-trio turn resolved cleanly");
  check(eggAfter.egg === 2, "egg count decremented 3→2");

  // ── 12) CAMERA FLOW: aim → fire → AFTERMATH HOLD → overview ≥2s → AI 3rd person → clearance ──
  console.log("\n[12] camera flow + aftermath hold");
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  const cmStart = await page.evaluate(() => window.__HAYHEM__.camMode);
  check(cmStart === "overview" || cmStart === "fly", "restart begins in overview (" + cmStart + ")");
  // install per-frame ground-clearance sampler for the whole cycle
  await page.evaluate(() => {
    window.__clrMin = 999;
    (function loop() {
      try {
        const H = window.__HAYHEM__;
        if (H && H.phase !== "title") {
          const c = H.camInfo();
          const g = H.groundAt(c.pos[0], c.pos[2]);
          window.__clrMin = Math.min(window.__clrMin, c.pos[1] - g);
        }
      } catch (_) {}
      requestAnimationFrame(loop);
    })();
  });
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "aim", { timeout: 9000 });
  // fire a shot that RAGDOLLS a victim (direct-hit solution on unit 4)
  await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setAmmo("pumpkin");
    H.setWind(0);
    const o = H.muzzleOf(H.activeUnitId);
    const tp = H.critters[4].bodies.torso.position;
    const bearing = Math.atan2(tp.z - o.z, tp.x - o.x);
    let best = null;
    for (let pw = 8; pw <= 26; pw += 0.5) {
      for (let pd = 16; pd <= 70; pd += 2) {
        const pit = pd * Math.PI / 180;
        const dir = [Math.cos(pit) * Math.cos(bearing), Math.sin(pit), Math.cos(pit) * Math.sin(bearing)];
        const pts = H.simulate(pw, dir[0], dir[1], dir[2]);
        for (const p of pts) {
          const d = Math.hypot(p.x - tp.x, p.y - tp.y, p.z - tp.z);
          if (!best || d < best.d) best = { d, pw, dir };
        }
      }
    }
    H.fireAt(best.pw, best.dir[0], best.dir[1], best.dir[2]);
  });
  // AFTERMATH: right after impact, camera must STAY on the action (aim mode),
  // not cut to overview, while the victim is still flopping
  await page.waitForFunction(() => {
    const H = window.__HAYHEM__;
    return H.G.projectiles.length === 0 && H.phase === "settling";
  }, { timeout: 15000 });
  const aftermath = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    return {
      cam: H.camMode,
      ragdolls: H.G.units.filter(u => u.mode === "ragdoll" || u.mode === "out").length,
      settleT: H.G.settleT
    };
  });
  check(aftermath.ragdolls >= 1, "victim ragdolled by the shot (" + aftermath.ragdolls + ")");
  check(aftermath.cam === "aim", "AFTERMATH HOLD: camera does NOT cut to overview during settling (cam=" + aftermath.cam + ")");
  // then the overview interlude (≥2s), then the AI's 3rd-person turn
  await page.waitForFunction(() => window.__HAYHEM__.camMode === "overview", { timeout: 15000 });
  const tOv = Date.now();
  await page.waitForFunction(() => window.__HAYHEM__.camMode !== "overview", { timeout: 15000 });
  const ovMs = Date.now() - tOv;
  check(ovMs >= 1900, "overview interlude ≥2s after the aftermath (" + ovMs + "ms)");
  await page.waitForFunction(() => {
    const H = window.__HAYHEM__;
    return H.camMode === "aim" && H.activeTeam === 1;
  }, { timeout: 15000 });
  const aiCam = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const u = H.G.units.find(x => x.id === H.activeUnitId);
    const c = H.camInfo();
    return { team: u.team, dist: Math.hypot(u.x - c.pos[0], u.y - c.pos[1], u.z - c.pos[2]) };
  });
  check(aiCam.team === 1, "AI turn stays in 3rd person behind the AI shooter");
  check(aiCam.dist < 10, "AI aim camera within 10 of the AI unit (dist " + aiCam.dist.toFixed(1) + ")");
  // AI fires on its own (no aiFireNow) → full cycle back to west aim
  await page.waitForFunction(() => {
    const H = window.__HAYHEM__;
    return (H.activeTeam === 0 && H.phase === "aim") || H.phase === "won";
  }, { timeout: 40000 });
  const clr = await page.evaluate(() => window.__clrMin);
  check(clr > 0.5, "camera stayed above terrain through the full west+east cycle (min clearance " + clr.toFixed(2) + ")");

  // ── 13) PLAYER CAMERA ORBIT + ammo-switch invariance ──
  console.log("\n[13] camera orbit + ammo-switch invariance");
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => { const H = window.__HAYHEM__; return H.camMode === "aim" && H.activeTeam === 0; }, { timeout: 9000 });
  await sleep(140);

  // (a) AMMO-SWITCH INVARIANCE: switching ammo leaves the whole shot bit-identical
  const ammoInv = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const c = document.querySelector("#stage canvas");
    H.setSliders(0.5, 0.6);
    const s = H.unitScreenPos(4);   // concrete world aim point via a real left tap
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: s.x, clientY: s.y, pointerId: 61, pointerType: "mouse", button: 0, buttons: 1, isPrimary: true }));
    c.dispatchEvent(new PointerEvent("pointerup",   { bubbles: true, cancelable: true, clientX: s.x, clientY: s.y, pointerId: 61, pointerType: "mouse", button: 0, buttons: 0, isPrimary: true }));
    function snap() {
      const a = H.getAim();
      return { px: a.point.x, py: a.point.y, pz: a.point.z, az: a.az, pitch: a.pitch, power: a.power,
        hT: a.heightT, pT: a.powerT, hv: document.getElementById("heightSlider").value, pv: document.getElementById("powerSlider").value };
    }
    const rec = snap();
    const pumpkinArc = H.previewPts();
    H.setAmmo("melon"); const m = snap();
    const melonArc = H.previewPts();
    H.setAmmo("egg");   const e = snap();
    H.setAmmo("pumpkin"); const p = snap();
    return { rec, m, e, p, pumpkinArc, melonArc };
  });
  function eqSnap(a, b) {
    return a.px === b.px && a.py === b.py && a.pz === b.pz && a.az === b.az && a.pitch === b.pitch &&
      a.power === b.power && a.hT === b.hT && a.pT === b.pT && a.hv === b.hv && a.pv === b.pv;
  }
  check(eqSnap(ammoInv.rec, ammoInv.m) && eqSnap(ammoInv.rec, ammoInv.e) && eqSnap(ammoInv.rec, ammoInv.p),
    "ammo switch (melon→egg→pumpkin) leaves aim point, yaw, pitch, power, both sliders bit-identical");
  const arcDiff = (function () {
    const a = ammoInv.pumpkinArc, b = ammoInv.melonArc, n = Math.min(a.length, b.length); let mx = 0;
    for (let i = 0; i < n; i++) { const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y, a[i].z - b[i].z); if (d > mx) mx = d; }
    return mx;
  })();
  check(arcDiff > 0.5, "physics honesty: pumpkin vs melon preview arcs differ at identical settings (Δ=" + arcDiff.toFixed(2) + ")");

  // baseline aim + camera azimuth for the orbit tests (orbit must start clean)
  const base = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.resetOrbit();
    const a = H.getAim();
    return { point: a.point, az: a.az, pitch: a.pitch, power: a.power, heightT: a.heightT, powerT: a.powerT,
      stub0: H.previewStubPts()[0], camAz: H.camAzimuth(), orbit: H.camOrbit };
  });
  check(base.point && Math.abs(base.orbit.az) < 1e-9 && Math.abs(base.orbit.el) < 1e-9, "orbit starts clean at a fresh aim pose");

  // (b) DESKTOP RIGHT-DRAG → orbit; aim + sliders + preview stub[0] untouched; contextmenu prevented
  const rdrag = await page.evaluate((base) => {
    const H = window.__HAYHEM__;
    const c = document.querySelector("#stage canvas");
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const notPrevented = c.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 11, pointerType: "mouse", button: 2, buttons: 2 }));
    for (let i = 1; i <= 6; i++) c.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: cx + i * 20, clientY: cy + i * 4, pointerId: 11, pointerType: "mouse", button: 2, buttons: 2 }));
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: cx + 120, clientY: cy + 24, pointerId: 11, pointerType: "mouse", button: 2, buttons: 0 }));
    const a = H.getAim();
    return { orbit: H.camOrbit, contextmenuPrevented: !notPrevented,
      point: a.point, az: a.az, heightT: a.heightT, powerT: a.powerT, stub0: H.previewStubPts()[0] };
  }, base);
  check(rdrag.contextmenuPrevented, "canvas contextmenu default prevented");
  check(Math.abs(rdrag.orbit.az) > 0.3, "right-drag changed orbit azimuth (" + rdrag.orbit.az.toFixed(2) + ")");
  check(rdrag.point.x === base.point.x && rdrag.point.z === base.point.z && rdrag.az === base.az, "right-drag left aim point + yaw untouched");
  check(rdrag.heightT === base.heightT && rdrag.powerT === base.powerT, "right-drag left both sliders untouched");
  check(Math.abs(rdrag.stub0.x - base.stub0.x) < 1e-9 && Math.abs(rdrag.stub0.z - base.stub0.z) < 1e-9, "right-drag left preview stub first point untouched");
  await sleep(500);
  const rcam = await page.evaluate((baseAz) => {
    const H = window.__HAYHEM__;
    let d = H.camAzimuth() - baseAz; d = Math.atan2(Math.sin(d), Math.cos(d));
    return { dAz: Math.abs(d) };
  }, base.camAz);
  check(rcam.dAz > 0.2, "camera azimuth swung measurably around the shooter (Δ=" + rcam.dAz.toFixed(2) + ")");

  // (c) MOBILE TWO-FINGER DRAG → orbit; aim point untouched during + after
  const tdrag = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.resetOrbit();
    const c = document.querySelector("#stage canvas");
    const r = c.getBoundingClientRect();
    const x1 = r.left + r.width * 0.4, x2 = r.left + r.width * 0.6, y = r.top + r.height * 0.5;
    const before = H.getAim();
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x1, clientY: y, pointerId: 21, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 }));
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x2, clientY: y, pointerId: 22, pointerType: "touch", isPrimary: false, button: 0, buttons: 1 }));
    for (let i = 1; i <= 6; i++) {
      c.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: x1 + i * 18, clientY: y, pointerId: 21, pointerType: "touch", buttons: 1 }));
      c.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: x2 + i * 18, clientY: y, pointerId: 22, pointerType: "touch", buttons: 1 }));
    }
    const during = H.getAim();
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x1 + 108, clientY: y, pointerId: 21, pointerType: "touch", buttons: 0 }));
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x2 + 108, clientY: y, pointerId: 22, pointerType: "touch", buttons: 0 }));
    return { orbit: H.camOrbit, before, during, after: H.getAim() };
  });
  check(Math.abs(tdrag.orbit.az) > 0.3, "two-finger drag changed orbit azimuth (" + tdrag.orbit.az.toFixed(2) + ")");
  check(tdrag.during.point.x === tdrag.before.point.x && tdrag.during.point.z === tdrag.before.point.z && tdrag.during.az === tdrag.before.az, "two-finger drag left aim point + yaw untouched (during)");
  check(tdrag.after.point.x === tdrag.before.point.x && tdrag.after.point.z === tdrag.before.point.z && tdrag.after.az === tdrag.before.az, "two-finger aim unchanged (after)");

  // (d) a 1-finger tap that gains a 2nd finger then releases does NOT move the aim point
  const tapCancel = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.resetOrbit();
    const c = document.querySelector("#stage canvas");
    const r = c.getBoundingClientRect();
    const before = H.getAim().point;
    const x1 = r.left + r.width * 0.3, y1 = r.top + r.height * 0.55;
    const x2 = r.left + r.width * 0.7, y2 = r.top + r.height * 0.55;
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x1, clientY: y1, pointerId: 31, pointerType: "touch", isPrimary: true, buttons: 1 }));
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: x2, clientY: y2, pointerId: 32, pointerType: "touch", isPrimary: false, buttons: 1 }));
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x2, clientY: y2, pointerId: 32, pointerType: "touch", buttons: 0 }));
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: x1, clientY: y1, pointerId: 31, pointerType: "touch", buttons: 0 }));
    return { before, after: H.getAim().point };
  });
  check(tapCancel.after.x === tapCancel.before.x && tapCancel.after.z === tapCancel.before.z, "1-finger tap that gains a 2nd finger does NOT move the aim point");

  // (e) ELEVATION CLAMP at extreme vertical drag + terrain clearance at the worst angle
  await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.resetOrbit();
    const c = document.querySelector("#stage canvas");
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 41, pointerType: "mouse", button: 2, buttons: 2 }));
    for (let i = 1; i <= 40; i++) c.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: cx, clientY: cy + i * 30, pointerId: 41, pointerType: "mouse", button: 2, buttons: 2 }));
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: cx, clientY: cy + 1200, pointerId: 41, pointerType: "mouse", button: 2, buttons: 0 }));
  });
  await sleep(500);
  const elres = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const el = H.camElevation(), c = H.camInfo(), g = H.groundAt(c.pos[0], c.pos[2]);
    return { elDeg: el * 180 / Math.PI, clearance: c.pos[1] - g };
  });
  check(elres.elDeg > 55 && elres.elDeg <= 82, "extreme vertical drag clamps elevation below overhead (" + elres.elDeg.toFixed(0) + "°)");
  check(elres.clearance > 0.5, "camera stays above terrain while orbited to the worst angle (clearance " + elres.clearance.toFixed(2) + ")");

  // (f) right-drag during OVERVIEW does not orbit
  const ovOrbit = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.resetOrbit();
    H.forceCamMode("overview", true);   // playerCanAim() now false
    const c = document.querySelector("#stage canvas");
    const r = c.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 51, pointerType: "mouse", button: 2, buttons: 2 }));
    for (let i = 1; i <= 6; i++) c.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, cancelable: true, clientX: cx + i * 25, clientY: cy, pointerId: 51, pointerType: "mouse", button: 2, buttons: 2 }));
    c.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, clientX: cx + 150, clientY: cy, pointerId: 51, pointerType: "mouse", button: 2, buttons: 0 }));
    return { orbit: H.camOrbit };
  });
  check(Math.abs(ovOrbit.orbit.az) < 1e-9 && Math.abs(ovOrbit.orbit.el) < 1e-9, "right-drag during overview/flying does not orbit");

  // (g) orbit offset RESETS for the next unit's turn
  const resetRes = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.orbitBy(0.9, 0.2);
    const dirty = H.camOrbit.az;
    H.endTurnNow();   // resolve → next shooter (beginTurn resets orbit synchronously)
    return { dirty, after: H.camOrbit };
  });
  check(Math.abs(resetRes.dirty) > 0.5 && resetRes.after.az === 0 && resetRes.after.el === 0,
    "orbit offset resets for the next unit's turn (camera returns to default pose)");

  // ── 14) 0 pageerrors ──
  console.log("\n[14] errors");
  check(errors.length === 0, "0 pageerrors" + (errors.length ? ": " + errors.join("; ") : ""));

  console.log("\nHayhem2 integration smoke: PASS (" + PASS + " checks)");
  await browser.close();
  if (server) server.kill();
  process.exit(0);
}
main().catch(async (err) => { console.error("\n" + err.message); process.exitCode = 1; process.exit(1); });
