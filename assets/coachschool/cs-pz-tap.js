/* Coach School puzzle type: TAP. "Tap the Mike linebacker." Pure: loads in the page and in a
   Node vm (the suite), registers into CS.puzzleTypes.tap.

   A tap puzzle never trusts its own stored answer. It describes WHO is wanted (`find`), and the
   right answer is worked out from the play itself: the line read left to right, the ends of the
   line, who is eligible, the convention letters. The suite then checks that the description
   picks out exactly one player and that it is the one the author stored, so a puzzle that two
   players would answer (two cornerbacks, two tight ends) cannot ship.

   puzzle: { id, type:'tap', play, prompt, find, answer, tags, focus?, why }
   find keys (all must hold):
     role     a CS.roleOf name or a list of them   ('C', 'LT', 'X', 'MIKE', 'NT', 'TE', ...)
     pos      a position or list ('CB', 'S', 'LB')
     team     'off' | 'def'
     side     'L' | 'R' (of the ball, the offense's left/right)
     lineEnd  'L' | 'R' (the outermost offensive player on the line that side)
     eligible true | false (never answers for the quarterback; see CS.isEligible) */
(function (root) {
  'use strict';
  const CS = root.CS;
  const KEYS = ['role', 'pos', 'team', 'side', 'lineEnd', 'eligible'];
  const list = (v) => (Array.isArray(v) ? v : [v]);

  function compiled(pz, lib) {
    const play = lib.PLAYS[pz.play];
    if (!play) throw new Error(`puzzle ${pz.id}: unknown play ${pz.play}`);
    return CS.compile(play, lib);
  }
  // Every player the description fits, sorted.
  function matches(pz, lib) {
    const c = compiled(pz, lib), f = pz.find || {};
    let ps = c.all.slice();
    if (f.team != null) ps = ps.filter((p) => p.team === f.team);
    if (f.role != null) ps = ps.filter((p) => list(f.role).includes(CS.roleOf(c, p.id)));
    if (f.pos != null) ps = ps.filter((p) => list(f.pos).includes(p.pos));
    if (f.side != null) ps = ps.filter((p) => p.side === f.side);
    if (f.lineEnd != null) { const e = CS.lineEnds(c)[f.lineEnd]; ps = ps.filter((p) => p.id === e); }
    if (f.eligible != null) ps = ps.filter((p) => CS.isEligible(c, p.id) === f.eligible);
    return ps.map((p) => p.id).sort();
  }
  const T = {
    name: 'tap',
    matches,
    // Right when the tapped player is the one (and only one) the description fits.
    check(pz, answer, lib) {
      const m = matches(pz, lib || CS.lib);
      return m.length === 1 && m[0] === answer;
    },
    // The answer the description gives, for the UI's reveal.
    truth(pz, lib) { const m = matches(pz, lib || CS.lib); return m.length === 1 ? m[0] : null; },
    // Every other player on the field is a wrong answer.
    distractors(pz, lib) { lib = lib || CS.lib; const c = compiled(pz, lib); return c.all.map((p) => p.id).filter((id) => id !== pz.answer); },
    validate(pz, lib) {
      lib = lib || CS.lib;
      const e = [], L = `puzzle ${pz.id}`;
      if (!lib.PLAYS[pz.play]) return [`${L}: unknown play ${pz.play}`];
      if (!pz.prompt || typeof pz.prompt !== 'string') e.push(`${L}: no prompt`);
      const f = pz.find || {};
      if (!Object.keys(f).length) e.push(`${L}: find is empty`);
      for (const k of Object.keys(f)) if (!KEYS.includes(k)) e.push(`${L}: unknown find key ${k}`);
      const m = matches(pz, lib);
      if (m.length === 0) e.push(`${L}: nobody fits the description`);
      if (m.length > 1) e.push(`${L}: ${m.length} players fit the description (${m.join(', ')}): two right answers`);
      if (m.length === 1 && m[0] !== pz.answer) e.push(`${L}: the description picks ${m[0]} but the stored answer is ${pz.answer}`);
      return e;
    },

    /* ── page side (the plugin contract, cs-core.js): moved here unchanged from cs-ui's askPuzzle ── */
    // A tap puzzle has no controls of its own: the field is the control. A tap on grass is not a
    // guess; it costs no try.
    mount(ctx) {
      return {
        onTap(id) {
          if (!id) { ctx.say(null); ctx.feedback('bad', ['No player there. Tap right on him.']); return; }
          ctx.submit(id);
        },
        // First miss: ring the man he tapped and name him, and keep the question open.
        missed(ans) {
          ctx.field.setMarks(ctx.focusMarks.concat([{ id: ans, kind: 'bad' }]));
          ctx.say({ parts: ['That is the ', { tag: 'b', text: ctx.lc(ctx.nameOf(ans)) }, '. One more try.'], focus: [ans], tone: 'bad', zoom: false, spot: false });
        },
        // Over: the man he tapped in red (if wrong), the right man in green.
        resolved({ ok, picked }) {
          const m = [];
          if (!ok && picked) m.push({ id: picked, kind: 'bad' });
          m.push({ id: T.truth(ctx.pz, ctx.lib), kind: 'good' });
          return m;
        },
        destroy() {},
      };
    },
    rightName(pz, ctx) { return ctx.nameOf(T.truth(pz, ctx.lib)); },
    // The explanation points at the right player.
    lookOf(pz, ctx) { return [T.truth(pz, ctx.lib)]; },
  };
  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.puzzleTypes.tap = T;
})(typeof window !== 'undefined' ? window : globalThis);
