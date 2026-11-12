/* Coach School puzzle type: PREDICT. "Where does the ball go?" Pure half loads in the page and in
   a Node vm (the suite); registers into CS.puzzleTypes.predict.

   The play freezes (at the snap, or at the quarterback's read point) and he taps the receiver the
   ball goes to. The teaching point is the READ: a concept puts one defender in conflict, and his
   choice decides the throw (fact sheet 6, "the conflict defender").

   puzzle: { id, type:'predict', play, at?: 'snap' | t, prompt, why, tags, answer, routes?, zones? }
     answer  a receiver id; the truth is the play's own throw (CS.compile(play).target)
     at      where the picture freezes. 'snap' (the default): a pre-snap read. A number: the QB's
             read point, after the snap and before the throw (see FREEZE below).
     routes  route chalk: exactly the concept's receivers on the read side, or nothing

   THREE sources must agree, or validate() refuses the puzzle:
     1. the play: CS.compile(play).target, the man the ball is thrown to;
     2. the sheet: READS below, one row per (concept, coverage) whose section-6 "conflict defender"
        cell names a two-way choice between named routes, with the cell quoted verbatim. The
        conflict defender is the man holding that zone (5a) on the concept's side; the sheet's
        own landmark for the zone (4: "where the dropper aims to be when the QB throws") must sit
        nearer the receiver he takes;
     3. the engine: where that defender actually is at the throw (CS.poseAt). He takes the receiver
        he is nearer by at least READ_MARGIN yards; the read opens the other one.
   It is also refused when the frame shows two right answers: the same read opening a receiver on
   the other side too, or any other receiver running a single route the sheet says beats this
   coverage (6, "Basic beater routes", read from CS.lib.ROUTE_BEATS).

   READ_MARGIN = 2 yd (CS convention, measured on the library): a defender within 2 yd of being
   equally near both men has not chosen. The closest real choice in the library is slant-flat vs
   Cover 3 (the nickel 6.4 yd from the slant, 9.2 from the flat: 2.8); the one that is no choice is
   stick vs Cover 3 (8.3 from the arrow, 8.6 from the stick: 0.3), which is refused.

   FREEZE: a zone defender in this engine runs a straight line to his landmark from the snap, so
   every frame after the snap shows part of his choice, and by the throw all of it (the read is
   then trivial: the open man is simply open). Two frames are honest:
     'snap'  nothing has moved. The answer is the pre-snap read: the coverage from the shell (5b
             "spot it pre-snap"), the conflict defender's zone (5a, 4), which concept route lands
             in it. This is the default.
     t > 0   the QB's read point: strictly before the throw, with the conflict defender visibly on
             his way (moved some of his drop) but not yet there: at most FREEZE_MAX (half) of the
             way from his alignment to his landmark. He is mid-decision: the boy reads the
             direction, not the arrival. */
(function (root) {
  'use strict';
  const CS = root.CS;
  const READ_MARGIN = 2;
  const FREEZE_MAX = 0.5;
  // Section 6, the "conflict defender" cell, verbatim, where it names a choice between two routes.
  // zone(side) = the 5a zone of the defender it names, on the concept's side; a / b = the two route
  // groups he chooses between (route names from the concept's routes cell); all = every route of
  // the concept (its receivers get the chalk).
  const READS = {
    'concept:smash|cov:2': { zone: (s) => `flat-${s}`, a: ['hitch'], b: ['corner'], all: ['hitch', 'corner'],
      q: 'the flat corner: squat on the hitch or sink under the corner' },
    'concept:flood|cov:3': { zone: (s) => `curl-flat-${s}`, a: ['flat'], b: ['sail', 'out'], all: ['go', 'sail', 'out', 'flat'],
      q: 'the curl-flat defender (sail or flat)' },
    'concept:stick|cov:3': { zone: (s) => `curl-flat-${s}`, a: ['flat', 'arrow'], b: ['stick'], all: ['go', 'flat', 'arrow', 'stick'],
      q: 'the curl-flat defender: flat or stick' },
    'concept:slant-flat|cov:3': { zone: (s) => `curl-flat-${s}`, a: ['slant'], b: ['flat', 'arrow'], all: ['slant', 'flat', 'arrow'],
      q: 'the curl-flat defender: widen to the flat (slant opens) or sink inside (flat opens)' },
    'concept:post-dig|cov:4': { zone: (s) => `deep-quarter-${s}M`, a: ['dig'], b: ['post'], all: ['post', 'dig'],
      q: 'the quarters safety: drive on the dig (post opens) or stay deep (dig opens)' },
  };
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const playOf = (pz, lib) => (pz && lib.PLAYS[pz.play]) || null;

  // The read, worked out from the play: every side where the concept's two route groups and its
  // conflict defender are all on the field. Never throws on a play that compiles.
  function readOf(play, lib) {
    lib = lib || CS.lib;
    const c = CS.compile(play, lib), d = lib.DEFENSES[play.defense], cov = d && d.coverage;
    const key = `${play.concept}|${cov}`, R = READS[key];
    const out = { key, concept: play.concept || null, cov, row: R || null, target: c.target, throwT: c.throwT, sides: [] };
    if (!R || c.throwT == null) return out;
    const at = CS.poseAt(play, c.throwT, lib).players;
    const route = (p) => p.team === 'off' && p.role === 'route' ? p.assign.route : null;
    for (const s of ['L', 'R']) {
      const A = c.off.filter((p) => p.side === s && R.a.includes(route(p))).map((p) => p.id);
      const B = c.off.filter((p) => p.side === s && R.b.includes(route(p))).map((p) => p.id);
      const def = c.def.find((p) => p.role === 'zone' && p.src.zone === R.zone(s));
      if (!A.length || !B.length || !def) continue;
      const z = lib.ZONES[def.src.zone], mark = { x: z.x + c.dX, y: z.y }, D = at[def.id];
      const near = (pt, ids) => Math.min(...ids.map((id) => dist(pt, at[id])));
      const dA = near(D, A), dB = near(D, B), mA = near(mark, A), mB = near(mark, B);
      const decided = Math.abs(dA - dB) >= READ_MARGIN;
      const takes = dA < dB ? 'a' : 'b';
      out.sides.push({
        side: s, defender: def.id, zone: def.src.zone, a: A, b: B, dA, dB, decided,
        taken: takes === 'a' ? A : B, open: takes === 'a' ? B : A,
        sheetAgrees: (mA < mB ? 'a' : 'b') === takes,
        concept: c.off.filter((p) => p.side === s && R.all.includes(route(p))).map((p) => p.id).sort(),
      });
    }
    return out;
  }
  // The side the read is about: the one whose open man is the throw (else the first found).
  const mainSide = (r) => r.sides.find((s) => s.open.includes(r.target)) || r.sides[0] || null;
  // How far the conflict defender has gone from his alignment toward his landmark at t (0..1).
  function progressAt(play, id, t, lib) {
    const c = CS.compile(play, lib), p = c.byId[id], z = lib.ZONES[p.src.zone];
    const q = CS.poseAt(play, t, lib).players[id], L = Math.hypot(z.x + c.dX - p.x, z.y - p.y);
    return L > 0 ? Math.hypot(q.x - p.x, q.y - p.y) / L : 0;
  }
  const freezeT = (pz, play, lib) => (pz.at == null || pz.at === 'snap' ? CS.compile(play, lib).snapT : pz.at);
  const eligible = (play, lib) => { const c = CS.compile(play, lib); return c.off.filter((p) => CS.isEligible(c, p.id) === true).map((p) => p.id); };

  const T = {
    name: 'predict',
    READS, READ_MARGIN, FREEZE_MAX, readOf, progressAt,
    freezeT: (pz, lib) => { lib = lib || CS.lib; const play = playOf(pz, lib); return play ? freezeT(pz, play, lib) : null; },
    eligible: (pz, lib) => { lib = lib || CS.lib; const play = playOf(pz, lib); return play ? eligible(play, lib) : []; },
    // Right when he taps the man the play throws to.
    check(pz, ans, lib) {
      lib = lib || CS.lib;
      const play = playOf(pz, lib);
      if (!play || typeof ans !== 'string') return false;
      const t = CS.compile(play, lib).target;
      return t != null && ans === t;
    },
    truth(pz, lib) { lib = lib || CS.lib; const play = playOf(pz, lib); return play ? CS.compile(play, lib).target : null; },
    // Every other eligible receiver.
    distractors(pz, lib) {
      lib = lib || CS.lib;
      const play = playOf(pz, lib);
      if (!play) return [];
      const t = CS.compile(play, lib).target;
      return eligible(play, lib).filter((id) => id !== t);
    },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const L = `puzzle ${pz && pz.id}`, e = [];
      const play = playOf(pz, lib);
      if (!play) return [`${L}: unknown play ${pz && pz.play}`];
      let c;
      try { c = CS.compile(play, lib); } catch (err) { return [`${L}: play ${play.id} does not compile: ${err.message}`]; }
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${L}: no prompt`);
      if (!pz.why || typeof pz.why !== 'string') e.push(`${L}: no why`);
      if (c.throwT == null || c.target == null) return e.concat(`${L}: the play has no throw, so the ball goes nowhere`);
      if (CS.isEligible(c, c.target) !== true) e.push(`${L}: the play throws to ${c.target}, who is not an eligible receiver`);
      if (pz.answer !== c.target) e.push(`${L}: the stored answer is ${pz.answer} but the play throws to ${c.target}`);
      // The read.
      const r = readOf(play, lib);
      if (!r.row) return e.concat(`${L}: no documented two-way read for ${r.concept} vs ${r.cov} (fact sheet 6), so the throw is not decidable from the picture`);
      if (!r.sides.length) return e.concat(`${L}: ${r.concept} vs ${r.cov}: the concept's routes and its conflict defender (${r.row.q}) are not on the field together`);
      const S = mainSide(r);
      if (!S.decided) e.push(`${L}: the conflict defender ${S.defender} is ${S.dA.toFixed(1)} yd from ${S.a.join('/')} and ${S.dB.toFixed(1)} from ${S.b.join('/')} at the throw: he has not chosen (needs ${READ_MARGIN} yd)`);
      if (!S.sheetAgrees) e.push(`${L}: ${S.defender}'s landmark (${S.zone}, fact sheet 4) is nearer the other receiver than where the play puts him`);
      if (S.open.length !== 1) e.push(`${L}: the read opens ${S.open.length} receivers (${S.open.join(', ')}): two right answers`);
      if (!S.open.includes(c.target)) e.push(`${L}: the read ("${r.row.q}") has ${S.defender} take ${S.taken.join('/')}, which opens ${S.open.join('/')}, but the play throws to ${c.target}`);
      // Two right answers in the picture.
      // The concept on both sides is two reads: decided, each opens a man; undecided, the other side
      // might. Either way the frame has more than one defensible answer.
      if (r.sides.length > 1) e.push(`${L}: ${r.concept} runs on both sides (${r.sides.map((s) => s.side + ': ' + s.open.join('/') + (s.decided ? '' : ' (undecided)')).join(', ')} open by the read): two right answers`);
      const beaters = (lib.ROUTE_BEATS || []).filter((row) => row.route && row.cov === r.cov).map((row) => row.route);
      for (const p of c.off) {
        if (p.id === c.target || p.role !== 'route') continue;
        if (beaters.includes(p.assign.route)) e.push(`${L}: ${p.id} runs a ${p.assign.route}, which beats ${r.cov} on its own (fact sheet 6): two right answers`);
      }
      // The frame.
      const ft = freezeT(pz, play, lib);
      if (!(pz.at == null || pz.at === 'snap' || (typeof pz.at === 'number' && Number.isFinite(pz.at)))) e.push(`${L}: at must be 'snap' or a time`);
      else if (typeof pz.at === 'number') {
        if (!(pz.at > c.snapT)) e.push(`${L}: a read-point freeze must come after the snap (at ${pz.at}); use 'snap' for the pre-snap read`);
        if (!(pz.at < c.throwT)) e.push(`${L}: the freeze at ${pz.at} is at or after the throw (${c.throwT}): the ball shows the answer`);
        else {
          const pr = progressAt(play, S.defender, ft, lib);
          if (pr > FREEZE_MAX) e.push(`${L}: at ${pz.at} ${S.defender} is ${(pr * 100).toFixed(0)}% of the way to his landmark: he has already chosen, which gives the answer away`);
          if (pr <= 0) e.push(`${L}: at ${pz.at} ${S.defender} has not moved: freeze at the snap instead`);
        }
      }
      // Chalk: only the concept's receivers on the read side; never the zone drops (a drop line is
      // the conflict defender's choice drawn out).
      if (pz.routes != null && pz.routes !== false) {
        const want = JSON.stringify(S.concept), got = JSON.stringify(Array.isArray(pz.routes) ? pz.routes.slice().sort() : pz.routes);
        if (want !== got) e.push(`${L}: route chalk ${got} must be exactly the concept's receivers ${want}`);
      }
      if (pz.zones) e.push(`${L}: zone chalk draws the conflict defender's drop, which gives the read away`);
      return e;
    },

    /* ── page side ── */
    mount(ctx) {
      const { field, pz, play, lib } = ctx, c = CS.compile(play, lib);
      const st = { frozen: false, dead: false };
      const ft = freezeT(pz, play, lib);
      const hold = () => { if (st.dead) return; st.frozen = true; };
      if (ft === c.snapT) field.freezeAtSnap(hold); else field.playTo(ft, hold);
      // Not a guess, so no try: a note in the panel, or a coach bubble on the man he tapped (a note,
      // not the red of a miss, and nobody faded: the receivers must stay in plain sight).
      const nudge = (parts) => { ctx.say(null); ctx.feedback('bad', parts); };
      const note = (id, rest) => { ctx.feedback(null); ctx.say({ parts: [{ tag: 'b', text: ctx.nameOf(id) }, rest], focus: [id], tone: 'note', zoom: false, spot: false }); };
      return {
        onTap(id) {
          if (st.dead || ctx.done) return;
          if (!st.frozen) return nudge(['Wait until the play stops.']);
          const p = id ? c.byId[id] : null;
          if (!p) return nudge(['No player there. Tap right on a receiver.']);
          if (p.team !== 'off') return note(id, ' is on defense. Tap one of your receivers.');
          if (p.pos === 'QB') return note(id, ': he is the one throwing it. Tap a receiver.');
          if (CS.isEligible(c, id) !== true) return note(id, " can't catch a pass. Tap a receiver.");
          ctx.feedback(null);
          ctx.submit(id);
        },
        missed(ans) {
          ctx.field.setMarks(ctx.focusMarks.concat([{ id: ans, kind: 'bad' }]));
          ctx.say({ parts: ['Not the ', { tag: 'b', text: ctx.lc(ctx.nameOf(ans)) }, '. Find the one defender who cannot cover two men. One more try.'], focus: [ans], tone: 'bad', zoom: false, spot: false });
        },
        resolved({ ok, picked }) {
          st.frozen = false;
          const m = [];
          if (!ok && picked) m.push({ id: picked, kind: 'bad' });
          m.push({ id: c.target, kind: 'good' });
          return m;
        },
        destroy() {
          // A freeze still pending is ours: stop the clock so it cannot fire into a dead handle.
          if (!st.frozen && field.freezing != null) field.pause();
          st.dead = true; st.frozen = false;
        },
      };
    },
    rightName(pz, ctx) { return ctx.nameOf(T.truth(pz, ctx.lib)); },
    // The explanation points at the receiver and the defender whose choice opened him.
    lookOf(pz, ctx) {
      const r = readOf(ctx.play, ctx.lib), S = mainSide(r);
      return S ? [r.target, S.defender] : [r.target];
    },
    // Wrong: first the play runs up to the throw with no throw (the engine has no breakup to show,
    // so it stops on the moment the QB would have let it go), the conflict defender and his pick
    // ringed; then the real play to the right man.
    outcome(pz, ans, ok, ctx) {
      if (ok) return null;
      const r = readOf(ctx.play, ctx.lib), S = mainSide(r);
      const stop = CS.variantOf(ctx.play, { tag: 'pick-' + ans, ball: [{ t: CS.compile(ctx.play, ctx.lib).snapT, ev: 'snap' }], T: r.throwT, callouts: [] });
      const def = S ? S.defender : null, took = S && S.taken.includes(ans);
      // cs-ui's explanation opens "The answer: ..."; this run's bubble replaces it while it plays,
      // so it opens the same way (the explanation itself returns with the real play).
      const head = { tag: 'b', text: 'The answer: ' + T.rightName(pz, ctx) + '.' };
      const parts = took
        ? [head, ' The ', ctx.lc(ctx.nameOf(def)), ' took the ', ctx.lc(ctx.nameOf(ans)), ', so that throw is not there.']
        : [head, ' The read is the ', ctx.lc(ctx.nameOf(def)), ', not the ', ctx.lc(ctx.nameOf(ans)), '.'];
      const marks = ctx.focusMarks.concat([{ id: ans, kind: 'bad' }], def ? [{ id: def, kind: 'focus' }] : []);
      return [
        { play: stop, say: { parts, focus: def ? [def, ans] : [ans], tone: 'bad', zoom: false }, marks },
        { play: ctx.play },
      ];
    },
  };

  /* ── examples: two library concept plays, each cut down to a single read ── The library's own
     smash and flood plays are not predict puzzles as they stand, and validate() says why: smash runs
     on both sides (the corner route is open on each), and flood's backside hitch beats Cover 3 on
     its own. Each variant keeps the concept side exactly and gives the other side routes the
     coverage handles (Cover 2: "short outside throws and flats"; Cover 3: deep balls, 5b). */
  const L = CS.lib, PLAYS = L.PLAYS;
  const reg = (id, base, o) => {
    if (PLAYS[id] || !PLAYS[base]) return;
    PLAYS[id] = CS.variantOf(PLAYS[base], { tag: 'pz', callouts: [], ...o });
    PLAYS[id].id = id;
  };
  reg('pz-predict-smash-c2', 'smash-vs-c2', { name: 'Smash left vs Cover 2', routes: ['H', 'X'], zones: false, assign: { Z: { route: 'go' }, Y: { route: 'flat' } } });
  reg('pz-predict-flood-c3', 'flood-vs-c3', { name: 'Flood right vs Cover 3', routes: ['RB', 'Y', 'Z'], zones: false, assign: { X: { route: 'go' } } });
  T.examples = [
    { id: 'pz-predict-ex-smash', type: 'predict', play: 'pz-predict-smash-c2', at: 'snap', routes: ['H', 'X'],
      prompt: 'Smash to the left against Cover 2. Where does the ball go? Tap the receiver.',
      why: 'In Cover 2 the left corner has the flat, so he squats on the hitch. He cannot also sink under the corner route, so the ball goes over him to the slot.',
      tags: ['concept:smash', 'cov:2'], answer: 'H' },
    { id: 'pz-predict-ex-flood', type: 'predict', play: 'pz-predict-flood-c3', at: 0.4, routes: ['RB', 'Y', 'Z'],
      prompt: 'Flood to the right against Cover 3. Watch the nickel drop. Where does the ball go? Tap the receiver.',
      why: 'The nickel has the curl, then the flat. He sinks under the sail, so the back in the flat is open.',
      tags: ['concept:flood', 'cov:3'], answer: 'RB' },
  ];

  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.predict = T;
})(typeof window !== 'undefined' ? window : globalThis);
