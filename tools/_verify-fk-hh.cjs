#!/usr/bin/env node
"use strict";
/**
 * Headless verify: the HARVEST HOLLOW art pass (assets/farmkart-hh-art.js, FK_HH_ART).
 * Geometry / arithmetic, not pixels:
 *   1  isolation  : build() runs ONLY on ?track=harvest-hollow. On moo-moo-farm FK_HH_ART.art is null, nothing it owns is in the
 *                   scene, the scene child count and fog are identical with the art script blocked, no sky dome.
 *   2  landmarks  : gantry (2 posts + beam + banner), hay-bale grandstand + a cheering crowd, corner chevrons, candy curbs, windmill
 *                   rotor, ford bridge, barn lanterns + signs, pond ducks, scarecrow, tractor, mailbox, beehives, laundry, orchard,
 *                   hedges, stone walls, flowers, crop rows.
 *   3  road clearance : EVERY vertex of every mesh the art added (and every static instance) is either > TRACK_WIDTH/2 + 1.5u from the
 *                   centreline, or >= 6u above the road (the start gantry, flags, banner), or is deliberate road paint (curbs, dashes).
 *                   Registry items are checked the same way. Nothing sits on the train loop.
 *   4  materials  : every material the art added is MeshToonMaterial or MeshBasicMaterial (+ the sky dome ShaderMaterial); the
 *                   re-coloured ground and road are toon too; the road carries a texture + 2 UV columns.
 *   5  animation  : windmill rotor turns, crowd/duck/bird/sparkle matrices change between two update() times, the wind-sway shader
 *                   uniform is driven by the REAL frame loop, sway weights exist on crops/bunting.
 *   6  perf       : renderer.info calls/triangles at the start grid + 3 other spots, art on vs the art script blocked (budget below);
 *                   phone profile (pointer:coarse) builds a lighter scene than desktop.
 *   7  0 pageerrors throughout.
 *   node tools/_verify-fk-hh.cjs
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
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json", ".mp3": "audio/mpeg", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
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
function check(name, ok, detail) {
  if (ok) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (detail !== undefined ? "  — " + detail : "")); }
}
const BLOCK = /googleapis|firestore|firebase|gstatic|playroom|joinplayroom/;
const ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

// perf budget (measured 2026-10-12, swiftshader, 1280x720 chase view): the art adds <= PERF.dCalls draw calls and <= PERF.maxTrisX times the
// triangles of the same view without it. Recorded numbers are in docs/farm-kart.md ("HARVEST HOLLOW storybook art pass").
const PERF = { dCalls: 260, maxTrisX: 3.2, absCalls: 700, absTris: 330000 };

async function openPage(browser, base, track, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 }, hasTouch: !!opts.mobile, isMobile: !!opts.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(BLOCK, (r) => r.abort());
  if (opts.blockArt) await page.route(/farmkart-hh-art\.js/, (r) => r.abort());
  await page.goto(`${base}/farmkart.html?track=${track}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.__KART__ && window.__KART__.forceRace, null, { timeout: 90000 });
  return { page, errors, ctx };
}
async function race(page) { await page.evaluate(() => window.__KART__.forceRace()); await page.waitForTimeout(1200); }
// measure renderer.info at a chase pose (camera override installed once)
async function measure(page, poses) {
  await page.evaluate(() => {
    const K = window.__KART__; if (K.TRAIN_GROUP && K.TRAIN_GROUP.userData) K.TRAIN_GROUP.userData.update = () => {};
    if (window.__ovInstalled) return; window.__ovInstalled = true; window.__ov = null;
    const R = K.renderer, orig = R.render.bind(R);
    R.render = (s, c) => { if (window.__ov) { const o = window.__ov; c.position.set(o.p[0], o.p[1], o.p[2]); c.lookAt(o.l[0], o.l[1], o.l[2]); } orig(s, c); };
  });
  const out = {};
  for (const [name, x, z, hd] of poses) {
    await page.evaluate(([x, z, hd]) => { const K = window.__KART__, a = hd * Math.PI / 180, fx = Math.sin(a), fz = Math.cos(a), cx = x - fx * 16, cz = z - fz * 16;
      window.__ov = { p: [cx, K.sampleHeight(cx, cz) + 5.5, cz], l: [x + fx * 14, K.sampleHeight(x, z) + 1.2, z + fz * 14] }; }, [x, z, hd]);
    await page.waitForTimeout(700);
    out[name] = await page.evaluate(() => { const i = window.__KART__.renderer.info.render; return [i.calls, i.triangles]; });
  }
  await page.evaluate(() => { window.__ov = null; });
  return out;
}
const POSES = [["start", 0, 12, 0], ["crops", 233, 60, 190], ["ford", 224, -62, 215], ["barn", -36, -60, 180]];

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ARGS });
  const allErrors = [];

  // ---------------------------------------------------------------------------------------------
  console.log("\n[1] isolation: the art builds on harvest-hollow only");
  {
    const a = await openPage(browser, base, "moo-moo-farm");
    const b = await openPage(browser, base, "moo-moo-farm", { blockArt: true });
    await race(a.page); await race(b.page);
    const probe = () => {
      const K = window.__KART__; let owned = 0, dome = 0; K.scene.traverse((o) => { if (o.name === "hhArt" || (o.userData && (o.userData.hhKit || o.userData.hhArt))) owned++; if (o.name === "fkSkyDome") dome++; });
      return { art: window.FK_HH_ART ? (window.FK_HH_ART.art ? 1 : 0) : -1, has: !!window.FK_HH_ART, kids: K.scene.children.length, fog: K.scene.fog ? K.scene.fog.color.getHex() : null, owned, dome, id: K.ACTIVE_TRACK_ID };
    };
    const ra = await a.page.evaluate(probe), rb = await b.page.evaluate(probe);
    check("moo-moo-farm: art script loaded but build() never ran (FK_HH_ART.art is null)", ra.has && ra.art === 0, JSON.stringify(ra));
    // RESTAGED (2026-10-12 merge): toon-core (assets/farmkart-toon-game.js) now gives EVERY track a toon sky dome in
    // setSky, so "no fkSkyDome at all" no longer means "the art stayed out". What the art must not add is a SECOND dome:
    // the dome count has to equal the art-blocked page's (rb), and the art owns no mesh.
    check("moo-moo-farm: no mesh owned by the art, no extra sky dome", ra.owned === 0 && ra.dome === rb.dome, JSON.stringify(ra) + " blocked " + JSON.stringify(rb));
    check("moo-moo-farm: scene child count identical with the art script blocked", ra.kids === rb.kids, ra.kids + " vs " + rb.kids);
    check("moo-moo-farm: fog identical with the art script blocked", ra.fog === rb.fog, ra.fog + " vs " + rb.fog);
    const ha = await openPage(browser, base, "harvest-hollow", { blockArt: true });
    const hb = await ha.page.evaluate(() => ({ has: !!window.FK_HH_ART, id: window.__KART__.ACTIVE_TRACK_ID, fog: !!window.__KART__.scene.fog }));
    check("harvest-hollow with the script blocked still boots (no hard dependency, no fog from the art)", !hb.has && hb.id === "harvest-hollow" && hb.fog === false, JSON.stringify(hb));
    allErrors.push(...a.errors, ...b.errors, ...ha.errors);
    await a.ctx.close(); await b.ctx.close(); await ha.ctx.close();
  }

  // ---------------------------------------------------------------------------------------------
  const H = await openPage(browser, base, "harvest-hollow");
  const hh = H.page;
  await race(hh);
  await hh.waitForTimeout(1500);

  console.log("\n[2] landmarks exist");
  const L = await hh.evaluate(() => {
    const A = window.FK_HH_ART && window.FK_HH_ART.art; if (!A) return null;
    const kinds = {}; for (const r of A.registry) kinds[r.kind] = (kinds[r.kind] || 0) + 1;
    return { kinds, stats: A.stats, track: window.__KART__.ACTIVE_TRACK_ID, fogHex: window.__KART__.scene.fog && window.__KART__.scene.fog.color.getHex(),
      dome: !!A.dome && A.dome.name === "fkSkyDome", clouds: A.cloudRoot.children.length, bunting: A.registry.length };
  });
  check("FK_HH_ART.art is live on harvest-hollow", !!L && L.track === "harvest-hollow");
  const k = (L && L.kinds) || {};
  check("start gantry: 2 pillars + overhead beam + banner board", k["gantry-post"] === 2 && k["gantry-beam"] === 1 && k["gantry-banner"] === 1, JSON.stringify([k["gantry-post"], k["gantry-beam"], k["gantry-banner"]]));
  check("gantry clearance: lowest hanging part >= 6u above the road", L && L.stats.gantryClear >= 6, L && L.stats.gantryClear);
  check("hay-bale grandstand + >= 15 cheering critters", k.grandstand === 1 && k.crowd >= 15, JSON.stringify([k.grandstand, k.crowd]));
  check("candy-stripe curbs on the corners (>= 120 stripes)", k.curb >= 120, k.curb);
  check("corner chevron boards (>= 10)", k.chevron >= 10, k.chevron);
  check("windmill with an animated rotor", k.windmill === 1 && k["windmill-rotor"] === 1);
  check("ford: wooden bridge dressing", k.bridge >= 1, k.bridge);
  check("barn chicane: lanterns (>= 3) + warning signs (>= 2) + clutter", k.lantern >= 3 && k.sign >= 2 && k["barn-clutter"] >= 4, JSON.stringify([k.lantern, k.sign, k["barn-clutter"]]));
  check("pond: ducks (>= 3)", k.duck >= 3, k.duck);
  check("farm dressing: scarecrow, tractor, mailbox, beehives, laundry line, picket fence", k.scarecrow >= 1 && k.tractor === 1 && k.mailbox === 1 && k.beehive >= 2 && k.laundry === 1 && k.picket === 1,
    JSON.stringify([k.scarecrow, k.tractor, k.mailbox, k.beehive, k.laundry, k.picket]));
  check("orchard (>= 15 fruit trees), hedgerows, stone walls, flower patches", k["fruit-tree"] >= 15 && k.hedge >= 10 && k.wall >= 10 && k.flowers >= 20, JSON.stringify([k["fruit-tree"], k.hedge, k.wall, k.flowers]));
  check("crop rows planted in the painted fields (>= 300 plants, pumpkins among them)", L && L.stats.plants >= 300 && L.stats.pumpkins >= 5, L && JSON.stringify([L.stats.plants, L.stats.pumpkins]));
  check("storybook sky: dome + cloud clusters + golden fog", L && L.dome && L.clouds > 0 && L.fogHex === 0xf3dfba, L && JSON.stringify([L.dome, L.clouds, L.fogHex]));

  if (!L) {   // pre-change app (no FK_HH_ART): every later check needs the art, so each counts as a failure
    const TOTAL = 39; const unreached = TOTAL - (pass + fail);
    fail += unreached; console.log(`  FAIL ${unreached} remaining checks (clearance, materials, animation, perf, phone, errors) cannot run without FK_HH_ART`);
    await browser.close(); srv.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(1);
  }
  console.log("\n[3] nothing intrudes on the road corridor");
  const C = await hh.evaluate(() => {
    const K = window.__KART__, A = window.FK_HH_ART.art, hw = K.TRACK_WIDTH / 2, Cp = K.centerPts, N = Cp.length, TG = K.tangents;
    // own fast distance: spatial hash over centreline segments
    const HC = 32, hash = new Map();
    for (let i = 0; i < N; i++) { const kk = Math.floor(Cp[i].x / HC) + "," + Math.floor(Cp[i].z / HC); (hash.get(kk) || hash.set(kk, []).get(kk)).push(i); }
    function near(x, z) {
      const cx = Math.floor(x / HC), cz = Math.floor(z / HC); let bd = 1e18, bi = 0;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = hash.get((cx + a) + "," + (cz + b)); if (!l) continue;
        for (const i of l) for (const j of [(i - 1 + N) % N, i]) { const p = Cp[j], q = Cp[(j + 1) % N]; const dx = q.x - p.x, dz = q.z - p.z, l2 = dx * dx + dz * dz || 1e-9;
          let u = ((x - p.x) * dx + (z - p.z) * dz) / l2; u = u < 0 ? 0 : u > 1 ? 1 : u; const ex = x - (p.x + dx * u), ez = z - (p.z + dz * u), d = ex * ex + ez * ez; if (d < bd) { bd = d; bi = j; } } }
      return { d: bd > 1e17 ? 99 : Math.sqrt(bd), i: bi };
    }
    // cross-check the fast distance against the game's own nearestCenterInfo on a sample
    let maxDelta = 0; for (let t = 0; t < 40; t++) { const x = -30 + t * 7.3, z = -100 + (t * 13) % 230; const a = near(x, z).d, b = K.nearestCenterInfo(x, z).dist; if (a < 40) maxDelta = Math.max(maxDelta, Math.abs(a - b)); }
    const MARGIN = 1.5, v = new THREE.Vector3();
    const bad = [], stat = { meshes: 0, verts: 0, inst: 0, skipped: 0, overhead: 0 };
    A.root.updateMatrixWorld(true);
    A.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.hhRoad || o.userData.hhFar || o.userData.hhDynamic) { stat.skipped++; return; }
      stat.meshes++;
      const pa = o.geometry.attributes.position;
      if (o.isInstancedMesh) {           // animated critters: instance origins (ducks orbit inside the pond, far from the road)
        const m = new THREE.Matrix4(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); v.setFromMatrixPosition(m).applyMatrix4(o.matrixWorld); stat.inst++;
          const r = near(v.x, v.z); if (r.d <= hw + MARGIN) bad.push([o.name || "inst", v.x.toFixed(1), v.z.toFixed(1), r.d.toFixed(2)]); }
        return;
      }
      for (let i = 0; i < pa.count; i += 1) {
        v.set(pa.getX(i), pa.getY(i), pa.getZ(i)).applyMatrix4(o.matrixWorld); stat.verts++;
        const r = near(v.x, v.z);
        if (r.d > hw + MARGIN) continue;
        const above = v.y - Cp[r.i].y;
        if (above >= 6) { stat.overhead++; continue; }
        if (bad.length < 12) bad.push([o.name || o.type, v.x.toFixed(1), v.y.toFixed(1), v.z.toFixed(1), "d=" + r.d.toFixed(2), "above=" + above.toFixed(1)]);
      }
    });
    // registry items: centre distance beyond the edge + margin, except overhead / road paint
    const regBad = A.registry.filter((r) => !r.overhead && !r.road && !r.rotor && r.kind !== "crowd" && near(r.x, r.z).d <= hw + MARGIN).map((r) => r.kind + "@" + r.x.toFixed(0) + "," + r.z.toFixed(0));
    const regOver = A.registry.filter((r) => r.overhead).map((r) => [r.kind, +(r.minY - Cp[near(r.x, r.z).i].y).toFixed(2)]);
    // train loop clearance
    const rails = [], tr = K.ACTIVE_TRACK.trains[0], cv = new THREE.CatmullRomCurve3(tr.points.map((p) => new THREE.Vector3(p.x, 0, p.z)), true, "catmullrom", 0.5);
    for (let i = 0; i < 360; i++) { const p = cv.getPoint(i / 360); rails.push(p); }
    let railHits = 0;
    for (const r of A.registry) { if (r.overhead || r.road || r.kind === "gantry-beam") continue; let m = 1e9; for (const p of rails) { const d = Math.hypot(p.x - r.x, p.z - r.z); if (d < m) m = d; } if (m < 3.0) railHits++; }
    return { stat, bad, regBad, regOver, maxDelta, hw, railHits, rotorSpan: A.registry.filter((r) => r.kind === "windmill-rotor").map((r) => ({ d: near(r.x, r.z).d, r: r.r })) };
  });
  console.log(`  swept ${C.stat.meshes} meshes / ${C.stat.verts} vertices / ${C.stat.inst} instances (${C.stat.skipped} road-paint/far-sky/dynamic meshes skipped, ${C.stat.overhead} overhead vertices)`);
  check("fast centreline distance agrees with the game's nearestCenterInfo (< 0.6u on 40 probes)", C.maxDelta < 0.6, C.maxDelta);
  check(`every added vertex is > ${C.hw}+1.5u from the centreline or >= 6u overhead (0 intruders)`, C.bad.length === 0, JSON.stringify(C.bad.slice(0, 6)));
  check("every registry item sits beyond the road edge + 1.5u (overhead gantry and road paint excepted)", C.regBad.length === 0, C.regBad.slice(0, 8).join(" "));
  check("overhead structures (gantry beam, banner) hang >= 6u above the road", C.regOver.length >= 2 && C.regOver.every((r) => r[1] >= 6), JSON.stringify(C.regOver));
  check("windmill sails sweep clear of the road (rotor centre >= its sweep radius + road edge)", C.rotorSpan.every((r) => r.d >= C.hw + r.r - 0.5), JSON.stringify(C.rotorSpan));
  check("nothing placed on the train loop (>= 3u)", C.railHits === 0, C.railHits);

  console.log("\n[4] materials are toon or basic");
  const M = await hh.evaluate(() => {
    const A = window.FK_HH_ART.art, K = window.__KART__, types = {}, bad = [];
    A.root.traverse((o) => { if (!o.isMesh) return; const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { types[m.type] = (types[m.type] || 0) + 1;
      if (!(m.type === "MeshToonMaterial" || m.type === "MeshBasicMaterial" || (m.type === "ShaderMaterial" && o.name === "fkSkyDome"))) bad.push(o.name + ":" + m.type); } });
    // the re-coloured world meshes
    let ground = null, road = null; K.scene.traverse((o) => { if (o.isMesh && o.material && o.material.userData && o.material.userData.hhArt && !o.userData.hhKit) { if (o.geometry.attributes.color && o.geometry.attributes.position.count > 9000) ground = o; else if (o.material.map) road = o; } });
    return { types, bad, ground: ground && ground.material.type, road: road && road.material.type, roadMap: !!(road && road.material.map), roadCols: road && (road.geometry.attributes.position.count / (K.centerPts.length + 1)), roadUV: !!(road && road.geometry.attributes.uv) };
  });
  check("every mesh the art added is MeshToon / MeshBasic (+ the sky dome)", M.bad.length === 0, M.bad.slice(0, 5).join(" ") + " " + JSON.stringify(M.types));
  check("re-coloured ground is a toon vertex-colour material", M.ground === "MeshToonMaterial", M.ground);
  check("road is a toon material with a canvas texture and UVs (ruts + pebbles)", M.road === "MeshToonMaterial" && M.roadMap && M.roadUV, JSON.stringify(M));

  console.log("\n[5] animation");
  // RESTAGED (2026-10-12 merge): with toon shadows + ink on the full field a headless swiftshader frame on this track takes
  // ~0.6 s (measured), so a fixed 500 ms window can fall between two frames. Poll up to 8 s for the clock to move instead.
  const t1 = await hh.evaluate(() => window.FK_HH_ART.art.uniforms.uHT.value);
  let t2 = t1; for (let i = 0; i < 16 && t2 <= t1; i++){ await hh.waitForTimeout(500); t2 = await hh.evaluate(() => window.FK_HH_ART.art.uniforms.uHT.value); }
  check("the real frame loop drives the art clock (uHT advances without test calls)", t2 > t1, t1 + " -> " + t2);
  const an = await hh.evaluate(() => {
    const A = window.FK_HH_ART.art; const out = {};
    const snap = () => ({ rot: A.rotor ? A.rotor.rotation.z : null, crowd: Array.from(A.crowd.meshes[0].instanceMatrix.array.slice(0, 32)), duck: A.ducks.meshes ? Array.from(A.ducks.meshes[0].instanceMatrix.array.slice(0, 16)) : null,
      bird: Array.from(A.birds.im.instanceMatrix.array.slice(0, 16)), spark: Array.from(A.sparkle.im.instanceMatrix.array.slice(0, 16)), leaf: Array.from(A.leaves.im.instanceMatrix.array.slice(0, 16)), t: A.uniforms.uHT.value });
    const a = snap(); A.update(0.6, a.t + 0.6); const b = snap();
    const diff = (x, y) => x && y && x.some((v, i) => Math.abs(v - y[i]) > 1e-4);
    out.rotor = Math.abs(b.rot - a.rot) > 0.1; out.crowd = diff(a.crowd, b.crowd); out.duck = diff(a.duck, b.duck); out.bird = diff(a.bird, b.bird); out.spark = diff(a.spark, b.spark); out.leaf = diff(a.leaf, b.leaf); out.uniform = b.t - a.t > 0.5;
    // crowd bounce: some critter actually leaves its perch (y of the body instances varies > 0.1)
    const ys = []; const arr = A.crowd.meshes[0].instanceMatrix.array; for (let i = 0; i < A.crowd.list.length; i++) ys.push(arr[i * 16 + 13]);
    out.crowdSpread = Math.max(...ys) - Math.min(...ys) > 0.1;
    // sway weights present: count of sway vertices on the kit meshes
    let swayVerts = 0, totalVerts = 0; A.root.traverse((o) => { if (o.isMesh && o.userData.hhKit && o.geometry.attributes.aSway && !o.userData.hhFar) { const s = o.geometry.attributes.aSway; totalVerts += s.count; for (let i = 0; i < s.count; i++) if (s.getX(i) > 0.01) swayVerts++; } });
    out.swayVerts = swayVerts; out.totalVerts = totalVerts;
    out.shader = A.kitMeshes.some((m) => m.material && m.material.onBeforeCompile && /Sway/.test(m.material.customProgramCacheKey ? m.material.customProgramCacheKey() : ""));
    return out;
  });
  check("windmill sails rotate between two update() times", an.rotor);
  check("crowd, ducks, birds, water sparkles and drifting leaves all move", an.crowd && an.duck && an.bird && an.spark && an.leaf, JSON.stringify(an));
  check("crowd bounces: critter heights spread > 0.1u", an.crowdSpread);
  check("wind sway: weights baked on crops/bunting/flags/reeds (> 2000 vertices) + sway shader on the kit materials", an.swayVerts > 2000 && an.shader, an.swayVerts + "/" + an.totalVerts);

  console.log("\n[6] performance (calls / triangles at the same chase poses, art on vs the art script blocked)");
  const withArt = await measure(hh, POSES);
  const N0 = await openPage(browser, base, "harvest-hollow", { blockArt: true }); await race(N0.page); await N0.page.waitForTimeout(1500);
  const noArt = await measure(N0.page, POSES);
  let worstDC = 0, worstX = 0, worstCalls = 0, worstTris = 0;
  for (const [n] of POSES) { const a = withArt[n], b = noArt[n]; worstDC = Math.max(worstDC, a[0] - b[0]); worstX = Math.max(worstX, a[1] / b[1]); worstCalls = Math.max(worstCalls, a[0]); worstTris = Math.max(worstTris, a[1]);
    console.log(`  ${n.padEnd(6)} calls ${String(b[0]).padStart(3)} -> ${String(a[0]).padStart(3)}   tris ${String(b[1]).padStart(6)} -> ${String(a[1]).padStart(6)}  (x${(a[1] / b[1]).toFixed(2)})`); }
  check(`draw-call budget: art adds <= ${PERF.dCalls} calls at every pose (worst +${worstDC})`, worstDC <= PERF.dCalls, worstDC);
  check(`triangle budget: <= ${PERF.maxTrisX}x the un-arted view (worst x${worstX.toFixed(2)}) and < ${PERF.absTris} absolute (worst ${worstTris})`, worstX <= PERF.maxTrisX && worstTris < PERF.absTris, worstX.toFixed(2) + " / " + worstTris);
  check(`absolute draw calls stay < ${PERF.absCalls} (worst ${worstCalls})`, worstCalls < PERF.absCalls, worstCalls);
  allErrors.push(...N0.errors); await N0.ctx.close();

  console.log("\n[6b] phone profile (pointer: coarse)");
  const Mo = await openPage(browser, base, "harvest-hollow", { mobile: true }); await race(Mo.page); await Mo.page.waitForTimeout(1500);
  const mo = await Mo.page.evaluate(() => { const A = window.FK_HH_ART.art; let tris = 0; A.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } });
    return { mobile: A.MOBILE, plants: A.stats.plants, tris, kitMeshes: A.stats.kitMeshes, crowd: A.crowd.list.length, flowers: A.stats.flowers }; });
  const de = await hh.evaluate(() => { const A = window.FK_HH_ART.art; let tris = 0; A.root.traverse((o) => { if (o.isMesh && o.geometry) { const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); } }); return { tris, plants: A.stats.plants, flowers: A.stats.flowers }; });
  console.log(`  total art triangles: desktop ${Math.round(de.tris)}  phone ${Math.round(mo.tris)}  (plants ${de.plants} -> ${mo.plants}, flower stems ${de.flowers} -> ${mo.flowers})`);
  check("phone profile is detected and builds a lighter scene (<= 80% of the desktop triangles)", mo.mobile === true && mo.tris <= de.tris * 0.8, JSON.stringify([mo.mobile, Math.round(mo.tris), Math.round(de.tris)]));
  check("phone scene keeps every landmark (crowd + windmill still there)", mo.crowd >= 15, mo.crowd);
  allErrors.push(...Mo.errors); await Mo.ctx.close();

  allErrors.push(...H.errors);
  console.log("\n[7] errors");
  check("0 pageerrors across every page", allErrors.length === 0, allErrors.slice(0, 4).join(" | "));

  await browser.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
