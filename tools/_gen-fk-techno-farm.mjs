#!/usr/bin/env node
/**
 * "Techno Barn" — the Farm Kart race theme for Bucky's Midnight Run (2026-10-12, family ask: "new music for that level,
 * think techno farm"). Composed and synthesized here in plain JS (no samples, no API): there is no ElevenLabs key in the
 * cloud sessions, and a synth render is reproducible from this file.
 *
 *   node tools/_gen-fk-techno-farm.mjs [out.mp3]     (needs ffmpeg on PATH; default assets/audio/fk-music-race-techno-barn.mp3)
 *
 * 128 BPM, A minor, 48 bars (90 s), loop-seamless: the render runs 4 s past the end and that tail (reverb/delay ring-out)
 * is folded back onto the head, and the last two bars thin out to the intro's groove so the wrap is a continuation.
 *   bars  0- 8  intro      kick, hats, cowbell, filtered acid bass creeping in
 *   bars  8-16  build      + claps, chicken-cluck percussion, acid filter opening
 *   bars 16-32  drop A     rooster crow -> full: acid bass, chord stabs, cowbell, clucks
 *   bars 32-36  break      kick out, pad chords, a moo call + response, noise riser + snare roll
 *   bars 36-48  drop B     everything + pluck arpeggio + moo hits; bars 46-47 strip back to the intro groove
 * Mastered with ffmpeg loudnorm to -11.3 LUFS (the existing race themes measure -10.6..-11.7) and a -0.5 dBTP ceiling.
 */
import fs from "fs";
import path from "path";
import { execFileSync, spawnSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || path.join(ROOT, "assets/audio/fk-music-race-techno-barn.mp3");
const SR = 44100, BPM = 128, BEAT = 60 / BPM, STEP = BEAT / 4, BAR = BEAT * 4, BARS = 48;
const LEN = Math.round(BARS * BAR * SR), TAIL = Math.round(4 * SR), TOTAL = LEN + TAIL;
const L = new Float32Array(TOTAL), R = new Float32Array(TOTAL);          // dry mix
const RVL = new Float32Array(TOTAL), RVR = new Float32Array(TOTAL);      // reverb send
const DLL = new Float32Array(TOTAL), DLR = new Float32Array(TOTAL);      // ping-pong delay send
const DUCK = new Float32Array(TOTAL).fill(1);                            // kick sidechain gain (applied to "duck" sources)
const TAU = Math.PI * 2;

// ---------- helpers ----------
let seed = 0x7ec4a1;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const noise = () => rnd() * 2 - 1;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const at = (bar, step = 0) => bar * BAR + step * STEP;                    // seconds
function polyblep(t, dt){ if (t < dt){ t /= dt; return t + t - t * t - 1; } if (t > 1 - dt){ t = (t - 1) / dt; return t * t + t + t + 1; } return 0; }
// band-limited saw / square oscillator state
function osc(){ return { ph: rnd() }; }
function saw(o, f){ const dt = f / SR; const v = 2 * o.ph - 1 - polyblep(o.ph, dt); o.ph += dt; if (o.ph >= 1) o.ph -= 1; return v; }
function sqr(o, f, pw = 0.5){ const dt = f / SR; let v = o.ph < pw ? 1 : -1; v += polyblep(o.ph, dt); v -= polyblep((o.ph + 1 - pw) % 1, dt); o.ph += dt; if (o.ph >= 1) o.ph -= 1; return v; }
// TPT state-variable filter (Zavalishin) — lp/bp/hp in one
function svf(){ return { s1: 0, s2: 0 }; }
function svfRun(st, x, fc, q){ const g = Math.tan(Math.PI * clamp(fc, 20, SR * 0.45) / SR), k = 1 / q, a1 = 1 / (1 + g * (g + k));
  const v3 = x - st.s2, v1 = a1 * st.s1 + g * a1 * v3, v2 = st.s2 + g * v1; st.s1 = 2 * v1 - st.s1; st.s2 = 2 * v2 - st.s2; return { lp: v2, bp: v1, hp: x - k * v1 - v2 }; }
// 4-pole ZDF-ish ladder with tanh drive (the acid squelch)
function ladder(){ return { z: [0, 0, 0, 0] }; }
function ladderRun(st, x, fc, res){ const g = Math.tan(Math.PI * clamp(fc, 20, SR * 0.45) / SR), G = g / (1 + g), z = st.z;
  // estimate the output for the feedback path from the stored states (one-step resolve)
  const S = z[3] + G * (z[2] + G * (z[1] + G * z[0]));
  const G4 = G * G * G * G, k = res * 4;
  let u = (x - k * (S * (1 - G))) / (1 + k * G4); u = Math.tanh(u * 1.6);
  let y = u;
  for (let i = 0; i < 4; i++){ const v = G * (y - z[i]); const out = v + z[i]; z[i] = out + v; y = out; }
  return y; }
function add(buf, i, v){ if (i >= 0 && i < TOTAL) buf[i] += v; }
function put(i, l, r, opt = {}){ if (i < 0 || i >= TOTAL) return; L[i] += l; R[i] += r;
  if (opt.rev){ RVL[i] += l * opt.rev; RVR[i] += r * opt.rev; } if (opt.dly){ DLL[i] += l * opt.dly; DLR[i] += r * opt.dly; } }
const pan = (p) => [Math.cos((p + 1) * Math.PI / 4), Math.sin((p + 1) * Math.PI / 4)];

// ---------- arrangement helpers ----------
const sec = (b) => b < 8 ? "intro" : b < 16 ? "build" : b < 32 ? "dropA" : b < 36 ? "break" : b < 46 ? "dropB" : "outro";
const CHORD_ROOT = [0, -4, 3, -2];                 // Am F C G (semitones from A)
const CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67]];

// ---------- drums ----------
function kick(t0, vel = 1){ const i0 = Math.round(t0 * SR), n = Math.round(0.42 * SR); let ph = 0;
  for (let i = 0; i < n; i++){ const t = i / SR, f = 46 + 110 * Math.exp(-t / 0.035) + 30 * Math.exp(-t / 0.006);
    ph += TAU * f / SR; const env = Math.exp(-t / 0.17) * (t < 0.002 ? t / 0.002 : 1);
    let v = Math.sin(ph) * env + (t < 0.004 ? noise() * 0.35 * (1 - t / 0.004) : 0);
    v = Math.tanh(v * 1.8) * 0.5 * vel; put(i0 + i, v, v);
    // sidechain: duck the bass/stabs/pads hard on the hit, release over ~180 ms
    const d = 1 - 0.72 * Math.exp(-t / 0.11); const j = i0 + i; if (j < TOTAL) DUCK[j] = Math.min(DUCK[j], d); } }
const hhF = [svf(), svf()];
function hat(t0, open, vel, p = 0.15){ const i0 = Math.round(t0 * SR), dec = open ? 0.13 : 0.028, n = Math.round(dec * 6 * SR), [gl, gr] = pan(p), st = hhF[open ? 1 : 0];
  for (let i = 0; i < n; i++){ const t = i / SR; let x = 0;   // metallic: six detuned square partials + noise
    for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) x += Math.sign(Math.sin(TAU * f * 1.9 * t));
    x = x / 6 * 0.6 + noise() * 0.55; const v = svfRun(st, x, 7200, 0.8).hp * Math.exp(-t / dec) * vel * 0.85; put(i0 + i, v * gl, v * gr, { rev: open ? 0.06 : 0 }); } }
const clF = svf();
function clap(t0, vel = 1){ const i0 = Math.round(t0 * SR), n = Math.round(0.35 * SR);
  for (let i = 0; i < n; i++){ const t = i / SR; let e = 0; for (const o of [0, 0.011, 0.022]) if (t >= o) e = Math.max(e, Math.exp(-(t - o) / 0.007));
    e = Math.max(e, 0.55 * (t > 0.022 ? Math.exp(-(t - 0.022) / 0.09) : 0));
    const v = svfRun(clF, noise(), 1250, 1.6).bp * e * vel * 1.1, cl = 1 + 0.25 * noise(), cr = 1 + 0.25 * noise(); put(i0 + i, v * cl, v * cr, { rev: 0.4 }); } }
const snF = svf();
function snare(t0, vel = 1){ const i0 = Math.round(t0 * SR), n = Math.round(0.16 * SR);
  for (let i = 0; i < n; i++){ const t = i / SR; const v = (svfRun(snF, noise(), 2600, 0.8).bp * 0.9 + Math.sin(TAU * 190 * t) * 0.5) * Math.exp(-t / 0.05) * vel * 0.5; put(i0 + i, v, v, { rev: 0.2 }); } }
// 808-style cowbell (two squares through a bandpass) — the farm half of techno-farm
const cbF = svf(); const cbO = [osc(), osc()];
function cowbell(t0, vel = 1){ const i0 = Math.round(t0 * SR), n = Math.round(0.3 * SR), [gl, gr] = pan(-0.6);
  for (let i = 0; i < n; i++){ const t = i / SR, x = sqr(cbO[0], 587) * 0.5 + sqr(cbO[1], 845) * 0.5;
    const env = t < 0.004 ? t / 0.004 : (0.75 * Math.exp(-t / 0.035) + 0.25 * Math.exp(-t / 0.16));
    const v = svfRun(cbF, x, 760, 2.2).bp * env * vel * 0.3; put(i0 + i, v * gl, v * gr, { dly: 0.12 }); } }

// ---------- farmyard voices ----------
// chicken "bok": a quick pitched pulse that drops, through two formant bandpasses, plus breath
function cluck(t0, f0 = 820, vel = 1, p = 0.4, dur = 0.07){ const i0 = Math.round(t0 * SR), n = Math.round(dur * 2.2 * SR), o = osc(), f1 = svf(), f2 = svf(), [gl, gr] = pan(p);
  for (let i = 0; i < n; i++){ const t = i / SR, f = f0 * (1 + 0.5 * Math.exp(-t / 0.012)) * (1 - 0.18 * t / dur);
    const x = sqr(o, f, 0.3) * 0.7 + noise() * 0.25, env = (t < 0.003 ? t / 0.003 : 1) * Math.exp(-t / (dur * 0.55));
    const v = (svfRun(f1, x, 1150, 4).bp + 0.6 * svfRun(f2, x, 2500, 5).bp) * env * vel * 0.75; put(i0 + i, v * gl, v * gr, { rev: 0.12, dly: 0.18 }); } }
function bagawk(t0, vel = 1, p = 0.45){ cluck(t0, 760, vel * 0.8, p); cluck(t0 + STEP, 720, vel * 0.8, p); cluck(t0 + STEP * 2, 1050, vel, p, 0.16); }
// cow "moo": a saw voice whose formants open from a closed "mm" to "oo", pitch sliding down, slow vibrato
function moo(t0, midi = 45, dur = 1.5, vel = 1, p = -0.1){ const i0 = Math.round(t0 * SR), n = Math.round((dur + 0.3) * SR), o1 = osc(), o2 = osc(), fA = svf(), fB = svf(), lp = svf(), [gl, gr] = pan(p);
  for (let i = 0; i < n; i++){ const t = i / SR, u = clamp(t / dur, 0, 1);
    const f = mtof(midi) * (1 + 0.06 * Math.sin(Math.PI * Math.min(1, u * 1.6))) * (1 - 0.16 * Math.max(0, u - 0.45) / 0.55) * (1 + 0.012 * Math.sin(TAU * 5.2 * t));
    const x = saw(o1, f) * 0.6 + saw(o2, f * 1.004) * 0.4;
    const open = Math.sin(Math.PI * Math.min(1, u * 1.15)), fa = 260 + 440 * open, fb = 720 + 520 * open;
    let v = svfRun(fA, x, fa, 3.5).bp + 0.55 * svfRun(fB, x, fb, 4).bp; v = svfRun(lp, v, 1800, 0.7).lp;
    const env = (t < 0.08 ? t / 0.08 : 1) * (t > dur ? Math.exp(-(t - dur) / 0.08) : 1);
    v *= env * vel * 0.9; put(i0 + i, v * gl, v * gr, { rev: 0.4, dly: 0.1 }); } }
// rooster "cock-a-doodle-doo": four pitched syllables, raspy (noise-modulated) pulse, two formants, last one long + falling
function rooster(t0, vel = 1){ const syl = [[0, 0.11, 900, 980], [0.14, 0.09, 1050, 1150], [0.26, 0.16, 1250, 1320], [0.46, 0.75, 1380, 980]];
  const [gl, gr] = pan(0.25);
  for (const [s0, d, fa, fb] of syl){ const i0 = Math.round((t0 + s0) * SR), n = Math.round((d + 0.06) * SR), o = osc(), f1 = svf(), f2 = svf();
    for (let i = 0; i < n; i++){ const t = i / SR, u = clamp(t / d, 0, 1), f = (fa + (fb - fa) * u) * (1 + 0.02 * Math.sin(TAU * 31 * t)) * (1 + 0.15 * noise() * 0.2);
      const x = sqr(o, f / 2, 0.22) * 0.8 + noise() * 0.3, env = (t < 0.012 ? t / 0.012 : 1) * (t > d ? Math.exp(-(t - d) / 0.025) : 1);
      const v = (svfRun(f1, x, 1600, 3).bp + 0.7 * svfRun(f2, x, 3100, 4).bp) * env * vel * 0.5; put(i0 + i, v * gl, v * gr, { rev: 0.3, dly: 0.2 }); } } }

// ---------- melodic voices ----------
// acid bass: one continuous mono voice (slides need state), driven step by step
const ACID = [ // [semitone over A1, gate, accent, slide]  16 steps
  [0,1,0,0],[0,1,0,0],[12,1,1,0],[0,1,0,1],[3,1,0,0],[0,0,0,0],[15,1,1,0],[0,1,0,0],
  [0,1,0,0],[7,1,0,1],[0,1,0,0],[12,1,1,0],[10,1,0,1],[0,1,0,0],[3,1,0,0],[5,1,1,0]];
function acidPart(){ const st = ladder(), o = osc(), hp = svf(); let f = mtof(45), env = 0, acc = 0, gate = 0, lastI = 0;
  for (let bar = 0; bar < BARS + 2; bar++){ const b = bar % BARS, s = sec(b);
    const on = s !== "break" && !(s === "intro" && b < 4);
    for (let k = 0; k < 16; k++){ const [n, g, a, sl] = ACID[k], i0 = Math.round(at(bar, k) * SR), i1 = Math.round(at(bar, k + 1) * SR);
      const root = 45 + CHORD_ROOT[b % 4], target = mtof(root + n), playing = on && g;   // A2: at A1 the F root sat at 44 Hz on top of the kick
      // filter macro per section: intro/build creep open, drops wide, outro closes back toward the intro
      const prog = s === "intro" ? 0.15 + 0.1 * ((b - 4) / 4) : s === "build" ? 0.25 + 0.45 * ((b - 8) / 8) : s === "dropA" ? 0.75 + 0.25 * Math.sin(Math.PI * (b - 16) / 16) : s === "dropB" ? 0.95 : s === "outro" ? 0.35 : 0;
      if (playing){ env = 1; acc = a ? 1 : 0; gate = 1; }
      for (let i = i0; i < i1 && i < TOTAL; i++){ const t = (i - i0) / SR;
        if (playing) f += (target - f) * (sl && k > 0 ? 1 - Math.exp(-1 / (0.045 * SR)) : 1);
        if (t > STEP * 0.62) gate = 0;
        env *= Math.exp(-1 / ((0.09 + 0.2 * prog) * SR)); const amp = gate ? 1 : Math.max(0, 1 - (t - STEP * 0.62) / 0.01);
        const cut = 140 + (380 + 2600 * prog) * (env * (0.55 + 0.6 * acc)) + 200 * prog;
        let v = ladderRun(st, saw(o, f) * (0.8 + 0.4 * acc), cut, 0.72 + 0.12 * acc);
        v = svfRun(hp, v, 70, 0.7).hp * (playing || gate ? amp : 0) * 0.7;
        put(i, v * DUCK[i], v * DUCK[i], { dly: s === "dropB" ? 0.05 : 0 }); lastI = i; } } } }
// sub: a sine an octave below the root on the off-beats in the intro/break so the low end never empties
function subPart(){ for (let bar = 0; bar < BARS; bar++){ const s = sec(bar); if (s !== "break") continue;
  const f = mtof(33 + CHORD_ROOT[bar % 4]);
  for (let i = Math.round(at(bar) * SR), e = Math.round(at(bar + 1) * SR); i < e; i++){ const t = i / SR - at(bar); const v = Math.sin(TAU * f * t) * 0.32 * Math.min(1, t * 4); put(i, v, v); } } }
// chord stabs: 3 detuned saws per note, short filter pluck, offbeat rhythm, wide stereo + delay
function stab(t0, notes, vel = 1, dur = 0.16){ const i0 = Math.round(t0 * SR), n = Math.round((dur + 0.1) * SR);
  const vs = notes.map((m) => [-0.12, 0, 0.12].map((dt, j) => ({ o: osc(), f: mtof(m + dt), p: j - 1 })));
  const fl = svf(), fr = svf();
  for (let i = 0; i < n; i++){ const t = i / SR; let l = 0, r = 0;
    for (const v of vs) for (const u of v){ const x = saw(u.o, u.f); l += x * (u.p < 0 ? 0.9 : u.p === 0 ? 0.5 : 0.1); r += x * (u.p > 0 ? 0.9 : u.p === 0 ? 0.5 : 0.1); }
    const env = (t < 0.003 ? t / 0.003 : 1) * Math.exp(-t / dur), cut = 600 + 3200 * Math.exp(-t / 0.05);
    const k = 0.14 * vel * env, j = i0 + i, d = j < TOTAL ? DUCK[j] : 1;
    put(j, svfRun(fl, l, cut, 1.1).lp * k * d, svfRun(fr, r, cut, 1.1).lp * k * d, { rev: 0.25, dly: 0.3 }); } }
// pads (break): slow-attack detuned saws, lowpassed
function pad(t0, notes, dur){ const i0 = Math.round(t0 * SR), n = Math.round((dur + 1.2) * SR), vs = notes.map((m) => [-0.08, 0.08].map((dt) => ({ o: osc(), f: mtof(m - 12 + dt) }))), fl = svf(), fr = svf();
  for (let i = 0; i < n; i++){ const t = i / SR; let l = 0, r = 0; vs.forEach((v, a) => { l += saw(v[0].o, v[0].f); r += saw(v[1].o, v[1].f); });
    const env = Math.min(1, t / 0.6) * (t > dur ? Math.exp(-(t - dur) / 0.5) : 1), cut = 700 + 500 * Math.sin(Math.PI * Math.min(1, t / dur));
    put(i0 + i, svfRun(fl, l, cut, 0.8).lp * env * 0.08, svfRun(fr, r, cut, 0.8).lp * env * 0.08, { rev: 0.5 }); } }
// pluck arpeggio (drop B): square pluck, chord tones up an octave, 16ths, ping-pong delay
function pluck(t0, m, vel = 1, p = 0){ const i0 = Math.round(t0 * SR), n = Math.round(0.22 * SR), o = osc(), f = svf(), [gl, gr] = pan(p);
  for (let i = 0; i < n; i++){ const t = i / SR, x = sqr(o, mtof(m), 0.35), env = (t < 0.002 ? t / 0.002 : 1) * Math.exp(-t / 0.07);
    const j = i0 + i, d = j < TOTAL ? DUCK[j] : 1, v = svfRun(f, x, 900 + 4200 * Math.exp(-t / 0.03), 1.4).lp * env * vel * 0.14 * d; put(j, v * gl, v * gr, { dly: 0.35, rev: 0.15 }); } }
// noise riser + snare roll into a drop
function riser(t0, bars){ const i0 = Math.round(t0 * SR), n = Math.round(bars * BAR * SR), f = svf();
  for (let i = 0; i < n; i++){ const u = i / n; const v = svfRun(f, noise(), 400 + 7000 * u * u, 2).bp * u * u * 0.35; put(i0 + i, v * (1 - 0.3 * Math.sin(u * 40)), v * (1 - 0.3 * Math.cos(u * 40)), { rev: 0.3 }); } }

// ---------- score ----------
console.log("composing...");
for (let bar = 0; bar < BARS + 2; bar++){ const b = bar % BARS, s = sec(b), ch = CHORDS[b % 4];
  // kick: four on the floor, out for the break (bar 35 brings it back with a 16th roll at the end)
  if (s !== "break") for (let q = 0; q < 4; q++) kick(at(bar, q * 4), q === 0 ? 1 : 0.93);
  // hats: offbeat opens everywhere but the first two intro bars; 16th closeds from the build on
  for (let k = 0; k < 16; k++){
    if (k % 4 === 2 && !(s === "intro" && b < 2) && s !== "break") hat(at(bar, k), true, 0.85, k === 2 || k === 10 ? 0.55 : -0.55);
    if (s !== "intro" && s !== "break" && k % 4 !== 2) hat(at(bar, k), false, [1, 0.45, 0, 0.6][k % 4] * (0.8 + 0.2 * rnd()), k % 2 ? 0.45 : -0.45); }
  // claps on 2 and 4 from the build (doubled flam on the last beat of each 8-bar phrase)
  if (s !== "intro" && s !== "break"){ clap(at(bar, 4)); clap(at(bar, 12)); if (b % 8 === 7) clap(at(bar, 14), 0.7); }
  // cowbell: syncopated farm-bell figure, every section but the break
  if (s !== "break") for (const k of (s === "intro" || s === "outro" ? [3, 10] : [3, 6, 10, 13])) cowbell(at(bar, k), k === 10 ? 1 : 0.8);
  // chickens: a "ba-gawk" answer on odd bars from the build on, single clucks peppering the drops
  if ((s === "build" || s === "dropA" || s === "dropB") && b % 2 === 1) bagawk(at(bar, 11), 0.9, b % 4 === 1 ? 0.5 : -0.4);
  if (s === "dropA" || s === "dropB") for (const k of [1, 7]) if (rnd() < 0.55) cluck(at(bar, k), 800 + rnd() * 250, 0.6, rnd() < 0.5 ? -0.7 : 0.7);
  // chord stabs in the drops
  if (s === "dropA" || s === "dropB") for (const k of [2, 5, 8, 11, 14]) stab(at(bar, k), ch.slice(0, 3), k === 2 ? 1 : 0.75);
  // drop B: pluck arpeggio up/down the chord, an octave up
  if (s === "dropB"){ const seq = [0, 1, 2, 3, 2, 1]; for (let k = 0; k < 16; k++) pluck(at(bar, k), ch[seq[k % 6]] + 12, k % 4 === 0 ? 1 : 0.7, (k % 2 ? 0.75 : -0.75)); }
  // moo hits on the drop-B phrase turns (pitched to the chord root)
  if (s === "dropB" && (b === 39 || b === 43)) moo(at(bar, 8), 45 + CHORD_ROOT[b % 4], 1.1, 0.8, 0.2);
}
// break: pads, the moo call and response, riser, snare roll into drop B
for (let b = 32; b < 36; b++) pad(at(b), CHORDS[b % 4], BAR);
moo(at(32, 2), 45, 1.6, 1, -0.2); moo(at(33, 6), 48, 1.2, 0.85, 0.3); cluck(at(33, 13), 900, 0.8, 0.5); moo(at(34, 2), 45 + 3, 1.6, 1, -0.2);
riser(at(34), 2);
for (let k = 0; k < 16; k++){ snare(at(35, k), 0.35 + 0.65 * k / 15); if (k >= 12) snare(at(35, k) + STEP / 2, 0.4 + 0.5 * (k - 12) / 4); }
// the drop A entrance: a rooster crow over the first bar, and a build riser before it
riser(at(14), 2); rooster(at(16, 0) + 0.04, 1); moo(at(24, 0), 45, 1.3, 0.7, -0.3);
// acid + sub run last (they read DUCK, which the kicks have filled)
console.log("acid..."); acidPart(); subPart();

// ---------- effects ----------
console.log("fx...");
// ping-pong delay: dotted eighth (3 steps), feedback 0.38, darkened each repeat
{ const d = Math.round(3 * STEP * SR); let lpL = 0, lpR = 0;
  for (let i = d; i < TOTAL; i++){ lpL += (DLL[i - d] - lpL) * 0.35; lpR += (DLR[i - d] - lpR) * 0.35;
    DLL[i] += lpR * 0.42; DLR[i] += lpL * 0.42; L[i] += lpR * 0.8; R[i] += lpL * 0.8; } }
// reverb: Freeverb-style 8 combs + 4 allpasses per side (stereo spread)
function freeverb(inp, spread){ const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ b: new Float32Array(n + spread), i: 0, f: 0 }));
  const aps = [556, 441, 341, 225].map((n) => ({ b: new Float32Array(n + spread), i: 0 })), out = new Float32Array(TOTAL), fb = 0.83, damp = 0.3;
  for (let s = 0; s < TOTAL; s++){ const x = inp[s] * 0.015; let y = 0;
    for (const c of combs){ const o = c.b[c.i]; c.f = o * (1 - damp) + c.f * damp; c.b[c.i] = x + c.f * fb; c.i = (c.i + 1) % c.b.length; y += o; }
    for (const a of aps){ const o = a.b[a.i]; a.b[a.i] = y + o * 0.5; y = o - y; a.i = (a.i + 1) % a.b.length; }
    out[s] = y; } return out; }
{ const wl = freeverb(RVL, 0), wr = freeverb(RVR, 23); for (let i = 0; i < TOTAL; i++){ L[i] += wl[i] * 2.2; R[i] += wr[i] * 2.2; } }

// ---------- loop fold + master ----------
// fold the tail (ring-out past bar 48) onto the head so the loop seam carries the decays
for (let i = 0; i < TAIL; i++){ L[i] += L[LEN + i]; R[i] += R[LEN + i]; }
// gentle glue: soft clip at the bus
let peak = 0; for (let i = 0; i < LEN; i++){ L[i] = Math.tanh(L[i] * 0.9); R[i] = Math.tanh(R[i] * 0.9); peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); }
for (let i = 0; i < LEN; i++){ L[i] /= peak * 1.05; R[i] /= peak * 1.05; }
// write a 32-bit float WAV
const wav = path.join(path.dirname(OUT), ".techno-barn.render.wav");
{ const n = LEN, buf = Buffer.alloc(44 + n * 8); buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34); buf.write("data", 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++){ buf.writeFloatLE(L[i], 44 + i * 8); buf.writeFloatLE(R[i], 48 + i * 8); } fs.writeFileSync(wav, buf); }
console.log("encoding...");
// two-pass loudnorm (linear): a single dynamic pass landed at -12.2 LUFS against the -11.3 target. Pass 1 measures
// (ffmpeg prints the JSON on stderr), pass 2 applies one linear gain + the true-peak limiter and encodes.
const p1 = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", wav, "-af", "highpass=f=20,loudnorm=I=-11.3:TP=-0.8:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(p1.stderr)[0]);
const ln = `loudnorm=I=-11.3:TP=-0.8:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
execFileSync("ffmpeg", ["-y", "-v", "error", "-i", wav, "-af", "highpass=f=20," + ln + ",aresample=44100", "-c:a", "libmp3lame", "-b:a", "128k", OUT]);
fs.unlinkSync(wav);
console.log("wrote", OUT, fs.statSync(OUT).size, "bytes,", (LEN / SR).toFixed(2), "s");
