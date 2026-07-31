/* FARMSTEAD fs-models.js — procedural three.js asset builders.
 * 100% original geometry: primitives + canvas textures, no files, no imports.
 * House rules: MeshLambertMaterial everywhere, chunky low-poly, and an emissive
 * lift (~0.3x of the base colour) so unlit faces never render black.
 */
(function () {
  "use strict";
  const FSC = window.FSC, COL = FSC.COL;
  const FSModels = {};
  const CACHE = {};

  // ------------------------------------------------------------------ helpers
  function lift(hex, k) {
    const c = new THREE.Color(hex);
    c.multiplyScalar(k === undefined ? FSC.EMISSIVE_LIFT : k);
    return c;
  }
  /** MeshLambert with the house emissive lift. opts: {emissiveOf, emissiveK, ...material props} */
  function mat(color, opts) {
    opts = opts || {};
    const props = {
      color: color === undefined ? 0xffffff : color,
      emissive: lift(opts.emissiveOf !== undefined ? opts.emissiveOf : (color === undefined ? 0x808080 : color), opts.emissiveK),
    };
    for (const k in opts) {
      if (k === "emissiveK" || k === "emissiveOf") continue;
      props[k] = opts[k];
    }
    return new THREE.MeshLambertMaterial(props);
  }
  FSModels.mat = mat;
  FSModels.lift = lift;
  FSModels.playerColor = function (i) { return FSC.PLAYER_COLORS[i % FSC.PLAYER_COLORS.length]; };

  /* ===== PHASE-V: the shared building-material ATLAS ====================
   * Every building is ONE merged geometry drawn with ONE material, so a
   * plastered wall, a thatched roof and a stone footing cannot each carry
   * their own texture — they carry their own CELL of one 4x4 atlas instead.
   * A part declares `cell:"thatch"` and mergeColored remaps its 0..1 uv into
   * that cell. Parts with no cell land on "plain" (flat white) and read as
   * pure vertex colour, exactly like every Phase A-E model did. ========== */
  const ATLAS_CELLS = {
    plain: 0, plaster: 1, plank: 2, stone: 3,
    thatch: 4, shingle: 5, slate: 6, wood: 7,
    straw: 8, rock: 9, cloth: 10, metal: 11,
    dirt: 12, tile: 13, mesh: 14, sand: 15,
  };
  FSModels.ATLAS_CELLS = ATLAS_CELLS;
  const ATLAS_N = 4;                 // 4x4 grid
  const CELL_PAD = 0.035;            // inset so mip bleed never crosses a cell
  function cellUV(cell, u, v, out) {
    const i = ATLAS_CELLS[cell] === undefined ? 0 : ATLAS_CELLS[cell];
    const cx = i % ATLAS_N, cy = (i / ATLAS_N) | 0;
    out[0] = (cx + CELL_PAD + u * (1 - 2 * CELL_PAD)) / ATLAS_N;
    out[1] = (cy + CELL_PAD + v * (1 - 2 * CELL_PAD)) / ATLAS_N;
    return out;
  }
  FSModels.cellUV = cellUV;

  /**
   * Merge parts into ONE geometry carrying per-vertex colours (so a whole tree or
   * a whole castle is a single draw call / a single instanced mesh).
   * parts: [{geo, color, matrix?, cell?}]  — `cell` picks an atlas patch.
   */
  function mergeColored(parts) {
    const prepared = [];
    let total = 0, anyUV = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (p.cell) anyUV = true;
      prepared.push({ g, c: new THREE.Color(p.color === undefined ? 0xffffff : p.color), cell: p.cell || null });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = anyUV ? new Float32Array(total * 2) : null;
    const tuv = [0, 0];
    let o = 0;
    for (let i = 0; i < prepared.length; i++) {
      const g = prepared[i].g, c = prepared[i].c, cell = prepared[i].cell;
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (uv) {
        const src = g.attributes.uv;
        for (let k = 0; k < n; k++) {
          const su = src ? src.array[k * 2] : 0.5, sv = src ? src.array[k * 2 + 1] : 0.5;
          cellUV(cell || "plain", cell ? su : 0.5, cell ? sv : 0.5, tuv);
          uv[(o + k) * 2] = tuv[0]; uv[(o + k) * 2 + 1] = tuv[1];
        }
      }
      for (let k = 0; k < n; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
      o += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    if (uv) out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
  FSModels.mergeColored = mergeColored;

  function M(x, y, z, rx, ry, rz, sx, sy, sz) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
    m.compose(
      new THREE.Vector3(x || 0, y || 0, z || 0), q,
      new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
    );
    return m;
  }
  FSModels.M = M;

  // deterministic little PRNG for model jitter (never touches the sim stream)
  function jr(seed) {
    let a = (seed * 2654435761) >>> 0;
    return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  }

  // ------------------------------------------------------------ canvas textures
  function canvasTex(key, w, h, draw, repeat) {
    if (CACHE[key]) return CACHE[key];
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    draw(cv.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
    t.anisotropy = 2;
    CACHE[key] = t;
    return t;
  }
  FSModels.canvasTex = canvasTex;

  /* ===================================================================== */
  /* ===== PHASE-V: procedural surface textures =========================== */
  /* Everything here is drawn from scratch into a <canvas> with a seeded PRNG.
   * Grayscale-ish patterns MODULATE whatever vertex colour they sit on, so one
   * plaster patch serves a cream farmhouse and a grey guard tower alike. ==== */

  /** shared: fill a cell with a base value then knock noise into it */
  function cellBase(g, x, y, s, hex) {
    g.fillStyle = hex; g.fillRect(x, y, s, s);
  }
  function speck(g, x, y, s, n, rnd, alpha, size) {
    for (let i = 0; i < n; i++) {
      const a = alpha * (0.4 + rnd() * 0.6);
      g.fillStyle = (rnd() < 0.5 ? "rgba(0,0,0," : "rgba(255,255,255,") + a.toFixed(3) + ")";
      const w = size * (0.5 + rnd());
      g.fillRect(x + rnd() * s, y + rnd() * s, w, w);
    }
  }

  /** The 4x4 building atlas. One texture, every wall/roof/ground material. */
  function bldAtlas() {
    return canvasTex("atlas:bld", FSC.VIS.ATLAS_PX, FSC.VIS.ATLAS_PX, (g, W) => {
      const s = W / ATLAS_N, rnd = jr(90210);
      const at = (name) => {
        const i = ATLAS_CELLS[name];
        return [(i % ATLAS_N) * s, ((i / ATLAS_N) | 0) * s];
      };
      let p;
      // 0 plain — flat white, the "just use my vertex colour" cell
      p = at("plain"); cellBase(g, p[0], p[1], s, "#ffffff");
      // 1 plaster + timber framing (the signature charm surface)
      p = at("plaster"); cellBase(g, p[0], p[1], s, "#f4ece0");
      speck(g, p[0], p[1], s, 260, rnd, 0.05, 3);
      g.strokeStyle = "rgba(74,48,26,0.80)";
      g.lineWidth = Math.max(3, s * 0.055);
      g.beginPath();
      g.moveTo(p[0] + s * 0.04, p[1] + s * 0.10); g.lineTo(p[0] + s * 0.96, p[1] + s * 0.10);
      g.moveTo(p[0] + s * 0.04, p[1] + s * 0.90); g.lineTo(p[0] + s * 0.96, p[1] + s * 0.90);
      g.moveTo(p[0] + s * 0.08, p[1] + s * 0.06); g.lineTo(p[0] + s * 0.08, p[1] + s * 0.94);
      g.moveTo(p[0] + s * 0.92, p[1] + s * 0.06); g.lineTo(p[0] + s * 0.92, p[1] + s * 0.94);
      g.moveTo(p[0] + s * 0.50, p[1] + s * 0.10); g.lineTo(p[0] + s * 0.50, p[1] + s * 0.90);
      g.stroke();
      g.lineWidth = Math.max(2, s * 0.04);
      g.beginPath();
      g.moveTo(p[0] + s * 0.10, p[1] + s * 0.88); g.lineTo(p[0] + s * 0.48, p[1] + s * 0.14);
      g.moveTo(p[0] + s * 0.90, p[1] + s * 0.88); g.lineTo(p[0] + s * 0.52, p[1] + s * 0.14);
      g.stroke();
      // 2 plank — vertical boards with grain and gaps
      p = at("plank"); cellBase(g, p[0], p[1], s, "#e6d3ae");
      for (let i = 0; i < 7; i++) {
        const x = p[0] + (i / 7) * s;
        g.fillStyle = "rgba(0,0,0," + (0.10 + rnd() * 0.10).toFixed(3) + ")";
        g.fillRect(x, p[1], Math.max(2, s * 0.012), s);
        g.fillStyle = "rgba(255,255,255," + (0.05 + rnd() * 0.09).toFixed(3) + ")";
        g.fillRect(x + s * 0.02, p[1], s * 0.10, s);
      }
      speck(g, p[0], p[1], s, 160, rnd, 0.07, 2.4);
      // 3 stone — irregular blocks with mortar
      p = at("stone"); cellBase(g, p[0], p[1], s, "#ded6c6");
      for (let r = 0; r < 5; r++) {
        const y = p[1] + (r / 5) * s, hh = s / 5;
        let x = p[0] - (r % 2) * s * 0.11;
        while (x < p[0] + s) {
          const w = s * (0.15 + rnd() * 0.13);
          g.fillStyle = "rgba(0,0,0," + (0.03 + rnd() * 0.14).toFixed(3) + ")";
          g.fillRect(x + 1, y + 1, Math.min(w, p[0] + s - x) - 2, hh - 2);
          g.fillStyle = "rgba(255,255,255," + (rnd() * 0.14).toFixed(3) + ")";
          g.fillRect(x + 2, y + 2, Math.min(w, p[0] + s - x) - 5, hh * 0.30);
          x += w;
        }
      }
      // 4 thatch — combed straw
      p = at("thatch"); cellBase(g, p[0], p[1], s, "#e8d49a");
      for (let i = 0; i < 420; i++) {
        const x = p[0] + rnd() * s, y = p[1] + rnd() * s, L = s * (0.05 + rnd() * 0.09);
        g.strokeStyle = rnd() < 0.5 ? "rgba(90,64,26,0.30)" : "rgba(255,248,214,0.42)";
        g.lineWidth = Math.max(1, s * 0.008);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - 0.5) * s * 0.05, y + L); g.stroke();
      }
      for (let r = 1; r < 4; r++) {
        g.fillStyle = "rgba(0,0,0,0.10)";
        g.fillRect(p[0], p[1] + (r / 4) * s, s, Math.max(2, s * 0.018));
      }
      // 5 shingle — overlapping scalloped tiles
      p = at("shingle"); cellBase(g, p[0], p[1], s, "#f0e6dc");
      for (let r = 0; r < 6; r++) {
        const y = p[1] + (r / 6) * s, hh = s / 6;
        for (let c = 0; c < 6; c++) {
          const x = p[0] + ((c + (r % 2) * 0.5) / 6) * s;
          g.fillStyle = "rgba(0,0,0," + (0.05 + rnd() * 0.16).toFixed(3) + ")";
          g.beginPath();
          g.moveTo(x, y); g.lineTo(x + s / 6, y);
          g.lineTo(x + s / 6, y + hh * 0.6);
          g.quadraticCurveTo(x + s / 12, y + hh * 1.15, x, y + hh * 0.6);
          g.closePath(); g.fill();
          g.fillStyle = "rgba(255,255,255,0.16)";
          g.fillRect(x + 1, y, s / 6 - 2, Math.max(1, hh * 0.14));
        }
      }
      // 6 slate — cool flat tiles
      p = at("slate"); cellBase(g, p[0], p[1], s, "#e8ecf2");
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          const x = p[0] + ((c + (r % 2) * 0.5) / 5) * s, y = p[1] + (r / 7) * s;
          g.fillStyle = "rgba(0,0,0," + (0.06 + rnd() * 0.16).toFixed(3) + ")";
          g.fillRect(x + 1, y + 1, s / 5 - 2, s / 7 - 2);
        }
      }
      // 7 wood — horizontal beams / plank floors
      p = at("wood"); cellBase(g, p[0], p[1], s, "#e2c79a");
      for (let i = 0; i < 6; i++) {
        const y = p[1] + (i / 6) * s;
        g.fillStyle = "rgba(0,0,0," + (0.10 + rnd() * 0.10).toFixed(3) + ")";
        g.fillRect(p[0], y, s, Math.max(2, s * 0.014));
        for (let k = 0; k < 5; k++) {
          g.strokeStyle = "rgba(120,84,44,0.22)"; g.lineWidth = 1;
          g.beginPath();
          const yy = y + s / 12 + (rnd() - 0.5) * s * 0.03;
          g.moveTo(p[0] + rnd() * s * 0.4, yy); g.lineTo(p[0] + s * 0.4 + rnd() * s * 0.6, yy + (rnd() - 0.5) * 3);
          g.stroke();
        }
      }
      // 8 straw — loose hay / fields
      p = at("straw"); cellBase(g, p[0], p[1], s, "#f0dfa4");
      for (let i = 0; i < 500; i++) {
        const x = p[0] + rnd() * s, y = p[1] + rnd() * s, a = rnd() * Math.PI;
        g.strokeStyle = rnd() < 0.45 ? "rgba(122,92,34,0.30)" : "rgba(255,252,222,0.40)";
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * s * 0.07, y + Math.sin(a) * s * 0.07); g.stroke();
      }
      // 9 rock — chipped mountain stone
      p = at("rock"); cellBase(g, p[0], p[1], s, "#ded8ce");
      for (let i = 0; i < 90; i++) {
        g.fillStyle = "rgba(0,0,0," + (0.04 + rnd() * 0.16).toFixed(3) + ")";
        const x = p[0] + rnd() * s, y = p[1] + rnd() * s, r = s * (0.02 + rnd() * 0.07);
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.7);
          if (k) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath(); g.fill();
      }
      // 10 cloth — banner weave
      p = at("cloth"); cellBase(g, p[0], p[1], s, "#ffffff");
      for (let i = 0; i < 24; i++) {
        g.fillStyle = "rgba(0,0,0," + (0.03 + rnd() * 0.05).toFixed(3) + ")";
        g.fillRect(p[0], p[1] + (i / 24) * s, s, 1);
        g.fillRect(p[0] + (i / 24) * s, p[1], 1, s);
      }
      // 11 metal — hammered steel
      p = at("metal"); cellBase(g, p[0], p[1], s, "#f2f4f7");
      for (let i = 0; i < 120; i++) {
        g.fillStyle = "rgba(0,0,0," + (0.03 + rnd() * 0.10).toFixed(3) + ")";
        g.beginPath(); g.arc(p[0] + rnd() * s, p[1] + rnd() * s, s * (0.01 + rnd() * 0.035), 0, 6.3); g.fill();
      }
      // 12 dirt — trodden earth (roads, sites)
      p = at("dirt"); cellBase(g, p[0], p[1], s, "#e8d9bc");
      for (let i = 0; i < 300; i++) {
        g.fillStyle = rnd() < 0.55 ? "rgba(96,72,44,0.18)" : "rgba(255,250,230,0.20)";
        const r = s * (0.006 + rnd() * 0.022);
        g.beginPath(); g.arc(p[0] + rnd() * s, p[1] + rnd() * s, r, 0, 6.3); g.fill();
      }
      // 13 tile — terracotta roof rows
      p = at("tile"); cellBase(g, p[0], p[1], s, "#f4ded0");
      for (let r = 0; r < 6; r++) {
        const y = p[1] + (r / 6) * s, hh = s / 6;
        for (let c = 0; c < 8; c++) {
          const x = p[0] + (c / 8) * s;
          g.fillStyle = "rgba(0,0,0," + (0.05 + rnd() * 0.12).toFixed(3) + ")";
          g.fillRect(x, y, s / 8 - 1, hh - 1);
          g.fillStyle = "rgba(255,255,255,0.20)";
          g.fillRect(x, y, Math.max(1, s / 26), hh - 1);
        }
        g.fillStyle = "rgba(0,0,0,0.14)"; g.fillRect(p[0], y, s, Math.max(1, s * 0.012));
      }
      // 14 mesh — netting / fences
      p = at("mesh"); cellBase(g, p[0], p[1], s, "#ffffff");
      g.strokeStyle = "rgba(0,0,0,0.22)"; g.lineWidth = Math.max(1, s * 0.012);
      for (let i = 0; i <= 8; i++) {
        g.beginPath();
        g.moveTo(p[0], p[1] + (i / 8) * s); g.lineTo(p[0] + s, p[1] + (i / 8) * s);
        g.moveTo(p[0] + (i / 8) * s, p[1]); g.lineTo(p[0] + (i / 8) * s, p[1] + s);
        g.stroke();
      }
      // 15 sand — beach / desert grain
      p = at("sand"); cellBase(g, p[0], p[1], s, "#f6ecd4");
      speck(g, p[0], p[1], s, 520, rnd, 0.09, 2.2);
    });
  }
  FSModels.bldAtlas = bldAtlas;

  /** the one material every building body shares (atlas + vertex colour) */
  FSModels.bldMat = function () {
    return cached("mat:bldAtlas", () => mat(0xffffff, {
      vertexColors: true, map: bldAtlas(), emissiveOf: COL.BLD_WALL, emissiveK: 0.24,
    }));
  };

  /**
   * The terrain's blade-noise sheet: GRAYSCALE, so it enriches meadow green,
   * beach sand, bare rock and snow with the same strokes. Tiled over the world
   * every FSC.VIS.GROUND_TEX_UV units by the renderer's uv attribute.
   */
  FSModels.groundTex = function () {
    const V = FSC.VIS, P = V.GROUND_TEX_PX;
    return canvasTex("tex:ground", P, P, (g) => {
      const rnd = jr(1337);
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, P, P);
      // soft mottling first — big lazy blotches so a meadow is never one flat tone
      for (let i = 0; i < 70; i++) {
        const x = rnd() * P, y = rnd() * P, r = P * (0.04 + rnd() * 0.14);
        const grd = g.createRadialGradient(x, y, 0, x, y, r);
        const dark = rnd() < 0.5;
        grd.addColorStop(0, dark ? "rgba(104,110,86,0.26)" : "rgba(255,255,255,0.28)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
      }
      // then the blades themselves — short strokes, wrapped so the sheet tiles
      g.lineCap = "round";
      for (let i = 0; i < V.GROUND_BLADES; i++) {
        const x = rnd() * P, y = rnd() * P;
        const L = P * (0.008 + rnd() * 0.022), a = -Math.PI / 2 + (rnd() - 0.5) * 1.5;
        const light = rnd() < 0.45;
        g.strokeStyle = light ? "rgba(255,255,255," + (0.20 + rnd() * 0.32).toFixed(3) + ")"
          : "rgba(56,60,44," + (0.12 + rnd() * 0.24).toFixed(3) + ")";
        g.lineWidth = 1 + rnd() * 1.6;
        for (let wx = -1; wx <= 1; wx++) {
          for (let wy = -1; wy <= 1; wy++) {
            const px = x + wx * P, py = y + wy * P;
            if (px < -P * 0.1 || px > P * 1.1 || py < -P * 0.1 || py > P * 1.1) continue;
            g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L); g.stroke();
          }
        }
      }
    }, 1);
  };

  /**
   * A clump of grass blades punched out of a transparent sheet (alphaTest cutout).
   * THREE attempts to get here, and the lessons are worth keeping:
   *  - long thin separated blades alpha-test down to a bundle of thistles;
   *  - a filled dome silhouette reads as a solid green triangle, not grass;
   *  - so: MANY tapered blades with real gaps between them, tip heights capped
   *    by a dome so the clump peaks in the middle, and depth carried by the
   *    blades' own LUMINANCE (dark at the back, bright at the front) because
   *    an alpha-tested cutout throws away every subtlety in the alpha channel.
   */
  FSModels.tuftTex = function () {
    return canvasTex("tex:tuft", 128, 128, (g, P) => {
      const rnd = jr(5150);
      g.clearRect(0, 0, P, P);
      const dome = (u) => Math.sqrt(Math.max(0, 1 - (u * 2 - 1) * (u * 2 - 1)));
      function blade(rootx, tipx, h, w, lum, curve) {
        const c = Math.round(255 * lum);
        g.fillStyle = "rgba(" + Math.round(c * 0.88) + "," + c + "," + Math.round(c * 0.74) + ",1)";
        g.beginPath();
        g.moveTo(rootx - w, P);
        g.quadraticCurveTo(rootx - w * 0.3 + (tipx - rootx) * curve, P - h * 0.66, tipx, P - h);
        g.quadraticCurveTo(rootx + w * 0.35 + (tipx - rootx) * curve, P - h * 0.60, rootx + w, P);
        g.closePath(); g.fill();
      }
      // back rank: longer, darker, leaning out
      for (let i = 0; i < 17; i++) {
        const k = (i + 0.5) / 17;
        const rootx = P * (0.26 + k * 0.48);
        const tipx = P * (0.5 + (k - 0.5) * 2 * (0.40 + rnd() * 0.10));
        const h = P * (0.16 + 0.80 * dome(tipx / P)) * (0.82 + rnd() * 0.22);
        blade(rootx, tipx, h, P * (0.040 + rnd() * 0.026), 0.64 + rnd() * 0.16, 0.45);
      }
      // front rank: shorter, brighter, tighter — this is what reads as "fluffy"
      for (let i = 0; i < 21; i++) {
        const k = (i + 0.5) / 21;
        const rootx = P * (0.20 + k * 0.60);
        const tipx = P * (0.5 + (k - 0.5) * 2 * (0.30 + rnd() * 0.14));
        const h = P * (0.12 + 0.64 * dome(tipx / P)) * (0.78 + rnd() * 0.30);
        blade(rootx, tipx, h, P * (0.036 + rnd() * 0.024), 0.84 + rnd() * 0.16, 0.35);
      }
      // a shallow root band so a low camera never sees daylight under the clump
      const gr = g.createLinearGradient(0, P, 0, P * 0.86);
      gr.addColorStop(0, "rgba(170,206,140,1)");
      gr.addColorStop(1, "rgba(196,236,166,0)");
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(P * 0.14, P);
      for (let x = P * 0.14; x <= P * 0.86; x += 3) g.lineTo(x, P - P * 0.11 * dome((x / P - 0.14) / 0.72));
      g.lineTo(P * 0.86, P); g.closePath(); g.fill();
    });
  };

  /** the soft round contact shadow every object drops on the ground */
  FSModels.shadowTex = function () {
    return canvasTex("tex:shadow", 64, 64, (g, P) => {
      const grd = g.createRadialGradient(P / 2, P / 2, 0, P / 2, P / 2, P / 2);
      grd.addColorStop(0, "rgba(255,255,255,0.92)");
      grd.addColorStop(0.55, "rgba(255,255,255,0.52)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, P, P);
    });
  };

  /** scrolling caustic shimmer laid over the water plane */
  FSModels.shimmerTex = function () {
    return canvasTex("tex:shimmer", 256, 256, (g, P) => {
      const rnd = jr(24601);
      g.clearRect(0, 0, P, P);
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.lineCap = "round";
      for (let i = 0; i < 150; i++) {
        const x = rnd() * P, y = rnd() * P, L = P * (0.03 + rnd() * 0.10);
        g.lineWidth = 1 + rnd() * 2.6;
        g.globalAlpha = 0.18 + rnd() * 0.5;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + L * 0.4, y - 3, x + L * 0.7, y + 3, x + L, y);
        g.stroke();
      }
      g.globalAlpha = 1;
    }, 5);
  };

  /** the base water body texture — long lazy ripples */
  FSModels.waterTex = function () {
    return canvasTex("tex:water", 128, 128, (g, P) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, P, P);
      const rnd = jr(777);
      for (let i = 0; i < 34; i++) {
        const y = (i / 34) * P;
        g.strokeStyle = "rgba(198,232,255," + (0.20 + rnd() * 0.30).toFixed(3) + ")";
        g.lineWidth = 1 + rnd() * 2.2;
        g.beginPath();
        g.moveTo(0, y);
        for (let x = 0; x <= P; x += 8) g.lineTo(x, y + Math.sin((x / P) * 6.283 * 2 + i) * 2.2);
        g.stroke();
      }
      /* PHASE P: the deep patches used to be small, numerous and comparatively
       * dark, so the 128px sheet's repeat read as a legible polka-dot grid on
       * open sea at mid zoom. Fewer, wider and much fainter — the depth
       * variation survives, the tile does not announce itself. */
      for (let i = 0; i < 11; i++) {
        g.fillStyle = "rgba(40,90,130," + (0.022 + rnd() * 0.030).toFixed(3) + ")";
        const x = rnd() * P, y = rnd() * P, r = P * (0.16 + rnd() * 0.24);
        g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill();
      }
      // NOTE repeat = 1: the water mesh carries WORLD-SCALED uv of its own, so a
      // texture repeat here would multiply into a herringbone moire on the sea.
    }, 1);
  };

  /** trodden earth for the road ribbon — tiles along its own length */
  FSModels.roadTex = function () {
    return canvasTex("tex:road", 128, 128, (g, P) => {
      const rnd = jr(31337);
      g.fillStyle = "#f0e2c6"; g.fillRect(0, 0, P, P);
      // two wheel ruts running down the strip
      for (let s = -1; s <= 1; s += 2) {
        const x = P * (0.5 + s * 0.22);
        const grd = g.createLinearGradient(x - P * 0.09, 0, x + P * 0.09, 0);
        grd.addColorStop(0, "rgba(120,96,62,0)");
        grd.addColorStop(0.5, "rgba(120,96,62,0.30)");
        grd.addColorStop(1, "rgba(120,96,62,0)");
        g.fillStyle = grd; g.fillRect(x - P * 0.09, 0, P * 0.18, P);
      }
      // the verges darken where the grass creeps back in
      for (let s = -1; s <= 1; s += 2) {
        const x = s < 0 ? 0 : P * 0.88;
        const grd = g.createLinearGradient(s < 0 ? 0 : P, 0, s < 0 ? P * 0.12 : P * 0.88, 0);
        grd.addColorStop(0, "rgba(96,110,64,0.42)");
        grd.addColorStop(1, "rgba(96,110,64,0)");
        g.fillStyle = grd; g.fillRect(x, 0, P * 0.12, P);
      }
      // grit + footprints
      for (let i = 0; i < 420; i++) {
        const r = P * (0.004 + rnd() * 0.016);
        g.fillStyle = rnd() < 0.5 ? "rgba(108,86,54,0.26)" : "rgba(255,250,232,0.30)";
        g.beginPath(); g.arc(rnd() * P, rnd() * P, r, 0, 6.3); g.fill();
      }
      for (let i = 0; i < 16; i++) {
        g.fillStyle = "rgba(112,90,58,0.20)";
        const x = P * (0.34 + rnd() * 0.32), y = rnd() * P;
        g.beginPath(); g.ellipse(x, y, P * 0.022, P * 0.036, rnd(), 0, 6.3); g.fill();
      }
    }, 1);
  };

  /** soft round white puff (smoke, splash, dust) */
  FSModels.puffTex = function () {
    return canvasTex("tex:puff", 64, 64, (g, P) => {
      const grd = g.createRadialGradient(P / 2, P / 2, 0, P / 2, P / 2, P / 2);
      grd.addColorStop(0, "rgba(255,255,255,0.95)");
      grd.addColorStop(0.5, "rgba(255,255,255,0.55)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, P, P);
    });
  };

  /** four-pointed star used for sun glints on the water */
  FSModels.glintTex = function () {
    return canvasTex("tex:glint", 64, 64, (g, P) => {
      const c = P / 2;
      const grd = g.createRadialGradient(c, c, 0, c, c, c);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.25, "rgba(255,255,255,0.35)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.beginPath(); g.arc(c, c, c, 0, 6.3); g.fill();
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath();
      g.moveTo(c, 0); g.lineTo(c + P * 0.06, c - P * 0.06); g.lineTo(P, c);
      g.lineTo(c + P * 0.06, c + P * 0.06); g.lineTo(c, P); g.lineTo(c - P * 0.06, c + P * 0.06);
      g.lineTo(0, c); g.lineTo(c - P * 0.06, c - P * 0.06);
      g.closePath(); g.fill();
    });
  };

  function bannerTexture(color) {
    const hex = new THREE.Color(color).getHexString();
    return canvasTex("banner" + hex, 32, 32, (g) => {
      g.fillStyle = "#" + hex;
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.beginPath(); g.moveTo(4, 6); g.lineTo(16, 16); g.lineTo(4, 26); g.closePath(); g.fill();
      g.fillStyle = "rgba(0,0,0,0.18)";
      g.fillRect(0, 28, 32, 4);
    });
  }
  FSModels.bannerTexture = bannerTexture;

  // ------------------------------------------------------------------- objects
  /**
   * PHASE-V tree — a CLUSTERED canopy, not one blob. Broadleaves get 3-6
   * icosahedron lobes arranged on a jittered ring with a two-tone leaf palette
   * (deep underside lobes, bright crown lobes) so a forest reads as a mass of
   * foliage instead of a bag of marbles. Conifers keep the layered-cone
   * silhouette but soften: more tiers, drooping skirts, tone variation per tier.
   * `variant` re-rolls the arrangement so neighbouring trees never twin.
   * stage 1..4 — species 0 pine, 1 green broadleaf, 2 autumn broadleaf.
   */
  function treeGeo(stage, species, variant) {
    const V = FSC.VIS;
    const s = Math.max(1, Math.min(4, stage));
    const h = [0.62, 1.05, 1.75, 2.65][s - 1];
    const rnd = jr(s * 31 + species * 7717 + (variant || 0) * 104729);
    const parts = [];
    const deep = V.LEAF_A[species], bright = V.LEAF_B[species];
    const trunkH = species === 0 ? h * 0.32 : h * 0.44;
    const trunkR = 0.055 + h * 0.048;
    const lean = (rnd() - 0.5) * 0.10;            // every trunk leans a little
    const twist = rnd() * 6.283;
    parts.push({
      geo: new THREE.CylinderGeometry(trunkR * 0.72, trunkR * (1.05 + rnd() * 0.2), trunkH, 6),
      color: COL.TREE_TRUNK[species === 0 ? 0 : 1],
      matrix: M(0, trunkH / 2, 0, lean, twist, lean * 0.6),
    });
    if (s >= 3 && species !== 0) {
      // a couple of bare limbs poking out below the crown
      for (let i = 0; i < 2; i++) {
        const a = twist + i * 2.4 + rnd();
        parts.push({
          geo: new THREE.CylinderGeometry(trunkR * 0.24, trunkR * 0.36, h * 0.30, 4),
          color: COL.TREE_TRUNK[1],
          matrix: M(Math.cos(a) * h * 0.09, trunkH * 0.92, Math.sin(a) * h * 0.09, 0.5, a, 0.35),
        });
      }
    }
    const tipX = Math.sin(lean) * trunkH * 0.5, tipZ = Math.sin(lean * 0.6) * trunkH * 0.5;
    if (species === 0) {
      // conifer: 4-5 skirts, each a touch darker below, plus a soft spire
      const tiers = s === 1 ? 3 : (s === 2 ? 4 : 5);
      const span = h * 0.80;
      for (let i = 0; i < tiers; i++) {
        const f = i / (tiers - 1 || 1);
        const cr = (0.26 + h * 0.235) * (1 - f * 0.62) * (0.92 + rnd() * 0.18);
        const ch = span * (0.40 - f * 0.10);
        const c = new THREE.Color(deep).lerp(new THREE.Color(bright), f * 0.85 + rnd() * 0.12);
        parts.push({
          geo: new THREE.ConeGeometry(cr, ch, 7),
          color: c.getHex(),
          matrix: M(tipX, trunkH + ch * 0.42 + f * span * 0.72, tipZ, 0, rnd() * 3, 0, 1, 1, 1),
        });
      }
      parts.push({
        geo: new THREE.ConeGeometry(0.06 + h * 0.045, h * 0.24, 6), color: bright,
        matrix: M(tipX, trunkH + span * 0.86, tipZ),
      });
    } else {
      // broadleaf: a ring of lobes + a crown lobe, deep tones low, bright on top
      const cr = 0.24 + h * 0.205;
      const lobes = s === 1 ? 2 : (s === 2 ? 3 : (4 + ((variant || 0) % 2) + (rnd() < 0.5 ? 1 : 0)));
      const ringR = cr * (0.50 + rnd() * 0.20);
      const base = trunkH + cr * 0.52;
      // the heart of the crown, so the outer lobes read as a MASS and the tree
      // never hollows into a doughnut (the first spread pass did exactly that)
      parts.push({
        geo: new THREE.IcosahedronGeometry(cr * (0.86 + rnd() * 0.16), 0),
        color: new THREE.Color(deep).lerp(new THREE.Color(bright), 0.45).getHex(),
        matrix: M(tipX, base + cr * 0.18, tipZ, rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.88, 1),
      });
      for (let i = 0; i < lobes; i++) {
        const a = twist + (i / lobes) * 6.283 + (rnd() - 0.5) * 0.55;
        const rr = ringR * (0.82 + rnd() * 0.40);
        const lift = (rnd() - 0.5) * cr * 0.62;
        const sz = cr * (0.50 + rnd() * 0.30);
        const up = Math.max(0, Math.min(1, 0.5 + lift / (cr * 0.55)));
        const c = new THREE.Color(deep).lerp(new THREE.Color(bright), up * up);
        parts.push({
          geo: new THREE.IcosahedronGeometry(sz, 0), color: c.getHex(),
          matrix: M(tipX + Math.cos(a) * rr, base + lift, tipZ + Math.sin(a) * rr,
            rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.84 + rnd() * 0.2, 1),
        });
      }
      // crown
      parts.push({
        geo: new THREE.IcosahedronGeometry(cr * (0.64 + rnd() * 0.2), 0), color: bright,
        matrix: M(tipX + (rnd() - 0.5) * cr * 0.3, base + cr * (0.74 + rnd() * 0.22), tipZ + (rnd() - 0.5) * cr * 0.3,
          rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.82, 1),
      });
    }
    return mergeColored(parts);
  }

  /** a felled trunk: bark ring, pale sapwood, growth rings and a chip of moss */
  function stumpGeo() {
    const parts = [
      { geo: new THREE.CylinderGeometry(0.21, 0.25, 0.24, 9), color: COL.STUMP, matrix: M(0, 0.12, 0) },
      { geo: new THREE.CylinderGeometry(0.185, 0.185, 0.05, 9), color: 0xc3a071, matrix: M(0, 0.255, 0) },
      { geo: new THREE.CylinderGeometry(0.125, 0.125, 0.055, 9), color: 0xa8834f, matrix: M(0, 0.262, 0) },
      { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.06, 8), color: 0xc9a877, matrix: M(0, 0.268, 0) },
      // a root buttress or two so it grips the ground
      { geo: new THREE.BoxGeometry(0.10, 0.07, 0.20), color: COL.STUMP, matrix: M(0.19, 0.035, 0.06, 0, 0.5, 0) },
      { geo: new THREE.BoxGeometry(0.09, 0.06, 0.18), color: COL.STUMP, matrix: M(-0.16, 0.03, -0.12, 0, -0.8, 0) },
      { geo: new THREE.IcosahedronGeometry(0.07, 0), color: 0x6f9440, matrix: M(-0.17, 0.13, 0.11, 0, 0, 0, 1, 0.5, 1) },
    ];
    return mergeColored(parts);
  }

  /** stone pile, size 1..4 (bigger pile = more charges left) */
  function stoneGeo(size) {
    const n = [1, 2, 4, 6][Math.max(1, Math.min(4, size)) - 1];
    const rnd = jr(size * 977);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const r = 0.19 + rnd() * 0.14 + size * 0.05;
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 0.18 + rnd() * 0.28;
      /* ===== PHASE-V: chipped-rock cell + a per-boulder tone spread ===== */
      const c = new THREE.Color(COL.STONE).multiplyScalar(0.86 + rnd() * 0.30);
      parts.push({
        geo: new THREE.IcosahedronGeometry(r, 0),
        color: c.getHex(), cell: "rock",
        matrix: M(Math.cos(a) * d, r * 0.62, Math.sin(a) * d, rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.75, 1),
      });
    }
    // a scatter of chips at the foot of the pile
    for (let i = 0; i < 2 + size; i++) {
      const a = rnd() * 6.283, d = 0.3 + rnd() * 0.32, r = 0.045 + rnd() * 0.05;
      parts.push({
        geo: new THREE.IcosahedronGeometry(r, 0), color: 0x8f959d, cell: "rock",
        matrix: M(Math.cos(a) * d, r * 0.55, Math.sin(a) * d, rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.6, 1),
      });
    }
    return mergeColored(parts);
  }

  /** a tender young tree: a whip of a stem, three soft leaf tufts, a little collar */
  function saplingGeo() {
    const rnd = jr(4242);
    const parts = [
      { geo: new THREE.CylinderGeometry(0.018, 0.03, 0.26, 5), color: 0x8a7248, matrix: M(0, 0.13, 0, 0.06, 0, 0.04) },
      { geo: new THREE.CylinderGeometry(0.12, 0.15, 0.03, 8), color: 0x7d6a4a, matrix: M(0, 0.012, 0) },
    ];
    for (let i = 0; i < 3; i++) {
      const a = i * 2.094 + 0.4;
      parts.push({
        geo: new THREE.IcosahedronGeometry(0.10 + rnd() * 0.03, 0),
        color: i === 2 ? 0x8fce68 : COL.SAPLING,
        matrix: M(Math.cos(a) * 0.055, 0.27 + i * 0.045, Math.sin(a) * 0.055, rnd(), rnd() * 3, rnd(), 1, 0.72, 1),
      });
    }
    return mergeColored(parts);
  }

  /**
   * A ploughed field patch, stage 0 (just sown) .. 4 (ripe). The soil keeps its
   * furrow texture; the CROP itself is drawn by the renderer's instanced wheat
   * pool so it can wave (see FSModels.wheatGeo), but every stage still carries a
   * low bed of growth here so a distant field reads even with the wave culled.
   */
  function fieldGeo(stage) {
    const s = Math.max(0, Math.min(4, stage));
    const rnd = jr(s * 131 + 9);
    const parts = [{
      geo: new THREE.BoxGeometry(1.52, 0.07 + s * 0.012, 1.52),
      color: COL.FIELD[s], cell: "dirt",
      matrix: M(0, 0.035, 0),
    }];
    // a low earth bank around the plot — reads as "someone works this ground"
    for (let i = 0; i < 4; i++) {
      const a = i * 1.5708;
      parts.push({
        geo: new THREE.BoxGeometry(1.56, 0.05, 0.07), color: 0x7a6242, cell: "dirt",
        matrix: M(Math.sin(a) * 0.76, 0.045, Math.cos(a) * 0.76, 0, a, 0),
      });
    }
    if (s >= 1) {
      const bh = 0.05 + s * 0.085;
      const grow = new THREE.Color(FSC.VIS.WHEAT_GREEN).lerp(new THREE.Color(FSC.VIS.WHEAT_RIPE), (s - 1) / 3);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const x = (c - 1.5) * 0.36 + (rnd() - 0.5) * 0.07;
          const z = (r - 1.5) * 0.36 + (rnd() - 0.5) * 0.07;
          parts.push({
            geo: new THREE.BoxGeometry(0.27, bh, 0.10), color: grow.getHex(), cell: "straw",
            matrix: M(x, 0.06 + bh / 2, z, 0, rnd() * 0.5, 0),
          });
        }
      }
    }
    return mergeColored(parts);
  }

  /** harvested: bare furrows, cut stubble and a couple of tied sheaves */
  function fieldStubGeo() {
    const rnd = jr(7331);
    const parts = [{ geo: new THREE.BoxGeometry(1.52, 0.06, 1.52), color: COL.FIELD_STUB, cell: "dirt", matrix: M(0, 0.03, 0) }];
    for (let i = 0; i < 10; i++) {
      parts.push({
        geo: new THREE.BoxGeometry(1.4, 0.035, 0.05), color: 0x9d8b60, cell: "straw",
        matrix: M(0, 0.07, -0.63 + i * 0.14),
      });
    }
    for (let i = 0; i < 2; i++) {
      const x = (rnd() - 0.5) * 0.9, z = (rnd() - 0.5) * 0.9;
      parts.push({
        geo: new THREE.CylinderGeometry(0.08, 0.11, 0.22, 6), color: 0xd8bd6f, cell: "straw",
        matrix: M(x, 0.14, z, 0.1, rnd() * 3, 0.06),
      });
    }
    return mergeColored(parts);
  }

  /* ===================================================================== */
  /* ===== PHASE-V: meadow decor — tufts, flowers, shadows, wheat ========= */
  /* ===================================================================== */

  /**
   * One grass CLUMP: three quads crossing through the same root, each carrying
   * the blade cutout. Instanced by the renderer, one clump per scatter point,
   * per-instance tinted and swayed. 6 triangles apiece.
   */
  FSModels.tuftGeo = function (variant, quads) {
    const n = Math.max(1, quads === undefined ? 3 : quads);
    return cached("geo:tuft:" + variant + ":" + n, () => {
      const V = FSC.VIS, rnd = jr(191 + variant * 6151);
      const parts = [];
      // a low, wide CLUMP: crossing blade-sheets of different heights, spread
      // over about a metre so one instance reads as a patch of meadow rather
      // than a single spike. Short + wide survives RTS distance; tall + thin
      // turned into scratches (first pass, rejected on screenshot).
      // `quads` drops to 1 on a software rasteriser, where every alpha-tested
      // fragment is paid for on the CPU.
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI + (rnd() - 0.5) * 0.45;
        const w = V.TUFT_W * (0.80 + rnd() * 0.44) * (1 + variant * 0.10);
        const hh = V.TUFT_H * (0.72 + rnd() * 0.72) * (1 + variant * 0.08);
        const g = new THREE.PlaneGeometry(w, hh);
        /* each sheet leans OUTWARD a little, so the clump is a shallow
         * shuttlecock rather than a set of perfectly upright planes — from an
         * RTS camera an exactly vertical quad seen edge-on reads as a razor
         * line, and with three of them one is always nearly edge-on. */
        const tilt = 0.20 + rnd() * 0.14;
        parts.push({
          geo: g, color: 0xffffff, cell: null,
          matrix: M(Math.sin(a) * 0.10 + (rnd() - 0.5) * 0.34, hh * 0.46, Math.cos(a) * 0.10 + (rnd() - 0.5) * 0.34,
            tilt * Math.cos(a), a, tilt * -Math.sin(a)),
        });
      }
      // PlaneGeometry brings its own 0..1 uv; the tuft material samples the
      // blade cutout directly (no atlas), so keep those uvs untouched.
      const prepared = [];
      let total = 0;
      for (const p of parts) {
        const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
        g.applyMatrix4(p.matrix);
        prepared.push(g); total += g.attributes.position.count;
      }
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
      const uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
      let o = 0;
      for (const g of prepared) {
        const c = g.attributes.position.count;
        pos.set(g.attributes.position.array, o * 3);
        nor.set(g.attributes.normal.array, o * 3);
        uv.set(g.attributes.uv.array, o * 2);
        for (let k = 0; k < c; k++) { col[(o + k) * 3] = 1; col[(o + k) * 3 + 1] = 1; col[(o + k) * 3 + 2] = 1; }
        o += c; g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      out.setAttribute("color", new THREE.BufferAttribute(col, 3));
      out.computeBoundingSphere();
      return out;
    });
  };

  FSModels.tuftMat = function () {
    return cached("mat:tuft", () => mat(0xffffff, {
      vertexColors: true, map: FSModels.tuftTex(), alphaTest: 0.36,
      side: THREE.DoubleSide, emissiveOf: 0x84a858, emissiveK: 0.34,
    }));
  };

  /** a knot of loose scree — what keeps a mountainside from reading as one lump */
  FSModels.screeGeo = function () {
    return cached("geo:scree", () => {
      const rnd = jr(8123), parts = [];
      for (let i = 0; i < 4; i++) {
        const a = rnd() * 6.283, d = i === 0 ? 0 : 0.14 + rnd() * 0.26;
        const r = 0.09 + rnd() * 0.14;
        parts.push({
          geo: new THREE.IcosahedronGeometry(r, 0), color: 0xffffff, cell: "rock",
          matrix: M(Math.cos(a) * d, r * 0.55, Math.sin(a) * d, rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.68, 1),
        });
      }
      return mergeColored(parts);
    });
  };

  /** a wildflower: a stalk and a tiny cross of petals, tinted per instance */
  FSModels.flowerGeo = function () {
    return cached("geo:flower", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.016, 0.20, 0.016), color: 0x6f8f45, matrix: M(0, 0.10, 0) },
      { geo: new THREE.BoxGeometry(0.115, 0.02, 0.038), color: 0xffffff, matrix: M(0, 0.205, 0) },
      { geo: new THREE.BoxGeometry(0.038, 0.02, 0.115), color: 0xffffff, matrix: M(0, 0.205, 0) },
      { geo: new THREE.BoxGeometry(0.042, 0.035, 0.042), color: 0xfff0b0, matrix: M(0, 0.215, 0) },
    ]));
  };

  /** the soft contact shadow quad shared by every grounded thing */
  FSModels.shadowGeo = function () {
    return cached("geo:shadow", () => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return whiteColors(g);
    });
  };
  FSModels.shadowMat = function () {
    return cached("mat:shadow", () => new THREE.MeshBasicMaterial({
      color: FSC.VIS.SHADOW_COL, map: FSModels.shadowTex(), transparent: true,
      opacity: FSC.VIS.SHADOW_OP, depthWrite: false, blending: THREE.NormalBlending,
    }));
  };

  /** a clump of standing wheat stalks — instanced over ripe fields, waves in the breeze */
  FSModels.wheatGeo = function () {
    return cached("geo:wheat", () => {
      const rnd = jr(60613), parts = [];
      for (let i = 0; i < 7; i++) {
        const a = rnd() * 6.283, r = rnd() * 0.13;
        const h = 0.26 + rnd() * 0.14;
        parts.push({
          geo: new THREE.BoxGeometry(0.022, h, 0.022), color: 0xffffff,
          matrix: M(Math.cos(a) * r, h * 0.5, Math.sin(a) * r, (rnd() - 0.5) * 0.24, rnd() * 3, (rnd() - 0.5) * 0.24),
        });
        parts.push({
          geo: new THREE.BoxGeometry(0.05, 0.09, 0.05), color: 0xffffff,
          matrix: M(Math.cos(a) * r * 1.25, h + 0.03, Math.sin(a) * r * 1.25, 0, rnd() * 3, 0),
        });
      }
      return mergeColored(parts);
    });
  };

  /**
   * The instanced object registry the renderer draws the world from.
   * key -> { geo, mat, tint } ; one InstancedMesh per key.
   */
  FSModels.objectKinds = function () {
    if (CACHE.kinds) return CACHE.kinds;
    const V = FSC.VIS;
    const kinds = {};
    const vc = { vertexColors: true };
    for (let sp = 0; sp < 3; sp++) {
      const leaf = V.LEAF_B[sp];
      for (let st = 1; st <= 4; st++) {
        /* ===== PHASE-V: mature stages get alternate canopy arrangements so a
         * dense wood never reads as one stamp repeated — young stages stay
         * single (they are small and numerous, extra pools would not pay). */
        const nv = st >= 3 ? V.TREE_VARIANTS : 1;
        for (let vv = 0; vv < nv; vv++) {
          kinds["tree" + sp + "_" + st + (vv ? "b" : "")] = {
            geo: treeGeo(st, sp, vv),
            mat: mat(0xffffff, Object.assign({ emissiveOf: leaf, emissiveK: 0.26 }, vc)),
            tint: "leaf",
          };
        }
      }
    }
    for (let s = 1; s <= 4; s++) {
      kinds["stone_" + s] = { geo: stoneGeo(s), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.STONE, map: bldAtlas() }, vc)), tint: "stone" };
    }
    kinds.stump = { geo: stumpGeo(), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.STUMP }, vc)) };
    kinds.sapling = { geo: saplingGeo(), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.SAPLING }, vc)) };
    for (let s = 0; s <= 4; s++) {
      kinds["field_" + s] = {
        geo: fieldGeo(s),
        mat: mat(0xffffff, Object.assign({ emissiveOf: COL.FIELD[s], map: bldAtlas() }, vc)),
      };
    }
    kinds.fieldstub = { geo: fieldStubGeo(), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.FIELD_STUB, map: bldAtlas() }, vc)) };
    CACHE.kinds = kinds;
    return kinds;
  };

  /** map OBJ.* + species -> registry key (null = nothing to draw).
   *  `v` (optional) picks the canopy variant for mature trees. */
  FSModels.kindForObj = function (obj, species, v) {
    const O = FSC.OBJ;
    if (obj >= O.TREE1 && obj <= O.TREE4) {
      const st = obj - O.TREE1 + 1;
      let suf = "";
      if (st >= 3 && v !== undefined && FSC.VIS.TREE_VARIANTS > 1) {
        // deterministic per-vertex, and NOT the same hash the renderer uses for
        // scale/yaw, so arrangement and pose vary independently
        suf = ((Math.imul(v ^ 0x27d4eb2f, 668265263) >>> 13) & 1) ? "b" : "";
      }
      return "tree" + (species % 3) + "_" + st + suf;
    }
    if (obj === O.STUMP) return "stump";
    if (obj >= O.STONE1 && obj <= O.STONE4) return "stone_" + (obj - O.STONE1 + 1);
    if (obj === O.SAPLING) return "sapling";
    if (obj >= O.FIELD0 && obj <= O.FIELD4) return "field_" + (obj - O.FIELD0);
    if (obj === O.FIELD_STUB) return "fieldstub";
    return null;
  };

  /** per-instance colour variation for a kind (keeps forests from looking flat) */
  FSModels.tintFor = function (kind, v, out) {
    out = out || new THREE.Color();
    const k = CACHE.kinds && CACHE.kinds[kind] ? CACHE.kinds[kind].tint : null;
    const rnd = jr(v * 2166136261 + 7);
    /* ===== PHASE-V: a wider, warmer spread — some trees are sun-bleached,
     * some sit in deep shade, and the hue drifts a touch as well as the value */
    if (k === "leaf") {
      const s = 0.80 + rnd() * 0.40, warm = (rnd() - 0.5) * 0.10;
      out.setRGB(s * (1 + warm), s, s * (0.93 - warm * 0.5));
      return out;
    }
    if (k === "stone") { const s = 0.84 + rnd() * 0.32; out.setRGB(s, s * 0.995, s * 1.03); return out; }
    const s = 0.90 + rnd() * 0.20;
    out.setScalar(s);
    return out;
  };

  // -------------------------------------------------------------------- castle
  /** An impressive keep: walls, four towers, gate, and a banner in player colour. */
  FSModels.castle = function (playerIdx) {
    const color = FSModels.playerColor(playerIdx);
    const V = FSC.VIS;
    const g = new THREE.Group();
    const stone = [], wood = [], team = [];

    // a cobbled bailey, a moulded plinth, then the keep
    stone.push({ geo: new THREE.BoxGeometry(3.6, 0.16, 3.6), color: 0x9d9583, cell: "stone", matrix: M(0, 0.08, 0) });
    stone.push({ geo: new THREE.BoxGeometry(3.2, 0.22, 3.2), color: 0xb2a996, cell: "stone", matrix: M(0, 0.24, 0) });
    stone.push({ geo: new THREE.BoxGeometry(2.5, 1.95, 2.5), color: V.WALL_STONE, cell: "stone", matrix: M(0, 1.32, 0) });
    // a string course band + the machicolation lip under the battlements
    stone.push({ geo: new THREE.BoxGeometry(2.62, 0.09, 2.62), color: 0xa39a88, cell: "stone", matrix: M(0, 1.44, 0) });
    stone.push({ geo: new THREE.BoxGeometry(2.72, 0.14, 2.72), color: 0xa39a88, cell: "stone", matrix: M(0, 2.34, 0) });
    // battlements around the keep
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      const ax = Math.abs(x) > Math.abs(z) ? Math.sign(x) * 1.30 : x * 1.30;
      const az = Math.abs(z) >= Math.abs(x) ? Math.sign(z) * 1.30 : z * 1.30;
      stone.push({ geo: new THREE.BoxGeometry(0.34, 0.32, 0.34), color: V.WALL_STONE, cell: "stone", matrix: M(ax, 2.56, az) });
    }
    // four corner towers with conical roofs
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const x = Math.cos(a) * 1.5, z = Math.sin(a) * 1.5;
      stone.push({ geo: new THREE.CylinderGeometry(0.42, 0.50, 2.75, 9), color: 0xc0b7a4, cell: "stone", matrix: M(x, 1.46, z) });
      stone.push({ geo: new THREE.CylinderGeometry(0.54, 0.46, 0.11, 9), color: 0xa39a88, cell: "stone", matrix: M(x, 2.88, z) });
      team.push({ geo: new THREE.ConeGeometry(0.58, 0.86, 9), color: color, cell: "tile", matrix: M(x, 3.30, z) });
      // arrow slit + a warm lit window part way up
      stone.push({ geo: new THREE.BoxGeometry(0.07, 0.30, 0.07), color: 0x2e2822, matrix: M(x * 1.12, 1.90, z * 1.12) });
      wood.push({ geo: new THREE.BoxGeometry(0.17, 0.19, 0.09), color: V.WINDOW_GLOW, matrix: M(x * 1.14, 1.20, z * 1.14, 0, -a, 0) });
    }
    // gatehouse on the door (SE) side: arch, banded doors, portcullis teeth
    stone.push({ geo: new THREE.BoxGeometry(1.15, 1.30, 0.30), color: 0xc4bba8, cell: "stone", matrix: M(0.62, 0.90, 1.32) });
    wood.push({ geo: new THREE.BoxGeometry(0.86, 0.96, 0.14), color: 0x4d3826, cell: "plank", matrix: M(0.62, 0.72, 1.44) });
    wood.push({ geo: new THREE.BoxGeometry(0.90, 0.07, 0.17), color: 0x6a6055, matrix: M(0.62, 0.98, 1.45) });
    wood.push({ geo: new THREE.BoxGeometry(0.90, 0.07, 0.17), color: 0x6a6055, matrix: M(0.62, 0.52, 1.45) });
    stone.push({ geo: new THREE.BoxGeometry(1.25, 0.16, 0.40), color: 0xa39a88, cell: "stone", matrix: M(0.62, 1.60, 1.32) });
    wood.push({ geo: new THREE.BoxGeometry(0.16, 1.05, 0.90), color: 0x4d3826, cell: "plank", matrix: M(1.36, 0.75, 0.62) });
    // keep roof, a lantern turret and the flag pole
    team.push({ geo: new THREE.ConeGeometry(1.95, 1.10, 4), color: COL.CASTLE_ROOF, cell: "tile", matrix: M(0, 2.98, 0, 0, Math.PI / 4, 0) });
    stone.push({ geo: new THREE.CylinderGeometry(0.26, 0.30, 0.42, 8), color: 0xcfc6b2, cell: "stone", matrix: M(0, 3.62, 0) });
    team.push({ geo: new THREE.ConeGeometry(0.34, 0.40, 8), color: color, cell: "tile", matrix: M(0, 4.02, 0) });
    wood.push({ geo: new THREE.CylinderGeometry(0.045, 0.045, 1.20, 5), color: 0x8a8070, matrix: M(0, 4.80, 0) });

    const body = new THREE.Mesh(mergeColored(stone.concat(wood)), FSModels.bldMat());
    body.name = "castleBody";
    g.add(body);
    const trim = new THREE.Mesh(mergeColored(team), FSModels.bldMat());
    trim.name = "castleTrim";
    g.add(trim);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.44),
      mat(0xffffff, { map: bannerTexture(color), side: THREE.DoubleSide, emissiveOf: color, emissiveK: 0.35 })
    );
    banner.position.set(0.32, 5.16, 0);
    banner.name = "castleBanner";
    g.add(banner);
    g.userData.banner = banner;
    g.userData.props = FSModels.BLD_PROPS.castle;
    g.userData.type = "castle";
    return g;
  };

  /* ===================================================================== */
  /* ===== PHASE-C: a distinct silhouette for every building type ========= */
  /* ===================================================================== */

  /**
   * Every economy building is built from the same kit — a timbered box, a pitched
   * roof and a door — plus the props that say what happens inside. Moving parts
   * (mill sails, mine wheel, sawmill blade) are returned as their own mesh in
   * `userData.spin` so the renderer can turn them while the building works, and
   * `userData.smoke` marks where the chimney puffs from.
   * Budget: ≤ ~400 triangles each, one draw call for the shell + one per mover.
   */
  /* ===== PHASE-V: the building KIT ======================================
   * Every economy building is a stone footing + a textured wall box + corner
   * timbers + a real roof (thatch/shingle/slate, with ridge, eaves and gable
   * ends) + a framed door and lit windows — then the props that say what
   * happens inside. All of it merges into ONE geometry sharing ONE atlas
   * material, so a whole village still costs one draw call per building.
   * Budget: <= FSC.VIS.BLD_TRI_MAX triangles including props. ============ */

  /** a lit window: dark frame, warm pane, little sill */
  function window_(parts, x, y, z, yaw, w, h) {
    const V = FSC.VIS;
    w = w || 0.20; h = h || 0.22;
    parts.push({ geo: new THREE.BoxGeometry(w + 0.07, h + 0.07, 0.05), color: 0x5b4227, matrix: M(x, y, z, 0, yaw, 0) });
    parts.push({ geo: new THREE.BoxGeometry(w, h, 0.06), color: V.WINDOW_GLOW, matrix: M(x, y, z, 0, yaw, 0) });
    parts.push({ geo: new THREE.BoxGeometry(0.028, h + 0.02, 0.07), color: 0x5b4227, matrix: M(x, y, z, 0, yaw, 0) });
  }
  /** a chimney stack; returns the smoke anchor */
  function chimney(parts, x, z, top, w) {
    const V = FSC.VIS;
    w = w || 0.20;
    parts.push({ geo: new THREE.BoxGeometry(w, top, w), color: V.CHIMNEY, cell: "stone", matrix: M(x, top / 2, z) });
    parts.push({ geo: new THREE.BoxGeometry(w + 0.08, 0.07, w + 0.08), color: 0x8b7d69, cell: "stone", matrix: M(x, top + 0.02, z) });
    return [x, top + 0.14, z];
  }

  function shell(parts, w, h, o) {
    o = o || {};
    const V = FSC.VIS;
    const d = w * (o.d || 1);
    const wall = o.wall === undefined ? V.WALL_PLASTER : o.wall;
    const roof = o.roof === undefined ? V.ROOF_SHINGLE : o.roof;
    const wallCell = o.wallCell || "plaster";
    const roofCell = o.roofCell || (o.roofType === "flat" ? "wood" : "shingle");
    const timber = o.timber === undefined ? V.WALL_TIMBER : o.timber;
    // stone footing — the single biggest "it sits on the ground" cue
    parts.push({ geo: new THREE.BoxGeometry(w * 1.06, 0.10, d * 1.06), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.05, 0) });
    // walls
    parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: wall, cell: wallCell, matrix: M(0, h / 2 + 0.08, 0) });
    // corner posts + a sill band
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      parts.push({
        geo: new THREE.BoxGeometry(0.085, h, 0.085), color: timber, cell: "wood",
        matrix: M(sx * w * 0.5, h / 2 + 0.08, sz * d * 0.5),
      });
    }
    parts.push({ geo: new THREE.BoxGeometry(w * 1.02, 0.065, d * 1.02), color: timber, cell: "wood", matrix: M(0, h * 0.60 + 0.08, 0) });
    const eave = h + 0.08;
    if (o.roofType === "flat") {
      parts.push({ geo: new THREE.BoxGeometry(w * 1.16, 0.13, d * 1.16), color: roof, cell: roofCell, matrix: M(0, eave + 0.065, 0) });
      parts.push({ geo: new THREE.BoxGeometry(w * 1.22, 0.05, d * 1.22), color: timber, cell: "wood", matrix: M(0, eave, 0) });
    } else if (o.roofType === "gable") {
      const rh = o.roofH || 0.6;
      const slope = Math.atan2(rh, w * 0.5);
      const rl = Math.sqrt(rh * rh + (w * 0.55) * (w * 0.55)) * 2 * 0.56;
      for (let s = -1; s <= 1; s += 2) {
        parts.push({
          geo: new THREE.BoxGeometry(rl, 0.09, d * 1.2), color: roof, cell: roofCell,
          matrix: M(s * w * 0.26, eave + rh * 0.5, 0, 0, 0, -s * slope),
        });
      }
      // gable end triangles, ridge beam and eave shadow-line
      for (let s = -1; s <= 1; s += 2) {
        parts.push({
          geo: new THREE.ConeGeometry(w * 0.52, rh, 3), color: wall, cell: wallCell,
          matrix: M(0, eave + rh * 0.5, s * d * 0.5, Math.PI / 2, 0, 0, 1, 1, 1),
        });
      }
      parts.push({ geo: new THREE.BoxGeometry(0.09, 0.09, d * 1.24), color: timber, cell: "wood", matrix: M(0, eave + rh, 0) });
      parts.push({ geo: new THREE.BoxGeometry(w * 1.12, 0.05, d * 1.22), color: timber, cell: "wood", matrix: M(0, eave - 0.01, 0) });
    } else {
      const rh = o.roofH || 0.62;
      parts.push({
        geo: new THREE.ConeGeometry(w * 0.88, rh, 4), color: roof, cell: roofCell,
        matrix: M(0, eave + rh * 0.5, 0, 0, Math.PI / 4, 0),
      });
      parts.push({ geo: new THREE.BoxGeometry(w * 1.06, 0.05, d * 1.06), color: timber, cell: "wood", matrix: M(0, eave, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.07, 0.16, 0.07), color: timber, matrix: M(0, eave + rh + 0.04, 0) });
    }
    // door faces the SE flag (the model group is yawed to it by the renderer)
    if (o.door !== false) {
      const dz = d * 0.5;
      parts.push({ geo: new THREE.BoxGeometry(0.40, h * 0.62, 0.05), color: 0x6f5334, cell: "wood", matrix: M(w * 0.12, h * 0.31 + 0.08, dz + 0.015) });
      parts.push({ geo: new THREE.BoxGeometry(0.30, h * 0.52, 0.06), color: 0x4d3826, cell: "plank", matrix: M(w * 0.12, h * 0.27 + 0.08, dz + 0.03) });
      parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.05), color: 0xe0c060, matrix: M(w * 0.12 + 0.10, h * 0.29 + 0.08, dz + 0.06) });
      // a stone step
      parts.push({ geo: new THREE.BoxGeometry(0.46, 0.05, 0.20), color: V.FOUNDATION, cell: "stone", matrix: M(w * 0.12, 0.06, dz + 0.10) });
    }
    // windows on the two visible walls
    if (o.win !== false) {
      const wy = h * 0.62 + 0.08;
      window_(parts, -w * 0.24, wy, d * 0.5 + 0.02, 0, Math.min(0.24, w * 0.20), 0.20);
      window_(parts, w * 0.5 + 0.02, wy, -d * 0.16, Math.PI / 2, Math.min(0.24, w * 0.20), 0.20);
    }
    return parts;
  }
  function post(parts, x, z, h, col) {
    parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.06, h, 5), color: col === undefined ? COL.BLD_WOOD : col, cell: "wood", matrix: M(x, h / 2, z) });
  }
  /** a proper paddock: posts joined by two rails */
  /** a paddock: box posts joined by two rails. Boxes, not cylinders — a ring of
   *  cylinder posts is a third of a small building's whole triangle budget. */
  function fence(parts, r, n, col) {
    const c = col === undefined ? COL.BLD_WOOD : col;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push({
        geo: new THREE.BoxGeometry(0.065, 0.36, 0.065), color: c, cell: "wood",
        matrix: M(Math.cos(a) * r, 0.18, Math.sin(a) * r, 0, -a, 0),
      });
      const a2 = ((i + 1) / n) * Math.PI * 2;
      const x0 = Math.cos(a) * r, z0 = Math.sin(a) * r, x1 = Math.cos(a2) * r, z1 = Math.sin(a2) * r;
      const len = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
      const rot = Math.atan2(x1 - x0, z1 - z0);
      for (let k = 0; k < 2; k++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.035, 0.035, len), color: c, cell: "wood",
          matrix: M((x0 + x1) / 2, 0.14 + k * 0.15, (z0 + z1) / 2, 0, rot, 0),
        });
      }
    }
  }
  /** a stacked woodpile / plank stack / crate heap prop */
  function stack(parts, x, z, n, color, cell, rot, r) {
    r = r === undefined ? 0.10 : r;
    for (let i = 0; i < n; i++) {
      const row = (i / 3) | 0, col2 = i % 3;
      parts.push({
        geo: new THREE.CylinderGeometry(r, r, 0.62, 6), color: color, cell: cell || "wood",
        matrix: M(x + (row % 2) * r, r + row * r * 1.7, z + (col2 - 1) * r * 2.05, Math.PI / 2, rot || 0, 0),
      });
    }
  }
  /** a barrel */
  function barrel(parts, x, y, z, s, color) {
    s = s || 1;
    parts.push({ geo: new THREE.CylinderGeometry(0.15 * s, 0.13 * s, 0.30 * s, 8), color: color || 0xa9743d, cell: "plank", matrix: M(x, y + 0.15 * s, z) });
    parts.push({ geo: new THREE.CylinderGeometry(0.155 * s, 0.155 * s, 0.035 * s, 8), color: 0x6f5334, matrix: M(x, y + 0.08 * s, z) });
    parts.push({ geo: new THREE.CylinderGeometry(0.145 * s, 0.145 * s, 0.035 * s, 8), color: 0x6f5334, matrix: M(x, y + 0.24 * s, z) });
  }

  /** ONE spinning prop: returns {geo, color} lists in its own local frame. */
  function sailsGeo() {
    const parts = [];
    parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 0.16, 6), color: COL.BLD_WOOD, matrix: M(0, 0, 0, Math.PI / 2, 0, 0) });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      parts.push({
        geo: new THREE.BoxGeometry(0.14, 1.05, 0.05), color: COL.MILL_SAIL,
        matrix: M(Math.cos(a + Math.PI / 2) * 0.55, Math.sin(a + Math.PI / 2) * 0.55, 0.1, 0, 0, a),
      });
    }
    return mergeColored(parts);
  }
  function wheelGeo() {
    const parts = [];
    parts.push({ geo: new THREE.TorusGeometry(0.36, 0.05, 4, 10), color: COL.WHEEL, matrix: M(0, 0, 0) });
    for (let i = 0; i < 4; i++) {
      parts.push({ geo: new THREE.BoxGeometry(0.72, 0.06, 0.06), color: COL.WHEEL, matrix: M(0, 0, 0, 0, 0, i * Math.PI / 4) });
    }
    return mergeColored(parts);
  }
  function bladeGeo() {
    const parts = [{ geo: new THREE.CylinderGeometry(0.38, 0.38, 0.05, 12), color: 0xb9bfc6, matrix: M(0, 0, 0, Math.PI / 2, 0, 0) }];
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      parts.push({ geo: new THREE.BoxGeometry(0.1, 0.1, 0.06), color: 0xd8dde3, matrix: M(Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0, 0, 0, a) });
    }
    return mergeColored(parts);
  }

  const MINE_TINT = { stoneMine: 0x8d949c, coalMine: 0x3a3a40, ironMine: 0xa8703a, goldMine: 0xe0b93a };

  /** the per-type part list; returns {parts, spin, spinAt, axis, smoke} */
  function buildingParts(type, playerIdx) {
    const parts = [];
    const out = { parts, spin: null, spinAt: null, axis: "z", rate: 1, smoke: null };
    const team = FSModels.playerColor(playerIdx || 0);
    const V = FSC.VIS;
    switch (type) {
      case "stock": {
        // a proper warehouse: big thatched barn, loading dock, goods on the ramp
        shell(parts, 1.9, 1.05, { roofType: "gable", roofH: 0.78, wall: 0xdccaa4, roofCell: "thatch", roof: V.ROOF_THATCH, d: 1.0 });
        parts.push({ geo: new THREE.BoxGeometry(1.1, 0.06, 0.7), color: 0xb08a56, cell: "wood", matrix: M(0, 0.11, 1.10) });
        for (let i = 0; i < 4; i++) {
          barrel(parts, -0.72 + i * 0.42, 0.14, 1.06, 0.9, i & 1 ? 0xb98b4d : 0xa9743d);
        }
        parts.push({ geo: new THREE.BoxGeometry(0.62, 0.78, 0.07), color: 0x5d442a, cell: "plank", matrix: M(0, 0.47, 0.96) });
        parts.push({ geo: new THREE.BoxGeometry(0.70, 0.07, 0.09), color: V.WALL_TIMBER, matrix: M(0, 0.86, 0.98) });
        // hoist beam out of the gable
        parts.push({ geo: new THREE.BoxGeometry(0.08, 0.08, 0.5), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, 1.52, 1.15) });
        parts.push({ geo: new THREE.BoxGeometry(0.03, 0.30, 0.03), color: 0x8a7a5e, matrix: M(0, 1.34, 1.34) });
        out.smoke = null;
        break;
      }
      case "hut": {
        // a small watch post: stone base, palisade crown, banner
        shell(parts, 1.0, 0.86, { wall: 0xc9c0ad, wallCell: "stone", roofType: "flat", roof: 0x8a7a5e, roofCell: "plank", win: false });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          parts.push({ geo: new THREE.BoxGeometry(0.16, 0.22, 0.16), color: 0xc9c0ad, cell: "stone", matrix: M(Math.cos(a) * 0.46, 1.08, Math.sin(a) * 0.46) });
        }
        window_(parts, -0.2, 0.62, 0.52, 0, 0.16, 0.20);
        post(parts, 0, 0, 1.55, COL.FLAG_POLE);
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.24, 0.03), color: team, cell: "cloth", matrix: M(0.18, 1.42, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.30, 0.34, 0.05), color: team, cell: "cloth", matrix: M(0, 0.72, 0.53) });
        break;
      }
      case "tower": {
        parts.push({ geo: new THREE.CylinderGeometry(0.70, 0.80, 0.22, 10), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.11, 0) });
        parts.push({ geo: new THREE.CylinderGeometry(0.60, 0.70, 1.85, 10), color: V.WALL_STONE, cell: "stone", matrix: M(0, 1.05, 0) });
        parts.push({ geo: new THREE.CylinderGeometry(0.72, 0.66, 0.16, 10), color: 0xa9a191, cell: "stone", matrix: M(0, 1.98, 0) });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          parts.push({ geo: new THREE.BoxGeometry(0.20, 0.26, 0.20), color: V.WALL_STONE, cell: "stone", matrix: M(Math.cos(a) * 0.62, 2.18, Math.sin(a) * 0.62, 0, -a, 0) });
        }
        parts.push({ geo: new THREE.ConeGeometry(0.58, 0.62, 8), color: team, cell: "tile", matrix: M(0, 2.55, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.42, 0.05), color: 0x8a8070, matrix: M(0, 3.0, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.26, 0.18, 0.02), color: team, cell: "cloth", matrix: M(0.14, 3.10, 0) });
        // arrow slits + a banded door
        for (let i = 0; i < 3; i++) {
          const a = -0.6 + i * 0.6;
          parts.push({ geo: new THREE.BoxGeometry(0.07, 0.34, 0.06), color: 0x3a3128, matrix: M(Math.sin(a) * 0.63, 1.35, Math.cos(a) * 0.63, 0, a, 0) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.38, 0.58, 0.07), color: 0x4d3826, cell: "plank", matrix: M(0.08, 0.44, 0.66) });
        parts.push({ geo: new THREE.BoxGeometry(0.40, 0.05, 0.09), color: 0x6a6055, matrix: M(0.08, 0.58, 0.67) });
        parts.push({ geo: new THREE.BoxGeometry(0.30, 0.34, 0.05), color: team, cell: "cloth", matrix: M(-0.34, 0.86, 0.58, 0, -0.5, 0) });
        break;
      }
      case "fortress": {
        parts.push({ geo: new THREE.BoxGeometry(1.86, 0.20, 1.86), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.10, 0) });
        parts.push({ geo: new THREE.BoxGeometry(1.7, 1.45, 1.7), color: V.WALL_STONE, cell: "stone", matrix: M(0, 0.82, 0) });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2;
          const x = Math.cos(a) * 0.92, z = Math.sin(a) * 0.92;
          parts.push({ geo: new THREE.CylinderGeometry(0.32, 0.40, 1.95, 8), color: 0xc0b8a6, cell: "stone", matrix: M(x, 0.98, z) });
          parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.36, 0.10, 8), color: 0xa9a191, cell: "stone", matrix: M(x, 1.98, z) });
          parts.push({ geo: new THREE.ConeGeometry(0.44, 0.50, 8), color: team, cell: "tile", matrix: M(x, 2.28, z) });
        }
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          const ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? Math.sign(Math.cos(a)) * 0.78 : Math.cos(a) * 0.78;
          const az = Math.abs(Math.sin(a)) >= Math.abs(Math.cos(a)) ? Math.sign(Math.sin(a)) * 0.78 : Math.sin(a) * 0.78;
          parts.push({ geo: new THREE.BoxGeometry(0.22, 0.26, 0.22), color: V.WALL_STONE, cell: "stone", matrix: M(ax, 1.68, az) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.52, 0.72, 0.09), color: 0x4d3826, cell: "plank", matrix: M(0.1, 0.46, 0.86) });
        parts.push({ geo: new THREE.BoxGeometry(0.40, 0.46, 0.05), color: team, cell: "cloth", matrix: M(-0.5, 1.02, 0.86) });
        parts.push({ geo: new THREE.CylinderGeometry(0.16, 0.16, 0.05, 10), color: team, matrix: M(0.62, 1.06, 0.86, Math.PI / 2, 0, 0) });
        break;
      }
      case "fisher": {
        shell(parts, 0.95, 0.74, { roofH: 0.52, roof: 0x63859a, roofCell: "shingle", wall: 0xdccdae, wallCell: "plank" });
        // drying rack with the catch hanging on it
        post(parts, -0.62, 0.34, 0.66); post(parts, -0.62, -0.34, 0.66);
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.76), color: COL.BLD_WOOD, cell: "wood", matrix: M(-0.62, 0.64, 0) });
        for (let i = 0; i < 4; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.02, 0.10, 0.02), color: 0x8a7a5e, matrix: M(-0.62, 0.56, -0.27 + i * 0.18) });
          parts.push({ geo: new THREE.BoxGeometry(0.07, 0.22, 0.05), color: FSC.RES_COLOR.fish, matrix: M(-0.62, 0.42, -0.27 + i * 0.18, 0, 0, 0.08) });
        }
        // a net stretched on a frame + a beached rowboat
        parts.push({ geo: new THREE.BoxGeometry(0.55, 0.55, 0.03), color: COL.NET, cell: "mesh", matrix: M(0.66, 0.36, 0.20, 0, 0.5, 0.18) });
        parts.push({ geo: new THREE.BoxGeometry(0.86, 0.15, 0.34), color: COL.BOAT, cell: "plank", matrix: M(0.15, 0.14, 1.02, 0, 0.34, 0.10) });
        parts.push({ geo: new THREE.BoxGeometry(0.62, 0.10, 0.22), color: 0xb08a56, cell: "wood", matrix: M(0.15, 0.24, 1.02, 0, 0.34, 0.10) });
        parts.push({ geo: new THREE.BoxGeometry(0.03, 0.03, 0.52), color: 0x8a7a5e, matrix: M(0.32, 0.28, 1.02, 0.25, 0.34, 0) });
        // lobster pots
        for (let i = 0; i < 2; i++) {
          parts.push({ geo: new THREE.CylinderGeometry(0.11, 0.13, 0.14, 7), color: 0xb8a271, cell: "mesh", matrix: M(-0.28 + i * 0.22, 0.07, 0.86, 0, i, 0) });
        }
        break;
      }
      case "lumberjack": {
        shell(parts, 0.95, 0.74, { roofH: 0.52, roof: 0x8a6440, roofCell: "shingle", wall: 0xd7bc90, wallCell: "plank" });
        // the woodpile — the type's read-at-a-glance prop
        stack(parts, -0.72, 0.06, 6, FSC.RES_COLOR.lumber, "wood", 0, 0.105);
        // chopping block with the axe left standing in it
        parts.push({ geo: new THREE.CylinderGeometry(0.20, 0.23, 0.28, 8), color: COL.STUMP, matrix: M(0.62, 0.14, 0.48) });
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.42, 0.045), color: COL.TOOL, cell: "wood", matrix: M(0.62, 0.44, 0.48, 0.34, 0, 0.24) });
        parts.push({ geo: new THREE.BoxGeometry(0.17, 0.11, 0.05), color: 0xb9bfc6, cell: "metal", matrix: M(0.66, 0.63, 0.48, 0.34, 0, 0.24) });
        // sawdust + a couple of loose logs
        parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 0.62, 6), color: FSC.RES_COLOR.lumber, cell: "wood", matrix: M(0.30, 0.09, 0.90, Math.PI / 2, 0.5, 0) });
        parts.push({ geo: new THREE.CylinderGeometry(0.26, 0.30, 0.03, 9), color: 0xd8c79a, matrix: M(0.62, 0.015, 0.48) });
        break;
      }
      case "forester": {
        shell(parts, 0.9, 0.72, { roofH: 0.52, roof: 0x6f8a5c, roofCell: "thatch", wall: 0xdccfae });
        // a nursery of potted saplings in front
        for (let i = 0; i < 4; i++) {
          const x = -0.66 + (i % 2) * 0.28, z = 0.52 - ((i / 2) | 0) * 0.42;
          parts.push({ geo: new THREE.CylinderGeometry(0.13, 0.10, 0.14, 7), color: 0x9a6a48, cell: "plank", matrix: M(x, 0.07, z) });
          parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.03, 0.16, 5), color: 0x8a7248, matrix: M(x, 0.20, z) });
          parts.push({ geo: new THREE.IcosahedronGeometry(0.11, 0), color: i & 1 ? 0x8fce68 : COL.SAPLING, matrix: M(x, 0.30, z, i, i * 1.3, 0, 1, 0.75, 1) });
        }
        // watering barrel + a spade
        barrel(parts, 0.62, 0, 0.52, 1.0, 0x8a6a48);
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.44, 0.04), color: COL.TOOL, matrix: M(0.66, 0.30, 0.86, 0.22, 0, 0.12) });
        parts.push({ geo: new THREE.BoxGeometry(0.13, 0.16, 0.03), color: 0x9aa0a8, cell: "metal", matrix: M(0.70, 0.09, 0.90, 0.22, 0, 0.12) });
        break;
      }
      case "stonecutter": {
        shell(parts, 0.95, 0.74, { roofH: 0.52, wall: 0xcdc6b4, wallCell: "stone", roof: 0x8d949c, roofCell: "slate" });
        for (let i = 0; i < 5; i++) {
          const row = (i / 3) | 0, c = i % 3;
          parts.push({
            geo: new THREE.BoxGeometry(0.24, 0.19, 0.24), color: COL.STONE, cell: "stone",
            matrix: M(-0.68 + row * 0.10, 0.095 + row * 0.19, 0.46 - c * 0.26, 0, i * 0.3, 0),
          });
        }
        // chisels on a trestle
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.06, 0.72), color: COL.BLD_WOOD, cell: "wood", matrix: M(0.62, 0.42, 0.22) });
        post(parts, 0.62, 0.52, 0.42); post(parts, 0.62, -0.08, 0.42);
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.04, 0.24, 0.04), color: 0x9aa0a8, cell: "metal", matrix: M(0.62, 0.55, 0.42 - i * 0.20, 0, 0, 0.35) });
        }
        parts.push({ geo: new THREE.IcosahedronGeometry(0.19, 0), color: 0x8f959d, cell: "rock", matrix: M(0.30, 0.13, 0.92, 0.4, 0.7, 0.2) });
        break;
      }
      case "sawmill": {
        shell(parts, 1.7, 0.98, { roofType: "gable", roofH: 0.66, d: 0.85, roof: 0x8a6a42, roofCell: "shingle", wall: 0xd9c49a, wallCell: "plank" });
        const blade = bladeGeo();
        out.spin = blade; out.spinAt = [0.0, 0.66, 0.80]; out.axis = "z"; out.rate = 5.5;
        // blade housing + a sled of logs feeding it
        parts.push({ geo: new THREE.BoxGeometry(0.62, 0.10, 0.34), color: 0x7a6242, cell: "wood", matrix: M(0, 0.34, 0.80) });
        post(parts, -0.30, 0.80, 0.34); post(parts, 0.30, 0.80, 0.34);
        // plank stack (output) one side, log pile (input) the other
        for (let i = 0; i < 5; i++) {
          parts.push({
            geo: new THREE.BoxGeometry(0.80, 0.055, 0.28), color: FSC.RES_COLOR.plank, cell: "wood",
            matrix: M(-1.02, 0.045 + i * 0.06, 0.28 - (i % 2) * 0.05, 0, (i % 2) * 0.05, 0),
          });
        }
        stack(parts, 1.02, -0.16, 3, FSC.RES_COLOR.lumber, "wood", 0, 0.10);
        parts.push({ geo: new THREE.CylinderGeometry(0.24, 0.30, 0.03, 9), color: 0xd8c79a, matrix: M(0, 0.015, 1.00) });
        break;
      }
      case "farm": {
        // farmhouse + a red barn with a hay loft, paddock, hay cart
        shell(parts, 1.35, 0.98, { roofType: "gable", roofH: 0.72, roofCell: "thatch", roof: V.ROOF_THATCH, wall: 0xe6d6b4 });
        parts.push({ geo: new THREE.BoxGeometry(0.86, 0.66, 0.74), color: 0xb0563f, cell: "plank", matrix: M(-1.06, 0.36, -0.25) });
        for (let s = -1; s <= 1; s += 2) {
          parts.push({
            geo: new THREE.BoxGeometry(0.62, 0.08, 0.82), color: 0x8c4a34, cell: "shingle",
            matrix: M(-1.06 + s * 0.20, 0.76, -0.25, 0, 0, -s * 0.7),
          });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.30, 0.34, 0.05), color: 0x5d442a, cell: "plank", matrix: M(-1.06, 0.29, 0.13) });
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.24), color: V.WALL_TIMBER, matrix: M(-1.06, 0.86, 0.20) });
        fence(parts, 1.22, 8);
        // hay cart + loose bales
        parts.push({ geo: new THREE.BoxGeometry(0.56, 0.22, 0.38), color: 0x9a6a3c, cell: "plank", matrix: M(0.70, 0.22, 0.72, 0, 0.4, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.48, 0.24, 0.30), color: FSC.RES_COLOR.wheat, cell: "straw", matrix: M(0.70, 0.42, 0.72, 0, 0.4, 0) });
        for (let s = -1; s <= 1; s += 2) {
          parts.push({ geo: new THREE.CylinderGeometry(0.13, 0.13, 0.05, 8), color: 0x6f5334, matrix: M(0.70 + s * 0.06, 0.13, 0.72 + s * 0.19, 0, 0.4, Math.PI / 2) });
        }
        for (let i = 0; i < 2; i++) {
          parts.push({ geo: new THREE.CylinderGeometry(0.18, 0.18, 0.24, 8), color: FSC.RES_COLOR.wheat, cell: "straw", matrix: M(0.22 + i * 0.42, 0.12, -0.86, 0, 0, Math.PI / 2) });
        }
        break;
      }
      case "mill": {
        parts.push({ geo: new THREE.CylinderGeometry(0.70, 0.80, 0.16, 10), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.08, 0) });
        parts.push({ geo: new THREE.CylinderGeometry(0.44, 0.66, 1.5, 10), color: 0xe0d5ba, cell: "plaster", matrix: M(0, 0.80, 0) });
        // banded timbers up the tower
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.CylinderGeometry(0.66 - i * 0.075, 0.66 - i * 0.075, 0.055, 10), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, 0.30 + i * 0.44, 0) });
        }
        parts.push({ geo: new THREE.ConeGeometry(0.60, 0.52, 10), color: 0x8c4a34, cell: "shingle", matrix: M(0, 1.80, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.30, 0.48, 0.06), color: 0x4d3826, cell: "plank", matrix: M(0.10, 0.32, 0.60) });
        window_(parts, -0.22, 0.92, 0.50, 0.35, 0.16, 0.18);
        // grain sacks by the door
        for (let i = 0; i < 2; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.22, 0.28, 0.20), color: 0xd6c9a4, cell: "straw", matrix: M(-0.50 + i * 0.20, 0.14, 0.72, 0, i * 0.5, 0.06) });
        }
        out.spin = sailsGeo(); out.spinAt = [0, 1.52, 0.60]; out.axis = "z"; out.rate = 1.6;
        break;
      }
      case "bakery": {
        shell(parts, 1.35, 0.94, { roofH: 0.62, wall: 0xeadcbc, roofCell: "tile", roof: 0xb85c3c });
        out.smoke = chimney(parts, -0.50, -0.40, 1.70, 0.26);
        // a domed bread oven with a glowing mouth + a bread bench
        parts.push({ geo: new THREE.CylinderGeometry(0.34, 0.40, 0.42, 9), color: 0xc09a76, cell: "stone", matrix: M(0.66, 0.21, 0.46) });
        parts.push({ geo: new THREE.SphereGeometry(0.36, 9, 5, 0, 6.283, 0, 1.2), color: 0xb08a6a, cell: "stone", matrix: M(0.66, 0.40, 0.46) });
        parts.push({ geo: new THREE.BoxGeometry(0.26, 0.24, 0.07), color: COL.FIRE_BOX, matrix: M(0.66, 0.23, 0.80) });
        parts.push({ geo: new THREE.BoxGeometry(0.32, 0.05, 0.14), color: 0x6a5a4a, cell: "stone", matrix: M(0.66, 0.09, 0.84) });
        parts.push({ geo: new THREE.BoxGeometry(0.62, 0.05, 0.28), color: 0xb08a56, cell: "wood", matrix: M(-0.66, 0.44, 0.50) });
        post(parts, -0.88, 0.50, 0.44); post(parts, -0.44, 0.50, 0.44);
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.SphereGeometry(0.09, 6, 4), color: FSC.RES_COLOR.bread, matrix: M(-0.86 + i * 0.20, 0.51, 0.50, 0, 0, 0, 1.2, 0.7, 1) });
        }
        break;
      }
      case "pigfarm": {
        shell(parts, 1.25, 0.92, { roofType: "gable", roofH: 0.62, wall: 0xd8c09c, roofCell: "thatch", roof: V.ROOF_THATCH });
        fence(parts, 1.22, 9);
        const pigs = [[0.72, 0.55], [0.34, 0.92], [0.88, -0.42]];
        for (let i = 0; i < pigs.length; i++) {
          const yaw = i * 0.9;
          parts.push({ geo: new THREE.BoxGeometry(0.34, 0.20, 0.22), color: COL.PIG, matrix: M(pigs[i][0], 0.16, pigs[i][1], 0, yaw, 0) });
          parts.push({ geo: new THREE.BoxGeometry(0.15, 0.15, 0.14), color: COL.PIG, matrix: M(pigs[i][0] + Math.sin(yaw) * 0.20, 0.19, pigs[i][1] + Math.cos(yaw) * 0.20, 0, yaw, 0) });
          parts.push({ geo: new THREE.CylinderGeometry(0.045, 0.045, 0.04, 6), color: 0xf2c0c4, matrix: M(pigs[i][0] + Math.sin(yaw) * 0.28, 0.19, pigs[i][1] + Math.cos(yaw) * 0.28, Math.PI / 2, 0, 0) });
          for (let L = -1; L <= 1; L += 2) {
            parts.push({
              geo: new THREE.BoxGeometry(0.20, 0.09, 0.055), color: 0xd08f94,
              matrix: M(pigs[i][0] + Math.sin(yaw + L * 1.5708) * 0.085, 0.05, pigs[i][1] + Math.cos(yaw + L * 1.5708) * 0.085, 0, yaw, 0),
            });
          }
        }
        // trough + a mud wallow
        parts.push({ geo: new THREE.BoxGeometry(0.62, 0.11, 0.20), color: 0x8a6a48, cell: "wood", matrix: M(-0.10, 0.06, 0.96) });
        parts.push({ geo: new THREE.CylinderGeometry(0.30, 0.30, 0.02, 10), color: 0x6b5844, cell: "dirt", matrix: M(0.62, 0.012, -0.80) });
        break;
      }
      case "butcher": {
        shell(parts, 1.25, 0.92, { roofH: 0.60, wall: 0xe8d5c4, roof: 0x9c4b46, roofCell: "tile" });
        out.smoke = chimney(parts, -0.46, -0.40, 1.62, 0.22);
        // an awning over a chopping table with cuts hanging
        parts.push({ geo: new THREE.BoxGeometry(1.30, 0.05, 0.54), color: 0xb85c4c, cell: "cloth", matrix: M(0, 0.98, 0.68, 0.32, 0, 0) });
        post(parts, -0.56, 0.88, 0.78); post(parts, 0.56, 0.88, 0.78);
        parts.push({ geo: new THREE.BoxGeometry(1.10, 0.06, 0.34), color: 0xc3a982, cell: "wood", matrix: M(0, 0.52, 0.72) });
        post(parts, -0.46, 0.72, 0.52); post(parts, 0.46, 0.72, 0.52);
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.02, 0.14, 0.02), color: 0x8a7a5e, matrix: M(-0.34 + i * 0.34, 0.80, 0.62) });
          parts.push({ geo: new THREE.BoxGeometry(0.16, 0.24, 0.13), color: FSC.RES_COLOR.meat, matrix: M(-0.34 + i * 0.34, 0.62, 0.62) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.16, 0.03, 0.10), color: 0xd8dde3, cell: "metal", matrix: M(0.24, 0.57, 0.74, 0, 0.4, 0) });
        break;
      }
      case "stoneMine": case "coalMine": case "ironMine": case "goldMine": {
        const tint = MINE_TINT[type];
        // a timber-framed adit cut into the rock, with a headframe and a cart
        parts.push({ geo: new THREE.BoxGeometry(1.20, 0.14, 1.00), color: V.FOUNDATION, cell: "rock", matrix: M(0, 0.07, 0) });
        parts.push({ geo: new THREE.BoxGeometry(1.02, 0.66, 0.92), color: 0xb0a48c, cell: "rock", matrix: M(0, 0.44, 0) });
        parts.push({ geo: new THREE.BoxGeometry(1.16, 0.11, 1.06), color: 0x7f6244, cell: "wood", matrix: M(0, 0.80, 0) });
        for (let s2 = -1; s2 <= 1; s2 += 2) {
          parts.push({
            geo: new THREE.BoxGeometry(0.66, 0.09, 1.08), color: 0x9a7449, cell: "plank",
            matrix: M(s2 * 0.26, 0.95, 0, 0, 0, -s2 * 0.55),
          });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.09, 0.09, 1.10), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, 1.10, 0) });
        // the mouth: a black opening in a heavy timber frame
        parts.push({ geo: new THREE.BoxGeometry(0.56, 0.54, 0.06), color: 0x241f1a, matrix: M(0, 0.36, 0.47) });
        parts.push({ geo: new THREE.BoxGeometry(0.10, 0.62, 0.10), color: V.WALL_TIMBER, cell: "wood", matrix: M(-0.31, 0.40, 0.48) });
        parts.push({ geo: new THREE.BoxGeometry(0.10, 0.62, 0.10), color: V.WALL_TIMBER, cell: "wood", matrix: M(0.31, 0.40, 0.48) });
        parts.push({ geo: new THREE.BoxGeometry(0.76, 0.11, 0.13), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, 0.72, 0.48) });
        // headframe over the shaft
        post(parts, -0.34, 0.28, 1.30); post(parts, 0.34, 0.28, 1.30);
        parts.push({ geo: new THREE.BoxGeometry(0.86, 0.09, 0.09), color: COL.BLD_WOOD, cell: "wood", matrix: M(0, 1.28, 0.28) });
        for (let s = -1; s <= 1; s += 2) {
          parts.push({ geo: new THREE.BoxGeometry(0.06, 0.90, 0.06), color: COL.BLD_WOOD, cell: "wood", matrix: M(s * 0.34, 0.86, 0.62, -0.55, 0, 0) });
        }
        // rails + ore cart heaped with the mineral
        for (let s = -1; s <= 1; s += 2) {
          parts.push({ geo: new THREE.BoxGeometry(0.04, 0.03, 0.90), color: 0x9aa0a8, cell: "metal", matrix: M(0.62 + s * 0.10, 0.02, 0.55) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.36, 0.22, 0.28), color: 0x6b5137, cell: "plank", matrix: M(0.62, 0.15, 0.60) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.16, 0), color: tint, cell: "rock", matrix: M(0.62, 0.30, 0.60) });
        for (let s = -1; s <= 1; s += 2) {
          parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 0.03, 7), color: 0x4a423a, matrix: M(0.62 + s * 0.10, 0.05, 0.72, 0, 0, Math.PI / 2) });
        }
        // spoil heap
        parts.push({ geo: new THREE.ConeGeometry(0.30, 0.26, 7), color: tint, cell: "rock", matrix: M(-0.70, 0.13, 0.48) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.13, 0), color: tint, cell: "rock", matrix: M(-0.48, 0.09, 0.74, 0.3, 0.4, 0) });
        out.spin = wheelGeo(); out.spinAt = [0, 1.28, 0.28]; out.axis = "z"; out.rate = 2.4;
        break;
      }
      case "smelter": case "goldsmelter": {
        const gold = type === "goldsmelter";
        shell(parts, 1.25, 0.88, { roofType: "flat", wall: 0xb6ad9e, wallCell: "stone", roof: 0x9a7d5e, roofCell: "plank", win: false });
        out.smoke = chimney(parts, -0.44, -0.32, 1.66, 0.28);
        // the furnace stack itself, glowing at the base
        parts.push({ geo: new THREE.CylinderGeometry(0.28, 0.36, 0.86, 9), color: 0x9a8f80, cell: "stone", matrix: M(0.34, 0.51, -0.02) });
        parts.push({ geo: new THREE.CylinderGeometry(0.34, 0.30, 0.08, 9), color: 0x6f665c, matrix: M(0.34, 0.98, -0.02) });
        parts.push({ geo: new THREE.BoxGeometry(0.40, 0.34, 0.08), color: COL.FIRE_BOX, matrix: M(0.30, 0.34, 0.64) });
        parts.push({ geo: new THREE.BoxGeometry(0.50, 0.06, 0.14), color: 0x5a5048, cell: "stone", matrix: M(0.30, 0.15, 0.70) });
        // ore in, ingots out
        parts.push({ geo: new THREE.IcosahedronGeometry(0.18, 0), color: gold ? FSC.RES_COLOR.goldOre : FSC.RES_COLOR.ironOre, cell: "rock", matrix: M(0.76, 0.13, 0.56, 0.3, 0.5, 0) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.17, 0), color: FSC.RES_COLOR.coal, cell: "rock", matrix: M(-0.76, 0.12, 0.50, 0.2, 1.1, 0) });
        for (let i = 0; i < 3; i++) {
          parts.push({
            geo: new THREE.BoxGeometry(0.24, 0.07, 0.13), color: gold ? FSC.RES_COLOR.goldBar : FSC.RES_COLOR.steel, cell: "metal",
            matrix: M(-0.40 + (i % 2) * 0.06, 0.10 + i * 0.075, 0.80, 0, i * 0.12, 0),
          });
        }
        break;
      }
      case "toolmaker": {
        shell(parts, 1.3, 0.92, { roofType: "gable", roofH: 0.62, wall: 0xd8c096, roof: 0x6b6f77, roofCell: "slate" });
        out.smoke = chimney(parts, 0.46, -0.40, 1.52, 0.20);
        // grindstone + workbench with a rack of tools
        parts.push({ geo: new THREE.BoxGeometry(0.38, 0.26, 0.30), color: 0x8a6a48, cell: "wood", matrix: M(0.64, 0.13, 0.58) });
        parts.push({ geo: new THREE.CylinderGeometry(0.18, 0.18, 0.07, 12), color: 0x9aa0a8, cell: "rock", matrix: M(0.64, 0.34, 0.58, 0, 0, Math.PI / 2) });
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.24), color: 0x6f5334, matrix: M(0.64, 0.34, 0.58) });
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.06, 0.98), color: COL.BLD_WOOD, cell: "wood", matrix: M(-0.72, 0.60, 0.14) });
        post(parts, -0.72, 0.60, 0.60); post(parts, -0.72, -0.32, 0.60);
        const toolCols = [COL.TOOL, 0x9aa0a8, 0xb9bfc6, 0x8a8f96];
        for (let i = 0; i < 4; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.04, 0.30, 0.04), color: COL.TOOL, matrix: M(-0.72, 0.42, 0.44 - i * 0.24, 0, 0, 0.14) });
          parts.push({ geo: new THREE.BoxGeometry(0.13, 0.09, 0.05), color: toolCols[i], cell: "metal", matrix: M(-0.72, 0.26, 0.44 - i * 0.24) });
        }
        break;
      }
      case "weaponsmith": {
        shell(parts, 1.25, 0.90, { roofType: "flat", wall: 0xbfae96, wallCell: "plaster", roof: 0x8f7a5c, roofCell: "plank", win: false });
        out.smoke = chimney(parts, 0.44, -0.34, 1.58, 0.26);
        window_(parts, -0.26, 0.66, 0.66, 0, 0.24, 0.22);
        // forge with an anvil, a quench barrel and a finished blade on the rack
        parts.push({ geo: new THREE.BoxGeometry(0.44, 0.34, 0.36), color: 0x8a8074, cell: "stone", matrix: M(-0.62, 0.17, 0.56) });
        parts.push({ geo: new THREE.BoxGeometry(0.30, 0.18, 0.06), color: COL.FIRE_BOX, matrix: M(-0.62, 0.22, 0.75) });
        parts.push({ geo: new THREE.BoxGeometry(0.26, 0.10, 0.16), color: 0x5a5560, cell: "metal", matrix: M(0.60, 0.30, 0.58) });
        parts.push({ geo: new THREE.BoxGeometry(0.12, 0.16, 0.12), color: 0x5a5560, matrix: M(0.60, 0.16, 0.58) });
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.52, 0.06), color: FSC.RES_COLOR.sword, cell: "metal", matrix: M(0.60, 0.60, 0.58, 0, 0, 0.20) });
        parts.push({ geo: new THREE.BoxGeometry(0.18, 0.05, 0.06), color: 0x6f5334, matrix: M(0.63, 0.36, 0.58) });
        barrel(parts, 0.14, 0, 0.86, 0.9, 0x7a5f42);
        parts.push({ geo: new THREE.CylinderGeometry(0.19, 0.19, 0.07, 10), color: FSC.RES_COLOR.shield, cell: "metal", matrix: M(0.68, 0.60, -0.28, 0, 0, Math.PI / 2) });
        break;
      }
      case "boatwright": {
        shell(parts, 0.95, 0.74, { roofH: 0.52, wall: 0xd8c096, wallCell: "plank", roof: 0x4f7fa8, roofCell: "shingle" });
        // a hull on the slipway, ribs showing
        parts.push({ geo: new THREE.BoxGeometry(0.98, 0.16, 0.38), color: COL.BOAT, cell: "plank", matrix: M(0.12, 0.20, 0.82, 0, 0.2, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.72, 0.14, 0.26), color: 0xb08a56, cell: "wood", matrix: M(0.12, 0.34, 0.82, 0, 0.2, 0) });
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.05, 0.20, 0.34), color: 0x9a6a3c, matrix: M(-0.14 + i * 0.28, 0.36, 0.82 + (i - 1) * 0.06, 0, 0.2, 0) });
        }
        post(parts, -0.36, 0.78, 0.26); post(parts, 0.58, 0.78, 0.26);
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.66, 0.055, 0.22), color: FSC.RES_COLOR.plank, cell: "wood", matrix: M(-0.74, 0.05 + i * 0.06, 0.34) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.04, 0.60), color: 0x8a7a5e, matrix: M(-0.60, 0.34, 0.80, 0.3, 0.4, 0) });
        break;
      }
      default:
        shell(parts, 1.15, 0.86, {});
    }
    return out;
  }

  /** Finished building of `type` in `playerIdx`'s colours. */
  FSModels.building = function (type, playerIdx) {
    if (type === "castle") return FSModels.castle(playerIdx);
    const g = new THREE.Group();
    const built = buildingParts(type, playerIdx);
    /* ===== PHASE-V: one shared atlas material for every body, so the whole
     * village still costs exactly one draw call per building. ===== */
    const body = new THREE.Mesh(mergeColored(built.parts), FSModels.bldMat());
    body.name = "bldBody";
    g.add(body);
    if (built.spin) {
      const spin = new THREE.Mesh(built.spin, FSModels.bldMat());
      spin.position.set(built.spinAt[0], built.spinAt[1], built.spinAt[2]);
      spin.name = "bldSpin";
      g.add(spin);
      g.userData.spin = spin;
      g.userData.spinAxis = built.axis;
      g.userData.spinRate = built.rate;
    }
    if (built.smoke) { g.userData.smoke = built.smoke; g.userData.chimney = built.smoke; }
    /* ===== PHASE-V: the props that say what happens inside are merged into the
     * body geometry (0 extra draw calls) — this is the manifest of what a type
     * actually grows around its footprint, so tests + future passes can read it. */
    g.userData.props = FSModels.BLD_PROPS[type] || [];
    g.userData.type = type;
    return g;
  };

  /** what each type grows around its footprint (see buildingParts) */
  FSModels.BLD_PROPS = {
    stock: ["loadingDock", "barrels", "hoistBeam"],
    hut: ["palisade", "bannerPole", "wallShield"],
    tower: ["arrowSlits", "bandedDoor", "wallShield", "pennant"],
    fortress: ["cornerTowers", "battlements", "banner", "shield"],
    fisher: ["dryingRack", "catch", "net", "rowboat", "lobsterPots"],
    lumberjack: ["woodpile", "choppingBlock", "axe", "sawdust", "logs"],
    forester: ["saplingPots", "wateringBarrel", "spade"],
    stonecutter: ["blockStack", "trestle", "chisels", "boulder"],
    sawmill: ["bladeHousing", "plankStack", "logPile", "sawdust"],
    farm: ["barn", "paddockFence", "hayCart", "bales"],
    mill: ["timberBands", "grainSacks", "sails"],
    bakery: ["chimney", "breadOven", "breadBench", "loaves"],
    pigfarm: ["paddockFence", "pigs", "trough", "wallow"],
    butcher: ["chimney", "awning", "choppingTable", "cuts", "cleaver"],
    stoneMine: ["aditFrame", "headframe", "oreCart", "rails", "spoilHeap"],
    coalMine: ["aditFrame", "headframe", "oreCart", "rails", "spoilHeap"],
    ironMine: ["aditFrame", "headframe", "oreCart", "rails", "spoilHeap"],
    goldMine: ["aditFrame", "headframe", "oreCart", "rails", "spoilHeap"],
    smelter: ["chimney", "furnaceStack", "oreHeap", "coalHeap", "ingots"],
    goldsmelter: ["chimney", "furnaceStack", "oreHeap", "coalHeap", "ingots"],
    toolmaker: ["chimney", "grindstone", "toolRack", "workbench"],
    weaponsmith: ["chimney", "forge", "anvil", "swordRack", "quenchBarrel", "shield"],
    boatwright: ["slipway", "hull", "ribs", "plankStack", "oar"],
    castle: ["cornerTowers", "battlements", "gate", "banner", "keepRoof"],
  };
  /** Read-only manifest of a type's charm pass (props / chimney / machinery). */
  FSModels.buildingDetail = function (type) {
    const g = FSModels.building(type, 0);
    let tris = 0;
    g.traverse((o) => { if (o.geometry && o.geometry.attributes.position) tris += o.geometry.attributes.position.count / 3; });
    const out = {
      type: type, props: g.userData.props || [], chimney: g.userData.chimney || null,
      spin: !!g.userData.spin, tris: Math.round(tris),
      textured: !!(g.children[0] && g.children[0].material && g.children[0].material.map),
    };
    g.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    return out;
  };

  /** A rowing boat — drawn under a sailor while he is out on the water. */
  FSModels.boatGeo = function () {
    return cached("geo:boat", () => mergeColored([
      // hull: a tapered clinker-built shell with a raised bow and stern
      { geo: new THREE.BoxGeometry(0.82, 0.15, 0.40), color: COL.BOAT, cell: "plank", matrix: M(0, 0.075, 0) },
      { geo: new THREE.BoxGeometry(0.86, 0.07, 0.44), color: 0xa9743d, cell: "plank", matrix: M(0, 0.15, 0) },
      { geo: new THREE.BoxGeometry(0.22, 0.20, 0.24), color: COL.BOAT, cell: "plank", matrix: M(0, 0.14, 0.22, 0.34, 0, 0) },
      { geo: new THREE.BoxGeometry(0.20, 0.17, 0.22), color: COL.BOAT, cell: "plank", matrix: M(0, 0.13, -0.22, -0.30, 0, 0) },
      // thwart + oars shipped along the gunwale
      { geo: new THREE.BoxGeometry(0.44, 0.05, 0.30), color: 0xc0a074, cell: "wood", matrix: M(0, 0.17, 0) },
      { geo: new THREE.BoxGeometry(0.05, 0.04, 0.62), color: 0x8a7a5e, matrix: M(0.16, 0.20, 0, 0.22, 0, 0) },
      { geo: new THREE.BoxGeometry(0.13, 0.02, 0.16), color: 0x8a7a5e, matrix: M(0.16, 0.27, 0.32, 0.22, 0, 0) },
    ]));
  };

  /* ===================================================================== */
  /* ===== PHASE-V: sky, water FX and the ambient-effects geometry ======== */
  /* ===================================================================== */

  /** A gradient sky dome — warm at the horizon, deep blue overhead. */
  FSModels.skyDome = function (radius) {
    const V = FSC.VIS;
    const geo = new THREE.SphereGeometry(radius || 900, 20, 14);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(V.SKY_TOP), mid = new THREE.Color(V.SKY_MID), low = new THREE.Color(V.SKY_LOW);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / (radius || 900);         // -1 .. 1
      if (y >= 0.06) c.copy(mid).lerp(top, Math.min(1, (y - 0.06) / 0.66));
      else c.copy(low).lerp(mid, Math.max(0, Math.min(1, (y + 0.22) / 0.28)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    /* Drawn LAST in the opaque pass (no renderOrder override → three sorts
     * opaque front-to-back, and the dome is the farthest thing there is) with
     * depth TESTING on and depth WRITING off. That means every pixel already
     * covered by terrain, water or a roof is rejected before it is ever shaded
     * — a full-screen gradient fill turns into "only the sky you can see". */
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    const mesh = new THREE.Mesh(geo, m);
    mesh.name = "sky";
    /* renderOrder must be forced: three sorts the opaque pass front-to-back by
     * BOUNDING-SPHERE CENTRE, and this dome is re-centred on the camera every
     * frame, so its centre depth is ~0 and it would otherwise sort FIRST — the
     * exact opposite of what the depth-reject trick needs. */
    mesh.renderOrder = 100;
    mesh.frustumCulled = false;
    return mesh;
  };

  /* GOTCHA (cost an hour of black blobs on the lake): three's colour chain only
   * applies an InstancedMesh's per-instance colour when USE_COLOR is ALSO
   * defined — i.e. when the material says vertexColors AND the geometry carries
   * a `color` attribute. A bare PlaneGeometry has none, so the attribute reads
   * the default (0,0,0) and every instance paints itself black. Any plain
   * primitive that wants per-instance tinting goes through here first. */
  function whiteColors(geo) {
    if (geo.attributes.color) return geo;
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) c[i] = 1;
    geo.setAttribute("color", new THREE.BufferAttribute(c, 3));
    return geo;
  }
  FSModels.whiteColors = whiteColors;

  /** thin bright ring of surf laid on a water vertex that touches land */
  FSModels.foamGeo = function () {
    return cached("geo:foam", () => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return whiteColors(g);
    });
  };
  FSModels.foamMat = function () {
    return cached("mat:foam", () => new THREE.MeshBasicMaterial({
      color: FSC.VIS.FOAM_COL, map: FSModels.puffTex(), transparent: true,
      opacity: 0.85, depthWrite: false, vertexColors: true, blending: THREE.NormalBlending,
    }));
  };
  /** a twinkling sun glint, additive so it never darkens the water */
  FSModels.sparkGeo = function () {
    return cached("geo:spark", () => {
      const g = new THREE.PlaneGeometry(1, 1);
      g.rotateX(-Math.PI / 2);
      return whiteColors(g);
    });
  };
  FSModels.sparkMat = function () {
    return cached("mat:spark", () => new THREE.MeshBasicMaterial({
      color: FSC.VIS.SPARK_COL, map: FSModels.glintTex(), transparent: true,
      opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    }));
  };
  /** the flat billboard every soft particle (smoke, splash, dust) is drawn on */
  FSModels.puffGeo = function () {
    return cached("geo:puffquad", () => whiteColors(new THREE.PlaneGeometry(1, 1)));
  };
  FSModels.puffMat = function (key, color, blend) {
    return cached("mat:puff:" + key, () => new THREE.MeshBasicMaterial({
      color: color, map: FSModels.puffTex(), transparent: true, opacity: 0.85,
      depthWrite: false, vertexColors: true, side: THREE.DoubleSide,
      blending: blend === "add" ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
  };

  /** a little silver fish, mid-leap */
  FSModels.fishGeo = function () {
    return cached("geo:fish", () => mergeColored([
      { geo: new THREE.IcosahedronGeometry(0.115, 0), color: 0xdfe9f2, matrix: M(0, 0, 0, 0, 0, 0, 1.9, 0.82, 0.62) },
      { geo: new THREE.ConeGeometry(0.085, 0.16, 4), color: 0xc2d4e2, matrix: M(-0.22, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.35) },
      { geo: new THREE.BoxGeometry(0.09, 0.075, 0.02), color: 0xb4c8d8, matrix: M(0.02, 0.075, 0, 0, 0, 0.3) },
      { geo: new THREE.BoxGeometry(0.03, 0.03, 0.02), color: 0x2c3a46, matrix: M(0.15, 0.025, 0.05) },
    ]));
  };
  /** expanding ring of water thrown up by a splash */
  FSModels.ringGeo = function () {
    return cached("geo:fxring", () => {
      const g = new THREE.RingGeometry(0.62, 1.0, 16);
      g.rotateX(-Math.PI / 2);
      return whiteColors(g);
    });
  };
  FSModels.ringMat = function () {
    return cached("mat:fxring", () => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false,
      side: THREE.DoubleSide, vertexColors: true,
    }));
  };
  /** a droplet of water / a falling leaf / a mote of road dust */
  FSModels.moteGeo = function () {
    return cached("geo:mote", () => mergeColored([
      { geo: new THREE.BoxGeometry(1, 1, 1), color: 0xffffff, matrix: M(0, 0, 0) },
    ]));
  };
  /** a leaf: a small twisted blade that flutters down */
  FSModels.leafGeo = function () {
    return cached("geo:leaf", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.13, 0.02, 0.075), color: 0xffffff, matrix: M(0, 0, 0) },
      { geo: new THREE.BoxGeometry(0.05, 0.02, 0.05), color: 0xffffff, matrix: M(0.08, 0.005, 0, 0, 0.6, 0) },
    ]));
  };
  /* ===== PHASE P: a bird's flap used to be `scale.z` on the WHOLE bird, so
   * the body squashed with the wings and the wings themselves never moved —
   * it reads as a pulsing dart, not a flying thing. Body and wing are now two
   * geometries in two instanced pools, and the renderer hinges each wing at
   * the shoulder. Two extra draw calls for every bird and butterfly on the
   * map, and they finally fly. ===== */
  /** a bird's body: torso, tail and beak — no wings */
  FSModels.birdGeo = function () {
    return cached("geo:bird", () => mergeColored([
      { geo: new THREE.IcosahedronGeometry(0.16, 0), color: 0x38414c, matrix: M(0, 0, 0, 0, 0, 0, 1.7, 0.7, 0.62) },
      { geo: new THREE.ConeGeometry(0.10, 0.24, 4), color: 0x2c343d, matrix: M(-0.26, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.4) },
      { geo: new THREE.ConeGeometry(0.05, 0.10, 4), color: 0xd8a24a, matrix: M(0.19, 0, 0, 0, 0, -Math.PI / 2) },
    ]));
  };
  /** ONE bird wing, hinged at the origin, reaching out along +z */
  FSModels.birdWingGeo = function () {
    return cached("geo:birdwing", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.20, 0.022, 0.30), color: 0x424c58, matrix: M(0, 0, 0.16) },
      { geo: new THREE.BoxGeometry(0.13, 0.020, 0.20), color: 0x4e5a68, matrix: M(-0.02, 0, 0.38) },
    ]));
  };
  /** a butterfly's body: a thread with a head */
  FSModels.butterflyGeo = function () {
    return cached("geo:butterfly", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.10, 0.016, 0.03), color: 0x3a3026, matrix: M(0, 0, 0) },
      { geo: new THREE.BoxGeometry(0.03, 0.022, 0.026), color: 0x2a2118, matrix: M(0.055, 0.002, 0) },
    ]));
  };
  /** ONE butterfly wing (fore + hind), hinged at the body, reaching along +z */
  FSModels.butterflyWingGeo = function () {
    return cached("geo:butterflywing", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.095, 0.012, 0.10), color: 0xffffff, matrix: M(0.015, 0, 0.058) },
      { geo: new THREE.BoxGeometry(0.065, 0.012, 0.07), color: 0xf0f0f0, matrix: M(-0.035, 0, 0.105) },
    ]));
  };
  /** A geologist's sign: the post is shared, the board carries the mineral colour. */
  FSModels.signPostGeo = function () {
    return cached("geo:signpost", () => mergeColored([
      { geo: new THREE.CylinderGeometry(0.05, 0.06, 0.62, 5), color: COL.SIGN_POST, matrix: M(0, 0.31, 0) },
      { geo: new THREE.BoxGeometry(0.5, 0.05, 0.05), color: COL.SIGN_POST, matrix: M(0, 0.58, 0) },
    ]));
  };
  FSModels.signBoardGeo = function () {
    return cached("geo:signboard", () => mergeColored([
      // a broad painted board, tilted to catch the light — the colour is the mineral
      { geo: new THREE.BoxGeometry(0.46, 0.34, 0.06), color: 0xffffff, matrix: M(0, 0.72, 0.02, -0.22, 0, 0) },
      { geo: new THREE.BoxGeometry(0.5, 0.06, 0.08), color: 0xffffff, matrix: M(0, 0.9, 0.06, -0.22, 0, 0) },
    ]));
  };
  /** One smoke puff (billboard-ish blob) — instanced, animated by the renderer. */
  FSModels.smokeGeo = function () {
    return cached("geo:smoke", () => mergeColored([
      { geo: new THREE.IcosahedronGeometry(0.18, 0), color: 0xffffff, matrix: M(0, 0, 0) },
    ]));
  };

  /**
   * Generic building stand-in — kept for anything without its own silhouette.
   * type: FSC.BLD key, size: 0 small / 1 medium / 2 large.
   */
  FSModels.placeholderBuilding = function (type, size, playerIdx) {
    const def = FSC.BLD[type] || {};
    const sz = size === undefined ? (def.size || 0) : size;
    const w = [1.15, 1.6, 2.1][sz], h = [0.85, 1.15, 1.4][sz];
    const g = new THREE.Group();
    const parts = [];
    const isMil = !!def.mil, isMine = !!def.mine, isStore = !!def.warehouse;
    const wall = isMil ? COL.CASTLE_WALL : COL.BLD_WALL;
    parts.push({ geo: new THREE.BoxGeometry(w, h, w), color: wall, matrix: M(0, h / 2, 0) });
    if (isMil) {
      for (let i = 0; i < 4; i++) {
        const a = Math.PI / 4 + i * Math.PI / 2;
        parts.push({
          geo: new THREE.BoxGeometry(0.26, 0.24, 0.26), color: wall,
          matrix: M(Math.cos(a) * w * 0.42, h + 0.12, Math.sin(a) * w * 0.42),
        });
      }
    } else if (isMine) {
      parts.push({ geo: new THREE.BoxGeometry(w * 0.5, 0.7, 0.14), color: COL.BLD_WOOD, matrix: M(0, h + 0.35, w * 0.2) });
      parts.push({ geo: new THREE.CylinderGeometry(0.28, 0.28, 0.12, 8), color: COL.BLD_WOOD, matrix: M(0, h + 0.62, w * 0.2, Math.PI / 2, 0, 0) });
    } else {
      parts.push({
        geo: new THREE.ConeGeometry(w * 0.82, isStore ? 0.75 : 0.55, 4),
        color: COL.BLD_ROOF, matrix: M(0, h + (isStore ? 0.37 : 0.27), 0, 0, Math.PI / 4, 0),
      });
    }
    parts.push({ geo: new THREE.BoxGeometry(0.3, h * 0.55, 0.08), color: 0x4d3826, matrix: M(w * 0.18, h * 0.28, w * 0.5) });
    const body = new THREE.Mesh(mergeColored(parts), mat(0xffffff, { vertexColors: true, emissiveOf: wall, emissiveK: 0.28 }));
    body.name = "bldBody";
    g.add(body);
    if (playerIdx !== undefined) {
      const flagPole = new THREE.Mesh(
        new THREE.BoxGeometry(0.14, 0.3, 0.02),
        mat(FSModels.playerColor(playerIdx))
      );
      flagPole.position.set(0, h + 0.5, 0);
      g.add(flagPole);
    }
    g.userData.type = type;
    return g;
  };

  /* ===================================================================== */
  /* ===== PHASE-B: flags, goods crates, serfs, construction stages ======= */
  /* ===================================================================== */

  /** Shared geometry cache — every Phase-B visual is instanced, so build once. */
  function cached(key, make) { return CACHE[key] || (CACHE[key] = make()); }

  /** Flag pole (shared by every player); the pennant carries the player colour. */
  FSModels.flagPoleGeo = function () {
    return cached("geo:flagpole", () => mergeColored([
      { geo: new THREE.CylinderGeometry(0.055, 0.075, 1.35, 6), color: COL.FLAG_POLE, matrix: M(0, 0.675, 0) },
      { geo: new THREE.CylinderGeometry(0.24, 0.30, 0.10, 8), color: 0x8a7d63, matrix: M(0, 0.05, 0) },
    ]));
  };
  /** Triangular pennant, tinted per instance with the owner's colour. */
  FSModels.pennantGeo = function () {
    return cached("geo:pennant", () => {
      const g = new THREE.ConeGeometry(0.16, 0.52, 3);
      g.rotateZ(-Math.PI / 2);
      g.rotateY(Math.PI / 6);
      return mergeColored([{ geo: g, color: 0xffffff, matrix: M(0.26, 1.16, 0) }]);
    });
  };
  /** Tiny good crate — one instanced mesh, per-instance colour from FSC.RES_COLOR. */
  FSModels.crateGeo = function () {
    return cached("geo:crate", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.30, 0.22, 0.30), color: 0xffffff, matrix: M(0, 0.11, 0) },
      { geo: new THREE.BoxGeometry(0.33, 0.05, 0.33), color: 0xdddddd, matrix: M(0, 0.215, 0) },
    ]));
  };
  FSModels.vcMat = function (key, emissiveOf, k) {
    return cached("mat:" + key, () => {
      /* ===== PHASE-V: pools whose geometry carries atlas uv (scree, wheat)
       * want the atlas bound, everything else stays untextured. ===== */
      const m = mat(0xffffff, { vertexColors: true, emissiveOf: emissiveOf, emissiveK: k });
      if (key === "scree") m.map = bldAtlas();
      m.userData.shared = true;
      return m;
    });
  };

  /**
   * A serf minifig (~140 tris): boots, smock, player-colour sash, head, a hat in
   * the profession colour and a tool in hand. One merged geometry per
   * (job, player) so the renderer can draw the whole workforce instanced.
   */
  /* ===== PHASE-V: the tool a job actually swings, in silhouette ===== */
  function toolParts(parts, tool, hx, hy, hz) {
    const steel = 0xc3c9d1, dark = 0x8a8f96;
    switch (tool) {
      case "axe":
        parts.push({ geo: new THREE.BoxGeometry(0.042, 0.44, 0.042), color: COL.TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.17, 0.15, 0.05), color: steel, matrix: M(hx + 0.05, hy + 0.22, hz, 0, 0, -0.15) });
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.17, 0.055), color: dark, matrix: M(hx - 0.02, hy + 0.22, hz) });
        break;
      case "saw":
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.16, 0.045), color: COL.TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.40, 0.13, 0.02), color: steel, matrix: M(hx + 0.18, hy + 0.12, hz, 0, 0, 0.22) });
        break;
      case "scythe":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.56, 0.04), color: COL.TOOL, matrix: M(hx, hy + 0.06, hz, 0, 0, 0.10) });
        parts.push({ geo: new THREE.BoxGeometry(0.42, 0.05, 0.03), color: steel, matrix: M(hx + 0.16, hy + 0.34, hz, 0, 0, -0.42) });
        break;
      case "pick":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.46, 0.04), color: COL.TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.05, 0.05), color: dark, matrix: M(hx, hy + 0.23, hz, 0, 0, 0.24) });
        break;
      case "hammer":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.34, 0.04), color: COL.TOOL, matrix: M(hx, hy + 0.02, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.16, 0.10, 0.10), color: dark, matrix: M(hx, hy + 0.20, hz) });
        break;
      case "shovel":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.46, 0.04), color: COL.TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.15, 0.18, 0.03), color: 0x9aa0a8, matrix: M(hx, hy - 0.24, hz) });
        break;
      case "rod":
        parts.push({ geo: new THREE.BoxGeometry(0.03, 0.62, 0.03), color: COL.TOOL, matrix: M(hx, hy + 0.10, hz, -0.5, 0, 0.15) });
        parts.push({ geo: new THREE.BoxGeometry(0.012, 0.012, 0.30), color: 0xdfe6ee, matrix: M(hx + 0.06, hy + 0.36, hz + 0.16) });
        break;
      case "cleaver":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.16, 0.04), color: COL.TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.20, 0.16, 0.02), color: steel, matrix: M(hx + 0.06, hy + 0.16, hz) });
        break;
      case "pincer":
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.30, 0.04), color: dark, matrix: M(hx - 0.02, hy, hz, 0, 0, 0.12) });
        parts.push({ geo: new THREE.BoxGeometry(0.04, 0.30, 0.04), color: dark, matrix: M(hx + 0.02, hy, hz, 0, 0, -0.12) });
        break;
      default:
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.42, 0.045), color: COL.TOOL, matrix: M(hx, hy, hz) });
        parts.push({ geo: new THREE.BoxGeometry(0.16, 0.09, 0.07), color: dark, matrix: M(hx, hy + 0.20, hz) });
    }
  }

  /**
   * PHASE-V serf (~230 tris): boots with turned-up toes, breeches, a belted
   * smock with the player's sash, sleeves ending in bare hands, a neck, a face
   * (nose + two dot eyes), hair showing under a profession-coloured cap, and the
   * tool his job actually swings. Transporters carry a little pack on their back.
   * Still ONE merged geometry per (job, player) — the whole workforce instances.
   */
  FSModels.serfGeo = function (job, playerIdx) {
    const key = "geo:serf:" + job + ":" + playerIdx;
    return cached(key, () => {
      const team = FSModels.playerColor(playerIdx);
      const hat = FSC.JOB_COLOR[job] || FSC.JOB_COLOR.generic;
      const skin = COL.SERF_SKIN, cloth = COL.SERF_CLOTH;
      const hair = 0x6a4a2c;
      const parts = [];
      /* ===== PHASE P: the legs have MOVED OUT of the body mesh into
       * FSModels.serfLegGeo() so the renderer can actually walk them. The
       * body is still one merged, cached geometry per (job, player) and the
       * legs are one shared geometry for the whole workforce — the split
       * costs exactly one extra draw call in total, not one per serf. ===== */
      // smock + belt + the player's sash across the chest
      parts.push({ geo: new THREE.BoxGeometry(0.29, 0.30, 0.21), color: cloth, matrix: M(0, 0.37, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.31, 0.055, 0.23), color: 0x6b5137, matrix: M(0, 0.245, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.055, 0.055, 0.035), color: 0xd8b25a, matrix: M(0, 0.245, 0.12) });
      parts.push({ geo: new THREE.BoxGeometry(0.315, 0.085, 0.225), color: team, matrix: M(0, 0.40, 0, 0, 0, 0.34) });
      // arms: sleeve + a bare hand at the end
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.BoxGeometry(0.075, 0.20, 0.085), color: cloth, matrix: M(s * 0.185, 0.39, 0.02) });
        parts.push({ geo: new THREE.BoxGeometry(0.075, 0.075, 0.085), color: skin, matrix: M(s * 0.195, 0.27, 0.04) });
      }
      // neck, head, hair, face
      parts.push({ geo: new THREE.BoxGeometry(0.09, 0.045, 0.09), color: skin, matrix: M(0, 0.535, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.185, 0.17, 0.175), color: skin, matrix: M(0, 0.63, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.195, 0.055, 0.185), color: hair, matrix: M(0, 0.685, -0.005) });
      parts.push({ geo: new THREE.BoxGeometry(0.045, 0.045, 0.03), color: skin, matrix: M(0, 0.62, 0.095) });
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.BoxGeometry(0.032, 0.032, 0.02), color: 0x3a2c1e, matrix: M(s * 0.048, 0.655, 0.09) });
      }
      // profession cap: a crown and a brim in the job colour
      parts.push({ geo: new THREE.CylinderGeometry(0.10, 0.115, 0.10, 6), color: hat, matrix: M(0, 0.765, 0) });
      parts.push({ geo: new THREE.CylinderGeometry(0.155, 0.155, 0.035, 7), color: hat, matrix: M(0, 0.72, 0.01) });
      if (job === FSC.JOB.KNIGHT) parts.push({ geo: new THREE.ConeGeometry(0.115, 0.13, 8), color: hat, matrix: M(0, 0.86, 0) });
      // a carrier's pack; everyone else gets the tool of the trade
      if (job === FSC.JOB.TRANSPORTER || job === FSC.JOB.GENERIC || job === FSC.JOB.SAILOR) {
        parts.push({ geo: new THREE.BoxGeometry(0.20, 0.19, 0.12), color: 0xb08a56, matrix: M(0, 0.40, -0.155) });
        parts.push({ geo: new THREE.BoxGeometry(0.21, 0.045, 0.13), color: 0x6b5137, matrix: M(0, 0.46, -0.155) });
        for (let s = -1; s <= 1; s += 2) {
          parts.push({ geo: new THREE.BoxGeometry(0.035, 0.20, 0.03), color: 0x6b5137, matrix: M(s * 0.075, 0.42, -0.10, 0.15, 0, 0) });
        }
      }
      const tools = FSC.JOB_TOOLS[job] || [];
      if (tools.length) toolParts(parts, tools[0], 0.255, 0.36, 0.06);
      return mergeColored(parts);
    });
  };

  /**
   * PHASE P — ONE serf leg, authored around its HIP so the renderer can swing
   * it: the origin is the hip joint, the boot hangs below at -y, the turned-up
   * toe points at +z (the serf's forward). Boots are the same on every job and
   * every player, so this single cached geometry serves the whole workforce
   * from ONE instanced pool (see pushLegs in fs-render.js).
   */
  FSModels.serfLegGeo = function () {
    return cached("geo:serfleg", () => mergeColored([
      // the breeches run a little ABOVE the hip joint so a full stride can
      // never open a gap between leg and smock
      { geo: new THREE.BoxGeometry(0.105, 0.20, 0.105), color: 0x6b5a40, matrix: M(0, -0.075, 0) },
      { geo: new THREE.BoxGeometry(0.115, 0.08, 0.15), color: 0x4a3c2a, matrix: M(0, -0.21, 0.022) },
    ]));
  };
  /** …and the armoured version, with the greave that used to sit on the knight. */
  FSModels.knightLegGeo = function () {
    return cached("geo:knightleg", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.105, 0.21, 0.105), color: 0x4a3f30, matrix: M(0, -0.07, 0) },
      { geo: new THREE.BoxGeometry(0.115, 0.075, 0.15), color: 0x36301f, matrix: M(0, -0.215, 0.022) },
      { geo: new THREE.BoxGeometry(0.12, 0.07, 0.12), color: 0xb9bfc6, matrix: M(0, -0.055, 0) },
    ]));
  };

  /* ===================================================================== */
  /* ===== PHASE-D: knights, border stakes, corpses, clangs =============== */
  /* ===================================================================== */

  /**
   * A knight: the serf minifig in a kettle helm, with a sword in one hand and a
   * round shield on the other arm. The shield's TRIM tells you his rank at a
   * glance (FSC.RANK_COLOR), which is the only rank cue the player ever gets.
   */
  FSModels.knightGeo = function (rank, playerIdx) {
    const r = Math.max(0, Math.min(FSC.KNIGHT_RANKS - 1, rank | 0));
    const key = "geo:knight:" + r + ":" + playerIdx;
    return cached(key, () => {
      const team = FSModels.playerColor(playerIdx);
      const trim = FSC.RANK_COLOR[r] || FSC.RANK_COLOR[0];
      const steel = 0xb9bfc6;
      const parts = [];
      /* ===== PHASE-V: greaves + mail + surcoat + a helm with a rank-tinted
       * plume, a sword drawn and a shield slung on the back as well as the arm.
       * Rank reads three ways now: plume, shield rim, surcoat pips. ===== */
      /* ===== PHASE P: greaves/boots moved to FSModels.knightLegGeo() ===== */
      // mail coat + surcoat in the player's colour
      parts.push({ geo: new THREE.BoxGeometry(0.30, 0.30, 0.22), color: 0x8f959d, matrix: M(0, 0.37, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.235, 0.28, 0.235), color: team, matrix: M(0, 0.36, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.32, 0.05, 0.24), color: 0x5d4a30, matrix: M(0, 0.245, 0) });
      // pauldrons + arms
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.BoxGeometry(0.10, 0.075, 0.115), color: steel, matrix: M(s * 0.195, 0.49, 0.01) });
        parts.push({ geo: new THREE.BoxGeometry(0.078, 0.21, 0.088), color: 0x8f959d, matrix: M(s * 0.195, 0.38, 0.02) });
      }
      parts.push({ geo: new THREE.BoxGeometry(0.085, 0.045, 0.09), color: COL.SERF_SKIN, matrix: M(0, 0.535, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.185, 0.17, 0.175), color: COL.SERF_SKIN, matrix: M(0, 0.625, 0) });
      // kettle helm with a nasal bar, and the rank plume on top
      parts.push({ geo: new THREE.CylinderGeometry(0.145, 0.155, 0.13, 7), color: steel, matrix: M(0, 0.685, 0) });
      parts.push({ geo: new THREE.CylinderGeometry(0.185, 0.185, 0.032, 8), color: 0xa9b0b8, matrix: M(0, 0.63, 0) });
      parts.push({ geo: new THREE.ConeGeometry(0.125, 0.13, 7), color: steel, matrix: M(0, 0.81, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.035, 0.12, 0.03), color: 0xa9b0b8, matrix: M(0, 0.635, 0.10) });
      parts.push({ geo: new THREE.BoxGeometry(0.05, 0.075, 0.20), color: trim, matrix: M(0, 0.90, -0.03, 0.32, 0, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.04, 0.05, 0.13), color: trim, matrix: M(0, 0.94, -0.16, 0.7, 0, 0) });
      // sword: blade, fuller, crossguard, pommel
      parts.push({ geo: new THREE.BoxGeometry(0.055, 0.50, 0.032), color: 0xd8dde3, matrix: M(0.275, 0.47, 0.07) });
      parts.push({ geo: new THREE.BoxGeometry(0.018, 0.44, 0.04), color: 0xb0b8c2, matrix: M(0.275, 0.47, 0.07) });
      parts.push({ geo: new THREE.BoxGeometry(0.18, 0.045, 0.055), color: trim, matrix: M(0.275, 0.23, 0.07) });
      parts.push({ geo: new THREE.BoxGeometry(0.045, 0.10, 0.045), color: 0x6b5137, matrix: M(0.275, 0.175, 0.07) });
      // shield: a kite on the arm and a slung round one on the back
      parts.push({ geo: new THREE.CylinderGeometry(0.155, 0.155, 0.04, 8), color: team, matrix: M(-0.26, 0.37, 0.09, Math.PI / 2, 0, 0) });
      parts.push({ geo: new THREE.TorusGeometry(0.155, 0.028, 3, 8), color: trim, matrix: M(-0.26, 0.37, 0.10) });
      parts.push({ geo: new THREE.BoxGeometry(0.075, 0.075, 0.05), color: 0xd8dde3, matrix: M(-0.26, 0.37, 0.115) });
      parts.push({ geo: new THREE.CylinderGeometry(0.135, 0.135, 0.035, 8), color: team, matrix: M(0, 0.40, -0.145, Math.PI / 2, 0, 0) });
      parts.push({ geo: new THREE.TorusGeometry(0.135, 0.022, 3, 8), color: trim, matrix: M(0, 0.40, -0.155) });
      for (let i = 0; i < r; i++) {                       // rank pips on the surcoat
        parts.push({ geo: new THREE.BoxGeometry(0.042, 0.042, 0.03), color: trim, matrix: M(-0.055 + i * 0.045, 0.475, 0.125) });
      }
      return mergeColored(parts);
    });
  };

  /** A frontier post — driven into the ground, pennant in the owner's colour.
   * PHASE P: split in two. The whole stake used to be ONE instance carrying
   * the player colour, and an instance colour multiplies the WHOLE mesh — so
   * the wooden post came out as playerColour x brown, i.e. near-black, and a
   * long frontier read as a scatter of burnt twigs across the meadow. The
   * post is now its own untinted (warm wood) instance and only the little
   * pennant is tinted. One extra draw call for every border on the map. */
  FSModels.stakeGeo = function () {
    return cached("geo:stake", () => mergeColored([
      { geo: new THREE.CylinderGeometry(0.035, 0.045, 0.62, 5), color: COL.STAKE, matrix: M(0, 0.31, 0) },
      { geo: new THREE.BoxGeometry(0.028, 0.028, 0.028), color: 0xd8c9a8, matrix: M(0, 0.625, 0) },
    ]));
  };
  FSModels.stakeFlagGeo = function () {
    return cached("geo:stakeflag", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.20, 0.13, 0.03), color: 0xffffff, matrix: M(0.10, 0.56, 0) },
    ]));
  };

  /** A fallen knight — flat on the grass, fading out (per-instance scale). */
  FSModels.corpseGeo = function () {
    return cached("geo:corpse", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.42, 0.10, 0.22), color: COL.CORPSE, matrix: M(0, 0.05, 0) },
      { geo: new THREE.BoxGeometry(0.16, 0.09, 0.16), color: 0x8f959d, matrix: M(0.26, 0.05, 0) },
    ]));
  };

  /** The spark of a parried blow. */
  FSModels.clangGeo = function () {
    return cached("geo:clang", () => mergeColored([
      { geo: new THREE.OctahedronGeometry(0.20, 0), color: 0xffffff, matrix: M(0, 0, 0) },
    ]));
  };

  /** A tongue of flame for a burning building (scaled + flickered per instance). */
  FSModels.flameGeo = function () {
    return cached("geo:flame", () => mergeColored([
      { geo: new THREE.ConeGeometry(0.22, 0.62, 5), color: 0xffffff, matrix: M(0, 0.31, 0) },
    ]));
  };

  /**
   * Construction visuals per building state:
   *   'site'     surveyor stakes + rope on a scraped pad
   *   'leveling' the same pad, dug flatter, with a spoil heap
   *   'build'    scaffold posts + walls rising with `frac` (0..1)
   *   'done'     the finished building (castle gets its own model)
   *   'burn'     blackened shell + flames
   */
  FSModels.buildingModel = function (type, state, playerIdx, frac) {
    if (state === "done" || state === undefined) {
      /* ===== PHASE-C: every type has its own silhouette now ===== */
      return FSModels.building(type, playerIdx);
    }
    const V = FSC.VIS;
    const def = FSC.BLD[type] || {};
    const sz = def.size || 0;
    const w = [1.15, 1.6, 2.1][sz], h = [0.85, 1.15, 1.4][sz];
    const g = new THREE.Group();
    const parts = [];
    const pad = w * 0.98;
    const rnd = jr(sz * 733 + 11);
    parts.push({ geo: new THREE.BoxGeometry(pad, 0.10, pad), color: COL.SITE_PAD, cell: "dirt", matrix: M(0, 0.05, 0) });

    if (state === "burn") {
      /* ===== PHASE-V: a burnt-out shell — charred stubs, collapsed roof beams,
       * glowing embers under the flames the renderer layers on top. ===== */
      parts.push({ geo: new THREE.BoxGeometry(w * 0.86, h * 0.48, w * 0.86), color: COL.BURN, cell: "plank", matrix: M(0, h * 0.24 + 0.05, 0) });
      for (let i = 0; i < 4; i++) {
        const sx = (i & 1) ? 1 : -1, sz2 = (i & 2) ? 1 : -1;
        parts.push({
          geo: new THREE.BoxGeometry(0.08, h * (0.55 + rnd() * 0.5), 0.08), color: 0x241f1a,
          matrix: M(sx * w * 0.42, h * 0.42, sz2 * w * 0.42, (rnd() - 0.5) * 0.2, 0, (rnd() - 0.5) * 0.2),
        });
      }
      for (let i = 0; i < 3; i++) {
        parts.push({
          geo: new THREE.BoxGeometry(w * 0.9, 0.07, 0.09), color: 0x2c2620,
          matrix: M((rnd() - 0.5) * w * 0.3, h * (0.32 + rnd() * 0.3), (rnd() - 0.5) * w * 0.5, (rnd() - 0.5) * 0.7, rnd() * 3, (rnd() - 0.5) * 0.9),
        });
      }
      for (let i = 0; i < 6; i++) {
        const a = rnd() * 6.283, d = rnd() * w * 0.5;
        parts.push({
          geo: new THREE.IcosahedronGeometry(0.05 + rnd() * 0.05, 0), color: COL.FIRE[i & 1],
          matrix: M(Math.cos(a) * d, h * 0.10, Math.sin(a) * d),
        });
      }
      for (let i = 0; i < 5; i++) {
        const a = i * 1.256;
        parts.push({
          geo: new THREE.ConeGeometry(0.20 - i * 0.02, 0.5 + (i % 3) * 0.18, 5),
          color: COL.FIRE[i % 2],
          matrix: M(Math.cos(a) * w * 0.28, h * 0.55 + 0.25, Math.sin(a) * w * 0.28),
        });
      }
      const burnt = new THREE.Mesh(mergeColored(parts), mat(0xffffff, { vertexColors: true, map: bldAtlas(), emissiveOf: COL.FIRE[0], emissiveK: 0.5 }));
      burnt.name = "bldBurn";
      g.add(burnt);
      g.userData.type = type;
      return g;
    }

    // corner stakes + rope (every unfinished state keeps them)
    const c = pad * 0.5;
    const corners = [[-c, -c], [c, -c], [c, c], [-c, c]];
    for (let i = 0; i < 4; i++) {
      parts.push({
        geo: new THREE.CylinderGeometry(0.045, 0.055, 0.55, 5), color: COL.SITE_STAKE, cell: "wood",
        matrix: M(corners[i][0], 0.28, corners[i][1]),
      });
      parts.push({
        geo: new THREE.BoxGeometry(0.13, 0.09, 0.02), color: 0xe8dcc0,
        matrix: M(corners[i][0], 0.52, corners[i][1], 0, i * 1.1, 0.2),
      });
      const n = corners[(i + 1) % 4];
      const mx = (corners[i][0] + n[0]) / 2, mz = (corners[i][1] + n[1]) / 2;
      const len = Math.sqrt((n[0] - corners[i][0]) * (n[0] - corners[i][0]) + (n[1] - corners[i][1]) * (n[1] - corners[i][1]));
      const rot = Math.atan2(n[0] - corners[i][0], n[1] - corners[i][1]);
      parts.push({
        geo: new THREE.BoxGeometry(0.03, 0.03, len), color: COL.SITE_ROPE,
        matrix: M(mx, 0.50, mz, 0, rot, 0),
      });
    }
    if (state === "site" || state === "leveling") {
      // surveyor's kit: a peg board, a spade left in the ground, a rope coil
      parts.push({ geo: new THREE.BoxGeometry(0.04, 0.42, 0.04), color: COL.TOOL, matrix: M(-c * 0.5, 0.21, c * 0.86, 0.2, 0, 0.14) });
      parts.push({ geo: new THREE.BoxGeometry(0.13, 0.17, 0.03), color: 0x9aa0a8, cell: "metal", matrix: M(-c * 0.5 + 0.06, 0.05, c * 0.90, 0.2, 0, 0.14) });
      parts.push({ geo: new THREE.TorusGeometry(0.11, 0.028, 4, 9), color: COL.SITE_ROPE, matrix: M(c * 0.55, 0.03, c * 0.80, Math.PI / 2, 0, 0) });
    }
    if (state === "leveling") {
      parts.push({ geo: new THREE.ConeGeometry(0.30, 0.34, 6), color: COL.SITE_PAD, cell: "dirt", matrix: M(c * 0.72, 0.20, -c * 0.72) });
      parts.push({ geo: new THREE.ConeGeometry(0.22, 0.26, 6), color: COL.SITE_PAD, cell: "dirt", matrix: M(-c * 0.80, 0.16, c * 0.55) });
      // a barrow tipped against the spoil
      parts.push({ geo: new THREE.BoxGeometry(0.34, 0.16, 0.26), color: 0x9a6a3c, cell: "plank", matrix: M(c * 0.30, 0.14, c * 0.30, 0.4, 0.6, 0) });
      parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 0.04, 8), color: 0x6f5334, matrix: M(c * 0.30 + 0.10, 0.09, c * 0.30 + 0.18, 0, 0.6, Math.PI / 2) });
    }
    if (state === "build") {
      const f = Math.max(0.08, Math.min(1, frac === undefined ? 0.35 : frac));
      /* ===== PHASE-V: a real half-built house — a stone footing goes in first,
       * then courses of wall rise, then the roof trusses go up at the very end. */
      parts.push({ geo: new THREE.BoxGeometry(w * 0.92, 0.10, w * 0.92), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.13, 0) });
      parts.push({ geo: new THREE.BoxGeometry(w * 0.86, h * f, w * 0.86), color: V.WALL_PLASTER, cell: "plaster", matrix: M(0, 0.18 + h * f * 0.5, 0) });
      // corner posts always run full height — you can read the finished size
      for (let i = 0; i < 4; i++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.075, h * 0.96, 0.075), color: V.WALL_TIMBER, cell: "wood",
          matrix: M(corners[i][0] * 0.86, 0.18 + h * 0.48, corners[i][1] * 0.86),
        });
      }
      if (f > 0.62) {                        // roof trusses appear near the end
        for (let s = -1; s <= 1; s += 2) {
          parts.push({
            geo: new THREE.BoxGeometry(w * 0.62, 0.06, 0.06), color: V.WALL_TIMBER, cell: "wood",
            matrix: M(s * w * 0.20, 0.18 + h * 1.02, 0, 0, 0, -s * 0.7),
          });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.06, w * 0.92), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, 0.18 + h * 1.24, 0) });
      }
      // scaffold: four uprights, a waist rail, a plank walkway and a ladder
      for (let i = 0; i < 4; i++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.07, h + 0.45, 0.07), color: COL.SCAFFOLD, cell: "wood",
          matrix: M(corners[i][0] * 0.94, (h + 0.45) / 2, corners[i][1] * 0.94),
        });
      }
      for (let i = 0; i < 4; i++) {
        const n = corners[(i + 1) % 4];
        const mx = (corners[i][0] + n[0]) / 2 * 0.94, mz = (corners[i][1] + n[1]) / 2 * 0.94;
        const len = Math.sqrt((n[0] - corners[i][0]) * (n[0] - corners[i][0]) + (n[1] - corners[i][1]) * (n[1] - corners[i][1])) * 0.94;
        const rot = Math.atan2(n[0] - corners[i][0], n[1] - corners[i][1]);
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, len), color: COL.SCAFFOLD, matrix: M(mx, h * 0.66, mz, 0, rot, 0) });
        if (i === 0) {
          parts.push({ geo: new THREE.BoxGeometry(0.24, 0.035, len), color: 0xd6bb84, cell: "wood", matrix: M(mx, h * 0.70, mz, 0, rot, 0) });
        }
      }
      const lx = corners[2][0] * 0.94, lz = corners[2][1] * 0.94 + 0.16;
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.BoxGeometry(0.035, h * 0.95, 0.035), color: 0xd6bb84, matrix: M(lx + s * 0.10, h * 0.44, lz, -0.16, 0, 0) });
      }
      for (let i = 0; i < 4; i++) {
        parts.push({ geo: new THREE.BoxGeometry(0.22, 0.028, 0.028), color: 0xd6bb84, matrix: M(lx, 0.14 + i * h * 0.22, lz + i * 0.03) });
      }
      // building materials waiting on the pad
      for (let i = 0; i < 3; i++) {
        parts.push({ geo: new THREE.BoxGeometry(0.40, 0.05, 0.18), color: FSC.RES_COLOR.plank, cell: "wood", matrix: M(-c * 0.86, 0.13 + i * 0.055, -c * 0.30, 0, i * 0.08, 0) });
      }
      parts.push({ geo: new THREE.IcosahedronGeometry(0.14, 0), color: COL.STONE, cell: "rock", matrix: M(c * 0.80, 0.16, -c * 0.55, 0.4, 0.6, 0) });
    }
    const body = new THREE.Mesh(mergeColored(parts), mat(0xffffff, { vertexColors: true, map: bldAtlas(), emissiveOf: COL.SITE_STAKE, emissiveK: 0.28 }));
    body.name = "bldSite";
    g.add(body);
    g.userData.type = type;
    g.userData.state = state;
    return g;
  };

  /** geologist sign post — colour tells the mineral (or grey for "nothing here") */
  FSModels.signPost = function (mineral) {
    const c = COL.MINERAL[mineral] === undefined ? COL.MINERAL[0] : COL.MINERAL[mineral];
    return new THREE.Mesh(
      mergeColored([
        { geo: new THREE.CylinderGeometry(0.035, 0.035, 0.42, 5), color: COL.SIGN_POST, matrix: M(0, 0.21, 0) },
        { geo: new THREE.BoxGeometry(0.3, 0.2, 0.05), color: c, matrix: M(0, 0.45, 0) },
      ]),
      mat(0xffffff, { vertexColors: true, emissiveOf: c, emissiveK: 0.4 })
    );
  };

  /** flat highlight ring used for hover / selection (never THREE.Line — no linewidth) */
  FSModels.ring = function (color, rIn, rOut) {
    const geo = new THREE.RingGeometry(rIn === undefined ? 0.55 : rIn, rOut === undefined ? 0.78 : rOut, 24);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: color === undefined ? COL.HOVER : color,
      transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.renderOrder = 8;
    return mesh;
  };

  FSModels.dispose = function () {
    if (CACHE.kinds) {
      for (const k in CACHE.kinds) { CACHE.kinds[k].geo.dispose(); CACHE.kinds[k].mat.dispose(); }
    }
    for (const k in CACHE) {
      const c = CACHE[k];
      if (c && (c.isTexture || c.isBufferGeometry || c.isMaterial)) c.dispose();
      delete CACHE[k];
    }
  };

  window.FSModels = FSModels;
})();
