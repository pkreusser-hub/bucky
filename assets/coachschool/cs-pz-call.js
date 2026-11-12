/* Coach School puzzle type: CALL. A situation card (quarter, clock, down and distance, ball,
   score, timeouts) over the picture before the snap; he picks the call from 2-4 options. Pure half
   loads in the page and in a Node vm (the suite); registers into CS.puzzleTypes.call.

   Two flavours, told apart by `kind`:
     'audible'  the pre-snap read. Every option is a concept (a BEATS key with a canonical play in
                CS.lib.CONCEPTS). Right = the one option whose BEATS row holds the coverage of the
                defense on the field (fact sheet 6). An option the sheet calls CONTESTED or POOR
                against that coverage, or one that only beats it to one side (BEATS_SIDE), may not be
                offered at all: it is neither the single right answer nor a fair wrong one.
     RULE kinds (RULES below)  clock and timeout decisions whose answer is a RULE of fact sheet 10,
                worked out from the situation. A kind the sheet calls a contested decision (two-point
                charts, 4th-down go-or-kick: CONTESTED_KINDS) is refused by validate(): the sheet
                gives principles there, never a fixed answer.

   puzzle: { id, type:'call', kind, play, situation, prompt, options:[{t, v, no?}], answer, src,
             tags, why, look? }
     situation  { quarter 1-4, clock (seconds left in the quarter), running (clock running before
                  this snap), down 1-4, dist, yardline (0 = our goal line, as play.spot), score
                  {us, them}, timeouts {us, them} }; the play's spot and dist must agree with it
     options    t = the words on the button, v = the call, no = why it is worse (every wrong option
                needs one, from the sheet)
     src        [{ sec, q }]: the fact-sheet section and a phrase found verbatim in it (the suite
                checks the phrase); every call puzzle needs one
   Answer: the index of the option he picked (as `choice`).

   Outcome: a wrong audible plays out first (the wrong concept, run against the coverage on the
   field, the QB holding the ball while the target's man defender stays on him: validate() measures
   that he is within COVERED_YD at the concept's throw time), then the right concept's own library
   play. A rule puzzle needs no play: the situation card shows what the call does to the clock and
   the down (CONSEQUENCE below), and the field shows the snap. */
(function (root) {
  'use strict';
  const CS = root.CS;
  const COVERED_YD = 1.5;

  // A rule kind's answer from the situation, or null when the rule does not decide it (validate()
  // then refuses the puzzle). Fact sheet 10 (Clock), and rank 7 (Two-minute drill).
  //   twoMinute  the half's last 2:00 (2nd and 4th quarters): the two-minute drill
  //   oobWindow  "the last 2:00 of the 1st half and the last 5:00 of the 2nd half": a runner out of
  //              bounds stops the clock until the snap
  const twoMinute = (s) => (s.quarter === 2 || s.quarter === 4) && s.clock <= 120;
  const oobWindow = (s) => (s.quarter === 2 && s.clock <= 120) || (s.quarter === 4 && s.clock <= 300);
  const RULES = {
    // The clock is running, the offense needs it stopped, and has no timeout. A spike stops it and
    // uses a down, "so it is a bad idea on 4th down": on 4th down the call is a real play.
    'stop-clock': (s) => {
      if (!s.running || s.score.us > s.score.them || !twoMinute(s) || s.timeouts.us !== 0) return null;
      return s.down === 4 ? 'play' : 'spike';
    },
    // Two-minute drill, no timeouts: a runner out of bounds inside the window stops the clock until
    // the snap; a catch in the middle, tackled in bounds, keeps it running.
    sideline: (s) => {
      if (s.score.us > s.score.them || !oobWindow(s) || s.timeouts.us !== 0) return null;
      return 'sideline';
    },
  };
  // Decisions the sheet marks contested: never a puzzle with a fixed answer.
  const CONTESTED_KINDS = {
    'two-point': 'fact sheet 10, Two-point decisions: specific cases are debated and contested among coaches and analysts; no fixed chart',
    'fourth-down': 'fact sheet 10, 4th-down decisions: principles only; yards, field position, score, time, the kicker and weather all change the answer',
  };
  // What each rule call does to the clock and the down (fact sheet 10, Clock). `clock` is the state
  // after the play; `down` true = it uses a down. Words only, no invented times.
  const CONSEQUENCE = {
    spike: { clock: 'stopped', down: true, say: 'the clock stops, and it uses a down' },
    'run-middle': { clock: 'running', down: true, say: 'the clock keeps running' },
    middle: { clock: 'running', down: true, say: 'the clock keeps running' },
    sideline: { clock: 'stopped', down: true, say: 'the clock stops until the snap' },
    timeout: { clock: null, down: false, say: 'no timeouts left: nothing stops' },
    play: { clock: null, down: true, say: 'a real play: the down is used on a chance to score' },
  };
  const VOCAB = { 'stop-clock': ['spike', 'run-middle', 'timeout', 'play'], sideline: ['sideline', 'middle', 'timeout'] };

  const covOf = (play, lib) => (lib.DEFENSES[play.defense] || {}).coverage;
  const has = (row, cov) => !!row && (Array.isArray(row) ? row : row.covs || []).includes(cov);
  const ORD = ['', '1st', '2nd', '3rd', '4th'];
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const ballOn = (y) => (y === 50 ? '50' : y < 50 ? `Own ${y}` : `Opp ${100 - y}`);
  const downText = (d, dist, yl) => `${ORD[d]} & ${yl + dist >= 100 ? 'Goal' : dist}`;

  // Is option v right? (the one judge, for check and truth)
  function rightV(pz, v, lib) {
    const play = lib.PLAYS[pz.play];
    if (!play) return false;
    if (pz.kind === 'audible') return has(lib.BEATS[v], covOf(play, lib));
    const R = RULES[pz.kind];
    const want = R && pz.situation ? R(pz.situation) : null;
    return want != null && v === want;
  }

  // The wrong-run variant for an audible option: the concept's canonical play, run against the
  // defense on the field (same teams, spot, distance), the QB holding the ball (no throw: the target
  // is covered). Also returns who the target is, his man defender and the concept's throw time.
  function wrongRun(pz, v, lib) {
    const shown = lib.PLAYS[pz.play], con = lib.CONCEPTS[v], base = con && lib.PLAYS[con.play];
    if (!shown || !base) return null;
    const c0 = CS.compile(base, lib);
    const play = CS.variantOf(base, {
      tag: 'wrong-' + pz.play, name: `${con.name} vs ${lib.COVERAGES[covOf(shown, lib)] ? lib.COVERAGES[covOf(shown, lib)].name : covOf(shown, lib)}`,
      defense: shown.defense, teams: shown.teams, home: shown.home, spot: shown.spot, dist: shown.dist, hash: shown.hash, mirror: shown.mirror,
      ball: [{ t: 0, ev: 'snap' }], T: c0.throwT + 0.8, callouts: [],
    });
    const c = CS.compile(play, lib), man = c.def.find((d) => d.role === 'man' && d.manOf === c0.target);
    let gap = null;
    if (man) { const P = CS.poseAt(play, c0.throwT, lib).players; gap = Math.hypot(P[man.id].x - P[c0.target].x, P[man.id].y - P[c0.target].y); }
    return { play, target: c0.target, man: man ? man.id : null, throwT: c0.throwT, gap, name: con.name };
  }

  const T = {
    name: 'call',
    RULES, CONTESTED_KINDS, CONSEQUENCE, COVERED_YD, wrongRun,
    // answer = the index of the option he picked.
    check(pz, answer, lib) {
      lib = lib || CS.lib;
      const o = (pz.options || [])[answer];
      return !!o && rightV(pz, o.v, lib);
    },
    truth(pz, lib) {
      lib = lib || CS.lib;
      const r = (pz.options || []).map((o, i) => (rightV(pz, o.v, lib) ? i : -1)).filter((i) => i >= 0);
      return r.length === 1 ? r[0] : null;
    },
    distractors(pz) { return (pz.options || []).map((o, i) => i).filter((i) => i !== pz.answer); },
    // The card's words, for the page and the suite.
    card(s) {
      return { qtr: 'Q' + s.quarter, clock: mmss(s.clock), down: downText(s.down, s.dist, s.yardline), ball: ballOn(s.yardline), us: String(s.score.us), them: String(s.score.them),
        line: `Clock ${s.running ? 'running' : 'stopped'}. Timeouts: us ${s.timeouts.us}, them ${s.timeouts.them}.` };
    },
    // After a rule call: the clock state and the next down, in words.
    after(pz, v) {
      const s = pz.situation, k = CONSEQUENCE[v];
      if (!k) return null;
      const clock = k.clock || (s.running ? 'running' : 'stopped');
      const down = !k.down ? downText(s.down, s.dist, s.yardline) : s.down < 4 ? downText(s.down + 1, s.dist, s.yardline) : '4th down used';
      return { clock, down, say: k.say };
    },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const e = [], L = `puzzle ${pz.id}`;
      const play = lib.PLAYS[pz.play];
      if (!play) return [`${L}: unknown play ${pz.play}`];
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${L}: no prompt`);
      if (!pz.why || typeof pz.why !== 'string') e.push(`${L}: no why`);
      const src = Array.isArray(pz.src) ? pz.src : [];
      if (!src.length || !src.every((s) => s && typeof s.sec === 'string' && s.sec && typeof s.q === 'string' && s.q.length >= 4)) e.push(`${L}: a call puzzle must carry src: [{sec, q}], the fact-sheet section and a phrase from it`);
      if (CONTESTED_KINDS[pz.kind]) return e.concat(`${L}: kind ${pz.kind} is a contested decision (${CONTESTED_KINDS[pz.kind]}): no puzzle may give it a fixed answer`);
      if (pz.kind !== 'audible' && !RULES[pz.kind]) return e.concat(`${L}: unknown kind ${pz.kind}`);
      const s = pz.situation;
      const int = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
      if (!s || !int(s.quarter, 1, 4) || !(s.clock >= 0 && s.clock <= 900) || !int(s.down, 1, 4) || !int(s.dist, 1, 99) || !int(s.yardline, 1, 99)
        || !s.score || !int(s.score.us, 0, 99) || !int(s.score.them, 0, 99) || !s.timeouts || !int(s.timeouts.us, 0, 3) || !int(s.timeouts.them, 0, 3) || typeof s.running !== 'boolean') {
        return e.concat(`${L}: situation needs quarter 1-4, clock 0-900 s, running, down 1-4, dist, yardline 1-99, score {us, them}, timeouts {us, them} 0-3`);
      }
      if (CS.num(play.spot, 25) !== s.yardline || CS.num(play.dist, 10) !== s.dist) e.push(`${L}: the field shows spot ${play.spot}, ${play.dist} to go, the card says ${s.yardline}, ${s.dist}`);
      const os = pz.options || [];
      if (os.length < 2 || os.length > 4) e.push(`${L}: ${os.length} options (2-4)`);
      if (new Set(os.map((o) => String(o.t).toLowerCase())).size !== os.length) e.push(`${L}: two options read the same`);
      if (new Set(os.map((o) => o.v)).size !== os.length) e.push(`${L}: two options make the same call`);
      if (pz.kind === 'audible') {
        const cov = covOf(play, lib);
        if (!cov) e.push(`${L}: the defense on the field names no coverage`);
        for (const o of os) {
          if (!lib.CONCEPTS[o.v] || !lib.BEATS[o.v]) { e.push(`${L}: option ${o.t}: ${o.v} is not a concept with a BEATS row`); continue; }
          if (has(lib.CONTESTED[o.v], cov)) e.push(`${L}: option ${o.t}: ${o.v} vs ${cov} is CONTESTED (${lib.CONTESTED[o.v].why}): never offered`);
          if (has((lib.POOR || {})[o.v], cov)) e.push(`${L}: option ${o.t}: ${o.v} vs ${cov} is POOR: never offered`);
          if (((lib.BEATS_SIDE || {})[o.v] || []).some((r) => r.cov === cov)) e.push(`${L}: option ${o.t}: ${o.v} beats ${cov} only to one side: never offered`);
          if (!rightV(pz, o.v, lib)) {
            const w = wrongRun(pz, o.v, lib);
            if (!w) { e.push(`${L}: option ${o.t}: no canonical play to run`); continue; }
            const pe = CS.validatePlay(w.play, lib);
            if (pe.length) e.push(`${L}: option ${o.t}: its wrong run is not a legal play: ${pe[0]}`);
            if (lib.PLAYS[lib.CONCEPTS[o.v].play].formation !== play.formation) e.push(`${L}: option ${o.t}: its play lines up in another formation than the picture`);
            if (!w.man || !(w.gap <= COVERED_YD)) e.push(`${L}: option ${o.t}: its target ${w.target} is not covered man-to-man within ${COVERED_YD} yd at the throw (${w.man || 'no man defender'}${w.gap != null ? ', ' + w.gap.toFixed(2) + ' yd' : ''}): the wrong run would not show it covered`);
          }
        }
      } else {
        const want = RULES[pz.kind](s);
        if (want == null) e.push(`${L}: the ${pz.kind} rule does not decide this situation`);
        for (const o of os) if (!VOCAB[pz.kind].includes(o.v)) e.push(`${L}: option ${o.t}: ${o.v} is not a ${pz.kind} call`);
      }
      const right = os.map((o, i) => (rightV(pz, o.v, lib) ? i : -1)).filter((i) => i >= 0);
      if (right.length === 0) e.push(`${L}: no option is right`);
      if (right.length > 1) e.push(`${L}: options ${right.join(' and ')} are both right: two right answers`);
      if (right.length === 1 && right[0] !== pz.answer) e.push(`${L}: the right option is ${right[0]} but the stored answer is ${pz.answer}`);
      os.forEach((o, i) => { if (!right.includes(i) && !(typeof o.no === 'string' && o.no.length > 10)) e.push(`${L}: wrong option ${o.t} needs a "no": why it is worse, from the sheet`); });
      return e;
    },
  };

  /* ── backdrops for the rule puzzles: the snap, at the card's spot and distance ── Puzzle-only plays
     (no callouts, no chalk). The spike is taught from under center only (fact sheet 10, Spike), so
     the clock puzzles line up in singleback. T just past the snap: "the play" is the call itself. */
  const L = CS.lib;
  const BACK = (id, o) => {
    if (L.PLAYS[id]) return;
    L.PLAYS[id] = { id, home: 'off', routes: false, zones: false, assign: {}, ball: [{ t: 0, ev: 'snap' }], T: 0.6, tags: [], ...o };
  };
  BACK('pz-call-two-minute', { name: 'Two-minute drill', formation: 'singleback', defense: 'c2-43-over', teams: { off: 'DET', def: 'GB' }, spot: 70, dist: 10 });
  BACK('pz-call-fourth-down', { name: 'Last chance', formation: 'singleback', defense: 'c2-43-over', teams: { off: 'MIN', def: 'CHI' }, spot: 88, dist: 2 });
  BACK('pz-call-sideline', { name: 'Two-minute drill, no timeouts', formation: 'gun-2x2', defense: 'c2-nickel', teams: { off: 'CIN', def: 'PIT' }, spot: 45, dist: 10 });

  /* ── examples ── one audible, three rule calls */
  T.examples = [
    { id: 'pz-call-ex-mesh', type: 'call', kind: 'audible', play: 'mesh-vs-c1',
      situation: { quarter: 2, clock: 425, running: false, down: 1, dist: 10, yardline: 35, score: { us: 7, them: 10 }, timeouts: { us: 3, them: 3 } },
      prompt: 'Read the defense before the snap. Check to the concept built to beat it.',
      options: [
        { t: 'Smash', v: 'concept:smash', no: 'Smash is built for Cover 2: it puts the flat corner in a bind. Here every receiver has a man on him, so there is no flat corner to stress.' },
        { t: 'Mesh', v: 'concept:mesh' },
        { t: 'Curl-flat', v: 'concept:curl-flat', no: 'Curl-flat is built for the Cover 3 and Cover 2 zones. Against man coverage the curl has a defender on him the whole way.' },
      ],
      answer: 1, look: ['H', 'Y'], tags: ['concept:mesh', 'cov:1'],
      src: [{ sec: '5b', q: 'one high safety, corners pressed or tight' }, { sec: '6', q: 'man coverage: Cover 1, Cover 0, 2-man' }],
      why: 'One deep safety and the corners tight: Cover 1, man coverage. Mesh beats man: defenders trailing the two crossers get rubbed by traffic.' },
    { id: 'pz-call-ex-spike', type: 'call', kind: 'stop-clock', play: 'pz-call-two-minute',
      situation: { quarter: 4, clock: 24, running: true, down: 2, dist: 10, yardline: 70, score: { us: 17, them: 20 }, timeouts: { us: 0, them: 1 } },
      prompt: 'The last play ended in bounds and the clock is running. What is the call?',
      options: [
        { t: 'Spike it', v: 'spike' },
        { t: 'Hand off up the middle', v: 'run-middle', no: 'A runner tackled in bounds keeps the clock running, and there are 24 seconds left.' },
        { t: 'Call a timeout', v: 'timeout', no: 'There are none left. Each team gets 3 per half.' },
      ],
      answer: 0, tags: ['clock:spike'],
      src: [{ sec: '10', q: 'throws the ball straight into the ground immediately after the snap to stop the clock' }, { sec: '10', q: 'counts as an incomplete pass' }],
      why: 'From under center, the quarterback throws the ball straight into the ground right after the snap. It counts as an incomplete pass, so the clock stops. It uses a down, and on 2nd down there is one to spare.' },
    { id: 'pz-call-ex-fourth', type: 'call', kind: 'stop-clock', play: 'pz-call-fourth-down',
      situation: { quarter: 4, clock: 15, running: true, down: 4, dist: 2, yardline: 88, score: { us: 20, them: 24 }, timeouts: { us: 0, them: 2 } },
      prompt: 'The clock is running and you have no timeouts. What is the call?',
      options: [
        { t: 'Spike it to stop the clock', v: 'spike', no: 'A spike uses a down, and this is 4th down: the spike would be your last play.' },
        { t: 'Snap it and run a real play', v: 'play' },
        { t: 'Call a timeout', v: 'timeout', no: 'There are none left. Each team gets 3 per half.' },
      ],
      answer: 1, tags: ['clock:spike'],
      src: [{ sec: '10', q: 'so it is a bad idea on 4th down' }],
      why: 'A spike stops the clock, but it uses a down, so it is a bad idea on 4th down. This down has to be a real play.' },
    { id: 'pz-call-ex-sideline', type: 'call', kind: 'sideline', play: 'pz-call-sideline',
      situation: { quarter: 4, clock: 70, running: true, down: 1, dist: 10, yardline: 45, score: { us: 10, them: 13 }, timeouts: { us: 0, them: 3 } },
      prompt: 'Two-minute drill and no timeouts. Where should the catch be made?',
      options: [
        { t: 'Outside, and he steps out of bounds', v: 'sideline' },
        { t: 'Over the middle, tackled in bounds', v: 'middle', no: 'Tackled in bounds, the clock keeps running, and there is no timeout to stop it.' },
      ],
      answer: 0, tags: ['clock:sideline'],
      src: [{ sec: '10', q: 'Inside those windows: stops until the snap' }, { sec: '10', q: 'throws in the middle of the field keep the clock running unless a timeout is used' }],
      why: 'In the last 5:00 of the game, a runner who goes out of bounds stops the clock until the snap. A catch in the middle keeps it running.' },
  ];

  /* ── page side ── */
  const CSS_ID = 'cs-pz-call-css';
  if (root.document && !root.document.getElementById(CSS_ID)) {
    const st = root.document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      '.cs-call-card { grid-column:1 / -1; display:flex; flex-direction:column; gap:2px; padding:2px; border-radius:6px; background:#05070a; border:1px solid #3a2a00; }',
      '.cs-call-card .row { display:flex; gap:2px; }',
      '.cs-call-card .row > span { flex:1 1 auto; display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:0; padding:1px 4px; background:#0d0a03; border-radius:4px; }',
      '.cs-call-card small { font:600 9.5px var(--font-display); letter-spacing:1.5px; color:#b08a3a; text-transform:uppercase; white-space:nowrap; }',
      '.cs-call-card b { font:700 18px/1.05 var(--font-display); color:#ffb612; font-variant-numeric:tabular-nums; letter-spacing:.5px; white-space:nowrap; }',
      '.cs-call-card .line { padding:2px 6px; font:600 12px/1.3 var(--font-display); letter-spacing:1px; color:#d9c48f; text-transform:uppercase; }',
      '.cs-call-card .line.stopped { color:var(--good); }',
      '.cs-call-card .line.running { color:#ff8a7f; }',
      '.cs-call-card .after { padding:3px 6px 4px; font:14px/1.35 var(--font-body); color:var(--ink); border-top:1px solid #3a2a00; }',
      '.cs-call-card .after[hidden] { display:none; }',
    ].join('\n');
    root.document.head.appendChild(st);
  }

  T.mount = (ctx) => {
    const pz = ctx.pz, op = ctx.panel, doc = ctx.doc, k = T.card(pz.situation);
    const el = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const card = el('div', 'cs-call-card');
    card.setAttribute('role', 'group');
    card.setAttribute('aria-label', 'Situation');
    const row = el('div', 'row');
    const cell = (lab, val, key) => { const s = el('span'); s.dataset.k = key; s.append(el('small', null, lab), el('b', null, val)); row.appendChild(s); return s; };
    cell(k.qtr, k.clock, 'clock'); cell('Down', k.down, 'down'); cell('Ball', k.ball, 'ball'); cell('Us', k.us, 'us'); cell('Them', k.them, 'them');
    const line = el('div', 'line', k.line), after = el('div', 'after');
    after.hidden = true;
    card.append(row, line, after);
    op.appendChild(card);
    const btns = (pz.options || []).map((o, i) => {
      const b = el('button', null, o.t); b.type = 'button'; b.dataset.i = String(i);
      b.addEventListener('click', () => ctx.submit(i));
      op.appendChild(b);
      return b;
    });
    op.hidden = false;
    return {
      missed(ans) {
        const b = btns[ans];
        if (b) { b.classList.add('bad'); b.disabled = true; }
        const o = pz.options[ans];
        ctx.feedback('bad', [o && o.no ? o.no + ' ' : '', 'One more try.']);
      },
      resolved({ ok, picked }) {
        btns.forEach((b, i) => { b.disabled = true; if (i === pz.answer) b.classList.add('good'); else if (i === picked && !ok) b.classList.add('bad'); });
        if (pz.kind === 'audible') return null;
        // The scoreboard consequence: the right call's, and his own if it was another.
        const r = T.after(pz, pz.options[pz.answer].v);
        line.textContent = `After the call: clock ${r.clock}. ${r.down}.`;
        line.classList.add(r.clock);
        const parts = [`${pz.options[pz.answer].t}: ${r.say}.`];
        if (!ok && pz.options[picked]) parts.push(`Your call, ${pz.options[picked].t.toLowerCase()}: ${T.after(pz, pz.options[picked].v).say}.`);
        after.textContent = parts.join(' ');
        after.hidden = false;
        return null;
      },
      destroy() { op.textContent = ''; op.hidden = true; },
    };
  };
  T.rightName = (pz) => pz.options[pz.answer].t;
  // An audible's explanation points at what beats the coverage (pz.look); a rule call's stays in
  // the panel under the situation card.
  T.lookOf = (pz, ctx) => {
    if (pz.kind !== 'audible' || !pz.look) return null;
    const f = CS.toArr(pz.look);
    return f.every((tok) => ctx.CS.focusOf(ctx.play, tok, ctx.field.PRE)) ? f : null;
  };
  // Audible: a wrong call plays out against the coverage, then the right concept's play. Right: the
  // concept's play with its routes drawn. A rule call: the snap on the field (the card shows the rest).
  T.outcome = (pz, ans, ok, ctx) => {
    if (pz.kind !== 'audible') return null;
    const right = { play: ctx.play, chalk: { routes: true } };
    if (ok) return [right];
    const o = pz.options[ans], w = o && wrongRun(pz, o.v, ctx.lib);
    if (!w) return [right];
    return [{
      play: w.play, chalk: { routes: true },
      say: { parts: [{ tag: 'b', text: 'The answer: ' + T.rightName(pz) + '.' }, ` ${o.t} against man: the ${ctx.lc(ctx.nameOf(w.man, w.play))} is on the ${ctx.lc(ctx.nameOf(w.target, w.play))} when the ball should come out. No throw there.`], focus: [w.man, w.target], tone: 'bad', zoom: false },
    }, right];
  };

  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.call = T;
})(typeof window !== 'undefined' ? window : globalThis);
