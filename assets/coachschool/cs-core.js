/* Coach School core: pure, no DOM. Loads as a classic script in the page and in a Node `vm`
   context (tools/_verify-coachschool.mjs), so everything hangs off one global `CS`.

   Coordinates are yards. x runs ACROSS the field, 0..53.33, 0 = the offense's left sideline
   (hashes at 23.58 and 29.75, NFL). y is relative to the line of scrimmage, positive = the
   offense's downfield. "L"/"R" anywhere (formation strength, zone names, gap names, defender ids
   like CB-L) always mean the offense's left/right, i.e. smaller/larger x, so one word means one
   place on the field whichever team is talking. Play time t is seconds; the snap is t = 0.

   What lives here: yard geometry, the DSL resolver (formations with dx and side-relative route
   tokens, "in"/"out" resolved by the player's side, zone landmarks, man/rush/spy assignments),
   CS.poseAt(play, t) (pure), validators, and the progress maths (state, XP, coach level, Leitner
   boxes). House rule for that maths: never default with `||` or `??` where 0 is a real value
   (CLAUDE.md, "things that bite" #3). `num()` below is the one way a default is applied. */
(function (root) {
  'use strict';
  const CS = root.CS || (root.CS = {});

  /* ── geometry ── */
  CS.FIELD_W = 53.33;
  CS.BALL_X = 26.67;                 // the ball's x when it is spotted in the middle of the field
  CS.HASH_L = 23.58;                 // NFL hash rows: 70'9" (23.58 yd) in from each sideline
  CS.HASH_R = 29.75;
  // An offensive player with y >= this is on the line of scrimmage. The fact sheet (section 1b,
  // CS convention) puts every on-line player at y = 0 and every off-line player at y <= -1, so
  // the threshold sits between the two. (Phase 1 used -1.0 with provisional alignments; at -1.0
  // the fact sheet's flanker, a yard off the line, would have counted as on it.)
  CS.ON_LINE_Y = -0.5;
  CS.MIN_SPACING = 0.8;              // no two players closer than this at the snap
  CS.DEF_MIN_Y = 0.5;                // a defender must line up past the neutral zone
  // Default running speeds, yd/s (plan: receivers 7, backs 6.5, DBs 6.8, LBs 6, linemen 4).
  CS.SPEEDS = { WR: 7, TE: 7, RB: 6.5, FB: 6.5, QB: 6.5, CB: 6.8, NB: 6.8, S: 6.8, LB: 6, C: 4, G: 4, T: 4, DE: 4, DT: 4, NT: 4 };
  CS.OL = ['C', 'G', 'T'];
  CS.DL = ['DE', 'DT', 'NT'];
  // Gaps by half-split: the fact sheet's line (section 1a) stands 1.5 yd centre to centre
  // (tackles at +-3, an inline tight end at +-4.5), so the gap midpoints sit halfway between and
  // D is the same half-split outside the tight end.
  CS.GAPS = { A: 0.75, B: 2.25, C: 3.75, D: 5.25 };
  CS.REACT = 0.25;                   // a zone or man defender breaks on the ball this long after the throw

  // The library (formations, defenses, zones, routes, plays, BEATS, teams) is filled by cs-lib.js.
  CS.lib = CS.lib || { FORMATIONS: {}, DEFENSES: {}, ZONES: {}, ROUTES: {}, PLAYS: {}, BEATS: {}, TEAMS: {}, LABELS: {} };

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const num = (v, dflt) => (isNum(v) ? v : dflt);
  CS.num = num;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  CS.mirrorX = (x) => 2 * CS.BALL_X - x;
  CS.sideOf = (x, bx) => { const b = isNum(bx) ? bx : CS.BALL_X; return x < b - 0.25 ? 'L' : x > b + 0.25 ? 'R' : 'M'; };
  // Where the ball sits across the field: play.hash 'L' / 'R' puts it on that hash, else the middle.
  CS.ballXOf = (play) => (play && play.hash === 'L' ? CS.HASH_L : play && play.hash === 'R' ? CS.HASH_R : CS.BALL_X);
  // +1 = toward larger x. "in" points at the ball, "out" at the near sideline.
  const inDir = (side) => (side === 'L' ? 1 : side === 'R' ? -1 : 0);
  CS.gapX = (name) => {
    const m = /^([ABCD])-gap-([LR])$/.exec(String(name));
    if (!m) return null;
    return CS.BALL_X + (m[2] === 'L' ? -1 : 1) * CS.GAPS[m[1]];
  };

  /* ── formations & defenses ── */
  // Absolute alignment for one listed player: `x` wins, else `dx` from the ball.
  function alignX(p) { return isNum(p.x) ? p.x : isNum(p.dx) ? CS.BALL_X + p.dx : NaN; }
  // Mirroring swaps the tackles' and guards' names too: the left tackle is whoever stands on the
  // left, so the mirrored right tackle IS the left tackle. Defender ids, zone names and gap names
  // that end in -L / -R (or -LM / -RM) swap the same way; man assignments name offensive players
  // and stay as they are.
  const OL_SWAP = { LT: 'RT', RT: 'LT', LG: 'RG', RG: 'LG' };
  const swapLR = (s) => (typeof s === 'string' ? s.replace(/-(L|R)(M?)$/, (m, a, b) => '-' + (a === 'L' ? 'R' : 'L') + b) : s);
  CS.swapLR = swapLR;
  CS.mirrorFormation = (f) => ({
    ...f, id: f.id + '~m', mirrored: true,
    strength: f.strength === 'L' ? 'R' : f.strength === 'R' ? 'L' : f.strength,
    players: f.players.map((p) => { const q = { ...p }; delete q.dx; q.x = CS.mirrorX(alignX(p)); if (OL_SWAP[q.id]) q.id = OL_SWAP[q.id]; return q; }),
  });
  CS.mirrorDefense = (d) => ({
    ...d, id: d.id + '~m', mirrored: true,
    players: d.players.map((p) => {
      const q = { ...p }; delete q.dx; q.x = CS.mirrorX(alignX(p)); q.id = swapLR(q.id);
      if (q.zone != null) q.zone = swapLR(q.zone);
      if (q.rush != null) q.rush = swapLR(q.rush);
      return q;
    }),
  });
  CS.resolveSet = (f) => f.players.map((p) => ({ id: p.id, pos: p.pos, x: alignX(p), y: p.y, side: CS.sideOf(alignX(p)), src: p }));

  function personnelOf(players) {
    let rb = 0, te = 0, wr = 0, qb = 0, ol = 0;
    for (const p of players) {
      if (p.pos === 'RB' || p.pos === 'FB') rb++;
      else if (p.pos === 'TE') te++;
      else if (p.pos === 'WR') wr++;
      else if (p.pos === 'QB') qb++;
      else if (CS.OL.includes(p.pos)) ol++;
    }
    return { code: `${rb}${te}`, rb, te, wr, qb, ol };
  }
  CS.personnelOf = personnelOf;

  function spacingErrors(list, label) {
    const out = [];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const d = dist([list[i].x, list[i].y], [list[j].x, list[j].y]);
      if (d < CS.MIN_SPACING) out.push(`${label}: ${list[i].id} and ${list[j].id} are ${d.toFixed(2)} yd apart (min ${CS.MIN_SPACING})`);
    }
    return out;
  }
  function boundsErrors(list, label) {
    return list.filter((p) => !(p.x > 0 && p.x < CS.FIELD_W) || !isNum(p.y)).map((p) => `${label}: ${p.id} is out of bounds (x ${p.x})`);
  }

  CS.validateFormation = (f) => {
    const e = [], L = `formation ${f && f.id}`;
    if (!f || !Array.isArray(f.players)) return [`${L}: no players`];
    const ps = CS.resolveSet(f);
    if (ps.length !== 11) e.push(`${L}: ${ps.length} players, not 11`);
    const ids = new Set();
    for (const p of ps) { if (ids.has(p.id)) e.push(`${L}: duplicate id ${p.id}`); ids.add(p.id); }
    for (const p of ps) if (!isNum(p.x)) e.push(`${L}: ${p.id} has neither x nor dx`);
    for (const p of ps) if (p.y > 0) e.push(`${L}: ${p.id} lines up past the ball (y ${p.y})`);
    const line = ps.filter((p) => p.y >= CS.ON_LINE_Y);
    if (line.length !== 7) e.push(`${L}: ${line.length} on the line, need exactly 7`);
    for (const p of ps) if (typeof p.src.on === 'boolean' && p.src.on !== (p.y >= CS.ON_LINE_Y)) e.push(`${L}: ${p.id} says on:${p.src.on} but y ${p.y}`);
    // The two ends of the line must be eligible receivers; an offensive lineman there is covered up.
    if (line.length) {
      const sorted = line.slice().sort((a, b) => a.x - b.x);
      for (const end of [sorted[0], sorted[sorted.length - 1]]) if (CS.OL.includes(end.pos) || end.pos === 'QB') e.push(`${L}: ${end.id} (${end.pos}) is an end of the line but not eligible`);
    }
    const per = personnelOf(ps);
    if (per.ol !== 5) e.push(`${L}: ${per.ol} offensive linemen, need 5`);
    if (per.qb !== 1) e.push(`${L}: ${per.qb} quarterbacks`);
    if (per.rb + per.te + per.wr !== 5) e.push(`${L}: ${per.rb + per.te + per.wr} skill players, need 5`);
    if (String(f.personnel) !== per.code) e.push(`${L}: personnel says ${f.personnel} but counts ${per.code}`);
    e.push(...boundsErrors(ps, L), ...spacingErrors(ps, L));
    return e;
  };

  CS.validateDefense = (d, lib) => {
    lib = lib || CS.lib;
    const e = [], L = `defense ${d && d.id}`;
    if (!d || !Array.isArray(d.players)) return [`${L}: no players`];
    const ps = CS.resolveSet(d);
    if (ps.length !== 11) e.push(`${L}: ${ps.length} players, not 11`);
    const ids = new Set();
    for (const p of ps) { if (ids.has(p.id)) e.push(`${L}: duplicate id ${p.id}`); ids.add(p.id); }
    for (const p of ps) if (!(p.y >= CS.DEF_MIN_Y)) e.push(`${L}: ${p.id} is in the neutral zone or offside (y ${p.y})`);
    for (const p of ps) {
      const a = p.src;
      if (a.zone != null && !lib.ZONES[a.zone]) e.push(`${L}: ${p.id} has unknown zone ${a.zone}`);
      if (a.rush != null && CS.gapX(a.rush) == null) e.push(`${L}: ${p.id} rushes unknown gap ${a.rush}`);
      if (a.zone == null && a.rush == null && a.man == null && a.spy == null) e.push(`${L}: ${p.id} has no assignment`);
    }
    e.push(...boundsErrors(ps, L), ...spacingErrors(ps, L));
    return e;
  };

  // How many defenders play a deep zone at the snap (a man defender is never counted deep).
  CS.deepCount = (d, lib) => {
    lib = lib || CS.lib;
    return d.players.filter((p) => p.zone != null && lib.ZONES[p.zone] && lib.ZONES[p.zone].deep === true).length;
  };

  /* ── routes and paths ── */
  // A route point is [0, dy] (straight up the field) or ["in"|"out", lateral, dy]; both measured
  // from the player's alignment. A bare non-zero lateral number is refused: it could not be
  // mirrored, which is the whole point of the tokens.
  CS.routePoints = (route, start, side) => {
    const pts = [[start[0], start[1]]];
    for (const pt of route.pts) {
      let lat = 0, dy;
      if (typeof pt[0] === 'string') {
        const dir = inDir(side) * (pt[0] === 'in' ? 1 : pt[0] === 'out' ? -1 : NaN);
        lat = dir * pt[1]; dy = pt[2];
      } else { lat = pt[0] === 0 ? 0 : NaN; dy = pt[1]; }
      pts.push([start[0] + lat, start[1] + dy]);
    }
    return pts;
  };
  CS.validateRoute = (name, r) => {
    const e = [];
    if (!r || !Array.isArray(r.pts) || !r.pts.length) return [`route ${name}: no points`];
    for (const pt of r.pts) {
      if (typeof pt[0] === 'string') { if (!['in', 'out'].includes(pt[0]) || !isNum(pt[1]) || !isNum(pt[2])) e.push(`route ${name}: bad point ${JSON.stringify(pt)}`); }
      else if (pt[0] !== 0 || !isNum(pt[1])) e.push(`route ${name}: lateral must be a token or 0 (${JSON.stringify(pt)})`);
    }
    return e;
  };

  // Position along a polyline after `d` yards; `ext` keeps going along the last leg.
  function along(pts, d, ext) {
    if (d <= 0 || pts.length < 2) return pts[0].slice();
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], L = dist(a, b);
      if (d <= L || (i === pts.length - 1 && ext)) {
        if (L === 0) return b.slice();
        const u = d / L;
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      }
      d -= L;
    }
    return pts[pts.length - 1].slice();
  }
  CS.along = along;
  const inField = (p) => [clamp(p[0], 0.4, CS.FIELD_W - 0.4), p[1]];

  /* ── compile a play ── */
  const CACHE = typeof WeakMap === 'function' ? new WeakMap() : null;
  CS.compile = (play, lib) => {
    lib = lib || CS.lib;
    if (CACHE && CACHE.has(play)) return CACHE.get(play);
    let f = lib.FORMATIONS[play.formation];
    if (!f) throw new Error('unknown formation ' + play.formation);
    let d = lib.DEFENSES[play.defense];
    if (!d) throw new Error('unknown defense ' + play.defense);
    // A mirrored play flips BOTH teams: the defenses are written against a formation whose
    // strength is to the right, and the Sam and the strong safety follow the strength.
    if (play.mirror) { f = CS.mirrorFormation(f); d = CS.mirrorDefense(d); }
    // The ball on a hash: everyone, the zone landmarks and the gaps slide across with it (fact
    // sheet section 4: "when the ball is on a hash the landmarks move with it").
    const ballX = CS.ballXOf(play), dX = ballX - CS.BALL_X;
    const shift = (p) => ({ ...p, x: p.x + dX, side: CS.sideOf(p.x + dX, ballX) });
    const off = CS.resolveSet(f).map((p) => ({ ...shift(p), team: 'off' }));
    const def = CS.resolveSet(d).map((p) => ({ ...shift(p), team: 'def' }));
    const byId = {};
    for (const p of off.concat(def)) byId[p.id] = p;
    const ev = (name) => (play.ball || []).find((b) => b.ev === name);
    const snap = ev('snap'), thr = ev('throw'), cat = ev('catch');
    const c = {
      play, off, def, all: off.concat(def), byId, ballX, dX, formation: f, defense: d,
      snapT: snap ? snap.t : 0, throwT: thr ? thr.t : null, catchT: cat ? cat.t : null,
      target: thr ? thr.to : null, qb: off.find((p) => p.pos === 'QB'),
      rac: num(play.rac, 0.7),
    };
    c.downT = c.catchT != null ? c.catchT + c.rac : null;
    c.T = num(play.T, c.downT != null ? c.downT + 0.8 : 4);
    // Offense: every player gets a path (a polyline, a speed, a delay, and whether it runs on).
    const A = play.assign || {};
    for (const p of off) {
      const a = A[p.id] || {};
      const v = num(a.v, CS.SPEEDS[p.pos]);
      const start = [p.x, p.y];
      p.assign = a;
      if (a.route) {
        const r = lib.ROUTES[a.route];
        if (!r) throw new Error('unknown route ' + a.route);
        const side = a.side || p.side;
        p.path = { pts: CS.routePoints(r, start, side), v: num(r.v, v), delay: num(a.delay, 0), ext: r.ext === true };
        p.role = 'route';
      } else if (a.drop != null) {
        const back = a.drop === 5 ? 3.5 : a.drop === 7 ? 5 : 2;          // 3-step from the gun = 2 yd back
        p.path = { pts: [start, [p.x, p.y - back]], v: num(a.v, 4), delay: 0, ext: false };
        p.role = 'qb';
      } else if (a.block) {
        const gx = CS.gapX(a.block);
        p.path = { pts: [start, [gx == null ? p.x : gx + dX, Math.min(p.y + 2, -2)]], v, delay: 0, ext: false };
        p.role = 'block';
      } else if (a.pass) {
        const lat = /-L$/.test(a.pass) ? -0.5 : /-R$/.test(a.pass) ? 0.5 : 0;
        p.path = { pts: [start, [p.x + lat, p.y - 1.1]], v: 2.5, delay: 0, ext: false };
        p.role = 'block';
      } else {
        p.path = { pts: [start], v, delay: 0, ext: false };
        p.role = CS.OL.includes(p.pos) ? 'block' : 'still';
      }
    }
    // Defense: zone drops, rushes, man and spy.
    for (const p of def) {
      const s = p.src, v = num(s.v, CS.SPEEDS[p.pos]), start = [p.x, p.y];
      if (s.zone != null) {
        const z = lib.ZONES[s.zone];
        p.path = { pts: [start, [z.x + dX, z.y]], v, delay: 0, ext: false };
        p.role = 'zone';
      } else if (s.rush != null) {
        p.path = { pts: [start, [CS.gapX(s.rush) + dX, -0.4]], v, delay: 0, ext: false };
        p.role = 'rush';
      } else if (s.man != null) {
        p.role = 'man'; p.manOf = s.man;
      } else if (s.spy != null) {
        p.role = 'spy'; p.spyOf = s.spy;
      } else { p.path = { pts: [start], v, delay: 0, ext: false }; p.role = 'still'; }
    }
    if (CACHE) CACHE.set(play, c);
    return c;
  };

  // Where the offense is at t (no defensive reactions needed: the offense never reads the defense here).
  function offPos(c, p, t) {
    const path = p.path, tt = t - c.snapT;
    if (c.downT != null && p.id === c.target && t > c.downT) return offPos(c, p, c.downT);
    const d = path.v * (tt - path.delay);
    return inField(along(path.pts, d, path.ext));
  }
  function defPlanned(c, p, t) {
    const tt = t - c.snapT;
    if (p.role === 'man') {
      const r = c.byId[p.manOf];
      const lag = Math.max(0, t - 0.2);
      const rp = offPos(c, r, lag);
      const off0 = [p.x - r.x, p.y - r.y], cush = [0, 1.0];
      const u = clamp(tt / 1.2, 0, 1);
      return [rp[0] + off0[0] + (cush[0] - off0[0]) * u, rp[1] + off0[1] + (cush[1] - off0[1]) * u];
    }
    if (p.role === 'spy') {
      const q = offPos(c, c.byId[p.spyOf], t);
      return [p.x + (q[0] - p.x) * clamp(tt / 0.8, 0, 1), p.y];
    }
    return along(p.path.pts, p.path.v * tt, false);
  }
  // Defenders in coverage (zone, man, spy) break on the throw toward the catch spot, then chase the
  // carrier; rushers keep rushing. Straight-line moves at their own speed, closed form, so the
  // position at any t is a pure function of t.
  function defPos(c, p, t) {
    if (t <= c.snapT) return [p.x, p.y];
    const chase = p.role !== 'rush' && p.role !== 'still' && c.throwT != null && c.catchT != null;
    const tr = c.throwT + CS.REACT;
    if (!chase || t <= tr) return defPlanned(c, p, t);
    const P0 = defPlanned(c, p, tr), v = num(p.src.v, CS.SPEEDS[p.pos]);
    const recv = c.byId[c.target];
    const C = offPos(c, recv, c.catchT);
    const step = (from, to, dt) => {
      const L = dist(from, to), go = clamp(Math.min(v * dt, L - 1), 0, Infinity);
      if (L === 0) return from.slice();
      return [from[0] + (to[0] - from[0]) * go / L, from[1] + (to[1] - from[1]) * go / L];
    };
    if (t <= c.catchT) return step(P0, C, t - tr);
    const Q = step(P0, C, c.catchT - tr);
    // After the catch: a pursuit angle straight at the spot where the carrier goes down. Aiming
    // at his moving position instead swings the heading every frame and the swept point outran
    // the defender's own speed by up to 4% (caught by the suite's speed check).
    const end = c.downT != null ? offPos(c, recv, c.downT) : C;
    return step(Q, end, t - c.catchT);
  }

  // The ball: on the spot before the snap, a quick low snap to the QB, held, thrown on an arc that
  // lands on the receiver's spot at the catch time, then carried.
  function ballAt(c, t, posOf) {
    const HANDS = 1.1;
    if (t <= c.snapT) return { x: c.ballX, y: 0, air: 0.15, held: null };
    const qb = c.qb;
    const snapDur = qb && qb.y <= -3 ? 0.3 : 0.12;
    if (t < c.snapT + snapDur) {
      const q = posOf(qb, c.snapT + snapDur), u = (t - c.snapT) / snapDur;
      return { x: c.ballX + (q[0] - c.ballX) * u, y: q[1] * u, air: 0.15 + (HANDS - 0.15) * u + 0.6 * u * (1 - u), held: null };
    }
    if (c.throwT == null || t < c.throwT) { const q = posOf(qb, t); return { x: q[0], y: q[1], air: HANDS, held: qb.id }; }
    const recv = c.byId[c.target];
    if (t < c.catchT) {
      const a = posOf(qb, c.throwT), b = posOf(recv, c.catchT), u = (t - c.throwT) / (c.catchT - c.throwT);
      const apex = clamp(dist(a, b) * 0.12, 0.5, 6);
      return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, air: HANDS + 4 * apex * u * (1 - u), held: null };
    }
    const r = posOf(recv, t);
    return { x: r[0], y: r[1], air: HANDS, held: recv.id };
  }

  // THE pure pose function. t <= snap returns the alignment exactly.
  CS.poseAt = (play, t, lib) => {
    const c = CS.compile(play, lib);
    const posOf = (p, tt) => (p.team === 'off' ? offPos(c, p, tt) : defPos(c, p, tt));
    const players = {};
    for (const p of c.all) {
      const q = t <= c.snapT ? [p.x, p.y] : posOf(p, t);
      players[p.id] = { x: q[0], y: q[1] };
    }
    return { players, ball: ballAt(c, t, posOf) };
  };
  CS.playLength = (play, lib) => CS.compile(play, lib).T;

  CS.validatePlay = (play, lib) => {
    lib = lib || CS.lib;
    const e = [], L = `play ${play && play.id}`;
    const f = lib.FORMATIONS[play.formation], d = lib.DEFENSES[play.defense];
    if (!f) return [`${L}: unknown formation ${play.formation}`];
    if (!d) return [`${L}: unknown defense ${play.defense}`];
    if (!play.teams || !lib.TEAMS[play.teams.off] || !lib.TEAMS[play.teams.def]) e.push(`${L}: teams must name two known teams`);
    let c;
    try { c = CS.compile(play, lib); } catch (err) { return [`${L}: ${err.message}`]; }
    const ids = new Set();
    for (const p of c.all) { if (ids.has(p.id)) e.push(`${L}: id ${p.id} on both teams`); ids.add(p.id); }
    for (const [id, a] of Object.entries(play.assign || {})) {
      const p = c.byId[id];
      if (!p || p.team !== 'off') { e.push(`${L}: assignment for unknown offensive player ${id}`); continue; }
      if (a.route) {
        e.push(...CS.validateRoute(a.route, lib.ROUTES[a.route]));
        const usesSide = (lib.ROUTES[a.route] || { pts: [] }).pts.some((pt) => typeof pt[0] === 'string');
        if (usesSide && !a.side && p.side === 'M') e.push(`${L}: ${id} lines up over the ball, so "in"/"out" needs side:"L"|"R"`);
      }
      if (a.block && CS.gapX(a.block) == null) e.push(`${L}: ${id} blocks unknown gap ${a.block}`);
    }
    for (const p of c.def) if (p.role === 'man' && !(c.byId[p.manOf] && c.byId[p.manOf].team === 'off')) e.push(`${L}: ${p.id} covers unknown ${p.manOf}`);
    const ts = (play.ball || []).map((b) => b.t);
    for (let i = 1; i < ts.length; i++) if (!(ts[i] > ts[i - 1])) e.push(`${L}: ball events out of order`);
    if (c.throwT != null) {
      const r = c.byId[c.target];
      if (!r || r.team !== 'off') e.push(`${L}: throw to unknown ${c.target}`);
      if (c.catchT == null) e.push(`${L}: a throw needs a catch`);
    }
    e.push(...spacingErrors(c.all, L), ...boundsErrors(c.all, L));
    for (const k of play.callouts || []) {
      const fs = CS.toArr(k.focus);
      if (!fs.length) e.push(`${L}: callout at ${k.t} points at nothing`);
      for (const f of fs) if (!CS.focusOf(play, f, k.t)) e.push(`${L}: callout focus ${f} is not on the field`);
    }
    if (play.hash != null && !['L', 'R', 'M'].includes(play.hash)) e.push(`${L}: hash must be L, R or M`);
    // CS convention (fact sheet, rank 1): Sam is the strong-side linebacker and the strong safety
    // lines up to the strength. A defense drawn for strength right, played against a strength-left
    // look without mirroring it, would put both on the wrong side.
    const str = CS.strengthOf(c);
    for (const id of ['SAM', 'SS']) {
      const p = c.byId[id];
      if (p && p.team === 'def' && (str === 'L' || str === 'R') && p.side !== str) e.push(`${L}: ${id} lines up ${p.side}, but the strength is ${str}`);
    }
    return e;
  };

  /* ── reading a formation the way the lessons teach it ── */
  // The offensive line in order from the offense's left, the seven on the line, and its two ends.
  CS.lineOf = (c) => c.off.filter((p) => p.y >= CS.ON_LINE_Y).sort((a, b) => a.x - b.x);
  CS.lineEnds = (c) => { const l = CS.lineOf(c); return l.length ? { L: l[0].id, R: l[l.length - 1].id } : { L: null, R: null }; };
  // Eligible receiver (fact sheet, "Eligible receivers"): an end of the line, or anyone off it.
  // The quarterback is left out on purpose (the sheet: "Leave QB-as-receiver out of content"), so
  // this returns null for him and no question may ask about him.
  CS.isEligible = (c, id) => {
    const p = c.byId[id];
    if (!p || p.team !== 'off' || p.pos === 'QB') return null;
    if (CS.OL.includes(p.pos)) return false;
    if (p.y < CS.ON_LINE_Y) return true;
    const ends = CS.lineEnds(c);
    return ends.L === id || ends.R === id;
  };
  // Formation strength, CS convention (fact sheet): the tight-end side; with no tight end, or one
  // each side, the side with more receivers; if still level, the field (wide) side. Returns
  // 'L' / 'R', or null when even the field side can't break the tie (ball in the middle).
  CS.fieldSide = (c) => (c.ballX < CS.BALL_X - 0.25 ? 'R' : c.ballX > CS.BALL_X + 0.25 ? 'L' : null);
  CS.strengthOf = (c) => {
    const cnt = (pred) => { const n = { L: 0, R: 0, M: 0 }; for (const p of c.off) if (pred(p)) n[p.side]++; return n; };
    const te = cnt((p) => p.pos === 'TE');
    if (te.L !== te.R) return te.L > te.R ? 'L' : 'R';
    const rc = cnt((p) => p.pos === 'TE' || p.pos === 'WR');
    if (rc.L !== rc.R) return rc.L > rc.R ? 'L' : 'R';
    return CS.fieldSide(c);
  };
  // What a player IS, worked out from where he stands wherever the fact sheet lets us: the line
  // is named left to right; a defensive tackle head-up on the ball is the nose. Receivers and
  // linebackers carry CS convention letters (X/Z/H/Y, Sam/Mike/Will), which are their ids.
  const OL_NAMES = ['LT', 'LG', 'C', 'RG', 'RT'];
  CS.roleOf = (c, id) => {
    const p = c.byId[id];
    if (!p) return null;
    if (p.team === 'off') {
      if (CS.OL.includes(p.pos)) { const ol = c.off.filter((q) => CS.OL.includes(q.pos)).sort((a, b) => a.x - b.x); return ol.length === 5 ? OL_NAMES[ol.indexOf(p)] : p.pos; }
      if (p.pos === 'WR') return ['X', 'Z', 'H'].includes(p.id) ? p.id : 'WR';
      return p.pos;                                              // QB, RB, FB, TE
    }
    if (['SAM', 'MIKE', 'WILL'].includes(p.id)) return p.id;
    if (p.pos === 'DT' || p.pos === 'NT') return Math.abs(p.x - c.ballX) < 0.25 ? 'NT' : 'DT';
    if (p.pos === 'S') return ['FS', 'SS'].includes(p.id) ? p.id : 'S';
    return p.pos;                                                // DE, LB (3-4 outside/inside), CB, NB, DB
  };
  // The ball's yard line, read the way a broadcast says it. spot = yards from the offense's own goal line.
  CS.yardLineOf = (spot) => (spot < 50 ? 'own ' + spot : spot > 50 ? 'opp ' + (100 - spot) : 'midfield');
  // Red zone (fact sheet): from the opponent's 20 to the goal line.
  CS.inRedZone = (spot) => spot >= 80 && spot < 100;

  /* ── what a coach points at ── The dad, after his first playtest: "rather than all text being at
     the bottom, text should be in bubbles with visible arrows to where the student should be
     looking, and we should zoom in and out when drawing attention to something." A bubble's focus
     is a list of tokens: a player id ('C', 'Z', 'MIKE'), a group ('ol', 'dl', 'lb', 'line', 'backs'
     get a bracket; 'db', 'receivers' get an arrow each), or a field feature ('hash:L', 'hash:R',
     'hashes', 'sideline:L', 'sideline:R', 'numbers:L', 'numbers:R', 'los', 'ball', 'goal', 'yl:20',
     'redzone', 'field', 'boundary'). CS.focusOf resolves one token to yards; the renderer turns
     those into screen points. Pure: the suite resolves every lesson's focus in Node. */
  CS.VIEW = { Y0: -9, Y1: -9 + 400 / 14 };   // the camera's full window along the field, yards from the LOS
  CS.toArr = (f) => (f == null ? [] : Array.isArray(f) ? f.slice() : [f]);
  const GROUPS = {
    ol: { bracket: true, pick: (c) => c.off.filter((p) => CS.OL.includes(p.pos)) },
    dl: { bracket: true, pick: (c) => c.def.filter((p) => CS.DL.includes(p.pos)) },
    lb: { bracket: true, pick: (c) => c.def.filter((p) => p.pos === 'LB') },
    line: { bracket: true, pick: (c) => CS.lineOf(c) },
    backs: { bracket: true, pick: (c) => c.off.filter((p) => ['QB', 'RB', 'FB'].includes(p.pos)) },
    db: { bracket: false, pick: (c) => c.def.filter((p) => ['CB', 'S', 'NB'].includes(p.pos)) },
    receivers: { bracket: false, pick: (c) => c.off.filter((p) => p.pos === 'WR' || p.pos === 'TE') },
  };
  CS.FOCUS_GROUPS = Object.keys(GROUPS);
  CS.focusOf = (play, token, t) => {
    const c = CS.compile(play), P = CS.poseAt(play, num(t, -1.2)), spot = num(play.spot, 25);
    const { Y0, Y1 } = CS.VIEW, FW = CS.FIELD_W, pts = Object.values(P.players);
    const box = (x, y, rx, ry) => ({ x0: x - rx, x1: x + rx, y0: y - ry, y1: y + ry });
    const bounds = (qs) => ({ x0: Math.min(...qs.map((q) => q.x)), x1: Math.max(...qs.map((q) => q.x)), y0: Math.min(...qs.map((q) => q.y)), y1: Math.max(...qs.map((q) => q.y)) });
    const free = (x, y, r) => pts.every((q) => Math.hypot(q.x - x, q.y - y) >= r);
    const range = (a, b, s) => { const o = []; for (let v = a; v <= b + 1e-9; v += s) o.push(Math.round(v * 100) / 100); return o; };
    const pick = (cands, pref, ok) => { let best = null; for (const v of cands) if (ok(v) && (best === null || Math.abs(v - pref) < Math.abs(best - pref))) best = v; return best; };
    const inView = (y) => y > Y0 + 0.5 && y < Y1 - 0.5;
    const feature = (marks, frame) => ({ token, kind: 'feature', marks, frame });
    if (typeof token !== 'string') return null;
    if (c.byId[token]) { const q = P.players[token]; return { token, kind: 'player', ids: [token], frame: box(q.x, q.y, 1, 1) }; }
    if (GROUPS[token]) {
      const ids = GROUPS[token].pick(c).map((p) => p.id);
      if (!ids.length) return null;
      return { token, kind: 'group', ids, bracket: GROUPS[token].bracket, frame: bounds(ids.map((id) => P.players[id])) };
    }
    // A hash row: an arrow to one tick of it, a yard from nobody, as near the middle of the window as that allows.
    const hashY = (xs) => {
      const ys = range(Math.ceil(Y0 + 2), Math.floor(Y1 - 2), 1).filter((y) => { const a = spot + y; return a > 0 && a < 100 && Math.abs(a % 5) > 1e-6; });
      return pick(ys, 7, (y) => xs.every((x) => free(x, y, 1.6))) ?? pick(ys, 7, () => true);
    };
    const hashMark = (x, y) => ({ at: { x, y }, box: box(x, y, 0.6, 2.5), hl: { kind: 'hline', x } });
    if (token === 'hash:L' || token === 'hash:R') { const x = token === 'hash:L' ? CS.HASH_L : CS.HASH_R, y = hashY([x]); return feature([hashMark(x, y)], box(x, y, 3, 5)); }
    if (token === 'hashes') { const y = hashY([CS.HASH_L, CS.HASH_R]); return feature([hashMark(CS.HASH_L, y), hashMark(CS.HASH_R, y)], { x0: CS.HASH_L - 2, x1: CS.HASH_R + 2, y0: y - 5, y1: y + 5 }); }
    if (token === 'sideline:L' || token === 'sideline:R') {
      const x = token === 'sideline:L' ? 0 : FW, xi = token === 'sideline:L' ? 1.5 : FW - 1.5;
      const y = pick(range(Math.ceil(Y0 + 3), Math.floor(Y1 - 3), 1), 5, (v) => free(xi, v, 2)) ?? 5;
      return feature([{ at: { x, y }, box: box(x, y, 0.6, 2.5), hl: { kind: 'hline', x } }], { x0: Math.min(x, xi) - 2, x1: Math.max(x, xi) + 2, y0: y - 6, y1: y + 6 });
    }
    if (token === 'numbers:L' || token === 'numbers:R') {
      // Fact sheet: numerals 12-14 yd in; the far set is centred on x 13, the near set's bottom is at 12 yd (x 41.33), 1.6 yd tall.
      const x = token === 'numbers:L' ? 13 : FW - 12.8;
      const ys = range(10, 90, 10).map((a) => a - spot).filter((y) => y > Y0 + 1.5 && y < Y1 - 1.5);
      if (!ys.length) return null;
      const y = pick(ys, 0, () => true);
      return feature([{ at: { x, y }, box: box(x, y, 0.9, 1.4), hl: { kind: 'ring', x, y, rx: 1.1, ry: 1.6 } }], box(x, y, 4, 5));
    }
    if (token === 'los') {
      const x = pick(range(2, FW - 2, 0.5), c.ballX - 9, (v) => pts.every((q) => Math.abs(q.y) >= 2 || Math.abs(q.x - v) >= 2.2)) ?? 4;
      return feature([{ at: { x, y: 0 }, box: box(x, 0, 2, 0.6), hl: { kind: 'vline', y: 0 } }], box(x, 0, 5, 5));
    }
    if (token === 'ball') { const b = P.ball; return feature([{ at: { x: b.x, y: b.y }, box: box(b.x, b.y, 0.6, 0.6), hl: { kind: 'ring', x: b.x, y: b.y, rx: 0.9, ry: 0.9 } }], box(b.x, b.y, 3, 4)); }
    const lineAt = (y) => { const x = pick(range(2, FW - 2, 0.5), 40, (v) => free(v, y, 2.2)) ?? 40; return { at: { x, y }, box: box(x, y, 2, 0.6), hl: { kind: 'vline', y } }; };
    const yl = token === 'goal' ? 100 : /^yl:\d+$/.test(token) ? 100 - Number(token.slice(3)) : null;
    if (yl != null) { const y = yl - spot; if (!inView(y)) return null; const m = lineAt(y); return feature([m], box(m.at.x, y, 5, 5)); }
    if (token === 'redzone') {
      const y20 = 80 - spot, yg = 100 - spot, y0 = Math.max(Y0, y20), y1 = Math.min(Y1, yg);
      if (!(y1 > y0 + 1)) return null;
      const m = inView(y20) ? lineAt(y20) : { at: { x: 40, y: (y0 + y1) / 2 }, box: box(40, (y0 + y1) / 2, 1.2, 1.2) };
      m.hl = { kind: 'rect', x0: 0, x1: FW, y0, y1, tone: 'red' };
      return feature([m], { x0: 0, x1: FW, y0, y1 });
    }
    if (token === 'field' || token === 'boundary') {
      const fs = CS.fieldSide(c);
      if (!fs) return null;                                    // ball in the middle: no field side to show
      const side = token === 'field' ? fs : fs === 'L' ? 'R' : 'L';
      const x0 = side === 'L' ? 0 : c.ballX + 1.5, x1 = side === 'L' ? c.ballX - 1.5 : FW, xm = (x0 + x1) / 2;
      const y = pick(range(Math.ceil(Y0 + 3), Math.floor(Y1 - 3), 0.5), 8, (v) => free(xm, v, 2.5)) ?? 8;
      return feature([{ at: { x: xm, y }, box: box(xm, y, 1.2, 1.2), hl: { kind: 'rect', x0, x1, y0: Y0, y1: Y1, label: token === 'field' ? 'Field' : 'Boundary' } }], { x0, x1, y0: Y0, y1: Y1 });
    }
    return null;
  };

  /* ── the camera ── World pixels; {cx, cy} is the centre of the view, z the zoom (1 = the whole
     window). Pure, so the renderer's rAF loop only ever asks "where is the camera at u". */
  CS.ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);   // ease-in-out cubic
  CS.camClamp = (cam, W, H) => {
    const z = Math.max(1, cam.z), hw = W / (2 * z), hh = H / (2 * z);
    return { cx: clamp(cam.cx, hw, W - hw), cy: clamp(cam.cy, hh, H - hh), z };
  };
  // Zoom eases geometrically (equal ratios per frame read as an even speed); the centre eases linearly.
  CS.camLerp = (a, b, u) => {
    const e = CS.ease(u);
    return { cx: a.cx + (b.cx - a.cx) * e, cy: a.cy + (b.cy - a.cy) * e, z: a.z * Math.pow(b.z / a.z, e) };
  };
  /* ── the spotlight ── Coaching film's trick (the dad, looking at the OL card: the defensive line,
     rightly set a yard off the ball, overlapped the linemen and the five read as a pile): while a
     bubble talks about players, everyone else is drawn faded and the players it names are drawn
     last, on top. A bubble about a field feature fades nobody. CS.spotIds resolves a focus to the
     ids it names (null = nobody fades); CS.spotAlpha is a player's opacity u of the way through
     the fade, on the camera's ease. Pure, so the suite checks the arithmetic in Node. */
  CS.SPOT_FADE = 0.32;
  CS.spotIds = (play, focus, t) => {
    const ids = new Set();
    for (const tok of CS.toArr(focus)) { const f = CS.focusOf(play, tok, t); if (f && (f.kind === 'player' || f.kind === 'group')) f.ids.forEach((id) => ids.add(id)); }
    return ids.size ? ids : null;
  };
  CS.spotAlpha = (from, to, u) => from + (to - from) * CS.ease(u);
  // Frame a world-pixel rect with a margin: the largest zoom that shows it whole, no more than
  // zmax, rounded DOWN to a `step` so the pixel art scales by tidy amounts. `fill` caps how much of
  // the view's height the rect may take, leaving room above or below it for the bubble that talks about it.
  CS.camFrame = (r, W, H, o) => {
    o = o || {};
    const m = num(o.margin, 40), zmax = num(o.zmax, 3), step = num(o.step, 0.25), fill = num(o.fill, 1);
    const zr = Math.min(W / (r.x1 - r.x0 + 2 * m), H / (r.y1 - r.y0 + 2 * m), fill * H / Math.max(1, r.y1 - r.y0));
    const z = Math.max(1, Math.floor(Math.min(zmax, zr) / step + 1e-9) * step);
    return CS.camClamp({ cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, z }, W, H);
  };

  /* ── bubble placement ── CSS px inside the field box (W x H). A bubble of w x h goes where it
     covers none of its targets, stays `pad` inside the box, sits about `gap` from its targets (so
     the arrow is long enough to see), and covers as few other players (`avoid`) as it can. Every
     valid spot on a grid is scored; the previous spot is kept while it is still valid and nearly
     as good, so a bubble following a moving player doesn't hop. A target is {rect: {l, r, t, b},
     pt: {x, y} | null}; without a point (a bracketed group) the gap is measured to its rect.
     Returns {x, y, ok}. */
  const hits = (a, b, m) => a.x < b.r + m && a.x + a.w > b.l - m && a.y < b.b + m && a.y + a.h > b.t - m;
  const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.r) - Math.max(a.x, b.l)) * Math.max(0, Math.min(a.y + a.h, b.b) - Math.max(a.y, b.t));
  const rectGap = (a, r) => Math.hypot(Math.max(r.l - (a.x + a.w), 0, a.x - r.r), Math.max(r.t - (a.y + a.h), 0, a.y - r.b));
  const rectDist = (a, p) => Math.hypot(Math.max(a.x - p.x, 0, p.x - (a.x + a.w)), Math.max(a.y - p.y, 0, p.y - (a.y + a.h)));
  CS.placeBubble = (o) => {
    const { W, H, w, h } = o, pad = num(o.pad, 6), gap = num(o.gap, 40), targets = o.targets || [], avoid = o.avoid || [];
    const cx = (t) => (t.pt ? t.pt.x : (t.rect.l + t.rect.r) / 2);   // a group's arrow point is chosen after placement: aim at its rect
    const mx = targets.length ? targets.reduce((s, t) => s + cx(t), 0) / targets.length : W / 2;
    const xs = [...new Set([clamp(mx - w / 2, pad, W - pad - w), pad, W - pad - w, clamp((W - w) / 2, pad, W - pad - w)])];
    const score = (x, y) => {
      const b = { x, y, w, h };
      if (x < pad - 0.01 || y < pad - 0.01 || x + w > W - pad + 0.01 || y + h > H - pad + 0.01) return Infinity;
      if (targets.some((t) => hits(b, t.rect, 6))) return Infinity;
      let s = 0;
      for (const t of targets) s += Math.abs((t.pt ? rectDist(b, t.pt) : rectGap(b, t.rect)) - gap);
      for (const a of avoid) s += overlapArea(b, a) * 0.05;
      return s;
    };
    let best = null;
    for (let y = pad; y <= H - pad - h + 0.01; y += 4) for (const x of xs) { const s = score(x, y); if (s < Infinity && (!best || s < best.s)) best = { x, y, s }; }
    if (o.prev && best) { const s = score(o.prev.x, o.prev.y); if (s < best.s + 30) best = { x: o.prev.x, y: o.prev.y, s }; }
    if (best) return { x: best.x, y: best.y, ok: true };
    return { x: clamp((W - w) / 2, pad, W - pad - w), y: pad, ok: false };
  };
  // The arrow from a bubble {x, y, w, h} to a point: it leaves the bubble's nearest edge (kept 10 px
  // from its corners) and stops `stop` px short of the point, so the head doesn't sit on a player's face.
  CS.tailOf = (b, pt, stop) => {
    const sx = clamp(pt.x, b.x + 10, b.x + b.w - 10), sy = clamp(pt.y, b.y + 8, b.y + b.h - 8);
    let x0 = sx, y0 = sy;
    if (pt.y >= b.y + b.h) y0 = b.y + b.h; else if (pt.y <= b.y) y0 = b.y; else x0 = pt.x < b.x ? b.x : b.x + b.w;
    const d = Math.hypot(pt.x - x0, pt.y - y0) || 1, k = Math.max(0, d - num(stop, 0)) / d;
    return { x0, y0, x1: x0 + (pt.x - x0) * k, y1: y0 + (pt.y - y0) * k };
  };

  /* ── puzzles ── Each type file (cs-pz-*.js) registers {check, truth, validate}. check() is pure
     and is what the UI and the suite both call. */
  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.checkPuzzle = (pz, answer, lib) => {
    const T = CS.puzzleTypes[pz.type];
    if (!T) throw new Error('unknown puzzle type ' + pz.type);
    return T.check(pz, answer, lib || CS.lib);
  };
  CS.validatePuzzle = (pz, lib) => {
    const T = CS.puzzleTypes[pz && pz.type];
    if (!T) return [`puzzle ${pz && pz.id}: unknown type ${pz && pz.type}`];
    return T.validate(pz, lib || CS.lib);
  };
  // Every wrong answer a puzzle could be given (the suite checks each one fails).
  CS.distractorsOf = (pz, lib) => CS.puzzleTypes[pz.type].distractors(pz, lib || CS.lib);

  /* ── Game Day ── 12 questions, pass at 10 or better (plan). The pick is seeded so a retake is a
     different exam but a test is repeatable; every unit of the rank gets at least one question. */
  CS.GAMEDAY = { n: 12, pass: 10 };
  CS.gameDayPassed = (correct, total) => total === CS.GAMEDAY.n && correct >= CS.GAMEDAY.pass;
  CS.rng = (seed) => {
    let a = 7;
    for (const ch of String(seed)) a = (a * 31 + ch.charCodeAt(0)) | 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  CS.pickGameDay = (pool, seed) => {
    const r = CS.rng(seed), shuf = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const units = [...new Set(pool.map((q) => q.unit))];
    const first = units.map((u) => shuf(pool.filter((q) => q.unit === u))[0]);
    const rest = shuf(pool.filter((q) => !first.includes(q))).slice(0, Math.max(0, CS.GAMEDAY.n - first.length));
    return shuf(first.concat(rest));
  };
  // The tags behind the questions he missed, in the order they were asked, no repeats.
  CS.missedTags = (qs, results) => [...new Set(qs.flatMap((q, i) => (results[i] ? [] : q.tags || [])))];

  /* ── progress: state, XP, coach level, Leitner review ── */
  CS.RANKS = ['Intern', 'Quality Control Coach', 'Position Coach (Offense)', 'Position Coach (Defense)', 'Offensive Coordinator', 'Defensive Coordinator', 'Head Coach'];
  CS.XP = { first: 10, second: 5, review: 5, gameDay: 100 };
  CS.DAY = 86400000;
  CS.LEITNER_DAYS = [0, 1, 3, 7, 21];          // box 1..5; box 1 is due again the same moment
  CS.STATE_V = 1;
  CS.newState = () => ({ v: CS.STATE_V, xp: 0, rank: 0, units: {}, srs: {}, streak: { n: 0, last: null, freezes: 1 }, badges: [], seenPlays: [], promos: [] });
  // Load whatever came out of storage, keeping every real 0 (xp 0, rank 0 = Intern, due 0).
  CS.normalizeState = (raw) => {
    const s = CS.newState();
    if (!raw || typeof raw !== 'object') return s;
    s.xp = Math.max(0, Math.floor(num(raw.xp, 0)));
    s.rank = clamp(Math.floor(num(raw.rank, 0)), 0, CS.RANKS.length - 1);
    if (raw.units && typeof raw.units === 'object') s.units = { ...raw.units };
    if (raw.srs && typeof raw.srs === 'object') for (const [tag, e] of Object.entries(raw.srs)) {
      if (e && isNum(e.box) && isNum(e.due)) s.srs[tag] = { box: clamp(Math.floor(e.box), 1, 5), due: e.due };
    }
    if (raw.streak && typeof raw.streak === 'object') s.streak = { n: Math.max(0, num(raw.streak.n, 0)), last: raw.streak.last == null ? null : raw.streak.last, freezes: Math.max(0, num(raw.streak.freezes, 1)) };
    if (Array.isArray(raw.badges)) s.badges = raw.badges.slice();
    if (Array.isArray(raw.seenPlays)) s.seenPlays = raw.seenPlays.slice();
    if (Array.isArray(raw.promos)) s.promos = raw.promos.filter(isNum);
    return s;
  };
  // XP for one answer: 10 on the first try, 5 on the second, nothing after; a review rep is 5.
  CS.xpForAnswer = (tryNo, correct, review) => {
    if (!correct) return 0;
    if (review) return CS.XP.review;
    return tryNo === 1 ? CS.XP.first : tryNo === 2 ? CS.XP.second : 0;
  };
  // Coach level n needs 50·n·(n−1) XP: level 1 at 0, 2 at 100, 3 at 300, 4 at 600...
  CS.xpForLevel = (n) => 50 * n * (n - 1);
  CS.levelForXp = (xp) => { let n = 1; while (CS.xpForLevel(n + 1) <= xp) n++; return n; };
  // One review of a tag: right moves it up a box (max 5), wrong sends it to box 1. The new due time
  // is now + that box's interval, and box 1's interval is a real 0.
  CS.srsReview = (srs, tag, correct, now) => {
    const cur = srs[tag];
    const box = correct ? Math.min(5, (cur ? cur.box : 0) + 1) : 1;
    return { ...srs, [tag]: { box, due: now + CS.LEITNER_DAYS[box - 1] * CS.DAY } };
  };
  CS.srsDue = (srs, now) => Object.entries(srs).filter(([, e]) => e.due <= now).sort((a, b) => a[1].due - b[1].due || (a[0] < b[0] ? -1 : 1)).map(([tag]) => tag);
  // Replay a log of events onto a state. Events: {t, kind:'answer', tag, correct, try, review}
  // and {t, kind:'gameday', rank, passed}. Returns a new state; the input is untouched.
  CS.applyLog = (state, log) => {
    let s = CS.normalizeState(state);
    for (const e of log) {
      if (e.kind === 'answer') {
        s.xp += CS.xpForAnswer(e.try, e.correct, e.review);
        if (e.tag) s.srs = CS.srsReview(s.srs, e.tag, e.correct, e.t);
      } else if (e.kind === 'gameday' && e.passed && e.rank === s.rank && s.rank < CS.RANKS.length - 1) {
        // A pass at his current rank: +100 and the promotion, recorded once in promos. Passing a
        // rank's Game Day again later (a retake for fun) pays nothing, or the exam would be the
        // quickest XP farm in the building.
        s.xp += CS.XP.gameDay;
        s.rank += 1;
        if (!s.promos.includes(s.rank)) s.promos.push(s.rank);
      } else if (e.kind === 'unit') {
        // A finished puzzle set: done, and the best first-try score kept (a real 0 included).
        const prev = s.units[e.unit];
        const best = prev && isNum(prev.best) ? Math.max(prev.best, e.score) : e.score;
        s.units = { ...s.units, [e.unit]: { done: true, best } };
      } else if (e.kind === 'seen' && !s.seenPlays.includes(e.play)) {
        s.seenPlays = s.seenPlays.concat(e.play);
      }
    }
    return s;
  };
  // A rank's units are played in order: the first is open, each next one opens when the one
  // before it is done, and Game Day opens when every unit is done.
  CS.unitOpen = (s, units, i) => i === 0 || !!(s.units[units[i - 1].id] && s.units[units[i - 1].id].done);
  CS.gameDayOpen = (s, units) => units.every((u) => s.units[u.id] && s.units[u.id].done);
})(typeof window !== 'undefined' ? window : globalThis);
