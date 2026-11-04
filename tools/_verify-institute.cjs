#!/usr/bin/env node
"use strict";
/**
 * Institute Grounds suite: institute.html, the scale model of the Red Rising war-game
 * grounds.
 *
 *   node tools/_verify-institute.cjs
 *   node tools/_verify-institute.cjs --page=/abs/path/to/mutant.html   (bite runs)
 *
 * Hermetic: the page loads three r128 from jsdelivr. Here those URLs are fulfilled from
 * assets/vendor/, and every other off-host request is aborted and counted as a failure.
 * The page has no Firebase, so nothing here can touch production.
 *
 * What is checked, and why:
 *  - The geography the books state, as relations between traced map points: Jupiter in
 *    the northwest, Juno and Vulcan west of the Argos, Ceres and Mercury east of it, Diana
 *    southeast of Mars and southwest of Minerva, and so on. A wrong trace shows up here.
 *  - Hand-computed distances in metres from the 65 m/px scale.
 *  - Olympus floats exactly 2 km above the ground beneath it (Red Rising ch. 42),
 *    measured from the mesh bounds, not from the config number.
 *  - Every castle sits on the terrain that is actually drawn, at relief x1 and x2.
 *    A floating or buried castle is the bug most likely to sneak past a quick look.
 *  - Rivers never run uphill, and the Argos ends in the South Sea.
 *  - The scale bar's arithmetic, and that the info panel's hidden state is real geometry.
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const PAGE_ARG = (process.argv.find(a => a.startsWith("--page=")) || "").slice(7);
const PAGE_FILE = PAGE_ARG ? path.resolve(PAGE_ARG) : path.join(ROOT, "institute.html");
const PORT = 8961;
const BASE = `http://127.0.0.1:${PORT}`;
const VENDOR = {
  "build/three.min.js": "three-r128.min.js",
  "examples/js/controls/OrbitControls.js": "three-r128-OrbitControls.js",
  "examples/js/utils/BufferGeometryUtils.js": "three-r128-BufferGeometryUtils.js",
};

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name) => {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; failures.push(name); console.log("  ✗ FAIL " + name); }
};
const section = (t) => console.log("\n=== " + t + " ===");
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function serve(){
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = decodeURIComponent(req.url.split("?")[0]);
      const file = p === "/institute.html" || p === "/" ? PAGE_FILE : path.join(ROOT, p);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.statusCode = 404; return res.end("not found"); }
      res.setHeader("content-type", file.endsWith(".html") ? "text/html" : "text/javascript");
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, "127.0.0.1", () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const errors = [], offHost = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.route("**/*", (route) => {
    const u = route.request().url();
    const cdn = "https://cdn.jsdelivr.net/npm/three@0.128.0/";
    if (u.startsWith(cdn) && VENDOR[u.slice(cdn.length)])
      return route.fulfill({ path: path.join(ROOT, "assets/vendor", VENDOR[u.slice(cdn.length)]), contentType: "text/javascript" });
    if (u.startsWith(BASE)) return route.continue();
    offHost.push(u); return route.abort();
  });
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  try {
    await page.goto(BASE + "/institute.html");
    await page.waitForFunction(() => window.__institute && window.__institute.ready, null, { timeout: 120000 });

    /* ------------------------------------------------------------------ */
    section("twelve houses, Olympus, the outposts");
    const data = await page.evaluate(() => {
      const I = window.__institute;
      return {
        houses: I.HOUSES.map(h => ({ id: h.id, name: h.name, px: h.px, py: h.py, pad: h.pad })),
        towers: I.TOWERS.map(t => ({ id: t.id, px: t.px, py: t.py })),
        mPerPx: I.M_PER_PX,
        counts: I.counts,
        landmarkIds: Object.keys(I.landmarks),
      };
    });
    const names = data.houses.map(h => h.name).sort();
    const EXPECT = ["Apollo","Bacchus","Ceres","Diana","Juno","Jupiter","Mars","Mercury","Minerva","Pluto","Venus","Vulcan"].map(n => "House " + n);
    ok(JSON.stringify(names) === JSON.stringify(EXPECT), "exactly the twelve houses of the Mars Institute: " + names.length);
    ok(new Set(data.houses.map(h => h.px + "," + h.py)).size === 12, "twelve distinct castle sites (one per map marker)");
    for (const id of ["olympus","phobos","deimos", ...data.houses.map(h => h.id)])
      ok(data.landmarkIds.includes(id), `landmark built: ${id}`);
    ok(data.counts.apolloTowers === 6, `Apollo: six spiralling towers (got ${data.counts.apolloTowers})`);
    ok(data.counts.dianaPlatforms >= 5, `Diana: platforms up in the godTrees (got ${data.counts.dianaPlatforms})`);
    ok(data.counts.plutoPortals >= 1, "Pluto: tunnel mouths, the fortress being underground");
    ok(data.counts.vulcanChimneys >= 1, "Vulcan: forge chimneys");

    /* ------------------------------------------------------------------ */
    section("geography the books state");
    const geo = await page.evaluate(() => {
      const I = window.__institute, H = Object.fromEntries(I.HOUSES.map(h => [h.id, h]));
      const sd = (h, poly) => I.sdPoly(h.px, h.py, poly);
      return {
        H,
        argosAt: Object.fromEntries(I.HOUSES.map(h => [h.id, I.riverXAt("argos", h.py)])),
        sdSea: Object.fromEntries(I.HOUSES.map(h => [h.id, sd(h, I.SEA)])),
        sdGreat: Object.fromEntries(I.HOUSES.map(h => [h.id, sd(h, I.GREATWOODS)])),
        sdMtn: Object.fromEntries(I.HOUSES.map(h => [h.id, sd(h, I.MOUNTAINS)])),
        sdHigh: Object.fromEntries(I.HOUSES.map(h => [h.id, sd(h, I.HIGHLANDS)])),
        ground: Object.fromEntries(I.HOUSES.map(h => [h.id, I.heightAt(h.px, h.py)])),
        seaNorthOfVenus: I.sdPoly(H.venus.px, H.venus.py - 45, I.SEA),
        confluence: I.RIVERS.find(r => r.id === "metas").pts.slice(-1)[0],
      };
    });
    const { H } = geo;
    ok(H.jupiter.px === Math.min(...Object.values(H).map(h => h.px)) && H.jupiter.py === Math.min(...Object.values(H).map(h => h.py)),
       "Jupiter is the northwest corner castle (westmost and northmost)");
    ok(geo.sdMtn.jupiter < 0, "Jupiter sits inside the western mountains");
    ok(geo.sdMtn.pluto < 0 && geo.ground.pluto > 600, `Pluto is under the mountains (ground ${Math.round(geo.ground.pluto)} m)`);
    ok(H.pluto.py > H.jupiter.py, "Pluto lies south of Jupiter in the range");
    for (const id of ["juno","vulcan"]) ok(H[id].px < geo.argosAt[id], `${id} is on the west bank of the Argos (${H[id].px} < ${geo.argosAt[id].toFixed(1)})`);
    for (const id of ["ceres","mercury"]) ok(H[id].px > geo.argosAt[id], `${id} is east of the Argos (${H[id].px} > ${geo.argosAt[id].toFixed(1)})`);
    ok(Math.abs(H.vulcan.px - geo.argosAt.vulcan) < 30 && Math.abs(H.mercury.px - geo.argosAt.mercury) < 50, "Vulcan and Mercury face each other across the river");
    ok(H.juno.px < H.ceres.px && H.juno.px < H.mars.px, "Juno is west of Ceres and Mars");
    ok(geo.sdHigh.mars < 0, "Mars is in the Highlands");
    ok(H.mars.py < 200, "Mars is in the north of the grounds");
    ok(H.diana.px > H.mars.px && H.diana.py > H.mars.py, "Diana is southeast of the Highlands and Mars");
    ok(H.diana.px < H.minerva.px && H.diana.py > H.minerva.py, "Diana is southwest of Minerva");
    ok(geo.sdGreat.diana < 0, "Diana is inside the Greatwoods");
    ok(H.minerva.px > H.mars.px && H.minerva.py < 250, "Minerva is in the northeast");
    ok(H.apollo.px > H.diana.px && H.apollo.py > H.diana.py && geo.sdGreat.apollo < 25, "Apollo is at the southeast edge of the Greatwoods");
    ok(geo.sdSea.apollo > 0 && H.apollo.py < 520, "Apollo is north of the South Sea");
    ok(geo.sdSea.bacchus > 0 && geo.sdSea.bacchus < 30 && Math.abs(geo.sdGreat.bacchus) < 30, "Bacchus is on the shore at the southwest edge of the Greatwoods");
    ok(geo.sdSea.venus > 0 && geo.seaNorthOfVenus < 0, "Venus is on land with the South Sea to its north");
    ok(H.ceres.py < 200 && Math.abs(H.ceres.px - geo.argosAt.ceres) < 60, "Ceres stands in the open beside the Argos in the north");
    ok(Object.values(geo.ground).every(g => g > 1), "no castle is under water");
    const [cx, cy] = geo.confluence, P = Object.fromEntries(data.towers.map(t => [t.id, t]));
    ok(cy > P.phobos.py && cy < P.deimos.py && Math.abs(cx - (P.phobos.px + P.deimos.px)/2) < 40,
       `the Furor/Metas confluence (${cx},${cy}) lies between Phobos and Deimos (ch. 21)`);
    ok(P.phobos.px < H.mars.px && P.deimos.px < H.mars.px, "both outposts are on the western side of the Highlands");

    /* ------------------------------------------------------------------ */
    section("scale arithmetic (65 m per map pixel)");
    // Hand-computed: Mars (597,115) to Ceres (375,150): sqrt(222^2 + 35^2) = 224.74 px -> 14,608 m
    const marsCeres = await page.evaluate(() => window.__institute.distanceKm("mars", "ceres"));
    ok(near(marsCeres, 14.608, 0.01), `Mars to Ceres is 14.61 km (got ${marsCeres.toFixed(3)})`);
    // Hand-computed: Jupiter (115,60) to Apollo (797,445): sqrt(682^2 + 385^2) = 783.17 px -> 50,906 m
    const jupApo = await page.evaluate(() => window.__institute.distanceKm("jupiter", "apollo"));
    ok(near(jupApo, 50.906, 0.02), `Jupiter to Apollo is 50.9 km (got ${jupApo.toFixed(3)})`);
    // Frame 12..850 x 12..612 px -> 54,470 m by 39,000 m
    const frame = await page.evaluate(() => { const I = window.__institute, a = I.toW(12,12), b = I.toW(850,612); return [b.x-a.x, b.z-a.z]; });
    ok(frame[0] === 54470 && frame[1] === 39000, `grounds measure 54.47 by 39.00 km (got ${frame.map(v=>v/1000).join(" by ")})`);

    /* ------------------------------------------------------------------ */
    section("Olympus floats two kilometres up (ch. 42)");
    const oly = await page.evaluate(() => {
      const I = window.__institute, L = I.landmarks.olympus;
      L.group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(L.group.children[0]);   // the rock underside
      const below = I.sampleTerrain(L.x, L.z);
      return { tip: box.min.y, below, top: new THREE.Box3().setFromObject(L.group).max.y };
    });
    ok(near(oly.tip - oly.below, 2000, 3), `underside tip is ${(oly.tip - oly.below).toFixed(1)} m above the ground below`);
    ok(oly.top - oly.tip > 1200, `a mountain, not a platform: ${Math.round(oly.top - oly.tip)} m tip to summit`);

    /* ------------------------------------------------------------------ */
    section("castles sit on the drawn terrain");
    const seat = async () => page.evaluate(() => {
      const I = window.__institute, ve = I.state.ve, out = {};
      for (const h of I.HOUSES.concat(I.TOWERS)){
        const L = I.landmarks[h.id];
        out[h.id] = { y: L.group.position.y, ground: I.sampleTerrain(L.x, L.z) * ve, pad: !!(h.pad || !h.where) };
      }
      return out;
    });
    let s1 = await seat();
    for (const [id, v] of Object.entries(s1)) if (v.pad) ok(near(v.y, v.ground, 1.5), `x1: ${id} base ${v.y.toFixed(1)} m on ground ${v.ground.toFixed(1)} m`);
    await page.evaluate(() => window.__institute.setVE(2));
    let s2 = await seat();
    for (const id of ["mars","apollo","jupiter","phobos"]) ok(near(s2[id].y, s2[id].ground, 3), `x2 relief: ${id} still on the ground (${s2[id].y.toFixed(0)} vs ${s2[id].ground.toFixed(0)})`);
    const oly2 = await page.evaluate(() => { const L = window.__institute.landmarks.olympus; return L.group.position.y / (L.ground + 2000); });
    ok(near(oly2, 2, 1e-6), "x2 relief stretches Olympus's height with the terrain");
    await page.evaluate(() => window.__institute.setVE(1));
    const diana = await page.evaluate(() => {
      const I = window.__institute, L = I.landmarks.diana; L.group.updateMatrixWorld(true);
      return new THREE.Box3().setFromObject(L.group).max.y - I.sampleTerrain(L.x, L.z);
    });
    ok(diana > 120, `Diana is up in trees taller than 120 m (got ${diana.toFixed(0)} m)`);

    /* ------------------------------------------------------------------ */
    section("rivers");
    const riv = await page.evaluate(() => {
      const I = window.__institute;
      return I.RIVERS.map(r => {
        let up = 0; for (let i=1;i<r.levels.length;i++) if (r.levels[i] > r.levels[i-1] + 1e-9) up++;
        const end = r.pts[r.pts.length-1];
        return { id: r.id, up, last: r.levels[r.levels.length-1], first: r.levels[0], endSea: I.sdPoly(end[0], end[1], I.SEA) };
      });
    });
    for (const r of riv) ok(r.up === 0, `${r.id} never runs uphill (${r.first.toFixed(0)} m to ${r.last.toFixed(0)} m)`);
    const argos = riv.find(r => r.id === "argos");
    ok(argos.endSea <= 5 && argos.last < 1.5, `the Argos ends in the South Sea at sea level (${argos.last.toFixed(2)} m)`);

    /* ------------------------------------------------------------------ */
    section("controls");
    await page.evaluate(() => window.__institute.setLS(5));
    ok(await page.evaluate(() => window.__institute.landmarks.mars.group.scale.x === 5 && window.__institute.landmarks.olympus.group.scale.x === 1),
       "Enlarge x5 scales castles but not Olympus, whose size is part of the scale");
    await page.evaluate(() => window.__institute.setLS(1));
    // The panel is position:fixed, and offsetParent is ALWAYS null for fixed elements, so the house
    // offsetParent check would pass vacuously here. Measure the box instead.
    const shown = () => page.evaluate(() => { const r = document.getElementById("info").getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    ok(!(await shown()), "info panel starts hidden (measured box, not the attribute)");
    await page.locator(".lbl.house", { hasText: "Mars" }).first().click();
    ok(await shown(), "clicking a castle name opens its panel");
    const txt = (await page.textContent("#infoBody")).replace(/\s+/g, " ");
    ok(/House Mars/.test(txt) && /Phobos/.test(txt) && /Assumed for the model/.test(txt), "panel separates the book from the assumptions");
    await page.click("#infoClose");
    ok(!(await shown()), "Close hides it again");

    await page.evaluate(() => { const I = window.__institute; I.camera.position.set(0, 62000, 1); I.controls.target.set(0,0,0); I.controls.update(); });
    await frames();
    const bar = await page.evaluate(() => {
      const I = window.__institute, d = I.camera.position.distanceTo(I.controls.target);
      const mPerPx = 2*d*Math.tan(THREE.MathUtils.degToRad(I.camera.fov/2))/innerHeight;
      // border-box: the 2px side borders are the bar's end ticks, so the drawn length is the full box width
      return { mPerPx, w: document.getElementById("scaleBar").getBoundingClientRect().width, txt: document.getElementById("scaleTxt").textContent };
    });
    const m = /([\d.]+) (km|m)/.exec(bar.txt), metres = m ? +m[1] * (m[2] === "km" ? 1000 : 1) : NaN;
    ok(near(bar.w * bar.mPerPx, metres, bar.mPerPx * 1.5), `scale bar: ${bar.w}px x ${bar.mPerPx.toFixed(1)} m/px = ${Math.round(bar.w*bar.mPerPx)} m, label "${bar.txt}"`);

    // A fly-to used to end with the camera inside the mountains at Jupiter, showing the sea plane
    // through the back of the terrain. Every castle's fly-to has to end above the ground.
    const under = await page.evaluate(async () => {
      const I = window.__institute, bad = [];
      for (const h of I.HOUSES){
        I.camera.position.set(-20000, 3000, 30000); I.controls.target.set(0,0,0);   // approach from the southwest
        I.flyToLandmark(h.id);
        await new Promise(r => setTimeout(r, 1700));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const p = I.camera.position, g = I.sampleTerrain(p.x, p.z);
        if (p.y < g + 20) bad.push(`${h.id} cam ${p.y.toFixed(0)} ground ${g.toFixed(0)}`);
      }
      return bad;
    });
    ok(under.length === 0, "every castle fly-to ends above the ground" + (under.length ? ": " + under.join(", ") : ""));

    /* ------------------------------------------------------------------ */
    section("Darrow's course (Red Rising ch. 19 to 44)");
    const dr = await page.evaluate(() => {
      const I = window.__institute, F = { x0: 12, x1: 850, y0: 12, y1: 612 };
      const where = id => id === "olympus" ? I.OLYMPUS : (I.HOUSES.find(h => h.id === id) || I.TOWERS.find(t => t.id === id));
      const stops = I.DARROW.map(s => ({ n: s.n, at: s.at || null, px: s.px, py: s.py, ch: s.ch, air: !!s.air, title: s.title,
        onLandmark: s.at ? (where(s.at).px === s.px && where(s.at).py === s.py) : null }));
      const legs = I.route.legs.map(l => ({ km: l.km, total: l.total, air: !!l.air, n: l.pts.length }));
      // every point of every walked leg: inside the grounds, out of the South Sea
      const wet = [], outside = [];
      I.route.legs.forEach((l, i) => { if (l.air) return; for (const p of l.pts){
        if (I.sdPoly(p.px, p.py, I.SEA) < 0) { wet.push(i+1); break; }
        if (p.px < F.x0 || p.px > F.x1 || p.py < F.y0 || p.py > F.y1) { outside.push(i+1); break; } } });
      return { stops, legs, wet, outside };
    });
    const S = dr.stops;
    ok(S.length === 30, `30 stops (got ${S.length})`);
    ok(S[0].at === "mars" && /^19/.test(S[0].ch), "it starts with the Passage beneath Castle Mars (ch. 19)");
    ok(S[S.length-1].at === "olympus", "it ends on Olympus");
    const chs = S.map(s => parseInt(s.ch, 10));
    ok(chs.every((c, i) => i === 0 || c >= chs[i-1]), "stops run in book order (chapters never go backwards)");
    ok(S.filter(s => s.at).every(s => s.onLandmark), "every stop tagged to a castle sits exactly on that castle");
    ok(dr.wet.length === 0, "no walked leg crosses the South Sea" + (dr.wet.length ? ": legs " + dr.wet.join(", ") : ""));
    ok(dr.outside.length === 0, "no walked leg leaves the grounds" + (dr.outside.length ? ": legs " + dr.outside.join(", ") : ""));
    // ch. 39: the army camps two kilometres from Castle Apollo.
    // Hand-computed: camp (767,437) to Apollo (797,445) = sqrt(30^2 + 8^2) = 31.05 px -> 2.018 km
    const camp = S.find(s => /Two kilometres/.test(s.title));
    const campKm = Math.hypot(camp.px - 797, camp.py - 445) * 65 / 1000;
    ok(near(campKm, 2.0, 0.25), `the camp before Apollo is two kilometres out (${campKm.toFixed(3)} km)`);
    // ch. 40: Apollo to Jupiter in four days. Straight line 50.9 km (hand-computed above); the march
    // has to be at least that, and no more than 25 km a day.
    const iApollo = S.findIndex(s => s.at === "apollo"), iJup = S.findIndex(s => s.at === "jupiter");
    const march = dr.legs.slice(iApollo + 1, iJup + 1).reduce((a, l) => a + l.km, 0);
    ok(march >= 50.9 && march <= 100, `Apollo to Jupiter march is ${march.toFixed(1)} km, ${(march/4).toFixed(1)} km a day`);
    ok(dr.legs.every((l, i) => i === 0 || near(l.total, dr.legs[i-1].total + l.km, 1e-9)), "the running total adds up leg by leg");
    ok(S.filter(s => s.air).every(s => ["olympus","mars"].includes(s.at)) && S.find(s => s.at === "olympus").air, "Olympus is only ever reached through the air");

    const drape = async () => page.evaluate(() => {
      const I = window.__institute, ve = I.state.ve; let worst = Infinity, at = "";
      I.route.legs.forEach((l, i) => { if (l.air) return; for (const p of l.pts){
        const w = I.toW(p.px, p.py), gap = I.routeY(l, p) - Math.max(0, I.sampleTerrain(w.x, w.z))*ve;
        if (gap < worst){ worst = gap; at = `leg ${i+1} at ${p.px.toFixed(0)},${p.py.toFixed(0)}`; } } });
      const L = I.route.legs[I.DARROW.findIndex(s => s.at === "olympus")], end = L.pts[L.pts.length-1];
      const O = I.landmarks.olympus, top = O.group.position.y + O.topLocal;
      return { worst, at, olyGap: I.routeY(L, end) - top };
    });
    let dp = await drape();
    ok(dp.worst > 5, `x1: the path rides above the drawn ground everywhere (lowest ${dp.worst.toFixed(1)} m, ${dp.at})`);
    ok(near(dp.olyGap, 25, 0.5), `x1: the flight lands on Olympus's summit (${dp.olyGap.toFixed(1)} m above it)`);
    await page.evaluate(() => window.__institute.setVE(3));
    dp = await drape();
    ok(dp.worst > 5, `x3 relief: path still above the ground (lowest ${dp.worst.toFixed(1)} m)`);
    ok(near(dp.olyGap, 25, 0.5), `x3 relief: the flight still lands on the summit (${dp.olyGap.toFixed(1)} m)`);
    await page.evaluate(() => window.__institute.setVE(1));

    const marsMarker = await page.evaluate(() => [...document.querySelectorAll(".lbl.stop")].map(e => e.textContent).find(t => /^1 /.test(t)));
    ok(marsMarker === "1 · 3 · 5 · 9 · 19 · 29", `Castle Mars carries every visit on one marker ("${marsMarker}")`);
    await page.click("#tourStart");
    let panel = (await page.textContent("#infoBody")).replace(/\s+/g, " ");
    ok(/1\. The Passage/.test(panel) && /Stop 1 of 30/.test(panel) && /ch\. 19/.test(panel), "Follow his year opens on stop 1 with its chapter");
    await page.click("#tourNext");
    panel = (await page.textContent("#infoBody")).replace(/\s+/g, " ");
    ok(/Stop 2 of 30/.test(panel) && /Assumed for the map/.test(panel), "Next steps to stop 2 and shows what was assumed");
    ok(await page.evaluate(() => document.querySelector(".lbl.stop.on") !== null && window.__institute.route.cur === 1), "the current stop's marker is highlighted");
    const markerShown = () => page.evaluate(() => [...document.querySelectorAll(".lbl.stop")].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
    await page.click("#routeToggle"); await frames();
    ok(!(await markerShown()), "hiding the path hides its stop markers (measured boxes)");
    await page.click("#routeToggle"); await page.evaluate(() => window.__institute.VIEWS.map()); await page.waitForTimeout(1800); await frames();
    ok(await markerShown(), "showing it brings them back");

    /* ------------------------------------------------------------------ */
    section("hygiene");
    ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
    ok(offHost.length === 0, "no off-host requests besides the routed three.js files" + (offHost.length ? ": " + offHost.join(", ") : ""));
    const src = fs.readFileSync(PAGE_FILE, "utf8");
    ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src), "no emoji in the page chrome");
    ok(/\[hidden\]\{display:none !important\}/.test(src), "explicit [hidden]{display:none} rule");
  } catch (e) {
    fail++; failures.push("crash: " + e.message); console.log("CRASH", e);
  } finally {
    await browser.close(); srv.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log("Failures:\n - " + failures.join("\n - ")); process.exit(1); }
})();
