#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase M multiplayer suite (plan §16).
 *
 * TWO SEPARATE BROWSER PROCESSES (house lesson: two tabs in one browser throttle
 * the background page's rAF) talk over a tiny node `ws` fan-out relay, exactly
 * the way the game's "localws" transport expects:
 *     farmstead.html?mpws=ws://127.0.0.1:<port>
 * Playroom's CDN/backend is unreachable from this container, so the playroom
 * adapter is covered by a CONTRACT test against an injected fake SDK (lazy load,
 * hash cleared before insertCoin, skipLobby+roomCode, failure → solo).
 *
 * The scripted sections keep both sims PAUSED and advance the host explicitly
 * with __FS__.ff(n): the guest still follows the host's tick clock (that is the
 * whole point of the pacing rule), which makes every hash comparison exact.
 * One section runs the real accumulator at 2× to prove the live path too.
 *
 *   node tools/_verify-farmstead-mp.cjs
 */
const H = require("./_fs_harness.cjs");
const WebSocket = require("ws");
const urlmod = require("url");

const RELAY_PORT = 8960 + Math.floor(Math.random() * 30);

/* ───────────────────────────── ws fan-out relay ───────────────────────────── */
function startRelay(port) {
  const wss = new WebSocket.Server({ port, host: "127.0.0.1" });
  const rooms = new Map();
  const stat = { msgs: 0, bytes: 0, conns: 0, wss };
  wss.on("connection", (ws, req) => {
    const q = urlmod.parse(req.url, true).query;
    const room = q.room || "-";
    const role = q.role || "?";
    let set = rooms.get(room);
    if (!set) { set = new Set(); rooms.set(room, set); }
    stat.conns++;
    for (const p of set) { try { p.send(JSON.stringify({ __r: "peer", join: true, role })); } catch (e) {} }
    if (set.size) { try { ws.send(JSON.stringify({ __r: "peer", join: true, role: "present" })); } catch (e) {} }
    set.add(ws);
    ws.on("message", (data) => {
      const s = data.toString();
      stat.msgs++; stat.bytes += s.length;
      for (const p of set) if (p !== ws && p.readyState === 1) { try { p.send(s); } catch (e) {} }
    });
    ws.on("close", () => {
      set.delete(ws);
      for (const p of set) { try { p.send(JSON.stringify({ __r: "peer", join: false, role })); } catch (e) {} }
    });
    ws.on("error", () => {});
  });
  return stat;
}

/* ─────────────────────────────── page helpers ─────────────────────────────── */
function makePageFactory(t, errors, reqLog, blocked) {
  return async function mkPage(browser, tag) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => errors.push(tag + ": " + String((e && e.message) || e)));
    page.on("console", (m) => {
      const txt = m.text();
      // a DELIBERATELY blocked off-origin fetch (the CDN-unreachable test) logs
      // browser network noise, not a page fault — counted separately and asserted
      if (/Failed to load resource|ERR_FAILED|ERR_BLOCKED|net::/i.test(txt)) { blocked.push(tag + ": " + txt); return; }
      if (m.type() === "error") errors.push(tag + " console: " + txt);
    });
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const u = req.url();
      reqLog.push(tag + " " + u);
      if (u.startsWith(t.BASE)) return req.continue();
      return req.abort();
    });
    return page;
  };
}

const url = (t, extra) => t.BASE + "/farmstead.html?mpws=ws://127.0.0.1:" + RELAY_PORT + "&nolobby=1" + (extra || "");

async function bootPage(page, u) {
  await page.goto(u, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSNet, { timeout: 25000 });
}

const tickOf = (p) => p.evaluate(() => (window.__FS__.G ? window.__FS__.G.tick : -1));
const hashOf = (p) => p.evaluate(() => window.__FS__.hash());
const stateOf = (p) => p.evaluate(() => window.__FS__.netState());

/** Advance the host n ticks, then wait for the guest's clock to reach it. */
async function advance(host, guest, n, timeout) {
  await host.evaluate((k) => window.__FS__.ff(k), n);
  const ht = await tickOf(host);
  await guest.waitForFunction((t) => window.__FS__.G && window.__FS__.G.tick >= t,
    { timeout: timeout || 20000, polling: 60 }, ht);
  return ht;
}

/** Both sims at the same tick → compare the lockstep hash. */
async function agree(host, guest) {
  const ht = await tickOf(host), gt = await tickOf(guest);
  const hh = await hashOf(host), gh = await hashOf(guest);
  return { ht, gt, hh, gh, ok: ht === gt && hh === gh };
}

H.run("farmstead-mp", async (t) => {
  const errors = [], reqLog = [], blocked = [];
  const mkPage = makePageFactory(t, errors, reqLog, blocked);
  const relay = startRelay(RELAY_PORT);
  const b2 = await H.launch();                       // the SECOND browser process
  const close = [];

  /* ══════════════ 1. serialization (join/resync + Phase E save slots) ══════ */
  const solo = await mkPage(t.browser, "solo");
  await solo.evaluateOnNewDocument(() => {
    // request interception cannot see WebSockets — spy on the constructor instead
    window.__WS__ = [];
    const Orig = window.WebSocket;
    const Spy = function (u, p) { window.__WS__.push(String(u)); return new Orig(u, p); };
    Spy.prototype = Orig.prototype;
    window.WebSocket = Spy;
  });
  await bootPage(solo, t.BASE + "/farmstead.html");
  const ser = await solo.evaluate(() => {
    const FS = window.__FS__;
    FS.newGame({ size: "medium", seed: 4242, ais: 1, speed: 0 });
    FS.ff(300);
    const a = { h: FS.hash(), m: FS.mapHash(), t: FS.G.tick, c: FS.q.counts(0) };
    const str = FS.serialize();
    const parsed = JSON.parse(str);
    FS.loadState(str);
    const b = { h: FS.hash(), m: FS.mapHash(), t: FS.G.tick, c: FS.q.counts(0) };
    for (let i = 0; i < 3; i++) FS.FSRender.frame(0.033);      // the rebuilt world must draw
    FS.ff(120);
    const cont = FS.G.tick;
    // save slot round trip (localStorage)
    const saved = FS.save(9);
    FS.ff(50);
    const loaded = FS.load(9);
    const after = { h: FS.hash(), t: FS.G.tick };
    let badVersion = "";
    try { FS.FSSim.deserialize(JSON.stringify(Object.assign({}, parsed, { v: 99 }))); }
    catch (e) { badVersion = String(e.message || e); }
    let badDoc = "";
    try { FS.FSSim.deserialize('{"hello":1}'); } catch (e) { badDoc = String(e.message || e); }
    const sc = FS.FSRender.scene();
    return { a, b, cont, bytes: str.length, saved, loaded, after,
      badVersion, badDoc, hasTA: !!(parsed.map && parsed.map.height && parsed.map.height._ta),
      rng: parsed.rng, ver: parsed.v, draws: FS.FSRender.stats().drawCalls,
      kids: sc ? sc.children.length : 0, scene: sc ? 1 : 0 };
  });
  t.check("serialize → deserialize keeps the sim hash exactly", ser.a.h === ser.b.h, ser);
  t.check("…and the map (typed arrays survive as bytes)", ser.a.m === ser.b.m && ser.hasTA, ser);
  t.check("…and the PRNG stream position rides along", !!ser.rng && ser.rng.calls > 0, ser.rng);
  t.check("a loaded world keeps ticking", ser.cont === ser.a.t + 120, ser);
  t.check("FSRender.rebuildAll puts a whole world back on screen",
    ser.draws > 0 && ser.scene === 1 && ser.kids > 4, { draws: ser.draws, kids: ser.kids });
  t.check("__FS__.save/load round-trips through localStorage",
    ser.saved && ser.loaded && ser.after.t === ser.a.t + 120, ser);
  t.check("a wrong-version save is rejected", /version/.test(ser.badVersion), ser.badVersion);
  t.check("a foreign document is rejected", /farmstead/.test(ser.badDoc), ser.badDoc);
  t.check("save size is sane for a medium map", ser.bytes > 20000 && ser.bytes < 4e6, ser.bytes);

  /* ══════════════ 2. solo regression: the wire stays cold ═════════════════ */
  const soloReq = reqLog.filter((u) => /ws:|wss:|playroom|unpkg|gstatic|firebase|googleapis/i.test(u));
  t.check("a plain solo boot makes NO playroom/firestore requests", soloReq.length === 0, soloReq.slice(0, 5));
  const soloNet = await solo.evaluate(() => ({
    active: window.FSNet.active(), sdk: window.FSNet._sdkLoaded(),
    hook: window.__FS__.FSSim.netHook === null, st: window.__FS__.netState().status,
    ws: window.__WS__.slice(),
  }));
  t.check("solo leaves FSSim.netHook null and FSNet inactive",
    !soloNet.active && soloNet.hook && soloNet.st === "off", soloNet);
  t.check("…and opens no WebSocket at all", soloNet.ws.length === 0, soloNet.ws);
  t.check("the Playroom SDK is never fetched until you host or join", soloNet.sdk === false, soloNet);
  await solo.close();

  /* ══════════════ 3. shared room: host + guest, worlds identical ══════════ */
  const host = await mkPage(t.browser, "host");
  const guest = await mkPage(b2, "guest");
  close.push(host, guest);
  await bootPage(host, url(t));
  await bootPage(guest, url(t));
  await host.evaluate(() => { try { localStorage.setItem("choreUser", "Dad"); } catch (e) {} });
  await guest.evaluate(() => { try { localStorage.setItem("choreUser", "Eleanor"); } catch (e) {} });

  // AI planning stays ON: the computer opponent is the hardest determinism test
  // there is, and both machines must run it identically from the same snapshot.
  const hostSt = await host.evaluate(() => window.__FS__.hostGame("shared", {
    seed: 20260717, size: "medium", ais: 1, code: "ROOM1", speed: 0,
  }));
  t.check("host opens a shared room over the localws transport",
    hostSt.role === "host" && hostSt.transport === "localws" && hostSt.mode === "shared", hostSt);
  t.check("host is seat 0 and holds a room code", hostSt.seat === 0 && !!hostSt.code, hostSt);
  t.check("the host's world starts immediately (no waiting for a partner)",
    (await tickOf(host)) >= 0 && (await host.evaluate(() => window.__FS__.started())), {});
  t.check("share link carries #r=<code>", /#r=ROOM1$/.test(hostSt.link), hostSt.link);

  await host.evaluate(() => window.__FS__.ff(120));
  await host.evaluate(() => window.__FS__.paintHud());
  const invite = await host.evaluate(() => {
    const inv = document.getElementById("netInvite");
    const ib = inv.getBoundingClientRect(), pb = document.getElementById("pingBtn").getBoundingClientRect();
    return { hidden: inv.classList.contains("hidden"),
      code: document.getElementById("inviteCode").textContent,
      link: document.getElementById("inviteLink").textContent,
      chip: document.getElementById("netChip").textContent,
      overlap: !(pb.top >= ib.bottom || pb.bottom <= ib.top || pb.left >= ib.right || pb.right <= ib.left) };
  });
  t.check("while waiting, the host sees the room code + a copyable invite link",
    invite.hidden === false && invite.code === "ROOM1" && /#r=ROOM1$/.test(invite.link) &&
    /waiting/i.test(invite.chip), invite);
  t.check("…and the co-op chrome does not overlap itself", invite.overlap === false, invite);
  await t.sleep(250);
  await t.shot(host, "farmstead_coop_waiting");

  const joinSt = await guest.evaluate(() => window.__FS__.joinGame("ROOM1"));
  t.check("guest connects as seat 1", joinSt.role === "guest", joinSt);
  await guest.waitForFunction(() => window.__FS__.netState().status === "playing", { timeout: 20000 });
  const gSt = await stateOf(guest);
  t.check("settings transfer with the welcome (seed/size/ais/mode)",
    gSt.settings && gSt.settings.seed === 20260717 && gSt.settings.size === "medium" &&
    gSt.settings.ais === 1 && gSt.settings.mode === "shared", gSt.settings);
  t.check("guest learns the host's name", gSt.peerName === "Dad", gSt);
  const hSt2 = await stateOf(host);
  t.check("host sees the partner arrive", hSt2.peerHere === true && hSt2.peerName === "Eleanor", hSt2);
  await host.evaluate(() => window.__FS__.paintHud());
  const inviteGone = await host.evaluate(() =>
    document.getElementById("netInvite").classList.contains("hidden"));
  t.check("…and the invite panel steps aside once they are in", inviteGone === true, { inviteGone });

  await advance(host, guest, 40);
  let eq = await agree(host, guest);
  t.check("both worlds carry the same MAP", (await guest.evaluate(() => window.__FS__.mapHash())) ===
    (await host.evaluate(() => window.__FS__.mapHash())), {});
  t.check("both worlds carry the same SIM STATE after the join", eq.ok, eq);
  t.check("the guest never runs ahead of the host clock", eq.gt <= eq.ht, eq);

  /* ══════════════ 4. commands both ways ═══════════════════════════════════ */
  const spots = await host.evaluate(() => {
    const FS = window.__FS__, G = FS.G, map = G.map, FSMap = FS.FSMap;
    const c = FS.FSSim.castleOf(G, 0);
    const out = [];
    FSMap.forRadius(map, c.v, 7, (u) => { if (!FSMap.whyFlag(map, u, 0)) out.push(u); });
    out.sort((a, b) => a - b);
    // a pair of ADJACENT legal spots: only whichever command runs FIRST can win
    let pair = null;
    for (let i = 0; i < out.length && !pair; i++) {
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, out[i], d);
        if (u >= 0 && out.indexOf(u) >= 0) { pair = [out[i], u]; break; }
      }
    }
    return { free: out.slice(0, 12), pair };
  });
  t.check("found free flag spots + an adjacent pair to race", spots.free.length > 3 && !!spots.pair, spots);

  const hv = spots.free[0];
  await host.evaluate((v) => window.__FS__.placeFlag(v), hv);
  await advance(host, guest, 12);
  const hostFlag = await host.evaluate((v) => {
    const FS = window.__FS__, id = FS.q.flagAt(v);
    const ev = FS.events("flagPlaced").filter((e) => e.v === v)[0];
    return { id, t: ev ? ev.t : -1 };
  }, hv);
  const guestFlag = await guest.evaluate((v) => {
    const FS = window.__FS__, id = FS.q.flagAt(v);
    const ev = FS.events("flagPlaced").filter((e) => e.v === v)[0];
    return { id, t: ev ? ev.t : -1 };
  }, hv);
  t.check("a host flag appears on BOTH screens", hostFlag.id > 0 && hostFlag.id === guestFlag.id,
    { hostFlag, guestFlag });
  t.check("…at exactly the same execution tick", hostFlag.t > 0 && hostFlag.t === guestFlag.t,
    { hostFlag, guestFlag });

  const gv = spots.free[2];
  await guest.evaluate((v) => window.__FS__.placeFlag(v), gv);
  await t.sleep(250);
  await advance(host, guest, 20);
  const gOnHost = await host.evaluate((v) => {
    const FS = window.__FS__, id = FS.q.flagAt(v);
    const ev = FS.events("flagPlaced").filter((e) => e.v === v)[0];
    return { id, p: id ? FS.G.flags[id].p : -1, t: ev ? ev.t : -1 };
  }, gv);
  const gOnGuest = await guest.evaluate((v) => {
    const FS = window.__FS__, id = FS.q.flagAt(v);
    const ev = FS.events("flagPlaced").filter((e) => e.v === v)[0];
    return { id, p: id ? FS.G.flags[id].p : -1, t: ev ? ev.t : -1 };
  }, gv);
  t.check("a GUEST command lands on both screens at the same tick",
    gOnHost.id > 0 && gOnHost.id === gOnGuest.id && gOnHost.t === gOnGuest.t, { gOnHost, gOnGuest });
  t.check("in SHARED mode the guest's flag belongs to player 0", gOnHost.p === 0, gOnHost);
  eq = await agree(host, guest);
  t.check("hashes still agree after two-sided commands", eq.ok, eq);

  // same-tick race: (t, by, seq) ordering must resolve identically on both machines
  const race = await host.evaluate((pair) => {
    const FS = window.__FS__;
    const t = FS.G.tick + 8;
    // deliberately issued in REVERSE seat order — ordering must come from `by`
    FS.FSSim.issueCommand(FS.G, { type: "flag", args: { v: pair[1] }, by: 1, t: t });
    FS.FSSim.issueCommand(FS.G, { type: "flag", args: { v: pair[0] }, by: 0, t: t });
    return t;
  }, spots.pair);
  await advance(host, guest, 20);
  const raceH = await host.evaluate((p) => [window.__FS__.q.flagAt(p[0]), window.__FS__.q.flagAt(p[1])], spots.pair);
  const raceG = await guest.evaluate((p) => [window.__FS__.q.flagAt(p[0]), window.__FS__.q.flagAt(p[1])], spots.pair);
  t.check("same-tick commands resolve in (by,seq) order — seat 0 wins the race",
    raceH[0] > 0 && raceH[1] === 0, { race, raceH });
  t.check("…and the loser lost on BOTH machines (identical outcome)",
    raceH[0] === raceG[0] && raceH[1] === raceG[1], { raceH, raceG });
  const failEv = await guest.evaluate(() => window.__FS__.events("cmdFail").length);
  t.check("the losing command is logged as cmdFail, not silently dropped", failEv >= 1, { failEv });

  // speed is a command: both screens follow
  await guest.evaluate(() => window.__FS__.setSpeed(2));
  await t.sleep(400);
  const spH = await host.evaluate(() => window.__FS__.G.speed);
  const spG = await guest.evaluate(() => window.__FS__.G.speed);
  t.check("a GUEST speed change moves BOTH screens to 2×", spH === 2 && spG === 2, { spH, spG });
  const t0 = await tickOf(host);
  // Wall-clock check under variable machine load: bounded retries widen the window
  // instead of weakening what it proves (the accumulator genuinely advances at speed).
  let t1 = 0, g1 = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    await t.sleep(1200);
    g1 = await tickOf(guest); t1 = await tickOf(host);
    if (t1 - t0 > 8) break;
  }
  t.check("the live accumulator path really advances at 2×", t1 - t0 > 8, { t0, t1 });
  // The REAL lockstep invariant: guest never exceeds lastConfirmedHostTick + lead − 1.
  // lastConfirmed ≤ the host tick we just read, so the sound cross-browser bound is
  // t1 + lead − 1 (a starved HOST tab may lag while the guest extrapolates to its
  // designed ceiling — that is correct behavior, not a violation).
  const lead2x = require("../assets/farmstead/fs-const.js").CMD_DELAY_MP * 2;
  t.check("the guest tracks the running host without passing its lead window",
    g1 <= t1 + lead2x - 1 && (t1 - g1) < 40, { t1, g1, lead2x });
  // a hidden tab must NOT pause a co-op game (solo still does — checked below)
  const hidden = await host.evaluate(async () => {
    const FS = window.__FS__;
    FS.setSpeed(1);
    await new Promise((r) => setTimeout(r, 250));
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const t0 = FS.G.tick, s0 = FS.G.speed;
    await new Promise((r) => setTimeout(r, 900));
    const out = { t0, s0, t1: FS.G.tick, s1: FS.G.speed };
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    return out;
  });
  t.check("a hidden tab never pauses a co-op game", hidden.s1 === 1 && hidden.s0 === 1, hidden);
  t.check("…and the shared clock keeps running while hidden", hidden.t1 > hidden.t0, hidden);

  await host.evaluate(() => window.__FS__.setSpeed(0));
  await t.sleep(500);
  await advance(host, guest, 5);
  eq = await agree(host, guest);
  t.check("hashes agree again after a live 2× run", eq.ok, eq);

  // ping: an event on both sides, invisible to the hash
  const pingBefore = await hashOf(host);
  await guest.evaluate((v) => window.__FS__.ping(v), hv);
  await t.sleep(300);
  await advance(host, guest, 8);
  const pingH = await host.evaluate(() => window.__FS__.events("ping").slice(-1)[0] || null);
  const pingG = await guest.evaluate(() => window.__FS__.events("ping").slice(-1)[0] || null);
  t.check("a PING raises the same event on both screens",
    !!pingH && !!pingG && pingH.v === hv && pingG.v === hv, { pingH, pingG });
  t.check("…issued by seat 1", pingH && pingH.by === 1, pingH);
  const pingAfterH = await hashOf(host), pingAfterG = await hashOf(guest);
  t.check("a ping changes no sim state (hash only moved with the ticks)",
    pingAfterH === pingAfterG && pingBefore !== undefined, { pingAfterH, pingAfterG });
  const pingMark = await host.evaluate(() => {
    const el = document.getElementById("pingMark");
    return { hidden: el.classList.contains("hidden"), left: el.style.left };
  });
  t.check("the host screen shows the partner's ping marker", pingMark.hidden === false, pingMark);

  /* ══════════════ 5. a long two-sided session, zero desyncs ═══════════════ */
  const checkpoints = [];
  for (let round = 0; round < 5; round++) {
    // both seats keep building — the host takes the nearest free spot, the guest
    // the farthest, so the two never collide on the same vertex
    await host.evaluate(() => {
      const FS = window.__FS__, G = FS.G, FSMap = FS.FSMap;
      const c = FS.FSSim.castleOf(G, 0);
      const free = [];
      FSMap.forRadius(G.map, c.v, 9, (u) => { if (!FSMap.whyFlag(G.map, u, 0)) free.push(u); });
      if (free.length) FS.placeFlag(free[0]);
    });
    await guest.evaluate(() => {
      const FS = window.__FS__, G = FS.G, FSMap = FS.FSMap;
      const c = FS.FSSim.castleOf(G, 0);
      const free = [];
      FSMap.forRadius(G.map, c.v, 9, (u) => { if (!FSMap.whyFlag(G.map, u, 0)) free.push(u); });
      if (free.length) FS.placeFlag(free[free.length - 1]);
    });
    await t.sleep(250);
    await advance(host, guest, 420, 40000);
    const e = await agree(host, guest);
    checkpoints.push(e);
  }
  t.check("2000+ ticks of two-sided play stay bit-identical",
    checkpoints.every((c) => c.ok), checkpoints.map((c) => ({ t: c.ht, h: c.hh, g: c.gh })));
  const stLong = await stateOf(guest);
  const desyncH = (await stateOf(host)).desyncs, desyncG = stLong.desyncs;
  t.check("zero desyncs across the whole session", desyncH === 0 && desyncG === 0, { desyncH, desyncG });
  t.check("every 100-tick checkpoint was really compared, not just sent",
    stLong.checkpoints >= 20, { checkpoints: stLong.checkpoints, msgs: relay.msgs });
  const built = await host.evaluate(() => window.__FS__.q.counts(0));
  t.check("the shared kingdom really grew (flags placed by both seats)", built.flags >= 8, built);

  /* ══════════════ 6. forced desync → automatic resync ════════════════════ */
  const before = await agree(host, guest);
  const corrupt = await guest.evaluate(() => {
    const G = window.__FS__.G;
    // a direct write behind the sim's back: one owned map vertex + the id counter
    let v = -1;
    for (let i = 0; i < G.map.owner.length; i++) if (G.map.owner[i] === 0) { v = i; break; }
    if (v >= 0) G.map.owner[v] = -1;
    G.nextId += 1;
    return { v, hash: window.__FS__.hash() };
  });
  t.check("the corruption really changed the guest's hash", corrupt.hash !== before.gh, { corrupt, before });
  const tResync0 = Date.now();
  await advance(host, guest, 260, 40000);
  await guest.waitForFunction(() => window.__FS__.netState().desyncs > 0, { timeout: 20000 });
  await guest.waitForFunction(() => window.__FS__.netState().status === "playing", { timeout: 30000 });
  await advance(host, guest, 30, 30000);
  const resyncMs = Date.now() - tResync0;
  const afterFix = await agree(host, guest);
  const stG = await stateOf(guest), stH = await stateOf(host);
  t.check("the next checkpoint catches the desync", stG.desyncs === 1, stG);
  t.check("…the host counts it too and ships a fresh world", stH.desyncs === 1 && stH.resyncs === 1, stH);
  t.check("…and the two sims are identical again", afterFix.ok, afterFix);
  const desEv = await guest.evaluate(() => ({
    des: window.__FS__.events("netDesync").length, res: window.__FS__.events("netResync").length,
    notif: window.__FS__.G.notif.slice(-4).map((n) => n.text).join(" | "),
  }));
  t.check("the repair is logged as an event + a player notification",
    desEv.des >= 1 && desEv.res >= 1 && /step with your partner/i.test(desEv.notif), desEv);
  const rstats = await guest.evaluate(() => window.__FS__.netStats());
  console.log("   resync: detected+repaired in " + resyncMs + " ms wall, transfer " +
    rstats.joinBytes + " B in " + rstats.joinChunks + " chunks (" + rstats.joinMs + " ms)");
  t.check("the resync moved a real chunked save", rstats.joinChunks >= 2 && rstats.joinBytes > 20000, rstats);

  /* ══════════════ 7. guest drops → host plays on ═════════════════════════ */
  await guest.close();
  await host.waitForFunction(() => window.__FS__.netState().peerHere === false, { timeout: 20000 });
  const afterDrop = await host.evaluate(() => {
    const FS = window.__FS__;
    const t0 = FS.G.tick;
    FS.ff(60);
    return { grew: FS.G.tick - t0, st: FS.netState(),
      note: FS.G.notif.slice(-3).map((n) => n.text).join(" | "),
      ev: FS.events("netPeer").slice(-1)[0] || null };
  });
  t.check("a guest leaving does not stop the host", afterDrop.grew === 60, afterDrop);
  t.check("the host is told the partner left (event + notification)",
    /left/i.test(afterDrop.note) && afterDrop.ev && afterDrop.ev.here === false, afterDrop);
  t.check("the host goes back to waiting for a partner", afterDrop.st.status === "waiting", afterDrop.st);
  await host.close();

  /* ══════════════ 8. separate kingdoms + host drop → continue solo ═══════ */
  const host2 = await mkPage(t.browser, "host2");
  const guest2 = await mkPage(b2, "guest2");
  await bootPage(host2, url(t));
  await bootPage(guest2, url(t));
  await host2.evaluate(() => window.__FS__.hostGame("separate", {
    seed: 31415, size: "medium", ais: 1, code: "ROOM2", speed: 0,
  }));
  await guest2.evaluate(() => window.__FS__.joinGame("ROOM2"));
  await guest2.waitForFunction(() => window.__FS__.netState().status === "playing", { timeout: 25000 });
  const shape = await guest2.evaluate(() => {
    const G = window.__FS__.G;
    return { seats: G.seats.slice(), humans: G.humans, mode: G.mode,
      players: G.players.map((p) => ({ id: p.id, team: p.team, isAI: p.isAI })) };
  });
  t.check("separate kingdoms seat seat-1 onto player 1", shape.seats[1] === 1 && shape.humans === 2, shape);
  t.check("both humans are allies (same team), the AI is not",
    shape.players[0].team === 0 && shape.players[1].team === 0 && shape.players[2].team !== 0, shape.players);

  const sep = await guest2.evaluate(() => {
    const FS = window.__FS__, G = FS.G, FSMap = FS.FSMap;
    const mine = FS.FSSim.castleOf(G, 1), theirs = FS.FSSim.castleOf(G, 0);
    let myV = -1, theirV = -1;
    FSMap.forRadius(G.map, mine.v, 6, (u) => { if (myV < 0 && !FSMap.whyFlag(G.map, u, 1)) myV = u; });
    FSMap.forRadius(G.map, theirs.v, 6, (u) => { if (theirV < 0 && !FSMap.whyFlag(G.map, u, 0) && FSMap.whyFlag(G.map, u, 1)) theirV = u; });
    FS.placeFlag(myV);
    FS.placeFlag(theirV);                       // on the HOST's land — must be refused
    return { myV, theirV, castle0: theirs.id, castle1: mine.id };
  });
  await t.sleep(300);
  await advance(host2, guest2, 30, 25000);
  const sepOut = await host2.evaluate((o) => {
    const FS = window.__FS__;
    const mineId = FS.q.flagAt(o.myV), theirsId = FS.q.flagAt(o.theirV);
    return { mineP: mineId ? FS.G.flags[mineId].p : -1, theirs: theirsId,
      fails: FS.events("cmdFail").filter((e) => e.by === 1).length };
  }, sep);
  t.check("a separate-kingdoms guest builds as PLAYER 1", sepOut.mineP === 1, sepOut);
  t.check("…and cannot command player 0's land (cmdFail)", sepOut.theirs === 0 && sepOut.fails >= 1, sepOut);

  const ally = await guest2.evaluate((o) => {
    const FS = window.__FS__;
    FS.attack(o.castle0, 1);                    // attacking your ally must be refused
    return FS.G.tick;
  }, sep);
  await t.sleep(300);
  await advance(host2, guest2, 20, 25000);
  const allyOut = await host2.evaluate(() => {
    const f = window.__FS__.events("cmdFail").filter((e) => e.cmd === "attack");
    return { n: f.length, why: f.length ? f[f.length - 1].why : "" };
  });
  t.check("humans cannot attack each other (allied)", allyOut.n >= 1 && /ally/i.test(allyOut.why), allyOut);
  const eqSep = await agree(host2, guest2);
  t.check("separate-kingdoms room stays in lockstep", eqSep.ok, eqSep);

  // host drops → guest offered continue-solo, then really plays on
  await host2.close();
  await guest2.waitForFunction(() => window.__FS__.netState().status === "hostLeft", { timeout: 25000 });
  const modal = await guest2.evaluate(() => document.getElementById("hostLeft").classList.contains("on"));
  t.check("the guest is offered 'continue solo' when the host vanishes", modal === true, { modal });
  const frozen = await guest2.evaluate(async () => {
    const t0 = window.__FS__.G.tick;
    await new Promise((r) => setTimeout(r, 500));
    return { t0, t1: window.__FS__.G.tick };
  });
  t.check("…and its clock holds until the player decides", frozen.t1 === frozen.t0, frozen);
  await guest2.click("#soloBtn");
  await t.sleep(150);
  const soloOn = await guest2.evaluate(async () => {
    const FS = window.__FS__;
    const t0 = FS.G.tick;
    FS.setSpeed(2);
    await new Promise((r) => setTimeout(r, 1200));
    const seats = FS.G.seats.slice();
    FS.placeFlag(-1);                              // exercise the local command path
    return { t0, t1: FS.G.tick, seats, st: FS.netState(), hookNull: FS.FSSim.netHook === null };
  });
  t.check("continue-solo detaches the wire", soloOn.st.status === "solo" && soloOn.hookNull, soloOn);
  t.check("…the guest's own sim keeps advancing", soloOn.t1 > soloOn.t0, soloOn);
  t.check("…and its seat still drives ITS OWN kingdom (player 1)",
    soloOn.seats[0] === 1 && soloOn.seats[1] === 1, soloOn);
  await guest2.close();

  /* ══════════════ 9. mid-game join: 3000 ticks, then a partner arrives ═══ */
  const host3 = await mkPage(t.browser, "host3");
  const guest3 = await mkPage(b2, "guest3");
  await bootPage(host3, url(t));
  await bootPage(guest3, url(t));
  await host3.evaluate(() => window.__FS__.hostGame("shared", {
    seed: 777001, size: "medium", ais: 1, code: "ROOM3", speed: 0,
  }));
  await host3.evaluate(() => {
    const FS = window.__FS__;
    // a real settlement, not an empty map: a few flags then a long solo run
    const G = FS.G, FSMap = FS.FSMap, c = FS.FSSim.castleOf(G, 0);
    let n = 0;
    FSMap.forRadius(G.map, c.v, 8, (u) => {
      if (n >= 3) return;
      if (!FSMap.whyFlag(G.map, u, 0)) { FS.placeFlag(u); n++; }
    });
    FS.ff(3000);
  });
  const hostTick3 = await tickOf(host3);
  t.check("host played 3000 ticks alone before the partner arrived", hostTick3 >= 3000, { hostTick3 });
  const tJoin0 = Date.now();
  await guest3.evaluate(() => window.__FS__.joinGame("ROOM3"));
  await guest3.waitForFunction(() => window.__FS__.netState().status === "playing", { timeout: 30000 });
  const tLoaded = Date.now() - tJoin0;
  await guest3.waitForFunction((t) => window.__FS__.G && window.__FS__.G.tick >= t,
    { timeout: 30000, polling: 60 }, hostTick3);
  const tCaught = Date.now() - tJoin0;
  const eq3 = await agree(host3, guest3);
  const st3 = await guest3.evaluate(() => window.__FS__.netStats());
  console.log("   mid-game join: " + st3.joinBytes + " B / " + st3.joinChunks + " chunks transferred in " +
    tLoaded + " ms, caught up to tick " + hostTick3 + " in " + tCaught + " ms total");
  t.check("a mid-game joiner lands on the host's exact state", eq3.ok, eq3);
  t.check("…the transfer was chunked (8 KB frames)", st3.joinChunks >= 2, st3);
  t.check("…and it caught up well inside 10 s", tCaught < 10000, { tLoaded, tCaught });

  // a guest that fell a long way behind (hidden tab / slow join) catches up in
  // capped slices behind the "catching up…" veil, then rejoins the lockstep
  const tCatch0 = Date.now();
  await host3.evaluate(() => window.__FS__.ff(1500));
  let veilSaw = true;
  try {
    await guest3.waitForFunction(() => document.body.classList.contains("fs-catchup"),
      { timeout: 8000, polling: 30 });
  } catch (e) { veilSaw = false; }
  const hostTick4 = await tickOf(host3);
  await guest3.waitForFunction((t) => window.__FS__.G.tick >= t, { timeout: 30000, polling: 40 }, hostTick4);
  const catchMs = Date.now() - tCatch0;
  const st4 = await guest3.evaluate(() => ({
    stats: window.__FS__.netStats(), veil: document.body.classList.contains("fs-catchup"),
    st: window.__FS__.netState(),
  }));
  console.log("   catch-up: 1500 ticks behind → caught up in " + catchMs + " ms (" +
    st4.stats.catchupTicks + " ticks measured)");
  t.check("a far-behind guest shows the 'catching up…' veil", veilSaw, st4);
  t.check("…runs the catch-up in capped slices and clears the veil",
    st4.stats.catchupTicks > 1000 && st4.veil === false, st4.stats);
  const eq3c = await agree(host3, guest3);
  t.check("…and lands exactly on the host's state again", eq3c.ok, eq3c);
  await host3.evaluate(() => window.__FS__.placeFlag(-1));      // harmless invalid command
  await advance(host3, guest3, 150, 30000);
  const eq3b = await agree(host3, guest3);
  t.check("…and play continues in lockstep after the catch-up", eq3b.ok, eq3b);

  /* ══════════════ 10. the co-op screenshot (partner chip + ping) ═════════ */
  await host3.evaluate(() => {
    const FS = window.__FS__, G = FS.G;
    const c = FS.FSSim.castleOf(G, 0);
    FS.FSRender.setCam({ yaw: 0.6, pitch: 0.62, dist: 30 });
    FS.FSRender.focusVertex(c.v, 30);
    FS.ping(c.v);
    FS.paintHud();
  });
  await advance(host3, guest3, 6, 20000);
  await host3.evaluate(() => { for (let i = 0; i < 12; i++) window.__FS__.FSRender.frame(0.033); });
  await t.sleep(400);
  const chip = await host3.evaluate(() => {
    const c = document.getElementById("netChip"), m = document.getElementById("pingMark");
    return { chip: c.textContent, chipHidden: c.classList.contains("hidden"),
      mark: !m.classList.contains("hidden"), cls: c.className };
  });
  t.check("the in-game partner chip names the partner", !chip.chipHidden && /Player|Eleanor|Partner/.test(chip.chip), chip);
  t.check("the ping marker is on screen for the shot", chip.mark === true, chip);
  await t.shot(host3, "farmstead_coop");
  await guest3.close();
  await host3.close();

  /* ══════════════ 11. playroom adapter contract (fake SDK) ══════════════ */
  const pr = await mkPage(t.browser, "playroom");
  await pr.evaluateOnNewDocument(() => {
    // a fake Playroom SDK: the adapter must find it and never fetch the CDN
    const calls = [];
    window.__PR__ = { calls, rpc: [], joined: null, quit: 0 };
    window.myPlayer = () => ({ id: "me", setState: () => {}, getState: () => "" });
    window.isHost = () => true;
    window.getRoomCode = () => "FAKE7";
    window.onPlayerJoin = (fn) => { window.__PR__.joined = fn; };
    window.quitGame = () => { window.__PR__.quit++; };
    window.RPC = {
      Mode: { OTHERS: "others", ALL: "all" },
      register: (name, fn) => { window.__PR__.rpc.push(name); window.__PR__.handler = fn; },
      call: (name, data) => { window.__PR__.calls.push({ name, data }); return Promise.resolve(true); },
    };
    window.insertCoin = (opts) => {
      window.__PR__.insert = { opts: opts, hash: location.hash, when: Date.now() };
      return Promise.resolve({});
    };
  });
  await bootPage(pr, t.BASE + "/farmstead.html?nolobby=1#r=ABC12");
  await pr.waitForFunction(() => window.__PR__ && window.__PR__.insert, { timeout: 20000 });
  const prJoin = await pr.evaluate(() => ({
    insert: window.__PR__.insert, hashNow: location.hash, rpc: window.__PR__.rpc.slice(),
    st: window.__FS__.netState(), sdkFetched: window.FSNet._sdkLoaded(),
  }));
  t.check("a #r= deep link auto-joins that room (insertCoin gets the code + skipLobby)",
    prJoin.insert.opts.roomCode === "ABC12" && prJoin.insert.opts.skipLobby === true &&
    prJoin.insert.opts.maxPlayersPerRoom === 2, prJoin.insert);
  t.check("the hash is CLEARED BEFORE insertCoin runs (house caution)",
    prJoin.insert.hash === "" && prJoin.hashNow === "", prJoin);
  t.check("the adapter registers its RPC channel", prJoin.rpc.indexOf("fs") >= 0, prJoin);
  t.check("a present SDK is never re-fetched from the CDN", prJoin.sdkFetched === false, prJoin);
  const prReq = reqLog.filter((u) => u.startsWith("playroom ") && /unpkg|playroomkit/.test(u));
  t.check("no CDN request while a fake SDK is present", prReq.length === 0, prReq.slice(0, 3));
  const prMsgs = await pr.evaluate(() => {
    const FS = window.__FS__;
    FS.FSNet._inject({ y: "welcome", seat: 1, mode: "shared", hostName: "Dad",
      settings: { seed: 5, size: "small", ais: 1, mode: "shared" }, tick: 0 });
    const st = FS.netState();
    return { st, sent: window.__PR__.calls.length, first: window.__PR__.calls[0] };
  });
  t.check("the guest greets the host over RPC and takes the welcome",
    prMsgs.sent >= 1 && prMsgs.first.name === "fs" && prMsgs.st.peerName === "Dad", prMsgs);
  await pr.close();

  // failure path: no SDK reachable (CDN blocked) → friendly note, page still alive.
  // NOTE: no ?nolobby here — a failed host must not reach the lobby code at all.
  const pr2 = await mkPage(t.browser, "playroom-fail");
  await bootPage(pr2, t.BASE + "/farmstead.html");
  const failSt = await pr2.evaluate(() => window.__FS__.hostGame("shared", { seed: 9, size: "small", ais: 1 }));
  t.check("an unreachable Playroom falls back to solo, never a blank page",
    failSt.status === "failed" && failSt.role === null, failSt);
  const stillPlays = await pr2.evaluate(() => {
    const FS = window.__FS__;
    const t0 = FS.G ? FS.G.tick : -1;
    FS.ff(30);
    return { started: FS.started(), t0, t1: FS.G.tick, hook: FS.FSSim.netHook === null,
      note: document.getElementById("bmode").textContent };
  });
  t.check("…the solo world it started is fully playable",
    stillPlays.started && stillPlays.t1 === stillPlays.t0 + 30 && stillPlays.hook, stillPlays);
  t.check("…and the player is told in plain words", /solo/i.test(stillPlays.note), stillPlays.note);
  const soloHide = await pr2.evaluate(async () => {
    const FS = window.__FS__;
    FS.setSpeed(1);
    await new Promise((r) => setTimeout(r, 120));
    Object.defineProperty(document, "hidden", { get: () => true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 200));
    const paused = FS.G.speed;
    Object.defineProperty(document, "hidden", { get: () => false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 200));
    return { paused, back: FS.G.speed };
  });
  t.check("solo still auto-pauses when its tab hides (and resumes)",
    soloHide.paused === 0 && soloHide.back === 1, soloHide);

  /* ══════════════ 12. family lobby doc shape (Firestore is blocked here) ═ */
  const lobby = await pr2.evaluate(async () => {
    const FSNet = window.FSNet;
    const wrote = [];
    FSNet._lobbyLoader = function () {
      return Promise.resolve({
        db: { fake: 1 },
        fs: {
          doc: (db, col, id) => ({ path: col + "/" + id, id: id }),
          setDoc: (ref, data, o) => { wrote.push({ ref: ref.path, data: data, merge: !!o }); return Promise.resolve(); },
          deleteDoc: (ref) => { wrote.push({ del: ref.path }); return Promise.resolve(); },
        },
      });
    };
    const ok = await FSNet._lobby.ensure();
    return { ok, wrote, key: FSNet._lobby.key(), st: FSNet._lobby.state() };
  });
  t.check("the lobby module is a no-op unless we are really hosting", lobby.ok === false && lobby.wrote.length === 0, lobby);
  const lobby2 = await pr2.evaluate(async () => {
    const FSNet = window.FSNet;
    const wrote = [];
    window.__wrote = wrote;
    FSNet._lobby.reset();
    FSNet._lobbyLoader = function () {
      return Promise.resolve({
        db: {}, fs: {
          doc: (db, col, id) => ({ path: col + "/" + id, id: id }),
          setDoc: (ref, data, o) => { wrote.push({ ref: ref.path, data: data, merge: !!o }); return Promise.resolve(); },
          deleteDoc: (ref) => { wrote.push({ del: ref.path }); return Promise.resolve(); },
        },
      });
    };
    const ok = await FSNet._lobby.ensure({ force: true, code: "ZZZ99", mode: "shared", name: "Dad" });
    await FSNet._lobby.update({ playerCount: 2, status: "started" });
    await FSNet._lobby.remove();
    return { ok, wrote, key: FSNet._lobby.key(), st: FSNet._lobby.state() };
  });
  const doc0 = lobby2.wrote[0] || {};
  t.check("hosting registers lobbies_<familyKey>/fst_<code>",
    lobby2.ok === true && /^lobbies_fam.*\/fst_ZZZ99$/.test(doc0.ref || ""), lobby2.wrote);
  t.check("…with the games.html card fields (game/ico/host/status/count)",
    doc0.data && doc0.data.game === "farmstead" && doc0.data.ico === "🏰" &&
    doc0.data.gameName === "Farmstead" && doc0.data.maxPlayers === 2 &&
    doc0.data.status === "open" && doc0.data.playerCount === 1 && doc0.data.roomCode === "ZZZ99",
    doc0.data);
  t.check("…live updates and a pagehide delete are wired",
    lobby2.wrote.length === 3 && lobby2.wrote[1].data.playerCount === 2 && !!lobby2.wrote[2].del, lobby2.wrote);
  const lobbyReq = reqLog.filter((u) => /gstatic|firebase|googleapis/.test(u));
  t.check("no Firestore request ever left the page in this suite", lobbyReq.length === 0, lobbyReq.slice(0, 4));
  await pr2.close();

  /* ══════════════ 13. wrap up ═══════════════════════════════════════════ */
  console.log("   relay: " + relay.conns + " connections, " + relay.msgs + " messages, " +
    (relay.bytes / 1024).toFixed(1) + " KB");
  for (const p of close) { try { await p.close(); } catch (e) {} }
  await b2.close().catch(() => {});
  relay.wss.close();
  t.check("the only blocked-request noise came from the deliberate CDN test",
    blocked.every((b) => b.startsWith("playroom-fail")), blocked.slice(0, 5));
  t.check("0 page errors across every page", errors.length === 0, errors.slice(0, 8));
});
