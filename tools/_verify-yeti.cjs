#!/usr/bin/env node
"use strict";
/**
 * Headless verify: YETI RIDGE — the lead-designed snow course (tools/_yr_build.cjs + assets/farmkart-yeti-art.js).
 *   A  data: builtin present, sanitize keeps every feature key, every OTHER builtin byte-identical to git HEAD
 *   B  geometry: lap length, width, sharp turns (>= 110 deg over 45 u, at least one >= 135), the overpass clears >= 8 u
 *   C  features: natural tunnel, overpass bridge, >= 4 boost pads, 4 item rows, snowman + goat crossings, paddock cows,
 *      steam train, fordable creek water, painted ICE that really sets surfPaint, corridor walls present
 *   D  jumps: scripted line-following driver at 4 entry speeds launches off BOTH ramps, the ski jump peaks >= 12 u and
 *      the gorge jump >= 6 u above the road, flight + 1.5 s after landing stays over the road
 *   E  a CPU racer laps the course (synchronous sim) with no rescue and never leaves the walled corridor
 *   G  playtest 2026-10-12: nothing solid at kart height over ANY road (scene-wide vertex scan: bridge walls, props,
 *      lift towers, the lake sheet), walls line both sides (Yeti + Harvest Hollow) without crossing another lane, the
 *      overpass has no pillar in the road below, and the sky is overcast with a dense, moving snowfall
 *   F  art: built only on this track, toon/basic materials, nothing solid in the road corridor, gantry + ski lift clear
 *      the road by >= 6 u, landmarks exist, animated parts move, grass tufts hidden, draw-call budget
 * Physics is stepped through __KART__.soloRaceTick so results don't depend on headless frame rate.
 *
 *   node tools/_verify-yeti.cjs
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const { execSync } = require("child_process");

function loadPlaywright(){ for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) { try { return require(p); } catch (_) {} } throw new Error("playwright not found"); }
const { chromium } = loadPlaywright();
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json", ".mp3": "audio/mpeg", ".ogg": "audio/ogg" };
function serve(){ return new Promise((res) => { const srv = http.createServer((req, rsp) => { const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); rsp.end(); return; }
  rsp.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(rsp); }).listen(0, "127.0.0.1", () => res(srv)); }); }
let pass = 0, fail = 0;
function check(name, ok, detail){ if (ok){ pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (detail ? "  — " + detail : "")); } }
function loadFK(code){ const win = {}; new Function("window", "document", code)(win, undefined); return win.FK_TRACK; }

async function open(browser, base, track, viewport){
  const page = await browser.newPage({ viewport: viewport || { width: 960, height: 540 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/googleapis|firestore|firebase|gstatic|playroom|joinplayroom/, (r) => r.abort());
  await page.goto(`${base}/farmkart.html?track=${track}`);
  await page.waitForFunction(() => window.__KART__ && window.__KART__.forceRace, null, { timeout: 60000 });
  return { page, errors };
}

(async () => {
  // ---------------- A: data ----------------
  const N = 500;   // replica centreline resolution (sections A + B)
  const cat = (pts) => { const n = pts.length, Pp = (i) => pts[((i % n) + n) % n], out = []; for (let i = 0; i < N; i++){ const t = i / N * n, sg = Math.floor(t), u = t - sg, p0 = Pp(sg-1), p1 = Pp(sg), p2 = Pp(sg+1), p3 = Pp(sg+2), u2 = u*u, u3 = u2*u;
    const c = (a0,a1,a2,a3) => { const t1 = (a2-a0)*.5, t2 = (a3-a1)*.5; return (2*a1-2*a2+t1+t2)*u3 + (-3*a1+3*a2-2*t1-t2)*u2 + t1*u + a1; }; out.push({ x:c(p0.x,p1.x,p2.x,p3.x), y:c(p0.y||0,p1.y||0,p2.y||0,p3.y||0), z:c(p0.z,p1.z,p2.z,p3.z) }); } return out; };
  console.log("\n[A] track data");
  const FK = loadFK(fs.readFileSync(path.join(ROOT, "assets/farmkart-track.js"), "utf8"));
  const T = FK.BUILTIN_TRACKS["yeti-ridge"];
  check("yeti-ridge is a builtin track", !!T);
  if (!T){ console.log(`\n${pass}/${pass + fail} passed`); process.exit(1); }
  const S = FK.sanitize(JSON.parse(JSON.stringify(T)));
  const want = ["points", "boostPads", "objects", "terrain", "paint", "fences", "tunnels", "bridges", "waters", "chickens", "pastures", "trains", "sky", "music", "wallStyle", "itemRows"];
  check("sanitize keeps every feature key", S && want.every((k) => S[k] != null), want.filter((k) => !S || S[k] == null).join(","));
  let OLD = null; try { OLD = loadFK(execSync("git show HEAD:assets/farmkart-track.js", { cwd: ROOT, maxBuffer: 1 << 26 }).toString()); } catch (_) {}
  if (OLD){
    // RESTAGED 2026-10-12: Harvest Hollow is no longer frozen - the playtest asked for road-edge walls there too
    // (tools/_hh_build.cjs + tools/_fk_walls.cjs). It may differ from HEAD in exactly: fences (walls added), objects (the
    // decorative GLB fence rows the walls replace) and wallStyle (wooden fence). Every other builtin stays byte-identical.
    const HH_OK = ["fences", "objects", "wallStyle"];
    // (2026-10-12: midnight-run gained music:"techno-barn" - it may differ from HEAD in exactly that key)
    const sameBut = (a, b, keys) => { const A = Object.assign({}, a), B = Object.assign({}, b); for (const k of keys){ delete A[k]; delete B[k]; } return JSON.stringify(A) === JSON.stringify(B); };
    const changed = Object.keys(OLD.BUILTIN_TRACKS).filter((id) => id !== "yeti-ridge" && id !== "harvest-hollow" && !(id === "midnight-run" ? sameBut(OLD.BUILTIN_TRACKS[id], FK.BUILTIN_TRACKS[id], ["music"]) : JSON.stringify(OLD.BUILTIN_TRACKS[id]) === JSON.stringify(FK.BUILTIN_TRACKS[id])));
    check("every other builtin track is byte-identical to git HEAD (midnight-run: but for its music slug)", changed.length === 0, changed.join(","));
    const a = OLD.BUILTIN_TRACKS["harvest-hollow"], b = FK.BUILTIN_TRACKS["harvest-hollow"];
    const hhKeys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    check(`harvest-hollow differs from HEAD only in ${HH_OK.join("/")} (${hhKeys.join(",")})`, hhKeys.every((k) => HH_OK.includes(k)), hhKeys.join(","));
    const noId = (o) => { const c = Object.assign({}, o); delete c.id; return JSON.stringify(c); };   // ids renumber once rows go
    const bSet = new Set(b.objects.map(noId)), lost = a.objects.filter((o) => !bSet.has(noId(o)));
    // ...plus untagged props whose footprint reached into the road (the same road-clearance rule as Yeti: a crate by the coop)
    const hhC = cat(a.points), hhNear = (x, z) => Math.min(...hhC.map((c) => Math.hypot(c.x - x, c.z - z)));
    // ...and the static windmill GLB, which was re-seated >= 16 u off the road (it stood 3.3 u from the centreline)
    const odd = lost.filter((o) => o.model !== "farm_fence" && !(o.model === "farm_tower_windmill" && b.objects.some((q) => q.model === o.model && hhNear(q.x, q.z) >= 16)) && !(!o.tag && hhNear(o.x, o.z) < a.width / 2 + 0.5 + o.sx * 0.45 + 0.3));
    // RESTAGED: this compares against git HEAD, so once the HH walls are committed nothing differs and "some farm_fence
    // rows were removed" no longer holds - the rule that matters is that NOTHING ELSE was removed. The fence rows' absence
    // is asserted directly against the data instead.
    check(`harvest-hollow: objects removed vs HEAD are only decorative farm_fence rows + road-intruding props (${lost.length})`, odd.length === 0, odd.map((o) => o.model + "@" + o.x + "," + o.z).join(" "));
    // (a lone farm_fence by the coop is a set piece; the ROWS stood 12.5 u off the home lane, inside half+6)
    const laneFence = b.objects.filter((o) => o.model === "farm_fence" && hhNear(o.x, o.z) < b.width / 2 + 6);
    check("harvest-hollow: no decorative farm_fence rows left along the road (the wooden walls replace them)", laneFence.length === 0, laneFence.map((o) => o.x + "," + o.z).join(" "));
  }

  // ---------------- B: geometry (pure, from the data) ----------------
  console.log("\n[B] geometry");
  const P = T.points;

  const C = cat(P), arc = [0]; for (let i = 1; i <= N; i++){ const a = C[i-1], b = C[i % N]; arc[i] = arc[i-1] + Math.hypot(b.x-a.x, b.z-a.z); } const L = arc[N];
  const hd = (i) => { const a = C[(i-1+N)%N], b = C[(i+1)%N]; return Math.atan2(b.x-a.x, b.z-a.z); };
  const wrap = (a) => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
  const turns = []; for (let i = 0; i < N; i++){ let j = i, tot = 0; while (arc[j] - arc[i] < 45 && j < i + N){ tot += wrap(hd((j+1) % N) - hd(j % N)); j++; } turns.push({ i, deg: Math.abs(tot * 180 / Math.PI) }); }
  const picked = []; [...turns].sort((a, b) => b.deg - a.deg).forEach((t) => { if (picked.every((p) => { const g = Math.abs(arc[p.i] - arc[t.i]); return g > 60 && g < L - 60; })) picked.push(t); });
  const sharp = picked.filter((t) => t.deg >= 110);
  check(`lap length ${L.toFixed(0)} u within 1300..1700`, L > 1300 && L < 1700);
  check("width 16, 3 laps", T.width === 16 && T.laps === 3, `${T.width}/${T.laps}`);
  check(`>= 4 sharp turns (>= 110 deg over 45 u): ${sharp.map((t) => Math.round(t.deg)).join(",")}`, sharp.length >= 4);
  check("the sharpest turn is a true hairpin (>= 135 deg over 45 u)", picked[0] && picked[0].deg >= 135, picked[0] && picked[0].deg.toFixed(0));
  let cross = null; for (let i = 0; i < N; i += 2) for (let j = i + 40; j < N; j += 2){ const g = Math.min(arc[j]-arc[i], L-(arc[j]-arc[i])); if (g < 80) continue; const d = Math.hypot(C[i].x-C[j].x, C[i].z-C[j].z); if (d < 4){ const dy = Math.abs(C[i].y - C[j].y); if (!cross || dy < cross.dy) cross = { dy, i, j }; } }
  check("the figure-8 overpass clears the road below by >= 8 u", cross && cross.dy >= 8, cross ? cross.dy.toFixed(1) : "no crossing");
  const v = FK.validate({ points: P, width: T.width }); check("FK_TRACK.validate: no warnings", v.ok && !v.warnings.length, JSON.stringify(v.warnings));

  const srv = await serve(); const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });

  // ---------------- C + D + E: in the game ----------------
  const { page, errors } = await open(browser, base, "yeti-ridge");
  console.log("\n[C] features");
  const c = await page.evaluate(() => {
    const K = __KART__; K.forceRace(); const G = K.G, p = G.players.local, TR = K.ACTIVE_TRACK, N = K.centerPts.length, out = {};
    out.tunnel = (TR.tunnels || []).filter((t) => t.style === "natural").length;
    out.bridges = (TR.bridges || []).length; out.pads = (G.boostPads || []).length; out.rows = (TR.itemRows || []).length;
    out.crit = (TR.chickens || []).map((c) => c.kind || "chicken");
    out.cows = (TR.pastures || []).reduce((s, q) => s + (q.count || 0), 0); out.trains = (TR.trains || []).length;
    const w = (TR.waters || [])[0]; out.depth = w && K.waterDepthAt ? +K.waterDepthAt(w.x, w.z).toFixed(2) : null;
    out.walls = (TR.fences || []).filter((f) => (f.style || "ribbon") !== "rail" || /wall/.test(f.id)).length;
    // drive the middle of the iced span (classified by the game's own FK_TRACK.surfaceTypeAt, not a colour key):
    // start ON the ground (y = road height) so the run isn't spent airborne, and count frames the kart reads 'ice'
    const isIce = (i) => FK_TRACK.surfaceTypeAt(TR.paint, K.centerPts[i].x, K.centerPts[i].z) === "ice";
    let best = { a: -1, n: 0 }; for (let i = 0, a = -1; i < N; i++){ if (isIce(i)){ if (a < 0) a = i; if (i - a + 1 > best.n) best = { a, n: i - a + 1 }; } else a = -1; }
    out.iceSamples = best.n; out.iceFrames = 0;
    if (best.a >= 0){ const i = best.a + 2, cc = K.centerPts[i], t = K.tangents[i]; p.pos.x = cc.x; p.pos.z = cc.z; p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * 10; p.v.z = t.z * 10; p.y = K.sampleHeight(cc.x, cc.z); p.vy = 0; p.airborne = false; p.lastSampleIdx = i; p.progressS = K.arcS[i]; p.prevProgressS = K.arcS[i]; G.phase = "racing";
      for (const id in G.players) if (id !== "local"){ G.players[id].pos.x = 9999; G.players[id].pos.z = 9999; }
      for (let f = 0; f < 30; f++){ K.soloRaceTick(1 / 60, { steer: 0, throttle: 1, brake: 0, drift: false }); if (p.surfPaint === "ice") out.iceFrames++; } }
    return out;
  });
  check("a NATURAL tunnel (the glacier cave)", c.tunnel >= 1, c.tunnel);
  check("an overpass bridge", c.bridges >= 1, c.bridges);
  check(">= 4 boost pads", c.pads >= 4, c.pads);
  check("4 item rows", c.rows === 4, c.rows);
  check("snowman crossings x2 + a goat crossing", c.crit.filter((k) => k === "snowman").length >= 2 && c.crit.includes("goat"), c.crit.join(","));
  check("a paddock of cows + a steam train", c.cows >= 3 && c.trains >= 1, `${c.cows}/${c.trains}`);
  check("the gorge creek is real water you can wade (0.3 < depth < 1.5)", c.depth > 0.3 && c.depth < 1.5, c.depth);
  check("road-edge walls are present (drawn fences disable the automatic corridor walls)", c.walls >= 4, c.walls);
  check(`the frozen-lake road is a long ICE span (${c.iceSamples} centre samples >= 10)`, c.iceSamples >= 10, c.iceSamples);
  check(`a kart crossing it really skates (p.surfPaint === 'ice' on ${c.iceFrames}/30 frames, >= 20)`, c.iceFrames >= 20, c.iceFrames);

  console.log("\n[D] the two big jumps");
  const j = await page.evaluate(() => {
    const K = __KART__, G = K.G, p = G.players.local, N = K.centerPts.length, out = [];
    const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    for (const rid of ["yr_skijump", "yr_gorgejump"]){
      const ramp = K.ACTIVE_TRACK.objects.find((o) => o.id === rid); let ri = 0, bd = 1e18;
      for (let i = 0; i < N; i++){ const c = K.centerPts[i], d = (c.x - ramp.x) ** 2 + (c.z - ramp.z) ** 2; if (d < bd){ bd = d; ri = i; } }
      for (const v0 of [10, 16, 22, 28]){
        // start on the straight run-in (9 samples back), lined up with the road
        const i = (ri - 9 + N) % N, cc = K.centerPts[i], t = K.tangents[i];
        p.pos.x = cc.x; p.pos.z = cc.z; p.theta = Math.atan2(t.x, t.z); p.v.x = t.x * v0; p.v.z = t.z * v0; p.y = K.sampleHeight(cc.x, cc.z) + 0.2; p.vy = 0; p.airborne = false; p.onRamp = false; p._rampBoosted = false;
        p.lastSampleIdx = i; p.progressS = K.arcS[i]; p.prevProgressS = K.arcS[i]; p.isBot = false; p.finished = false; G.phase = "racing";
        for (const id in G.players) if (id !== "local"){ G.players[id].pos.x = 9999; G.players[id].pos.z = 9999; }
        let ramped = false, air = 0, landed = false, landF = -1, peak = 0, maxAir = 0, after = 0, relaunch = 0;
        for (let f = 0; f < 420; f++){
          const n = K.nearestCenterInfo(p.pos.x, p.pos.z), tg = K.centerPts[(n.idx + 6) % N];
          K.soloRaceTick(1 / 60, { steer: Math.max(-1, Math.min(1, wrap(Math.atan2(tg.x - p.pos.x, tg.z - p.pos.z) - p.theta) * 2.2)), throttle: 1, brake: 0, drift: false });
          const d = K.nearestCenterInfo(p.pos.x, p.pos.z).dist;
          if (p._rampAir) ramped = true;
          if (p.airborne && !landed){ air++; maxAir = Math.max(maxAir, d); peak = Math.max(peak, (p.y || 0) - K.centerPts[n.idx].y); }
          else if (air > 6 && !landed){ landed = true; landF = f; }
          if (landed && f - landF <= 90) after = Math.max(after, d);
          if (landed && f - landF <= 60 && f > landF && p.airborne) relaunch++;   // micro-hops right after touchdown
        }
        out.push({ rid, v0, ramped, air, peak: +peak.toFixed(1), maxAir: +maxAir.toFixed(1), after: +after.toFixed(1), landed, relaunch });
      }
    }
    return { out, half: K.TRACK_WIDTH / 2 };
  });
  for (const r of j.out){
    const minPeak = r.rid === "yr_skijump" ? 12 : 6;
    check(`${r.rid} @ ${r.v0} m/s: launches off the ramp, peak ${r.peak} u >= ${minPeak} (${r.air} airborne frames)`, r.ramped && r.peak >= minPeak, JSON.stringify(r));
    // 2026-10-12 playtest "the screen stutters coming down from a big ramp jump": the kart re-launched off the steepening
    // landing slope 2 frames after touchdown, 3 times (each firing squash + thump + dust). LAND_SETTLE_T keeps it down.
    check(`${r.rid} @ ${r.v0} m/s: lands once, no micro-hops in the next second (${r.relaunch} airborne frames)`, r.landed && r.relaunch === 0, JSON.stringify(r));
    check(`${r.rid} @ ${r.v0} m/s: flight + 1.5 s after landing stays over the road (max ${Math.max(r.maxAir, r.after)} <= ${j.half})`, r.landed && r.maxAir <= j.half && r.after <= j.half, JSON.stringify(r));
  }

  console.log("\n[E] a CPU racer laps it");
  const e = await page.evaluate(() => {
    const K = __KART__, G = K.G, p = G.players.local; K.forceRace();
    p.isBot = true; G.phase = "racing"; for (const id in G.players) if (id !== "local"){ G.players[id].pos.x = 9999; G.players[id].pos.z = 9999; }
    const lap0 = p.lap || 0; let maxD = 0, resc = 0, was = false, t = 0;
    for (let f = 0; f < 60 * 150; f++){ K.soloRaceTick(1 / 60, {}); t += 1 / 60; const d = K.nearestCenterInfo(p.pos.x, p.pos.z).dist; if (d > maxD) maxD = d; const r = !!p.rescue; if (r && !was) resc++; was = r; if ((p.lap || 0) > lap0) break; }
    return { lapped: (p.lap || 0) > lap0, t: +t.toFixed(1), maxD: +maxD.toFixed(1), resc, lim: K.TRACK_WIDTH / 2 + (K.ACTIVE_TRACK.wallMargin || 7) + 2 };
  });
  check(`the bot completes a lap (${e.t} s)`, e.lapped, JSON.stringify(e));
  check("no rescue (never fell out of the world / into deep water)", e.resc === 0, e.resc);
  check(`never leaves the walled corridor (max ${e.maxD} u <= ${e.lim})`, e.maxD <= e.lim, JSON.stringify(e));
  check("C-E 0 pageerrors", errors.length === 0, errors.slice(0, 3).join(" | "));

  // ---------------- F: art ----------------
  console.log("\n[F] art pass");
  await page.waitForTimeout(1500);
  const f = await page.evaluate(async () => {
    const A = window.FK_YETI_ART && window.FK_YETI_ART.art, K = __KART__, out = {};
    if (!A) return { built: false };
    out.built = true; out.stats = A.stats;
    const bad = []; A.root.traverse((o) => { if (!o.isMesh) return; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (!(m.type === "MeshToonMaterial" || m.type === "MeshBasicMaterial" || (m.type === "ShaderMaterial" && o.name === "fkSkyDome"))) bad.push(o.name + ":" + m.type); });
    out.bad = bad.slice(0, 5);
    const half = K.TRACK_WIDTH / 2, intr = [];
    for (const r of A.registry){ if (r.road || r.overhead || r.decal || r.kind === "glow" || r.kind === "crowd") continue; const d = A.roadD(r.x, r.z); if (d < half + 1.5 + Math.min(r.r || 0, 2)) intr.push(r.kind + "@" + d.toFixed(1)); }
    out.intr = intr.slice(0, 8);
    // animation: advance the art clock, sample a ski-lift chair + the yeti arm
    const chair = new THREE.Matrix4(), chair2 = new THREE.Matrix4(); A.lift.mesh[0].getMatrixAt(0, chair);
    const arm0 = A.yeti.armR ? A.yeti.armR.rotation.z : null;
    A.update(0.5, (A.clock || 0) + 3.1); A.lift.mesh[0].getMatrixAt(0, chair2);
    out.chairMoved = chair.elements[12] !== chair2.elements[12] || chair.elements[14] !== chair2.elements[14];
    out.armMoved = A.yeti.armR ? A.yeti.armR.rotation.z !== arm0 : false;
    const ri = K.renderer.info.render; out.calls = ri.calls;
    return out;
  });
  check("the art pass built on yeti-ridge", f.built);
  if (f.built){
    const st = f.stats;
    check("every art material is toon / basic (+ the sky-dome shader)", f.bad.length === 0, f.bad.join(" "));
    check("nothing solid stands inside the road corridor (half-width + 1.5)", f.intr.length === 0, f.intr.join(" "));
    check(`start gantry clears the road by >= 6 u (${st.gantryClear})`, st.gantryClear >= 6);
    check(`ski-lift chairs clear the road by >= 6 u (${st.liftRoadClear})`, st.liftRoadClear >= 6);
    check("landmarks: cave ice, ski jump, gorge falls, yeti, ice road, lift towers", st.caveIce >= 1 && st.skiJump && st.gorge && st.yeti && st.iceRoad && st.liftTowers >= 5, JSON.stringify(st));
    check("village + corners dressed: >= 3 cabins, >= 6 chevron boards, candy-cane curbs", st.cabins >= 3 && st.chevrons >= 6 && st.curbStripes >= 100, `${st.cabins}/${st.chevrons}/${st.curbStripes}`);
    check("green grass tufts hidden on the snow", st.tuftsHidden >= 1, st.tuftsHidden);
    check("animated: ski-lift chairs ride the cable + the yeti waves", f.chairMoved && f.armMoved, `${f.chairMoved}/${f.armMoved}`);
    check(`draw calls within budget (${f.calls} <= 700)`, f.calls <= 700);
  }
  await page.close();
  // isolation: the art never builds elsewhere
  {
    const { page: p2, errors: e2 } = await open(browser, base, "moo-moo-farm");
    const r = await p2.evaluate(() => { __KART__.forceRace(); let yr = 0; __KART__.scene.traverse((o) => { if (o.name === "yrArt" || (o.userData && o.userData.yrKit)) yr++; }); return { art: !!(window.FK_YETI_ART && window.FK_YETI_ART.art), yr }; });
    check("moo-moo-farm: no Yeti Ridge art built", !r.art && r.yr === 0, JSON.stringify(r));
    check("moo-moo-farm: 0 pageerrors", e2.length === 0, e2.slice(0, 2).join(" | "));
    await p2.close();
  }

  // ---------------- G: 2026-10-12 playtest ----------------
  // "the bridge wall clips down into the road below", "candy canes and a pillar for the chair lift in the middle of the
  // road", "need a fence here to prevent falling over", "fully cloudy with a snowfall effect".
  console.log("\n[G] playtest: road obstructions, walls, overcast + snowfall");
  // every vertex of every visible mesh (instances included) that sits laterally inside a road (half-width - 0.3) and
  // 0.7..2.6 u above THAT road (the branch directly beneath it) is something a kart drives into. Intentional road
  // furniture is excluded by identity: karts, item boxes, ramps (jumps), water (the ford), trains + their crossing gates
  // (within 10 u of a rail/road crossing), crossing critters, the natural tunnel's own wall foot (tunnel span), particles.
  const SCAN = () => {
    const K = __KART__, C = K.centerPts, N = C.length, hw = K.TRACK_WIDTH / 2, TR = K.ACTIVE_TRACK;
    const under = (x, z, vy) => { let best = null; for (let i = 0; i < N; i++){ const c = C[i], dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz > (hw - 0.3) ** 2 || c.y > vy + 0.3) continue; if (!best || c.y > best.y) best = { y: c.y, i }; } return best; };
    const near = (x, z) => K.nearestCenterInfo(x, z).dist;
    const ramps = TR.objects.filter((o) => o.type === "ramp"), inRamp = (x, z) => ramps.some((r) => Math.hypot(x - r.x, z - r.z) < Math.max(r.sx, r.sz) * 0.75);
    const xings = []; for (const tr of (TR.trains || [])){ const P = tr.points; for (let k = 0; k < P.length; k++){ const a = P[k], b = P[(k + 1) % P.length], len = Math.hypot(b.x - a.x, b.z - a.z); for (let u = 0; u <= len; u += 2){ const x = a.x + (b.x - a.x) * u / len, z = a.z + (b.z - a.z) * u / len; if (near(x, z) < hw) xings.push({ x, z }); } } }
    const atXing = (x, z) => xings.some((q) => Math.hypot(x - q.x, z - q.z) < 10);
    const critters = (K.G.chickens || []).map((c) => ({ x: c.x, z: c.z })), atCritter = (x, z) => critters.some((c) => Math.hypot(x - c.x, z - c.z) < 3);   // crossing animals (hazards)
    const tunS = (TR.tunnels || []).map((t) => [t.s * K.TRACK_LEN - 2, t.s * K.TRACK_LEN + t.len + 2]);   // s = tunnel START
    const skipObj = (o) => { for (let q = o; q; q = q.parent){ const u = q.userData || {}; if (u.isItemBox || u.trains || u.fkToonKart || u.waterId || q.name === "fkParticles" || q.isPoints) return true; } return false; };
    // inside a tunnel bore the space up to 5 u must be clear (not just kart height): the glacier hill once sagged INTO
    // the cave as a grey snow wall (1..17 u across the last few units of the bore) that you drove through. The bore's own shell is skipped there.
    const tunShell = new Set(); if (K.TUNNEL_GROUP) K.TUNNEL_GROUP.traverse((c) => tunShell.add(c));
    const tunMid = (TR.tunnels || []).map((t) => [t.s * K.TRACK_LEN + 0.5, t.s * K.TRACK_LEN + t.len - 0.5]);
    const hits = {}; const v = new THREE.Vector3(), M = new THREE.Matrix4(), W = new THREE.Matrix4();
    K.scene.updateMatrixWorld(true);
    K.scene.traverse((o) => {
      if (!o.isMesh || skipObj(o)) return; for (let q = o; q; q = q.parent) if (!q.visible) return;
      const g = o.geometry, pos = g && g.attributes.position; if (!pos) return; if (!g.boundingSphere) g.computeBoundingSphere();
      for (let k = 0; k < (o.isInstancedMesh ? o.count : 1); k++){
        if (o.isInstancedMesh){ o.getMatrixAt(k, M); W.multiplyMatrices(o.matrixWorld, M); } else W.copy(o.matrixWorld);
        const cs = g.boundingSphere.center.clone().applyMatrix4(W), rad = g.boundingSphere.radius * W.getMaxScaleOnAxis();
        if (near(cs.x, cs.z) > hw + rad) continue;
        if (rad < 0.4) continue;   // butterflies / leaves / birds flitting over the road: smaller than a kart wheel, no collision
        for (let i = 0; i < pos.count; i++){
          v.fromBufferAttribute(pos, i).applyMatrix4(W); if (near(v.x, v.z) > hw - 0.3) continue;
          const u = under(v.x, v.z, v.y); if (!u) continue; const h = v.y - u.y;
          const inBore = tunMid.some(([a0, a1]) => K.arcS[u.i] > a0 && K.arcS[u.i] < a1);
          if (inBore && tunShell.has(o)) continue;
          if (h <= 0.7 || h >= (inBore ? 5 : 2.6)) continue;   // bore: clear to 5 u (the grey wall sat at 1..6 u; portal icicle tips are dressing at >= 5.3)
          if (inRamp(v.x, v.z) || atXing(v.x, v.z) || atCritter(v.x, v.z)) continue;
          if (tunS.some(([a0, a1]) => K.arcS[u.i] > a0 && K.arcS[u.i] < a1) && near(v.x, v.z) > hw - 1.5) continue;   // tunnel wall foot at the edge
          const key = (o.name || (o.parent && o.parent.name) || o.type) + (o.userData.bridgeWall ? "[bridgeWall]" : "") + " @" + Math.round(v.x / 8) * 8 + "," + Math.round(v.z / 8) * 8;
          hits[key] = Math.max(hits[key] || 0, +h.toFixed(1));
        }
      }
    });
    return Object.entries(hits).map(([k, h]) => k + " h" + h);
  };
  // walls: each side of the road has a wall within half+6 on >= minCov of the centreline; no wall segment passes within
  // half+0.3 of ANY centreline sample (fence collision is 2D: a wall over another road would stop karts on it)
  const WALLS = () => {
    const K = __KART__, C = K.centerPts, N = C.length, hw = K.TRACK_WIDTH / 2, walls = K.raceFences.filter((f) => f.tag === "corridor");
    const segD = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l)); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
    const cov = [0, 0]; let intrude = [];
    for (let i = 0; i < N; i++){ const t = K.tangents[i]; [-1, 1].forEach((side, si) => { const nx = -t.z * side, nz = t.x * side; let hit = false;
      for (let d = hw; d <= hw + 6 && !hit; d += 0.5){ const x = C[i].x + nx * d, z = C[i].z + nz * d; for (const w of walls){ for (let k = 0; k + 1 < w.points.length; k++) if (segD(x, z, w.points[k], w.points[k + 1]) < 0.5){ hit = true; break; } if (hit) break; } }
      if (hit) cov[si]++; }); }
    for (const w of walls) for (let k = 0; k + 1 < w.points.length; k++) for (let i = 0; i < N; i += 2){ const d = segD(C[i].x, C[i].z, w.points[k], w.points[k + 1]); if (d < hw + 0.3) intrude.push(w.id + "@" + C[i].x.toFixed(0) + "," + C[i].z.toFixed(0) + " d" + d.toFixed(1)); }
    return { walls: walls.length, cov: cov.map((c) => +(c / N).toFixed(3)), intrude: intrude.slice(0, 6) };
  };
  {
    const { page: pg, errors: eg } = await open(browser, base, "yeti-ridge");
    await pg.waitForFunction(() => { let n = 0; __KART__.scene.traverse((o) => { if (o.isInstancedMesh) n++; }); return n > 30; }, null, { timeout: 90000 });
    await pg.waitForTimeout(4000);
    const hits = await pg.evaluate(SCAN);
    check("Yeti: nothing solid at kart height over any road, nor anywhere inside the cave bore (scene-wide vertex scan)", hits.length === 0, hits.slice(0, 8).join(" | "));
    const w = await pg.evaluate(WALLS);
    // measured 0.900 / 0.905: the gaps are the overpass span (own walls), the glacier cave (tunnel walls), the low road
    // under the overpass (a 2D wall there would block the bridge above), the rail crossings and the critter crossings
    check(`Yeti: road-edge walls on both sides for >= 88% of the lap (${w.cov.join(" / ")}, ${w.walls} walls)`, w.cov[0] >= 0.88 && w.cov[1] >= 0.88, JSON.stringify(w));
    check("Yeti: no wall crosses another road's lane (2D fence collision)", w.intrude.length === 0, w.intrude.join(" | "));
    const b = await pg.evaluate(() => {
      const K = __KART__, br = K.ACTIVE_TRACK.bridges[0], C = K.centerPts, N = C.length, hw = K.TRACK_WIDTH / 2, out = { pillarsInRoad: 0, wallDip: 0 };
      const M = new THREE.Matrix4(), v = new THREE.Vector3(); K.scene.updateMatrixWorld(true);
      K.scene.traverse((o) => {
        if (o.isInstancedMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.width === 0.6 && o.geometry.parameters.depth === 0.6){   // bridge pillars (0.6 x 1 x 0.6)
          for (let k = 0; k < o.count; k++){ o.getMatrixAt(k, M); v.setFromMatrixPosition(M); const n = FK_TRACK.nearestOnCenterAtY({ centerPts: C, samples: N }, v.x, v.z, v.y - M.elements[5] / 2, K.TRACK_WIDTH); if (n.dist < hw) out.pillarsInRoad++; } }
        if (o.userData && o.userData.bridgeWall){ const p = o.geometry.attributes.position; let lo = 1e9; for (let i = 0; i < p.count; i++) lo = Math.min(lo, p.getY(i)); out.wallDip = Math.max(out.wallDip, +(9 - lo).toFixed(1)); out.wallLo = +lo.toFixed(1); }
      });
      return out;
    });
    check("Yeti overpass: no support pillar stands in the road below", b.pillarsInRoad === 0, JSON.stringify(b));
    check(`Yeti overpass: the side walls stay at deck height (lowest wall vertex ${b.wallLo} u, the deck is ~9 u up)`, b.wallLo > 6, JSON.stringify(b));
    const sky = await pg.evaluate(async () => {
      const A = FK_YETI_ART.art, st = A.stats, L = A.snowfall && A.snowfall.layers[0], p0 = L ? L.P.slice(0, 30) : null;
      A.update(0.25, 4.2); const moved = !!L && L.P.slice(0, 30).some((v, i) => Math.abs(v - p0[i]) > 1e-4);
      let presetFlakesVisible = 0; const sk = __KART__.skyObj || null;
      __KART__.scene.traverse((o) => { if (o.isInstancedMesh && o.material && o.material.map && o.geometry.type === "PlaneGeometry" && o.count >= 400){ let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) vis = false; if (vis) presetFlakesVisible++; } });
      const dome = A.dome.material.uniforms; const top = dome.uCols.value[dome.uCols.value.length - 1];
      return { overcast: !!st.overcast, clouds: st.clouds || 0, flakes: st.snowflakes || 0, moved, presetFlakesVisible, sunSize: dome.uSunSize.value, topSat: +(Math.max(top.r, top.g, top.b) - Math.min(top.r, top.g, top.b)).toFixed(3) };
    });
    check(`overcast sky: no sun disc, a grey zenith (saturation ${sky.topSat} < 0.15), a full cloud deck (${sky.clouds} >= 40)`, sky.overcast && sky.sunSize === 0 && sky.topSat < 0.15 && sky.clouds >= 40, JSON.stringify(sky));
    check(`snowfall: >= 3000 camera-facing flakes that fall (${sky.flakes}), the preset's flat quads hidden`, sky.flakes >= 3000 && sky.moved && sky.presetFlakesVisible === 0, JSON.stringify(sky));
    check("G (yeti): 0 pageerrors", eg.length === 0, eg.slice(0, 2).join(" | "));
    await pg.close();
  }
  {
    const { page: pg, errors: eg } = await open(browser, base, "harvest-hollow");
    await pg.waitForFunction(() => { let n = 0; __KART__.scene.traverse((o) => { if (o.isInstancedMesh) n++; }); return n > 30; }, null, { timeout: 90000 });
    await pg.waitForTimeout(4000);
    const w = await pg.evaluate(WALLS);
    // measured 0.950 / 0.948: gaps at the rail crossing, the critter step-outs and the ford pool
    check(`Harvest Hollow: road-edge walls on both sides for >= 92% of the lap (${w.cov.join(" / ")})`, w.cov[0] >= 0.92 && w.cov[1] >= 0.92, JSON.stringify(w));
    check("Harvest Hollow: no wall crosses another road's lane", w.intrude.length === 0, w.intrude.join(" | "));
    const hits = await pg.evaluate(SCAN);
    check("Harvest Hollow: nothing solid at kart height over the road (scene-wide vertex scan)", hits.length === 0, hits.slice(0, 8).join(" | "));
    check("G (harvest-hollow): 0 pageerrors", eg.length === 0, eg.slice(0, 2).join(" | "));
    await pg.close();
  }
  await browser.close(); srv.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
