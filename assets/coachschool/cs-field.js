/* Coach School field: the 8-bit canvas renderer, camera, chalk overlay, playback and hit-testing.

   ART PROVENANCE. The pixel art below is COPIED (house rule: no shared JS between pages) from
   assets/sunday/sd-reenact.js on the unmerged `scores-8bit` branch at commit bdb314b
   ("Scores: live view keeps up with the game; helmets one solid colour"):
     - colour helpers clamp/rgb/lum/mixHex/onColor/cdist  (from assets/sunday/sd-app.js ~66, 131-143)
     - raRng                                              (~19-29)
     - RA_GLYPHS, RA_BIG, pixW, bigText, bigW, bigLabel   (~1285-1339; pixText was dropped in phase 2)
     - RA_SKEL, RA_RUN, raFig                             (~1349-1492)
     - raSprite (player branch only), raRGB               (~1507-1569)
     - raBallSprite                                       (~1571-1590)
     - raFieldArt                                         (~1638-1748, adapted, see below)
     - raContrast, RA_WHITE, RA_KITS, raGenericKit, raSafeNum, raKit, raShade, raLight,
       RA_SKIN, raNumber, raPalette (team branch only)    (~1750-1887)
     - raPoseAt / RA_HOLD / the player, shadow and ball drawing of raDraw  (~1911-2085, adapted)
   Changes from the source, all on purpose:
     - RA_GLYPHS gains ',', '?', '(' and ')' (phase 1 drew callouts in it). Since phase 2 every word
       a player reads is in the page's body font (the dad: 'the 8 bit text is going to be hard to
       read, we can use normal font'); the pixel fonts draw only yard numbers, end-zone names and
       jersey numbers.
     - raSprite drops the 12-pixel cheerleader/band maps (RA_MAPS); raPalette keeps only the
       team-kit branch (no band, trainers, officials, cheerleaders).
     - raFieldArt paints only the camera's window (no stands, benches, midfield logo or posts:
       the logo was an ESPN CDN fetch, and the camera never shows the rest), at this page's own
       scale: 10 px per yard along the field, 12 across (the source draws 18 and 14) so the full
       53.33-yard width runs down a portrait phone. Offense attacks to the RIGHT. (Phase 1 drew
       8 across; phase 2 raised it to 12 so the 1.5-yard line splits clear a crouched sprite.)
     - raPoseAt / facing are made pure functions of t (the source keeps a sticky `a.face`), so
       scrubbing backwards draws the same frame as playing forwards.
   Everything else (camera, chalk, playback, hit-testing) is new. Positions come only from
   CS.poseAt (cs-core.js); this file never moves a player itself. */
(function (root) {
  'use strict';
  const CS = root.CS;

  /* ═════ copied: colour helpers (sd-app.js) ═════ */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lum(h) {
    const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const [r, g, b] = rgb(h);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function mixHex(a, b, t) {
    const A = rgb(a), B = rgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  const onColor = (h) => (lum(h) > 0.42 ? '#111111' : '#ffffff');
  const cdist = (a, b) => { const A = rgb(a), B = rgb(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
  function raRng(seed) {
    let a = 7;
    for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ═════ this page's camera ═════ */
  const K = 1;                       // the art's pixel (the source's RA_K, which was 2)
  // World pixels per yard ALONG the field (screen-horizontal). 14, not phase 1's 10: the defensive
  // line sets up 1 yd off the ball (fact sheet 1c), and at 10 px a lineman's helmet and his
  // opponent's met in the middle and the two lines read as one heap.
  const PX = 14;
  // World pixels per yard ACROSS the field (screen-vertical). The offensive line stands 1.5 yd
  // apart (fact sheet 1a) and a lineman in his stance is 17 px tall (RA_SKEL.stance: head centre
  // 11.5 up, radius ~3.6, plus the outline row). Phase 1 drew 8 (12 px apart: a pile). 15 puts
  // 22.5 px between linemen, so each helmet sits clear below the feet of the man above him with
  // 5 px of turf between. The field is taller than the phone's width allows at full scale; the
  // page fits it to the space left by the panel (fit() below), and the puzzle screen, whose
  // panel is short, gives it most of the screen.
  const PY = 15;
  const HK = 6;                      // world pixels per yard of height (the ball in the air)
  const Y0 = CS.VIEW.Y0, Y1 = CS.VIEW.Y1;   // the window, in yards from the line of scrimmage (28.6 yd; cs-core owns it)
  const MT = 22, MB = 14;            // turf above the far (offense's left) sideline / below the near one
  const FH = Math.round(CS.FIELD_W * PY);
  const W = Math.round((Y1 - Y0) * PX); // 400
  const H = MT + FH + MB;            // 836
  const wx = (y) => (y - Y0) * PX;   // yards from the LOS -> world x
  const wy = (x) => MT + x * PY;     // yards across -> world y
  const HIT_R = 24;                  // CSS px around a player's body axis that count as tapping him

  /* ═════ copied: pixel fonts ═════ */
  const RA_GLYPHS = {
    0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001011001111', 4: '101101111001001',
    5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
    F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
    K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
    P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
    Z: '111001010100111', '#': '101111101111101', '-': '000000111000000', '+': '000010111010000', '.': '000000000000010',
    "'": '010010000000000', '&': '010101010101011', '/': '001001010100100', '!': '010010010000010', ':': '000010000010000',
    // added for Coach School's callouts
    ',': '000000000010100', '?': '111001011000010', '(': '010100100100010', ')': '010001001001010',
  };
  const RA_BIG = {
    0: '.###.#...##..###.#.###..##...#.###.', 1: '..#...##....#....#....#....#...###.', 2: '.###.#...#....#...#...#...#...#####',
    3: '####.....#....#.###.....#....#####.', 4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.',
    6: '..##..#...#....####.#...##...#.###.', 7: '#####....#...#...#...#....#....#...', 8: '.###.#...##...#.###.#...##...#.###.',
    9: '.###.#...##...#.####....#...#..##..',
    A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.',
    D: '####.#...##...##...##...##...#####.', E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
    G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#', I: '.###...#....#....#....#....#...###.',
    J: '..###...#....#....#....##..#..##...', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
    M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.',
    P: '####.#...##...#####.#....#....#....', Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
    S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', U: '#...##...##...##...##...##...#.###.',
    V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
    Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####', '&': '.##..#..#..##...#...#.#.##..#..##.#',
  };
  const pixW = (s, k = 1) => String(s).length * 4 * k - k;
  function bigText(g, s, x, y, col, k = 1) {
    g.fillStyle = col;
    let cx = x;
    for (const ch of String(s).toUpperCase()) {
      const gl = RA_BIG[ch];
      if (gl) for (let i = 0; i < 35; i++) if (gl[i] === '#') g.fillRect(cx + (i % 5) * k, y + Math.floor(i / 5) * k, k, k);
      cx += 6 * k;
    }
  }
  const bigW = (s, k = 1) => String(s).length * 6 * k - k;
  function bigLabel(s, k, col, shadow) {
    const c = document.createElement('canvas');
    c.width = bigW(s, k) + k; c.height = 7 * k + k;
    const g = c.getContext('2d');
    bigText(g, s, k, k, shadow, k);
    bigText(g, s, 0, 0, col, k);
    return c;
  }

  /* ═════ copied: players (skeleton poses rasterised to shaded 34x40 sprites) ═════ */
  const RA_SKEL = {
    stand:  { h: [0, 15], s: [0.6, 23.5], c: [1.4, 29], fa: [[2.2, 22.5], [3.4, 17.5], [3.6, 13]], ba: [[-2.2, 22.5], [-3.2, 17.5], [-3.2, 13]], fl: [[1.3, 15], [2, 8.5], [2.1, 2]], bl: [[-1.3, 15], [-2, 8.5], [-2.3, 2]] },
    run1:   { h: [0, 14.5], s: [1.8, 22.8], c: [3, 28.2], fa: [[2.3, 21.8], [-0.2, 18.2], [-1.5, 14.8]], ba: [[1.2, 21.8], [3.6, 18.5], [5.6, 20.5]], fl: [[0.5, 14.5], [4, 9.5], [5.5, 3]], bl: [[-0.5, 14.5], [-2.5, 8.5], [-6, 5]], bf: [-0.3, -1] },
    run2:   { h: [0, 15.5], s: [1.8, 23.8], c: [3, 29.2], fa: [[2.3, 22.8], [1.8, 18], [3.4, 15.5]], ba: [[1.2, 22.8], [0.5, 18.2], [1.8, 15.8]], fl: [[0.5, 15.5], [0.8, 9], [-1.5, 3.5]], bl: [[-0.5, 15.5], [2.8, 11], [0.8, 6.5]], ff: [0.6, -0.8] },
    stance: { h: [-3, 11.5], s: [4.5, 13.5], c: [8.5, 15], fa: [[4.5, 12.5], [5.5, 7], [6, 1.2]], ba: [[3.5, 12.5], [1.5, 9.5], [0, 8]], fl: [[-2.5, 11.5], [1.5, 6], [-0.5, 1.5]], bl: [[-3.5, 11.5], [-5, 5.5], [-6.5, 1.5]], noNum: 1 },
    snap:   { h: [-3, 11.5], s: [4.5, 13.2], c: [8.2, 14.8], fa: [[4.5, 12.5], [6.2, 7.5], [7.2, 2]], ba: [[3.8, 12.5], [5.5, 7.5], [6.4, 2.2]], fl: [[-2.5, 11.5], [0.5, 6], [0, 1.5]], bl: [[-3.5, 11.5], [-4, 6], [-4.5, 1.5]], noNum: 1 },
    ready:  { h: [-1.5, 12.5], s: [2.2, 20], c: [3.8, 25.4], fa: [[2.8, 19.2], [3.8, 14.8], [3.2, 10]], ba: [[1.5, 19.2], [2, 14.8], [1.6, 10]], fl: [[-1, 12.5], [2.2, 7.5], [1.2, 2]], bl: [[-2, 12.5], [-1, 7], [-3, 2]] },
    qbUnder:{ h: [-1.5, 12], s: [2, 19.5], c: [3.6, 24.9], fa: [[2.6, 18.6], [4.8, 15.2], [6.2, 12.6]], ba: [[1.6, 18.6], [3.8, 15], [5.6, 12.2]], fl: [[-1, 12], [1.8, 7.2], [0.8, 2]], bl: [[-2, 12], [-1.2, 6.8], [-3.2, 2]] },
    gun:    { h: [0, 14], s: [1.2, 22.2], c: [2.2, 27.7], fa: [[1.8, 21.2], [3, 17.5], [4.8, 17.8]], ba: [[1, 21.2], [2.3, 17.2], [4.3, 17.4]], fl: [[0.5, 14], [1.8, 8], [1.2, 2]], bl: [[-0.5, 14], [-1.2, 8], [-2, 2]] },
    throw1: { h: [0, 14.5], s: [-0.5, 22.6], c: [0.6, 28.1], fa: [[0, 22], [3, 21.5], [5.6, 22]], ba: [[-1, 22], [-3.6, 24], [-3.2, 28.5]], fl: [[0.6, 14.5], [3.2, 8.5], [4.2, 2]], bl: [[-0.6, 14.5], [-2.6, 8.5], [-4.2, 2]] },
    throw2: { h: [0.6, 14.5], s: [2.6, 22.4], c: [3.9, 27.7], fa: [[2.4, 21.5], [0.2, 18.5], [-1.4, 16.4]], ba: [[2.6, 21.5], [5.4, 20], [6.6, 16.8]], fl: [[1.2, 14.5], [3.8, 8.5], [4.6, 2]], bl: [[0, 14.5], [-1.6, 8.3], [-3.6, 3]], bf: [0.3, -1] },
    catch:  { h: [0, 15], s: [0.8, 23.4], c: [1.6, 28.9], fa: [[1.4, 22.5], [3.4, 26.5], [5.2, 30.2]], ba: [[0.6, 22.5], [2.8, 26.8], [4.4, 30.8]], fl: [[0.6, 15], [2.4, 8.5], [2.2, 2]], bl: [[-0.6, 15], [-2, 8.5], [-3.4, 2.5]] },
    block:  { h: [-1, 12.8], s: [3, 19.5], c: [5, 24], fa: [[3.4, 18.6], [5.8, 17.5], [8, 17.8]], ba: [[2.6, 18.6], [5, 16.8], [7.4, 17]], fl: [[-0.5, 12.8], [2.2, 7.5], [1.2, 2]], bl: [[-1.5, 12.8], [-3.2, 7.3], [-5.2, 2]] },
    down:   { h: [-4, 3.5], s: [4, 3.8], c: [8.4, 4.4], fa: [[4.5, 3.5], [8, 2.2], [11.5, 2]], ba: [[3.5, 4], [6.8, 3.5], [10, 3.5]], fl: [[-4, 3.2], [-8.5, 2.4], [-12.5, 2]], bl: [[-4, 3.8], [-8.8, 3.4], [-12.8, 3.4]], ff: [-0.2, -1], bf: [-0.2, -1], noNum: 1 },
  };
  RA_SKEL.run3 = { ...RA_SKEL.run1, fa: RA_SKEL.run1.ba, ba: RA_SKEL.run1.fa, fl: RA_SKEL.run1.bl, bl: RA_SKEL.run1.fl, ff: RA_SKEL.run1.bf, bf: RA_SKEL.run1.ff };
  RA_SKEL.run4 = { ...RA_SKEL.run2, fa: RA_SKEL.run2.ba, ba: RA_SKEL.run2.fa, fl: RA_SKEL.run2.bl, bl: RA_SKEL.run2.fl, ff: RA_SKEL.run2.bf, bf: RA_SKEL.run2.ff };
  const RA_RUN = ['run1', 'run2', 'run3', 'run4'];
  const RA_FW = 34, RA_FH = 40, RA_FAX = 17, RA_FAY = 38;   // sprite grid; the feet stand on (17, 38)
  const RA_FIG = new Map();
  function raFig(pose, variant = 'p') {
    const key = pose + '|' + variant;
    let f = RA_FIG.get(key);
    if (f) return f;
    const LY = [[0, 0], [2, 2], [8.5, 6.9], [15, 12.4], [23.5, 23], [29, 28.3], [40, 39]];
    const ry = (y) => { for (let i = 1; i < LY.length; i++) if (y <= LY[i][0]) { const [a, b] = LY[i - 1], [c, d] = LY[i]; return b + (d - b) * (y - a) / (c - a); } return y; };
    const S0 = RA_SKEL[pose] || RA_SKEL.stand, S = {};
    for (const [k, v] of Object.entries(S0)) S[k] = !Array.isArray(v) || k === 'ff' || k === 'bf' ? v : Array.isArray(v[0]) ? v.map(([x, y]) => [x, ry(y)]) : [v[0], ry(v[1])];
    const W = RA_FW, H = RA_FH, AX = RA_FAX, AY = RA_FAY;
    const g = new Array(W * H).fill('.');
    const Lx = 0.5, Ly = 0.866;
    const tone = (d, t) => (d > 0.42 ? t[2] : d < -0.3 ? t[1] : t[0]);
    const paint = (fn) => {
      for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx, v = fn(gx + 0.5 - AX, AY - gy - 0.5);
        if (v === 1) { if (g[i] !== '.') g[i] = 'O'; } else if (v) g[i] = v;
      }
    };
    const near = (x, y, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], u = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      return [x - a[0] - dx * u, y - a[1] - dy * u];
    };
    const limb = (a, b, r, t, edge) => paint((x, y) => {
      const [dx, dy] = near(x, y, a, b), d = Math.hypot(dx, dy);
      if (d <= r) return tone((dx * Lx + dy * Ly) / r, t);
      return edge && d <= r + 0.9 ? 1 : 0;
    });
    const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const TJ = ['J', 'j', 'L'], TP = ['P', 'p', 'Q'], TS = ['S', 's', 'S'], TF = ['F', 'f', 'E'], TB = ['B', 'B', 'b'];
    const back = (t) => [t[1], t[1], t[0]];
    const arm = (A, far) => {
      const [sh, el, hd] = A, mid = lerp(sh, el, 0.8);
      limb(sh, mid, 1.85, far ? back(TJ) : TJ, !far);
      limb(mid, el, 1.45, far ? back(TF) : TF, !far);
      limb(el, hd, 1.3, far ? back(TF) : TF, !far);
      limb(hd, hd, 1.45, far ? back(TF) : TF, false);
    };
    const leg = (A, fd, far) => {
      const [hp, kn, an] = A;
      const dir = fd || [1, 0], dl = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / dl, uy = dir[1] / dl;
      const sole = [-uy * 0.55, ux * 0.55];
      limb([an[0] - ux * 0.7 - sole[0], an[1] - uy * 0.7 - sole[1]], [an[0] + ux * 2.6 - sole[0], an[1] + uy * 2.6 - sole[1]], 1.15, far ? ['B', 'B', 'B'] : TB, !far);
      limb(kn, an, 1.75, far ? back(TS) : TS, !far);
      limb(hp, lerp(kn, an, 0.22), 2.7, far ? back(TP) : TP, !far);
    };
    arm(S.ba, true);
    leg(S.bl, S.bf, true);
    limb(S.h, S.h, 3.6, TP, false);
    {
      const [hx, hy] = S.h, [sx, sy] = S.s, ax = sx - hx, ay = sy - hy, len = Math.hypot(ax, ay) || 1;
      const ux = ax / len, uy = ay / len, px = uy, py = -ux;
      paint((x, y) => {
        const rx = x - hx, ry = y - hy, v = (rx * ux + ry * uy) / len, u = rx * px + ry * py;
        if (v < -0.12 || v > 1.14) return 0;
        let hw = 4.5 + 2.2 * clamp(v, 0, 1);
        if (v > 0.84) hw *= 1 - Math.pow((v - 0.84) / 0.3, 2) * 0.6;
        if (v < 0) hw *= 1 + v * 2.5;
        if (Math.abs(u) > hw) return 0;
        return tone((u / hw) * 0.75 + (v - 0.45) * 0.6, v < 0.1 ? TP : TJ);
      });
    }
    leg(S.fl, S.ff, false);
    limb(lerp(S.s, S.c, 0.25), lerp(S.s, S.c, 0.6), 1.7, TF, false);
    {
      const [cx, cy] = S.c;
      paint((x, y) => {
        const lx = x - cx, ly = y - cy, nx = lx / 4.6, ny = ly / 4.3, d = Math.hypot(nx, ny);
        if (lx > 3.3 && lx < 5.7 && ly > -3.7 && ly < 0.6 && (lx > 4.7 || (ly > -1.7 && ly < -0.8) || ly < -2.9)) return 'm';
        if (d > 1) return d <= 1.22 ? 1 : 0;
        if (lx > 1.2 && lx < 4.1 && ly > -3.3 && ly < 0.6) return lx > 2.1 && lx < 3.1 && ly > -0.6 && ly < 0.4 ? 'e' : ly < -2 ? 'f' : 'F';
        return 'H';                                   // one solid shell colour (source, 2026-09-28)
      });
    }
    arm(S.fa, false);
    const out = g.slice();
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const i = gy * W + gx;
      if (g[i] !== '.') continue;
      if ((gx > 0 && g[i - 1] !== '.') || (gx < W - 1 && g[i + 1] !== '.') || (gy > 0 && g[i - W] !== '.') || (gy < H - 1 && g[i + W] !== '.')) out[i] = 'O';
    }
    let num = null;
    if (!S.noNum) { const c = lerp(S.h, S.s, 0.58); num = [Math.round(AX + c[0] - 0.9), Math.round(AY - c[1] - 2.5)]; }
    f = { g: out, W, H, ax: AX, ay: AY, num };
    RA_FIG.set(key, f);
    return f;
  }
  const RA_SPR = new Map();
  const raRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function raSprite(pose, pal, flip, num) {
    const key = pose + '|' + (pal.variant || 'p') + '|' + (pal.key || (pal.key = Object.entries(pal).filter(([k]) => k.length === 1).map((e) => e.join(':')).join())) + '|' + (flip ? 1 : 0) + '|' + (num == null ? '' : num);
    let c = RA_SPR.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    const g = c.getContext('2d');
    const f = raFig(pose, pal.variant);
    c.width = f.W; c.height = f.H;
    const img = g.createImageData(f.W, f.H), d = img.data;
    const rgbm = pal.rgb || (pal.rgb = Object.fromEntries(Object.entries(pal).filter(([k, v]) => k.length === 1 && typeof v === 'string').map(([k, v]) => [k, raRGB(v)])));
    const set = (x, y, col) => { const i = (y * f.W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const ch = f.g[y * f.W + x];
      if (ch === '.') continue;
      const col = rgbm[ch] || [255, 0, 255];
      set(flip ? f.W - 1 - x : x, y, col);
    }
    if (num != null && f.num && rgbm.n) {
      const s = String(num), w = s.length * 4 - 1;
      const x0 = f.num[0] - Math.floor(w / 2), fx0 = flip ? f.W - (x0 + w) : x0;
      for (let k = 0; k < s.length; k++) {
        const gl = RA_GLYPHS[s[k]];
        for (let i = 0; i < 15; i++) {
          if (gl[i] !== '1') continue;
          const fx = fx0 + k * 4 + (i % 3), y = f.num[1] + Math.floor(i / 3);
          const sx = flip ? f.W - 1 - fx : fx, ch = f.g[y * f.W + sx];
          if (ch === 'J' || ch === 'j' || ch === 'L') set(fx, y, rgbm.n);
        }
      }
    }
    g.putImageData(img, 0, 0);
    c.ax = flip ? f.W - f.ax : f.ax; c.ay = f.ay;
    // The painted pixels' box (sprite pixels), for hit-testing what the eye actually sees.
    let x0 = f.W, y0 = f.H, x1 = -1, y1 = -1;
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) if (d[(y * f.W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    c.bb = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    RA_SPR.set(key, c);
    return c;
  }
  const RA_BALL = [];
  function raBallSprite(k) {
    if (RA_BALL[k]) return RA_BALL[k];
    const S = 16, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const ang = (k * Math.PI) / 8, cs = Math.cos(ang), sn = Math.sin(ang), A = 4.8, B = 2.9;
    const inside = (x, y) => { const u = x * cs + y * sn, v = -x * sn + y * cs; return (u / A) ** 2 + (v / B) ** 2 <= 1; };
    const put = (i, c3) => { d[i] = c3[0]; d[i + 1] = c3[1]; d[i + 2] = c3[2]; d[i + 3] = 255; };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const px = x + 0.5 - S / 2, py = y + 0.5 - S / 2, i = (y * S + x) * 4;
      if (inside(px, py)) {
        const u = px * cs + py * sn, v = -px * sn + py * cs;
        const lace = Math.abs(u) < 2 && v < -B * 0.25 && v > -B * 0.85 && (Math.abs(u) < 0.5 || Math.floor(u + 2) % 2 === 0);
        put(i, lace ? [244, 238, 226] : py < -1.2 ? [184, 104, 50] : py > 1.2 ? [92, 42, 14] : [140, 70, 26]);
      } else if (inside(px - 1, py) || inside(px + 1, py) || inside(px, py - 1) || inside(px, py + 1)) put(i, [16, 10, 6]);
    }
    g.putImageData(img, 0, 0);
    return (RA_BALL[k] = c);
  }

  /* ═════ copied: kits and palettes ═════ */
  const raContrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const RA_WHITE = '#f2f2f0';
  // Real 2026-season primary home and road uniforms (researched for the Scores page 2026-09-28;
  // sources per team in that branch's docs/sunday.md).
  const RA_KITS = {
    ARI: { home: { jersey: '#97233F', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#97233F', helmet: '#f2f2f0', num: '#97233F' } },
    ATL: { home: { jersey: '#A71930', pants: '#FFFFFF', helmet: '#101820', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#101820', num: '#A71930' } },
    BAL: { home: { jersey: '#241773', pants: '#241773', helmet: '#101014', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#101014', num: '#241773' } },
    BUF: { home: { jersey: '#00338D', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#00338D', helmet: '#f2f2f0', num: '#00338D' } },
    CAR: { home: { jersey: '#101820', pants: '#FFFFFF', helmet: '#a5acaf', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#a5acaf', num: '#101820' } },
    CHI: { home: { jersey: '#0B162A', pants: '#FFFFFF', helmet: '#0b162a', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#0B162A', helmet: '#0b162a', num: '#0B162A' } },
    CIN: { home: { jersey: '#101820', pants: '#101820', helmet: '#101014', num: '#FB4F14' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#101014', num: '#101820' } },
    CLE: { home: { jersey: '#311D00', pants: '#FFFFFF', helmet: '#ff3c00', num: '#FF3C00' }, road: { jersey: '#FFFFFF', pants: '#311D00', helmet: '#ff3c00', num: '#311D00' } },
    DAL: { home: { jersey: '#FFFFFF', pants: '#8a98a8', helmet: '#8a98a8', num: '#002244' }, road: { jersey: '#002244', pants: '#8a98a8', helmet: '#8a98a8', num: '#FFFFFF' }, homeWhite: true },
    DEN: { home: { jersey: '#FB4F14', pants: '#FFFFFF', helmet: '#0a2343', num: '#0a2343' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#0a2343', num: '#FB4F14' } },
    DET: { home: { jersey: '#0076B6', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#0076B6' } },
    GB: { home: { jersey: '#203731', pants: '#ffb612', helmet: '#ffb612', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#ffb612', helmet: '#ffb612', num: '#203731' } },
    HOU: { home: { jersey: '#03202f', pants: '#FFFFFF', helmet: '#03202f', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#03202f', helmet: '#03202f', num: '#03202f' } },
    IND: { home: { jersey: '#002C5F', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#002C5F', helmet: '#f2f2f0', num: '#002C5F' } },
    JAX: { home: { jersey: '#006778', pants: '#101820', helmet: '#101820', num: '#D7A22A' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#101820', num: '#101820' } },
    KC: { home: { jersey: '#E31837', pants: '#FFFFFF', helmet: '#e31837', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#E31837', helmet: '#e31837', num: '#E31837' } },
    LV: { home: { jersey: '#101820', pants: '#101820', helmet: '#a5acaf', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#a5acaf', num: '#101820' } },
    LAC: { home: { jersey: '#0080C6', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFC20E' }, road: { jersey: '#FFFFFF', pants: '#002A5E', helmet: '#f2f2f0', num: '#0080C6' } },
    LAR: { home: { jersey: '#003594', pants: '#FFFFFF', helmet: '#003594', num: '#FFD100' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#003594', num: '#003594' } },
    MIA: { home: { jersey: '#008E97', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#008E97', helmet: '#f2f2f0', num: '#008E97' } },
    MIN: { home: { jersey: '#4F2683', pants: '#FFFFFF', helmet: '#4f2683', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#4F2683', helmet: '#4f2683', num: '#4F2683' } },
    NE: { home: { jersey: '#002244', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#002244' } },
    NO: { home: { jersey: '#101820', pants: '#101820', helmet: '#d3bc8d', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#d3bc8d', num: '#101820' } },
    NYG: { home: { jersey: '#0B2265', pants: '#FFFFFF', helmet: '#0b2265', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#0b2265', num: '#0B2265' } },
    NYJ: { home: { jersey: '#115740', pants: '#FFFFFF', helmet: '#115740', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#115740', helmet: '#115740', num: '#115740' } },
    PHI: { home: { jersey: '#004C54', pants: '#FFFFFF', helmet: '#004c54', num: '#A5ACAF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#004c54', num: '#004C54' } },
    PIT: { home: { jersey: '#000000', pants: '#FFB612', helmet: '#101014', num: '#FFB612' }, road: { jersey: '#FFFFFF', pants: '#000000', helmet: '#101014', num: '#000000' } },
    SF: { home: { jersey: '#AA0000', pants: '#b3995d', helmet: '#b3995d', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b3995d', helmet: '#b3995d', num: '#AA0000' } },
    SEA: { home: { jersey: '#002244', pants: '#002244', helmet: '#002244', num: '#69BE28' }, road: { jersey: '#FFFFFF', pants: '#002244', helmet: '#002244', num: '#002244' } },
    TB: { home: { jersey: '#D50A0A', pants: '#3d3935', helmet: '#3d3935', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#3d3935', helmet: '#3d3935', num: '#D50A0A' } },
    TEN: { home: { jersey: '#4495D2', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#4495D2' } },
    WSH: { home: { jersey: '#5A1414', pants: '#FFB612', helmet: '#5a1414', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFB612', helmet: '#5a1414', num: '#5A1414' } },
  };
  function raGenericKit(t, home) {
    const prim = t.color, alt = t.alt, H = prim;
    const J = home ? prim : RA_WHITE, P = home ? RA_WHITE : prim;
    const n = home ? (raContrast(prim, '#ffffff') >= raContrast(prim, alt) ? '#ffffff' : alt)
      : raContrast(prim, RA_WHITE) >= 2.2 ? prim : raContrast(alt, RA_WHITE) >= 2.2 ? alt : '#1a1a1a';
    return { J, P, H, n };
  }
  const raSafeNum = (num, jersey) => (raContrast(num, jersey) >= 2.2 ? num
    : raContrast('#ffffff', jersey) >= 2.2 ? '#ffffff' : raContrast('#111111', jersey) >= 2.2 ? '#111111' : num);
  function raKit(homeT, roadT) {
    const upH = (homeT.abbr || '').toUpperCase(), upR = (roadT.abbr || '').toUpperCase();
    const KH = RA_KITS[upH], KR = RA_KITS[upR];
    const toEntry = (e) => ({ J: e.jersey, P: e.pants, H: e.helmet, n: raSafeNum(e.num, e.jersey) });
    const home = KH ? toEntry(KH.home) : raGenericKit(homeT, true);
    let road = KR ? toEntry(KR.road) : raGenericKit(roadT, false);
    if (cdist(home.J, road.J) < 40) {
      const swap = KR ? toEntry(KR.home) : raGenericKit(roadT, true);
      if (cdist(home.J, swap.J) >= 40) road = swap;
    }
    const brand = (t, k) => (k ? k.home.jersey : t.color);
    const withExtras = (e, t, k) => ({ ...e, w: [t.alt, e.J, '#ffffff', '#111111'].find((c) => raContrast(c, e.H) >= 1.9) || '#ffffff', S: brand(t, k) });
    return { home: withExtras(home, homeT, KH), road: withExtras(road, roadT, KR) };
  }
  const raShade = (c) => mixHex(c, '#0a0c18', lum(c) > 0.6 ? 0.26 : 0.42);
  const raLight = (c) => (lum(c) > 0.6 ? '#ffffff' : mixHex(c, '#ffffff', lum(c) < 0.03 ? 0.22 : 0.3));
  const RA_SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#6b4226'];
  function raNumber(role, seed) {
    const r = raRng(seed)();
    const pickIn = (ranges) => { const all = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)); return all[Math.floor(r * all.length)]; };
    return pickIn({ QB: [[1, 19]], K: [[1, 19]], RB: [[20, 39]], FB: [[40, 49]], WR: [[10, 19], [80, 88]], TE: [[80, 89]], OL: [[60, 79]], DL: [[90, 99], [50, 59]], LB: [[40, 58]], DB: [[20, 39]] }[role] || [[10, 99]]);
  }
  // raPalette's team branch, taking the kit directly instead of the scene.
  function raPalette(kit, idx, side) {
    const F = RA_SKIN[(idx * 7 + (side === 'o' ? 1 : 3)) % RA_SKIN.length];
    const { J, P, H, S } = kit;
    return {
      J, j: raShade(J), L: raLight(J), P, p: raShade(P), Q: raLight(P), H, h: raShade(H), l: raLight(H), w: kit.w,
      m: raContrast('#9aa0a8', H) < 1.6 ? '#2b2f38' : '#9aa0a8', F, f: raShade(F), E: raLight(F), S, s: raShade(S),
      B: '#17181d', b: '#44464e', e: '#141414', n: kit.n, O: '#0d0e13',
    };
  }
  // Where the ball sits in a man's hands, by pose (sprite pixels, facing right, up from the ground).
  const RA_HOLD = { stand: [4, 16], run1: [4.5, 16], run2: [4.5, 17], run3: [4.5, 16], run4: [4.5, 17], gun: [5, 17.6], qbUnder: [6.4, 12.6], throw1: [-3.4, 29], throw2: [6.8, 17],
    catch: [5, 31], down: [11.5, 3], snap: [8, 1.6], block: [6, 17], ready: [4, 11], stance: [6.5, 1.4] };

  /* ═════ adapted: the field (raFieldArt), painted for one window ═════ */
  const ART = new Map();
  function fieldArt(spot, offT, defT) {
    const key = [spot, offT.abbr, defT.abbr].join('|');
    if (ART.has(key)) return ART.get(key);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const rng = raRng('field' + offT.abbr + defT.abbr);
    const f0 = MT, f1 = MT + FH;
    const hx = (Ha) => Math.round(wx(Ha - spot));             // absolute yard line (0 = offense's goal) -> world x
    g.fillStyle = '#1d7a2a'; g.fillRect(0, 0, W, H);
    for (let Ha = -10; Ha < 110; Ha += 5) {
      g.fillStyle = (Ha / 5) % 2 ? '#248f30' : '#21862d';
      g.fillRect(hx(Ha), f0, hx(Ha + 5) - hx(Ha), FH);
    }
    for (let i = 0; i < (W * FH * 0.035); i++) {
      g.fillStyle = rng() < 0.55 ? 'rgba(0,40,0,0.18)' : 'rgba(120,200,110,0.12)';
      g.fillRect(Math.floor(rng() * W), f0 + Math.floor(rng() * FH), K, rng() < 0.3 ? K : K / 2);
    }
    g.fillStyle = 'rgba(255,255,255,0.55)';                   // the coaching-box dashes outside the sidelines
    for (let x = 0; x < W; x += 6 * K) { g.fillRect(x, f1 + 6 * K, 3 * K, K); g.fillRect(x, f0 - 7 * K, 3 * K, K); }
    const zone = (Ha, Hb, col, t, rot) => {
      const x0 = hx(Ha), w = hx(Hb) - x0;
      if (x0 > W || x0 + w < 0) return;
      g.fillStyle = col; g.fillRect(x0, f0, w, FH);
      g.fillStyle = mixHex(col, '#000000', 0.16);
      for (let y = f0; y < f1; y += 6 * K) g.fillRect(x0, y, w, 2 * K);
      let word = (t.name || t.abbr || '').toUpperCase().replace(/[^A-Z& ]/g, '');
      if (word.length > 11) word = (t.abbr || '').toUpperCase();
      const ink = onColor(col) === '#ffffff' ? '#ffffff' : '#141414';
      const lab = bigLabel(word, 3 * K, ink, ink === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.45)');
      g.save(); g.translate(x0 + w / 2, f0 + FH / 2); g.rotate(rot);
      g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2)); g.restore();
    };
    zone(-10, 0, offT.color, offT, -Math.PI / 2);
    zone(100, 110, defT.color, defT, Math.PI / 2);
    g.fillStyle = '#ffffff';
    g.fillRect(0, f0, W, 2 * K);
    g.fillRect(0, f1 - 2 * K, W, 2 * K);
    for (let Ha = 0; Ha <= 100; Ha += 5) g.fillRect(hx(Ha), f0, Ha % 100 === 0 ? 2 * K : K, FH);
    for (let Ha = 1; Ha < 100; Ha++) {
      if (Ha % 5 === 0) continue;
      const x = hx(Ha);
      for (const yy of [2, CS.HASH_L, CS.HASH_R, CS.FIELD_W - 2]) g.fillRect(x, Math.round(wy(yy)) - K, K, 3 * K);
    }
    // Yard numbers, the far side's upside down as on a real field, and the arrow to the nearer goal.
    // NFL numerals span 12-14 yd in from each sideline, bottoms (the edge facing the sideline) at
    // 12 yd (fact-check 2026-11-11). The source drew them 9-11 yd in; this copy moves them only
    // here. The label is 24 px tall (1.6 yd at PY 15): near side with its bottom at x 41.33, far
    // side centred on x 13 and turned 180 degrees so its bottom faces the far sideline.
    for (let Ha = 10; Ha <= 90; Ha += 10) {
      const n = String(Ha <= 50 ? Ha : 100 - Ha), x = hx(Ha);
      const lab = bigLabel(n, 3 * K, '#f7f7f7', '#123d8a');
      const nearY = Math.round(wy(CS.FIELD_W - 12)) - lab.height;   // bottom edge 12 yd from the near sideline
      g.drawImage(lab, x - Math.floor(lab.width / 2), nearY);
      g.save(); g.translate(x, Math.round(wy(13))); g.rotate(Math.PI);
      g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2)); g.restore();
      const dir = Ha < 50 ? -1 : Ha > 50 ? 1 : 0;
      if (dir) { g.fillStyle = '#f7f7f7'; const ax = x + dir * (lab.width / 2 + 4 * K), ay = nearY + Math.floor(lab.height / 2) - 2 * K; g.fillRect(ax, ay, K, 3 * K); g.fillRect(ax + dir * K, ay + K, K, K); }
    }
    ART.set(key, c);
    return c;
  }

  /* ═════ new: renderer, chalk, playback, hit-testing ═════ */
  const ROLE = { C: 'OL', G: 'OL', T: 'OL', DE: 'DL', DT: 'DL', NT: 'DL', LB: 'LB', CB: 'DB', S: 'DB', NB: 'DB', QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE' };
  function setPose(p) {
    if (p.pos === 'C') return 'snap';
    if (CS.OL.includes(p.pos) || CS.DL.includes(p.pos)) return 'stance';
    if (p.pos === 'TE' && p.y >= CS.ON_LINE_Y) return 'stance';
    if (p.pos === 'QB') return p.y <= -3 ? 'gun' : 'qbUnder';
    return 'ready';
  }
  // The source's raPoseAt, made pure in t.
  function poseOf(c, p, t, speed, phase) {
    if (t <= c.snapT) return setPose(p);
    if (c.downT != null && p.id === c.target && t > c.downT + 0.1) return 'down';
    if (p === c.qb && c.throwT != null && t >= c.throwT - 0.38 && t < c.throwT + 0.32) return t < c.throwT - 0.02 ? 'throw1' : 'throw2';
    if (p.id === c.target && c.catchT != null && t >= c.catchT - 0.28 && t < c.catchT + 0.12) return 'catch';
    const blocker = p.role === 'block' || p.role === 'rush';
    if (blocker && speed < 3.2 && t < c.T) return 'block';
    if (speed > 0.8) return RA_RUN[Math.floor(t * (speed < 3.5 ? 5 : speed < 7 ? 8 : 10.5) + phase * 4) % 4];
    return 'stand';
  }

  // Chalk route: the designed polyline (plus 3 yd past the last point when the route runs on).
  function chalkRoute(p) {
    const pts = p.path.pts.map((q) => q.slice());
    if (p.path.ext && pts.length > 1) {
      const a = pts[pts.length - 2], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      pts.push([b[0] + (b[0] - a[0]) * 3 / L, b[1] + (b[1] - a[1]) * 3 / L]);
    }
    return pts;
  }
  function polyCut(pts, d) {           // the first d yards of a polyline, and the rest
    const run = [pts[0]], rest = [];
    let left = d, cut = false;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!cut && left >= L) { run.push(b); left -= L; continue; }
      if (!cut) { const u = L ? left / L : 0, m = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; run.push(m); rest.push(m); cut = true; }
      rest.push(b);
    }
    return { run, rest };
  }
  CS.mountField = function mountField(canvas, opts) {
    opts = opts || {};
    const g = canvas.getContext('2d');
    canvas.width = W; canvas.height = H;
    const reduceMQ = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const reduced = () => !!(reduceMQ && reduceMQ.matches);
    const FULL = { cx: W / 2, cy: H / 2, z: 1 };
    const st = { play: null, c: null, t: 0, playing: false, speed: 1, raf: 0, last: 0, acc: 0, kits: null, art: null, pal: {}, nums: {}, drawn: {}, marks: [], callout: true,
      cam: { ...FULL }, camA: null, say: null, sayN: 0, shown: 0, place: null, note: null, geom: null, bw: 0, bh: 0 };
    const PRE = -1.2;
    const CAM_MS = 480;                  // the camera's ease in or out (the brief: 400-600 ms)
    const bubbleEl = opts.bubbleEl || null, tailsEl = opts.tailsEl || null;

    function setPlay(play, o) {
      o = o || {};
      if (st.playing) pause();
      st.play = play;
      st.c = CS.compile(play);
      const lib = CS.lib, off = lib.TEAMS[play.teams.off], def = lib.TEAMS[play.teams.def];
      const offHome = play.home !== 'def';
      const kits = raKit(offHome ? off : def, offHome ? def : off);
      st.kit = { off: offHome ? kits.home : kits.road, def: offHome ? kits.road : kits.home };
      st.art = fieldArt(CS.num(play.spot, 25), off, def);
      st.pal = {}; st.nums = {}; st.marks = []; st.drawn = {};
      st.callout = o.callouts !== false;
      st.cam = { ...FULL }; st.camA = null; st.say = null; st.note = null; st.place = null;
      st.c.all.forEach((p, i) => {
        const side = p.team === 'off' ? 'o' : 'd';
        st.pal[p.id] = raPalette(st.kit[p.team], i, side);
        st.nums[p.id] = raNumber(ROLE[p.pos], `${play.teams[p.team]}:${p.id}`);
      });
      const ks = [PRE, st.c.snapT, ...(play.ball || []).map((b) => b.t), ...(play.callouts || []).map((k) => k.t), st.c.downT, st.c.T];
      st.keys = [...new Set(ks.filter((v) => v != null && v >= PRE && v <= st.c.T).map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
      st.t = clamp(CS.num(o.t, PRE), PRE, st.c.T);
      draw();
    }

    /* ── coordinates ── World px -> CSS px goes through the camera, so every tap, hit-test and
       bubble is right while zoomed. sx, sy: CSS px per world px at zoom 1. */
    const toCss = () => { const r = canvas.getBoundingClientRect(); return { r, sx: r.width / W, sy: r.height / H }; };
    function w2c(X, Y) { const { r, sx, sy } = toCss(), c = st.cam; return { x: r.left + ((X - c.cx) * c.z + W / 2) * sx, y: r.top + ((Y - c.cy) * c.z + H / 2) * sy }; }
    function c2w(px, py) { const { r, sx, sy } = toCss(), c = st.cam; return { X: ((px - r.left) / sx - W / 2) / c.z + c.cx, Y: ((py - r.top) / sy - H / 2) / c.z + c.cy }; }
    function yardToScreen(x, y) { return w2c(wx(y), wy(x)); }
    function screenToYard(px, py) { const w = c2w(px, py); return { x: (w.Y - MT) / PY, y: w.X / PX + Y0 }; }
    // The painted box of a player's sprite as last drawn, in world pixels.
    function bodyBox(id) {
      const d = st.drawn[id];
      if (!d || !d.spr) return null;
      const bb = d.spr.bb, left = d.X - d.spr.ax, top = d.Y - d.spr.ay;
      return { x0: left + bb.x0, x1: left + bb.x1, y0: top + bb.y0, y1: top + bb.y1, fx: d.X, fy: d.Y };
    }
    // Hit-testing follows the eye. A tap inside a player's painted box belongs to him. Where two
    // boxes overlap, the tap goes to the player whose BODY AXIS (the vertical line from his feet up
    // through his sprite) is nearest: a defensive tackle set a yard off the ball paints his box
    // across the centre's, and a tap on the centre's chest is still the centre's (phase-2 suite,
    // B10). Two axes equally near (two men in one column, a helmet over the legs of the man above)
    // go to the one whose FEET are just below the tap, never to the neighbour whose head reaches
    // up there. Outside every box, the nearest body axis within HIT_R CSS px wins. Distances are
    // CSS px at the current zoom (kx, ky), so the radius is the same size under the finger zoomed or not.
    function hitTest(px, py) {
      if (!st.play) return null;
      const { sx, sy } = toCss(), kx = sx * st.cam.z, ky = sy * st.cam.z;
      const { X, Y } = c2w(px, py);
      const ids = Object.keys(st.drawn);
      let best = null, ba = Infinity, bk = Infinity, bh = Infinity;
      for (const id of ids) {
        const b = bodyBox(id);
        if (!b || X < b.x0 || X >= b.x1 || Y < b.y0 || Y > b.fy + 2) continue;
        const ax = Math.hypot((X - b.fx) * kx, (Y - clamp(Y, b.y0, b.fy)) * ky);   // CSS px to his axis
        const k = b.fy - Y, key = k >= 0 ? k : 0.5 - k, h = Math.abs(X - b.fx);
        const nearer = ax < ba - 0.5, tie = Math.abs(ax - ba) <= 0.5;
        if (nearer || (tie && (key < bk || (key === bk && h < bh)))) { ba = Math.min(ba, ax); bk = key; bh = h; best = id; }
      }
      if (best) return best;
      let bd = Infinity;
      for (const id of ids) {
        const b = bodyBox(id);
        if (!b) continue;
        const cy = clamp(Y, b.y0, b.fy), cx = clamp(X, b.x0, b.x1);
        const d = Math.hypot((X - cx) * kx, (Y - cy) * ky);
        if (d < bd) { bd = d; best = id; }
      }
      if (!ids.length) {                                         // nothing drawn yet: the feet alone
        const pose = CS.poseAt(st.play, st.t);
        for (const [id, q] of Object.entries(pose.players)) {
          const s = yardToScreen(q.x, q.y), d = Math.hypot(s.x - px, s.y - py);
          if (d < bd) { bd = d; best = id; }
        }
      }
      return bd <= HIT_R ? best : null;
    }
    // A player's painted box in CSS px, through the camera.
    function spriteRect(id) {
      const b = bodyBox(id);
      if (!b) return null;
      const a = w2c(b.x0, b.y0), z = w2c(b.x1, b.y1), f = w2c(b.fx, b.fy);
      return { left: a.x, right: z.x, top: a.y, bottom: z.y, feetX: f.x, feetY: f.y };
    }

    function activeCallout() {
      if (!st.callout) return null;
      const ks = st.play.callouts || [];
      let cur = null;
      for (const k of ks) if (st.t >= k.t && st.t < k.t + 2.6) cur = k;
      return cur;
    }

    const RING = { focus: ['#ffe14d', 'rgba(10,20,10,0.6)'], good: ['#4be37a', 'rgba(0,30,10,0.65)'], bad: ['#ff5a4d', 'rgba(40,0,0,0.65)'] };
    function ring(id, kind, pulse) {
      const b = bodyBox(id);
      if (!b) return;
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.fy) / 2;
      const rx = Math.max(9, (b.x1 - b.x0) / 2 + 3) + pulse, ry = Math.max(11, (b.fy - b.y0) / 2 + 3) + pulse;
      const [col, back] = RING[kind] || RING.focus;
      g.setLineDash([]);
      g.strokeStyle = back; g.lineWidth = 4;
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = col; g.lineWidth = 2;
      g.beginPath(); g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); g.stroke();
    }
    // The canvas backing store matches the device pixels it is shown on, so a zoomed-in camera
    // draws the 8-bit art nearest-neighbour into real pixels instead of the browser stretching
    // (and blurring) a 400 px canvas afterwards. Below one device pixel per art pixel the art is
    // filtered down instead (the source's raSizeCanvas rule), as the browser did before.
    function backing() {
      const r = canvas.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return;
      const dpr = root.devicePixelRatio || 1, bw = Math.round(r.width * dpr), bh = Math.round(r.height * dpr);
      if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    }

    function draw() {
      if (!st.play) return;
      backing();
      const c = st.c, t = st.t, play = st.play, cam = st.cam, ax = canvas.width / W, ay = canvas.height / H;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = ax * cam.z < 0.999;
      g.setTransform(ax * cam.z, 0, 0, ay * cam.z, canvas.width / 2 - cam.cx * cam.z * ax, canvas.height / 2 - cam.cy * cam.z * ay);
      g.drawImage(st.art, 0, 0);
      const S = (q) => [wx(q.y), wy(q.x)];
      // Line of scrimmage (blue) and line to gain (yellow), as on TV.
      const vline = (y, col) => { g.fillStyle = col; g.fillRect(Math.round(wx(y)) - 1, MT + 2, 2, FH - 4); };
      g.globalAlpha = 0.75; vline(0, '#4aa8ff'); if (play.dist) vline(play.dist, '#ffe000'); g.globalAlpha = 1;
      const pose = CS.poseAt(play, t), prev = CS.poseAt(play, Math.max(PRE, t - 0.1));

      // Chalk under the players: zone shapes and drops, then routes. A play can turn the zone
      // chalk off (rank 1 names players; it doesn't teach coverages yet).
      const preThrow = c.throwT == null || t < c.throwT + 0.3;
      if (preThrow && play.zones !== false) for (const p of c.def) {
        if (p.role !== 'zone') continue;
        const z = CS.lib.ZONES[p.src.zone], deep = z.deep === true;
        const [zx, zy] = [wx(z.y), wy(z.x + c.dX)];
        g.fillStyle = deep ? 'rgba(90,160,255,0.16)' : 'rgba(255,214,64,0.14)';
        g.strokeStyle = deep ? 'rgba(180,215,255,0.7)' : 'rgba(255,232,150,0.7)';
        g.lineWidth = 1; g.setLineDash([3, 3]);
        g.beginPath(); g.ellipse(zx, zy, (deep ? 6.5 : 3.6) * PX, (deep ? 8 : 4.5) * PY, 0, 0, Math.PI * 2); g.fill(); g.stroke();
        if (t <= c.snapT) {                                  // the drop he will make, before the snap
          g.beginPath(); g.moveTo(wx(p.y), wy(p.x)); g.lineTo(zx, zy); g.stroke();
        }
        g.setLineDash([]);
      }
      const strokePoly = (pts, dashed) => {
        if (pts.length < 2) return;
        g.setLineDash(dashed ? [4, 4] : []);
        for (const [col, w, o] of [['rgba(10,20,10,0.55)', 3, 1], ['#f4f1e6', 2, 0]]) {
          g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
          g.beginPath(); pts.forEach((q, i) => { const X = wx(q[1]) + o, Y = wy(q[0]) + o; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
        }
        g.setLineDash([]);
      };
      if (play.routes !== false) for (const p of c.off) {
        if (p.role !== 'route') continue;
        const pts = chalkRoute(p);
        const d = Math.max(0, p.path.v * (t - c.snapT - p.path.delay));
        const { run, rest } = t <= c.snapT ? { run: [pts[0]], rest: pts } : polyCut(pts, d);
        strokePoly(run, false);
        strokePoly(rest, true);
        const a = pts[pts.length - 2], b = pts[pts.length - 1];       // arrowhead
        const ang = Math.atan2(wy(b[0]) - wy(a[0]), wx(b[1]) - wx(a[1])), X = wx(b[1]), Y = wy(b[0]);
        g.fillStyle = '#f4f1e6';
        g.beginPath(); g.moveTo(X + Math.cos(ang) * 5, Y + Math.sin(ang) * 5);
        g.lineTo(X + Math.cos(ang + 2.5) * 5, Y + Math.sin(ang + 2.5) * 5); g.lineTo(X + Math.cos(ang - 2.5) * 5, Y + Math.sin(ang - 2.5) * 5); g.fill();
      }

      // Players and the ball, back to front.
      const items = [], drawn = {};
      c.all.forEach((p, i) => {
        const q = pose.players[p.id], o = prev.players[p.id];
        const [sx, sy] = S(q);
        const speed = Math.hypot(q.x - o.x, q.y - o.y) / 0.1;
        const vx = (q.y - o.y) * PX;
        const face = Math.abs(vx) > 0.25 ? (vx > 0 ? 'r' : 'l') : p.team === 'off' ? 'r' : 'l';
        const phase = (i * 0.37) % 1;
        const ps = poseOf(c, p, t, speed, phase);
        const X = Math.round(sx), Y = Math.round(sy);
        const spr = raSprite(ps, st.pal[p.id], face === 'l', st.nums[p.id]);
        drawn[p.id] = { pose: ps, flip: face === 'l', sx, sy, X, Y, spr };
        items.push({ y: sy, draw: () => {
          g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(X - 8, Y - 2, 17, 4); g.fillRect(X - 10, Y - 1, 21, 2);
          g.drawImage(spr, X - spr.ax, Y - spr.ay);
        } });
      });
      st.drawn = drawn;
      const b = pose.ball;
      const heldBy = b.held ? drawn[b.held] : null;
      items.push({ y: heldBy ? heldBy.sy + 0.5 : wy(b.x) + 0.5, draw: () => {
        let xb, yb, k = 0;
        if (heldBy) {
          const o = RA_HOLD[heldBy.pose] || RA_HOLD.stand;
          xb = Math.round(heldBy.sx) + (heldBy.flip ? -1 : 1) * o[0]; yb = Math.round(heldBy.sy) - o[1];
        } else {
          xb = wx(b.y); const yg = wy(b.x);
          if (b.air > 0.4) { g.fillStyle = 'rgba(0,30,0,0.4)'; g.fillRect(Math.round(xb) - 4, Math.round(yg) - 1, 9, 3); }
          yb = yg - b.air * HK;
          if (t > c.snapT) {                                   // a spiral points along its flight
            const p2 = CS.poseAt(play, t - 0.04).ball, qx = wx(p2.y), qy = wy(p2.x) - p2.air * HK;
            const a = Math.atan2(yb - qy, xb - qx);
            if (Math.hypot(yb - qy, xb - qx) > 0.2) k = ((Math.round(a / (Math.PI / 8)) % 8) + 8) % 8;
          }
        }
        const spr = raBallSprite(k);
        g.drawImage(spr, Math.round(xb - spr.width / 2), Math.round(yb - spr.height / 2));
      } });
      items.sort((p, q) => p.y - q.y).forEach((it) => it.draw());

      // Chalk over the players: marks the lesson asked for, rings on the players a coach bubble is
      // talking about, and (the engine demo only, which has no bubble layer) the callout on the canvas.
      const pulse = reduced() ? 0 : Math.sin(t * 6) * 1.5;
      for (const m of st.marks) ring(m.id, m.kind, m.kind === 'focus' ? pulse : 0);
      if (st.say) {
        const kind = st.say.tone === 'bad' ? 'bad' : st.say.tone === 'good' ? 'good' : 'focus';
        for (const id of sayPlayers()) if (drawn[id] && !st.marks.some((m) => m.id === id)) ring(id, kind, pulse);
      }
      const k = bubbleEl ? null : activeCallout();
      if (k && drawn[k.focus]) {
        ring(k.focus, 'focus', pulse);
        // Drawn in the body font, never the pixel font (user, 2026-11-11: "the 8 bit text is going
        // to be hard to read, we can use normal font"), in screen space over the camera.
        g.setTransform(ax, 0, 0, ay, 0, 0);
        const f = drawn[k.focus], FS = 15;
        g.font = `600 ${FS}px Inter, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif`;
        const words = String(k.text).split(/\s+/), lines = [];
        let ln = '';
        for (const w of words) { const t2 = ln ? ln + ' ' + w : w; if (ln && g.measureText(t2).width > W - 32) { lines.push(ln); ln = w; } else ln = t2; }
        if (ln) lines.push(ln);
        const lh = FS + 5, bh = lines.length * lh + 12, top = f.sy > H / 2 ? 6 : H - bh - 6;
        g.fillStyle = 'rgba(6,10,16,0.88)'; g.fillRect(6, top, W - 12, bh);
        g.fillStyle = '#ffe14d'; g.fillRect(6, top, 3, bh);
        g.fillStyle = '#f4f1e6'; g.textBaseline = 'top';
        lines.forEach((s2, i) => g.fillText(s2, 16, top + 7 + i * lh));
      }
      renderCoach();
      if (opts.onFrame) opts.onFrame(st.t, k);
    }

    /* ── coach bubbles ── HTML text over the field (the body font), with an SVG layer under it for
       the arrows, the bracket round a group and the glow on a field feature. A bubble is hidden
       while the camera is still moving and placed once it settles; one that follows a moving
       player (a puzzle's answer while the play runs) is re-placed every frame, keeping its spot
       while that spot still works. */
    const TONE = { note: '#ffe14d', prompt: '#ffe14d', good: '#4be37a', bad: '#ff5a4d' };
    function sayPlayers() {
      const out = [];
      for (const tok of st.say.focus) { const f = CS.focusOf(st.play, tok, st.t); if (f && (f.kind === 'player' || (f.kind === 'group' && !f.bracket))) out.push(...f.ids); }
      return out;
    }
    function focusGeom(tokens) {
      const { r } = toCss(), out = [];
      const rel = (p) => ({ x: p.x - r.left, y: p.y - r.top });
      const relRect = (q) => ({ l: q.left - r.left, r: q.right - r.left, t: q.top - r.top, b: q.bottom - r.top });
      for (const tok of tokens) {
        const f = CS.focusOf(st.play, tok, st.t);
        if (!f) continue;
        if (f.kind === 'player' || (f.kind === 'group' && !f.bracket)) {
          for (const id of f.ids) {
            const q = spriteRect(id);
            if (q) out.push({ tok, id, kind: 'player', rect: relRect(q), pt: { x: (q.left + q.right) / 2 - r.left, y: (q.top + q.bottom) / 2 - r.top } });
          }
        } else if (f.kind === 'group') {
          let R = null;
          for (const id of f.ids) {
            const q = spriteRect(id);
            if (!q) continue;
            const a = relRect(q);
            R = R ? { l: Math.min(R.l, a.l), r: Math.max(R.r, a.r), t: Math.min(R.t, a.t), b: Math.max(R.b, a.b) } : a;
          }
          if (R) out.push({ tok, kind: 'group', ids: f.ids, rect: { l: R.l - 5, r: R.r + 5, t: R.t - 5, b: R.b + 5 }, pt: null });
        } else {
          for (const m of f.marks) {
            const p = rel(yardToScreen(m.at.x, m.at.y)), a = rel(yardToScreen(m.box.x0, m.box.y0)), b = rel(yardToScreen(m.box.x1, m.box.y1));
            out.push({ tok, kind: 'feature', pt: p, hl: m.hl, rect: { l: Math.min(a.x, b.x), r: Math.max(a.x, b.x), t: Math.min(a.y, b.y), b: Math.max(a.y, b.y) } });
          }
        }
      }
      // Only what the camera shows can be pointed at.
      return out.filter((q) => (q.pt ? q.pt.x >= 0 && q.pt.x <= r.width && q.pt.y >= 0 && q.pt.y <= r.height : q.rect.r > 0 && q.rect.l < r.width && q.rect.b > 0 && q.rect.t < r.height));
    }
    function fillBubble(s) {
      const el = bubbleEl;
      el.textContent = '';
      const bt = document.createElement('span'); bt.className = 'bt';
      const parts = s.parts || [s.text || ''];
      for (const part of parts) {
        if (typeof part === 'string') bt.appendChild(document.createTextNode(part));
        else if (part && part.text) { const e = document.createElement(part.tag || 'b'); e.textContent = part.text; if (part.cls) e.className = part.cls; bt.appendChild(e); }
      }
      el.appendChild(bt);
      if (s.n) { const n = document.createElement('small'); n.className = 'bn'; n.textContent = s.n; el.appendChild(n); }
      el.dataset.tone = s.tone || 'note';
    }
    function renderCoach() {
      st.geom = null;
      if (!bubbleEl) return;
      const s = st.say;
      if (!s || (st.camA && !reduced())) { bubbleEl.hidden = true; if (tailsEl) tailsEl.innerHTML = ''; return; }
      const { r } = toCss(), BW = r.width, BH = r.height;
      if (!(BW > 0)) return;
      if (st.shown !== s.key) { fillBubble(s); st.shown = s.key; st.place = null; st.bw = 0; }
      bubbleEl.hidden = false;
      const w = Math.round(Math.min(BW - 12, 300));
      if (st.bw !== w) { bubbleEl.style.width = w + 'px'; st.bw = w; st.bh = bubbleEl.offsetHeight; }
      const T = focusGeom(s.focus);
      const tids = new Set(T.flatMap((q) => q.ids || (q.id ? [q.id] : [])));
      const avoid = [];
      for (const id of Object.keys(st.drawn)) { if (tids.has(id)) continue; const q = spriteRect(id); if (q) avoid.push({ l: q.left - r.left, r: q.right - r.left, t: q.top - r.top, b: q.bottom - r.top }); }
      const pl = CS.placeBubble({ W: BW, H: BH, w, h: st.bh, targets: T.map((q) => ({ rect: q.rect, pt: q.pt })), avoid, pad: 6, gap: 38, prev: st.place });
      st.place = pl;
      bubbleEl.style.left = pl.x + 'px'; bubbleEl.style.top = pl.y + 'px';
      const B = { x: pl.x, y: pl.y, w, h: st.bh }, bcx = B.x + w / 2, bcy = B.y + B.h / 2;
      for (const q of T) if (q.kind === 'group') {     // a group's arrow lands on the side of its bracket that faces the bubble
        const R = q.rect;
        if (B.y + B.h <= R.t) q.pt = { x: clamp(bcx, R.l + 6, R.r - 6), y: R.t };
        else if (B.y >= R.b) q.pt = { x: clamp(bcx, R.l + 6, R.r - 6), y: R.b };
        else q.pt = { x: B.x + w <= R.l ? R.l : R.r, y: clamp(bcy, R.t + 6, R.b - 6) };
      }
      const col = TONE[s.tone] || TONE.note;
      let svg = '';
      const P = (n) => n.toFixed(1);
      for (const q of T) {
        const h = q.hl;
        if (h && h.kind === 'hline') { const y = yardToScreen(h.x, 0).y - r.top; svg += `<line x1="0" x2="${P(BW)}" y1="${P(y)}" y2="${P(y)}" stroke="rgba(255,225,77,.5)" stroke-width="7"/>`; }
        else if (h && h.kind === 'vline') { const x = yardToScreen(0, h.y).x - r.left; svg += `<line y1="0" y2="${P(BH)}" x1="${P(x)}" x2="${P(x)}" stroke="rgba(255,225,77,.5)" stroke-width="7"/>`; }
        else if (h && h.kind === 'rect') {
          const a = yardToScreen(h.x0, h.y0), b = yardToScreen(h.x1, h.y1), x0 = Math.min(a.x, b.x) - r.left, y0 = Math.min(a.y, b.y) - r.top;
          const fill = h.tone === 'red' ? 'rgba(255,80,60,.2)' : 'rgba(255,225,77,.14)', line = h.tone === 'red' ? 'rgba(255,120,100,.9)' : 'rgba(255,225,77,.8)';
          svg += `<rect x="${P(x0)}" y="${P(y0)}" width="${P(Math.abs(b.x - a.x))}" height="${P(Math.abs(b.y - a.y))}" fill="${fill}" stroke="${line}" stroke-width="2" stroke-dasharray="6 4"/>`;
          // A region that has a name (field, boundary) wears it in its corner, so two lit regions are told apart.
          if (h.label) svg += `<text x="${P(x0 + 8)}" y="${P(y0 + 20)}" class="rlab" fill="${line}">${h.label}</text>`;
        } else if (h && h.kind === 'ring') {
          const a = yardToScreen(h.x - h.rx, h.y - h.ry), b = yardToScreen(h.x + h.rx, h.y + h.ry), rx = P(Math.abs(b.x - a.x) / 2), ry = P(Math.abs(b.y - a.y) / 2);
          svg += `<ellipse cx="${P(q.pt.x)}" cy="${P(q.pt.y)}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(10,14,20,.7)" stroke-width="5"/><ellipse cx="${P(q.pt.x)}" cy="${P(q.pt.y)}" rx="${rx}" ry="${ry}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
        }
        if (q.kind === 'group') {
          const R = q.rect, box = `x="${P(R.l)}" y="${P(R.t)}" width="${P(R.r - R.l)}" height="${P(R.b - R.t)}" rx="6" fill="none"`;
          svg += `<rect ${box} stroke="rgba(10,14,20,.75)" stroke-width="5"/><rect ${box} stroke="${col}" stroke-width="2.5" stroke-dasharray="7 4"/>`;
        }
      }
      for (const q of T) {
        const tl = CS.tailOf(B, q.pt, q.kind === 'player' ? 9 : 2);
        q.tail = tl;
        const dx = tl.x1 - tl.x0, dy = tl.y1 - tl.y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, hl = Math.min(12, L * 0.6);
        const bx = tl.x1 - ux * hl, by = tl.y1 - uy * hl, nx = -uy * 6.5, ny = ux * 6.5;
        const head = `${P(tl.x1)},${P(tl.y1)} ${P(bx + nx)},${P(by + ny)} ${P(bx - nx)},${P(by - ny)}`;
        svg += `<line x1="${P(tl.x0)}" y1="${P(tl.y0)}" x2="${P(bx)}" y2="${P(by)}" stroke="rgba(10,14,20,.8)" stroke-width="7" stroke-linecap="round"/>`;
        svg += `<polygon points="${head}" fill="rgba(10,14,20,.8)" stroke="rgba(10,14,20,.8)" stroke-width="4" stroke-linejoin="round"/>`;
        svg += `<line x1="${P(tl.x0)}" y1="${P(tl.y0)}" x2="${P(bx)}" y2="${P(by)}" stroke="${col}" stroke-width="3.5" stroke-linecap="round"/>`;
        svg += `<polygon points="${head}" fill="${col}"/>`;
      }
      if (tailsEl) tailsEl.innerHTML = svg;
      const pg = (p) => ({ x: p.x + r.left, y: p.y + r.top }), pr = (q) => ({ l: q.l + r.left, r: q.r + r.left, t: q.t + r.top, b: q.b + r.top });
      st.geom = {
        box: { l: r.left, r: r.right, t: r.top, b: r.bottom }, ok: pl.ok, tone: s.tone || 'note',
        bubble: { l: r.left + B.x, r: r.left + B.x + w, t: r.top + B.y, b: r.top + B.y + B.h },
        targets: T.map((q) => ({ tok: q.tok, id: q.id || null, ids: q.ids || null, kind: q.kind, pt: pg(q.pt), rect: pr(q.rect), tail: { x0: q.tail.x0 + r.left, y0: q.tail.y0 + r.top, x: q.tail.x1 + r.left, y: q.tail.y1 + r.top } })),
      };
    }

    /* ── the camera ── */
    function camTo(to, instant) {
      to = CS.camClamp(to, W, H);
      const c = st.cam;
      if (Math.abs(c.z - to.z) < 1e-3 && Math.hypot(c.cx - to.cx, c.cy - to.cy) < 0.5) { st.cam = to; st.camA = null; return; }
      if (instant || reduced()) { st.cam = to; st.camA = null; return; }   // reduced motion: a cut, not an ease
      st.camA = { from: { ...c }, to, t0: performance.now(), dur: CAM_MS };
      loop();
    }
    // The world-pixel box of everything a bubble points at, framed with a margin.
    function frameOf(tokens) {
      let R = null;
      const add = (x0, x1, y0, y1) => { R = R ? { x0: Math.min(R.x0, x0), x1: Math.max(R.x1, x1), y0: Math.min(R.y0, y0), y1: Math.max(R.y1, y1) } : { x0, x1, y0, y1 }; };
      for (const tok of tokens) {
        const f = CS.focusOf(st.play, tok, st.t);
        if (!f) continue;
        if (f.ids) for (const id of f.ids) { const b = bodyBox(id); if (b) add(b.x0, b.x1, b.y0, b.fy); }
        else { const fr = f.frame; add(wx(fr.y0), wx(fr.y1), wy(fr.x0), wy(fr.x1)); }
      }
      return R ? CS.camFrame(R, W, H, { margin: 36, zmax: 3, step: 0.25, fill: 0.55 }) : { ...FULL };
    }
    // Say something: {text | parts, focus, tone, zoom, frame, n}. zoom true frames the focus (and
    // `frame`, extra tokens that must stay in view); false eases back to the whole window.
    function say(b) {
      st.sayN++;
      st.say = b ? { ...b, focus: CS.toArr(b.focus), key: st.sayN } : null;
      if (b && b.zoom) camTo(frameOf(st.say.focus.concat(CS.toArr(b.frame))));
      else if (b && b.zoom === false) camTo(FULL);
      draw();
    }

    /* ── playback ── one rAF loop moves the camera and the clock and draws once a frame. */
    function loop() { if (!st.raf) st.raf = requestAnimationFrame(frame); }
    function frame(now) {
      st.raf = 0;
      if (st.camA) {
        const u = (now - st.camA.t0) / st.camA.dur;
        if (u >= 1) { st.cam = st.camA.to; st.camA = null; } else st.cam = CS.camLerp(st.camA.from, st.camA.to, Math.max(0, u));
      }
      if (st.playing) advance(now);
      draw();
      if (st.playing || st.camA) loop();
    }
    function seek(t) {
      st.t = clamp(t, PRE, st.c ? st.c.T : 0);
      st.note = null;
      if (st.say && st.say.src === 'callout') st.say = null;
      draw();
      return st.t;
    }
    // Watch mode stops the clock on each callout until he presses again (plan: "timed callouts
    // that pause"). Returns the first callout time inside (from, to], if any.
    function nextStop(from, to) {
      if (!opts.pauseAtCallouts || !st.callout) return null;
      const ks = (st.play.callouts || []).map((k) => k.t).filter((v) => v > from + 1e-6 && v <= to).sort((a, b) => a - b);
      return ks.length ? ks[0] : null;
    }
    // Stopped on a note: the camera eases in on what it talks about and the bubble points at it.
    function stopAt(tk) {
      const k = (st.play.callouts || []).find((q) => Math.abs(q.t - tk) < 1e-6);
      st.playing = false; st.note = k || null;
      if (k) say({ text: k.text, focus: k.focus, tone: 'note', zoom: true, src: 'callout' });
      if (opts.onState) opts.onState();
    }
    function advance(now) {
      const dt = Math.min(0.05, (now - st.last) / 1000);
      st.last = now;
      if (reduced()) {
        // Reduced motion: no tweening. Hold each key frame (snap, throw, catch, each callout) and step.
        st.acc += dt * st.speed;
        if (st.acc >= 1.2) {
          st.acc = 0;
          const nx = st.keys.find((v) => v > st.t + 1e-6);
          const stop = nx == null ? null : nextStop(st.t, nx);
          st.t = nx == null ? st.c.T : nx;
          if (stop != null) return stopAt(stop);
        }
      } else {
        const to = Math.min(st.c.T, st.t + dt * st.speed), stop = nextStop(st.t, to);
        st.t = stop == null ? to : stop;
        if (stop != null) return stopAt(stop);
      }
      if (st.t >= st.c.T) { st.playing = false; if (opts.onState) opts.onState(); if (opts.onEnd) opts.onEnd(); }
    }
    function play() {
      if (!st.play) return;
      if (st.t >= st.c.T) st.t = PRE;
      st.note = null;
      if (st.say && st.say.src === 'callout') st.say = null;
      camTo(FULL);                                           // the play runs zoomed out
      // REGRESSION (dad's playtest, PR #182): every lesson play opened with notes before the snap,
      // so a press ran a few tenths of a second of a frozen picture and stopped again. Before the
      // snap nobody moves, so a lesson goes straight to the next pre-snap note, or straight to the
      // snap, never through dead time. (The engine demo keeps its real-time clock.)
      if (opts.pauseAtCallouts && st.callout && st.t < st.c.snapT) {
        const nx = nextStop(st.t, st.c.snapT);
        if (nx != null) { st.t = nx; return stopAt(nx); }
        st.t = st.c.snapT;
      }
      if (reduced()) {
        const k0 = st.keys.filter((v) => v <= st.t + 1e-6).pop(); st.t = k0 == null ? PRE : k0;
        st.acc = 1.2;                                        // the first step lands at once, not 1.2 s after the press
      } else st.acc = 0;
      st.playing = true; st.last = performance.now();
      draw();
      loop();
      if (opts.onState) opts.onState();
    }
    function pause() { st.playing = false; if (opts.onState) opts.onState(); }
    function sizeHint() {
      // The backing store follows the device pixels (backing()), so the browser never rescales it.
      canvas.style.imageRendering = 'pixelated';
    }
    // Size the canvas (or the wrapper it fills) to the largest W:H box that fits inside `box`, so
    // the field grows into whatever height the screen leaves it and never pushes the page to scroll.
    function fit(box) {
      if (!box) return;
      const bw = box.clientWidth, bh = box.clientHeight;
      if (!(bw > 0 && bh > 0)) return;
      const s = Math.min(bw / W, bh / H), w = Math.floor(W * s), h = Math.floor(H * s);
      const el = opts.wrap || canvas;
      el.style.width = w + 'px'; el.style.height = h + 'px';
      if (el !== canvas) { canvas.style.width = '100%'; canvas.style.height = '100%'; }
      sizeHint();
      st.bw = 0;
      draw();
    }
    canvas.addEventListener('pointerdown', (e) => {
      const id = hitTest(e.clientX, e.clientY);
      if (opts.onTap) opts.onTap(id, e);
    });
    root.addEventListener('resize', () => { sizeHint(); st.bw = 0; draw(); });
    sizeHint();

    const api = {
      setPlay, seek, start: play, pause, draw, hitTest, yardToScreen, screenToYard, sizeHint, fit, spriteRect, say,
      setSpeed: (s) => { st.speed = s; if (opts.onState) opts.onState(); },
      setMarks: (m) => { st.marks = (m || []).slice(); draw(); },
      get t() { return st.t; }, get play() { return st.play; }, get playing() { return st.playing; }, get speed() { return st.speed; },
      get T() { return st.c ? st.c.T : 0; }, get keys() { return st.keys.slice(); }, get reduced() { return reduced(); },
      get marks() { return st.marks.slice(); }, get canvas() { return canvas; },
      get camera() { return { ...st.cam }; }, get camAnimating() { return !!st.camA; }, get atNote() { return !!st.note; },
      get saying() { return st.say ? { text: st.say.text || null, focus: st.say.focus.slice(), tone: st.say.tone || 'note', src: st.say.src || null } : null; },
      get coach() { return st.geom ? JSON.parse(JSON.stringify(st.geom)) : null; },
      PRE, hitRadius: HIT_R, world: { W, H, PX, PY, Y0, Y1, MT },
    };
    return api;
  };
})(typeof window !== 'undefined' ? window : globalThis);
