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
 */
(function () {
  "use strict";

  const FSC = (typeof window !== "undefined" && window.FSC) ? window.FSC
    : (typeof require === "function" ? require("./fs-const.js") : null);
  const FSMap = (typeof window !== "undefined" && window.FSMap) ? window.FSMap
    : (typeof require === "function" ? require("./fs-map.js") : null);

  const FSSim = {};
  const JOB = FSC.JOB;

  // stable integer ids for hashing string enums
  const RES_IDX = Object.create(null);
  FSC.RES_LIST.forEach((r, i) => (RES_IDX[r] = i + 1));
  const JOB_IDX = Object.create(null);
  Object.keys(JOB).forEach((k, i) => (JOB_IDX[JOB[k]] = i + 1));
  const STATE_IDX = Object.create(null);
  ["site", "leveling", "build", "done", "burn"].forEach((s, i) => (STATE_IDX[s] = i + 1));
  const SERF_STATE_IDX = Object.create(null);
  ["spawn", "goRoad", "idle", "fetch", "carry", "wait", "handIn", "goBld", "enter",
    "level", "hammer", "work", "return", "gone"].forEach((s, i) => (SERF_STATE_IDX[s] = i + 1));

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
      dist: Object.assign({}, FSC.DIST_DEFAULTS),
      knights: Object.assign({}, FSC.KNIGHT_DEFAULTS),
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
      leveled: def.size < 2,          // only LARGE sites need a digger (there is no medium tier)
      diggerReq: false, builderReq: false, crew: 0, crewT: 0,
      worker: 0, workerReq: false,
      stockIn: {}, stockOut: {}, reqInFlight: {},
      prodT: 0,
      burnT: 0,
    };
    if (def.mil) b.mil = { knights: [], wanted: 0, gold: 0, goldReq: 0 };
    if (def.mine) b.mine = { kind: def.mine, exhausted: false };
    if (def.warehouse) { b.inv = FSSim.emptyInv(); b.pool = FSSim.emptyPool(); b.spawnT = 0; }
    G.buildings[b.id] = b;
    G.map.bldAt[v] = b.id;
    return b;
  };

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
    if (G.notif.length > FSC.NOTIF_CAP) G.notif.splice(0, G.notif.length - FSC.NOTIF_CAP);
  };

  /** Vertices whose terrain/objects changed — the renderer drains this list. */
  function dirty(G, v) {
    // the renderer drains this every frame; headless runs simply let it fill up
    if (v >= 0 && G.dirtyV.length < 4096) G.dirtyV.push(v);
  }
  FSSim.dirtyVertices = function (G) { return G.dirtyV; };

  /**
   * Territory: every vertex within radius of an occupied military building belongs
   * to the nearest such building's owner (ties -> lower building id).
   */
  FSSim.recomputeOwner = function (G) {
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
   * FSSim.newGame({size, seed, ais}) — generate a world and seat every player.
   * size: 'small'|'medium'|'large' (or a number). ais: 0..3 computer opponents.
   */
  FSSim.newGame = function (opts) {
    opts = opts || {};
    const ais = Math.max(0, Math.min(3, opts.ais === undefined ? 1 : opts.ais | 0));
    const nPlayers = 1 + ais;
    const seed = (opts.seed >>> 0) || 1;

    const map = FSMap.generate({ seed, size: opts.size, players: nPlayers });
    FSMap.bind(map);

    const G = {
      version: FSC.VERSION,
      seed, tick: 0, speed: 1, nextId: 1,
      size: opts.size || "medium",
      map,
      players: [],
      flags: {}, roads: {}, buildings: {}, serfs: {},
      events: [], notif: [],
      stats: {},
      routeGen: 1,
      /* ===== PHASE-B: command layer + work queues ===== */
      cmdQueue: [], cmdSeq: 0, cmdLog: 0,
      seats: [0, 0],            // seat id → player id (shared-kingdom co-op default)
      serfReqs: [],             // {p, job, kind:'road'|'bld', id, due}
      retryQ: [],               // {f: flagId, due} — destless goods
      dirtyV: [],               // vertices the renderer must re-sync
      gameOver: null,
      rngState: FSC.rngSnapshot(),
    };

    for (let i = 0; i < nPlayers; i++) {
      G.players.push(makePlayer(G, i, i > 0));
      G.stats[i] = makeStats();
    }

    // castles: building entity + its door flag, start inventory, starting land
    for (let i = 0; i < nPlayers; i++) {
      const v = map.starts[i];
      const b = FSSim.makeBuilding(G, i, "castle", v, "done");
      b.mil.wanted = FSC.BLD.castle.mil.cap;
      const inv = b.inv;
      for (const k in FSC.START_INV) inv[k] = FSC.START_INV[k];
      // the exact confirmed starting roster lives in the castle as a job-tagged pool
      for (const job in FSC.START_SERFS) b.pool[job] = FSC.START_SERFS[job];
      inv.serf = b.pool.generic; inv.knight = b.pool.knight;
      G.players[i].castleId = b.id;

      const door = FSMap.doorVertex(map, v);
      if (door >= 0) {
        const f = FSSim.makeFlag(G, i, door);
        f.bld = b.id;
        b.flag = f.id;
      }
    }
    FSSim.recomputeOwner(G);

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
    const c = {
      t: cmd.t === undefined ? G.tick + FSC.CMD_DELAY : cmd.t | 0,
      seq: cmd.seq === undefined ? G.cmdSeq++ : cmd.seq | 0,
      by: cmd.by === undefined ? 0 : cmd.by | 0,
      type: String(cmd.type || ""),
      args: cmd.args || {},
    };
    G.cmdQueue.push(c);
    if (c.type === "speed" || G.speed === 0) FSSim.runCommands(G, true);
    return c;
  };

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
      case "road": r = FSSim.buildRoad(G, a.f1, a.f2, a.path, p); break;
      case "build": r = FSSim.build(G, a.type, a.v, p); break;
      case "demolish": r = FSSim.demolish(G, a.id, p); break;
      case "speed": r = FSSim.setSpeed(G, a.speed); break;
      case "prio": r = FSSim.setTransportPrio(G, p, a.order); break;
      /* ===== PHASE-C/D: geologist, halt, dist, toolPrio, knightSet, attack ===== */
      default: r = { ok: false, why: "unknown command" };
    }
    G.cmdLog++;
    if (!r || !r.ok) event(G, "cmdFail", { cmd: c.type, by: c.by, why: (r && r.why) || "failed", args: a });
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
    /* ===== PHASE-C: production inputs ===== */
    if (def.in && def.in[res]) {
      return Math.max(0, FSC.IN_CAP - (b.stockIn[res] || 0) - (b.reqInFlight[res] || 0));
    }
    return 0;
  };

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

  /** Resolve an item's destination: open request → warehouse → destless (retry later). */
  FSSim.scheduleItem = function (G, flag, item) {
    if (item.dest) { inFlightAdd(G, G.buildings[item.dest], item.res, -1); item.dest = 0; }
    const dest = FSSim.demandNear(G, flag.id, item.res, flag.p)
      || FSSim.warehouseNear(G, flag.id, flag.p);
    if (dest) { item.dest = dest.id; inFlightAdd(G, dest, item.res, 1); }
    else markRetry(G, flag.id);
    return item.dest;
  };

  /** Put a good on a flag. dest undefined → resolve now; 0 → deliberately destless. */
  FSSim.pushItem = function (G, flag, res, dest) {
    if (!flag || flag.slots.length >= FSC.FLAG_CAP) return null;
    const item = { res, dest: 0 };
    flag.slots.push(item);
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
    } else if (def.in && def.in[res]) {
      b.stockIn[res] = (b.stockIn[res] || 0) + 1;   /* ===== PHASE-C: production input ===== */
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

  /* ===================================================================== */
  /* ===== PHASE-B: flags ================================================= */
  /* ===================================================================== */

  FSSim.placeFlag = function (G, v, p) {
    p = p || 0;
    if (!(v >= 0) || v >= G.map.W * G.map.H) return { ok: false, why: "off map" };
    const why = FSMap.whyFlag(G.map, v, p);
    if (why) return { ok: false, why };
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
        const idx = r2.path.indexOf(s.v);
        if (idx >= 0 && r.path.indexOf(s.v) < 0) {
          r.carrier = 0; r.carrierReq = true;
          r2.carrier = s.id; r2.carrierReq = false;
          s.road = r2.id;
        }
        resetCarrier(G, s);
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
    // goods waiting here are lost with the flag (documented deviation: the classic
    // scatters them; losing them keeps the economy honest and the code simple)
    for (let i = 0; i < f.slots.length; i++) {
      const it = f.slots[i];
      inFlightAdd(G, G.buildings[it.dest], it.res, -1);
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
  FSSim.buildRoad = function (G, f1Id, f2Id, path, p) {
    p = p || 0;
    const f1 = flagOf(G, f1Id), f2 = flagOf(G, f2Id);
    if (!f1 || !f2) return { ok: false, why: "no flag" };
    if (f1.id === f2.id) return { ok: false, why: "same flag" };
    if (f1.p !== p || f2.p !== p) return { ok: false, why: "not your flag" };
    if (f1.roads.length >= 6 || f2.roads.length >= 6) return { ok: false, why: "flag is full" };
    if (!path || !path.length) path = FSSim.roadPath(G, f1.v, f2.v, p);
    if (!path || path.length < 2) return { ok: false, why: "no route" };
    if (path[0] !== f1.v || path[path.length - 1] !== f2.v) return { ok: false, why: "path does not join the flags" };
    if (path.length > FSC.ROAD_MAX_LEN + 1) return { ok: false, why: "road too long" };
    for (let i = 0; i + 1 < path.length; i++) {
      const last = i + 2 === path.length;
      const why = FSMap.whyRoadStep(G.map, path[i], path[i + 1], p, { endB: last });
      if (why) return { ok: false, why };
      if (!last && FSMap.edgeCount(G.map, path[i + 1]) > 0) return { ok: false, why: "roads must meet at a flag" };
    }
    // no repeated vertices (a road may not cross itself)
    for (let i = 0; i < path.length; i++) for (let k = i + 1; k < path.length; k++) if (path[i] === path[k]) return { ok: false, why: "path repeats a vertex" };

    const r = { id: newId(G), p, f1: f1.id, f2: f2.id, path: path.slice(), water: false, carrier: 0, carrierReq: true };
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
          const it = { res: s.carry, dest: s.carryDest };
          target.slots.push(it);
          FSSim.scheduleItem(G, target, it);
          event(G, "itemDrop", { serf: s.id, res: s.carry, flag: target.id });
        } else {
          inFlightAdd(G, G.buildings[s.carryDest], s.carry, -1);
          event(G, "itemLost", { res: s.carry, v: s.v, why: "road removed" });
        }
        s.carry = 0; s.carryDest = 0;
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

  function poolTake(G, wh, job) {
    if (!wh.pool) return false;
    if ((wh.pool[job] || 0) > 0) { wh.pool[job]--; syncPoolInv(wh); return true; }
    const tools = FSC.JOB_TOOLS[job] || [];
    if ((wh.pool.generic || 0) <= 0) return false;
    for (let i = 0; i < tools.length; i++) if ((wh.inv[tools[i]] || 0) <= 0) return false;
    wh.pool.generic--;
    for (let i = 0; i < tools.length; i++) wh.inv[tools[i]]--;
    syncPoolInv(wh);
    return true;
  }
  function poolCanTake(G, wh, job) {
    if (!wh.pool) return false;
    if ((wh.pool[job] || 0) > 0) return true;
    if ((wh.pool.generic || 0) <= 0) return false;
    const tools = FSC.JOB_TOOLS[job] || [];
    for (let i = 0; i < tools.length; i++) if ((wh.inv[tools[i]] || 0) <= 0) return false;
    return true;
  }
  function poolPut(G, wh, job) {
    // transporters carry no tool — they melt back into the generic pool
    const j = job === JOB.TRANSPORTER ? JOB.GENERIC : job;
    wh.pool[j] = (wh.pool[j] || 0) + 1;
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
      carry: 0, carryDest: 0,
      home: 0, target: 0, targetFlag: 0,
      congestT: 0, rank: 0,
    };
    G.serfs[s.id] = s;
    return s;
  }

  /** Walk one tick along s.path. Returns true when the path is finished. */
  function walk(G, s) {
    if (!s.path.length) { s.from = s.v; s.to = s.v; s.frac = 0; s.stepT = 0; return true; }
    if (s.to !== s.path[0] || s.from !== s.v) { s.from = s.v; s.to = s.path[0]; s.stepT = 0; }
    s.stepN = s.carry ? FSC.WALK_TICKS_CARRY : (s.offroad ? FSC.WALK_TICKS_OFFROAD : FSC.WALK_TICKS);
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
    if (wh && wh.pool) poolPut(G, wh, s.job);
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
        if (map.bldAt[u] && u !== toV) continue;
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
    requestSerf(G, road.p, JOB.TRANSPORTER, "road", road.id);
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
        if (r && !r.carrier) { alive = true; targetFlag = r.f1; }
      } else {
        const b = G.buildings[q.id];
        if (b && b.flag) {
          alive = (q.job === JOB.DIGGER && b.diggerReq) || (q.job === JOB.BUILDER && b.builderReq)
            || (q.job !== JOB.DIGGER && q.job !== JOB.BUILDER && b.workerReq);
          targetFlag = b.flag;
        }
      }
      if (!alive) { G.serfReqs.splice(i--, 1); continue; }
      const wh = FSSim.warehouseNear(G, targetFlag, q.p, (b) => b.spawnT <= 0 && poolCanTake(G, b, q.job));
      if (!wh) { q.due = G.tick + FSC.SERF_REQ_RETRY_T; continue; }
      const f = flagOf(G, wh.flag);
      if (!f) { q.due = G.tick + FSC.SERF_REQ_RETRY_T; continue; }
      if (!poolTake(G, wh, q.job)) { q.due = G.tick + FSC.SERF_REQ_RETRY_T; continue; }
      const s = makeSerf(G, q.p, q.job, f.v);
      s.home = wh.id;
      wh.spawnT = FSC.SPAWN_GAP;
      event(G, "serfSpawn", { id: s.id, job: s.job, p: s.p, v: s.v, from: wh.id });
      let ok = false;
      if (q.kind === "road") {
        const r = G.roads[q.id];
        r.carrier = s.id; r.carrierReq = false;
        s.road = r.id;
        ok = startCarrierWalk(G, s, r);
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
        poolPut(G, wh, s.job);
        delete G.serfs[s.id];
        q.due = G.tick + FSC.SERF_REQ_RETRY_T;
        continue;
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
        if (!it.dest) continue;
        const b = G.buildings[it.dest];
        if (!b) continue;
        const destFlag = b.flag;
        let handIn = false;
        if (destFlag === f.id) handIn = true;
        else if (FSSim.nextRoad(G, f.id, destFlag) !== r.id) continue;
        const pr = prioIndex(pl, it.res);
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
        s.carry = 0; s.carryDest = 0;
        s.state = "idle";
        return;
      }
      default:
        s.state = "idle";
    }
  }

  function dropCarried(G, s, f) {
    const it = { res: s.carry, dest: s.carryDest };
    f.slots.push(it);
    const b = G.buildings[it.dest];
    // still in flight to the same building — only re-resolve when that broke
    if (!b || (b.flag !== f.id && FSSim.nextRoad(G, f.id, b.flag) === 0)) FSSim.scheduleItem(G, f, it);
    event(G, "itemDrop", { serf: s.id, res: it.res, flag: f.id });
    s.carry = 0; s.carryDest = 0;
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
      if (!r.ok) { delete G.buildings[b.id]; G.map.bldAt[v] = 0; return { ok: false, why: r.why }; }
      f = r.flag;
    }
    f.bld = b.id; b.flag = f.id;
    // clear the footprint (large buildings flatten a 7-vertex pad)
    G.map.obj[v] = FSC.OBJ.NONE; G.map.objArg[v] = 0; dirty(G, v);
    if (def.size >= 2) {
      for (let d = 0; d < 6; d++) {
        const u = FSMap.nbr(G.map, v, d);
        if (u < 0) continue;
        if (G.map.obj[u] !== FSC.OBJ.NONE) { G.map.obj[u] = FSC.OBJ.NONE; G.map.objArg[u] = 0; dirty(G, u); }
      }
    }
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
      /* ===== PHASE-C: production runs here ===== */
      return;
    }
    // crews are requested lazily so a cut-off site simply waits.
    // crewT is a watchdog: a crewman who never made it lets the site ask again.
    if (b.crewT > 0 && !b.crew && --b.crewT === 0) { b.diggerReq = false; b.builderReq = false; }
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
      const need = totalCost(b);
      if (b.matUsed >= need) { finishBuilding(G, b); return; }
      if (!b.crew) return;                         // the builder is the one swinging
      const res = b.matHave.plank > 0 ? "plank" : (b.matHave.stone > 0 ? "stone" : null);
      if (!res) return;                            // waiting on materials — no progress
      b.progress++;
      if (b.progress >= FSC.BUILD_T_PER_MAT) {
        b.progress = 0;
        b.matHave[res]--;
        b.matUsed++;
        if (b.matUsed >= need) finishBuilding(G, b);
      }
    }
  }

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
    if (def.mil) { /* ===== PHASE-D: knights + territory ===== */ }
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
    dropRequest(G, "bld", b.id);
    G.map.bldAt[b.v] = 0;
    delete G.buildings[b.id];
    rescheduleFor(G, b.id);
    event(G, "bldRemoved", { id: b.id, btype: b.type, v: b.v, p: b.p });
    FSSim.recomputeOwner(G);
  }

  FSSim.demolishBuilding = function (G, id) {
    const b = bldOf(G, id);
    if (!b) return { ok: false, why: "no building" };
    if (b.type === "castle") return { ok: false, why: "the castle cannot be torn down" };
    if (b.state === "burn") return { ok: false, why: "already burning" };
    // delivered materials burn with it (the classic refunds nothing)
    b.matHave.plank = 0; b.matHave.stone = 0;
    if (b.worker && G.serfs[b.worker]) { sendHome(G, G.serfs[b.worker]); b.worker = 0; }
    if (b.crew && G.serfs[b.crew]) { sendHome(G, G.serfs[b.crew]); b.crew = 0; }
    b.workerReq = false; b.builderReq = false; b.diggerReq = false;
    b.matInFlight.plank = 0; b.matInFlight.stone = 0;
    dropRequest(G, "bld", b.id);
    setState(G, b, "burn");
    b.burnT = FSC.BURN_T;
    rescheduleFor(G, b.id);
    FSSim.recomputeOwner(G);
    return { ok: true };
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

  function tickWorkerSerf(G, s) {
    switch (s.state) {
      case "goBld": {
        if (!walk(G, s)) return;
        const b = G.buildings[s.target];
        if (!b || b.state === "burn") { sendHome(G, s); return; }
        s.state = "enter"; s.t = FSC.DOOR_T;
        return;
      }
      case "enter": {
        if (--s.t > 0) return;
        const b = G.buildings[s.target];
        if (!b || b.state === "burn") { sendHome(G, s); return; }
        s.v = b.v; s.from = b.v; s.to = b.v; s.frac = 0;
        if (s.job === JOB.DIGGER) {
          b.crew = s.id; b.diggerReq = false; b.crewT = 0;
          setState(G, b, "leveling");
          s.state = "level"; s.t = FSC.LEVEL_T; s.levelStep = 0;
        } else if (s.job === JOB.BUILDER) {
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
        /* ===== PHASE-C: the worker's production cycle runs from the building ===== */
        const b = G.buildings[s.home];
        if (!b || b.state === "burn") { if (b) b.worker = 0; sendHome(G, s); }
        return;
      }
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
   * what to release by FSC.INV_ORDER (warehouse OUTPUT priority — a different list
   * from the flag transport priority). PHASE-C adds full distribution arbitration.
   */
  function warehouseDispatch(G, wh) {
    const f = flagOf(G, wh.flag);
    if (!f || f.slots.length >= FSC.FLAG_CAP) return;
    for (let i = 0; i < FSC.INV_ORDER.length; i++) {
      const res = FSC.INV_ORDER[i];
      if (!wh.inv[res]) continue;
      const d = FSSim.demandNear(G, f.id, res, wh.p, wh.id);
      if (!d) continue;
      wh.inv[res]--;
      FSSim.pushItem(G, f, res, d.id);
      return;
    }
  }

  /** Total people a player owns: walking serfs + everyone resting in warehouses. */
  FSSim.population = function (G, p) {
    let n = 0;
    for (const id in G.serfs) if (G.serfs[id].p === p) n++;
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.pool) continue;
      for (const k in b.pool) n += b.pool[k];
    }
    return n;
  };

  /** New settlers turn up in the castle over time (see FSC.SERF_GROW_T). */
  function tickPopulation(G) {
    for (let p = 0; p < G.players.length; p++) {
      if (((G.tick + p) % FSC.SERF_GROW_T) !== 0) continue;
      const pl = G.players[p];
      if (pl.eliminated) continue;
      const c = FSSim.castleOf(G, p);
      if (!c || c.state !== "done" || !c.pool) continue;
      if (FSSim.population(G, p) >= FSC.SERF_CAP) continue;
      c.pool.generic++;
      syncPoolInv(c);
      event(G, "serfBorn", { p, pool: c.pool.generic });
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
        const b = it.dest && G.buildings[it.dest];
        // keep a destination that is still alive AND still reachable by road
        if (b && (b.flag === f.id || FSSim.hops(G, f.id, b.flag) >= 0)) continue;
        it.dest = 0;
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
      if (s.job === JOB.TRANSPORTER && s.state !== "return") tickCarrier(G, s);
      else tickWorkerSerf(G, s);
    }
    tickRetry(G);

    /* ===== PHASE-C: production (producers, mines, geology, growth) ===== */
    /* ===== PHASE-D: military (garrisons, combat, territory, AI) ===== */
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
      if (b.p !== p || !b.inv) continue;
      for (const k in b.inv) inv[k] = (inv[k] || 0) + b.inv[k];
    }
    return inv;
  };
  FSSim.poolOf = function (G, p) {
    const pool = FSSim.emptyPool();
    for (const id in G.buildings) {
      const b = G.buildings[id];
      if (b.p !== p || !b.pool) continue;
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
    return { buildings, flags, roads, serfs, land, sites, goods, pooled, people: serfs + pooled };
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
    }
    const ss = ids(G.serfs);
    mix(ss.length);
    for (let i = 0; i < ss.length; i++) {
      const s = G.serfs[ss[i]];
      mix(s.id); mix(JOB_IDX[s.job] || 0); mix(SERF_STATE_IDX[s.state] || 0);
      mix(s.v); mix(s.from); mix(s.to); mix(s.stepT); mix(s.path.length);
      mix(RES_IDX[s.carry] || 0); mix(s.carryDest); mix(s.road); mix(s.t);
    }
    return h >>> 0;
  };

  if (typeof window !== "undefined") window.FSSim = FSSim;
  if (typeof module !== "undefined" && module.exports) module.exports = FSSim;
})();
