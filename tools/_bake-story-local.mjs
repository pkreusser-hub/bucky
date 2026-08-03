// Bake a Story Time Jr story using the LOCAL SwarmUI image generator instead of the paid
// Gemini API. Same job as _bake-story.mjs (its Gemini sibling — read that one first, this
// file mirrors its shape closely): every page's picture is generated once, ahead of time, so
// the baked story then costs nothing to read, appears instantly, works with no network, and
// can never drift or lose the plot. Only the image-generation backend differs.
//
//   node tools/_bake-story-local.mjs tools/story-dino.json
//
// Needs SwarmUI (http://localhost:7801 by default, override with SWARM_URL=...) running
// locally with both checkpoints installed:
//   - juggernautXL_ragnarok.safetensors               (root page — plain SDXL txt2img)
//   - qwenImageEdit_qwenImgEditFp8E4m3fn.safetensors   (every other page — image-edit,
//     conditioned on reference pictures so the cast doesn't drift page to page)
//
// RESUMABLE: a page whose picture already exists is skipped, so a re-run after a failure or a
// text edit never pays for the same picture twice. Pass --force to regenerate everything.
//
// Character consistency, SwarmUI-style: Gemini took reference images as inline message parts;
// SwarmUI's Qwen edit model takes them as `promptimages` (comma-joined base64 data URLs) on
// the generate call. Every non-root page gets the ROOT page's picture (the cast's canonical
// look) plus its own PARENT page's picture (local continuity) as references — same reference
// strategy as the Gemini original.
//
// Two prompting problems showed up in testing and are designed around here:
//   1. Attribute bleed on the root page (it has no reference image to anchor it). SDXL binds
//      adjectives loosely across a prompt, so a run-on description let the wrong character
//      pick up the wrong colour ("boy in a green t-shirt ... dinosaur with green polka dots"
//      produced a boy in polka dots and a blue dinosaur). STYLE/NEG and the root-prompt
//      assembly below were tuned against three real test generations of the baked dino art
//      until this stopped happening — see rootPrompt(). Key finding: spec.cast is ALREADY
//      written with each character's colours in its own tight clause (one sentence per
//      character), so the fix is to concatenate it verbatim, never reword or merge it into a
//      different shape — reformatting it is what reintroduces the bleed.
//   2. Secondary-character drift on edit pages — Qwen held the main character's look
//      perfectly but reinvented the small dinosaur's colours. A generic "keep everything the
//      same" instruction wasn't enough on its own, so the fix restates spec.cast verbatim.
//      BUT prompt ORDER turned out to be load-bearing here too, and got it wrong the first
//      time: leading with a long "keep everything exactly as it appears" preamble (the way
//      the Gemini original's KEEP constant is written) makes Qwen preserve the reference image
//      and IGNORE the scene change entirely — verified live, it produced the unchanged
//      reference picture in the old setting with none of the new page's action. The scene
//      change must come FIRST; the "keep the character" clause must be short and come after —
//      see editPrompt() below. Do not port the Gemini KEEP constant's shape.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { request as httpRequest, get as httpGet } from "node:http";

const SWARM_BASE = process.env.SWARM_URL || "http://localhost:7801";
const swarmUrl = new URL(SWARM_BASE);
const ROOT_MODEL = "juggernautXL_ragnarok.safetensors";
const EDIT_MODEL = "qwenImageEdit_qwenImgEditFp8E4m3fn.safetensors";
const W = 1152, H = 864;                 // 4:3 — generation size for both models
const OUT_W = 1000, OUT_H = 750;         // 4:3 — baked size (matches the existing dino pages)
const FORCE = process.argv.includes("--force");
// --sdxl: draw every page with the root (SDXL) model, no reference images. See the engine
// trade-off note in the page loop below for why this is the better default for a picture book.
const SDXL_ONLY = process.argv.includes("--sdxl");
// --limit N: stop cleanly after N pages this run. Long unattended bakes have taken SwarmUI down
// four times, and it slows before it goes: 19s/page early, then 27, 44, 77 as a run wears on,
// which reads like resource pressure building up rather than a bad page. Chunking sidesteps it —
// resumability means `--limit 25` run repeatedly finishes the same book without ever reaching
// the point where the server falls over.
// --lora <name> [--loraweight w]: draw every page through a trained character LoRA. With one the
// hero comes from a trigger token in the prompt, so no reference image is needed and pages
// generate at SDXL speed (~15s) instead of Qwen edit speed (~200s), with full compositional
// freedom — no reference framing to bleed in.
const lri = process.argv.indexOf("--lora");
const LORA = lri > -1 && process.argv[lri + 1] ? process.argv[lri + 1] : null;
const lwi = process.argv.indexOf("--loraweight");
const LORA_WEIGHT = lwi > -1 && process.argv[lwi + 1] ? process.argv[lwi + 1] : "0.8";
const li = process.argv.indexOf("--limit");
const LIMIT = li > -1 && +process.argv[li + 1] > 0 ? +process.argv[li + 1] : Infinity;
const specPath = process.argv[2] || "tools/story-dino.json";
const spec = JSON.parse(readFileSync(specPath, "utf8"));

const OUT_DIR = join("assets", "storytime", spec.id);
mkdirSync(OUT_DIR, { recursive: true });

// Verified against three real test generations of the baked dino art (see header comment,
// problem 1): attempt 1 drifted photoreal-painterly, attempt 2 went hard-clipart (thick black
// outlines), attempt 3 — these exact strings — matched the existing baked look: soft painterly,
// no outlines, warm golden light, a wide establishing shot. Do not re-tune these by feel; they
// are load-bearing for matching the art the app already ships.
// "cute friendly cartoon people ... rounded cartoon faces" is doing real work: human characters
// drag SDXL toward semi-realistic adult illustration, which does not match the storybook look the
// animal pages get for free. Without it the pirates came out as a painted adult book cover.
const STYLE = `soft painterly children's picture book illustration, digital storybook painting, cute friendly cartoon people with simple rounded cartoon faces and big kind eyes, cute stylised cartoon animals with big friendly eyes, soft airbrushed shading, no outlines, warm golden sunlight, gentle warm pastel palette, completely non-scary, cozy and sweet, wide establishing shot showing the whole scene, full-bleed artwork filling the frame, no text, no letters, no words`;

// The anthropomorphic terms are not decoration. Naming an animal anywhere in the cast pulls
// the PEOPLE toward that species: a pirate book whose cast mentioned a pet parrot rendered both
// human pirates as parrots in tricorn hats — correct beard colour and coat, bird body. Same
// failure family as a kitten drawn as a second goat. Keep these whenever people and animals
// share a page. "letters, words, writing" is likewise load-bearing: plain "text" alone still
// let a label through onto a bottle.
// The drink terms are not paranoia — "pirate" reliably summons grog. Test pages came back with
// both characters raising glasses of amber liquid on deck, which is not going in a book for a
// six-year-old. Weapons go for the same reason.
const NEG = `two boys, two children, three children, twins, second child, another child, group of children, crowd of people, text, letters, words, writing, watermark, signature, beer, mug, tankard, drinking, glass of drink, alcohol, grog, barrel of rum, weapon, sword, gun, knife, anthropomorphic animal, animal head on a human body, bird person, parrot person, beak, feathers on a person, furry, thick black outlines, bold outlines, clipart, coloring book, cel shaded, photorealistic, realistic photo, photograph, 3d render, close-up portrait, scary, dark, gloomy, blurry, deformed, extra limbs, ugly, nsfw`;

// Qwen's own negative prompt, verified separately (shorter — the long SDXL one above is not
// reused here).
const NEG_EDIT = `text, watermark, thick black outlines, clipart, photorealistic, scary, dark, blurry, deformed, ugly, nsfw`;

// spec.cast is ALREADY written with each character's colours in its own tight clause (one
// sentence per character — see tools/story-dino.json). That's what keeps SDXL/Qwen from
// binding the wrong colour to the wrong character, so it's used verbatim below — reformatting
// or re-wording it (numbered lists, relabeling, etc.) is what reintroduces attribute bleed.
// Only the TRUE first page gets spec.cast, because spec.cast also establishes the setting
// ("...a big red barn, a wooden fence, green grass, a blue duck pond, a field of yellow
// flowers") and page one is where that has to be drawn. Every later page gets spec.keep — the
// characters alone — and takes its setting from node.art. Feeding the cast's setting sentence
// into a later page fights that page's own scene: a bake that did so put a page captioned
// "inside the barn" out in the flowery farmyard, with the scene's kitten missing entirely.
function rootPrompt(node, isTrueRoot) {
  const who = isTrueRoot ? spec.cast : (spec.keep || spec.cast);
  return `solo, 1boy, a single child alone. ${STYLE}. ${who} ${node.art}`;
}

// Scene change FIRST, "keep the character" clause SHORT and second (see header comment,
// problem 2) — verified live: reversing this order (long preserve-preamble first) makes Qwen
// ignore the scene change and just hand back the reference image in its original setting.
//
// The keep-clause uses spec.keep (the CHARACTERS ONLY), never spec.cast. spec.cast also
// describes the SETTING, because the root page needs it drawn — but feeding that setting into
// a "keep this exactly" instruction pins the barn/fence/field in place and fights the very
// scene change we're asking for. A first bake did exactly that: every page came back as the
// hero standing in the same farmyard, with the ducklings/kitten/hay of the actual scene
// missing. Characters here, setting only in node.art.
function editPrompt(node) {
  return `Redraw this scene as a new page of the book: ${node.art}\n\nKeep the main character exactly as they look here — ${spec.keep || spec.cast} — and keep the same soft painterly storybook art style, palette and warm lighting. Change the setting and the action to match the new scene described above.`;
}

// A simple deterministic string hash (djb2, xor-folded) so re-running the same page always
// asks SwarmUI for the same seed — no randomness, nothing to track by hand.
function seedFor(id) {
  // SEED_NUDGE shifts every page's seed by a fixed amount so tools/_redo-pages.mjs can re-roll a
  // bad page into a genuinely different image. Unset (the normal case) it is 0, so a plain
  // re-run stays perfectly reproducible.
  const nudge = +(process.env.SEED_NUDGE || 0);
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return (h + nudge * 7919) % 2147483647;
}

// --- tiny SwarmUI HTTP client ------------------------------------------------------------
// Plain node:http rather than fetch: a Qwen generation genuinely takes ~180s, and undici's
// fetch() carries hidden default socket timeouts that are too easy to trip by accident. A
// bare http.request has none unless one is set, so the only timeout below is a deliberately
// generous safety net against a truly hung server — never against normal generation time.
function httpJson(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = bodyObj !== undefined ? Buffer.from(JSON.stringify(bodyObj)) : null;
    const req = httpRequest({
      hostname: swarmUrl.hostname,
      port: swarmUrl.port || 80,
      path,
      method,
      headers: data ? { "content-type": "application/json", "content-length": data.length } : {},
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON, leave null */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on("error", reject);
    req.setTimeout(20 * 60 * 1000, () => req.destroy(new Error(`SwarmUI request to ${path} timed out`)));
    if (data) req.write(data);
    req.end();
  });
}

function httpBytes(path) {
  // SwarmUI's returned image path can carry characters (spaces, etc.) that node:http's raw
  // request line will not escape for you — pass it through unescaped and you get
  // ERR_UNESCAPED_CHARACTERS ("Request path contains unescaped characters") right when the
  // fetch-the-bytes step runs, AFTER a real (paid-in-time) generation already completed.
  const safePath = encodeURI(path);
  return new Promise((resolve, reject) => {
    const req = httpGet({ hostname: swarmUrl.hostname, port: swarmUrl.port || 80, path: safePath }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(5 * 60 * 1000, () => req.destroy(new Error(`SwarmUI fetch of ${path} timed out`)));
  });
}

let sessionId;
{
  // The handshake also doubles as the "is SwarmUI up?" preflight. It must catch a thrown
  // socket error, not just a response missing session_id: with SwarmUI stopped, the bare
  // ECONNREFUSED escaped as an unhandled rejection and printed a Node stack trace instead of
  // telling you the one thing you need to know.
  let json;
  try {
    ({ json } = await httpJson("POST", "/API/GetNewSession", {}));
  } catch (e) {
    console.error(`Cannot reach SwarmUI at ${SWARM_BASE} — ${e.message}`);
    console.error(`Start SwarmUI (or set SWARM_URL=...) and run this again.`);
    process.exit(1);
  }
  sessionId = json && json.session_id;
  if (!sessionId) {
    console.error(`Could not get a SwarmUI session from ${SWARM_BASE} — is SwarmUI running?`);
    process.exit(1);
  }
}

async function generate(node, isRoot, refs, seed, isTrueRoot) {
  const body = {
    session_id: sessionId,
    images: 1,
    prompt: isRoot ? rootPrompt(node, isTrueRoot) : editPrompt(node),
    negativeprompt: isRoot ? NEG : NEG_EDIT,
    model: isRoot ? ROOT_MODEL : EDIT_MODEL,
    width: W,
    height: H,
    steps: isRoot ? 30 : 20,
    cfgscale: isRoot ? 5 : 2.5,          // Qwen is very cfg-sensitive: 4.0 blew the image out to a
                                          // solid colour rectangle in testing — never raise this.
    seed,
    imageformat: "PNG",
  };
  // SwarmUI's image_list separator is a PIPE, not a comma. Comma-joining validates fine with a
  // single image (nothing to split) but is rejected outright the moment there are two —
  // "Invalid image-list value for param Prompt Images" — because base64 contains no commas, so
  // the whole joined string arrives as one unparseable image. That failed every 2-reference
  // page (and only those) on a first bake.
  if (LORA) { body.loras = LORA.endsWith(".safetensors") ? LORA : LORA + ".safetensors"; body.loraweights = LORA_WEIGHT; }
  if (!isRoot && refs.length) body.promptimages = refs.map((b64) => `data:image/png;base64,${b64}`).join("|");

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { json, status } = await httpJson("POST", "/API/GenerateText2Image", body);
      const rel = json && Array.isArray(json.images) && json.images[0];
      if (rel) {
        const png = await httpBytes("/" + String(rel).replace(/^\/+/, ""));
        if (png && png.length) return png;
      }
      const why = json && (json.error || json.error_id) ? (json.error || json.error_id) : `HTTP ${status}, no image in response`;
      console.log(`    attempt ${attempt} failed — ${why}`);
    } catch (e) {
      console.log(`    attempt ${attempt} failed — ${e.message}`);
      // A refused/reset socket means SwarmUI itself is gone, not that this page is unlucky.
      // Long bakes have crashed it outright mid-run (a 93-page book died at page 21, after
      // slowing from 19s to 77s/page — it was thrashing before it fell over). Retrying is
      // pointless once the server is down, and grinding the rest of the tree through 3
      // instant failures each buries the real cause under a wall of "FAILED": stop now and
      // say so, so the resume is obvious. Pages already on disk are kept and skipped.
      if (/ECONNREFUSED|ECONNRESET|EPIPE|socket hang up/i.test(e.message || "")) throw new ServerGone(e.message);
    }
    if (attempt < 3) await new Promise((s) => setTimeout(s, 3000 * attempt));
  }
  return null;
}

class ServerGone extends Error {}

// --- PNG -> 1000x750 JPEG, via PowerShell + .NET System.Drawing --------------------------
// sharp's native binding is broken in this environment (known project gotcha), and there's no
// headless browser already open to lean on here (unlike the Gemini original, which had
// playwright open anyway for its own reasons) — .NET's Bitmap/Graphics is the proven fallback
// used elsewhere in this repo for image resizes.
const RESIZE_PS1 = join(tmpdir(), "bucky-bake-story-resize.ps1");
writeFileSync(RESIZE_PS1, `
param(
  [Parameter(Mandatory=$true)][string]$InPath,
  [Parameter(Mandatory=$true)][string]$OutPath,
  [int]$Width = 1000,
  [int]$Height = 750,
  [int]$Quality = 82
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($InPath)
try {
  $dst = New-Object System.Drawing.Bitmap($Width, $Height)
  try {
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($src, 0, 0, $Width, $Height)
    } finally { $g.Dispose() }
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
    $dst.Save($OutPath, $codec, $ep)
  } finally { $dst.Dispose() }
} finally { $src.Dispose() }
`, "utf8");

function toJpeg(pngBuffer) {
  const tag = randomBytes(6).toString("hex");
  const inPath = join(tmpdir(), `bucky-bake-${tag}.png`);
  const outPath = join(tmpdir(), `bucky-bake-${tag}.jpg`);
  writeFileSync(inPath, pngBuffer);
  try {
    const r = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", RESIZE_PS1,
      "-InPath", inPath, "-OutPath", outPath,
      "-Width", String(OUT_W), "-Height", String(OUT_H), "-Quality", "82",
    ], { encoding: "utf8" });
    if (r.status !== 0 || !existsSync(outPath)) {
      throw new Error(`PowerShell resize failed (exit ${r.status}): ${r.stderr || r.stdout}`);
    }
    return readFileSync(outPath);
  } finally {
    try { unlinkSync(inPath); } catch { /* best-effort cleanup */ }
    try { if (existsSync(outPath)) unlinkSync(outPath); } catch { /* best-effort cleanup */ }
  }
}

// Walk the tree breadth/depth first: a page can only be drawn once its parent's picture exists.
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

const pngCache = {};                       // id -> base64 PNG, for use as a promptimages reference
const timings = { root: [], edit: [] };
let made = 0, skipped = 0, failed = [];
let serverGone = null;                     // set when SwarmUI dies mid-run; stops the walk
let hitLimit = false;                      // set when --limit stopped us short of the end
console.log(`baking "${spec.title}" — ${order.length} pages → ${OUT_DIR} (local SwarmUI @ ${SWARM_BASE})`);
const wallStart = Date.now();
for (const id of order) {
  const node = nodes[id];
  const file = join(OUT_DIR, id + ".jpg");
  // --sdxl draws EVERY page with the root model and no reference image at all. The two engines
  // trade off in opposite directions, measured on the same page (kitten riding on the goat's
  // back in the barn): Qwen holds the cast perfectly but quietly refuses big pose/action
  // changes — it handed back the reference's composition with the action missing — while SDXL
  // renders the action correctly and, with the cast clause and a fixed seed, still keeps the
  // hero recognisable. In a picture book each page has to match its own sentence, so action
  // fidelity is worth more than a perfect coat match. It is also ~8x faster (25s vs 200s).
  const isRoot = id === rootId || SDXL_ONLY;
  if (existsSync(file) && !FORCE) { skipped++; node.img = `/${OUT_DIR}/${id}.jpg`.replace(/\\/g, "/"); continue; }
  // Qwen treats MULTIPLE promptimages as subjects to COMPOSITE, not as continuity context:
  // passing root+parent produced two Bos spliced into one frame. One reference only — the
  // immediate parent, which already contains both the hero and whatever that branch introduced.
  const refs = [];
  if (!isRoot) {
    const par = parentOf[id];
    if (par && pngCache[par]) refs.push(pngCache[par]);
    else if (pngCache[rootId]) refs.push(pngCache[rootId]);
  }
  const seed = seedFor(id);
  const refNote = refs.length ? `, ${refs.length} ref${refs.length === 1 ? "" : "s"}` : "";
  process.stdout.write(`  ${id} (${isRoot ? "root/juggernaut" : "edit/qwen"}${refNote}) … `);
  if (made >= LIMIT) { hitLimit = true; break; }
  const pageStart = Date.now();
  let png;
  try {
    png = await generate(node, isRoot, refs, seed, id === rootId);
  } catch (e) {
    if (!(e instanceof ServerGone)) throw e;
    console.log("FAILED");
    serverGone = e.message;
    break;
  }
  const pageSec = (Date.now() - pageStart) / 1000;
  if (!png) { failed.push(id); console.log("FAILED"); continue; }
  (isRoot ? timings.root : timings.edit).push(pageSec);
  pngCache[id] = png.toString("base64");
  const jpg = toJpeg(png);
  writeFileSync(file, jpg);
  node.img = `/${OUT_DIR}/${id}.jpg`.replace(/\\/g, "/");
  made++;
  console.log(`ok in ${pageSec.toFixed(0)}s (seed ${seed}, ${(png.length / 1024).toFixed(0)}KB png → ${(jpg.length / 1024).toFixed(0)}KB jpg)`);
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

const avg = (a) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(0) : null);
const wallSec = (Date.now() - wallStart) / 1000;
console.log(`\n${made} drawn, ${skipped} already done, ${failed.length} failed${failed.length ? " — " + failed.join(", ") : ""}`);
if (hitLimit) {
  const left = order.length - made - skipped;
  console.log(`\nstopped at --limit ${LIMIT}. ${left} page${left === 1 ? "" : "s"} still to draw — re-run the same command to continue.`);
}
if (serverGone) {
  const left = order.length - made - skipped;
  console.log(`\n⚠ STOPPED EARLY — SwarmUI stopped responding (${serverGone}).`);
  console.log(`  ${left} page${left === 1 ? "" : "s"} not drawn yet. The ${made + skipped} finished page${made + skipped === 1 ? "" : "s"} are saved.`);
  console.log(`  Restart SwarmUI on ${SWARM_BASE}, then re-run the SAME command — finished pages are skipped, so it picks up where it left off.`);
}
if (timings.root.length) console.log(`  root/juggernaut avg ${avg(timings.root)}s/page (${timings.root.length} page${timings.root.length === 1 ? "" : "s"})`);
if (timings.edit.length) console.log(`  edit/qwen avg ${avg(timings.edit)}s/page (${timings.edit.length} page${timings.edit.length === 1 ? "" : "s"})`);
console.log(`took ${wallSec.toFixed(0)}s wall-clock this run`);
process.exit(failed.length || serverGone ? 1 : 0);
