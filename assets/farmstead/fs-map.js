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

  /** Blur the heightfield where it is low; leave the mountains rugged. */
  function smoothLowland(map, passes, wMax) {
    const N = map.W * map.H;
    const tmp = new Float32Array(N);
    const hi = G.PLAIN_H * 1.5, lo = G.PLAIN_H * 0.55;
    for (let p = 0; p < passes; p++) {
      for (let v = 0; v < N; v++) {
        let sum = 0, cnt = 0;
        for (let d = 0; d < 6; d++) { const u = nbr(map, v, d); if (u >= 0) { sum += map.height[u]; cnt++; } }
        const avg = cnt ? sum / cnt : map.height[v];
        const w = wMax * (1 - smoothstep(lo, hi, map.height[v]));
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
    smoothLowland(map, G.SMOOTH_PASSES, G.SMOOTH_W);
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
    map.starts = findStartSites(map, players, { waterDist, mountDist });
    for (let i = 0; i < map.starts.length; i++) topUpStart(map, map.starts[i]);

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
    const score = gf * 100 + lf * 40 + Math.min(trees, 20) * 1.5 + Math.min(stones, 10) * 2
      - spread * 6 - FSMap.heightSpread(map, v, 1) * 10 - Math.min(fields.mountDist[v], 40) * 0.6;
    if (tier >= 5) return score;          // tiers 5/6: hard requirements only

    // ---- soft requirements (relaxed as `tier` rises) ----
    if (fields.waterDist[v] < Math.max(2, ST.WATER_CLEAR - tier)) return null;
    if (tier < 3 && fields.mountDist[v] > ST.MOUNTAIN_MAX) return null;
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
    const sep0 = Math.round(W * (ST.SEP_FRAC[n] || 0.36));
    const hardFloor = Math.max(4, Math.round(W * ST.SEP_HARD_FLOOR));
    for (let pass = 0; pass < ST.SEP_PASSES; pass++) {
      const floor = Math.max(4, Math.round(W * (ST.SEP_FLOOR_FRAC - pass * ST.SEP_FLOOR_STEP)));
      for (let tier = 0; tier <= 6; tier++) {
        const cands = candsFor(tier);
        if (cands.length < n) continue;
        let sep = sep0;
        while (sep >= floor) {
          const pick = greedyPick(map, cands, n, sep);
          if (pick) { map.startTier = tier; return pick; }
          sep = Math.round(sep * ST.SEP_RELAX);
        }
        // clustered candidates: spread them as far as this tier allows
        const sp = spreadPick(map, cands, n);
        if (sp) {
          let md = Infinity;
          for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) md = Math.min(md, dist(map, sp[i], sp[j]));
          if (md >= hardFloor || (pass === ST.SEP_PASSES - 1 && tier === 6)) { map.startTier = tier; return sp; }
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
    // clear the castle footprint + its door flag vertex
    forRadius(map, v, ST.CLEAR_R, (u) => { map.obj[u] = OBJ.NONE; map.objArg[u] = 0; });
    const door = nbr(map, v, DIR[FSC.DOOR_DIR]);
    if (door >= 0) { map.obj[door] = OBJ.NONE; map.objArg[door] = 0; }
  }
  FSMap.topUpStart = function (a, b) { return isMap(a) ? topUpStart(a, b) : topUpStart(M, a); };

  FSMap.doorVertex = function (a, b) {
    const map = isMap(a) ? a : M, v = isMap(a) ? b : a;
    return nbr(map, v, DIR[FSC.DOOR_DIR]);
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
    if (FSMap.objBlocks(map.obj[v])) return "blocked";
    if (map.flagAt[v]) return "flag here";
    if (map.bldAt[v]) return "building here";
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
    if (map.bldAt[v]) return "building here";
    if (FSMap.objBlocks(map.obj[v])) return "blocked";

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
    if (map.bldAt[b]) return "building in the way";
    if (FSMap.objBlocks(map.obj[b])) return "blocked";
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
