/* Coach School library: formations, defenses, zone landmarks, routes, plays, the BEATS truth
   table, team names and colours, player labels. Data only; loads after cs-core.js (Node vm too).

   PROVISIONAL (phase 1 seed): alignments, landmarks and BEATS here are standard NFL values
   written to drive the engine. docs/coachschool-facts.md is the single source of football truth;
   phase 3b rebuilds this library from it, and content may only use facts from that sheet.
   Coordinates: see cs-core.js (x across 0..53.33, 0 = the offense's left sideline; y from the
   line of scrimmage, + = offense's downfield). */
(function (root) {
  'use strict';
  const CS = root.CS;
  const L = CS.lib;
  const B = CS.BALL_X, W = CS.FIELD_W;

  /* ── formations ── The line: C at the ball, guards and tackles 1.35 yd apart, all a little
     behind the ball but on the line (y >= -1). Off-the-line receivers at -1.6. */
  const LINE = [
    { id: 'LT', pos: 'T', dx: -2.7, y: -0.95, on: true },
    { id: 'LG', pos: 'G', dx: -1.35, y: -0.85, on: true },
    { id: 'C', pos: 'C', dx: 0, y: -0.6, on: true },
    { id: 'RG', pos: 'G', dx: 1.35, y: -0.85, on: true },
    { id: 'RT', pos: 'T', dx: 2.7, y: -0.95, on: true },
  ];
  L.FORMATIONS['gun-2x2'] = {
    id: 'gun-2x2', name: 'Shotgun 2x2', personnel: '11', strength: 'R',
    players: [
      ...LINE,
      { id: 'Y', pos: 'TE', dx: 4.05, y: -0.95, on: true },        // attached to the right tackle
      { id: 'X', pos: 'WR', x: 8, y: -0.95, on: true },             // split end, on the line
      { id: 'H', pos: 'WR', x: 17, y: -1.6, on: false },            // slot, off the line
      { id: 'Z', pos: 'WR', x: 44, y: -1.6, on: false },            // flanker, off the line
      { id: 'QB', pos: 'QB', dx: 0, y: -5 },
      { id: 'RB', pos: 'RB', dx: -1.6, y: -5.1 },
    ],
  };
  L.FORMATIONS['i-form'] = {
    id: 'i-form', name: 'I-formation', personnel: '21', strength: 'R',
    players: [
      ...LINE,
      { id: 'Y', pos: 'TE', dx: 4.05, y: -0.95, on: true },
      { id: 'X', pos: 'WR', x: 8, y: -0.95, on: true },
      { id: 'Z', pos: 'WR', x: 44, y: -1.6, on: false },
      { id: 'QB', pos: 'QB', dx: 0, y: -1.45 },                     // under center (0.85 yd behind the center's feet)
      { id: 'FB', pos: 'FB', dx: 0, y: -4.3 },
      { id: 'RB', pos: 'RB', dx: 0, y: -7 },
    ],
  };

  /* ── zone landmarks ── Written for the left side; the right side is the mirror. `deep` marks
     the zones that count toward a coverage's deep defenders. */
  const Z = {
    'flat-L': { x: 5, y: 5 },
    'curl-flat-L': { x: 9, y: 9 },
    'curl-L': { x: 13, y: 12 },
    'hook-L': { x: 20, y: 9 },
    'deep-half-L': { x: 16, y: 20, deep: true },
    'deep-third-L': { x: 8, y: 18, deep: true },
    'deep-quarter-L': { x: 7, y: 17, deep: true },
    'deep-quarter-LM': { x: 20, y: 18, deep: true },
  };
  for (const [k, v] of Object.entries(Z)) {
    L.ZONES[k] = v;
    L.ZONES[k.replace(/-L(M?)$/, '-R$1')] = { ...v, x: W - v.x };
  }
  L.ZONES['hook-M'] = { x: B, y: 10 };
  L.ZONES['deep-third-M'] = { x: B, y: 20, deep: true };
  L.ZONES['deep-middle'] = { x: B, y: 18, deep: true };

  /* ── defenses ── Defender ids name the offense's left/right (CB-L covers the offense's left). */
  const FOUR_DOWN = [
    { id: 'DE-L', pos: 'DE', dx: -3.9, y: 1.05, rush: 'C-gap-L' },
    { id: 'DT-L', pos: 'DT', dx: -0.9, y: 1.05, rush: 'A-gap-L' },  // 1-technique, weak side
    { id: 'DT-R', pos: 'DT', dx: 2.0, y: 1.05, rush: 'B-gap-R' },   // 3-technique, strong side
    { id: 'DE-R', pos: 'DE', dx: 5.0, y: 1.05, rush: 'D-gap-R' },   // outside the tight end
  ];
  L.DEFENSES['c2-43-over'] = {
    id: 'c2-43-over', name: '4-3 Over, Cover 2', coverage: 'cov:2', personnel: 'base',
    players: [
      ...FOUR_DOWN,
      { id: 'SAM', pos: 'LB', dx: 5.5, y: 4.5, zone: 'hook-R' },
      { id: 'MIKE', pos: 'LB', dx: 0.3, y: 5, zone: 'hook-M' },
      { id: 'WILL', pos: 'LB', dx: -3.6, y: 4.5, zone: 'hook-L' },
      { id: 'CB-L', pos: 'CB', x: 7, y: 5, zone: 'flat-L' },        // hard corners: they own the flats
      { id: 'CB-R', pos: 'CB', x: 45, y: 5, zone: 'flat-R' },
      { id: 'FS', pos: 'S', x: 17.5, y: 12, zone: 'deep-half-L' },
      { id: 'SS', pos: 'S', x: 35.8, y: 12, zone: 'deep-half-R' },
    ],
  };
  L.DEFENSES['c3-nickel'] = {
    id: 'c3-nickel', name: 'Nickel, Cover 3', coverage: 'cov:3', personnel: 'nickel',
    players: [
      ...FOUR_DOWN,
      { id: 'MIKE', pos: 'LB', dx: 1.5, y: 5, zone: 'hook-R' },
      { id: 'WILL', pos: 'LB', dx: -2.5, y: 5, zone: 'hook-L' },
      { id: 'NB', pos: 'NB', x: 17.5, y: 5, zone: 'curl-flat-L' },  // nickel back over the slot
      { id: 'CB-L', pos: 'CB', x: 7.5, y: 7, zone: 'deep-third-L' },
      { id: 'CB-R', pos: 'CB', x: 44.5, y: 7, zone: 'deep-third-R' },
      { id: 'FS', pos: 'S', x: B, y: 13, zone: 'deep-third-M' },
      { id: 'SS', pos: 'S', x: 36, y: 8, zone: 'curl-flat-R' },     // rolled down to the strong side
    ],
  };

  /* ── routes ── Points from the alignment: [0, dy] or ["in"|"out", lateral, dy]. `ext` = the
     last leg keeps going (the receiver runs on until the play ends or he is down). */
  L.ROUTES.hitch = { pts: [[0, 6], ['in', 0.5, 5]] };
  L.ROUTES.slant = { pts: [[0, 3], ['in', 5, 8]], ext: true };
  L.ROUTES.out = { pts: [[0, 10], ['out', 6, 10]], ext: true };
  L.ROUTES.corner = { pts: [[0, 10], ['out', 7, 17]], ext: true };
  L.ROUTES.post = { pts: [[0, 10], ['in', 6, 18]], ext: true };
  L.ROUTES.go = { pts: [[0, 30]], ext: true };
  L.ROUTES.dig = { pts: [[0, 12], ['in', 12, 12]], ext: true };   // 12-yard stem, flat across
  L.ROUTES.flat = { pts: [['out', 2, 1], ['out', 8, 3]], ext: true };
  L.ROUTES.curl = { pts: [[0, 12], ['in', 1, 10.5]] };

  /* ── BEATS ── concept -> coverages it is drawn up to beat. STARTER ROW ONLY: the fact sheet
     (docs/coachschool-facts.md, phase 0) supplies the full table; phase 3b fills it from there. */
  L.BEATS['concept:smash'] = ['cov:2'];

  /* ── teams ── abbr -> name for the end zones and primary/alt colours (the kit code in
     cs-field.js reads its real home/road uniforms from its own copied RA_KITS table). */
  const T = (name, color, alt) => ({ name, color, alt });
  Object.assign(L.TEAMS, {
    ARI: T('Cardinals', '#97233F', '#FFB612'), ATL: T('Falcons', '#A71930', '#101820'), BAL: T('Ravens', '#241773', '#9E7C0C'),
    BUF: T('Bills', '#00338D', '#C60C30'), CAR: T('Panthers', '#0085CA', '#101820'), CHI: T('Bears', '#0B162A', '#C83803'),
    CIN: T('Bengals', '#FB4F14', '#101820'), CLE: T('Browns', '#311D00', '#FF3C00'), DAL: T('Cowboys', '#002244', '#869397'),
    DEN: T('Broncos', '#FB4F14', '#002244'), DET: T('Lions', '#0076B6', '#B0B7BC'), GB: T('Packers', '#203731', '#FFB612'),
    HOU: T('Texans', '#03202F', '#A71930'), IND: T('Colts', '#002C5F', '#A2AAAD'), JAX: T('Jaguars', '#006778', '#D7A22A'),
    KC: T('Chiefs', '#E31837', '#FFB81C'), LV: T('Raiders', '#000000', '#A5ACAF'), LAC: T('Chargers', '#0080C6', '#FFC20E'),
    LAR: T('Rams', '#003594', '#FFD100'), MIA: T('Dolphins', '#008E97', '#FC4C02'), MIN: T('Vikings', '#4F2683', '#FFC62F'),
    NE: T('Patriots', '#002244', '#C60C30'), NO: T('Saints', '#D3BC8D', '#101820'), NYG: T('Giants', '#0B2265', '#A71930'),
    NYJ: T('Jets', '#125740', '#FFFFFF'), PHI: T('Eagles', '#004C54', '#A5ACAF'), PIT: T('Steelers', '#FFB612', '#101820'),
    SF: T('49ers', '#AA0000', '#B3995D'), SEA: T('Seahawks', '#002244', '#69BE28'), TB: T('Buccaneers', '#D50A0A', '#34302B'),
    TEN: T('Titans', '#4495D2', '#0C2340'), WSH: T('Commanders', '#5A1414', '#FFB612'),
  });
  for (const [k, v] of Object.entries(L.TEAMS)) v.abbr = k;

  /* ── what a tap reads out ── by player id; anything missing falls back to the position. */
  Object.assign(L.LABELS, {
    QB: 'Quarterback', RB: 'Running back', FB: 'Fullback', X: 'X receiver (split end)', Z: 'Z receiver (flanker)',
    H: 'Slot receiver', Y: 'Tight end', LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle',
    'DE-L': 'Defensive end', 'DE-R': 'Defensive end', 'DT-L': 'Defensive tackle', 'DT-R': 'Defensive tackle',
    SAM: 'Sam linebacker', MIKE: 'Mike linebacker', WILL: 'Will linebacker', NB: 'Nickel back',
    'CB-L': 'Cornerback', 'CB-R': 'Cornerback', FS: 'Free safety', SS: 'Strong safety',
  });

  /* ── plays ── */
  // Smash vs Cover 2: hitch outside, corner from the slot, on both sides. The hard corner can
  // sink under the corner route or squat on the hitch, not both; the half-field safety is too
  // deep and too far inside to beat the throw to the sideline.
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
