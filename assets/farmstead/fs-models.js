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

  /* ═══ A DOUBLE-SIDED CARD MUST NOT GO BLACK FROM BEHIND ══════════════════
   * (batch #4, 2026-08-02 — the cause of BOTH "the grass reads as dark specks"
   * and "the canopies are a dark haze".)
   *
   * Every cutout card in this world — grass clumps, leaf masses, needle fans —
   * is authored with its normal pointing STRAIGHT UP so it takes the same light
   * as the ground it grows out of, and drawn `side: DoubleSide` because the
   * camera orbits the full 360°. But r128's MeshLambert lights per VERTEX into
   * `vLightFront` / `vLightBack`, and the fragment shader picks between them on
   * `gl_FrontFacing` — `vLightBack` being the same vertex lit with the normal
   * NEGATED. So every card whose winding happened to face away from the camera
   * was lit as if its normal pointed at the ground: no sun at all, only the
   * hemisphere's ground colour plus the emissive lift. Half of every clump and
   * half of every canopy, at any yaw, rendering near-black — which is exactly
   * what the screenshots showed and why a denser meadow only ever made the
   * ground look dirtier.
   *
   * The authored normal is the truth for these cards, so the fix is to stop
   * choosing: both faces take vLightFront. Two string swaps, no extra
   * geometry, no extra draw call, and grass and trees still share ONE compiled
   * program (the cache key is extended, not replaced).
   */
  function litBothSides(m) {
    const prev = m.onBeforeCompile;
    const prevKey = m.customProgramCacheKey;
    m.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        .replace("reflectedLight.indirectDiffuse += ( gl_FrontFacing ) ? vIndirectFront : vIndirectBack;",
          "reflectedLight.indirectDiffuse += vIndirectFront;")
        .replace("reflectedLight.directDiffuse = ( gl_FrontFacing ) ? vLightFront : vLightBack;",
          "reflectedLight.directDiffuse = vLightFront;");
    };
    m.customProgramCacheKey = function () {
      return (prevKey ? prevKey.call(this) : "fs") + "|bothLit";
    };
    return m;
  }
  FSModels.litBothSides = litBothSides;
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

  /**
   * Same contract as mergeColored, but the OUTPUT STAYS INDEXED and a part may
   * bring its OWN per-vertex colours instead of a flat fill (`keepColor`).
   *
   * Why a second merger rather than changing the first: mergeColored
   * de-indexes, which is free on a 12-triangle crate and ruinous on the 6000-
   * triangle villager — 5710 shared vertices would become 18000, tripling both
   * the buffer and the per-frame vertex cost for every serf on the map. And the
   * villager arrives from its GLB already carrying baked vertex colours that a
   * flat fill would throw away, while the sash/hat/tool merged on top of him
   * still want the ordinary one-colour-per-part treatment.
   * parts: [{geo, color, matrix?, keepColor?}]
   */
  function mergeIndexed(parts) {
    const prep = [];
    let vTotal = 0, iTotal = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const g = p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position.count;
      const idx = g.index ? g.index.array : null;
      prep.push({
        g, n, idx,
        src: (p.keepColor && g.attributes.color) ? g.attributes.color.array : null,
        c: new THREE.Color(p.color === undefined ? 0xffffff : p.color),
      });
      vTotal += n;
      iTotal += idx ? idx.length : n;
    }
    const pos = new Float32Array(vTotal * 3);
    const nor = new Float32Array(vTotal * 3);
    const col = new Float32Array(vTotal * 3);
    const ind = vTotal > 65535 ? new Uint32Array(iTotal) : new Uint16Array(iTotal);
    let vo = 0, io = 0;
    for (let i = 0; i < prep.length; i++) {
      const q = prep[i], n = q.n;
      pos.set(q.g.attributes.position.array, vo * 3);
      nor.set(q.g.attributes.normal.array, vo * 3);
      if (q.src) col.set(q.src, vo * 3);
      else for (let k = 0; k < n; k++) { col[(vo + k) * 3] = q.c.r; col[(vo + k) * 3 + 1] = q.c.g; col[(vo + k) * 3 + 2] = q.c.b; }
      if (q.idx) for (let k = 0; k < q.idx.length; k++) ind[io + k] = q.idx[k] + vo;
      else for (let k = 0; k < n; k++) ind[io + k] = vo + k;
      io += q.idx ? q.idx.length : n;
      vo += n;
      q.g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setIndex(new THREE.BufferAttribute(ind, 1));
    out.computeBoundingSphere();
    return out;
  }
  FSModels.mergeIndexed = mergeIndexed;
  /** triangle count that is right for BOTH merge flavours */
  FSModels.triCount = function (g) {
    return (g.index ? g.index.count : g.attributes.position.count) / 3;
  };

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

  /**
   * ALPHA BLEED — the fix for why every cutout in the world went muddy at
   * distance (charm pass 2026-08-02).
   *
   * A canvas' transparent pixels are rgba(0,0,0,0): the COLOUR under a zero
   * alpha is black. Mipmapping averages RGB and alpha separately and knows
   * nothing about that, so a grass clump four pixels tall — whose sheet is
   * mostly transparent — samples a mip whose RGB has been dragged most of the
   * way to black, and the meadow reads as a scatter of dark specks on bright
   * ground however carefully the tint was chosen. (The same bill was being
   * paid by every foliage card.)
   *
   * The standard answer is to bleed the opaque colour outward into the
   * transparent region: the cutout is unchanged, but there is no black left
   * to average in. This does it in one pass with the region's own mean, which
   * is enough at these sizes and costs nothing (sheets are built once, at boot).
   *
   * THE ALPHA CANNOT STAY AT ZERO, and that is the part that cost a round of
   * debugging. A 2D canvas' backing store is PREMULTIPLIED, so writing colour
   * under alpha 0 through putImageData is thrown away on the spot — measured:
   * the transparent region read back as pure black again, and the meadow was
   * exactly as dark as before. Bleeding at alpha BLEED_A (0.04) survives the
   * round trip with ~2% loss, is far below any alphaTest this file uses so no
   * cutout changes at mip 0, and lifts the mip average out of the black.
   */
  const BLEED_A = 10;                    // /255 — under every alphaTest here
  function bleedAlpha(g, x0, y0, w, h) {
    const img = g.getImageData(x0, y0, w, h);
    const d = img.data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 32) continue;
      r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return;
    r = Math.round(r / n); gg = Math.round(gg / n); b = Math.round(b / n);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] >= BLEED_A) continue;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = BLEED_A;
    }
    g.putImageData(img, x0, y0);
  }
  FSModels.bleedAlpha = bleedAlpha;

  // ------------------------------------------------------------ canvas textures
  function canvasTex(key, w, h, draw, repeat, aniso) {
    if (CACHE[key]) return CACHE[key];
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    /* ═══ willReadFrequently, AND IT IS WORTH 1.4 SECONDS (batch #4) ══════════
     * Several of these sheets READ THEMSELVES BACK — the alpha bleed does it
     * per cell, the grass carpet and the conifer skin normalise their own mean
     * — and on a GPU-backed 2D canvas the FIRST getImageData is a full
     * GPU→CPU sync. Measured here, headless: 512² readback 1,449 ms on a plain
     * canvas against 19 ms with this hint, and even a 32×32 readback costs
     * 439 ms because the stall is the sync, not the pixels. It took the
     * terrain build to 1.9 s and the world suite's own budget check caught it.
     * Drawing is marginally slower on a CPU-backed canvas and every sheet here
     * draws in single-digit milliseconds, so this is free. */
    draw(cv.getContext("2d", { willReadFrequently: true }), w, h);
    const t = new THREE.CanvasTexture(cv);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); }
    /* 2 everywhere by default; the GROUND sheet asks for more. It is the one
     * surface the camera sees at a 49-58° graze all the way to the fog, and at
     * that angle a low anisotropy picks a mip two levels too coarse and mushes
     * the grass carpet into the same flat wash the batch exists to kill. */
    t.anisotropy = aniso || 2;
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
   * THE CARPET. The terrain's own surface sheet: GRAYSCALE, so it enriches
   * meadow green, beach sand, bare rock and snow with the same strokes, and
   * tiled over the world every FSC.VIS.GROUND_TEX_UV units by the renderer's
   * uv attribute.
   *
   * ═══ BATCH #4, 2026-08-02 — "a carpet of grass, a sea of grass" ═══════════
   * The old sheet was 5,200 fine blade strokes and seventy big soft blotches,
   * and at PLAY ZOOM it delivered neither. The arithmetic says why, and it is
   * the whole design of this rewrite:
   *
   *   at DIST_START the camera puts ~24 screen px on a world unit laterally
   *   and ~19 along the ground, so one GROUND_TEX_UV tile covers ~100x80 px —
   *   and a 256-texel sheet stretched over it is being MINIFIED 2.5x. A blade
   *   stroke 2-7 texels long arrives 0.8-2.8 px wide, i.e. inside the mip
   *   average. The grain was real (the close-up plate shows it) and simply
   *   invisible from where the game is actually played.
   *
   * So the sheet is now built at THREE scales, and the middle one is the one
   * that does the work:
   *   · CLUMP scale (~P*0.03-0.09 = 0.2-0.6 world units = 5-14 screen px) —
   *     soft lumps of value with a dark seat under each. This is what reads as
   *     "a mass of grass" from the RTS camera; nothing at blade scale can.
   *   · BLADE scale — many more, shorter strokes than before, in two ranks
   *     (dark stems, lit tips). These carry the close zoom, where the camera
   *     magnifies the sheet instead of minifying it.
   *   · SPECK scale — single bright/dark pixels, the fine sparkle a real lawn
   *     has. Free, and the first thing the eye reads as "not a flat surface".
   * Low-FREQUENCY content is deliberately absent: a feature the size of the
   * tile is exactly what makes a tiled sheet announce its grid, and the
   * terrain already varies at that scale through its own vertex colours
   * (patchNoise + slope shading + the lush-hollow ramp).
   *
   * The mean is NORMALISED at the end. The sheet multiplies the terrain's
   * vertex colour, so its mean IS the world's ground brightness — painting
   * more darks into it would quietly darken every biome on the board. Measured
   * and rescaled to GROUND_TEX_MEAN, so contrast can be pushed as far as it
   * needs to go without moving the value the art was tuned at.
   */
  FSModels.groundTex = function () {
    const V = FSC.VIS, P = V.GROUND_TEX_PX;
    return canvasTex("tex:ground", P, P, (g) => {
      const rnd = jr(1337);
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, P, P);

      /** draw once per wrap so anything crossing an edge tiles seamlessly */
      function wrapped(x, y, r, draw) {
        for (let wx = -1; wx <= 1; wx++) {
          for (let wy = -1; wy <= 1; wy++) {
            const px = x + wx * P, py = y + wy * P;
            if (px < -r || px > P + r || py < -r || py > P + r) continue;
            draw(px, py);
          }
        }
      }

      /* 1 · CLUMP SCALE — the layer the play camera actually reads.
       * Each clump is a soft bright cap with a darker seat below-right of it
       * (the key light sits up-left), which is what turns a flat wash into a
       * surface with a nap. */
      /* ONE gradient per clump, not two. The dark seat and the lit cap started
       * as separate radial fills, which put ~2,200 large software-canvas
       * gradients in the boot path and took the terrain build from ~120 ms to
       * 1.9 SECONDS (the world suite's own budget check caught it). A single
       * off-centre gradient that runs light → transparent → dark carries the
       * same read for half the fills. */
      const clumps = V.GROUND_CLUMPS;
      for (let i = 0; i < clumps; i++) {
        const x = rnd() * P, y = rnd() * P;
        const r = P * (0.030 + rnd() * 0.068);
        const lit = 0.13 + rnd() * 0.19;
        const dark = 0.12 + rnd() * 0.18;
        wrapped(x, y, r * 1.35, (px, py) => {
          const gd = g.createRadialGradient(px - r * 0.30, py - r * 0.34, 0, px, py, r * 1.28);
          gd.addColorStop(0, "rgba(255,255,255," + lit.toFixed(3) + ")");
          gd.addColorStop(0.42, "rgba(255,255,255," + (lit * 0.35).toFixed(3) + ")");
          gd.addColorStop(0.60, "rgba(58,64,44," + (dark * 0.30).toFixed(3) + ")");
          gd.addColorStop(0.84, "rgba(58,64,44," + dark.toFixed(3) + ")");
          gd.addColorStop(1, "rgba(58,64,44,0)");
          g.fillStyle = gd;
          g.beginPath(); g.arc(px, py, r * 1.28, 0, 6.283); g.fill();
        });
      }

      /* 2 · BLADE SCALE — short strokes in two ranks. Far more of them than
       * the old sheet carried (a lawn has no bare ground between blades), and
       * the darks come first so the lit tips read as standing in front. */
      g.lineCap = "round";
      const nB = V.GROUND_BLADES;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < nB; i++) {
          const x = rnd() * P, y = rnd() * P;
          const L = P * (0.006 + rnd() * 0.020);
          const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
          const lw = P * (0.0035 + rnd() * 0.0055);
          if (pass === 0) g.strokeStyle = "rgba(52,58,40," + (0.12 + rnd() * 0.30).toFixed(3) + ")";
          else g.strokeStyle = "rgba(255,255,250," + (0.20 + rnd() * 0.38).toFixed(3) + ")";
          g.lineWidth = lw;
          wrapped(x, y, L + lw, (px, py) => {
            g.beginPath();
            g.moveTo(px, py);
            g.lineTo(px + Math.cos(a) * L, py + Math.sin(a) * L);
            g.stroke();
          });
        }
      }

      /* 3 · SPECK SCALE — the fine sparkle. Drawn straight into the pixel
       * buffer in the normalise pass below (cheaper than 12,000 fillRects). */
      const img = g.getImageData(0, 0, P, P);
      const d = img.data;
      const sp = jr(4242);
      for (let i = 0; i < V.GROUND_SPECKS; i++) {
        const o = ((sp() * P * P) | 0) * 4;
        const k = sp() < 0.5 ? -(18 + sp() * 30) : (16 + sp() * 34);
        for (let c = 0; c < 3; c++) d[o + c] = Math.max(0, Math.min(255, d[o + c] + k));
      }
      /* NORMALISE THE MEAN. The sheet multiplies the terrain's vertex colour,
       * so its mean is the brightness of every biome on the board; contrast is
       * free to go where the art wants it only because this puts the level
       * back where it was. */
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i + 1];
      const mean = sum / (P * P);
      const k = (V.GROUND_TEX_MEAN * 255) / (mean || 1);
      for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.min(255, d[i] * k);
        d[i + 1] = Math.min(255, d[i + 1] * k);
        d[i + 2] = Math.min(255, d[i + 2] * k);
        d[i + 3] = 255;          // opaque throughout — no premultiply trap here
      }
      g.putImageData(img, 0, 0);
    }, 1, FSC.VIS.GROUND_TEX_ANISO);
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
        /* NEARLY NEUTRAL. The sheet used to carry a strong yellow-green of its
         * own (0.88, 1, 0.74), which fought the per-instance tint — and since
         * that tint is now sampled from the ground the clump stands on, any
         * hue baked in here is hue the meadow does NOT have, and ten thousand
         * of them read as confetti. Same lesson as the terrain's blade sheet:
         * paint VALUE, let the colour come from underneath. */
        const c = Math.round(255 * lum);
        g.fillStyle = "rgba(" + Math.round(c * 0.96) + "," + c + "," + Math.round(c * 0.90) + ",1)";
        g.beginPath();
        g.moveTo(rootx - w, P);
        g.quadraticCurveTo(rootx - w * 0.3 + (tipx - rootx) * curve, P - h * 0.66, tipx, P - h);
        g.quadraticCurveTo(rootx + w * 0.35 + (tipx - rootx) * curve, P - h * 0.60, rootx + w, P);
        g.closePath(); g.fill();
      }
      /* CHARM PASS 2026-08-02: the fan was NARROWED and the darks lifted.
       * The old sheet splayed its tips from 0.10 to 0.90 across the cell, and
       * an instance of that seen from a 52° camera is a comb lying flat on the
       * grass, not a tuft standing in it. Keeping the tips inside the middle
       * half makes the clump read as vertical from directly above; and a back
       * rank at 0.64 luminance was reading as a dark object against bright
       * meadow once every clump takes its colour FROM that meadow. */
      /* BATCH #4 2026-08-02: THE VALUE RANGE IS WIDER, and that is what makes
       * the clump visible now that it is lit correctly. With the double-sided
       * back-face bug fixed (litBothSides) a tuft takes exactly the ground's
       * light, and with 86% of its colour sampled from the ground it stands on
       * a flat-value cutout is a clump of grass rendered in the exact colour of
       * the grass behind it — i.e. invisible. A clump reads because it is DARK
       * where the blades bunch at the root and BRIGHT where the tips catch the
       * sun, and the tint now sits a little ABOVE the ground so the tips are
       * genuinely lighter than the meadow rather than merely equal to it. */
      // back rank: longer, a shade darker, leaning out
      for (let i = 0; i < 17; i++) {
        const k = (i + 0.5) / 17;
        const rootx = P * (0.38 + k * 0.24);
        const tipx = P * (0.5 + (k - 0.5) * 2 * (0.20 + rnd() * 0.07));
        const h = P * (0.20 + 0.78 * dome(tipx / P)) * (0.82 + rnd() * 0.22);
        blade(rootx, tipx, h, P * (0.040 + rnd() * 0.026), 0.62 + rnd() * 0.16, 0.45);
      }
      // front rank: shorter, brighter, tighter — this is what reads as "fluffy"
      for (let i = 0; i < 21; i++) {
        const k = (i + 0.5) / 21;
        const rootx = P * (0.34 + k * 0.32);
        const tipx = P * (0.5 + (k - 0.5) * 2 * (0.17 + rnd() * 0.09));
        const h = P * (0.16 + 0.66 * dome(tipx / P)) * (0.78 + rnd() * 0.30);
        blade(rootx, tipx, h, P * (0.036 + rnd() * 0.024), 0.84 + rnd() * 0.16, 0.35);
      }
      /* CHARM PASS 2026-08-02: the root band used to be a filled SLAB of
       * rgba(170,206,140) across the bottom of the cell. Under an alpha
       * cutout a gradient-to-zero slab does not fade — it stops, dead, at the
       * test threshold — so every clump wore a solid dark-green quadrilateral
       * at its foot, and that slab (not the blades) was the "little dark leaf
       * lying on the grass" the meadow kept reading as. It is a third rank of
       * very short, very bright blades now: same job (no daylight under the
       * clump), no slab. */
      for (let i = 0; i < 15; i++) {
        const k = (i + 0.5) / 15;
        const rootx = P * (0.34 + k * 0.32);
        const tipx = rootx + (rnd() - 0.5) * P * 0.08;
        const h = P * (0.08 + 0.26 * dome((tipx / P - 0.28) / 0.44)) * (0.8 + rnd() * 0.4);
        blade(rootx, tipx, h, P * (0.046 + rnd() * 0.028), 0.70 + rnd() * 0.12, 0.2);
      }
      // …and the black out of the transparent surround, or a 4-pixel clump
      // mips down to a dark speck (see bleedAlpha)
      bleedAlpha(g, 0, 0, P, P);
    });
  };

  /* ===================================================================== */
  /* ===== CHARM PASS 2026-08-02: THE FOLIAGE ATLAS ====================== */
  /* ===================================================================== */
  /*
   * User's brief: "the world feels very polygonal… the trees should be fluffy
   * and swaying in the wind". A canopy built from icosahedron lobes can only
   * ever be faceted — its outline IS twenty flat triangles — so the canopy is
   * painted now, on cards, and the geometry underneath is a small solid core
   * that never reaches the silhouette.
   *
   * ONE 4x2 atlas serves every tree, because a tree is ONE merged geometry
   * drawn with ONE material (the trunk and the leaves cannot each carry their
   * own texture). Cell 0 is deliberately SOLID OPAQUE WHITE: the trunk, limbs
   * and core sample it at a single constant uv, which has zero derivative, so
   * the GPU always picks mip 0 and no amount of mip bleeding from the ragged
   * leaf cells beside it can ever alpha-test a trunk away in the distance.
   *
   * The paint is GREYSCALE (0.55..1.0) — the same lesson the terrain's blade
   * sheet learned: a grey sheet enriches ANY colour, so one atlas serves the
   * pine, the summer broadleaf and the autumn broadleaf, and per-instance tint
   * still does the work of making a wood look like a wood.
   */
  /* BATCH #4 2026-08-02: a third row, for ONE cell — `conifer`. It is FULLY
   * OPAQUE like cell 0 and carries clumpy needle VALUE, so the fir skirts can
   * be painted (the user's reference has the same layered-clump language on
   * its pine as on its broadleaves) without any alpha in the sampled cell,
   * which is what would otherwise lace a cone away at distance. */
  const FOL_COLS = 4, FOL_ROWS = 3, FOL_PAD = 0.045;
  const FOL_CELL = { solid: 0, leafA: 1, leafB: 2, leafC: 3, needleA: 4, needleB: 5, sprig: 6, leafD: 7, conifer: 8 };
  FSModels.FOL_CELL = FOL_CELL;
  /** map a part's own 0..1 uv into one atlas cell (inset so mips never cross) */
  function folUV(cell, u, v, out) {
    const i = FOL_CELL[cell] === undefined ? 0 : FOL_CELL[cell];
    const cx = i % FOL_COLS, cy = (i / FOL_COLS) | 0;
    out[0] = (cx + FOL_PAD + u * (1 - 2 * FOL_PAD)) / FOL_COLS;
    out[1] = (cy + FOL_PAD + v * (1 - 2 * FOL_PAD)) / FOL_ROWS;
    return out;
  }
  FSModels.folUV = folUV;

  FSModels.foliageAtlas = function () {
    const P = FSC.VIS.LEAF_TEX_PX;
    return canvasTex("tex:foliage", P * FOL_COLS, P * FOL_ROWS, (g) => {
      const rnd = jr(90210);
      g.clearRect(0, 0, P * FOL_COLS, P * FOL_ROWS);
      const at = (i) => [(i % FOL_COLS) * P, ((i / FOL_COLS) | 0) * P];

      /** a leaf clump: a soft-edged lump of a dozen overlapping leaf dabs */
      function clump(ox, oy, cx, cy, r, lum) {
        const n = 6 + ((rnd() * 7) | 0);
        for (let i = 0; i < n; i++) {
          const a = rnd() * 6.283, d = rnd() * r * 0.62;
          const rr = r * (0.34 + rnd() * 0.40);
          const l = Math.max(0, Math.min(1, lum * (0.88 + rnd() * 0.26)));
          const c = Math.round(255 * l);
          g.fillStyle = "rgb(" + Math.round(c * 0.96) + "," + c + "," + Math.round(c * 0.90) + ")";
          g.beginPath();
          g.ellipse(ox + cx + Math.cos(a) * d, oy + cy + Math.sin(a) * d,
            rr, rr * (0.72 + rnd() * 0.4), rnd() * 3.14, 0, 6.283);
          g.fill();
        }
      }
      /**
       * A LEAF MASS, in the DOS-Settlers language the user asked for
       * (batch #4, 2026-08-02, reference photo: rounded clumpy layered
       * canopies with visible blob clusters, dark interiors and lit tops).
       *
       * The charm-pass version was a haze: 80 small soft dabs at randomised
       * luminance, which averages out to an even felt disc — no clusters, no
       * layering, and the only structure it had was a top-to-bottom ramp. The
       * reference's whole character is that you can COUNT the clumps.
       *
       * So a mass is now BUILT OUT OF BLOBS, ten to sixteen of them, each one
       * drawn three times:
       *   · a dark under-disc, offset down-right, which is the neighbouring
       *     blob's shadow and what makes the cluster read as layered;
       *   · the blob body at mid value;
       *   · a lit cap up-left, the key light's own heading.
       * Blobs are placed on a lobed disc, biggest in the middle, and the ones
       * on the rim hang half outside it — that is the ragged silhouette, and
       * it comes from the same shapes as the interior instead of from a
       * separate scatter of crumbs.
       *
       * The paint stays GREYSCALE: one atlas serves the pine, the summer
       * broadleaf and the autumn broadleaf, and per-instance tint does the
       * colour. The value range is deliberately WIDE (0.42 shadow → 1.0 lit
       * cap) — the reference's clumps are near-black on their undersides.
       */
      function leafMass(cellName, seed, squash) {
        const [ox, oy] = at(FOL_CELL[cellName]);
        const r2 = jr(seed);
        const cx = P * 0.5, cy = P * 0.52, R = P * 0.40;
        const sq = squash === undefined ? 1 : squash;
        /* the mass is LOBED, not round: a circular canopy card is the same
         * stamp the icosahedron lobes were, only painted — the whole point is
         * an outline no two neighbouring trees share. */
        const lobes = 3 + ((r2() * 3) | 0);
        const lobePh = r2() * 6.283, lobeK = 0.13 + r2() * 0.11;
        const rAt = (a) => R * (1 + Math.cos(a * lobes + lobePh) * lobeK + Math.sin(a * 2.3 + lobePh) * 0.05);

        /** one leaf CLUSTER: shadow, body, lit cap — the reference's unit */
        function blob(x, y, rr, lum) {
          const grey = (l) => {
            const c = Math.round(255 * Math.max(0, Math.min(1, l)));
            return "rgb(" + Math.round(c * 0.95) + "," + c + "," + Math.round(c * 0.88) + ")";
          };
          // 1 · the shadow this blob casts on whatever is behind and below it
          g.fillStyle = grey(lum * 0.52);
          g.beginPath();
          g.ellipse(ox + x + rr * 0.20, oy + y + rr * 0.26, rr * 1.02, rr * 0.94 * sq, 0, 0, 6.283);
          g.fill();
          // 2 · the body, ragged at its own edge so no blob is a clean circle
          const n = 5 + ((r2() * 4) | 0);
          g.fillStyle = grey(lum * 0.80);
          for (let i = 0; i < n; i++) {
            const a = (i / n) * 6.283 + r2() * 0.7;
            const d = rr * (0.10 + r2() * 0.34);
            g.beginPath();
            g.ellipse(ox + x + Math.cos(a) * d, oy + y + Math.sin(a) * d * sq,
              rr * (0.60 + r2() * 0.30), rr * (0.54 + r2() * 0.28) * sq, r2() * 3.14, 0, 6.283);
            g.fill();
          }
          // 3 · the lit cap, up and left, smaller than the body
          g.fillStyle = grey(lum);
          for (let i = 0; i < 3; i++) {
            const a = -2.2 + i * 0.55 + (r2() - 0.5) * 0.4;
            g.beginPath();
            g.ellipse(ox + x + Math.cos(a) * rr * 0.30, oy + y + Math.sin(a) * rr * 0.34 * sq,
              rr * (0.36 + r2() * 0.18), rr * (0.30 + r2() * 0.16) * sq, 0, 0, 6.283);
            g.fill();
          }
        }

        /* placement: a big central cluster, a ring of body blobs, then rim
         * blobs hanging half outside the lobed radius (the silhouette). */
        const nRing = 5 + ((r2() * 3) | 0), nRim = 5 + ((r2() * 4) | 0);
        blob(cx + (r2() - 0.5) * R * 0.18, cy + R * 0.10,
          R * (0.40 + r2() * 0.08), 0.72 + r2() * 0.10);
        for (let i = 0; i < nRing; i++) {
          const a = (i / nRing) * 6.283 + r2() * 0.5;
          const d = rAt(a) * (0.40 + r2() * 0.18);
          const y = cy + Math.sin(a) * d * sq;
          const up = 1 - (y / P);                       // 0 bottom … 1 top
          blob(cx + Math.cos(a) * d, y, R * (0.30 + r2() * 0.12),
            0.60 + up * 0.40 + (r2() - 0.5) * 0.08);
        }
        for (let i = 0; i < nRim; i++) {
          const a = r2() * 6.283;
          const d = rAt(a) * (0.74 + r2() * 0.22);
          const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * sq;
          if (x < P * 0.08 || x > P * 0.92 || y < P * 0.06 || y > P * 0.94) continue;
          const up = 1 - (y / P);
          blob(x, y, R * (0.17 + r2() * 0.13), 0.56 + up * 0.42);
        }
        /* the deep interior. Painted last and clipped to the mass so it can
         * never bleed outside the silhouette — these are the near-black
         * hollows between clusters that the reference lives on. */
        g.globalCompositeOperation = "source-atop";
        for (let i = 0; i < 8; i++) {
          const a = r2() * 6.283, d = r2() * R * 0.72;
          const x = ox + cx + Math.cos(a) * d, y = oy + cy + Math.sin(a) * d * sq + R * 0.12;
          const rr = R * (0.10 + r2() * 0.14);
          const grd = g.createRadialGradient(x, y, 0, x, y, rr);
          grd.addColorStop(0, "rgba(30,36,24,0.50)");
          grd.addColorStop(1, "rgba(30,36,24,0)");
          g.fillStyle = grd;
          g.beginPath(); g.arc(x, y, rr, 0, 6.283); g.fill();
        }
        g.globalCompositeOperation = "source-over";
      }
      /**
       * A CONIFER BRANCH FAN — needles sweeping down and out from a spine, so
       * a pine's outline breaks into a hundred spikes instead of a cone edge.
       */
      function needleFan(cellName, seed) {
        const [ox, oy] = at(FOL_CELL[cellName]);
        const r2 = jr(seed);
        g.lineCap = "round";
        const rootX = ox + P * 0.5, rootY = oy + P * 0.10;
        for (let i = 0; i < 240; i++) {
          const t = Math.pow(r2(), 0.7);                 // along the spine
          const sx = rootX + (r2() - 0.5) * P * 0.06;
          const sy = rootY + t * P * 0.78;
          const side = r2() < 0.5 ? -1 : 1;
          const spread = P * (0.07 + t * 0.38) * (0.45 + r2() * 0.75);
          const drop = P * (0.05 + r2() * 0.13);
          const up = 1 - ((sy - oy) / P);
          const l = 0.56 + up * 0.16 + r2() * 0.26;
          const c = Math.round(255 * Math.min(1, l));
          g.strokeStyle = "rgb(" + Math.round(c * 0.93) + "," + c + "," + Math.round(c * 0.86) + ")";
          g.lineWidth = P * (0.009 + r2() * 0.014);
          g.beginPath();
          g.moveTo(sx, sy);
          g.quadraticCurveTo(sx + side * spread * 0.6, sy + drop * 0.35, sx + side * spread, sy + drop);
          g.stroke();
        }
        // the woody spine itself, so the fan has somewhere to hang from
        g.strokeStyle = "rgb(150,140,120)";
        g.lineWidth = P * 0.022;
        g.beginPath(); g.moveTo(rootX, rootY); g.lineTo(rootX, rootY + P * 0.74); g.stroke();
      }
      /** a young tree's sprig: a couple of twigs carrying a dozen leaves */
      function sprig() {
        const [ox, oy] = at(FOL_CELL.sprig);
        const r2 = jr(31337);
        g.lineCap = "round";
        g.strokeStyle = "rgb(158,148,124)";
        for (let b = 0; b < 3; b++) {
          const a = -1.57 + (b - 1) * 0.55;
          g.lineWidth = P * 0.018;
          g.beginPath();
          g.moveTo(ox + P * 0.5, oy + P * 0.94);
          g.quadraticCurveTo(ox + P * 0.5 + Math.cos(a) * P * 0.2, oy + P * 0.62,
            ox + P * 0.5 + Math.cos(a) * P * 0.36, oy + P * 0.94 + Math.sin(a) * P * 0.7);
          g.stroke();
        }
        for (let i = 0; i < 22; i++) {
          const a = -1.57 + (r2() - 0.5) * 1.9;
          const d = 0.3 + r2() * 0.68;
          const x = P * 0.5 + Math.cos(a) * P * 0.36 * d;
          const y = P * 0.94 + Math.sin(a) * P * 0.72 * d;
          clump(ox, oy, x, y, P * (0.05 + r2() * 0.05), 0.66 + r2() * 0.30);
        }
      }

      /**
       * THE CONIFER'S SKIN — an OPAQUE cell, so a fir skirt can be painted the
       * same clumpy way the broadleaves are without ever risking alpha on a
       * cone (a laced cone at distance is the bug this atlas is built to make
       * impossible). Banded down v: dark under-shadow at the base of each
       * band, lit needle sprays on top, so a tier reads as a ring of branch
       * clusters rather than a smooth painted lampshade.
       */
      function coniferSkin() {
        const [ox, oy] = at(FOL_CELL.conifer);
        const r2 = jr(7777);
        g.fillStyle = "rgb(226,232,216)";
        g.fillRect(ox, oy, P, P);
        // needle strokes FIRST — drawn last they simply washed the shading out
        g.lineCap = "round";
        for (let i = 0; i < 1600; i++) {
          const cxx = ox + r2() * P, cyy = oy + r2() * P;
          const side = r2() < 0.5 ? -1 : 1;
          const L = P * (0.018 + r2() * 0.040);
          const l = 0.46 + r2() * 0.54;
          const c = Math.round(255 * Math.min(1, l));
          g.strokeStyle = "rgba(" + Math.round(c * 0.93) + "," + c + "," + Math.round(c * 0.84) + ",0.62)";
          g.lineWidth = P * (0.005 + r2() * 0.009);
          g.beginPath();
          g.moveTo(cxx, cyy);
          g.quadraticCurveTo(cxx + side * L * 0.6, cyy + L * 0.34, cxx + side * L, cyy + L * 0.66);
          g.stroke();
        }
        /* THE STRUCTURE RUNS ACROSS u, NOT DOWN v, and that is the finding.
         * u wraps around the skirt and v runs base→apex, so BANDS down v are
         * compressed into a 0.4-unit-tall tier — a couple of screen pixels,
         * which averages straight back to the flat lampshade this cell exists
         * to kill. What the 52° camera actually reads of a fir is its PLAN
         * view: a rosette of branch clusters. So the paint is COLUMNS — one
         * per scalloped lobe, each lit on its up-sun side and shadowed on the
         * other — and from above every lobe now has its own light. */
        const cols = 9;
        for (let c2 = 0; c2 < cols; c2++) {
          const x0 = ox + (c2 / cols) * P, cw = P / cols;
          const gd = g.createLinearGradient(x0, 0, x0 + cw, 0);
          gd.addColorStop(0, "rgba(255,255,250,0.52)");
          gd.addColorStop(0.30, "rgba(255,255,250,0.10)");
          gd.addColorStop(0.58, "rgba(34,42,26,0.30)");
          gd.addColorStop(1, "rgba(34,42,26,0.72)");
          g.fillStyle = gd;
          g.fillRect(x0, oy, cw, P);
        }
        // …plus a gentle base→apex ramp (v=0 is the canvas BOTTOM: flipY)
        const vr = g.createLinearGradient(0, oy, 0, oy + P);
        vr.addColorStop(0, "rgba(255,255,250,0.18)");
        vr.addColorStop(1, "rgba(36,44,28,0.26)");
        g.fillStyle = vr;
        g.fillRect(ox, oy, P, P);
        /* NORMALISE, for the same reason the ground sheet does: this cell
         * MULTIPLIES the per-tier colour a fir is built from, so its mean IS
         * how dark every conifer on the board comes out. Paint the structure,
         * then put the level back. */
        const im = g.getImageData(ox, oy, P, P), d2 = im.data;
        let s2 = 0;
        for (let i = 0; i < d2.length; i += 4) s2 += d2[i + 1];
        const k2 = (FSC.VIS.LEAF_CONIFER_MEAN * 255) / ((s2 / (P * P)) || 1);
        for (let i = 0; i < d2.length; i += 4) {
          d2[i] = Math.min(255, d2[i] * k2);
          d2[i + 1] = Math.min(255, d2[i + 1] * k2);
          d2[i + 2] = Math.min(255, d2[i + 2] * k2);
          d2[i + 3] = 255;
        }
        g.putImageData(im, ox, oy);
      }

      leafMass("leafA", 111, 0.94);
      leafMass("leafB", 222, 1.02);
      leafMass("leafC", 333, 0.86);
      leafMass("leafD", 444, 1.10);
      needleFan("needleA", 555);
      needleFan("needleB", 666);
      sprig();
      coniferSkin();
      /* cell 0 LAST, and deliberately so. A leaf cell that forgets to offset
       * itself lands here, riddles the solid patch with transparent holes, and
       * every trunk and cone in the world alpha-tests into lace — which is
       * exactly the bug this pass shipped once. Painting the patch last makes
       * that class of mistake self-healing, and the suite asserts the cell is
       * fully opaque besides. */
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "#ffffff";
      g.fillRect(0, 0, P, P);
      /* bleed PER CELL, so a leaf cell never averages the needle cell's colour
       * into its own transparent surround (the atlas has a padded inset, but
       * the mean has to be the cell's own or the fringe takes on its
       * neighbour's hue). Cells with no transparent region at all (the conifer
       * skin) are a no-op through the same call. */
      for (let i = 1; i < FOL_COLS * FOL_ROWS; i++) {
        bleedAlpha(g, (i % FOL_COLS) * P, ((i / FOL_COLS) | 0) * P, P, P);
      }
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

  /* ===================================================================== */
  /* ===== ROADS ARE GROUND, NOT AN OBJECT (2026-08-01) =================== */
  /* User playtest: "the roads right now look too blocky and perfect, they
   * should be a texture applied to the ground instead of an object so they
   * look more natural."  fs-render.js no longer extrudes a ribbon for land
   * roads — it lays a DECAL over the terrain's own triangles, and this is the
   * sheet that decal wears: the WHOLE network painted once into a single
   * map-space canvas, with edges that wander, a width that breathes along the
   * path, wheel ruts, trodden junctions, scuffed verges, and an alpha that
   * feathers out into the grass instead of ending on a straight cut.
   *
   * Repainted ONLY when the road network changes (fs-render's roadSignature),
   * into a cached canvas that is reused — `needsUpdate`, never a fresh upload
   * object, so the texture count stays flat across a whole game.
   *
   * Every wobble comes from jr() seeded off the stroke's own road id, so the
   * same network always paints the same path; nothing here ever touches
   * FSC.rng (that is the sim's lockstep stream — the render layer must never
   * advance it or multiplayer desyncs).
   */
  const ROADPAINT_RAW = {
    SCUFF: [197, 175, 134],   // dry dust kicked out onto the verge
    DIRT: [155, 132, 96],     // the body of the path (= FSC.COL.ROAD)
    PACK: [115, 95, 63],      // packed earth down the middle
    RUT: [86, 69, 44],        // wheel ruts
    PALE: [208, 190, 152],    // dried crown, scuffed highlights
    GRIT: [236, 224, 196],    // dry flecks catching the light
  };
  /* The extruded ribbon this replaced multiplied its road colour by roadTex(),
   * a dirt sheet whose mean is 0.82 — so COL.ROAD never actually reached the
   * screen at full value. The decal has no second sheet (this canvas IS the
   * road surface), so painting DIRT at literally COL.ROAD put the whole network
   * ~20% brighter than the road it replaced, which is what made it read as
   * bleached sand next to the grass rather than worn earth. Fold that same
   * factor back in ONCE, here, so every coat/rut/blot keeps its authored
   * relationship to the others and only the overall level moves. */
  const ROAD_GRAIN = 0.82;
  const ROADPAINT = {};
  for (const k in ROADPAINT_RAW) {
    ROADPAINT[k] = ROADPAINT_RAW[k].map((c) => Math.round(c * ROAD_GRAIN)).join(",");
  }

  /** the one reusable map-space canvas + its texture (cached per resolution) */
  function roadMaskTarget(px) {
    const key = "roadmask:" + px;
    let t = CACHE[key];
    if (t) return t;
    const cv = document.createElement("canvas");
    cv.width = px; cv.height = px;
    const tex = new THREE.CanvasTexture(cv);
    /* flipY OFF so uv is literally "normalised canvas pixel" — the decal's uv
     * comes straight from world XZ, and one less mental flip is one less
     * silently-mirrored road network. */
    tex.flipY = false;
    tex.anisotropy = 8;                 // paths are read at grazing angles
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    t = { canvas: cv, ctx: cv.getContext("2d"), tex: tex };
    CACHE[key] = t;
    return t;
  }

  /** smooth deterministic -1..1 series of length n (a low-passed random walk) */
  function wobbleSeries(n, rnd, passes) {
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = rnd() * 2 - 1;
    for (let p = 0; p < (passes === undefined ? 3 : passes); p++) {
      for (let i = 0; i < n; i++) {
        b[i] = (a[i > 0 ? i - 1 : 0] + a[i] * 2 + a[i < n - 1 ? i + 1 : n - 1]) * 0.25;
      }
      a.set(b);
    }
    let m = 0;
    for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i]));
    if (m > 1e-4) for (let i = 0; i < n; i++) a[i] /= m;
    return a;
  }

  /* Chaikin corner cutting. A road's centreline is a chain of LATTICE EDGES, so
   * every turn is a hard 60/120-degree kink — the single biggest reason the old
   * ribbon read as "blocky and perfect". Feet cut corners; two rounds of Chaikin
   * at a modest ratio round the turns while keeping the path inside its own
   * width of the lattice line (so serfs still walk on their road). */
  function chaikin(pts, iters, r) {
    let p = pts;
    for (let it = 0; it < iters; it++) {
      if (p.length < 3) break;
      const out = [p[0]];
      for (let i = 0; i + 1 < p.length; i++) {
        const a = p[i], b = p[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
        out.push([a[0] + dx * r, a[1] + dy * r]);
        out.push([a[0] + dx * (1 - r), a[1] + dy * (1 - r)]);
      }
      out.push(p[p.length - 1]);
      p = out;
    }
    return p;
  }

  /** re-space a polyline to ~step px so the wobble has something to sit on */
  function resamplePath(pts, step) {
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1];
      const L = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * (k / n), ay + (by - ay) * (k / n)]);
    }
    out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
    return out;
  }
  function pathNormals(s) {
    const n = s.length, nor = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const a = s[i > 0 ? i - 1 : 0], b = s[i < n - 1 ? i + 1 : n - 1];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const L = Math.sqrt(dx * dx + dy * dy) || 1;
      nor[i * 2] = -dy / L; nor[i * 2 + 1] = dx / L;
    }
    return nor;
  }
  /* quadratic through the midpoints: a jittered polyline traced this way reads
   * as a worn edge, not as a chain of little straight facets */
  function traceSmooth(g, p, start) {
    const n = p.length;
    if (!n) return;
    if (start) g.moveTo(p[0][0], p[0][1]); else g.lineTo(p[0][0], p[0][1]);
    for (let i = 1; i < n - 1; i++) {
      g.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) * 0.5, (p[i][1] + p[i + 1][1]) * 0.5);
    }
    if (n > 1) g.lineTo(p[n - 1][0], p[n - 1][1]);
  }
  /* A ROUNDED, slightly out-of-true end cap. Closing the ribbon polygon with a
   * straight line across the path leaves a hard chop at every road end — and
   * because each of the four coats is a different width, the four chops stack
   * into a stepped pale wedge lying on the grass, which is precisely the
   * "blocky and perfect" read this whole rework exists to kill. The cap is
   * walked as a shallow arc (radius = the coat's own half-width there, pushed
   * out a touch so the tip is a nose rather than a disc) and traced with the
   * same midpoint quadratics as the sides, so it feathers like the rest of the
   * edge instead of stamping a circle. */
  function capPoints(cx, cy, nx, ny, wl, wr, out) {
    const r = (wl + wr) * 0.5;
    /* forward = the outward direction at this end (the normal rotated -90) */
    const fx = ny, fy = -nx;
    const A = [
      [0.92, 0.38], [0.62, 0.80], [0.0, 1.06], [-0.62, 0.80], [-0.92, 0.38],
    ];
    for (let i = 0; i < A.length; i++) {
      const a = A[i][0], b = A[i][1] * r;
      const s = a > 0 ? wl : wr;              // asymmetric widths keep it off-centre
      out.push([cx + nx * (a * s) + fx * b, cy + ny * (a * s) + fy * b]);
    }
  }
  /** closed polygon: forward down the left offsets, round the nose, back up the right */
  function ribbonPath(g, s, nor, wL, wR) {
    const n = s.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      L.push([s[i][0] + nor[i * 2] * wL[i], s[i][1] + nor[i * 2 + 1] * wL[i]]);
      R.push([s[i][0] - nor[i * 2] * wR[i], s[i][1] - nor[i * 2 + 1] * wR[i]]);
    }
    R.reverse();
    const e = n - 1;
    const far = [], near = [];
    // far end: the ribbon's forward direction is the normal turned back to tangent
    capPoints(s[e][0], s[e][1], nor[e * 2], nor[e * 2 + 1], wL[e], wR[e], far);
    capPoints(s[0][0], s[0][1], -nor[0], -nor[1], wR[0], wL[0], near);
    g.beginPath();
    traceSmooth(g, L.concat(far), true);
    traceSmooth(g, R.concat(near), false);
    g.closePath();
  }

  /* One road, painted in coats: widest + faintest first (dust scuffed onto the
   * verge), then the body, then the packed core. Each coat carries its OWN
   * independent edge jitter, so no two boundaries line up and the path never
   * reads as a stroked line with a fixed outline. */
  const ROAD_COATS = [
    [1.85, 0.44, "SCUFF", 0.15],
    [1.36, 0.28, "DIRT", 0.33],
    [1.02, 0.18, "DIRT", 0.80],
    [0.60, 0.20, "PACK", 0.60],
  ];
  function paintRoadStroke(g, st) {
    const rnd = jr(st.seed | 0);
    const hw = st.w;
    const s = resamplePath(chaikin(st.pts, 2, 0.22), Math.max(2.5, hw * 0.5));
    const n = s.length;
    if (n < 2) return;
    const nor = pathNormals(s);
    const breathe = wobbleSeries(n, rnd, 4);
    const half = new Float32Array(n);
    for (let i = 0; i < n; i++) half[i] = hw * (0.80 + 0.36 * (breathe[i] * 0.5 + 0.5));
    const wL = new Float32Array(n), wR = new Float32Array(n);
    for (let c = 0; c < ROAD_COATS.length; c++) {
      const k = ROAD_COATS[c][0], jit = ROAD_COATS[c][1] * hw;
      const jl = wobbleSeries(n, rnd, 2), jrr = wobbleSeries(n, rnd, 2);
      for (let i = 0; i < n; i++) {
        wL[i] = Math.max(0.4, half[i] * k + jl[i] * jit);
        wR[i] = Math.max(0.4, half[i] * k + jrr[i] * jit);
      }
      g.fillStyle = "rgba(" + ROADPAINT[ROAD_COATS[c][2]] + "," + ROAD_COATS[c][3] + ")";
      ribbonPath(g, s, nor, wL, wR);
      g.fill();
    }
    // two wheel ruts wandering down the middle
    g.lineCap = "round"; g.lineJoin = "round";
    for (let sgn = -1; sgn <= 1; sgn += 2) {
      const off = wobbleSeries(n, rnd, 3), p = [];
      for (let i = 0; i < n; i++) {
        const d = sgn * half[i] * 0.34 + off[i] * hw * 0.12;
        p.push([s[i][0] + nor[i * 2] * d, s[i][1] + nor[i * 2 + 1] * d]);
      }
      g.strokeStyle = "rgba(" + ROADPAINT.RUT + ",0.18)";
      g.lineWidth = Math.max(1, hw * 0.30);
      g.beginPath(); traceSmooth(g, p, true); g.stroke();
    }
    /* interior wear, CLIPPED to the path body: broad tonal patches so a long
     * haul road never reads as one flat stripe, then fine grit so it holds up
     * with the camera right down on it. Clipped because this is the part that
     * must NOT bleed — the verge blots below are what tie it into the grass. */
    g.save();
    for (let i = 0; i < n; i++) { wL[i] = half[i] * 1.06; wR[i] = half[i] * 1.06; }
    ribbonPath(g, s, nor, wL, wR);
    g.clip();
    const tones = Math.max(4, Math.round(n * 0.5));
    for (let i = 0; i < tones; i++) {
      const j = Math.min(n - 1, (rnd() * n) | 0);
      const d = (rnd() * 2 - 1) * half[j];
      const r = hw * (0.7 + rnd() * 1.9);
      g.fillStyle = "rgba(" + (rnd() < 0.5 ? ROADPAINT.PALE : ROADPAINT.RUT) + "," +
        (0.05 + rnd() * 0.11).toFixed(3) + ")";
      g.beginPath();
      g.ellipse(s[j][0] + nor[j * 2] * d, s[j][1] + nor[j * 2 + 1] * d,
        r, r * (0.40 + rnd() * 0.90), rnd() * 6.283, 0, 6.2832);
      g.fill();
    }
    const grit = Math.min(520, Math.max(24, n * 5));
    for (let i = 0; i < grit; i++) {
      const j = Math.min(n - 1, (rnd() * n) | 0);
      const d = (rnd() * 2 - 1) * half[j] * 1.06;
      g.fillStyle = rnd() < 0.5 ? "rgba(" + ROADPAINT.RUT + ",0.20)" : "rgba(" + ROADPAINT.GRIT + ",0.20)";
      g.beginPath();
      g.arc(s[j][0] + nor[j * 2] * d, s[j][1] + nor[j * 2 + 1] * d,
        Math.max(0.6, hw * (0.03 + rnd() * 0.10)), 0, 6.2832);
      g.fill();
    }
    g.restore();
    /* wear that SPILLS: scuffed patches and dust blooms just off the path —
     * the ones that land on the verge are what tie it into the grass */
    const blots = Math.max(3, Math.round(n * 0.34));
    for (let i = 0; i < blots; i++) {
      const j = Math.min(n - 1, (rnd() * n) | 0);
      const d = (rnd() * 2 - 1) * half[j] * 1.45;
      const x = s[j][0] + nor[j * 2] * d, y = s[j][1] + nor[j * 2 + 1] * d;
      const r = hw * (0.18 + rnd() * 0.55);
      g.fillStyle = "rgba(" + (rnd() < 0.45 ? ROADPAINT.PALE : ROADPAINT.RUT) + "," +
        (0.06 + rnd() * 0.13).toFixed(3) + ")";
      g.beginPath();
      g.ellipse(x, y, r, r * (0.45 + rnd() * 0.85), rnd() * 6.283, 0, 6.2832);
      g.fill();
    }
  }

  /* a flag / junction: the most walked-over ground on the map. Drawn as a
   * jittered polygon disc (never a circle — an arc() reads as a stamp). */
  const BLOB_COATS = [[1.60, "SCUFF", 0.14], [1.18, "DIRT", 0.30], [0.94, "DIRT", 0.70], [0.56, "PACK", 0.55]];
  function paintRoadBlob(g, b, coreOnly) {
    const rnd = jr((b.seed | 0) * 7919 + 13);
    const from = coreOnly ? BLOB_COATS.length - 1 : 0;
    for (let c = 0; c < BLOB_COATS.length; c++) {
      const k = BLOB_COATS[c][0], N = 15, pts = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * 6.2831853;
        const rr = b.r * k * (0.78 + rnd() * 0.44);
        pts.push([b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr]);
      }
      pts.push(pts[0]);
      if (c < from) continue;
      g.fillStyle = "rgba(" + ROADPAINT[BLOB_COATS[c][1]] + "," + BLOB_COATS[c][2] + ")";
      g.beginPath(); traceSmooth(g, pts, true); g.closePath(); g.fill();
    }
  }

  /**
   * Paint the whole road network into ONE map-space sheet.
   *   strokes: [{ pts:[[x,y],...] canvas px, w: half-width px, seed }]
   *   blobs:   [{ x, y, r, seed }]   trodden ground at flags / junctions
   * Returns the cached CanvasTexture, already flagged needsUpdate.
   */
  FSModels.paintRoadMask = function (px, strokes, blobs) {
    const t = roadMaskTarget(px), g = t.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, px, px);
    // junction ground first, so each road's own wear lies over its approach…
    for (let i = 0; i < blobs.length; i++) paintRoadBlob(g, blobs[i], false);
    for (let i = 0; i < strokes.length; i++) paintRoadStroke(g, strokes[i]);
    // …then the junction's packed core back on top: it IS the most trodden spot
    for (let i = 0; i < blobs.length; i++) paintRoadBlob(g, blobs[i], true);
    t.tex.needsUpdate = true;
    return t.tex;
  };
  /** painted coverage 0..255 at a normalised point of the sheet (test hook) */
  FSModels.roadMaskAlpha = function (px, u, v) {
    const t = CACHE["roadmask:" + px];
    if (!t) return -1;
    const x = Math.max(0, Math.min(px - 1, Math.round(u * px)));
    const y = Math.max(0, Math.min(px - 1, Math.round(v * px)));
    return t.ctx.getImageData(x, y, 1, 1).data[3];
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
   * ONE FIR SKIRT — a cone whose base ring is SCALLOPED, not circular.
   *
   * This is the fix for the last polygonal thing left in the wood. Farmstead's
   * camera looks down at 49-58°, so a conifer is read largely from ABOVE, and
   * from above an 8- or 10-segment cone is an octagon: a hard, obviously
   * geometric plate, which is exactly what the player was complaining about.
   * Alternating the base radius between full and ~0.7 turns that plan view
   * into a soft star of branch clusters, and jittering each point breaks the
   * regularity so no two skirts (or two trees) share an outline — all of it
   * for FEWER triangles than THREE.ConeGeometry, which pays for a degenerate
   * quad row at the apex and a full cap fan.
   */
  function firSkirt(r, hgt, seg, rnd, droop) {
    const pos = [], nor = [], uvs = [];
    const rr = [], yy = [];
    for (let i = 0; i < seg; i++) {
      const lobe = (i & 1) ? 0.70 : 1.0;
      rr.push(r * lobe * (0.88 + rnd() * 0.24));
      yy.push(-(droop || 0) * (0.5 + rnd() * 0.9) * ((i & 1) ? 0.5 : 1));
    }
    const apex = [0, hgt, 0];
    /* UVs (batch #4): u runs round the skirt, v runs base→apex, so the
     * conifer cell's needle BANDS lie across the cone the way branch tiers do.
     * Without a uv attribute mergeFoliage drops the part on the solid patch —
     * which is exactly what every fir did until now. */
    function tri(a, b, c, ua, ub, uc) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let k = 0; k < 3; k++) nor.push(nx, ny, nz);
      uvs.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    }
    const ring = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * 6.283;
      ring.push([Math.cos(a) * rr[i], yy[i], Math.sin(a) * rr[i]]);
    }
    /* uv per TRIANGLE, not per ring point: the wrap-around face would
     * otherwise span the whole cell backwards (u from (seg−1)/seg to 0) and
     * smear every column across one lobe. The apex takes the face's own
     * midpoint so each wedge stays inside its own painted column. */
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg;
      tri(apex, ring[i], ring[(i + 1) % seg], [(u0 + u1) * 0.5, 0.94], [u0, 0.06], [u1, 0.06]);
    }
    // a shallow underside so a low camera never sees inside the skirt
    const under = [0, -(droop || 0) * 0.4 - hgt * 0.10, 0];
    for (let i = 0; i < seg; i++) {
      const u0 = i / seg, u1 = (i + 1) / seg;
      tri(under, ring[(i + 1) % seg], ring[i], [(u0 + u1) * 0.5, 0.02], [u1, 0.06], [u0, 0.06]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    return g;
  }

  /**
   * Merge a tree: same contract as mergeColored, but every part addresses the
   * FOLIAGE ATLAS rather than the building one, and a part with no `fcell`
   * lands on a single constant uv inside the solid patch (zero uv derivative →
   * mip 0 → never alpha-tested away, however far the camera pulls back).
   * parts: [{geo, color, matrix?, fcell?}]
   */
  function mergeFoliage(parts) {
    const prepared = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      prepared.push({ g, c: new THREE.Color(p.color === undefined ? 0xffffff : p.color), fcell: p.fcell || null });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const tuv = [0, 0];
    let o = 0;
    for (let i = 0; i < prepared.length; i++) {
      const g = prepared[i].g, c = prepared[i].c, fc = prepared[i].fcell;
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      const src = g.attributes.uv;
      for (let k = 0; k < n; k++) {
        if (fc && src) folUV(fc, src.array[k * 2], src.array[k * 2 + 1], tuv);
        else folUV("solid", 0.5, 0.5, tuv);
        uv[(o + k) * 2] = tuv[0]; uv[(o + k) * 2 + 1] = tuv[1];
        col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b;
      }
      o += n;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    out.setAttribute("color", new THREE.BufferAttribute(col, 3));
    out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }

  /**
   * CHARM PASS 2026-08-02 tree — a FOLIAGE-CARD canopy over a small solid core.
   *
   * The Phase-V tree was a cluster of icosahedron lobes, and a wood of them is
   * exactly what the player meant by "very polygonal": the outline of every
   * canopy is twenty flat facets, and no amount of lobe-jittering hides that.
   * A card is 2 triangles carrying a painted leaf mass with an alpha cutout,
   * so the SILHOUETTE comes from paint (ragged, per-cell different, never
   * twinned) while the geometry stays tiny — a mature broadleaf went from ~216
   * triangles to ~90, which is how the fluff pays for itself.
   *
   * THE CAMERA DECIDED THE ARRANGEMENT. Farmstead looks down at 49-58°, so a
   * purely vertical billboard is the wrong primitive (you would be seeing 62%
   * of it, and its top edge would read as a cut). Cards are fanned around the
   * trunk and tilted back from vertical, plus 1-2 near-HORIZONTAL crown cards
   * on top, which are the ones this camera actually reads as fluff.
   *
   * The little icosahedron core is not decoration: cards alone leave a hollow
   * you can see straight through when two of them go edge-on together, and
   * LEAF_CORE keeps it comfortably inside the cards' reach so it can never
   * form the silhouette itself.
   *
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
    /* BATCH #4 2026-08-02 (reference: DOS-Settlers sprite trees) — SMALL DARK
     * TRUNKS. The old trunk was 0.055 + h*0.048 = 0.18 units on a mature tree,
     * a post you could tie a horse to, and it was painted in a light bark
     * brown; in the reference the trunk is a thin dark stem that the canopy
     * almost hides. Thinner, shorter under a broadleaf (the canopy comes down
     * further), and the colours themselves went dark in FSC.COL.TREE_TRUNK. */
    const trunkH = species === 0 ? h * 0.30 : h * 0.40;
    const trunkR = 0.042 + h * 0.034;
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
    const nCards = V.LEAF_CARDS[s - 1], nCrown = V.LEAF_CROWN_CARDS[s - 1];
    const leafCells = ["leafA", "leafB", "leafC", "leafD"];
    /** one foliage card: a quad standing at (x,y,z), yawed, tilted back */
    function card(cell, x, y, z, w, hh, yaw, tilt, color) {
      parts.push({
        geo: new THREE.PlaneGeometry(w, hh), color: color, fcell: cell,
        matrix: M(x, y, z, tilt * Math.cos(yaw), yaw, tilt * -Math.sin(yaw)),
      });
    }

    if (species === 0) {
      /* CONIFER — THE CONES STAY, and that was a finding, not a shortcut.
       * A pine built out of billboard cards was tried first and it fails on
       * THIS camera specifically: vertical cards go edge-on when you look down
       * at 52° and a wood turns into a field of green stars, while cards laid
       * flat enough to read from above stop being a pine at all. A cone is
       * simply the honest primitive for a conifer — the silhouette is also
       * gameplay (a player reads "wood over there" off it at a glance).
       * The fluff comes from softening it instead: one more radial segment so
       * the outline is rounder, per-tier tone drift, and ONE drooping needle
       * card per tier hung at the rim to break the cone's hard edge where it
       * meets the sky. */
      const span = h * 0.80;
      const baseR = 0.26 + h * 0.235;
      const tiers = [2, 3, 4, 4][s - 1];
      // batch #4: one more segment per size — the plan view of a fir IS a
      // rosette, and 10/12 rounds it off for two triangles a tier
      const seg = s <= 2 ? 10 : 12;
      for (let i = 0; i < tiers; i++) {
        const f = i / (tiers - 1);
        const cr = baseR * (1 - f * 0.58) * (0.92 + rnd() * 0.16);
        const ch = span * (0.46 - f * 0.10);
        const c = new THREE.Color(deep).lerp(new THREE.Color(bright), f * 0.82 + rnd() * 0.14);
        parts.push({
          /* the skirt is PAINTED now (batch #4): `conifer` is a fully opaque
           * atlas cell of banded needle clusters, so a fir reads with the same
           * layered-clump language as the broadleaves without any alpha on a
           * cone. It carried no uv at all before, which is why every fir was
           * flat-shaded off the solid patch. */
          geo: firSkirt(cr, ch, seg, rnd, ch * 0.22), color: c.getHex(), fcell: "conifer",
          matrix: M(tipX, trunkH + f * span * 0.66, tipZ, 0, rnd() * 6.283, 0),
        });
        /* the fringe is DELIBERATELY SMALL. A big needle card hung off the rim
         * of a tier and tilted toward horizontal is a wing, and four of them
         * make a green starfish when you look down at 52° — that was the first
         * version, and the screenshot killed it. Half a tier-radius wide and
         * only ~25° off vertical, it does the one job it is for: putting a few
         * loose needles on the skirt's outline. */
        if (i < tiers - 1) {
          const a = twist + i * 2.1 + (rnd() - 0.5) * 0.8;
          card(rnd() < 0.5 ? "needleA" : "needleB",
            tipX + Math.cos(a) * cr * 0.72, trunkH + ch * 0.30 + f * span * 0.66, tipZ + Math.sin(a) * cr * 0.72,
            cr * (0.58 + rnd() * 0.20), ch * (0.80 + rnd() * 0.25), a,
            0.42 + rnd() * 0.22,
            new THREE.Color(deep).lerp(new THREE.Color(bright), 0.30 + f * 0.55).getHex());
        }
      }
      // the spire — a pine without one reads decapitated from above
      parts.push({
        geo: firSkirt(0.075 + h * 0.052, h * 0.30, 6, rnd, 0), color: bright, fcell: "conifer",
        matrix: M(tipX, trunkH + span * 0.80, tipZ),
      });
    } else {
      /* BROADLEAF — solid core, a fan of leaf-mass cards around it, then the
       * crown cards this camera looks down onto. */
      /* BATCH #4 2026-08-02 — ROUNDER AND CHUNKIER. The reference's canopies
       * are fat and near-circular; the charm-pass fan was authored wide and
       * shallow (1.90 x 1.55 of the crown radius), so a mature tree read as a
       * flat splat with a wide waist. Cards are squarer, sit slightly higher
       * on the trunk, and the vertical spread of their centres is tighter, so
       * the outline closes into a ball instead of fraying sideways. */
      const cr = 0.28 + h * 0.235;
      const base = trunkH + cr * 0.62;
      /* the core must never REACH the silhouette, and on the young stages it
       * did: they carry two or three cards, so a core at the mature fraction
       * poked out between them as a hard lit diamond — a facet, on the pass
       * whose whole job is not having any. Scaled down where the canopy is
       * thin (batch #4). */
      /* …AND IT IS THE DARKEST THING IN THE TREE. Where a facet of it does
       * show between two cards it has to read as the shadow inside the canopy,
       * not as a lit diamond hanging in it — which is exactly what a core at
       * 36% of the way to the highlight tone looked like from this camera
       * (a wood full of bright green gems, caught on the review plate). */
      parts.push({
        geo: new THREE.IcosahedronGeometry(cr * V.LEAF_CORE * (s <= 2 ? 0.76 : 1) * (0.92 + rnd() * 0.14), 0),
        color: new THREE.Color(deep).multiplyScalar(0.80).getHex(),
        matrix: M(tipX, base + cr * 0.10, tipZ, rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.94, 1),
      });
      for (let i = 0; i < nCards; i++) {
        const a = twist + (i / nCards) * 6.283 + (rnd() - 0.5) * 0.48;
        const off = cr * (0.12 + rnd() * 0.22);
        const lift = (rnd() - 0.5) * cr * 0.32;
        const w = cr * (1.74 + rnd() * 0.42);
        const hh = cr * (1.62 + rnd() * 0.42);
        const up = Math.max(0, Math.min(1, 0.5 + lift / (cr * 0.5)));
        const c = new THREE.Color(deep).lerp(new THREE.Color(bright), 0.24 + up * 0.66 + rnd() * 0.10);
        card(leafCells[(rnd() * 4) | 0],
          tipX + Math.cos(a) * off, base + lift, tipZ + Math.sin(a) * off,
          w, hh, a, V.LEAF_CARD_TILT * (0.6 + rnd() * 0.8), c.getHex());
      }
      for (let i = 0; i < nCrown; i++) {
        const a = twist * 1.7 + (i / Math.max(1, nCrown)) * 3.14 + rnd();
        const w = cr * (1.75 + rnd() * 0.45);
        card(leafCells[(rnd() * 4) | 0],
          tipX + (rnd() - 0.5) * cr * 0.30, base + cr * (0.62 + rnd() * 0.24), tipZ + (rnd() - 0.5) * cr * 0.30,
          w, w * (0.82 + rnd() * 0.25), a, 1.30 + rnd() * 0.22,       // ~75-87° = nearly flat
          new THREE.Color(deep).lerp(new THREE.Color(bright), 0.86 + rnd() * 0.14).getHex());
      }
      if (s <= 2) {
        // a young tree is mostly twig — one sprig card sells that at 20 px
        card("sprig", tipX, base + cr * 0.1, tipZ, cr * 1.7, cr * 1.9,
          twist + 1.2, 0.16, new THREE.Color(bright).getHex());
      }
    }
    return mergeFoliage(parts);
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
         * line, and with three of them one is always nearly edge-on.
         * CHARM PASS 2026-08-02: the lean and the spread both came DOWN. At
         * the density this layer now runs at, a wide splayed clump reads as a
         * fallen leaf lying on the grass rather than grass growing out of it —
         * three near-upright sheets on almost the same root read as one tuft. */
        const tilt = 0.09 + rnd() * 0.10;
        const sp = V.TUFT_W * 0.34;           // spread scales WITH the clump
        parts.push({
          geo: g, color: 0xffffff, cell: null,
          matrix: M(Math.sin(a) * sp * 0.5 + (rnd() - 0.5) * sp, hh * 0.47, Math.cos(a) * sp * 0.5 + (rnd() - 0.5) * sp,
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
      /* NORMALS POINT STRAIGHT UP, and this is the single change that turned
       * the meadow from litter into ground cover. A blade sheet is vertical,
       * so its true normal is horizontal, and a horizontal normal under this
       * key light renders it far darker than the ground it stands on — ten
       * thousand dark spikes lying on bright grass, which is exactly the
       * "visually busy" verdict Phase F gave the first meadow. Facing the
       * normals up makes every clump take the SAME light as the terrain
       * underneath it, so the layer reads as the ground having a nap. It is
       * the standard foliage-card trick and it costs nothing. */
      for (let k = 0; k < total; k++) { nor[k * 3] = 0; nor[k * 3 + 1] = 1; nor[k * 3 + 2] = 0; }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      out.setAttribute("color", new THREE.BufferAttribute(col, 3));
      out.computeBoundingSphere();
      return out;
    });
  };

  /* CHARM PASS 2026-08-02: the meadow blows in the same wind as the trees.
   * The per-frame CPU breeze that used to recompose a rolling window of tuft
   * matrices is gone — it was the meadow's entire cost and it scaled with
   * density, which is the wrong shape for a layer about to get ten times
   * denser. TUFT_SWAY_MASK is set so a clump's TIP reaches full lean while its
   * roots stay nailed to the ground. */
  FSModels.tuftMat = function () {
    /* the ambient lift is deliberately CLOSE to the terrain's own (0x6d8b5c at
     * 0.14): a clump lit brighter than the ground it grows out of pops as a
     * green speck, and ten thousand specks is confetti, not a meadow. */
    return cached("mat:tuft", () => litBothSides(swayMat(mat(0xffffff, {
      vertexColors: true, map: FSModels.tuftTex(), alphaTest: 0.36,
      side: THREE.DoubleSide, emissiveOf: 0x7f9c5c, emissiveK: 0.18,
    }), FSC.VIS.TUFT_SHADER_SWAY, FSC.VIS.TUFT_SWAY_MASK)));
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

  /** wildflowers nod in the same wind, a touch more than the grass under them */
  FSModels.flowerMat = function () {
    return cached("mat:flowerSway", () => {
      const m = swayMat(mat(0xffffff, { vertexColors: true, emissiveOf: 0xd8c46a, emissiveK: 0.5 }),
        FSC.VIS.TUFT_SHADER_SWAY * 1.25, 4.4);
      m.userData.shared = true;
      return m;
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
  /* ===================================================================== */
  /* ===== WIND (playtest 2026-08-01: "the trees are dead still") ========= */
  /* ===================================================================== */
  /*
   * A vertex-shader lean on the tree materials. Render-only in the strictest
   * sense: it never touches FSC.rng, never enters a geometry, and the sim
   * cannot observe it — a tree's collision, its object kind and its vertex are
   * all unchanged, only the pixels move.
   *
   * The mask is the vertex's own HEIGHT, so the trunk foot stays planted and
   * the canopy carries the motion, and the phase is hashed from the INSTANCE's
   * world position (instanceMatrix[3]), so a wood ripples instead of swaying
   * as one block. Two detuned sines keep it from reading as a metronome.
   *
   * This is a calm farming kingdom, not a gale: TREE_SWAY is the world-unit
   * displacement at the top of a mature tree, and 0.07 on a ~2-unit pine is
   * about four degrees of lean.
   */
  const treeSway = { uSwayT: { value: 0 }, uSwayA: { value: FSC.VIS.TREE_SWAY } };
  FSModels.treeSway = treeSway;
  FSModels.setTreeSway = function (on) {
    treeSway.uSwayA.value = on === false ? 0 : FSC.VIS.TREE_SWAY;
    return treeSway.uSwayA.value > 0;
  };
  FSModels.treeSwayOn = function () { return treeSway.uSwayA.value > 0; };
  /**
   * CHARM PASS 2026-08-02: the wind is SHARED with the meadow now. `uSwayA` is
   * still the one global amplitude (and still the one kill switch — the film
   * strips flip it and the whole world goes pixel-stable, grass included), and
   * a per-material `uSwayK` scales it: x = how much of the wind this material
   * takes, y = the height at which it reaches full lean (a 2.6-unit tree and a
   * 0.4-unit tuft need very different masks to bend the same amount at the tip).
   *
   * uSwayK is a per-material uniform, not a baked constant, precisely so grass
   * and trees can keep sharing ONE compiled program.
   */
  function swayMat(m, amp, mask) {
    const k = { value: new THREE.Vector2(amp === undefined ? 1 : amp,
      mask === undefined ? FSC.VIS.TREE_SWAY_MASK : mask) };
    m.userData = m.userData || {};
    m.userData.swayK = k;
    m.onBeforeCompile = function (shader) {
      shader.uniforms.uSwayT = treeSway.uSwayT;
      shader.uniforms.uSwayA = treeSway.uSwayA;
      shader.uniforms.uSwayK = k;
      shader.vertexShader = "uniform float uSwayT;\nuniform float uSwayA;\nuniform vec2 uSwayK;\n" + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", [
        "#include <begin_vertex>",
        "#ifdef USE_INSTANCING",
        "  vec3 swayRoot = instanceMatrix[3].xyz;",
        "#else",
        "  vec3 swayRoot = vec3(0.0);",
        "#endif",
        "  float swayPh = swayRoot.x * 0.63 + swayRoot.z * 0.91;",
        "  float swayM = clamp(transformed.y * uSwayK.y, 0.0, 1.0);",
        "  swayM *= swayM;",
        "  float swayS = sin(uSwayT * 1.15 + swayPh) * 0.72 + sin(uSwayT * 0.47 + swayPh * 1.9) * 0.28;",
        "  transformed.x += swayS * swayM * uSwayA * uSwayK.x;",
        "  transformed.z += cos(uSwayT * 0.83 + swayPh * 0.6) * swayM * uSwayA * uSwayK.x * 0.45;",
      ].join("\n"));
    };
    // …or three reuses the plain Lambert program and nothing ever moves
    m.customProgramCacheKey = function () { return "fsTreeSway"; };
    return m;
  }
  FSModels.swayMat = swayMat;

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
            /* DoubleSide is not optional on a card canopy — half the cards
             * present their back to the camera at any given yaw, and the game
             * lets you orbit the whole 360°. alphaTest (not `transparent`) so
             * a wood needs no depth sorting at all. */
            mat: litBothSides(swayMat(mat(0xffffff, Object.assign({
              emissiveOf: leaf, emissiveK: 0.26, map: FSModels.foliageAtlas(),
              alphaTest: V.LEAF_ALPHA_TEST, side: THREE.DoubleSide,
            }, vc)))),
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
  /** The castle — modelled after the family's Tripo reference piece: a rocky
   * motte, crenellated curtain walls, a red-gabled keep, a cluster of slender
   * round towers with maroon spires, an open bastion, and a timber bridge to
   * the gate. All house-atlas geometry so it reads bright under game light. */
  /** Gabled-roof kit (unit frame: ridge along X, base at y0, eaves at z ±1).
   * `gableGeo` is the full closed prism; `gableRoofGeo`/`gablePedGeo` split the
   * roof planes from the two end triangles so a keep can wear stone pediments
   * under a maroon roof. */
  const GABLE_V = {
    A: [-0.5, 0, -1], B: [-0.5, 0, 1], C: [-0.5, 1, 0],
    D: [0.5, 0, -1], E: [0.5, 0, 1], F: [0.5, 1, 0],
  };
  function gableBuild(key, tris, uvOf) {
    return cached(key, () => {
      const pos = [], uv = [];
      for (const t of tris) for (const v of t) { pos.push(v[0], v[1], v[2]); const p = uvOf(v); uv.push(p[0], p[1]); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      return geo;
    });
  }
  function gableGeo() {
    const V = GABLE_V;
    return gableBuild("geo:gable", [
      [V.A, V.B, V.C], [V.D, V.F, V.E],
      [V.A, V.F, V.D], [V.A, V.C, V.F],
      [V.B, V.F, V.C], [V.B, V.E, V.F],
    ], (v) => [v[0] + 0.5, v[1]]);
  }
  function gableRoofGeo() {
    const V = GABLE_V;
    return gableBuild("geo:gableRoof", [
      [V.A, V.F, V.D], [V.A, V.C, V.F],
      [V.B, V.F, V.C], [V.B, V.E, V.F],
    ], (v) => [v[0] + 0.5, 1 - Math.abs(v[2])]);
  }
  function gablePedGeo() {
    const V = GABLE_V;
    return gableBuild("geo:gablePed", [
      [V.A, V.B, V.C], [V.D, V.F, V.E],
    ], (v) => [v[2] * 0.5 + 0.5, v[1]]);
  }

  /** Castle-only atlas material: same atlas + vertex colours as bldMat, but a
   * COOL grey emissive lift — the shared warm BLD_WALL lift washes grey stone
   * back to cream no matter what the vertex colour says. */
  function castleMat() {
    return cached("mat:castleBld", () => mat(0xffffff, {
      vertexColors: true, map: bldAtlas(), emissiveOf: 0x8b8f96, emissiveK: 0.22,
    }));
  }

  FSModels.castle = function (playerIdx) {
    const color = FSModels.playerColor(playerIdx);
    const V = FSC.VIS;
    // The atlas cells are warm-based (stone #ded6c6) and the game light is warm,
    // so the greys are BLUE-SHIFTED: texture x vertex x warm light lands on
    // neutral fieldstone grey (matched by eye against the Tripo reference).
    const RED = COL.CASTLE_ROOF, LIGHT = 0x9aa3b8, WALLS = 0x8a93a8, TRIM = 0x767f94, DARK = 0x2e2822;
    const g = new THREE.Group();
    const stone = [], wood = [], team = [];

    // ---- the rocky motte the whole castle stands on, and the courtyard slab
    // two frustums sharing the r=2.55 ring at y0.14 EXACTLY — an open skirt whose
    // top ring floats off the upper slope lets the sky grin through at grazing angles
    stone.push({ geo: new THREE.CylinderGeometry(2.28, 2.55, 0.26, 8), color: 0x757263, cell: "rock", matrix: M(0, 0.27, 0, 0, Math.PI / 8, 0) });
    stone.push({ geo: new THREE.CylinderGeometry(2.55, 2.76, 0.14, 8, 1, true), color: 0x615e52, cell: "rock", matrix: M(0, 0.07, 0, 0, Math.PI / 8, 0) });
    stone.push({ geo: new THREE.BoxGeometry(3.30, 0.10, 3.10), color: 0x83857c, cell: "stone", matrix: M(0, 0.45, 0) });
    stone.push({ geo: new THREE.BoxGeometry(0.52, 0.34, 0.44), color: 0x6a6759, cell: "rock", matrix: M(2.00, 0.44, 1.60, 0, 0.5, 0.1) });
    stone.push({ geo: new THREE.BoxGeometry(0.46, 0.30, 0.40), color: 0x6a6759, cell: "rock", matrix: M(-1.85, 0.40, -1.42, 0, 0.9, -0.08) });

    // ---- crenellated curtain walls (gate bay lives in the front run, +Z)
    const WALL_H = 1.05, WY = 0.40 + WALL_H / 2;
    stone.push({ geo: new THREE.BoxGeometry(0.75, WALL_H, 0.22), color: WALLS, cell: "stone", matrix: M(-1.175, WY, 1.40) });
    stone.push({ geo: new THREE.BoxGeometry(1.35, WALL_H, 0.22), color: WALLS, cell: "stone", matrix: M(0.875, WY, 1.40) });
    stone.push({ geo: new THREE.BoxGeometry(3.10, WALL_H, 0.22), color: WALLS, cell: "stone", matrix: M(0, WY, -1.40) });
    stone.push({ geo: new THREE.BoxGeometry(0.22, WALL_H, 2.80), color: WALLS, cell: "stone", matrix: M(-1.55, WY, 0) });
    stone.push({ geo: new THREE.BoxGeometry(0.22, WALL_H, 2.80), color: WALLS, cell: "stone", matrix: M(1.55, WY, 0) });
    const MY = 0.40 + WALL_H + 0.09;
    for (const mx of [-1.35, -0.95, 0.55, 1.05]) stone.push({ geo: new THREE.BoxGeometry(0.20, 0.18, 0.26), color: WALLS, cell: "stone", matrix: M(mx, MY, 1.40) });
    for (const mx of [-0.85, 0.25]) stone.push({ geo: new THREE.BoxGeometry(0.20, 0.18, 0.26), color: WALLS, cell: "stone", matrix: M(mx, MY, -1.40) });
    for (const mz of [-0.75, 0.05]) stone.push({ geo: new THREE.BoxGeometry(0.26, 0.18, 0.20), color: WALLS, cell: "stone", matrix: M(-1.55, MY, mz) });
    for (const mz of [-0.35, 0.45]) stone.push({ geo: new THREE.BoxGeometry(0.26, 0.18, 0.20), color: WALLS, cell: "stone", matrix: M(1.55, MY, mz) });

    // ---- the keep: tall stone hall, stone pediments under a maroon roof
    stone.push({ geo: new THREE.BoxGeometry(1.90, 2.15, 1.50), color: WALLS, cell: "stone", matrix: M(-0.42, 1.475, -0.52) });
    stone.push({ geo: new THREE.BoxGeometry(2.00, 0.09, 1.60), color: TRIM, cell: "stone", matrix: M(-0.42, 2.38, -0.52) });
    stone.push({ geo: gablePedGeo(), color: WALLS, cell: "stone", matrix: M(-0.42, 2.55, -0.52, 0, 0, 0, 1.86, 1.11, 0.78) });
    team.push({ geo: gableRoofGeo(), color: RED, cell: "shingle", matrix: M(-0.42, 2.55, -0.52, 0, 0, 0, 2.05, 1.15, 0.82) });
    // window slits + two warm lit panes
    for (const wx of [-1.05, -0.42, 0.21]) for (const wy of [1.55, 2.12]) {
      stone.push({ geo: new THREE.BoxGeometry(0.14, 0.32, 0.06), color: DARK, matrix: M(wx, wy, 0.24) });
    }
    wood.push({ geo: new THREE.BoxGeometry(0.16, 0.20, 0.06), color: V.WINDOW_GLOW, matrix: M(0.21, 1.08, 0.245) });
    wood.push({ geo: new THREE.BoxGeometry(0.06, 0.20, 0.16), color: V.WINDOW_GLOW, matrix: M(-1.40, 1.30, -0.52) });

    // ---- the tower cluster (tallest carries the flag, like the reference)
    // A: great tower engaged on the keep's gate-side corner
    stone.push({ geo: new THREE.CylinderGeometry(0.34, 0.42, 3.30, 8, 1, true), color: LIGHT, cell: "stone", matrix: M(0.62, 2.05, 0.28) });
    stone.push({ geo: new THREE.CylinderGeometry(0.46, 0.36, 0.15, 8, 1, true), color: TRIM, cell: "stone", matrix: M(0.62, 3.74, 0.28) });
    team.push({ geo: new THREE.ConeGeometry(0.55, 0.95, 8, 1, true), color: RED, cell: "shingle", matrix: M(0.62, 4.28, 0.28) });
    stone.push({ geo: new THREE.BoxGeometry(0.10, 0.30, 0.06), color: DARK, matrix: M(0.62, 2.65, 0.66) });
    stone.push({ geo: new THREE.BoxGeometry(0.10, 0.30, 0.06), color: DARK, matrix: M(0.62, 1.85, 0.70) });
    // B: slender watchtower behind, second tallest, player pennant at the tip
    stone.push({ geo: new THREE.CylinderGeometry(0.24, 0.30, 2.90, 8, 1, true), color: LIGHT, cell: "stone", matrix: M(1.12, 1.85, -0.78) });
    team.push({ geo: new THREE.ConeGeometry(0.40, 0.78, 8, 1, true), color: RED, cell: "shingle", matrix: M(1.12, 3.69, -0.78) });
    team.push({ geo: new THREE.ConeGeometry(0.10, 0.24, 6, 1, true), color: color, matrix: M(1.12, 4.18, -0.78) });
    stone.push({ geo: new THREE.BoxGeometry(0.10, 0.26, 0.06), color: DARK, matrix: M(1.12, 2.42, -0.50) });
    // C: mid tower over the gate wing
    stone.push({ geo: new THREE.CylinderGeometry(0.30, 0.36, 2.10, 8, 1, true), color: LIGHT, cell: "stone", matrix: M(-1.18, 1.45, 0.52) });
    team.push({ geo: new THREE.ConeGeometry(0.48, 0.85, 8, 1, true), color: RED, cell: "shingle", matrix: M(-1.18, 2.925, 0.52) });
    stone.push({ geo: new THREE.BoxGeometry(0.10, 0.26, 0.06), color: DARK, matrix: M(-1.18, 1.72, 0.88) });
    // D: little corner turret by the gate (base runs down the motte slope)
    stone.push({ geo: new THREE.CylinderGeometry(0.24, 0.28, 1.85, 8, 1, true), color: LIGHT, cell: "stone", matrix: M(-1.48, 0.925, 1.28) });
    team.push({ geo: new THREE.ConeGeometry(0.38, 0.62, 8, 1, true), color: RED, cell: "shingle", matrix: M(-1.48, 2.16, 1.28) });
    // E: fat open bastion, crenellated, opposite the turret (footed on the slope)
    stone.push({ geo: new THREE.CylinderGeometry(0.54, 0.62, 1.90, 8, 1, true), color: LIGHT, cell: "stone", matrix: M(1.46, 0.95, 1.22) });
    stone.push({ geo: new THREE.CircleGeometry(0.54, 8), color: 0x7e8797, cell: "stone", matrix: M(1.46, 1.885, 1.22, -Math.PI / 2, 0, 0) });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      stone.push({ geo: new THREE.BoxGeometry(0.16, 0.16, 0.16), color: LIGHT, cell: "stone", matrix: M(1.46 + Math.cos(a) * 0.48, 1.97, 1.22 + Math.sin(a) * 0.48, 0, -a, 0) });
    }

    // ---- red-roofed halls tucked against the walls (the annex wings)
    stone.push({ geo: new THREE.BoxGeometry(0.95, 0.90, 0.85), color: WALLS, cell: "stone", matrix: M(1.12, 0.85, 0.30) });
    team.push({ geo: gableGeo(), color: RED, cell: "shingle", matrix: M(1.12, 1.30, 0.30, 0, Math.PI / 2, 0, 0.95, 0.50, 0.52) });
    stone.push({ geo: new THREE.BoxGeometry(0.80, 0.75, 0.62), color: WALLS, cell: "stone", matrix: M(-1.02, 0.775, 1.10) });
    team.push({ geo: gableGeo(), color: RED, cell: "shingle", matrix: M(-1.02, 1.15, 1.10, 0, 0, 0, 0.85, 0.42, 0.36) });

    // ---- gatehouse: arch, banded door, red cap and the timber bridge out
    stone.push({ geo: new THREE.BoxGeometry(1.00, 1.50, 0.44), color: 0x939cb1, cell: "stone", matrix: M(-0.30, 1.15, 1.42) });
    stone.push({ geo: new THREE.BoxGeometry(1.12, 0.12, 0.52), color: TRIM, cell: "stone", matrix: M(-0.30, 1.96, 1.42) });
    team.push({ geo: gableGeo(), color: RED, cell: "shingle", matrix: M(-0.30, 2.02, 1.42, 0, 0, 0, 1.12, 0.42, 0.30) });
    stone.push({ geo: new THREE.BoxGeometry(0.72, 0.98, 0.05), color: 0xa4adc2, cell: "stone", matrix: M(-0.30, 0.92, 1.625) });
    stone.push({ geo: new THREE.BoxGeometry(0.56, 0.86, 0.05), color: DARK, matrix: M(-0.30, 0.86, 1.645) });
    stone.push({ geo: new THREE.CircleGeometry(0.28, 6, 0, Math.PI), color: DARK, matrix: M(-0.30, 1.29, 1.646) });
    wood.push({ geo: new THREE.BoxGeometry(0.50, 0.70, 0.05), color: 0x4d3826, cell: "plank", matrix: M(-0.30, 0.78, 1.655) });
    wood.push({ geo: new THREE.BoxGeometry(0.54, 0.06, 0.06), color: 0x6a6055, matrix: M(-0.30, 0.92, 1.66) });
    wood.push({ geo: new THREE.BoxGeometry(0.62, 0.08, 1.56), color: 0x8a6b42, cell: "plank", matrix: M(-0.30, 0.245, 2.42, 0.26, 0, 0) });
    wood.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 1.44), color: 0x75592f, matrix: M(-0.58, 0.60, 2.38, 0.26, 0, 0) });
    wood.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 1.44), color: 0x75592f, matrix: M(-0.02, 0.60, 2.38, 0.26, 0, 0) });
    wood.push({ geo: new THREE.BoxGeometry(0.06, 0.38, 0.06), color: 0x75592f, matrix: M(-0.58, 0.24, 3.02) });
    wood.push({ geo: new THREE.BoxGeometry(0.06, 0.38, 0.06), color: 0x75592f, matrix: M(-0.02, 0.24, 3.02) });

    // ---- the flag over the great tower
    wood.push({ geo: new THREE.CylinderGeometry(0.035, 0.035, 1.05, 5, 1, true), color: 0x8a8070, matrix: M(0.62, 5.02, 0.28) });

    const body = new THREE.Mesh(mergeColored(stone.concat(wood)), castleMat());
    body.name = "castleBody";
    g.add(body);
    const trim = new THREE.Mesh(mergeColored(team), castleMat());
    trim.name = "castleTrim";
    g.add(trim);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(0.60, 0.42),
      mat(0xffffff, { map: bannerTexture(color), side: THREE.DoubleSide, emissiveOf: color, emissiveK: 0.35 })
    );
    banner.position.set(0.94, 5.32, 0.28);
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
    parts.push({ geo: new THREE.BoxGeometry(w * 1.06, 0.10, d * 1.06), color: V.FOUNDATION, cell: "stone", role: "base", matrix: M(0, 0.05, 0) });
    // walls
    parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: wall, cell: wallCell, role: "wall", matrix: M(0, h / 2 + 0.08, 0) });
    // corner posts + a sill band
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      parts.push({
        geo: new THREE.BoxGeometry(0.085, h, 0.085), color: timber, cell: "wood", role: "post",
        matrix: M(sx * w * 0.5, h / 2 + 0.08, sz * d * 0.5),
      });
    }
    parts.push({ geo: new THREE.BoxGeometry(w * 1.02, 0.065, d * 1.02), color: timber, cell: "wood", role: "sill", matrix: M(0, h * 0.60 + 0.08, 0) });
    const eave = h + 0.08;
    if (o.roofType === "flat") {
      parts.push({ geo: new THREE.BoxGeometry(w * 1.16, 0.13, d * 1.16), color: roof, cell: roofCell, role: "roof", matrix: M(0, eave + 0.065, 0) });
      parts.push({ geo: new THREE.BoxGeometry(w * 1.22, 0.05, d * 1.22), color: timber, cell: "wood", role: "eave", matrix: M(0, eave, 0) });
    } else if (o.roofType === "gable") {
      const rh = o.roofH || 0.6;
      const slope = Math.atan2(rh, w * 0.5);
      const rl = Math.sqrt(rh * rh + (w * 0.55) * (w * 0.55)) * 2 * 0.56;
      for (let s = -1; s <= 1; s += 2) {
        parts.push({
          geo: new THREE.BoxGeometry(rl, 0.09, d * 1.2), color: roof, cell: roofCell, role: "roof",
          matrix: M(s * w * 0.26, eave + rh * 0.5, 0, 0, 0, -s * slope),
        });
      }
      // gable end triangles, ridge beam and eave shadow-line
      for (let s = -1; s <= 1; s += 2) {
        parts.push({
          geo: new THREE.ConeGeometry(w * 0.52, rh, 3), color: wall, cell: wallCell, role: "roof",
          matrix: M(0, eave + rh * 0.5, s * d * 0.5, Math.PI / 2, 0, 0, 1, 1, 1),
        });
      }
      parts.push({ geo: new THREE.BoxGeometry(0.09, 0.09, d * 1.24), color: timber, cell: "wood", role: "roof", matrix: M(0, eave + rh, 0) });
      parts.push({ geo: new THREE.BoxGeometry(w * 1.12, 0.05, d * 1.22), color: timber, cell: "wood", role: "eave", matrix: M(0, eave - 0.01, 0) });
    } else {
      const rh = o.roofH || 0.62;
      parts.push({
        geo: new THREE.ConeGeometry(w * 0.88, rh, 4), color: roof, cell: roofCell, role: "roof",
        matrix: M(0, eave + rh * 0.5, 0, 0, Math.PI / 4, 0),
      });
      parts.push({ geo: new THREE.BoxGeometry(w * 1.06, 0.05, d * 1.06), color: timber, cell: "wood", role: "eave", matrix: M(0, eave, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.07, 0.16, 0.07), color: timber, role: "roof", matrix: M(0, eave + rh + 0.04, 0) });
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
    /* batch #4: the shell records its own geometry so the construction
     * stages can derive a timber frame and a roof truss from the SAME
     * numbers the finished building was built from. */
    parts.shellBox = { w: w, d: d, h: h, eave: eave, roofType: o.roofType || "hip",
      roofH: o.roofH || 0.6, timber: timber, wall: wall, wallCell: wallCell };
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
  /* ═════════════════════════════════════════════════════════════════════════
   * FOUR CONSTRUCTION STAGES, DERIVED (batch #4, 2026-08-02)
   *
   * A site used to raise ONE generic box on a pad whatever it was going to
   * become: the same rising plaster cube for a windmill, a fortress and a
   * bakery, and no way to tell from across the valley what the crew was busy
   * with. It shows four real stages now —
   *   0  a cleared pad with the delivered planks and stones stacked on it
   *   1  a TIMBER FRAME  — corner posts, a sill and a top plate
   *   2  WALLS UP, NO ROOF — the finished model with its roof taken off
   *   3  …plus the bare roof TRUSSES, the last thing before it is a building
   * and then the finished model itself.
   *
   * STAGES 2 AND 3 ARE DERIVED FROM THE FINAL MODEL, and that is what makes 23
   * building types tractable: nobody hand-models 92 meshes. A part is
   * classified, in this order of confidence —
   *   1. its own `role`, which `shell()` stamps on everything it builds (that
   *      is the roof of every ordinary building, exactly, by construction);
   *   2. its ATLAS CELL — thatch / shingle / slate / tile / straw are roofing
   *      materials and nothing else in this world is made of them;
   *   3. its COLOUR against the roof palette (a hand-authored roof plane that
   *      reuses ROOF_THATCH etc. without a cell);
   *   4. failing all three, its HEIGHT: anything whose centre sits above the
   *      model's own wall line is treated as roof-or-above, which catches
   *      chimneys, spires, headframes and battlements — things that genuinely
   *      should not be standing over a roofless shell.
   * The frame and the trusses come from the SHELL BOX the finished model
   * recorded (w/d/h/eave/roofType), or from the part bounds when a type builds
   * its body by hand. Nothing here is per-type.
   */
  const ROOF_CELLS = { thatch: 1, shingle: 1, slate: 1, tile: 1, straw: 1 };
  function roofPalette() {
    const V = FSC.VIS;
    return [V.ROOF_THATCH, V.ROOF_SHINGLE, V.ROOF_SLATE, COL.ROOF_ALT];
  }
  /** the y of a part's own translation (M() writes it into element 13) */
  function partY(p) { return p.matrix ? p.matrix.elements[13] : 0; }

  /**
   * Split a finished building's part list into what stands when the roof is
   * off and what does not. Returns { body, roof, wallTop, w, d, box }.
   */
  function classifyBuilding(built) {
    const parts = built.parts;
    const roofCols = roofPalette();
    const sb = parts.shellBox || null;
    let hi = 0;
    for (const p of parts) hi = Math.max(hi, partY(p));
    /* the wall line: the shell knows it exactly; otherwise take the tallest
     * part that is definitely NOT roofing and allow a little headroom */
    let wallTop = sb ? sb.eave : 0;
    if (!sb) {
      for (const p of parts) {
        if (p.cell && ROOF_CELLS[p.cell]) continue;
        if (roofCols.indexOf(p.color) >= 0) continue;
        wallTop = Math.max(wallTop, partY(p) * 0.92);
      }
      wallTop = Math.min(wallTop, hi * 0.80);
    }
    const body = [], roof = [];
    for (const p of parts) {
      let isRoof = false;
      if (p.role === "roof") isRoof = true;
      else if (p.role) isRoof = false;                       // base/wall/post/sill/eave stay
      else if (p.cell && ROOF_CELLS[p.cell]) isRoof = true;
      else if (roofCols.indexOf(p.color) >= 0) isRoof = true;
      else if (partY(p) > wallTop + 0.02) isRoof = true;      // chimneys, spires, battlements
      (isRoof ? roof : body).push(p);
    }
    // footprint, for the frame and the trusses
    let w = sb ? sb.w : 0, d = sb ? sb.d : 0;
    if (!sb) {
      for (const p of body) {
        const m = p.matrix;
        if (!m) continue;
        w = Math.max(w, Math.abs(m.elements[12]) * 2);
        d = Math.max(d, Math.abs(m.elements[14]) * 2);
      }
      w = Math.max(w, 0.8); d = Math.max(d, 0.8);
    }
    return { body, roof, wallTop: wallTop || hi * 0.7, w, d, shellBox: sb, hi };
  }
  /** cached per (type, player) — the classification is pure and not cheap */
  FSModels.buildingStages = function (type, playerIdx) {
    const key = "stages:" + type + ":" + (playerIdx || 0);
    if (CACHE[key]) return CACHE[key];
    const built = buildingParts(type, playerIdx);
    const c = classifyBuilding(built);
    CACHE[key] = c;
    return c;
  };
  /** read-only report for the suites: how each type classified */
  FSModels.buildingStageInfo = function (type) {
    const c = FSModels.buildingStages(type, 0);
    return {
      type: type, bodyParts: c.body.length, roofParts: c.roof.length,
      wallTop: +c.wallTop.toFixed(3), w: +c.w.toFixed(3), d: +c.d.toFixed(3),
      fromShell: !!c.shellBox, height: +c.hi.toFixed(3),
    };
  };

  FSModels.buildingDetail = function (type) {
    const g = FSModels.building(type, 0);
    let tris = 0;
    g.traverse((o) => {
      if (!o.geometry || !o.geometry.attributes.position) return;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    const out = {
      type: type, props: g.userData.props || [], chimney: g.userData.chimney || null,
      spin: !!g.userData.spin, tris: Math.round(tris),
      textured: !!(g.children[0] && g.children[0].material && g.children[0].material.map),
    };
    // the merged geometry is fresh per call — cached SOURCE geos (gable, boat)
    // are cloned by mergeColored, so this dispose never touches the cache
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
  /* PLAYTEST 2026-08-02: ADDITIVE. `advanceRings` fades a ring by multiplying
   * its vertex colour toward black — which on an ordinary blended material is
   * not a fade at all, it is a ramp to a dark ring painted over the water (the
   * reported "black circle" under a landing fish). Additive blending makes that
   * same colour ramp mean what it was always written to mean: toward black =
   * toward invisible. The fish's landing ring is gone entirely (fs-fx.js); this
   * keeps the take-off ripple and the warehouse delivery glimmer honest. */
  FSModels.ringMat = function () {
    return cached("mat:fxring", () => new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false,
      blending: THREE.AdditiveBlending,
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
  /** Tiny good crate — one instanced mesh, per-instance colour from FSC.RES_COLOR.
   *  KEPT: it is the fallback the goods-sprite layer falls back TO, and the
   *  construction site still stacks real crates of delivered material. */
  FSModels.crateGeo = function () {
    return cached("geo:crate", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.30, 0.22, 0.30), color: 0xffffff, matrix: M(0, 0.11, 0) },
      { geo: new THREE.BoxGeometry(0.33, 0.05, 0.33), color: 0xdddddd, matrix: M(0, 0.215, 0) },
    ]));
  };

  /* ===================================================================== */
  /* ===== THE GOODS (playtest 2026-08-02) ================================ */
  /* ===================================================================== */
  /*
   * Twenty-six things move through this economy and every one of them used to
   * be the SAME 0.30-unit crate in a different colour. At the flag you could
   * not tell a loaf from a pig; at the carry anchor you could not tell what a
   * settler was walking across the map for. That is a lot of the game's
   * readability spent on one shared box.
   *
   * So each good gets its own little sculpt, in the house language: primitives,
   * per-part vertex colours, merged into one geometry. They are AUTHORED FOR
   * A SILHOUETTE, not for detail — the target is a ~24 px sprite cell at play
   * zoom, where the outline and one strong hue are the whole message. Every
   * model is built inside a 0.34-unit cube standing on y=0, so the baker's
   * frustum fits all of them and the sheet's cells are directly comparable.
   *
   * These are the BAKE SOURCES for assets/farmstead/goods/ (tools/_fs_bake_goods.cjs).
   * They are perfectly drawable as meshes too — that is the fallback path when
   * the sheet does not arrive — but at play size the sprite is the cheaper and
   * (because it is baked with real light and antialiasing) the prettier draw.
   *
   * ZERO generated-asset spend: every one of these is code.
   */
  const GD = {};                     // res id -> parts builder
  /* helpers: (…shape, colour, position, rotation, scale). A cylinder's and a
   * cone's own axis is +Y, so `rz: PI/2` lays one along X — the shaft every
   * hand tool is built on. */
  function box(w, h, d, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    return { geo: new THREE.BoxGeometry(w, h, d), color, matrix: M(x, y, z, rx, ry, rz, sx, sy, sz) };
  }
  function cyl(rt, rb, h, seg, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    return { geo: new THREE.CylinderGeometry(rt, rb, h, seg), color, matrix: M(x, y, z, rx, ry, rz, sx, sy, sz) };
  }
  function ball(r, color, x, y, z, sx, sy, sz) {
    return { geo: new THREE.IcosahedronGeometry(r, 0), color, matrix: M(x, y, z, 0, 0, 0, sx, sy, sz) };
  }
  function cone(r, h, seg, color, x, y, z, rx, ry, rz, sx, sy, sz) {
    return { geo: new THREE.ConeGeometry(r, h, seg), color, matrix: M(x, y, z, rx, ry, rz, sx, sy, sz) };
  }
  /** the shaft-and-head shape every hand tool shares (handle along +x) */
  function tool(handleCol, headParts, len) {
    const L = len === undefined ? 0.30 : len;
    return [cyl(0.020, 0.020, L, 6, handleCol, 0, 0.055, 0, 0, 0, Math.PI / 2)].concat(headParts);
  }

  // ---- building materials -------------------------------------------------
  GD.plank = () => [                              // three sawn boards, stacked askew
    box(0.30, 0.035, 0.11, 0xd8ae70, 0, 0.020, 0),
    box(0.30, 0.035, 0.11, 0xc79a5e, 0.01, 0.056, 0.015, 0, 0.10, 0),
    box(0.30, 0.035, 0.11, 0xe3bd82, -0.012, 0.092, -0.012, 0, -0.13, 0),
  ];
  GD.stone = () => [                              // a SQUARED building block — the flat
    box(0.230, 0.130, 0.190, 0xa4aab2, 0, 0.070, 0, 0, 0.18, 0),   // faces are what tell it
    box(0.190, 0.075, 0.160, 0xb4bac2, 0.010, 0.165, 0, 0, -0.10, 0),  // apart from an ore lump
    ball(0.048, 0x8b9199, -0.115, 0.055, 0.075),                   // one chipped corner
  ];
  GD.lumber = () => [                             // a bark log with pale end-grain
    cyl(0.075, 0.075, 0.30, 8, 0x6e4f2f, 0, 0.078, 0, 0, 0, Math.PI / 2),
    cyl(0.076, 0.076, 0.012, 8, 0xd8bb8c, 0.150, 0.078, 0, 0, 0, Math.PI / 2),
    cyl(0.076, 0.076, 0.012, 8, 0xd8bb8c, -0.150, 0.078, 0, 0, 0, Math.PI / 2),
  ];
  GD.boat = () => [                               // hull, thwart, and a raised prow —
    ball(0.180, 0x8a5a2b, 0, 0.085, 0, 1.15, 0.55, 0.62),   // the prow is what makes the
    box(0.070, 0.026, 0.190, 0xa9743c, 0, 0.140, 0),        // silhouette read as a boat
    cone(0.075, 0.150, 3, 0x9c6733, 0.180, 0.120, 0, 0, 0, -Math.PI / 2 + 0.35),
    box(0.024, 0.100, 0.024, 0xa9743c, -0.130, 0.150, 0),
  ];

  // ---- war ---------------------------------------------------------------
  GD.sword = () => [
    box(0.028, 0.012, 0.230, 0xdfe4ea, 0, 0.055, 0.020),
    cone(0.020, 0.055, 4, 0xdfe4ea, 0, 0.055, 0.162, Math.PI / 2),
    box(0.090, 0.016, 0.020, 0xb0762d, 0, 0.055, -0.085),
    cyl(0.017, 0.017, 0.070, 6, 0x6b4a2a, 0, 0.055, -0.130, Math.PI / 2),
  ];
  GD.shield = () => [
    box(0.190, 0.215, 0.028, 0xb0762d, 0, 0.118, 0),
    cone(0.098, 0.075, 3, 0x9a6323, 0, 0.020, 0, Math.PI),        // pointed foot
    ball(0.048, 0xdfe4ea, 0, 0.130, 0.022, 1.0, 1.0, 0.55),       // the boss
    box(0.190, 0.030, 0.012, 0xdfe4ea, 0, 0.205, 0.018),          // rim band
  ];

  // ---- metals ------------------------------------------------------------
  GD.goldBar = () => [                            // two trapezoid ingots, bank-vault stack
    cyl(0.105, 0.140, 0.085, 4, 0xf2c53d, 0, 0.042, 0, 0, Math.PI / 4, 0),
    cyl(0.078, 0.105, 0.075, 4, 0xffd85e, 0.010, 0.122, 0.010, 0, Math.PI / 4 + 0.20, 0),
  ];
  GD.goldOre = () => [                            // GOLD-dominant nugget with grey matrix:
    ball(0.135, 0xe8bb3c, 0, 0.100, 0, 1.05, 0.92, 1.0),   // grey-with-flecks read as a
    ball(0.075, 0x8a8f96, -0.085, 0.075, 0.055),           // stone at 24 px, so the metal
    ball(0.055, 0x8a8f96, 0.070, 0.155, -0.050),           // is the body and rock the crust
    ball(0.045, 0xffe27a, 0.090, 0.075, 0.055),
  ];
  GD.steel = () => [                              // milled bar stock: three bright billets
    box(0.290, 0.055, 0.085, 0x8d99a7, 0, 0.030, 0),
    box(0.290, 0.055, 0.085, 0xa8b4c1, 0.012, 0.086, 0.012, 0, 0.09, 0),
    box(0.230, 0.050, 0.075, 0xbcc7d2, -0.010, 0.140, -0.008, 0, -0.14, 0),
  ];
  GD.ironOre = () => [                            // rusty lump, darker shoulder, big enough
    ball(0.140, 0xa8703a, 0, 0.100, 0, 1.05, 0.92, 1.05),  // to read as a different thing
    ball(0.072, 0x7d5029, -0.080, 0.145, -0.040),          // from a stone block
    ball(0.055, 0xc08a4d, 0.095, 0.070, 0.055),
  ];
  GD.coal = () => [                               // four black shards, one catching light
    ball(0.105, 0x33333a, -0.060, 0.075, 0.025, 1.0, 0.85, 1.0),
    ball(0.092, 0x26262c, 0.075, 0.068, -0.040),
    ball(0.070, 0x4d4d59, 0.010, 0.150, 0.050),
    ball(0.058, 0x1e1e24, 0.055, 0.052, 0.090),
  ];

  // ---- food --------------------------------------------------------------
  GD.fish = () => [                               // silver body, tail fin, dark eye
    ball(0.100, 0x6fbede, 0, 0.070, 0, 1.75, 0.85, 0.55),
    cone(0.078, 0.120, 3, 0x4fa3c7, -0.180, 0.070, 0, 0, 0, Math.PI / 2, 1, 1, 0.30),
    box(0.070, 0.050, 0.014, 0x9fd8ea, 0.020, 0.112, 0),
    box(0.024, 0.024, 0.016, 0x22303a, 0.128, 0.085, 0.040),
  ];
  GD.bread = () => [                              // a long loaf with three scored slashes:
    ball(0.130, 0xcf9a4e, 0, 0.085, 0, 1.55, 0.85, 0.95),  // the scoring is what stops it
    box(0.040, 0.014, 0.135, 0xf3d79f, 0.085, 0.150, 0, 0, 0, 0),   // reading as a bun
    box(0.040, 0.014, 0.150, 0xf3d79f, 0, 0.158, 0),
    box(0.040, 0.014, 0.135, 0xf3d79f, -0.085, 0.150, 0),
  ];
  GD.meat = () => [                               // a joint on the bone
    ball(0.105, 0xb2503f, 0, 0.085, 0, 1.20, 1.0, 0.95),
    cyl(0.026, 0.026, 0.130, 6, 0xf0e3d0, 0.130, 0.085, 0, 0, 0, Math.PI / 2),
    ball(0.040, 0xf6ece0, 0.190, 0.085, 0),
  ];
  GD.pig = () => [                                // pink barrel, snout, ears, curly tail
    ball(0.105, 0xe8a9ad, 0, 0.105, 0, 1.45, 1.0, 1.0),
    ball(0.062, 0xefb9bd, 0.140, 0.115, 0),
    cyl(0.032, 0.032, 0.030, 6, 0xd18b91, 0.190, 0.105, 0, 0, 0, Math.PI / 2),
    cone(0.030, 0.045, 3, 0xd18b91, 0.125, 0.165, 0.040),
    cone(0.030, 0.045, 3, 0xd18b91, 0.125, 0.165, -0.040),
    box(0.030, 0.028, 0.028, 0xd18b91, -0.140, 0.130, 0, 0, 0, 0.6),
    box(0.028, 0.075, 0.028, 0xe8a9ad, -0.055, 0.038, 0.055),
    box(0.028, 0.075, 0.028, 0xe8a9ad, 0.070, 0.038, -0.055),
  ];
  GD.wheat = () => [                              // a tied sheaf, ears fanning out
    cyl(0.090, 0.052, 0.270, 7, 0xe0c352, 0, 0.135, 0),
    cyl(0.104, 0.104, 0.034, 7, 0xb08a2c, 0, 0.095, 0),
    cone(0.045, 0.110, 4, 0xefdc86, 0.062, 0.275, 0.028, 0, 0, -0.30),
    cone(0.045, 0.110, 4, 0xefdc86, -0.068, 0.285, -0.028, 0, 0, 0.30),
    cone(0.042, 0.100, 4, 0xd8bb45, 0.006, 0.300, 0.062, 0.30),
  ];
  GD.flour = () => [                              // a SACK: wide base, pinched neck, tie —
    ball(0.130, 0xefe6cf, 0, 0.095, 0, 1.10, 1.00, 1.10),  // a plain ball read as a stone
    cyl(0.050, 0.105, 0.090, 7, 0xe7dcc0, 0, 0.205, 0),
    cyl(0.032, 0.032, 0.026, 6, 0xa9967a, 0, 0.252, 0),
    cone(0.052, 0.070, 5, 0xefe6cf, 0, 0.295, 0),
  ];

  // ---- tools (a shared shaft, a distinct head — the silhouette IS the id) --
  GD.shovel = () => tool(0x9c6b3e, [
    box(0.090, 0.014, 0.100, 0xb8c0c8, 0.175, 0.055, 0),
    box(0.045, 0.030, 0.014, 0x7b5330, -0.150, 0.055, 0),
  ]);
  GD.hammer = () => tool(0x8c6239, [
    box(0.060, 0.060, 0.100, 0x6f7883, 0.150, 0.055, 0),
    cone(0.032, 0.070, 4, 0x6f7883, 0.150, 0.055, -0.080, Math.PI / 2),
  ]);
  GD.rod = () => [                                // a fishing rod: springy pole + line
    cyl(0.012, 0.020, 0.300, 6, 0x6fae54, 0, 0.075, 0, 0, 0, Math.PI / 2 - 0.22),
    cyl(0.006, 0.006, 0.110, 4, 0xdfe6ee, 0.150, 0.115, 0),
    ball(0.022, 0xc0392b, 0.150, 0.055, 0),
  ];
  GD.cleaver = () => tool(0x5b3f26, [
    box(0.130, 0.110, 0.014, 0xd7dde3, 0.150, 0.075, 0),
    box(0.130, 0.020, 0.018, 0xf2f6fa, 0.150, 0.022, 0),
  ], 0.22);
  GD.scythe = () => [                             // long snath, big curved blade
    cyl(0.018, 0.018, 0.280, 6, 0xa9b3bd, 0, 0.075, 0, 0, 0, Math.PI / 2 - 0.30),
    box(0.150, 0.013, 0.042, 0xdde3e9, 0.110, 0.140, 0, 0, 0.45, 0.22),
    cone(0.028, 0.060, 3, 0xdde3e9, 0.178, 0.132, 0.032, 0, 0.45, Math.PI / 2),
    box(0.028, 0.022, 0.052, 0x8b6a42, -0.062, 0.046, 0),
  ];
  GD.axe = () => tool(0x8f5a34, [
    box(0.075, 0.115, 0.020, 0x9aa4ae, 0.145, 0.075, 0),
    cone(0.058, 0.055, 3, 0xd9e0e6, 0.192, 0.075, 0, 0, 0, -Math.PI / 2),
  ]);
  GD.saw = () => [                                // a toothed blade with a wooden grip
    box(0.240, 0.075, 0.014, 0xb9bfc6, 0.010, 0.100, 0),
    box(0.240, 0.022, 0.016, 0xe6ebef, 0.010, 0.055, 0),
    box(0.070, 0.055, 0.030, 0x8b5e33, -0.150, 0.100, 0),
  ];
  /* the pick's head crosses the shaft — a bar along Z with a point at each end,
   * kept above y=0 so it never sinks into the ground at a flag */
  GD.pick = () => tool(0x7d5a34, [
    cyl(0.020, 0.020, 0.190, 5, 0x87919b, 0.115, 0.130, 0, Math.PI / 2, 0, 0),
    cone(0.024, 0.055, 4, 0xc4ccd4, 0.115, 0.130, 0.122, Math.PI / 2),
    cone(0.024, 0.055, 4, 0xc4ccd4, 0.115, 0.130, -0.122, -Math.PI / 2),
    cyl(0.014, 0.014, 0.100, 5, 0x7d5a34, 0.115, 0.092, 0),
  ], 0.24);
  GD.pincer = () => [                             // two crossed jaws on a pivot
    box(0.250, 0.034, 0.026, 0x8a939e, 0, 0.075, 0.026, 0, 0.26, 0),
    box(0.250, 0.034, 0.026, 0x707a85, 0, 0.075, -0.026, 0, -0.26, 0),
    cyl(0.026, 0.026, 0.075, 6, 0xa6b0ba, 0.015, 0.075, 0),
    box(0.055, 0.040, 0.090, 0x5c656e, -0.125, 0.075, 0),
  ];

  /** Every good's own little sculpt, cached by id. Falls back to the crate. */
  FSModels.goodGeo = function (res) {
    const b = GD[res];
    if (!b) return FSModels.crateGeo();
    return cached("geo:good:" + res, () => mergeColored(b()));
  };
  FSModels.goodIds = function () { return Object.keys(GD); };
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

  /* ===================================================================== */
  /* ===== THE VILLAGER — the one asset in this game that is not code ===== */
  /* ===================================================================== */
  /*
   * Everything else in Farmstead is primitives and canvas textures. The people
   * are the exception: a sculpted, decimated villager body + two hip-authored
   * legs, generated for this project (assets/farmstead/cast/villager/, see its
   * REPORT.md). He is loaded, not built, which brings three problems the rest
   * of the file never had — and one rule that has to survive all three:
   *
   *   THE PROCEDURAL MINIFIG NEVER GOES AWAY. It is the fallback. A blocked
   *   fetch, a corrupt file, a browser with no fetch at all — the settlement
   *   still fills with people. `cast.ready` is the only switch.
   *
   * (1) LOADING IS ASYNC and the render layer builds its instanced pools
   *     synchronously, every frame. So the geometry builders answer with the
   *     minifig until the GLBs land, then `cast.gen` ticks and fs-render drops
   *     the stale pools (see castGen() there). Nothing blocks on the network.
   * (2) NO GLTFLoader. farmstead.html vendors three and nothing else; the
   *     castle GLB took the loader with it when it was replaced by an original
   *     model. These three files are the narrowest possible glTF — one node,
   *     one mesh, one triangle primitive, tightly packed float attributes — so
   *     a ~90-line reader is a better trade than re-vendoring 40 KB of loader
   *     for features (skins, cameras, KHR extensions, Draco) nothing here uses.
   * (3) COLOUR SPACE. See castColor().
   */
  const CAST_DIR = "assets/farmstead/cast/villager/";
  /**
   * USER PREFERENCE 2026-08-01, after seeing the sculpt in game: the ORIGINAL
   * PROCEDURAL MINIFIG IS THE SHIPPING LOOK. The generated villager stays —
   * every line of the loader, the dye pass and the per-body hip/carry tables
   * below is live code — but it is OPT-IN now, and nothing is fetched at boot
   * unless it is asked for:
   *   FSModels.setCast({on:true})   (QA / in-page)
   *   localStorage fs_cast = "1"    (per device, survives reloads)
   *   ?cast=1                       (per link, also writes the localStorage flag)
   *
   * FORK B (2026-08-01) PUT A LAYER ABOVE ALL OF THIS. Serfs and knights
   * normally render from BAKED SPRITE SHEETS (see fs-render.js's `SPR` block),
   * baked from the minifig below. The precedence is:
   *
   *     sprites (default)  >  cast opt-in (?cast=1)  >  procedural minifig
   *
   * so everything in this file is now the FALLBACK path — the one that carries
   * the settlement when the sheets do not arrive — and the cast opt-in only
   * chooses which body that fallback wears. Opting in to the villager while the
   * sheets are loading changes nothing on screen; add ?sprites=0 to see him.
   */
  const cast = {
    on: false,           // true = the generated villager; false = the minifig
    ready: false,        // all three GLBs parsed
    gen: 0,              // ticks whenever the answer to serfGeo() changes
    body: null, legL: null, legR: null,
    err: null,
    detail: "lo",        // which cut of the sculpt to load — see CAST_DETAIL
    /* the deterministic colour treatment applied to the baked vertex colours */
    srgb: false,         // convertLinearToSRGB the stored values?  (see castColor)
    sat: 1.18, val: 1.0, // pull the generated palette onto the world's own
  };
  FSModels.cast = cast;

  /* --------------------------------------------------------------- glTF/GLB */
  const GLB_TYPE_N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const GLB_CTOR = {
    5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
    5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array,
  };
  /**
   * Minimal GLB → THREE.BufferGeometry. Deliberately strict: it reads the first
   * mesh's first triangle primitive and throws on anything it does not
   * understand, because a silent half-parse would put a broken villager on
   * screen where the fallback would have put a working minifig.
   */
  function parseGLB(buffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a glb");
    if (dv.getUint32(4, true) !== 2) throw new Error("glb version");
    const total = Math.min(dv.getUint32(8, true), buffer.byteLength);
    let off = 12, json = null, binOff = -1, binLen = 0;
    while (off + 8 <= total) {
      const cl = dv.getUint32(off, true), ct = dv.getUint32(off + 4, true), start = off + 8;
      if (ct === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, cl)));
      else if (ct === 0x004e4942) { binOff = start; binLen = cl; }
      off = start + cl + ((4 - (cl % 4)) % 4);
    }
    if (!json || binOff < 0) throw new Error("glb chunks");
    const prim = json.meshes && json.meshes[0] && json.meshes[0].primitives && json.meshes[0].primitives[0];
    if (!prim) throw new Error("no primitive");
    if (prim.mode !== undefined && prim.mode !== 4) throw new Error("not triangles");

    function read(i) {
      const a = json.accessors[i];
      if (a.sparse) throw new Error("sparse accessor");
      const n = GLB_TYPE_N[a.type], Ctor = GLB_CTOR[a.componentType];
      if (!n || !Ctor) throw new Error("accessor type");
      const bv = json.bufferViews[a.bufferView];
      const base = binOff + (bv.byteOffset || 0) + (a.byteOffset || 0);
      const bpe = Ctor.BYTES_PER_ELEMENT;
      const stride = bv.byteStride || 0;
      const out = new Ctor(a.count * n);
      if (!stride || stride === n * bpe) {
        // tight — slice so the copy is always correctly aligned for the view
        out.set(new Ctor(buffer.slice(base, base + a.count * n * bpe)));
      } else {
        for (let k = 0; k < a.count; k++) {
          const row = new Ctor(buffer.slice(base + k * stride, base + k * stride + n * bpe));
          for (let c = 0; c < n; c++) out[k * n + c] = row[c];
        }
      }
      return { arr: out, n: n, normalized: !!a.normalized, count: a.count, bytes: bpe };
    }

    const A = prim.attributes;
    if (A.POSITION === undefined) throw new Error("no POSITION");
    const P = read(A.POSITION);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P.arr), 3));
    if (A.NORMAL !== undefined) g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(read(A.NORMAL).arr), 3));
    if (A.COLOR_0 !== undefined) {
      const C = read(A.COLOR_0);
      const div = C.normalized ? (C.bytes === 1 ? 255 : 65535) : 1;
      const col = new Float32Array(C.count * 3);
      for (let k = 0; k < C.count; k++) {
        col[k * 3] = C.arr[k * C.n] / div;
        col[k * 3 + 1] = C.arr[k * C.n + 1] / div;
        col[k * 3 + 2] = C.arr[k * C.n + 2] / div;
      }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    }
    if (prim.indices !== undefined) {
      const I = read(prim.indices);
      g.setIndex(new THREE.BufferAttribute(I.bytes > 2 ? new Uint32Array(I.arr) : new Uint16Array(I.arr), 1));
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    // the node transform, if the exporter left one on (these three have none)
    const node = json.nodes && json.nodes[0];
    if (node && (node.matrix || node.translation || node.rotation || node.scale)) {
      const m = new THREE.Matrix4();
      if (node.matrix) m.fromArray(node.matrix);
      else {
        m.compose(
          new THREE.Vector3().fromArray(node.translation || [0, 0, 0]),
          new THREE.Quaternion().fromArray(node.rotation || [0, 0, 0, 1]),
          new THREE.Vector3().fromArray(node.scale || [1, 1, 1])
        );
      }
      g.applyMatrix4(m);
    }
    return g;
  }
  FSModels.parseGLB = parseGLB;

  /**
   * COLOUR SPACE — the trap this asset sets, and the measurement that sprang it.
   *
   * glTF says COLOR_0 is LINEAR, and this repo has been bitten before by
   * downloaded models whose linear colours render dark ([[gltf-linear-color-
   * gotcha]]), so the obvious move is convertLinearToSRGB on load. That would be
   * wrong here, and only a measurement says so: the baker sampled the villager's
   * own 512px baseColor texture, whose mean texel is rgb8(155,108,74); the mean
   * stored COLOR_0 is (0.690,0.486,0.333) = rgb8(176,124,85). The stored values
   * ARE the texture's sRGB texels, near enough. Converting them AS IF linear
   * yields rgb8(216,185,156) — a milky beige, with the "dark boots" reading as
   * light tan. And the renderer has no outputEncoding set (r128 default Linear),
   * so every hand-authored hex in fs-const reaches the screen unconverted too:
   * raw is exactly the space the rest of the world is painted in.
   *
   * What the colours DO need is a nudge in saturation — a photogrammetry-ish
   * bake is flatter than the deliberately punchy flat-Lambert palette around it.
   * Chroma is scaled about the pixel's own luma, which lifts the tunic and the
   * boots without touching the greys or clipping the highlights.
   */
  function castColor(col) {
    const a = col.array;
    const sat = cast.sat, val = cast.val;
    for (let i = 0; i < a.length; i += 3) {
      let r = a[i], g = a[i + 1], b = a[i + 2];
      if (cast.srgb) {
        r = r <= 0.0031308 ? r * 12.92 : 1.055 * Math.pow(r, 1 / 2.4) - 0.055;
        g = g <= 0.0031308 ? g * 12.92 : 1.055 * Math.pow(g, 1 / 2.4) - 0.055;
        b = b <= 0.0031308 ? b * 12.92 : 1.055 * Math.pow(b, 1 / 2.4) - 0.055;
      }
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = (l + (r - l) * sat) * val;
      g = (l + (g - l) * sat) * val;
      b = (l + (b - l) * sat) * val;
      a[i] = r < 0 ? 0 : r > 1 ? 1 : r;
      a[i + 1] = g < 0 ? 0 : g > 1 ? 1 : g;
      a[i + 2] = b < 0 ? 0 : b > 1 ? 1 : b;
    }
    col.needsUpdate = true;
  }

  function fetchGeo(file) {
    return fetch(CAST_DIR + file)
      .then((r) => { if (!r.ok) throw new Error(file + " " + r.status); return r.arrayBuffer(); })
      .then((buf) => {
        const g = parseGLB(buf);
        if (!g.attributes.color) throw new Error(file + ": no COLOR_0");
        castColor(g.attributes.color);
        return g;
      });
  }

  /**
   * WHICH CUT OF THE SCULPT TO SHIP.
   *
   * The generated villager is 6000 triangles + 800 a leg. Measured on a large
   * developed town (76 serfs, software rasteriser, both passes in one process)
   * that is 260k triangles → 675k and 92 ms → 168 ms a frame: +58%, against a
   * +30% budget. The reason is not that 6000 is a big number, it is that it is
   * the wrong number for the SCREEN SIZE: a 0.79-unit villager at the camera's
   * usual 26-40 units covers a few hundred pixels, so a 6000-triangle body is
   * running a dozen triangles per pixel. Sub-pixel triangles cost real money on
   * a GPU too (every one shades a 2x2 quad), so this is not a headless artefact.
   *
   * So the shipped cut is a 3-step collapse to 1498 / 271 / 270 (tools/
   * _villager_lod.py, re-run any time from the vc GLBs, colours ride along
   * through the CORNER-domain attribute). At the closest the camera can legally
   * get — CAM.DIST_MIN, 8 units — it is not distinguishable from the full cut;
   * the difference only appears at inspection distances no player reaches.
   * The full-resolution GLBs still ship for `detail:"hi"` (the A/B, and a
   * portrait/close-up mode if one is ever wanted).
   */
  const CAST_DETAIL = { hi: "", lo: "-lo" };

  /** Kick the three fetches off. Resolves true if the villager is usable. */
  FSModels.loadCast = function () {
    if (FSModels.castLoaded) return FSModels.castLoaded;
    if (typeof fetch !== "function") {
      cast.err = "no fetch";
      return (FSModels.castLoaded = Promise.resolve(false));
    }
    const sfx = CAST_DETAIL[cast.detail] === undefined ? "" : CAST_DETAIL[cast.detail];
    FSModels.castLoaded = Promise.all([
      fetchGeo("villager-body" + sfx + "-vc.glb"),
      fetchGeo("villager-legL" + sfx + "-vc.glb"),
      fetchGeo("villager-legR" + sfx + "-vc.glb"),
    ]).then((g) => {
      cast.body = g[0]; cast.legL = g[1]; cast.legR = g[2];
      cast.ready = true;
      castFlush();                     // whatever was built as a minifig, rebuild
      return true;
    }).catch((e) => {
      cast.err = String((e && e.message) || e);
      cast.ready = false;
      return false;                    // the minifig carries on, silently
    });
    return FSModels.castLoaded;
  };

  /**
   * Debug/QA switch: force the fallback, or retune the colour treatment, and
   * invalidate every cached body so the change is visible on the next frame.
   * Never called by the game itself.
   */
  FSModels.setCast = function (o) {
    o = o || {};
    if (o.on !== undefined) cast.on = !!o.on;
    // switched OFF: no fetch, no rebuild cost — just answer minifig from now on
    if (!cast.on && !FSModels.castLoaded) { castFlush(); return cast; }
    if (o.sat !== undefined) cast.sat = o.sat;
    if (o.val !== undefined) cast.val = o.val;
    if (o.srgb !== undefined) cast.srgb = !!o.srgb;
    if (o.detail !== undefined && o.detail !== cast.detail) { cast.detail = o.detail; cast.ready = false; FSModels.castLoaded = null; }
    if ((o.sat !== undefined || o.val !== undefined || o.srgb !== undefined) && cast.ready) {
      // re-derive the colours from the file rather than compounding transforms
      cast.ready = false;
      FSModels.castLoaded = null;
    }
    if (!FSModels.castLoaded) FSModels.loadCast();
    castFlush();
    return cast;
  };
  /** true when the people on screen are the generated villager, not the minifig */
  FSModels.castOn = function () { return cast.ready && cast.on; };
  /** ticks whenever serfGeo/knightGeo would answer differently (fs-render polls it) */
  FSModels.castGen = function () { return cast.gen; };

  /* Bodies are cached like everything else, but they have to be droppable when
   * the villager arrives (or is switched off). Retired geometry is disposed one
   * generation late, so a pool that has not yet noticed can still draw it. */
  const castKeys = [];
  let castRetired = [];
  function castCached(key, make) {
    if (CACHE[key]) return CACHE[key];
    const g = make();
    CACHE[key] = g;
    castKeys.push(key);
    return g;
  }
  function castFlush() {
    for (let i = 0; i < castRetired.length; i++) castRetired[i].dispose();
    castRetired = [];
    for (let i = 0; i < castKeys.length; i++) {
      const g = CACHE[castKeys[i]];
      if (g) castRetired.push(g);
      delete CACHE[castKeys[i]];
    }
    castKeys.length = 0;
    cast.gen++;
  }

  /**
   * GARMENTS ARE DYED INTO THE BODY, NOT BUILT ON TOP OF IT.
   *
   * Two wrong answers came before this one, and both are worth keeping written
   * down because both looked right.
   *
   * The FIRST was primitives at measured coordinates — a cylinder sash, a
   * sphere cap, a cylinder surcoat. Every one failed in a way no measurement
   * predicted: the cap let the skull poke through its crown, the surcoat
   * vanished inside a chest no cylinder fits, the belt read as a wire. This
   * body is a sculpt. It has no radius.
   *
   * The SECOND was a SHELL — the body's own triangles between two heights,
   * pushed out along their normals. That fits by construction and cannot be
   * poked through, and it still tore: an offset surface self-intersects where
   * curvature is high, so bare skin came back through the surcoat exactly at
   * the shoulder roll. It also cost 3000 triangles for one knight's coat, on
   * top of a 6000-triangle body, in a game that draws a hundred of these.
   *
   * The right answer is that a garment is a COLOUR. Re-dye the body's own
   * vertices between two heights and the fit is exact, the cost is zero
   * triangles, and there is no second surface to intersect anything. The
   * boundary lands on triangle edges — a slightly irregular hem, which is
   * what a hem looks like. The dye is modulated by the pixel's original
   * brightness so the sculpt's own creases and shading survive underneath it
   * instead of being flattened into a decal.
   *
   * bands: [{y0, y1, color, maxAbsX?, minZ?}] — maxAbsX drops the sleeves, so
   * a belt can be worn UNDER the arms rather than painted across them.
   */
  function castPaint(src, bands) {
    const P = src.attributes.position.array;
    const C = src.attributes.color.array;
    const N = src.attributes.normal.array;
    const idx = src.index.array;
    const nV = P.length / 3, nT = idx.length / 3;
    const inBand = (bd, i) => {
      const y = P[i * 3 + 1];
      if (y < bd.y0 || y > bd.y1) return false;
      if (bd.maxAbsX !== undefined && Math.abs(P[i * 3]) > bd.maxAbsX) return false;
      if (bd.minZ !== undefined && P[i * 3 + 2] < bd.minZ) return false;
      return true;
    };
    /* Dye is decided PER TRIANGLE, off its centre — painting per vertex melts
     * the hem into a two-triangle-wide gradient and the garment reads as a
     * stain rather than a garment. Per triangle the boundary lands on real
     * edges, which is the faceted look everything else in this world has. */
    const triBand = new Int16Array(nT).fill(-1);
    for (let t = 0; t < nT; t++) {
      const a = idx[t * 3], b = idx[t * 3 + 1], c2 = idx[t * 3 + 2];
      const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[c2 * 3 + 1]) / 3;
      for (let k = 0; k < bands.length; k++) {
        const bd = bands[k];
        if (cy < bd.y0 || cy > bd.y1) continue;
        if (!inBand(bd, a) || !inBand(bd, b) || !inBand(bd, c2)) continue;
        triBand[t] = k; break;
      }
    }
    /* A vertex whose triangles all agree can simply be re-dyed in place; only
     * the ones ON the seam need a copy per colour that meets there. */
    const vBand = new Int16Array(nV).fill(-2);
    let mixed = 0;
    for (let t = 0; t < nT; t++) {
      for (let j = 0; j < 3; j++) {
        const v = idx[t * 3 + j];
        if (vBand[v] === -2) vBand[v] = triBand[t];
        else if (vBand[v] !== triBand[t] && vBand[v] !== -3) { vBand[v] = -3; mixed++; }
      }
    }
    const col = new Float32Array(C);
    const tc = new THREE.Color();
    const dye = (dst, di, si, k) => {
      const lum = 0.299 * C[si * 3] + 0.587 * C[si * 3 + 1] + 0.114 * C[si * 3 + 2];
      let m = 0.94 + 0.30 * (lum - 0.55);
      if (m < 0.86) m = 0.86; else if (m > 1.06) m = 1.06;
      tc.set(bands[k].color);
      dst[di * 3] = Math.min(1, tc.r * m);
      dst[di * 3 + 1] = Math.min(1, tc.g * m);
      dst[di * 3 + 2] = Math.min(1, tc.b * m);
    };
    for (let v = 0; v < nV; v++) if (vBand[v] >= 0) dye(col, v, v, vBand[v]);
    if (!mixed) {
      const g0 = new THREE.BufferGeometry();
      g0.setAttribute("position", src.attributes.position);
      g0.setAttribute("normal", src.attributes.normal);
      g0.setAttribute("color", new THREE.BufferAttribute(col, 3));
      g0.setIndex(src.index);
      return g0;
    }
    const pos = Array.prototype.slice.call(P), nor = Array.prototype.slice.call(N);
    const cc = Array.prototype.slice.call(col);
    const ind = new Array(idx.length);
    const dup = new Map();
    for (let t = 0; t < nT; t++) {
      for (let j = 0; j < 3; j++) {
        const v = idx[t * 3 + j];
        if (vBand[v] !== -3) { ind[t * 3 + j] = v; continue; }
        const key = v * 32 + (triBand[t] + 2);
        let ni = dup.get(key);
        if (ni === undefined) {
          ni = pos.length / 3;
          pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          nor.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          if (triBand[t] >= 0) { const tmp = new Float32Array(3); dye(tmp, 0, v, triBand[t]); cc.push(tmp[0], tmp[1], tmp[2]); }
          else cc.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
          dup.set(key, ni);
        }
        ind[t * 3 + j] = ni;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(cc), 3));
    g.setIndex(new THREE.BufferAttribute(pos.length / 3 > 65535 ? new Uint32Array(ind) : new Uint16Array(ind), 1));
    return g;
  }
  FSModels.castPaint = castPaint;

  /* ---------------------------------------------------- villager proportions
   * All measured off the shipped GLBs (feet at y=0, +z = the way he faces), not
   * guessed: the minifig's anchors are 2-3x too narrow for this body and using
   * them puts the sash inside his chest and the axe through his hip.
   *   height 0.791 · hips (±0.1235, 0.255, 0.028) · hand (±0.235, 0.130, 0.00)
   *   shoulder half-width 0.28 at y 0.55 · head ball r 0.105 centred
   *   (0, 0.700, 0.070) · top of skull 0.791 · back of tunic z −0.19
   * The waist at y 0.30 is the one place a closed band can pass BETWEEN the
   * tunic and the arms, which is why the team colour is a belt-and-baldric
   * there rather than the minifig's chest ring. */
  const V = {
    HAND_X: 0.235, HAND_Y: 0.132, HAND_Z: 0.012,
    HEAD_Y: 0.700, HEAD_Z: 0.070, HEAD_R: 0.105, TOP_Y: 0.791,
    WAIST_Y: 0.315, BACK_Z: -0.190,
    /* Garment bands, in body y — see castPaint. Sized for the SHIPPED cut: on
     * 1498 triangles a triangle spans ~0.03 of the body, so a band under about
     * 0.10 tall starts losing whole rows of triangles whose centres miss it and
     * the garment goes threadbare. Generous bands read the same on both cuts. */
    BELT: [0.276, 0.352], YOKE: [0.468, 0.600], CAP: [0.688, 0.800],
    SURCOAT: [0.286, 0.600], HELM: [0.632, 0.800], GREAVE: [-0.26, -0.085],
  };
  FSModels.VILLAGER = V;

  /**
   * A serf built on the villager: the generated body with his baked colours,
   * plus the four things that carry gameplay information and therefore have to
   * stay procedural — the team belt+baldric, the profession cap, the carrier's
   * pack and the tool of the trade.
   */
  function villagerSerfGeo(job, playerIdx) {
    const team = FSModels.playerColor(playerIdx);
    const hat = FSC.JOB_COLOR[job] || FSC.JOB_COLOR.generic;
    /* TEAM, three ways, because the camera can be anywhere between 35° and 70°:
     * a YOKE over the shoulders (the read from directly above, which is how the
     * game is mostly played), a BELT at the waist — the one height where a band
     * can pass UNDER the hanging sleeves instead of across them — and a baldric
     * down the chest joining the two (the read at eye level).
     * JOB is the cap: dyed skull plus a narrow brim, so it can neither float
     * off the head nor be poked through by it. */
    const parts = [{
      geo: castPaint(cast.body, [
        { y0: V.YOKE[0], y1: V.YOKE[1], color: team },
        { y0: V.BELT[0], y1: V.BELT[1], color: team, maxAbsX: 0.19 },
        { y0: V.CAP[0], y1: V.CAP[1], color: hat },
      ]),
      keepColor: true,
    }];
    parts.push({ geo: new THREE.BoxGeometry(0.072, 0.235, 0.055), color: team, matrix: M(0.058, 0.415, 0.163, -0.34, 0, 0.30) });
    parts.push({ geo: new THREE.BoxGeometry(0.055, 0.055, 0.035), color: 0xd8b25a, matrix: M(0, V.WAIST_Y - 0.005, 0.152) });
    parts.push({ geo: new THREE.CylinderGeometry(0.118, 0.118, 0.022, 10), color: hat, matrix: M(0, V.CAP[0] + 0.012, V.HEAD_Z) });
    if (job === FSC.JOB.KNIGHT) parts.push({ geo: new THREE.ConeGeometry(0.085, 0.11, 7), color: hat, matrix: M(0, V.TOP_Y + 0.055, V.HEAD_Z) });
    /* CARRIER. A pack riding high on the shoulder blades. */
    if (job === FSC.JOB.TRANSPORTER || job === FSC.JOB.GENERIC || job === FSC.JOB.SAILOR) {
      parts.push({ geo: new THREE.BoxGeometry(0.22, 0.19, 0.115), color: 0x9b7746, matrix: M(0, 0.470, V.BACK_Z - 0.035, 0.13, 0, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.228, 0.045, 0.125), color: 0x6b5137, matrix: M(0, 0.548, V.BACK_Z - 0.023, 0.13, 0, 0) });
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.BoxGeometry(0.036, 0.15, 0.03), color: 0x6b5137, matrix: M(s * 0.115, 0.545, -0.055, 0.55, 0, 0) });
      }
    }
    /* TOOL. Same shared kit as the minifig, same 0.60 prop scale — but the hand
     * is now twice as far out, lower, and set forward of the sleeve, so the
     * shaft has to clear the arm instead of growing out of it. */
    const tools = FSC.JOB_TOOLS[job] || [];
    if (tools.length) {
      const n0 = parts.length;
      toolParts(parts, tools[0], 0, 0, 0);
      const fit = new THREE.Matrix4().makeTranslation(V.HAND_X + 0.040, V.HAND_Y + 0.150, V.HAND_Z + 0.085)
        .multiply(new THREE.Matrix4().makeScale(0.60, 0.60, 0.60));
      for (let i = n0; i < parts.length; i++) {
        parts[i].matrix = fit.clone().multiply(parts[i].matrix || new THREE.Matrix4());
      }
    }
    return mergeIndexed(parts);
  }

  /**
   * A knight on the same body — because a settlement whose workers are sculpted
   * and whose soldiers are a stack of boxes has two art styles in one frame.
   * Mail, surcoat, pauldrons, kettle helm, sword and shield are still
   * procedural: rank has to read off the shield rim and the plume
   * (FSC.RANK_COLOR), and no generated mesh can carry that.
   */
  function villagerKnightGeo(rank, playerIdx) {
    const r = Math.max(0, Math.min(FSC.KNIGHT_RANKS - 1, rank | 0));
    const team = FSModels.playerColor(playerIdx);
    const trim = FSC.RANK_COLOR[r] || FSC.RANK_COLOR[0];
    const steel = 0xb9bfc6;
    /* SURCOAT — the whole torso, waist to shoulder, in the player's colour: it
     * is what makes him read as a soldier rather than a peasant who happens to
     * be carrying a sword. HELM — the skull in steel, so the head can never
     * poke through it. Both dyed, so a knight costs a serf's triangles. */
    const parts = [{
      geo: castPaint(cast.body, [
        { y0: V.SURCOAT[0], y1: V.SURCOAT[1], color: team },
        { y0: V.BELT[0], y1: V.BELT[1], color: 0x5d4a30, maxAbsX: 0.19 },
        // a mail coif bridges surcoat to helm; without it the bare shoulder
        // between them reads as a hole torn in his armour
        { y0: V.SURCOAT[1], y1: V.HELM[0], color: 0x8f959d },
        { y0: V.HELM[0], y1: V.HELM[1], color: steel },
      ]),
      keepColor: true,
    }];
    parts.push({ geo: new THREE.CylinderGeometry(0.158, 0.158, 0.028, 10), color: 0xa9b0b8, matrix: M(0, V.HELM[0] + 0.030, V.HEAD_Z) });
    parts.push({ geo: new THREE.BoxGeometry(0.030, 0.075, 0.026), color: 0xa9b0b8, matrix: M(0, V.HELM[0] + 0.055, V.HEAD_Z + 0.115) });
    parts.push({ geo: new THREE.BoxGeometry(0.046, 0.062, 0.165), color: trim, matrix: M(0, V.TOP_Y + 0.010, V.HEAD_Z - 0.048, 0.42, 0, 0) });
    // sword drawn in the right fist
    parts.push({ geo: new THREE.BoxGeometry(0.050, 0.44, 0.028), color: 0xd8dde3, matrix: M(V.HAND_X + 0.045, V.HAND_Y + 0.295, V.HAND_Z + 0.095) });
    parts.push({ geo: new THREE.BoxGeometry(0.16, 0.040, 0.048), color: trim, matrix: M(V.HAND_X + 0.045, V.HAND_Y + 0.075, V.HAND_Z + 0.095) });
    parts.push({ geo: new THREE.BoxGeometry(0.040, 0.085, 0.040), color: 0x6b5137, matrix: M(V.HAND_X + 0.045, V.HAND_Y + 0.022, V.HAND_Z + 0.095) });
    // shield on the left arm — the RIM is the rank, and it is the cue the
    // player actually reads, so it is wide, flat-on and unobstructed
    parts.push({ geo: new THREE.CylinderGeometry(0.170, 0.170, 0.038, 9), color: team, matrix: M(-V.HAND_X - 0.045, V.HAND_Y + 0.150, V.HAND_Z + 0.150, Math.PI / 2, 0, 0) });
    parts.push({ geo: new THREE.TorusGeometry(0.170, 0.032, 3, 9), color: trim, matrix: M(-V.HAND_X - 0.045, V.HAND_Y + 0.150, V.HAND_Z + 0.160) });
    parts.push({ geo: new THREE.SphereGeometry(0.050, 5, 3), color: 0xd8dde3, matrix: M(-V.HAND_X - 0.045, V.HAND_Y + 0.150, V.HAND_Z + 0.175) });
    // rank pips on the surcoat, the third reading of the same fact
    for (let i = 0; i < r; i++) {
      parts.push({ geo: new THREE.BoxGeometry(0.038, 0.038, 0.03), color: trim, matrix: M(-0.052 + i * 0.045, 0.505, 0.185) });
    }
    return mergeIndexed(parts);
  }

  /* The legs are the villager's own, hip-authored, so the renderer swings them
   * exactly as it swung the minifig's boots. `greave` armours them for a knight
   * without a second sculpt. */
  function villagerLegGeo(side, greave) {
    const leg = side < 0 ? cast.legR : cast.legL;
    // the greave is his own shin and boot re-dyed in steel — same trick as the helm
    const geo = greave ? castPaint(leg, [{ y0: V.GREAVE[0], y1: V.GREAVE[1], color: 0xb9bfc6 }]) : leg;
    return mergeIndexed([{ geo: geo, keepColor: true }]);
  }

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
    const key = "geo:serf:" + cast.gen + ":" + job + ":" + playerIdx;
    return castCached(key, () => (FSModels.castOn() ? villagerSerfGeo(job, playerIdx) : minifigSerfGeo(job, playerIdx)));
  };
  function minifigSerfGeo(job, playerIdx) {
    {
      const team = FSModels.playerColor(playerIdx);
      const hat = FSC.JOB_COLOR[job] || FSC.JOB_COLOR.generic;
      const skin = COL.SERF_SKIN, cloth = COL.SERF_CLOTH;
      const hair = 0x6a4a2c;
      const parts = [];
      /* ===== PHASE P: the legs have MOVED OUT of the body mesh into
       * FSModels.serfLegGeo() so the renderer can actually walk them. The
       * body is still one merged, cached geometry per (job, player) and the
       * legs are one shared geometry for the whole workforce — the split
       * costs exactly one extra draw call in total, not one per serf. =====
       *
       * VILLAGER REBUILD (playtest: "the villagers are blocky and look like
       * robots"). The old body was 18 stacked BoxGeometries — square shoulders,
       * slab head, straight plank arms. It is now ROUND stock: a tunic that
       * flares over the hips, sloped shoulders, a ball head at a friendly
       * (slightly oversized) ratio, mitten hands. Everything is deliberately
       * low-segment so it still faceted-shades like the rest of the world and
       * stays inside the ~400-triangle minifig budget. The hip pivot (the
       * minifig branch of FSModels.hipOf) and the overall silhouette height are
       * UNCHANGED, so the walk cycle, carry poses and tool anchors all still
       * line up. */
      // tunic: a tapered barrel that flares at the hem, plus a darker hem band
      parts.push({ geo: new THREE.CylinderGeometry(0.135, 0.175, 0.27, 6), color: cloth, matrix: M(0, 0.385, 0) });
      parts.push({ geo: new THREE.CylinderGeometry(0.178, 0.172, 0.045, 6), color: 0x6b5137, matrix: M(0, 0.262, 0) });
      // rounded shoulders cap the barrel so the arms don't meet it at a corner
      parts.push({ geo: new THREE.SphereGeometry(0.132, 6, 3), color: cloth, matrix: M(0, 0.505, 0, 0, 0, 0, 1, 0.55, 0.86) });
      // the player's sash across the chest + a little brass buckle at the belt
      // the player's sash is a real BAND wrapped round the tunic (an open-ended
      // shell, 14 tris) — a box only ever showed its corners through the barrel
      parts.push({ geo: new THREE.CylinderGeometry(0.158, 0.158, 0.062, 7, 1, true), color: team, matrix: M(0, 0.412, 0, 0, 0, 0.34) });
      parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.03), color: 0xd8b25a, matrix: M(0, 0.262, 0.105) });
      // arms: a tapered sleeve that hangs with a slight outward swing, mitten hand
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.CylinderGeometry(0.043, 0.034, 0.20, 4), color: cloth, matrix: M(s * 0.163, 0.40, 0.01, 0, 0, s * 0.12) });
        parts.push({ geo: new THREE.SphereGeometry(0.042, 4, 3), color: skin, matrix: M(s * 0.187, 0.293, 0.018) });
      }
      // neck, ball head, a soft cap of hair, and a friendly face
      parts.push({ geo: new THREE.CylinderGeometry(0.045, 0.052, 0.062, 4), color: skin, matrix: M(0, 0.558, 0) });
      parts.push({ geo: new THREE.SphereGeometry(0.112, 7, 4), color: skin, matrix: M(0, 0.682, 0, 0, 0, 0, 1, 0.97, 0.95) });
      parts.push({ geo: new THREE.SphereGeometry(0.115, 6, 3), color: hair, matrix: M(0, 0.716, -0.008, 0.10, 0, 0, 1, 0.60, 1) });
      parts.push({ geo: new THREE.BoxGeometry(0.032, 0.026, 0.024), color: skin, matrix: M(0, 0.661, 0.098) });
      for (let s = -1; s <= 1; s += 2) {
        parts.push({ geo: new THREE.BoxGeometry(0.023, 0.027, 0.018), color: 0x3a2c1e, matrix: M(s * 0.037, 0.686, 0.090) });
      }
      // profession cap: a soft crown and a brim in the job colour
      parts.push({ geo: new THREE.SphereGeometry(0.104, 6, 3), color: hat, matrix: M(0, 0.772, 0, 0, 0, 0, 1, 0.80, 1) });
      parts.push({ geo: new THREE.CylinderGeometry(0.150, 0.150, 0.026, 7), color: hat, matrix: M(0, 0.760, 0.012) });
      if (job === FSC.JOB.KNIGHT) parts.push({ geo: new THREE.ConeGeometry(0.108, 0.13, 7), color: hat, matrix: M(0, 0.882, 0) });
      // a carrier's pack; everyone else gets the tool of the trade
      if (job === FSC.JOB.TRANSPORTER || job === FSC.JOB.GENERIC || job === FSC.JOB.SAILOR) {
        parts.push({ geo: new THREE.BoxGeometry(0.20, 0.19, 0.12), color: 0xb08a56, matrix: M(0, 0.40, -0.155) });
        parts.push({ geo: new THREE.BoxGeometry(0.21, 0.045, 0.13), color: 0x6b5137, matrix: M(0, 0.46, -0.155) });
        for (let s = -1; s <= 1; s += 2) {
          parts.push({ geo: new THREE.BoxGeometry(0.035, 0.20, 0.03), color: 0x6b5137, matrix: M(s * 0.075, 0.42, -0.10, 0.15, 0, 0) });
        }
      }
      const tools = FSC.JOB_TOOLS[job] || [];
      if (tools.length) {
        // the shared tool kit is authored at full "prop" size, which on a
        // 0.8-unit villager reads as a comically huge axe — build it at the
        // origin and scale it down into his hand
        const n0 = parts.length;
        toolParts(parts, tools[0], 0, 0, 0);
        const fit = new THREE.Matrix4().makeTranslation(0.232, 0.335, 0.055)
          .multiply(new THREE.Matrix4().makeScale(0.60, 0.60, 0.60));
        for (let i = n0; i < parts.length; i++) {
          parts[i].matrix = fit.clone().multiply(parts[i].matrix || new THREE.Matrix4());
        }
      }
      return mergeColored(parts);
    }
  }

  /**
   * PHASE P — ONE serf leg, authored around its HIP so the renderer can swing
   * it: the origin is the hip joint, the boot hangs below at -y, the turned-up
   * toe points at +z (the serf's forward).
   *
   * VILLAGER: left and right are now DIFFERENT meshes (they were sculpted, not
   * mirrored), so the pair is asked for by side and the renderer keeps a pool
   * each — one extra draw call for the whole workforce. The minifig's single
   * symmetric boot answers both sides, exactly as before, when the villager is
   * not available.
   */
  FSModels.serfLegGeo = function (side) {
    const key = "geo:serfleg:" + cast.gen + ":" + (FSModels.castOn() ? (side < 0 ? "R" : "L") : "x");
    return castCached(key, () => (FSModels.castOn() ? villagerLegGeo(side, false) : mergeColored([
      // the breeches run a little ABOVE the hip joint so a full stride can
      // never open a gap between leg and smock
      { geo: new THREE.BoxGeometry(0.105, 0.20, 0.105), color: 0x6b5a40, matrix: M(0, -0.075, 0) },
      { geo: new THREE.BoxGeometry(0.115, 0.08, 0.15), color: 0x4a3c2a, matrix: M(0, -0.21, 0.022) },
    ])));
  };
  /** …and the armoured version, with the greave that used to sit on the knight. */
  FSModels.knightLegGeo = function (side) {
    const key = "geo:knightleg:" + cast.gen + ":" + (FSModels.castOn() ? (side < 0 ? "R" : "L") : "x");
    return castCached(key, () => (FSModels.castOn() ? villagerLegGeo(side, true) : mergeColored([
      { geo: new THREE.BoxGeometry(0.105, 0.21, 0.105), color: 0x4a3f30, matrix: M(0, -0.07, 0) },
      { geo: new THREE.BoxGeometry(0.115, 0.075, 0.15), color: 0x36301f, matrix: M(0, -0.215, 0.022) },
      { geo: new THREE.BoxGeometry(0.12, 0.07, 0.12), color: 0xb9bfc6, matrix: M(0, -0.055, 0) },
    ])));
  };
  /** where the legs hang from, and how far they may swing, for the body in use */
  FSModels.hipOf = function () {
    return FSModels.castOn()
      ? { x: 0.1235, y: 0.255, z: 0.028, swing: 0.34, drop: 0.085 }
      : { x: 0.075, y: 0.255, z: 0, swing: 0.52, drop: 0 };
  };
  FSModels.knightHipOf = function () {
    const h = FSModels.hipOf();
    return FSModels.castOn() ? h : { x: 0.078, y: 0.255, z: 0, swing: 0.52, drop: 0 };
  };
  /**
   * Where a carried crate rides — a property of the BODY, like the hips.
   *
   * The minifig's cap crowns at 0.855, so 0.86 sets the load on his head,
   * which is what the game has always looked like. The villager is a shorter
   * sculpt (VILLAGER.TOP_Y 0.791) and inheriting the minifig number left every
   * carrier walking under a crate with daylight beneath it (playtest
   * 2026-08-01). One table, whichever body is rendering.
   */
  FSModels.carryOf = function () {
    return FSModels.castOn() ? { y: V.TOP_Y + 0.012 } : { y: 0.86 };
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
    const key = "geo:knight:" + cast.gen + ":" + r + ":" + playerIdx;
    return castCached(key, () => (FSModels.castOn() ? villagerKnightGeo(r, playerIdx) : minifigKnightGeo(r, playerIdx)));
  };
  function minifigKnightGeo(r, playerIdx) {
    {
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
    }
  }

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
    let wallStage = false;      // batch #4: does this mesh mostly consist of the real building?
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
      const f = Math.max(0, Math.min(1, frac === undefined ? 0.35 : frac));
      /* ═══ FOUR STAGES, BY QUARTILE (batch #4, 2026-08-02) ═══════════════
       * The Phase-V site raised the SAME rising plaster cube whatever it was
       * going to be, so a windmill, a fortress and a bakery were one silhouette
       * until the moment they finished. See FSModels.buildingStages for the
       * classifier; the stage index here is the same quartile the renderer
       * keys its rebuild on (bldVisKey), so a stage change costs exactly one
       * mesh rebuild and never a per-frame one. */
      const stage = Math.max(0, Math.min(3, Math.floor(f * 4)));
      wallStage = stage >= 2;
      const st = FSModels.buildingStages(type, playerIdx);
      const sb = st.shellBox;
      const bw = Math.max(0.7, st.w), bd = Math.max(0.7, st.d), bh = Math.max(0.4, st.wallTop);
      const scaffH = bh + 0.35;

      /* --- delivered materials, on every unfinished stage: they are what the
       * carriers have actually walked across the map with --- */
      const matN = 1 + stage;
      for (let i = 0; i < Math.min(4, matN + 1); i++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.40, 0.05, 0.18), color: FSC.RES_COLOR.plank, cell: "wood",
          matrix: M(-c * 0.86, 0.13 + i * 0.055, -c * 0.30, 0, i * 0.08, 0),
        });
      }
      for (let i = 0; i < Math.min(3, matN); i++) {
        const a = 0.4 + i * 1.7;
        parts.push({
          geo: new THREE.IcosahedronGeometry(0.13 + (i % 2) * 0.03, 0), color: COL.STONE, cell: "rock",
          matrix: M(c * 0.80 + Math.cos(a) * 0.16, 0.16, -c * 0.55 + Math.sin(a) * 0.16, 0.4, a, 0),
        });
      }

      if (stage === 0) {
        /* 0 · CLEARED PAD. Levelled ground, the stakes and rope already there,
         * a barrow and the delivered materials heaped on it. It is the ONLY
         * content of this stage, so the heap is a real heap: a site whose only
         * mark is a rope square reads as an empty field with string on it. */
        parts.push({ geo: new THREE.BoxGeometry(bw * 1.02, 0.08, bd * 1.02), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.09, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.16, 0.26), color: 0x9a6a3c, cell: "plank", matrix: M(c * 0.34, 0.15, c * 0.34, 0.35, 0.6, 0) });
        parts.push({ geo: new THREE.CylinderGeometry(0.09, 0.09, 0.04, 8), color: 0x6f5334, matrix: M(c * 0.34 + 0.10, 0.10, c * 0.34 + 0.18, 0, 0.6, Math.PI / 2) });
        // a stack of planks and a heap of stone, in the middle where they read
        for (let i = 0; i < 6; i++) {
          parts.push({
            geo: new THREE.BoxGeometry(0.52, 0.055, 0.20), color: FSC.RES_COLOR.plank, cell: "wood",
            matrix: M(-bw * 0.16, 0.13 + (i >> 1) * 0.058, (i % 2 ? 0.11 : -0.11), 0, (i * 0.05), 0),
          });
        }
        for (let i = 0; i < 5; i++) {
          const a = i * 1.29;
          parts.push({
            geo: new THREE.IcosahedronGeometry(0.13 + (i % 3) * 0.025, 0), color: COL.STONE, cell: "rock",
            matrix: M(bw * 0.22 + Math.cos(a) * 0.16, 0.13 + (i > 3 ? 0.14 : 0), Math.sin(a) * 0.16, 0.3, a, 0.2),
          });
        }
        // a couple of squared timbers leaning on the stakes
        for (let i = 0; i < 2; i++) {
          parts.push({
            geo: new THREE.BoxGeometry(0.08, bh * 0.9, 0.08), color: V.WALL_TIMBER, cell: "wood",
            matrix: M(-c * 0.55 + i * 0.10, bh * 0.42, c * 0.62, 0.34, 0.3 * i, 0.1),
          });
        }
      } else if (stage === 1) {
        /* 1 · THE TIMBER FRAME. Corner posts to the wall line, a sill at the
         * foot and a top plate at the head, plus one mid stud per side — all
         * derived from the finished model's own footprint, so a big storehouse
         * frames big and a guard hut frames small. */
        parts.push({ geo: new THREE.BoxGeometry(bw * 1.04, 0.10, bd * 1.04), color: V.FOUNDATION, cell: "stone", matrix: M(0, 0.10, 0) });
        const hw = bw * 0.5, hd = bd * 0.5;
        for (let i = 0; i < 4; i++) {
          const sx = (i & 1) ? 1 : -1, sz2 = (i & 2) ? 1 : -1;
          parts.push({
            geo: new THREE.BoxGeometry(0.10, bh, 0.10), color: V.WALL_TIMBER, cell: "wood",
            matrix: M(sx * hw, 0.15 + bh * 0.5, sz2 * hd),
          });
        }
        for (const yy of [0.19, 0.15 + bh]) {
          parts.push({ geo: new THREE.BoxGeometry(bw + 0.10, 0.075, 0.075), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, yy, hd) });
          parts.push({ geo: new THREE.BoxGeometry(bw + 0.10, 0.075, 0.075), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, yy, -hd) });
          parts.push({ geo: new THREE.BoxGeometry(0.075, 0.075, bd), color: V.WALL_TIMBER, cell: "wood", matrix: M(hw, yy, 0) });
          parts.push({ geo: new THREE.BoxGeometry(0.075, 0.075, bd), color: V.WALL_TIMBER, cell: "wood", matrix: M(-hw, yy, 0) });
        }
        // one stud per long side + a diagonal brace, so it reads as carpentry
        for (const sz2 of [-1, 1]) {
          parts.push({ geo: new THREE.BoxGeometry(0.07, bh * 0.94, 0.07), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, 0.18 + bh * 0.47, sz2 * hd) });
          parts.push({
            geo: new THREE.BoxGeometry(0.06, Math.hypot(bw * 0.5, bh) * 0.9, 0.06), color: V.WALL_TIMBER, cell: "wood",
            matrix: M(-hw * 0.5, 0.18 + bh * 0.47, sz2 * hd, 0, 0, sz2 * 0.5),
          });
        }
      } else {
        /* 2 · WALLS UP, NO ROOF — and 3 · the same with bare trusses over it.
         * Both are the FINISHED MODEL with its roof classified out, which is
         * the whole point: a half-built windmill is unmistakably a windmill. */
        for (const p of st.body) parts.push(p);
        /* CEILING JOISTS. A wall is a solid box in this world, so taking the
         * roof off leaves the box's TOP FACE looking at a camera that is 52°
         * above it — a flat lid in the wall's own colour, which reads as
         * "finished, painted brown" rather than "open to the sky". Four beams
         * laid across the opening turn the lid into structure. */
        {
          const hw = bw * 0.5, hd = bd * 0.5;
          const nJ = 4;
          for (let i = 0; i < nJ; i++) {
            const u = (i + 0.5) / nJ - 0.5;
            parts.push({
              geo: new THREE.BoxGeometry(0.07, 0.07, bd * 1.04), color: V.WALL_TIMBER, cell: "wood",
              matrix: M(u * bw * 0.92, bh + 0.05, 0),
            });
          }
          parts.push({ geo: new THREE.BoxGeometry(bw * 1.04, 0.06, 0.07), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, bh + 0.09, hd * 0.86) });
          parts.push({ geo: new THREE.BoxGeometry(bw * 1.04, 0.06, 0.07), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, bh + 0.09, -hd * 0.86) });
          void hw;
        }
        if (stage === 3) {
          const hw = bw * 0.5, hd = bd * 0.5;
          const rh = sb ? sb.roofH : bh * 0.55;
          const gable = sb && sb.roofType === "gable";
          const ridgeLen = gable ? bd * 1.1 : Math.max(bw, bd) * 0.5;
          // ridge beam
          parts.push({
            geo: new THREE.BoxGeometry(0.08, 0.08, ridgeLen), color: V.WALL_TIMBER, cell: "wood",
            matrix: M(0, bh + rh * 0.92, 0, 0, gable ? 0 : Math.PI / 2, 0),
          });
          // rafter pairs along the ridge
          const nR = gable ? 3 : 2;
          for (let i = 0; i < nR; i++) {
            const t = nR === 1 ? 0 : (i / (nR - 1) - 0.5);
            const along = gable ? t * bd * 0.86 : t * bw * 0.86;
            for (const s2 of [-1, 1]) {
              const span = Math.hypot(hw, rh) * 1.02;
              parts.push({
                geo: new THREE.BoxGeometry(0.065, span, 0.065), color: V.WALL_TIMBER, cell: "wood",
                matrix: gable
                  ? M(s2 * hw * 0.5, bh + rh * 0.46, along, 0, 0, s2 * Math.atan2(hw, rh))
                  : M(along, bh + rh * 0.46, s2 * hd * 0.5, -s2 * Math.atan2(hd, rh), 0, 0),
              });
            }
          }
          // and a wall plate to hang them from
          parts.push({ geo: new THREE.BoxGeometry(bw + 0.12, 0.07, 0.07), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, bh + 0.03, hd) });
          parts.push({ geo: new THREE.BoxGeometry(bw + 0.12, 0.07, 0.07), color: V.WALL_TIMBER, cell: "wood", matrix: M(0, bh + 0.03, -hd) });
        }
      }

      /* --- SCAFFOLD, on every stage above the bare pad. Sized to the real
       * building, not to the generic footprint box. --- */
      if (stage >= 1) {
        const sw = Math.max(bw, bd) * 0.5 + 0.16;
        const sc = [[-sw, -sw], [sw, -sw], [sw, sw], [-sw, sw]];
        for (let i = 0; i < 4; i++) {
          parts.push({
            geo: new THREE.BoxGeometry(0.07, scaffH, 0.07), color: COL.SCAFFOLD, cell: "wood",
            matrix: M(sc[i][0], scaffH / 2, sc[i][1]),
          });
          const n = sc[(i + 1) % 4];
          const mx = (sc[i][0] + n[0]) / 2, mz = (sc[i][1] + n[1]) / 2;
          const len = Math.hypot(n[0] - sc[i][0], n[1] - sc[i][1]);
          const rot = Math.atan2(n[0] - sc[i][0], n[1] - sc[i][1]);
          parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, len), color: COL.SCAFFOLD, matrix: M(mx, bh * 0.72, mz, 0, rot, 0) });
          if (i === 0) {
            parts.push({ geo: new THREE.BoxGeometry(0.24, 0.035, len), color: 0xd6bb84, cell: "wood", matrix: M(mx, bh * 0.76, mz, 0, rot, 0) });
          }
        }
        const lx = sc[2][0], lz = sc[2][1] + 0.16;
        for (let s2 = -1; s2 <= 1; s2 += 2) {
          parts.push({ geo: new THREE.BoxGeometry(0.035, scaffH * 0.92, 0.035), color: 0xd6bb84, matrix: M(lx + s2 * 0.10, scaffH * 0.44, lz, -0.16, 0, 0) });
        }
        for (let i = 0; i < 4; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.22, 0.028, 0.028), color: 0xd6bb84, matrix: M(lx, 0.14 + i * scaffH * 0.21, lz + i * 0.03) });
        }
      }
    }
    /* THE AMBIENT LIFT FOLLOWS WHAT THE MESH MOSTLY IS (batch #4). A pad of
     * stakes and spoil is site timber; a roofless shell is a BUILDING, and
     * lighting it with the site's warmer lift made the walls change colour on
     * the frame it finished. Same lesson the road decal learned about matching
     * the ground it lies on. */
    const siteLift = wallStage
      ? { of: COL.BLD_WALL, k: 0.24 }
      : { of: COL.SITE_STAKE, k: 0.28 };
    const body = new THREE.Mesh(mergeColored(parts), mat(0xffffff, {
      vertexColors: true, map: bldAtlas(), emissiveOf: siteLift.of, emissiveK: siteLift.k,
    }));
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

  window.FSModels = FSModels;
  /* The villager is OPT-IN (see the `cast` block). Nothing is fetched unless a
   * device or a link has asked for him — the default boot makes zero network
   * requests for the cast and fills the settlement with the procedural minifig.
   * When he IS wanted the fetches start here, as early as the page can, so the
   * GLBs are usually decoded before the first settlement is generated. */
  (function castOptIn() {
    let want = false;
    try {
      if (typeof location !== "undefined" && /[?&]cast=1\b/.test(location.search)) want = true;
      if (typeof localStorage !== "undefined") {
        if (want) localStorage.setItem("fs_cast", "1");         // a link sticks
        else if (localStorage.getItem("fs_cast") === "1") want = true;
      }
    } catch (e) { /* private mode / file:// — the minifig is the safe answer */ }
    if (want) { cast.on = true; FSModels.loadCast(); }
  })();
})();
