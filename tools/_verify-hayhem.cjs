#!/usr/bin/env node
"use strict";
/**
 * Headless smoke: Hayhem Stage 2 — ragdolls, blast impulse, water-out, carve intact.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8851;
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
          http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (r) => { r.resume(); res(); })
            .on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server timeout");
}

function check(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("  ✓ " + msg);
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], {
      cwd: ROOT, stdio: "ignore", shell: true,
    });
  }
  await waitServer(PORT, 20000);

  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));

  await page.goto(BASE + "/hayhem.html", { waitUntil: "networkidle0", timeout: 90000 });
  await page.waitForFunction(() => !!(window.__HAYHEM__), { timeout: 30000 });

  const titleOk = await page.evaluate(() => {
    const t = document.getElementById("title");
    const logo = document.querySelector(".logo");
    return {
      titleVisible: t && !t.classList.contains("hidden"),
      logo: logo && logo.textContent.trim(),
      bar: !!(document.querySelector("#bar a") && document.querySelector("#bar .t")),
    };
  });
  check(titleOk.titleVisible, "title screen visible");
  check(titleOk.logo === "HAYHEM", "logo reads HAYHEM");
  check(titleOk.bar, "Bucky back bar present");

  await page.click("#playBtn");
  await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 10000 });

  const afterStart = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const kinds = H.G.units.map((u) => u.kind);
    return {
      phase: H.phase,
      voxels: H.voxelCount(),
      spawns: H.G.spawns.length,
      units: H.G.units.length,
      teams0: H.G.spawns.filter((s) => s.team === 0).length,
      teams1: H.G.spawns.filter((s) => s.team === 1).length,
      hudOn: document.getElementById("hud").classList.contains("on"),
      goats: kinds.filter((k) => k === "goat").length,
      armas: kinds.filter((k) => k === "armadillo").length,
      dummies: H.G.units.filter((u) => u.dummy).length,
      ragBodies0: H.ragdollBodyCount(0),
      ragBodies3: H.ragdollBodyCount(3),
      modes: H.G.units.map((u) => u.mode),
    };
  });
  check(afterStart.phase === "aim", "phase is aim after PLAY");
  check(afterStart.voxels > 500, "voxel island built (" + afterStart.voxels + ")");
  check(afterStart.spawns === 6, "6 spawn points");
  check(afterStart.teams0 === 3 && afterStart.teams1 === 3, "3 spawns per side");
  check(afterStart.units === 6, "6 critter units");
  check(afterStart.goats === 3 && afterStart.armas === 3, "3 goats + 3 armadillos");
  check(afterStart.dummies === 3, "3 east-yard dummies");
  check(afterStart.ragBodies0 === 6, "ragdoll has 6 bodies (unit 0)");
  check(afterStart.ragBodies3 === 6, "ragdoll has 6 bodies (unit 3)");
  check(afterStart.modes.every((m) => m === "stiff"), "all units start stiff");
  check(afterStart.hudOn, "HUD on");

  const carve = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const before = H.voxelCount();
    const removed = H.forceCarve(10.5, 2.8, 0, 1.55);
    const after = H.voxelCount();
    return { before, removed, after };
  });
  check(carve.removed > 0, "carve removed cells (" + carve.removed + ")");
  check(carve.after < carve.before, "voxelCount decreased " + carve.before + " → " + carve.after);

  // blast impulse → ragdoll
  const blast = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const id = 3; // east armadillo
    const beforeMode = H.G.units[id].mode;
    const hits = H.blastNear(id, 1);
    const u = H.G.units[id];
    const torso = H.critters[id].bodies.torso;
    return {
      beforeMode,
      hits,
      mode: u.mode,
      spd: torso.velocity.length(),
    };
  });
  check(blast.beforeMode === "stiff", "target started stiff");
  check(blast.hits >= 1, "blast hit ≥1 critter");
  check(blast.mode === "ragdoll", "blast switched unit to ragdoll");
  check(blast.spd > 0.5, "torso received impulse (spd " + blast.spd.toFixed(2) + ")");

  // water-out path: drop a ragdoll into the pond and wait
  await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const id = 4;
    H.enableRagdoll(id);
    const c = H.critters[id];
    for (const b of c.bodyList) {
      b.type = 1; // DYNAMIC
      b.wakeUp();
      b.position.set(0.2, 0.45, 0.1);
      b.velocity.set(0, -0.5, 0);
      b.angularVelocity.set(1, 0.5, -0.8);
    }
    H.G.units[id].mode = "ragdoll";
    H.G.units[id].waterT = 0;
  });
  await page.waitForFunction(
    () => window.__HAYHEM__.G.units[4].out === true,
    { timeout: 8000 }
  );
  const waterOut = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    return {
      out: H.G.units[4].out,
      outs1: H.G.outs[1],
      scoreText: document.getElementById("eastOuts").textContent,
    };
  });
  check(waterOut.out, "pond water-out marked unit out");
  check(waterOut.outs1 >= 1, "east outs counted (" + waterOut.outs1 + ")");
  check(/out/i.test(waterOut.scoreText), "scoreboard shows out");

  // force remaining east outs → win
  const win = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    for (const u of H.G.units) {
      if (u.team === 1 && !u.out) H.forceWaterOut(u.id);
    }
    return {
      phase: H.phase,
      winner: H.G.winner,
      banner: document.getElementById("winBanner").classList.contains("on"),
    };
  });
  check(win.winner === 0, "west wins when all east out");
  check(win.phase === "won", "phase is won");
  check(win.banner, "win banner shown");

  // ballistic fire still works after restart
  await page.click("#againBtn");
  await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 10000 });
  const beforeShot = await page.evaluate(() => window.__HAYHEM__.voxelCount());
  await page.evaluate(() => window.__HAYHEM__.fireAt(18, 0.92, 0.38, 0.02));
  await page.waitForFunction(
    () => window.__HAYHEM__.phase === "aim" && !window.__HAYHEM__.G.projectile,
    { timeout: 20000 }
  );
  const shot = await page.evaluate((before) => {
    const H = window.__HAYHEM__;
    return {
      phase: H.phase,
      after: H.voxelCount(),
      before,
      shots: H.G.shotCount,
    };
  }, beforeShot);
  check(shot.shots >= 1, "at least one shot fired");
  check(shot.phase === "aim", "returned to aim after shot");
  check(shot.after <= shot.before, "voxels did not increase after shot");

  // ─── crosshair + sliders + FIRE (no slingshot release-to-fire) ───────────
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 10000 });

  const ui = await page.evaluate(() => {
    const fire = document.getElementById("fireBtn");
    const h = document.getElementById("heightSlider");
    const p = document.getElementById("powerSlider");
    const cs = fire ? getComputedStyle(fire) : null;
    return {
      fireVisible: !!(fire && cs && cs.display !== "none" && cs.visibility !== "hidden"),
      hasHeight: !!(h && h.type === "range"),
      hasPower: !!(p && p.type === "range"),
      maxPower: window.__HAYHEM__.getAim().maxPower,
      previewFrac: window.__HAYHEM__.getAim().previewFrac,
      hint: (document.getElementById("aimHint") || {}).textContent || "",
    };
  });
  check(ui.fireVisible, "FIRE button visible on desktop");
  check(ui.hasHeight && ui.hasPower, "HEIGHT + POWER sliders present");
  check(ui.maxPower === 44, "max power doubled to 44 (was 22)");
  check(ui.previewFrac === 0.4, "preview fraction is 40%");
  check(/FIRE/i.test(ui.hint), "aim hint mentions FIRE");
  check(/lock|click|Space/i.test(ui.hint), "aim hint mentions lock/click/Space");

  // Preview dry-run must match fire velocity; visible arc = first 40% by path length
  const aimAlign = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    const c = document.querySelector("#stage canvas");
    const rect = c.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.72;
    const cy = rect.top + rect.height * 0.42;
    const a = H.setAimFromScreen(cx, cy, 0.45, 0.7);
    const left = H.setAimFromScreen(rect.left + rect.width * 0.18, cy, 0.45, 0.7);
    return { a, left };
  });
  check(aimAlign.a && aimAlign.a.align != null, "setAimFromScreen returns align");
  check(aimAlign.a.align < 0.05, "preview end dir aligns with fire velocity (align=" + aimAlign.a.align + ")");
  check(aimAlign.a.arcVisible && aimAlign.a.reticleVisible, "arc + reticle visible while aiming");
  check(aimAlign.a.dir[0] > 0.25, "crosshair right of muzzle aims +X (dir.x=" + aimAlign.a.dir[0].toFixed(2) + ")");
  check(aimAlign.left.dir[0] < aimAlign.a.dir[0], "crosshair left aims more westward than right aim");
  check(
    Math.abs(aimAlign.a.pathFrac - 0.4) < 0.06,
    "preview path length ≈ 40% of full arc (got " + aimAlign.a.pathFrac.toFixed(3) + ")"
  );
  check(aimAlign.a.previewPts < aimAlign.a.fullPts, "preview has fewer points than full sim");
  check(aimAlign.a.maxPower === 44, "setAim reports maxPower 44");

  // Click locks aim; hover no longer moves; next click relocates; release does NOT fire
  const mouseAim = await page.evaluate(async () => {
    const H = window.__HAYHEM__;
    H.startMatch();
    H.setSliders(0.5, 0.65);
    const c = document.querySelector("#stage canvas");
    const rect = c.getBoundingClientRect();
    const x0 = rect.left + rect.width * 0.28;
    const y0 = rect.top + rect.height * 0.55;
    const x1 = rect.left + rect.width * 0.78;
    const y1 = rect.top + rect.height * 0.40;
    const x2 = rect.left + rect.width * 0.55;
    const y2 = rect.top + rect.height * 0.35;

    function ptr(type, x, y, buttons) {
      c.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: x, clientY: y,
        pointerId: 7, pointerType: "mouse", isPrimary: true,
        button: 0, buttons: buttons,
      }));
    }

    const unlocked = H.getAim().aimLocked;
    // Hover while unlocked should move crosshair
    ptr("pointermove", x0, y0, 0);
    const hoverFree = {
      locked: H.getAim().aimLocked,
      cx: H.getAim().crosshair && H.getAim().crosshair.x,
    };

    const shotsBefore = H.G.shotCount;
    // Click locks at x0
    ptr("pointerdown", x0, y0, 1);
    const midDown = H.getAim();
    const dirAtLock = midDown.dir.slice();
    // Drag while locked should NOT change aim
    ptr("pointermove", x1, y1, 1);
    const midDrag = H.getAim();
    ptr("pointerup", x1, y1, 0);
    const afterUp = {
      phase: H.phase,
      shots: H.G.shotCount,
      hasProj: !!H.G.projectile,
      aiming: H.getAim().aiming,
      locked: H.getAim().aimLocked,
      dir: H.getAim().dir.slice(),
      lockRing: H.getAim().lockRingOpacity,
    };
    // Hover while locked should NOT move aim
    ptr("pointermove", x1, y1, 0);
    const hoverLocked = {
      dir: H.getAim().dir.slice(),
      cx: H.getAim().crosshair && H.getAim().crosshair.x,
    };
    // Second click relocates locked aim
    ptr("pointerdown", x2, y2, 1);
    const relocated = H.getAim();
    ptr("pointerup", x2, y2, 0);

    // FIRE via button
    document.getElementById("fireBtn").click();
    const afterFire = {
      phase: H.phase,
      shots: H.G.shotCount,
      hasProj: !!H.G.projectile,
    };
    return {
      unlocked, hoverFree, midDown, midDrag, afterUp, hoverLocked, relocated,
      afterFire, shotsBefore, dirAtLock,
      dirX: midDown.dir[0],
      power: midDown.power,
    };
  });

  check(mouseAim.unlocked === false, "starts unlocked after startMatch");
  check(mouseAim.midDown.aimLocked === true, "pointerdown locks aim");
  check(mouseAim.midDown.lockRingOpacity > 0.5, "lock ring visible when locked");
  check(mouseAim.power >= 1.2, "power slider maps to power ≥1.2 (got " + mouseAim.power.toFixed(2) + ")");
  check(mouseAim.dirX !== undefined, "aim dir present after lock click");
  check(
    Math.abs(mouseAim.midDrag.dir[0] - mouseAim.dirAtLock[0]) < 1e-6 &&
    Math.abs(mouseAim.midDrag.dir[1] - mouseAim.dirAtLock[1]) < 1e-6,
    "drag while locked does NOT change aim dir"
  );
  check(
    mouseAim.afterUp.shots === mouseAim.shotsBefore && !mouseAim.afterUp.hasProj,
    "release does NOT fire (shots stay " + mouseAim.shotsBefore + ")"
  );
  check(mouseAim.afterUp.aiming === false, "aiming cleared after release");
  check(mouseAim.afterUp.locked === true, "stays locked after release");
  check(
    Math.abs(mouseAim.hoverLocked.dir[0] - mouseAim.dirAtLock[0]) < 1e-6,
    "hover while locked does NOT change aim"
  );
  check(
    Math.abs(mouseAim.relocated.dir[0] - mouseAim.dirAtLock[0]) > 0.01 ||
    Math.abs(mouseAim.relocated.dir[2] - mouseAim.dirAtLock[2]) > 0.01 ||
    Math.abs((mouseAim.relocated.crosshair && mouseAim.relocated.crosshair.x) -
      (mouseAim.midDown.crosshair && mouseAim.midDown.crosshair.x)) > 5,
    "second click relocates locked aim"
  );
  check(mouseAim.relocated.aimLocked === true, "relocated aim stays locked");
  check(
    mouseAim.afterFire.shots > mouseAim.shotsBefore || mouseAim.afterFire.hasProj || mouseAim.afterFire.phase === "flying",
    "FIRE button fires pumpkin (shots " + mouseAim.shotsBefore + "→" + mouseAim.afterFire.shots + ", phase=" + mouseAim.afterFire.phase + ")"
  );

  // Spacebar fires (same as FIRE); key repeat ignored
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 10000 });
  const spaceFire = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setSliders(0.5, 0.7);
    const before = H.G.shotCount;
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ", code: "Space", bubbles: true, cancelable: true, repeat: false,
    }));
    const after = { shots: H.G.shotCount, phase: H.phase, hasProj: !!H.G.projectile };
    // Wait briefly then try repeat — should not double-fire while flying
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: " ", code: "Space", bubbles: true, cancelable: true, repeat: true,
    }));
    const afterRepeat = { shots: H.G.shotCount, phase: H.phase };
    return { before, after, afterRepeat };
  });
  check(
    spaceFire.after.shots > spaceFire.before || spaceFire.after.hasProj || spaceFire.after.phase === "flying",
    "Spacebar fires pumpkin"
  );
  check(
    spaceFire.afterRepeat.shots === spaceFire.after.shots,
    "Space key-repeat does not fire again"
  );

  // Low power refuses to fire
  await page.evaluate(() => window.__HAYHEM__.startMatch());
  await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 10000 });
  const lowPower = await page.evaluate(() => {
    const H = window.__HAYHEM__;
    H.setSliders(0.4, 0.01);
    const before = H.G.shotCount;
    document.getElementById("fireBtn").click();
    return { before, after: H.G.shotCount, phase: H.phase, power: H.getAim().power };
  });
  check(lowPower.after === lowPower.before, "low power does not fire");
  check(lowPower.phase === "aim", "still in aim after low-power FIRE");

  // setSliders + fireAt API path
  await page.evaluate(() => {
    window.__HAYHEM__.startMatch();
    window.__HAYHEM__.setSliders(0.4, 0.8);
  });
  await page.waitForFunction(() => window.__HAYHEM__.phase === "aim", { timeout: 10000 });
  const sliderState = await page.evaluate(() => window.__HAYHEM__.getAim());
  check(sliderState.maxPower === 44, "getAim maxPower is 44");
  check(sliderState.power > 30, "setSliders 0.8 → power > 30 (got " + sliderState.power.toFixed(1) + ")");

  check(errors.length === 0, "0 pageerrors" + (errors.length ? ": " + errors.join("; ") : ""));

  console.log("\nHayhem Stage 2 smoke: PASS");
  await browser.close();
  if (server) server.kill();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
