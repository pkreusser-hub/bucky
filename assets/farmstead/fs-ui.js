/* FARMSTEAD fs-ui.js — PHASE E: the whole HTD overlay (plan §11).
 * DOM + canvas 2D only — never touches THREE directly except by calling the
 * small display helpers fs-render.js exposes (setSelection/setPlacementGhost/
 * setRoadPreview/overlaySuitability/congestedFlags) and by reading
 * FSRender.camera()/worldToScreen() for the minimap frustum.
 *
 * OWNERSHIP: this file reads `G` (via window.__FS__) and calls __FS__ mutators
 * ONLY — it never assigns into G directly. All CSS for the ids/classes built
 * here lives in farmstead.html's <style> block (house rule: self-contained
 * CSS in the page, not injected by JS).
 *
 * Public API (window.FSUI):
 *   init(FS, hooks)         — FS = window.__FS__: hooks = {toastMode, backToTitle}
 *   frame(dt)                — called once per rAF from the page's main loop
 *   onGameStart()            — a game just started/loaded; (re)build the HUD
 *   onGameEnd()               — back to the title screen; hide everything
 *   mode()                   — current placement mode string | null (suite contract)
 *   onCanvasClick(v, ev)     — the page's click-vs-drag detector resolved a vertex
 *   doFlagAtHover / doGeologistAtHover / doDemolishAtHover / doAttackAtHover
 *   toggleRoadMode / armBuildKey / instantBuildDigit(n) / cycleBuildPage
 *   toggleSuitability / escape / toast(msg) / openHelp()
 */
(function () {
  "use strict";

  const FSUI = {};

  // ─────────────────────────────────────────────────────────── module state
  let FS = null, H = { toastMode: function () {}, backToTitle: function () {} };
  let FSC = null, FSMap = null, FSSim = null, FSMil = null, FSRender = null;
  let built = false;                 // DOM injected yet?
  let mode = null;                   // null | 'flag' | 'road' | 'build' | 'demolish'
  let buildType = null;              // armed building type for the sticky click-to-place flow
  let roadFrom = 0;                  // flag id the road preview starts from
  let selKind = null, selId = 0;     // 'flag' | 'bld' | null — the context panel's subject
  const openStack = [];              // [{id, close}] — Esc closes the topmost
  let lastHoverV = -2;                // change-detector so we don't redo work every frame
  let frameAcc = 0;                   // throttle for the ~4Hz minimap / idle-alert passes
  let toastQueue = [];                 // {id,text,icon,kind,t}
  let toastGen = 0;
  let bellOpen = false, alertOpen = false, menuOpen = false;
  let lastAutosaveTick = -1;
  const pendingWatch = [];             // [{kind, v, cb, expireT}]
  let connectOffer = null;             // {fromFlag, toFlag, path} — the accept/dismiss chip
  let pingHeld = false;

  const BUILD_KEYS = ["hut", "lumberjack", "forester", "stonecutter", "sawmill",
    "farm", "mill", "stock", "tower"];
  const BUILD_KEYS2 = ["bakery", "pigfarm", "butcher", "fisher", "smelter",
    "toolmaker", "weaponsmith", "boatwright", "coalMine"];
  const BUILD_KEYS3 = ["ironMine", "goldMine", "stoneMine", "goldsmelter", "fortress"];
  let buildPage = 0;
  function buildKeys() { return buildPage === 0 ? BUILD_KEYS : (buildPage === 1 ? BUILD_KEYS2 : BUILD_KEYS3); }
  FSUI.buildKeysList = buildKeys;

  // Building categories for the tabbed build panel (FSC.BLD_LIST has no
  // category field — this is presentation-only, doesn't touch sim data).
  const BUILD_TABS = [
    { id: "basic", label: "Basic", ico: "🧱", types: ["stock", "lumberjack", "forester", "stonecutter", "sawmill", "boatwright"] },
    { id: "food", label: "Food", ico: "🌾", types: ["fisher", "farm", "mill", "bakery", "pigfarm", "butcher"] },
    { id: "industry", label: "Industry", ico: "⚙️", types: ["smelter", "goldsmelter", "toolmaker", "weaponsmith"] },
    { id: "military", label: "Military", ico: "🛡", types: ["hut", "tower", "fortress"] },
    { id: "mines", label: "Mines", ico: "⛏", types: ["stoneMine", "coalMine", "ironMine", "goldMine"] },
  ];
  let buildTab = "basic";

  const BLD_ICON = {
    castle: "🏰", stock: "🏬", hut: "🛖", tower: "🗼", fortress: "🏯",
    fisher: "🎣", lumberjack: "🪓", forester: "🌱", stonecutter: "⛏️", sawmill: "🪚",
    farm: "🌾", mill: "🌬️", bakery: "🍞", pigfarm: "🐖", butcher: "🔪",
    stoneMine: "🪨", coalMine: "⬛", ironMine: "🔗", goldMine: "✨",
    smelter: "🔥", goldsmelter: "🪙", toolmaker: "🔨", weaponsmith: "⚔️", boatwright: "🛶",
  };
  const DIST_LABEL = {
    planksConstruction: "Planks → Construction sites", planksTools: "Planks → Toolmaker",
    planksBoats: "Planks → Boatwright", steelWeapons: "Steel → Weaponsmith",
    steelTools: "Steel → Toolmaker", coalGold: "Coal → Gold Smelter",
    coalWeapons: "Coal → Weaponsmith", coalSteel: "Coal → Iron Smelter",
    wheatPigs: "Wheat → Pig Farm", wheatMill: "Wheat → Windmill",
    foodGoldMine: "Food → Gold Mine", foodCoalMine: "Food → Coal Mine",
    foodIronMine: "Food → Iron Mine", foodStoneMine: "Food → Stone Mine",
  };
  const DIST_GROUPS = [
    { label: "🪵 Planks", keys: ["planksConstruction", "planksTools", "planksBoats"] },
    { label: "🔩 Steel", keys: ["steelTools", "steelWeapons"] },
    { label: "⬛ Coal", keys: ["coalSteel", "coalGold", "coalWeapons"] },
    { label: "🌾 Wheat", keys: ["wheatMill", "wheatPigs"] },
    { label: "🍽 Food → Mines", keys: ["foodStoneMine", "foodCoalMine", "foodIronMine", "foodGoldMine"] },
  ];

  // ─────────────────────────────────────────────────────────── small helpers
  const el = (id) => document.getElementById(id);
  function h(strings) { return strings; }   // no-op tag, keeps template blocks readable
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function G() { return FS ? FS.G : null; }
  /** Which player id THIS screen commands (0 in solo/shared co-op; G.seats[seat] in separate). */
  function myPlayer() {
    const g = G();
    if (!g) return 0;
    const net = FS.FSNet;
    const seat = (net && net.state) ? (net.state().seat || 0) : 0;
    return (g.seats && g.seats[seat] !== undefined) ? g.seats[seat] : 0;
  }
  function hovered() { return FSRender.hoverVertex(); }
  function issue(type, args) { return FS.cmd(type, args); }

  /** In co-op, a command issued while paused still queues (lockstep semantics) —
   * QoL addendum item 2: tell the player once per action so it isn't confusing. */
  let queuedToastShown = false;
  function noteIfQueued() {
    const g = G();
    if (!g) return;
    const net = FS.FSNet;
    if (net && net.active && net.active() && net.state().connected && g.speed === 0) {
      if (!queuedToastShown) { toast("⏳ Queued — resumes with time", "info"); queuedToastShown = true; }
    } else queuedToastShown = false;
  }

  function toast(text, kind) {
    toastQueue.push({ id: ++toastGen, text, kind: kind || "info", t: 0 });
    if (toastQueue.length > 6) toastQueue.shift();     // never grow unbounded; render caps visible to 2
    renderToasts();
  }
  FSUI.toast = toast;

  /** Track a placed vertex until it materialises as a flag/building, then fire cb. */
  function watchVertex(kind, v, cb, ttlTicks) {
    const g = G();
    pendingWatch.push({ kind, v, cb, expireT: (g ? g.tick : 0) + (ttlTicks || 60) });
  }
  function pollPending() {
    const g = G();
    if (!g || !pendingWatch.length) return;
    for (let i = pendingWatch.length - 1; i >= 0; i--) {
      const p = pendingWatch[i];
      let hit = null;
      if (p.kind === "bld") { const id = g.map.bldAt[p.v]; if (id) hit = g.buildings[id]; }
      else if (p.kind === "flag") { const id = g.map.flagAt[p.v]; if (id) hit = g.flags[id]; }
      if (hit) { pendingWatch.splice(i, 1); try { p.cb(hit); } catch (e) { /* noop */ } continue; }
      if (g.tick > p.expireT) pendingWatch.splice(i, 1);
    }
  }

  // ─────────────────────────────────────────────────────────── open-stack (Esc)
  function pushOpen(id, close) { openStack.push({ id, close }); }
  function popOpenById(id) {
    for (let i = openStack.length - 1; i >= 0; i--) if (openStack[i].id === id) { openStack.splice(i, 1); return; }
  }
  function closeTopmost() {
    if (!openStack.length) return false;
    const top = openStack.pop();
    try { top.close(); } catch (e) { /* noop */ }
    return true;
  }
  FSUI.escape = function () {
    if (closeTopmost()) return;
    setMode(null);
  };

  // ─────────────────────────────────────────────────────────── mode machine
  function setMode(m) {
    if (mode === m) { if (!m) return; }
    mode = m;
    if (m !== "build") buildType = null;
    if (m !== "road") { roadFrom = 0; FSRender.clearRoadPreview(); }
    if (!m) { FSRender.clearPlacementGhost(); if (!filteredSuitFromBuild) FSRender.overlaySuitability(false); }
    updateDockUI();
    updateBuildPanelVisibility();
  }
  FSUI.mode = function () { return mode; };

  let filteredSuitFromBuild = false;
  FSUI.toggleSuitability = function () {
    const on = !FSRender.suitabilityOn();
    filteredSuitFromBuild = false;
    FSRender.overlaySuitability(on, { p: myPlayer() });
    updateDockUI();
    toast(on ? "🗺 Build suitability overlay ON" : "🗺 Build suitability overlay OFF", "info");
    return on;
  };

  FSUI.toggleRoadMode = function () { setMode(mode === "road" ? null : "road"); };
  FSUI.armBuildKey = function () { setMode(mode === "build" ? null : "build"); };
  FSUI.cycleBuildPage = function () {
    buildPage = (buildPage + 1) % 3;
    if (mode === "build") H.toastMode("build: 1-9 = " + buildKeys().join(" "));
  };

  // ─────────────────────────────────────────────────────────── instant (keyboard) actions
  function placeFlagAt(v, opts) {
    if (v < 0) return false;
    const p = myPlayer();
    const why = FSMap.whyFlag(G().map, v, p);
    if (why) { toast("✗ " + why, "err"); return false; }
    issue("flag", { v });
    noteIfQueued();
    watchVertex("flag", v, function (f) { onFlagMaterialised(f, opts); }, 80);
    return true;
  }
  FSUI.doFlagAtHover = function () { placeFlagAt(hovered()); };

  function buildAt(type, v) {
    if (v < 0) return false;
    const p = myPlayer();
    const why = FSMap.whyBuilding(G().map, type, v, p);
    if (why) { toast("✗ " + why, "err"); return false; }
    issue("build", { type, v });
    noteIfQueued();
    watchVertex("bld", v, function (b) { onBuildingMaterialised(b); }, 80);
    return true;
  }
  FSUI.instantBuildDigit = function (n) {
    if (mode !== "build") return;
    buildAt(buildKeys()[n], hovered());
  };

  FSUI.doGeologistAtHover = function () {
    const v = hovered();
    const g = G();
    if (v < 0 || !g) return;
    const fid = g.map.flagAt[v];
    if (!fid) { toast("stand on a flag", "err"); return; }
    if (g.map.terr[v] !== FSC.TERR.MOUNTAIN) { toast("geologists survey mountains", "err"); return; }
    issue("geologist", { flag: fid });
    noteIfQueued();
    toast("⛏ geologist on the way", "info");
  };

  FSUI.doDemolishAtHover = function () {
    const v = hovered();
    const g = G();
    if (v < 0 || !g) return;
    const id = idAtVertexForDemolish(v);
    if (id) { issue("demolish", { id }); noteIfQueued(); }
  };
  function idAtVertexForDemolish(v) {
    const g = G();
    let id = g.map.bldAt[v] || g.map.flagAt[v] || 0;
    if (!id) for (const rid in g.roads) if (g.roads[rid].path.indexOf(v) >= 0) { id = rid | 0; break; }
    return id;
  }

  FSUI.doAttackAtHover = function () {
    const v = hovered();
    const g = G();
    if (v < 0 || !g || !FSMil) return;
    const id = g.map.bldAt[v];
    const b = id && g.buildings[id];
    if (!b || !b.mil) { toast("aim at an enemy hut, tower or castle", "err"); return; }
    if (!FSMil.isEnemy(g, b.p, myPlayer())) { toast("that one is not the enemy's", "err"); return; }
    const max = FSMil.maxAttackers(g, b.id, myPlayer());
    if (max <= 0) { toast("no knights in range", "err"); return; }
    const n = Math.max(1, Math.ceil(max / 2));
    issue("attack", { id: b.id, count: n, strong: !!g.players[myPlayer()].knights.attackStrong });
    noteIfQueued();
    toast("⚔ " + n + " knight" + (n === 1 ? "" : "s") + " march out", "info");
  };

  // ─────────────────────────────────────────────────────────── canvas clicks
  FSUI.onCanvasClick = function (v) {
    if (v < 0) return;
    const g = G();
    if (!g) return;
    if (mode === "flag") { placeFlagAt(v); return; }
    if (mode === "build") { if (buildType) buildAt(buildType, v); return; }
    if (mode === "road") { onRoadClick(v); return; }
    if (mode === "demolish") { onDemolishClick(v); return; }
    onSelectClick(v);
  };

  function onRoadClick(v) {
    const g = G();
    let fid = g.map.flagAt[v];
    if (!roadFrom) {
      if (!fid) { toast("click a flag to start a road", "err"); return; }
      if (g.flags[fid].p !== myPlayer()) { toast("not your flag", "err"); return; }
      roadFrom = fid;
      FSRender.setSelection(v);
      return;
    }
    if (fid === roadFrom) return;
    if (fid) {
      const r = FS.buildRoad(roadFrom, fid);
      noteIfQueued();
      roadFrom = 0;
      FSRender.clearRoadPreview();
      FSRender.setSelection(-1);
      return;
    }
    // QoL#1: no flag here — offer to drop one and connect automatically
    const why = FSMap.whyFlag(g.map, v, myPlayer());
    if (why) { toast("✗ " + why, "err"); return; }
    const fromFlag = roadFrom;
    placeFlagAt(v, { autoRoadFrom: fromFlag });
    roadFrom = 0;
    FSRender.clearRoadPreview();
    FSRender.setSelection(-1);
  }

  function onDemolishClick(v) {
    const id = idAtVertexForDemolish(v);
    if (!id) { toast("nothing here to demolish", "err"); return; }
    openDemolishConfirm(id);
  }

  function onSelectClick(v) {
    const g = G();
    const bid = g.map.bldAt[v], fid = g.map.flagAt[v];
    if (bid) { selectSubject("bld", bid); return; }
    if (fid) { selectSubject("flag", fid); return; }
    selectSubject(null, 0);
  }

  // ─────────────────────────────────────────────────────────── flag/building materialise hooks
  function onFlagMaterialised(f, opts) {
    if (opts && opts.autoRoadFrom) {
      const from = G().flags[opts.autoRoadFrom];
      if (from) { FS.buildRoad(opts.autoRoadFrom, f.id); noteIfQueued(); }
      return;
    }
    offerAutoConnect("flag", f.id, f.v);
  }
  function onBuildingMaterialised(b) {
    offerAutoConnect("bld", b.id, b.v, b.flag);
  }

  /** QoL#1: after a lone flag or a building's door flag appears with no roads
   *  yet, offer a one-click connection to the nearest flag already on the
   *  player's road network (or the castle door flag, which always counts). */
  function offerAutoConnect(kind, id, v, flagIdOverride) {
    const g = G();
    const p = myPlayer();
    let flagId = flagIdOverride;
    if (!flagId) flagId = g.map.flagAt[v];
    const f = flagId && g.flags[flagId];
    if (!f || f.p !== p) return;
    if (f.roads.length > 0) return;               // already on the network
    const target = nearestNetworkFlag(p, f);
    if (!target) return;
    const path = FS.FSSim.roadPath(g, f.v, target.v, p);
    if (!path) return;
    connectOffer = { fromFlag: f.id, toFlag: target.id, path };
    FSRender.setRoadPreview(path, true);
    renderConnectChip();
  }
  function nearestNetworkFlag(p, exclude) {
    const g = G();
    const castleFlag = (g.buildings[g.players[p].castleId] || {}).flag;
    let best = null, bestD = Infinity;
    for (const id in g.flags) {
      const f = g.flags[id];
      if (f.p !== p || f.id === exclude.id) continue;
      if (!(f.roads.length > 0 || f.id === castleFlag)) continue;
      const d = FSMap.dist(g.map, f.v, exclude.v);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }
  function acceptConnect() {
    if (!connectOffer) return;
    FS.buildRoad(connectOffer.fromFlag, connectOffer.toFlag);
    noteIfQueued();
    dismissConnect();
  }
  function dismissConnect() {
    connectOffer = null;
    FSRender.clearRoadPreview();
    renderConnectChip();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== DOM injection — all markup lives here, all CSS lives in the page ==
  // ═══════════════════════════════════════════════════════════════════════
  const GOODS_TICKER = [
    { id: "plank", ico: "🪵", res: ["plank"] },
    { id: "stone", ico: "🪨", res: ["stone"] },
    { id: "food", ico: "🍞", res: ["fish", "bread", "meat"] },
    { id: "steel", ico: "🔩", res: ["steel"] },
    { id: "gold", ico: "🪙", res: ["goldBar"] },
    { id: "swords", ico: "⚔️", res: ["sword"] },
  ];

  function domTemplate() {
    let ticker = "";
    for (let i = 0; i < GOODS_TICKER.length; i++) {
      const t = GOODS_TICKER[i];
      ticker += '<div class="tick-item" title="' + esc(t.id) + '"><span class="ico">' + t.ico +
        '</span><span class="v" id="fsGoods-' + t.id + '">0</span></div>';
    }
    ticker += '<div class="tick-item" title="population"><span class="ico">👥</span><span class="v" id="fsGoods-serfs">0</span></div>';
    ticker += '<div class="tick-item" title="land owned"><span class="ico">🗺️</span><span class="v" id="fsGoods-land">0%</span></div>';

    return '' +
      '<div id="fsTopbar">' +
        '<div id="fsTicker">' + ticker + '</div>' +
        '<div class="fs-top-right">' +
          '<div class="fs-dropwrap">' +
            '<button id="fsAlertChip" class="fs-chip hidden" data-act="toggle-alerts" title="Idle buildings">⚠ <span id="fsAlertCount">0</span></button>' +
            '<div id="fsAlertList" class="fs-drop hidden"></div>' +
          '</div>' +
          '<div class="fs-dropwrap">' +
            '<button id="fsBell" class="fs-icobtn" data-act="toggle-bell" title="Notifications">🔔<span id="fsBellBadge" class="fs-badge hidden">0</span></button>' +
            '<div id="fsBellLog" class="fs-drop hidden"></div>' +
          '</div>' +
          '<button id="fsMenuBtn" class="fs-icobtn" data-act="toggle-menu" title="Menu">☰</button>' +
        '</div>' +
      '</div>' +

      '<div id="fsSpeed">' +
        '<button data-speed="0" title="Pause (Space)">⏸</button>' +
        '<button data-speed="1" title="1× (1)">1×</button>' +
        '<button data-speed="2" title="2× (2)">2×</button>' +
        '<button data-speed="4" title="4× (3)">4×</button>' +
      '</div>' +

      '<div id="fsDock">' +
        '<button id="fsDockSelect" class="on" data-act="dock-select" title="Select (Esc)">✋<b>Select</b></button>' +
        '<button id="fsDockBuild" data-act="dock-build" title="Build (B)">🏠<b>Build</b></button>' +
        '<button id="fsDockFlag" data-act="dock-flag" title="Flag">🚩<b>Flag</b></button>' +
        '<button id="fsDockRoad" data-act="dock-road" title="Road (R)">🛤<b>Road</b></button>' +
        '<button id="fsDockDemolish" data-act="dock-demolish" title="Demolish">🔥<b>Raze</b></button>' +
        '<button id="fsDockSuit" data-act="dock-suit" title="Build suitability (T)">🗺<b>Suit</b></button>' +
      '</div>' +

      '<div id="fsBuildPanel" class="hidden">' +
        '<div id="fsBuildTabs"></div>' +
        '<div id="fsBuildGrid"></div>' +
      '</div>' +

      '<div id="fsConnectChip" class="hidden">' +
        '<span>🛤 Connect to your road network?</span>' +
        '<button class="fs-primary" data-act="connect-yes">Connect</button>' +
        '<button class="fs-ghost" data-act="connect-no">✕</button>' +
      '</div>' +

      '<div id="fsContext" class="hidden">' +
        '<button class="fs-x" data-act="ctx-close">✕</button>' +
        '<div id="fsContextBody"></div>' +
      '</div>' +

      '<div id="fsAttackDialog" class="fs-modal hidden">' +
        '<div class="fs-modal-box">' +
          '<h3>⚔ Attack</h3>' +
          '<div id="fsAttackWho" class="fs-dim"></div>' +
          '<label class="fs-rowlbl">Knights to send: <b id="fsAttackCountLbl">1</b></label>' +
          '<input type="range" id="fsAttackCount" min="1" max="1" value="1">' +
          '<label class="fs-toggle"><input type="checkbox" id="fsAttackStrong"> send strongest first</label>' +
          '<div class="fs-modal-actions">' +
            '<button class="fs-ghost" data-act="attack-cancel">Cancel</button>' +
            '<button class="fs-danger" data-act="attack-go">⚔️ ATTACK</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="fsDemolishDialog" class="fs-modal hidden">' +
        '<div class="fs-modal-box">' +
          '<h3>🔥 Demolish?</h3>' +
          '<p id="fsDemolishWhat" class="fs-dim"></p>' +
          '<div class="fs-modal-actions">' +
            '<button class="fs-ghost" data-act="demolish-cancel">Cancel</button>' +
            '<button class="fs-danger" data-act="demolish-go">🔥 Demolish</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="fsMenu" class="hidden">' +
        '<button data-act="open-dist">📦 Distribution</button>' +
        '<button data-act="open-prioT">🚚 Transport priority</button>' +
        '<button data-act="open-prioW">🏬 Warehouse priority</button>' +
        '<button data-act="open-tools">🔧 Tool priority</button>' +
        '<button data-act="open-knights">🛡 Knights</button>' +
        '<button data-act="open-stats">📈 Stats</button>' +
        '<button data-act="open-saveload">💾 Save / Load</button>' +
        '<button data-act="open-settings">⚙ Settings</button>' +
        '<button data-act="open-help">❔ Help</button>' +
      '</div>' +

      '<div id="fsSheetWrap" class="hidden">' +
        '<div id="fsSheet" class="fs-sheet">' +
          '<div class="fs-sheet-head"><h2 id="fsSheetTitle"></h2><button class="fs-x" data-act="sheet-close">✕</button></div>' +
          '<div id="fsSheetBody"></div>' +
        '</div>' +
      '</div>' +

      '<div id="fsMinimap">' +
        '<button id="fsMinimapToggle" class="fs-icobtn" data-act="minimap-toggle" title="Collapse">▾</button>' +
        '<canvas id="fsMinimapCanvas" width="200" height="200"></canvas>' +
      '</div>' +

      '<div id="fsToasts"></div>' +

      '<div id="fsGameOver" class="fs-modal hidden">' +
        '<div class="fs-modal-box fs-gameover-box">' +
          '<div id="fsGameOverTitle"></div>' +
          '<div id="fsGameOverStats"></div>' +
          '<canvas id="fsGameOverChart" width="360" height="120"></canvas>' +
          '<div class="fs-modal-actions">' +
            '<button class="fs-ghost" data-act="gameover-continue">Keep playing</button>' +
            '<button class="fs-primary" data-act="gameover-new">New game</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function injectDom() {
    if (built) return;
    const root = document.createElement("div");
    root.id = "fsui-root";
    root.className = "hidden";
    root.innerHTML = domTemplate();
    document.body.appendChild(root);
    // the side-menu sheet is promoted OUT of the hidden root so the title
    // screen's "How to play" link can open the Help sheet before any game
    // exists (its own .hidden class still governs its own visibility).
    document.body.appendChild(document.getElementById("fsSheetWrap"));
    built = true;
    wireDom();
  }

  function wireDom() {
    document.getElementById("fsui-root").addEventListener("click", onRootClick);
    document.getElementById("fsSheetWrap").addEventListener("click", onRootClick);
    document.getElementById("fsSheetWrap").addEventListener("change", onRootChange);
    document.getElementById("fsui-root").addEventListener("change", onRootChange);
    el("fsAttackCount").addEventListener("input", () => { el("fsAttackCountLbl").textContent = el("fsAttackCount").value; });
    const mm = el("fsMinimapCanvas");
    mm.addEventListener("pointerdown", (e) => { pingHeld = true; minimapMove(e); });
    window.addEventListener("pointermove", (e) => { if (pingHeld) minimapMove(e); });
    window.addEventListener("pointerup", () => { pingHeld = false; });
  }
  function onRootChange(e) {
    const t = e.target;
    if (!t.hasAttribute("data-act")) return;
    /* ===== PHASE F: file inputs (the custom-music picker) fire 'change' just
     * like <select> already did here — widened, nothing existing narrowed. ===== */
    if (t.tagName === "SELECT" || (t.tagName === "INPUT" && t.type === "file")) dispatchAction(t.getAttribute("data-act"), t, e);
  }

  function onRootClick(e) {
    const sb = e.target.closest("[data-speed]");
    if (sb) { doSetSpeed(parseInt(sb.getAttribute("data-speed"), 10)); return; }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    dispatchAction(btn.getAttribute("data-act"), btn, e);
  }

  function doSetSpeed(s) { if (FS) { FS.setSpeed(s); updateSpeedUI(); } }
  function updateSpeedUI() {
    const g = G();
    const s = g ? (g.speed || 0) : 1;
    const row = el("fsSpeed");
    if (!row) return;
    [].forEach.call(row.querySelectorAll("[data-speed]"), (b) => {
      b.classList.toggle("on", parseInt(b.getAttribute("data-speed"), 10) === s);
    });
  }

  // ─────────────────────────────────────────────────────────── action router
  function dispatchAction(act, btn) {
    switch (act) {
      case "toggle-alerts": alertOpen = !alertOpen; bellOpen = false; renderAlerts(); renderBell(); break;
      case "toggle-bell": bellOpen = !bellOpen; alertOpen = false; renderBell(); renderAlerts(); break;
      case "toggle-menu": menuOpen = !menuOpen; el("fsMenu").classList.toggle("hidden", !menuOpen); break;
      case "notif-jump": {
        const v = parseInt(btn.getAttribute("data-v"), 10);
        if (v >= 0) {
          FSRender.focusVertex(v, 0, true);   /* ===== PHASE P: glide, don't teleport ===== */
          const g = G(), bid = g.map.bldAt[v], fid = g.map.flagAt[v];
          if (bid) selectSubject("bld", bid); else if (fid) selectSubject("flag", fid);
        }
        bellOpen = false; renderBell();
        break;
      }
      case "alert-jump": {
        const v = parseInt(btn.getAttribute("data-v"), 10), id = parseInt(btn.getAttribute("data-id"), 10);
        FSRender.focusVertex(v, 0, true);     /* ===== PHASE P: glide, don't teleport ===== */
        selectSubject("bld", id);
        alertOpen = false; renderAlerts();
        break;
      }
      case "dock-select": setMode(null); break;
      case "dock-build": setMode(mode === "build" ? null : "build"); break;
      case "dock-flag": setMode(mode === "flag" ? null : "flag"); break;
      case "dock-road": FSUI.toggleRoadMode(); break;
      case "dock-demolish": setMode(mode === "demolish" ? null : "demolish"); break;
      case "dock-suit": FSUI.toggleSuitability(); break;
      case "build-tab": buildTab = btn.getAttribute("data-tab"); renderBuildGrid(); break;
      case "build-item": armBuildItem(btn.getAttribute("data-type")); break;
      case "connect-yes": acceptConnect(); break;
      case "connect-no": dismissConnect(); break;
      case "ctx-close": selectSubject(null, 0); break;
      case "attack-cancel": closeAttackDialog(); break;
      case "attack-go": confirmAttack(); break;
      case "demolish-cancel": closeDemolishConfirm(); break;
      case "demolish-go": confirmDemolish(); break;
      case "open-dist": openSheet("dist"); break;
      case "open-prioT": openSheet("prioT"); break;
      case "open-prioW": openSheet("prioW"); break;
      case "open-tools": openSheet("tools"); break;
      case "open-knights": openSheet("knights"); break;
      case "open-stats": openSheet("stats"); break;
      case "open-saveload": openSheet("saveload"); break;
      case "open-settings": openSheet("settings"); break;
      case "open-help": openSheet("help"); break;
      case "sheet-close": closeSheet(); break;
      case "minimap-toggle": toggleMinimap(); break;
      case "gameover-continue": el("fsGameOver").classList.add("hidden"); break;
      case "gameover-new": el("fsGameOver").classList.add("hidden"); H.backToTitle(); break;
      default: dispatchPanelAction(act, btn);
    }
  }

  // ─────────────────────────────────────────────────────────── dock + build panel
  function updateDockUI() {
    const map = { select: null, build: "build", flag: "flag", road: "road", demolish: "demolish" };
    for (const k in map) {
      const b = el("fsDock" + k[0].toUpperCase() + k.slice(1));
      if (b) b.classList.toggle("on", mode === map[k]);
    }
    const suitBtn = el("fsDockSuit");
    if (suitBtn) suitBtn.classList.toggle("on", FSRender.suitabilityOn());
  }
  function updateBuildPanelVisibility() {
    el("fsBuildPanel").classList.toggle("hidden", mode !== "build");
    if (mode === "build") renderBuildTabs();
  }
  function renderBuildTabs() {
    let html = "";
    for (let i = 0; i < BUILD_TABS.length; i++) {
      const t = BUILD_TABS[i];
      html += '<button class="fs-tab' + (buildTab === t.id ? " on" : "") + '" data-act="build-tab" data-tab="' +
        t.id + '">' + t.ico + " " + t.label + "</button>";
    }
    el("fsBuildTabs").innerHTML = html;
    renderBuildGrid();
  }
  function renderBuildGrid() {
    const tab = BUILD_TABS.filter((t) => t.id === buildTab)[0] || BUILD_TABS[0];
    let html = "";
    for (let i = 0; i < tab.types.length; i++) {
      const type = tab.types[i];
      const def = FSC.BLD[type];
      const cost = "🪵" + (def.cost.plank || 0) + " 🪨" + (def.cost.stone || 0);
      html += '<button class="build-item' + (buildType === type ? " armed" : "") + '" data-act="build-item" data-type="' +
        type + '" title="' + esc(FSC.BLD_NAME[type]) + '">' +
        '<span class="bi-ico">' + (BLD_ICON[type] || "🏗") + '</span>' +
        '<span class="bi-name">' + esc(FSC.BLD_NAME[type]) + '</span>' +
        '<span class="bi-cost">' + cost + '</span></button>';
    }
    el("fsBuildGrid").innerHTML = html;
    refreshBuildGreying();
  }
  /** grey + reason-tooltip each build-panel item against the CURRENTLY hovered vertex. */
  function refreshBuildGreying() {
    const grid = el("fsBuildGrid");
    if (!grid || grid.classList.contains("hidden")) return;
    const g = G();
    const v = hovered();
    const p = myPlayer();
    [].forEach.call(grid.querySelectorAll(".build-item"), (btn) => {
      const type = btn.getAttribute("data-type");
      const why = (g && v >= 0) ? FSMap.whyBuilding(g.map, type, v, p) : null;
      const bad = v >= 0 && !!why;
      btn.classList.toggle("bad", bad);
      btn.title = why ? (FSC.BLD_NAME[type] + " — ✗ " + why) : FSC.BLD_NAME[type];
    });
  }
  function armBuildItem(type) {
    buildType = type;
    setMode("build");
    renderBuildGrid();
    // QoL#2: while a type is armed, the suitability overlay auto-filters to it
    filteredSuitFromBuild = true;
    FSRender.overlaySuitability(true, { p: myPlayer(), type });
  }

  /** Per-frame (throttled) hover-reactive visuals: ghost footprint / road preview / build-panel greying. */
  function updateHoverVisuals() {
    const v = hovered();
    if (v === lastHoverV) return;
    lastHoverV = v;
    const p = myPlayer();
    const g = G();
    if (!g) return;
    if (mode === "build" && buildType) {
      const def = FSC.BLD[buildType];
      const footprint = def.mountain ? "mine" : (def.size >= 2 ? "large" : "small");
      const why = v >= 0 ? FSMap.whyBuilding(g.map, buildType, v, p) : "off map";
      FSRender.setPlacementGhost(v, !why, footprint);
    } else if (mode === "flag") {
      const why = v >= 0 ? FSMap.whyFlag(g.map, v, p) : "off map";
      FSRender.setPlacementGhost(v, !why, "flag");
    } else {
      FSRender.clearPlacementGhost();
    }
    if (mode === "road" && roadFrom) {
      const from = g.flags[roadFrom];
      if (from && v >= 0) {
        const path = FS.FSSim.roadPath(g, from.v, v, p);
        FSRender.setRoadPreview(path, !!path);
      } else FSRender.clearRoadPreview();
    }
    refreshBuildGreying();
  }

  // ─────────────────────────────────────────────────────────── small render helpers
  function colHex(intColor) { return ("000000" + (intColor >>> 0).toString(16)).slice(-6); }
  function jobName(job) { return job ? (job.charAt(0).toUpperCase() + job.slice(1)) : "worker"; }
  function foodStockOf(b) { let n = 0; for (let i = 0; i < FSC.FOODS.length; i++) n += b.stockIn[FSC.FOODS[i]] || 0; return n; }
  function barRow(label, have, need, suffix) {
    const pct = need > 0 ? Math.max(0, Math.min(100, Math.round((have / need) * 100))) : 100;
    return '<div class="ctx-row"><span class="fs-dim">' + label + '</span><b>' + have + "/" + need + (suffix || "") + "</b></div>" +
      '<div class="fs-bar"><div class="fs-bar-fill" style="width:' + pct + '%"></div></div>';
  }

  // ─────────────────────────────────────────────────────────── selection + context panel
  function selectSubject(kind, id) {
    selKind = kind; selId = id;
    /* PHASE E fix: a leftover, never-dismissed QoL#1 connect-chip suggestion
     * (bottom-center, mobile) could sit behind a subsequently-opened context
     * panel with just a sliver peeking out — found via mobile screenshot
     * review. Same treatment as the attack/demolish dialogs on the next
     * line: any new selection implicitly clears other transient overlays. */
    dismissConnect();
    closeAttackDialog(); closeDemolishConfirm();
    if (!kind) { el("fsContext").classList.add("hidden"); FSRender.setSelection(-1); return; }
    const g = G();
    const obj = kind === "flag" ? g.flags[id] : g.buildings[id];
    if (!obj) { selKind = null; selId = 0; el("fsContext").classList.add("hidden"); return; }
    FSRender.setSelection(obj.v);
    el("fsContext").classList.remove("hidden");
    el("fsContext").setAttribute("data-kind", kind);
    renderContext();
  }
  /**
   * innerHTML= ALWAYS tears down and recreates every child node, even when the
   * markup string is byte-identical — which means a panel on a periodic
   * refresh (context panel, idle alerts) can detach a button out from under a
   * click that is mid-flight. Skipping the reassignment when nothing actually
   * changed removes that race AND is cheap (a plain string compare).
   */
  function setHTMLIfChanged(node, html) {
    if (!node || node.__fsHtml === html) return;
    node.__fsHtml = html;
    node.innerHTML = html;
  }
  function renderContext() {
    const g = G();
    const body = el("fsContextBody");
    if (!g || !body) return;
    if (selKind === "flag") {
      const f = g.flags[selId];
      if (!f) { selectSubject(null, 0); return; }
      setHTMLIfChanged(body, renderFlagPanel(f));
    } else if (selKind === "bld") {
      const b = g.buildings[selId];
      if (!b) { selectSubject(null, 0); return; }
      setHTMLIfChanged(body, renderBuildingPanel(b));
    }
  }

  function renderFlagPanel(f) {
    const g = G();
    let goods = "";
    for (let i = 0; i < f.slots.length; i++) {
      goods += '<span class="ctx-good" title="' + esc(f.slots[i].res) + '">' + (FSC.RES_ICON[f.slots[i].res] || "❔") + "</span>";
    }
    if (!goods) goods = '<span class="fs-dim">nothing queued</span>';
    const onMountain = g.map.terr[f.v] === FSC.TERR.MOUNTAIN;
    const isDoor = !!f.bld && !!g.buildings[f.bld];
    let html = "<h3>🚩 Flag</h3>";
    html += '<div class="ctx-row"><span class="fs-dim">Queued (' + f.slots.length + "/" + FSC.FLAG_CAP + ")</span></div>";
    html += '<div class="ctx-goods">' + goods + "</div>";
    html += '<div class="ctx-row"><span class="fs-dim">Roads</span><b>' + f.roads.length + "</b></div>";
    if (isDoor) {
      const b = g.buildings[f.bld];
      html += '<button class="fs-btn" data-act="ctx-open-bld" data-id="' + f.bld + '">🏗 Open ' + esc(FSC.BLD_NAME[b.type] || b.type) + "</button>";
    }
    if (onMountain) html += '<button class="fs-btn" data-act="ctx-geologist" data-id="' + f.id + '">🔍 Send geologist</button>';
    html += '<button class="fs-btn" data-act="ctx-startroad" data-id="' + f.id + '">🛤 Start a road here</button>';
    if (!isDoor) html += '<button class="fs-btn fs-danger" data-act="ctx-demolish" data-id="' + f.id + '">🔥 Demolish flag</button>';
    else html += '<div class="fs-dim fs-note">demolish the building to remove its door flag</div>';
    return html;
  }

  function renderBuildingPanel(b) {
    const g = G();
    const def = FSC.BLD[b.type];
    const mine = b.p === myPlayer();
    let html = "<h3>" + (BLD_ICON[b.type] || "🏗") + " " + esc(FSC.BLD_NAME[b.type] || b.type) + "</h3>";
    html += '<div class="ctx-row"><span class="fs-dim">Owner</span><b style="color:#' + colHex(g.players[b.p].color) +
      '">' + esc(g.players[b.p].name) + "</b></div>";
    if (b.state !== "done" && b.state !== "burn") html += renderSitePanel(b, def);
    else if (b.state === "burn") html += '<div class="ctx-row"><span class="fs-dim">🔥 Burning down…</span></div>';
    else {
      if (def.warehouse) html += renderWarehousePanel(b, def);
      if (def.job || def.in || def.out || def.outTool || def.outWeapon) html += renderProducerPanel(b, def);
      if (def.mine) html += renderMinePanel(b, def);
      if (def.mil) html += renderMilitaryPanel(b, def, mine);
    }
    if (mine && b.type !== "castle" && b.state !== "burn") {
      html += '<button class="fs-btn fs-danger" data-act="ctx-demolish" data-id="' + b.id + '">🔥 Demolish</button>';
    }
    return html;
  }
  function labelForSiteState(b) {
    if (b.state === "site") return "Waiting for materials";
    if (b.state === "leveling") return "Levelling the ground";
    if (b.state === "build") return "Under construction";
    return b.state;
  }
  function renderSitePanel(b, def) {
    let html = '<div class="ctx-row"><span class="fs-dim">' + labelForSiteState(b) + "</span></div>";
    if (def.cost.plank) html += barRow("🪵 Plank", b.matGot.plank || 0, def.cost.plank);
    if (def.cost.stone) html += barRow("🪨 Stone", b.matGot.stone || 0, def.cost.stone);
    const frac = Math.min(1, (b.progress || 0) / FSC.BUILD_FULL);
    html += barRow("🔨 Hammering", Math.round(frac * 100), 100, "%");
    return html;
  }
  function renderProducerPanel(b, def) {
    let html = "";
    const workerLbl = b.worker ? ("👷 " + jobName(def.job) + " at work") :
      (b.workerReq ? ("⏳ waiting for a " + jobName(def.job)) : "—");
    html += '<div class="ctx-row"><span class="fs-dim">Worker</span><b>' + workerLbl + "</b></div>";
    if (def.in) for (const r in def.in) html += barRow((FSC.RES_ICON[r] || "") + " " + r, b.stockIn[r] || 0, FSC.IN_CAP);
    if (def.inFood) html += barRow("🍽 Food stock", foodStockOf(b), FSC.IN_CAP);
    if (def.out || def.outTool || def.outWeapon) {
      html += '<div class="ctx-row"><span class="fs-dim">Produced</span><b>' + (b.cycles || 0) + " batches</b></div>";
      if (b.outHeld) html += '<div class="ctx-row fs-warn"><span>⚠ held back</span><b>' + b.outHeld + " (flag full)</b></div>";
    }
    html += '<label class="fs-toggle"><input type="checkbox" data-act="ctx-halt" data-id="' + b.id + '"' +
      (b.halted ? " checked" : "") + "> ⏸ pause production</label>";
    return html;
  }
  function renderMinePanel(b) {
    return '<div class="ctx-row"><span class="fs-dim">Deposit</span><b>' + (b.mine.exhausted ? "exhausted ⚠" : "active") + "</b></div>";
  }
  function renderWarehousePanel(b) {
    let html = '<div class="ctx-sec">📦 Inventory</div><div class="ctx-inv-grid">';
    for (let i = 0; i < FSC.RES_LIST.length; i++) {
      const r = FSC.RES_LIST[i], n = b.inv[r] || 0;
      html += '<div class="inv-cell' + (n ? "" : " zero") + '" title="' + esc(r) + '">' +
        '<span class="ico">' + (FSC.RES_ICON[r] || "") + '</span><span class="n">' + n + "</span>" +
        (b.modes ? ('<button class="fs-modebtn" data-act="ctx-stockmode" data-id="' + b.id + '" data-res="' + r +
          '" title="cycle in / stop / out">' + stockModeIco(b, r) + "</button>") : "") +
        "</div>";
    }
    html += "</div>";
    html += '<div class="ctx-sec">👥 Serfs in store</div><div class="ctx-pool">';
    let any = false;
    for (const job in b.pool) if (b.pool[job]) { any = true; html += '<span class="pool-chip">' + jobName(job) + " ×" + b.pool[job] + "</span>"; }
    if (!any) html += '<span class="fs-dim">none</span>';
    html += "</div>";
    return html;
  }
  function stockModeIco(b, r) {
    const m = (b.modes && b.modes[r]) || 0;
    return m === FSC.STOCK_MODE.STOP ? "⛔" : (m === FSC.STOCK_MODE.OUT ? "↗" : "↘");
  }
  function renderMilitaryPanel(b, def, mine) {
    const g = G();
    let html = '<div class="ctx-sec">🛡 Garrison (' + b.mil.knights.length + "/" + def.mil.cap + ")</div><div class=\"ctx-garrison\">";
    if (!b.mil.knights.length) html += '<span class="fs-dim">empty</span>';
    for (let i = 0; i < b.mil.knights.length; i++) {
      const rk = b.mil.knights[i];
      html += '<span class="rank-chip" style="border-color:#' + colHex(FSC.RANK_COLOR[rk]) + '" title="' +
        FSC.RANK_NAMES[rk] + '">🛡' + rk + "</span>";
    }
    html += "</div>";
    if (def.mil.goldCap) html += barRow("🪙 Gold", b.mil.gold || 0, def.mil.goldCap);
    if (mine) {
      html += '<button class="fs-btn" data-act="open-knights">⚙ Knight settings</button>';
    } else if (FSMil && FSMil.isEnemy(g, b.p, myPlayer()) && (b.mil.knights.length + (b.mil.defending || 0)) > 0) {
      const max = FSMil.maxAttackers(g, b.id, myPlayer());
      html += '<div class="ctx-row"><span class="fs-dim">Your reach</span><b>' + max + " knight" + (max === 1 ? "" : "s") + "</b></div>";
      html += '<button class="fs-btn fs-danger" data-act="ctx-attack-open" data-id="' + b.id + '"' +
        (max <= 0 ? " disabled" : "") + ">⚔ Attack</button>";
    }
    return html;
  }

  // ─────────────────────────────────────────────────────────── attack dialog
  let attackTargetId = 0;
  function openAttackDialogFor(id) {
    const g = G();
    const b = g.buildings[id];
    if (!b || !FSMil) return;
    attackTargetId = id;
    const max = Math.max(1, FSMil.maxAttackers(g, id, myPlayer()));
    el("fsAttackWho").textContent = (FSC.BLD_NAME[b.type] || b.type) + " — " + g.players[b.p].name +
      " · garrison " + b.mil.knights.length;
    const slider = el("fsAttackCount");
    slider.max = String(max);
    slider.value = String(Math.max(1, Math.min(max, Math.ceil(max / 2))));
    el("fsAttackCountLbl").textContent = slider.value;
    el("fsAttackStrong").checked = !!g.players[myPlayer()].knights.attackStrong;
    el("fsAttackDialog").classList.remove("hidden");
    pushOpen("attack", closeAttackDialog);
  }
  function closeAttackDialog() {
    const d = el("fsAttackDialog");
    if (d && !d.classList.contains("hidden")) { d.classList.add("hidden"); popOpenById("attack"); }
  }
  function confirmAttack() {
    const g = G();
    if (!attackTargetId || !g || !FSMil) return;
    const n = parseInt(el("fsAttackCount").value, 10) || 1;
    const strong = !!el("fsAttackStrong").checked;
    const max = FSMil.maxAttackers(g, attackTargetId, myPlayer());
    if (max <= 0) { toast("no knights in range anymore", "err"); closeAttackDialog(); return; }
    FS.attack(attackTargetId, n, { strong });
    noteIfQueued();
    closeAttackDialog();
  }

  // ─────────────────────────────────────────────────────────── demolish confirm
  let demolishTargetId = 0;
  function openDemolishConfirm(id) {
    demolishTargetId = id;
    el("fsDemolishWhat").textContent = describeId(id);
    el("fsDemolishDialog").classList.remove("hidden");
    pushOpen("demolish", closeDemolishConfirm);
  }
  function closeDemolishConfirm() {
    const d = el("fsDemolishDialog");
    if (d && !d.classList.contains("hidden")) { d.classList.add("hidden"); popOpenById("demolish"); }
    demolishTargetId = 0;
  }
  function confirmDemolish() {
    if (!demolishTargetId) return;
    issue("demolish", { id: demolishTargetId });
    noteIfQueued();
    const id = demolishTargetId;
    closeDemolishConfirm();
    if ((selKind === "bld" || selKind === "flag") && selId === id) selectSubject(null, 0);
  }
  function describeId(id) {
    const g = G();
    if (g.buildings[id]) return "Demolish this " + (FSC.BLD_NAME[g.buildings[id].type] || g.buildings[id].type) + "? This cannot be undone.";
    if (g.roads[id]) return "Demolish this road? Its carrier returns to the pool.";
    if (g.flags[id]) return "Demolish this flag? Any queued goods are lost.";
    return "Demolish this?";
  }

  // ─────────────────────────────────────────────────────────── context-panel + dialog actions
  function dispatchPanelAction(act, btn) {
    const idAttr = btn.getAttribute("data-id");
    const id = idAttr === null ? 0 : parseInt(idAttr, 10);
    switch (act) {
      case "ctx-open-bld": selectSubject("bld", id); break;
      case "ctx-geologist": issue("geologist", { flag: id }); noteIfQueued(); toast("⛏ geologist on the way", "info"); break;
      case "ctx-startroad": {
        const g = G(); const f = g.flags[id];
        if (f) { setMode("road"); roadFrom = id; FSRender.setSelection(f.v); toast("🛤 click where the road goes", "info"); }
        break;
      }
      case "ctx-demolish": openDemolishConfirm(id); break;
      case "ctx-halt": FS.halt(id, !!btn.checked); noteIfQueued(); break;
      case "ctx-stockmode": {
        const g = G(), b = g.buildings[id], res = btn.getAttribute("data-res");
        const cur = (b.modes && b.modes[res]) || 0;
        FS.setStockMode(id, res, (cur + 1) % 3);
        noteIfQueued();
        renderContext();
        break;
      }
      case "ctx-attack-open": openAttackDialogFor(id); break;
      default: dispatchSheetAction(act, btn);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== side menu sheets: Distribution / Priorities / Tools / Knights / ===
  // ===== Stats / Save-Load / Settings / Help ================================
  // ═══════════════════════════════════════════════════════════════════════
  /** 20-notch stepper (0..FSC.PRIO_MAX in FSC.PRIO_STEP jumps) — segmented ticks. */
  function stepperHTML(key, value, act) {
    const lvl = Math.round(value / FSC.PRIO_STEP);
    let ticks = "";
    for (let i = 0; i <= 20; i++) {
      ticks += '<button class="fs-tick' + (i <= lvl ? " on" : "") + '" data-act="' + act + '" data-key="' +
        key + '" data-lvl="' + i + '" title="' + (i * 5) + '%"></button>';
    }
    return '<div class="fs-stepper" data-key="' + key + '">' + ticks + "</div>";
  }

  function renderDist() {
    const pl = G().players[myPlayer()];
    let html = '<p class="fs-dim fs-note">How hard each request competes for a shared resource — higher wins more often.</p>';
    for (let gi = 0; gi < DIST_GROUPS.length; gi++) {
      const grp = DIST_GROUPS[gi];
      html += '<div class="fs-sec-h">' + grp.label + "</div>";
      for (let i = 0; i < grp.keys.length; i++) {
        const k = grp.keys[i], v = pl.dist[k] || 0;
        html += '<div class="fs-row2"><span>' + DIST_LABEL[k] + '</span><span class="fs-num">' +
          Math.round((v / FSC.PRIO_MAX) * 100) + "%</span></div>";
        html += stepperHTML(k, v, "dist-tick");
      }
    }
    return html;
  }
  function renderTools() {
    const pl = G().players[myPlayer()];
    let html = '<p class="fs-dim fs-note">Which tool the toolmaker favours when several are wanted.</p>';
    for (let i = 0; i < FSC.TOOLS.length; i++) {
      const t = FSC.TOOLS[i], v = pl.tools[t] || 0;
      html += '<div class="fs-row2"><span>' + (FSC.RES_ICON[t] || "") + " " + t + '</span><span class="fs-num">' +
        Math.round((v / FSC.PRIO_MAX) * 100) + "%</span></div>";
      html += stepperHTML(t, v, "tool-tick");
    }
    return html;
  }
  function renderPrio(which) {
    const pl = G().players[myPlayer()];
    const order = which === "transport" ? pl.transportPrio : pl.invPrio;
    let html = '<p class="fs-dim fs-note">' +
      (which === "transport" ? "Which waiting good a carrier picks up first." : "Which stored good a warehouse ships out first.") +
      "</p>";
    html += '<div class="fs-prio-list" data-list="' + which + '">';
    for (let i = 0; i < order.length; i++) {
      const r = order[i];
      html += '<div class="fs-prio-row"><span class="fs-prio-n">' + (i + 1) + '</span>' +
        '<span class="fs-prio-ico">' + (FSC.RES_ICON[r] || "") + '</span><span class="fs-prio-name">' + r + "</span>" +
        '<button class="fs-arrow" data-act="prio-up" data-list="' + which + '" data-idx="' + i + '"' +
        (i === 0 ? " disabled" : "") + ">▲</button>" +
        '<button class="fs-arrow" data-act="prio-down" data-list="' + which + '" data-idx="' + i + '"' +
        (i === order.length - 1 ? " disabled" : "") + ">▼</button></div>";
    }
    html += "</div>";
    return html;
  }
  function movePrio(btn, dir) {
    const which = btn.getAttribute("data-list"), idx = parseInt(btn.getAttribute("data-idx"), 10);
    const pl = G().players[myPlayer()];
    const order = (which === "transport" ? pl.transportPrio : pl.invPrio).slice();
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const tmp = order[idx]; order[idx] = order[j]; order[j] = tmp;
    if (which === "transport") FS.setTransportPrio(order); else FS.setInvPrio(order);
    noteIfQueued();
    refreshOpenSheet();
  }

  function occOptions(sel) {
    let html = "";
    for (let i = 0; i <= FSC.OCC_LEVEL_MAX; i++) html += '<option value="' + i + '"' + (i === sel ? " selected" : "") + ">" + FSC.OCC_NAMES[i] + "</option>";
    return html;
  }
  function renderKnights() {
    const pl = G().players[myPlayer()];
    let html = '<div class="fs-sec-h">🏰 Castle garrison target</div>';
    html += '<div class="fs-row2"><span>Desired knights</span><span class="fs-num">' + pl.knights.castleKnights + "</span></div>";
    html += '<div class="fs-stepbtns"><button class="fs-btn" data-act="knight-castle" data-d="-1">−</button>' +
      '<button class="fs-btn" data-act="knight-castle" data-d="1">+</button></div>';
    html += '<div class="fs-sec-h">🎯 Recruit rate</div>';
    html += '<div class="fs-row2"><span>Generic → knight eagerness</span><span class="fs-num">' +
      Math.round((pl.knights.recruitRate / FSC.PRIO_MAX) * 100) + "%</span></div>";
    html += stepperHTML("recruitRate", pl.knights.recruitRate, "knight-recruit-tick");
    html += '<label class="fs-toggle"><input type="checkbox" data-act="knight-strong-toggle"' +
      (pl.knights.attackStrong ? " checked" : "") + "> ⚔ attacks send strongest knights first</label>";
    html += '<div class="fs-sec-h">🚩 Occupancy by threat tier</div>';
    for (let t = 0; t < 4; t++) {
      const pair = pl.knights.occ[t];
      html += '<div class="fs-occ-row"><span class="fs-occ-tier">' + FSC.THREAT_TIER_NAMES[t] + "</span>" +
        '<label>Min <select data-act="knight-occ" data-tier="' + t + '" data-kind="min">' + occOptions(pair[0]) + "</select></label>" +
        '<label>Max <select data-act="knight-occ" data-tier="' + t + '" data-kind="max">' + occOptions(pair[1]) + "</select></label></div>";
    }
    return html;
  }
  function adjustCastleKnights(d) {
    const pl = G().players[myPlayer()];
    const v = Math.max(0, Math.min(FSC.CASTLE_KNIGHTS_MAX, (pl.knights.castleKnights || 0) + d));
    FS.setKnightSetting("castleKnights", v);
    noteIfQueued();
    refreshOpenSheet();
  }

  const STATS_TABS = [{ id: "goods", label: "Goods", ico: "📦" }, { id: "serfs", label: "Population", ico: "👥" },
    { id: "land", label: "Land", ico: "🗺" }, { id: "military", label: "Military", ico: "🛡" }];
  let statsTab = "goods";
  function renderStats() {
    let tabs = "";
    for (let i = 0; i < STATS_TABS.length; i++) {
      const t = STATS_TABS[i];
      tabs += '<button class="fs-tab' + (statsTab === t.id ? " on" : "") + '" data-act="stats-tab" data-tab="' + t.id + '">' + t.ico + " " + t.label + "</button>";
    }
    let legend = "";
    const g = G();
    for (let p = 0; p < g.players.length; p++) {
      legend += '<span class="fs-legend-chip"><i style="background:#' + colHex(g.players[p].color) + '"></i>' + esc(g.players[p].name) + "</span>";
    }
    return '<div id="fsStatsTabs">' + tabs + '</div><canvas id="fsStatsCanvas" width="420" height="190"></canvas><div id="fsStatsLegend">' + legend + "</div>";
  }
  function drawSeries(cv, getArr, colorFn) {
    if (!cv) return;
    const g = G();
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, cv.width, cv.height);
    let max = 1;
    for (let p = 0; p < g.players.length; p++) { const arr = getArr(p); for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i]; }
    for (let p = 0; p < g.players.length; p++) {
      const arr = getArr(p);
      if (arr.length < 2) continue;
      ctx.beginPath();
      ctx.strokeStyle = colorFn(p);
      ctx.lineWidth = 2;
      for (let i = 0; i < arr.length; i++) {
        const x = (i / (arr.length - 1)) * (cv.width - 8) + 4;
        const y = cv.height - 6 - (arr[i] / max) * (cv.height - 14);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  function renderStatsChart() {
    const g = G();
    if (!g) return;
    drawSeries(el("fsStatsCanvas"), (p) => g.stats[p][statsTab] || [], (p) => "#" + colHex(g.players[p].color));
  }

  function peekSaveMeta(slot) {
    let raw = null;
    try { raw = localStorage.getItem("fs_save_" + slot); } catch (e) { return null; }
    if (!raw) return null;
    let tick = "?";
    try { tick = JSON.parse(raw).t; } catch (e) { /* noop */ }
    let when = "—";
    try {
      const m = JSON.parse(localStorage.getItem("fs_save_" + slot + "_meta") || "null");
      if (m && m.ts) when = new Date(m.ts).toLocaleString();
    } catch (e) { /* noop */ }
    return { tick, when };
  }
  function renderSaveLoad() {
    const net = FS.FSNet;
    const isGuest = !!(net && net.active && net.active() && net.state().role === "guest");
    let html = "";
    if (isGuest) html += '<p class="fs-dim fs-note">Your host keeps the saves — saving is off for the guest seat.</p>';
    const slots = [["auto", "Autosave"], ["1", "Slot 1"], ["2", "Slot 2"], ["3", "Slot 3"]];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i][0], label = slots[i][1], meta = peekSaveMeta(slot);
      html += '<div class="fs-save-row" data-slot="' + slot + '">';
      html += '<div class="fs-save-info"><b>' + label + "</b><span class=\"fs-dim\">" +
        (meta ? ("tick " + meta.tick + " · " + meta.when) : "empty") + "</span></div>";
      html += '<div class="fs-save-btns">';
      if (slot !== "auto" && !isGuest) html += '<button class="fs-btn" data-act="save-slot" data-slot="' + slot + '">💾 Save</button>';
      if (meta) html += '<button class="fs-btn" data-act="load-slot" data-slot="' + slot + '">📂 Load</button>';
      html += "</div></div>";
    }
    html += '<button class="fs-btn fs-danger" data-act="newgame-fromsheet">🏠 New game</button>';
    return html;
  }
  function doSaveSlot(slot) {
    if (!FS.save(slot)) { toast("save failed", "err"); return; }
    try { localStorage.setItem("fs_save_" + slot + "_meta", JSON.stringify({ ts: Date.now() })); } catch (e) { /* noop */ }
    toast("💾 saved — " + (slot === "auto" ? "autosave" : "slot " + slot), "info");
    refreshOpenSheet();
  }
  function doLoadSlot(slot) {
    if (!FS.load(slot)) { toast("nothing saved there", "err"); return; }
    toast("📂 loaded", "info");
    closeSheet();
  }

  /* ===== PHASE F: Settings gains the real audio controls (mute / music
   * toggle / "use my own music" loader) — fs-ui.js owns this panel's DOM per
   * the Phase-F brief; FSAudio (fs-audio.js) owns the actual WebAudio state,
   * this just reads/drives it through its public API. Falls back to reading
   * localStorage directly if fs-audio.js failed to load, so the checkbox
   * never lies even in that edge case. ===== */
  function renderSettings() {
    const FA = window.FSAudio;
    let muted = FA ? FA.muted() : false;
    if (!FA) { try { muted = localStorage.getItem("fs_muted") === "1"; } catch (e) { /* noop */ } }
    const musicOff = FA ? FA.musicOff() : false;
    const info = FA ? FA.musicInfo() : { source: "synth", ready: true, name: null };
    let html = "";
    html += '<div class="fs-sec-h">🔊 Audio</div>';
    html += '<label class="fs-toggle"><input type="checkbox" data-act="settings-mute"' + (muted ? " checked" : "") +
      "> 🔇 Mute everything <span class=\"fs-dim\">(M)</span></label>";
    html += '<label class="fs-toggle"><input type="checkbox" data-act="settings-musicoff"' + (musicOff ? " checked" : "") +
      "> 🎵 Turn off music <span class=\"fs-dim\">(keep sound effects)</span></label>";
    html += '<p class="fs-note fs-dim" style="margin-top:8px">' +
      (info.source === "file"
        ? "Now playing: your track" + (info.name ? " — " + esc(info.name) : "") + (info.ready ? "" : " (loading…)")
        : "Now playing: the built-in village theme") + "</p>";
    html += '<label class="fs-btn fs-ghost" for="fsMusicFile" style="text-align:center">🎵 Use my own music…</label>' +
      '<input type="file" id="fsMusicFile" accept="audio/*" data-act="settings-music-file" style="display:none">';
    if (info.source === "file") html += '<button class="fs-btn" data-act="settings-music-remove">↺ Back to the built-in theme</button>';
    html += '<p class="fs-note fs-dim">Your music file stays on this device only — it is never uploaded or shared.</p>';
    html += '<div class="fs-sec-h">🎥 Camera</div>';
    html += '<label class="fs-toggle"><input type="checkbox" data-act="settings-invert"' + (FSRender.invertY() ? " checked" : "") +
      "> 🔄 Invert camera look</label>";
    html += '<label class="fs-toggle"><input type="checkbox" data-act="settings-tint"' + (FSRender.territoryTint() ? " checked" : "") +
      "> 🎨 Territory tint</label>";
    return html;
  }
  function toggleMute(btn) {
    if (window.FSAudio) { FSAudio.setMuted(!!btn.checked); return; }
    try { localStorage.setItem("fs_muted", btn.checked ? "1" : "0"); } catch (e) { /* noop */ }
  }
  function toggleMusicOff(btn) { if (window.FSAudio) FSAudio.setMusicOff(!!btn.checked); }
  function handleMusicFile(input) {
    const f = input.files && input.files[0];
    input.value = "";                 // so picking the SAME filename again still fires change
    if (!f || !window.FSAudio) return;
    toast("🎵 loading your track…", "info");
    FSAudio.setCustomMusic(f).then((r) => {
      toast(r && r.ok ? "🎵 now playing your track" : ("⚠ " + ((r && r.why) || "couldn't use that file — kept the built-in theme")), r && r.ok ? "info" : "err");
      refreshOpenSheet();
    });
  }
  function handleMusicRemove() {
    if (!window.FSAudio) return;
    FSAudio.clearCustomMusic().then(() => { toast("🎵 back to the built-in theme", "info"); refreshOpenSheet(); });
  }

  function renderHelp() {
    return "" +
      '<div class="fs-help"><h4>Goal</h4>' +
      "<p>Build an economy, train knights, expand your territory and be the last kingdom standing.</p>" +
      "<h4>Production chains</h4><pre>" +
      "Tree → 🪓 Lumberjack → lumber → 🪚 Sawmill → plank\n" +
      "Stone pile → ⛏️ Stonecutter → stone\n" +
      "Wheat (🌾 Farm) → 🌬️ Mill → flour → 🍞 Bakery → bread\n" +
      "Wheat → 🐖 Pig Farm → pig → 🔪 Butcher → meat\n" +
      "Fish (🎣 Fisher)\n" +
      "Coal + Iron ore → 🔥 Smelter → steel\n" +
      "Coal + Gold ore → 🪙 Gold Smelter → gold bar\n" +
      "Plank + Steel → 🔨 Toolmaker → tools\n" +
      "Coal + Steel → ⚔ Weaponsmith → sword / shield\n" +
      "Plank → 🛶 Boatwright → boat (for water roads)" +
      "</pre>" +
      "<h4>Controls</h4><ul>" +
      "<li>Drag to pan · wheel to zoom · Q/E turn · WASD move</li>" +
      "<li>Space / 1 / 2 / 3 — pause / 1× / 2× / 4× speed</li>" +
      "<li>Dock: 🏠 build · 🚩 flag · 🛤 road · 🔥 demolish · ✋ select</li>" +
      "<li>T — build-suitability overlay · P — ping the map · Esc — cancel / close</li>" +
      "</ul></div>";
  }

  const SHEET_TITLE = {
    dist: "📦 Distribution", prioT: "🚚 Transport priority", prioW: "🏬 Warehouse priority",
    tools: "🔧 Tool priority", knights: "🛡 Knights", stats: "📈 Stats",
    saveload: "💾 Save / Load", settings: "⚙ Settings", help: "❔ Help",
  };
  const SHEET_RENDER = {
    dist: renderDist, prioT: () => renderPrio("transport"), prioW: () => renderPrio("warehouse"),
    tools: renderTools, knights: renderKnights, stats: renderStats,
    saveload: renderSaveLoad, settings: renderSettings, help: renderHelp,
  };
  let openSheetName = null;
  function openSheet(name) {
    menuOpen = false;
    el("fsMenu").classList.add("hidden");
    openSheetName = name;
    el("fsSheetTitle").textContent = SHEET_TITLE[name] || name;
    el("fsSheet").setAttribute("data-sheet", name);
    el("fsSheetBody").innerHTML = SHEET_RENDER[name] ? SHEET_RENDER[name]() : "";
    if (name === "stats") renderStatsChart();
    el("fsSheetWrap").classList.remove("hidden");
    pushOpen("sheet", closeSheet);
  }
  function closeSheet() {
    openSheetName = null;
    el("fsSheetWrap").classList.add("hidden");
    popOpenById("sheet");
  }
  function refreshOpenSheet() {
    if (!openSheetName) return;
    el("fsSheetBody").innerHTML = SHEET_RENDER[openSheetName] ? SHEET_RENDER[openSheetName]() : "";
    if (openSheetName === "stats") renderStatsChart();
  }
  FSUI.openHelp = function () { if (built) openSheet("help"); };

  function dispatchSheetAction(act, btn) {
    switch (act) {
      case "dist-tick": FS.setDist(btn.getAttribute("data-key"), parseInt(btn.getAttribute("data-lvl"), 10) * FSC.PRIO_STEP); noteIfQueued(); refreshOpenSheet(); break;
      case "tool-tick": FS.setToolPrio(btn.getAttribute("data-key"), parseInt(btn.getAttribute("data-lvl"), 10) * FSC.PRIO_STEP); noteIfQueued(); refreshOpenSheet(); break;
      case "prio-up": movePrio(btn, -1); break;
      case "prio-down": movePrio(btn, 1); break;
      case "knight-castle": adjustCastleKnights(parseInt(btn.getAttribute("data-d"), 10)); break;
      case "knight-recruit-tick": FS.setKnightSetting("recruitRate", parseInt(btn.getAttribute("data-lvl"), 10) * FSC.PRIO_STEP); noteIfQueued(); refreshOpenSheet(); break;
      case "knight-strong-toggle": FS.setKnightSetting("attackStrong", !!btn.checked); noteIfQueued(); break;
      case "knight-occ": {
        const tier = parseInt(btn.getAttribute("data-tier"), 10), kind = btn.getAttribute("data-kind"), lvl = parseInt(btn.value, 10);
        FS.setKnightSetting(kind === "min" ? "occMin" : "occMax", lvl, tier);
        noteIfQueued();
        break;
      }
      case "save-slot": doSaveSlot(btn.getAttribute("data-slot")); break;
      case "load-slot": doLoadSlot(btn.getAttribute("data-slot")); break;
      case "newgame-fromsheet": closeSheet(); H.backToTitle(); break;
      case "settings-mute": toggleMute(btn); break;
      case "settings-musicoff": toggleMusicOff(btn); break;               /* ===== PHASE F ===== */
      case "settings-music-file": handleMusicFile(btn); break;            /* ===== PHASE F ===== */
      case "settings-music-remove": handleMusicRemove(); break;           /* ===== PHASE F ===== */
      case "settings-invert": FSRender.setInvertY(!!btn.checked); break;
      case "settings-tint": FSRender.setTerritoryTint(!!btn.checked); break;
      case "stats-tab": statsTab = btn.getAttribute("data-tab"); refreshOpenSheet(); break;
      default: break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== minimap ============================================================
  // ═══════════════════════════════════════════════════════════════════════
  let minimapCollapsed = false;
  let mmPingV = -1, mmPingUntil = 0, mmPingSeenT = -1;
  const mmColor = new THREE.Color(), mmPlayerColor = new THREE.Color();
  function toggleMinimap() {
    minimapCollapsed = !minimapCollapsed;
    el("fsMinimap").classList.toggle("collapsed", minimapCollapsed);
    el("fsMinimapToggle").textContent = minimapCollapsed ? "▸" : "▾";
  }
  function minimapMove(e) {
    const g = G();
    if (!g) return;
    const cv = el("fsMinimapCanvas");
    const rect = cv.getBoundingClientRect();
    const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    const wx = mx * g.map.W * FSC.TILE;
    const wz = my * g.map.H * FSC.TILE * FSC.ROW_Z;
    FSRender.setCam({ tx: wx, tz: wz });
  }
  function pollMinimapPing() {
    const g = G();
    if (!g) { mmPingV = -1; return; }
    const evs = g.events;
    for (let i = evs.length - 1; i >= 0 && i >= evs.length - 40; i--) {
      const e = evs[i];
      if (e.type !== "ping") continue;
      if (e.t > mmPingSeenT) { mmPingSeenT = e.t; mmPingV = e.v; mmPingUntil = g.tick + FSC.NET_PING_T; }
      break;
    }
    if (mmPingV >= 0 && g.tick > mmPingUntil) mmPingV = -1;
  }
  function drawMinimapFrustum(ctx, cv) {
    const g = G(), camera = FSRender.camera();
    if (!camera) return;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const ray = new THREE.Raycaster();
    const pts = [];
    for (let i = 0; i < 4; i++) {
      ray.setFromCamera({ x: corners[i][0], y: corners[i][1] }, camera);
      const dir = ray.ray.direction, origin = ray.ray.origin;
      if (Math.abs(dir.y) < 1e-5) continue;
      const t = -origin.y / dir.y;
      if (t < 0) continue;
      const wx = origin.x + dir.x * t, wz = origin.z + dir.z * t;
      pts.push([(wx / (g.map.W * FSC.TILE)) * cv.width, (wz / (g.map.H * FSC.TILE * FSC.ROW_Z)) * cv.height]);
    }
    if (pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
  }
  function drawMinimapPing(ctx, cv) {
    const g = G();
    if (!g || mmPingV < 0) return;
    const row = (mmPingV / g.map.W) | 0, col = mmPingV - row * g.map.W;
    const px = col * (cv.width / g.map.W), py = row * (cv.height / g.map.H);
    const pulse = 3 + Math.abs(Math.sin(Date.now() / 220)) * 3;
    ctx.beginPath(); ctx.arc(px, py, pulse, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffe9a8"; ctx.lineWidth = 2; ctx.stroke();
  }
  function drawMinimap() {
    const g = G();
    const cv = el("fsMinimapCanvas");
    if (!g || !cv || minimapCollapsed) return;
    const ctx = cv.getContext("2d");
    const W = g.map.W, H = g.map.H;
    const cw = cv.width / W, ch = cv.height / H;
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const v = r * W + c;
        let colorInt = FSC.COL.TERR[g.map.terr[v]];
        const owner = g.map.owner[v];
        if (owner >= 0) {
          mmColor.set(colorInt);
          mmColor.lerp(mmPlayerColor.set(FSC.PLAYER_COLORS[owner % FSC.PLAYER_COLORS.length]), 0.38);
          colorInt = mmColor.getHex();
        }
        ctx.fillStyle = "#" + colHex(colorInt);
        ctx.fillRect(c * cw, r * ch, cw + 1, ch + 1);
      }
    }
    for (const id in g.buildings) {
      const b = g.buildings[id];
      if (b.state === "burn") continue;
      const row = (b.v / W) | 0, col = b.v - row * W;
      const px = col * cw, py = row * ch;
      ctx.fillStyle = "#" + colHex(FSC.PLAYER_COLORS[b.p % FSC.PLAYER_COLORS.length]);
      const s = b.type === "castle" ? 6 : 3;
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    drawMinimapFrustum(ctx, cv);
    drawMinimapPing(ctx, cv);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== notifications: toasts + bell log =================================
  // ═══════════════════════════════════════════════════════════════════════
  const NOTIF_PATTERNS = [
    [/finished\.$/, "🏗", "done"], [/Under attack/, "⚔️", "attack"], [/beaten off/, "🛡", "defend"],
    [/run dry/, "⛏", "mine"], [/Geologist found/, "🔍", "geo"], [/rose to/, "🎖", "promote"],
    [/Captured a/, "🚩", "capture"], [/^Lost a/, "💔", "lost"], [/castle has fallen/, "🏰", "castle"],
    [/kingdom has fallen/, "💀", "defeat"], [/wiped out/, "💀", "eliminate"], [/Victory!/, "🏆", "victory"],
    [/stands ready/, "🏰", "welcome"], [/joined your kingdom/, "🤝", "coop"], [/left the kingdom/, "🤝", "coop"],
    [/Re-syncing/, "🔄", "sync"], [/ferry runs/, "🛶", "boat"],
  ];
  function classifyNotif(text) {
    for (let i = 0; i < NOTIF_PATTERNS.length; i++) if (NOTIF_PATTERNS[i][0].test(text)) return { ico: NOTIF_PATTERNS[i][1], kind: NOTIF_PATTERNS[i][2] };
    return { ico: "📜", kind: "info" };
  }
  function myNotifs() {
    const g = G();
    if (!g) return [];
    const p = myPlayer();
    return g.notif.filter((n) => n.p === p);
  }
  let toastSeenIdx = 0, bellSeenIdx = 0;
  function pollNotifications() {
    const g = G();
    if (!g) return;
    const mine = myNotifs();
    for (let i = toastSeenIdx; i < mine.length; i++) {
      const n = mine[i], c = classifyNotif(n.text);
      toast(c.ico + " " + n.text, (c.kind === "attack" || c.kind === "defeat" || c.kind === "eliminate") ? "err" : "info");
    }
    toastSeenIdx = mine.length;
    renderBellBadge(Math.max(0, mine.length - bellSeenIdx));
  }
  function renderBellBadge(n) {
    const badge = el("fsBellBadge");
    if (!badge) return;
    badge.textContent = String(n);
    badge.classList.toggle("hidden", n <= 0);
  }
  function renderBell() {
    const log = el("fsBellLog");
    log.classList.toggle("hidden", !bellOpen);
    if (!bellOpen) return;
    bellSeenIdx = myNotifs().length;
    renderBellBadge(0);
    const mine = myNotifs().slice(-FSC.NOTIF_CAP).slice().reverse();
    let html = "";
    if (!mine.length) html = '<div class="fs-dim fs-note">no notifications yet</div>';
    for (let i = 0; i < mine.length; i++) {
      const n = mine[i], c = classifyNotif(n.text);
      html += '<button class="fs-notif-row" data-act="notif-jump" data-v="' + n.v + '">' +
        '<span class="ico">' + c.ico + '</span><span class="txt">' + esc(n.text) + "</span></button>";
    }
    log.innerHTML = html;
  }
  function renderToasts() {
    const wrap = el("fsToasts");
    if (!wrap) return;
    const visible = toastQueue.slice(-2);   // house rule: cap 2 on screen
    let html = "";
    for (let i = 0; i < visible.length; i++) {
      const t = visible[i];
      html += '<div class="fs-toast fs-toast-' + t.kind + '">' + esc(t.text) + "</div>";
    }
    wrap.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== QoL#3: idle-building alerts (read-only, no sim change) ============
  // ═══════════════════════════════════════════════════════════════════════
  function computeIdleAlerts() {
    const g = G();
    if (!g) return [];
    const p = myPlayer();
    const out = [];
    for (const id in g.buildings) {
      const b = g.buildings[id];
      if (b.p !== p || b.state !== "done") continue;
      const def = FSC.BLD[b.type];
      let reason = null;
      if (b.mine && b.mine.exhausted) reason = "deposit exhausted";
      else if (b.type !== "castle" && b.flag && g.flags[b.flag] && g.flags[b.flag].roads.length === 0) reason = "no route to your network";
      else if (def.job && !b.worker) {
        const pool = FS.q.poolOf(p);
        if (!pool.generic) reason = "no free settlers";
        else {
          const tools = FSC.JOB_TOOLS[def.job] || [];
          const inv = FS.q.invOf(p);
          let missing = null;
          for (let i = 0; i < tools.length; i++) if (!(inv[tools[i]] > 0)) { missing = tools[i]; break; }
          reason = missing ? ("needs a " + missing) : "waiting for a worker";
        }
      } else if (b.outHeld > 0) reason = "goods piling up — flag is full";
      else if (def.in && (b.worker || b.workerReq)) {
        let starved = true;
        for (const r in def.in) if ((b.stockIn[r] || 0) > 0) starved = false;
        if (starved) { let first = null; for (const r in def.in) { first = r; break; } reason = "no " + first + " coming in"; }
      }
      if (reason) out.push({ id: b.id, v: b.v, type: b.type, reason });
    }
    return out;
  }
  function renderAlerts() {
    const chip = el("fsAlertChip");
    if (!chip) return;
    const list = computeIdleAlerts();
    chip.classList.toggle("hidden", list.length === 0);
    el("fsAlertCount").textContent = String(list.length);
    el("fsAlertList").classList.toggle("hidden", !alertOpen);
    if (!alertOpen) return;
    let html = "";
    if (!list.length) html = '<div class="fs-dim fs-note">nothing stalled 🎉</div>';
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      html += '<button class="fs-notif-row" data-act="alert-jump" data-id="' + a.id + '" data-v="' + a.v + '">' +
        '<span class="ico">⚠</span><span class="txt">' + esc(FSC.BLD_NAME[a.type] || a.type) + " — " + esc(a.reason) + "</span></button>";
    }
    setHTMLIfChanged(el("fsAlertList"), html);
  }

  // ─────────────────────────────────────────────────────────── connect chip (QoL#1)
  function renderConnectChip() { el("fsConnectChip").classList.toggle("hidden", !connectOffer); }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== game over overlay =================================================
  // ═══════════════════════════════════════════════════════════════════════
  let gameOverShown = false;
  function checkGameOver() {
    const g = G();
    if (!g) return;
    if (g.gameOver && !gameOverShown) { gameOverShown = true; showGameOver(g.gameOver); }
    if (!g.gameOver) gameOverShown = false;
  }
  function showGameOver(go) {
    const g = G(), p = myPlayer();
    const won = go.winners.indexOf(p) >= 0;
    el("fsGameOverTitle").innerHTML = won ? '<span class="go-win">🏆 VICTORY!</span>' : '<span class="go-lose">💀 DEFEAT</span>';
    let stats = "";
    for (let i = 0; i < g.players.length; i++) {
      const pl = g.players[i], c = FS.q.counts(i);
      stats += '<div class="go-row"><i style="background:#' + colHex(pl.color) + '"></i>' + esc(pl.name) +
        (go.winners.indexOf(i) >= 0 ? " 🏆" : "") + '<span class="fs-dim">' + c.land + " land · " + c.people + " people</span></div>";
    }
    el("fsGameOverStats").innerHTML = stats;
    el("fsGameOver").classList.remove("hidden");
    drawSeries(el("fsGameOverChart"), (pp) => g.stats[pp].land || [], (pp) => "#" + colHex(g.players[pp].color));
    toast(won ? "🏆 Victory!" : "💀 Defeat", won ? "info" : "err");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== ticker + autosave ==================================================
  // ═══════════════════════════════════════════════════════════════════════
  function updateTicker() {
    const g = G();
    if (!g) return;
    const p = myPlayer(), inv = FS.q.invOf(p), c = FS.q.counts(p);
    for (let i = 0; i < GOODS_TICKER.length; i++) {
      const t = GOODS_TICKER[i];
      let n = 0;
      for (let k = 0; k < t.res.length; k++) n += inv[t.res[k]] || 0;
      const e2 = el("fsGoods-" + t.id);
      if (e2) e2.textContent = n;
    }
    const se = el("fsGoods-serfs"); if (se) se.textContent = c.people;
    const la = el("fsGoods-land"); if (la) la.textContent = Math.round((c.land / (g.map.W * g.map.H)) * 100) + "%";
  }
  function checkAutosave() {
    const g = G();
    if (!g) return;
    const net = FS.FSNet;
    if (net && net.active && net.active() && net.state().role === "guest") return;   // host owns persistence
    if (lastAutosaveTick < 0) lastAutosaveTick = g.tick;
    if (g.tick - lastAutosaveTick >= FSC.AUTOSAVE_T) { lastAutosaveTick = g.tick; doSaveSlot("auto"); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ===== public lifecycle ===================================================
  // ═══════════════════════════════════════════════════════════════════════
  FSUI.init = function (FSref, hooks) {
    FS = FSref;
    FSC = FS.FSC; FSMap = FS.FSMap; FSSim = FS.FSSim; FSMil = FS.FSMil; FSRender = FS.FSRender;
    H = Object.assign({ toastMode: function () {}, backToTitle: function () {} }, hooks || {});
    injectDom();
    return FSUI;
  };

  FSUI.onGameStart = function () {
    const root = el("fsui-root");
    if (root) root.classList.remove("hidden");
    mode = null; buildType = null; roadFrom = 0; selKind = null; selId = 0;
    toastSeenIdx = 0; bellSeenIdx = 0; toastQueue = []; toastGen = 0;
    lastAutosaveTick = -1; gameOverShown = false; connectOffer = null;
    lastHoverV = -2; pendingWatch.length = 0; openStack.length = 0;
    buildTab = "basic"; buildPage = 0; buildType = null; filteredSuitFromBuild = false;
    menuOpen = false; bellOpen = false; alertOpen = false;
    mmPingV = -1; mmPingSeenT = -1;
    el("fsMenu").classList.add("hidden");
    el("fsSheetWrap").classList.add("hidden");
    el("fsContext").classList.add("hidden");
    el("fsGameOver").classList.add("hidden");
    el("fsBellLog").classList.add("hidden");
    el("fsAlertList").classList.add("hidden");
    el("fsConnectChip").classList.add("hidden");
    closeAttackDialog(); closeDemolishConfirm();
    FSRender.setSelection(-1);
    FSRender.clearPlacementGhost();
    FSRender.clearRoadPreview();
    FSRender.overlaySuitability(false);
    updateDockUI(); updateBuildPanelVisibility(); updateSpeedUI(); updateTicker();
    renderAlerts(); renderBell();
    drawMinimap();
  };
  FSUI.onGameEnd = function () {
    const root = el("fsui-root");
    if (root) root.classList.add("hidden");
    closeSheet();
  };

  FSUI.frame = function (dt) {
    if (!built) return;
    if (!G()) return;
    frameAcc += dt;
    pollPending();
    updateHoverVisuals();
    updateSpeedUI();
    let toastsChanged = false;
    for (let i = toastQueue.length - 1; i >= 0; i--) {
      toastQueue[i].t += dt;
      if (toastQueue[i].t > 4.5) { toastQueue.splice(i, 1); toastsChanged = true; }
    }
    if (toastsChanged) renderToasts();
    pollNotifications();
    checkGameOver();
    checkAutosave();
    if (frameAcc >= 0.25) {         // ≤4Hz per plan §11 (also drives idle alerts ≤1Hz in spirit)
      frameAcc = 0;
      updateTicker();
      renderAlerts();
      if (selKind) renderContext();
      pollMinimapPing();
      drawMinimap();
    }
  };

  window.FSUI = FSUI;
})();
