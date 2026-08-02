#!/usr/bin/env node
/* _fs_dk_review.cjs — look at a baked sprite set without guessing.
 *
 *   node tools/_fs_dk_review.cjs                       compare both looks' tone
 *   node tools/_fs_dk_review.cjs --strip shots/x.png   also write a cell strip
 *
 * Measures the MEAN LUMA of the opaque pixels in every body sheet of both
 * looks. Tone is the one thing a sprite bake gets wrong silently: the game adds
 * a flat emissive lift (`lift(0x9a9a9a, 0.34)`) that was tuned for the minifig's
 * deliberately dark flat colours, and dropping a light-albedo sculpt into it
 * blows the whole cast out to white. The numbers below are how that gets caught
 * — and how a fix gets checked — instead of squinting at an atlas.
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
const puppeteer = require(path.join(REPO, "tools", "node_modules", "puppeteer-core"));
const BASE = "http://localhost:8790";

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const LOOKS = (arg("looks", "sprites,sprites-dwarfknight")).split(",");
const STRIP = arg("strip", null);

(async () => {
  const browser = await puppeteer.launch({
    channel: "chrome", headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
    protocolTimeout: 300000,
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.goto(BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded", timeout: 60000 });

  const out = await page.evaluate(async (looks, base) => {
    async function img(url) {
      return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(url)); i.src = url; });
    }
    const res = {};
    for (const look of looks) {
      const dir = base + "/assets/farmstead/cast/" + look + "/";
      const man = await (await fetch(dir + "manifest.json")).json();
      const per = {};
      for (const name of Object.keys(man.sheets)) {
        if (man.sheets[name].kind !== "colour") continue;
        const im = await img(dir + man.sheets[name].file);
        const c = document.createElement("canvas");
        c.width = im.width; c.height = im.height;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0, sum = 0, hot = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < 128) continue;
          const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          sum += L; n++;
          if (L > 235) hot++;
        }
        per[name] = { meanLuma: +(sum / Math.max(1, n)).toFixed(1), opaquePx: n, blownFrac: +(hot / Math.max(1, n)).toFixed(3) };
      }
      res[look] = { source: man.sourceModel, ppu: man.bake.pxPerCameraUnit, footPx: man.footPx,
        emissive: man.bake.lighting.emissive, tintEmissive: man.tintEmissive, sheets: per,
        emptyOverlay: man.bake.overlayEmptyCells, cells: man.bake.totalCells };
    }
    return res;
  }, LOOKS, BASE);

  for (const look of Object.keys(out)) {
    const o = out[look];
    console.log("\n" + look + "  (source " + o.source + ", ppu " + o.ppu + ", footPx " +
      o.footPx.x + "," + o.footPx.y + ", emissive k=" + o.emissive.k + ")");
    for (const s in o.sheets) {
      const v = o.sheets[s];
      console.log("   " + s.padEnd(14) + " meanLuma " + String(v.meanLuma).padStart(6) +
        "   blown>235 " + (v.blownFrac * 100).toFixed(1) + "%   opaque " + v.opaquePx);
    }
  }
  if (STRIP) {
    const png = await page.evaluate(async (looks, base) => {
      async function img(url) { return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = url; }); }
      const ROWSPEC = [["serf", "idle", 0], ["serf", "walk", 2], ["serf", "work", 4], ["knight", "guard", 0], ["knight", "fight", 5]];
      const AZ = [0, 2, 4, 6, 8, 10], CELL = 128, SC = 1.0;
      const W = AZ.length * CELL * SC, H = looks.length * ROWSPEC.length * CELL * SC;
      const c = document.createElement("canvas");
      c.width = W + 8; c.height = H + 8;
      const x = c.getContext("2d");
      x.fillStyle = "#11161c"; x.fillRect(0, 0, c.width, c.height);
      let y = 4;
      for (const look of looks) {
        const dir = base + "/assets/farmstead/cast/" + look + "/";
        const man = await (await fetch(dir + "manifest.json")).json();
        const sheets = {};
        for (const k of ["serf", "knight"]) sheets[k] = await img(dir + man.subjects[k].sheet + ".png");
        for (const [kind, pose, k] of ROWSPEC) {
          const P = man.subjects[kind].poses[pose];
          if (!P) { y += CELL * SC; continue; }
          const f = P.frames[Math.min(k, P.frames.length - 1)];
          AZ.forEach((a, i) => {
            x.drawImage(sheets[kind], a * CELL, f.row * CELL, CELL, CELL, 4 + i * CELL * SC, y, CELL * SC, CELL * SC);
          });
          y += CELL * SC;
        }
      }
      return c.toDataURL("image/png");
    }, LOOKS, BASE);
    fs.mkdirSync(path.dirname(path.resolve(REPO, STRIP)), { recursive: true });
    fs.writeFileSync(path.resolve(REPO, STRIP), Buffer.from(png.slice(png.indexOf(",") + 1), "base64"));
    console.log("\nwrote " + STRIP);
  }
  if (errors.length) console.log("\nPAGE ERRORS: " + errors.join(" | "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
