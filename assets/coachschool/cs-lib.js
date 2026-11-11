/* Coach School library: formations, defenses, zone landmarks, routes, plays, the BEATS truth
   table, team names and colours, player labels. Data only; loads after cs-core.js (Node vm too).

   SOURCE: docs/coachschool-facts.md, the single source of football truth. Phase 2 replaced the
   phase-1 provisional values with the sheet's own numbers:
     - offensive line and backfield constants ............ section 1a
     - formations (strength right; mirror for left) ....... section 1b
     - defensive fronts and sub packages ................... sections 1c-1e
     - coverage assignments (who drops where) .............. section 5a
     - zone landmarks ...................................... section 4
     - route waypoints ..................................... section 3
   Where the sheet leaves a gap that the engine still has to fill, the comment at that line says
   what was chosen and why; none of those choices is taught as a fact in any lesson.
   Coordinates: see cs-core.js (x across 0..53.33, 0 = the offense's left sideline; y from the
   line of scrimmage, + = offense's downfield). */
(function (root) {
  'use strict';
  const CS = root.CS;
  const L = CS.lib;
  const W = CS.FIELD_W;

  /* ── formations (fact sheet 1a/1b) ── The five linemen 1.5 yd centre to centre, all ON the line
     at y = 0; everyone off the line at y = -1 or deeper; exactly 7 on and 4 off. */
  const LINE = [
    { id: 'LT', pos: 'T', dx: -3, y: 0, on: true },
    { id: 'LG', pos: 'G', dx: -1.5, y: 0, on: true },
    { id: 'C', pos: 'C', dx: 0, y: 0, on: true },
    { id: 'RG', pos: 'G', dx: 1.5, y: 0, on: true },
    { id: 'RT', pos: 'T', dx: 3, y: 0, on: true },
  ];
  const F = (id, name, personnel, players) => { L.FORMATIONS[id] = { id, name, personnel, strength: 'R', players: [...LINE, ...players] }; };
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
  F('pistol', 'Pistol', '11', [
    { id: 'X', pos: 'WR', x: 6, y: 0, on: true },
    { id: 'Y', pos: 'TE', x: 31.17, y: 0, on: true },
    { id: 'H', pos: 'WR', x: 15, y: -1, on: false },
    { id: 'Z', pos: 'WR', x: 47.33, y: -1, on: false },
    { id: 'QB', pos: 'QB', x: 26.67, y: -4 },
    { id: 'RB', pos: 'RB', x: 26.67, y: -7 },
  ]);

  /* ── zone landmarks (fact sheet 4) ── Written for the left side; the right side is the mirror,
     53.33 - x, exactly the sheet's right-hand column. `deep` marks the zones that count toward a
     coverage's deep defenders. The sheet's combined names: curl-flat = "the curl, then the flat"
     and hook-curl = "hook, then curl", so each starts from its first zone's landmark. */
  const Z = {
    'flat-L': { x: 5, y: 6 },
    'curl-L': { x: 12, y: 11 },
    'hook-L': { x: 21, y: 10 },
    'curl-flat-L': { x: 12, y: 11 },
    'hook-curl-L': { x: 21, y: 10 },
    'deep-third-L': { x: 9, y: 16, deep: true },
    'deep-half-L': { x: 18, y: 16, deep: true },
    'deep-quarter-L': { x: 7, y: 14, deep: true },
    'deep-quarter-LM': { x: 20, y: 14, deep: true },
  };
  for (const [k, v] of Object.entries(Z)) {
    L.ZONES[k] = v;
    L.ZONES[k.replace(/-L(M?)$/, '-R$1')] = { ...v, x: Math.round((W - v.x) * 100) / 100 };
  }
  L.ZONES['hook-M'] = { x: 26.67, y: 11 };                          // middle hook (Cover 2 Mike)
  L.ZONES['hole-M'] = { x: 26.67, y: 18 };                          // middle hole (Tampa 2 Mike)
  L.ZONES['deep-third-M'] = { x: 26.67, y: 16, deep: true };

  /* ── defenses (fact sheet 1d/1e for alignment, 5a for the coverage) ── All drawn for strength
     RIGHT; cs-core mirrors a play's defense along with its formation. Ids name the offense's
     left/right (CB-L is the corner on the offense's left). Four linemen rush their gap. */
  const D = (id, name, coverage, personnel, players) => { L.DEFENSES[id] = { id, name, coverage, personnel, players }; };
  const OVER_DL = [                                                // 4-3 Over front
    { id: 'DE-R', pos: 'DE', x: 30.17, y: 1, rush: 'C-gap-R' },     // strong end, 5 technique
    { id: 'DT-R', pos: 'DT', x: 28.67, y: 1, rush: 'B-gap-R' },     // 3 technique
    { id: 'DT-L', pos: 'DT', x: 26.17, y: 1, rush: 'A-gap-L' },     // 1 technique, weak
    { id: 'DE-L', pos: 'DE', x: 23.17, y: 1, rush: 'C-gap-L' },     // weak end, 5 technique
  ];
  const BASE_DB = (cbL, cbR, fs, ss) => [
    { id: 'CB-L', pos: 'CB', x: 6, y: 7, zone: cbL },
    { id: 'CB-R', pos: 'CB', x: 47.33, y: 7, zone: cbR },
    { id: 'FS', pos: 'S', x: 18, y: 12, zone: fs },
    { id: 'SS', pos: 'S', x: 35.33, y: 12, zone: ss },
  ];
  // Cover 2 (5a): corners in the flats, safeties in the deep halves, the three backers underneath.
  // In base personnel the Sam takes the nickel's hook-curl.
  D('c2-43-over', '4-3 Over, Cover 2', 'cov:2', 'base', [
    ...OVER_DL,
    { id: 'SAM', pos: 'LB', x: 32.67, y: 4.5, zone: 'hook-curl-R' },
    { id: 'MIKE', pos: 'LB', x: 27.67, y: 4.5, zone: 'hook-M' },
    { id: 'WILL', pos: 'LB', x: 24.17, y: 4.5, zone: 'hook-curl-L' },
    ...BASE_DB('flat-L', 'flat-R', 'deep-half-L', 'deep-half-R'),
  ]);
  // Cover 3 (5a): corners and the free safety in the deep thirds, four underneath. In base
  // personnel the Sam takes the nickel's curl-flat.
  D('c3-43-over', '4-3 Over, Cover 3', 'cov:3', 'base', [
    ...OVER_DL,
    { id: 'SAM', pos: 'LB', x: 32.67, y: 4.5, zone: 'curl-flat-R' },
    { id: 'MIKE', pos: 'LB', x: 27.67, y: 4.5, zone: 'hook-L' },
    { id: 'WILL', pos: 'LB', x: 24.17, y: 4.5, zone: 'curl-flat-L' },
    ...BASE_DB('deep-third-L', 'deep-third-R', 'deep-third-M', 'hook-R'),
  ]);
  // 3-4 (1d): nose head-up on the center, ends head-up on the tackles, outside backers on the
  // line. The sheet gives the 3-4's alignment but no 3-4 coverage table; the engine plays it as
  // Cover 3 with the strong outside backer rushing (the sheet: "OLBs are usually the edge
  // rushers"). Rank 1 only names these players; no lesson says what this defense is playing.
  D('c3-34', '3-4, Cover 3', 'cov:3', 'base', [
    { id: 'NT', pos: 'NT', x: 26.67, y: 1, rush: 'A-gap-R' },
    { id: 'DE-R', pos: 'DE', x: 29.67, y: 1, rush: 'B-gap-R' },
    { id: 'DE-L', pos: 'DE', x: 23.67, y: 1, rush: 'B-gap-L' },
    { id: 'OLB-R', pos: 'LB', x: 32.17, y: 1, rush: 'D-gap-R' },
    { id: 'OLB-L', pos: 'LB', x: 21.67, y: 1, zone: 'curl-flat-L' },
    { id: 'MIKE', pos: 'LB', x: 28.17, y: 4.5, zone: 'hook-R' },
    { id: 'WILL', pos: 'LB', x: 25.17, y: 4.5, zone: 'hook-L' },
    ...BASE_DB('deep-third-L', 'deep-third-R', 'deep-third-M', 'curl-flat-R'),
  ]);
  // Nickel 4-2-5 (1e) in Cover 3 (5a): vs shotgun 2x2.
  D('c3-nickel', 'Nickel, Cover 3', 'cov:3', 'nickel', [
    ...OVER_DL,
    { id: 'MIKE', pos: 'LB', x: 27.17, y: 4.5, zone: 'hook-L' },
    { id: 'WILL', pos: 'LB', x: 20, y: 4.5, zone: 'curl-flat-L' },  // apex left
    { id: 'NB', pos: 'NB', x: 37.33, y: 5, zone: 'curl-flat-R' },   // inside the right slot
    ...BASE_DB('deep-third-L', 'deep-third-R', 'deep-third-M', 'hook-R'),
  ]);
  // Nickel 4-2-5 in Cover 2 (5a): NB hook-curl R, Mike middle hook, Will hook-curl L.
  D('c2-nickel', 'Nickel, Cover 2', 'cov:2', 'nickel', [
    ...OVER_DL,
    { id: 'MIKE', pos: 'LB', x: 27.17, y: 4.5, zone: 'hook-M' },
    { id: 'WILL', pos: 'LB', x: 20, y: 4.5, zone: 'hook-curl-L' },
    { id: 'NB', pos: 'NB', x: 37.33, y: 5, zone: 'hook-curl-R' },
    ...BASE_DB('flat-L', 'flat-R', 'deep-half-L', 'deep-half-R'),
  ]);

  /* ── routes (fact sheet 3) ── Points from the alignment: [0, dy] or ["in"|"out", lateral, dy].
     `ext` = the last leg keeps going (the receiver runs on until the play ends or he is down). */
  L.ROUTES.hitch = { pts: [[0, 6], ['in', 0.5, 5]] };
  L.ROUTES.flat = { pts: [['out', 2, 2], ['out', 10, 3]], ext: true };
  L.ROUTES.slant = { pts: [[0, 3], ['in', 5, 8]], ext: true };
  L.ROUTES.comeback = { pts: [[0, 15], ['out', 3, 12]] };
  L.ROUTES.curl = { pts: [[0, 12], ['in', 1.5, 10.5]] };
  L.ROUTES.out = { pts: [[0, 10], ['out', 8, 10]], ext: true };
  L.ROUTES.dig = { pts: [[0, 12], ['in', 12, 12]], ext: true };   // 12-yard stem, flat across
  L.ROUTES.corner = { pts: [[0, 12], ['out', 8, 20]], ext: true };
  L.ROUTES.post = { pts: [[0, 12], ['in', 8, 20]], ext: true };
  L.ROUTES.go = { pts: [[0, 25]], ext: true };
  L.ROUTES.seam = { pts: [[0, 25]], ext: true };
  L.ROUTES.drag = { pts: [['in', 2, 2], ['in', 15, 4]], ext: true };

  /* ── BEATS (fact sheet 6) ── concept -> coverages it is drawn up to beat. Only the rows the
     current plays use; phase 3b fills the rest of the table from section 6. */
  L.BEATS['concept:smash'] = ['cov:2'];

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
    SAM: 'Sam linebacker', MIKE: 'Mike linebacker', WILL: 'Will linebacker', 'OLB-L': 'Outside linebacker', 'OLB-R': 'Outside linebacker', NB: 'Nickel back',
    'CB-L': 'Cornerback', 'CB-R': 'Cornerback', FS: 'Free safety', SS: 'Strong safety',
  });
  // The name of a ROLE (CS.roleOf), for questions and answers.
  L.ROLE_NAMES = {
    LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle',
    QB: 'Quarterback', RB: 'Running back', FB: 'Fullback', TE: 'Tight end', X: 'X receiver', Z: 'Z receiver', H: 'Slot receiver', WR: 'Wide receiver',
    DE: 'Defensive end', DT: 'Defensive tackle', NT: 'Nose tackle', SAM: 'Sam linebacker', MIKE: 'Mike linebacker', WILL: 'Will linebacker', LB: 'Linebacker',
    CB: 'Cornerback', FS: 'Free safety', SS: 'Strong safety', NB: 'Nickel back', S: 'Safety',
  };

  /* ── plays ── */
  // Smash vs Cover 2 (fact sheet 6): #1 hitch, #2 corner, on both sides. The flat corner can sink
  // under the corner route or squat on the hitch, not both.
  L.PLAYS['smash-vs-c2'] = {
    id: 'smash-vs-c2', name: 'Smash vs Cover 2', formation: 'gun-2x2', defense: 'c2-43-over',
    teams: { off: 'KC', def: 'BUF' }, home: 'off', spot: 35, dist: 10,
    assign: {
      X: { route: 'hitch' }, H: { route: 'corner' }, Z: { route: 'hitch' }, Y: { route: 'corner' },
      RB: { block: 'B-gap-L' }, QB: { drop: 3 },
      LT: { pass: 'slide-L' }, LG: { pass: 'slide-L' }, C: { pass: 'slide-L' }, RG: { pass: 'slide-L' }, RT: { pass: 'slide-L' },
    },
    ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'H' }, { t: 3.3, ev: 'catch' }],
    tags: ['concept:smash', 'cov:2'], beats: 'cov:2',
    callouts: [
      { t: -1.1, focus: 'FS', text: 'Two safeties deep, each one guarding half the field. That is Cover 2.' },
      { t: 1.2, focus: 'CB-L', text: "The corner owns the flat. He can sink under the corner route or squat on the hitch. He can't do both." },
      { t: 3.0, focus: 'H', text: 'He squats, so the ball goes over him: behind the corner, in front of the safety.' },
    ],
  };
})(typeof window !== 'undefined' ? window : globalThis);
