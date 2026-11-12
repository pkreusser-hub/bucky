/* Coach School puzzle type: PLACE. "Drag the deep defenders to their Cover 3 landmarks", "line the
   Sam, Mike and Will up", "make trips right". Pure half loads in the page and in a Node vm (the
   suite); registers into CS.puzzleTypes.place. Brief: docs/coachschool-puzzle-types.md.

   puzzle: { id, type:'place', play, move:['CB-L', ...], at:{ id: '<ZONES name>' | 'align' },
             from?:{ id:{x, y} }, swap?:[[id, id], ...], marks?:['<ZONES name>', ...],
             tol, tolWhy, zoom?, whyAt?:{ id: text }, trap?:{ id: '<landmark name>' | {x, y} },
             answerName?, prompt, tags, why, answer }
   (whyAt: the fact-sheet line a wrong run's bubble says about that man; trap: the mistake the
   puzzle is written to catch, the first distractor; answerName: rightName's words, when the
   generated list would be too long for a bubble.)

   Truth never comes from the puzzle. Each mover's target is read from the play in the library:
     at[id] = 'align'      his own alignment in the play (the formation, fact sheet 1b, or the
                           defense's front, 1d / 1e), where he lines up;
     at[id] = ZONES name   his drop landmark (fact sheet 4); validate() requires it to BE his job in
                           the play's defense (5a), so a puzzle cannot teach a drop the library
                           does not give him.
   Positions are field yards (CS.compile's: a mirrored play mirrored, a ball on a hash shifted).

   Landmarks (what a drop snaps to, CS.snapTo, tolerance = tol): for zone targets the ZONES landmark
   of every zone named in `marks` (default: every zone); for 'align' targets the target and its
   mirror across the ball, so the magnet never tells him which side. A drop snaps only within tol of
   a landmark; elsewhere it lands where the finger put it.

   The answer: { id: {x, y} } for every mover, in `move` order. Right when every mover is within tol
   yards of his target (inclusive, CS.snapTo semantics) without crossing the line his target is on
   (onSpot below). Movers in one `swap` group may cover the group's targets in any order.

   Two right answers. Two movers the boy cannot tell apart on the field (the same name: two
   cornerbacks, two outside linebackers) could swap places and leave the same picture, so both
   orders would be right. validate() refuses such a pair unless the puzzle lists them in one `swap`
   group, and the checker then takes either order. Movers with different names (Sam / Will, H / Y)
   are not swappable: the fact sheet gives each his own spot. validate() also refuses a tolerance of
   half the gap between two landmarks or more (a drop could then be within tol of two of them), a
   start already within tol of a landmark (he would start right, or snapped), and a stored answer
   that is not truth(). */
(function (root) {
  'use strict';
  const CS = root.CS;
  const EPS = 1e-9;
  const PREFIX = 'pz-place~';
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const isPt = (p) => !!p && typeof p === 'object' && !Array.isArray(p) && isNum(p.x) && isNum(p.y);
  const OL_SWAP = { LT: 'RT', RT: 'LT', LG: 'RG', RG: 'LG' };

  function playOf(pz, lib) {
    const play = lib.PLAYS[pz.play];
    if (!play) throw new Error(`puzzle ${pz.id}: unknown play ${pz.play}`);
    return play;
  }
  // A player's name as the page says it (cs-ui's nameOf, pure): role name, else label, else id.
  function nameOf(c, id, lib) { const r = CS.roleOf(c, id); return (lib.ROLE_NAMES && lib.ROLE_NAMES[r]) || (lib.LABELS && lib.LABELS[id]) || id; }

  // Each mover's target in field yards: his alignment, or his zone's landmark (shifted with the
  // ball, as cs-core's compile does with it).
  function targets(pz, lib) {
    lib = lib || CS.lib;
    const c = CS.compile(playOf(pz, lib), lib), out = {};
    for (const id of pz.move || []) {
      const p = c.byId[id], a = (pz.at || {})[id];
      if (!p) throw new Error(`puzzle ${pz.id}: ${id} is not on the field`);
      if (a === 'align') out[id] = { x: p.x, y: p.y };
      else {
        const z = lib.ZONES[a];
        if (!z) throw new Error(`puzzle ${pz.id}: ${id} has no target (${a})`);
        out[id] = { x: z.x + c.dX, y: z.y };
      }
    }
    return out;
  }
  // The landmarks a drop snaps to, field yards, each named; no two the same point.
  function marksOf(pz, lib) {
    lib = lib || CS.lib;
    const c = CS.compile(playOf(pz, lib), lib), at = pz.at || {}, out = [];
    const add = (x, y, name) => { if (!out.some((m) => Math.abs(m.x - x) < 1e-6 && Math.abs(m.y - y) < 1e-6)) out.push({ x, y, name }); };
    if ((pz.move || []).some((id) => at[id] !== 'align')) {
      for (const name of pz.marks || Object.keys(lib.ZONES)) { const z = lib.ZONES[name]; if (z) add(z.x + c.dX, z.y, name); }
    }
    const tg = targets(pz, lib);
    for (const id of pz.move || []) if (at[id] === 'align') { add(tg[id].x, tg[id].y, id); add(2 * c.ballX - tg[id].x, tg[id].y, id + '~mirror'); }
    return out;
  }
  // Where a mover starts: `from`, else (a zone target) his own alignment, which is never his drop.
  function startOf(pz, id, lib) {
    lib = lib || CS.lib;
    if (pz.from && isPt(pz.from[id])) return { x: pz.from[id].x, y: pz.from[id].y };
    if ((pz.at || {})[id] === 'align') return null;
    const p = CS.compile(playOf(pz, lib), lib).byId[id];
    return p ? { x: p.x, y: p.y } : null;
  }
  const groupOf = (pz, id) => (pz.swap || []).find((g) => g.includes(id)) || [id];
  // Every ordering of a short list (swap groups are two or three men).
  function perms(a) { if (a.length <= 1) return [a.slice()]; const o = []; a.forEach((v, i) => { for (const r of perms(a.slice(0, i).concat(a.slice(i + 1)))) o.push([v].concat(r)); }); return o; }
  // Who is on a target: {id: true|false}. In a swap group the order that puts the most men within
  // tol of a target of the group wins (any order of the group is a right answer).
  // On a target: within tol (inclusive), and on the legal side of the line his target is on. An
  // offensive man stays behind the ball (y <= 0) and on the same side of the on-the-line cut as his
  // target (cs-core ON_LINE_Y; fact sheet 1b: on the line y 0, off it y -1, exactly 7 on it), so a
  // slot "a yard off" is never right while standing on the line, 0.5 yd away. A defender stays past
  // the neutral zone (CS.DEF_MIN_Y). The tolerance circle is cut by the line, never crosses it.
  function onSpot(a, t, team, tol) {
    if (!isPt(a) || dist(a, t) > tol + EPS) return false;
    if (team === 'off') return a.y <= 0 && (a.y >= CS.ON_LINE_Y) === (t.y >= CS.ON_LINE_Y);
    return a.y >= CS.DEF_MIN_Y;
  }
  function placed(pz, ans, lib) {
    lib = lib || CS.lib;
    const tg = targets(pz, lib), tol = pz.tol, out = {}, done = new Set(), c = CS.compile(playOf(pz, lib), lib);
    for (const id of pz.move) {
      if (done.has(id)) continue;
      const g = groupOf(pz, id);
      let best = null;
      for (const order of perms(g)) {
        const ok = g.map((m, i) => onSpot(ans && ans[m], tg[order[i]], c.byId[m].team, tol));
        const n = ok.filter(Boolean).length;
        if (!best || n > best.n) best = { n, ok };
      }
      g.forEach((m, i) => { out[m] = best.ok[i]; done.add(m); });
    }
    return out;
  }
  // A trap / landmark name -> a point: a mark's name, or a mover's id (his target).
  function pointOf(pz, v, lib) {
    if (isPt(v)) return { x: v.x, y: v.y };
    const m = marksOf(pz, lib).find((q) => q.name === v);
    return m ? { x: m.x, y: m.y } : null;
  }
  const ZONE_WORDS = { L: 'left', R: 'right', M: 'middle', LM: 'left-middle', RM: 'right-middle' };
  // 'deep-third-M' -> 'deep middle third', 'curl-flat-L' -> 'left curl-flat', 'hook-M' -> 'middle hook'.
  function zoneName(name) {
    const m = /^(.*)-(L|R|M|LM|RM)$/.exec(String(name));
    if (!m) return String(name);
    const side = ZONE_WORDS[m[2]], [a, b] = m[1].split('-');
    if (a === 'deep') return `deep ${side} ${b}`;
    if (a === 'hole') return `${side} hole`;
    return `${side} ${m[1]}`;
  }

  const T = {
    name: 'place',
    targets, marksOf, startOf, placed, onSpot, zoneName,
    // Right when the answer moves exactly the puzzle's men and each is within tol of his target
    // (a swap group's men of the group's targets, in any order).
    check(pz, ans, lib) {
      lib = lib || CS.lib;
      if (!ans || typeof ans !== 'object' || Array.isArray(ans)) return false;
      const keys = Object.keys(ans), move = pz.move || [];
      if (keys.length !== move.length || !move.every((id) => isPt(ans[id]))) return false;
      let p;
      try { p = placed(pz, ans, lib); } catch (e) { return false; }
      return move.every((id) => p[id] === true);
    },
    truth(pz, lib) {
      const tg = targets(pz, lib || CS.lib), out = {};
      for (const id of pz.move) out[id] = { x: tg[id].x, y: tg[id].y };
      return out;
    },
    // Wrong answers worth trying. The first is the one the page's "answer wrong" uses (the
    // puzzle's trap: the mistake it is written to catch).
    distractors(pz, lib) {
      lib = lib || CS.lib;
      const tr = T.truth(pz, lib), out = [], move = pz.move;
      if (pz.trap) { const a = JSON.parse(JSON.stringify(tr)); for (const [id, v] of Object.entries(pz.trap)) a[id] = pointOf(pz, v, lib); out.push(a); }
      // Nobody moved: every man still on his start.
      const st = {}; for (const id of move) st[id] = startOf(pz, id, lib); if (move.every((id) => st[id])) out.push(st);
      // Just outside the tolerance, straight downfield of the target.
      { const a = JSON.parse(JSON.stringify(tr)); a[move[0]] = { x: tr[move[0]].x, y: tr[move[0]].y + pz.tol + 0.05 }; out.push(a); }
      // Two men with different jobs on each other's spots.
      for (let i = 0; i < move.length; i++) for (let j = i + 1; j < move.length; j++) {
        if (groupOf(pz, move[i]).includes(move[j])) continue;
        const a = JSON.parse(JSON.stringify(tr)); a[move[i]] = tr[move[j]]; a[move[j]] = tr[move[i]]; out.push(a);
      }
      // One man missing; one man too many.
      { const a = JSON.parse(JSON.stringify(tr)); delete a[move[0]]; out.push(a); }
      { const c = CS.compile(playOf(pz, lib), lib), o = c.all.find((p) => !move.includes(p.id)); const a = JSON.parse(JSON.stringify(tr)); a[o.id] = { x: o.x, y: o.y }; out.push(a); }
      return out;
    },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const e = [], L = `puzzle ${pz.id}`;
      if (!lib.PLAYS[pz.play]) return [`${L}: unknown play ${pz.play}`];
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${L}: no prompt`);
      if (!pz.why || typeof pz.why !== 'string') e.push(`${L}: no why`);
      if (pz.answerName != null && (typeof pz.answerName !== 'string' || !pz.answerName.trim())) e.push(`${L}: answerName must be words`);
      const play = lib.PLAYS[pz.play], c = CS.compile(play, lib), move = pz.move, at = pz.at || {};
      if (!Array.isArray(move) || !move.length) return e.concat(`${L}: move lists nobody`);
      if (new Set(move).size !== move.length) e.push(`${L}: a man is listed twice in move`);
      for (const id of move) if (!c.byId[id]) return e.concat(`${L}: ${id} is not on the field`);
      if (Object.keys(at).length !== move.length || !move.every((id) => id in at)) e.push(`${L}: at must give a target for exactly the men in move`);
      for (const id of move) {
        const a = at[id], p = c.byId[id];
        if (a === 'align') continue;
        if (!lib.ZONES[a]) { e.push(`${L}: ${id}'s target ${a} is neither 'align' nor a zone`); continue; }
        if (p.team !== 'def' || p.src.zone !== a) e.push(`${L}: ${id}'s target is ${a}, but his job in ${play.defense} is ${p.src.zone || (p.src.man ? 'man on ' + p.src.man : p.src.rush ? 'a rush' : 'nothing')}`);
        if (pz.marks && !pz.marks.includes(a)) e.push(`${L}: ${id}'s landmark ${a} is not among the marks`);
      }
      if (pz.marks) for (const m of pz.marks) if (!lib.ZONES[m]) e.push(`${L}: unknown mark ${m}`);
      if (e.length) return e;
      if (!isNum(pz.tol) || !(pz.tol > 0) || pz.tol > 1.5) e.push(`${L}: tol ${pz.tol} must be a number of yards above 0 and at most 1.5`);
      if (!pz.tolWhy || typeof pz.tolWhy !== 'string') e.push(`${L}: tolWhy must say why the tolerance is what it is`);
      // Landmarks: a drop within tol of one must not be within tol of another.
      const ms = marksOf(pz, lib);
      for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
        const d = dist(ms[i], ms[j]);
        if (d <= 2 * pz.tol + EPS) e.push(`${L}: landmarks ${ms[i].name} and ${ms[j].name} are ${d.toFixed(2)} yd apart, so tol ${pz.tol} would let one drop count for both (needs under ${(d / 2).toFixed(2)})`);
      }
      // Swap groups: real movers, two or more, no man in two groups.
      const seen = new Set();
      for (const g of pz.swap || []) {
        if (!Array.isArray(g) || g.length < 2) { e.push(`${L}: a swap group needs two or more men`); continue; }
        for (const id of g) { if (!move.includes(id)) e.push(`${L}: swap names ${id}, who is not in move`); if (seen.has(id)) e.push(`${L}: ${id} is in two swap groups`); seen.add(id); }
      }
      // Two right answers: two men he cannot tell apart, not in one swap group.
      for (let i = 0; i < move.length; i++) for (let j = i + 1; j < move.length; j++) {
        const a = move[i], b = move[j], na = nameOf(c, a, lib), nb = nameOf(c, b, lib);
        if (na === nb && !groupOf(pz, a).includes(b)) e.push(`${L}: ${a} and ${b} are both "${na}" on the field: swapped, the picture is the same and both orders would be right. List them in one swap group (the checker then takes either order).`);
      }
      // Starts: on the field, on no landmark (never right before he moves), clear of everyone.
      const starts = {};
      for (const id of move) {
        const s = startOf(pz, id, lib);
        if (!s) { e.push(`${L}: ${id} needs a start in from (his target is his own alignment)`); continue; }
        starts[id] = s;
        if (!(s.x > 0 && s.x < CS.FIELD_W)) e.push(`${L}: ${id} starts out of bounds (x ${s.x})`);
        if (s.y < CS.VIEW.Y0 + 1 || s.y > CS.VIEW.Y1 - 1) e.push(`${L}: ${id} starts off the picture (y ${s.y})`);
        for (const m of ms) if (dist(s, m) <= pz.tol + EPS) e.push(`${L}: ${id} starts ${dist(s, m).toFixed(2)} yd from landmark ${m.name}, within tol: he would start snapped${m.name === at[id] || m.name === id ? ' and right' : ''}`);
      }
      const others = c.all.filter((p) => !move.includes(p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y })).concat(Object.entries(starts).map(([id, s]) => ({ id, ...s })));
      for (const [id, s] of Object.entries(starts)) for (const o of others) if (o.id !== id && dist(s, o) < CS.MIN_SPACING) e.push(`${L}: ${id}'s start is ${dist(s, o).toFixed(2)} yd from ${o.id} (min ${CS.MIN_SPACING})`);
      for (const tok of CS.toArr(pz.zoom)) if (!CS.focusOf(play, tok, -1.2)) e.push(`${L}: zoom token ${tok} is not on the field`);
      if (e.length) return e;
      const tr = T.truth(pz, lib);
      if (!T.check(pz, tr, lib)) e.push(`${L}: the library's own alignment fails the checker`);
      if (!('answer' in pz) || JSON.stringify(pz.answer) !== JSON.stringify(tr)) e.push(`${L}: the stored answer ${JSON.stringify(pz.answer)} is not the library's ${JSON.stringify(tr)}`);
      if (pz.trap) {
        const bad = Object.entries(pz.trap).filter(([id, v]) => !move.includes(id) || !pointOf(pz, v, lib));
        if (bad.length) e.push(`${L}: trap names ${bad.map(([id, v]) => id + ' -> ' + JSON.stringify(v)).join(', ')}, not a mover on a landmark`);
        else if (T.check(pz, T.distractors(pz, lib)[0], lib)) e.push(`${L}: the trap is a right answer`);
      }
      return e;
    },

    /* ── page side ── */
    mount(ctx) {
      const pz = ctx.pz, F = ctx.field, lib = ctx.lib, move = pz.move;
      const marks = marksOf(pz, lib), dropped = new Set();
      let d = null;
      const answer = () => { const p = d.positions, a = {}; for (const id of move) a[id] = { x: p[id].x, y: p[id].y }; return a; };
      // Lock it in is up from the start, so the button bar (and the field's size, which fits the
      // space left) never changes under his finger mid-puzzle. Pressed before every man has been
      // moved, it names who is left and costs no try.
      ctx.action('Lock it in', () => {
        if (!d) return;
        const left = move.filter((id) => !dropped.has(id));
        if (!left.length) { ctx.submit(answer()); return; }
        const parts = ['Move the '];
        left.forEach((id, i) => { if (i) parts.push(i === left.length - 1 ? ' and the ' : ', the '); parts.push({ tag: 'b', text: ctx.lc(ctx.nameOf(id)) }); });
        parts.push(' first.');
        ctx.say({ parts, focus: left, tone: 'note', spot: false });   // no zoom key: the camera stays where the puzzle put it (zoom: false would ease it out)
      });
      d = F.drag({
        handles: move.map((id) => ({ key: id, id })),
        snap: (pos) => CS.snapTo(pos, marks, pz.tol),
        onStart() { ctx.say(null); },
        onDrop(key) { dropped.add(key); },
      });
      for (const id of move) d.set(id, startOf(pz, id, lib));
      if (pz.zoom) F.zoomTo(pz.zoom);
      const end = () => { if (d) { d.destroy(); d = null; } };
      return {
        // First miss: the men off their spots ringed red and named; they stay where he put them, so
        // he fixes those and locks it in again.
        missed(ans) {
          const p = placed(pz, ans, lib), bad = move.filter((id) => !p[id]);
          ctx.field.setMarks(ctx.focusMarks.concat(bad.map((id) => ({ id, kind: 'bad' }))));
          const names = bad.map((id) => ({ tag: 'b', text: ctx.lc(ctx.nameOf(id)) }));
          const parts = ['Not yet. The '];
          names.forEach((n, i) => { if (i) parts.push(i === names.length - 1 ? ' and the ' : ', the '); parts.push(n); });
          parts.push(bad.length === 1 ? ' is not on his spot. One more try.' : ' are not on their spots. One more try.');
          ctx.say({ parts, focus: bad, tone: 'bad', spot: false });
          // The men he got wrong have to be moved again before the next Lock it in counts.
          for (const id of bad) dropped.delete(id);
        },
        // Over: the drag goes (the runs that follow line everyone up from the library).
        resolved({ ok }) { end(); return ok ? move.map((id) => ({ id, kind: 'good' })) : []; },
        destroy() { end(); },
      };
    },
    rightName(pz, ctx) {
      if (pz.answerName) return pz.answerName;
      const lib = ctx.lib, at = pz.at, c = CS.compile(ctx.play, lib);
      const nm = (id) => ctx.lc(ctx.nameOf(id));
      const zoneMen = pz.move.filter((id) => at[id] !== 'align'), alignMen = pz.move.filter((id) => at[id] === 'align');
      const join = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]);
      const parts = zoneMen.map((id) => `the ${nm(id)} to the ${zoneName(at[id])}`);
      if (alignMen.length) {
        const team = c.byId[alignMen[0]].team;
        const where = team === 'off' ? lib.FORMATIONS[ctx.play.formation].name.toLowerCase()
          : (lib.FRONTS && lib.FRONTS[c.defense.front] ? lib.FRONTS[c.defense.front].name : c.defense.name);
        parts.push(`the ${join(alignMen.map(nm))} where the ${where} lines ${alignMen.length > 1 ? 'them' : 'him'} up`);
      }
      const s = join(parts);
      return s.charAt(0).toUpperCase() + s.slice(1);
    },
    // The explanation points at the men he moved.
    lookOf(pz) { return pz.move.slice(); },
    // After the answer: right, the play runs with the movers' zone chalk; wrong, the play first
    // runs from where he put them (the library's formation / defense with his men moved, or his
    // man dropping to the zone whose landmark he chose), then from the right alignment.
    outcome(pz, ans, ok, ctx) {
      const lib = ctx.lib, play = ctx.play, move = pz.move, chalk = { zones: move.slice() };
      const good = move.map((id) => ({ id, kind: 'good' }));
      if (ok) return [{ play, chalk, marks: ctx.focusMarks.concat(good) }];
      const wrong = T.wrongPlay(pz, ans, lib);
      const p = placed(pz, ans, lib), bad = move.filter((id) => !p[id]);
      const badMarks = ctx.focusMarks.concat(bad.map((id) => ({ id, kind: 'bad' })));
      // The bubble opens with the answer (the explanation's own first words, which this run's
      // bubble replaces), then what his lineup costs.
      const say = { parts: [{ tag: 'b', text: 'The answer: ' + T.rightName(pz, ctx) + '.' }, ' '].concat(T.wrongWords(pz, ans, lib, wrong, ctx)), focus: bad, tone: 'bad', zoom: false };
      return [
        { play: wrong.play || play, say, chalk, marks: badMarks },
        { play, chalk, marks: ctx.focusMarks.concat(good) },
      ];
    },

    /* ── the wrong run (pure: the suite runs it in Node) ── The library cannot move a man in a
       variant (CS.variantOf merges assignments; alignments come from the formation and the
       defense), so the variant points at a copy of the play's formation or defense with his men
       moved, registered as `pz-place~<puzzle id>` (one per puzzle, replaced on every wrong answer;
       never a library id). A man on a zone target who was dropped on another zone's landmark keeps
       his alignment and drops to that zone instead; one dropped on no landmark stands where he was
       put. Returns { play, errors, moved: {id: what} }; play is null when the lineup is not legal
       (validatePlay / validateFormation), and the page then shows the right play with the bubble. */
    wrongPlay(pz, ans, lib) {
      lib = lib || CS.lib;
      const play = playOf(pz, lib), c = CS.compile(play, lib), p = placed(pz, ans, lib), id0 = PREFIX + pz.id;
      const mir = !!play.mirror, baseX = (x) => (mir ? CS.mirrorX(x - c.dX) : x - c.dX);
      const zoneMarks = marksOf(pz, lib).filter((m) => lib.ZONES[m.name]);
      const moved = {}, offSet = {}, defSet = {};
      for (const id of pz.move) {
        if (p[id]) continue;
        const a = ans[id], man = c.byId[id];
        const into = man.team === 'off' ? offSet : defSet;
        const bid = man.team === 'off' ? (mir && OL_SWAP[id]) || id : mir ? CS.swapLR(id) : id;
        if (pz.at[id] !== 'align') {
          const sn = CS.snapTo(a, zoneMarks, pz.tol);
          if (sn) { into[bid] = { zone: mir ? CS.swapLR(sn.name) : sn.name }; moved[id] = { zone: sn.name }; continue; }
          into[bid] = { x: baseX(a.x), y: a.y, still: true }; moved[id] = { at: { x: a.x, y: a.y } };
        } else { into[bid] = { x: baseX(a.x), y: a.y }; moved[id] = { at: { x: a.x, y: a.y } }; }
      }
      const copy = (set, base) => {
        const o = JSON.parse(JSON.stringify(base));
        o.id = id0; delete o.mirrored;
        o.players = o.players.map((q) => {
          const s = set[q.id];
          if (!s) return q;
          const r = { ...q };
          if (s.zone) { r.zone = s.zone; delete r.man; delete r.rush; }
          if (isNum(s.x)) { r.x = s.x; r.y = s.y; delete r.dx; if (r.on != null) r.on = s.y >= CS.ON_LINE_Y; }
          if (s.still) { delete r.zone; delete r.man; delete r.rush; delete r.read; }
          return r;
        });
        return o;
      };
      const errors = [], o = { tag: 'wrong' };
      if (Object.keys(offSet).length) {
        const f = copy(offSet, lib.FORMATIONS[play.formation]);
        errors.push(...CS.validateFormation(f));
        lib.FORMATIONS[id0] = f; o.formation = id0;
      }
      if (Object.keys(defSet).length) {
        const d = copy(defSet, lib.DEFENSES[play.defense]);
        errors.push(...CS.validateDefense(d, lib).filter((m) => !/has no assignment/.test(m)));
        lib.DEFENSES[id0] = d; o.defense = id0;
      }
      if (!o.formation && !o.defense) return { play: null, errors: ['nobody to move'], moved };
      const v = CS.variantOf(play, o);
      errors.push(...CS.validatePlay(v, lib));
      return { play: errors.length ? null : v, errors, moved };
    },
    // The wrong run's bubble: who is off his spot, what that costs (an empty zone), or the
    // puzzle's own fact-sheet line for the man (whyAt).
    wrongWords(pz, ans, lib, wrong, ctx) {
      const c = CS.compile(playOf(pz, lib), lib), p = placed(pz, ans, lib);
      const nm = (id) => (ctx ? ctx.lc(ctx.nameOf(id)) : nameOf(c, id, lib).toLowerCase());
      const parts = [];
      const bad = pz.move.filter((id) => !p[id]);
      for (const id of bad) {
        const m = wrong.moved[id] || {};
        if (m.zone) parts.push('The ', { tag: 'b', text: nm(id) }, ` drops to the ${zoneName(m.zone)}. `);
        else if (pz.at[id] !== 'align') parts.push('The ', { tag: 'b', text: nm(id) }, ' stands on no landmark. ');
        else parts.push('The ', { tag: 'b', text: nm(id) }, ' is off his spot. ');
        if (pz.whyAt && pz.whyAt[id]) parts.push(pz.whyAt[id] + ' ');
      }
      // Zones nobody covers: a target zone with no mover's drop within tol of its landmark.
      const tg = targets(pz, lib), open = [];
      for (const id of pz.move) if (pz.at[id] !== 'align' && !pz.move.some((m) => onSpot(ans[m], tg[id], 'def', pz.tol))) open.push(pz.at[id]);
      for (const z of open) parts.push(`Nobody has the ${zoneName(z)}. `);
      if (!wrong.play) parts.push('So the play runs from the right spots.');
      const last = parts.length - 1;
      if (typeof parts[last] === 'string') parts[last] = parts[last].trimEnd();
      return parts;
    },
  };

  /* ── fixture puzzles (Content): on library plays, truth from the library ── */
  T.examples = [
    {
      id: 'pz-place-c3-deep', type: 'place', play: 'four-verts-vs-c3',
      prompt: 'Cover 3: drag the two cornerbacks and the free safety to the spots they drop to.',
      move: ['CB-L', 'CB-R', 'FS'],
      at: { 'CB-L': 'deep-third-L', 'CB-R': 'deep-third-R', FS: 'deep-third-M' },
      // The two corners look the same on the field: either one may take either outside third.
      swap: [['CB-L', 'CB-R']],
      marks: ['deep-third-L', 'deep-third-M', 'deep-third-R', 'deep-half-L', 'deep-half-R', 'deep-quarter-L', 'deep-quarter-LM', 'deep-quarter-RM', 'deep-quarter-R'],
      tol: 1,
      tolWhy: 'Fact sheet 4: defenders aim at landmarks, not exact yards. The closest two deep landmarks offered (a third and the quarter beside it) are 2.83 yd apart, so a 1 yd circle round each touches no other.',
      trap: { FS: 'deep-half-R' },
      answerName: 'Each corner to the deep third on his side, the free safety to the deep middle third',
      tags: ['cov:3', 'zone:deep-third'],
      why: 'Cover 3 is three deep thirds: each corner takes the outside third on his side and the free safety takes the deep middle third.',
      answer: { 'CB-L': { x: 9, y: 16 }, 'CB-R': { x: 44.33, y: 16 }, FS: { x: 26.67, y: 16 } },
    },
    {
      id: 'pz-place-43-lb', type: 'place', play: 'smash-vs-c2',
      prompt: '4-3 Over: drag the Sam, the Mike and the Will to where they line up.',
      move: ['SAM', 'MIKE', 'WILL'],
      at: { SAM: 'align', MIKE: 'align', WILL: 'align' },
      // A neutral row behind the linebackers, in the wrong order (Sam on the weak side).
      from: { SAM: { x: 22.67, y: 8.5 }, MIKE: { x: 26.67, y: 8.5 }, WILL: { x: 30.67, y: 8.5 } },
      tol: 0.7,
      tolWhy: "The Mike's spot and the Will's spot mirrored across the ball (fact sheet 1d) are 1.5 yd apart, so the circles must stay under 0.75 yd; 0.7 leaves 0.1 yd of grass between them.",
      zoom: ['DE-L', 'DE-R', 'FS', 'SS'],
      whyAt: {
        SAM: 'In Coach School the Sam is the strong-side linebacker, to the tight end.',
        MIKE: 'The Mike is the middle linebacker.',
        WILL: 'The Will is the weak-side linebacker.',
      },
      trap: { MIKE: 'WILL', WILL: 'MIKE' },
      tags: ['front:43-over', 'pos:lb'],
      why: 'In Coach School the Sam lines up on the strong side, toward the tight end, the Mike in the middle and the Will on the weak side.',
      answer: { SAM: { x: 32.67, y: 4.5 }, MIKE: { x: 27.67, y: 4.5 }, WILL: { x: 24.17, y: 4.5 } },
    },
    {
      id: 'pz-place-trips', type: 'place', play: 'stick-vs-c3',
      prompt: 'This is 2x2. Drag the slot (H) and the tight end (Y) to make trips right.',
      move: ['H', 'Y'],
      at: { H: 'align', Y: 'align' },
      // Their shotgun 2x2 spots (fact sheet 1b): the picture the puzzle starts from.
      from: { H: { x: 15, y: -1 }, Y: { x: 38.33, y: -1 } },
      tol: 1,
      tolWhy: 'The two trips spots are 5 yd apart and their mirrors as far again, so 1 yd (the default) is well under half the gap; the 2x2 starts are 1.33 yd from the nearest landmark, outside it.',
      whyAt: {
        H: 'In trips right the slot (H) is #2, between Z and the tight end.',
        Y: 'In trips right the tight end (Y) is #3, the inside man.',
      },
      trap: { H: 'Y', Y: 'H' },
      tags: ['formation:trips', 'rank:2'],
      why: 'Trips is three receivers to one side. Counting from the outside in, Z is #1, H is #2 and the tight end is #3, a yard off the line.',
      answer: { H: { x: 39.67, y: -1 }, Y: { x: 34.67, y: -1 } },
    },
  ];

  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.place = T;
})(typeof window !== 'undefined' ? window : globalThis);
