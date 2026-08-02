#!/usr/bin/env node
/* _fs_bake_goods.cjs — bake the 26 goods into one impostor sheet.
 *
 *   node tools/_fs_bake_goods.cjs                 bake into assets/farmstead/goods/
 *   node tools/_fs_bake_goods.cjs --azimuths 12   override any config key
 *   node tools/_fs_bake_goods.cjs --contact       also write shots/fs_b3_goods_atlas.png
 *   node tools/_fs_bake_goods.cjs --out some/dir
 *
 * Serves the repo itself on an ephemeral port (so it does not fight the user's
 * playtest server on :8790) and drives farmstead-proto/sprite/bake-goods.html.
 * The bake source is the LIVE assets/farmstead/fs-models.js — the goods sculpts
 * ARE the game's own art, so there is nothing to freeze and nothing that can
 * drift out of step with the fallback mesh path.
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const REPO = path.resolve(__dirname, "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));

const argv = process.argv.slice(2);
function arg(name, dflt) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
}
const flag = (n) => argv.includes("--" + n);

const CONFIG = {
  /* 8, measured not guessed: a good is near-rotationally-simple and about
   * 24 px on screen at play zoom. The driver's per-azimuth frame delta is
   * printed below — if a future good ever needs more, this is the one knob. */
  azimuths: +arg("azimuths", 8),
  cell: +arg("cell", 64),
  pitchDeg: +arg("pitchDeg", 52),
  cameraYaw: +arg("cameraYaw", 0),
};
const OUT = path.resolve(arg("out", path.join(REPO, "assets", "farmstead", "goods")));

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".png": "image/png", ".json": "application/json", ".glb": "model/gltf-binary",
};
function serve(port) {
  return new Promise((res, rej) => {
    const s = http.createServer((req, rq) => {
      const u = decodeURIComponent(req.url.split("?")[0]);
      const fp = path.join(REPO, u === "/" ? "index.html" : u);
      if (!fp.startsWith(REPO) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { rq.writeHead(404); return rq.end("nf"); }
      rq.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(fp).pipe(rq);
    });
    s.on("error", rej);
    s.listen(port, "127.0.0.1", () => res(s));
  });
}

(async () => {
  const port = 8940 + Math.floor(Math.random() * 40);
  const server = await serve(port);
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    protocolTimeout: 600000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  // the favicon 404 is by design (the bake page has none) — match on the URL too
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/favicon\.ico/.test(m.text() + m.location().url)) return;
    errors.push("console: " + m.text());
  });

  await page.goto(`http://127.0.0.1:${port}/farmstead-proto/sprite/bake-goods.html`,
    { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__GBAKE__ && window.__GBAKE__.ready, { timeout: 60000 });

  console.log("baking goods  azimuths=" + CONFIG.azimuths + "  cell=" + CONFIG.cell +
    "px  pitch=" + CONFIG.pitchDeg + "deg");
  const t0 = Date.now();
  const out = await page.evaluate((c) => window.__GBAKE__.run(c), CONFIG);
  const wall = Date.now() - t0;

  fs.mkdirSync(OUT, { recursive: true });
  const buf = Buffer.from(out.png.slice(out.png.indexOf(",") + 1), "base64");
  fs.writeFileSync(path.join(OUT, "goods.png"), buf);
  out.manifest.sheet.bytes = buf.length;
  out.manifest.provenance = {
    source: "assets/farmstead/fs-models.js FSModels.goodGeo (the game's own sculpts)",
    baker: "tools/_fs_bake_goods.cjs + farmstead-proto/sprite/fs-goods-bake.js",
    config: CONFIG,
  };
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(out.manifest));
  fs.writeFileSync(path.join(OUT, "README.md"), readme(out.manifest, buf.length));

  // per-good silhouette fill: the review number that says which sculpts are weak
  const rows = out.manifest.rows;
  const listed = Object.keys(rows).sort((a, b) => rows[a].fill - rows[b].fill);
  console.log("\nwrote " + OUT);
  console.log("  goods.png      " + out.manifest.sheet.w + "x" + out.manifest.sheet.h +
    "   " + (buf.length / 1024).toFixed(1) + " KB   " + out.manifest.goods.length + " goods x " +
    CONFIG.azimuths + " azimuths");
  console.log("  cell fill (silhouette / cell), smallest first:");
  for (let i = 0; i < listed.length; i += 4) {
    console.log("    " + listed.slice(i, i + 4).map((k) => pad(k, 12) + rows[k].fill.toFixed(2)).join("   "));
  }
  console.log("  bake " + out.manifest.bake.ms + " ms in-page, " + wall + " ms wall");

  if (flag("contact")) {
    const shot = await contact(page, out.png, out.manifest);
    fs.mkdirSync(path.join(REPO, "shots"), { recursive: true });
    fs.writeFileSync(path.join(REPO, "shots", "fs_b3_goods_atlas.png"),
      Buffer.from(shot.slice(shot.indexOf(",") + 1), "base64"));
    console.log("  shots/fs_b3_goods_atlas.png");
  }
  if (errors.length) console.log("\nPAGE ERRORS:\n  " + errors.join("\n  "));
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function pad(s, n) { s = String(s); return s + " ".repeat(Math.max(1, n - s.length)); }

/** a labelled contact print: every good's row, checkerboarded so alpha shows */
async function contact(page, png, manifest) {
  return page.evaluate(async (src, m) => {
    const img = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
    const SCALE = 2, LBLW = 96, cell = m.sheet.cell;
    const c = document.createElement("canvas");
    c.width = LBLW + img.width * SCALE + 16;
    c.height = img.height * SCALE + 16;
    const x = c.getContext("2d");
    x.fillStyle = "#12181f"; x.fillRect(0, 0, c.width, c.height);
    for (let cy = 0; cy < img.height * SCALE; cy += 8) {
      for (let cx = 0; cx < img.width * SCALE; cx += 8) {
        x.fillStyle = ((cx / 8 + cy / 8) & 1) ? "#2a333d" : "#1d242b";
        x.fillRect(LBLW + cx, 8 + cy, 8, 8);
      }
    }
    x.imageSmoothingEnabled = false;
    x.drawImage(img, LBLW, 8, img.width * SCALE, img.height * SCALE);
    x.fillStyle = "#e8f0f8";
    x.font = "600 13px ui-monospace,Consolas,monospace";
    for (const id of m.goods) {
      const r = m.rows[id].row;
      x.fillText(id, 6, 8 + (r + 0.6) * cell * SCALE);
    }
    return c.toDataURL("image/png");
  }, png, manifest);
}

function readme(m, bytes) {
  const b = m.bake;
  return `# Farmstead — goods impostor sheet

Generated by \`node tools/_fs_bake_goods.cjs\`. Do not hand-edit.

| | |
|---|---|
| sheet | \`goods.png\` ${m.sheet.w}x${m.sheet.h}, ${(bytes / 1024).toFixed(1)} KB |
| grid | one ROW per good, one COLUMN per azimuth, ${b.azimuths} azimuths, ${m.sheet.cell} px cells |
| pitch | ${b.pitchDeg}° (the cast sheets' pitch) |
| lighting | ${b.lighting.mode}, key ${JSON.stringify(b.lighting.keyDir)} |
| frustum | cx ${b.frustum.cx} cy ${b.frustum.cy} halfSpan ${b.frustum.halfSpan}, ${b.pxPerCameraUnit} px per camera unit |
| ground anchor | \`footPx\` (${b.footPx.x}, ${b.footPx.y}) — the model origin projected once, shared by every cell |

## Reading a cell

    col = round( (objectYaw - cameraYaw) / (2π) * ${b.azimuths} ) mod ${b.azimuths}
    row = manifest.rows[<res>].row
    uv  = ( col*cell, row*cell ) .. ( (col+1)*cell, (row+1)*cell )

\`texture.flipY = false\` — this sheet is written top-left origin. The quad is
VIEW-ALIGNED (the camera's image plane), not world-vertical, because the bake is
an ortho render from a pitched camera; it also needs the same small depth bias
toward the camera the cast layer uses, or the terrain z-tests the near foot away.

The sheet is a DRAW-CALL optimisation, not a fidelity one: \`FSModels.goodGeo(res)\`
builds the identical mesh and is the automatic fallback when the sheet does not
arrive.

## Goods

${m.goods.map((g) => "- `" + g + "` row " + m.rows[g].row + ", silhouette fills " + m.rows[g].fill + " of its cell").join("\n")}
`;
}
