/* Coach School field: the 8-bit canvas renderer, camera, chalk overlay, playback and hit-testing.

   ART PROVENANCE. The pixel art below is COPIED (house rule: no shared JS between pages) from the
   production Scores 8-bit view, assets/sunday/sd-reenact.js at commit 960fb27 (origin/main; the
   file as of "Scores RedZone: follow the plays...", which carries e158da3 "the 8-bit players
   redrawn, and animated frame by frame", 4da527a/6454514 faces and light grey facemasks, cd6f6d1
   helmet logos). Re-ported 2026-11-11: phases 1-2 had copied an older, unmerged version of that
   file (bdb314b on `scores-8bit`), which the dad spotted was not what production draws.
     - colour helpers clamp/rgb/lum/mixHex/onColor/cdist  (from assets/sunday/sd-app.js ~66, 131-143)
     - raRng                                              (sd-reenact ~20-30)
     - RA_GLYPHS, RA_BIG, pixW, bigText, bigW, bigLabel   (~2025-2093; pixText dropped in phase 2)
     - raOutlined (end-zone lettering)                    (~2072-2084, verbatim)
     - the Players notes, RA_SKEL, RA_GAITS, RA_STRIDE, raGait, RA_BONE, raRig,
       RA_FW/FH/FAX/FAY, RA_FIG, raFig                    (~2095-2390, verbatim)
     - raSprite (player branch with helmet logos), raRGB  (~2410-2494, adapted, see below)
     - raBallSprite                                       (~2495-2515, verbatim)
     - raContrast, RA_WHITE, RA_KITS, RA_LOGO_BOX/W/H, RA_LOGO, raGenericKit, raSafeNum, raKit,
       RA_MASK, raShade, raLight, RA_SKIN, raNumber       (~2690-2829, verbatim; RA_HELMET skipped)
     - raPalette (team branch only)                       (~2830-2872, adapted)
     - raPoseAt, raGaitFrame, raFrame (as poseOf/gaitFrame) and the facing rules of raDraw
       (as faceOf)                                        (~2905-2955, 3052-3080, adapted)
     - RA_HOLD, RA_FLAT, raShadow                         (~2956-2975, verbatim)
     - raFieldArt                                         (~2563-2688, adapted, see below)
     - EZ, ezStyle, chroma, teamInk                       (from assets/sunday/sd-app.js ~153-210, verbatim)
   CS._art exposes raFig, RA_SKEL and the kit tables so the suite can check the copy against the
   production file (A, "art matches production").
   Changes from the source, all on purpose:
     - RA_GLYPHS gains ',', '?', '(' and ')' (phase 1 drew callouts in it). Since phase 2 every word
       a player reads is in the page's body font (the dad: 'the 8 bit text is going to be hard to
       read, we can use normal font'); the pixel fonts draw only yard numbers, end-zone names and
       jersey numbers.
     - raSprite drops the 12-pixel cheerleader/band maps (RA_MAPS) and the officials' stripes and
       trainers' cross; raPalette keeps only the team-kit branch. raSprite adds the painted box
       (c.bb) that hit-testing, brackets, bubble tails and the spotlight read. The idle-time
       pre-rasterising of every frame is not copied (frames rasterise on first draw).
     - poseOf/faceOf are pure functions of t (the source carries a sticky `a.face` and a stride
       phase from frame to frame), so scrubbing backwards draws the same frame as playing forwards.
       A stride's phase is t * cadence + the man's own offset. Kicking, holding, kneeling, diving,
       celebrating, the stretcher and the huddle are not used here.
     - raFieldArt paints only the camera's window (no stands, benches, midfield logo, end-zone
       logos or posts: the logos are an ESPN CDN fetch this page never makes), at this page's own
       scale: 14 px per yard along the field, 15 across (the source draws 18 and 14) so the full
       53.33-yard width runs down a portrait phone. Offense attacks to the RIGHT. End zones wear
       the HOME team's paint and words, as in the source. Two field facts are this page's own and
       kept on purpose: the hash rows sit at CS.HASH_L/R (the fact sheet's NFL 70'9"; the source
       uses the same 23.58 yd), and the yard numerals sit 12-14 yd in from each sideline (fact
       sheet; the source draws them about 9-11 yd in).
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

  /* ═════ copied: players (skeleton poses rigged and rasterised to shaded 34x40 sprites) ═════ */
  /* ── Players ──
     Redrawn 2026-09-29 (user: "do a design pass on the 8-bit players in gffl to get them better pixel
     graphics and better animations"). Every frame is a skeleton in sprite pixels, x forward, y up from
     the ground: hip `h`, the top of the spine `s`, the head's centre `c`, three points for each arm
     (shoulder, elbow, hand: `fa` near, `ba` far) and leg (hip, knee, ankle: `fl`, `bl`), the feet's
     directions (`ff`, `bf`) and the head's tilt (`hr`, degrees forward; else it follows the neck). It is
     rasterised once into a 34×40 grid of shade codes, then coloured per uniform (raSprite):
     - football proportions: a big helmet, shoulder pads wider than the chest, a narrow waist, thick
       thighs, the pants ending under the knee over the socks
     - the helmet is one solid shell colour (2026-09-28, user: "make the helmet 1 solid color") with the
       face in its opening under the brow's shadow and a light grey facemask's bars in front (a later
       pass the same day); officials get a cap, trainers bare heads
     - two tones a colour, lit from above and in front, and a lighter third only on the jersey's
       shoulders; the far arm and leg sit in shadow
     - a near limb casts a one-pixel shadow onto whatever it crosses, in that thing's own shadow tone,
       instead of a black line through the body; the helmet keeps a dark rim
     - a last pass gives any lone pixel of a tone its neighbours' tone, and the figure a dark outline
     The walking, jogging, running, ball-carrying, backpedalling and stretcher-carrying strides are
     generated (raGait): eight frames a stride from one foot path per gait, the knees solved from it,
     the body bobbing twice a stride, the arms swinging against the legs.
     Codes: J j L jersey (base, shadow, light), P p Q pants, S s socks, F f E skin, H helmet, m face
     mask, k the brow's shadow, e eye, B b cleats, C c cap or hair, O outline. */
  // Every limb is [root, middle, end]: the root is placed by the rig (raRig), the middle joint only
  // says which way the limb bends, and the end (hand, ankle) is where it reaches.
  const RA_SKEL = {
    stand:  { h: [0, 13.1], s: [0.3, 23.1], c: [0.9, 28.5], fa: [0, [1.6, 16.6], [2.8, 12.2]], ba: [0, [-2.4, 16.6], [-2.4, 12.2]], fl: [0, [1.4, 7.6], [2, 2.2]], bl: [0, [-1.4, 7.6], [-2.2, 2.2]] },
    // Breathing out: the knees give a little and everything above settles.
    stand2: { h: [0, 12.7], s: [0.3, 22.7], c: [0.9, 28.1], fa: [0, [1.6, 16.2], [2.9, 11.9]], ba: [0, [-2.4, 16.2], [-2.5, 11.9]], fl: [0, [1.6, 7.4], [2, 2.2]], bl: [0, [-1.2, 7.4], [-2.2, 2.2]] },
    hips:   { h: [0, 13.1], s: [0.2, 23.1], c: [0.7, 28.5], fa: [0, [4.6, 18.2], [2.4, 14.4]], ba: [0, [-4.4, 18.4], [-2.2, 14.6]], fl: [0, [2, 7.6], [2.8, 2.2]], bl: [0, [-2, 7.6], [-3, 2.2]] },
    ready:  { h: [-1.4, 11.2], s: [2.4, 20.4], c: [3.8, 25.6], hr: 12, fa: [0, [4.2, 13.8], [3.6, 9.6]], ba: [0, [2.2, 13.6], [1.4, 9.2]], fl: [0, [2.6, 7], [1.6, 2.2]], bl: [0, [-1, 6.6], [-3.2, 2.2]] },
    stance: { h: [-3.6, 10], s: [4, 12], c: [8, 13.6], tl: 8, nl: 4.4, hr: 36, fa: [0, [5.6, 6], [6.2, 1.4]], ba: [0, [1.2, 7.8], [0.2, 6.6]], fl: [0, [1.2, 5.4], [-0.6, 2]], bl: [0, [-5.2, 5.2], [-6.8, 2]], noNum: 1 },
    snap:   { h: [-3.6, 10], s: [4, 11.8], c: [8, 13.2], tl: 8, nl: 4.4, hr: 40, fa: [0, [6.4, 6.4], [7.4, 2.2]], ba: [0, [5.6, 6.2], [6.6, 2.4]], fl: [0, [0.4, 5.4], [0.2, 2]], bl: [0, [-4.6, 5.4], [-4.8, 2]], noNum: 1 },
    qbUnder:{ h: [-1.4, 10.8], s: [2, 19.6], c: [3.4, 25], hr: 10, fa: [0, [4.6, 13.4], [6.2, 11.2]], ba: [0, [3.8, 13.2], [5.6, 10.8]], fl: [0, [2, 6.6], [1, 2.2]], bl: [0, [-1.2, 6.2], [-3.2, 2.2]] },
    gun:    { h: [0, 12.5], s: [1.1, 22.4], c: [2, 27.8], fa: [0, [3.8, 15.8], [7.2, 16.4]], ba: [0, [2.2, 15.6], [5.8, 15.9]], fl: [0, [2, 7.2], [1.4, 2.2]], bl: [0, [-1.4, 7.2], [-2.2, 2.2]] },
    // The QB with the ball at his chest, feet under him, waiting to throw.
    qbSet:  { h: [0, 12.9], s: [0.7, 22.9], c: [1.5, 28.3], fa: [0, [1.2, 16.4], [4.2, 18.4]], ba: [0, [0.4, 16.4], [3.6, 19]], fl: [0, [2.2, 7.4], [2.6, 2.2]], bl: [0, [-2, 7.4], [-2.8, 2.2]] },
    hold:   { h: [-0.6, 8.2], s: [1.4, 17.8], c: [2.7, 23.2], hr: 12, fa: [0, [4.4, 12], [6.5, 9]], ba: [0, [3.6, 11.6], [5.8, 8.6]], fl: [0, [3.6, 7.4], [3.4, 2]], bl: [0, [-1.8, 1.7], [-6.8, 1.5]], bf: [-1, 0.1] },
    hold2:  { h: [-0.6, 8.2], s: [2, 17.4], c: [3.6, 22.6], hr: 22, fa: [0, [5, 10.4], [6.4, 4.6]], ba: [0, [4, 10.2], [5.4, 4.9]], fl: [0, [3.6, 7.4], [3.4, 2]], bl: [0, [-1.8, 1.7], [-6.8, 1.5]], bf: [-1, 0.1] },
    kick0:  { h: [0, 13], s: [0.8, 23], c: [1.5, 28.4], fa: [0, [3.6, 18.2], [5.8, 18.8]], ba: [0, [-2.5, 18.6], [-4.8, 17.4]], fl: [0, [-2.4, 8.6], [-6, 9.6]], bl: [0, [0.4, 7.6], [0.2, 2.2]], ff: [-0.2, -1] },
    kick:   { h: [0, 13], s: [-1.3, 22.9], c: [-1, 28.3], fa: [0, [-2.8, 18.6], [-5.6, 18]], ba: [0, [2.8, 20], [5.4, 21.6]], fl: [0, [5.2, 15], [9.6, 17.6]], bl: [0, [-0.2, 7.6], [-0.6, 2.2]], ff: [0.7, 0.7] },
    punt:   { h: [0, 13], s: [-1.7, 22.6], c: [-1.8, 28], fa: [0, [-0.4, 20.2], [4.8, 20.4]], ba: [0, [-3.6, 19.8], [-6.2, 19.4]], fl: [0, [4.6, 18.6], [8, 23.4]], bl: [0, [-0.4, 7.6], [-0.8, 2.2]], ff: [0.6, 0.8] },
    // The pass: wound up with the ball by his ear and the front arm pointing, released high in front,
    // then the follow-through, the arm across the body and the back foot coming off the ground.
    throw1: { h: [-0.3, 12.8], s: [-0.9, 22.8], c: [0, 28.2], hr: -4, fa: [0, [3.4, 21], [6, 21.6]], ba: [0, [-5.6, 21.4], [-5.8, 27.4]], fl: [0, [3.4, 7.8], [4.6, 2.2]], bl: [0, [-2.8, 7.6], [-4.4, 2.2]] },
    throw2: { h: [0.8, 12.8], s: [2.2, 22.6], c: [3, 28], hr: 4, fa: [0, [2.2, 16.4], [0.4, 14.6]], ba: [0, [5.4, 27.4], [10.4, 29.2]], fl: [0, [4, 7.8], [5, 2.2]], bl: [0, [-1.8, 7.4], [-3.6, 3.2]], bf: [0.35, -0.94] },
    throw3: { h: [1.4, 12.4], s: [4, 21.8], c: [5.4, 27], hr: 16, fa: [0, [2.2, 16.2], [0, 14.4]], ba: [0, [6.4, 17.4], [5.2, 13.2]], fl: [0, [4.3, 7.4], [4.9, 2.2]], bl: [0, [-1.8, 9.4], [-4.6, 7]], bf: [-0.3, -1] },
    catch:  { h: [0, 13.1], s: [0.8, 23.1], c: [1.2, 28.5], hr: -8, fa: [0, [7, 21.4], [11.4, 25.4]], ba: [0, [5.4, 22.8], [10.4, 26.8]], fl: [0, [2.4, 7.6], [2.2, 2.2]], bl: [0, [-2, 7.6], [-3.4, 2.6]] },
    // The ball pulled into the chest a beat after the catch.
    secure: { h: [0, 12.5], s: [1.5, 22.4], c: [2.5, 27.8], hr: 8, fa: [0, [0.9, 16.6], [4.1, 18]], ba: [0, [0.4, 16.6], [3.5, 19]], fl: [0, [2.6, 7.2], [2, 2.2]], bl: [0, [-1.8, 7], [-2.8, 2.2]] },
    // Engaged: hands on the other man's chest, leaning in, the feet chopping (block2 the other foot).
    block:  { h: [-1, 11.4], s: [3, 20.4], c: [4.9, 25.8], hr: 14, fa: [0, [5.8, 17.2], [8.2, 17.6]], ba: [0, [5, 16.4], [7.6, 16.6]], fl: [0, [2.2, 6.8], [1.2, 2.2]], bl: [0, [-3.2, 6.6], [-5.2, 2.2]] },
    block2: { h: [-0.7, 11.2], s: [3.4, 20.2], c: [5.3, 25.5], hr: 16, fa: [0, [6.2, 17], [8.7, 17.4]], ba: [0, [5.4, 16.2], [8, 16.4]], fl: [0, [0.8, 6.6], [-1.3, 2.2]], bl: [0, [1, 6.8], [0.4, 2.2]] },
    down:   { h: [-2.6, 3.1], s: [5, 3.5], c: [9.6, 3.8], tl: 7.6, nl: 4.6, hr: 90, fa: [0, [8.6, 2.4], [13.6, 1.8]], ba: [0, [6.8, 5], [9.6, 4.4]], fl: [0, [-8, 3.4], [-13.4, 2]], bl: [0, [-8.2, 5], [-13, 4.8]], ff: [-0.2, -1], bf: [-0.4, -1], noNum: 1 },
    // Going down: the knees buckle and he pitches forward (fall1), then lands on his knees and hands
    // (fall2) before he is flat. A tackler dives in first, arms out.
    fall1:  { h: [0.4, 11.2], s: [4.4, 19.8], c: [6.6, 24.6], hr: 28, fa: [0, [7.4, 15.4], [9.6, 13.2]], ba: [0, [1.8, 21], [0.2, 23.4]], fl: [0, [3.4, 6.4], [1.6, 2]], bl: [0, [-2.6, 7.6], [-5, 4.2]], bf: [-0.5, -0.9] },
    fall2:  { h: [-1.2, 6.8], s: [5.3, 9.4], c: [9.3, 10.9], tl: 8, nl: 4.6, hr: 38, fa: [0, [7.6, 5.2], [9.6, 1.6]], ba: [0, [6.8, 5.6], [8.8, 1.7]], fl: [0, [2.4, 2], [-2.6, 1.4]], bl: [0, [-4.2, 2.2], [-8.4, 1.6]], ff: [-1, 0.1], bf: [-1, 0.1], noNum: 1 },
    dive:   { h: [-3.4, 8.2], s: [4.2, 11], c: [8.6, 12.8], tl: 8, nl: 4.6, hr: 58, fa: [0, [8.4, 10.6], [12.2, 11.2]], ba: [0, [7.6, 12.2], [11.4, 12.8]], fl: [0, [-7.4, 6.6], [-12, 6.2]], bl: [0, [-8, 9.4], [-12.4, 10.4]], ff: [-0.4, -1], bf: [-0.4, -1], noNum: 1 },
    // On one knee (taking a knee; getting up goes kneel, then rise).
    kneel:  { h: [-0.4, 8.4], s: [0.4, 18.4], c: [1.1, 23.8], fa: [0, [2.8, 12.6], [4, 9]], ba: [0, [-1.2, 12.6], [-1, 8.2]], fl: [0, [4.4, 8], [4.6, 2.2]], bl: [0, [-1.6, 2], [-6.2, 1.5]], bf: [-1, 0.1] },
    rise:   { h: [-0.6, 9.4], s: [2.7, 18.8], c: [4.5, 24], hr: 18, fa: [0, [4.6, 12.4], [4.8, 8.4]], ba: [0, [2, 12], [2.4, 8]], fl: [0, [4.1, 8], [4.3, 2.2]], bl: [0, [-2.2, 2.8], [-5.8, 1.6]], bf: [-1, 0.2] },
    // A squat before a jump and on landing.
    crouch: { h: [-0.6, 10], s: [1.6, 19.8], c: [2.6, 25.2], hr: 6, fa: [0, [2.6, 13.8], [1.8, 10.2]], ba: [0, [-1, 14.2], [-2.6, 11.4]], fl: [0, [3.4, 6.2], [1.4, 2.2]], bl: [0, [1.8, 6], [-0.8, 2.2]] },
    // Celebrating: the near arm flexed out in front, clear of the facemask, the far one up behind the helmet.
    cheer:  { h: [0, 13.1], s: [0.3, 23.1], c: [0.8, 28.5], hr: -6, fa: [0, [9, 22.6], [9.8, 27.8]], ba: [0, [-4.6, 26.8], [-5.6, 31.8]], fl: [0, [2.2, 7.6], [3, 2.2]], bl: [0, [-2.2, 7.6], [-3, 2.2]] },
    // Both arms straight up: the men holding a hoisted kicker.
    signal: { h: [0, 13.1], s: [0.2, 23.1], c: [0.5, 28.5], fa: [0, [3.8, 27.4], [4, 32.8]], ba: [0, [-4.4, 26.8], [-4.8, 32.4]], fl: [0, [1.2, 7.6], [1.4, 2.2]], bl: [0, [-1.2, 7.6], [-1.6, 2.2]] },
    dance:  { h: [0, 12.8], s: [0.3, 22.8], c: [0.9, 28.2], fa: [0, [6.4, 19.4], [10.4, 20.8]], ba: [0, [-4.2, 26.2], [-4.8, 31]], fl: [0, [3.2, 8], [3.6, 2.2]], bl: [0, [-3, 8], [-4, 2.2]] },
    // Knees up, arms swinging: the two halves of a step dance.
    dance2: { h: [0, 13.4], s: [0.5, 23.4], c: [1.1, 28.8], fa: [0, [4.2, 19.2], [3.8, 16]], ba: [0, [-3.2, 18], [-2, 14.6]], fl: [0, [3.8, 12.2], [3.2, 7.4]], bl: [0, [-1, 7.8], [-1.4, 2.2]], ff: [0.4, -0.9] },
    dance3: { h: [0, 13.4], s: [0.5, 23.4], c: [1.1, 28.8], fa: [0, [3.8, 18], [1.6, 15]], ba: [0, [-1.4, 19.6], [1.2, 17.8]], fl: [0, [1, 7.8], [1.4, 2.2]], bl: [0, [2.4, 12.4], [2, 7.4]], bf: [0.4, -0.9] },
    // Trainers holding the stretcher's handles.
    carry:  { h: [0, 13.1], s: [0.4, 23.1], c: [1, 28.5], fa: [0, [3.9, 16.8], [6.6, 13.8]], ba: [0, [2.4, 17.2], [5.6, 13.9]], fl: [0, [1.4, 7.6], [2, 2.2]], bl: [0, [-1.4, 7.6], [-2.2, 2.2]] },
  };
  // A stride in eight frames. Each gait's feet follow one closed path — [phase, x, the ankle's height,
  // the foot's angle in degrees] with the near foot coming down at phase 0 — and the far foot runs half
  // a stride behind. The body leans `lean` degrees and bobs twice a stride (`bob`: [hip height, amount,
  // the phase it tops out]); the arms swing `arm` degrees against the legs, the elbows bent `flex`
  // degrees plus the second number times the swing (more when the arm is forward). `tuck` carries the
  // ball in the near arm; `handles` holds a stretcher's handles out in front; the backpedal's path runs
  // forward under him as he goes backward.
  const RA_GAITS = {
    walk:  { lean: 3, bob: [13, 0.25, 0.25], arm: 20, flex: [14, 8], path: [[0, 2.8, 2.2, 14], [0.25, 0.4, 2.2, 0], [0.5, -1.8, 2.2, 0], [0.62, -2.8, 2.6, -30], [0.8, -0.6, 3.6, -12], [0.92, 2, 3, 6]] },
    jog:   { lean: 10, bob: [12.8, 0.4, 0.42], arm: 32, flex: [92, 18], path: [[0, 3.4, 2.2, 12], [0.16, 0.8, 2.2, 0], [0.32, -2.4, 2.3, -20], [0.42, -3.6, 2.8, -45], [0.58, -3.4, 5.6, -70], [0.76, 1, 6.6, -30], [0.9, 3.8, 4, 8]] },
    run:   { lean: 20, bob: [12.6, 0.6, 0.42], arm: 46, flex: [96, 26], path: [[0, 4.2, 2.3, 14], [0.14, 1.4, 2.2, 0], [0.3, -2.8, 2.4, -25], [0.4, -4.8, 3.4, -55], [0.55, -4.4, 7.6, -80], [0.72, 1.2, 8.6, -35], [0.87, 5.2, 5.2, 10]] },
    carry: { lean: 17, bob: [12.6, 0.55, 0.42], arm: 44, flex: [96, 26], tuck: 1, path: [[0, 4, 2.3, 14], [0.14, 1.3, 2.2, 0], [0.3, -2.7, 2.4, -25], [0.4, -4.6, 3.3, -55], [0.55, -4.2, 7.3, -80], [0.72, 1.2, 8.2, -35], [0.87, 5, 5, 10]] },
    back:  { lean: 18, bob: [11.4, 0.3, 0.15], arm: 14, flex: [95, 8], path: [[0, -2.6, 2.2, 0], [0.3, 0.2, 2.2, 0], [0.45, 2.2, 2.4, -20], [0.62, 1.6, 4.4, -25], [0.85, -1.6, 3.8, -10]] },
    crun:  { lean: 4, bob: [12.8, 0.3, 0.42], arm: 0, flex: [0, 0], handles: 1, path: [[0, 3.2, 2.2, 12], [0.16, 0.8, 2.2, 0], [0.32, -2.2, 2.3, -20], [0.42, -3.2, 2.8, -45], [0.58, -3, 5, -60], [0.76, 0.8, 5.8, -25], [0.9, 3.4, 3.8, 8]] },
  };
  const RA_STRIDE = 8;
  function raGait(name, i) {
    const G = RA_GAITS[name], q = i / RA_STRIDE, rad = Math.PI / 180;
    // The path, as a closed Catmull-Rom curve through its points.
    const at = (ph) => {
      const P = G.path, n = P.length;
      ph = ((ph % 1) + 1) % 1;
      let k = n - 1;
      for (let j = 0; j < n; j++) if (P[j][0] <= ph) k = j;
      const p1 = P[k], p2 = P[(k + 1) % n], p0 = P[(k + n - 1) % n], p3 = P[(k + 2) % n];
      const span = ((p2[0] - p1[0]) + 1) % 1 || 1, u = (((ph - p1[0]) + 1) % 1) / span;
      const cr = (a, b, c, d) => 0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
      return [cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2]), p1[3] + (p2[3] - p1[3]) * u];
    };
    const hy = G.bob[0] + G.bob[1] * Math.cos(4 * Math.PI * (q - G.bob[2]));
    const th = G.lean * rad, h = [0, hy], s = [Math.sin(th) * 10, hy + Math.cos(th) * 10];
    const c = [s[0] + Math.sin(th * 0.6) * 5.4, s[1] + Math.cos(th * 0.6) * 5.4];
    const foot = (ph) => { const [x, y, a] = at(ph); return { end: [x, y], f: [Math.cos(a * rad), Math.sin(a * rad)] }; };
    const nf = foot(q), bf = foot(q + 0.5);
    // The arms from the shoulders: the upper arm `ang` from straight down (forward positive), the
    // forearm bent `flex` further. (raRig puts the shoulders on the spine.)
    const arm = (ang, flex) => {
      const el = [Math.sin(ang) * 6, -Math.cos(ang) * 6];
      return [0, el, [el[0] + Math.sin(ang + flex) * 4.6, el[1] - Math.cos(ang + flex) * 4.6]];
    };
    const sw = Math.cos(2 * Math.PI * q) * G.arm;               // the near arm is back as the near foot lands
    const flex = (v) => (G.flex[0] + G.flex[1] * (v / (G.arm || 1))) * rad;
    let fa = arm(-sw * rad + th, flex(-sw)), ba = arm(sw * rad + th, flex(sw));
    if (G.tuck) fa = arm(-0.32 + th, 2.1);                      // the ball tucked high and tight
    if (G.handles) { fa = [0, [2.2, -5.3], [4.9, -8.3]]; ba = [0, [3.3, -4.9], [6.3, -8.2]]; }
    // (Arm points relative to the shoulder; raRig moves them onto it.)
    return { h, s, c, hr: name === 'back' ? 0 : G.lean * 0.6, rel: 1, fa, ba, fl: [0, [nf.end[0] + 3, (hy + nf.end[1]) / 2 + 1], nf.end], bl: [0, [bf.end[0] + 3, (hy + bf.end[1]) / 2 + 1], bf.end], ff: nf.f, bf: bf.f };
  }
  for (const name of Object.keys(RA_GAITS)) for (let i = 0; i < RA_STRIDE; i++) RA_SKEL[name + (i + 1)] = raGait(name, i);
  // The rig: fixed bone lengths for every frame, so nothing grows or shrinks from one frame to the next.
  // The spine runs `tl` (10) from the hips, the head's centre sits `nl` (5.4) above it; the shoulders and
  // hips are set on the body; each arm and leg reaches for its end, bending its middle joint the way
  // the pose drew it.
  const RA_BONE = { thigh: 5.9, shin: 5.2, upper: 6, fore: 4.6 };
  function raRig(P) {
    const d = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    const along = (a, b, L) => { const k = L / d(a, b); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; };
    const h = P.h, s = along(h, P.s, P.tl || 10), c = along(s, P.c, P.nl || 5.4);
    const up = [(s[0] - h[0]) / (P.tl || 10), (s[1] - h[1]) / (P.tl || 10)], fw = [up[1], -up[0]];
    const on = (o, k) => [o[0] + fw[0] * k[0] + up[0] * k[1], o[1] + fw[1] * k[0] + up[1] * k[1]];
    const solve = (root, hint, end, l1, l2) => {
      const D = d(root, end), dd = Math.min(D, l1 + l2 - 0.02), t = along(root, end, dd);
      const al = Math.acos(clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1)), base = Math.atan2(t[1] - root[1], t[0] - root[0]);
      const m1 = [root[0] + Math.cos(base + al) * l1, root[1] + Math.sin(base + al) * l1];
      const m2 = [root[0] + Math.cos(base - al) * l1, root[1] + Math.sin(base - al) * l1];
      return [root, d(m1, hint) <= d(m2, hint) ? m1 : m2, t];
    };
    const shN = on(s, P.fo || [3.2, -1.8]), shF = on(s, P.bo || [-3, -1.8]), hpN = [h[0] + 1.2, h[1]], hpF = [h[0] - 1.2, h[1]];
    const rel = (A, o) => (P.rel ? A.map((p) => (Array.isArray(p) ? [p[0] + o[0], p[1] + o[1]] : p)) : A);
    const fa = rel(P.fa, shN), ba = rel(P.ba, shF);
    return { ...P, h, s, c,
      fa: solve(shN, fa[1], fa[2], RA_BONE.upper, RA_BONE.fore), ba: solve(shF, ba[1], ba[2], RA_BONE.upper, RA_BONE.fore),
      fl: solve(hpN, P.fl[1], P.fl[2], RA_BONE.thigh, RA_BONE.shin), bl: solve(hpF, P.bl[1], P.bl[2], RA_BONE.thigh, RA_BONE.shin) };
  }
  for (const k of Object.keys(RA_SKEL)) RA_SKEL[k] = raRig(RA_SKEL[k]);
  const RA_FW = 34, RA_FH = 40, RA_FAX = 17, RA_FAY = 38;   // sprite grid; the feet stand on (17, 38)
  const RA_FIG = new Map();
  function raFig(pose, variant = 'p') {
    const key = pose + '|' + variant;
    let f = RA_FIG.get(key);
    if (f) return f;
    const S = RA_SKEL[pose] || RA_SKEL.stand;
    const W = RA_FW, H = RA_FH, AX = RA_FAX, AY = RA_FAY;
    const g = new Array(W * H).fill('.');
    const Lx = 0.45, Ly = 0.89;                                    // light: from above, a little in front
    const MAT = { J: 'J', j: 'J', L: 'J', P: 'P', p: 'P', Q: 'P', S: 'S', s: 'S', F: 'F', f: 'F', E: 'F', B: 'B', b: 'B', C: 'C', c: 'C' };
    const SHADE = { J: 'j', P: 'p', S: 's', F: 'f', B: 'B', C: 'c' };
    // fn(x, y) at each cell's centre: a code to paint, 0 for nothing, 1 for the part's rim (a cast
    // shadow in the shade of whatever is already there, or a dark line with `dark`).
    const paint = (fn, dark) => {
      for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
        const i = gy * W + gx, v = fn(gx + 0.5 - AX, AY - gy - 0.5);
        if (v === 1) { const c = g[i]; if (c !== '.' && c !== 'O') g[i] = dark ? 'O' : SHADE[MAT[c]] || c; }
        else if (v) g[i] = v;
      }
    };
    const near = (x, y, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], u = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      return [x - a[0] - dx * u, y - a[1] - dy * u, u];
    };
    // A capsule from a to b, r0 thick at a and r1 at b, in tones T = [base, shadow, light]: the side
    // away from the light is in shadow, the side toward it (on a part with a light tone) lit.
    const limb = (a, b, r0, r1, T, rim, lo = -0.3, hi = 0.6) => paint((x, y) => {
      const [dx, dy, u] = near(x, y, a, b), r = r0 + (r1 - r0) * u, d = Math.hypot(dx, dy);
      if (d <= r) { const k = (dx * Lx + dy * Ly) / r; return k < lo ? T[1] : T[2] && k > hi ? T[2] : T[0]; }
      return rim && d <= r + 0.95 ? 1 : 0;
    });
    const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
    const TJ = ['J', 'j', 'L'], TP = ['P', 'p', null], TS = ['S', 's', null], TF = ['F', 'f', null], TB = ['B', 'B', 'b'];
    const far = (t) => [t[1], t[1], null];
    const pads = variant === 'p';
    const arm = (A, isFar) => {
      const [sh, el, hd] = A, sleeve = lerp(sh, el, pads ? 0.42 : 0.55), T = (t) => (isFar ? far(t) : t);
      limb(sh, sleeve, pads ? 2.5 : 2, 2, T(TJ), !isFar);
      limb(sleeve, el, 1.75, 1.55, T(TF), !isFar);
      limb(el, hd, 1.55, 1.35, T(TF), !isFar);
      limb(hd, hd, 1.6, 1.6, T(TF), false);
    };
    const leg = (A, fd, isFar) => {
      const [hp, kn, an] = A, T = (t) => (isFar ? far(t) : t);
      const dir = fd || [1, 0], dl = Math.hypot(dir[0], dir[1]) || 1;
      let ux = dir[0] / dl, uy = dir[1] / dl;
      // A toe pointed into the ground bends up at the ankle until it rests on it.
      if (an[1] + uy * 2.7 < 1.1) { uy = Math.min(0, (1.1 - an[1]) / 2.7); ux = Math.sign(ux || 1) * Math.sqrt(Math.max(0, 1 - uy * uy)); }
      const sole = [-uy * 0.5, ux * 0.5];                            // toward the sole, off the foot's axis
      limb([an[0] - ux * 0.8 - sole[0], an[1] - uy * 0.8 - sole[1]], [an[0] + ux * 2.7 - sole[0], an[1] + uy * 2.7 - sole[1]], 1.2, 1.05, isFar ? ['B', 'B', null] : TB, !isFar);
      limb(lerp(kn, an, 0.1), an, 1.55, 1.25, T(TS), !isFar);
      limb(hp, lerp(kn, an, 0.2), 2.55, 1.95, T(TP), !isFar);
    };
    arm(S.ba, true);
    leg(S.bl, S.bf, true);
    // Torso: from the hips up the spine. The seat and waist are pants; above them the jersey, deeper at
    // the chest; on a player the shoulder pads stand out over it front and back.
    {
      const [hx, hy] = S.h, [sx, sy] = S.s, ax = sx - hx, ay = sy - hy, len = Math.hypot(ax, ay) || 1;
      const ux = ax / len, uy = ay / len, px = uy, py = -ux;
      paint((x, y) => {
        const rx = x - hx, ry = y - hy, v = (rx * ux + ry * uy) / len, w = rx * px + ry * py;
        if (v < -0.3 || v > 1.16) return 0;
        let hf, hb;
        if (v < 0.22) { hf = 3.6; hb = 3.9; }
        else if (v < 0.7) { const q = (v - 0.22) / 0.48; hf = 3.6 + q * 1.7; hb = 3.9 + q * 1.5; }
        else { hf = pads ? 7 : 5.4; hb = pads ? 6.8 : 5.4; }
        if (v > 0.96) { const q = (v - 0.96) / 0.2, k = Math.sqrt(Math.max(0, 1 - q * q)); hf *= k; hb *= k; }
        if (v < 0) { const q = -v / 0.3, k = Math.sqrt(Math.max(0, 1 - q * q)); hf *= k; hb *= k; }
        if (w > hf || w < -hb) return 0;
        if (v < 0.17) return w < -hb * 0.5 ? 'p' : 'P';
        if (pads && v > 0.88 && w > -hb * 0.2) return 'L';            // the shoulders catch the light
        return w < -hb * 0.58 ? 'j' : 'J';
      });
    }
    leg(S.fl, S.ff, false);
    limb(lerp(S.s, S.c, 0.2), lerp(S.s, S.c, 0.55), 1.7, 1.6, TF, false);   // neck
    // Head, tilted `hr` degrees forward (or as the neck leans): x forward, y up in its own frame. A tilt
    // under 14 degrees is drawn upright on the same sub-pixel footing in every frame, so the helmet, its
    // mask and its logo come out the same pixels frame to frame instead of shimmering. A head tilted
    // further (diving, lying down) keeps its exact place, which that pose's mask was laid out for.
    const hl = [];                                                    // the shell's cells: index, x, y in the head's frame
    {
      const lean0 = S.hr != null ? S.hr * Math.PI / 180 : Math.atan2(S.c[0] - S.s[0], S.c[1] - S.s[1]) * 0.6;
      const up = Math.abs(lean0) < 14 * Math.PI / 180, lean = up ? 0 : lean0;
      const cx = up ? Math.round(S.c[0] - 0.9) + 0.9 : S.c[0], cy = up ? Math.round(S.c[1] - 0.5) + 0.5 : S.c[1];
      const cs = Math.cos(lean), sn = Math.sin(lean);
      const loc = (x, y) => { const dx = x - cx, dy = y - cy; return [dx * cs - dy * sn, dx * sn + dy * cs]; };
      if (variant === 'm') paint((x, y) => {                          // trainers: bare head, short hair
        const [lx, ly] = loc(x, y), d = Math.hypot(lx / 3.4, ly / 3.8);
        if (d > 1) return d <= 1.28 ? 1 : 0;
        if (ly > 1.2 || (lx < -1.3 && ly > -1.3)) return ly > 2.4 ? 'c' : 'C';
        if (lx > 1.5 && lx < 2.5 && ly > -0.5 && ly < 0.5) return 'e';
        return lx < -0.4 || ly < -2.4 ? 'f' : 'F';
      }, true);
      else if (variant === 'r') paint((x, y) => {                     // officials: a white cap with a brim
        const [lx, ly] = loc(x, y), d = Math.hypot(lx / 3.4, ly / 3.8);
        if (ly > 0.9 && ly < 2.1 && lx > 0.8 && lx < 5.2) return 'C';
        if (d > 1) return d <= 1.28 ? 1 : 0;
        if (ly > 0.9) return ly > 3 || lx < -2.6 ? 'c' : 'C';
        if (lx > 1.5 && lx < 2.5 && ly > -0.5 && ly < 0.5) return 'e';
        return lx < -0.4 || ly < -2.4 ? 'f' : 'F';
      }, true);
      else paint((x, y) => {
        const [lx, ly] = loc(x, y);
        // The facemask, light grey, one pixel thick with dark gaps between its bars: a front bar standing off
        // the face, joined to the brow at the top, a short bar across at the nose and one under the chin.
        // (Sized to the upright head's pixel rows, which fall on whole numbers here.)
        if (lx > 5.1 && lx < 6.1 && ly > -4.5 && ly < 1.5) return 'm';
        if (lx > 4.1 && lx < 6.1 && ((ly > 0.5 && ly < 1.5) || (ly > -2.5 && ly < -1.5))) return 'm';
        if (lx > 2.1 && lx < 6.1 && ly > -4.5 && ly < -3.5) return 'm';
        const nx = (lx + 0.5) / 5.2, ny = (ly - 0.35) / 4.8, d = Math.hypot(nx, ny);
        if (d > 1) return d <= 1.18 ? 1 : 0;
        // The opening: the brow's shadow across its top, the eye under it, the face (shaded toward the
        // ear and at the chin), the jaw pad of the shell below.
        if (lx > 0.9 && ly > -3.5 && ly < 0.5) return ly > -0.5 ? 'k' : lx > 2.1 && lx < 3.1 && ly > -1.5 ? 'e' : lx < 2.1 || ly < -2.5 ? 'f' : 'F';
        hl.push((AY - y - 0.5) * W + (x + AX - 0.5), lx, ly);          // (where on the helmet's side it is, for the logo)
        return 'H';
      }, true);
    }
    arm(S.fa, false);
    // A lone pixel of a tone in a patch of another tone of the same colour takes the patch's tone.
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? '.' : g[y * W + x]);
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const c = g[gy * W + gx], m = MAT[c];
      if (!m) continue;
      const nb = [at(gx - 1, gy), at(gx + 1, gy), at(gx, gy - 1), at(gx, gy + 1)].filter((q) => MAT[q] === m);
      if (nb.length >= 3 && !nb.includes(c)) {
        const cnt = {}; for (const q of nb) cnt[q] = (cnt[q] || 0) + 1;
        g[gy * W + gx] = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p])[0];
      }
    }
    // Outline: every empty cell touching the figure.
    const out = g.slice();
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const i = gy * W + gx;
      if (g[i] !== '.') continue;
      if ((gx > 0 && g[i - 1] !== '.') || (gx < W - 1 && g[i + 1] !== '.') || (gy > 0 && g[i - W] !== '.') || (gy < H - 1 && g[i + W] !== '.')) out[i] = 'O';
    }
    // Where the number goes: on the jersey, a little behind the middle of the back.
    let num = null;
    if (!S.noNum) { const c = lerp(S.h, S.s, 0.56); num = [Math.round(AX + c[0] - 1.1), Math.round(AY - c[1] - 2.5)]; }
    f = { g: out, W, H, ax: AX, ay: AY, num, hl };
    RA_FIG.set(key, f);
    return f;
  }

  // raSprite: the source's player branch (no cheerleader maps, no officials' stripes, no trainers'
  // cross), helmet logo included, verbatim. Added here: the painted pixels' box (c.bb), which this
  // page's hit-testing, brackets, bubble tails and spotlight read.
  const RA_SPR = new Map();
  const raRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  function raSprite(pose, pal, flip, num) {
    const key = pose + '|' + (pal.variant || 'p') + '|' + (pal.key || (pal.key = Object.entries(pal).filter(([k]) => k.length === 1).map((e) => e.join(':')).join())) + '|' + (flip ? 1 : 0) + '|' + (num ?? '') + '|' + (pal.logoKey || '');
    let c = RA_SPR.get(key);
    if (c) { RA_SPR.delete(key); RA_SPR.set(key, c); return c; }       // (the most recently used last)
    if (RA_SPR.size >= 2400) for (const k of [...RA_SPR.keys()].slice(0, 600)) RA_SPR.delete(k);
    c = document.createElement('canvas');
    const g = c.getContext('2d');
    const f = raFig(pose, pal.variant);
    c.width = f.W; c.height = f.H;
    const img = g.createImageData(f.W, f.H), d = img.data;
    const rgb = pal.rgb || (pal.rgb = Object.fromEntries(Object.entries(pal).filter(([k, v]) => k.length === 1 && typeof v === 'string').map(([k, v]) => [k, raRGB(v)])));
    const set = (x, y, col) => { const i = (y * f.W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const ch = f.g[y * f.W + x];
      if (ch === '.') continue;
      const col = rgb[ch] || [255, 0, 255];
      set(flip ? f.W - 1 - x : x, y, col);
    }
    // The number goes on after the flip so it never reads backwards, and only onto jersey cells.
    if (num != null && f.num && rgb.n) {
      const s = String(num), w = s.length * 4 - 1;
      const x0 = f.num[0] - Math.floor(w / 2), fx0 = flip ? f.W - (x0 + w) : x0;
      for (let k = 0; k < s.length; k++) {
        const gl = RA_GLYPHS[s[k]];
        for (let i = 0; i < 15; i++) {
          if (gl[i] !== '1') continue;
          const fx = fx0 + k * 4 + (i % 3), y = f.num[1] + Math.floor(i / 3);
          const sx = flip ? f.W - 1 - fx : fx, ch = f.g[y * f.W + sx];
          if (ch === 'J' || ch === 'j' || ch === 'L') set(fx, y, rgb.n);
        }
      }
    }
    // The team's helmet logo, painted onto the shell's cells only, each from where it sits on the side
    // of the helmet: an animal or a bolt turns with the player so it faces forward on both sides, as on
    // real helmets; letters never read backwards; a logo worn on one side only shows on that side.
    const lg = pal.logo;
    if (lg && f.hl.length && !(lg.side === 'r' && flip)) {
      const rgbL = lg.rgb || (lg.rgb = Object.fromEntries(Object.entries(lg.c).map(([k, v]) => [k, raRGB(v)])));
      for (let k = 0; k < f.hl.length; k += 3) {
        const i = f.hl[k];
        if (f.g[i] !== 'H') continue;                               // (an arm across the helmet)
        let u = Math.floor(f.hl[k + 1] - RA_LOGO_BOX[0]);
        const v = Math.floor(RA_LOGO_BOX[1] - f.hl[k + 2]);
        if (u < 0 || v < 0 || u >= RA_LOGO_W || v >= RA_LOGO_H) continue;
        if (lg.text && flip) u = RA_LOGO_W - 1 - u;
        const ch = lg.px[v][u];
        if (ch === '.') continue;
        const x = i % f.W, y = (i - x) / f.W;
        set(flip ? f.W - 1 - x : x, y, rgbL[ch]);
      }
    }
    g.putImageData(img, 0, 0);
    c.ax = flip ? f.W - f.ax : f.ax; c.ay = f.ay;
    // (this page) The painted pixels' box (sprite pixels), for hit-testing what the eye actually sees.
    let x0 = f.W, y0 = f.H, x1 = -1, y1 = -1;
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) if (d[(y * f.W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    c.bb = { x0, y0, x1: x1 + 1, y1: y1 + 1 };
    RA_SPR.set(key, c);
    return c;
  }
  // The football: an oval with laces, lit from above, in eight turns so a kick can tumble end over end.
  const RA_BALL = [];
  function raBallSprite(k) {
    if (RA_BALL[k]) return RA_BALL[k];
    const S = 16, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
    const ang = (k * Math.PI) / 8, cs = Math.cos(ang), sn = Math.sin(ang), A = 4.2, B = 2.55;   // (a little smaller since the 2026-09-29 redraw: it sits in the hands)
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

  /* ═════ copied: kits, helmet logos and palettes ═════ */
  const raContrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const RA_WHITE = '#f2f2f0';
  // Real 2026-season primary home and road uniforms, researched 2026-09-28 (user: "get real kits...
  // away teams should wear white jerseys, primary team color as the pants... home teams should wear
  // primary jersey color, white pants and their official helmet" — then corrected on research: ESPN's
  // `team.color` is often not the jersey colour at all (Denver's is navy, but the home jersey is
  // orange), several teams (Dallas) wear white at HOME by tradition, and 2026 brought real uniform
  // redesigns (Atlanta's red jersey returns, Baltimore "Next Flight", Tennessee's Oilers-blue/white-
  // helmet rebrand, Washington's burgundy/gold rebrand, Houston's "Deep Steel Blue"). Sources and notes
  // per team: docs/sunday.md (2026-09-28 entry). jersey/pants/helmet/num are the standard, non-alternate
  // set; `homeWhite` marks a team whose own standard home jersey is white (so its `road` entry, below,
  // is the colored one it wears on the road).
  const RA_KITS = {
    ARI: { home: { jersey: '#97233F', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#97233F', helmet: '#f2f2f0', num: '#97233F' } },
    ATL: { home: { jersey: '#A71930', pants: '#FFFFFF', helmet: '#101820', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#101820', num: '#A71930' } }, // 2026 redesign: red jersey returns as home primary
    BAL: { home: { jersey: '#241773', pants: '#241773', helmet: '#101014', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#101014', num: '#241773' } }, // "Next Flight" (Apr 2026): monochrome purple / monochrome white, matte-black helmet both ways
    BUF: { home: { jersey: '#00338D', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#00338D', helmet: '#f2f2f0', num: '#00338D' } },
    CAR: { home: { jersey: '#101820', pants: '#FFFFFF', helmet: '#a5acaf', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#a5acaf', num: '#101820' } },
    CHI: { home: { jersey: '#0B162A', pants: '#FFFFFF', helmet: '#0b162a', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#0B162A', helmet: '#0b162a', num: '#0B162A' } },
    CIN: { home: { jersey: '#101820', pants: '#101820', helmet: '#101014', num: '#FB4F14' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#101014', num: '#101820' } }, // standard set is all-black, not the orange "Open in Orange" one-off
    CLE: { home: { jersey: '#311D00', pants: '#FFFFFF', helmet: '#ff3c00', num: '#FF3C00' }, road: { jersey: '#FFFFFF', pants: '#311D00', helmet: '#ff3c00', num: '#311D00' } },
    DAL: { home: { jersey: '#FFFFFF', pants: '#8a98a8', helmet: '#8a98a8', num: '#002244' }, road: { jersey: '#002244', pants: '#8a98a8', helmet: '#8a98a8', num: '#FFFFFF' }, homeWhite: true }, // white at home since the 1960s
    DEN: { home: { jersey: '#FB4F14', pants: '#FFFFFF', helmet: '#0a2343', num: '#0a2343' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#0a2343', num: '#FB4F14' } }, // 2024 "Mile High": orange jersey/white pants at home, navy helmet — the case the user flagged
    DET: { home: { jersey: '#0076B6', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#0076B6' } },
    GB: { home: { jersey: '#203731', pants: '#ffb612', helmet: '#ffb612', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#ffb612', helmet: '#ffb612', num: '#203731' } }, // never wears white pants
    HOU: { home: { jersey: '#03202f', pants: '#FFFFFF', helmet: '#03202f', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#03202f', helmet: '#03202f', num: '#03202f' } }, // 2024 redesign: "Deep Steel Blue" jersey and helmet
    IND: { home: { jersey: '#002C5F', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#002C5F', helmet: '#f2f2f0', num: '#002C5F' } },
    JAX: { home: { jersey: '#006778', pants: '#101820', helmet: '#101820', num: '#D7A22A' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#101820', num: '#101820' } },
    KC: { home: { jersey: '#E31837', pants: '#FFFFFF', helmet: '#e31837', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#E31837', helmet: '#e31837', num: '#E31837' } },
    LV: { home: { jersey: '#101820', pants: '#101820', helmet: '#a5acaf', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#a5acaf', num: '#101820' } }, // helmet is silver, not black
    LAC: { home: { jersey: '#0080C6', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFC20E' }, road: { jersey: '#FFFFFF', pants: '#002A5E', helmet: '#f2f2f0', num: '#0080C6' } }, // powder blue is the standard home jersey, navy "Super Chargers" is the alternate
    LAR: { home: { jersey: '#003594', pants: '#FFFFFF', helmet: '#003594', num: '#FFD100' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#003594', num: '#003594' } },
    MIA: { home: { jersey: '#008E97', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#008E97', helmet: '#f2f2f0', num: '#008E97' } },
    MIN: { home: { jersey: '#4F2683', pants: '#FFFFFF', helmet: '#4f2683', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#4F2683', helmet: '#4f2683', num: '#4F2683' } },
    NE: { home: { jersey: '#002244', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#002244' } },
    NO: { home: { jersey: '#101820', pants: '#101820', helmet: '#d3bc8d', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#d3bc8d', num: '#101820' } },
    NYG: { home: { jersey: '#0B2265', pants: '#FFFFFF', helmet: '#0b2265', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#0b2265', num: '#0B2265' } },
    NYJ: { home: { jersey: '#115740', pants: '#FFFFFF', helmet: '#115740', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#115740', helmet: '#115740', num: '#115740' } }, // "Legacy" green shell is standard; the all-white shell is a 2026 special-game alternate
    PHI: { home: { jersey: '#004C54', pants: '#FFFFFF', helmet: '#004c54', num: '#A5ACAF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#004c54', num: '#004C54' } }, // home pants white, not black: onpattison.com 2025 uniform schedule (Week 1 vs DAL: midnight green / white / midnight green)
    PIT: { home: { jersey: '#000000', pants: '#FFB612', helmet: '#101014', num: '#FFB612' }, road: { jersey: '#FFFFFF', pants: '#000000', helmet: '#101014', num: '#000000' } },
    SF: { home: { jersey: '#AA0000', pants: '#b3995d', helmet: '#b3995d', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b3995d', helmet: '#b3995d', num: '#AA0000' } },
    SEA: { home: { jersey: '#002244', pants: '#002244', helmet: '#002244', num: '#69BE28' }, road: { jersey: '#FFFFFF', pants: '#002244', helmet: '#002244', num: '#002244' } }, // all college navy at home, pants included (seahawks.com uniform announcements, 2025)
    TB: { home: { jersey: '#D50A0A', pants: '#3d3935', helmet: '#3d3935', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#3d3935', helmet: '#3d3935', num: '#D50A0A' } },
    TEN: { home: { jersey: '#4495D2', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#4495D2' } }, // Mar 2026 Oilers-blue rebrand: white helmet (and facemask) for the first time
    WSH: { home: { jersey: '#5A1414', pants: '#FFB612', helmet: '#5a1414', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFB612', helmet: '#5a1414', num: '#5A1414' } }, // Apr 2026 rebrand: gloss-burgundy helmet, gold facemask, gold pants both ways
  };
  // Helmet logos (2026-09-29, user: "i know we dont have a lot of pixels to work with but lets take a run
  // at making logos on the helmets"). Each is drawn facing forward (right) in a 7-by-7 box on the side
  // of the shell behind the face opening (RA_LOGO_BOX: its top-left corner in the head's own frame),
  // one character a pixel, '.' the shell. On an upright helmet the shell's curve trims five cells, the
  // top-left corner (row 0 columns 0-1, rows 1-2 column 0) and row 6 column 0; the rest all show.
  // `text` logos (letters) never mirror; the rest turn with the player so they face forward on both
  // sides. `side: 'r'`: worn on the right side only (the Steelers), so seen only when he faces right.
  // The Browns' helmet has no logo. 2026 designs: the Titans' sword-T on a light-blue shield, the
  // Commanders' gold W, the Falcons' falcon on low-gloss black, the Ravens' raven head (sources:
  // docs/sunday.md, 2026-09-29). Two are stand-ins: the Texans' bull is drawn head-on, horns up (the
  // real one is side-on, and at seven pixels a side-on bull read as a red heart), and the Jets' wordmark
  // has four letters too many for seven pixels, so they wear a jet.
  const RA_LOGO_BOX = [-5.9, 4.5], RA_LOGO_W = 7, RA_LOGO_H = 7;
  const RA_LOGO = {
    ARI: { c: { r: '#97233F', k: '#101010', y: '#FFB612', w: '#ffffff' }, px: ['...rr..', '..rrr..', '.rrrrk.', 'rrrrkwy', '.rrrkyy', '..rrr..', '...r...'] },
    ATL: { c: { r: '#A71930', w: '#ffffff' }, px: ['....rrr', '...rrw.', 'rrrrrr.', '.rrrrrw', '..rr...', '.rr....', '.r.....'] },
    BAL: { c: { p: '#5b3fb0', g: '#C9A227', w: '#ffffff', q: '#b8a6e0' }, px: ['..ppp..', '.ppppp.', '.pppwpp', '.pgpppq', '.pggppq', '..ppp..', '.......'] },
    BUF: { c: { b: '#00338D', r: '#C60C30' }, px: ['.......', 'rrrrr..', '.bbbbrr', 'bbbbbbb', '.bbbbbb', '.b.b.bb', '.b.b...'] },
    CAR: { c: { k: '#101820', b: '#0085CA', w: '#ffffff' }, px: ['..b....', '.bkbbb.', '.bkkkkb', '.bkbkkk', '.bkkkk.', '..bkww.', '...bb..'] },
    CHI: { c: { o: '#C83803' }, text: 1, px: ['...ooo.', '..oo.oo', '.oo....', '.oo....', '.oo....', '..oo.oo', '...ooo.'] },
    CIN: { c: { o: '#FB4F14' }, px: ['..ooo.o', '.oo..oo', 'oo..oo.', 'o..oo..', '..oo..o', '.oo..oo', 'oo..oo.'] },
    DAL: { c: { n: '#041E42' }, px: ['...n...', '...n...', '..nnn..', 'nnnnnnn', '.nnnnn.', '.nn.nn.', '.n...n.'] },
    DEN: { c: { o: '#FB4F14', w: '#ffffff' }, px: ['...oo..', '..oooo.', '.ooowoo', '.oooooo', '..ooooo', '..oo.oo', '..o....'] },
    DET: { c: { b: '#0076B6' }, px: ['.....bb', '....bbb', '..bbbbb', '.bbbbb.', 'bb.b.bb', 'b.....b', '.......'] },
    GB: { c: { g: '#203731', w: '#ffffff' }, text: 1, px: ['.ggggg.', 'gwwwwwg', 'gwggggg', 'gwggwwg', 'gwgggwg', 'gwwwwwg', '.ggggg.'] },
    HOU: { c: { r: '#A71930', w: '#ffffff' }, px: ['.......', '.w....w', '.ww..ww', '..rrrr.', '.rrrrrr', '..rrrr.', '...rr..'] },
    IND: { c: { b: '#002C5F' }, px: ['..bbbb.', '.bbbbbb', '.bb..bb', '.b....b', '.b....b', '.b....b', '.bb..bb'] },
    JAX: { c: { g: '#D7A22A', t: '#006778', k: '#101820' }, px: ['.gg....', '.ggggg.', 'gggkggg', '.gggggg', '..ggtgg', '...ggg.', '.......'] },
    KC: { c: { w: '#ffffff', r: '#E31837' }, px: ['.......', '.wwww..', '.wrwrw.', '.wrrwrw', '.wrwrw.', '.wwww..', '.......'] },
    LV: { c: { k: '#101820', w: '#ffffff' }, text: 1, px: ['.kkkkk.', '.kwwwk.', '.kwkwk.', '.kkkkk.', '.kkkkk.', '..kkk..', '...k...'] },
    LAC: { c: { y: '#FFC20E', b: '#0080C6' }, px: ['.......', 'bbbbb..', 'byyyyb.', '.byyyyb', '...byyy', '....byy', '.....by'] },
    LAR: { c: { y: '#FFD100' }, px: ['..yyyyy', '.yy....', 'yy.yy..', 'y.y..y.', 'y..yy..', '.yy....', '.......'] },
    MIA: { c: { a: '#008E97', o: '#FC4C02' }, px: ['.......', '..ooo..', '.ooaaa.', 'ooaaaaa', '.aaa.oo', '..ooo..', '.......'] },
    MIN: { c: { w: '#ffffff', g: '#FFC62F' }, px: ['.......', '.....ww', '....wwg', '...wwg.', '.wwwg..', 'wwgg...', 'gg.....'] },
    NE: { c: { n: '#002244', r: '#C60C30', w: '#ffffff' }, px: ['.......', '..rrrr.', '.rwwwnn', 'rwnnnnn', '.nnnnnn', '..nnnn.', '.......'] },
    NO: { c: { k: '#101820' }, px: ['.......', '...k...', '..kkk..', 'k.kkk.k', 'kk.k.kk', '.kkkkk.', '...k...'] },
    NYG: { c: { w: '#ffffff' }, text: 1, px: ['.......', '.......', '.......', 'ww..w.w', 'w.w.w.w', 'w.w..ww', '....ww.'] },
    NYJ: { c: { w: '#ffffff' }, px: ['...w...', '...ww..', '.w..ww.', '.wwwwww', '.w..ww.', '...ww..', '...w...'] },
    PHI: { c: { s: '#A5ACAF', w: '#ffffff' }, px: ['..sssss', '.ssswww', 'sswww..', 'sww....', 'w......', '.......', '.......'] },
    PIT: { c: { w: '#ffffff', k: '#101820', y: '#FFB612', r: '#C8102E', b: '#00539B' }, side: 'r', text: 1, px: ['..www..', '.wwwyw.', 'wwwwwww', 'wkkkwrw', 'wwwwwww', '.wwwbw.', '..www..'] },
    SF: { c: { r: '#AA0000', w: '#ffffff' }, text: 1, px: ['.rrrrr.', 'rwwrwwr', 'rwrrwrr', 'rwwrwwr', 'rrwrwrr', 'rwwrwrr', '.rrrrr.'] },
    SEA: { c: { s: '#A5ACAF', w: '#ffffff', g: '#69BE28' }, px: ['.......', '..ssss.', '.ssgssw', 'sssssww', '.sss...', '.......', '.......'] },
    TB: { c: { r: '#D50A0A', w: '#ffffff', k: '#1e1b18' }, px: ['.rrrrrk', 'rrwwrrk', 'rwwwrrk', 'rrwrrrk', '.rrrr.k', '......k', '.......'] },
    TEN: { c: { b: '#4B92DB', w: '#ffffff' }, text: 1, px: ['..bbb..', '.bbbbb.', 'bbbbbbb', 'bwwwwwb', 'bbbwbbb', '.bbwbb.', '..bbb..'] },
    WSH: { c: { y: '#FFB612' }, text: 1, px: ['.......', '.......', '.......', 'y.....y', 'y..y..y', 'y.y.y.y', '.y...y.'] },
  };
  // The generic fallback for a team not in RA_KITS: primary jersey/white pants at home, white
  // jersey/primary pants on the road, primary colour for a helmet nobody researched.
  function raGenericKit(t, home) {
    const prim = t.color, alt = t.alt, H = prim;
    const J = home ? prim : RA_WHITE, P = home ? RA_WHITE : prim;
    const n = home ? (raContrast(prim, '#ffffff') >= raContrast(prim, alt) ? '#ffffff' : alt)
      : raContrast(prim, RA_WHITE) >= 2.2 ? prim : raContrast(alt, RA_WHITE) >= 2.2 ? alt : '#1a1a1a';
    return { J, P, H, n };
  }
  // A number colour that reads on this pixel art even if the researched one is too close to the
  // jersey (the contrast the sprite's own outline pixel can't rescue).
  const raSafeNum = (num, jersey) => (raContrast(num, jersey) >= 2.2 ? num
    : raContrast('#ffffff', jersey) >= 2.2 ? '#ffffff' : raContrast('#111111', jersey) >= 2.2 ? '#111111' : num);
  // Both teams' real kits for this game: the home team in its home set, the visitors in their road
  // set — unless that pairs two white (or near-identical) jerseys, in which case the visitors switch to
  // their own colour jersey (their `home` entry), same as the NFL does.
  function raKit(homeT, roadT) {
    const upH = (homeT.abbr || '').toUpperCase(), upR = (roadT.abbr || '').toUpperCase();
    const KH = RA_KITS[upH], KR = RA_KITS[upR];
    const toEntry = (e, t) => ({ J: e.jersey, P: e.pants, H: e.helmet, n: raSafeNum(e.num, e.jersey) });
    const home = KH ? toEntry(KH.home, homeT) : raGenericKit(homeT, true);
    let road = KR ? toEntry(KR.road, roadT) : raGenericKit(roadT, false);
    if (cdist(home.J, road.J) < 40) {
      const swap = KR ? toEntry(KR.home, roadT) : raGenericKit(roadT, true);
      if (cdist(home.J, swap.J) >= 40) road = swap;
    }
    const brand = (t, k) => (k ? k.home.jersey : t.color);
    const withExtras = (e, t, k) => ({ ...e, w: [t.alt, e.J, '#ffffff', '#111111'].find((c) => raContrast(c, e.H) >= 1.9) || '#ffffff', S: brand(t, k) });
    return { home: withExtras(home, homeT, KH), road: withExtras(road, roadT, KR) };
  }
  // Facemasks are one light grey on every helmet (2026-09-29, user: "white face masks would help", then
  // "Lets go with light Grey face masks"): the one bright line in front of the face, whatever the shell's
  // colour, with the dark gaps between its bars keeping it off white and silver shells.
  const RA_MASK = '#d0d4d9';
  const raShade = (c) => mixHex(c, '#0a0c18', lum(c) > 0.6 ? 0.26 : 0.42);
  const raLight = (c) => (lum(c) > 0.6 ? '#ffffff' : mixHex(c, '#ffffff', lum(c) < 0.03 ? 0.22 : 0.3));
  const RA_SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#6b4226'];
  // A plausible number for the position, the same every time for the same man.
  function raNumber(role, seed) {
    const r = raRng(seed)();
    const pickIn = (ranges) => { const all = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)); return all[Math.floor(r * all.length)]; };
    return pickIn({ QB: [[1, 19]], K: [[1, 19]], RB: [[20, 39]], FB: [[40, 49]], WR: [[10, 19], [80, 88]], TE: [[80, 89]], OL: [[60, 79]], DL: [[90, 99], [50, 59]], LB: [[40, 58]], DB: [[20, 39]], BENCH: [[2, 99]] }[role] || [[10, 99]]);
  }
  // raPalette's team branch, taking the kit and the team's abbreviation directly instead of the scene.
  function raPalette(kit, idx, side, abbr) {
    const F = RA_SKIN[(idx * 7 + (side === 'o' ? 1 : 3)) % RA_SKIN.length];
    const { J, P, H, S } = kit;
    abbr = String(abbr || '').toUpperCase();
    return {
      logo: RA_LOGO[abbr] || null, logoKey: RA_LOGO[abbr] ? abbr : '',
      J, j: raShade(J), L: raLight(J), P, p: raShade(P), Q: raLight(P), H, h: raShade(H), l: raLight(H), w: kit.w,
      m: RA_MASK, k: '#1b1512', F, f: raShade(F), E: raLight(F), S, s: raShade(S),
      B: '#17181d', b: '#44464e', e: '#141414', n: kit.n, O: '#0d0e13',
    };
  }
  // Where the ball sits in a man's hands, by frame (sprite pixels, facing right, up from the ground):
  // in the near hand, between both hands for a two-handed hold, in the throwing (far) hand for a pass,
  // and on the ground under the center's hands for the snap.
  const RA_HOLD = {};
  {
    const two = ['catch', 'secure', 'qbSet', 'gun', 'qbUnder', 'hold', 'hold2', 'stance'], far = ['throw1', 'throw2', 'throw3'];
    for (const [k, S] of Object.entries(RA_SKEL)) {
      const n = S.fa[2], f = S.ba[2];
      RA_HOLD[k] = far.includes(k) ? [f[0] + 0.4, f[1] + 0.6] : two.includes(k) ? [(n[0] + f[0]) / 2 + 0.6, (n[1] + f[1]) / 2 + 0.3] : [n[0] + 0.6, n[1] + 0.4];
    }
    RA_HOLD.snap = [8, 1.6];
  }
  // A man's shadow on the grass: a small pixel ellipse under his feet, longer under a man lying down,
  // smaller the higher he is off the ground.
  const RA_FLAT = new Set(['down', 'dive', 'fall2']);
  function raShadow(g, X, Y, lift, flat) {
    const k = clamp(1 - lift / (26 * 2), 0.55, 1), w = Math.round((flat ? 14 : 9) * k), w1 = Math.round((flat ? 11 : 6) * k);
    g.fillStyle = 'rgba(0,30,0,0.35)';
    g.fillRect(X - w1, Y - 2, 2 * w1 + 1, 1); g.fillRect(X - w, Y - 1, 2 * w + 1, 2); g.fillRect(X - w1, Y + 1, 2 * w1 + 1, 1);
  }

  /* ═════ copied: end-zone paint (EZ, ezStyle from sd-app.js; raOutlined) ═════ */
  // Every team's own end zones, researched 2026-09-28 (user: "do some research on endzone styles for
  // each team, and the endzones should always reflect the home team, not be different on either
  // side"). Both end zones wear the HOME team's paint, as at a real stadium: [the one on the right of
  // the field views, the one on the left]; many teams put the nickname at one end and the city at the
  // other. Fill, pattern (a diagonal hatch stands in for Cincinnati's tiger stripes), lettering and
  // its outline, and whether the logo is painted beside the word. Sources and confidence per team:
  // docs/sunday.md (2026-09-28 entry). Solid on fill and words: BAL BUF CIN DEN GB LV MIN NE PHI PIT
  // SEA; the rest are broadcast recollection (MetLife and SoFi repaint per home team, so NYG/NYJ and
  // LAR/LAC each keep their own).
  const EZ = {
    ARI: { fill: '#97233F', words: ['CARDINALS', 'ARIZONA'], ink: '#FFFFFF', edge: '#000000' },
    ATL: { fill: '#000000', words: ['FALCONS', 'ATLANTA'], ink: '#FFFFFF', edge: '#A71930' },
    BAL: { fill: '#000000', words: ['RAVENS', 'BALTIMORE'], ink: '#FFFFFF', edge: null },
    BUF: { fill: '#00338D', words: ['BILLS', 'BUFFALO'], ink: '#FFFFFF', edge: '#C60C30' },
    CAR: { fill: '#101820', words: ['PANTHERS', 'CAROLINA'], ink: '#0085CA', edge: '#BFC0BF' },
    CHI: { fill: '#0B162A', words: ['BEARS', 'CHICAGO'], ink: '#C83803', edge: '#FFFFFF' },
    CIN: { fill: '#000000', pattern: '#FB4F14', words: ['BENGALS', 'CINCINNATI'], ink: '#FB4F14', edge: '#FFFFFF' },
    CLE: { fill: '#311D00', words: ['BROWNS', 'CLEVELAND'], ink: '#FF3C00', edge: '#FFFFFF' },
    DAL: { fill: '#003594', words: ['COWBOYS', 'DALLAS'], ink: '#FFFFFF', edge: '#869397', logo: true },
    DEN: { fill: '#002244', words: ['BRONCOS', 'BRONCOS'], ink: '#FB4F14', edge: '#FFFFFF', logo: true },
    DET: { fill: '#0076B6', words: ['LIONS', 'DETROIT'], ink: '#FFFFFF', edge: '#B0B7BC' },
    GB: { fill: '#203731', words: ['PACKERS', 'PACKERS'], ink: '#FFB612', edge: '#FFFFFF' },
    HOU: { fill: '#03202F', words: ['TEXANS', 'HOUSTON'], ink: '#FFFFFF', edge: '#A71930' },
    IND: { fill: '#002C5F', words: ['COLTS', 'INDIANAPOLIS'], ink: '#FFFFFF', edge: null, logo: true },
    JAX: { fill: '#101820', words: ['JAGUARS', 'JACKSONVILLE'], ink: '#006778', edge: '#D7A22A' },
    KC: { fill: '#E31837', words: ['CHIEFS', 'CHIEFS'], ink: '#FFFFFF', edge: '#FFB81C', logo: true },
    LV: { fill: '#000000', words: ['RAIDERS', 'LAS VEGAS'], ink: '#A5ACAF', edge: '#FFFFFF', logo: true },
    LAC: { fill: '#002A5E', words: ['CHARGERS', 'CHARGERS'], ink: '#0080C6', edge: '#FFC20E', logo: true },
    LAR: { fill: '#003594', words: ['RAMS', 'RAMS'], ink: '#FFFFFF', edge: '#FFA300', logo: true },
    MIA: { fill: '#008E97', words: ['DOLPHINS', 'MIAMI'], ink: '#FFFFFF', edge: '#FC4C02', logo: true },
    MIN: { fill: '#4F2683', words: ['VIKINGS', 'VIKINGS'], ink: '#FFFFFF', edge: '#FFC62F' },
    NE: { fill: '#002244', words: ['PATRIOTS', 'PATRIOTS'], ink: '#FFFFFF', edge: '#C60C30', logo: true },
    NO: { fill: '#101820', words: ['SAINTS', 'NEW ORLEANS'], ink: '#D3BC8D', edge: '#FFFFFF', logo: true },
    NYG: { fill: '#0B2265', words: ['GIANTS', 'NEW YORK'], ink: '#FFFFFF', edge: '#A71930', logo: true },
    NYJ: { fill: '#125740', words: ['JETS', 'NEW YORK'], ink: '#FFFFFF', edge: '#000000', logo: true },
    PHI: { fill: '#004C54', words: ['EAGLES', 'EAGLES'], ink: '#FFFFFF', edge: '#A5ACAF', logo: true },
    PIT: { fill: '#101820', words: ['STEELERS', 'PITTSBURGH'], ink: '#FFB612', edge: '#FFFFFF' },
    SF: { fill: '#AA0000', words: ['49ERS', '49ERS'], ink: '#FFFFFF', edge: '#B3995D', logo: true },
    SEA: { fill: '#002244', words: ['SEAHAWKS', 'SEAHAWKS'], ink: '#FFFFFF', edge: '#69BE28', logo: true },
    TB: { fill: '#D50A0A', words: ['BUCCANEERS', 'TAMPA BAY'], ink: '#FFFFFF', edge: '#34302B' },
    TEN: { fill: '#4B92DB', words: ['TITANS', 'TENNESSEE'], ink: '#FFFFFF', edge: '#0C2340', logo: true },
    WSH: { fill: '#5A1414', words: ['COMMANDERS', 'WASHINGTON'], ink: '#FFB612', edge: '#FFFFFF' },
  };
  // The home team's end-zone paint; a team not in the table gets its own colour and name, both ends.
  function ezStyle(home) {
    const e = EZ[String(home?.abbr || '').toUpperCase()];
    if (e) return e;
    const fill = teamInk(home), word = String(home?.name || home?.abbr || '').toUpperCase();
    return { fill, words: [word, word], ink: onColor(fill), edge: null };
  }
  // Two teams in similar colours (red vs red) get the away side's alternate.
  const chroma = (h) => { const c = rgb(h); return Math.max(...c) - Math.min(...c); };
  // A team's everyday colour. Only a neutral black/charcoal primary (Iowa's #231f20) gives way to
  // the secondary; a dark but real colour like Michigan navy stays.
  function teamInk(t) {
    const L = lum(t.color), La = lum(t.alt);
    return L < 0.03 && chroma(t.color) < 40 && La > 0.05 && La < 0.7 ? t.alt : t.color;
  }
  // End-zone lettering: the team's letter colour inside its outline colour (one glyph pixel wide), with
  // a hard drop shadow, on its own canvas so it can be turned.
  function raOutlined(s, k, col, edge) {
    const o = edge ? Math.max(1, Math.round(k / 3)) : 0;                 // a third of a glyph pixel: thick enough to read, thin enough to keep the counters open
    const c = document.createElement('canvas');
    c.width = bigW(s, k) + 2 * o + k; c.height = 7 * k + 2 * o + k;
    const g = c.getContext('2d');
    const sh = onColor(col) === '#ffffff' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.5)';
    if (edge) { for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) bigText(g, s, o + dx * o + k, o + dy * o + k, 'rgba(0,0,0,0.45)', k); for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) bigText(g, s, o + dx * o, o + dy * o, edge, k); }
    else bigText(g, s, k, k, sh, k);
    bigText(g, s, o, o, col, k);
    return c;
  }

  /* ═════ adapted: the field (raFieldArt), painted for one window ═════ */
  const ART = new Map();
  function fieldArt(spot, offT, defT, homeT) {
    const key = [spot, offT.abbr, defT.abbr, homeT.abbr].join('|');
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
    // End zones: both in the HOME team's own paint (the source since 2026-09-28: fill, hatch, words in
    // the team's lettering colour with its outline). The source also paints the team logo beside the
    // word where the team does (an ESPN CDN image); this page never fetches it, so the word stands alone.
    const Z = ezStyle(homeT);
    const zone = (Ha, Hb, word, rot) => {
      const x0 = hx(Ha), w = hx(Hb) - x0;
      if (x0 > W || x0 + w < 0) return;
      g.fillStyle = Z.fill; g.fillRect(x0, f0, w, FH);
      if (Z.pattern) {                                                                      // a diagonal hatch
        g.fillStyle = Z.pattern;
        for (let y = f0; y < f1; y += K) for (let x = x0; x < x0 + w; x += K) if (((x - x0 + y - f0) / K) % (12) < 3) g.fillRect(x, y, K, K);
      } else {                                                                              // the turf's grain through the paint
        g.fillStyle = mixHex(Z.fill, '#000000', 0.12);
        for (let y = f0; y < f1; y += 6 * K) g.fillRect(x0, y, w, K);
      }
      word = String(word || '').toUpperCase().replace(/[^A-Z0-9& ]/g, '');
      const k = Math.max(K, Math.min(3 * K, Math.floor((FH * 0.84) / (word.length * 6))));
      const lab = raOutlined(word, k, Z.ink, Z.edge);
      g.save(); g.translate(x0 + w / 2, f0 + FH / 2); g.rotate(rot);
      g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2)); g.restore();
    };
    zone(-10, 0, Z.words[1], -Math.PI / 2);                  // the left-hand end zone (the offense's own)
    zone(100, 110, Z.words[0], Math.PI / 2);                 // the right-hand one (the source's words[0] is its right)
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
  // The source's raPoseAt + raFrame + raGaitFrame, made pure in t (o: speed, held, back, after,
  // phase). The source carries a man's stride phase from one drawn frame to the next; here it is
  // t * cadence + his own offset, so scrubbing backwards draws the same frame as playing forwards.
  const RA_STRIDE_YD = { walk: 1.9, jog: 3, run: 4.2, carry: 4, back: 1.7, crun: 2.4 };
  function gaitFrame(t, gait, speed, phase) {
    const ph = t * (speed / RA_STRIDE_YD[gait]) + (phase || 0);
    return gait + (1 + ((Math.floor(ph * RA_STRIDE) % RA_STRIDE) + RA_STRIDE) % RA_STRIDE);
  }
  function poseOf(c, p, t, o) {
    const { speed, phase } = o;
    if (t <= c.snapT) return setPose(p);
    // Going down (the source's raFrame): the knees buckle (fall1), hands and knees (fall2), flat.
    const dn = p.id === c.target ? c.downT : null;
    if (dn != null && t > dn - 0.1) return t > dn + 0.26 ? 'down' : t > dn + 0.1 ? 'fall2' : 'fall1';
    // The pass: wound up (throw1), released (throw2, the first 0.1 s), the follow-through (throw3).
    if (p === c.qb && c.throwT != null && t >= c.throwT - 0.38 && t < c.throwT + 0.32) return t < c.throwT - 0.02 ? 'throw1' : t <= c.throwT + 0.08 ? 'throw2' : 'throw3';
    // The catch: hands up, then the ball pulled in for the act's last 0.12 s.
    if (p.id === c.target && c.catchT != null && t >= c.catchT - 0.28 && t < c.catchT + 0.12) return t > c.catchT ? 'secure' : 'catch';
    const blocker = p.role === 'block' || p.role === 'rush';
    if (blocker && speed < 3.2 && t < c.T) return Math.floor(t * 4 + (phase || 0) * 2) % 2 ? 'block2' : 'block';
    if (speed > 0.8) {
      const gait = o.back ? 'back' : o.held ? (speed < 2.4 ? 'walk' : 'carry') : speed < 2.4 ? 'walk' : speed < 5.6 ? 'jog' : 'run';
      return gaitFrame(t, gait, speed, phase);
    }
    if (o.held) return p.pos === 'QB' ? 'qbSet' : 'secure';
    if (o.after && (phase || 0) > 0.6) return 'hips';
    return Math.floor(t * 0.9 + (phase || 0) * 2) % 2 ? 'stand2' : 'stand';
  }
  // For the suite: the copied art, to compare with the production file it came from.
  CS._art = { raFig, RA_SKEL, RA_KITS, RA_LOGO, RA_HOLD, raKit, poseOf, gaitFrame };
  // Which way a man faces (the source's raDraw rules, made pure): the way he moves, else toward the
  // other team. Through the play the QB faces downfield until he throws (his drop is a backpedal),
  // the offensive line kick-slides facing its man, a lineman or tight end blocking faces his man,
  // and a linebacker or defensive back backpedals facing the offense until he first has to sprint
  // (6.5 yd/s, the source's 0.65 yd a tenth) or the ball is thrown.
  function faceOf(c, p, t, vx, speed, turnAt) {
    const own = p.team === 'off' ? 'r' : 'l';
    let face = Math.abs(vx) > 0.25 ? (vx > 0 ? 'r' : 'l') : own;
    const inPlay = t > c.snapT && t < c.T;
    if (inPlay && p === c.qb && (c.throwT == null || t < c.throwT + 0.32)) face = 'r';
    if (inPlay && p.team === 'def' && (ROLE[p.pos] === 'DB' || ROLE[p.pos] === 'LB') && t < Math.min(c.throwT ?? c.T, turnAt)) face = 'l';
    if (inPlay && ((ROLE[p.pos] === 'OL' && p.team === 'off') || ((p.role === 'block' || p.role === 'rush') && speed < 3.2))) face = own;
    return face;
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
      cam: { ...FULL }, camA: null, say: null, sayN: 0, shown: 0, place: null, note: null, geom: null, bw: 0, bh: 0,
      fade: null, fadeAnim: false, spotOn: false, alpha: {}, order: [], spot: null };
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
      st.art = fieldArt(CS.num(play.spot, 25), off, def, offHome ? off : def);
      st.pal = {}; st.nums = {}; st.marks = []; st.drawn = {};
      st.callout = o.callouts !== false;
      st.cam = { ...FULL }; st.camA = null; st.say = null; st.note = null; st.place = null;
      st.fade = null; st.spotOn = false; st.alpha = {}; st.order = []; st.spot = null;
      st.c.all.forEach((p, i) => {
        const side = p.team === 'off' ? 'o' : 'd';
        st.pal[p.id] = raPalette(st.kit[p.team], i, side, play.teams[p.team]);
        st.nums[p.id] = raNumber(ROLE[p.pos], `${play.teams[p.team]}:${p.id}`);
      });
      // When each linebacker and defensive back first has to sprint (the source's turnAt): until
      // then, and until the throw, he backpedals facing the offense.
      st.turnAt = {};
      const c0 = st.c, drop = c0.throwT ?? c0.T;
      for (let q = c0.snapT + 0.1; q < drop; q += 0.05) {
        const P1 = CS.poseAt(play, q).players, P0 = CS.poseAt(play, q - 0.1).players;
        for (const p of c0.def) if (!(p.id in st.turnAt) && Math.hypot(P1[p.id].x - P0[p.id].x, P1[p.id].y - P0[p.id].y) >= 0.65) st.turnAt[p.id] = q;
      }
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
    // Under the spotlight a faded man's sideways distance counts double (up to SPOT_HIT CSS px more),
    // so where a faded sprite overlaps a lit one the tap goes to the man the bubble is about. A tap
    // right on a faded man's own body axis or feet is still his: no handicap within 1 world px of it
    // (feet sit on a rounded pixel, so an exact tap can land half a pixel off), and the column
    // rule above still settles two men stacked one over the other. (A flat +10 px broke exactly that:
    // a faded right guard's feet, under the lit right tackle's helmet, went to the tackle.)
    const SPOT_HIT = 10;
    function hitTest(px, py) {
      if (!st.play) return null;
      const { sx, sy } = toCss(), kx = sx * st.cam.z, ky = sy * st.cam.z;
      const { X, Y } = c2w(px, py);
      const ids = Object.keys(st.drawn);
      let best = null, ba = Infinity, bk = Infinity, bh = Infinity;
      for (const id of ids) {
        const b = bodyBox(id);
        if (!b || X < b.x0 || X >= b.x1 || Y < b.y0 || Y > b.fy + 2) continue;
        const faded = id in st.alpha && st.alpha[id] < 0.99;
        const ax = Math.hypot((X - b.fx) * kx, (Y - clamp(Y, b.y0, b.fy)) * ky) + (faded ? Math.min(SPOT_HIT, Math.max(0, Math.abs(X - b.fx) - 1) * kx) : 0);   // CSS px to his axis
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

    /* ── the spotlight ── While a bubble names players (st.spotOn: set by say(), cleared when the play
       runs), everyone else fades to CS.SPOT_FADE. The fade starts with the camera's ease (the same t0
       and 480 ms, so both settle on the same frame), cuts under reduced motion, and a change of focus
       mid-fade starts from where each man is. A bubble with spot: false (one that asks for a tap,
       where fading would hide the answer or give it away) fades nobody. Returns {id: opacity}. */
    function spotlight() {
      const c = st.c, now = performance.now();
      const ids = st.say && st.spotOn && st.say.spot !== false && !st.playing ? CS.spotIds(st.play, st.say.focus, st.t) : null;
      const to = {};
      for (const p of c.all) to[p.id] = ids && !ids.has(p.id) ? CS.SPOT_FADE : 1;
      const key = ids ? [...ids].sort().join() : '';
      const at = (f) => { const u = clamp((now - f.t0) / CAM_MS, 0, 1), o = {}; for (const id in f.to) o[id] = CS.spotAlpha(id in f.from ? f.from[id] : 1, f.to[id], u); return o; };
      if (!st.fade || st.fade.key !== key) {
        const from = st.fade ? at(st.fade) : {};
        st.fade = { key, from: reduced() ? to : from, to, t0: st.camA ? st.camA.t0 : now };
      }
      st.spot = ids;
      const a = at(st.fade);
      st.fadeAnim = !reduced() && Object.keys(to).some((id) => Math.abs(a[id] - to[id]) > 1e-3);
      if (st.fadeAnim) loop();
      st.alpha = a;
      return a;
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

      // Players and the ball, back to front; under the spotlight the faded ones first, then the lit.
      const alpha = spotlight(), lit = st.spot;
      const items = [], drawn = {};
      c.all.forEach((p, i) => {
        const q = pose.players[p.id], o = prev.players[p.id];
        const [sx, sy] = S(q);
        const speed = Math.hypot(q.x - o.x, q.y - o.y) / 0.1;
        const vx = (q.y - o.y) * PX;
        const face = faceOf(c, p, t, vx, speed, p.id in st.turnAt ? st.turnAt[p.id] : Infinity);
        const phase = (i * 0.37) % 1;
        const back = speed > 0.8 && ((vx > 0.25 && face === 'l') || (vx < -0.25 && face === 'r'));
        const ps = poseOf(c, p, t, { speed, phase, back, held: pose.ball.held === p.id, after: t > (c.downT ?? c.T) + 0.3 });
        const X = Math.round(sx), Y = Math.round(sy);
        const spr = raSprite(ps, st.pal[p.id], face === 'l', st.nums[p.id]);
        drawn[p.id] = { pose: ps, flip: face === 'l', sx, sy, X, Y, spr };
        const a = alpha[p.id];
        items.push({ id: p.id, y: sy, layer: lit && lit.has(p.id) ? 1 : 0, draw: () => {
          g.globalAlpha = a;
          raShadow(g, X, Y, 0, RA_FLAT.has(ps));
          g.drawImage(spr, X - spr.ax, Y - spr.ay);
          g.globalAlpha = 1;
        } });
      });
      st.drawn = drawn;
      const b = pose.ball;
      const heldBy = b.held ? drawn[b.held] : null;
      items.push({ y: heldBy ? heldBy.sy + 0.5 : wy(b.x) + 0.5, layer: heldBy && lit && lit.has(b.held) ? 1 : 0, draw: () => {
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
      items.sort((p, q) => p.layer - q.layer || p.y - q.y).forEach((it) => it.draw());
      st.order = items.filter((it) => it.id).map((it) => it.id);

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
          // The bracket is the union of the group's OWN sprites plus 5 px, never grown to take in anyone
          // else; a man whose sprite overlaps it from outside the group is faded (spotlight()).
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
      st.spotOn = !!b;
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
      if (st.playing || st.camA || st.fadeAnim) loop();
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
      camTo(FULL);                                           // the play runs zoomed out,
      st.spotOn = false;                                     // and with nobody faded
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
      // The spotlight this frame: the ids the bubble names (null = nobody faded), each player's
      // opacity, and the order the players were drawn in (the lit ones last).
      get spot() { return { ids: st.spot ? [...st.spot] : null, alpha: { ...st.alpha }, order: st.order.slice(), animating: !!st.fadeAnim }; },
      get saying() { return st.say ? { text: st.say.text || null, focus: st.say.focus.slice(), tone: st.say.tone || 'note', src: st.say.src || null } : null; },
      get coach() { return st.geom ? JSON.parse(JSON.stringify(st.geom)) : null; },
      PRE, hitRadius: HIT_R, world: { W, H, PX, PY, Y0, Y1, MT },
    };
    return api;
  };
})(typeof window !== 'undefined' ? window : globalThis);
