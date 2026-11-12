/* Coach School library: formations, defenses, zone landmarks, routes, concepts, the BEATS truth
   table, run schemes, pressure packages, team names and colours, player labels. Data only; loads
   after cs-core.js (Node vm too).

   SOURCE: docs/coachschool-facts.md, the single source of football truth (rules-reviewed by
   Fable 5.2 against the 2026 rulebook). Phase 3b filled the whole library from it:
     - offensive line and backfield constants ............ section 1a
     - formations (strength right; mirror for left) ....... section 1b
     - defensive techniques ................................ section 1c
     - defensive fronts and sub packages ................... sections 1d-1e
     - personnel codes ..................................... section 2
     - route tree and named routes ......................... section 3
     - zone landmarks ...................................... section 4
     - coverage assignments (who drops where) .............. section 5a, tells and holes 5b
     - concepts, BEATS, contested pairings, ROUTE_BEATS .... section 6
     - run schemes ......................................... section 7
     - gaps, holes, techniques ............................. section 8
     - pressure packages ................................... section 9
   `src` on an entry names the sheet section it comes from. A callout's `src` is a list of
   {sec, q}: q is a verbatim phrase of that section (tools/coachschool-checks/lib.mjs finds it
   there), so every sentence a play says can be traced to the sheet.

   Where the sheet leaves a gap the engine still has to fill (which gap a blitzer takes, how the
   base fronts share out the nickel's coverage jobs), the entry says so in `mapped` / `gapPick` /
   a comment, and nothing built on that choice may be taught as a fact. Where the sheet asks for
   something cs-core cannot draw yet (a handoff, a pulling guard, a combo block, a stunt, a
   pattern-reading safety, trail technique), the data is written in the shape the engine will
   need and marked `needsEngine: '<feature>'`; NEEDS_ENGINE below lists every such feature with
   its data shape. A play that needs one lives in PENDING_PLAYS, never in PLAYS, so everything in
   PLAYS is playable today. A defender marked needsEngine is drawn today by the plain part of his
   job (his zone drop, his man) and the marked part waits for the engine.

   Coordinates: see cs-core.js (x across 0..53.33, 0 = the offense's left sideline; y from the
   line of scrimmage, + = offense's downfield). */
(function (root) {
  'use strict';
  const CS = root.CS;
  const L = CS.lib;

  /* ── formations (fact sheet 1a/1b) ── The five linemen 1.5 yd centre to centre, all ON the line
     at y = 0; everyone off the line at y = -1 or deeper; exactly 7 on and 4 off. Every formation
     is drawn strength right; a play sets `mirror: true` for strength left (cs-core mirrors the
     defense with it) and `hash: 'L' | 'R'` to spot the ball on a hash. */
  const LINE = [
    { id: 'LT', pos: 'T', dx: -3, y: 0, on: true },
    { id: 'LG', pos: 'G', dx: -1.5, y: 0, on: true },
    { id: 'C', pos: 'C', dx: 0, y: 0, on: true },
    { id: 'RG', pos: 'G', dx: 1.5, y: 0, on: true },
    { id: 'RT', pos: 'T', dx: 3, y: 0, on: true },
  ];
  const F = (id, name, personnel, players) => { L.FORMATIONS[id] = { id, name, personnel, strength: 'R', src: '1b', players: [...LINE, ...players] }; };
  F('i-form', 'I-formation', '21', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Y', pos: 'TE', x: 31.17, y: 0, on: true },
    { id: 'Z', pos: 'WR', x: 47.33, y: -1, on: false },
    { id: 'QB', pos: 'QB', x: 26.67, y: -1 },
    { id: 'FB', pos: 'FB', x: 26.67, y: -4.5 },
    { id: 'RB', pos: 'RB', x: 26.67, y: -7 },                       // the tailback
  ]);
  F('singleback', 'Singleback', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Y', pos: 'TE', x: 31.17, y: 0, on: true },
    { id: 'H', pos: 'WR', x: 15, y: -1, on: false },
    { id: 'Z', pos: 'WR', x: 47.33, y: -1, on: false },
    { id: 'QB', pos: 'QB', x: 26.67, y: -1 },
    { id: 'RB', pos: 'RB', x: 26.67, y: -6.5 },
  ]);
  // Ace: the two tight ends are the ends of the line, so both wide receivers are off it (1b note).
  F('ace', 'Ace (singleback, two tight ends)', '12', [
    { id: 'U', pos: 'TE', x: 22.17, y: 0, on: true },
    { id: 'Y', pos: 'TE', x: 31.17, y: 0, on: true },
    { id: 'X', pos: 'WR', x: 6, y: -1, on: false },
    { id: 'Z', pos: 'WR', x: 47.33, y: -1, on: false },
    { id: 'QB', pos: 'QB', x: 26.67, y: -1 },
    { id: 'RB', pos: 'RB', x: 26.67, y: -6.5 },
  ]);
  F('gun-2x2', 'Shotgun 2x2', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Z', pos: 'WR', x: 47.33, y: 0, on: true },
    { id: 'H', pos: 'WR', x: 15, y: -1, on: false },
    { id: 'Y', pos: 'TE', x: 38.33, y: -1, on: false },             // flexed
    { id: 'QB', pos: 'QB', x: 26.67, y: -5 },
    { id: 'RB', pos: 'RB', x: 28.67, y: -5 },
  ]);
  F('gun-trips-rt', 'Shotgun trips right', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Z', pos: 'WR', x: 47.33, y: 0, on: true },
    { id: 'Y', pos: 'TE', x: 34.67, y: -1, on: false },             // #3
    { id: 'H', pos: 'WR', x: 39.67, y: -1, on: false },             // #2
    { id: 'QB', pos: 'QB', x: 26.67, y: -5 },
    { id: 'RB', pos: 'RB', x: 24.67, y: -5 },
  ]);
  // Bunch: which of the three is on the line varies by team; CS puts the point man (Z) on (1b note).
  F('gun-bunch-rt', 'Shotgun bunch right', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Z', pos: 'WR', x: 39.67, y: 0, on: true },               // the point
    { id: 'H', pos: 'WR', x: 38.67, y: -1, on: false },
    { id: 'Y', pos: 'TE', x: 40.67, y: -1, on: false },
    { id: 'QB', pos: 'QB', x: 26.67, y: -5 },
    { id: 'RB', pos: 'RB', x: 24.67, y: -5 },
  ]);
  // Empty 3x2: no back beside the QB; the RB lines up as a slot (1b). Five-man protection (rank 2).
  F('gun-empty', 'Shotgun empty 3x2', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Z', pos: 'WR', x: 47.33, y: 0, on: true },
    { id: 'H', pos: 'WR', x: 15, y: -1, on: false },
    { id: 'Y', pos: 'TE', x: 34.67, y: -1, on: false },
    { id: 'RB', pos: 'RB', x: 39.67, y: -1, on: false },            // the back as a slot
    { id: 'QB', pos: 'QB', x: 26.67, y: -5 },
  ]);
  F('pistol', 'Pistol', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Y', pos: 'TE', x: 31.17, y: 0, on: true },
    { id: 'H', pos: 'WR', x: 15, y: -1, on: false },
    { id: 'Z', pos: 'WR', x: 47.33, y: -1, on: false },
    { id: 'QB', pos: 'QB', x: 26.67, y: -4 },
    { id: 'RB', pos: 'RB', x: 26.67, y: -7 },
  ]);

  /* ── personnel codes (fact sheet 2) ── first digit backs (RB + FB), second tight ends, WR = 5 - both. */
  const PER = (backs, te, answer) => ({ backs, te, wr: 5 - backs - te, answer, src: '2' });
  L.PERSONNEL = {
    10: PER(1, 0, 'nickel or dime'), 11: PER(1, 1, 'nickel'), 12: PER(1, 2, 'base (4-3 / 3-4) or nickel'),
    13: PER(1, 3, 'base or heavy'), 21: PER(2, 1, 'base'), 22: PER(2, 2, 'base or heavy/goal line'),
  };

  /* ── zone landmarks (fact sheet 4) ── Both columns of the sheet, as written: the landmark
     {x, y} is where the dropper aims to be when the QB throws; `xr` is the zone's x range and
     `band` its depth band (null = open-ended, "12+"). `deep` marks the zones that count toward a
     coverage's deep defenders. The combined names: curl-flat = "the curl, then the flat" and
     hook-curl = "hook, then curl", so each starts from its first zone's landmark (`of`). The
     quarters are Q1-Q4 left to right: L, LM, RM, R. */
  const Z = (id, x, y, xr, band, extra) => { L.ZONES[id] = { x, y, xr, band, src: '4', ...(extra || {}) }; };
  Z('flat-L', 5, 6, [0, 9], [0, 8]);                 Z('flat-R', 48.33, 6, [44.33, 53.33], [0, 8]);
  Z('curl-L', 12, 11, [9, 18], [8, 14]);             Z('curl-R', 41.33, 11, [35.33, 44.33], [8, 14]);
  Z('hook-L', 21, 10, [18, 26.67], [8, 12]);         Z('hook-R', 32.33, 10, [26.67, 35.33], [8, 12]);
  Z('curl-flat-L', 12, 11, [0, 18], [0, 14], { of: ['curl-L', 'flat-L'] });
  Z('curl-flat-R', 41.33, 11, [35.33, 53.33], [0, 14], { of: ['curl-R', 'flat-R'] });
  Z('hook-curl-L', 21, 10, [9, 26.67], [8, 14], { of: ['hook-L', 'curl-L'] });
  Z('hook-curl-R', 32.33, 10, [26.67, 44.33], [8, 14], { of: ['hook-R', 'curl-R'] });
  Z('hook-M', 26.67, 11, [22, 31.33], [8, 14], { name: 'Middle hook (Cover 2 Mike)' });
  Z('hole-M', 26.67, 18, [22, 31.33], [12, 22], { name: 'Middle hole (Tampa 2 Mike)', carries: 'a vertical inside receiver' });
  Z('deep-third-L', 9, 16, [0, 17.78], [12, null], { deep: true });
  Z('deep-third-M', 26.67, 16, [17.78, 35.56], [12, null], { deep: true });
  Z('deep-third-R', 44.33, 16, [35.56, 53.33], [12, null], { deep: true });
  Z('deep-half-L', 18, 16, [0, 26.67], [12, null], { deep: true });
  Z('deep-half-R', 35.33, 16, [26.67, 53.33], [12, null], { deep: true });
  Z('deep-quarter-L', 7, 14, [0, 13.33], [10, null], { deep: true, q: 'Q1' });
  Z('deep-quarter-LM', 20, 14, [13.33, 26.67], [10, null], { deep: true, q: 'Q2' });
  Z('deep-quarter-RM', 33.33, 14, [26.67, 40], [10, null], { deep: true, q: 'Q3' });
  Z('deep-quarter-R', 46.33, 14, [40, 53.33], [10, null], { deep: true, q: 'Q4' });

  /* ── defensive techniques (fact sheet 1c, strength right) ── x of each technique on each side;
     shade = 0.5 yd off a blocker's centre. 7/6/9 on the weak side exist only if there is a TE there. */
  L.TECHNIQUES = {
    0: { R: 26.67, L: 26.67, what: 'head-up C' }, 1: { R: 27.17, L: 26.17, what: 'shade C' },
    '2i': { R: 27.67, L: 25.67, what: 'inside shade G' }, 2: { R: 28.17, L: 25.17, what: 'head-up G' },
    3: { R: 28.67, L: 24.67, what: 'outside shade G' }, '4i': { R: 29.17, L: 24.17, what: 'inside shade T' },
    4: { R: 29.67, L: 23.67, what: 'head-up T' }, 5: { R: 30.17, L: 23.17, what: 'outside shade T' },
    7: { R: 30.67, L: 22.67, what: 'inside shade TE' }, 6: { R: 31.17, L: 22.17, what: 'head-up TE' },
    9: { R: 31.67, L: 21.67, what: 'outside shade TE' }, wide: { R: 32.67, L: 21.67, what: 'wide 9 / wide 5 (no TE)' },
  };
  L.DEPTHS = { DL: 1, LB: 4.5, CB_OFF: 7, CB_PRESS: 1, SAFETY_2HIGH: 12, SAFETY_1HIGH: 13, src: '1c' };
  // Hole numbering, CS convention (fact sheet 8): from the center out, even right, odd left.
  L.HOLES = { 1: 'A-gap-L', 2: 'A-gap-R', 3: 'B-gap-L', 4: 'B-gap-R', 5: 'C-gap-L', 6: 'C-gap-R', 7: 'D-gap-L', 8: 'D-gap-R' };
  // Back digits in a run call, CS convention (8): 1 = QB, 2 = tailback, 3 = fullback. "26 Power".
  L.BACK_DIGITS = { 1: 'QB', 2: 'RB', 3: 'FB' };

  /* ── coverages (fact sheet 5a/5b) ── The sheet's assignment table, vs shotgun 2x2 in nickel
     personnel, one row per coverage, one job per role (the column names of 5a). `deep` = the
     sheet's deep count. Fronts below hand these jobs to their own players. */
  const ROLES = ['CB-L', 'CB-R', 'FS', 'SS', 'NB', 'MIKE', 'WILL'];
  L.COVERAGE_ROLES = ROLES;
  L.COVERAGES = {
    'cov:0': { name: 'Cover 0', deep: 0, rush: '6 (7)', shell: 'none', src: '5a',
      jobs: { 'CB-L': { man: 'X', press: true }, 'CB-R': { man: 'Z', press: true }, FS: { man: 'H', press: true }, SS: { rush: true, walkDown: true },
        NB: { man: 'Y', press: true }, MIKE: { man: 'RB', ifBlocks: 'rush', needsEngine: 'man-or-rush' }, WILL: { rush: true } } },
    'cov:1': { name: 'Cover 1', deep: 1, rush: '4-5', shell: 'MOFC', src: '5a',
      jobs: { 'CB-L': { man: 'X', press: true }, 'CB-R': { man: 'Z', press: true }, FS: { zone: 'deep-third-M' }, SS: { man: 'H' },
        NB: { man: 'Y' }, MIKE: { man: 'RB' }, WILL: { zone: 'hook-M', robber: true, alt: 'rush' } } },
    'cov:2': { name: 'Cover 2', deep: 2, rush: '4', shell: 'MOFO', src: '5a',
      jobs: { 'CB-L': { zone: 'flat-L', depth: 5 }, 'CB-R': { zone: 'flat-R', depth: 5 }, FS: { zone: 'deep-half-L' }, SS: { zone: 'deep-half-R' },
        NB: { zone: 'hook-curl-R' }, MIKE: { zone: 'hook-M' }, WILL: { zone: 'hook-curl-L' } } },
    'cov:tampa2': { name: 'Tampa 2', deep: 2, rush: '4', shell: 'MOFO', src: '5a', plusMike: 'hole-M',
      jobs: { 'CB-L': { zone: 'flat-L', depth: 5 }, 'CB-R': { zone: 'flat-R', depth: 5 }, FS: { zone: 'deep-half-L' }, SS: { zone: 'deep-half-R' },
        NB: { zone: 'hook-curl-R' }, MIKE: { zone: 'hole-M' }, WILL: { zone: 'hook-curl-L' } } },
    // The SS "buzzes down" at the snap (5a): he starts on the two-high spot (1d/1e) and rotates to
    // the hook, which is the rotation rank 6 describes. Straight-line drops draw it today.
    'cov:3': { name: 'Cover 3', deep: 3, rush: '4', shell: 'MOFC', src: '5a',
      jobs: { 'CB-L': { zone: 'deep-third-L' }, 'CB-R': { zone: 'deep-third-R' }, FS: { zone: 'deep-third-M' }, SS: { zone: 'hook-R' },
        NB: { zone: 'curl-flat-R' }, MIKE: { zone: 'hook-L' }, WILL: { zone: 'curl-flat-L' } } },
    'cov:4': { name: 'Cover 4 (quarters)', deep: 4, rush: '4', shell: 'MOFO', src: '5a',
      jobs: { 'CB-L': { zone: 'deep-quarter-L' }, 'CB-R': { zone: 'deep-quarter-R' },
        FS: { zone: 'deep-quarter-LM', depth: 10, read: { key: '#2', of: 'H' }, needsEngine: 'zone-read' },
        SS: { zone: 'deep-quarter-RM', depth: 10, read: { key: '#2', of: 'Y' }, needsEngine: 'zone-read' },
        NB: { zone: 'curl-flat-R' }, MIKE: { zone: 'hook-M' }, WILL: { zone: 'curl-flat-L' } } },
    // CS convention (5a note): Cover 6 = quarters to the strength/field (right), Cover 2 to the weak side.
    'cov:6': { name: 'Cover 6', deep: 3, rush: '4', shell: 'MOFO', src: '5a',
      jobs: { 'CB-L': { zone: 'flat-L', depth: 5, cloud: true }, 'CB-R': { zone: 'deep-quarter-R' }, FS: { zone: 'deep-half-L' },
        SS: { zone: 'deep-quarter-RM', read: { key: '#2', of: 'Y' }, needsEngine: 'zone-read' },
        NB: { zone: 'curl-flat-R' }, MIKE: { zone: 'hook-M' }, WILL: { zone: 'hook-curl-L' } } },
    'cov:2man': { name: '2-man', deep: 2, rush: '4', shell: 'MOFO', src: '5a',
      jobs: { 'CB-L': { man: 'X', press: true, technique: 'trail', needsEngine: 'trail' }, 'CB-R': { man: 'Z', press: true, technique: 'trail', needsEngine: 'trail' },
        FS: { zone: 'deep-half-L' }, SS: { zone: 'deep-half-R' }, NB: { man: 'Y' }, MIKE: { man: 'RB' }, WILL: { man: 'H' } } },
  };
  // 5b, one phrase each of where it is soft. Lessons quote 5b itself, not these.
  const HOLES5B = {
    'cov:0': 'hot routes, quick throws, screens', 'cov:1': 'crossing routes and rubs (mesh)',
    'cov:2': 'the hole between corner and half safety along the sideline at about 15-20 yd (corner route)',
    'cov:tampa2': 'the sideline hole behind the corner is still there', 'cov:3': '4 verticals vs 3 deep',
    'cov:4': 'underneath and flats (only 3 under)', 'cov:6': "the Cover 2 side's holes (corner route behind the cloud corner)",
    'cov:2man': 'rubs and crossers',
  };
  for (const [k, v] of Object.entries(HOLES5B)) L.COVERAGES[k].holes = v;

  /* ── defenses (fact sheet 1d/1e for alignment, 5a for the coverage) ── All drawn for strength
     RIGHT; cs-core mirrors a play's defense along with its formation. Ids name the offense's
     left/right (CB-L is the corner on the offense's left). Ids: '<coverage>-<front>', coverage in
     c0 c1 c2 t2 c3 c4 c6 c2m, front in 43-over 43-under 34 nickel dime.

     Alignment: every front's own table (1d vs I-form/singleback, 1e vs shotgun 2x2), with the
     depths 5b gives: Cover 2 / Tampa 2 corners "shallow (≈5 yd)", Cover 6's cloud corner too;
     Cover 4 safeties "shallower (≈10 yd)"; corners in Cover 0, Cover 1 and 2-man pressed (1c,
     y = +1) on their man; Cover 0's man defenders "tight on every receiver" (the safety on the slot
     and the nickel on the flexed TE press too). Single-high coverages keep the two-high safety
     spots of 1d/1e and rotate at the snap, which is what 5a writes ("rotates down", "buzz down").

     Man defenders press at the receiver's x in the formation the front is drawn against (1d:
     singleback, the 1d base formation with an H; 1e: shotgun 2x2). A man defense compiles only
     against a formation with every receiver it names (X, Z, H, Y, RB): not the I-form (FB, no H)
     or the Ace (U, no H). The library suite plays each one against every formation that fits. */
  const DB = [
    { id: 'CB-L', pos: 'CB', x: 6, y: 7 }, { id: 'CB-R', pos: 'CB', x: 47.33, y: 7 },
    { id: 'FS', pos: 'S', x: 18, y: 12 }, { id: 'SS', pos: 'S', x: 35.33, y: 12 },
  ];
  // Rush lanes from technique (8): a 1 is in the A gap, a 3 in the B gap, a 5 outside the tackle
  // (the C gap); a 0 and a 4 are two-gap head-up men (1d), drawn rushing one of their two.
  const OVER_DL = [
    { id: 'DE-R', pos: 'DE', x: 30.17, y: 1, rush: 'C-gap-R', tech: 5 },
    { id: 'DT-R', pos: 'DT', x: 28.67, y: 1, rush: 'B-gap-R', tech: 3 },
    { id: 'DT-L', pos: 'DT', x: 26.17, y: 1, rush: 'A-gap-L', tech: 1 },
    { id: 'DE-L', pos: 'DE', x: 23.17, y: 1, rush: 'C-gap-L', tech: 5 },
  ];
  const BASE_RECV = { X: 6, Z: 47.33, H: 15, Y: 31.17 }, GUN_RECV = { X: 6, Z: 47.33, H: 15, Y: 38.33 };
  const FRONTS = {
    '43-over': { name: '4-3 Over', personnel: 'base', src: '1d', drawnVs: 'singleback', recv: BASE_RECV,
      dl: OVER_DL, lb: [{ id: 'SAM', pos: 'LB', x: 32.67, y: 4.5 }, { id: 'MIKE', pos: 'LB', x: 27.67, y: 4.5 }, { id: 'WILL', pos: 'LB', x: 24.17, y: 4.5 }],
      jobsFor: { NB: 'SAM', MIKE: 'MIKE', WILL: 'WILL' }, mapped: "base personnel has no nickel back: the Sam takes 5a's NB job (CS mapping, not in the sheet)" },
    '43-under': { name: '4-3 Under', personnel: 'base', src: '1d', drawnVs: 'singleback', recv: BASE_RECV,
      // 1d: the WDE is "wide 5 (22.67)"; 1c lists wide 5 weak at 21.67. The front's own number is used.
      dl: [{ id: 'DE-R', pos: 'DE', x: 30.17, y: 1, rush: 'C-gap-R', tech: 5 }, { id: 'NT', pos: 'NT', x: 27.17, y: 1, rush: 'A-gap-R', tech: 1 },
        { id: 'DT-L', pos: 'DT', x: 24.67, y: 1, rush: 'B-gap-L', tech: 3 }, { id: 'DE-L', pos: 'DE', x: 22.67, y: 1, rush: 'C-gap-L', tech: 'wide 5' }],
      lb: [{ id: 'SAM', pos: 'LB', x: 31.67, y: 1, tech: 9 }, { id: 'MIKE', pos: 'LB', x: 28.17, y: 4.5 }, { id: 'WILL', pos: 'LB', x: 24.17, y: 4.5 }],
      jobsFor: { NB: 'SAM', MIKE: 'MIKE', WILL: 'WILL' }, mapped: "base personnel has no nickel back: the Sam (on the line, 9 technique) takes 5a's NB job (CS mapping, not in the sheet)" },
    '34': { name: '3-4', personnel: 'base', src: '1d', drawnVs: 'singleback', recv: BASE_RECV,
      dl: [{ id: 'NT', pos: 'NT', x: 26.67, y: 1, rush: 'A-gap-R', tech: 0 }, { id: 'DE-R', pos: 'DE', x: 29.67, y: 1, rush: 'B-gap-R', tech: 4 },
        { id: 'DE-L', pos: 'DE', x: 23.67, y: 1, rush: 'B-gap-L', tech: 4 }],
      lb: [{ id: 'OLB-R', pos: 'LB', x: 32.17, y: 1 }, { id: 'OLB-L', pos: 'LB', x: 21.67, y: 1 }, { id: 'MIKE', pos: 'LB', x: 28.17, y: 4.5 }, { id: 'WILL', pos: 'LB', x: 25.17, y: 4.5 }],
      // The sheet: "OLBs are usually the edge rushers". 5a has four rushers; with three down
      // linemen the weak OLB is the fourth, and the strong OLB (over the TE, where the 4-3's Sam
      // stands) takes the NB job.
      fourth: { id: 'OLB-L', rush: 'C-gap-L' },
      jobsFor: { NB: 'OLB-R', MIKE: 'MIKE', WILL: 'WILL' }, mapped: "3 down linemen: the weak OLB rushes as the fourth man and the strong OLB takes 5a's NB job (CS mapping; the sheet gives the 3-4's alignment, not its coverage jobs)" },
    nickel: { name: 'Nickel 4-2-5', personnel: 'nickel', src: '1e', drawnVs: 'gun-2x2', recv: GUN_RECV,
      dl: OVER_DL, lb: [{ id: 'MIKE', pos: 'LB', x: 27.17, y: 4.5 }, { id: 'WILL', pos: 'LB', x: 20, y: 4.5 }, { id: 'NB', pos: 'NB', x: 37.33, y: 5 }],
      jobsFor: { NB: 'NB', MIKE: 'MIKE', WILL: 'WILL' }, mapped: null },
    // The dime back has no position of his own in cs-core's speed table; he is a 'NB' by position
    // (a defensive back's speed) and 'DIME' by id and label.
    dime: { name: 'Dime 4-1-6', personnel: 'dime', src: '1e', drawnVs: 'gun-2x2', recv: GUN_RECV,
      dl: OVER_DL, lb: [{ id: 'MIKE', pos: 'LB', x: 26.67, y: 5.5 }, { id: 'NB', pos: 'NB', x: 37.33, y: 5 }, { id: 'DIME', pos: 'NB', x: 16, y: 5 }],
      jobsFor: { NB: 'NB', MIKE: 'MIKE', WILL: 'DIME' }, mapped: "one linebacker: the dime back (inside the left slot, near where the nickel's apex Will stands) takes 5a's Will job (CS mapping, not in the sheet)" },
  };
  L.FRONTS = FRONTS;
  const COV_IDS = { 'cov:0': 'c0', 'cov:1': 'c1', 'cov:2': 'c2', 'cov:tampa2': 't2', 'cov:3': 'c3', 'cov:4': 'c4', 'cov:6': 'c6', 'cov:2man': 'c2m' };
  L.COV_IDS = COV_IDS;
  // An extra rusher's lane: the sheet names who rushes in Cover 0 (SS, Will) but not through
  // which gap. The engine takes the nearest A/B/C gap nobody else is rushing, then a D gap.
  // Marked gapPick: 'engine'; never taught.
  const GAP_ORDER = ['A-gap-L', 'A-gap-R', 'B-gap-L', 'B-gap-R', 'C-gap-L', 'C-gap-R'];
  function openGap(used, x) {
    const near = (names) => names.filter((g) => !used.has(g)).sort((a, b) => Math.abs(CS.gapX(a) - x) - Math.abs(CS.gapX(b) - x))[0];
    const g = near(GAP_ORDER) || near(['D-gap-L', 'D-gap-R']) || 'A-gap-R';
    used.add(g);
    return g;
  }
  const D = (o) => { L.DEFENSES[o.id] = o; };
  function buildDefense(covTag, frontId) {
    const cov = L.COVERAGES[covTag], fr = FRONTS[frontId];
    const players = [], used = new Set();
    for (const p of fr.dl) { players.push({ ...p }); used.add(p.rush); }
    const bodies = {};
    for (const p of [...fr.lb, ...DB]) bodies[p.id] = { ...p };
    if (fr.fourth) { Object.assign(bodies[fr.fourth.id], { rush: fr.fourth.rush, as5a: 'fourth rusher' }); used.add(fr.fourth.rush); }
    // Who plays each 5a role in this front.
    const holder = { 'CB-L': 'CB-L', 'CB-R': 'CB-R', FS: 'FS', SS: 'SS', ...fr.jobsFor };
    for (const role of ROLES) {
      const job = cov.jobs[role], p = bodies[holder[role]];
      p.as5a = role;
      if (job.zone) p.zone = job.zone;
      if (job.man) p.man = job.man;
      if (job.rush) {
        if (job.walkDown) { p.y = L.DEPTHS.LB; p.walkDown = true; }
        p.rush = openGap(used, p.x); p.gapPick = 'engine';
      }
      if (job.press && p.pos !== 'LB') { p.x = fr.recv[job.man]; p.y = L.DEPTHS.CB_PRESS; p.press = true; }
      if (job.depth != null) p.y = job.depth;
      if (job.read) p.read = { ...job.read };
      if (job.technique) p.technique = job.technique;
      if (job.robber) { p.robber = true; p.alt = { rush: openGap(new Set(used), p.x), gapPick: 'engine' }; }
      if (job.cloud) p.cloud = true;
      if (job.needsEngine) p.needsEngine = job.needsEngine;
    }
    // A conditional rusher (Cover 0's Mike, "rushes if RB blocks") picks his lane after the men who always rush.
    for (const role of ROLES) if (cov.jobs[role].ifBlocks === 'rush') { const p = bodies[holder[role]]; p.ifBlocks = { rush: openGap(used, p.x), gapPick: 'engine' }; }
    for (const p of [...fr.lb, ...DB]) players.push(bodies[p.id]);
    const id = `${COV_IDS[covTag]}-${frontId}`;
    D({ id, name: `${fr.name}, ${cov.name}`, coverage: covTag, personnel: fr.personnel, front: frontId, drawnVs: fr.drawnVs,
      src: [fr.src, '5a', '5b'], mapped: fr.mapped, players });
  }
  for (const covTag of Object.keys(L.COVERAGES)) for (const frontId of Object.keys(FRONTS)) buildDefense(covTag, frontId);

  /* ── pressure (fact sheet 9) ── Cover 0 blitz is the Cover 0 defenses above (6 rushers, man on
     every eligible receiver, no deep help). Fire zone and sim pressure, drawn from the nickel: the
     sheet gives the shape (rushers, under, deep) but not who; the who is a CS pick, marked `mapped`. */
  function pressure(id, name, kind, set, mapped) {
    const base = JSON.parse(JSON.stringify(L.DEFENSES['c3-nickel']));
    for (const [pid, a] of Object.entries(set)) {
      const p = base.players.find((q) => q.id === pid);
      delete p.zone; delete p.rush; delete p.man; delete p.as5a;
      Object.assign(p, a);
    }
    D({ id, name, coverage: 'cov:3', pressure: kind, personnel: 'nickel', front: 'nickel', drawnVs: 'gun-2x2', src: ['1e', '9'], mapped, players: base.players });
  }
  // Fire zone: 5 rush (a LB joins the four), 3 under (two curl-flat, one hook/middle), 3 deep (two corners + one safety).
  pressure('fz-nickel', 'Nickel fire zone', 'fire-zone', {
    MIKE: { rush: 'A-gap-R', gapPick: 'engine' }, SS: { zone: 'hook-M' },
  }, 'the Mike is the fifth rusher and the SS takes the hook/middle; NB and Will keep their curl-flats (CS pick; the sheet: "often a LB and/or DB")');
  // Sim pressure: 4 rush but not the usual four (the Will rushes, the left end drops), 7 in zone behind.
  pressure('sim-nickel', 'Nickel sim pressure', 'sim', {
    WILL: { rush: 'C-gap-L', gapPick: 'the lane the dropping end left' }, 'DE-L': { zone: 'curl-flat-L' },
  }, 'the Will rushes and the left end drops into the curl-flat behind Cover 3 (CS pick; the sheet: "a LB or DB rushes while a DL drops")');
  L.PRESSURES = {
    'cover-0-blitz': { name: 'Cover 0 blitz', rushers: '6 or more', under: 'man on every eligible receiver', deep: 0, defenses: Object.keys(FRONTS).map((f) => `c0-${f}`), src: '9' },
    'fire-zone': { name: 'Fire zone', rushers: 5, under: 3, deep: 3, defenses: ['fz-nickel'], src: '9' },
    sim: { name: 'Sim pressure', rushers: 4, under: 7, deep: 'varies (often 2 or 3)', defenses: ['sim-nickel'], src: '9' },
  };
  // Blitz pickup by count (9): 5 OL + RB = 6 blockers; empty = 5.
  L.PROTECTION = { blockersWithBack: 6, blockersEmpty: 5, src: '9' };

  /* ── stunts (rank 4) ── Linemen exchange gaps after the snap. The engine rushes every man
     straight at his gap from the snap; the looper's late start is not drawable yet. */
  L.STUNTS = {
    'te-twist': { name: 'T-E twist', src: 'rank4', defense: 'c3-nickel', side: 'L', needsEngine: 'rush-delay',
      moves: { 'DT-L': { rush: 'C-gap-L', first: true }, 'DE-L': { rush: 'B-gap-L', delay: 0.35, loop: true } } },
    'et-twist': { name: 'E-T twist', src: 'rank4', defense: 'c3-nickel', side: 'L', needsEngine: 'rush-delay',
      moves: { 'DE-L': { rush: 'B-gap-L', first: true }, 'DT-L': { rush: 'C-gap-L', delay: 0.35, loop: true } } },
  };

  /* ── routes (fact sheet 3) ── Points from the alignment: [0, dy] or ["in"|"out", lateral, dy].
     `ext` = the last leg keeps going (the receiver runs on until the play ends or he is down).
     `n` = the CS tree number; `brk` = the sheet's break depth (yd) and direction. */
  const R = (name, n, title, pts, brk, extra) => { L.ROUTES[name] = { n, name: title, pts, brk, src: '3', ...(extra || {}) }; };
  R('hitch', 0, 'Hitch', [[0, 6], ['in', 0.5, 5]], { depth: 6, dir: 'stop, turn back to QB' });
  R('flat', 1, 'Flat', [['out', 2, 2], ['out', 10, 3]], { depth: [1, 2], dir: 'out, flat' }, { ext: true });
  R('slant', 2, 'Slant', [[0, 3], ['in', 5, 8]], { depth: 3, dir: 'in, 45°' }, { ext: true });
  R('comeback', 3, 'Comeback', [[0, 15], ['out', 3, 12]], { depth: 15, dir: 'out and back toward the sideline' });
  R('curl', 4, 'Curl', [[0, 12], ['in', 1.5, 10.5]], { depth: 12, dir: 'in and back toward QB' });
  R('out', 5, 'Out', [[0, 10], ['out', 8, 10]], { depth: 10, dir: 'out, flat (90°)' }, { ext: true });
  R('dig', 6, 'Dig (In)', [[0, 12], ['in', 12, 12]], { depth: 12, dir: 'in, flat (90°)' }, { ext: true });
  R('corner', 7, 'Corner', [[0, 12], ['out', 8, 20]], { depth: 12, dir: 'out, 45° toward the pylon' }, { ext: true });
  R('post', 8, 'Post', [[0, 12], ['in', 8, 20]], { depth: 12, dir: 'in, 45° toward the goalposts' }, { ext: true });
  R('go', 9, 'Go (Fly / Fade / Streak)', [[0, 25]], { depth: null, dir: 'straight' }, { ext: true });
  L.ROUTE_TREE = ['hitch', 'flat', 'slant', 'comeback', 'curl', 'out', 'dig', 'corner', 'post', 'go'];
  // Named routes with no tree number (3).
  R('seam', null, 'Seam', [[0, 25]], { depth: null, dir: 'straight, from a slot or TE' }, { ext: true });
  R('drag', null, 'Drag (Shallow)', [['in', 2, 2], ['in', 15, 4]], { depth: null, dir: 'crosses the field at 2-5 yd' }, { ext: true });
  R('stick', null, 'Stick', [[0, 6], [0, 6]], { depth: 6, dir: 'sit facing QB' });            // CS convention: a fixed sit
  R('sail', null, 'Sail', [[0, 10], ['out', 10, 14]], { depth: 10, dir: 'out, at about 12-15 yd' }, { ext: true });
  R('wheel', null, 'Wheel', [['out', 4, 2], ['out', 8, 5], ['out', 8, 25]], { depth: 5, dir: 'flat, then up the sideline' }, { ext: true });
  R('arrow', null, 'Arrow', [['out', 5, 4]], { depth: null, dir: 'quick angle to the flat at 3-5 yd' }, { ext: true });
  R('whip', null, 'Whip', [['in', 2, 4], ['out', 4, 4]], { depth: 4, dir: 'fakes in, breaks back out' }, { ext: true });
  R('bubble', null, 'Bubble', [['out', 3, -1], ['out', 6, 0]], { depth: null, dir: 'drifts back and outside' });
  // Concept-specific: dagger's #1 dig breaks at 15-18 (6): the tree dig's shape at the sheet's
  // shallowest dagger depth, 15.
  R('dagger-dig', null, 'Dig (dagger, 15 yd)', [[0, 15], ['in', 12, 15]], { depth: 15, dir: 'in, flat (90°)' }, { ext: true, src: '3 dig shape; 6 dagger depth 15-18' });

  /* ── concepts (fact sheet 6) ── Each concept: its routes by receiver number (#1 outermost on a
     side), the coverages it is designed to beat, its conflict defender per coverage, and the
     canonical play. */
  L.CONCEPTS = {
    'concept:smash': { name: 'Smash', routes: '#1 hitch (5-6), #2 corner (break 10-12)', play: 'smash-vs-c2',
      conflict: { 'cov:2': 'the flat corner: squat on the hitch or sink under the corner' }, src: '6' },
    'concept:four-verts': { name: 'Four verticals', routes: 'four receivers on go/seam routes', play: 'four-verts-vs-c3',
      conflict: { 'cov:3': 'the deep-middle FS between two seams', 'cov:2': 'each half safety between seam and outside go' }, src: '6' },
    'concept:flood': { name: 'Flood / Sail', routes: '#1 go (clear), #2 sail/out at 12-15, #3 or RB flat', play: 'flood-vs-c3',
      conflict: { 'cov:3': 'the curl-flat defender (sail or flat) and the deep-third corner (go or sail)' }, src: '6' },
    'concept:mesh': { name: 'Mesh', routes: 'two shallow crossers passing close at about 5-6 yd, plus a sit/dig and outside clears', play: 'mesh-vs-c1',
      conflict: { 'cov:1': 'man defenders trailing crossers get rubbed by traffic', 'cov:0': 'man defenders trailing crossers get rubbed by traffic', 'cov:2man': 'man defenders trailing crossers get rubbed by traffic' }, src: '6' },
    'concept:stick': { name: 'Stick', routes: '#1 go/fade (clear), #2 flat or arrow, #3 stick (6 yd sit)', play: 'stick-vs-c3',
      conflict: { 'cov:3': 'the curl-flat defender: flat or stick' }, src: '6' },
    'concept:slant-flat': { name: 'Slant-flat', routes: '#1 slant, #2 flat or arrow', play: 'slant-flat-vs-c3',
      conflict: { 'cov:3': 'the curl-flat defender: widen to the flat (slant opens) or sink inside (flat opens)' }, src: '6' },
    'concept:curl-flat': { name: 'Curl-flat', routes: '#1 curl at 12, #2 flat', play: 'curl-flat-vs-c2',
      conflict: { 'cov:3': 'curl-flat defender', 'cov:2': 'the hook-curl defender (curl) with the corner on the flat' }, src: '6' },
    'concept:levels': { name: 'Levels', routes: 'two in-breaking routes on one side at different depths', play: 'levels-vs-c3',
      conflict: { 'cov:3': 'the hook defender: high-low read' }, src: '6' },
    'concept:dagger': { name: 'Dagger', routes: '#2 seam (clear), #1 dig at 15-18', play: 'dagger-vs-c3',
      conflict: { 'cov:3': 'hook defender and FS pulled by the seam', 'cov:4': 'the quarters safety carries #2 vertical, opening the dig' }, src: '6' },
    'concept:post-dig': { name: 'Post-dig ("Mills")', routes: '#1 post, #2 dig (or reversed)', play: 'post-dig-vs-c4',
      conflict: { 'cov:4': 'the quarters safety: drive on the dig (post opens) or stay deep (dig opens)' }, src: '6' },
  };

  /* ── BEATS (fact sheet 6) ── concept or route -> the coverages it is DESIGNED to beat, primary
     pairings only. Puzzles grade against BEATS alone. Three more tables keep the rest apart:
       BEATS_SIDE  primary, but only when thrown to one side (smash and the corner vs Cover 6,
                   "thrown to the Cover 2 side"); a puzzle using one must name the side.
       CONTESTED   commonly claimed but depends on the variant and the read: never the single right
                   answer, never a graded wrong answer either.
       POOR        the sheet says the concept is poor against it ("poor vs Cover 4"). */
  Object.assign(L.BEATS, {
    'concept:smash': ['cov:2'],
    'concept:four-verts': ['cov:3', 'cov:2'],
    'concept:flood': ['cov:3'],
    'concept:mesh': ['cov:1', 'cov:0', 'cov:2man'],
    'concept:stick': ['cov:3'],
    'concept:slant-flat': ['cov:3'],
    'concept:curl-flat': ['cov:3', 'cov:2'],
    'concept:levels': ['cov:3'],
    'concept:dagger': ['cov:3', 'cov:4'],
    'concept:post-dig': ['cov:4'],
    // Basic beater routes (6, second table).
    'route:hitch': ['cov:3'],
    'route:seam': ['cov:2'],
    'route:corner': ['cov:2'],
    'route:post': ['cov:2'],
    'route:slant': ['cov:0'],
  });
  L.BEATS_SIDE = {
    'concept:smash': [{ cov: 'cov:6', side: 'the Cover 2 side' }],
    'route:corner': [{ cov: 'cov:6', side: 'the Cover 2 side' }],
  };
  const ZONE_COVS = ['cov:2', 'cov:tampa2', 'cov:3', 'cov:4', 'cov:6'];
  L.CONTESTED = {
    'concept:smash': { covs: ['cov:4'], why: 'vs Cover 4 contested' },
    'concept:four-verts': { covs: ['cov:1'], why: 'vs Cover 1 contested (depends on matchups)' },
    'concept:flood': { covs: ['cov:2'], why: 'vs Cover 2 contested (sail into the corner-safety hole)' },
    // "vs zone it still works by settling crossers in voids, but that is a different read": every zone coverage.
    'concept:mesh': { covs: ZONE_COVS, why: 'vs zone it still works by settling crossers in voids, but that is a different read' },
    'concept:stick': { covs: ['cov:4'], why: 'vs Cover 4 contested' },
    // "vs man: slant can win on leverage, but that is a one-on-one, not a conflict": every man coverage.
    'concept:slant-flat': { covs: ['cov:0', 'cov:1', 'cov:2man'], why: 'vs man: slant can win on leverage, but that is a one-on-one, not a conflict' },
    'concept:curl-flat': { covs: ['cov:4'], why: 'vs Cover 4 contested (thin underneath)' },
    'concept:levels': { covs: ['cov:4'], why: 'vs Cover 4 contested' },
    'concept:dagger': { covs: ['cov:2'], why: 'vs Cover 2 contested' },
    // "vs Cover 2/split safeties contested": every split-safety (two-high) shell but Cover 4 itself (rank 5's MOFO list, plus Tampa 2's Cover 2 shell).
    'concept:post-dig': { covs: ['cov:2', 'cov:tampa2', 'cov:6', 'cov:2man'], why: 'vs Cover 2/split safeties contested' },
  };
  L.POOR = { 'concept:four-verts': { covs: ['cov:4'], why: 'poor vs Cover 4' } };

  /* ── ROUTE_BEATS (fact sheet 6) ── per-route truth for the route puzzle: which single route, or which
     route on which numbered receiver of a concept, beats which coverage. Primary pairings only (the
     "beats" columns); nothing that is only CONTESTED or POOR. One row per route-or-combo and coverage:
       route    a single route (the "Basic beater routes" table), any receiver
       routes   a combo: receiver number (#1/#2/#3 from the outside; "#3/RB" = #3 or the back) -> the
                route names the sheet allows there; `concept` names the concept it is
       side     only when thrown to that side (Cover 6): a puzzle using the row must name the side
       src      { sec: '6', q }: a phrase found verbatim in section 6
     Left out because the routes column names no route per numbered receiver: four verticals ("four
     receivers on go/seam routes"), mesh (crossers "plus a sit/dig and outside clears") and levels ("two
     in-breaking routes ... e.g."). Their truth stays the concept row in BEATS. */
  L.ROUTE_BEATS = [
    // Basic beater routes (single route vs coverage).
    { route: 'hitch', cov: 'cov:3', why: 'deep-third corners bail; the hitch sits in front of them', src: { sec: '6', q: 'Hitch | Cover 3 (off corners)' } },
    { route: 'seam', cov: 'cov:2', why: 'the deep middle between two half safeties is open', src: { sec: '6', q: 'Seam | Cover 2' } },
    { route: 'corner', cov: 'cov:2', why: 'the sideline hole behind the squatting corner and outside the half safety', src: { sec: '6', q: 'Corner | Cover 2; Cover 6 (Cover 2 side)' } },
    { route: 'corner', cov: 'cov:6', side: 'the Cover 2 side', why: 'the sideline hole behind the squatting corner and outside the half safety', src: { sec: '6', q: 'Corner | Cover 2; Cover 6 (Cover 2 side)' } },
    { route: 'post', cov: 'cov:2', why: 'splits the two half safeties', src: { sec: '6', q: 'Post | Cover 2' } },
    { route: 'slant', cov: 'cov:0', why: 'quick throw before unblocked pressure arrives, no deep help needed', src: { sec: '6', q: 'Slant | Cover 0' } },
    // Concepts whose routes column names a route per numbered receiver.
    { concept: 'concept:smash', routes: { '#1': ['hitch'], '#2': ['corner'] }, cov: 'cov:2', src: { sec: '6', q: '#1 hitch (5-6), #2 corner (break 10-12) | Cover 2' } },
    { concept: 'concept:smash', routes: { '#1': ['hitch'], '#2': ['corner'] }, cov: 'cov:6', side: 'the Cover 2 side', src: { sec: '6', q: 'Cover 2; Cover 6 (thrown to the Cover 2 side)' } },
    { concept: 'concept:flood', routes: { '#1': ['go'], '#2': ['sail', 'out'], '#3/RB': ['flat'] }, cov: 'cov:3', src: { sec: '6', q: '#1 go (clear), #2 sail/out at 12-15, #3 or RB flat | Cover 3' } },
    { concept: 'concept:stick', routes: { '#1': ['go'], '#2': ['flat', 'arrow'], '#3': ['stick'] }, cov: 'cov:3', src: { sec: '6', q: '#1 go/fade (clear), #2 flat or arrow, #3 stick (6 yd sit) | Cover 3' } },
    { concept: 'concept:slant-flat', routes: { '#1': ['slant'], '#2': ['flat', 'arrow'] }, cov: 'cov:3', src: { sec: '6', q: '#1 slant, #2 flat or arrow | Cover 3' } },
    { concept: 'concept:curl-flat', routes: { '#1': ['curl'], '#2': ['flat'] }, cov: 'cov:3', src: { sec: '6', q: '#1 curl at 12, #2 flat | Cover 3; Cover 2' } },
    { concept: 'concept:curl-flat', routes: { '#1': ['curl'], '#2': ['flat'] }, cov: 'cov:2', src: { sec: '6', q: '#1 curl at 12, #2 flat | Cover 3; Cover 2' } },
    { concept: 'concept:dagger', routes: { '#1': ['dagger-dig'], '#2': ['seam'] }, cov: 'cov:3', src: { sec: '6', q: '#2 seam (clear), #1 dig at 15-18 | Cover 3; Cover 4' } },
    { concept: 'concept:dagger', routes: { '#1': ['dagger-dig'], '#2': ['seam'] }, cov: 'cov:4', src: { sec: '6', q: '#2 seam (clear), #1 dig at 15-18 | Cover 3; Cover 4' } },
    { concept: 'concept:post-dig', routes: { '#1': ['post'], '#2': ['dig'] }, cov: 'cov:4', src: { sec: '6', q: '#1 post, #2 dig (or reversed) | Cover 4' } },
    { concept: 'concept:post-dig', routes: { '#1': ['dig'], '#2': ['post'] }, cov: 'cov:4', src: { sec: '6', q: '#1 post, #2 dig (or reversed) | Cover 4' } },
  ];

  /* ── run schemes (fact sheet 7) ── Per-lineman rules as data, drawn for a run to the RIGHT (the
     playside); mirror the side for a run left. Rule tokens are explained in RUN_RULES. None of this
     is drawable yet: blocking a man, pulling and handing off are engine features (NEEDS_ENGINE). */
  L.RUN_RULES = {
    zone: 'step playside with the line; covered (a defender in your playside gap or on you) = block him; uncovered = combine with the adjacent playside lineman on his DL, then climb to the LB',
    cutoff: 'backside tackle cuts off his gap',
    reach: "reach-step playside; get the head across the defender's playside shoulder; uncovered men combine and climb",
    down: 'block the defender to your inside',
    back: 'center blocks back',
    hinge: 'backside tackle hinges (protects his inside gap)',
    'pull-lead': 'pull through the hole and lead up on the playside LB',
    'pull-kick': 'pull and kick out the EMOL',
    'pull-trap': 'pull and block the unblocked interior DL from the side',
    release: 'release to the linebackers',
    steer: 'show pass set, let the rusher come upfield, then steer him past the hole',
  };
  L.RUN_SCHEMES = {
    'inside-zone': { name: 'Inside zone', family: 'zone', side: 'R', src: '7',
      ol: { LT: 'cutoff', LG: 'zone', C: 'zone', RG: 'zone', RT: 'zone' }, pullers: [],
      aim: { gaps: ['A-gap-R', 'B-gap-R'], text: 'aim at the playside guard (A/B gap)' },
      read: 'read the first DL from the playside A gap outward: hit the front side, or cut back if the defense flows' },
    'outside-zone': { name: 'Outside zone (stretch / wide zone)', family: 'zone', side: 'R', src: '7',
      ol: { LT: 'reach', LG: 'reach', C: 'reach', RG: 'reach', RT: 'reach' }, pullers: [],
      aim: { gaps: ['C-gap-R', 'D-gap-R'], text: 'aim at the outside hip of the TE (or tackle)' },
      read: "read the playside EMOL's block: if he's sealed inside, bounce outside; if not, cut up or back" },
    power: { name: 'Power', family: 'gap', side: 'R', src: '7',
      ol: { LT: 'hinge', LG: 'pull-lead', C: 'back', RG: 'down', RT: 'down' }, pullers: ['LG'],
      kickout: { by: ['FB', 'H'], target: 'EMOL' },
      aim: { gaps: ['B-gap-R', 'C-gap-R'], text: 'off-tackle, playside B or C gap' },
      read: 'follow the puller, inside the kick-out' },
    counter: { name: 'Counter (counter trey / GT)', family: 'gap', side: 'R', src: '7',
      // The sheet: "playside down blocks as in power". The center's rule is read from "as in
      // power" (power: the center blocks back); flagged in `notes`.
      ol: { LT: 'pull-lead', LG: 'pull-kick', C: 'back', RG: 'down', RT: 'down' }, pullers: ['LG', 'LT'],
      notes: { C: 'read from "as in power"' }, counterStep: true,
      aim: { gaps: ['B-gap-R', 'C-gap-R'], text: 'jab away, then follow the pullers through the playside B/C gap' },
      read: 'follow the pullers' },
    // Trap, drawn against the 4-3 Over's 3 technique (DT-R, outside shade of the RG): the two
    // linemen next to him release, the backside guard pulls and traps him. The sheet gives no
    // rule for the center or the backside tackle on trap: null.
    trap: { name: 'Trap', family: 'gap', side: 'R', src: '7', trapped: 'DT-R',
      ol: { LT: null, LG: 'pull-trap', C: null, RG: 'release', RT: 'release' }, pullers: ['LG'],
      aim: { gaps: ['A-gap-R', 'B-gap-R'], text: 'quick inside hit (A/B gap) right behind the trap block' },
      read: 'hit right behind the trap block' },
    // 7's note sorts zone (inside, outside) and gap (power, counter, trap) and leaves the draw in
    // neither: family null rather than a guess.
    draw: { name: 'Draw', family: null, side: 'R', src: '7',
      ol: { LT: 'steer', LG: 'steer', C: 'steer', RG: 'steer', RT: 'steer' }, pullers: [],
      aim: { gaps: null, text: 'the open lane between rushers who overran it' },
      read: 'QB drops as if to pass, hands off late; RB reads the open lane between rushers who overran it' },
  };

  /* ── engine features the sheet needs that cs-core cannot draw yet ── Each: what it is, the data
     shape the library already writes, and where. The suite requires every needsEngine tag in the
     library to be listed here. */
  L.NEEDS_ENGINE = {
    handoff: { what: 'the QB hands the ball to a back; the back carries it', shape: "ball: [{t, ev:'snap'}, {t, ev:'handoff', to:'RB'}]; assign.QB = {handoff:'RB'} (with drop:3 on a draw)", where: 'PENDING_PLAYS (runs)' },
    carry: { what: 'a ball carrier runs at an aim point with a read', shape: "assign.RB = {carry: {aim:'B-gap-R'|null, read:'<text>', counterStep?:true, follow?:'LG'}}", where: 'PENDING_PLAYS' },
    'run-block': { what: 'a lineman blocks by rule (zone, reach, down, back, hinge, cutoff, release, steer)', shape: "assign.RG = {run:'down'} (tokens and their meaning: L.RUN_RULES)", where: 'RUN_SCHEMES[*].ol, PENDING_PLAYS' },
    pull: { what: 'a lineman leaves his spot at the snap and runs along the line to kick out, lead or trap', shape: "assign.LG = {run:'pull-kick'|'pull-lead'|'pull-trap', pull:{target:'EMOL'|'PS-LB'|'<defender id>', via:'C-gap-R'}}", where: 'RUN_SCHEMES power/counter/trap, PENDING_PLAYS' },
    'combo-climb': { what: 'two linemen double a DL, then one climbs to a linebacker', shape: "assign.RG = {run:'zone'|'reach'}, resolved at the snap to {combo:{with:'RT', on:'<DL id>', climb:'<LB id>'}}", where: 'RUN_SCHEMES inside/outside zone, PENDING_PLAYS' },
    'kick-out': { what: 'a back blocks the end man on the line from inside out', shape: "assign.FB = {kick:'EMOL'}", where: 'PENDING_PLAYS power' },
    'man-or-rush': { what: "Cover 0's Mike: man on the RB, rushes if the RB stays in to block", shape: "{man:'RB', ifBlocks:{rush:'<gap>'}}", where: 'DEFENSES c0-*' },
    'zone-read': { what: 'a quarters safety reads #2: carries him vertical or drives on his short route', shape: "{zone:'deep-quarter-LM', read:{key:'#2', of:'H'}}", where: 'DEFENSES c4-*, c6-*' },
    trail: { what: 'man coverage from just behind and under the receiver, trusting deep help', shape: "{man:'X', technique:'trail'}", where: 'DEFENSES c2m-*' },
    'rush-delay': { what: 'a rusher starts late and loops behind a teammate (stunts and twists)', shape: "{rush:'B-gap-L', delay:0.35, loop:true}", where: 'STUNTS' },
  };

  /* ── teams ── abbr -> name for the end zones and primary/alt colours (the kit code in
     cs-field.js reads its real home/road uniforms from its own copied RA_KITS table). */
  const T = (name, color, alt, city) => ({ name, color, alt, city });
  Object.assign(L.TEAMS, {
    ARI: T('Cardinals', '#97233F', '#FFB612', 'Arizona'), ATL: T('Falcons', '#A71930', '#101820', 'Atlanta'), BAL: T('Ravens', '#241773', '#9E7C0C', 'Baltimore'),
    BUF: T('Bills', '#00338D', '#C60C30', 'Buffalo'), CAR: T('Panthers', '#0085CA', '#101820', 'Carolina'), CHI: T('Bears', '#0B162A', '#C83803', 'Chicago'),
    CIN: T('Bengals', '#FB4F14', '#101820', 'Cincinnati'), CLE: T('Browns', '#311D00', '#FF3C00', 'Cleveland'), DAL: T('Cowboys', '#002244', '#869397', 'Dallas'),
    DEN: T('Broncos', '#FB4F14', '#002244', 'Denver'), DET: T('Lions', '#0076B6', '#B0B7BC', 'Detroit'), GB: T('Packers', '#203731', '#FFB612', 'Green Bay'),
    HOU: T('Texans', '#03202F', '#A71930', 'Houston'), IND: T('Colts', '#002C5F', '#A2AAAD', 'Indianapolis'), JAX: T('Jaguars', '#006778', '#D7A22A', 'Jacksonville'),
    KC: T('Chiefs', '#E31837', '#FFB81C', 'Kansas City'), LV: T('Raiders', '#000000', '#A5ACAF', 'Las Vegas'), LAC: T('Chargers', '#0080C6', '#FFC20E', 'Los Angeles'),
    LAR: T('Rams', '#003594', '#FFD100', 'Los Angeles'), MIA: T('Dolphins', '#008E97', '#FC4C02', 'Miami'), MIN: T('Vikings', '#4F2683', '#FFC62F', 'Minnesota'),
    NE: T('Patriots', '#002244', '#C60C30', 'New England'), NO: T('Saints', '#D3BC8D', '#101820', 'New Orleans'), NYG: T('Giants', '#0B2265', '#A71930', 'New York'),
    NYJ: T('Jets', '#125740', '#FFFFFF', 'New York'), PHI: T('Eagles', '#004C54', '#A5ACAF', 'Philadelphia'), PIT: T('Steelers', '#FFB612', '#101820', 'Pittsburgh'),
    SF: T('49ers', '#AA0000', '#B3995D', 'San Francisco'), SEA: T('Seahawks', '#002244', '#69BE28', 'Seattle'), TB: T('Buccaneers', '#D50A0A', '#34302B', 'Tampa Bay'),
    TEN: T('Titans', '#4495D2', '#0C2340', 'Tennessee'), WSH: T('Commanders', '#5A1414', '#FFB612', 'Washington'),
  });
  for (const [k, v] of Object.entries(L.TEAMS)) v.abbr = k;

  /* ── what a tap reads out ── by player id; anything missing falls back to the position. */
  Object.assign(L.LABELS, {
    QB: 'Quarterback', RB: 'Running back', FB: 'Fullback', X: 'X receiver (split end)', Z: 'Z receiver (flanker)',
    H: 'Slot receiver (H)', Y: 'Tight end (Y)', U: 'Tight end (U)', LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle',
    'DE-L': 'Defensive end', 'DE-R': 'Defensive end', 'DT-L': 'Defensive tackle', 'DT-R': 'Defensive tackle', NT: 'Nose tackle',
    SAM: 'Sam linebacker', MIKE: 'Mike linebacker', WILL: 'Will linebacker', 'OLB-L': 'Outside linebacker', 'OLB-R': 'Outside linebacker', NB: 'Nickel back', DIME: 'Dime back',
    'CB-L': 'Cornerback', 'CB-R': 'Cornerback', FS: 'Free safety', SS: 'Strong safety',
  });
  // The name of a ROLE (CS.roleOf), for questions and answers.
  L.ROLE_NAMES = {
    LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle',
    QB: 'Quarterback', RB: 'Running back', FB: 'Fullback', TE: 'Tight end', X: 'X receiver', Z: 'Z receiver', H: 'Slot receiver', WR: 'Wide receiver',
    DE: 'Defensive end', DT: 'Defensive tackle', NT: 'Nose tackle', SAM: 'Sam linebacker', MIKE: 'Mike linebacker', WILL: 'Will linebacker', LB: 'Linebacker',
    CB: 'Cornerback', FS: 'Free safety', SS: 'Strong safety', NB: 'Nickel back', S: 'Safety',
  };

  /* ── plays ── One canonical play per pass concept, against a coverage it is designed to beat
     (BEATS). Every one opts in to its route chalk (a concept IS its routes); zone chalk where the
     defense plays zone. Callouts state only fact-sheet facts: `src` is a list of {sec, q}, q a
     verbatim phrase of that section. Ball timing: the throw comes once the QB has finished his drop
     and the target is at or past his break; the catch is on the receiver (cs-core lands the arc on
     him). Teams: a different real pairing on every play. */
  const S = (sec, q) => ({ sec, q });
  const PASS_SET = { LT: { pass: 'set' }, LG: { pass: 'set' }, C: { pass: 'set' }, RG: { pass: 'set' }, RT: { pass: 'set' } };
  function CP(id, o) {
    const p = { id, home: 'off', spot: 35, dist: 10, routes: true, zones: true, ...o, assign: { ...PASS_SET, ...o.assign },
      ball: [{ t: 0, ev: 'snap' }, { t: o.throwT, ev: 'throw', to: o.to }, { t: o.catchT, ev: 'catch' }], tags: [o.concept, o.beats], src: '6' };
    for (const k of ['throwT', 'catchT', 'to']) delete p[k];
    L.PLAYS[id] = p;
  }

  // Smash vs Cover 2 (fact sheet 6): #1 hitch, #2 corner, on both sides. The flat corner can sink
  // under the corner route or squat on the hitch, not both. (The phase-1 seed play, kept as it
  // was; its callouts now carry their sources.)
  L.PLAYS['smash-vs-c2'] = {
    id: 'smash-vs-c2', name: 'Smash vs Cover 2', formation: 'gun-2x2', defense: 'c2-43-over', concept: 'concept:smash',
    teams: { off: 'KC', def: 'BUF' }, home: 'off', spot: 35, dist: 10,
    // Chalk is opt-in (docs/coachschool.md, 2026-11-11): smash IS its routes against its zones, so
    // this play shows both wherever it is watched.
    routes: true, zones: true,
    assign: {
      X: { route: 'hitch' }, H: { route: 'corner' }, Z: { route: 'hitch' }, Y: { route: 'corner' },
      RB: { block: 'B-gap-L' }, QB: { drop: 3 },
      LT: { pass: 'slide-L' }, LG: { pass: 'slide-L' }, C: { pass: 'slide-L' }, RG: { pass: 'slide-L' }, RT: { pass: 'slide-L' },
    },
    ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'H' }, { t: 3.3, ev: 'catch' }],
    tags: ['concept:smash', 'cov:2'], beats: 'cov:2', src: '6',
    callouts: [
      { t: -1.1, focus: 'FS', text: 'Two safeties deep, each one guarding half the field. That is Cover 2.', src: [S('5b', '2 deep halves, 5 underneath zones')] },
      { t: 1.2, focus: 'CB-L', text: "The corner owns the flat. He can sink under the corner route or squat on the hitch. He can't do both.", src: [S('5a', 'flat L (jam #1)'), S('6', 'the flat corner: squat on the hitch or sink under the corner')] },
      { t: 3.0, focus: 'H', text: 'He squats, so the ball goes over him: behind the corner, in front of the safety.', src: [S('5b', 'the hole between corner and half safety along the sideline at about 15-20 yd (corner route)')] },
    ],
  };

  CP('four-verts-vs-c3', { name: 'Four verticals vs Cover 3', formation: 'gun-2x2', defense: 'c3-nickel', concept: 'concept:four-verts', beats: 'cov:3',
    teams: { off: 'CIN', def: 'PIT' },
    assign: { X: { route: 'go' }, H: { route: 'seam' }, Y: { route: 'seam' }, Z: { route: 'go' }, RB: { block: 'B-gap-R' }, QB: { drop: 5 } },
    to: 'H', throwT: 2.0, catchT: 2.8,
    callouts: [
      { t: -1.0, focus: ['CB-L', 'CB-R', 'FS'], text: 'Cover 3: three deep defenders, each with a third of the field.', src: [S('5b', '3 deep thirds, 4 underneath')] },
      { t: 1.0, focus: ['X', 'H', 'Y', 'Z'], text: 'Four receivers go deep against three deep defenders.', src: [S('6', 'Cover 3 (four vs three deep)')] },
      { t: 2.2, focus: 'FS', text: 'The middle safety sits between two seams. He can only take one.', src: [S('6', 'the deep-middle FS between two seams')] },
    ] });

  CP('flood-vs-c3', { name: 'Flood vs Cover 3', formation: 'gun-2x2', defense: 'c3-nickel', concept: 'concept:flood', beats: 'cov:3',
    teams: { off: 'MIA', def: 'NYJ' },
    assign: { Z: { route: 'go' }, Y: { route: 'sail' }, RB: { route: 'flat' }, X: { route: 'hitch' }, H: { route: 'slant' }, QB: { drop: 3 } },
    to: 'RB', throwT: 1.4, catchT: 2.0,
    callouts: [
      { t: -1.0, focus: 'NB', text: 'In Cover 3 this defender has the curl, then the flat.', src: [S('5a', 'curl-flat R'), S('4', 'one defender responsible for the curl then the flat')] },
      { t: 0.9, focus: ['Z', 'Y', 'RB'], text: 'Three receivers at three levels on one side: deep, middle and flat.', src: [S('6', 'three levels to one side')] },
      { t: 1.7, focus: 'RB', text: "He can't take both the sail and the flat. He sits under the sail, so the flat is open.", src: [S('6', 'the curl-flat defender (sail or flat)')] },
    ] });

  CP('mesh-vs-c1', { name: 'Mesh vs Cover 1', formation: 'gun-2x2', defense: 'c1-nickel', concept: 'concept:mesh', beats: 'cov:1', zones: false,
    teams: { off: 'LAR', def: 'SF' },
    // The two crossers pass close; Y leaves a beat later so the two don't run through each other.
    assign: { X: { route: 'go' }, Z: { route: 'go' }, H: { route: 'drag' }, Y: { route: 'drag', delay: 0.3 }, RB: { route: 'stick' }, QB: { drop: 3 } },
    to: 'H', throwT: 1.5, catchT: 2.1,
    callouts: [
      { t: -1.0, focus: 'FS', text: 'Cover 1: man coverage with one free safety deep.', src: [S('5b', 'man with one deep free safety')] },
      { t: 0.8, focus: ['H', 'Y'], text: 'Two shallow crossers pass close to each other.', src: [S('6', 'two shallow crossers passing close')] },
      { t: 1.6, focus: 'H', text: 'A man defender chasing a crosser runs into the traffic.', src: [S('6', 'man defenders trailing crossers get rubbed by traffic')] },
    ] });

  CP('stick-vs-c3', { name: 'Stick vs Cover 3', formation: 'gun-trips-rt', defense: 'c3-nickel', concept: 'concept:stick', beats: 'cov:3',
    teams: { off: 'PHI', def: 'DAL' },
    assign: { Z: { route: 'go' }, H: { route: 'arrow' }, Y: { route: 'stick' }, X: { route: 'slant' }, RB: { block: 'B-gap-L' }, QB: { drop: 3 } },
    to: 'Y', throwT: 1.0, catchT: 1.5,
    callouts: [
      { t: -1.0, focus: 'NB', text: 'Cover 3 gives this defender the curl, then the flat.', src: [S('5a', 'curl-flat R'), S('4', 'one defender responsible for the curl then the flat')] },
      { t: 0.6, focus: ['H', 'Y'], text: 'The arrow runs to the flat. The stick sits at 6 yards, facing the quarterback.', src: [S('3', 'quick angled release to the flat at 3-5 yd'), S('3', 'sit facing QB')] },
      { t: 1.3, focus: 'Y', text: 'He has the flat or the stick, not both. He widens, so the stick is open.', src: [S('6', 'the curl-flat defender: flat or stick')] },
    ] });

  CP('slant-flat-vs-c3', { name: 'Slant-flat vs Cover 3', formation: 'gun-2x2', defense: 'c3-nickel', concept: 'concept:slant-flat', beats: 'cov:3',
    teams: { off: 'DET', def: 'GB' },
    assign: { X: { route: 'slant' }, H: { route: 'flat' }, Z: { route: 'slant' }, Y: { route: 'flat' }, RB: { block: 'B-gap-R' }, QB: { drop: 3 } },
    to: 'Y', throwT: 0.9, catchT: 1.5,
    callouts: [
      { t: -1.0, focus: 'NB', text: 'This defender has the curl, then the flat.', src: [S('5a', 'curl-flat R'), S('4', 'one defender responsible for the curl then the flat')] },
      { t: 0.5, focus: ['Z', 'Y'], text: 'Slant inside, flat outside, and one defender between them.', src: [S('6', '#1 slant, #2 flat or arrow'), S('6', 'the curl-flat defender: widen to the flat (slant opens) or sink inside (flat opens)')] },
      { t: 1.2, focus: 'Y', text: 'He sinks under the slant, so the flat opens.', src: [S('6', 'sink inside (flat opens)')] },
    ] });

  CP('curl-flat-vs-c2', { name: 'Curl-flat vs Cover 2', formation: 'gun-2x2', defense: 'c2-nickel', concept: 'concept:curl-flat', beats: 'cov:2',
    teams: { off: 'BAL', def: 'CLE' },
    assign: { X: { route: 'curl' }, H: { route: 'flat' }, Z: { route: 'curl' }, Y: { route: 'flat' }, RB: { block: 'B-gap-R' }, QB: { drop: 5 } },
    to: 'Z', throwT: 1.8, catchT: 2.4,
    callouts: [
      { t: -1.0, focus: ['FS', 'SS'], text: 'Two deep safeties, two deep halves: Cover 2.', src: [S('5b', '2 deep halves, 5 underneath zones')] },
      { t: 1.0, focus: 'CB-R', text: 'In Cover 2 the corner has the flat.', src: [S('5a', 'flat R (jam #1)')] },
      { t: 2.1, focus: 'Z', text: 'The curl belongs to the hook-curl defender, and the corner is down in the flat.', src: [S('6', 'the hook-curl defender (curl) with the corner on the flat')] },
    ] });

  CP('levels-vs-c3', { name: 'Levels vs Cover 3', formation: 'gun-2x2', defense: 'c3-nickel', concept: 'concept:levels', beats: 'cov:3',
    teams: { off: 'BUF', def: 'NE' },
    assign: { X: { route: 'dig' }, H: { route: 'drag' }, Z: { route: 'go' }, Y: { route: 'curl' }, RB: { block: 'B-gap-R' }, QB: { drop: 5 } },
    to: 'H', throwT: 1.3, catchT: 1.9,
    callouts: [
      { t: -1.0, focus: 'MIKE', text: 'In Cover 3 the Mike drops to the hook zone.', src: [S('5a', 'hook L')] },
      { t: 0.8, focus: ['X', 'H'], text: 'Two in-breaking routes on one side, one high and one low.', src: [S('6', 'two in-breaking routes on one side at different depths')] },
      { t: 1.6, focus: 'H', text: 'He stays high on the dig, so the low route opens.', src: [S('6', 'the hook defender: high-low read')] },
    ] });

  CP('dagger-vs-c3', { name: 'Dagger vs Cover 3', formation: 'gun-2x2', defense: 'c3-nickel', concept: 'concept:dagger', beats: 'cov:3',
    teams: { off: 'SF', def: 'SEA' },
    assign: { Y: { route: 'seam' }, Z: { route: 'dagger-dig' }, X: { route: 'curl' }, H: { route: 'hitch' }, RB: { block: 'B-gap-R' }, QB: { drop: 7 } },
    to: 'Z', throwT: 2.6, catchT: 3.4,
    callouts: [
      { t: -1.0, focus: 'FS', text: 'Cover 3: this safety takes the deep middle third.', src: [S('5a', 'deep middle third')] },
      { t: 1.2, focus: 'Y', text: 'The seam is there to pull the hook defender and the safety with it.', src: [S('6', 'hook defender and FS pulled by the seam')] },
      { t: 2.9, focus: 'Z', text: 'The dig comes in behind them at 15 yards.', src: [S('6', '#1 dig at 15-18')] },
    ] });

  CP('post-dig-vs-c4', { name: 'Post-dig vs Cover 4', formation: 'gun-2x2', defense: 'c4-nickel', concept: 'concept:post-dig', beats: 'cov:4',
    teams: { off: 'MIN', def: 'CHI' },
    assign: { Z: { route: 'post' }, Y: { route: 'dig' }, X: { route: 'curl' }, H: { route: 'hitch' }, RB: { block: 'B-gap-R' }, QB: { drop: 5 } },
    to: 'Y', throwT: 1.8, catchT: 2.3,
    callouts: [
      { t: -1.0, focus: ['FS', 'SS'], text: 'Cover 4: four deep quarters, and these two safeties read the number 2 receiver.', src: [S('5b', '4 deep quarters, 3 underneath; safeties read #2')] },
      { t: 1.0, focus: ['Z', 'Y'], text: 'Post outside, dig inside, and the quarters safety in between.', src: [S('6', '#1 post, #2 dig')] },
      { t: 2.0, focus: 'Y', text: 'He stays deep for the post, so the dig opens.', src: [S('6', 'stay deep (dig opens)')] },
    ] });

  /* ── plays the engine cannot draw yet ── One canonical run per scheme (7), run right. Not in
     PLAYS: nothing may watch or grade them until cs-core grows the features they name. */
  L.PENDING_PLAYS = {};
  const RUN = (id, o) => { L.PENDING_PLAYS[id] = { id, home: 'off', spot: 35, dist: 10, src: '7', ...o, tags: ['run:' + o.scheme] }; };
  const olOf = (scheme) => { const a = {}; for (const [k, v] of Object.entries(L.RUN_SCHEMES[scheme].ol)) if (v) a[k] = { run: v }; return a; };
  RUN('run-inside-zone', { name: 'Inside zone right', scheme: 'inside-zone', formation: 'singleback', defense: 'c3-43-over', teams: { off: 'PHI', def: 'NYG' },
    needsEngine: ['handoff', 'carry', 'run-block', 'combo-climb'],
    assign: { ...olOf('inside-zone'), QB: { handoff: 'RB' }, RB: { carry: { aim: 'B-gap-R', read: L.RUN_SCHEMES['inside-zone'].read } } },
    ball: [{ t: 0, ev: 'snap' }, { t: 0.8, ev: 'handoff', to: 'RB' }] });
  RUN('run-outside-zone', { name: 'Outside zone right', scheme: 'outside-zone', formation: 'singleback', defense: 'c3-43-over', teams: { off: 'SF', def: 'LAR' },
    needsEngine: ['handoff', 'carry', 'run-block', 'combo-climb'],
    assign: { ...olOf('outside-zone'), QB: { handoff: 'RB' }, RB: { carry: { aim: 'C-gap-R', read: L.RUN_SCHEMES['outside-zone'].read } } },
    ball: [{ t: 0, ev: 'snap' }, { t: 0.8, ev: 'handoff', to: 'RB' }] });
  RUN('run-power', { name: '26 Power', scheme: 'power', formation: 'i-form', defense: 'c3-43-over', teams: { off: 'BAL', def: 'PIT' },
    needsEngine: ['handoff', 'carry', 'run-block', 'pull', 'kick-out'],
    assign: { ...olOf('power'), LG: { run: 'pull-lead', pull: { target: 'PS-LB', via: 'C-gap-R' } }, FB: { kick: 'EMOL' }, QB: { handoff: 'RB' },
      RB: { carry: { aim: 'C-gap-R', follow: 'LG', read: L.RUN_SCHEMES.power.read } } },
    ball: [{ t: 0, ev: 'snap' }, { t: 0.9, ev: 'handoff', to: 'RB' }] });
  RUN('run-counter', { name: 'Counter right', scheme: 'counter', formation: 'singleback', defense: 'c3-43-over', teams: { off: 'WSH', def: 'DAL' },
    needsEngine: ['handoff', 'carry', 'run-block', 'pull'],
    assign: { ...olOf('counter'), LG: { run: 'pull-kick', pull: { target: 'EMOL', via: 'C-gap-R' } }, LT: { run: 'pull-lead', pull: { target: 'PS-LB', via: 'C-gap-R' } },
      QB: { handoff: 'RB' }, RB: { carry: { aim: 'C-gap-R', counterStep: true, follow: 'LG', read: L.RUN_SCHEMES.counter.read } } },
    ball: [{ t: 0, ev: 'snap' }, { t: 1.0, ev: 'handoff', to: 'RB' }] });
  RUN('run-trap', { name: 'Trap right', scheme: 'trap', formation: 'i-form', defense: 'c3-43-over', teams: { off: 'CLE', def: 'CIN' },
    needsEngine: ['handoff', 'carry', 'run-block', 'pull'],
    assign: { ...olOf('trap'), LG: { run: 'pull-trap', pull: { target: 'DT-R', via: 'A-gap-R' } }, QB: { handoff: 'RB' },
      RB: { carry: { aim: 'A-gap-R', read: L.RUN_SCHEMES.trap.read } } },
    ball: [{ t: 0, ev: 'snap' }, { t: 0.7, ev: 'handoff', to: 'RB' }] });
  RUN('run-draw', { name: 'Draw', scheme: 'draw', formation: 'gun-2x2', defense: 'c3-nickel', teams: { off: 'GB', def: 'MIN' },
    needsEngine: ['handoff', 'carry', 'run-block'],
    assign: { ...olOf('draw'), QB: { drop: 3, handoff: 'RB' }, RB: { carry: { aim: null, read: L.RUN_SCHEMES.draw.read } } },
    ball: [{ t: 0, ev: 'snap' }, { t: 1.4, ev: 'handoff', to: 'RB' }] });
})(typeof window !== 'undefined' ? window : globalThis);
