#!/usr/bin/env node
"use strict";
/**
 * FARMSTEAD — Phase E UI suite.
 * Drives the REAL fs-ui.js overlay via page.click/tap on stable selectors —
 * never bypasses the UI to call __FS__ directly except for scripted SETUP
 * (planting a nearby enemy hut, fast-forwarding, etc, exactly like the
 * military suite's T.* helpers) and the odd ff().
 *
 *   node tools/_verify-farmstead-ui.cjs
 */
const H = require("./_fs_harness.cjs");

/* Helpers injected once per page; mirrors tools/_verify-farmstead-military.cjs's
 * T.* pattern (own copy — suites are self-contained, no cross-file sharing). */
const HELPERS = function () {
  const FS = window.__FS__;
  const T = {};
  window.T = T;
  const FSC = FS.FSC, FSMap = FS.FSMap, FSSim = FS.FSSim, FSMil = FS.FSMil;

  T.fresh = function (o) {
    FS.newGame(Object.assign({ size: "medium", seed: 4242, ais: 1, speed: 0, aiPlan: false }, o || {}));
    return FS.G;
  };
  T.castle = function (p) { return FSSim.castleOf(FS.G, p || 0); };
  T.cflag = function (p) { return FS.G.flags[T.castle(p || 0).flag]; };

  T.plant = function (type, v, p, opts) {
    opts = opts || {};
    const G = FS.G, map = G.map;
    const grant = [];
    FSMap.forRadius(map, v, opts.grant === undefined ? 2 : opts.grant, (u) => { grant.push([u, map.owner[u]]); map.owner[u] = p; });
    const r = FSSim.build(G, type, v, p);
    if (!r.ok) { for (let i = 0; i < grant.length; i++) map.owner[grant[i][0]] = grant[i][1]; return null; }
    const b = G.buildings[r.id];
    if (opts.finish !== false) FSSim.forceComplete(G, b.id);
    return b;
  };
  T.spotsNear = function (type, from, dMin, dMax, p, skip, opts) {
    const G = FS.G, map = G.map, out = [];
    opts = opts || {};
    FSMap.forRadius(map, from, dMax, (u, d) => {
      if (d < dMin) return;
      if (skip && skip.some((w) => FSMap.dist(map, w, u) < 3)) return;
      /* Never stage on ground an ENEMY TEAM holds: ownership is only lent for
       * the terrain test, so a spot inside a rival border used to pass and the
       * conquest cascade then burned the freshly planted building down.
       * (Mirrors the military suite's helper — this file is self-contained.)
       * `anyGround` opts out for the panel tests, which deliberately want a
       * RIVAL's workshop standing on our doorstep: a workshop claims nothing,
       * so nothing burns and the panel has something enemy to describe. */
      const ow = map.owner[u];
      if (!opts.anyGround && ow >= 0 && ow !== p && G.players[ow] && G.players[p]
        && G.players[ow].team !== G.players[p].team) return;
      const own = map.owner[u], ring = [];
      FSMap.forRadius(map, u, 2, (w) => { ring.push([w, map.owner[w]]); map.owner[w] = p; });
      const ok = FSMap.canPlaceBuilding(map, type, u, p);
      for (let i = 0; i < ring.length; i++) map.owner[ring[i][0]] = ring[i][1];
      map.owner[u] = own;
      if (ok) out.push([u, d]);
    });
    out.sort((a, b) => (Math.abs(a[1] - dMin) - Math.abs(b[1] - dMin)) || (a[0] - b[0]));
    return out.map((e) => e[0]);
  };
  T.spotNear = function (type, from, dMin, dMax, p, skip, opts) {
    const list = T.spotsNear(type, from, dMin, dMax, p, skip, opts);
    return list.length ? list[0] : -1;
  };
  T.garrison = function (b, ranks) { b.mil.knights = ranks.slice(); FSMil.onGarrisonChange(FS.G, b); return b; };
  T.freeFlagSpot = function (p, from, r) {
    const G = FS.G, map = G.map;
    let out = -1;
    FSMap.forRadius(map, from, r || 8, (u) => { if (out < 0 && map.owner[u] === p && !FSMap.whyFlag(map, u, p)) out = u; });
    return out;
  };
  /** Join a vertex to a player's network (mirrors the military suite's T.connect —
   *  own copy, this file is self-contained). Used to "fix the route" for the
   *  idle-alert QoL test. */
  T.connect = function (toV, p) {
    p = p || 0;
    const G = FS.G;
    const cf = T.cflag(p);
    if (FSSim.hops(G, cf.id, G.map.flagAt[toV] || -1) >= 0) return true;
    const cands = [];
    for (const id in G.flags) {
      const f = G.flags[id];
      if (f.p !== p || f.roads.length >= 6) continue;
      if (f.id !== cf.id && FSSim.hops(G, f.id, cf.id) < 0) continue;
      cands.push([f, FSMap.dist(G.map, f.v, toV)]);
    }
    cands.sort((a, b) => (a[1] - b[1]) || (a[0].id - b[0].id));
    for (let c = 0; c < cands.length && c < 8; c++) {
      const from = cands[c][0];
      const path = FSSim.roadPath(G, from.v, toV, p, { maxLen: 400, maxNodes: 60000 });
      if (!path) continue;
      const STEP = 8, LAST = path.length - 3;
      let cur = from, curIdx = 0, ok = true;
      for (let i = STEP; i <= LAST; i += STEP) {
        let j = i;
        while (j <= LAST && FSMap.whyFlag(G.map, path[j], p)) j++;
        if (j > LAST) break;
        const nf = FSSim.placeFlag(G, path[j], p);
        if (!nf.ok) { ok = false; break; }
        const r = FSSim.buildRoad(G, cur.id, nf.id, path.slice(curIdx, j + 1), p);
        if (!r.ok) { FSSim.removeFlag(G, nf.id); ok = false; break; }
        cur = nf.flag; curIdx = j; i = j;
      }
      if (!ok) continue;
      let fid = G.map.flagAt[toV];
      if (!fid) { const nf = FSSim.placeFlag(G, toV, p); if (!nf.ok) continue; fid = nf.id; }
      if (FSSim.buildRoad(G, cur.id, fid, path.slice(curIdx), p).ok) return true;
    }
    return false;
  };
  return true;
};

/* ─────────────────────────── DOM interaction helpers ─────────────────────── */
async function bootPage(t, vp) {
  const page = await t.newPage(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String((e && e.stack) || e)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
  await page.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSUI, { timeout: 20000 });
  page.__errs = errs;
  return page;
}
async function startViaUI(page) {
  await page.click("#startBtn");
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 20000 });
  await sleep(300);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
/** Real click at a vertex's projected screen position (mouse — desktop path). */
async function clickVertex(page, v) {
  const s = await page.evaluate((vv) => window.__FS__.FSRender.vertexScreen(vv), v);
  await page.mouse.move(s.x, s.y);
  await sleep(40);
  await page.mouse.down();
  await sleep(20);
  await page.mouse.up();
  return s;
}
/** Real TOUCH tap at a vertex's projected screen position (mobile path). */
async function tapVertex(page, v) {
  const s = await page.evaluate((vv) => window.__FS__.FSRender.vertexScreen(vv), v);
  await page.touchscreen.tap(s.x, s.y);
  return s;
}
/** Real TOUCH tap at a DOM element's center (mobile path for buttons/chrome). */
async function tapEl(page, sel) {
  const r = await page.evaluate((s) => {
    const b = document.querySelector(s).getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }, sel);
  await page.touchscreen.tap(r.x, r.y);
  return r;
}
async function hoverVertex(page, v) {
  await page.evaluate((vv) => window.__FS__.FSRender.setHover(vv), v);
}
/**
 * Drive the page's own frame loop by hand.
 * requestAnimationFrame is heavily starved in this headless/SwiftShader setup —
 * measured 0 callbacks in most 500ms windows on a loaded machine — so anything
 * that only happens per FRAME (the camera glide, FSUI's event pollers, the
 * ≤4Hz panel refresh) can simply never run inside a sleep(). This calls exactly
 * what farmstead.html's loop() calls, in the same order, so the checks below
 * test the real code path without betting on the compositor. dt 0.3 also clears
 * FSUI's 0.25s accumulator, so the ≤4Hz block runs on every pump.
 */
async function pumpUI(page, n, dt) {
  await page.evaluate((args) => {
    for (let i = 0; i < args.n; i++) {
      window.__FS__.FSRender.frame(args.dt);
      if (window.__FS__.started() && window.FSUI) window.FSUI.frame(args.dt);
    }
  }, { n: n || 3, dt: dt === undefined ? 0.3 : dt });
}

H.run("farmstead-ui", async (t) => {
  /* ══════════════════════════ 1. title screen → start flow ═══════════════ */
  const page = await bootPage(t);
  const title = await page.evaluate(() => ({
    titleVisible: !document.getElementById("title").classList.contains("hidden"),
    supDefault: document.getElementById("supVal").textContent,
    continueHidden: document.getElementById("continueBtn").classList.contains("hidden"),
    hasHowTo: !!document.getElementById("howToPlayLink"),
  }));
  t.check("title screen visible before start", title.titleVisible);
  t.check("supplies stepper defaults to FSC.SUPPLIES_DEFAULT (25)", title.supDefault === "25", title.supDefault);
  t.check("no Continue button before any autosave exists", title.continueHidden === true, title);
  t.check("How-to-play link present", title.hasHowTo);

  // supplies stepper +/- via real clicks
  await page.click("#supPlus"); await page.click("#supPlus");
  await page.click("#supMinus");
  const supAfter = await page.evaluate(() => document.getElementById("supVal").textContent);
  t.check("supplies stepper responds to +/- clicks (25+5+5-5=30)", supAfter === "30", supAfter);

  // How-to-play opens the Help sheet even before a game exists
  await page.click("#howToPlayLink");
  await sleep(150);
  const preHelp = await page.evaluate(() => ({
    open: !document.getElementById("fsSheetWrap").classList.contains("hidden"),
    title: document.getElementById("fsSheetTitle").textContent,
  }));
  t.check("How-to-play opens the Help sheet from the title screen", preHelp.open && /Help/.test(preHelp.title), preHelp);
  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(100);

  await startViaUI(page);
  const afterStart = await page.evaluate(() => ({
    titleHidden: document.getElementById("title").classList.contains("hidden"),
    rootVisible: !document.getElementById("fsui-root").classList.contains("hidden"),
    tick: window.__FS__.G.tick,
    supplies: window.__FS__.q.invOf(0).plank,   // supplies=30 → non-default plank stock
  }));
  t.check("START hides the title, shows the real HUD", afterStart.titleHidden && afterStart.rootVisible, afterStart);
  t.check("sim is ticking", afterStart.tick >= 0, afterStart.tick);
  await page.evaluate(() => window.__FS__.setSpeed(0));
  await page.evaluate(HELPERS);

  /* ══════════════════════════ 2. build a hut fully through the UI ════════ */
  const hutSetup = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    T.fresh({ speed: 0 });
    const c = T.castle();
    let v = -1;
    FSMap.forRadius(FS.G.map, c.v, 9, (u, d) => { if (v < 0 && d >= 3 && FSMap.canPlaceBuilding("hut", u, 0)) v = u; });
    /* RESTAGED 2026-08-01: this staged a yaw of 0.6, which Fork B's lock quietly
     * overruled to 0. With the yaw free again the camera really does turn, the
     * target vertex swings across the screen, and on the PHONE viewport the tap
     * could land on the build panel instead of the map. Centre on the TARGET —
     * which is what a player does before placing anyway — not on the castle. */
    FS.FSRender.setCam({ yaw: 0.6, pitch: 0.85, dist: 30 });
    FS.FSRender.focusVertex(v >= 0 ? v : c.v, 30);
    FS.FSRender.frame(0.016);
    return { v };
  });
  await hoverVertex(page, hutSetup.v);
  await page.click("#fsDockBuild");
  await sleep(120);
  await page.click('#fsBuildTabs [data-tab="military"]');
  await sleep(80);
  const ghostBefore = await page.evaluate(() => window.__FS__.FSRender.suitabilityOn());
  await page.click('#fsBuildGrid [data-type="hut"]');
  await sleep(120);
  const armed = await page.evaluate(() => ({
    mode: window.__FS__.mode(),
    armedClass: document.querySelector('#fsBuildGrid [data-type="hut"]').classList.contains("armed"),
    suitOn: window.__FS__.FSRender.suitabilityOn(),
  }));
  t.check("picking a build item arms build mode", armed.mode === "build", armed);
  t.check("the build item shows as armed", armed.armedClass, armed);

  /* ═══ WHAT DOES THIS BUILDING DO? (playtest 2026-08-02) ══════════════════
   * A detail strip under the grid — the game is played on an iPad and a finger
   * has no hover state, so the information attaches to SELECTING a card.
   * Its height is FIXED and that is load-bearing: the panel is anchored to the
   * bottom of the screen, so a strip that grew when you pointed at a card slid
   * every card upward between the pointerover and the click. The assertion
   * that keeps that honest is that nothing CLIPS inside the fixed box, for
   * every building in the menu, at this viewport (and the phone one below). */
  const info = await page.evaluate(() => {
    const FSC = window.__FS__.FSC;
    const box = document.getElementById("fsBuildInfo");
    const armedText = box.textContent;
    const geom = { h: box.getBoundingClientRect().height };
    const clipped = [];
    let missing = 0, tooLong = 0;
    const wide = [];
    for (const k of FSC.BLD_LIST) {
      if (k === "castle") continue;
      if (!FSC.BLD_DESC[k]) { missing++; continue; }
      if (FSC.BLD_DESC[k].split(/\s+/).length > 12) tooLong++;
      window.FSUI.buildInfoFor(k);
      if (box.scrollHeight > box.clientHeight) clipped.push([k, box.scrollHeight, box.clientHeight]);
      /* ADDED with the 2026-08-02 medieval re-skin. The strip is
         overflow:hidden in BOTH axes, but only the vertical one was ever
         measured — so when the head row grew (a serif name beside the
         cost) the phone silently ate the end of the price, "…1 sto", and
         the suite stayed green. The price is the reason the line exists. */
      if (box.scrollWidth > box.clientWidth + 1) wide.push([k, box.scrollWidth, box.clientWidth]);
    }
    window.FSUI.buildInfoFor(null);
    const gridBefore = document.getElementById("fsBuildGrid").getBoundingClientRect().top;
    window.FSUI.buildInfoFor("fortress");             // a long one
    const gridAfter = document.getElementById("fsBuildGrid").getBoundingClientRect().top;
    return { armedText, geom, clipped, wide, missing, tooLong, shift: Math.abs(gridAfter - gridBefore) };
  });
  t.check("the armed card's info strip says what it does and what it costs",
    /Guard Hut/.test(info.armedText) && /knights hold/.test(info.armedText) && /1 plank/.test(info.armedText), info.armedText);
  t.check("every building in the menu has a description", info.missing === 0, info.missing);
  t.check("…each of them a dozen words or fewer", info.tooLong === 0, info.tooLong);
  t.check("…and none of them clips inside the fixed-height strip", info.clipped.length === 0, info.clipped);
  t.check("…nor runs off its right-hand edge (the cost must stay readable)", info.wide.length === 0, info.wide);
  t.check("filling the strip never moves a build card", info.shift === 0, info.shift);
  /* QoL#2 SUPERSEDED by the 2026-08-01 playtest: the overlay used to appear
   * only once a TYPE was armed, and it could then outlive placement mode. It
   * is now a pure function of the mode — on the moment you enter placement
   * (which is what `ghostBefore` sees), filtered as soon as a type is picked,
   * and off again the moment placement ends. The auto-on/auto-off contract is
   * proven end to end in the placement-flow section at the foot of this file. */
  t.check("the suitability overlay is on throughout placement mode",
    armed.suitOn === true && ghostBefore === true, armed);

  /* ══════ THE MEDIEVAL SKIN (2026-08-02) ═══════════════════════════════════
   * The re-skin changed no interaction — everything above and below this block
   * is unchanged and still passing. What is asserted here is the three things
   * a re-skin can silently get wrong, all of which it DID get wrong once:
   *   1. the materials are generated at all (fs-skin.js is a head script, and
   *      a throw in it would leave every panel on its flat fallback colour);
   *   2. every material TILES — a later rule that sets one background-image on
   *      a surface whose recipe declared five layers inherits the FIRST
   *      background-repeat, `no-repeat`, and paints a single 128 px square of
   *      parchment in the corner. That is what the context panel did;
   *   3. text still clears WCAG AA on its own surface. The charm is not
   *      allowed to cost the legibility of a number or a cost. */
  // a notice has to be on screen for its own contrast to be measurable
  await page.evaluate(() => { window.FSUI.toast("A new settler has come of age."); window.FSUI.frame(0.016); });
  await sleep(120);
  const skin = await page.evaluate(() => {
    const S = window.FSSkin || {};
    const q = (sel) => document.querySelector(sel);
    const cs = (sel) => { const e = q(sel); return e ? getComputedStyle(e) : null; };
    /* the material is always the LAST background layer in every recipe */
    function tiles(sel) {
      const st = cs(sel);
      if (!st) return { sel, ok: false, why: "element not present" };
      const layers = (st.backgroundImage.match(/url\(/g) || []).length;
      if (!layers) return { sel, ok: false, why: "no background image" };
      const reps = st.backgroundRepeat.split(",").map((s) => s.trim());
      const last = reps[Math.min(reps.length - 1, layers - 1)];
      return { sel, ok: /repeat/.test(last) && last !== "no-repeat", why: last, layers };
    }
    const surfaces = ["#fsBuildPanel", "#fsContext", "#fsMenu", "#fsDock", "#fsSpeed",
      "#fsMinimap", "#fsBuildInfo", "#fsBuildGrid", ".tick-item", ".rate-item",
      ".build-item", "#fsDockSelect", ".fs-tab"];
    const notTiled = surfaces.map(tiles).filter((r) => !r.ok);

    /* nothing in the skin may reach the network — the game is offline-capable */
    const offOrigin = [];
    document.querySelectorAll("*").forEach((el) => {
      const bi = getComputedStyle(el).backgroundImage;
      if (/url\((["']?)(?!data:)https?:/.test(bi)) offOrigin.push(el.id || el.className);
    });

    /* WCAG contrast on the surfaces that carry numbers and costs */
    function lum(c) {
      const m = c.match(/[\d.]+/g).map(Number);
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
    }
    function ratio(fg, bg) {
      const a = lum(fg), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    function pair(sel, bgSel) {
      const f = cs(sel), b = cs(bgSel || sel);
      if (!f || !b) return null;                            // not on screen in this state
      return { sel, r: +ratio(f.color, b.backgroundColor).toFixed(2) };
    }
    const contrast = [
      pair(".tick-item"),                                   // stock figures
      pair(".rate-item"),                                   // rate figures
      pair(".build-item"),                                  // card name + cost
      pair("#fsBuildInfo"),                                 // the description strip
      pair(".fs-toast"),                                    // notices
      pair("#fsDockSelect b", "#fsDockSelect"),             // tool names, 9.5 px
      pair("#fsMenu button", "#fsMenu"),                    // the steward's list
    ].filter(Boolean);
    return {
      ready: !!S.ready, err: S.error, tex: Object.keys(S.tex || {}),
      attr: document.documentElement.getAttribute("data-fs-skin"),
      notTiled, offOrigin, contrast,
      worst: contrast.reduce((a, c) => (c.r < a.r ? c : a), contrast[0]),
    };
  });
  t.check("skin: every material generated (oak, parchment, stone, linen, stud, rope)",
    skin.ready && skin.tex.length === 8 && skin.attr === "1", { ready: skin.ready, tex: skin.tex, err: skin.err });
  t.check("skin: every skinned surface TILES its material", skin.notTiled.length === 0, skin.notTiled);
  t.check("skin: nothing reaches the network for a texture", skin.offOrigin.length === 0, skin.offOrigin);
  t.check("skin: every figure and label clears WCAG AA (4.5:1) on its own surface",
    skin.worst.r >= 4.5, skin.contrast);

  /* the greyed card is the one state a re-skin must not blur: it has to read
     as FADED, and it has to stay legible and clickable (playtest §2). */
  /* ONE card, read in BOTH states — an earlier version of this probe compared
     two selectors that happened to resolve to the same element (whether a card
     is really `.bad` depends on what the player can afford at this tick), so it
     compared a card with itself and reported no difference. */
  const chalk = await page.evaluate(() => {
    const grid = document.getElementById("fsBuildGrid");
    const card = grid.querySelector(".build-item:not(.armed)");
    const had = card.classList.contains("bad");
    function sat(c) { const m = c.match(/[\d.]+/g).map(Number); return Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2]); }
    card.classList.remove("bad");
    let s = getComputedStyle(card);
    const okBg = s.backgroundColor, okInk = s.color, okOpacity = +s.opacity;
    card.classList.add("bad");
    s = getComputedStyle(card);
    const badBg = s.backgroundColor, badInk = s.color, badOpacity = +s.opacity;
    const clickable = s.pointerEvents !== "none";
    if (!had) card.classList.remove("bad");     // the ≤4Hz beat owns this class
    return {
      okBg, badBg, okInk, badInk, okOpacity, badOpacity, clickable,
      drainedSurface: sat(badBg) < sat(okBg),
      drainedInk: sat(badInk) < sat(okInk),
      faded: badOpacity < okOpacity,
    };
  });
  t.check("skin: an unaffordable card reads as CHALKED — surface AND ink drained, then faded",
    chalk.drainedSurface && chalk.drainedInk && chalk.faded && chalk.badOpacity > 0.5, chalk);
  t.check("skin: …and it is still clickable (you may start a site you cannot yet pay for)",
    chalk.clickable, chalk);
  /* two facts, one card: "in my hand" and "too dear" are independent, so an
     armed card that you cannot afford must keep its seal and only take the
     fade. Source order alone had .bad overwriting .armed. */
  const armedPoor = await page.evaluate(() => {
    const grid = document.getElementById("fsBuildGrid");
    const card = grid.querySelector(".build-item.armed") || grid.querySelector(".build-item");
    const hadBad = card.classList.contains("bad"), hadArm = card.classList.contains("armed");
    card.classList.add("armed"); card.classList.remove("bad");
    const armedBg = getComputedStyle(card).backgroundColor;
    card.classList.add("bad");
    const s = getComputedStyle(card);
    const bothBg = s.backgroundColor, bothOpacity = +s.opacity;
    if (!hadBad) card.classList.remove("bad");
    if (!hadArm) card.classList.remove("armed");
    return { armedBg, bothBg, bothOpacity, sealKept: armedBg === bothBg };
  });
  t.check("skin: an ARMED card you cannot afford keeps its seal and only takes the fade",
    armedPoor.sealKept && armedPoor.bothOpacity < 1, armedPoor);

  await clickVertex(page, hutSetup.v);
  await sleep(300);
  const hutPlaced = await page.evaluate((v) => {
    const FS = window.__FS__;
    const id = FS.q.bldAt(v);
    return { id, type: id ? FS.G.buildings[id].type : null, mode: FS.mode() };
  }, hutSetup.v);
  t.check("clicking the ghost places the site in G", hutPlaced.id > 0 && hutPlaced.type === "hut", hutPlaced);
  /* QoL#5's "build mode stays armed after placing" is SUPERSEDED by the
   * 2026-08-01 playtest: placing a building now hands you the ROAD tool with
   * that building's own flag already picked, because place-then-connect is the
   * rhythm this game is made of. (The road-mode arm and its seeded start are
   * asserted in the placement-flow section at the foot of this file.) */
  t.check("placing a building hands you the road tool, not the build tool again",
    hutPlaced.mode === "road", hutPlaced);

  /* SUPERSEDED 2026-08-02: QoL#1's "🛤 Connect to your road network?" chip is
   * GONE, offer and all. It predates the road tool arming itself; once placing
   * a building hands you that tool with its own door flag already picked, a
   * floating panel asking whether you would like a road is a second answer to a
   * question the game has already answered, sitting over the map while you are
   * trying to click the far end. What is asserted now is that it really is gone
   * — element, wording and handlers — and that the flow it duplicated still
   * works, which the check above already proves (mode === "road"). */
  await sleep(200);
  await pumpUI(page, 2);
  const chip = await page.evaluate(() => ({
    el: !!document.getElementById("fsConnectChip"),
    wording: document.getElementById("fsui-root").innerHTML.indexOf("Connect to your road network") >= 0,
    roadFrom: window.FSUI.roadFrom(),
  }));
  t.check("the auto-connect chip is gone from the DOM", chip.el === false, chip);
  t.check("…and its wording with it", chip.wording === false, chip);
  t.check("…and the road tool is still seeded at the new building's own flag",
    chip.roadFrom > 0, chip);

  // sticky flags: place two flags in a row without re-entering flag mode
  await page.click("#fsDockFlag");
  await sleep(100);
  const flagSpots = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    const c = T.castle();
    const out = [];
    // well-separated spots (>=3 lattice steps apart) so placing #0 can never
    // invalidate #1 via the "flag too close" adjacency rule
    FSMap.forRadius(FS.G.map, c.v, 9, (u) => {
      if (out.length >= 2 || FSMap.whyFlag(FS.G.map, u, 0)) return;
      if (out.some((w) => FSMap.dist(FS.G.map, w, u) < 3)) return;
      out.push(u);
    });
    return out;
  });
  await clickVertex(page, flagSpots[0]);
  await sleep(150);
  const modeAfterFlag1 = await page.evaluate(() => window.__FS__.mode());
  await clickVertex(page, flagSpots[1]);
  await sleep(150);
  const twoFlags = await page.evaluate((spots) => ({
    f0: window.__FS__.q.flagAt(spots[0]), f1: window.__FS__.q.flagAt(spots[1]),
    mode: window.__FS__.mode(),
  }), flagSpots);
  t.check("QoL#5 sticky modes: two flags placed without re-entering flag mode",
    modeAfterFlag1 === "flag" && twoFlags.f0 > 0 && twoFlags.f1 > 0 && twoFlags.mode === "flag", { modeAfterFlag1, twoFlags });
  await page.click("#fsDockSelect");
  await sleep(80);

  /* ══════════════════════════ 3. road via the UI between two flags ═══════ */
  const roadSetup = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    const cf = T.cflag();
    /* …and LOOK AT IT first. The section before this one left the camera framed
     * on a hut plot nine steps away; on the 2026-08-02 board that put the far
     * end of this road out near the edge of the viewport, where a projected
     * click resolves to a neighbouring vertex and the flag lands one step off.
     * Centring on the flag you are starting from is what a player does. */
    FS.FSRender.focusVertex(cf.v, 26);
    FS.FSRender.frame(0.016);
    let v = -1;
    /* RESTAGED 2026-08-02: take the SHORTEST road, not the first legal vertex
     * in row-major order. Two flags were just planted next door and the board
     * is a different shape, so "first found" handed this a long detour the UI
     * could not lay inside the check's own click budget — the same lesson
     * T.flagSpot learned when construction started felling trees. */
    let best = 1e9;
    FSMap.forRadius(FS.G.map, cf.v, 6, (u) => {
      if (FSMap.whyFlag(FS.G.map, u, 0)) return;
      const p2 = FS.FSSim.roadPath(FS.G, cf.v, u, 0);
      if (p2 && p2.length < best) { best = p2.length; v = u; }
    });
    return { cfv: cf.v, cfid: cf.id, v, pathLen: best };
  });
  await page.click("#fsDockRoad");
  await sleep(80);
  await clickVertex(page, roadSetup.cfv);
  await sleep(120);
  const roadPreviewInfo = await page.evaluate(() => ({ mode: window.__FS__.mode() }));
  await hoverVertex(page, roadSetup.v);
  await sleep(200);   // let the throttled hover-driven road preview compute
  await clickVertex(page, roadSetup.v);
  await sleep(250);
  const roadResult = await page.evaluate((o) => {
    const FS = window.__FS__;
    const fid2 = FS.q.flagAt(o.v);
    return { road: FS.q.roadBetween(o.cfid, fid2), mode: FS.mode(), fid2 };
  }, roadSetup);
  t.check("road mode arms on click", roadPreviewInfo.mode === "road", roadPreviewInfo);
  t.check("a road is built between the two flags via UI clicks", roadResult.road > 0, { roadResult, roadSetup });
  t.check("QoL#5: road mode stays armed after confirming (sticky)", roadResult.mode === "road", roadResult);
  await page.click("#fsDockSelect");
  await sleep(80);

  console.log("   …section 1-3 done, continuing…");

  /* ══════════════════════════ 4. speed control (headline feature) ════════
   * Timed ENTIRELY inside the browser (one performance.now()..setTimeout..
   * performance.now() per sample) so Node-side IPC round-trip jitter never
   * pollutes the sampling window. DIAGNOSED (scratchpad diag_speed.cjs):
   * this headless SwiftShader renderer only sustains ~7fps, and the sim's
   * accumulator (acc += dtReal*speed, drained in whole TICK_S=0.1s steps)
   * only gets ONE deposit per rendered frame — so a short 1.5s window is
   * just ~10 frames, and because ticks/frame is quantized (1 or 2 at 1×)
   * that is too few samples for the fractional carry-over to average out;
   * a 4s cumulative measurement independently confirmed 9.74 ticks/s
   * (≈2.6% off the theoretical 10). Widened to 3s/sample (deviation from
   * the brief's suggested "1.5s" — documented) + a real warm-up sample
   * (not thrown away, just extends the settle time) fixes it outright. */
  await page.evaluate(() => { window.T.fresh({ speed: 1 }); });
  await page.waitForFunction(() => window.__FS__.FSRender.stats().frames > 20, { timeout: 10000 });
  await sleep(800);
  async function measureRate(ms) {
    return page.evaluate((dur) => new Promise((resolve) => {
      const FS = window.__FS__;
      const t0 = FS.G.tick, w0 = performance.now();
      setTimeout(() => {
        const t1 = FS.G.tick, w1 = performance.now();
        resolve((t1 - t0) / ((w1 - w0) / 1000));
      }, dur);
    }), ms);
  }
  const rate1x = await measureRate(3000);

  await page.click('#fsSpeed [data-speed="2"]');
  await sleep(60);
  const onClass2 = await page.evaluate(() => document.querySelector('#fsSpeed [data-speed="2"]').classList.contains("on"));
  const rate2x = await measureRate(3000);

  await page.click('#fsSpeed [data-speed="4"]');
  await sleep(60);
  const rate4x = await measureRate(3000);

  t.check("clicking 2× reflects .on state", onClass2 === true, onClass2);
  t.check("2× runs the sim at ≈2× the 1× baseline (±25%)",
    Math.abs(rate2x / rate1x - 2) < 0.25 * 2, { rate1x, rate2x, ratio: rate2x / rate1x });
  t.check("4× runs the sim at ≈4× the 1× baseline (±25%)",
    Math.abs(rate4x / rate1x - 4) < 0.25 * 4, { rate1x, rate4x, ratio: rate4x / rate1x });

  await page.click('#fsSpeed [data-speed="0"]');
  await sleep(60);
  const pausedOn = await page.evaluate(() => document.querySelector('#fsSpeed [data-speed="0"]').classList.contains("on"));
  const pa = await page.evaluate(() => window.__FS__.G.tick);
  await sleep(500);
  const pb = await page.evaluate(() => window.__FS__.G.tick);
  t.check("pause button freezes the tick", pausedOn && pa === pb, { pausedOn, pa, pb });

  await page.keyboard.press("Space");
  /* WAIT for the loop to deliver frames rather than assume a fixed number
   * arrive in 500ms: rAF is starved in this headless setup (see pumpUI), so on
   * a loaded machine two 400ms samples can legitimately land inside the SAME
   * frame and read equal. The assertion below is unchanged — this only stops
   * it reporting the renderer's frame rate as a sim bug. */
  await page.waitForFunction((t0) => window.__FS__.G.tick > t0, { timeout: 15000 }, pa).catch(() => {});
  const resumedTick0 = await page.evaluate(() => window.__FS__.G.tick);
  await page.waitForFunction((t0) => window.__FS__.G.tick > t0, { timeout: 15000 }, resumedTick0).catch(() => {});
  const resumedTick1 = await page.evaluate(() => window.__FS__.G.tick);
  t.check("Space resumes ticking", resumedTick1 > resumedTick0, { resumedTick0, resumedTick1 });
  const speedOnAfterResume = await page.evaluate(() =>
    [].map.call(document.querySelectorAll("#fsSpeed [data-speed]"), (b) => b.getAttribute("data-speed") + ":" + b.classList.contains("on")));
  t.check("exactly one speed button is .on after resume", speedOnAfterResume.filter((s) => /:true/.test(s)).length === 1, speedOnAfterResume);

  /* ══════════════════════════ 5. flag panel ═══════════════════════════════ */
  const flagPanelSetup = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const cf = T.cflag();
    // stuff the castle door flag with goods so the panel has icons to show
    for (let i = 0; i < 3 && cf.slots.length < 8; i++) cf.slots.push({ res: "plank", dest: 0 });
    FS.FSRender.setCam({ yaw: 0.5, pitch: 0.7, dist: 24 });
    FS.FSRender.focusVertex(cf.v, 24);
    FS.FSRender.frame(0.016);
    return { v: cf.v, n: cf.slots.length };
  });
  await clickVertex(page, flagPanelSetup.v);
  await sleep(200);
  const flagPanel = await page.evaluate(() => ({
    visible: !document.getElementById("fsContext").classList.contains("hidden"),
    kind: document.getElementById("fsContext").getAttribute("data-kind"),
    goods: document.querySelectorAll("#fsContextBody .ctx-good").length,
    hasRoadBtn: !!document.querySelector('#fsContextBody [data-act="ctx-startroad"]'),
  }));
  t.check("clicking a flag opens the context panel", flagPanel.visible && flagPanel.kind === "flag", flagPanel);
  t.check("flag panel shows a queued-goods icon per slot", flagPanel.goods === flagPanelSetup.n, { flagPanel, want: flagPanelSetup.n });
  t.check("flag panel offers a start-road shortcut", flagPanel.hasRoadBtn);
  await page.click('#fsContext [data-act="ctx-close"]');
  await sleep(100);
  const closedPanel = await page.evaluate(() => document.getElementById("fsContext").classList.contains("hidden"));
  t.check("✕ closes the context panel", closedPanel);

  /* ══════════════════════════ 6. attack dialog on an enemy building ══════ */
  const battle = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSC = FS.FSC;
    T.fresh({ speed: 0 });
    const mine = T.spotNear("hut", T.castle().v, 8, 11, 0);
    const ours = T.plant("hut", mine, 0);
    const theirs = T.spotNear("hut", mine, 5, FSC.ATTACK_RANGE - 4, 1, [mine]);
    const foe = theirs >= 0 ? T.plant("hut", theirs, 1) : null;
    if (!ours || !foe) return { ok: false };
    T.garrison(ours, [3, 3]);
    T.garrison(foe, [0]);
    FS.FSRender.setCam({ yaw: 0.5, pitch: 0.7, dist: 26 });
    FS.FSRender.focusVertex(foe.v, 26);
    FS.FSRender.frame(0.016);
    return { ok: true, foeV: foe.v, foeId: foe.id, max: FS.q.maxAttackers(foe.id, 0) };
  });
  t.check("scripted a nearby enemy hut to attack", battle.ok === true, battle);
  await clickVertex(page, battle.foeV);
  await sleep(200);
  const enemyPanel = await page.evaluate(() => !!document.querySelector('#fsContextBody [data-act="ctx-attack-open"]'));
  t.check("selecting an enemy military building shows an Attack action", enemyPanel);
  await page.click('#fsContextBody [data-act="ctx-attack-open"]');
  await sleep(150);
  const dlg = await page.evaluate(() => ({
    visible: !document.getElementById("fsAttackDialog").classList.contains("hidden"),
    max: parseInt(document.getElementById("fsAttackCount").max, 10),
  }));
  t.check("Attack dialog opens on an enemy military building", dlg.visible);
  t.check("the count slider caps at the available attackers (FSMil.maxAttackers)", dlg.max === battle.max, { dlg, want: battle.max });
  await page.click('#fsAttackDialog [data-act="attack-go"]');
  await sleep(200);
  const attacked = await page.evaluate(() => window.__FS__.events("attackLaunched").length);
  t.check("confirming the dialog really issues the attack command", attacked >= 1, attacked);
  await sleep(100);
  const dlgClosed = await page.evaluate(() => document.getElementById("fsAttackDialog").classList.contains("hidden"));
  t.check("dialog closes after confirming", dlgClosed);

  console.log("   …section 4-6 done, continuing…");
  await t.shot(page, "farmstead_ui_partial2");

  /* ══════════════════════════ 7. side menu: distribution + both priority
   * lists + tools + knights (occupancy names/4 tiers) + settings ══════════ */
  await page.evaluate(() => { window.T.fresh({ speed: 0 }); });
  await page.click("#fsMenuBtn");
  await sleep(100);
  const menuOpen = await page.evaluate(() => !document.getElementById("fsMenu").classList.contains("hidden"));
  t.check("☰ opens the side menu", menuOpen);

  await page.click('#fsMenu [data-act="open-dist"]');
  await sleep(120);
  const distBefore = await page.evaluate(() => window.__FS__.G.players[0].dist.planksConstruction);
  // click the 10th tick (index 10 of 0..20) on the FIRST stepper in the sheet
  const distStepperSel = '#fsSheetBody .fs-stepper[data-key="planksConstruction"] [data-lvl="10"]';
  const distTickExists = await page.evaluate((sel) => !!document.querySelector(sel), distStepperSel);
  t.check("distribution sheet renders 20-notch steppers", distTickExists);
  await page.click(distStepperSel);
  await sleep(120);
  const distAfter = await page.evaluate(() => window.__FS__.G.players[0].dist.planksConstruction);
  t.check("distribution slider persists to G (addendum #6: 20-notch stepper)",
    distAfter === 10 * (await page.evaluate(() => window.__FS__.FSC.PRIO_STEP)) && distAfter !== distBefore,
    { distBefore, distAfter });

  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(80);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-prioT"]');
  await sleep(120);
  const prioTBefore = await page.evaluate(() => window.__FS__.G.players[0].transportPrio.slice(0, 2));
  await page.click('.fs-prio-list[data-list="transport"] .fs-prio-row:first-child [data-act="prio-down"]');
  await sleep(150);
  const prioTAfter = await page.evaluate(() => window.__FS__.G.players[0].transportPrio.slice(0, 2));
  t.check("transport priority reorder moves an item (▼ swaps rows 0/1)",
    prioTAfter[0] === prioTBefore[1] && prioTAfter[1] === prioTBefore[0], { prioTBefore, prioTAfter });

  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(80);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-prioW"]');
  await sleep(120);
  const invPBefore = await page.evaluate(() => window.__FS__.G.players[0].invPrio.slice(0, 2));
  t.check("a SEPARATE warehouse-output priority list exists (addendum #7)",
    JSON.stringify(invPBefore) !== "undefined", invPBefore);
  await page.click('.fs-prio-list[data-list="warehouse"] .fs-prio-row:first-child [data-act="prio-down"]');
  await sleep(150);
  const invPAfter = await page.evaluate(() => window.__FS__.G.players[0].invPrio.slice(0, 2));
  t.check("warehouse priority reorder moves an item, independent of transport's list",
    invPAfter[0] === invPBefore[1] && invPAfter[1] === invPBefore[0], { invPBefore, invPAfter });
  const transportUnaffected = await page.evaluate(() => window.__FS__.G.players[0].transportPrio.slice(0, 2));
  t.check("…and reordering warehouse priority did not touch transport priority",
    JSON.stringify(transportUnaffected) === JSON.stringify(prioTAfter), { transportUnaffected, prioTAfter });

  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(80);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-tools"]');
  await sleep(120);
  const toolBefore = await page.evaluate(() => window.__FS__.G.players[0].tools.axe);
  await page.click('#fsSheetBody .fs-stepper[data-key="axe"] [data-lvl="0"]');
  await sleep(120);
  const toolAfter = await page.evaluate(() => window.__FS__.G.players[0].tools.axe);
  t.check("tool priority stepper persists to G", toolAfter === 0 && toolBefore !== 0, { toolBefore, toolAfter });

  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(80);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-knights"]');
  await sleep(120);
  const knightsPanel = await page.evaluate(() => ({
    tierLabels: [].map.call(document.querySelectorAll(".fs-occ-tier"), (e) => e.textContent),
    occLabels: [].map.call(document.querySelectorAll('.fs-occ-row select option'), (o) => o.textContent).slice(0, 5),
  }));
  t.check("addendum #5: 4 threat tiers labelled Interior/Near/Close/Border",
    JSON.stringify(knightsPanel.tierLabels) === JSON.stringify(["Interior", "Near", "Close", "Border"]), knightsPanel);
  t.check("addendum #5: occupancy level names Minimum/Weak/Medium/Good/Full",
    JSON.stringify(knightsPanel.occLabels) === JSON.stringify(["Minimum", "Weak", "Medium", "Good", "Full"]), knightsPanel);
  const castleBefore = await page.evaluate(() => window.__FS__.G.players[0].knights.castleKnights);
  await page.click('[data-act="knight-castle"][data-d="1"]');
  await sleep(120);
  const castleAfter = await page.evaluate(() => window.__FS__.G.players[0].knights.castleKnights);
  t.check("castle garrison stepper persists to G", castleAfter === castleBefore + 1, { castleBefore, castleAfter });
  // change one tier's occupancy via the real <select>s (querySelector natural
  // document order picks the first .fs-occ-row = tier 0 / Interior). Max must
  // rise before min can — FSSim.setKnightSetting clamps min <= max, by design.
  const occMaxSel = '.fs-occ-row select[data-kind="max"]', occMinSel = '.fs-occ-row select[data-kind="min"]';
  await page.select(occMaxSel, "4");
  await sleep(150);
  await page.select(occMinSel, "3");
  await sleep(150);
  const occAfter = await page.evaluate(() => window.__FS__.G.players[0].knights.occ[0].slice());
  t.check("knight occupancy <select>s persist to G (tier 0 → min 3 / max 4)",
    occAfter[0] === 3 && occAfter[1] === 4, occAfter);

  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(80);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-settings"]');
  await sleep(120);
  const tintBefore = await page.evaluate(() => window.__FS__.FSRender.territoryTint());
  await page.click('#fsSheetBody [data-act="settings-tint"]');
  await sleep(100);
  const tintAfter = await page.evaluate(() => window.__FS__.FSRender.territoryTint());
  t.check("Settings territory-tint toggle really flips FSRender's tint", tintAfter !== tintBefore, { tintBefore, tintAfter });
  const invertBefore = await page.evaluate(() => window.__FS__.FSRender.invertY());
  await page.click('#fsSheetBody [data-act="settings-invert"]');
  await sleep(100);
  const invertAfter = await page.evaluate(() => window.__FS__.FSRender.invertY());
  t.check("Settings camera-invert toggle flips FSRender's invertY", invertAfter !== invertBefore, { invertBefore, invertAfter });
  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(80);

  /* ══════════════════════════ QoL#2 paused-queue toast (co-op semantics) ═══
   * addendum item 2: netState().connected && speed===0 → a build/flag/etc
   * issued shows "Queued — resumes with time" once. Faked without a live
   * room by stubbing FSNet.active/state for this one check. ═══════════════ */
  const queueToast = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    T.fresh({ speed: 0 });
    // a guaranteed-legal flag spot, explicitly hovered (not whatever the
    // mouse happened to leave behind from an earlier section)
    const c = T.castle();
    let v = -1;
    FSMap.forRadius(FS.G.map, c.v, 9, (u) => { if (v < 0 && !FSMap.whyFlag(FS.G.map, u, 0)) v = u; });
    FS.FSRender.setHover(v);
    /* RESTAGED 2026-08-02 (batch #4): PAUSE FIRST, THEN CONNECT. Co-op is
     * pinned to 1x now (user request — speed scales every client's command
     * lead, so it is a property of the session, not of one player), and
     * setSpeed is the single funnel that enforces it: asking for 0 while
     * connected is refused. The state this check is ABOUT — a connected client
     * whose clock is at 0 — is still reachable, as the transient between a
     * paused solo game and the room going live, which is exactly the order
     * these two lines are now in. The toast being tested is unchanged. */
    FS.setSpeed(0);
    const origActive = FS.FSNet.active, origState = FS.FSNet.state;
    FS.FSNet.active = () => true;
    FS.FSNet.state = () => ({ connected: true, seat: 0 });
    const before = document.getElementById("fsToasts").textContent;
    FSUI.doFlagAtHover();     // any command path routes through noteIfQueued()
    const after = document.getElementById("fsToasts").textContent;
    FS.FSNet.active = origActive; FS.FSNet.state = origState;
    return { before, after, v };
  });
  t.check("addendum #2: a command issued while paused+connected shows the queued toast",
    /Queued/i.test(queueToast.after), queueToast);

  console.log("   …section 7 done, continuing…");

  /* ══════════════════════════ 8. stats panel (canvas non-blank) ══════════ */
  // the stats rings only gain points every FSC.STATS_T ticks — fast-forward
  // past a couple of samples first, or the chart has nothing to draw yet.
  await page.evaluate(() => window.__FS__.ff(window.__FS__.FSC.STATS_T * 3));
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-stats"]');
  await sleep(150);
  const statsInfo = await page.evaluate(() => {
    const cv = document.getElementById("fsStatsCanvas");
    const ctx = cv.getContext("2d");
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let nonBlank = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 30 || data[i + 1] > 30 || data[i + 2] > 30) nonBlank++;
    return { nonBlank, legendChips: document.querySelectorAll("#fsStatsLegend .fs-legend-chip").length };
  });
  t.check("stats panel renders a non-blank canvas", statsInfo.nonBlank > 50, statsInfo);
  t.check("stats legend lists every player", statsInfo.legendChips === 2, statsInfo);
  await page.click('#fsStatsTabs [data-tab="military"]');
  await sleep(150);
  const militaryTabOn = await page.evaluate(() => document.querySelector('#fsStatsTabs [data-tab="military"]').classList.contains("on"));
  t.check("stats tabs switch (military)", militaryTabOn);
  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(100);

  /* ══════════════════════════ 9. minimap click moves the camera ══════════ */
  const camBefore = await page.evaluate(() => window.__FS__.FSRender.camState());
  const mmBox = await page.evaluate(() => {
    const r = document.getElementById("fsMinimapCanvas").getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // click a corner far from the current camera target so the move is unambiguous
  await page.mouse.click(mmBox.x + mmBox.w * 0.15, mmBox.y + mmBox.h * 0.15);
  await sleep(200);
  const camAfter = await page.evaluate(() => window.__FS__.FSRender.camState());
  const moved = Math.abs(camAfter.tx - camBefore.tx) + Math.abs(camAfter.tz - camBefore.tz);
  t.check("clicking the minimap moves the camera target", moved > 1, { camBefore, camAfter, moved });

  /* ══════════════════════════ QoL#5b: zoom-to-cursor keeps the point under
   * the cursor fixed on screen (camera feel). CRITICAL: the wheel event must
   * fire OFF the camera's existing orbit target — a naive dist-only zoom
   * trivially keeps the TARGET's own screen position fixed (it's always
   * dead-center-ish by construction), so a cursor position that happens to
   * coincide with the target would pass even with zero cursor-anchoring
   * logic. Picking a separate, clearly off-center vertex to zoom AT (while
   * the camera still orbits the castle) is what actually exercises the
   * pan-compensation math. ═══════════════════════════════════════════════ */
  const zoomFeel = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap;
    R.setCam({ yaw: 0.5, pitch: 0.7, dist: 30 });
    const c = FS.FSSim.castleOf(FS.G, 0);
    R.focusVertex(c.v, 30);
    R.frame(0.016);
    const targetScreen = R.vertexScreen(c.v);
    // an off-target vertex, well clear of the castle's own screen spot
    let cursorV = -1, bestOff = 0;
    const xz = [0, 0];
    FSMap.forRadius(FS.G.map, c.v, 9, (u, d) => {
      if (d < 5) return;
      FSMap.worldXZ(FS.G.map, u, xz);
      const s = R.worldToScreen(xz[0], FS.G.map.height[u], xz[1]);
      if (!s.inView) return;
      const off = Math.hypot(s.x - targetScreen.x, s.y - targetScreen.y);
      if (off > bestOff) { bestOff = off; cursorV = u; }
    });
    const s0 = R.vertexScreen(cursorV);
    const before = R.camState();
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -240, clientX: s0.x, clientY: s0.y, bubbles: true, cancelable: true }));
    R.frame(0.016);
    const after = R.camState();
    const s1 = R.vertexScreen(cursorV);
    return { s0, s1, before, after, dist0: before.dist, dist1: after.dist, offFromTarget: bestOff, cursorV, targetScreen };
  });
  t.check("wheel actually zoomed", zoomFeel.dist1 < zoomFeel.dist0, zoomFeel);
  t.check("zoom-cursor test setup: the cursor vertex is well off the camera's own target on screen",
    zoomFeel.offFromTarget > 80, zoomFeel);
  const screenDrift = Math.hypot(zoomFeel.s1.x - zoomFeel.s0.x, zoomFeel.s1.y - zoomFeel.s0.y);
  t.check("QoL#5: zoom-to-cursor keeps an OFF-TARGET point under the cursor within tolerance",
    screenDrift < 60, { screenDrift, s0: zoomFeel.s0, s1: zoomFeel.s1 });

  /* ══════════════════════════ 10. notifications: toast + bell + jump ═════ */
  await page.evaluate(() => { window.T.fresh({ speed: 0 }); });
  const notifSetup = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    const c = T.castle();
    FS.FSSim.notify(FS.G, 0, "Geologist found gold.", c.v);
    // pan the camera well away from the notification's vertex first, so a
    // later "does clicking it jump the camera" check is unambiguous
    FS.FSRender.focusVertex(0, 40);
    FS.FSRender.frame(0.016);
    return { v: c.v };
  });
  await sleep(300);
  const toastNotif = await page.evaluate(() => document.getElementById("fsToasts").textContent);
  t.check("a scripted notification produces a toast", /Geologist found gold/.test(toastNotif), toastNotif);
  const bellBadge = await page.evaluate(() => ({
    text: document.getElementById("fsBellBadge").textContent,
    hidden: document.getElementById("fsBellBadge").classList.contains("hidden"),
  }));
  t.check("the bell shows an unread badge", bellBadge.hidden === false && parseInt(bellBadge.text, 10) >= 1, bellBadge);
  await page.click("#fsBell");
  await sleep(150);
  const bellLogHTML = await page.evaluate(() => document.getElementById("fsBellLog").textContent);
  t.check("the bell log lists the notification", /Geologist found gold/.test(bellLogHTML), bellLogHTML);
  const camBeforeJump = await page.evaluate(() => window.__FS__.FSRender.camState());
  await page.click('#fsBellLog [data-act="notif-jump"]');
  await sleep(200);
  await pumpUI(page, 3);              // the jump is a 0.45s GLIDE, advanced per frame
  const camAfterJump = await page.evaluate(() => window.__FS__.FSRender.camState());
  t.check("clicking a bell entry jumps the camera",
    Math.abs(camAfterJump.tx - camBeforeJump.tx) + Math.abs(camAfterJump.tz - camBeforeJump.tz) > 0.5,
    { camBeforeJump, camAfterJump });
  const badgeAfterOpen = await page.evaluate(() => document.getElementById("fsBellBadge").classList.contains("hidden"));
  t.check("opening the bell clears the unread badge", badgeAfterOpen);

  console.log("   …section 8-10 done, continuing…");
  await t.shot(page, "farmstead_ui_partial3");

  /* ══════════════════════════ 11. save/load: slot save → reload → Continue ═
   * addendum 2 item 3: 3 slots + autosave, via the real Save/Load panel. ═══ */
  const before = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const c = T.castle();
    let v = -1;
    FS.FSMap.forRadius(FS.G.map, c.v, 9, (u, d) => { if (v < 0 && d >= 3 && FS.FSMap.canPlaceBuilding("hut", u, 0)) v = u; });
    FS.build("hut", v);
    FS.FSSim.runCommands(FS.G, true);
    FS.ff(30);
    return { tick: FS.G.tick, buildings: FS.q.counts(0).buildings, seed: FS.G.seed };
  });
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-saveload"]');
  await sleep(150);
  await page.click('.fs-save-row[data-slot="1"] [data-act="save-slot"]');
  await sleep(200);
  const savedToast = await page.evaluate(() => document.getElementById("fsToasts").textContent);
  t.check("Save/Load panel's Save button really saves (toast confirms)", /saved/i.test(savedToast), savedToast);
  // also prime the autosave slot for the title-screen Continue button
  await page.evaluate(() => window.__FS__.save("auto"));
  await page.click('#fsSheetWrap [data-act="sheet-close"]');

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.FSUI, { timeout: 20000 });
  const continueVisible = await page.evaluate(() => !document.getElementById("continueBtn").classList.contains("hidden"));
  t.check("Continue button appears after reload (an autosave now exists)", continueVisible);
  await page.click("#continueBtn");
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 20000 });
  await sleep(300);
  const afterContinue = await page.evaluate(() => {
    const FS = window.__FS__;
    return { tick: FS.G.tick, buildings: FS.q.counts(0).buildings, seed: FS.G.seed };
  });
  t.check("Continue resumes the exact saved kingdom (tick/buildings/seed match)",
    afterContinue.buildings === before.buildings && afterContinue.seed === before.seed && afterContinue.tick >= before.tick,
    { before, afterContinue });

  await page.evaluate(HELPERS);   // the reload wiped window.T — re-inject it
  // now the slot-1 save via the panel's own Load button
  await page.evaluate(() => { window.T.fresh({ speed: 0 }); });   // scramble the world first
  await sleep(100);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-saveload"]');
  await sleep(150);
  await page.click('.fs-save-row[data-slot="1"] [data-act="load-slot"]');
  await sleep(300);
  const afterSlotLoad = await page.evaluate(() => ({ tick: window.__FS__.G.tick, buildings: window.__FS__.q.counts(0).buildings, seed: window.__FS__.G.seed }));
  t.check("panel's slot-1 Load button restores that exact save",
    afterSlotLoad.buildings === before.buildings && afterSlotLoad.seed === before.seed, { before, afterSlotLoad });

  console.log("   …section 11 done, continuing…");

  /* ══════════════════════════ QoL#4: congestion glow ══════════════════════ */
  const congest = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const cf = T.cflag();
    while (cf.slots.length < 7) cf.slots.push({ res: "plank", dest: 0 });
    FS.FSRender.frame(0.016);
    const glowingFull = FS.FSRender.congestedFlags().indexOf(cf.id) >= 0;
    cf.slots.length = 2;   // drain it back down
    FS.FSRender.frame(0.016);
    const glowingDrained = FS.FSRender.congestedFlags().indexOf(cf.id) >= 0;
    return { glowingFull, glowingDrained, min: FS.FSC.CONGEST_GLOW_MIN };
  });
  t.check("QoL#4: a flag stuffed to " + congest.min + "+ goods glows congested", congest.glowingFull === true, congest);
  t.check("QoL#4: draining it below the threshold clears the glow", congest.glowingDrained === false, congest);

  /* ══════════════════════════ QoL#2: build-suitability overlay (full) ═════ */
  const suit = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    T.fresh({ speed: 0 });
    // find a mountain vertex the player actually owns (lend ownership like
    // the military suite's T.plant does, so the classifier has real ground)
    const map = FS.G.map;
    let mv = -1;
    for (let v = 0; v < map.W * map.H && mv < 0; v++) if (map.terr[v] === FS.FSC.TERR.MOUNTAIN) mv = v;
    const ring = [];
    FSMap.forRadius(map, mv, 2, (u) => { ring.push([u, map.owner[u]]); map.owner[u] = 0; });
    return { mv, ring };
  });
  const onOverlay = await page.evaluate(() => window.__FS__.FSRender.overlaySuitability(true, { p: 0 }));
  await sleep(80);
  const overlayInfo = await page.evaluate((mv) => ({
    on: window.__FS__.FSRender.suitabilityOn(),
    mineTint: window.__FS__.FSRender.suitabilityAt(mv),
    sceneHasIt: !!window.__FS__.FSRender.scene().getObjectByName("suitability"),
  }), suit.mv);
  t.check("toggling the suitability overlay on shows a scene object", onOverlay && overlayInfo.sceneHasIt, overlayInfo);
  t.check("a known mountain vertex reads the 'mine' tint", overlayInfo.mineTint === "mine", overlayInfo);
  const offOverlay = await page.evaluate(() => window.__FS__.FSRender.overlaySuitability(false));
  await sleep(80);
  const overlayGone = await page.evaluate(() => !window.__FS__.FSRender.scene().getObjectByName("suitability"));
  t.check("toggling it off removes the overlay object", offOverlay === false && overlayGone, { offOverlay, overlayGone });

  // and the dock/T-key path really drives the same toggle
  await page.click("#fsDockSuit");
  await sleep(100);
  const dockOn = await page.evaluate(() => window.__FS__.FSRender.suitabilityOn());
  const dockBtnOn = await page.evaluate(() => document.getElementById("fsDockSuit").classList.contains("on"));
  t.check("the dock 🗺 SUIT button toggles the overlay too", dockOn && dockBtnOn, { dockOn, dockBtnOn });
  await page.keyboard.press("t");
  await sleep(100);
  const keyOff = await page.evaluate(() => window.__FS__.FSRender.suitabilityOn());
  t.check("the T key toggles the same overlay", keyOff === false, keyOff);

  /* ══════════════════════════ QoL#6: co-op ping marker ═══════════════════ */
  const pingSetup = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const c = T.castle();
    FS.FSRender.focusVertex(c.v, 30);
    FS.FSRender.frame(0.016);
    return { v: c.v };
  });
  await page.evaluate((v) => window.__FS__.ping(v), pingSetup.v);
  await sleep(150);
  const pingOn = await page.evaluate(() => ({
    hidden: document.getElementById("pingMark").classList.contains("hidden"),
    events: window.__FS__.events("ping").length,
  }));
  t.check("QoL#6: issuing a ping command shows the marker", pingOn.hidden === false && pingOn.events >= 1, pingOn);
  const pingExpire = await page.evaluate((v) => {
    const FS = window.__FS__;
    FS.ff(FS.FSC.NET_PING_T + 5);
    FS.paintHud();
    return document.getElementById("pingMark").classList.contains("hidden");
  }, pingSetup.v);
  t.check("QoL#6: the ping marker expires after FSC.NET_PING_T ticks", pingExpire === true, pingExpire);

  console.log("   …QoL sections done, continuing…");

  /* ══════════════════════════ QoL#3: idle-building alerts ═════════════════
   * script a building with NO road to the network → alert appears with a
   * reason; fix the route → alert clears. Uses "stock" (a Storehouse), NOT a
   * producer like sawmill: a producer has BOTH "no route" AND "no worker" as
   * independent, simultaneously-true stall reasons while the sim sits paused
   * (speed:0 — no serf ever walks over to take the job), so connecting the
   * road alone correctly leaves it flagged (now for the worker, which is
   * accurate, dynamic behavior — not a bug). A warehouse has neither a job
   * nor inputs, so "no route" is its ONLY possible stall reason, making it
   * the clean single-variable case for proving the alert fully clears once
   * its one true problem is fixed. (Root-caused via a standalone diagnostic
   * that dumped the live alert reason text post-connect: it correctly read
   * "waiting for a worker" — confirming the feature, not the test, was
   * right — see the "UI decisions" section of the final report.) ══════════ */
  const stall = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    T.fresh({ speed: 0 });
    const c = T.castle();
    let v = -1;
    FSMap.forRadius(FS.G.map, c.v, 9, (u, d) => { if (v < 0 && d >= 4 && FSMap.canPlaceBuilding("stock", u, 0)) v = u; });
    const b = T.plant("stock", v, 0);      // T.plant lends ownership but never roads it
    return { id: b ? b.id : 0, v: b ? b.v : -1 };
  });
  t.check("scripted a finished, unrouted storehouse", stall.id > 0, stall);
  await sleep(1100);   // idle alerts refresh at ~1Hz
  const alertShown = await page.evaluate(() => {
    document.getElementById("fsAlertChip").click();
    return { count: document.getElementById("fsAlertCount").textContent, html: document.getElementById("fsAlertList").textContent };
  });
  t.check("QoL#3: an idle alert appears for the stalled storehouse", parseInt(alertShown.count, 10) >= 1 &&
    /route/i.test(alertShown.html), alertShown);
  await page.evaluate((o) => {
    const FS = window.__FS__, T = window.T;
    const b = FS.G.buildings[o.id];
    T.connect(FS.G.flags[b.flag].v, 0);   // wire it up properly (its DOOR FLAG's vertex, not the building's own)
  }, stall);
  // idle alerts refresh on FSUI's throttled ~4Hz pass, driven by rAF (which
  // keeps running while paused) — poll rather than a flat sleep, since this
  // headless renderer only sustains ~7fps and a fixed short wait can miss a
  // beat under load.
  await page.waitForFunction(() => document.getElementById("fsAlertChip").classList.contains("hidden"), { timeout: 8000 });
  const alertCleared = await page.evaluate(() => document.getElementById("fsAlertChip").classList.contains("hidden"));
  t.check("QoL#3: fixing the route clears the alert", alertCleared);

  /* ══════════════════════════ game-over overlay ═══════════════════════════
   * checkGameOver() only runs from FSUI.frame(), driven by rAF — waiting for
   * the overlay's own class (rather than a flat sleep) removes any race with
   * this environment's ~7fps headless render loop. */
  const over = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    FS.FSMil.eliminate(FS.G, 1, 0);   // the human (player 0) wins by elimination
    return { gameOver: FS.G.gameOver };
  });
  t.check("scripted elimination sets G.gameOver", !!over.gameOver, over);
  await page.waitForFunction(() => !document.getElementById("fsGameOver").classList.contains("hidden"), { timeout: 8000 });
  const overlay = await page.evaluate(() => ({
    visible: !document.getElementById("fsGameOver").classList.contains("hidden"),
    title: document.getElementById("fsGameOverTitle").textContent,
    statRows: document.querySelectorAll("#fsGameOverStats .go-row").length,
  }));
  t.check("game-over overlay appears on elimination", overlay.visible);
  t.check("…and shows victory (the human won this scripted elimination)", /VICTORY/.test(overlay.title), overlay);
  t.check("…with a final stat row per player", overlay.statRows === 2, overlay);
  await page.click('#fsGameOver [data-act="gameover-continue"]');
  await sleep(150);
  const keptPlaying = await page.evaluate(() => ({
    hidden: document.getElementById("fsGameOver").classList.contains("hidden"),
    started: window.__FS__.started(),
  }));
  t.check("'Keep playing' dismisses the overlay without ending the session", keptPlaying.hidden && keptPlaying.started, keptPlaying);

  // and New Game from the overlay returns to the title screen. Needs a
  // FRESH game first: `gameOverShown` (and G.gameOver itself) only reset on
  // a new game, by design — the overlay is a deliberate one-shot per
  // finished game and correctly does NOT re-pop every tick just because the
  // same already-decided G gets eliminate()'d again after "Keep playing".
  // A fresh game also lets this double as DEFEAT-branch coverage (the first
  // scripted elimination above was a VICTORY for the human).
  await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    FS.FSMil.eliminate(FS.G, 0, 1);   // this time the human (player 0) LOSES
  });
  await page.waitForFunction(() => !document.getElementById("fsGameOver").classList.contains("hidden"), { timeout: 8000 });
  const defeatTitle = await page.evaluate(() => document.getElementById("fsGameOverTitle").textContent);
  t.check("a second scripted game-over (this time a defeat) also shows the overlay", /DEFEAT/.test(defeatTitle), defeatTitle);
  await page.click('#fsGameOver [data-act="gameover-new"]');
  await sleep(150);
  const backAtTitle = await page.evaluate(() => ({
    titleVisible: !document.getElementById("title").classList.contains("hidden"),
    started: window.__FS__.started(),
  }));
  t.check("New Game from the game-over overlay returns to the title screen", backAtTitle.titleVisible && !backAtTitle.started, backAtTitle);

  console.log("   …game-over section done, continuing…");
  await t.shot(page, "farmstead_ui");

  /* ══════════════════════════ 13. adversarial-review batch ════════════════
   * ux#1 rejected-command feedback · ux#2 the cycle-knights control ·
   * ux#4 help content · quality#1 a save that will not load · fidelity#4 the
   * castle's garrison capacity · longplay#1 the stalled-site hint.
   * The page is sitting on the TITLE screen right now (the game-over section
   * left it there) — which is exactly where the Continue button lives. ════ */

  // ── quality#1a: the title screen's Continue button, when the save won't load
  const contBefore = await page.evaluate(() => {
    // an autosave exists from section 11, so the button is showing
    window.__FS__.__origLoad = window.__FS__.load;
    window.__FS__.load = function () { return false; };     // stand in for a version-mismatched save
    return {
      visible: !document.getElementById("continueBtn").classList.contains("hidden"),
      toasts: document.getElementById("fsToasts").textContent,
    };
  });
  t.check("Continue button is showing before the failed-load check", contBefore.visible, contBefore);
  await page.click("#continueBtn");
  await sleep(200);
  await pumpUI(page, 2);
  const contAfter = await page.evaluate(() => ({
    hidden: document.getElementById("continueBtn").classList.contains("hidden"),
    started: window.__FS__.started(),
    toasts: document.getElementById("fsToasts").textContent,
    toastVisible: (function () {
      const w = document.getElementById("fsToasts");
      const r = w.getBoundingClientRect();
      return w.children.length > 0 && r.width > 0 && r.height > 0 && getComputedStyle(w).display !== "none";
    })(),
  }));
  t.check("quality#1: a save that won't load says so on the title screen",
    /older version/i.test(contAfter.toasts) && contAfter.started === false, contAfter);
  t.check("quality#1: …the toast is actually on screen (not buried in the hidden HUD root)",
    contAfter.toastVisible === true, contAfter);
  t.check("quality#1: …and the Continue button hides itself", contAfter.hidden === true, contAfter);

  // ── quality#1b: the same refusal through the in-game Save/Load sheet
  await page.evaluate(() => { window.T.fresh({ speed: 0 }); });
  await sleep(200);
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-saveload"]');
  await sleep(150);
  await page.click('.fs-save-row[data-slot="1"] [data-act="load-slot"]');
  await sleep(250);
  const sheetLoadFail = await page.evaluate(() => ({
    toasts: document.getElementById("fsToasts").textContent,
    sheetStillOpen: !document.getElementById("fsSheetWrap").classList.contains("hidden"),
  }));
  t.check("quality#1: the Save/Load sheet's Load button reports a save it cannot read",
    /older version/i.test(sheetLoadFail.toasts), sheetLoadFail);
  await page.evaluate(() => { window.__FS__.load = window.__FS__.__origLoad; });   // un-stub
  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(100);

  // ── ux#1: the sim refuses to raze the castle → the player is told, and the
  //         panel that was optimistically closed comes back
  await page.click("#fsDockSelect");
  await sleep(80);
  const razeSetup = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const c = T.castle();
    FS.FSRender.focusVertex(c.v, 30);
    FS.FSRender.frame(0.016);
    FS.FSRender.setHover(c.v);
    window.FSUI.onCanvasClick(c.v);          // select the castle (its panel opens)
    return { v: c.v, id: c.id, panelOpen: !document.getElementById("fsContext").classList.contains("hidden") };
  });
  t.check("ux#1 setup: own castle selected", razeSetup.panelOpen && razeSetup.id > 0, razeSetup);
  await page.click("#fsDockDemolish");
  await sleep(80);
  await page.evaluate((v) => { window.FSUI.onCanvasClick(v); }, razeSetup.v);
  await sleep(120);
  const razeDlg = await page.evaluate(() => ({
    open: !document.getElementById("fsDemolishDialog").classList.contains("hidden"),
    what: document.getElementById("fsDemolishWhat").textContent,
  }));
  t.check("ux#1 setup: the raze confirmation opens on the castle", razeDlg.open && /Castle/i.test(razeDlg.what), razeDlg);
  await page.evaluate(() => { document.getElementById("fsToasts").textContent = ""; });
  await page.click('#fsDemolishDialog [data-act="demolish-go"]');
  await sleep(120);
  await page.evaluate(() => window.__FS__.ff(20));         // let the command reach execCommand
  await sleep(200);
  await pumpUI(page, 3);                                   // …and the UI poller see the cmdFail
  const razed = await page.evaluate((id) => ({
    toasts: document.getElementById("fsToasts").textContent,
    castleAlive: !!window.__FS__.G.buildings[id] && window.__FS__.G.buildings[id].state !== "burn",
    fails: window.__FS__.events("cmdFail").filter((e) => e.cmd === "demolish").length,
    panelOpen: !document.getElementById("fsContext").classList.contains("hidden"),
    panelText: document.getElementById("fsContextBody").textContent,
  }), razeSetup.id);
  t.check("ux#1: a refused raze toasts a friendly reason instead of vanishing",
    /castle can't be torn down/i.test(razed.toasts) && razed.fails >= 1, razed);
  t.check("ux#1: …the castle really did survive", razed.castleAlive, razed);
  t.check("ux#1: …and its panel is back, showing the truth",
    razed.panelOpen && /Castle/i.test(razed.panelText), razed);

  // ── ux#1: an enemy producer offers no pause checkbox, and a halt the sim
  //         refuses still reaches the player as words
  const enemyProd = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const c = T.castle();
    const v = T.spotNear("lumberjack", c.v, 5, 10, 1, null, { anyGround: true });
    if (v < 0) return { ok: false };
    const b = T.plant("lumberjack", v, 1);
    if (!b) return { ok: false };
    window.FSUI.onCanvasClick(v);            // select mode is still armed → opens its panel
    const body = document.getElementById("fsContextBody");
    return { ok: true, id: b.id, halt: !!body.querySelector('[data-act="ctx-halt"]'),
      panel: body.textContent.slice(0, 120) };
  });
  t.check("ux#1 setup: an enemy producer is selected", enemyProd.ok === true, enemyProd);
  t.check("ux#1: an enemy building shows no 'pause production' box to lie with",
    enemyProd.halt === false, enemyProd);
  await page.evaluate((id) => {
    document.getElementById("fsToasts").textContent = "";
    window.__FS__.halt(id, true);            // exactly what the old checkbox did
  }, enemyProd.id);
  await page.evaluate(() => window.__FS__.ff(20));
  await sleep(200);
  await pumpUI(page, 3);
  const haltFail = await page.evaluate((id) => ({
    toasts: document.getElementById("fsToasts").textContent,
    halted: !!window.__FS__.G.buildings[id].halted,
  }), enemyProd.id);
  t.check("ux#1: a refused halt is surfaced as a toast, and the building never halted",
    /isn't yours/i.test(haltFail.toasts) && haltFail.halted === false, haltFail);

  // ── ux#2: the cycle-knights control, reachable by finger as well as by key
  await page.click("#fsMenuBtn");
  await page.click('#fsMenu [data-act="open-knights"]');
  await sleep(150);
  const knightSheet = await page.evaluate(() => ({
    hasCycle: !!document.querySelector('#fsSheetBody [data-act="knight-cycle"]'),
    label: (document.querySelector('#fsSheetBody [data-act="knight-cycle"]') || {}).textContent || "",
  }));
  t.check("ux#2: the Knights sheet offers a Rotate-knights-home button",
    knightSheet.hasCycle && /rotate/i.test(knightSheet.label), knightSheet);
  await page.evaluate(() => { document.getElementById("fsToasts").textContent = ""; });
  await page.click('#fsSheetBody [data-act="knight-cycle"]');
  await sleep(120);
  await page.evaluate(() => window.__FS__.ff(20));
  await sleep(200);
  await pumpUI(page, 3);
  const cycled = await page.evaluate(() => ({
    events: window.__FS__.events("knightsCycled").length,
    fails: window.__FS__.events("cmdFail").filter((e) => e.cmd === "cycleKnights").length,
    cycleT: window.__FS__.G.players[0].cycleT || 0,
    toasts: document.getElementById("fsToasts").textContent,
  }));
  t.check("ux#2: …and it really runs a rotation through the same command as the C key",
    cycled.events >= 1 && cycled.fails === 0 && cycled.cycleT > 0, cycled);
  t.check("ux#2: …with the same '♻ knights rotating' feedback", /rotating/i.test(cycled.toasts), cycled);

  // ── fidelity#4: the castle's garrison line is its castleKnights target
  const capLine = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    FS.setKnightSetting("castleKnights", 7);
    FS.FSSim.runCommands(FS.G, true);
    const c = T.castle();
    window.FSUI.escape();                    // close the Knights sheet
    window.FSUI.onCanvasClick(c.v);
    const txt = document.getElementById("fsContextBody").textContent;
    const m = /Garrison \(\d+\/(\d+)\)/.exec(txt);
    return { garrison: m ? m[0] : "(no garrison line)", cap: m ? parseInt(m[1], 10) : -1,
      set: FS.G.players[0].knights.castleKnights, milCap: FS.FSC.BLD.castle.mil.cap };
  });
  t.check("fidelity#4: the castle garrison line reads the player's castleKnights target, not def.mil.cap",
    capLine.cap === 7 && capLine.set === 7 && capLine.milCap === 12, capLine);

  // ── ux#4: the Help sheet lists the actions it used to omit
  await page.evaluate(() => window.FSUI.openHelp());
  await sleep(150);
  const helpTxt = await page.evaluate(() => document.getElementById("fsSheetBody").textContent);
  t.check("ux#4: Help lists attack, send-geologist and cycle-knights",
    /attack/i.test(helpTxt) && /geologist/i.test(helpTxt) && /rotate knights/i.test(helpTxt), helpTxt.slice(-320));
  await page.click('#fsSheetWrap [data-act="sheet-close"]');
  await sleep(100);

  // ── longplay#1: a site nothing can reach says how long it has been stuck
  const stalled = await page.evaluate(() => {
    const FS = window.__FS__, T = window.T;
    T.fresh({ speed: 0 });
    const c = T.castle();
    // deliberately OFF the road network: no plank/stone can ever arrive
    const v = T.spotNear("hut", c.v, 12, 18, 0);
    if (v < 0) return { ok: false };
    const b = T.plant("hut", v, 0, { finish: false });
    return { ok: !!b, id: b ? b.id : 0, v, state: b ? b.state : null };
  });
  t.check("longplay#1 setup: an unreachable construction site exists", stalled.ok && stalled.state === "site", stalled);
  await pumpUI(page, 2);                     // one ≤4Hz pass registers the site's wait clock
  await page.evaluate(() => window.__FS__.ff(1400));   // > 2 sim-minutes of nothing arriving
  await pumpUI(page, 2);
  await pumpUI(page, 2);
  const stallLabel = await page.evaluate((id) => {
    const FS = window.__FS__, b = FS.G.buildings[id];
    window.FSUI.onCanvasClick(b.v);
    return { txt: document.getElementById("fsContextBody").textContent.slice(0, 160),
      state: b.state, got: (b.matGot.plank || 0) + (b.matGot.stone || 0) };
  }, stalled.id);
  const stallMin = /Waiting for materials \((\d+) min\)/.exec(stallLabel.txt);
  t.check("longplay#1: a long-stalled site shows how long it has been waiting",
    !!stallMin && parseInt(stallMin[1], 10) >= 2, { stallLabel, stallMin: stallMin && stallMin[1] });

  console.log("   …review-batch section done, continuing…");

  /* ══════════════════════════ 12. mobile 390×844 ══════════════════════════
   * A SECOND page (its pageerrors flow into the same t.errors the final "0
   * page errors" check reads below) at a real phone viewport. Every
   * interaction here uses page.touchscreen.tap — never .click — to exercise
   * the actual touch path, not just the responsive @media(max-width:700px)
   * layout. ══════════════════════════════════════════════════════════════ */
  const mob = await bootPage(t, { width: 390, height: 844, deviceScaleFactor: 2 });
  const mobTitle = await mob.evaluate(() => {
    const b = document.getElementById("startBtn").getBoundingClientRect();
    return {
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
      startBtnRect: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
      innerH: window.innerHeight,
    };
  });
  t.check("mobile: title screen has no horizontal overflow", mobTitle.scrollW <= mobTitle.innerW + 2, mobTitle);
  t.check("mobile: START button is fully on-screen", mobTitle.startBtnRect.right <= mobTitle.innerW &&
    mobTitle.startBtnRect.left >= 0 && mobTitle.startBtnRect.bottom <= mobTitle.innerH, mobTitle);
  await t.shot(mob, "farmstead_ui_mobile_title");

  await tapEl(mob, "#startBtn");
  await mob.waitForFunction(() => window.__FS__.started(), { timeout: 20000 });
  await sleep(400);
  await mob.evaluate(() => window.__FS__.setSpeed(0));

  // always-on HUD chrome must not collide with itself at a phone width
  function rectsOverlap(a, b) { return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b; }
  const hud = await mob.evaluate(() => {
    function r(sel) { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; }
    return { topbar: r("#fsTopbar"), speed: r("#fsSpeed"), dock: r("#fsDock"), minimap: r("#fsMinimap"), innerW: window.innerWidth, innerH: window.innerHeight };
  });
  const pairs = [["topbar", "speed"], ["topbar", "dock"], ["topbar", "minimap"], ["speed", "dock"], ["speed", "minimap"], ["dock", "minimap"]];
  const anyOverlap = pairs.some(([a, b]) => rectsOverlap(hud[a], hud[b]));
  t.check("mobile: topbar/speed/dock/minimap have zero pairwise overlap", !anyOverlap, hud);
  t.check("mobile: dock stays within the viewport", hud.dock.r <= hud.innerW + 1 && hud.dock.b <= hud.innerH + 1, hud);
  t.check("mobile: minimap stays within the viewport", hud.minimap.r <= hud.innerW + 1 && hud.minimap.b <= hud.innerH + 1, hud);

  // minimap collapse toggle, by real tap
  await tapEl(mob, "#fsMinimapToggle");
  await sleep(80);
  const mmCollapsed = await mob.evaluate(() => document.getElementById("fsMinimap").classList.contains("collapsed"));
  t.check("mobile: minimap collapses on tap", mmCollapsed);
  await tapEl(mob, "#fsMinimapToggle");
  await sleep(80);

  // full build-a-hut flow, entirely via real touch taps (dock → tab → item → ghost)
  await mob.evaluate(HELPERS);
  const mobSpot = await mob.evaluate(() => {
    const FS = window.__FS__, T = window.T, FSMap = FS.FSMap;
    T.fresh({ speed: 0 });
    const c = T.castle();
    let v = -1;
    FSMap.forRadius(FS.G.map, c.v, 9, (u, d) => { if (v < 0 && d >= 3 && FSMap.canPlaceBuilding("hut", u, 0)) v = u; });
    /* RESTAGED 2026-08-01: this staged a yaw of 0.6, which Fork B's lock quietly
     * overruled to 0. With the yaw free again the camera really does turn, the
     * target vertex swings across the screen, and on the PHONE viewport the tap
     * could land on the build panel instead of the map. Centre on the TARGET —
     * which is what a player does before placing anyway — not on the castle. */
    FS.FSRender.setCam({ yaw: 0.6, pitch: 0.85, dist: 30 });
    FS.FSRender.focusVertex(v >= 0 ? v : c.v, 30);
    FS.FSRender.frame(0.016);
    return { v };
  });
  await tapEl(mob, "#fsDockBuild");
  await sleep(150);
  await tapEl(mob, '#fsBuildTabs [data-tab="military"]');
  await sleep(100);
  await tapEl(mob, '#fsBuildGrid [data-type="hut"]');
  await sleep(150);
  const mobArmed = await mob.evaluate(() => window.__FS__.mode());
  t.check("mobile: tapping a build item arms build mode", mobArmed === "build", mobArmed);
  const mobInfo = await mob.evaluate(() => {
    const FSC = window.__FS__.FSC;
    const box = document.getElementById("fsBuildInfo");
    const clipped = [], wide = [];
    for (const k of FSC.BLD_LIST) {
      if (k === "castle") continue;
      window.FSUI.buildInfoFor(k);
      if (box.scrollHeight > box.clientHeight) clipped.push([k, box.scrollHeight, box.clientHeight]);
      /* the narrow viewport is where the head row actually overflowed — see
         the desktop note above (medieval re-skin, 2026-08-02) */
      if (box.scrollWidth > box.clientWidth + 1) wide.push([k, box.scrollWidth, box.clientWidth]);
    }
    window.FSUI.buildInfoFor(null);
    /* A CARD'S NAME IS HOW YOU IDENTIFY IT, and on a phone "Boatwright" was
       arriving as "Boatwrigl" with no scrollbar and nothing to say it had been
       trimmed. The cause is the GRID, not the label: `repeat(3,1fr)` means
       `minmax(auto,1fr)`, whose auto floor is the longest unbreakable word, so
       a long name pushes its whole track wider than a third of the panel and
       the grid — a scroller, therefore overflow-x:auto — cuts the result. The
       honest measurement is the blowout itself. */
    const gridEl = document.getElementById("fsBuildGrid");
    const cutNames = [];
    if (gridEl.scrollWidth > gridEl.clientWidth + 1) cutNames.push(["grid blowout", gridEl.scrollWidth, gridEl.clientWidth]);
    const gr = gridEl.getBoundingClientRect();
    document.querySelectorAll("#fsBuildGrid .build-item").forEach((c) => {
      const cr = c.getBoundingClientRect();
      if (cr.right > gr.right + 0.5) cutNames.push([(c.querySelector(".bi-name") || {}).textContent, +cr.right.toFixed(1), +gr.right.toFixed(1)]);
    });
    const panel = document.getElementById("fsBuildPanel").getBoundingClientRect();
    return { clipped, wide, cutNames, panelTop: panel.top, h: box.getBoundingClientRect().height };
  });
  t.check("mobile: no build card's name is cut off by its own column", mobInfo.cutNames.length === 0, mobInfo.cutNames);
  t.check("mobile: no description clips in the narrower strip", mobInfo.clipped.length === 0, mobInfo.clipped);
  t.check("mobile: …and the cost is never cut off the right-hand edge", mobInfo.wide.length === 0, mobInfo.wide);
  /* the strip takes its height OUT of the grid on a phone, so the panel must not
   * have grown into the middle of the map — that is where the next tap goes */
  t.check("mobile: …and the panel still leaves the middle of the screen clear",
    mobInfo.panelTop > 844 * 0.42, mobInfo);
  await tapVertex(mob, mobSpot.v);
  await sleep(300);
  const mobPlaced = await mob.evaluate((v) => {
    const FS = window.__FS__;
    const id = FS.q.bldAt(v);
    return { id, type: id ? FS.G.buildings[id].type : null };
  }, mobSpot.v);
  t.check("mobile: the full build flow (dock→tab→item→ghost) places a real building via touch", mobPlaced.id > 0 && mobPlaced.type === "hut", mobPlaced);

  // context panel (tap a flag) must stay inside the viewport and clear of the
  // dock. Build mode is deliberately STICKY (QoL#5) and is still armed from
  // the flow above, so tap ✋ Select first — the real mobile way to back out
  // of a mode (there's no Esc key on a touchscreen) — before selecting.
  await tapEl(mob, "#fsDockSelect");
  await sleep(100);
  /* pan back to the flag before tapping it (2026-08-01): the build flow above
   * now centres the camera on its own target, so on a 390 px screen the castle
   * flag can sit off-frame or under the dock. A player pans; so does the test. */
  const mobCastleFlag = await mob.evaluate(() => {
    const FS = window.__FS__, v = FS.G.flags[FS.FSSim.castleOf(FS.G, 0).flag].v;
    FS.FSRender.focusVertex(v, 30);
    FS.FSRender.frame(0.016);
    return v;
  });
  await tapVertex(mob, mobCastleFlag);
  await sleep(200);
  const mobCtx = await mob.evaluate(() => {
    const c = document.getElementById("fsContext").getBoundingClientRect();
    const d = document.getElementById("fsDock").getBoundingClientRect();
    return { ctx: { x: c.x, y: c.y, r: c.right, b: c.bottom }, dock: { x: d.x, y: d.y, r: d.right, b: d.bottom }, innerW: window.innerWidth, innerH: window.innerHeight, open: !document.getElementById("fsContext").classList.contains("hidden") };
  });
  t.check("mobile: context panel opens on tapping a flag", mobCtx.open, mobCtx);
  t.check("mobile: context panel stays inside the viewport", mobCtx.ctx.r <= mobCtx.innerW + 1 && mobCtx.ctx.b <= mobCtx.innerH + 1 && mobCtx.ctx.x >= -1, mobCtx);

  await t.shot(mob, "farmstead_ui_mobile");
  console.log("   …mobile section done, continuing…");

  /* ══════════════════════════ 14. ux#3: long-press belongs to the MAP ══════
   * A THIRD page, with the coarse-pointer stub the touch layer gates on (the
   * polish suite's pattern) — farmstead.html's window-level capture listener
   * only arms the 520ms timer for real touches on a coarse-pointer device.
   * Real PointerEvents, dispatched at the element the finger lands on. ═════ */
  const lp = await t.newPage({ width: 390, height: 844, deviceScaleFactor: 2 });
  await lp.evaluateOnNewDocument(() => {
    const mm = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q.indexOf("pointer: coarse") >= 0
      ? { matches: true, media: q, addListener() {}, removeListener() {} } : mm(q));
  });
  await lp.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await lp.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSUI, { timeout: 20000 });
  await lp.evaluate(() => { window.__FS__.newGame({ size: "medium", ais: 1, seed: 4242, speed: 0, aiPlan: false }); });
  await sleep(400);
  const PE_SRC = "function pe(type,x,y,id){return new PointerEvent(type,{bubbles:true,cancelable:true," +
    "pointerId:id,pointerType:'touch',clientX:x,clientY:y,button:0});}";

  const lpDock = await lp.evaluate(async (peSrc) => {
    eval(peSrc);
    const btn = document.getElementById("fsDockBuild");
    const r = btn.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    btn.dispatchEvent(pe("pointerdown", x, y, 301));
    await new Promise((res) => setTimeout(res, 700));      // well past the 520ms arm
    const opened = !document.getElementById("fsTouchCtx").classList.contains("hidden");
    window.dispatchEvent(pe("pointerup", x, y, 301));
    return { opened, x, y };
  }, PE_SRC);
  t.check("ux#3: holding a finger on dock chrome never opens the map context menu",
    lpDock.opened === false, lpDock);

  const lpPanel = await lp.evaluate(async (peSrc) => {
    eval(peSrc);
    const FS = window.__FS__;
    document.getElementById("fsDockBuild").click();          // open the build panel
    const item = document.querySelector("#fsBuildGrid [data-type]");
    const r = item.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    item.dispatchEvent(pe("pointerdown", x, y, 302));
    await new Promise((res) => setTimeout(res, 700));
    const opened = !document.getElementById("fsTouchCtx").classList.contains("hidden");
    window.dispatchEvent(pe("pointerup", x, y, 302));
    document.getElementById("fsDockSelect").click();
    FS.FSRender.frame(0.016);
    return { opened };
  }, PE_SRC);
  t.check("ux#3: …nor on a build-panel item", lpPanel.opened === false, lpPanel);

  const lpCanvas = await lp.evaluate(async (peSrc) => {
    eval(peSrc);
    const FS = window.__FS__, R = FS.FSRender, FSMap = FS.FSMap;
    const castle = FS.FSSim.castleOf(FS.G, 0);
    let v = -1;
    FSMap.forRadius(FS.G.map, castle.v, 8, (u, d) => { if (v < 0 && d >= 4 && !FSMap.whyFlag(FS.G.map, u, 0)) v = u; });
    R.focusVertex(v, 16);
    R.frame(0.05);
    const s = R.vertexScreen(v);
    const canvas = document.getElementById("view");
    canvas.dispatchEvent(pe("pointerdown", s.x, s.y, 303));
    await new Promise((res) => setTimeout(res, 700));
    const opened = !document.getElementById("fsTouchCtx").classList.contains("hidden");
    window.dispatchEvent(pe("pointerup", s.x, s.y, 303));
    return { opened, v, s };
  }, PE_SRC);
  t.check("ux#3: …but a long press on the open map still opens it", lpCanvas.opened === true, lpCanvas);
  await lp.evaluate(() => { const e2 = document.getElementById("fsTouchCtxCancel"); if (e2) e2.click(); });
  console.log("   …long-press section done, continuing…");

  /* ══════════ placement flow (playtest 2026-08-01) ═══════════════════════
   * Two complaints, one shape: the tools should follow what you are DOING.
   * (5) the suitability overlay belongs to placement mode and must never
   *     outlive it — it used to stick on and paint over the game.
   * (6) placing a building arms the ROAD tool with that building's own flag,
   *     so the Settlers rhythm (place, then connect) needs one click, not a
   *     round trip to the toolbar. */
  const flow = await page.evaluate(async () => {
    const FS = window.__FS__, T = window.T, R = FS.FSRender, U = window.FSUI, FSMap = FS.FSMap;
    T.fresh({ speed: 0 });
    const G = FS.G;
    const out = { start: R.suitabilityOn() };
    U.escape();
    // arming a type turns it on, filtered to that type
    document.querySelector('#fsDock [data-act="dock-build"]').click();
    const btn = document.querySelector('#fsBuildGrid .build-item[data-type="lumberjack"]');
    if (!btn) return { ok: false, why: "no build item" };
    btn.click();
    out.armed = { mode: U.mode(), on: R.suitabilityOn() };
    // …and cancelling placement turns it off again
    U.escape();
    out.cancelled = { mode: U.mode(), on: R.suitabilityOn() };
    // a hand toggle works out of placement mode…
    U.toggleSuitability();
    out.manual = R.suitabilityOn();
    // …and dies at the next mode change instead of sticking
    document.querySelector('#fsDock [data-act="dock-flag"]').click();
    out.afterModeChange = { mode: U.mode(), on: R.suitabilityOn() };
    U.escape();

    // --- place a building: the road tool arms itself, seeded with its flag ---
    const v = T.spotNear("lumberjack", T.castle().v, 4, 9, 0);
    if (v < 0) return { ok: false, why: "no site" };
    document.querySelector('#fsDock [data-act="dock-build"]').click();
    document.querySelector('#fsBuildGrid .build-item[data-type="lumberjack"]').click();
    U.onCanvasClick(v);
    for (let i = 0; i < 40 && !G.map.bldAt[v]; i++) { FS.ff(1); U.frame(0.05); }
    U.frame(0.05);
    const b = G.buildings[G.map.bldAt[v]];
    out.placed = !!b;
    out.after = { mode: U.mode(), on: R.suitabilityOn(),
      roadFrom: U.roadFrom ? U.roadFrom() : -1, flag: b ? b.flag : -1 };
    // the seeded start means ONE more click finishes the road
    if (b) {
      const cf = G.flags[T.castle().flag];
      U.onCanvasClick(cf.v);
      FS.ff(3);
      out.roads = Object.keys(G.roads).length;
    }
    return Object.assign({ ok: true }, out);
  });
  console.log("   placement flow:", JSON.stringify(flow));
  t.check("arming a build type turns the suitability overlay on",
    flow.ok && flow.armed.mode === "build" && flow.armed.on === true, flow);
  t.check("…and leaving placement mode turns it off again",
    flow.ok && flow.cancelled.mode === null && flow.cancelled.on === false, flow);
  t.check("a hand toggle still works on demand", flow.ok && flow.manual === true, flow);
  t.check("…but never survives a mode change", flow.ok && flow.afterModeChange.on === false, flow);
  t.check("placing a building arms the road tool", flow.ok && flow.placed && flow.after.mode === "road", flow);
  t.check("…seeded with the new building's own door flag",
    flow.ok && flow.after.roadFrom === flow.after.flag && flow.after.flag > 0, flow);
  t.check("…so one more click lays the connection", flow.ok && flow.roads >= 1, flow);
  t.check("…and the overlay is gone the moment placement ended", flow.ok && flow.after.on === false, flow);

  /* ══════ THE SKIN IS ALLOWED TO FAIL ══════════════════════════════════════
   * fs-skin.js is a blocking HEAD script that paints six canvases. Every rule
   * that uses one of its textures also names a flat colour underneath, and the
   * whole file is wrapped in a try — so a browser that refuses it (a stalled
   * fetch, a canvas that throws, an old engine) must lose GRAIN and nothing
   * else. Proven by refusing the script outright and playing on. */
  const bare = await t.newPage({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await bare.setRequestInterception(true);
  bare.removeAllListeners("request");
  bare.on("request", (req) => {
    if (/fs-skin\.js/.test(req.url())) return req.abort();
    if (req.url().startsWith(t.BASE)) return req.continue();
    return req.abort();
  });
  /* this page's errors are its OWN — the deliberate abort of fs-skin.js shows
     up as a console ERR_FAILED, which must not land in the suite-wide tally */
  const bareErrs = [];
  bare.removeAllListeners("pageerror");
  bare.removeAllListeners("console");
  bare.on("pageerror", (e) => bareErrs.push(String((e && e.message) || e)));
  bare.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|fs-skin/.test(m.text())) bareErrs.push("console: " + m.text()); });
  await bare.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await bare.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSUI, { timeout: 30000 });
  await bare.evaluate(() => window.__FS__.newGame({ size: "small", ais: 1, seed: 7, speed: 0, aiPlan: false }));
  await bare.waitForFunction(() => window.__FS__.started(), { timeout: 30000 });
  await sleep(400);
  await bare.click("#fsDockBuild");
  await sleep(200);
  const bareUI = await bare.evaluate(() => {
    const cs = (s) => getComputedStyle(document.querySelector(s));
    const panel = cs("#fsBuildPanel"), card = cs(".build-item"), tick = cs(".tick-item");
    function opaque(c) { const m = c.match(/[\d.]+/g).map(Number); return m.length < 4 || m[3] > 0.85; }
    return {
      skin: window.FSSkin ? window.FSSkin.ready : "absent",
      noTextures: panel.backgroundImage === "none" || panel.backgroundImage.indexOf("data:") < 0,
      panelBg: panel.backgroundColor, cardBg: card.backgroundColor, tickBg: tick.backgroundColor,
      solid: opaque(panel.backgroundColor) && opaque(card.backgroundColor) && opaque(tick.backgroundColor),
      cards: document.querySelectorAll("#fsBuildGrid .build-item").length,
      panelOpen: !document.getElementById("fsBuildPanel").classList.contains("hidden"),
    };
  });
  t.check("skin: the page still boots and plays with fs-skin.js refused outright",
    bareUI.panelOpen && bareUI.cards >= 3, bareUI);
  t.check("skin: …with no textures at all", bareUI.noTextures, bareUI);
  t.check("skin: …and every panel falls back to a SOLID colour, never transparent",
    bareUI.solid, bareUI);
  t.check("skin: …and it costs zero page errors", bareErrs.length === 0, bareErrs.slice(0, 4));
  await t.shot(bare, "farmstead_ui_no_skin");

  t.check("0 page errors across the whole suite (desktop + mobile)", t.errors.length === 0, t.errors.slice(0, 10));
});
