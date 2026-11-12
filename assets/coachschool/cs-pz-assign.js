/* Coach School puzzle type: ASSIGN. "Connect each blocker to his man (or his gap)." Pure half
   loads in the page and in a Node vm (the suite); registers into CS.puzzleTypes.assign.

   puzzle: { id, type:'assign', play, rule, blockers:[ids], targets:[gap names | defender ids],
             slide?:'L'|'R', prompt, tags, why, answer, routes?, zones? }
   answer: { <blocker id>: <target> } — every blocker exactly one target, no target twice.

   The judge never reads a stored map. It applies the RULE of the puzzle to the play on the field,
   so it accepts every assignment the rule allows; validate() then enumerates every one-to-one
   assignment of the blockers onto the targets and insists the rule leaves exactly one standing
   (two would be two right answers), and that it is the stored answer.

   rules (fact sheet sections in brackets):
     slide  pass protection, slide [rank 3 "Pass protection"]: "the line slides one direction, each
            lineman taking a gap rather than a man; the back takes the first threat away from the
            slide". A lineman's gap is the next gap on the slide side of where he stands (CS.gapsOf,
            section 8); a back takes the gap of a rusher (the play's own rush lanes) that the
            line's gaps leave open, on the side away from the slide. Every rusher's gap covered.
     man    pass protection, man / BOB [rank 3; 9 "Blitz pickup by count"]: every rusher blocked
            once, nobody counted twice, nobody blocking a man who drops into coverage; big on big
            (every down lineman blocked by an offensive lineman), backs on backers (a back never
            takes a down lineman); and the linemen's blocks never cross (left to right along the
            line, their men come in the same left-to-right order, by the gap each one rushes).
            The no-crossing part is the fact sheet's "Man protection in order" line (rank 3, "Pass
            protection", docs/coachschool-facts.md line 164: a CS teaching convention, the dad's
            decision 2026-11-12); it is what makes the count rule pick one assignment (without it
            any shuffle of the same five men passes).
     fit    run fit, one-gap front [rank 4 "One-gap vs two-gap", "Run fits"; 8 techniques]: a one-gap
            lineman "attacks and owns one gap", the one his shade puts him in (a 1 is in the A gap,
            a 3 in the B gap, a 5 outside the tackle). A head-up man (0, 2, 4, 6) is a two-gap
            player and owns no single gap: validate() refuses a puzzle that asks it.

   The runs after the answer (2026-11-12, cs-core pass protection: {on} blocks, {then:'QB'}, the
   sack): the right run has every blocker meet the rusher his job gives him, and they hold. A wrong
   answer first plays his protection: each blocker meets the rusher his answer gives him, every
   rusher nobody meets keeps coming to the quarterback, and the first to get there sacks him (the
   time measured on the run); his connectors are drawn in red where they break the rule, a red
   chalk arrow runs from each free rusher's gap to the quarterback, and the clip frames the rusher
   and the quarterback with its bubble off them. Then the right version. Engine limits still: no
   run play and no gap fit against a ball carrier, so a run fit plays the snap and the linemen
   firing into their gaps, a stepped illustration; an empty gap gets a red arrow through it from
   the back. */
(function (root) {
  'use strict';
  const CS = root.CS;
  const L = CS.lib;
  const GAP_RE = /^([ABCD])-gap-([LR])$/;
  const isGap = (t) => typeof t === 'string' && GAP_RE.test(t);
  const BACKS = ['RB', 'FB'];
  const gapWords = (g) => { const m = GAP_RE.exec(g); return m ? `${m[2] === 'L' ? 'left' : 'right'} ${m[1]} gap` : String(g); };
  const RULES = ['slide', 'man', 'fit'];

  /* ── the rule, applied to the play ── */
  // Everything the rule needs from the play, worked out once per question.
  function ruleOf(pz, lib) {
    lib = lib || CS.lib;
    const play = lib.PLAYS[pz.play];
    if (!play) throw new Error(`puzzle ${pz.id}: unknown play ${pz.play}`);
    const c = CS.compile(play, lib), gaps = CS.gapsOf(c);
    // The rushers and the gap each one rushes (the defense's own rush lanes, mirrored with the play).
    const rushers = c.def.filter((p) => p.role === 'rush').map((p) => ({ id: p.id, pos: p.pos, x: p.x, gap: p.src.rush, gx: gaps[p.src.rush] }));
    const rush = {};
    for (const r of rushers) rush[r.id] = r;
    const ol = c.off.filter((p) => CS.OL.includes(p.pos)).sort((a, b) => a.x - b.x);
    const gapList = Object.entries(gaps).sort((a, b) => a[1] - b[1]);
    const R = { pz, play, c, gaps, rushers, rush, ol, rule: pz.rule, allowed: {} };
    if (pz.rule === 'slide') {
      // Each lineman: the next gap on the slide side of where he stands.
      const s = pz.slide === 'R' ? 1 : -1;
      const slideGap = (x) => { const cand = gapList.filter(([, gx]) => s * (gx - x) > 1e-9); return cand.length ? (s < 0 ? cand[cand.length - 1][0] : cand[0][0]) : null; };
      const lineGaps = new Set(ol.map((p) => slideGap(p.x)));
      // A back: a rushed gap the line leaves open, away from the slide (beyond the backside of the line).
      const open = rushers.filter((r) => !lineGaps.has(r.gap) && r.gx != null && -s * (r.gx - c.ballX) > 0).map((r) => r.gap);
      for (const id of pz.blockers || []) {
        const p = c.byId[id];
        if (!p) continue;
        if (CS.OL.includes(p.pos)) R.allowed[id] = new Set([slideGap(p.x)]);
        else if (BACKS.includes(p.pos)) R.allowed[id] = new Set(open);
        else R.allowed[id] = new Set();
      }
      R.open = open;
    }
    if (pz.rule === 'fit') {
      // The gap a one-gap lineman's shade puts him in: the nearest man on the offensive line, then
      // the nearest gap on the side of him he is shaded to. Head-up (within a tenth of a yard) = none.
      const line = c.off.filter((p) => p.y >= CS.ON_LINE_Y && (CS.OL.includes(p.pos) || p.pos === 'TE'));
      R.shade = {};
      for (const id of pz.blockers || []) {
        const p = c.byId[id];
        if (!p || !line.length) { R.allowed[id] = new Set(); continue; }
        const b = line.slice().sort((u, v) => Math.abs(u.x - p.x) - Math.abs(v.x - p.x))[0], off = p.x - b.x;
        if (Math.abs(off) < 0.1) { R.shade[id] = { headUp: b.id }; R.allowed[id] = new Set(); continue; }
        const s = Math.sign(off), cand = gapList.filter(([, gx]) => s * (gx - b.x) > 1e-9).sort((u, v) => Math.abs(u[1] - b.x) - Math.abs(v[1] - b.x));
        R.shade[id] = { over: b.id, gap: cand.length ? cand[0][0] : null };
        R.allowed[id] = new Set(cand.length ? [cand[0][0]] : []);
      }
    }
    return R;
  }
  // The verdict on one answer, with the reasons (the page shows them; check() wants only ok).
  function judge(R, ans) {
    const pz = R.pz, bl = pz.blockers || [], tg = pz.targets || [];
    const v = { ok: false, incomplete: [], extra: [], doubled: [], misfit: [], free: [], crossed: [], droppers: [], empty: [] };
    if (!ans || typeof ans !== 'object' || Array.isArray(ans)) { v.incomplete = bl.slice(); return v; }
    for (const k of Object.keys(ans)) if (!bl.includes(k)) v.extra.push(k);
    for (const b of bl) if (typeof ans[b] !== 'string' || !tg.includes(ans[b])) v.incomplete.push(b);
    const by = {};
    for (const b of bl) if (!v.incomplete.includes(b)) (by[ans[b]] = by[ans[b]] || []).push(b);
    for (const [t, bs] of Object.entries(by)) if (bs.length > 1) v.doubled.push(t);
    const taken = new Set(Object.keys(by));
    if (R.rule === 'slide') {
      for (const b of bl) if (!v.incomplete.includes(b) && !(R.allowed[b] && R.allowed[b].has(ans[b]))) v.misfit.push(b);
      v.free = R.rushers.filter((r) => !taken.has(r.gap)).map((r) => r.id);
    } else if (R.rule === 'man') {
      const posOf = (id) => (R.c.byId[id] || {}).pos;
      for (const b of bl) {
        if (v.incomplete.includes(b)) continue;
        const t = ans[b], r = R.rush[t];
        if (!r) { v.misfit.push(b); if (R.c.byId[t]) v.droppers.push(t); continue; }
        const isDL = CS.DL.includes(r.pos), bOL = CS.OL.includes(posOf(b));
        if (isDL && !bOL) v.misfit.push(b);                       // big on big: the down linemen are the linemen's
        if (BACKS.includes(posOf(b)) && isDL) { if (!v.misfit.includes(b)) v.misfit.push(b); }
      }
      v.free = R.rushers.filter((r) => !taken.has(r.id)).map((r) => r.id);
      // The linemen's blocks keep their order along the line.
      const key = (r) => [r.gx == null ? r.x : r.gx, r.x];
      const ln = bl.filter((b) => !v.incomplete.includes(b) && CS.OL.includes(posOf(b)) && R.rush[ans[b]])
        .map((b) => ({ b, x: R.c.byId[b].x, k: key(R.rush[ans[b]]) })).sort((a, b) => a.x - b.x);
      for (let i = 1; i < ln.length; i++) {
        const a = ln[i - 1].k, z = ln[i].k;
        if (!(z[0] > a[0] + 1e-9 || (Math.abs(z[0] - a[0]) <= 1e-9 && z[1] > a[1] + 1e-9))) v.crossed.push([ln[i - 1].b, ln[i].b]);
      }
    } else if (R.rule === 'fit') {
      for (const b of bl) if (!v.incomplete.includes(b) && !(R.allowed[b] && R.allowed[b].has(ans[b]))) v.misfit.push(b);
      const owned = new Set();
      for (const b of bl) for (const g of R.allowed[b] || []) owned.add(g);
      v.empty = [...owned].filter((g) => !taken.has(g)).sort();
    } else { v.misfit = bl.slice(); }
    v.ok = !v.incomplete.length && !v.extra.length && !v.doubled.length && !v.misfit.length && !v.free.length && !v.crossed.length && !v.empty.length;
    return v;
  }
  // Every one-to-one assignment of the blockers onto the targets that the rule passes (up to `cap`),
  // and how many there are.
  function solutions(R, cap) {
    const bl = R.pz.blockers || [], tg = R.pz.targets || [], out = [];
    let n = 0;
    const cur = {}, used = new Set();
    (function walk(i) {
      if (i === bl.length) { if (judge(R, cur).ok) { n++; if (out.length < (cap || 3)) out.push({ ...cur }); } return; }
      for (const t of tg) {
        if (used.has(t)) continue;
        cur[bl[i]] = t; used.add(t);
        walk(i + 1);
        used.delete(t); delete cur[bl[i]];
      }
    })(0);
    return { n, list: out };
  }
  const sameAns = (a, b) => { if (!a || !b) return false; const ka = Object.keys(a).sort(), kb = Object.keys(b).sort(); return JSON.stringify(ka) === JSON.stringify(kb) && ka.every((k) => a[k] === b[k]); };

  const T = {
    name: 'assign',
    ruleOf,
    judge: (pz, ans, lib) => judge(ruleOf(pz, lib || CS.lib), ans),
    solutions: (pz, lib, cap) => solutions(ruleOf(pz, lib || CS.lib), cap),
    // Right when the rule passes his assignment on this play.
    check(pz, ans, lib) {
      try { return judge(ruleOf(pz, lib || CS.lib), ans).ok; } catch (err) { return false; }
    },
    // The one assignment the rule leaves standing (null when it leaves none or several; validate says which).
    truth(pz, lib) {
      const s = solutions(ruleOf(pz, lib || CS.lib), 2);
      if (s.n !== 1) return null;
      const t = {};
      for (const b of pz.blockers) t[b] = s.list[0][b];
      return t;
    },
    // A missed man, a man counted twice, two men swapped; each one must fail.
    distractors(pz, lib) {
      lib = lib || CS.lib;
      const t = T.truth(pz, lib), bl = pz.blockers || [], tg = pz.targets || [], out = [];
      if (!t) return [{}];
      const spare = tg.filter((x) => !Object.values(t).includes(x));
      if (spare.length) out.push({ ...t, [bl[bl.length - 1]]: spare[0] });              // one man on nobody's man: someone free
      if (bl.length > 1) out.push({ ...t, [bl[1]]: t[bl[0]] });                            // two on one
      if (bl.length > 1) out.push({ ...t, [bl[0]]: t[bl[1]], [bl[1]]: t[bl[0]] });         // two swapped
      out.push({});                                                                        // nothing connected
      return out.filter((a) => !T.check(pz, a, lib));
    },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const e = [], Lb = `puzzle ${pz.id}`;
      if (!lib.PLAYS[pz.play]) return [`${Lb}: unknown play ${pz.play}`];
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${Lb}: no prompt`);
      if (!RULES.includes(pz.rule)) return e.concat(`${Lb}: unknown rule ${pz.rule} (${RULES.join(', ')})`);
      const bl = pz.blockers || [], tg = pz.targets || [];
      if (!Array.isArray(bl) || !bl.length) e.push(`${Lb}: no blockers`);
      if (!Array.isArray(tg) || tg.length < bl.length) e.push(`${Lb}: fewer targets than blockers`);
      if (new Set(bl).size !== bl.length) e.push(`${Lb}: a blocker listed twice`);
      if (new Set(tg).size !== tg.length) e.push(`${Lb}: a target listed twice`);
      let R;
      try { R = ruleOf(pz, lib); } catch (err) { return e.concat(`${Lb}: ${err.message}`); }
      const c = R.c;
      for (const b of bl) if (!c.byId[b]) e.push(`${Lb}: blocker ${b} is not on the field`);
      for (const t of tg) {
        if (isGap(t)) { if (R.gaps[t] == null) e.push(`${Lb}: target ${t} is not a gap on this line`); }
        else if (!c.byId[t] || c.byId[t].team !== 'def') e.push(`${Lb}: target ${t} is not a defender on the field`);
      }
      if (pz.rule === 'slide') {
        if (!['L', 'R'].includes(pz.slide)) e.push(`${Lb}: a slide needs slide:'L'|'R'`);
        for (const b of bl) if (c.byId[b] && !CS.OL.includes(c.byId[b].pos) && !BACKS.includes(c.byId[b].pos)) e.push(`${Lb}: ${b} is neither a lineman nor a back`);
        if (bl.length && tg.some((t) => !isGap(t))) e.push(`${Lb}: a slide's targets are gaps`);
        const backs = bl.filter((b) => c.byId[b] && BACKS.includes(c.byId[b].pos));
        if (backs.length && R.open.length !== backs.length) e.push(`${Lb}: ${R.open.length} rushers the slide leaves open for ${backs.length} back(s): the back has no single first threat`);
      }
      if (pz.rule === 'man') {
        for (const b of bl) if (c.byId[b] && !CS.OL.includes(c.byId[b].pos) && !BACKS.includes(c.byId[b].pos) && c.byId[b].pos !== 'TE') e.push(`${Lb}: ${b} is not a blocker`);
        if (R.rushers.length !== bl.length) e.push(`${Lb}: ${bl.length} blockers for ${R.rushers.length} rushers: man protection is one rusher each, so the answer is not one-to-one`);
        for (const r of R.rushers) if (!tg.includes(r.id)) e.push(`${Lb}: rusher ${r.id} is not a target`);
      }
      if (pz.rule === 'fit') {
        for (const b of bl) {
          const p = c.byId[b];
          if (!p) continue;
          if (!CS.DL.includes(p.pos)) e.push(`${Lb}: ${b} is not a defensive lineman`);
          if (R.shade[b] && R.shade[b].headUp) e.push(`${Lb}: ${b} is head-up on ${R.shade[b].headUp}: a two-gap player owns no single gap`);
        }
        if (bl.length && tg.some((t) => !isGap(t))) e.push(`${Lb}: a run fit's targets are gaps`);
      }
      if (e.length) return e;
      const s = solutions(R, 3);
      if (s.n === 0) e.push(`${Lb}: no assignment passes the ${pz.rule} rule`);
      if (s.n > 1) e.push(`${Lb}: ${s.n} assignments pass the ${pz.rule} rule (${s.list.slice(0, 2).map((a) => JSON.stringify(a)).join(' and ')}): two right answers`);
      if (s.n === 1) {
        const want = s.list[0];
        if (Object.values(want).length !== new Set(Object.values(want)).size) e.push(`${Lb}: the rule's answer is not one-to-one`);
        if (!sameAns(want, pz.answer)) e.push(`${Lb}: the rule gives ${JSON.stringify(want)} but the stored answer is ${JSON.stringify(pz.answer)}`);
      }
      return e;
    },
  };

  /* ── examples (fact-sheet plays from the library; one registered variant) ── */
  // Fire zone (fact sheet 9: "5 (often a LB and/or DB...)", the library's fz-nickel: the Mike is the
  // fifth rusher) against the quick slant-flat from the 2x2, the back out on a route, so five
  // linemen for five rushers. A puzzle diagram: no callouts.
  const FZ = 'pz-assign-fz-slant-flat';
  if (L.PLAYS['slant-flat-vs-c3'] && !L.PLAYS[FZ]) {
    const p = CS.variantOf(L.PLAYS['slant-flat-vs-c3'], { tag: 'fz', defense: 'fz-nickel', name: 'Slant-flat vs fire zone', teams: { off: 'TEN', def: 'HOU' }, tags: ['concept:slant-flat', 'pressure:fire-zone'], src: '9', routes: false, zones: false, assign: { RB: { route: 'flat' } } });
    p.id = FZ;
    delete p.callouts; delete p.concept; delete p.beats;
    L.PLAYS[FZ] = p;
  }
  const OL5 = ['LT', 'LG', 'C', 'RG', 'RT'];
  const ALL_GAPS = ['D-gap-L', 'C-gap-L', 'B-gap-L', 'A-gap-L', 'A-gap-R', 'B-gap-R', 'C-gap-R', 'D-gap-R'];
  T.examples = [
    { id: 'pz-assign-slide', type: 'assign', rule: 'slide', slide: 'L', play: 'four-verts-vs-c3',
      blockers: [...OL5, 'RB'], targets: ALL_GAPS,
      prompt: 'Slide protection, sliding left. Connect each blocker to the gap he takes: tap a blocker, then a gap letter.',
      // By hand (fact sheet 1a line, 8 gaps; c3-nickel rush lanes): the next gap to each man's left;
      // the four rush C-L, A-L, B-R, C-R, so the slide leaves C-gap-R open, away from the slide: the back's.
      answer: { LT: 'C-gap-L', LG: 'B-gap-L', C: 'A-gap-L', RG: 'A-gap-R', RT: 'B-gap-R', RB: 'C-gap-R' },
      tags: ['protect:slide'], why: 'In a slide the line slides one way, each lineman taking a gap rather than a man. The back takes the first threat away from the slide: the end rushing outside the right tackle.' },
    { id: 'pz-assign-fz-man', type: 'assign', rule: 'man', play: FZ,
      blockers: OL5, targets: ['DE-L', 'DT-L', 'MIKE', 'DT-R', 'DE-R', 'WILL', 'NB'],
      prompt: 'Fire zone: five rush. Man protection: connect each lineman to the man he blocks.',
      // By hand: rushers in the order of the gaps they rush, left to right: DE-L C-L, DT-L A-L,
      // MIKE A-R, DT-R B-R, DE-R C-R; the five linemen take them in the same order. Will and nickel drop.
      answer: { LT: 'DE-L', LG: 'DT-L', C: 'MIKE', RG: 'DT-R', RT: 'DE-R' },
      tags: ['protect:man', 'pressure:fire-zone'], why: 'Five rush and five block: one rusher each, nobody counted twice. In order along the line, the center picks up the blitzing Mike; the Will and the nickel drop.' },
    { id: 'pz-assign-fit', type: 'assign', rule: 'fit', play: 'smash-vs-c2',
      blockers: ['DE-L', 'DT-L', 'DT-R', 'DE-R'], targets: ALL_GAPS,
      prompt: 'One-gap front: connect each defensive lineman to the gap he owns.',
      // By hand (1c, 4-3 Over): DE-L 5 tech (23.17, outside the LT at 23.67) -> left C; DT-L 1 tech
      // (26.17, the center's left shade) -> left A; DT-R 3 tech (28.67, outside the RG) -> right B;
      // DE-R 5 tech (30.17, outside the RT) -> right C.
      answer: { 'DE-L': 'C-gap-L', 'DT-L': 'A-gap-L', 'DT-R': 'B-gap-R', 'DE-R': 'C-gap-R' },
      tags: ['run-fit:one-gap'], why: 'In a one-gap front each lineman attacks and owns one gap, the one his shade puts him in: a 1 technique is in the A gap, a 3 in the B gap, a 5 outside the tackle in the C gap.' },
  ];

  /* ── the runs after the answer ── */
  const PASS = (side) => (side ? { pass: 'slide-' + side } : { pass: 'set' });
  // Pass protection (2026-11-12): each blocker meets the rusher his answer gives him ({on}: cs-core
  // walks him to that man's gap and the two hold where they meet). Under a slide that is the rusher
  // in the gap he takes; in man protection the man he was connected to (a dropper is nobody's: he
  // just sets). The right run: every rusher met. The wrong run: the ones nobody meets keep coming
  // ({then: 'QB'}), and the first to reach the quarterback sacks him (the time measured on the run:
  // the first frame within CS.SACK_REACH + 0.05 yd), the clip ending a second later.
  function runPlays(pz, play, ans, ok, lib) {
    lib = lib || CS.lib;
    const c = CS.compile(play, lib), R = ruleOf(pz, lib);
    const rusherOf = (t) => (isGap(t) ? (R.rushers.find((r) => r.gap === t) || {}).id : R.rush[t] ? t : null) || null;
    const assignOf = (a) => {
      const o = {};
      if (pz.rule === 'fit') return o;
      for (const id of pz.blockers) {
        const p = c.byId[id], t = a ? a[id] : null, on = t != null ? rusherOf(t) : null;
        if (!p) continue;
        const base = CS.OL.includes(p.pos) ? (pz.rule === 'slide' ? PASS(pz.slide) : PASS(null)) : pz.rule === 'slide' && isGap(t) ? { block: t } : PASS(null);
        o[id] = on ? { ...base, on } : base;
      }
      return o;
    };
    const fit = pz.rule === 'fit';
    const right = CS.variantOf(play, { tag: 'assign-right', assign: assignOf(T.truth(pz, lib)), ...(fit ? { ball: [{ t: 0, ev: 'snap' }], T: 1.2 } : {}) });
    if (ok) return { right };
    if (fit) return { right, bad: CS.variantOf(play, { tag: 'assign-wrong', assign: {}, ball: [{ t: 0, ev: 'snap' }], T: 1.2 }) };
    // Wrong: his blocks; every rusher left free keeps coming; no throw.
    const A = assignOf(ans), met = new Set(Object.values(A).map((a) => a.on).filter(Boolean));
    const free = R.rushers.map((r) => r.id).filter((id) => !met.has(id));
    for (const id of free) A[id] = { then: 'QB' };
    const snap = [{ t: 0, ev: 'snap' }];
    let bad = CS.variantOf(play, { tag: 'assign-wrong', assign: A, ball: snap, T: 6 });
    if (free.length) {
      let hit = null;
      for (let t = 0; t <= 6 + 1e-9 && !hit; t += 0.02) {
        const P = CS.poseAt(bad, t, lib).players, q = P[c.qb.id];
        for (const id of free) if (Math.hypot(P[id].x - q.x, P[id].y - q.y) <= CS.SACK_REACH + 0.05) { hit = { t: Math.round(t * 100) / 100, by: id }; break; }
      }
      if (hit) bad = CS.variantOf(play, { tag: 'assign-wrong', assign: A, ball: snap.concat({ t: hit.t, ev: 'sack', by: hit.by }) });
      else bad = CS.variantOf(play, { tag: 'assign-wrong', assign: A, ball: snap, T: 2.4 });
    } else bad = CS.variantOf(play, { tag: 'assign-wrong', assign: A, ball: snap, T: 1.6 });
    return { right, bad };
  }
  T.runs = runPlays;

  /* ── page side ── */
  const STATE = typeof WeakMap === 'function' ? new WeakMap() : null;
  function failureText(ctx, v) {
    const nm = (id) => ctx.lc(ctx.nameOf(id)), pz = ctx.pz, R = ruleOf(pz, ctx.lib);
    if (v.free.length) {
      const r = R.rush[v.free[0]];
      return { parts: ['Nobody blocks the ', { tag: 'b', text: nm(r.id) }, `. He comes free through the ${gapWords(r.gap)} at the quarterback.`], focus: [r.id] };
    }
    if (v.empty.length) return { parts: ['Nobody is in the ', { tag: 'b', text: gapWords(v.empty[0]) }, '. Every gap needs a defender.'], focus: v.misfit.length ? [v.misfit[0]] : ['dl'] };
    if (v.doubled.length) return { parts: ['Two men on the same job: ', { tag: 'b', text: isGap(v.doubled[0]) ? gapWords(v.doubled[0]) : nm(v.doubled[0]) }, '.'], focus: isGap(v.doubled[0]) ? ['ol'] : [v.doubled[0]] };
    if (v.crossed.length) { const [a, b] = v.crossed[0]; return { parts: ['The ', { tag: 'b', text: nm(a) }, ' and the ', { tag: 'b', text: nm(b) }, ' cross. Big on big: each lineman takes the man on his own side.'], focus: [a, b] }; }
    if (v.droppers.length) return { parts: ['The ', { tag: 'b', text: nm(v.droppers[0]) }, ' drops into coverage. Block the men who rush.'], focus: [v.droppers[0]] };
    if (v.misfit.length) {
      const b = v.misfit[0];
      const rule = pz.rule === 'slide' ? `In a slide every lineman takes the gap to his ${pz.slide === 'L' ? 'left' : 'right'}.` : pz.rule === 'man' ? 'Big on big: linemen on the down linemen, backs on backers.' : 'A one-gap lineman owns the gap he is shaded into.';
      return { parts: ['The ', { tag: 'b', text: nm(b) }, ' is on the wrong job. ' + rule], focus: [b] };
    }
    return { parts: ['Connect every blocker first.'], focus: [] };
  }

  T.mount = function mount(ctx) {
    const F = ctx.field, pz = ctx.pz, doc = ctx.doc;
    const S = { links: {}, ov: {}, extra: [], raf: 0, runs: null, view: null, locked: false, dead: false };
    if (STATE) STATE.set(ctx, S);
    const gapNames = pz.targets.filter(isGap);
    const gapOv = gapNames.length ? F.overlay.gaps({ names: gapNames }) : null;
    // Frame the blockers and their targets so a 44 px handle never covers the next man's gap letter.
    const zoomIds = [...pz.blockers, ...pz.targets.filter((t) => !isGap(t))];
    F.zoomTo(gapNames.length ? zoomIds.concat('ol') : zoomIds);

    // Targets as landmarks in yards, at the point drawn for them this frame (a sprite's painted
    // centre, a gap letter where it is drawn): the connector ends where the finger let go.
    function landmarks() {
      const out = [], gl = F.overlays.gaps;
      for (const t of pz.targets) {
        let cl = null;
        if (isGap(t)) { const g = gl.find((q) => q.name === t); if (g) cl = { x: g.x, y: g.y }; }
        else { const r = F.spriteRect(t); if (r) cl = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }
        if (cl) { const y = F.screenToYard(cl.x, cl.y); out.push({ x: y.x, y: y.y, name: t }); }
      }
      return out;
    }
    // 26 CSS px of finger slop, in yards at the camera of the moment.
    function tol() {
      const a = F.yardToScreen(0, 0), b = F.yardToScreen(1, 0), c = F.yardToScreen(0, 1);
      const ppy = Math.min(Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)) || 1;
      return 26 / ppy;
    }
    const snap = (pos) => CS.snapTo(pos, landmarks(), tol());
    function drawLinks(map, toneOf) {
      for (const k of Object.keys(S.ov)) { S.ov[k].remove(); delete S.ov[k]; }
      for (const [b, t] of Object.entries(map)) S.ov[b] = F.overlay.link({ from: b, to: t, tone: toneOf ? toneOf(b, t) : 'focus', arrow: true });
    }
    function clearExtra() { for (const h of S.extra) h.remove(); S.extra = []; }
    const complete = () => pz.blockers.every((b) => S.links[b]);
    const status = doc.createElement('button');
    status.type = 'button'; status.textContent = 'Start over'; status.dataset.assign = 'clear';
    const onClear = () => { if (S.locked) return; S.links = {}; drawLinks(S.links); };
    status.addEventListener('click', onClear);
    ctx.panel.appendChild(status);
    ctx.panel.hidden = false;
    function connect(b, t) {
      if (S.locked) return;
      if (t == null) delete S.links[b]; else S.links[b] = t;      // reassigning replaces; a drop on nothing lets go
      drawLinks(S.links);
    }
    const drag = F.drag({
      handles: pz.blockers.map((id) => ({ key: id, id })),
      moves: false,
      snap: (pos) => snap(pos),
      onDrop: (key, pos, sn) => connect(key, sn && sn.name != null ? sn.name : null),
    });
    S.drag = drag;
    ctx.action('Check', () => {
      if (S.locked) return;
      if (!complete()) { const n = pz.blockers.filter((b) => !S.links[b]).length; ctx.feedback('bad', [`Connect every blocker first: ${n} to go.`]); return; }
      ctx.submit({ ...S.links });
    });

    // After the answer: the connectors follow the run on the field (his, in red where they break the
    // rule, during the failure; the right ones, in green, during the right run). cs-ui plays the runs;
    // this watches which one is up.
    function show(which) {
      if (S.view === which) return;
      S.view = which;
      clearExtra();
      const t = T.truth(pz, ctx.lib);
      if (which === 'bad') {
        const v = judge(ruleOf(pz, ctx.lib), S.picked), wrong = new Set([...v.misfit, ...v.crossed.flat()]);
        for (const tg of v.doubled) for (const [b, x] of Object.entries(S.picked)) if (x === tg) wrong.add(b);
        drawLinks(S.picked, (b) => (wrong.has(b) ? 'bad' : 'chalk'));
        // Each free rusher: a red arrow from his gap to the quarterback (he gets home).
        const R = ruleOf(pz, ctx.lib), bad = S.runs && S.runs.bad;
        if (bad) {
          const q = CS.poseAt(bad, CS.compile(bad).T).players.QB;
          for (const id of v.free) {
            const r = R.rush[id], gx = r && r.gx;
            if (gx != null && q) S.extra.push(F.overlay.path({ pts: [[gx, 0], [q.x, q.y + 0.6]], tone: 'bad', dashed: true, arrow: true }));
          }
          // An empty gap: the lane a back would run through it.
          const back = R.c.off.find((p) => BACKS.includes(p.pos));
          for (const g of v.empty) if (back) S.extra.push(F.overlay.path({ pts: [[back.x, back.y], [R.gaps[g], 0], [R.gaps[g], 5]], tone: 'bad', dashed: true, arrow: true }));
        }
      } else if (t) drawLinks(t, () => 'good');
    }
    function watch() {
      if (S.dead) return;
      const p = F.play;
      if (S.runs) show(S.runs.bad && p === S.runs.bad ? 'bad' : 'right');
      S.raf = (root.requestAnimationFrame || ((f) => root.setTimeout(f, 50)))(watch);
    }

    return {
      onTap(id) {
        if (S.locked) return;
        if (id && pz.targets.includes(id)) ctx.feedback(null, ['Tap one of your blockers first (the ringed men), then his man.']);
      },
      // First miss: his connectors stay up, the ones that break the rule in red; the rusher he left
      // free ringed; the reason in the panel. He fixes it and checks again.
      missed(ans) {
        const v = judge(ruleOf(pz, ctx.lib), ans), wrong = new Set([...v.misfit, ...v.crossed.flat()]);
        for (const tg of v.doubled) for (const [b, x] of Object.entries(ans)) if (x === tg) wrong.add(b);
        drawLinks(S.links, (b) => (wrong.has(b) ? 'bad' : 'focus'));
        ctx.field.setMarks(ctx.focusMarks.concat(v.free.map((id) => ({ id, kind: 'bad' }))));
        const f = failureText(ctx, v);
        ctx.feedback('bad', f.parts.concat(' One more try.'));
      },
      // Over: the controls lock (the handles go); the connectors then follow the runs.
      resolved({ ok, picked }) {
        S.locked = true; S.picked = picked && typeof picked === 'object' ? picked : {};
        status.disabled = true;
        if (S.drag) { S.drag.destroy(); S.drag = null; }
        if (!S.runs) S.runs = runPlays(pz, ctx.play, S.picked, ok, ctx.lib);
        show(ok ? 'right' : 'bad');
        watch();
        const v = judge(ruleOf(pz, ctx.lib), S.picked);
        return ok ? [] : v.free.map((id) => ({ id, kind: 'bad' }));
      },
      destroy() {
        S.dead = true;
        if (S.raf) (root.cancelAnimationFrame || root.clearTimeout)(S.raf);
        S.raf = 0;
        if (S.drag) { S.drag.destroy(); S.drag = null; }
        for (const k of Object.keys(S.ov)) S.ov[k].remove();
        S.ov = {};
        clearExtra();
        if (gapOv) gapOv.remove();
        status.removeEventListener('click', onClear);
        ctx.panel.textContent = ''; ctx.panel.hidden = true;
        ctx.action(null);
      },
    };
  };
  // The right answer in words.
  T.rightName = function rightName(pz, ctx) {
    const t = T.truth(pz, ctx.lib);
    if (!t) return '';
    const nm = (id) => ctx.lc(ctx.nameOf(id)), tw = (x) => (isGap(x) ? gapWords(x) : nm(x));
    if (pz.rule === 'slide') {
      const backs = pz.blockers.filter((b) => !OL5.includes(b) && CS.compile(ctx.play).byId[b] && BACKS.includes(CS.compile(ctx.play).byId[b].pos));
      return `every lineman takes the gap to his ${pz.slide === 'L' ? 'left' : 'right'}, and the ${backs.map((b) => `${nm(b)} takes the ${tw(t[b])}`).join(', ')}`;
    }
    if (pz.rule === 'man') {
      // Name the pickups that are not big on big; the rest take the down linemen in order.
      const c = CS.compile(ctx.play), odd = pz.blockers.filter((b) => c.byId[t[b]] && !CS.DL.includes(c.byId[t[b]].pos));
      const dl = pz.blockers.length - odd.length;
      return odd.map((b) => `the ${nm(b)} takes the ${tw(t[b])}`).join(', ') + (dl ? `, and the other ${dl === 1 ? 'lineman takes the down lineman' : `linemen take the ${['', 'one', 'two', 'three', 'four', 'five'][dl] || dl} down linemen`} in order along the line` : '');
    }
    return pz.blockers.map((b) => `${nm(b)} on the ${tw(t[b])}`).join(', ');
  };
  // The explanation points at the man the puzzle turns on: the back and the rusher he picks up
  // (slide), the blitzer and his blocker (man), the defensive line (fit).
  T.lookOf = function lookOf(pz, ctx) {
    const t = T.truth(pz, ctx.lib);
    if (!t) return null;
    const c = CS.compile(ctx.play);
    if (pz.rule === 'fit') return ['dl'];
    if (pz.rule === 'man') {
      const b = pz.blockers.find((x) => c.byId[t[x]] && !CS.DL.includes(c.byId[t[x]].pos));
      return b ? [b, t[b]] : ['ol'];
    }
    const back = pz.blockers.find((x) => c.byId[x] && BACKS.includes(c.byId[x].pos));
    const R = ruleOf(pz, ctx.lib), r = back ? R.rushers.find((q) => q.gap === t[back]) : null;
    return back ? (r ? [back, r.id] : [back]) : ['ol'];
  };
  // Right: the play with the protection set his way. Wrong: the failure clip, then the right one.
  T.outcome = function outcome(pz, ans, ok, ctx) {
    const S = STATE && STATE.get(ctx);
    const runs = runPlays(pz, ctx.play, ans && typeof ans === 'object' ? ans : {}, ok, ctx.lib);
    if (S) S.runs = runs;
    if (ok) return [{ play: runs.right }];
    const v = judge(ruleOf(pz, ctx.lib), ans);
    // The failure clip says what went wrong, on the man it happens to (2026-11-12): cs-ui keeps the
    // explanation ("The answer: ...") in the panel while this bubble shows. A free rusher: the clip
    // frames him and the quarterback over the whole run (zoom), his sack included, and the bubble
    // stays off that ground.
    const f = failureText(ctx, v), cb = CS.compile(runs.bad, ctx.lib);
    const sacked = cb.sackBy != null;
    const parts = sacked ? f.parts.concat(' Sack.') : f.parts;
    const focus = sacked ? [cb.sackBy, 'QB'] : f.focus;
    return [
      { play: runs.bad, say: { parts, focus, tone: 'bad' }, zoom: focus.length ? focus : null, marks: ctx.focusMarks.concat(v.free.map((id) => ({ id, kind: 'bad' }))) },
      { play: runs.right, marks: ctx.focusMarks.slice() },
    ];
  };

  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.assign = T;
})(typeof window !== 'undefined' ? window : globalThis);
