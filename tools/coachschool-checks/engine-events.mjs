/**
 * Engine events (cs-core.js, 2026-11-12): how a thrown ball ends (breakup, pick, incomplete), pass
 * protection on a named rusher, a free rusher who keeps coming to the quarterback, and the deep
 * camera (CS.runWindow, cs-field's run camera). Every expected number is worked out here from the
 * play's own yards and the constants, never read back from the function under test.
 */
const J = JSON.stringify;

export async function node(H) {
  const { check, near, CS, L } = H;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const sm = L.PLAYS['smash-vs-c2'];

  // ── a ball played by a defender ── Smash vs Cover 2, the ball to X's hitch at 2.4 s. The flat
  // corner (CB-L, "flat L", 5a) sits on it. Arrival at 30 yd/s: the QB at the throw to X at the
  // arrival, rounded up to a tenth, iterated (the time depends on where X is).
  const R1 = (x) => Math.ceil(x * 10 - 1e-9) / 10;
  let arr = 2.8;
  for (let k = 0; k < 6; k++) {
    const v = CS.variantOf(sm, { tag: 'h', ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'X' }, { t: arr, ev: 'catch' }] });
    arr = R1(2.4 + Math.max(0.4, d(CS.poseAt(v, 2.4).players.QB, CS.poseAt(v, arr).players.X) / 30));
  }
  const ends = (ev, by) => CS.variantOf(sm, { tag: ev, ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'X' }, { t: arr, ev, ...(by ? { by } : {}) }] });
  const bk = ends('breakup', 'CB-L'), pk = ends('pick', 'CB-L'), inc = ends('incomplete');
  check([bk, pk, inc].every((p) => CS.validatePlay(p).length === 0), `the three ends of a throw are legal plays (arrival ${arr} s) ${J([bk, pk, inc].map((p) => CS.validatePlay(p)))}`);
  const atThrow = CS.poseAt(bk, 2.4), Q = atThrow.players.QB;
  check(near(atThrow.ball.x, Q.x, 0.01) && near(atThrow.ball.y, Q.y, 0.01), `at the throw the ball is in the QB's hands (${atThrow.ball.x.toFixed(2)}, ${atThrow.ball.y.toFixed(2)} vs ${Q.x.toFixed(2)}, ${Q.y.toFixed(2)})`);
  const A = CS.poseAt(bk, arr), cb = A.players['CB-L'], x = A.players.X;
  check(d(A.ball, cb) <= 0.5 && d(cb, x) <= CS.CONTACT_YD, `breakup: at ${arr} s the ball is on the corner (${d(A.ball, cb).toFixed(3)} yd, max 0.5), who is ${d(cb, x).toFixed(2)} yd from X (max ${CS.CONTACT_YD})`);
  // Halfway through the flight the ball is halfway along the line from the QB to that contact point.
  const mid = CS.poseAt(bk, (2.4 + arr) / 2).ball;
  check(near(mid.x, (Q.x + A.ball.x) / 2, 0.05) && near(mid.y, (Q.y + A.ball.y) / 2, 0.05) && mid.air > 0, `breakup: halfway through the flight the ball is halfway to the contact point, in the air (${mid.x.toFixed(2)}, ${mid.y.toFixed(2)}, air ${mid.air.toFixed(2)})`);
  const after = CS.poseAt(bk, arr + 0.4).ball, later = CS.poseAt(bk, arr + 0.9).ball;
  check(near(d(after, A.ball), CS.DEFLECT, 0.05) && after.air <= 0.1 + 1e-9 && !after.held && !later.held && near(later.x, after.x, 1e-6) && near(later.y, after.y, 1e-6),
    `breakup: 0.4 s later it is on the grass (air ${after.air.toFixed(2)}, as an incomplete lies) ${d(after, A.ball).toFixed(2)} yd on (CS.DEFLECT ${CS.DEFLECT}), nobody holds it, and it stays there`);
  const P1 = CS.poseAt(pk, arr + 1);
  check(P1.ball.held === 'CB-L' && d(P1.ball, P1.players['CB-L']) <= 0.01 && d(P1.players['CB-L'], CS.poseAt(pk, arr).players['CB-L']) > 1,
    `pick: a second later the corner still has the ball (held by ${P1.ball.held}), and he has run with it (${d(P1.players['CB-L'], CS.poseAt(pk, arr).players['CB-L']).toFixed(2)} yd)`);
  const I = CS.poseAt(inc, arr).ball;
  check(d(I, CS.poseAt(inc, arr).players.X) <= 1 && I.air <= 0.1 + 1e-9 && !I.held && !CS.poseAt(inc, arr + 1).ball.held, `incomplete: it lands by X (${d(I, CS.poseAt(inc, arr).players.X).toFixed(2)} yd, air ${I.air}) and nobody has it`);
  // Refusals: a man not on him plays it; two ends; a sack in a play with a throw.
  const far = CS.variantOf(sm, { tag: 'far', ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'X' }, { t: arr, ev: 'breakup', by: 'FS' }] });
  const two = CS.variantOf(sm, { tag: 'two', ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'X' }, { t: arr, ev: 'breakup', by: 'CB-L' }, { t: arr + 0.1, ev: 'catch' }] });
  const sk = CS.variantOf(sm, { tag: 'sk', ball: [{ t: 0, ev: 'snap' }, { t: 2.4, ev: 'throw', to: 'X' }, { t: arr, ev: 'catch' }, { t: 1.5, ev: 'sack', by: 'DE-R' }] });
  check(CS.validatePlay(far).some((e) => /FS/.test(e)) && CS.validatePlay(two).length > 0 && CS.validatePlay(sk).length > 0,
    `refused: a breakup by the free safety, far off X; a throw that ends twice; a sack in a play with a throw ${J([CS.validatePlay(far)[0], CS.validatePlay(two)[0], CS.validatePlay(sk)[0]])}`);

  // ── a free rusher ── The fire zone (fz-nickel) against slant-flat: DE-R rushes C-gap-R and, with
  // then: 'QB', carries on to SACK_REACH in front of the QB's set spot (3-step from the gun: 2 yd back
  // at 4 yd/s, set at 0.5 s). Path length / his speed = when he gets there; the sack frame is the
  // first 0.02 s step within SACK_REACH + 0.05 of the QB, (length - 0.05) / v on the last leg, which
  // runs straight at the QB.
  const fz = L.PLAYS['pz-assign-fz-slant-flat'];
  if (fz) {
    const c0 = CS.compile(fz), de = c0.byId['DE-R'], qb = c0.byId.QB;
    const gp = [CS.gapX('C-gap-R') + c0.dX, -0.4], set = [qb.x, qb.y - 2], end = [set[0], set[1] + CS.SACK_REACH];
    const len = Math.hypot(gp[0] - de.x, gp[1] - de.y) + Math.hypot(end[0] - gp[0], end[1] - gp[1]), v = CS.SPEEDS[de.pos];
    const free = CS.variantOf(fz, { tag: 'free', assign: { 'DE-R': { then: 'QB' } }, ball: [{ t: 0, ev: 'snap' }], T: 4 });
    const at = CS.poseAt(free, len / v).players, before = CS.poseAt(free, len / v - 0.3).players;
    check(CS.validatePlay(free).length === 0 && near(at['DE-R'].x, end[0], 0.02) && near(at['DE-R'].y, end[1], 0.02) && near(d(at['DE-R'], at.QB), CS.SACK_REACH, 0.02) && d(before['DE-R'], before.QB) > CS.SACK_REACH + 0.5,
      `free rusher: DE-R reaches ${CS.SACK_REACH} yd in front of the QB at ${(len / v).toFixed(3)} s (by hand: ${len.toFixed(2)} yd at ${v} yd/s) and not before (${d(before['DE-R'], before.QB).toFixed(2)} yd 0.3 s earlier)`);
    let ts = null;
    for (let t = 0; t <= 4 && ts == null; t = Math.round((t + 0.02) * 100) / 100) { const P = CS.poseAt(free, t).players; if (d(P['DE-R'], P.QB) <= CS.SACK_REACH + 0.05) ts = t; }
    const sack = CS.variantOf(fz, { tag: 'sack', assign: { 'DE-R': { then: 'QB' } }, ball: [{ t: 0, ev: 'snap' }, { t: ts, ev: 'sack', by: 'DE-R' }] }), cs = CS.compile(sack);
    check(near(ts, (len - 0.05) / v, 0.03) && CS.validatePlay(sack).length === 0 && cs.sackT === ts && cs.sackBy === 'DE-R' && near(cs.T, ts + 1, 1e-9) && CS.poseAt(sack, ts + 0.5).ball.held === 'QB',
      `the sack frame is ${ts} s (by hand ${((len - 0.05) / v).toFixed(3)} s); the play ends a second later, the QB still holding the ball`);
    // A blocker on him: he no longer gets home, and keeping coming past a blocker is refused.
    const met = CS.variantOf(fz, { tag: 'met', assign: { RT: { pass: 'set', on: 'DE-R' }, 'DE-R': { then: 'QB' } }, ball: [{ t: 0, ev: 'snap' }], T: 4 });
    check(CS.validatePlay(met).some((e) => /keeps coming to the QB, but a blocker has him/.test(e)), `refused: a rusher who keeps coming while a blocker has him ${J(CS.validatePlay(met))}`);
    const notR = CS.variantOf(fz, { tag: 'nr', assign: { RT: { pass: 'set', on: 'WILL' } }, ball: [{ t: 0, ev: 'snap' }], T: 4 });
    check(CS.validatePlay(notR).some((e) => /WILL, who is not a rusher/.test(e)), `refused: a block on a man who drops ${J(CS.validatePlay(notR))}`);
  } else check(false, 'the fire-zone assign play is registered');

  // ── pass protection on a named man ── Slide left on four verticals, the back on DE-R in C-gap-R.
  // They meet the first 0.02 s step within CS.ENGAGE yd, worked out here from the two straight-line
  // paths (cs-core's own path data: the back from his spot to ENGAGE_SET behind the gap, the end from
  // his to the gap's point on the line), then both stand where they met.
  const fv = CS.variantOf(L.PLAYS['four-verts-vs-c3'], { tag: 'pp', assign: { RB: { block: 'C-gap-R', on: 'DE-R' } } }), cf = CS.compile(fv);
  const lin = (p, t) => { const P = p.path.pts, v = p.path.v, s = Math.max(0, t - (p.path.delay || 0)) * v; let acc = 0; for (let i = 1; i < P.length; i++) { const L2 = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (acc + L2 >= s) { const u = (s - acc) / L2; return { x: P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u, y: P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u }; } acc += L2; } const z = P[P.length - 1]; return { x: z[0], y: z[1] }; };
  const rb = cf.byId.RB, der = cf.byId['DE-R'];
  let tm = null;
  for (let t = cf.snapT; t <= cf.T && tm == null; t = Math.round((t + 0.02) * 1000) / 1000) if (d(lin(rb, t), lin(der, t)) <= CS.ENGAGE) tm = t;
  const Pm = CS.poseAt(fv, tm).players, Pl = CS.poseAt(fv, tm + 1.5).players;
  check(CS.validatePlay(fv).length === 0 && near(rb.held, tm, 1e-9) && near(der.held, tm, 1e-9) && d(Pm.RB, Pl.RB) < 1e-9 && d(Pm['DE-R'], Pl['DE-R']) < 1e-9 && near(rb.path.pts[1][1], -0.4 - CS.ENGAGE_SET, 1e-9),
    `pass pro: the back and DE-R meet at ${tm} s (by hand from their straight paths), ${d(Pm.RB, Pm['DE-R']).toFixed(2)} yd apart (max ${CS.ENGAGE}), and both hold there; the back steps up to ${-0.4 - CS.ENGAGE_SET} yd`);

  // ── the deep camera's window ── The ball's flight from the throw to where it arrives; past
  // DEEP_EDGE short of the window's far edge (CS.VIEW.Y1), the run's window runs DEEP_PAD past it.
  const pd = L.PLAYS['post-dig-vs-c4'], cp = CS.compile(pd), zc = CS.poseAt(pd, cp.catchT).players.Z;
  const w = CS.runWindow(pd);
  check(zc.y > CS.VIEW.Y1 - CS.DEEP_EDGE && w && near(w.y0, CS.VIEW.Y0, 1e-9) && near(w.y1, zc.y + CS.DEEP_PAD, 0.01),
    `runWindow: post-dig's post is caught ${zc.y.toFixed(2)} yd downfield (past ${(CS.VIEW.Y1 - CS.DEEP_EDGE).toFixed(2)}), so the run shows ${CS.VIEW.Y0} to ${zc.y.toFixed(2)} + ${CS.DEEP_PAD} yd ${J(w)}`);
  const sc = CS.poseAt(sm, CS.compile(sm).catchT).players.H;
  check(sc.y <= CS.VIEW.Y1 - CS.DEEP_EDGE && CS.runWindow(sm) === null, `runWindow: smash's corner is caught ${sc.y.toFixed(2)} yd downfield, inside the plain window: no deep camera`);
}

export async function browser(H) {
  const { check, open, settle, plate } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#demo' });
  // The deep run: post-dig vs Cover 4 throws the post 19.8 yd downfield, past the window's far edge
  // (CS.VIEW.Y1 = 19.57). Played, the camera eases to the run's window; at the catch the ball and Z
  // are on the screen, the zoom is a tidy twentieth under 1, the canvas stays portrait, and the
  // screen <-> yard mapping and the hit test still agree there.
  const r = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, CS = window.CS, play = CS.lib.PLAYS['post-dig-vs-c4'], c = CS.compile(play);
    F.setPlay(play); F.seek(F.PRE); F.start();
    await new Promise((res) => setTimeout(res, 900));
    F.pause(); C.seek(c.catchT);
    await new Promise((res) => setTimeout(res, 100));
    const cam = F.camera, run = F.runCamera, cr = F.canvas.getBoundingClientRect(), z = F.shown.players.Z, s = C.yardToScreen(z.x, z.y), back = C.screenToYard(s.x, s.y);
    const b = CS.poseAt(play, c.catchT).ball, bs = C.yardToScreen(b.x, b.y), sr = C.spriteRect('Z');
    const mid = sr ? C.hitTest((sr.left + sr.right) / 2, (sr.top + sr.bottom) / 2) : null;
    return { cam, run, cr: { l: cr.left, t: cr.top, r: cr.right, b: cr.bottom, w: cr.width, h: cr.height }, s, z, back, bs, mid, animating: F.camAnimating, world: F.world };
  });
  const inside = (p) => p.x >= r.cr.l && p.x <= r.cr.r && p.y >= r.cr.t && p.y <= r.cr.b;
  check(!r.animating && Math.abs(r.cam.z - r.run.z) < 1e-9 && Math.abs(r.cam.cx - r.run.cx) < 1e-6 && r.cam.z < 1 && Math.abs(r.cam.z * 20 - Math.round(r.cam.z * 20)) < 1e-9 && r.cam.z >= r.world.ZMIN,
    `deep run: the camera settles on the run's window, zoomed out to ${r.cam.z} (a twentieth, at least ${r.world.ZMIN}) ${J(r.cam)}`);
  // Hand check of the zoom: the window runs from Y0 (-9) to Z's catch + DEEP_PAD (2.5 yd), at PX
  // world px a yard, across the canvas's W world px: z = W / ((y1 - Y0) * PX), rounded down to a twentieth.
  const zHand = Math.floor((r.world.W / ((r.z.y + 2.5 - r.world.Y0) * r.world.PX)) * 20 + 1e-9) / 20;
  check(Math.abs(r.cam.z - zHand) < 1e-9, `deep run: the zoom is ${zHand} by hand (${(r.z.y + 2.5 - r.world.Y0).toFixed(2)} yd of field across ${r.world.W} px)`);
  check(inside(r.s) && inside(r.bs) && r.cr.h > r.cr.w, `deep run: at the catch Z (${r.s.x.toFixed(0)}, ${r.s.y.toFixed(0)}) and the ball (${r.bs.x.toFixed(0)}, ${r.bs.y.toFixed(0)}) are on the canvas (${r.cr.w.toFixed(0)} x ${r.cr.h.toFixed(0)}, portrait)`);
  check(Math.abs(r.back.x - r.z.x) < 0.01 && Math.abs(r.back.y - r.z.y) < 0.01 && r.mid === 'Z', `deep run: screen -> yard round trip holds at Z (${r.back.x.toFixed(3)}, ${r.back.y.toFixed(3)} vs ${r.z.x.toFixed(3)}, ${r.z.y.toFixed(3)}) and a tap on his sprite hits Z (${r.mid})`);
  await plate(page, 'deep-postdig-catch.png');
  // A go caught deep: slant-flat vs Cover 3 with Z on a go, thrown at 1.8 s and caught where he is
  // as the ball arrives (30 yd/s, iterated). Caught past the window's far edge, it is on the screen.
  const g = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, CS = window.CS, base = CS.variantOf(CS.lib.PLAYS['slant-flat-vs-c3'], { tag: 'go', assign: { Z: { route: 'go' } }, callouts: [] });
    let arr = 2.4;
    for (let k = 0; k < 6; k++) { const v = CS.variantOf(base, { tag: 'go', ball: [{ t: 0, ev: 'snap' }, { t: 1.8, ev: 'throw', to: 'Z' }, { t: arr, ev: 'catch' }] }); const q = CS.poseAt(v, 1.8).players.QB, z = CS.poseAt(v, arr).players.Z; arr = Math.ceil((1.8 + Math.max(0.4, Math.hypot(q.x - z.x, q.y - z.y) / 30)) * 10 - 1e-9) / 10; }
    const play = CS.variantOf(base, { tag: 'go', ball: [{ t: 0, ev: 'snap' }, { t: 1.8, ev: 'throw', to: 'Z' }, { t: arr, ev: 'catch' }] });
    F.setPlay(play); F.seek(F.PRE); F.start();
    await new Promise((res) => setTimeout(res, 900));
    F.pause(); C.seek(arr + 0.05);
    await new Promise((res) => setTimeout(res, 100));
    const z = CS.poseAt(play, arr).players.Z, s = C.yardToScreen(z.x, z.y), cr = F.canvas.getBoundingClientRect(), b = CS.poseAt(play, arr + 0.05).ball;
    return { legal: CS.validatePlay(play), arr, y: z.y, s, held: b.held, on: s.x >= cr.left && s.x <= cr.right && s.y >= cr.top && s.y <= cr.bottom, z: F.camera.z, deep: !!CS.runWindow(play) };
  });
  check(g.legal.length === 0 && g.deep && g.y > 19.57 && g.held === 'Z' && g.on && g.z < 1, `deep go: caught at ${g.arr} s, ${g.y.toFixed(1)} yd downfield (past the window's 19.6), Z on the screen with the ball (zoom ${g.z}) ${J(g.legal)}`);
  await plate(page, 'deep-go-catch.png');
  check(errors.length === 0, `engine events: zero page errors ${J(errors.slice(0, 3))}`);
  await page.close();
}
