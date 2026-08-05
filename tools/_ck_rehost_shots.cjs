#!/usr/bin/env node
"use strict";
/**
 * CASTLE KRUZER — save-and-rehost screenshots (2026-08-05).
 *
 *   node tools/_ck_rehost_shots.cjs
 *
 * shots/ is gitignored, so this script — not the suite — is what puts the
 * ck_rehost_* plates back on disk. Every plate ASSERTS what its filename
 * claims BEFORE it is written, so a shot can never quietly stop showing the
 * thing it exists to show.
 *
 *   ck_rehost_savelist          the saved-kingdom picker, real identity on every row
 *   ck_rehost_savelist_mobile   …the same at 390x844
 *   ck_rehost_hostflow          a room opened FROM a save: code + invite link
 *   ck_rehost_guest_inherited   the joined partner standing in the kingdom they inherited
 *
 * Two browser processes over the same tiny ws relay the MP suite uses (two
 * tabs in one browser throttle the background page's rAF).
 */
const H = require("./_fs_harness.cjs");
const WebSocket = require("ws");
const urlmod = require("url");

const RELAY_PORT = 8940 + Math.floor(Math.random() * 20);

function startRelay(port) {
  const wss = new WebSocket.Server({ port, host: "127.0.0.1" });
  const rooms = new Map();
  wss.on("connection", (ws, req) => {
    const q = urlmod.parse(req.url, true).query;
    const room = q.room || "-", role = q.role || "?";
    let set = rooms.get(room);
    if (!set) { set = new Set(); rooms.set(room, set); }
    for (const p of set) { try { p.send(JSON.stringify({ __r: "peer", join: true, role })); } catch (e) {} }
    if (set.size) { try { ws.send(JSON.stringify({ __r: "peer", join: true, role: "present" })); } catch (e) {} }
    set.add(ws);
    ws.on("message", (d) => {
      const s = d.toString();
      for (const p of set) if (p !== ws && p.readyState === 1) { try { p.send(s); } catch (e) {} }
    });
    ws.on("close", () => {
      set.delete(ws);
      for (const p of set) { try { p.send(JSON.stringify({ __r: "peer", join: false, role })); } catch (e) {} }
    });
    ws.on("error", () => {});
  });
  return wss;
}

H.run("ck-rehost-shots", async (t) => {
  const wss = startRelay(RELAY_PORT);
  const b2 = await H.launch();
  const errors = [];
  const url = t.BASE + "/castlekruzer.html?mpws=ws://127.0.0.1:" + RELAY_PORT + "&nolobby=1";

  async function boot(browser, who, vp) {
    const page = await browser.newPage();
    await page.setViewport(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => errors.push(who + ": " + String((e && e.message) || e)));
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      if (u.startsWith(t.BASE + "/.netlify/")) return req.respond({ status: 204, body: "" });
      if (u.startsWith(t.BASE)) return req.continue();
      return req.abort();
    });
    await page.evaluateOnNewDocument((n) => { try { localStorage.setItem("choreUser", n); } catch (e) {} }, who);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSNet, { timeout: 30000 });
    return page;
  }

  /* ── lay down saves worth choosing between: one co-op, one solo ────────── */
  const host = await boot(t.browser, "Dad");
  const seeded = await host.evaluate(() => {
    const FS = window.__FS__;
    const stamp = (s) => { try { localStorage.setItem("fs_save_" + s + "_meta", JSON.stringify({ ts: Date.now() })); } catch (e) {} };
    FS.newGame({ size: "small", seed: 606060, ais: 1, mode: "separate", humans: 2, speed: 0 });
    FS.ff(2600);
    FS.save("2"); stamp("2");
    const coop = { tick: FS.G.tick, hash: FS.hash() };
    FS.newGame({ size: "small", seed: 121212, ais: 1, speed: 0 });
    FS.ff(900);
    FS.save("1"); stamp("1");
    const solo = { tick: FS.G.tick, hash: FS.hash() };
    FS.toTitle();
    return { coop, solo };
  });

  /* ── 1/2. the picker, desktop and phone ───────────────────────────────── */
  await host.click("#hostSaveBtn");
  await t.sleep(300);
  /* the picker sits at the FOOT of a scrolling title panel — a plate taken
   * without scrolling to it is a screenshot of the new-game form */
  const seePick = async () => {
    await host.evaluate(() => {
      const box = document.getElementById("savePick");
      box.scrollIntoView({ block: "end" });
      // …and a shade further, so the last row's buttons are not on the seam
      const sc = document.getElementById("title");
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await t.sleep(350);
  };
  await seePick();
  const pick = await host.evaluate(() => {
    const box = document.getElementById("savePick");
    const vh = window.innerHeight;
    const rows = [].map.call(box.querySelectorAll(".srow"), (r) => {
      const b = r.querySelector("button[data-mode=separate]");
      const rect = r.getBoundingClientRect();
      return { line: r.querySelector(".sinfo span").textContent, sep: b ? !!b.disabled : null,
        onScreen: rect.top >= 0 && rect.bottom <= vh && rect.height > 0 };
    });
    return { open: !box.classList.contains("hidden"), rows };
  });
  const readable = pick.rows.filter((r) => r.sep !== null);
  t.check("the picker is open and every readable row carries real identity",
    pick.open && readable.length >= 2 &&
    readable.every((r) => /kingdom/.test(r.line) && /(in|started)/.test(r.line)), pick.rows);
  t.check("…and one save can offer separate kingdoms while another honestly cannot",
    readable.some((r) => r.sep === false) && readable.some((r) => r.sep === true), pick.rows);
  t.check("…and the plate actually SHOWS the list, not the form above it",
    pick.rows.filter((r) => r.onScreen).length >= 2, pick.rows);
  await t.shot(host, "ck_rehost_savelist");

  await host.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await seePick();
  const narrow = await host.evaluate(() => {
    const vh = window.innerHeight;
    const rows = [].filter.call(document.querySelectorAll("#savePick .srow"), (r) => {
      const b = r.getBoundingClientRect();
      return b.top >= 0 && b.bottom <= vh && b.height > 0;
    }).length;
    return {
      over: document.documentElement.scrollWidth > window.innerWidth + 1,
      minH: Math.min.apply(null, [].map.call(
        document.querySelectorAll("#savePick button"), (b) => b.getBoundingClientRect().height)),
      rows,
    };
  });
  t.check("…and on a phone it fits, with finger-sized targets and rows in frame",
    narrow.over === false && narrow.minH >= 44 && narrow.rows >= 2, narrow);
  await t.shot(host, "ck_rehost_savelist_mobile");
  await host.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

  /* ── 3. hosting THAT save: a real room, from the saved world ──────────── */
  const opened = await host.evaluate(() => window.__FS__.hostSavedGame("2", "separate"));
  await t.sleep(400);
  const live = await host.evaluate(() => ({
    tick: window.__FS__.G ? window.__FS__.G.tick : -1,
    hash: window.__FS__.hash(), seats: window.__FS__.G.seats.slice(),
    note: document.getElementById("netNote").textContent,
    chip: !document.getElementById("netChip").classList.contains("hidden"),
  }));
  t.check("hosting from the save resumed THAT world (not a fresh one) and opened a room",
    live.tick === seeded.coop.tick && live.hash === seeded.coop.hash &&
    opened.role === "host" && /#r=/.test(opened.link || ""), { live, opened });
  t.check("…and the screen shows the room code and the invite link to share",
    live.note.indexOf(opened.code) >= 0 && /r=/.test(live.note), live.note);
  await host.evaluate(() => {
    const FS = window.__FS__, c = FS.FSSim.castleOf(FS.G, 0);
    FS.FSRender.setCam({ yaw: 0.6, pitch: 0.62, dist: 32 });
    FS.FSRender.focusVertex(c.v, 32);
    FS.paintHud();
    for (let i = 0; i < 14; i++) FS.FSRender.frame(0.033);
  });
  await t.sleep(400);
  await t.shot(host, "ck_rehost_hostflow");

  /* ── 4. a DIFFERENT person joins and stands in the inherited kingdom ──── */
  const guest = await boot(b2, "Eleanor");
  await guest.evaluate((c) => window.__FS__.joinGame(c), opened.code);
  await guest.waitForFunction(() => window.__FS__.netState().status === "playing", { timeout: 30000 });
  await t.sleep(500);
  const inherited = await guest.evaluate(() => {
    const FS = window.__FS__, G = FS.G;
    const c = FS.FSSim.castleOf(G, 1);
    FS.FSRender.setCam({ yaw: 0.6, pitch: 0.60, dist: 26 });
    FS.FSRender.focusVertex(c.v, 26);
    FS.paintHud();
    for (let i = 0; i < 16; i++) FS.FSRender.frame(0.033);
    return { seat: FS.netState().seat, seats: G.seats.slice(), c1: FS.q.counts(1),
      tick: G.tick, chip: document.getElementById("netChip").textContent };
  });
  t.check("the newcomer took seat 1 and is standing in the kingdom the save left behind",
    inherited.seat === 1 && inherited.seats[1] === 1 &&
    inherited.c1.buildings >= 1 && inherited.c1.land > 0 && inherited.tick >= seeded.coop.tick,
    inherited);
  await t.sleep(300);
  await t.shot(guest, "ck_rehost_guest_inherited");

  t.check("0 page errors", errors.length === 0, errors.slice(0, 5));
  await guest.close();
  await host.close();
  await b2.close().catch(() => {});
  wss.close();
});
