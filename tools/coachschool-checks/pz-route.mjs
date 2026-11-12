/**
 * Puzzle type ROUTE (assets/coachschool/cs-pz-route.js): "tap the receiver, pick the route that beats
 * the shown coverage". The right answers below are written here by hand from fact sheet 6, never read
 * back from the type: the "Basic beater routes" table ("Corner | Cover 2", "Hitch | Cover 3 (off
 * corners)", "Post | Cover 2") and the concept rows (smash "#1 hitch (5-6), #2 corner"; slant-flat
 * "#1 slant, #2 flat or arrow"; curl-flat "#1 curl at 12, #2 flat"). Who owns a spot is fact sheet 5a
 * (Cover 2: CB-L "flat L", Will "hook-curl L"; Cover 3: CB-R "deep third R", NB "curl-flat R").
 */
const J = JSON.stringify;

export async function node(H) {
  const { check, loadVm } = H;
  const CS = loadVm().CS, L = CS.lib, T = CS.puzzleTypes.route;
  check(!!T && CS.contractErrors(T, 'route').length === 0, 'route: registered with every member of the contract');
  const EX = Object.fromEntries((T.examples || []).map((p) => [p.id, p]));
  check(Object.keys(EX).length >= 2 && Object.values(EX).every((p) => L.PLAYS[p.play] && !p.play.startsWith('pz-route-')), `route: at least two examples, each on a library play (${Object.values(EX).map((p) => p.play).join(', ')})`);

  // Receiver numbers by hand (6: "counted #1/#2/#3 from the outside"): the 2x2 is X, H on the left and Z, Y on the right.
  const nums = T.numbering(CS.compile(L.PLAYS['smash-vs-c2']));
  check(J(nums.X) === J({ side: 'L', n: 1 }) && J(nums.H) === J({ side: 'L', n: 2 }) && J(nums.Z) === J({ side: 'R', n: 1 }) && J(nums.Y) === J({ side: 'R', n: 2 }) && !nums.RB, `numbering: X #1 and H #2 on the left, Z #1 and Y #2 on the right, the back unnumbered ${J(nums)}`);

  // Hand truth, distractors and hand-made wrong answers, per example.
  const HAND = {
    'pz-route-smash-c2': { right: { id: 'H', route: 'corner' }, wrong: ['out', 'dig', 'flat'], unoffered: 'post', other: 'X' },
    'pz-route-hitch-c3': { right: { id: 'Z', route: 'hitch' }, wrong: ['comeback', 'dig', 'post'], unoffered: 'slant', other: 'Y' },
  };
  for (const [id, h] of Object.entries(HAND)) {
    const pz = EX[id];
    if (!pz) { check(false, `${id}: example present`); continue; }
    check(T.validate(pz, L).length === 0, `${id}: validates clean ${J(T.validate(pz, L))}`);
    check(J(T.truth(pz, L)) === J(h.right) && T.check(pz, h.right, L), `${id}: truth is ${J(h.right)} (fact sheet 6) and passes`);
    const ds = T.distractors(pz, L);
    check(h.wrong.every((r) => ds.some((d) => d.id === h.right.id && d.route === r)) && ds.every((d) => !T.check(pz, d, L)), `${id}: every offered route that does not beat it is a distractor (${h.wrong.join(', ')}), and every distractor fails ${J(ds)}`);
    check(!T.check(pz, { id: h.other, route: h.right.route }, L), `${id}: the right route on the wrong man (${h.other}) is wrong`);
    // Post beats Cover 2 and slant (with Y on the flat) is slant-flat vs Cover 3, but neither is on the chips.
    check(!T.check(pz, { id: h.right.id, route: h.unoffered }, L), `${id}: a route not on the chips (${h.unoffered}) is never right, even one the sheet pairs with this coverage`);
    check([null, 'corner', 3, {}, { id: h.right.id }].every((a) => !T.check(pz, a, L)), `${id}: malformed answers are wrong, not a crash`);
    check(T.check(pz, JSON.parse(J(h.right)), L) && T.check(pz, h.right, L) === T.check(pz, h.right, L), `${id}: the answer survives JSON and the verdict is stable`);
  }

  // validate(): two right answers, a wrong stored answer, a missing play, chalk on the receiver.
  const SM = EX['pz-route-smash-c2'];
  const two = { ...SM, id: 'fx-two', offer: ['corner', 'post', 'out'] };
  check(T.validate(two, L).some((e) => /two right answers/.test(e)), `validate: corner and post both beat Cover 2 (6: "Corner | Cover 2", "Post | Cover 2"): flagged ${J(T.validate(two, L))}`);
  check(T.validate({ ...two, accept: ['corner', 'post'] }, L).length === 0 && T.check(two, { id: 'H', route: 'post' }, L), 'validate: the same puzzle with accept: [corner, post] is clean, and both are accepted');
  const combo = { ...SM, id: 'fx-combo', receiver: 'X', offer: ['hitch', 'corner', 'dig'], answer: { id: 'X', route: 'hitch' } };
  check(T.validate(combo, L).some((e) => /two right answers/.test(e)), `validate: on X (#1, with H running the corner) the hitch is smash and the corner is a beater: two right answers flagged ${J(T.validate(combo, L))}`);
  check(T.validate({ ...SM, id: 'fx-stored', answer: { id: 'H', route: 'out' } }, L).some((e) => /stored answer/.test(e)), 'validate: a stored answer that is not the truth is flagged');
  let miss;
  try { miss = T.validate({ ...SM, id: 'fx-noplay', play: 'no-such-play' }, L); } catch (e) { miss = 'threw ' + e.message; }
  check(Array.isArray(miss) && miss.some((e) => /unknown play/.test(e)), `validate: a missing play is reported, not thrown ${J(miss)}`);
  check(T.validate({ ...SM, id: 'fx-chalk', routes: ['H'] }, L).some((e) => /gives his route away/.test(e)) && T.validate({ ...SM, id: 'fx-chalk2', routes: ['X'] }, L).length === 0,
    'validate: route chalk on the receiver himself (his real route before he picks) is flagged; chalk on the #1 beside him is fine');

  // Cover 6 "side" rows (6: "Corner | Cover 2; Cover 6 (Cover 2 side)"; 5a: Cover 6 = FS deep half L, CS
  // convention "Cover 2 to the weak side"). A test-only play: smash's 2x2 against the nickel's Cover 6.
  L.PLAYS['zz-route-c6'] = CS.variantOf(L.PLAYS['smash-vs-c2'], { tag: 'c6', defense: 'c6-nickel', callouts: [] });
  L.PLAYS['zz-route-c6'].id = 'zz-route-c6';
  check(CS.validatePlay(L.PLAYS['zz-route-c6']).length === 0 && T.cover2Side(CS.compile(L.PLAYS['zz-route-c6'])) === 'L', 'Cover 6 fixture play is legal and its Cover 2 side is the left (5a: deep half L)');
  const c6 = { ...SM, id: 'fx-c6', play: 'zz-route-c6', prompt: 'Cover 6. Tap the slot receiver, then pick the route that beats it.' };
  const e6 = T.validate(c6, L);
  check(e6.some((e) => /must name the side/.test(e)) && e6.some((e) => /prompt must say "the Cover 2 side"/.test(e)), `validate: a Cover 6 puzzle where a side row applies but no side is named is flagged, by letter and in the prompt ${J(e6)}`);
  const c6ok = { ...c6, id: 'fx-c6-ok', side: 'L', prompt: 'Cover 6. Tap the slot receiver on the Cover 2 side, then pick the route that beats it.' };
  check(T.validate(c6ok, L).length === 0 && J(T.truth(c6ok, L)) === J({ id: 'H', route: 'corner' }), `validate: named (side L, "the Cover 2 side" in the prompt) it is clean and the corner is right ${J(T.validate(c6ok, L))}`);
  check(T.validate({ ...c6ok, id: 'fx-c6-r', side: 'R' }, L).some((e) => /plays Cover 2 to the L/.test(e)), 'validate: naming the quarters side as the Cover 2 side is flagged');
  const c6q = { ...c6ok, id: 'fx-c6-q', receiver: 'Y', answer: { id: 'Y', route: 'corner' } };
  check(!T.check(c6q, { id: 'Y', route: 'corner' }, L) && T.validate(c6q, L).some((e) => /no offered route beats/.test(e)), 'the Cover 6 corner row holds only on the Cover 2 side: on Y (the quarters side) the corner is not right');

  // Contested pairings are never graded wrong (6: smash "vs Cover 4 contested").
  L.PLAYS['zz-route-c4'] = { ...CS.variantOf(L.PLAYS['smash-vs-c2'], { tag: 'c4', defense: 'c4-nickel', callouts: [] }), id: 'zz-route-c4' };
  const c4 = { ...SM, id: 'fx-c4', play: 'zz-route-c4', receiver: 'X', offer: ['hitch', 'out', 'dig'], answer: { id: 'X', route: 'hitch' } };
  check(T.validate(c4, L).some((e) => /contested/.test(e)), `validate: offering X the hitch (smash with H's corner) against Cover 4 is refused: contested ${J(T.validate(c4, L))}`);
  check(!T.check(c4, { id: 'X', route: 'hitch' }, L) && T.truth(c4, L) === null, 'a contested pairing is never the right answer: X\'s hitch (smash) vs Cover 4 does not check, and there is no truth');

  // Outcome runs: legal plays; wrong = his route thrown into the man who owns that spot, then the right one.
  const OWNER = {
    'pz-route-smash-c2': { out: 'CB-L', dig: 'WILL', flat: 'CB-L' },
    'pz-route-hitch-c3': { comeback: 'CB-R', dig: 'NB', post: 'CB-R' },
  };
  const at = (play) => { const c = CS.compile(play), s = CS.poseAt(play, c.catchT), r = s.players[c.target]; return { c, s, r, d: (id) => Math.hypot(s.players[id].x - r.x, s.players[id].y - r.y) }; };
  for (const [id, own] of Object.entries(OWNER)) {
    const pz = EX[id], tr = HAND[id].right, bad = [];
    const right = T.runs(pz, tr, true, L);
    const rr = at(right[0].play);
    const cover = rr.c.def.filter((p) => p.src.zone || p.src.man).map((p) => rr.d(p.id));
    if (right.length !== 1 || CS.validatePlay(right[0].play).length || rr.c.target !== tr.id || (right[0].play.assign[tr.id] || {}).route !== tr.route) bad.push('right run');
    check(bad.length === 0, `${id}: a right answer plays one legal run, the ${tr.route} thrown to ${tr.id}`);
    check(rr.r.y <= CS.VIEW.Y1 - 0.5, `${id}: the right run's catch is inside the view (${rr.r.y.toFixed(1)} yd)`);
    check(Math.min(...cover) >= 3, `${id}: in the right run nobody in coverage is within 3 yd of ${tr.id} at the catch (nearest ${Math.min(...cover).toFixed(2)} yd)`);
    check(J(right[0].chalk) === J({ routes: [tr.id] }), `${id}: the run chalks only the receiver the puzzle is about ${J(right[0].chalk)}`);
    for (const ans of T.distractors(pz, L)) {
      const rs = T.runs(pz, ans, false, L), w = rs[0], ww = at(w.play);
      const legal = rs.length === 2 && rs.every((r) => CS.validatePlay(r.play).length === 0);
      const shape = ww.c.target === ans.id && w.play.assign[ans.id].route === ans.route && rs[1].play.id === right[0].play.id;
      check(legal && shape, `${id} ${J(ans)}: two legal runs, his ${ans.route} thrown to ${ans.id} first, then the right one (${rs.map((r) => r.play.id).join(' -> ')})`);
      // The ball comes out after the drop (3-step from the gun: 2 yd at 4 yd/s = 0.5 s).
      check(ww.c.throwT >= 0.5 && ww.c.catchT > ww.c.throwT, `${id} ${J(ans)}: thrown after the drop (${ww.c.throwT} s), caught at ${ww.c.catchT} s`);
      // The failure must be seen: the catch inside the field's window (CS.VIEW, -9 to 19.6 yd from the LOS).
      // The plate review found a go caught at 21 yd, off the top of the screen.
      check(ww.r.y <= CS.VIEW.Y1 - 0.5, `${id} ${J(ans)}: caught ${ww.r.y.toFixed(1)} yd downfield, inside the view (to ${CS.VIEW.Y1.toFixed(1)})`);
      if (ans.id !== pz.receiver) {
        check(/^The answer: /.test(w.say.parts[0].text) && /wrong man/.test(w.say.parts.map((p) => p.text || p).join('')), `${id} ${J(ans)}: the wrong man's run says so`);
        continue;
      }
      const o = own[ans.route], txt = w.say.parts.map((p) => p.text || p).join('');
      check(o && w.owner === o && ww.d(o) <= T.ON_BALL && J(w.marks) === J([{ id: o, kind: 'bad' }]), `${id} ${J(ans)}: the run goes into ${o}, the man 5a gives that spot, within ${T.ON_BALL} yd at the catch (${o ? ww.d(o).toFixed(2) : '?'} yd)`);
      check(/^The answer: /.test(txt) && /is covered/.test(txt) && w.say.focus[0] === o && w.say.tone === 'bad', `${id} ${J(ans)}: its bubble names the answer, then the covering man ("${txt}")`);
      check(ww.d(o) < Math.min(...cover), `${id} ${J(ans)}: the wrong route is covered tighter (${ww.d(o).toFixed(2)} yd) than the right one is (${Math.min(...cover).toFixed(2)} yd)`);
    }
  }
  delete L.PLAYS['zz-route-c6']; delete L.PLAYS['zz-route-c4'];
}

// Live listeners from the first script on (only on targets still in use), as contract.mjs counts them.
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
  window.__lis = () => list.filter((e) => !(e.tg instanceof Node) || e.tg === document || e.tg.isConnected).length;
}

export async function browser(H) {
  const { check, open, settle, plate } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#map', init: listenerSpy });
  const ask = (id, tries) => page.evaluate(async (id, tries) => {
    location.hash = '#unit/' + window.CS.RANK_DATA[0].units[0].id;
    await new Promise((r) => setTimeout(r, 150));
    const pz = window.CS.puzzleTypes.route.examples.find((p) => p.id === id);
    window.__CS__.ui.ask(pz, { tries, gameDay: tries === 1 });
    await new Promise((r) => setTimeout(r, 120));
    return window.__CS__.ui.mode;
  }, id, tries);
  // A real tap on a player: the centre of his painted sprite.
  const tapPlayer = async (id) => { const c = await page.evaluate((id) => { const r = window.__CS__.spriteRect(id); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }, id); await page.mouse.click(c.x, c.y); await settle(page, 60); };
  const tapChip = async (route) => { const c = await page.evaluate((r) => { const b = document.querySelector(`#stOpts button[data-route="${r}"]`).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, route); await page.mouse.click(c.x, c.y); await settle(page, 60); };
  const tapMain = async () => { const c = await page.evaluate(() => { const b = document.getElementById('btnMain').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }); await page.mouse.click(c.x, c.y); await settle(page, 120); };
  const snap = () => page.evaluate(() => {
    const F = window.__CS__.field, op = document.getElementById('stOpts');
    return { els: document.querySelectorAll('body *').length - document.querySelectorAll('#bubble *, #tails *, #stFb *').length, lis: window.__lis(), ov: F.overlay.count, opts: op.children.length, optsHidden: op.offsetParent === null };
  });

  // 1. Picking, zoomed in: the layout, the chips, a real tap on H and on "Corner", the preview path.
  await page.evaluate(() => { location.hash = '#unit/' + window.CS.RANK_DATA[0].units[0].id; });
  await settle(page, 150);
  const bare = await snap();
  const m0 = await ask('pz-route-smash-c2', 2);
  check(m0 && m0.pz === 'pz-route-smash-c2' && !m0.done, 'browser: the smash example goes up through askPuzzle');
  const lay = await page.evaluate(() => {
    const vis = (e) => e.offsetParent !== null;
    const ctl = [...document.querySelectorAll('#stOpts button, #stActions button')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim() || b.getAttribute('aria-label'), w: r.width, h: r.height }; });
    return { ctl, sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth,
      chips: [...document.querySelectorAll('#stOpts button')].map((b) => ({ t: b.textContent, glyph: getComputedStyle(b, '::before').backgroundImage.startsWith('url("data:image/svg+xml') })),
      chalk: window.__CS__.field.chalk };
  });
  check(lay.sh <= lay.ih && lay.sw <= lay.iw, `browser: no page scroll at 390x844 with the route chips up (${lay.sw}x${lay.sh})`);
  check(lay.ctl.length >= 5 && lay.ctl.every((c) => c.w >= 44 && c.h >= 44), `browser: chips and Lock it in are at least 44x44 px ${J(lay.ctl.map((c) => [c.t, Math.round(c.w), Math.round(c.h)]))}`);
  check(J(lay.chips.map((c) => c.t)) === J(['Out', 'Corner', 'Dig', 'Flat']) && lay.chips.every((c) => c.glyph), `browser: one chip per offered route, readable names, each with its chalk glyph ${J(lay.chips)}`);
  check(lay.chalk && lay.chalk.routes.length === 0, `browser: no route chalk before he answers (the slot's real route would give it away) ${J(lay.chalk)}`);
  await page.evaluate(() => window.__CS__.field.zoomTo(['H'], { instant: true }));
  await settle(page, 60);
  await tapPlayer('H');
  await tapChip('corner');
  const pv = await page.evaluate(() => {
    const C = window.__CS__, F = C.field, CS = window.CS;
    const wp = CS.routeWaypoints(C.play, 'H', 'corner'), s = F.shown.players.H, q = CS.poseAt(C.play, C.t).players.H;
    const want = wp.map((p) => C.yardToScreen(p[0] + s.x - q.x, p[1] + s.y - q.y));
    return { z: C.camera.z, paths: F.overlays.paths, want, marks: F.marks, pressed: [...document.querySelectorAll('#stOpts button[aria-pressed="true"]')].map((b) => b.dataset.route) };
  });
  const same = pv.paths.length === 1 && pv.paths[0].pts.length === pv.want.length && pv.paths[0].pts.every((p, i) => Math.abs(p.x - pv.want[i].x) < 1e-6 && Math.abs(p.y - pv.want[i].y) < 1e-6);
  check(pv.marks.some((m) => m.id === 'H' && m.kind === 'focus') && J(pv.pressed) === J(['corner']), `browser: a tap on H picks him (focus ring) and a tap on the chip picks the corner ${J(pv.marks)} ${J(pv.pressed)}`);
  check(same && pv.z > 1.2, `browser: the preview is one path whose every waypoint lands on yardToScreen(routeWaypoints(H, corner)) at his drawn spot, zoom ${pv.z.toFixed(2)}`);
  await page.evaluate(() => window.__CS__.field.zoomTo(null, { instant: true }));
  await settle(page, 60);
  await plate(page, 'route-picking.png');
  // Destroy mid-pick (a preview up): nothing of the type is left.
  await page.evaluate(() => window.__CS__.ui.destroyOnly());
  const mid = await snap();
  check(mid.ov === 0 && mid.opts === 0 && mid.optsHidden && mid.lis === bare.lis && mid.els === bare.els, `browser: destroy() mid-pick leaves no overlay, chip, element or listener (${J(bare)} -> ${J(mid)})`);

  // 2. The full flow by real taps, zoom as he left it: H, Corner, Lock it in -> right, +10 XP, the play runs.
  const xp0 = await page.evaluate(() => window.__CS__.ui.state.xp);
  await ask('pz-route-smash-c2', 2);
  await tapPlayer('H'); await tapChip('corner'); await tapMain();
  const r1 = await page.evaluate(() => ({ mode: window.__CS__.ui.mode, xp: window.__CS__.ui.state.xp, play: window.__CS__.play.id, runs: window.__CS__.playing || window.__CS__.t > window.__CS__.PRE,
    bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim(), good: [...document.querySelectorAll('#stOpts button.good')].map((b) => b.dataset.route), dis: [...document.querySelectorAll('#stOpts button')].every((b) => b.disabled) }));
  check(r1.mode.done && r1.mode.ok === true && r1.xp - xp0 === 10, `browser: H + Corner + Lock it in by real taps scores right, +10 XP first try (${r1.xp - xp0})`);
  check(/^Right\./.test(r1.bubble) && J(r1.good) === J(['corner']) && r1.dis, `browser: the explanation opens "Right.", the corner chip goes green, the chips lock (${r1.bubble.slice(0, 50)})`);
  check(r1.play === 'smash-vs-c2' && r1.runs, `browser: the right run is the smash play itself, running (${r1.play})`);
  await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });

  // 3. A miss in a lesson keeps it open: the wrong chip goes red and out, the preview goes, Z stays picked; then right for +5.
  const xp1 = await page.evaluate(() => window.__CS__.ui.state.xp);
  await ask('pz-route-hitch-c3', 2);
  await tapPlayer('Z'); await tapChip('dig'); await tapMain();
  const ms = await page.evaluate(() => ({ mode: window.__CS__.ui.mode, ov: window.__CS__.field.overlay.count, dig: (() => { const b = document.querySelector('#stOpts button[data-route="dig"]'); return { bad: b.classList.contains('bad'), dis: b.disabled }; })(),
    marks: window.__CS__.field.marks, fb: document.getElementById('stFb').textContent }));
  check(!ms.mode.done && ms.mode.tryNo === 2 && ms.dig.bad && ms.dig.dis && ms.ov === 0 && ms.marks.some((m) => m.id === 'Z'), `browser: a wrong first try keeps it open: dig red and out, no preview, Z still picked ("${ms.fb}")`);
  await tapChip('hitch'); await tapMain();
  const r2 = await page.evaluate(() => ({ mode: window.__CS__.ui.mode, xp: window.__CS__.ui.state.xp }));
  check(r2.mode.done && r2.mode.ok && r2.xp - xp1 === 5, `browser: right on the second try scores +5 (${r2.xp - xp1})`);
  await page.evaluate(() => { window.__CS__.field.pause(); window.__CS__.ui.destroyOnly(); });

  // 4. The failure plays out, then the right route: Game Day, Z on the comeback against Cover 3.
  await ask('pz-route-hitch-c3', 1);
  await tapPlayer('Z'); await tapChip('comeback'); await tapMain();
  const f1 = await page.evaluate(() => {
    const C = window.__CS__, F = C.field, c = window.CS.compile(C.play);
    return { play: C.play.id, target: c.target, route: C.play.assign.Z.route, catchT: c.catchT, marks: F.marks, focus: C.saying && C.saying.focus,
      bubble: document.getElementById('bubble').textContent.replace(/\s+/g, ' ').trim(), done: C.ui.mode.done, ok: C.ui.mode.ok,
      chips: [...document.querySelectorAll('#stOpts button')].map((b) => [b.dataset.route, b.className.replace('rt', '').trim(), b.getAttribute('aria-pressed'), getComputedStyle(b).borderTopColor]) };
  });
  check(f1.done && f1.ok === false && f1.play === 'slant-flat-vs-c3~route-wrong' && f1.target === 'Z' && f1.route === 'comeback', `browser: a wrong answer first runs his own route, the comeback thrown to Z (${f1.play})`);
  check(/^The answer: Hitch for the Z receiver\./.test(f1.bubble) && /cornerback/.test(f1.bubble) && J(f1.focus) === J(['CB-R']) && f1.marks.some((m) => m.id === 'CB-R' && m.kind === 'bad'), `browser: its bubble names the answer and points at the cornerback who has the deep third ("${f1.bubble}")`);
  // Over: his pick red and no longer drawn as picked (the plate review found the yellow "picked"
  // look hiding the red), the right one green.
  const red = f1.chips.find((c) => c[0] === 'comeback'), green = f1.chips.find((c) => c[0] === 'hitch');
  check(red[1] === 'bad' && green[1] === 'good' && f1.chips.every((c) => c[2] === 'false') && red[3] !== 'rgb(255, 225, 77)', `browser: after the miss his comeback chip is red, the hitch green, none drawn as picked ${J(f1.chips)}`);
  // The plate at the catch: the ball arrives with the corner on it.
  await page.evaluate((t) => { window.__CS__.field.pause(); window.__CS__.seek(t); }, f1.catchT);
  const ch = await page.evaluate(() => window.__CS__.field.chalk);
  check(J(ch.routes) === J(['Z']), `browser: in the failure run only Z's route is chalked ${J(ch)}`);
  await plate(page, 'route-failure.png');
  const f2 = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, first = C.play.id;
    F.setSpeed(4); F.start();
    const t0 = Date.now();
    while (C.play.id === first && Date.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 50));
    const c = window.CS.compile(C.play);
    const out = { play: C.play.id, target: c.target, route: C.play.assign.Z.route, runs: C.playing || C.t > C.PRE, chalk: F.chalk, marks: F.marks };
    F.setSpeed(1); F.pause();
    return out;
  });
  check(f2.play === 'slant-flat-vs-c3~route-right' && f2.target === 'Z' && f2.route === 'hitch' && f2.runs, `browser: when it ends, the right route runs: the hitch thrown to Z (${f2.play})`);
  check(f2.marks.some((m) => m.id === 'Z' && m.kind === 'good'), 'browser: the right run rings Z green');
  await page.evaluate(() => window.__CS__.ui.destroyOnly());
  const end = await snap();
  check(end.ov === 0 && end.opts === 0 && end.lis === bare.lis && end.els === bare.els, `browser: after the whole flow destroy() leaves the stage as it found it (${J(bare)} -> ${J(end)})`);
  check(errors.length === 0, `browser: zero page errors through the route checks ${J(errors.slice(0, 3))}`);
  await page.close();
}
