/* Coach School screens: career map, the lesson loop (chalk talk -> watch it -> walkthrough ->
   puzzles -> film room), Game Day, the promotion, the film room, and the engine demo (a developer
   route, #demo). Everything a player reads is DOM text in the page fonts; the canvas draws the
   field. Progress is localStorage only (plan): key cs_state_v1_<choreUser>, read and written
   through try/catch wrappers (goatcare.html's lsGet/lsSet pattern), and every XP or progress
   change goes through CS.applyLog, the same function the suite does the arithmetic on.

   Routes (location.hash): #map (default), #unit/<id>, #unit/<id>/puzzles, #gameday, #film,
   #film/<playId>, #demo. */
(function (root) {
  'use strict';
  const CS = root.CS, L = CS.lib, doc = root.document;
  const $ = (id) => doc.getElementById(id);
  const R = CS.RANK_DATA[0];

  /* ── storage ── */
  function lsGet(k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { root.localStorage.setItem(k, v); } catch (e) { /* private mode: play on without saving */ } }
  const USER = lsGet('choreUser') || '';
  const KEY = 'cs_state_v1_' + (USER || 'guest');
  let S = (() => { try { return CS.normalizeState(JSON.parse(lsGet(KEY) || 'null')); } catch (e) { return CS.newState(); } })();
  function save() { lsSet(KEY, JSON.stringify(S)); }
  function apply(ev) { S = CS.applyLog(S, [{ t: Date.now(), ...ev }]); save(); renderLevel(); }
  // An answer: XP and the first tag's review box through applyLog; the puzzle's other tags get
  // their review box too, without paying XP twice.
  function recordAnswer(pz, tryNo, correct) {
    const before = S.xp, tags = pz.tags || [], now = Date.now();
    apply({ kind: 'answer', tag: tags[0], correct, try: tryNo });
    for (const tag of tags.slice(1)) S.srs = CS.srsReview(S.srs, tag, correct, now);
    save();
    return S.xp - before;
  }

  /* ── sound: WebAudio synth, no files; mute persists (hayhem.html's pattern) ── */
  let actx = null, master = null, muted = lsGet('cs_muted') === '1';
  function audio() {
    if (!actx) {
      try { actx = new (root.AudioContext || root.webkitAudioContext)(); master = actx.createGain(); master.gain.value = muted ? 0 : 0.35; master.connect(actx.destination); } catch (e) { actx = null; }
    }
    if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) { /* ignore */ } }
    return actx;
  }
  function tone(freq, dur, type, gain, delay) {
    if (muted || !audio()) return;
    const t0 = actx.currentTime + (delay || 0), o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain || 0.25, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const SFX = {
    right() { tone(660, 0.09, 'square', 0.16); tone(990, 0.14, 'square', 0.16, 0.08); },
    wrong() { tone(196, 0.18, 'triangle', 0.22); },
    // The promotion fanfare: a rising 8-bit arpeggio, then a held major chord.
    fanfare() {
      const n = [523.25, 659.25, 783.99, 1046.5];
      n.forEach((f, i) => tone(f, 0.16, 'square', 0.18, i * 0.13));
      [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, 1.1, 'square', 0.09, 0.62));
      tone(130.81, 1.2, 'triangle', 0.25, 0.62);
    },
  };
  function renderMute() {
    const b = $('btnMute');
    b.setAttribute('aria-pressed', muted ? 'true' : 'false');
    b.setAttribute('aria-label', muted ? 'Sound off' : 'Sound on');
    b.querySelector('.wave').toggleAttribute('hidden', muted);
    b.querySelector('.cross').toggleAttribute('hidden', !muted);
  }
  $('btnMute').addEventListener('click', () => {
    muted = !muted; lsSet('cs_muted', muted ? '1' : '0');
    if (master) master.gain.value = muted ? 0 : 0.35;
    renderMute();
  });

  /* ── header ── */
  function renderLevel() {
    const lv = CS.levelForXp(S.xp), a = CS.xpForLevel(lv), b = CS.xpForLevel(lv + 1);
    $('lvlChip').textContent = 'LV ' + lv;
    $('xpLevel').textContent = 'Coach Level ' + lv;
    $('xpSub').textContent = `${S.xp} XP, ${b - S.xp} to level ${lv + 1}`;
    $('xpFill').style.width = Math.round(100 * (S.xp - a) / (b - a)) + '%';
    $('xpBar').setAttribute('aria-valuenow', String(Math.round(100 * (S.xp - a) / (b - a))));
    $('xpRank').textContent = CS.RANKS[S.rank];
  }
  function setBack(toMap) {
    const a = $('navBack');
    a.href = toMap ? '#map' : 'games.html';
    a.setAttribute('aria-label', toMap ? 'Back to the career map' : 'Back to games');
    $('navBackText').textContent = toMap ? 'Map' : 'Games';
  }

  /* ── screens ── */
  const SCREENS = ['scrMap', 'scrStage', 'scrResult', 'scrFilm', 'scrDemo'];
  let screen = null;
  function show(id) {
    for (const s of SCREENS) $(s).hidden = s !== id;
    screen = id;
    setBack(id !== 'scrMap');
    if (id !== 'scrStage' && field) field.pause();
    if (id !== 'scrDemo' && demo) demo.pause();
    active = id === 'scrDemo' ? demo : field;
  }

  /* ── the stage field ── */
  const fopts = { bubbleEl: $('bubble'), tailsEl: $('tails'), wrap: $('fieldWrap'), pauseAtCallouts: false };
  const field = CS.mountField($('cs-stage'), Object.assign(fopts, {
    onTap: (id) => onTap(id),
    onState: () => renderPlayButton(),
    onEnd: () => { if (mode && mode.onEnd) mode.onEnd(); },
  }));
  let active = field, demo = null;
  const fitStage = () => field.fit($('stBox'));
  if (root.ResizeObserver) new ResizeObserver(fitStage).observe($('stBox'));
  root.addEventListener('resize', fitStage);

  function nameOf(play, id) {
    const c = CS.compile(play), role = CS.roleOf(c, id);
    return L.ROLE_NAMES[role] || L.LABELS[id] || id;
  }

  // 'Left tackle' reads 'the left tackle' mid-sentence; letters and the linebackers' names keep their capitals.
  const lc = (s) => (/^([A-Z] |Sam |Mike |Will )/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

  /* ── the panel ── */
  function panel(o) {
    $('stStep').textContent = o.step || '';
    $('stTitle').hidden = !o.title; $('stTitle').textContent = o.title || '';
    const tx = $('stText');
    tx.textContent = o.text || ''; tx.className = o.prompt ? 'prompt' : '';
    const op = $('stOpts');
    op.innerHTML = ''; op.hidden = !o.options;
    (o.options || []).forEach((t, i) => {
      const b = doc.createElement('button'); b.type = 'button'; b.textContent = t; b.dataset.i = String(i);
      b.addEventListener('click', () => onChoice(i));
      op.appendChild(b);
    });
    feedback(null);
  }
  function feedback(kind, html) {
    const f = $('stFb');
    f.hidden = !kind; f.className = 'fb' + (kind ? ' ' + kind : '');
    f.textContent = '';
    if (kind) for (const part of html) {
      if (typeof part === 'string') f.appendChild(doc.createTextNode(part));
      else { const el = doc.createElement(part.tag); el.textContent = part.text; if (part.cls) el.className = part.cls; f.appendChild(el); }
    }
  }
  function dots(n, at) {
    const d = $('stDots');
    d.innerHTML = '';
    for (let i = 0; i < n; i++) { const e = doc.createElement('i'); if (i === at) e.className = 'on'; else if (i < at) e.className = 'past'; d.appendChild(e); }
  }
  function actions(o) {
    $('btnPrev').hidden = !o.prev; $('btnReplay').hidden = !o.replay;
    const m = $('btnMain');
    m.hidden = !o.main; m.disabled = !!o.mainDisabled;
    if (o.main) setMain(o.main);
    renderPlayButton();
  }
  let mainLabel = 'Next';
  function setMain(label) { mainLabel = label; renderPlayButton(); }
  const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 4l13 8-13 8z"/></svg>';
  const ICON_NEXT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
  function renderPlayButton() {
    const m = $('btnMain');
    if (mode && mode.kind === 'watch' && mode.playMain) {
      // Honest at every stop (dad's playtest: after each note it said "Play" again and a press
      // seemed to do nothing). Stopped on a note, or at the end, the button moves him on: "Next".
      if (field.playing) m.innerHTML = ICON_PAUSE + '<span>Pause</span>';
      else if (mode.ended || field.atNote) m.innerHTML = '<span>Next</span>' + ICON_NEXT;
      else m.innerHTML = ICON_PLAY + '<span>Play</span>';
    } else m.textContent = mainLabel;
  }
  $('btnPrev').addEventListener('click', () => mode && mode.prev && mode.prev());
  $('btnReplay').addEventListener('click', () => { field.seek(field.PRE); field.start(); });
  $('btnMain').addEventListener('click', () => mode && mode.main && mode.main());

  /* ── the lesson loop ── */
  let mode = null;
  const unitById = (id) => R.units.find((u) => u.id === id);
  // Route and zone chalk are off unless the step asks (the dad, 2026-11-11: "don't show receiver
  // routes unless it's relevant for that puzzle or section of the lesson"). A card, walkthrough step
  // or puzzle carries `routes: true | ['Z', ...]` and `zones: true | [ids]` where they are the point;
  // a single bubble or callout may carry its own. Watch and the film room use the play's own flags.
  const chalkOf = (s) => ({ routes: (s && s.routes) || false, zones: (s && s.zones) || false });
  function startUnit(u, at) {
    show('scrStage');
    $('scoreboard').hidden = true; $('stDots').hidden = false;
    const steps = [...u.cards.map((c, i) => ({ k: 'card', i })), { k: 'watch' }, { k: 'walk' }, { k: 'puzzles' }];
    let si = at === 'puzzles' ? steps.length - 1 : 0;
    const go = (d) => { si = Math.max(0, Math.min(steps.length - 1, si + d)); run(); };
    function run() {
      const s = steps[si];
      dots(steps.length, si);
      fopts.pauseAtCallouts = false;
      if (s.k === 'card') {
        // A chalk-talk card is a run of coach bubbles, each pointing at its own thing with the
        // camera on it. Next walks the bubbles, then on to the next step; Back walks them back.
        const c = u.cards[s.i], play = L.PLAYS[c.play || u.play];
        let bi = s.from === 'end' ? c.say.length - 1 : 0;
        s.from = null;
        const sayIt = () => {
          const b = c.say[bi];
          field.say({ text: b.text, focus: b.focus, tone: 'note', zoom: true, n: c.say.length > 1 ? `${bi + 1} of ${c.say.length}` : '', routes: b.routes, zones: b.zones });
          mode.bubble = bi;
        };
        mode = { kind: 'card', unit: u, step: si,
          main: () => { if (bi < c.say.length - 1) { bi++; sayIt(); } else go(1); },
          prev: () => { if (bi > 0) { bi--; sayIt(); } else if (si) { if (steps[si - 1].k === 'card') steps[si - 1].from = 'end'; go(-1); } else location.hash = '#map'; } };
        field.setPlay(play, { callouts: false, ...chalkOf(c) });
        field.setMarks([]);
        panel({ step: `${u.title}: chalk talk ${s.i + 1}/${u.cards.length}`, title: c.title });
        actions({ prev: true, main: 'Next' });
        sayIt();
      } else if (s.k === 'watch') {
        const play = L.PLAYS[u.play];
        fopts.pauseAtCallouts = true;
        mode = { kind: 'watch', unit: u, step: si, playMain: true, ended: false, prev: () => go(-1) };
        mode.main = () => { if (mode.ended && !field.playing) return go(1); if (field.playing) field.pause(); else field.start(); };
        mode.onEnd = () => { mode.ended = true; renderPlayButton(); };
        field.setPlay(play);
        panel({ step: `${u.title}: watch it`, title: play.name, text: 'Press Play. It stops at each note; press Next to go on.' });
        actions({ prev: true, replay: true, main: 'Play' });
      } else if (s.k === 'walk') walkthrough(u, () => go(1), () => go(-1));
      else puzzleSet(u);
    }
    run();
  }
  function walkthrough(u, next, prev) {
    const play = L.PLAYS[u.play];
    let j = 0;
    mode = { kind: 'walk', unit: u, prev };
    // The prompt is a bubble pointing at where to look (never at the answer itself); the camera
    // frames that and the answer together, so the player he needs is always on screen. A bubble that
    // asks for a tap fades nobody (spot: false): the answer is often outside what it points at, and
    // fading would hide him; lighting him too would give him away.
    function ask() {
      const w = u.walk[j];
      field.setPlay(play, { callouts: false, ...chalkOf(w) });
      mode.target = w; mode.main = null;
      panel({ step: `${u.title}: walkthrough ${j + 1}/${u.walk.length}` });
      actions({ prev: true });
      field.say({ text: w.prompt, focus: w.look, frame: [w.answer], tone: 'prompt', zoom: true, spot: false });
    }
    mode.tap = (id) => {
      const w = u.walk[j];
      if (!mode.target) return;
      const ok = CS.checkPuzzle({ id: 'walk', type: 'tap', play: u.play, find: w.find, answer: w.answer }, id);
      if (ok) {
        SFX.right();
        mode.target = null;
        field.setMarks([{ id, kind: 'good' }]);
        field.say({ parts: [{ tag: 'b', text: 'Right. ' }, nameOf(play, id) + '.'], focus: [id], tone: 'good' });
        mode.main = () => { j++; if (j < u.walk.length) ask(); else next(); };
        actions({ prev: true, main: j + 1 < u.walk.length ? 'Next' : 'On to the puzzles' });
      } else {
        SFX.wrong();
        field.setMarks(id ? [{ id, kind: 'bad' }] : []);
        field.say(id ? { parts: ['That is the ', { tag: 'b', text: lc(nameOf(play, id)) }, '. ' + w.prompt], focus: [id], tone: 'bad', spot: false }
          : { parts: ['No player there. Tap right on him. ' + w.prompt], focus: w.look, tone: 'bad', spot: false });
      }
    };
    ask();
  }
  function puzzleSet(u) {
    let k = 0, firstTry = 0;
    const next = () => {
      k++;
      if (k < u.puzzles.length) return ask();
      apply({ kind: 'unit', unit: u.id, score: firstTry });
      apply({ kind: 'seen', play: u.play });
      unitDone(u, firstTry);
    };
    const ask = () => askPuzzle(u.puzzles[k], {
      step: `${u.title}: puzzle ${k + 1}/${u.puzzles.length}`, tries: 2,
      onResolved: (ok, tryNo) => { if (ok && tryNo === 1) firstTry++; }, next,
    });
    ask();
  }
  // One puzzle. tries = 2 in lessons (10 XP first try, 5 second, then the reveal), 1 on Game Day.
  function askPuzzle(pz, o) {
    const play = L.PLAYS[pz.play], T = CS.puzzleTypes[pz.type];
    let tryNo = 1, done = false;
    field.setPlay(play, { callouts: false, ...chalkOf(pz) });
    const focus = (pz.focus || []).map((id) => ({ id, kind: 'focus' }));
    field.setMarks(focus);
    panel({ step: o.step, text: pz.prompt, prompt: true, options: pz.type === 'choice' ? pz.options.map((x) => x.t) : null });
    actions({});
    mode = { kind: o.gameDay ? 'gameday' : 'puzzle', pz, tryNo: 1 };
    const rightName = () => (pz.type === 'tap' ? nameOf(play, T.truth(pz)) : pz.options[pz.answer].t);
    // Where the answer's explanation points: the right player on a tap puzzle, the thing a choice
    // question is about when there is one. A pure fact question has nothing on the field to show,
    // so its explanation stays in the panel under the options.
    function lookOf() {
      if (pz.type === 'tap') return [T.truth(pz)];
      if (pz.look) return CS.toArr(pz.look);
      const c = CS.compile(play), tes = c.off.filter((p) => p.pos === 'TE');
      const byQ = { fieldSide: ['field'], boundarySide: ['boundary'], redZone: ['redzone'], onLineCount: ['line'], qbAlign: ['QB'],
        strength: tes.length === 1 ? [tes[0].id] : ['field'], count: pz.pos && pz.pos.includes('LB') ? ['lb'] : pz.pos && pz.pos.includes('CB') ? ['db'] : null };
      const f = pz.of ? [pz.of] : byQ[pz.q] || null;
      return f && f.every((tok) => CS.focusOf(play, tok, field.PRE)) ? f : null;
    }
    function resolve(ok, picked) {
      done = true;
      const xp = o.gameDay ? 0 : recordAnswer(pz, tryNo, ok);
      if (o.gameDay) for (const tag of pz.tags || []) S.srs = CS.srsReview(S.srs, tag, ok, Date.now());
      if (o.gameDay) save();
      if (o.onResolved) o.onResolved(ok, tryNo);
      const marks = focus.slice();
      if (pz.type === 'tap') { if (!ok && picked) marks.push({ id: picked, kind: 'bad' }); marks.push({ id: T.truth(pz), kind: 'good' }); }
      field.setMarks(marks);
      if (pz.type === 'choice') markOptions(picked, ok);
      const parts = ok ? [{ tag: 'b', text: 'Right.' }, xp ? ' ' : '', xp ? { tag: 'span', cls: 'xpflash', text: `+${xp} XP` } : '', ' ' + pz.why]
        : [{ tag: 'b', text: 'The answer: ' + rightName() + '.' }, ' ' + pz.why];
      if (ok) SFX.right(); else SFX.wrong();
      const look = lookOf();
      if (look) { feedback(null); field.say({ parts: parts.filter((p) => p !== ''), focus: look, tone: ok ? 'good' : 'bad', zoom: false }); }
      else feedback(ok ? 'good' : 'bad', parts);
      mode.done = true; mode.main = o.next; mode.ok = ok;
      actions({ replay: true, main: o.nextLabel || 'Next' });
      field.seek(field.PRE); field.start();                   // after any answer, the play runs
    }
    function markOptions(picked, ok) {
      [...$('stOpts').children].forEach((b, i) => {
        b.disabled = true;
        if (i === pz.answer) b.classList.add('good');
        else if (i === picked && !ok) b.classList.add('bad');
      });
    }
    mode.answer = (ans) => {
      if (done) return;
      if (pz.type === 'tap' && !ans) { field.say(null); feedback('bad', ['No player there. Tap right on him.']); return; }   // grass is not a guess
      const ok = CS.checkPuzzle(pz, ans);
      if (ok || tryNo >= o.tries) return resolve(ok, ans);
      // First miss in a lesson: show what he picked, keep the question open for one more try.
      SFX.wrong();
      tryNo = 2; mode.tryNo = 2;
      if (pz.type === 'tap') {
        field.setMarks(focus.concat([{ id: ans, kind: 'bad' }]));
        field.say({ parts: ['That is the ', { tag: 'b', text: lc(nameOf(play, ans)) }, '. One more try.'], focus: [ans], tone: 'bad', zoom: false, spot: false });
      } else {
        const b = $('stOpts').children[ans];
        if (b) { b.classList.add('bad'); b.disabled = true; }
        feedback('bad', ['Not that one. One more try.']);
      }
    };
  }
  function onTap(id) {
    if (!mode || screen !== 'scrStage') return;
    if (mode.kind === 'walk' && mode.tap) return mode.tap(id);
    if ((mode.kind === 'puzzle' || mode.kind === 'gameday') && mode.pz && mode.pz.type === 'tap' && !mode.done) mode.answer(id);
  }
  function onChoice(i) {
    if (mode && mode.pz && mode.pz.type === 'choice' && !mode.done) mode.answer(i);
  }
  function unitDone(u, firstTry) {
    show('scrResult');
    const i = R.units.indexOf(u), nextU = R.units[i + 1];
    $('resTitle').textContent = u.title + ': done';
    $('resBig').hidden = false; $('resBig').className = 'big'; $('resBig').textContent = `${firstTry}/${u.puzzles.length}`;
    $('resText').textContent = `First-try answers: ${firstTry} of ${u.puzzles.length}. "${L.PLAYS[u.play].name}" is in the film room now.`;
    $('resTags').hidden = true;
    $('resNext').textContent = nextU ? 'Next unit' : 'Game Day';
    $('resNext').onclick = () => { location.hash = nextU ? '#unit/' + nextU.id : '#gameday'; };
    $('resMap').onclick = () => { location.hash = '#map'; };
    mode = { kind: 'unitdone', unit: u };
  }

  /* ── Game Day ── */
  let gdAttempt = 0;
  function startGameDay() {
    show('scrStage');
    $('scoreboard').hidden = false; $('stDots').hidden = true;
    gdAttempt++;
    const qs = CS.pickGameDay(R.gameDay, (USER || 'guest') + ':' + S.xp + ':' + gdAttempt + ':' + Date.now());
    const results = [];
    let k = 0;
    const score = () => { $('sbQ').textContent = `${Math.min(k + 1, qs.length)}/${qs.length}`; $('sbRight').textContent = String(results.filter(Boolean).length); $('sbMiss').textContent = String(results.filter((r) => !r).length); };
    const ask = () => {
      score();
      askPuzzle(qs[k], {
        step: 'Game Day', tries: 1, gameDay: true, nextLabel: k + 1 < qs.length ? 'Next' : 'Final score',
        onResolved: (ok) => { results.push(ok); score(); },
        next: () => { k++; if (k < qs.length) ask(); else finish(); },
      });
      mode.gdIndex = k; mode.questions = qs;
    };
    function finish() {
      const right = results.filter(Boolean).length, passed = CS.gameDayPassed(right, qs.length);
      const rankBefore = S.rank;
      apply({ kind: 'gameday', rank: R.rank, passed });
      const promoted = S.rank > rankBefore;
      gameDayResult(qs, results, right, passed);
      if (promoted) promote();
    }
    ask();
  }
  function gameDayResult(qs, results, right, passed) {
    show('scrResult');
    $('resTitle').textContent = passed ? 'Game Day: passed' : 'Game Day: not this time';
    $('resBig').hidden = false; $('resBig').className = 'big ' + (passed ? 'pass' : 'fail'); $('resBig').textContent = `${right}-${qs.length - right}`;
    const tg = $('resTags');
    tg.innerHTML = '';
    if (passed) {
      $('resText').textContent = `${right} of ${qs.length} right. You needed ${CS.GAMEDAY.pass}.`;
      tg.hidden = true;
    } else {
      $('resText').textContent = `${right} of ${qs.length} right; you need ${CS.GAMEDAY.pass}. It costs nothing: look at these again, then come back.`;
      const missed = CS.missedTags(qs, results);
      const units = [...new Set(missed.map((t) => R.units.find((u) => u.cards.some((c) => c.teaches.includes(t)))).filter(Boolean))];
      for (const u of units) { const b = doc.createElement('button'); b.type = 'button'; b.className = 'chip'; b.style.minHeight = '44px'; b.textContent = u.title; b.dataset.tag = missed.filter((t) => u.cards.some((c) => c.teaches.includes(t))).join(' '); b.addEventListener('click', () => { location.hash = '#unit/' + u.id; }); tg.appendChild(b); }
      tg.hidden = !units.length;
    }
    $('resNext').textContent = passed ? 'Career map' : 'Try again';
    $('resNext').onclick = () => { if (passed) location.hash = '#map'; else startGameDay(); };
    $('resMap').onclick = () => { location.hash = '#map'; };
    mode = { kind: 'gdresult', passed, right };
  }

  /* ── the promotion ── fires from a Game Day pass that raised the rank, and from nowhere else,
     so it shows once; a reload finds the rank already raised and shows nothing. */
  let promoCount = 0;
  function promote() {
    promoCount++;
    const name = USER || 'Coach';
    $('promoText').textContent = `This agreement promotes ${name} from ${R.title} to`;
    $('promoNew').textContent = R.promotesTo;
    $('promoDate').textContent = 'Signed ' + new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    $('promo').hidden = false;
    $('promoOk').focus();
    SFX.fanfare();
  }
  $('promoOk').addEventListener('click', () => { $('promo').hidden = true; });

  /* ── career map ── */
  const LOCK = '<svg class="lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  function renderMap() {
    show('scrMap');
    mode = { kind: 'map' };
    renderLevel();
    const box = $('ranks');
    box.innerHTML = '';
    CS.RANKS.forEach((title, r) => {
      const card = doc.createElement('section');
      const data = CS.RANK_DATA[r];
      const done = r < S.rank, now = r === S.rank && !!data, locked = !data || r > S.rank;
      card.className = 'card rank' + (done ? ' done' : '') + (now ? ' now' : '') + (locked && !done ? ' locked' : '');
      card.dataset.rank = String(r);
      const head = doc.createElement('div'); head.className = 'rhead';
      head.innerHTML = `<span class="rnum">${r + 1}</span><div><div class="rtitle"></div><div class="rsub"></div></div>` + (locked && !done ? LOCK : '');
      head.querySelector('.rtitle').textContent = title;
      head.querySelector('.rsub').textContent = done ? 'Promoted' : data ? data.subtitle : 'Locked';
      card.appendChild(head);
      if (data && !locked || data && done) {
        const list = doc.createElement('div'); list.className = 'units';
        data.units.forEach((u, i) => {
          const open = CS.unitOpen(S, data.units, i), isDone = !!(S.units[u.id] && S.units[u.id].done);
          const b = doc.createElement('button'); b.type = 'button'; b.className = 'unit' + (isDone ? ' isdone' : ''); b.disabled = !open; b.dataset.unit = u.id;
          b.innerHTML = `<span class="un">${i + 1}</span><span class="ut"><span class="nm"></span><small></small></span>` + (open ? '' : LOCK);
          b.querySelector('.nm').textContent = u.title;
          b.querySelector('small').textContent = isDone ? `Done, best ${S.units[u.id].best}/${u.puzzles.length} first try` : u.blurb;
          b.addEventListener('click', () => { location.hash = '#unit/' + u.id; });
          list.appendChild(b);
        });
        const gd = doc.createElement('button'); gd.type = 'button'; gd.className = 'unit gd'; gd.id = 'btnGameDay';
        const gdOpen = CS.gameDayOpen(S, data.units);
        gd.disabled = !gdOpen;
        gd.innerHTML = `<span class="un">GD</span><span class="ut"><span class="nm">Game Day</span><small></small></span>` + (gdOpen ? '' : LOCK);
        gd.querySelector('small').textContent = done ? 'Passed. Play it again any time.' : gdOpen ? `${CS.GAMEDAY.n} questions, ${CS.GAMEDAY.pass} to pass. Pass and you're promoted.` : 'Finish every unit to unlock it.';
        gd.addEventListener('click', () => { location.hash = '#gameday'; });
        list.appendChild(gd);
        card.appendChild(list);
        const row = doc.createElement('div'); row.className = 'maprow';
        const fb = doc.createElement('button'); fb.type = 'button'; fb.id = 'btnFilm'; fb.textContent = 'Film room';
        fb.addEventListener('click', () => { location.hash = '#film'; });
        row.appendChild(fb); card.appendChild(row);
      }
      box.appendChild(card);
    });
  }

  /* ── film room ── */
  function renderFilm() {
    show('scrFilm');
    mode = { kind: 'film' };
    const box = $('films');
    box.innerHTML = '';
    $('filmEmpty').hidden = S.seenPlays.length > 0;
    for (const id of S.seenPlays) {
      const p = L.PLAYS[id];
      if (!p) continue;
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'unit';
      b.innerHTML = '<span class="ut"><span class="nm"></span><small></small></span>';
      b.querySelector('.nm').textContent = p.name;
      b.querySelector('small').textContent = `${L.TEAMS[p.teams.off].city} ${L.TEAMS[p.teams.off].name} vs ${L.TEAMS[p.teams.def].city} ${L.TEAMS[p.teams.def].name}`;
      b.addEventListener('click', () => { location.hash = '#film/' + id; });
      box.appendChild(b);
    }
  }
  function playFilm(id) {
    const play = L.PLAYS[id];
    if (!play) return renderFilm();
    show('scrStage');
    $('scoreboard').hidden = true; $('stDots').hidden = true;
    fopts.pauseAtCallouts = true;
    mode = { kind: 'watch', playMain: true, ended: false, prev: () => { location.hash = '#film'; } };
    mode.main = () => { if (mode.ended && !field.playing) { location.hash = '#film'; return; } if (field.playing) field.pause(); else field.start(); };
    mode.onEnd = () => { mode.ended = true; renderPlayButton(); };
    field.setPlay(play);
    panel({ step: 'Film room', title: play.name, text: 'Press Play. It stops at each note; press Next to go on.' });
    actions({ prev: true, replay: true, main: 'Play' });
  }

  /* ── engine demo (phase 1's screen, kept as a developer route) ── */
  function initDemo() {
    if (demo) return;
    const play = L.PLAYS['smash-vs-c2'];
    const readout = $('readout'), scrub = $('scrub'), clock = $('clock'), btnPlay = $('btnPlay'), btnSlow = $('btnSlow');
    let lastCallout = null;
    demo = CS.mountField($('cs-field'), {
      onTap: (id) => {
        readout.textContent = '';
        if (!id) { readout.textContent = 'No player there. Tap right on him.'; return; }
        const team = CS.compile(play).byId[id].team === 'off' ? play.teams.off : play.teams.def;
        readout.appendChild(doc.createTextNode('You tapped: '));
        const b = doc.createElement('b'); b.textContent = L.LABELS[id] || id; readout.appendChild(b);
        readout.appendChild(doc.createTextNode(' (' + L.TEAMS[team].name + ')'));
      },
      onFrame: (t, k) => {
        scrub.value = String(t);
        clock.textContent = t < 0 ? 'PRE-SNAP' : 'SNAP +' + t.toFixed(1) + 's';
        if (k !== lastCallout) { lastCallout = k; $('calloutLive').textContent = k ? k.text : ''; }
      },
      onState: () => {
        btnPlay.innerHTML = (demo.playing ? ICON_PAUSE : ICON_PLAY) + '<span>' + (demo.playing ? 'Pause' : 'Play') + '</span>';
        btnSlow.setAttribute('aria-pressed', demo.speed === 0.5 ? 'true' : 'false');
      },
    });
    demo.setPlay(play);
    scrub.min = String(demo.PRE); scrub.max = String(demo.T);
    $('playName').textContent = play.name;
    btnPlay.addEventListener('click', () => { if (demo.playing) demo.pause(); else demo.start(); });
    btnSlow.addEventListener('click', () => demo.setSpeed(demo.speed === 0.5 ? 1 : 0.5));
    scrub.addEventListener('input', () => { demo.pause(); demo.seek(parseFloat(scrub.value)); });
    const legend = $('legend');
    $('btnKey').addEventListener('click', () => { demo.pause(); legend.hidden = false; $('btnKeyClose').focus(); });
    const closeKey = () => { legend.hidden = true; $('btnKey').focus(); };
    $('btnKeyClose').addEventListener('click', closeKey);
    legend.addEventListener('click', (e) => { if (e.target === legend) closeKey(); });
    doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !legend.hidden) closeKey(); });
    const fitDemo = () => demo.fit($('demoBox'));
    if (root.ResizeObserver) new ResizeObserver(fitDemo).observe($('demoBox'));
    root.addEventListener('resize', fitDemo);
  }

  /* ── routing ── */
  function route() {
    const h = (location.hash || '#map').slice(1).split('/');
    if (h[0] === 'demo') { initDemo(); show('scrDemo'); demo.fit($('demoBox')); demo.draw(); return; }
    if (h[0] === 'unit' && unitById(h[1])) { startUnit(unitById(h[1]), h[2]); fitStage(); return; }
    if (h[0] === 'gameday') { startGameDay(); fitStage(); return; }
    if (h[0] === 'film' && h[1]) { playFilm(h[1]); fitStage(); return; }
    if (h[0] === 'film') return renderFilm();
    renderMap();
  }
  root.addEventListener('hashchange', route);
  renderMute();
  renderLevel();
  route();

  /* ── the test and debugging hook ── Tests assert yards and the hit-test mapping, never pixels;
     the field getters follow whichever field is on screen. */
  root.__CS__ = {
    get field() { return active; },
    get play() { return active && active.play; }, get t() { return active.t; }, get playing() { return active.playing; }, get speed() { return active.speed; },
    get T() { return active.T; }, get keys() { return active.keys; }, get reduced() { return active.reduced; },
    seek: (t) => active.seek(t), screenToYard: (x, y) => active.screenToYard(x, y), yardToScreen: (x, y) => active.yardToScreen(x, y),
    hitTest: (x, y) => active.hitTest(x, y), spriteRect: (id) => active.spriteRect(id),
    get hitRadius() { return active.hitRadius; }, PRE: field.PRE,
    get camera() { return active.camera; }, get coach() { return active.coach; }, get saying() { return active.saying; }, get spot() { return active.spot; },
    ui: {
      get state() { return JSON.parse(JSON.stringify(S)); }, get key() { return KEY; }, get screen() { return screen; },
      get mode() { return mode ? { kind: mode.kind, bubble: mode.bubble, step: mode.step, ended: !!mode.ended, pz: mode.pz ? mode.pz.id : null, done: !!mode.done, ok: mode.ok, tryNo: mode.tryNo, gdIndex: mode.gdIndex, passed: mode.passed, right: mode.right } : null; },
      get promoCount() { return promoCount; },
      next: () => { if (mode && mode.main) mode.main(); },
      // Answer the current Game Day / lesson puzzle right or wrong through the same path a tap or
      // a button press takes (the suite uses this to reach the Game Day boundary quickly).
      answer: (right) => {
        if (!mode || !mode.pz || mode.done) return false;
        const pz = mode.pz;
        if (pz.type === 'choice') { const i = right ? pz.answer : pz.options.findIndex((o, j) => j !== pz.answer); onChoice(i); return true; }
        const ans = right ? CS.puzzleTypes.tap.truth(pz) : CS.puzzleTypes.tap.distractors(pz)[0];
        mode.answer(ans); return true;
      },
    },
  };
})(window);
