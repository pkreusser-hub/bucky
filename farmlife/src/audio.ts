// ---------------------------------------------------------------------------
// Farm Life audio (P6) — WebAudio SYNTH ONLY, no asset files (house convention:
// Barnyard Bistro Stage 4 + Farm Kart audio). Sounds are render-layer REACTIONS
// to gameplay state changes; nothing here is gameplay-authoritative. Mute is
// persisted to localStorage `fl_muted`; SFX volume to `fl_sfxvol`. The
// AudioContext is created lazily and RESUMED on the first user gesture (browsers
// block autoplay until then) — every method is a safe no-op before that.
//
// Gain staging (loud → quiet): SFX ride the master at ~0.9; ambient beds
// (day birds / night crickets / rain patter) are crossfaded WELL BELOW the SFX
// so they never fatigue. Remote players' tool actions play a distance-attenuated
// copy (simple linear gain) so a far-off family member is a faint tap, not a
// full-volume thunk.
// ---------------------------------------------------------------------------

const MUTE_KEY = "fl_muted";
const VOL_KEY = "fl_sfxvol";

type Wave = OscillatorType;

function readBool(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}
function readNum(key: string, dflt: number): number {
  try {
    const v = localStorage.getItem(key);
    const n = v == null ? NaN : parseFloat(v);
    return isFinite(n) ? Math.max(0, Math.min(1, n)) : dflt;
  } catch {
    return dflt;
  }
}

export class FarmAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null; // SFX + gesture master (mute kills this)
  private sfxGain: GainNode | null = null; // SFX volume slider rides here
  private ambGain: GainNode | null = null; // ambient bed sub-master (always quiet)
  private muted: boolean;
  private volume: number; // 0..1 SFX volume
  private noiseBuf: AudioBuffer | null = null;

  // ambient beds
  private dayGain: GainNode | null = null;
  private nightGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private dayFactor = 1;
  private ambTargets = { day: 0, night: 0, rain: 0 }; // last requested crossfade targets

  // footstep cadence
  private stepPhase = 0;

  // test hook: counts sound events actually SCHEDULED (skipped while muted)
  playCount = 0;

  constructor() {
    this.muted = readBool(MUTE_KEY, false);
    this.volume = readNum(VOL_KEY, 0.8);
  }

  /** Create the AudioContext (idempotent). Call on the first user gesture. */
  resume(): void {
    try {
      if (!this.ctx) {
        const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        if (!AC) return;
        this.ctx = new AC();
        this.buildGraph();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      /* audio unavailable — every method stays a no-op */
    }
  }

  private buildGraph(): void {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.volume;
    this.sfxGain.connect(this.master);

    this.ambGain = ctx.createGain();
    this.ambGain.gain.value = 0.55; // ambient sub-master (kept low)
    this.ambGain.connect(this.master);

    // shared white-noise buffer (1s, looped for beds / one-shot for scatter)
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.startAmbient();
  }

  // ---- mute / volume --------------------------------------------------------
  isMuted(): boolean {
    return this.muted;
  }
  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (this.master && this.ctx) {
      // set the value directly (instant, and reflected in `.gain.value` reads);
      // a tiny ramp softens the mute click without leaving `.value` mid-curve.
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.value = m ? 0 : 1;
    }
  }
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }
  getVolume(): number {
    return this.volume;
  }
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    try {
      localStorage.setItem(VOL_KEY, this.volume.toFixed(2));
    } catch {
      /* ignore */
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.sfxGain.gain.value = this.volume;
    }
  }

  private live(): boolean {
    return !!(this.ctx && this.sfxGain && !this.muted);
  }

  // ---- primitive synth voices ----------------------------------------------
  /** A short enveloped oscillator tone. gain is the peak. */
  private tone(freq: number, dur: number, type: Wave, gain: number, dest?: AudioNode, slideTo?: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.sfxGain!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** A filtered burst of white noise (scatter / splash / sprinkle). */
  private noise(dur: number, filt: BiquadFilterType, freq: number, q: number, gain: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = filt;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + Math.min(0.03, dur * 0.4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxGain!);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  /** Rising/arbitrary arpeggio (coins, chimes, fanfare). */
  private arp(freqs: number[], step: number, type: Wave, gain: number, dest?: AudioNode): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const t = t0 + i * step;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
      o.connect(g);
      g.connect(dest || this.sfxGain!);
      o.start(t);
      o.stop(t + step * 1.7);
    });
  }

  /** Optional per-event distance gain node (remote actions attenuate through it). */
  private at(distGain: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.value = Math.max(0, Math.min(1, distGain));
    g.connect(this.sfxGain!);
    return g;
  }

  private bump(): void {
    this.playCount++;
  }

  // ---- tool SFX -------------------------------------------------------------
  hoe(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.tone(150, 0.12, "sine", 0.5, dest, 70); // thunk
    this.noise(0.16, "highpass", 1600, 0.6, 0.16, dest); // dirt scatter
  }
  water(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.noise(0.4, "bandpass", 3200, 3, 0.14, dest); // sprinkle
  }
  plant(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.tone(420, 0.1, "triangle", 0.32, dest, 640); // pop
  }
  harvest(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.tone(300, 0.09, "sine", 0.34, dest, 200); // pluck
    this.arp([523, 659, 784], 0.06, "triangle", 0.26, dest); // rising chime
  }
  refill(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.tone(120, 0.34, "sine", 0.34, dest, 210); // rising glug
    this.noise(0.3, "lowpass", 700, 1, 0.1, dest);
  }

  // ---- movement SFX ---------------------------------------------------------
  /** Advance footstep cadence and emit soft ticks by gait (walk vs run). */
  footTick(dt: number, speed: number, gait: number): void {
    if (!this.live() || speed < 0.4) {
      this.stepPhase = 0;
      return;
    }
    const perStep = 0.42 - gait * 0.16; // faster cadence when running
    this.stepPhase += dt;
    if (this.stepPhase >= perStep) {
      this.stepPhase -= perStep;
      this.bump();
      const g = 0.05 + gait * 0.05;
      this.noise(0.06, "lowpass", 260 + gait * 120, 1, g);
    }
  }
  jump(): void {
    if (!this.live()) return;
    this.bump();
    this.tone(240, 0.18, "sine", 0.24, undefined, 560); // whoosh up
  }
  land(): void {
    if (!this.live()) return;
    this.bump();
    this.tone(140, 0.12, "sine", 0.34, undefined, 70); // thump
    this.noise(0.08, "lowpass", 220, 1, 0.08);
  }

  // ---- economy SFX ----------------------------------------------------------
  coin(): void {
    if (!this.live()) return;
    this.bump();
    this.arp([784, 988, 1319], 0.07, "square", 0.16); // coin arpeggio
  }
  buy(): void {
    if (!this.live()) return;
    this.bump();
    this.tone(660, 0.06, "square", 0.18); // click
  }
  milestone(): void {
    if (!this.live()) return;
    this.bump();
    this.arp([523, 659, 784, 1047, 1319], 0.09, "triangle", 0.22); // short fanfare
  }

  // ---- animal SFX -----------------------------------------------------------
  bleat(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(430, t);
    o.frequency.linearRampToValueAtTime(360, t + 0.28);
    // vibrato = goat wobble
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 34;
    lfo.connect(lg);
    lg.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(f);
    f.connect(g);
    g.connect(dest || this.sfxGain!);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.32);
    lfo.stop(t + 0.32);
  }
  cluck(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.tone(900, 0.05, "square", 0.12, dest, 640);
    this.tone(640, 0.05, "square", 0.1, dest, 480);
  }
  heartPing(dest?: AudioNode): void {
    if (!this.live()) return;
    this.bump();
    this.tone(1320, 0.14, "sine", 0.12, dest, 1760); // tiny sparkle
  }

  // ---- presence chimes ------------------------------------------------------
  join(): void {
    if (!this.live()) return;
    this.bump();
    this.arp([659, 880], 0.1, "sine", 0.16); // soft door chime
  }
  leave(): void {
    if (!this.live()) return;
    this.bump();
    this.arp([660, 494], 0.11, "sine", 0.14); // gentle 'bye'
  }

  /** A remote player's tool action, attenuated by distance (0 far → 1 near). */
  remoteAction(kind: "hoe" | "water" | "plant" | "harvest" | "refill" | "pet", distGain: number): void {
    if (!this.live() || distGain <= 0.02) return;
    const dest = this.at(distGain * 0.7);
    if (kind === "hoe") this.hoe(dest);
    else if (kind === "water") this.water(dest);
    else if (kind === "plant") this.plant(dest);
    else if (kind === "harvest") this.harvest(dest);
    else if (kind === "refill") this.refill(dest);
    else this.heartPing(dest);
  }

  // ---- ambient beds (birds day / crickets night / rain) ---------------------
  private startAmbient(): void {
    const ctx = this.ctx!;
    // crickets: a pulsing bandpass-filtered noise (night)
    this.nightGain = ctx.createGain();
    this.nightGain.gain.value = 0;
    this.nightGain.connect(this.ambGain!);
    const cricket = ctx.createBufferSource();
    cricket.buffer = this.noiseBuf;
    cricket.loop = true;
    const cf = ctx.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 4600;
    cf.Q.value = 12;
    const trem = ctx.createOscillator();
    trem.type = "square";
    trem.frequency.value = 8; // chirp pulse
    const tg = ctx.createGain();
    tg.gain.value = 0.5;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.5;
    trem.connect(tremDepth);
    tremDepth.connect(tg.gain);
    cricket.connect(cf);
    cf.connect(tg);
    tg.connect(this.nightGain);
    cricket.start();
    trem.start();

    // rain: soft lowpassed noise wash
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainGain.connect(this.ambGain!);
    const rain = ctx.createBufferSource();
    rain.buffer = this.noiseBuf;
    rain.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = "lowpass";
    rf.frequency.value = 2400;
    rf.Q.value = 0.6;
    rain.connect(rf);
    rf.connect(this.rainGain);
    rain.start();

    // day birds: a controllable gain that a self-scheduling chirp generator rides
    this.dayGain = ctx.createGain();
    this.dayGain.gain.value = 0;
    this.dayGain.connect(this.ambGain!);
    this.scheduleBird();
  }

  /** Occasional short 2-note bird chirp, only audible while dayGain is up. */
  private scheduleBird(): void {
    const delay = 1400 + Math.random() * 3200;
    window.setTimeout(() => {
      if (this.ctx && this.dayGain && this.dayFactor > 0.15 && !this.muted) {
        const base = 1800 + Math.random() * 1400;
        this.tone(base, 0.08, "sine", 0.5, this.dayGain, base * 1.25);
        this.tone(base * 1.18, 0.07, "sine", 0.4, this.dayGain, base * 0.95);
      }
      this.scheduleBird();
    }, delay);
  }

  /** Drive the ambient crossfade. dayFactor 1 = full day, 0 = night. */
  setAmbient(dayFactor: number, raining: boolean): void {
    this.dayFactor = Math.max(0, Math.min(1, dayFactor));
    const night = 1 - this.dayFactor;
    // birds fade with day, hush in rain
    this.ambTargets = {
      day: this.dayFactor * (raining ? 0.15 : 0.5),
      night: night * 0.32,
      rain: raining ? 0.4 : 0,
    };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // slow crossfade (1.5–2s) so day↔night never fatigues
    this.dayGain?.gain.setTargetAtTime(this.ambTargets.day, t, 1.5);
    this.nightGain?.gain.setTargetAtTime(this.ambTargets.night, t, 1.5);
    this.rainGain?.gain.setTargetAtTime(this.ambTargets.rain, t, 2.0);
  }

  // ---- test hooks -----------------------------------------------------------
  masterGainValue(): number {
    return this.master ? this.master.gain.value : this.muted ? 0 : 1;
  }
  ambientGains(): { day: number; night: number; rain: number } {
    return {
      day: this.dayGain?.gain.value ?? 0,
      night: this.nightGain?.gain.value ?? 0,
      rain: this.rainGain?.gain.value ?? 0,
    };
  }
  /** The requested crossfade targets (reached over ~1.5–2s). Tests read these
   * rather than the slow instantaneous gains. */
  ambientTargets(): { day: number; night: number; rain: number } {
    return { ...this.ambTargets };
  }
  ctxState(): string {
    return this.ctx ? this.ctx.state : "none";
  }
}
