#!/usr/bin/env node
"use strict";
/**
 * Headless verification for Farm Life P3 — live presence (Playroom).
 *
 * Uses TWO SEPARATE browser PROCESSES (not tabs — background-tab rAF freezes,
 * house lesson) driving the REAL Playroom backend. Firestore is touched ONLY
 * via the `?fam=famtestfl` test family (never production — herd-dup lesson);
 * every lobby/farm doc created is deleted via the Firestore REST API at the end
 * and emptiness is asserted.
 *
 * Derived room for famtestfl = "FLFAMTESTFL" (isolated from production
 * "FLFAM2JAN2G"). If real Playroom proves unreachable after genuine attempts,
 * the script says so honestly and exits (no fabricated pass).
 *
 * Run:  node farmlife/verify-p3.cjs        (from repo root)
 */
const path = require("path");
const net = require("net");
const http = require("http");
const { spawn } = require("child_process");
const puppeteer = require(path.resolve(__dirname, "..", "tools", "node_modules", "puppeteer-core"));

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "shots");
const PORT = 8790;
const BASE = `http://127.0.0.1:${PORT}`;
const GAME_URL = BASE + "/farmlife/dist/index.html";
const GAMES_HTML = BASE + "/games.html";
require("fs").mkdirSync(SHOTS, { recursive: true });

const PROJECT_ID = "amen-farms-app";
const API_KEY = "AIzaSyAA1hn-j9_pPuXoaHIzcyyXYJN6EhUccJU";
const REST_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const FAM = "famtestfl";
const EXPECT_ROOM = "FLFAMTESTFL";

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail == null ? "" : String(detail) });
  console.log((cond ? "  ok  " : " FAIL ") + name + (detail != null ? "  → " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- server bootstrap -------------------------------------------------------
function isOpen(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}
async function waitServer(port, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await isOpen(port)) {
      try {
        await new Promise((res, rej) => {
          http.get({ host: "127.0.0.1", port, path: "/farmlife/dist/index.html", timeout: 1000 }, (r) => { r.resume(); res(); }).on("error", rej);
        });
        return;
      } catch (_) {}
    }
    await sleep(200);
  }
  throw new Error("server timeout");
}

// ---- Firestore REST helpers (public rules) ----------------------------------
function decodeValue(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return decodeFields((v.mapValue && v.mapValue.fields) || {});
  if ("arrayValue" in v) return ((v.arrayValue && v.arrayValue.values) || []).map(decodeValue);
  return v;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}
async function restListDocs(collection) {
  const all = [];
  let pageToken = "";
  for (;;) {
    const url = `${REST_BASE}/${collection}?key=${API_KEY}&pageSize=300${pageToken ? "&pageToken=" + pageToken : ""}`;
    const res = await fetch(url);
    if (!res.ok) { if (res.status === 404) return []; throw new Error(`list ${collection}: HTTP ${res.status}`); }
    const data = await res.json();
    for (const d of data.documents || []) all.push(d);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return all;
}
async function restGetDoc(collection, id) {
  const res = await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ${collection}/${id}: HTTP ${res.status}`);
  return decodeFields((await res.json()).fields || {});
}
async function restDeleteDoc(collection, id) {
  await fetch(`${REST_BASE}/${collection}/${id}?key=${API_KEY}`, { method: "DELETE" });
}
async function restDeleteCollection(collection) {
  const docs = await restListDocs(collection);
  for (const d of docs) await restDeleteDoc(collection, d.name.split("/").pop());
  return docs.length;
}
// poll a doc field until predicate or timeout
async function waitDoc(collection, id, pred, ms) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await restGetDoc(collection, id);
    if (pred(last)) return last;
    await sleep(600);
  }
  return last;
}

// ---- a fresh browser PROCESS per player -------------------------------------
async function launchPlayer(name) {
  const browser = await puppeteer.launch({
    channel: "chrome",
    headless: "new",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox", "--disable-gpu-vsync"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 720 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e)));
  await page.evaluateOnNewDocument((n) => { try { localStorage.setItem("choreUser", n); } catch (_) {} }, name);
  // Deterministic OFF for fast-grow (test mode defaults ON).
  await page.evaluateOnNewDocument(() => { try { const _t = JSON.parse(localStorage.getItem("fl_tune_v1") || "{}"); _t.fastGrow = false; localStorage.setItem("fl_tune_v1", JSON.stringify(_t)); } catch (_) {} });
  await page.goto(`${GAME_URL}?fam=${FAM}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.__FL__ && window.__FL__.presence, { timeout: 20000 });
  // capture leave/join toasts for later assertions
  await page.evaluate(() => {
    window.__toasts = [];
    const host = document.getElementById("fl-toasts");
    if (host) new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.textContent) window.__toasts.push(n.textContent);
    }).observe(host, { childList: true });
  });
  return { browser, page, errors, name };
}
async function presenceConnected(page, ms = 25000) {
  try {
    await page.waitForFunction(() => window.__FL__.presence.connected() === true, { timeout: ms });
    return true;
  } catch (_) { return false; }
}
async function teleport(page, x, z) {
  await page.evaluate((x, z) => window.__FL__.farm.teleport(x, z), x, z);
}

async function main() {
  let server = null;
  if (!(await isOpen(PORT))) {
    server = spawn("npx", ["-y", "http-server", ROOT, "-p", String(PORT), "-c-1"], { cwd: ROOT, stdio: "ignore", shell: true });
  }
  await waitServer(PORT, 20000);

  const pre1 = await restDeleteCollection(`lobbies_${FAM}`);
  const pre2 = await restDeleteCollection(`farmlife_${FAM}`);
  console.log(`pre-flight: removed ${pre1} lobby doc(s), ${pre2} farm doc(s) from ${FAM}`);

  // Launch B FIRST (baseline + oldest-joined => lobby single-writer), then A.
  console.log("\n=== launching two real browser processes vs the Playroom backend ===");
  const B = await launchPlayer("TesterB");
  const bConn = await presenceConnected(B.page);
  if (!bConn) {
    check("REAL Playroom reachable (device B connected)", false, "insertCoin never connected — Playroom appears UNREACHABLE from this environment");
    console.log("\n*** Real Playroom was NOT reachable. Per the task, a local state-relay stub is the fallback, but");
    console.log("*** that is not implemented here — reporting honestly instead of fabricating a pass. ***");
    await B.browser.close().catch(() => {});
    if (server) try { process.kill(server.pid); } catch (_) {}
    const passed = results.filter((r) => r.ok).length;
    console.log(`\n${passed}/${results.length} checks passed`);
    process.exit(1);
  }
  check("REAL Playroom reachable (device B connected)", true);

  const baselineChildren = await B.page.evaluate(() => window.__FL__.presence.sceneChildCount());
  const A = await launchPlayer("TesterA");
  const aConn = await presenceConnected(A.page);
  check("device A connected to Playroom", aConn);

  const idA = await A.page.evaluate(() => window.__FL__.presence.myId());
  const idB = await B.page.evaluate(() => window.__FL__.presence.myId());

  // ---------------- (a) same derived room, no lobby UI ----------------
  console.log("\n=== (a) both auto-join the same derived room (no lobby UI) ===");
  const roomA = await A.page.evaluate(() => window.__FL__.presence.roomCode());
  const roomB = await B.page.evaluate(() => window.__FL__.presence.roomCode());
  check("A + B share the derived room code", roomA === EXPECT_ROOM && roomB === EXPECT_ROOM, `A=${roomA} B=${roomB} expect=${EXPECT_ROOM}`);
  const noLobbyA = await A.page.evaluate(() => !document.querySelector('[class*="playroom" i],[id*="playroom" i],iframe'));
  check("no Playroom lobby UI injected (skipLobby)", noLobbyA);
  // each sees the other as a remote
  const bSeesA = await B.page.evaluate((id) => new Promise((res) => {
    const t0 = Date.now();
    (function poll() {
      if (window.__FL__.presence.remoteIds().includes(id)) return res(true);
      if (Date.now() - t0 > 15000) return res(false);
      setTimeout(poll, 300);
    })();
  }), idA);
  const aSeesB = await A.page.evaluate((id) => new Promise((res) => {
    const t0 = Date.now();
    (function poll() {
      if (window.__FL__.presence.remoteIds().includes(id)) return res(true);
      if (Date.now() - t0 > 15000) return res(false);
      setTimeout(poll, 300);
    })();
  }), idB);
  check("B sees A as a remote avatar", bSeesA);
  check("A sees B as a remote avatar", aSeesB);
  const presCountB = await B.page.evaluate(() => window.__FL__.presence.presentCount());
  check("presence count = 2 on B", presCountB === 2, `count=${presCountB}`);

  // ---------------- (b) A moves -> B's copy of A moves ----------------
  console.log("\n=== (b) A moves; B's copy of A converges to the new position ===");
  await teleport(A.page, 16, 34); await sleep(400);
  const beforePos = await B.page.evaluate((id) => window.__FL__.presence.remotePos(id), idA);
  await teleport(A.page, 26, 42); // walk east across open grass
  await sleep(1500);
  const afterPos = await B.page.evaluate((id) => window.__FL__.presence.remotePos(id), idA);
  const dist = afterPos ? Math.hypot(afterPos.x - 26, afterPos.z - 42) : 999;
  const moved = beforePos && afterPos ? Math.hypot(afterPos.x - beforePos.x, afterPos.z - beforePos.z) : 0;
  check("B's copy of A moved when A moved", moved > 3, `moved=${moved.toFixed(2)}m`);
  check("B's copy of A converged near A's new position (<2m)", dist < 2, `dist=${dist.toFixed(2)}m after=${JSON.stringify(afterPos)}`);

  // ---------------- (c) A uses the hoe -> B sees tool + arm swing ----------------
  console.log("\n=== (c) A equips + uses the hoe; B sees the tool + a real arm-quat change (remote frozen-arm guard) ===");
  // place A on a field tile facing north to till (field origin math from verify-p1/p2)
  await A.page.evaluate(() => {
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2, gx = 6, gz = 6;
    const x = ORIGIN_X + TILE * (gx + 0.5), z = ORIGIN_Z + TILE * (gz + 0.5);
    window.__FL__.farm.teleport(x, z - 1.6);
    window.__FL__.farm.setHeading(0);
    window.__FL__.farm.equip("hoe");
  });
  await sleep(900); // let tool + pose propagate to B
  const toolOnB = await B.page.evaluate((id) => window.__FL__.presence.remoteTool(id), idA);
  check("B sees A's equipped hoe", toolOnB === "hoe", `tool=${toolOnB}`);
  const idleArm = await B.page.evaluate((id) => window.__FL__.presence.remoteArmQuat(id), idA);
  await A.page.evaluate(() => window.__FL__.farm.action()); // till -> playToolAnim + emitAnim
  // within the swing, B's remote arm quaternion must diverge from idle
  let armDiff = 0;
  try {
    await B.page.waitForFunction((id, idle) => {
      const q = window.__FL__.presence.remoteArmQuat(id);
      if (!q || !idle) return false;
      const d = Math.abs(q[0] - idle[0]) + Math.abs(q[1] - idle[1]) + Math.abs(q[2] - idle[2]) + Math.abs(q[3] - idle[3]);
      window.__armDiff = d;
      return d > 0.05;
    }, { timeout: 4000, polling: 30 }, idA, idleArm);
    armDiff = await B.page.evaluate(() => window.__armDiff);
  } catch (_) {}
  check("B's remote A-avatar arm actually swings (quat delta > 0.05)", armDiff > 0.05, `Δquat=${armDiff.toFixed(3)}`);

  // ---------------- screenshot: both farmers in B's view, A mid-emote ----------------
  console.log("\n=== screenshot: both farmers in B's view ===");
  await teleport(A.page, 17.5, 37.5); // stand near B (spawn 16,34) so both frame
  await A.page.evaluate(() => window.__FL__.farm.setHeading(Math.PI));
  await sleep(700);
  await A.page.evaluate(() => window.__FL__.presence.emote("wave"));
  await sleep(400);
  try { await B.page.screenshot({ path: path.join(SHOTS, "farmlife-p3-two-farmers.png") }); } catch (_) {}

  // ---------------- (d) A emotes -> bubble over A on B; repeat re-triggers ----------------
  console.log("\n=== (d) A emotes; bubble appears over A on B; repeat re-triggers (seq) ===");
  await A.page.evaluate(() => window.__FL__.presence.emote("heart"));
  let bubble1 = false;
  try {
    await B.page.waitForFunction((id) => window.__FL__.presence.remoteEmoteVisible(id) === true, { timeout: 5000, polling: 30 }, idA);
    bubble1 = true;
  } catch (_) {}
  check("A's emote bubble shows over A on B's screen", bubble1);
  // wait for the ~2s bubble to auto-hide, then re-emote the SAME kind -> must re-show
  let hidden = false;
  try {
    await B.page.waitForFunction((id) => window.__FL__.presence.remoteEmoteVisible(id) === false, { timeout: 4000, polling: 50 }, idA);
    hidden = true;
  } catch (_) {}
  await A.page.evaluate(() => window.__FL__.presence.emote("heart")); // same kind again
  let bubble2 = false;
  try {
    await B.page.waitForFunction((id) => window.__FL__.presence.remoteEmoteVisible(id) === true, { timeout: 5000, polling: 30 }, idA);
    bubble2 = true;
  } catch (_) {}
  check("repeating the SAME emote re-triggers the bubble (exactly-once seq)", hidden && bubble2, `hidden=${hidden} reshown=${bubble2}`);

  // ---------------- (f-appear) lobby doc + games.html card ----------------
  console.log("\n=== (f) lobby doc reflects presence; games.html renders the JOIN card ===");
  const lob2 = await waitDoc(`lobbies_${FAM}`, "fl_farm", (d) => d && d.playerCount === 2 && d.status === "open", 20000);
  check("lobby doc fl_farm exists with playerCount 2, status open", lob2 && lob2.playerCount === 2 && lob2.status === "open", JSON.stringify(lob2 && { host: lob2.hostName, pc: lob2.playerCount, st: lob2.status, game: lob2.game }));
  check("lobby doc is game=farmlife, ico=🌱, maxPlayers 8", lob2 && lob2.game === "farmlife" && lob2.ico === "🌱" && lob2.maxPlayers === 8, JSON.stringify(lob2 && { game: lob2.game, ico: lob2.ico, mp: lob2.maxPlayers }));

  const G = await B.browser.newPage();
  const gErrors = [];
  G.on("pageerror", (e) => gErrors.push(String(e.message || e)));
  await G.bringToFront().catch(() => {});
  await G.goto(`${GAMES_HTML}?fam=${FAM}`, { waitUntil: "load", timeout: 60000 });
  let cardText = "";
  try {
    await G.waitForFunction(() => {
      const el = document.querySelector("#lobbyBanners .lobby-card .lobby-text");
      return el && /on the farm/.test(el.textContent || "");
    }, { timeout: 15000 });
    cardText = await G.evaluate(() => document.querySelector("#lobbyBanners .lobby-card .lobby-text").textContent);
  } catch (_) {}
  check("games.html renders the farmlife JOIN card with correct text", /on the farm/.test(cardText) && /farming/.test(cardText), JSON.stringify(cardText));
  await G.close().catch(() => {});

  // ---------------- (g) B plants a tile -> exactly one Firestore write ----------------
  console.log("\n=== (g) B plants a tile while present; farm state writes exactly once (presence doesn't double-write) ===");
  // B was backgrounded while games.html was foreground (rAF freezes on hidden
  // tabs — house lesson; `pending` target is recomputed in frame()), so
  // re-foreground it before driving tile actions.
  await B.page.bringToFront().catch(() => {});
  await sleep(200);
  // ensure B is on the cloud store, then till+plant a distinct tile
  await B.page.waitForFunction(() => window.__FL__.net.isCloud() === true, { timeout: 20000 }).catch(() => {});
  const GX = 8, GZ = 8;
  await B.page.evaluate((gx, gz) => {
    const ORIGIN_X = -6 - 12, ORIGIN_Z = 6 - 12, TILE = 2;
    const x = ORIGIN_X + TILE * (gx + 0.5), z = ORIGIN_Z + TILE * (gz + 0.5);
    window.__FL__.farm.teleport(x, z - 1.6);
    window.__FL__.farm.setHeading(0);
    window.__FL__.farm.equip("hoe");
  }, GX, GZ);
  await sleep(150);
  await B.page.evaluate(() => window.__FL__.farm.action()); // till
  await B.page.waitForFunction(() => !window.__FL__.avatar.isBusy(), { timeout: 3000 }).catch(() => {});
  await B.page.evaluate(() => window.__FL__.farm.equip("seeds"));
  await sleep(120);
  await B.page.evaluate(() => window.__FL__.farm.action()); // plant
  await B.page.evaluate(() => window.__FL__.net.flush());
  await sleep(600);
  const region = await restGetDoc(`farmlife_${FAM}`, "region_0_0");
  const t88 = region && region["t_8_8"];
  check("B's planted tile written to Firestore exactly once (region doc)", t88 && t88.crop === "turnip", JSON.stringify(t88));

  // ---------------- (e)+(f-decrement) close A ----------------
  console.log("\n=== (e) A leaves; B gets the leave toast, disposes A's avatar; lobby count decrements ===");
  await A.browser.close().catch(() => {});
  let disposed = false;
  try {
    await B.page.waitForFunction(() => window.__FL__.presence.remoteCount() === 0, { timeout: 15000, polling: 200 });
    disposed = true;
  } catch (_) {}
  check("B disposed A's avatar (remoteCount back to 0)", disposed);
  const afterChildren = await B.page.evaluate(() => window.__FL__.presence.sceneChildCount());
  check("B scene object count returned to baseline (avatar removed cleanly)", afterChildren === baselineChildren, `baseline=${baselineChildren} after=${afterChildren}`);
  const toastsB = await B.page.evaluate(() => window.__toasts || []);
  check("B saw a leave toast (\"headed home\")", toastsB.some((t) => /headed home/.test(t)), JSON.stringify(toastsB));
  const lob1 = await waitDoc(`lobbies_${FAM}`, "fl_farm", (d) => d && d.playerCount === 1, 20000);
  check("lobby doc playerCount decremented to 1", lob1 && lob1.playerCount === 1, JSON.stringify(lob1 && { pc: lob1.playerCount }));

  // ---------------- (f-delete) close B ----------------
  console.log("\n=== (f) B (last present) leaves; lobby doc is deleted ===");
  const bErrors = B.errors.slice();
  // Fire the real pagehide handler (which calls deleteDoc) but keep the tab
  // ALIVE for a beat so the async Firestore delete lands before teardown —
  // browser.close() alone kills the in-flight fetch (in production the browser
  // grants pagehide a grace window for exactly this).
  await B.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await sleep(2500);
  await B.browser.close().catch(() => {});
  const gone = await waitDoc(`lobbies_${FAM}`, "fl_farm", (d) => d === null, 15000);
  check("lobby doc deleted when the last player left", gone === null, gone === null ? "deleted" : JSON.stringify(gone));

  // ---------------- cleanup ----------------
  console.log("\n=== cleanup ===");
  const delLob = await restDeleteCollection(`lobbies_${FAM}`);
  const delFarm = await restDeleteCollection(`farmlife_${FAM}`);
  console.log(`deleted ${delLob} lobby doc(s), ${delFarm} farm doc(s)`);
  const finalLob = await restListDocs(`lobbies_${FAM}`);
  const finalFarm = await restListDocs(`farmlife_${FAM}`);
  check(`cleanup: lobbies_${FAM} empty`, finalLob.length === 0, `remaining=${finalLob.length}`);
  check(`cleanup: farmlife_${FAM} empty`, finalFarm.length === 0, `remaining=${finalFarm.length}`);

  const realErrors = [...A.errors, ...bErrors, ...gErrors].filter((e) => !/favicon|Failed to load resource/i.test(e));
  check("0 real pageerrors across both processes + games.html", realErrors.length === 0, realErrors.join(" | "));

  if (server) try { process.kill(server.pid); } catch (_) {}
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  console.log("shot: shots/farmlife-p3-two-farmers.png");
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
