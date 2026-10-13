#!/usr/bin/env node
"use strict";
/**
 * Draws the home-screen icons for the standalone apps (News, Shopping, Work Orders, Calendar, Finance).
 *
 *   NODE_PATH=<path to tools/node_modules> node tools/make-standalone-icons.cjs [outDir]
 *
 * Each icon is the area's own line glyph, the same path index.html's NAV_PATHS draws in the
 * bottom nav, in cream on a Farmstead green tile. The glyph is centred by its measured bounding
 * box (getBBox), not by eye, because the shop bag's handle makes its box taller than it is wide.
 *
 * Per app, in icons/:
 *   <id>-192.png, <id>-512.png          purpose "any": rounded tile, transparent corners
 *   <id>-maskable-512.png               purpose "maskable": full square, glyph inside the central
 *                                       80% (the platform crops it to a circle/squircle itself)
 *   <id>-apple-touch.png                180px, full square. iOS paints transparent pixels black,
 *                                       so this one must not have rounded transparent corners.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

// --only=id,id draws just those apps, so adding an app does not rewrite the PNGs of the others.
const ARGS = process.argv.slice(2);
const onlyArg = ARGS.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice(7).split(",").filter(Boolean) : null;
const outArg = ARGS.find((a) => !a.startsWith("--"));
const OUT = path.resolve(outArg || path.join(__dirname, "..", "icons"));
const GREEN = "#3f5c46", CREAM = "#f4f1e8";
// Same paths as NAV_PATHS in index.html (24x24 grid, stroke 2).
const GLYPHS = {
  news: "M5 5 H19 V19 H5 Z M8 9 H16 M8 12 H16 M8 15 H13",
  shop: "M6 8 H18 L17 20 H7 Z M9 8 V6 A3 3 0 0 1 15 6 V8",
  workorders: "M4 9 H20 V19 H4 Z M9 9 V7 A3 3 0 0 1 15 7 V9 M4 13 H20",
  calendar: "M4 6 H20 V20 H4 Z M4 10 H20 M8 4 V8 M16 4 V8",
  // Finance's trend line runs past the 24 grid (x 1 to 23); the bounding-box centring handles it.
  finance: "M23 6 L13.5 15.5 L8.5 10.5 L1 18 M17 6 L23 6 L23 12",
};
// variant: radius = tile corner radius as a fraction of the side; glyph = longest glyph side as a
// fraction of the side. Maskable keeps the glyph well inside the 80% safe zone: a 0.44 box has a
// half-diagonal of 0.31, inside the 0.40 safe-zone circle.
const VARIANTS = [
  { file: (id) => `${id}-192.png`,           size: 192, radius: 0.22, glyph: 0.50 },
  { file: (id) => `${id}-512.png`,           size: 512, radius: 0.22, glyph: 0.50 },
  { file: (id) => `${id}-maskable-512.png`,  size: 512, radius: 0,    glyph: 0.44 },
  { file: (id) => `${id}-apple-touch.png`,   size: 180, radius: 0,    glyph: 0.48 },
];

function svgFor(id, v){
  const s = v.size;
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${Math.round(s * v.radius)}" fill="${GREEN}"/>
  <g id="g" fill="none" stroke="${CREAM}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
    <path d="${GLYPHS[id]}"/>
  </g>
</svg>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--no-sandbox"] });
  const report = [];
  for (const id of Object.keys(GLYPHS).filter((k) => !ONLY || ONLY.includes(k))){
    for (const v of VARIANTS){
      const page = await browser.newPage();
      await page.setViewport({ width: v.size, height: v.size, deviceScaleFactor: 1 });
      await page.setContent(svgFor(id, v));
      const box = await page.evaluate((size, frac) => {
        const g = document.getElementById("g");
        const bb = g.getBBox();
        const k = (size * frac) / Math.max(bb.width, bb.height);
        const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
        g.setAttribute("transform", `translate(${size / 2} ${size / 2}) scale(${k}) translate(${-cx} ${-cy})`);
        g.setAttribute("stroke-width", String(1.9));
        const after = g.getBoundingClientRect();   // includes stroke
        return { left: after.left, top: after.top, right: size - after.right, bottom: size - after.bottom };
      }, v.size, v.glyph);
      const file = path.join(OUT, v.file(id));
      await page.screenshot({ path: file, omitBackground: true });
      report.push(`${path.basename(file)}  ${v.size}px  margins L${box.left.toFixed(1)} R${box.right.toFixed(1)} T${box.top.toFixed(1)} B${box.bottom.toFixed(1)}`);
      await page.close();
    }
  }
  await browser.close();
  console.log(report.join("\n"));
})().catch((e) => { console.error(e); process.exit(1); });
