#!/usr/bin/env node
/* _fs_bake_sprites.cjs — FORK B production sprite baker (headless driver).
 *
 *   node tools/_fs_bake_sprites.cjs                     bake the default config
 *   node tools/_fs_bake_sprites.cjs --azimuths 8        override any config key
 *   node tools/_fs_bake_sprites.cjs --contact           also write shots/fs_forkb_atlas.png
 *   node tools/_fs_bake_sprites.cjs --out some/dir      write somewhere else
 *   node tools/_fs_bake_sprites.cjs --source villager --out farmstead-proto/sprite/_v
 *                                                       bake the Tripo villager instead
 *
 * THE SOURCE MODEL IS A CONFIG SWITCH. `--source villager` runs the identical
 * pipeline — same azimuth grid, same locked scale, same pose maths, same
 * manifest schema — over the Tripo GLBs, and produces body + mask sheets. It
 * skips the overlay half only because that asset has no separable hat, tool or
 * pack to overlay. Do NOT write a villager bake over the shipped minifig sheets
 * unless the user has actually chosen to switch models.
 *
 * Needs the repo served at http://localhost:8790 (tools/mobile-preview.mjs, or the
 * `bucky-static` launch config). Uses tools/node_modules/puppeteer-core + real Chrome
 * with --use-angle=swiftshader.
 *
 * WHAT IT PRODUCES  (assets/farmstead/cast/sprites/ by default)
 *   serf-body.png     azimuth x pose colour cells, team region baked white
 *   serf-mask.png     same grid at 1/2 res, R = team region
 *   knight-body.png   ditto for the knight
 *   knight-mask.png   R = team region, G = rank-trim region
 *   overlays.png      hat / pack / every tool / rank pip, on the same azimuth grid
 *   manifest.json     grid geometry, pose->row map, per-cell anchor tables
 *   README.md         the schema, written from the manifest so it cannot drift
 *
 * The bake itself lives in farmstead-proto/sprite/fs-cast-bake.js — this file is
 * only the harness that opens a GL context, pulls the PNGs out and writes them.
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));

const PAGE = "http://localhost:8790/farmstead-proto/sprite/bake.html";
const DEFAULT_OUT = path.join(REPO, "assets", "farmstead", "cast", "sprites");

/* ---------------------------------------------------------------- args */
const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
}
const flag = (n) => argv.includes("--" + n);

/* THE CONFIG BLOCK. Everything the pipeline can be re-pointed at lives here;
 * any key is also settable from the command line. */
const CONFIG = {
  source: arg("source", "minifig"),      // "minifig" | "dwarfknight" | "villager"
  /* 12 → 16 (2026-08-01, camera yaw unlocked). 12 was chosen because a serf
   * rests on one of six 60° hex headings and 12 divides 60° exactly, so a
   * STANDING serf was never rendered at the wrong angle — an argument that only
   * holds under a locked camera. With free rotation the relative azimuth is
   * continuous, that static-error argument dissolves, and what is left is orbit
   * smoothness, where the demo's stepping signature (pop/mean) reads 12 → 5.0
   * against 16 → 3.3 (a real mesh is 1.3). Sheets grow 33%. */
  azimuths: +arg("azimuths", 16),
  cameraYaw: +arg("cameraYaw", 0),
  pitchDeg: +arg("pitchDeg", 52),        // FSC.CAM.PITCH_START
  bodyCell: +arg("bodyCell", 128),
  overlayCell: +arg("overlayCell", 64),
  /* per-subject in fs-cast-bake.js DEFAULTS ({serf:2, knight:1}); a numeric
   * --maskDiv overrides both */
  maskDiv: argv.includes("--maskDiv") ? +arg("maskDiv", 2) : undefined,
  /* 0 = the IDLE_VARIANTS table decides (3 slow loops x 3 frames) */
  idleFrames: +arg("idleFrames", 0),
  walkFrames: +arg("walkFrames", 8),
  workFrames: +arg("workFrames", 6),
};
/* A SECOND LOOK INHERITS THE FIRST LOOK'S FRUSTUM. Baking the dwarf+knight into
 * the same cx/cy/halfSpan the minifig sheets used means identical
 * pxPerCameraUnit and identical footPx, so the renderer's anchor arithmetic,
 * quad size and depth bias are the same numbers for both looks and the look
 * selector is genuinely just a base path. The bake ASSERTS the fit (it throws
 * rather than clipping a plume); pass --refit to let a source measure its own. */
if (CONFIG.source === "dwarfknight" && !flag("refit")) {
  const ref = JSON.parse(fs.readFileSync(path.join(DEFAULT_OUT, "manifest.json"), "utf8"));
  CONFIG.lockFrustum = ref.bake.frustum;
  CONFIG.lockFrustumFrom = "assets/farmstead/cast/sprites/manifest.json";
}
const OUT = path.resolve(arg("out", DEFAULT_OUT));
if (CONFIG.source !== "minifig" && OUT === DEFAULT_OUT) {
  console.error("refusing to write a '" + CONFIG.source + "' bake over the minifig sheets — pass --out");
  process.exit(2);
}

(async () => {
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon\.ico/.test(m.text() + m.location().url)) return;   // the page has none, by design
    errors.push("console: " + m.text());
  });

  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__BAKE__ && window.__BAKE__.ready, { timeout: 60000 });

  /* ---- provenance audit: the decomposed parts against the frozen builders */
  const audit = await page.evaluate(() => window.__BAKE__.partAudit());

  console.log("baking  source=" + CONFIG.source + "  azimuths=" + CONFIG.azimuths +
    "  pitch=" + CONFIG.pitchDeg + "deg  cell=" + CONFIG.bodyCell + "px");
  const t0 = Date.now();
  const out = await page.evaluate((c) => window.__BAKE__.run(c), CONFIG);
  const wall = Date.now() - t0;

  fs.mkdirSync(OUT, { recursive: true });
  let total = 0;
  const inventory = [];
  for (const name of Object.keys(out.png)) {
    const b64 = out.png[name].slice(out.png[name].indexOf(",") + 1);
    const buf = Buffer.from(b64, "base64");
    fs.writeFileSync(path.join(OUT, name + ".png"), buf);
    total += buf.length;
    const meta = out.manifest.sheets[name];
    inventory.push({ file: name + ".png", w: meta.w, h: meta.h, kb: +(buf.length / 1024).toFixed(1), kind: meta.kind });
    out.manifest.sheets[name].bytes = buf.length;
  }
  out.manifest.provenance = {
    frozenModelSource: "git show origin/claude/roads-wip-backup:assets/farmstead/fs-models.js",
    frozenRenderSource: "git show origin/claude/roads-wip-backup:assets/farmstead/fs-render.js",
    snapshot: "farmstead-proto/sprite/fs-models-frozen.js",
    baker: "tools/_fs_bake_sprites.cjs + farmstead-proto/sprite/fs-cast-bake.js",
    audit: audit,
    config: CONFIG,
  };
  out.manifest.totalPngBytes = total;
  /* MINIFIED on purpose: the anchor tables are ~1800 entries and pretty-printing
   * quadruples the file the game has to fetch. README.md is the readable copy of
   * the schema; `node -e "console.log(JSON.stringify(require('./manifest.json'),null,2))"`
   * pretty-prints it when you need to read one. */
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(out.manifest));
  fs.writeFileSync(path.join(OUT, "README.md"), readme(out.manifest, inventory));

  if (flag("contact")) {
    const shot = await contactPrint(page, out.png);
    fs.mkdirSync(path.join(REPO, "shots"), { recursive: true });
    fs.writeFileSync(path.join(REPO, "shots", "fs_forkb_atlas.png"),
      Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));
    console.log("  shots/fs_forkb_atlas.png");
  }

  console.log("\nwrote " + OUT);
  for (const f of inventory) console.log("  " + pad(f.file, 18) + pad(f.w + "x" + f.h, 12) + pad(f.kb + " KB", 10) + f.kind);
  console.log("  " + pad("manifest.json", 18) + "cells " + out.manifest.bake.totalCells +
    "  anchors " + countAnchors(out.manifest));
  console.log("total " + (total / 1024).toFixed(1) + " KB  ·  bake " + out.manifest.bake.ms +
    " ms in-page, " + wall + " ms wall (SwiftShader — a real GPU is 1-2 orders faster)");
  if (errors.length) { console.log("\nPAGE ERRORS:\n  " + errors.join("\n  ")); }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function pad(s, n) { s = String(s); return s + " ".repeat(Math.max(1, n - s.length)); }
function countAnchors2(m) { return countAnchors(m); }
function countOv(m) {
  let n = 0;
  for (const id in m.overlays) for (const rk in m.overlays[id].rows) n += m.overlays[id].rows[rk].length;
  return n;
}
function countAnchors(m) {
  let n = 0;
  for (const k in m.subjects) {
    const s = m.subjects[k];
    for (const p in s.poses) for (const f of s.poses[p].frames) for (const c of f.cells) n += Object.keys(c.anchors).length;
  }
  return n;
}

/** a contact print of every sheet, checkerboarded so alpha is visible */
async function contactPrint(page, png) {
  return page.evaluate(async (sheets) => {
    const imgs = await Promise.all(Object.keys(sheets).map((n) => new Promise((res) => {
      const i = new Image(); i.onload = () => res({ n, i }); i.src = sheets[n];
    })));
    const SCALE = 0.42, GAP = 14, LBL = 18;
    let w = 0, h = 0;
    for (const { i } of imgs) { w = Math.max(w, i.width * SCALE); h += i.height * SCALE + GAP + LBL; }
    const c = document.createElement("canvas");
    c.width = Math.ceil(w) + 24; c.height = Math.ceil(h) + 24;
    const x = c.getContext("2d");
    x.fillStyle = "#12181f"; x.fillRect(0, 0, c.width, c.height);
    let y = 12;
    for (const { n, i } of imgs) {
      const dw = i.width * SCALE, dh = i.height * SCALE;
      for (let cy = 0; cy < dh; cy += 8) for (let cx = 0; cx < dw; cx += 8) {
        x.fillStyle = ((cx / 8 + cy / 8) & 1) ? "#242c35" : "#1b2229";
        x.fillRect(12 + cx, y + LBL, Math.min(8, dw - cx), Math.min(8, dh - cy));
      }
      x.imageSmoothingEnabled = false;
      x.drawImage(i, 12, y + LBL, dw, dh);
      x.fillStyle = "#e8f0f8";
      x.font = "600 12px ui-monospace,Consolas,monospace";
      x.fillText(n + ".png  " + i.width + "x" + i.height, 12, y + 12);
      y += dh + GAP + LBL;
    }
    return c.toDataURL("image/png");
  }, png);
}

function readme(m, inv) {
  const S = m.subjects, B = m.bake;
  const rows = inv.map((f) => "| `" + f.file + "` | " + f.w + "x" + f.h + " | " + f.kb + " KB | " + f.kind + " |").join("\n");
  const poseRows = Object.keys(S).map((k) => {
    const p = S[k].poses;
    return "| **" + k + "** | " + Object.keys(p).map((n) => n + " x" + p[n].rows).join(" · ") +
      " | `" + S[k].sheet + "` / `" + S[k].mask + "` |";
  }).join("\n");
  const ovRows = Object.keys(m.overlays).map((k) => {
    const o = m.overlays[k];
    return "| `" + k + "` | " + (o.tint || "—") + " | " + o.host + " | " + Object.keys(o.rows).length + " rows |";
  }).join("\n");
  const SOURCE_BLURB = {
    minifig: "the procedural minifig from the pre-cast\n`fs-models.js`; snapshot at `farmstead-proto/sprite/fs-models-frozen.js`",
    dwarfknight: "two Tripo-studio sculpts (`assets/farmstead/cast/dwarfknight/src/`),\n" +
      "SKINNED and posed per frame — the knight's skeleton is a landmark-fitted transfer of the\n" +
      "dwarf's own Tripo v1.0 biped (`tools/_fs_dk_rig.py`). Baked into the SAME frustum as the\n" +
      "minifig sheets, so `pxPerCameraUnit` and `footPx` are identical and the two looks are\n" +
      "interchangeable at the renderer",
    villager: "the Tripo villager GLBs",
  };
  return `# Farmstead cast sprites — Fork B

Generated by \`node tools/_fs_bake_sprites.cjs${m.sourceModel === "minifig" ? "" : " --source " + m.sourceModel}\` on ${m.generated}.
Source model: **${m.sourceModel}** (${SOURCE_BLURB[m.sourceModel] || m.sourceModel}).

**These sheets are DELTA-INDEXED for a FREELY ROTATING camera** (2026-08-01) at
pitch **${B.pitchDeg}°** (\`FSC.CAM.PITCH_START\`). A cell is chosen by the
RELATIVE azimuth — the unit's facing minus the live camera yaw — so one cell
serves every (facing, camera) pair that shares a difference. That is only sound
if the lighting is fixed relative to the CAMERA, so it is:
\`bake.lighting.mode = "${B.lighting.mode}"\`, key direction in camera space
\`[${(B.lighting.sun.dirCamera || []).join(", ")}]\` (the world sun's own camera-space
direction at the bake yaw, so the cast matches the terrain exactly at camera yaw
0 and drifts from it as you turn — the standard 2.5D compromise). **PITCH is
still a contract**: it is baked once and the game clamps the camera to a
measured band around it. If the game ever re-locks yaw, these sheets are not
wrong — but a world-fixed sun would then be available and slightly better.

## Sheets

| file | size | png | contents |
|---|---|---|---|
${rows}

Every sheet is a plain grid of \`cell\` px cells, **origin top-left**. Cell
\`(col,row)\` occupies \`[col*cell, row*cell, cell, cell]\`.

\`manifest.json\` ships minified — the anchor tables run to ~${countAnchors2(m)} entries.
To read it: \`node -e "console.log(JSON.stringify(require('./manifest.json'),null,2))"\`.

## Grid

- **azimuths** ${B.azimuths} (${B.azimuthStepDeg}° apart). ${B.azimuthOrder}
- **one locked world scale**: ${B.pxPerCameraUnit} px per camera-space unit, in
  *every* cell of *every* sheet — body and overlay alike. Overlay cells are a
  smaller window on the same projection, never a re-fit.
- **feet baseline**: the ground point (model origin) projects to
  \`(${m.footPx.x}, ${m.footPx.y})\` in **every** body cell. Anchor a sprite by
  putting that pixel on the unit's terrain position.
- body cell ${B.bodyCell}px · overlay cell ${B.overlayCell}px · mask sheets are
  1/${B.maskDiv.serf} resolution for serfs and 1/${B.maskDiv.knight} for knights
  (sample with the same normalised cell UV either way). The knight is full-res
  on purpose: his rank trim is a 2-3 px crossguard and shield rim, and at half
  res thin R and G regions bleed into each other — a gold rim comes out pink.
- **team is the BELT, rank is the PLUME's opposite number** (2026-08-01): mask R
  is a serf's belt band and a knight's helmet CREST — the one part of a knight
  an overhead camera cannot occlude. Mask G is rank trim only (crossguard,
  shield rim, waist trim) and never the crest, so rank stays readable
  independently of team; the rank PIP overlay is still the primary rank read.

## Poses

| subject | rows | sheets |
|---|---|---|
${poseRows}

\`manifest.subjects.<kind>.poses.<pose>.frames[k].row\` is the sheet row;
\`frames[k].cells[a]\` is the azimuth cell and carries that cell's anchors.

Frame lookup:

- **walk** — \`k = round(phase / (2π/${B.azimuths === 0 ? 8 : S.serf.poses.walk.rows})) mod ${S.serf.poses.walk.rows}\`, where \`phase\` is \`vis.phase\` from \`serfVisual\`.
- **work** — the pose is a pure function of \`serfSwing()\`'s 0..1 value, and the
  frames are uniform in it: \`k = round(swing * ${S.serf.poses.work.rows - 1})\`.
- **fight** — frames carry an explicit \`l\` (\`duelPose\`'s lunge scalar). Pick the
  nearest \`|l - frame.l|\`, treating \`guard\` as \`l = 0\`. Each fight frame also
  carries \`lungeOffset\` — the **world-space** displacement toward the foe that
  \`knightVisual\` applies; the sprite does not contain it, the integration must.

## Tinting

Team colour and knight rank-trim are **not baked**. Their regions are baked with
a white albedo and no emissive lift, and marked in the mask sheet
(**R = team, G = rank**). Composite with:

\`\`\`glsl
${m.tintFormula}
\`\`\`

\`tintEmissive\` = \`[${m.tintEmissive.join(", ")}]\` — the game's own
\`lift(0x${B.lighting.emissive.of.toString(16)}, ${B.lighting.emissive.k})\`, added back so a tinted pixel
matches the 3D game **exactly** rather than landing \`emissive*(1-tint)\` dark.

Palettes are in \`manifest.palettes\` (team = \`FSC.PLAYER_COLORS\`,
rank = \`FSC.RANK_COLOR\`, job = \`FSC.JOB_COLOR\`).

## Overlays and anchors

This is how 23 jobs × 4 players × 5 ranks collapses into five sheets.

| overlay | tint | host | rows |
|---|---|---|---|
${ovRows}

Each overlay cell carries \`pivotPx\` — where its own 3D mount point lands inside
its cell. Each body cell carries the matching \`anchors\` entry. Composite:

\`\`\`
overlayTopLeftInBodyCell = bodyCell.anchors[name] - overlayCell.pivotPx
\`\`\`

Both numbers are generated during the bake from the same projection, so the
overlay lands exactly where the merged 3D geometry had it.

Anchor names — serf: \`hat\`, \`tool\`, \`pack\`, \`carry\`; knight: \`helmTop\`,
\`pip0..pip3\`, \`carry\`. \`carry\` is the carried-good position and lives in
**root** space (the crate does not follow the torso — see \`drawSerf\`).

Overlay rows: \`hold\` serves idle **and** every walk frame (the torso twist over a
walk cycle is ±0.10 rad, a fifth of one azimuth bin, so only the *anchor* moves);
\`work:k\` / \`fight:k\` rows exist because those poses pitch the torso up to
0.42 rad.

**Occlusion is baked in.** Each overlay is rendered behind a depth-only copy of
its host body, so a tool held on the far side is already cut away in the cell —
which is what makes it safe to draw overlays a hair in front of the body quad.
${m.bake.overlayEmptyCells} of ${countOv(m)} overlay cells come out fully hidden
(a pack seen from the front, a chest pip seen from behind). Those carry
\`"empty": true\`; **skip the draw** rather than submitting a transparent quad.
Every cell also carries \`px\`, its opaque pixel count.

### Composing one serf

1. body cell = \`subjects.serf.poses.<pose>.frames[k].cells[azimuth]\`
2. draw \`serf-body\` cell, tinted by team through \`serf-mask\` R
3. draw \`overlays\` \`hat\` cell for the same azimuth/row, tinted by
   \`palettes.job[job]\` (the cap geometry is identical for every job — only the
   colour differs, which is the whole reason one hat sheet suffices)
4. if the job carries: draw \`pack\`; else draw \`tool_<FSC.JOB_TOOLS[job][0]>\`
5. if \`s.carry\`: draw the good at the \`carry\` anchor

### Composing one knight

1. body cell from \`subjects.knight\`
2. tint team through mask R, rank-trim through mask G (\`palettes.rank[rank]\`)
3. draw \`rank\` pips: \`pip\` overlay at anchors \`pip0..pip{rank-1}\`, tinted rank

## What is deliberately NOT here

- **carry-walk poses.** The frozen \`drawSerf\` does not pose a carrier
  differently — a carrier differs only by the baked pack and a separate crate
  mesh above his head. Baking carry poses would have been redundant cells.
- **a knight fall animation.** The game has none: a dead knight becomes
  \`FSModels.corpseGeo()\`, a separate flat mesh that scales away over
  \`FSC.CORPSE_T\`. Keep drawing that as geometry (it is 4 triangles) or bake it
  later as a 1-pose prop.
- **more than one pitch row.** Fork B pans and zooms but does not tilt.
`;
}
