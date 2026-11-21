/**
 * The field on puzzle screens (2026-11-12). The dad's plates: with a puzzle's prompt, options and
 * answer under it, the field shrank to about 200 of the column's 374 px, because the canvas kept the
 * world's W:H shape and the box was short. cs-field's fit() now gives the canvas the column's full
 * width and crops across the field (the camera's VH) when the whole shape would come out under 90%
 * of the width. Measured here, at 390x844 and 360x740 (DPR 1), for every puzzle type's examples and
 * every rank-1 puzzle (the units' and Game Day's), before answering and after a wrong answer (the
 * fullest panel): the canvas is at least 90% of the column's width, sits inside it, its pixels are
 * square (the scale the same both ways: canvas px per world px across = along), and the page does
 * not scroll either way.
 */
const J = JSON.stringify;

export async function browser(H) {
  const { check, open, plate } = H;
  for (const [w, h] of [[390, 844], [360, 740]]) {
    const { page, errors } = await open({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: true }, { hash: '#map' });
    const r = await page.evaluate(async () => {
      const CS = window.CS, C = window.__CS__, out = [];
      const frame = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 60))));
      const list = [];
      for (const T of Object.values(CS.puzzleTypes)) for (const e of T.examples || []) list.push(e);
      for (const u of CS.RANK_DATA[0].units) for (const p of u.puzzles) list.push(p);
      for (const p of CS.RANK_DATA[0].gameDay || []) list.push(p);
      location.hash = '#unit/' + CS.RANK_DATA[0].units[0].id;
      await new Promise((res) => setTimeout(res, 150));
      const m = () => {
        const cv = document.getElementById('cs-stage').getBoundingClientRect(), col = document.getElementById('stBox').getBoundingClientRect(), W = C.field.world;
        return { cw: cv.width, ch: cv.height, cl: cv.left, cr: cv.right, colW: col.width, colL: col.left, colR: col.right, ppx: cv.width / W.W, ppy: cv.height / W.VH,
          sy: document.scrollingElement.scrollHeight - innerHeight, sx: document.scrollingElement.scrollWidth - innerWidth };
      };
      for (const pz of list) {
        C.ui.ask(pz, { tries: 1, gameDay: true });
        await frame();
        const a = m();
        C.ui.answer(false);
        await frame(); await frame();
        const b = m();
        out.push({ id: pz.id, type: pz.type, a, b, done: C.ui.mode && C.ui.mode.done });
        C.field.pause();
      }
      return out;
    });
    const bad = (s) => !(s.cw >= 0.9 * s.colW - 0.5 && s.cl >= s.colL - 0.5 && s.cr <= s.colR + 0.5 && Math.abs(s.ppx - s.ppy) < 0.01 && s.sy <= 0 && s.sx <= 0);
    const types = [...new Set(r.map((x) => x.type))].sort();
    const fails = r.filter((x) => bad(x.a) || bad(x.b) || !x.done);
    const minW = Math.min(...r.flatMap((x) => [x.a.cw / x.a.colW, x.b.cw / x.b.colW]));
    check(r.length >= 80 && types.length >= 7 && fails.length === 0,
      `${w}x${h}: on all ${r.length} puzzle screens (${types.join(', ')}; before and after a wrong answer) the field is at least 90% of the column wide (least ${(minW * 100).toFixed(1)}%), square pixels, no page scroll ${J(fails.slice(0, 3).map((x) => ({ id: x.id, a: x.a, b: x.b })))}`);
    if (w === 390) await plate(page, 'layout-last-puzzle.png');
    check(errors.length === 0, `${w}x${h}: puzzle screens raise no page errors ${J(errors.slice(0, 3))}`);
    await page.close();
  }
}
