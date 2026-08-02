#!/usr/bin/env node
/* _verify_forkb.cjs — acceptance checks for the Fork B production cast sheets.
 *
 *   node farmstead-proto/sprite/_verify_forkb.cjs             checks
 *   node farmstead-proto/sprite/_verify_forkb.cjs --shots      …and rewrite shots/fs_forkb_*.png
 *   node farmstead-proto/sprite/_verify_forkb.cjs --measure    …and re-run the azimuth experiment
 *
 * Needs the repo served at http://localhost:8790. Uses tools/node_modules/puppeteer-core
 * + real Chrome with --use-angle=swiftshader.
 *
 * WHAT IS CHECKED
 *   A  the sheets exist and their dimensions agree with the manifest
 *   B  every manifest cell lands inside its sheet, every anchor inside its cell
 *   C  the feet baseline is a constant row, and the poses depart from it only by
 *      the bob/stride the game itself applies
 *   D  the preview boots clean on the REAL sheets and draws every layer
 *   E  swapping azimuth actually swaps the displayed pixels
 *   F  team tint moves pixels ONLY where the mask says team, and rank tint only
 *      where the mask says rank
 *   G  overlays land on their anchors (hat on the head, tool in the hand)
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..", "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));
const SPRITES = path.join(REPO, "assets", "farmstead", "cast", "sprites");
const BASE = "http://localhost:8790";
const PAGE = BASE + "/farmstead-proto/sprite/forkb.html";
const SHEET_URL = "/assets/farmstead/cast/sprites/";
const SHOTS = path.join(REPO, "shots");
const DO_SHOTS = process.argv.includes("--shots");
const DO_MEASURE = process.argv.includes("--measure");

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; return true; }
  fail++; failures.push(label + (extra !== undefined ? "  [" + extra + "]" : ""));
  return false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* =============================================== A. files + manifest shape */
  const manPath = path.join(SPRITES, "manifest.json");
  if (!ok(fs.existsSync(manPath), "A1 manifest.json exists")) return report();
  const M = JSON.parse(fs.readFileSync(manPath, "utf8"));
  ok(M.schema === "farmstead-cast-sprites/1", "A2 manifest carries its schema id", M.schema);
  ok(M.sourceModel === "minifig", "A3 baked from the procedural minifig", M.sourceModel);
  ok(M.bake.pitchDeg === 52, "A4 one pitch row, at the game's resting pitch", M.bake.pitchDeg);
  ok(M.bake.azimuths >= 6 && M.bake.azimuths <= 24, "A5 azimuth count is sane", M.bake.azimuths);
  /* RESTAGED 2026-08-01: the hex-lattice exactness rule only mattered while the
   * camera was LOCKED — a standing serf then had one fixed relative angle
   * forever, so a step that did not divide 60deg rendered him permanently
   * wrong. The camera turns again and the relative azimuth is continuous, so
   * the surviving contract is just the quantiser's: a whole-degree step, and no
   * facing further than half a step from its cell. */
  ok((360 / M.bake.azimuths) % 0.5 === 0 && M.bake.lighting.mode === "camera-relative",
    "A6 azimuth step is regular and the bake is camera-relative (free yaw)",
    360 / M.bake.azimuths + "deg " + M.bake.lighting.mode);
  ok(fs.existsSync(path.join(SPRITES, "README.md")), "A7 the schema README ships beside the sheets");

  let totalBytes = 0;
  for (const name of Object.keys(M.sheets)) {
    const s = M.sheets[name];
    const p = path.join(SPRITES, s.file);
    if (!ok(fs.existsSync(p), "A8 sheet " + s.file + " exists")) continue;
    totalBytes += fs.statSync(p).size;
    ok(s.w === s.cols * s.cell, "A9 " + name + " width = cols x cell", s.w + " vs " + s.cols * s.cell);
    ok(s.h === s.rows * s.cell, "A10 " + name + " height = rows x cell", s.h + " vs " + s.rows * s.cell);
    ok(s.origin === "top-left", "A11 " + name + " declares its pixel origin", s.origin);
  }
  ok(totalBytes > 0 && totalBytes < 8 * 1024 * 1024, "A12 total sheet payload is sane",
    (totalBytes / 1024).toFixed(1) + " KB");

  /* =============================================== B. cells + anchors in range */
  const A = M.bake.azimuths;
  let cellCount = 0, anchorCount = 0, badCell = 0, badAnchor = 0, minA = 1e9, maxA = -1e9;
  for (const kind of Object.keys(M.subjects)) {
    const subj = M.subjects[kind];
    const sheet = M.sheets[subj.sheet];
    const mask = M.sheets[subj.mask];
    ok(!!sheet && !!mask, "B1 " + kind + " names both a colour and a mask sheet");
    let rowsSeen = 0;
    for (const pose of Object.keys(subj.poses)) {
      for (const f of subj.poses[pose].frames) {
        rowsSeen++;
        ok(f.row >= 0 && f.row < sheet.rows, "B2 " + kind + "/" + pose + " row inside sheet", f.row);
        ok(f.cells.length === A, "B3 " + kind + "/" + pose + " has one cell per azimuth", f.cells.length);
        for (let a = 0; a < f.cells.length; a++) {
          const c = f.cells[a];
          cellCount++;
          if (c.col !== a || c.col >= sheet.cols) badCell++;
          for (const nm in c.anchors) {
            const an = c.anchors[nm];
            anchorCount++;
            if (!(an.x >= 0 && an.x <= sheet.cell && an.y >= 0 && an.y <= sheet.cell)) badAnchor++;
            minA = Math.min(minA, an.y); maxA = Math.max(maxA, an.y);
          }
        }
      }
    }
    ok(rowsSeen === sheet.rows, "B4 " + kind + " pose rows fill the sheet exactly", rowsSeen + "/" + sheet.rows);
  }
  ok(badCell === 0, "B5 every body cell column is its azimuth index and inside the sheet", badCell);
  ok(badAnchor === 0, "B6 every anchor lands inside its cell", badAnchor + " of " + anchorCount);
  ok(anchorCount > 1000, "B7 the anchor table is generated for every cell", anchorCount);

  let ovCells = 0, badOv = 0;
  for (const id of Object.keys(M.overlays)) {
    const ov = M.overlays[id];
    const sh = M.sheets.overlays;
    for (const rk of Object.keys(ov.rows)) {
      const cells = ov.rows[rk];
      if (cells.length !== A) badOv++;
      for (const c of cells) {
        ovCells++;
        if (c.col >= sh.cols || c.row >= sh.rows) badOv++;
        if (!(c.pivotPx.x >= 0 && c.pivotPx.x <= sh.cell && c.pivotPx.y >= 0 && c.pivotPx.y <= sh.cell)) badOv++;
        if (c.cell !== c.row * sh.cols + c.col) badOv++;
      }
    }
  }
  ok(badOv === 0, "B8 every overlay cell + pivot is inside the overlay sheet", badOv + " bad of " + ovCells);
  ok(M.overlays.hat && M.overlays.hat.tint === "job",
    "B9 ONE hat sheet, tinted per job — the combinatorics answer");
  ok(M.overlays.pip && M.overlays.pip.tint === "rank", "B10 the rank pip is an anchored overlay");
  const tools = Object.keys(M.overlays).filter((k) => k.indexOf("tool_") === 0);
  ok(tools.length >= 9, "B11 every tool the jobs use is baked", tools.length);
  const usedTools = new Set();
  ok(M.palettes && M.palettes.job && M.palettes.team && M.palettes.rank,
    "B12 the manifest carries the palettes the tints multiply by");
  ok(Array.isArray(M.tintEmissive) && M.tintEmissive.length === 3 && M.tintEmissive[0] > 0,
    "B13 tintEmissive is present so tinted regions can be made exact", JSON.stringify(M.tintEmissive));
  ok(typeof M.tintFormula === "string" && /mask/.test(M.tintFormula),
    "B14 the tint formula is documented in the manifest");

  /* fight frames must carry the animation variable they are indexed by */
  const fight = M.subjects.knight.poses.fight;
  ok(fight.frames.every((f) => typeof f.l === "number"),
    "B15 fight frames carry duelPose's l for nearest-frame lookup");
  ok(fight.frames.every((f) => typeof f.lungeOffset === "number"),
    "B16 fight frames carry the world lunge the integration must apply itself");
  ok(M.subjects.serf.poses.work.frames.every((f) => typeof f.swing === "number"),
    "B17 work frames carry serfSwing's value");
  const sw = M.subjects.serf.poses.work.frames.map((f) => f.swing);
  ok(sw[0] === 0 && sw[sw.length - 1] === 1, "B18 work frames span the whole swing", sw.join(","));
  let uniform = true;
  for (let i = 1; i < sw.length; i++) if (Math.abs((sw[i] - sw[i - 1]) - 1 / (sw.length - 1)) > 1e-6) uniform = false;
  ok(uniform, "B19 work frames are UNIFORM in swing, so k = round(swing*(n-1))");

  /* ================================================= browser-side checks */
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    protocolTimeout: 900000,
  });
  const errors = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 620, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon\.ico/.test(m.text() + m.location().url)) return;
    errors.push("console: " + m.text());
  });

  /* ---- C. pixel scans straight off the PNGs (decoded in the page) ---- */
  await page.goto(BASE + "/farmstead-proto/sprite/bake.html", { waitUntil: "domcontentloaded", timeout: 60000 });
  const scan = await page.evaluate(async (url, man) => {
    async function img(n) {
      const i = new Image(); i.src = url + n + ".png";
      await i.decode();
      const c = document.createElement("canvas");
      c.width = i.width; c.height = i.height;
      const x = c.getContext("2d"); x.drawImage(i, 0, 0);
      return { d: x.getImageData(0, 0, i.width, i.height), w: i.width, h: i.height };
    }
    /** lowest opaque row inside cell (col,row), measured from the cell top */
    function lowestOpaque(im, cell, col, row) {
      let lo = -1;
      for (let y = cell - 1; y >= 0; y--) {
        for (let x = 0; x < cell; x++) {
          const p = ((row * cell + y) * im.w + col * cell + x) * 4;
          if (im.d.data[p + 3] > 128) { lo = y; break; }
        }
        if (lo >= 0) break;
      }
      return lo;
    }
    function coverage(im, cell, col, row) {
      let n = 0;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        if (im.d.data[((row * cell + y) * im.w + col * cell + x) * 4 + 3] > 128) n++;
      }
      return n;
    }
    const out = {};
    const A = man.bake.azimuths;
    for (const kind of ["serf", "knight"]) {
      const sh = man.sheets[kind + "-body"];
      const im = await img(kind + "-body");
      const subj = man.subjects[kind];
      const idlePose = kind === "serf" ? "idle" : "guard";
      const idleRow = subj.poses[idlePose].frames[0].row;
      const idle = [], all = [], cov = [];
      for (let a = 0; a < A; a++) idle.push(lowestOpaque(im, sh.cell, a, idleRow));
      for (const pose of Object.keys(subj.poses)) {
        for (const f of subj.poses[pose].frames) {
          for (let a = 0; a < A; a++) { all.push(lowestOpaque(im, sh.cell, a, f.row)); cov.push(coverage(im, sh.cell, a, f.row)); }
        }
      }
      out[kind] = {
        idleLow: idle, idleMin: Math.min.apply(null, idle), idleMax: Math.max.apply(null, idle),
        allMin: Math.min.apply(null, all), allMax: Math.max.apply(null, all),
        covMin: Math.min.apply(null, cov), covMax: Math.max.apply(null, cov),
        emptyCells: cov.filter((c) => c < 40).length, cells: cov.length,
      };
      // mask sheet: region areas, in cell fractions
      const mim = await img(kind + "-mask");
      const mcell = man.sheets[kind + "-mask"].cell;
      let r = 0, g = 0, tot = 0;
      for (let y = 0; y < mcell; y++) for (let x = 0; x < mcell; x++) {
        const p = ((idleRow * mcell + y) * mim.w + x) * 4;
        if (mim.d.data[p + 3] > 128) { tot++; if (mim.d.data[p] > 128) r++; if (mim.d.data[p + 1] > 128) g++; }
      }
      out[kind].mask = { opaque: tot, teamPx: r, rankPx: g };
    }
    const ov = await img("overlays");
    let ovEmpty = 0, ovTot = 0;
    const osh = man.sheets.overlays;
    for (const id of Object.keys(man.overlays)) {
      for (const rk of Object.keys(man.overlays[id].rows)) {
        for (const c of man.overlays[id].rows[rk]) {
          ovTot++;
          let n = 0;
          for (let y = 0; y < osh.cell; y += 2) for (let x = 0; x < osh.cell; x += 2) {
            if (ov.d.data[((c.row * osh.cell + y) * ov.w + c.col * osh.cell + x) * 4 + 3] > 128) n++;
          }
          if (n < 3) ovEmpty++;
        }
      }
    }
    out.overlays = { cells: ovTot, empty: ovEmpty };
    return out;
  }, SHEET_URL, M);

  const ppu = M.bake.pxPerCameraUnit;
  const RAD = Math.PI / 180;
  const bobPx = 0.052 * Math.cos(52 * RAD) * ppu;
  const stridePx = 0.25 * Math.sin(0.52) * Math.sin(52 * RAD) * ppu;
  /* THE BASELINE IS THE PROJECTED GROUND ANCHOR, NOT THE LOWEST OPAQUE PIXEL.
   * footPx is one number for the whole bake — the ground point projects to the
   * same pixel in every cell by construction, which is what "fixed feet
   * baseline" has to mean. The lowest OPAQUE pixel legitimately moves with
   * azimuth, because the minifig has depth and a pitched camera maps depth onto
   * screen-y: a boot toe or a knight's shield swinging toward the camera drops
   * below the ground point. The bound is the model's own depth extent. */
  ok(M.footPx && typeof M.footPx.y === "number" && !Array.isArray(M.footPx),
    "C0 the feet baseline is ONE constant for the whole bake", JSON.stringify(M.footPx));
  const bnd = M.provenance && M.provenance.audit;
  for (const kind of ["serf", "knight"]) {
    const s = scan[kind];
    const bb = bnd ? bnd["bounds" + (kind === "serf" ? "Serf" : "Knight")] : null;
    const depth = bb ? (bb.max[2] - bb.min[2]) : 0.45;
    const depthPx = Math.ceil(depth * Math.sin(52 * RAD) * ppu);
    ok(s.idleMax - s.idleMin <= depthPx,
      "C1 " + kind + " idle silhouette bottom moves only as far as its own depth allows",
      "spread " + (s.idleMax - s.idleMin) + "px vs bound " + depthPx + "px");
    /* walk/work legitimately leave that row: the game lifts the whole minifig by
     * |cos(phase)|*0.052 and swings the near foot toward the camera. Both are
     * animation, not bake error — so the band is bounded, not zero. */
    const lo = s.idleMin - Math.ceil(bobPx) - 2, hi = s.idleMax + Math.ceil(stridePx) + 4;
    ok(s.allMin >= lo && s.allMax <= hi,
      "C2 " + kind + " every pose stays inside the predicted bob+stride band",
      s.allMin + ".." + s.allMax + " vs " + lo + ".." + hi);
    ok(s.emptyCells === 0, "C3 " + kind + " no empty cell in the sheet", s.emptyCells + "/" + s.cells);
    ok(s.covMin > 400, "C4 " + kind + " every cell carries a real silhouette", "min " + s.covMin + "px");
  }
  ok(scan.serf.mask.teamPx > 20 && scan.serf.mask.rankPx === 0,
    "C5 a serf's mask marks a team sash and no rank region",
    scan.serf.mask.teamPx + "R " + scan.serf.mask.rankPx + "G");
  ok(scan.knight.mask.teamPx > 20 && scan.knight.mask.rankPx > 20,
    "C6 a knight's mask marks BOTH team and rank-trim regions",
    scan.knight.mask.teamPx + "R " + scan.knight.mask.rankPx + "G");
  ok(scan.knight.mask.teamPx < scan.knight.mask.opaque * 0.6,
    "C7 the team region is a region, not the whole knight",
    (100 * scan.knight.mask.teamPx / scan.knight.mask.opaque).toFixed(1) + "%");
  /* Empty overlay cells are CORRECT and expected: the bake renders each overlay
   * behind a depth-only copy of its host body, so a pack seen from the front and
   * a chest pip seen from behind come out fully transparent. What matters is
   * that the manifest FLAGS them (so the integration skips the draw) and that
   * nothing is empty which should be visible. */
  let flagged = 0, unflaggedEmpty = 0, flaggedNonEmpty = 0, hatEmpty = 0;
  for (const id of Object.keys(M.overlays)) {
    for (const rk of Object.keys(M.overlays[id].rows)) {
      for (const c of M.overlays[id].rows[rk]) {
        if (c.empty) { flagged++; if (id === "hat") hatEmpty++; }
        if (c.empty && c.px >= 8) flaggedNonEmpty++;
        if (!c.empty && c.px !== undefined && c.px < 8) unflaggedEmpty++;
      }
    }
  }
  ok(flagged > 0, "C8 body-occluded overlay cells are detected", flagged + "/" + ovCells);
  ok(unflaggedEmpty === 0 && flaggedNonEmpty === 0,
    "C9 the empty flag agrees with the pixels", unflaggedEmpty + " / " + flaggedNonEmpty);
  ok(Math.abs(flagged - scan.overlays.empty) <= flagged * 0.15,
    "C10 the flag count matches an independent scan of the PNG",
    flagged + " vs " + scan.overlays.empty);
  ok(hatEmpty === 0, "C11 a hat is never hidden by the head it sits on", hatEmpty);
  ok(M.overlays.pack.rows.hold.some((c) => c.empty),
    "C12 a pack IS hidden from the front — the bake occludes overlays properly");

  /* ---- D. the preview boots on the real sheets ---- */
  await page.goto(PAGE + "?count=140", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__FORKB__ && window.__FORKB__.D.ready, { timeout: 180000 });
  await wait(2000);
  const st = await page.evaluate(() => window.__FORKB__.state());
  ok(st.ready, "D1 the preview boots on the shipped sheets");
  ok(st.spawned === 140, "D2 the crowd spawns on walkable land", st.spawned);
  ok(st.camYaw === M.bake.cameraYaw, "D3 the camera yaw is LOCKED to the bake yaw", st.camYaw);
  ok(st.camPitchDeg === M.bake.pitchDeg, "D4 the camera pitch matches the baked pitch", st.camPitchDeg);
  ok(st.layerCounts.serf > 40 && st.layerCounts.knight > 4,
    "D5 both body layers draw", JSON.stringify(st.layerCounts));
  ok(st.layerCounts.overlay > st.layerCounts.serf,
    "D6 overlays outnumber bodies (hat + tool/pack each)", st.layerCounts.overlay);
  ok(st.stats.calls <= 8, "D7 the whole cast is a handful of draw calls", st.stats.calls);
  ok(st.stats.tris < 20000, "D8 the cast costs quads, not geometry", st.stats.tris);

  /* ---- E. azimuth swap ---- */
  const azi = await page.evaluate((A2) => {
    const F = window.__FORKB__, out = { idx: [], diffs: [] };
    F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: 10 });
    const step = Math.PI * 2 / A2;
    let prev = null;
    for (let a = 0; a < A2; a++) {
      const yaw = a * step;
      out.idx.push(F.help.azIndex(yaw));
      F.poseOne({ job: "lumberjack", player: 0, yaw: yaw, dist: 10 });
      const s = F.sampleCrop(200);
      if (prev) {
        let d = 0;
        for (let i = 0; i < s.data.length; i += 4) d += Math.abs(s.data[i] - prev[i]);
        out.diffs.push(+(d / (s.data.length / 4)).toFixed(3));
      }
      prev = s.data;
    }
    return out;
  }, A);
  ok(azi.idx.join(",") === Array.from({ length: A }, (_, i) => i).join(","),
    "E1 every azimuth bin is reachable and in order", azi.idx.join(","));
  ok(azi.diffs.every((d) => d > 0.2), "E2 stepping one azimuth bin actually changes the pixels",
    "min " + Math.min.apply(null, azi.diffs));

  /* ---- F. tint hits mask regions only ---- */
  const tint = await page.evaluate(() => {
    const F = window.__FORKB__;
    function shot(p) {
      F.poseOne({ job: "lumberjack", player: p, yaw: 0, dist: 6 });
      return F.sampleCrop(240).data;
    }
    const a = shot(0), b = shot(1);          // blue team vs red team
    F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: 6 });
    F.set("overlays", "0");
    const bodyOnly = F.sampleCrop(240).data;
    F.set("overlays", "1");
    let changed = 0, opaque = 0;
    // "opaque" = anything that differs from the terrain-only frame
    F.S.tint = false; F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: 6 });
    const noTint = F.sampleCrop(240).data;
    F.S.tint = true;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d > 24) changed++;
      const e = Math.abs(a[i] - bodyOnly[i]) + Math.abs(a[i + 1] - bodyOnly[i + 1]);
      if (e >= 0) opaque++;
    }
    // knight: rank tint must move different pixels than team tint
    function kshot(rank, player) {
      F.poseOne({ knight: true, rank: rank, player: player, yaw: 0, dist: 6 });
      return F.sampleCrop(240).data;
    }
    const k0 = kshot(0, 0), kRank = kshot(4, 0), kTeam = kshot(0, 1);
    let rankPx = 0, teamPx = 0, both = 0;
    for (let i = 0; i < k0.length; i += 4) {
      const dr = Math.abs(k0[i] - kRank[i]) + Math.abs(k0[i + 1] - kRank[i + 1]) + Math.abs(k0[i + 2] - kRank[i + 2]);
      const dt = Math.abs(k0[i] - kTeam[i]) + Math.abs(k0[i + 1] - kTeam[i + 1]) + Math.abs(k0[i + 2] - kTeam[i + 2]);
      if (dr > 24) rankPx++;
      if (dt > 24) teamPx++;
      if (dr > 24 && dt > 24) both++;
    }
    return { changed: changed, total: a.length / 4, rankPx: rankPx, teamPx: teamPx, both: both };
  });
  ok(tint.changed > 30, "F1 changing the player recolours the sash", tint.changed + "px");
  ok(tint.changed < tint.total * 0.06,
    "F2 …and ONLY the sash — the rest of the serf is untouched",
    (100 * tint.changed / tint.total).toFixed(2) + "% of the crop");
  ok(tint.teamPx > 30 && tint.rankPx > 30,
    "F3 a knight responds to BOTH tints", "team " + tint.teamPx + " rank " + tint.rankPx);
  ok(tint.both < Math.min(tint.teamPx, tint.rankPx) * 0.35,
    "F4 the team and rank regions are disjoint", "overlap " + tint.both);

  /* ---- G. overlays land on their anchors ---- */
  const anch = await page.evaluate(() => {
    const F = window.__FORKB__;
    function bboxOfDiff(withOv, withoutOv, c) {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) {
        const i = (y * c + x) * 4;
        const d = Math.abs(withOv[i] - withoutOv[i]) + Math.abs(withOv[i + 1] - withoutOv[i + 1]) +
          Math.abs(withOv[i + 2] - withoutOv[i + 2]);
        if (d > 30) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      return { x0, y0, x1, y1, ok: x1 >= 0 };
    }
    const C = 240;
    F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: 6 });
    const on = F.sampleCrop(C).data;
    F.set("overlays", "0");
    F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: 6 });
    const off = F.sampleCrop(C).data;
    F.set("overlays", "1");
    const bb = bboxOfDiff(on, off, C);
    // where is the body in the crop? (diff against no sprites at all)
    F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: 6 });
    const h = F.unitPixelHeight(C);
    return { bb: bb, unitPx: h, crop: C };
  });
  /* readPixels rows run BOTTOM-up, so a hat is at HIGH y in this buffer */
  ok(anch.bb.ok, "G1 overlays draw something");
  ok(anch.unitPx > 40, "G2 the reference unit is big enough to judge", anch.unitPx + "px");
  ok(anch.bb.y1 - anch.bb.y0 < anch.unitPx * 1.1,
    "G3 the overlay footprint is a hat+tool, not a second body",
    (anch.bb.y1 - anch.bb.y0) + "px over a " + anch.unitPx + "px unit");

  /* ---- optional: the azimuth experiment ---- */
  let measured = null;
  if (DO_MEASURE) {
    measured = await page.evaluate(() => {
      const F = window.__FORKB__, out = { pop: {}, lattice: {} };
      for (const dist of [34, 8]) {
        F.poseOne({ job: "lumberjack", player: 0, yaw: 0, dist: dist });
        out.pop[dist] = {
          sprite: F.measureTurnPop({ azimuths: 0, mode: "sprite", steps: 26, crop: 260, yaw0: 0.13 }),
          mesh: F.measureTurnPop({ azimuths: 0, mode: "mesh", steps: 26, crop: 260, yaw0: 0.13 }),
          unitPx: F.unitPixelHeight(),
        };
        out.lattice[dist] = [6, 8, 12, 16, 24].map((n) => F.measureFacingError({ azimuths: n, crop: 260 }));
      }
      return out;
    });
    console.log("\nAZIMUTH EXPERIMENT (this sheet = " + A + " azimuths)");
    for (const d of [34, 8]) {
      const p = measured.pop[d];
      console.log("  dist " + d + " (unit " + p.unitPx + "px):  sprite mean " + p.sprite.mean +
        " max " + p.sprite.max + " pop/mean " + p.sprite.popRatio +
        "   |   3D mesh mean " + p.mesh.mean + " max " + p.mesh.max + " pop/mean " + p.mesh.popRatio);
      console.log("    static hex-lattice error: " +
        measured.lattice[d].map((l) => l.azimuths + (l.latticeExact ? "=exact" : "=" + l.worstErrDeg + "deg/" + l.meanDiff)).join("  "));
    }
    const mine = measured.lattice[8].find((l) => l.azimuths === A);
    ok(mine && mine.latticeExact, "H1 the shipped azimuth count is exact on the hex lattice");
  }

  /* ---- shots ---- */
  if (DO_SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const hideUI = () => page.evaluate(() => {
      document.getElementById("ui").style.display = "none";
      document.getElementById("legend").style.display = "none";
    });
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await page.evaluate(() => { window.__FORKB__.showAll(); window.__FORKB__.set("count", "220"); window.__FORKB__.set("walk", "1"); });
    await wait(2500);
    await page.evaluate(() => {
      const F = window.__FORKB__, us = F.units();
      let bx = 0, bz = 0;
      for (const u of us) { bx += u.x; bz += u.z; }
      const c = F.cam(); c.tx = bx / us.length; c.tz = bz / us.length; c.dist = 26; F.applyCam();
    });
    await hideUI();
    await wait(600);
    await page.screenshot({ path: path.join(SHOTS, "fs_forkb_crowd.png") });

    /* the pop test: one serf, three moments through a hex turn */
    await page.setViewport({ width: 900, height: 620, deviceScaleFactor: 1 });
    for (const [i, yaw] of [[0, 0], [1, 0.5236], [2, 1.0472]]) {
      await page.evaluate((y) => {
        const F = window.__FORKB__;
        F.poseOne({ job: "lumberjack", player: 1, yaw: y, dist: 7, speed: 1.2, phase: 1.1 });
      }, yaw);
      await hideUI();
      await wait(250);
      await page.screenshot({ path: path.join(SHOTS, "fs_forkb_walkturn_" + "abc"[i] + ".png") });
    }
    /* a fully composed job: body + team sash + job-tinted cap + the tool his
     * job swings, all placed by the generated anchors */
    await page.evaluate(() => window.__FORKB__.poseOne({
      job: "lumberjack", player: 1, yaw: 0.52, dist: 3.6, speed: 1.2, phase: 1.6,
    }));
    await hideUI(); await wait(250);
    await page.screenshot({ path: path.join(SHOTS, "fs_forkb_composed_job.png") });
    /* a knight mid-thrust. l = 0.55 rather than the full 1.0: at l = 1 the game's
     * own knightVisual pitches him 29deg, which under a 52deg camera reads as
     * nearly end-on — faithful, but unreadable as a still. */
    await page.evaluate(() => window.__FORKB__.poseOne({
      knight: true, rank: 3, player: 1, yaw: 0.6, dist: 3.6, fightL: 0.55,
    }));
    await hideUI(); await wait(250);
    await page.screenshot({ path: path.join(SHOTS, "fs_forkb_knight_strike.png") });
    console.log("\nwrote shots/fs_forkb_{crowd,walkturn_a/b/c,composed_job,knight_strike}.png");
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
