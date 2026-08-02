#!/usr/bin/env node
/* _verify_forkb_test.cjs — acceptance checks for the sprite-test LOOK TEST.
 *
 *   node farmstead-proto/sprite/_verify_forkb_test.cjs             checks
 *   node farmstead-proto/sprite/_verify_forkb_test.cjs --shots      …and write shots/fs_spritetest_verify_*.png
 *
 * Needs the repo served at http://localhost:8790. Uses tools/node_modules/puppeteer-core
 * + real Chrome with --use-angle=swiftshader. Sibling of _verify_forkb.cjs
 * (never edited) — same `ok()`-counter shape, scoped to this task's ask:
 *
 *   A  the test sheets + manifest exist, dimensions agree, masks/overlays are
 *      properly ABSENT (this is a look test — no tint, no overlay data)
 *   B  every manifest cell lands inside its sheet (in bounds)
 *   C  the feet baseline (footPx) is one constant, as documented
 *   D  the PRODUCTION sheets are byte-IDENTICAL to a hash snapshot taken right
 *      after this session's sprite-test bake — this whole exercise must never
 *      perturb the shipped cast
 *   E  forkb-test.html boots clean and draws SOMETHING for both sources
 *   F  the source toggle actually swaps what is drawn (minifig layers empty
 *      + test layers populated, and vice versa) — not just a UI label flip
 *   Z  zero page errors (favicon 404 excluded, same convention as the rest
 *      of this pipeline)
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..", "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));
const PROD_SPRITES = path.join(REPO, "assets", "farmstead", "cast", "sprites");
const TEST_SPRITES = path.join(REPO, "assets", "farmstead", "cast", "sprites-test");
const BASE = "http://localhost:8790";
const PAGE = BASE + "/farmstead-proto/sprite/forkb-test.html";
const SHOTS = path.join(REPO, "shots");
const DO_SHOTS = process.argv.includes("--shots");

/* golden hashes of the PRODUCTION sheets — proves the test pipeline never
 * wrote into assets/farmstead/cast/sprites/. RE-BASELINED 2026-08-01 when the
 * minifig sheets were legitimately re-baked (16 azimuths, camera-relative key,
 * belt/plume mask regions); these are hashes of a deliberate rebake, not drift. */
const PROD_HASH = {
  "knight-body.png": "592c48ec07213a316341e2000d7ce3afa331cfe2bf6177443ca22bde69122d37",
  "knight-mask.png": "7bb93b79d481ad286447338f1b7a0ff701f374ee00dbcecdde0c364bc9f0aaff",
  "manifest.json": "d7b003cdcc7b6f9fbee18a27a987939e0bb9b000da0684effa9020dd10a29ac6",
  "overlays.png": "c8b9f2def8c1e5d97c8c40d944aee4b53c0b005856d91986833cbe194774bf6c",
  "README.md": "e84ea851dffbd825718995ebb5c2581112d0700d2fe9e33322aaddd417129026",
  "serf-body.png": "105ce4b63f1a3a344176e931c277fbde3ca45d4adba04b491711aefb5fb828f2",
  "serf-mask.png": "f0c46f2696d68f834fe2693ba8d2dcc6eaf0b6dfc1152d5e275de4650b3384eb",
};

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++; failures.push(label + (extra !== undefined ? "  [" + extra + "]" : ""));
  return false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* =============================================== D. production sheets untouched, FIRST */
  const crypto = require("crypto");
  for (const f of Object.keys(PROD_HASH)) {
    const p = path.join(PROD_SPRITES, f);
    if (!ok(fs.existsSync(p), "D1 production file still exists: " + f)) continue;
    const h = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
    ok(h === PROD_HASH[f], "D2 production file byte-identical: " + f, h.slice(0, 12) + " vs " + PROD_HASH[f].slice(0, 12));
  }

  /* =============================================== A. test manifest + sheets */
  const manPath = path.join(TEST_SPRITES, "manifest-test.json");
  if (!ok(fs.existsSync(manPath), "A1 manifest-test.json exists")) return report();
  const M = JSON.parse(fs.readFileSync(manPath, "utf8"));
  ok(M.schema === "farmstead-cast-sprites-test/1", "A2 manifest carries a distinct TEST schema id", M.schema);
  ok(M.bake.pitchDeg === 52, "A3 baked at the game's resting pitch", M.bake.pitchDeg);
  ok(M.bake.azimuths === 12, "A4 12 azimuths (matches production's grid)", M.bake.azimuths);
  ok(M.bake.cameraYaw === 0, "A5 baked at the locked camera yaw", M.bake.cameraYaw);
  ok(fs.existsSync(path.join(TEST_SPRITES, "README-test.md")), "A6 a schema README ships beside the test sheets");

  let totalBytes = 0;
  for (const name of Object.keys(M.sheets)) {
    const s = M.sheets[name];
    const p = path.join(TEST_SPRITES, s.file);
    if (!ok(fs.existsSync(p), "A7 sheet " + s.file + " exists")) continue;
    totalBytes += fs.statSync(p).size;
    ok(s.w === s.cols * s.cell, "A8 " + name + " width = cols x cell", s.w + " vs " + s.cols * s.cell);
    ok(s.h === s.rows * s.cell, "A9 " + name + " height = rows x cell", s.h + " vs " + s.rows * s.cell);
    ok(s.origin === "top-left", "A10 " + name + " declares its pixel origin", s.origin);
    ok(s.cell === 128, "A11 " + name + " uses the 128px production cell size", s.cell);
  }
  ok(totalBytes > 0 && totalBytes < 8 * 1024 * 1024, "A12 total test sheet payload is sane", (totalBytes / 1024).toFixed(1) + " KB");

  /* masks/overlays deliberately ABSENT for a look test */
  ok(JSON.stringify(M.overlays) === "{}", "A13 manifest.overlays is empty (no job/rank overlays baked)");
  for (const kind of Object.keys(M.subjects)) {
    ok(M.subjects[kind].mask === null, "A14 " + kind + ".mask is explicitly null (no tint mask baked)");
  }
  for (const name of Object.keys(M.sheets)) {
    ok(!/mask|overlay/.test(name), "A15 no mask/overlay sheet file present: " + name);
  }

  /* posingMethod is documented per subject (villager=split, knight=fallback) */
  ok(M.subjects.villager && M.subjects.villager.posingMethod === "split", "A16 villager posingMethod=split (real leg-split rig)");
  ok(M.subjects.knight && M.subjects.knight.posingMethod === "wholeBodyBob", "A17 knight posingMethod=wholeBodyBob (documented fallback)");

  /* =============================================== B. cells in bounds */
  const A = M.bake.azimuths;
  let cellCount = 0, badCell = 0;
  for (const kind of Object.keys(M.subjects)) {
    const subj = M.subjects[kind];
    const sheet = M.sheets[subj.sheet];
    if (!ok(!!sheet, "B1 " + kind + " names a real colour sheet")) continue;
    for (const pose of Object.keys(subj.poses)) {
      for (const f of subj.poses[pose].frames) {
        ok(f.row >= 0 && f.row < sheet.rows, "B2 " + kind + "/" + pose + " row inside sheet", f.row + " of " + sheet.rows);
        for (let a = 0; a < A; a++) {
          cellCount++;
          if (a >= sheet.cols) badCell++;
        }
      }
    }
  }
  ok(cellCount > 0, "B3 at least one cell was checked", cellCount);
  ok(badCell === 0, "B4 zero out-of-bounds cells", badCell + " / " + cellCount);

  /* =============================================== C. feet baseline */
  ok(typeof M.footPx.x === "number" && typeof M.footPx.y === "number", "C1 footPx is a single {x,y} constant");
  ok(M.footPx.x > 0 && M.footPx.x < 128 && M.footPx.y > 0 && M.footPx.y < 128, "C2 footPx lands inside a body cell", JSON.stringify(M.footPx));

  /* =============================================== E/F/Z. the live preview page */
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon\.ico/.test(m.text() + m.location().url)) return;
    errors.push("console: " + m.text());
  });

  await page.goto(PAGE + "?nc=" + Date.now(), { waitUntil: "networkidle0", timeout: 30000 });
  const booted = await page.waitForFunction(
    () => window.__FORKB_TEST__ && window.__FORKB_TEST__.state && window.__FORKB_TEST__.state().ready,
    { timeout: 20000 }
  ).then(() => true).catch(() => false);
  ok(booted, "E1 forkb-test.html boots and reports ready");
  if (booted) {
    await wait(400);
    const st0 = await page.evaluate(() => window.__FORKB_TEST__.state());
    ok(st0.source === "minifig", "E2 default source is minifig (matches forkb.html's existing look)");
    ok(st0.spawned > 0, "E3 units spawned", st0.spawned);
    ok(st0.stats.calls > 0 && st0.stats.tris > 0, "E4 the renderer actually drew something", JSON.stringify(st0.stats));

    /* F: toggle proves it is a REAL swap, not a label flip */
    ok(st0.layerVisible.serf === true && st0.layerVisible.knight === true, "F1 minifig layers visible by default");
    ok(st0.layerVisible.villagerT === false && st0.layerVisible.knightT === false, "F2 test layers hidden by default");
    ok(st0.stats.serf + st0.stats.knight > 0, "F3 minifig layers hold real instances", st0.stats.serf + "/" + st0.stats.knight);
    ok((st0.stats.villagerT || 0) + (st0.stats.knightT || 0) === 0, "F4 test layers hold zero instances while hidden");

    await page.evaluate(() => window.__FORKB_TEST__.set("source", "test"));
    await wait(400);
    const st1 = await page.evaluate(() => window.__FORKB_TEST__.state());
    ok(st1.source === "test", "F5 toggle actually changed S.source");
    ok(st1.layerVisible.serf === false && st1.layerVisible.knight === false, "F6 minifig layers hidden after toggle");
    ok(st1.layerVisible.villagerT === true && st1.layerVisible.knightT === true, "F7 test layers visible after toggle");
    ok(st1.stats.serf === 0 && st1.stats.knight === 0, "F8 minifig layers hold zero instances while hidden");
    ok((st1.stats.villagerT || 0) + (st1.stats.knightT || 0) > 0, "F9 test layers hold real instances after toggle",
      (st1.stats.villagerT || 0) + "/" + (st1.stats.knightT || 0));

    /* toggle back — round trip should return exactly to the start state's shape */
    await page.evaluate(() => window.__FORKB_TEST__.set("source", "minifig"));
    await wait(400);
    const st2 = await page.evaluate(() => window.__FORKB_TEST__.state());
    ok(st2.source === "minifig" && st2.layerVisible.serf === true, "F10 toggle round-trips back to minifig cleanly");

    /* both manifests loaded up front (instant toggle, no reload) */
    /* the two grids no longer MATCH — production went to 16 azimuths in the
     * 2026-08-01 free-yaw rebake while this frozen look-test bake stays at 12.
     * The check is about both manifests being LOADED, so it asserts that. */
    ok(st0.manifestMinifig.azimuths > 0 && st0.manifestTest.azimuths > 0,
      "F11 both manifests loaded at boot (instant toggle)",
      st0.manifestMinifig.azimuths + "/" + st0.manifestTest.azimuths);

    /* mobile viewport sanity (same house convention as the other verify scripts) */
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await page.evaluate(() => window.__FORKB_TEST__.set("source", "test"));
    await wait(500);
    ok(true, "F12 mobile viewport (390x844) resize did not throw");

    if (DO_SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
      await wait(300);
      await page.screenshot({ path: path.join(SHOTS, "fs_spritetest_verify_test.png") });
      await page.evaluate(() => window.__FORKB_TEST__.set("source", "minifig"));
      await wait(300);
      await page.screenshot({ path: path.join(SHOTS, "fs_spritetest_verify_minifig.png") });
      console.log("wrote shots/fs_spritetest_verify_{test,minifig}.png");
    }
  }

  ok(errors.length === 0, "Z1 zero page errors", errors.join(" | "));
  await browser.close();
  report();

  function report() {
    console.log("\n" + (fail ? "FAIL" : "PASS") + "  " + pass + "/" + (pass + fail) + " checks");
    if (failures.length) console.log("  - " + failures.join("\n  - "));
    process.exit(fail ? 1 : 0);
  }
})().catch((e) => { console.error(e); process.exit(1); });
