/* ═══════════════════════════════════════════════════════════════════════════
 * fs-skin.js — THE MEDIEVAL SKIN: every UI surface material, drawn in code.
 *
 * WHY THIS FILE EXISTS AND WHY IT LOADS IN <head>
 * ----------------------------------------------
 * Farmstead's chrome is meant to look like carved oak holding parchment, not
 * like a web page. That needs TEXTURE — grain, fibre, speckle, tool marks —
 * and the house rule for this repo is zero asset files where code will do
 * (the goods sprites, the cast sheets and the whole world are procedural for
 * the same reason). So the six materials below are painted onto canvases at
 * boot and handed to CSS as data-URL custom properties on :root.
 *
 * It is a HEAD script, deliberately BLOCKING: the title screen is in the
 * initial HTML, so a texture generator that ran at the foot of <body> would
 * paint a flat-colour UI first and swap it a frame later. The whole set costs
 * a handful of milliseconds (six small canvases, ~40 KB of PNG, generated
 * ONCE — nothing here runs again, ever, and nothing runs per frame).
 *
 * DPI: every tile is rasterised at devicePixelRatio (capped at 2) and CSS
 * states its size in CSS pixels, so an iPad gets a crisp grain rather than a
 * blurred upscale.
 *
 * DETERMINISM: a tiny LCG, seeded per material. The knots in the oak are in
 * the same place on every device and every reload — art, not noise.
 *
 * SEAMLESSNESS: each tile repeats, so every mark is either drawn as a
 * function that closes over the tile (grain lines are sin() with an integer
 * number of periods across the width) or drawn nine times at ±W/±H offsets so
 * whatever crosses an edge arrives back on the other side.
 *
 * FAIL-SOFT: if anything in here throws, the CSS custom properties simply
 * never get set — every rule that uses one also carries a flat colour beneath
 * it, so the UI degrades to solid oak/parchment/stone and stays entirely
 * usable. Zero network requests: nothing is fetched, everything is drawn.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  var out = {};

  /* deterministic LCG — same knots on every device, every reload */
  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function mk(w, h, draw) {
    var c = document.createElement("canvas");
    c.width = Math.round(w * DPR); c.height = Math.round(h * DPR);
    var g = c.getContext("2d");
    g.scale(DPR, DPR);
    draw(g, w, h);
    return c.toDataURL("image/png");
  }

  /** draw fn nine times so anything crossing a tile edge comes back the far side */
  function wrapped(g, w, h, fn) {
    for (var dx = -1; dx <= 1; dx++) {
      for (var dy = -1; dy <= 1; dy++) {
        g.save(); g.translate(dx * w, dy * h); fn(g); g.restore();
      }
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * OAK — the panel body. Sawn planks: a seam on the tile boundary (so the
   * repeat reads as the next plank rather than as a repeat), long grain lines
   * that wobble on a whole number of sine periods, and a few knots.
   * ───────────────────────────────────────────────────────────────────────── */
  function oak(base, dark, light, seed, plankH) {
    return mk(128, 128, function (g, w, h) {
      var r = rng(seed);
      g.fillStyle = base; g.fillRect(0, 0, w, h);

      // broad tonal variation between planks
      for (var y = 0; y < h; y += plankH) {
        g.fillStyle = "rgba(0,0,0," + (0.03 + r() * 0.07).toFixed(3) + ")";
        if (r() > 0.5) g.fillRect(0, y, w, plankH);
      }

      // grain: long lines, integer periods across the tile so they meet
      g.lineWidth = 1;
      for (var i = 0; i < 74; i++) {
        var y0 = r() * h;
        var amp = 0.6 + r() * 2.4;
        var per = 1 + Math.floor(r() * 3);         // 1..3 whole periods
        var ph = r() * Math.PI * 2;
        var d = r() > 0.45;
        g.strokeStyle = d ? dark : light;
        g.globalAlpha = 0.10 + r() * 0.22;
        g.beginPath();
        for (var x = 0; x <= w; x += 2) {
          var yy = y0 + Math.sin((x / w) * Math.PI * 2 * per + ph) * amp;
          if (x === 0) g.moveTo(x, yy); else g.lineTo(x, yy);
        }
        g.stroke();
      }
      g.globalAlpha = 1;

      // knots — concentric rings, wrapped
      for (var k = 0; k < 2; k++) {
        var kx = r() * w, ky = r() * h, kr = 3 + r() * 4;
        wrapped(g, w, h, function (gg) {
          for (var n = 5; n >= 1; n--) {
            gg.beginPath();
            gg.ellipse(kx, ky, kr * n * 0.42, kr * n * 0.26, 0.5, 0, Math.PI * 2);
            gg.strokeStyle = n % 2 ? dark : light;
            gg.globalAlpha = 0.30 - n * 0.04;
            gg.lineWidth = 1.4;
            gg.stroke();
          }
          gg.globalAlpha = 1;
        });
      }

      // the plank seams themselves: a dark score with a lit lower lip
      for (var sy = 0; sy <= h; sy += plankH) {
        g.fillStyle = "rgba(0,0,0,.40)"; g.fillRect(0, sy - 1, w, 1.6);
        g.fillStyle = "rgba(255,235,200,.11)"; g.fillRect(0, sy + 0.8, w, 1);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * PARCHMENT — the reading surface. Warm vellum: soft tonal blooms, a fibre
   * fleck, and a faint horizontal laid-line the way real hand-made paper has.
   * ───────────────────────────────────────────────────────────────────────── */
  function parchment(base, warm, cool, seed) {
    return mk(128, 128, function (g, w, h) {
      var r = rng(seed);
      g.fillStyle = base; g.fillRect(0, 0, w, h);

      /* blooms — kept FAINT on purpose. This is the surface every number and
         cost in the game is read off; the first pass at .30 looked like proper
         aged vellum in a swatch and like a dirty screen behind text. */
      for (var i = 0; i < 16; i++) {
        var cx = r() * w, cy = r() * h, rad = 12 + r() * 40, warmer = r() > 0.5;
        wrapped(g, w, h, function (gg) {
          var grd = gg.createRadialGradient(cx, cy, 0, cx, cy, rad);
          grd.addColorStop(0, (warmer ? warm : cool) + "");
          grd.addColorStop(1, "rgba(0,0,0,0)");
          gg.globalAlpha = 0.17;
          gg.fillStyle = grd;
          gg.beginPath(); gg.arc(cx, cy, rad, 0, Math.PI * 2); gg.fill();
        });
      }
      g.globalAlpha = 1;

      // laid lines
      for (var y = 0; y < h; y += 4) {
        g.fillStyle = "rgba(120,92,50,.045)";
        g.fillRect(0, y, w, 1);
      }

      // fibre fleck
      for (var f = 0; f < 340; f++) {
        var fx = r() * w, fy = r() * h, len = 1 + r() * 3, dk = r() > 0.55;
        g.fillStyle = dk ? "rgba(112,86,46,.16)" : "rgba(255,252,238,.30)";
        g.fillRect(fx, fy, len, 1);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * STONE — button faces. Speckled granite with a chiselled, slightly uneven
   * surface; the bevels that make it read as a pressable block are CSS.
   * ───────────────────────────────────────────────────────────────────────── */
  function stone(base, dark, light, seed) {
    return mk(96, 96, function (g, w, h) {
      var r = rng(seed);
      g.fillStyle = base; g.fillRect(0, 0, w, h);

      for (var i = 0; i < 26; i++) {
        var cx = r() * w, cy = r() * h, rad = 5 + r() * 20;
        wrapped(g, w, h, function (gg) {
          var grd = gg.createRadialGradient(cx, cy, 0, cx, cy, rad);
          grd.addColorStop(0, r() > 0.5 ? dark : light);
          grd.addColorStop(1, "rgba(0,0,0,0)");
          gg.globalAlpha = 0.16;
          gg.fillStyle = grd;
          gg.beginPath(); gg.arc(cx, cy, rad, 0, Math.PI * 2); gg.fill();
        });
      }
      g.globalAlpha = 1;

      // grit
      for (var s = 0; s < 900; s++) {
        var x = r() * w, y = r() * h, v = r();
        g.fillStyle = v > 0.55 ? "rgba(255,255,255,.13)" : "rgba(40,34,26,.15)";
        g.fillRect(x, y, 1, 1);
      }
      // chisel strokes
      for (var c = 0; c < 16; c++) {
        var x0 = r() * w, y0 = r() * h, a = r() * Math.PI, L = 4 + r() * 12;
        g.strokeStyle = "rgba(40,34,26,.10)"; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + Math.cos(a) * L, y0 + Math.sin(a) * L); g.stroke();
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * LINEN — the woven backing behind recessed wells (the build grid, list
   * bodies). A coarse over-under weave, naturally seamless.
   * ───────────────────────────────────────────────────────────────────────── */
  function linen(seed) {
    return mk(64, 64, function (g, w, h) {
      var r = rng(seed);
      g.fillStyle = "#5c4526"; g.fillRect(0, 0, w, h);
      for (var y = 0; y < h; y += 4) {
        g.fillStyle = "rgba(0,0,0," + (0.10 + r() * 0.10).toFixed(3) + ")";
        g.fillRect(0, y, w, 2);
        g.fillStyle = "rgba(255,224,180,.05)";
        g.fillRect(0, y + 2, w, 1);
      }
      for (var x = 0; x < w; x += 4) {
        g.fillStyle = "rgba(0,0,0," + (0.07 + r() * 0.09).toFixed(3) + ")";
        g.fillRect(x, 0, 2, h);
        g.fillStyle = "rgba(255,224,180,.04)";
        g.fillRect(x + 2, 0, 1, h);
      }
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * IRON STUD — the hammered rivet that pins a panel's corners. One image,
   * placed four times by background-position.
   * ───────────────────────────────────────────────────────────────────────── */
  function stud() {
    return mk(16, 16, function (g) {
      var cx = 8, cy = 8, R = 5.4;
      // seat shadow
      g.beginPath(); g.arc(cx, cy + 0.8, R + 1.1, 0, Math.PI * 2);
      g.fillStyle = "rgba(0,0,0,.42)"; g.fill();
      // dome
      var grd = g.createRadialGradient(cx - 1.8, cy - 2.1, 0.4, cx, cy, R);
      grd.addColorStop(0, "#a49c90");
      grd.addColorStop(0.42, "#6d6558");
      grd.addColorStop(1, "#332c24");
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
      // rim + hammer nick
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
      g.strokeStyle = "rgba(20,16,12,.75)"; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.arc(cx - 1.6, cy - 1.9, 1.25, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,246,228,.55)"; g.fill();
    });
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * ROPE FRAME — a border-image: twisted hemp along all four edges with a
   * knot at each corner. Sliced 16, so the middles repeat; the twist period
   * divides the middle span exactly, so a long edge never shows a splice.
   * ───────────────────────────────────────────────────────────────────────── */
  function ropeFrame() {
    var S = 96, SL = 16, PER = 8;
    return mk(S, S, function (g, w, h) {
      function strand(x, y, ang, len) {
        g.save(); g.translate(x, y); g.rotate(ang);
        var grd = g.createLinearGradient(0, -5, 0, 5);
        grd.addColorStop(0, "#5d4321");
        grd.addColorStop(0.34, "#c9a468");
        grd.addColorStop(0.72, "#8c6733");
        grd.addColorStop(1, "#432f16");
        g.fillStyle = grd;
        for (var i = 0; i < len; i += PER) {
          g.save(); g.translate(i, 0); g.rotate(-0.62);
          g.beginPath(); g.ellipse(0, 0, PER * 0.80, 4.6, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = "rgba(40,28,12,.42)"; g.lineWidth = 0.9; g.stroke();
          g.restore();
        }
        g.restore();
      }
      // four edges, drawn beyond the corners then covered by the knots
      strand(0, SL / 2, 0, S);
      strand(0, S - SL / 2, 0, S);
      strand(SL / 2, 0, Math.PI / 2, S);
      strand(S - SL / 2, 0, Math.PI / 2, S);
      // corner knots
      [[SL / 2, SL / 2], [S - SL / 2, SL / 2], [SL / 2, S - SL / 2], [S - SL / 2, S - SL / 2]].forEach(function (p) {
        var grd = g.createRadialGradient(p[0] - 2, p[1] - 2.4, 0.5, p[0], p[1], 8);
        grd.addColorStop(0, "#d8b478"); grd.addColorStop(0.55, "#9a743c"); grd.addColorStop(1, "#43301a");
        g.beginPath(); g.arc(p[0], p[1], 7.4, 0, Math.PI * 2); g.fillStyle = grd; g.fill();
        g.strokeStyle = "rgba(40,28,12,.55)"; g.lineWidth = 1.1; g.stroke();
      });
    });
  }

  /* ───────────────────────────── generate + publish ───────────────────────── */
  try {
    out.oak      = oak("#7a4f26", "#3e2510", "#b98b4e", 20260802, 32);
    out.oakDark  = oak("#4c2f15", "#22140a", "#7d5227", 771013, 26);
    out.parch    = parchment("#f0e2c0", "rgba(219,187,132,.9)", "rgba(255,251,236,.95)", 4242);
    out.parchDim = parchment("#cec6b4", "rgba(174,166,148,.85)", "rgba(242,238,228,.8)", 5150);
    out.stone    = stone("#9c9384", "#5d564a", "#cfc7b7", 90210);
    out.linen    = linen(31337);
    out.stud     = stud();
    out.rope     = ropeFrame();

    var root = document.documentElement;
    function set(name, url) { root.style.setProperty(name, 'url("' + url + '")'); }
    set("--fs-tex-oak", out.oak);
    set("--fs-tex-oak-dark", out.oakDark);
    set("--fs-tex-parch", out.parch);
    set("--fs-tex-parch-dim", out.parchDim);
    set("--fs-tex-stone", out.stone);
    set("--fs-tex-linen", out.linen);
    set("--fs-stud", out.stud);
    set("--fs-rope", out.rope);
    root.setAttribute("data-fs-skin", "1");

    window.FSSkin = { tex: out, dpr: DPR, ready: true };
  } catch (e) {
    /* flat colours already sit under every textured rule — the UI is fine */
    window.FSSkin = { ready: false, error: String((e && e.message) || e) };
    try { document.documentElement.setAttribute("data-fs-skin", "0"); } catch (_) {}
  }
})();
