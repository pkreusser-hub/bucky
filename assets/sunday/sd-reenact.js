'use strict';
/* Sunday, part 3: play animations. Each play is re-staged on a small 3D field from the
   play-by-play text. The spots, yardage, direction and named players are real; the other
   players, the routes and the timing are drawn to fit. Loaded after app.js and features.js. */

/* ═════════════ Reading a play ═════════════ */
const RAX = 26.67;                                   // half the field's width, in yards
const raX = (x) => clamp(x, -RAX + 1, RAX - 1);
// The continuation clause excludes ESPN's own ALL-CAPS markers (INTERCEPTED, TOUCHDOWN, FUMBLES,
// PENALTY, REVERSED, SAFETY) — without this a name greedily swallows a following marker word,
// since an all-caps word is itself valid title-case-shaped text ("J.Dotson INTERCEPTED").
const RA_PL = "(?:#(\\d{1,2})\\s*)?([A-Z][A-Za-z.'’-]*(?:\\s(?!(?:INTERCEPTED|TOUCHDOWN|FUMBLES|PENALTY|REVERSED|SAFETY)\\b)(?:[A-Z][A-Za-z.'’-]*|III|II|IV)){0,2})";
const RA_SPOT = "(?:the\\s)?(?:([A-Z][A-Z&]{1,5})\\s?(\\d{1,2})\\b|(50)\\b)";

function raRng(seed) {
  let a = 7;
  for (const c of String(seed)) a = (a * 31 + c.charCodeAt(0)) | 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Pulls who did what, and where, out of ESPN's play text.
function raParse(p, ev) {
  let t = cleanText(p.text).replace(/\s+/g, ' ');
  const gun = /shotgun|pistol/i.test(t);
  t = t.replace(/^(?:No Huddle[- ]?)?(?:Shotgun|Pistol|Under Center|Wildcat)?\s*/i, '');
  // ESPN sometimes glues the next few snaps onto a scoring play; keep only the first.
  t = t.replace(/\s\(\d{1,2}:\d{2}\)\s[\s\S]*$/, '');
  const who = (num, name) => {
    if (!name || /^[A-Z&\s.'-]+$/.test(name)) return null;        // all caps = a team or a keyword
    // A name at the end of a sentence absorbs the period ("...to J.Dotson."); drop it, but never
    // a period that's part of an initial ("M." stays — the char before it there is uppercase).
    if (/[a-z]\.$/.test(name)) name = name.slice(0, -1);
    const base = name.replace(/\s(?:III|II|IV|Jr\.?)$/, '');
    return { num: num || null, name, last: base.split(/[\s.]/).filter(Boolean).pop() };
  };
  // ESPN capitalises its keyword markers (TOUCHDOWN, INTERCEPTED, FUMBLES, RECOVERED, PENALTY)
  // but not the surrounding prose ("INTERCEPTED by X.McKinney"). A blanket /i flag here would
  // also blunt RA_PL's own [A-Z] case requirement (letting it swallow trailing lowercase words
  // like "to"/"at"), so the keyword alternatives below spell out both cases explicitly instead.
  const get = (re) => { const m = new RegExp(re).exec(t); return m ? who(m[1], m[2]) : null; };
  const getOn = (text, re) => { const m = new RegExp(re).exec(text); return m ? who(m[1], m[2]) : null; };
  const subseq = (a, s) => { let i = 0; for (const ch of s) if (ch === a[i]) i++; return i === a.length; };
  // NFL text abbreviations sometimes differ from the team's own ESPN abbreviation (WAS vs WSH,
  // LA vs LAR, JAC vs JAX). Exact match first, then a fuzzy subsequence match within this game's
  // two teams only (so "LA" resolves to whichever of LAR/LAC is actually playing).
  const sideOf = (ab) => {
    const u = ab.toUpperCase();
    const teams = [ev.home, ev.away];
    const exact = teams.find((tm) => (tm.abbr || '').toUpperCase() === u);
    if (exact) return exact;
    const hits = teams.filter((tm) => { const full = `${tm.abbr} ${tm.loc} ${tm.name}`.toUpperCase(); return full.includes(u[0]) && subseq(u, full) && (tm.abbr[0] === u[0] || (tm.loc || '')[0] === u[0]); });
    return hits.length === 1 ? hits[0] : null;
  };
  const spot = (re) => {
    const m = new RegExp(re + '\\s*' + RA_SPOT).exec(t);
    if (!m) return null;
    const [ab, n, fifty] = m.slice(-3);
    if (fifty) return 50;
    const tm = sideOf(ab);
    return tm ? (tm.id === ev.home.id ? +n : 100 - +n) : null;
  };
  const dm = /\b(?:pass(?: complete| incomplete)?|rush|run|scramble)\s+(?:(short|deep)\s+)?(left|middle|right|up the middle)?(?:\s+(end|tackle|guard))?/.exec(t) || [];
  const tacklers = [];
  for (const g of t.matchAll(/\(([^()]*)\)/g)) {
    if (/H:|LS:|Original|clock/i.test(g[1])) continue;
    for (const it of g[1].split(/[;,]/)) { const m = /^\s*(?:#(\d{1,2})\s*)?(.+?)\s*$/.exec(it); const w = m && who(m[1], m[2]); if (w) tacklers.push(w); }
    break;
  }
  // NFL: "PENALTY on GB-J.Burton, False Start, 5 yards, enforced at ATL 49 - No Play." (or, with
  // no named player, "PENALTY on GB, Delay of Game, 5 yards, ..."). The team code is followed by
  // "-Name" or a comma directly, then the foul name up to the next comma.
  const pen = /PENALTY (?:on )?([A-Z&]{2,5})(?:-[A-Za-z.'’-]+)?,\s*([^,]+?),\s*-?\d+\s*yards?/i.exec(t)
    || /PENALTY ([A-Z&]{2,5})\s+(.+?)(?:\s\(|\s\d+ yards?|\sdeclined|\.|,|$)/i.exec(t);
  const recBy = /(?:recovered|RECOVERED) by (?:[A-Z&]{2,5}-)?([A-Z&]{2,5})\b/.exec(t) || /RECOVERED by ([A-Z&]{2,5})-/.exec(t);
  const tt = p.typeText || '';
  const hasFumble = /\bFUMBLES?\b/i.test(t);
  return {
    text: t, gun,
    depth: dm[1] || '', dir: dm[2] === 'up the middle' ? 'middle' : dm[2] || '', gap: dm[3] || '',
    passer: get(RA_PL + ' pass\\b'),
    // "pass ... to X" (complete) or "pass ... intended for X" (incomplete/intercepted).
    target: get('pass (?:complete|incomplete)?[a-z ]*? (?:to|intended for) ' + RA_PL),
    // NFL run text has no "rush"/"run" verb — the direction phrase follows the name directly
    // ("Bi.Robinson left tackle to ATL 34...", "K.Johnson up the middle...").
    rusher: get(RA_PL + ' (?:rush|run|scramble|kneel)') || (p.kind === 'run' ? get(RA_PL + '\\s+(?:left|right|up the middle)\\b') : null),
    sacked: get(RA_PL + ' sacked'),
    interceptor: get('(?:intercepted|INTERCEPTED) by ' + RA_PL),
    kicker: get(RA_PL + '\\s+(?:\\d+\\s*yards?\\s+)?(?:kicks|punts|kickoff|punt|field goal|extra point|kick attempt|onside)'),
    // NFL kickoff/punt returns often skip the word "return" entirely: "Br.Robinson to ATL 30 for
    // 24 yards (B.Melton)." — the name directly precedes the landing spot. The lookbehind keeps
    // this from matching inside a "Center-M.Orzech."/"Holder-J.Bailey" credit line.
    // Kicking-play credit lines ("Center-M.Orzech.", "Holder-J.Bailey") sit right next to the
    // returner clause; RA_PL's own char class allows the hyphen and the initial's period, so
    // without stripping these first, "Center-M.Orzech. O.Zaccheaus" merges into one false name.
    returner: get(RA_PL + ' return(?:s|ed)?\\b') || get('fair catch by ' + RA_PL) || (p.kind === 'kickoff' || p.kind === 'punt'
      ? getOn(t.replace(/,?\s*(?:Center|Holder)-[A-Za-z.'’-]+\.?/g, ''), RA_PL + '\\s+to\\s+(?:[A-Z][A-Z&]{1,5}\\s?\\d{1,2}\\b|50\\b)')
      : null),
    // The fumbler is usually named right before "FUMBLES" ("J.Love FUMBLES"); when the clause
    // omits the name (it's the player just mentioned — the rusher/target/sacked player), `hasFumble`
    // below still gates the animation so a fumble is never silently dropped.
    fumbler: get(RA_PL + '\\s+FUMBLES') || get('fumbled? by ' + RA_PL),
    recoverer: get('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5}-)?' + RA_PL) || get('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5} )?' + RA_PL),
    recTeam: recBy ? sideOf(recBy[1]) : null,
    breakup: get('broken up by ' + RA_PL),
    tacklers,
    hasFumble,
    catchH: spot('caught at'),
    thrownH: spot('thrown to'),
    intH: spot('(?:intercepted|INTERCEPTED) by ' + RA_PL + ' at'),
    fumH: spot('fumbled? by ' + RA_PL + ' at') ?? spot('FUMBLES\\s*(?:\\([^)]*\\))?\\s*(?:\\[[^\\]]*\\])?,?\\s*at'),
    recH: spot('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5}-)?' + RA_PL + ' at') ?? spot('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5} )?' + RA_PL + ' at'),
    landH: spot('(?:kicks|punts|kickoff|punt) -?\\d+ yards? (?:from [A-Z&]{2,5} \\d{1,2} )?to'),
    kickYds: +(/(?:kicks|punts|kickoff|punt) (-?\d+) yards?/i.exec(t)?.[1] ?? NaN),
    fgYds: +(/field goal attempt from (\d+)|(\d+) (?:yd|yard) (?:field goal|FG)/.exec(t)?.slice(1).find(Boolean) ?? NaN),
    good: /\bgood\b/i.test(t + ' ' + tt) && !/no good|missed|blocked|failed/i.test(t + ' ' + tt),
    wide: /wide (left|right)/i.exec(t)?.[1]?.toLowerCase() || '',
    blocked: /blocked/i.test(t + ' ' + tt),
    fair: /fair catch/i.test(t),
    touchback: /touchback/i.test(t),
    oob: /out of bounds/i.test(t),
    td: /TOUCHDOWN/.test(t) || (p.scoring && /touchdown/i.test(tt)),
    safety: /SAFETY/.test(t) || /safety/i.test(tt),
    noPlay: /no play/i.test(t),
    declined: /declined/i.test(t),
    penTeam: pen ? sideOf(pen[1]) : null,
    penName: pen ? pen[2].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : '',
    kneel: /kneel/i.test(t),
    twoPt: /two[- ]point|2pt|conversion/i.test(tt + ' ' + t),
    firstDown: /1ST DOWN/i.test(t),
    onside: /onside/i.test(t),
  };
}

/* ═════════════ Staging a play ═════════════ */
// Every player is a list of keyframes [time, x, z, ease]; x is yards from the middle of the field
// (the offense's right is +), z is yards from the offense's own goal line (they always go up the screen).
function raEase(u, e) {
  if (e === 0) return u;
  if (e === 2) return 1 - (1 - u) * (1 - u);
  if (e === 3) return u * u;
  return u * u * (3 - 2 * u);
}
function raPos(a, t) {
  if (a.posFn) return a.posFn(t);
  const k = a.k;
  if (t <= k[0][0]) return [k[0][1], k[0][2]];
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i][0]) {
      const [t0, x0, z0] = k[i - 1], [t1, x1, z1, e] = k[i];
      const u = raEase((t - t0) / (t1 - t0 || 1), e);
      return [x0 + (x1 - x0) * u, z0 + (z1 - z0) * u];
    }
  }
  const l = k[k.length - 1];
  return [l[1], l[2]];
}

function raBuild(p, ev, qbs, opts = {}) {
  const I = raParse(p, ev);
  const rng = raRng(p.id);
  const R = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const offHome = p.offId === ev.home.id;
  const Z = (H) => (H == null ? null : offHome ? H : 100 - H);
  const offT = offHome ? ev.home : ev.away, defT = offHome ? ev.away : ev.home;
  const pc = pair(ev.away, ev.home);
  const col = { o: offHome ? pc.hRaw : pc.aRaw, d: offHome ? pc.aRaw : pc.hRaw };
  let kind = p.kind;
  if (I.twoPt) kind = /pass/i.test(I.text) ? 'pass' : 'run';
  if (kind === 'fg' && I.twoPt) kind = 'run';
  if (kind === 'penalty' && I.noPlay && /pass incomplete/.test(I.text.split('PENALTY')[0])) kind = 'incomplete';
  if (kind === 'penalty' && !I.noPlay) kind = /pass/.test(I.text) ? (/incomplete/.test(I.text) ? 'incomplete' : 'pass') : /rush|run/.test(I.text) ? 'run' : 'penalty';
  if ((kind === 'pass' || kind === 'incomplete') && /intercept/i.test(p.typeText + I.text)) kind = 'int';
  if (I.kneel) kind = 'kneel';
  const isPAT = /extra point|kick attempt|pat\b/i.test(p.typeText) || (kind === 'fg' && p.sH == null);
  let z0 = Z(p.sH);
  if (z0 == null) z0 = isPAT || I.twoPt ? 97 : kind === 'kickoff' ? 35 : 25;
  if (isPAT && z0 < 80) z0 = 97;
  let zEnd = Z(p.eH);
  // The play's own end (the end spot less any penalty yards walked off afterwards).
  const zPlay = p.yards != null && p.penYards ? z0 + p.yards : zEnd ?? z0 + (p.yards || 0);
  // NFL hash marks are 70'9" apart (~23.58 yd from each sideline on a 53.33-yd field), so a hash
  // snap spot sits +/-3.08 yd from the center (26.665 - 23.58), not college's +/-6.67.
  const x0 = opts.x0 ?? pick([-3.08, 0, 0, 3.08]);
  // Gate on the FUMBLES keyword itself, not on successfully naming the fumbler — ESPN's NFL text
  // often omits the name ("...for -9 yards (D.Deablo). FUMBLES (D.Deablo)...") when it's the same
  // player just mentioned, and a missed name must never silently drop the fumble animation.
  const zFum = I.hasFumble ? Z(I.fumH ?? I.recH ?? p.eH ?? p.sH) : null;
  const lostFum = zFum != null && (!I.recTeam || I.recTeam.id !== p.offId);
  if (zFum != null) I.td = I.td && !lostFum;

  const sc = { actors: [], ball: [], events: [], z0, x0, offHome, ltg: p.dist && p.down && z0 + p.dist < 100 ? z0 + p.dist : null, col, offT, defT, tS: !opts.from ? 1.1 : opts.from.timeout || opts.from.halftime || ['kickoff', 'punt', 'fg'].includes(p.kind) ? 6 : opts.from.huddle ? 4 : 4.5, homeCol: offHome ? col.o : col.d };
  const tS = sc.tS;
  const P = (side, role, x, z) => { const a = { side, role, k: [[0, raX(x), z, 0]] }; sc.actors.push(a); return a; };
  const lastT = (a) => a.k[a.k.length - 1][0];
  const go = (a, t, x, z, e = 1) => {
    if (a.k.length === 1 && t > tS + 0.05) a.k.push([tS, a.k[0][1], a.k[0][2], 0]);   // set until the snap, then move
    if (t <= lastT(a)) t = lastT(a) + 0.04; a.k.push([t, raX(x), clamp(z, -12, 112), e]); return t; };
  const hold = (a, t) => { if (t > lastT(a)) { const [x, z] = raPos(a, lastT(a)); a.k.push([t, x, z, 0]); } };
  const cut = (a, t) => { const [x, z] = raPos(a, t); a.k = a.k.filter((k) => k[0] < t); if (!a.k.length) a.k.push([0, x, z, 0]); a.k.push([t, x, z, 0]); };
  // Run to a point at a football speed; returns the arrival time.
  const run = (a, t0, x, z, v = 8, e = 0) => { hold(a, t0); const [ax, az] = raPos(a, t0); const t1 = Math.max(t0, lastT(a)) + Math.max(0.25, Math.hypot(x - ax, z - az) / v); go(a, t1, x, z, e); return t1; };
  const ballHold = (a, t0, t1) => sc.ball.push({ t0, t1, a });
  const ballFly = (t0, t1, from, to, apex) => sc.ball.push({ t0, t1, from, to, apex });
  const banner = (t, title, sub, side) => sc.events.push({ t, kind: 'banner', title, sub, side });
  const off = {}, def = {};
  const who = (a, w) => { if (a && w) a.who = w; };
  const others = (side, skip) => sc.actors.filter((a) => a.side === side && !skip.includes(a));
  const nearest = (list, x, z, t) => [...list].sort((a, b) => { const [ax, az] = raPos(a, t), [bx, bz] = raPos(b, t); return Math.hypot(ax - x, az - z) - Math.hypot(bx - x, bz - z); });

  // Everyone in `list` closes on a point, as far as their legs allow.
  // From the end of a player's scripted part, keep him moving: track the ball at a football pace,
  // holding his own angle and distance so the pack doesn't collapse into one spot.
  const chaseUntil = (a, tUntil, v = a.side === 'd' ? 7.5 : 6, r = R(2, 7)) => {
    const t0 = Math.max(lastT(a), tS);
    if (t0 >= tUntil - 0.05 || a.downAt != null) return;
    let [x, z] = raPos(a, t0);
    const b0 = raBall(sc, t0);
    const ang = Math.atan2(z - b0.z, x - b0.x) + R(-0.6, 0.6);
    const n = Math.max(1, Math.round((tUntil - t0) / 0.35));
    for (let i = 1; i <= n; i++) {
      const t = t0 + (tUntil - t0) * i / n;
      const bb = raBall(sc, t);
      const gx = bb.x + Math.cos(ang) * r, gz = bb.z + Math.sin(ang) * r;
      const d = Math.hypot(gx - x, gz - z), step = v * (tUntil - t0) / n, f = d > step ? step / d : 1;
      x += (gx - x) * f; z += (gz - z) * f;
      go(a, t, x, z, 0);
    }
  };
  const converge = (list, t0, x, z, tArr, rMin = 2, rMax = 7, v = 8.5) => {
    for (const a of list) {
      chaseUntil(a, t0);
      cut(a, t0);
      const [ax, az] = raPos(a, t0);
      const ang = R(0, Math.PI * 2), r = R(rMin, rMax);
      const gx = x + Math.cos(ang) * r, gz = z + Math.sin(ang) * r;
      const d = Math.hypot(gx - ax, gz - az) || 1, f = Math.min(1, (v * Math.max(0.3, tArr - t0)) / d);
      go(a, Math.max(tArr, t0 + 0.3), ax + (gx - ax) * f, az + (gz - az) * f, 2);
    }
  };
  // Named tacklers from the text meet the ball carrier; the first one takes him down.
  const tackle = (car, tE, pool, names, carDown = true) => {
    const [xE, zE] = raPos(car, tE);
    const list = names.length ? names : [null];
    const chosen = [];
    for (const w of list.slice(0, 3)) {
      const cand = nearest(pool.filter((a) => !chosen.includes(a) && a !== car), xE, zE, tE - 0.8)[0];
      if (!cand) break;
      chosen.push(cand);
      who(cand, w);
      const i = chosen.length - 1;
      const [cx, cz] = raPos(cand, tE - 0.8);
      const lead = clamp(Math.hypot(cx - xE, cz - zE) / 8.5, 0.5, Math.max(0.5, tE - tS - 0.2));
      chaseUntil(cand, tE - lead);
      cut(cand, tE - lead);
      const toward = Math.sign(cz - zE) || 1;
      go(cand, tE, xE + (i === 1 ? -0.8 : i === 2 ? 0.8 : R(-0.4, 0.4)), zE + toward * (0.7 + i * 0.3), 3);
      if (i === 0 && carDown) cand.downAt = tE + 0.08;
      cand.labelAt = tE - 0.4;
    }
    if (carDown) car.downAt = tE;
    return chosen;
  };

  /* Formations */
  const scrimmage = () => {
    const teSide = rng() < 0.5 ? -1 : 1;
    off.C = P('o', 'OL', x0, z0 - 0.8);
    off.LG = P('o', 'OL', x0 - 1.9, z0 - 1); off.RG = P('o', 'OL', x0 + 1.9, z0 - 1);
    off.LT = P('o', 'OL', x0 - 3.8, z0 - 1.2); off.RT = P('o', 'OL', x0 + 3.8, z0 - 1.2);
    off.TE = P('o', 'TE', x0 + teSide * 5.9, z0 - 1.3);
    off.QB = P('o', 'QB', x0, z0 - (I.gun ? 5 : 1.4));
    off.RB = P('o', 'RB', x0 - (I.gun ? teSide * 1.8 : 0), z0 - (I.gun ? 5.2 : 6.8));
    off.WL = P('o', 'WR', Math.min(x0 - 9, -18.5 + R(-2, 2)), z0 - 1);
    off.WR = P('o', 'WR', Math.max(x0 + 9, 18.5 + R(-2, 2)), z0 - 1);
    const slotX = -teSide > 0 ? (x0 + 5 + raPos(off.WR, 0)[0]) / 2 : (x0 - 5 + raPos(off.WL, 0)[0]) / 2;
    off.SL = P('o', 'WR', slotX, z0 - 1.4);
    def.DL = [-4.6, -1.2, 1.2, 4.6].map((dx) => P('d', 'DL', x0 + dx, z0 + 1));
    def.LB = [-3.4, 3.4].map((dx) => P('d', 'LB', x0 + dx, z0 + 5));
    def.NB = P('d', 'DB', raPos(off.SL, 0)[0], z0 + 5.5);
    def.CL = P('d', 'DB', raPos(off.WL, 0)[0] + 0.5, z0 + 6.5);
    def.CR = P('d', 'DB', raPos(off.WR, 0)[0] - 0.5, z0 + 6.5);
    def.S = [-8, 8].map((dx) => P('d', 'DB', x0 + dx, Math.min(z0 + 13, 108)));
    off.OL = [off.LT, off.LG, off.C, off.RG, off.RT];
  };
  const snapTo = (a, t, dur = 0.3) => { ballHold(off.C, 0, t); const [x, z] = raPos(a, t + dur); ballFly(t, t + dur, [x0, z0 - 0.5, 0.3], [x, z, 1.1], 0.2); return t + dur; };
  const allDef = () => sc.actors.filter((a) => a.side === 'd');
  const allOff = () => sc.actors.filter((a) => a.side === 'o');
  const dirSign = I.dir === 'left' ? -1 : I.dir === 'right' ? 1 : 0;

  // Line play for a run (drive block) or a pass (pass set and rush).
  const linePlay = (pass, lean, qb, tUntil) => {
    // Blocks don't stand still: each lineman shoves and gives ground in short steps until tUntil.
    const shove = (a, x1, z1) => {
      const t0 = lastT(a), [xa, za] = raPos(a, t0);
      const n = Math.max(1, Math.round((tUntil - t0) / 0.3));
      for (let i = 1; i <= n; i++) {
        const u = i / n, w = i % 2 ? 1 : -1;
        go(a, t0 + (tUntil - t0) * u, xa + (x1 - xa) * u + (i < n ? w * R(0.35, 0.6) : 0), za + (z1 - za) * u + (i < n ? -w * R(0.1, 0.35) : 0), 0);
      }
    };
    for (const a of off.OL) { const [x, z] = raPos(a, 0); go(a, tS + 0.35, x + lean * 0.3, pass ? z - 1.4 : z0 - 0.1); shove(a, x + lean * 1.1, pass ? z - 1.8 : z0 + 1); }
    def.DL.forEach((a, i) => {
      const [x] = raPos(a, 0);
      go(a, tS + 0.35, x + lean * 0.2, pass ? z0 - 0.6 : z0 + 0.4);
      if (pass && qb) { const [qx, qz] = raPos(qb, tUntil); shove(a, x + (qx - x) * 0.45 + (i - 1.5) * 0.6, z0 - 1.6 + (qz - z0) * 0.25); } else shove(a, x + lean * 1.1, z0 + 1.4);
    });
  };
  // Receivers not involved run something believable; corners and safeties shadow them.
  const decoys = (skip, tEnd) => {
    for (const w of [off.WL, off.WR, off.SL, off.TE]) {
      if (skip.includes(w)) continue;
      const [x, z] = raPos(w, 0);
      const route = pick(['go', 'out', 'in', 'curl']);
      const deep = route === 'go' ? R(18, 26) : R(8, 13);
      const tBreak = go(w, tS + deep / 8.5 * 0.85, x + (route === 'go' ? R(-1, 1) : 0), z0 + deep * 0.85, 0);
      const bx = route === 'out' ? x + Math.sign(x || 1) * 6 : route === 'in' ? x - Math.sign(x || 1) * 7 : x;
      go(w, Math.max(tEnd, tBreak + 0.6), bx, z0 + deep + (route === 'curl' ? -2 : route === 'go' ? 8 : 0), 0);
    }
  };
  const cover = (pairs, tEnd) => {
    for (const [cb, wr] of pairs) {
      const [cx, cz] = raPos(cb, 0);
      go(cb, tS + 0.3, cx, cz - 0.6);
      for (let t = tS + 0.9; t <= tEnd + 0.01; t += 0.6) { const [x, z] = raPos(wr, Math.max(0, t - 0.25)); go(cb, t, x + R(-0.8, 0.8), Math.max(z + 1.2, z0 + 1), 1); }
    }
  };
  const drop = (list, tEnd, depth) => { for (const a of list) { const [x, z] = raPos(a, 0); go(a, tS + 0.4, x, z - 0.4); go(a, tEnd, x + R(-3, 3), Math.max(z, z0 + depth + R(-2, 3)), 1); } };

  // A score: the scorer dances in the end zone, his teammates run over and jump around him.
  // A score: the scorer dances, the whole offense runs into the end zone to mob him, and the
  // defense slows up and walks off to its sideline.
  const celebrate = (scorer, tE, mates, others) => {
    scorer.danceAt = tE + 0.2;
    sc.tdSide = scorer.side;
    const [sx, sz] = raPos(scorer, tE);
    const deep = sz > 50;
    const cz = deep ? Math.max(sz, 103) : Math.min(sz, -3);
    let last = tE;
    for (const m of mates) {
      chaseUntil(m, tE - 0.3);
      cut(m, Math.max(tE - 0.3, lastT(m)));
      const ang = R(0, Math.PI * 2), r = R(1.3, 4);
      const z = clamp(cz + Math.sin(ang) * r * 0.8, deep ? 100.8 : -9.2, deep ? 109.2 : -0.8);
      const t1 = run(m, lastT(m), sx + Math.cos(ang) * r, z, 8.5, 2);
      m.jumpAt = t1 + R(0, 0.4); m.cheer = true;
      last = Math.max(last, t1);
    }
    for (const o of others) {
      cut(o, Math.max(tE - 0.2, lastT(o)));
      const t0 = lastT(o), [ox, oz] = raPos(o, t0), [px, pz] = raPos(o, Math.max(0, t0 - 0.2));
      const x1 = ox + (ox - px) * 2, z1 = oz + (oz - pz) * 2;                // coast to a stop
      go(o, t0 + 0.7, x1, z1, 2);
      const theirs = scorer.side === 'o' ? defT.id : offT.id;                  // the team that gave up the score
      const side = (theirs === ev.home.id ? 1 : -1) * (offHome ? -1 : 1);       // its own sideline: home near, visitors far
      const tx = side * (RAX + 4), tz = z1 + R(-5, 5);
      const walk = Math.hypot(tx - x1, tz - z1) / R(2.4, 3);                  // a slow walk, heads down
      o.k.push([t0 + 1.2 + R(0, 0.8), x1, z1, 0], [t0 + 2 + walk, tx, tz, 0]); // allowed past the sideline
    }
    sc.tdAt = tE;
    sc.tdEnd = last + 3.5;
  };
  const finishCarry = (car, tE, tacklePool) => {
    if (I.td && zPlay >= 99) {
      banner(tE - 0.1, 'Touchdown', offT.name, 'o');
      celebrate(car, tE, allOff().filter((a) => a !== car), allDef());
      return;
    }
    if (I.oob) { converge(tacklePool, tE - 0.7, ...raPos(car, tE), tE + 0.2, 1, 5); return; }
    tackle(car, tE, tacklePool, I.tacklers);
    converge(tacklePool.filter((a) => !a.labelAt), tE - 0.5, ...raPos(car, tE), tE + 0.6, 1.8, 6);
  };
  const gainText = (y) => (y > 0 ? `+${y}` : y < 0 ? `−${-y}` : 'No gain');
  const gainSub = () => [I.firstDown || (p.endDown === 1 && !p.turnover) ? '1st down' : '', p.penYards ? `Flag: ${p.penYards > 0 ? '+' : '−'}${Math.abs(p.penYards)} penalty` : ''].filter(Boolean).join(' · ');
  const flag = (t, x, z) => sc.events.push({ t, kind: 'flag', from: [x > 0 ? RAX : -RAX, z - 2], to: [x, z] });
  const referee = (bx, zA, zB, t0) => {
    const side = bx >= 0 ? 1 : -1, sx = side * (RAX + 3), rx = bx + side * 0.6;
    const x0r = clamp(bx + side * 12, -RAX - 3, RAX + 3);                 // an official working the play, a few strides away
    const r = { side: 'r', role: 'REF', k: [[0, x0r, zA - 2, 0], [t0, x0r, zA - 2, 0]] };
    sc.actors.push(r);
    const tIn = t0 + Math.max(0.6, Math.hypot(x0r - rx, 2) / 7);
    const tPick = tIn + 0.35;
    const tSpot = tPick + Math.max(0.6, Math.abs(zB - zA) / 3.2);          // walks it off
    const tOff = tSpot + 0.45 + Math.abs(sx - rx) / 8.5;
    r.k.push([tIn, rx, zA, 2], [tPick, rx, zA, 0], [tSpot, rx, zB, 0], [tSpot + 0.45, rx, zB, 0], [tOff, sx, zB + R(-2, 2), 0]);
    sc.ball.push({ t0: tPick, t1: tSpot, a: r });
    sc.ball.push({ t0: tSpot, t1: 1e9, from: [bx, zB, 0.15], to: [bx, zB, 0.15], apex: 0 });
    return tOff;
  };
  const walkOff = (tFrom, zFrom = zPlay) => {
    if (zFum != null || zEnd == null || Math.abs(zEnd - zFrom) < 0.5) return tFrom;
    const last = sc.ball.at(-1);
    const px = last?.a ? raPos(last.a, tFrom)[0] : last?.to ? last.to[0] : x0;
    flag(tFrom - 1.2 > tS ? tFrom - 1.2 : tS + 0.4, raX(px + R(-3, 3)), (z0 + zFrom) / 2);
    const bp = raBall(sc, tFrom);
    return referee(bp.x, bp.z, zEnd, tFrom);
  };

  // Ball pops loose at the fumble spot, bounces to the recovery spot, and whoever falls on it may run.
  const fumble = (car, tF) => {
    const [fx, fz] = raPos(car, tF);
    cut(car, tF);
    tackle(car, tF, allDef(), I.tacklers.slice(0, 1));
    const zR = Z(I.recH) ?? fz + R(-3, 3), xR = raX(fx + R(-3, 3));
    ballFly(tF, tF + 0.7, [fx, fz, 1], [xR, zR, 0], 0.9);
    ballFly(tF + 0.7, tF + 1, [xR, zR, 0], [xR + 0.6, zR - 0.4, 0], 0.25);
    const pool = lostFum ? allDef() : allOff().filter((a) => a !== car);
    const r = nearest(pool.filter((a) => a.downAt == null), xR, zR, tF)[0];
    who(r, I.recoverer); r.labelAt = tF + 0.5;
    cut(r, tF); go(r, tF + 1, xR, zR, 0);
    sc.ball.push({ t0: tF + 1, t1: 99, a: r });
    banner(tF + 0.2, 'Fumble', lostFum ? `${defT.name} ball` : `${offT.abbr} recovers`, lostFum ? 'd' : 'o');
    converge(sc.actors.filter((a) => a !== r && a !== car && a.downAt == null), tF + 0.1, xR, zR, tF + 1.2, 1.5, 5);
    let tE = tF + 1.2;
    const scoop6 = lostFum && /TOUCHDOWN/.test(I.text);
    const zRet = scoop6 ? -1.5 : zEnd;
    if (lostFum && zRet != null && Math.abs(zRet - zR) > 2) {
      const xRet = raX(xR + R(-6, 6));
      tE = run(r, tF + 1.05, xRet, zRet, 8.8, 0);
      converge(allOff().filter((a) => a !== car && a.downAt == null), tF + 1.1, xRet, zRet, tE, 3, 14, 8.6);
      if (scoop6) { banner(tE, 'Touchdown', `${defT.name} return`, 'd'); celebrate(r, tE, allDef().filter((a) => a !== r), allOff()); }
      else tackle(r, tE, allOff().filter((a) => a !== car), []);
    }
    sc.tEnd = tE;
    return tE;
  };
  let T = 0;
  if (kind === 'set') {
    // Between plays: both teams lined up for the next snap, down in their stances.
    I.gun = true;
    scrimmage();
    ballHold(off.C, 0, 1e9);
    sc.tS = 1e9;
    T = 0.4;
  } else if (kind === 'run' || kind === 'kneel') {
    scrimmage();
    const qbCarry = kind === 'kneel' || /scramble/.test(I.text) || (I.rusher && qbs.has(`${p.offId}:${I.rusher.num || I.rusher.name}`));
    const car = qbCarry ? off.QB : off.RB;
    who(car, I.rusher);
    const tHand = snapTo(off.QB, tS, I.gun ? 0.3 : 0.08);
    if (kind === 'kneel') {
      go(off.QB, tS + 0.5, x0, z0 - 1.6, 1); off.QB.downAt = tS + 0.6; ballHold(off.QB, tHand, 99);
      banner(tS + 0.8, 'Kneel', 'Clock running', 'o');
      T = tS + 2.6; sc.tEnd = tS + 0.6;
    } else {
      const zStop = zFum ?? zPlay;
      const gain = zStop - z0;
      const side = dirSign || (rng() < 0.5 ? -1 : 1);
      const holeX = x0 + (dirSign ? dirSign * (I.gap === 'end' ? 7.5 : I.gap === 'guard' ? 2 : 3.6) : R(-1, 1));
      let t = tHand;
      if (!qbCarry) {
        const [qx, qz] = raPos(off.QB, 0);
        const mesh = [qx + side * 0.9, qz + (I.gun ? 0 : -3)];
        go(off.QB, tS + 0.45, qx + side * 0.4, qz + (I.gun ? 0 : -2.5));
        t = go(car, tS + 0.55, mesh[0], mesh[1], 1);
        ballHold(off.QB, tHand, t); go(off.QB, tS + 1.6, qx - side * 3, qz - 1.2, 1);
      }
      ballHold(car, t, 99);
      const tHole = go(car, t + 0.55, holeX, z0 - (gain < 0 ? 1 : 0.1), 0);
      let tE;
      if (gain <= 0.5) tE = go(car, tHole + 0.3 + Math.abs(gain) * 0.08, holeX + R(-1, 1), zStop, 2);
      else {
        const v = gain > 25 ? 9.3 : 8;
        const zF = I.td ? 101.5 : zStop;
        const xE = I.oob ? side * RAX : raX(holeX + (gain > 12 ? side * Math.min(14, gain * 0.3) : R(-2.5, 2.5)));
        const xM = holeX + (xE - holeX) * 0.35 + R(-1.5, 1.5), zM = z0 + (zF - z0) * 0.45;
        const tM = go(car, tHole + Math.hypot(xM - holeX, zM - z0) / v, xM, zM, 0);
        tE = go(car, tM + Math.hypot(xE - xM, zF - zM) / v, xE, zF, I.td ? 2 : 0);
      }
      linePlay(false, side, null, Math.min(tE, tS + 2.2));
      const [tx] = raPos(off.TE, 0); go(off.TE, tS + 0.5, tx, z0 - 0.2); go(off.TE, tS + 2, tx + side, z0 + 1.6);
      for (const [w, cb] of [[off.WL, def.CL], [off.WR, def.CR], [off.SL, def.NB]]) { const [wx] = raPos(w, 0); go(w, tS + 1.4, wx + R(-1, 1), z0 + R(4, 6)); const [cx] = raPos(cb, 0); go(cb, tS + 1.4, cx + R(-1, 1), z0 + R(5.5, 7.5)); }
      def.LB.forEach((a) => { const [x] = raPos(a, 0); go(a, tS + 0.8, x + (holeX - x) * 0.5, z0 + 3.2); });
      def.S.forEach((a) => { const [x, z] = raPos(a, 0); go(a, tS + 1.2, x + (holeX - x) * 0.3, z - 2); });
      if (zFum != null) { T = fumble(car, tE) + 2; } else {
      finishCarry(car, tE, allDef());
      if (!I.td) banner(tE + 0.1, I.safety ? 'Safety' : gainText(p.yards ?? Math.round(gain)), I.safety ? defT.name : gainSub(), I.safety ? 'd' : 'o');
      sc.tEnd = tE;
      T = walkOff(tE + 0.4) + 1.6;
      }
    }
  } else if (kind === 'pass' || kind === 'incomplete' || kind === 'int' || kind === 'sack') {
    scrimmage();
    who(off.QB, I.passer || I.sacked);
    const tHand = snapTo(off.QB, tS, I.gun ? 0.3 : 0.08);
    const [qx, qz] = raPos(off.QB, 0);
    go(off.QB, tS + (I.gun ? 0.7 : 1.1), qx, I.gun ? qz - 1.6 : z0 - 7, 2);
    ballHold(off.QB, tHand, 99);
    const deep = I.depth === 'deep';
    if (kind === 'sack') {
      const tSack = tS + R(2.2, 2.9);
      go(off.QB, tSack - 0.7, qx + R(-2.5, 2.5), raPos(off.QB, tS + 1)[1] - 0.6, 1);
      go(off.QB, tSack, raPos(off.QB, tSack - 0.7)[0] + R(-2, 2), Math.min(zFum ?? zPlay, z0 - 0.5), 2);
      linePlay(true, 0, off.QB, tSack - 0.4);
      decoys([], tSack + 0.5);
      cover([[def.CL, off.WL], [def.CR, off.WR], [def.NB, off.SL]], tSack + 0.5);
      drop([...def.LB, ...def.S], tSack, 9);
      sc.ball.at(-1).t1 = 99;
      if (zFum != null) { banner(tSack - 0.1, 'Sack', '', 'd'); T = fumble(off.QB, tSack) + 2; }
      else {
        tackle(off.QB, tSack, [...def.DL, ...def.LB], I.tacklers);
        banner(tSack + 0.1, 'Sack', gainText(/loss of (\d+)/.test(I.text) ? -+/loss of (\d+)/.exec(I.text)[1] : p.yards ?? Math.round(zPlay - z0)), 'd');
        T = tSack + 2.2; sc.tEnd = tSack;
      }
    } else {
      const tThrow = tS + (deep ? 2.35 : 1.55) + R(0, 0.35);
      const zT = Z(kind === 'int' ? I.intH : kind === 'incomplete' ? I.thrownH : I.catchH)
        ?? z0 + (kind === 'pass' ? clamp((p.yards || 5) * (deep ? 0.85 : 0.6), -3, 45) : deep ? R(22, 32) : R(6, 12));
      const lanes = { left: [-RAX + 4, x0 - 7], right: [x0 + 7, RAX - 4], middle: [x0 - 4, x0 + 4] };
      const lane = lanes[I.dir] || pick([lanes.left, lanes.right, lanes.middle]);
      const xT = raX(R(lane[0], lane[1]) * (zT - z0 < 2 && I.dir !== 'middle' ? 0.8 : 1));
      const cands = [off.WL, off.WR, off.SL, off.TE, ...(zT - z0 < 4 ? [off.RB] : [])];
      const rec = nearest(cands, xT, zT, 0).find((a) => kind !== 'incomplete' || true);
      who(rec, I.target);
      const [qtx, qtz] = raPos(off.QB, tThrow);
      const dist = Math.hypot(xT - qtx, zT - qtz);
      const tCatch = tThrow + 0.3 + dist * 0.03;
      const [rx, rz] = raPos(rec, 0);
      if (rec === off.RB) { go(rec, tS + 0.6, rx + Math.sign(xT - rx || 1) * 2, rz + 0.5); }
      else go(rec, tS + (tCatch - tS) * 0.6, rx + (xT - rx) * 0.15, rz + (zT - rz) * 0.78, 0);
      go(rec, tCatch, xT, zT, 0);
      rec.labelAt = tThrow - 0.3;
      sc.ball.at(-1).t1 = tThrow;
      const apex = clamp(0.8 + dist * 0.07, 1, 7);
      ballFly(tThrow, tCatch, [qtx, qtz, 2], [xT, zT, 1.2], apex);
      linePlay(true, 0, off.QB, tThrow + 0.3);
      if (rec !== off.RB) { const [bx, bz] = raPos(off.RB, 0); go(off.RB, tS + 0.6, bx + R(-1.5, 1.5), bz + 0.8); }
      decoys([rec], tCatch + 0.8);
      const cbFor = new Map([[off.WL, def.CL], [off.WR, def.CR], [off.SL, def.NB]]);
      cover([...cbFor].filter(([w]) => w !== rec).map(([w, cb]) => [cb, w]), tCatch + 0.5);
      const shadow = cbFor.get(rec) || def.LB[0];
      cover([[shadow, rec]], tCatch - 0.3);
      drop(def.LB.filter((a) => a !== shadow), tThrow + 0.3, 6);
      drop(def.S, tThrow, 14);
      if (kind === 'incomplete') {
        const pbu = nearest(allDef(), xT, zT, tCatch)[0];
        who(pbu, I.breakup);
        cut(pbu, tCatch - 0.6); go(pbu, tCatch - 0.02, xT + R(-0.8, 0.8), zT + 0.8, 0);
        if (I.breakup) pbu.labelAt = tCatch - 0.5;
        const fx = xT + (xT - qtx) / dist * 3, fz = zT + (zT - qtz) / dist * 3;
        ballFly(tCatch, tCatch + 0.4, [xT, zT, 1.2], [fx, fz, 0], 0.3);
        ballFly(tCatch + 0.4, tCatch + 0.8, [fx, fz, 0], [fx + (fx - xT) * 0.4, fz + (fz - zT) * 0.4, 0], 0.35);
        converge([rec, pbu], tCatch + 0.05, xT, zT + 1.5, tCatch + 0.8, 0.5, 2, 5);
        if (I.noPlay) { flag(tCatch - 0.4, raX(xT + R(-3, 3)), zT - 2); banner(tCatch + 0.3, 'Flag', `${I.penTeam ? I.penTeam.abbr + ' · ' : ''}${I.penName || 'Penalty'}`, I.penTeam?.id === p.offId ? 'd' : 'o'); }
        else banner(tCatch + 0.2, 'Incomplete', I.target ? `Intended for ${I.target.last}` : '', 'd');
        sc.tEnd = tCatch + 0.8;
        T = walkOff(tCatch + 0.6, z0) + 1.8;
      } else if (kind === 'int') {
        const pick6 = I.td || (zEnd != null && zEnd <= 0);
        const hawk = nearest([def.CL, def.CR, def.NB, ...def.S, ...def.LB], xT, zT, tCatch)[0];
        who(hawk, I.interceptor);
        cut(hawk, tCatch - 1.1); go(hawk, tCatch, xT + R(-0.5, 0.5), zT + 0.6, 0);
        hawk.labelAt = tCatch - 0.4;
        sc.ball.push({ t0: tCatch, t1: 99, a: hawk });
        const zR = pick6 ? -1.5 : zEnd ?? zT;
        const xR = raX(xT + R(-8, 8));
        const tE = run(hawk, tCatch, xR, zR, zT - zR > 25 ? 9.3 : 8, 0);
        converge([rec], tCatch, xR, zR, tE, 1, 3, 8.5);
        converge(allOff().filter((a) => a !== rec && a !== off.C), tCatch + 0.3, xR, zR, tE, 2, 12, 8.3);
        converge(allDef().filter((a) => a !== hawk), tCatch + 0.2, xR, zR + 6, tE, 3, 10, 8);
        banner(tCatch + 0.1, 'Intercepted', I.interceptor ? `${I.interceptor.last}${pick6 ? '' : ''}` : defT.name, 'd');
        if (pick6) { sc.events.push({ t: tE, kind: 'banner', title: 'Pick six', sub: defT.name, side: 'd' }); celebrate(hawk, tE, allDef().filter((a) => a !== hawk), allOff()); }
        else if (Math.abs(zR - zT) > 1) tackle(hawk, tE, allOff().filter((a) => a !== off.C), I.tacklers.filter((w) => w.name !== I.interceptor?.name));
        T = tE + 2; sc.tEnd = tE;
      } else {
        sc.ball.push({ t0: tCatch, t1: 99, a: rec });
        const zF = I.td ? 101.5 : zFum ?? zPlay;
        const yac = zF - zT;
        let tE = tCatch + 0.35;
        if (yac > 1) {
          const side = Math.sign(xT) || 1;
          const xE = I.oob ? side * RAX : raX(xT + (yac > 12 ? side * Math.min(10, yac * 0.3) : R(-3, 3)));
          tE = go(rec, tCatch + Math.hypot(xE - xT, yac) / (yac > 25 ? 9.2 : 8), xE, zF, I.td ? 2 : 0);
        } else go(rec, tE, xT + R(-0.5, 0.5), zT + Math.max(0, yac), 2);
        if (zFum != null) T = fumble(rec, tE) + 2; else {
        finishCarry(rec, tE, allDef());
        if (!I.td) banner(tE + 0.1, gainText(p.yards ?? Math.round(zPlay - z0)), gainSub(), 'o');
        sc.tEnd = tE;
        T = walkOff(tE + 0.4) + 1.6;
        }
      }
    }
  } else if (kind === 'punt' || kind === 'kickoff') {
    const punt = kind === 'punt';
    let zL = Z(I.landH);
    const yds = isFinite(I.kickYds) ? I.kickYds : punt ? 42 : 62;
    if (zL == null) zL = z0 + yds;
    const xL = R(-9, 9);
    let tK, kickFrom;
    const K = punt ? P('o', 'K', x0, z0 - 14) : P('o', 'K', 0, z0 - 6);
    who(K, I.kicker);
    K.labelAt = 0;
    const cov = [];
    if (punt) {
      const snapper = P('o', 'OL', x0, z0 - 0.8); off.C = snapper;
      for (const dx of [-5.7, -3.8, -1.9, 1.9, 3.8, 5.7]) cov.push(P('o', 'OL', x0 + dx, z0 - 1));
      const pp = P('o', 'RB', x0, z0 - 6);
      const gunners = [-21.5, 21.5].map((x) => P('o', 'WR', x, z0 - 1));
      cov.push(snapper, pp, ...gunners);
      const tCatchSnap = snapTo(K, tS, 0.75);
      go(K, tCatchSnap + 0.2, x0, z0 - 14);
      tK = go(K, tCatchSnap + 1.05, x0 + 0.3, z0 - 12.2, 1);
      ballHold(K, tCatchSnap, tK);
      kickFrom = [x0 + 0.3, z0 - 11.6, 1.2];
      for (const dx of [-8, -5.5, -3, -1, 1, 3, 5.5, 8]) { const a = P('d', 'DL', x0 + dx, z0 + 1); go(a, tS + 0.9, x0 + dx * 0.6, z0 - 2.5); }
      [-21, 21].forEach((x, i) => { const j = P('d', 'DB', x, z0 + 2); go(j, tS + 1.5, gunners[i].k[0][1] + R(-1, 1), z0 + 8); });
    } else {
      ballFly(0, 0.01, [0, z0, 0], [0, z0, 0], 0);
      tK = go(K, tS + 0.9, 0, z0 - 0.4, 0);
      kickFrom = [0, z0, 0.2];
      for (const x of [-23, -18, -13, -8.5, -4, 4, 8.5, 13, 18, 23]) { const a = P('o', 'WR', x, z0 - 1); go(a, tK, x, z0 - 0.2, 0); cov.push(a); }
      for (const x of [-18, -9, 0, 9, 18]) P('d', 'DL', x, z0 + R(11, 15));
      for (const x of [-15, -5, 5, 15]) P('d', 'LB', x, Math.min(z0 + 28, zL - 10));
      P('d', 'DB', raX(-xL * 0.4), Math.min(zL - 5, 104));
    }
    const ret = P('d', 'RB', xL + R(-3, 3), Math.min(zL + R(1, 4), 108));
    who(ret, I.returner);
    const hang = (punt ? 0.9 : 0.8) + Math.abs(zL - kickFrom[1]) * (punt ? 0.055 : 0.05);
    const apex = punt ? 12 + yds * 0.2 : 16 + yds * 0.12;
    const tL = tK + hang;
    const tb = I.touchback || zL >= 100;
    // Coverage team sprints down the field; gunners get there first.
    // Coverage sprints to where the return will end (or to the landing spot); gunners get there first.
    const meet = I.returner && zEnd != null && !I.fair && zEnd < zL ? zEnd : zL;
    cov.forEach((a) => { const fast = a.role === 'WR'; run(a, tK - (punt ? 0.4 : 0), raX(xL + R(-13, 13)), Math.min(meet - (fast ? R(1, 5) : R(4, 12)), 99), fast ? 9 : 8, 0); });
    sc.actors.filter((a) => a.side === 'd' && a !== ret).forEach((a) => { hold(a, tK + 0.2); const [x, z] = raPos(a, tK + 0.2); go(a, tL, x * 0.7 + xL * 0.3 + R(-3, 3), z + (zL - z) * 0.45, 1); });
    ballFly(tK, tL, kickFrom, tb && !I.returner ? [xL, Math.min(zL, 106), 0.4] : [xL, zL, 1.3], apex);
    const tSet = go(ret, Math.max(tS + 1, tL - 0.9), xL, zL + 0.4, 1);
    ret.labelAt = tK;
    let tE = tL + 0.5;
    const retZ = zEnd;
    if (tb && !(I.returner && retZ != null && retZ < 100)) {
      const bz = Math.min(zL + 4, 108);
      ballFly(tL, tL + 0.6, [xL, zL, 0.4], [xL + 1, bz, 0], 0.8);
      banner(tL - 0.2, 'Touchback', `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, 'o');
      tE = tL + 1;
    } else if (I.fair) {
      sc.ball.push({ t0: tL, t1: 99, a: ret });
      converge(cov, tL - 0.5, xL, zL, tL + 0.4, 2.5, 6);
      banner(tL + 0.1, 'Fair catch', `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, 'o');
    } else if (I.returner && retZ != null) {
      sc.ball.push({ t0: tL, t1: 99, a: ret });
      const retTD = I.td;
      const zR = retTD ? -1.5 : retZ;
      const xR = raX(xL + R(-10, 10));
      const xM = raX(xL + (xR - xL) * 0.4 + R(-4, 4)), zM = zL + (zR - zL) * 0.4;
      const tM = go(ret, tL + 0.2 + Math.hypot(xM - xL, zM - zL) / 8.3, xM, zM, 0);
      tE = go(ret, tM + Math.hypot(xR - xM, zR - zM) / 8.6, xR, zR, retTD ? 2 : 0);
      if (retTD) { banner(tE, 'Touchdown', `${defT.name} return`, 'd'); celebrate(ret, tE, sc.actors.filter((a) => a.side === 'd' && a !== ret), cov); }
      else {
        tackle(ret, tE, cov, I.tacklers);
        converge(cov.filter((a) => !a.labelAt), tE - 0.6, xR, zR, tE + 0.5, 2, 6);
        banner(tE + 0.1, `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, `${I.returner.last} returns ${Math.round(Math.abs(zL - zR))}`, 'd');
      }
    } else {
      const zD = retZ != null ? Math.min(retZ, 99) : zL;
      ballFly(tL, tL + 0.8, [xL, zL, 1.3], [xL + R(-2, 2), zD, 0], 0.9);
      converge(cov, tL - 0.4, xL, zD, tL + 0.9, 1, 4);
      banner(tL + 0.4, `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, /downed/i.test(I.text) ? 'Downed' : /out of bounds/i.test(I.text) ? 'Out of bounds' : '', 'o');
      tE = tL + 1;
    }
    hold(ret, tSet);
    K.labelTo = tK + 1.2;
    sc.kick = { tK, tL };
    T = tE + 2; sc.tEnd = tE;
  } else if (kind === 'fg') {
    const zHold = z0 - 7;
    off.C = P('o', 'OL', x0, z0 - 0.8);
    const line = [-7.4, -5.6, -3.8, -1.9, 1.9, 3.8, 5.6, 7.4].map((dx) => P('o', 'OL', x0 + dx, z0 - (Math.abs(dx) > 6 ? 1.6 : 1)));
    const holder = P('o', 'QB', x0, zHold);
    const K = P('o', 'K', x0 - 1.8, zHold - 2.6);
    who(K, I.kicker); K.labelAt = 0;
    const rush = [-7, -5, -3, -1, 1, 3, 5, 7, 0].map((dx, i) => P('d', 'DL', x0 + dx, z0 + (i === 8 ? 3 : 1)));
    [-4, 4].forEach((dx) => P('d', 'DB', x0 + dx, Math.min(z0 + 9, 106)));
    const tSnap = snapTo(holder, tS, 0.35);
    ballHold(holder, tSnap, tSnap + 0.45);
    ballFly(tSnap + 0.45, tSnap + 0.5, [x0, zHold + 0.3, 0.3], [x0, zHold + 0.3, 0.2], 0);
    const tK = go(K, tSnap + 0.5, x0 - 0.4, zHold - 0.3, 0);
    for (const a of line) { const [x, z] = raPos(a, 0); go(a, tS + 0.4, x, z - 0.5); go(a, tK + 1, x, z - 1); }
    rush.forEach((a) => { const [x] = raPos(a, 0); go(a, tK - 0.1, x * 0.8 + x0 * 0.2, z0 - 1, 1); });
    const dist = 110 - zHold;
    const flight = 0.9 + dist * 0.024;
    let xT = R(-1.4, 1.4), hT = 4.5 + R(0, 3);
    if (!I.good) { if (I.wide) xT = (I.wide === 'left' ? -1 : 1) * R(3.9, 5.5); else if (!I.blocked) hT = R(1.2, 2.6); }
    if (I.blocked) {
      const tB = tK + 0.25;
      ballFly(tK, tB, [x0, zHold + 0.3, 0.3], [x0 + R(-1, 1), z0 - 0.5, 2.6], 0.5);
      ballFly(tB, tB + 0.9, [x0, z0 - 0.5, 2.6], [x0 + R(-5, 5), z0 - R(2, 6), 0], 1.2);
      banner(tB + 0.1, 'Blocked', `${isPAT ? 'Extra point' : `${I.fgYds || Math.round(dist + 10)}-yd field goal`}`, 'd');
      T = tB + 2.6; sc.tEnd = tB + 0.9;
    } else {
      ballFly(tK, tK + flight, [x0, zHold + 0.3, 0.3], [xT, 110, hT], hT * 0.5 + dist * 0.12);
      ballFly(tK + flight, tK + flight + 0.5, [xT, 110, hT], [xT * 1.2, 115, Math.max(0, hT - 3)], 0.4);
      const yd = isFinite(I.fgYds) ? I.fgYds : Math.round(dist + 10);
      banner(tK + flight, I.good ? (isPAT ? 'Extra point good' : 'Field goal good') : (isPAT ? 'Extra point no good' : 'No good'), isPAT ? offT.name : `${yd} yards`, I.good ? 'o' : 'd');
      K.labelTo = tK + flight + 1.5;
      sc.kick = { tK, tL: tK + flight };
      T = tK + flight + 2.2; sc.tEnd = tK + flight;
    }
    sc.ltg = null;
  } else {
    // A flag before the snap: nobody moves, the flag comes in and the ball is walked off.
    scrimmage();
    ballHold(off.C, 0, tS + 1.8);
    if (/false start/i.test(I.penName)) { const [x, z] = raPos(off.RT, 0); go(off.RT, tS - 0.1, x, z + 0.6); go(off.RT, tS + 0.5, x, z); }
    flag(tS + 0.1, raX(x0 + R(-3, 3)), z0 + R(-1, 1));
    banner(tS + 0.8, 'Flag', `${I.penTeam ? I.penTeam.abbr + ' · ' : ''}${I.penName || 'Penalty'}${I.declined ? ' · declined' : ''}`, I.penTeam?.id === p.offId ? 'd' : 'o');
    T = tS + 4; sc.tEnd = tS;
    if (zEnd != null && Math.abs(zEnd - z0) > 0.4) T = Math.max(T, referee(x0, z0 - 0.5, zEnd - 0.5, tS + 1.2) + 0.8);
  }
  // Nobody stands around before the whistle: anyone whose scripted part ends early keeps working
  // toward the ball (linemen keep shoving, everyone else closes in), then coasts to a stop after it.
  const tEnd = sc.tEnd ?? T - 1.6;
  for (const a of sc.actors) {
    if (a.downAt != null || a.side === 'r') continue;
    hold(a, tS);                                                    // nobody moves before the snap
    const t0 = lastT(a);
    if (t0 >= tEnd - 0.1) continue;
    const line = ['OL', 'DL', 'TE'].includes(a.role) && !sc.kick;
    const v = line ? 2.2 : a.side === 'd' ? 7 : 5.5;
    let [x, z] = raPos(a, t0);
    const b0 = raBall(sc, t0);
    let ox = x - b0.x, oz = z - b0.z;
    let px = x, pz = z;
    for (let t = t0 + 0.45; t < tEnd + 0.44; t += 0.45) {
      const tt = Math.min(t, tEnd);
      const bb = raBall(sc, tt);
      const shrink = line ? 0.96 : 0.82;
      ox *= shrink; oz *= shrink;
      const r = Math.hypot(ox, oz);
      if (r < 1.6) { const k = 1.6 / (r || 1); ox = (ox || R(-1, 1)) * k; oz = (oz || 1) * k; }
      const gx = bb.x + ox, gz = bb.z + oz;
      const d = Math.hypot(gx - x, gz - z), step = v * 0.45;
      const f = d > step ? step / d : 1;
      px = x; pz = z;
      x += (gx - x) * f; z += (gz - z) * f;
      go(a, tt, x, z, 0);
      if (tt >= tEnd) break;
    }
    go(a, tEnd + 0.6, x + (x - px) * 0.8, z + (z - pz) * 0.8, 2);
  }
  // Anyone still waiting mid-play (a returner under a punt, a rusher after a kick) shuffles on his feet.
  for (const a of sc.actors) {
    if (a.side === 'r') continue;
    const out = [a.k[0]];
    for (let i = 1; i < a.k.length; i++) {
      const [t0, x0, z0] = a.k[i - 1], k1 = a.k[i], [t1, x1, z1] = k1;
      const lo = Math.max(t0, tS + 0.2), hi = Math.min(t1 - 0.05, tEnd, a.downAt ?? Infinity);
      if (Math.hypot(x1 - x0, z1 - z0) / (t1 - t0 || 1) < 0.9 && hi - lo > 0.4) {
        const n = Math.floor((hi - lo) / 0.3);
        for (let j = 1; j <= n; j++) {
          const t = lo + j * 0.3, u = (t - t0) / (t1 - t0), w = j % 2 ? 1 : -1;
          out.push([t, x0 + (x1 - x0) * u + w * 0.45, z0 + (z1 - z0) * u + w * 0.2, 0]);
        }
      }
      out.push(k1);
    }
    a.k = out;
  }
  if (sc.tdAt != null) T = Math.max(T, sc.tdAt + 8, sc.tdEnd || 0);
  if (I.twoPt) {
    sc.events = sc.events.filter((e) => e.kind !== 'banner');
    banner(sc.tEnd ?? T - 1.5, I.good ? 'Two-point good' : 'Two-point no good', offT.name, I.good ? 'o' : 'd');
    sc.tdAt = undefined;
  }
  // Out of the huddle: every player starts in his huddle spot, jogs to his place in the formation,
  // and the line gets set before the snap.
  if (opts.from && sc.tS >= 4) {
    const prev = opts.from, tp = opts.fromT ?? prev.T;
    const flip = prev.offHome === offHome ? 1 : -1;
    const toHere = (a) => { const [px, pz] = raPos(a, tp); const H = prev.offHome ? pz : 100 - pz; return [px * flip, offHome ? H : 100 - H]; };
    const teamOf = (a, sce) => (a.side === 'o' ? sce.offT.id : a.side === 'd' ? sce.defT.id : null);
    const pools = new Map();
    for (const a of prev.actors) { const tm = teamOf(a, prev); if (tm == null || a.side === 'r') continue; if (!pools.has(tm)) pools.set(tm, []); pools.get(tm).push(a); }
    const near = offHome ? -1 : 1;                                     // toward the near (home) sideline
    const tSet = sc.tS - 0.9;
    for (const a of sc.actors) {
      if (a.side !== 'o' && a.side !== 'd') continue;
      const tm = teamOf(a, sc), f = a.k[0];
      const src = pools.get(tm)?.shift();
      // No one to take the spot (after halftime, say): he runs on from his team's sideline.
      const [hx, hz] = src ? toHere(src) : [(tm === ev.home.id ? near : -near) * (RAX + 3), clamp(f[2] + R(-8, 8), 5, 95)];
      a.k = [[0, hx, hz, 0], [0.5, hx, hz, 0], [tSet, f[1], f[2], 1], ...a.k.filter((k) => k[0] > tSet)];
    }
    // Cheerleaders from a timeout run back to the home sideline as the teams come out.
    for (const c of prev.actors.filter((a) => a.side === 'c')) {
      const [cx, cz] = toHere(c);
      sc.actors.push({ side: 'c', role: 'CH', k: [[0, cx, cz, 0], [0.3, cx, cz, 0], [0.3 + Math.abs(near * (RAX + 5) - cx) / 6, near * (RAX + 5), cz, 0]] });
    }
  }
  // Last pass: nobody runs faster than a sprinter, so a scripted lunge or cut can't pop a player across the field.
  const PEAK = [1, 1.5, 2, 2];                                       // top speed vs average, by easing
  for (const a of sc.actors) {
    if (a.side !== 'o' && a.side !== 'd') continue;
    for (let i = 1; i < a.k.length; i++) {
      const [t0, x0, z0] = a.k[i - 1], k = a.k[i];
      const d = Math.hypot(k[1] - x0, k[2] - z0), max = 11 * Math.max(k[0] - t0, 0.001) / PEAK[k[3] ?? 0];
      if (d > max) { const f = max / d; k[1] = x0 + (k[1] - x0) * f; k[2] = z0 + (k[2] - z0) * f; }
    }
  }
  sc.T = T;
  sc.I = I;
  return sc;
}

// Two huddles, one on each side of the ball: the offense seven yards behind it, the defense in front.
function raHuddleSpot(side, i, x0, z0) {
  const ang = (i / 11) * Math.PI * 2 + (side === 'o' ? 0 : 0.3);
  return { x: raX(x0 + Math.cos(ang) * 2.1), z: (side === 'o' ? z0 - 7.5 : z0 + 7) + Math.sin(ang) * 1.5 };
}
// After a play: everyone runs from where the play ended into the huddles for the next snap.
function raHuddle(prev, ev, s) {
  const offHome = s.possession === ev.home.id;
  const Z = (H) => (offHome ? H : 100 - H);
  const z0 = Z(s.yardLine);
  const flipX = prev.offHome === offHome ? 1 : -1;
  const pb = raBall(prev, prev.T);
  const x0 = clamp(Math.round(pb.x * flipX / 3.08) * 3.08, -3.08, 3.08);
  const pc = pair(ev.away, ev.home);
  const offT = offHome ? ev.home : ev.away, defT = offHome ? ev.away : ev.home;
  const sc = { actors: [], ball: [], events: [], z0, x0, offHome, ltg: s.distance && z0 + s.distance < 100 ? z0 + s.distance : null,
    col: { o: offHome ? pc.hRaw : pc.aRaw, d: offHome ? pc.aRaw : pc.hRaw }, offT, defT, tS: 0, huddle: true };
  const idx = { o: 0, d: 0 };
  let T = 1;
  for (const a of prev.actors) {
    if (a.side !== 'o' && a.side !== 'd') continue;
    const team = a.side === 'o' ? prev.offT.id : prev.defT.id;
    const side = team === s.possession ? 'o' : 'd';
    const [px, pz] = raPos(a, prev.T);
    const H = prev.offHome ? pz : 100 - pz;
    const x = px * flipX, z = Z(H);
    const h = raHuddleSpot(side, idx[side]++, x0, z0);
    const t1 = 0.5 + Math.hypot(h.x - x, h.z - z) / 5.5;       // a jog, not a sprint
    sc.actors.push({ side, role: a.role, k: [[0, x, z, 0], [0.5, x, z, 0], [t1, h.x, h.z, 2]] });
    T = Math.max(T, t1 + 0.3);
  }
  sc.ball.push({ t0: 0, t1: 1e9, from: [x0, z0 - 0.4, 0.15], to: [x0, z0 - 0.4, 0.15], apex: 0 });
  sc.arrived = T;
  sc.T = 1e6;                                     // they stay in the huddle, on their toes, until the snap
  return sc;
}

// A timeout: the players jog to their own sidelines (home on the near side), and the home team's
// cheerleaders run out, form a line and dance until play resumes.
function raTimeout(prev, tPrev, ev, possId, z0H, caller, title = 'Timeout', clearOnly = false) {
  const offHome = possId === ev.home.id;
  const Z = (H) => (offHome ? H : 100 - H);
  const flip = prev.offHome === offHome ? 1 : -1;
  const tp = Math.min(tPrev, prev.T);
  const pb = raBall(prev, tp);
  const x0 = clamp(Math.round(pb.x * flip / 3.08) * 3.08, -3.08, 3.08);
  const z0 = z0H != null ? Z(z0H) : Z(prev.offHome ? pb.z : 100 - pb.z);
  const pc = pair(ev.away, ev.home);
  const col = { o: offHome ? pc.hRaw : pc.aRaw, d: offHome ? pc.aRaw : pc.hRaw };
  const offT = offHome ? ev.home : ev.away, defT = offHome ? ev.away : ev.home;
  const near = offHome ? -1 : 1;                  // lateral sign toward the near (home) sideline
  const rng = raRng('to' + tPrev + possId), R = (a, b) => a + (b - a) * rng();
  const sc = { actors: [], ball: [], events: [], z0, x0, offHome, ltg: null, col, offT, defT, tS: 0, timeout: true, homeCol: offHome ? col.o : col.d };
  for (const a of prev.actors) {
    if (a.side !== 'o' && a.side !== 'd') continue;
    const team = a.side === 'o' ? prev.offT.id : prev.defT.id;
    const [px, pz] = raPos(a, tp);
    const H = prev.offHome ? pz : 100 - pz;
    const x = px * flip, z = Z(H);
    const home = team === ev.home.id;
    const lx = (home ? near : -near) * (RAX + 2 + R(0, 2.5)), lz = clamp(z + R(-6, 6), 5, 95);
    const t1 = 0.4 + Math.hypot(lx - x, lz - z) / 6.5;
    sc.actors.push({ side: team === possId ? 'o' : 'd', role: a.role, k: [[0, x, z, 0], [0.3, x, z, 0], [t1, lx, lz, 2]] });
  }
  if (clearOnly) {
    sc.clear = true;
    sc.ball.push({ t0: 0, t1: 1e9, from: [x0, z0 - 0.4, 0.15], to: [x0, z0 - 0.4, 0.15], apex: 0 });
    sc.T = Math.max(...sc.actors.map((a) => a.k[a.k.length - 1][0])) + 0.4;
    return sc;
  }
  const lineX = near * (RAX - 7), cz = clamp(z0, 14, 86);
  const arrive = [];
  for (let i = 0; i < 8; i++) {
    const z = cz + (i - 3.5) * 2.5, sx = near * (RAX + 5), tIn = 1.4 + i * 0.12;
    const t2 = tIn + Math.abs(sx - lineX) / 6;
    arrive.push(t2);
    sc.actors.push({ side: 'c', role: 'CH', k: [[0, sx, z, 0], [tIn, sx, z, 0], [t2, lineX, z, 2]] });
  }
  const go = Math.max(...arrive) + 0.3;
  sc.actors.filter((a) => a.side === 'c').forEach((a) => { a.danceFrom = go; });
  sc.focus = { x: lineX - near * 4, z: cz, from: 1.2 };
  sc.ball.push({ t0: 0, t1: 1e9, from: [x0, z0 - 0.4, 0.15], to: [x0, z0 - 0.4, 0.15], apex: 0 });
  if (title) sc.events.push({ t: 0.3, kind: 'banner', title, sub: caller || '', side: caller && caller === defT.name ? 'd' : 'o' });
  sc.T = 1e6;                                     // dances until the next snap
  return sc;
}

function raHalftime(ev) {
  const pc = pair(ev.away, ev.home);
  const sc = { actors: [], ball: [], events: [], z0: 50, x0: 0, offHome: true, ltg: null, col: { o: pc.hRaw, d: pc.aRaw }, offT: ev.home, defT: ev.away,
    tS: 0, timeout: true, halftime: true, noBall: true, homeCol: pc.hRaw };
  // A stadium-shaped route: two 40-yard straights joined by half circles, four files abreast.
  const L = 40, r = 9, P = 2 * L + 2 * Math.PI * r, v = 2.2;
  const fix = (d) => {
    d = ((d % P) + P) % P;
    if (d < L) return { x: -r, z: 30 + d, dx: 0, dz: 1 };                      // up the near straight
    d -= L;
    if (d < Math.PI * r) { const a = Math.PI - d / r; return { x: r * Math.cos(a), z: 70 + r * Math.sin(a), dx: Math.sin(a), dz: -Math.cos(a) }; }
    d -= Math.PI * r;
    if (d < L) return { x: r, z: 70 - d, dx: 0, dz: -1 };                      // back down the far straight
    d -= L;
    const a = -d / r;
    return { x: r * Math.cos(a), z: 30 + r * Math.sin(a), dx: Math.sin(a), dz: -Math.cos(a) };
  };
  const rows = 5, files = 4;
  const lead = 6;                                                     // the drum major walks ahead of the block
  const member = (row, file) => (t) => {
    const d = t * v - row * 2.2;
    const q = fix(d);
    const nx = q.dz, nz = -q.dx;                                        // across the direction of travel
    const off = (file - (files - 1) / 2) * 2.1;
    return [q.x + nx * off, q.z + nz * off];
  };
  for (let row = 0; row < rows; row++) for (let file = 0; file < files; file++) sc.actors.push({ side: 'b', role: 'BAND', posFn: member(row, file), k: [[0, 0, 0, 0]] });
  sc.actors.push({ side: 'b', role: 'DM', posFn: (t) => { const q = fix(t * v + lead); return [q.x, q.z]; }, k: [[0, 0, 0, 0]] });
  sc.focusFn = (t) => { const q = fix(t * v - 3); return { x: q.x, z: q.z }; };
  sc.events.push({ t: 0.3, kind: 'banner', title: 'Halftime', sub: `${ev.away.abbr} ${ev.away.score ?? 0} – ${ev.home.score ?? 0} ${ev.home.abbr}`, side: 'o' });
  sc.T = 1e6;
  return sc;
}

/* ═════════════ Drawing ═════════════ */
const RA = { open: false, sc: null, t: 0, speed: 1, raf: 0, last: 0, list: [], idx: -1, follow: true, cam: null, shown: new Set() };

function raBall(sc, t) {
  let seg = sc.ball[0];
  for (const b of sc.ball) if (t >= b.t0) seg = b;
  if (!seg) return { x: sc.x0, z: sc.z0 - 0.5, h: 0.3 };
  if (seg.a) {
    const [x, z] = raPos(seg.a, t);
    const down = seg.a.downAt != null && t > seg.a.downAt;
    return { x: x + 0.35, z: z + 0.25, h: down ? 0.3 : 1.05, held: seg.a };
  }
  const u = clamp((t - seg.t0) / (seg.t1 - seg.t0 || 1), 0, 1);
  const [x0, z0, h0] = seg.from, [x1, z1, h1] = seg.to;
  return { x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, h: h0 + (h1 - h0) * u + 4 * seg.apex * u * (1 - u), flying: u > 0 && u < 1 && seg.apex > 0.5, spin: u };
}

/* Pixel renderer, in the spirit of 16-bit football games: a close, sideways camera that scrolls
   both ways, shaded side-on sprites, linemen down in their stances, flat green turf and big
   shadowed yard numbers. Drawn at console resolution (168px tall) and scaled up with hard edges.
   The home end zone is on the right, as on the game page's field. All art is drawn here. */
const PX = 9;                                    // pixels per yard along the field
const PY = 7;                                    // pixels per yard across it
const HK = 5;                                    // pixels per yard of height (the ball in the air)
const RA_H = 168;                                // screen height
const RA_STANDS = 60;                            // the stands
const RA_TOP = RA_STANDS + 36;                   // + the far (visitors') sideline, down to the field
const RA_FIELD_H = Math.round(53.33 * PY);       // 373
const RA_WORLD_H = RA_TOP + RA_FIELD_H + 44;       // + the near sideline and benches
const RA_WORLD_W = 130 * PX;                     // H from -15 to 115
const raSX = (H) => Math.round((115 - H) * PX);

// 3×5 font for name tags; 5×7 font for yard numbers and end zones.
const RA_GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001011001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '#': '101111101111101', '-': '000000111000000', '+': '000010111010000', '.': '000000000000010',
  "'": '010010000000000', '&': '010101010101011', '/': '001001010100100', '!': '010010010000010', ':': '000010000010000',
};
const RA_BIG = {
  0: '.###.#...##..###.#.###..##...#.###.', 1: '..#...##....#....#....#....#...###.', 2: '.###.#...#....#...#...#...#...#####',
  3: '####.....#....#.###.....#....#####.', 4: '...#...##..#.#.#..#.#####...#....#.', 5: '######....####.....#....##...#.###.',
  6: '..##..#...#....####.#...##...#.###.', 7: '#####....#...#...#...#....#....#...', 8: '.###.#...##...#.###.#...##...#.###.',
  9: '.###.#...##...#.####....#...#..##..',
  A: '.###.#...##...#######...##...##...#', B: '####.#...##...#####.#...##...#####.', C: '.###.#...##....#....#....#...#.###.',
  D: '####.#...##...##...##...##...#####.', E: '######....#....####.#....#....#####', F: '######....#....####.#....#....#....',
  G: '.###.#...##....#.####...##...#.####', H: '#...##...##...#######...##...##...#', I: '.###...#....#....#....#....#...###.',
  J: '..###...#....#....#....##..#..##...', K: '#...##..#.#.#..##...#.#..#..#.#...#', L: '#....#....#....#....#....#....#####',
  M: '#...###.###.#.##.#.##...##...##...#', N: '#...##...###..##.#.##..###...##...#', O: '.###.#...##...##...##...##...#.###.',
  P: '####.#...##...#####.#....#....#....', Q: '.###.#...##...##...##.#.##..#..##.#', R: '####.#...##...#####.#.#..#..#.#...#',
  S: '.#####....#.....###.....#....#####.', T: '#####..#....#....#....#....#....#..', U: '#...##...##...##...##...##...#.###.',
  V: '#...##...##...##...##...#.#.#...#..', W: '#...##...##...##.#.##.#.##.#.#.#.#.', X: '#...##...#.#.#...#...#.#.#...##...#',
  Y: '#...##...#.#.#...#....#....#....#..', Z: '#####....#...#...#...#...#....#####', '&': '.##..#..#..##...#...#.#.##..#..##.#',
};
function pixText(g, s, x, y, col, k = 1) {
  g.fillStyle = col;
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const gl = RA_GLYPHS[ch];
    if (gl) for (let i = 0; i < 15; i++) if (gl[i] === '1') g.fillRect(cx + (i % 3) * k, y + Math.floor(i / 3) * k, k, k);
    cx += 4 * k;
  }
}
const pixW = (s, k = 1) => String(s).length * 4 * k - k;
function bigText(g, s, x, y, col, k = 1) {
  g.fillStyle = col;
  let cx = x;
  for (const ch of String(s).toUpperCase()) {
    const gl = RA_BIG[ch];
    if (gl) for (let i = 0; i < 35; i++) if (gl[i] === '#') g.fillRect(cx + (i % 5) * k, y + Math.floor(i / 5) * k, k, k);
    cx += 6 * k;
  }
}
const bigW = (s, k = 1) => String(s).length * 6 * k - k;
// Text with a hard drop shadow, drawn on its own canvas so it can be turned 90° or 180°.
function bigLabel(s, k, col, shadow) {
  const c = document.createElement('canvas');
  c.width = bigW(s, k) + k; c.height = 7 * k + k;
  const g = c.getContext('2d');
  bigText(g, s, k, k, shadow, k);
  bigText(g, s, 0, 0, col, k);
  return c;
}

// Sprites, facing right. H helmet, h its shadow, w helmet stripe, m face mask, F skin, J jersey,
// j its shadow, n number, P pants, p their shadow, S socks, B shoes.
const RA_POSES = {
  stand: ['...HHHH.....', '..HHHwwH....', '..HHHHHHm...', '..hHHHHFm...', '...hhhFF....', '..jJJJJJJ...', '.jJJJnJJJJ..', '.jJJJnJJJF..', '.FjJJJJJjF..', '.F.jJJJJj...',
    '...pPPPPP...', '...pPPPPP...', '...pPP.pPP..', '...pP...pP..', '...SS...SS..', '...SS...SS..', '..BBB..BBB..'],
  run1: ['....HHHH....', '...HHHwwH...', '...HHHHHHm..', '...hHHHHFm..', '....hhhFF...', '..jJJJJJJ...', '.jJJJnJJJF..', 'FjJJJnJJJF..', 'F.jJJJJJj...', '...jJJJJj...',
    '...pPPPPPP..', '..pPPP.pPPP.', '.pPP....pPP.', '.SS......SS.', 'SS.......SS.', 'BB.......BBB', '............'],
  stance: ['.........HHHH...', '..jjJJJJHHHwwH..', '.jJJJJJJJHHHHm..', '.jJJnnJJJhHHFm..', '.pjJJJJJJJhFF...', 'pPPjJJJJJJJ.F...', 'pPPP.jJJJ...F...', 'pPP...pP....F...',
    '.SS...SS........', '.SS...SS........', 'BBB...BBB.......'],
  down: ['...........HHHH...', '.pPPPjJJJJJHHwwH..', 'SpPPPjJJnJJHHHHm..', 'SpPPPjJJJJJhHHFm..', 'B.pp..jjjjj.hFF...', 'B.................'],
  cheer: ['.F.......F..', '.F.HHHH..F..', '.FHHHwwH.F..', '.FHHHHHHmF..', '.FhHHHHFmF..', '.jjhhhFFjj..', '..jJJJJJJ...', '.jJJJnJJJJ..', '..jJJnJJJ...', '..jJJJJJj...', '...jJJJJj...',
    '...pPPPPP...', '...pPPPPP...', '...pPP.pPP..', '...pP...pP..', '...SS...SS..', '...SS...SS..', '..BBB..BBB..'],
  dance: ['.........F..', '...HHHH..F..', '..HHHwwH.F..', '..HHHHHHmF..', '..hHHHHFmF..', 'FFjhhhFFjj..', '..jJJJJJJ...', '.jJJJnJJJJ..', '..jJJnJJJ...', '..jJJJJJj...', '...jJJJJj...',
    '...pPPPPP...', '..pPPPPPPP..', '.pPP...pPP..', '.pP.....pP..', '.SS.....SS..', '.SS.....SS..', 'BBB.....BBB.'],
  ch1: ['...RRRR.....', '..RRRRRR....', '..RFFFFR....', '..RFFFFR....', '...FFFF.....', '..JJJJJJ....', '.YJJJJJJY...', 'YYJJJJJJYY..', '.Y.JJJJ..Y..', '..KKKKKK....', '.KKKKKKKK...',
    '...FF.FF....', '...FF.FF....', '...FF.FF....', '...FF.FF....', '...WW.WW....'],
  ch2: ['YY.......YY.', 'YY.RRRR..YY.', '.FRRRRRR.F..', '.FRFFFFR.F..', '.FRFFFFRF...', '...FFFF.....', '..JJJJJJ....', '..JJJJJJ....', '...JJJJ.....', '..KKKKKK....', '.KKKKKKKK...',
    '...FF.FF....', '...FF.FF....', '...FF.FF....', '...FF.FF....', '...WW.WW....'],
  ch3: ['YY.......YY.', 'YY.RRRR..YY.', '.FRRRRRR.F..', '.FRFFFFR.F..', '..RFFFFRF...', '...FFFF.....', '..JJJJJJ....', '..JJJJJJ....', '...JJJJ.....', '..KKKKKKFFFW', '.KKKKKKKK...',
    '...FF.......', '...FF.......', '...FF.......', '...FF.......', '...WW.......'],
  ref: ['...CCCC.....', '..CCCCCC....', '...FFFF.....', '...FFFF.....', '....FF......', '..QXQXQXQ...', '.FQXQXQXQF..', '.FQXQXQXQF..', '.F.QXQXQ.F..', '...QXQXQ....',
    '...XXXXX....', '...XXXXX....', '...XX.XX....', '...XX.XX....', '...XX.XX....', '...XX.XX....', '..BBB.BBB...'],
  ref2: ['...CCCC.....', '..CCCCCC....', '...FFFF.....', '...FFFF.....', '....FF......', '..QXQXQXQ...', '.FQXQXQXQF..', '.FQXQXQXQF..', '.F.QXQXQ.F..', '...QXQXQ....',
    '...XXXXX....', '..XXX.XXX...', '.XX.....XX..', '.XX.....XX..', 'XX.......XX.', 'BB.......BBB', '............'],
  band1: ['....PP......', '...HHHH.....', '...HHHH.....', '...HHHH.....', '...FFFF.....', '...FFFF.GG..', '..JJJJJJGGG.', '.JJWJJWJJG..', '.JJJWWJJJ...', '.FJJJJJJ....', '..JJJJJJ....',
    '..KKKKKK....', '..KK..KK....', '..KK..KK....', '..KK..KK....', '..BB..BB....'],
  band2: ['....PP......', '...HHHH.....', '...HHHH.....', '...HHHH.....', '...FFFF.....', '...FFFF.GG..', '..JJJJJJGGG.', '.JJWJJWJJG..', '.JJJWWJJJ...', '.FJJJJJJ....', '..JJJJJJ....',
    '..KKKKKK....', '.KKK..KKK...', '.KK....KK...', 'KK......KK..', 'BB......BB..'],
  ball: ['.BBB.', 'BbWbB', '.BBB.'],
  ball2: ['.BB.', 'BWWB', '.BB.'],
};
// Second stride: the same runner with the legs swapped.
RA_POSES.run2 = RA_POSES.run1.map((r, i) => (i >= 10 ? [...r].reverse().join('') : r));
const RA_SPR = new Map();
const RA_RULER = new Map();
function raSprite(pose, pal, flip) {
  const key = pose + '|' + Object.values(pal).join() + '|' + flip;
  let c = RA_SPR.get(key);
  if (c) return c;
  const rows = RA_POSES[pose], w = rows[0].length, h = rows.length;
  c = document.createElement('canvas');
  c.width = w + 2; c.height = h + 2;
  const g = c.getContext('2d');
  const at = (x, y) => rows[y]?.[flip ? w - 1 - x : x];
  const on = (x, y) => { const v = at(x, y); return v && v !== '.'; };
  g.fillStyle = '#0c0c0c';
  for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) g.fillRect(x + 1, y + 1, 1, 1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = at(x, y); if (v && v !== '.') { g.fillStyle = pal[v] || '#f0f'; g.fillRect(x + 1, y + 1, 1, 1); } }
  RA_SPR.set(key, c);
  return c;
}

// Team logos for midfield, drawn small and scaled up so they come out pixelated like everything else.
// NFL logos are keyed by abbreviation, not id (see logoURL in sd-app.js).
const RA_LOGOS = new Map();
function raLogo(t) {
  const abbr = (t?.abbr || '').toLowerCase();
  let e = RA_LOGOS.get(abbr);
  if (!e) {
    e = { img: new Image(), ok: false };
    e.img.crossOrigin = 'anonymous';
    e.img.onload = () => { e.ok = true; for (const st of [RA, typeof SIDE !== 'undefined' ? SIDE : null]) if (st?.sc && [st.sc.offT.abbr, st.sc.defT.abbr].includes(t.abbr)) st.sc.art = null; };
    e.img.src = `${CDN}/combiner/i?img=/i/teamlogos/nfl/500/${abbr}.png&w=96&h=96`;
    RA_LOGOS.set(abbr, e);
  }
  return e.ok ? e.img : null;
}
function raFieldArt(sc) {
  const c = document.createElement('canvas');
  c.width = RA_WORLD_W; c.height = RA_WORLD_H;
  const g = c.getContext('2d');
  const homeCol = sc.offHome ? sc.col.o : sc.col.d, awayCol = sc.offHome ? sc.col.d : sc.col.o;
  const homeT = sc.offHome ? sc.offT : sc.defT, awayT = sc.offHome ? sc.defT : sc.offT;
  const rng = raRng('field' + homeT.id + awayT.id);
  const f0 = RA_TOP, f1 = RA_TOP + RA_FIELD_H;
  // Stands: rows of fans behind a padded wall in both teams' colours.
  g.fillStyle = '#262a33'; g.fillRect(0, 0, RA_WORLD_W, RA_TOP);
  const shirts = [homeCol, homeCol, awayCol, '#e9e4d4', '#9aa0a8', mixHex(homeCol, '#ffffff', 0.35), mixHex(awayCol, '#ffffff', 0.35)];
  const skin = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'];
  const wall = RA_STANDS - 9;
  for (let y = 1; y < wall - 5; y += 5) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + 4, RA_WORLD_W, 1);             // the step of each row
    for (let x = (y % 2) * 2; x < RA_WORLD_W; x += 3) {
      if (rng() < 0.1) continue;
      g.fillStyle = skin[Math.floor(rng() * skin.length)]; g.fillRect(x, y, 2, 2);
      g.fillStyle = shirts[Math.floor(rng() * shirts.length)]; g.fillRect(x, y + 2, 2, 3);
    }
  }
  for (let x = 0; x < RA_WORLD_W; x += 24) { g.fillStyle = (x / 24) % 2 ? homeCol : awayCol; g.fillRect(x, wall, 24, 6); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, wall + 5, 24, 1); }
  g.fillStyle = '#0c0c0c'; g.fillRect(0, wall + 6, RA_WORLD_W, 1);
  // Turf: flat green with a little grain; darker apron and bench area outside the lines.
  g.fillStyle = '#1d7a2a'; g.fillRect(0, wall + 7, RA_WORLD_W, RA_WORLD_H - wall - 7);
  g.fillStyle = '#228b2e'; g.fillRect(raSX(110), f0, raSX(-10) - raSX(110), RA_FIELD_H);
  for (let i = 0; i < RA_WORLD_W * RA_FIELD_H * 0.035; i++) {
    g.fillStyle = rng() < 0.55 ? '#1f8229' : '#279733';
    g.fillRect(raSX(110) + Math.floor(rng() * (raSX(-10) - raSX(110))), f0 + Math.floor(rng() * RA_FIELD_H), 1, 1);
  }
  // Team benches between the 25s: home on the near sideline, visitors across the field below the stands.
  const bx0 = raSX(75), bx1 = raSX(25);
  for (const y of [f1 + 30, RA_STANDS + 4]) { g.fillStyle = '#16602a'; g.fillRect(bx0, y, bx1 - bx0, 6); g.fillStyle = '#0c0c0c'; g.fillRect(bx0, y + 6, bx1 - bx0, 1); }
  g.fillStyle = 'rgba(255,255,255,0.55)';                                                  // the coaching-box lines
  for (let x = raSX(110); x < raSX(-10); x += 6) { g.fillRect(x, f1 + 6, 3, 1); g.fillRect(x, f0 - 7, 3, 1); }
  // End zones: team colour, a stripe texture and the school's name running along them.
  const zone = (Ha, Hb, col, t, rot) => {
    const x0 = raSX(Hb), w = raSX(Ha) - x0;
    g.fillStyle = col; g.fillRect(x0, f0, w, RA_FIELD_H);
    g.fillStyle = mixHex(col, '#000000', 0.16);
    for (let y = f0; y < f1; y += 6) g.fillRect(x0, y, w, 2);
    let word = (t.name || t.abbr || '').toUpperCase().replace(/[^A-Z& ]/g, '');
    if (word.length > 11) word = (t.abbr || '').toUpperCase();
    const ink = onColor(col) === '#ffffff' ? '#ffffff' : '#141414';
    const lab = bigLabel(word, 3, ink, ink === '#ffffff' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.45)');
    g.save(); g.translate(x0 + w / 2, f0 + RA_FIELD_H / 2); g.rotate(rot);
    g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2)); g.restore();
  };
  zone(-10, 0, homeCol, homeT, Math.PI / 2);
  zone(100, 110, awayCol, awayT, -Math.PI / 2);
  // The home team's logo at midfield: 13 yards across, foreshortened like the rest of the turf.
  const logo = raLogo(homeT);
  if (logo) {
    const lo = document.createElement('canvas'); lo.width = 40; lo.height = 40;
    lo.getContext('2d').drawImage(logo, 0, 0, 40, 40);
    const lw = 13 * PX, lh = Math.round(lw * PY / PX);
    g.imageSmoothingEnabled = false; g.globalAlpha = 0.92;
    g.drawImage(lo, Math.round(raSX(50) - lw / 2), Math.round(f0 + RAX * PY - lh / 2), lw, lh);
    g.globalAlpha = 1;
  }
  // Lines: sidelines, end lines, goal lines and every five yards; hash ticks every yard.
  g.fillStyle = '#ffffff';
  g.fillRect(raSX(110), f0, raSX(-10) - raSX(110) + 2, 2);
  g.fillRect(raSX(110), f1 - 2, raSX(-10) - raSX(110) + 2, 2);
  for (const H of [-10, 110]) g.fillRect(raSX(H), f0, 2, RA_FIELD_H);
  for (let H = 0; H <= 100; H += 5) g.fillRect(raSX(H), f0, H % 100 === 0 ? 2 : 1, RA_FIELD_H);
  for (let H = 1; H < 100; H++) {
    if (H % 5 === 0) continue;
    const x = raSX(H);
    // NFL hash rows sit 23.58 yd off each sideline (70'9" apart), not college's 20 yd.
    for (const yy of [2, 23.58, 29.75, 51.33]) g.fillRect(x, Math.round(f0 + yy * PY) - 1, 1, 3);
  }
  // Yard numbers with a dark drop shadow; the far side's read upside down, as on a real field.
  for (let H = 10; H <= 90; H += 10) {
    const n = String(H <= 50 ? H : 100 - H), x = raSX(H);
    const lab = bigLabel(n, 2, '#f7f7f7', '#123d8a');
    const near = f0 + Math.round((53.33 - 11) * PY);
    g.drawImage(lab, x - Math.floor(lab.width / 2), near);
    g.save(); g.translate(x, f0 + Math.round(11 * PY)); g.rotate(Math.PI);
    g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2)); g.restore();
    // The little arrow pointing to the nearer goal.
    const dir = H < 50 ? 1 : H > 50 ? -1 : 0;
    if (dir) { g.fillStyle = '#f7f7f7'; const ax = x + dir * (lab.width / 2 + 4); g.fillRect(ax, near + 6, 1, 3); g.fillRect(ax + dir, near + 7, 1, 1); }
  }
  return c;
}

const RA_SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#6b4226'];
function raPalette(sc, a) {
  if (!a.pal && a.side === 'b') {
    const J = sc.homeCol, home = sc.offT;
    const other = J.toLowerCase() === home.color.toLowerCase() ? home.alt : home.color;
    const dm = a.role === 'DM';
    a.pal = { P: dm ? other : '#ffffff', H: dm ? '#ffffff' : J, F: RA_SKIN[sc.actors.indexOf(a) % RA_SKIN.length], J: dm ? '#ffffff' : J, W: dm ? J : '#ffffff', G: dm ? '#ffffff' : '#e8c547', K: dm ? J : '#f2f2f2', B: '#141414' };
    a.phase = 0;
  }
  if (!a.pal && a.side === 'r') { a.pal = { C: '#f4f4f4', F: RA_SKIN[2], X: '#141414', Q: '#f4f4f4', B: '#141414' }; a.phase = 0; }
  if (!a.pal && a.side === 'c') {
    const idx = sc.actors.indexOf(a);
    const home = sc.offHome ? sc.offT : sc.defT;
    const J = sc.homeCol || home.color;
    const other = J.toLowerCase() === home.color.toLowerCase() ? home.alt : home.color;
    const Y = lum(other) > 0.75 || cdist(other, J) < 60 ? '#ffffff' : other;
    a.pal = { R: ['#3b2414', '#d9b25a', '#7a3b16', '#161616'][idx % 4], F: RA_SKIN[(idx * 3) % RA_SKIN.length], J, K: '#ffffff', Y, W: '#ffffff' };
    a.phase = 0;
  }
  if (!a.pal) {
    const t = a.side === 'o' ? sc.offT : sc.defT;
    const J = sc.col[a.side];
    let Hc = J.toLowerCase() === t.color.toLowerCase() ? t.alt : t.color;
    if (cdist(Hc, J) < 60 || (lum(Hc) > 0.9 && lum(J) > 0.5)) Hc = mixHex(J, '#000000', 0.3);
    const idx = a.idx ?? sc.actors.indexOf(a);
    const light = lum(J) > 0.45;
    const P = a.side === 'o' ? '#f2f2f2' : '#d6d2c4';
    a.pal = {
      H: Hc, h: mixHex(Hc, '#000000', 0.4), w: lum(Hc) > 0.6 ? J : '#ffffff', m: '#8e8e8e',
      F: RA_SKIN[(idx * 7 + (a.side === 'o' ? 1 : 3)) % RA_SKIN.length],
      J, j: mixHex(J, '#000000', 0.38), n: light ? mixHex(J, '#000000', 0.6) : '#ffffff',
      P, p: mixHex(P, '#3a3f55', 0.35), S: J, B: '#141414',
    };
    a.phase = (idx * 0.37) % 1;
  }
  return a.pal;
}

// Thirty players on each sideline (home near, visitors far), standing around, a few pacing or turning.
function raBench(sc) {
  if (sc.bench) return sc.bench;
  const rng = raRng('bench' + sc.offT.id + sc.defT.id);
  const home = sc.offHome ? 'o' : 'd', away = sc.offHome ? 'd' : 'o';
  const f1 = RA_TOP + RA_FIELD_H;
  const out = [];
  const add = (side, y0, y1) => {
    for (let i = 0; i < 30; i++) {
      const H = 24 + 52 * (i + rng() * 0.8) / 30;
      out.push({ side, role: 'BENCH', idx: 200 + out.length, wx: raSX(H), wy: y0 + rng() * (y1 - y0),
        amp: rng() < 0.35 ? 3 + rng() * 9 : 0, w: 0.35 + rng() * 0.6, ph: rng() * 6.28, flipT: 2.5 + rng() * 5, k: [[0, 0, 0, 0]] });
    }
  };
  add(home, f1 + 12, f1 + 26);
  add(away, RA_STANDS + 18, RA_TOP - 9);
  sc.bench = out;
  return out;
}
function raDraw(g, W, st) {
  const RA_H = g.canvas.height;                      // this stage's own height
  const sc = st.sc, t = st.t;
  if (!sc.art) sc.art = raFieldArt(sc);
  const cx = Math.round(st.cam.x), cy = Math.round(st.cam.y);
  g.imageSmoothingEnabled = false;
  g.drawImage(sc.art, cx, cy, W, RA_H, 0, 0, W, RA_H);
  const S = (x, z) => [raSX(sc.offHome ? z : 100 - z) - cx, RA_TOP + (RAX + x * (sc.offHome ? -1 : 1)) * PY - cy];
  // Line of scrimmage and line to gain.
  const vline = (z, col) => { const [x] = S(0, z); g.fillStyle = col; g.fillRect(Math.round(x), RA_TOP + 2 - cy, 1, RA_FIELD_H - 4); };
  g.globalAlpha = 0.75;
  vline(sc.z0, '#4aa8ff');
  if (sc.ltg) vline(sc.ltg, '#ffe000');
  g.globalAlpha = 1;
  // Goal posts, seen from the side: a tall yellow post at the back of each end zone.
  for (const H of [-10, 110]) {
    const x = raSX(H) + (H < 0 ? 3 : -3) - cx, yc = RA_TOP + RAX * PY - cy;
    if (x < -4 || x > W + 4) continue;
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, yc - 20, 2, 44);
    g.fillStyle = '#0c0c0c'; g.fillRect(x - 1, yc - 3.08 * PY - 13.3 * HK - 1, 4, 3.08 * PY * 2 + 13.3 * HK - 3.33 * HK + 2); g.fillRect(x - 1, yc - 3.33 * HK - 1, 4, 3.33 * HK + 2);
    g.fillStyle = '#f5d20a'; g.fillRect(x, yc - 3.08 * PY - 13.3 * HK, 2, 3.08 * PY * 2 + 13.3 * HK - 3.33 * HK); g.fillRect(x, yc - 3.33 * HK, 2, 3.33 * HK);
  }
  const attackRight = !sc.offHome;
  const items = [];
  for (const a of sc.actors) {
    const [x, z] = raPos(a, t);
    const [sx, sy] = S(x, z);
    if (sx < -20 || sx > W + 20 || sy < -10 || sy > RA_H + 30) continue;
    const [ox, oz] = raPos(a, Math.max(0, t - 0.1));
    const speed = Math.hypot(x - ox, z - oz) / 0.1;
    const [px] = S(ox, oz);
    if (Math.abs(sx - px) > 0.25) a.face = sx > px ? 'r' : 'l';
    if (!a.face || (t < sc.tS && speed < 0.5 && !sc.huddle)) a.face = (a.side === 'o') === attackRight ? 'r' : 'l';
    items.push({ y: sy, draw: () => {
      const pal = raPalette(sc, a);
      g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(Math.round(sx) - 5, Math.round(sy) - 1, 11, 2); g.fillRect(Math.round(sx) - 4, Math.round(sy) - 2, 9, 4);
      const down = a.downAt != null && t > a.downAt + 0.1;
      const lineman = ['OL', 'DL', 'TE'].includes(a.role);
      let pose;
      if (down) pose = 'down';
      else if (lineman && t < sc.tS && speed < 0.5 && t > sc.tS - 1.2) pose = 'stance';   // set in a stance just before the snap
      else if (speed > 0.8) pose = ['run1', 'stand', 'run2', 'stand'][Math.floor(t * (speed < 3.5 ? 4.5 : 10) + a.phase * 4) % 4];   // walkers step slower
      else pose = 'stand';
      let lift = 0, flip = a.face === 'l';
      if (a.jumpAt != null && t > a.jumpAt && t < a.jumpAt + 5) {
        lift = Math.round(Math.abs(Math.sin((t - a.jumpAt) * 7)) * 7);
        if (a.cheer && lift > 1) pose = 'cheer';
      }
      if (a.danceAt != null && t > a.danceAt && !down) {       // the scorer's end-zone dance
        const ph = Math.floor((t - a.danceAt) * 4);
        pose = ph % 2 ? 'cheer' : 'dance';
        flip = Math.floor((t - a.danceAt) * 2) % 2 === 1;
        lift = ph % 4 === 1 ? 3 : 0;
      }
      if (a.side === 'b') { pose = Math.floor(t * 2.2) % 2 ? 'band1' : 'band2'; lift = 0; }   // everyone in step
      if (sc.huddle && t > sc.arrived && !down) lift = Math.floor(t * 2.4 + a.phase * 3) % 2;   // bouncing on their toes
      else if (!down && speed < 0.3 && (a.side === 'o' || a.side === 'd') && t > (sc.tEnd ?? sc.T) + 0.6 && !a.danceAt && !a.jumpAt) lift = Math.floor(t * 1.3 + a.phase * 5) % 3 === 0 ? 1 : 0;
      if (a.side === 'r') { pose = speed > 0.8 ? (Math.floor(t * (speed < 3.5 ? 4.5 : 9)) % 2 ? 'ref2' : 'ref') : 'ref'; lift = 0; }
      if (a.side === 'c') {
        if (a.danceFrom != null && t > a.danceFrom) {             // a synchronized routine
          const beat = Math.floor((t - a.danceFrom) / 0.32);
          pose = ['ch1', 'ch2', 'ch3', 'ch2'][beat % 4];
          lift = beat % 4 === 1 ? 2 : 0;
          flip = Math.floor(beat / 8) % 2 === 1;
        } else { pose = 'ch1'; lift = speed > 0.8 ? (Math.floor(t * 8) % 2) * 2 : 0; }
      }
      const spr = raSprite(pose, pal, flip);
      g.drawImage(spr, Math.round(sx - spr.width / 2), Math.round(sy - spr.height + 1 - lift));
    } });
  }
  for (const a of sc.halftime ? [] : raBench(sc)) {           // (the teams are in the locker room at halftime)
    const sx = a.wx + Math.sin(t * a.w + a.ph) * a.amp - cx, sy = a.wy - cy;
    if (sx < -12 || sx > W + 12 || sy < -4 || sy > RA_H + 22) continue;
    const vx = Math.cos(t * a.w + a.ph) * a.amp * a.w;              // pixels a second
    items.push({ y: sy, draw: () => {
      const pal = raPalette(sc, a);
      const cheering = sc.tdAt != null && t > sc.tdAt + 0.3 && a.side === sc.tdSide;
      let pose = Math.abs(vx) > 1.2 ? (Math.floor(t * 4 + a.ph) % 2 ? 'run1' : 'stand') : 'stand', lift = 0;
      if (cheering) { lift = Math.round(Math.abs(Math.sin((t + a.ph) * 6)) * 5); if (lift > 1) pose = 'cheer'; }
      const face = a.amp ? vx > 0 : Math.floor((t + a.ph) / a.flipT) % 2 === 0;
      g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(Math.round(sx) - 4, Math.round(sy) - 1, 9, 2);
      const spr = raSprite(pose, pal, !face);
      g.drawImage(spr, Math.round(sx - spr.width / 2), Math.round(sy - spr.height + 1 - lift));
    } });
  }
  const b = raBall(sc, t);
  const [bx, by] = S(b.x, b.z);
  if (!sc.noBall) items.push({ y: by + 0.5, draw: () => {
    let yb, xb = bx;
    if (b.held) {
      const f = b.held.face === 'l' ? -1 : 1;
      const down = b.held.downAt != null && t > b.held.downAt + 0.1;
      const [hx, hy] = S(...raPos(b.held, t));
      xb = hx + f * 4; yb = hy - (down ? 4 : 10);
    } else {
      if (b.h > 0.4) { g.fillStyle = 'rgba(0,30,0,0.4)'; g.fillRect(Math.round(bx) - 2, Math.round(by) - 1, 5, 2); }
      yb = by - b.h * HK;
    }
    const spr = raSprite(b.flying && Math.floor(t * 12) % 2 ? 'ball2' : 'ball', { B: '#8a4418', b: '#5e2c0e', W: '#ffffff' }, false);
    g.drawImage(spr, Math.round(xb - spr.width / 2), Math.round(yb - spr.height / 2));
  } });
  for (const e of sc.events) {
    if (e.kind !== 'flag' || t < e.t) continue;
    const u = clamp((t - e.t) / 0.7, 0, 1);
    const x = e.from[0] + (e.to[0] - e.from[0]) * u, z = e.from[1] + (e.to[1] - e.from[1]) * u;
    const [fx, fy] = S(x, z);
    items.push({ y: fy, draw: () => { const yy = Math.round(fy - 4 * 10 * u * (1 - u)); g.fillStyle = '#0c0c0c'; g.fillRect(Math.round(fx) - 3, yy - 3, 6, 5); g.fillStyle = '#ffe000'; g.fillRect(Math.round(fx) - 2, yy - 2, 4, 3); } });
  }
  items.sort((p, q) => p.y - q.y).forEach((it) => it.draw());
  if (st.ruler) {
    g.fillStyle = 'rgba(8,24,12,0.55)'; g.fillRect(0, RA_H - 11, W, 11);
    RA_RULER.size || [...Array(11)].forEach((_, i) => { const H = i * 10; const n = H === 0 || H === 100 ? 'G' : String(H <= 50 ? H : 100 - H); RA_RULER.set(H, bigLabel(n, 1, '#ffffff', '#123d8a')); });
    for (let H = 0; H <= 100; H += 10) {
      const x = raSX(H) - cx;
      if (x < -12 || x > W + 12) continue;
      const lab = RA_RULER.get(H);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(Math.round(x), RA_H - 11, 1, 2);
      g.drawImage(lab, Math.round(x - lab.width / 2), RA_H - 9);
      const dir = H > 0 && H < 50 ? 1 : H > 50 && H < 100 ? -1 : 0;     // points toward the nearer goal
      if (dir) { const ax = Math.round(x + dir * (lab.width / 2 + 3)); g.fillRect(ax, RA_H - 7, 1, 3); g.fillRect(ax + dir, RA_H - 6, 1, 1); }
    }
  }
  // Name tags for the players in the play text, stacked so none overlap.
  const placed = [];
  const order = [...sc.actors].sort((p, q) => (b.held === q) - (b.held === p));
  const withBall = b.held ? b.held.side : 'o';
  for (const a of order) {
    if (!a.who || a.side !== withBall) continue;
    if ((a.labelAt == null || t < a.labelAt) && b.held !== a) continue;
    if (a.labelTo != null && t > a.labelTo && b.held !== a) continue;
    const [sx, sy] = S(...raPos(a, t));
    const txt = a.who.last.toUpperCase();
    const w = pixW(txt) + 4, h = 9;
    const lx = clamp(Math.round(sx - w / 2), 1, W - w - 1);
    let ly = Math.round(sy) - 31;
    for (let n = 0; n < 4; n++) { const hit = placed.find((r) => lx < r[0] + r[2] && lx + w > r[0] && ly < r[1] + r[3] && ly + h > r[1]); if (!hit) break; ly = hit[1] - h - 1; }
    ly = clamp(ly, 1, RA_H - h - 1);
    placed.push([lx, ly, w, h]);
    const bg = sc.col[a.side];
    g.fillStyle = '#0c0c0c'; g.fillRect(lx - 1, ly - 1, w + 2, h + 2);
    g.fillStyle = '#ffffff'; g.fillRect(lx, ly, w, h);
    g.fillStyle = bg; g.fillRect(lx + 1, ly + 1, w - 2, h - 2);
    pixText(g, txt, lx + 2, ly + 2, onColor(bg));
  }
}

/* ═════════════ The viewer ═════════════ */
const RA_PAT_RE = /extra point|two[- ]point|conversion|kick attempt|\bpat\b/i;
function raPatFrom(p, prev) {
  const t = p.text || '';
  const homeScored = (p.home ?? 0) > (prev?.home ?? 0) && !((p.away ?? 0) > (prev?.away ?? 0));
  const awayScored = (p.away ?? 0) > (prev?.away ?? 0);
  const team = homeScored ? G.ev.home.id : awayScored ? G.ev.away.id : p.offId;
  const sH = team === G.ev.home.id ? 97 : 3;
  const base = { id: p.id + '-pat', period: p.period, clock: p.clock, away: p.away, home: p.home, offId: team, sH, eH: null, sDD: '', sPos: '', down: null, dist: null,
    parts: [], scoring: false, turnover: false, penYards: 0, endTeam: team, pat: true };
  // NFL: "T.Smack extra point is GOOD, Center-M.Orzech, Holder-D.Whelan." — "is" sits between
  // "extra point" and the result, which the college text never had.
  let m = /(?:#(\d+)\s*)?([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)?)\s+(?:kick attempt|extra point)\s+(?:is\s+)?(good|failed|no good|blocked|missed)/i.exec(t)
    || /\(([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)*) (Kick|Kick Failed|PAT Failed|PAT Blocked)\)/.exec(t);
  if (m) {
    const good = m.length > 3 ? /good/i.test(m[3]) && !/no good/i.test(m[3]) : /^kick$/i.test(m[2]);
    const who = m.length > 3 ? `${m[1] ? '#' + m[1] + ' ' : ''}${m[2]}` : m[1];
    return { ...base, kind: 'fg', typeText: good ? 'Extra Point Good' : 'Extra Point Missed', text: `${who} extra point ${good ? 'GOOD' : 'NO GOOD'}`, yards: 20 };
  }
  // NFL: "TWO-POINT CONVERSION ATTEMPT. M.Penix pass to C.Blair is complete. ATTEMPT SUCCEEDS."
  m = /TWO-POINT CONVERSION ATTEMPT\.([\s\S]*?)ATTEMPT (SUCCEEDS|FAILS)/i.exec(t);
  if (m) {
    const seg = m[1];
    const good = /SUCCEEDS/i.test(m[2]);
    const how = /\b(?:rush|run)\b/i.test(seg) && !/\bpass\b/i.test(seg) ? 'rush' : 'pass';
    const nm = /(?:#(\d+)\s*)?([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)?)\s+(?:pass|rush|run)/i.exec(seg);
    const who = nm ? `${nm[1] ? '#' + nm[1] + ' ' : ''}${nm[2]} ` : '';
    const text = how === 'pass' ? `${who}pass ${good ? 'complete' : 'incomplete'} short middle, two-point conversion ${good ? 'good' : 'failed'}` : `${who}rush middle, two-point conversion ${good ? 'good' : 'failed'}`;
    return { ...base, kind: how === 'pass' ? (good ? 'pass' : 'incomplete') : 'run', typeText: 'Two-Point Conversion', text, yards: good ? 3 : 0, eH: good ? (team === G.ev.home.id ? 100 : 0) : sH };
  }
  // Older/alternate phrasing, kept as a fallback.
  m = /(?:#(\d+)\s*)?([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)?)\s+(pass|rush|run)\s+(?:attempt|conversion)\s+(good|failed)/i.exec(t) || /two[- ]point (pass|rush|run)? ?conversion (good|failed)/i.exec(t);
  if (m) {
    const good = /good/i.test(m[m.length - 1]);
    const how = (m.length > 4 ? m[3] : m[1] || 'rush').toLowerCase() === 'pass' ? 'pass' : 'rush';
    const who = m.length > 4 && !/^two[- ]point$/i.test(m[2]) ? `${m[1] ? '#' + m[1] + ' ' : ''}${m[2]} ` : '';
    const text = how === 'pass' ? `${who}pass ${good ? 'complete' : 'incomplete'} short middle, two-point conversion ${good ? 'good' : 'failed'}` : `${who}rush middle, two-point conversion ${good ? 'good' : 'failed'}`;
    return { ...base, kind: how === 'pass' ? (good ? 'pass' : 'incomplete') : 'run', typeText: 'Two-Point Conversion', text, yards: good ? 3 : 0, eH: good ? (team === G.ev.home.id ? 100 : 0) : sH };
  }
  return null;
}
function raPlays() {
  const flat = G?.sum?.flat || [];
  const list = [];
  flat.forEach((f, i) => {
    const p = f.p;
    if (!(p.kind !== 'meta' && p.sH != null || ['kickoff', 'fg'].includes(p.kind))) return;
    list.push(p);
    if (p.scoring && /touchdown/i.test(p.typeText + ' ' + p.text) && !RA_PAT_RE.test(flat[i + 1]?.p.typeText + ' ' + flat[i + 1]?.p.text)) {
      const pat = raPatFrom(p, flat[i - 1]?.p);
      if (pat) list.push(pat);
    }
  });
  const q = G?.ev ? quickPlay(G.ev) : null;
  if (q && q.kind !== 'meta' && quickIsNewer(q.id, G.sum, G.ev.id)) { q.text = G.ev.sit?.lastPlay?.text || q.text; q.typeText = G.ev.sit?.lastPlay?.type?.text || ''; q.sDD = ''; list.push(q); }
  return list;
}
function raQBs() {
  const set = new Set();
  for (const f of G?.sum?.flat || []) {
    const m = new RegExp(RA_PL + ' pass\\b').exec(cleanText(f.p.text).replace(/^(?:No Huddle[- ]?)?(?:Shotgun|Pistol|Under Center)?\s*/i, ''));
    if (m) set.add(`${f.p.offId}:${m[1] || m[2]}`);
  }
  return set;
}
function openReenact(id) {
  if (!G?.ev) return;
  RA.list = raPlays();
  let i = RA.list.findIndex((p) => String(p.id) === String(id));
  if (i < 0) i = RA.list.length - 1;
  if (i < 0) return;
  const m = $('#ra');
  m.innerHTML = `<div class="ra-in" role="dialog" aria-modal="true" aria-label="Play animation">
    <div class="ra-top"><div class="ra-meta" id="ra-meta"></div><button class="icon-btn" data-raclose aria-label="Close">${ICON.close}</button></div>
    <div class="ra-stage"><canvas id="ra-cv"></canvas><div class="ra-banner" id="ra-banner"></div></div>
    <div class="ra-ctl">
      <button class="ra-b" data-rastep="-1" aria-label="Previous play">${ICON.prev}<span>Prev</span></button>
      <button class="ra-b main" data-raplay aria-label="Replay">${ICON.play}<span>Replay</span></button>
      <button class="ra-b" data-raspeed aria-label="Speed">1×</button>
      <button class="ra-b" data-rastep="1" aria-label="Next play"><span>Next</span>${ICON.next}</button>
    </div>
    <div class="ra-tx" id="ra-tx"></div>
    ${G.ev.state === 'in' ? `<label class="sw-row ra-follow"><span><b>Play new snaps as they happen</b><small>Keep this open during the game</small></span><input type="checkbox" id="ra-follow" ${RA.follow ? 'checked' : ''}><i></i></label>` : ''}
    <p class="ra-note">Drawn from the play-by-play. The spots, yardage and named players are real; the other players and their routes are illustrative.</p>
  </div>`;
  m.hidden = false;
  RA.open = true;
  document.body.style.overflow = 'hidden';
  m.querySelector('#ra-follow')?.addEventListener('change', (e) => { RA.follow = e.target.checked; });
  raLoad(i);
  m.querySelector('[data-raplay]').focus({ preventScroll: true });
}
function raLoad(i) {
  RA.idx = clamp(i, 0, RA.list.length - 1);
  const p = RA.list[RA.idx];
  try { RA.sc = raBuild(p, G.ev, raQBs()); } catch (err) { console.error(err); RA.sc = null; }
  const ev = G.ev;
  $('#ra-meta').innerHTML = `<b>${esc(periodLabel(p.period))} ${esc(p.clock)}</b><span>${esc(p.sDD ? `${p.sDD}${p.sPos ? ' at ' + p.sPos : ''}` : p.typeText)}</span>${p.away != null ? `<span class="ra-sc">${esc(ev.away.abbr)} ${p.away} – ${p.home} ${esc(ev.home.abbr)}</span>` : ''}`;
  $('#ra-tx').innerHTML = playHTML(p.text);
  document.querySelector('[data-rastep="-1"]').disabled = RA.idx === 0;
  document.querySelector('[data-rastep="1"]').disabled = RA.idx >= RA.list.length - 1;
  raRestart();
}
function raRestart() {
  cancelAnimationFrame(RA.raf);
  RA.t = 0;
  RA.shown = new Set();
  RA.cam = null;
  const b = $('#ra-banner'); if (b) { b.className = 'ra-banner'; b.innerHTML = ''; }
  if (!RA.sc) { $('#ra-tx').textContent += ' (This play can’t be animated.)'; return; }
  raSize();
  RA.last = performance.now();
  RA.raf = requestAnimationFrame(raTick);
}
function raSizeCanvas(cv, h = RA_H) {
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  if (h === 'auto') h = clamp(Math.round(r.height * (r.width > 560 ? 0.88 : 0.96)), 210, RA_WORLD_H);   // desktop: stands to benches; phone: a bit closer             // most of the field's width, the stands and the benches
  cv.height = h;
  cv.width = Math.max(100, Math.round(h * r.width / (r.height || 1)));
}
const raSize = () => raSizeCanvas($('#ra-cv'));
// One frame for a stage (the full viewer or the sidebar card): advance the clock, move the camera
// (following the ball both ways, leading it, rising with a kick), draw, and raise any banner.
function raStep(st, dt) {
  const sc = st.sc;
  const RA_H = st.cv.height;
  st.t = st.loop ? st.t + dt : Math.min(sc.T, st.t + dt);     // the live views keep their clock running
  const cv = st.cv;
  const W = cv.width;
  const Hb = (z) => (sc.offHome ? z : 100 - z);
  const Yb = (x) => RA_TOP + (RAX + x * (sc.offHome ? -1 : 1)) * PY;
  const b = raBall(sc, st.t), b0 = raBall(sc, Math.max(0, st.t - 0.2));
  const wx = raSX(Hb(b.z)), vx = (wx - raSX(Hb(b0.z))) / 0.2;
  const pre = st.t < sc.tS;
  let tx = pre ? raSX(Hb(sc.z0 - 2)) - W / 2 : wx - W / 2 + clamp(vx * 0.3, -W * 0.25, W * 0.25);
  let ty = (pre ? Yb(sc.x0) : Yb(b.x) - Math.min(b.h * HK, 90) * 0.6) - RA_H * 0.55;
  if (sc.focusFn) { const f = sc.focusFn(st.t); tx = raSX(Hb(f.z)) - W / 2; ty = Yb(f.x) - RA_H * 0.55; }
  else if (sc.focus && st.t > sc.focus.from) { tx = raSX(Hb(sc.focus.z)) - W / 2; ty = Yb(sc.focus.x) - RA_H * 0.55; }
  tx = clamp(tx, 0, RA_WORLD_W - W);
  ty = clamp(ty, 0, RA_WORLD_H - RA_H);
  if (!st.cam) st.cam = { x: tx, y: ty };
  const k = 1 - Math.exp(-dt * 3.4);
  st.cam.x += (tx - st.cam.x) * k;
  st.cam.y += (ty - st.cam.y) * k;
  raDraw(cv.getContext('2d'), W, st);
  for (const e of sc.events) {
    if (e.kind !== 'banner' || st.t < e.t || st.shown.has(e)) continue;
    st.shown.add(e);
    const el = st.banner;
    if (!el) continue;
    const bg = sc.col[e.side || 'o'];
    el.style.setProperty('--bb', bg); el.style.setProperty('--bi', onColor(bg));
    el.innerHTML = `<b>${esc(e.title)}</b>${e.sub ? `<span>${esc(e.sub)}</span>` : ''}`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  }
}
function raTick(now) {
  if (!RA.open || !RA.sc) return;
  const dt = Math.min(0.05, (now - RA.last) / 1000) * RA.speed;
  RA.last = now;
  RA.cv = $('#ra-cv'); RA.banner = $('#ra-banner');
  if (RA.cv) raStep(RA, dt);
  if (RA.t < RA.sc.T) RA.raf = requestAnimationFrame(raTick);
  else raEnded();
}
function raEnded() {
  const nx = RA.pending;
  if (nx != null) { RA.pending = null; RA.list = raPlays(); raLoad(RA.list.findIndex((p) => p.id === nx)); }
}
function closeReenact() {
  const m = $('#ra');
  if (!m || m.hidden) return;
  RA.open = false;
  cancelAnimationFrame(RA.raf);
  m.hidden = true; m.innerHTML = '';
  document.body.style.overflow = '';
}
// Called by app.js with plays that just arrived.
function reenactFresh(fresh) {
  if (!RA.open || !G) return;
  const atLatest = RA.idx >= RA.list.length - 1;
  RA.list = raPlays();
  const last = [...fresh].reverse().find((p) => p.kind !== 'meta');
  document.querySelector('[data-rastep="1"]').disabled = RA.idx >= RA.list.length - 1;
  if (!last || !RA.follow || !atLatest) return;
  if (RA.t < (RA.sc?.T ?? 0)) RA.pending = last.id;       // let the current play finish first
  else raLoad(RA.list.findIndex((p) => p.id === last.id));
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-anim]');
  if (a && G) { e.preventDefault(); e.stopPropagation(); openReenact(a.dataset.anim); return; }
  if (!RA.open) return;
  if (e.target.id === 'ra' || e.target.closest('[data-raclose]')) { closeReenact(); return; }
  if (e.target.closest('[data-raplay]')) { raRestart(); return; }
  const st = e.target.closest('[data-rastep]');
  if (st && !st.disabled) { RA.pending = null; raLoad(RA.idx + +st.dataset.rastep); return; }
  const sp = e.target.closest('[data-raspeed]');
  if (sp) { RA.speed = RA.speed === 1 ? 0.5 : 1; sp.textContent = RA.speed === 1 ? '1×' : '½×'; }
}, true);
document.addEventListener('keydown', (e) => {
  if (!RA.open) return;
  if (e.key === 'Escape') { closeReenact(); e.stopImmediatePropagation(); }
  else if (e.key === 'ArrowRight') { const b = document.querySelector('[data-rastep="1"]'); if (!b.disabled) raLoad(RA.idx + 1); }
  else if (e.key === 'ArrowLeft') { const b = document.querySelector('[data-rastep="-1"]'); if (!b.disabled) raLoad(RA.idx - 1); }
  else if (e.key === ' ') { e.preventDefault(); raRestart(); }
}, true);
window.addEventListener('resize', () => { if (RA.open) raSize(); });
window.addEventListener('hashchange', () => { if (RA.open && !/^#g/.test(location.hash)) closeReenact(); });

/* ═════════════ Live field card (desktop sidebar) ═════════════ */
// The newest snap plays out at the top of the right column as it comes in; between plays the teams
// line up at the real spot for the next snap. Clicking it opens the full viewer.
const SIDE = { sc: null, t: 0, cam: null, shown: new Set(), raf: 0, last: 0, running: false, playId: null, setKey: '', idle: 0, gameId: null, cv: null };
const sideEl = () => document.getElementById('side-live');
// The big 8-bit view swaps in for the tilted field when the viewer picks it (remembered).
const bigTecmo = () => store.get('tecmoBig', false);
function sideTarget() {
  return bigTecmo() ? { cv: $('#bt-cv'), banner: $('#bt-banner'), h: 'auto' } : { cv: $('#sl-cv'), banner: $('#sl-banner'), h: 128 };
}
function sideLiveOn() {
  const t = sideTarget();
  return !!(G?.ev?.state === 'in' && t.cv && (bigTecmo() || isWide()) && !t.cv.closest('[hidden]') && !isHalftime(G.ev));
}
function sideText(key, v, html) {
  for (const id of ['#sl-' + key, '#bt-' + key]) { const el = $(id); if (el) el[html ? 'innerHTML' : 'textContent'] = v; }
}
function fieldViewToggle() {
  const on = bigTecmo();
  return `<button class="fv-tog" data-fview aria-pressed="${on}" title="${on ? 'Show the field view' : 'Show the 8-bit view'}">${on ? 'Field' : '8-bit'}</button>`;
}
function sideStop() { cancelAnimationFrame(SIDE.raf); clearTimeout(SIDE.idle); SIDE.idle = 0; SIDE.running = false; }
function sideUpdate() {
  const el = sideEl(), big = bigTecmo(), tgt = sideTarget();
  const ok = !!(tgt.cv && G?.ev && G.sum && G.ev.state !== 'pre' && (big || isWide()));
  if (el) el.hidden = !ok || big;
  const bt = $('#big-tecmo');
  if (bt) bt.hidden = !(ok && big);
  $('.stadium')?.classList.toggle('tecmo', ok && big);
  if (!ok) { sideStop(); if (G?.gate && typeof gateOpen === 'function') gateOpen(); return; }
  if (SIDE.gameId !== G.id) { sideStop(); Object.assign(SIDE, { gameId: G.id, playId: null, setKey: '', timeoutId: null, sc: null, cv: tgt.cv }); }
  if (SIDE.cv !== tgt.cv) { SIDE.cv = tgt.cv; SIDE.banner = tgt.banner; SIDE.cam = null; if (SIDE.sc) { raSizeCanvas(SIDE.cv, tgt.h); cancelAnimationFrame(SIDE.raf); sideResume(); } }
  if (isHalftime(G.ev)) { if (!SIDE.sc?.halftime && (!SIDE.running || SIDE.sc?.huddle || SIDE.sc?.timeout)) sideHalftime(); return; }
  const latest = sideNext();
  if (!latest) return;
  // A timeout called since the last snap: clear the field and bring out the cheerleaders.
  // (Timeouts aren't in the play list, so look at the drive's last entry and the scoreboard feed.)
  const lastRaw = G.sum.drives[G.sum.drives.length - 1]?.plays.at(-1);
  const sl = G.ev.sit?.lastPlay;
  const lastAny = lastRaw && /timeout/i.test(lastRaw.typeText + ' ' + lastRaw.text) ? lastRaw
    : sl && /timeout/i.test((sl.type?.text || '') + ' ' + (sl.text || '')) && quickIsNewer(sl.id, G.sum, G.ev.id) ? { id: sl.id, kind: 'meta', typeText: sl.type?.text || 'Timeout', text: sl.text || '' } : null;
  if (lastAny && String(lastAny.id) !== String(SIDE.timeoutId)) {
    const allRaw = G.sum.drives.flatMap((d) => d.plays);
    const i = allRaw.findIndex((x) => String(x.id) === String(lastAny.id));
    const before = i > 0 ? allRaw[i - 1] : allRaw[allRaw.length - 1];
    if (typeof isTVTimeout === 'function' && isTVTimeout(lastAny, before)) SIDE.timeoutId = lastAny.id;
  }
  if (lastAny && lastAny.kind === 'meta' && /timeout/i.test(lastAny.typeText + ' ' + lastAny.text) && G.ev.state === 'in' && String(lastAny.id) !== String(SIDE.timeoutId)) {
    if (SIDE.sc && (!SIDE.running || SIDE.sc.huddle)) { sideTimeout(lastAny); return; }
  }
  if (String(latest.id) !== String(SIDE.playId)) { if (!SIDE.running || ((SIDE.sc?.timeout || SIDE.sc?.halftime || SIDE.sc?.huddle) && !SIDE.sc?.clear)) { if (SIDE.sc?.tdAt == null || !SIDE.idle) sidePlay(latest); } }   // a play mid-animation finishes first
  else if (!SIDE.running && !SIDE.idle && !SIDE.sc?.huddle) sideHuddle();
}
function sidePlay(p) {
  clearTimeout(SIDE.idle); SIDE.idle = 0;
  SIDE.playId = p.id; SIDE.setKey = ''; SIDE.lastPlay = p;
  // Out of the huddle when the teams are in one and the same offense has the ball.
  // Every play starts from the scene before it: the players jog from wherever they were into the formation.
  const prevSc = SIDE.sc?.gameId === G.id ? SIDE.sc : null;
  let h = {};
  if (prevSc) {
    const offHome = p.offId === G.ev.home.id;
    const pb = raBall(prevSc, SIDE.t);
    const x0 = prevSc.noBall ? 0 : clamp(Math.round(pb.x * (prevSc.offHome === offHome ? 1 : -1) / 3.08) * 3.08, -3.08, 3.08);
    h = { from: prevSc, fromT: SIDE.t, x0 };
  }
  let sc = null;
  try { sc = raBuild(p, G.ev, raQBs(), h); } catch (err) { console.error(err); }
  if (SIDE.gatePlay != null && typeof gameGateRelease === 'function') { gameGateRelease(SIDE.gatePlay); SIDE.gatePlay = null; }   // an earlier play never showed its result
  if (sc) {
    sc.gameId = G.id;
    // The moment the result shows: the first banner (a gain, "Touchdown", "Incomplete"…) or the whistle.
    const firstBanner = sc.events.filter((e) => e.kind === 'banner').map((e) => e.t).sort((x, y) => x - y)[0];
    SIDE.gatePlay = p.id;
    SIDE.resultAt = Math.min(firstBanner ?? Infinity, sc.tEnd ?? sc.T - 1.5);
  }
  sideText('meta', `${periodLabel(p.period)}${p.clock ? ' ' + p.clock : ''}${p.sDD ? ' · ' + p.sDD : ''}`);
  sideText('tag', G.ev.state === 'post' ? 'Final play' : 'Live');
  sideText('tx', '');
  SIDE.pendingTx = p.text;
  if (!sc) return;
  sideRun(sc, () => {
    SIDE.idle = setTimeout(() => {
      SIDE.idle = 0;
      const latest = sideNext();
      if (SIDE.sc?.tdAt != null) sideClear(p);                          // after the celebration, everyone runs off
      else if (latest && String(latest.id) !== String(SIDE.playId)) sidePlay(latest);
      else if (p.pat || RA_PAT_RE.test(p.typeText + ' ' + p.text) || (p.kind === 'fg' && SIDE.sc?.I?.good)) sideCheer(p);
      else sideHuddle();
    }, 1200);
  });
}
// After a play (not a score, not a kick): both teams jog into their huddles at the next spot.
function sideHuddle() {
  const ev = G?.ev, prev = SIDE.sc;
  let s = ev?.sit;
  if (!prev || prev.huddle || prev.timeout || prev.tdAt != null || !ev || ev.state !== 'in' || isHalftime(ev)) return;
  if (!s?.possession || s.yardLine == null || !(s.down > 0)) {
    const lp = SIDE.lastPlay, pb = raBall(prev, prev.T);
    const H = prev.offHome ? pb.z : 100 - pb.z;
    if (!lp || !(H > 1 && H < 99)) return;
    s = { possession: lp.endTeam || lp.offId, yardLine: Math.round(H), down: 1, distance: null, downDistanceText: '' };
  }
  let sc = null;
  try { sc = raHuddle(prev, ev, s); } catch (err) { console.error(err); return; }
  sc.gameId = G.id;
  SIDE.huddleOff = s.possession;
  const off = s.possession === ev.home.id ? ev.home : ev.away;
  sideText('meta', `${statusText(ev)} · ${off.abbr} ball`);
  sideText('tx', s.downDistanceText ? `Huddle · next: ${s.downDistanceText}` : 'Huddle');
  sideRun(sc);
}
function sideTimeout(tp) {
  const ev = G.ev, s = ev.sit, prev = SIDE.sc;
  clearTimeout(SIDE.idle); SIDE.idle = 0;
  SIDE.timeoutId = tp.id;
  const poss = s?.possession || prev.offT.id;
  const caller = /timeout\s+(.+?)(?:,|$)/i.exec(tp.text)?.[1]?.trim() || '';
  let sc = null;
  try { sc = raTimeout(prev, SIDE.t, ev, poss, s?.possession ? s.yardLine : null, caller); } catch (err) { console.error(err); return; }
  sc.gameId = G.id;
  SIDE.huddleOff = poss;
  sideText('meta', `${statusText(ev)} · Timeout`);
  sideText('tx', caller ? `Timeout, ${caller}` : 'Timeout');
  sideRun(sc);
}
// The next play to show: the one after the current play when we're only a play or two behind
// (so a touchdown, its try and the kickoff all play in order), otherwise the newest.
function sideNext() {
  const list = raPlays();
  const i = list.findIndex((p) => String(p.id) === String(SIDE.playId));
  if (i >= 0 && i < list.length - 1 && list.length - 1 - i <= 2) return list[i + 1];
  return list[list.length - 1];
}
// After the try: the teams clear out and the cheerleaders dance until the kickoff.
// After a touchdown: both teams run to their sidelines, then the kicking units run on for the try.
function sideClear(p) {
  const ev = G.ev, prev = SIDE.sc;
  if (!prev) return;
  const scorer = prev.tdSide === 'd' ? prev.defT.id : prev.offT.id;
  let sc = null;
  try { sc = raTimeout(prev, SIDE.t, ev, scorer, scorer === ev.home.id ? 97 : 3, '', null, true); } catch (err) { console.error(err); return; }
  sc.gameId = G.id;
  SIDE.huddleOff = scorer;
  sideText('tx', 'Lining up for the try');
  sideRun(sc, () => { const nx = sideNext(); if (nx && String(nx.id) !== String(SIDE.playId)) sidePlay(nx); });
}
function sideCheer(p) {
  const ev = G.ev, prev = SIDE.sc;
  if (!prev || ev.state !== 'in') return;
  const kicker = p.offId;
  let sc = null;
  try { sc = raTimeout(prev, SIDE.t, ev, kicker, kicker === ev.home.id ? 35 : 65, '', null); } catch (err) { console.error(err); return; }
  sc.gameId = G.id;
  SIDE.huddleOff = kicker;
  sideText('meta', statusText(ev));
  sideText('tx', 'Kickoff next');
  sideRun(sc);
}
function sideHalftime() {
  const ev = G.ev;
  sideStop();
  let sc = null;
  try { sc = raHalftime(ev); } catch (err) { console.error(err); return; }
  sc.gameId = G.id;
  SIDE.playId = SIDE.playId || null;
  sideText('tag', 'Halftime');
  sideText('meta', `${ev.away.abbr} ${ev.away.score ?? 0} – ${ev.home.score ?? 0} ${ev.home.abbr}`);
  sideText('tx', `The ${ev.home.name} band takes the field`);
  sideRun(sc);
}
function sideSet() {
  const ev = G?.ev, s = ev?.sit;
  if (!ev || ev.state !== 'in' || !s?.possession || s.yardLine == null || !(s.down > 0) || isHalftime(ev)) return;
  const key = `${s.possession}|${s.yardLine}|${s.down}|${s.distance}`;
  if (key === SIDE.setKey) return;
  SIDE.setKey = key;
  const p = { id: 'set' + key, kind: 'set', offId: s.possession, sH: s.yardLine, eH: null, down: s.down, dist: s.distance, text: '', typeText: '', period: ev.period, parts: [] };
  let sc = null;
  try { sc = raBuild(p, ev, new Set()); } catch (err) { console.error(err); return; }
  const off = s.possession === ev.home.id ? ev.home : ev.away;
  sideText('meta', `${statusText(ev)} · ${off.abbr} ball`);
  sideText('tx', s.downDistanceText ? `Next: ${s.downDistanceText}` : '');
  sideRun(sc);
}
// Continue the current scene's clock on whatever stage SIDE points at.
function sideResume() {
  SIDE.last = performance.now();
  const tick = (now) => {
    if (!SIDE.cv?.isConnected || SIDE.cv.closest('[hidden]')) { SIDE.running = false; return; }
    const dt = Math.min(0.05, (now - SIDE.last) / 1000);
    SIDE.last = now;
    SIDE.loop = true;
    raStep(SIDE, dt);
    if (SIDE.gatePlay != null && SIDE.t >= SIDE.resultAt) {                 // the result is on screen: let the page update
      const id = SIDE.gatePlay;
      SIDE.gatePlay = null;
      if (SIDE.pendingTx) { sideText('tx', playHTML(SIDE.pendingTx), true); SIDE.pendingTx = null; }
      if (typeof gameGateRelease === 'function') gameGateRelease(id);
    }
    if (SIDE.running && SIDE.t >= SIDE.sc.T) { SIDE.running = false; SIDE.onEnd?.(); }
    SIDE.raf = requestAnimationFrame(tick);                         // keep drawing: the players idle, the sidelines move
  };
  SIDE.raf = requestAnimationFrame(tick);
}
function sideRun(sc, onEnd) {
  cancelAnimationFrame(SIDE.raf);
  const tgt = sideTarget();
  Object.assign(SIDE, { sc, t: 0, cam: null, shown: new Set(), running: true, ruler: true, cv: tgt.cv, banner: tgt.banner });
  if (SIDE.banner) { SIDE.banner.classList.remove('on'); SIDE.banner.innerHTML = ''; }
  raSizeCanvas(SIDE.cv, tgt.h);                      // the small card gets a closer camera
  SIDE.onEnd = onEnd;
  sideResume();
}
document.addEventListener('click', (e) => {
  if (!G) return;
  if (e.target.closest('#side-live')) { openReenact(SIDE.playId); return; }
  const tog = e.target.closest('[data-fview]');
  if (tog) {
    store.set('tecmoBig', !bigTecmo());
    document.querySelectorAll('[data-fview]').forEach((b) => b.outerHTML = fieldViewToggle());
    const tgt = sideTarget();
    SIDE.cv = tgt.cv; SIDE.banner = tgt.banner; SIDE.cam = null;
    sideUpdate();                                            // shows/hides the stages
    if (SIDE.sc && SIDE.cv && !SIDE.cv.closest('[hidden]')) {
      raSizeCanvas(SIDE.cv, tgt.h);
      cancelAnimationFrame(SIDE.raf); sideResume();                    // keep the scene going on the new stage
      const bn = SIDE.banner; if (bn) bn.classList.remove('on');
    }
  }
});
window.addEventListener('resize', () => { if (G) { if (SIDE.sc && SIDE.cv) raSizeCanvas(SIDE.cv, sideTarget().h); sideUpdate(); } });
