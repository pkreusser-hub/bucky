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
    for (const k of play.callouts || []) if (!c.byId[k.focus]) e.push(`${L}: callout focus ${k.focus} is not on the field`);
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
