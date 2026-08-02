/* FARMSTEAD fs-map.js — triangular lattice math, map generation, terrain validity queries.
 * Sim-safe: NO THREE, NO DOM. Also loads under node (module.exports) for headless tests.
 *
 * Lattice: odd-row offset, 6 neighbours per vertex.
 *   v = r*W + c ; world x = (c + (r&1)*0.5) * TILE ; z = r * TILE * ROW_Z ; y = height[v]
 * Every edge is stored ONCE, on the vertex that owns dirs E / SE / SW (roadAt bits 0..2).
 */
(function () {
  "use strict";

  const FSC = (typeof window !== "undefined" && window.FSC) ? window.FSC
    : (typeof require === "function" ? require("./fs-const.js") : null);

  const T = FSC.TERR, OBJ = FSC.OBJ, MIN = FSC.MINERAL, G = FSC.GEN, ST = FSC.START;
  const ROW_Z = FSC.ROW_Z;

  // ---------------------------------------------------------------- lattice
  const DIR = { E: 0, W: 1, NE: 2, NW: 3, SE: 4, SW: 5 };
  const DIR_NAMES = ["E", "W", "NE", "NW", "SE", "SW"];
  const OPP = [1, 0, 5, 4, 3, 2];            // E<->W, NE<->SW, NW<->SE
  // [dc, dr] per [row parity][dir]
  const OFF = [
    [[1, 0], [-1, 0], [0, -1], [-1, -1], [0, 1], [-1, 1]],   // even row (not shifted)
    [[1, 0], [-1, 0], [1, -1], [0, -1], [1, 1], [0, 1]],     // odd row  (shifted +0.5 x)
  ];
  const EDGE_BIT = [1, 0, 0, 0, 2, 4];       // bit mask for the 3 owned dirs (E, SE, SW)
  const OWNS_EDGE = [true, false, false, false, true, true];

  const FSMap = {};
  FSMap.DIR = DIR;
  FSMap.DIR_NAMES = DIR_NAMES;
  FSMap.OPP = OPP;

  // A single "current" map is bound so callers can use the short spec signatures
  // FSMap.nbr(v,dir) / neighbors(v) / dist(a,b) / worldXZ(v). Every function also
  // accepts an explicit map as its first argument.
  let M = null;
  FSMap.bind = function (map) { M = map; return map; };
  FSMap.bound = function () { return M; };
  function isMap(o) { return !!(o && typeof o === "object" && o.W && o.terr); }

  function dirId(d) {
    if (typeof d === "number") return d;
    const i = DIR_NAMES.indexOf(String(d).toUpperCase());
    return i;
  }
  FSMap.dirId = dirId;

  function rowOf(map, v) { return (v / map.W) | 0; }
  function colOf(map, v) { return v - ((v / map.W) | 0) * map.W; }
  FSMap.row = function (a, b) { const map = isMap(a) ? a : M; const v = isMap(a) ? b : a; return rowOf(map, v); };
  FSMap.col = function (a, b) { const map = isMap(a) ? a : M; const v = isMap(a) ? b : a; return colOf(map, v); };
  FSMap.vertexAt = function (a, b, c) {
    const map = isMap(a) ? a : M, r = isMap(a) ? b : a, cc = isMap(a) ? c : b;
    if (r < 0 || r >= map.H || cc < 0 || cc >= map.W) return -1;
    return r * map.W + cc;
  };

  function nbr(map, v, dir) {
    if (v < 0) return -1;
    const W = map.W, H = map.H;
    const r = (v / W) | 0, c = v - r * W;
    const o = OFF[r & 1][dir];
    const nc = c + o[0], nr = r + o[1];
    if (nc < 0 || nc >= W || nr < 0 || nr >= H) return -1;
    return nr * W + nc;
  }
  FSMap.nbr = function (a, b, c) {
    if (isMap(a)) return nbr(a, b, dirId(c));
    return nbr(M, a, dirId(b));
  };

  /** All 6 neighbours, -1 entries removed (so <6 at the map edge). */
  function neighbors(map, v) {
    const out = [];
    for (let d = 0; d < 6; d++) { const n = nbr(map, v, d); if (n >= 0) out.push(n); }
    return out;
  }
  FSMap.neighbors = function (a, b) { return isMap(a) ? neighbors(a, b) : neighbors(M, a); };
  /** Fixed-length 6 array with -1 for off-map (index === dir). */
  function neighbors6(map, v, out) {
    out = out || new Array(6);
    for (let d = 0; d < 6; d++) out[d] = nbr(map, v, d);
    return out;
  }
  FSMap.neighbors6 = function (a, b, c) { return isMap(a) ? neighbors6(a, b, c) : neighbors6(M, a, b); };

  /** direction index from a to b, or -1 if they are not adjacent. */
  function dirBetween(map, a, b) {
    for (let d = 0; d < 6; d++) if (nbr(map, a, d) === b) return d;
    return -1;
  }
  FSMap.dirBetween = function (a, b, c) { return isMap(a) ? dirBetween(a, b, c) : dirBetween(M, a, b); };
  FSMap.adjacent = function (a, b, c) {
    return (isMap(a) ? dirBetween(a, b, c) : dirBetween(M, a, b)) >= 0;
  };

  // axial coords for the odd-row offset layout: q = c - (r - (r&1))/2 , rr = r
  function axQ(map, v) { const r = (v / map.W) | 0, c = v - r * map.W; return c - ((r - (r & 1)) >> 1); }
  function dist(map, a, b) {
    if (a < 0 || b < 0) return 1e9;
    const ra = (a / map.W) | 0, rb = (b / map.W) | 0;
    const qa = a - ra * map.W - ((ra - (ra & 1)) >> 1);
    const qb = b - rb * map.W - ((rb - (rb & 1)) >> 1);
    const dq = qa - qb, dr = ra - rb;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
  }
  FSMap.dist = function (a, b, c) { return isMap(a) ? dist(a, b, c) : dist(M, a, b); };
  FSMap.axial = function (a, b) { const map = isMap(a) ? a : M, v = isMap(a) ? b : a; return [axQ(map, v), rowOf(map, v)]; };

  function worldXZ(map, v, out) {
    const r = (v / map.W) | 0, c = v - r * map.W;
    out = out || [0, 0];
    out[0] = (c + (r & 1) * 0.5) * FSC.TILE;
    out[1] = r * FSC.TILE * ROW_Z;
    return out;
  }
  FSMap.worldXZ = function (a, b, c) { return isMap(a) ? worldXZ(a, b, c) : worldXZ(M, a, b); };
  FSMap.worldY = function (a, b) { const map = isMap(a) ? a : M, v = isMap(a) ? b : a; return map.height[v]; };

  /** Nearest lattice vertex to a world (x,z). Used by picking. */
  function nearestVertex(map, x, z) {
    const rf = z / (FSC.TILE * ROW_Z);
    let best = -1, bd = Infinity;
    const p = [0, 0];
    for (let dr = -1; dr <= 2; dr++) {
      const r = Math.floor(rf) + dr;
      if (r < 0 || r >= map.H) continue;
      const cf = x / FSC.TILE - (r & 1) * 0.5;
      for (let dc = -1; dc <= 2; dc++) {
        const c = Math.floor(cf) + dc;
        if (c < 0 || c >= map.W) continue;
        const v = r * map.W + c;
        worldXZ(map, v, p);
        const d = (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z);
        if (d < bd) { bd = d; best = v; }
      }
    }
    return best;
  }
  FSMap.nearestVertex = function (a, b, c, d) {
    return isMap(a) ? nearestVertex(a, b, c, d) : nearestVertex(M, a, b, c);
  };

  /** Visit every vertex within lattice distance R of v. cb(u, d). */
  function forRadius(map, v, R, cb) {
    const W = map.W, H = map.H;
    const r0 = (v / W) | 0, c0 = v - r0 * W;
    const rlo = Math.max(0, r0 - R), rhi = Math.min(H - 1, r0 + R);
    const pad = R + (R >> 1) + 1;
    const clo = Math.max(0, c0 - pad), chi = Math.min(W - 1, c0 + pad);
    for (let r = rlo; r <= rhi; r++) {
      for (let c = clo; c <= chi; c++) {
        const u = r * W + c;
        const d = dist(map, v, u);
        if (d <= R) cb(u, d);
      }
    }
  }
  FSMap.forRadius = function (a, b, c, d) { return isMap(a) ? forRadius(a, b, c, d) : forRadius(M, a, b, c); };

  FSMap.heightSpread = function (a, b, c) {
    const map = isMap(a) ? a : M, v = isMap(a) ? b : a, R = isMap(a) ? c : b;
    let lo = Infinity, hi = -Infinity;
    forRadius(map, v, R === undefined ? 1 : R, (u) => {
      const h = map.height[u]; if (h < lo) lo = h; if (h > hi) hi = h;
    });
    return hi - lo;
  };

  // ------------------------------------------------------------ edge bitmask
  function edgeUsed(map, a, b) {
    let d = dirBetween(map, a, b);
    if (d < 0) return false;
    if (OWNS_EDGE[d]) return (map.roadAt[a] & EDGE_BIT[d]) !== 0;
    d = OPP[d];
    return (map.roadAt[b] & EDGE_BIT[d]) !== 0;
  }
  FSMap.edgeUsed = function (a, b, c) { return isMap(a) ? edgeUsed(a, b, c) : edgeUsed(M, a, b); };

  function setEdge(map, a, b, used) {
    let d = dirBetween(map, a, b);
    if (d < 0) return false;
    let owner = a;
    if (!OWNS_EDGE[d]) { owner = b; d = OPP[d]; }
    if (used) map.roadAt[owner] |= EDGE_BIT[d];
    else map.roadAt[owner] &= ~EDGE_BIT[d];
    return true;
  }
  FSMap.setEdge = function (a, b, c, d) { return isMap(a) ? setEdge(a, b, c, d) : setEdge(M, a, b, c); };

  /** Count of road edges touching v (0..6). */
  FSMap.edgeCount = function (a, b) {
    const map = isMap(a) ? a : M, v = isMap(a) ? b : a;
    let n = 0;
    for (let d = 0; d < 6; d++) { const u = nbr(map, v, d); if (u >= 0 && edgeUsed(map, v, u)) n++; }
    return n;
  };

  // ------------------------------------------------------- terrain predicates
  FSMap.isWater = function (t) { return t === T.WATER; };
  FSMap.isLand = function (t) { return t !== T.WATER; };
  FSMap.walkable = function (t) { return t === T.GRASS || t === T.DESERT || t === T.SWAMP || t === T.MOUNTAIN; };
  FSMap.flaggable = function (t) { return t === T.GRASS || t === T.DESERT || t === T.MOUNTAIN; };
  /** an object that physically blocks a flag/building/road vertex */
  FSMap.objBlocks = function (o) { return o !== OBJ.NONE && o !== OBJ.FIELD_STUB; };
  /* ═══ CONSTRUCTION CLEARS WOOD (2026-08-01, playtest §3) ══════════════════
   * The tree family — every growth stage, a forester's fresh sapling and a
   * woodcutter's stump — is *clearable*: it no longer refuses a road, a flag or
   * a building, and the construction that lands on it removes it (fs-sim's
   * `clearWood`). Stone piles and standing crops are NOT clearable: a stone is
   * the stonecutter's whole economy and a field belongs to a farm, so both keep
   * blocking exactly as before.
   * Fidelity note (farmstead-plan §14.13): the ORIGINAL let roads run straight
   * THROUGH standing trees (its `is_road_segment_valid` only refuses
   * SpaceSemipassable and up; a tree is SpaceFilled) and refused flags and
   * buildings on them. We allow all three and fell the tree — see the plan. */
  FSMap.clearableObj = function (o) {
    return (o >= OBJ.TREE1 && o <= OBJ.TREE4) || o === OBJ.STUMP || o === OBJ.SAPLING;
  };
  /** does this object refuse construction? (i.e. blocks and cannot be felled) */
  FSMap.objRefuses = function (o) { return FSMap.objBlocks(o) && !FSMap.clearableObj(o); };
  FSMap.isTree = function (o) { return o >= OBJ.TREE1 && o <= OBJ.TREE4; };
  FSMap.isStone = function (o) { return o >= OBJ.STONE1 && o <= OBJ.STONE4; };
  FSMap.isField = function (o) { return o >= OBJ.FIELD0 && o <= OBJ.FIELD4; };
  /** deterministic per-vertex tree species (0 pine, 1 broadleaf, 2 autumn) — derived, never stored */
  FSMap.species = function (v) {
    const h = (Math.imul(v ^ 0x9e3779b9, 2654435761) >>> 9) % 100;
    return h < 52 ? 0 : (h < 82 ? 1 : 2);
  };

  // --------------------------------------------------------------- generation
  function fade(t) { return t * t * (3 - 2 * t); }
  function smoothstep(e0, e1, x) {
    let t = (x - e0) / (e1 - e0);
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return t * t * (3 - 2 * t);
  }
  function noiseGrid(gw, gh) {
    const g = new Float32Array((gw + 1) * (gh + 1));
    for (let i = 0; i < g.length; i++) g[i] = FSC.rng();
    return g;
  }
  function sampleGrid(g, gw, gh, u, v) {
    const x = u * gw, y = v * gh;
    let x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 > gw - 1) x0 = gw - 1; if (x0 < 0) x0 = 0;
    if (y0 > gh - 1) y0 = gh - 1; if (y0 < 0) y0 = 0;
    const fx = fade(x - x0), fy = fade(y - y0);
    const row = gw + 1;
    const a = g[y0 * row + x0], b = g[y0 * row + x0 + 1];
    const c = g[(y0 + 1) * row + x0], d = g[(y0 + 1) * row + x0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  /**
   * Flatten a field to a ~uniform 0..1 distribution (empirical CDF, linearly
   * interpolated inside each bin so the result stays smooth — a plain binned
   * remap terraces the heightfield). Without this, summed value-noise is bell
   * shaped and every threshold lands in a tail.
   */
  function normalizeField(a) {
    const N = a.length, BINS = 512;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < N; i++) { const x = a[i]; if (x < lo) lo = x; if (x > hi) hi = x; }
    if (!(hi > lo)) return a;
    const s = (BINS - 1) / (hi - lo);
    const hist = new Int32Array(BINS);
    for (let i = 0; i < N; i++) hist[((a[i] - lo) * s) | 0]++;
    const cdf = new Float32Array(BINS + 1);
    let acc = 0;
    for (let b = 0; b < BINS; b++) { cdf[b] = acc / N; acc += hist[b]; }
    cdf[BINS] = 1;
    for (let i = 0; i < N; i++) {
      const x = (a[i] - lo) * s;
      let b = x | 0; if (b > BINS - 1) b = BINS - 1;
      const fr = x - b;
      a[i] = cdf[b] * (1 - fr) + cdf[b + 1] * fr;
    }
    return a;
  }
  FSMap.normalizeField = normalizeField;

  function fbm(W, H, octaves, baseCells, persist) {
    const out = new Float32Array(W * H);
    let amp = 1, tot = 0, cells = baseCells;
    for (let o = 0; o < octaves; o++) {
      const g = noiseGrid(cells, cells);
      for (let r = 0; r < H; r++) {
        const v = r / (H - 1);
        const base = r * W;
        for (let c = 0; c < W; c++) out[base + c] += amp * sampleGrid(g, cells, cells, c / (W - 1), v);
      }
      tot += amp; amp *= persist; cells *= 2;
    }
    const inv = 1 / tot;
    for (let i = 0; i < out.length; i++) out[i] *= inv;
    return normalizeField(out);
  }
  FSMap._fbm = fbm;

  /**
   * Blur the heightfield. The plains get the full weight (they have to stay
   * buildable and road-friendly); the high ground keeps its shape but no longer
   * keeps its cliffs — `wMin` is a smoothing FLOOR that applies at any altitude.
   *
   * That floor is the whole answer to "mines are hard to place" (playtest
   * 2026-08-01): a mine needs a road to its door and a road step may not exceed
   * FSC.S_ROAD, so a rugged peak is decoration, not terrain. Smoothing the
   * mountains costs nothing visually at this scale and roughly doubles the
   * mountain surface a road can actually reach.
   */
  function smoothLowland(map, passes, wMax, wMin) {
    const N = map.W * map.H;
    const tmp = new Float32Array(N);
    const hi = G.PLAIN_H * 1.5, lo = G.PLAIN_H * 0.55;
    const floor = wMin || 0;
    for (let p = 0; p < passes; p++) {
      for (let v = 0; v < N; v++) {
        let sum = 0, cnt = 0;
        for (let d = 0; d < 6; d++) { const u = nbr(map, v, d); if (u >= 0) { sum += map.height[u]; cnt++; } }
        const avg = cnt ? sum / cnt : map.height[v];
        let w = wMax * (1 - smoothstep(lo, hi, map.height[v]));
        if (w < floor) w = floor;
        tmp[v] = map.height[v] * (1 - w) + avg * w;
      }
      map.height.set(tmp);
    }
  }

  /** normalized fBm value -> world height (gentle plains, steep mountains, deep sea) */
  function shapeHeight(n) {
    if (n <= G.WATER_N) return (n - G.WATER_N) * G.DEEP_H;
    if (n <= G.MOUNT_N) return (n - G.WATER_N) / (G.MOUNT_N - G.WATER_N) * G.PLAIN_H;
    return G.PLAIN_H + (n - G.MOUNT_N) / (1 - G.MOUNT_N) * G.MOUNT_H;
  }

  /** multi-source BFS distance field (steps), capped at `cap`. */
  function distField(map, seeds, cap) {
    const N = map.W * map.H;
    const d = new Uint8Array(N).fill(255);
    let frontier = [];
    for (let i = 0; i < seeds.length; i++) { d[seeds[i]] = 0; frontier.push(seeds[i]); }
    let step = 0;
    while (frontier.length && step < cap) {
      step++;
      const next = [];
      for (let i = 0; i < frontier.length; i++) {
        const v = frontier[i];
        for (let dd = 0; dd < 6; dd++) {
          const u = nbr(map, v, dd);
          if (u >= 0 && d[u] === 255) { d[u] = step; next.push(u); }
        }
      }
      frontier = next;
    }
    return d;
  }
  FSMap.distField = distField;

  /**
   * distField restricted to ground a ROAD could follow (walkable, and no step
   * over FSC.S_ROAD). Crow-flies distance happily walks across a lake, so it
   * answers "is there a mountain over there" when the question is "can my
   * miners get to one".
   */
  function distFieldRoad(map, seeds, cap) {
    const N = map.W * map.H;
    const d = new Uint8Array(N).fill(255);
    let frontier = [];
    for (let i = 0; i < seeds.length; i++) { d[seeds[i]] = 0; frontier.push(seeds[i]); }
    let step = 0;
    while (frontier.length && step < cap) {
      step++;
      const next = [];
      for (let i = 0; i < frontier.length; i++) {
        const v = frontier[i];
        for (let dd = 0; dd < 6; dd++) {
          const u = nbr(map, v, dd);
          if (u < 0 || d[u] !== 255) continue;
          if (!FSMap.walkable(map.terr[u])) continue;
          if (Math.abs(map.height[u] - map.height[v]) > FSC.S_ROAD) continue;
          d[u] = step; next.push(u);
        }
      }
      frontier = next;
    }
    return d;
  }
  FSMap.distFieldRoad = distFieldRoad;

  /**
   * FSMap.generate({seed, size, players}) — the whole world.
   * `size` may be 'small'|'medium'|'large' or a vertex count per side.
   */
  FSMap.generate = function (opts) {
    opts = opts || {};
    const size = typeof opts.size === "number" ? opts.size
      : (FSC.MAP_SIZES[opts.size || "medium"] || FSC.MAP_SIZES.medium);
    const seed = (opts.seed >>> 0) || 1;
    const players = Math.max(1, Math.min(4, opts.players || 4));
    FSC.reseed(seed);

    const W = size, H = size, N = W * H;
    const map = {
      W, H, seed, size, players,
      height: new Float32Array(N),
      terr: new Uint8Array(N),
      obj: new Uint8Array(N),
      objArg: new Uint8Array(N),
      mineral: new Uint8Array(N),
      mineralAmt: new Uint8Array(N),
      fish: new Uint8Array(N),
      sign: new Uint8Array(N),
      owner: new Int8Array(N),
      flagAt: new Int32Array(N),
      bldAt: new Int32Array(N),
      bldFoot: new Int32Array(N),   // building BODY vertices (see footprintOf)
      roadAt: new Uint8Array(N),
      starts: [],
    };
    map.owner.fill(-1);

    // ---- heightfield + island falloff -------------------------------------
    const hf = fbm(W, H, G.OCTAVES, G.BASE_CELLS, G.PERSIST);
    const moist = fbm(W, H, 3, 4, 0.55);
    const forest = fbm(W, H, 3, 4, 0.55);
    const rocky = fbm(W, H, 3, 5, 0.5);

    for (let r = 0; r < H; r++) {
      const vv = r / (H - 1);
      for (let c = 0; c < W; c++) {
        const i = r * W + c;
        const u = c / (W - 1);
        const edge = Math.min(Math.min(u, 1 - u) * 2, Math.min(vv, 1 - vv) * 2);
        const dx = (u - 0.5) * 2, dz = (vv - 0.5) * 2;
        const rad = Math.sqrt(dx * dx + dz * dz);
        // island bowl: full-height interior, sea carved in towards the border/corners
        const f = smoothstep(G.EDGE_0, G.EDGE_1, edge) * (1 - smoothstep(G.RAD_0, G.RAD_1, rad));
        let n = hf[i] - (1 - f) * G.SEA_BOWL;
        const bx = Math.min(c, W - 1 - c), bz = Math.min(r, H - 1 - r);
        if (Math.min(bx, bz) < G.BORDER) n = -0.5;   // hard deep-water ring
        map.height[i] = shapeHeight(n);
      }
    }

    // Altitude-weighted smoothing: plains roll gently (buildable, road-friendly)
    // while mountains keep their high-frequency ruggedness.
    smoothLowland(map, G.SMOOTH_PASSES, G.SMOOTH_W, G.SMOOTH_W_MOUNT);
    const deep = shapeHeight(-0.5);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (Math.min(r, c, H - 1 - r, W - 1 - c) < G.BORDER) map.height[r * W + c] = deep;
      }
    }

    // ---- terrain classes ---------------------------------------------------
    for (let i = 0; i < N; i++) {
      const y = map.height[i];
      let t;
      if (y < FSC.WATER_Y) t = T.WATER;
      else if (y > G.SNOW_Y) t = T.SNOW;
      else if (y > G.MOUNTAIN_Y) t = T.MOUNTAIN;
      else {
        const m = moist[i];
        if (y < G.SWAMP_Y && m > G.SWAMP_MOIST) t = T.SWAMP;
        else if (y > G.DESERT_Y && m < G.DESERT_MOIST) t = T.DESERT;
        else t = T.GRASS;
      }
      map.terr[i] = t;
    }

    // distance fields used by the rest of generation (not stored on the map)
    const waterSeeds = [], mountSeeds = [];
    for (let i = 0; i < N; i++) {
      if (map.terr[i] === T.WATER) waterSeeds.push(i);
      else if (map.terr[i] === T.MOUNTAIN) mountSeeds.push(i);
    }
    const waterDist = distField(map, waterSeeds, 12);
    const mountDist = distField(map, mountSeeds, Math.max(30, ST.MOUNTAIN_MAX + 4));
    /* "A mountain within reach" is not the same promise as "somewhere I can
     * sink a mine": a peak whose whole skirt is water or snow-doored is
     * scenery. The start scorer measures distance to MINABLE rock instead, and
     * that one change removes the pathological start with no ore at all —
     * which was the single largest source of unfairness between kingdoms. */
    /* WIDE land share, in O(1) per vertex via a summed-area table. The site
     * scorer's own grass/land test covers ST.R_AREA (6) — big enough to know
     * a castle fits, far too small to notice that the whole PENINSULA is 16
     * steps of coastline. Measured, that was what made one kingdom in four
     * open on two-thirds of its neighbours' buildable ground, and no amount of
     * clutter-balancing can hand a start land it does not have. */
    const sat = new Int32Array((W + 1) * (H + 1));
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const land = map.terr[r * W + c] !== T.WATER ? 1 : 0;
        sat[(r + 1) * (W + 1) + c + 1] = land + sat[r * (W + 1) + c + 1]
          + sat[(r + 1) * (W + 1) + c] - sat[r * (W + 1) + c];
      }
    }
    const RW = ST.WIDE_R, RH = Math.round(ST.WIDE_R * 0.62);   // rows are ~0.866 apart
    const wideLand = new Float32Array(N);
    for (let r = 0; r < H; r++) {
      const r0 = Math.max(0, r - RH), r1 = Math.min(H - 1, r + RH);
      for (let c = 0; c < W; c++) {
        const c0 = Math.max(0, c - RW), c1 = Math.min(W - 1, c + RW);
        const tot = (r1 - r0 + 1) * (c1 - c0 + 1);
        const s = sat[(r1 + 1) * (W + 1) + c1 + 1] - sat[r0 * (W + 1) + c1 + 1]
          - sat[(r1 + 1) * (W + 1) + c0] + sat[r0 * (W + 1) + c0];
        wideLand[r * W + c] = s / tot;
      }
    }

    const mineSeeds = [];
    for (let i = 0; i < N; i++) if (map.terr[i] === T.MOUNTAIN && mineGround(map, i)) mineSeeds.push(i);
    const mineDist = distFieldRoad(map, mineSeeds.length ? mineSeeds : mountSeeds,
      Math.max(30, ST.MOUNTAIN_MAX + 4));

    // ---- underground minerals (ringed clusters under mountains only) --------
    // Confirmed original shape: a cluster is `rings` concentric rings, ring j holding
    // STEP×(rings−j) ore (so 20 at the heart of the richest ones); a richer neighbour
    // never gets overwritten. Coal is by far the commonest, gold the rarest.
    const mw = G.MINERAL_W, kinds = ["STONE", "COAL", "IRON", "GOLD"];
    let wsum = 0; kinds.forEach((k) => (wsum += mw[k]));
    const RING_LO = G.MINERAL_RINGS[0], RING_HI = G.MINERAL_RINGS[1];
    for (let s = 0; s < mountSeeds.length; s++) {
      const v = mountSeeds[s];
      if (FSC.rng() > G.MINERAL_BLOB_P) continue;
      let roll = FSC.rng() * wsum, kind = kinds[0];
      for (let k = 0; k < kinds.length; k++) { roll -= mw[kinds[k]]; if (roll <= 0) { kind = kinds[k]; break; } }
      const code = MIN[kind];
      const rings = RING_LO + FSC.rngInt(RING_HI - RING_LO + 1);
      forRadius(map, v, rings - 1, (u, d) => {
        if (map.terr[u] !== T.MOUNTAIN) return;
        let amt = G.MINERAL_STEP * (rings - d);
        if (amt > 20) amt = 20;
        if (amt <= 0) return;
        if (amt > map.mineralAmt[u]) { map.mineralAmt[u] = amt; map.mineral[u] = code; }
      });
    }

    // ---- surface objects: trees + stone piles (grass only) -----------------
    const stageW = G.TREE_STAGE_W;
    for (let i = 0; i < N; i++) {
      if (map.terr[i] !== T.GRASS) continue;
      const f = forest[i];
      if (f > G.FOREST_T) {
        const p = (f - G.FOREST_T) / (1 - G.FOREST_T) * G.FOREST_P;
        if (FSC.rng() < p) {
          let roll = FSC.rng(), st = 4;
          for (let k = 0; k < 4; k++) { roll -= stageW[k]; if (roll <= 0) { st = k + 1; break; } }
          map.obj[i] = OBJ.TREE1 + (st - 1);
          map.objArg[i] = st < 4 ? FSC.rngInt(200) : 0;
          continue;
        }
      }
      const near = mountDist[i] <= G.ROCK_NEAR_MOUNT ? 1.6 : 1.0;
      if (rocky[i] > G.ROCK_T) {
        const p = (rocky[i] - G.ROCK_T) / (1 - G.ROCK_T) * G.ROCK_P * near;
        if (FSC.rng() < p) setStone(map, i, 1 + FSC.rngInt(8));
      }
    }

    // ---- fish (every water vertex, 0..7 — confirmed original rng & 7) -------
    for (let i = 0; i < N; i++) {
      if (map.terr[i] !== T.WATER) continue;
      map.fish[i] = FSC.rngInt(G.FISH_MAX + 1);
    }

    // ---- fair start sites --------------------------------------------------
    map.starts = findStartSites(map, players, { waterDist, mountDist, mineDist, wideLand });
    for (let i = 0; i < map.starts.length; i++) topUpStart(map, map.starts[i]);
    balanceStarts(map);

    return map;
  };

  function setStone(map, v, charges) {
    charges = Math.max(1, Math.min(8, charges | 0));
    map.obj[v] = OBJ.STONE1 + Math.min(3, Math.floor((charges - 1) / 2));
    map.objArg[v] = charges;
  }
  FSMap.setStone = function (a, b, c) { return isMap(a) ? setStone(a, b, c) : setStone(M, a, b); };

  // -------------------------------------------------------------- start sites
  /**
   * Score one candidate castle site. `tier` relaxes the SOFT requirements only —
   * the HARD ones (grass, castle-flat, solid ring, a usable door vertex) are never
   * relaxed, so a start site can always actually hold a castle.
   * Returns a score (higher = better) or null when the site is unusable.
   */
  function scoreSite(map, v, fields, tier) {
    const terr = map.terr;
    // ---- hard requirements ----
    if (terr[v] !== T.GRASS) return null;
    if (FSMap.heightSpread(map, v, 1) > FSC.S_LARGE) return null;
    for (let d = 0; d < 6; d++) {
      const u = nbr(map, v, d);
      if (u < 0 || terr[u] === T.WATER || terr[u] === T.SNOW) return null;
    }
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    if (door < 0 || !FSMap.flaggable(terr[door])) return null;
    if (fields.waterDist[v] < 2) return null;
    // HARD: enough road-reachable land from the castle door — a start boxed in by
    // forest + slope is unplayable (clearing trees needs a lumberjack, a lumberjack
    // needs a road). Never relaxed by tier.
    if (!reachOK(map, v, door)) return null;

    let grass = 0, land = 0, tot = 0, lo = Infinity, hi = -Infinity;
    forRadius(map, v, ST.R_AREA, (u) => {
      tot++;
      const t = terr[u];
      if (t === T.GRASS) grass++;
      if (t !== T.WATER) land++;
      const h = map.height[u]; if (h < lo) lo = h; if (h > hi) hi = h;
    });
    const gf = grass / tot, lf = land / tot, spread = hi - lo;
    if (tier <= 5 && (gf < ST.GRASS_FLOOR || lf < ST.LAND_FLOOR)) return null;

    let trees = 0, stones = 0;
    forRadius(map, v, ST.STONES_R, (u, d) => {
      const o = map.obj[u];
      if (FSMap.isTree(o)) { if (d <= ST.TREES_R) trees++; }
      else if (FSMap.isStone(o)) stones++;
    });
    const mineD = fields.mineDist ? fields.mineDist[v] : fields.mountDist[v];
    const wide = fields.wideLand ? fields.wideLand[v] : lf;
    const score = gf * 100 + lf * 40 + wide * 60 + Math.min(trees, 20) * 1.5 + Math.min(stones, 10) * 2
      - spread * 6 - FSMap.heightSpread(map, v, 1) * 10 - Math.min(mineD, 40) * 0.6;
    if (tier >= 5) return score;          // tiers 5/6: hard requirements only

    // ---- soft requirements (relaxed as `tier` rises) ----
    if (fields.waterDist[v] < Math.max(2, ST.WATER_CLEAR - tier)) return null;
    if (tier < 4 && mineD > ST.MOUNTAIN_MAX) return null;
    if (wide < ST.WIDE_LAND_FRAC - tier * 0.06) return null;
    if (gf < ST.GRASS_FRAC - tier * 0.08) return null;
    if (lf < ST.LAND_FRAC - tier * 0.06) return null;
    if (spread > ST.SPREAD_AREA * (1 + tier * 0.3)) return null;
    if (tier < 2 && trees < ST.TREES_MIN) return null;
    if (tier < 2 && stones < ST.STONES_MIN) return null;
    return score;
  }
  FSMap.scoreSite = scoreSite;

  /**
   * Deterministic bounded BFS from a prospective castle's door: counts vertices a
   * road network could actually reach (walkable terrain, road-legal slope, not
   * object-blocked — objects on the castle footprint/door are treated clear because
   * the fairness top-up removes them). Early-exits at ST.REACH_MIN.
   */
  function reachOK(map, site, door) {
    const need = ST.REACH_MIN, cap = ST.REACH_CAP;
    const seen = new Set([door]);
    const q = [door];
    let count = 1;
    while (q.length && count < need && seen.size < cap) {
      const cur = q.shift();
      for (let d = 0; d < 6; d++) {
        const u = nbr(map, cur, d);
        if (u < 0 || seen.has(u)) continue;
        const t = map.terr[u];
        if (!FSMap.walkable(t)) continue;
        if (Math.abs(map.height[u] - map.height[cur]) > FSC.S_ROAD) continue;
        if (FSMap.objBlocks(map.obj[u]) && dist(map, site, u) > 1 && u !== door) continue;
        seen.add(u); q.push(u); count++;
        if (count >= need) return true;
      }
    }
    return count >= need;
  }
  FSMap.reachOK = reachOK;

  /** best-scoring sites that are all at least `sep` apart, else null */
  function greedyPick(map, cands, n, sep) {
    const chosen = [];
    for (let i = 0; i < cands.length && chosen.length < n; i++) {
      const v = cands[i][0];
      let ok = true;
      for (let k = 0; k < chosen.length; k++) if (dist(map, v, chosen[k]) < sep) { ok = false; break; }
      if (ok) chosen.push(v);
    }
    return chosen.length === n ? chosen : null;
  }

  /** farthest-point sampling: always returns n sites, as spread out as the map allows */
  function spreadPick(map, cands, n) {
    if (cands.length < n) return null;
    const chosen = [cands[0][0]];
    while (chosen.length < n) {
      let best = -1, bestD = -1, bestS = -Infinity;
      for (let i = 0; i < cands.length; i++) {
        const v = cands[i][0];
        let md = Infinity;
        for (let k = 0; k < chosen.length; k++) { const d = dist(map, v, chosen[k]); if (d < md) md = d; }
        if (md > bestD || (md === bestD && cands[i][1] > bestS)) { bestD = md; bestS = cands[i][1]; best = v; }
      }
      if (best < 0) return null;
      chosen.push(best);
    }
    return chosen;
  }

  /**
   * n fair, well-separated start sites. Deterministic. Quality tier is relaxed
   * first, separation only afterwards; the last tiers keep only the HARD
   * requirements so a castle is always placeable on whatever comes back.
   */
  function findStartSites(map, n, fields) {
    const W = map.W, H = map.H;
    const tiers = [];
    function candsFor(tier) {
      if (tiers[tier]) return tiers[tier];
      const out = [];
      for (let r = 2; r < H - 2; r++) {
        for (let c = 2; c < W - 2; c++) {
          const v = r * W + c;
          const s = scoreSite(map, v, fields, tier);
          if (s !== null) out.push([v, s]);
        }
      }
      out.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]));
      tiers[tier] = out;
      return out;
    }
    function minPair(sites) {
      let md = Infinity;
      for (let i = 0; i < sites.length; i++)
        for (let j = i + 1; j < sites.length; j++) md = Math.min(md, dist(map, sites[i], sites[j]));
      return md;
    }
    const sep0 = Math.round(W * (ST.SEP_FRAC[n] || 0.46));
    const hardFloor = Math.max(4, Math.round(W * ST.SEP_HARD_FLOOR));
    for (let pass = 0; pass < ST.SEP_PASSES; pass++) {
      const floor = Math.max(4, Math.round(W * (ST.SEP_FLOOR_FRAC - pass * ST.SEP_FLOOR_STEP)));
      for (let tier = 0; tier <= 6; tier++) {
        const cands = candsFor(tier);
        if (cands.length < n) continue;
        /* Farthest-point sampling MAXIMISES the smallest gap by construction, so
         * it is weighed at every rung of the ladder — not, as it used to be,
         * only once the whole ladder had failed. A candidate pool that clusters
         * around the best-scoring corner used to walk all the way down to the
         * floor and hand back castles a dozen steps apart; now the spread set
         * wins the moment greedy stops clearing the same bar. Greedy still goes
         * first at each rung, because when both reach a separation the greedy
         * one is made of higher-scoring ground. */
        const sp = spreadPick(map, cands, n);
        const spMd = sp ? minPair(sp) : -1;
        let sep = sep0;
        while (sep >= floor) {
          const pick = greedyPick(map, cands, n, sep);
          if (pick) { map.startTier = tier; return pick; }
          if (spMd >= sep) { map.startTier = tier; return sp; }
          sep = Math.min(sep - 1, Math.round(sep * ST.SEP_RELAX));
        }
        if (sp && (spMd >= hardFloor || (pass === ST.SEP_PASSES - 1 && tier === 6))) {
          map.startTier = tier; return sp;
        }
      }
    }
    // desperation (should be unreachable): spread whatever grass exists
    const grass = [];
    for (let v = 0; v < W * H; v++) if (map.terr[v] === T.GRASS) grass.push(v);
    const out = [];
    for (let i = 0; i < n; i++) out.push(grass.length ? grass[Math.floor((i + 0.5) * grass.length / n)] : 0);
    map.startTier = -1;
    return out;
  }
  FSMap.findStartSites = findStartSites;

  /**
   * The ground a castle stands on and the ground its first road needs: the
   * footprint, and TWO rings around the door flag.
   *
   * The doorstep matters more than it looks. Building bodies are solid now
   * (see FSMap.footprintOf), and that quietly took away the road's usual way
   * out — the cleared castle RING was the corridor every opening road escaped
   * through. Measured on seed 4242, the door was left with four road-reachable
   * vertices in total: a start that cannot build anything at all.
   */
  function clearCastleGround(map, v) {
    forRadius(map, v, ST.CLEAR_R, (u) => { map.obj[u] = OBJ.NONE; map.objArg[u] = 0; });
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    if (door >= 0) forRadius(map, door, ST.DOORSTEP_R, (u) => { map.obj[u] = OBJ.NONE; map.objArg[u] = 0; });
  }

  /**
   * The start must still be PLAYABLE after the trees go in.
   *
   * scoreSite's reachOK gate runs on raw terrain, before topUpStart and
   * balanceStarts plant anything — so a start that passed with 60 road-legal
   * vertices can end up walled into a dozen by its own fairness thicket, and a
   * kingdom that cannot get a road out of its gate cannot build at all. This
   * walks the road-legal region out from the door and, while it is too small,
   * clears the OBJECTS on its frontier (nearest the door first, deterministic
   * order). Terrain is never touched: a start hemmed in by rock and water is a
   * hard map, not a broken one, and the loop simply stops when it runs out of
   * clutter to remove.
   */
  /** could a small building stand here? (whyBuilding minus owner and flags) */
  function plotOK(map, v) {
    if (map.terr[v] !== T.GRASS) return false;
    if (FSMap.objBlocks(map.obj[v]) || map.flagAt[v] || bldBlocked(map, v)) return false;
    for (let d = 0; d < 6; d++) {
      const u = nbr(map, v, d);
      if (u < 0 || map.terr[u] === T.WATER || map.terr[u] === T.SNOW) return false;
    }
    if (FSMap.heightSpread(map, v, 1) > FSC.S_SMALL) return false;
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    return door >= 0 && FSMap.flaggable(map.terr[door]);
  }

  function openCastleApproach(map, site, cleared) {
    const door = nbr(map, site, DIR[FSC.DOOR_DIR]);
    if (door < 0) return cleared || new Set();
    cleared = cleared || new Set();
    const need = ST.REACH_MIN;
    for (let round = 0; round < ST.APPROACH_ROUNDS; round++) {
      const seen = new Set([door]);
      const q = [door];
      let qi = 0;
      const frontier = [];
      let plots = 0;
      while (qi < q.length && seen.size < need * 3) {
        const cur = q[qi++];
        for (let d = 0; d < 6; d++) {
          const u = nbr(map, cur, d);
          if (u < 0 || seen.has(u)) continue;
          if (!FSMap.walkable(map.terr[u])) continue;
          if (Math.abs(map.height[u] - map.height[cur]) > FSC.S_ROAD) continue;
          if (FSMap.objBlocks(map.obj[u])) { frontier.push(u); continue; }
          seen.add(u); q.push(u);
          if (dist(map, site, u) >= 3 && plotOK(map, u)) plots++;
        }
      }
      /* Room to WALK is not room to BUILD. A start topped up to a neighbour's
       * wood budget can end up with a wall of trees where its first woodcutter
       * should go — measured, one kingdom on seed 42/large came out of the
       * balancer with a single legal plot in its whole territory. */
      if ((seen.size >= need && plots >= ST.PLOTS_MIN) || !frontier.length) return cleared;
      frontier.sort((a, b) => (dist(map, door, a) - dist(map, door, b)) || (a - b));
      const cut = Math.min(frontier.length, ST.APPROACH_CUT);
      for (let k = 0; k < cut; k++) {
        map.obj[frontier[k]] = OBJ.NONE; map.objArg[frontier[k]] = 0;
        cleared.add(frontier[k]);
      }
    }
    return cleared;
  }
  FSMap.openCastleApproach = function (a, b) {
    return isMap(a) ? openCastleApproach(a, b) : openCastleApproach(M, a);
  };

  /** Fairness top-up: guarantee wood + stone in reach, and clear the castle footprint. */
  function topUpStart(map, v) {
    let trees = 0, stones = 0, free = [];
    const R0 = Math.max(ST.TOPUP_TREE_R, ST.TOPUP_STONE_R);
    // widen the search if the neighbourhood is short of free grass (cramped sites)
    for (let R = R0; R <= R0 + 8; R += 4) {
      trees = 0; stones = 0; free = [];
      forRadius(map, v, R, (u, d) => {
        const o = map.obj[u];
        if (FSMap.isTree(o)) { if (d <= ST.TOPUP_TREE_R) trees++; }
        else if (FSMap.isStone(o)) { if (d <= ST.TOPUP_STONE_R) stones++; }
        else if (o === OBJ.NONE && map.terr[u] === T.GRASS && d >= 2) free.push([u, d]);
      });
      if (free.length >= ST.TOPUP_TREES + ST.TOPUP_STONES) break;
    }
    free.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));   // nearest first
    // deterministic scatter: a stride-k permutation keeps the plantings spread out
    // over the distance ordering instead of packing a solid ring round the castle.
    function scatter(list, k) {
      const out = [];
      for (let s = 0; s < k; s++) for (let j = s; j < list.length; j += k) out.push(list[j][0]);
      return out;
    }
    const treeList = scatter(free.filter((e) => e[1] <= ST.TOPUP_TREE_R), 3);
    for (let i = 0; i < treeList.length && trees < ST.TOPUP_TREES; i++) {
      const u = treeList[i];
      if (map.obj[u] !== OBJ.NONE) continue;
      map.obj[u] = OBJ.TREE4; map.objArg[u] = 0; trees++;
    }
    const stoneList = scatter(free.filter((e) => e[1] >= 3), 5);
    for (let i = 0; i < stoneList.length && stones < ST.TOPUP_STONES; i++) {
      const u = stoneList[i];
      if (map.obj[u] !== OBJ.NONE) continue;
      setStone(map, u, 4 + FSC.rngInt(5)); stones++;
    }
    clearCastleGround(map, v);
  }
  FSMap.topUpStart = function (a, b) { return isMap(a) ? topUpStart(a, b) : topUpStart(M, a); };

  /* ===================================================================== */
  /* ===== FAIR STARTS (playtest 2026-08-01) ============================== */
  /* ===================================================================== */
  /*
   * topUpStart guarantees a FLOOR — every start gets some wood and some stone.
   * It says nothing about the neighbour who opened on twice as much, and the
   * measured spread was brutal: reachable ore differed by 74% of the mean
   * across the four starts of an average map, mine sites by 52%.
   *
   * balanceStarts closes that. It measures what each start can actually REACH
   * (road-legal ground out of its own door — the same rule reachOK uses, so a
   * seam on the far side of a cliff is honestly counted as absent), picks a
   * common target per resource, then tops the poor up and trims the rich back
   * to a tolerance band. It is NOT a mirror: the band (ST.BAL_TOL) is wide
   * enough that maps stay organic, and the target is the middle of the four,
   * not the best of them, so the balancing never inflates the whole map.
   */

  /** Road-legal ground reachable from a start's door, bounded. Set of vertices. */
  function reachSet(map, site, cap) {
    const door = nbr(map, site, DIR[FSC.DOOR_DIR]);
    const seen = new Set();
    if (door < 0) return seen;
    seen.add(door);
    const q = [door];
    let qi = 0;
    while (qi < q.length && seen.size < cap) {
      const cur = q[qi++];
      for (let d = 0; d < 6; d++) {
        const u = nbr(map, cur, d);
        if (u < 0 || seen.has(u)) continue;
        if (!FSMap.walkable(map.terr[u])) continue;
        if (Math.abs(map.height[u] - map.height[cur]) > FSC.S_ROAD) continue;
        seen.add(u); q.push(u);
      }
    }
    return seen;
  }
  FSMap.reachSet = function (a, b, c) { return isMap(a) ? reachSet(a, b, c) : reachSet(M, a, b); };

  /** Could a mine stand here? (terrain half of whyBuilding — no owner, no flags) */
  function mineGround(map, v) {
    if (map.terr[v] !== T.MOUNTAIN) return false;
    for (let d = 0; d < 6; d++) {
      const u = nbr(map, v, d);
      if (u < 0 || map.terr[u] === T.WATER) return false;
    }
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    return door >= 0 && FSMap.flaggable(map.terr[door]);
  }
  FSMap.mineGround = function (a, b) { return isMap(a) ? mineGround(a, b) : mineGround(M, a); };

  /**
   * Whose ground is this? Nearest start wins, lowest index breaks the tie.
   * Budgets are measured over OWNED ground only: with castles ~22 steps apart
   * and an ore radius of 26 the neighbourhoods overlap heavily, and counting a
   * shared seam for both starts (then balancing both against it) makes the
   * whole thing chase its own tail — one start's top-up silently inflates the
   * next one's reading. Disjoint regions converge in a single pass.
   */
  function ownsVertex(map, starts, i, u) {
    const dMe = dist(map, starts[i], u);
    for (let k = 0; k < starts.length; k++) {
      if (k === i) continue;
      const d = dist(map, starts[k], u);
      if (d < dMe || (d === dMe && k < i)) return false;
    }
    return true;
  }

  /**
   * What one start opens on. Each resource is counted over the ground this
   * start can actually REACH, inside the radius that resource is worked from,
   * and (when `starts` is supplied) on its own side of the map — balancing a
   * seam twenty steps past anything a miner would walk to is not fairness, it
   * is noise. `trees` counts wood, `stone` counts CHARGES (a pile of 8 is worth
   * four piles of 2), `ore` counts buried amount on ground a mine could really
   * stand on. `open` is reported, never balanced: it is a property of the site
   * the scorer already selects for.
   */
  function startBudget(map, site, starts, idx) {
    const reach = reachSet(map, site, ST.BAL_REACH);
    const mine = starts && starts.length > 1
      ? (u) => ownsVertex(map, starts, idx, u) : () => true;
    let open = 0, trees = 0, stone = 0, ore = 0, mineSpots = 0;
    let shOre = 0, shSpots = 0;          // …the same, ignoring who is nearer
    reach.forEach((u) => {
      const o = map.obj[u], d = dist(map, site, u);
      /* d < 2 is the castle's own footprint — it is cleared at generation and
       * nothing can be built there, so counting it as a mine site (which it
       * was, when the ring happened to be rock) hid a start with no ore behind
       * a spot count of 1. */
      if (d < 2 || (d > ST.BAL_ORE_R && d > ST.BAL_TREE_R && d > ST.BAL_STONE_R)) return;
      const owned = mine(u);
      if (d <= ST.BAL_ORE_R && mineGround(map, u)) {
        shSpots++; shOre += map.mineralAmt[u];
        if (owned) { mineSpots++; ore += map.mineralAmt[u]; }
      }
      /* SURFACE resources are NOT ownership-scoped. A woodcutter's world is 12
       * steps wide and castles stand 22+ apart, so two starts' wood discs
       * barely touch — while the ownership filter punished a start hemmed
       * against a neighbour twice, once by giving it less ground and again by
       * refusing to top up what ground it had. Ore keeps the filter: its
       * radius is 26 and those discs really do overlap. */
      if (d <= ST.BAL_OPEN_R && map.terr[u] === T.GRASS && !FSMap.objBlocks(o)) open++;
      if (FSMap.isTree(o)) { if (d <= ST.BAL_TREE_R) trees++; }
      else if (FSMap.isStone(o)) { if (d <= ST.BAL_STONE_R) stone += map.objArg[u] || 1; }
      if (!owned) return;
    });
    /* A start hemmed in against a neighbour can own no minable rock at all
     * (measured on 1 start in 8). It will still mine the seam it SHARES, so
     * that is what its ore budget honestly is — and reporting 0 would send the
     * balancer digging new mountains that no player would ever reach first. */
    const shared = mineSpots === 0 && shSpots > 0;
    return {
      reach, owns: mine, open, trees, stone,
      ore: shared ? shOre : ore, mineSpots: shared ? shSpots : mineSpots, shared,
    };
  }
  FSMap.startBudget = function (a, b, c, d) {
    return isMap(a) ? startBudget(a, b, c, d) : startBudget(M, a, b, c);
  };

  /**
   * The target every start is moved toward: the UPPER middle of the four, with
   * a floor. Upper-middle rather than the median because the balancer should
   * mostly LIFT — trimming is what makes a map feel sterile — and the floor is
   * whatever topUpStart already guarantees, so a poor map can never level the
   * whole field down below its own opening promise.
   */
  function midOf(vals, floor) {
    const s = vals.slice().sort((a, b) => a - b);
    const m = s[s.length >> 1];
    return Math.max(m, floor || 0);
  }

  /* ===================================================================== */
  /* ===== GUARANTEED START ORE (playtest 2026-08-02) ===================== */
  /* ===================================================================== */
  /*
   * balanceStarts equalises how MUCH ore a kingdom opens with. The economy does
   * not care how much — it cares WHICH. Coal and iron together are the whole
   * steel chain, and steel is the only source of tools, and a tool is the only
   * way a generic settler becomes anything at all; a start that opens with a
   * fat gold seam and no coal is finished before it begins, and nothing on
   * screen tells the player why. So each start is checked for the ore it needs
   * INSIDE ST.MOUNTAIN_MAX road steps of its own door — the same "close" the
   * site scorer uses — and handed one where its own hills came up empty.
   *
   * The cheap fix is preferred and is what normally happens: RE-KIND a seam
   * that is already near home. That costs the start's ore budget exactly
   * nothing, so it cannot re-break the fairness band the balancer just set.
   * Fresh ore is only invented for a start with no near seam at all.
   *
   * Everything here is deterministic: BFS in fixed neighbour order, candidate
   * lists sorted on (road steps, vertex index), and the only FSC.rng draw is
   * the ring count of a seam that has to be created from nothing — the same
   * draw the balancer's own ore top-up already makes.
   */

  /** road-legal step count from a start's DOOR, -1 where a road cannot reach. */
  function reachDist(map, site, cap) {
    const N = map.W * map.H;
    const d = new Int32Array(N).fill(-1);
    const door = nbr(map, site, DIR[FSC.DOOR_DIR]);
    if (door < 0) return d;
    d[door] = 0;
    const q = [door];
    let qi = 0, seen = 1;
    while (qi < q.length && seen < cap) {
      const cur = q[qi++];
      for (let dd = 0; dd < 6; dd++) {
        const u = nbr(map, cur, dd);
        if (u < 0 || d[u] >= 0) continue;
        if (!FSMap.walkable(map.terr[u])) continue;
        if (Math.abs(map.height[u] - map.height[cur]) > FSC.S_ROAD) continue;
        d[u] = d[cur] + 1; q.push(u); seen++;
      }
    }
    return d;
  }
  FSMap.reachDist = function (a, b, c) { return isMap(a) ? reachDist(a, b, c) : reachDist(M, a, b); };

  /** the connected run of one mineral kind through mountain ground (bounded). */
  function seamOf(map, v, cap) {
    const code = map.mineral[v];
    const out = [v];
    const seen = new Set([v]);
    for (let i = 0; i < out.length && out.length < cap; i++) {
      const cur = out[i];
      for (let d = 0; d < 6; d++) {
        const u = nbr(map, cur, d);
        if (u < 0 || seen.has(u)) continue;
        if (map.terr[u] !== T.MOUNTAIN || map.mineral[u] !== code || !map.mineralAmt[u]) continue;
        seen.add(u); out.push(u);
      }
    }
    return out;
  }
  const SEAM_CAP = 48;

  /**
   * Make sure `site` opens with every ore its economy needs, close to home.
   * `guarded` collects every vertex the guarantee depends on so the balancer's
   * ore TRIM cannot quietly undo it. Returns a per-kind report.
   */
  function guaranteeStartOre(map, site, guarded) {
    const dists = reachDist(map, site, ST.BAL_REACH);
    const doorStep = (v) => { const dr = nbr(map, v, DIR[FSC.DOOR_DIR]); return dr >= 0 ? dists[dr] : -1; };
    const N = map.W * map.H;
    const near = [], mid = [], far = [];
    for (let v = 0; v < N; v++) {
      if (map.terr[v] !== T.MOUNTAIN || !mineGround(map, v)) continue;
      const s = doorStep(v);
      if (s < 0) continue;
      far.push([v, s]);                                  // anything a road can reach at all
      if (s <= ST.GUAR_FAR) mid.push([v, s]);
      if (s <= ST.MOUNTAIN_MAX) near.push([v, s]);
    }
    const byStep = (a, b) => (a[1] - b[1]) || (a[0] - b[0]);
    near.sort(byStep); mid.sort(byStep); far.sort(byStep);
    const wanted = ST.GUAR_ORE.concat(ST.GUAR_ORE_SOFT);
    const report = {};

    function satisfier(pool, kind) {
      const code = MIN[kind];
      for (let i = 0; i < pool.length; i++) {
        const v = pool[i][0];
        if (map.mineral[v] === code && map.mineralAmt[v] >= ST.GUAR_MIN_AMT) return pool[i];
      }
      return null;
    }
    function protect(v) { seamOf(map, v, SEAM_CAP).forEach((u) => guarded.add(u)); }

    /* PASS 1 — protect what is already there, BEFORE anything is converted.
     * Without this, granting the first missing kind could eat the very seam
     * that was going to satisfy the second one. */
    const satisfied = {};
    for (let i = 0; i < wanted.length; i++) {
      const hit = satisfier(near, wanted[i]);
      if (hit) { satisfied[wanted[i]] = hit[1]; protect(hit[0]); report[wanted[i]] = { had: true, steps: hit[1] }; }
    }

    // PASS 2 — grant the rest.
    for (let i = 0; i < wanted.length; i++) {
      const kind = wanted[i];
      if (satisfied[kind] !== undefined) continue;
      const code = MIN[kind];
      let done = null;
      /* (a) re-kind the nearest seam nobody else is relying on — costs no ore.
       * (b) failing that, plant a fresh seam on the nearest bare rock.
       * The LADDER IS BY DISTANCE, not by strategy: both moves are tried inside
       * the near ring before either is allowed to look further out. Ordering it
       * the other way round (all re-kinds, then all seeds) measurably pushed
       * iron out to 28 road steps on boards that had bare rock 10 steps from
       * the gate — every near seam was already spoken for, so the re-kind pass
       * walked off across the map before the seed pass ever ran. */
      for (const pool of [near, mid, far]) {
        for (let k = 0; k < pool.length && !done; k++) {
          const v = pool[k][0];
          if (!map.mineralAmt[v] || guarded.has(v)) continue;
          const seam = seamOf(map, v, SEAM_CAP);
          if (seam.some((u) => guarded.has(u))) continue;
          for (let s = 0; s < seam.length; s++) { map.mineral[seam[s]] = code; guarded.add(seam[s]); }
          /* a one-vertex crumb of a seam is not a mine anybody would sink —
           * bring the head of it up to the bar (the only ore this path adds) */
          if (map.mineralAmt[v] < ST.GUAR_MIN_AMT) map.mineralAmt[v] = ST.GUAR_MIN_AMT;
          done = { steps: pool[k][1], how: "rekind" };
        }
        for (let k = 0; k < pool.length && !done; k++) {
          const v = pool[k][0];
          if (map.mineralAmt[v] || guarded.has(v)) continue;
          const rings = ST.GUAR_SEAM_RINGS[0] + FSC.rngInt(ST.GUAR_SEAM_RINGS[1] - ST.GUAR_SEAM_RINGS[0] + 1);
          forRadius(map, v, rings - 1, (w, d) => {
            if (map.terr[w] !== T.MOUNTAIN) return;
            let amt = G.MINERAL_STEP * (rings - d);
            if (amt > 20) amt = 20;
            if (amt <= 0 || amt <= map.mineralAmt[w]) return;
            map.mineralAmt[w] = amt; map.mineral[w] = code; guarded.add(w);
          });
          if (map.mineralAmt[v] < ST.GUAR_MIN_AMT) { map.mineralAmt[v] = ST.GUAR_MIN_AMT; map.mineral[v] = code; }
          done = { steps: pool[k][1], how: "seed" };
        }
        if (done) break;
      }
      report[kind] = done
        ? { had: false, steps: done.steps, how: done.how }
        : { had: false, steps: -1, how: "none" };   // no minable rock a road can reach at all
    }
    return report;
  }
  FSMap.guaranteeStartOre = function (a, b, c) {
    return isMap(a) ? guaranteeStartOre(a, b, c || new Set()) : guaranteeStartOre(M, a, b || new Set());
  };

  /** deterministic candidate list inside a start's reach, nearest first.
   *  `owned` mirrors how the matching budget was counted (ore only). */
  function candidates(map, site, budget, R, test, owned, dMin) {
    const out = [];
    budget.reach.forEach((u) => {
      const d = dist(map, site, u);
      if (d < (dMin || 2) || d > R) return;
      if (owned && !budget.owns(u)) return;
      if (test(u)) out.push([u, d]);
    });
    out.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    return out;
  }
  /** stride-k permutation: keeps plantings spread over the distance ordering */
  function scatterList(list, k) {
    const out = [];
    for (let s = 0; s < k; s++) for (let j = s; j < list.length; j += k) out.push(list[j]);
    return out;
  }

  function balanceStarts(map) {
    const starts = map.starts;
    if (!starts || starts.length < 2) return null;
    /* Open the approaches BEFORE measuring. openCastleApproach removes clutter
     * to make a walled-in start playable, and doing that AFTER the balancing
     * silently un-balances it again — measured, wood spread went 0.21 → 0.33
     * purely because the cleared corridors came out of one start's budget. */
    /* The corridor each opener cut is REMEMBERED but deliberately NOT banned
     * from planting. Banning it was tried and measured WORSE: on a hemmed-in
     * start the cleared corridor IS most of its free ground, so refusing to
     * plant there left the poorest start with nothing at all (stone 0 against
     * a target of 28) where planting and letting the final sweep re-cut the
     * few blocking vertices left it with some. */
    const corridor = starts.map((v) => openCastleApproach(map, v));
    /* The ore GUARANTEE runs before the budgets are read, so what it grants is
     * part of "the map as it was generated" and the totals are balanced around
     * it rather than against it. `guarded` is the set of vertices the guarantee
     * now depends on; the ore trim below skips them. */
    const guarded = new Set();
    const guarantee = starts.map((v) => guaranteeStartOre(map, v, guarded));
    const before = starts.map((v, i) => startBudget(map, v, starts, i));
    const tol = 1 + ST.BAL_TOL;
    /* CLUTTER DENSITY CAP. Lifting a bare start to a forested neighbour's wood
     * budget can bury it: r12 holds ~470 vertices and the raw target on one
     * measured board was 200 trees, which left that kingdom one legal building
     * plot. Wood and stone are capped as a SHARE of the ground they sit on —
     * a start below the cap is still lifted to it, and the trim side is
     * unaffected, so this only ever prevents over-planting. */
    const disc = (R) => 3 * R * (R + 1) + 1;
    const capTree = Math.round(disc(ST.BAL_TREE_R) * ST.BAL_TREE_MAX_FRAC);
    const capStone = Math.round(disc(ST.BAL_STONE_R) * ST.BAL_STONE_MAX_FRAC);
    const tTree = Math.min(midOf(before.map((b) => b.trees), ST.TOPUP_TREES), capTree);
    const tStone = Math.min(midOf(before.map((b) => b.stone), ST.TOPUP_STONES * 4), capStone);
    const tOre = midOf(before.map((b) => b.ore), ST.BAL_ORE_MIN);

    for (let i = 0; i < starts.length; i++) {
      const site = starts[i];
      /* Re-measure rather than reuse `before`: regions are disjoint, but a
       * planted tree still has to be seen by the pass that plants it. The
       * TARGETS stay fixed — they describe the map as it was generated. */
      const b = startBudget(map, site, starts, i);

      // ---- wood ----------------------------------------------------------
      /* Plantings keep clear of the castle's own apron (BAL_CORE_R). Nearest-
       * first candidates used to drop a thicket right across the corridor the
       * approach-opener had just cleared, so the opener cut it out again on
       * the next sweep and the poorest start ended BELOW its target — measured
       * on seed 2, wood 51 against a target of 68 and stone 7 against 28. */
      if (b.trees < tTree) {
        const free = scatterList(candidates(map, site, b, ST.BAL_TREE_R,
          (u) => map.terr[u] === T.GRASS && map.obj[u] === OBJ.NONE, false, ST.BAL_CORE_R), 3);
        let add = Math.min(tTree - b.trees, ST.BAL_MAX_ADD);
        for (let k = 0; k < free.length && add > 0; k++) {
          const u = free[k][0];
          if (map.obj[u] !== OBJ.NONE) continue;
          map.obj[u] = OBJ.TREE4; map.objArg[u] = 0; add--;
        }
      } else if (b.trees > tTree * tol) {
        /* Thin the FAR side of the wood — what a woodcutter walks to first
         * stays. Trimming has to happen inside the SAME radius the budget was
         * counted over, or it destroys map content without moving the number
         * it is trying to move. */
        const far = candidates(map, site, b, ST.BAL_TREE_R, (u) => FSMap.isTree(map.obj[u]));
        far.reverse();
        let cut = b.trees - Math.round(tTree * tol);
        for (let k = 0; k < far.length && cut > 0; k++) {
          const u = far[k][0];
          if (dist(map, site, u) <= ST.BAL_CORE_R) continue;   // never touch the home grove
          map.obj[u] = OBJ.NONE; map.objArg[u] = 0; cut--;
        }
      }

      // ---- stone ---------------------------------------------------------
      if (b.stone < tStone) {
        const free = scatterList(candidates(map, site, b, ST.BAL_STONE_R,
          (u) => map.terr[u] === T.GRASS && map.obj[u] === OBJ.NONE, false, ST.BAL_CORE_R), 5);
        let add = Math.min(tStone - b.stone, ST.BAL_MAX_ADD);
        for (let k = 0; k < free.length && add > 0; k++) {
          const u = free[k][0];
          if (map.obj[u] !== OBJ.NONE) continue;
          const charges = Math.min(8, Math.max(1, add > 8 ? 4 + FSC.rngInt(5) : add));
          setStone(map, u, charges); add -= charges;
        }
      } else if (b.stone > tStone * tol) {
        const far = candidates(map, site, b, ST.BAL_STONE_R, (u) => FSMap.isStone(map.obj[u]));
        far.reverse();
        let cut = b.stone - Math.round(tStone * tol);
        for (let k = 0; k < far.length && cut > 0; k++) {
          const u = far[k][0];
          if (dist(map, site, u) <= ST.BAL_CORE_R) continue;
          cut -= map.objArg[u] || 1;
          map.obj[u] = OBJ.NONE; map.objArg[u] = 0;
        }
      }

      // ---- ore -----------------------------------------------------------
      // Seams are added as the generator's own ringed clusters so a balanced
      // deposit is indistinguishable from a natural one; they land on the
      // emptiest minable rock in reach, farthest first (a start short of ore is
      // short of it near home too, and a walk to the seam is the game).
      if (b.ore < tOre) {
        let rock = candidates(map, site, b, ST.BAL_ORE_R,
          (u) => mineGround(map, u) && !map.mineralAmt[u], true);
        if (!rock.length) {
          /* A start hemmed in against a neighbour can own no bare rock at all
           * (measured: one start in eight owns none). Fall back to rock it
           * SHARES — a contested seam is still a mine, and having none is the
           * one outcome the balancer exists to prevent. */
          const all = [];
          b.reach.forEach((u) => {
            const d = dist(map, site, u);
            if (d < 2 || d > ST.BAL_ORE_R || map.mineralAmt[u]) return;
            if (mineGround(map, u)) all.push([u, d]);
          });
          all.sort((a2, b2) => (a2[1] - b2[1]) || (a2[0] - b2[0]));
          rock = all;
        }
        let add = Math.min(tOre - b.ore, ST.BAL_MAX_ADD * 8);
        const kinds = ["COAL", "IRON", "STONE", "GOLD"];
        let ki = 0;
        for (let k = 0; k < rock.length && add > 0; k += 3) {
          const u = rock[k][0];
          if (map.mineralAmt[u]) continue;
          const rings = ST.BAL_ORE_RINGS[0] + FSC.rngInt(ST.BAL_ORE_RINGS[1] - ST.BAL_ORE_RINGS[0] + 1);
          const code = MIN[kinds[ki++ % kinds.length]];
          forRadius(map, u, rings - 1, (w, d) => {
            if (map.terr[w] !== T.MOUNTAIN) return;
            let amt = G.MINERAL_STEP * (rings - d);
            if (amt > 20) amt = 20;
            if (amt <= 0 || amt <= map.mineralAmt[w]) return;
            add -= amt - map.mineralAmt[w];
            map.mineralAmt[w] = amt; map.mineral[w] = code;
          });
        }
        /* Bare rock can run out before the shortfall does — a start wedged
         * against a neighbour may only see seams that are already claimed.
         * Deepen those instead: the same ground, richer, which is what a lean
         * mountain looks like when it is the only one you have. */
        if (add > 0) {
          const seams = [];
          b.reach.forEach((u) => {
            const d = dist(map, site, u);
            if (d < 2 || d > ST.BAL_ORE_R) return;
            if (map.mineralAmt[u] > 0 && map.mineralAmt[u] < 20 && mineGround(map, u)) seams.push([u, d]);
          });
          seams.sort((a2, b2) => (a2[1] - b2[1]) || (a2[0] - b2[0]));
          for (let k = 0; k < seams.length && add > 0; k++) {
            const u = seams[k][0];
            const gain = 20 - map.mineralAmt[u];
            map.mineralAmt[u] = 20; add -= gain;
          }
        }
      } else if (b.ore > tOre * tol) {
        const rich = candidates(map, site, b, ST.BAL_ORE_R,
          (u) => mineGround(map, u) && map.mineralAmt[u] > 0 && !guarded.has(u), true);
        rich.reverse();
        let cut = b.ore - Math.round(tOre * tol);
        for (let k = 0; k < rich.length && cut > 0; k++) {
          const u = rich[k][0];
          cut -= map.mineralAmt[u];
          map.mineralAmt[u] = 0; map.mineral[u] = MIN.NONE;
        }
      }
    }
    // the footprint and the doorstep have to stay clear after any planting…
    for (let i = 0; i < starts.length; i++) clearCastleGround(map, starts[i]);
    /* …and a start must still be able to BUILD. This second sweep is normally
     * a no-op (the density cap keeps planting well under what would re-close a
     * corridor); when it does fire, playability wins over the last few
     * percent of parity. */
    for (let i = 0; i < starts.length; i++) openCastleApproach(map, starts[i], corridor[i]);
    map.startBalance = { tTree, tStone, tOre, guarantee };
    return map.startBalance;
  }
  FSMap.balanceStarts = function (a) { return balanceStarts(isMap(a) ? a : M); };

  FSMap.doorVertex = function (a, b) {
    const map = isMap(a) ? a : M, v = isMap(a) ? b : a;
    return nbr(map, v, DIR[FSC.DOOR_DIR]);
  };

  /* ===================================================================== */
  /* ===== BUILDING FOOTPRINTS (playtest 2026-08-01) ====================== */
  /* ===================================================================== */
  /*
   * `map.bldAt` marks the ONE vertex a building is anchored on. A castle is
   * seven vertices of masonry, so five of its six ring vertices were, to every
   * pathfinder in the game, open meadow — and settlers walked straight through
   * the great hall. `map.bldFoot` marks the rest of the body: the ring of a
   * size-2 building, minus its DOOR (which carries the flag every road and
   * every delivery has to reach, and is drawn outside the walls).
   *
   * It is derived state — rebuilt from G.buildings whenever a save is loaded —
   * but it is stored, because the alternative is six neighbour lookups per A*
   * expansion in the hot path of every walk in the game.
   */
  function footprintOf(map, type, v) {
    const def = FSC.BLD[type];
    const out = [];
    if (!def || def.size < 2) return out;          // small buildings + mines: the anchor only
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    for (let d = 0; d < 6; d++) {
      const u = nbr(map, v, d);
      if (u < 0 || u === door) continue;
      /* Ground already carrying a flag or a road is GRANDFATHERED: the
       * building is placed around it and that vertex stays walkable. Rejecting
       * the placement instead would forbid building alongside your own roads,
       * which is most of the game. */
      if (map.flagAt[u] || FSMap.edgeCount(map, u) > 0) continue;
      out.push(u);
    }
    return out;
  }
  FSMap.footprintOf = function (a, b, c) {
    return isMap(a) ? footprintOf(a, b, c) : footprintOf(M, a, b);
  };
  /** Is this vertex physically occupied by a building (anchor OR body)? */
  function bldBlocked(map, v) {
    return !!(map.bldAt[v] || (map.bldFoot && map.bldFoot[v]));
  }
  FSMap.bldBlocked = function (a, b) { return isMap(a) ? bldBlocked(a, b) : bldBlocked(M, a); };
  /** id of the building occupying v, anchor or body (0 = none) */
  FSMap.bldBodyAt = function (a, b) {
    const map = isMap(a) ? a : M, v = isMap(a) ? b : a;
    return map.bldAt[v] || (map.bldFoot ? map.bldFoot[v] : 0);
  };

  // ---------------------------------------------------------- validity queries
  /**
   * canPlaceFlag(v, p) — own land, flaggable terrain, nothing blocking,
   * no flag on an adjacent vertex, not a building vertex.
   */
  function whyFlag(map, v, p) {
    if (v < 0 || v >= map.W * map.H) return "off map";
    if (!FSMap.flaggable(map.terr[v])) return "terrain";
    if (map.owner[v] !== p) return "not your land";
    if (FSMap.objRefuses(map.obj[v])) return "blocked";   // trees are felled, not refused
    if (map.flagAt[v]) return "flag here";
    if (bldBlocked(map, v)) return "building here";
    for (let d = 0; d < 6; d++) {
      const u = nbr(map, v, d);
      if (u >= 0 && map.flagAt[u]) return "flag too close";
    }
    return null;
  }
  FSMap.whyFlag = function (a, b, c) { return isMap(a) ? whyFlag(a, b, c) : whyFlag(M, a, b); };
  FSMap.canPlaceFlag = function (a, b, c) {
    return (isMap(a) ? whyFlag(a, b, c) : whyFlag(M, a, b)) === null;
  };

  /**
   * canPlaceBuilding(type, v, p) — own land, terrain fits (mines need MOUNTAIN, the rest
   * GRASS), slope inside the footprint, footprint ring clear of other buildings (min
   * distance 2) and of water, and the SE door vertex is flaggable or already our flag.
   */
  function whyBuilding(map, type, v, p) {
    const def = FSC.BLD[type];
    if (!def) return "unknown building";
    if (v < 0 || v >= map.W * map.H) return "off map";
    if (map.owner[v] !== p) return "not your land";
    const t = map.terr[v];
    if (def.mountain) { if (t !== T.MOUNTAIN) return "mines need mountain"; }
    else if (t !== T.GRASS) return "needs grass";
    if (map.flagAt[v]) return "flag here";
    if (bldBlocked(map, v)) return "building here";
    if (FSMap.objRefuses(map.obj[v])) return "blocked";   // trees are felled, not refused

    // footprint ring must exist and be solid ground
    for (let d = 0; d < 6; d++) {
      const u = nbr(map, v, d);
      if (u < 0) return "map edge";
      if (map.terr[u] === T.WATER) return "water too close";
      if (!def.mountain && map.terr[u] === T.SNOW) return "snow too close";
    }
    // no other building within 2 lattice steps
    let clash = false;
    forRadius(map, v, 2, (u) => { if (u !== v && map.bldAt[u]) clash = true; });
    if (clash) return "too close to another building";

    if (!def.mountain) {
      const spread = FSMap.heightSpread(map, v, 1);
      const lim = def.size === 0 ? FSC.S_SMALL : FSC.S_LARGE;
      if (spread > lim) return "ground too steep";
    }
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    if (door < 0) return "no room for the flag";
    if (map.flagAt[door]) {
      if (map.owner[door] !== p) return "flag is not yours";
    } else if (whyFlag(map, door, p) !== null) return "no room for the flag";
    return null;
  }
  FSMap.whyBuilding = function (a, b, c, d) { return isMap(a) ? whyBuilding(a, b, c, d) : whyBuilding(M, a, b, c); };
  FSMap.canPlaceBuilding = function (a, b, c, d) {
    return (isMap(a) ? whyBuilding(a, b, c, d) : whyBuilding(M, a, b, c)) === null;
  };

  /**
   * canBuildRoadStep(a, b, p, opts) — one lattice step of a road.
   * opts: { endB:true when b is the road's far endpoint (a flag may sit there),
   *         water:true for a boat road (water vertices allowed) }
   */
  function whyRoadStep(map, a, b, p, opts) {
    opts = opts || {};
    if (dirBetween(map, a, b) < 0) return "not adjacent";
    if (edgeUsed(map, a, b)) return "already a road";
    const tb = map.terr[b], ta = map.terr[a];
    const wet = opts.water === true;
    if (wet) {
      if (!(FSMap.walkable(tb) || tb === T.WATER)) return "terrain";
      if (!(FSMap.walkable(ta) || ta === T.WATER)) return "terrain";
    } else {
      if (!FSMap.walkable(tb) || !FSMap.walkable(ta)) return "terrain";
      if (Math.abs(map.height[b] - map.height[a]) > FSC.S_ROAD) return "too steep";
    }
    if (map.owner[b] !== p || map.owner[a] !== p) return "not your land";
    if (bldBlocked(map, b)) return "building in the way";
    if (FSMap.objRefuses(map.obj[b])) return "blocked";   // trees are felled, not refused
    if (map.flagAt[b] && !opts.endB) return "flag in the way";
    return null;
  }
  FSMap.whyRoadStep = function (a, b, c, d, e) {
    return isMap(a) ? whyRoadStep(a, b, c, d, e) : whyRoadStep(M, a, b, c, d);
  };
  FSMap.canBuildRoadStep = function (a, b, c, d, e) {
    return (isMap(a) ? whyRoadStep(a, b, c, d, e) : whyRoadStep(M, a, b, c, d)) === null;
  };

  // ------------------------------------------------------------------- hashing
  /** FNV-1a over the static + object layers — determinism checks in the suites. */
  FSMap.hash = function (a) {
    const map = isMap(a) ? a : M;
    let h = 0x811c9dc5 >>> 0;
    function mix(x) { h ^= x & 0xff; h = Math.imul(h, 0x01000193) >>> 0; }
    const N = map.W * map.H;
    mix(map.W); mix(map.H);
    for (let i = 0; i < N; i++) {
      const q = Math.round(map.height[i] * 64);
      mix(q); mix(q >> 8); mix(q >> 16);
      mix(map.terr[i]); mix(map.obj[i]); mix(map.objArg[i]);
      mix(map.mineral[i]); mix(map.mineralAmt[i]); mix(map.fish[i]);
    }
    for (let i = 0; i < map.starts.length; i++) { mix(map.starts[i]); mix(map.starts[i] >> 8); }
    return h >>> 0;
  };

  if (typeof window !== "undefined") window.FSMap = FSMap;
  if (typeof module !== "undefined" && module.exports) module.exports = FSMap;
})();
