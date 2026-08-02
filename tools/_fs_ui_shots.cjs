#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 * _fs_ui_shots.cjs — the MEDIEVAL RE-SKIN's evidence.
 *
 *   node tools/_fs_ui_shots.cjs --before     → shots/fs_ui_{title,build}_before.png
 *   node tools/_fs_ui_shots.cjs              → shots/fs_ui_{title,build}_after.png
 *                                              + hud_after, sheet_after,
 *                                                toasts_after, mobile_390, desktop
 *
 * Every shot is ASSERTED: the script proves the thing the file name claims is
 * actually on screen before it writes the png (a screenshot of a panel that
 * failed to open is worse than no screenshot at all — it looks like evidence).
 * ═══════════════════════════════════════════════════════════════════════════ */
const harness = require("./_fs_harness.cjs");

const AFTER = !process.argv.includes("--before");
const TAG = AFTER ? "after" : "before";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** boot a page onto the title screen */
async function bootPage(t, vp) {
  const page = await t.newPage(vp || { width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__ && !!window.THREE && !!window.FSUI, { timeout: 30000 });
  await sleep(350);
  return page;
}

/** title → running game, clock stopped so every frame is the same frame */
async function startGame(page) {
  await page.evaluate(() => { window.__FS__.newGame({ size: "medium", ais: 1, seed: 4242, speed: 0, aiPlan: false }); });
  await page.waitForFunction(() => window.__FS__.started(), { timeout: 30000 });
  await sleep(500);
  await page.evaluate(() => {
    const FS = window.__FS__;
    FS.setSpeed(0);
    const c = FS.FSSim.castleOf(FS.G, 0);
    FS.FSRender.setCam({ yaw: 0.55, pitch: 0.92, dist: 27 });
    FS.FSRender.focusVertex(c.v, 27);
    for (let i = 0; i < 4; i++) FS.FSRender.frame(0.016);
  });
  await sleep(400);
}

/** open the build panel and select a card so the detail strip is filled */
async function openBuildWithCard(page, tab, type) {
  await page.click("#fsDockBuild");
  await sleep(200);
  await page.click(`#fsBuildTabs [data-tab="${tab}"]`);
  await sleep(160);
  await page.click(`#fsBuildGrid [data-type="${type}"]`);
  await sleep(220);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__FS__.FSRender.frame(0.016); });
  await sleep(150);
}

harness.run("farmstead-ui-shots", async (t) => {
  /* ══════════════════ 1. TITLE ══════════════════════════════════════════ */
  const page = await bootPage(t);
  const title = await page.evaluate(() => ({
    visible: !document.getElementById("title").classList.contains("hidden"),
    logo: (document.querySelector(".logo") || {}).textContent || "",
    start: !!document.getElementById("startBtn"),
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  t.check(`title_${TAG}: the title screen is what is on screen`,
    // 2026-08-02 launch rename: wordmark reads CASTLE KRUZER now
    title.visible && title.start && /CASTLE\s*KRUZER/i.test(title.logo), title);
  t.check(`title_${TAG}: no horizontal overflow`, title.scrollW <= title.innerW + 2, title);
  await t.shot(page, `fs_ui_title_${TAG}`);

  /* ══════════════════ 2. BUILD PANEL + DETAIL STRIP ═════════════════════ */
  await startGame(page);
  await openBuildWithCard(page, "military", "hut");
  const build = await page.evaluate(() => {
    const panel = document.getElementById("fsBuildPanel");
    const info = document.getElementById("fsBuildInfo");
    const cards = document.querySelectorAll("#fsBuildGrid .build-item");
    return {
      panelOpen: !panel.classList.contains("hidden"),
      cards: cards.length,
      armed: !!document.querySelector("#fsBuildGrid .build-item.armed"),
      greyed: document.querySelectorAll("#fsBuildGrid .build-item.bad").length,
      infoShown: !info.classList.contains("hidden"),
      infoText: info.textContent.trim().slice(0, 80),
      infoClips: info.scrollHeight > info.clientHeight,
    };
  });
  t.check(`build_${TAG}: the build panel is open with its cards`, build.panelOpen && build.cards >= 3, build);
  t.check(`build_${TAG}: a card is armed`, build.armed, build);
  t.check(`build_${TAG}: the detail strip is filled and does not clip`,
    build.infoShown && build.infoText.length > 10 && !build.infoClips, build);
  await t.shot(page, `fs_ui_build_${TAG}`);

  if (!AFTER) {
    console.log("\n  (--before: title + build captured; the rest are 'after' shots)");
    t.check("before pass complete", true);
    return;
  }

  /* ══════════════════ 3. HUD — top bar + rate strip, split open ═════════ */
  await page.evaluate(() => { document.getElementById("fsDockSelect").click(); });
  await sleep(160);
  await page.evaluate(() => {
    const FS = window.__FS__;
    FS.ff(2200);                                  // run a settlement so the rates read
    for (let i = 0; i < 3; i++) FS.FSRender.frame(0.016);
    window.FSUI.frame(0.30);                      // force the ≤4Hz beat
  });
  await sleep(250);
  await page.click("#fsRates");                   // split net → made / used
  await sleep(200);
  await page.evaluate(() => { window.FSUI.frame(0.30); });
  await sleep(200);
  const hud = await page.evaluate(() => {
    const bar = document.getElementById("fsTopbar").getBoundingClientRect();
    const ticks = document.querySelectorAll("#fsTicker .tick-item").length;
    const rates = document.querySelectorAll("#fsRates .rate-item").length;
    const speedOn = !!document.querySelector("#fsSpeed button.on");
    return { h: bar.height, w: bar.width, ticks, rates, speedOn };
  });
  t.check("hud_after: the ticker and the rate strip are both populated",
    hud.ticks >= 6 && hud.rates >= 4, hud);
  t.check("hud_after: the speed control shows its current setting", hud.speedOn, hud);
  await page.screenshot({ path: require("path").join(harness.ROOT, "shots", "fs_ui_hud_after.png"),
    clip: { x: 0, y: 0, width: 1280, height: Math.max(160, Math.ceil(hud.h) + 120) } });
  console.log("  shot → shots/fs_ui_hud_after.png");

  /* ══════════════════ 4. A SHEET (settings) ════════════════════════════ */
  await page.click("#fsMenuBtn");
  await sleep(160);
  await page.click('#fsMenu [data-act="open-settings"]');
  await sleep(300);
  const sheet = await page.evaluate(() => {
    const w = document.getElementById("fsSheetWrap");
    const body = document.getElementById("fsSheetBody");
    return {
      open: !w.classList.contains("hidden"),
      title: (document.getElementById("fsSheetTitle") || {}).textContent || "",
      rows: body.children.length,
      clips: body.scrollWidth > body.clientWidth + 2,
    };
  });
  t.check("sheet_after: a sheet is open with real content",
    sheet.open && sheet.rows > 0 && sheet.title.length > 0, sheet);
  t.check("sheet_after: nothing overflows it sideways", !sheet.clips, sheet);
  await t.shot(page, "fs_ui_sheet_after");
  await page.evaluate(() => { document.querySelector('#fsSheetWrap [data-act="sheet-close"]').click(); });
  await sleep(200);

  /* ══════════════════ 5. TOASTS ════════════════════════════════════════ */
  await page.evaluate(() => {
    window.FSUI.toast("A new settler has come of age.");
    window.FSUI.toast("You have not the planks for that.", "err");
    window.FSUI.frame(0.016);
  });
  await sleep(250);
  const toasts = await page.evaluate(() => {
    const n = document.querySelectorAll("#fsToasts .fs-toast");
    const err = document.querySelectorAll("#fsToasts .fs-toast-err").length;
    const r = n.length ? n[0].getBoundingClientRect() : null;
    return { n: n.length, err, w: r && r.width, onScreen: !!r && r.top >= 0 && r.bottom <= window.innerHeight };
  });
  t.check("toasts_after: both a plain and an error toast are showing",
    toasts.n === 2 && toasts.err === 1, toasts);
  t.check("toasts_after: they sit inside the viewport", toasts.onScreen, toasts);
  await t.shot(page, "fs_ui_toasts_after");

  /* ══════════════════ 6. DESKTOP — the whole screen, in play ═══════════ */
  await page.evaluate(() => {
    // clear the toasts so the desktop plate shows the steady-state HUD
    window.FSUI.frame(9);
    document.getElementById("fsDockBuild").click();
  });
  await sleep(200);
  await page.click('#fsBuildTabs [data-tab="basic"]');
  await sleep(150);
  await page.click('#fsBuildGrid [data-type="lumberjack"]');
  await sleep(250);
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__FS__.FSRender.frame(0.016); window.FSUI.frame(0.30); });
  await sleep(250);
  const desk = await page.evaluate(() => {
    function r(sel) { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; }
    const parts = { topbar: r("#fsTopbar"), speed: r("#fsSpeed"), dock: r("#fsDock"), minimap: r("#fsMinimap"), panel: r("#fsBuildPanel") };
    function overlap(a, b) { return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b; }
    const pairs = [["speed", "dock"], ["speed", "minimap"], ["dock", "minimap"], ["panel", "minimap"], ["topbar", "dock"]];
    return { parts, bad: pairs.filter(([a, b]) => overlap(parts[a], parts[b])), innerW: window.innerWidth, innerH: window.innerHeight };
  });
  t.check("desktop: the HUD clusters do not overlap each other", desk.bad.length === 0, desk.bad);
  t.check("desktop: everything stays inside the viewport",
    desk.parts.minimap.r <= desk.innerW + 1 && desk.parts.dock.b <= desk.innerH + 1, desk.parts);
  await t.shot(page, "fs_ui_desktop");

  /* ══════════════════ 6b. THE MATERIALS THEMSELVES ═════════════════════
   * A contact print of what fs-skin.js draws. This is the review tool for the
   * skin: a tile that has gone muddy, lost its seam or stopped repeating is
   * obvious here and invisible behind text. */
  const mats = await bootPage(t, { width: 900, height: 470, deviceScaleFactor: 2 });
  const matInfo = await mats.evaluate(() => {
    const t = window.FSSkin.tex;
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;background:#1d1409;font:700 12px Georgia,serif;color:#f0d9a0";
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:12px";
    const items = [["oak", 128], ["oakDark", 128], ["parch", 128], ["parchDim", 128], ["stone", 96], ["linen", 64]];
    items.forEach(([k, sz]) => {
      const d = document.createElement("div");
      d.style.cssText = `height:200px;background-image:url("${t[k]}");background-size:${sz}px ${sz}px;border:2px solid #000;position:relative`;
      d.innerHTML = `<span style="position:absolute;bottom:3px;left:5px;background:#000b;padding:1px 6px">${k} · ${sz}px tile</span>`;
      wrap.appendChild(d);
    });
    const s = document.createElement("div");
    s.style.cssText = `height:200px;background-image:url("${t.stud}"),url("${t.stud}"),url("${t.stud}"),url("${t.stud}"),url("${t.oak}");background-repeat:no-repeat,no-repeat,no-repeat,no-repeat,repeat;background-position:6px 6px,calc(100% - 6px) 6px,6px calc(100% - 6px),calc(100% - 6px) calc(100% - 6px),0 0;background-size:16px 16px,16px 16px,16px 16px,16px 16px,128px 128px;border:2px solid #000;position:relative`;
    s.innerHTML = `<span style="position:absolute;bottom:3px;left:5px;background:#000b;padding:1px 6px">iron studs on oak</span>`;
    wrap.appendChild(s);
    const r = document.createElement("div");
    r.style.cssText = `height:200px;background-image:url("${t.parch}");background-size:128px 128px;border:16px solid transparent;border-image:url("${t.rope}") 16 / 16px round;position:relative;color:#38240f`;
    r.innerHTML = `<span style="position:absolute;bottom:3px;left:5px">hemp rope frame</span>`;
    wrap.appendChild(r);
    document.body.appendChild(wrap);
    return { tiles: items.length + 2, kb: Math.round(Object.keys(t).reduce((a, k) => a + t[k].length, 0) / 1024) };
  });
  await sleep(400);
  t.check("materials: all eight are drawn and printable", matInfo.tiles === 8, matInfo);
  console.log(`   (skin weight in memory: ~${matInfo.kb} KB of data-URL, zero network requests)`);
  await t.shot(mats, "fs_ui_materials");

  /* ══════════════════ 7. MOBILE 390 ════════════════════════════════════ */
  const mob = await bootPage(t, { width: 390, height: 844, deviceScaleFactor: 2 });
  await startGame(mob);
  await openBuildWithCard(mob, "basic", "lumberjack");
  const m = await mob.evaluate(() => {
    function r(sel) { const b = document.querySelector(sel).getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom, h: b.height, w: b.width }; }
    const parts = { topbar: r("#fsTopbar"), speed: r("#fsSpeed"), dock: r("#fsDock"), minimap: r("#fsMinimap"), panel: r("#fsBuildPanel") };
    function overlap(a, b) { return a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b; }
    const pairs = [["topbar", "speed"], ["topbar", "dock"], ["speed", "dock"], ["speed", "minimap"], ["dock", "minimap"], ["panel", "minimap"]];
    const info = document.getElementById("fsBuildInfo");
    /* #fsMinimapToggle is a DELIBERATE exception (documented in the mobile
       media query): it is the collapse nub perched on the minimap's top edge,
       and a 40 px-tall one would sit over the map it collapses. */
    const small = [];
    document.querySelectorAll("#fsDock button, .fs-icobtn, .fs-tab").forEach((b) => {
      if (b.id === "fsMinimapToggle") return;
      const q = b.getBoundingClientRect();
      if (q.width > 0 && (q.width < 39 || q.height < 39)) small.push([b.id || b.className, Math.round(q.width), Math.round(q.height)]);
    });
    return {
      parts, small,
      bad: pairs.filter(([a, b]) => overlap(parts[a], parts[b])),
      infoClips: info.scrollHeight > info.clientHeight,
      panelTop: parts.panel.y,
      scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight,
    };
  });
  t.check("mobile_390: no HUD cluster overlaps another", m.bad.length === 0, m.bad);
  t.check("mobile_390: no horizontal overflow", m.scrollW <= m.innerW + 2, m);
  t.check("mobile_390: the build panel still clears the middle of the screen", m.panelTop > 844 * 0.42, m.panelTop);
  t.check("mobile_390: the detail strip does not clip", !m.infoClips, m);
  t.check("mobile_390: dock/topbar/tab targets are all >= 39px", m.small.length === 0, m.small);
  await t.shot(mob, "fs_ui_mobile_390");

  if (t.errors.length) console.log("  page errors:", t.errors.slice(0, 6));
  t.check("no page errors in any shot pass", t.errors.length === 0, t.errors.slice(0, 4));
});
