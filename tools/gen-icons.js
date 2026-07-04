// One-off script: generate PWA icons (192x192, 512x512) from bucky.png.
// Uses the `sharp` package (installed in tools/node_modules) since bucky.png
// (256x256) is smaller than the 512 target and needs real resizing, not just
// a <link> re-reference.
//
// Run from the repo root:
//   node tools/gen-icons.js
"use strict";

const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "bucky.png");
const OUT_DIR = path.join(ROOT, "icons");

const SIZES = [192, 512];

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error("Source image not found:", SRC);
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  for (const size of SIZES) {
    const outPath = path.join(OUT_DIR, `icon-${size}.png`);
    await sharp(SRC)
      .resize(size, size, {
        fit: "contain",
        background: { r: 238, g: 242, b: 250, alpha: 1 }, // #eef2fa (manifest background_color)
      })
      .png()
      .toFile(outPath);

    const meta = await sharp(outPath).metadata();
    console.log(`Wrote ${outPath} (${meta.width}x${meta.height})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
