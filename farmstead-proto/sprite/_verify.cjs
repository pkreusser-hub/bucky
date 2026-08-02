#!/usr/bin/env node
/* _verify.cjs — headless check + measurement harness for the sprite-impostor demo.
 *
 *   node farmstead-proto/sprite/_verify.cjs            checks only
 *   node farmstead-proto/sprite/_verify.cjs --shots     …and rewrite shots/fs_sprite_*.png
 *
 * Needs the repo served at http://localhost:8790 (tools/mobile-preview or the
 * bucky-static launch config). Uses tools/node_modules/puppeteer-core + real Chrome.
 *
 * NOTE ON FPS: headless Chrome here rasterises through ANGLE/SwiftShader on the
 * CPU. Frame rate is therefore meaningless in absolute terms (~20 fps whatever
 * you draw) — the numbers that carry the argument are draw calls and triangles,
 * which are API-level facts independent of the rasteriser.
 */
const path = require("path");
const REPO = path.resolve(__dirname, "..", "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));
const URL = "http://localhost:8790/farmstead-proto/sprite/spritedemo.html";
const SHOTS = path.join(REPO, "shots");
const DO_SHOTS = process.argv.includes("--shots");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++; failures.push(label + (extra !== undefined ? "  [" + extra + "]" : ""));
  return false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  const E = (fn, ...a) => page.evaluate(fn, ...a);
  const state = () => E(() => window.__SPRITE__.state());
  const set = (k, v) => E((kk, vv) => window.__SPRITE__.set(kk, vv), k, String(v));

  // ---------------------------------------------------------------- A. boot
  await page.goto(URL + "?count=200&mode=split&angles=16&cell=128", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__SPRITE__ && window.__SPRITE__.D.ready, { timeout: 180000 });
  await wait(2500);
  let s = await state();
  ok(s.ready, "A1 demo boots");
  ok(s.glbTris === 7600, "A2 villager GLB is the real 6000+800+800 asset", s.glbTris);
  ok(s.spawned === 1000, "A3 1000 units spawned on walkable land", s.spawned);
  ok(s.bake && s.bake.atlas === "2048x896", "A4 atlas is 16 angles x 7 poses x 128px", s.bake && s.bake.atlas);
  ok(s.bake.ms > 0 && s.bake.ms < 20000, "A5 bake completed in a sane time", s.bake.ms);
  ok(s.bake.pitchDeg === 52, "A6 bake pitch matches the game's start pitch", s.bake.pitchDeg);
  ok(s.staticBake && s.staticBake.n > 20, "A7 statics baked", s.staticBake && s.staticBake.n);
  ok(s.compare && s.compare.used.lum > 60, "A8 baked pixels are lit, not black", s.compare && s.compare.used.lum);
  ok(s.spriteCount + s.meshCount === 200, "A9 split mode draws every unit exactly once",
    s.spriteCount + "+" + s.meshCount);
  ok(s.spriteCount > 20 && s.meshCount > 20, "A10 split actually splits the board",
    s.spriteCount + "/" + s.meshCount);

  // -------------------------------------------------- B. objective measurements
  const MEAS = { modes: [], bakes: [], pop: [], light: {} };
  console.log("\n--- draw calls / triangles by mode and unit count ---");
  console.log("  units  mode     calls        tris    sprites/meshes drawn");
  for (const count of [50, 200, 1000]) {
    await set("count", count);
    for (const mode of ["sprite", "mesh", "split"]) {
      await set("mode", mode);
      await wait(1400);
      const st = await state();
      MEAS.modes.push({ count, mode, calls: st.calls, tris: st.triangles, fps: st.fps, sp: st.spriteCount, me: st.meshCount });
      console.log("  " + String(count).padStart(5) + "  " + mode.padEnd(7) +
        String(st.calls).padStart(6) + String(st.triangles.toLocaleString()).padStart(12) +
        "    " + st.spriteCount + " / " + st.meshCount);
    }
  }
  const spl1000 = MEAS.modes.find((m) => m.count === 1000 && m.mode === "split");
  ok(spl1000.sp > 100 && spl1000.me > 100, "B0 split really splits at 1000 units",
    spl1000.sp + "/" + spl1000.me);
  const spr1000 = MEAS.modes.find((m) => m.count === 1000 && m.mode === "sprite");
  const msh1000 = MEAS.modes.find((m) => m.count === 1000 && m.mode === "mesh");
  ok(spr1000.calls <= 6, "B1 1000 sprites fit in <=6 draw calls", spr1000.calls);
  ok(spr1000.tris < msh1000.tris / 100, "B2 sprites cut triangles by >100x at 1000 units",
    msh1000.tris + " -> " + spr1000.tris);
  ok(msh1000.tris > 7e6, "B3 the mesh baseline really is ~7.6M tris", msh1000.tris);

  console.log("\n--- bake cost / atlas size ---");
  console.log("  angles  px    atlas          MB     ms");
  await set("count", 200);
  for (const angles of [8, 16]) {
    for (const cell of [64, 128, 256]) {
      await set("angles", angles);
      await set("cell", cell);
      await wait(900);
      const st = await state();
      MEAS.bakes.push({ angles, cell, atlas: st.bake.atlas, mb: st.bake.mb, ms: st.bake.ms });
      console.log("  " + String(angles).padStart(6) + String(cell).padStart(5) + "  " +
        st.bake.atlas.padEnd(12) + String(st.bake.mb).padStart(7) + String(st.bake.ms).padStart(8));
      ok(st.bake.atlas === (angles * cell) + "x" + (7 * cell),
        "B-bake " + angles + "/" + cell + " atlas dims", st.bake.atlas);
    }
  }

  // ---- C. the orbit test: frames AND pixels must change when the camera turns
  await set("angles", 16); await set("cell", 128);
  await set("mode", "sprite"); await set("count", 200);
  await wait(900);
  const orbit = await E(async () => {
    const H = window.__SPRITE__;
    H.pause(true);                                   // freeze the sim: only the camera moves
    const out = [];
    for (const yaw of [0, 0.393, 0.785, 2.0, 4.0]) {
      H.setCam({ yaw });
      const r = H.renderOnce();
      out.push({ yaw, frames: H.frames(24).slice(), hash: r.hash, mean: r.mean });
    }
    H.pause(false);
    return out;
  });
  const base = orbit[0];
  const oneBin = orbit[1];                            // 2*pi/16 = 0.3927 rad = exactly one bin
  let changed = 0;
  for (let i = 0; i < base.frames.length; i++) if (base.frames[i] !== oneBin.frames[i]) changed++;
  ok(changed >= base.frames.length * 0.8,
    "C1 one 22.5-degree orbit step swaps the atlas frame on ~every unit",
    changed + "/" + base.frames.length);
  ok(base.hash !== oneBin.hash, "C2 …and the rendered pixels change with it");
  ok(orbit[3].hash !== base.hash && orbit[4].hash !== base.hash, "C3 large orbits render differently too");
  /* quantisation, measured on ONE unit whose facing we pin so its bin centre is
   * known: a small orbit inside the bin must not move the frame at all, a full
   * bin must move it by exactly one column. */
  const quant = await E(() => {
    const H = window.__SPRITE__, u = H.units();
    H.pause(true);
    u[0].yaw = 0; u[0].moving = false;               // idle row, front bin
    const at = (yaw) => { H.setCam({ yaw }); H.renderOnce(); return H.frames(1)[0]; };
    const r = { c0: at(0), cSmall: at(0.05), cFull: at(Math.PI * 2 / 16), cTwo: at(Math.PI * 4 / 16) };
    H.pause(false);
    return r;
  });
  ok(quant.c0 === quant.cSmall, "C4a a 3-degree orbit does NOT change the frame (quantised)",
    quant.c0 + " -> " + quant.cSmall);
  ok(quant.cFull === quant.c0 + 1 && quant.cTwo === quant.c0 + 2,
    "C4b a full bin steps the atlas column by exactly one",
    [quant.c0, quant.cFull, quant.cTwo].join(","));

  // ---- angle-pop magnitude: pixel delta across exactly one bin, 8 vs 16 vs mesh
  console.log("\n--- angle pop: mean |pixel delta| across one atlas bin ---");
  for (const cfg of [{ mode: "sprite", angles: 8 }, { mode: "sprite", angles: 16 }, { mode: "mesh", angles: 16 }]) {
    await set("angles", cfg.angles);
    await set("mode", cfg.mode);
    await wait(900);
    const step = cfg.mode === "mesh" ? (Math.PI * 2 / 16) : (Math.PI * 2 / cfg.angles);
    const d = await E(async (st) => {
      const H = window.__SPRITE__;
      H.pause(true);
      H.setCam({ yaw: 0 }); const a = H.renderOnce();
      H.setCam({ yaw: st }); const b = H.renderOnce();
      H.setCam({ yaw: st / 8 }); const c = H.renderOnce();   // a tiny nudge, for scale
      H.pause(false);
      return { full: Math.abs(b.mean - a.mean), tiny: Math.abs(c.mean - a.mean) };
    }, step);
    MEAS.pop.push({ mode: cfg.mode, angles: cfg.angles, full: d.full, tiny: d.tiny });
    console.log("  " + (cfg.mode + "/" + cfg.angles + " angles").padEnd(20) +
      "one-bin " + d.full.toFixed(3) + "   1/8-bin " + d.tiny.toFixed(3));
  }

  // ---- D. lighting-cohesion probe: lit bake vs flat bake vs the mesh, same scene
  console.log("\n--- lighting cohesion (mean luminance of the same framing) ---");
  await set("angles", 16);
  for (const cfg of [{ mode: "mesh", light: "lit" }, { mode: "sprite", light: "lit" }, { mode: "sprite", light: "flat" }]) {
    await set("lightMode", cfg.light);
    await set("mode", cfg.mode);
    await wait(1200);
    const r = await E(() => { const H = window.__SPRITE__; H.pause(true); H.setCam({ yaw: 0.55 }); const x = H.renderOnce(); H.pause(false); return x; });
    MEAS.light[cfg.mode + ":" + cfg.light] = r.mean;
    console.log("  " + (cfg.mode + " / " + cfg.light + " bake").padEnd(24) + r.mean.toFixed(2));
  }
  const dLit = Math.abs(MEAS.light["sprite:lit"] - MEAS.light["mesh:lit"]);
  const dFlat = Math.abs(MEAS.light["sprite:flat"] - MEAS.light["mesh:lit"]);
  ok(dLit < 8, "D1 lit-bake sprites sit within 8/255 mean luminance of the mesh", dLit.toFixed(2));
  console.log("  -> lit delta " + dLit.toFixed(2) + " | flat+tint delta " + dFlat.toFixed(2));

  /* the sharper cohesion number: render the IDENTICAL frozen scene as meshes,
   * then as sprites, and diff the two images pixel for pixel. */
  console.log("\n--- mesh-vs-sprite image difference (identical scene + camera) ---");
  for (const light of ["lit", "flat"]) {
    const d = await E(async (lm) => {
      const H = window.__SPRITE__;
      H.pause(true);
      H.set("lightMode", lm);
      await new Promise((r) => setTimeout(r, 400));    // let the re-bake land
      H.setCam({ yaw: 0.55, pitch: 0.9076 });
      H.set("mode", "mesh"); H.renderOnce(); H.capture();
      H.set("mode", "sprite");
      const out = H.diffFromCapture();
      H.pause(false);
      return out;
    }, light);
    MEAS.light["diff:" + light] = d;
    console.log("  " + (light + " bake").padEnd(12) + "mean |delta| " + d.mean +
      "/255   pixels differing >12: " + d.pctDiffer + "%");
  }
  ok(MEAS.light["diff:lit"].pctDiffer < 12,
    "D2 swapping every mesh for a sprite changes <12% of the frame",
    MEAS.light["diff:lit"].pctDiffer + "%");

  // ---- E. every toggle, no pageerrors
  await set("lightMode", "lit");
  for (const [k, v] of [["walk", "0"], ["walk", "1"], ["shadows", "0"], ["shadows", "1"],
    ["billboard", "axis"], ["billboard", "view"], ["bias", "0"], ["bias", "0.22"],
    ["tint", "1"], ["tint", "0"], ["pitchFix", "0"], ["pitchFix", "1"],
    ["statics", "mesh"], ["statics", "sprite"], ["statics", "off"]]) {
    await set(k, v);
    await wait(260);
  }
  const st2 = await state();
  ok(st2.ready && st2.calls > 0, "E1 still rendering after every toggle", st2.calls);

  await set("statics", "sprite"); await wait(900);
  const stStat = await state();
  ok(stStat.calls > 0, "E2 static impostors render");
  await set("statics", "off");

  // cylindrical billboard must produce a visibly different frame from view-aligned
  const bbDiff = await E(() => {
    const H = window.__SPRITE__;
    H.pause(true); H.set("billboard", "view"); const a = H.renderOnce();
    H.set("billboard", "axis"); const b = H.renderOnce();
    H.set("billboard", "view"); H.pause(false);
    return a.hash !== b.hash;
  });
  ok(bbDiff, "E3 the two billboard modes really differ");

  // ---- E4 the panel itself: REAL clicks, not just the test hook
  await set("mode", "split"); await wait(400);
  await page.click('#ui button[data-k="mode"][data-v="sprite"]');
  await wait(700);
  const clicked = await state();
  ok(clicked.mode === "sprite" && clicked.meshCount === 0,
    "E4 clicking a real panel button switches mode", clicked.mode + "/" + clicked.meshCount);
  const onClass = await E(() => document.querySelector('#ui button[data-k="mode"][data-v="sprite"]').classList.contains("on"));
  ok(onClass, "E5 …and the button lights up");
  await page.click('#ui button[data-k="mode"][data-v="split"]');
  await wait(500);

  // ---- F. per-instance tint (the player-colour question)
  const tinted = await E(() => {
    const H = window.__SPRITE__;
    H.pause(true); H.set("tint", "0"); const a = H.renderOnce();
    H.set("tint", "1"); const b = H.renderOnce();
    H.set("tint", "0"); H.pause(false);
    return { differ: a.hash !== b.hash, before: a.mean, after: b.mean };
  });
  ok(tinted.differ, "F1 per-instance tint changes the render (player colours are free)",
    tinted.before + " -> " + tinted.after);

  // ---------------------------------------------------------------- G. shots
  if (DO_SHOTS) {
    console.log("\n--- screenshots ---");
    await set("count", 200); await set("mode", "split"); await set("angles", 16); await set("cell", 128);
    await E(() => window.__SPRITE__.pause(false));
    await wait(3500);
    const centre = await E(() => {
      const u = window.__SPRITE__.units();
      let sx = 0, sz = 0;
      for (let i = 0; i < 200; i++) { sx += u[i].x; sz += u[i].z; }
      return { x: sx / 200, z: sz / 200, y: window.SpriteWorld.heightAt(sx / 200, sz / 200) };
    });
    const shot = async (n, ms) => { await wait(ms || 1100); await page.screenshot({ path: path.join(SHOTS, n) }); console.log("  " + n); };

    await E((c) => window.__SPRITE__.setCam({ tx: c.x, tz: c.z, ty: c.y, dist: 26, pitch: 0.9076, yaw: 0 }), centre);
    await shot("fs_sprite_sidebyside.png", 1400);

    /* closeup: PLANT one sprite and one mesh side by side across the midline on
     * the flattest grass we can find, so the pair is deterministic and framed. */
    const near = await E(() => {
      const H = window.__SPRITE__, W = window.SpriteWorld, u = H.units(), mid = H.midX();
      H.pause(true);
      document.getElementById("ui").style.visibility = "hidden";
      let best = null;
      for (let k = 0; k < 4000; k++) {
        const z = 12 + (k * 7919 % 1000) / 1000 * 60;
        const y0 = W.heightAt(mid, z);
        if (W.terrAt(mid, z) !== 1) continue;                // grass only
        let spread = 0;
        for (const [dx, dz] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) spread += Math.abs(W.heightAt(mid + dx, z + dz) - y0);
        if (!best || spread < best.spread) best = { spread, z, y: y0 };
      }
      const z = best.z;
      u[0].x = mid - 0.75; u[0].z = z; u[0].y = W.heightAt(u[0].x, z); u[0].yaw = 0.35; u[0].moving = true; u[0].phase = 1.4;
      u[1].x = mid + 0.75; u[1].z = z; u[1].y = W.heightAt(u[1].x, z); u[1].yaw = 0.35; u[1].moving = true; u[1].phase = 1.4;
      for (let i = 2; i < u.length; i++) { u[i].x = -600; u[i].z = -600; }
      return { x: mid, z, y: best.y };
    });
    await E((s) => window.__SPRITE__.setCam({ tx: s.x, tz: s.z, ty: s.y + 0.42, dist: 4.6, pitch: 0.9076, yaw: 0 }), near);
    await wait(1400);
    await page.screenshot({ path: path.join(SHOTS, "fs_sprite_closeup.png"), clip: { x: 340, y: 230, width: 600, height: 380 } });
    console.log("  fs_sprite_closeup.png  (left = sprite impostor, right = 3D mesh)");
    await E(() => {
      document.getElementById("ui").style.visibility = "";
      window.__SPRITE__.set("count", "200");
      window.__SPRITE__.pause(false);
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__SPRITE__ && window.__SPRITE__.D.ready, { timeout: 180000 });
    await E(() => { const H = window.__SPRITE__; H.set("count", "200"); H.set("mode", "split"); });
    await wait(3500);

    await E((c) => window.__SPRITE__.setCam({ tx: c.x, tz: c.z, ty: c.y, dist: 20, pitch: 0.9076, yaw: 0 }), centre);
    await shot("fs_sprite_orbit_a.png", 1200);
    await E(() => window.__SPRITE__.setCam({ yaw: 2.094 }));
    await shot("fs_sprite_orbit_b.png");
    await E(() => window.__SPRITE__.setCam({ yaw: 4.189 }));
    await shot("fs_sprite_orbit_c.png");

    await E(() => { const H = window.__SPRITE__; H.pause(false); H.set("count", "1000"); H.set("mode", "sprite"); });
    await E((c) => window.__SPRITE__.setCam({ tx: c.x, tz: c.z, ty: c.y, dist: 44, pitch: 0.9076, yaw: 0.55 }), centre);
    await shot("fs_sprite_1000units.png", 2600);

    await E(() => { const H = window.__SPRITE__; H.set("count", "50"); H.set("mode", "sprite"); H.set("statics", "mesh"); });
    const stc = await E(() => {
      const u = window.__SPRITE__.units();
      return { x: u[0].x, z: u[0].z, y: window.SpriteWorld.heightAt(u[0].x, u[0].z) };
    });
    await E((c) => window.__SPRITE__.setCam({ tx: c.x, tz: c.z, ty: c.y + 1.5, dist: 22, pitch: 0.78, yaw: 0.3 }), stc);
    await shot("fs_sprite_statics_mesh.png", 1600);
    await E(() => window.__SPRITE__.set("statics", "sprite"));
    await shot("fs_sprite_statics_impostor.png", 1600);
    await E(() => window.__SPRITE__.setCam({ yaw: 1.9 }));
    await shot("fs_sprite_statics_impostor_orbit.png", 1300);
    await E(() => window.__SPRITE__.set("statics", "mesh"));
    await shot("fs_sprite_statics_mesh_orbit.png", 1300);   // the same view, real geometry
  }

  // ------------------------------------- H. the low-poly cut the game now loads
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const err2 = [];
  p2.on("pageerror", (e) => err2.push(String(e.message || e)));
  await p2.goto(URL + "?count=1000&mode=mesh&variant=lo", { waitUntil: "domcontentloaded", timeout: 60000 });
  await p2.waitForFunction(() => window.__SPRITE__ && window.__SPRITE__.D.ready, { timeout: 180000 });
  await wait(3000);
  const lo = await p2.evaluate(() => window.__SPRITE__.state());
  console.log("\n--- the -lo-vc cut (what fs-models.js loads today) ---");
  console.log("  villager tris " + lo.glbTris + "   1000 units as meshes: " +
    lo.calls + " calls, " + lo.triangles.toLocaleString() + " tris");
  console.log("  its bake vs the 7600-tri bake: local contrast " + lo.compare.used.sharp +
    " vs " + lo.compare.other.sharp + ", luminance " + lo.compare.used.lum + " vs " + lo.compare.other.lum);
  ok(lo.glbTris === 2039, "H1 the low-poly villager is 2039 tris", lo.glbTris);
  ok(lo.triangles < 2.2e6, "H2 1000 low-poly villagers stay under 2.2M tris", lo.triangles);
  ok(Math.abs(lo.compare.used.lum - lo.compare.other.lum) < 5,
    "H3 the low-poly cut bakes to the same sprite as the high-poly one",
    lo.compare.used.lum + " vs " + lo.compare.other.lum);
  ok(err2.length === 0, "H4 zero pageerrors on the lo variant", err2.join(" | "));
  await p2.close();

  // ---------------------------------------------------------------- wrap up
  ok(errors.length === 0, "Z1 zero pageerrors", errors.join(" | "));
  console.log("\n" + (fail ? "FAIL" : "PASS") + "  " + pass + "/" + (pass + fail));
  failures.forEach((f) => console.log("  x " + f));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
