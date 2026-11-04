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
