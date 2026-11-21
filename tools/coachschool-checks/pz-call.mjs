/**
 * Puzzle type CALL (assets/coachschool/cs-pz-call.js): the situation card and the call.
 *
 *   node     the judge on each example, worked out by hand from the fact sheet (BEATS rows of section 6
 *            for the audible; the clock rules of section 10 for the rule calls); truth / distractors;
 *            validate() refuses a missing src, a contested kind (two-point, 4th-down), a contested
 *            option, two right answers, a wrong stored answer, a situation the rule does not decide, a
 *            card that disagrees with the field, a wrong option with no "why it is worse", and a wrong
 *            audible whose target is not covered; every src phrase is found verbatim in its section;
 *            every outcome run is a legal play and its "covered" claim is measured.
 *   browser  the card shows the puzzle's situation (text read cell by cell, normalised), answers by
 *            real pointer taps on the buttons, XP +10 first try and +5 second, the clock consequence
 *            after a rule call, the wrong audible plays out first and then the right one, nothing
 *            left after destroy(), every control at least 44 px, no page scroll at 390x844, no emoji.
 */
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s).replace(/\*\*/g, '').replace(/\s*\|\s*/g, ' | ').replace(/\s+/g, ' ').trim();

// The text of one fact-sheet section: "## 10. ..." up to the next "## ", or "### 5b. ..." up to the next heading.
function section(md, sec) {
  const lines = md.split(/\r?\n/), sub = /^\d+[a-z]$/.test(sec);
  const head = sub ? new RegExp(`^### ${sec}\\. `) : new RegExp(`^## ${sec}\\. `);
  const i = lines.findIndex((l) => head.test(l));
  if (i < 0) return null;
  let j = i + 1;
  while (j < lines.length && !(sub ? /^#{2,3} /.test(lines[j]) : /^#{1,2} /.test(lines[j]))) j++;
  return norm(lines.slice(i, j).join('\n'));
}

export async function node(H) {
  const { CS, L, check, ROOT, J } = H;
  const T = CS.puzzleTypes.call;
  check(!!T, 'call: registered');
  if (!T) return;
  const ex = T.examples || [];
  const byId = Object.fromEntries(ex.map((p) => [p.id, p]));
  check(ex.length >= 2 && ex.some((p) => p.kind === 'audible') && ex.some((p) => p.kind !== 'audible'), `call: at least two examples, an audible and a rule call (${ex.map((p) => p.kind).join(', ')})`);
  check(ex.every((p) => L.PLAYS[p.play]), 'call: every example is on a library play');

  // The judge, by hand. Fact sheet 6: Mesh beats "man coverage: Cover 1, Cover 0, 2-man"; Smash beats
  // Cover 2 (and Cover 6 to one side); Curl-flat beats Cover 3 and Cover 2. The play mesh-vs-c1 is
  // drawn against the nickel Cover 1. So of [Smash, Mesh, Curl-flat] only Mesh is right.
  // Fact sheet 10: a spike stops the clock and uses a down ("a bad idea on 4th down"); a runner
  // tackled in bounds keeps it running; out of bounds inside the last 5:00 of the 2nd half stops it
  // until the snap; 3 timeouts a half, so 0 left means none to call.
  const HAND = {
    'pz-call-ex-mesh': [false, true, false],       // Q2 7:05, Cover 1 on the field
    'pz-call-ex-spike': [true, false, false],      // Q4 0:24, 2nd & 10, down 3, clock running, 0 timeouts: spike
    'pz-call-ex-fourth': [false, true, false],     // Q4 0:15, 4th & 2: a spike would use the last down
    'pz-call-ex-sideline': [true, false],          // Q4 1:10 is inside the last 5:00: out of bounds stops it
  };
  for (const [id, want] of Object.entries(HAND)) {
    const pz = byId[id];
    if (!pz) { check(false, `call: example ${id} exists`); continue; }
    const got = pz.options.map((o, i) => T.check(pz, i, L));
    check(J(got) === J(want), `call ${id}: check() on each option ${J(got)} = by hand ${J(want)}`);
    const right = want.indexOf(true);
    check(T.truth(pz, L) === right && pz.answer === right, `call ${id}: truth() is option ${right} (${pz.options[right].t}) and so is the stored answer`);
    const ds = T.distractors(pz, L);
    check(ds.length === want.length - 1 && ds.every((d) => !T.check(pz, d, L)), `call ${id}: distractors ${J(ds)} are the other options and each fails`);
    check(!T.check(pz, 9, L) && !T.check(pz, -1, L) && !T.check(pz, null, L), `call ${id}: an index that is no option fails`);
    check(T.validate(pz, L).length === 0, `call ${id}: validates clean ${J(T.validate(pz, L))}`);
    check(pz.options.every((o, i) => i === right || (o.no && o.no.length > 10)), `call ${id}: every wrong option says why it is worse`);
  }

  // validate() refuses what the sheet does not back.
  const spike = byId['pz-call-ex-spike'], mesh = byId['pz-call-ex-mesh'];
  const errs = (pz) => { try { return T.validate(pz, L); } catch (e) { return ['threw ' + e.message]; } };
  const noSrc = { ...spike, id: 'fx-nosrc' }; delete noSrc.src;
  check(errs(noSrc).some((e) => /src/.test(e)), `validate: a call puzzle with no src is refused ${J(errs(noSrc))}`);
  const blankSrc = { ...spike, id: 'fx-blanksrc', src: [{ sec: '10', q: '' }] };
  check(errs(blankSrc).some((e) => /src/.test(e)), 'validate: a src with no phrase is refused');
  const twoPt = { ...spike, id: 'fx-two-point', kind: 'two-point', options: [{ t: 'Kick the extra point', v: 'kick', no: 'the chart says go for two here' }, { t: 'Go for two', v: 'two' }], answer: 1 };
  check(errs(twoPt).some((e) => /contested/.test(e)), `validate: a two-point decision (contested, sheet 10) is refused ${J(errs(twoPt))}`);
  const fourth = { ...spike, id: 'fx-fourth-go', kind: 'fourth-down', options: [{ t: 'Punt', v: 'punt', no: 'the models say go' }, { t: 'Go for it', v: 'go' }], answer: 1 };
  check(errs(fourth).some((e) => /contested/.test(e)), 'validate: a 4th-down go-or-kick decision (principles only, sheet 10) is refused');
  const unknown = { ...spike, id: 'fx-kind', kind: 'kneel-down' };
  check(errs(unknown).some((e) => /unknown kind/.test(e)), 'validate: an unknown kind is refused');
  // Two right: Smash and Four verticals both beat Cover 2 (sheet 6).
  const two = { ...mesh, id: 'fx-two-right', play: 'smash-vs-c2', situation: { ...mesh.situation }, options: [{ t: 'Smash', v: 'concept:smash' }, { t: 'Four verticals', v: 'concept:four-verts' }], answer: 0 };
  check(errs(two).some((e) => /two right answers/.test(e)), `validate: two options that both beat the coverage are refused ${J(errs(two))}`);
  // Flood vs Cover 2 is contested (sheet 6): never offered.
  const cont = { ...two, id: 'fx-contested-option', options: [{ t: 'Smash', v: 'concept:smash' }, { t: 'Flood', v: 'concept:flood', no: 'flood is built for Cover 3' }] };
  check(errs(cont).some((e) => /CONTESTED/.test(e)), 'validate: an option contested against the coverage (flood vs Cover 2) is refused');
  const wrongStored = { ...spike, id: 'fx-stored', answer: 1 };
  check(errs(wrongStored).some((e) => /stored answer/.test(e)), 'validate: a stored answer that is not the rule\'s is refused');
  const undecided = { ...spike, id: 'fx-undecided', situation: { ...spike.situation, timeouts: { us: 1, them: 1 } } };
  check(errs(undecided).some((e) => /does not decide/.test(e)), 'validate: with a timeout left the stop-clock rule does not decide, and the puzzle is refused');
  const notLate = { ...byId['pz-call-ex-sideline'], id: 'fx-q3', situation: { ...byId['pz-call-ex-sideline'].situation, quarter: 3 } };
  check(errs(notLate).some((e) => /does not decide/.test(e)), 'validate: out of bounds in the 3rd quarter restarts on the ready signal, so the sideline rule does not decide');
  const offCard = { ...spike, id: 'fx-card', situation: { ...spike.situation, yardline: 60 } };
  check(errs(offCard).some((e) => /field shows/.test(e)), 'validate: a card whose ball spot disagrees with the field is refused');
  const noWhy = { ...spike, id: 'fx-nowhy', options: spike.options.map((o) => ({ t: o.t, v: o.v })) };
  check(errs(noWhy).some((e) => /needs a "no"/.test(e)), 'validate: a wrong option with no reason it is worse is refused');
  // Slant-flat against the Cover 2 of curl-flat-vs-c2: nobody is in man on the flat, so the wrong run
  // could not honestly show the throw covered (the zone corner is yards away at the throw).
  const zone = { ...mesh, id: 'fx-zone', play: 'curl-flat-vs-c2', options: [{ t: 'Curl-flat', v: 'concept:curl-flat' }, { t: 'Slant-flat', v: 'concept:slant-flat', no: 'slant-flat is built for Cover 3' }], answer: 0 };
  check(errs(zone).some((e) => /not covered man-to-man/.test(e)), `validate: a wrong audible whose target is not covered is refused ${J(errs(zone).slice(0, 1))}`);
  check(T.validate({ ...spike, id: 'fx-noplay', play: 'no-such-play' }, L).length > 0, 'validate: a missing play is reported');

  // Every src phrase is in its section of the sheet, verbatim (whitespace and table pipes normalised).
  const md = fs.readFileSync(path.join(ROOT, 'docs/coachschool-facts.md'), 'utf8');
  for (const pz of ex) {
    const bad = (pz.src || []).filter((s) => { const t = section(md, s.sec); return !t || !t.includes(norm(s.q)); });
    check(bad.length === 0 && (pz.src || []).length > 0, `call ${pz.id}: every src phrase is found in its fact-sheet section ${J(bad)}`);
  }
  check(section(md, '10').includes('uses a down') && !section(md, '6').includes('uses a down'), 'src check bites: a phrase is found only under its own section');

  // Outcome runs: each wrong audible's run is a legal play, against the same defense, and its target
  // is covered: measured here from poseAt at the concept's own throw time, against the defender whose
  // assignment (the defense table) is man on him.
  // Restaged 2026-11-12: the wrong run used to be "no throw" (the QB held the ball: the engine had no
  // breakup to show). The dad wanted the covered throw to fail on screen, so the QB now throws to the
  // target at the concept's throw time and the man defender breaks it up. Checked by hand here: the
  // arrival is the throw time plus the flight at 30 yd/s (QB at the throw to the target at the
  // arrival, rounded up to a tenth), the defender within CS.CONTACT_YD (2 yd) of the target then,
  // and the ball at that moment within 0.5 yd of the defender (it went to his hands).
  for (const pz of ex.filter((p) => p.kind === 'audible')) {
    const shown = L.PLAYS[pz.play];
    for (const [i, o] of pz.options.entries()) {
      if (i === pz.answer) continue;
      const w = T.wrongRun(pz, o.v, L), base = L.PLAYS[L.CONCEPTS[o.v].play];
      const thr = base.ball.find((b) => b.ev === 'throw'), to = thr.to;
      const manDef = L.DEFENSES[shown.defense].players.find((d) => d.man === to);
      const P = CS.poseAt(w.play, thr.t).players, gap = manDef ? Math.hypot(P[manDef.id].x - P[to].x, P[manDef.id].y - P[to].y) : Infinity;
      const wb = w.play.ball, wt = wb.find((b) => b.ev === 'throw'), we = wb.find((b) => b.ev === 'breakup');
      check(CS.validatePlay(w.play).length === 0 && w.play.defense === shown.defense && w.play.formation === shown.formation && wt && wt.t === thr.t && wt.to === to && we && we.by === (manDef && manDef.id),
        `call ${pz.id} / ${o.t}: the wrong run is a legal play, against the ${shown.defense} on the field, same formation, thrown to ${to} at ${thr.t} s and broken up by his man ${J(wb)} ${J(CS.validatePlay(w.play))}`);
      if (wt && we && manDef) {
        const qb = CS.poseAt(w.play, wt.t).players.QB, Pa = CS.poseAt(w.play, we.t), tg = Pa.players[to], dm = Pa.players[manDef.id];
        const flight = Math.ceil((wt.t + Math.max(0.4, Math.hypot(qb.x - tg.x, qb.y - tg.y) / 30)) * 10 - 1e-9) / 10;
        const contact = Math.hypot(dm.x - tg.x, dm.y - tg.y), onHim = Math.hypot(Pa.ball.x - dm.x, Pa.ball.y - dm.y);
        check(Math.abs(we.t - flight) < 1e-9 && contact <= CS.CONTACT_YD && onHim <= 0.5,
          `call ${pz.id} / ${o.t}: the ball arrives at ${we.t} s (by hand ${flight}: 30 yd/s), ${manDef.id} ${contact.toFixed(2)} yd from ${to} (max ${CS.CONTACT_YD}), the ball ${onHim.toFixed(2)} yd from ${manDef.id}`);
      }
      check(manDef && gap <= 1.5 && w.man === manDef.id && w.target === to, `call ${pz.id} / ${o.t}: at ${thr.t} s the ${manDef && manDef.id} (man on ${to}) is ${gap.toFixed(2)} yd from him (covered: within 1.5)`);
    }
    check(CS.validatePlay(shown).length === 0, `call ${pz.id}: the right run (the library's ${pz.play}) is a legal play`);
  }
  // Rule-call backdrops: puzzle-only plays at the card's spot and distance, no callouts, no chalk;
  // the spike puzzles line up under center (sheet 10 teaches the spike from under center only).
  for (const pz of ex.filter((p) => p.kind !== 'audible')) {
    const p = L.PLAYS[pz.play], c = CS.compile(p);
    check(p.id.startsWith('pz-call-') && CS.validatePlay(p).length === 0 && p.spot === pz.situation.yardline && p.dist === pz.situation.dist && !(p.callouts || []).length && !p.routes && !p.zones,
      `call ${pz.id}: backdrop ${p.id} is legal, spot ${p.spot} / ${p.dist} to go as the card, no callouts or chalk`);
    if (pz.options.some((o) => o.v === 'spike')) check(c.qb.y >= -1.5, `call ${pz.id}: the QB is under center for a spike (y ${c.qb.y})`);
  }

  // The card's words and the consequences, by hand.
  const k = T.card(spike.situation);
  check(J([k.qtr, k.clock, k.down, k.ball, k.us, k.them]) === J(['Q4', '0:24', '2nd & 10', 'Opp 30', '17', '20']), `card: Q4 0:24, 2nd & 10, yard line 70 is the opponent's 30, 17-20 (${J(k)})`);
  check(T.card(byId['pz-call-ex-sideline'].situation).ball === 'Own 45' && T.card(mesh.situation).clock === '7:05' && T.card(byId['pz-call-ex-fourth'].situation).down === '4th & 2', 'card: own 45, 425 s is 7:05, 4th & 2');
  const a = T.after(spike, 'spike'), r = T.after(spike, 'run-middle'), s4 = T.after(byId['pz-call-ex-fourth'], 'spike'), sl = T.after(byId['pz-call-ex-sideline'], 'sideline'), mid = T.after(byId['pz-call-ex-sideline'], 'middle');
  check(a.clock === 'stopped' && a.down === '3rd & 10' && r.clock === 'running' && s4.down === '4th down used' && sl.clock === 'stopped' && mid.clock === 'running',
    `consequence: spike stops it and 2nd becomes 3rd & 10; a run tackled in bounds runs; a 4th-down spike uses the 4th; out of bounds stops; the middle runs`);
}

export async function browser(H) {
  const { check, open, plate, settle } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#map' });
  const tap = async (label) => {
    const r = await page.evaluate((label) => {
      const b = [...document.querySelectorAll('#stOpts button')].find((e) => e.textContent === label);
      if (!b) return null;
      const q = b.getBoundingClientRect();
      return { x: q.left + q.width / 2, y: q.top + q.height / 2 };
    }, label);
    if (!r) return false;
    await page.mouse.click(r.x, r.y);
    return true;
  };
  const up = async (id, tries) => {
    await page.evaluate((id, tries) => {
      location.hash = '#unit/' + window.CS.RANK_DATA[0].units[0].id;
      return new Promise((res) => setTimeout(() => {
        const pz = window.CS.puzzleTypes.call.examples.find((p) => p.id === id);
        window.__CS__.ui.ask(pz, { tries, gameDay: tries === 1 });
        res();
      }, 120));
    }, id, tries);
    await settle(page, 120);
  };
  const state = () => page.evaluate(() => {
    const C = window.__CS__, card = document.querySelector('#stOpts .cs-call-card'), fb = document.getElementById('stFb');
    const cells = card ? [...card.querySelectorAll('.row > span')].map((s) => [s.querySelector('small').textContent, s.querySelector('b').textContent]) : null;
    // Ink, not boxes: every cell's value is rendered inside the card.
    let inked = !!card;
    if (card) {
      const cr = card.getBoundingClientRect();
      for (const b of card.querySelectorAll('b')) { const rg = document.createRange(); rg.selectNodeContents(b); const q = rg.getBoundingClientRect(); if (!(q.width > 0 && q.left >= cr.left - 0.5 && q.right <= cr.right + 0.5 && q.top >= cr.top - 0.5 && q.bottom <= cr.bottom + 0.5)) inked = false; }
    }
    const btns = [...document.querySelectorAll('#stOpts button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent, w: r.width, h: r.height, dis: b.disabled, cls: b.className }; });
    const tx = (e) => (e ? e.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
      cells, inked, btns, mode: C.ui.mode, xp: C.ui.state.xp,
      line: tx(card && card.querySelector('.line')), lineCls: card ? card.querySelector('.line').className : '', after: card && !card.querySelector('.after').hidden ? tx(card.querySelector('.after')) : '',
      fb: fb.hidden ? '' : tx(fb), bubble: C.saying ? tx(document.getElementById('bubble')) : '', focus: C.saying ? C.saying.focus : null,
      chrome: tx(document.getElementById('stOpts')) + ' ' + tx(fb) + ' ' + tx(document.getElementById('stText')),
      scroll: { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth },
      play: C.play && C.play.id, chalk: C.field.chalk,
    };
  });
  const EMOJI = /\p{Extended_Pictographic}/u;

  // 1. The spike puzzle, a lesson: the card, a wrong tap, then the right one (+5).
  await up('pz-call-ex-spike', 2);
  let s = await state();
  check(JSON.stringify(s.cells) === JSON.stringify([['Q4', '0:24'], ['Down', '2nd & 10'], ['Ball', 'Opp 30'], ['Us', '17'], ['Them', '20']]) && s.inked,
    `call card shows the puzzle's situation, every value inked inside the card: Q4 0:24, 2nd & 10, Opp 30, 17-20 (${JSON.stringify(s.cells)})`);
  check(s.line === 'Clock running. Timeouts: us 0, them 1.', `call card: "Clock running. Timeouts: us 0, them 1." (${s.line})`);
  check(s.btns.length === 3 && s.btns.every((b) => b.w >= 44 && b.h >= 44), `call: every option button at least 44x44 px ${JSON.stringify(s.btns.map((b) => [b.w, b.h]))}`);
  check(s.scroll.sh <= s.scroll.ih && s.scroll.sw <= s.scroll.iw, `call: no page scroll at 390x844 with the card up (${s.scroll.sw}x${s.scroll.sh})`);
  await plate(page, 'pz-call-1-situation.png');
  const xp0 = s.xp;
  await tap('Hand off up the middle');
  s = await state();
  check(s.mode.tryNo === 2 && !s.mode.done && s.btns[1].dis && /bad/.test(s.btns[1].cls) && /tackled in bounds keeps the clock running/.test(s.fb) && /One more try/.test(s.fb),
    `call: a wrong tap in a lesson keeps it open, greys that option and says why it is worse (${s.fb})`);
  await tap('Spike it');
  s = await state();
  check(s.mode.done && s.mode.ok === true && s.xp - xp0 === 5, `call: the right tap on the second try scores right, +5 XP (${s.xp - xp0})`);
  check(s.line === 'After the call: clock stopped. 3rd & 10.' && /stopped/.test(s.lineCls) && /Spike it: the clock stops, and it uses a down\./.test(s.after),
    `call: after the spike the card shows the clock stopped and 3rd & 10 (${s.line} | ${s.after})`);
  check(/^Right\./.test(s.fb) && !s.bubble, `call: a rule call's explanation stays in the panel (${s.fb.slice(0, 50)})`);
  check(s.scroll.sh <= s.scroll.ih && s.scroll.sw <= s.scroll.iw, `call: no page scroll at 390x844 after the answer, explanation and consequence up (${s.scroll.sw}x${s.scroll.sh})`);
  check(!EMOJI.test(s.chrome), 'call: no emoji in the card, the options or the feedback');

  // 2. First try right: +10.
  await up('pz-call-ex-fourth', 2);
  s = await state();
  const xp1 = s.xp;
  await tap('Snap it and run a real play');
  s = await state();
  check(s.mode.done && s.mode.ok && s.xp - xp1 === 10, `call: right on the first try, +10 XP (${s.xp - xp1})`);
  check(s.line === 'After the call: clock running. 4th down used.', `call: a real play on 4th down uses it, the clock still running (${s.line})`);

  // 3. Game Day, wrong: his call's consequence beside the right one.
  await up('pz-call-ex-sideline', 1);
  await tap('Over the middle, tackled in bounds');
  s = await state();
  check(s.mode.done && s.mode.ok === false && /^The answer: Outside, and he steps out of bounds\./.test(s.fb), `call: a wrong Game Day tap is final and names the answer (${s.fb.slice(0, 60)})`);
  check(/^Outside, and he steps out of bounds: the clock stops until the snap\. /.test(s.after) && /Your call, over the middle, tackled in bounds: the clock keeps running\./.test(s.after),
    `call: the card shows both consequences, out of bounds stops it, his call keeps it running (${s.after})`);

  // 4. The audible, Game Day, wrong: the wrong concept plays out against the coverage, then the right one.
  await up('pz-call-ex-mesh', 1);
  s = await state();
  check(JSON.stringify(s.cells[0]) === JSON.stringify(['Q2', '7:05']) && s.chalk && s.chalk.routes.length === 0, `call audible: card Q2 7:05, and no route chalk before the answer (it would give the concept away) ${JSON.stringify(s.chalk)}`);
  await tap('Smash');
  await page.evaluate(() => window.__CS__.field.setSpeed(0.6));
  await settle(page, 900);
  s = await state();
  // Restaged 2026-11-12 (outcome bubbles): the run's bubble says only the consequence, and the
  // explanation ("The answer: Mesh.") stays in the panel; it used to open the run's bubble, which
  // then covered it. The throw is now made and broken up (see the node check above).
  check(s.play === 'smash-vs-c2~wrong-mesh-vs-c1' && /^Smash against man: the strong safety is on the slot receiver when the ball gets there\. Broken up\.$/.test(s.bubble) && /^The answer: Mesh\./.test(s.fb) && s.mode.explain === 'panel' && JSON.stringify(s.focus) === JSON.stringify(['SS', 'H']) && s.chalk.routes.length > 0,
    `call audible: a wrong call plays out first, smash against the Cover 1, the bubble on the man defender and his receiver with the consequence only, the answer in the panel, routes drawn (${s.play} | ${s.bubble} | ${s.fb.slice(0, 40)} | ${JSON.stringify(s.focus)})`);
  // The plate at the moment smash would throw to the slot (2.4 s in the library play): his man is on him.
  const atThrow = await page.evaluate(() => {
    const C = window.__CS__, CS = window.CS;
    C.field.pause(); C.seek(2.4);
    const P = CS.poseAt(C.play, 2.4).players;
    return { play: C.play.id, gap: Math.hypot(P.SS.x - P.H.x, P.SS.y - P.H.y), bubble: !!C.saying };
  });
  check(atThrow.play === 'smash-vs-c2~wrong-mesh-vs-c1' && atThrow.gap <= 1.5 && atThrow.bubble, `call audible: paused at the would-be throw, the strong safety is ${atThrow.gap.toFixed(2)} yd from the slot and the bubble is still up`);
  await settle(page, 600);
  await plate(page, 'pz-call-2-wrong-audible.png');
  const nxt = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, first = C.play.id;
    F.setSpeed(4); F.start();
    const t0 = Date.now();
    while (C.play.id === first && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
    const out = { second: C.play.id, routes: F.chalk ? F.chalk.routes.length : 0, ball: (C.play.ball || []).map((b) => b.ev).join(',') };
    F.setSpeed(1); F.pause();
    return out;
  });
  check(nxt.second === 'mesh-vs-c1' && nxt.routes > 0 && nxt.ball === 'snap,throw,catch', `call audible: then the right concept's own play runs, routes drawn, thrown and caught (${JSON.stringify(nxt)})`);

  // 5. destroy() alone leaves nothing behind.
  const left = await page.evaluate(() => {
    const before = document.querySelectorAll('*').length, C = window.__CS__;
    C.ui.destroyOnly();
    const op = document.getElementById('stOpts');
    return { removed: before - document.querySelectorAll('*').length, card: !!document.querySelector('.cs-call-card'), opts: op.children.length, hidden: op.offsetParent === null, ov: C.field.overlay.count, css: document.querySelectorAll('#cs-pz-call-css').length };
  });
  check(!left.card && left.opts === 0 && left.hidden && left.ov === 0 && left.css === 1 && left.removed > 0, `call: destroy() takes the card and the buttons down and hides the panel, no overlay; the style stays once (${JSON.stringify(left)})`);
  check(errors.length === 0, `call: zero page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await page.close();
}
