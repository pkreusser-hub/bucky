#!/usr/bin/env node
/**
 * Coach School library suite (Node only, vm-loaded cs-core.js + cs-lib.js). Standalone for now;
 * it folds into the modular Coach School suite later.
 *
 * Every expected number below is typed by hand from docs/coachschool-facts.md (section named at
 * each table), never read back from the library, so a library value that drifts from the sheet
 * fails here.
 *
 *   node tools/_verify-coachschool-lib.mjs              check the real library
 *   node tools/_verify-coachschool-lib.mjs --lib FILE   check another cs-lib.js (bite proofs)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const argv = process.argv.slice(2);
const LIB = argv.includes('--lib') ? path.resolve(argv[argv.indexOf('--lib') + 1]) : path.join(ROOT, 'assets/coachschool/cs-lib.js');

let PASS = 0, FAIL = 0;
const fails = [];
function check(cond, msg) {
  if (cond) { PASS++; console.log('  ok   ' + msg); }
  else { FAIL++; fails.push(msg); console.log('  FAIL ' + msg); }
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const J = JSON.stringify;
const sortJ = (a) => J([...a].sort());

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/coachschool/cs-core.js'), 'utf8'), ctx, { filename: 'cs-core.js' });
vm.runInContext(fs.readFileSync(LIB, 'utf8'), ctx, { filename: 'cs-lib.js' });
const CS = ctx.CS, L = CS.lib;
console.log(`library: ${path.relative(ROOT, LIB)}`);
// validatePlay compiles the play, and cs-core throws on an unknown route: report that as a failure, not a crash.
const validates = (p) => { try { return CS.validatePlay(p); } catch (err) { return [`${p.id}: throws ${err.message}`]; } };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Every pose from just before the snap to the end of the play, every 0.05 s: no NaN anywhere.
function poseClean(play) {
  const T = CS.playLength(play);
  for (let t = -1.2; t <= T + 1e-9; t += 0.05) {
    const s = CS.poseAt(play, t);
    for (const [id, q] of Object.entries(s.players)) if (!finite(q.x) || !finite(q.y)) return `${id} NaN at t ${t.toFixed(2)}`;
    if (!finite(s.ball.x) || !finite(s.ball.y) || !finite(s.ball.air)) return `ball NaN at t ${t.toFixed(2)}`;
  }
  return null;
}

/* ═════ the fact sheet, by section, for src quotes ═════ */
const SHEET = fs.readFileSync(path.join(ROOT, 'docs/coachschool-facts.md'), 'utf8');
const norm = (s) => String(s).replace(/[*`]/g, '').replace(/\s+/g, ' ').trim();
const SECTIONS = {};
{
  const lines = SHEET.split('\n');
  let cur2 = null, cur3 = null;
  for (const ln of lines) {
    let m;
    if ((m = /^## (\d+)\. /.exec(ln))) { cur2 = m[1]; cur3 = null; SECTIONS[cur2] = ''; continue; }
    if ((m = /^## Rank (\d)/.exec(ln))) { cur2 = 'rank' + m[1]; cur3 = null; SECTIONS[cur2] = ''; continue; }
    if (/^## /.test(ln)) { cur2 = null; cur3 = null; continue; }
    if ((m = /^### (\d+[a-z])\. /.exec(ln))) { cur3 = m[1]; SECTIONS[cur3] = ''; continue; }
    if (/^### /.test(ln)) { cur3 = null; }
    if (cur2) SECTIONS[cur2] += ln + '\n';
    if (cur3) SECTIONS[cur3] += ln + '\n';
  }
  for (const k of Object.keys(SECTIONS)) SECTIONS[k] = norm(SECTIONS[k]);
}
const quoteOk = (s) => s && SECTIONS[s.sec] != null && norm(s.q).length >= 6 && SECTIONS[s.sec].includes(norm(s.q));

/* ═════ L1. Formations (fact sheet 1a/1b) ═════ */
console.log('\n[L1] formations (sheet 1a, 1b)');
// 1a: the line. 1b: everyone else, strength right. [x, y] per player, typed from the sheet.
const OL = { LT: [23.67, 0], LG: [25.17, 0], C: [26.67, 0], RG: [28.17, 0], RT: [29.67, 0] };
const SHEET_1B = {
  'i-form': { per: '21', p: { ...OL, X: [6, 0], Y: [31.17, 0], Z: [47.33, -1], QB: [26.67, -1], FB: [26.67, -4.5], RB: [26.67, -7] } },
  singleback: { per: '11', p: { ...OL, X: [6, 0], Y: [31.17, 0], H: [15, -1], Z: [47.33, -1], QB: [26.67, -1], RB: [26.67, -6.5] } },
  ace: { per: '12', p: { ...OL, U: [22.17, 0], Y: [31.17, 0], X: [6, -1], Z: [47.33, -1], QB: [26.67, -1], RB: [26.67, -6.5] } },
  'gun-2x2': { per: '11', p: { ...OL, X: [6, 0], Z: [47.33, 0], H: [15, -1], Y: [38.33, -1], QB: [26.67, -5], RB: [28.67, -5] } },
  'gun-trips-rt': { per: '11', p: { ...OL, X: [6, 0], Z: [47.33, 0], Y: [34.67, -1], H: [39.67, -1], QB: [26.67, -5], RB: [24.67, -5] } },
  'gun-bunch-rt': { per: '11', p: { ...OL, X: [6, 0], Z: [39.67, 0], H: [38.67, -1], Y: [40.67, -1], QB: [26.67, -5], RB: [24.67, -5] } },
  'gun-empty': { per: '11', p: { ...OL, X: [6, 0], Z: [47.33, 0], H: [15, -1], Y: [34.67, -1], RB: [39.67, -1], QB: [26.67, -5] } },
  pistol: { per: '11', p: { ...OL, X: [6, 0], Y: [31.17, 0], H: [15, -1], Z: [47.33, -1], QB: [26.67, -4], RB: [26.67, -7] } },
};
check(sortJ(Object.keys(L.FORMATIONS)) === sortJ(Object.keys(SHEET_1B)), `the library has exactly the sheet's 8 formations (${Object.keys(L.FORMATIONS).join(', ')})`);
const SWAP = { LT: 'RT', RT: 'LT', LG: 'RG', RG: 'LG' };
// Formation strength (sheet, "Formation strength"): the TE side; one TE each side -> the side with
// more receivers; still level -> the field side. The Ace (1b) has U left and Y right, X left and Z
// right: 1 TE + 2 receivers a side, level on both counts, so its strength is the field side. On a
// hash the defense must set to the field: hash L (field right) = the defense as drawn, hash R
// (field left) = mirrored. In the middle there is no field side and any setting is legal.
// (An earlier draft of this suite played the Ace unmirrored on the right hash; cs-core rightly
// refuses that, since the Sam and SS would line up to the boundary.)
const BALANCED = new Set(['ace']);
const setsToField = (fid, mirror, hash) => !BALANCED.has(fid) || hash === 'M' || mirror === (hash === 'R');
for (const [id, want] of Object.entries(SHEET_1B)) {
  const f = L.FORMATIONS[id];
  if (!f) { check(false, `${id}: missing`); continue; }
  const ps = CS.resolveSet(f);
  // Counted here, not by the validator: on the line = y >= -0.5 (sheet 1b: on-line y = 0, off y <= -1).
  const on = ps.filter((p) => p.y >= -0.5), off = ps.filter((p) => p.y < -0.5);
  const rb = ps.filter((p) => p.pos === 'RB' || p.pos === 'FB').length, te = ps.filter((p) => p.pos === 'TE').length;
  let minD = Infinity;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) minD = Math.min(minD, Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y));
  check(ps.length === 11 && on.length === 7 && off.length === 4, `${id}: 11 players, exactly 7 on the line and 4 off (${ps.length}: ${on.length} + ${off.length})`);
  check(on.every((p) => p.y === 0) && off.every((p) => p.y <= -1), `${id}: on-line men at y 0, off-line men at y -1 or deeper`);
  check(`${rb}${te}` === want.per && f.personnel === want.per, `${id}: personnel ${want.per} = ${rb} backs + ${te} TE (library says ${f.personnel})`);
  const posBad = ps.filter((p) => !want.p[p.id] || !near(p.x, want.p[p.id][0], 1e-9) || p.y !== want.p[p.id][1]).map((p) => `${p.id}(${p.x},${p.y})`);
  check(posBad.length === 0 && ps.length === Object.keys(want.p).length, `${id}: every man on the sheet's spot ${posBad.join(' ')}`);
  const inb = (dX) => ps.every((p) => p.x + dX > 0 && p.x + dX < 53.33);
  check(inb(0) && inb(CS.HASH_L - CS.BALL_X) && inb(CS.HASH_R - CS.BALL_X), `${id}: in bounds with the ball in the middle and on either hash`);
  check(minD >= 0.8, `${id}: no two players within 0.8 yd (closest ${minD.toFixed(2)})`);
  check(CS.validateFormation(f).length === 0, `${id}: validator clean ${J(CS.validateFormation(f))}`);
  // Mirror (sheet 1b: x -> 53.33 - x; cs-core mirrors about the ball, 2 * 26.67 - x): every man flips, the tackles and guards swap names.
  const m = CS.mirrorFormation(f), mp = CS.resolveSet(m);
  const mBad = ps.filter((p) => { const q = mp.find((r) => r.id === (SWAP[p.id] || p.id)); return !q || !near(q.x, 2 * 26.67 - p.x, 1e-9) || q.y !== p.y; }).map((p) => p.id);
  check(mBad.length === 0 && m.strength === 'L' && CS.validateFormation(m).length === 0, `${id}: mirror flips every man to 2*26.67 - x, strength to L, still legal ${mBad.join(' ')}`);
  // Usable on both hashes and mirrored, against a defense: a real play compiles and runs.
  const bad = [];
  for (const mirror of [false, true]) for (const hash of ['L', 'M', 'R']) {
    if (!setsToField(id, mirror, hash)) continue;
    const play = { id: `f-${id}-${mirror}-${hash}`, formation: id, defense: 'c3-43-over', mirror, hash, teams: { off: 'KC', def: 'BUF' }, assign: { QB: { drop: 3 } }, ball: [{ t: 0, ev: 'snap' }] };
    const e = validates(play), n = e.length ? null : poseClean(play);
    if (e.length || n) bad.push(`${mirror ? 'mirror' : 'plain'}/${hash}: ${e.join('; ') || n}`);
  }
  check(bad.length === 0, `${id}: plays mirrored and on hash L / middle / R against a 4-3${BALANCED.has(id) ? ' (defense set to the field)' : ''} ${bad.slice(0, 2).join(' | ')}`);
}
// A balanced formation's strength is the field side, so a strength-right defense on the right hash
// (field to the left) is refused: the Sam and the SS would stand on the boundary.
{
  const wrong = { id: 'f-ace-wrong', formation: 'ace', defense: 'c3-43-over', hash: 'R', teams: { off: 'KC', def: 'BUF' }, assign: { QB: { drop: 3 } }, ball: [{ t: 0, ev: 'snap' }] };
  check(CS.validatePlay(wrong).some((e) => /SAM lines up R, but the strength is L/.test(e)), 'ace on the right hash with an unmirrored defense is refused (strength = the field side, left)');
}
// The validator still bites on a broken copy of each new formation.
for (const id of ['gun-bunch-rt', 'gun-empty']) {
  const f = JSON.parse(J(L.FORMATIONS[id])); f.id = 'broken'; const h = f.players.find((p) => p.id === 'H'); h.y = 0; delete h.on;
  check(CS.validateFormation(f).some((e) => /8 on the line/.test(e)), `${id}: a copy with the slot stepped up to the line is flagged (8 on the line)`);
}
// Personnel codes (sheet 2): [backs, TEs, WRs].
const PER2 = { 10: [1, 0, 4], 11: [1, 1, 3], 12: [1, 2, 2], 13: [1, 3, 1], 21: [2, 1, 2], 22: [2, 2, 1] };
check(sortJ(Object.keys(L.PERSONNEL)) === sortJ(Object.keys(PER2)) && Object.entries(PER2).every(([k, v]) => J([L.PERSONNEL[k].backs, L.PERSONNEL[k].te, L.PERSONNEL[k].wr]) === J(v) && v[0] + v[1] + v[2] === 5), 'personnel table = sheet 2 (10, 11, 12, 13, 21, 22; WR = 5 - backs - TEs)');

/* ═════ L2. Zone landmarks (fact sheet 4) ═════ */
console.log('\n[L2] zone landmarks (sheet 4)');
// [landmark x, landmark y, x range lo, hi, depth band lo, hi (null = open)], both columns as printed.
const SHEET_4 = {
  'flat-L': [5, 6, 0, 9, 0, 8], 'flat-R': [48.33, 6, 44.33, 53.33, 0, 8],
  'curl-L': [12, 11, 9, 18, 8, 14], 'curl-R': [41.33, 11, 35.33, 44.33, 8, 14],
  'hook-L': [21, 10, 18, 26.67, 8, 12], 'hook-R': [32.33, 10, 26.67, 35.33, 8, 12],
  'hook-M': [26.67, 11, 22, 31.33, 8, 14], 'hole-M': [26.67, 18, 22, 31.33, 12, 22],
  'deep-third-L': [9, 16, 0, 17.78, 12, null], 'deep-third-M': [26.67, 16, 17.78, 35.56, 12, null], 'deep-third-R': [44.33, 16, 35.56, 53.33, 12, null],
  'deep-half-L': [18, 16, 0, 26.67, 12, null], 'deep-half-R': [35.33, 16, 26.67, 53.33, 12, null],
  'deep-quarter-L': [7, 14, 0, 13.33, 10, null], 'deep-quarter-LM': [20, 14, 13.33, 26.67, 10, null],
  'deep-quarter-RM': [33.33, 14, 26.67, 40, 10, null], 'deep-quarter-R': [46.33, 14, 40, 53.33, 10, null],
};
for (const [id, w] of Object.entries(SHEET_4)) {
  const z = L.ZONES[id];
  check(z && z.x === w[0] && z.y === w[1] && J(z.xr) === J([w[2], w[3]]) && J(z.band) === J([w[4], w[5]]), `${id}: landmark (${w[0]}, ${w[1]}), x ${w[2]}-${w[3]}, depth ${w[4]}-${w[5] == null ? '' : w[5]} ${z ? J([z.x, z.y, z.xr, z.band]) : 'missing'}`);
}
// Combined zones start from their first zone's landmark (sheet 4: curl-flat = curl then flat; hook-curl = hook then curl).
for (const [id, first] of [['curl-flat-L', 'curl-L'], ['curl-flat-R', 'curl-R'], ['hook-curl-L', 'hook-L'], ['hook-curl-R', 'hook-R']]) {
  check(L.ZONES[id] && L.ZONES[id].x === L.ZONES[first].x && L.ZONES[id].y === L.ZONES[first].y, `${id} starts at ${first}'s landmark`);
}
const deepIds = Object.keys(L.ZONES).filter((k) => L.ZONES[k].deep === true).sort();
check(J(deepIds) === sortJ(Object.keys(SHEET_4).filter((k) => /^deep-/.test(k))), `deep = exactly the deep thirds, halves and quarters (${deepIds.length}); the Tampa 2 middle hole is not counted deep`);
check(Object.keys(L.ZONES).length === Object.keys(SHEET_4).length + 4, `no zone outside the sheet (${Object.keys(L.ZONES).length} = 17 + 4 combined)`);

/* ═════ L3. Defenses (fact sheet 1c-1e, 5a, 9) ═════ */
console.log('\n[L3] defenses (sheet 1d, 1e, 5a, 9)');
const COVS = ['cov:0', 'cov:1', 'cov:2', 'cov:tampa2', 'cov:3', 'cov:4', 'cov:6', 'cov:2man'];
const CID = { 'cov:0': 'c0', 'cov:1': 'c1', 'cov:2': 'c2', 'cov:tampa2': 't2', 'cov:3': 'c3', 'cov:4': 'c4', 'cov:6': 'c6', 'cov:2man': 'c2m' };
const FRONT_IDS = ['43-over', '43-under', '34', 'nickel', 'dime'];
const WANT_D = [...COVS.flatMap((c) => FRONT_IDS.map((f) => `${CID[c]}-${f}`)), 'fz-nickel', 'sim-nickel'];
check(sortJ(Object.keys(L.DEFENSES)) === sortJ(WANT_D), `42 defenses: 5 fronts x 8 coverages + fire zone + sim pressure (${Object.keys(L.DEFENSES).length})`);
// Deep defenders per coverage, from 5a's "deep" column, by hand:
//   Cover 0 = 0: everybody is man or rushing, no deep help.
//   Cover 1 = 1: the FS alone in the deep middle.
//   Cover 2 = 2: FS + SS, a deep half each.
//   Tampa 2 = 2 (+ the Mike in the middle hole, 12-22 yd, which 5a counts as "2 + Mike", not a third deep zone).
//   Cover 3 = 3: CB-L + CB-R + FS, a deep third each.
//   Cover 4 = 4: CB-L Q1 + FS Q2 + SS Q3 + CB-R Q4.
//   Cover 6 = 3: FS deep half L (the Cover 2 side) + SS Q3 + CB-R Q4 (the quarters side) = 1 + 2.
//   2-man  = 2: FS + SS deep halves, five man underneath.
//   fire zone (9) = 3: two corners + one safety. sim (9): "varies (often 2 or 3)"; CS draws it over Cover 3 = 3.
const DEEP = { 'cov:0': 0, 'cov:1': 1, 'cov:2': 2, 'cov:tampa2': 2, 'cov:3': 3, 'cov:4': 4, 'cov:6': 3, 'cov:2man': 2 };
// Rushers (5a "rush" column): Cover 0 = 6 (four DL + SS + Will; the Mike's 7th is conditional), Cover 1
// "4-5" drawn as 4 (the Will plays the robber), the rest 4; fire zone 5; sim 4 (9).
const RUSH = { 'cov:0': 6, 'cov:1': 4, 'cov:2': 4, 'cov:tampa2': 4, 'cov:3': 4, 'cov:4': 4, 'cov:6': 4, 'cov:2man': 4 };
// 5a, typed again by hand: each role's job ('man X', a zone id, or 'rush').
const SHEET_5A = {
  'cov:0': { 'CB-L': 'man X', 'CB-R': 'man Z', FS: 'man H', SS: 'rush', NB: 'man Y', MIKE: 'man RB', WILL: 'rush' },
  'cov:1': { 'CB-L': 'man X', 'CB-R': 'man Z', FS: 'deep-third-M', SS: 'man H', NB: 'man Y', MIKE: 'man RB', WILL: 'hook-M' },
  'cov:2': { 'CB-L': 'flat-L', 'CB-R': 'flat-R', FS: 'deep-half-L', SS: 'deep-half-R', NB: 'hook-curl-R', MIKE: 'hook-M', WILL: 'hook-curl-L' },
  'cov:tampa2': { 'CB-L': 'flat-L', 'CB-R': 'flat-R', FS: 'deep-half-L', SS: 'deep-half-R', NB: 'hook-curl-R', MIKE: 'hole-M', WILL: 'hook-curl-L' },
  'cov:3': { 'CB-L': 'deep-third-L', 'CB-R': 'deep-third-R', FS: 'deep-third-M', SS: 'hook-R', NB: 'curl-flat-R', MIKE: 'hook-L', WILL: 'curl-flat-L' },
  'cov:4': { 'CB-L': 'deep-quarter-L', 'CB-R': 'deep-quarter-R', FS: 'deep-quarter-LM', SS: 'deep-quarter-RM', NB: 'curl-flat-R', MIKE: 'hook-M', WILL: 'curl-flat-L' },
  'cov:6': { 'CB-L': 'flat-L', 'CB-R': 'deep-quarter-R', FS: 'deep-half-L', SS: 'deep-quarter-RM', NB: 'curl-flat-R', MIKE: 'hook-M', WILL: 'hook-curl-L' },
  'cov:2man': { 'CB-L': 'man X', 'CB-R': 'man Z', FS: 'deep-half-L', SS: 'deep-half-R', NB: 'man Y', MIKE: 'man RB', WILL: 'man H' },
};
// Who holds each 5a role in each front (the library's mapping, restated: base has no NB, the dime one LB).
const HOLDER = {
  '43-over': { NB: 'SAM', MIKE: 'MIKE', WILL: 'WILL' }, '43-under': { NB: 'SAM', MIKE: 'MIKE', WILL: 'WILL' }, 34: { NB: 'OLB-R', MIKE: 'MIKE', WILL: 'WILL' },
  nickel: { NB: 'NB', MIKE: 'MIKE', WILL: 'WILL' }, dime: { NB: 'NB', MIKE: 'MIKE', WILL: 'DIME' },
};
// 1d/1e alignments, by hand: [x, y] of every front player (DBs at the tables' spots unless a coverage moves them).
const SHEET_FRONT = {
  '43-over': { 'DE-R': [30.17, 1], 'DT-R': [28.67, 1], 'DT-L': [26.17, 1], 'DE-L': [23.17, 1], SAM: [32.67, 4.5], MIKE: [27.67, 4.5], WILL: [24.17, 4.5] },
  '43-under': { 'DE-R': [30.17, 1], NT: [27.17, 1], 'DT-L': [24.67, 1], 'DE-L': [22.67, 1], SAM: [31.67, 1], MIKE: [28.17, 4.5], WILL: [24.17, 4.5] },
  34: { NT: [26.67, 1], 'DE-R': [29.67, 1], 'DE-L': [23.67, 1], 'OLB-R': [32.17, 1], 'OLB-L': [21.67, 1], MIKE: [28.17, 4.5], WILL: [25.17, 4.5] },
  nickel: { 'DE-R': [30.17, 1], 'DT-R': [28.67, 1], 'DT-L': [26.17, 1], 'DE-L': [23.17, 1], MIKE: [27.17, 4.5], WILL: [20, 4.5], NB: [37.33, 5] },
  dime: { 'DE-R': [30.17, 1], 'DT-R': [28.67, 1], 'DT-L': [26.17, 1], 'DE-L': [23.17, 1], MIKE: [26.67, 5.5], NB: [37.33, 5], DIME: [16, 5] },
};
const DBN = { base: 4, nickel: 5, dime: 6 };      // CB + S (+ NB, + dime): base 4 DBs, nickel 5, dime 6 (sheet rank 2)
const jobOf = (p) => (p.man ? 'man ' + p.man : p.rush ? 'rush' : p.zone);
const deepByName = (d) => d.players.filter((p) => /^deep-/.test(p.zone || '')).length;
const rushN = (d) => d.players.filter((p) => p.rush).length;
for (const cov of COVS) for (const fr of FRONT_IDS) {
  const id = `${CID[cov]}-${fr}`, d = L.DEFENSES[id];
  if (!d) { check(false, `${id}: missing`); continue; }
  const ps = CS.resolveSet(d), errs = CS.validateDefense(d);
  const dbs = d.players.filter((p) => ['CB', 'S', 'NB'].includes(p.pos)).length;
  check(ps.length === 11 && errs.length === 0 && d.coverage === cov, `${id}: 11 defenders, validator clean, coverage ${cov} ${J(errs)}`);
  check(deepByName(d) === DEEP[cov] && CS.deepCount(d) === DEEP[cov], `${id}: ${DEEP[cov]} deep (by zone name ${deepByName(d)}, CS.deepCount ${CS.deepCount(d)})`);
  check(rushN(d) === RUSH[cov], `${id}: ${RUSH[cov]} rushers (${rushN(d)})`);
  check(dbs === DBN[d.personnel] && d.personnel === (fr === 'nickel' ? 'nickel' : fr === 'dime' ? 'dime' : 'base'), `${id}: ${d.personnel} personnel, ${dbs} DBs`);
  // 5a, role by role, through the front's holder.
  const holder = { 'CB-L': 'CB-L', 'CB-R': 'CB-R', FS: 'FS', SS: 'SS', ...HOLDER[fr] };
  const jobBad = Object.entries(SHEET_5A[cov]).filter(([role, job]) => { const p = d.players.find((q) => q.id === holder[role]); return !p || jobOf(p) !== job || p.as5a !== role; }).map(([r]) => r);
  check(jobBad.length === 0, `${id}: every 5a job where the sheet puts it ${jobBad.join(' ')}`);
  // 1d/1e front spots (a Cover 0 press or walk-down moves only DBs and the SS).
  const spotBad = Object.entries(SHEET_FRONT[fr]).filter(([pid, [x, y]]) => {
    const p = d.players.find((q) => q.id === pid);
    if (!p) return true;
    if (p.press && pid === 'NB') return false;                                 // Cover 0's nickel presses the flexed TE (checked below)
    return !(near(p.x, x) && p.y === y);
  }).map(([pid]) => pid);
  check(spotBad.length === 0, `${id}: front on the sheet's spots (${fr === 'nickel' || fr === 'dime' ? '1e' : '1d'}) ${spotBad.join(' ')}`);
  // The DL rush the gap their technique sits in (8): 1 -> A, 3 -> B, 5 / wide 5 -> C; 0 and 4 (two-gap) any adjacent.
  const dl = d.players.filter((p) => ['DE', 'DT', 'NT'].includes(p.pos));
  const lane = { 1: 'A', 3: 'B', 5: 'C', 'wide 5': 'C' };
  check(dl.length === (fr === '34' ? 3 : 4) && dl.every((p) => !lane[p.tech] || (p.rush || '').startsWith(lane[p.tech])), `${id}: ${dl.length} down linemen, each rushing his technique's gap`);
  // 1c depths and 5b tells.
  const cb = d.players.filter((p) => p.pos === 'CB'), sf = d.players.filter((p) => p.pos === 'S');
  const press = ['cov:0', 'cov:1', 'cov:2man'].includes(cov);
  const recvX = { X: 6, Z: 47.33, H: 15, Y: fr === 'nickel' || fr === 'dime' ? 38.33 : 31.17 };
  if (press) check(cb.every((p) => p.y === 1 && near(p.x, recvX[p.man])), `${id}: corners pressed (y 1, sheet 1c) on their man's x`);
  if (cov === 'cov:2' || cov === 'cov:tampa2') check(cb.every((p) => p.y === 5), `${id}: corners shallow at 5 yd (5b "≈5 yd")`);
  if (cov === 'cov:3' || cov === 'cov:4') check(cb.every((p) => p.y === 7), `${id}: corners off at 7 yd (1c)`);
  if (cov === 'cov:4') check(sf.every((p) => p.y === 10), `${id}: safeties at 10 yd (5b "≈10 yd")`);
  if (cov === 'cov:6') check(d.players.find((p) => p.id === 'CB-L').y === 5 && d.players.find((p) => p.id === 'CB-L').cloud === true && d.players.find((p) => p.id === 'CB-R').y === 7, `${id}: the cloud corner squats (5), the quarters corner is off (7)`);
  if (cov === 'cov:0') {
    const tight = d.players.filter((p) => p.man && p.man !== 'RB' && p.pos !== 'LB');
    check(tight.every((p) => p.y === 1 && near(p.x, recvX[p.man])) && tight.length >= 3, `${id}: every DB in man is tight on his receiver (5b), ${tight.length} of them`);
  }
  if (cov === 'cov:tampa2') check(d.players.find((p) => p.id === 'MIKE').zone === 'hole-M' && !L.ZONES['hole-M'].deep, `${id}: the Mike runs the middle hole (2 deep + Mike)`);
  if (cov === 'cov:6') check(d.players.filter((p) => /^deep-quarter/.test(p.zone || '')).length === 2 && d.players.filter((p) => /^deep-half/.test(p.zone || '')).length === 1, `${id}: 2 quarters + 1 half`);
  if (cov === 'cov:4') check(d.players.filter((p) => /^deep-quarter/.test(p.zone || '')).length === 4, `${id}: 4 quarters`);
  if (cov === 'cov:0') check(d.players.filter((p) => p.zone).length === 0, `${id}: nobody in a zone`);
}
// Pressure packages (9).
{
  const fz = L.DEFENSES['fz-nickel'], sim = L.DEFENSES['sim-nickel'];
  const under = (d) => d.players.filter((p) => p.zone && !L.ZONES[p.zone].deep);
  const dlIds = ['DE-R', 'DT-R', 'DT-L', 'DE-L'];
  check(fz && CS.validateDefense(fz).length === 0 && rushN(fz) === 5 && CS.deepCount(fz) === 3 && under(fz).length === 3, `fire zone: 5 rush, 3 under, 3 deep (${fz && [rushN(fz), under(fz).length, CS.deepCount(fz)]})`);
  check(fz && sortJ(under(fz).map((p) => p.zone.replace(/-[LRM]$/, ''))) === J(['curl-flat', 'curl-flat', 'hook']) && fz.players.filter((p) => /^deep-/.test(p.zone || '')).every((p) => ['CB-L', 'CB-R', 'FS', 'SS'].includes(p.id)) && fz.players.filter((p) => /^deep-/.test(p.zone || '') && p.pos === 'CB').length === 2, 'fire zone: two curl-flat + one hook/middle under; two corners + one safety deep');
  const simRush = sim ? sim.players.filter((p) => p.rush) : [];
  check(sim && CS.validateDefense(sim).length === 0 && simRush.length === 4 && simRush.some((p) => !dlIds.includes(p.id)) && sim.players.some((p) => dlIds.includes(p.id) && p.zone) && sim.players.filter((p) => p.zone).length === 7, 'sim pressure: 4 rush, not the usual four (a LB rushes, a DL drops), 7 in zone');
  check(J(L.PRESSURES['cover-0-blitz'].defenses.slice().sort()) === sortJ(FRONT_IDS.map((f) => 'c0-' + f)) && L.PRESSURES['cover-0-blitz'].defenses.every((id) => rushN(L.DEFENSES[id]) >= 6 && CS.deepCount(L.DEFENSES[id]) === 0), 'Cover 0 blitz = the Cover 0 defenses: 6 or more rush, 0 deep');
}
// Every defense plays against every formation it fits (a man defense needs every receiver it names), mirrored and on both hashes.
{
  const probs = [];
  for (const d of Object.values(L.DEFENSES)) {
    const need = d.players.filter((p) => p.man).map((p) => p.man).concat(d.players.filter((p) => p.ifBlocks).map(() => 'RB'));
    const fits = Object.values(L.FORMATIONS).filter((f) => need.every((id) => f.players.some((p) => p.id === id)));
    if (!fits.length) { probs.push(`${d.id}: fits no formation`); continue; }
    if (d.drawnVs && !fits.some((f) => f.id === d.drawnVs)) probs.push(`${d.id}: does not fit its own ${d.drawnVs}`);
    for (const f of fits) for (const mirror of [false, true]) for (const hash of ['L', 'R']) {
      if (!setsToField(f.id, mirror, hash)) continue;
      const play = { id: `d-${d.id}-${f.id}`, formation: f.id, defense: d.id, mirror, hash, teams: { off: 'KC', def: 'BUF' }, assign: { QB: { drop: 3 } }, ball: [{ t: 0, ev: 'snap' }] };
      const e = validates(play), n = e.length ? null : poseClean(play);
      if (e.length || n) probs.push(`${d.id} vs ${f.id}${mirror ? ' mirrored' : ''} hash ${hash}: ${e[0] || n}`);
    }
  }
  check(probs.length === 0, `every defense compiles and runs against every formation it fits, mirrored and on both hashes ${probs.slice(0, 3).join(' | ')}`);
  const man = Object.values(L.DEFENSES).filter((d) => d.players.some((p) => p.man));
  const iform = man.filter((d) => { try { CS.compile({ id: 'x-' + d.id, formation: 'i-form', defense: d.id, teams: { off: 'KC', def: 'BUF' }, ball: [{ t: 0, ev: 'snap' }] }); return CS.validatePlay({ id: 'y-' + d.id, formation: 'i-form', defense: d.id, teams: { off: 'KC', def: 'BUF' }, ball: [{ t: 0, ev: 'snap' }] }).length === 0; } catch (e) { return false; } });
  // 3 man coverages (Cover 0, Cover 1, 2-man) x 5 fronts = 15. (The first draft wrote 20, a
  // miscount; fire zone and sim pressure play zone behind the rush and name no man.)
  check(man.length === 15 && iform.length === 0, `the 15 man defenses (Cover 0, 1, 2-man x 5 fronts) are refused against the I-form, which has no H (${man.length}, ${iform.length} accepted)`);
}
// Every mapped or engine-picked choice is labelled as such (never taught as a fact).
check(Object.values(L.DEFENSES).every((d) => (['nickel'].includes(d.front) && !d.pressure ? d.mapped === null : typeof d.mapped === 'string' && d.mapped.length > 20)), 'only the nickel coverages are 5a as printed; every other defense carries its mapping in `mapped`');
check(Object.values(L.DEFENSES).every((d) => d.players.every((p) => !p.rush || ['DE', 'DT', 'NT'].includes(p.pos) || p.as5a === 'fourth rusher' || p.gapPick)), 'every non-lineman rusher\'s gap is marked gapPick (the sheet names who rushes, not where)');

/* ═════ L4. Routes (fact sheet 3) ═════ */
console.log('\n[L4] routes (sheet 3)');
// Waypoints exactly as section 3 prints them.
const SHEET_3 = {
  hitch: [[0, 6], ['in', 0.5, 5]], flat: [['out', 2, 2], ['out', 10, 3]], slant: [[0, 3], ['in', 5, 8]], comeback: [[0, 15], ['out', 3, 12]],
  curl: [[0, 12], ['in', 1.5, 10.5]], out: [[0, 10], ['out', 8, 10]], dig: [[0, 12], ['in', 12, 12]], corner: [[0, 12], ['out', 8, 20]],
  post: [[0, 12], ['in', 8, 20]], go: [[0, 25]],
  seam: [[0, 25]], drag: [['in', 2, 2], ['in', 15, 4]], stick: [[0, 6], [0, 6]], sail: [[0, 10], ['out', 10, 14]],
  wheel: [['out', 4, 2], ['out', 8, 5], ['out', 8, 25]], arrow: [['out', 5, 4]], whip: [['in', 2, 4], ['out', 4, 4]], bubble: [['out', 3, -1], ['out', 6, 0]],
  // concept-specific (6, dagger: "#1 dig at 15-18"): the tree dig's shape at 15
  'dagger-dig': [[0, 15], ['in', 12, 15]],
};
check(sortJ(Object.keys(L.ROUTES)) === sortJ(Object.keys(SHEET_3)), `19 routes: the 10-route tree, the sheet's 8 named routes and dagger's 15-yd dig (${Object.keys(L.ROUTES).length})`);
for (const [n, pts] of Object.entries(SHEET_3)) check(L.ROUTES[n] && J(L.ROUTES[n].pts) === J(pts) && CS.validateRoute(n, L.ROUTES[n]).length === 0, `${n}: waypoints ${J(pts)}`);
check(J(L.ROUTE_TREE) === J(['hitch', 'flat', 'slant', 'comeback', 'curl', 'out', 'dig', 'corner', 'post', 'go']) && L.ROUTE_TREE.every((r, i) => L.ROUTES[r].n === i), 'CS tree numbering 0 hitch, 1 flat, 2 slant, 3 comeback, 4 curl, 5 out, 6 dig, 7 corner, 8 post, 9 go');
// Break depth and direction, by hand from the sheet's table. Measured from the resolved points of a
// receiver on the LEFT (in = +x) and on the RIGHT (in = -x): depth = y at the top of the stem (the
// first point), lat = which way the leg after the break goes, dy = whether that leg goes up the
// field, flat or back, ang = its angle off the line (45 or 90 where the sheet says).
const BRK = {
  hitch: { depth: 6, lat: 'in', dy: 'back' }, flat: { depth: 2, lat: 'out', dy: 'up' }, slant: { depth: 3, lat: 'in', dy: 'up', ang: 45 },
  comeback: { depth: 15, lat: 'out', dy: 'back' }, curl: { depth: 12, lat: 'in', dy: 'back' }, out: { depth: 10, lat: 'out', dy: 'flat', ang: 90 },
  dig: { depth: 12, lat: 'in', dy: 'flat', ang: 90 }, corner: { depth: 12, lat: 'out', dy: 'up', ang: 45 }, post: { depth: 12, lat: 'in', dy: 'up', ang: 45 },
  go: { depth: null, lat: 'none', dy: 'up' },
};
for (const [n, w] of Object.entries(BRK)) {
  const r = L.ROUTES[n], out = [];
  for (const [side, inSign, x0] of [['L', 1, 6], ['R', -1, 47.33]]) {
    const P = CS.routePoints(r, [x0, 0], side);
    const a = P[1], b = P[2] || P[1];
    const depth = P.length > 2 ? a[1] : null;
    const lx = (b[0] - a[0]) * inSign, ly = b[1] - a[1];
    const lat = Math.abs(lx) < 1e-9 ? 'none' : lx > 0 ? 'in' : 'out';
    const dy = P.length > 2 ? (Math.abs(ly) < 1e-9 ? 'flat' : ly > 0 ? 'up' : 'back') : 'up';
    const ang = Math.abs(ly) < 1e-9 ? 90 : Math.round(Math.atan2(Math.abs(lx), Math.abs(ly)) * 180 / Math.PI);
    if (depth !== w.depth || lat !== w.lat || dy !== w.dy || (w.ang && ang !== w.ang)) out.push(`${side}: depth ${depth} ${lat} ${dy} ${ang}°`);
  }
  // The flat's break depth is "1-2" in the sheet; its first point is at 2, inside that range.
  const libDepth = Array.isArray(r.brk.depth) ? r.brk.depth : [r.brk.depth, r.brk.depth];
  const okLib = w.depth == null ? r.brk.depth == null : w.depth >= libDepth[0] && w.depth <= libDepth[1];
  check(out.length === 0 && okLib, `${n} (#${r.n}): breaks at ${w.depth == null ? 'none' : w.depth + ' yd'}, ${w.lat}${w.dy !== 'up' || w.lat !== 'none' ? ', ' + w.dy : ''}${w.ang ? ', ' + w.ang + '°' : ''} on both sides ${out.join(' ')}`);
}
// Every route resolves on both sides and mirrors: the left receiver's lateral moves are the right one's, negated.
{
  const bad = Object.keys(L.ROUTES).filter((n) => {
    const a = CS.routePoints(L.ROUTES[n], [10, 0], 'L'), b = CS.routePoints(L.ROUTES[n], [43.34, 0], 'R');
    return a.some((p, i) => !finite(p[0]) || !finite(p[1]) || !near(p[0] - 10, -(b[i][0] - 43.34), 1e-9) || p[1] !== b[i][1]);
  });
  check(bad.length === 0, `all ${Object.keys(L.ROUTES).length} routes resolve on both sides and mirror exactly ${bad.join(' ')}`);
}

/* ═════ L5. Concepts and BEATS (fact sheet 6) ═════ */
console.log('\n[L5] concepts and BEATS (sheet 6)');
// The "beats" column of 6, typed by hand. Primary pairings only.
const SHEET_BEATS = {
  'concept:smash': ['cov:2'], 'concept:four-verts': ['cov:3', 'cov:2'], 'concept:flood': ['cov:3'], 'concept:mesh': ['cov:1', 'cov:0', 'cov:2man'],
  'concept:stick': ['cov:3'], 'concept:slant-flat': ['cov:3'], 'concept:curl-flat': ['cov:3', 'cov:2'], 'concept:levels': ['cov:3'],
  'concept:dagger': ['cov:3', 'cov:4'], 'concept:post-dig': ['cov:4'],
  'route:hitch': ['cov:3'], 'route:seam': ['cov:2'], 'route:corner': ['cov:2'], 'route:post': ['cov:2'], 'route:slant': ['cov:0'],
};
check(sortJ(Object.keys(L.BEATS)) === sortJ(Object.keys(SHEET_BEATS)), `BEATS has every row of section 6: 10 concepts + 5 beater routes (${Object.keys(L.BEATS).length})`);
for (const [k, v] of Object.entries(SHEET_BEATS)) check(sortJ(L.BEATS[k] || []) === sortJ(v), `BEATS ${k} = ${v.join(', ')}`);
// Contested, the sheet's last column; side-only and poor rows.
const SHEET_CONTESTED = {
  'concept:smash': ['cov:4'], 'concept:four-verts': ['cov:1'], 'concept:flood': ['cov:2'], 'concept:mesh': ['cov:2', 'cov:tampa2', 'cov:3', 'cov:4', 'cov:6'],
  'concept:stick': ['cov:4'], 'concept:slant-flat': ['cov:0', 'cov:1', 'cov:2man'], 'concept:curl-flat': ['cov:4'], 'concept:levels': ['cov:4'],
  'concept:dagger': ['cov:2'], 'concept:post-dig': ['cov:2', 'cov:tampa2', 'cov:6', 'cov:2man'],
};
for (const [k, v] of Object.entries(SHEET_CONTESTED)) check(L.CONTESTED[k] && sortJ(L.CONTESTED[k].covs) === sortJ(v) && L.CONTESTED[k].why.length > 10, `CONTESTED ${k} = ${v.join(', ')}`);
const overlap = [];
for (const [k, c] of Object.entries(L.CONTESTED)) for (const cov of c.covs) if ((L.BEATS[k] || []).includes(cov)) overlap.push(`${k}/${cov}`);
for (const [k, rows] of Object.entries(L.BEATS_SIDE)) for (const r of rows) if ((L.BEATS[k] || []).includes(r.cov) || ((L.CONTESTED[k] || { covs: [] }).covs.includes(r.cov))) overlap.push(`${k}/${r.cov} side`);
for (const [k, c] of Object.entries(L.POOR)) for (const cov of c.covs) if ((L.BEATS[k] || []).includes(cov)) overlap.push(`${k}/${cov} poor`);
check(overlap.length === 0, `no concept is in BEATS and CONTESTED (or BEATS_SIDE / POOR) for the same coverage ${overlap.join(' ')}`);
check(J(L.BEATS_SIDE) === J({ 'concept:smash': [{ cov: 'cov:6', side: 'the Cover 2 side' }], 'route:corner': [{ cov: 'cov:6', side: 'the Cover 2 side' }] }), 'Cover 6 rows only "thrown to the Cover 2 side" (smash, corner): BEATS_SIDE');
check(J(L.POOR) === J({ 'concept:four-verts': { covs: ['cov:4'], why: 'poor vs Cover 4' } }), 'four verticals poor vs Cover 4: POOR');
check(Object.keys(L.BEATS).filter((k) => k.startsWith('route:')).every((k) => L.ROUTES[k.slice(6)]), 'every beater route exists in ROUTES');
// Receiver numbers (6: "#1/#2/#3 from the outside"): WRs and TEs on each side of the ball, outermost first.
function numbers(c) {
  const out = { L: [], R: [] };
  for (const s of ['L', 'R']) out[s] = c.off.filter((p) => (p.pos === 'WR' || p.pos === 'TE') && p.side === s).sort((a, b) => Math.abs(b.x - c.ballX) - Math.abs(a.x - c.ballX)).map((p) => p.id);
  return out;
}
const routeOf = (play, id) => (play.assign[id] || {}).route;
// The routes each concept needs, from the "routes" column, checked on the play itself (one side carries the concept).
const SHAPE = {
  'concept:smash': (n, r) => ['L', 'R'].some((s) => r(n[s][0]) === 'hitch' && r(n[s][1]) === 'corner'),
  'concept:four-verts': (n, r) => [...n.L.slice(0, 2), ...n.R.slice(0, 2)].filter((id) => ['go', 'seam'].includes(r(id))).length === 4,
  'concept:flood': (n, r, play) => ['L', 'R'].some((s) => r(n[s][0]) === 'go' && ['sail', 'out'].includes(r(n[s][1])) && (r(n[s][2]) === 'flat' || r('RB') === 'flat')),
  'concept:mesh': (n, r) => { const all = [...n.L, ...n.R]; return all.filter((id) => r(id) === 'drag').length === 2 && [...all, 'RB'].some((id) => ['stick', 'dig'].includes(r(id))) && [n.L[0], n.R[0]].every((id) => r(id) === 'go'); },
  'concept:stick': (n, r) => ['L', 'R'].some((s) => r(n[s][0]) === 'go' && ['flat', 'arrow'].includes(r(n[s][1])) && r(n[s][2]) === 'stick'),
  'concept:slant-flat': (n, r) => ['L', 'R'].some((s) => r(n[s][0]) === 'slant' && ['flat', 'arrow'].includes(r(n[s][1]))),
  'concept:curl-flat': (n, r) => ['L', 'R'].some((s) => r(n[s][0]) === 'curl' && r(n[s][1]) === 'flat'),
  'concept:levels': (n, r) => ['L', 'R'].some((s) => { const ins = n[s].filter((id) => ['dig', 'drag'].includes(r(id))).map((id) => r(id)); return ins.length >= 2 && new Set(ins).size >= 2; }),
  'concept:dagger': (n, r) => ['L', 'R'].some((s) => r(n[s][1]) === 'seam' && r(n[s][0]) === 'dagger-dig' && L.ROUTES['dagger-dig'].pts[0][1] >= 15 && L.ROUTES['dagger-dig'].pts[0][1] <= 18),
  'concept:post-dig': (n, r) => ['L', 'R'].some((s) => (r(n[s][0]) === 'post' && r(n[s][1]) === 'dig') || (r(n[s][0]) === 'dig' && r(n[s][1]) === 'post')),
};
const conceptKeys = Object.keys(SHEET_BEATS).filter((k) => k.startsWith('concept:'));
check(sortJ(Object.keys(L.CONCEPTS)) === sortJ(conceptKeys), `10 concepts, one per BEATS row (${Object.keys(L.CONCEPTS).length})`);
for (const k of conceptKeys) {
  const cp = L.CONCEPTS[k], play = cp && L.PLAYS[cp.play];
  if (!play) { check(false, `${k}: canonical play missing`); continue; }
  let c;
  try { c = CS.compile(play); } catch (err) { check(false, `${k}: ${play.id} compiles (${err.message})`); continue; }
  check(play.concept === k && L.BEATS[k].includes(play.beats) && L.DEFENSES[play.defense].coverage === play.beats && J(play.tags) === J([k, play.beats]), `${k}: canonical play ${play.id} is drawn against ${play.beats}, a coverage it beats (defense ${play.defense})`);
  check(SHAPE[k](numbers(c), (id) => routeOf(play, id), play), `${k}: ${play.id} runs the sheet's routes (${cp.routes})`);
  check(play.routes === true && !play.needsEngine, `${k}: ${play.id} shows its routes (routes: true) and needs no engine feature`);
  check(Object.keys(cp.conflict).every((cov) => L.BEATS[k].includes(cov)) && L.BEATS[k].every((cov) => cp.conflict[cov]), `${k}: a conflict defender for every coverage it beats, none for any other`);
  // Every primary pairing compiles: the canonical play's routes against that coverage's nickel look.
  const bad = [];
  for (const cov of L.BEATS[k]) {
    const v = { ...play, id: `${play.id}~${cov}`, defense: `${CID[cov]}-nickel` };
    delete v.callouts;
    const e = validates(v), n = e.length ? null : poseClean(v);
    if (e.length || n) bad.push(`${cov}: ${e[0] || n}`);
  }
  check(bad.length === 0, `${k}: its play compiles and runs against every coverage it beats (${L.BEATS[k].join(', ')}) ${bad.join(' | ')}`);
}

/* ═════ L6. Callouts trace to the sheet ═════ */
console.log('\n[L6] callouts (every fact sourced)');
for (const p of Object.values(L.PLAYS)) {
  let T;
  try { T = CS.playLength(p); } catch (err) { T = Infinity; }               // a play that won't compile fails in L5/L7; the quotes are still checked here
  const ks = p.callouts || [];
  check(ks.length >= 2 && ks.length <= 3, `${p.id}: 2-3 callouts (${ks.length})`);
  const bad = [];
  for (const k of ks) {
    const srcs = Array.isArray(k.src) ? k.src : [];
    if (!srcs.length) bad.push(`"${k.text.slice(0, 30)}": no src`);
    for (const s of srcs) if (!quoteOk(s)) bad.push(`"${k.text.slice(0, 30)}": "${s && s.q}" not in section ${s && s.sec}`);
    if (!(k.t >= -1.2 && k.t <= T)) bad.push(`t ${k.t} outside the play (-1.2..${T.toFixed(2)})`);
    if (/\d/.test(k.text) && !(k.text.match(/\d+/g) || []).every((num) => srcs.some((s) => norm(s.q).includes(num) || SECTIONS[s.sec].includes(num)))) bad.push(`"${k.text.slice(0, 30)}": a number its sources don't carry`);
  }
  check(bad.length === 0, `${p.id}: every callout carries src quotes found verbatim in the named sheet section ${bad.join(' | ')}`);
}
// The quote check bites: a phrase the sheet doesn't have, and a real phrase under the wrong section.
check(!quoteOk({ sec: '6', q: 'smash beats Cover 3 every time' }) && !quoteOk({ sec: '5a', q: 'the flat corner: squat on the hitch' }) && quoteOk({ sec: '6', q: 'the flat corner: squat on the hitch' }), 'src check: an invented phrase fails, a real phrase under the wrong section fails, the right section passes');

/* ═════ L7. Plays run ═════ */
console.log('\n[L7] plays (compile, pose, ball timing, teams)');
{
  const plays = Object.values(L.PLAYS);
  check(plays.length === 10 && plays.every((p) => !p.needsEngine), `PLAYS holds the 10 concept plays and none of them needs an engine feature (${plays.length})`);
  for (const p of plays) {
    const e = validates(p);
    check(e.length === 0, `${p.id}: validatePlay clean ${J(e)}`);
    if (e.length) continue;
    const n = poseClean(p);
    check(!n, `${p.id}: poseAt from t -1.2 to ${CS.playLength(p).toFixed(2)} without NaN ${n || ''}`);
    const c = CS.compile(p), s = CS.poseAt(p, c.catchT), r = s.players[c.target];
    const dBall = Math.hypot(s.ball.x - r.x, s.ball.y - r.y);
    // Drop: cs-core moves the QB 2 / 3.5 / 5 yd back for a 3 / 5 / 7 step at 4 yd/s; he throws once set.
    const drop = c.qb.assign.drop, setT = ({ 3: 2, 5: 3.5, 7: 5 })[drop] / 4;
    // The target's break: the length of his stem (first leg) at his speed, after any delay.
    const tg = c.byId[c.target], P = tg.path.pts, stem = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
    const breakT = tg.path.delay + (P.length > 2 ? stem / tg.path.v : 0);
    check(dBall <= 0.5 && c.throwT >= setT && c.catchT >= breakT && c.catchT - c.throwT >= 0.4 && c.catchT - c.throwT <= 1.0,
      `${p.id}: ${drop}-step drop set at ${setT.toFixed(2)} s, throw ${c.throwT}, ${c.target} past his break (${breakT.toFixed(2)} s) at the catch ${c.catchT}, ball on him (${dBall.toFixed(3)} yd)`);
  }
  const pairs = plays.map((p) => `${p.teams.off}-${p.teams.def}`), offs = new Set(plays.map((p) => p.teams.off)), defs = new Set(plays.map((p) => p.teams.def));
  check(plays.every((p) => L.TEAMS[p.teams.off] && L.TEAMS[p.teams.def] && p.teams.off !== p.teams.def) && new Set(pairs).size === pairs.length && offs.size === plays.length && defs.size === plays.length,
    `real NFL pairings, all different: ${offs.size} offenses, ${defs.size} defenses (${pairs.join(', ')})`);
}

/* ═════ L8. Run schemes (fact sheet 7) ═════ */
console.log('\n[L8] run schemes (sheet 7)');
{
  // By hand from 7, run right: [family, LT, LG, C, RG, RT, pullers].
  const SHEET_7 = {
    'inside-zone': ['zone', 'cutoff', 'zone', 'zone', 'zone', 'zone', []],
    'outside-zone': ['zone', 'reach', 'reach', 'reach', 'reach', 'reach', []],
    power: ['gap', 'hinge', 'pull-lead', 'back', 'down', 'down', ['LG']],
    counter: ['gap', 'pull-lead', 'pull-kick', 'back', 'down', 'down', ['LG', 'LT']],
    trap: ['gap', null, 'pull-trap', null, 'release', 'release', ['LG']],
    // 7's note: "gap schemes (power, counter, trap) pre-set the hole"; zone = the two zone runs. The draw is in neither.
    draw: [null, 'steer', 'steer', 'steer', 'steer', 'steer', []],
  };
  check(sortJ(Object.keys(L.RUN_SCHEMES)) === sortJ(Object.keys(SHEET_7)), 'six run schemes: inside zone, outside zone, power, counter, trap, draw');
  for (const [id, w] of Object.entries(SHEET_7)) {
    const s = L.RUN_SCHEMES[id];
    const ol = s && ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => s.ol[k]);
    check(s && s.family === w[0] && J(ol) === J(w.slice(1, 6)) && J(s.pullers) === J(w[6]) && ['LT', 'LG', 'C', 'RG', 'RT'].every((k) => k in s.ol),
      `${id}: ${w[0]} scheme, OL ${w.slice(1, 6).map((v) => v || '-').join(' / ')}, pullers ${w[6].join(', ') || 'none'}`);
    check(s && ol.every((v) => v === null || L.RUN_RULES[v]) && (s.aim.gaps === null || s.aim.gaps.every((g) => CS.gapX(g) != null)) && s.read.length > 10 && s.aim.text.length > 5, `${id}: every rule token explained in RUN_RULES, aim gaps real, a read`);
  }
  check(L.RUN_SCHEMES.power.kickout && J(L.RUN_SCHEMES.power.kickout.by) === J(['FB', 'H']) && L.RUN_SCHEMES.power.kickout.target === 'EMOL' && L.RUN_SCHEMES.counter.counterStep === true, 'power: FB or H kicks out the EMOL; counter: the RB steps away first');
  // Pending plays: one per scheme, never in PLAYS, every feature catalogued.
  const pend = Object.values(L.PENDING_PLAYS);
  check(pend.length === 6 && sortJ(pend.map((p) => p.scheme)) === sortJ(Object.keys(SHEET_7)) && pend.every((p) => !L.PLAYS[p.id]), 'one pending run play per scheme, none of them in PLAYS');
  check(pend.every((p) => Array.isArray(p.needsEngine) && p.needsEngine.length && p.needsEngine.every((f) => L.NEEDS_ENGINE[f]) && L.FORMATIONS[p.formation] && L.DEFENSES[p.defense] && p.ball.some((b) => b.ev === 'handoff')), 'every pending run names its engine features (all catalogued), a real formation and defense, and a handoff');
  check(pend.every((p) => Object.entries(L.RUN_SCHEMES[p.scheme].ol).every(([k, v]) => (v ? p.assign[k] && p.assign[k].run === v : !p.assign[k]))), 'every pending run blocks by its scheme\'s rules (and leaves a null rule unassigned)');
}

/* ═════ L9. Engine features ═════ */
console.log('\n[L9] needsEngine catalogue');
{
  const used = new Set();
  for (const d of Object.values(L.DEFENSES)) for (const p of d.players) if (p.needsEngine) used.add(p.needsEngine);
  for (const s of Object.values(L.STUNTS)) used.add(s.needsEngine);
  for (const p of Object.values(L.PENDING_PLAYS)) p.needsEngine.forEach((f) => used.add(f));
  const cat = Object.keys(L.NEEDS_ENGINE);
  check([...used].every((f) => L.NEEDS_ENGINE[f]) && cat.every((f) => used.has(f)), `every needsEngine tag is catalogued and every catalogued feature is used (${[...used].sort().join(', ')})`);
  check(Object.values(L.NEEDS_ENGINE).every((e) => e.what && e.shape && e.where), 'each feature says what it is, its data shape and where it is used');
  check(Object.values(L.DEFENSES).every((d) => d.players.every((p) => !p.needsEngine || p.zone || p.man)), 'a defender marked needsEngine still has a playable zone or man job today');
}

/* ═════ L10. Techniques, holes (fact sheet 1c, 8) ═════ */
console.log('\n[L10] techniques and holes (sheet 1c, 8)');
{
  const T1C = { 0: [26.67, 26.67], 1: [27.17, 26.17], '2i': [27.67, 25.67], 2: [28.17, 25.17], 3: [28.67, 24.67], '4i': [29.17, 24.17], 4: [29.67, 23.67], 5: [30.17, 23.17], 7: [30.67, 22.67], 6: [31.17, 22.17], 9: [31.67, 21.67], wide: [32.67, 21.67] };
  check(sortJ(Object.keys(L.TECHNIQUES)) === sortJ(Object.keys(T1C)) && Object.entries(T1C).every(([k, [r, l]]) => L.TECHNIQUES[k].R === r && L.TECHNIQUES[k].L === l), 'techniques 0-9 and wide on both sides at the sheet\'s x');
  check(J(L.HOLES) === J({ 1: 'A-gap-L', 2: 'A-gap-R', 3: 'B-gap-L', 4: 'B-gap-R', 5: 'C-gap-L', 6: 'C-gap-R', 7: 'D-gap-L', 8: 'D-gap-R' }) && Object.values(L.HOLES).every((g) => CS.gapX(g) != null), 'holes: even right, odd left, from the center out (CS convention)');
}

console.log(`\n${PASS}/${PASS + FAIL} passed`);
if (FAIL) { console.log('failures:'); for (const f of fails) console.log('  ' + f); process.exit(1); }
