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
    // play.align (CS.variantOf's `align`): a man moved for this play, in FIELD yards (after the
    // mirror and the hash shift, the ids as compiled). An outcome run "from where he put them".
    for (const p of off.concat(def)) {
      const a = play.align && play.align[p.id];
      if (a && isNum(a.x) && isNum(a.y)) { p.x = a.x; p.y = a.y; p.side = CS.sideOf(p.x, ballX); p.aligned = true; }
    }
    const byId = {};
    for (const p of off.concat(def)) byId[p.id] = p;
    const ev = (name) => (play.ball || []).find((b) => b.ev === name);
    const snap = ev('snap'), thr = ev('throw'), cat = ev('catch'), sack = ev('sack');
    // How a thrown ball ends: caught, incomplete (it lands on the grass by him), broken up
    // ({ev:'breakup', by}: a defender gets a hand on it) or picked ({ev:'pick', by}: he secures it).
    const end = thr ? (play.ball || []).find((b) => CS.BALL_ENDS.includes(b.ev) && b.t > thr.t) || null : null;
    const c = {
      play, off, def, all: off.concat(def), byId, ballX, dX, formation: f, defense: d,
      snapT: snap ? snap.t : 0, throwT: thr ? thr.t : null, catchT: cat ? cat.t : null,
      target: thr ? thr.to : null, qb: off.find((p) => p.pos === 'QB'),
      rac: num(play.rac, 0.7),
      end: end ? end.ev : null, arriveT: end ? end.t : null, by: end && end.by != null ? end.by : null,
      sackT: sack ? sack.t : null, sackBy: sack ? sack.by : null,
    };
    c.downT = c.catchT != null && c.end === 'catch' ? c.catchT + c.rac : null;
    const tail = c.downT != null ? c.downT + 0.8 : c.end === 'pick' ? c.arriveT + 1.6 : c.arriveT != null ? c.arriveT + 1.0 : c.sackT != null ? c.sackT + 1.0 : 4;
    c.T = num(play.T, tail);
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
      } else if (a.on != null && (a.pass || a.block)) {
        p.role = 'block'; p.on = a.on;                              // pass pro on a named rusher: path set below
      } else if (a.block) {
        const gx = CS.gapX(a.block);
        p.path = { pts: [start, [gx == null ? p.x : gx + dX, Math.min(p.y + 2, -2)]], v, delay: 0, ext: false };
        p.role = 'block';
      } else if (a.pass) {
        const lat = /-L$/.test(a.pass) ? -0.5 : /-R$/.test(a.pass) ? 0.5 : 0;
        p.path = { pts: [start, [p.x + lat, p.y - 1.1]], v: 2.5, delay: 0, ext: false };
        p.role = 'block';
      } else if (a.carry || a.handoff || a.run || a.kick) {
        // The run game (CS.runCompile, below) gives him his track once the defense is known.
        p.path = { pts: [start], v, delay: 0, ext: false };
        p.role = a.carry ? 'carry' : a.handoff ? 'qb' : 'block';
      } else {
        p.path = { pts: [start], v, delay: 0, ext: false };
        p.role = CS.OL.includes(p.pos) ? 'block' : 'still';
      }
    }
    // Defense: zone drops, rushes, man and spy. play.assign may give a defender this play's own job
    // ({zone|rush|man|spy|still}, replacing the defense's; or just {then:'QB'}, {aim}, {v} on top of
    // it): the unblocked rusher who keeps coming, the curl-flat defender who widens to the flat.
    const qbEnd = c.qb ? c.qb.path.pts[c.qb.path.pts.length - 1] : null;
    for (const p of def) {
      const ov = A[p.id];
      if (ov) {
        const s0 = { ...p.src };
        if (DEF_JOBS.some((k) => ov[k] != null)) for (const k of DEF_JOBS) delete s0[k];
        p.src = { ...s0, ...ov };
      }
      // Man or rush (Cover 0's Mike, fact sheet 5a: "man RB (rushes if RB blocks)"): settled at the
      // snap from what his man does on this play. He blocks (a gap, a pass set, a man) -> the Mike
      // rushes his lane; anything else (a route, a carry, standing) -> he plays him man.
      if (p.src.man != null && p.src.ifBlocks && p.src.ifBlocks.rush != null) {
        const m = byId[p.src.man];
        p.branch = m && m.team === 'off' && m.role === 'block' ? 'rush' : 'man';
        if (p.branch === 'rush') { const s1 = { ...p.src, rush: p.src.ifBlocks.rush }; delete s1.man; p.src = s1; }
      }
      const s = p.src, v = num(s.v, CS.SPEEDS[p.pos]), start = [p.x, p.y];
      if (s.still) { p.path = { pts: [start], v, delay: 0, ext: false }; p.role = 'still'; }
      else if (s.zone != null) {
        // aim: where his drop goes when the play shows his read (a curl-flat defender widening to
        // the flat aims at the flat's landmark); his zone, his job, stays the defense's.
        const z = lib.ZONES[s.aim != null ? s.aim : s.zone];
        p.path = { pts: [start, [z.x + dX, z.y]], v, delay: 0, ext: false };
        p.role = 'zone';
        // A pattern read (Cover 4's safeties, fact sheet 5a "reads #2"; 6: "carries #2 vertical,
        // opening the dig" / "drive on the dig"): CS.READ_T s after the snap he looks at the man he
        // reads and, if that man is running a route, plays him: a vertical route he carries over the
        // top, anything that breaks he drives on. An aim the play gives him (src.aim) is the play's
        // own picture of his read and wins. A man who blocks or carries is no route to read.
        const rr = s.read && s.aim == null ? byId[s.read.of] : null;
        if (rr && rr.team === 'off' && rr.role === 'route') { p.readOf = rr.id; p.readKind = CS.isVertical(rr.path) ? 'carry' : 'drive'; }
      } else if (s.rush != null) {
        const gp = [CS.gapX(s.rush) + dX, -0.4];
        // then:'QB': nobody blocks him, so he keeps coming, through his gap to the quarterback's
        // spot at the end of his drop, stopping CS.SACK_REACH yd in front of him (on the ball side).
        // A stunt (rank 4, "Stunts and twists"): {delay} holds him that long after the snap, and
        // {loop} takes him round behind the man who crashed first (a yard deeper on the defense's
        // side, halfway across) before he comes through his new gap.
        const pts = [start];
        if (s.loop) pts.push([(start[0] + gp[0]) / 2, start[1] + CS.LOOP_DEPTH]);
        pts.push(gp);
        if (s.then === 'QB' && qbEnd) pts.push([qbEnd[0], qbEnd[1] + CS.SACK_REACH]);
        p.path = { pts, v, delay: num(s.delay, 0), ext: false };
        p.rushGx = gp[0];
        p.role = 'rush';
      } else if (s.man != null) {
        p.role = 'man'; p.manOf = s.man;
        p.trail = s.technique === 'trail';
      } else if (s.spy != null) {
        p.role = 'spy'; p.spyOf = s.spy;
      } else { p.path = { pts: [start], v, delay: 0, ext: false }; p.role = 'still'; }
    }
    // Pass protection on a named rusher ({pass|block, on:'DE-L'}): the blocker steps to a spot
    // CS.ENGAGE_SET yd behind the point where his man crosses the line (his gap), and the first
    // moment the two are within CS.ENGAGE yd they meet and hold there: both stop (p.held = t).
    for (const p of off) {
      if (p.on == null) continue;
      const r = byId[p.on], a = p.assign, start = [p.x, p.y];
      const gx = r && r.role === 'rush' ? r.rushGx : r ? r.x : p.x;
      // A lineman sets half a yard back (never shallower than the set point); a back set deeper than
      // the set point steps up to it (into the hole his man comes through).
      const setY = -0.4 - CS.ENGAGE_SET, to = [gx, p.y < setY ? setY : Math.min(setY, p.y - 0.5)];
      p.path = { pts: [start, to], v: num(a.v, a.pass ? 2.5 : CS.SPEEDS[p.pos]), delay: 0, ext: false };
    }
    for (const p of off) {
      const r = p.on != null ? byId[p.on] : null;
      if (!r || r.team !== 'def' || r.role !== 'rush') continue;
      for (let t = c.snapT; t <= c.T + 1e-9; t = Math.round((t + 0.02) * 1000) / 1000) {
        const a = offPos(c, p, t), b = defPlanned(c, r, t);
        if (dist(a, b) <= CS.ENGAGE) {
          p.held = t;
          // Two men on one rusher: he is held from the first of them.
          if (!(r.held <= t)) r.held = t;
          break;
        }
      }
    }
    // A handoff makes it a run: every man gets a track (CS.runCompile).
    const hand = ev('handoff');
    if (hand) { c.run = true; c.handT = hand.t; c.carrier = hand.to; runCompile(c, lib); }
    if (CACHE) CACHE.set(play, c);
    return c;
  };
  CS.LOOP_DEPTH = 1.0;      // yd: a looper's turn behind the crasher, on the defense's side
  CS.READ_T = 1.0;          // s after the snap a pattern-reading safety settles what #2 is doing
  // A route is vertical (a man reading it carries it) when it runs on and its last leg goes
  // straight up the field: a go, a seam, a wheel's last leg. Anything that breaks across is not.
  CS.isVertical = (path) => {
    const P = path && path.pts;
    if (!P || P.length < 2 || !path.ext) return false;
    const a = P[P.length - 2], b = P[P.length - 1], dy = b[1] - a[1];
    return dy >= 8 && Math.abs(b[0] - a[0]) <= 0.3 * dy;
  };

  /* ── the run game (2026-11-12) ── A handoff makes a play a run. Every man then moves on a TRACK:
     keyframes [t, x, y], straight lines at constant speed between them, so a position is a pure
     function of t (linear interpolation, constant before the first keyframe and after the last) and
     a test can work any of it out by hand from the legs. compile builds the tracks once, in order:
       1. route runners and droppers: their paths as tracks;
       2. every defender's own job until he reads run (his react time), then a straight pursuit to
          the first point on the carrier's track he can reach (CS.intercept): his "free plan";
       3. the carrier's authored track (aim gap, counter step, cut), or for a draw the lane the
          steered rushers leave open; the quarterback's track to the mesh point, then his fake;
       4. the blocks, by rule (CS.runBlocks): each blocker's footwork, then a straight leg to the
          first point he can reach his man (contact at RUN.CONTACT yd); from contact the two move
          together (the drive, RUN.VD yd/s for RUN.DRIVE_T s) and then hold. A double team: the
          covered man takes the lineman, the uncovered man joins him, they hold RUN.COMBO_T s, then
          the uncovered man climbs to his linebacker;
       5. the tackle: of every defender still free when he gets there, the first to reach the
          carrier makes it (c.downT, c.tackleBy); the carrier goes down there, the other free men
          close on the spot, the play ends RUN.END s later.
     Fact sheet section 7 for the schemes, RUN_RULES in cs-lib for the tokens. */
  CS.RUN = {
    KEY_DL: 0.5, KEY_LB: 0.4, KEY_DB: 0.8,   // s after the snap a lineman / linebacker / defensive back reads run and flows
    DRAW: 0.3,                               // on a draw (the line shows pass) everyone reads it this long after the handoff
    TACKLE: 0.6,                             // yd: the tackler stops this far from the carrier (he has him)
    CONTACT: 1.0,                            // yd: a blocker and his man this close have met
    VD: 1.2, DRIVE_T: 1.0,                   // the drive after contact: yd/s, for this long, then they hold
    COMBO_T: 0.45,                           // s the double team holds before the uncovered man climbs
    PULL_V: 6,                               // yd/s a pulling lineman runs
    FOLLOW: 0.25,                            // s behind the puller the back who follows him reaches the line
    PULL_Y: -1.0,                            // yd: the depth a puller runs along behind the line
    MESH: 0.6,                               // yd between the quarterback and the back at the exchange
    FAKE: 2,                                 // yd the quarterback carries out his fake, away from the run
    JAB: 1.2,                                // yd: the counter step away from the play
    DT: 0.01,                                // s: the intercept search's step
    END: 1.0,                                // s the play runs on after the tackle
    LINE_Y: 1.5,                             // a defender this close to the ball (y) is on the line
    CLOSE: 1.5,                              // yd short of the tackle spot the other free defenders pull up
  };
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  function kfAt(K, t) {
    if (t <= K[0][0]) return [K[0][1], K[0][2]];
    for (let i = 1; i < K.length; i++) {
      if (t <= K[i][0]) { const a = K[i - 1], b = K[i], u = b[0] > a[0] ? (t - a[0]) / (b[0] - a[0]) : 1; return [a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]; }
    }
    const z = K[K.length - 1];
    return [z[1], z[2]];
  }
  // A polyline at speed v, leaving its first point at t0.
  function kfPath(pts, v, t0) {
    const K = [[t0, pts[0][0], pts[0][1]]];
    let t = t0;
    for (let i = 1; i < pts.length; i++) { const L = dist(pts[i - 1], pts[i]); if (L < 1e-9) continue; t += L / v; K.push([r6(t), pts[i][0], pts[i][1]]); }
    return K;
  }
  // The track up to t (ending exactly where it is at t), and the track carried on with more points.
  function kfCut(K, t) { const out = K.filter((k) => k[0] < t - 1e-9), q = kfAt(K, t); out.push([t, q[0], q[1]]); return out; }
  function kfThen(K, pts, v) { const z = K[K.length - 1]; return K.concat(kfPath([[z[1], z[2]], ...pts], v, z[0]).slice(1)); }
  CS.kfAt = kfAt; CS.kfPath = kfPath;
  // The first moment (on a DT grid from t0, never before tMin) a man at P running at v can be within
  // `reach` of a target moving on track(t): |P - Q(t)| - reach <= v (t - t0). He runs the straight
  // line from P toward Q(t) and stops `reach` short of it. Returns {t, at, q} or null by tMax.
  CS.intercept = (P, t0, v, track, reach, tMax, tMin) => {
    const lo = isNum(tMin) ? tMin : t0;
    for (let k = 0; ; k++) {
      const t = r6(t0 + k * CS.RUN.DT);
      if (t > tMax) return null;
      if (t < lo - 1e-9) continue;
      const Q = track(t), d = dist(P, Q);
      if (d - reach <= v * (t - t0) + 1e-9) { const L = Math.max(0, d - reach), u = d > 1e-9 ? L / d : 0; return { t, at: [P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u], q: Q }; }
    }
  };
  // A path as a track from t0 (a delay holds him on his first point; a route that runs on goes on).
  function pathTrack(path, t0) {
    const pts = path.pts.map((q) => q.slice());
    if (path.ext && pts.length > 1) { const a = pts[pts.length - 2], b = pts[pts.length - 1], L = dist(a, b) || 1; pts[pts.length - 1] = [b[0] + (b[0] - a[0]) / L * 60, b[1] + (b[1] - a[1]) / L * 60]; }
    const d = num(path.delay, 0), K = kfPath(pts, path.v, t0 + d);
    if (d > 0) K.unshift([t0, pts[0][0], pts[0][1]]);
    return K;
  }

  /* The blocking rules, applied to the play on the field (RUN_RULES in cs-lib; fact sheet 7). Run to
     side s (+1 right). "On the line": a defender within RUN.LINE_Y of the ball. Resolved in this order,
     each defender taken once (a double team's lineman twice):
       1. an explicit {on: id} (a play's own pick; {miss: true}: he runs his footwork and blocks nobody);
       2. kick (a back) and pull-kick: the EMOL, the playside-most man on the line nobody has yet;
          pull-trap: the man its pull names;
       3. back: the nearest man on the line on him or backside of him (within 2.6 yd);
       4. down, playside man first: the nearest man on the line inside him (within 2.6 yd); if there
          is none, he goes on to a linebacker in step 9;
       5. zone / reach, playside man first: COVERED if a man on the line is on him or in his playside
          gap (zone: -0.3..1.3 yd playside of him; reach: -0.8..1.3, the reach-step takes in a backside
          shade): he blocks that man. Uncovered: step 9;
       6. cutoff / hinge (the backside tackle): the nearest man on the line at most 0.6 yd playside of
          him (within 3.2 yd);
       7. steer: the nearest man on the line (within 3.2 yd);
       8. a rule with nobody to block holds his ground (null);
       9. the linebackers, in this order: pull-lead (target 'PS-LB': the linebacker nearest the gap it
          pulls through); an uncovered zone/reach man (the double team: he joins the next blocker on
          his playside on that man's lineman, then climbs to the linebacker nearest that lineman; with
          no lineman to join he climbs straight to the nearest); down with nobody inside (the nearest
          linebacker inside him, less than half a yard playside); release (the nearest linebacker).
     Returns { id: { token, target, combo?: {with, on}, climb?, miss? } }. Pure: the assign puzzle's
     judge reads it. */
  CS.runBlocks = (c) => {
    const A = c.play.assign || {}, s = num(c.runS, 1), R = CS.RUN, G = CS.gapsOf(c);
    const line = c.def.filter((p) => p.y <= R.LINE_Y), lbs = c.def.filter((p) => p.pos === 'LB' && p.y > R.LINE_Y);
    const taken = new Set(), out = {};
    const tokOf = (p) => (A[p.id].kick ? 'kick' : A[p.id].run);
    const blockers = c.off.filter((p) => A[p.id] && (A[p.id].run || A[p.id].kick));
    const set = (p, d, extra) => { out[p.id] = { token: tokOf(p), target: d ? d.id : null, ...(extra || {}) }; if (d) taken.add(d.id); };
    const free = (list) => list.filter((d) => !taken.has(d.id));
    const near = (list, x) => list.slice().sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x) || a.y - b.y)[0] || null;
    const todo = (toks) => blockers.filter((p) => !out[p.id] && toks.includes(tokOf(p))).sort((a, b) => s * b.x - s * a.x);
    for (const p of blockers) {
      const a = A[p.id];
      if (a.miss) set(p, null, { miss: true });
      else if (a.on != null) set(p, c.byId[a.on] && c.byId[a.on].team === 'def' ? c.byId[a.on] : null, { how: 'on' });
    }
    const emol = () => free(line).sort((a, b) => s * b.x - s * a.x)[0] || null;
    for (const p of todo(['kick', 'pull-kick'])) { const pt = A[p.id].pull && A[p.id].pull.target; set(p, pt && pt !== 'EMOL' && c.byId[pt] ? c.byId[pt] : emol()); }
    for (const p of todo(['pull-trap'])) { const pt = A[p.id].pull && A[p.id].pull.target; set(p, pt && c.byId[pt] && !taken.has(pt) ? c.byId[pt] : null); }
    for (const p of todo(['back'])) set(p, near(free(line).filter((d) => s * (d.x - p.x) <= 0.25 && Math.abs(d.x - p.x) <= 2.6), p.x));
    const later = [];
    for (const p of todo(['down'])) { const d = near(free(line).filter((q) => s * (q.x - p.x) < -0.1 && Math.abs(q.x - p.x) <= 2.6), p.x); if (d) set(p, d); else later.push(p); }
    const uncovered = [];
    for (const p of todo(['zone', 'reach'])) {
      const lo = tokOf(p) === 'reach' ? -0.8 : -0.3;
      const d = near(free(line).filter((q) => s * (q.x - p.x) >= lo && s * (q.x - p.x) <= 1.3), p.x);
      if (d) set(p, d); else uncovered.push(p);
    }
    for (const p of todo(['cutoff', 'hinge'])) set(p, near(free(line).filter((d) => s * (d.x - p.x) <= 0.6 && Math.abs(d.x - p.x) <= 3.2), p.x));
    for (const p of todo(['steer']).sort((a, b) => Math.abs(b.x - c.ballX) - Math.abs(a.x - c.ballX))) set(p, near(free(line).filter((d) => Math.abs(d.x - p.x) <= 3.2), p.x));
    // The linebackers.
    for (const p of todo(['pull-lead'])) { const via = A[p.id].pull && G[A[p.id].pull.via]; set(p, near(free(lbs), isNum(via) ? via : p.x)); }
    for (const p of uncovered) {
      // His partner: the next blocker playside of him on the line, and the lineman that man has.
      const mate = blockers.filter((q) => q.y >= CS.ON_LINE_Y && s * (q.x - p.x) > 0.1).sort((a, b) => s * a.x - s * b.x)[0];
      const dl = mate && out[mate.id] && out[mate.id].target && line.some((d) => d.id === out[mate.id].target) && !out[mate.id].combo ? c.byId[out[mate.id].target] : null;
      const lb = near(free(lbs), dl ? dl.x : p.x);
      set(p, lb, dl ? { combo: { with: mate.id, on: dl.id }, climb: lb ? lb.id : null } : { climb: lb ? lb.id : null });
    }
    for (const p of later) set(p, near(free(lbs).filter((d) => s * (d.x - p.x) < 0.5), p.x));
    for (const p of todo(['release'])) set(p, near(free(lbs), p.x));
    for (const p of blockers) if (!out[p.id]) set(p, null);
    return out;
  };

  // Which way a block moves the two once they meet (x times the run's side s; normalised). Down and
  // back blocks drive the man toward the backside, a kick-out or a trap out to the playside, a zone
  // block up the field and a shade playside, a reach seals him inside, a climb or a lead goes up to
  // the second level; a cutoff or hinge barely moves; a steered rusher goes on upfield and outside.
  const DRIVE_DIR = { down: [-1, 0.6], back: [-1, 0.5], zone: [0.3, 1], reach: [-0.7, 0.5], cutoff: [-0.4, 0.3], hinge: [-0.2, 0.2],
    kick: [1, 0.15], 'pull-kick': [1, 0.15], 'pull-trap': [1, 0.15], 'pull-lead': [0.15, 1], release: [0, 1], climb: [0, 1] };
  function runCompile(c, lib) {
    const R = CS.RUN, play = c.play, A = play.assign || {}, snap = c.snapT, G = CS.gapsOf(c);
    const car = c.byId[c.carrier], qb = c.qb, ca = (A[c.carrier] || {}).carry || {};
    if (!car || !qb) { c.runError = 'no carrier or quarterback'; return; }
    const s = ca.aim ? (/-L$/.test(ca.aim) ? -1 : 1) : (play.mirror ? -1 : 1);
    c.runS = s;
    const ol = c.off.filter((p) => CS.OL.includes(p.pos));
    c.draw = ol.length > 0 && ol.every((p) => (A[p.id] || {}).run === 'steer');
    const vOf = (p) => num((A[p.id] || {}).v, CS.SPEEDS[p.pos]);
    const TMAX = snap + 8;
    // 1. Route runners and the quarterback's drop.
    for (const p of c.off) if (p.role === 'route' || (p === qb && (A[qb.id] || {}).drop != null)) p.track = pathTrack(p.path, snap);
    // 2. The defense's own jobs (a rusher on a draw keeps coming at the quarterback's set spot).
    const qbSet = qb.path.pts[qb.path.pts.length - 1];
    const pre = {}, react = {};
    for (const p of c.def) {
      if (c.draw && p.role === 'rush') p.path = { ...p.path, pts: p.path.pts.concat([[qbSet[0] + (p.rushGx - qbSet[0]) * 0.5, qbSet[1] + 1.5]]) };
      let K;
      if (p.role === 'man' || p.role === 'spy' || p.readOf != null) { K = []; for (let t = snap; t <= TMAX + 1e-9; t = r6(t + 0.05)) { const q = defPlanned(c, p, t); K.push([t, q[0], q[1]]); } }
      else K = pathTrack(p.path, snap);
      pre[p.id] = K;
      react[p.id] = c.draw ? c.handT + R.DRAW : snap + (CS.DL.includes(p.pos) ? R.KEY_DL : p.pos === 'LB' ? R.KEY_LB : R.KEY_DB);
    }
    const res = CS.runBlocks(c);
    c.blocks = res;
    // A blocker's footwork before he goes to his man. A puller drops to PULL_Y, runs along the line
    // to the gap he pulls through (via) and, leading, turns up it; kicking out or trapping he goes
    // at his man from there. A steer shows a pass set. Everyone else goes straight at his man.
    const footwork = (b, tok, a) => {
      const B = [b.x, b.y];
      if (/^pull-/.test(tok)) {
        const vx = G[a.pull && a.pull.via], X = isNum(vx) ? vx : b.x + s * 3;
        return { pts: [B, [b.x, R.PULL_Y], [X, R.PULL_Y]].concat(tok === 'pull-lead' ? [[X, -0.3]] : []), v: num(a.v, R.PULL_V) };
      }
      if (tok === 'steer') return { pts: [B, [b.x, b.y - 1.1]], v: 2.5 };
      return { pts: [B], v: vOf(b) };
    };
    // When a puller reaches the hole (the via gap, at pull depth): the back who follows him times his run off it.
    const viaT = (id) => { const a = A[id] || {}, b = c.byId[id]; if (!b || !/^pull-/.test(a.run || '')) return null; const f = footwork(b, a.run, a); return r6(snap + (dist(f.pts[0], f.pts[1]) + dist(f.pts[1], f.pts[2])) / f.v); };
    // 4 (as a function: a draw runs it once before the carrier's track exists, to find its lane).
    function blockAll(planOf) {
      const T = {}, eng = {}, info = {};
      const dirOf = (tok, b, d) => {
        if (tok === 'steer') { const o = Math.sign(d.x - c.ballX) || s; const L = Math.hypot(0.6, 1); return [o * 0.6 / L, -1 / L]; }
        const v = DRIVE_DIR[tok] || [0, 1], L = Math.hypot(v[0], v[1]);
        return [s * v[0] / L, v[1] / L];
      };
      const engage = (b, d, te, tok, Bc, Dc) => {
        const dv = dirOf(tok, b, d), e = R.VD * R.DRIVE_T;
        eng[b.id] = te; eng[d.id] = Math.min(isNum(eng[d.id]) ? eng[d.id] : Infinity, te);
        return { b: [te + R.DRIVE_T, Bc[0] + dv[0] * e, Bc[1] + dv[1] * e], d: [r6(te + R.DRIVE_T), Dc[0] + dv[0] * e, Dc[1] + dv[1] * e] };
      };
      const dTrack = (id) => T[id] || planOf(id);
      // Single blocks first (the covered man of a double team included), then the double teams' second men.
      const order = Object.keys(res).sort((a, b) => (res[a].combo ? 1 : 0) - (res[b].combo ? 1 : 0));
      for (const id of order) {
        const b = c.byId[id], r = res[id], a = A[id] || {}, tok = r.token, fw = footwork(b, tok, a), v = fw.v;
        let K = kfPath(fw.pts, v, snap);
        if (r.miss || !r.target) {
          // Nobody to block (a miss, or a rule with no man): his footwork, then a step in his drive's direction.
          const z = K[K.length - 1], dv = DRIVE_DIR[tok] ? dirOf(tok, b, b) : [0, 1];
          T[id] = kfThen(K, [[z[1] + dv[0] * 0.8, z[2] + Math.max(0.3, dv[1] * 0.8)]], 2);
          info[id] = { token: tok, target: null, miss: !!r.miss };
          continue;
        }
        if (r.combo) {
          // The double team: he joins his partner on the lineman, they hold it, then he climbs.
          const dl = c.byId[r.combo.on], DK = dTrack(dl.id), z0 = K[K.length - 1];
          const hit = CS.intercept([z0[1], z0[2]], z0[0], v, (t) => kfAt(DK, t), R.CONTACT + 0.25, TMAX);
          if (!hit) { T[id] = K; continue; }
          const mateT = isNum(info[r.combo.with] && info[r.combo.with].te) ? info[r.combo.with].te : hit.t;
          const tc = r6(Math.max(hit.t, mateT) + R.COMBO_T), off = [hit.at[0] - kfAt(DK, hit.t)[0], hit.at[1] - kfAt(DK, hit.t)[1]];
          K = K.concat([[hit.t, hit.at[0], hit.at[1]]]);
          for (const k of DK) if (k[0] > hit.t + 1e-9 && k[0] < tc - 1e-9) K.push([k[0], k[1] + off[0], k[2] + off[1]]);
          const Pc = kfAt(DK, tc);
          K.push([tc, Pc[0] + off[0], Pc[1] + off[1]]);
          eng[id] = hit.t;
          info[id] = { token: tok, target: r.target, combo: { on: dl.id, with: r.combo.with, join: hit.t, start: r6(Math.max(hit.t, mateT)), climbT: tc } };
          if (r.climb) {
            const lb = c.byId[r.climb], LK = dTrack(lb.id), P = [K[K.length - 1][1], K[K.length - 1][2]];
            const h2 = CS.intercept(P, tc, v, (t) => kfAt(LK, t), R.CONTACT, TMAX);
            if (h2) {
              const Dc = kfAt(LK, h2.t), x = engage(b, lb, h2.t, 'climb', h2.at, Dc);
              K.push([h2.t, h2.at[0], h2.at[1]], x.b);
              T[lb.id] = kfCut(LK, h2.t).concat([x.d]);
              Object.assign(info[id], { te: h2.t, at: h2.at, climbed: lb.id });
            }
          }
          T[id] = K;
          continue;
        }
        const d = c.byId[r.target], DK = dTrack(d.id);
        // He meets his man on the way (the man runs into his footwork), or goes at him from its end.
        let hit = null;
        for (let t = K[0][0]; t <= K[K.length - 1][0] + 1e-9; t = r6(t + R.DT)) { const q = kfAt(K, t); if (dist(q, kfAt(DK, t)) <= R.CONTACT + 1e-9) { hit = { t, at: q }; break; } }
        if (hit) K = kfCut(K, hit.t).slice(0, -1);
        const z0 = K[K.length - 1];
        if (!hit) hit = CS.intercept([z0[1], z0[2]], z0[0], v, (t) => kfAt(DK, t), R.CONTACT, TMAX);
        if (!hit) { T[id] = K; continue; }
        const Dc = kfAt(DK, hit.t), drive = r.climb ? 'climb' : tok, x = engage(b, d, hit.t, drive, hit.at, Dc);
        T[id] = K.concat([[hit.t, hit.at[0], hit.at[1]], x.b]);
        T[d.id] = kfCut(DK, hit.t).concat([x.d]);
        info[id] = { token: tok, target: d.id, te: hit.t, at: hit.at, via: /^pull-/.test(tok) ? { x: fw.pts[2][0], y: fw.pts[2][1], t: viaT(id) } : null };
      }
      return { T, eng, info };
    }
    // 3. The carrier and the quarterback.
    const vC = vOf(car), S0 = [car.x, car.y], cut = ca.cut || 'front';
    const after = (X, y0) => (cut === 'back' ? [[X - s * 3, 4], [X - s * 3, 30]] : cut === 'bounce' ? [[X + s * 4, y0 + 1.5], [X + s * 4, 30]] : [[X, 30]]);
    let carK;
    if ((A[qb.id] || {}).drop != null) {
      // A draw: the quarterback sets up as if to pass; the back meets him there at the handoff,
      // then takes the lane the steered rushers left (the widest space between two of them on the
      // line, inside the tackle box, half a second after the handoff).
      const M = [qbSet[0] + s * R.MESH, qbSet[1]], t0 = Math.max(snap, c.handT - dist(S0, M) / vC);
      let laneX = ca.aim ? G[ca.aim] : null;
      if (laneX == null) {
        const pre1 = blockAll((id) => kfCut(pre[id], react[id])).T;
        const at = c.handT + 0.5, xs = c.def.filter((p) => CS.DL.includes(p.pos)).map((p) => kfAt(pre1[p.id] || pre[p.id], at)[0]).sort((a, b) => a - b);
        const lo = c.ballX - 6, hi = c.ballX + 6, edges = [lo, ...xs.filter((x) => x > lo && x < hi), hi];
        let best = null;
        for (let i = 1; i < edges.length; i++) { const w = edges[i] - edges[i - 1]; if (!best || w > best.w + 1e-9) best = { w, x: (edges[i] + edges[i - 1]) / 2 }; }
        laneX = best.x;
      }
      c.lane = laneX;
      carK = [[snap, S0[0], S0[1]], ...kfPath([S0, M], vC, t0)];
      if (carK[1][0] <= snap + 1e-9) carK.shift();
      carK = kfThen(kfCut(carK, c.handT), [[laneX, -0.5], ...after(laneX, -0.5)], vC);
    } else {
      const X = G[ca.aim];
      const pts = [S0];
      if (ca.counterStep) pts.push([S0[0] - s * R.JAB, S0[1] + 0.3]);
      pts.push([X, -1.5], [X, 0.5], ...after(X, 0.5));
      // Following a puller: he reaches the line (X, -1.5) RUN.FOLLOW s after the puller gets to the hole.
      let d = num(ca.delay, 0);
      const tv = ca.follow ? viaT(ca.follow) : null;
      if (isNum(tv)) { let L = 0; for (let i = 1; i < pts.length && i <= (ca.counterStep ? 2 : 1); i++) L += dist(pts[i - 1], pts[i]); d = Math.max(d, r6(tv + R.FOLLOW - snap - L / vC)); }
      c.carryDelay = d;
      carK = kfPath(pts, vC, snap + d);
      if (d > 0) carK.unshift([snap, S0[0], S0[1]]);
      // The quarterback meets him at the handoff, MESH yd on the backside of him, then carries out his fake.
      const H = kfAt(carK, c.handT), M = [H[0] - s * R.MESH, H[1]];
      qb.track = [[snap, qb.x, qb.y], [c.handT, M[0], M[1]], [r6(c.handT + R.FAKE / 4), M[0] - s * R.FAKE, M[1] - 0.5]];
    }
    car.track = carK;
    c.aimPt = ca.aim ? [G[ca.aim], 0.5] : null;
    // 2b. Each defender's free plan: his job to his react time, then the pursuit.
    const carAt = (t) => kfAt(car.track, t), tMin = c.handT + 0.1;
    const plan = {};
    for (const p of c.def) {
      const Rt = react[p.id], P = kfAt(pre[p.id], Rt), v = num(p.src.v, CS.SPEEDS[p.pos]);
      const hit = CS.intercept(P, Rt, v, carAt, R.TACKLE, TMAX, tMin);
      plan[p.id] = kfCut(pre[p.id], Rt).concat(hit ? [[hit.t, hit.at[0], hit.at[1]]] : []);
      p.tau = hit ? hit.t : Infinity;
    }
    // 4. The blocks against the free plans.
    const B = blockAll((id) => plan[id]);
    c.blockInfo = B.info;
    // 5. The tackle: the first free man to the carrier (a man blocked only after he got there counts).
    let tk = null;
    for (const p of c.def) {
      const blockedAt = isNum(B.eng[p.id]) ? B.eng[p.id] : Infinity;
      if (p.tau < blockedAt - 1e-9 && (!tk || p.tau < tk.tau - 1e-9)) tk = p;
    }
    const downT = tk ? tk.tau : TMAX;
    c.downT = downT; c.tackleBy = tk ? tk.id : null;
    car.track = kfCut(car.track, downT);
    const spot = kfAt(car.track, downT);
    c.tackleAt = spot;
    for (const p of c.def) {
      const blockedAt = isNum(B.eng[p.id]) ? B.eng[p.id] : Infinity;
      if (blockedAt < p.tau - 1e-9 || (B.T[p.id] && blockedAt < downT)) { p.track = B.T[p.id]; p.engaged = blockedAt; continue; }
      // Free: his pursuit to the tackle, then (if he is not the tackler) he closes on the spot.
      let K = kfCut(plan[p.id], downT);
      if (p !== tk) { const z = K[K.length - 1], d = dist([z[1], z[2]], spot); if (d > R.CLOSE) { const u = (d - R.CLOSE) / d; K = kfThen(K, [[z[1] + (spot[0] - z[1]) * u, z[2] + (spot[1] - z[2]) * u]], 0.6 * num(p.src.v, CS.SPEEDS[p.pos])); } }
      p.track = K;
    }
    for (const p of c.off) {
      if (B.T[p.id]) { p.track = B.T[p.id]; if (isNum(B.eng[p.id])) p.engaged = B.eng[p.id]; }
      else if (p.role === 'route') p.track = kfCut(p.track, downT + 0.3);
      else if (!p.track) p.track = [[snap, p.x, p.y]];
    }
    c.T = num(play.T, downT + R.END);
    c.runReady = true;
  }
  CS.BALL_ENDS = ['catch', 'incomplete', 'breakup', 'pick'];
  const DEF_JOBS = ['zone', 'rush', 'man', 'spy', 'still'];
  CS.ENGAGE = 1.0;          // yd: a blocker and his rusher this close have met
  CS.ENGAGE_SET = 0.9;      // yd: where a pass blocker sets, behind his man's gap
  CS.SACK_REACH = 0.7;      // yd: a free rusher stops this far in front of the quarterback (he has him)
  CS.CONTACT_YD = 2.0;      // yd: a breakup or a pick is by a defender at most this far from the target as the ball arrives

  // Where the offense is at t (no defensive reactions needed: the offense never reads the defense here).
  function offPos(c, p, t) {
    if (c.runReady && p.track) return inField(kfAt(p.track, t));
    const path = p.path, tt = t - c.snapT;
    if (p.held != null && t > p.held) return offPos(c, { ...p, held: null }, p.held);   // engaged: he holds his ground
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
      // Trail technique (2-man, fact sheet 5b "5 man underneath with trail technique"; the
      // library's "from just behind and under the receiver, trusting deep help"): he sits
      // CS.TRAIL yd behind his man (on the quarterback's side of him, y less) and half a yard
      // inside him, instead of a yard over the top.
      const off0 = [p.x - r.x, p.y - r.y], cush = p.trail ? [inDir(r.side) * 0.5, -CS.TRAIL] : [0, 1.0];
      const u = clamp(tt / 1.2, 0, 1);
      return [rp[0] + off0[0] + (cush[0] - off0[0]) * u, rp[1] + off0[1] + (cush[1] - off0[1]) * u];
    }
    if (p.role === 'spy') {
      const q = offPos(c, c.byId[p.spyOf], t);
      return [p.x + (q[0] - p.x) * clamp(tt / 0.8, 0, 1), p.y];
    }
    if (p.readOf != null && tt > CS.READ_T) {
      // The read: from where his drop has him at READ_T, onto #2 (a lag of 0.2 s, like man): over
      // the top of a vertical (CS.CARRY yd deeper), on top of a route that breaks (CS.DRIVE yd).
      // He gets there over `blend` s, the time to cover that distance at 85% of his speed.
      const r = c.byId[p.readOf], P0 = along(p.path.pts, p.path.v * CS.READ_T, false);
      const cush = p.readKind === 'carry' ? CS.CARRY : CS.DRIVE;
      const q0 = offPos(c, r, c.snapT + CS.READ_T - 0.2), blend = Math.max(0.6, dist(P0, [q0[0], q0[1] + cush]) / (0.85 * p.path.v));
      const q = offPos(c, r, Math.max(c.snapT, t - 0.2)), u = clamp((tt - CS.READ_T) / blend, 0, 1);
      return [P0[0] + (q[0] - P0[0]) * u, P0[1] + (q[1] + cush - P0[1]) * u];
    }
    return along(p.path.pts, p.path.v * Math.max(0, tt - num(p.path.delay, 0)), false);
  }
  CS.TRAIL = 1.0;           // yd a trail-technique defender sits behind his man
  CS.CARRY = 2.0;           // yd over the top of a vertical #2 a reading safety stays
  CS.DRIVE = 0.8;           // yd above a breaking #2 a reading safety drives to
  // Defenders in coverage (zone, man, spy) break on the throw toward the catch spot, then chase the
  // carrier; rushers keep rushing. Straight-line moves at their own speed, closed form, so the
  // position at any t is a pure function of t.
  function defPos(c, p, t) {
    if (t <= c.snapT) return [p.x, p.y];
    if (c.runReady && p.track) return inField(kfAt(p.track, t));
    if (p.held != null && t > p.held) return defPlanned(c, p, p.held);       // a blocker has him
    const chase = p.role !== 'rush' && p.role !== 'still' && c.throwT != null && c.arriveT != null;
    const tr = c.throwT + CS.REACT;
    if (!chase || t <= tr) return defPlanned(c, p, t);
    const P0 = defPlanned(c, p, tr), v = num(p.src.v, CS.SPEEDS[p.pos]);
    const recv = c.byId[c.target];
    // Everyone in coverage breaks on the ball: toward where the target is when it arrives.
    const C = offPos(c, recv, c.arriveT);
    const step = (from, to, dt) => {
      const L = dist(from, to), go = clamp(Math.min(v * dt, L - 1), 0, Infinity);
      if (L === 0) return from.slice();
      return [from[0] + (to[0] - from[0]) * go / L, from[1] + (to[1] - from[1]) * go / L];
    };
    if (t <= c.arriveT) return step(P0, C, t - tr);
    const Q = step(P0, C, c.arriveT - tr);
    // A pick: he secures it (CS.SECURE s), then runs it back toward the offense's goal line.
    if (c.end === 'pick' && p.id === c.by) {
      const run = Math.max(0, t - c.arriveT - CS.SECURE) * v * 0.85;
      return [Q[0], Q[1] - run];
    }
    // After the catch: a pursuit angle straight at the spot where the carrier goes down. Aiming
    // at his moving position instead swings the heading every frame and the swept point outran
    // the defender's own speed by up to 4% (caught by the suite's speed check). With no catch
    // (incomplete, broken up, picked) they pull up where the ball came down.
    const end = c.downT != null ? offPos(c, recv, c.downT) : C;
    return step(Q, end, t - c.arriveT);
  }
  CS.SECURE = 0.25;         // s: an interceptor pulls the ball in before he runs

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
    // A run: the QB holds it to the handoff, then it is the carrier's (the exchange is the moment
    // the two meet at the mesh point, CS.RUN.MESH yd apart), down with him at the tackle.
    if (c.run) { const h = t < c.handT ? qb : c.byId[c.carrier], q = posOf(h, t); return { x: q[0], y: q[1], air: HANDS, held: h.id }; }
    if (c.throwT == null || t < c.throwT || c.arriveT == null) { const q = posOf(qb, t); return { x: q[0], y: q[1], air: HANDS, held: qb.id }; }
    const recv = c.byId[c.target], a = posOf(qb, c.throwT), b = CS.ballEndOf(c, posOf);
    const ground = c.end === 'incomplete' ? 0.1 : HANDS;
    if (t < c.arriveT) {
      const u = (t - c.throwT) / (c.arriveT - c.throwT);
      const apex = clamp(dist(a, b) * 0.12, 0.5, 6);
      return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, air: HANDS + (ground - HANDS) * u + 4 * apex * u * (1 - u), held: null };
    }
    if (c.end === 'catch') { const r = posOf(recv, t); return { x: r[0], y: r[1], air: HANDS, held: recv.id }; }
    if (c.end === 'pick') { const r = posOf(c.byId[c.by], t); return { x: r[0], y: r[1], air: HANDS, held: c.by }; }
    if (c.end === 'breakup') {
      // Knocked away: it carries on CS.DEFLECT yd along its flight, falling to the grass over 0.4 s, and lies there.
      const L = dist(a, b) || 1, u = clamp((t - c.arriveT) / 0.4, 0, 1);
      return { x: b[0] + (b[0] - a[0]) / L * CS.DEFLECT * u, y: b[1] + (b[1] - a[1]) / L * CS.DEFLECT * u, air: 0.1 + (HANDS - 0.1) * (1 - u) + 1.2 * u * (1 - u), held: null };
    }
    return { x: b[0], y: b[1], air: 0.1, held: null };                    // incomplete: on the grass where it landed
  }
  CS.DEFLECT = 1.5;
  // Where a thrown ball's flight ends, yards: the receiver at the catch (or where an incomplete pass
  // lands by him), else the defender who plays it, where he is when it gets there (the contact point).
  CS.ballEndOf = (c, posOf) => {
    if (c.end === 'breakup' || c.end === 'pick') return posOf(c.byId[c.by], c.arriveT);
    return posOf(c.byId[c.target], c.arriveT);
  };

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

  /* ── the neutral zone, drawn wide (the dad, 2026-11-11, at the LOS card on his phone: "still
     instances where lines are overlapping") ── The yards above stay the fact sheet's (DL 1 yd off
     the ball, QB under center 1 yd behind it, the gun back 2 yd beside the QB). The sprites are
     wider than that: a lineman in his stance paints 15 world px in front of his feet and 10 behind,
     and a yard is 14 px. So the picture spreads the alignment out the way a coaching diagram does,
     here and only here, in screen terms:
       1. The neutral zone. The whole offense slides back until no offensive sprite comes within
          NZ_PAD px of the line of scrimmage, and the whole defense slides forward until none of
          theirs does. One shift per team keeps every depth inside the team (X on the line and Z a
          yard off stay a yard apart; a 3-tech is still outside the guard's shoulder, since nobody
          moves across the field here).
       2. Teammates. Any two of the same team whose painted boxes come within GAP px of each other
          on both axes are pulled apart along whichever axis needs the smaller move: along the
          field the man farther from the line moves away from it (the QB under center goes back off
          the center's seat), across the field the man farther from the ball moves outward (the gun
          back slides a few px wider of the QB). Order is never swapped.
     ext(p) is his set-pose sprite's painted extent from his feet in world px {l, r, t, b}; px, py are
     world px per yard along / across. Returns {id: {dx, dy}} in yards at full strength. The spread
     holds until the snap, then eases out over SPREAD_T s (the lines fire off into each other), so
     after the snap the picture is the yards again; contact is football. */
  CS.NZ_PAD = 3;
  CS.SPREAD_GAP = 1;
  CS.SPREAD_T = 0.5;
  CS.spreadOf = (c, ext, px, py) => {
    const P = {}, E = {};
    for (const p of c.all) { P[p.id] = { X: p.y * px, Y: p.x * py, team: p.team }; E[p.id] = ext(p); }
    let aO = 0, aD = 0;
    for (const p of c.off) aO = Math.max(aO, P[p.id].X + E[p.id].r + CS.NZ_PAD);
    for (const p of c.def) aD = Math.max(aD, CS.NZ_PAD - (P[p.id].X - E[p.id].l));
    for (const p of c.off) P[p.id].X -= aO;
    for (const p of c.def) P[p.id].X += aD;
    const ids = c.all.map((p) => p.id), bY = c.ballX * py, G = CS.SPREAD_GAP;
    for (let it = 0; it < 400; it++) {
      let worst = null;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = P[ids[i]], b = P[ids[j]];
        if (a.team !== b.team) continue;
        const ea = E[ids[i]], eb = E[ids[j]];
        const ox = Math.min(a.X + ea.r, b.X + eb.r) - Math.max(a.X - ea.l, b.X - eb.l) + G;
        const oy = Math.min(a.Y + ea.b, b.Y + eb.b) - Math.max(a.Y - ea.t, b.Y - eb.t) + G;
        if (ox > 1e-6 && oy > 1e-6) { const m = Math.min(ox, oy); if (!worst || m > worst.m) worst = { i: ids[i], j: ids[j], ox, oy, m }; }
      }
      if (!worst) break;
      const a = P[worst.i], b = P[worst.j], sgn = a.team === 'off' ? -1 : 1;
      if (worst.ox <= worst.oy) {
        // Along: the man farther from the line moves away from it (a tie goes to the one farther from the ball).
        const da = sgn * a.X, db = sgn * b.X;
        const mv = da > db + 1e-9 || (Math.abs(da - db) <= 1e-9 && Math.abs(a.Y - bY) >= Math.abs(b.Y - bY)) ? a : b;
        mv.X += sgn * worst.ox;
      } else {
        const fa = Math.abs(a.Y - bY), fb = Math.abs(b.Y - bY), mv = fa >= fb ? a : b, other = mv === a ? b : a;
        mv.Y += (mv.Y >= other.Y ? 1 : -1) * worst.oy;
      }
    }
    const out = {};
    for (const p of c.all) out[p.id] = { dy: P[p.id].X / px - p.y, dx: P[p.id].Y / py - p.x };
    return out;
  };
  // How much of the spread is on at t: all of it before the snap, easing to none SPREAD_T s after.
  CS.spreadW = (c, t) => (t <= c.snapT ? 1 : 1 - CS.ease(clamp((t - c.snapT) / CS.SPREAD_T, 0, 1)));
  // Where a man is DRAWN at t: poseAt plus the spread. A loose ball in the snap's flight carries
  // the QB's share u of the way, so it leaves the spot and lands in his hands; a held ball rides
  // its holder; a thrown ball is past the spread (SPREAD_T < every throw).
  CS.showAt = (play, t, spread, lib) => {
    const c = CS.compile(play, lib), P = CS.poseAt(play, t, lib), w = CS.spreadW(c, t), players = {};
    for (const [id, q] of Object.entries(P.players)) { const s = spread && spread[id]; players[id] = s ? { x: q.x + s.dx * w, y: q.y + s.dy * w } : { ...q }; }
    const b = { ...P.ball };
    if (b.held && players[b.held]) { b.x = players[b.held].x; b.y = players[b.held].y; }
    else if (spread && c.qb && spread[c.qb.id] && t > c.snapT) {
      const dur = c.qb.y <= -3 ? 0.3 : 0.12, u = clamp((t - c.snapT) / dur, 0, 1);
      if (u < 1) { b.x += spread[c.qb.id].dx * w * u; b.y += spread[c.qb.id].dy * w * u; }
    }
    return { players, ball: b };
  };

  // A run play's own rules (the run engine, above): a known rule token for every blocker, a gap to
  // pull through, one carrier with a real aim (or none, on a draw), a quarterback who can reach the
  // mesh by the handoff, run to the right as drawn (no mirrored runs yet), and no throw.
  function runErrors(play, c, lib, L) {
    const e = [], A = play.assign || {};
    const runners = Object.entries(A).filter(([, a]) => a && (a.run || a.kick || a.carry || a.handoff));
    if (!c.run) { if (runners.length) e.push(`${L}: run assignments (${runners.map(([k]) => k).join(', ')}) but no handoff`); return e; }
    if (c.runError) return [`${L}: ${c.runError}`];
    if (play.mirror) e.push(`${L}: runs are drawn to the right only (no mirror)`);
    if (c.throwT != null) e.push(`${L}: a handoff and a throw on one play`);
    const qa = A[c.qb.id] || {};
    if (qa.handoff !== c.carrier) e.push(`${L}: the QB's handoff (${qa.handoff}) is not the ball's (${c.carrier})`);
    const ca = (A[c.carrier] || {}).carry;
    if (!ca) e.push(`${L}: ${c.carrier} gets the ball but has no carry`);
    else if (ca.aim == null ? qa.drop == null : CS.gapX(ca.aim) == null) e.push(`${L}: ${c.carrier} aims at ${ca.aim} (a known gap, or none only on a draw)`);
    if (ca && ca.follow != null && !/^pull-/.test((A[ca.follow] || {}).run || '')) e.push(`${L}: ${c.carrier} follows ${ca.follow}, who does not pull`);
    if (!(c.handT > c.snapT)) e.push(`${L}: the handoff comes after the snap`);
    for (const [id, a] of runners) {
      if (a.run && !(lib.RUN_RULES && lib.RUN_RULES[a.run])) e.push(`${L}: ${id} has unknown run rule ${a.run}`);
      if (/^pull-/.test(a.run || '') && !(a.pull && CS.gapX(a.pull.via) != null)) e.push(`${L}: ${id} pulls with no known gap to pull through`);
      if (a.kick != null && a.kick !== 'EMOL' && !(c.byId[a.kick] && c.byId[a.kick].team === 'def')) e.push(`${L}: ${id} kicks out ${a.kick} (EMOL or a defender)`);
    }
    // The exchange: the quarterback's track reaches the mesh at the handoff, at no more than his speed.
    const q = c.qb, K = q.track;
    if (qa.drop == null && K && K.length > 1) { const v = Math.hypot(K[1][1] - K[0][1], K[1][2] - K[0][2]) / Math.max(1e-9, K[1][0] - K[0][0]); if (v > CS.SPEEDS.QB + 1e-6) e.push(`${L}: the QB would run ${v.toFixed(2)} yd/s to the mesh by ${c.handT} s (max ${CS.SPEEDS.QB})`); }
    return e;
  }
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
      if (p && p.team === 'def') {
        // A defender's job for this play (compile merges it over the defense's).
        const s = p.src;
        if (s.zone != null && !lib.ZONES[s.zone]) e.push(`${L}: ${id} has unknown zone ${s.zone}`);
        if (s.aim != null && (!lib.ZONES[s.aim] || s.zone == null)) e.push(`${L}: ${id} aims at ${s.aim}: needs a zone job and a known landmark`);
        if (s.rush != null && CS.gapX(s.rush) == null) e.push(`${L}: ${id} rushes unknown gap ${s.rush}`);
        if (s.then != null && (s.then !== 'QB' || s.rush == null)) e.push(`${L}: ${id}: then:'QB' is the only follow-on, and only for a rusher`);
        if (s.then === 'QB' && c.off.some((q) => q.on === id)) e.push(`${L}: ${id} keeps coming to the QB, but a blocker has him`);
        if (s.man != null && !(c.byId[s.man] && c.byId[s.man].team === 'off')) e.push(`${L}: ${id} covers unknown ${s.man}`);
        continue;
      }
      if (!p || p.team !== 'off') { e.push(`${L}: assignment for unknown offensive player ${id}`); continue; }
      if (a.on != null && (a.run || a.kick)) {
        // A run block by name: any defender (the run engine sends him there).
        if (!(c.byId[a.on] && c.byId[a.on].team === 'def')) e.push(`${L}: ${id} run-blocks unknown defender ${a.on}`);
      } else if (a.on != null) {
        const r = c.byId[a.on];
        if (!r || r.team !== 'def' || r.role !== 'rush') e.push(`${L}: ${id} blocks ${a.on}, who is not a rusher on this play`);
        else if (p.held == null) e.push(`${L}: ${id} never meets ${a.on}`);
      }
      if (a.route) {
        e.push(...CS.validateRoute(a.route, lib.ROUTES[a.route]));
        const usesSide = (lib.ROUTES[a.route] || { pts: [] }).pts.some((pt) => typeof pt[0] === 'string');
        if (usesSide && !a.side && p.side === 'M') e.push(`${L}: ${id} lines up over the ball, so "in"/"out" needs side:"L"|"R"`);
      }
      if (a.block && CS.gapX(a.block) == null) e.push(`${L}: ${id} blocks unknown gap ${a.block}`);
    }
    for (const p of c.def) if (p.role === 'man' && !(c.byId[p.manOf] && c.byId[p.manOf].team === 'off')) e.push(`${L}: ${p.id} covers unknown ${p.manOf}`);
    e.push(...runErrors(play, c, lib, L));
    const ts = (play.ball || []).map((b) => b.t);
    for (let i = 1; i < ts.length; i++) if (!(ts[i] > ts[i - 1])) e.push(`${L}: ball events out of order`);
    if (c.throwT != null) {
      const r = c.byId[c.target];
      if (!r || r.team !== 'off') e.push(`${L}: throw to unknown ${c.target}`);
      const ends = (play.ball || []).filter((b) => CS.BALL_ENDS.includes(b.ev));
      if (!ends.length) e.push(`${L}: a throw needs a catch (or an incomplete, a breakup, a pick)`);
      if (ends.length > 1) e.push(`${L}: a throw ends once: ${ends.map((b) => b.ev).join(' and ')}`);
      if (c.end && (c.end === 'breakup' || c.end === 'pick')) {
        const d = c.byId[c.by];
        if (!d || d.team !== 'def') e.push(`${L}: ${c.end} by unknown defender ${c.by}`);
        else if (r && r.team === 'off') {
          // Honest contact: the man who plays it is on the target when the ball gets there.
          const P = CS.poseAt(play, c.arriveT, lib).players, gap = Math.hypot(P[c.by].x - P[c.target].x, P[c.by].y - P[c.target].y);
          if (gap > CS.CONTACT_YD) e.push(`${L}: ${c.by} is ${gap.toFixed(2)} yd from ${c.target} when the ball arrives: too far to play it (max ${CS.CONTACT_YD})`);
        }
      }
      if (c.sackT != null) e.push(`${L}: a sack and a throw on one play`);
    } else if ((play.ball || []).some((b) => CS.BALL_ENDS.includes(b.ev))) e.push(`${L}: a catch with no throw`);
    if (c.sackT != null) {
      const d = c.byId[c.sackBy];
      if (!d || d.team !== 'def') e.push(`${L}: sack by unknown defender ${c.sackBy}`);
      else if (c.qb) {
        const P = CS.poseAt(play, c.sackT, lib).players, gap = Math.hypot(P[d.id].x - P[c.qb.id].x, P[d.id].y - P[c.qb.id].y);
        if (gap > CS.SACK_REACH + 0.3) e.push(`${L}: ${d.id} is ${gap.toFixed(2)} yd from the QB at the sack (max ${(CS.SACK_REACH + 0.3).toFixed(1)})`);
      }
    }
    // Men moved for this play (align): still a legal lineup.
    const al = Object.keys(play.align || {});
    for (const id of al) if (!c.byId[id]) e.push(`${L}: align moves unknown ${id}`);
    if (al.some((id) => c.byId[id] && c.byId[id].team === 'off')) {
      const g = CS.validateFormation({ id: 'aligned', personnel: c.formation.personnel, players: c.off.map((p) => ({ id: p.id, pos: p.pos, x: p.x, y: p.y })) });
      e.push(...g.filter((m) => !/out of bounds|apart \(min/.test(m)).map((m) => `${L}: ${m}`));
    }
    for (const id of al) { const p = c.byId[id]; if (p && p.team === 'def' && !(p.y >= CS.DEF_MIN_Y)) e.push(`${L}: ${id} is in the neutral zone or offside (y ${p.y})`); }
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
  // o.WX: the world's width along the field when the field art runs further downfield than the
  // window (the deep camera); o.zmin: how far out it may zoom (below 1 the view is wider than the
  // window; an axis the view is wider than the world on is centred on it). o.VH (2026-11-12, the
  // full-width field): the view's height in world px at zoom 1 when the canvas shows less than the
  // world's H across the field (a short box: the field keeps the column's width and crops across).
  CS.camClamp = (cam, W, H, o) => {
    o = o || {};
    const WX = num(o.WX, W), VH = num(o.VH, H), z = Math.max(num(o.zmin, 1), cam.z), hw = W / (2 * z), hh = VH / (2 * z);
    return { cx: WX >= 2 * hw ? clamp(cam.cx, hw, WX - hw) : WX / 2, cy: H >= 2 * hh ? clamp(cam.cy, hh, H - hh) : H / 2, z };
  };
  /* ── the deep camera ── The window (CS.VIEW) reaches 19.6 yd downfield, so a go or a seam was
     caught off the screen. A run's camera takes in the whole flight of the ball: when the ball's
     furthest point (from the throw to where it is caught or played) is past DEEP_EDGE yd short of
     the window's far edge (the line the route checks used to call "inside the view"), the view
     widens along the field, from the same near edge to DEEP_PAD yd past that point, zooming out to
     fit (portrait kept: the field's width stays across the screen). Returns the yards {y0, y1} the
     run shows along the field, or null for the plain window. */
  CS.DEEP_EDGE = 0.5;
  CS.DEEP_PAD = 2.5;
  CS.ballSpan = (play, lib) => {
    const c = CS.compile(play, lib);
    if (c.throwT == null || c.arriveT == null) return null;
    // The flight, and a knocked-away ball's last yard and a half; not the run after a catch.
    const P = (t) => CS.poseAt(play, t, lib).ball, ys = [], t1 = Math.min(c.T, c.arriveT + (c.end === 'breakup' ? 0.4 : 0));
    for (let t = c.throwT; t <= t1 + 1e-9; t += 0.05) ys.push(P(t).y);
    ys.push(P(c.arriveT).y, P(t1).y);
    return { y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  CS.runWindow = (play, lib) => {
    const s = CS.ballSpan(play, lib), { Y0, Y1 } = CS.VIEW;
    if (!s || s.y1 <= Y1 - CS.DEEP_EDGE) return null;
    return { y0: Y0, y1: s.y1 + CS.DEEP_PAD };
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
    const VH = num(o.VH, H), zr = Math.min(W / (r.x1 - r.x0 + 2 * m), VH / (r.y1 - r.y0 + 2 * m), fill * VH / Math.max(1, r.y1 - r.y0));
    // zmin (default 1): the deep camera may zoom out past the window, by `step`s like zooming in.
    const zmin = num(o.zmin, 1), z = Math.max(zmin, Math.floor(Math.min(zmax, zr) / step + 1e-9) * step);
    return CS.camClamp({ cx: (r.x0 + r.x1) / 2, cy: (r.y0 + r.y1) / 2, z }, W, H, { WX: o.WX, zmin, VH });
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
    const { W, H, w, h } = o, pad = num(o.pad, 6), gap = num(o.gap, 40), targets = o.targets || [], avoid = o.avoid || [], block = o.block || [];
    const cx = (t) => (t.pt ? t.pt.x : (t.rect.l + t.rect.r) / 2);   // a group's arrow point is chosen after placement: aim at its rect
    const mx = targets.length ? targets.reduce((s, t) => s + cx(t), 0) / targets.length : W / 2;
    const xs = [...new Set([clamp(mx - w / 2, pad, W - pad - w), pad, W - pad - w, clamp((W - w) / 2, pad, W - pad - w)])];
    const score = (x, y) => {
      const b = { x, y, w, h };
      if (x < pad - 0.01 || y < pad - 0.01 || x + w > W - pad + 0.01 || y + h > H - pad + 0.01) return Infinity;
      if (targets.some((t) => hits(b, t.rect, 6))) return Infinity;
      // block: ground the bubble may never cover (an outcome run's action, swept over the whole run).
      if (block.some((r) => hits(b, r, 4))) return Infinity;
      let s = 0;
      // A spot that leaves any arrow under 26 px from bubble to point is a last resort: its arrow,
      // stopped 9 px short, is a stub you can't see (2026-11-11: with production's sprites, four
      // arrows to the DBs averaged out to a spot 20 px from one of them).
      for (const t of targets) { const d = t.pt ? rectDist(b, t.pt) : rectGap(b, t.rect); s += Math.abs(d - gap) + (t.pt && d < 26 ? 1000 : 0); }
      for (const a of avoid) s += overlapArea(b, a) * 0.05;
      return s;
    };
    let best = null;
    for (let y = pad; y <= H - pad - h + 0.01; y += 4) for (const x of xs) { const s = score(x, y); if (s < Infinity && (!best || s < best.s)) best = { x, y, s }; }
    if (o.prev && best) { const s = score(o.prev.x, o.prev.y); if (s < best.s + 30) best = { x: o.prev.x, y: o.prev.y, s }; }
    if (best) return { x: best.x, y: best.y, ok: true };
    if (block.length) return { ...CS.placeBubble({ ...o, block: [] }), ok: false };
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

  /* ── yard helpers the interactive puzzle types share (pure) ── */
  // Gaps from where the linemen actually stand (fact sheet 8: A center-guard, B guard-tackle,
  // C tackle-TE or outside the tackle with no TE, D outside the TE). A and B are the midpoints; C is
  // the tackle-TE midpoint when an inline tight end (on the line, within 2 yd of the tackle) is
  // there, else half a split outside the tackle; D is half a split outside the TE, else one and a
  // half splits outside the tackle. On the fact sheet's line (1.5 yd splits, TE at 4.5) that is
  // CS.GAPS exactly; with the ball on a hash it moves with the line. Returns {'A-gap-L': x, ...}.
  CS.gapsOf = (c) => {
    const ol = c.off.filter((p) => CS.OL.includes(p.pos)).sort((a, b) => a.x - b.x), out = {};
    if (ol.length !== 5) return out;
    const C = ol[2], mid = (a, b) => (a + b) / 2;
    for (const [side, s, G, T] of [['L', -1, ol[1], ol[0]], ['R', 1, ol[3], ol[4]]]) {
      const te = c.off.find((p) => p.pos === 'TE' && p.y >= CS.ON_LINE_Y && Math.abs(p.x - T.x) <= 2 && s * (p.x - T.x) > 0);
      const half = Math.abs(T.x - G.x) / 2;
      out['A-gap-' + side] = mid(C.x, G.x);
      out['B-gap-' + side] = mid(G.x, T.x);
      out['C-gap-' + side] = te ? mid(T.x, te.x) : T.x + s * half;
      out['D-gap-' + side] = te ? te.x + s * half : T.x + s * 3 * half;
    }
    return out;
  };
  // The nearest landmark {x, y, name?} within `tol` yards of pos (inclusive), or null.
  CS.snapTo = (pos, landmarks, tol) => {
    let best = null;
    for (const m of landmarks || []) {
      const d = Math.hypot(m.x - pos.x, m.y - pos.y);
      if (d <= tol + 1e-9 && (!best || d < best.d)) best = { x: m.x, y: m.y, name: m.name == null ? null : m.name, d };
    }
    return best;
  };
  // A route's waypoints in absolute yards for one receiver of a play: from his alignment (the ball's
  // hash included), "in"/"out" by his side (or his assignment's side). route = a ROUTES name or {pts}.
  CS.routeWaypoints = (play, id, route, lib) => {
    lib = lib || CS.lib;
    const c = CS.compile(play, lib), p = c.byId[id];
    if (!p) throw new Error(`routeWaypoints: ${id} is not on the field`);
    const r = typeof route === 'string' ? lib.ROUTES[route] : route;
    if (!r) throw new Error('routeWaypoints: unknown route ' + route);
    const a = (play.assign || {})[id] || {};
    return CS.routePoints(r, [p.x, p.y], a.side || p.side);
  };
  // A variant of a play for an outcome run (his wrong route, the unblocked rusher): a NEW object (so
  // the compile cache never mixes them), id suffixed, assignments merged per player, other keys
  // replaced: CS.variantOf(play, { tag: 'wrong', assign: { X: { route: 'slant' } }, ball: [...] }).
  // align: { id: {x, y} } moves men for the run, in FIELD yards (after the play's mirror and hash
  // shift, ids as compiled), merged per man over the play's own align; validatePlay still holds the
  // lineup to the formation's rules. A defender's id in assign gives him this play's job.
  CS.variantOf = (play, o) => {
    o = o || {};
    const v = { ...play };
    for (const [k, val] of Object.entries(o)) if (k !== 'tag' && k !== 'assign' && k !== 'align') v[k] = val;
    v.id = play.id + '~' + (o.tag == null ? 'v' : o.tag);
    v.assign = { ...(play.assign || {}) };
    for (const [id, a] of Object.entries(o.assign || {})) v.assign[id] = a;
    if (o.align || play.align) {
      v.align = { ...(play.align || {}) };
      for (const [id, a] of Object.entries(o.align || {})) v.align[id] = { x: a.x, y: a.y };
    }
    return v;
  };

  /* ── puzzles: the puzzle-type plugin contract ── (full brief: docs/coachschool-puzzle-types.md)
     Each type lives in its own file, assets/coachschool/cs-pz-<name>.js, and registers

       CS.puzzleTypes[name] = {
         name,
         // PURE (no DOM; the suite runs these in a Node vm). `ans` is the type's answer shape, any
         // JSON value: a player id (tap), an option index (choice), an object for the drag types.
         check(pz, ans, lib)        -> boolean    right or wrong; the one judge, for the UI and the suite
         truth(pz, lib)             -> ans        the right answer, worked out from the play, in answer shape
         distractors(pz, lib)       -> ans[]      wrong answers worth testing (non-empty; each must fail check)
         validate(pz, lib)          -> string[]   authoring errors ([] = clean); must flag two right answers
         examples?                  : pz[]        fixture puzzles on library plays; the conformance check
                                                  runs them, so a type no content uses yet is still tested
         // PAGE (cs-ui calls these with a ctx; a type never reaches into cs-ui)
         mount(ctx)                 -> handle     put up the type's controls and field hooks for one puzzle
         rightName(pz, ctx)         -> string     the right answer in words: "The answer: <rightName>."
         lookOf(pz, ctx)            -> tokens|null  CS.focusOf tokens the explanation bubble points at
                                                  (null = the explanation stays in the panel)
         outcome?(pz, ans, ok, ctx) -> runs|null  what plays after the answer, in order:
                                                  [{ play, say?, marks?, chalk? }]; null = the puzzle's own
                                                  play once. Wrong: the failure plays out, then the right one.
       }
       handle = { destroy()                       remove every control, listener, overlay and drag it added
                  onTap?(id)                      a tap on the field (a player id, or null for grass)
                  missed?(ans)                    first wrong try in a lesson: show what he picked
                  resolved?({ ok, picked })       the puzzle is over: lock the controls; may return
                                                  extra marks [{id, kind}] for the field }

     cs-ui's askPuzzle is type-agnostic and owns the rest: tries (2 in lessons, 1 on Game Day), XP and
     review boxes, the right / wrong sound, the explanation (bubble or panel), "after any answer the
     play runs", Game Day scoring. The ctx (cs-ui.js, makeCtx) carries pz, play, lib, CS, doc, field
     (the stage field and its interaction hooks, cs-field.js), panel (#stOpts: empty and hidden at
     mount), submit(ans), feedback(kind, parts), say(bubble), action(label, fn) (the main button),
     focusMarks, tries, tryNo, done, gameDay, reduced, sfx, nameOf(id), lc(text).
     CS.PUZZLE_API lists the members; CS.contractErrors(T) is what the conformance check calls. */
  CS.puzzleTypes = CS.puzzleTypes || {};
  CS.PUZZLE_API = { pure: ['check', 'truth', 'distractors', 'validate'], page: ['mount', 'rightName', 'lookOf'], optional: ['outcome', 'examples'] };
  CS.contractErrors = (T, name) => {
    const e = [], L = `puzzle type ${name == null ? T && T.name : name}`;
    if (!T || typeof T !== 'object') return [`${L}: not registered`];
    if (name != null && T.name !== name) e.push(`${L}: registered as ${name} but names itself ${T.name}`);
    for (const k of [...CS.PUZZLE_API.pure, ...CS.PUZZLE_API.page]) if (typeof T[k] !== 'function') e.push(`${L}: no ${k}()`);
    if (T.outcome != null && typeof T.outcome !== 'function') e.push(`${L}: outcome must be a function`);
    if (T.examples != null && !Array.isArray(T.examples)) e.push(`${L}: examples must be an array of puzzles`);
    return e;
  };
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
