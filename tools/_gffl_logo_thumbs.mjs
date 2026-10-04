#!/usr/bin/env node
// GFFL logo split (2026-10-04) — one-off production migration.
//
//   node tools/_gffl_logo_thumbs.mjs            # DRY RUN: reads, prints the plan, writes NOTHING
//   node tools/_gffl_logo_thumbs.mjs --write    # backup -> masked PATCH -> canonical re-read
//
// WHY: every team doc carried its full logo (`logoData`, a 512 px JPEG / 288 px PNG as base64,
// 13-90 KB) inline, so every team-list read — boot, the 60 s auto-check, the 15 s cache refresh
// — downloaded all eight (490 KB) and every <img> inlined the whole string. The app now reads a
// ~96 px `logoThumb` from the team doc and the full picture from its own doc `teamlogo_<id>`
// (lg-core.js: LG.loadTeamLogo / LG.saveTeamLogo). The app falls back to the inline `logoData`
// until this has run, so nothing breaks in the meantime — but nothing gets lighter either.
//
// WHAT IT DOES, per team that has an inline logoData and no logoThumb yet (so it is safe to
// re-run; a finished team is skipped):
//   1. teamlogo_<id>  <- PATCH {kind, teamId, logoData, t}      (the full picture, copied VERBATIM)
//      read back; the decoded logoData must equal the source byte for byte, or it stops.
//   2. team_<id>      <- PATCH {logoThumb, logoCut} and DROP logoData
//      mask: updateMask.fieldPaths = logoThumb, logoCut, logoData. `logoData` is in the mask but
//      NOT in the body, which is how Firestore REST deletes a field; every other field on the
//      team doc (name, colors, faab, trophies, claimedBy, a field added next year...) is outside
//      the mask and is not touched. A precondition (currentDocument.updateTime) makes the write
//      refuse if the doc moved since it was read, so a FAAB deduction landing mid-run is never
//      overwritten; one re-read + retry is allowed, then it stops.
//      read back; the decoded doc must equal (the backup, minus logoData, plus logoThumb and
//      logoCut) with keys sorted — CLAUDE.md bite #9: raw JSON.stringify of a read is key-order
//      noise.
// ORDER matters: the full picture is written and verified in its new home BEFORE it is removed
// from the old one, so a failure at any point leaves every logo recoverable.
//
// BACKUP: before the first write, every team doc it will touch is saved as raw Firestore JSON to
// ./gffl_backup_logos_<timestamp>/team_<id>.json. To undo a team: PATCH its backup `logoData`
// back (updateMask.fieldPaths=logoData) and the app is exactly as before.
//
// THUMBS are made in headless Chromium (canvas -> webp), because that is the same encoder the
// uploader's browser uses and sharp is not a dependency. It needs puppeteer-core (the suite's
// dependency; set NODE_PATH to wherever it is installed) and a Chrome: BUCKY_CHROME, or
// /opt/pw-browsers/chromium, or a system Chrome. THUMB_DIM / THUMB_CAP below must match
// lg-ui.js's — the suite (section BTP) checks that they do.
//
//   --out <dir>   where the backup and the plan file go (default ./gffl_backup_logos_<ts>)
//   --only 1,3    restrict to these team ids
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const WRITE = process.argv.includes("--write");
const argVal = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const ONLY = argVal("--only") ? new Set(argVal("--only").split(",").map(Number)) : null;
const KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU"; // the public web key lg-core.js already ships
const ROOT = "projects/amen-farms-app/databases/(default)/documents";
const COLL = "gffl_fam2jan2g";
const DOCS = `https://firestore.googleapis.com/v1/${ROOT}/${COLL}`;
const THUMB_DIM = 96, THUMB_CAP = 14000;

// ---- Firestore value codec (whole numbers as integerValue — CLAUDE.md bite #9) ----
function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}
function dec(v) {
  if (!v) return null;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, dec(x)]));
  return null;
}
const decDoc = (d) => (d && d.fields ? Object.fromEntries(Object.entries(d.fields).map(([k, x]) => [k, dec(x)])) : null);
// Key-sorted, so two reads of the same document compare equal whatever order Firestore listed them.
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys)
  : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x;
const canon = (x) => JSON.stringify(sortKeys(x));
const fsPath = (k) => "`" + String(k).replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";

async function getDoc(id) {
  const r = await fetch(`${DOCS}/${encodeURIComponent(id)}?key=${KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("read " + id + ": HTTP " + r.status);
  return r.json();
}
async function listTeams() {
  const r = await fetch(`https://firestore.googleapis.com/v1/${ROOT}:runQuery?key=${KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: COLL }],
      where: { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: "team" } } },
    } }),
  });
  if (!r.ok) throw new Error("team query: HTTP " + r.status);
  return (await r.json()).filter((row) => row.document).map((row) => row.document);
}
// The PATCH exactly as it goes on the wire: the URL (mask + optional precondition) and the body.
function patchRequest(id, fields, maskFields, precondition) {
  const mask = maskFields.map((f) => "updateMask.fieldPaths=" + encodeURIComponent(fsPath(f))).join("&");
  const pre = precondition ? "&currentDocument.updateTime=" + encodeURIComponent(precondition) : "";
  return { url: `${DOCS}/${encodeURIComponent(id)}?key=${KEY}&${mask}${pre}`, body: { fields } };
}
async function send(req) {
  return fetch(req.url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
}
// Long base64 strings are elided in what is PRINTED; what is SENT is never elided.
const brief = (x) => JSON.parse(JSON.stringify(x, (k, v) => typeof v === "string" && v.length > 60 ? v.slice(0, 40) + `…(${v.length} chars)` : v));
const kb = (n) => (n / 1024).toFixed(1) + " KB";

// ---- the thumbnail: same algorithm as lg-ui.js makeLogoThumb (webp; jpeg/png if webp is not encoded) ----
async function launchChrome() {
  const require = createRequire(import.meta.url);
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); }
  catch (e) { throw new Error("puppeteer-core not found — set NODE_PATH to a node_modules that has it (the suite's dependency)"); }
  const cands = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"];
  const exe = cands.find((c) => c && fs.existsSync(c));
  const opts = { headless: true, args: ["--no-sandbox", "--disable-features=CanvasNoise"] };
  if (exe) opts.executablePath = exe; else opts.channel = "chrome";
  return puppeteer.launch(opts);
}
async function makeThumb(page, dataUrl) {
  return page.evaluate(async (src, DIM, CAP) => {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
    const hasAlpha = (ctx, w, h) => { const d = ctx.getImageData(0, 0, w, h).data; for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true; return false; };
    let dim = DIM, out = "", alpha = false;
    for (let n = 0; n < 3; n++) {
      let w = img.width, h = img.height;
      if (w >= h) { h = Math.max(1, Math.round(h * dim / w)); w = dim; } else { w = Math.max(1, Math.round(w * dim / h)); h = dim; }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d"); ctx.drawImage(img, 0, 0, w, h);
      alpha = hasAlpha(ctx, w, h);
      out = cv.toDataURL("image/webp", 0.8);
      if (!/^data:image\/webp/.test(out)) out = alpha ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.8);
      if (out.length <= CAP) break;
      dim = Math.round(dim * 0.75);
    }
    return { thumb: out, w: img.width, h: img.height };
  }, dataUrl, THUMB_DIM, THUMB_CAP);
}

(async () => {
  const docs = await listTeams();
  const todo = [];
  for (const d of docs) {
    const f = decDoc(d);
    const id = Number(f.teamId);
    if (ONLY && !ONLY.has(id)) continue;
    const have = typeof f.logoData === "string" && f.logoData.startsWith("data:image/");
    if (!have) { console.log(`team_${id} ${f.name}: no inline logoData (${f.logoThumb ? "already migrated" : f.logo ? "legacy URL logo only" : "no logo"}) — skipped`); continue; }
    if (f.logoThumb) { console.log(`team_${id} ${f.name}: has logoThumb AND inline logoData — partly migrated; will re-run it`); }
    todo.push({ id, name: f.name, raw: d, doc: f });
  }
  if (!todo.length) { console.log("Nothing to do."); return; }

  const browser = await launchChrome();
  const page = await browser.newPage();
  await page.goto("about:blank");
  const plan = [];
  let oldTotal = 0, newTotal = 0;
  for (const t of todo) {
    const { thumb, w, h } = await makeThumb(page, t.doc.logoData);
    const cut = /^data:image\/png/i.test(t.doc.logoData); // the upload path emits PNG only for a real cut-out
    const nextTeam = { ...t.doc }; delete nextTeam.logoData; nextTeam.logoThumb = thumb; nextTeam.logoCut = cut;
    const logoDoc = { kind: "teamlogo", teamId: t.id, logoData: t.doc.logoData, t: Date.now() };
    plan.push({ ...t, thumb, cut, nextTeam, logoDoc, srcW: w, srcH: h });
    oldTotal += t.doc.logoData.length; newTotal += thumb.length;
  }
  await browser.close();

  console.log(`\n${WRITE ? "WRITE" : "DRY RUN"} — ${plan.length} team(s)\n`);
  for (const p of plan) {
    const logoReq = patchRequest(`teamlogo_${p.id}`, { kind: enc("teamlogo"), teamId: enc(p.id), logoData: enc(p.logoDoc.logoData), t: enc(p.logoDoc.t) },
      ["kind", "teamId", "logoData", "t"], null);
    const teamReq = patchRequest(`team_${p.id}`, { logoThumb: enc(p.thumb), logoCut: enc(p.cut) },
      ["logoThumb", "logoCut", "logoData"], p.raw.updateTime);
    console.log(`team_${p.id}  ${p.name}`);
    console.log(`  logo ${p.srcW}x${p.srcH}  ${kb(p.doc.logoData.length)} (${p.doc.logoData.slice(0, 22)})  ->  thumb ${kb(p.thumb.length)} (${p.thumb.slice(0, 22)}), cut-out: ${p.cut}`);
    console.log(`  1) PATCH ${logoReq.url.replace(KEY, "<key>")}`);
    console.log(`     body ${JSON.stringify(brief(logoReq.body))}`);
    console.log(`  2) PATCH ${teamReq.url.replace(KEY, "<key>")}`);
    console.log(`     body ${JSON.stringify(brief(teamReq.body))}   (logoData is in the mask and not in the body: that DELETES it)`);
  }
  console.log(`\nteam-list payload carried by logos: ${kb(oldTotal)} -> ${kb(newTotal)} of thumbs (${(100 * (1 - newTotal / oldTotal)).toFixed(1)}% smaller); the full pictures move to teamlogo_<id>, read only by the locker.`);
  if (!WRITE) { console.log("\nDry run — nothing written. Re-run with --write."); return; }

  const dir = argVal("--out") || "gffl_backup_logos_" + new Date().toISOString().replace(/[:.]/g, "-");
  fs.mkdirSync(dir, { recursive: true });
  for (const p of plan) fs.writeFileSync(path.join(dir, `team_${p.id}.json`), JSON.stringify(await getDoc(`team_${p.id}`), null, 1));
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan.map((p) => ({ id: p.id, name: p.name, oldChars: p.doc.logoData.length, thumbChars: p.thumb.length, cut: p.cut })), null, 1));
  console.log("\nbackups in " + dir + "/  (restore a team: PATCH its backup logoData back with updateMask.fieldPaths=logoData)\n");

  for (const p of plan) {
    // 1. the full picture into its own doc, then prove it arrived intact.
    const logoReq = patchRequest(`teamlogo_${p.id}`, { kind: enc("teamlogo"), teamId: enc(p.id), logoData: enc(p.logoDoc.logoData), t: enc(p.logoDoc.t) },
      ["kind", "teamId", "logoData", "t"], null);
    const r1 = await send(logoReq);
    if (!r1.ok) { console.log(`FAILED teamlogo_${p.id}: HTTP ${r1.status} ${(await r1.text()).slice(0, 300)}\nStopping; nothing was removed from any team doc.`); process.exit(1); }
    const back1 = decDoc(await getDoc(`teamlogo_${p.id}`));
    if (!back1 || back1.logoData !== p.logoDoc.logoData || back1.kind !== "teamlogo" || back1.teamId !== p.id) {
      console.log(`MISMATCH teamlogo_${p.id} — the stored picture is not the source. Stopping; nothing was removed from any team doc.`); process.exit(1);
    }
    // 2. thumb + flag onto the team doc, logoData dropped — against the doc as it stands NOW.
    let done = false;
    for (let attempt = 1; attempt <= 2 && !done; attempt++) {
      const cur = await getDoc(`team_${p.id}`);
      const curDoc = decDoc(cur);
      const expect = { ...curDoc }; delete expect.logoData; expect.logoThumb = p.thumb; expect.logoCut = p.cut;
      const teamReq = patchRequest(`team_${p.id}`, { logoThumb: enc(p.thumb), logoCut: enc(p.cut) }, ["logoThumb", "logoCut", "logoData"], cur.updateTime);
      const r2 = await send(teamReq);
      if (r2.status === 409 || r2.status === 412 || r2.status === 400 && /FAILED_PRECONDITION/.test(await r2.clone().text())) {
        console.log(`team_${p.id} moved while we were working (attempt ${attempt}) — re-reading`);
        continue;
      }
      if (!r2.ok) { console.log(`FAILED team_${p.id}: HTTP ${r2.status} ${(await r2.text()).slice(0, 300)}\nStopping. teamlogo_${p.id} is written; restore team_${p.id} from ${dir}/ if it changed.`); process.exit(1); }
      const back2 = decDoc(await getDoc(`team_${p.id}`));
      // Compare against what the doc held just before the write (not the backup), so a legitimate
      // concurrent edit to some other field between backup and write is not called a mismatch.
      if (canon(back2) !== canon(expect)) {
        console.log(`MISMATCH team_${p.id}\n  expected ${canon(expect).slice(0, 400)}\n  got      ${canon(back2).slice(0, 400)}\nStopping. Restore from ${dir}/.`); process.exit(1);
      }
      console.log(`verified  team_${p.id}  ${p.name}  (${kb(p.doc.logoData.length)} -> ${kb(p.thumb.length)}; full picture in teamlogo_${p.id})`);
      done = true;
    }
    if (!done) { console.log(`team_${p.id} kept moving; stopping. Re-run to continue.`); process.exit(1); }
  }
  console.log("\nDone. Reload the league: the Rosters/League views should be a fraction of their old size and every crest still shows.");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
