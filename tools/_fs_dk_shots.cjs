#!/usr/bin/env node
/* _fs_dk_shots.cjs — the look-adoption evidence.
 *
 *   node tools/_fs_dk_shots.cjs
 *
 * Writes shots/fs_adopt_*.png. Everything is the REAL draw path in the REAL
 * game — the only staging is (a) fast-forwarding a settlement and (b) setting
 * a live unit's `job` / `rank` field between renders, which is exactly the
 * field the renderer reads to pick a hat colour, a tool and a rank tint. No
 * sim steps happen between those renders, so nothing downstream sees them.
 *
 * Crops are composited IN THE PAGE from gl.readPixels rather than by stitching
 * screenshots: a WebGL canvas is not reliably readable through drawImage in
 * headless Chrome, and readPixels is the same route the visuals suite's tint
 * probe already trusts.
 */
const path = require("path");
const fs = require("fs");
const H = require("./_fs_harness.cjs");

const SHOTS = path.join(H.ROOT, "shots");

H.run("dk-shots", async (t) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const save = (name, dataUrl) => {
    const fp = path.join(SHOTS, name);
    fs.writeFileSync(fp, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
    console.log("  wrote shots/" + name);
  };

  /* ── in-page helpers, installed once ─────────────────────────────────── */
  const HELPERS = () => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC;
    const S = {};
    S.settle = function (opts) {
      FS.newGame(Object.assign({ size: "medium", seed: 4242, ais: 1, speed: 0 }, opts || {}));
      R.setQuality(2); FS.setSpeed(1); FS.ff(opts && opts.ff || 6000); FS.setSpeed(0);
      R.setTreeSway(false);
      for (let i = 0; i < 8; i++) R.frame(0.033);
    };
    S.gl = () => R.renderer().getContext();
    S.px = () => R.renderer().getPixelRatio();
    /** read a WxH device-pixel box centred on a world point */
    S.grab = function (wx, wy, wz, W, Hh) {
      R.frame(1e-6);
      const gl = S.gl(), pr = S.px();
      const cw = R.renderer().domElement.width, ch = R.renderer().domElement.height;
      const s = R.worldToScreen(wx, wy, wz);
      const x0 = Math.max(0, Math.min(cw - W, Math.round(s.x * pr - W / 2)));
      const y0 = Math.max(0, Math.min(ch - Hh, Math.round(ch - s.y * pr - Hh * 0.62)));
      const b = new Uint8Array(W * Hh * 4);
      gl.readPixels(x0, y0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return b;
    };
    /** full frame as RGBA (device px) */
    S.grabFull = function () {
      R.frame(1e-6);
      const gl = S.gl();
      const cw = R.renderer().domElement.width, ch = R.renderer().domElement.height;
      const b = new Uint8Array(cw * ch * 4);
      gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, b);
      return { b, w: cw, h: ch };
    };
    S.toCanvas = function (rgba, w, h, flip) {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      const im = x.createImageData(w, h);
      if (flip !== false) {
        const st = w * 4;
        for (let y = 0; y < h; y++) im.data.set(rgba.subarray((h - 1 - y) * st, (h - y) * st), y * st);
      } else im.data.set(rgba);
      x.putImageData(im, 0, 0);
      return c;
    };
    S.label = function (x, text, cx, cy, size) {
      x.font = "700 " + (size || 15) + "px ui-monospace,Consolas,monospace";
      x.textAlign = "center";
      x.lineWidth = 4; x.strokeStyle = "rgba(8,12,16,0.92)";
      x.strokeText(text, cx, cy); x.fillStyle = "#eaf2fb"; x.fillText(text, cx, cy);
    };
    /** a serf the camera can actually see, standing on open ground.
     * `serfPose` has no `moving` flag — a serf is walking when his from/to
     * vertices differ, which is the same test the film strips use. */
    S.pickSerf = function (pred) {
      for (const k in FS.G.serfs) {
        const p = R.serfPose(k | 0);
        if (!p || !(p.appear > 0.99)) continue;
        p.moving = p.from !== p.to;
        if (pred && !pred(FS.G.serfs[k], p)) continue;
        return { id: k | 0, s: FS.G.serfs[k], p };
      }
      return null;
    };
    S.worldOf = function (v) {
      const xz = [0, 0];
      FS.FSMap.worldXZ(FS.G.map, v, xz);
      return { x: xz[0], y: FS.G.map.height[v], z: xz[1] };
    };
    /** the middle of everything built so far — player 0 is the HUMAN and builds
     * nothing on its own, so a "town" shot has to frame where the AI actually
     * settled, not the lone player castle. */
    S.townCentre = function () {
      let n = 0, x = 0, z = 0, y = 0;
      for (const id in FS.G.buildings) {
        const w = S.worldOf(FS.G.buildings[id].v);
        x += w.x; z += w.z; y += w.y; n++;
      }
      return n ? { x: x / n, y: y / n, z: z / n, n } : null;
    };
    /** where the PEOPLE are. A cast shot framed on the buildings shows a lovely
     * empty castle — the workforce is spread along the roads, so the shots that
     * exist to show the cast have to follow the cast. */
    S.serfCentre = function () {
      let n = 0, x = 0, z = 0, y = 0;
      for (const k in FS.G.serfs) {
        const p = R.serfPose(k | 0);
        if (!p || !(p.appear > 0.5)) continue;
        x += p.x; z += p.z; y += p.y; n++;
      }
      return n ? { x: x / n, y: y / n, z: z / n, n } : null;
    };
    /** …and the tightest spot with several of them, for a close group shot */
    S.serfCluster = function (r) {
      const pts = [];
      for (const k in FS.G.serfs) {
        const p = R.serfPose(k | 0);
        if (p && p.appear > 0.5) pts.push(p);
      }
      let best = null;
      for (const a of pts) {
        let n = 0, x = 0, z = 0, y = 0;
        for (const b of pts) {
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d <= (r || 7)) { n++; x += b.x; z += b.z; y += b.y; }
        }
        if (!best || n > best.n) best = { n, x: x / n, y: y / n, z: z / n };
      }
      return best;
    };
    window.__DKS__ = S;
    return true;
  };

  const page = await t.newPage({ width: 1100, height: 760, deviceScaleFactor: 2 });
  await page.goto(t.BASE + "/castlekruzer.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__FS__, { timeout: 30000 });
  await page.evaluate(async () => { await window.__FS__.FSRender.spritesLoaded; });
  await page.evaluate(HELPERS);

  /* ── 1. the town ─────────────────────────────────────────────────────── */
  const town = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, S = window.__DKS__;
    S.settle();
    const c = S.serfCluster(9) || S.townCentre();
    if (c) R.setCam({ tx: c.x, tz: c.z, ty: c.y, dist: 14 });
    for (let i = 0; i < 4; i++) R.frame(0.033);
    return { look: R.spriteInfo().look, counts: R.spriteInfo().counts, bld: c ? c.n : 0 };
  });
  console.log("  town:", JSON.stringify(town));
  await t.shot(page, "fs_adopt_town.png");

  /* ── 2. walk closeup ─────────────────────────────────────────────────── */
  const walk = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, S = window.__DKS__;
    FS.setSpeed(1);
    let hit = null;
    for (let i = 0; i < 900 && !hit; i++) {
      FS.step(0.04); R.frame(0.04);
      const c = S.pickSerf((s, p) => p.moving);
      if (c) hit = c;
    }
    FS.setSpeed(0);
    if (!hit) return false;
    R.setCam({ tx: hit.p.x, tz: hit.p.z, ty: hit.p.y, dist: FSC.CAM.DIST_MIN + 1.2 });
    for (let i = 0; i < 3; i++) R.frame(0.02);
    return true;
  });
  if (!walk) console.log("  ! no walking serf found for the closeup");
  await t.shot(page, "fs_adopt_walk_closeup.png");

  /* ── 3. serf jobs: ONE dwarf, every kit ──────────────────────────────── */
  const jobs = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, S = window.__DKS__;
    const c = S.pickSerf(() => true);
    if (!c) return null;
    R.setCam({ tx: c.p.x, tz: c.p.z, ty: c.p.y, dist: FSC.CAM.DIST_MIN + 0.6 });
    const want = ["farmer", "lumberjack", "miner", "smith", "baker", "transporter"]
      .filter((j) => FSC.JOB[j.toUpperCase()] !== undefined)
      .map((j) => FSC.JOB[j.toUpperCase()]);
    const list = want.length >= 4 ? want : Object.keys(FSC.JOB).slice(0, 6).map((k) => FSC.JOB[k]);
    const W = 190, Hh = 240;
    const keep = c.s.job;
    const cells = [];
    for (const j of list) {
      c.s.job = j;
      cells.push(S.grab(c.p.x, c.p.y + 0.42, c.p.z, W, Hh));
    }
    c.s.job = keep;
    const out = document.createElement("canvas");
    out.width = W * list.length; out.height = Hh + 26;
    const x = out.getContext("2d");
    x.fillStyle = "#121820"; x.fillRect(0, 0, out.width, out.height);
    const names = Object.keys(FSC.JOB);
    list.forEach((j, i) => {
      x.drawImage(S.toCanvas(cells[i], W, Hh), i * W, 0);
      const nm = names.find((k) => FSC.JOB[k] === j) || String(j);
      S.label(x, nm.toLowerCase(), i * W + W / 2, Hh + 18, 15);
    });
    return { url: out.toDataURL("image/png"), n: list.length };
  });
  if (jobs) { save("fs_adopt_serf_jobs.png", jobs.url); console.log("  serf jobs:", jobs.n); }

  /* ── 4. knight ranks ─────────────────────────────────────────────────── */
  const ranks = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, S = window.__DKS__;
    /* A knight only exists on the map while he is marching or duelling, and a
     * peaceful settlement has none standing still to photograph. So the rank
     * strip uses the SAME display-only override as the job strip: one live unit,
     * `job` set to KNIGHT and `rank` swept 0..N-1 between renders. That is
     * exactly the pair of fields `sprKnight` reads to pick the knight sheet, the
     * mask-G rank tint and the pip overlays, so the real draw path is what is
     * being photographed — only the unit's paperwork is staged. No sim step runs
     * while it is in effect, and both fields are restored afterwards. */
    const c = S.pickSerf(() => true);
    if (!c) return null;
    const p = c.p;
    R.setCam({ tx: p.x, tz: p.z, ty: p.y, dist: FSC.CAM.DIST_MIN + 0.9 });
    const W = 190, Hh = 250, N = FSC.KNIGHT_RANKS;
    const keepJob = c.s.job, keepRank = c.s.rank;
    c.s.job = FSC.JOB.KNIGHT;
    const cells = [];
    for (let r = 0; r < N; r++) { c.s.rank = r; cells.push(S.grab(p.x, p.y + 0.5, p.z, W, Hh)); }
    c.s.job = keepJob; c.s.rank = keepRank;
    const out = document.createElement("canvas");
    out.width = W * N; out.height = Hh + 26;
    const x = out.getContext("2d");
    x.fillStyle = "#121820"; x.fillRect(0, 0, out.width, out.height);
    for (let r = 0; r < N; r++) {
      x.drawImage(S.toCanvas(cells[r], W, Hh), r * W, 0);
      S.label(x, "rank " + r, r * W + W / 2, Hh + 18, 15);
    }
    return { url: out.toDataURL("image/png"), n: N, id: c.id };
  });
  if (ranks) { save("fs_adopt_knight_ranks.png", ranks.url); console.log("  knight ranks:", ranks.n); }
  else console.log("  ! could not stage knights for the rank shot");

  /* ── 5. knight stride ────────────────────────────────────────────────── */
  const stride = await page.evaluate(() => {
    const FS = window.__FS__, R = FS.FSRender, FSC = FS.FSC, S = window.__DKS__;
    /* the knight's WALK cycle, mid-stride — same display-only job override, on a
     * unit that is genuinely walking so the gait phase is the game's own */
    FS.setSpeed(1);
    let k = null;
    for (let i = 0; i < 900 && !k; i++) {
      FS.step(0.04); R.frame(0.04);
      const c = S.pickSerf((s, p) => p.moving);
      if (c) k = c;
    }
    FS.setSpeed(0);
    if (!k) return false;
    const keepJob = k.s.job, keepRank = k.s.rank;
    k.s.job = FSC.JOB.KNIGHT; k.s.rank = 3;
    R.setCam({ tx: k.p.x, tz: k.p.z, ty: k.p.y, dist: FSC.CAM.DIST_MIN + 1.6 });
    for (let i = 0; i < 3; i++) R.frame(0.02);
    window.__DKS__.restoreStride = () => { k.s.job = keepJob; k.s.rank = keepRank; };
    return true;
  });
  if (stride) {
    await t.shot(page, "fs_adopt_knight_stride.png");
    await page.evaluate(() => window.__DKS__.restoreStride && window.__DKS__.restoreStride());
  } else console.log("  ! no marching knight for the stride shot");

  /* ── 6 + 7. the flag: minifig, and both looks in one frame ───────────── */
  const both = await page.evaluate(async () => {
    const FS = window.__FS__, R = FS.FSRender, S = window.__DKS__;
    S.settle();
    const grp = S.serfCluster(8) || S.serfCentre() || S.townCentre();
    if (grp) R.setCam({ tx: grp.x, tz: grp.z, ty: grp.y, dist: 9.5 });
    for (let i = 0; i < 4; i++) R.frame(0.033);
    const A = S.grabFull();                                   // dwarfknight
    await R.setLook("minifig");
    for (let i = 0; i < 6; i++) R.frame(0.033);
    const Bm = S.grabFull();                                  // minifig, same camera + world
    const mini = S.toCanvas(Bm.b, Bm.w, Bm.h).toDataURL("image/png");
    /* one frame, split down the middle — the only honest way to say "you cannot
     * tell which half is which at play zoom" */
    const c = document.createElement("canvas");
    c.width = A.w; c.height = A.h;
    const x = c.getContext("2d");
    x.drawImage(S.toCanvas(A.b, A.w, A.h), 0, 0);
    const right = S.toCanvas(Bm.b, Bm.w, Bm.h);
    x.drawImage(right, A.w / 2, 0, A.w / 2, A.h, A.w / 2, 0, A.w / 2, A.h);
    x.strokeStyle = "rgba(240,246,252,0.55)"; x.lineWidth = 2;
    x.beginPath(); x.moveTo(A.w / 2, 0); x.lineTo(A.w / 2, A.h); x.stroke();
    S.label(x, "dwarfknight (default)", A.w * 0.25, 34, 22);
    S.label(x, "minifig (?look=minifig)", A.w * 0.75, 34, 22);
    await R.setLook("dwarfknight");
    for (let i = 0; i < 4; i++) R.frame(0.033);
    return { mini, side: c.toDataURL("image/png") };
  });
  save("fs_adopt_minifig_flag.png", both.mini);
  save("fs_adopt_sidebyside_looks.png", both.side);

  t.check("every adoption shot was written",
    ["town", "walk_closeup", "serf_jobs", "knight_ranks", "knight_stride", "minifig_flag", "sidebyside_looks"]
      .every((n) => fs.existsSync(path.join(SHOTS, "fs_adopt_" + n + ".png"))), fs.readdirSync(SHOTS).filter((f) => /fs_adopt/.test(f)));
  t.check("no page errors while shooting", t.errors.filter((e) => !/ERR_FAILED/.test(e)).length === 0, t.errors.slice(0, 5));
});
