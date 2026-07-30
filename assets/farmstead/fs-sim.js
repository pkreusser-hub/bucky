/* FARMSTEAD fs-sim.js — game state + tick engine.
 * Sim-safe: NO THREE, NO DOM. Every random draw goes through FSC.rng.
 *
 * PHASE A = STUB. It builds the complete G schema (so nothing has to be reshaped
 * later), places each player's castle + its door flag, paints starting territory
 * and counts ticks. Flags/roads/serfs/production land in Phase B and C at the
 * marked extension points below.
 */
(function () {
  "use strict";

  const FSC = (typeof window !== "undefined" && window.FSC) ? window.FSC
    : (typeof require === "function" ? require("./fs-const.js") : null);
  const FSMap = (typeof window !== "undefined" && window.FSMap) ? window.FSMap
    : (typeof require === "function" ? require("./fs-map.js") : null);

  const FSSim = {};

  // ------------------------------------------------------------------ helpers
  function newId(G) { return G.nextId++; }

  function makePlayer(G, id, isAI) {
    return {
      id,
      name: FSC.PLAYER_NAMES[id] || ("Player " + (id + 1)),
      color: FSC.PLAYER_COLORS[id % FSC.PLAYER_COLORS.length],
      isAI: !!isAI,
      castleId: 0,
      eliminated: false,
      tools: Object.assign({}, FSC.TOOL_PRIO_DEFAULT),
      transportPrio: FSC.RES_ORDER.slice(),
      dist: Object.assign({}, FSC.DIST_DEFAULTS),
      knights: Object.assign({}, FSC.KNIGHT_DEFAULTS),
    };
  }

  function makeStats() {
    return { t: [], goods: [], serfs: [], land: [], military: [] };
  }

  /** Empty inventory with every resource key present (save/load friendly). */
  FSSim.emptyInv = function () {
    const inv = {};
    for (let i = 0; i < FSC.RES_LIST.length; i++) inv[FSC.RES_LIST[i]] = 0;
    inv.serf = 0; inv.knight = 0;
    return inv;
  };

  FSSim.makeFlag = function (G, p, v) {
    const f = { id: newId(G), p, v, slots: [], roads: [], bld: 0 };
    G.flags[f.id] = f;
    G.map.flagAt[v] = f.id;
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
      matReq: { plank: (def.cost && def.cost.plank) || 0, stone: (def.cost && def.cost.stone) || 0 },
      matInFlight: { plank: 0, stone: 0 },
      worker: 0, workerReq: false,
      stockIn: {}, stockOut: {}, reqInFlight: {},
      prodT: 0,
      burnT: 0,
    };
    if (def.mil) b.mil = { knights: [], wanted: 0, gold: 0, goldReq: 0 };
    if (def.mine) b.mine = { kind: def.mine, exhausted: false };
    if (def.warehouse) b.inv = FSSim.emptyInv();
    G.buildings[b.id] = b;
    G.map.bldAt[v] = b.id;
    return b;
  };

  /**
   * Territory: every vertex within radius of an occupied military building belongs
   * to the nearest such building's owner (ties -> lower building id). Phase A only
   * ever calls it for castles; Phase D recomputes on capture/loss.
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

  // --------------------------------------------------------------------- tick
  FSSim.event = function (G, type, data) {
    const e = data ? Object.assign({ t: G.tick, type }, data) : { t: G.tick, type };
    G.events.push(e);
    if (G.events.length > FSC.EVENT_CAP) G.events.splice(0, G.events.length - FSC.EVENT_CAP);
    return e;
  };

  FSSim.notify = function (G, p, text, v) {
    G.notif.push({ t: G.tick, p, text, v: v === undefined ? -1 : v });
    if (G.notif.length > FSC.NOTIF_CAP) G.notif.splice(0, G.notif.length - FSC.NOTIF_CAP);
  };

  /** Exactly one 100 ms game tick. */
  FSSim.tick = function (G) {
    G.tick++;
    /* ===== PHASE-B: transport (flags, roads, carriers, construction) ===== */
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
  FSSim.counts = function (G, p) {
    let buildings = 0, flags = 0, roads = 0, serfs = 0, land = 0;
    for (const id in G.buildings) if (G.buildings[id].p === p) buildings++;
    for (const id in G.flags) if (G.flags[id].p === p) flags++;
    for (const id in G.roads) if (G.roads[id].p === p) roads++;
    for (const id in G.serfs) if (G.serfs[id].p === p) serfs++;
    const owner = G.map.owner;
    for (let i = 0; i < owner.length; i++) if (owner[i] === p) land++;
    return { buildings, flags, roads, serfs, land };
  };
  FSSim.serfsOf = function (G, p) {
    const out = [];
    for (const id in G.serfs) if (G.serfs[id].p === p) out.push(G.serfs[id]);
    return out;
  };

  if (typeof window !== "undefined") window.FSSim = FSSim;
  if (typeof module !== "undefined" && module.exports) module.exports = FSSim;
})();
