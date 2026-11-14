/**
 * Puzzle type PLACE (assets/coachschool/cs-pz-place.js): drag players to their alignments or drop
 * landmarks. Brief: docs/coachschool-puzzle-types.md.
 *
 *   node:    the targets are the fact sheet's numbers, written here by hand (4 zone landmarks, 1d
 *            4-3 Over linebackers, 1b trips); the checker's tolerance at its inclusive edge and just
 *            past it, and the on-the-line cut; validate() catches two right answers (two corners
 *            with no swap group), a tolerance wider than half the gap between two landmarks, a
 *            start already on a landmark, a stored answer that is not the library's, a zone that
 *            is not his job; every wrong run is a legal play and moves exactly the misplaced men.
 *   browser: real pointer drags while zoomed, each drop's yards = the handle's start + the
 *            pointer's travel in screenToYard, snapped to the hand-listed landmark; Lock it in shows
 *            only once every man is down; right first try = +10 XP; a wrong answer runs the failure
 *            first (his alignment, its bubble, zone chalk for the movers only), then the right play;
 *            destroy() leaves nothing; 44 px handles and button; no page scroll at 390x844; plates.
 */
const J = JSON.stringify;

export async function node(H) {
  const { CS, L, check, near, loadVm } = H;
  const T = CS.puzzleTypes.place;
  check(!!T && T.name === 'place', 'place: registered as CS.puzzleTypes.place');
  if (!T) return;
  const ex = Object.fromEntries(T.examples.map((p) => [p.id, p]));
  check(T.examples.length >= 2 && T.examples.every((p) => L.PLAYS[p.play] && !/^pz-place-/.test(p.play)), `place: ${T.examples.length} examples, every one on a library play (${T.examples.map((p) => p.play).join(', ')})`);
  for (const pz of T.examples) check(T.validate(pz, L).length === 0, `place: ${pz.id} validates ${J(T.validate(pz, L))}`);

  // Truth = the fact sheet's numbers, typed here from the sheet (not read from the library).
  const c3 = ex['pz-place-c3-deep'], lb = ex['pz-place-43-lb'], tr = ex['pz-place-trips'];
  // Fact sheet 4: deep third L / M / R drop landmarks (9,16) / (26.67,16) / (44.33,16); 5a Cover 3: CB-L deep third L, CB-R deep third R, FS deep middle third.
  check(J(T.truth(c3, L)) === J({ 'CB-L': { x: 9, y: 16 }, 'CB-R': { x: 44.33, y: 16 }, FS: { x: 26.67, y: 16 } }), `c3-deep: truth is fact sheet 4's deep thirds ${J(T.truth(c3, L))}`);
  // Fact sheet 1d, 4-3 Over: Sam (32.67,4.5), Mike (27.67,4.5), Will (24.17,4.5).
  check(J(T.truth(lb, L)) === J({ SAM: { x: 32.67, y: 4.5 }, MIKE: { x: 27.67, y: 4.5 }, WILL: { x: 24.17, y: 4.5 } }), `43-lb: truth is fact sheet 1d's 4-3 Over linebackers ${J(T.truth(lb, L))}`);
  // Fact sheet 1b, trips 3x1 right: Y #3 (34.67,-1), H #2 (39.67,-1).
  check(J(T.truth(tr, L)) === J({ H: { x: 39.67, y: -1 }, Y: { x: 34.67, y: -1 } }), `trips: truth is fact sheet 1b's trips right ${J(T.truth(tr, L))}`);

  // The checker, at the edge of each tolerance. Every number below is the truth plus a hand offset.
  const ok = (pz, a) => T.check(pz, a, L);
  const C3 = { 'CB-L': { x: 9, y: 16 }, 'CB-R': { x: 44.33, y: 16 }, FS: { x: 26.67, y: 16 } };
  const w = (base, id, p) => ({ ...base, [id]: p });
  check(ok(c3, C3), 'c3-deep: the three on their thirds is right');
  check(ok(c3, w(C3, 'FS', { x: 26.67, y: 17 })), 'c3-deep: FS exactly 1 yd (tol 1) deeper than his landmark is right (inclusive edge)');
  check(ok(c3, w(C3, 'FS', { x: 26.67 + 0.6, y: 16 + 0.8 })), 'c3-deep: FS 0.6 across and 0.8 deep (a 3-4-5 triangle: exactly 1 yd) is right');
  check(!ok(c3, w(C3, 'FS', { x: 26.67, y: 17.01 })), 'c3-deep: FS 1.01 yd off is wrong');
  check(!ok(c3, w(C3, 'FS', { x: 26.67 + 0.71, y: 16 + 0.71 })), 'c3-deep: FS 0.71 and 0.71 off (1.004 yd) is wrong');
  check(ok(c3, { 'CB-L': C3['CB-R'], 'CB-R': C3['CB-L'], FS: C3.FS }), 'c3-deep: the two corners swapped is right (one swap group: he cannot tell them apart)');
  check(!ok(c3, { 'CB-L': C3.FS, 'CB-R': C3['CB-R'], FS: C3['CB-L'] }), 'c3-deep: a corner and the free safety swapped is wrong (different names, different jobs)');
  check(!ok(c3, w(C3, 'FS', { x: 35.33, y: 16 })), 'c3-deep: FS on the deep right half landmark (35.33,16) is wrong');
  check(!ok(c3, { 'CB-L': C3['CB-L'], 'CB-R': C3['CB-R'] }), 'c3-deep: a mover left out is wrong');
  check(!ok(c3, { ...C3, QB: { x: 26.67, y: -5 } }), 'c3-deep: an extra man in the answer is wrong');
  check(!ok(c3, null) && !ok(c3, []) && !ok(c3, w(C3, 'FS', { x: '26.67', y: 16 })), 'c3-deep: null, an array and a string yard are wrong');
  const LB = { SAM: { x: 32.67, y: 4.5 }, MIKE: { x: 27.67, y: 4.5 }, WILL: { x: 24.17, y: 4.5 } };
  check(ok(lb, w(LB, 'MIKE', { x: 27.67 + 0.7, y: 4.5 })) && !ok(lb, w(LB, 'MIKE', { x: 27.67 + 0.71, y: 4.5 })), '43-lb: Mike 0.70 yd off is right, 0.71 off is wrong (tol 0.7)');
  check(!ok(lb, w(LB, 'MIKE', { x: 29.17, y: 4.5 })), "43-lb: Mike on the Will's spot mirrored (29.17 = 2 x 26.67 - 24.17) is wrong");
  check(!ok(lb, { SAM: { x: 20.67, y: 4.5 }, MIKE: LB.MIKE, WILL: LB.WILL }), '43-lb: Sam on the weak side (20.67, his spot mirrored) is wrong');
  check(!ok(lb, { SAM: LB.SAM, MIKE: LB.WILL, WILL: LB.MIKE }), '43-lb: Mike and Will swapped is wrong (the sheet names each one)');
  const TR = { H: { x: 39.67, y: -1 }, Y: { x: 34.67, y: -1 } };
  check(ok(tr, w(TR, 'H', { x: 40.67, y: -1 })) && !ok(tr, w(TR, 'H', { x: 40.68, y: -1 })), 'trips: H 1.00 yd wide is right, 1.01 wide is wrong (tol 1)');
  check(!ok(tr, w(TR, 'H', { x: 39.67, y: -0.5 })) && ok(tr, w(TR, 'H', { x: 39.67, y: -0.51 })), 'trips: H 0.5 yd up, ON the line (y -0.5, 8 on it) is wrong though within 1 yd; at -0.51 he is still off it and right');
  check(!ok(tr, w(TR, 'Y', { x: 34.67, y: 0 })), 'trips: Y on the line (y 0), 1 yd from his spot, is wrong');

  // validate(): what it must refuse.
  const errs = (pz) => T.validate(pz, L);
  const noSwap = { ...c3, id: 'fx-noswap', swap: undefined };
  const e1 = errs(noSwap);
  check(e1.some((m) => /CB-L and CB-R are both "Cornerback"/.test(m) && /swap/.test(m)), `validate: two corners with no swap group are two right answers ${J(e1)}`);
  const wide = errs({ ...lb, id: 'fx-wide', tol: 0.75 });
  check(wide.some((m) => /1\.50 yd apart/.test(m)), `validate: tol 0.75 against landmarks 1.50 yd apart (Mike 27.67, Will mirrored 29.17) is refused ${J(wide.slice(0, 1))}`);
  check(errs({ ...lb, id: 'fx-tol74', tol: 0.74, answer: lb.answer }).length === 0, 'validate: tol 0.74 there is accepted (1.48 < 1.50)');
  check(errs({ ...c3, id: 'fx-big', tol: 1.6 }).some((m) => /at most 1\.5/.test(m)), 'validate: tol above 1.5 is refused');
  const onMark = errs({ ...lb, id: 'fx-start', from: { ...lb.from, MIKE: { x: 27.67, y: 5 } } });
  check(onMark.some((m) => /MIKE starts 0\.50 yd from landmark MIKE/.test(m) && /and right/.test(m)), `validate: a start 0.5 yd from his own spot (he would start right) is refused ${J(onMark)}`);
  const badAns = errs({ ...tr, id: 'fx-ans', answer: { H: { x: 34.67, y: -1 }, Y: { x: 39.67, y: -1 } } });
  check(badAns.some((m) => /stored answer/.test(m)), `validate: a stored answer that is not the library's is refused ${J(badAns)}`);
  const notJob = errs({ ...c3, id: 'fx-job', at: { ...c3.at, FS: 'deep-half-L' } });
  check(notJob.some((m) => /FS's target is deep-half-L, but his job in c3-nickel is deep-third-M/.test(m)), `validate: a zone that is not his job in the library is refused ${J(notJob)}`);
  check(errs({ ...tr, id: 'fx-nofrom', from: undefined }).some((m) => /needs a start/.test(m)), 'validate: an alignment target with no start is refused');
  check(errs({ ...c3, id: 'fx-trap', trap: { FS: 'deep-third-M' } }).some((m) => /trap is a right answer/.test(m)), 'validate: a trap that is the right answer is refused');
  const nop = T.validate({ ...c3, play: 'no-such-play' }, L);
  check(nop.length === 1 && /unknown play/.test(nop[0]), 'validate: a missing play is reported, not thrown');

  // The wrong runs, in a fresh vm (they register a formation / defense copy per puzzle).
  const V = loadVm().CS, VL = V.lib, VT = V.puzzleTypes.place;
  for (const pz of VT.examples) {
    const bad = VT.distractors(pz, VL)[0], r = VT.wrongPlay(pz, bad, VL);
    check(!!r.play && V.validatePlay(r.play, VL).length === 0 && r.play.id === pz.play + '~wrong', `${pz.id}: the trap's wrong run is a legal play (${r.play && r.play.id}) ${J(r.errors)}`);
  }
  {
    const pz = VT.examples.find((p) => p.id === 'pz-place-c3-deep'), r = VT.wrongPlay(pz, { ...C3, FS: { x: 35.33, y: 16 } }, VL);
    const cw = V.compile(r.play, VL), cr = V.compile(VL.PLAYS[pz.play], VL);
    const fsEnd = cw.byId.FS.path.pts[cw.byId.FS.path.pts.length - 1];
    const same = cw.def.filter((p) => p.id !== 'FS').every((p) => J(p.path.pts) === J(cr.byId[p.id].path.pts));
    check(J(fsEnd) === J([35.33, 16]) && cw.byId.FS.x === 18 && cw.byId.FS.y === 12 && same, `c3-deep wrong run: FS lines up where he does (18,12) and drops to the deep right half (35.33,16); nobody else changes ${J(fsEnd)}`);
    const words = VT.wrongWords(pz, { ...C3, FS: { x: 35.33, y: 16 } }, VL, r).map((p) => (typeof p === 'string' ? p : p.text)).join('');
    check(/drops to the deep right half\./.test(words) && /Nobody has the deep middle third\./.test(words), `c3-deep wrong run: the bubble names the empty zone (${words})`);
    const raw = VT.wrongPlay(pz, { ...C3, FS: { x: 30, y: 19 } }, VL), cr2 = V.compile(raw.play, VL);
    check(cr2.byId.FS.x === 30 && cr2.byId.FS.y === 19 && cr2.byId.FS.role === 'still', 'c3-deep wrong run: a drop on no landmark puts him there, standing (30,19)');
  }
  {
    const pz = VT.examples.find((p) => p.id === 'pz-place-43-lb');
    const r = VT.wrongPlay(pz, { SAM: { x: 20.67, y: 4.5 }, MIKE: { x: 27.67, y: 4.5 }, WILL: { x: 24.17, y: 4.5 } }, VL);
    check(r.play === null && r.errors.some((m) => /SAM lines up L, but the strength is R/.test(m)), `43-lb wrong run: Sam on the weak side is not a legal lineup in the library, so no variant ${J(r.errors.slice(0, 1))}`);
    const words = VT.wrongWords(pz, { SAM: { x: 20.67, y: 4.5 }, MIKE: LB.MIKE, WILL: LB.WILL }, VL, r).map((p) => (typeof p === 'string' ? p : p.text)).join('');
    check(/strong-side linebacker, to the tight end/.test(words) && /runs from the right spots/.test(words), `43-lb wrong run: the bubble carries the sheet's Sam line instead (${words})`);
    const mw = VT.wrongPlay(pz, { SAM: LB.SAM, MIKE: LB.WILL, WILL: LB.MIKE }, VL), cm = V.compile(mw.play, VL);
    check(cm.byId.MIKE.x === 24.17 && cm.byId.WILL.x === 27.67 && cm.byId.SAM.x === 32.67, 'trap Mike/Will swap: the wrong run lines Mike up at 24.17 and Will at 27.67, Sam unmoved');
  }
  {
    const pz = VT.examples.find((p) => p.id === 'pz-place-trips');
    const r = VT.wrongPlay(pz, { H: { x: 39.67, y: 0 }, Y: { x: 34.67, y: -1 } }, VL);
    check(r.play === null && r.errors.some((m) => /8 on the line/.test(m)), `trips wrong run: H stood on the line makes 8 on it, refused ${J(r.errors.slice(0, 1))}`);
    // Mirrored play: a man's yards map back through the mirror into the formation copy.
    const play = { ...VL.PLAYS[pz.play], id: 'fx-mirror', mirror: true };
    VL.PLAYS['fx-mirror'] = play;
    const mz = { ...pz, id: 'fx-mirror-pz', play: 'fx-mirror', from: { H: { x: 53.33 - 15, y: -1 }, Y: { x: 53.33 - 38.33, y: -1 } } };
    const t0 = VT.truth(mz, VL);
    check(near(t0.H.x, 2 * 26.67 - 39.67, 1e-9) && near(t0.Y.x, 2 * 26.67 - 34.67, 1e-9), `mirrored play: truth is the trips spots mirrored (H ${t0.H.x}, Y ${t0.Y.x})`);
    const mr = VT.wrongPlay(mz, { H: t0.Y, Y: t0.H }, VL), mc = V.compile(mr.play, VL);
    check(!!mr.play && near(mc.byId.H.x, t0.Y.x, 1e-9) && near(mc.byId.Y.x, t0.H.x, 1e-9), `mirrored play: the wrong run puts H and Y where he dropped them (${mc.byId.H.x}, ${mc.byId.Y.x})`);
  }
  check(!/document|window\./.test(T.check.toString() + T.truth.toString() + T.validate.toString()), 'place: the pure half touches no DOM');
}

export async function browser(H) {
  const { check, open, settle, plate } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#map' });
  const unit0 = await page.evaluate(() => window.CS.RANK_DATA[0].units[0].id);
  const bare = async () => { await page.evaluate((u) => { location.hash = '#unit/' + u; }, unit0); await settle(page, 150); };
  const snap = () => page.evaluate(() => {
    const F = window.__CS__.field, op = document.getElementById('stOpts');
    return { els: document.querySelectorAll('*').length - document.querySelectorAll('#bubble *, #tails *, #stFb *').length, ov: F.overlay.count, drags: F.drags.length, moved: Object.keys(F.moved).length, opts: op.children.length, optsHidden: op.offsetParent === null, touch: F.canvas.style.touchAction };
  });
  const ask = (id, tries) => page.evaluate((id, tries) => {
    const pz = window.CS.puzzleTypes.place.examples.find((p) => p.id === id);
    window.__CS__.ui.ask(pz, { tries, gameDay: tries === 1 });
  }, id, tries);
  // One real drag: press the handle's centre, move in steps, let go at handle + (screen(aim) - screen(start)).
  // Returns where the finger went and the yards the page should compute from it.
  async function dragTo(key, aim) {
    const g = await page.evaluate((key, aim) => {
      const C = window.__CS__, h = C.field.drags[0].handles.find((q) => q.key === key);
      const a = C.yardToScreen(h.x, h.y), b = C.yardToScreen(aim.x, aim.y);
      const from = { x: h.cx, y: h.cy }, to = { x: h.cx + b.x - a.x, y: h.cy + b.y - a.y };
      // The raw drop the page should compute: his start plus the pointer's travel, through screenToYard.
      const A = C.screenToYard(from.x, from.y), B = C.screenToYard(to.x, to.y), r = C.field.canvas.getBoundingClientRect();
      return { from, to, raw: { x: h.x + B.x - A.x, y: h.y + B.y - A.y }, rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100).join(',') };
    }, key, aim);
    await page.mouse.move(g.from.x, g.from.y); await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(g.from.x + (g.to.x - g.from.x) * i / 8, g.from.y + (g.to.y - g.from.y) * i / 8);
    await page.mouse.up(); await settle(page, 40);
    const pos = await page.evaluate((key) => window.__CS__.field.drags[0].handles.find((q) => q.key === key), key);
    const rect = await page.evaluate(() => { const r = window.__CS__.field.canvas.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100).join(','); });
    return { raw: g.raw, pos: { x: pos.x, y: pos.y }, steady: rect === g.rect };
  }
  // Nearest of the listed landmarks within tol (written here, not CS.snapTo), else the raw drop.
  const snapBy = (raw, marks, tol) => { let b = null; for (const m of marks) { const d = Math.hypot(m.x - raw.x, m.y - raw.y); if (d <= tol + 1e-9 && (!b || d < b.d)) b = { ...m, d }; } return b ? { x: b.x, y: b.y } : raw; };
  const mainBtn = () => page.evaluate(() => { const b = document.getElementById('btnMain'), r = b.getBoundingClientRect(); return { shown: b.offsetParent !== null, text: b.textContent.trim(), w: r.width, h: r.height, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

  // 1. Linebackers, lesson, zoomed: three real drags, then Lock it in; first try = +10 XP.
  await bare();
  const base = await snap();
  const xp0 = await page.evaluate(() => window.__CS__.ui.state.xp);
  await ask('pz-place-43-lb', 2);
  await settle(page, 700);   // the camera's 480 ms ease
  const up = await page.evaluate(() => {
    const C = window.__CS__, F = C.field, hs = F.drags.length ? F.drags[0].handles : [];
    return { z: C.camera.z, hs, sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth, touch: F.canvas.style.touchAction };
  });
  // Hand-listed: the from row of the puzzle (22.67 / 26.67 / 30.67 at 8.5 yd).
  check(up.hs.length === 3 && J(up.hs.map((h) => [h.key, h.x, h.y])) === J([['SAM', 22.67, 8.5], ['MIKE', 26.67, 8.5], ['WILL', 30.67, 8.5]]), `43-lb: the three start on the neutral row, Sam on the weak side ${J(up.hs.map((h) => [h.key, h.x, h.y]))}`);
  check(up.z > 1.2, `43-lb: the puzzle is zoomed in (camera z ${up.z.toFixed(2)})`);
  check(up.hs.every((h) => h.r >= 22), `43-lb: every drag handle is at least 44 px across (${up.hs.map((h) => h.r * 2).join(', ')})`);
  check(up.sh <= up.ih && up.sw <= up.iw, `43-lb: no page scroll at 390x844 (${up.sw}x${up.sh})`);
  const lk0 = await mainBtn();
  check(lk0.shown && /Lock it in/.test(lk0.text) && lk0.w >= 44 && lk0.h >= 44, `43-lb: Lock it in is up from the start (the field never resizes mid-puzzle), ${lk0.w.toFixed(0)}x${lk0.h.toFixed(0)} px`);
  // Landmarks by hand: 1d's three spots and their mirrors across the ball (2 x 26.67 - x), at 4.5 yd.
  const LBM = [32.67, 27.67, 24.17, 20.67, 25.67, 29.17].map((x) => ({ x, y: 4.5 }));
  const want = { SAM: { x: 32.67, y: 4.5 }, MIKE: { x: 27.67, y: 4.5 }, WILL: { x: 24.17, y: 4.5 } };
  const drops = {};
  // Aim a little off each spot (0.3 across, 0.25 deep: 0.39 yd, inside tol 0.7) so the snap is what lands him.
  for (const k of ['SAM', 'MIKE']) drops[k] = await dragTo(k, { x: want[k].x + 0.3, y: want[k].y + 0.25 });
  await page.mouse.click(lk0.x, lk0.y); await settle(page, 120);
  const early = await page.evaluate(() => { const C = window.__CS__; return { z: C.camera.z, mode: C.ui.mode, saying: C.saying, bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim() }; });
  check(early.z === up.z && !early.mode.done && early.mode.tryNo === 1 && J(early.saying && early.saying.focus) === J(['WILL']) && /Move the Will linebacker first\./.test(early.bubble), `43-lb: Lock it in with the Will unmoved costs no try, names him and keeps the zoom (z ${early.z}) (${early.bubble})`);
  await plate(page, 'pz-place-lb-mid.png');
  drops.WILL = await dragTo('WILL', { x: want.WILL.x - 0.3, y: want.WILL.y - 0.25 });
  for (const k of ['SAM', 'MIKE', 'WILL']) {
    const exp = snapBy(drops[k].raw, LBM, 0.7);
    check(drops[k].steady && J(drops[k].pos) === J(exp) && J(exp) === J(want[k]), `43-lb: ${k} dropped while zoomed lands on screenToYard(drop) snapped: raw (${drops[k].raw.x.toFixed(2)}, ${drops[k].raw.y.toFixed(2)}) -> ${J(drops[k].pos)}`);
  }
  const lockBtn = await mainBtn();
  await page.mouse.click(lockBtn.x, lockBtn.y); await settle(page, 200);
  const r1 = await page.evaluate(() => { const C = window.__CS__; return { mode: C.ui.mode, xp: C.ui.state.xp, play: C.play.id, drags: C.field.drags.length, chalk: C.field.chalk, bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim() }; });
  check(r1.mode.done && r1.mode.ok === true && r1.mode.tryNo === 1, `43-lb: three real drags + Lock it in is right on the first try ${J(r1.mode)}`);
  check(r1.xp - xp0 === 10, `43-lb: first try pays +10 XP (${xp0} -> ${r1.xp})`);
  check(r1.drags === 0 && r1.play === 'smash-vs-c2' && J(r1.chalk && r1.chalk.zones.slice().sort()) === J(['MIKE', 'SAM', 'WILL']), `43-lb: right: the drag is gone and the library play runs, zone chalk for the three alone ${J(r1.chalk)}`);
  check(/^Right\./.test(r1.bubble), `43-lb: the explanation opens "Right." (${r1.bubble.slice(0, 50)})`);
  await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });
  await bare();
  const a1 = await snap();
  check(J(a1) === J(base), `43-lb: after destroy() nothing is left (elements, overlays, drags, moved men, panel, touch-action) ${J(base)} -> ${J(a1)}`);

  // 2. Cover 3 deep, lesson: a wrong first try keeps it open with the misplaced man ringed.
  await ask('pz-place-c3-deep', 2);
  await settle(page, 300);
  const DEEP = [[9, 16], [26.67, 16], [44.33, 16], [18, 16], [35.33, 16], [7, 14], [20, 14], [33.33, 14], [46.33, 14]].map(([x, y]) => ({ x, y }));
  const d1 = {};
  d1['CB-L'] = await dragTo('CB-L', { x: 9.4, y: 15.6 });
  d1['CB-R'] = await dragTo('CB-R', { x: 44.0, y: 16.4 });
  d1.FS = await dragTo('FS', { x: 35.0, y: 16.5 });          // the deep right half: wrong
  check(['CB-L', 'CB-R', 'FS'].every((k) => J(d1[k].pos) === J(snapBy(d1[k].raw, DEEP, 1))) && J(d1.FS.pos) === J({ x: 35.33, y: 16 }), `c3-deep: drops snap to the hand-listed deep landmarks (FS -> ${J(d1.FS.pos)})`);
  const lb2 = await mainBtn();
  await page.mouse.click(lb2.x, lb2.y); await settle(page, 150);
  const m1 = await page.evaluate(() => { const C = window.__CS__; return { mode: C.ui.mode, drags: C.field.drags.length, saying: C.saying, bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim() }; });
  check(!m1.mode.done && m1.mode.tryNo === 2 && m1.drags === 1, `c3-deep: a wrong first try keeps the drag up for one more ${J(m1.mode)}`);
  check(m1.saying && J(m1.saying.focus) === J(['FS']) && /free safety/.test(m1.bubble), `c3-deep: the miss points at the free safety alone (${m1.bubble})`);
  // Lock it in again without moving him: no try spent; then move him right and the second try is right.
  await page.mouse.click(lb2.x, lb2.y); await settle(page, 120);
  const m2 = await page.evaluate(() => window.__CS__.ui.mode);
  check(!m2.done && m2.tryNo === 2, `c3-deep: Lock it in again before the free safety is moved again spends nothing ${J(m2)}`);
  await dragTo('FS', { x: 26.67, y: 16.4 });
  await page.mouse.click(lb2.x, lb2.y); await settle(page, 150);
  const m3 = await page.evaluate(() => ({ mode: window.__CS__.ui.mode, xp: window.__CS__.ui.state.xp }));
  check(m3.mode.done && m3.mode.ok === true && m3.mode.tryNo === 2 && m3.xp - r1.xp === 5, `c3-deep: moved onto the deep middle third, the second try is right and pays +5 XP (${r1.xp} -> ${m3.xp})`);
  await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });

  // 3. Cover 3 deep, Game Day: wrong is final; the failure runs first, then the right play.
  await bare();
  await ask('pz-place-c3-deep', 1);
  await settle(page, 300);
  await dragTo('CB-L', { x: 44.33, y: 16 });                 // the corners crossed: allowed (swap group)
  await dragTo('CB-R', { x: 9, y: 16 });
  await dragTo('FS', { x: 35.33, y: 16.3 });
  const lb3 = await mainBtn();
  await page.mouse.click(lb3.x, lb3.y); await settle(page, 400);
  const o1 = await page.evaluate(() => { const C = window.__CS__; return { mode: C.ui.mode, play: C.play.id, chalk: C.field.chalk, saying: C.saying, bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim(), fb: document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim(), running: C.playing || C.t > C.PRE, lib: Object.keys(window.CS.lib.FORMATIONS).concat(Object.keys(window.CS.lib.DEFENSES)).filter((k) => k.startsWith('pz-place~')) }; });
  check(o1.mode.done && o1.mode.ok === false, `c3-deep: on Game Day the wrong lineup is final and scores wrong ${J(o1.mode)}`);
  check(o1.play === 'four-verts-vs-c3~wrong' && o1.running, `c3-deep: the failure runs first (${o1.play})`);
  // Restaged 2026-11-12 (outcome bubbles): the answer is named in the panel; the run's bubble says
  // only what his lineup costs (it used to open "The answer:" and cover the explanation).
  check(/^The answer: Each corner to the deep third on his side/.test(o1.fb) && o1.mode.explain === 'panel' && /^The free safety drops to the deep right half\. Nobody has the deep middle third\.$/.test(o1.bubble) && J(o1.saying.focus) === J(['FS']), `c3-deep: the panel names the answer, and the run's bubble names the empty deep third and points at FS (${o1.fb.slice(0, 40)} | ${o1.bubble})`);
  // 2026-11-12: the wrong run moves his men with CS.variantOf's align; nothing is registered.
  check(o1.lib.length === 0, `c3-deep: the wrong run registers no pz-place~ formation or defense in the library ${J(o1.lib)}`);
  check(J(o1.chalk && o1.chalk.zones) === J(['CB-L', 'CB-R', 'FS']), `c3-deep: zone chalk only for the three he moved ${J(o1.chalk)}`);
  const fsWrong = await page.evaluate(() => { const c = window.CS.compile(window.__CS__.play), p = c.byId.FS.path.pts; return p[p.length - 1]; });
  check(J(fsWrong) === J([35.33, 16]), `c3-deep: in the failure run FS drops to (35.33,16), the deep right half (fact sheet 4) ${J(fsWrong)}`);
  await page.evaluate(() => { const F = window.__CS__.field; F.pause(); F.seek(2.2); });
  await plate(page, 'pz-place-c3-wrong.png');
  const o2 = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, first = C.play.id;
    F.setSpeed(4); F.start();
    const t0 = Date.now();
    while (C.play.id === first && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
    const out = { play: C.play.id, chalk: F.chalk, running: C.playing || C.t > C.PRE, saying: !!C.saying, fb: document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim() };
    F.setSpeed(1); F.pause();
    return out;
  });
  // Restaged 2026-11-12: the explanation stays in the panel through the right run (it used to come
  // back as the bubble); no bubble on the field.
  check(o2.play === 'four-verts-vs-c3' && o2.running && /^The answer: /.test(o2.fb) && !o2.saying, `c3-deep: then the right play runs, the explanation still in the panel, no bubble (${o2.play}: ${o2.fb.slice(0, 70)})`);
  await page.evaluate(() => window.__CS__.ui.destroyOnly());
  await bare();
  const a3 = await snap();
  check(J(a3) === J(base), `c3-deep: after destroy() nothing is left ${J(a3)}`);
  check(errors.length === 0, `place: zero page errors ${J(errors.slice(0, 3))}`);
  await page.close();
}
