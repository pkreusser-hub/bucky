/**
 * Puzzle type ASSIGN (assets/coachschool/cs-pz-assign.js): connect blockers to gaps or defenders.
 *
 *   node:    the checker applies the RULE (slide, man, fit) to the play, checked against answers
 *            worked out here by hand from the fact sheet's yards (1a line, 1c/1d/1e fronts, 8 gaps,
 *            the library's rush lanes): right, a missed rusher, a man counted twice, crossed blocks,
 *            a two-gap man, an assignment the rule also allows (accepted, and validate() calls the
 *            puzzle ambiguous), the stored answer that is not the rule's, the gap labels on CS.gapsOf,
 *            every outcome run a legal play.
 *   browser: real pointer input on a zoomed field (tap-select then tap-drop, and a rubber-band drag),
 *            connector ends on sprite centres and gap labels, reassigning replaces, Check, +10 XP on a
 *            first-try right answer, a wrong answer's runs in order (failure, then right), no leaks
 *            after destroy(), 44 px controls, no page scroll at 390x844; two plates.
 */
const J = JSON.stringify;

export async function node(H) {
  const { check, near, CS, L } = H;
  const T = CS.puzzleTypes.assign;
  check(!!T && T.name === 'assign' && Array.isArray(T.examples) && T.examples.length >= 2, `assign is registered with ${T && T.examples && T.examples.length} examples (needs 2+)`);
  const ex = (id) => T.examples.find((p) => p.id === id);
  const SL = ex('pz-assign-slide'), FZ = ex('pz-assign-fz-man'), FT = ex('pz-assign-fit');
  check(!!(SL && FZ && FT), 'the three examples: slide protection, man protection vs a fire zone, a one-gap run fit');
  const playOf = (pz) => L.PLAYS[pz.play];
  check(['four-verts-vs-c3', 'smash-vs-c2'].every((id) => L.PLAYS[id]) && SL.play === 'four-verts-vs-c3' && FT.play === 'smash-vs-c2', 'two examples sit on the library\'s own concept plays');
  const PASSPRO = T.examples.filter((p) => p.rule === 'slide' || p.rule === 'man');
  check(PASSPRO.length >= 1 && PASSPRO.every((p) => playOf(p).ball.some((b) => b.ev === 'throw')), `at least one example is pass protection on a pass play (${PASSPRO.map((p) => p.id).join(', ')})`);

  // ── gap labels: CS.gapsOf on the 2x2 by hand ── Fact sheet 1a: C 26.67, guards -+1.5, tackles -+3;
  // 8: A = C|G midpoint, B = G|T midpoint; no inline TE either side, so C = half a split (0.75)
  // outside the tackle and D = 1.5 splits (2.25) outside it.
  //   left : A 25.92, B 24.42, C 23.67-0.75 = 22.92, D 23.67-2.25 = 21.42
  //   right: A 27.42, B 28.92, C 29.67+0.75 = 30.42, D 29.67+2.25 = 31.92
  const HAND_GAPS = { 'A-gap-L': 25.92, 'B-gap-L': 24.42, 'C-gap-L': 22.92, 'D-gap-L': 21.42, 'A-gap-R': 27.42, 'B-gap-R': 28.92, 'C-gap-R': 30.42, 'D-gap-R': 31.92 };
  for (const pz of [SL, FT]) {
    const R = T.ruleOf(pz, L);
    check(Object.keys(HAND_GAPS).every((k) => near(R.gaps[k], HAND_GAPS[k], 1e-9)) && Object.keys(R.gaps).length === 8, `${pz.id}: the rule reads the eight gaps of CS.gapsOf, = the hand numbers ${J(R.gaps)}`);
    check(pz.targets.every((t) => HAND_GAPS[t] != null), `${pz.id}: every target is one of those gap labels`);
  }

  // ── rush lanes by hand (cs-lib OVER_DL, 4-3 Over / nickel: 5 C gap, 3 B gap, 1 A gap, 5 C gap) ──
  const lanes = (pz) => Object.fromEntries(T.ruleOf(pz, L).rushers.map((r) => [r.id, r.gap]));
  check(J(lanes(SL)) === J({ 'DE-R': 'C-gap-R', 'DT-R': 'B-gap-R', 'DT-L': 'A-gap-L', 'DE-L': 'C-gap-L' }), `Cover 3 nickel: four rush, through right C, right B, left A, left C ${J(lanes(SL))}`);
  // Fire zone (fact sheet 9: five rush; the library's pick: the Mike is the fifth, through the right A gap).
  check(J(lanes(FZ)) === J({ 'DE-R': 'C-gap-R', 'DT-R': 'B-gap-R', 'DT-L': 'A-gap-L', 'DE-L': 'C-gap-L', MIKE: 'A-gap-R' }), `fire zone: five rush, the Mike through the right A gap ${J(lanes(FZ))}`);

  // ── slide, by hand ── slide left: each lineman takes the next gap to his left (LT 23.67 -> C-L 22.92,
  // LG 25.17 -> B-L 24.42, C 26.67 -> A-L 25.92, RG 28.17 -> A-R 27.42, RT 29.67 -> B-R 28.92). The
  // line then covers C-L B-L A-L A-R B-R; the four rush C-L A-L B-R C-R, so C-R is open, on the right,
  // away from the slide: the back's (rank 3: "the back takes the first threat away from the slide").
  const SL_HAND = { LT: 'C-gap-L', LG: 'B-gap-L', C: 'A-gap-L', RG: 'A-gap-R', RT: 'B-gap-R', RB: 'C-gap-R' };
  check(J(T.truth(SL, L)) === J(SL_HAND) && T.check(SL, SL_HAND, L), `slide: the rule's answer is the hand-worked one ${J(T.truth(SL, L))}`);
  const slMiss = { ...SL_HAND, RB: 'D-gap-R' }, vMiss = T.judge(SL, slMiss, L);
  check(!T.check(SL, slMiss, L) && J(vMiss.free) === J(['DE-R']), `slide: the back on the right D gap leaves the end rushing the right C gap free ${J(vMiss.free)}`);
  const slDouble = { ...SL_HAND, LG: 'C-gap-L' }, vD = T.judge(SL, slDouble, L);
  check(!T.check(SL, slDouble, L) && J(vD.doubled) === J(['C-gap-L']) && vD.free.length === 0 && vD.misfit.includes('LG'), `slide: two men on the left C gap is a double count (every rusher still covered, the left B gap left to nobody) ${J(vD)}`);
  const slSwap = { ...SL_HAND, LT: 'B-gap-L', LG: 'C-gap-L' }, vS = T.judge(SL, slSwap, L);
  check(!T.check(SL, slSwap, L) && vS.free.length === 0 && J(vS.misfit) === J(['LT', 'LG']), `slide: tackle and guard swapped covers every rusher but breaks the slide (each takes the gap to his left) ${J(vS.misfit)}`);
  check(!T.check(SL, { ...SL_HAND, X: 'D-gap-L' }, L) && !T.check(SL, { LT: 'C-gap-L' }, L) && !T.check(SL, null, L) && !T.check(SL, 'C-gap-L', L), 'slide: an extra man, an unfinished answer, no answer and a bare string all fail');

  // ── man protection vs the fire zone, by hand ── the five rushers in the order of the gaps they
  // rush, left to right: DE-L C-L 22.92, DT-L A-L 25.92, MIKE A-R 27.42, DT-R B-R 28.92, DE-R C-R 30.42.
  // Five linemen, five rushers (9: "5 OL + RB = 6 blockers"; here the back runs a route), the blocks in
  // the same order: LT DE-L, LG DT-L, C MIKE, RG DT-R, RT DE-R. The Will and the nickel drop.
  const FZ_HAND = { LT: 'DE-L', LG: 'DT-L', C: 'MIKE', RG: 'DT-R', RT: 'DE-R' };
  check(J(T.truth(FZ, L)) === J(FZ_HAND) && T.check(FZ, FZ_HAND, L), `man: the rule's answer is the hand-worked one; the center picks up the blitzing Mike ${J(T.truth(FZ, L))}`);
  const fzMiss = { ...FZ_HAND, C: 'WILL' }, vFM = T.judge(FZ, fzMiss, L);
  check(!T.check(FZ, fzMiss, L) && J(vFM.free) === J(['MIKE']) && J(vFM.droppers) === J(['WILL']), `man: the center on the dropping Will leaves the Mike free ${J(vFM)}`);
  const fzDouble = { ...FZ_HAND, C: 'DT-L' }, vFD = T.judge(FZ, fzDouble, L);
  check(!T.check(FZ, fzDouble, L) && J(vFD.doubled) === J(['DT-L']) && J(vFD.free) === J(['MIKE']), `man: guard and center both on the left tackle: counted twice, the Mike free ${J(vFD)}`);
  const fzCross = { ...FZ_HAND, LT: 'DT-L', LG: 'DE-L' }, vFC = T.judge(FZ, fzCross, L);
  check(!T.check(FZ, fzCross, L) && vFC.free.length === 0 && vFC.doubled.length === 0 && J(vFC.crossed) === J([['LT', 'LG']]), `man: every rusher blocked once but tackle and guard cross: wrong ${J(vFC.crossed)}`);
  // The library play the fire-zone puzzle is drawn on: legal, a puzzle diagram (no callouts), 5 rushers.
  const fzp = playOf(FZ);
  check(fzp && fzp.id.startsWith('pz-assign-') && CS.validatePlay(fzp).length === 0 && !(fzp.callouts || []).length && fzp.defense === 'fz-nickel' && T.ruleOf(FZ, L).rushers.length === 5 && fzp.assign.RB.route,
    `${fzp && fzp.id}: a legal pz-assign- play, no callouts, fire zone, five rushers, the back on a route`);

  // ── the run fit, by hand (1c, 4-3 Over, strength right) ── DE-L 5 tech 23.17: the LT at 23.67 is
  // nearest, 0.5 to his left, so the gap on that side of the LT, C-L. DT-L 1 tech 26.17: the C, 0.5 left
  // -> A-L. DT-R 3 tech 28.67: the RG 28.17, 0.5 right -> B-R. DE-R 5 tech 30.17: the RT 29.67 -> C-R.
  const FT_HAND = { 'DE-L': 'C-gap-L', 'DT-L': 'A-gap-L', 'DT-R': 'B-gap-R', 'DE-R': 'C-gap-R' };
  check(J(T.truth(FT, L)) === J(FT_HAND) && T.check(FT, FT_HAND, L), `fit: each one-gap lineman owns the gap he is shaded into ${J(T.truth(FT, L))}`);
  const ftSwap = { ...FT_HAND, 'DT-L': 'B-gap-R', 'DT-R': 'A-gap-L' }, vFT = T.judge(FT, ftSwap, L);
  check(!T.check(FT, ftSwap, L) && J(vFT.misfit) === J(['DT-L', 'DT-R']), `fit: the two tackles swapped are both on the wrong gap ${J(vFT.misfit)}`);
  const ftHole = { ...FT_HAND, 'DT-L': 'B-gap-L' }, vFH = T.judge(FT, ftHole, L);
  check(!T.check(FT, ftHole, L) && J(vFH.empty) === J(['A-gap-L']), `fit: the 1 technique in the B gap leaves the left A gap empty ${J(vFH.empty)}`);

  // ── an assignment the rule also allows is accepted, and validate() calls the puzzle ambiguous ──
  // Fixture (not content): Cover 0 from the nickel against the 2x2, six blockers. 1e/5a: four down
  // linemen rush as above; the SS walks down and rushes, the apex Will rushes; the library picks their
  // lanes (engine pick): SS from x 35.33 takes the nearest open A/B gap, the right A (27.42); the Will
  // from x 20 the left B (24.42). (The Cover 0 Mike's "rush if the back blocks" is engine work, drawn
  // as man on the back; fine for a fixture of the rule.) Six rushers in gap order: DE-L C-L 22.92,
  // WILL B-L 24.42, DT-L A-L 25.92, SS A-R 27.42, DT-R B-R 28.92, DE-R C-R 30.42. The line takes the
  // four down linemen plus ONE of the two blitzers, in order; the back the other. Both pass:
  const FIX = { id: 'pz-assign-fixture-c0', formation: 'gun-2x2', defense: 'c0-nickel', teams: { off: 'KC', def: 'BUF' }, home: 'off', spot: 35,
    assign: { LT: { pass: 'set' }, LG: { pass: 'set' }, C: { pass: 'set' }, RG: { pass: 'set' }, RT: { pass: 'set' }, RB: { block: 'A-gap-R' }, QB: { drop: 3 } }, ball: [{ t: 0, ev: 'snap' }] };
  const LX = { ...L, PLAYS: { ...L.PLAYS, [FIX.id]: FIX } };
  const AMB = { id: 'fx-amb', type: 'assign', rule: 'man', play: FIX.id, blockers: ['LT', 'LG', 'C', 'RG', 'RT', 'RB'], targets: ['DE-L', 'WILL', 'DT-L', 'SS', 'DT-R', 'DE-R'], prompt: 'x', answer: null };
  const A1 = { LT: 'DE-L', LG: 'WILL', C: 'DT-L', RG: 'DT-R', RT: 'DE-R', RB: 'SS' };
  const A2 = { LT: 'DE-L', LG: 'DT-L', C: 'SS', RG: 'DT-R', RT: 'DE-R', RB: 'WILL' };
  const sortJ = (o) => J(Object.keys(o).sort().map((k) => [k, o[k]]));
  check(sortJ(Object.fromEntries(T.ruleOf(AMB, LX).rushers.map((r) => [r.id, r.gap]))) === sortJ({ 'DE-R': 'C-gap-R', 'DT-R': 'B-gap-R', 'DT-L': 'A-gap-L', 'DE-L': 'C-gap-L', SS: 'A-gap-R', WILL: 'B-gap-L' }), 'fixture premise: Cover 0 nickel rushes six through the lanes worked out by hand');
  check(T.check(AMB, A1, LX) && T.check(AMB, A2, LX), 'man: both hand-worked assignments pass the rule (the guard on the Will and the back on the safety, or the center on the safety and the back on the Will)');
  check(!T.check(AMB, { ...A1, RB: 'DT-R', RG: 'SS' }, LX), 'man: the back on a down lineman fails (backs on backers) even with everyone blocked');
  // The back is free of the order rule, so here the count is the only thing wrong: guard and back both
  // on the Will, the safety's A-gap blitz unblocked; every lineman in order, backs on backers.
  const vDW = T.judge(AMB, { ...A1, RB: 'WILL' }, LX);
  check(!vDW.ok && J(vDW.doubled) === J(['WILL']) && J(vDW.free) === J(['SS']) && !vDW.misfit.length && !vDW.crossed.length, `man: two on the Will, the safety free: counted twice, and that is the only fault ${J(vDW)}`);
  const eAmb = T.validate({ ...AMB, answer: A1 }, LX);
  check(eAmb.some((e) => /2 assignments pass .*two right answers/.test(e)) && T.truth(AMB, LX) === null && T.solutions(AMB, LX).n === 2, `validate(): the ambiguous fixture is flagged, two right answers ${J(eAmb)}`);
  // validate() also flags: a stored answer that is not the rule's, a missing play, a two-gap man, a
  // man protection that cannot be one-to-one, a slide whose back has no single first threat.
  const eWrong = T.validate({ ...FZ, answer: fzCross }, L);
  check(eWrong.some((e) => /stored answer/.test(e)), `validate(): a stored answer that is not the rule's ${J(eWrong)}`);
  const eNo = T.validate({ ...FZ, play: 'no-such-play' }, L);
  check(eNo.length === 1 && /unknown play/.test(eNo[0]), 'validate(): a missing play is reported, not thrown');
  // 3-4 (1d): the nose is head-up on the center (0 technique) at 26.67, the ends head-up on the tackles (4).
  const F34 = { ...FIX, id: 'pz-assign-fixture-34', defense: 'c3-34' }, L34 = { ...L, PLAYS: { ...L.PLAYS, [F34.id]: F34 } };
  const e34 = T.validate({ ...FT, id: 'fx-34', play: F34.id, blockers: ['NT', 'DE-L', 'DE-R'], answer: {} }, L34);
  check(['NT', 'DE-L', 'DE-R'].every((id) => e34.some((e) => new RegExp(`${id} is head-up .*two-gap`).test(e))), `validate(): the 3-4's head-up nose and ends are two-gap players, no single gap ${J(e34)}`);
  const eCount = T.validate({ ...FZ, blockers: ['LT', 'LG', 'C', 'RG', 'RT', 'RB'], targets: [...FZ.targets], answer: {} }, L);
  check(eCount.some((e) => /6 blockers for 5 rushers.*not one-to-one/.test(e)), `validate(): six blockers for five rushers is not one-to-one ${J(eCount)}`);
  // Slide right instead (by hand): LT B-L, LG A-L, C A-R, RG B-R, RT C-R; the left C gap is the one rushed gap left: the back's.
  check(T.validate({ ...SL, slide: 'R', answer: { LT: 'B-gap-L', LG: 'A-gap-L', C: 'A-gap-R', RG: 'B-gap-R', RT: 'C-gap-R', RB: 'C-gap-L' } }, L).length === 0, 'slide right: every lineman one gap to his right, the back on the left C gap (hand-worked) validates');
  // The 3-4 rushes A-R, B-R, B-L, C-L (1d, library lanes): sliding left covers all four, so the back has nobody.
  const eSl = T.validate({ ...SL, id: 'fx-34-slide', play: F34.id, answer: {} }, L34);
  check(eSl.some((e) => /0 rushers the slide leaves open for 1 back/.test(e)), `validate(): a slide that leaves the back nobody to block is flagged ${J(eSl)}`);
  for (const pz of T.examples) check(T.validate(pz, L).length === 0, `${pz.id}: validates clean ${J(T.validate(pz, L))}`);

  // ── the failure clip's sack, by hand (2026-11-12: cs-core can now carry a free rusher to the QB) ──
  // fz-man, RT on the Will (a dropper): DE-R is nobody's. His rush (fire zone, C-gap-R) runs from
  // his alignment to the gap's point on the line (CS.gapX + the hash shift, 0.4 yd past it) and on to
  // CS.SACK_REACH in front of the quarterback's set spot (a 3-step from the gun: 2 yd back, at 4 yd/s,
  // set at 0.5 s), at his speed. The clip's sack is the first 0.02 s frame within SACK_REACH + 0.05 yd
  // of the QB: the last leg runs straight at the QB, so that is (path length - 0.05) / v.
  {
    const pz = T.examples.find((p) => p.id === 'pz-assign-fz-man'), p = playOf(pz);
    const ans = { LT: 'DE-L', LG: 'DT-L', C: 'MIKE', RG: 'DT-R', RT: 'WILL' }, rw = T.runs(pz, p, ans, false, L), c = CS.compile(rw.bad);
    const de = CS.compile(p).byId['DE-R'], qb0 = CS.compile(p).byId.QB, dX = CS.compile(p).dX;
    const gp = [CS.gapX('C-gap-R') + dX, -0.4], qbSet = [qb0.x, qb0.y - 2], end = [qbSet[0], qbSet[1] + CS.SACK_REACH];
    const len = Math.hypot(gp[0] - de.x, gp[1] - de.y) + Math.hypot(end[0] - gp[0], end[1] - gp[1]), v = CS.SPEEDS[de.pos];
    const tHand = (len - 0.05) / v, sack = rw.bad.ball.find((b) => b.ev === 'sack');
    const P = CS.poseAt(rw.bad, sack ? sack.t : 0).players, gapQB = Math.hypot(P['DE-R'].x - P.QB.x, P['DE-R'].y - P.QB.y);
    check(CS.validatePlay(rw.bad).length === 0 && sack && sack.by === 'DE-R' && Math.abs(sack.t - tHand) <= 0.04 && gapQB <= CS.SACK_REACH + 0.05 && c.throwT === null && Math.abs(c.T - (sack.t + 1)) < 1e-9,
      `fz-man, RT on the Will: DE-R comes free and sacks the QB at ${sack && sack.t} s (by hand ${tHand.toFixed(3)} s: ${len.toFixed(2)} yd at ${v} yd/s), ${gapQB.toFixed(2)} yd from him, no throw, the clip ends a second later`);
    const hold = Object.entries(rw.bad.assign).filter(([, a]) => a.on).map(([id, a]) => [id, a.on, CS.compile(rw.bad).byId[id].held != null]);
    check(J(hold) === J([['LT', 'DE-L', true], ['LG', 'DT-L', true], ['C', 'MIKE', true], ['RG', 'DT-R', true]]) && !rw.bad.assign.RT.on,
      `fz-man, RT on the Will: the four linemen with a rusher meet him and hold; the right tackle, on a dropper, blocks nobody ${J(hold)}`);
    const rr = T.runs(pz, p, pz.answer, true, L), cr = CS.compile(rr.right);
    check(['LT', 'LG', 'C', 'RG', 'RT'].every((id) => rr.right.assign[id].on === pz.answer[id] && cr.byId[id].held != null) && !rr.right.ball.some((b) => b.ev === 'sack'),
      'fz-man right run: every lineman meets the man he was connected to and holds; no sack');
  }

  // ── every outcome run is a legal play; the wrong clip stops before any throw ──
  const bad = [];
  for (const pz of T.examples) {
    const p = playOf(pz), t = T.truth(pz, L), rr = T.runs(pz, p, t, true), rw = T.runs(pz, p, T.distractors(pz, L)[0], false);
    for (const [k, v] of [['right', rr.right], ['right', rw.right], ['wrong', rw.bad]]) { const e = CS.validatePlay(v); if (e.length) bad.push(`${pz.id} ${k}: ${e[0]}`); }
    if (!rw.bad.id.endsWith('~assign-wrong') || CS.compile(rw.bad).throwT !== null) bad.push(`${pz.id}: the wrong clip has a throw`);
    if (pz.rule === 'slide' && !(rr.right.assign.LT.pass === 'slide-L' && rr.right.assign.RB.block === 'C-gap-R')) bad.push(`${pz.id}: the right run is not the slide left with the back on the right C gap ${J(rr.right.assign)}`);
  }
  check(bad.length === 0, `every outcome run is a legal play; the right slide run slides left with the back on the right C gap ${bad.join(' | ')}`);

  // ── check() is pure ──
  const snap = J(SL);
  check(T.check(SL, SL_HAND, L) === T.check(SL, SL_HAND, L) && J(SL) === snap, 'check() leaves the puzzle alone and gives the same verdict twice');
}

export async function browser(H) {
  const { check, open, settle, plate } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#map' });
  const ask = (id, tries) => page.evaluate(async (id, tries) => {
    const CS = window.CS, pz = CS.puzzleTypes.assign.examples.find((p) => p.id === id);
    location.hash = '#unit/' + CS.RANK_DATA[0].units[0].id;
    await new Promise((r) => setTimeout(r, 120));
    window.__CS__.ui.ask(pz, { tries, gameDay: tries === 1 });
    const F = window.__CS__.field, t0 = Date.now();
    await new Promise((r) => setTimeout(r, 60));
    while (F.camAnimating && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 30));
    await new Promise((r) => setTimeout(r, 60));
    return { z: F.camera.z, xp: window.__CS__.ui.state.xp };
  }, id, tries);
  // Where to touch: a blocker's handle centre, a gap letter where drawn, a defender's painted centre.
  const geo = () => page.evaluate(() => {
    const F = window.__CS__.field, out = { handles: {}, gaps: {}, sprites: {} };
    for (const d of F.drags) for (const h of d.handles) out.handles[h.key] = { x: h.cx, y: h.cy, r: h.r };
    for (const g of F.overlays.gaps) out.gaps[g.name] = { x: g.x, y: g.y };
    for (const id of Object.keys(F.shown.players)) { const r = F.spriteRect(id); if (r) out.sprites[id] = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }
    return out;
  });
  const tap = async (p) => { await page.touchscreen.tap(p.x, p.y); await settle(page, 40); };
  const links = () => page.evaluate(() => window.__CS__.field.overlays.links);

  /* 1. Slide, a lesson: real taps while zoomed, every connector end measured, reassign replaces, Check, +10 XP. */
  const s0 = await ask('pz-assign-slide', 2);
  check(s0.z > 1.5, `slide: the field is zoomed on the line before the first tap (zoom ${s0.z.toFixed(2)})`);
  let G = await geo();
  const HAND = { LT: 'C-gap-L', LG: 'B-gap-L', C: 'A-gap-L', RG: 'A-gap-R', RT: 'B-gap-R', RB: 'C-gap-R' };
  check(Object.keys(HAND).every((b) => G.handles[b] && G.handles[b].r >= 22), `slide: a handle on each of the six blockers, 44 px across ${J(Object.values(G.handles).map((h) => h.r))}`);
  // No gap letter sits under a blocker's handle (else a tap on it would grab the handle).
  const covered = Object.entries(G.gaps).filter(([, g]) => Object.values(G.handles).some((h) => Math.hypot(h.x - g.x, h.y - g.y) <= h.r));
  check(covered.length === 0, `slide: at this zoom no gap letter is under a 44 px handle ${J(covered.map((c) => c[0]))}`);
  // First a wrong connection for the left tackle, then the right one: reassigning replaces.
  await tap(G.handles.LT); await tap(G.gaps['D-gap-L']);
  let lk = await links();
  check(lk.length === 1 && lk[0].from === 'LT' && lk[0].to === 'D-gap-L', `slide: tap the left tackle, tap the D letter: one connector LT -> D-gap-L ${J(lk.map((l) => l.from + '>' + l.to))}`);
  for (const [b, g] of Object.entries(HAND)) { G = await geo(); await tap(G.handles[b]); await tap(G.gaps[g]); }
  lk = await links(); G = await geo();
  const want = Object.entries(HAND).map(([b, g]) => b + '>' + g).sort();
  check(J(lk.map((l) => l.from + '>' + l.to).sort()) === J(want), `slide: six connectors, the left tackle's replaced, not added ${J(lk.map((l) => l.from + '>' + l.to))}`);
  // Ends: on the blocker's painted centre and on the gap letter as drawn, within 1 px.
  const endBad = lk.filter((l) => Math.hypot(l.a.x - G.sprites[l.from].x, l.a.y - G.sprites[l.from].y) > 1 || Math.hypot(l.b.x - G.gaps[l.to].x, l.b.y - G.gaps[l.to].y) > 1);
  check(endBad.length === 0, `slide: every connector starts on the blocker's sprite centre and ends on its gap letter (1 px) ${J(endBad)}`);
  // ...and the letters stand at CS.gapsOf's yards: each letter's ground point is yardToScreen(gap x, 0).
  const lbl = await page.evaluate(() => { const F = window.__CS__.field, g = F.gapsOf(); return F.overlays.gaps.map((q) => ({ n: q.name, d: Math.hypot(q.ground.x - window.__CS__.yardToScreen(g[q.name], 0).x, q.ground.y - window.__CS__.yardToScreen(g[q.name], 0).y), yd: q.yd, want: g[q.name] })); });
  check(lbl.length === 8 && lbl.every((q) => q.d < 0.5 && Math.abs(q.yd - q.want) < 1e-9), `slide: eight gap letters, each on CS.gapsOf's yards ${J(lbl.filter((q) => q.d >= 0.5))}`);
  await plate(page, 'assign-slide-mid.png');
  // Controls: the panel button and the Check button are 44 px; no page scroll at 390x844.
  const ui = await page.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height, vis: e.offsetParent !== null, txt: e.textContent.trim() }; };
    return { panel: [...document.querySelectorAll('#stOpts button')].map(r), main: r(document.getElementById('btnMain')), scroll: document.scrollingElement.scrollHeight - innerHeight, sw: document.scrollingElement.scrollWidth - innerWidth };
  });
  check(ui.main.vis && ui.main.txt === 'Check' && ui.main.w >= 44 && ui.main.h >= 44 && ui.panel.length >= 1 && ui.panel.every((b) => b.w >= 44 && b.h >= 44), `slide: Check and the panel's Start over are at least 44x44 ${J(ui)}`);
  check(ui.scroll <= 0 && ui.sw <= 0, `slide: no page scroll at 390x844 (${ui.scroll}, ${ui.sw})`);
  const right = await page.evaluate(async () => {
    document.getElementById('btnMain').click();
    await new Promise((r) => setTimeout(r, 200));
    const C = window.__CS__; return { mode: C.ui.mode, xp: C.ui.state.xp, bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim(), drags: C.field.drags.length, play: C.play.id };
  });
  check(right.mode.done && right.mode.ok && right.xp - s0.xp === 10 && /^Right\. \+10 XP/.test(right.bubble), `slide: Check scores it right first try, +10 XP (${right.xp - s0.xp}) "${right.bubble.slice(0, 40)}"`);
  check(right.drags === 0 && right.play === 'four-verts-vs-c3~assign-right', `slide: the handles lock and the play runs with the slide set (${right.play})`);
  const gone = await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); const F = window.__CS__.field, op = document.getElementById('stOpts'); return { ov: F.overlay.count, drags: F.drags.length, opts: op.children.length, hidden: op.offsetParent === null }; });
  check(gone.ov === 0 && gone.drags === 0 && gone.opts === 0 && gone.hidden, `slide: destroy() leaves no overlay, drag or panel control ${J(gone)}`);

  /* 2. Man vs the fire zone, a lesson: a rubber-band drag; wrong (Mike left free), missed, wrong again: runs in order. */
  await ask('pz-assign-fz-man', 2);
  G = await geo();
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8);
    await page.mouse.up(); await settle(page, 40);
  };
  // Drop a few px off the sprite centre: the snap puts the end on it.
  const WRONG = { LT: 'DE-L', LG: 'DT-L', C: 'WILL', RG: 'DT-R', RT: 'DE-R' };
  for (const [b, d] of Object.entries(WRONG)) { G = await geo(); await drag(G.handles[b], { x: G.sprites[d].x + 5, y: G.sprites[d].y - 4 }); }
  lk = await links(); G = await geo();
  check(J(lk.map((l) => l.from + '>' + l.to).sort()) === J(Object.entries(WRONG).map(([b, d]) => b + '>' + d).sort()), `man: five rubber-band drags make five connectors ${J(lk.map((l) => l.from + '>' + l.to))}`);
  check(lk.every((l) => Math.hypot(l.b.x - G.sprites[l.to].x, l.b.y - G.sprites[l.to].y) <= 1), 'man: a drop 6 px off a defender snaps the connector onto his sprite centre');
  const miss = await page.evaluate(async () => {
    document.getElementById('btnMain').click(); await new Promise((r) => setTimeout(r, 120));
    const C = window.__CS__; return { mode: C.ui.mode, fb: document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim(), marks: C.field.marks, drags: C.field.drags.length };
  });
  check(!miss.mode.done && miss.mode.tryNo === 2 && /Nobody blocks the mike linebacker/i.test(miss.fb) && miss.marks.some((m) => m.id === 'MIKE' && m.kind === 'bad') && miss.drags === 1, `man: the first miss names the free Mike, rings him, and keeps the handles up ${J(miss)}`);
  const ord = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, out = { seen: [] };
    document.getElementById('btnMain').click();
    await new Promise((r) => setTimeout(r, 80));
    out.fb = document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim();
    out.bubble = document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim();
    out.mode = C.ui.mode;
    out.paths = F.overlays.paths; out.qb = null;
    const p0 = C.play; out.first = p0.id;
    // The red arrow: from the Mike's gap (right A, 27.42 on the line) to the quarterback.
    out.arrow0 = C.yardToScreen(window.CS.gapsOf(window.CS.compile(p0))['A-gap-R'], 0);
    out.marks = F.marks;
    F.setSpeed(4);
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) { if (out.seen[out.seen.length - 1] !== C.play.id) out.seen.push(C.play.id); if (out.seen.length >= 2) break; await new Promise((r) => setTimeout(r, 40)); }
    await new Promise((r) => setTimeout(r, 120));
    out.paths2 = F.overlays.paths.length; out.links2 = F.overlays.links.map((l) => l.from + '>' + l.to).sort();
    F.setSpeed(1);
    return out;
  });
  await page.evaluate(() => { const C = window.__CS__; C.field.pause(); document.getElementById('btnReplay').click(); });
  await page.evaluate(async () => { const F = window.__CS__.field; F.pause(); F.seek(0.9); await new Promise((r) => setTimeout(r, 80)); });
  await plate(page, 'assign-man-wrong.png');
  // 2026-11-12: the free Mike gets home. At the sack the clip's camera frames him and the QB (the
  // run's zoom), and its bubble sits off both of them (placeBubble's block: the ground they cover
  // over the whole run).
  const sk = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, CS = window.CS, c = CS.compile(C.play);
    F.pause(); F.seek(c.sackT); await new Promise((r) => setTimeout(r, 700));
    const bb = document.getElementById('bubble').getBoundingClientRect(), hit = (q) => q && bb.left < q.right && bb.right > q.left && bb.top < q.bottom && bb.bottom > q.top;
    const P = CS.poseAt(C.play, c.sackT).players, cr = F.canvas.getBoundingClientRect(), s = (id) => C.yardToScreen(P[id].x, P[id].y);
    const on = (p) => p.x >= cr.left && p.x <= cr.right && p.y >= cr.top && p.y <= cr.bottom;
    return { play: C.play.id, sackT: c.sackT, by: c.sackBy, gap: Math.hypot(P[c.sackBy].x - P.QB.x, P[c.sackBy].y - P.QB.y), z: F.camera.z, saying: !!C.saying,
      covers: [hit(C.spriteRect(c.sackBy)), hit(C.spriteRect('QB'))], onScreen: on(s(c.sackBy)) && on(s('QB')) };
  });
  check(sk.play === 'pz-assign-fz-slant-flat~assign-wrong' && sk.by === 'MIKE' && sk.gap <= 0.75 + 1e-9 && sk.z > 1 && sk.saying && sk.onScreen && !sk.covers[0] && !sk.covers[1],
    `man: in the failure clip the free Mike sacks the QB at ${sk.sackT} s (${sk.gap.toFixed(2)} yd off him), framed (zoom ${sk.z}), both on screen, the bubble covering neither ${J(sk.covers)}`);
  await plate(page, 'assign-man-sack.png');
  // Restaged 2026-11-12 (outcome bubbles): the answer used to be the bubble and what went wrong the
  // panel line. Now the failure clip's own bubble says what went wrong, on the man (and the QB) it
  // happens to, and the explanation ("The answer: ...") stays in the panel: the dad saw the clip's
  // bubble cover it.
  check(ord.mode.done && ord.mode.ok === false && ord.mode.explain === 'panel' && /^The answer: /.test(ord.fb) && /^Nobody blocks the mike linebacker\..* Sack\.$/i.test(ord.bubble), `man: wrong twice: the panel names the answer and the clip's bubble says what went wrong ("${ord.fb.slice(0, 40)}" | "${ord.bubble}")`);
  check(J(ord.seen) === J(['pz-assign-fz-slant-flat~assign-wrong', 'pz-assign-fz-slant-flat~assign-right']), `man: the failure clip runs first, then the right one ${J(ord.seen)}`);
  check(ord.paths.length === 1 && Math.hypot(ord.paths[0].pts[0].x - ord.arrow0.x, ord.paths[0].pts[0].y - ord.arrow0.y) < 1 && ord.marks.some((m) => m.id === 'MIKE' && m.kind === 'bad'), `man: during the failure a red arrow runs from the right A gap (the Mike's lane) to the quarterback, and the Mike is ringed ${J(ord.paths.map((p) => p.pts[0]))}`);
  check(ord.paths2 === 0 && J(ord.links2) === J(['C>MIKE', 'LG>DT-L', 'LT>DE-L', 'RG>DT-R', 'RT>DE-R']), `man: in the right run the arrow is gone and the connectors are the right ones ${J(ord.links2)}`);
  const gone2 = await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); const F = window.__CS__.field; return { ov: F.overlay.count, drags: F.drags.length, moved: Object.keys(F.moved).length }; });
  check(gone2.ov === 0 && gone2.drags === 0 && gone2.moved === 0, `man: destroy() after the runs leaves nothing (the run watcher's overlays included) ${J(gone2)}`);
  // A minute later the watcher is gone: nothing is redrawn onto the field after destroy().
  const late = await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 300)); return window.__CS__.field.overlay.count; });
  check(late === 0, `man: the run watcher stops with destroy() (${late} overlays 300 ms later)`);

  /* 3. The run fit on Game Day: tap a defensive lineman, tap his gap. */
  await ask('pz-assign-fit', 1);
  const FIT = { 'DE-L': 'C-gap-L', 'DT-L': 'A-gap-L', 'DT-R': 'B-gap-R', 'DE-R': 'C-gap-R' };
  for (const [b, g] of Object.entries(FIT)) { G = await geo(); await tap(G.handles[b]); await tap(G.gaps[g]); }
  lk = await links();
  const fit = await page.evaluate(async () => { document.getElementById('btnMain').click(); await new Promise((r) => setTimeout(r, 120)); const C = window.__CS__; return { mode: C.ui.mode, play: C.play.id }; });
  check(lk.length === 4 && fit.mode.done && fit.mode.ok && fit.play === 'smash-vs-c2~assign-right', `fit: four taps-and-taps, Check: right on Game Day; the snap clip runs ${J(fit)}`);
  await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });
  check(errors.length === 0, `assign: zero page errors ${J(errors.slice(0, 3))}`);
  await page.close();
}
