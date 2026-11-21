/**
 * Puzzle-type contract conformance (docs/coachschool-puzzle-types.md). Runs for EVERY type in
 * CS.puzzleTypes, so a new cs-pz-<type>.js is held to it the moment it registers, with no edit here.
 *
 *   node: the contract's members exist; every content puzzle of the type and every one of its
 *         `examples` validates, truth() is the stored answer and passes check(), every distractor
 *         fails, answers survive JSON (the page and the suite pass them as JSON), check() neither
 *         mutates the puzzle nor changes its mind, and validate() reports a missing play instead of
 *         throwing. A type with neither content nor examples fails: a check over nothing is no check.
 *   page: each type's puzzles go up through cs-ui's own askPuzzle (lessons: 2 tries; Game Day: 1).
 *         Its controls are buttons or other focusable controls at least 44x44 px, drag handles at
 *         least 44 px across, and there is a way to answer (a control, a field tap, or a drag). Right
 *         answers score right, wrong ones wrong, the explanation names the answer, the bubble points
 *         only at things on the field, and the play runs. Then the type's OWN destroy() (no cs-ui
 *         sweep) must leave the stage as it found it: no element, live listener, overlay, drag
 *         session or moved player left behind.
 */
const JSONeq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function puzzlesByType(CS) {
  const out = {};
  for (const name of Object.keys(CS.puzzleTypes)) out[name] = { content: [], examples: (CS.puzzleTypes[name].examples || []).slice() };
  for (const R of CS.RANK_DATA || []) {
    if (!R) continue;
    for (const pz of [...R.units.flatMap((u) => u.puzzles), ...(R.gameDay || [])]) if (out[pz.type]) out[pz.type].content.push(pz);
  }
  return out;
}

export async function node(H) {
  const { check, loadVm } = H;
  // A fresh vm, nothing but the page's own files: the pure half really is pure.
  const CS = loadVm().CS, L = CS.lib;
  const names = Object.keys(CS.puzzleTypes).sort();
  check(names.includes('tap') && names.includes('choice'), `puzzle types registered: ${names.join(', ')}`);
  const by = puzzlesByType(CS);
  for (const name of names) {
    const T = CS.puzzleTypes[name], ce = CS.contractErrors(T, name);
    check(ce.length === 0, `${name}: has the contract's members ${ce.join('; ')}`);
    if (ce.length) continue;
    const all = [...by[name].content, ...by[name].examples];
    check(all.length >= 1, `${name}: ${by[name].content.length} content puzzles + ${by[name].examples.length} examples (needs at least one)`);
    const bad = { val: [], truth: [], ans: [], dis: [], json: [], pure: [] };
    for (const pz of all) {
      if (pz.type !== name) { bad.val.push(`${pz.id}: type ${pz.type}`); continue; }
      const snap = JSON.stringify(pz);
      const e = CS.validatePuzzle(pz, L);
      if (e.length) { bad.val.push(e.join('; ')); continue; }
      const tr = T.truth(pz, L);
      if (!CS.checkPuzzle(pz, tr, L) || ('answer' in pz && !JSONeq(tr, pz.answer))) bad.truth.push(`${pz.id}: truth ${JSON.stringify(tr)}, stored ${JSON.stringify(pz.answer)}`);
      if ('answer' in pz && !CS.checkPuzzle(pz, pz.answer, L)) bad.ans.push(pz.id);
      if (!JSONeq(JSON.parse(JSON.stringify(tr)), tr) || !CS.checkPuzzle(pz, JSON.parse(JSON.stringify(tr)), L)) bad.json.push(pz.id);
      const ds = CS.distractorsOf(pz, L);
      if (!Array.isArray(ds) || !ds.length) bad.dis.push(`${pz.id}: no distractors`);
      else for (const d of ds) {
        if (CS.checkPuzzle(pz, d, L) || CS.checkPuzzle(pz, JSON.parse(JSON.stringify(d)), L)) { bad.dis.push(`${pz.id}: ${JSON.stringify(d)} passes`); break; }
      }
      if (CS.checkPuzzle(pz, tr, L) !== CS.checkPuzzle(pz, tr, L) || JSON.stringify(pz) !== snap) bad.pure.push(pz.id);
    }
    check(bad.val.length === 0, `${name}: every puzzle validates ${bad.val.slice(0, 3).join(' | ')}`);
    check(bad.truth.length === 0, `${name}: truth() is the stored answer and passes check() ${bad.truth.slice(0, 3).join(' | ')}`);
    check(bad.ans.length === 0, `${name}: every stored answer passes check() ${bad.ans.join(',')}`);
    check(bad.dis.length === 0, `${name}: every puzzle has distractors and every one fails check() ${bad.dis.slice(0, 3).join(' | ')}`);
    check(bad.json.length === 0, `${name}: answers survive a JSON round trip ${bad.json.join(',')}`);
    check(bad.pure.length === 0, `${name}: check() leaves the puzzle as it was and gives the same verdict twice ${bad.pure.join(',')}`);
    // validate() must report, not throw, on a puzzle that names no play on the field.
    let err = null;
    try { err = CS.validatePuzzle({ ...all[0], id: all[0].id + '-noplay', play: 'no-such-play' }, L); } catch (x) { err = 'threw ' + x.message; }
    check(Array.isArray(err) && err.length > 0, `${name}: validate() reports a missing play instead of throwing (${JSON.stringify(err)})`);
  }
  // The contract check itself bites: a type missing members is named for each one.
  const half = CS.contractErrors({ name: 'half', check() {}, truth() {}, validate() {} }, 'half');
  check(half.some((e) => /distractors/.test(e)) && half.some((e) => /mount/.test(e)) && half.some((e) => /rightName/.test(e)) && half.some((e) => /lookOf/.test(e)), `a type missing members is flagged for each: ${half.join('; ')}`);
}

// Live event listeners, counted from the first script on (only on targets still in use: window,
// document, connected nodes, and non-node targets such as a media query list).
function listenerSpy() {
  const A = EventTarget.prototype.addEventListener, R = EventTarget.prototype.removeEventListener, list = [];
  const capOf = (o) => (typeof o === 'boolean' ? o : !!(o && o.capture));
  EventTarget.prototype.addEventListener = function (t, f, o) {
    if (f && !(o && o.once) && !list.some((e) => e.tg === this && e.t === t && e.f === f && e.c === capOf(o))) list.push({ tg: this, t, f, c: capOf(o) });
    return A.call(this, t, f, o);
  };
  EventTarget.prototype.removeEventListener = function (t, f, o) {
    const i = list.findIndex((e) => e.tg === this && e.t === t && e.f === f && e.c === capOf(o));
    if (i >= 0) list.splice(i, 1);
    return R.call(this, t, f, o);
  };
  window.__lis = () => list.filter((e) => !(e.tg instanceof Node) || e.tg === document || e.tg.isConnected).map((e) => (e.tg.id || e.tg.nodeName || e.tg.constructor.name) + ':' + e.t);
}

export async function browser(H) {
  const { check, open, settle } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#map', init: listenerSpy });
  const sample = await page.evaluate(() => {
    const CS = window.CS, out = {};
    for (const name of Object.keys(CS.puzzleTypes)) out[name] = [];
    for (const R of CS.RANK_DATA || []) if (R) for (const pz of [...R.units.flatMap((u) => u.puzzles), ...(R.gameDay || [])]) if (out[pz.type] && out[pz.type].length < 1) out[pz.type].push(pz.id);
    for (const [name, T] of Object.entries(CS.puzzleTypes)) for (const pz of (T.examples || []).slice(0, 1)) out[name].push('example:' + pz.id);
    return out;
  });
  // Snapshot of everything a type could leave behind. The bubble, its arrows and the feedback line
  // are cs-ui's and change with every answer, so their insides are not counted.
  const snap = () => page.evaluate(() => {
    const C = window.__CS__, F = C.field, skip = ['bubble', 'tails', 'stFb'].map((id) => document.getElementById(id));
    const els = [...document.querySelectorAll('*')].filter((e) => !skip.some((s) => s !== e && s.contains(e)));
    const op = document.getElementById('stOpts');
    return { els: els.length, lis: window.__lis().sort(), ov: F.overlay.count, drags: F.drags.length, moved: Object.keys(F.moved).length,
      opts: op.children.length, optsHidden: op.offsetParent === null, optsAttr: [...op.attributes].map((a) => a.name + '=' + a.value).sort().join(' '), touch: F.canvas.style.touchAction };
  });
  for (const [name, ids] of Object.entries(sample)) {
    check(ids.length >= 1, `${name}: a puzzle to put up on the page (${ids.join(', ')})`);
    for (const ref of ids) {
      for (const tries of [2, 1]) {
        // A bare stage first (a lesson step that is not a puzzle), as the baseline.
        await page.evaluate(() => { location.hash = '#unit/' + window.CS.RANK_DATA[0].units[0].id; });
        await settle(page, 150);
        const before = await snap();
        const up = await page.evaluate((ref, tries) => {
          const CS = window.CS, ex = ref.startsWith('example:');
          const pz = ex ? Object.values(CS.puzzleTypes).flatMap((T) => T.examples || []).find((p) => p.id === ref.slice(8))
            : CS.RANK_DATA.flatMap((R) => (R ? [...R.units.flatMap((u) => u.puzzles), ...(R.gameDay || [])] : [])).find((p) => p.id === ref);
          window.__pz = pz;
          window.__CS__.ui.ask(pz, { tries, gameDay: tries === 1 });
          const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
          const ctl = [...document.querySelectorAll('#stOpts *')].filter((e) => vis(e) && (e.matches('button, input, select, textarea, a[href], [tabindex]') || getComputedStyle(e).cursor === 'pointer'));
          const F = window.__CS__.field;
          return {
            mode: window.__CS__.ui.mode, handle: window.__CS__.ui.handle,
            controls: ctl.map((e) => { const r = e.getBoundingClientRect(); return { tag: e.tagName, w: r.width, h: r.height, focus: e.tabIndex >= 0 && !e.disabled }; }),
            drags: F.drags.flatMap((d) => d.handles.map((h) => h.r)),
          };
        }, ref, tries);
        const L = `${name} ${ref} (${tries === 1 ? 'Game Day' : 'lesson'})`;
        check(up.mode && up.mode.pz === ref.replace(/^example:/, '') && !up.mode.done, `${L}: goes up through askPuzzle`);
        check(Array.isArray(up.handle) && up.handle.includes('destroy'), `${L}: mount() returns a handle with destroy() (${JSON.stringify(up.handle)})`);
        const answerable = up.controls.some((c) => c.focus) || up.handle.includes('onTap') || up.drags.length > 0;
        check(answerable, `${L}: there is a way to answer (a control, a field tap or a drag)`);
        const small = up.controls.filter((c) => c.w < 44 || c.h < 44 || !c.focus);
        check(small.length === 0, `${L}: every control is focusable and at least 44x44 px ${JSON.stringify(small)}`);
        check(up.drags.every((r) => r >= 22), `${L}: drag handles are at least 44 px across ${JSON.stringify(up.drags)}`);
        // Wrong first (a lesson keeps the question open once), then right; on Game Day wrong is final.
        const res = await page.evaluate(async (tries) => {
          const C = window.__CS__, ui = C.ui, out = {};
          ui.answer(false);
          out.afterWrong = ui.mode;
          if (tries === 2) { ui.answer(true); out.afterRight = ui.mode; }
          await new Promise((r) => setTimeout(r, 250));
          const txt = (id) => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
          out.fb = txt('stFb'); out.bubble = C.saying ? txt('bubble') : '';
          out.focus = C.saying ? C.saying.focus : [];
          out.focusOk = out.focus.every((t) => !!window.CS.focusOf(C.play, t, C.t));
          out.explain = ui.mode.explain;
          out.runs = C.playing || C.t > C.PRE;
          return out;
        }, tries);
        if (tries === 2) {
          check(res.afterWrong.tryNo === 2 && !res.afterWrong.done && res.afterRight.done && res.afterRight.ok === true, `${L}: a wrong first try keeps it open; the right answer then scores right`);
          check(/^Right\./.test(res.explain === 'panel' ? res.fb : res.bubble || res.fb), `${L}: the explanation opens "Right." (${(res.explain === 'panel' ? res.fb : res.bubble || res.fb).slice(0, 60)})`);
        } else {
          check(res.afterWrong.done && res.afterWrong.ok === false, `${L}: a wrong answer on Game Day is final and scores wrong`);
          // Restaged 2026-11-12 (outcome bubbles): this used to read the explanation from the bubble
          // when one was up, and so required an outcome run's bubble to open "The answer:" too. The
          // dad saw that bubble cover the explanation; now, when a run talks for itself, cs-ui puts
          // the explanation in the panel (mode.explain === 'panel') and the run's bubble says only the
          // consequence. So: the explanation, wherever cs-ui says it is, names the answer; and a run's
          // own bubble never repeats it.
          const ex = res.explain === 'panel' ? res.fb : res.bubble || res.fb;
          check(/^The answer: \S.*?\./.test(ex) && (res.explain !== 'panel' || !/The answer:/.test(res.bubble)), `${L}: the explanation names the answer (${res.explain}: ${ex.slice(0, 60)}), and an outcome run's bubble does not repeat it (${res.bubble.slice(0, 40)})`);
        }
        check(res.focusOk, `${L}: the explanation bubble points only at things on the field ${JSON.stringify(res.focus)}`);
        check(res.runs, `${L}: after the answer the play runs`);
        // The type's own destroy(), nothing else.
        await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });
        const after = await snap();
        const diff = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
        check(diff.length === 0, `${L}: destroy() leaves no stray element, listener, overlay, drag or moved player ${diff.map((k) => `${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`).join('; ').slice(0, 300)}`);
      }
    }
  }
  // outcome(): no shipped type has one yet, so a throwaway type (tap's own members plus an outcome)
  // is registered on this page only. A wrong answer must play the failure run first, with its own
  // bubble, then the right run when the first ends; Replay starts the list again.
  const oc = await page.evaluate(async () => {
    const CS = window.CS, C = window.__CS__, F = C.field, out = {};
    const base = CS.RANK_DATA[0].units.flatMap((u) => u.puzzles).find((p) => p.type === 'tap');
    CS.puzzleTypes['zz-outcome'] = { ...CS.puzzleTypes.tap, name: 'zz-outcome',
      outcome: (pz, ans, ok, ctx) => (ok ? null : [{ play: CS.variantOf(ctx.play, { tag: 'wrong' }), say: { parts: ['The failure run.'], focus: [ans], tone: 'bad' }, zoom: [ans] }, { play: ctx.play }]) };
    const pz = { ...base, id: base.id + '-zz', type: 'zz-outcome' };
    out.legal = CS.validatePlay(CS.variantOf(CS.lib.PLAYS[pz.play], { tag: 'wrong' })).length === 0;
    location.hash = '#unit/' + CS.RANK_DATA[0].units[0].id;
    await new Promise((r) => setTimeout(r, 150));
    C.ui.ask(pz, { tries: 1, gameDay: true });
    F.setSpeed(4);
    C.ui.answer(false);
    out.first = C.play.id; out.firstSay = C.saying ? document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim() : '';
    out.fb = document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim(); out.explain = C.ui.mode.explain;
    // The run's camera and the ground its bubble keeps off (field.frameRun, from the run's zoom).
    await new Promise((r) => setTimeout(r, 700));
    out.cam = F.runCamera; out.keepOff = F.keepOff;
    const bb = document.getElementById('bubble').getBoundingClientRect();
    out.overlap = (out.keepOff || []).some((q) => bb.left < q.right && bb.right > q.left && bb.top < q.bottom && bb.bottom > q.top);
    const t0 = Date.now();
    while (C.play.id === out.first && Date.now() - t0 < 6000) await new Promise((r) => setTimeout(r, 50));
    out.second = C.play.id; out.secondRuns = C.playing || C.t > C.PRE; out.secondSay = !!C.saying;
    out.fb2 = document.getElementById('stFb').textContent.replace(/\s+/g, ' ').trim();
    document.getElementById('btnReplay').click();
    out.replay = C.play.id;
    F.setSpeed(1); F.pause();
    window.__CS__.ui.destroyOnly();
    delete CS.puzzleTypes['zz-outcome'];
    out.base = pz.play;
    return out;
  });
  check(oc.legal && oc.first === oc.base + '~wrong' && /The failure run\./.test(oc.firstSay), `outcome(): a wrong answer plays the failure run first (${oc.first}), with its own bubble`);
  // 2026-11-12 (outcome bubbles): a run that talks puts the explanation in the panel, for the whole list.
  check(oc.explain === 'panel' && /^The answer: /.test(oc.fb) && !/The answer/.test(oc.firstSay) && !oc.secondSay && /^The answer: /.test(oc.fb2),
    `outcome(): with a talking run the explanation stays in the panel through both runs, and the run's bubble does not repeat it ("${oc.fb.slice(0, 30)}" | "${oc.firstSay}" | second run bubble: ${oc.secondSay})`);
  check(oc.cam && oc.cam.z >= 1 && Array.isArray(oc.keepOff) && oc.keepOff.length === 1 && !oc.overlap, `outcome(): the run's zoom frames its man (z ${oc.cam && oc.cam.z}) and the bubble keeps off the ground he covers (${JSON.stringify(oc.keepOff)})`);
  check(oc.second === oc.base && oc.secondRuns, `outcome(): when the failure run ends, the right one runs (${oc.second})`);
  check(oc.replay === oc.base + '~wrong', `outcome(): Replay starts the list again from the failure run (${oc.replay})`);
  check(errors.length === 0, `zero page errors through the conformance check ${JSON.stringify(errors.slice(0, 3))}`);
  await page.close();
}
