/**
 * Puzzle type `predict` (assets/coachschool/cs-pz-predict.js): "Where does the ball go?" The play
 * freezes at the snap (or at the QB's read point) and he taps the receiver.
 *
 *   node:    the read worked out by hand from the fact sheet (zone landmarks 4, route tree 3, speeds)
 *            and compared with readOf(); check / truth / distractors on the examples; validate()
 *            refuses a stored answer the play does not throw to, a play whose throw disagrees with
 *            the sheet's read, a frame with two right answers, an undecided read, no read, no throw,
 *            a freeze that gives the answer away, and chalk beyond the concept; every outcome run is
 *            a legal play that stops at the throw without throwing.
 *   browser: the freeze lands exactly on the chosen t (normal and reduced motion); no answer before
 *            it; real taps through page.mouse: a lineman, a defender, the QB and grass cost no try;
 *            a right first tap pays +10 XP; wrong then right pays +5; a wrong Game Day tap plays the
 *            failure run first (to the throw, no throw, his pick and the defender ringed), then the
 *            real play to the right man; destroy() before the freeze leaves the clock still and
 *            nothing behind; every control 44 px; no page scroll at 390x844; two plates.
 */
const J = JSON.stringify;
const sortJ = (a) => J([...a].sort());

export async function node(H) {
  const { check, near, CS, L } = H;
  const T = CS.puzzleTypes.predict;
  check(!!T && T.name === 'predict', 'predict: registered');
  const ex = Object.fromEntries(T.examples.map((p) => [p.id, p]));
  const SM = ex['pz-predict-ex-smash'], FL = ex['pz-predict-ex-flood'];
  check(T.examples.length >= 2 && SM && FL && L.PLAYS[SM.play] && L.PLAYS[FL.play], `predict: two examples on library concept plays (${T.examples.map((p) => p.play).join(', ')})`);
  const bases = { [SM.play]: 'smash-vs-c2', [FL.play]: 'flood-vs-c3' };
  for (const [v, b] of Object.entries(bases)) {
    check(L.PLAYS[v].concept === L.PLAYS[b].concept && L.PLAYS[v].defense === L.PLAYS[b].defense && CS.validatePlay(L.PLAYS[v]).length === 0 && !(L.PLAYS[v].callouts || []).length,
      `${v}: a legal variant of ${b}, same concept and defense, no callouts`);
  }

  // ── the read by hand ──
  // Smash left vs Cover 2. CB-L holds flat-L (5a), landmark (5, 6) (4). He lines up (6, 5) (5a depth 5),
  // 1.41 yd away, so he is on it long before the throw (2.4 s). X (6, 0) runs the hitch (3: 6 yd stem,
  // back in 0.5 to 5): at 7 yd/s he is set at (6.5, 5) by 1.02 s. H (15, -1) runs the corner: stem to
  // (15, 11) by 12/7 = 1.714 s, then 45 deg out: 0.686 s x 7 = 4.8 yd = 3.394 each way -> (11.606, 14.394).
  //   CB-L to X: hypot(1.5, 1) = 1.803; to H: hypot(6.606, 8.394) = 10.682. He took X; H is open.
  {
    const r = T.readOf(L.PLAYS[SM.play], L), s = r.sides[0];
    check(r.sides.length === 1 && s.side === 'L' && s.defender === 'CB-L' && J(s.a) === '["X"]' && J(s.b) === '["H"]', `smash: one read, on the left: CB-L between X (hitch) and H (corner) ${J(r.sides.map((q) => [q.side, q.defender, q.a, q.b]))}`);
    check(near(s.dA, Math.hypot(1.5, 1), 1e-3) && near(s.dB, Math.hypot(15 - 3.394 - 5, 11 + 3.394 - 6), 2e-3), `smash: CB-L is 1.803 yd from X and 10.682 from H at the throw, by hand (${s.dA.toFixed(3)}, ${s.dB.toFixed(3)})`);
    check(s.decided && J(s.taken) === '["X"]' && J(s.open) === '["H"]' && s.sheetAgrees && r.target === 'H', 'smash: he squats on the hitch, the corner route opens, and the play throws to H');
  }
  // Flood right vs Cover 3. NB holds curl-flat-R: "the curl, then the flat", so the curl landmark
  // (41.33, 11) (4). From (37.33, 5) that is hypot(4, 6) = 7.211 yd at 6.8 yd/s: there by 1.06 s, the
  // throw is at 1.4. Y (38.33, -1) on the sail: 10 yd stem at 7 yd/s, at 1.4 s he is 9.8 up: (38.33, 8.8).
  // RB (28.67, -5) on the flat at 6.5: 9.1 yd run; first leg out 2 / up 2 (2.828), then out 8 / up 1
  // (8.062): 6.272 along it -> (30.67 + 6.224, -3 + 0.778) = (36.894, -2.222).
  //   NB to Y: hypot(3, 2.2) = 3.720; to RB: hypot(4.436, 13.222) = 13.947. He sinks under the sail; RB open.
  {
    const r = T.readOf(L.PLAYS[FL.play], L), s = r.sides[0];
    check(r.sides.length === 1 && s.side === 'R' && s.defender === 'NB' && J(s.a) === '["RB"]' && J(s.b) === '["Y"]', `flood: one read, on the right: NB between RB (flat) and Y (sail) ${J(r.sides.map((q) => [q.side, q.defender, q.a, q.b]))}`);
    check(near(s.dB, Math.hypot(3, 2.2), 2e-3) && near(s.dA, Math.hypot(41.33 - 36.894, 11 + 2.222), 3e-3), `flood: NB is 3.720 yd from Y and 13.947 from RB at the throw, by hand (${s.dB.toFixed(3)}, ${s.dA.toFixed(3)})`);
    check(s.decided && J(s.open) === '["RB"]' && s.sheetAgrees && r.target === 'RB', 'flood: he sinks under the sail, the flat opens, and the play throws to the back');
    // The freeze at 0.4: 0.4 x 6.8 = 2.72 of 7.211 yd = 37.7% of his drop, under half.
    check(near(T.progressAt(L.PLAYS[FL.play], 'NB', 0.4, L), 2.72 / Math.hypot(4, 6), 1e-9), `flood: at 0.4 s NB is 2.72 / 7.211 = 37.7% of the way to his landmark (${(T.progressAt(L.PLAYS[FL.play], 'NB', 0.4, L) * 100).toFixed(1)}%)`);
  }

  // ── check / truth / distractors ──
  // gun-2x2: X and Z end the line, H, Y and RB are off it, so the five eligible men are X, Z, H, Y, RB (fact sheet, eligible receivers).
  check(T.truth(SM, L) === 'H' && T.check(SM, 'H', L) && T.truth(FL, L) === 'RB' && T.check(FL, 'RB', L), 'truth is the play\'s throw: H on smash, RB on flood');
  check(sortJ(T.distractors(SM, L)) === sortJ(['X', 'Z', 'Y', 'RB']) && sortJ(T.distractors(FL, L)) === sortJ(['X', 'Z', 'H', 'Y']), `distractors are the other eligible receivers (${J(T.distractors(SM, L))}, ${J(T.distractors(FL, L))})`);
  check([...T.distractors(SM, L).map((a) => [SM, a]), ...T.distractors(FL, L).map((a) => [FL, a])].every(([p, a]) => !T.check(p, a, L)), 'every distractor fails check()');
  check(!T.check(SM, 'LT', L) && !T.check(SM, 'CB-L', L) && !T.check(SM, 'QB', L) && !T.check(SM, null, L) && !T.check(SM, { id: 'H' }, L), 'a lineman, a defender, the QB, nothing, and an object all fail check()');

  // ── validate ──
  const v = (pz, lib) => T.validate(pz, lib || L);
  const has = (errs, re) => errs.some((e) => re.test(e));
  const withPlay = (id, play) => ({ ...L, PLAYS: { ...L.PLAYS, [id]: { ...play, id } } });
  check(v(SM).length === 0 && v(FL).length === 0, `both examples validate clean ${J([...v(SM), ...v(FL)])}`);
  check(has(v({ ...SM, answer: 'X' }), /stored answer is X but the play throws to H/), 'validate: a stored answer the play does not throw to is refused');
  // The disagreeing fixture: the same smash, but the ball thrown to the hitch the corner sits on.
  const toX = CS.variantOf(L.PLAYS[SM.play], { tag: 'toX', ball: [{ t: 0, ev: 'snap' }, { t: 1.2, ev: 'throw', to: 'X' }, { t: 1.7, ev: 'catch' }] });
  const eX = v({ ...SM, play: 'fx-toX', answer: 'X' }, withPlay('fx-toX', toX));
  check(CS.validatePlay(toX).length === 0 && has(eX, /opens H, but the play throws to X/), `validate: a legal play whose throw disagrees with the sheet's read is refused ${J(eX)}`);
  const eOwn = (id) => v({ id: 't-' + id, type: 'predict', play: id, prompt: 'p', why: 'w', answer: CS.compile(L.PLAYS[id]).target });
  check(has(eOwn('post-dig-vs-c4'), /SS take Y, which opens Z, but the play throws to Y/), `validate: the library's own post-dig vs Cover 4 throws the dig its quarters safety is sitting on, and is refused ${J(eOwn('post-dig-vs-c4'))}`);
  check(has(eOwn('smash-vs-c2'), /runs on both sides/) && has(eOwn('smash-vs-c2'), /Y runs a corner, which beats cov:2/), 'validate: smash on both sides (the library play) is two right answers');
  check(has(eOwn('flood-vs-c3'), /X runs a hitch, which beats cov:3/), 'validate: a backside hitch vs Cover 3 (the library flood) is two right answers');
  check(has(eOwn('slant-flat-vs-c3'), /runs on both sides/), 'validate: slant-flat on both sides is two right answers even where one side is undecided');
  check(has(eOwn('stick-vs-c3'), /NB is 8\.3 yd from H and 8\.6 from Y.*has not chosen/), 'validate: a conflict defender equally near both men (stick vs Cover 3) is undecided and refused');
  check(has(eOwn('mesh-vs-c1'), /no documented two-way read/), 'validate: a concept with no two-way read on the sheet (mesh) is refused');
  const noThrow = CS.variantOf(L.PLAYS[SM.play], { tag: 'nt', ball: [{ t: 0, ev: 'snap' }] });
  check(has(v({ ...SM, play: 'fx-nt' }, withPlay('fx-nt', noThrow)), /no throw/), 'validate: a play with no throw is refused');
  let miss; try { miss = v({ ...SM, play: 'nope' }); } catch (e) { miss = ['threw']; }
  check(has(miss, /unknown play nope/), 'validate: a missing play is reported, not thrown');
  // The freeze. NB reaches half his drop at 0.5 x 7.211 / 6.8 = 0.5302 s.
  check(v({ ...FL, at: 0.52 }).length === 0 && has(v({ ...FL, at: 0.54 }), /NB is 5\d% of the way.*gives the answer away/), `validate: a read-point freeze is fine at 0.52 s (49%) and refused at 0.54 s (51%) ${J(v({ ...FL, at: 0.54 }))}`);
  check(has(v({ ...FL, at: 1.4 }), /at or after the throw/) && has(v({ ...FL, at: 2 }), /at or after the throw/), 'validate: a freeze at or after the throw is refused');
  check(has(v({ ...FL, at: 0 }), /must come after the snap/) && has(v({ ...FL, at: 'later' }), /at must be/), "validate: a numeric freeze at the snap, and a nonsense one, are refused ('snap' is the pre-snap read)");
  check(has(v({ ...SM, routes: true }), /route chalk/) && has(v({ ...SM, routes: ['H', 'X', 'Z'] }), /route chalk/) && v({ ...SM, routes: false }).length === 0, 'validate: route chalk must be exactly the concept receivers (or none)');
  check(has(v({ ...SM, zones: true }), /zone chalk/), 'validate: zone chalk (the drop drawn out) is refused');
  check(has(v({ ...SM, prompt: '' }), /no prompt/) && has(v({ ...SM, why: '' }), /no why/), 'validate: a prompt and a why are required');

  // ── outcome ──
  const ctxOf = (pz) => ({ pz, play: L.PLAYS[pz.play], lib: L, CS, focusMarks: [], nameOf: (id) => id, lc: (s) => s });
  const bad = [];
  for (const pz of [SM, FL]) {
    const c = CS.compile(L.PLAYS[pz.play]);
    if (T.outcome(pz, pz.answer, true, ctxOf(pz)) !== null) bad.push(`${pz.id}: right answer has runs`);
    for (const a of T.distractors(pz, L)) {
      const runs = T.outcome(pz, a, false, ctxOf(pz)), r0 = runs[0].play, c0 = CS.compile(r0);
      if (runs.length !== 2 || runs[1].play !== L.PLAYS[pz.play]) bad.push(`${pz.id}/${a}: not [failure, the real play]`);
      if (CS.validatePlay(r0).length) bad.push(`${pz.id}/${a}: ${CS.validatePlay(r0).join(';')}`);
      if (c0.throwT !== null || c0.T !== c.throwT || (r0.callouts || []).length) bad.push(`${pz.id}/${a}: failure run throws, has notes, or does not stop at ${c.throwT} (T ${c0.T})`);
      if (!runs[0].marks.some((m) => m.id === a && m.kind === 'bad') || !runs[0].say.focus.includes(a)) bad.push(`${pz.id}/${a}: his pick not ringed`);
      if (!/^The answer: /.test(runs[0].say.parts[0].text)) bad.push(`${pz.id}/${a}: bubble does not open with the answer`);
    }
  }
  check(bad.length === 0, `outcome: right = the play once; wrong = a legal run that stops on the throw without one (pick ringed, defender in the bubble), then the real play ${bad.slice(0, 3).join(' | ')}`);
}

export async function browser(H) {
  const { check, open, settle, plate } = H;
  const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
  for (const reduced of [false, true]) {
    const tag = reduced ? ' (reduced motion)' : '';
    const { page, errors } = await open(PHONE, { hash: '#map', reduced });
    const stage = async () => { await page.evaluate(() => { location.hash = '#unit/' + window.CS.RANK_DATA[0].units[0].id; }); await settle(page, 150); };
    // Put an example up through cs-ui and wait for the freeze (or not).
    const ask = (id, tries, wait = true) => page.evaluate(async (id, tries, wait) => {
      const CS = window.CS, C = window.__CS__, pz = CS.puzzleTypes.predict.examples.find((p) => p.id === id);
      C.ui.ask(pz, { tries, gameDay: tries === 1 });
      const out = { early: { t: C.t, playing: C.playing } };
      if (wait) { const t0 = Date.now(); while ((C.playing || C.field.freezing != null) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 30)); }
      out.t = C.t; out.playing = C.playing; out.want = CS.puzzleTypes.predict.freezeT(pz, CS.lib); out.xp = C.ui.state.xp;
      return out;
    }, id, tries, wait);
    // A real tap on a man: the centre of his painted sprite, confirmed by the field's own hit test.
    const tap = async (id) => {
      const at = await page.evaluate((id) => { const C = window.__CS__; if (!id) { const k = C.field.canvas.getBoundingClientRect(), x = (k.left + k.right) / 2, y = k.top + 24; return { x, y, hit: C.hitTest(x, y) }; } const r = C.spriteRect(id); const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2; return { x, y, hit: C.hitTest(x, y) }; }, id);
      await page.mouse.click(at.x, at.y); await settle(page, 60);
      return at;
    };
    const state = () => page.evaluate(() => { const C = window.__CS__; return { mode: C.ui.mode, xp: C.ui.state.xp, fb: document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim(), bubble: C.saying ? document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim() : '', focus: C.saying ? C.saying.focus : [], play: C.play.id, t: C.t, marks: C.field.marks }; });

    await stage();
    // Freeze points.
    const fs1 = await ask('pz-predict-ex-smash', 2);
    check(fs1.early.t < 0 && Object.is(fs1.t, 0) && fs1.want === 0 && !fs1.playing, `smash: the picture runs from before the snap and stops on t = 0 exactly${tag} (from ${fs1.early.t.toFixed(2)}, held at ${fs1.t})`);
    await page.evaluate(() => window.__CS__.ui.destroyOnly());
    await stage();
    // No answer before the freeze: a tap on the right man while the clock still runs.
    const pre = await page.evaluate(() => { const CS = window.CS, C = window.__CS__, pz = CS.puzzleTypes.predict.examples[1]; C.ui.ask(pz, { tries: 2 }); return { playing: C.playing, t: C.t }; });
    const preTap = await tap('RB');
    const preSt = await state();
    check(pre.playing && preSt.mode.tryNo === 1 && !preSt.mode.done && /Wait until the play stops/.test(preSt.fb), `a tap before the freeze is not an answer: no try used, "${preSt.fb}"${tag} (hit ${preTap.hit} at t ${preSt.t.toFixed(2)})`);
    const fl = await page.evaluate(async () => { const C = window.__CS__, t0 = Date.now(); while ((C.playing || C.field.freezing != null) && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 30)); return { t: C.t, playing: C.playing }; });
    check(fl.t === 0.4 && !fl.playing, `flood: the read-point freeze stops on t = 0.4 exactly${tag} (${fl.t})`);
    await page.evaluate(() => window.__CS__.ui.destroyOnly());

    if (reduced) { check(errors.length === 0, `zero page errors${tag} ${J(errors.slice(0, 3))}`); await page.close(); continue; }

    // Taps that are not guesses: a lineman, a defender, the quarterback, grass. None costs a try.
    await stage();
    const x0 = (await ask('pz-predict-ex-smash', 2)).xp;
    await plate(page, 'cs-pz-predict-frozen-390.png');
    const nudges = [];
    for (const [who, re] of [['LT', /can't catch a pass/], ['RG', /can't catch a pass/], ['CB-L', /on defense/], ['QB', /throwing it/], [null, /No player there/]]) {
      const at = await tap(who), s = await state();
      nudges.push({ who, hit: at.hit, ok: at.hit === who && s.mode.tryNo === 1 && !s.mode.done && re.test(s.bubble || s.fb), said: s.bubble || s.fb });
    }
    check(nudges.every((n) => n.ok), `a lineman, a defender, the QB and grass each get a nudge and cost no try ${J(nudges.filter((n) => !n.ok))}`);
    // Controls and the page: nothing under 44 px, no scroll.
    const lay = await page.evaluate(() => ({
      small: [...document.querySelectorAll('button, a, input')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: r.width, h: r.height }; }).filter((r) => r.w < 44 || r.h < 44),
      sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth,
    }));
    check(lay.small.length === 0, `every visible control is at least 44x44 px mid-puzzle ${J(lay.small)}`);
    check(lay.sh <= lay.ih && lay.sw <= lay.iw, `no page scroll at 390x844 mid-puzzle (${lay.sw}x${lay.sh})`);
    // Every eligible receiver can be tapped: a 44 px row through his sprite centre that hits him, at least 44 px wide.
    const reach = await page.evaluate(() => {
      const C = window.__CS__, CS = window.CS, T = CS.puzzleTypes.predict, pz = T.examples[0], out = [];
      for (const id of [T.truth(pz, CS.lib), ...T.distractors(pz, CS.lib)]) {
        const r = C.spriteRect(id), cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
        let lo = cx, hi = cx;
        while (lo > cx - 60 && C.hitTest(lo - 1, cy) === id) lo--;
        while (hi < cx + 60 && C.hitTest(hi + 1, cy) === id) hi++;
        out.push({ id, w: hi - lo + 1 });
      }
      return out;
    });
    check(reach.every((r) => r.w >= 44), `every eligible receiver's tap row is at least 44 px wide ${J(reach)}`);
    // Right on the first real tap: +10.
    const rt = await tap('H'), s1 = await state();
    check(rt.hit === 'H' && s1.mode.done && s1.mode.ok && s1.xp - x0 === 10 && /^Right\./.test(s1.bubble || s1.fb), `a real tap on the slot receiver: right, +10 XP on the first try (${s1.xp - x0}), "${(s1.bubble || s1.fb).slice(0, 40)}"`);
    check(s1.focus.includes('H') && s1.focus.includes('CB-L') && s1.marks.some((m) => m.id === 'H' && m.kind === 'good'), `the explanation points at the receiver and the corner whose choice opened him ${J(s1.focus)}`);
    await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });

    // Wrong, then right, in a lesson: +5.
    await stage();
    const x1 = (await ask('pz-predict-ex-flood', 2)).xp;
    const w1 = await tap('Y'), sw1 = await state();
    check(w1.hit === 'Y' && sw1.mode.tryNo === 2 && !sw1.mode.done && /^Not the .*One more try\./.test(sw1.bubble) && sw1.marks.some((m) => m.id === 'Y' && m.kind === 'bad'), `a wrong first tap keeps it open, rings his pick: "${sw1.bubble.slice(0, 60)}"`);
    const w2 = await tap('RB'), sw2 = await state();
    check(w2.hit === 'RB' && sw2.mode.done && sw2.mode.ok && sw2.xp - x1 === 5, `then the back: right on the second try, +5 XP (${sw2.xp - x1})`);
    await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });

    // Game Day, wrong: the failure run first, then the real play.
    await stage();
    await ask('pz-predict-ex-smash', 1);
    await tap('X');
    const g0 = await state();
    check(g0.mode.done && g0.mode.ok === false && g0.play === 'pz-predict-smash-c2~pick-X', `a wrong Game Day tap is final, and the failure run plays first (${g0.play})`);
    check(/^The answer: Slot receiver\. The cornerback took the X receiver/.test(g0.bubble) && J(g0.focus) === '["CB-L","X"]' && g0.marks.some((m) => m.id === 'X' && m.kind === 'bad'), `its bubble names the answer and points at the corner and his pick: "${g0.bubble}"`);
    const g1 = await page.evaluate(async () => {
      const C = window.__CS__, CS = window.CS, first = C.play.id, out = {};
      C.field.setSpeed(3);
      const t0 = Date.now();
      while (C.play.id === first && Date.now() - t0 < 8000) { out.lastT = C.t; await new Promise((r) => setTimeout(r, 10)); }
      out.endBall = CS.poseAt(CS.lib.PLAYS['pz-predict-smash-c2'], out.lastT).ball; out.second = C.play.id; out.runs = C.playing || C.t > C.PRE;
      while (C.playing && Date.now() - t0 < 12000) await new Promise((r) => setTimeout(r, 30));
      out.held = CS.poseAt(C.play, C.t).ball.held;
      C.field.setSpeed(1);
      return out;
    });
    check(g1.second === 'pz-predict-smash-c2' && g1.runs && g1.held === 'H', `when it ends, the real play runs and the slot receiver has the ball (${g1.second}, ${g1.held})`);
    check(g1.lastT > 2.2, `the failure run went on to the moment of the throw (2.4 s) before handing over (last frame seen ${g1.lastT.toFixed(2)})`);
    // The plate after a wrong answer: replay the failure run and hold its last frame (the throw that is not there).
    await page.evaluate(async () => { const C = window.__CS__; document.getElementById('btnReplay').click(); C.field.pause(); C.seek(2.4); await new Promise((r) => setTimeout(r, 300)); });
    const pl = await state();
    check(pl.play === 'pz-predict-smash-c2~pick-X' && Math.abs(pl.t - 2.4) < 1e-9, 'Replay starts the list again from the failure run');
    await plate(page, 'cs-pz-predict-wrong-390.png');
    await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });

    // destroy() before the freeze: the clock stops where it is and nothing is left behind.
    await stage();
    // Elements on the page, not counting the insides of cs-ui's bubble, its arrows and the feedback line (they change with every answer).
    await page.evaluate(() => { window.__els = () => { const skip = ['bubble', 'tails', 'stFb'].map((id) => document.getElementById(id)); return [...document.querySelectorAll('*')].filter((e) => !skip.some((s) => s && s !== e && s.contains(e))).length; }; });
    const base = await page.evaluate(() => { const F = window.__CS__.field, op = document.getElementById('stOpts'); return { els: window.__els(), ov: F.overlay.count, drags: F.drags.length, opts: op.children.length }; });
    const d = await page.evaluate(async () => {
      const CS = window.CS, C = window.__CS__, F = C.field;
      C.ui.ask(CS.puzzleTypes.predict.examples[0], { tries: 2 });
      await new Promise((r) => setTimeout(r, 120));
      const was = { playing: C.playing, freezing: F.freezing };
      C.ui.destroyOnly();
      const t1 = C.t;
      await new Promise((r) => setTimeout(r, 1500));
      const op = document.getElementById('stOpts');
      return { was, playing: C.playing, freezing: F.freezing, moved: C.t !== t1, ov: F.overlay.count, drags: F.drags.length, opts: op.children.length };
    });
    const after = await page.evaluate(() => window.__els());
    check(d.was.playing && d.was.freezing === 0 && !d.playing && d.freezing === null && !d.moved, `destroy() during the run-up cancels its own freeze: the clock stops and stays (${J(d)})`);
    check(d.ov === base.ov && d.drags === base.drags && d.opts === base.opts && after === base.els, `destroy() leaves no element, overlay, drag or panel control (${base.els} -> ${after} elements)`);
    check(errors.length === 0, `zero page errors${tag} ${J(errors.slice(0, 3))}`);
    await page.close();
  }
}
