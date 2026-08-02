#!/usr/bin/env node
/* _fs_bake_sprites_test.cjs — FORK B sprite-test LOOK TEST bake driver.
 *
 *   node tools/_fs_bake_sprites_test.cjs                bake the test sheets
 *   node tools/_fs_bake_sprites_test.cjs --contact       also write shots/fs_spritetest_atlas.png
 *
 * Sibling of tools/_fs_bake_sprites.cjs (the production driver) — additive
 * only, never edits that file. Drives farmstead-proto/sprite/bake-test.html
 * (a sibling of bake.html) which loads fs-cast-bake-test.js (a sibling of the
 * production fs-cast-bake.js) instead of the shipped module. Writes
 * assets/farmstead/cast/sprites-test/{villager-body.png, knight-body.png,
 * manifest-test.json, README-test.md} — a completely separate directory from
 * the shipped assets/farmstead/cast/sprites/, which this script never opens.
 *
 * Needs the repo served at http://localhost:8790 (same server the production
 * driver expects — tools/mobile-preview.mjs / the bucky-static launch config).
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));

const PAGE = "http://localhost:8790/farmstead-proto/sprite/bake-test.html";
const OUT = path.join(REPO, "assets", "farmstead", "cast", "sprites-test");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes("--" + n);

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
    if (/favicon\.ico/.test(m.text() + m.location().url)) return;
    errors.push("console: " + m.text());
  });

  await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__BAKE_TEST__ && window.__BAKE_TEST__.ready, { timeout: 60000 });

  console.log("baking sprite-test sheets (dwarf->villager, knight)…");
  const t0 = Date.now();
  const out = await page.evaluate(() => window.__BAKE_TEST__.run({}));
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
    inventory.push({ file: name + ".png", w: meta.w, h: meta.h, kb: +(buf.length / 1024).toFixed(1) });
    out.manifest.sheets[name].bytes = buf.length;
  }
  out.manifest.totalPngBytes = total;
  out.manifest.provenance = {
    kind: "TEST / exploration — never shipped, never committed",
    sources: {
      dwarf: "C:/Users/pkreu/Downloads/cartoon+dwarf+3d+model.glb (user-downloaded, license unverified)",
      knight: "C:/Users/pkreu/Downloads/medieval+knight+3d+model.glb (user-downloaded, license unverified)",
    },
    splitter: "tools/_fs_spritetest_splitparts.mjs",
    baker: "tools/_fs_bake_sprites_test.cjs + farmstead-proto/sprite/fs-cast-bake-test.js",
  };
  fs.writeFileSync(path.join(OUT, "manifest-test.json"), JSON.stringify(out.manifest));
  fs.writeFileSync(path.join(OUT, "README-test.md"), readme(out.manifest, inventory));

  if (flag("contact")) {
    const shot = await contactPrint(page, out.png);
    fs.mkdirSync(path.join(REPO, "shots"), { recursive: true });
    fs.writeFileSync(path.join(REPO, "shots", "fs_spritetest_atlas.png"),
      Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));
    console.log("  shots/fs_spritetest_atlas.png");
  }

  console.log("\nwrote " + OUT);
  for (const f of inventory) console.log("  " + pad(f.file, 18) + pad(f.w + "x" + f.h, 12) + f.kb + " KB");
  console.log("total " + (total / 1024).toFixed(1) + " KB  ·  bake " + out.manifest.bake.ms +
    " ms in-page, " + wall + " ms wall");
  if (errors.length) { console.log("\nPAGE ERRORS:\n  " + errors.join("\n  ")); }
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function pad(s, n) { s = String(s); return s + " ".repeat(Math.max(1, n - s.length)); }

async function contactPrint(page, png) {
  return page.evaluate(async (sheets) => {
    const imgs = await Promise.all(Object.keys(sheets).map((n) => new Promise((res) => {
      const i = new Image(); i.onload = () => res({ n, i }); i.src = sheets[n];
    })));
    const SCALE = 0.55, GAP = 14, LBL = 18;
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
  const rows = inv.map((f) => "| `" + f.file + "` | " + f.w + "x" + f.h + " | " + f.kb + " KB |").join("\n");
  return `# Farmstead cast sprites — TEST / exploration (NOT shipped, NOT committed)

Generated by \`node tools/_fs_bake_sprites_test.cjs\` on ${m.generated}.

Look test of two USER-DOWNLOADED GLBs against the Fork B sprite pipeline:
- **villager** <- \`C:/Users/pkreu/Downloads/cartoon+dwarf+3d+model.glb\` ("cartoon dwarf")
- **knight** <- \`C:/Users/pkreu/Downloads/medieval+knight+3d+model.glb\` ("medieval knight")

Same grid as production: ${m.bake.azimuths} azimuths, ${m.bake.pitchDeg}deg pitch, ${m.bake.bodyCell}px
cells, world-fixed sun read live off the shared \`FSC.VIS\`. **No masks, no overlays** —
team tint and job/rank overlays are out of scope for a look test (see \`manifest.overlays\` = \`{}\`
and every subject's \`mask\` = \`null\`).

## Sheets

| file | size | png |
|---|---|---|
${rows}

## Posing method per subject

- **villager** (\`posingMethod: "split"\`) — the source GLB ships a clean Tripo v1.0 biped
  skin, so \`tools/_fs_spritetest_splitparts.mjs\` cut it into rigid body/legL/legR parts
  (skin-weight classified, each leg's origin baked at its own hip) — the SAME rig shape and
  pose maths (\`serfPose\`/\`applyPose\`) as the production pipeline. Full idle + walk(8) + work(4).
- **knight** (\`posingMethod: "wholeBodyBob"\`) — the source GLB has **no skin at all**, and a
  geometric hip-line split showed a real gap between the tabard hem and the greaves at the
  production LEG_SWING (0.52 rad) — plate armor has no cloth "give" to hide the seam. Fell back
  to whole-body geometry: guard(1) + walk(3, vertical bob + gentle lean only, no leg stride) +
  fight(4, the REAL production torso-lunge maths off \`duelPose\`'s \`l\` — that pose needs no legs,
  so it is not a fallback at all).

## Shipping caveats (read before using any of this for real)

1. **License unverified.** Both source GLBs are user-downloaded files of unknown license. Per
   the Farmstead house rule, user-uploaded/downloaded assets are never committed until a
   license is confirmed — this whole directory is untracked-in-spirit and must stay that way
   until someone checks.
2. **Shipping either look for real would additionally need**: team-tint masks (a tinted region
   baked white + a mask sheet, like \`serf-mask.png\`/\`knight-mask.png\`), hat/tool anchor
   projection for the villager (there is currently nothing to hang a job cap or a tool on), and
   ideally a proper rig-based split for the knight instead of the whole-body fallback (would
   need a rigged source model or a from-scratch rig).
`;
}
