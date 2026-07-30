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

  /**
   * Merge parts into ONE geometry carrying per-vertex colours (so a whole tree or
   * a whole castle is a single draw call / a single instanced mesh).
   * parts: [{geo, color, matrix?}]
   */
  function mergeColored(parts) {
    const prepared = [];
    let total = 0, anyUV = false;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      if (p.matrix) g.applyMatrix4(p.matrix);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (g.attributes.uv) anyUV = true;
      prepared.push({ g, c: new THREE.Color(p.color === undefined ? 0xffffff : p.color) });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = anyUV ? new Float32Array(total * 2) : null;
    let o = 0;
    for (let i = 0; i < prepared.length; i++) {
      const g = prepared[i].g, c = prepared[i].c;
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (uv && g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
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

  function fieldTexture(stage) {
    return canvasTex("field" + stage, 64, 64, (g) => {
      const base = new THREE.Color(COL.FIELD[stage]);
      g.fillStyle = "#" + base.getHexString();
      g.fillRect(0, 0, 64, 64);
      // ploughed furrows
      g.strokeStyle = "rgba(0,0,0,0.20)";
      g.lineWidth = 2;
      for (let y = 4; y < 64; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); }
      if (stage >= 2) {
        g.strokeStyle = "rgba(255,255,255,0.22)";
        g.lineWidth = 1;
        for (let y = 8; y < 64; y += 8) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); }
      }
    });
  }

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
  /** tree at growth stage 1..4 — species 0 pine, 1 green broadleaf, 2 autumn broadleaf */
  function treeGeo(stage, species) {
    const s = Math.max(1, Math.min(4, stage));
    const h = [0.62, 1.05, 1.75, 2.65][s - 1];
    const rnd = jr(s * 31 + species * 7);
    const parts = [];
    const leaf = species === 0 ? COL.TREE_LEAF[0] : (species === 1 ? COL.TREE_LEAF[1] : COL.TREE_AUTUMN[s % COL.TREE_AUTUMN.length]);
    const trunkH = species === 0 ? h * 0.30 : h * 0.42;
    const trunkR = 0.055 + h * 0.045;
    parts.push({
      geo: new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 6),
      color: COL.TREE_TRUNK[species === 0 ? 0 : 1],
      matrix: M(0, trunkH / 2, 0),
    });
    if (species === 0) {
      // conifer: three stacked cones
      const tiers = s === 1 ? 2 : 3;
      for (let i = 0; i < tiers; i++) {
        const f = i / tiers;
        const cr = (0.30 + h * 0.20) * (1 - f * 0.45);
        const ch = h * 0.42;
        parts.push({
          geo: new THREE.ConeGeometry(cr, ch, 7),
          color: leaf,
          matrix: M(0, trunkH + ch * 0.5 + f * h * 0.42, 0),
        });
      }
    } else {
      // broadleaf: two chunky blobs
      const cr = 0.26 + h * 0.20;
      parts.push({
        geo: new THREE.IcosahedronGeometry(cr, 0),
        color: leaf,
        matrix: M(0, trunkH + cr * 0.72, 0, 0, rnd() * 3, 0, 1, 0.86, 1),
      });
      if (s >= 3) {
        parts.push({
          geo: new THREE.IcosahedronGeometry(cr * 0.72, 0),
          color: leaf,
          matrix: M(cr * 0.36, trunkH + cr * 1.28, cr * 0.2, 0, rnd() * 3, 0),
        });
      }
    }
    return mergeColored(parts);
  }

  function stumpGeo() {
    return mergeColored([
      { geo: new THREE.CylinderGeometry(0.20, 0.24, 0.26, 7), color: COL.STUMP, matrix: M(0, 0.13, 0) },
      { geo: new THREE.CylinderGeometry(0.17, 0.17, 0.04, 7), color: 0x9c7c52, matrix: M(0, 0.27, 0) },
    ]);
  }

  /** stone pile, size 1..4 (bigger pile = more charges left) */
  function stoneGeo(size) {
    const n = [1, 2, 4, 6][Math.max(1, Math.min(4, size)) - 1];
    const rnd = jr(size * 977);
    const parts = [];
    for (let i = 0; i < n; i++) {
      const r = 0.19 + rnd() * 0.14 + size * 0.05;
      const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : 0.18 + rnd() * 0.28;
      parts.push({
        geo: new THREE.IcosahedronGeometry(r, 0),
        color: COL.STONE,
        matrix: M(Math.cos(a) * d, r * 0.62, Math.sin(a) * d, rnd() * 3, rnd() * 3, rnd() * 3, 1, 0.75, 1),
      });
    }
    return mergeColored(parts);
  }

  function saplingGeo() {
    return mergeColored([
      { geo: new THREE.CylinderGeometry(0.03, 0.04, 0.22, 5), color: COL.TREE_TRUNK[0], matrix: M(0, 0.11, 0) },
      { geo: new THREE.ConeGeometry(0.14, 0.28, 6), color: COL.SAPLING, matrix: M(0, 0.34, 0) },
    ]);
  }

  /** wheat field patch, stage 0 (just sown) .. 4 (ripe) */
  function fieldGeo(stage) {
    const s = Math.max(0, Math.min(4, stage));
    const parts = [{
      geo: new THREE.BoxGeometry(1.5, 0.08 + s * 0.02, 1.5),
      color: COL.FIELD[s],
      matrix: M(0, 0.04, 0),
    }];
    if (s >= 2) {
      const rnd = jr(s * 131);
      const bh = 0.10 + s * 0.10;
      for (let i = 0; i < 9; i++) {
        const x = (i % 3 - 1) * 0.44 + (rnd() - 0.5) * 0.14;
        const z = ((i / 3) | 0) * 0.44 - 0.44 + (rnd() - 0.5) * 0.14;
        parts.push({
          geo: new THREE.BoxGeometry(0.30, bh, 0.30),
          color: COL.FIELD[s],
          matrix: M(x, 0.08 + bh / 2, z, 0, rnd() * 1.2, 0),
        });
      }
    }
    return mergeColored(parts);
  }

  function fieldStubGeo() {
    return mergeColored([{ geo: new THREE.BoxGeometry(1.5, 0.07, 1.5), color: COL.FIELD_STUB, matrix: M(0, 0.035, 0) }]);
  }

  /**
   * The instanced object registry the renderer draws the world from.
   * key -> { geo, mat, tint } ; one InstancedMesh per key.
   */
  FSModels.objectKinds = function () {
    if (CACHE.kinds) return CACHE.kinds;
    const kinds = {};
    const vc = { vertexColors: true };
    for (let sp = 0; sp < 3; sp++) {
      const leaf = sp === 0 ? COL.TREE_LEAF[0] : (sp === 1 ? COL.TREE_LEAF[1] : COL.TREE_AUTUMN[1]);
      for (let st = 1; st <= 4; st++) {
        kinds["tree" + sp + "_" + st] = {
          geo: treeGeo(st, sp),
          mat: mat(0xffffff, Object.assign({ emissiveOf: leaf }, vc)),
          tint: "leaf",
        };
      }
    }
    for (let s = 1; s <= 4; s++) {
      kinds["stone_" + s] = { geo: stoneGeo(s), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.STONE }, vc)), tint: "stone" };
    }
    kinds.stump = { geo: stumpGeo(), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.STUMP }, vc)) };
    kinds.sapling = { geo: saplingGeo(), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.SAPLING }, vc)) };
    for (let s = 0; s <= 4; s++) {
      kinds["field_" + s] = {
        geo: fieldGeo(s),
        mat: mat(0xffffff, Object.assign({ emissiveOf: COL.FIELD[s], map: fieldTexture(s) }, vc)),
      };
    }
    kinds.fieldstub = { geo: fieldStubGeo(), mat: mat(0xffffff, Object.assign({ emissiveOf: COL.FIELD_STUB }, vc)) };
    CACHE.kinds = kinds;
    return kinds;
  };

  /** map OBJ.* + species -> registry key (null = nothing to draw) */
  FSModels.kindForObj = function (obj, species) {
    const O = FSC.OBJ;
    if (obj >= O.TREE1 && obj <= O.TREE4) return "tree" + (species % 3) + "_" + (obj - O.TREE1 + 1);
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
    if (k === "leaf") { const s = 0.84 + rnd() * 0.32; out.setRGB(s * 0.97, s, s * 0.94); return out; }
    if (k === "stone") { const s = 0.85 + rnd() * 0.3; out.setRGB(s, s, s * 1.02); return out; }
    const s = 0.92 + rnd() * 0.16;
    out.setScalar(s);
    return out;
  };

  // -------------------------------------------------------------------- castle
  /** An impressive keep: walls, four towers, gate, and a banner in player colour. */
  FSModels.castle = function (playerIdx) {
    const color = FSModels.playerColor(playerIdx);
    const g = new THREE.Group();
    const stone = [], wood = [], team = [];

    stone.push({ geo: new THREE.BoxGeometry(3.5, 0.34, 3.5), color: 0xa9a091, matrix: M(0, 0.17, 0) });
    stone.push({ geo: new THREE.BoxGeometry(2.5, 1.9, 2.5), color: COL.CASTLE_WALL, matrix: M(0, 1.15, 0) });
    // battlements around the keep
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.cos(a), z = Math.sin(a);
      const ax = Math.abs(x) > Math.abs(z) ? Math.sign(x) * 1.25 : x * 1.25;
      const az = Math.abs(z) >= Math.abs(x) ? Math.sign(z) * 1.25 : z * 1.25;
      stone.push({ geo: new THREE.BoxGeometry(0.34, 0.3, 0.34), color: COL.CASTLE_WALL, matrix: M(ax, 2.25, az) });
    }
    // four corner towers with conical roofs
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2;
      const x = Math.cos(a) * 1.5, z = Math.sin(a) * 1.5;
      stone.push({ geo: new THREE.CylinderGeometry(0.42, 0.48, 2.6, 8), color: 0xb5ac9b, matrix: M(x, 1.3, z) });
      team.push({ geo: new THREE.ConeGeometry(0.58, 0.8, 8), color: color, matrix: M(x, 3.0, z) });
    }
    // gate on the door (SE) side
    wood.push({ geo: new THREE.BoxGeometry(0.9, 1.0, 0.16), color: 0x4d3826, matrix: M(0.62, 0.5, 1.3) });
    wood.push({ geo: new THREE.BoxGeometry(0.16, 1.0, 0.9), color: 0x4d3826, matrix: M(1.3, 0.5, 0.62) });
    // keep roof + flag pole
    team.push({ geo: new THREE.ConeGeometry(1.9, 1.0, 4), color: COL.CASTLE_ROOF, matrix: M(0, 2.6, 0, 0, Math.PI / 4, 0) });
    wood.push({ geo: new THREE.CylinderGeometry(0.05, 0.05, 1.3, 5), color: 0x8a8070, matrix: M(0, 3.6, 0) });

    const body = new THREE.Mesh(mergeColored(stone.concat(wood)), mat(0xffffff, { vertexColors: true, emissiveOf: COL.CASTLE_WALL, emissiveK: 0.26 }));
    body.name = "castleBody";
    g.add(body);
    const trim = new THREE.Mesh(mergeColored(team), mat(0xffffff, { vertexColors: true, emissiveOf: color }));
    trim.name = "castleTrim";
    g.add(trim);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62, 0.44),
      mat(0xffffff, { map: bannerTexture(color), side: THREE.DoubleSide, emissiveOf: color, emissiveK: 0.35 })
    );
    banner.position.set(0.32, 4.02, 0);
    banner.name = "castleBanner";
    g.add(banner);
    g.userData.banner = banner;
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
  function shell(parts, w, h, o) {
    o = o || {};
    const wall = o.wall === undefined ? COL.BLD_WALL : o.wall;
    const roof = o.roof === undefined ? COL.BLD_ROOF : o.roof;
    parts.push({ geo: new THREE.BoxGeometry(w, h, w * (o.d || 1)), color: wall, matrix: M(0, h / 2, 0) });
    // sill beams — the timbered look, two thin bands
    parts.push({ geo: new THREE.BoxGeometry(w * 1.04, 0.07, w * (o.d || 1) * 1.04), color: COL.BLD_WOOD, matrix: M(0, h * 0.62, 0) });
    if (o.roofType === "flat") {
      parts.push({ geo: new THREE.BoxGeometry(w * 1.15, 0.12, w * (o.d || 1) * 1.15), color: roof, matrix: M(0, h + 0.06, 0) });
    } else if (o.roofType === "gable") {
      // two slabs leaning together — reads as a pitched roof from any angle
      const rl = w * 0.78, rh = o.roofH || 0.6;
      parts.push({ geo: new THREE.BoxGeometry(rl, 0.1, w * (o.d || 1) * 1.15), color: roof, matrix: M(-w * 0.24, h + rh * 0.5, 0, 0, 0, 0.72) });
      parts.push({ geo: new THREE.BoxGeometry(rl, 0.1, w * (o.d || 1) * 1.15), color: roof, matrix: M(w * 0.24, h + rh * 0.5, 0, 0, 0, -0.72) });
    } else {
      parts.push({
        geo: new THREE.ConeGeometry(w * 0.86, o.roofH || 0.62, 4), color: roof,
        matrix: M(0, h + (o.roofH || 0.62) * 0.5, 0, 0, Math.PI / 4, 0),
      });
    }
    // door faces the SE flag (the model group is yawed to it by the renderer)
    parts.push({ geo: new THREE.BoxGeometry(0.28, h * 0.52, 0.06), color: 0x4d3826, matrix: M(w * 0.12, h * 0.26, w * (o.d || 1) * 0.5) });
    return parts;
  }
  function post(parts, x, z, h, col) {
    parts.push({ geo: new THREE.CylinderGeometry(0.05, 0.06, h, 5), color: col === undefined ? COL.BLD_WOOD : col, matrix: M(x, h / 2, z) });
  }
  function fence(parts, r, n, col) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      post(parts, Math.cos(a) * r, Math.sin(a) * r, 0.34, col);
    }
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
    switch (type) {
      case "stock":
        shell(parts, 1.9, 1.05, { roofType: "gable", roofH: 0.7, wall: 0xd7c7a6 });
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.3, 0.24, 0.3), color: 0xc9a06a, matrix: M(-0.85 + i * 0.34, 0.12, 1.05) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.5, 0.6, 0.06), color: 0x4d3826, matrix: M(0, 0.3, 0.96) });
        break;
      case "hut":
        shell(parts, 1.0, 0.8, { wall: COL.CASTLE_WALL, roofType: "flat", roof: 0x9a9384 });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2;
          parts.push({ geo: new THREE.BoxGeometry(0.2, 0.2, 0.2), color: COL.CASTLE_WALL, matrix: M(Math.cos(a) * 0.42, 0.9, Math.sin(a) * 0.42) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.28, 0.2, 0.04), color: team, matrix: M(0, 1.15, 0) });
        post(parts, 0, 0, 1.15, COL.FLAG_POLE);
        break;
      case "tower":
        parts.push({ geo: new THREE.CylinderGeometry(0.62, 0.72, 1.9, 8), color: COL.CASTLE_WALL, matrix: M(0, 0.95, 0) });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          parts.push({ geo: new THREE.BoxGeometry(0.2, 0.24, 0.2), color: COL.CASTLE_WALL, matrix: M(Math.cos(a) * 0.6, 2.0, Math.sin(a) * 0.6) });
        }
        parts.push({ geo: new THREE.ConeGeometry(0.62, 0.5, 8), color: team, matrix: M(0, 2.35, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.5, 0.06), color: 0x4d3826, matrix: M(0.1, 0.25, 0.66) });
        break;
      case "fortress":
        parts.push({ geo: new THREE.BoxGeometry(1.7, 1.5, 1.7), color: COL.CASTLE_WALL, matrix: M(0, 0.75, 0) });
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + i * Math.PI / 2;
          const x = Math.cos(a) * 0.92, z = Math.sin(a) * 0.92;
          parts.push({ geo: new THREE.CylinderGeometry(0.34, 0.38, 1.9, 6), color: 0xb5ac9b, matrix: M(x, 0.95, z) });
          parts.push({ geo: new THREE.ConeGeometry(0.44, 0.42, 6), color: team, matrix: M(x, 2.1, z) });
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          parts.push({ geo: new THREE.BoxGeometry(0.22, 0.24, 0.22), color: COL.CASTLE_WALL, matrix: M(Math.cos(a) * 0.72, 1.6, Math.sin(a) * 0.72) });
        }
        break;
      case "fisher":
        shell(parts, 0.95, 0.72, { roofH: 0.5, roof: 0x5b7f92, wall: 0xd8cbb0 });
        // drying rack with a catch hanging on it
        post(parts, -0.62, 0.3, 0.62); post(parts, -0.62, -0.3, 0.62);
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, 0.66), color: COL.BLD_WOOD, matrix: M(-0.62, 0.6, 0) });
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.09, 0.2, 0.05), color: FSC.RES_COLOR.fish, matrix: M(-0.62, 0.46, -0.24 + i * 0.24) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.5, 0.5, 0.04), color: COL.NET, matrix: M(0.56, 0.3, 0.2, 0, 0.5, 0.2) });
        break;
      case "lumberjack": {
        shell(parts, 0.95, 0.72, { roofH: 0.5, roof: 0x7a5636 });
        const logs = [[-0.66, 0.1], [-0.66, -0.16], [-0.62, 0.26]];
        for (let i = 0; i < logs.length; i++) {
          parts.push({ geo: new THREE.CylinderGeometry(0.11, 0.11, 0.8, 6), color: FSC.RES_COLOR.lumber, matrix: M(logs[i][0], 0.12 + i * 0.19, logs[i][1], Math.PI / 2, 0, 0) });
        }
        parts.push({ geo: new THREE.CylinderGeometry(0.2, 0.22, 0.26, 7), color: COL.STUMP, matrix: M(0.6, 0.13, 0.4) });
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.4, 0.05), color: COL.TOOL, matrix: M(0.6, 0.42, 0.4, 0.4, 0, 0.3) });
        break;
      }
      case "forester":
        shell(parts, 0.9, 0.7, { roofH: 0.5, roof: COL.ROOF_ALT });
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.ConeGeometry(0.16, 0.34, 6), color: COL.SAPLING, matrix: M(-0.62 + i * 0.1, 0.22, 0.5 - i * 0.42) });
          parts.push({ geo: new THREE.BoxGeometry(0.26, 0.12, 0.26), color: COL.BLD_WOOD, matrix: M(-0.62 + i * 0.1, 0.06, 0.5 - i * 0.42) });
        }
        break;
      case "stonecutter":
        shell(parts, 0.95, 0.72, { roofH: 0.5, wall: 0xc2bcae, roof: 0x8d949c });
        for (let i = 0; i < 4; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.26, 0.2, 0.26), color: COL.STONE, matrix: M(-0.62 + (i % 2) * 0.3, 0.1 + ((i / 2) | 0) * 0.2, 0.42 - (i % 2) * 0.06) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.34, 0.05), color: COL.TOOL, matrix: M(0.56, 0.4, 0.3, 0, 0, 0.5) });
        break;
      case "sawmill": {
        shell(parts, 1.7, 0.95, { roofType: "gable", roofH: 0.62, d: 0.85, roof: 0x8a6a42 });
        const blade = bladeGeo();
        out.spin = blade; out.spinAt = [0.0, 0.62, 0.78]; out.axis = "z"; out.rate = 5.5;
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.72, 0.08, 0.26), color: FSC.RES_COLOR.plank, matrix: M(-0.95, 0.06 + i * 0.1, 0.3 - i * 0.06) });
        }
        parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.1, 0.7, 6), color: FSC.RES_COLOR.lumber, matrix: M(0.95, 0.12, -0.2, Math.PI / 2, 0, 0) });
        break;
      }
      case "farm":
        shell(parts, 1.35, 0.95, { roofType: "gable", roofH: 0.66 });
        parts.push({ geo: new THREE.BoxGeometry(0.8, 0.6, 0.7), color: 0xb0563f, matrix: M(-1.0, 0.3, -0.25) });
        parts.push({ geo: new THREE.BoxGeometry(0.88, 0.1, 0.78), color: COL.BLD_ROOF, matrix: M(-1.0, 0.62, -0.25) });
        fence(parts, 1.18, 10);
        for (let i = 0; i < 4; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.3, 0.22, 0.3), color: FSC.RES_COLOR.wheat, matrix: M(0.5 + (i % 2) * 0.34, 0.11, 0.6 - ((i / 2) | 0) * 0.34) });
        }
        break;
      case "mill": {
        parts.push({ geo: new THREE.CylinderGeometry(0.46, 0.66, 1.5, 8), color: 0xd8cdb4, matrix: M(0, 0.75, 0) });
        parts.push({ geo: new THREE.ConeGeometry(0.6, 0.48, 8), color: COL.BLD_ROOF, matrix: M(0, 1.72, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.26, 0.42, 0.06), color: 0x4d3826, matrix: M(0.1, 0.21, 0.6) });
        out.spin = sailsGeo(); out.spinAt = [0, 1.5, 0.62]; out.axis = "z"; out.rate = 1.6;
        break;
      }
      case "bakery":
        shell(parts, 1.35, 0.92, { roofH: 0.6, wall: 0xe0d2b6 });
        parts.push({ geo: new THREE.BoxGeometry(0.3, 0.8, 0.3), color: 0xa0938a, matrix: M(-0.48, 1.15, -0.4) });
        parts.push({ geo: new THREE.CylinderGeometry(0.34, 0.4, 0.5, 8), color: 0xb08a6a, matrix: M(0.62, 0.25, 0.42) });
        parts.push({ geo: new THREE.BoxGeometry(0.24, 0.24, 0.06), color: COL.FIRE_BOX, matrix: M(0.62, 0.25, 0.72) });
        out.smoke = [-0.48, 1.6, -0.4];
        break;
      case "pigfarm": {
        shell(parts, 1.25, 0.9, { roofType: "gable", roofH: 0.6, wall: 0xd0b998 });
        fence(parts, 1.2, 12);
        const pigs = [[0.7, 0.55], [0.35, 0.9], [0.85, -0.4]];
        for (let i = 0; i < pigs.length; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.3, 0.18, 0.2), color: COL.PIG, matrix: M(pigs[i][0], 0.12, pigs[i][1], 0, i * 0.9, 0) });
          parts.push({ geo: new THREE.BoxGeometry(0.13, 0.13, 0.12), color: COL.PIG, matrix: M(pigs[i][0] + 0.16, 0.16, pigs[i][1] + 0.06, 0, i * 0.9, 0) });
        }
        break;
      }
      case "butcher":
        shell(parts, 1.25, 0.9, { roofH: 0.58, wall: 0xe2cfc0, roof: 0x9c4b46 });
        parts.push({ geo: new THREE.BoxGeometry(1.3, 0.06, 0.5), color: 0xa8845c, matrix: M(0, 0.95, 0.62, 0.35, 0, 0) });
        post(parts, -0.55, 0.82, 0.7); post(parts, 0.55, 0.82, 0.7);
        for (let i = 0; i < 2; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.16, 0.24, 0.12), color: FSC.RES_COLOR.meat, matrix: M(-0.25 + i * 0.5, 0.6, 0.68) });
        }
        break;
      case "stoneMine": case "coalMine": case "ironMine": case "goldMine": {
        const tint = MINE_TINT[type];
        parts.push({ geo: new THREE.BoxGeometry(1.0, 0.62, 0.9), color: 0xa79b86, matrix: M(0, 0.31, 0) });
        parts.push({ geo: new THREE.BoxGeometry(1.06, 0.1, 0.96), color: 0x8b8172, matrix: M(0, 0.64, 0) });
        // headframe: two legs, a beam and the winding wheel
        post(parts, -0.34, 0.3, 1.25); post(parts, 0.34, 0.3, 1.25);
        parts.push({ geo: new THREE.BoxGeometry(0.86, 0.08, 0.08), color: COL.BLD_WOOD, matrix: M(0, 1.25, 0.3) });
        parts.push({ geo: new THREE.BoxGeometry(0.5, 0.5, 0.05), color: 0x3a3128, matrix: M(0, 0.25, 0.46) });
        // ore cart + a heap in the mineral's own colour
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.2, 0.26), color: 0x6b5137, matrix: M(0.62, 0.12, 0.5) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.16, 0), color: tint, matrix: M(0.62, 0.26, 0.5) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.22, 0), color: tint, matrix: M(-0.66, 0.14, 0.45, 0.3, 0.4, 0) });
        out.spin = wheelGeo(); out.spinAt = [0, 1.25, 0.3]; out.axis = "z"; out.rate = 2.4;
        break;
      }
      case "smelter": case "goldsmelter": {
        const gold = type === "goldsmelter";
        shell(parts, 1.25, 0.85, { roofType: "flat", wall: 0xa9a094, roof: 0x8c8478 });
        parts.push({ geo: new THREE.CylinderGeometry(0.24, 0.3, 1.15, 8), color: 0x8f8578, matrix: M(-0.42, 1.0, -0.3) });
        parts.push({ geo: new THREE.BoxGeometry(0.42, 0.42, 0.08), color: COL.FIRE_BOX, matrix: M(0.3, 0.32, 0.66) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.2, 0), color: gold ? FSC.RES_COLOR.goldOre : FSC.RES_COLOR.ironOre, matrix: M(0.72, 0.14, 0.5) });
        parts.push({ geo: new THREE.IcosahedronGeometry(0.18, 0), color: FSC.RES_COLOR.coal, matrix: M(-0.75, 0.13, 0.45) });
        if (gold) parts.push({ geo: new THREE.BoxGeometry(0.9, 0.07, 0.9), color: FSC.RES_COLOR.goldBar, matrix: M(0, 0.9, 0) });
        out.smoke = [-0.42, 1.6, -0.3];
        break;
      }
      case "toolmaker":
        shell(parts, 1.3, 0.9, { roofType: "gable", roofH: 0.6, wall: 0xcfb894, roof: 0x6b6f77 });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.24, 0.26), color: 0x6f7780, matrix: M(0.62, 0.12, 0.55) });
        parts.push({ geo: new THREE.BoxGeometry(0.14, 0.16, 0.14), color: 0x8a8f96, matrix: M(0.62, 0.3, 0.55) });
        for (let i = 0; i < 3; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.05, 0.3, 0.05), color: COL.TOOL, matrix: M(-0.7, 0.35, 0.4 - i * 0.26, 0, 0, 0.2) });
        }
        parts.push({ geo: new THREE.BoxGeometry(0.06, 0.06, 0.9), color: COL.BLD_WOOD, matrix: M(-0.7, 0.52, 0.14) });
        break;
      case "weaponsmith":
        shell(parts, 1.25, 0.88, { roofType: "flat", wall: 0xb6a894, roof: 0x7d7468 });
        parts.push({ geo: new THREE.CylinderGeometry(0.2, 0.26, 1.0, 8), color: 0x8f8578, matrix: M(0.46, 0.9, -0.34) });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.26, 0.28), color: 0x6f7780, matrix: M(-0.6, 0.13, 0.5) });
        parts.push({ geo: new THREE.BoxGeometry(0.07, 0.62, 0.07), color: FSC.RES_COLOR.sword, matrix: M(-0.6, 0.5, 0.5, 0, 0, 0.15) });
        parts.push({ geo: new THREE.BoxGeometry(0.34, 0.4, 0.08), color: FSC.RES_COLOR.shield, matrix: M(0.66, 0.5, 0.52) });
        out.smoke = [0.46, 1.45, -0.34];
        break;
      case "boatwright": {
        shell(parts, 0.95, 0.72, { roofH: 0.5, wall: 0xcdb894, roof: 0x4f7fa8 });
        // a hull on the slipway
        parts.push({ geo: new THREE.BoxGeometry(0.9, 0.16, 0.36), color: COL.BOAT, matrix: M(0.1, 0.16, 0.75, 0, 0.2, 0) });
        parts.push({ geo: new THREE.BoxGeometry(0.66, 0.14, 0.24), color: 0xa9743d, matrix: M(0.1, 0.3, 0.75, 0, 0.2, 0) });
        post(parts, -0.35, 0.75, 0.24); post(parts, 0.55, 0.75, 0.24);
        for (let i = 0; i < 2; i++) {
          parts.push({ geo: new THREE.BoxGeometry(0.6, 0.06, 0.2), color: FSC.RES_COLOR.plank, matrix: M(-0.7, 0.05 + i * 0.08, 0.3) });
        }
        break;
      }
      default:
        shell(parts, 1.15, 0.85, {});
    }
    return out;
  }

  /** Finished building of `type` in `playerIdx`'s colours. */
  FSModels.building = function (type, playerIdx) {
    if (type === "castle") return FSModels.castle(playerIdx);
    const g = new THREE.Group();
    const built = buildingParts(type, playerIdx);
    const body = new THREE.Mesh(mergeColored(built.parts),
      mat(0xffffff, { vertexColors: true, emissiveOf: COL.BLD_WALL, emissiveK: 0.28 }));
    body.name = "bldBody";
    g.add(body);
    if (built.spin) {
      const spin = new THREE.Mesh(built.spin, mat(0xffffff, { vertexColors: true, emissiveOf: COL.MILL_SAIL, emissiveK: 0.3 }));
      spin.position.set(built.spinAt[0], built.spinAt[1], built.spinAt[2]);
      spin.name = "bldSpin";
      g.add(spin);
      g.userData.spin = spin;
      g.userData.spinAxis = built.axis;
      g.userData.spinRate = built.rate;
    }
    if (built.smoke) g.userData.smoke = built.smoke;
    g.userData.type = type;
    return g;
  };

  /** A rowing boat — drawn under a sailor while he is out on the water. */
  FSModels.boatGeo = function () {
    return cached("geo:boat", () => mergeColored([
      { geo: new THREE.BoxGeometry(0.86, 0.16, 0.42), color: COL.BOAT, matrix: M(0, 0.08, 0) },
      { geo: new THREE.BoxGeometry(0.5, 0.1, 0.3), color: 0xa9743d, matrix: M(0, 0.19, 0) },
      { geo: new THREE.BoxGeometry(0.06, 0.05, 0.5), color: 0x6b5137, matrix: M(0.1, 0.22, 0, 0.4, 0, 0) },
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
    return cached("mat:" + key, () => mat(0xffffff, { vertexColors: true, emissiveOf: emissiveOf, emissiveK: k }));
  };

  /**
   * A serf minifig (~140 tris): boots, smock, player-colour sash, head, a hat in
   * the profession colour and a tool in hand. One merged geometry per
   * (job, player) so the renderer can draw the whole workforce instanced.
   */
  FSModels.serfGeo = function (job, playerIdx) {
    const key = "geo:serf:" + job + ":" + playerIdx;
    return cached(key, () => {
      const team = FSModels.playerColor(playerIdx);
      const hat = FSC.JOB_COLOR[job] || FSC.JOB_COLOR.generic;
      const parts = [];
      // legs
      parts.push({ geo: new THREE.BoxGeometry(0.11, 0.20, 0.11), color: 0x5a4a34, matrix: M(-0.08, 0.10, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.11, 0.20, 0.11), color: 0x5a4a34, matrix: M(0.08, 0.10, 0) });
      // body + sash in the player's colour
      parts.push({ geo: new THREE.BoxGeometry(0.30, 0.30, 0.22), color: COL.SERF_CLOTH, matrix: M(0, 0.35, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.32, 0.09, 0.24), color: team, matrix: M(0, 0.34, 0) });
      // arms
      parts.push({ geo: new THREE.BoxGeometry(0.08, 0.24, 0.09), color: COL.SERF_CLOTH, matrix: M(-0.19, 0.36, 0.03) });
      parts.push({ geo: new THREE.BoxGeometry(0.08, 0.24, 0.09), color: COL.SERF_CLOTH, matrix: M(0.19, 0.36, 0.03) });
      // head + hat
      parts.push({ geo: new THREE.BoxGeometry(0.20, 0.18, 0.19), color: COL.SERF_SKIN, matrix: M(0, 0.59, 0) });
      parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.17, 0.09, 7), color: hat, matrix: M(0, 0.70, 0) });
      if (job === FSC.JOB.KNIGHT) {
        parts.push({ geo: new THREE.ConeGeometry(0.15, 0.14, 7), color: hat, matrix: M(0, 0.79, 0) });
      }
      // tool in the right hand
      const tools = FSC.JOB_TOOLS[job] || [];
      if (tools.length) {
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.42, 0.045), color: COL.TOOL, matrix: M(0.25, 0.36, 0.06) });
        const headCol = tools[0] === "hammer" ? 0x8a8f96 : (tools[0] === "shovel" ? 0x9aa0a8 : 0xb9bfc6);
        parts.push({ geo: new THREE.BoxGeometry(0.16, 0.09, 0.07), color: headCol, matrix: M(0.25, 0.56, 0.06) });
      }
      return mergeColored(parts);
    });
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
      parts.push({ geo: new THREE.BoxGeometry(0.11, 0.20, 0.11), color: 0x4a3f30, matrix: M(-0.08, 0.10, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.11, 0.20, 0.11), color: 0x4a3f30, matrix: M(0.08, 0.10, 0) });
      // mail coat + surcoat in the player's colour
      parts.push({ geo: new THREE.BoxGeometry(0.31, 0.30, 0.23), color: 0x8f959d, matrix: M(0, 0.35, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.33, 0.13, 0.25), color: team, matrix: M(0, 0.33, 0) });
      parts.push({ geo: new THREE.BoxGeometry(0.08, 0.24, 0.09), color: 0x8f959d, matrix: M(-0.20, 0.36, 0.03) });
      parts.push({ geo: new THREE.BoxGeometry(0.08, 0.24, 0.09), color: 0x8f959d, matrix: M(0.20, 0.36, 0.03) });
      parts.push({ geo: new THREE.BoxGeometry(0.19, 0.17, 0.18), color: COL.SERF_SKIN, matrix: M(0, 0.59, 0) });
      // kettle helm
      parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.16, 0.12, 8), color: steel, matrix: M(0, 0.66, 0) });
      parts.push({ geo: new THREE.ConeGeometry(0.13, 0.13, 8), color: steel, matrix: M(0, 0.78, 0) });
      // sword: blade + crossguard
      parts.push({ geo: new THREE.BoxGeometry(0.05, 0.46, 0.05), color: 0xd8dde3, matrix: M(0.27, 0.44, 0.07) });
      parts.push({ geo: new THREE.BoxGeometry(0.16, 0.045, 0.06), color: trim, matrix: M(0.27, 0.24, 0.07) });
      // shield: a disc with the rank trim around the rim
      parts.push({ geo: new THREE.CylinderGeometry(0.15, 0.15, 0.04, 10), color: team, matrix: M(-0.25, 0.36, 0.09, Math.PI / 2, 0, 0) });
      parts.push({ geo: new THREE.TorusGeometry(0.15, 0.028, 5, 10), color: trim, matrix: M(-0.25, 0.36, 0.10) });
      for (let i = 0; i < r; i++) {                       // rank pips on the surcoat
        parts.push({ geo: new THREE.BoxGeometry(0.045, 0.045, 0.03), color: trim, matrix: M(-0.06 + i * 0.045, 0.47, 0.13) });
      }
      return mergeColored(parts);
    });
  };

  /** A frontier post — driven into the ground, pennant in the owner's colour. */
  FSModels.stakeGeo = function () {
    return cached("geo:stake", () => mergeColored([
      { geo: new THREE.CylinderGeometry(0.035, 0.045, 0.62, 5), color: COL.STAKE, matrix: M(0, 0.31, 0) },
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
    const def = FSC.BLD[type] || {};
    const sz = def.size || 0;
    const w = [1.15, 1.6, 2.1][sz], h = [0.85, 1.15, 1.4][sz];
    const g = new THREE.Group();
    const parts = [];
    const pad = w * 0.98;
    parts.push({ geo: new THREE.BoxGeometry(pad, 0.10, pad), color: COL.SITE_PAD, matrix: M(0, 0.05, 0) });

    if (state === "burn") {
      parts.push({ geo: new THREE.BoxGeometry(w * 0.8, h * 0.55, w * 0.8), color: COL.BURN, matrix: M(0, h * 0.28, 0) });
      for (let i = 0; i < 5; i++) {
        const a = i * 1.256;
        parts.push({
          geo: new THREE.ConeGeometry(0.20 - i * 0.02, 0.5 + (i % 3) * 0.18, 5),
          color: COL.FIRE[i % 2],
          matrix: M(Math.cos(a) * w * 0.28, h * 0.55 + 0.25, Math.sin(a) * w * 0.28),
        });
      }
      const burnt = new THREE.Mesh(mergeColored(parts), mat(0xffffff, { vertexColors: true, emissiveOf: COL.FIRE[0], emissiveK: 0.5 }));
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
        geo: new THREE.CylinderGeometry(0.045, 0.055, 0.55, 5), color: COL.SITE_STAKE,
        matrix: M(corners[i][0], 0.28, corners[i][1]),
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
    if (state === "leveling") {
      parts.push({ geo: new THREE.ConeGeometry(0.30, 0.34, 6), color: COL.SITE_PAD, matrix: M(c * 0.72, 0.20, -c * 0.72) });
      parts.push({ geo: new THREE.ConeGeometry(0.22, 0.26, 6), color: COL.SITE_PAD, matrix: M(-c * 0.80, 0.16, c * 0.55) });
    }
    if (state === "build") {
      const f = Math.max(0.08, Math.min(1, frac === undefined ? 0.35 : frac));
      parts.push({ geo: new THREE.BoxGeometry(w * 0.86, h * f, w * 0.86), color: COL.BLD_WALL, matrix: M(0, 0.1 + h * f * 0.5, 0) });
      // scaffold: four uprights plus a waist rail
      for (let i = 0; i < 4; i++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.07, h + 0.35, 0.07), color: COL.SCAFFOLD,
          matrix: M(corners[i][0] * 0.92, (h + 0.35) / 2, corners[i][1] * 0.92),
        });
      }
      for (let i = 0; i < 4; i++) {
        const n = corners[(i + 1) % 4];
        const mx = (corners[i][0] + n[0]) / 2 * 0.92, mz = (corners[i][1] + n[1]) / 2 * 0.92;
        const len = Math.sqrt((n[0] - corners[i][0]) * (n[0] - corners[i][0]) + (n[1] - corners[i][1]) * (n[1] - corners[i][1])) * 0.92;
        const rot = Math.atan2(n[0] - corners[i][0], n[1] - corners[i][1]);
        parts.push({ geo: new THREE.BoxGeometry(0.05, 0.05, len), color: COL.SCAFFOLD, matrix: M(mx, h * 0.62, mz, 0, rot, 0) });
      }
    }
    const body = new THREE.Mesh(mergeColored(parts), mat(0xffffff, { vertexColors: true, emissiveOf: COL.SITE_STAKE, emissiveK: 0.3 }));
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
