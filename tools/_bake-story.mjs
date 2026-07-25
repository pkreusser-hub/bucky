// Bake a Story Time Jr story: every page's picture generated once, ahead of time.
//
//   GEMINI_API_KEY=... node tools/_bake-story.mjs tools/story-dino.json
//
// Because the choices are fixed (the child never types), a story is just a tree, so the whole
// thing can be generated up front. The baked story then costs nothing to read, appears
// instantly, works with no network, and can never drift or lose the plot.
//
// RESUMABLE: a page whose picture already exists is skipped, so a re-run after a failure or a
// text edit never pays for the same picture twice. Pass --force to regenerate everything.
//
// Character consistency: each page is drawn with the FIRST page's picture attached as the
// canonical look of the cast, plus its own parent's picture for local continuity. Without
// those the model re-invents the characters on every page.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error("GEMINI_API_KEY is not set"); process.exit(1); }
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const BASE = "https://generativelanguage.googleapis.com";
const FORCE = process.argv.includes("--force");
const specPath = process.argv[2] || "tools/story-dino.json";
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const OUT_DIR = join("assets", "storytime", spec.id);
mkdirSync(OUT_DIR, { recursive: true });

const STYLE = `A single illustration for a children's picture book, for a six-year-old. Bright,
warm, cheerful, hand-painted storybook style with bold simple shapes and soft rounded edges.
Friendly and completely non-scary: happy faces, gentle light, cozy mood. No text, letters,
numbers, or words anywhere in the image. The artwork fills the entire frame edge to edge as a
full-bleed page: no white border, no paper margin, no vignette — the background colour reaches
all four edges.`;

const KEEP = `The picture(s) above are earlier pages of this same book. Keep every character
EXACTLY as they appear there — same species, same colours, same clothing, same face, same
proportions — and keep the same art style and palette. Only the action and setting change.`;

async function generate(node, refs) {
  const parts = [];
  for (const r of refs) parts.push({ inlineData: { mimeType: "image/png", data: r } });
  if (refs.length) parts.push({ text: KEEP });
  parts.push({ text: `${STYLE}\n\nTHE CAST (always draw them this way): ${spec.cast}\n\nTHIS PAGE SHOWS: ${node.art}` });
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`${BASE}/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { imageConfig: { aspectRatio: "4:3" } } }),
    });
    const j = await r.json().catch(() => ({}));
    const cand = (j.candidates || [])[0] || {};
    const hit = ((cand.content || {}).parts || []).find((p) => p.inlineData);
    if (hit) return hit.inlineData.data;
    const why = j.error ? `${j.error.status}: ${j.error.message}` : cand.finishReason || "no image";
    console.log(`    attempt ${attempt} failed — ${why}`);
    if (cand.finishReason === "PROHIBITED_CONTENT") return null;   // retrying won't help
    await new Promise((s) => setTimeout(s, 1500 * attempt));
  }
  return null;
}

// Gemini returns ~1.5MB PNGs. Downscale to a web-sized JPEG in headless Chromium — the same
// canvas trick the app already uses for photos, so this needs no image library.
const require = createRequire("/opt/node22/lib/node_modules/playwright/");
const { chromium } = require("playwright");
const browser = await chromium.launch();
const shrinkPage = await browser.newPage();
async function toJpeg(b64, width = 1000, quality = 0.82) {
  return shrinkPage.evaluate(async ({ b64, width, quality }) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const w = Math.min(width, img.width), h = Math.round(img.height * (w / img.width));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return c.toDataURL("image/jpeg", quality).split(",")[1];
  }, { b64, width, quality });
}

// Walk the tree breadth-first: a page can only be drawn once its parent's picture exists.
const nodes = spec.nodes;
const parentOf = {};
for (const [id, n] of Object.entries(nodes)) {
  for (const c of n.choices || []) parentOf[c.to] = id;
  if (n.next) parentOf[n.next] = id;
}
const rootId = Object.keys(nodes).find((id) => !parentOf[id]);
const order = [];
(function walk(id) {
  order.push(id);
  const n = nodes[id];
  for (const c of n.choices || []) walk(c.to);
  if (n.next) walk(n.next);
})(rootId);

const pngCache = {};                       // id -> base64 PNG, for use as a reference
let made = 0, skipped = 0, failed = [];
console.log(`baking "${spec.title}" — ${order.length} pages → ${OUT_DIR}`);
for (const id of order) {
  const node = nodes[id];
  const file = join(OUT_DIR, id + ".jpg");
  if (existsSync(file) && !FORCE) { skipped++; node.img = `/${OUT_DIR}/${id}.jpg`.replace(/\\/g, "/"); continue; }
  const refs = [];
  if (id !== rootId && pngCache[rootId]) refs.push(pngCache[rootId]);
  const par = parentOf[id];
  if (par && par !== rootId && pngCache[par]) refs.push(pngCache[par]);
  process.stdout.write(`  ${id} … `);
  const png = await generate(node, refs);
  if (!png) { failed.push(id); console.log("FAILED"); continue; }
  pngCache[id] = png;
  writeFileSync(file, Buffer.from(await toJpeg(png), "base64"));
  node.img = `/${OUT_DIR}/${id}.jpg`.replace(/\\/g, "/");
  made++;
  console.log(`ok (${(Buffer.from(png, "base64").length / 1024).toFixed(0)}KB png → ${(require("node:fs").statSync(file).size / 1024).toFixed(0)}KB jpg)`);
}

// The playable file: text, choices and picture paths. No cast/art-direction fields — those are
// build-time only and would just bloat what the iPad downloads.
const out = { id: spec.id, title: spec.title, em: spec.em, root: rootId, pages: {} };
for (const [id, n] of Object.entries(nodes)) {
  out.pages[id] = { text: n.text, img: n.img || null };
  if (n.choices) out.pages[id].choices = n.choices.map((c) => ({ em: c.em, text: c.text, to: c.to }));
  if (n.next) out.pages[id].next = n.next;
  if (n.end) out.pages[id].end = true;
}
writeFileSync(join(OUT_DIR, "story.json"), JSON.stringify(out));
await browser.close();
console.log(`\n${made} drawn, ${skipped} already done, ${failed.length} failed${failed.length ? " — " + failed.join(", ") : ""}`);
console.log(`≈ $${(made * 0.039).toFixed(2)} spent this run`);
process.exit(failed.length ? 1 : 0);
