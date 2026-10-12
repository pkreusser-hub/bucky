#!/usr/bin/env node
"use strict";
/**
 * Farm Kart cloud track sync — merge, never replace (2026-10-12).
 *
 * The bug: the game's and the editor's cloud pull REPLACED localStorage fk_tracks_v1 with the cloud
 * map (a track saved offline vanished), and the editor's save wrote its WHOLE local map over the
 * cloud doc (a device that hadn't pulled deleted every track saved elsewhere since).
 *
 *   A. pure FK_TRACK.mergeTrackMaps / cloudSyncTracks rules in node (the shipped module, loaded as-is)
 *   B. end to end in Chrome, each browser CONTEXT a separate family device, over a FAKE Firestore:
 *      the firebase-app / firebase-firestore imports are served by this suite. The fake keeps the
 *      doc in this process and refuses what the real service refuses for this code path: a
 *      transaction whose read went stale is rejected (the SDK retries it), a doc over 1 MiB is
 *      rejected, and an "offline" device's requests fail at the network.
 *        B1  a track saved in the editor OFFLINE survives the game's next pull (read-only — the
 *            game never writes the doc) and is pushed by the next editor boot
 *        B2  a stale device saving does not delete a track another device saved meanwhile
 *        B3  two devices saving at the same moment both land (transaction retry)
 *        B4  the game still adopts a changed active track with ONE reload (old behaviour kept)
 * Production Firestore is never contacted: googleapis/firestore/firebase stay blocked, and the
 * gstatic SDK URLs are answered from here.
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require("puppeteer-core");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8966;
const BASE = `http://127.0.0.1:${PORT}`;
const FAM = "famtestsync";
const DOC = `settings_${FAM}/fkTracks`;
let pass = 0, fail = 0;
const check = (c, m, d) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m + (d !== undefined ? "  -> " + JSON.stringify(d).slice(0, 300) : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- fake Firestore (server side) ----------------
const store = new Map();   // path -> { data, version }
let commits = 0, conflicts = 0;
function fsGet(p) { const d = store.get(p); return d ? { exists: true, data: d.data, version: d.version } : { exists: false, version: 0 }; }
function fsCommit({ writes, reads }) {
  for (const p in reads || {}) { if (fsGet(p).version !== reads[p]) { conflicts++; return { status: 409, body: { error: "ABORTED: transaction read went stale" } }; } }
  for (const w of writes || []) {
    const size = Buffer.byteLength(JSON.stringify(w.data || {}));
    if (size > 1048576) return { status: 400, body: { error: "INVALID_ARGUMENT: document exceeds 1 MiB" } };
  }
  for (const w of writes || []) {
    const cur = store.get(w.p);
    if (w.del) { store.delete(w.p); continue; }
    const data = w.merge && cur ? Object.assign({}, cur.data, w.data) : w.data;
    store.set(w.p, { data: JSON.parse(JSON.stringify(data)), version: (cur ? cur.version : 0) + 1 });
  }
  commits++;
  return { status: 200, body: { ok: true } };
}
const FAKE_APP = "export function initializeApp(){ return {}; } export function getApps(){ return []; }";
const FAKE_FS = `
const B = location.origin + '/__fs/';
async function call(op, body){
  const r = await fetch(B + op, { method:'POST', body: JSON.stringify(body) });
  if (r.status === 409){ const e = new Error('aborted'); e.code = 'aborted'; throw e; }
  if (!r.ok) throw new Error('firestore ' + r.status + ' ' + (await r.text()));
  return r.json();
}
export function getFirestore(){ return {}; }
export function doc(db, ...parts){ return { path: parts.join('/') }; }
export function collection(db, ...parts){ return { path: parts.join('/') }; }
function snap(res, ref){ return { exists: () => !!res.exists, data: () => (res.data ? JSON.parse(JSON.stringify(res.data)) : undefined), id: ref.path.split('/').pop() }; }
export async function getDoc(ref){ return snap(await call('get', { p: ref.path }), ref); }
export async function setDoc(ref, data, opts){ await call('commit', { writes: [{ p: ref.path, data, merge: !!(opts && opts.merge) }], reads: {} }); }
export async function updateDoc(ref, data){ await call('commit', { writes: [{ p: ref.path, data, merge: true }], reads: {} }); }
export async function deleteDoc(ref){ await call('commit', { writes: [{ p: ref.path, del: true }], reads: {} }); }
export function onSnapshot(){ return () => {}; }
export function serverTimestamp(){ return Date.now(); }
export async function runTransaction(db, fn){
  for (let i = 0; i < 5; i++){
    const reads = {}, writes = [];
    const tx = {
      get: async (ref) => { const r = await call('get', { p: ref.path }); reads[ref.path] = r.version; return snap(r, ref); },
      set: (ref, data) => { writes.push({ p: ref.path, data }); return tx; },
    };
    const out = await fn(tx);
    try { await call('commit', { writes, reads }); return out; }
    catch (e) { if (e.code !== 'aborted') throw e; }
  }
  throw new Error('transaction failed after 5 attempts');
}`;

// ---------------- helpers ----------------
function isOpen(port) {
  return new Promise((res) => { const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); res(true); }); s.once("error", () => res(false)); s.setTimeout(800, () => { s.destroy(); res(false); }); });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) { try { await new Promise((r, j) => http.get({ host: "127.0.0.1", port, path: "/", timeout: 1000 }, (x) => { x.resume(); r(); }).on("error", j)); return; } catch (_) {} }
    await sleep(200);
  }
  throw new Error("server timeout");
}
const cloudMap = () => { const d = store.get(DOC); return d ? JSON.parse(d.data.tracks || "{}") : {}; };

// A "device": one incognito browser context (own localStorage). net.offline makes every fake
// Firestore call fail at the network; net.holdCommit parks its NEXT commit until released.
async function device(browser) {
  const ctx = await browser.createBrowserContext();
  const state = { offline: false, fsDown: false, holdCommit: null, errors: [] };
  async function open(url) {
    const page = await ctx.newPage();
    await page.setViewport({ width: 1100, height: 760 });
    await page.setRequestInterception(true);
    page.on("pageerror", (e) => state.errors.push(String(e)));
    page.on("request", async (r) => {
      const u = r.url();
      if (/gstatic\.com\/firebasejs\/.*firebase-app\.js/.test(u)) return state.offline ? r.abort() : r.respond({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: FAKE_APP });
      if (/gstatic\.com\/firebasejs\/.*firebase-firestore\.js/.test(u)) return state.offline ? r.abort() : r.respond({ status: 200, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" }, body: FAKE_FS });
      if (u.startsWith(BASE + "/__fs/")) {
        if (state.offline || state.fsDown) return r.abort("internetdisconnected");
        const op = u.slice((BASE + "/__fs/").length);
        const body = JSON.parse(r.postData() || "{}");
        if (op === "get") return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(fsGet(body.p)) });
        if (op === "commit") {
          if (state.holdCommit) { const gate = state.holdCommit; state.holdCommit = null; await gate; }
          const res = fsCommit(body);
          return r.respond({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
        }
        return r.respond({ status: 404, body: "no op" });
      }
      if (/playroom|googleapis|firestore|firebase|gstatic/i.test(u)) return r.abort();
      r.continue();
    });
    await page.goto(BASE + url, { waitUntil: "load", timeout: 60000 });
    return page;
  }
  return { ctx, state, open };
}
const editorReady = (page) => page.waitForFunction(() => !!(window.__EDITOR__ && window.__EDITOR__.track), { timeout: 30000 });
// rename the open track + save it as a NEW id (fresh editor page: currentId is null → slug(name))
async function saveAs(page, name) {
  return page.evaluate((name) => {
    const t = JSON.parse(JSON.stringify(window.__EDITOR__.track)); t.name = name;
    window.__EDITOR__.loadTrack(t);
    return window.__EDITOR__.doSave();
  }, name);
}
// wait until this device has nothing left to push (its save reached the cloud) — never a fixed
// sleep: the editor rebuilds the whole scene on loadTrack, which can hold the push for seconds
const settled = (page) => page.waitForFunction(() => Object.keys((JSON.parse(localStorage.getItem("fk_tracks_sync_v1") || "{}").pending) || {}).length === 0, { timeout: 15000 }).catch(() => {});
const localIds = (page) => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("fk_tracks_v1") || "{}")).sort());
const pending = (page) => page.evaluate(() => Object.keys((JSON.parse(localStorage.getItem("fk_tracks_sync_v1") || "{}").pending) || {}).sort());

(async () => {
  // ======================= A. pure rules (the shipped module in node) =======================
  console.log("A. merge rules");
  {
    const mem = {};
    global.window = {};
    global.localStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    require(path.join(ROOT, "assets", "farmkart-track.js"));
    const T = global.window.FK_TRACK;
    const tr = (n) => ({ name: n, points: [] });
    check(typeof T.mergeTrackMaps === "function" && typeof T.cloudSyncTracks === "function", "FK_TRACK exposes the shared merge + sync");
    if (typeof T.mergeTrackMaps === "function") {
    const m = T.mergeTrackMaps;
    let r = m({ a: tr("a-old") }, { pending: {} }, { a: tr("a-cloud"), b: tr("b") }, { a: 5 });
    check(r.map.a.name === "a-cloud" && r.map.b && !Object.keys(r.pending).length, "nothing pending: the cloud copy is adopted as-is", r);
    r = m({ x: tr("x") }, { pending: {} }, { a: tr("a") }, {});
    check(!r.map.x, "a local-only id that is NOT pending is dropped (a renamed/removed cloud track stays gone)", r.map);
    r = m({ x: tr("x") }, { pending: { x: 500 } }, { a: tr("a") }, { a: 100 });
    check(r.map.x && r.map.a && r.pending.x === 500, "a pending local save the cloud lacks is kept and queued for push", r);
    r = m({ a: tr("a-mine") }, { pending: { a: 100 } }, { a: tr("a-theirs") }, { a: 200 });
    check(r.map.a.name === "a-theirs" && !r.pending.a, "a NEWER cloud save of the same id beats an older pending one", r);
    r = m({ a: tr("a-mine") }, { pending: { a: 300 } }, { a: tr("a-theirs") }, { a: 200 });
    check(r.map.a.name === "a-mine" && r.pending.a === 300, "a newer pending save beats the cloud's older copy", r);
    // first run of the sync code on a device that already has saved tracks (no fk_tracks_sync_v1)
    mem.fk_tracks_v1 = JSON.stringify({ a: tr("a-local-legacy"), legacy: tr("legacy-only") });
    const meta = T.loadSyncMeta();
    r = m(T.loadTrackMap(), meta, { a: tr("a-cloud") }, {});
    check(r.map.legacy && r.map.a.name === "a-cloud", "first run: a legacy local-only track is kept, but never overrides a cloud copy (old doc, no stamps)", r.map);

    // cloudSyncTracks over an in-node fake fs: a save landing WHILE the pull is in flight survives
    for (const k in mem) delete mem[k];
    T.saveSyncMeta({ stamps: {}, pending: {} });
    mem.fk_tracks_v1 = JSON.stringify({});
    let release; const gate = new Promise((res) => (release = res));
    const fakeFs = { getDoc: async () => { await gate; return { exists: () => true, data: () => ({ tracks: JSON.stringify({ a: tr("a") }), stamps: "{}" }) }; } };
    const p = T.cloudSyncTracks(fakeFs, {}, {}, { timeoutMs: 2000 });
    mem.fk_tracks_v1 = JSON.stringify({ mid: tr("saved-mid-pull") }); T.noteTrackSaved("mid", 999);
    release();
    const res = await p;
    const after = JSON.parse(mem.fk_tracks_v1);
    check(res.ok && after.mid && after.a, "a save made while a pull is in flight survives the pull's adopt", Object.keys(after));
    const off = await T.cloudSyncTracks({ getDoc: () => Promise.reject(new Error("offline")) }, {}, {}, {});
    check(!off.ok && JSON.parse(mem.fk_tracks_v1).mid, "offline: reports !ok and leaves local state untouched", off);
    }
    delete global.window; delete global.localStorage;
  }

  // ======================= B. end to end =======================
  let server = null;
  if (!(await isOpen(PORT))) server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1", "-s"], { cwd: ROOT, stdio: "ignore", shell: true, detached: true });
  await waitServer(PORT, 20000);
  const browser = await puppeteer.launch({ channel: "chrome", headless: "new", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"] });
  const ED = `/farmkart-editor.html?fam=${FAM}`;
  const GAME = `/farmkart.html?fam=${FAM}&notitle=1`;
  try {
    // ---- B1: offline save survives the next pull, and gets pushed by it ----
    console.log("B1. a track saved offline");
    {
      store.clear();
      const X = await device(browser);
      const e0 = await X.open(ED); await editorReady(e0); await sleep(1500);   // online boot: seeds sync meta
      const seed = await saveAs(e0, "Home Loop"); await settled(e0);
      check(Object.keys(cloudMap()).includes(seed), "an online save reaches the cloud", Object.keys(cloudMap()));
      await e0.close();
      X.state.offline = true;
      const e1 = await X.open(ED); await editorReady(e1); await sleep(800);
      const off = await saveAs(e1, "Offline Loop"); await sleep(1500);
      check((await localIds(e1)).includes(off) && (await pending(e1)).includes(off), "offline save is on the device and marked pending", { local: await localIds(e1), pending: await pending(e1) });
      check(!Object.keys(cloudMap()).includes(off), "…and is not in the cloud yet");
      await e1.close();
      // another device saves meanwhile, so the cloud really differs from this device's map
      const Y = await device(browser);
      const y0 = await Y.open(ED); await editorReady(y0); await sleep(1500);
      const other = await saveAs(y0, "Other Device Loop"); await settled(y0);
      await y0.close();
      X.state.offline = false;
      const commitsBeforeGame = commits;
      const g = await X.open(GAME);
      await g.waitForFunction((id) => Object.keys(JSON.parse(localStorage.getItem("fk_tracks_v1") || "{}")).includes(id), { timeout: 15000 }, other).catch(() => {});
      await sleep(1000);
      const ids = await localIds(g);
      check(ids.includes(off), "back online, the game's pull KEEPS the offline track (it used to replace the map)", ids);
      check(ids.includes(other), "…and adopts the other device's new track", ids);
      // the GAME is read-only against the tracks doc (it never wrote before, and a headless suite that
      // seeds fk_tracks_v1 unblocked must not publish its test track): the save stays pending…
      check(commits === commitsBeforeGame && !Object.keys(cloudMap()).includes(off) && (await pending(g)).includes(off),
        "…without writing to the cloud: the game never pushes; the save stays pending", { commits: commits - commitsBeforeGame, pending: await pending(g) });
      await g.close();
      // …and the next editor boot pushes it
      const e2 = await X.open(ED); await editorReady(e2);
      await e2.waitForFunction(() => Object.keys((JSON.parse(localStorage.getItem("fk_tracks_sync_v1") || "{}").pending) || {}).length === 0, { timeout: 10000 }).catch(() => {});
      check(Object.keys(cloudMap()).includes(off) && (await pending(e2)).length === 0, "the next editor boot pushes the offline track (nothing left pending)", { cloud: Object.keys(cloudMap()), pending: await pending(e2) });
      check(Object.keys(cloudMap()).includes(other), "…without deleting the other device's track", Object.keys(cloudMap()));
      check(X.state.errors.length + Y.state.errors.length === 0, "B1: 0 pageerrors", X.state.errors.concat(Y.state.errors));
      await X.ctx.close(); await Y.ctx.close();
    }

    // ---- B2: a stale device saving doesn't delete what another device saved meanwhile ----
    console.log("B2. a stale device saves");
    {
      store.clear();
      const P = await device(browser), Q = await device(browser);
      const p0 = await P.open(ED); await editorReady(p0); await sleep(1200);
      const a = await saveAs(p0, "Shared Loop"); await settled(p0);
      const q0 = await Q.open(ED); await editorReady(q0); await sleep(1500);   // Q pulls {a}
      await q0.close();
      const p1 = await P.open(ED); await editorReady(p1); await sleep(1200);
      const b = await saveAs(p1, "Saved On P"); await settled(p1);           // cloud {a,b}; Q doesn't know
      // Q boots with a flaky connection: Firebase loads, but its pull of the tracks doc fails, so Q
      // is left holding a STALE map {a}. Then the connection returns and Q saves.
      Q.state.fsDown = true;
      const q1 = await Q.open(ED); await editorReady(q1); await sleep(1500);
      Q.state.fsDown = false;
      const c = await saveAs(q1, "Saved On Q"); await settled(q1);
      const ids = Object.keys(cloudMap()).sort();
      check(ids.includes(a) && ids.includes(c), "the stale device's save lands", ids);
      check(ids.includes(b), "…and does NOT delete the track the other device saved meanwhile (whole-map overwrite)", ids);
      check((await localIds(q1)).includes(b), "…and the stale device picks that track up in the same sync", await localIds(q1));
      check(P.state.errors.length + Q.state.errors.length === 0, "B2: 0 pageerrors", P.state.errors.concat(Q.state.errors));
      await P.ctx.close(); await Q.ctx.close();
    }

    // ---- B2b: an editor that booted with NO connection (Firebase never loaded) ----
    console.log("B2b. editor booted fully offline");
    {
      store.clear();
      const Z = await device(browser);
      Z.state.offline = true;
      const z0 = await Z.open(ED); await editorReady(z0); await sleep(800);
      Z.state.offline = false;   // the connection returns, but this page's Firebase import already failed
      const id = await saveAs(z0, "Booted Offline"); await sleep(1500);
      check(!Object.keys(cloudMap()).includes(id) && (await pending(z0)).includes(id), "the save stays on the device, pending (the browser won't retry a failed module import)", { cloud: Object.keys(cloudMap()), pending: await pending(z0) });
      await z0.close();
      const z1 = await Z.open(ED); await editorReady(z1);
      await z1.waitForFunction(() => Object.keys((JSON.parse(localStorage.getItem("fk_tracks_sync_v1") || "{}").pending) || {}).length === 0, { timeout: 10000 }).catch(() => {});
      check(Object.keys(cloudMap()).includes(id), "the next online editor boot pushes it", Object.keys(cloudMap()));
      check(Z.state.errors.length === 0, "B2b: 0 pageerrors", Z.state.errors);
      await Z.ctx.close();
    }

    // ---- B3: two devices save at the same moment ----
    console.log("B3. simultaneous saves");
    {
      store.clear();
      const P = await device(browser), Q = await device(browser);
      const p0 = await P.open(ED), q0 = await Q.open(ED);
      await editorReady(p0); await editorReady(q0); await sleep(1500);
      let releaseQ; Q.state.holdCommit = new Promise((r) => (releaseQ = r));   // Q reads, then waits to commit
      const c0 = conflicts;
      const qId = await saveAs(q0, "Q At Once"); await sleep(700);             // Q's transaction has read the doc
      const pId = await saveAs(p0, "P At Once"); await sleep(1200);            // P commits first
      releaseQ(); await sleep(2000);                                           // Q's stale commit → retry
      const ids = Object.keys(cloudMap());
      check(conflicts > c0, "the second commit was refused as stale (the fake enforces it, like Firestore)", { conflicts: conflicts - c0 });
      check(ids.includes(pId) && ids.includes(qId), "…and after the retry BOTH saves are in the cloud", ids);
      await P.ctx.close(); await Q.ctx.close();
    }

    // ---- B4: the game still reloads ONCE to adopt a changed active track ----
    console.log("B4. game adopts a changed active track");
    {
      store.clear();
      const P = await device(browser), R = await device(browser);
      const p0 = await P.open(ED); await editorReady(p0); await sleep(1200);
      const id = await saveAs(p0, "Adopt Me"); await settled(p0);
      const g = await R.open(`/farmkart.html?fam=${FAM}&notitle=1&track=${id}`);   // fresh device: no local copy
      // ?track= boots straight into a race, which (correctly) suppresses the reload. Go to menu first.
      await g.evaluate(() => window.__KART__.toMenu());
      await g.evaluate(() => window.__fkTrackSync.fkReconcileTracksCloud());
      await sleep(2500);
      const st = await g.evaluate(() => ({ adopted: sessionStorage.getItem("fk_tracks_adopted"), has: !!JSON.parse(localStorage.getItem("fk_tracks_v1") || "{}")[new URLSearchParams(location.search).get("track")] }));
      check(st.has, "the fresh device now holds the active track's saved copy", st);
      check(R.state.errors.length + P.state.errors.length === 0, "B4: 0 pageerrors", R.state.errors.concat(P.state.errors));
      await P.ctx.close(); await R.ctx.close();
    }
  } finally {
    await browser.close();
    if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (e) {} }
  }
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
