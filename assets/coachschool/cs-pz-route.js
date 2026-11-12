/* Coach School puzzle type: ROUTE. "Give the slot receiver a route that beats this Cover 2."
   He taps the receiver on the field, picks a route from the panel (tree routes, each with a small
   chalk glyph drawn the way it runs on this field), sees it chalked from the man through the
   camera, and locks it in. Pure half loads in the page and in a Node vm (the suite).

   puzzle: { id, type:'route', play, receiver, offer:[route names], side?, accept?, routes?, zones?,
             prompt, tags, why, answer }
     receiver  the man the question is about (his id on the play)
     offer     the routes on the chips, ROUTES names (the doc's draft called this `routes`; renamed
               because cs-ui reads a puzzle's `routes` as its route-chalk flag)
     routes    the chalk flag, as everywhere: the OTHER receivers whose routes are part of the
               question (a combo's #2 when the question is his #1). Never the receiver himself:
               his own route on the play would give the answer away before he picks.
     side      'L' | 'R': the Cover 2 side, which a puzzle MUST name when a Cover 6 "side" row of
               ROUTE_BEATS applies to any offered route (its prompt must say "the Cover 2 side" too)
     accept    when more than one offered route is right, every one of them, listed: then each is
               accepted; without it, two right routes are an authoring error
   answer: { id, route }  the receiver he tapped and the route he picked.

   Truth is CS.lib.ROUTE_BEATS (fact sheet 6) and nothing else: a route is right when a single-route
   row names it against the play's coverage, or a combo row names it for his number (#1 outermost
   on his side) while the play already runs the rest of that combo. CONTESTED / POOR pairings never
   make a route right, and validate() refuses a puzzle that would grade one wrong either. A go by
   an inside receiver (#2 or #3) is the seam (fact sheet 3: "vertical by an inside receiver"), same
   waypoints, so it is judged as one. */
(function (root) {
  'use strict';
  const CS = root.CS;
  const NOT_RECV = ['QB', 'RB', 'FB'];

  const covOf = (play, lib) => (lib.DEFENSES[play.defense] || {}).coverage || null;
  // #1, #2, #3 from the outside on each side (fact sheet 6), over the eligible men who are not backs.
  function numbering(c) {
    const out = {};
    for (const side of ['L', 'R']) {
      c.off.filter((p) => p.side === side && !NOT_RECV.includes(p.pos) && CS.isEligible(c, p.id))
        .sort((a, b) => (side === 'L' ? a.x - b.x : b.x - a.x))
        .forEach((p, i) => { out[p.id] = { side, n: i + 1 }; });
    }
    return out;
  }
  const keyFits = (k, num, p) => (k === '#3/RB' ? (num && num.n === 3) || ['RB', 'FB'].includes(p.pos) : !!num && k === '#' + num.n);
  // Fact sheet 3: the seam is the vertical of an inside receiver; the waypoints are the go's.
  const asRun = (route, num) => (route === 'go' && num && num.n > 1 ? 'seam' : route);
  // The Cover 2 side of the defense on the field: where a deep-half safety plays (Cover 6, 5a).
  function cover2Side(c) {
    const s = c.def.find((p) => /^deep-half-(L|R)$/.test(p.src.zone || ''));
    return s ? s.src.zone.slice(-1) : null;
  }
  // The rows that make `route` right for the receiver, ignoring `side` when told to.
  function rowsFor(pz, route, lib, ignoreSide) {
    const play = lib.PLAYS[pz.play], c = CS.compile(play, lib), cov = covOf(play, lib), me = c.byId[pz.receiver];
    if (!me || !cov) return [];
    const nums = numbering(c), num = nums[me.id], eff = asRun(route, num), c2 = cover2Side(c);
    const runOf = (p) => { const a = (play.assign || {})[p.id] || {}; return a.route ? asRun(a.route, nums[p.id]) : null; };
    return (lib.ROUTE_BEATS || []).filter((row) => {
      if (row.cov !== cov) return false;
      if (row.side && !ignoreSide && c2 !== me.side) return false;
      if (row.route) return row.route === eff;
      const mine = Object.keys(row.routes).find((k) => keyFits(k, num, me) && row.routes[k].includes(eff));
      if (!mine) return false;
      // The rest of the combo must already be on the play, on his side (a back counts anywhere).
      return Object.keys(row.routes).filter((k) => k !== mine).every((k) => c.off.some((p) => p.id !== me.id
        && (p.side === me.side || (k === '#3/RB' && ['RB', 'FB'].includes(p.pos)))
        && keyFits(k, nums[p.id], p) && row.routes[k].includes(runOf(p))));
    });
  }
  const isRight = (pz, route, lib) => rowsFor(pz, route, lib, false).length > 0;
  const rightOf = (pz, lib) => (pz.offer || []).filter((r) => lib.ROUTES[r] && isRight(pz, r, lib));
  const titleOf = (r, lib) => String((lib.ROUTES[r] || {}).name || r).replace(/\s*\(.*\)\s*$/, '');

  /* ── the runs after an answer (pure, so the suite can hold them to the fact sheet) ── */
  // The ball comes out once the QB has finished his drop (a 3-step from the gun is 2 yd back at
  // 4 yd/s, cs-core) and the receiver is at his break, or 12 yd up a straight stem; it travels at
  // about 30 yd/s, the library plays' own pace (smash: 2.4 to 3.3 on a corner from the gun).
  const ON_BALL = 1.5;
  const R1 = (v) => Math.ceil(v * 10 - 1e-9) / 10;
  function timedRun(play, id, route, tag, lib, failing) {
    const base = CS.variantOf(play, { tag, assign: { [id]: { ...(play.assign || {})[id], route } } });
    const c = CS.compile(base, lib), p = c.byId[id], pts = p.path.pts;
    const leg = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    const drop = ((play.assign || {}).QB || {}).drop, back = drop === 5 ? 3.5 : drop === 7 ? 5 : 2;
    const thr = R1(Math.max(back / 4, Math.min(leg, 12) / p.path.v + p.path.delay));
    let cat = R1(thr + 0.4);
    for (let k = 0; k < 4; k++) {
      const v = CS.variantOf(base, { tag, ball: [{ t: 0, ev: 'snap' }, { t: thr, ev: 'throw', to: id }, { t: cat, ev: 'catch' }] });
      const q = CS.poseAt(v, thr, lib).players.QB, r = CS.poseAt(v, cat, lib).players[id];
      cat = R1(thr + Math.max(0.4, Math.hypot(q.x - r.x, q.y - r.y) / 30));
    }
    const o = { tag, assign: { [id]: base.assign[id] }, ball: [{ t: 0, ev: 'snap' }, { t: thr, ev: 'throw', to: id }, { t: cat, ev: 'catch' }] };
    // A covered ball ends where it arrives: no run after the catch is shown for a throw into a defender.
    if (failing) Object.assign(o, { rac: 0, T: R1(cat + 0.5) });
    return CS.variantOf(play, o);
  }
  // Who is on the ball where it arrives, and the job the coverage gives him (fact sheet 5a).
  function ownerAt(run, lib) {
    const c = CS.compile(run, lib), s = CS.poseAt(run, c.catchT, lib), r = s.players[c.target];
    const ds = c.def.filter((p) => p.src.zone != null || p.src.man != null).map((p) => ({ id: p.id, p, d: Math.hypot(s.players[p.id].x - r.x, s.players[p.id].y - r.y) })).sort((a, b) => a.d - b.d);
    return ds[0];
  }
  const ZONE_WORDS = [[/^curl-flat/, 'the curl, then the flat'], [/^hook-curl/, 'the hook, then the curl'], [/^hook-M$/, 'the middle hook'],
    [/^hole-M$/, 'the deep middle hole'], [/^hook/, 'the hook'], [/^curl/, 'the curl'], [/^flat/, 'the flat'], [/^deep-third-M$/, 'the deep middle third'],
    [/^deep-third/, 'a deep third'], [/^deep-half/, 'a deep half'], [/^deep-quarter/, 'a deep quarter']];
  function jobWords(p) {
    if (p.src.man) return `is in man coverage on the ${p.src.man}`;
    const z = ZONE_WORDS.find(([re]) => re.test(p.src.zone || ''));
    return z ? `has ${z[1]}` : null;
  }
  const nameIn = (c, id, lib) => lib.ROLE_NAMES[CS.roleOf(c, id)] || lib.LABELS[id] || id;
  const lower = (s) => (/^([A-Z] |Sam |Mike |Will )/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  // The right version: the puzzle's own play when it already throws that route to him, else the
  // same play with his route and the ball to him.
  function rightRun(pz, lib) {
    const play = lib.PLAYS[pz.play], tr = T.truth(pz, lib), a = (play.assign || {})[tr.id] || {}, c = CS.compile(play, lib);
    if (a.route === tr.route && c.target === tr.id) return play;
    return timedRun(play, tr.id, tr.route, 'route-right', lib, false);
  }
  // [{ play, say?, marks?, chalk? }]: right = the right route once; wrong = his route thrown into
  // the man who owns that spot, then the right route.
  function runs(pz, ans, ok, lib, name) {
    lib = lib || CS.lib;
    const play = lib.PLAYS[pz.play], chalkIds = [pz.receiver].concat(Array.isArray(pz.routes) ? pz.routes : []);
    const right = { play: rightRun(pz, lib), marks: [{ id: pz.receiver, kind: 'good' }], chalk: { routes: chalkIds } };
    if (ok || !ans || !lib.ROUTES[ans.route] || !CS.compile(play, lib).byId[ans.id] || CS.compile(play, lib).byId[ans.id].team !== 'off') return [right];
    const bad = timedRun(play, ans.id, ans.route, 'route-wrong', lib, true), own = ownerAt(bad, lib), c = CS.compile(bad, lib);
    const cov = (lib.COVERAGES[covOf(play, lib)] || {}).name || 'This coverage', job = jobWords(own.p);
    const nm = (id) => (name ? name(id, bad) : nameIn(c, id, lib));
    // Said only as far as the run shows it: "on the ball" when he is within ON_BALL yards at the
    // catch; a throw to the wrong man says so instead of inventing a defender's play.
    // The bubble of this run replaces cs-ui's explanation while it shows, so it opens with the
    // answer the way the explanation does ("The answer: ...").
    const on = own.d <= ON_BALL, tr = T.truth(pz, lib);
    const head = { tag: 'b', text: `The answer: ${tr ? titleOf(tr.route, lib) : '?'} for the ${lower(nm(pz.receiver))}.` };
    const say = ans.id !== pz.receiver
      ? { parts: [head, ` This throw went to the ${lower(nm(ans.id))}: the wrong man.`], focus: [ans.id], tone: 'bad', zoom: false }
      : { parts: [head, ` His ${titleOf(ans.route, lib).toLowerCase()} is ${on ? 'covered' : 'no good'}. ${cov}: the `, { tag: 'b', text: lower(nm(own.id)) },
        job ? ` ${job}${on ? ', and he is on the ball.' : '.'}` : (on ? ' is on the ball.' : ' is there.')], focus: [own.id], tone: 'bad', zoom: false };
    const marks = [{ id: ans.id === pz.receiver ? own.id : ans.id, kind: 'bad' }];
    return [{ play: bad, say, marks, chalk: { routes: [ans.id] }, owner: own.id, ownerD: own.d }, right];
  }

  const T = {
    name: 'route',
    numbering, cover2Side, rowsFor, rightOf, runs, titleOf, ON_BALL,
    // Right when he picked this puzzle's receiver and an offered route that ROUTE_BEATS says beats
    // the coverage on the field (combo rows only with the rest of the combo on the play).
    check(pz, ans, lib) {
      lib = lib || CS.lib;
      if (!ans || typeof ans !== 'object' || ans.id !== pz.receiver || !(pz.offer || []).includes(ans.route)) return false;
      if (!lib.PLAYS[pz.play] || !lib.ROUTES[ans.route]) return false;
      return isRight(pz, ans.route, lib);
    },
    // The right route, in answer shape: the one right offered route (with `accept`, the stored
    // answer's route when it is one of them, else the first in offer order).
    truth(pz, lib) {
      lib = lib || CS.lib;
      if (!lib.PLAYS[pz.play]) return null;
      const r = rightOf(pz, lib);
      if (!r.length) return null;
      const pick = r.length > 1 && pz.answer && r.includes(pz.answer.route) ? pz.answer.route : r[0];
      return { id: pz.receiver, route: pick };
    },
    // Every offered route that does not beat it, on the right man; then the right route on the
    // wrong man (the question is about one receiver).
    distractors(pz, lib) {
      lib = lib || CS.lib;
      const out = (pz.offer || []).filter((r) => !isRight(pz, r, lib)).map((route) => ({ id: pz.receiver, route }));
      const tr = T.truth(pz, lib), play = lib.PLAYS[pz.play];
      if (tr && play) {
        const c = CS.compile(play, lib), other = c.off.find((p) => p.id !== pz.receiver && !NOT_RECV.includes(p.pos) && CS.isEligible(c, p.id));
        if (other) out.push({ id: other.id, route: tr.route });
      }
      return out;
    },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const e = [], L = `puzzle ${pz && pz.id}`;
      const play = lib.PLAYS[pz.play];
      if (!play) return [`${L}: unknown play ${pz.play}`];
      let c;
      try { c = CS.compile(play, lib); } catch (err) { return [`${L}: ${err.message}`]; }
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${L}: no prompt`);
      const cov = covOf(play, lib);
      if (!cov) e.push(`${L}: the play's defense names no coverage`);
      const me = c.byId[pz.receiver];
      if (!me || me.team !== 'off' || NOT_RECV.includes(me.pos) || !CS.isEligible(c, pz.receiver)) return e.concat(`${L}: ${pz.receiver} is not a receiver on this play`);
      const offer = pz.offer || [];
      if (offer.length < 2 || offer.length > 6) e.push(`${L}: ${offer.length} routes offered (2-6)`);
      if (new Set(offer).size !== offer.length) e.push(`${L}: a route is offered twice`);
      for (const r of offer) if (!lib.ROUTES[r]) e.push(`${L}: unknown route ${r}`);
      if (e.length) return e;
      // Chalk: never on the receiver himself before he picks (it would draw the play's own route).
      if (pz.routes === true || (Array.isArray(pz.routes) && pz.routes.includes(pz.receiver))) e.push(`${L}: route chalk on ${pz.receiver} gives his route away; chalk only the other receivers the question needs`);
      // Cover 6 "side" rows: the puzzle must name the side, by letter and in its prompt, and it must
      // be the side the defense on the field plays Cover 2 to.
      const sideRows = offer.flatMap((r) => rowsFor(pz, r, lib, true).filter((row) => row.side));
      if (sideRows.length) {
        const phrase = sideRows[0].side, c2 = cover2Side(c);
        if (!['L', 'R'].includes(pz.side)) e.push(`${L}: a "${phrase}" row of ROUTE_BEATS applies, so the puzzle must name the side (side: 'L' | 'R')`);
        else if (pz.side !== c2) e.push(`${L}: names side ${pz.side}, but this defense plays Cover 2 to the ${c2}`);
        if (!new RegExp(phrase.replace(/^the /, ''), 'i').test(pz.prompt || '')) e.push(`${L}: a "${phrase}" row applies, so the prompt must say "${phrase}"`);
      }
      // A contested (or poor) pairing is never a graded wrong answer: an offered route that would
      // complete such a combo against this coverage is refused.
      const contested = { ...(lib.CONTESTED || {}) };
      for (const [k, v] of Object.entries(lib.POOR || {})) contested[k] = { covs: [...((contested[k] || {}).covs || []), ...v.covs] };
      for (const r of offer) {
        for (const [concept, x] of Object.entries(contested)) {
          if (!x.covs.includes(cov)) continue;
          const combos = (lib.ROUTE_BEATS || []).filter((row) => row.concept === concept);
          const fake = { ...lib, ROUTE_BEATS: combos.map((row) => ({ ...row, cov, side: null })) };
          if (combos.length && rowsFor(pz, r, fake, true).length) e.push(`${L}: ${r} completes ${concept.replace('concept:', '')}, which the sheet calls contested against ${cov.replace('cov:', 'Cover ')}: neither right nor wrong`);
        }
      }
      const right = rightOf(pz, lib);
      if (!right.length) e.push(`${L}: no offered route beats ${cov} (ROUTE_BEATS)`);
      if (right.length > 1) {
        const acc = Array.isArray(pz.accept) ? pz.accept.slice().sort().join() : null;
        if (acc !== right.slice().sort().join()) e.push(`${L}: ${right.join(' and ')} both beat ${cov}: two right answers (list every one in accept, or offer one)`);
      }
      const tr = T.truth(pz, lib);
      if (tr && JSON.stringify(pz.answer) !== JSON.stringify(tr)) e.push(`${L}: the right answer is ${JSON.stringify(tr)} but the stored answer is ${JSON.stringify(pz.answer)}`);
      for (const run of tr ? runs(pz, null, true, lib).concat(T.distractors(pz, lib).slice(0, 1).flatMap((d) => runs(pz, d, false, lib))) : []) {
        const pe = CS.validatePlay(run.play, lib);
        if (pe.length) e.push(`${L}: outcome run ${run.play.id}: ${pe[0]}`);
      }
      return e;
    },
  };

  /* ── fixture puzzles (on library plays; every value traces to fact sheet 6) ── */
  T.examples = [
    // Smash vs Cover 2 (6): "#1 hitch (5-6), #2 corner (break 10-12)"; basic beaters: "Corner | Cover 2".
    // X (#1, left) already runs the hitch; the slot (#2) needs the corner. Post and seam also beat
    // Cover 2, so neither is offered; the go is the slot's seam, so it is not offered either.
    { id: 'pz-route-smash-c2', type: 'route', play: 'smash-vs-c2', receiver: 'H', offer: ['out', 'corner', 'dig', 'flat'], zones: true,
      prompt: 'Cover 2. Tap the slot receiver, then pick the route that beats it.',
      tags: ['route:corner', 'cov:2'], answer: { id: 'H', route: 'corner' },
      why: 'The corner route goes to the hole behind the squatting corner and outside the half safety.' },
    // Hitch vs Cover 3 (6): "Hitch | Cover 3 (off corners)": "deep-third corners bail; the hitch sits
    // in front of them". The slant and the curl are left out: with Y on the flat they would be
    // slant-flat and curl-flat, also right against Cover 3. The go is left out too: it is caught past
    // the 19.6 yd the field shows, so its failure would play out off the screen.
    { id: 'pz-route-hitch-c3', type: 'route', play: 'slant-flat-vs-c3', receiver: 'Z', offer: ['comeback', 'hitch', 'dig', 'post'], zones: true,
      prompt: 'Cover 3. Tap the Z receiver, then pick the route that beats it.',
      tags: ['route:hitch', 'cov:3'], answer: { id: 'Z', route: 'hitch' },
      why: 'Deep-third corners bail, and the hitch sits in front of them.' },
  ];

  /* ── page side ── */
  const CSS_ID = 'cs-pz-route-css';
  if (root.document && !root.document.getElementById(CSS_ID)) {
    const st = root.document.createElement('style');
    st.id = CSS_ID;
    // The glyph is the button's ::before (a CSS image), so a chip is one element with its name as
    // its text: nothing inside it a finger could take for a separate, smaller control.
    st.textContent = '#stOpts button.rt { display:flex; align-items:center; gap:8px; justify-content:flex-start; text-align:left; }'
      + '#stOpts button.rt::before { content:""; flex:0 0 auto; width:26px; height:26px; background:var(--glyph) center / contain no-repeat; }'
      + '#stOpts button.rt[aria-pressed="true"] { border-color:#ffe14d; background:#2a2406; color:#ffe14d; }'
      + '#stOpts button.rt[aria-pressed="true"]::before { background-image:var(--glyph-on); }';
    root.document.head.appendChild(st);
  }
  // A route's glyph: its waypoints for this receiver, through the field's own camera mapping, so
  // it bends the way the chalk will on screen. An SVG data URL, in chalk white or picked yellow.
  function glyph(ctx, route, colour) {
    const F = ctx.field;
    const pts = CS.routeWaypoints(ctx.play, ctx.pz.receiver, route).map((q) => F.yardToScreen(q[0], q[1]));
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), k = 20 / Math.max(1e-6, Math.max(...xs) - x0, Math.max(...ys) - y0);
    const ox = 3 + (20 - (Math.max(...xs) - x0) * k) / 2, oy = 3 + (20 - (Math.max(...ys) - y0) * k) / 2;
    const P = pts.map((p) => [(ox + (p.x - x0) * k).toFixed(1), (oy + (p.y - y0) * k).toFixed(1)]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 26 26"><polyline points="${P.map((q) => q.join(',')).join(' ')}" fill="none" stroke="${colour}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${P[0][0]}" cy="${P[0][1]}" r="2.4" fill="${colour}"/></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  T.mount = function (ctx) {
    const op = ctx.panel, pz = ctx.pz, lib = ctx.lib, F = ctx.field, c = CS.compile(ctx.play, lib);
    const sel = { id: null, route: null };
    let preview = null;
    const isRecv = (id) => { const p = c.byId[id]; return !!p && p.team === 'off' && !NOT_RECV.includes(p.pos) && CS.isEligible(c, id); };
    const marks = () => F.setMarks(ctx.focusMarks.concat(sel.id ? [{ id: sel.id, kind: 'focus' }] : []));
    const draw = () => {
      if (preview) { preview.remove(); preview = null; }
      if (sel.id && sel.route) preview = F.overlay.path({ pts: CS.routeWaypoints(ctx.play, sel.id, sel.route, lib), anchor: sel.id, tone: 'focus', dashed: true, arrow: true });
    };
    const btns = [];
    for (const r of pz.offer) {
      const b = ctx.doc.createElement('button');
      b.type = 'button'; b.className = 'rt'; b.dataset.route = r; b.setAttribute('aria-pressed', 'false');
      b.textContent = titleOf(r, lib);
      b.style.setProperty('--glyph', glyph(ctx, r, '#f4f1e6')); b.style.setProperty('--glyph-on', glyph(ctx, r, '#ffe14d'));
      b.addEventListener('click', () => {
        if (ctx.done) return;
        sel.route = sel.route === r ? null : r;
        for (const x of btns) x.setAttribute('aria-pressed', String(x.dataset.route === sel.route));
        draw();
      });
      op.appendChild(b); btns.push(b);
    }
    op.hidden = false;
    ctx.action('Lock it in', () => {
      if (!sel.id || !sel.route) { ctx.feedback('bad', [!sel.id ? 'Tap the receiver on the field first.' : 'Pick a route for him.']); return; }
      ctx.submit({ id: sel.id, route: sel.route });
    });
    return {
      // A tap on a receiver picks him; anyone else gets a word, not a try.
      onTap(id) {
        if (ctx.done) return;
        if (!id || !isRecv(id)) { ctx.feedback('bad', ['Tap a receiver.']); return; }
        ctx.feedback(null);
        sel.id = id; marks(); draw();
      },
      // First miss: his route goes red and out; the wrong man (if that was it) is let go.
      missed(ans) {
        const b = btns.find((x) => x.dataset.route === ans.route);
        if (ans.id === pz.receiver && b) { b.classList.add('bad'); b.disabled = true; }
        if (ans.id !== pz.receiver) sel.id = null;
        sel.route = null;
        for (const x of btns) x.setAttribute('aria-pressed', 'false');
        draw(); marks();
        ctx.feedback('bad', ans.id === pz.receiver
          ? [{ tag: 'b', text: titleOf(ans.route, lib) }, ` does not beat ${(lib.COVERAGES[covOf(ctx.play, lib)] || {}).name || 'it'}. One more try.`]
          : ['That is the ', { tag: 'b', text: ctx.lc(ctx.nameOf(ans.id)) }, '. One more try.']);
      },
      resolved({ ok, picked }) {
        const tr = T.truth(pz, lib);
        for (const b of btns) {
          b.disabled = true; b.setAttribute('aria-pressed', 'false');
          if (tr && b.dataset.route === tr.route) b.classList.add('good');
          else if (!ok && picked && picked.id === pz.receiver && b.dataset.route === picked.route) b.classList.add('bad');
        }
        if (preview) { preview.remove(); preview = null; }
        const m = [{ id: pz.receiver, kind: 'good' }];
        if (!ok && picked && picked.id && picked.id !== pz.receiver) m.push({ id: picked.id, kind: 'bad' });
        return m;
      },
      destroy() {
        if (preview) { preview.remove(); preview = null; }
        op.textContent = ''; op.hidden = true; btns.length = 0;
      },
    };
  };
  T.rightName = (pz, ctx) => { const tr = T.truth(pz, ctx.lib); return `${titleOf(tr.route, ctx.lib)} for the ${ctx.lc(ctx.nameOf(tr.id))}`; };
  T.lookOf = (pz) => [pz.receiver];
  T.outcome = (pz, ans, ok, ctx) => runs(pz, ans, ok, ctx.lib, (id, play) => ctx.nameOf(id, play)).map(({ owner, ownerD, ...r }) => r);

  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.route = T;
})(typeof window !== 'undefined' ? window : globalThis);
