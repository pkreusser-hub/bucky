#!/usr/bin/env node
/*
 * meshy.js — CLI for Meshy.ai's REST API (https://api.meshy.ai).
 *
 * Generates game-ready GLB assets from text prompts or images via Meshy's
 * two-stage text-to-3d (preview -> refine) or image-to-3d pipeline, polls
 * task status, and downloads the resulting .glb into assets/.
 *
 * The API key is read from ~/.meshy_key at runtime (os.homedir()) and is
 * NEVER written to disk, logged, or embedded in any file in this repo.
 *
 * Usage:
 *   node tools/meshy.js text "<prompt>" --name <asset-name> [--polycount 3000] [--no-refine] [--no-remesh]
 *   node tools/meshy.js image <path-or-url> --name <asset-name> [--polycount 3000] [--no-texture] [--no-remesh]
 *   node tools/meshy.js remesh <task-id> --name <asset-name> [--polycount 3000] [--topology triangle]
 *   node tools/meshy.js rig <task-id-or-model-url> --name <asset-name> [--height 1.7] [--texture-url <url>]
 *   node tools/meshy.js animate <rig-task-id> --name <asset-name> --action-id <id> [--fps 30]
 *   node tools/meshy.js status <task-id> [--kind text|image|remesh|rig|animate]
 *   node tools/meshy.js list [--kind text|image]
 *
 * Note: should_remesh defaults to TRUE here (Meshy's own default is false for
 * meshy-6) because without it target_polycount is not honored — a nominal
 * 3000-triangle request came back with ~317K triangles. Use --no-remesh to
 * get the raw un-decimated mesh.
 *
 * Docs verified against https://docs.meshy.ai on 2026-07-04. Field names below
 * (model_type vs topology, consumed_credits, etc.) follow the current docs,
 * which occasionally drift from older blog posts / examples.
 *
 * --- rig / animate notes (docs.meshy.ai/en/api/rigging-and-animation) ---
 * POST /openapi/v1/rigging
 *   body: { input_task_id | model_url, height_meters?, texture_image_url? }
 *   HUMANOID/BIPEDAL ONLY. Docs: "currently only works well with standard
 *   humanoid (bipedal) assets with clearly defined limbs." Quadrupeds are
 *   NOT supported by this endpoint — do not attempt rig on turtle/goatchar/
 *   collie/armadillo/snake; they stay static GLBs by design.
 *   Model must face +Z (glTF forward), must be textured, <=300k faces.
 *   Result on SUCCEEDED includes rigged_character_glb_url/fbx_url PLUS
 *   FREE bundled basic_animations { walking_glb_url, running_glb_url,
 *   (+ _fbx_url, _armature_glb_url variants) }. So one rig call already
 *   gets you a walk+run GLB without a separate /animations call.
 *   consumed_credits: docs example shows 5, changelog says 10 — verify
 *   against the real response each time, don't trust either figure blindly.
 *
 * POST /openapi/v1/animations
 *   body: { rig_task_id, action_id, change_fps?, fbx2usdz?, extract_armature? }
 *   ONE call = ONE clip = ONE glb (no multi-clip batching in a single call).
 *   action_id comes from the Animation Library (docs.meshy.ai/en/api/animation-library),
 *   540+ entries. Known-good generic ids: Idle=0, Walk=1 ("Walking_Woman")
 *   or 30 ("Casual_Walk"), Run=14 ("Run_02") or 16 ("RunFast").
 *   Use this mainly to grab Idle (action-id 0) since rig already bundles
 *   walk+run for free.
 *
 * pose_mode (on text-to-3d v2 create, NOT rig): "a-pose"|"t-pose"|"" replaces
 * deprecated is_a_t_pose. Pass pose_mode:"a-pose" when generating humanoids
 * intended for rigging, for the best auto-rig success chance.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

const ROOT = path.resolve(__dirname, ".."); // BUCKY root
const ASSETS_DIR = path.join(ROOT, "assets");
const API_HOST = "api.meshy.ai";
const OVERALL_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const POLL_INTERVAL_MS = 10 * 1000;

// ------------------------------------------------------------------ key
function readApiKey(){
  const keyPath = path.join(os.homedir(), ".meshy_key");
  if (!fs.existsSync(keyPath)){
    throw new Error(`API key file not found at ${keyPath}. Create it with your Meshy API key (plain text).`);
  }
  const key = fs.readFileSync(keyPath, "utf8").trim();
  if (!key) throw new Error(`API key file at ${keyPath} is empty.`);
  return key;
}

// -------------------------------------------------------------- http(s)
function request(apiKey, method, urlPath, body){
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        host: API_HOST,
        path: urlPath,
        method,
        headers: Object.assign(
          {
            "Authorization": `Bearer ${apiKey}`,
          },
          payload
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
            : {}
        ),
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          let parsed = null;
          try { parsed = data ? JSON.parse(data) : null; } catch (e) { /* leave null */ }
          resolve({ statusCode: res.statusCode, body: parsed, raw: data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function explainStatusError(res){
  const msg = (res.body && (res.body.message || (res.body.error && res.body.error.message))) || res.raw || "";
  if (res.statusCode === 401){
    return new Error(`401 Unauthorized — API key is missing or invalid. Check ~/.meshy_key. Server said: ${msg}`);
  }
  if (res.statusCode === 402){
    return new Error(`402 Payment Required — account is out of Meshy credits. Server said: ${msg}`);
  }
  if (res.statusCode === 429){
    return new Error(`429 Too Many Requests — rate limited by Meshy. Server said: ${msg}`);
  }
  return new Error(`Meshy API error ${res.statusCode}: ${msg}`);
}

async function apiCall(apiKey, method, urlPath, body){
  const res = await request(apiKey, method, urlPath, body);
  if (res.statusCode < 200 || res.statusCode >= 300){
    throw explainStatusError(res);
  }
  return res.body;
}

// Downloads a URL (https) to a local file path.
function downloadTo(url, destPath){
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
        file.close();
        fs.unlink(destPath, () => {});
        return downloadTo(res.headers.location, destPath).then(resolve, reject);
      }
      if (res.statusCode !== 200){
        file.close();
        fs.unlink(destPath, () => {});
        return reject(new Error(`Download failed with HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve()));
    }).on("error", (err) => {
      file.close();
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ------------------------------------------------------------------ CLI
function parseFlags(argv){
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++){
    const a = argv[i];
    if (a.startsWith("--")){
      const key = a.slice(2);
      if (key === "no-refine"){ flags.refine = false; continue; }
      if (key === "no-texture"){ flags.texture = false; continue; }
      if (key === "no-remesh"){ flags.remesh = false; continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")){
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function fmtCredits(taskBody){
  if (!taskBody) return "";
  if (typeof taskBody.consumed_credits === "number"){
    return ` (consumed_credits: ${taskBody.consumed_credits})`;
  }
  return "";
}

function printProgress(kind, taskBody){
  const status = taskBody.status;
  const progress = typeof taskBody.progress === "number" ? `${taskBody.progress}%` : "?";
  const preceding = taskBody.preceding_tasks != null ? ` queue:${taskBody.preceding_tasks}` : "";
  console.log(`[${kind}] ${taskBody.id}  status=${status} progress=${progress}${preceding}`);
}

// Polls a text-to-3d or image-to-3d task until it reaches a terminal state.
async function pollTask(apiKey, endpointBase, id, kind, deadline){
  for (;;){
    if (Date.now() > deadline){
      throw new Error(`Timed out after 60 minutes waiting on task ${id}. Resume later with: node tools/meshy.js status ${id} --kind ${kind}`);
    }
    const task = await apiCall(apiKey, "GET", `${endpointBase}/${id}`, null);
    printProgress(kind, task);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED"){
      const errMsg = (task.task_error && task.task_error.message) || "unknown error";
      throw new Error(`Task ${id} FAILED: ${errMsg}`);
    }
    if (task.status === "CANCELED"){
      throw new Error(`Task ${id} was CANCELED.`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function downloadGlb(task, assetName){
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const glbUrl = task.model_urls && task.model_urls.glb;
  if (!glbUrl) throw new Error(`Task ${task.id} succeeded but no model_urls.glb was returned.`);
  const destPath = path.join(ASSETS_DIR, `${assetName}.glb`);
  await downloadTo(glbUrl, destPath);
  return destPath;
}

// Downloads an arbitrary URL to assets/<assetName>.glb (used for rig/animate
// tasks whose result field names differ from the generation endpoints).
async function downloadUrlAsGlb(url, assetName){
  if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });
  const destPath = path.join(ASSETS_DIR, `${assetName}.glb`);
  await downloadTo(url, destPath);
  return destPath;
}

// ------------------------------------------------------------- commands
async function cmdText(argv){
  const { flags, positional } = parseFlags(argv);
  const prompt = positional.join(" ");
  if (!prompt) throw new Error("Usage: node tools/meshy.js text \"<prompt>\" --name <asset-name> [--polycount 3000] [--no-refine]");
  if (!flags.name) throw new Error("Missing required --name <asset-name>");
  const polycount = flags.polycount ? parseInt(flags.polycount, 10) : 3000;
  const doRefine = flags.refine !== false;
  const shouldRemesh = flags.remesh !== false; // default TRUE so target_polycount is honored
  const poseMode = flags["pose-mode"] || undefined; // "a-pose" | "t-pose"

  const apiKey = readApiKey();
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const endpointBase = "/openapi/v2/text-to-3d";

  console.log(`Creating text-to-3d PREVIEW task for prompt: "${prompt}" (target_polycount=${polycount}, should_remesh=${shouldRemesh}${poseMode ? `, pose_mode=${poseMode}` : ""})`);
  const createBody = {
    mode: "preview",
    prompt,
    topology: "triangle",
    target_polycount: polycount,
    should_remesh: shouldRemesh,
    ai_model: "meshy-6",
  };
  if (poseMode) createBody.pose_mode = poseMode;
  const createRes = await apiCall(apiKey, "POST", endpointBase, createBody);
  const previewId = createRes.result;
  if (!previewId) throw new Error(`Unexpected create response, no "result" task id: ${JSON.stringify(createRes)}`);
  console.log(`Preview task id: ${previewId}  (resume anytime with: node tools/meshy.js status ${previewId} --kind text)`);

  const previewTask = await pollTask(apiKey, endpointBase, previewId, "text-preview", deadline);
  console.log(`Preview SUCCEEDED${fmtCredits(previewTask)}`);

  let finalTask = previewTask;
  if (doRefine){
    console.log(`Creating text-to-3d REFINE task from preview ${previewId} ...`);
    const refineCreate = await apiCall(apiKey, "POST", endpointBase, {
      mode: "refine",
      preview_task_id: previewId,
    });
    const refineId = refineCreate.result;
    if (!refineId) throw new Error(`Unexpected refine create response, no "result" task id: ${JSON.stringify(refineCreate)}`);
    console.log(`Refine task id: ${refineId}  (resume anytime with: node tools/meshy.js status ${refineId} --kind text)`);
    finalTask = await pollTask(apiKey, endpointBase, refineId, "text-refine", deadline);
    console.log(`Refine SUCCEEDED${fmtCredits(finalTask)}`);
  } else {
    console.log("Skipping refine stage (--no-refine). Preview GLBs are untextured.");
  }

  const destPath = await downloadGlb(finalTask, flags.name);
  const size = fs.statSync(destPath).size;
  console.log(`\nDownloaded GLB: ${destPath} (${size} bytes)`);
  console.log(`Done.`);
}

async function cmdImage(argv){
  const { flags, positional } = parseFlags(argv);
  const source = positional[0];
  if (!source) throw new Error("Usage: node tools/meshy.js image <path-or-url> --name <asset-name> [--polycount 3000] [--no-texture]");
  if (!flags.name) throw new Error("Missing required --name <asset-name>");
  const polycount = flags.polycount ? parseInt(flags.polycount, 10) : 3000;
  const shouldTexture = flags.texture !== false;
  const shouldRemesh = flags.remesh !== false; // default TRUE so target_polycount is honored

  const apiKey = readApiKey();
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const endpointBase = "/openapi/v1/image-to-3d";

  let imageUrl;
  if (/^https?:\/\//i.test(source)){
    imageUrl = source;
  } else {
    const abs = path.isAbsolute(source) ? source : path.join(ROOT, source);
    if (!fs.existsSync(abs)) throw new Error(`Image file not found: ${abs}`);
    const ext = path.extname(abs).toLowerCase().replace(".", "");
    const mime = ext === "png" ? "image/png" : "image/jpeg";
    const b64 = fs.readFileSync(abs).toString("base64");
    imageUrl = `data:${mime};base64,${b64}`;
  }

  console.log(`Creating image-to-3d task for: ${/^https?:/i.test(source) ? source : path.basename(source)} (target_polycount=${polycount}, should_remesh=${shouldRemesh})`);
  const createRes = await apiCall(apiKey, "POST", endpointBase, {
    image_url: imageUrl,
    topology: "triangle",
    target_polycount: polycount,
    should_texture: shouldTexture,
    should_remesh: shouldRemesh,
    ai_model: "meshy-6",
  });
  const taskId = createRes.result;
  if (!taskId) throw new Error(`Unexpected create response, no "result" task id: ${JSON.stringify(createRes)}`);
  console.log(`Task id: ${taskId}  (resume anytime with: node tools/meshy.js status ${taskId} --kind image)`);

  const task = await pollTask(apiKey, endpointBase, taskId, "image", deadline);
  console.log(`SUCCEEDED${fmtCredits(task)}`);

  const destPath = await downloadGlb(task, flags.name);
  const size = fs.statSync(destPath).size;
  console.log(`\nDownloaded GLB: ${destPath} (${size} bytes)`);
  console.log(`Done.`);
}

// Remeshes an existing completed task's mesh down to a target polycount.
// POST /openapi/v1/remesh with input_task_id (per docs.meshy.ai/api/remesh);
// textures are preserved in the output.
async function cmdRemesh(argv){
  const { flags, positional } = parseFlags(argv);
  const inputTaskId = positional[0];
  if (!inputTaskId) throw new Error("Usage: node tools/meshy.js remesh <task-id> --name <asset-name> [--polycount 3000] [--topology triangle]");
  if (!flags.name) throw new Error("Missing required --name <asset-name>");
  const polycount = flags.polycount ? parseInt(flags.polycount, 10) : 3000;
  const topology = flags.topology === "quad" ? "quad" : "triangle";

  const apiKey = readApiKey();
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const endpointBase = "/openapi/v1/remesh";

  console.log(`Creating REMESH task from ${inputTaskId} (target_polycount=${polycount}, topology=${topology})`);
  const createRes = await apiCall(apiKey, "POST", endpointBase, {
    input_task_id: inputTaskId,
    target_formats: ["glb"],
    topology,
    target_polycount: polycount,
  });
  const taskId = createRes.result;
  if (!taskId) throw new Error(`Unexpected create response, no "result" task id: ${JSON.stringify(createRes)}`);
  console.log(`Remesh task id: ${taskId}  (resume anytime with: node tools/meshy.js status ${taskId} --kind remesh)`);

  const task = await pollTask(apiKey, endpointBase, taskId, "remesh", deadline);
  console.log(`Remesh SUCCEEDED${fmtCredits(task)}`);

  const destPath = await downloadGlb(task, flags.name);
  const size = fs.statSync(destPath).size;
  console.log(`\nDownloaded GLB: ${destPath} (${size} bytes)`);
  console.log(`Done.`);
}

// Rigs a humanoid/bipedal model. HUMANOID ONLY per docs — do not use on
// quadrupeds (turtle/goatchar/collie/armadillo) or the snake; those fail or
// produce garbage. POST /openapi/v1/rigging. Downloads the rigged (bind-pose)
// GLB to assets/<name>.glb, and the two FREE bundled basic_animations
// (walking, running) to assets/<name>-walk.glb / <name>-run.glb.
async function cmdRig(argv){
  const { flags, positional } = parseFlags(argv);
  const source = positional[0];
  if (!source) throw new Error("Usage: node tools/meshy.js rig <task-id-or-model-url> --name <asset-name> [--height 1.7] [--texture-url <url>]");
  if (!flags.name) throw new Error("Missing required --name <asset-name>");
  const heightMeters = flags.height ? parseFloat(flags.height) : undefined;

  const apiKey = readApiKey();
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const endpointBase = "/openapi/v1/rigging";

  const isUrl = /^https?:\/\//i.test(source) || /^data:/i.test(source);
  const body = isUrl ? { model_url: source } : { input_task_id: source };
  if (heightMeters) body.height_meters = heightMeters;
  if (flags["texture-url"]) body.texture_image_url = flags["texture-url"];

  console.log(`Creating RIG task from ${isUrl ? "model_url" : "input_task_id"}=${source}${heightMeters ? ` height_meters=${heightMeters}` : ""}`);
  const createRes = await apiCall(apiKey, "POST", endpointBase, body);
  const taskId = createRes.result;
  if (!taskId) throw new Error(`Unexpected create response, no "result" task id: ${JSON.stringify(createRes)}`);
  console.log(`Rig task id: ${taskId}  (resume anytime with: node tools/meshy.js status ${taskId} --kind rig)`);

  const task = await pollTask(apiKey, endpointBase, taskId, "rig", deadline);
  console.log(`Rig SUCCEEDED${fmtCredits(task)}`);
  console.log(`Full result: ${JSON.stringify(task.result, null, 2)}`);

  const result = task.result || {};
  const outputs = [];
  if (result.rigged_character_glb_url){
    const p = await downloadUrlAsGlb(result.rigged_character_glb_url, flags.name);
    outputs.push(["rigged (bind pose)", p]);
  }
  const basic = result.basic_animations || {};
  if (basic.walking_glb_url){
    const p = await downloadUrlAsGlb(basic.walking_glb_url, `${flags.name}-walk`);
    outputs.push(["walk (bundled free)", p]);
  }
  if (basic.running_glb_url){
    const p = await downloadUrlAsGlb(basic.running_glb_url, `${flags.name}-run`);
    outputs.push(["run (bundled free)", p]);
  }
  console.log(`\nDownloaded:`);
  for (const [label, p] of outputs){
    const size = fs.statSync(p).size;
    console.log(`  [${label}] ${p} (${size} bytes)`);
  }
  console.log(`\nRig task id (save this for animate): ${taskId}`);
  console.log(`Done.`);
}

// Applies one named animation clip (by action_id from the Animation Library)
// to an already-rigged character. POST /openapi/v1/animations. One call =
// one clip = one GLB. Use action_id 0 for a generic standing Idle.
async function cmdAnimate(argv){
  const { flags, positional } = parseFlags(argv);
  const rigTaskId = positional[0];
  if (!rigTaskId) throw new Error("Usage: node tools/meshy.js animate <rig-task-id> --name <asset-name> --action-id <id> [--fps 30]");
  if (!flags.name) throw new Error("Missing required --name <asset-name>");
  if (flags["action-id"] === undefined) throw new Error("Missing required --action-id <id> (see docs.meshy.ai/en/api/animation-library; 0 = generic Idle)");
  const actionId = parseInt(flags["action-id"], 10);

  const apiKey = readApiKey();
  const deadline = Date.now() + OVERALL_TIMEOUT_MS;
  const endpointBase = "/openapi/v1/animations";

  const body = { rig_task_id: rigTaskId, action_id: actionId };
  if (flags.fps) body.change_fps = parseInt(flags.fps, 10);

  console.log(`Creating ANIMATE task for rig ${rigTaskId} action_id=${actionId}`);
  const createRes = await apiCall(apiKey, "POST", endpointBase, body);
  const taskId = createRes.result;
  if (!taskId) throw new Error(`Unexpected create response, no "result" task id: ${JSON.stringify(createRes)}`);
  console.log(`Animate task id: ${taskId}  (resume anytime with: node tools/meshy.js status ${taskId} --kind animate)`);

  const task = await pollTask(apiKey, endpointBase, taskId, "animate", deadline);
  console.log(`Animate SUCCEEDED${fmtCredits(task)}`);
  console.log(`Full result: ${JSON.stringify(task.result, null, 2)}`);

  const result = task.result || {};
  const glbUrl = result.animation_glb_url;
  if (!glbUrl) throw new Error(`Animate task ${taskId} succeeded but no animation_glb_url in result: ${JSON.stringify(result)}`);
  const destPath = await downloadUrlAsGlb(glbUrl, flags.name);
  const size = fs.statSync(destPath).size;
  console.log(`\nDownloaded GLB: ${destPath} (${size} bytes)`);
  console.log(`Done.`);
}

async function cmdStatus(argv){
  const { flags, positional } = parseFlags(argv);
  const id = positional[0];
  if (!id) throw new Error("Usage: node tools/meshy.js status <task-id> [--kind text|image|remesh|rig|animate]");
  const endpointBase =
    flags.kind === "image" ? "/openapi/v1/image-to-3d" :
    flags.kind === "remesh" ? "/openapi/v1/remesh" :
    flags.kind === "rig" ? "/openapi/v1/rigging" :
    flags.kind === "animate" ? "/openapi/v1/animations" :
    "/openapi/v2/text-to-3d";

  const apiKey = readApiKey();
  const task = await apiCall(apiKey, "GET", `${endpointBase}/${id}`, null);
  console.log(JSON.stringify(task, null, 2));
}

async function cmdList(argv){
  const { flags } = parseFlags(argv);
  const kind = flags.kind === "image" ? "image" : "text";
  const endpointBase = kind === "image" ? "/openapi/v1/image-to-3d" : "/openapi/v2/text-to-3d";

  const apiKey = readApiKey();
  const tasks = await apiCall(apiKey, "GET", `${endpointBase}?page_num=1&page_size=20&sort_by=-created_at`, null);
  const list = Array.isArray(tasks) ? tasks : (tasks && tasks.result) || [];
  if (!list.length){
    console.log("No tasks found.");
    return;
  }
  for (const t of list){
    console.log(`${t.id}  ${t.status}  progress=${t.progress}%  prompt=${t.prompt ? JSON.stringify(t.prompt) : "(image)"}`);
  }
}

async function cmdBalance(){
  const apiKey = readApiKey();
  const res = await apiCall(apiKey, "GET", "/openapi/v1/balance", null);
  console.log(JSON.stringify(res, null, 2));
}

function printUsage(){
  console.log(`meshy.js — Meshy.ai asset-generation CLI

Usage:
  node tools/meshy.js text "<prompt>" --name <asset-name> [--polycount 3000] [--no-refine] [--no-remesh] [--pose-mode a-pose|t-pose]
  node tools/meshy.js image <path-or-url> --name <asset-name> [--polycount 3000] [--no-texture] [--no-remesh]
  node tools/meshy.js remesh <task-id> --name <asset-name> [--polycount 3000] [--topology triangle]
  node tools/meshy.js rig <task-id-or-model-url> --name <asset-name> [--height 1.7] [--texture-url <url>]
  node tools/meshy.js animate <rig-task-id> --name <asset-name> --action-id <id> [--fps 30]
  node tools/meshy.js status <task-id> [--kind text|image|remesh|rig|animate]
  node tools/meshy.js list [--kind text|image]
  node tools/meshy.js balance

Notes:
  - rig is HUMANOID-ONLY per Meshy docs; do not use on quadrupeds or the snake.
  - rig bundles free walk+run GLBs (assets/<name>-walk.glb, <name>-run.glb).
  - animate applies ONE clip per call; action_id 0 = generic Idle.
`);
}

async function main(){
  const [, , cmd, ...rest] = process.argv;
  try {
    switch (cmd){
      case "text": await cmdText(rest); break;
      case "image": await cmdImage(rest); break;
      case "remesh": await cmdRemesh(rest); break;
      case "rig": await cmdRig(rest); break;
      case "animate": await cmdAnimate(rest); break;
      case "status": await cmdStatus(rest); break;
      case "list": await cmdList(rest); break;
      case "balance": await cmdBalance(); break;
      default: printUsage(); process.exit(cmd ? 1 : 0);
    }
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }
}

main();
