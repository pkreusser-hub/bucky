// tools/robogoat/lib.mjs — shared plumbing for the RoboGoat newsletter kit.
//
// READ-ONLY against the league: every Firestore call here is a document GET or a collection
// LIST. Nothing in this kit writes league state. (The one outbound write anywhere in the kit is
// announce.mjs's push, which is dry-run unless --send is passed.)
"use strict";

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

// LG.PASS + roomId(): lg-core.js — roomId(LG.PASS) IS the league's Firestore collection name.
export const LG_PASS = "amenfarms";
export function roomId(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return "fam" + Math.abs(h).toString(36);
}
export const FAM_KEY = roomId(LG_PASS);
export const COLL = "gffl_" + FAM_KEY;
// The public web API key already shipped in the client bundle (lg-core.js); Firestore rules are
// public-read, the same posture as every read the app itself performs from a browser.
const FS_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const FS_BASE = "https://firestore.googleapis.com/v1/projects/amen-farms-app/databases/(default)/documents";

export function unmarshal(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(unmarshal);
  if ("mapValue" in v) { const o = {}; for (const [k, x] of Object.entries(v.mapValue.fields || {})) o[k] = unmarshal(x); return o; }
  return v;
}
function docObj(d) {
  const o = {};
  for (const [k, x] of Object.entries(d.fields || {})) o[k] = unmarshal(x);
  o._id = d.name.split("/").pop();
  o._updateTime = d.updateTime || null; // Firestore metadata: when this document was last written
  return o;
}
/** One document by id, or null when it does not exist. */
export async function fsGet(id) {
  const r = await fetch(`${FS_BASE}/${COLL}/${encodeURIComponent(id)}?key=${FS_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore GET ${id}: HTTP ${r.status}`);
  return docObj(await r.json());
}
/** Every document id in the collection with its `kind` (a masked LIST — a read). */
export async function fsIndex() {
  const out = [];
  let tok = "";
  do {
    const u = `${FS_BASE}/${COLL}?pageSize=300&mask.fieldPaths=kind&key=${FS_KEY}` + (tok ? `&pageToken=${encodeURIComponent(tok)}` : "");
    const r = await fetch(u);
    if (!r.ok) throw new Error(`Firestore LIST: HTTP ${r.status}`);
    const j = await r.json();
    for (const d of j.documents || []) out.push({ id: d.name.split("/").pop(), kind: d.fields && d.fields.kind ? d.fields.kind.stringValue : "" });
    tok = j.nextPageToken;
  } while (tok);
  return out;
}

/** Every document of one `kind` (a runQuery — a read, despite the POST). */
export async function fsKind(kind) {
  const r = await fetch(`${FS_BASE}:runQuery?key=${FS_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: COLL }],
      where: { fieldFilter: { field: { fieldPath: "kind" }, op: "EQUAL", value: { stringValue: kind } } } } }),
  });
  if (!r.ok) throw new Error(`Firestore query kind=${kind}: HTTP ${r.status}`);
  return (await r.json()).filter((x) => x.document).map((x) => docObj(x.document));
}

/** "Perry  Kreusser" -> "Perry", "joe  adams" -> "Joe". The column names owners by first name. */
export function firstName(owner) {
  const f = String(owner || "").trim().split(/\s+/)[0] || "";
  return f ? f[0].toUpperCase() + f.slice(1) : "";
}
// Short names for bar-chart labels. Owners can rename teams in the app, so a short name is used
// only while the team's current name still contains it; otherwise the full name is shown.
const SHORT = { 1: "Kreussers", 2: "Skywalkers", 3: "Cowboys", 4: "Jaguarrams", 5: "Laws Rule", 9: "Nerfherders", 11: "Kruz Control", 12: "GOAT Kids" };
export function shortName(id, name) {
  const s = SHORT[id];
  return s && String(name).includes(s) ? s : String(name);
}
export const r1 = (x) => (Math.round(Number(x) * 10) / 10).toFixed(1);
export const r2 = (x) => Math.round(Number(x) * 100) / 100;

/** Headless Chrome for the share image and the suite: puppeteer-core on the family PC,
 *  Playwright in the cloud container. ROBOGOAT_CHROME_ARGS adds launch flags (space-separated). */
export async function launchBrowser() {
  const extra = (process.env.ROBOGOAT_CHROME_ARGS || "").split(/\s+/).filter(Boolean);
  const exe = [process.env.BUCKY_CHROME, "/opt/pw-browsers/chromium"].find((c) => c && existsSync(c));
  const args = ["--no-sandbox", ...extra];
  try {
    const pp = require("puppeteer-core");
    const b = await pp.launch({ headless: true, args, ...(exe ? { executablePath: exe } : { channel: "chrome" }) });
    return { kind: "puppeteer", browser: b };
  } catch (e) {
    let pw = null;
    try { pw = require("playwright").chromium; } catch (e2) {
      try { pw = require(resolve(execSync("npm root -g").toString().trim(), "playwright")).chromium; } catch (e3) {}
    }
    if (!pw) throw new Error("need puppeteer-core or playwright: " + (e && e.message));
    return { kind: "playwright", browser: await pw.launch({ headless: true, args }) };
  }
}
export async function newPage(h, viewport) {
  if (h.kind === "puppeteer") { const p = await h.browser.newPage(); await p.setViewport(viewport); return p; }
  return h.browser.newPage({ viewport });
}
