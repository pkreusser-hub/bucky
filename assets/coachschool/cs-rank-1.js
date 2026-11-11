/* Coach School, rank 1: INTERN, the field and the 22. Data only (lessons, plays, puzzles, Game
   Day). Loads after cs-core.js and cs-lib.js; Node vm loadable for the suite.

   Every football statement here comes from docs/coachschool-facts.md, Part A "Rank 1" unless a
   line says otherwise. Where the sheet marks a Coach School convention (letters, Sam/Mike/Will,
   strength, line splits) the copy says "in Coach School" or "on many teams". Reading level: a
   13-15-year-old who knows the NFL from fantasy; 3-4 sentences per chalk-talk card, real coaching
   words, each one explained the first time it appears.

   unit = { id, title, blurb, play, cards:[{title, teaches, say:[{focus, text}], text, play?}],
            walk:[{prompt, look, find, answer}], puzzles:[...] }
   puzzles are tap (cs-pz-tap.js) or choice (cs-pz-choice.js). The first two of every set use the
   unit's own play (the taught example); the rest are variants on other plays. */
(function (root) {
  'use strict';
  const CS = root.CS, L = CS.lib;

  /* ── plays ── A plain quick pass so every diagram moves after an answer: the QB drops, the
     receivers run simple routes, the line sets to pass-block, one throw. Rank 1 is about names
     and places, so no play is described as beating anything and the zone chalk is off. */
  const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
  const ROUTE = { X: 'hitch', Z: 'go', H: 'slant', U: 'flat' };
  function P(id, o) {
    const f = L.FORMATIONS[o.formation];
    const assign = { QB: { drop: 3 } };
    for (const id2 of OL) assign[id2] = { pass: 'set' };
    for (const p of f.players) {
      if (ROUTE[p.id]) assign[p.id] = { route: ROUTE[p.id] };
      if (p.id === 'Y') assign.Y = { route: p.y >= CS.ON_LINE_Y ? 'out' : 'seam' };
      if (p.id === 'RB') assign.RB = { block: 'B-gap-L' };
      if (p.id === 'FB') assign.FB = { block: 'A-gap-R' };
    }
    const to = o.to || 'X', thr = CS.num(o.throwT, 1.3), cat = CS.num(o.catchT, 2.0);
    L.PLAYS[id] = {
      id, home: 'off', spot: 30, dist: 10, zones: false, ...o,
      assign: { ...assign, ...(o.assign || {}) },
      ball: [{ t: 0, ev: 'snap' }, { t: thr, ev: 'throw', to }, { t: cat, ev: 'catch' }],
      tags: o.tags || [],
    };
    delete L.PLAYS[id].to; delete L.PLAYS[id].throwT; delete L.PLAYS[id].catchT;
  }

  // Lesson plays (one per unit, with callouts).
  P('r1-field', { name: 'Red zone, left hash', formation: 'gun-2x2', defense: 'c3-nickel', teams: { off: 'KC', def: 'LV' }, hash: 'L', spot: 82, dist: 10, to: 'Z', throwT: 1.2, catchT: 2.0,
    callouts: [
      { t: -1.0, focus: ['ball', 'hash:L'], text: 'The ball is on the left hash. Left is the top of the screen.' },
      { t: -0.5, focus: 'Z', text: 'More grass on his side: Z is on the field side.' },
      { t: 1.6, focus: 'redzone', text: 'Opponent\'s 18-yard line: inside the 20, so this is the red zone.' },
    ] });
  P('r1-los', { name: 'Seven on the line', formation: 'i-form', defense: 'c3-43-over', teams: { off: 'PHI', def: 'WSH' }, home: 'def', spot: 40, to: 'Y', assign: { Y: { route: 'curl' }, Z: { route: 'post' } }, throwT: 1.5, catchT: 2.2,
    callouts: [
      { t: -1.0, focus: 'los', text: 'The blue line runs through the ball. That is the line of scrimmage.' },
      { t: -0.5, focus: 'Y', text: 'Seven men stand on the line. Y is the last one on the right, so he is eligible.' },
      { t: 0.6, focus: 'RT', text: 'The right tackle is on the line but not at the end of it. He can\'t catch a pass.' },
    ] });
  P('r1-ol', { name: 'Five up front', formation: 'singleback', defense: 'c3-43-over', teams: { off: 'DET', def: 'GB' }, spot: 25, to: 'Y', throwT: 1.4, catchT: 2.1,
    callouts: [
      { t: -1.0, focus: 'C', text: 'The center snaps the ball. Count the line out from him.' },
      { t: -0.5, focus: 'LT', text: 'The left tackle guards the quarterback\'s blind side.' },
      { t: 0.5, focus: 'RG', text: 'Right guard: next to the center, on the right.' },
    ] });
  P('r1-backs', { name: 'The I', formation: 'i-form', defense: 'c3-43-over', teams: { off: 'NYG', def: 'WSH' }, spot: 45, to: 'Y', assign: { FB: { block: 'B-gap-R' } }, throwT: 1.5, catchT: 2.2,
    callouts: [
      { t: -1.0, focus: 'QB', text: 'Under center: his hands are right under the center.' },
      { t: -0.5, focus: 'FB', text: 'The fullback lines up in front of the tailback. His job is to block.' },
      { t: 0.4, focus: 'RB', text: 'The deep back in the I is the tailback.' },
    ] });
  P('r1-wr', { name: 'X, Z and H', formation: 'singleback', defense: 'c3-43-over', teams: { off: 'BUF', def: 'MIA' }, home: 'def', spot: 35, to: 'H', throwT: 1.1, catchT: 1.7,
    callouts: [
      { t: -1.0, focus: 'X', text: 'X stands on the line. He is the split end.' },
      { t: -0.6, focus: 'Z', text: 'Z stands a yard off the line, on the tight end\'s side. He is the flanker.' },
      { t: -0.2, focus: 'H', text: 'H is in the slot, between X and the line.' },
    ] });
  P('r1-def', { name: 'Meet the defense', formation: 'i-form', defense: 'c3-43-over', teams: { off: 'BAL', def: 'PIT' }, home: 'def', spot: 50, to: 'Y', throwT: 1.5, catchT: 2.2,
    callouts: [
      { t: -1.0, focus: 'MIKE', text: 'Mike: the middle linebacker.' },
      { t: -0.6, focus: 'SAM', text: 'Sam lines up on the tight end\'s side, the strong side.' },
      { t: -0.2, focus: 'FS', text: 'The free safety plays deep.' },
    ] });
  P('r1-str', { name: 'Strength left', formation: 'singleback', mirror: true, defense: 'c3-43-over', teams: { off: 'DAL', def: 'WSH' }, spot: 30, to: 'X', throwT: 1.3, catchT: 2.0,
    callouts: [
      { t: -1.0, focus: 'Y', text: 'The tight end is on the left, so the left is the strong side.' },
      { t: -0.6, focus: 'SAM', text: 'So the Sam lines up on the left too.' },
      { t: -0.2, focus: 'SS', text: 'And so does the strong safety.' },
    ] });

  // Variant plays for puzzles: other formations, other teams, the other hash.
  P('r1-v-gun-r', { formation: 'gun-2x2', defense: 'c3-nickel', teams: { off: 'BAL', def: 'CIN' }, home: 'def', hash: 'R', spot: 72 });
  P('r1-v-ace-l', { formation: 'ace', defense: 'c2-43-over', teams: { off: 'NE', def: 'NYJ' }, hash: 'L', spot: 45, to: 'Y' });
  P('r1-v-ace-r', { formation: 'ace', mirror: true, defense: 'c2-43-over', teams: { off: 'LAC', def: 'LV' }, hash: 'R', spot: 38, to: 'Y' });
  P('r1-v-single-r', { formation: 'singleback', defense: 'c2-43-over', teams: { off: 'MIA', def: 'BUF' }, hash: 'R', spot: 28 });
  P('r1-v-trips', { formation: 'gun-trips-rt', defense: 'c3-nickel', teams: { off: 'SF', def: 'SEA' }, spot: 33, to: 'H' });
  P('r1-v-iform-m', { formation: 'i-form', mirror: true, defense: 'c3-43-over', teams: { off: 'CHI', def: 'MIN' }, home: 'def', hash: 'L', spot: 22, to: 'Y' });
  P('r1-v-gun-l', { formation: 'gun-2x2', defense: 'c2-nickel', teams: { off: 'TB', def: 'NO' }, hash: 'L', spot: 41, to: 'H' });
  P('r1-v-trips-2', { formation: 'gun-trips-rt', defense: 'c2-nickel', teams: { off: 'CIN', def: 'CLE' }, hash: 'L', spot: 55, to: 'Z' });
  P('r1-v-pistol', { formation: 'pistol', defense: 'c3-43-over', teams: { off: 'LAR', def: 'ARI' }, spot: 60, to: 'Y' });
  P('r1-v-pistol-m', { formation: 'pistol', mirror: true, defense: 'c3-43-over', teams: { off: 'ATL', def: 'CAR' }, hash: 'R', spot: 34, to: 'X' });
  P('r1-v-34', { formation: 'i-form', defense: 'c3-34', teams: { off: 'CHI', def: 'GB' }, spot: 26, to: 'Y' });
  P('r1-v-c2-single', { formation: 'singleback', defense: 'c2-43-over', teams: { off: 'SEA', def: 'SF' }, hash: 'R', spot: 47, to: 'H' });
  P('r1-v-nickel', { formation: 'gun-2x2', defense: 'c3-nickel', teams: { off: 'MIN', def: 'DET' }, home: 'def', spot: 31, to: 'H' });
  P('r1-v-iform-mm', { formation: 'i-form', mirror: true, defense: 'c3-43-over', teams: { off: 'HOU', def: 'JAX' }, spot: 36, to: 'Y' });
  P('r1-v-trips-kc', { formation: 'gun-trips-rt', defense: 'c3-nickel', teams: { off: 'KC', def: 'DEN' }, hash: 'R', spot: 64, to: 'Y' });
  P('r1-v-iform-ten', { formation: 'i-form', defense: 'c2-43-over', teams: { off: 'TEN', def: 'IND' }, hash: 'L', spot: 29, to: 'X' });
  // Game Day plays.
  P('r1-g-1', { formation: 'singleback', defense: 'c3-43-over', teams: { off: 'GB', def: 'CHI' }, hash: 'L', spot: 84, to: 'Y' });
  P('r1-g-2', { formation: 'gun-trips-rt', mirror: true, defense: 'c3-nickel', teams: { off: 'PHI', def: 'WSH' }, spot: 52, to: 'H' });
  P('r1-g-3', { formation: 'i-form', defense: 'c3-34', teams: { off: 'PIT', def: 'BAL' }, hash: 'R', spot: 33, to: 'Y' });
  P('r1-g-4', { formation: 'pistol', defense: 'c2-43-over', teams: { off: 'JAX', def: 'TEN' }, hash: 'L', spot: 61, to: 'H' });
  P('r1-g-5', { formation: 'gun-2x2', mirror: true, defense: 'c2-nickel', teams: { off: 'DEN', def: 'LAC' }, spot: 43, to: 'H' });

  /* ── helpers for writing lessons ── A chalk-talk card is a short run of coach bubbles, each
     pointing at its own thing on the field (CS.focusOf tokens: a player id, a group, or a field
     feature). The card's sentences are the bubbles' sentences, 3-4 in all; `text` is them joined. */
  const card = (title, teaches, ...say) => {
    const s = say.map(([focus, text]) => ({ focus: CS.toArr(focus), text }));
    return { title, teaches, say: s, text: s.map((b) => b.text).join(' ') };
  };

  /* ── helpers for writing puzzles ── */
  const tap = (id, play, prompt, find, answer, tags, why, extra) => ({ id, type: 'tap', play, prompt, find, answer, tags, why, ...(extra || {}) });
  const choice = (id, play, prompt, q, options, answer, tags, why, extra) => ({ id, type: 'choice', play, prompt, q, options: options.map(([t, v]) => ({ t, v })), answer, tags, why, ...(extra || {}) });
  const SIDE_OPTS = [['Left (top of the screen)', 'L'], ['Right (bottom of the screen)', 'R']];
  const YN = [['Yes', 'yes'], ['No', 'no']];

  const units = [
    /* ── 1. field geography ── */
    {
      id: 'r1-u1', title: 'The field', blurb: 'Hashes, numbers, field and boundary, the red zone.', play: 'r1-field',
      cards: [
        card('The field', ['field:size'],
          ['goal', 'A football field is 100 yards from goal line to goal line, with a 10-yard end zone at each end, so 120 yards in all.'],
          [['sideline:L', 'sideline:R'], 'It is 53 1/3 yards wide.'],
          ['numbers:R', 'Lines cross it every 5 yards and the numbers mark every 10.'],
          ['los', 'On our field the offense always attacks to the right.']),
        card('Hash marks', ['field:hash'],
          ['hashes', 'The two rows of short lines down the middle are the hash marks.'],
          ['hashes', 'In the NFL they sit 70 feet 9 inches in from each sideline, just 18 feet 6 inches apart.'],
          ['ball', 'Every play starts with the ball on a hash or between them.']),
        card('Field and boundary', ['field:sides'],
          ['field', 'When the ball sits on a hash, one side of it has more grass.'],
          [['field', 'boundary'], 'The wide side is called the field and the short side is the boundary.'],
          ['Z', 'Defenses often set their call by field and boundary, and a throw to the field side is a longer throw.']),
        card('Numbers and the red zone', ['field:numbers', 'field:redzone'],
          ['numbers:L', 'The big yard numbers are painted 12 to 14 yards in from each sideline, so a player lined up "on the numbers" is about 13 yards from the sideline.'],
          ['redzone', 'The red zone is the area from the opponent\'s 20-yard line to the goal line. It is a coaching and TV word, not a rule.']),
      ],
      walk: [
        { prompt: 'The ball sits on the left hash. Tap the player who snaps it.', look: ['hash:L'], find: { role: 'C' }, answer: 'C' },
        { prompt: 'Tap the receiver on the field side, the one with more grass: Z.', look: ['field'], find: { role: 'Z' }, answer: 'Z' },
      ],
      puzzles: [
        choice('r1-u1-p1', 'r1-field', 'The ball is on the left hash. Which side is the field side?', 'fieldSide', SIDE_OPTS, 1, ['field:sides'], 'The wide side of the hash is the field. With the ball on the left hash, that is the right.'),
        choice('r1-u1-p2', 'r1-field', 'The ball is on the opponent\'s 18. Is it in the red zone?', 'redZone', YN, 0, ['field:redzone'], 'The red zone runs from the opponent\'s 20 to the goal line, and the 18 is inside it.'),
        choice('r1-u1-p3', 'r1-v-gun-r', 'Now the ball is on the right hash. Which side is the field side?', 'fieldSide', SIDE_OPTS, 0, ['field:sides', 'field:hash'], 'Ball on the right hash, so the wide side, the field, is the left.'),
        choice('r1-u1-p4', 'r1-v-gun-r', 'The ball is on the opponent\'s 28. Is it in the red zone?', 'redZone', YN, 1, ['field:redzone'], 'Not yet. The red zone starts at the opponent\'s 20.'),
        choice('r1-u1-p5', 'r1-v-gun-r', 'How wide is an NFL field?', 'fact', [['50 yards', '50'], ['53 1/3 yards', '53.33'], ['60 yards', '60'], ['100 yards', '100']], 1, ['field:size'], 'An NFL field is 53 1/3 yards (160 feet) wide.', { truth: '53.33', src: 'facts A, rank 1, The field' }),
        choice('r1-u1-p6', 'r1-v-single-r', 'How deep is each end zone?', 'fact', [['5 yards', 5], ['10 yards', 10], ['15 yards', 15], ['20 yards', 20]], 1, ['field:size'], 'Each end zone is 10 yards deep, so the field is 120 yards end line to end line.', { truth: 10, src: 'facts A, rank 1, The field' }),
        choice('r1-u1-p7', 'r1-v-single-r', 'A receiver lined up "on the numbers" is about how far from the sideline?', 'fact', [['5 yards', 5], ['9 yards', 9], ['13 yards', 13], ['20 yards', 20]], 2, ['field:numbers'], 'The numbers are painted 12 to 14 yards in, so on the numbers is about 13 yards from the sideline.', { truth: 13, src: 'facts A, rank 1, The field (yard-line numbers)' }),
        choice('r1-u1-p8', 'r1-v-ace-l', 'How far apart are the two rows of NFL hash marks?', 'fact', [['18 feet 6 inches', 'hash-gap'], ['40 feet', '40ft'], ['53 feet', '53ft'], ['70 feet 9 inches', 'hash-in']], 0, ['field:hash'], 'They are 18 feet 6 inches apart. The 70 feet 9 inches is how far each row is from its sideline.', { truth: 'hash-gap', src: 'facts A, rank 1, The field (hash marks)' }),
      ],
    },
    /* ── 2. the line of scrimmage, seven on the line, eligible receivers ── */
    {
      id: 'r1-u2', title: 'The line', blurb: 'The line of scrimmage, seven on the line, who may catch a pass.', play: 'r1-los',
      cards: [
        card('The line of scrimmage', ['los:los'],
          ['ball', 'The line of scrimmage, or LOS, is an imaginary line through the nose of the ball, one for each team.'],
          ['los', 'The space between the two lines, the length of the ball, is the neutral zone.'],
          ['C', 'Nobody but the snapper may be in the neutral zone when the ball is snapped.'],
          ['los', 'On our field the offense\'s LOS is the blue line.']),
        card('Seven on the line', ['los:seven'],
          ['line', 'The offense must have at least 7 players on the line of scrimmage at the snap, and no more than 4 in the backfield, the area behind the line.'],
          ['backs', 'In Coach School every formation has exactly 7 on the line and 4 off it.'],
          ['line', 'To check, count the players standing level with the ball.']),
        card('Eligible receivers', ['los:eligible'],
          [['X', 'Y'], 'Only eligible receivers may catch a forward pass. They are the two players at the ends of the line, plus every player in the backfield.'],
          ['ol', 'The linemen in between wear numbers 50 to 79 and are ineligible unless they report to the referee.'],
          ['line', 'A receiver on the line with another man outside him is covered up, and that makes him ineligible too.']),
      ],
      walk: [
        { prompt: 'Tap the eligible receiver at the right end of the line.', look: ['line'], find: { lineEnd: 'R' }, answer: 'Y' },
        { prompt: 'Tap the eligible receiver at the left end of the line.', look: ['line'], find: { lineEnd: 'L' }, answer: 'X' },
      ],
      puzzles: [
        tap('r1-u2-p1', 'r1-los', 'Tap the player at the right end of the line.', { lineEnd: 'R' }, 'Y', ['los:eligible'], 'Y, the tight end, is the last man on the line on the right, so he is eligible.'),
        choice('r1-u2-p2', 'r1-los', 'How many offensive players are on the line of scrimmage?', 'onLineCount', [['5', 5], ['6', 6], ['7', 7], ['8', 8]], 2, ['los:seven'], 'Seven on the line: five linemen, X and Y.'),
        tap('r1-u2-p3', 'r1-v-single-r', 'Tap the player at the left end of the line.', { lineEnd: 'L' }, 'X', ['los:eligible'], 'X stands on the line at the far left end, so he is eligible.'),
        choice('r1-u2-p4', 'r1-v-single-r', 'Is the ringed player, standing a yard off the line, an eligible receiver?', 'eligible', YN, 0, ['los:eligible'], 'Yes. He is in the backfield, behind the line, and every backfield player is eligible.', { of: 'H', focus: ['H'] }),
        choice('r1-u2-p5', 'r1-v-ace-l', 'Is the ringed lineman an eligible receiver?', 'eligible', YN, 1, ['los:eligible'], 'No. He is on the line but not at an end of it, so he is ineligible.', { of: 'RT', focus: ['RT'] }),
        tap('r1-u2-p6', 'r1-v-trips', 'Tap the player at the right end of the line.', { lineEnd: 'R' }, 'Z', ['los:eligible'], 'Z is the outside man on the line on the right. The slot players are off the line.'),
        choice('r1-u2-p7', 'r1-v-trips', 'At most, how many offensive players may line up in the backfield?', 'fact', [['3', 3], ['4', 4], ['5', 5], ['6', 6]], 1, ['los:seven'], 'At least 7 on the line means no more than 4 in the backfield.', { truth: 4, src: 'facts A, rank 1, Seven on the line' }),
        choice('r1-u2-p8', 'r1-v-iform-m', 'Who may be in the neutral zone when the ball is snapped?', 'fact', [['Only the snapper', 'snapper'], ['The quarterback', 'qb'], ['Any lineman', 'ol'], ['Nobody at all', 'none']], 0, ['los:los'], 'Only the snapper. Everyone else must be behind his own line.', { truth: 'snapper', src: 'facts A, rank 1, Line of scrimmage' }),
      ],
    },
    /* ── 3. the offensive line ── */
    {
      id: 'r1-u3', title: 'The offensive line', blurb: 'Left tackle, left guard, center, right guard, right tackle.', play: 'r1-ol',
      cards: [
        card('Five up front', ['ol:names'],
          ['ol', 'The offensive line, or OL, is the five big men in the middle.'],
          ['ol', 'From the offense\'s left to its right, top to bottom on our field, they are the left tackle, left guard, center, right guard and right tackle: LT, LG, C, RG, RT.'],
          [['LT', 'RT'], 'The guards stand next to the center, and the tackles are the bookends on the outside.'],
          ['ol', 'Nearly every play is a rule for these five.']),
        card('The center', ['ol:center'],
          ['C', 'The center snaps the ball to the quarterback. He stands right on the ball, so he is the easiest lineman to find.'],
          ['ol', 'In Coach School each lineman stands 1.5 yards from the next, measured from the center out.']),
        card('Left and right', ['ol:names'],
          ['QB', 'In Coach School, left and right always mean the offense\'s left and right, as if you were the quarterback looking downfield.'],
          ['sideline:L', 'Our offense attacks to the right, so its left is the top of the screen.'],
          ['LT', 'The left tackle is always the top man of the five.']),
        card('The blind side', ['ol:blind'],
          ['QB', 'A right-handed quarterback throws with his back to the left side of the field.'],
          ['LT', 'That side is his blind side, and the left tackle protects it. That is why the left tackle is traditionally the premium pass protector.']),
      ],
      walk: [
        { prompt: 'Tap the center.', look: ['ol'], find: { role: 'C' }, answer: 'C' },
        { prompt: 'Tap the left tackle.', look: ['ol'], find: { role: 'LT' }, answer: 'LT' },
        { prompt: 'Tap the right guard.', look: ['ol'], find: { role: 'RG' }, answer: 'RG' },
      ],
      puzzles: [
        tap('r1-u3-p1', 'r1-ol', 'Tap the center.', { role: 'C' }, 'C', ['ol:center'], 'The center is the lineman on the ball.'),
        tap('r1-u3-p2', 'r1-ol', 'Tap the left tackle.', { role: 'LT' }, 'LT', ['ol:names'], 'The left tackle is the top man of the five: the offense\'s left.'),
        tap('r1-u3-p3', 'r1-v-gun-r', 'Tap the right guard.', { role: 'RG' }, 'RG', ['ol:names'], 'The right guard is next to the center, on the offense\'s right (below him on the screen).'),
        tap('r1-u3-p4', 'r1-v-iform-m', 'The tight end is on the left this time. Tap the right tackle.', { role: 'RT' }, 'RT', ['ol:names'], 'The tackles are named by side, not by where the tight end is. The right tackle is still the bottom man of the five.'),
        choice('r1-u3-p5', 'r1-v-trips', 'Who is the ringed lineman?', 'role', [['Left guard', 'LG'], ['Center', 'C'], ['Left tackle', 'LT'], ['Right guard', 'RG']], 0, ['ol:names'], 'He is next to the center on the left: the left guard.', { of: 'LG', focus: ['LG'] }),
        tap('r1-u3-p6', 'r1-v-ace-r', 'Tap the left guard.', { role: 'LG' }, 'LG', ['ol:names'], 'The left guard is next to the center, on the offense\'s left (above him on the screen).'),
        choice('r1-u3-p7', 'r1-v-pistol', 'Which lineman protects a right-handed quarterback\'s blind side?', 'fact', [['Left tackle', 'LT'], ['Center', 'C'], ['Right tackle', 'RT'], ['Right guard', 'RG']], 0, ['ol:blind'], 'The left tackle. A right-hander throws with his back to the left.', { truth: 'LT', src: 'facts A, rank 1, Offensive line' }),
        choice('r1-u3-p8', 'r1-v-pistol', 'In Coach School, how far apart do the linemen stand?', 'fact', [['0.5 yards', 0.5], ['1.5 yards', 1.5], ['3 yards', 3], ['5 yards', 5]], 1, ['ol:center'], '1.5 yards, center to center. (That is our teaching default; real splits move with the play.)', { truth: 1.5, src: 'facts B 1a (CS convention)' }),
      ],
    },
    /* ── 4. the backfield and the tight end ── */
    {
      id: 'r1-u4', title: 'Backs and tight ends', blurb: 'Quarterback, tailback, fullback, the tight end.', play: 'r1-backs',
      cards: [
        card('The quarterback', ['bk:qb'],
          ['QB', 'The quarterback, or QB, takes the snap. Under center, he stands right behind the center with his hands under him, about a yard back.'],
          ['QB', 'In the shotgun he stands about 5 yards back, and in the pistol about 4.']),
        card('Tailback and fullback', ['bk:rb'],
          ['RB', 'Running back, halfback and tailback are three names for the same job.'],
          ['RB', 'In an I-formation, where the backs stand in a line behind the quarterback, the deep back is called the tailback.'],
          ['FB', 'The fullback is a blocking back who lines up in front of him.'],
          [['FB', 'RB'], 'Both count as backs when coaches count who is on the field.']),
        card('The tight end', ['bk:te'],
          ['Y', 'The tight end, or TE, blocks and catches. Lined up next to a tackle he is inline (also called attached); split out away from the line he is flexed (detached).'],
          ['Y', 'In Coach School the tight end wears the letter Y.']),
      ],
      walk: [
        { prompt: 'Tap the fullback.', look: ['backs'], find: { role: 'FB' }, answer: 'FB' },
        { prompt: 'Tap the tailback.', look: ['backs'], find: { role: 'RB' }, answer: 'RB' },
        { prompt: 'Tap the tight end.', look: ['ol'], find: { role: 'TE' }, answer: 'Y' },
      ],
      puzzles: [
        tap('r1-u4-p1', 'r1-backs', 'Tap the fullback.', { role: 'FB' }, 'FB', ['bk:rb'], 'The fullback is the back in front, between the quarterback and the tailback.'),
        tap('r1-u4-p2', 'r1-backs', 'Tap the tailback.', { role: 'RB' }, 'RB', ['bk:rb'], 'The tailback is the deep back in the I.'),
        choice('r1-u4-p3', 'r1-v-trips-2', 'How is this quarterback lined up?', 'qbAlign', [['Under center', 'under'], ['Pistol', 'pistol'], ['Shotgun', 'gun']], 2, ['bk:qb'], 'About 5 yards back with the running back beside him: the shotgun.', { focus: ['QB'] }),
        choice('r1-u4-p4', 'r1-v-pistol', 'How is this quarterback lined up?', 'qbAlign', [['Under center', 'under'], ['Pistol', 'pistol'], ['Shotgun', 'gun']], 1, ['bk:qb'], 'About 4 yards back with the running back right behind him: the pistol.', { focus: ['QB'] }),
        tap('r1-u4-p5', 'r1-v-gun-l', 'Tap the tight end.', { role: 'TE' }, 'Y', ['bk:te'], 'Y is the tight end, split out off the line on the right.'),
        choice('r1-u4-p6', 'r1-v-gun-l', 'Is the ringed tight end inline or flexed?', 'teAlign', [['Inline', 'inline'], ['Flexed', 'flexed']], 1, ['bk:te'], 'He is split out, away from the tackle: flexed.', { of: 'Y', focus: ['Y'] }),
        choice('r1-u4-p7', 'r1-v-c2-single', 'Is the ringed tight end inline or flexed?', 'teAlign', [['Inline', 'inline'], ['Flexed', 'flexed']], 0, ['bk:te'], 'He is on the line, right next to the tackle: inline.', { of: 'Y', focus: ['Y'] }),
        choice('r1-u4-p8', 'r1-v-c2-single', 'How is this quarterback lined up?', 'qbAlign', [['Under center', 'under'], ['Pistol', 'pistol'], ['Shotgun', 'gun']], 0, ['bk:qb'], 'Hands under the center, a yard back: under center.', { focus: ['QB'] }),
      ],
    },
    /* ── 5. X, Z and the slot ── */
    {
      id: 'r1-u5', title: 'X, Z and the slot', blurb: 'Split end, flanker, slot: who stands where.', play: 'r1-wr',
      cards: [
        card('Letters for receivers', ['wr:xz'],
          [['X', 'Z', 'H'], 'Receivers get letters so a play call can give each one his job.'],
          ['X', 'X is the split end: he stands on the line, usually on the side away from the tight end.'],
          ['Z', 'Z is the flanker: he stands about a yard off the line, usually on the tight end\'s side. Letters vary by team; Coach School uses X, Z, Y and H.']),
        card('Spotting X and Z', ['wr:xz'],
          [['X', 'Z'], 'Look at their feet. X stands level with the linemen, and Z stands about a yard behind that line.'],
          ['X', 'A man on the line can be jammed (pressed) right at the snap and may not go in motion, which means moving when the ball is snapped.'],
          ['Z', 'A man a yard off gets a cleaner start and may go in motion.']),
        card('The slot', ['wr:slot'],
          ['H', 'A slot receiver lines up between the outside receiver and the line.'],
          ['H', 'Coach School letters him H; some teams use F or A, or just say the slot. He stands off the line, so he is an eligible receiver.']),
      ],
      walk: [
        { prompt: 'Tap X, the split end.', look: ['los'], find: { role: 'X' }, answer: 'X' },
        { prompt: 'Tap Z, the flanker.', look: ['los'], find: { role: 'Z' }, answer: 'Z' },
        { prompt: 'Tap H, the slot.', look: ['ol'], find: { role: 'H' }, answer: 'H' },
      ],
      puzzles: [
        tap('r1-u5-p1', 'r1-wr', 'Tap X, the split end.', { role: 'X' }, 'X', ['wr:xz'], 'X is on the line, away from the tight end.'),
        tap('r1-u5-p2', 'r1-wr', 'Tap Z, the flanker.', { role: 'Z' }, 'Z', ['wr:xz'], 'Z is a yard off the line, on the tight end\'s side.'),
        tap('r1-u5-p3', 'r1-v-gun-l', 'Tap the slot receiver, H.', { role: 'H' }, 'H', ['wr:slot'], 'H is inside X, between him and the line.'),
        tap('r1-u5-p4', 'r1-v-pistol-m', 'The tight end is on the left this time. Tap X.', { role: 'X' }, 'X', ['wr:xz'], 'X goes away from the tight end, so with the tight end on the left, X is on the right.'),
        choice('r1-u5-p5', 'r1-v-iform-ten', 'Is the ringed receiver on the line or off it?', 'onLine', [['On the line', 'on'], ['Off the line', 'off']], 1, ['wr:xz'], 'He stands a yard back: off the line. That is Z, the flanker.', { of: 'Z', focus: ['Z'] }),
        choice('r1-u5-p6', 'r1-v-trips', 'Who is the ringed receiver?', 'role', [['X receiver', 'X'], ['Z receiver', 'Z'], ['Slot receiver', 'H'], ['Tight end', 'TE']], 2, ['wr:slot'], 'He is inside Z and off the line: the slot, H.', { of: 'H', focus: ['H'] }),
        choice('r1-u5-p7', 'r1-v-iform-ten', 'Which of these two receivers may go in motion?', 'fact', [['X, on the line', 'X'], ['Z, a yard off', 'Z']], 1, ['wr:xz'], 'Z. A man on the line may not go in motion; a man a yard off may.', { truth: 'Z', src: 'facts A, rank 1, Wide receivers', focus: ['X', 'Z'] }),
      ],
    },
    /* ── 6. the defense ── */
    {
      id: 'r1-u6', title: 'The defense', blurb: 'Ends and tackles, Sam, Mike and Will, corners and safeties.', play: 'r1-def',
      cards: [
        card('The defensive line', ['def:dl'],
          ['dl', 'The defensive line, or DL, lines up across from the offensive line. The ends (DE) play on the outside and the tackles (DT) play inside.'],
          ['C', 'A tackle lined up head-up on the center, right in front of him, is the nose tackle.'],
          [['DE-L', 'DE-R'], 'Edge is the name for whoever rushes from outside the tackle, an end or an outside linebacker.']),
        card('Sam, Mike and Will', ['def:lb'],
          ['lb', 'Linebackers (LB) stand a few yards behind the defensive line.'],
          [['SAM', 'MIKE', 'WILL'], 'In Coach School the Sam is the strong-side linebacker, on the tight end\'s side; the Mike is the middle linebacker; the Will is the weak-side linebacker.'],
          ['lb', 'Some teams name them by field and boundary instead, or use names like Jack, Buck or Rover.']),
        card('Defensive backs', ['def:db'],
          ['db', 'Defensive backs (DB) are the last line.'],
          [['CB-L', 'CB-R'], 'Cornerbacks cover the wide receivers.'],
          [['FS', 'SS'], 'The free safety usually plays deep in the middle or to the weak side, and the strong safety usually lines up on the tight end\'s side and helps more against the run.'],
          ['db', 'A fifth defensive back is a nickel back, who usually covers a slot, and a sixth is a dime.']),
      ],
      walk: [
        { prompt: 'Tap the Mike linebacker.', look: ['lb'], find: { role: 'MIKE' }, answer: 'MIKE' },
        { prompt: 'Tap the Sam linebacker.', look: ['Y'], find: { role: 'SAM' }, answer: 'SAM' },
        { prompt: 'Tap the free safety.', look: ['lb'], find: { role: 'FS' }, answer: 'FS' },
      ],
      puzzles: [
        tap('r1-u6-p1', 'r1-def', 'Tap the Mike linebacker.', { role: 'MIKE' }, 'MIKE', ['def:lb'], 'The Mike is the middle linebacker.'),
        tap('r1-u6-p2', 'r1-def', 'Tap the Sam linebacker.', { role: 'SAM' }, 'SAM', ['def:lb'], 'The Sam lines up on the tight end\'s side.'),
        tap('r1-u6-p3', 'r1-v-c2-single', 'Tap the Will linebacker.', { role: 'WILL' }, 'WILL', ['def:lb'], 'The Will is the weak-side linebacker, away from the tight end.'),
        tap('r1-u6-p4', 'r1-v-34', 'Tap the nose tackle.', { role: 'NT' }, 'NT', ['def:dl'], 'The nose tackle is head-up on the center.'),
        tap('r1-u6-p5', 'r1-v-nickel', 'Tap the nickel back.', { role: 'NB' }, 'NB', ['def:db'], 'The nickel back is the fifth defensive back. He usually covers a slot.'),
        choice('r1-u6-p6', 'r1-v-nickel', 'How many defensive backs are on the field?', 'count', [['4', 4], ['5', 5], ['6', 6]], 1, ['def:db'], 'Two corners, two safeties and a nickel back: five.', { pos: ['CB', 'S', 'NB'] }),
        choice('r1-u6-p7', 'r1-v-c2-single', 'How many linebackers are on the field?', 'count', [['2', 2], ['3', 3], ['4', 4]], 1, ['def:lb'], 'Sam, Mike and Will: three.', { pos: ['LB'] }),
        tap('r1-u6-p8', 'r1-v-iform-mm', 'The tight end is on the left. Tap the strong safety.', { role: 'SS' }, 'SS', ['def:db'], 'The strong safety lines up on the tight end\'s side, so on the left here.'),
      ],
    },
    /* ── 7. formation strength ── */
    {
      id: 'r1-u7', title: 'Formation strength', blurb: 'Which side is strong, and why the defense cares.', play: 'r1-str',
      cards: [
        card('The strong side', ['str:rule'],
          ['Y', 'Formation strength is the side where the offense has more. In Coach School the strength is the tight end\'s side.'],
          [['X', 'Z', 'H'], 'With no tight end, or one on each side, it is the side with more receivers.'],
          ['hashes', 'If that is still even, it is the field side, the wide side of the hash.']),
        card('Count it', ['str:rule'],
          ['ball', 'To find it, count the eligible players on each side of the ball.'],
          ['lb', 'Teams vary: some defenses always set their strength to the field, or to the side with more receivers.'],
          ['Y', 'Coach School uses the tight end rule first.']),
        card('The defense follows it', ['str:defense'],
          [['SAM', 'SS'], 'The defense names its strong-side players by this call. If the tight end lines up on the left, the Sam and the strong safety line up on the left too.'],
          [['Y', 'SAM'], 'Find the tight end first and you know where the Sam will be.']),
      ],
      walk: [
        { prompt: 'The strength is the tight end\'s side. Tap the tight end.', look: ['line'], find: { role: 'TE' }, answer: 'Y' },
        { prompt: 'Now tap the Sam, who goes to the strong side.', look: ['Y'], find: { role: 'SAM' }, answer: 'SAM' },
      ],
      puzzles: [
        choice('r1-u7-p1', 'r1-str', 'Which side is the strong side?', 'strength', SIDE_OPTS, 0, ['str:rule'], 'The tight end is on the left, so the left is strong.'),
        tap('r1-u7-p2', 'r1-str', 'Tap the Sam linebacker.', { role: 'SAM' }, 'SAM', ['str:defense'], 'The Sam goes to the strong side: the left, where the tight end is.'),
        choice('r1-u7-p3', 'r1-v-trips-kc', 'Which side is the strong side?', 'strength', SIDE_OPTS, 1, ['str:rule'], 'The tight end is on the right, with two more receivers: the right is strong.'),
        choice('r1-u7-p4', 'r1-v-ace-l', 'One tight end each side and one receiver each side. The ball is on the left hash. Which side is strong?', 'strength', SIDE_OPTS, 1, ['str:rule', 'field:sides'], 'Everything is even, so the field side breaks the tie. Ball on the left hash makes the right the field.'),
        choice('r1-u7-p5', 'r1-v-ace-r', 'Same formation, ball on the right hash. Which side is strong?', 'strength', SIDE_OPTS, 0, ['str:rule', 'field:sides'], 'Still even, so the field side wins. Ball on the right hash makes the left the field.'),
        tap('r1-u7-p6', 'r1-v-iform-ten', 'Tap the strong safety.', { role: 'SS' }, 'SS', ['str:defense'], 'The tight end is on the right, so the strong safety is on the right.'),
        choice('r1-u7-p7', 'r1-v-iform-ten', 'In Coach School, what decides the strength first?', 'fact', [['The tight end\'s side', 'te'], ['The side with more receivers', 'rec'], ['The field side', 'field'], ['Where the running back stands', 'rb']], 0, ['str:rule'], 'The tight end first, then more receivers, then the field side.', { truth: 'te', src: 'facts A, rank 1, Formation strength (CS convention)' }),
      ],
    },
  ];

  // Game Day: a pool of 17; each exam draws 12 with at least one from every unit (CS.pickGameDay).
  const g = (u, p) => ({ ...p, unit: u });
  const gameDay = [
    g('r1-u1', choice('r1-gd-1', 'r1-g-1', 'Is the ball in the red zone?', 'redZone', YN, 0, ['field:redzone'], 'Opponent\'s 16: inside the 20.')),
    g('r1-u1', choice('r1-gd-2', 'r1-g-4', 'The ball is on the left hash. Which side is the boundary, the short side?', 'boundarySide', SIDE_OPTS, 0, ['field:sides'], 'The field is the wide side (the right), so the boundary is the left.')),
    g('r1-u1', choice('r1-gd-3', 'r1-g-2', 'How long is the field from goal line to goal line?', 'fact', [['53 1/3 yards', 53.33], ['100 yards', 100], ['110 yards', 110], ['120 yards', 120]], 1, ['field:size'], '100 yards between the goal lines; 120 counting both end zones.', { truth: 100, src: 'facts A, rank 1, The field' })),
    g('r1-u2', tap('r1-gd-4', 'r1-g-3', 'Tap the player at the left end of the line.', { lineEnd: 'L' }, 'X', ['los:eligible'], 'X is the last man on the line on the left.')),
    g('r1-u2', choice('r1-gd-5', 'r1-g-2', 'Is the ringed lineman an eligible receiver?', 'eligible', YN, 1, ['los:eligible'], 'An interior lineman is never at an end of the line, so he is ineligible.', { of: 'C', focus: ['C'] })),
    g('r1-u2', choice('r1-gd-6', 'r1-g-5', 'How many offensive players are off the line, in the backfield?', 'backfieldCount', [['3', 3], ['4', 4], ['5', 5]], 1, ['los:seven'], 'Seven on, four off.')),
    g('r1-u3', tap('r1-gd-7', 'r1-g-1', 'Tap the left tackle.', { role: 'LT' }, 'LT', ['ol:names'], 'The left tackle is the top man of the five.')),
    g('r1-u3', tap('r1-gd-8', 'r1-g-5', 'Tap the right guard.', { role: 'RG' }, 'RG', ['ol:names'], 'Next to the center on the offense\'s right.')),
    g('r1-u3', choice('r1-gd-9', 'r1-g-4', 'Who snaps the ball?', 'fact', [['The center', 'C'], ['The quarterback', 'QB'], ['The left guard', 'LG']], 0, ['ol:center'], 'The center snaps it.', { truth: 'C', src: 'facts A, rank 1, Offensive line' })),
    g('r1-u4', tap('r1-gd-10', 'r1-g-3', 'Tap the fullback.', { role: 'FB' }, 'FB', ['bk:rb'], 'The fullback stands in front of the tailback.')),
    g('r1-u4', choice('r1-gd-11', 'r1-g-4', 'How is this quarterback lined up?', 'qbAlign', [['Under center', 'under'], ['Pistol', 'pistol'], ['Shotgun', 'gun']], 1, ['bk:qb'], 'About 4 yards back with the back behind him: pistol.', { focus: ['QB'] })),
    g('r1-u5', tap('r1-gd-12', 'r1-g-1', 'Tap Z, the flanker.', { role: 'Z' }, 'Z', ['wr:xz'], 'Z stands a yard off the line on the tight end\'s side.')),
    g('r1-u5', tap('r1-gd-13', 'r1-g-5', 'Tap the slot receiver, H.', { role: 'H' }, 'H', ['wr:slot'], 'H is inside the outside receiver, off the line.')),
    g('r1-u6', tap('r1-gd-14', 'r1-g-3', 'Tap the nose tackle.', { role: 'NT' }, 'NT', ['def:dl'], 'Head-up on the center.')),
    g('r1-u6', tap('r1-gd-15', 'r1-g-1', 'Tap the Will linebacker.', { role: 'WILL' }, 'WILL', ['def:lb'], 'The weak-side linebacker, away from the tight end.')),
    g('r1-u7', choice('r1-gd-16', 'r1-g-2', 'Which side is the strong side?', 'strength', SIDE_OPTS, 0, ['str:rule'], 'The tight end and the trips are on the left.')),
    g('r1-u7', tap('r1-gd-17', 'r1-g-4', 'Tap the strong safety.', { role: 'SS' }, 'SS', ['str:defense'], 'He lines up on the tight end\'s side.')),
  ];

  for (const u of units) for (const pz of u.puzzles) pz.unit = u.id;
  CS.RANK_DATA = CS.RANK_DATA || [];
  CS.RANK_DATA[0] = {
    rank: 0, id: 'r1', title: 'Intern', subtitle: 'The field and the 22', promotesTo: 'Quality Control Coach',
    units, gameDay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
