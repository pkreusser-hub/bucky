#!/usr/bin/env node
"use strict";
/**
 * Headless verify: Farm Kart art-style prototypes (farmkart-styles.html).
 * Every registered style must honour the shared contract — same skeleton, clips that bind, hands that
 * actually reach the steering-wheel grips, a kart rig the game can drive, and a GLB that exports with
 * its skin + clips. Geometry is asserted in world units, not pixels.
 *
 *   node tools/_verify-fk-styles.cjs
 */
const path = require("path");
const fs = require("fs");
const http = require("http");

function loadPlaywright() {
  for (const p of ["playwright", "/opt/node22/lib/node_modules/playwright"]) {
    try { return require(p); } catch (_) {}
  }
  throw new Error("playwright not found");
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".glb": "model/gltf-binary", ".json": "application/json" };
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
  if (ok) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (detail ? "  — " + detail : "")); }
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${base}/farmkart-styles.html`);
  await page.waitForFunction(() => window.__FKS__, null, { timeout: 60000 });

  const ids = await page.evaluate(() => Object.keys(FKS.styles));
  console.log("styles: " + ids.join(", "));
  check("three styles registered (toon, lowpoly, clay)", ["toon", "lowpoly", "clay"].every((i) => ids.includes(i)), ids.join(","));

  for (const id of ids) {
    console.log(`\n[${id}]`);
    const r = await page.evaluate((id) => {
      const F = window.__FKS__; F.freeze(true); F.setStyle(id); F.setView("show");
      const st = F.stage(id), k = st.kart, R = st.racer, out = {};
      const S = FKS.styles[id];
      out.meta = { name: S.name, blurb: (S.blurb || "").length };
      // ---- kart contract
      out.wheels = k.wheels.length; out.front = k.wheels.filter((w) => w.front).length;
      out.exhausts = k.exhausts.length;
      out.hasSetColor = typeof k.setColor === "function";
      k.setColor(0x123456); const pm = k.paint[0] || null;
      out.paintApplied = pm ? pm.color.getHex() === 0x123456 : null;
      k.setColor(0xe5392f);
      // ---- skinned racer
      const mesh = R.mesh;
      out.isSkinned = !!mesh.isSkinnedMesh;
      out.boneNames = R.skeleton.bones.map((b) => b.name);
      const sw = mesh.geometry.attributes.skinWeight, si = mesh.geometry.attributes.skinIndex;
      let badW = 0, badI = 0;
      for (let i = 0; i < sw.count; i++) {
        const s = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
        if (Math.abs(s - 1) > 1e-3) badW++;
        for (const v of [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)]) if (!(v >= 0 && v < R.skeleton.bones.length)) badI++;
      }
      out.badWeights = badW; out.badIndex = badI; out.verts = sw.count;
      out.tris = mesh.geometry.index ? mesh.geometry.index.count / 3 : mesh.geometry.attributes.position.count / 3;
      out.mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).every((m) => m.skinning === true);
      // ---- every clip track resolves to a real bone property
      let unbound = [];
      for (const c of Object.values(st.clips)) for (const t of c.tracks) {
        const [node, prop] = t.name.split(".");
        const b = R.skeleton.bones.find((x) => x.name === node);
        if (!b || !(prop in b)) unbound.push(t.name);
      }
      out.unbound = unbound;
      out.clipNames = Object.keys(st.clips);
      // ---- IK: wrists sit on the grips at rest, while steering, and drop off for cheer
      const V = () => new THREE.Vector3();
      function gap() {
        st.kart.root.updateMatrixWorld(true);
        const hl = R.bones.hand_L.getWorldPosition(V()), hr = R.bones.hand_R.getWorldPosition(V());
        const gl = k.grips.L.getWorldPosition(V()), gr = k.grips.R.getWorldPosition(V());
        return { L: hl.distanceTo(gl), R: hr.distanceTo(gr), hl, hr, head: R.bones.head.getWorldPosition(V()) };
      }
      F.play("idle", id); F.step(60, 1 / 60);
      const g0 = gap(); out.ikIdle = [g0.L, g0.R];
      F.play("steerL", id); F.step(60, 1 / 60);
      out.wheelTurned = Math.abs(k.steerWheel.rotation.z);
      const g1 = gap(); out.ikSteer = [g1.L, g1.R];
      F.play("steerL", id); // toggle off
      F.play("cheer", id); F.step(50, 1 / 60);
      const g2 = gap(); out.cheerHandsAboveHead = Math.min(g2.hl.y, g2.hr.y) - g2.head.y; out.cheerGap = [g2.L, g2.R];
      F.play("cheer", id); F.step(50, 1 / 60);
      F.play("wave", id); F.step(50, 1 / 60);
      const g3 = gap(); out.wave = [g3.L, g3.R];
      F.play("wave", id); F.play("idle", id); F.step(40, 1 / 60);
      // ---- hit is a one-shot that hands the arms back to the wheel
      F.play("hit", id); F.step(20, 1 / 60); const g4 = gap(); out.hitMid = [g4.L, g4.R];
      F.step(120, 1 / 60); const g5 = gap(); out.hitAfter = [g5.L, g5.R]; out.overlayAfterHit = st.anim.state.overlay;
      // ---- wheels roll in race mode, front pair steers
      F.setView("race"); F.step(30, 1 / 60);
      const a0 = k.wheels.map((w) => w.spin.rotation.x); F.step(10, 1 / 60);
      const a1 = k.wheels.map((w) => w.spin.rotation.x);
      out.wheelsRoll = a0.every((v, i) => Math.abs(a1[i] - v) > 0.05);
      out.racerOnSeat = R.group.parent === k.seat;
      F.setView("show");
      return out;
    }, id);

    check(`${id}: name + blurb`, r.meta.name && r.meta.blurb > 40, JSON.stringify(r.meta));
    check(`${id}: 4 wheels, 2 steer`, r.wheels === 4 && r.front === 2, `${r.wheels}/${r.front}`);
    check(`${id}: has an exhaust`, r.exhausts >= 1, r.exhausts);
    check(`${id}: setColor repaints the body`, r.hasSetColor && r.paintApplied === true, String(r.paintApplied));
    check(`${id}: racer is one SkinnedMesh`, r.isSkinned);
    check(`${id}: shared 21-bone skeleton`, r.boneNames.length === 21 && r.boneNames[0] === "root" && r.boneNames.includes("hand_L") && r.boneNames.includes("ear_R"), r.boneNames.join(","));
    check(`${id}: skin weights sum to 1 on every vertex`, r.badWeights === 0, `${r.badWeights}/${r.verts}`);
    check(`${id}: skin indices in range`, r.badIndex === 0, r.badIndex);
    check(`${id}: all racer materials skinning:true (r128)`, r.mats);
    check(`${id}: racer under 25k tris`, r.tris < 25000, Math.round(r.tris));
    check(`${id}: every clip track binds to a bone`, r.unbound.length === 0, r.unbound.slice(0, 5).join(","));
    check(`${id}: 10 clips`, r.clipNames.length === 10, r.clipNames.join(","));
    // a wrist within 2 cm of its grip is "on the wheel"; arm reach must cover the kart's wheel placement
    check(`${id}: idle hands on grips (<2cm)`, r.ikIdle.every((d) => d < 0.02), r.ikIdle.map((d) => d.toFixed(3)).join("/"));
    check(`${id}: steering wheel turns`, r.wheelTurned > 1.0, r.wheelTurned.toFixed(2));
    check(`${id}: hands follow the turned wheel (<2cm)`, r.ikSteer.every((d) => d < 0.02), r.ikSteer.map((d) => d.toFixed(3)).join("/"));
    check(`${id}: cheer lifts both hands above the head`, r.cheerHandsAboveHead > 0.02, r.cheerHandsAboveHead.toFixed(3));
    check(`${id}: wave — left on the wheel, right off`, r.wave[0] < 0.02 && r.wave[1] > 0.15, r.wave.map((d) => d.toFixed(3)).join("/"));
    check(`${id}: hit throws hands off the wheel`, Math.max(...r.hitMid) > 0.15, r.hitMid.map((d) => d.toFixed(3)).join("/"));
    check(`${id}: after hit the hands are back on the wheel`, r.hitAfter.every((d) => d < 0.02) && r.overlayAfterHit === null, r.hitAfter.map((d) => d.toFixed(3)).join("/") + " " + r.overlayAfterHit);
    check(`${id}: wheels roll while racing`, r.wheelsRoll);
    check(`${id}: racer rides in the seat`, r.racerOnSeat);

    // ---- GLB export: binary glTF with a skin, 21 joints, racer + kart clips
    const glb = await page.evaluate((id) => new Promise((res) => {
      const F = window.__FKS__, st = F.stage(id);
      const hidden = []; st.kart.root.traverse((o) => { if (o.userData.noExport && o.visible) { o.visible = false; hidden.push(o); } });
      const clips = Object.values(st.clips).concat(FKS.kartClips(st.kart));
      new THREE.GLTFExporter().parse(st.kart.root, (buf) => {
        hidden.forEach((o) => (o.visible = true));
        const dv = new DataView(buf), magic = dv.getUint32(0, true), jsonLen = dv.getUint32(12, true);
        const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
        res({ magic, bytes: buf.byteLength, skins: (json.skins || []).length, joints: json.skins && json.skins[0] ? json.skins[0].joints.length : 0,
              anims: (json.animations || []).map((a) => a.name), clips: clips.length });
      }, { binary: true, animations: clips, onlyVisible: true });
    }), id);
    check(`${id}: GLB magic`, glb.magic === 0x46546c67, glb.magic.toString(16));
    check(`${id}: GLB has one skin with 21 joints`, glb.skins === 1 && glb.joints === 21, `${glb.skins}/${glb.joints}`);
    check(`${id}: GLB carries every racer + kart clip`, glb.anims.length === glb.clips && glb.anims.includes("cheer") && glb.anims.includes("kart_drive"), glb.anims.join(","));
    check(`${id}: GLB under 8 MB`, glb.bytes < 8e6, (glb.bytes / 1e6).toFixed(2) + " MB");
  }

  // ---- page chrome
  console.log("\n[page]");
  const ui = await page.evaluate(() => {
    const F = window.__FKS__; const out = {};
    F.setStyle("toon"); F.setView("race"); F.syncUI();
    out.stepHiddenToon = document.getElementById("stepRow").offsetParent === null;
    F.setStyle("clay"); F.syncUI();
    out.stepShownClay = document.getElementById("stepRow").offsetParent !== null;
    F.setView("compare"); F.step(5, 1 / 60);
    out.stages = Object.keys(F.stages).length;
    out.tabs = document.querySelectorAll("#styleSeg button").length;
    F.setView("race");
    return out;
  });
  check("stop-motion toggle hidden on non-stepped styles (geometry)", ui.stepHiddenToon);
  check("stop-motion toggle shown for clay", ui.stepShownClay);
  check("compare builds all three stages", ui.stages === 3, ui.stages);
  check("one tab per style", ui.tabs === 3, ui.tabs);
  await page.waitForTimeout(500);
  check("no page errors", errors.length === 0, errors.slice(0, 4).join(" | "));

  await browser.close(); srv.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
