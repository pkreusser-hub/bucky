#!/usr/bin/env node
/**
 * Coach School suite.
 *   A. Node: cs-core.js + cs-lib.js loaded into a vm context (no DOM). Library legality, the
 *      DSL resolver, poseAt arithmetic, ball timing, XP / Leitner maths.
 *   B. Headless Chrome on a local static server (fresh port, Google/Firebase hosts blocked):
 *      boot at 390x844, layout, [hidden] geometry, chrome without emoji, touch targets,
 *      yardToScreen/hitTest round trips, a real tap, playback.
 *
 *   node tools/_verify-coachschool.mjs                 run everything
 *   node tools/_verify-coachschool.mjs --plates DIR    also write review screenshots to DIR
 *   node tools/_verify-coachschool.mjs --node-only     section A only
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8971;
const argv = process.argv.slice(2);
const PLATES = argv.includes('--plates') ? argv[argv.indexOf('--plates') + 1] : null;
const NODE_ONLY = argv.includes('--node-only');

let PASS = 0, FAIL = 0;
const fails = [];
function check(cond, msg) {
  if (cond) { PASS++; console.log('  ok   ' + msg); }
  else { FAIL++; fails.push(msg); console.log('  FAIL ' + msg); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ═════════════ A. Node ═════════════ */
console.log('\n[A] core + library in a vm context');
const ctx = vm.createContext({});
for (const f of ['cs-core.js', 'cs-lib.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/coachschool', f), 'utf8'), ctx, { filename: f });
const CS = ctx.CS, L = CS.lib;
check(typeof CS.poseAt === 'function' && typeof CS.validateFormation === 'function', 'CS loads in Node with no DOM');

// A1. Formations: 11 players, exactly 7 on the line, in bounds, spacing, personnel. The counting
// here is done by the test itself, not by asking the validator, so a validator bug can't hide one.
console.log('\n[A1] formations');
const forms = Object.values(L.FORMATIONS);
check(forms.length >= 2 && L.FORMATIONS['gun-2x2'] && L.FORMATIONS['i-form'], 'seed formations: shotgun 2x2 and I-form');
for (const f of forms) {
  const ps = CS.resolveSet(f);
  const onLine = ps.filter((p) => p.y >= -1.0).length;              // NFL: 7 on the line (cs-core ON_LINE_Y = -1)
  const rb = ps.filter((p) => p.pos === 'RB' || p.pos === 'FB').length, te = ps.filter((p) => p.pos === 'TE').length;
  let minD = Infinity;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) minD = Math.min(minD, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y));
  check(ps.length === 11, `${f.id}: 11 players (${ps.length})`);
  check(onLine === 7, `${f.id}: exactly 7 on the line (${onLine})`);
  check(ps.every((p) => p.x > 0 && p.x < 53.33), `${f.id}: everyone in bounds`);
  check(minD >= 0.8, `${f.id}: no two players within 0.8 yd (closest ${minD.toFixed(2)})`);
  check(`${rb}${te}` === f.personnel, `${f.id}: personnel ${f.personnel} matches ${rb} RB + ${te} TE`);
  check(CS.validateFormation(f).length === 0, `${f.id}: validator clean ${JSON.stringify(CS.validateFormation(f))}`);
}
check(L.FORMATIONS['gun-2x2'].personnel === '11' && L.FORMATIONS['i-form'].personnel === '21', 'shotgun 2x2 is 11 personnel, I-form is 21');

// A1b. The validator bites: each broken fixture must be flagged for the right reason.
const g2 = L.FORMATIONS['gun-2x2'];
const broken = (mut) => { const f = JSON.parse(JSON.stringify(g2)); f.id = 'broken'; mut(f); return CS.validateFormation(f); };
const has = (errs, re) => errs.some((e) => re.test(e));
check(has(broken((f) => { f.players.find((p) => p.id === 'H').y = -0.95; delete f.players.find((p) => p.id === 'H').on; }), /8 on the line/), 'broken fixture: 8 on the line is flagged');
check(has(broken((f) => { f.players.pop(); }), /10 players/), 'broken fixture: 10 players is flagged');
check(has(broken((f) => { f.players.find((p) => p.id === 'H').x = 7.5; f.players.find((p) => p.id === 'H').y = -1.6; f.players.find((p) => p.id === 'X').y = -1.2; }), /0\.8/), 'broken fixture: two players 0.5 yd apart is flagged');
check(has(broken((f) => { f.personnel = '12'; }), /personnel says 12/), 'broken fixture: wrong personnel code is flagged');
check(has(broken((f) => { f.players.find((p) => p.id === 'X').x = -1; }), /out of bounds/), 'broken fixture: out of bounds is flagged');
check(has(broken((f) => { const x = f.players.find((p) => p.id === 'X'); x.x = 20.5; const lt = f.players.find((p) => p.id === 'LT'); delete lt.dx; lt.x = 6; }), /not eligible/), 'broken fixture: a tackle at the end of the line is flagged');

// A2. Defenses and coverages. Deep counts are hand-written from the coverage definitions
// (C2 = two half-field safeties; C3 = two corners + the free safety in thirds).
console.log('\n[A2] defenses');
const DEEP = { 'c2-43-over': 2, 'c3-nickel': 3 };
for (const d of Object.values(L.DEFENSES)) {
  const ps = CS.resolveSet(d);
  check(ps.length === 11, `${d.id}: 11 defenders`);
  check(CS.validateDefense(d).length === 0, `${d.id}: validator clean ${JSON.stringify(CS.validateDefense(d))}`);
  const deepByName = d.players.filter((p) => /^deep-/.test(p.zone || '')).length;
  check(DEEP[d.id] !== undefined && deepByName === DEEP[d.id], `${d.id}: ${DEEP[d.id]} deep defenders by zone name (${deepByName})`);
  check(CS.deepCount(d) === DEEP[d.id], `${d.id}: CS.deepCount = ${DEEP[d.id]} (${CS.deepCount(d)})`);
}
check(Object.keys(DEEP).every((k) => L.DEFENSES[k]), 'seed defenses: 4-3 over Cover 2 and nickel Cover 3');
check(L.DEFENSES['c2-43-over'].players.filter((p) => p.zone).length === 7 && L.DEFENSES['c2-43-over'].players.filter((p) => p.rush).length === 4, 'Cover 2: 4 rush, 5 under + 2 deep');

// A3. Library sanity: routes, zones, hashes, BEATS starter row.
console.log('\n[A3] library');
const ROUTE_NAMES = ['hitch', 'slant', 'out', 'corner', 'post', 'go', 'dig', 'flat', 'curl'];
check(ROUTE_NAMES.every((r) => L.ROUTES[r]), 'all nine seed routes exist');
check(ROUTE_NAMES.every((r) => CS.validateRoute(r, L.ROUTES[r]).length === 0), 'every route uses only in/out tokens or 0 lateral');
check(Object.values(L.ZONES).every((z) => z.x > 0 && z.x < 53.33 && z.y > 0), 'every zone landmark is in bounds and downfield');
check(near(L.ZONES['deep-half-L'].x + L.ZONES['deep-half-R'].x, 53.33, 1e-9), 'right-side landmarks mirror the left about midfield');
check(CS.HASH_L === 23.58 && CS.HASH_R === 29.75 && CS.BALL_X === 26.67, 'NFL hashes 23.58 / 29.75, ball at 26.67');
check(JSON.stringify(L.BEATS['concept:smash']) === '["cov:2"]', 'BEATS starter row: smash beats Cover 2');
for (const p of Object.values(L.PLAYS)) {
  check(CS.validatePlay(p).length === 0, `${p.id}: validatePlay clean ${JSON.stringify(CS.validatePlay(p))}`);
  const c = CS.compile(p);
  check(new Set(c.all.map((q) => q.id)).size === 22, `${p.id}: 22 unique player ids across both teams`);
  check((p.callouts || []).length >= 2 && (p.callouts || []).length <= 3, `${p.id}: 2-3 callouts`);
}
const SM = L.PLAYS['smash-vs-c2'];
check(SM && SM.teams.off === 'KC' && SM.teams.def === 'BUF' && SM.formation === 'gun-2x2' && SM.defense === 'c2-43-over', 'seed play: smash, KC offense vs BUF Cover 2');

// A4. poseAt.
console.log('\n[A4] poseAt');
{
  const c = CS.compile(SM), s0 = CS.poseAt(SM, 0);
  check(c.all.every((p) => s0.players[p.id].x === p.x && s0.players[p.id].y === p.y), 'poseAt(t=0) is exactly the alignment for all 22');
  const sPre = CS.poseAt(SM, -1);
  check(c.all.every((p) => sPre.players[p.id].x === p.x && sPre.players[p.id].y === p.y), 'poseAt before the snap is the alignment too');
  check(s0.ball.x === 26.67 && s0.ball.y === 0, 'ball on the spot at the snap');
}
// The 12-yard dig at 7 yd/s, by hand. X in shotgun 2x2 lines up at x = 8, y = -0.95, on the
// offense's LEFT, so "in" is +x. Dig = 12 yd straight up, then flat across.
//   stem: 12 yd at 7 yd/s ends at t = 12 / 7 = 1.7142857 s, at (8, -0.95 + 12) = (8, 11.05)
//   t = 2.0: distance run = 7 * 2.0 = 14 yd, i.e. 14 - 12 = 2 yd into the break, all in +x
//   => (8 + 2, 11.05) = (10, 11.05)
{
  check(JSON.stringify(L.ROUTES.dig.pts[0]) === '[0,12]', 'dig fixture premise: 12-yard stem');
  const dig = { id: 'dig-fixture', formation: 'gun-2x2', defense: 'c2-43-over', teams: { off: 'KC', def: 'BUF' }, assign: { X: { route: 'dig' } }, ball: [{ t: 0, ev: 'snap' }] };
  const q = CS.poseAt(dig, 2.0).players.X;
  check(near(q.x, 10, 1e-9) && near(q.y, 11.05, 1e-9), `12-yd dig at 7 yd/s: X at (10, 11.05) at t=2.0 (got ${q.x}, ${q.y})`);
  const q1 = CS.poseAt(dig, 1.0).players.X;                      // 7 yd up the stem: (8, 6.05)
  check(near(q1.x, 8, 1e-9) && near(q1.y, 6.05, 1e-9), `dig at t=1.0 still on the stem: (8, 6.05) (got ${q1.x}, ${q1.y})`);
}
// Mirrored formation: the same route goes the other way. Slant = 3 up, then in 5 / up 5.
// At t = 1.0 (7 yd): 3 up the stem, 4 yd along the (5,5)/7.071 break => lateral 4/sqrt2 = 2.828.
{
  const m = CS.mirrorFormation(g2);
  // The mirror is about the BALL (26.67), not the field's half-width: 2 * 26.67 - 8 = 45.34. (The
  // field is 53.33 wide and the ball sits at the rounded 26.67, so 53.33 - 8 would be 0.01 off and
  // would put the mirrored X a hundredth of a yard off his true distance from the ball.)
  check(near(m.players.find((p) => p.id === 'X').x, 45.34, 1e-9), `mirrored 2x2 puts X at x = 2*26.67 - 8 = 45.34 (${m.players.find((p) => p.id === 'X').x})`);
  check(CS.validateFormation(m).length === 0, 'mirrored formation still legal');
  const base = { formation: 'gun-2x2', defense: 'c2-43-over', teams: { off: 'KC', def: 'BUF' }, ball: [{ t: 0, ev: 'snap' }] };
  for (const [route, sign] of [['slant', 1], ['out', -1], ['dig', 1], ['corner', -1]]) {
    const a = { ...base, id: 'a-' + route, assign: { X: { route } } }, b = { ...base, id: 'b-' + route, mirror: true, assign: { X: { route } } };
    const t = route === 'slant' ? 1.0 : 2.4;
    const ax = CS.poseAt(a, t).players.X.x - CS.poseAt(a, 0).players.X.x, bx = CS.poseAt(b, t).players.X.x - CS.poseAt(b, 0).players.X.x;
    check(Math.sign(ax) === sign && Math.sign(bx) === -sign && near(ax, -bx, 1e-9), `mirror flips ${route}: dx ${ax.toFixed(3)} vs ${bx.toFixed(3)}`);
  }
  const s = CS.poseAt({ ...base, id: 'slant-hand', assign: { X: { route: 'slant' } } }, 1.0).players.X;
  check(near(s.x, 8 + 4 / Math.SQRT2, 1e-9) && near(s.y, -0.95 + 3 + 4 / Math.SQRT2, 1e-9), 'slant at t=1.0: (8 + 2.828, 2.05 + 2.828)');
}
// Ball timing.
{
  const c = CS.compile(SM);
  for (const p of Object.values(L.PLAYS)) {
    const cc = CS.compile(p);
    if (cc.catchT == null) continue;
    const s = CS.poseAt(p, cc.catchT), r = s.players[cc.target];
    const d = Math.hypot(s.ball.x - r.x, s.ball.y - r.y);
    check(d <= 0.5, `${p.id}: ball within 0.5 yd of ${cc.target} at the catch (${d.toFixed(3)})`);
  }
  const mid = CS.poseAt(SM, (c.throwT + c.catchT) / 2);
  check(mid.ball.held === null && mid.ball.air > 1.5, 'ball in the air between throw and catch');
  const held = CS.poseAt(SM, 1.5);
  check(held.ball.held === 'QB' && Math.hypot(held.ball.x - held.players.QB.x, held.ball.y - held.players.QB.y) < 1e-9, 'QB holds the ball after the snap');
  // Every DB and LB obeys its speed: never moves faster than its default + 1% between samples.
  let worst = 0;
  for (const p of c.all) for (let t = 0; t < c.T; t += 0.05) {
    const a = CS.poseAt(SM, t).players[p.id], b = CS.poseAt(SM, t + 0.05).players[p.id];
    worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y) / 0.05 / CS.SPEEDS[p.pos]);
  }
  check(worst <= 1.01, `nobody outruns his speed (worst ratio ${worst.toFixed(3)})`);
}

// A5. XP and Leitner from a fixture log with a pinned clock.
console.log('\n[A5] XP + Leitner');
{
  const D = CS.DAY, T0 = Date.UTC(2026, 10, 1, 15, 0, 0);
  check(JSON.stringify(CS.LEITNER_DAYS) === '[0,1,3,7,21]', 'Leitner intervals 0/1/3/7/21 days');
  const log = [
    { t: T0, kind: 'answer', tag: 'pos:mike', correct: true, try: 1 },                 // +10, box 1 -> ... new tag: box 1, due T0+0
    { t: T0 + 60e3, kind: 'answer', tag: 'cov:2', correct: false, try: 1 },           // +0, box 1, due = now + 0 days
    { t: T0 + 90e3, kind: 'answer', tag: 'cov:2', correct: true, try: 2 },            // +5, box 2, due +1 day
    { t: T0 + D, kind: 'answer', tag: 'pos:mike', correct: true, try: 1, review: true }, // +5 review, box 2, due +1 day
    { t: T0 + 2 * D, kind: 'answer', tag: 'pos:mike', correct: true, try: 1, review: true }, // +5, box 3, due +3 days
    { t: T0 + 2 * D, kind: 'gameday', rank: 0, passed: true },                          // +100, rank 0 -> 1
    { t: T0 + 3 * D, kind: 'answer', tag: 'cov:2', correct: false, try: 1, review: true }, // +0, back to box 1, due = now exactly
  ];
  // Hand totals: 10 + 0 + 5 + 5 + 5 + 100 + 0 = 125.
  const s = CS.applyLog(CS.newState(), log);
  check(s.xp === 125, `XP from the log = 125 (got ${s.xp})`);
  check(s.rank === 1, `passing rank 0's Game Day promotes to rank 1 (got ${s.rank})`);
  // pos:mike: first answer correct -> box 1 (0 days)... see srsReview: a new tag answered right goes to box 1? No:
  // a tag with no entry answered right lands in box 1 (0 + 1), due T0. Review 1 -> box 2 (+1 d), review 2 -> box 3 (+3 d).
  check(s.srs['pos:mike'].box === 3 && s.srs['pos:mike'].due === T0 + 2 * D + 3 * D, `pos:mike in box 3, due T0+5d (got box ${s.srs['pos:mike'].box}, due T0+${(s.srs['pos:mike'].due - T0) / D}d)`);
  check(s.srs['cov:2'].box === 1 && s.srs['cov:2'].due === T0 + 3 * D, `wrong review sends cov:2 to box 1, due at that very moment (real 0-day interval) (got T0+${(s.srs['cov:2'].due - T0) / D}d)`);
  check(JSON.stringify(CS.srsDue(s.srs, T0 + 3 * D)) === '["cov:2"]', 'only cov:2 is due at T0+3d');
  check(JSON.stringify(CS.srsDue(s.srs, T0 + 5 * D)) === '["cov:2","pos:mike"]', 'both due at T0+5d, oldest first');
  const top = CS.srsReview({ x: { box: 5, due: 0 } }, 'x', true, T0);
  check(top.x.box === 5 && top.x.due === T0 + 21 * D, 'box 5 stays 5, 21-day interval');
  check(CS.xpForAnswer(1, true, false) === 10 && CS.xpForAnswer(2, true, false) === 5 && CS.xpForAnswer(3, true, false) === 0 && CS.xpForAnswer(1, false, false) === 0, 'XP per answer: 10 / 5 / 0 / wrong 0');
  // Real zeros must survive loading: xp 0, rank 0 (Intern) and a due time of 0 (the epoch).
  const z = CS.normalizeState({ v: 1, xp: 0, rank: 0, srs: { t: { box: 1, due: 0 } }, streak: { n: 0, last: null, freezes: 0 } });
  check(z.xp === 0 && z.rank === 0, 'normalizeState keeps xp 0 and rank 0');
  check(z.srs.t.due === 0 && JSON.stringify(CS.srsDue(z.srs, 0)) === '["t"]', 'a due time of 0 stays 0 and is due at clock 0');
  check(z.streak.freezes === 0, 'a streak with 0 freezes left keeps 0 (not the default 1)');
  const zz = CS.srsReview({}, 'n', false, 0);
  check(zz.n.box === 1 && zz.n.due === 0, 'wrong answer at clock 0: box 1, due 0');
  check(CS.levelForXp(0) === 1 && CS.levelForXp(99) === 1 && CS.levelForXp(100) === 2 && CS.levelForXp(300) === 3 && CS.levelForXp(125) === 2, 'coach level thresholds 0 / 100 / 300');
  check(CS.normalizeState({ xp: '50', rank: 'x' }).xp === 0 && CS.normalizeState({ rank: 'x' }).rank === 0, 'non-numbers fall back without passing through');
}

/* ═════════════ B. Headless Chrome ═════════════ */
async function sectionB() {
  console.log('\n[B] headless Chrome');
  const require = createRequire(import.meta.url);
  const puppeteer = require('puppeteer-core');
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = path.join(ROOT, u === '/' ? 'coachschool.html' : u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r, j) => server.once('error', j).listen(PORT, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${PORT}`;
  const browser = await puppeteer.launch({ channel: 'chrome', headless: 'new', args: ['--no-sandbox'] });
  const blocked = [];
  async function open(vp, opts = {}) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    if (opts.reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.setRequestInterception(true);
    page.on('request', (r) => { if (/googleapis|gstatic|firebase|firestore/.test(r.url())) { blocked.push(r.url()); r.abort(); } else r.continue(); });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    await page.goto(BASE + '/coachschool.html', { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!window.__CS__, { timeout: 10000 });
    return { page, errors };
  }
  const plate = async (page, name) => { if (PLATES) { fs.mkdirSync(PLATES, { recursive: true }); await page.screenshot({ path: path.join(PLATES, name) }); console.log('  plate ' + path.join(PLATES, name)); } };
  try {
    // B1. Boot on a phone.
    console.log('\n[B1] boot at 390x844');
    const { page, errors } = await open({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const boot = await page.evaluate(() => ({
      play: window.__CS__.play && window.__CS__.play.id, t: window.__CS__.t,
      sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth,
      cv: (() => { const r = document.getElementById('cs-field').getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top, b: r.bottom }; })(),
    }));
    check(boot.play === 'smash-vs-c2', 'engine demo loads the seeded smash play');
    check(boot.sh <= boot.ih && boot.sw <= boot.iw, `no page scroll at 390x844 (content ${boot.sw}x${boot.sh})`);
    check(boot.cv.w >= 340 && boot.cv.b <= 844, `field canvas fills the column (${boot.cv.w.toFixed(0)}x${boot.cv.h.toFixed(0)})`);
    check(blocked.some((u) => /googleapis/.test(u)), 'the Google Fonts request was blocked and the page still booted');
    await plate(page, 'cs-presnap-390.png');

    // B2. [hidden] overlays have no geometry; opening one gives it geometry.
    console.log('\n[B2] hidden overlays');
    const hid = await page.evaluate(() => [...document.querySelectorAll('[hidden]')].map((e) => ({ id: e.id, gone: e.offsetParent === null && e.getBoundingClientRect().height === 0 })));
    check(hid.length >= 1 && hid.some((h) => h.id === 'legend'), `there is a hidden overlay to test (${hid.map((h) => h.id).join(',')})`);
    check(hid.every((h) => h.gone), 'every [hidden] element has offsetParent === null and no height');
    await page.click('#btnKey');
    const shown = await page.evaluate(() => { const e = document.getElementById('legend'); return e.offsetParent !== null || getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().height > 0; });
    check(shown, 'Chalk key opens a visible sheet');
    await page.click('#btnKeyClose');
    check(await page.evaluate(() => document.getElementById('legend').offsetParent === null && document.getElementById('legend').getBoundingClientRect().height === 0), 'closing it removes its geometry again');

    // B3. Chrome: no emoji in headings, buttons, nav; touch targets.
    console.log('\n[B3] chrome');
    const chrome = await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3,button,nav,a,.chip,label')].map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
    const EMOJI = /\p{Extended_Pictographic}/u;
    check(chrome.length >= 6 && chrome.every((s) => !EMOJI.test(s)), `no emoji in headings / buttons / nav (${chrome.length} elements)`);
    const small = await page.evaluate(() => [...document.querySelectorAll('button, a, input')].filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, w: r.width, h: r.height }; }).filter((r) => r.w < 44 || r.h < 44));
    check(small.length === 0, `every visible control is at least 44x44 px ${JSON.stringify(small)}`);
    const ctrlFit = await page.evaluate(() => { const c = document.getElementById('cs-field').getBoundingClientRect(), b = document.querySelector('.controls').getBoundingClientRect(); return b.top >= c.bottom; });
    check(ctrlFit, 'controls sit below the field, not over it');

    // B4. yardToScreen / hitTest round trip for every player at several times.
    console.log('\n[B4] hit-testing');
    const rt = await page.evaluate(() => {
      const C = window.__CS__, CS = window.CS, out = [];
      for (const t of [-1, 0, 1.2, 2.4, 3.3, C.T]) {
        C.seek(t);
        const pose = CS.poseAt(C.play, C.t);
        for (const [id, q] of Object.entries(pose.players)) {
          const s = C.yardToScreen(q.x, q.y), back = C.screenToYard(s.x, s.y);
          out.push({ t, id, hit: C.hitTest(s.x, s.y), err: Math.hypot(back.x - q.x, back.y - q.y) });
        }
      }
      return out;
    });
    const miss = rt.filter((r) => r.hit !== r.id);
    check(rt.length === 22 * 6 && miss.length === 0, `yardToScreen -> hitTest returns the same player for all 22 at 6 times ${JSON.stringify(miss.slice(0, 4))}`);
    check(rt.every((r) => r.err < 1e-6), 'screenToYard inverts yardToScreen');
    const rad = await page.evaluate(() => {
      const C = window.__CS__, CS = window.CS;
      C.seek(0);
      const pose = CS.poseAt(C.play, 0), pts = Object.entries(pose.players).map(([id, q]) => ({ id, ...C.yardToScreen(q.x, q.y) }));
      // The most isolated player: tap 22 CSS px straight above his feet.
      let best = null;
      for (const p of pts) { const nn = Math.min(...pts.filter((o) => o !== p).map((o) => Math.hypot(o.x - p.x, o.y - p.y))); if (!best || nn > best.nn) best = { ...p, nn }; }
      return { r: C.hitRadius, id: best.id, nn: best.nn, hit22: C.hitTest(best.x, best.y - 22), hitFar: C.hitTest(best.x, best.y - 60) };
    });
    check(rad.r >= 22 && rad.hit22 === rad.id, `hit radius >= 22 CSS px: a tap 22 px above ${rad.id}'s feet still hits him (radius ${rad.r})`);
    check(rad.nn > 60 ? rad.hitFar === null : true, 'a tap well clear of everyone hits nobody');
    // A real tap, through the touch screen, names the player.
    const mikeAt = await page.evaluate(() => { const C = window.__CS__, q = window.CS.poseAt(C.play, C.t).players.MIKE; return C.yardToScreen(q.x, q.y); });
    await page.touchscreen.tap(mikeAt.x, mikeAt.y);
    const said = await page.evaluate(() => document.getElementById('readout').textContent.replace(/\s+/g, ' ').trim());
    check(/^You tapped: Mike linebacker\b/.test(said), `a real tap on the Mike reads "${said}"`);

    // B5. Playback: play advances t at 1x and at 0.5x, scrub seeks, pause holds.
    console.log('\n[B5] playback');
    await page.evaluate(() => window.__CS__.seek(-1.2));
    await page.click('#btnPlay');
    const rate = async () => page.evaluate(() => new Promise((res) => { const C = window.__CS__, t0 = C.t, w0 = performance.now(); setTimeout(() => res((C.t - t0) / ((performance.now() - w0) / 1000)), 700); }));
    const r1 = await rate();
    check(r1 > 0.7 && r1 < 1.15, `1x plays at about real time (${r1.toFixed(2)} play-s per s)`);
    await page.click('#btnSlow');
    const r2 = await rate();
    check(r2 > 0.3 && r2 < 0.6, `0.5x plays at about half speed (${r2.toFixed(2)})`);
    check(await page.evaluate(() => document.getElementById('btnSlow').getAttribute('aria-pressed') === 'true'), '0.5x button shows pressed');
    await page.click('#btnPlay');
    const held = await page.evaluate(() => new Promise((res) => { const t0 = window.__CS__.t; setTimeout(() => res(window.__CS__.t === t0 && !window.__CS__.playing), 300); }));
    check(held, 'pause holds the clock');
    const sc = await page.evaluate(() => { const s = document.getElementById('scrub'); s.value = '1.6'; s.dispatchEvent(new Event('input', { bubbles: true })); return window.__CS__.t; });
    check(Math.abs(sc - 1.6) < 1e-9, `scrubbing to 1.6 seeks the play (t ${sc})`);
    await plate(page, 'cs-midroute-390.png');
    await page.evaluate(() => window.__CS__.seek(3.15));
    await plate(page, 'cs-catch-390.png');
    check(errors.length === 0, `zero page errors on the phone ${JSON.stringify(errors)}`);
    await page.close();

    // B6. Reduced motion: playback only ever lands on key frames.
    console.log('\n[B6] reduced motion');
    {
      const { page: p2, errors: e2 } = await open({ width: 390, height: 844, deviceScaleFactor: 1 }, { reduced: true });
      await p2.click('#btnPlay');
      const seen = await p2.evaluate(() => new Promise((res) => { const s = new Set(), C = window.__CS__; const iv = setInterval(() => s.add(C.t), 30); setTimeout(() => { clearInterval(iv); res({ seen: [...s], keys: C.keys, reduced: C.reduced }); }, 2800); }));
      check(seen.reduced, 'prefers-reduced-motion is detected');
      check(seen.seen.length >= 2 && seen.seen.every((t) => seen.keys.some((k) => Math.abs(k - t) < 1e-9)), `reduced motion steps key frames only (${seen.seen.map((t) => t.toFixed(2)).join(' ')})`);
      check(e2.length === 0, 'zero page errors with reduced motion');
      await p2.close();
    }

    // B7. Desktop: a centred column, no scroll.
    console.log('\n[B7] desktop');
    {
      const { page: p3, errors: e3 } = await open({ width: 1280, height: 900, deviceScaleFactor: 1 });
      const d = await p3.evaluate(() => { const r = document.querySelector('main').getBoundingClientRect(); return { l: r.left, r: innerWidth - r.right, w: r.width, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, ih: innerHeight }; });
      check(Math.abs(d.l - d.r) <= 1 && d.w <= 520, `desktop column is centred (${d.l.toFixed(0)} / ${d.r.toFixed(0)}, width ${d.w})`);
      check(d.sw <= 1280 && d.sh <= d.ih, 'no scroll on desktop');
      await p3.evaluate(() => window.__CS__.seek(3.3));
      await plate(p3, 'cs-desktop-catch.png');
      check(e3.length === 0, 'zero page errors on desktop');
      await p3.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

if (!NODE_ONLY) {
  try { await sectionB(); } catch (e) { FAIL++; fails.push('section B crashed: ' + e.message); console.log('  FAIL section B crashed: ' + (e.stack || e)); }
}
console.log(`\n${PASS}/${PASS + FAIL} passed`);
if (FAIL) { console.log('failures:\n  ' + fails.join('\n  ')); process.exit(1); }
