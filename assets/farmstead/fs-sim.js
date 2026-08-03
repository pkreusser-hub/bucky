/* FARMSTEAD fs-sim.js — game state, command layer, tick engine, transport, construction.
 * Sim-safe: NO THREE, NO DOM. Every random draw goes through FSC.rng.
 *
 * DETERMINISM CONTRACT (plan §16): this file (and fs-map/fs-const/fs-military/fs-ai)
 * may use only + - * / , Math.sqrt/floor/ceil/round/abs/min/max/sign/imul and FSC.rng.
 * NO Math.sin/cos/tan/pow/exp/log, NO Math.random, NO Date.now — float transcendentals
 * are engine-defined and break cross-device lockstep. The transport suite greps for it.
 *
 * PHASE A built the G schema + castles. PHASE B (this file) owns:
 *   command layer · flags · roads · routing · carriers · goods scheduling ·
 *   serf pool/spawn/walking · construction (digger leveling → builder → done).
 * PHASE C extends production at the marked hooks; PHASE D adds military.
 *
 * ─── EVENT NAMES (stable contract — render/UI/suites read G.events) ───────────
 *   cmdFail      {cmd, why}            a queued command was invalid at execution
 *   flagPlaced   {id, v, p}
 *   flagRemoved  {id, v, p}
 *   roadBuilt    {id, p, f1, f2, len}
 *   roadRemoved  {id, p}
 *   roadSplit    {road, road2, flag}   a flag landed mid-road
 *   bldPlaced    {id, btype, v, p}      (`btype`, never `type` — that names the event)
 *   bldStateChange {id, btype, from, to}
 *   bldDone      {id, btype, v, p}
 *   bldRemoved   {id, btype, v, p}
 *   terrainLeveled {v, r}              digger flattened a large site
 *   serfSpawn    {id, job, p, v}
 *   serfBorn     {p, pool}              a new generic settler appeared in the castle
 *   serfDespawn  {id, job, p, home}
 *   serfLost     {id, job, p, v}       no way home (logged, should be rare)
 *   itemPickup   {serf, res, flag}
 *   itemDrop     {serf, res, flag}
 *   itemDeliver  {serf, res, bld}      handed into a building / warehouse
 *   itemLost     {res, v, why}
 *   congestion   {serf, flag, res}     dest flag full, carrier holding
 *   workerArrive {bld, serf, job}
 *   ── PHASE-M (co-op; all of these are render/UI only and NEVER enter FSSim.hash)
 *   ping         {v, p, by}              a partner marked a spot
 *   netDesync    {t, n, side}            a lockstep checkpoint disagreed
 *   netResync    {t, bytes}              a fresh world arrived and was adopted
 *   netPeer      {here, name}            partner joined / left
 */
(function () {
  "use strict";

  const FSC = (typeof window !== "undefined" && window.FSC) ? window.FSC
    : (typeof require === "function" ? require("./fs-const.js") : null);
  const FSMap = (typeof window !== "undefined" && window.FSMap) ? window.FSMap
    : (typeof require === "function" ? require("./fs-map.js") : null);

  const FSSim = {};
  const JOB = FSC.JOB;

  /* ===== PHASE-D hook: fs-military / fs-ai load AFTER this file, so they are
   * resolved lazily. Everything below degrades to the Phase-B/C behaviour when
   * they are absent (the sim stays runnable on its own). */
  let _FSMil = null, _FSAI = null;
  function mil() {
    if (_FSMil) return _FSMil;
    _FSMil = (typeof window !== "undefined" && window.FSMil) ? window.FSMil : null;
    return _FSMil;
  }
  function ai() {
    if (_FSAI) return _FSAI;
    _FSAI = (typeof window !== "undefined" && window.FSAI) ? window.FSAI : null;
    return _FSAI;
  }
  FSSim._bindMilitary = function (m, a) { _FSMil = m || _FSMil; _FSAI = a || _FSAI; };

  // stable integer ids for hashing string enums
  const RES_IDX = Object.create(null);
  FSC.RES_LIST.forEach((r, i) => (RES_IDX[r] = i + 1));
  const JOB_IDX = Object.create(null);
  Object.keys(JOB).forEach((k, i) => (JOB_IDX[JOB[k]] = i + 1));
  const STATE_IDX = Object.create(null);
  ["site", "leveling", "build", "done", "burn"].forEach((s, i) => (STATE_IDX[s] = i + 1));
  const SERF_STATE_IDX = Object.create(null);
  ["spawn", "goRoad", "idle", "fetch", "carry", "wait", "handIn", "goBld", "enter",
    "level", "hammer", "work", "return", "gone",
    /* ===== PHASE-C ===== */ "goWork", "doWork", "backWork", "goGeo", "geoWalk", "geoWork", "geoBack",
    /* ===== PHASE-D ===== */ "garrison", "atkWalk", "atkWait", "fight",
  ].forEach((s, i) => (SERF_STATE_IDX[s] = i + 1));

  // ------------------------------------------------------------------ helpers
  function newId(G) { return G.nextId++; }
  function bldOf(G, id) { return (id && G.buildings[id]) || null; }
  function flagOf(G, id) { return (id && G.flags[id]) || null; }
  function flagAtV(G, v) { return v >= 0 ? (G.flags[G.map.flagAt[v]] || null) : null; }
  function defOf(b) { return FSC.BLD[b.type]; }

  function makePlayer(G, id, isAI) {
    return {
      id,
      name: FSC.PLAYER_NAMES[id] || ("Player " + (id + 1)),
      color: FSC.PLAYER_COLORS[id % FSC.PLAYER_COLORS.length],
      isAI: !!isAI,
      // team: solo/shared co-op → human is team 0, every AI is its own team (plan §16)
      team: id,
      castleId: 0,
      eliminated: false,
      tools: Object.assign({}, FSC.TOOL_PRIO_DEFAULT),
      transportPrio: FSC.RES_ORDER.slice(),
      /* ===== PHASE-E: warehouse OUTPUT priority, mirrors transportPrio's wiring
       * exactly (its own reorderable list — see FSC.INV_ORDER for the default
       * and warehouseDispatch() below for where it is read) ===== */
      invPrio: FSC.INV_ORDER.slice(),
      dist: Object.assign({}, FSC.DIST_DEFAULTS),
      /* ===== PHASE-D: occupancy levels are per threat tier, deep-copied ===== */
      knights: Object.assign({}, FSC.KNIGHT_DEFAULTS, {
        occ: FSC.KNIGHT_OCC_DEFAULTS.map((a) => a.slice()),
      }),
      cycleT: 0,                   // "cycle knights" cooldown
      /* ===== PHASE-C: reproduction + knight ledger (plan §5) ===== */
      repro: FSC.REPRO_DEFAULT,
      knightCounter: FSC.KNIGHT_COUNTER_START,
      knightCredit: 0,
      distCredit: {},
    };
  }

  function makeStats() { return { t: [], goods: [], serfs: [], land: [], military: [] }; }

  /** Empty inventory with every resource key present (save/load friendly). */
  FSSim.emptyInv = function () {
    const inv = {};
    for (let i = 0; i < FSC.RES_LIST.length; i++) inv[FSC.RES_LIST[i]] = 0;
    inv.serf = 0; inv.knight = 0;
    return inv;
  };

  /** Warehouse serf pool: job → count of idle serfs stored inside. */
  FSSim.emptyPool = function () {
    const pool = {};
    for (const k in JOB) pool[JOB[k]] = 0;
    return pool;
  };

  FSSim.makeFlag = function (G, p, v) {
    const f = { id: newId(G), p, v, slots: [], roads: [], bld: 0 };
    G.flags[f.id] = f;
    G.map.flagAt[v] = f.id;
    bumpRoutes(G);
    return f;
  };

  FSSim.makeBuilding = function (G, p, type, v, state) {
    const def = FSC.BLD[type];
    const b = {
      id: newId(G), p, type, v,
      flag: 0,
      state: state || "site",
      progress: 0,
      matHave: { plank: 0, stone: 0 },
      matGot: { plank: 0, stone: 0 },        // cumulative deliveries (incl. already hammered)
      matReq: { plank: (def.cost && def.cost.plank) || 0, stone: (def.cost && def.cost.stone) || 0 },
      matInFlight: { plank: 0, stone: 0 },
      matUsed: 0,
      swings: 0, swingT: 0,           /* ===== PHASE-C: construction accumulator ===== */
      leveled: def.size < 2,          // only LARGE sites need a digger (there is no medium tier)
      diggerReq: false, builderReq: false, crew: 0, crewT: 0,
      worker: 0, workerReq: false,
      stockIn: {}, stockOut: {}, reqInFlight: {},
      prodT: 0,
      burnT: 0,
      /* ===== PHASE-C: production state ===== */
      working: false,      // a cycle is running (drives smoke / sails / wheel)
      halted: false,       // player pressed "stop production"
      outT: 0,             // retry timer for outputs held back by a full flag
      cycles: 0,           // completed production cycles (stats + suites)
      altOut: 0,           // weaponsmith sword/shield alternation
    };
    /* ===== PHASE-D: `knights` is a list of RANKS (0..4), not serf ids — a
     * garrisoned knight is stored inside the building exactly like an idle serf
     * is stored in a warehouse pool, and materialises as an entity only when he
     * marches out. `defending` counts knights currently duelling at the flag
     * (they still hold the building for territory purposes). */
    if (def.mil) {
      b.mil = { knights: [], wanted: 0, gold: 0, goldReq: 0, inbound: 0, defending: 0, attackers: [], fight: null, warned: 0 };
    }
    if (def.mine) b.mine = { kind: def.mine, exhausted: false };
    if (def.warehouse) {
      b.inv = FSSim.emptyInv(); b.pool = FSSim.emptyPool(); b.spawnT = 0;
      b.modes = {};        /* ===== PHASE-C: per-res In/Stop/Out ===== */
      b.knightRanks = [];  /* ===== PHASE-D: ranks of the knights resting here ===== */
    }
    G.buildings[b.id] = b;
    G.map.bldAt[v] = b.id;
    /* PLAYTEST 2026-08-01 — a large building is SEVEN vertices of masonry, not
     * one. Marking the body (FSMap.footprintOf, door excluded and any vertex
     * already carrying a flag or road grandfathered) is what finally stops
     * settlers cutting the corner straight through the castle. */
    if (G.map.bldFoot) {
      const foot = FSMap.footprintOf(G.map, type, v);
      for (let i = 0; i < foot.length; i++) G.map.bldFoot[foot[i]] = b.id;
    }
    return b;
  };

  /** Give a building's body vertices back to the world. */
  function clearFootprint(G, b) {
    const foot = G.map.bldFoot;
    if (!foot || !b) return;
    for (let d = 0; d < 6; d++) {
      const u = FSMap.nbr(G.map, b.v, d);
      if (u >= 0 && foot[u] === b.id) foot[u] = 0;
    }
  }

  /**
   * Is this vertex walled off to a walker? The anchor vertex AND — for a large
   * building — its body. THROUGH-traffic only: every path search exempts its
   * own destination, so a serf still walks in at the door, a builder still
   * stands on the site he is raising, and a digger still levels the pad.
   */
  function bldBlocks(G, v) {
    return !!(G.map.bldAt[v] || (G.map.bldFoot && G.map.bldFoot[v]));
  }
  FSSim.bldBlocks = bldBlocks;

  // ------------------------------------------------------------------- events
  FSSim.event = function (G, type, data) {
    const e = data ? Object.assign({ t: G.tick, type }, data) : { t: G.tick, type };
    G.events.push(e);
    if (G.events.length > FSC.EVENT_CAP) G.events.splice(0, G.events.length - FSC.EVENT_CAP);
    return e;
  };
  const event = FSSim.event;

  FSSim.notify = function (G, p, text, v) {
    G.notif.push({ t: G.tick, p, text, v: v === undefined ? -1 : v });
    // PER-PLAYER eviction: warring AIs generate chatter fast enough to flush a
    // shared oldest-first ring, silently deleting the human's own "Under
    // attack!" entries. Each player owns NOTIF_CAP slots; a global backstop
    // still bounds the array.
    let mine = 0;
    for (let i = 0; i < G.notif.length; i++) if (G.notif[i].p === p) mine++;
    if (mine > FSC.NOTIF_CAP) {
      for (let i = 0; i < G.notif.length; i++) {
        if (G.notif[i].p === p) { G.notif.splice(i, 1); break; }
      }
    }
    if (G.notif.length > FSC.NOTIF_CAP_TOTAL) G.notif.splice(0, G.notif.length - FSC.NOTIF_CAP_TOTAL);
  };

  /** Vertices whose terrain/objects changed — the renderer drains this list. */
  function dirty(G, v) {
    // the renderer drains this every frame; headless runs simply let it fill up
    if (v >= 0 && G.dirtyV.length < 4096) G.dirtyV.push(v);
  }
  FSSim.dirtyVertices = function (G) { return G.dirtyV; };

  /**
   * Territory. PHASE-D replaces this with the influence-weight model in
   * fs-military.js (FSMil.recomputeOwnership) — which also runs the "land you
   * lost burns" cascade. The nearest-claimer rule below is the Phase-B fallback
   * that keeps this file runnable on its own.
   */
  FSSim.recomputeOwner = function (G, area) {
    const M = mil();
    if (M && M.recomputeOwnership) return M.recomputeOwnership(G, area);
    const map = G.map, N = map.W * map.H;
    const claims = [];
    for (const id in G.buildings) {
      const b = G.buildings[id];
      const def = FSC.BLD[b.type];
      if (!def.mil || b.state !== "done") continue;
      const r = b.type === "castle" ? FSC.CASTLE_RADIUS : def.mil.terrRadius;
      claims.push({ v: b.v, r, p: b.p, id: b.id });
    }
    map.owner.fill(-1);
    if (!claims.length) return;
    const best = new Float32Array(N).fill(1e9);
    const bestId = new Int32Array(N).fill(0);
    for (let k = 0; k < claims.length; k++) {
      const cl = claims[k];
      FSMap.forRadius(map, cl.v, cl.r, (u, d) => {
        if (d < best[u] || (d === best[u] && cl.id < bestId[u])) {
          best[u] = d; bestId[u] = cl.id; map.owner[u] = cl.p;
        }
      });
    }
  };

  // ------------------------------------------------------------------ new game
  /**
   * FSSim.newGame({size, seed, ais, humans, mode}) — generate a world and seat
   * every player.  size: 'small'|'medium'|'large' (or a number).
   * ais: 0..3 computer opponents.
   * PHASE-D / plan §16: `humans` 1|2 and `mode` 'shared'|'separate' pick the
   * co-op shape. SHARED = both seats drive player 0. SEPARATE = seat 1 gets its
   * own castle as player 1, ALLIED with player 0 (same team). Every AI is its
   * own team, so "enemy" always means "different team".
   */
  FSSim.newGame = function (opts) {
    opts = opts || {};
    const ais = Math.max(0, Math.min(3, opts.ais === undefined ? 1 : opts.ais | 0));
    const mode = opts.mode === "separate" ? "separate" : "shared";
    /* PLAYTEST 2026-08-01 — AI difficulty is GAME state, not a client setting:
     * it changes how the opponents plan, so both machines in a lockstep game
     * must read the same value. It rides in G exactly like the seed and the
     * map size, which is the path the host's setup already travels. */
    const difficulty = FSC.AI_DIFF[opts.difficulty] ? opts.difficulty : FSC.AI_DIFF_DEFAULT;
    const humans = Math.max(1, Math.min(2, (mode === "separate" ? (opts.humans || 2) : 1) | 0));
    const nPlayers = Math.min(4, humans + ais);
    const seed = (opts.seed >>> 0) || 1;

    /* batch #5: the generator is told how many of the LEADING starts are allied
     * (= `humans`, since plan §16 seats every human on team 0), so separate-
     * kingdoms co-op puts the two human castles within reach of each other and
     * the AIs far away. Solo and shared co-op pass 1 and get the map they
     * always got. Part of the seed contract — it rides in the same settings
     * block as the seed and the size. */
    const map = FSMap.generate({ seed, size: opts.size, players: nPlayers, allies: humans });
    FSMap.bind(map);

    const G = {
      version: FSC.VERSION,
      seed, tick: 0, speed: 1, nextId: 1,
      size: opts.size || "medium",
      difficulty,               /* how hard the computer opponents play */
      map,
      players: [],
      flags: {}, roads: {}, buildings: {}, serfs: {},
      events: [], notif: [],
      stats: {},
      routeGen: 1,
      /* ===== PHASE-B: command layer + work queues ===== */
      cmdQueue: [], cmdSeq: 0, cmdLog: 0,
      mode, humans,             /* ===== PHASE-D: co-op shape ===== */
      seats: mode === "separate" ? [0, 1] : [0, 0],   // seat id → player id
      serfReqs: [],             // {p, job, kind:'road'|'bld'|'geo', id, due}
      retryQ: [],               // {f: flagId, due} — destless goods
      dirtyV: [],               // vertices the renderer must re-sync
      gameOver: null,
      rngState: FSC.rngSnapshot(),
      /* ===== PHASE-C: background sweep + production bookkeeping ===== */
      sweepV: 0,                // strided cursor over the map (trees, fields, fish)
      prod: [],                 // per player: {res: total ever produced}
      /* PLAYTEST 2026-08-02 — the mirror image of `prod`, and the other half of
       * the rate strip in the HUD: {res: total ever CONSUMED}, counted wherever
       * a good genuinely leaves the economy — a workshop eating its inputs, a
       * miner eating a meal, a construction site swallowing a plank or a stone,
       * a settler taking up a tool, a knight being armed. Plain monotonic
       * integers, no rng, no branching off them, so lockstep is untouched; the
       * UI turns them into a per-minute rate by differencing over a window. */
      cons: [],                 // per player: {res: total ever consumed}
      statT: 0,
      /* ===== PHASE-D: military bookkeeping ===== */
      ownerGen: 1,              // bumped whenever map.owner changed (render/AI cache key)
      aiPlan: opts.aiPlan === false ? false : true,   // suites can park the opponents
      doomQ: [],                // staggered teardown of an eliminated player's estate
      corpses: [],              // {v, p, t} — render fades them, sim drops them
    };

    for (let i = 0; i < nPlayers; i++) {
      G.players.push(makePlayer(G, i, i >= humans));
      // teams: every human is on team 0, every AI is a team of its own, numbered
      // from 1 up (plan §16 — solo is the humans=1 case, so team === id there)
      G.players[i].team = i < humans ? 0 : 1 + (i - humans);
      G.stats[i] = makeStats();
      G.prod.push({});
      G.cons.push({});
    }

    // castles: building entity + its door flag, start inventory, starting land
    for (let i = 0; i < nPlayers; i++) {
      const v = map.starts[i];
      const b = FSSim.makeBuilding(G, i, "castle", v, "done");
      b.mil.wanted = FSC.BLD.castle.mil.cap;
      const inv = b.inv;
      // Supplies 0..50 interpolates the classic's 5-anchor starting-stock table
      const sinv = FSC.suppliesInv(opts.supplies);
      for (const k in sinv) inv[k] = sinv[k];
      // the exact confirmed starting roster lives in the castle as a job-tagged pool
      for (const job in FSC.START_SERFS) b.pool[job] = FSC.START_SERFS[job];
      /* ===== PHASE-D: the starting knights already man the castle wall ===== */
      while (b.pool.knight > 0 && b.mil.knights.length < FSC.CASTLE_KNIGHTS_DEFAULT) {
        b.pool.knight--; b.mil.knights.push(0);
      }
      for (let k = 0; k < b.pool.knight; k++) b.knightRanks.push(0);
      inv.serf = b.pool.generic; inv.knight = b.pool.knight;
      G.players[i].castleId = b.id;

      const door = FSMap.doorVertex(map, v);
      if (door >= 0) {
        const f = FSSim.makeFlag(G, i, door);
        f.bld = b.id;
        b.flag = f.id;
      }
    }
    /* ===== PHASE-D: seed garrison targets, then draw the first borders ===== */
    const M = mil();
    if (M) M.initGame(G); else FSSim.recomputeOwner(G);

    FSSim.notify(G, 0, "Your castle stands ready.");
    return G;
  };

  /* ===================================================================== */
  /* ===== PHASE-B: command layer (plan §16 — solo and MP share it) ===== */
  /* ===================================================================== */

  /**
   * FSSim.issueCommand(G, {t, seq, by, type, args}) — queue a player action.
   * Commands execute at the START of tick `t` in (t, by, seq) order, so two seats
   * issuing on the same tick always resolve identically on every machine.
   * Solo default t = G.tick + FSC.CMD_DELAY.
   *
   * Two pumps run the queue early, both MP-safe:
   *  - `speed` is a pacing control, not sim state (it is excluded from FSSim.hash),
   *  - a PAUSED solo sim never ticks, so its queue would never drain. MP never
   *    pauses the tick schedule (plan §16), so this pump cannot fire there.
   */
  FSSim.issueCommand = function (G, cmd) {
    cmd = cmd || {};
    /* ===== PHASE-M: the ONE multiplayer seam on the command layer. FSNet sets
     * FSSim.netHook while a room is live; solo leaves it null and this whole
     * block costs one property read.
     *   hook.delay(type, G) → ticks of lead time (host: FSC.CMD_DELAY_MP scaled
     *     by G.speed, so a command stamped here always reaches the other machine
     *     with the same ~400 ms of real time to spare at any sim speed)
     *   hook.route(G, c) → true when the transport consumed it (guest: the
     *     command travels to the host and comes back as a broadcast instead of
     *     being queued locally). `cmd.net` marks a command that ARRIVED from the
     *     wire — it is queued verbatim and never re-routed.
     * Everything funnels through here: UI, __FS__, suites, sim internals. */
    const hook = cmd.net ? null : FSSim.netHook;
    const delay = hook && hook.delay ? hook.delay(String(cmd.type || ""), G) : FSC.CMD_DELAY;
    const c = {
      t: cmd.t === undefined ? G.tick + delay : cmd.t | 0,
      seq: cmd.seq === undefined ? G.cmdSeq++ : cmd.seq | 0,
      by: cmd.by === undefined ? 0 : cmd.by | 0,
      type: String(cmd.type || ""),
      args: cmd.args || {},
    };
    if (hook && hook.route && hook.route(G, c)) return c;   /* PHASE-M: guest → host */
    G.cmdQueue.push(c);
    if (c.type === "speed" || G.speed === 0) FSSim.runCommands(G, true);
    return c;
  };
  /* ===== PHASE-M: set by FSNet (see fs-net.js). Null in solo. ===== */
  FSSim.netHook = null;

  function cmdOrder(a, b) { return (a.t - b.t) || (a.by - b.by) || (a.seq - b.seq); }

  /** Execute every queued command due at or before this tick (ahead: include tick+1). */
  FSSim.runCommands = function (G, ahead) {
    if (!G.cmdQueue.length) return 0;
    const limit = G.tick + (ahead ? 1 : 0);
    G.cmdQueue.sort(cmdOrder);
    let n = 0;
    while (G.cmdQueue.length && G.cmdQueue[0].t <= limit) {
      const c = G.cmdQueue.shift();
      execCommand(G, c);
      n++;
    }
    return n;
  };

  function execCommand(G, c) {
    const p = G.seats[c.by] === undefined ? 0 : G.seats[c.by];
    const a = c.args || {};
    let r = null;
    switch (c.type) {
      case "flag": r = FSSim.placeFlag(G, a.v, p); break;
      case "road": r = FSSim.buildRoad(G, a.f1, a.f2, a.path, p, { water: a.water }); break;
      case "build": r = FSSim.build(G, a.type, a.v, p); break;
      case "demolish": r = FSSim.demolish(G, a.id, p); break;
      case "speed": r = FSSim.setSpeed(G, a.speed); break;
      case "prio": r = FSSim.setTransportPrio(G, p, a.order); break;
      /* ===== PHASE-E: warehouse output priority (mirrors "prio") ===== */
      case "invPrio": r = FSSim.setInvPrio(G, p, a.order); break;
      /* ===== PHASE-C: geologist, distribution, tools, warehouse modes, halt ===== */
      case "geologist": r = FSSim.sendGeologist(G, a.flag, p); break;
      case "dist": r = FSSim.setDist(G, p, a.key, a.value); break;
      case "toolPrio": r = FSSim.setToolPrio(G, p, a.tool, a.value); break;
      case "stockMode": r = FSSim.setStockMode(G, a.id, a.res, a.mode, p); break;
      case "halt": r = FSSim.setHalt(G, a.id, a.on, p); break;
      /* ===== PHASE-D: military orders (fs-military owns the rules) ===== */
      case "attack": r = mil() ? mil().attack(G, a.id, a.count, p, a.strong) : { ok: false, why: "no military module" }; break;
      case "knightSet": r = FSSim.setKnightSetting(G, p, a.key, a.value, a.tier); break;
      case "cycleKnights": r = mil() ? mil().cycleKnights(G, p) : { ok: false, why: "no military module" }; break;
      /* ===== PHASE-M: co-op "look here!" marker — event only, no sim state ===== */
      case "ping": r = FSSim.ping(G, a.v, p, c.by); break;
      default: r = { ok: false, why: "unknown command" };
    }
    G.cmdLog++;
    if (!r || !r.ok) {
      // args come off the WIRE in co-op — store a bounded copy, never the raw
      // object (an oversized frame would live in G.events, bloat every save and
      // ride every resync; serialize walks all of G)
      let argNote = "";
      try { argNote = JSON.stringify(a); } catch (e) { argNote = "?"; }
      if (argNote.length > 200) argNote = argNote.slice(0, 200) + "…";
      event(G, "cmdFail", { cmd: c.type, by: c.by, why: (r && r.why) || "failed", args: argNote });
    }
    return r;
  }
  FSSim.execCommand = execCommand;

  FSSim.setSpeed = function (G, s) {
    if (FSC.SPEEDS.indexOf(s) < 0) return { ok: false, why: "bad speed" };
    G.speed = s;
    return { ok: true, speed: s };
  };

  FSSim.setTransportPrio = function (G, p, order) {
    const pl = G.players[p];
    if (!pl || !order || !order.length) return { ok: false, why: "bad order" };
    pl.transportPrio = order.slice();
    return { ok: true };
  };
  /* ===== PHASE-E: warehouse OUTPUT priority — mirrors setTransportPrio ===== */
  FSSim.setInvPrio = function (G, p, order) {
    const pl = G.players[p];
    if (!pl || !order || !order.length) return { ok: false, why: "bad order" };
    pl.invPrio = order.slice();
    return { ok: true };
  };

  /**
   * PHASE-D — the Knights panel. Keys:
   *   recruitRate   0..FSC.PRIO_MAX   how eagerly settlers become knights
   *   castleKnights 0..CASTLE_KNIGHTS_MAX
   *   attackStrong  bool              attacks send the strongest knights first
   *   occMin/occMax 0..4 + `tier` 0..3  occupation level per threat tier
   */
  FSSim.setKnightSetting = function (G, p, key, value, tier) {
    const pl = G.players[p];
    if (!pl) return { ok: false, why: "no player" };
    const k = pl.knights;
    if (key === "recruitRate") {
      k.recruitRate = Math.max(0, Math.min(FSC.PRIO_MAX, value | 0));
    } else if (key === "castleKnights") {
      k.castleKnights = Math.max(0, Math.min(FSC.CASTLE_KNIGHTS_MAX, value | 0));
    } else if (key === "attackStrong") {
      k.attackStrong = !!value;
    } else if (key === "occMin" || key === "occMax") {
      const ti = tier | 0;
      if (ti < 0 || ti >= k.occ.length) return { ok: false, why: "bad tier" };
      let v = Math.max(0, Math.min(FSC.OCC_LEVEL_MAX, value | 0));
      const pair = k.occ[ti];
      if (key === "occMin") pair[0] = Math.min(v, pair[1]);
      else { pair[1] = Math.max(v, pair[0]); }
    } else {
      return { ok: false, why: "unknown knight setting" };
    }
    // garrison targets are recomputed on the next sweep — nudge it so the UI
    // reacts immediately instead of up to GARRISON_T ticks later
    if (mil()) mil().refreshWanted(G, p);
    return { ok: true, key, value };
  };

  /* ===================================================================== */
  /* ===== PHASE-B: flag graph + routing =================================== */
  /* ===================================================================== */

  function bumpRoutes(G) { G.routeGen++; }
  FSSim.bumpRoutes = bumpRoutes;

  // one BFS table per destination flag, thrown away whenever the network changes
  const _rc = { G: null, gen: -1, dest: null };
  function routeTable(G, destFlag) {
    if (_rc.G !== G || _rc.gen !== G.routeGen) { _rc.G = G; _rc.gen = G.routeGen; _rc.dest = new Map(); }
    let t = _rc.dest.get(destFlag);
    if (t) return t;
    const next = new Map(), hops = new Map();
    if (G.flags[destFlag]) {
      hops.set(destFlag, 0);
      let frontier = [destFlag], h = 0;
      while (frontier.length) {
        const nf = [];
        h++;
        for (let i = 0; i < frontier.length; i++) {
          const f = G.flags[frontier[i]];
          if (!f) continue;
          for (let k = 0; k < f.roads.length; k++) {
            const r = G.roads[f.roads[k]];
            if (!r) continue;
            const o = r.f1 === f.id ? r.f2 : r.f1;
            if (hops.has(o)) continue;
            hops.set(o, h);
            next.set(o, r.id);       // standing at `o`, take road r toward destFlag
            nf.push(o);
          }
        }
        frontier = nf;
      }
    }
    t = { next, hops };
    _rc.dest.set(destFlag, t);
    return t;
  }
  FSSim.routeTable = routeTable;

  /** Road to take from `fromFlag` for the next hop toward `destFlag` (0 = none/arrived). */
  FSSim.nextRoad = function (G, fromFlag, destFlag) {
    if (!fromFlag || !destFlag || fromFlag === destFlag) return 0;
    return routeTable(G, destFlag).next.get(fromFlag) || 0;
  };
  /** Road hops between two flags, or -1 when they are on different networks. */
  FSSim.hops = function (G, fromFlag, destFlag) {
    if (fromFlag === destFlag) return 0;
    const h = routeTable(G, destFlag).hops.get(fromFlag);
    return h === undefined ? -1 : h;
  };

  /** Flag-id path from → to (inclusive), or null. */
  FSSim.flagPath = function (G, fromFlag, toFlag) {
    if (!G.flags[fromFlag] || !G.flags[toFlag]) return null;
    if (fromFlag === toFlag) return [fromFlag];
    const t = routeTable(G, toFlag);
    if (!t.hops.has(fromFlag)) return null;
    const out = [fromFlag];
    let cur = fromFlag, guard = 0;
    while (cur !== toFlag && guard++ < 4096) {
      const rid = t.next.get(cur);
      const r = G.roads[rid];
      if (!r) return null;
      cur = r.f1 === cur ? r.f2 : r.f1;
      out.push(cur);
    }
    return cur === toFlag ? out : null;
  };

  /** Expand a flag path into the full vertex path a serf actually walks. */
  FSSim.vertexPath = function (G, flagIds) {
    if (!flagIds || !flagIds.length) return null;
    const out = [G.flags[flagIds[0]].v];
    for (let i = 0; i + 1 < flagIds.length; i++) {
      const a = G.flags[flagIds[i]], b = G.flags[flagIds[i + 1]];
      let road = null;
      for (let k = 0; k < a.roads.length; k++) {
        const r = G.roads[a.roads[k]];
        if (r && ((r.f1 === a.id && r.f2 === b.id) || (r.f2 === a.id && r.f1 === b.id))) { road = r; break; }
      }
      if (!road) return null;
      const path = road.f1 === a.id ? road.path : road.path.slice().reverse();
      for (let k = 1; k < path.length; k++) out.push(path[k]);
    }
    return out;
  };

  /**
   * Nearest flag (fewest road hops) where test(flagId, hops) is truthy.
   * Ties at the same hop count resolve to the LOWEST flag id — deterministic.
   */
  function nearestFlagWhere(G, startFlag, test, maxHops) {
    if (!G.flags[startFlag]) return null;
    const cap = maxHops === undefined ? FSC.ROUTE_MAX_HOPS : maxHops;
    const seen = new Set([startFlag]);
    let frontier = [startFlag], hops = 0;
    while (frontier.length && hops <= cap) {
      let best = -1, bestVal = null;
      for (let i = 0; i < frontier.length; i++) {
        const fid = frontier[i];
        const val = test(fid, hops);
        if (val && (best < 0 || fid < best)) { best = fid; bestVal = val; }
      }
      if (best >= 0) return { flag: best, hops, val: bestVal };
      const nf = [];
      for (let i = 0; i < frontier.length; i++) {
        const f = G.flags[frontier[i]];
        if (!f) continue;
        for (let k = 0; k < f.roads.length; k++) {
          const r = G.roads[f.roads[k]];
          if (!r) continue;
          const o = r.f1 === f.id ? r.f2 : r.f1;
          if (seen.has(o)) continue;
          seen.add(o); nf.push(o);
        }
      }
      frontier = nf; hops++;
    }
    return null;
  }
  FSSim.nearestFlagWhere = nearestFlagWhere;

  /* ===================================================================== */
  /* ===== PHASE-B: requests / demand registry ============================ */
  /* ===================================================================== */

  /**
   * How much of `res` building `b` still wants, counting goods already on the way.
   * PHASE-C extends the `done` branch with production inputs — the shape stays.
   */
  FSSim.need = function (G, b, res) {
    if (!b || b.state === "burn") return 0;
    const def = defOf(b);
    if (b.state !== "done") {
      if (res !== "plank" && res !== "stone") return 0;
      // matGot (not matHave) — a material already hammered into the walls still counts
      const want = (b.matReq[res] || 0) - (b.matGot[res] || 0) - (b.matInFlight[res] || 0);
      const room = FSC.IN_CAP - (b.matInFlight[res] || 0);       // cap goods in flight
      return Math.max(0, Math.min(want, room));
    }
    /* ===== PHASE-D: a manned military building stockpiles gold (it raises the
     * player's morale share). The castle is a warehouse first — its gold lands
     * in `inv` like any other stored good, so it is excluded here. */
    if (def.mil && !def.warehouse) {
      if (res !== "goldBar") return 0;
      if (!b.mil || b.mil.knights.length + b.mil.defending <= 0) return 0;
      const cap = def.mil.goldCap || 0;
      return Math.max(0, cap - (b.mil.gold || 0) - (b.reqInFlight.goldBar || 0));
    }
    /* ===== PHASE-C: production inputs ===== */
    // a finished building only stocks up once it is staffed (or a worker is on the
    // way) — an unmanned workshop must not hoard the settlement's goods
    if (!b.worker && !b.workerReq) return 0;
    if (def.in && def.in[res]) {
      return Math.max(0, FSC.IN_CAP - (b.stockIn[res] || 0) - (b.reqInFlight[res] || 0));
    }
    // mines eat ONE food per attempt, any kind — the cap is shared across the three
    if (def.inFood && isFood(res)) {
      if (b.mine && b.mine.exhausted) return 0;      // a dead mine stops eating
      return Math.max(0, FSC.IN_CAP - foodStock(b) - foodInFlight(b));
    }
    return 0;
  };

  /* ===== PHASE-C: food helpers (mines take fish OR bread OR meat) ===== */
  function isFood(res) { return FSC.FOODS.indexOf(res) >= 0; }
  function foodStock(b) {
    let n = 0;
    for (let i = 0; i < FSC.FOODS.length; i++) n += b.stockIn[FSC.FOODS[i]] || 0;
    return n;
  }
  function foodInFlight(b) {
    let n = 0;
    for (let i = 0; i < FSC.FOODS.length; i++) n += b.reqInFlight[FSC.FOODS[i]] || 0;
    return n;
  }
  FSSim.isFood = isFood;
  FSSim.foodStock = foodStock;

  /**
   * Every open request for `res` belonging to player `p`, as an iterable list.
   * PHASE-C consumers (production inputs, tools, food distribution) use this too:
   *   FSSim.requests(G, p, res) → [{bld, flag, need}]
   */
  FSSim.requests = function (G, p, res) {
    const out = [];
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.flag) continue;
      const n = FSSim.need(G, b, res);
      if (n > 0) out.push({ bld: b, flag: b.flag, need: n });
    }
    return out;
  };

  /** Nearest building (by road hops from `fromFlag`) with an open request for `res`. */
  FSSim.demandNear = function (G, fromFlag, res, p, skipBldId) {
    const hit = nearestFlagWhere(G, fromFlag, (fid) => {
      const f = G.flags[fid];
      if (!f || f.p !== p || !f.bld) return null;
      const b = G.buildings[f.bld];
      if (!b || b.id === skipBldId) return null;
      return FSSim.need(G, b, res) > 0 ? b : null;
    });
    return hit ? hit.val : null;
  };

  /* ===================================================================== */
  /* ===== PHASE-C: distribution arbitration (plan §6) ==================== */
  /* ===================================================================== */

  /**
   * Which distribution slider governs "this building wanting this resource"?
   * Returns a Player.dist key, or null when the resource has only one consumer
   * class (stone, lumber, flour…) and nothing has to be arbitrated.
   */
  function distKey(res, b) {
    const table = FSC.DIST_CLASS[isFood(res) ? "_food" : res];
    if (!table) return null;
    if (b.state !== "done") return table._site || null;      // a construction site
    return table[b.type] || null;
  }
  FSSim.distKey = distKey;

  /**
   * Every open request for `res` reachable from `fromFlag`, nearest first.
   * Bounded: the search stops DIST_LOOKAHEAD hop levels past the first hit, or
   * at DIST_MAX_CAND candidates — it never walks the whole network.
   */
  function gatherDemand(G, fromFlag, res, p, skipBldId) {
    const out = [];
    if (!G.flags[fromFlag]) return out;
    const seen = new Set([fromFlag]);
    let frontier = [fromFlag], hops = 0, firstHit = -1;
    while (frontier.length && hops <= FSC.ROUTE_MAX_HOPS) {
      for (let i = 0; i < frontier.length; i++) {
        const f = G.flags[frontier[i]];
        if (!f || f.p !== p || !f.bld) continue;
        const b = G.buildings[f.bld];
        if (!b || b.id === skipBldId) continue;
        if (FSSim.need(G, b, res) > 0) {
          out.push({ bld: b, flag: f.id, hops });
          if (firstHit < 0) firstHit = hops;
        }
      }
      if (out.length >= FSC.DIST_MAX_CAND) break;
      if (firstHit >= 0 && hops >= firstHit + FSC.DIST_LOOKAHEAD) break;
      const nf = [];
      for (let i = 0; i < frontier.length; i++) {
        const f = G.flags[frontier[i]];
        if (!f) continue;
        for (let k = 0; k < f.roads.length; k++) {
          const r = G.roads[f.roads[k]];
          if (!r) continue;
          const o = r.f1 === f.id ? r.f2 : r.f1;
          if (seen.has(o)) continue;
          seen.add(o); nf.push(o);
        }
      }
      frontier = nf; hops++;
    }
    out.sort((a, b) => (a.hops - b.hops) || (a.bld.id - b.bld.id));
    return out;
  }
  FSSim.gatherDemand = gatherDemand;

  /**
   * Pick WHO gets the next unit of `res` leaving `fromFlag`.
   * One class of requester → plain nearest (identical to FSSim.demandNear).
   * Two or more → smooth weighted round-robin on the player's distribution
   * sliders (0..FSC.PRIO_MAX; 0 means "never"), then nearest inside the class.
   */
  FSSim.chooseDemand = function (G, fromFlag, res, p, skipBldId) {
    const cands = gatherDemand(G, fromFlag, res, p, skipBldId);
    if (!cands.length) return null;
    const pl = G.players[p];
    if (!pl) return cands[0].bld;
    const keys = [];
    for (let i = 0; i < cands.length; i++) {
      const k = distKey(res, cands[i].bld) || "_";
      cands[i].key = k;
      if (keys.indexOf(k) < 0) keys.push(k);
    }
    if (keys.length < 2) return cands[0].bld;
    const cred = pl.distCredit || (pl.distCredit = {});
    let total = 0;
    for (let i = 0; i < keys.length; i++) {
      const w = keys[i] === "_" ? FSC.PRIO_MAX : (pl.dist[keys[i]] || 0);
      if (w > 0) total += w;
    }
    if (total <= 0) return cands[0].bld;             // every class muted → nearest
    let pick = null, bestCred = 0;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const w = k === "_" ? FSC.PRIO_MAX : (pl.dist[k] || 0);
      if (w <= 0) continue;
      cred[k] = (cred[k] || 0) + w;
      if (pick === null || cred[k] > bestCred) { pick = k; bestCred = cred[k]; }
    }
    if (pick === null) return cands[0].bld;
    cred[pick] -= total;
    for (let i = 0; i < cands.length; i++) if (cands[i].key === pick) return cands[i].bld;
    return cands[0].bld;
  };

  /** Warehouse mode gate: may this store still take `res` in? */
  function stockAccepts(b, res) {
    if (!b.modes) return true;
    return (b.modes[res] || 0) === FSC.STOCK_MODE.IN;
  }
  FSSim.stockAccepts = stockAccepts;

  /** Nearest warehouse (castle/stock) reachable from `fromFlag`. Warehouses accept all. */
  FSSim.warehouseNear = function (G, fromFlag, p, testFn) {
    const hit = nearestFlagWhere(G, fromFlag, (fid) => {
      const f = G.flags[fid];
      if (!f || f.p !== p || !f.bld) return null;
      const b = G.buildings[f.bld];
      if (!b || !b.inv || b.state !== "done") return null;
      if (testFn && !testFn(b)) return null;
      return b;
    });
    return hit ? hit.val : null;
  };

  /**
   * Goods in flight are booked against matInFlight while a site is under
   * construction and reqInFlight once it produces. A delivery that lands just
   * after the site finished must still clear the counter it was booked on.
   */
  function inFlightAdd(G, b, res, n) {
    if (!b) return;
    const isMat = res === "plank" || res === "stone";
    if (isMat && (b.state !== "done" || (n < 0 && (b.matInFlight[res] || 0) > 0))) {
      b.matInFlight[res] = Math.max(0, (b.matInFlight[res] || 0) + n);
    } else {
      b.reqInFlight[res] = Math.max(0, (b.reqInFlight[res] || 0) + n);
    }
  }

  /* ===================================================================== */
  /* ===== PHASE-B: goods on flags ======================================== */
  /* ===================================================================== */

  function markRetry(G, flagId, due) {
    for (let i = 0; i < G.retryQ.length; i++) if (G.retryQ[i].f === flagId) return;
    G.retryQ.push({ f: flagId, due: due === undefined ? G.tick + FSC.RETRY_T : due });
  }
  /**
   * The network shrank: every waiting good has to be re-examined, because a
   * destination that was reachable a moment ago may not be any more.
   */
  function markAllRetry(G) {
    for (const id in G.flags) if (G.flags[id].slots.length) markRetry(G, G.flags[id].id, G.tick);
  }

  /** A flag-addressed boat that loses its address must free the road's latch,
   * or the ferry never re-requests and silently eats the boat. */
  function releaseBoatBinding(G, item) {
    if (item.res === "boat" && item.road) {
      const r = G.roads[item.road];
      if (r && r.boatInFlight && !r.boatHave) r.boatInFlight = 0;
    }
    item.road = 0;
  }
  FSSim.releaseBoatBinding = releaseBoatBinding;

  /** Resolve an item's destination: open request → warehouse → destless (retry later). */
  FSSim.scheduleItem = function (G, flag, item) {
    /* ===== PHASE-C: a boat is addressed to a FLAG (the water road's shore end) ===== */
    if (item.destFlag) {
      const tf = G.flags[item.destFlag];
      if (tf && (tf.id === flag.id || FSSim.hops(G, flag.id, tf.id) >= 0)) return 0;
      item.destFlag = 0;                                    // gone or cut off
      releaseBoatBinding(G, item);
    }
    if (item.dest) { inFlightAdd(G, G.buildings[item.dest], item.res, -1); item.dest = 0; }
    const dest = FSSim.chooseDemand(G, flag.id, item.res, flag.p)
      || FSSim.warehouseNear(G, flag.id, flag.p, (b) => stockAccepts(b, item.res));
    if (dest) { item.dest = dest.id; inFlightAdd(G, dest, item.res, 1); }
    else markRetry(G, flag.id);
    return item.dest;
  };

  /** Put a good on a flag. dest undefined → resolve now; 0 → deliberately destless. */
  FSSim.pushItem = function (G, flag, res, dest, opts) {
    if (!flag || flag.slots.length >= FSC.FLAG_CAP) return null;
    const item = { res, dest: 0, t0: G.tick };   // t0 feeds anti-starvation aging
    flag.slots.push(item);
    /* ===== PHASE-C: flag-addressed goods (a boat for a water road) ===== */
    if (opts && opts.destFlag) {
      item.destFlag = opts.destFlag;
      if (opts.road) item.road = opts.road;
      return item;
    }
    if (dest === undefined) FSSim.scheduleItem(G, flag, item);
    else if (dest) { item.dest = dest; inFlightAdd(G, G.buildings[dest], res, 1); }
    else markRetry(G, flag.id);
    return item;
  };

  /**
   * PHASE-C HOOK — a producer finished a good: place it on its door flag with a
   * resolved destination. Returns the item, or null when the flag is full.
   */
  FSSim.outputGood = function (G, b, res) {
    const f = flagOf(G, b.flag);
    if (!f) return null;
    return FSSim.pushItem(G, f, res, undefined);
  };

  /** What a carrier is holding, rebuilt as a flag item (keeps flag-addressing). */
  function carriedItem(s) {
    const it = { res: s.carry, dest: s.carryDest };
    if (s.carryFlag) { it.destFlag = s.carryFlag; if (s.carryRoad) it.road = s.carryRoad; }
    return it;
  }

  /** Hand a good into a building (warehouse inv / construction materials / inputs). */
  function deliverInto(G, b, res, fromSerf) {
    if (!b) return false;
    inFlightAdd(G, b, res, -1);
    if (b.state === "burn") { event(G, "itemLost", { res, v: b.v, why: "building burning" }); return false; }
    const def = defOf(b);
    if (b.inv && b.state === "done") {
      b.inv[res] = (b.inv[res] || 0) + 1;
    } else if (b.state !== "done" && (res === "plank" || res === "stone")) {
      b.matHave[res] = (b.matHave[res] || 0) + 1;
      b.matGot[res] = (b.matGot[res] || 0) + 1;
      b.lastMatT = G.tick;    // save-durable "last delivery" stamp for the waiting label
    } else if (def.mil && !def.warehouse && res === "goldBar") {
      b.mil.gold = (b.mil.gold || 0) + 1;           /* ===== PHASE-D: morale gold ===== */
    } else if (def.in && def.in[res]) {
      b.stockIn[res] = (b.stockIn[res] || 0) + 1;   /* ===== PHASE-C: production input ===== */
    } else if (def.inFood && isFood(res)) {
      b.stockIn[res] = (b.stockIn[res] || 0) + 1;   /* ===== PHASE-C: a miner's meal ===== */
    } else {
      event(G, "itemLost", { res, v: b.v, why: "nobody wanted it" });
      return false;
    }
    event(G, "itemDeliver", { serf: fromSerf || 0, res, bld: b.id, btype: b.type });
    return true;
  }
  FSSim.deliverInto = deliverInto;

  // pickup priority: lowest index in the player's transport-priority list wins
  const _prioCache = (typeof WeakMap === "function") ? new WeakMap() : null;
  function prioIndex(pl, res) {
    const arr = (pl && pl.transportPrio) || FSC.RES_ORDER;
    let m = _prioCache && _prioCache.get(arr);
    if (!m) {
      m = Object.create(null);
      for (let i = 0; i < arr.length; i++) m[arr[i]] = i;
      if (_prioCache) _prioCache.set(arr, m);
    }
    const x = m[res];
    return x === undefined ? 999 : x;
  }
  FSSim.prioIndex = prioIndex;

  /* ═══ CONSTRUCTION CLEARS WOOD (2026-08-01, playtest §3) ══════════════════
   * A road, a flag or a building landing on a tree fells it. One vertex, one
   * place: the legality side lives in `FSMap.objRefuses` (which lets the tree
   * family through) and every construction path funnels its vertices here.
   *
   * NO WOOD IS YIELDED. Clearing is not a harvest — a free plank for every road
   * step would out-earn the woodcutter chain the game is built around, and the
   * original has no such mechanic to be faithful to (farmstead-plan §14.13).
   *
   * The `dirty()` is what makes it look like felling rather than blinking: the
   * renderer's refreshVertex already leases the instanced slot and topples it
   * (`fall: true` for any tree kind), so the poof is free.
   *
   * Determinism: pure state edits driven by the command's own vertex list, no
   * FSC.rng, so a lockstep peer replays it identically.
   */
  function clearWood(G, v) {
    if (!(v >= 0) || v >= G.map.W * G.map.H) return false;
    if (!FSMap.clearableObj(G.map.obj[v])) return false;
    G.map.obj[v] = FSC.OBJ.NONE; G.map.objArg[v] = 0;
    dirty(G, v);
    return true;
  }
  /** clear a whole vertex list; ONE summary event, never one per tree — a
   *  20-step road through a wood would otherwise flush the event ring (and
   *  machine-gun the chop sound if it were reported as felling). */
  function clearWoodAlong(G, verts, why) {
    let n = 0;
    for (let i = 0; i < verts.length; i++) if (clearWood(G, verts[i])) n++;
    if (n) event(G, "woodCleared", { n, why: why || "build" });
    return n;
  }
  FSSim.clearWood = clearWood;
  FSSim.clearWoodAlong = clearWoodAlong;

  /* ===================================================================== */
  /* ===== PHASE-B: flags ================================================= */
  /* ===================================================================== */

  FSSim.placeFlag = function (G, v, p) {
    p = p || 0;
    if (!(v >= 0) || v >= G.map.W * G.map.H) return { ok: false, why: "off map" };
    const why = FSMap.whyFlag(G.map, v, p);
    if (why) return { ok: false, why };
    clearWoodAlong(G, [v], "flag");        // a flag fells the tree it stands on
    const f = FSSim.makeFlag(G, p, v);
    event(G, "flagPlaced", { id: f.id, v, p });
    // a flag dropped on an existing road splits it in two (no auto-merge on removal)
    splitRoadsAt(G, f);
    return { ok: true, id: f.id, flag: f };
  };

  function splitRoadsAt(G, f) {
    for (const id in G.roads) {
      const r = G.roads[id];
      const i = r.path.indexOf(f.v);
      if (i <= 0 || i >= r.path.length - 1) continue;    // endpoints are flags already
      const f2 = G.flags[r.f2];
      const r2 = {
        id: newId(G), p: r.p, f1: f.id, f2: r.f2,
        path: r.path.slice(i), water: r.water, carrier: 0, carrierReq: true,
      };
      r.path = r.path.slice(0, i + 1);
      r.f2 = f.id;
      f.roads.push(r.id); f.roads.push(r2.id);
      // hand the far flag's link over to the new segment
      const k = f2.roads.indexOf(r.id);
      if (k >= 0) f2.roads[k] = r2.id; else f2.roads.push(r2.id);
      G.roads[r2.id] = r2;
      bumpRoutes(G);
      // the existing carrier keeps whichever half he is standing on
      const s = G.serfs[r.carrier];
      if (s) {
        const onNew = r2.path.indexOf(s.v) >= 0, onOld = r.path.indexOf(s.v) >= 0;
        if (onNew || onOld) {
          if (onNew && !onOld) {
            r.carrier = 0; r.carrierReq = true;
            r2.carrier = s.id; r2.carrierReq = false;
            s.road = r2.id;
          }
          resetCarrier(G, s);
        } else if (!startCarrierWalk(G, s, r)) {
          // still walking IN (off both halves) and no route to the shortened
          // road: release him properly so the request system can re-crew it —
          // a bare resetCarrier here wedges him off-road forever while
          // r.carrier stays set and blocks any replacement
          r.carrier = 0; r.carrierReq = true;
          s.road = 0; sendHome(G, s);
        }
      } else {
        r.carrierReq = true;
      }
      requestCarrier(G, r);
      requestCarrier(G, r2);
      event(G, "roadSplit", { road: r.id, road2: r2.id, flag: f.id });
      return r2;
    }
    return null;
  }

  FSSim.removeFlag = function (G, id) {
    const f = flagOf(G, id);
    if (!f) return { ok: false, why: "no flag" };
    if (f.bld && G.buildings[f.bld]) return { ok: false, why: "a building uses this flag" };
    const roads = f.roads.slice();
    for (let i = 0; i < roads.length; i++) FSSim.demolishRoad(G, roads[i]);
    // goods waiting here are lost with the flag (deviation, listed in plan §14:
    // the classic scatters them to the ground; losing them keeps the economy
    // honest and the code simple — every booking and boat latch is released)
    for (let i = 0; i < f.slots.length; i++) {
      const it = f.slots[i];
      inFlightAdd(G, G.buildings[it.dest], it.res, -1);
      releaseBoatBinding(G, it);
      event(G, "itemLost", { res: it.res, v: f.v, why: "flag removed" });
    }
    f.slots.length = 0;
    G.map.flagAt[f.v] = 0;
    delete G.flags[f.id];
    bumpRoutes(G);
    markAllRetry(G);
    event(G, "flagRemoved", { id: f.id, v: f.v, p: f.p });
    return { ok: true };
  };

  /* ===================================================================== */
  /* ===== PHASE-B: roads ================================================= */
  /* ===================================================================== */

  /**
   * One legal road step. On top of FSMap's terrain/ownership/edge rules we add the
   * classic's junction rule: roads may only MEET at a flag, so a step may not enter
   * a vertex that already carries road edges unless it is this road's endpoint.
   */
  function roadStepOk(G, a, b, p, endB, water) {
    if (FSMap.whyRoadStep(G.map, a, b, p, { endB: endB, water: !!water })) return false;
    if (!endB && FSMap.edgeCount(G.map, b) > 0) return false;
    return true;
  }
  FSSim.roadStepOk = roadStepOk;

  /** Cheapest legal road path a→b over the lattice (A*, slope-weighted). */
  FSSim.roadPath = function (G, aV, bV, p, opts) {
    opts = opts || {};
    const map = G.map;
    if (aV === bV) return null;
    const maxLen = opts.maxLen || FSC.ROAD_MAX_LEN;
    const budget = opts.maxNodes || FSC.ROAD_SEARCH_NODES;
    const gScore = new Map(), came = new Map();
    const open = [];  // tiny binary heap of {v, f}
    function push(node) {
      open.push(node);
      let i = open.length - 1;
      while (i > 0) {
        const par = (i - 1) >> 1;
        if (open[par].f < open[i].f || (open[par].f === open[i].f && open[par].v <= open[i].v)) break;
        const tmp = open[par]; open[par] = open[i]; open[i] = tmp; i = par;
      }
    }
    function pop() {
      const top = open[0], last = open.pop();
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < open.length && (open[l].f < open[m].f || (open[l].f === open[m].f && open[l].v < open[m].v))) m = l;
          if (r < open.length && (open[r].f < open[m].f || (open[r].f === open[m].f && open[r].v < open[m].v))) m = r;
          if (m === i) break;
          const tmp = open[m]; open[m] = open[i]; open[i] = tmp; i = m;
        }
      }
      return top;
    }
    gScore.set(aV, 0);
    push({ v: aV, f: FSMap.dist(map, aV, bV) });
    let nodes = 0;
    while (open.length && nodes++ < budget) {
      const cur = pop();
      if (cur.v === bV) break;
      const g = gScore.get(cur.v);
      if (g === undefined || g > maxLen) continue;
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, cur.v, d);
        if (u < 0) continue;
        if (!roadStepOk(G, cur.v, u, p, u === bV, opts.water)) continue;
        const step = 1 + Math.abs(map.height[u] - map.height[cur.v]) * FSC.ROAD_SLOPE_COST;
        const ng = g + step;
        if (ng > maxLen) continue;
        const old = gScore.get(u);
        if (old !== undefined && old <= ng) continue;
        gScore.set(u, ng); came.set(u, cur.v);
        push({ v: u, f: ng + FSMap.dist(map, u, bV) });
      }
    }
    if (!came.has(bV)) return null;
    const out = [bV];
    let cur = bV, guard = 0;
    while (cur !== aV && guard++ < maxLen + 4) { cur = came.get(cur); out.push(cur); }
    if (cur !== aV) return null;
    out.reverse();
    return out;
  };

  /**
   * Build a road between two flags. `path` = explicit vertex list (both flag
   * vertices included); omitted → auto-routed. Every step is validated.
   */
  FSSim.buildRoad = function (G, f1Id, f2Id, path, p, opts) {
    p = p || 0;
    opts = opts || {};
    const f1 = flagOf(G, f1Id), f2 = flagOf(G, f2Id);
    if (!f1 || !f2) return { ok: false, why: "no flag" };
    if (f1.id === f2.id) return { ok: false, why: "same flag" };
    if (f1.p !== p || f2.p !== p) return { ok: false, why: "not your flag" };
    if (f1.roads.length >= 6 || f2.roads.length >= 6) return { ok: false, why: "flag is full" };
    if (!path || !path.length) path = FSSim.roadPath(G, f1.v, f2.v, p, { water: opts.water });
    if (!path || path.length < 2) return { ok: false, why: "no route" };
    if (path[0] !== f1.v || path[path.length - 1] !== f2.v) return { ok: false, why: "path does not join the flags" };
    if (path.length > FSC.ROAD_MAX_LEN + 1) return { ok: false, why: "road too long" };
    /* ===== PHASE-C: a road that touches water is a BOAT road ===== */
    let wet = false;
    for (let i = 0; i < path.length; i++) if (G.map.terr[path[i]] === FSC.TERR.WATER) wet = true;
    if (wet && (G.map.terr[f1.v] === FSC.TERR.WATER || G.map.terr[f2.v] === FSC.TERR.WATER)) {
      return { ok: false, why: "both ends must stand on the shore" };
    }
    for (let i = 0; i + 1 < path.length; i++) {
      const last = i + 2 === path.length;
      const crossing = G.map.terr[path[i]] === FSC.TERR.WATER || G.map.terr[path[i + 1]] === FSC.TERR.WATER;
      const why = FSMap.whyRoadStep(G.map, path[i], path[i + 1], p, { endB: last, water: crossing });
      if (why) return { ok: false, why };
      if (!last && FSMap.edgeCount(G.map, path[i + 1]) > 0) return { ok: false, why: "roads must meet at a flag" };
    }
    // no repeated vertices (a road may not cross itself)
    for (let i = 0; i < path.length; i++) for (let k = i + 1; k < path.length; k++) if (path[i] === path[k]) return { ok: false, why: "path repeats a vertex" };

    const r = { id: newId(G), p, f1: f1.id, f2: f2.id, path: path.slice(), water: wet, carrier: 0, carrierReq: true };
    if (wet) { r.boatHave = false; r.boatInFlight = 0; }
    // the road is cut through the wood: every vertex it lands on is felled
    clearWoodAlong(G, path, "road");
    for (let i = 0; i + 1 < path.length; i++) FSMap.setEdge(G.map, path[i], path[i + 1], true);
    G.roads[r.id] = r;
    f1.roads.push(r.id); f2.roads.push(r.id);
    bumpRoutes(G);
    event(G, "roadBuilt", { id: r.id, p, f1: f1.id, f2: f2.id, len: path.length });
    requestCarrier(G, r);
    return { ok: true, id: r.id, road: r };
  };

  FSSim.demolishRoad = function (G, id) {
    const r = G.roads[id];
    if (!r) return { ok: false, why: "no road" };
    for (let i = 0; i + 1 < r.path.length; i++) FSMap.setEdge(G.map, r.path[i], r.path[i + 1], false);
    const f1 = flagOf(G, r.f1), f2 = flagOf(G, r.f2);
    if (f1) { const k = f1.roads.indexOf(r.id); if (k >= 0) f1.roads.splice(k, 1); }
    if (f2) { const k = f2.roads.indexOf(r.id); if (k >= 0) f2.roads.splice(k, 1); }
    const s = G.serfs[r.carrier];
    // plan his way off the doomed road BEFORE it stops existing
    let escape = null;
    if (s) {
      const i = r.path.indexOf(s.v);
      if (i >= 0) {
        escape = (i * 2 <= r.path.length - 1)
          ? r.path.slice(0, i + 1).reverse()      // out to f1
          : r.path.slice(i);                      // out to f2
      }
    }
    delete G.roads[r.id];
    dropRequest(G, "road", r.id);
    bumpRoutes(G);
    markAllRetry(G);
    if (s) {
      // whatever he holds lands on a surviving end flag; then he walks home
      if (s.carry) {
        const target = (f1 && f1.slots.length < FSC.FLAG_CAP) ? f1
          : (f2 && f2.slots.length < FSC.FLAG_CAP) ? f2 : null;
        if (target) {
          // the good is still counted in flight — scheduleItem re-resolves it
          const it = carriedItem(s);
          target.slots.push(it);
          FSSim.scheduleItem(G, target, it);
          event(G, "itemDrop", { serf: s.id, res: s.carry, flag: target.id });
        } else {
          inFlightAdd(G, G.buildings[s.carryDest], s.carry, -1);
          event(G, "itemLost", { res: s.carry, v: s.v, why: "road removed" });
        }
        s.carry = 0; s.carryDest = 0; s.carryFlag = 0; s.carryRoad = 0;
      }
      s.road = 0;
      if (escape && escape.length > 1) {
        // walk out to the surviving flag; the 'return' handler re-paths from there
        s.path = escape.slice(1);
        s.offroad = false;
        s.state = "return";
        s.target = 0;
        s.congestT = 0;
      } else {
        sendHome(G, s);
      }
    }
    event(G, "roadRemoved", { id: r.id, p: r.p });
    return { ok: true };
  };

  /* ===================================================================== */
  /* ===== PHASE-B: serf pool, spawning, walking ========================== */
  /* ===================================================================== */

  /**
   * Take one worker out of a warehouse. `out` (optional) receives {rank} — a
   * knight carries his rank with him (PHASE-D). `out.strong` asks for the best
   * knight in store instead of the greenest one.
   */
  function poolTake(G, wh, job, out) {
    if (!wh.pool) return false;
    if ((wh.pool[job] || 0) > 0) {
      wh.pool[job]--;
      if (job === JOB.KNIGHT && out) out.rank = takeRank(wh, out.strong);
      else if (job === JOB.KNIGHT) takeRank(wh, false);
      syncPoolInv(wh);
      return true;
    }
    const tools = FSC.JOB_TOOLS[job] || [];
    if ((wh.pool.generic || 0) <= 0) return false;
    for (let i = 0; i < tools.length; i++) if ((wh.inv[tools[i]] || 0) <= 0) return false;
    wh.pool.generic--;
    for (let i = 0; i < tools.length; i++) { wh.inv[tools[i]]--; consumeGood(G, wh.p, tools[i], 1); }
    if (out && job === JOB.KNIGHT) out.rank = 0;      // freshly sworn in
    syncPoolInv(wh);
    return true;
  }
  /** Pull one rank out of a warehouse's knight roster (greenest, or the best). */
  function takeRank(wh, strong) {
    const list = wh.knightRanks || (wh.knightRanks = []);
    if (!list.length) return 0;
    let k = 0;
    for (let i = 1; i < list.length; i++) {
      if (strong ? list[i] > list[k] : list[i] < list[k]) k = i;
    }
    return list.splice(k, 1)[0];
  }
  FSSim.takeRank = takeRank;
  function poolCanTake(G, wh, job) {
    if (!wh.pool) return false;
    if ((wh.pool[job] || 0) > 0) return true;
    if ((wh.pool.generic || 0) <= 0) return false;
    const tools = FSC.JOB_TOOLS[job] || [];
    for (let i = 0; i < tools.length; i++) if ((wh.inv[tools[i]] || 0) <= 0) return false;
    return true;
  }
  function poolPut(G, wh, job, rank) {
    // transporters and sailors carry no tool — they melt back into the generic pool
    const j = (job === JOB.TRANSPORTER || job === JOB.SAILOR) ? JOB.GENERIC : job;
    wh.pool[j] = (wh.pool[j] || 0) + 1;
    /* ===== PHASE-D: a knight brings his rank back into the store ===== */
    if (j === JOB.KNIGHT) (wh.knightRanks || (wh.knightRanks = [])).push(Math.max(0, Math.min(FSC.KNIGHT_RANKS - 1, rank | 0)));
    syncPoolInv(wh);
  }
  function syncPoolInv(wh) { wh.inv.serf = wh.pool.generic || 0; wh.inv.knight = wh.pool.knight || 0; }
  FSSim.poolTake = poolTake;
  FSSim.poolPut = poolPut;

  function makeSerf(G, p, job, v) {
    const s = {
      id: newId(G), p, job, state: "spawn", t: 0,
      v, from: v, to: v, stepT: 0, stepN: FSC.WALK_TICKS, frac: 0,
      path: [], road: 0,
      carry: 0, carryDest: 0, carryFlag: 0, carryRoad: 0,
      home: 0, target: 0, targetFlag: 0,
      congestT: 0, rank: 0,
      /* ===== PHASE-C: offsite work + geology ===== */
      workV: -1, workKind: "", workRes: 0, geoFlag: 0, geoSpots: 0, geoSeen: [],
    };
    G.serfs[s.id] = s;
    return s;
  }

  /**
   * PHASE-C pacing: crossing one lattice edge costs a SLOPE-dependent number of
   * ticks (flat 26 ≈ 2.6 s at 1x) and a loaded serf is exactly as quick as an empty
   * one — both confirmed original. Uphill is punishing, a gentle descent is fastest.
   */
  function edgeTicks(G, a, b) {
    let k = Math.round((G.map.height[b] - G.map.height[a]) / FSC.WALK_DY);
    if (k < -4) k = -4; else if (k > 4) k = 4;
    return FSC.WALK_TICKS_TABLE[k + 4];
  }
  FSSim.edgeTicks = edgeTicks;

  /** Walk one tick along s.path. Returns true when the path is finished. */
  function walk(G, s) {
    if (!s.path.length) { s.from = s.v; s.to = s.v; s.frac = 0; s.stepT = 0; return true; }
    if (s.to !== s.path[0] || s.from !== s.v) { s.from = s.v; s.to = s.path[0]; s.stepT = 0; }
    s.stepN = edgeTicks(G, s.from, s.to);
    s.stepT++;
    if (s.stepT >= s.stepN) {
      s.v = s.to; s.from = s.v; s.stepT = 0; s.frac = 0;
      s.path.shift();
      if (!s.path.length) { s.to = s.v; return true; }
      s.to = s.path[0];
      return false;
    }
    s.frac = s.stepT / s.stepN;
    return false;
  }

  /** Set a serf walking to a flag over the road network (returns false when unreachable). */
  function goToFlag(G, s, flagId) {
    const here = flagAtV(G, s.v);
    let vp = null;
    if (here) {
      const fp = FSSim.flagPath(G, here.id, flagId);
      if (fp) vp = FSSim.vertexPath(G, fp);
    }
    if (!vp && s.road && G.roads[s.road]) {
      // standing mid-road: walk to the nearer end flag first, then over the network
      const r = G.roads[s.road];
      const i = r.path.indexOf(s.v);
      if (i >= 0) {
        const ends = [{ f: r.f1, seg: r.path.slice(0, i + 1).reverse() }, { f: r.f2, seg: r.path.slice(i) }];
        for (let k = 0; k < ends.length; k++) {
          const fp = FSSim.flagPath(G, ends[k].f, flagId);
          if (!fp) continue;
          const tail = FSSim.vertexPath(G, fp);
          if (!tail) continue;
          vp = ends[k].seg.concat(tail.slice(1));
          break;
        }
      }
    }
    if (!vp) return false;
    s.path = vp.slice(1);
    s.offroad = false;
    s.targetFlag = flagId;
    return true;
  }
  FSSim.goToFlag = goToFlag;

  /** Send a serf back to a warehouse; keeps his profession when he gets there. */
  function sendHome(G, s) {
    const wh = FSSim.warehouseNear(G, homeFlagFor(G, s), s.p) || FSSim.castleOf(G, s.p);
    if (wh && wh.flag && goToFlag(G, s, wh.flag)) {
      s.state = "return"; s.target = wh.id; s.congestT = 0;
      return true;
    }
    // rescue: no road home — walk offroad to the castle's flag (rare, logged)
    const castle = FSSim.castleOf(G, s.p);
    const f = castle && flagOf(G, castle.flag);
    if (f) {
      const op = FSSim.offroadPath(G, s.v, f.v);
      if (op) { s.path = op.slice(1); s.offroad = true; s.state = "return"; s.target = castle.id; return true; }
    }
    event(G, "serfLost", { id: s.id, job: s.job, p: s.p, v: s.v });
    delete G.serfs[s.id];
    return false;
  }
  function homeFlagFor(G, s) {
    const here = flagAtV(G, s.v);
    if (here) return here.id;
    if (s.road && G.roads[s.road]) return G.roads[s.road].f1;
    return (FSSim.castleOf(G, s.p) || { flag: 0 }).flag;
  }

  function despawn(G, s, wh) {
    if (wh && wh.pool) poolPut(G, wh, s.job, s.rank);
    event(G, "serfDespawn", { id: s.id, job: s.job, p: s.p, home: wh ? wh.id : 0 });
    delete G.serfs[s.id];
  }

  /**
   * A* over the raw lattice for specialists who ignore roads (geologists, diggers
   * reaching a cut-off site, attacking knights in PHASE-D).
   *   FSSim.offroadPath(G, fromV, toV, {maxLen, maxNodes, water:false, p})
   * → array of vertices [fromV … toV] or null.
   */
  FSSim.offroadPath = function (G, fromV, toV, opts) {
    opts = opts || {};
    const map = G.map;
    if (fromV === toV) return [fromV];
    if (fromV < 0 || toV < 0) return null;
    const maxLen = opts.maxLen || FSC.OFFROAD_MAX;
    const budget = opts.maxNodes || FSC.OFFROAD_NODES;
    const gScore = new Map(), came = new Map();
    const open = [];
    function push(n) {
      open.push(n);
      let i = open.length - 1;
      while (i > 0) {
        const par = (i - 1) >> 1;
        if (open[par].f < open[i].f || (open[par].f === open[i].f && open[par].v <= open[i].v)) break;
        const t = open[par]; open[par] = open[i]; open[i] = t; i = par;
      }
    }
    function pop() {
      const top = open[0], last = open.pop();
      if (open.length) {
        open[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < open.length && (open[l].f < open[m].f || (open[l].f === open[m].f && open[l].v < open[m].v))) m = l;
          if (r < open.length && (open[r].f < open[m].f || (open[r].f === open[m].f && open[r].v < open[m].v))) m = r;
          if (m === i) break;
          const t = open[m]; open[m] = open[i]; open[i] = t; i = m;
        }
      }
      return top;
    }
    function passable(v) {
      const t = map.terr[v];
      if (opts.water && t === FSC.TERR.WATER) return true;
      return FSMap.walkable(t);           // excludes WATER and SNOW
    }
    if (!passable(toV)) return null;
    gScore.set(fromV, 0);
    push({ v: fromV, f: FSMap.dist(map, fromV, toV) });
    let nodes = 0;
    while (open.length && nodes++ < budget) {
      const cur = pop();
      if (cur.v === toV) break;
      const g = gScore.get(cur.v);
      if (g === undefined || g > maxLen) continue;
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(map, cur.v, d);
        if (u < 0 || !passable(u)) continue;
        /* PLAYTEST 2026-08-01: buildings are solid. `u !== toV` is the
         * dest-vertex exemption — the serf whose errand IS this building still
         * walks in, and the site crew still reaches the pad it is working. */
        if (u !== toV && bldBlocks(G, u)) continue;
        let step = 1 + Math.abs(map.height[u] - map.height[cur.v]) * FSC.OFFROAD_SLOPE_COST;
        if (map.terr[u] === FSC.TERR.SWAMP) step += FSC.OFFROAD_SWAMP_COST;
        const ng = g + step;
        if (ng > maxLen) continue;
        const old = gScore.get(u);
        if (old !== undefined && old <= ng) continue;
        gScore.set(u, ng); came.set(u, cur.v);
        push({ v: u, f: ng + FSMap.dist(map, u, toV) });
      }
    }
    if (!came.has(toV)) return null;
    const out = [toV];
    let cur = toV, guard = 0;
    while (cur !== fromV && guard++ < maxLen + 8) { cur = came.get(cur); out.push(cur); }
    if (cur !== fromV) return null;
    out.reverse();
    return out;
  };

  // ------------------------------------------------------------ serf requests
  function requestSerf(G, p, job, kind, id) {
    for (let i = 0; i < G.serfReqs.length; i++) {
      const q = G.serfReqs[i];
      if (q.kind === kind && q.id === id && q.job === job) return q;
    }
    const q = { p, job, kind, id, due: G.tick };
    G.serfReqs.push(q);
    return q;
  }
  function dropRequest(G, kind, id) {
    for (let i = G.serfReqs.length - 1; i >= 0; i--) {
      if (G.serfReqs[i].kind === kind && G.serfReqs[i].id === id) G.serfReqs.splice(i, 1);
    }
  }
  function requestCarrier(G, road) {
    if (!road || road.carrier) return;
    road.carrierReq = true;
    /* ===== PHASE-C: a water road stays dead until its boat is delivered ===== */
    if (road.water && !road.boatHave) return;
    requestSerf(G, road.p, road.water ? JOB.SAILOR : JOB.TRANSPORTER, "road", road.id);
  }
  FSSim.requestSerf = requestSerf;

  function tickSerfRequests(G) {
    let done = 0;
    for (let i = 0; i < G.serfReqs.length && done < FSC.SERF_REQ_PER_TICK; i++) {
      const q = G.serfReqs[i];
      if (q.due > G.tick) continue;
      done++;
      let targetFlag = 0, alive = false;
      if (q.kind === "road") {
        const r = G.roads[q.id];
        if (r && !r.carrier && (!r.water || r.boatHave)) { alive = true; targetFlag = r.f1; }
      } else if (q.kind === "geo") {
        /* ===== PHASE-C: a geologist was sent to this flag ===== */
        const f = G.flags[q.id];
        if (f && f.p === q.p) { alive = true; targetFlag = f.id; }
      } else {
        const b = G.buildings[q.id];
        if (b && b.flag) {
          alive = (q.job === JOB.DIGGER && b.diggerReq) || (q.job === JOB.BUILDER && b.builderReq)
            /* ===== PHASE-D: a military building wants knights, not a worker ===== */
            || (q.job === JOB.KNIGHT && !!b.mil && b.state === "done"
              && b.mil.wanted > b.mil.knights.length + b.mil.defending + (b.mil.inbound || 0))
            || (q.job !== JOB.DIGGER && q.job !== JOB.BUILDER && q.job !== JOB.KNIGHT && b.workerReq);
          targetFlag = b.flag;
        }
      }
      if (!alive) { G.serfReqs.splice(i--, 1); continue; }
      const wh = FSSim.warehouseNear(G, targetFlag, q.p, (b) => b.spawnT <= 0 && poolCanTake(G, b, q.job));
      if (!wh) { q.due = G.tick + FSC.SERF_REQ_RETRY_T; continue; }
      const f = flagOf(G, wh.flag);
      if (!f) { q.due = G.tick + FSC.SERF_REQ_RETRY_T; continue; }
      const took = {};
      if (!poolTake(G, wh, q.job, took)) { q.due = G.tick + FSC.SERF_REQ_RETRY_T; continue; }
      const s = makeSerf(G, q.p, q.job, f.v);
      if (took.rank !== undefined) s.rank = took.rank;   /* ===== PHASE-D ===== */
      s.home = wh.id;
      wh.spawnT = FSC.SPAWN_GAP;
      event(G, "serfSpawn", { id: s.id, job: s.job, p: s.p, v: s.v, from: wh.id });
      let ok = false;
      if (q.kind === "road") {
        const r = G.roads[q.id];
        r.carrier = s.id; r.carrierReq = false;
        s.road = r.id;
        ok = startCarrierWalk(G, s, r);
      } else if (q.kind === "geo") {
        s.geoFlag = q.id; s.geoSpots = 0; s.geoSeen = [];
        ok = goToFlag(G, s, q.id);
        if (!ok) {
          // geologists walk OFFROAD direct to targets (plan §5) — scouting a
          // mountain flag BEFORE spending planks on a road must dispatch too
          const tf = G.flags[q.id];
          const op = tf ? FSSim.offroadPath(G, s.v, tf.v, { maxLen: FSC.OFFROAD_MAX }) : null;
          if (op) { s.path = op.slice(1); s.offroad = true; ok = true; }
        }
        if (ok) s.state = "goGeo";
      } else {
        // the site's xxxReq flag stays TRUE while the crewman is en route, so the
        // site never double-requests; it is cleared when he actually walks in
        const b = G.buildings[q.id];
        s.target = b.id;
        ok = goToFlag(G, s, b.flag);
        if (ok) s.state = "goBld";
      }
      if (!ok) {           // network changed under us — put everything back
        if (q.kind === "road" && G.roads[q.id]) { G.roads[q.id].carrier = 0; G.roads[q.id].carrierReq = true; }
        poolPut(G, wh, s.job, s.rank);
        delete G.serfs[s.id];
        q.due = G.tick + FSC.SERF_REQ_RETRY_T;
        continue;
      }
      /* ===== PHASE-D: book the knight against his target so the building does
       * not keep asking while he is still on the road ===== */
      if (q.kind === "bld" && q.job === JOB.KNIGHT) {
        const tb = G.buildings[q.id];
        if (tb && tb.mil) tb.mil.inbound = (tb.mil.inbound || 0) + 1;
      }
      G.serfReqs.splice(i--, 1);
    }
  }

  /* ===================================================================== */
  /* ===== PHASE-B: carriers ============================================== */
  /* ===================================================================== */

  function roadMid(r) { return (r.path.length - 1) >> 1; }

  function startCarrierWalk(G, s, r) {
    // walk over the network to the nearer end flag, then along the road to its middle
    const f1 = flagOf(G, r.f1), f2 = flagOf(G, r.f2);
    const here = flagAtV(G, s.v);
    let best = null;
    [f1, f2].forEach((f) => {
      if (!f || !here) return;
      const h = FSSim.hops(G, here.id, f.id);
      if (h < 0) return;
      if (!best || h < best.h || (h === best.h && f.id < best.f.id)) best = { f, h };
    });
    if (!best) return false;
    const fp = FSSim.flagPath(G, here.id, best.f.id);
    const vp = fp ? FSSim.vertexPath(G, fp) : null;
    if (!vp) return false;
    const mid = roadMid(r);
    const seg = best.f.id === r.f1 ? r.path.slice(0, mid + 1) : r.path.slice(mid).reverse();
    s.path = vp.slice(1).concat(seg.slice(1));
    s.offroad = false;
    s.state = "goRoad";
    return true;
  }

  function resetCarrier(G, s) {
    s.path.length = 0;
    s.state = s.carry ? "carry" : "idle";
    s.congestT = 0;
    if (s.carry) {
      // finish the delivery on whatever road half he ended up on
      const r = G.roads[s.road];
      if (!r) { sendHome(G, s); return; }
      const i = r.path.indexOf(s.v);
      const goF2 = i < roadMid(r);
      carrierWalkTo(G, s, r, goF2 ? r.path.length - 1 : 0);
      s.targetFlag = goF2 ? r.f2 : r.f1;
    }
  }

  function carrierWalkTo(G, s, r, idx) {
    const i = r.path.indexOf(s.v);
    if (i < 0) { s.path.length = 0; return false; }
    s.path = idx >= i ? r.path.slice(i + 1, idx + 1) : r.path.slice(idx, i).reverse();
    s.offroad = false;
    return true;
  }

  /**
   * Live pickup choice: of every good waiting at either end of this carrier's road,
   * take the one with the best transport priority whose next hop IS this road (or
   * which must be handed into the building at that very flag). Re-evaluated every
   * tick, so a higher-priority arrival pre-empts a lower one not yet picked up.
   */
  function bestPickup(G, s, r) {
    const pl = G.players[s.p];
    let best = null;
    for (let e = 0; e < 2; e++) {
      const f = flagOf(G, e === 0 ? r.f1 : r.f2);
      if (!f) continue;
      for (let i = 0; i < f.slots.length; i++) {
        const it = f.slots[i];
        /* ===== PHASE-C: an item may be addressed to a flag (boat) or a building ===== */
        const b = it.dest ? G.buildings[it.dest] : null;
        const destFlag = b ? b.flag : (it.destFlag || 0);
        if (!destFlag) continue;
        let handIn = false;
        if (destFlag === f.id) handIn = !!b;         // a flag-addressed good just sits there
        else if (FSSim.nextRoad(G, f.id, destFlag) !== r.id) continue;
        if (!b && destFlag === f.id) continue;       // already home
        // anti-starvation aging (plan §14.11): long waits buy priority steps
        const age = Math.min(FSC.PICKUP_AGE_MAX, ((G.tick - (it.t0 || G.tick)) / FSC.PICKUP_AGE_T) | 0);
        const pr = prioIndex(pl, it.res) - age;
        if (!best || pr < best.prio || (pr === best.prio && (f.id < best.flag || (f.id === best.flag && i < best.idx)))) {
          best = { flag: f.id, idx: i, prio: pr, res: it.res, handIn };
        }
      }
    }
    return best;
  }

  function tickCarrier(G, s) {
    const r = G.roads[s.road];
    if (!r) { if (s.state !== "return") { s.road = 0; sendHome(G, s); } return; }

    switch (s.state) {
      case "goRoad": {
        if (walk(G, s)) { s.state = "idle"; }
        return;
      }
      case "idle": {
        const pick = bestPickup(G, s, r);
        if (pick) {
          s.targetFlag = pick.flag;
          const f = flagOf(G, pick.flag);
          carrierWalkTo(G, s, r, r.path.indexOf(f.v));
          s.state = "fetch";
          if (!s.path.length) return tickCarrier(G, s);     // already standing on it
          return;
        }
        if (s.path.length) { walk(G, s); return; }
        // drift back to the middle of the road so both ends stay covered
        const mid = roadMid(r);
        if (r.path[mid] !== s.v) carrierWalkTo(G, s, r, mid);
        return;
      }
      case "fetch": {
        const pick = bestPickup(G, s, r);
        if (!pick) { s.state = "idle"; s.path.length = 0; return; }
        // re-aim only while standing ON a vertex, so he never jumps mid-stride
        if (pick.flag !== s.targetFlag && s.stepT === 0) {
          s.targetFlag = pick.flag;
          const f = flagOf(G, pick.flag);
          carrierWalkTo(G, s, r, r.path.indexOf(f.v));
        }
        if (!s.path.length || walk(G, s)) {
          const f = flagOf(G, s.targetFlag);
          if (!f || f.v !== s.v) { s.state = "idle"; return; }
          const now = bestPickup(G, s, r);
          if (!now || now.flag !== f.id) { s.state = "idle"; return; }
          const it = f.slots.splice(now.idx, 1)[0];
          s.carry = it.res; s.carryDest = it.dest;
          s.carryFlag = it.destFlag || 0; s.carryRoad = it.road || 0;   /* PHASE-C */
          event(G, "itemPickup", { serf: s.id, res: it.res, flag: f.id, dest: it.dest });
          if (now.handIn) { s.state = "handIn"; s.t = FSC.DOOR_T; return; }
          const otherFlag = f.id === r.f1 ? r.f2 : r.f1;
          s.targetFlag = otherFlag;
          carrierWalkTo(G, s, r, f.id === r.f1 ? r.path.length - 1 : 0);
          s.state = "carry";
        }
        return;
      }
      case "carry": {
        if (!walk(G, s)) return;
        const f = flagOf(G, s.targetFlag);
        if (!f) { s.state = "idle"; return; }
        const b = G.buildings[s.carryDest];
        if (b && b.flag === f.id) { s.state = "handIn"; s.t = FSC.DOOR_T; return; }
        if (f.slots.length >= FSC.FLAG_CAP) {
          if (trySwap(G, s, r, f)) return;
          s.state = "wait"; s.congestT = 0;
          event(G, "congestion", { serf: s.id, flag: f.id, res: s.carry });
          return;
        }
        dropCarried(G, s, f);
        return;
      }
      case "wait": {
        const f = flagOf(G, s.targetFlag);
        if (!f) { s.state = "idle"; s.carry = 0; return; }
        if (f.slots.length < FSC.FLAG_CAP) { dropCarried(G, s, f); return; }
        if (trySwap(G, s, r, f)) return;
        s.congestT++;
        if (s.congestT > FSC.CONGEST_T) {          // give up: take it back where it came from
          const back = f.id === r.f1 ? r.f2 : r.f1;
          s.targetFlag = back;
          carrierWalkTo(G, s, r, f.id === r.f1 ? r.path.length - 1 : 0);
          s.state = "carry"; s.congestT = 0;
        }
        return;
      }
      case "handIn": {
        if (--s.t > 0) return;
        const b = G.buildings[s.carryDest];
        if (b) deliverInto(G, b, s.carry, s.id);
        else {
          const f = flagOf(G, s.targetFlag) || flagAtV(G, s.v);
          if (f && f.slots.length < FSC.FLAG_CAP) { dropCarried(G, s, f); return; }
          event(G, "itemLost", { res: s.carry, v: s.v, why: "destination gone" });
        }
        s.carry = 0; s.carryDest = 0; s.carryFlag = 0; s.carryRoad = 0;
        s.state = "idle";
        return;
      }
      default:
        s.state = "idle";
    }
  }

  /**
   * PHASE-C — the exchange rule. A carrier standing at a FULL flag with a good in
   * his hands may swap it for a good already waiting there that wants to travel
   * back over his own road. Without this two chains that share a road can lock
   * each other out for good: the flag is full of ore heading down, the carrier is
   * holding bread heading up, and only he can move either of them.
   */
  function trySwap(G, s, r, f) {
    for (let i = 0; i < f.slots.length; i++) {
      const it = f.slots[i];
      const b = it.dest ? G.buildings[it.dest] : null;
      const destFlag = b ? b.flag : (it.destFlag || 0);
      if (!destFlag || destFlag === f.id) continue;             // it belongs here
      if (FSSim.nextRoad(G, f.id, destFlag) !== r.id) continue; // not my direction
      f.slots[i] = carriedItem(s);
      event(G, "itemSwap", { serf: s.id, flag: f.id, put: s.carry, took: it.res });
      s.carry = it.res; s.carryDest = it.dest;
      s.carryFlag = it.destFlag || 0; s.carryRoad = it.road || 0;
      const back = f.id === r.f1 ? r.f2 : r.f1;
      s.targetFlag = back;
      carrierWalkTo(G, s, r, f.id === r.f1 ? r.path.length - 1 : 0);
      s.state = "carry"; s.congestT = 0;
      return true;
    }
    return false;
  }

  function dropCarried(G, s, f) {
    const it = carriedItem(s);
    f.slots.push(it);
    const b = G.buildings[it.dest];
    // still in flight to the same building — only re-resolve when that broke
    if (!b || (b.flag !== f.id && FSSim.nextRoad(G, f.id, b.flag) === 0)) FSSim.scheduleItem(G, f, it);
    event(G, "itemDrop", { serf: s.id, res: it.res, flag: f.id });
    s.carry = 0; s.carryDest = 0; s.carryFlag = 0; s.carryRoad = 0;
    s.congestT = 0;
    s.state = "idle";
    s.path.length = 0;
  }

  /* ===================================================================== */
  /* ===== PHASE-B: construction ========================================== */
  /* ===================================================================== */

  FSSim.build = function (G, type, v, p) {
    p = p || 0;
    if (!FSC.BLD[type]) return { ok: false, why: "unknown building" };
    if (type === "castle") return { ok: false, why: "only one castle" };
    const why = FSMap.whyBuilding(G.map, type, v, p);
    if (why) return { ok: false, why };
    const def = FSC.BLD[type];
    const b = FSSim.makeBuilding(G, p, type, v, "site");
    // door flag: reuse an existing own flag, else drop one
    const door = FSMap.doorVertex(G.map, v);
    let f = flagAtV(G, door);
    if (!f) {
      const r = FSSim.placeFlag(G, door, p);
      if (!r.ok) {
        delete G.buildings[b.id]; G.map.bldAt[v] = 0; clearFootprint(G, b);
        return { ok: false, why: r.why };
      }
      f = r.flag;
    }
    f.bld = b.id; b.flag = f.id;
    /* Clear the footprint (large buildings flatten a 7-vertex pad). The pad is
     * levelled by a digger, so it comes clear of EVERYTHING, not just wood —
     * that predates the 2026-08-01 tree-clearing work and is unchanged. What is
     * new is that the anchor may legally have been a TREE when you clicked it
     * (FSMap.objRefuses), so this is now the felling as well as the flattening;
     * the summary event lets a test see it. */
    let cleared = FSMap.clearableObj(G.map.obj[v]) ? 1 : 0;
    G.map.obj[v] = FSC.OBJ.NONE; G.map.objArg[v] = 0; dirty(G, v);
    if (def.size >= 2) {
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(G.map, v, d);
        if (u < 0) continue;
        if (G.map.obj[u] !== FSC.OBJ.NONE) {
          if (FSMap.clearableObj(G.map.obj[u])) cleared++;
          G.map.obj[u] = FSC.OBJ.NONE; G.map.objArg[u] = 0; dirty(G, u);
        }
      }
    }
    if (cleared) event(G, "woodCleared", { n: cleared, why: "building" });
    event(G, "bldPlaced", { id: b.id, btype: type, v, p });
    return { ok: true, id: b.id, bld: b };
  };

  function totalCost(b) { return (b.matReq.plank || 0) + (b.matReq.stone || 0); }

  function tickConstruction(G, b) {
    if (b.state === "burn") {
      if (--b.burnT <= 0) removeBuilding(G, b);
      return;
    }
    if (b.state === "done") {
      tickProduction(G, b);          /* ===== PHASE-C ===== */
      return;
    }
    // crews are requested lazily so a cut-off site simply waits.
    // crewT is a watchdog: a crewman who never made it lets the site ask again —
    // but only when nobody is actually still walking in. A slow crewman must not
    // trigger a duplicate (the second would overwrite b.crew, orphan the first
    // and could re-level a half-built site).
    if (b.crewT > 0 && !b.crew && --b.crewT === 0) {
      let inbound = false;
      for (const sid in G.serfs) {
        const s = G.serfs[sid];
        if (s.target === b.id && (s.job === JOB.DIGGER || s.job === JOB.BUILDER)) { inbound = true; break; }
      }
      if (inbound) b.crewT = FSC.CREW_WATCHDOG_T;
      else { b.diggerReq = false; b.builderReq = false; }
    }
    if (!b.leveled) {
      if (b.state === "site" && !b.diggerReq && !b.crew) {
        b.diggerReq = true; b.crewT = FSC.CREW_WATCHDOG_T;
        requestSerf(G, b.p, JOB.DIGGER, "bld", b.id);
      }
      return;
    }
    if (b.state === "site") {
      if (!b.builderReq && !b.crew) {
        b.builderReq = true; b.crewT = FSC.CREW_WATCHDOG_T;
        requestSerf(G, b.p, JOB.BUILDER, "bld", b.id);
      }
      return;
    }
    if (b.state === "build") {
      /* ===== PHASE-C: the confirmed swing accumulator ===== */
      const need = totalCost(b);
      if (!b.crew) return;                         // the builder is the one swinging
      if (b.swingT > 0) { b.swingT--; return; }
      const total = swingsFor(b);
      // one material is drawn every SWING_PER_MAT swings — planks first, then stones
      if ((b.swings % FSC.SWING_PER_MAT) === 0 && b.matUsed < need) {
        const res = b.matHave.plank > 0 ? "plank" : (b.matHave.stone > 0 ? "stone" : null);
        if (!res) { b.swingT = FSC.BUILD_IDLE_T; return; }   // waiting on materials
        b.matHave[res]--;
        b.matUsed++;
        consumeGood(G, b.p, res, 1);                 // the rate strip's build spend
      }
      b.swings++;
      b.progress = Math.min(FSC.BUILD_FULL, b.progress + Math.floor(FSC.BUILD_FULL / total));
      b.swingT = FSC.SWING_TICKS[FSC.rngInt(FSC.SWING_TICKS.length)];
      if (b.swings >= total && b.matUsed >= need) finishBuilding(G, b);
    }
  }

  /** Hammer swings this building needs: its own table, but never fewer than the
   *  8-swings-per-material rule requires. */
  function swingsFor(b) {
    const def = defOf(b);
    const byMat = FSC.SWING_PER_MAT * totalCost(b);
    const table = def.swings || 16;
    return Math.max(table, byMat);
  }
  FSSim.swingsFor = swingsFor;

  function setState(G, b, to) {
    if (b.state === to) return;
    const from = b.state;
    b.state = to;
    event(G, "bldStateChange", { id: b.id, btype: b.type, from, to });
  }

  function finishBuilding(G, b) {
    setState(G, b, "done");
    b.progress = 0;
    const def = defOf(b);
    // the builder walks home and keeps his hammer
    const crew = G.serfs[b.crew];
    b.crew = 0;
    if (crew) sendHome(G, crew);
    if (def.job) { b.workerReq = true; requestSerf(G, b.p, def.job, "bld", b.id); }
    /* ===== PHASE-D: a finished military building starts asking for its
     * garrison; the land follows the first knight through the door. */
    if (def.mil) {
      const M = mil();
      if (M) M.onBuildingDone(G, b); else FSSim.recomputeOwner(G);
    }
    event(G, "bldDone", { id: b.id, btype: b.type, v: b.v, p: b.p });
    FSSim.notify(G, b.p, (FSC.BLD_NAME[b.type] || b.type) + " finished.", b.v);
  }

  function levelSite(G, b, k) {
    const map = G.map;
    const ring = [b.v];
    for (let d = 0; d < 6; d++) { const u = FSMap.nbr(map, b.v, d); if (u >= 0) ring.push(u); }
    if (b.levelY === undefined) {
      let sum = 0;
      for (let i = 0; i < ring.length; i++) sum += map.height[ring[i]];
      b.levelY = sum / ring.length;
    }
    for (let i = 0; i < ring.length; i++) {
      const u = ring[i];
      map.height[u] += (b.levelY - map.height[u]) * k;
      dirty(G, u);
    }
    event(G, "terrainLeveled", { v: b.v, r: 1 });
  }

  /** Goods already addressed to a building that just died must find a new home. */
  function rescheduleFor(G, bldId) {
    for (const id in G.flags) {
      const f = G.flags[id];
      let hit = false;
      for (let i = 0; i < f.slots.length; i++) if (f.slots[i].dest === bldId) { f.slots[i].dest = 0; hit = true; }
      if (!hit) continue;
      for (let i = 0; i < f.slots.length; i++) if (!f.slots[i].dest) FSSim.scheduleItem(G, f, f.slots[i]);
    }
    for (const id in G.serfs) {
      const s = G.serfs[id];
      if (s.carryDest === bldId) s.carryDest = 0;    // handIn drops it at the next flag
    }
  }

  function removeBuilding(G, b) {
    const f = flagOf(G, b.flag);
    if (f && f.bld === b.id) f.bld = 0;
    if (b.worker && G.serfs[b.worker]) sendHome(G, G.serfs[b.worker]);
    if (b.crew && G.serfs[b.crew]) sendHome(G, G.serfs[b.crew]);
    // a store's POOLED settlers die with it (garrisons escaped at burn start) —
    // account for them instead of deleting a population silently
    if (b.pool) {
      let lost = 0;
      for (const k in b.pool) lost += b.pool[k];
      if (lost > 0) {
        event(G, "serfLost", { n: lost, p: b.p, v: b.v, why: "store destroyed" });
        FSSim.notify(G, b.p, lost + " settlers were lost with the store.", b.v);
      }
    }
    /* ===== PHASE-D: the ashes hold nobody ===== */
    if (b.mil) { b.mil.knights.length = 0; b.mil.defending = 0; }
    dropRequest(G, "bld", b.id);
    G.map.bldAt[b.v] = 0;
    clearFootprint(G, b);
    delete G.buildings[b.id];
    rescheduleFor(G, b.id);
    event(G, "bldRemoved", { id: b.id, btype: b.type, v: b.v, p: b.p });
    if (b.mil) FSSim.recomputeOwner(G, { v: b.v, r: b.type === "castle" ? FSC.CASTLE_RADIUS : FSC.TERR_RADIUS });
  }

  /**
   * PHASE-D — set a building alight. Up to FSC.BURN_ESCAPE_MAX occupants run
   * for a warehouse; anyone beyond that dies in the fire (confirmed original).
   * `opts.noEscape` (an eliminated player's estate) kills everyone.
   * A castle burns FSC.BURN_T_CASTLE ticks — four times as long, and it takes
   * conquest, never a demolish order, to light one.
   */
  FSSim.burnBuilding = function (G, b, opts) {
    opts = opts || {};
    if (!b || b.state === "burn") return { ok: false, why: "already burning" };
    // delivered materials burn with it (the classic refunds nothing)
    b.matHave.plank = 0; b.matHave.stone = 0;
    const occ = [];
    if (b.worker && G.serfs[b.worker]) occ.push(G.serfs[b.worker]);
    if (b.crew && G.serfs[b.crew]) occ.push(G.serfs[b.crew]);
    b.worker = 0; b.crew = 0;
    let escaped = 0;
    for (let i = 0; i < occ.length; i++) {
      const s = occ[i];
      if (!opts.noEscape && escaped < FSC.BURN_ESCAPE_MAX) { escaped++; sendHome(G, s); }
      else { event(G, "serfLost", { id: s.id, job: s.job, p: s.p, v: s.v, why: "fire" }); delete G.serfs[s.id]; }
    }
    /* ===== PHASE-D: the garrison shares the escape budget ===== */
    if (b.mil) {
      const M = mil();
      if (M) M.evictGarrison(G, b, { escaped, noEscape: opts.noEscape });
      else { b.mil.knights.length = 0; b.mil.defending = 0; }
    }
    b.workerReq = false; b.builderReq = false; b.diggerReq = false;
    b.matInFlight.plank = 0; b.matInFlight.stone = 0;
    dropRequest(G, "bld", b.id);
    setState(G, b, "burn");
    b.burnT = b.type === "castle" ? FSC.BURN_T_CASTLE : FSC.BURN_T;
    rescheduleFor(G, b.id);
    // only a military building's death moves a border
    if (b.mil) FSSim.recomputeOwner(G, { v: b.v, r: b.type === "castle" ? FSC.CASTLE_RADIUS : FSC.TERR_RADIUS });
    return { ok: true };
  };

  FSSim.demolishBuilding = function (G, id) {
    const b = bldOf(G, id);
    if (!b) return { ok: false, why: "no building" };
    if (b.type === "castle") return { ok: false, why: "the castle cannot be torn down" };
    if (b.state === "burn") return { ok: false, why: "already burning" };
    return FSSim.burnBuilding(G, b);
  };

  /** Demolish anything by id — building, road or flag. */
  FSSim.demolish = function (G, id, p) {
    if (G.buildings[id]) {
      if (p !== undefined && G.buildings[id].p !== p) return { ok: false, why: "not yours" };
      return FSSim.demolishBuilding(G, id);
    }
    if (G.roads[id]) {
      if (p !== undefined && G.roads[id].p !== p) return { ok: false, why: "not yours" };
      return FSSim.demolishRoad(G, id);
    }
    if (G.flags[id]) {
      if (p !== undefined && G.flags[id].p !== p) return { ok: false, why: "not yours" };
      return FSSim.removeFlag(G, id);
    }
    return { ok: false, why: "nothing there" };
  };

  /* ===================================================================== */
  /* ===== PHASE-B: non-carrier serfs (digger, builder, workers) ========== */
  /* ===================================================================== */

  /** PHASE-D — a knight who never made it un-books his reservation. */
  function milUnbook(G, s) {
    if (s.job !== JOB.KNIGHT) return;
    const b = G.buildings[s.target];
    if (b && b.mil && b.mil.inbound > 0) b.mil.inbound--;
  }
  FSSim.milUnbook = milUnbook;

  function tickWorkerSerf(G, s) {
    switch (s.state) {
      /* ===== PHASE-D: knights on the march live in fs-military ===== */
      case "atkWalk": case "atkWait": case "fight": case "garrison": {
        const M = mil();
        if (M) M.tickKnight(G, s); else sendHome(G, s);
        return;
      }
      case "goBld": {
        if (!walk(G, s)) return;
        const b = G.buildings[s.target];
        if (!b || b.state === "burn") { milUnbook(G, s); sendHome(G, s); return; }
        s.state = "enter"; s.t = FSC.DOOR_T;
        return;
      }
      case "enter": {
        if (--s.t > 0) return;
        const b = G.buildings[s.target];
        if (!b || b.state === "burn") { milUnbook(G, s); sendHome(G, s); return; }
        /* ===== PHASE-D: a knight joins the garrison instead of taking the job ===== */
        if (s.job === JOB.KNIGHT) {
          const M = mil();
          if (!b.mil || b.state !== "done" || (b.p !== s.p)) { milUnbook(G, s); sendHome(G, s); return; }
          if (b.mil.inbound > 0) b.mil.inbound--;
          b.mil.knights.push(s.rank | 0);
          event(G, "knightGarrison", { bld: b.id, btype: b.type, p: b.p, rank: s.rank | 0, id: s.id });
          delete G.serfs[s.id];
          if (M) M.onGarrisonChange(G, b);
          return;
        }
        s.v = b.v; s.from = b.v; s.to = b.v; s.frac = 0;
        if (s.job === JOB.DIGGER) {
          // a late/duplicate digger must never re-level a site that is already
          // crewed or past leveling — that tore down half-built structures
          if (b.crew || b.leveled || b.state !== "site") { sendHome(G, s); return; }
          b.crew = s.id; b.diggerReq = false; b.crewT = 0;
          setState(G, b, "leveling");
          s.state = "level"; s.t = FSC.LEVEL_T; s.levelStep = 0;
        } else if (s.job === JOB.BUILDER) {
          if (b.crew || !b.leveled || b.state !== "site") { sendHome(G, s); return; }
          b.crew = s.id; b.builderReq = false; b.crewT = 0;
          setState(G, b, "build");
          s.state = "hammer";
        } else {
          b.worker = s.id; b.workerReq = false;
          s.home = b.id; s.state = "work";
          event(G, "workerArrive", { bld: b.id, serf: s.id, job: s.job });
        }
        return;
      }
      case "level": {
        const b = G.buildings[s.target];
        if (!b || b.state === "burn") { sendHome(G, s); return; }
        s.t--;
        const step = s.t <= FSC.LEVEL_T / 2 ? 1 : 0;
        if (step > s.levelStep) { s.levelStep = step; levelSite(G, b, 0.5); }
        if (s.t <= 0) {
          levelSite(G, b, 1);
          b.leveled = true; b.crew = 0;
          setState(G, b, "site");
          b.builderReq = true; b.crewT = FSC.CREW_WATCHDOG_T;
          requestSerf(G, b.p, JOB.BUILDER, "bld", b.id);
          sendHome(G, s);
        }
        return;
      }
      case "hammer": {
        const b = G.buildings[s.target];
        if (!b || b.state === "burn" || b.state === "done") { sendHome(G, s); return; }
        return;                                  // progress is driven by tickConstruction
      }
      case "work": {
        /* ===== PHASE-C: offsite professions set out from here ===== */
        const b = G.buildings[s.home];
        if (!b || b.state !== "done") { if (b) b.worker = 0; sendHome(G, s); return; }
        if (defOf(b).radius) maybeStartTrip(G, s, b);
        return;
      }
      /* ===== PHASE-C: offsite work + geology ===== */
      case "goWork": case "doWork": case "backWork": tickFieldWorker(G, s); return;
      case "goGeo": case "geoWalk": case "geoWork": case "geoBack": tickGeologist(G, s); return;
      case "return": {
        if (!walk(G, s)) return;
        const wh = G.buildings[s.target];
        if (wh && wh.inv && flagOf(G, wh.flag) && flagOf(G, wh.flag).v === s.v) { despawn(G, s, wh); return; }
        const f = flagAtV(G, s.v);
        const alt = f ? FSSim.warehouseNear(G, f.id, s.p) : null;
        if (alt && flagOf(G, alt.flag) && flagOf(G, alt.flag).v === s.v) { despawn(G, s, alt); return; }
        if (alt && goToFlag(G, s, alt.flag)) { s.target = alt.id; return; }
        despawn(G, s, FSSim.castleOf(G, s.p));    // nothing reachable — melt into the pool
        return;
      }
      default:
        if (walk(G, s)) s.state = "return";
    }
  }

  /* ===================================================================== */
  /* ===== PHASE-B: warehouses ============================================ */
  /* ===================================================================== */

  /**
   * A warehouse pushes ONE stored good out to its flag per dispatch tick, choosing
   * what to release by the player's `invPrio` (warehouse OUTPUT priority — a
   * different list from the flag transport priority; defaults to the confirmed
   * original FSC.INV_ORDER, and the player copy — PHASE-E — is what the Phase-E
   * "Warehouse output priority" panel reorders live). PHASE-C adds full
   * distribution arbitration.
   */
  function warehouseDispatch(G, wh) {
    const f = flagOf(G, wh.flag);
    if (!f || f.slots.length >= FSC.FLAG_CAP) return;
    /* ===== PHASE-E: per-player reorder, old saves fall back to the default ===== */
    const pl = G.players[wh.p];
    const order = (pl && pl.invPrio) || FSC.INV_ORDER;
    /* ===== PHASE-C: 'out' resources are pushed away first, demand or not ===== */
    if (wh.modes) {
      for (let i = 0; i < order.length; i++) {
        const res = order[i];
        if ((wh.modes[res] || 0) !== FSC.STOCK_MODE.OUT || !wh.inv[res]) continue;
        const d = FSSim.chooseDemand(G, f.id, res, wh.p, wh.id)
          || FSSim.warehouseNear(G, f.id, wh.p, (b) => b.id !== wh.id && stockAccepts(b, res));
        if (!d) continue;
        wh.inv[res]--;
        FSSim.pushItem(G, f, res, d.id);
        return;
      }
    }
    for (let i = 0; i < order.length; i++) {
      const res = order[i];
      if (!wh.inv[res]) continue;
      const d = FSSim.chooseDemand(G, f.id, res, wh.p, wh.id);
      if (!d) continue;
      // A mine is happy with any meal, so the store sends whichever food it is
      // longest on (confirmed original; ties go to fish).
      let send = res;
      if (isFood(res) && defOf(d).inFood) send = FSSim.bestFoodOf(wh);
      wh.inv[send]--;
      FSSim.pushItem(G, f, send, d.id);
      return;
    }
  }

  /** The food a store holds most of — fish first on a tie (FSC.FOODS order). */
  FSSim.bestFoodOf = function (wh) {
    let best = FSC.FOODS[0], bestN = -1;
    for (let i = 0; i < FSC.FOODS.length; i++) {
      const n = (wh.inv && wh.inv[FSC.FOODS[i]]) || 0;
      if (n > bestN) { bestN = n; best = FSC.FOODS[i]; }
    }
    return best;
  };

  /**
   * Total people a player owns: walking serfs + everyone resting in warehouses
   * + PHASE-D's garrisoned knights (they live inside their building exactly
   * like a pooled serf lives inside a store).
   */
  FSSim.population = function (G, p) {
    let n = 0;
    for (const id in G.serfs) if (G.serfs[id].p === p) n++;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p) continue;
      if (b.pool && b.state !== "burn") for (const k in b.pool) n += b.pool[k];
      if (b.mil && b.state !== "burn") n += b.mil.knights.length;
    }
    return n;
  };

  /**
   * PHASE-C reproduction (confirmed original): the castle turns out one settler
   * every (REPRO_MAX − reproRate) × REPRO_UNIT ticks. The very same clock recruits
   * knights — a 16-bit counter gathers `recruitRate` per firing, every overflow
   * banks a credit, and a firing holding a credit plus a sword and a shield in
   * store produces a rank-0 knight instead of a plain settler.
   * A negative repro slider switches breeding off (used by the suites).
   */
  function reproInterval(pl) {
    const r = pl.repro === undefined ? FSC.REPRO_DEFAULT : pl.repro;
    if (r < 0) return 0;
    let iv = (FSC.REPRO_MAX - r) * FSC.REPRO_UNIT;
    if (iv < 1) iv = 1;
    return iv;
  }
  FSSim.reproInterval = reproInterval;

  function tickPopulation(G) {
    for (let p = 0; p < G.players.length; p++) {
      const pl = G.players[p];
      if (pl.eliminated) continue;
      const iv = reproInterval(pl);
      if (!iv || ((G.tick + p) % iv) !== 0) continue;
      // the knight ledger ticks whether or not there is room for the settler
      pl.knightCounter = (pl.knightCounter === undefined ? FSC.KNIGHT_COUNTER_START : pl.knightCounter)
        + ((pl.knights && pl.knights.recruitRate) | 0);
      if (pl.knightCounter > 0xffff) {
        pl.knightCounter &= 0xffff;
        pl.knightCredit = Math.min(FSC.KNIGHT_CREDIT_MAX, (pl.knightCredit || 0) + 1);
      }
      const c = FSSim.castleOf(G, p) || firstStock(G, p);
      if (!c || c.state !== "done" || !c.pool) continue;
      if (FSSim.population(G, p) >= FSC.SERF_CAP) continue;
      if ((pl.knightCredit || 0) > 0 && (c.inv.sword || 0) > 0 && (c.inv.shield || 0) > 0) {
        c.inv.sword--; c.inv.shield--;
        consumeGood(G, p, "sword", 1); consumeGood(G, p, "shield", 1);
        c.pool.knight++;
        (c.knightRanks || (c.knightRanks = [])).push(0);   /* ===== PHASE-D: rank 0 ===== */
        pl.knightCredit--;
        syncPoolInv(c);
        event(G, "knightRecruited", { p, pool: c.pool.knight, from: c.id });
        continue;
      }
      c.pool.generic++;
      syncPoolInv(c);
      event(G, "serfBorn", { p, pool: c.pool.generic });
    }
  }
  function firstStock(G, p) {
    let best = null;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.pool || b.state !== "done") continue;
      if (!best || b.id < best.id) best = b;
    }
    return best;
  }

  /* ===================================================================== */
  /* ===== PHASE-C: the background sweep (one system for everything alive)  */
  /* ===================================================================== */

  /**
   * The classic advances the living world with a cheap strided sweep instead of
   * per-object timers: every FSC.SWEEP_EVERY ticks it visits a handful of vertices
   * (scaled to map size) and rolls each one forward — fish spawn and drift, young
   * trees mature, stumps rot, sown fields ripen a stage. A whole pass over a 64²
   * map takes ~2048 ticks, so nothing is ever scanned and everything still grows.
   */
  function sweepStep(G, v) {
    const map = G.map, O = FSC.OBJ;
    const t = map.terr[v];
    if (t === FSC.TERR.WATER) {
      // confirmed original: only a shoal with fish LEFT regrows — a vertex fished
      // to zero can recover only when a neighbour migrates a fish back in
      if (map.fish[v] > 0 && map.fish[v] < FSC.FISH_CAP && FSC.rng() < FSC.FISH_REGROW_P) map.fish[v]++;
      // shoals drift: one fish moves to a neighbouring water vertex
      if (map.fish[v] > 0) {
        const d = FSC.FISH_MIGRATE_DIRS[FSC.rngInt(FSC.FISH_MIGRATE_DIRS.length)];
        const u = FSMap.nbr(map, v, d);
        if (u >= 0 && map.terr[u] === FSC.TERR.WATER && map.fish[u] < FSC.FISH_CAP) {
          map.fish[v]--; map.fish[u]++;
        }
      }
      return;
    }
    const o = map.obj[v];
    if (o === O.SAPLING) {
      // confirmed original: the SAPLING stage is the only one gated by chance —
      // one successful 25% roll makes a MATURE tree (mean 4 sweep visits, not 4
      // consecutive rolls; forestry ran 4x slow before this)
      if (FSC.rng() < FSC.SAPLING_P) { map.obj[v] = O.TREE4; dirty(G, v); }
      return;
    }
    if (o >= O.TREE1 && o < O.TREE4) {
      // map-gen's half-grown wild trees just grow up, un-gated (visual stages)
      map.obj[v] = o + 1; dirty(G, v);
      return;
    }
    if (o === O.STUMP) {
      if (FSC.rng() < FSC.STUMP_P) { map.obj[v] = O.NONE; map.objArg[v] = 0; dirty(G, v); }
      return;
    }
    if (o >= O.FIELD0 && o <= O.FIELD4) { map.obj[v] = o + 1; dirty(G, v); return; }
    if (o === O.FIELD_STUB) { map.obj[v] = O.NONE; map.objArg[v] = 0; dirty(G, v); }
  }

  function tickSweep(G) {
    if ((G.tick % FSC.SWEEP_EVERY) !== 0) return;
    const N = G.map.W * G.map.H;
    let n = Math.ceil(N / 1024) * FSC.SWEEP_PER_1024;
    if (n < 1) n = 1;
    for (let i = 0; i < n; i++) {
      G.sweepV = (G.sweepV + FSC.SWEEP_STRIDE) % N;
      sweepStep(G, G.sweepV);
    }
  }
  FSSim.sweepStep = sweepStep;

  /* ===================================================================== */
  /* ===== PHASE-C: producers ============================================= */
  /* ===================================================================== */

  /** Book a finished good: onto the door flag, or held back when the flag is full. */
  function produceGood(G, b, res, n) {
    n = n || 1;
    for (let i = 0; i < n; i++) {
      if (!FSSim.outputGood(G, b, res)) {
        b.stockOut[res] = (b.stockOut[res] || 0) + 1;
        b.outHeld = (b.outHeld || 0) + 1;
        b.outT = FSC.PROD_FLUSH_T;
      }
    }
    const pr = G.prod[b.p] || (G.prod[b.p] = {});
    pr[res] = (pr[res] || 0) + n;
    event(G, "produced", { bld: b.id, btype: b.type, res, n, p: b.p });
  }
  FSSim.produceGood = produceGood;

  /** The consumption ledger's only writer (see G.cons). Deterministic counter —
   *  nothing in the sim ever reads it back, so it cannot affect lockstep. */
  function consumeGood(G, p, res, n) {
    if (!res || p === undefined || p < 0) return;
    const cs = G.cons || (G.cons = []);
    const c = cs[p] || (cs[p] = {});
    c[res] = (c[res] || 0) + (n === undefined ? 1 : n);
  }
  FSSim.consumeGood = consumeGood;

  /** Try again to get held-back goods onto the door flag. */
  function flushOutputs(G, b) {
    if (!b.outHeld) return;
    for (const res in b.stockOut) {
      while (b.stockOut[res] > 0) {
        if (!FSSim.outputGood(G, b, res)) { b.outT = FSC.PROD_FLUSH_T; return; }
        b.stockOut[res]--; b.outHeld--;
      }
    }
  }

  /** The weaponsmith's shield half-cycle is free — only the sword half eats. */
  function cycleEats(b, def) {
    if (!def.outWeapon) return true;
    return (b.altOut % 2) === 0;
  }
  function inputsReady(G, b, def) {
    if (def.in && cycleEats(b, def)) {
      for (const r in def.in) if ((b.stockIn[r] || 0) < def.in[r]) return false;
    }
    return true;
  }
  function consumeInputs(G, b, def) {
    if (!def.in || !cycleEats(b, def)) return;
    for (const r in def.in) { b.stockIn[r] -= def.in[r]; consumeGood(G, b.p, r, def.in[r]); }
  }
  /** Eat one meal: the food the mine happens to hold most of (ties → fish). */
  function consumeFood(b) {
    let best = null, bestN = 0;
    for (let i = 0; i < FSC.FOODS.length; i++) {
      const f = FSC.FOODS[i], n = b.stockIn[f] || 0;
      if (n > bestN) { best = f; bestN = n; }
    }
    if (!best) return null;
    b.stockIn[best]--;
    return best;
  }

  /* --- mines: the confirmed dig model ---------------------------------------
   * think → (usually) eat a meal → walk in → up to MINE_DIGS attempts, each
   * sampling ONE random vertex in rings 0..MINE_RING and hitting only if that
   * exact vertex still holds the mineral → walk out → deliver. A 16-bit history
   * register raises the "exhausted" notification once the finds dry up.
   */
  // (rebuilt per dig — 40-odd vertices, and nothing derived ever lands in the save)
  function mineCells(G, b) {
    const cells = [];
    FSMap.forRadius(G.map, b.v, FSC.MINE_RING, (u) => cells.push(u));
    cells.sort((x, y) => x - y);
    return cells;
  }
  function mineDig(G, b) {
    const map = G.map, kind = FSC.MINERAL[b.mine.kind];
    const cells = mineCells(G, b);
    if (!cells.length) return false;
    const v = cells[FSC.rngInt(cells.length)];
    if (map.mineral[v] !== kind || map.mineralAmt[v] <= 0) return false;
    map.mineralAmt[v]--;
    return true;
  }
  function mineRegister(G, b, found) {
    const m = b.mine;
    m.reg = (((m.reg || 0) << 1) | (found ? 1 : 0)) & 0xffff;
    if (found) { m.exhausted = false; return; }
    if (m.reg === FSC.MINE_EXHAUST_REG && !m.exhausted) {
      m.exhausted = true;
      event(G, "mineExhausted", { bld: b.id, btype: b.type, v: b.v, p: b.p });
      FSSim.notify(G, b.p, (FSC.BLD_NAME[b.type] || b.type) + " has run dry.", b.v);
    }
  }
  function tickMine(G, b, def) {
    if (b.halted) { b.working = false; return; }
    if (b.prodT > 0) { b.prodT--; return; }
    const st = b.mstate || "wait";
    if (st === "wait") {
      // the "do I need a meal this time" roll happens ONCE per cycle — waiting for
      // food does not re-roll it, so a mine with an empty larder really does stall.
      if (b.skipRoll === undefined) {
        b.mcycle = (b.mcycle || 0) + 1;
        // confirmed original: a RANDOM (r & 7) == 0 roll, not every deterministic
        // 8th cycle — and a skipped meal still pays the eating-animation time
        b.skipRoll = FSC.rngInt(FSC.MINE_SKIP_EVERY) === 0 ? 1 : 0;
      }
      if (b.skipRoll) {                               // one cycle in ~eight eats free
        b.skipRoll = undefined;
        b.mstate = "eat"; b.prodT = FSC.MINE_EAT_T; b.working = true;
        return;
      }
      if (foodStock(b) <= 0) { b.prodT = FSC.MINE_IDLE_T; b.working = false; return; }
      consumeGood(G, b.p, consumeFood(b), 1);        // the miner's meal, on the ledger
      b.skipRoll = undefined;
      b.mstate = "eat"; b.prodT = FSC.MINE_EAT_T; b.working = true;
      return;
    }
    if (st === "eat") { b.mstate = "pre"; b.prodT = FSC.MINE_PRE_T; return; }
    if (st === "pre") { b.mstate = "dig"; b.digs = 0; b.prodT = FSC.MINE_DIG_T; return; }
    if (st === "dig") {
      b.digs++;
      if (mineDig(G, b)) { b.found = 1; b.mstate = "post"; b.prodT = FSC.MINE_POST_T; return; }
      if (b.digs >= FSC.MINE_DIGS) { b.found = 0; b.mstate = "post"; b.prodT = FSC.MINE_POST_T; return; }
      b.prodT = FSC.MINE_DIG_T;
      return;
    }
    if (st === "post") { b.mstate = "out"; b.prodT = FSC.MINE_OUT_T; return; }
    // "out": the miner comes back up
    if (b.found) produceGood(G, b, def.out, 1);
    else event(G, "mineFail", { bld: b.id, btype: b.type, v: b.v, p: b.p });
    b.cycles++;
    mineRegister(G, b, b.found);
    b.found = 0;
    b.mstate = "wait";
    b.working = false;
    b.prodT = FSC.MINE_WAIT[0] + FSC.rngInt(FSC.MINE_WAIT[1] - FSC.MINE_WAIT[0] + 1);
  }

  /**
   * Which tool the toolmaker makes next: a weighted-random draw over the nine
   * priority sliders (confirmed original — a 0 slider is never drawn, an all-zero
   * panel falls back to a uniform pick). No scarcity maths anywhere.
   */
  function chooseTool(G, p) {
    const pl = G.players[p];
    let total = 0;
    for (let i = 0; i < FSC.TOOLS.length; i++) {
      const w = (pl.tools && pl.tools[FSC.TOOLS[i]]) | 0;
      if (w > 0) total += w;
    }
    if (total <= 0) return FSC.TOOLS[FSC.rngInt(FSC.TOOLS.length)];
    let roll = FSC.rng() * total;
    for (let i = 0; i < FSC.TOOLS.length; i++) {
      const w = (pl.tools && pl.tools[FSC.TOOLS[i]]) | 0;
      if (w <= 0) continue;
      roll -= w;
      if (roll <= 0) return FSC.TOOLS[i];
    }
    return FSC.TOOLS[FSC.TOOLS.length - 1];
  }
  FSSim.chooseTool = chooseTool;

  /** Pig pen: the herd breeds on fed cycles and one fat pig ships out. */
  function tickPigfarm(G, b, def) {
    if (b.herd === undefined) b.herd = 0;
    if (b.working) {
      if (--b.prodT > 0) return;
      b.working = false;
      b.cycles++;
      if (b.fed) {
        for (let i = 0; i < FSC.PIG_ROLLS && b.herd < FSC.PIG_HERD_MAX; i++) {
          if (FSC.rng() < FSC.PIG_P_BASE + FSC.PIG_P_PER * b.herd) b.herd++;
        }
        b.fed = 0;
      }
      if (b.herd > FSC.PIG_KEEP) { b.herd--; produceGood(G, b, def.out, 1); }
      return;
    }
    if (b.halted || b.outHeld >= FSC.OUT_CAP) return;
    const wheat = b.stockIn.wheat || 0;
    if (b.herd < FSC.PIG_HERD_MAX && wheat > 0) { b.stockIn.wheat = wheat - 1; b.fed = 1; }
    else if (b.herd <= FSC.PIG_KEEP) return;           // nothing to feed, nothing to sell
    b.working = true;
    b.prodT = def.cycleT;
  }

  function emitProduct(G, b, def) {
    if (def.outTool) { produceGood(G, b, chooseTool(G, b.p), 1); return; }
    if (def.outWeapon) {
      const res = (b.altOut % 2) === 0 ? "sword" : "shield";
      b.altOut++;
      produceGood(G, b, res, 1);
      return;
    }
    if (def.out) produceGood(G, b, def.out, def.outN || 1);
  }

  /** An interior producer (sawmill, mill, smelter, toolmaker…). */
  function tickInterior(G, b, def) {
    if (b.working) {
      if (--b.prodT > 0) return;
      b.working = false;
      b.cycles++;
      emitProduct(G, b, def);
      return;
    }
    if (b.halted) return;
    if (b.outHeld >= FSC.OUT_CAP) return;              // the door flag is jammed
    if (!inputsReady(G, b, def)) return;
    consumeInputs(G, b, def);
    b.working = true;
    b.prodT = def.cycleT;
  }

  /** Runs for every finished building each tick (called from tickConstruction). */
  function tickProduction(G, b) {
    const def = defOf(b);
    if (def.warehouse || def.mil) return;
    if (b.outT > 0) b.outT--; else flushOutputs(G, b);
    if (!b.worker || !G.serfs[b.worker]) return;
    if (def.radius) return;                            // offsite jobs live on the serf
    if (def.mine) { tickMine(G, b, def); return; }
    if (b.type === "pigfarm") { tickPigfarm(G, b, def); return; }
    if (!def.in) return;                               // nothing to make
    tickInterior(G, b, def);
  }

  /* ===================================================================== */
  /* ===== PHASE-C: offsite workers (chop / plant / hack / fish / farm) === */
  /* ===================================================================== */

  function workTicks(kind) {
    if (kind === "chop") return FSC.CHOP_T;
    if (kind === "plant") return FSC.PLANT_T;
    if (kind === "hack") return FSC.HACK_T;
    if (kind === "fish") return FSC.FISH_CHECK_T;      // first bite check
    if (kind === "sow") return FSC.SOW_T;
    return FSC.REAP_T;
  }

  /** Is another worker already walking to this vertex? (keeps two axes off one tree) */
  function taskTaken(G, p, v) {
    for (const id in G.serfs) {
      const s = G.serfs[id];
      if (s.p !== p || s.workV !== v) continue;
      if (s.state === "goWork" || s.state === "doWork") return true;
    }
    return false;
  }

  function freeGrass(G, v) {
    const map = G.map;
    if (map.terr[v] !== FSC.TERR.GRASS) return false;
    if (map.obj[v] !== FSC.OBJ.NONE) return false;
    if (map.flagAt[v] || bldBlocks(G, v)) return false;
    return FSMap.edgeCount(map, v) === 0;              // never plant across a road
  }

  /** The ring a 1-based spiral index falls in (ring R ends at index 3R(R+1)). */
  function ringOfSpiral(k) {
    let R = 1;
    while (3 * R * (R + 1) < k) R++;
    return R;
  }

  /** ONE random tile per attempt, drawn the way the original draws it: a uniform
   * SPIRAL INDEX inside the profession's range (FSC.WORK_SPIRAL), resolved to its
   * ring and then to a uniform tile on that ring. Because ring R holds 6R tiles,
   * the index range itself does the outer-ring weighting — so clearing never runs
   * tidily inside-out and output degrades with resource density. */
  function sampleWorkTile(G, b, def) {
    const span = FSC.WORK_SPIRAL[def.job];
    if (!span) return null;
    const k = span[0] + FSC.rngInt(span[1] - span[0] + 1);
    const R = ringOfSpiral(k);
    const ring = [];
    FSMap.forRadius(G.map, b.v, R, (u, d) => { if (d === R) ring.push(u); });
    // map edges clip the ring: an off-map draw is simply a miss, like the original
    if (!ring.length) return null;
    return { u: ring[FSC.rngInt(ring.length)], d: R };
  }

  /* ═══ THE STONECUTTER WORKS THE NEAREST ROCK (2026-08-01, playtest §4) ════
   * DELIBERATE DEVIATION (farmstead-plan §14.14). Every other profession keeps
   * the original's one-random-disc-sample-per-attempt + per-profession retry
   * cadence, which is what makes output degrade with resource density instead
   * of clearing tidily inside-out. The stonecutter alone now walks to the
   * NEAREST valid pile and works it out before moving on: a hut sited on a near
   * group used to spend most of its trips crossing the map to a far one, which
   * reads as a broken worker rather than as a sampling model.
   *
   * DETERMINISTIC AND LOCKSTEP-SAFE: no FSC.rng at all, and the tie-break is
   * the LOWEST VERTEX INDEX at equal lattice distance (forRadius walks in
   * row-major order, not ring order, so the winner has to be chosen explicitly
   * rather than taken as the first hit).
   */
  function nearestStone(G, b, def) {
    const map = G.map;
    let bv = -1, bd = 1e9;
    FSMap.forRadius(map, b.v, def.radius, (u, d) => {
      if (d > bd || !FSMap.isStone(map.obj[u]) || !(map.objArg[u] > 0)) return;
      if (d === bd && u >= bv) return;                 // tie → lowest vertex index
      if (taskTaken(G, b.p, u)) return;                // another cutter has it
      bv = u; bd = d;
    });
    return bv < 0 ? null : { v: bv, kind: "hack", arg: -1 };
  }

  /** What should this worker do next? {v, kind, arg} or null (missed sample). */
  function pickTask(G, b, def) {
    const map = G.map, O = FSC.OBJ, R = def.radius;
    if (def.job === JOB.STONECUTTER) return nearestStone(G, b, def);
    const smp = sampleWorkTile(G, b, def);
    if (!smp) return null;
    const u = smp.u, d = smp.d;
    if (def.job === JOB.LUMBERJACK) {
      if (map.obj[u] === O.TREE4 && !taskTaken(G, b.p, u)) return { v: u, kind: "chop", arg: -1 };
      return null;
    }
    if (def.job === JOB.FORESTER) {
      if (freeGrass(G, u) && !taskTaken(G, b.p, u)) return { v: u, kind: "plant", arg: -1 };
      return null;
    }
    if (def.job === JOB.STONECUTTER) {
      /* handled before the sample — see nearestStone (deviation §14.14) */
      return null;
    }
    if (def.job === JOB.FISHER) {
      // no stock pre-filter: a lean shoal wastes the trip, exactly like the
      // original — the bite roll (fish − FISH_MIN_STOCK)/64 does the judging
      if (map.terr[u] !== FSC.TERR.WATER) return null;
      for (let k = 0; k < 6; k++) {            // stand on the shore next to it
        const sh = FSMap.nbr(map, u, k);
        if (sh < 0 || !FSMap.walkable(map.terr[sh]) || bldBlocks(G, sh)) continue;
        if (taskTaken(G, b.p, sh)) continue;
        return { v: sh, kind: "fish", arg: u };
      }
      return null;
    }
    if (def.job === JOB.FARMER) {
      // ripe enough to cut? (FIELD2 and up — cutting also ages the field a stage)
      if (FSMap.isField(map.obj[u])) {
        if (map.obj[u] >= O.FIELD0 + FSC.FIELD_HARVEST_MIN && !taskTaken(G, b.p, u)) return { v: u, kind: "reap", arg: -1 };
        return null;
      }
      if (d >= FSC.FIELD_RING[0] && d <= FSC.FIELD_RING[1] && freeGrass(G, u) && !taskTaken(G, b.p, u)) {
        let fields = 0;
        FSMap.forRadius(map, b.v, R, (w) => { if (FSMap.isField(map.obj[w])) fields++; });
        if (fields < FSC.FIELD_MAX) return { v: u, kind: "sow", arg: -1 };
      }
      return null;
    }
    return null;
  }

  /** The worker is home and rested — send him out if there is work in range. */
  function maybeStartTrip(G, s, b) {
    const def = defOf(b);
    if (b.halted) { b.working = false; return; }
    if (b.prodT > 0) { b.prodT--; return; }
    if (b.outHeld >= FSC.OUT_CAP) { b.prodT = FSC.PROD_FLUSH_T; return; }
    const task = pickTask(G, b, def);
    if (!task) {
      // a missed sample waits the profession's confirmed retry cadence; the
      // farmer additionally "gives up" into a long rest after 131 straight
      // misses (the original's counter), waking to try again later
      if (def.job === JOB.FARMER) {
        b.farmMiss = (b.farmMiss || 0) + 1;
        if (b.farmMiss >= FSC.FARM_GIVEUP_N) {
          b.farmMiss = 0; b.prodT = FSC.FARM_GIVEUP_IDLE_T; b.working = false;
          return;
        }
      }
      b.prodT = FSC.WORK_RETRY[def.job] || FSC.WORK_IDLE_T;
      b.working = false;
      return;
    }
    if (def.job === JOB.FARMER) b.farmMiss = 0;
    const path = FSSim.offroadPath(G, b.v, task.v, { maxLen: FSC.WORK_WALK_MAX });
    if (!path || path.length < 2) {
      b.prodT = FSC.WORK_RETRY[def.job] || FSC.WORK_IDLE_T; b.working = false;
      return;
    }
    s.v = b.v; s.from = b.v; s.to = path[1]; s.frac = 0; s.stepT = 0;
    s.path = path.slice(1);
    s.offroad = true;
    s.state = "goWork";
    s.workV = task.v; s.workKind = task.kind; s.workArg = task.arg;
    b.working = true;
  }

  /** Apply the effect of a finished job. Returns the good to carry home, 0, or null. */
  function applyWork(G, s, b) {
    const map = G.map, O = FSC.OBJ, v = s.workV;
    if (s.workKind === "chop") {
      if (map.obj[v] !== O.TREE4) return null;
      map.obj[v] = O.STUMP; map.objArg[v] = 0; dirty(G, v);
      event(G, "treeFelled", { v, p: b.p, bld: b.id });
      return "lumber";
    }
    if (s.workKind === "plant") {
      if (map.obj[v] !== O.NONE) return null;
      map.obj[v] = O.SAPLING; map.objArg[v] = 0; dirty(G, v);
      event(G, "saplingPlanted", { v, p: b.p, bld: b.id });
      return 0;
    }
    if (s.workKind === "hack") {
      if (!FSMap.isStone(map.obj[v])) return null;
      const left = Math.max(0, (map.objArg[v] || 1) - 1);
      if (left > 0) FSMap.setStone(map, v, left);
      else { map.obj[v] = O.NONE; map.objArg[v] = 0; }
      dirty(G, v);
      event(G, "stoneCut", { v, p: b.p, left });
      return "stone";
    }
    if (s.workKind === "sow") {
      if (map.obj[v] !== O.NONE) return null;
      map.obj[v] = O.FIELD0; map.objArg[v] = 0; dirty(G, v);
      event(G, "fieldSown", { v, p: b.p, bld: b.id });
      return 0;
    }
    if (s.workKind === "reap") {
      // a cut takes one sheaf AND ages the field a stage (past ripe → stubble)
      if (!FSMap.isField(map.obj[v]) || map.obj[v] < O.FIELD0 + FSC.FIELD_HARVEST_MIN) return null;
      map.obj[v] = map.obj[v] >= O.FIELD4 ? O.FIELD_STUB : map.obj[v] + 1;
      map.objArg[v] = 0; dirty(G, v);
      event(G, "fieldReaped", { v, p: b.p, bld: b.id });
      return "wheat";
    }
    return null;
  }

  /**
   * Fishing is a run of chances rather than a fixed job: each check has a
   * (fish − FISH_MIN_STOCK)/64 chance of a bite, and after FISH_CHECKS the fisher
   * packs up empty handed. Returns "fish", 0 (still trying) or null (gave up).
   */
  function fishCheck(G, s) {
    const map = G.map, w = s.workArg;
    s.fishN = (s.fishN || 0) + 1;
    if (w >= 0 && map.terr[w] === FSC.TERR.WATER) {
      const stock = map.fish[w] || 0;
      const chance = Math.max(0, stock - FSC.FISH_MIN_STOCK) / FSC.FISH_P_DIV;
      if (chance > 0 && FSC.rng() < chance) {
        map.fish[w]--;
        event(G, "fishCaught", { v: w, p: s.p, left: map.fish[w] });
        return "fish";
      }
    }
    if (s.fishN >= FSC.FISH_CHECKS) return null;
    return 0;
  }

  /** The offsite worker state machine (called from tickWorkerSerf). */
  function tickFieldWorker(G, s) {
    const b = G.buildings[s.home];
    if (!b || b.state !== "done") { if (b) b.worker = 0; sendHome(G, s); return; }
    const def = defOf(b);
    if (s.state === "goWork") {
      if (!walk(G, s)) return;
      s.state = "doWork"; s.t = workTicks(s.workKind); s.fishN = 0; s.fishWait = 0;
      return;
    }
    if (s.state === "doWork") {
      if (--s.t > 0) return;
      let res;
      if (s.workKind === "fish") {
        // confirmed original: the bite roll happens only on the SHORT pass;
        // the long pass is a pure no-check cooldown between attempts
        if (s.fishWait) { s.fishWait = 0; s.t = FSC.FISH_CHECK_T; return; }
        res = fishCheck(G, s);
        if (res === 0) {                               // no bite yet — cool down, then retry
          s.fishWait = 1; s.t = FSC.FISH_WAIT_T;
          return;
        }
      } else {
        res = applyWork(G, s, b);
      }
      s.carry = res || 0;
      s.workV = -1;
      const home = FSSim.offroadPath(G, s.v, b.v, { maxLen: FSC.WORK_WALK_MAX + 10 });
      if (!home || home.length < 2) {                  // stranded (very rare)
        if (s.carry) s.carry = 0;
        s.v = b.v; s.from = b.v; s.to = b.v; s.frac = 0; s.path.length = 0;
        s.state = "work"; b.prodT = def.cycleT; b.working = false;
        return;
      }
      s.path = home.slice(1);
      s.offroad = true;
      s.state = "backWork";
      return;
    }
    // backWork
    if (!walk(G, s)) return;
    if (s.carry) { produceGood(G, b, s.carry, 1); b.cycles++; }
    s.carry = 0;
    s.state = "work";
    b.prodT = def.cycleT;
    b.working = false;
  }

  /* ===================================================================== */
  /* ===== PHASE-C: geologists (plan §8) ================================== */
  /* ===================================================================== */

  const MINERAL_NAME = { 1: "stone", 2: "coal", 3: "iron ore", 4: "gold" };

  FSSim.sendGeologist = function (G, flagId, p) {
    p = p || 0;
    const f = flagOf(G, flagId);
    if (!f) return { ok: false, why: "no flag" };
    if (f.p !== p) return { ok: false, why: "not your flag" };
    if (G.map.terr[f.v] !== FSC.TERR.MOUNTAIN) return { ok: false, why: "geologists survey mountains" };
    for (const id in G.serfs) {
      const s = G.serfs[id];
      if (s.job === JOB.GEOLOGIST && s.geoFlag === flagId) return { ok: false, why: "a geologist is already on the way" };
    }
    requestSerf(G, p, JOB.GEOLOGIST, "geo", flagId);
    return { ok: true, flag: flagId };
  };

  /** sign code = (mineral+1) + 8*density, or FSC.SIGN_EMPTY for "nothing here". */
  FSSim.signMineral = function (code) {
    if (!code || code === FSC.SIGN_EMPTY) return 0;
    return (code & 7) - 1;
  };
  FSSim.signDensity = function (code) {
    if (!code || code === FSC.SIGN_EMPTY) return 0;
    return code >> 3;
  };

  function plantSign(G, s) {
    const map = G.map, v = s.workV;
    if (v < 0) return;
    const amt = map.mineralAmt[v] || 0;
    const kind = amt > 0 ? map.mineral[v] : 0;
    // a sign says WHAT and roughly HOW MUCH: big deposit or small.
    const code = kind > 0 ? (kind + 1) + (amt >= FSC.GEO_BIG_AMT ? 8 : 0) : FSC.SIGN_EMPTY;
    map.sign[v] = code;
    dirty(G, v);
    event(G, "geoSign", { v, mineral: kind, amt, code, p: s.p });
    if (kind > 0) {
      // one shout per mineral+size in this neighbourhood, not once per sign
      let dup = false;
      FSMap.forRadius(map, v, 4, (u) => { if (u !== v && map.sign[u] === code) dup = true; });
      if (!dup) FSSim.notify(G, s.p, "Geologist found " + (MINERAL_NAME[kind] || "ore") + ".", v);
    }
  }

  /**
   * The tour: from the flag he samples up to GEO_TRIES candidate vertices in
   * rings GEO_RING; two already-signed hits mean the area is surveyed and he
   * goes home. Otherwise he walks out, hammers, plants a sign, comes BACK to
   * the flag and searches again.
   */
  function nextGeoSpot(G, s) {
    const map = G.map;
    const f = flagOf(G, s.geoFlag);
    const center = f ? f.v : s.v;
    const lo = FSC.GEO_RING[0], hi = FSC.GEO_RING[1];
    const ring = [];
    FSMap.forRadius(map, center, hi, (u, d) => { if (d >= lo) ring.push(u); });
    if (s.geoSpots >= FSC.GEO_SPOTS || !ring.length) { sendHome(G, s); return false; }
    let signs = 0;
    for (let tries = 0; tries < FSC.GEO_TRIES; tries++) {
      const u = ring[FSC.rngInt(ring.length)];
      if (map.sign[u]) { signs++; if (signs >= FSC.GEO_SIGN_STOP) break; continue; }
      if (map.terr[u] !== FSC.TERR.MOUNTAIN || map.flagAt[u] || bldBlocks(G, u)) continue;
      if (s.geoSeen.indexOf(u) >= 0) continue;
      s.geoSeen.push(u);
      const path = FSSim.offroadPath(G, s.v, u, { maxLen: FSC.OFFROAD_MAX });
      if (!path) continue;
      s.workV = u;
      if (path.length < 2) { s.state = "geoWork"; s.t = FSC.GEO_T; return true; }
      s.path = path.slice(1);
      s.offroad = true;
      s.state = "geoWalk";
      return true;
    }
    sendHome(G, s);
    return false;
  }

  function tickGeologist(G, s) {
    if (s.state === "goGeo") {
      if (!walk(G, s)) return;
      s.geoSpots = 0; s.geoSeen = [];
      nextGeoSpot(G, s);
      return;
    }
    if (s.state === "geoWalk") {
      if (!walk(G, s)) return;
      s.state = "geoWork"; s.t = FSC.GEO_T;
      return;
    }
    if (s.state === "geoWork") {
      if (--s.t > 0) return;
      plantSign(G, s);
      s.geoSpots++;
      s.workV = -1;
      const f = flagOf(G, s.geoFlag);
      const back = f ? FSSim.offroadPath(G, s.v, f.v, { maxLen: FSC.OFFROAD_MAX }) : null;
      if (!back || back.length < 2) { nextGeoSpot(G, s); return; }
      s.path = back.slice(1);
      s.offroad = true;
      s.state = "geoBack";
      return;
    }
    // geoBack — home at the flag, look for the next likely spot
    if (!walk(G, s)) return;
    nextGeoSpot(G, s);
  }

  /* ===================================================================== */
  /* ===== PHASE-C: water roads + boats =================================== */
  /* ===================================================================== */

  /** Pull a boat out of the nearest store and address it to the road's shore flag. */
  function requestBoat(G, r) {
    const ends = [r.f1, r.f2];
    for (let i = 0; i < ends.length; i++) {
      const f = flagOf(G, ends[i]);
      if (!f) continue;
      const wh = FSSim.warehouseNear(G, f.id, r.p, (b) => (b.inv.boat || 0) > 0);
      if (!wh) continue;
      const wf = flagOf(G, wh.flag);
      if (!wf || wf.slots.length >= FSC.FLAG_CAP) continue;
      wh.inv.boat--;
      FSSim.pushItem(G, wf, "boat", 0, { destFlag: f.id, road: r.id });
      r.boatInFlight = 1;
      event(G, "boatSent", { road: r.id, from: wh.id, flag: f.id, p: r.p });
      return true;
    }
    return false;
  }

  function tickWaterRoads(G) {
    for (const id in G.roads) {
      const r = G.roads[id];
      if (!r.water || r.boatHave) continue;
      // has a boat arrived on either shore?
      const ends = [r.f1, r.f2];
      for (let i = 0; i < ends.length && !r.boatHave; i++) {
        const f = flagOf(G, ends[i]);
        if (!f) continue;
        for (let k = 0; k < f.slots.length; k++) {
          const it = f.slots[k];
          if (it.res !== "boat") continue;
          if (it.road && it.road !== r.id) continue;
          if (!it.road && it.destFlag !== f.id) continue;
          f.slots.splice(k, 1);
          r.boatHave = true; r.boatInFlight = 0;
          event(G, "boatArrive", { road: r.id, flag: f.id, p: r.p });
          FSSim.notify(G, r.p, "A boat is in the water — the ferry runs.", f.v);
          requestCarrier(G, r);
          break;
        }
      }
      if (!r.boatHave && !r.boatInFlight && ((G.tick + r.id) % FSC.BOAT_REQ_T) === 0) requestBoat(G, r);
    }
  }

  /* ===================================================================== */
  /* ===== PHASE-C: player controls (all routed through the command layer) = */
  /* ===================================================================== */

  FSSim.setDist = function (G, p, key, value) {
    const pl = G.players[p];
    if (!pl || !(key in pl.dist)) return { ok: false, why: "unknown distribution" };
    let v = value | 0;
    if (v < 0) v = 0;
    if (v > FSC.PRIO_MAX) v = FSC.PRIO_MAX;
    pl.dist[key] = v;
    if (pl.distCredit) pl.distCredit = {};             // a slider move restarts the round-robin
    return { ok: true, key, value: v };
  };

  FSSim.setToolPrio = function (G, p, tool, value) {
    const pl = G.players[p];
    if (!pl || FSC.TOOLS.indexOf(tool) < 0) return { ok: false, why: "unknown tool" };
    let v = value | 0;
    if (v < 0) v = 0;
    if (v > FSC.PRIO_MAX) v = FSC.PRIO_MAX;
    pl.tools[tool] = v;
    return { ok: true, tool, value: v };
  };

  FSSim.setStockMode = function (G, bldId, res, mode, p) {
    const b = bldOf(G, bldId);
    if (!b || !b.modes) return { ok: false, why: "not a warehouse" };
    if (p !== undefined && b.p !== p) return { ok: false, why: "not yours" };
    if (FSC.RES_LIST.indexOf(res) < 0) return { ok: false, why: "unknown resource" };
    const m = mode | 0;
    if (m < 0 || m > 2) return { ok: false, why: "bad mode" };
    b.modes[res] = m;
    markAllRetry(G);                                   // goods heading here may need a new home
    return { ok: true, id: b.id, res, mode: m };
  };

  FSSim.setHalt = function (G, bldId, on, p) {
    const b = bldOf(G, bldId);
    if (!b) return { ok: false, why: "no building" };
    if (p !== undefined && b.p !== p) return { ok: false, why: "not yours" };
    b.halted = !!on;
    if (b.halted) b.working = false;
    return { ok: true, id: b.id, halted: b.halted };
  };

  /** Totals of everything a player has ever produced (also feeds the stats rings). */
  FSSim.production = function (G, p) { return Object.assign({}, G.prod[p] || {}); };
  FSSim.consumption = function (G, p) { return Object.assign({}, (G.cons && G.cons[p]) || {}); };

  /**
   * TEST/DEBUG hook — finish a site instantly. Used by the suites (and later the
   * map editor) so production tests do not have to re-run construction every time.
   */
  FSSim.forceComplete = function (G, id) {
    const b = bldOf(G, id);
    if (!b) return { ok: false, why: "no building" };
    if (b.state === "done") return { ok: false, why: "already done" };
    b.matGot.plank = b.matReq.plank; b.matGot.stone = b.matReq.stone;
    b.matHave.plank = 0; b.matHave.stone = 0;
    b.matInFlight.plank = 0; b.matInFlight.stone = 0;
    b.matUsed = totalCost(b);
    b.leveled = true; b.progress = 0;
    b.diggerReq = false; b.builderReq = false;
    finishBuilding(G, b);
    /* ===== PHASE-D: a military building only holds land once a knight is in
     * it, so the debug hook posts one straight away — the transport/economy
     * suites lean on "forceComplete a hut → the border moves". */
    if (b.mil && !b.mil.knights.length) {
      b.mil.knights.push(0);
      dropRequest(G, "bld", b.id);
      const M = mil();
      if (M) M.onGarrisonChange(G, b); else FSSim.recomputeOwner(G);
    }
    return { ok: true, id: b.id };
  };

  /** Cheap stats sampling for the Phase-E graphs. */
  function tickStats(G) {
    if ((G.tick % FSC.STATS_T) !== 0) return;
    for (let p = 0; p < G.players.length; p++) {
      const st = G.stats[p];
      if (!st) continue;
      const c = FSSim.counts(G, p);
      let goods = 0;
      const pr = G.prod[p] || {};
      for (const k in pr) goods += pr[k];
      st.t.push(G.tick); st.goods.push(goods); st.serfs.push(c.people);
      st.land.push(c.land);
      /* ===== PHASE-E: this was a hardcoded 0 — the Stats panel needs a real
       * number to chart. mil() is the same lazy-bound accessor recomputeOwner
       * already uses, so this stays 0 gracefully if fs-military.js is absent. */
      st.military.push(mil() ? mil().strength(G, p) : 0);
      for (const k in st) if (st[k].length > FSC.STATS_CAP) st[k].shift();
    }
  }

  /* ===================================================================== */
  /* ===== PHASE-B: destless goods retry ================================== */
  /* ===================================================================== */

  function tickRetry(G) {
    let done = 0;
    for (let i = 0; i < G.retryQ.length && done < FSC.RETRY_PER_TICK; i++) {
      const q = G.retryQ[i];
      if (q.due > G.tick) continue;
      done++;
      const f = flagOf(G, q.f);
      if (!f) { G.retryQ.splice(i--, 1); continue; }
      let any = false;
      for (let k = 0; k < f.slots.length; k++) {
        const it = f.slots[k];
        /* ===== PHASE-C: flag-addressed goods keep their address while reachable ===== */
        if (it.destFlag) {
          const tf = G.flags[it.destFlag];
          if (tf && (tf.id === f.id || FSSim.hops(G, f.id, tf.id) >= 0)) continue;
          it.destFlag = 0;
          FSSim.releaseBoatBinding(G, it);
        }
        const b = it.dest && G.buildings[it.dest];
        // keep a destination that is still alive AND still reachable by road
        if (b && (b.flag === f.id || FSSim.hops(G, f.id, b.flag) >= 0)) continue;
        // leave it.dest for scheduleItem — its release path is what returns the
        // in-flight booking; zeroing here would leave a phantom booking forever
        FSSim.scheduleItem(G, f, it);
        if (!it.dest) any = true;
      }
      if (any) q.due = G.tick + FSC.RETRY_T;
      else G.retryQ.splice(i--, 1);
    }
  }

  // --------------------------------------------------------------------- tick
  /** Exactly one 100 ms game tick. */
  FSSim.tick = function (G) {
    G.tick++;
    /* commands execute at the START of their tick, in (t, by, seq) order */
    FSSim.runCommands(G, false);

    tickSweep(G);                 /* ===== PHASE-C: the living world ===== */

    /* ===== PHASE-B: transport (flags, roads, carriers, construction) ===== */
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.spawnT > 0) b.spawnT--;
      tickConstruction(G, b);
      if (b.inv && b.state === "done" && ((G.tick + b.id) % FSC.WH_DISPATCH_T) === 0) warehouseDispatch(G, b);
    }
    tickPopulation(G);
    tickSerfRequests(G);
    for (const id in G.serfs) {
      const s = G.serfs[id];
      const carrier = (s.job === JOB.TRANSPORTER || s.job === JOB.SAILOR);
      if (carrier && s.state !== "return") tickCarrier(G, s);
      else tickWorkerSerf(G, s);
    }
    tickRetry(G);
    tickWaterRoads(G);            /* ===== PHASE-C: ferries ===== */

    /* ===== PHASE-D hook: garrisons, promotion, duels, captures, elimination,
     * then the computer opponents. Both modules are optional — without them the
     * sim is exactly the Phase-C game. ===== */
    const M = mil();
    if (M) M.tick(G);
    const A = ai();
    if (A) A.tick(G);

    tickStats(G);
    return G;
  };

  FSSim.run = function (G, n) {
    for (let i = 0; i < n; i++) FSSim.tick(G);
    return G;
  };

  // ----------------------------------------------------------------- queries
  FSSim.castleOf = function (G, p) { return G.buildings[G.players[p].castleId] || null; };
  FSSim.invOf = function (G, p) {
    const inv = FSSim.emptyInv();
    for (const id in G.buildings) {
      const b = G.buildings[id];
      // a burning store's stock is already unroutable (warehouseNear refuses it)
      // — reporting it would let the HUD and the AI spend goods that are gone
      if (b.p !== p || !b.inv || b.state === "burn") continue;
      for (const k in b.inv) inv[k] = (inv[k] || 0) + b.inv[k];
    }
    return inv;
  };
  FSSim.poolOf = function (G, p) {
    const pool = FSSim.emptyPool();
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.pool || b.state === "burn") continue;
      for (const k in b.pool) pool[k] = (pool[k] || 0) + b.pool[k];
    }
    return pool;
  };
  FSSim.counts = function (G, p) {
    let buildings = 0, flags = 0, roads = 0, serfs = 0, land = 0, sites = 0, goods = 0;
    for (const id in G.buildings) { const b = G.buildings[id]; if (b.p === p) { buildings++; if (b.state !== "done") sites++; } }
    for (const id in G.flags) { const f = G.flags[id]; if (f.p === p) { flags++; goods += f.slots.length; } }
    for (const id in G.roads) if (G.roads[id].p === p) roads++;
    for (const id in G.serfs) if (G.serfs[id].p === p) serfs++;
    const owner = G.map.owner;
    for (let i = 0; i < owner.length; i++) if (owner[i] === p) land++;
    const pool = FSSim.poolOf(G, p);
    let pooled = 0;
    for (const k in pool) pooled += pool[k];
    /* ===== PHASE-D: garrisons ===== */
    let garrison = 0, milBlds = 0;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.mil || b.state === "burn") continue;
      milBlds++;
      garrison += b.mil.knights.length;
    }
    return { buildings, flags, roads, serfs, land, sites, goods, pooled, garrison, milBlds,
      people: serfs + pooled + garrison };
  };
  FSSim.serfsOf = function (G, p) {
    const out = [];
    for (const id in G.serfs) if (G.serfs[id].p === p) out.push(G.serfs[id]);
    return out;
  };
  FSSim.itemsAt = function (G, flagId) {
    const f = flagOf(G, flagId);
    return f ? f.slots.map((s) => ({ res: s.res, dest: s.dest })) : [];
  };
  FSSim.roadBetween = function (G, f1, f2) {
    const a = flagOf(G, f1);
    if (!a) return 0;
    for (let i = 0; i < a.roads.length; i++) {
      const r = G.roads[a.roads[i]];
      if (r && (r.f1 === f2 || r.f2 === f2)) return r.id;
    }
    return 0;
  };

  /* ===================================================================== */
  /* ===== PHASE-M: co-op seams — ping, seats, serialize/deserialize ====== */
  /* ===================================================================== */

  /**
   * "Look here!" marker. Pushes an event both machines raise at the same tick
   * and touches NOTHING the hash reads — a ping can never desync a room, so it
   * is allowed the short CMD_DELAY even in multiplayer (see FSC.CMD_HASH_NEUTRAL).
   */
  FSSim.ping = function (G, v, p, by) {
    const N = G.map.W * G.map.H;
    if (!(v >= 0 && v < N)) return { ok: false, why: "off the map" };
    event(G, "ping", { v: v | 0, p: p | 0, by: by === undefined ? 0 : by | 0 });
    return { ok: true, v: v | 0 };
  };

  /** seat → player map. Used when a co-op guest carries on solo (plan §16). */
  FSSim.setSeats = function (G, seats) {
    if (!seats || !seats.length) return { ok: false, why: "bad seats" };
    G.seats = seats.map((s) => s | 0);
    return { ok: true, seats: G.seats.slice() };
  };

  /** True on the tick boundaries where both machines exchange a state hash. */
  FSSim.isCheckpoint = function (G) { return (G.tick % FSC.SYNC_HASH_T) === 0; };
  /** Hash + tick in one object — what a checkpoint message carries. */
  FSSim.checkpoint = function (G) { return { t: G.tick, h: FSSim.hash(G) }; };

  // ---- typed-array packing (b64, exact bytes — no float re-formatting) ----
  const TA_NAME = {
    Float32Array: "f32", Float64Array: "f64", Uint8Array: "u8", Int8Array: "i8",
    Uint16Array: "u16", Int16Array: "i16", Uint32Array: "u32", Int32Array: "i32",
    Uint8ClampedArray: "u8c",
  };
  const TA_CTOR = {
    f32: Float32Array, f64: Float64Array, u8: Uint8Array, i8: Int8Array,
    u16: Uint16Array, i16: Int16Array, u32: Uint32Array, i32: Int32Array,
    u8c: Uint8ClampedArray,
  };
  function b64enc(bytes) {
    if (typeof btoa === "function") {
      let s = "";
      const CH = 0x8000;                       // fromCharCode arg-count ceiling
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(s);
    }
    return Buffer.from(bytes).toString("base64");   // node (suite helpers)
  }
  function b64dec(s) {
    if (typeof atob === "function") {
      const bin = atob(s), out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(s, "base64"));
  }
  function packMap(map) {
    const out = {};
    for (const k in map) {
      const val = map[k];
      const tn = val && val.buffer && val.constructor ? TA_NAME[val.constructor.name] : null;
      if (tn) out[k] = { _ta: tn, b: b64enc(new Uint8Array(val.buffer, val.byteOffset, val.byteLength)) };
      else out[k] = val;
    }
    return out;
  }
  function unpackMap(o) {
    const map = {};
    for (const k in o) {
      const val = o[k];
      if (val && val._ta && TA_CTOR[val._ta]) {
        const bytes = b64dec(val.b);
        const C = TA_CTOR[val._ta];
        map[k] = new C(bytes.buffer, bytes.byteOffset, bytes.byteLength / C.BYTES_PER_ELEMENT);
      } else map[k] = val;
    }
    return map;
  }

  /**
   * FSSim.serialize(G) → JSON string. The whole game: every entity id-linked
   * (no cycles), the map's typed arrays as exact base64 bytes, and the PRNG
   * stream position. Used by MP join/resync AND by Phase E's save slots.
   */
  FSSim.serialize = function (G) {
    const g = {};
    for (const k in G) { if (k !== "map") g[k] = G[k]; }
    return JSON.stringify({
      fs: "farmstead", v: FSC.VERSION, t: G.tick,
      rng: FSC.rngSnapshot(),
      map: packMap(G.map),
      g,
    });
  };

  /** FSSim.deserialize(str) → G. THROWS on a foreign or wrong-version save —
   * it is the low-level primitive; every caller (title Continue, Save/Load
   * sheet, net resync) wraps it and turns a throw into a friendly failure. */
  FSSim.deserialize = function (str) {
    const doc = typeof str === "string" ? JSON.parse(str) : str;
    if (!doc || doc.fs !== "farmstead") throw new Error("not a farmstead save");
    if ((doc.v | 0) !== (FSC.VERSION | 0)) throw new Error("save version " + doc.v + " ≠ " + FSC.VERSION);
    const G = doc.g || {};
    G.map = unpackMap(doc.map || {});
    FSMap.bind(G.map);
    FSC.rngRestore(doc.rng || { seed: G.seed >>> 0, calls: 0 });
    G.rngState = FSC.rngSnapshot();
    // arrays the render/UI layers drain every frame must never be missing
    if (!G.events) G.events = [];
    if (!G.notif) G.notif = [];
    if (!G.dirtyV) G.dirtyV = [];
    if (!G.cmdQueue) G.cmdQueue = [];
    /* a save from before the consumption ledger existed just starts counting
     * from here — the HUD's rate is a DIFFERENCE over a window, so it is
     * correct one window after the load either way */
    if (!G.cons) G.cons = [];
    if (!G.seats) G.seats = G.mode === "separate" ? [0, 1] : [0, 0];
    /* Building BODIES are derived state (see FSMap.footprintOf). A save taken
     * before they existed still has to load into a world where settlers walk
     * round the castle, so rebuild the layer rather than trusting the file. */
    if (G.map && G.buildings) {
      const N = G.map.W * G.map.H;
      if (!G.map.bldFoot || G.map.bldFoot.length !== N) G.map.bldFoot = new Int32Array(N);
      else G.map.bldFoot.fill(0);
      for (const id in G.buildings) {
        const b = G.buildings[id];
        const foot = FSMap.footprintOf(G.map, b.type, b.v);
        for (let i = 0; i < foot.length; i++) G.map.bldFoot[foot[i]] = b.id;
      }
    }
    /* ===== PHASE-E: a save from before invPrio existed gets the default order ===== */
    if (G.players) for (let i = 0; i < G.players.length; i++) {
      if (G.players[i] && !G.players[i].invPrio) G.players[i].invPrio = FSC.INV_ORDER.slice();
    }
    return G;
  };

  /**
   * Cheap deterministic state hash — the lockstep/desync check (plan §16) and the
   * suites' replay test. Deliberately EXCLUDES G.speed and render-only scratch.
   */
  FSSim.hash = function (G) {
    let h = 0x811c9dc5 >>> 0;
    function mix(x) { x = x | 0; h ^= x & 0xff; h = Math.imul(h, 0x01000193) >>> 0; h ^= (x >> 8) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; h ^= (x >> 16) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
    function ids(o) { const k = Object.keys(o).map(Number); k.sort((a, b) => a - b); return k; }
    mix(G.tick); mix(G.nextId); mix(G.routeGen);
    for (let p = 0; p < G.players.length; p++) {
      const inv = FSSim.invOf(G, p), pool = FSSim.poolOf(G, p);
      for (let i = 0; i < FSC.RES_LIST.length; i++) mix(inv[FSC.RES_LIST[i]] || 0);
      for (const k in JOB) mix(pool[JOB[k]] || 0);
    }
    const fs = ids(G.flags);
    mix(fs.length);
    for (let i = 0; i < fs.length; i++) {
      const f = G.flags[fs[i]];
      mix(f.id); mix(f.v); mix(f.slots.length); mix(f.roads.length); mix(f.bld);
      for (let k = 0; k < f.slots.length; k++) { mix(RES_IDX[f.slots[k].res] || 0); mix(f.slots[k].dest); }
    }
    const rs = ids(G.roads);
    mix(rs.length);
    for (let i = 0; i < rs.length; i++) {
      const r = G.roads[rs[i]];
      mix(r.id); mix(r.f1); mix(r.f2); mix(r.path.length); mix(r.carrier);
    }
    const bs = ids(G.buildings);
    mix(bs.length);
    for (let i = 0; i < bs.length; i++) {
      const b = G.buildings[bs[i]];
      mix(b.id); mix(b.v); mix(STATE_IDX[b.state] || 0); mix(b.progress); mix(b.matUsed);
      mix(b.matHave.plank); mix(b.matHave.stone); mix(b.matInFlight.plank); mix(b.matInFlight.stone);
      mix(b.worker); mix(b.crew); mix(b.workerReq ? 1 : 0);
      /* ===== PHASE-C: production state ===== */
      mix(b.swings); mix(b.prodT); mix(b.working ? 1 : 0); mix(b.cycles); mix(b.outHeld || 0);
      mix(b.herd === undefined ? 0 : b.herd);
      for (let k = 0; k < FSC.RES_LIST.length; k++) mix(b.stockIn[FSC.RES_LIST[k]] || 0);
      /* ===== PHASE-D: garrison, gold, siege ===== */
      mix(b.p);
      if (b.mil) {
        mix(b.mil.knights.length); mix(b.mil.wanted); mix(b.mil.gold); mix(b.mil.defending);
        for (let k = 0; k < b.mil.knights.length; k++) mix(b.mil.knights[k]);
        mix(b.mil.attackers.length);
        mix(b.mil.fight ? (b.mil.fight.att + b.mil.fight.def * 7 + b.mil.fight.t * 13) : 0);
      }
      if (b.knightRanks) { mix(b.knightRanks.length); for (let k = 0; k < b.knightRanks.length; k++) mix(b.knightRanks[k]); }
    }
    const ss = ids(G.serfs);
    mix(ss.length);
    for (let i = 0; i < ss.length; i++) {
      const s = G.serfs[ss[i]];
      mix(s.id); mix(JOB_IDX[s.job] || 0); mix(SERF_STATE_IDX[s.state] || 0);
      mix(s.v); mix(s.from); mix(s.to); mix(s.stepT); mix(s.path.length);
      mix(RES_IDX[s.carry] || 0); mix(s.carryDest); mix(s.road); mix(s.t);
      mix(s.workV === undefined ? -1 : s.workV); mix(s.geoSpots || 0);   /* PHASE-C */
      mix(s.rank || 0); mix(s.atkTarget || 0);                           /* PHASE-D */
    }
    mix(G.sweepV);
    /* ===== PHASE-D: territory + victory ===== */
    const owner = G.map.owner;
    let land = 0;
    for (let i = 0; i < owner.length; i++) land = (land + (owner[i] + 2) * (i + 1)) | 0;
    mix(land); mix(land >> 8); mix(land >> 16);
    mix(G.gameOver ? (G.gameOver.winnerTeam + 2) : 0);
    for (let p = 0; p < G.players.length; p++) mix(G.players[p].eliminated ? 1 : 0);
    return h >>> 0;
  };

  /* ===================================================================== */
  /* ===== PHASE-D hook: the internals fs-military / fs-ai are allowed to  */
  /* ===== reach for. Everything else stays private to this file.         */
  /* ===================================================================== */
  FSSim._d = {
    sendHome, setState, rescheduleFor, dropRequest, despawn, makeSerf, walk,
    poolPut, poolTake, syncPoolInv, markAllRetry, requestSerf, flagAtV, flagOf,
    bldOf, defOf, inFlightAdd, removeBuilding, homeFlagFor, goToFlag, edgeTicks,
    totalCost, swingsFor,
  };

  if (typeof window !== "undefined") window.FSSim = FSSim;
  if (typeof module !== "undefined" && module.exports) module.exports = FSSim;
})();
