/* Coach School puzzle type: CHOICE. A question over a diagram with 2-4 answers. Pure: loads in
   the page and in a Node vm (the suite), registers into CS.puzzleTypes.choice.

   Each option carries a value `v`. The question's true value comes from the play itself wherever
   it can (`q` below works it out from the alignment), so a puzzle cannot quietly disagree with its
   own diagram; for a plain fact (`q:'fact'`) it is the fact-sheet value written in `truth`, with
   the section in `src`. Exactly one option may carry the true value: two options that are both
   right are flagged, as is a stored answer that is not the true one.

   puzzle: { id, type:'choice', play, prompt, q, of?, truth?, src?, options:[{t, v}], answer, tags, focus?, why } */
(function (root) {
  'use strict';
  const CS = root.CS;
  const ofPlayer = (q) => (c, pz) => { if (!c.byId[pz.of]) throw new Error(`puzzle ${pz.id}: ${pz.of} is not on the field`); return q(c, pz.of, pz); };
  // The true value of each kind of question, from the compiled play.
  const Q = {
    fact: (c, pz) => pz.truth,
    role: ofPlayer((c, id) => CS.roleOf(c, id)),
    onLine: ofPlayer((c, id) => (c.byId[id].y >= CS.ON_LINE_Y ? 'on' : 'off')),
    eligible: ofPlayer((c, id) => { const e = CS.isEligible(c, id); return e == null ? null : e ? 'yes' : 'no'; }),
    // Inline = on the line, next to a tackle (the sheet's inline TE stands 1.5 yd outside him).
    teAlign: ofPlayer((c, id) => {
      const p = c.byId[id];
      if (p.pos !== 'TE') return null;
      const tackles = c.off.filter((q) => q.pos === 'T');
      const next = tackles.some((t) => Math.abs(t.x - p.x) <= 2);
      return p.y >= CS.ON_LINE_Y && next ? 'inline' : 'flexed';
    }),
    onLineCount: (c) => c.off.filter((p) => p.y >= CS.ON_LINE_Y).length,
    backfieldCount: (c) => c.off.filter((p) => p.y < CS.ON_LINE_Y).length,
    count: (c, pz) => c.def.filter((p) => [].concat(pz.pos).includes(p.pos)).length,
    strength: (c) => CS.strengthOf(c),
    fieldSide: (c) => CS.fieldSide(c),
    boundarySide: (c) => { const f = CS.fieldSide(c); return f === 'L' ? 'R' : f === 'R' ? 'L' : null; },
    redZone: (c) => (CS.inRedZone(CS.num(c.play.spot, 25)) ? 'yes' : 'no'),
    // QB depth (fact sheet, rank 1): under center about 1 yd, pistol about 4, shotgun about 5.
    qbAlign: (c) => { const y = c.qb.y; return y >= -1.5 ? 'under' : y >= -4.5 ? 'pistol' : 'gun'; },
  };
  function truth(pz, lib) {
    lib = lib || CS.lib;
    const play = lib.PLAYS[pz.play];
    if (!play) throw new Error(`puzzle ${pz.id}: unknown play ${pz.play}`);
    const f = Q[pz.q];
    if (!f) throw new Error(`puzzle ${pz.id}: unknown question kind ${pz.q}`);
    return f(CS.compile(play, lib), pz);
  }
  const same = (a, b) => a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
  const T = {
    name: 'choice',
    Q,
    truth,
    // answer = the index of the option he picked.
    check(pz, answer, lib) {
      const o = (pz.options || [])[answer];
      if (!o) return false;
      const v = truth(pz, lib);
      return v != null && same(o.v, v);
    },
    distractors(pz) { return (pz.options || []).map((o, i) => i).filter((i) => i !== pz.answer); },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const e = [], L = `puzzle ${pz.id}`;
      if (!lib.PLAYS[pz.play]) return [`${L}: unknown play ${pz.play}`];
      if (!Q[pz.q]) return [`${L}: unknown question kind ${pz.q}`];
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${L}: no prompt`);
      const os = pz.options || [];
      if (os.length < 2 || os.length > 4) e.push(`${L}: ${os.length} options (2-4)`);
      if (new Set(os.map((o) => String(o.t).toLowerCase())).size !== os.length) e.push(`${L}: two options read the same`);
      if (pz.q === 'fact' && !pz.src) e.push(`${L}: a fact question must name its fact-sheet section in src`);
      let v;
      try { v = truth(pz, lib); } catch (err) { return e.concat(`${L}: ${err.message}`); }
      if (v == null) e.push(`${L}: the question has no answer on this play`);
      const right = os.map((o, i) => (same(o.v, v) ? i : -1)).filter((i) => i >= 0);
      if (right.length === 0) e.push(`${L}: no option is right (true value ${v})`);
      if (right.length > 1) e.push(`${L}: options ${right.join(' and ')} are both right: two right answers`);
      if (right.length === 1 && right[0] !== pz.answer) e.push(`${L}: the right option is ${right[0]} but the stored answer is ${pz.answer}`);
      return e;
    },
  };
  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.choice = T;
})(typeof window !== 'undefined' ? window : globalThis);
