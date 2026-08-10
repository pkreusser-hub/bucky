// _bucky_icons.cjs — bake the Bucky goat into the family app's icon set.
//
//   node tools/_bucky_icons.cjs [--check]
//
// Source: assets/bucky-logo-source.jpg (the user's own artwork, commit-safe —
// same standing as the GFFL crest and the Tripo cast).
//
// Outputs, and every logo surface in the app routes through one of them:
//   bucky.png                  256²  favicon + apple-touch on ALL pages, and the
//                                    lock screen's own <img> (rounded 16px there)
//   icons/icon-192.png         192²  manifest "any", and firebase-messaging-sw's
//                                    push notification icon
//   icons/icon-512.png         512²  manifest "any" + the Android splash
//   icons/maskable-192/512.png       manifest "maskable" — a launcher may crop
//                                    these to a circle, so the mark sits smaller
//
// NEVER touches icons/gffl-* — those are the LEAGUE's crest, and league.webmanifest
// is the only manifest pointing at them (see tools/_gffl_icons.cjs).
//
// WHY A FLOOD FILL AND NOT A THRESHOLD: keying "every light pixel" to transparent
// works for a solid silhouette right up until the art has an enclosed light region
// (here: the notch under the ear, and the gap the beard cuts into the neck). Only
// light REACHABLE FROM THE BORDER is paper; anything enclosed is part of the mark
// and must survive. That is the same technique the GFFL crest bake uses, inverted
// for a dark-on-light mark instead of a light-on-dark one.
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "assets", "bucky-logo-source.jpg");

// The app's own --bg since the 2026-08-05 re-skin. Icons sit on it so the tile,
// the splash screen and the theme colour are one surface — and so iOS, which
// composites transparency onto black, has nothing to guess at.
const CREAM = { r: 0xf4, g: 0xf1, b: 0xe8, alpha: 1 };

// Alpha ramp across the JPEG's anti-aliased edge, read off the pixel's MAX channel
// (the paper is ~254, the ink ~66, so max-channel is the cleanest "how papery is
// this" signal). A pixel the fill reached that is already fairly dark is a blend of
// ink and paper, so it keeps partial alpha rather than being cut to nothing —
// without that the mark comes out visibly jagged.
const REACH = 150;   // the fill spreads through pixels whose max channel is >= this
const A_CLEAR = 235; // ...and at/above this it is paper -> fully transparent
const A_SOLID = 120; // ...at/below this it is ink -> fully opaque

// Mark height as a fraction of the tile.
const H_ANY = 0.76; // used as-is; leaves a comfortable margin on a 16px favicon
const H_MASK = 0.62; // must survive a circular crop — see the assert in verify()

// Flat two-colour art palettises with no visible loss, and these files are fetched
// on every page load (favicon) or held forever (installed icon), so it is worth it.
const PNG = { compressionLevel: 9, palette: true, quality: 100, effort: 10 };

const OUTPUTS = [
  { file: "bucky.png", size: 256, scale: H_ANY },
  { file: "icons/icon-192.png", size: 192, scale: H_ANY },
  { file: "icons/icon-512.png", size: 512, scale: H_ANY },
  { file: "icons/maskable-192.png", size: 192, scale: H_MASK },
  { file: "icons/maskable-512.png", size: 512, scale: H_MASK },
];

const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1) + " KB";

/** Key the paper transparent and trim to the mark's own bounding box. */
async function cutout() {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: CH } = info;
  if (CH !== 4) throw new Error("expected RGBA, got " + CH + " channels");

  const maxCh = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const r = data[p], g = data[p + 1], b = data[p + 2];
    maxCh[i] = r > g ? (r > b ? r : b) : (g > b ? g : b);
  }

  // ---- flood fill the paper inward from every border pixel ------------------
  const paper = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (paper[i] || maxCh[i] < REACH) return;
    paper[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i - x) / W;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }

  // ---- alpha ramp, and the mark's bounding box in one pass ------------------
  let minX = W, minY = H, maxX = -1, maxY = -1, cleared = 0, feathered = 0;
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    let a = 255;
    if (paper[i]) {
      const m = maxCh[i];
      if (m >= A_CLEAR) { a = 0; cleared++; }
      else if (m <= A_SOLID) { a = 255; }
      else { a = Math.round(255 * (A_CLEAR - m) / (A_CLEAR - A_SOLID)); feathered++; }
    }
    data[p + 3] = a;
    if (a > 8) {
      const x = i % W, y = (i - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("the key removed the whole image — check REACH/A_*");
  console.log(
    `  keyed ${cleared} px transparent, ${feathered} feathered; ` +
    `mark ${maxX - minX + 1}x${maxY - minY + 1} at (${minX},${minY}) of ${W}x${H}`
  );

  return sharp(data, { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

/** Centre the mark at `scale` of the tile's height, on cream. */
async function tile(mark, size, scale) {
  const target = Math.round(size * scale);
  const resized = await sharp(mark)
    .resize({ height: target, fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: CREAM },
  })
    .composite([{ input: resized, gravity: "centre" }])
    .png(PNG)
    .toBuffer();
}

/** Assert what each file claims to be, before anyone ships it. */
async function verify() {
  let pass = 0;
  const fail = [];
  const ok = (cond, msg) => (cond ? pass++ : fail.push(msg));

  for (const o of OUTPUTS) {
    const f = path.join(ROOT, o.file);
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = info;
    ok(W === o.size && H === o.size, `${o.file}: ${W}x${H}, expected ${o.size}²`);

    const at = (x, y) => { const p = (y * W + x) * 4; return [data[p], data[p + 1], data[p + 2], data[p + 3]]; };
    const isCream = (c) => c[0] === CREAM.r && c[1] === CREAM.g && c[2] === CREAM.b && c[3] === 255;
    ok([at(0, 0), at(W - 1, 0), at(0, H - 1), at(W - 1, H - 1)].every(isCream),
      `${o.file}: corners are not exactly cream — the tile must be opaque, edge to edge`);

    // The mark's own extent, from whatever is not cream.
    let minX = W, minY = H, maxX = -1, maxY = -1, ink = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (isCream(at(x, y))) continue;
      ink++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    ok(ink > W * H * 0.04, `${o.file}: only ${ink} non-cream px — the goat did not land`);
    const mh = maxY - minY + 1, mw = maxX - minX + 1;
    ok(Math.abs(mh / H - o.scale) < 0.03, `${o.file}: mark is ${(mh / H).toFixed(3)} of the tile, wanted ${o.scale}`);
    ok(Math.abs((minX + maxX) / 2 - W / 2) <= 2 && Math.abs((minY + maxY) / 2 - H / 2) <= 2,
      `${o.file}: mark is not centred`);

    // A maskable icon may be cropped to the inner 80% circle by the launcher, so
    // every corner of the mark has to sit inside that circle — not merely inside
    // the tile. Measured, because "it looks like it fits" is how horns get clipped.
    if (o.file.includes("maskable")) {
      const halfDiag = Math.hypot(mw / 2, mh / 2);
      ok(halfDiag <= W * 0.4,
        `${o.file}: mark's half-diagonal ${halfDiag.toFixed(0)}px exceeds the ${(W * 0.4).toFixed(0)}px safe radius`);
    }
  }

  // The league's crest must be untouched by a run of this script.
  for (const g of ["gffl-192.png", "gffl-512.png", "gffl-mark.png"]) {
    ok(fs.existsSync(path.join(ROOT, "icons", g)), `icons/${g} is missing — the league's crest must survive`);
  }

  console.log(`\n  ${pass}/${pass + fail.length} checks`);
  fail.forEach((m) => console.log("  FAIL " + m));
  return fail.length === 0;
}

async function main() {
  const checkOnly = process.argv.includes("--check");
  if (!checkOnly) {
    if (!fs.existsSync(SRC)) throw new Error("missing source: " + SRC);
    console.log("source: " + path.relative(ROOT, SRC));
    const mark = await cutout();
    for (const o of OUTPUTS) {
      const out = path.join(ROOT, o.file);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await tile(mark, o.size, o.scale));
      console.log(`  wrote ${o.file}  ${o.size}²  ${kb(out)}`);
    }
  }
  const good = await verify();
  if (!good) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
