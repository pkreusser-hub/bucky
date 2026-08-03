/* FARMSTEAD fs-midi.js — tiny SMF parser + WebAudio softsynth for BGM.
 *
 * Used by fs-audio.js to play the built-in looping MIDI theme. No external
 * soundfonts or CDN — oscillators only (readable GM-ish timbres).
 *
 * Public API (window.FSMidi):
 *   parse(arrayBuffer) -> song
 *   play(ctx, dest, song, {loop}) -> controller { stop(), tick(now), debug() }
 *   version
 */
(function () {
  "use strict";

  function readVLQ(u8, o) {
    let v = 0, c;
    do {
      c = u8[o++];
      v = (v << 7) | (c & 0x7f);
    } while (c & 0x80);
    return [v, o];
  }

  /** Parse a Standard MIDI File into a playable song. */
  function parse(arrayBuffer) {
    const u8 = new Uint8Array(arrayBuffer);
    if (u8.length < 14 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== "MThd") {
      throw new Error("not a MIDI file");
    }
    const format = (u8[8] << 8) | u8[9];
    const nTracks = (u8[10] << 8) | u8[11];
    const division = (u8[12] << 8) | u8[13];
    if (division & 0x8000) throw new Error("SMPTE MIDI timing not supported");
    const tpq = division;

    const tempoMap = [{ tick: 0, usPerBeat: 500000 }]; // 120 BPM default
    const notes = []; // { start, end, ch, note, vel, prog }
    const open = new Map(); // key ch<<8|note -> { start, ch, note, vel, prog }
    const programs = new Uint8Array(16);

    let o = 14;
    for (let t = 0; t < nTracks; t++) {
      if (o + 8 > u8.length) break;
      const id = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
      const len = (u8[o + 4] << 24) | (u8[o + 5] << 16) | (u8[o + 6] << 8) | u8[o + 7];
      o += 8;
      if (id !== "MTrk") { o += len; continue; }
      const end = o + len;
      let tick = 0, run = null;
      while (o < end) {
        let dt;
        [dt, o] = readVLQ(u8, o);
        tick += dt;
        if (o >= end) break;
        let st = u8[o];
        if (st < 0x80) {
          if (run == null) break;
          st = run;
        } else {
          o++;
          if (st < 0xf0) run = st;
          else if (st === 0xff || st === 0xf0 || st === 0xf7) run = null;
        }
        const hi = st & 0xf0;
        const ch = st & 0x0f;
        if (st === 0xff) {
          const typ = u8[o++];
          let l;
          [l, o] = readVLQ(u8, o);
          if (typ === 0x51 && l === 3) {
            const us = (u8[o] << 16) | (u8[o + 1] << 8) | u8[o + 2];
            tempoMap.push({ tick: tick, usPerBeat: us });
          }
          o += l;
        } else if (st === 0xf0 || st === 0xf7) {
          let l;
          [l, o] = readVLQ(u8, o);
          o += l;
        } else if (hi === 0x90 || hi === 0x80) {
          const note = u8[o++];
          const vel = u8[o++];
          const key = (ch << 8) | note;
          const isOn = hi === 0x90 && vel > 0;
          if (isOn) {
            open.set(key, { start: tick, ch: ch, note: note, vel: vel, prog: programs[ch] });
          } else {
            const n = open.get(key);
            if (n) {
              notes.push({
                start: n.start, end: tick, ch: n.ch, note: n.note,
                vel: n.vel, prog: n.prog,
              });
              open.delete(key);
            }
          }
        } else if (hi === 0xc0) {
          programs[ch] = u8[o++];
        } else if (hi === 0xd0) {
          o += 1;
        } else if (hi === 0xb0 || hi === 0xe0 || hi === 0xa0) {
          o += 2;
        } else {
          break;
        }
      }
      o = end;
    }

    // close any still-held notes at the last tick we saw
    let lastTick = 0;
    for (let i = 0; i < notes.length; i++) if (notes[i].end > lastTick) lastTick = notes[i].end;
    open.forEach((n) => {
      const endTick = Math.max(lastTick, n.start + tpq);
      notes.push({ start: n.start, end: endTick, ch: n.ch, note: n.note, vel: n.vel, prog: n.prog });
      if (endTick > lastTick) lastTick = endTick;
    });
    open.clear();

    tempoMap.sort((a, b) => a.tick - b.tick);
    // collapse duplicate tick tempos (keep last)
    const compact = [];
    for (let i = 0; i < tempoMap.length; i++) {
      const t = tempoMap[i];
      if (compact.length && compact[compact.length - 1].tick === t.tick) compact[compact.length - 1] = t;
      else compact.push(t);
    }

    function tickToSec(tick) {
      let sec = 0, prevTick = 0, us = compact[0].usPerBeat;
      for (let i = 1; i < compact.length; i++) {
        const t = compact[i];
        if (t.tick >= tick) break;
        sec += ((t.tick - prevTick) * us) / (tpq * 1e6);
        prevTick = t.tick;
        us = t.usPerBeat;
      }
      sec += ((tick - prevTick) * us) / (tpq * 1e6);
      return sec;
    }

    const timed = notes.map((n) => ({
      t0: tickToSec(n.start),
      t1: tickToSec(n.end),
      ch: n.ch,
      note: n.note,
      vel: n.vel,
      prog: n.prog,
    }));
    timed.sort((a, b) => a.t0 - b.t0 || a.note - b.note);
    let duration = 0;
    for (let i = 0; i < timed.length; i++) if (timed[i].t1 > duration) duration = timed[i].t1;
    // small pad so the last release finishes before loop restart
    duration += 0.35;

    return {
      format: format,
      tpq: tpq,
      duration: duration,
      notes: timed,
      noteCount: timed.length,
    };
  }

  function midiToHz(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  /** Pick a softsynth voice shape from a GM program number. */
  function voiceFor(prog, ch) {
    if (ch === 9) {
      return { type: "noise", peak: 0.07, atk: 0.005, dec: 0.12, sus: 0.0, rel: 0.08 };
    }
    // GM families — keep everything gentle so dense Settlers-style scores don't clip
    if (prog >= 40 && prog <= 47) { // ensemble / strings-ish
      return { type: "sawtooth", peak: 0.045, atk: 0.08, dec: 0.2, sus: 0.55, rel: 0.35 };
    }
    if (prog >= 48 && prog <= 55) { // strings / tremolo
      return { type: "sawtooth", peak: 0.04, atk: 0.12, dec: 0.25, sus: 0.6, rel: 0.4 };
    }
    if (prog >= 72 && prog <= 79) { // pipe / flute
      return { type: "sine", peak: 0.07, atk: 0.06, dec: 0.1, sus: 0.65, rel: 0.25 };
    }
    if (prog >= 88 && prog <= 95) { // pad / synth
      return { type: "triangle", peak: 0.05, atk: 0.25, dec: 0.3, sus: 0.7, rel: 0.5 };
    }
    if (prog >= 96 && prog <= 103) { // FX
      return { type: "sine", peak: 0.035, atk: 0.2, dec: 0.4, sus: 0.5, rel: 0.6 };
    }
    if (prog >= 24 && prog <= 31) { // guitar
      return { type: "triangle", peak: 0.06, atk: 0.008, dec: 0.25, sus: 0.25, rel: 0.2 };
    }
    return { type: "triangle", peak: 0.055, atk: 0.03, dec: 0.15, sus: 0.45, rel: 0.25 };
  }

  function play(ctx, dest, song, opts) {
    opts = opts || {};
    const loop = opts.loop !== false;
    const LOOKAHEAD = 0.55;
    let running = true;
    let cycleStart = ctx.currentTime + 0.05;
    let nextIdx = 0;
    let active = 0;
    const MAX_POLY = 48;
    let scheduled = 0;

    function scheduleNote(n, absT0) {
      if (!running || active >= MAX_POLY) return;
      const dur = Math.max(0.04, n.t1 - n.t0);
      const absT1 = absT0 + dur;
      const v = voiceFor(n.prog, n.ch);
      const vel = Math.max(0.05, Math.min(1, n.vel / 127));
      const peak = v.peak * (0.35 + 0.65 * vel);
      const g = ctx.createGain();
      g.connect(dest);
      g.gain.setValueAtTime(0.0001, absT0);
      const atkEnd = absT0 + v.atk;
      const decEnd = atkEnd + v.dec;
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), atkEnd);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * v.sus), Math.min(decEnd, absT1));
      const relStart = Math.max(absT0 + 0.02, absT1);
      g.gain.setValueAtTime(Math.max(0.0002, g.gain.value || peak * v.sus), relStart);
      g.gain.exponentialRampToValueAtTime(0.0001, relStart + v.rel);

      active++;
      scheduled++;
      if (v.type === "noise") {
        const sr = ctx.sampleRate;
        const nSamp = Math.max(1, Math.round((dur + v.rel + 0.05) * sr));
        const buf = ctx.createBuffer(1, nSamp, sr);
        const d = buf.getChannelData(0);
        for (let i = 0; i < nSamp; i++) d[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filt = ctx.createBiquadFilter();
        filt.type = "bandpass";
        filt.frequency.value = midiToHz(n.note);
        filt.Q.value = 2.2;
        src.connect(filt);
        filt.connect(g);
        src.start(absT0);
        src.stop(relStart + v.rel + 0.02);
        src.onended = () => {
          active = Math.max(0, active - 1);
          try { src.disconnect(); filt.disconnect(); g.disconnect(); } catch (e) { /* noop */ }
        };
      } else {
        const osc = ctx.createOscillator();
        osc.type = v.type;
        osc.frequency.setValueAtTime(midiToHz(n.note), absT0);
        // faint detuned twin for pads/strings richness
        let osc2 = null, g2 = null;
        if (v.type === "sawtooth" || (n.prog >= 88 && n.prog <= 95)) {
          osc2 = ctx.createOscillator();
          osc2.type = v.type === "sawtooth" ? "triangle" : "sine";
          osc2.frequency.setValueAtTime(midiToHz(n.note) * 1.003, absT0);
          g2 = ctx.createGain();
          g2.gain.value = 0.45;
          osc2.connect(g2);
          g2.connect(g);
        }
        osc.connect(g);
        osc.start(absT0);
        osc.stop(relStart + v.rel + 0.02);
        if (osc2) { osc2.start(absT0); osc2.stop(relStart + v.rel + 0.02); }
        osc.onended = () => {
          active = Math.max(0, active - 1);
          try { osc.disconnect(); if (osc2) { osc2.disconnect(); g2.disconnect(); } g.disconnect(); } catch (e) { /* noop */ }
        };
      }
    }

    function tick(now) {
      if (!running || !song || !song.notes) return;
      const horizon = now + LOOKAHEAD;
      // schedule across one or more loop cycles that fall into the lookahead
      while (true) {
        const cycleEnd = cycleStart + song.duration;
        if (cycleStart > horizon) break;
        while (nextIdx < song.notes.length) {
          const n = song.notes[nextIdx];
          const absT0 = cycleStart + n.t0;
          if (absT0 > horizon) break;
          if (absT0 + 0.01 >= now) scheduleNote(n, absT0);
          nextIdx++;
        }
        if (nextIdx < song.notes.length) break;
        if (!loop) { running = false; break; }
        // advance to next loop cycle
        cycleStart = cycleEnd;
        nextIdx = 0;
      }
    }

    // kick an initial schedule so music starts without waiting a frame
    tick(ctx.currentTime);

    return {
      stop: function () { running = false; },
      tick: tick,
      debug: function () {
        return {
          running: running,
          duration: song.duration,
          nextIdx: nextIdx,
          active: active,
          scheduled: scheduled,
          cycleStart: cycleStart,
          loop: loop,
        };
      },
    };
  }

  window.FSMidi = { parse: parse, play: play, version: 1 };
})();
