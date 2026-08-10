// _gffl_icons.cjs — bake the GFFL crest into the league's app icons + header mark.
//
//   node tools/_gffl_icons.cjs
//
// Source: assets/league/gffl-logo-source.jpg (the user's own crest, commit-safe).
// Outputs into icons/, all prefixed gffl- so the FAMILY app's icon-192/512 +
// maskable-192/512 (the Bucky goat, referenced by manifest.webmanifest) are never
// touched — league.webmanifest is the only manifest that points at these.
//
// WHY A FLOOD FILL AND NOT A THRESHOLD: the crest is a two-colour mark whose goat,
// wordmark and inner ring are all WHITE, enclosed by the red field. Keying "every
// white pixel" to transparent would punch the goat and the letters straight out of
// the shield. Only white REACHABLE FROM THE BORDER is background, so the key is a
// flood fill from the edges — interior white is unreachable and survives untouched.
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "assets", "league", "gffl-logo-source.jpg");
const OUT = path.join(ROOT, "icons");

// The league's own --bg. Icons sit on it so the installed app, its splash and its
// theme colour are one surface — and so iOS, which composites transparency onto
// black, has nothing to guess at.
const BG = { r: 0x0c, g: 0x10, b: 0x17, alpha: 1 };

// Alpha ramp across the anti-aliased JPEG edge. A pixel the fill reached that is
// still fairly saturated is a blend of shield and paper, so it keeps partial alpha
// rather than being cut to nothing (which would leave the crest visibly jagged).
const A_CLEAR = 240; // min-channel at/above this in the flood region -> fully transparent
const A_SOLID = 180; // ...and at/below this -> fully opaque
const REACH = 200;   // a pixel is "paper" for spreading purposes when min channel >= this

// The crest is flat two-colour art, so a palette cuts the files by ~4x with no visible
// loss — worth it for the header mark especially, which every page load fetches.
const PNG = { compressionLevel: 9, palette: true, quality: 100, effort: 10 };
const kb = (f) => (require("fs").statSync(f).size / 1024).toFixed(1) + " KB";

async function main() {
  if (!fs.existsSync(SRC)) throw new Error("missing source: " + SRC);
  fs.mkdirSync(OUT, { recursive: true });

  const img = sharp(SRC).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: CH } = info;
  if (CH !== 4) throw new Error("expected RGBA, got " + CH + " channels");

  const minCh = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    minCh[i] = r < g ? (r < b ? r : b) : (g < b ? g : b);
  }

  // ---- flood fill the paper from every border pixel -------------------------
  const bg = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (bg[i] || minCh[i] < REACH) return;
    bg[i] = 1; stack.push(i);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop(), x = i % W, y = (i - x) / W;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  let cleared = 0, ramped = 0;
  for (let i = 0, p = 3; i < W * H; i++, p += 4) {
    if (!bg[i]) continue;
    const m = minCh[i];
    // paper -> 0, shield-ish -> 255, linear across the JPEG's anti-aliased rim
    const a = m >= A_CLEAR ? 0
            : m <= A_SOLID ? 255
            : Math.round(((A_CLEAR - m) / (A_CLEAR - A_SOLID)) * 255);
    data[p] = a;
    if (a === 0) cleared++; else ramped++;
  }

  // ---- trim to the crest itself --------------------------------------------
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const cw = x1 - x0 + 1, chh = y1 - y0 + 1;
  console.log(`source ${W}x${H} · paper cleared ${cleared} px (+${ramped} feathered)`);
  console.log(`crest bbox ${cw}x${chh} at (${x0},${y0}) · aspect ${(cw / chh).toFixed(3)}`);

  const crest = await sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: cw, height: chh })
    .png()
    .toBuffer();

  // ---- writers --------------------------------------------------------------
  // `fit` is the fraction of the canvas the crest's LONG side may occupy.
  async function plate(file, size, fit, background) {
    const inner = Math.round(size * fit);
    const scaled = await sharp(crest)
      .resize({ width: inner, height: inner, fit: "inside", withoutEnlargement: false })
      .toBuffer();
    const meta = await sharp(scaled).metadata();
    await sharp({
      create: { width: size, height: size, channels: 4, background },
    })
      .composite([{
        input: scaled,
        left: Math.round((size - meta.width) / 2),
        top: Math.round((size - meta.height) / 2),
      }])
      .png(PNG)
      .toFile(path.join(OUT, file));
    console.log(`  ${file}  ${size}x${size}  crest ${meta.width}x${meta.height}  ${kb(path.join(OUT, file))}`);
  }

  // The header mark: transparent, crest only. It is fetched on EVERY page load (unlike the
  // manifest icons, which a device reads once at install), so it is sized to the job — the
  // slot is 34px, so 136px covers a 4x screen — and palette-quantised like the rest.
  await sharp(crest).resize({ height: 136 }).png(PNG)
    .toFile(path.join(OUT, "gffl-mark.png"));
  const mk = await sharp(path.join(OUT, "gffl-mark.png")).metadata();
  console.log(`  gffl-mark.png  ${mk.width}x${mk.height}  (transparent, header)  ${kb(path.join(OUT, "gffl-mark.png"))}`);

  // "any" icons — a little breathing room inside the tile.
  await plate("gffl-192.png", 192, 0.86, BG);
  await plate("gffl-512.png", 512, 0.86, BG);
  // maskable — the launcher may crop to a circle, so the crest stays inside the
  // central safe zone and the background must be full-bleed (never transparent).
  await plate("gffl-maskable-192.png", 192, 0.62, BG);
  await plate("gffl-maskable-512.png", 512, 0.62, BG);
  // iOS applies its own rounded-rect mask and fills transparency with black.
  await plate("gffl-apple-touch.png", 180, 0.80, BG);
}

main().catch((e) => { console.error(e); process.exit(1); });
