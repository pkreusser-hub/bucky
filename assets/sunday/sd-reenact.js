'use strict';
/* Sunday, part 3: play animations. Each play is re-staged on a small 3D field from the
   play-by-play text. The spots, yardage, direction and named players are real; the other
   players, the routes and the timing are drawn to fit. Loaded after app.js and features.js. */

/* ═════════════ Reading a play ═════════════ */
const RAX = 26.67;                                   // half the field's width, in yards
const OOB_X = RAX + 0.8;                             // where a carrier who goes out of bounds crosses: a step past the sideline
const raX = (x) => clamp(x, -RAX + 1, RAX - 1);
// Goalposts: the uprights stand on the end line (10 yards behind the goal line), 18'6" apart, the
// crossbar 10 ft up, the uprights reaching 35 ft above it.
const RA_POST = 110, RA_UPRIGHT = 3.083, RA_BAR = 3.333, RA_POST_TOP = 15;
// The continuation clause excludes ESPN's own ALL-CAPS markers (INTERCEPTED, TOUCHDOWN, FUMBLES,
// PENALTY, REVERSED, SAFETY) — without this a name greedily swallows a following marker word,
// since an all-caps word is itself valid title-case-shaped text ("J.Dotson INTERCEPTED").
const RA_PL = "(?:#(\\d{1,2})\\s*)?([A-Z][A-Za-z.'’-]*(?:\\s(?!(?:INTERCEPTED|TOUCHDOWN|FUMBLES|PENALTY|REVERSED|SAFETY)\\b)(?:[A-Z][A-Za-z.'’-]*|III|II|IV)){0,2})";
// A spot in the end zone is written with a minus: "INTERCEPTED by T.Hufanga at DEN -1" is a yard deep.
const RA_SPOT = "(?:the\\s)?(?:([A-Z][A-Z&]{1,5})\\s?(-?\\d{1,2})\\b|(50)\\b)";

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
  // The formation tag ESPN copies from the gamebook: "(Shotgun)", "(No Huddle, Shotgun)", "(Pistol)".
  // NFL text never says "Under Center"; a snap with no tag is taken from under center.
  const form = /\bpistol\b/i.test(t) ? 'pistol' : /shotgun/i.test(t) ? 'gun' : 'under';
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
  const spot = (re, on = t) => {
    const m = new RegExp(re + '\\s*' + RA_SPOT).exec(on);
    if (!m) return null;
    const [ab, n, fifty] = m.slice(-3);
    if (fifty) return 50;
    const tm = sideOf(ab);
    return tm ? (tm.id === ev.home.id ? +n : 100 - +n) : null;
  };
  const dm = /\b(?:pass(?: complete| incomplete)?|rush|run|scramble)\s+(?:(short|deep)\s+)?(left|middle|right|up the middle)?(?:\s+(end|tackle|guard))?/.exec(t) || [];
  const tacklers = [];
  for (const g of t.matchAll(/\(([^()]*)\)/g)) {
    // A formation tag is not a tackler list: "(No Huddle, Shotgun) J.Love pass …" used to name two
    // tacklers called "No Huddle" and "Shotgun".
    if (/H:|LS:|Original|clock|shotgun|huddle|pistol|formation|wildcat|under center/i.test(g[1])) continue;
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
    text: t, gun, form,
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
      ? getOn(t.replace(/,?\s*(?:Center|Holder)-[A-Za-z.'’-]+\.?/g, ''), RA_PL + '\\s+(?:to|(?:pushed|ran)\\s+ob\\s+at)\\s+(?:[A-Z][A-Z&]{1,5}\\s?\\d{1,2}\\b|50\\b)')
      : null),
    // The fumbler is usually named right before "FUMBLES" ("J.Love FUMBLES"); when the clause
    // omits the name (it's the player just mentioned — the rusher/target/sacked player), `hasFumble`
    // below still gates the animation so a fumble is never silently dropped.
    fumbler: get(RA_PL + '\\s+FUMBLES') || get('fumbled? by ' + RA_PL),
    recoverer: get('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5}-)?' + RA_PL) || get('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5} )?' + RA_PL),
    // "FUMBLES (D.Hamilton), and recovers at JAX 5": no "RECOVERED by" — the man who fumbled fell
    // on it himself, so his own team keeps it (a returner's team on a kick, else the offense).
    recTeam: recBy ? sideOf(recBy[1]) : /FUMBLES\b.{0,60}?\band recovers at\b/.test(t)
      ? (['punt', 'kickoff'].includes(p.kind) ? (p.offId === ev.home.id ? ev.away : ev.home) : (p.offId === ev.home.id ? ev.home : ev.away)) : null,
    breakup: get('broken up by ' + RA_PL),
    tacklers,
    hasFumble,
    catchH: spot('caught at'),
    thrownH: spot('thrown to'),
    intH: spot('(?:intercepted|INTERCEPTED) by ' + RA_PL + ' at'),
    fumH: spot('fumbled? by ' + RA_PL + ' at') ?? spot('FUMBLES\\s*(?:\\([^)]*\\))?\\s*(?:\\[[^\\]]*\\])?,?\\s*at'),
    recH: spot('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5}-)?' + RA_PL + ' at') ?? spot('(?:recovered|RECOVERED) by (?:[A-Z&]{2,5} )?' + RA_PL + ' at'),
    landH: spot('(?:kicks|punts|kickoff|punt) -?\\d+ yards? (?:from [A-Z&]{2,5} \\d{1,2} )?to'),
    // Where a kick return itself ended ("J.Cameron to JAX 29"), before any penalty moves the ball.
    retH: p.kind === 'kickoff' || p.kind === 'punt' ? spot('\\.\\s+' + RA_PL + '\\s+(?:to|(?:pushed|ran)\\s+ob\\s+at)', t.replace(/,?\s*(?:Center|Holder)-[A-Za-z.'’-]+\.?/g, '')) : null,
    kickYds: +(/(?:kicks|punts|kickoff|punt) (-?\d+) yards?/i.exec(t)?.[1] ?? NaN),
    fgYds: +(/field goal attempt from (\d+)|(\d+) (?:yd|yard) (?:field goal|FG)/.exec(t)?.slice(1).find(Boolean) ?? NaN),
    good: /\bgood\b/i.test(t + ' ' + tt) && !/no good|missed|blocked|failed/i.test(t + ' ' + tt),
    wide: /wide (left|right)/i.exec(t)?.[1]?.toLowerCase() || '',
    short: /\bshort\b/i.test(t) && /field goal|extra point/i.test(t),
    upright: /hit (?:the )?(left|right) upright|(left|right) upright/i.exec(t)?.slice(1).find(Boolean)?.toLowerCase() || (/crossbar/i.test(t) ? 'bar' : ''),
    blocker: get('BLOCKED \\(' + RA_PL),
    blocked: /blocked/i.test(t + ' ' + tt),
    fair: /fair catch/i.test(t),
    touchback: /touchback/i.test(t),
    // The ball carrier finished out of bounds. NFL text says "ob": "pushed ob at GB 16", "ran ob
    // at ATL 10" (2026-09-28, user: "when a play includes 'push ob' or 'ob' that means the ball
    // carrier finishes the play crossing out of bounds"). "out of bounds" on a kick ("punts 45
    // yards to NO 20, out of bounds") is the ball, not a runner, so it doesn't count here.
    oob: /\bob\b/i.test(t) || (/out of bounds/i.test(t) && !/\b(?:punts|kicks|kickoff)\b/i.test(t)),
    pushedOb: /\bpushed (?:ob|out of bounds)\b/i.test(t),
    td: /TOUCHDOWN/.test(t) || (p.scoring && /touchdown/i.test(tt)),
    safety: /SAFETY/.test(t) || /safety/i.test(tt),
    noPlay: /no play/i.test(t),
    declined: /declined/i.test(t),
    penTeam: pen ? sideOf(pen[1]) : null,
    penName: pen ? pen[2].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : '',
    kneel: /kneel/i.test(t),
    // "(No Huddle) M.Stafford spiked the ball to stop the clock." ESPN files it as a Pass Incompletion.
    spike: /\bspiked? the ball\b|\bspikes\b/i.test(t),
    spiker: get(RA_PL + '\\s+spike'),
    // Only a try is a try: a touchdown whose text carries "TWO-POINT CONVERSION ATTEMPT …" is still the
    // touchdown (raPatFrom stages the try as its own play). 2026-09-28 audit: three of those were drawn
    // as a two-point attempt from the 2 reading "Two-point no good", no touchdown at all.
    twoPt: /two[- ]point|2pt|conversion/i.test(tt + ' ' + (p.pat ? t : t.replace(RA_TRY_RE, ''))),
    firstDown: /1ST DOWN/i.test(t),
    onside: /onside/i.test(t),
    injured: raInjured(p.pat ? t : t.replace(RA_TRY_RE, ''), sideOf, who),
  };
}
// "ATL-J.Bates was injured during the play." One or more per play. "** Injury Update: ATL-J.Bates has
// returned to the game." on a later play is not an injury. On a touchdown, an injury written after
// the try ("TWO-POINT CONVERSION ATTEMPT. … ATTEMPT FAILS. CAR-D.Lewis was injured") belongs to the
// try, which raPatFrom stages as its own play.
const RA_TRY_RE = /\b(?:TWO-POINT CONVERSION ATTEMPT|[A-Z][\w.'’-]+ (?:extra point|kick attempt))\b[\s\S]*$/;
const RA_INJ_RE = /\b([A-Z]{2,4})-([A-Z][A-Za-z.'’-]*(?:\s(?:[A-Z][A-Za-z.'’-]*|III|II|IV))?)\s+was injured during the play/g;
function raInjured(text, sideOf, who) {
  const out = [];
  for (const m of String(text).matchAll(RA_INJ_RE)) {
    const team = sideOf(m[1]), w = who(null, m[2]);
    if (team && w && !out.some((o) => o.who.name === w.name)) out.push({ team, who: w });
  }
  return out;
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
  // What really happened, for a finished game (nflverse play-by-play and FTN charting, keyed by
  // ESPN play id; see raDetailLoad). Every field is optional: without one the play is staged from
  // its text as before. FTN's qb_location beats the text's formation tag, which ESPN leaves off
  // some shotgun snaps.
  const D = opts.detail !== undefined ? opts.detail || {} : raDetail(p);
  if (/^[USP]$/.test(D.qbl || '')) I.form = D.qbl === 'U' ? 'under' : D.qbl === 'P' ? 'pistol' : 'gun';
  else if (D.sg === 1 && I.form === 'under') I.form = 'gun';
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
  if (I.spike) kind = 'spike';
  const isPAT = /extra point|kick attempt|pat\b/i.test(p.typeText) || (kind === 'fg' && p.sH == null);
  let z0 = Z(p.sH);
  if (z0 == null) z0 = kind === 'kickoff' ? 35 : 25;
  // NFL tries: a kick is snapped from the 15 (a 33-yard kick), a two-point try from the 2.
  if (isPAT && !I.twoPt) z0 = 85;
  else if (I.twoPt && (p.pat || p.sH == null)) z0 = 98;       // (a TD whose text carries the try keeps its own spot)
  let zEnd = Z(p.eH);
  // The play's own end (the end spot less any penalty yards walked off afterwards).
  const zPlay = p.yards != null && p.penYards ? z0 + p.yards : zEnd ?? z0 + (p.yards || 0);
  // NFL hash marks are 70'9" apart (~23.58 yd from each sideline on a 53.33-yd field), so a hash
  // snap spot sits +/-3.08 yd from the center (26.665 - 23.58), not college's +/-6.67.
  // FTN's starting_hash (L / M / R, taken from the offense's side of the ball) puts the snap on
  // the hash it was really on.
  const x0 = D.hash && RA_HASH[D.hash] != null ? RA_HASH[D.hash] : opts.x0 ?? pick([-3.08, 0, 0, 3.08]);
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
  // Everyone stays a yard inside the sidelines, except a move marked `out`: a carrier going out of
  // bounds, who has to cross the line (and may drift up to 5 yd past it).
  const go = (a, t, x, z, e = 1, out = false) => {
    if (a.k.length === 1 && t > tS + 0.05) a.k.push([tS, a.k[0][1], a.k[0][2], 0]);   // set until the snap, then move
    if (t <= lastT(a)) t = lastT(a) + 0.04; a.k.push([t, out ? clamp(x, -RAX - 5, RAX + 5) : raX(x), clamp(z, -12, 112), e]); return t; };
  const hold = (a, t) => { if (t > lastT(a)) { const [x, z] = raPos(a, lastT(a)); a.k.push([t, x, z, 0]); } };
  const cut = (a, t) => { const [x, z] = raPos(a, t); a.k = a.k.filter((k) => k[0] < t); if (!a.k.length) a.k.push([0, x, z, 0]); a.k.push([t, x, z, 0]); };
  // Run to a point at a football speed; returns the arrival time.
  const run = (a, t0, x, z, v = 8, e = 0) => { hold(a, t0); const [ax, az] = raPos(a, t0); const t1 = Math.max(t0, lastT(a)) + Math.max(0.25, Math.hypot(x - ax, z - az) / v); go(a, t1, x, z, e); return t1; };
  const ballHold = (a, t0, t1) => sc.ball.push({ t0, t1, a });
  const ballFly = (t0, t1, from, to, apex, roll) => sc.ball.push({ t0, t1, from, to, apex, roll });
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
      const maxLead = Math.max(0.5, tE - Math.max(tS, sc.freeze ?? 0) - 0.2);
      let lead = clamp(Math.hypot(cx - xE, cz - zE) / 8.5, 0.5, maxLead);
      // Long enough from where he really is once he has chased the play: a returner who runs past
      // him leaves him yards behind, and a last run in that needs more than ~9.5 yd/s is cut short by
      // the speed cap (2026-09-28 audit: a punt's tackler 6.6 yd off the man he tackled).
      const saved = cand.k.map((k) => [...k]);
      for (let n = 0; n < 4; n++) {
        chaseUntil(cand, tE - lead);
        const [lx, lz] = raPos(cand, tE - lead), need = Math.hypot(lx - xE, lz - zE) / 9.5;
        if (need <= lead + 0.05 || lead >= maxLead) break;
        cand.k = saved.map((k) => [...k]); lead = Math.min(maxLead, need + 0.15);
      }
      cut(cand, tE - lead);
      const toward = Math.sign(cz - zE) || 1;
      // A flat-out last run in (easing 0) unless he's already on him: raBuild's speed cap allows an
      // easing's peak only 11 yd/s, so an eased approach from 8 yd away stopped yards short of the
      // man he tackles (2026-09-28 audit: up to 9 yd).
      go(cand, tE, xE + (i === 1 ? -0.8 : i === 2 ? 0.8 : R(-0.4, 0.4)), zE + toward * (0.7 + i * 0.3), Math.hypot(cx - xE, cz - zE) > 2.5 ? 0 : 3);
      if (i === 0 && carDown) cand.downAt = tE + 0.08;
      cand.labelAt = tE - 0.4;
    }
    if (carDown) car.downAt = tE;
    return chosen;
  };

  /* Formations */
  // Eleven a side, set the way the play text says. Offense: five linemen on the ball (center over
  // it, ~1.35-yd splits, three-point stances); the QB under center (1.2 yd), in the shotgun (5) or
  // the pistol (4, back behind him); the personnel from the formation: shotgun passes go 11, 10 or
  // empty; under-center snaps go 21 (I or offset), 12 or 22. Defense: four down linemen just off
  // the ball, LBs 4-5 deep, a corner over every wide receiver 5-7 off, two safeties 10-13 deep;
  // nickel against three receivers, dime against four or more.
  const scrimmage = () => {
    const form = kind === 'set' ? 'gun' : I.form;
    const passy = ['pass', 'incomplete', 'int', 'sack'].includes(kind);
    const r0 = rng();
    let [nWR, nTE, nB] = form !== 'under'
      ? passy ? (r0 < 0.62 ? [3, 1, 1] : r0 < 0.86 ? [4, 0, 1] : r0 < 0.94 ? [2, 2, 1] : [4, 0, 0]) : (r0 < 0.72 ? [3, 1, 1] : [2, 2, 1])
      : (r0 < 0.45 ? [2, 1, 2] : r0 < 0.8 ? [2, 2, 1] : r0 < 0.92 ? [1, 2, 2] : [3, 1, 1]);
    if (form === 'pistol' && nB === 0) [nWR, nB] = [4, 1];
    // FTN's count of backs (besides the QB) sets the backfield; the receivers make up the five
    // skill players (with no back, the fifth is the back split out wide, as the empty set above).
    if (D.bf != null && kind !== 'set') {
      nB = clamp(D.bf, 0, 2);
      const room = 5 - Math.max(nB, 1);
      nTE = Math.min(nTE, room - 1);
      nWR = room - nTE;
    }
    const teSide = rng() < 0.5 ? -1 : 1;
    const deep = (d) => Math.min(z0 + d, 109.3);                      // nobody lines up past the end line
    const oSet = (a, s) => { a.set = s; return a; };
    off.C = oSet(P('o', 'OL', x0, z0 - 0.6), 'snap');
    off.LG = oSet(P('o', 'OL', x0 - 1.35, z0 - 0.85), 'stance'); off.RG = oSet(P('o', 'OL', x0 + 1.35, z0 - 0.85), 'stance');
    off.LT = oSet(P('o', 'OL', x0 - 2.7, z0 - 0.95), 'stance'); off.RT = oSet(P('o', 'OL', x0 + 2.7, z0 - 0.95), 'stance');
    off.OL = [off.LT, off.LG, off.C, off.RG, off.RT];
    // Tight ends: inline beside a tackle, the second on the other side, a third as a wing.
    off.TEs = [];
    for (let i = 0; i < nTE; i++) {
      const s = i === 1 ? -teSide : teSide, wing = i === 2;
      off.TEs.push(oSet(P('o', 'TE', x0 + s * (wing ? 5.1 : 4.05), z0 - (wing ? 1.9 : 0.95)), wing ? 'ready' : 'stance'));
    }
    off.TE = off.TEs[0];
    // Receivers: the widest on each side inside the numbers, slots between them and the box.
    const strong = nTE ? -teSide : (rng() < 0.5 ? -1 : 1);             // the side with more receivers
    const sides = [];
    for (let i = 0; i < nWR; i++) sides.push(i === 0 ? strong : i === 1 ? -strong : i % 2 ? -strong : strong);
    const onSide = { '-1': 0, '1': 0 };
    off.WRs = sides.map((s) => {
      const n = onSide[s]++;
      const x = s * (n === 0 ? R(17, 20.5) : n === 1 ? R(9.5, 12) : 6.8);
      return oSet(P('o', 'WR', x0 * 0.4 + x, z0 - (n === 0 && s === strong ? 0.9 : 1.6)), 'ready');
    });
    const wide = (s) => off.WRs.filter((w) => Math.sign(w.k[0][1] - x0) === s).sort((a, b) => Math.abs(b.k[0][1]) - Math.abs(a.k[0][1]))[0];
    off.WL = wide(-1); off.WR = wide(1);
    off.SL = off.WRs.find((w) => w !== off.WL && w !== off.WR);
    // Backfield.
    if (form === 'under') off.QB = oSet(P('o', 'QB', x0, z0 - 1.2), 'qbUnder');
    else off.QB = oSet(P('o', 'QB', x0, z0 - (form === 'pistol' ? 4 : 5)), 'gun');
    off.FB = null;
    if (nB === 0) off.RB = oSet(P('o', 'RB', x0 + teSide * 7, z0 - 1.4), 'ready');          // empty: the back splits out
    else if (form === 'pistol') off.RB = oSet(P('o', 'RB', x0, z0 - 7), 'ready');
    else if (form !== 'under') off.RB = oSet(P('o', 'RB', x0 + (rng() < 0.5 ? -1 : 1) * 1.6, z0 - 5.1), 'ready');
    else {
      if (nB === 2) off.FB = oSet(P('o', 'FB', x0 + (rng() < 0.6 ? 0 : teSide * 1.5), z0 - 4.3), 'ready');
      off.RB = oSet(P('o', 'RB', x0, z0 - 7), 'ready');
    }
    // Two backs out of the shotgun or pistol (only FTN's count asks for it): the second beside the QB.
    if (nB === 2 && form !== 'under') { const rs = Math.sign(off.RB.k[0][1] - x0) || 1; off.FB = oSet(P('o', 'FB', x0 - rs * 1.6, z0 - (form === 'pistol' ? 4 : 5.1)), 'ready'); }
    off.rcv = [...off.WRs, ...off.TEs, ...(nB === 0 ? [off.RB] : [])];
    // Defense.
    const dSet = (a, s) => { a.set = s; return a; };
    const edge = Math.max(3.6, ...off.TEs.filter((t) => t.role === 'TE').map((t) => Math.abs(t.k[0][1] - x0) - 0.2));
    def.DL = [-(edge + 1), -1.25, 1.25, edge + 1].map((dx) => dSet(P('d', 'DL', x0 + dx, z0 + 1.05), 'stance'));
    const nRec = off.WRs.length + (nB === 0 ? 1 : 0);
    const nLB = nRec >= 4 ? 1 : nRec === 3 ? 2 : 3;
    def.LB = (nLB === 3 ? [-3.6, 0.3, 3.8] : nLB === 2 ? [-2.4, 2.4] : [0]).map((dx) => dSet(P('d', 'LB', x0 + dx, deep(R(4.2, 5))), 'ready'));
    // One defensive back per receiver, widest first, up to the 11th man; the rest are the safeties.
    def.man = new Map();
    const outs = [...off.WRs, ...(nB === 0 ? [off.RB] : [])].sort((a, b) => Math.abs(b.k[0][1] - x0) - Math.abs(a.k[0][1] - x0));
    const nCB = 11 - 4 - nLB - 2;
    outs.slice(0, nCB).forEach((w) => {
      const [wx] = w.k[0].slice(1), inside = -Math.sign(wx - x0) * 0.6;
      const wideOut = Math.abs(wx - x0) > 14;
      def.man.set(w, dSet(P('d', 'DB', wx + inside, deep(wideOut ? R(5, 7) : R(4.5, 5.5))), 'ready'));
    });
    for (let i = def.man.size; i < nCB; i++) def.LB.push(dSet(P('d', 'LB', x0 + (i % 2 ? -5 : 5), deep(5.5)), 'ready'));
    def.CL = def.man.get(off.WL); def.CR = def.man.get(off.WR); def.NB = off.SL ? def.man.get(off.SL) : null;
    def.S = [-1, 1].map((s) => dSet(P('d', 'DB', x0 + s * R(7, 9.5), deep(R(10.5, 12.5))), 'ready'));
    // FTN's box count (defenders in the box at the snap): safeties, then slot corners, walk down
    // into it, or linebackers widen out of it, until the count is the real one.
    if (D.box >= 4) {                                              // (FTN writes 0 on kicks)
      const inBox = (a) => { const [x, z] = raPos(a, 0); return Math.abs(x - x0) <= 5.5 && z - z0 <= 8; };
      const place = (a, x, z) => { a.k[0][1] = raX(x); a.k[0][2] = deep(z - z0); };
      let n = allDef().filter(inBox).length, guard = 0;
      while (n < D.box && guard++ < 6) {
        const s = def.S.shift() || [...def.man.values()].filter((cb) => !inBox(cb) && !def.LB.includes(cb)).sort((a, b) => Math.abs(raPos(a, 0)[0] - x0) - Math.abs(raPos(b, 0)[0] - x0))[0];
        if (!s) break;
        place(s, x0 + (raPos(s, 0)[0] > x0 ? 1 : -1) * R(2.5, 4.5), z0 + R(5.5, 7.5));
        if (!def.LB.includes(s)) def.LB.push(s);
        n++;
      }
      while (n > D.box && guard++ < 12) {
        const lb = def.LB.filter(inBox).sort((a, b) => Math.abs(raPos(b, 0)[0] - x0) - Math.abs(raPos(a, 0)[0] - x0))[0];
        if (!lb) break;
        place(lb, x0 + (raPos(lb, 0)[0] >= x0 ? 1 : -1) * R(7, 8.5), z0 + R(4.5, 6));
        n--;
      }
    }
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
    for (const w of off.rcv) {
      if (!w || skip.includes(w)) continue;
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
  // (On play action the short defenders bite: a step toward the line before they drop.)
  const drop = (list, tEnd, depth) => { for (const a of list) { const [x, z] = raPos(a, 0); go(a, tS + 0.4, x, z - 0.4); if (D.pa && depth < 10) go(a, tS + 0.85, x, Math.max(z0 + 1.5, z - 1.8)); go(a, tEnd, x + R(-3, 3), Math.max(z, z0 + depth + R(-2, 3)), 1); } };
  // The real pass rush (FTN: pass rushers and blitzers). Four linemen rush by default; blitzers come
  // from the linebackers, then the slot corner and the safeties, nearest the QB first; a three-man
  // rush drops the widest lineman into a short zone. Returns the blitzers, who then don't cover.
  const passRush = (qb, tUntil) => {
    if (D.rush == null && D.blitz == null) return [];
    const nBl = Math.max(D.blitz ?? 0, (D.rush ?? 4) - 4);
    const [qx, qz] = raPos(qb, tUntil);
    const pool = [...def.LB, def.NB, ...def.S].filter(Boolean).sort((a, b) => Math.hypot(raPos(a, 0)[0] - qx, raPos(a, 0)[1] - qz) - Math.hypot(raPos(b, 0)[0] - qx, raPos(b, 0)[1] - qz));
    const bl = pool.slice(0, nBl);
    bl.forEach((a, i) => { const [x, z] = raPos(a, 0); go(a, tS + 0.1, x, z - 0.3); go(a, tUntil - 0.1, qx + (x > qx ? 1 : -1) * (1 + i * 0.5), qz + 1, 0); });
    if (D.rush != null && D.rush < 4) {
      const wide = [...def.DL].sort((a, b) => Math.abs(raPos(b, 0)[0] - x0) - Math.abs(raPos(a, 0)[0] - x0)).slice(0, 4 - Math.max(D.rush, 2));
      for (const a of wide) { cut(a, tS + 0.5); const [x] = raPos(a, 0); go(a, tS + 1.6, x + (x > x0 ? 1.5 : -1.5), z0 + 5, 1); }
    }
    sc.blitz = bl;
    return bl;
  };

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
    for (const o of others) slinkOff(o, tE - 0.2, scorer.side === 'o' ? defT.id : offT.id);   // the team that gave up the score
    sc.tdAt = tE;
    sc.tdEnd = last + 3.5;
  };
  // The field-goal celebration. Everyone on the kicking unit runs to the kicker; three of them get
  // under him and lift him (a.hoist: onto their shoulders, two tosses in the air, down again, drawn in
  // raDraw), then they walk him a few yards toward their own sideline. The camera stays on them.
  const fgCelebrate = (kicker, tG) => {
    const mates = allOff().filter((a) => a !== kicker);
    hold(kicker, tG + 0.1);
    const [kx, kz] = raPos(kicker, tG + 0.1);
    kicker.acts = [...(kicker.acts || []), [tG + 0.1, tG + 1.4, 'cheer']];
    const carriers = nearest(mates, kx, kz, tG).slice(0, 3);
    let tIn = tG + 0.6;
    const off3 = [[-0.55, -0.35], [0.55, -0.35], [0, 0.45]];
    carriers.forEach((c, i) => { cut(c, Math.max(lastT(c), tG)); tIn = Math.max(tIn, run(c, Math.max(lastT(c), tG + 0.05), kx + off3[i][0], kz + off3[i][1], 7.5, 0)); });
    for (const m of mates) {
      if (carriers.includes(m)) continue;
      cut(m, Math.max(lastT(m), tG));
      const ang = R(0, Math.PI * 2), r = R(1.6, 3.6);
      const t1 = run(m, Math.max(lastT(m), tG + R(0.05, 0.4)), kx + Math.cos(ang) * r, kz + Math.sin(ang) * r, R(6.5, 8), 0);
      m.jumpAt = t1 + R(0, 0.5); m.cheer = true;
    }
    const tUp = tIn + 0.3, tosses = [tUp + 0.6, tUp + 1.5], tWalk = tUp + 2.2, tDown = tUp + 4.4;
    const own = (offT.id === ev.home.id ? 1 : -1) * (offHome ? -1 : 1);            // their sideline: home near, visitors far
    const cx = raX(kx + own * 5), cz = kz - 1;
    hold(kicker, tWalk); go(kicker, tDown - 0.3, cx, cz, 1);
    carriers.forEach((c, i) => { hold(c, tWalk); go(c, tDown - 0.3, cx + off3[i][0], cz + off3[i][1], 1); c.carrying = [tUp - 0.25, tDown]; });
    kicker.hoist = { t0: tUp, t1: tDown, tosses };
    kicker.labelTo = tDown + 0.6;
    sc.fgCheer = { kicker, carriers, tUp, tDown, tosses, own };
    sc.focus = { from: tG + 0.8, x: (kx + cx) / 2, z: kz };
    for (const d of allDef()) slinkOff(d, tG + 0.2, defT.id);
    return tDown + 1.4;
  };
  // Heads down: coast to a stop, stand a moment, then a slow walk off to their own sideline (home near,
  // visitors far), past it. Shared by a score against them and a field goal.
  const slinkOff = (o, tFrom, teamId) => {
    cut(o, Math.max(tFrom, lastT(o)));
    const t0 = lastT(o), [ox, oz] = raPos(o, t0), [px, pz] = raPos(o, Math.max(0, t0 - 0.2));
    const x1 = ox + (ox - px) * 2, z1 = oz + (oz - pz) * 2;                 // coast to a stop
    go(o, t0 + 0.7, x1, z1, 2);
    const side = (teamId === ev.home.id ? 1 : -1) * (offHome ? -1 : 1);
    const tx = side * (RAX + 4), tz = z1 + R(-5, 5);
    const walk = Math.hypot(tx - x1, tz - z1) / R(2.4, 3);                   // a slow walk
    o.k.push([t0 + 1.2 + R(0, 0.8), x1, z1, 0], [t0 + 2 + walk, tx, tz, 0]); // allowed past the sideline
    o.slink = true;
  };
  // The carrier's path already ends a step past the sideline (OOB_X). "pushed ob": the named
  // defender meets him there and shoves him out; he stays on his feet. "ran ob": he steps out on his
  // own and the defense pulls up short of him. Either way he drifts a few yards out, slowing.
  const outOfBounds = (car, tE, pool) => {
    const [xE, zE] = raPos(car, tE);
    const side = Math.sign(xE) || 1;
    // A defender named in the text is the one who got him there. "pushed ob": he meets him on the
    // line and follows through past it. "ran ob (B.Cisse)": he shadows him out, a stride off, no
    // contact. "ran ob" with no name: nobody near, the defense pulls up short.
    const named = I.pushedOb || I.tacklers.length > 0;
    let escort = null;
    if (named) {
      // He takes his angle early enough to get there even on a long gain. The approach is a
      // flat-out run (easing 0): raBuild's last pass caps speed at 11 yd/s ÷ the easing's peak, so a
      // long approach eased like a lunge was cut to half pace and he arrived yards short.
      const tLead = Math.max(tS + 0.3, tE - 3.2);
      escort = nearest(pool.filter((a) => a !== car), xE, zE, tLead)[0];
      if (escort) {
        who(escort, I.tacklers[0]);
        chaseUntil(escort, tLead);
        cut(escort, tLead);
        if (I.pushedOb) {
          go(escort, tE - 0.3, xE - side * 1.8, zE - 0.6, 0, true);
          go(escort, tE, xE - side * 0.6, zE + 0.5, 1, true);
        } else {
          // A stride behind him and just inside, off his own path, so there's no contact.
          go(escort, tE - 0.3, xE - side * 2.2, zE - 2.6, 0, true);
          go(escort, tE, xE - side * 0.9, zE - 1.7, 1, true);
        }
        if (I.pushedOb) go(escort, tE + 0.5, side * (RAX + 1.8), zE + 1.1, 2, true);
        escort.labelAt = tE - 0.4;
      }
    }
    converge(pool.filter((a) => a !== escort), tE - 0.9, xE - side * 4.5, zE - 1, tE + 0.4, 2, 6);  // the rest pull up short
    go(car, tE + 0.7, side * (RAX + 3.2), zE + 1.2, 2, true);
  };
  const finishCarry = (car, tE, tacklePool) => {
    if (I.td && zPlay >= 99) {
      banner(tE - 0.1, 'Touchdown', offT.name, 'o');
      celebrate(car, tE, allOff().filter((a) => a !== car), allDef());
      return;
    }
    if (I.oob) { outOfBounds(car, tE, tacklePool); return; }
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
    sc.refEnd = Math.max(sc.refEnd || 0, tOff);
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
  } else if (kind === 'spike') {
    // A spike (2026-09-28, user: "Stafford spiked the ball to stop the clock, but it was animated like
    // he thru an actual route, when it should be him stepping back and tossing the ball at the
    // ground"): the snap, one step back, the ball thrown straight into the turf in front of him. The
    // line fires out and stops; nobody runs a route; the whistle is on the spike.
    scrimmage();
    who(off.QB, I.passer || I.spiker);
    const under = I.form === 'under';
    const tHand = snapTo(off.QB, tS, under ? 0.08 : 0.3);
    const [qx, qz] = raPos(off.QB, 0);
    const tSpike = tHand + (under ? 0.45 : 0.3);
    go(off.QB, tSpike - 0.1, qx, qz - (under ? 0.9 : 0.4), 1);
    ballHold(off.QB, tHand, tSpike);
    off.QB.acts = [[tSpike - 0.22, tSpike, 'throw1'], [tSpike, tSpike + 0.35, 'throw2']];
    const [sx, sz] = raPos(off.QB, tSpike);
    const bounce = [sx + R(-0.6, 0.6), sz + 1.4, 0];
    ballFly(tSpike, tSpike + 0.12, [sx, sz, 2], bounce, 0);                        // straight down, just in front of him
    ballFly(tSpike + 0.12, tSpike + 0.7, bounce, [bounce[0] + R(-1.5, 1.5), sz + R(2.5, 4), 0], 0.8);  // one bounce, and it rolls
    for (const a of off.OL) { const [x, z] = raPos(a, 0); go(a, tS + 0.4, x, z - 0.5); }
    for (const a of def.DL) { const [x, z] = raPos(a, 0); go(a, tS + 0.4, x, z0 - 0.2); }
    for (const w of off.rcv) { if (!w) continue; const [x, z] = raPos(w, 0); go(w, tS + 0.6, x, z + R(0.8, 2)); }
    for (const a of allDef().filter((d) => !def.DL.includes(d))) { const [x, z] = raPos(a, 0); go(a, tS + 0.6, x, z - R(0, 0.8)); }
    banner(tSpike + 0.25, 'Spike', 'Clock stopped', 'o');
    sc.tEnd = tSpike + 0.2;
    T = tSpike + 2.2;
  } else if (kind === 'run' || kind === 'kneel') {
    scrimmage();
    const qbCarry = kind === 'kneel' || /scramble/.test(I.text) || (I.rusher && qbs.has(`${p.offId}:${I.rusher.num || I.rusher.name}`));
    const car = qbCarry ? off.QB : off.RB;
    who(car, I.rusher);
    const tHand = snapTo(off.QB, tS, I.form !== 'under' ? 0.3 : 0.08);
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
        const under = I.form === 'under', pistol = I.form === 'pistol';
        const mesh = [qx + side * 0.9, qz + (under ? -3 : pistol ? -0.8 : 0)];
        go(off.QB, tS + 0.45, qx + side * 0.4, qz + (under ? -2.5 : 0));
        t = go(car, tS + 0.55, mesh[0], mesh[1], 1);
        ballHold(off.QB, tHand, t); go(off.QB, tS + 1.6, qx - side * 3, qz - 1.2, 1);
      }
      ballHold(car, t, 99);
      const tHole = go(car, t + 0.55, holeX, z0 - (gain < 0 ? 1 : 0.1), 0);
      let tE;
      if (gain <= 0.5 && I.oob && !I.td) {
        // "right end pushed ob at DAL 4 for -1 yards": he bounces outside and is put over the sideline.
        const sd = dirSign || Math.sign(holeX - x0) || 1;
        tE = go(car, tHole + Math.abs(sd * OOB_X - holeX) / 7.5, sd * OOB_X, zStop, 0, true);
      } else if (gain <= 0.5) tE = go(car, tHole + 0.3 + Math.abs(gain) * 0.08, holeX + R(-1, 1), zStop, 2);
      else {
        const v = gain > 25 ? 9.3 : 8;
        const zF = I.td ? 101.5 : zStop;
        const xE = I.oob ? side * OOB_X : raX(holeX + (gain > 12 ? side * Math.min(14, gain * 0.3) : R(-2.5, 2.5)));
        const xM = holeX + (xE - holeX) * 0.35 + R(-1.5, 1.5), zM = z0 + (zF - z0) * 0.45;
        const tM = go(car, tHole + Math.hypot(xM - holeX, zM - z0) / v, xM, zM, 0);
        tE = go(car, tM + Math.hypot(xE - xM, zF - zM) / v, xE, zF, 0, I.oob && !I.td);   // (easing 0: see the catch below)
      }
      linePlay(false, side, null, Math.min(tE, tS + 2.2));
      for (const te of off.TEs) { const [tx, tz] = raPos(te, 0); go(te, tS + 0.5, tx, Math.max(tz, z0 - 0.2)); go(te, tS + 2, tx + side, z0 + 1.6); }
      if (off.FB && off.FB !== car) { const [fx, fz] = raPos(off.FB, 0); go(off.FB, tS + 0.5, fx + (holeX - fx) * 0.5, fz + 2); go(off.FB, tS + 1.1, holeX + side * 0.6, z0 + 0.8, 2); }
      // Receivers stalk-block the man over them.
      for (const [w, cb] of def.man) { const [wx] = raPos(w, 0); go(w, tS + 1.4, wx + R(-1, 1), z0 + R(4, 6)); const [cx] = raPos(cb, 0); go(cb, tS + 1.4, cx + R(-1, 1), z0 + R(5.5, 7.5)); }
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
    const gunSnap = I.form !== 'under';
    const tHand = snapTo(off.QB, tS, gunSnap ? 0.3 : 0.08);
    const [qx, qz] = raPos(off.QB, 0);
    // Play action (FTN): the QB turns and fakes the handoff to the back, who carries on into the
    // line, then sets up deeper; the throw comes about half a second later.
    const fake = D.pa && kind !== 'sack' && off.RB && !off.rcv.includes(off.RB) ? off.RB : null;
    if (fake) {
      const [bx, bz] = raPos(fake, 0), fs = Math.sign(bx - qx) || 1, under = I.form === 'under';
      go(off.QB, tS + 0.45, qx + fs * 0.4, under ? z0 - 2.5 : qz);
      go(fake, tS + 0.6, qx + fs * 0.9, (under ? z0 - 3 : qz) + 0.2, 1);
      go(off.QB, tS + 1.35, qx - fs * 0.3, under ? z0 - 7.5 : qz - 2.2, 2);
      go(fake, tS + 1.3, x0 + fs * 2.5, z0 - 0.4, 1);
      sc.fake = fake;
    } else go(off.QB, tS + (gunSnap ? 0.7 : 1.1), qx, gunSnap ? qz - 1.6 : z0 - 7, 2);
    // The backs stay in to block unless the ball goes to one of them.
    for (const bk of [off.RB, off.FB]) if (bk && bk !== fake && !off.rcv.includes(bk)) { const [bx, bz] = raPos(bk, 0); go(bk, tS + 0.6, bx + R(-1.2, 1.2), Math.max(bz + 0.8, raPos(off.QB, tS + 1)[1] + 1.2)); }
    ballHold(off.QB, tHand, 99);
    const deep = I.depth === 'deep';
    if (kind === 'sack') {
      const tSack = tS + R(2.2, 2.9);
      // Sacked where the text says. Deeper than his drop: he's driven back into it. Up near the line
      // ("sacked at NE 27 for 0 yards"): he climbs the pocket into it, at a pace the speed cap allows
      // (the old drop-then-lunge ended three yards behind the spot).
      const zS = Math.min(zFum ?? zPlay, z0 - 0.5), zDrop = raPos(off.QB, tS + 1)[1] - 0.6;
      go(off.QB, tSack - 0.7, qx + R(-2.5, 2.5), zS > zDrop ? Math.max(zDrop, zS - 3.5) : zDrop, 1);
      go(off.QB, tSack, raPos(off.QB, tSack - 0.7)[0] + R(-2, 2), zS, 0);
      linePlay(true, 0, off.QB, tSack - 0.4);
      const bl = passRush(off.QB, tSack - 0.2);
      decoys([], tSack + 0.5);
      cover([...def.man].filter(([, cb]) => !bl.includes(cb)).map(([w, cb]) => [cb, w]), tSack + 0.5);
      drop([...def.LB, ...def.S].filter((a) => !bl.includes(a)), tSack, 9);
      sc.ball.at(-1).t1 = 99;
      if (zFum != null) { banner(tSack - 0.1, 'Sack', '', 'd'); T = fumble(off.QB, tSack) + 2; }
      else {
        tackle(off.QB, tSack, [...def.DL, ...def.LB], I.tacklers);
        banner(tSack + 0.1, 'Sack', gainText(/loss of (\d+)/.test(I.text) ? -+/loss of (\d+)/.exec(I.text)[1] : p.yards ?? Math.round(zPlay - z0)), 'd');
        T = tSack + 2.2; sc.tEnd = tSack;
      }
    } else {
      // A screen goes quickly; play action takes the fake first.
      const tThrow = tS + (D.screen ? 1.05 : deep ? 2.35 : 1.55) + R(0, 0.35) + (fake ? 0.45 : 0);
      // A target this game has also run the ball is a back: the ball goes to the back out of the backfield,
      // caught near the line (most of the gain comes after the catch).
      const tgtBack = I.target && [off.RB, off.FB].find((b) => b && qbs.has(`rb:${p.offId}:${I.target.num || I.target.name}`));
      // nflverse's air yards put the catch (or the target, or the pick) where it really was; the rest
      // of a completion's gain is then yards after the catch. Without them it is a guess from the text.
      let zT = D.air != null ? clamp(z0 + D.air, -4, 109) : Z(kind === 'int' ? I.intH : kind === 'incomplete' ? I.thrownH : I.catchH)
        ?? z0 + (kind === 'pass' ? clamp((p.yards || 5) * (deep ? 0.85 : tgtBack ? 0.25 : 0.6), -3, 45) : deep ? R(22, 32) : R(6, 12));
      // An interception that ends in a touchback was caught (and downed) in the end zone.
      const intTB = kind === 'int' && I.touchback && !I.td;
      if (intTB) zT = clamp(Math.max(zT, 100.8), 100.8, 108.5);
      const lanes = { left: [-RAX + 4, x0 - 7], right: [x0 + 7, RAX - 4], middle: [x0 - 4, x0 + 4] };
      const lane = lanes[I.dir] || pick([lanes.left, lanes.right, lanes.middle]);
      const xT = raX(R(lane[0], lane[1]) * (zT - z0 < 2 && I.dir !== 'middle' ? 0.8 : 1));
      const cands = [...off.rcv, ...(zT - z0 < 4 ? [off.RB, off.FB].filter(Boolean) : [])];
      const rec = tgtBack || nearest(cands, xT, zT, 0)[0];
      who(rec, I.target);
      // Out of the pocket (FTN): he rolls toward the side he throws to.
      if (D.oop) go(off.QB, tThrow - 0.05, raX(x0 + (Math.sign(xT - x0) || 1) * R(5, 7.5)), raPos(off.QB, tS + 1.2)[1] + 0.5, 1);
      const [qtx, qtz] = raPos(off.QB, tThrow);
      // A throwaway (FTN) sails out of bounds past the man it was near.
      const xBall = D.ta && kind === 'incomplete' ? (Math.sign(xT) || 1) * (RAX + 4) : xT;
      const dist = Math.hypot(xBall - qtx, zT - qtz);
      const tCatch = tThrow + 0.3 + dist * 0.03;
      const [rx, rz] = raPos(rec, 0);
      if (rec === off.RB || rec === off.FB) { go(rec, tS + 0.6, rx + Math.sign(xT - rx || 1) * 2, rz + 0.5); }
      else go(rec, tS + (tCatch - tS) * 0.6, rx + (xT - rx) * 0.15, rz + (zT - rz) * 0.78, 0);
      go(rec, tCatch, xT, zT, 0);
      rec.labelAt = tThrow - 0.3;
      sc.ball.at(-1).t1 = tThrow;
      const apex = clamp(0.8 + dist * 0.07, 1, 7);
      ballFly(tThrow, tCatch, [qtx, qtz, 2], [xBall, zT, D.ta && kind === 'incomplete' ? 0.8 : 1.2], apex);
      linePlay(true, 0, off.QB, tThrow + 0.3);
      const bl = passRush(off.QB, tThrow + 0.1);
      // A screen (FTN): the linemen on his side let their men go and lead him upfield.
      if (D.screen) {
        const lead = [...off.OL].sort((a, b) => Math.abs(raPos(a, 0)[0] - xT) - Math.abs(raPos(b, 0)[0] - xT)).slice(0, 3);
        lead.forEach((a, i) => { cut(a, tThrow - 0.5); go(a, tCatch + 0.5, raX(xT + (i - 1) * 2.2), Math.max(zT, z0) + 2 + i, 0); });
      }
      // A hit on the QB (nflverse): the nearest rusher gets to him as he lets it go, and they both go down.
      if (D.hit && !D.oop) {
        const [hx, hz] = raPos(off.QB, tThrow);
        const hitter = nearest([...def.DL, ...bl], hx, hz, tThrow - 0.4)[0];
        if (hitter) {
          cut(hitter, tThrow - 0.4); go(hitter, tThrow + 0.25, hx + 0.4, hz + 0.6, 0);
          hitter.downAt = tThrow + 0.3; hitter.upAt = tThrow + 1.9;
          off.QB.downAt = tThrow + 0.3; off.QB.upAt = tThrow + 2.1;
          sc.qbHit = hitter;
        }
      }
      decoys([rec], tCatch + 0.8);
      const cbFor = def.man;
      // The throw (arm cocked, then the release) and the catch, hands up.
      off.QB.acts = [[tThrow - 0.38, tThrow - 0.02, 'throw1'], [tThrow - 0.02, tThrow + 0.32, 'throw2']];
      if (kind !== 'int') rec.acts = [[tCatch - 0.28, tCatch + 0.12, 'catch']];
      cover([...cbFor].filter(([w, cb]) => w !== rec && !bl.includes(cb)).map(([w, cb]) => [cb, w]), tCatch + 0.5);
      const shadow = [cbFor.get(rec), ...def.LB, ...def.S].find((a) => a && !bl.includes(a)) || def.LB[0];
      cover([[shadow, rec]], tCatch - 0.3);
      drop(def.LB.filter((a) => a !== shadow && !bl.includes(a)), tThrow + 0.3, 6);
      drop(def.S.filter((a) => a !== shadow && !bl.includes(a)), tThrow, 14);
      if (kind === 'incomplete') {
        const pbu = nearest(allDef(), xT, zT, tCatch)[0];
        const [bx0, bz0] = [xBall, zT];
        if (D.ta) {                                                   // out of bounds, nobody near it
          ballFly(tCatch, tCatch + 0.5, [bx0, bz0, 0.8], [bx0 + Math.sign(bx0) * 2, bz0 + 1.5, 0], 0.25);
        } else if (D.drop) {                                          // it hits his hands and falls at his feet
          cut(pbu, tCatch - 0.6); go(pbu, tCatch + 0.1, xT + R(-1.5, 1.5), zT + 1.8, 0);
          ballFly(tCatch, tCatch + 0.5, [xT, zT, 1.2], [xT + 0.6, zT + 0.5, 0], 0.6);
        } else {
          who(pbu, I.breakup);
          cut(pbu, tCatch - 0.6); go(pbu, tCatch - 0.02, xT + R(-0.8, 0.8), zT + 0.8, 0);
          if (I.breakup) pbu.labelAt = tCatch - 0.5;
          const fx = xT + (xT - qtx) / dist * 3, fz = zT + (zT - qtz) / dist * 3;
          ballFly(tCatch, tCatch + 0.4, [xT, zT, 1.2], [fx, fz, 0], 0.3);
          ballFly(tCatch + 0.4, tCatch + 0.8, [fx, fz, 0], [fx + (fx - xT) * 0.4, fz + (fz - zT) * 0.4, 0], 0.35);
        }
        converge([rec, pbu], tCatch + 0.05, xT, zT + 1.5, tCatch + 0.8, 0.5, 2, 5);
        if (I.noPlay) { flag(tCatch - 0.4, raX(xT + R(-3, 3)), zT - 2); banner(tCatch + 0.3, 'Flag', `${I.penTeam ? I.penTeam.abbr + ' · ' : ''}${I.penName || 'Penalty'}`, I.penTeam?.id === p.offId ? 'd' : 'o'); }
        // (In the offense's colour, like a completion: it is still the offense's play. 2026-09-28, user.)
        else banner(tCatch + 0.2, D.ta ? 'Thrown away' : D.drop ? 'Dropped' : 'Incomplete', I.target ? `Intended for ${I.target.last}` : '', 'o');
        sc.tEnd = tCatch + 0.8;
        T = walkOff(tCatch + 0.6, z0) + 1.8;
      } else if (kind === 'int') {
        const pick6 = I.td || (zEnd != null && zEnd <= 0);
        // (No slot receiver means no nickel: def.NB is null, and nearest() of a null crashed the whole
        // play — Medrano's pick six against two receivers, 2026-09-28 audit.)
        const hawk = nearest([def.CL, def.CR, def.NB, ...def.S, ...def.LB].filter(Boolean), xT, zT, tCatch)[0];
        who(hawk, I.interceptor);
        cut(hawk, tCatch - 1.1); go(hawk, tCatch, xT + R(-0.5, 0.5), zT + 0.6, 0);
        hawk.labelAt = tCatch - 0.4;
        sc.ball.push({ t0: tCatch, t1: 99, a: hawk });
        // 2026-09-28, user: "INTERCEPTED by Hufanga at DEN -1. Touchback. Our animation shows him
        // catching the ball in the endzone but then running it to the 20 … that cant have happened".
        // ESPN's end spot on a touchback is the 20 the ball comes out to, not where the play ended: he
        // takes a knee where he caught it and nobody chases him.
        if (intTB) {
          const tE = go(hawk, tCatch + 0.45, raX(xT + R(-0.4, 0.4)), zT + 0.3, 2);
          hawk.downAt = tE + 0.05;
          converge(allOff().filter((a) => a !== off.C), tCatch + 0.3, xT, zT - 4, tCatch + 1.8, 2, 9, 6);
          banner(tCatch + 0.1, 'Intercepted', I.interceptor ? I.interceptor.last : defT.name, 'd');
          banner(tE + 0.6, 'Touchback', defT.name, 'd');
          sc.intTB = true;
          T = tE + 2.6; sc.tEnd = tE;
        } else {
        const zR = pick6 ? -1.5 : zEnd ?? zT;
        // A return that ends "pushed ob" / "ran ob" finishes over the nearer sideline, as a run does.
        const retOob = I.oob && !pick6;
        const xR = retOob ? (Math.sign(xT) || 1) * OOB_X : raX(xT + R(-8, 8));
        const tE = retOob ? go(hawk, tCatch + 0.2 + Math.hypot(xR - xT, zR - zT) / 8.3, xR, zR, 0, true) : run(hawk, tCatch, xR, zR, zT - zR > 25 ? 9.3 : 8, 0);
        converge([rec], tCatch, xR, zR, tE, 1, 3, 8.5);
        converge(allOff().filter((a) => a !== rec && a !== off.C), tCatch + 0.3, xR, zR, tE, 2, 12, 8.3);
        converge(allDef().filter((a) => a !== hawk), tCatch + 0.2, xR, zR + 6, tE, 3, 10, 8);
        banner(tCatch + 0.1, 'Intercepted', I.interceptor ? `${I.interceptor.last}${pick6 ? '' : ''}` : defT.name, 'd');
        if (pick6) { sc.events.push({ t: tE, kind: 'banner', title: 'Pick six', sub: defT.name, side: 'd' }); celebrate(hawk, tE, allDef().filter((a) => a !== hawk), allOff()); }
        else if (retOob) outOfBounds(hawk, tE, allOff().filter((a) => a !== off.C));
        // Only the names after the pick are the return's tacklers: "INTERCEPTED by J.Wallace (K.Turner)"
        // credits K.Turner with the tip, and naming an offensive player after him stole the intended
        // receiver's label (2026-09-28 audit).
        else if (Math.abs(zR - zT) > 1) {
          const tail = (/INTERCEPTED by .*?\bat (?:[A-Z]{2,5} ?-?\d{1,2}|50)\b(.*)$/.exec(I.text) || [])[1] ?? I.text;
          tackle(hawk, tE, allOff().filter((a) => a !== off.C && a !== rec), I.tacklers.filter((w) => w.name !== I.interceptor?.name && tail.includes(w.name)));
        }
        T = tE + 2; sc.tEnd = tE;
        }
      } else {
        sc.ball.push({ t0: tCatch, t1: 99, a: rec });
        const zF = I.td ? 101.5 : zFum ?? zPlay;
        const yac = zF - zT;
        let tE = tCatch + 0.35;
        if (yac > 1) {
          const side = Math.sign(xT) || 1;
          const xE = I.oob ? side * OOB_X : raX(xT + (yac > 12 ? side * Math.min(10, yac * 0.3) : R(-3, 3)));
          // Easing 0 all the way: an eased run (the old easing 2 on a touchdown) was capped at 5.5 yd/s
          // and stopped short — a 48-yard TD with 18 after the catch ended at the 4 (2026-09-28 audit).
          tE = go(rec, tCatch + Math.hypot(xE - xT, yac) / (yac > 25 ? 9.2 : 8), xE, zF, 0, I.oob && !I.td);
        } else if (I.oob && !I.td) {
          // Caught and put straight out of bounds ("pushed ob … for 9 yards" with nothing after the
          // catch): he's taken over the nearer sideline where he caught it.
          const side = Math.sign(xT) || 1;
          tE = go(rec, tCatch + 0.3 + Math.abs(side * OOB_X - xT) / 7, side * OOB_X, zF, 0, true);
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
    const setP = (a, s) => { a.set = s; return a; };
    let zL = Z(I.landH);
    const yds = isFinite(I.kickYds) ? I.kickYds : punt ? 42 : 62;
    if (zL == null) zL = z0 + yds;
    // A kick that goes out of bounds ("punts 48 yards to ATL 11, Center-…, out of bounds") comes down
    // by a sideline and bounces over it (2026-09-28, user: "If a punt or kick goes out of bounds
    // animation should show that"). The runner's "ob" is a different thing (raParse's `oob`).
    const kOob = !I.returner && !I.touchback && /out of bounds/i.test(I.text);
    const oobSide = kOob ? (rng() < 0.5 ? -1 : 1) : 1;
    const xL = kOob ? oobSide * R(19, 23) : R(-9, 9);
    let K, tK, kickFrom, cov, ret;
    const blockers = [];
    if (punt) {
      // NFL spread punt: the long snapper and four linemen on the ball, three up-backs (the shield)
      // five yards deep, two gunners split wide, the punter 15 deep. Return team: six in the box,
      // two jammers on each gunner, the returner about 40 yards off the ball.
      off.C = setP(P('o', 'OL', x0, z0 - 0.6), 'snap');
      const line = [-2.8, -1.4, 1.4, 2.8].map((dx) => setP(P('o', 'OL', x0 + dx, z0 - 0.9), 'ready'));
      const shield = [-1.4, 0, 1.4].map((dx) => setP(P('o', 'RB', x0 + dx, z0 - 5.3), 'ready'));
      const gunners = [-1, 1].map((s) => setP(P('o', 'WR', s * R(20, 22.5), z0 - 0.9), 'ready'));
      K = setP(P('o', 'K', x0, z0 - 15), 'gun');
      cov = [...line, off.C, ...shield, ...gunners];
      // The snap (0.72 s over 15 yards), two steps, the drop from his hands to his foot, the kick.
      const tCatch = snapTo(K, tS, 0.72);
      go(K, tCatch + 0.4, x0 + 0.1, z0 - 14.2, 0);
      tK = go(K, tCatch + 1.0, x0 + 0.2, z0 - 13.3, 1);
      ballHold(K, tCatch, tK - 0.14);
      kickFrom = [x0 + 0.2, z0 - 12.75, 0.55];
      ballFly(tK - 0.14, tK, [x0 + 0.5, z0 - 12.9, 1.05], kickFrom, 0);
      K.acts = [[tK - 0.3, tK - 0.04, 'kick0'], [tK - 0.04, tK + 0.5, 'punt']];
      const box = [-3.4, -1.2, 1.2, 3.4].map((dx) => setP(P('d', 'DL', x0 + dx, z0 + 1.05), 'stance'));
      box.push(...[-2.6, 2.6].map((dx) => setP(P('d', 'LB', x0 + dx, z0 + 4.2), 'ready')));
      box.forEach((a, i) => { const [x] = raPos(a, 0); go(a, tS + 0.9, x0 + (x - x0) * 0.6, i < 4 ? z0 - 2.5 : z0 + 1); });
      // The jammers ride the gunners down the field.
      gunners.forEach((gn) => [-1, 1].forEach((s) => {
        const j = setP(P('d', 'DB', gn.k[0][1] + s * 1.1, z0 + 1.3), 'ready');
        blockers.push([j, gn, s]);
      }));
      ret = setP(P('d', 'RB', xL + R(-3, 3), clamp(z0 + 40 + R(-2, 2), z0 + 25, 108)), 'ready');
    } else {
      // NFL dynamic kickoff (2024 rule; a touchback comes out to the 35 since 2025). The kicker alone at
      // his 35, the ball on a tee; the other ten on the receiving team's 40, at least four each side;
      // the receiving team's front nine in the setup zone (their 35 to their 30), seven of them on the
      // 35; up to two returners in the landing zone (their goal line to their 20). Only the kicker may
      // move until the ball comes down or is touched in the landing zone.
      const zTee = z0, dz = z0 - 35;                                   // (a kick moved by a penalty moves the setup with it)
      sc.camZ = zTee + 10.5;                                            // before the kick: the kicker and the line he kicks over
      sc.kickoff = { tee: zTee, cover: 60 + dz, setup: [65 + dz, 70 + dz], landing: [80, 100], tbSpot: 65 };
      K = setP(P('o', 'K', -1.5, zTee - 5), 'stand');
      cov = [-21, -16.5, -12, -7.5, -3, 3, 7.5, 12, 16.5, 21].map((x) => setP(P('o', 'WR', x, 60 + dz), 'ready'));
      const front = [-18, -12, -6, 0, 6, 12, 18].map((x) => setP(P('d', 'LB', x + R(-1, 1), 65.4 + dz), 'ready'));
      const second = [-1, 1].map((s) => setP(P('d', 'DB', s * R(8, 11), R(67.5, 69.2) + dz), 'ready'));
      ret = setP(P('d', 'RB', xL, clamp(zL + 0.4, 80.5, 108.5)), 'ready');
      const ret2 = setP(P('d', 'RB', raX(xL + (xL > 0 ? -1 : 1) * R(7, 10)), clamp(Math.min(zL, 100) - R(5, 8), 80.5, 99)), 'ready');
      ballFly(0, tS + 1.25, [0, zTee, 0.2], [0, zTee, 0.2], 0, 'tee');            // on the tee
      go(K, tS + 0.55, -1, zTee - 2.8, 3);                               // the approach: a jog, then the last strides
      tK = go(K, tS + 1.25, -0.35, zTee - 0.45, 0);
      K.acts = [[tK - 0.22, tK - 0.03, 'kick0'], [tK - 0.03, tK + 0.45, 'kick']];
      kickFrom = [0, zTee, 0.2];
      go(K, tK + 1.3, -0.6, zTee + 3.5, 2);                              // his follow-through
      front.concat(second, [ret2]).forEach((a) => blockers.push([a]));
    }
    who(K, I.kicker);
    K.labelAt = 0;
    who(ret, I.returner);
    const hang = (punt ? 0.9 : 0.8) + Math.abs(zL - kickFrom[1]) * (punt ? 0.055 : 0.05);
    const apex = punt ? 12 + yds * 0.2 : 16 + yds * 0.12;
    const tL = tK + hang;
    if (!punt) sc.freeze = tL;                                         // nobody else moves until it comes down
    const tb = I.touchback || zL >= 100;
    // Coverage sprints to where the return will end (or to the landing spot); gunners get there first.
    const meet = I.returner && zEnd != null && !I.fair && zEnd < zL ? zEnd : zL;
    if (punt) {
      cov.forEach((a) => { const fast = a.role === 'WR'; run(a, fast ? tS + 0.15 : tK - 0.2, raX(xL + R(-13, 13)), Math.min(meet - (fast ? R(1, 5) : R(4, 12)), 99), fast ? 9 : 8, 0); });
      for (const [j, gn, s] of blockers) for (let t = tS + 0.6; t < tL + 0.2; t += 0.5) { const [gx, gz] = raPos(gn, t - 0.15); go(j, t, gx + s * 0.9, gz + 0.8, 0); }
      sc.actors.filter((a) => a.side === 'd' && a !== ret && !blockers.some((b) => b[0] === a)).forEach((a) => { hold(a, tK + 0.2); const [x, z] = raPos(a, tK + 0.2); go(a, tL, x * 0.7 + xL * 0.3 + R(-3, 3), z + (zL - z) * 0.45, 1); });
    } else {
      // At the landing the two lines meet: eight of the coverage are picked up by the front nine,
      // the two nearest the ball get through to chase.
      const free = [...cov].sort((a, b) => Math.abs(a.k[0][1] - xL) - Math.abs(b.k[0][1] - xL)).slice(0, 2);
      const pool = blockers.map((b) => b[0]).filter((a) => a.role !== 'RB');
      for (const c of cov) {
        if (free.includes(c)) { run(c, tL, raX(xL + R(-4, 4)), Math.min(meet - R(2, 5), 99), 9, 0); continue; }
        const [cx, cz] = c.k[0].slice(1);
        const b = nearest(pool, cx, cz, tL)[0];
        pool.splice(pool.indexOf(b), 1);
        const mx = cx + (xL - cx) * 0.15 + R(-1, 1), mz = cz + R(2.5, 4.5);
        run(c, tL, mx, mz, 7.5, 3);
        run(b, tL, mx + R(-0.3, 0.3), mz + 1.05, 6, 3);
        c.acts = b.acts = [[tL + 0.5, 1e9, 'block']];
      }
      for (const b of pool) run(b, tL, raX(xL + R(-5, 5)), Math.max(meet, Math.min(zL - 8, 99)), 6, 3);
    }
    ballFly(tK, tL, kickFrom, tb && !I.returner ? [xL, Math.min(zL, 106), 0.4] : [xL, zL, 1.3], apex, punt ? 'spiral' : 'end');
    const landSeg = sc.ball[sc.ball.length - 1];
    let caught = false;
    const tSet = punt ? go(ret, Math.max(tS + 1, tL - 0.9), xL, zL + 0.4, 1) : lastT(ret);
    ret.labelAt = tK;
    let tE = tL + 0.5;
    // With a penalty on the return, the text's spot is where he was tackled; zEnd is where the ball
    // went after the flag (2026-09-28 audit: a return run 10 yards past its tackler).
    const retZ = /PENALTY/.test(I.text) && I.retH != null ? Z(I.retH) : zEnd;
    const tFree = punt ? tL - 0.5 : tL;
    if (tb && !(I.returner && retZ != null && retZ < 100)) {
      if (I.returner && !punt) {
        // Caught in the end zone and taken down to a knee; the ball comes out to the 35.
        sc.ball.push({ t0: tL, t1: tL + 1.4, a: ret });
        ret.acts = [[tL + 0.35, tL + 1.6, 'hold']];
      } else {
        const bz = Math.min(zL + 4, 108);
        ballFly(tL, tL + 0.6, [xL, zL, 0.4], [xL + 1, bz, 0], 0.8);
      }
      tE = tL + 1.4;
      sc.noChase = true;                                               // a dead ball: everyone eases up
      // (The ball stays where it died; the next snap is set at the 20 or the 35. It used to be put
      // there at the whistle, a 25-to-40-yard jump across the screen: 2026-09-28 audit.)
      sc.spotZ = punt ? 80 : 65;                                       // the receiving team's 20 (punt) or 35 (kickoff)
      banner(tL - 0.2, 'Touchback', `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, 'o');
    } else if (I.fair) {
      caught = true;
      hold(ret, tL + 0.9);                                             // he stands where he caught it
      sc.ball.push({ t0: tL, t1: 99, a: ret });
      converge(cov, tFree, xL, zL, tL + 0.4 + (punt ? 0 : 0.6), 2.5, 6);
      banner(tL + 0.1, 'Fair catch', `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, 'o');
    } else if (I.returner && retZ != null) {
      caught = true;
      sc.ball.push({ t0: tL, t1: 99, a: ret });
      ret.acts = [[tL - 0.3, tL + 0.1, 'catch']];
      hold(ret, tL);                                                   // he waits for it, then goes
      const retTD = I.td;
      const zR = retTD ? -1.5 : retZ;
      // A return that ends "pushed ob" / "ran ob" finishes over the nearer sideline.
      const xR = I.oob && !retTD ? (Math.sign(xL) || 1) * OOB_X : raX(xL + R(-10, 10));
      const xM = raX(xL + (xR - xL) * 0.4 + R(-4, 4)), zM = zL + (zR - zL) * 0.4;
      const tM = go(ret, tL + 0.2 + Math.hypot(xM - xL, zM - zL) / 8.3, xM, zM, 0);
      tE = go(ret, tM + Math.hypot(xR - xM, zR - zM) / 8.6, xR, zR, retTD ? 2 : 0, I.oob && !retTD);
      if (retTD) { banner(tE, 'Touchdown', `${defT.name} return`, 'd'); celebrate(ret, tE, sc.actors.filter((a) => a.side === 'd' && a !== ret), cov); }
      else if (I.oob) {
        outOfBounds(ret, tE, cov);
        banner(tE + 0.1, `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, `${I.returner.last} returns ${Math.round(Math.abs(zL - zR))}`, 'd');
      } else {
        tackle(ret, tE, cov, I.tacklers);
        converge(cov.filter((a) => !a.labelAt && !a.acts), Math.max(tFree, tE - 0.6), xR, zR, tE + 0.5, 2, 6);
        banner(tE + 0.1, `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, `${I.returner.last} returns ${Math.round(Math.abs(zL - zR))}`, 'd');
      }
    } else if (kOob) {
      // Down by the sideline, one bounce, over it: the next snap is where it crossed.
      // Where the text lands it is where it went out ("kicks 61 yards … to SEA 4, out of bounds"); the
      // next snap can be somewhere else entirely (a kickoff out of bounds is spotted at the 40).
      const zD = clamp(zL, 1, 99);
      const xO = oobSide * (RAX + 3);
      ballFly(tL, tL + 0.7, [xL, zL, 1.3], [oobSide * (RAX - 1), zD, 0], 0.9);
      ballFly(tL + 0.7, tL + 1.2, [oobSide * (RAX - 1), zD, 0], [xO, zD + R(-1, 1), 0], 0.5);
      converge(cov, Math.max(tFree, tL - 0.4), oobSide * (RAX - 3), zD, tL + 1.2, 1, 4);
      sc.kickOob = { side: oobSide, zD, tOut: tL + 0.95 };
      banner(tL + 0.9, `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, 'Out of bounds', 'o');
      tE = tL + 1.2;
    } else {
      const zD = retZ != null ? Math.min(retZ, 99) : zL;
      ballFly(tL, tL + 0.8, [xL, zL, 1.3], [xL + R(-2, 2), zD, 0], 0.9);
      converge(cov, Math.max(tFree, tL - 0.4), xL, zD, tL + 0.9, 1, 4);
      banner(tL + 0.4, `${punt ? 'Punt' : 'Kickoff'} · ${yds} yds`, /downed/i.test(I.text) ? 'Downed' : /out of bounds/i.test(I.text) ? 'Out of bounds' : '', 'o');
      tE = tL + 1;
    }
    hold(ret, tSet);
    // A caught kick (a fair catch, or a return) comes down on the returner wherever his legs got him,
    // not on the text's landing spot a step away (2026-09-28, user: "if its a fair catch, ball should
    // always land on the returner").
    if (caught) sc.catchOn = { seg: landSeg, a: ret, t: tL };            // aimed at him last of all, below
    for (const a of sc.actors) if (a.acts?.[0]?.[2] === 'block') a.acts[0][1] = tE;
    K.labelTo = tK + 1.2;
    sc.kick = { tK, tL };
    T = tE + 2; sc.tEnd = tE;
  } else if (kind === 'fg') {
    // Field goal / try unit: the long snapper and six more on the line, a wing outside each end, the
    // holder kneeling where the text's distance puts the kick (a 44-yarder snapped at the 26 is held
    // 44 − 10 − 26 = 8 yards back; a try, 33 − 10 − 15 = 8), the kicker two steps back and two to the
    // side. Snap, catch, place, approach, swing: the ball leaves his foot about 1.3 s after the snap.
    const setP = (a, s) => { a.set = s; return a; };
    const hd = clamp(isFinite(I.fgYds) && !isPAT ? I.fgYds - 10 - (100 - z0) : 8, 6.5, 8.5);
    const zHold = z0 - hd;
    off.C = setP(P('o', 'OL', x0, z0 - 0.6), 'snap');
    const line = [-3.9, -2.6, -1.3, 1.3, 2.6, 3.9].map((dx) => setP(P('o', 'OL', x0 + dx, z0 - 0.9), 'stance'));
    const wings = [-1, 1].map((s) => setP(P('o', 'TE', x0 + s * 5, z0 - 1.9), 'ready'));
    const holder = setP(P('o', 'QB', x0 - 0.55, zHold - 0.3), 'hold');
    const K = setP(P('o', 'K', x0 - 2.2, zHold - 3.1), 'stand');
    who(K, I.kicker); K.labelAt = 0;
    const rush = [-4.6, -3.3, -2, -0.7, 0.7, 2, 3.3, 4.6].map((dx) => setP(P('d', 'DL', x0 + dx, z0 + 1.05), 'stance'));
    rush.push(setP(P('d', 'LB', x0 + R(-1, 1), z0 + 3.4), 'ready'));
    [-1, 1].forEach((s) => setP(P('d', 'DB', x0 + s * R(8, 10), Math.min(z0 + 8, 109)), 'ready'));
    ballHold(off.C, 0, tS);
    const tCatch = tS + 0.38, tPlace = tCatch + 0.22;
    ballFly(tS, tCatch, [x0, z0 - 0.45, 0.3], [x0, zHold + 0.3, 0.85], 0.12);
    ballFly(tCatch, tPlace, [x0, zHold + 0.3, 0.85], [x0, zHold, 0.28], 0);
    go(K, tS + 0.55, x0 - 1.5, zHold - 2.1, 3);
    const tK = go(K, tS + 1.28, x0 - 0.45, zHold - 0.5, 0);
    ballFly(tPlace, tK, [x0, zHold, 0.28], [x0, zHold, 0.28], 0, 'tee');
    K.acts = [[tK - 0.24, tK - 0.03, 'kick0'], [tK - 0.03, tK + 0.5, 'kick']];
    holder.acts = [[0, tCatch, 'hold'], [tCatch, tK + 0.3, 'hold2'], [tK + 0.3, tK + 1.1, 'hold']];
    for (const a of [...line, ...wings, off.C]) { const [x, z] = raPos(a, 0); go(a, tS + 0.4, x, z - 0.5); go(a, tK + 1, x, z - 1); }
    rush.forEach((a) => { const [x] = raPos(a, 0); go(a, tK - 0.1, x * 0.8 + x0 * 0.2, z0 - 1, 1); });
    const dist = RA_POST - zHold;
    const flight = 0.9 + dist * 0.024;
    const kick0 = [x0, zHold, 0.28];
    const apexK = 4 + dist * 0.09;
    const yd = isFinite(I.fgYds) ? I.fgYds : Math.round(dist);
    if (I.blocked) {
      const bl = nearest(rush, x0, zHold, tK)[0];
      who(bl, I.blocker); bl.labelAt = tK - 0.2;
      const bx = x0 + R(-0.4, 0.4), bz = zHold + 1.6;
      cut(bl, tK - 0.5); go(bl, tK + 0.1, bx, bz + 0.3, 3);
      bl.acts = [[tK - 0.2, tK + 0.45, 'catch']];
      const tB = tK + 0.12;
      ballFly(tK, tB, kick0, [bx, bz - 0.2, 2.3], 0.2, 'end');
      ballFly(tB, tB + 0.9, [bx, bz - 0.2, 2.3], [x0 + R(-5, 5), zHold - R(1, 6), 0], 1.2, 'end');
      banner(tB + 0.1, 'Blocked', `${isPAT ? 'Extra point' : `${yd}-yd field goal`}`, 'd');
      T = tB + 2.6; sc.tEnd = tB + 0.9;
      sc.kick = { tK, tL: tB };
    } else {
      // Good: over the 10-ft crossbar between the uprights (18'6" apart) at the end line. The misses
      // follow the text: wide left/right, short, off an upright or the crossbar.
      let xT = x0 * 0.15 + R(-1.2, 1.2), hT = clamp(2.2 + dist * 0.12, 4.5, 9) + R(0, 1.5);
      let after;
      if (!I.good && (I.upright === 'left' || I.upright === 'right')) {
        xT = (I.upright === 'left' ? -1 : 1) * RA_UPRIGHT; hT = R(5, 8);
        after = [[xT * 0.7, RA_POST - R(4, 7), 0], 1.4];
      } else if (!I.good && I.upright === 'bar') {
        xT = R(-1, 1); hT = RA_BAR;
        after = [[xT, RA_POST - R(2, 4), 0], 0.8];
      } else if (!I.good && I.short) {
        hT = 0; xT = R(-2, 2);
      } else if (!I.good) {
        const s = I.wide ? (I.wide === 'left' ? -1 : 1) : (rng() < 0.5 ? -1 : 1);
        xT = s * R(4.3, 6.5);
      }
      if (hT === 0) {                                                  // short: it comes down in the end zone
        const zS = RA_POST - R(2, 5);
        ballFly(tK, tK + flight, kick0, [xT, zS, 0], apexK, 'end');
        ballFly(tK + flight, tK + flight + 0.5, [xT, zS, 0], [xT, zS + 1.5, 0], 0.3, 'end');
      } else {
        ballFly(tK, tK + flight, kick0, [xT, RA_POST, hT], apexK, 'end');
        if (after) ballFly(tK + flight, tK + flight + 0.7, [xT, RA_POST, hT], ...after, 'end');
        else ballFly(tK + flight, tK + flight + 0.55, [xT, RA_POST, hT], [xT * 1.1, 114, Math.max(0, hT - 4)], 0.5, 'end');
      }
      banner(tK + flight, I.good ? (isPAT ? 'Extra point good' : 'Field goal good') : (isPAT ? 'Extra point no good' : 'No good'), isPAT ? offT.name : `${yd} yards`, I.good ? 'o' : 'd');
      K.labelTo = tK + flight + 1.5;
      sc.kick = { tK, tL: tK + flight };
      T = tK + flight + 2.2; sc.tEnd = tK + flight;
      // A field goal (not a routine try): the kicking team mobs the kicker, hoists him onto their
      // shoulders, tosses him up twice and carries him toward their sideline, Rudy-style; the defense
      // slinks off (2026-09-28, user: "after a field goal the kicking team should celebrate and lift
      // the kicker up and toss him in the air like rudy … and the defense should slink off the field").
      if (I.good && !isPAT) T = Math.max(T, fgCelebrate(K, tK + flight));
    }
    sc.noChase = true;                                                 // after a kick nobody chases the ball into the end zone
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
  for (const a of sc.noChase ? [] : sc.actors) {
    if (a.downAt != null || a.side === 'r') continue;
    hold(a, tS);                                                    // nobody moves before the snap
    if (sc.freeze) hold(a, sc.freeze);                              // (a kickoff: nor before the ball comes down)
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
      const lo = Math.max(t0, tS + 0.2, sc.freeze ?? 0), hi = Math.min(t1 - 0.05, tEnd, a.downAt ?? Infinity);
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
  // An injury ("ATL-J.Bates was injured during the play."): only after the result is on screen and
  // any flag has been walked off. The man goes down where the play ended and stays down; a few
  // teammates take a knee around him and anyone standing over him backs away; two trainers jog out
  // from his team's sideline (home near, visitors far) with a stretcher, set it down beside him,
  // load him and walk him off, his name over him. The banners and sc.tEnd (the gate's result moment)
  // are not touched; only the scene's end, sc.T, moves out to cover the carry-off.
  if (I.injured?.length && kind !== 'set') {
    if (sc.tEnd == null) sc.tEnd = T - 1.5;
    const tRes = sc.tEnd;
    let tStart = Math.max(tRes + 1.2, (sc.refEnd ?? 0) + 0.3);
    if (sc.tdAt != null) tStart = Math.max(tStart, sc.tdAt + 3.5);
    const crews = [], hurt = new Set();
    for (const [n, inj] of I.injured.slice(0, 2).entries()) {
      const side = inj.team.id === offT.id ? 'o' : inj.team.id === defT.id ? 'd' : null;
      if (!side) continue;
      const mates = sc.actors.filter((m) => m.side === side && !hurt.has(m));
      const bb = raBall(sc, tRes);
      // The man himself if the play already has him (a tackler, the carrier, the target), otherwise
      // the nearest unnamed teammate to where the ball ended up, who takes his name.
      let a = mates.find((m) => m.who && m.who.name === inj.who.name) || mates.find((m) => m.who && m.who.last === inj.who.last);
      if (!a) a = nearest(mates.filter((m) => !m.who && m.role !== 'K'), bb.x, bb.z, tRes)[0];
      if (!a) continue;
      hurt.add(a);
      a.who = inj.who;
      const tDown = a.downAt != null && a.downAt <= tRes ? a.downAt : tRes;
      const [xi, zi] = raPos(a, tDown);
      cut(a, tDown);
      a.downAt = tDown; a.injured = true; a.gone = true; a.danceAt = a.jumpAt = null;
      // The ball doesn't leave with him.
      if (raBall(sc, tStart).held === a) sc.ball.push({ t0: tStart - 0.6, t1: 1e9, from: [xi, zi, 0.15], to: [xi, zi, 0.15], apex: 0 });
      const home = inj.team.id === ev.home.id;
      const sgn = (home ? 1 : -1) * (offHome ? -1 : 1);               // his sideline: home near, visitors far
      const xSide = sgn * (RAX + 3), xArr = xi + sgn * 1.25, xOut = sgn * (RAX + 3.6);
      const tIn = tStart + n * 0.7;
      const tArr = tIn + Math.abs(xSide - xArr) / 6;                    // a jog with the stretcher
      const tLoad = tArr + 1.5, tUp = tLoad + 0.7;
      const tOff = tUp + Math.abs(xOut - xArr) / 4.2;                   // a brisk walk off
      const crewPath = (dz) => [[0, xSide, zi + dz, 0], [tIn, xSide, zi + dz, 0], [tArr, xArr, zi + dz, 2], [tUp, xArr, zi + dz, 0], [tOff, xOut, zi + dz, 0]];
      const str = { side: 'm', role: 'STR', showFrom: tIn, k: crewPath(0), hk: [[0, 0.8], [tArr, 0.8], [tArr + 0.35, 0.05], [tLoad + 0.2, 0.05], [tUp, 0.8]] };
      const medics = [-1.45, 1.45].map((dz, i) => ({ side: 'm', role: 'MED', idx: 900 + n * 2 + i, showFrom: tIn, str, k: crewPath(dz), acts: [[tArr + 0.35, tLoad + 0.1, 'hold']] }));
      sc.actors.push(str, ...medics);
      a.k.push([tLoad - 0.45, xi, zi, 0], [tLoad, xArr, zi, 2], [tUp, xArr, zi, 0], [tOff, xOut, zi, 0]);
      a.onStr = { str, from: tLoad - 0.2 };
      a.injTag = [tLoad - 0.2, tOff + 0.8];
      crews.push({ a, medics, str, tDown, tIn, tArr, tLoad, tUp, tOff, xi, zi, xSide, xOut, side });
      T = Math.max(T, tOff + 1);
    }
    if (crews.length) {
      const tAll = Math.max(...crews.map((c) => c.tUp));
      // Anyone else still on the ground gets up.
      for (const a of sc.actors) if (a.downAt != null && !a.injured) a.upAt = tRes + R(1.2, 2.2);
      for (const c of crews) {
        const t0 = tRes + 0.7;
        const mates = nearest(sc.actors.filter((m) => m.side === c.side && !m.injured && m.role !== 'K'), c.xi, c.zi, t0).slice(0, 3);
        mates.forEach((m, i) => {                                      // a few teammates kneel beside him
          const ang = Math.PI * (0.35 + i * 0.55) * (c.xSide > 0 ? -1 : 1), tx = c.xi + Math.cos(ang) * 2.4, tz = c.zi + Math.sin(ang) * 2.2 - (i === 1 ? 0.8 : 0);
          const tFrom = Math.max(lastT(m), t0);
          hold(m, tFrom);
          const tA = go(m, tFrom + Math.max(0.6, Math.hypot(tx - raPos(m, tFrom)[0], tz - raPos(m, tFrom)[1]) / 2.5), tx, tz, 2);
          m.acts = [...(m.acts || []).filter((q) => q[1] <= tA), [tA + 0.2, tAll, 'hold']];
        });
        for (const m of sc.actors) {                                   // everyone else gives him room
          if ((m.side !== 'o' && m.side !== 'd') || m.injured || mates.includes(m)) continue;
          const tFrom = Math.max(lastT(m), t0), [mx, mz] = raPos(m, tFrom), d = Math.hypot(mx - c.xi, mz - c.zi);
          if (d > 5.5) continue;
          const ux = (mx - c.xi) / (d || 1), uz = (mz - c.zi) / (d || 1) || 1;
          hold(m, tFrom);
          go(m, tFrom + 2.2, c.xi + ux * R(6, 8), c.zi + uz * R(5, 7), 2);
        }
      }
      sc.injury = { crews, tStart, focus: (t) => { const c = crews.find((q) => t < q.tOff + 0.5) || crews[crews.length - 1]; const [x, z] = raPos(c.str, t); return { x: x * 0.7 + c.xi * 0.3, z }; } };
    }
  }
  // Pre-snap motion (FTN): the slot (else a wide receiver) starts five yards inside his spot and
  // goes in motion out to it in the second before the snap; the man over him follows. Done last so
  // every route above is scripted from where he really is at the snap.
  if (D.mot && off.WRs?.length && sc.tS < 1e8) {
    const w = off.SL || off.WR || off.WL, cb = def.man?.get(w);
    const dx = -(Math.sign(w.k[0][1] - x0) || 1) * 5;
    for (const a of [w, cb].filter(Boolean)) {
      const f = a.k[0];
      a.k = [[0, f[1] + dx, f[2], 0], [tS - 0.95, f[1] + dx, f[2], 0], [tS - 0.1, f[1], f[2], 0], ...a.k.slice(1).filter((k) => k[0] >= tS - 0.1)];
    }
    sc.motion = w;
  }
  sc.detail = D;
  // Out of the huddle: every player starts in his huddle spot, jogs to his place in the formation,
  // and the line gets set before the snap.
  if (opts.from && sc.tS >= 4) {
    const prev = opts.from, tp = opts.fromT ?? prev.T;
    const flip = prev.offHome === offHome ? 1 : -1;
    const toHere = (a) => { const [px, pz] = raPos(a, tp); const H = prev.offHome ? pz : 100 - pz; return [px * flip, offHome ? H : 100 - H]; };
    const teamOf = (a, sce) => (a.side === 'o' ? sce.offT.id : a.side === 'd' ? sce.defT.id : null);
    const pools = new Map();
    for (const a of prev.actors) { const tm = teamOf(a, prev); if (tm == null || a.side === 'r' || a.gone) continue; if (!pools.has(tm)) pools.set(tm, []); pools.get(tm).push(a); }
    const near = offHome ? -1 : 1;                                     // toward the near (home) sideline
    const tSet = sc.tS - 0.9;
    if (prev.hud) {                                                    // still in the huddles for half a second
      const mv = ([x, z]) => { const H = prev.offHome ? z : 100 - z; return [x * flip, offHome ? H : 100 - H]; };
      const same = prev.offHome === offHome && prev.offT.id === offT.id;
      sc.hud = same ? { o: mv(prev.hud.o), d: mv(prev.hud.d) } : { o: mv(prev.hud.d), d: mv(prev.hud.o) };
      sc.hudUntil = 0.5;
    }
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
  // (After the speed cap above, which can shorten the returner's run to his spot.)
  if (sc.catchOn) { const { seg, a, t } = sc.catchOn; const [rx, rz] = raPos(a, t); seg.to = [rx, rz, seg.to[2]]; }
  // Every ball in the air starts from the hands it leaves and ends in the hands that take it, where
  // those players really are once the speed cap has had its say: a catch, a snap, a pick. Aimed at the
  // scripted spot instead, the ball jumped 3 to 9 yards the frame it was caught (2026-09-28 audit).
  const heldAt = (a) => { const [x, z] = raPos(a.a, a.t0); return [x + 0.35, z + 0.25]; };
  for (const seg of sc.ball) {
    if (!seg.from || seg.a) continue;
    const next = sc.ball.find((q) => q.a && Math.abs(q.t0 - seg.t1) < 0.02);
    if (next) { const [x, z] = heldAt(next); seg.to = [x, z, seg.to[2]]; }
    const prev = sc.ball.find((q) => q.a && q.t1 != null && Math.abs(q.t1 - seg.t0) < 0.02 && q.t0 < seg.t0);
    if (prev && seg.t0 > 0) { const [x, z] = raPos(prev.a, seg.t0); seg.from = [x + 0.35, z + 0.25, seg.from[2]]; }
  }
  sc.T = T;
  sc.I = I;
  sc.play = p;                                    // the score bug reads the score, clock and down from it
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
    if ((a.side !== 'o' && a.side !== 'd') || a.gone) continue;             // (a man carried off doesn't come back to the huddle)
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
  sc.hud = { o: [raX(x0), z0 - 7.5], d: [raX(x0), z0 + 7] };        // each huddle's middle: they face it
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
    if ((a.side !== 'o' && a.side !== 'd') || a.gone) continue;
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

/* ═════════════ Halftime: the studio desk ═════════════ */
// 2026-09-28, user: "for half time, since nfl doesnt have marching bands, lets have the view change
// to 4 people around a desk like you would see on a pre-game or post game NFL broadcast, wearing
// suits (this is all still retro) and going back and forth with chat bubbles analyzing the half.
// have opus 5.5 write some dialogue … so that the whole thing lasts around a minute, and if you
// revisit the page while its half time it just replays the same dialogue". (It replaces the home
// band, 2026-09-28, which marched a stadium loop.) The script comes from the halftime function,
// written once per game by Opus 5.5 and served to everyone; it runs from its first line on every
// visit, about a minute, then again after a short break.
const HT_CAST = ['Hal Brandt', 'Chuck Varney', 'Moose Tillman', 'Dot Keene'];
// Suit, shirt, tie (null: none), skin, hair, hair style, build. Drawn in this order, left to right.
const HT_LOOK = [
  { suit: '#1f2f5c', shirt: '#f4f4f0', tie: '#c8102e', skin: '#f1c27d', hair: '#3b2a1d', style: 'part', w: 26 },
  { suit: '#4a4f58', shirt: '#dfe8f5', tie: '#d9a520', skin: '#e0ac69', hair: '#c9c9c9', style: 'swept', w: 26 },
  { suit: '#5a2630', shirt: '#f4f4f0', tie: '#2a4a8a', skin: '#8d5524', hair: '#1a1410', style: 'crop', w: 30, beard: true },
  { suit: '#1f6f6a', shirt: '#f3e7cf', tie: null, skin: '#c68642', hair: '#241a14', style: 'long', w: 24, earrings: true },
];
const HT = new Map();                               // game id -> { lines, cast, state: 'pending' | 'done' | 'failed', polls }
// A test run of the desk on a finished game (2026-09-28, user: "give me a test link", with no game at
// halftime): ?halftime=demo plays the game's first half at the desk, the score as it stood at the half.
const htDemo = () => /[?&]halftime=demo\b/.test(location.search) && G?.ev?.state === 'post' && !!G.sum;
function htDemoEv() {
  const ev = { ...G.ev, away: { ...G.ev.away }, home: { ...G.ev.home }, state: 'in', name: 'STATUS_HALFTIME', period: 2 };
  const last = (G.sum.flat || []).map((f) => f.p).filter((p) => p && p.period && p.period <= 2 && p.away != null).at(-1);
  if (last) { ev.away.score = last.away; ev.home.score = last.home; }
  return ev;
}
const HT_TARGET = 60, HT_POST_TARGET = 120, HT_INTRO = 1.4, HT_GAP = 0.3, HT_BREAK = 6;
// The postgame desk (2026-09-28, user: "ok now we need a post game version and this can be about 2
// minutes long, can differentiate the commentators a bit with more personality"): the same four, on
// a final's 8-bit view, about two minutes on the whole game. Its script is the function's kind=post.
const htKey = (id, post) => (post ? 'post:' : '') + id;
// The script as a timeline: each line gets reading time for its words, scaled so the show runs
// about a minute (two for the postgame desk), within 0.8x to 1.25x of natural pace.
function htTimeline(lines, target = HT_TARGET) {
  const d = lines.map((l) => 1.1 + 0.26 * String(l.text).split(/\s+/).filter(Boolean).length);
  const raw = d.reduce((x, y) => x + y, 0) + HT_GAP * lines.length;
  const f = lines.length > 2 ? clamp(target / raw, 0.8, 1.25) : 1;
  let t = HT_INTRO;
  const out = lines.map((l, i) => { const t0 = t; t += d[i] * f; const q = { who: l.who, text: l.text, t0, t1: t }; t += HT_GAP; return q; });
  return { lines: out, T: t + HT_BREAK };
}
// While Opus writes (or if it can't), the host opens with the score; a failed script gets a short
// stand-in so the desk is never silent.
function htStandIn(ev, failed, post) {
  const A = ev.away, H = ev.home, a = +(A.score || 0), h = +(H.score || 0);
  const lead = a === h ? null : a > h ? A : H;
  const open = { who: 0, text: post ? `Welcome to the GFFL postgame desk. Final: ${A.name || A.abbr} ${a}, ${H.name || H.abbr} ${h}.` : `Welcome to the GFFL halftime desk. At the break, it's ${A.name || A.abbr} ${a}, ${H.name || H.abbr} ${h}.` };
  if (!failed) return [open];
  if (post) return [open,
    { who: 1, text: lead ? `${lead.name || lead.abbr} got it done. Not always pretty, but a win is a win.` : 'A tie. Nobody goes home happy, and nobody goes home sad.' },
    { who: 2, text: 'I want to see that defense on film. That is where games like this are decided.' },
    { who: 3, text: 'Check your fantasy scores, folks. Somebody in your league is celebrating right now.' },
    { who: 0, text: 'That will do it from the desk. Good night, everybody.' }];
  return [open,
    { who: 1, text: lead ? `${lead.name || lead.abbr} have the edge, but thirty minutes is a long time in this league.` : 'Dead even. Whoever wins the first drive of the second half wins this thing.' },
    { who: 2, text: 'Somebody on that defense has to take the ball away. That is where this game swings.' },
    { who: 3, text: 'Keep an eye on your fantasy lineups, folks. The second half is where the points pile up.' },
    { who: 0, text: 'Second half is coming up. Stay with us.' }];
}
function htLoad(ev, post) {
  const id = ev.id, key = htKey(id, post);
  let e = HT.get(key);
  if (e && e.state !== 'pending') return e;
  if (!e) { e = { state: 'pending', lines: null, cast: HT_CAST, polls: 0 }; HT.set(key, e); }
  if (e.busy) return e;
  e.busy = true;
  fetch(`/.netlify/functions/halftime?event=${encodeURIComponent(id)}${post ? '&kind=post' : htDemo() ? '&demo=1' : ''}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      e.busy = false;
      if (d?.ok && Array.isArray(d.lines) && d.lines.length) { Object.assign(e, { state: 'done', lines: d.lines, cast: d.cast || HT_CAST }); htScript(id, post); return; }
      if (d?.pending && ++e.polls < 60) {
        if (d.since > 0) { e.since = d.since; const sc = SIDE.sc; if (sc?.studio && sc.waiting && sc.gameId === id && !!sc.post === !!post) sc.since = d.since; }   // the first viewer's start
        e.timer = setTimeout(() => htLoad(ev, post), 3000); return; }   // about 3 minutes of polls
      e.state = 'failed'; htScript(id, post);
    })
    .catch(() => { e.busy = false; e.state = 'failed'; htScript(id, post); });
  return e;
}
// The script (real or stand-in) onto the studio on screen, from the top.
function htScript(id, post) {
  const sc = SIDE.sc;
  if (!sc?.studio || sc.gameId !== id || !!sc.post !== !!post) return;
  const e = HT.get(htKey(id, post)), ev = sc.ev || G?.ev;
  if (!e || !ev) return;
  sc.cast = e.cast || HT_CAST;
  sc.tl = e.state === 'pending' ? null : htTimeline(e.state === 'done' ? e.lines : htStandIn(ev, true, post), post ? HT_POST_TARGET : HT_TARGET);
  sc.waiting = e.state === 'pending';
  sc.since = e.since || sc.since;
  sc.t0 = SIDE.t;
}
// While the script is written (2026-09-28, user: "lets go back to the script generating when the first
// person opens the game, but it shows a post game / half time show starts soon with a countdown"):
// the desk sits waiting under a "Halftime show / starts in 0:15" card. The countdown runs from when
// the first viewer's request started the script (the function's `since`), so everyone sees the same
// one; at zero it says "Starting…" until the lines arrive, and then the show runs from its top.
// Seconds: measured on the preview, a low-effort halftime script took 11.5 s to write (seen by the
// page at 13 s, 783 output tokens); a postgame one writes about twice as much.
const HT_SOON = { half: 15, post: 25 };
function htSoonLeft(sc, now = Date.now()) {
  const est = HT_SOON[sc.post ? 'post' : 'half'];
  return Math.max(0, Math.ceil(est - (now - (sc.since || now)) / 1000));
}
function htSoon(st) {
  const sc = st.sc, stage = st.cv?.parentElement;
  if (!stage) return;
  let el = stage.querySelector('.ht-soon');
  if (!sc.waiting) { if (el) el.hidden = true; st.htSoonOn = false; return; }
  if (!el) { el = document.createElement('div'); el.className = 'ht-soon'; el.setAttribute('role', 'status'); el.innerHTML = '<b></b><span></span>'; stage.appendChild(el); }
  el.hidden = false; st.htSoonOn = true;
  const left = htSoonLeft(sc), cw = st.cv.clientWidth || 300;
  const txt = [sc.post ? 'Postgame show' : 'Halftime show', left > 0 ? `starts in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Starting…'];
  if (el.dataset.k !== txt.join('|')) { el.querySelector('b').textContent = txt[0]; el.querySelector('span').textContent = txt[1]; el.dataset.k = txt.join('|'); }
  el.style.fontSize = `${clamp(Math.round(cw / 52), 9, 14)}px`;
}
function raHalftime(ev, post) {
  const pc = pair(ev.away, ev.home);
  const sc = { actors: [], ball: [], events: [], z0: 50, x0: 0, offHome: true, ltg: null, col: { o: pc.hRaw, d: pc.aRaw }, offT: ev.home, defT: ev.away,
    tS: 0, timeout: true, halftime: true, studio: true, noBall: true, homeCol: pc.hRaw, cast: HT_CAST, t0: 0, ev, post: !!post };
  sc.tl = null;                                            // (the countdown card until the script comes)
  sc.waiting = true;
  sc.since = Date.now();
  sc.T = 1e6;
  return sc;
}
// Where the show is at time t: the line being said (or null between lines), looping after the break.
function htAt(sc, t) {
  const tl = sc.tl;
  if (!tl || sc.waiting) return { line: null, i: -1, u: 0 };
  let u = t - (sc.t0 || 0);
  if (!sc.waiting) u = ((u % tl.T) + tl.T) % tl.T;
  const i = tl.lines.findIndex((l) => u >= l.t0 && u < l.t1);
  if (i >= 0) return { line: tl.lines[i], i, u };
  return { line: null, i: -1, u };
}

// The set, painted once per size: a navy studio with light columns in both teams' colours, a big
// monitor with the score, the desk with its GFFL front, the floor.
function htSet(aw, ah, sc) {
  const ev = sc.ev || G?.ev;
  const key = `${aw}x${ah}|${sc.col.o}|${sc.col.d}|${ev?.away?.score}|${ev?.home?.score}|${sc.post ? 1 : 0}`;
  if (sc.htSetKey === key) return sc.htSetCv;
  const c = document.createElement('canvas'); c.width = aw; c.height = ah;
  const g = c.getContext('2d');
  // Back wall: bands of navy, darkening toward the ceiling, with dithered seams.
  for (let y = 0; y < ah; y++) { const u = y / ah; g.fillStyle = mixHex('#0a1030', '#1e2d66', Math.min(1, u * 1.4)); g.fillRect(0, y, aw, 1); }
  for (let y = 0; y < ah * 0.7; y += 2) for (let x = (y / 2) % 2; x < aw; x += 2) if ((x * 7 + y * 3) % 11 === 0) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, y, 1, 1); }
  // Light columns: away colour on the left, home on the right, each with a glow.
  const colW = Math.max(6, Math.round(aw * 0.035));
  for (const [x, col] of [[Math.round(aw * 0.1), sc.col.d], [Math.round(aw * 0.9) - colW, sc.col.o], [Math.round(aw * 0.22), sc.col.d], [Math.round(aw * 0.78) - colW, sc.col.o]]) {
    g.fillStyle = mixHex(col, '#0a1030', 0.55); g.fillRect(x - 2, 0, colW + 4, ah * 0.64);
    g.fillStyle = col; g.fillRect(x, 0, colW, ah * 0.64);
    g.fillStyle = mixHex(col, '#ffffff', 0.35); g.fillRect(x + 1, 0, 1, ah * 0.64);
  }
  // Ceiling rig: a truss and a row of lamps.
  g.fillStyle = '#05070f'; g.fillRect(0, 0, aw, 5);
  for (let x = 4; x < aw; x += 14) { g.fillStyle = '#2a3140'; g.fillRect(x, 5, 6, 3); g.fillStyle = '#ffe9a8'; g.fillRect(x + 1, 8, 4, 1); }
  // The monitor: HALFTIME over the score, both teams' colours.
  const mw = Math.min(Math.round(aw * 0.44), 150), mh = Math.round(ah * 0.3), mx = Math.round((aw - mw) / 2), my = Math.round(ah * 0.09);
  g.fillStyle = '#05070f'; g.fillRect(mx - 3, my - 3, mw + 6, mh + 6);
  g.fillStyle = '#39414f'; g.fillRect(mx - 2, my - 2, mw + 4, mh + 4);
  g.fillStyle = '#0d1a3f'; g.fillRect(mx, my, mw, mh);
  for (let y = my; y < my + mh; y += 2) { g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(mx, y, mw, 1); }
  const title = sc.post ? 'FINAL' : 'HALFTIME', tk = mw >= 110 ? 2 : 1;
  bigText(g, title, Math.round(mx + (mw - bigW(title, tk)) / 2), my + 4, '#ffd21f', tk);
  if (ev) {
    const rowY = my + 4 + 8 * tk + 4, half = Math.floor(mw / 2) - 4;
    for (const [i, t, col] of [[0, ev.away, sc.col.d], [1, ev.home, sc.col.o]]) {
      const x0 = mx + 3 + i * (half + 2);
      g.fillStyle = col; g.fillRect(x0, rowY, half, Math.max(9, mh - (rowY - my) - 4));
      const lab = `${t.abbr} ${t.score ?? 0}`, k = bigW(lab, 1) <= half - 4 ? 1 : 0;
      if (k) bigText(g, lab, x0 + Math.round((half - bigW(lab, 1)) / 2), rowY + Math.round((Math.max(9, mh - (rowY - my) - 4) - 7) / 2), onColor(col), 1);
      else pixText(g, lab, x0 + 2, rowY + 2, onColor(col), 1);
    }
  }
  // Floor: a glossy stage under the desk.
  const fy = Math.round(ah * 0.8);
  g.fillStyle = '#0b0f1c'; g.fillRect(0, fy, aw, ah - fy);
  for (let x = 0; x < aw; x += 8) { g.fillStyle = 'rgba(120,150,255,0.07)'; g.fillRect(x, fy, 1, ah - fy); }
  sc.htSetKey = key; sc.htSetCv = c;
  return c;
}
// The desk top's height: lower on a squarer stage (a phone's, made 4:3 for the desk) so a long line's
// bubble fits over the heads.
const htDeskY = (aw, ah) => Math.round(ah * (aw / ah < 1.5 ? 0.66 : 0.6));
// The desk (drawn over the people's laps): a long glossy top, the red GFFL rule, the front panel.
function htDesk(g, aw, ah) {
  const dw = Math.min(Math.round(aw * 0.88), 264), dx = Math.round((aw - dw) / 2), dy = htDeskY(aw, ah), dh = Math.round(ah * (aw / ah < 1.5 ? 0.2 : 0.22));
  g.fillStyle = '#05070f'; g.fillRect(dx - 1, dy - 1, dw + 2, dh + 2);
  g.fillStyle = '#c9ccd6'; g.fillRect(dx, dy, dw, 4);                                 // the top
  g.fillStyle = '#eef0f6'; g.fillRect(dx, dy, dw, 1);
  g.fillStyle = '#d50a0a'; g.fillRect(dx, dy + 4, dw, 2);                             // GFFL red
  g.fillStyle = '#18224a'; g.fillRect(dx, dy + 6, dw, dh - 6);                         // the front
  g.fillStyle = '#223066'; g.fillRect(dx, dy + 6, dw, 1);
  for (let x = dx + 12; x < dx + dw - 8; x += 24) { g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, dy + 8, 1, dh - 10); }
  const w1 = 'GFFL', k = dh >= 26 ? 2 : 1;
  bigText(g, w1, Math.round(aw / 2 - bigW(w1, k) / 2), dy + 6 + Math.round((dh - 6 - 7 * k) / 2), '#ffffff', k);
  return { dx, dy, dw };
}
// One analyst, waist up behind the desk. `talk`: this one is speaking (mouth moving, a gesture);
// `look`: -1 / 0 / 1, where the eyes point (at whoever is talking).
function htPerson(g, cx, dy, L, t, i, talk, look) {
  const bob = talk && Math.floor(t * 6) % 2 ? -1 : 0;
  const w = L.w, top = dy - 24 + bob, x0 = cx - Math.floor(w / 2);
  const dark = mixHex(L.suit, '#000000', 0.35), lite = mixHex(L.suit, '#ffffff', 0.18);
  // Jacket: square shoulders with the corners taken off, a shaded right side, lapels.
  g.fillStyle = L.suit; g.fillRect(x0, top + 2, w, dy - top);
  g.fillRect(x0 + 2, top, w - 4, 2);
  g.fillStyle = lite; g.fillRect(x0 + 2, top, w - 6, 1);
  g.fillStyle = dark; g.fillRect(x0 + w - 3, top + 2, 3, dy - top);
  g.fillStyle = L.shirt; for (let r = 0; r < 9; r++) g.fillRect(cx - 4 + Math.floor(r / 2), top + r, 9 - Math.floor(r / 2) * 2, 1);
  if (L.tie) { g.fillStyle = L.tie; g.fillRect(cx - 1, top + 1, 3, 2); g.fillRect(cx, top + 3, 1, 1); g.fillRect(cx - 1, top + 4, 3, 7); g.fillStyle = mixHex(L.tie, '#000000', 0.3); g.fillRect(cx + 1, top + 4, 1, 7); }
  else { g.fillStyle = '#e6c15a'; g.fillRect(cx - 2, top + 3, 1, 1); g.fillRect(cx + 2, top + 3, 1, 1); g.fillRect(cx - 1, top + 4, 3, 1); }   // a necklace
  g.fillStyle = dark; for (let r = 0; r < 8; r++) { g.fillRect(cx - 5 + Math.floor(r / 2), top + r, 1, 1); g.fillRect(cx + 5 - Math.floor(r / 2), top + r, 1, 1); }
  // Arms on the desk; the speaker lifts a hand now and then to make the point.
  const gest = talk && Math.floor(t / 1.7 + i) % 3 === 0;
  g.fillStyle = dark; g.fillRect(x0 - 2, top + 5, 3, dy - top - 5); g.fillRect(x0 + w - 1, top + 5, 3, dy - top - 5);
  g.fillStyle = L.skin;
  g.fillRect(x0 - 1, dy - 1, 4, 3);
  if (gest) { g.fillStyle = dark; g.fillRect(x0 + w, top + 3, 3, 8); g.fillStyle = L.skin; g.fillRect(x0 + w, top, 4, 4); g.fillStyle = mixHex(L.skin, '#000000', 0.25); g.fillRect(x0 + w, top + 3, 4, 1); }
  else g.fillRect(x0 + w - 3, dy - 1, 4, 3);
  // Neck and head.
  const hw = L.w >= 30 ? 12 : 11, hh = 12, hx = cx - Math.floor(hw / 2), hy = top - hh - 2;
  g.fillStyle = mixHex(L.skin, '#000000', 0.2); g.fillRect(cx - 2, top - 3, 5, 3);
  g.fillStyle = L.skin; g.fillRect(hx, hy + 1, hw, hh - 1); g.fillRect(hx + 1, hy, hw - 2, 1);
  g.fillStyle = mixHex(L.skin, '#000000', 0.18); g.fillRect(hx + hw - 1, hy + 2, 1, hh - 3); g.fillRect(hx + 1, hy + hh - 1, hw - 2, 1);
  g.fillStyle = L.skin; g.fillRect(hx - 1, hy + 5, 1, 3); g.fillRect(hx + hw, hy + 5, 1, 3);        // ears
  if (L.earrings) { g.fillStyle = '#e6c15a'; g.fillRect(hx - 1, hy + 8, 1, 1); g.fillRect(hx + hw, hy + 8, 1, 1); }
  // Hair.
  g.fillStyle = L.hair;
  if (L.style === 'crop') { g.fillRect(hx, hy, hw, 2); g.fillRect(hx, hy + 2, 1, 2); g.fillRect(hx + hw - 1, hy + 2, 1, 2); }
  else if (L.style === 'long') { g.fillRect(hx - 1, hy - 1, hw + 2, 3); g.fillRect(hx - 2, hy + 1, 2, hh + 3); g.fillRect(hx + hw, hy + 1, 2, hh + 3); g.fillRect(hx, hy + 2, 3, 1); }
  else if (L.style === 'swept') { g.fillRect(hx, hy - 1, hw, 3); g.fillRect(hx, hy + 2, 2, 3); g.fillRect(hx + hw - 1, hy + 2, 1, 3); g.fillStyle = mixHex(L.hair, '#ffffff', 0.4); g.fillRect(hx + 2, hy - 1, 5, 1); }
  else { g.fillRect(hx, hy - 1, hw, 3); g.fillRect(hx, hy + 2, 1, 3); g.fillRect(hx + hw - 1, hy + 2, 1, 2); g.fillStyle = mixHex(L.hair, '#000000', 0.4); g.fillRect(hx + 3, hy, 1, 2); }
  if (L.beard) { g.fillStyle = L.hair; g.fillRect(hx, hy + 8, 1, 3); g.fillRect(hx + hw - 1, hy + 8, 1, 3); g.fillRect(hx + 1, hy + 10, hw - 2, 2); }
  // Eyes (they blink every few seconds, each at their own time) and brows.
  const blink = ((t + i * 1.3) % 4.1) < 0.13;
  const ex = hx + 3 + (look > 0 ? 1 : 0) - (look < 0 ? 1 : 0), ey = hy + 5;
  g.fillStyle = mixHex(L.hair, '#000000', 0.2); g.fillRect(hx + 2, ey - 2, 3, 1); g.fillRect(hx + hw - 5, ey - 2, 3, 1);
  if (blink) { g.fillStyle = mixHex(L.skin, '#000000', 0.3); g.fillRect(hx + 2, ey, 3, 1); g.fillRect(hx + hw - 5, ey, 3, 1); }
  else { g.fillStyle = '#ffffff'; g.fillRect(hx + 2, ey, 3, 2); g.fillRect(hx + hw - 5, ey, 3, 2); g.fillStyle = '#141414'; g.fillRect(ex, ey, 1, 2); g.fillRect(ex + hw - 7, ey, 1, 2); }
  g.fillStyle = mixHex(L.skin, '#000000', 0.25); g.fillRect(cx, hy + 7, 1, 1);          // nose
  // Mouth: open and shut while talking.
  const open = talk && Math.floor(t * 8 + i) % 3 !== 0;
  const my = hy + 9 + (L.beard ? -0 : 0);
  if (open) { g.fillStyle = '#3a0d0d'; g.fillRect(cx - 2, my, 5, 2); g.fillStyle = '#b8484a'; g.fillRect(cx - 1, my + 1, 3, 1); }
  else { g.fillStyle = mixHex(L.skin, '#000000', 0.45); g.fillRect(cx - 2, my, 5, 1); }
  return { headX: cx, headTop: hy - 2 };
}
function raStudioDraw(g, W, st) {
  const sc = st.sc, H = g.canvas.height;
  const s = Math.max(1, Math.round(H / 150)), aw = Math.ceil(W / s), ah = Math.ceil(H / s);
  if (!st.htCv || st.htCv.width !== aw || st.htCv.height !== ah) { st.htCv = document.createElement('canvas'); st.htCv.width = aw; st.htCv.height = ah; }
  const o = st.htCv.getContext('2d');
  o.imageSmoothingEnabled = false;
  o.drawImage(htSet(aw, ah, sc), 0, 0);
  const now = htAt(sc, st.t);
  const dw = Math.min(Math.round(aw * 0.88), 264), dx = Math.round((aw - dw) / 2), dy = htDeskY(aw, ah);
  const heads = [];
  for (let i = 0; i < 4; i++) {
    const cx = Math.round(dx + dw * (i + 0.5) / 4);
    const who = now.line?.who;
    const look = who == null || who === i ? 0 : who > i ? 1 : -1;
    heads.push(htPerson(o, cx, dy, HT_LOOK[i], st.t, i, who === i && !now.line?.dots, look));
  }
  htDesk(o, aw, ah);
  // Papers and mugs on the desk top.
  for (let i = 0; i < 4; i++) { const cx = Math.round(dx + dw * (i + 0.5) / 4); o.fillStyle = '#f4f4f0'; o.fillRect(cx - 7, dy + 1, 6, 2); o.fillStyle = i % 2 ? '#d50a0a' : '#ffd21f'; o.fillRect(cx + 8, dy - 3, 3, 4); }
  g.imageSmoothingEnabled = false;
  g.drawImage(st.htCv, 0, 0, aw * s, ah * s);
  const ruler = st.ruler; st.ruler = false;
  try { raBugDraw(g, W, H, st); } catch (err) { /* the bug never stops the show */ }
  st.ruler = ruler;
  htBubble(st, now, heads, s, W, H);
  htSoon(st);
}
// The chat bubble: HTML over the canvas (a pixel font that wraps), pinned over the speaker's head.
function htBubble(st, now, heads, s, W, H) {
  const stage = st.cv?.parentElement;
  if (!stage) return;
  let b = stage.querySelector('.ht-bub');
  if (!b) { b = document.createElement('div'); b.className = 'ht-bub'; b.innerHTML = '<b></b><span></span>'; stage.appendChild(b); }
  const line = now.line;
  const cw = st.cv.clientWidth || W, ch = st.cv.clientHeight || H, fx = cw / W, fy = ch / H;
  st.htHeads = heads.map((h) => ({ x: h.headX * s * fx, top: h.headTop * s * fy }));   // on-screen, for the bubble (and the suite)
  if (!line) { if (b.classList.contains('on')) b.classList.remove('on'); st.htKey = null; return; }
  st.htOn = true;
  const key = `${now.i}|${cw}|${ch}`;
  if (st.htKey === key) return;
  st.htKey = key;
  const cast = st.sc.cast || HT_CAST;
  b.querySelector('b').textContent = cast[line.who] || '';
  b.querySelector('b').style.color = mixHex(HT_LOOK[line.who].suit, '#000000', 0.1);
  b.querySelector('span').textContent = line.text;
  b.classList.toggle('dots', !!line.dots);
  b.style.fontSize = `${clamp(Math.round(cw / 64), 8, 11)}px`;
  b.style.maxWidth = `${Math.round(cw * (cw < 600 ? 0.94 : 0.46))}px`;   // a phone: nearly full width, so a long line takes fewer rows
  b.style.left = '0px'; b.style.top = '0px';
  const hx = st.htHeads[line.who].x, hy = st.htHeads[line.who].top;
  const bw = b.offsetWidth, bh = b.offsetHeight;
  const x = clamp(hx - bw / 2, 4, cw - bw - 4), y = Math.max(4, hy - bh - 8);
  b.style.left = `${Math.round(x)}px`; b.style.top = `${Math.round(y)}px`;
  b.style.setProperty('--tx', `${Math.round(clamp(hx - x, 10, bw - 10))}px`);
  b.classList.add('on');
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
  return { x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, h: h0 + (h1 - h0) * u + 4 * seg.apex * u * (1 - u), flying: u > 0 && u < 1 && seg.apex > 0.5, roll: seg.roll };
}

/* Pixel renderer, in the spirit of 16- and 32-bit football games: a close, sideways camera that
   scrolls both ways, shaded side-on sprites, linemen down in their stances, mowed turf and big
   shadowed yard numbers. Drawn at twice the old console resolution (336px tall, every length below
   is the 168px stage's times RA_K) and scaled up with hard edges. The home end zone is on the right,
   as on the game page's field. All art is drawn here. */
const RA_K = 2;                                  // the 168px stage's pixel, in this stage's pixels
const PX = 9 * RA_K;                             // pixels per yard along the field
const PY = 7 * RA_K;                             // pixels per yard across it
const HK = 5 * RA_K;                             // pixels per yard of height (the ball in the air)
const RA_H = 168 * RA_K;                         // screen height
const RA_STANDS = 60 * RA_K;                     // the stands
const RA_TOP = RA_STANDS + 36 * RA_K;            // + the far (visitors') sideline, down to the field
const RA_FIELD_H = Math.round(53.33 * PY);       // 747
const RA_WORLD_H = RA_TOP + RA_FIELD_H + 44 * RA_K;   // + the near sideline and benches
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
  ':': '............#.........#............', '-': '................###................',   // for the score bug's clock and "2-PT"
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
// End-zone lettering: the team's letter colour inside its outline colour (one glyph pixel wide), with
// a hard drop shadow, on its own canvas so it can be turned.
function raOutlined(s, k, col, edge) {
  const o = edge ? Math.max(1, Math.round(k / 3)) : 0;                 // a third of a glyph pixel: thick enough to read, thin enough to keep the counters open
  const c = document.createElement('canvas');
  c.width = bigW(s, k) + 2 * o + k; c.height = 7 * k + 2 * o + k;
  const g = c.getContext('2d');
  const sh = onColor(col) === '#ffffff' ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.5)';
  if (edge) { for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) bigText(g, s, o + dx * o + k, o + dy * o + k, 'rgba(0,0,0,0.45)', k); for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) bigText(g, s, o + dx * o, o + dy * o, edge, k); }
  else bigText(g, s, k, k, sh, k);
  bigText(g, s, o, o, col, k);
  return c;
}
// Text with a hard drop shadow, drawn on its own canvas so it can be turned 90° or 180°.
function bigLabel(s, k, col, shadow) {
  const c = document.createElement('canvas');
  c.width = bigW(s, k) + k; c.height = 7 * k + k;
  const g = c.getContext('2d');
  bigText(g, s, k, k, shadow, k);
  bigText(g, s, 0, 0, col, k);
  return c;
}

/* ── Players ──
   Every player pose is a skeleton (hip, shoulder, head, and three points for each arm and leg, in
   sprite pixels, y up from the ground, facing right) rasterised once into a 34×40 grid of shade
   codes, then coloured per uniform. Each limb is a capsule lit from above and in front, so every
   colour gets three tones (light / base / shadow); the near arm and leg carry their own dark edge so
   they read over the body, and the whole figure gets a one-pixel outline.
   Codes: J j L jersey (base, shadow, light), P p Q pants, S s socks, F f E skin, H h l helmet,
   w (unused since helmets went one solid colour), m face mask, e eye, B b cleats, C cap (officials), O outline. */
const RA_SKEL = {
  stand:  { h: [0, 15], s: [0.6, 23.5], c: [1.4, 29], fa: [[2.2, 22.5], [3.4, 17.5], [3.6, 13]], ba: [[-2.2, 22.5], [-3.2, 17.5], [-3.2, 13]], fl: [[1.3, 15], [2, 8.5], [2.1, 2]], bl: [[-1.3, 15], [-2, 8.5], [-2.3, 2]] },
  run1:   { h: [0, 14.5], s: [1.8, 22.8], c: [3, 28.2], fa: [[2.3, 21.8], [-0.2, 18.2], [-1.5, 14.8]], ba: [[1.2, 21.8], [3.6, 18.5], [5.6, 20.5]], fl: [[0.5, 14.5], [4, 9.5], [5.5, 3]], bl: [[-0.5, 14.5], [-2.5, 8.5], [-6, 5]], bf: [-0.3, -1] },
  run2:   { h: [0, 15.5], s: [1.8, 23.8], c: [3, 29.2], fa: [[2.3, 22.8], [1.8, 18], [3.4, 15.5]], ba: [[1.2, 22.8], [0.5, 18.2], [1.8, 15.8]], fl: [[0.5, 15.5], [0.8, 9], [-1.5, 3.5]], bl: [[-0.5, 15.5], [2.8, 11], [0.8, 6.5]], ff: [0.6, -0.8] },
  stance: { h: [-3, 11.5], s: [4.5, 13.5], c: [8.5, 15], fa: [[4.5, 12.5], [5.5, 7], [6, 1.2]], ba: [[3.5, 12.5], [1.5, 9.5], [0, 8]], fl: [[-2.5, 11.5], [1.5, 6], [-0.5, 1.5]], bl: [[-3.5, 11.5], [-5, 5.5], [-6.5, 1.5]], noNum: 1 },
  snap:   { h: [-3, 11.5], s: [4.5, 13.2], c: [8.2, 14.8], fa: [[4.5, 12.5], [6.2, 7.5], [7.2, 2]], ba: [[3.8, 12.5], [5.5, 7.5], [6.4, 2.2]], fl: [[-2.5, 11.5], [0.5, 6], [0, 1.5]], bl: [[-3.5, 11.5], [-4, 6], [-4.5, 1.5]], noNum: 1 },
  ready:  { h: [-1.5, 12.5], s: [2.2, 20], c: [3.8, 25.4], fa: [[2.8, 19.2], [3.8, 14.8], [3.2, 10]], ba: [[1.5, 19.2], [2, 14.8], [1.6, 10]], fl: [[-1, 12.5], [2.2, 7.5], [1.2, 2]], bl: [[-2, 12.5], [-1, 7], [-3, 2]] },
  qbUnder:{ h: [-1.5, 12], s: [2, 19.5], c: [3.6, 24.9], fa: [[2.6, 18.6], [4.8, 15.2], [6.2, 12.6]], ba: [[1.6, 18.6], [3.8, 15], [5.6, 12.2]], fl: [[-1, 12], [1.8, 7.2], [0.8, 2]], bl: [[-2, 12], [-1.2, 6.8], [-3.2, 2]] },
  gun:    { h: [0, 14], s: [1.2, 22.2], c: [2.2, 27.7], fa: [[1.8, 21.2], [3, 17.5], [4.8, 17.8]], ba: [[1, 21.2], [2.3, 17.2], [4.3, 17.4]], fl: [[0.5, 14], [1.8, 8], [1.2, 2]], bl: [[-0.5, 14], [-1.2, 8], [-2, 2]] },
  hold:   { h: [-0.5, 9], s: [1.5, 16.5], c: [2.8, 21.9], fa: [[2.2, 15.8], [4.5, 12.5], [6.5, 10]], ba: [[1.2, 15.8], [3.6, 12.2], [5.8, 9.6]], fl: [[0, 9], [3.2, 6.5], [3, 1.5]], bl: [[-1, 9], [-3.5, 1.4], [-7.2, 1.2]], bf: [-1, 0.1] },
  hold2:  { h: [-0.5, 9], s: [2, 16], c: [3.6, 21.2], fa: [[2.6, 15.2], [5, 9.5], [6.4, 4.2]], ba: [[1.6, 15.2], [4, 9.3], [5.4, 4.6]], fl: [[0, 9], [3.2, 6.5], [3, 1.5]], bl: [[-1, 9], [-3.5, 1.4], [-7.2, 1.2]], bf: [-1, 0.1] },
  kick0:  { h: [0, 15], s: [0.8, 23.2], c: [1.5, 28.7], fa: [[1.5, 22], [3.6, 19], [5.8, 19.6]], ba: [[0.2, 22], [-2.5, 19.5], [-4.8, 18.5]], fl: [[0.5, 15], [-2.4, 9.5], [-6, 11]], bl: [[-0.3, 15], [0.4, 8.5], [0.2, 2]], ff: [-0.2, -1] },
  kick:   { h: [0, 15], s: [-1.2, 23], c: [-1, 28.5], fa: [[0, 22], [-2.8, 19.5], [-5.6, 19]], ba: [[0, 22], [2.8, 20.5], [5.4, 21.8]], fl: [[0.8, 15], [5, 16.5], [9.5, 18.5]], bl: [[-0.5, 15], [-0.2, 8.5], [-0.6, 2]], ff: [0.7, 0.7] },
  punt:   { h: [0, 15], s: [-1.6, 22.8], c: [-1.8, 28.2], fa: [[-0.5, 22], [2.5, 21.5], [5.2, 23]], ba: [[-0.8, 22], [-3.6, 20.5], [-6.2, 20.2]], fl: [[0.8, 15], [4.6, 19.5], [8, 23.8]], bl: [[-0.5, 15], [-0.4, 8.5], [-0.8, 2]], ff: [0.6, 0.8] },
  throw1: { h: [0, 14.5], s: [-0.5, 22.6], c: [0.6, 28.1], fa: [[0, 22], [3, 21.5], [5.6, 22]], ba: [[-1, 22], [-3.6, 24], [-3.2, 28.5]], fl: [[0.6, 14.5], [3.2, 8.5], [4.2, 2]], bl: [[-0.6, 14.5], [-2.6, 8.5], [-4.2, 2]] },
  throw2: { h: [0.6, 14.5], s: [2.6, 22.4], c: [3.9, 27.7], fa: [[2.4, 21.5], [0.2, 18.5], [-1.4, 16.4]], ba: [[2.6, 21.5], [5.4, 20], [6.6, 16.8]], fl: [[1.2, 14.5], [3.8, 8.5], [4.6, 2]], bl: [[0, 14.5], [-1.6, 8.3], [-3.6, 3]], bf: [0.3, -1] },
  catch:  { h: [0, 15], s: [0.8, 23.4], c: [1.6, 28.9], fa: [[1.4, 22.5], [3.4, 26.5], [5.2, 30.2]], ba: [[0.6, 22.5], [2.8, 26.8], [4.4, 30.8]], fl: [[0.6, 15], [2.4, 8.5], [2.2, 2]], bl: [[-0.6, 15], [-2, 8.5], [-3.4, 2.5]] },
  block:  { h: [-1, 12.8], s: [3, 19.5], c: [5, 24], fa: [[3.4, 18.6], [5.8, 17.5], [8, 17.8]], ba: [[2.6, 18.6], [5, 16.8], [7.4, 17]], fl: [[-0.5, 12.8], [2.2, 7.5], [1.2, 2]], bl: [[-1.5, 12.8], [-3.2, 7.3], [-5.2, 2]] },
  down:   { h: [-4, 3.5], s: [4, 3.8], c: [8.4, 4.4], fa: [[4.5, 3.5], [8, 2.2], [11.5, 2]], ba: [[3.5, 4], [6.8, 3.5], [10, 3.5]], fl: [[-4, 3.2], [-8.5, 2.4], [-12.5, 2]], bl: [[-4, 3.8], [-8.8, 3.4], [-12.8, 3.4]], ff: [-0.2, -1], bf: [-0.2, -1], noNum: 1 },
  cheer:  { h: [0, 15], s: [0.3, 23.4], c: [0.8, 28.9], fa: [[1.6, 22.6], [3, 27.2], [3.8, 32]], ba: [[-1, 22.6], [-2.4, 27.2], [-3, 32]], fl: [[0.8, 15], [2.2, 8.5], [3, 2]], bl: [[-0.8, 15], [-2.2, 8.5], [-3, 2]] },
  dance:  { h: [0, 14.5], s: [0.3, 22.9], c: [0.9, 28.4], fa: [[1.6, 22], [3.2, 26.5], [2.6, 31.5]], ba: [[-1, 22], [-3.6, 19], [-1.4, 16]], fl: [[0.8, 14.5], [3.2, 9], [3.6, 2]], bl: [[-0.8, 14.5], [-3, 9], [-4, 2]] },
};
// The other half of the stride: the same frames with the near and far limbs swapped.
RA_SKEL.run3 = { ...RA_SKEL.run1, fa: RA_SKEL.run1.ba, ba: RA_SKEL.run1.fa, fl: RA_SKEL.run1.bl, bl: RA_SKEL.run1.fl, ff: RA_SKEL.run1.bf, bf: RA_SKEL.run1.ff };
RA_SKEL.run4 = { ...RA_SKEL.run2, fa: RA_SKEL.run2.ba, ba: RA_SKEL.run2.fa, fl: RA_SKEL.run2.bl, bl: RA_SKEL.run2.fl, ff: RA_SKEL.run2.bf, bf: RA_SKEL.run2.ff };
const RA_RUN = ['run1', 'run2', 'run3', 'run4'];
// Trainers holding the stretcher's handles: standing, and a four-frame walk with the same arms.
RA_SKEL.carry = { ...RA_SKEL.stand, fa: [[2, 22.5], [4, 18], [6.6, 15.5]], ba: [[-1, 22.5], [2.4, 18.2], [5.6, 15.6]] };
['run1', 'run2', 'run3', 'run4'].forEach((r, i) => { RA_SKEL['crun' + (i + 1)] = { ...RA_SKEL[r], s: [RA_SKEL[r].s[0] * 0.4, RA_SKEL[r].s[1]], c: [RA_SKEL[r].c[0] * 0.4, RA_SKEL[r].c[1]], fa: RA_SKEL.carry.fa, ba: RA_SKEL.carry.ba }; });
const RA_CRUN = ['crun1', 'crun2', 'crun3', 'crun4'];
const RA_FW = 34, RA_FH = 40, RA_FAX = 17, RA_FAY = 38;   // sprite grid; the feet stand on (17, 38)
const RA_FIG = new Map();
function raFig(pose, variant = 'p') {
  const key = pose + '|' + variant;
  let f = RA_FIG.get(key);
  if (f) return f;
  // The poses are written on a lankier frame; this shortens the legs and lengthens the body to
  // football proportions (hips at 12.4 px, shoulder pads at 23, the helmet's centre at 28.3): the
  // jersey, not the pants, has to be the colour a player reads as from across the field.
  const LY = [[0, 0], [2, 2], [8.5, 6.9], [15, 12.4], [23.5, 23], [29, 28.3], [40, 39]];
  const ry = (y) => { for (let i = 1; i < LY.length; i++) if (y <= LY[i][0]) { const [a, b] = LY[i - 1], [c, d] = LY[i]; return b + (d - b) * (y - a) / (c - a); } return y; };
  const S0 = RA_SKEL[pose] || RA_SKEL.stand, S = {};
  for (const [k, v] of Object.entries(S0)) S[k] = !Array.isArray(v) || k === 'ff' || k === 'bf' ? v : Array.isArray(v[0]) ? v.map(([x, y]) => [x, ry(y)]) : [v[0], ry(v[1])];
  const W = RA_FW, H = RA_FH, AX = RA_FAX, AY = RA_FAY;
  const g = new Array(W * H).fill('.');
  const Lx = 0.5, Ly = 0.866;                                    // light: from above, a little in front
  const tone = (d, t) => (d > 0.42 ? t[2] : d < -0.3 ? t[1] : t[0]);
  const paint = (fn) => {
    for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
      const i = gy * W + gx, v = fn(gx + 0.5 - AX, AY - gy - 0.5);
      if (v === 1) { if (g[i] !== '.') g[i] = 'O'; } else if (v) g[i] = v;
    }
  };
  const near = (x, y, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], u = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return [x - a[0] - dx * u, y - a[1] - dy * u];
  };
  // A capsule from a to b; `edge` gives it its own dark rim where it lies over something drawn earlier.
  const limb = (a, b, r, t, edge) => paint((x, y) => {
    const [dx, dy] = near(x, y, a, b), d = Math.hypot(dx, dy);
    if (d <= r) return tone((dx * Lx + dy * Ly) / r, t);
    return edge && d <= r + 0.9 ? 1 : 0;
  });
  const lerp = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  const TJ = ['J', 'j', 'L'], TP = ['P', 'p', 'Q'], TS = ['S', 's', 'S'], TF = ['F', 'f', 'E'], TB = ['B', 'B', 'b'];
  const back = (t) => [t[1], t[1], t[0]];
  const arm = (A, far) => {
    const [sh, el, hd] = A, mid = lerp(sh, el, 0.8);
    limb(sh, mid, 1.85, far ? back(TJ) : TJ, !far);
    limb(mid, el, 1.45, far ? back(TF) : TF, !far);
    limb(el, hd, 1.3, far ? back(TF) : TF, !far);
    limb(hd, hd, 1.45, far ? back(TF) : TF, false);
  };
  const leg = (A, fd, far) => {
    const [hp, kn, an] = A;
    const dir = fd || [1, 0], dl = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / dl, uy = dir[1] / dl;
    const sole = [-uy * 0.55, ux * 0.55];                          // toward the sole, off the foot's axis
    limb([an[0] - ux * 0.7 - sole[0], an[1] - uy * 0.7 - sole[1]], [an[0] + ux * 2.6 - sole[0], an[1] + uy * 2.6 - sole[1]], 1.15, far ? ['B', 'B', 'B'] : TB, !far);
    limb(kn, an, 1.75, far ? back(TS) : TS, !far);
    limb(hp, lerp(kn, an, 0.22), 2.7, far ? back(TP) : TP, !far);
  };
  arm(S.ba, true);
  leg(S.bl, S.bf, true);
  limb(S.h, S.h, 3.6, TP, false);                                  // seat of the pants
  // Torso: hips to shoulder pads along the spine, a waistband of pants at the bottom.
  {
    const [hx, hy] = S.h, [sx, sy] = S.s, ax = sx - hx, ay = sy - hy, len = Math.hypot(ax, ay) || 1;
    const ux = ax / len, uy = ay / len, px = uy, py = -ux;
    paint((x, y) => {
      const rx = x - hx, ry = y - hy, v = (rx * ux + ry * uy) / len, u = rx * px + ry * py;
      if (v < -0.12 || v > 1.14) return 0;
      let hw = 4.5 + 2.2 * clamp(v, 0, 1);
      if (v > 0.84) hw *= 1 - Math.pow((v - 0.84) / 0.3, 2) * 0.6;
      if (v < 0) hw *= 1 + v * 2.5;
      if (Math.abs(u) > hw) return 0;
      return tone((u / hw) * 0.75 + (v - 0.45) * 0.6, v < 0.1 ? TP : TJ);
    });
  }
  leg(S.fl, S.ff, false);
  limb(lerp(S.s, S.c, 0.25), lerp(S.s, S.c, 0.6), 1.7, TF, false);  // neck
  // Head: a helmet with its stripe, the face in the opening and the mask's bars in front; officials
  // get a face under a white cap with a brim.
  {
    const [cx, cy] = S.c;
    if (variant === 'm') paint((x, y) => {                          // trainers: bare head, short hair
      const lx = x - cx, ly = y - cy, d = Math.hypot(lx / 3.3, ly / 3.7);
      if (d > 1) return d <= 1.27 ? 1 : 0;
      if (ly > 1.1 || (lx < -1.2 && ly > -1.2)) return tone(lx / 3.3 * 0.5 + ly / 3.7 * 0.5, ['C', 'c', 'C']);
      if (lx > 1.6 && lx < 2.6 && ly > -0.6 && ly < 0.4) return 'e';
      return tone((lx / 3.3) * Lx + (ly / 3.7) * Ly, TF);
    });
    else if (variant === 'r') paint((x, y) => {
      const lx = x - cx, ly = y - cy, d = Math.hypot(lx / 3.3, ly / 3.7);
      if (ly > 0.9 && ly < 2.1 && lx > 0.8 && lx < 5) return 'C';
      if (d > 1) return d <= 1.27 ? 1 : 0;
      if (ly > 0.9) return tone(lx / 3.3 * 0.5 + 0.5, ['C', 'c', 'C']);
      if (lx > 1.6 && lx < 2.6 && ly > -0.6 && ly < 0.4) return 'e';
      return tone((lx / 3.3) * Lx + (ly / 3.7) * Ly, TF);
    });
    else paint((x, y) => {
      const lx = x - cx, ly = y - cy, nx = lx / 4.6, ny = ly / 4.3, d = Math.hypot(nx, ny);
      if (lx > 3.3 && lx < 5.7 && ly > -3.7 && ly < 0.6 && (lx > 4.7 || (ly > -1.7 && ly < -0.8) || ly < -2.9)) return 'm';
      if (d > 1) return d <= 1.22 ? 1 : 0;
      if (lx > 1.2 && lx < 4.1 && ly > -3.3 && ly < 0.6) return lx > 2.1 && lx < 3.1 && ly > -0.6 && ly < 0.4 ? 'e' : ly < -2 ? 'f' : 'F';
      // One solid shell colour: no stripe, no light/shadow tones (2026-09-28, user: "the players have
      // two colors on their helmet, make the helmet 1 solid color"). The mask and outline stay.
      return 'H';
    });
  }
  arm(S.fa, false);
  // Outline: every empty cell touching the figure.
  const out = g.slice();
  for (let gy = 0; gy < H; gy++) for (let gx = 0; gx < W; gx++) {
    const i = gy * W + gx;
    if (g[i] !== '.') continue;
    if ((gx > 0 && g[i - 1] !== '.') || (gx < W - 1 && g[i + 1] !== '.') || (gy > 0 && g[i - W] !== '.') || (gy < H - 1 && g[i + W] !== '.')) out[i] = 'O';
  }
  // Where the number goes: on the jersey, a little behind the middle of the back.
  let num = null;
  if (!S.noNum) { const c = lerp(S.h, S.s, 0.58); num = [Math.round(AX + c[0] - 0.9), Math.round(AY - c[1] - 2.5)]; }
  f = { g: out, W, H, ax: AX, ay: AY, num };
  RA_FIG.set(key, f);
  return f;
}

// Cheerleaders: drawn as 12-pixel maps and doubled.
const RA_MAPS = {
  ch1: ['...RRRR.....', '..RRRRRR....', '..RFFFFR....', '..RFFFFR....', '...FFFF.....', '..JJJJJJ....', '.YJJJJJJY...', 'YYJJJJJJYY..', '.Y.JJJJ..Y..', '..KKKKKK....', '.KKKKKKKK...',
    '...FF.FF....', '...FF.FF....', '...FF.FF....', '...FF.FF....', '...WW.WW....'],
  ch2: ['YY.......YY.', 'YY.RRRR..YY.', '.FRRRRRR.F..', '.FRFFFFR.F..', '.FRFFFFRF...', '...FFFF.....', '..JJJJJJ....', '..JJJJJJ....', '...JJJJ.....', '..KKKKKK....', '.KKKKKKKK...',
    '...FF.FF....', '...FF.FF....', '...FF.FF....', '...FF.FF....', '...WW.WW....'],
  ch3: ['YY.......YY.', 'YY.RRRR..YY.', '.FRRRRRR.F..', '.FRFFFFR.F..', '..RFFFFRF...', '...FFFF.....', '..JJJJJJ....', '..JJJJJJ....', '...JJJJ.....', '..KKKKKKFFFW', '.KKKKKKKK...',
    '...FF.......', '...FF.......', '...FF.......', '...FF.......', '...WW.......'],
};
const RA_SPR = new Map();
const RA_RULER = new Map();
const raRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function raSprite(pose, pal, flip, num) {
  const key = pose + '|' + (pal.variant || 'p') + '|' + (pal.key || (pal.key = Object.entries(pal).filter(([k]) => k.length === 1).map((e) => e.join(':')).join())) + '|' + (flip ? 1 : 0) + '|' + (num ?? '');
  let c = RA_SPR.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  const g = c.getContext('2d');
  const map = RA_MAPS[pose];
  if (map) {
    const w = map[0].length, h = map.length, src = document.createElement('canvas');
    src.width = w + 2; src.height = h + 2;
    const s = src.getContext('2d');
    const at = (x, y) => map[y]?.[flip ? w - 1 - x : x];
    const on = (x, y) => { const v = at(x, y); return v && v !== '.'; };
    s.fillStyle = '#0c0c0c';
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) if (!on(x, y) && (on(x - 1, y) || on(x + 1, y) || on(x, y - 1) || on(x, y + 1))) s.fillRect(x + 1, y + 1, 1, 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = at(x, y); if (v && v !== '.') { s.fillStyle = pal[v] || '#f0f'; s.fillRect(x + 1, y + 1, 1, 1); } }
    c.width = src.width * RA_K; c.height = src.height * RA_K;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, c.width, c.height);
    c.ax = c.width / 2; c.ay = c.height - RA_K;
  } else {
    const f = raFig(pose, pal.variant);
    c.width = f.W; c.height = f.H;
    const img = g.createImageData(f.W, f.H), d = img.data;
    const rgb = pal.rgb || (pal.rgb = Object.fromEntries(Object.entries(pal).filter(([k, v]) => k.length === 1 && typeof v === 'string').map(([k, v]) => [k, raRGB(v)])));
    const set = (x, y, col) => { const i = (y * f.W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const ch = f.g[y * f.W + x];
      if (ch === '.') continue;
      let col = rgb[ch] || [255, 0, 255];
      if (pal.stripe && (ch === 'J' || ch === 'j' || ch === 'L') && Math.floor(x / 2) % 2) col = rgb.X;
      set(flip ? f.W - 1 - x : x, y, col);
    }
    // The number goes on after the flip so it never reads backwards, and only onto jersey cells.
    if (num != null && f.num && rgb.n) {
      const s = String(num), w = s.length * 4 - 1;
      const x0 = f.num[0] - Math.floor(w / 2), fx0 = flip ? f.W - (x0 + w) : x0;
      for (let k = 0; k < s.length; k++) {
        const gl = RA_GLYPHS[s[k]];
        for (let i = 0; i < 15; i++) {
          if (gl[i] !== '1') continue;
          const fx = fx0 + k * 4 + (i % 3), y = f.num[1] + Math.floor(i / 3);
          const sx = flip ? f.W - 1 - fx : fx, ch = f.g[y * f.W + sx];
          if (ch === 'J' || ch === 'j' || ch === 'L') set(fx, y, rgb.n);
        }
      }
    }
    if (pal.cross && f.num && rgb.R) {
      const cx0 = f.num[0], cy0 = f.num[1] + 2;
      for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) {
        const x = cx0 + dx, y = cy0 + dy, ch = f.g[y * f.W + x];
        if (ch === 'J' || ch === 'j' || ch === 'L') set(flip ? f.W - 1 - x : x, y, rgb.R);
      }
    }
    g.putImageData(img, 0, 0);
    c.ax = flip ? f.W - f.ax : f.ax; c.ay = f.ay;
  }
  RA_SPR.set(key, c);
  return c;
}
// The football: an oval with laces, lit from above, in eight turns so a kick can tumble end over end.
const RA_BALL = [];
function raBallSprite(k) {
  if (RA_BALL[k]) return RA_BALL[k];
  const S = 16, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  const ang = (k * Math.PI) / 8, cs = Math.cos(ang), sn = Math.sin(ang), A = 4.8, B = 2.9;
  const inside = (x, y) => { const u = x * cs + y * sn, v = -x * sn + y * cs; return (u / A) ** 2 + (v / B) ** 2 <= 1; };
  const put = (i, c3) => { d[i] = c3[0]; d[i + 1] = c3[1]; d[i + 2] = c3[2]; d[i + 3] = 255; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const px = x + 0.5 - S / 2, py = y + 0.5 - S / 2, i = (y * S + x) * 4;
    if (inside(px, py)) {
      const u = px * cs + py * sn, v = -px * sn + py * cs;
      const lace = Math.abs(u) < 2 && v < -B * 0.25 && v > -B * 0.85 && (Math.abs(u) < 0.5 || Math.floor(u + 2) % 2 === 0);
      put(i, lace ? [244, 238, 226] : py < -1.2 ? [184, 104, 50] : py > 1.2 ? [92, 42, 14] : [140, 70, 26]);
    } else if (inside(px - 1, py) || inside(px + 1, py) || inside(px, py - 1) || inside(px, py + 1)) put(i, [16, 10, 6]);
  }
  g.putImageData(img, 0, 0);
  return (RA_BALL[k] = c);
}

// The stretcher, seen from the side and a little above: a canvas bed on two poles with handles at
// each end, three tones and an outline like everything else. Its height off the ground is keyed.
let RA_STRETCHER = null;
function raStretcherSprite() {
  if (RA_STRETCHER) return RA_STRETCHER;
  const W = 46, H = 12, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  const grid = Array.from({ length: H }, () => new Array(W).fill(''));
  for (let y = 3; y <= 7; y++) for (let x = 4; x <= 41; x++) grid[y][x] = y === 3 ? 'l' : y === 7 ? 's' : 'b';   // the bed
  for (const y of [2, 8]) for (let x = 0; x <= 45; x++) grid[y][x] = x < 3 || x > 42 ? 'h' : 'p';                 // poles and handles
  for (const x of [6, 39]) for (let y = 9; y <= 10; y++) grid[y][x] = 'p';                                           // little feet
  const col = { l: [250, 250, 246], b: [226, 223, 212], s: [178, 172, 160], p: [96, 100, 110], h: [40, 42, 48], o: [13, 14, 19] };
  const put = (x, y, c3) => { const i = (y * W + x) * 4; d[i] = c3[0]; d[i + 1] = c3[1]; d[i + 2] = c3[2]; d[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (grid[y][x]) put(x, y, col[grid[y][x]]);
    else if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx])) put(x, y, col.o);
  }
  g.putImageData(img, 0, 0);
  return (RA_STRETCHER = c);
}
function raStrH(a, t) {
  const k = a.hk;
  if (t <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0] || 1); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * u; }
  return k[k.length - 1][1];
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
// The field is the same for every play of a game, so it is painted once per matchup (and again when
// the home logo arrives).
const RA_ART = new Map();
function raFieldArt(sc) {
  const homeCol = sc.offHome ? sc.col.o : sc.col.d, awayCol = sc.offHome ? sc.col.d : sc.col.o;
  const homeT = sc.offHome ? sc.offT : sc.defT, awayT = sc.offHome ? sc.defT : sc.offT;
  const logo = raLogo(homeT);
  const key = [homeT.id, awayT.id, homeCol, awayCol, !!logo].join('|');
  if (RA_ART.has(key)) return RA_ART.get(key);
  const K = RA_K;
  const c = document.createElement('canvas');
  c.width = RA_WORLD_W; c.height = RA_WORLD_H;
  const g = c.getContext('2d');
  const rng = raRng('field' + homeT.id + awayT.id);
  const f0 = RA_TOP, f1 = RA_TOP + RA_FIELD_H;
  // Stands: rows of fans behind a padded wall in both teams' colours.
  g.fillStyle = '#262a33'; g.fillRect(0, 0, RA_WORLD_W, RA_TOP);
  const shirts = [homeCol, homeCol, awayCol, '#e9e4d4', '#9aa0a8', mixHex(homeCol, '#ffffff', 0.35), mixHex(awayCol, '#ffffff', 0.35)];
  const skin = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69'];
  const wall = RA_STANDS - 9 * K;
  for (let y = K; y < wall - 5 * K; y += 5 * K) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y + 4 * K, RA_WORLD_W, K);          // the step of each row
    for (let x = ((y / K) % 2) * 2 * K; x < RA_WORLD_W; x += 3 * K) {
      if (rng() < 0.1) continue;
      const sk = skin[Math.floor(rng() * skin.length)], sh = shirts[Math.floor(rng() * shirts.length)];
      g.fillStyle = sk; g.fillRect(x, y, 2 * K, 2 * K);
      g.fillStyle = mixHex(sk, '#000000', 0.25); g.fillRect(x + K, y + K, K, K);
      g.fillStyle = sh; g.fillRect(x, y + 2 * K, 2 * K, 3 * K);
      g.fillStyle = mixHex(sh, '#000000', 0.3); g.fillRect(x + K, y + 2 * K, K, 3 * K);
    }
  }
  for (let x = 0; x < RA_WORLD_W; x += 24 * K) {
    const col = (x / (24 * K)) % 2 ? homeCol : awayCol;
    g.fillStyle = col; g.fillRect(x, wall, 24 * K, 6 * K);
    g.fillStyle = mixHex(col, '#ffffff', 0.25); g.fillRect(x, wall, 24 * K, K);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, wall + 5 * K, 24 * K, K);
  }
  g.fillStyle = '#0c0c0c'; g.fillRect(0, wall + 6 * K, RA_WORLD_W, K);
  // Turf: mowed in five-yard bands with a little grain; a darker apron and bench area outside the lines.
  g.fillStyle = '#1d7a2a'; g.fillRect(0, wall + 7 * K, RA_WORLD_W, RA_WORLD_H - wall - 7 * K);
  for (let H = -10; H < 110; H += 5) {
    g.fillStyle = (H / 5) % 2 ? '#248f30' : '#21862d';
    g.fillRect(raSX(H + 5), f0, raSX(H) - raSX(H + 5), RA_FIELD_H);
  }
  const fx0 = raSX(110), fw = raSX(-10) - raSX(110);
  for (let i = 0; i < (RA_WORLD_W * RA_FIELD_H * 0.035) / K; i++) {
    g.fillStyle = rng() < 0.55 ? 'rgba(0,40,0,0.18)' : 'rgba(120,200,110,0.12)';
    g.fillRect(fx0 + Math.floor(rng() * fw), f0 + Math.floor(rng() * RA_FIELD_H), K, K / 2 + (rng() < 0.3 ? K / 2 : 0));
  }
  // Team benches between the 25s: home on the near sideline, visitors across the field below the stands.
  const bx0 = raSX(75), bx1 = raSX(25);
  for (const y of [f1 + 30 * K, RA_STANDS + 4 * K]) {
    g.fillStyle = '#16602a'; g.fillRect(bx0, y, bx1 - bx0, 6 * K);
    g.fillStyle = '#1d7535'; g.fillRect(bx0, y, bx1 - bx0, K);
    g.fillStyle = '#0c0c0c'; g.fillRect(bx0, y + 6 * K, bx1 - bx0, K);
  }
  g.fillStyle = 'rgba(255,255,255,0.55)';                                                  // the coaching-box lines
  for (let x = raSX(110); x < raSX(-10); x += 6 * K) { g.fillRect(x, f1 + 6 * K, 3 * K, K); g.fillRect(x, f0 - 7 * K, 3 * K, K); }
  // End zones: both in the home team's own paint (2026-09-28, user: "the endzones should always
  // reflect the home team, not be different on either side"; they used to be one team's each), from
  // the researched table (EZ, sd-app.js): the fill, a hatch where the team paints stripes, the words
  // (often the nickname at one end and the city at the other) in the team's lettering colour with its
  // outline, and the logo either side of the word where the team paints one.
  const Z = typeof ezStyle === 'function' ? ezStyle(homeT) : { fill: homeCol, words: [homeT.abbr, homeT.abbr], ink: onColor(homeCol), edge: null };
  const zone = (Ha, Hb, word, rot) => {
    const x0 = raSX(Hb), w = raSX(Ha) - x0;
    g.fillStyle = Z.fill; g.fillRect(x0, f0, w, RA_FIELD_H);
    if (Z.pattern) {                                                                      // a diagonal hatch
      g.fillStyle = Z.pattern;
      for (let y = f0; y < f1; y += K) for (let x = x0; x < x0 + w; x += K) if (((x - x0 + y - f0) / K) % (12) < 3) g.fillRect(x, y, K, K);
    } else {                                                                              // the turf's grain through the paint
      g.fillStyle = mixHex(Z.fill, '#000000', 0.12);
      for (let y = f0; y < f1; y += 6 * K) g.fillRect(x0, y, w, K);
    }
    word = String(word || '').toUpperCase().replace(/[^A-Z0-9& ]/g, '');
    const k = Math.max(K, Math.min(3 * K, Math.floor((RA_FIELD_H * 0.84) / (word.length * 6))));
    const lab = raOutlined(word, k, Z.ink, Z.edge);
    const logoOk = Z.logo && logo && lab.width + 2 * (w * 0.62 + 6 * K) < RA_FIELD_H * 0.94;
    g.save(); g.translate(x0 + w / 2, f0 + RA_FIELD_H / 2); g.rotate(rot);
    g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2));
    if (logoOk) {
      const n = Math.round(w * 0.62);
      for (const d of [-1, 1]) g.drawImage(logo, Math.round(d * (lab.width / 2 + 4 * K + n / 2) - n / 2), -Math.round(n / 2), n, n);
    }
    g.restore();
  };
  zone(-10, 0, Z.words[0], Math.PI / 2);                    // the right-hand end zone (the home team's own, H −10 to 0)
  zone(100, 110, Z.words[1], -Math.PI / 2);
  // The home team's logo at midfield: 13 yards across, foreshortened like the rest of the turf.
  if (logo) {
    const n = 40 * K, lo = document.createElement('canvas'); lo.width = n; lo.height = n;
    lo.getContext('2d').drawImage(logo, 0, 0, n, n);
    const lw = 13 * PX, lh = Math.round(lw * PY / PX);
    g.imageSmoothingEnabled = false; g.globalAlpha = 0.92;
    g.drawImage(lo, Math.round(raSX(50) - lw / 2), Math.round(f0 + RAX * PY - lh / 2), lw, lh);
    g.globalAlpha = 1;
  }
  // Lines: sidelines, end lines, goal lines and every five yards; hash ticks every yard.
  g.fillStyle = '#ffffff';
  g.fillRect(raSX(110), f0, raSX(-10) - raSX(110) + 2 * K, 2 * K);
  g.fillRect(raSX(110), f1 - 2 * K, raSX(-10) - raSX(110) + 2 * K, 2 * K);
  for (const H of [-10, 110]) g.fillRect(raSX(H), f0, 2 * K, RA_FIELD_H);
  for (let H = 0; H <= 100; H += 5) g.fillRect(raSX(H), f0, H % 100 === 0 ? 2 * K : K, RA_FIELD_H);
  for (let H = 1; H < 100; H++) {
    if (H % 5 === 0) continue;
    const x = raSX(H);
    // NFL hash rows sit 23.58 yd off each sideline (70'9" apart), not college's 20 yd.
    for (const yy of [2, 23.58, 29.75, 51.33]) g.fillRect(x, Math.round(f0 + yy * PY) - K, K, 3 * K);
  }
  // Yard numbers with a dark drop shadow; the far side's read upside down, as on a real field.
  for (let H = 10; H <= 90; H += 10) {
    const n = String(H <= 50 ? H : 100 - H), x = raSX(H);
    const lab = bigLabel(n, 2 * K, '#f7f7f7', '#123d8a');
    const near = f0 + Math.round((53.33 - 11) * PY);
    g.drawImage(lab, x - Math.floor(lab.width / 2), near);
    g.save(); g.translate(x, f0 + Math.round(11 * PY)); g.rotate(Math.PI);
    g.drawImage(lab, -Math.floor(lab.width / 2), -Math.floor(lab.height / 2)); g.restore();
    // The little arrow pointing to the nearer goal.
    const dir = H < 50 ? 1 : H > 50 ? -1 : 0;
    if (dir) { g.fillStyle = '#f7f7f7'; const ax = x + dir * (lab.width / 2 + 4 * K); g.fillRect(ax, near + 6 * K, K, 3 * K); g.fillRect(ax + dir * K, near + 7 * K, K, K); }
  }
  // The goalposts' padded bases, two yards behind each end line (the posts are drawn with the players).
  for (const H of [-12, 112]) {
    const x = raSX(H), y = Math.round(f0 + RAX * PY);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 3 * K, y - K, 7 * K, 3 * K);
  }
  RA_ART.set(key, c);
  return c;
}

const raContrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const RA_WHITE = '#f2f2f0';
// Real 2026-season primary home and road uniforms, researched 2026-09-28 (user: "get real kits...
// away teams should wear white jerseys, primary team color as the pants... home teams should wear
// primary jersey color, white pants and their official helmet" — then corrected on research: ESPN's
// `team.color` is often not the jersey colour at all (Denver's is navy, but the home jersey is
// orange), several teams (Dallas) wear white at HOME by tradition, and 2026 brought real uniform
// redesigns (Atlanta's red jersey returns, Baltimore "Next Flight", Tennessee's Oilers-blue/white-
// helmet rebrand, Washington's burgundy/gold rebrand, Houston's "Deep Steel Blue"). Sources and notes
// per team: docs/sunday.md (2026-09-28 entry). jersey/pants/helmet/num are the standard, non-alternate
// set; `homeWhite` marks a team whose own standard home jersey is white (so its `road` entry, below,
// is the colored one it wears on the road).
const RA_KITS = {
  ARI: { home: { jersey: '#97233F', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#97233F', helmet: '#f2f2f0', num: '#97233F' } },
  ATL: { home: { jersey: '#A71930', pants: '#FFFFFF', helmet: '#101820', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#101820', num: '#A71930' } }, // 2026 redesign: red jersey returns as home primary
  BAL: { home: { jersey: '#241773', pants: '#241773', helmet: '#101014', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#101014', num: '#241773' } }, // "Next Flight" (Apr 2026): monochrome purple / monochrome white, matte-black helmet both ways
  BUF: { home: { jersey: '#00338D', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#00338D', helmet: '#f2f2f0', num: '#00338D' } },
  CAR: { home: { jersey: '#101820', pants: '#FFFFFF', helmet: '#a5acaf', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#a5acaf', num: '#101820' } },
  CHI: { home: { jersey: '#0B162A', pants: '#FFFFFF', helmet: '#0b162a', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#0B162A', helmet: '#0b162a', num: '#0B162A' } },
  CIN: { home: { jersey: '#101820', pants: '#101820', helmet: '#101014', num: '#FB4F14' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#101014', num: '#101820' } }, // standard set is all-black, not the orange "Open in Orange" one-off
  CLE: { home: { jersey: '#311D00', pants: '#FFFFFF', helmet: '#ff3c00', num: '#FF3C00' }, road: { jersey: '#FFFFFF', pants: '#311D00', helmet: '#ff3c00', num: '#311D00' } },
  DAL: { home: { jersey: '#FFFFFF', pants: '#8a98a8', helmet: '#8a98a8', num: '#002244' }, road: { jersey: '#002244', pants: '#8a98a8', helmet: '#8a98a8', num: '#FFFFFF' }, homeWhite: true }, // white at home since the 1960s
  DEN: { home: { jersey: '#FB4F14', pants: '#FFFFFF', helmet: '#0a2343', num: '#0a2343' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#0a2343', num: '#FB4F14' } }, // 2024 "Mile High": orange jersey/white pants at home, navy helmet — the case the user flagged
  DET: { home: { jersey: '#0076B6', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#0076B6' } },
  GB: { home: { jersey: '#203731', pants: '#ffb612', helmet: '#ffb612', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#ffb612', helmet: '#ffb612', num: '#203731' } }, // never wears white pants
  HOU: { home: { jersey: '#03202f', pants: '#FFFFFF', helmet: '#03202f', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#03202f', helmet: '#03202f', num: '#03202f' } }, // 2024 redesign: "Deep Steel Blue" jersey and helmet
  IND: { home: { jersey: '#002C5F', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#002C5F', helmet: '#f2f2f0', num: '#002C5F' } },
  JAX: { home: { jersey: '#006778', pants: '#101820', helmet: '#101820', num: '#D7A22A' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#101820', num: '#101820' } },
  KC: { home: { jersey: '#E31837', pants: '#FFFFFF', helmet: '#e31837', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#E31837', helmet: '#e31837', num: '#E31837' } },
  LV: { home: { jersey: '#101820', pants: '#101820', helmet: '#a5acaf', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#a5acaf', num: '#101820' } }, // helmet is silver, not black
  LAC: { home: { jersey: '#0080C6', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFC20E' }, road: { jersey: '#FFFFFF', pants: '#002A5E', helmet: '#f2f2f0', num: '#0080C6' } }, // powder blue is the standard home jersey, navy "Super Chargers" is the alternate
  LAR: { home: { jersey: '#003594', pants: '#FFFFFF', helmet: '#003594', num: '#FFD100' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#003594', num: '#003594' } },
  MIA: { home: { jersey: '#008E97', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#008E97', helmet: '#f2f2f0', num: '#008E97' } },
  MIN: { home: { jersey: '#4F2683', pants: '#FFFFFF', helmet: '#4f2683', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#4F2683', helmet: '#4f2683', num: '#4F2683' } },
  NE: { home: { jersey: '#002244', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b0b7bc', helmet: '#b0b7bc', num: '#002244' } },
  NO: { home: { jersey: '#101820', pants: '#101820', helmet: '#d3bc8d', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#101820', helmet: '#d3bc8d', num: '#101820' } },
  NYG: { home: { jersey: '#0B2265', pants: '#FFFFFF', helmet: '#0b2265', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#0b2265', num: '#0B2265' } },
  NYJ: { home: { jersey: '#115740', pants: '#FFFFFF', helmet: '#115740', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#115740', helmet: '#115740', num: '#115740' } }, // "Legacy" green shell is standard; the all-white shell is a 2026 special-game alternate
  PHI: { home: { jersey: '#004C54', pants: '#FFFFFF', helmet: '#004c54', num: '#A5ACAF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#004c54', num: '#004C54' } }, // home pants white, not black: onpattison.com 2025 uniform schedule (Week 1 vs DAL: midnight green / white / midnight green)
  PIT: { home: { jersey: '#000000', pants: '#FFB612', helmet: '#101014', num: '#FFB612' }, road: { jersey: '#FFFFFF', pants: '#000000', helmet: '#101014', num: '#000000' } },
  SF: { home: { jersey: '#AA0000', pants: '#b3995d', helmet: '#b3995d', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#b3995d', helmet: '#b3995d', num: '#AA0000' } },
  SEA: { home: { jersey: '#002244', pants: '#002244', helmet: '#002244', num: '#69BE28' }, road: { jersey: '#FFFFFF', pants: '#002244', helmet: '#002244', num: '#002244' } }, // all college navy at home, pants included (seahawks.com uniform announcements, 2025)
  TB: { home: { jersey: '#D50A0A', pants: '#3d3935', helmet: '#3d3935', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#3d3935', helmet: '#3d3935', num: '#D50A0A' } },
  TEN: { home: { jersey: '#4495D2', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFFFFF', helmet: '#f2f2f0', num: '#4495D2' } }, // Mar 2026 Oilers-blue rebrand: white helmet (and facemask) for the first time
  WSH: { home: { jersey: '#5A1414', pants: '#FFB612', helmet: '#5a1414', num: '#FFFFFF' }, road: { jersey: '#FFFFFF', pants: '#FFB612', helmet: '#5a1414', num: '#5A1414' } }, // Apr 2026 rebrand: gloss-burgundy helmet, gold facemask, gold pants both ways
};
// The helmet shell, by ESPN abbreviation, derived from RA_KITS so there is one source of truth (a
// team's helmet doesn't change between its home and road sets). An abbreviation not in RA_KITS falls
// back to its primary colour, same as raKit below.
const RA_HELMET = Object.fromEntries(Object.entries(RA_KITS).map(([k, v]) => [k, v.home.helmet]));
// The generic fallback for a team not in RA_KITS: primary jersey/white pants at home, white
// jersey/primary pants on the road, primary colour for a helmet nobody researched.
function raGenericKit(t, home) {
  const prim = t.color, alt = t.alt, H = prim;
  const J = home ? prim : RA_WHITE, P = home ? RA_WHITE : prim;
  const n = home ? (raContrast(prim, '#ffffff') >= raContrast(prim, alt) ? '#ffffff' : alt)
    : raContrast(prim, RA_WHITE) >= 2.2 ? prim : raContrast(alt, RA_WHITE) >= 2.2 ? alt : '#1a1a1a';
  return { J, P, H, n };
}
// A number colour that reads on this pixel art even if the researched one is too close to the
// jersey (the contrast the sprite's own outline pixel can't rescue).
const raSafeNum = (num, jersey) => (raContrast(num, jersey) >= 2.2 ? num
  : raContrast('#ffffff', jersey) >= 2.2 ? '#ffffff' : raContrast('#111111', jersey) >= 2.2 ? '#111111' : num);
// Both teams' real kits for this game: the home team in its home set, the visitors in their road
// set — unless that pairs two white (or near-identical) jerseys, in which case the visitors switch to
// their own colour jersey (their `home` entry), same as the NFL does.
function raKit(homeT, roadT) {
  const upH = (homeT.abbr || '').toUpperCase(), upR = (roadT.abbr || '').toUpperCase();
  const KH = RA_KITS[upH], KR = RA_KITS[upR];
  const toEntry = (e, t) => ({ J: e.jersey, P: e.pants, H: e.helmet, n: raSafeNum(e.num, e.jersey) });
  const home = KH ? toEntry(KH.home, homeT) : raGenericKit(homeT, true);
  let road = KR ? toEntry(KR.road, roadT) : raGenericKit(roadT, false);
  if (cdist(home.J, road.J) < 40) {
    const swap = KR ? toEntry(KR.home, roadT) : raGenericKit(roadT, true);
    if (cdist(home.J, swap.J) >= 40) road = swap;
  }
  const brand = (t, k) => (k ? k.home.jersey : t.color);
  const withExtras = (e, t, k) => ({ ...e, w: [t.alt, e.J, '#ffffff', '#111111'].find((c) => raContrast(c, e.H) >= 1.9) || '#ffffff', S: brand(t, k) });
  return { home: withExtras(home, homeT, KH), road: withExtras(road, roadT, KR) };
}
const raShade = (c) => mixHex(c, '#0a0c18', lum(c) > 0.6 ? 0.26 : 0.42);
const raLight = (c) => (lum(c) > 0.6 ? '#ffffff' : mixHex(c, '#ffffff', lum(c) < 0.03 ? 0.22 : 0.3));
const RA_SKIN = ['#f1c27d', '#c68642', '#8d5524', '#e0ac69', '#6b4226'];
const raIsHome = (sc, side) => (side === 'o') === sc.offHome;
// A plausible number for the position, the same every time for the same man.
function raNumber(role, seed) {
  const r = raRng(seed)();
  const pickIn = (ranges) => { const all = ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)); return all[Math.floor(r * all.length)]; };
  return pickIn({ QB: [[1, 19]], K: [[1, 19]], RB: [[20, 39]], FB: [[40, 49]], WR: [[10, 19], [80, 88]], TE: [[80, 89]], OL: [[60, 79]], DL: [[90, 99], [50, 59]], LB: [[40, 58]], DB: [[20, 39]], BENCH: [[2, 99]] }[role] || [[10, 99]]);
}
function raPalette(sc, a) {
  if (!a.pal && a.side === 'm') {
    // Trainers: light grey shirt with a red cross, dark navy trousers, no helmet.
    const F = RA_SKIN[(a.idx ?? 0) % RA_SKIN.length], hair = ['#2a1a10', '#4a3020', '#161616', '#6b5130'][(a.idx ?? 0) % 4];
    a.pal = { variant: 'm', cross: 1, J: '#e4e7ec', j: '#aeb3bd', L: '#ffffff', R: '#d0202a', P: '#262b38', p: '#141722', Q: '#40465a', S: '#262b38', s: '#141722',
      F, f: raShade(F), E: raLight(F), B: '#141414', b: '#3a3c44', C: hair, c: raShade(hair), e: '#141414', O: '#0d0e13' };
    a.phase = 0;
  }
  if (!a.pal && a.side === 'r') {
    // Officials: black-and-white stripes, black pants, a white cap.
    const F = RA_SKIN[2];
    a.pal = { variant: 'r', stripe: 1, J: '#f4f4f4', j: '#c3c6cc', L: '#ffffff', X: '#141414', P: '#1c1c20', p: '#0e0e10', Q: '#3a3a42', S: '#141414', s: '#0b0b0d', F, f: raShade(F), E: raLight(F), B: '#141414', b: '#3a3c44', C: '#f4f4f4', c: '#c3c6cc', e: '#141414', O: '#0d0e13' };
    a.phase = 0;
  }
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
    const home = raIsHome(sc, a.side);
    const t = a.side === 'o' ? sc.offT : sc.defT;
    if (!sc.kits) { const homeT = sc.offHome ? sc.offT : sc.defT, roadT = sc.offHome ? sc.defT : sc.offT; sc.kits = raKit(homeT, roadT); }
    const kit = home ? sc.kits.home : sc.kits.road;
    const idx = a.idx ?? sc.actors.indexOf(a);
    const F = RA_SKIN[(idx * 7 + (a.side === 'o' ? 1 : 3)) % RA_SKIN.length];
    const { J, P, H, S } = kit;
    a.pal = {
      J, j: raShade(J), L: raLight(J), P, p: raShade(P), Q: raLight(P), H, h: raShade(H), l: raLight(H), w: kit.w,
      m: raContrast('#9aa0a8', H) < 1.6 ? '#2b2f38' : '#9aa0a8', F, f: raShade(F), E: raLight(F), S, s: raShade(S),
      B: '#17181d', b: '#44464e', e: '#141414', n: kit.n, O: '#0d0e13',
    };
    a.num = raNumber(a.role, `${t.id}:${a.role}:${idx}`);
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
        amp: rng() < 0.35 ? (3 + rng() * 9) * RA_K : 0, w: 0.35 + rng() * 0.6, ph: rng() * 6.28, flipT: 2.5 + rng() * 5, k: [[0, 0, 0, 0]] });
    }
  };
  add(home, f1 + 12 * RA_K, f1 + 26 * RA_K);
  add(away, RA_STANDS + 18 * RA_K, RA_TOP - 9 * RA_K);
  sc.bench = out;
  return out;
}

// A kicker hoisted after a field goal: up onto the shoulders (13 sprite pixels) in 0.3 s, two tosses
// half a body higher (0.6 s each), down again in the last 0.3 s. In sprite pixels, times RA_K on screen.
function raHoistLift(h, t) {
  const up = clamp((t - h.t0) / 0.3, 0, 1), down = clamp((h.t1 - t) / 0.3, 0, 1);
  let y = 13 * Math.min(up, down);
  for (const ts of h.tosses) { const u = (t - ts) / 0.6; if (u > 0 && u < 1) y += 18 * 4 * u * (1 - u); }
  return y;
}
// What a player is doing at time t: a scripted action (the throw, the catch, the kick, the hold),
// set in his stance before the snap, blocking, running (a four-frame stride) or standing.
function raPoseAt(sc, a, t) {
  const [x, z] = raPos(a, t), [ox, oz] = raPos(a, Math.max(0, t - 0.1));
  const speed = Math.hypot(x - ox, z - oz) / 0.1;
  if (a.downAt != null && t > a.downAt + 0.1 && !(a.upAt != null && t > a.upAt)) return 'down';
  if (a.acts) for (const [t0, t1, p] of a.acts) if (t >= t0 && t < t1) return p;
  if (a.set && speed < 0.5 && !sc.huddle && ((t < sc.tS && t > sc.tS - 1.2) || (sc.freeze && t < sc.freeze && t >= sc.tS))) return a.set;
  if (['OL', 'DL', 'TE'].includes(a.role) && t >= sc.tS && t < (sc.tEnd ?? sc.T) && speed < 3.2 && !sc.huddle && !sc.timeout) return 'block';
  if (speed > 0.8) return RA_RUN[Math.floor(t * (speed < 3.5 ? 5 : speed < 7 ? 8 : 10.5) + (a.phase || 0) * 4) % 4];
  return 'stand';
}
// Where the ball sits in a man's hands, by pose (sprite pixels, facing right, up from the ground).
const RA_HOLD = { stand: [4, 16], run1: [4.5, 16], run2: [4.5, 17], run3: [4.5, 16], run4: [4.5, 17], gun: [5, 17.6], qbUnder: [6.4, 12.6], throw1: [-3.4, 29], throw2: [6.8, 17],
  catch: [5, 31], down: [11.5, 3], hold: [6.8, 10], hold2: [6.4, 4.2], snap: [8, 1.6], block: [6, 17], ready: [4, 11], stance: [6.5, 1.4], kick: [3, 17], kick0: [5.5, 18.5], punt: [4, 17],
  dance: [2.6, 32], cheer: [3.8, 32.5] };
// Goalposts in three pieces so the ball can pass between them: the far upright, the crossbar with
// the offset post, the near upright. Seen from the side every part of the posts would stack on one
// screen column, so the uprights are drawn in a little perspective (the far one shifted toward
// midfield), and a kicked ball near the posts shifts with them.
const RA_SHEAR = 0.35 * PX;                           // screen pixels per yard across the field
const raPostShift = (H, across) => (H > 50 ? 1 : -1) * -across * RA_SHEAR;
function raDraw(g, W, st) {
  const RA_H = g.canvas.height;                      // this stage's own height
  const K = RA_K;
  const sc = st.sc, t = st.t;
  if (!sc.art) sc.art = raFieldArt(sc);
  const cx = Math.round(st.cam.x), cy = Math.round(st.cam.y);
  g.imageSmoothingEnabled = false;
  g.drawImage(sc.art, cx, cy, W, RA_H, 0, 0, W, RA_H);
  const flipX = sc.offHome ? -1 : 1;
  const S = (x, z) => [raSX(sc.offHome ? z : 100 - z) - cx, RA_TOP + (RAX + x * flipX) * PY - cy];
  // Line of scrimmage and line to gain.
  const vline = (z, col) => { const [x] = S(0, z); g.fillStyle = col; g.fillRect(Math.round(x), RA_TOP + 2 * K - cy, K, RA_FIELD_H - 4 * K); };
  g.globalAlpha = 0.75;
  vline(sc.z0, '#4aa8ff');
  if (sc.ltg) vline(sc.ltg, '#ffe000');
  g.globalAlpha = 1;
  const attackRight = !sc.offHome;
  const items = [];
  // Goalposts: yellow, 18'6" between the uprights, the crossbar 10 ft up, the uprights 35 ft above it.
  for (const H of [-10, 110]) {
    const x = raSX(H) - cx, yc = RA_TOP + RAX * PY - cy;
    if (x < -80 || x > W + 80) continue;
    const bar = RA_BAR * HK, top = RA_POST_TOP * HK, d = RA_UPRIGHT * PY;
    const xf = Math.round(x + raPostShift(H, -RA_UPRIGHT)), xn = Math.round(x + raPostShift(H, RA_UPRIGHT));
    const yF = Math.round(yc - d), yN = Math.round(yc + d);
    const post = (px, y0, y1) => {                    // a vertical tube: dark edge, shade, yellow, highlight
      g.fillStyle = '#1a1405'; g.fillRect(px - 2, y1 - 1, 5, y0 - y1 + 2);
      g.fillStyle = '#c9a400'; g.fillRect(px - 1, y1, 3, y0 - y1);
      g.fillStyle = '#f7d417'; g.fillRect(px - 1, y1, 2, y0 - y1);
      g.fillStyle = '#fff39a'; g.fillRect(px - 1, y1, 1, y0 - y1);
    };
    items.push({ y: yF, draw: () => post(xf, yF - bar, yF - top) });
    items.push({ y: yc, draw: () => {
      const xb = raSX(H < 0 ? -12 : 112) - cx;         // the offset post, two yards behind the end line
      g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(Math.min(xb, x) - 2, yc - 1, Math.abs(xb - x) + 5, 3);
      post(xb, yc, yc - bar + 3 * K);
      const armY = yc - bar + 3 * K, x0a = Math.min(xb, x), x1a = Math.max(xb, x);
      g.fillStyle = '#1a1405'; g.fillRect(x0a - 1, armY - 2, x1a - x0a + 3, 5);
      g.fillStyle = '#f7d417'; g.fillRect(x0a, armY - 1, x1a - x0a + 1, 3);
      g.fillStyle = '#1a1405'; g.fillRect(x - 2, yc - bar - 1, 5, 3 * K + 2);
      g.fillStyle = '#f7d417'; g.fillRect(x - 1, yc - bar, 3, 3 * K);
      // The crossbar, from the far upright to the near one.
      const steps = Math.max(Math.abs(xn - xf), Math.abs(yN - yF));
      for (const [col, w, o] of [['#1a1405', 5, -2], ['#c9a400', 3, -1], ['#f7d417', 2, -1]]) {
        g.fillStyle = col;
        for (let i = 0; i <= steps; i++) { const u = i / steps; g.fillRect(Math.round(xf + (xn - xf) * u) + o, Math.round(yF - bar + (yN - yF) * u) + o, w, w); }
      }
    } });
    items.push({ y: yN, draw: () => post(xn, yN - bar, yN - top) });
  }
  const defBall = sc.ball.some((q) => q.a && q.a.side === 'd' && t >= q.t0);   // a turnover: the defense has it
  for (const a of sc.actors) {
    if (a.showFrom != null && t < a.showFrom) continue;
    const [x, z] = raPos(a, t);
    const [sx, sy] = S(x, z);
    if (sx < -40 || sx > W + 40 || sy < -20 || sy > RA_H + 60) continue;
    if (a.role === 'STR') {                                           // the stretcher, just behind the man on it
      const h = raStrH(a, t);
      items.push({ y: sy - 0.01, draw: () => {
        const spr = raStretcherSprite(), X = Math.round(sx), Y = Math.round(sy);
        g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(X - 22, Y - 2, 45, 5);
        g.drawImage(spr, X - spr.width / 2, Y - spr.height + 2 - Math.round(h * HK));
      } });
      continue;
    }
    const [ox, oz] = raPos(a, Math.max(0, t - 0.1));
    const speed = Math.hypot(x - ox, z - oz) / 0.1;
    const [px] = S(ox, oz);
    if (Math.abs(sx - px) > 0.25 * K) a.face = sx > px ? 'r' : 'l';
    const inHuddle = sc.hud?.[a.side] && (sc.huddle || t < (sc.hudUntil ?? 0));
    if (!a.face || (t < sc.tS && speed < 0.5 && !sc.huddle && !inHuddle)) a.face = (a.side === 'o') === attackRight ? 'r' : 'l';
    // In a huddle everyone faces its middle (2026-09-28, user: "all players should face into the
    // huddle, not out of it"); a man still jogging in faces where he's going.
    if (inHuddle && speed < 0.5) { const [hx] = S(...sc.hud[a.side]); if (Math.abs(hx - sx) > K) a.face = hx > sx ? 'r' : 'l'; }
    // The QB faces the line of scrimmage for the whole play, dropping back or rolling out included
    // (2026-09-28, user), until the defense has the ball or the play is over.
    if (a.role === 'QB' && a.side === 'o' && !sc.huddle && !sc.timeout && !sc.halftime && !inHuddle && t < (sc.tEnd ?? sc.T) && !defBall) a.face = attackRight ? 'r' : 'l';
    // (A hoisted kicker is drawn after the men under him.)
    items.push({ y: sy + (a.hoist && t >= a.hoist.t0 - 0.3 && t <= a.hoist.t1 ? 40 : 0), draw: () => {
      const pal = raPalette(sc, a);
      const X = Math.round(sx), Y = Math.round(sy);
      g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(X - 8, Y - 2, 17, 4); g.fillRect(X - 10, Y - 1, 21, 2);
      const down = a.downAt != null && t > a.downAt + 0.1 && !(a.upAt != null && t > a.upAt);
      let pose = raPoseAt(sc, a, t);
      let lift = 0, flip = a.face === 'l';
      if (a.jumpAt != null && t > a.jumpAt && t < a.jumpAt + 5) {
        lift = Math.round(Math.abs(Math.sin((t - a.jumpAt) * 7)) * 7 * K);
        if (a.cheer && lift > K) pose = 'cheer';
      }
      if (a.danceAt != null && t > a.danceAt && !down) {       // the scorer's end-zone dance
        const ph = Math.floor((t - a.danceAt) * 4);
        pose = ph % 2 ? 'cheer' : 'dance';
        flip = Math.floor((t - a.danceAt) * 2) % 2 === 1;
        lift = ph % 4 === 1 ? 3 * K : 0;
      }
      if (sc.huddle && t > sc.arrived && !down) lift = (Math.floor(t * 2.4 + a.phase * 3) % 2) * K;   // bouncing on their toes
      else if (!down && speed < 0.3 && (a.side === 'o' || a.side === 'd') && t > (sc.tEnd ?? sc.T) + 0.6 && !a.danceAt && !a.jumpAt) lift = Math.floor(t * 1.3 + a.phase * 5) % 3 === 0 ? K : 0;
      if (a.side === 'r') { pose = speed > 0.8 ? RA_RUN[Math.floor(t * (speed < 3.5 ? 5 : 9)) % 4] : 'stand'; lift = 0; }
      if (a.side === 'c') {
        if (a.danceFrom != null && t > a.danceFrom) {             // a synchronized routine
          const beat = Math.floor((t - a.danceFrom) / 0.32);
          pose = ['ch1', 'ch2', 'ch3', 'ch2'][beat % 4];
          lift = beat % 4 === 1 ? 2 * K : 0;
          flip = Math.floor(beat / 8) % 2 === 1;
        } else { pose = 'ch1'; lift = speed > 0.8 ? (Math.floor(t * 8) % 2) * 2 * K : 0; }
      }
      if (a.side === 'm') {                                         // trainers face the stretcher between them
        const [qx] = S(...raPos(a.str, t));
        flip = qx < sx;
        pose = pose === 'hold' ? 'hold' : speed > 0.6 ? RA_CRUN[Math.floor(t * 6 + a.idx) % 4] : 'carry';
        lift = 0;
      }
      if (a.onStr && t >= a.onStr.from) lift = Math.round(raStrH(a.onStr.str, t) * HK) + 3;   // on the stretcher
      // (Last, so no idle bounce or cheer overrides it.)
      if (a.hoist && t >= a.hoist.t0 && t <= a.hoist.t1) { lift = Math.round(raHoistLift(a.hoist, t) * K); pose = 'cheer'; }
      else if (a.carrying && t >= a.carrying[0] && t <= a.carrying[1]) { pose = 'cheer'; lift = 0; }   // arms up, holding him
      a.drawn = { pose, flip, lift };
      const spr = raSprite(pose, pal, flip, a.num);
      g.drawImage(spr, X - spr.ax, Y - spr.ay - lift);
    } });
  }
  for (const a of sc.halftime ? [] : raBench(sc)) {           // (the teams are in the locker room at halftime)
    const sx = a.wx + Math.sin(t * a.w + a.ph) * a.amp - cx, sy = a.wy - cy;
    if (sx < -24 || sx > W + 24 || sy < -8 || sy > RA_H + 44) continue;
    const vx = Math.cos(t * a.w + a.ph) * a.amp * a.w;              // pixels a second
    items.push({ y: sy, draw: () => {
      const pal = raPalette(sc, a);
      const cheering = sc.tdAt != null && t > sc.tdAt + 0.3 && a.side === sc.tdSide;
      let pose = Math.abs(vx) > 1.2 * K ? RA_RUN[Math.floor(t * 5 + a.ph) % 4] : 'stand', lift = 0;
      if (cheering) { lift = Math.round(Math.abs(Math.sin((t + a.ph) * 6)) * 5 * K); if (lift > K) pose = 'cheer'; }
      const face = a.amp ? vx > 0 : Math.floor((t + a.ph) / a.flipT) % 2 === 0;
      const X = Math.round(sx), Y = Math.round(sy);
      g.fillStyle = 'rgba(0,30,0,0.35)'; g.fillRect(X - 8, Y - 1, 17, 2);
      const spr = raSprite(pose, pal, !face, a.num);
      g.drawImage(spr, X - spr.ax, Y - spr.ay - lift);
    } });
  }
  const b = raBall(sc, t);
  let [bx, by] = S(b.x, b.z);
  const byKey = b.held ? S(...raPos(b.held, t))[1] + 0.5 : by + 0.5;
  if (!sc.noBall) items.push({ y: byKey, draw: () => {
    let yb, xb = bx, k = 0;
    if (b.held) {
      const h = b.held.drawn || { pose: 'stand', flip: b.held.face === 'l', lift: 0 };
      const o = RA_HOLD[h.pose] || RA_HOLD.stand;
      const [hx, hy] = S(...raPos(b.held, t));
      xb = Math.round(hx) + (h.flip ? -1 : 1) * o[0]; yb = Math.round(hy) - o[1] - h.lift;
    } else {
      const Hb = sc.offHome ? b.z : 100 - b.z;
      if (b.roll === 'end') {                          // a place kick: shifts with the posts as it nears them
        const dPost = Math.min(Math.abs(Hb - 110), Math.abs(Hb + 10));
        xb += raPostShift(Hb, b.x * flipX) * clamp(1 - (dPost - 3) / 9, 0, 1);
      }
      if (b.h > 0.4) { g.fillStyle = 'rgba(0,30,0,0.4)'; g.fillRect(Math.round(xb) - 4, Math.round(by) - 1, 9, 3); }
      yb = by - b.h * HK;
      if (b.roll === 'tee') k = 4;
      else if (b.flying && b.roll === 'end') k = Math.floor(t * 16) % 8;
      else if (b.flying) {                             // a spiral points along its flight
        const p = raBall(sc, t - 0.04), [qx, qy] = S(p.x, p.z);
        const a = Math.atan2(yb - (qy - p.h * HK), xb - qx);
        k = ((Math.round(a / (Math.PI / 8)) % 8) + 8) % 8;
      }
    }
    const spr = raBallSprite(k);
    g.drawImage(spr, Math.round(xb - spr.width / 2), Math.round(yb - spr.height / 2));
  } });
  for (const e of sc.events) {
    if (e.kind !== 'flag' || t < e.t) continue;
    const u = clamp((t - e.t) / 0.7, 0, 1);
    const x = e.from[0] + (e.to[0] - e.from[0]) * u, z = e.from[1] + (e.to[1] - e.from[1]) * u;
    const [fx, fy] = S(x, z);
    items.push({ y: fy, draw: () => { const yy = Math.round(fy - 4 * 10 * K * u * (1 - u)), X = Math.round(fx); g.fillStyle = '#0c0c0c'; g.fillRect(X - 3 * K, yy - 3 * K, 6 * K, 5 * K); g.fillStyle = '#ffe000'; g.fillRect(X - 2 * K, yy - 2 * K, 4 * K, 3 * K); g.fillStyle = '#fff6a0'; g.fillRect(X - 2 * K, yy - 2 * K, 4 * K, K); } });
  }
  items.sort((p, q) => p.y - q.y).forEach((it) => it.draw());
  if (st.ruler) {
    g.fillStyle = 'rgba(8,24,12,0.55)'; g.fillRect(0, RA_H - 11 * K, W, 11 * K);
    RA_RULER.size || [...Array(11)].forEach((_, i) => { const H = i * 10; const n = H === 0 || H === 100 ? 'G' : String(H <= 50 ? H : 100 - H); RA_RULER.set(H, bigLabel(n, K, '#ffffff', '#123d8a')); });
    for (let H = 0; H <= 100; H += 10) {
      const x = raSX(H) - cx;
      if (x < -24 || x > W + 24) continue;
      const lab = RA_RULER.get(H);
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(Math.round(x), RA_H - 11 * K, K, 2 * K);
      g.drawImage(lab, Math.round(x - lab.width / 2), RA_H - 9 * K);
      const dir = H > 0 && H < 50 ? 1 : H > 50 && H < 100 ? -1 : 0;     // points toward the nearer goal
      if (dir) { const ax = Math.round(x + dir * (lab.width / 2 + 3 * K)); g.fillRect(ax, RA_H - 7 * K, K, 3 * K); g.fillRect(ax + dir * K, RA_H - 6 * K, K, K); }
    }
  }
  // Name tags for the players in the play text, stacked so none overlap.
  const placed = [];
  const order = [...sc.actors].sort((p, q) => (b.held === q) - (b.held === p));
  const withBall = b.held ? b.held.side : 'o';
  for (const a of order) {
    const hurtTag = a.injTag && t >= a.injTag[0] && t <= a.injTag[1];
    if (!a.who || (a.side !== withBall && !hurtTag)) continue;
    if (!hurtTag && (a.labelAt == null || t < a.labelAt) && b.held !== a) continue;
    if (!hurtTag && a.labelTo != null && t > a.labelTo && b.held !== a) continue;
    const [sx, sy0] = S(...raPos(a, t)), sy = sy0 - (hurtTag || a.hoist ? a.drawn?.lift || 0 : 0);
    const txt = a.who.last.toUpperCase();
    const w = pixW(txt, K) + 4 * K, h = 9 * K;
    const lx = clamp(Math.round(sx - w / 2), K, W - w - K);
    let ly = Math.round(sy) - 40 - h;
    // Carried off along the far sideline he is at the top edge, under the banner: tag him from below.
    if (hurtTag && ly < 28 * K) ly = Math.round(sy0) + 4 * K;
    for (let n = 0; n < 4; n++) { const hit = placed.find((r) => lx < r[0] + r[2] && lx + w > r[0] && ly < r[1] + r[3] && ly + h > r[1]); if (!hit) break; ly = hit[1] - h - K; }
    ly = clamp(ly, K, RA_H - h - K);
    placed.push([lx, ly, w, h]);
    const bg = sc.col[a.side];
    g.fillStyle = '#0c0c0c'; g.fillRect(lx - K, ly - K, w + 2 * K, h + 2 * K);
    g.fillStyle = '#ffffff'; g.fillRect(lx, ly, w, h);
    g.fillStyle = bg; g.fillRect(lx + K, ly + K, w - 2 * K, h - 2 * K);
    pixText(g, txt, lx + 2 * K, ly + 2 * K, onColor(bg), K);
  }
  try { raBugDraw(g, W, RA_H, st); } catch (err) { /* the bug never stops the play drawing */ }
}

/* ═════════════ Score bug ═════════════ */
// 2026-09-28, user: "add a little SNF style (retro) score bug at the bottom of the 8 bit screen
// showing score, time and down and distance". Drawn into the canvas in the scoreboard font, centred
// along the bottom (just above the yard ruler where there is one): each team's abbreviation on its
// colour with its score, a football by the team with the ball, the quarter and clock, and the down
// and distance. A play shows the score before the snap until its result appears, then after it, so
// the bug never gives a play away (and agrees with the page's held score). ESPN's score on a
// touchdown already carries the try, which plays as its own scene: the touchdown shows the six, the
// try the rest. Between plays (huddle, timeout, halftime) it shows the game as it is.
const RA_BUG_NAVY = '#16235e', RA_BUG_GOLD = '#ffd21f', RA_BUG_INK = '#101010';
function raBugPlay(p) {
  const list = raPlays();
  let cur = { a: 0, h: 0 }, hit = null;
  for (let i = 0; i < list.length && !hit; i++) {
    const q = list[i], pre = cur;
    let post = q.away != null && q.home != null ? { a: +q.away, h: +q.home } : cur;
    const nx = list[i + 1];
    if (nx?.pat && String(nx.id) === `${q.id}-pat`) post = { a: post.a > pre.a ? Math.min(post.a, pre.a + 6) : post.a, h: post.h > pre.h ? Math.min(post.h, pre.h + 6) : post.h };
    if (String(q.id) === String(p.id)) hit = { pre, post };
    cur = post;
  }
  if (!hit) { const s = p.away != null && p.home != null ? { a: +p.away, h: +p.home } : { a: +(G.ev.away.score || 0), h: +(G.ev.home.score || 0) }; hit = { pre: s, post: s }; }
  const dd = p.pat ? (/two/i.test(p.typeText) ? '2-PT TRY' : 'PAT') : p.kind === 'kickoff' ? 'KICKOFF' : String(p.sDD || '').split(' at ')[0];
  return { ...hit, clock: p.period ? `${periodLabel(p.period)}${p.clock ? ' ' + p.clock : ''}` : '', dd: dd.toUpperCase(),
    poss: p.offId === G.ev.home.id ? 'h' : p.offId === G.ev.away.id ? 'a' : null };
}
function raBugLive(ev) {
  const s = ev.sit || {}, half = isHalftime(ev), sc = { a: +(ev.away.score || 0), h: +(ev.home.score || 0) };
  const clock = ev.state === 'post' ? 'FINAL' : half ? 'HALF' : ev.state === 'in' ? `${periodLabel(ev.period)} ${ev.clock || ''}`.trim() : '';
  const dd = ev.state === 'in' && !half ? s.shortDownDistanceText || String(s.downDistanceText || '').split(' at ')[0] : '';
  return { pre: sc, post: sc, clock, dd: dd.toUpperCase(), poss: ev.state !== 'in' || half ? null : s.possession === ev.home.id ? 'h' : s.possession === ev.away.id ? 'a' : null };
}
// The bug's pieces and their widths at scale k: abbreviation boxes sized for the longer name, score
// boxes for two digits and the football, a clock box for "Q4 15:00", a down box for "4TH & GOAL",
// so the bug keeps one width from play to play.
function raBugLayout(v, k) {
  const pad = 2 * k, len = (s, n) => Math.max(n, String(s).length);
  const abW = bigW('X'.repeat(len(v.aAb.length > v.hAb.length ? v.aAb : v.hAb, 2)), k) + 2 * pad;
  const scW = bigW('0'.repeat(len(Math.max(v.a, v.h), 2)), k) + 2 * pad + 5 * k;
  const segs = [
    { w: abW, bg: v.aCol, fg: onColor(v.aCol), tx: v.aAb }, { w: scW, bg: RA_BUG_INK, fg: '#ffffff', tx: String(v.a), score: true, ball: v.poss === 'a' },
    { gap: k },
    { w: abW, bg: v.hCol, fg: onColor(v.hCol), tx: v.hAb }, { w: scW, bg: RA_BUG_INK, fg: '#ffffff', tx: String(v.h), score: true, ball: v.poss === 'h' },
    { gap: k },
    { w: bigW('X'.repeat(len(v.clock, 8)), k) + 2 * pad, bg: RA_BUG_NAVY, fg: '#ffffff', tx: v.clock, clock: true },
    { gap: k },
    { w: bigW('X'.repeat(len(v.dd, 10)), k) + 2 * pad, bg: RA_BUG_INK, fg: RA_BUG_GOLD, tx: v.dd, dd: true },
  ];
  const inner = segs.reduce((n, s) => n + (s.gap || s.w), 0);
  return { segs, w: inner + 4 * k, h: 11 * k + 4 * k, k };
}
function raBugImage(L) {
  const { k, segs } = L;
  const c = document.createElement('canvas');
  c.width = L.w + 2 * k; c.height = L.h + 2 * k;                   // room for the hard drop shadow
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(2 * k, 2 * k, L.w, L.h);
  g.fillStyle = RA_BUG_INK; g.fillRect(0, 0, L.w, L.h);
  g.fillStyle = '#ffffff'; g.fillRect(k, k, L.w - 2 * k, L.h - 2 * k);
  let x = 2 * k;
  const y = 2 * k, h = 11 * k;
  for (const s of segs) {
    if (s.gap) { x += s.gap; continue; }
    s.x = x;
    g.fillStyle = s.bg; g.fillRect(x, y, s.w, h);
    const room = s.w - (s.score ? 6 * k : 0), tw = bigW(s.tx, k);
    const tx = x + Math.round((room - tw) / 2 / k) * k;
    if (s.tx) bigText(g, s.tx, tx, y + 2 * k, s.fg, k);
    if (s.ball) {                                                    // the football, laces up
      const bx = x + s.w - 6 * k, by = y + 4 * k;
      g.fillStyle = '#b0642c'; g.fillRect(bx + k, by, 2 * k, 3 * k); g.fillRect(bx, by + k, 4 * k, k);
      g.fillStyle = '#ffffff'; g.fillRect(bx + k, by + k, 2 * k, k);
    }
    x += s.w;
  }
  return c;
}
function raBugDraw(g, W, H, st) {
  const sc = st.sc, ev = (sc?.studio && sc.ev) || G?.ev;
  if (!sc || !ev?.home?.abbr || !ev?.away?.abbr) return;
  const play = sc.play && sc.play.kind !== 'set' ? sc.play : null;
  if (play && !sc.bugP) { sc.bugP = raBugPlay(play); sc.bugAt = sideResultAt(sc); }
  const s = play ? sc.bugP : raBugLive(ev);
  const score = play && st.t >= sc.bugAt ? s.post : s.pre;
  const pc = pair(ev.away, ev.home);
  const v = { aAb: ev.away.abbr, hAb: ev.home.abbr, a: score.a, h: score.h, clock: s.clock, dd: s.dd, poss: s.poss, aCol: pc.aRaw, hCol: pc.hRaw };
  const key = JSON.stringify(v) + `|${W}|${H}|${st.ruler ? 1 : 0}`;
  if (st.bugKey !== key) {
    // As large as fits in 90% of the width, between 2 and 4 canvas pixels to a glyph pixel.
    const w1 = raBugLayout(v, 1).w, k = clamp(Math.floor((W * 0.9) / w1), 2, 2 * RA_K);
    const L = raBugLayout(v, k);
    const x = Math.round((W - L.w) / 2), y = H - (st.ruler ? 11 * RA_K : 0) - L.h - 2 * k;
    st.bugKey = key; st.bugImg = raBugImage(L);
    st.bugState = { ...v, k, rect: [x, y, L.w, L.h], segs: L.segs.filter((q) => !q.gap).map((q) => ({ x: x + q.x, w: q.w, tx: q.tx, bg: q.bg })) };
  }
  const [x, y] = st.bugState.rect;
  g.drawImage(st.bugImg, x, y);
}

/* ═════════════ The viewer ═════════════ */
const RA_PAT_RE = /extra point|two[- ]point|conversion|kick attempt|\bpat\b/i;
function raPatFrom(p, prev) {
  const t = p.text || '';
  const homeScored = (p.home ?? 0) > (prev?.home ?? 0) && !((p.away ?? 0) > (prev?.away ?? 0));
  const awayScored = (p.away ?? 0) > (prev?.away ?? 0);
  const team = homeScored ? G.ev.home.id : awayScored ? G.ev.away.id : p.offId;
  const home = team === G.ev.home.id;
  const sH = home ? 85 : 15;                        // a kicked try is snapped from the 15…
  // Injuries written after the try belong to the try.
  const tryTail = RA_TRY_RE.exec(t)?.[0] || '';
  const injTx = [...tryTail.matchAll(RA_INJ_RE)].map((m) => ` ${m[0]}.`).join('');
  const base = { id: p.id + '-pat', period: p.period, clock: p.clock, away: p.away, home: p.home, offId: team, sH, eH: null, sDD: '', sPos: '', down: null, dist: null,
    parts: [], scoring: false, turnover: false, penYards: 0, endTeam: team, pat: true };
  // NFL: "T.Smack extra point is GOOD, Center-M.Orzech, Holder-D.Whelan." — "is" sits between
  // "extra point" and the result, which the college text never had.
  let m = /(?:#(\d+)\s*)?([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)?)\s+(?:kick attempt|extra point)\s+(?:is\s+)?(good|failed|no good|blocked|missed)/i.exec(t)
    || /\(([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)*) (Kick|Kick Failed|PAT Failed|PAT Blocked)\)/.exec(t);
  if (m) {
    const good = m.length > 3 ? /good/i.test(m[3]) && !/no good/i.test(m[3]) : /^kick$/i.test(m[2]);
    const who = m.length > 3 ? `${m[1] ? '#' + m[1] + ' ' : ''}${m[2]}` : m[1];
    return { ...base, kind: 'fg', typeText: good ? 'Extra Point Good' : 'Extra Point Missed', text: `${who} extra point ${good ? 'GOOD' : 'NO GOOD'}.${injTx}`, yards: 20 };
  }
  // NFL: "TWO-POINT CONVERSION ATTEMPT. M.Penix pass to C.Blair is complete. ATTEMPT SUCCEEDS."
  m = /TWO-POINT CONVERSION ATTEMPT\.([\s\S]*?)ATTEMPT (SUCCEEDS|FAILS)/i.exec(t);
  if (m) {
    const seg = m[1];
    const good = /SUCCEEDS/i.test(m[2]);
    const how = /\b(?:rush(?:es)?|runs?)\b/i.test(seg) && !/\bpass\b/i.test(seg) ? 'rush' : 'pass';   // ("C.Hubbard rushes up the middle")
    const nm = /(?:#(\d+)\s*)?([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)?)\s+(?:pass|rush|run)/i.exec(seg);
    const who = nm ? `${nm[1] ? '#' + nm[1] + ' ' : ''}${nm[2]} ` : '';
    const text = how === 'pass' ? `${who}pass ${good ? 'complete' : 'incomplete'} short middle, two-point conversion ${good ? 'good' : 'failed'}` : `${who}rush middle, two-point conversion ${good ? 'good' : 'failed'}`;
    return { ...base, sH: home ? 98 : 2, kind: how === 'pass' ? (good ? 'pass' : 'incomplete') : 'run', typeText: 'Two-Point Conversion', text: text + injTx, yards: good ? 2 : 0, eH: good ? (home ? 100 : 0) : (home ? 98 : 2) };   // …a two-point try from the 2
  }
  // Older/alternate phrasing, kept as a fallback.
  m = /(?:#(\d+)\s*)?([A-Z][\w.'’-]+(?: [A-Z][\w.'’-]+)?)\s+(pass|rush|run)\s+(?:attempt|conversion)\s+(good|failed)/i.exec(t) || /two[- ]point (pass|rush|run)? ?conversion (good|failed)/i.exec(t);
  if (m) {
    const good = /good/i.test(m[m.length - 1]);
    const how = (m.length > 4 ? m[3] : m[1] || 'rush').toLowerCase() === 'pass' ? 'pass' : 'rush';
    const who = m.length > 4 && !/^two[- ]point$/i.test(m[2]) ? `${m[1] ? '#' + m[1] + ' ' : ''}${m[2]} ` : '';
    const text = how === 'pass' ? `${who}pass ${good ? 'complete' : 'incomplete'} short middle, two-point conversion ${good ? 'good' : 'failed'}` : `${who}rush middle, two-point conversion ${good ? 'good' : 'failed'}`;
    return { ...base, sH: home ? 98 : 2, kind: how === 'pass' ? (good ? 'pass' : 'incomplete') : 'run', typeText: 'Two-Point Conversion', text: text + injTx, yards: good ? 2 : 0, eH: good ? (home ? 100 : 0) : (home ? 98 : 2) };   // …a two-point try from the 2
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
// What really happened on each play of a finished game: nflverse play-by-play (air yards, yards after
// the catch, QB hits) and FTN charting (formation, hash, box count, pass rush, play action, motion,
// screens), through netlify/functions/pbpdetail.mjs, keyed by ESPN play id. Asked for once per game
// view, only once the game is over (nflverse posts a game the night it ends; FTN a day or two later).
// Nothing breaks without it: plays are then staged from their text alone.
const RA_HASH = { L: -3.08, M: 0, R: 3.08 };
const raDetail = (p) => G?.pbp?.[String(p.id)] || {};
function raDetailLoad() {
  if (!G?.ev || G.ev.state !== 'post' || G.pbpAsked) return;
  G.pbpAsked = true;
  const id = G.id;
  fetch(`/.netlify/functions/pbpdetail?event=${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (G?.id === id && d?.ok && d.plays) { G.pbp = d.plays; G.pbpFtn = !!d.ftn; raCredit(); } })
    .catch(() => {});
}
// FTN's licence (CC-BY-SA 4.0) asks for the credit wherever its charting is used.
function raCredit() {
  // (Only FTN's credit: its CC-BY-SA licence requires it; the "Play detail: nflverse." line went, as
  // did the viewer's "Drawn from the play-by-play…" note, 2026-09-28, user: "get rid of this text".)
  const txt = G?.pbp && G.pbpFtn ? 'Charting: FTN Data via nflverse.' : '';
  for (const host of [$('#big-tecmo'), $('#ra .ra-in')]) {
    if (!host) continue;
    let el = host.querySelector('.ra-credit');
    if (!txt) { el?.remove(); continue; }
    if (!el) { el = document.createElement('p'); el.className = 'ra-credit'; host.appendChild(el); }
    el.textContent = txt;
  }
}
// Who threw in this game ("offId:name"), and who carried it without ever throwing ("rb:offId:name"):
// a pass to a man who also runs the ball goes to a back, not a wide receiver.
function raQBs() {
  const set = new Set(), runs = [];
  for (const f of G?.sum?.flat || []) {
    const tx = cleanText(f.p.text).replace(/^(?:No Huddle[- ]?)?(?:Shotgun|Pistol|Under Center)?\s*/i, '');
    const m = new RegExp(RA_PL + ' pass\\b').exec(tx);
    if (m) set.add(`${f.p.offId}:${m[1] || m[2]}`);
    else if (f.p.kind === 'run') { const r = new RegExp(RA_PL + '\\s+(?:left|right|up the middle)\\b').exec(tx); if (r) runs.push(`${f.p.offId}:${r[1] || r[2]}`); }
  }
  for (const k of runs) if (!set.has(k)) set.add('rb:' + k);
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
  </div>`;
  m.hidden = false;
  RA.open = true;
  raCredit();
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
  if (h === 'auto') h = clamp(Math.round(r.height * (r.width > 560 ? 0.88 : 0.96) * RA_K), 210 * RA_K, RA_WORLD_H);   // desktop: stands to benches; phone: a bit closer             // most of the field's width, the stands and the benches
  cv.height = h;
  cv.width = Math.max(100, Math.round(h * r.width / (r.height || 1)));
  // Hard pixel edges while every canvas pixel gets at least a screen pixel; on a stage drawn smaller
  // than that (the sidebar card on a 1x screen), nearest-neighbour would drop whole rows and columns
  // of the art, so the browser filters it instead.
  const dev = r.height * (window.devicePixelRatio || 1);
  cv.style.imageRendering = dev > 0 && dev < h * 0.95 ? 'auto' : '';
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
  if (sc.studio) { raStudioDraw(cv.getContext('2d'), W, st); return; }   // halftime: the desk, no field or camera
  if (st.htOn) { st.htOn = false; st.htKey = null; cv.parentElement?.querySelector('.ht-bub')?.classList.remove('on'); }
  if (st.htSoonOn) { st.htSoonOn = false; const el = cv.parentElement?.querySelector('.ht-soon'); if (el) el.hidden = true; }
  const Hb = (z) => (sc.offHome ? z : 100 - z);
  const Yb = (x) => RA_TOP + (RAX + x * (sc.offHome ? -1 : 1)) * PY;
  const b = raBall(sc, st.t), b0 = raBall(sc, Math.max(0, st.t - 0.2));
  const wx = raSX(Hb(b.z)), vx = (wx - raSX(Hb(b0.z))) / 0.2;
  const pre = st.t < sc.tS;
  let tx = pre ? raSX(Hb(sc.camZ ?? sc.z0 - 2)) - W / 2 : wx - W / 2 + clamp(vx * 0.3, -W * 0.25, W * 0.25);
  let ty = (pre ? Yb(sc.x0) : Yb(b.x) - Math.min(b.h * HK, 90 * RA_K) * 0.6) - RA_H * 0.55;
  if (sc.focusFn) { const f = sc.focusFn(st.t); tx = raSX(Hb(f.z)) - W / 2; ty = Yb(f.x) - RA_H * 0.55; }
  else if (sc.injury && st.t > sc.injury.tStart - 0.4) { const f = sc.injury.focus(st.t); tx = raSX(Hb(f.z)) - W / 2; ty = Yb(f.x) - RA_H * 0.55; }
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
  // (The sidebar card's fixed-height canvas grows by the 1.2 the halftime desk's 4:3 frame takes from
  // its width, so it stays wide enough for the score bug at its smallest.)
  const cv = $('#sl-cv'), tall = cv?.parentElement?.classList.contains('studio-tall');
  return bigTecmo() ? { cv: $('#bt-cv'), banner: $('#bt-banner'), h: 'auto' } : { cv, banner: $('#sl-banner'), h: Math.round(128 * RA_K * (tall ? 1.2 : 1)) };
}
function sideLiveOn() {
  const t = sideTarget();
  // Not during an 8-bit replay: the page shows the game as it is while the stage shows the past.
  return !!(G?.ev?.state === 'in' && t.cv && (bigTecmo() || isWide()) && !t.cv.closest('[hidden]') && !isHalftime(G.ev) && !SIDE.rp);
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
  // A replay (or its menu) belongs to the big stage it started on: switching to the field view,
  // or a game view built afresh, drops it.
  if ((SIDE.rp || SIDE.rpMenu) && !(ok && big && (SIDE.rp?.cv || SIDE.rpMenu) === tgt.cv)) { SIDE.rp = null; SIDE.rpMenu = null; tecmoRpBar(); }
  if (!ok) { sideStop(); if (G?.gate && typeof gateOpen === 'function') gateOpen(); return; }
  raDetailLoad();
  // The halftime desk starts over on every visit to the game (a game view opened afresh is a new G):
  // "if you revisit the page while its half time it just replays the same dialogue".
  if (SIDE.gRef !== G) { if (SIDE.sc?.studio) { sideStop(); SIDE.sc = null; } SIDE.gRef = G; }
  if (SIDE.gameId !== G.id) { sideStop(); Object.assign(SIDE, { gameId: G.id, playId: null, setKey: '', timeoutId: null, sc: null, cv: tgt.cv, rp: null, rpMenu: null }); }
  if (SIDE.cv !== tgt.cv) { SIDE.cv = tgt.cv; SIDE.banner = tgt.banner; SIDE.cam = null; if (SIDE.sc) { raSizeCanvas(SIDE.cv, tgt.h); cancelAnimationFrame(SIDE.raf); sideResume(); } }
  if (SIDE.rp) return;                                    // the replay runs its own sequence
  if (isHalftime(G.ev) || htDemo()) { if (!SIDE.sc?.halftime && (!SIDE.running || SIDE.sc?.huddle || SIDE.sc?.timeout || htDemo())) sideHalftime(); return; }
  // A final: the postgame desk (a game that ends while you watch finishes its last play first).
  if (G.ev.state === 'post') { if (!SIDE.sc?.post && (!SIDE.running || SIDE.sc?.huddle || SIDE.sc?.timeout || SIDE.sc?.studio)) sideHalftime(true); return; }
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
  // A play mid-animation finishes up to its result; after that, a newer play cuts in rather than
  // waiting for the walk-back, the huddle or a stretcher. A newer play in the feed means the real game
  // has already moved on (after a real injury the next snap is minutes away, so that carry-off still
  // plays out in full).
  const pastResult = SIDE.running && SIDE.gatePlay == null && SIDE.resultAt != null && SIDE.t >= SIDE.resultAt + 1.2 && SIDE.sc?.tdAt == null;
  if (String(latest.id) !== String(SIDE.playId)) { if (!SIDE.running || pastResult || ((SIDE.sc?.timeout || SIDE.sc?.halftime || SIDE.sc?.huddle) && !SIDE.sc?.clear)) { if (SIDE.sc?.tdAt == null || !SIDE.idle) sidePlay(latest); } }
  else if (!SIDE.running && !SIDE.idle && !SIDE.sc?.huddle) sideHuddle();
}
function sidePlay(p) {
  clearTimeout(SIDE.idle); SIDE.idle = 0;
  SIDE.playId = p.id; SIDE.setKey = ''; SIDE.lastPlay = p;
  let sc = null;
  try { sc = raBuild(p, G.ev, raQBs(), sideFrom(p)); } catch (err) { console.error(err); }
  if (SIDE.gatePlay != null && typeof gameGateRelease === 'function') { gameGateRelease(SIDE.gatePlay); SIDE.gatePlay = null; }   // an earlier play never showed its result
  if (sc) {
    sc.gameId = G.id;
    SIDE.gatePlay = p.id;
    SIDE.resultAt = sideResultAt(sc);
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
// Out of the huddle when the teams are in one and the same offense has the ball.
// Every play starts from the scene before it: the players jog from wherever they were into the formation.
function sideFrom(p) {
  const prevSc = SIDE.sc?.gameId === G.id ? SIDE.sc : null;
  if (!prevSc) return {};
  const offHome = p.offId === G.ev.home.id;
  const pb = raBall(prevSc, SIDE.t);
  const x0 = prevSc.noBall ? 0 : clamp(Math.round(pb.x * (prevSc.offHome === offHome ? 1 : -1) / 3.08) * 3.08, -3.08, 3.08);
  return { from: prevSc, fromT: SIDE.t, x0 };
}
// The moment a play's result shows: the first banner (a gain, "Touchdown", "Incomplete"…) or the whistle.
function sideResultAt(sc) {
  const firstBanner = sc.events.filter((e) => e.kind === 'banner').map((e) => e.t).sort((x, y) => x - y)[0];
  return Math.min(firstBanner ?? Infinity, sc.tEnd ?? sc.T - 1.5);
}
// After a play (not a score, not a kick): both teams jog into their huddles at the next spot.
function sideHuddle() {
  const ev = G?.ev, prev = SIDE.sc;
  let s = ev?.sit;
  if (!prev || prev.huddle || prev.timeout || prev.tdAt != null || !ev || ev.state !== 'in' || isHalftime(ev)) return;
  if (!s?.possession || s.yardLine == null || !(s.down > 0)) {
    const lp = SIDE.lastPlay, pb = raBall(prev, prev.T), bz = prev.spotZ ?? pb.z;     // (a touchback's ball lies in the end zone; the snap is at spotZ)
    const H = prev.offHome ? bz : 100 - bz;
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
  // One play behind: play it. Further behind: go straight to the newest (2026-09-28, user: "I keep
  // having to refresh to see latest play" — stepping through a backlog two plays at a time, each with
  // its huddle, kept the view and the gated score 30–60 s behind the game).
  if (i >= 0 && i === list.length - 2) return list[i + 1];
  return list[list.length - 1];
}
// After the try: the teams clear out and the cheerleaders dance until the kickoff.
// After a touchdown: both teams run to their sidelines, then the kicking units run on for the try.
function sideClear(p) {
  const ev = G.ev, prev = SIDE.sc;
  if (!prev) return;
  const scorer = prev.tdSide === 'd' ? prev.defT.id : prev.offT.id;
  let sc = null;
  try { sc = raTimeout(prev, SIDE.t, ev, scorer, scorer === ev.home.id ? 85 : 15, '', null, true); } catch (err) { console.error(err); return; }
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
// The desk: halftime, or with `post` the postgame show on a final.
function sideHalftime(post) {
  const ev = !post && htDemo() ? htDemoEv() : G.ev;
  sideStop();
  let sc = null;
  try { sc = raHalftime(ev, post); } catch (err) { console.error(err); return; }
  sc.gameId = G.id;
  SIDE.playId = SIDE.playId || null;
  sideText('tag', post ? 'Final' : 'Halftime');
  sideText('meta', `${ev.away.abbr} ${ev.away.score ?? 0} – ${ev.home.score ?? 0} ${ev.home.abbr}`);
  sideText('tx', post ? 'The GFFL postgame desk' : 'The GFFL halftime desk');
  sideRun(sc);
  htLoad(G.ev, post);
  htScript(G.id, post);                             // a script already here (a revisit) plays from its first line
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
    const dt = Math.min(0.05, (now - SIDE.last) / 1000) * (SIDE.rp?.speed || 1);
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
  // The halftime desk on a narrow stage takes a 4:3 frame (a 16:10 phone stage leaves a long line's
  // bubble no room above the heads); set before the canvas is sized to it.
  const stg = SIDE.cv?.parentElement;
  if (stg) stg.classList.toggle('studio-tall', !!sc.studio && stg.clientWidth < 600);

  if (SIDE.banner) { SIDE.banner.classList.remove('on'); SIDE.banner.innerHTML = ''; }
  raSizeCanvas(SIDE.cv, sideTarget().h);             // the small card gets a closer camera
  SIDE.onEnd = onEnd;
  sideResume();
}

/* ═════════════ Replay on the big 8-bit view ═════════════ */
// 2026-09-28, user: "give the option to hit replay like we have on the field view, and then replay
// gives the option for game start or this drive. Add a 2x and 3x option to replay". The plays run
// back to back on the big stage, each one starting from where the last left the players, at 1×, 2×
// or 3× (remembered). New plays keep arriving while it runs; once the replay reaches the newest
// play it hands the stage back to the live view.
const RP_SPEEDS = [1, 2, 3];
const tecmoRpPref = () => { const v = store.get('tecmoSpeed', 1); return RP_SPEEDS.includes(v) ? v : 1; };
// The drive a play belongs to: a synthesised try goes with its touchdown, and the scoreboard's
// newest play (not in the summary yet) with the drive on the field.
function tecmoRpDrive(p) {
  const id = String(p.id).replace(/-pat$/, '');
  const f = (G?.sum?.flat || []).find((x) => String(x.p.id) === id);
  return f ? f.di : (G?.sum?.drives.length ?? 1) - 1;
}
// Where each choice starts in the play list: the opening kickoff, or the first play of the drive
// the newest play is in.
function tecmoRpFrom(list, from) {
  if (from !== 'drive') return 0;
  const d = tecmoRpDrive(list[list.length - 1]);
  const i = list.findIndex((p) => tecmoRpDrive(p) === d);
  return i < 0 ? list.length - 1 : i;
}
function tecmoRpMenu() {
  const cv = sideTarget().cv;
  SIDE.rpMenu = SIDE.rpMenu ? null : cv;
  tecmoRpBar();
  if (SIDE.rpMenu) $('#bt-rp [data-btrp]')?.focus({ preventScroll: true });
}
function tecmoRpStart(from) {
  const list = raPlays();
  if (!G || !list.length) return;
  const i = tecmoRpFrom(list, from);
  sideStop();
  SIDE.rp = { from, id: null, speed: tecmoRpPref(), cv: sideTarget().cv };
  SIDE.rpMenu = null;
  SIDE.sc = null;                              // the first play lines up fresh, not from wherever the live scene was
  if (G.gate && typeof gateOpen === 'function') gateOpen();       // the page shows the game as it is
  tecmoRpPlay(list[i]);
}
function tecmoRpPlay(p) {
  const R = SIDE.rp;
  clearTimeout(SIDE.idle); SIDE.idle = 0;
  R.id = p.id;
  SIDE.playId = p.id; SIDE.setKey = ''; SIDE.lastPlay = p;
  let sc = null;
  try { sc = raBuild(p, G.ev, raQBs(), sideFrom(p)); } catch (err) { console.error(err); }
  sideText('tx', '');
  SIDE.pendingTx = p.text;                     // the play's text shows with its result, as it does live
  tecmoRpBar();
  if (!sc) { SIDE.idle = setTimeout(tecmoRpNext, 400); return; }
  sc.gameId = G.id;
  SIDE.gatePlay = p.id;
  SIDE.resultAt = sideResultAt(sc);
  sideRun(sc, () => { SIDE.idle = setTimeout(tecmoRpNext, 900 / R.speed); });
}
function tecmoRpNext() {
  SIDE.idle = 0;
  const R = SIDE.rp;
  if (!G || !R || !R.cv.isConnected) return;
  const list = raPlays();                      // read again: plays that arrived during the replay are in it
  const i = list.findIndex((p) => String(p.id) === String(R.id));
  if (i < 0 || i >= list.length - 1) { tecmoRpEnd(false); return; }
  tecmoRpPlay(list[i + 1]);
}
// Caught up (early = false): the live view carries on from the newest play just shown.
// Left early: the live view starts over at the newest play.
function tecmoRpEnd(early) {
  SIDE.rp = null; SIDE.rpMenu = null;
  clearTimeout(SIDE.idle); SIDE.idle = 0;
  if (early) { sideStop(); SIDE.sc = null; SIDE.playId = null; SIDE.gatePlay = null; }
  tecmoRpBar();
  sideUpdate();
}
function tecmoRpBar() {
  const R = SIDE.rp, bar = $('#bt-rp');
  $('.stadium')?.classList.toggle('rp8', !!R);
  if (!bar) return;
  bar.hidden = !R && !SIDE.rpMenu;
  if (bar.hidden) { bar.innerHTML = ''; return; }
  const s = R ? R.speed : tecmoRpPref();
  const speeds = `<span class="bt-sp" role="group" aria-label="Replay speed">${RP_SPEEDS.map((v) => `<button data-btspeed="${v}" aria-pressed="${v === s}">${v}×</button>`).join('')}</span>`;
  if (!R) { bar.innerHTML = `<button class="ch" data-btrp="game">${ICON.play}Game start</button><button class="ch" data-btrp="drive">${ICON.play}This drive</button><span class="bt-spw"><span class="bt-rp-l">Speed</span>${speeds}</span>`; return; }
  const p = raPlays().find((x) => String(x.id) === String(R.id));
  const at = p ? `${periodLabel(p.period)}${p.clock ? ' ' + p.clock : ''}` : '';
  bar.innerHTML = `<span class="bt-rp-l">Replay${R.from === 'drive' ? ' · this drive' : ''}${at ? ' · ' + esc(at) : ''}</span>${speeds}<button data-btrp="stop">${G.ev.state === 'in' ? 'Back to live' : 'Exit replay'}</button>`;
}
document.addEventListener('click', (e) => {
  if (!G) return;
  const rb = e.target.closest('[data-btrp]');
  if (rb) { if (rb.dataset.btrp === 'stop') tecmoRpEnd(true); else tecmoRpStart(rb.dataset.btrp); return; }
  const sp = e.target.closest('[data-btspeed]');
  if (sp) {
    const v = +sp.dataset.btspeed;
    store.set('tecmoSpeed', v);
    if (SIDE.rp) SIDE.rp.speed = v;
    tecmoRpBar();
    $(`#bt-rp [data-btspeed="${v}"]`)?.focus({ preventScroll: true });
  }
});
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
