/**
 * The field's interaction hooks for puzzle types (cs-field.js, docs/coachschool-puzzle-types.md):
 * overlays (paths, connectors, gap letters), drag sessions with landmark snapping, freeze at the
 * snap, and the pure yard helpers behind them (cs-core.js). Geometry is asserted against numbers
 * worked out here by hand or through the field's own yardToScreen / spriteRect, never pixels.
 */

export async function node(H) {
  const { check, near, CS, L } = H;
  // Gaps by hand. The fact sheet's line (1a): tackles at the ball -+3, guards -+1.5, the inline TE
  // at +4.5. r1-los is the I-formation with Y inline on the right and no TE on the left, ball in
  // the middle (26.67). Fact sheet 8: A = C|G midpoint, B = G|T, C = T|TE (or half a split, 0.75,
  // outside the tackle), D = outside the TE (or 1.5 splits outside the tackle).
  //   left : A 26.67-0.75 = 25.92, B 26.67-2.25 = 24.42, C 23.67-0.75 = 22.92, D 23.67-2.25 = 21.42
  //   right: A 27.42, B 28.92, C (29.67+31.17)/2 = 30.42, D 31.17+0.75 = 31.92
  const los = L.PLAYS['r1-los'], g = CS.gapsOf(CS.compile(los));
  const HAND = { 'A-gap-L': 25.92, 'B-gap-L': 24.42, 'C-gap-L': 22.92, 'D-gap-L': 21.42, 'A-gap-R': 27.42, 'B-gap-R': 28.92, 'C-gap-R': 30.42, 'D-gap-R': 31.92 };
  check(Object.keys(HAND).every((k) => near(g[k], HAND[k], 1e-9)) && Object.keys(g).length === 8, `CS.gapsOf on the I-formation is the fact sheet's eight gaps by hand ${JSON.stringify(g)}`);
  check(Object.keys(HAND).every((k) => near(g[k], CS.gapX(k), 1e-9)), 'on the fact-sheet line the gaps are CS.GAPS exactly (CS.gapX)');
  // Ball on the left hash: the line and its gaps slide 26.67 - 23.58 = 3.09 yd left together.
  const hashL = CS.variantOf(los, { tag: 'hashL', hash: 'L' }), gh = CS.gapsOf(CS.compile(hashL));
  check(Object.keys(HAND).every((k) => near(gh[k], HAND[k] - 3.09, 1e-9)), `on the left hash every gap moves 3.09 yd with the line ${JSON.stringify(gh)}`);
  // snapTo: nearest landmark within the tolerance (inclusive), null outside.
  const LM = [{ x: 10, y: -5, name: 'a' }, { x: 12, y: -5, name: 'b' }];
  const s1 = CS.snapTo({ x: 10.6, y: -5 }, LM, 1), s2 = CS.snapTo({ x: 11.2, y: -5 }, LM, 1), s3 = CS.snapTo({ x: 10, y: -3.5 }, LM, 1), s4 = CS.snapTo({ x: 10, y: -6 }, LM, 1);
  check(s1.name === 'a' && near(s1.d, 0.6) && s2.name === 'b' && s3 === null && s4 && s4.name === 'a' && s4.d === 1, `snapTo: nearest within 1 yd, inclusive at exactly 1, null at 1.5 ${JSON.stringify([s1, s2, s3, s4])}`);
  // routeWaypoints: X in the 2x2 lines up at (6, 0) on the offense's left, so "in" is +x. Dig: [0, 12]
  // first, so (6, 12); every point is CS.routePoints from his alignment.
  const sm = L.PLAYS['smash-vs-c2'], wp = CS.routeWaypoints(sm, 'X', 'dig');
  check(wp[0][0] === 6 && wp[0][1] === 0 && wp[1][0] === 6 && wp[1][1] === 12 && JSON.stringify(wp) === JSON.stringify(CS.routePoints(L.ROUTES.dig, [6, 0], 'L')), `routeWaypoints: X's dig starts (6, 0), stems to (6, 12) ${JSON.stringify(wp)}`);
  const wpm = CS.routeWaypoints(CS.variantOf(sm, { tag: 'm', mirror: true }), 'X', 'slant');
  check(wpm[2][0] < wpm[1][0], `routeWaypoints: a mirrored X's slant breaks the other way, toward smaller x ${JSON.stringify(wpm)}`);
  // variantOf: a new play object, the id suffixed, one man's assignment replaced, the rest kept, the original untouched.
  const before = JSON.stringify(sm), v = CS.variantOf(sm, { tag: 'wrong', assign: { X: { route: 'slant' } } });
  check(v !== sm && v.id === 'smash-vs-c2~wrong' && v.assign.X.route === 'slant' && JSON.stringify(v.assign.H) === JSON.stringify(sm.assign.H) && JSON.stringify(sm) === before && CS.validatePlay(v).length === 0, 'variantOf: a new, legal play; X re-assigned, everyone else as he was, the original untouched');
}

export async function browser(H) {
  const { check, open, settle, plate } = H;
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
  for (const reduced of [false, true]) {
    const tag = reduced ? ' (reduced motion)' : '';
    const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { hash: '#demo', reduced });
    await page.evaluate(() => { const F = window.__CS__.field; F.setPlay(window.CS.lib.PLAYS['r1-los']); F.seek(F.PRE); });

    if (!reduced) {
      // Paths: the waypoints land on yardToScreen of the waypoints, zoomed out and zoomed in.
      const p = await page.evaluate(() => {
        const C = window.__CS__, F = C.field, CS = window.CS, out = {};
        const pts = [[10, -2], [14, 6], [20, 9.5]];
        const h = F.overlay.path({ pts });
        const meas = () => { const o = F.overlays.paths[0]; return { got: o.pts, want: pts.map((q) => C.yardToScreen(q[0], q[1])), z: C.camera.z }; };
        out.full = meas();
        F.zoomTo(['ol'], { instant: true }); out.zoom = meas();
        h.remove(); out.gone = F.overlays.paths.length;
        // Anchored to Y: it rides with his drawn spot (the neutral zone spread) before the snap and
        // is the plain yards once the spread is gone (t >= 0.5).
        F.zoomTo(null, { instant: true });
        const wp = CS.routeWaypoints(C.play, 'Y', 'curl');
        const a = F.overlay.path({ pts: wp, anchor: 'Y' });
        const sh = () => { const s = F.shown.players.Y, q = CS.poseAt(C.play, C.t).players.Y; return { dx: s.x - q.x, dy: s.y - q.y }; };
        const d0 = sh(); out.anchorPre = { got: F.overlays.paths[0].pts, want: wp.map((q) => C.yardToScreen(q[0] + d0.dx, q[1] + d0.dy)), shift: d0 };
        C.seek(0.6); out.anchorPost = { got: F.overlays.paths[0].pts, want: wp.map((q) => C.yardToScreen(q[0], q[1])) };
        C.seek(F.PRE);
        a.remove();
        return out;
      });
      const same = (m) => m.got.length === m.want.length && m.got.every((q, i) => near(q.x, m.want[i].x) && near(q.y, m.want[i].y));
      check(same(p.full) && same(p.zoom) && p.zoom.z > 1.2, `path overlay: every waypoint lands on yardToScreen(waypoint), zoom 1 and zoom ${p.zoom.z.toFixed(2)}`);
      check(p.gone === 0, 'a removed path is gone from the frame');
      check(same(p.anchorPre) && Math.abs(p.anchorPre.shift.dy) > 0.5 && same(p.anchorPost), `an anchored path rides with Y's drawn spot before the snap (shifted ${p.anchorPre.shift.dy.toFixed(2)} yd) and sits on the yards after the spread is gone`);

      // Connectors end on sprite centres (the painted box's centre), and on a gap at the line.
      const k = await page.evaluate(() => {
        const C = window.__CS__, F = C.field, out = [];
        const links = [F.overlay.link({ from: 'LT', to: 'B-gap-L' }), F.overlay.link({ from: 'C', to: 'MIKE' }), F.overlay.link({ from: 'RT', to: { x: 33, y: 2 } })];
        const g = F.gapsOf();
        for (const z of [null, ['ol']]) {
          F.zoomTo(z, { instant: true });
          const cen = (id) => { const r = C.spriteRect(id); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; };
          const L = F.overlays.links;
          out.push({ z: C.camera.z, n: L.length, lt: [L[0].a, cen('LT')], gap: { end: L[0].b, ground: C.yardToScreen(g['B-gap-L'], 0), lt: cen('LT'), lg: cen('LG') }, c: [L[1].a, cen('C')], mike: [L[1].b, cen('MIKE')], rt: [L[2].a, cen('RT')], pt: [L[2].b, C.yardToScreen(33, 2)] });
        }
        links.forEach((h) => h.remove());
        return out;
      });
      const on = (pair) => near(pair[0].x, pair[1].x) && near(pair[0].y, pair[1].y);
      // A gap end: along the field on the line of scrimmage exactly; across it, between the two men
      // who make the gap (LT and LG for the B gap), as its letter is drawn (cs-field gapLift).
      const gapOk = (q) => near(q.end.x, q.ground.x) && q.end.y > q.lt.y && q.end.y < q.lg.y;
      for (const f of k) check(f.n === 3 && on(f.lt) && on(f.c) && on(f.mike) && on(f.rt) && gapOk(f.gap) && on(f.pt), `connectors at zoom ${f.z.toFixed(2)}: player ends on their sprite centres, the B-gap end on the line of scrimmage between LT and LG, the point end on its yards ${JSON.stringify(f).slice(0, 200)}`);

      // Gap labels: eight letters, each at the fact-sheet x on the line of scrimmage, on the hash too.
      // The expected yards are the hand numbers above (node part), not the field's own gapsOf; each
      // label's client point must be yardToScreen of those yards on the line of scrimmage.
      const HAND = { 'A-gap-L': 25.92, 'B-gap-L': 24.42, 'C-gap-L': 22.92, 'D-gap-L': 21.42, 'A-gap-R': 27.42, 'B-gap-R': 28.92, 'C-gap-R': 30.42, 'D-gap-R': 31.92 };
      const gl = await page.evaluate((HAND) => {
        const C = window.__CS__, F = C.field, CS = window.CS, out = {};
        const cen = (id) => { const r = C.spriteRect(id); return r ? (r.top + r.bottom) / 2 : null; };
        // The two men each gap lies between (fact sheet 8); C and D on the left have one only (no TE there).
        const NB = { 'A-gap-L': ['LG', 'C'], 'B-gap-L': ['LT', 'LG'], 'A-gap-R': ['C', 'RG'], 'B-gap-R': ['RG', 'RT'], 'C-gap-R': ['RT', 'Y'] };
        const read = (dx) => F.overlays.gaps.map((q) => ({ name: q.name, letter: q.letter, yd: q.yd, at: { x: q.x, y: q.y }, ground: q.ground, want: C.yardToScreen(HAND[q.name] + dx, 0), between: NB[q.name] ? NB[q.name].map(cen) : null }));
        F.zoomTo(null, { instant: true });
        const h = F.overlay.gaps();
        out.mid = read(0);
        F.zoomTo(['ol'], { instant: true }); out.zoom = read(0); out.z = C.camera.z;
        F.zoomTo(null, { instant: true });
        F.setPlay(CS.variantOf(CS.lib.PLAYS['r1-los'], { tag: 'hashL', hash: 'L' }));
        out.hash = read(-3.09);
        const one = F.overlay.gaps({ side: 'R' });
        h.remove(); out.rightOnly = F.overlays.gaps.map((q) => q.name);
        one.remove(); out.none = F.overlays.gaps.length;
        F.setPlay(CS.lib.PLAYS['r1-los']);
        return out;
      }, HAND);
      const okList = (list, dx) => list.length === 8 && new Set(list.map((q) => q.name)).size === 8 && list.every((q) => near(q.yd, HAND[q.name] + dx, 1e-9) && q.letter === q.name[0] && near(q.ground.x, q.want.x) && near(q.ground.y, q.want.y) && near(q.at.x, q.want.x) && q.at.y < q.want.y && (!q.between || (q.at.y > q.between[0] && q.at.y < q.between[1])));
      check(okList(gl.mid, 0) && okList(gl.zoom, 0) && gl.z > 1.2, `gap labels: A-D each side at the fact sheet's x (A 25.92 ... D 31.92), on the line of scrimmage, each letter between the two men who make its gap, zoom 1 and ${gl.z.toFixed(2)} ${JSON.stringify(gl.mid.map((q) => q.name + '@' + q.yd))}`);
      check(okList(gl.hash, -3.09), 'gap labels on the left hash: every letter 3.09 yd left with the line');
      check(gl.rightOnly.length === 4 && gl.rightOnly.every((n) => /-R$/.test(n)) && gl.none === 0, `side: 'R' shows the four right-side letters; removing both handles clears them ${JSON.stringify(gl.rightOnly)}`);
      await page.evaluate(() => { window.__CS__.field.overlay.gaps(); window.__CS__.field.overlay.link({ from: 'LT', to: 'B-gap-L', tone: 'focus' }); window.__CS__.field.overlay.link({ from: 'LG', to: 'A-gap-L', tone: 'focus' }); window.__CS__.field.overlay.link({ from: 'C', to: 'A-gap-R', tone: 'focus' }); window.__CS__.field.overlay.link({ from: 'RT', to: 'C-gap-R', tone: 'bad', dashed: true }); window.__CS__.field.zoomTo(['ol', 'dl'], { instant: true }); });
      await settle(page, 60);
      await plate(page, 'hooks-connectors-gaps.png');
      await page.evaluate(() => { const F = window.__CS__.field; F.overlay.clear(); F.zoomTo(null, { instant: true }); });
    }

    // Drag: a real pointer drags RB toward a landmark while zoomed in; within 1 yd it snaps to the
    // landmark's yards exactly; 3 yd off it lands where the pointer put it. The press is the drag's,
    // not a tap. Tap-select then tap-place does the same with no drag.
    await page.evaluate(() => {
      const F = window.__CS__.field;
      window.__dropped = []; window.__taps0 = document.getElementById('readout').textContent;
      window.__lis0 = { touch: F.canvas.style.touchAction };
      F.zoomTo(['backs'], { instant: true });
      const LM = [{ x: 22, y: -6, name: 'offset-L' }, { x: 26.67, y: -4.5, name: 'fb' }];
      window.__drag = F.drag({ handles: [{ key: 'rb', id: 'RB' }], snap: (pos) => window.CS.snapTo(pos, LM, 1), onDrop: (k, pos, sn) => window.__dropped.push({ k, pos, sn: sn && sn.name }) });
    });
    const d0 = await page.evaluate(() => { const C = window.__CS__, F = C.field, h = F.drags[0].handles[0]; return { h, z: C.camera.z, start: C.yardToScreen(h.x, h.y), lm: C.yardToScreen(22.4, -6.3), far: C.yardToScreen(22 + 3, -6 - 2), touch: F.canvas.style.touchAction }; });
    check(d0.z > 1.2 && d0.h.r === 22 && near(d0.h.rWorld * d0.z * (await page.evaluate(() => { const c = window.__CS__.field.canvas; return c.getBoundingClientRect().width / window.__CS__.field.world.W; })), 22, 1e-9), `drag handle: 44 px across under the finger at zoom ${d0.z.toFixed(2)}`);
    check(d0.touch === 'none', 'while a drag session is up the canvas takes the touch (touch-action none)');
    // Press on the handle's centre, move by the screen distance of (landmark + 0.5 yd) - his spot.
    const drive = async (from, to, steps = 8) => {
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y - from.y) * i / steps);
      await page.mouse.up(); await settle(page, 30);
    };
    const target = { x: d0.h.cx + (d0.lm.x - d0.start.x), y: d0.h.cy + (d0.lm.y - d0.start.y) };
    await drive({ x: d0.h.cx, y: d0.h.cy }, target);
    const r1 = await page.evaluate(() => ({ pos: window.__drag.positions.rb, moved: window.__CS__.field.moved.RB, dropped: window.__dropped.slice(), readout: document.getElementById('readout').textContent, taps0: window.__taps0, shown: window.__CS__.field.shown.players.RB, spread: window.__CS__.field.spread.RB }));
    check(r1.pos.x === 22 && r1.pos.y === -6 && r1.moved.x === 22 && r1.moved.y === -6 && r1.dropped.length === 1 && r1.dropped[0].sn === 'offset-L', `drag while zoomed: 0.5 yd from the landmark snaps to its yards exactly (22, -6) ${JSON.stringify(r1.pos)}`);
    check(near(r1.shown.x, 22 + r1.spread.dx, 1e-9) && near(r1.shown.y, -6 + r1.spread.dy, 1e-9), 'the moved man is drawn on his new yards plus his share of the spread, like everyone else');
    check(r1.readout === r1.taps0, 'the press that started the drag was not also a tap on a player');
    // Now 3 yd clear of every landmark: no snap; he lands at start + the pointer's travel in yards.
    const d1 = await page.evaluate(() => { const C = window.__CS__, h = C.field.drags[0].handles[0]; return { h, start: C.yardToScreen(h.x, h.y), far: C.yardToScreen(h.x + 3, h.y + 1.5) }; });
    const t2 = { x: d1.h.cx + (d1.far.x - d1.start.x), y: d1.h.cy + (d1.far.y - d1.start.y) };
    await drive({ x: d1.h.cx, y: d1.h.cy }, t2);
    const r2 = await page.evaluate((a, b) => { const C = window.__CS__, A = C.screenToYard(a.x, a.y), B = C.screenToYard(b.x, b.y); return { pos: window.__drag.positions.rb, want: { x: 22 + B.x - A.x, y: -6 + B.y - A.y }, last: window.__dropped[window.__dropped.length - 1] }; }, { x: d1.h.cx, y: d1.h.cy }, t2);
    check(near(r2.pos.x, r2.want.x) && near(r2.pos.y, r2.want.y) && r2.last.sn === null, `no landmark within 1 yd: he lands where the pointer took him (${r2.pos.x.toFixed(3)}, ${r2.pos.y.toFixed(3)})`);
    // Tap-select, then tap the field near the FB landmark: placed there, snapped.
    const d2 = await page.evaluate(() => { const C = window.__CS__, h = C.field.drags[0].handles[0]; return { h, fb: C.yardToScreen(26.67 + 0.3, -4.5 - 0.4) }; });
    await page.mouse.click(d2.h.cx, d2.h.cy); await settle(page, 30);
    const sel = await page.evaluate(() => window.__drag.selected);
    await page.mouse.click(d2.fb.x, d2.fb.y); await settle(page, 30);
    const r3 = await page.evaluate(() => ({ pos: window.__drag.positions.rb, sel: window.__drag.selected, last: window.__dropped[window.__dropped.length - 1], readout: document.getElementById('readout').textContent, taps0: window.__taps0 }));
    check(sel === 'rb' && r3.sel === null && r3.pos.x === 26.67 && r3.pos.y === -4.5 && r3.last.sn === 'fb' && r3.readout === r3.taps0, `tap the handle, tap the field: placed and snapped to (26.67, -4.5), no player tap sent ${JSON.stringify(r3.pos)}`);
    if (!reduced) {
      await page.evaluate(() => window.__drag.set('rb', { x: 23.2, y: -5.5 }));
      await page.evaluate(() => { const F = window.__CS__.field; window.__drag2 = F.drag({ handles: [{ key: 'm1', x: 31, y: -6, label: 'S' }], moves: false }); window.__CS__.field.overlay.path({ pts: window.CS.routeWaypoints(window.__CS__.play, 'Y', 'curl'), anchor: 'Y', tone: 'focus' }); F.zoomTo(['backs', 'Y'], { instant: true }); });
      await settle(page, 60);
      await plate(page, 'hooks-drag-handle-path.png');
      await page.evaluate(() => { window.__drag2.destroy(); window.__CS__.field.overlay.clear(); });
    }
    await page.evaluate(() => window.__drag.destroy());
    const end = await page.evaluate(() => { const F = window.__CS__.field; return { drags: F.drags.length, moved: Object.keys(F.moved).length, touch: F.canvas.style.touchAction, tap: (() => { const C = window.__CS__, q = F.shown.players.QB, s = C.yardToScreen(q.x, q.y); return C.hitTest(s.x, s.y); })() }; });
    check(end.drags === 0 && end.moved === 0 && end.touch === '', `drag destroy(): no session, nobody moved, touch-action given back ${JSON.stringify(end)}`);

    // Freeze at the snap: play from the pre-snap picture and stop on t = 0 exactly; playTo(t) likewise.
    const fz = await page.evaluate(async () => {
      const C = window.__CS__, F = C.field, CS = window.CS, out = { calls: [] };
      F.zoomTo(null, { instant: true });
      F.setPlay(CS.lib.PLAYS['smash-vs-c2']); F.seek(F.PRE);
      await new Promise((res) => F.freezeAtSnap((t) => { out.calls.push(t); res(); }));
      await new Promise((r) => setTimeout(r, 200));
      out.t = C.t; out.playing = C.playing; out.isZero = Object.is(C.t, 0) && C.t === CS.compile(C.play).snapT;
      await new Promise((res) => F.playTo(1.234, (t) => { out.calls.push(t); res(); }));
      await new Promise((r) => setTimeout(r, 120));
      out.t2 = C.t; out.playing2 = C.playing;
      // A pause (or seek, or setPlay) cancels a pending freeze: the next plain start runs on past it.
      F.seek(F.PRE); F.playTo(0, () => out.calls.push('stale')); F.pause(); F.start();
      await new Promise((r) => setTimeout(r, 2600)); out.after = C.t;
      return out;
    });
    check(fz.isZero && fz.playing === false && fz.calls[0] === 0, `freezeAtSnap: the clock stops on t = 0 exactly and holds${tag} (t ${fz.t}, playing ${fz.playing})`);
    check(fz.t2 === 1.234 && fz.playing2 === false && fz.calls.length === 2 && fz.calls[1] === 1.234, `playTo(1.234) stops on 1.234 exactly${tag} (${fz.t2})`);
    check(fz.after > 0 && !fz.calls.includes('stale'), `a pause cancels a pending freeze: started again, the clock runs past the snap (${fz.after})${tag}`);
    check(errors.length === 0, `zero page errors through the field hooks${tag} ${JSON.stringify(errors.slice(0, 3))}`);
    await page.close();
  }
}
