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
 *   node tools/_verify-coachschool.mjs --only pz-route  only these check modules (comma-separated); this file's
 *                                                      own A checks still run (seconds), its Chrome checks do not
 *   node tools/_verify-coachschool.mjs --only lib --lib FILE   the library checks against another cs-lib.js
 *                                                      (bite proofs; lib.mjs reads --lib, Node only)
 *
 * CHECK MODULES. Everything below in this file is the original suite. New checks live in
 * tools/coachschool-checks/*.mjs, one file per subject (pz-<type>.mjs for a puzzle type), so agents
 * working in parallel never edit the same file. Each module may export
 *   export async function node(H)     run in section A, after this file's own A checks
 *   export async function browser(H)  run in section B, with the shared Chrome
 * H = { CS, L, ctx, loadVm(extraFiles?), check, near, ROOT, PLATES, J } in node(), and the same plus
 * { open(vp, opts), plate(page, name), settle(page, ms), BASE } in browser(). open() takes
 * opts.hash (default '#demo'), opts.reduced, opts.storage, opts.init (a function run in the page
 * before any script, page.evaluateOnNewDocument). Modules load in file-name order.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.CS_PORT) || 8971;   // CS_PORT lets parallel worktrees run the battery at once without fighting over one port
const argv = process.argv.slice(2);
const PLATES = argv.includes('--plates') ? argv[argv.indexOf('--plates') + 1] : null;
const NODE_ONLY = argv.includes('--node-only');
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;

let PASS = 0, FAIL = 0;
const fails = [];
function check(cond, msg) {
  if (cond) { PASS++; console.log('  ok   ' + msg); }
  else { FAIL++; fails.push(msg); console.log('  FAIL ' + msg); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/* ═════════════ A. Node ═════════════ */
console.log('\n[A] core + library in a vm context');
// RESTAGED for the puzzle-type plugin contract: the type and rank files are found, not listed, so a new
// cs-pz-<type>.js (or cs-rank-<n>.js) is in the vm without anyone editing this line. Order as the page
// loads them: core, library, puzzle types, rank content.
const ASSETS = path.join(ROOT, 'assets/coachschool');
const byNum = (a, b) => (parseInt(a.replace(/\D+/g, ''), 10) || 0) - (parseInt(b.replace(/\D+/g, ''), 10) || 0) || (a < b ? -1 : 1);
const FILES = ['cs-core.js', 'cs-lib.js',
  ...fs.readdirSync(ASSETS).filter((f) => /^cs-pz-[a-z0-9-]+\.js$/.test(f)).sort(),
  ...fs.readdirSync(ASSETS).filter((f) => /^cs-rank-\d+\.js$/.test(f)).sort(byNum)];
function loadVm(extra) {
  const c = vm.createContext({});
  for (const f of FILES.concat(extra || [])) vm.runInContext(fs.readFileSync(path.isAbsolute(f) ? f : path.join(ASSETS, f), 'utf8'), c, { filename: f });
  return c;
}
const ctx = loadVm();
const CS = ctx.CS, L = CS.lib;
check(typeof CS.poseAt === 'function' && typeof CS.validateFormation === 'function', 'CS loads in Node with no DOM');

// A1. Formations: 11 players, exactly 7 on the line, in bounds, spacing, personnel. The counting
// here is done by the test itself, not by asking the validator, so a validator bug can't hide one.
console.log('\n[A1] formations');
const forms = Object.values(L.FORMATIONS);
check(forms.length >= 2 && L.FORMATIONS['gun-2x2'] && L.FORMATIONS['i-form'], 'seed formations: shotgun 2x2 and I-form');
for (const f of forms) {
  const ps = CS.resolveSet(f);
  // RESTAGED in phase 2: the fact sheet (1b) puts on-line players at y = 0 and off-line players at
  // y = -1, so "on the line" is now y >= -0.5. The old -1.0 cut would count the flanker as on it.
  const onLine = ps.filter((p) => p.y >= -0.5).length;              // NFL: 7 on the line (cs-core ON_LINE_Y = -0.5)
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
// RESTAGED in phase 2 (fact-sheet alignments): the slot steps up to y = 0, the sheet's on-line depth;
// -0.95 is now off the line, so the old fixture no longer made an eighth man.
check(has(broken((f) => { f.players.find((p) => p.id === 'H').y = 0; delete f.players.find((p) => p.id === 'H').on; }), /8 on the line/), 'broken fixture: 8 on the line is flagged');
check(has(broken((f) => { f.players.pop(); }), /10 players/), 'broken fixture: 10 players is flagged');
// RESTAGED in phase 2: X now lines up at the sheet's x = 6 (was 8), so the slot is put 0.5 yd from
// wherever X actually is instead of at a fixed 7.5.
check(has(broken((f) => { const x = f.players.find((p) => p.id === 'X'), h = f.players.find((p) => p.id === 'H'); h.x = x.x + 0.5; h.y = x.y; delete h.on; x.y = 0; }), /0\.8/), 'broken fixture: two players 0.5 yd apart is flagged');
check(has(broken((f) => { f.personnel = '12'; }), /personnel says 12/), 'broken fixture: wrong personnel code is flagged');
check(has(broken((f) => { f.players.find((p) => p.id === 'X').x = -1; }), /out of bounds/), 'broken fixture: out of bounds is flagged');
check(has(broken((f) => { const x = f.players.find((p) => p.id === 'X'); x.x = 20.5; const lt = f.players.find((p) => p.id === 'LT'); delete lt.dx; lt.x = 6; }), /not eligible/), 'broken fixture: a tackle at the end of the line is flagged');

// A2. Defenses and coverages. Deep counts are hand-written from the coverage definitions
// (C2 = two half-field safeties; C3 = two corners + the free safety in thirds).
console.log('\n[A2] defenses');
// RESTAGED for the full library (75c0590): this table used to name the phase-1 seed's five defenses by
// id, so each of the 37 defenses the library added read "undefined deep" and failed. The rule it holds
// is unchanged: the deep count is typed here by hand, never read back from the library. It is now
// written once per coverage, keyed by the coverage prefix of the defense id (the library's naming:
// c2-43-over = Cover 2 from the 4-3 over), from fact sheet 5a's "deep" column and section 9:
//   c0  Cover 0 = 0 (all man, no deep help)      c1 Cover 1 = 1 (the FS in the deep middle)
//   c2  Cover 2 = 2 (FS + SS, a half each)       t2 Tampa 2 = 2, + the Mike in the middle hole, which
//   c3  Cover 3 = 3 (two corners + the FS)          5a writes "2 + Mike": not a third deep zone
//   c4  Cover 4 = 4 (four quarters)              c6 Cover 6 = 3 (FS half L + SS Q3 + CB-R Q4)
//   c2m 2-man   = 2 (FS + SS halves)             fz fire zone = 3 (9: "two corners + one safety")
//   sim sim pressure = 3: 9 says "varies (often 2 or 3)"; the library draws it behind Cover 3 (its
//       `mapped` note says so), so 3 for this drawing.
// Every defense in the library must carry one of these prefixes, and its declared coverage must be
// the prefix's: a new coverage fails here until someone writes its number down.
const DEEP = { c0: 0, c1: 1, c2: 2, t2: 2, c3: 3, c4: 4, c6: 3, c2m: 2, fz: 3, sim: 3 };
const COV_OF = { c0: 'cov:0', c1: 'cov:1', c2: 'cov:2', t2: 'cov:tampa2', c3: 'cov:3', c4: 'cov:4', c6: 'cov:6', c2m: 'cov:2man', fz: 'cov:3', sim: 'cov:3' };
for (const d of Object.values(L.DEFENSES)) {
  const ps = CS.resolveSet(d);
  check(ps.length === 11, `${d.id}: 11 defenders`);
  check(CS.validateDefense(d).length === 0, `${d.id}: validator clean ${JSON.stringify(CS.validateDefense(d))}`);
  const pre = d.id.split('-')[0], want = DEEP[pre];
  const deepByName = d.players.filter((p) => /^deep-/.test(p.zone || '')).length;
  check(want !== undefined && d.coverage === COV_OF[pre] && deepByName === want, `${d.id}: ${want} deep defenders by zone name (${deepByName}; ${pre} = ${COV_OF[pre]}, library says ${d.coverage})`);
  check(CS.deepCount(d) === want, `${d.id}: CS.deepCount = ${want} (${CS.deepCount(d)})`);
  if (pre === 't2') check(d.players.some((p) => p.id === 'MIKE' && p.zone === 'hole-M') && L.ZONES['hole-M'] && !L.ZONES['hole-M'].deep, `${d.id}: the Mike runs the middle hole, which is not counted deep (5a: 2 + Mike)`);
}
check(['c2-43-over', 'c3-nickel', 'c3-43-over', 'c3-34', 'c2-nickel'].every((k) => L.DEFENSES[k]), 'seed defenses: 4-3 over Cover 2 and nickel Cover 3');
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
  // RESTAGED in phase 2: puzzle diagrams are plays too, and they carry no callouts (the puzzle asks
  // the question; a note would give the answer away). The 2-3 rule now holds for every play a
  // lesson WATCHES (the phase-1 seed and each unit's own play); a puzzle-only play has none.
  // RESTAGED for the full library (75c0590): the library's ten concept plays (one canonical play per
  // concept, L.CONCEPTS[k].play) carry 2-3 sourced callouts by design (lib check L6): a lesson will
  // watch them. Before, only smash was a library play and the rest of PLAYS was rank-1 puzzle
  // diagrams, so "not watched by a unit" meant "puzzle-only". The split is now explicit: a lesson
  // play (watched by a unit, or a concept's canonical play) has 2-3 callouts; every other play is a
  // puzzle diagram and still has none, since a note would give the puzzle's answer away.
  const watched = (CS.RANK_DATA || []).some((r) => r && r.units.some((u) => u.play === p.id));
  const conceptPlay = !!p.concept && L.CONCEPTS[p.concept] && L.CONCEPTS[p.concept].play === p.id;
  if (watched || conceptPlay) check((p.callouts || []).length >= 2 && (p.callouts || []).length <= 3, `${p.id}: a ${watched ? 'lesson' : 'concept'} play has 2-3 callouts`);
  else check(!(p.callouts || []).length, `${p.id}: a puzzle-only play has no callouts`);
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
// RESTAGED in phase 2: X's alignment is now the fact sheet's (6, 0), not phase 1's provisional
// (8, -0.95); the arithmetic is the same, redone from the new start.
// The 12-yard dig at 7 yd/s, by hand. X in shotgun 2x2 lines up at x = 6, y = 0, on the
// offense's LEFT, so "in" is +x. Dig = 12 yd straight up, then flat across.
//   stem: 12 yd at 7 yd/s ends at t = 12 / 7 = 1.7142857 s, at (6, 0 + 12) = (6, 12)
//   t = 2.0: distance run = 7 * 2.0 = 14 yd, i.e. 14 - 12 = 2 yd into the break, all in +x
//   => (6 + 2, 12) = (8, 12)
{
  check(JSON.stringify(L.ROUTES.dig.pts[0]) === '[0,12]', 'dig fixture premise: 12-yard stem');
  const dig = { id: 'dig-fixture', formation: 'gun-2x2', defense: 'c2-43-over', teams: { off: 'KC', def: 'BUF' }, assign: { X: { route: 'dig' } }, ball: [{ t: 0, ev: 'snap' }] };
  const q = CS.poseAt(dig, 2.0).players.X;
  check(near(q.x, 8, 1e-9) && near(q.y, 12, 1e-9), `12-yd dig at 7 yd/s: X at (8, 12) at t=2.0 (got ${q.x}, ${q.y})`);
  const q1 = CS.poseAt(dig, 1.0).players.X;                      // 7 yd up the stem: (6, 7)
  check(near(q1.x, 6, 1e-9) && near(q1.y, 7, 1e-9), `dig at t=1.0 still on the stem: (6, 7) (got ${q1.x}, ${q1.y})`);
}
// Mirrored formation: the same route goes the other way. Slant = 3 up, then in 5 / up 5.
// At t = 1.0 (7 yd): 3 up the stem, 4 yd along the (5,5)/7.071 break => lateral 4/sqrt2 = 2.828.
{
  const m = CS.mirrorFormation(g2);
  // RESTAGED in phase 2: X starts at the sheet's 6, so the mirror is 2 * 26.67 - 6 = 47.34.
  // The mirror is about the BALL (26.67), not the field's half-width. (The
  // field is 53.33 wide and the ball sits at the rounded 26.67, so 53.33 - 8 would be 0.01 off and
  // would put the mirrored X a hundredth of a yard off his true distance from the ball.)
  check(near(m.players.find((p) => p.id === 'X').x, 47.34, 1e-9), `mirrored 2x2 puts X at x = 2*26.67 - 6 = 47.34 (${m.players.find((p) => p.id === 'X').x})`);
  check(CS.validateFormation(m).length === 0, 'mirrored formation still legal');
  const base = { formation: 'gun-2x2', defense: 'c2-43-over', teams: { off: 'KC', def: 'BUF' }, ball: [{ t: 0, ev: 'snap' }] };
  for (const [route, sign] of [['slant', 1], ['out', -1], ['dig', 1], ['corner', -1]]) {
    const a = { ...base, id: 'a-' + route, assign: { X: { route } } }, b = { ...base, id: 'b-' + route, mirror: true, assign: { X: { route } } };
    // RESTAGED in phase 2: from x = 6 the 8-yard out reaches the sideline clamp by t = 2.4 (6 - 6.8 < 0),
    // which made the two sides unequal for a reason that has nothing to do with mirroring; sample it
    // at 2.0 (4 yd into the break, x = 2), still clear of the sideline.
    const t = route === 'slant' ? 1.0 : route === 'out' ? 2.0 : 2.4;
    const ax = CS.poseAt(a, t).players.X.x - CS.poseAt(a, 0).players.X.x, bx = CS.poseAt(b, t).players.X.x - CS.poseAt(b, 0).players.X.x;
    check(Math.sign(ax) === sign && Math.sign(bx) === -sign && near(ax, -bx, 1e-9), `mirror flips ${route}: dx ${ax.toFixed(3)} vs ${bx.toFixed(3)}`);
  }
  const s = CS.poseAt({ ...base, id: 'slant-hand', assign: { X: { route: 'slant' } } }, 1.0).players.X;
  check(near(s.x, 6 + 4 / Math.SQRT2, 1e-9) && near(s.y, 0 + 3 + 4 / Math.SQRT2, 1e-9), 'slant at t=1.0 from the sheet (6, 0): (6 + 2.828, 3 + 2.828)');
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

// A6. Rank 1 (Intern) content: every lesson, puzzle and Game Day question, checked from the play.
console.log('\n[A6] rank 1 content');
{
  const R = CS.RANK_DATA && CS.RANK_DATA[0];
  check(!!R && R.title === 'Intern' && R.promotesTo === 'Quality Control Coach' && CS.RANKS[1] === R.promotesTo, 'rank 1 is Intern and promotes to Quality Control Coach (CS.RANKS[1])');
  const U = R.units, ALL = [...U.flatMap((u) => u.puzzles), ...R.gameDay];
  check(U.length === 7, `7 units (got ${U.length})`);
  // Unique ids across units, puzzles, Game Day and plays.
  const ids = [...U.map((u) => u.id), ...ALL.map((p) => p.id)];
  check(new Set(ids).size === ids.length, `unit and puzzle ids are unique (${ids.length})`);
  // Every play a rank-1 screen draws is legal.
  const used = new Set([...U.map((u) => u.play), ...U.flatMap((u) => u.cards.map((c) => c.play).filter(Boolean)), ...ALL.map((p) => p.play)]);
  const badPlays = [...used].filter((id) => !L.PLAYS[id] || CS.validatePlay(L.PLAYS[id]).length);
  check(used.size >= 20 && badPlays.length === 0, `all ${used.size} rank-1 plays exist and validate ${badPlays.map((id) => id + ': ' + (L.PLAYS[id] ? CS.validatePlay(L.PLAYS[id]).join('; ') : 'missing')).join(' | ')}`);
  // Every puzzle validates, its stored answer passes its checker, and every distractor fails it.
  const pzBad = [], ansBad = [], disBad = [];
  for (const pz of ALL) {
    const e = CS.validatePuzzle(pz);
    if (e.length) pzBad.push(e.join('; '));
    if (!CS.checkPuzzle(pz, pz.answer)) ansBad.push(pz.id);
    const ds = CS.distractorsOf(pz);
    if (!ds.length || ds.some((d) => CS.checkPuzzle(pz, d))) disBad.push(pz.id);
  }
  check(ALL.length >= 60 && pzBad.length === 0, `all ${ALL.length} puzzles validate ${pzBad.slice(0, 3).join(' | ')}`);
  check(ansBad.length === 0, `every stored answer passes its own checker ${ansBad.join(',')}`);
  check(disBad.length === 0, `every distractor fails its checker ${disBad.join(',')}`);
  // Tap distractors are the other 21 players: a tap puzzle has exactly one right player.
  const tp = ALL.find((p) => p.type === 'tap');
  check(CS.distractorsOf(tp).length === 21, `a tap puzzle's distractors are the other 21 players (${tp.id}: ${CS.distractorsOf(tp).length})`);
  // Broken fixtures are flagged: a description that fits two players, two right options, a wrong stored answer.
  const two = CS.validatePuzzle({ id: 'bad-tap', type: 'tap', play: 'r1-def', prompt: 'Tap the corner.', find: { pos: 'CB' }, answer: 'CB-L', tags: ['def:db'] });
  check(two.some((e) => /two right answers/.test(e)), `tap {pos:'CB'} (two corners) is flagged: ${two.join('; ')}`);
  const dup = CS.validatePuzzle({ id: 'bad-choice', type: 'choice', play: 'r1-los', prompt: 'How many on the line?', q: 'onLineCount', options: [{ t: 'Seven', v: 7 }, { t: '7', v: 7 }, { t: 'Six', v: 6 }], answer: 0, tags: ['los:seven'] });
  check(dup.some((e) => /two right answers/.test(e)), `a choice with two options both true is flagged: ${dup.join('; ')}`);
  const wrongStored = CS.validatePuzzle({ id: 'bad-stored', type: 'choice', play: 'r1-los', prompt: 'How many on the line?', q: 'onLineCount', options: [{ t: 'Six', v: 6 }, { t: 'Seven', v: 7 }], answer: 0, tags: ['los:seven'] });
  check(wrongStored.some((e) => /stored answer/.test(e)), `a stored answer that is not the true one is flagged: ${wrongStored.join('; ')}`);
  const wrongTap = CS.validatePuzzle({ id: 'bad-tap2', type: 'tap', play: 'r1-ol', prompt: 'Tap the center.', find: { role: 'C' }, answer: 'LG', tags: ['ol:center'] });
  check(wrongTap.length > 0 && !CS.checkPuzzle({ id: 'x', type: 'tap', play: 'r1-ol', find: { role: 'C' }, answer: 'LG' }, 'LG'), `a tap whose stored answer is not the described player is flagged and fails: ${wrongTap.join('; ')}`);
  const noSrc = CS.validatePuzzle({ id: 'bad-src', type: 'choice', play: 'r1-los', prompt: 'How wide?', q: 'fact', truth: 1, options: [{ t: 'one', v: 1 }, { t: 'two', v: 2 }], answer: 0, tags: ['field:size'] });
  check(noSrc.some((e) => /fact-sheet section/.test(e)), 'a fact question without its fact-sheet section is flagged');
  // Tags are taught (on a card) before they are tested, and every taught tag is tested.
  const taught = new Set(), early = [];
  for (const u of U) {
    for (const c of u.cards) for (const t of c.teaches || []) taught.add(t);
    for (const pz of u.puzzles) for (const t of pz.tags) if (!taught.has(t)) early.push(`${pz.id}:${t}`);
  }
  for (const pz of R.gameDay) for (const t of pz.tags) if (!taught.has(t)) early.push(`${pz.id}:${t}`);
  check(early.length === 0, `every tag is taught on a card before a puzzle tests it ${early.join(',')}`);
  const tested = new Set(ALL.flatMap((p) => p.tags));
  const untested = [...taught].filter((t) => !tested.has(t));
  check(taught.size >= 15 && untested.length === 0, `all ${taught.size} taught tags are tested ${untested.join(',')}`);
  // Lesson shape.
  const SENT = (s) => (s.match(/[.!?](?=\s|$)/g) || []).length;
  const EMOJI = /\p{Extended_Pictographic}/u;
  for (const u of U) {
    const p = L.PLAYS[u.play];
    check(u.cards.length >= 3 && u.cards.length <= 5, `${u.id}: 3-5 chalk-talk cards (${u.cards.length})`);
    // RESTAGED (coach bubbles): a card's words now live in its bubbles (c.say); c.text is only their
    // join. The 3-4 sentence rule is counted over what is actually shown, bubble by bubble, so it
    // can't pass on a stale c.text; and no single bubble may carry more than 2 sentences, or the
    // split into short pointed bubbles would mean nothing.
    const counts = u.cards.map((c) => (c.say || []).reduce((n, b) => n + SENT(b.text), 0));
    check(counts.every((n) => n >= 3 && n <= 4), `${u.id}: every card is 3-4 sentences across its bubbles (${counts.join(',')})`);
    const fat = u.cards.flatMap((c) => (c.say || []).filter((b) => SENT(b.text) < 1 || SENT(b.text) > 2).map((b) => c.title + ': ' + b.text.slice(0, 30)));
    check(fat.length === 0, `${u.id}: every bubble is 1-2 sentences ${fat.join(' | ')}`);
    check(!!p && (p.callouts || []).length >= 2 && (p.callouts || []).length <= 3, `${u.id}: its play ${u.play} carries 2-3 callouts`);
    const walkBad = u.walk.filter((w) => !CS.checkPuzzle({ id: 'walk', type: 'tap', play: u.play, find: w.find, answer: w.answer }, w.answer) || CS.validatePuzzle({ id: 'walk', type: 'tap', play: u.play, prompt: w.prompt, find: w.find, answer: w.answer, tags: [] }).length);
    check(u.walk.length >= 2 && walkBad.length === 0, `${u.id}: ${u.walk.length}-step walkthrough, each step one right player`);
    check(u.puzzles.length >= 6 && u.puzzles.length <= 8, `${u.id}: 6-8 puzzles (${u.puzzles.length})`);
    check(u.puzzles[0].play === u.play && u.puzzles[1].play === u.play && u.puzzles.slice(2).every((q) => q.play !== u.play), `${u.id}: puzzles 1-2 repeat the taught play, the rest are variants`);
  }
  // Eligible receivers (the dad asked for r1-u2 to be checked, 2026-11-11; fact sheet "Eligible
  // receivers", corrected the same day). Two rule errors had shipped: interior linemen "ineligible
  // unless they report" (reporting never makes an interior lineman eligible; a 50-79 man must report
  // AND line up at an end or in the backfield), and "every player in the backfield" taught bare (the
  // number rule, and the QB under center). The card is held to the corrected wording, sentence by
  // sentence, and no rank-1 string may carry either claim again.
  {
    const elig = U.find((u) => u.id === 'r1-u2').cards.find((c) => c.title === 'Eligible receivers');
    const WANT = [
      [['X', 'Y'], 'Only eligible receivers may catch a forward pass: the player at each end of the line, plus the players in the backfield.'],
      [['ol'], 'They also need an eligible number, under 50 or 80 to 89, so a lineman wearing 50 to 79 has to report to the referee and line up at an end or in the backfield.'],
      [['line'], 'A receiver on the line with another man outside him is covered up, and that makes him ineligible too.'],
      [['QB'], 'One exception: a quarterback taking the snap under center can\'t catch a pass.'],
    ];
    const got = elig ? elig.say.map((b) => [b.focus, b.text]) : [];
    check(JSON.stringify(got) === JSON.stringify(WANT), `the Eligible receivers card is the fact sheet's corrected rule, four bubbles word for word ${JSON.stringify(got.map((g) => g[1].slice(0, 40)))}`);
    const r1Plays = Object.values(L.PLAYS).filter((p) => p.id.startsWith('r1-'));
    const strings = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(R); walk(r1Plays.map((p) => p.callouts || []));
    const BAD = [/every (player|one|man|back)\b[^.]*\bbackfield/i, /every backfield player/i, /everyone in the backfield/i,/unless (they|he) reports?/i, /eligible if (they|he) reports?/i];
    const hits = strings.filter((s) => BAD.some((re) => re.test(s)));
    check(strings.length >= 300 && hits.length === 0, `none of ${strings.length} rank-1 strings teaches "everyone in the backfield is eligible" or "eligible if he reports" ${hits.map((s) => s.slice(0, 60)).join(' | ')}`);
    const p4 = ALL.find((q) => q.id === 'r1-u2-p4'), fp4 = CS.compile(L.PLAYS[p4.play]).byId[p4.of];
    check(p4.of === 'H' && fp4.pos === 'WR' && /receiver's number/.test(p4.why), `r1-u2-p4 asks about H, a receiver (pos ${fp4.pos}, numbered 10-19 or 80-88 by raNumber), and says why by his number too`);
  }
  // Fable 5.2 rules review against the 2026 NFL Rulebook (2026-11-11; fact sheet header). Every claim
  // it corrected away must stay gone from the fact sheet: the runoff starts at the two-minute warning
  // (RB 4-7-1), not "inside the last minute"; hashes do not divide the field into thirds (RB 1-2-2);
  // the ineligible-downfield rule applies to any forward pass (RB 8-3-1); the NFL spike exception is
  // written for under center, so "sources disagree" is gone (RB 8-2-1 Item 3); the safety kick uses
  // the dynamic-kickoff line-up (RB 6-1-3); and the kickoff-from-the-50 touchback "was the 25" is
  // wrong (RB 6-1-5). Whitespace is normalised first: "sources\n  disagree" wrapped across lines.
  // `--facts FILE` points this at another copy (how it was shown to fail on d21801f's sheet).
  {
    const FACTS = argv.includes('--facts') ? argv[argv.indexOf('--facts') + 1] : path.join(ROOT, 'docs/coachschool-facts.md');
    const facts = fs.readFileSync(FACTS, 'utf8').replace(/\s+/g, ' ');
    const GONE = ['Inside the last minute', 'dividing the field into thirds', 'crosses the LOS, an ineligible', 'sources disagree', '(not the dynamic kickoff format)', 'was the 25'];
    const still = GONE.filter((s) => facts.includes(s));
    check(still.length === 0, `the fact sheet carries none of the ${GONE.length} claims the rules review corrected away ${still.map((s) => '"' + s + '"').join(' ')}`);
    const NEW = ['After the two-minute warning of either half', 'from its own 20. It uses the same dynamic-kickoff line-up', 'unless he is still blocking a man he first hit within that yard', '### Overtime (NFL)', 'One 10-minute period (RB 16-1-3)', 'Rules review by Fable 5.2, 2026-11-11'];
    const missing = NEW.filter((s) => !facts.includes(s));
    check(missing.length === 0, `the fact sheet carries the review's corrected rules and the overtime section ${missing.map((s) => '"' + s + '"').join(' ')}`);
  }
  // Same review, rank-1 copy: Z is not always off the line (r1-v-trips puts Z on the line at the right
  // end, r1-u2-p6), so no rank-1 string states it flat. Where the play shown has Z a yard off (r1-wr,
  // r1-g-1: singleback, Z at y = -1), the line says "Here" or "in this formation"; the general card
  // says "usually". The LOS card's last bubble is held word for word to the reviewer's text.
  {
    const strings = [];
    const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
    walk(R); walk(Object.values(L.PLAYS).filter((p) => p.id.startsWith('r1-')).map((p) => p.callouts || []));
    const FLAT = [/(?<!Here |in this formation )\bZ (stands|is|lines up) (about )?a yard (off|behind)/, /\bhe stands (about )?a yard off the line/];
    const flat = strings.filter((s) => FLAT.some((re) => re.test(s)));
    check(flat.length === 0, `no rank-1 string says flat that Z stands a yard off the line ${flat.map((s) => s.slice(0, 60)).join(' | ')}`);
    const zw = CS.compile(L.PLAYS['r1-wr']).byId.Z, zg = CS.compile(L.PLAYS['r1-g-1']).byId.Z;
    check(zw.y <= -0.5 && zg.y <= -0.5, `r1-wr and r1-g-1, where the copy says "Here Z stands a yard off", really have Z off the line (y ${zw.y}, ${zg.y})`);
    const los = U.find((u) => u.id === 'r1-u2').cards.find((c) => c.title === 'The line of scrimmage');
    const b4 = los && los.say[3];
    check(!!b4 && b4.text === 'On our field the offense\'s LOS is the blue line, and we draw the two teams further apart than they really stand, which is only about a yard.', `the LOS card's 4th bubble is the rules review's wording ${b4 ? b4.text.slice(0, 50) : 'missing'}`);
  }
  // Chalk is opt-in (the dad, 2026-11-11: "don't show receiver routes unless it's relevant for that
  // puzzle or section of the lesson"). Rank 1 is names and places: no card, bubble, callout, walkthrough
  // step, puzzle or play of it asks for route or zone chalk. (Later ranks opt in with routes / zones.)
  {
    const flagged = [];
    const flag = (where, o) => { if (o && (o.routes || o.zones)) flagged.push(where); };
    for (const u of U) {
      u.cards.forEach((c, i) => { flag(`${u.id} card ${i + 1}`, c); c.say.forEach((b, j) => flag(`${u.id} card ${i + 1}.${j + 1}`, b)); });
      u.walk.forEach((w, i) => flag(`${u.id} walk ${i + 1}`, w));
    }
    ALL.forEach((q) => flag(q.id, q));
    Object.values(L.PLAYS).filter((p) => p.id.startsWith('r1-')).forEach((p) => { flag(p.id, p); (p.callouts || []).forEach((k, i) => flag(`${p.id} note ${i + 1}`, k)); });
    check(flagged.length === 0, `no rank-1 step asks for route or zone chalk ${flagged.join(', ')}`);
    check(L.PLAYS['smash-vs-c2'].routes === true && L.PLAYS['smash-vs-c2'].zones === true, 'the smash demo play opts in to its routes and zones (smash is its routes against Cover 2)');
  }
  // Variants really vary: formations / hashes, and matchups.
  const varPlays = [...new Set(U.flatMap((u) => u.puzzles.slice(2).map((q) => q.play)))].map((id) => L.PLAYS[id]);
  const setups = new Set(varPlays.map((p) => `${p.formation}|${p.hash || 'M'}|${p.mirror ? 'm' : ''}`));
  const matchups = new Set(varPlays.map((p) => p.teams.off + '-' + p.teams.def));
  check(matchups.size >= 10, 'variant plays use ' + matchups.size + ' different NFL matchups');
  check(setups.size >= 6, `variant plays span ${setups.size} formation/hash setups`);
  const teams = new Set([...used].flatMap((id) => { const p = L.PLAYS[id]; return [p.teams && p.teams.off, p.teams && p.teams.def].filter(Boolean); }));
  check(teams.size >= 16 && [...teams].every((t) => L.TEAMS[t]), `rank 1 uses ${teams.size} real NFL teams, all in TEAMS`);
  const content = JSON.stringify(R);
  check(!EMOJI.test(content), 'no emoji anywhere in rank-1 content');
  // Game Day.
  check(R.gameDay.length >= 12 && U.every((u) => R.gameDay.some((q) => q.unit === u.id)), `Game Day pool of ${R.gameDay.length} covers all 7 units`);
  const gd = CS.pickGameDay(R.gameDay, 42), gd2 = CS.pickGameDay(R.gameDay, 42);
  check(gd.length === 12 && new Set(gd.map((q) => q.id)).size === 12 && U.every((u) => gd.some((q) => q.unit === u.id)), 'pickGameDay draws 12 different questions covering all 7 units');
  check(JSON.stringify(gd.map((q) => q.id)) === JSON.stringify(gd2.map((q) => q.id)), 'pickGameDay is deterministic for a seed');
  check(CS.GAMEDAY.n === 12 && CS.GAMEDAY.pass === 10, 'Game Day is 12 questions, pass at 10');
  check(!CS.gameDayPassed(9, 12) && CS.gameDayPassed(10, 12) && CS.gameDayPassed(12, 12) && !CS.gameDayPassed(10, 11), 'Game Day: 9/12 fails, 10/12 passes, 10/11 is not a finished exam');
  const res = gd.map((q, i) => i >= 2);
  const mt = CS.missedTags(gd, res);
  check(JSON.stringify(mt) === JSON.stringify([...new Set([...gd[0].tags, ...gd[1].tags])]), `missedTags names the tags of the missed questions (${mt.join(',')})`);
  // XP and promotion from a fixture log: first try, second try, a fail, Game Day fail / pass / retake.
  const T0 = Date.UTC(2026, 10, 2, 15, 0, 0);
  const log = [
    { t: T0, kind: 'answer', tag: 'ol:names', correct: true, try: 1 },          // +10
    { t: T0 + 1, kind: 'answer', tag: 'ol:center', correct: false, try: 1 },    // +0
    { t: T0 + 2, kind: 'answer', tag: 'ol:center', correct: true, try: 2 },     // +5
    { t: T0 + 3, kind: 'answer', tag: 'ol:blind', correct: false, try: 1 },     // +0
    { t: T0 + 4, kind: 'answer', tag: 'ol:blind', correct: false, try: 2 },     // +0 (failed both tries)
    { t: T0 + 5, kind: 'answer', tag: 'bk:qb', correct: true, try: 1 },         // +10
    { t: T0 + 6, kind: 'gameday', rank: 0, passed: false },                     // +0, no promotion
    { t: T0 + 7, kind: 'gameday', rank: 0, passed: true },                      // +100, rank 1
    { t: T0 + 8, kind: 'gameday', rank: 0, passed: true },                      // retake of an old rank: +0
  ];
  // Hand total: 10 + 0 + 5 + 0 + 0 + 10 + 0 + 100 + 0 = 125.
  const s = CS.applyLog(CS.newState(), log);
  check(s.xp === 125, `rank-1 fixture log XP = 125 (got ${s.xp})`);
  check(s.rank === 1 && JSON.stringify(s.promos) === '[1]', `promotion fires once (rank ${s.rank}, promos ${JSON.stringify(s.promos)})`);
  check(CS.levelForXp(s.xp) === 2, 'coach level 2 at 125 XP');
  const back = CS.normalizeState(JSON.parse(JSON.stringify(s)));
  check(back.rank === 1 && back.xp === 125 && JSON.stringify(back.promos) === '[1]', 'the promoted state survives a save and reload');
  // Unit and Game Day locks.
  const s0 = CS.newState();
  check(CS.unitOpen(s0, U, 0) && !CS.unitOpen(s0, U, 1) && !CS.gameDayOpen(s0, U), 'fresh state: unit 1 open, unit 2 and Game Day locked');
  const s1 = CS.applyLog(s0, [{ t: T0, kind: 'unit', unit: 'r1-u1', score: 7 }]);
  check(CS.unitOpen(s1, U, 1) && !CS.unitOpen(s1, U, 2) && s1.units['r1-u1'].best === 7, 'finishing unit 1 opens unit 2 only');
  const sAll = CS.applyLog(s0, U.map((u, i) => ({ t: T0 + i, kind: 'unit', unit: u.id, score: 6 })));
  check(CS.gameDayOpen(sAll, U), 'all 7 units done opens Game Day');
  // A7. Coach bubbles point at something (the dad: "visible arrows to where the student should be
  // looking"). Every rank-1 chalk-talk bubble, every lesson callout and every walkthrough prompt has a
  // focus, and every token resolves on its own play: players that exist, groups with members, field
  // features that are in the camera's window.
  {
    const unresolved = [];
    const tryTok = (play, tok, t, where) => { const r = CS.focusOf(play, tok, t); if (!r) unresolved.push(`${where}:${tok}`); else if (r.ids && r.ids.some((id) => !CS.compile(play).byId[id])) unresolved.push(`${where}:${tok}(ids)`); else if (r.marks && r.marks.some((m) => !(m.at.y > CS.VIEW.Y0 && m.at.y < CS.VIEW.Y1 && m.at.x >= 0 && m.at.x <= CS.FIELD_W))) unresolved.push(`${where}:${tok}(off-window)`); };
    let nB = 0, nC = 0, nW = 0;
    for (const u of U) {
      for (const c of u.cards) {
        const play = L.PLAYS[c.play || u.play];
        if (!(c.say && c.say.length)) unresolved.push(`${u.id}:${c.title}: no bubbles`);
        for (const b of c.say || []) { nB++; if (!b.focus.length) unresolved.push(`${u.id}:${c.title}: a bubble points at nothing`); for (const tok of b.focus) tryTok(play, tok, -1.2, u.id + ':' + c.title); }
      }
      const lp = L.PLAYS[u.play];
      for (const k of lp.callouts) { nC++; const fs2 = Array.isArray(k.focus) ? k.focus : [k.focus]; if (!fs2.length) unresolved.push(`${lp.id}@${k.t}: nothing`); for (const tok of fs2) tryTok(lp, tok, k.t, lp.id + '@' + k.t); }
      for (const w of u.walk) { nW++; if (!(w.look && w.look.length)) unresolved.push(`${u.id} walk: no look`); for (const tok of w.look || []) tryTok(lp, tok, -1.2, u.id + ' walk'); if ((w.look || []).includes(w.answer)) unresolved.push(`${u.id} walk points at its own answer ${w.answer}`); }
    }
    check(nB >= 60 && nC === 21 && nW === 18 && unresolved.length === 0, `every one of ${nB} chalk-talk bubbles, ${nC} callouts and ${nW} walkthrough prompts points at something that resolves (none at its own answer) ${unresolved.slice(0, 6).join(', ')}`);
    // The resolver itself, by hand. r1-field: ball on the left hash at the opponent's 18 (spot 82).
    const RF = L.PLAYS['r1-field'];
    const hl = CS.focusOf(RF, 'hash:L', -1.2), rz = CS.focusOf(RF, 'redzone', -1.2), nm = CS.focusOf(RF, 'numbers:L', -1.2), fsd = CS.focusOf(RF, 'field', -1.2);
    check(hl.marks[0].at.x === 23.58 && Math.abs((82 + hl.marks[0].at.y) % 5) > 0, `hash:L points at a real tick on x 23.58 (yard line ${82 + hl.marks[0].at.y}, not a 5-yard line)`);
    // Red zone: opponent's 20 = absolute 80 = y 80 - 82 = -2; goal line 100 - 82 = 18; the window ends at 19.57.
    check(rz.marks[0].at.y === -2 && rz.marks[0].hl.y0 === -2 && rz.marks[0].hl.y1 === 18, `redzone runs from the 20 (y -2) to the goal line (y 18) (${rz.marks[0].hl.y0}..${rz.marks[0].hl.y1})`);
    // Far numbers centred on x 13; nearest 10-yard line to the LOS in the window is absolute 80 (the "20"): y -2.
    check(nm.marks[0].at.x === 13 && nm.marks[0].at.y === -2, `numbers:L is the far-side "20" at (13, -2) (${nm.marks[0].at.x}, ${nm.marks[0].at.y})`);
    // Ball on the left hash: the field (wide) side is the right, x from 23.58 + 1.5 to 53.33.
    check(Math.abs(fsd.frame.x0 - 25.08) < 1e-9 && fsd.frame.x1 === 53.33, `field side with the ball on the left hash is x 25.08..53.33 (${fsd.frame.x0}..${fsd.frame.x1})`);
    check(CS.focusOf(L.PLAYS['r1-ol'], 'field', -1.2) === null && CS.focusOf(L.PLAYS['r1-ol'], 'redzone', -1.2) === null && CS.focusOf(RF, 'nobody', -1.2) === null, 'no field side with the ball in the middle, no red zone at the own 25, unknown tokens resolve to null');
    const ol = CS.focusOf(L.PLAYS['r1-ol'], 'ol', -1.2);
    check(ol.bracket && JSON.stringify(ol.ids.slice().sort()) === JSON.stringify(['C', 'LG', 'LT', 'RG', 'RT']), 'the OL group is the five linemen, bracketed');
    // The camera, by hand. W 400, H 836. A rect x 100..140, y 400..490 with a 40 px margin:
    // 400 / (40 + 80) = 3.33, 836 / (90 + 80) = 4.92 -> 3.33, capped at zmax 3, stepped to 3.
    // Centre (120, 445); at z 3 the half view is 66.7 x 139.3, so the centre is already legal.
    const cf = CS.camFrame({ x0: 100, x1: 140, y0: 400, y1: 490 }, 400, 836, { margin: 40, zmax: 3, step: 0.25 });
    check(cf.z === 3 && cf.cx === 120 && cf.cy === 445, `camFrame zooms a 40x90 px box to z 3 centred on it (${JSON.stringify(cf)})`);
    // A wide box: 400 / (300 + 80) = 1.05 -> floor to the 0.25 step -> 1.
    check(CS.camFrame({ x0: 50, x1: 350, y0: 100, y1: 140 }, 400, 836, { margin: 40 }).z === 1, 'a box nearly the window wide gets no zoom');
    // fill 0.55: a tall column (the seven on the line, 300 px) may take at most 55% of the view's height:
    // 0.55 * 836 / 300 = 1.53 -> step 1.5 (without fill it would be 836 / 380 = 2.2 -> 2, leaving no room for its bubble).
    check(CS.camFrame({ x0: 120, x1: 140, y0: 100, y1: 400 }, 400, 836, { margin: 40, fill: 0.55 }).z === 1.5 && CS.camFrame({ x0: 120, x1: 140, y0: 100, y1: 400 }, 400, 836, { margin: 40 }).z === 2, 'fill keeps a tall target to 55% of the view (z 1.5, not 2)');
    // A corner box clamps: x 0..20, y 0..20 at z 3 -> centre clamped to (66.67, 139.33).
    const cc = CS.camFrame({ x0: 0, x1: 20, y0: 0, y1: 20 }, 400, 836, { margin: 40 });
    check(near(cc.cx, 400 / 6, 1e-9) && near(cc.cy, 836 / 6, 1e-9), `a corner target clamps the camera inside the world (${cc.cx.toFixed(2)}, ${cc.cy.toFixed(2)})`);
    check(CS.ease(0) === 0 && CS.ease(1) === 1 && CS.ease(0.5) === 0.5 && near(CS.ease(0.25), 0.0625, 1e-12), 'ease: 0, 1, 0.5 -> 0.5, 0.25 -> 4 * 0.25^3 = 0.0625');
    const A = { cx: 200, cy: 418, z: 1 }, Bc = { cx: 120, cy: 445, z: 3 }, mid = CS.camLerp(A, Bc, 0.5);
    check(near(mid.z, Math.sqrt(3), 1e-12) && mid.cx === 160 && near(mid.cy, 431.5, 1e-9), `camLerp halfway: zoom sqrt(3) (geometric), centre halfway (${mid.z.toFixed(4)}, ${mid.cx}, ${mid.cy})`);
    // Bubble placement: a 300 x 600 box, a target in the middle; the bubble avoids it and stays inside.
    const tgt = { rect: { l: 140, r: 160, t: 290, b: 330 }, pt: { x: 150, y: 310 } };
    const pb = CS.placeBubble({ W: 300, H: 600, w: 260, h: 80, targets: [tgt], avoid: [], pad: 6, gap: 38 });
    const inter = (b, r) => b.x < r.r && b.x + 260 > r.l && b.y < r.b && b.y + 80 > r.t;
    check(pb.ok && !inter(pb, tgt.rect) && pb.x >= 6 && pb.y >= 6 && pb.x + 260 <= 294 && pb.y + 80 <= 594, `placeBubble keeps off its target and inside the box (${pb.x}, ${pb.y})`);
    // A target hugging the top: the only room is below it.
    const top = { rect: { l: 100, r: 200, t: 0, b: 520 }, pt: { x: 150, y: 260 } };
    const pt2 = CS.placeBubble({ W: 300, H: 600, w: 260, h: 60, targets: [top], avoid: [], pad: 6, gap: 38 });
    check(pt2.ok && pt2.y >= 520, `a target filling the top 520 px puts the bubble under it (y ${pt2.y})`);
    const tl = CS.tailOf({ x: 20, y: 100, w: 200, h: 60 }, { x: 150, y: 260 }, 9);
    check(tl.y0 === 160 && tl.x0 === 150 && near(Math.hypot(150 - tl.x1, 260 - tl.y1), 9, 1e-9), `tailOf leaves the bubble's bottom edge and stops 9 px short (${JSON.stringify(tl)})`);
    // The spotlight (the dad, at the OL card: the DL a yard off the ball overlapped the five and they
    // read as a pile). A group lights exactly its members, a player himself, players and groups
    // together their union; a field feature lights nobody (null = nobody fades).
    const OLP = L.PLAYS['r1-ol'], sp = (f) => { if (typeof CS.spotIds !== 'function') return 'missing'; const s = CS.spotIds(OLP, f, -1.2); return s ? [...s].sort().join() : null; };
    check(sp('ol') === 'C,LG,LT,RG,RT' && sp('C') === 'C' && sp(['LT', 'RT']) === 'LT,RT' && sp(['ol', 'QB']) === 'C,LG,LT,QB,RG,RT', `spotIds: ol -> the five, C -> C, [LT, RT] -> both, [ol, QB] -> six (${sp(['ol', 'QB'])})`);
    check(sp('hashes') === null && sp('los') === null && sp('ball') === null && sp(['los', 'C']) === 'C', 'spotIds: field features alone light nobody; a feature beside a player lights the player');
    // Opacity on the camera's ease: 1 -> 0.32 at u 0.5 is 1 - 0.68 * 0.5 = 0.66; at u 0.25, 1 - 0.68 * 0.0625 = 0.9575.
    check(typeof CS.spotAlpha === 'function' && CS.SPOT_FADE === 0.32 && near(CS.spotAlpha(1, 0.32, 0.5), 0.66, 1e-12) && near(CS.spotAlpha(1, 0.32, 0.25), 0.9575, 1e-12) && near(CS.spotAlpha(1, 0.32, 1), 0.32, 1e-12) && CS.spotAlpha(0.32, 1, 0) === 0.32, 'spotAlpha: 0.66 halfway, 0.9575 a quarter in (ease 0.0625), ends on 0.32');
  }

  // Reading text is never drawn with the 8-bit font (dad's directive): no pixel-text helper left in the drawing code.
  const fieldSrc = fs.readFileSync(path.join(ROOT, 'assets/coachschool/cs-field.js'), 'utf8'), uiSrc = fs.readFileSync(path.join(ROOT, 'assets/coachschool/cs-ui.js'), 'utf8');
  check(!/pixText\s*\(/.test(fieldSrc) && !/pixText\s*\(/.test(uiSrc), 'no pixText( in cs-field.js or cs-ui.js: callouts, cards and prompts use the body font');

  // A-art. The 8-bit players are production's (the dad, 2026-11-11, at his phone's Scores view: phases
  // 1-2 had copied an older, unmerged sd-reenact.js, and the players were "not the production retro
  // models"). Production's file is a page script (DOM, the Scores state, idle callbacks at top level),
  // so the parts that make a player are cut out of it by their declarations and run in a vm with the
  // one helper they call (clamp); the copy is cs-field.js run as the page runs it, read through
  // CS._art. Same input, same output: the rasterised 34x40 grid of shade codes for a stance, a run
  // frame, the pass release and follow-through, the catch, the ball pulled in, a block and a fall;
  // the hand positions the ball is drawn at; the kit, helmet-logo and facemask tables.
  console.log('\n[A-art] the copied 8-bit art matches production (sd-reenact.js)');
  {
    const prod = fs.readFileSync(path.join(ROOT, 'assets/sunday/sd-reenact.js'), 'utf8');
    const cut = (from, to) => { const a = prod.indexOf(from), b = prod.indexOf(to, a); return a >= 0 && b > a ? prod.slice(a, b) : ''; };
    const src = [
      cut('const RA_SKEL = {', '\n// Every player frame is rasterised'),
      cut('const RA_KITS = {', '\n// The helmet shell, by ESPN'),
      cut('const RA_MASK =', '\nconst raShade'),
      cut('const RA_HOLD = {};', '\n// A man\'s shadow'),
    ];
    let P = null, why = '';
    try {
      const pc = vm.createContext({ Math, clamp: (v, a, b) => Math.max(a, Math.min(b, v)) });
      vm.runInContext(src.join('\n') + '\n;globalThis.__P = { raFig, RA_SKEL, RA_KITS, RA_LOGO, RA_LOGO_BOX, RA_MASK, RA_HOLD };', pc, { filename: 'sd-reenact.js (cut)' });
      P = pc.__P;
    } catch (e) { why = e.message; }
    check(P && src.every((s) => s.length > 20), `production's player art runs in a vm (${why || 'raFig, RA_SKEL, RA_KITS, RA_LOGO, RA_MASK, RA_HOLD'})`);
    const fc = vm.createContext({});
    for (const f of ['cs-core.js', 'cs-lib.js', 'cs-field.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/coachschool', f), 'utf8'), fc, { filename: f });
    const C = fc.CS._art || {};
    const field = fs.readFileSync(path.join(ROOT, 'assets/coachschool/cs-field.js'), 'utf8');
    if (P) {
      const poses = ['stance', 'run3', 'jog6', 'back2', 'throw2', 'throw3', 'catch', 'secure', 'block2', 'fall1'];
      const diff = poses.filter((k) => { try { const a = C.raFig(k, 'p'), b = P.raFig(k, 'p'); return a.g.join('') !== b.g.join('') || JSON.stringify(a.num) !== JSON.stringify(b.num) || JSON.stringify(a.hl) !== JSON.stringify(b.hl); } catch (e) { return true; } });
      check(typeof C.raFig === 'function' && diff.length === 0, `raFig grids (shade codes, number spot, helmet cells) equal production's for ${poses.join(', ')}${diff.length ? ' -- differ: ' + diff.join(', ') : ''}`);
      const keysEq = C.RA_SKEL && Object.keys(C.RA_SKEL).sort().join() === Object.keys(P.RA_SKEL).sort().join();
      check(keysEq && Object.keys(P.RA_SKEL).length === 82, `the same ${Object.keys(P.RA_SKEL).length} rigged frames as production (6 gaits x 8 + the set poses)`);
      check(JSON.stringify(C.RA_HOLD) === JSON.stringify(P.RA_HOLD), 'the ball sits in the same hand spot as production in every frame (RA_HOLD)');
      check(JSON.stringify(C.RA_KITS) === JSON.stringify(P.RA_KITS) && JSON.stringify(C.RA_LOGO) === JSON.stringify(P.RA_LOGO) && Object.keys(P.RA_LOGO).length >= 30, `kits and all ${Object.keys(P.RA_LOGO).length} helmet logos equal production's`);
      check(new RegExp(`const RA_MASK = '${P.RA_MASK}'`).test(field) && /m: RA_MASK/.test(field), `facemasks are production's one light grey (${P.RA_MASK})`);
    }
  }
}

// A8. The neutral zone drawn wide (CS.spreadOf), by hand. The dad's phone (2026-11-11, the LOS card,
// bubble 4): the defensive line, set 1 yd off the ball per the fact sheet (1c), painted over the
// offensive line, because a lineman's stance sprite reaches 15 world px in front of his feet and a
// yard is 14 px. Fixture extents (world px from the feet; the real ones are measured in B20): every
// lineman and the tight end {l 10, r 15, t 20, b 1} facing right (a defender, facing left, mirrored:
// {l 15, r 10}); everyone else {l 6, r 11, t 32, b 0} (mirrored likewise). r1-los is the I-form with
// the QB under center against the 4-3 Over.
console.log('\n[A8] the neutral zone drawn wide');
check(typeof CS.spreadOf === 'function' && typeof CS.showAt === 'function' && typeof CS.spreadW === 'function', 'CS.spreadOf / CS.spreadW / CS.showAt exist (the one place the picture spreads the yards)');
if (typeof CS.spreadOf === 'function') {
  const play = L.PLAYS['r1-los'], c = CS.compile(play), PXa = 14, PYa = 15;
  const LINE = ['C', 'G', 'T', 'TE', 'DE', 'DT', 'NT'];
  const ext = (p) => { const k = LINE.includes(p.pos) ? { l: 10, r: 15, t: 20, b: 1 } : { l: 6, r: 11, t: 32, b: 0 }; return p.team === 'def' ? { l: k.r, r: k.l, t: k.t, b: k.b } : k; };
  const sp = CS.spreadOf(c, ext, PXa, PYa);
  // Step 1 by hand. Offense: its frontmost painted edge is a lineman's, 0 + 15, so the team slides back
  // 15 + NZ_PAD 3 = 18 px = 18/14 yd. Defense: its hindmost edge is a DL's, 14 - 15 = -1, so it slides
  // forward 3 - (-1) = 4 px = 4/14 yd.
  check(near(CS.NZ_PAD, 3) && ['LT', 'LG', 'C', 'RG', 'RT', 'X', 'Y', 'Z', 'FB', 'RB'].every((id) => near(sp[id].dy, -18 / 14, 1e-9) && sp[id].dx === 0), `the offense slides back 18 px (${(18 / 14).toFixed(3)} yd), all of it the same, nobody across (LT ${sp.LT.dy.toFixed(3)})`);
  check(c.def.every((p) => near(sp[p.id].dy, 4 / 14, 1e-9) && sp[p.id].dx === 0), `the defense slides forward 4 px (${(4 / 14).toFixed(3)} yd), all of it the same (DT ${sp[c.def.find((p) => p.pos === 'DT').id].dy.toFixed(3)})`);
  // Step 2 by hand. The QB under center (1 yd = 14 px behind the C) after the shift: C at -18 paints
  // [-28, -3], QB at -32 paints [-38, -21]: 8 px of overlap counting the 1 px gap (-21 - (-28) + 1),
  // and their rows overlap far more, so he moves back along the field by 8: 26 px in all.
  check(near(sp.QB.dy, -26 / 14, 1e-9) && sp.QB.dx === 0, `the QB under center moves off the center's seat: back 26 px (${(26 / 14).toFixed(3)} yd), got ${(sp.QB.dy * 14).toFixed(2)} px`);
  // The rule's promises, on every library play with the same fixture: no two painted boxes intersect,
  // nobody's sprite enters the neutral zone (NZ_PAD px either side of the LOS), nobody moves toward the
  // line, and order is kept along and across the field inside each team.
  const probs = [];
  for (const P of Object.values(L.PLAYS)) {
    const cc = CS.compile(P), s = CS.spreadOf(cc, ext, PXa, PYa), B = {};
    for (const p of cc.all) { const e = ext(p), X = (p.y + s[p.id].dy) * PXa, Y = (p.x + s[p.id].dx) * PYa; B[p.id] = { l: X - e.l, r: X + e.r, t: Y - e.t, b: Y + e.b, p, X, Y }; }
    const ids = Object.keys(B);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = B[ids[i]], b = B[ids[j]];
      if (Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1e-6 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1e-6) probs.push(`${P.id}: ${ids[i]}/${ids[j]} intersect`);
      if (a.p.team === b.p.team && ((a.p.y < b.p.y - 1e-9 && a.X > b.X + 1e-9) || (a.p.x < b.p.x - 1e-9 && a.Y > b.Y + 1e-9))) probs.push(`${P.id}: ${ids[i]}/${ids[j]} swapped order`);
    }
    for (const b of Object.values(B)) {
      if (b.p.team === 'off' ? b.r > -CS.NZ_PAD + 1e-6 : b.l < CS.NZ_PAD - 1e-6) probs.push(`${P.id}: ${b.p.id} in the neutral zone`);
      if (b.p.team === 'off' ? s[b.p.id].dy > 1e-9 : s[b.p.id].dy < -1e-9) probs.push(`${P.id}: ${b.p.id} moved toward the line`);
    }
  }
  check(probs.length === 0, `on all ${Object.keys(L.PLAYS).length} library plays: no two boxes intersect, the neutral zone is clear, nobody moves toward the line, order kept ${probs.slice(0, 4).join(' | ')}`);
  // The spread holds to the snap and is gone SPREAD_T (0.5 s) after it; at t 0.25 it is half on (the
  // ease is symmetric); from then on CS.showAt is CS.poseAt exactly.
  check(CS.spreadW(c, -1) === 1 && CS.spreadW(c, c.snapT) === 1 && near(CS.spreadW(c, c.snapT + 0.25), 0.5, 1e-9) && CS.spreadW(c, c.snapT + 0.5) === 0, 'the spread is all on before the snap, half at +0.25 s, gone at +0.5 s');
  const late = CS.showAt(play, 1.0, sp), truth = CS.poseAt(play, 1.0);
  check(Object.keys(truth.players).every((id) => late.players[id].x === truth.players[id].x && late.players[id].y === truth.players[id].y), 'a second after the snap every man is drawn on his yards');
  const pre = CS.showAt(play, -1, sp);
  check(near(pre.players.C.y, -18 / 14, 1e-9) && pre.ball.y === 0, 'before the snap the ball stays on the spot (y 0) while the center is drawn behind the line');
}

/* ═════════════ check modules (tools/coachschool-checks/*.mjs) ═════════════ */
const MOD_DIR = path.join(HERE, 'coachschool-checks');
const MODS = [];
if (fs.existsSync(MOD_DIR)) {
  for (const f of fs.readdirSync(MOD_DIR).filter((x) => x.endsWith('.mjs')).sort()) {
    const name = f.replace(/\.mjs$/, '');
    if (ONLY && !ONLY.includes(name)) continue;
    MODS.push({ name, mod: await import(new URL('coachschool-checks/' + f, import.meta.url).href) });
  }
}
const H = { CS, L, ctx, loadVm, check, near, ROOT, PLATES, J: JSON.stringify, FILES };
// Every type file on disk must be on the page too (each agent swaps its own placeholder line in
// coachschool.html for its script tag), or the page would never register it.
{
  const html = fs.readFileSync(path.join(ROOT, 'coachschool.html'), 'utf8');
  const pz = FILES.filter((f) => /^cs-pz-/.test(f)), missing = pz.filter((f) => !html.includes(`<script src="assets/coachschool/${f}"></script>`));
  check(missing.length === 0, `every puzzle-type file (${pz.join(', ')}) has its script tag on the page ${missing.join(', ')}`);
}
for (const { name, mod } of MODS) {
  if (!mod.node) continue;
  console.log(`\n[A-${name}] tools/coachschool-checks/${name}.mjs`);
  try { await mod.node(H); } catch (e) { check(false, `${name}: node checks crashed: ${e.stack || e}`); }
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
    if (opts.init) await page.evaluateOnNewDocument(opts.init);
    await page.setRequestInterception(true);
    page.on('request', (r) => { if (/googleapis|gstatic|firebase|firestore/.test(r.url())) { blocked.push(r.url()); r.abort(); } else r.continue(); });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
    // Seed localStorage once per tab (a reload must find what the page saved, not the seed again).
    if (opts.storage) await page.evaluateOnNewDocument((kv) => { if (!sessionStorage.getItem('__seeded')) { localStorage.clear(); for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, opts.storage);
    // RESTAGED in phase 2: the page now opens on the career map; phase 1's engine screen lives on at #demo,
    // and every phase-1 check below still runs against it there.
    await page.goto(BASE + '/coachschool.html' + ('hash' in opts ? opts.hash : '#demo'), { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => !!window.__CS__, { timeout: 10000 });
    return { page, errors };
  }
  const plate = async (page, name) => { if (PLATES) { fs.mkdirSync(PLATES, { recursive: true }); await page.screenshot({ path: path.join(PLATES, name) }); console.log('  plate ' + path.join(PLATES, name)); } };
  const settleP = (pg, ms = 120) => pg.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  try {
    if (!ONLY) await legacyB();
    for (const { name, mod } of MODS) {
      if (!mod.browser) continue;
      console.log(`\n[B-${name}] tools/coachschool-checks/${name}.mjs`);
      try { await mod.browser({ ...H, open, plate, settle: settleP, BASE, browser }); } catch (e) { check(false, `${name}: browser checks crashed: ${e.stack || e}`); }
    }
  } finally {
    await browser.close();
    server.close();
  }
  async function legacyB() {
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
    // RESTAGED in phase 2: the field is now the tall Tecmo camera (400x836 world px) sized by fit() to the
    // largest box of that shape inside its flex area, so on a phone it is height-bound and narrower than the
    // column. The rule now: it fills its box in one dimension and never overflows it.
    const dbox = await page.evaluate(() => { const r = document.getElementById('demoBox').getBoundingClientRect(); return { w: r.width, h: r.height }; });
    check((Math.abs(boot.cv.w - dbox.w) <= 2 || Math.abs(boot.cv.h - dbox.h) <= 2) && boot.cv.w <= dbox.w + 1 && boot.cv.h <= dbox.h + 1 && boot.cv.b <= 844, `field canvas fills its box in one dimension (${boot.cv.w.toFixed(0)}x${boot.cv.h.toFixed(0)} in ${dbox.w.toFixed(0)}x${dbox.h.toFixed(0)})`);
    check(blocked.some((u) => /googleapis/.test(u)), 'the Google Fonts request was blocked and the page still booted');
    await plate(page, 'cs-presnap-390.png');

    // B2. [hidden] overlays have no geometry; opening one gives it geometry.
    console.log('\n[B2] hidden overlays');
    // RESTAGED in phase 2: the mute button's hidden "cross" stroke is an SVG <path>, and SVG elements have no
    // offsetParent at all (undefined, not null). For those the test is computed display none plus a zero box;
    // every HTML element is still held to offsetParent === null.
    const hid = await page.evaluate(() => [...document.querySelectorAll('[hidden]')].map((e) => ({ id: e.id || e.tagName + '.' + e.getAttribute('class'), gone: (e instanceof SVGElement ? getComputedStyle(e).display === 'none' : e.offsetParent === null) && e.getBoundingClientRect().height === 0 })));
    check(hid.length >= 1 && hid.some((h) => h.id === 'legend'), `there is a hidden overlay to test (${hid.map((h) => h.id).join(',')})`);
    check(hid.every((h) => h.gone), `every [hidden] element has offsetParent === null and no height ${hid.filter((h) => !h.gone).map((h) => h.id).join(',')}`);
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
        // RESTAGED 2026-11-11 (the neutral zone drawn wide, CS.spreadOf): before the snap a man is DRAWN off
        // his fact-sheet yards (the offense slid back, the defense forward, so no two sprites overlap), and
        // the spread eases out over the first 0.5 s after it. The round trip now starts from where he is
        // drawn (the field's own CS.showAt), which is what a tap lands on; at t >= 0.5 the two are equal.
        const pose = C.field.shown || CS.poseAt(C.play, C.t);   // (a build without CS.showAt: the yards)
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
      const pose = C.field.shown || CS.poseAt(C.play, C.t), pts = Object.entries(pose.players).map(([id, q]) => ({ id, ...C.yardToScreen(q.x, q.y) }));
      // The most isolated player: tap 22 CSS px straight above his feet.
      let best = null;
      for (const p of pts) { const nn = Math.min(...pts.filter((o) => o !== p).map((o) => Math.hypot(o.x - p.x, o.y - p.y))); if (!best || nn > best.nn) best = { ...p, nn }; }
      return { r: C.hitRadius, id: best.id, nn: best.nn, hit22: C.hitTest(best.x, best.y - 22), hitFar: C.hitTest(best.x, best.y - 60) };
    });
    check(rad.r >= 22 && rad.hit22 === rad.id, `hit radius >= 22 CSS px: a tap 22 px above ${rad.id}'s feet still hits him (radius ${rad.r})`);
    check(rad.nn > 60 ? rad.hitFar === null : true, 'a tap well clear of everyone hits nobody');
    // A real tap, through the touch screen, names the player.
    const mikeAt = await page.evaluate(() => { const C = window.__CS__, q = (C.field.shown || window.CS.poseAt(C.play, C.t)).players.MIKE;   /* drawn spot (RESTAGED with B4) */ return C.yardToScreen(q.x, q.y); });
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
    /* ── Phase 2: the Intern rank, played through the real screens ── */
    const PHONE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
    const USER = { choreUser: 'Testy' };
    const KEY = 'cs_state_v1_Testy';
    const layout = (pg) => pg.evaluate(() => {
      const w = document.getElementById('fieldWrap').getBoundingClientRect();
      return { sh: document.documentElement.scrollHeight, sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth, fw: w.width, fh: w.height, fb: w.bottom,
        panelClip: (() => { const p = document.getElementById('stPanel'); return p.scrollHeight - p.clientHeight; })(),
        actBottom: document.getElementById('stActions').getBoundingClientRect().bottom };
    });
    const fits = (L) => L.sh <= L.ih && L.sw <= L.iw && L.fh >= 200 && L.panelClip <= 1 && L.actBottom <= L.ih;
    const mode = (pg) => pg.evaluate(() => window.__CS__.ui.mode);
    // Coach bubbles (phase 2b): the camera eases for ~0.5 s before a bubble shows; wait it out.
    // RESTAGED (spotlight): the fade on everyone a bubble isn't about eases with the camera, and also
    // runs when the camera has nowhere to go (two bubbles with one framing), so "settled" now waits
    // for both. Without it the spotlight checks would read a frame mid-fade.
    const still = (pg) => pg.waitForFunction(() => !window.__CS__.field.camAnimating && !(window.__CS__.spot && window.__CS__.spot.animating), { timeout: 5000 }).then(() => settle(pg, 30));
    // The words a player is shown after an answer: the coach bubble when there is one, else the panel line.
    const fbText = (pg) => pg.evaluate(() => { const b = document.getElementById('bubble'); const t = b && b.offsetParent !== null ? b.textContent : document.getElementById('stFb').innerText; return t.replace(/\s+/g, ' ').trim(); });
    const settle = (pg, ms = 120) => pg.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), ms);
    // A real touch on a player's painted sprite: the centre of his opaque bounding box.
    const tapPlayer = async (pg, id, where = 'centre') => {
      const r = await pg.evaluate((id) => { const q = window.__CS__.spriteRect(id); return { x: q.left, y: q.top, w: q.right - q.left, h: q.bottom - q.top }; }, id);
      const x = r.x + r.w / 2, y = where === 'feet' ? r.y + r.h - 1 : r.y + r.h / 2;
      await pg.touchscreen.tap(x, y);
      await settle(pg, 60);
      return { x, y };
    };
    const measure2 = (pg) => pg.evaluate(() => { const g = window.__CS__.coach; return g ? { tone: g.tone, targets: g.targets, text: document.getElementById('bubble').textContent.replace(/\s+/g, ' ') } : null; });
    const visibleSmall = (pg) => pg.evaluate(() => [...document.querySelectorAll('button, a, input')].filter((e) => e.offsetParent !== null && !e.closest('[hidden]')).map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((r) => r.w < 44 || r.h < 44));
    const EMOJI2 = /\p{Extended_Pictographic}/u;
    const textEmoji = (pg) => pg.evaluate(() => document.body.innerText).then((t) => EMOJI2.test(t));

    // B8. The career map: seven ranks, only the Intern's open, his first unit the only door.
    console.log('\n[B8] career map');
    {
      const { page: pm, errors: em } = await open(PHONE, { hash: '#map', storage: USER });
      const m = await pm.evaluate(() => ({
        titles: [...document.querySelectorAll('#ranks .rank .rtitle')].map((e) => e.textContent),
        locked: [...document.querySelectorAll('#ranks .rank')].map((e) => e.classList.contains('locked')),
        units: [...document.querySelectorAll('#ranks button[data-unit]')].map((b) => ({ id: b.dataset.unit, off: b.disabled })),
        gd: document.getElementById('btnGameDay').disabled, ranks: window.CS.RANKS, screen: window.__CS__.ui.screen, key: window.__CS__.ui.key,
      }));
      check(m.screen === 'scrMap' && m.key === KEY, `the page opens on the career map, keyed to the chore user (${m.key})`);
      check(m.titles.length === 7 && JSON.stringify(m.titles) === JSON.stringify(m.ranks), `7 ranks with their titles (${m.titles.join(' / ')})`);
      check(!m.locked[0] && m.locked.slice(1).every(Boolean), 'only the Intern rank is open; ranks 2-7 are locked but show their titles');
      check(m.units.length === 7 && !m.units[0].off && m.units.slice(1).every((u) => u.off) && m.gd, 'unit 1 open; units 2-7 and Game Day locked');
      const L0 = await pm.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth }));
      check(L0.sh <= L0.ih && L0.sw <= 390, `no page scroll on the map (content ${L0.sw}x${L0.sh}; the rank list scrolls inside its screen)`);
      const sm = await visibleSmall(pm);
      check(sm.length === 0, `map controls are at least 44x44 ${JSON.stringify(sm)}`);
      check(!(await textEmoji(pm)), 'no emoji on the map');
      await plate(pm, 'cs2-career-map.png');
      check(em.length === 0, `zero page errors on the map ${JSON.stringify(em)}`);
      await pm.close();
    }

    // B9. Every step of every unit fits a 390x844 phone with no page scroll; the field keeps 200 px or more.
    console.log('\n[B9] every lesson step fits the phone');
    {
      const { page: pl, errors: el } = await open(PHONE, { hash: '#map', storage: USER });
      const unitIds = await pl.evaluate(() => window.CS.RANK_DATA[0].units.map((u) => ({ id: u.id, cards: u.cards.length, walk: u.walk.map((w) => window.CS.puzzleTypes.tap.truth({ id: 'w', type: 'tap', play: u.play, find: w.find, answer: w.answer })) })));
      const bad = [];
      let steps = 0, minField = Infinity, walkTaps = 0, walkOk = 0;
      for (const u of unitIds) {
        await pl.evaluate((id) => { location.hash = '#unit/' + id; }, u.id);
        await settle(pl);
        // RESTAGED (coach bubbles): a card is now a run of 1-4 bubbles and Next walks them, so the
        // step count is the number of bubbles, not cards. Every bubble screen is held to the same fit rule.
        for (let i = 0; i < 40; i++) {
          const mc = await mode(pl);
          if (mc.kind !== 'card') break;
          const L = await layout(pl); steps++; minField = Math.min(minField, L.fh);
          if (!fits(L)) bad.push(`${u.id} card step ${mc.step} bubble ${mc.bubble}: ${JSON.stringify(L)}`);
          await pl.evaluate(() => window.__CS__.ui.next()); await settle(pl, 40);
        }
        const mw = await mode(pl);
        if (mw.kind !== 'watch') bad.push(`${u.id}: expected the watch step, got ${mw.kind}`);
        await pl.evaluate(() => window.__CS__.ui.next());             // play: it stops at the first note
        await settle(pl, 1300);
        const Lw = await layout(pl); steps++; minField = Math.min(minField, Lw.fh);
        if (!fits(Lw)) bad.push(`${u.id} watch: ${JSON.stringify(Lw)}`);
        if (u.id === 'r1-u3') await plate(pl, 'cs2-watch-callout.png');
        // Run to the end, then on to the walkthrough.
        await pl.evaluate(() => { const C = window.__CS__; C.field.pause(); C.seek(C.T - 0.02); C.field.start(); });
        await settle(pl, 250);
        await pl.evaluate(() => window.__CS__.ui.next()); await settle(pl, 60);
        const mk = await mode(pl);
        if (mk.kind !== 'walk') bad.push(`${u.id}: expected the walkthrough, got ${mk.kind}`);
        for (let j = 0; j < u.walk.length; j++) {
          const Lk = await layout(pl); steps++; minField = Math.min(minField, Lk.fh);
          if (!fits(Lk)) bad.push(`${u.id} walk ${j + 1}: ${JSON.stringify(Lk)}`);
          await still(pl);
          await tapPlayer(pl, u.walk[j]); walkTaps++;
          // RESTAGED (coach bubbles): "Right." is now a green bubble on the player, not the panel line.
          const got = await pl.evaluate(() => window.__CS__.saying);
          if (got && got.tone === 'good') walkOk++;
          await pl.evaluate(() => window.__CS__.ui.next()); await settle(pl, 60);
        }
        const mp = await mode(pl);
        if (mp.kind !== 'puzzle') bad.push(`${u.id}: expected the puzzles, got ${mp.kind}`);
        // The tallest puzzle screen: a choice question after its answer, options plus the explanation.
        let k = 0;
        for (;;) {
          const cur = await mode(pl);
          if (!cur || cur.kind !== 'puzzle') break;
          await pl.evaluate(() => window.__CS__.ui.answer(false)); await settle(pl, 30);
          const c2 = await mode(pl);
          if (!c2.done) { await pl.evaluate(() => window.__CS__.ui.answer(false)); await settle(pl, 30); }
          const Lp = await layout(pl); steps++; minField = Math.min(minField, Lp.fh);
          if (!fits(Lp)) bad.push(`${u.id} puzzle ${k + 1} reveal: ${JSON.stringify(Lp)}`);
          await pl.evaluate(() => window.__CS__.ui.next()); await settle(pl, 30);
          k++;
        }
        const md = await mode(pl);
        if (md.kind !== 'unitdone') bad.push(`${u.id}: expected the unit result, got ${md && md.kind}`);
      }
      check(bad.length === 0, `${steps} lesson screens across 7 units fit 390x844 with no page scroll, panel unclipped, field >= 200 px (smallest ${minField.toFixed(0)}) ${bad.slice(0, 3).join(' | ')}`);
      check(walkTaps >= 14 && walkOk === walkTaps, `every walkthrough step answers to a real tap on the player's sprite (${walkOk}/${walkTaps})`);
      const st = await pl.evaluate(() => window.__CS__.ui.state);
      check(Object.keys(st.units).length === 7 && st.xp === 0, `all 7 units recorded done; answering wrong twice everywhere earned 0 XP (xp ${st.xp})`);
      check(st.seenPlays.length === 7, `7 lesson plays reached the film room (${st.seenPlays.length})`);
      await pl.evaluate(() => { location.hash = '#map'; }); await settle(pl);
      check(!(await pl.evaluate(() => document.getElementById('btnGameDay').disabled)), 'with every unit done, Game Day opens on the map');
      check(el.length === 0, `zero page errors through the lessons ${JSON.stringify(el.slice(0, 3))}`);
      await pl.close();
    }

    // B10. The offensive line: five linemen and the tight end, each hit-testable at his own sprite on a 390 phone.
    console.log('\n[B10] the offensive line on a phone');
    {
      const { page: po, errors: eo } = await open(PHONE, { hash: '#unit/r1-u3/puzzles', storage: USER });
      await settle(po);
      const g = await po.evaluate(() => {
        const C = window.__CS__, ids = ['LT', 'LG', 'C', 'RG', 'RT', 'Y'], out = {};
        for (const id of ids) {
          const q = C.spriteRect(id), r = { x: q.left, y: q.top, w: q.right - q.left, h: q.bottom - q.top };
          out[id] = { r, centre: C.hitTest(r.x + r.w / 2, r.y + r.h / 2), feet: C.hitTest(r.x + r.w / 2, r.y + r.h - 1) };
        }
        return out;
      });
      const wrongHits = Object.entries(g).filter(([id, v]) => v.centre !== id || v.feet !== id).map(([id, v]) => `${id}->${v.centre}/${v.feet}`);
      check(wrongHits.length === 0, `LT, LG, C, RG, RT and Y each hit-test to himself at his sprite centre and at his feet ${wrongHits.join(' ')}`);
      const ol = ['LT', 'LG', 'C', 'RG', 'RT'].map((id) => g[id].r);
      const gaps = ol.slice(1).map((r, i) => (r.y + r.h) - (ol[i].y + ol[i].h));
      const tall = Math.max(...ol.map((r) => r.h));
      check(gaps.every((d) => d >= 16), `adjacent linemen stand at least 16 CSS px apart (${gaps.map((d) => d.toFixed(1)).join(', ')}; sprite ${tall.toFixed(1)} px tall)`);
      // The sprites themselves do not overlap: each lineman's box clears the next.
      const overlap = ol.slice(1).filter((r, i) => r.y < ol[i].y + ol[i].h - 0.5);
      check(overlap.length === 0, 'no two linemen sprites overlap');
      if (PLATES) {
        const c = ol[2], rr = await po.evaluate(() => { const r = document.getElementById('cs-stage').getBoundingClientRect(); return { x: r.x, w: r.width }; });
        fs.mkdirSync(PLATES, { recursive: true });
        await po.screenshot({ path: path.join(PLATES, 'cs2-ol-closeup.png'), clip: { x: rr.x, y: Math.max(0, c.y - 90), width: rr.w, height: 200 } });
        console.log('  plate ' + path.join(PLATES, 'cs2-ol-closeup.png'));
      }
      check(eo.length === 0, 'zero page errors on the OL puzzle');
      await po.close();
    }

    // B11. A real tap pays exactly 10 XP; a wrong-then-right pays 5; the wrong pick is shown first; reload keeps it.
    console.log('\n[B11] a real tap, real XP');
    {
      const { page: px, errors: ex } = await open(PHONE, { hash: '#unit/r1-u3/puzzles', storage: USER });
      await settle(px);
      const pz0 = await px.evaluate(() => { const m = window.__CS__.ui.mode, pz = window.CS.RANK_DATA[0].units[2].puzzles[0]; return { id: m.pz, type: pz.type, truth: window.CS.puzzleTypes.tap.truth(pz), xp: window.__CS__.ui.state.xp }; });
      check(pz0.id === 'r1-u3-p1' && pz0.type === 'tap' && pz0.xp === 0, `the OL puzzle set opens on its first tap puzzle from a clean state (${pz0.id}, xp ${pz0.xp})`);
      await tapPlayer(px, pz0.truth);
      const a1 = await px.evaluate(() => ({ xp: window.__CS__.ui.state.xp, m: window.__CS__.ui.mode }));
      a1.fb = await fbText(px);
      check(a1.xp === 10 && a1.m.done && a1.m.ok, `a real touch on the ${pz0.truth} sprite pays exactly +10 XP (xp ${a1.xp}; "${a1.fb.replace(/\s+/g, ' ').slice(0, 60)}")`);
      check(await px.evaluate(() => window.__CS__.playing), 'after the answer, the play runs');
      await px.evaluate(() => window.__CS__.ui.next()); await settle(px, 60);
      // Puzzle 2: wrong first (a real tap on another lineman), then right.
      const pz1 = await px.evaluate(() => { const C = window.CS, pz = C.RANK_DATA[0].units[2].puzzles[1]; return { id: pz.id, type: pz.type, truth: pz.type === 'tap' ? C.puzzleTypes.tap.truth(pz) : null, answer: pz.answer, n: pz.options ? pz.options.length : 0 }; });
      if (pz1.type === 'tap') {
        const wrongId = pz1.truth === 'LG' ? 'RG' : 'LG';
        await tapPlayer(px, wrongId);
        // RESTAGED (coach bubbles): the miss is told in a red bubble on the man he tapped; fbText reads it.
        const w = await px.evaluate(() => ({ xp: window.__CS__.ui.state.xp, m: window.__CS__.ui.mode, marks: window.__CS__.field.marks }));
        w.fb = await fbText(px);
        check(w.xp === 10 && !w.m.done && w.m.tryNo === 2 && /One more try/.test(w.fb) && w.marks.some((k) => k.id === wrongId && k.kind === 'bad'), `a first wrong tap names the pick, rings it red, pays nothing, keeps the question open ("${w.fb}")`);
        if (PLATES) { await plate(px, 'cs2-wrong-first-try.png'); }
        await tapPlayer(px, pz1.truth);
      } else {
        const wrongI = pz1.answer === 0 ? 1 : 0;
        await px.evaluate((i) => document.getElementById('stOpts').children[i].click(), wrongI); await settle(px, 40);
        const w = await px.evaluate(() => ({ xp: window.__CS__.ui.state.xp, m: window.__CS__.ui.mode }));
        w.fb = await fbText(px);
        check(w.xp === 10 && !w.m.done && w.m.tryNo === 2 && /One more try/.test(w.fb), `a first wrong option pays nothing and keeps the question open ("${w.fb}")`);
        await px.evaluate((i) => document.getElementById('stOpts').children[i].click(), pz1.answer); await settle(px, 40);
      }
      const a2 = await px.evaluate(() => ({ xp: window.__CS__.ui.state.xp, m: window.__CS__.ui.mode }));
      check(a2.xp === 15 && a2.m.done && a2.m.ok, `right on the second try pays +5 (xp ${a2.xp})`);
      await px.evaluate(() => window.__CS__.ui.next()); await settle(px, 60);
      // Puzzle 3: wrong twice. The reveal shows the right answer and what was picked, then the play runs.
      const pz2 = await px.evaluate(() => { const C = window.CS, pz = C.RANK_DATA[0].units[2].puzzles[2]; return { type: pz.type, truth: pz.type === 'tap' ? C.puzzleTypes.tap.truth(pz) : null, answer: pz.answer }; });
      if (pz2.type === 'tap') {
        const a = pz2.truth === 'LT' ? 'RT' : 'LT', b = pz2.truth === 'C' ? 'RG' : 'C';
        await tapPlayer(px, a); await tapPlayer(px, b);
      } else {
        await px.evaluate(() => window.__CS__.ui.answer(false)); await settle(px, 30); await px.evaluate(() => window.__CS__.ui.answer(false)); await settle(px, 30);
      }
      const a3 = await px.evaluate(() => ({ xp: window.__CS__.ui.state.xp, m: window.__CS__.ui.mode, good: window.__CS__.field.marks.filter((k) => k.kind === 'good').length, playing: window.__CS__.playing }));
      a3.fb = await fbText(px);
      check(a3.xp === 15 && a3.m.done && a3.m.ok === false && /^The answer: /.test(a3.fb) && (pz2.type !== 'tap' || a3.good === 1), `two misses: +0, the reveal names the answer ("${a3.fb.slice(0, 50)}"), the play runs (${a3.playing})`);
      await px.evaluate(() => window.__CS__.seek(-0.4));
      await plate(px, 'cs2-wrong-reveal.png');
      await px.reload({ waitUntil: 'load' });
      await px.waitForFunction(() => !!window.__CS__);
      const rl = await px.evaluate((k) => ({ xp: window.__CS__.ui.state.xp, raw: JSON.parse(localStorage.getItem(k)).xp }), KEY);
      check(rl.xp === 15 && rl.raw === 15, `reload keeps the XP under ${KEY} (${rl.xp})`);
      check(ex.length === 0, `zero page errors through the XP checks ${JSON.stringify(ex)}`);
      await px.close();
    }

    // B12. Callouts are reading text: an HTML overlay in the body font, big enough, inside the field, text inside its box.
    // RESTAGED (coach bubbles): the overlay is now the coach bubble (#bubble), placed by the field next to
    // what it talks about, instead of the #callout strip pinned to the top or bottom edge. Same rules.
    console.log('\n[B12] callouts in the body font');
    {
      const { page: pc, errors: ec } = await open(PHONE, { hash: '#unit/r1-u3', storage: USER });
      await settle(pc);
      // RESTAGED: up to 40 presses to reach the watch step (was 4): a card is now a run of bubbles.
      for (let i = 0; i < 40; i++) { const m = await mode(pc); if (m.kind === 'watch') break; await pc.evaluate(() => window.__CS__.ui.next()); await settle(pc, 40); }
      await pc.evaluate(() => window.__CS__.ui.next());
      await pc.waitForFunction(() => { const c = document.getElementById('bubble'); return window.__CS__.field.atNote && c.offsetParent !== null && c.textContent.length > 0; }, { timeout: 4000 });
      const co = await pc.evaluate(() => {
        const el = document.getElementById('bubble'), cs = getComputedStyle(el), body = getComputedStyle(document.body).getPropertyValue('--font-body').trim();
        const rg = document.createRange(); rg.selectNodeContents(el); const ink = rg.getBoundingClientRect(), box = el.getBoundingClientRect(), cv = document.getElementById('cs-stage').getBoundingClientRect();
        return { ff: cs.fontFamily, body, fs: parseFloat(cs.fontSize), ink: { l: ink.left, r: ink.right, t: ink.top, b: ink.bottom }, box: { l: box.left, r: box.right, t: box.top, b: box.bottom }, cv: { l: cv.left, r: cv.right, t: cv.top, b: cv.bottom }, text: el.textContent, playing: window.__CS__.playing };
      });
      const first = (s) => s.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
      check(co.body && first(co.ff) === first(co.body), `the callout is set in the body font (${co.ff.split(',')[0]} = --font-body ${co.body.split(',')[0]})`);
      check(co.fs >= 15, `callout text is at least 15 px (${co.fs})`);
      check(co.ink.l >= co.box.l - 0.5 && co.ink.r <= co.box.r + 0.5 && co.ink.t >= co.box.t - 0.5 && co.ink.b <= co.box.b + 0.5, 'the callout text (measured with a Range) sits inside its box');
      check(co.box.l >= co.cv.l - 0.5 && co.box.r <= co.cv.r + 0.5 && co.box.t >= co.cv.t - 0.5 && co.box.b <= co.cv.b + 0.5, 'the callout box sits inside the field');
      check(!co.playing, `the watch step stops at the note ("${co.text.slice(0, 40)}")`);
      // The panel text and options are the body font too (RESTAGED: the chalk talk itself moved into
      // bubbles; the panel's one line is now the watch step's instruction).
      const ff = await pc.evaluate(() => ({ p: getComputedStyle(document.getElementById('stText')).fontFamily, body: getComputedStyle(document.body).getPropertyValue('--font-body').trim() }));
      check(first(ff.p) === first(ff.body), 'the panel text is the body font');
      check(ec.length === 0, 'zero page errors on the callout');
      await pc.close();
    }

    // B13. Game Day: 9 of 12 fails and costs nothing; 10 of 12 promotes once, survives reload, and a retake pays nothing.
    console.log('\n[B13] Game Day and the promotion');
    {
      const T0 = Date.UTC(2026, 10, 2, 15, 0, 0);
      const done = await (async () => { const units = {}; for (let i = 1; i <= 7; i++) units['r1-u' + i] = { done: true, best: 6 }; return units; })();
      const seed = { ...USER, cs_muted: '1', [KEY]: JSON.stringify({ v: 1, xp: 300, rank: 0, units: done, srs: {}, seenPlays: [], streak: { n: 0, last: null, freezes: 1 }, promos: [] }) };
      const { page: pg, errors: eg } = await open(PHONE, { hash: '#gameday', storage: seed });
      await settle(pg);
      const runExam = async (nRight) => {
        for (let i = 0; i < 12; i++) {
          const m = await mode(pg);
          if (!m || m.kind !== 'gameday') return `question ${i + 1}: mode ${m && m.kind}`;
          await pg.evaluate((r) => window.__CS__.ui.answer(r), i < nRight);
          await settle(pg, 20);
          if (i === 4 && nRight === 9) {
            const L = await layout(pg);
            check(fits(L), `a Game Day question fits 390x844 with no page scroll (${L.sw}x${L.sh}, field ${L.fh.toFixed(0)})`);
            const sb = await pg.evaluate(() => ({ q: document.getElementById('sbQ').textContent, r: document.getElementById('sbRight').textContent, m: document.getElementById('sbMiss').textContent, vis: document.getElementById('scoreboard').offsetParent !== null }));
            check(sb.vis && sb.q === '5/12' && sb.r === '5' && sb.m === '0', `the scoreboard reads question 5/12, 5 right, 0 missed (${JSON.stringify(sb)})`);
            await plate(pg, 'cs2-game-day.png');
          }
          await pg.evaluate(() => window.__CS__.ui.next());
          await settle(pg, 20);
        }
        return null;
      };
      const e1 = await runExam(9);
      const f = await pg.evaluate(() => ({ s: window.__CS__.ui.state, m: window.__CS__.ui.mode, pc: window.__CS__.ui.promoCount, chips: [...document.querySelectorAll('#resTags .chip')].map((c) => ({ t: c.textContent, tags: c.dataset.tag, h: c.getBoundingClientRect().height })), tagsVis: document.getElementById('resTags').offsetParent !== null, promoGone: document.getElementById('promo').offsetParent === null }));
      check(!e1 && f.m.kind === 'gdresult' && f.m.passed === false && f.m.right === 9, `9 of 12 is a fail (${e1 || f.m.right + ' right'})`);
      check(f.s.rank === 0 && f.s.xp === 300 && f.pc === 0 && f.promoGone, `a fail costs nothing: rank 0, XP still 300, no promotion (xp ${f.s.xp})`);
      check(f.tagsVis && f.chips.length >= 1 && f.chips.every((c) => c.tags && c.h >= 44), `the fail shows what to revisit as 44 px unit buttons (${f.chips.map((c) => c.t + ':' + c.tags).join(', ')})`);
      await pg.evaluate(() => document.getElementById('resNext').click());          // Try again
      await settle(pg);
      const e2 = await runExam(10);
      const p = await pg.evaluate(() => ({ s: window.__CS__.ui.state, m: window.__CS__.ui.mode, pc: window.__CS__.ui.promoCount, vis: document.getElementById('promo').offsetParent !== null || getComputedStyle(document.getElementById('promo')).display !== 'none' && document.getElementById('promo').getBoundingClientRect().height > 0, title: document.getElementById('promoNew').textContent, body: document.getElementById('promoText').textContent, ff: getComputedStyle(document.getElementById('promoText')).fontFamily, bodyFont: getComputedStyle(document.body).getPropertyValue('--font-body').trim() }));
      check(!e2 && p.m.passed === true && p.m.right === 10, `10 of 12 passes (${e2 || p.m.right + ' right'})`);
      check(p.s.rank === 1 && p.s.xp === 400 && JSON.stringify(p.s.promos) === '[1]', `the pass pays +100 and raises the rank (xp ${p.s.xp}, rank ${p.s.rank}, promos ${JSON.stringify(p.s.promos)})`);
      check(p.vis && p.pc === 1 && p.title === 'Quality Control Coach' && /Testy/.test(p.body), `the contract card shows once, naming Testy as Quality Control Coach (${p.pc})`);
      check(p.ff.split(',')[0] === p.bodyFont.split(',')[0], 'the contract body is in the body font');
      const sm = await visibleSmall(pg);
      check(sm.length === 0, `promotion controls are at least 44 px ${JSON.stringify(sm)}`);
      await settle(pg, 1900);                                                     // let the signature draw
      await plate(pg, 'cs2-promotion.png');
      await pg.click('#promoOk');
      check(await pg.evaluate(() => document.getElementById('promo').offsetParent === null && document.getElementById('promo').getBoundingClientRect().height === 0), 'closing the contract removes its geometry');
      await pg.reload({ waitUntil: 'load' });
      await pg.waitForFunction(() => !!window.__CS__);
      await pg.evaluate(() => { location.hash = '#map'; }); await settle(pg);
      const r = await pg.evaluate(() => ({ s: window.__CS__.ui.state, pc: window.__CS__.ui.promoCount, gone: document.getElementById('promo').offsetParent === null, sub: document.querySelector('#ranks .rank[data-rank="0"] .rsub').textContent, r2: document.querySelector('#ranks .rank[data-rank="1"]').classList.contains('locked') }));
      check(r.s.rank === 1 && r.s.xp === 400 && r.pc === 0 && r.gone, `after reload: still rank 1 with 400 XP, and the promotion does not show again (${r.pc})`);
      check(r.sub === 'Promoted', 'the map marks the Intern rank as promoted');
      // A retake of the passed Game Day: no second promotion, no XP.
      await pg.evaluate(() => { location.hash = '#gameday'; }); await settle(pg);
      const e3 = await runExam(12);
      const q = await pg.evaluate(() => ({ s: window.__CS__.ui.state, pc: window.__CS__.ui.promoCount, gone: document.getElementById('promo').offsetParent === null }));
      check(!e3 && q.s.rank === 1 && q.s.xp === 400 && q.pc === 0 && q.gone && JSON.stringify(q.s.promos) === '[1]', `a 12/12 retake pays nothing and promotes nobody (xp ${q.s.xp}, promos ${JSON.stringify(q.s.promos)})`);
      const hid = await pg.evaluate(() => [...document.querySelectorAll('[hidden]')].filter((e) => !(e instanceof SVGElement)).filter((e) => e.offsetParent !== null).map((e) => e.id || e.className));
      check(hid.length === 0, `every hidden HTML element on the result screen has offsetParent === null ${hid.join(',')}`);
      check(eg.length === 0, `zero page errors through Game Day ${JSON.stringify(eg.slice(0, 3))}`);
      await pg.close();
    }

    // B14. Mute persists; the stage chrome has no emoji; the field stays hard-edged at DPR 2 and 3.
    console.log('\n[B14] mute, chrome, DPR');
    {
      const { page: pq, errors: eq } = await open(PHONE, { hash: '#unit/r1-u1', storage: USER });
      await settle(pq);
      await pq.click('#btnMute');
      const mu = await pq.evaluate(() => ({ ls: localStorage.getItem('cs_muted'), pressed: document.getElementById('btnMute').getAttribute('aria-pressed') }));
      await pq.reload({ waitUntil: 'load' }); await pq.waitForFunction(() => !!window.__CS__);
      const mu2 = await pq.evaluate(() => document.getElementById('btnMute').getAttribute('aria-pressed'));
      check(mu.ls === '1' && mu.pressed === 'true' && mu2 === 'true', `mute persists across a reload (${mu.ls}, ${mu.pressed}, ${mu2})`);
      const chrome2 = await pq.evaluate(() => [...document.querySelectorAll('h1,h2,h3,button,nav,a,.chip,label,#stStep')].map((e) => (e.textContent || '').trim()));
      check(chrome2.every((s) => !EMOJI2.test(s)), 'no emoji in the stage chrome');
      // Plate review (phase 2): a touch on the field washed the whole canvas teal (Android Chrome's tap highlight).
      const thl = await pq.evaluate(() => ['cs-stage', 'cs-field'].map((id) => getComputedStyle(document.getElementById(id)).webkitTapHighlightColor));
      check(thl.every((c) => /rgba\(0, 0, 0, 0\)|transparent/.test(c)), `tapping a field does not flash it (tap highlight ${thl.join(' / ')})`);
      const sm = await visibleSmall(pq);
      check(sm.length === 0, `stage controls are at least 44x44 ${JSON.stringify(sm)}`);
      check(eq.length === 0, 'zero page errors on the stage');
      await pq.close();
      for (const dpr of [2, 3]) {
        const { page: pd, errors: ed } = await open({ ...PHONE, deviceScaleFactor: dpr }, { hash: '#unit/r1-u3/puzzles', storage: USER });
        await settle(pd);
        const d = await pd.evaluate(() => { const c = document.getElementById('cs-stage'); return { ir: getComputedStyle(c).imageRendering, dpr: devicePixelRatio, w: c.width, cw: c.getBoundingClientRect().width }; });
        check(d.dpr === dpr && /pixelated|crisp-edges/.test(d.ir), `DPR ${dpr}: the field is drawn hard-edged (image-rendering ${d.ir})`);
        if (dpr === 3 && PLATES) {
          const r = await pd.evaluate(() => { const q = window.__CS__.spriteRect('C'); return { x: q.left, y: q.top }; });
          fs.mkdirSync(PLATES, { recursive: true });
          await pd.screenshot({ path: path.join(PLATES, 'cs2-ol-closeup-dpr3.png'), clip: { x: Math.max(0, r.x - 90), y: Math.max(0, r.y - 70), width: 180, height: 160 } });
          console.log('  plate ' + path.join(PLATES, 'cs2-ol-closeup-dpr3.png'));
        }
        check(ed.length === 0, `zero page errors at DPR ${dpr}`);
        await pd.close();
      }
    }
    // B15. Plate review (phase 2): on PHI-DAL and BAL-CIN both teams read as dark sprites and a 13-year-old
    // could not tell offense from defense. Measured: the mean colour of every painted offense sprite against
    // every defense sprite (grass pixels skipped), RGB distance. Before the matchup fixes the worst was 8;
    // a pair that is plainly two teams measures 25 or more; the bar sits at 22 for margin.
    console.log('\n[B15] two teams you can tell apart');
    {
      const { page: pk, errors: ek } = await open(PHONE, { hash: '#map', storage: USER });
      const kit = await pk.evaluate(async () => {
        const CS = window.CS, out = [];
        const ids = Object.keys(CS.lib.PLAYS).filter((k) => k.startsWith('r1-'));
        for (const id of ids) {
          location.hash = '#film/' + id;
          await new Promise((r) => setTimeout(r, 60));
          const C = window.__CS__, c = document.getElementById('cs-stage'), g = c.getContext('2d'), cr = c.getBoundingClientRect(), sx = c.width / cr.width, sy = c.height / cr.height;
          const avg = { off: [0, 0, 0, 0], def: [0, 0, 0, 0] };
          for (const p of CS.compile(CS.lib.PLAYS[id]).all) {
            const q = C.spriteRect(p.id);
            if (!q) continue;
            const d = g.getImageData(Math.round((q.left - cr.left) * sx), Math.round((q.top - cr.top) * sy), Math.max(1, Math.round((q.right - q.left) * sx)), Math.max(1, Math.round((q.bottom - q.top) * sy))).data;
            for (let i = 0; i < d.length; i += 4) { if (d[i + 1] > d[i] + 30 && d[i + 1] > d[i + 2] + 30) continue; const a = avg[p.team]; a[0] += d[i]; a[1] += d[i + 1]; a[2] += d[i + 2]; a[3]++; }
          }
          const m = (a) => a.slice(0, 3).map((v) => v / a[3]), o = m(avg.off), e = m(avg.def);
          out.push({ id, dist: Math.hypot(o[0] - e[0], o[1] - e[1], o[2] - e[2]) });
        }
        return out;
      });
      const worst = kit.reduce((a, b) => (b.dist < a.dist ? b : a));
      check(kit.length >= 20 && worst.dist >= 22, `on all ${kit.length} rank-1 plays the two teams' sprites differ (worst ${worst.id}: ${worst.dist.toFixed(0)}, need 22)`);
      check(ek.length === 0, 'zero page errors through the film room');
      await pk.close();
    }

    // B16. REGRESSION, from the dad's phone playtest of PR #182: "I got stuck on the first lesson -- when
    // hitting play nothing happens." Every lesson play opened with two callouts BEFORE the snap
    // (t -1.0 and -0.5, the clock starting at -1.2), so a press of Play ran 0.2 s and then 0.5 s of a
    // frozen pre-snap picture and stopped again, and the button went back to reading "Play". With
    // Reduce Motion on (common on iPhones) each press waited a further 1.2 s before its first step.
    // Driven like a user: a real click on the main button of every rank-1 watch step. Each press must
    // change something he can see within 400 ms (the camera moved, a new note appeared, or a player
    // moved half a yard), the play must reach its end within (#callouts + 2) presses, and while it is
    // stopped on a note the button must say "Next", not "Play".
    console.log('\n[B16] every press on a watch step visibly does something');
    for (const reduced of [false, true]) {
      const { page: pw, errors: ew } = await open(PHONE, { hash: '#map', storage: USER, reduced });
      const units = await pw.evaluate(() => window.CS.RANK_DATA[0].units.map((u) => ({ id: u.id, k: (window.CS.lib.PLAYS[u.play].callouts || []).length })));
      const snap = () => pw.evaluate(() => {
        const C = window.__CS__, f = C.field, cam = f.camera ? { ...f.camera } : null;
        const notes = [...document.querySelectorAll('#callout, .bubble')].filter((e) => e.offsetParent !== null).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ');
        const P = C.play ? window.CS.poseAt(C.play, C.t).players : {};
        return { cam, notes, pose: P, t: C.t, T: C.T, playing: C.playing, label: document.getElementById('btnMain').textContent.replace(/\s+/g, ' ').trim(), animating: !!(f.camAnimating) };
      });
      const changed = (a, b) => {
        const cam = a.cam && b.cam && (Math.abs(a.cam.z - b.cam.z) > 0.01 || Math.hypot(a.cam.cx - b.cam.cx, a.cam.cy - b.cam.cy) > 1);
        const note = !!b.notes && b.notes !== a.notes;
        const moved = Object.keys(b.pose).some((id) => a.pose[id] && Math.hypot(b.pose[id].x - a.pose[id].x, b.pose[id].y - a.pose[id].y) >= 0.5);
        return cam || note || moved;
      };
      const dead = [], slow = [], liars = [];
      for (const u of units) {
        await pw.evaluate((id) => { location.hash = '#unit/' + id; }, u.id); await settle(pw);
        for (let i = 0; i < 40; i++) { const m = await mode(pw); if (m.kind === 'watch') break; await pw.evaluate(() => window.__CS__.ui.next()); await settle(pw, 20); }
        let presses = 0, end = false;
        while (!end && presses < u.k + 4) {
          const before = await snap();
          // RESTAGED after one flake under load: the 400 ms used to be Node's wall clock, polled through
          // puppeteer round trips (snap() runs poseAt for 22 men per call), so on a busy machine a change
          // the page made at 300 ms could be first SEEN by the poll after 400. The rule is unchanged (no
          // more than 400 ms of the old picture after a press); it is now measured inside the page: a
          // capture-phase click listener stamps the press (event.timeStamp) and a rAF sampler compares
          // every frame to the before-picture with the same changed() test. What must be under 400 ms
          // is the last frame that still showed the old picture, on the page's own clock, so the
          // dead-press bug (0.5 s of frozen pre-snap frames; 1.2 s more under Reduce Motion) still fails,
          // while a stall that paints no frame at all is not blamed on the app. The change must still come.
          await pw.evaluate((changedSrc) => {
            const C = window.__CS__, f = C.field;
            const changedF = new Function('return (' + changedSrc + ')')();
            const pic = () => ({ cam: f.camera ? { ...f.camera } : null,
              notes: [...document.querySelectorAll('#callout, .bubble')].filter((e) => e.offsetParent !== null).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | '),
              pose: C.play ? window.CS.poseAt(C.play, C.t).players : {} });
            const S = window.__b16 = { before: pic(), press: null, lastStale: null, firstNew: null, frames: 0 };
            const onClick = (e) => { if (S.press == null && e.target.closest && e.target.closest('#btnMain')) S.press = e.timeStamp; };
            window.addEventListener('click', onClick, true);
            const tick = () => {
              const now = performance.now();
              if (S.press != null && now >= S.press) {
                S.frames++;
                if (changedF(S.before, pic())) { S.firstNew = now; window.removeEventListener('click', onClick, true); return; }
                S.lastStale = now;
              }
              if (now - (S.press == null ? now : S.press) < 5000) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }, changed.toString());
          await pw.click('#btnMain'); presses++;
          await pw.waitForFunction(() => window.__b16.firstNew != null || (window.__b16.press != null && performance.now() - window.__b16.press > 5000), { timeout: 15000, polling: 50 }).catch(() => {});
          const m16 = await pw.evaluate(() => window.__b16 && { press: window.__b16.press, firstNew: window.__b16.firstNew, lastStale: window.__b16.lastStale, frames: window.__b16.frames });
          const stale = m16 && m16.press != null && m16.lastStale != null ? m16.lastStale - m16.press : 0;
          const seen = !!m16 && m16.press != null && m16.firstNew != null && stale < 400;
          if (!seen) dead.push(`${u.id} press ${presses} (t ${before.t.toFixed(2)}; ${!m16 || m16.firstNew == null ? 'never changed' : `old picture still up ${Math.round(stale)} ms after the press, ${m16.frames} frames`})`);
          // Let it run to its next stop: a note or the end.
          let s = await snap();
          for (let w = 0; w < 300 && (s.playing || s.animating); w++) { await settle(pw, 50); s = await snap(); }
          end = s.t >= s.T - 1e-6;
          if (!end && s.notes && s.label !== 'Next') liars.push(`${u.id} press ${presses}: stopped on a note, button reads "${s.label}"`);
        }
        if (!end || presses > u.k + 2) slow.push(`${u.id}: ${end ? 'ended' : 'NOT ended'} after ${presses} presses (${u.k} callouts)`);
      }
      const tag = reduced ? ' (reduced motion)' : '';
      check(dead.length === 0, `every press of the main button on a rank-1 watch step changes the picture within 400 ms${tag} ${dead.slice(0, 6).join(', ')}`);
      check(slow.length === 0, `every rank-1 watch play reaches its end within callouts + 2 presses${tag} ${slow.slice(0, 4).join(' | ')}`);
      check(liars.length === 0, `stopped on a note, the main button reads "Next"${tag} ${liars.slice(0, 3).join(' | ')}`);
      check(ew.length === 0, `zero page errors pressing through the watch steps${tag} ${JSON.stringify(ew.slice(0, 3))}`);
      await pw.close();
    }

    // B17. Coach bubbles and the camera, on every rank-1 chalk-talk bubble, watch note and walkthrough
    // prompt. Geometry the eye checks, measured: the bubble sits inside the field and off the controls,
    // covers none of its own targets, its text (a Range) fits inside it, and each arrow ends within
    // 12 px of its target's screen point, which is inside the field and outside the bubble. The target
    // points are recomputed here independently of the field's own bookkeeping: a player's from his
    // sprite box, a feature's from CS.focusOf's yards through yardToScreen, a group's must lie on the
    // edge of the union of its members' sprites. After every zoom the yardToScreen -> hitTest round trip
    // still returns every player whose feet are on screen, and screenToYard still inverts it.
    console.log('\n[B17] coach bubbles and the camera');
    {
      const { page: pb, errors: eb } = await open(PHONE, { hash: '#map', storage: USER });
      const measure = () => pb.evaluate(() => {
        const C = window.__CS__, CS = window.CS, g = C.coach, el = document.getElementById('bubble');
        if (!g) return { none: true, saying: C.saying };
        const bt = el.querySelector('.bt'), rg = document.createRange(); rg.selectNodeContents(bt);
        const ink = rg.getBoundingClientRect(), box = el.getBoundingClientRect(), act = document.getElementById('stActions').getBoundingClientRect();
        const exp = g.targets.map((t) => {
          if (t.kind === 'player') { const q = C.spriteRect(t.id); return { kind: 'player', x: (q.left + q.right) / 2, y: (q.top + q.bottom) / 2 }; }
          if (t.kind === 'group') {
            let U = null; for (const id of t.ids) { const q = C.spriteRect(id); U = U ? { l: Math.min(U.l, q.left), r: Math.max(U.r, q.right), t: Math.min(U.t, q.top), b: Math.max(U.b, q.bottom) } : { l: q.left, r: q.right, t: q.top, b: q.bottom }; }
            const inX = t.pt.x >= U.l - 8 && t.pt.x <= U.r + 8, inY = t.pt.y >= U.t - 8 && t.pt.y <= U.b + 8;
            const edge = Math.min(Math.abs(t.pt.x - U.l), Math.abs(t.pt.x - U.r), Math.abs(t.pt.y - U.t), Math.abs(t.pt.y - U.b));
            return { kind: 'group', onEdge: inX && inY && edge <= 8 };
          }
          const f = CS.focusOf(C.play, t.tok, C.t); let best = null;
          for (const m of f.marks) { const p = C.yardToScreen(m.at.x, m.at.y), d = Math.hypot(p.x - t.pt.x, p.y - t.pt.y); if (!best || d < best.d) best = { kind: 'feature', x: p.x, y: p.y, d }; }
          return best;
        });
        // Camera round trip: every player whose feet are on the field box.
        const pose = (C.field.shown || CS.poseAt(C.play, C.t)).players, rt = [];   // RESTAGED with B4: from where each man is drawn (CS.showAt)
        for (const [id, q] of Object.entries(pose)) {
          const s2 = C.yardToScreen(q.x, q.y);
          if (s2.x < g.box.l + 2 || s2.x > g.box.r - 2 || s2.y < g.box.t + 2 || s2.y > g.box.b - 2) continue;
          const back = C.screenToYard(s2.x, s2.y);
          rt.push({ id, hit: C.hitTest(s2.x, s2.y), err: Math.hypot(back.x - q.x, back.y - q.y) });
        }
        // Painted boxes that intersect, before the snap only (B20 says why the tolerance is 0.01 px), and the chalk drawn.
        const ov = (() => { const cc = CS.compile(C.play), o = []; if (C.t > cc.snapT + 1e-9) return null; const R = cc.all.map((p) => [p.id, C.spriteRect(p.id)]).filter((x) => x[1]);
          for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i][1], b = R[j][1], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 0.01 && h > 0.01) o.push(`${R[i][0]}/${R[j][0]} ${w.toFixed(1)}x${h.toFixed(1)}`); }
          return o; })();
        return { ov, chalk: C.field.chalk || null, g, ink: { l: ink.left, r: ink.right, t: ink.top, b: ink.bottom }, box: { l: box.left, r: box.right, t: box.top, b: box.bottom }, act: { l: act.left, r: act.right, t: act.top, b: act.bottom }, fs: parseFloat(getComputedStyle(el).fontSize), exp, rt, cam: C.camera, text: el.textContent };
      });
      const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const probs = [], rtBad = [], ovBad = [], chalkBad = [];
      let ovN = 0;
      let n = 0, zoomed = 0, rtN = 0;
      const audit = (where, m) => {
        n++;
        if (m.none) { probs.push(`${where}: no bubble on screen (${JSON.stringify(m.saying)})`); return; }
        const { g } = m, B = g.bubble, X = g.box;
        if (m.cam.z > 1.01) zoomed++;
        if (!g.targets.length) probs.push(`${where}: the bubble points at nothing`);
        if (!g.ok) probs.push(`${where}: placement found no clean spot`);
        if (B.l < X.l - 0.5 || B.r > X.r + 0.5 || B.t < X.t - 0.5 || B.b > X.b + 0.5) probs.push(`${where}: bubble leaves the field ${JSON.stringify(B)} ${JSON.stringify(X)}`);
        if (Math.abs(m.box.l - B.l) > 1 || Math.abs(m.box.t - B.t) > 1) probs.push(`${where}: the bubble element is not where the field placed it`);
        if (hit(m.box, m.act)) probs.push(`${where}: bubble covers the controls`);
        if (m.ink.l < m.box.l - 0.5 || m.ink.r > m.box.r + 0.5 || m.ink.t < m.box.t - 0.5 || m.ink.b > m.box.b + 0.5) probs.push(`${where}: text overflows its bubble`);
        if (m.fs < 15) probs.push(`${where}: bubble text ${m.fs}px`);
        g.targets.forEach((t, i) => {
          if (hit(B, t.rect)) probs.push(`${where}: bubble covers its target ${t.tok}`);
          const d = Math.hypot(t.tail.x - t.pt.x, t.tail.y - t.pt.y);
          if (d > 12) probs.push(`${where}: arrow to ${t.tok} ends ${d.toFixed(1)} px from it`);
          if (Math.hypot(t.tail.x - t.tail.x0, t.tail.y - t.tail.y0) < 14) probs.push(`${where}: arrow to ${t.tok} is too short to see`);
          if (t.pt.x < X.l || t.pt.x > X.r || t.pt.y < X.t || t.pt.y > X.b) probs.push(`${where}: ${t.tok} is off the field box`);
          if (t.pt.x > B.l && t.pt.x < B.r && t.pt.y > B.t && t.pt.y < B.b) probs.push(`${where}: ${t.tok}'s point is under the bubble`);
          const e = m.exp[i];
          if (!e) probs.push(`${where}: ${t.tok} did not resolve independently`);
          else if (e.kind === 'group' ? !e.onEdge : Math.hypot(e.x - t.pt.x, e.y - t.pt.y) > 1.5) probs.push(`${where}: ${t.tok} point disagrees with the independent one ${JSON.stringify(e)} vs ${JSON.stringify(t.pt)}`);
        });
        if (m.ov) { ovN++; if (m.ov.length) ovBad.push(`${where}: ${m.ov.slice(0, 3).join(", ")}`); }
        if (!m.chalk || m.chalk.routes.length || m.chalk.zones.length) chalkBad.push(`${where}: ${JSON.stringify(m.chalk)}`);
        rtN += m.rt.length;
        for (const r of m.rt) if (r.hit !== r.id || r.err > 1e-6) rtBad.push(`${where}:${r.id}->${r.hit}`);
      };
      // The spotlight, measured on the same settled frame. Who the bubble names is worked out here from
      // CS.focusOf directly (not CS.spotIds). Every man it doesn't name must be at 0.32 and drawn before
      // every man it names; a bracket must be the union of its own members' sprites plus 5 px (never
      // grown to take in anyone else) and hold every member's sprite centre, and any other man whose
      // sprite centre falls inside it must be faded; a hit-test at each named man's sprite centre returns
      // him. A bubble about field features only fades nobody; a bubble that asks for a tap neither.
      const spotM = () => pb.evaluate(() => {
        const C = window.__CS__, CS = window.CS, s = C.spot || { ids: null, alpha: {}, order: [] }, say = C.saying, g = C.coach;
        const named = new Set(); let feature = 0;
        if (say) for (const tok of say.focus) { const f = CS.focusOf(C.play, tok, C.t); if (!f) continue; if (f.ids) f.ids.forEach((id) => named.add(id)); else feature++; }
        const all = Object.keys(CS.poseAt(C.play, C.t).players), ctr = {};
        for (const id of all) { const q = C.spriteRect(id); if (q) ctr[id] = { x: (q.left + q.right) / 2, y: (q.top + q.bottom) / 2, r: q }; }
        const box = g ? g.box : null, on = (p) => box && p.x > box.l + 1 && p.x < box.r - 1 && p.y > box.t + 1 && p.y < box.b - 1;
        const hits = [...named].filter((id) => ctr[id] && on(ctr[id])).map((id) => ({ id, hit: C.hitTest(ctr[id].x, ctr[id].y) }));
        const brackets = g ? g.targets.filter((t) => t.kind === 'group').map((t) => {
          let U = null; for (const id of t.ids) { const q = ctr[id].r; U = U ? { l: Math.min(U.l, q.left), r: Math.max(U.r, q.right), t: Math.min(U.t, q.top), b: Math.max(U.b, q.bottom) } : { l: q.left, r: q.right, t: q.top, b: q.bottom }; }
          const R = t.rect, inside = (p) => p.x >= R.l && p.x <= R.r && p.y >= R.t && p.y <= R.b;
          return { tok: t.tok, tight: Math.max(Math.abs(R.l - (U.l - 5)), Math.abs(R.r - (U.r + 5)), Math.abs(R.t - (U.t - 5)), Math.abs(R.b - (U.b + 5))),
            out: t.ids.filter((id) => !inside(ctr[id])), others: all.filter((id) => !t.ids.includes(id) && ctr[id] && inside(ctr[id])) };
        }) : [];
        // Where a lit man's sprite overlaps a faded man's: a tap 40% of the way from the faded man's
        // body axis to the lit man's, inside both sprites. Nearest-axis alone gives it to the faded man;
        // under the spotlight it belongs to the man the bubble is about.
        const over = [];
        for (const L of named) for (const F of all) {
          if (named.has(F) || !ctr[L] || !ctr[F]) continue;
          const a = ctr[L].r, b = ctr[F].r, o = { l: Math.max(a.left, b.left), r: Math.min(a.right, b.right), t: Math.max(a.top, b.top), b: Math.min(a.bottom, b.bottom) };
          if (o.r - o.l < 2 || o.b - o.t < 2 || Math.abs(a.feetX - b.feetX) < 6) continue;
          const x = b.feetX + 0.4 * (a.feetX - b.feetX), y = (o.t + o.b) / 2;
          if (x < o.l + 0.5 || x > o.r - 0.5 || !on({ x, y })) continue;
          over.push({ L, F, hit: C.hitTest(x, y) });
        }
        return { named: [...named], feature, all, ids: s.ids, alpha: s.alpha, order: s.order, hits, brackets, over };
      });
      const sprob = [];
      let sLit = 0, sFeat = 0, sCovered = 0, sHits = 0, sBr = 0, sTap = 0, sOver = 0;
      const auditSpot = (where, m, expectOff) => {
        const A = (id) => (m.alpha && id in m.alpha ? m.alpha[id] : NaN);
        if (expectOff || !m.named.length) {
          if (m.ids !== null || m.all.some((id) => A(id) !== 1)) sprob.push(`${where}: ${expectOff ? 'a tap prompt' : 'a field-feature bubble'} fades someone (${JSON.stringify(m.ids)})`);
          if (expectOff) sTap++; else sFeat++;
          return;
        }
        sLit++;
        const lit = new Set(m.named);
        if (!m.ids || [...m.ids].sort().join() !== [...lit].sort().join()) sprob.push(`${where}: lit ${JSON.stringify(m.ids)} but the bubble names ${[...lit].join(',')}`);
        for (const id of m.all) {
          const want = lit.has(id) ? 1 : 0.32;
          if (!(Math.abs(A(id) - want) < 1e-3)) sprob.push(`${where}: ${id} at opacity ${A(id)}, want ${want}`);
        }
        const idx = (id) => m.order.indexOf(id), lastDim = Math.max(-1, ...m.all.filter((id) => !lit.has(id)).map(idx)), firstLit = Math.min(...[...lit].map(idx));
        if (m.order.length !== m.all.length || !(firstLit > lastDim)) sprob.push(`${where}: a faded man drawn after a lit one (order ${m.order.join(',')})`);
        for (const b of m.brackets) {
          sBr++;
          if (b.tight > 1) sprob.push(`${where}: ${b.tok} bracket is ${b.tight.toFixed(1)} px off its members' sprites + 5`);
          if (b.out.length) sprob.push(`${where}: ${b.tok} bracket leaves out ${b.out.join(',')}`);
          for (const id of b.others) { sCovered++; if (!(A(id) < 0.5)) sprob.push(`${where}: ${id} inside the ${b.tok} bracket and not faded`); }
        }
        for (const h of m.hits) { sHits++; if (h.hit !== h.id) sprob.push(`${where}: a tap on ${h.id}'s sprite centre went to ${h.hit}`); }
        for (const o of m.over) { sOver++; if (o.hit !== o.L) sprob.push(`${where}: a tap where lit ${o.L} overlaps faded ${o.F} went to ${o.hit}`); }
      };
      const units = await pb.evaluate(() => window.CS.RANK_DATA[0].units.map((u) => ({ id: u.id, walk: u.walk.map((w) => w.answer) })));
      for (const u of units) {
        await pb.evaluate((id) => { location.hash = '#unit/' + id; }, u.id); await settle(pb);
        for (let i = 0; i < 40; i++) {
          const mc = await mode(pb);
          if (mc.kind !== 'card') break;
          await still(pb);
          audit(`${u.id} card ${mc.step + 1}.${mc.bubble + 1}`, await measure());
          auditSpot(`${u.id} card ${mc.step + 1}.${mc.bubble + 1}`, await spotM());
          if (u.id === 'r1-u1' && mc.step === 1 && mc.bubble === 0) await plate(pb, 'cs3-card-hash-marks.png');
          if (u.id === 'r1-u3' && mc.step === 0 && mc.bubble === 0) await plate(pb, 'cs3-card-ol-group.png');
          if (u.id === 'r1-u3' && mc.step === 1 && mc.bubble === 0) await plate(pb, 'cs4-card-center.png');
          if (u.id === 'r1-u6' && mc.step === 0 && mc.bubble === 0) await plate(pb, 'cs4-card-dl-group.png');
          if (u.id === 'r1-u6' && mc.step === 1 && mc.bubble === 0) await plate(pb, 'cs4-card-lb-group.png');
          await pb.evaluate(() => window.__CS__.ui.next()); await settle(pb, 30);
        }
        // Watch: the main button, a note at a time.
        for (let p = 0; p < 6; p++) {
          await pb.click('#btnMain');
          if (u.id === 'r1-u1' && p === 0) { await settle(pb, 230); await plate(pb, 'cs3-watch-mid-zoom.png'); }
          await pb.waitForFunction(() => !window.__CS__.playing && !window.__CS__.field.camAnimating, { timeout: 15000 }); await still(pb);
          if (await pb.evaluate(() => window.__CS__.field.atNote)) {
            audit(`${u.id} note ${p + 1}`, await measure());
            auditSpot(`${u.id} note ${p + 1}`, await spotM());
            if (u.id === 'r1-u1' && p === 0) await plate(pb, 'cs3-watch-zoomed.png');
            if (u.id === 'r1-u1' && p === 2) {
              // The play running zoomed out: one press on from the last note, partway down the field.
              await pb.click('#btnMain'); await settle(pb, 650);
              const z = await pb.evaluate(() => ({ z: window.__CS__.camera.z, playing: window.__CS__.playing }));
              check(z.z === 1, `the play runs with the camera zoomed all the way out (z ${z.z}, playing ${z.playing})`);
              const run = await spotM();
              check(run.ids === null && run.all.every((id) => run.alpha[id] === 1), `the play runs with nobody faded (lit ${JSON.stringify(run.ids)}, opacities ${[...new Set(Object.values(run.alpha || {}))].join(',')})`);
              await plate(pb, 'cs3-play-running.png');
              // While it runs: sampled every 40 ms for 0.6 s, the frame drew no route or zone chalk.
              const runChalk = await pb.evaluate(() => new Promise((res) => { const seen = []; const iv = setInterval(() => seen.push({ t: window.__CS__.t, c: window.__CS__.field.chalk || null }), 40); setTimeout(() => { clearInterval(iv); res(seen); }, 600); }));
              check(runChalk.length >= 8 && runChalk.every((s) => s.c && !s.c.routes.length && !s.c.zones.length), `the lesson play runs with no route or zone chalk (${runChalk.length} frames sampled, t ${runChalk[0] && runChalk[0].t.toFixed(2)}..${runChalk.length && runChalk[runChalk.length - 1].t.toFixed(2)})`);
              await pb.waitForFunction(() => !window.__CS__.playing && !window.__CS__.field.camAnimating, { timeout: 15000 });
            }
          }
          if ((await mode(pb)).ended) break;
        }
        await pb.evaluate(() => window.__CS__.ui.next()); await settle(pb, 60);
        for (let j = 0; j < u.walk.length; j++) {
          await still(pb);
          audit(`${u.id} walk ${j + 1}`, await measure());
          auditSpot(`${u.id} walk ${j + 1}`, await spotM(), true);
          if (u.id === 'r1-u3' && j === 0) await plate(pb, 'cs3-walk-prompt.png');
          await tapPlayer(pb, u.walk[j]); await still(pb);
          audit(`${u.id} walk ${j + 1} right`, await measure());
          auditSpot(`${u.id} walk ${j + 1} right`, await spotM());
          await pb.evaluate(() => window.__CS__.ui.next()); await settle(pb, 60);
        }
      }
      check(n >= 120 && probs.length === 0, `${n} coach bubbles (${zoomed} zoomed): inside the field, off the controls, off their targets, text fits, every arrow ends within 12 px of its target ${probs.slice(0, 5).join(' | ')}`);
      check(zoomed >= 60, `the camera zooms in on what a bubble points at (${zoomed} of ${n} bubbles shown zoomed)`);
      check(sLit >= 60 && sprob.length === 0, `spotlight on ${sLit} bubbles that name players: everyone else at 0.32 and drawn first, the named on top at full opacity; ${sHits} taps on named sprite centres hit their man ${sprob.slice(0, 5).join(' | ')}`);
      // RESTAGED 2026-11-11: with the neutral zone drawn wide no two sprites overlap before the snap (B20),
      // so the lit-over-faded overlaps this samples now occur only on the notes after the snap
      // (contact is football). The rule still has to hold wherever they do; the count floor is 1.
      check(sOver >= 1 && !sprob.some((x) => /overlaps faded/.test(x)), `${sOver} taps where a lit sprite overlaps a faded one, 40% of the way from the faded man's axis, go to the lit man ${sprob.filter((x) => /overlaps faded/.test(x)).slice(0, 4).join(' | ')}`);
      // RESTAGED 2026-11-11: sCovered counted DL sprites reaching into the OL bracket; drawn wide, none
      // does (that was the bug). Anyone who still falls inside a bracket must be faded; none is required to.
      check(sBr >= 8 && !sprob.some((x) => /bracket/.test(x)), `${sBr} group brackets are their own members' sprites + 5 px and hold every member; ${sCovered} other men whose sprite centres fall inside one are faded`);
      check(sFeat >= 15 && sTap === 18 && !sprob.some((x) => /field-feature|tap prompt/.test(x)), `${sFeat} field-feature bubbles and ${sTap} walkthrough prompts fade nobody`);
      // The dad's screenshot (r1-u2 card 1, bubble 4 of 4, zoomed): offense and defense linemen painted over
      // each other. Every settled frame before the snap, at its own camera: no two painted boxes intersect.
      check(ovN >= 60 && ovBad.length === 0, `on ${ovN} settled frames before the snap (cards, notes, walkthrough prompts, each at its own zoom) no two players' sprites intersect ${ovBad.slice(0, 4).join(" | ")}`);
      // Chalk is opt-in and rank 1 asks for none (A6): every frame drew no route and no zone chalk.
      check(n >= 120 && chalkBad.length === 0, `on all ${n} rank-1 bubble frames no route or zone chalk is drawn ${chalkBad.slice(0, 3).join(" | ")}`);
      check(rtN >= 500 && rtBad.length === 0, `after every zoom, yardToScreen -> hitTest returns each of ${rtN} on-screen players and screenToYard inverts it ${rtBad.slice(0, 5).join(', ')}`);
      // A real tap while zoomed: the walkthrough's first prompt on the OL is zoomed; tap the centre's sprite.
      await pb.evaluate(() => { location.hash = '#unit/r1-u3'; }); await settle(pb);
      for (let i = 0; i < 40; i++) { const mc = await mode(pb); if (mc.kind === 'walk') break; if (mc.kind === 'watch') { await pb.evaluate(() => { const C = window.__CS__; C.field.pause(); C.seek(C.T - 0.02); C.field.start(); }); await settle(pb, 300); } await pb.evaluate(() => window.__CS__.ui.next()); await settle(pb, 30); }
      await still(pb);
      const zt = await pb.evaluate(() => window.__CS__.camera.z);
      await tapPlayer(pb, 'RG');
      const wrongZ = await measure2(pb);
      await tapPlayer(pb, 'C');
      const rightZ = await measure2(pb);
      check(zt > 1.5 && wrongZ && wrongZ.tone === 'bad' && /right guard/i.test(wrongZ.text) && rightZ && rightZ.tone === 'good' && /center/i.test(rightZ.text), `zoomed in (z ${zt}), a real tap on the right guard is read as the right guard and a tap on the centre as the centre`);
      check(eb.length === 0, `zero page errors through the bubbles ${JSON.stringify(eb.slice(0, 3))}`);
      await pb.close();
    }

    // B18. Reduced motion: the camera cuts instead of easing, and the bubble is there at once.
    console.log('\n[B18] reduced motion: cuts, not eases');
    {
      const { page: pr, errors: er } = await open(PHONE, { hash: '#unit/r1-u1', storage: USER, reduced: true });
      await settle(pr);
      const seen = await pr.evaluate(() => new Promise((res) => {
        const C = window.__CS__, zs = new Set(), t0 = performance.now();
        let shownAt = null;
        const iv = () => { zs.add(C.camera.z.toFixed(3)); const b = document.getElementById('bubble'); if (shownAt === null && b.offsetParent !== null && b.textContent) shownAt = performance.now() - t0; if (performance.now() - t0 < 700) requestAnimationFrame(iv); else res({ zs: [...zs], shownAt, anim: C.field.camAnimating, z: C.camera.z }); };
        C.ui.next(); requestAnimationFrame(iv);                 // card 1 bubble 1 -> bubble 2: a new focus
      }));
      check(seen.zs.length <= 2 && !seen.anim && seen.shownAt !== null && seen.shownAt < 100, `reduced motion: the camera jumps straight to its framing (zooms seen ${seen.zs.join(', ')}) and the bubble shows within 100 ms (${seen.shownAt && seen.shownAt.toFixed(0)} ms)`);
      // The spotlight cuts too: the OL card, bubble 2 (ol) -> bubble 3 (LT, RT). The left guard goes from
      // lit to faded with no frame in between.
      await pr.evaluate(() => { location.hash = '#unit/r1-u3'; }); await settle(pr);
      await pr.evaluate(() => window.__CS__.ui.next()); await settle(pr, 60);
      const fr = await pr.evaluate(() => new Promise((res) => {
        const C = window.__CS__, as = new Set(), t0 = performance.now();
        const iv = () => { as.add(C.spot ? C.spot.alpha.LG : 'none'); if (performance.now() - t0 < 600) requestAnimationFrame(iv); else res([...as]); };
        C.ui.next(); requestAnimationFrame(iv);
      }));
      check(fr.length === 1 && fr[0] === 0.32, `reduced motion: the fade cuts, the left guard is at 0.32 from the first frame (seen ${fr.join(', ')})`);
      check(er.length === 0, 'zero page errors with reduced motion on the stage');
      await pr.close();
    }

    // B19. A puzzle's wrong answer is told in a red bubble on the man he tapped (plate).
    console.log('\n[B19] puzzle feedback bubbles');
    {
      const { page: pz, errors: ez } = await open(PHONE, { hash: '#unit/r1-u3/puzzles', storage: USER });
      await settle(pz);
      await tapPlayer(pz, 'LG'); await settle(pz, 80);
      const m = await measure2(pz);
      check(m && m.tone === 'bad' && m.targets.length === 1 && m.targets[0].id === 'LG' && /left guard/i.test(m.text) && /One more try/.test(m.text), `a wrong tap gets a red bubble pointing at the left guard ("${m && m.text}")`);
      await plate(pz, 'cs3-puzzle-wrong.png');
      await tapPlayer(pz, 'C'); await settle(pz, 80);
      const m2 = await measure2(pz);
      check(m2 && m2.tone === 'good' && m2.targets[0].id === 'C' && /\+5 XP/.test(m2.text), `right on the second try: a green bubble on the centre with its +5 XP ("${m2 && m2.text.slice(0, 40)}")`);
      // After the answer the play runs: the green bubble stays on the centre, nobody faded.
      await settle(pz, 600);
      const ps = await pz.evaluate(() => { const s = window.__CS__.spot; return s ? { playing: window.__CS__.playing, ids: s.ids, vals: [...new Set(Object.values(s.alpha))] } : null; });
      check(ps && ps.ids === null && ps.vals.length === 1 && ps.vals[0] === 1, `while the answer's play runs nobody is faded (${JSON.stringify(ps)})`);
      check(ez.length === 0, 'zero page errors on the puzzle bubbles');
      await pz.close();
    }

    // B20. No overlapping players before the snap; route chalk only where a step asks (the dad, 2026-11-11,
    // from his phone: "still instances where lines are overlapping", and "don't show receiver routes
    // unless it's relevant for that puzzle or section of the lesson"). The overlap measure is the painted
    // box of each sprite (c.bb, through spriteRect, in CSS px at the frame's own camera). Tolerance 0.01 px:
    // CS.spreadOf leaves at least 1 world px of turf between teammates and NZ_PAD (3) px either side of the
    // line, and feet are rounded to whole world px when drawn, which can eat at most 1 px of that, so boxes
    // may touch but never cross; the shadow is drawn outside the box and is not counted. After the snap the
    // spread eases out and contact is allowed (football).
    console.log('\n[B20] no overlapping players before the snap; routes only where asked');
    {
      const { page: pv, errors: ev } = await open(PHONE, { hash: '#map', storage: USER });
      // (1) Every play in the library, in the film room's frame, before the snap and at the snap.
      const lib = await pv.evaluate(async () => {
        const CS = window.CS, out = [];
        for (const id of Object.keys(CS.lib.PLAYS)) {
          location.hash = '#film/' + id;
          await new Promise((r) => setTimeout(r, 40));
          const C = window.__CS__, F = C.field, cc = CS.compile(CS.lib.PLAYS[id]);
          for (const t of [F.PRE, cc.snapT]) {
            C.seek(t);
            const R = cc.all.map((p) => [p.id, C.spriteRect(p.id)]), ov = [];
            let worst = 0;
            for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
              const a = R[i][1], b = R[j][1], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (w > 0.01 && h > 0.01) { ov.push(`${R[i][0]}/${R[j][0]} ${w.toFixed(1)}x${h.toFixed(1)}`); worst = Math.max(worst, Math.min(w, h)); }
            }
            // Independently of the field's bookkeeping: each sprite's feet are where CS.showAt says he is drawn.
            const shown = CS.showAt ? CS.showAt(CS.lib.PLAYS[id], C.t, F.spread) : null, feet = [];
            if (shown) for (const [pid, r] of R) { const s = C.yardToScreen(shown.players[pid].x, shown.players[pid].y), d = Math.hypot(s.x - r.feetX, s.y - r.feetY); if (d > 1) feet.push(`${pid} ${d.toFixed(1)}`); }
            out.push({ id, t, ov, worst, feet, shown: !!shown, chalk: F.chalk || null, flags: { routes: CS.lib.PLAYS[id].routes, zones: CS.lib.PLAYS[id].zones },
              runners: cc.off.filter((p) => p.role === 'route').map((p) => p.id).sort(), droppers: cc.def.filter((p) => p.role === 'zone').map((p) => p.id).sort() });
          }
        }
        return out;
      });
      const libOv = lib.filter((r) => r.ov.length), worst = lib.reduce((a, b) => (b.worst > a.worst ? b : a));
      check(lib.length >= 56 && libOv.length === 0, `all ${lib.length / 2} library plays, before the snap and at it: no two players' sprites intersect (worst ${worst.id} ${worst.worst.toFixed(1)} px) ${libOv.slice(0, 3).map((r) => r.id + ' t' + r.t + ': ' + r.ov.slice(0, 3).join(', ')).join(' | ')}`);
      const feetBad = lib.filter((r) => !r.shown || r.feet.length);
      check(feetBad.length === 0, `every sprite's feet sit within 1 px of where CS.showAt puts him ${feetBad.slice(0, 3).map((r) => r.id + ': ' + (r.shown ? r.feet.join(',') : 'no CS.showAt')).join(' | ')}`);
      // In the film room each play shows the chalk its own flags ask for, and only that.
      const want = (flag, ids) => (flag === true ? ids : Array.isArray(flag) ? ids.filter((x) => flag.includes(x)) : []);
      const chalkWrong = lib.filter((r) => !r.chalk || JSON.stringify([...r.chalk.routes].sort()) !== JSON.stringify(want(r.flags.routes, r.runners)) || JSON.stringify([...r.chalk.zones].sort()) !== JSON.stringify(want(r.flags.zones, r.droppers)));
      check(chalkWrong.length === 0, `film room: each of ${lib.length / 2} plays draws exactly the routes and zones its flags ask for (smash: all four routes and its zones; rank 1: none) ${chalkWrong.slice(0, 3).map((r) => r.id + ' ' + JSON.stringify(r.chalk)).join(' | ')}`);

      // (2) Every rank-1 lesson puzzle: its frame before the answer (no overlaps, no chalk), then the play
      // that runs after the answer, sampled every 40 ms for 0.8 s (no chalk).
      const units = await pv.evaluate(() => window.CS.RANK_DATA[0].units.map((u) => u.id));
      const pzOv = [], pzChalk = [];
      let pzN = 0, runN = 0;
      for (const uid of units) {
        await pv.evaluate((id) => { location.hash = '#unit/' + id + '/puzzles'; }, uid); await settle(pv, 120);
        for (let k = 0; k < 10; k++) {
          const md = await mode(pv);
          if (!md || md.kind !== 'puzzle') break;
          await still(pv);
          const f = await pv.evaluate(() => {
            const C = window.__CS__, CS = window.CS, cc = CS.compile(C.play), R = cc.all.map((p) => [p.id, C.spriteRect(p.id)]), ov = [];
            for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) { const a = R[i][1], b = R[j][1], w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 0.01 && h > 0.01) ov.push(`${R[i][0]}/${R[j][0]} ${w.toFixed(1)}x${h.toFixed(1)}`); }
            return { pre: C.t <= cc.snapT, ov, chalk: C.field.chalk || null, z: C.camera.z };
          });
          pzN++;
          if (!f.pre || f.ov.length) pzOv.push(`${md.pz}: ${f.pre ? f.ov.slice(0, 3).join(', ') : 'not before the snap'}`);
          if (!f.chalk || f.chalk.routes.length || f.chalk.zones.length) pzChalk.push(`${md.pz} asked: ${JSON.stringify(f.chalk)}`);
          await pv.evaluate(() => window.__CS__.ui.answer(true));
          const run = await pv.evaluate(() => new Promise((res) => { const seen = []; const iv = setInterval(() => seen.push(window.__CS__.field.chalk || null), 40); setTimeout(() => { clearInterval(iv); res({ seen, playing: window.__CS__.playing, t: window.__CS__.t }); }, 800); }));
          runN += run.seen.length;
          if (run.seen.some((c) => !c || c.routes.length || c.zones.length)) pzChalk.push(`${md.pz} running: ${JSON.stringify(run.seen.find((c) => !c || c.routes.length || c.zones.length))}`);
          await pv.evaluate(() => { const C = window.__CS__; C.field.pause(); window.__CS__.ui.next(); }); await settle(pv, 60);
        }
      }
      check(pzN >= 42 && pzOv.length === 0, `${pzN} rank-1 puzzle frames before the answer: no two players' sprites intersect ${pzOv.slice(0, 3).join(' | ')}`);
      check(pzN >= 42 && runN >= pzN * 15 && pzChalk.length === 0, `${pzN} rank-1 puzzles and the ${runN} frames of their answer plays draw no route or zone chalk ${pzChalk.slice(0, 3).join(' | ')}`);

      // (3) A flagged step draws exactly what it flags. Fixtures on the stage field: the step's flag comes
      // with setPlay, a bubble's own flag overrides it while it shows, and the play's flag is the default.
      const fx = await pv.evaluate(async () => {
        const C = window.__CS__, F = C.field, L = window.CS.lib, r = {}, get = () => (F.chalk ? { routes: [...F.chalk.routes].sort(), zones: [...F.chalk.zones].sort() } : null);
        location.hash = '#film/smash-vs-c2'; await new Promise((res) => setTimeout(res, 40));
        F.setPlay(L.PLAYS['smash-vs-c2']); r.playFlag = get();
        F.setPlay(L.PLAYS['smash-vs-c2'], { routes: ['H'], zones: false }); r.stepH = get();
        F.say({ text: 'Watch Z.', focus: ['Z'], routes: ['Z'] }); r.bubbleZ = get();
        F.say({ text: 'The line.', focus: ['ol'] }); r.bubblePlain = get();
        F.say(null); r.after = get();
        F.start();
        const seen = await new Promise((res) => { const s = []; const iv = setInterval(() => s.push(get()), 40); setTimeout(() => { clearInterval(iv); res(s); }, 900); });
        F.pause();
        r.running = seen;
        F.setPlay(L.PLAYS['smash-vs-c2'], { routes: false, zones: false }); r.off = get();
        F.setPlay(L.PLAYS['r1-los']); r.r1 = get();
        F.setPlay(L.PLAYS['r1-los'], { routes: ['Z', 'Y'] }); r.r1ZY = get();
        F.setPlay(L.PLAYS['r1-los'], { routes: true }); r.r1All = get();
        r.r1Runners = window.CS.compile(L.PLAYS['r1-los']).off.filter((p) => p.role === 'route').map((p) => p.id).sort();
        r.smashDrop = window.CS.compile(L.PLAYS['smash-vs-c2']).def.filter((p) => p.role === 'zone').map((p) => p.id).sort();
        return r;
      });
      const J = JSON.stringify;
      check(fx.playFlag && J(fx.playFlag.routes) === J(['H', 'X', 'Y', 'Z']) && J(fx.playFlag.zones) === J(fx.smashDrop), `the smash play's own flags draw its four routes and its ${fx.smashDrop.length} zones ${J(fx.playFlag)}`);
      check(fx.stepH && J(fx.stepH.routes) === J(['H']) && fx.stepH.zones.length === 0, `a step flagged routes ['H'] draws H's route and nobody else's ${J(fx.stepH)}`);
      check(fx.bubbleZ && J(fx.bubbleZ.routes) === J(['Z']) && fx.bubblePlain && J(fx.bubblePlain.routes) === J(['H']) && fx.after && J(fx.after.routes) === J(['H']), `a bubble flagged ['Z'] shows Z's instead while it is up; an unflagged bubble and no bubble fall back to the step's ['H'] ${J([fx.bubbleZ, fx.bubblePlain, fx.after])}`);
      check(fx.running.length >= 15 && fx.running.every((c) => c && J(c.routes) === J(['H']) && !c.zones.length), `while the flagged step's play runs (${fx.running.length} frames) it draws H's route alone`);
      check(fx.off && !fx.off.routes.length && !fx.off.zones.length && fx.r1 && !fx.r1.routes.length && !fx.r1.zones.length, `routes: false turns even smash's chalk off; a rank-1 play draws none by default`);
      check(fx.r1ZY && J(fx.r1ZY.routes) === J(['Y', 'Z']) && fx.r1All && J(fx.r1All.routes) === J(fx.r1Runners) && fx.r1Runners.length >= 3, `a rank-1 play flagged ['Z','Y'] draws exactly Y and Z; flagged true, all ${fx.r1Runners.length} route runners ${J([fx.r1ZY, fx.r1All])}`);
      check(ev.length === 0, `zero page errors through B20 ${J(ev.slice(0, 3))}`);
      await pv.close();
    }
  }
}

// With --only and no chosen module that has a browser half (e.g. --only lib), there is nothing for Chrome to run.
if (!NODE_ONLY && !(ONLY && !MODS.some((m) => m.mod.browser))) {
  try { await sectionB(); } catch (e) { FAIL++; fails.push('section B crashed: ' + e.message); console.log('  FAIL section B crashed: ' + (e.stack || e)); }
}
console.log(`\n${PASS}/${PASS + FAIL} passed`);
if (FAIL) { console.log('failures:\n  ' + fails.join('\n  ')); process.exit(1); }
