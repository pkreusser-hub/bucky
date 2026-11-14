/**
 * The run game in the engine (cs-core.js, 2026-11-12): the handoff, the carrier's aim, a pulling
 * guard through his gap, a double team and its climb, the fullback's kick-out, the tackle that ends
 * the play, and the defensive features that came with it (a stunt's loop, Cover 0's man-or-rush,
 * a quarters safety's read of #2, trail technique). Every expected number is worked out here from
 * the play's own yards and the constants (CS.RUN, CS.SPEEDS, the fact sheet's line), never read back
 * from the function under test; the pose is what is checked.
 */
const J = JSON.stringify;

export async function node(H) {
  const { check, near, CS, L } = H;
  const R = CS.RUN, V = CS.SPEEDS;
  const P = (play, t) => CS.poseAt(play, t).players;
  const at = (play, id, t) => { const q = P(play, t)[id]; return [q.x, q.y]; };
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const close = (a, b, tol) => d(a, b) <= (tol == null ? 0.01 : tol);
  const f2 = (a) => `(${a[0].toFixed(2)}, ${a[1].toFixed(2)})`;
  // The line (fact sheet 1a): LT 23.67, LG 25.17, C 26.67, RG 28.17, RT 29.67; the TE at 31.17.
  // Gaps (8): B right = guard-tackle midpoint 28.92; C right with an inline TE = tackle-TE midpoint 30.42.
  const B_R = (28.17 + 29.67) / 2, C_R = (29.67 + 31.17) / 2, A_R = (26.67 + 28.17) / 2;

  // ── the handoff ── Inside zone (singleback): the back from (26.67, -6.5) runs at the B gap's point
  // 1.5 yd behind the line, (28.92, -1.5), at 6.5 yd/s. At the handoff (0.8 s) he is 0.8 x 6.5 = 5.2
  // yd along that 5.483 yd leg; the QB meets him RUN.MESH yd on his backside (to the left).
  const iz = L.PLAYS['run-inside-zone'];
  const L1 = Math.hypot(B_R - 26.67, -1.5 + 6.5), u = (0.8 * V.RB) / L1, H0 = [26.67 + (B_R - 26.67) * u, -6.5 + 5 * u];
  check(near(CS.gapsOf(CS.compile(iz))['B-gap-R'], B_R, 1e-9), `the B gap right is the guard-tackle midpoint, ${B_R}`);
  check(close(at(iz, 'RB', 0.8), H0) && close(at(iz, 'QB', 0.8), [H0[0] - R.MESH, H0[1]]),
    `handoff: at 0.8 s the back is at ${f2(H0)} and the QB ${R.MESH} yd beside him (${f2(at(iz, 'RB', 0.8))}, ${f2(at(iz, 'QB', 0.8))})`);
  const b1 = CS.poseAt(iz, 0.79).ball, b2 = CS.poseAt(iz, 0.81).ball;
  check(b1.held === 'QB' && b2.held === 'RB' && close([b2.x, b2.y], at(iz, 'RB', 0.81)), `handoff: the QB has the ball at 0.79 s, the back at 0.81 s, and it is on him (${b1.held} -> ${b2.held})`);
  // The carrier reaches his aim: the B gap's point on the line (y 0.5) 2 yd after the first leg.
  const tAim = L1 / V.RB + 2 / V.RB;
  check(close(at(iz, 'RB', tAim), [B_R, 0.5]), `carry: the back crosses the line in the B gap at ${tAim.toFixed(3)} s, ${f2([B_R, 0.5])} (${f2(at(iz, 'RB', tAim))})`);

  // ── the pull ── Power (I-form): the left guard drops to RUN.PULL_Y, runs along the line to the C
  // gap (tackle-TE midpoint, 30.42) and turns up it, at RUN.PULL_V. 1 yd + 5.25 yd = 6.25 yd: at the
  // hole at 6.25 / 6 = 1.0417 s; halfway along the line at (1 + 2.625) / 6.
  const pw = L.PLAYS['run-power'], pv = R.PULL_V, tv = (1 + (C_R - 25.17)) / pv, tm = (1 + (C_R - 25.17) / 2) / pv;
  check(close(at(pw, 'LG', tm), [(25.17 + C_R) / 2, R.PULL_Y]) && close(at(pw, 'LG', tv), [C_R, R.PULL_Y]) && at(pw, 'LG', tv + 0.1)[1] > R.PULL_Y + 0.5,
    `pull: the guard is halfway along the line at ${tm.toFixed(3)} s ${f2(at(pw, 'LG', tm))}, in the C gap at ${tv.toFixed(3)} s ${f2(at(pw, 'LG', tv))}, and turned up through it a tenth later`);
  // The back follows him: he reaches (30.42, -1.5) RUN.FOLLOW s after the guard gets to the hole. From
  // (26.67, -7) that leg is 6.657 yd at 6.5: he waits 1.0417 + 0.25 - 1.0241 = 0.2676 s.
  const pL = Math.hypot(C_R - 26.67, 5.5), wait = tv + R.FOLLOW - pL / V.RB;
  check(close(at(pw, 'RB', wait - 0.01), [26.67, -7]) && close(at(pw, 'RB', tv + R.FOLLOW), [C_R, -1.5]) && !close(at(pw, 'RB', wait + 0.1), [26.67, -7]),
    `pull: the back waits ${wait.toFixed(3)} s and reaches the hole ${R.FOLLOW} s behind the guard, at ${(tv + R.FOLLOW).toFixed(3)} s ${f2(at(pw, 'RB', tv + R.FOLLOW))}`);
  const cp = CS.compile(pw);
  check(cp.blockInfo.LG && cp.blockInfo.LG.target === 'MIKE' && cp.blockInfo.LG.te > tv && close(at(pw, 'LG', cp.blockInfo.LG.te), at(pw, 'MIKE', cp.blockInfo.LG.te), R.CONTACT + 0.01),
    `pull: through the hole he leads up on the linebacker (the Sam is the TE's): the Mike, met at ${cp.blockInfo.LG.te.toFixed(2)} s`);
  // Down blocks (7): RT's man is the 3 technique inside him (DT-R, 28.67); RG has nobody inside on
  // the line once the center has the 1 technique, so he goes to the backside linebacker.
  check(cp.blockInfo.RT.target === 'DT-R' && cp.blockInfo.C.target === 'DT-L' && cp.blockInfo.RG.target === 'WILL' && cp.blockInfo.LT.target === 'DE-L',
    `power: RT down on DT-R, C back on DT-L, RG (nobody inside) up to the Will, LT hinges on DE-L ${J(Object.fromEntries(Object.entries(cp.blockInfo).map(([k, v]) => [k, v.target])))}`);

  // ── the kick-out ── Power's fullback, from (26.67, -4.5) at 6.5 yd/s, on the EMOL (DE-R, the last
  // man on the line on the right once the TE has the Sam). Contact: a yard apart, the fullback inside
  // him, having run straight at full speed since the snap; then the end is driven out (+x), 1.2 yd/s
  // for a second along (1, 0.15): 1.2 / 1.0112 = 1.187 yd across.
  const k = cp.blockInfo.FB, te = k.te, fb = at(pw, 'FB', te), de = at(pw, 'DE-R', te);
  check(k.target === 'DE-R' && near(d(fb, de), R.CONTACT, 0.02) && fb[0] < de[0] && d([26.67, -4.5], fb) <= V.FB * te + 0.02 && d([26.67, -4.5], fb) >= V.FB * (te - 0.02) - 0.02,
    `kick-out: the fullback meets DE-R at ${te.toFixed(2)} s at ${f2(fb)}, a yard inside him ${f2(de)}, at full speed from his spot`);
  const dx = at(pw, 'DE-R', te + R.DRIVE_T)[0] - de[0];
  check(near(dx, R.VD * R.DRIVE_T / Math.hypot(1, 0.15), 0.01), `kick-out: he drives the end ${dx.toFixed(3)} yd out in ${R.DRIVE_T} s (by hand ${(R.VD / Math.hypot(1, 0.15)).toFixed(3)})`);

  // ── the double team and the climb ── Inside zone vs the 4-3 Over: the center is uncovered (nobody
  // on him or within his playside gap: DT-L is a backside shade at 26.17), the right guard covered
  // by DT-R (28.67, half a yard playside). So the center joins the guard on DT-R, they hold it
  // RUN.COMBO_T s, and the center climbs to the linebacker nearest DT-R: the Mike (27.67).
  const ci = CS.compile(iz), cb = ci.blockInfo.C, rg = ci.blockInfo.RG;
  // RG's contact by hand: RG at (28.17, 0) goes straight at him at 4 yd/s (a zone step); DT-R rushes
  // from his spot to the B gap's point 0.4 yd past the line at 4 yd/s. First 0.01 s with |RG - DT| - 1 <= 4t (RG's run).
  const dt0 = [ci.byId['DT-R'].x, ci.byId['DT-R'].y], dtG = [B_R, -0.4], dL = d(dt0, dtG);
  let teRG = null;
  for (let i = 0; i < 400 && teRG == null; i++) { const t = i / 100, w = Math.min(1, (V.DT * t) / dL), q = [dt0[0] + (dtG[0] - dt0[0]) * w, dt0[1] + (dtG[1] - dt0[1]) * w]; if (d([28.17, 0], q) - R.CONTACT <= V.G * t + 1e-9) teRG = t; }
  check(rg.target === 'DT-R' && near(rg.te, teRG, 0.011), `zone: the guard meets DT-R at ${rg.te} s (by hand ${teRG})`);
  check(cb.combo && cb.combo.on === 'DT-R' && cb.combo.with === 'RG' && cb.climbed === 'MIKE' && near(cb.combo.climbT - Math.max(cb.combo.join, rg.te), R.COMBO_T, 1e-6),
    `combo: the center doubles DT-R with the guard from ${cb.combo && cb.combo.join} s, climbs at ${cb.combo && cb.combo.climbT} s (${R.COMBO_T} s after both are on him) to the Mike`);
  const mid = (cb.combo.join + cb.combo.climbT) / 2, after = cb.te;
  check(d(at(iz, 'C', mid), at(iz, 'DT-R', mid)) <= R.CONTACT + 0.26 && d(at(iz, 'C', after), at(iz, 'MIKE', after)) <= R.CONTACT + 0.01 && d(at(iz, 'C', cb.combo.climbT), at(iz, 'MIKE', cb.combo.climbT)) > R.CONTACT + 0.5,
    `combo: halfway through the double he is on DT-R (${d(at(iz, 'C', mid), at(iz, 'DT-R', mid)).toFixed(2)} yd), and at ${after.toFixed(2)} s on the Mike, who was ${d(at(iz, 'C', cb.combo.climbT), at(iz, 'MIKE', cb.combo.climbT)).toFixed(1)} yd off when he left the double`);
  // Outside zone: the left guard is the uncovered one (the center has DT-L on his reach), so he is the
  // one who doubles and climbs.
  const co = CS.compile(L.PLAYS['run-outside-zone']).blockInfo;
  check(co.LG.combo && co.LG.combo.on === 'DT-L' && co.LG.combo.with === 'C' && co.C.target === 'DT-L', `outside zone: the left guard doubles DT-L with the center, then climbs ${J(co.LG.combo)}`);

  // ── the counter step ── Counter: the back's first step is RUN.JAB yd away (left) and 0.3 up,
  // before he goes right; his wait is timed off the guard who pulls to kick out.
  const ct = L.PLAYS['run-counter'], cc = CS.compile(ct), jabL = Math.hypot(R.JAB, 0.3), tvc = (1 + (30.42 - 25.17)) / pv;
  const jab = [26.67 - R.JAB, -6.5 + 0.3], wC = tvc + R.FOLLOW - (jabL + Math.hypot(30.42 - jab[0], -1.5 - jab[1])) / V.RB;
  check(close(at(ct, 'RB', wC + jabL / V.RB), jab) && cc.blockInfo.LG.target === 'DE-R' && cc.blockInfo.LT.target === 'MIKE' && at(ct, 'RB', wC + jabL / V.RB)[0] < 26.67,
    `counter: the back jabs left to ${f2(jab)} at ${(wC + jabL / V.RB).toFixed(3)} s, then follows; LG kicks out DE-R, LT leads on the Mike`);
  check(cc.blockInfo.LG.te < cc.downT && d(at(ct, 'LG', cc.blockInfo.LG.te), at(ct, 'DE-R', cc.blockInfo.LG.te)) <= R.CONTACT + 0.01, `counter: the kick-out lands (${cc.blockInfo.LG.te.toFixed(2)} s) before the tackle (${cc.downT} s)`);

  // ── the trap ── DT-R is nobody's at the snap (both men next to him release); the guard pulls and
  // meets him from the inside.
  const tp = L.PLAYS['run-trap'], ctp = CS.compile(tp), tr = ctp.blockInfo.LG;
  check(tr.target === 'DT-R' && ctp.blockInfo.RG.target !== 'DT-R' && ctp.blockInfo.RT.target !== 'DT-R' && at(tp, 'LG', tr.te)[0] < at(tp, 'DT-R', tr.te)[0],
    `trap: RG and RT release (${ctp.blockInfo.RG.target}, ${ctp.blockInfo.RT.target}), the guard traps DT-R from the inside at ${tr.te.toFixed(2)} s`);

  // ── the draw ── The line steers; the back meets the QB at his set spot (3-step drop from the gun:
  // 2 yd back, at (26.67, -7)) RUN.MESH yd to the right, at the handoff (1.4 s).
  const dw = L.PLAYS['run-draw'], cdw = CS.compile(dw);
  check(cdw.draw && close(at(dw, 'RB', 1.4), [26.67 + R.MESH, -7]) && close(at(dw, 'QB', 1.4), [26.67, -7]) && CS.poseAt(dw, 1.45).ball.held === 'RB',
    `draw: the back takes it beside the set QB at 1.4 s ${f2(at(dw, 'RB', 1.4))}`);
  check(['LT', 'LG', 'RG', 'RT'].every((id) => cdw.blockInfo[id].token === 'steer' && cdw.blockInfo[id].target) && isFinite(cdw.lane), `draw: the tackles and guards each steer a rusher; the lane is at x ${(+cdw.lane).toFixed(2)}`);

  // ── the tackle ends the play ── On every run: the first free man to the carrier is RUN.TACKLE yd
  // from him at downT; nobody blocked him before that; the carrier stays down where he went down; the
  // play runs RUN.END s on. And the right blocking gains yards: each run is tackled past the line.
  for (const p of Object.values(L.PLAYS).filter((q) => q.scheme)) {
    const c = CS.compile(p), T = c.downT, tk = c.tackleBy, car = c.carrier;
    const ok = tk && near(d(at(p, tk, T), at(p, car, T)), R.TACKLE, 0.02) && !(c.byId[tk].engaged <= T) && close(at(p, car, T + 0.5), at(p, car, T), 1e-9) && near(c.T, T + R.END, 1e-9) && c.tackleAt[1] > 0;
    const earlier = c.def.filter((q) => q.id !== tk && !(q.engaged <= T) && q.tau < T - 1e-9);
    check(ok && !earlier.length, `${p.id}: ${tk} tackles at ${T} s, ${c.tackleAt[1].toFixed(2)} yd past the line; the carrier stays down; nobody free got there first ${J(earlier.map((q) => q.id))}`);
  }

  // ── the stunt's loop ── T-E twist: the end waits 0.35 s, loops 1 yd deeper (CS.LOOP_DEPTH) to
  // halfway between his spot (23.17, 1) and the B gap left's point (24.42, -0.4), then into it, at 4.
  const st = L.PLAYS['stunt-te-twist'], lp = [(23.17 + 24.42) / 2, 1 + CS.LOOP_DEPTH], tL = 0.35 + Math.hypot(lp[0] - 23.17, lp[1] - 1) / V.DE;
  check(close(at(st, 'DE-L', 0.34), [23.17, 1]) && close(at(st, 'DE-L', tL), lp) && at(st, 'DT-L', 0.34)[0] < 26.17 - 0.3,
    `stunt: the tackle crashes at the snap (${f2(at(st, 'DT-L', 0.34))} at 0.34 s) while the end waits, then loops through ${f2(lp)} at ${tL.toFixed(3)} s`);
  for (const id of ['stunt-te-twist', 'stunt-et-twist']) {
    const p = L.PLAYS[id], c = CS.compile(p);
    let near2 = Infinity;
    for (let t = 0; t <= c.T; t += 0.05) { const q = P(p, t); for (const r of ['DE-L', 'DT-L']) near2 = Math.min(near2, Math.hypot(q[r].x - q.QB.x, q[r].y - q.QB.y)); }
    check(c.byId.LT.held != null && c.byId.LG.held != null && near2 > CS.SACK_REACH + 0.5, `${id}: LT and LG each meet the man coming to them (${c.byId.LT.held}, ${c.byId.LG.held} s) and neither gets near the QB (closest ${near2.toFixed(2)} yd)`);
  }

  // ── man or rush (Cover 0's Mike, 5a "man RB (rushes if RB blocks)") ── Smash vs Cover 0: with
  // the back blocking the Mike rushes his lane; with the back on a route he covers him.
  const sm = L.PLAYS['smash-vs-c2'];
  const blk = CS.variantOf(sm, { tag: 'c0b', defense: 'c0-nickel', callouts: [], ball: [{ t: 0, ev: 'snap' }], T: 3 });
  const rte = CS.variantOf(sm, { tag: 'c0r', defense: 'c0-nickel', callouts: [], ball: [{ t: 0, ev: 'snap' }], T: 3, assign: { RB: { route: 'flat', side: 'R' } } });
  const mb = CS.compile(blk).byId.MIKE, mr = CS.compile(rte).byId.MIKE, lane = L.DEFENSES['c0-nickel'].players.find((q) => q.id === 'MIKE').ifBlocks.rush;
  check(mb.role === 'rush' && near(mb.rushGx, CS.gapX(lane), 1e-9) && mr.role === 'man' && mr.manOf === 'RB', `man-or-rush: the back blocks -> the Mike rushes ${lane}; the back runs a flat -> the Mike has him (${mb.role}, ${mr.role})`);

  // ── the read of #2 (Cover 4) ── Post-dig vs Cover 4: the free safety reads H. H's hitch breaks
  // short: he drives, ending CS.DRIVE yd above H as H was 0.2 s before. H on a go: he carries,
  // CS.CARRY yd over the top. (No throw: the ball would send him after it.)
  const pd = L.PLAYS['post-dig-vs-c4'];
  const hitch = CS.variantOf(pd, { tag: 'rd', callouts: [], ball: [{ t: 0, ev: 'snap' }], T: 4 }), go = CS.variantOf(hitch, { tag: 'rg', assign: { H: { route: 'go' } } });
  const fsH = at(hitch, 'FS', 3.5), hH = at(hitch, 'H', 3.3), fsG = at(go, 'FS', 3.5), hG = at(go, 'H', 3.3);
  check(CS.compile(hitch).byId.FS.readKind === 'drive' && CS.compile(go).byId.FS.readKind === 'carry' && close(fsH, [hH[0], hH[1] + CS.DRIVE], 0.02) && close(fsG, [hG[0], hG[1] + CS.CARRY], 0.02),
    `zone read: on the hitch the safety drives to ${f2(fsH)} (H ${f2(hH)} + ${CS.DRIVE}); on the go he carries to ${f2(fsG)} (H ${f2(hG)} + ${CS.CARRY})`);

  // ── trail technique (2-man) ── The corner sits CS.TRAIL yd behind X and half a yard inside him.
  const tl = CS.variantOf(sm, { tag: 'tr', defense: 'c2m-nickel', callouts: [], ball: [{ t: 0, ev: 'snap' }], T: 3 });
  const cbL = at(tl, 'CB-L', 2.0), xL = at(tl, 'X', 1.8);
  check(close(cbL, [xL[0] + 0.5, xL[1] - CS.TRAIL], 0.02), `trail: at 2 s the corner is at ${f2(cbL)}, a yard under and half a yard inside X as he was 0.2 s before ${f2(xL)}`);

  // ── every library play poses without NaN, pure in t ──
  const bad = [];
  for (const p of Object.values(L.PLAYS)) {
    const T = CS.playLength(p);
    for (let t = -1.2; t <= T + 1e-9; t += 0.02) { const s = CS.poseAt(p, t); for (const [id, q] of Object.entries(s.players)) if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) { bad.push(`${p.id} ${id} @${t.toFixed(2)}`); break; } if (!Number.isFinite(s.ball.x) || !Number.isFinite(s.ball.y)) bad.push(`${p.id} ball @${t.toFixed(2)}`); }
  }
  check(bad.length === 0, `every library play (${Object.keys(L.PLAYS).length}) poses from -1.2 s to its end with no NaN ${bad.slice(0, 3).join(' | ')}`);
  const a1 = J(CS.poseAt(pw, 1.7)); CS.poseAt(pw, 0.3); CS.poseAt(pw, 2.5);
  check(J(CS.poseAt(pw, 1.7)) === a1, 'a run pose is pure in t (the same frame, asked again after others)');
  check(Object.values(L.PLAYS).filter((q) => q.scheme || q.stunt).every((q) => CS.validatePlay(q).length === 0), 'every run and stunt play validates');
  // Refusals: a carrier aimed at no gap on a non-draw, a follow of a man who does not pull, a mirrored run.
  const e1 = CS.validatePlay(CS.variantOf(pw, { tag: 'x1', assign: { RB: { carry: { aim: 'Z-gap' } } } }));
  const e2 = CS.validatePlay(CS.variantOf(pw, { tag: 'x2', assign: { RB: { carry: { aim: 'C-gap-R', follow: 'RG' } } } }));
  const e3 = CS.validatePlay(CS.variantOf(pw, { tag: 'x3', mirror: true }));
  check(e1.some((e) => /aims at/.test(e)) && e2.some((e) => /does not pull/.test(e)) && e3.some((e) => /mirror/.test(e)), `refused: an unknown aim, following a man who does not pull, a mirrored run ${J([e1[0], e2[0], e3[0]])}`);
}

export async function browser(H) {
  const { check, open } = H;
  const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#demo' });
  // Each run on the field: set, played to just after the tackle, the carrier on the canvas holding the ball.
  const r = await page.evaluate(async () => {
    const C = window.__CS__, F = C.field, CS = window.CS, out = [];
    for (const p of Object.values(CS.lib.PLAYS).filter((q) => q.scheme || q.stunt)) {
      const c = CS.compile(p);
      F.setPlay(p); F.seek(F.PRE); F.start();
      await new Promise((res) => setTimeout(res, 120));
      const t = c.run ? c.downT + 0.4 : 1.2;
      F.pause(); C.seek(t);
      await new Promise((res) => setTimeout(res, 60));
      const id = c.run ? c.carrier : 'QB', q = F.shown.players[id], s = C.yardToScreen(q.x, q.y), cr = F.canvas.getBoundingClientRect();
      out.push({ id: p.id, held: F.shown.ball.held, who: id, on: s.x >= cr.left && s.x <= cr.right && s.y >= cr.top && s.y <= cr.bottom });
    }
    return out;
  });
  check(r.length === 8 && r.every((x) => x.on && x.held === x.who), `run and stunt plays on the field: the ball carrier on the canvas with the ball after the tackle ${JSON.stringify(r.filter((x) => !(x.on && x.held === x.who)))}`);
  check(errors.length === 0, `run engine on the field: zero page errors ${JSON.stringify(errors.slice(0, 3))}`);
  await page.close();
}
