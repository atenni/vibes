import * as DW from "./core.mjs";

/* All sources, including room/record effects, are made here. No sampled assets. */
export class AudioRack {
  constructor(seed, volume) {
    // iOS otherwise treats Web Audio as ambient sound, muted by Silent Mode.
    // Request media playback before opening the context, on the Play gesture.
    if (globalThis.navigator?.audioSession) {
      try {
        navigator.audioSession.type = "playback";
      } catch {
        // An unavailable session policy must not prevent ordinary playback.
      }
    }
    this.ctx = new AudioContext();
    const c = this.ctx;
    this.random = DW.rng(seed ^ 0xa5a5a5a5);
    this.active = new Set();
    this.loops = [];
    this.disposed = false;
    const gain = (v = 1) => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    this.master = gain(volume);
    this.master.connect(c.destination);
    this.input = gain(0.63);
    this.duck = gain();
    this.tone = c.createBiquadFilter();
    this.tone.type = "lowpass";
    this.tone.frequency.value = 4200;
    this.tone.Q.value = 0.5;
    this.sat = c.createWaveShaper();
    this.sat.oversample = "2x";
    this.delay = c.createDelay(0.1);
    this.delay.delayTime.value = 0.018;
    this.input
      .connect(this.duck)
      .connect(this.tone)
      .connect(this.sat)
      .connect(this.delay);
    this.dry = gain(0.87);
    this.delay.connect(this.dry).connect(this.master);
    this.reverb = c.createConvolver();
    this.wet = gain(0.2);
    this.delay.connect(this.reverb).connect(this.wet).connect(this.master);
    const impulse = c.createBuffer(2, c.sampleRate * 2.6, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const a = impulse.getChannelData(ch);
      for (let i = 0; i < a.length; i++)
        a[i] =
          (this.random() * 2 - 1) *
          Math.pow(1 - i / a.length, 3) *
          (i < c.sampleRate * 0.018 ? 0 : 1);
    }
    this.reverb.buffer = impulse;
    this.modDepth = [];
    for (const hz of [0.31, 5.7]) {
      const o = c.createOscillator(),
        g = gain(0.0004);
      o.frequency.value = hz;
      o.connect(g).connect(this.delay.delayTime);
      o.start();
      this.loops.push(o);
      this.modDepth.push(g);
    }
    this.noise = c.createBuffer(1, c.sampleRate * 3, c.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = this.random() * 2 - 1;
    this.buses = {};
    for (const p of ["chords", "bass", "melody", "drums"]) {
      this.buses[p] = gain();
      this.buses[p].connect(this.input);
    }
    this.textureGains = {};
    for (const name of DW.textures) {
      const g = gain(0);
      g.connect(this.input);
      this.textureGains[name] = g;
      if (name === "vinyl") continue;
      if (name === "hum" || name === "rumble") {
        for (const hz of name === "hum" ? [50, 100, 150] : [28, 36]) {
          const o = c.createOscillator(),
            amp = gain(name === "hum" ? 0.035 : 0.1);
          o.frequency.value = hz;
          o.connect(amp).connect(g);
          o.start();
          this.loops.push(o);
        }
      } else {
        const n = c.createBufferSource();
        n.buffer = this.noise;
        n.loop = true;
        n.playbackRate.value =
          name === "rain" ? 0.73 : name === "room" ? 0.46 : 1;
        const f = c.createBiquadFilter(),
          amp = gain(
            { surface: 0.025, tape: 0.022, rain: 0.11, room: 0.07 }[name],
          );
        f.type =
          name === "room"
            ? "lowpass"
            : name === "rain"
              ? "bandpass"
              : "highpass";
        f.frequency.value = {
          surface: 1700,
          tape: 3600,
          rain: 2200,
          room: 420,
        }[name];
        f.Q.value = 0.35;
        n.connect(f).connect(amp).connect(g);
        n.start(0, this.random() * 2);
        this.loops.push(n);
      }
    }
  }
  track(source, nodes, end, start) {
    source.scheduledAt = start;
    this.active.add(source);
    source.onended = () => {
      this.active.delete(source);
      source.disconnect();
      nodes.forEach((n) => n.disconnect());
    };
    source.stop(end);
    return source;
  }
  envelope(t, d, level, attack = 0.005) {
    const g = this.ctx.createGain(),
      p = g.gain;
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(Math.max(0.00001, level), t + attack);
    p.exponentialRampToValueAtTime(0.00001, t + Math.max(attack + 0.02, d));
    return g;
  }
  toneHit(freq, t, d, level, type, dest, fall = null) {
    const o = this.ctx.createOscillator(),
      g = this.envelope(t, d, level);
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (fall)
      o.frequency.exponentialRampToValueAtTime(fall, t + Math.min(d, 0.15));
    o.connect(g).connect(dest);
    o.start(t);
    this.track(o, [g], t + d + 0.03, t);
  }
  noiseHit(t, d, level, freq, type, dest) {
    const n = this.ctx.createBufferSource(),
      f = this.ctx.createBiquadFilter(),
      g = this.envelope(t, d, level);
    n.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = 0.65;
    n.connect(f).connect(g).connect(dest);
    n.start(t, this.random() * 1.5);
    this.track(n, [f, g], t + d + 0.03, t);
  }
  instrument(name, notes, t, d, v, part) {
    const c = this.ctx,
      dest = this.buses[part];
    for (const midi of notes) {
      const f = 440 * 2 ** ((midi - 69) / 12);
      const level = v / (notes.length > 2 ? Math.sqrt(notes.length) : 1);
      if (name === "epiano") {
        const o = c.createOscillator(),
          mod = c.createOscillator(),
          mg = this.envelope(t, Math.min(d + 0.25, 1.5), f * 1.3),
          g = this.envelope(t, Math.min(d + 0.5, 3), level * 0.15, 0.006);
        o.frequency.value = f;
        mod.frequency.value = f * 3.003;
        mod.connect(mg).connect(o.frequency);
        o.connect(g).connect(dest);
        o.start(t);
        mod.start(t);
        this.track(o, [g], t + Math.min(d + 0.55, 3.1), t);
        this.track(mod, [mg], t + Math.min(d + 0.55, 3.1), t);
        this.toneHit(f * 2, t, 0.2, level * 0.018, "sine", dest);
      } else if (name === "felt") {
        for (const [ratio, amp] of [
          [1, 0.15],
          [2, 0.035],
          [3, 0.012],
        ])
          this.toneHit(
            f * ratio,
            t,
            Math.min(d + 0.2, 2) / Math.sqrt(ratio),
            level * amp,
            "sine",
            dest,
          );
        this.noiseHit(t, 0.035, level * 0.018, 650, "lowpass", dest);
      } else if (name === "upright") {
        this.toneHit(
          f,
          t,
          Math.min(d + 0.12, 1.8),
          level * 0.24,
          "triangle",
          dest,
        );
        this.toneHit(f * 2, t, 0.22, level * 0.035, "sine", dest);
        this.noiseHit(t, 0.045, level * 0.06, 650, "lowpass", dest);
      } else if (name === "vibes") {
        this.toneHit(f, t, Math.min(d + 0.8, 3.5), level * 0.13, "sine", dest);
        this.toneHit(
          f * 3.99,
          t,
          Math.min(d + 0.1, 0.7),
          level * 0.032,
          "sine",
          dest,
        );
      } else {
        for (const cents of [-5, 5]) {
          const o = c.createOscillator(),
            g = this.envelope(t, Math.min(d + 0.8, 5), level * 0.07, 0.2),
            filter = c.createBiquadFilter();
          o.type = "triangle";
          o.frequency.value = f;
          o.detune.value = cents;
          filter.frequency.value = 1400;
          o.connect(filter).connect(g).connect(dest);
          o.start(t);
          this.track(o, [filter, g], t + Math.min(d + 0.9, 5.1), t);
        }
      }
    }
  }
  drum(voice, t, v) {
    const dest = this.buses.drums;
    if (voice === "kick") {
      this.toneHit(135, t, 0.32, v * 0.6, "sine", dest, 43);
      this.noiseHit(t, 0.03, v * 0.045, 1200, "lowpass", dest);
      const p = this.duck.gain;
      p.cancelScheduledValues(t);
      p.setValueAtTime(1, t);
      p.linearRampToValueAtTime(0.76, t + 0.012);
      p.exponentialRampToValueAtTime(1, t + 0.23);
    } else if (voice === "snare") {
      this.noiseHit(t, 0.18, v * 0.17, 1900, "highpass", dest);
      this.toneHit(180, t, 0.09, v * 0.1, "triangle", dest);
    } else if (voice === "rim") {
      this.toneHit(790, t, 0.028, v * 0.17, "triangle", dest);
      this.toneHit(1740, t, 0.018, v * 0.08, "sine", dest);
    } else if (voice === "hats")
      this.noiseHit(t, 0.065, v * 0.075, 6500, "highpass", dest);
    else if (voice === "brushes")
      this.noiseHit(t, 0.38, v * 0.1, 2900, "bandpass", dest);
    else this.toneHit(470, t, 0.09, v * 0.1, "sine", dest, 260);
  }
  setColour(s, t) {
    const glide = (p, v) => p.setTargetAtTime(v, t, 0.3);
    glide(this.tone.frequency, 900 + Math.pow(s.tone, 1.6) * 10500);
    glide(this.wet.gain, s.reverb * 0.6);
    glide(this.dry.gain, 1 - s.reverb * 0.23);
    this.modDepth.forEach((g, i) =>
      glide(g.gain, s.wow * (i ? 0.00032 : 0.0028)),
    );
    const amount = Math.round(s.saturation * 20),
      bits = s.crush > 0 ? Math.round(16 - s.crush * 11) : 24,
      key = amount + ":" + bits;
    if (this.satAmount !== key) {
      this.satAmount = key;
      const drive = 1 + amount * 0.16,
        a = new Float32Array(16384),
        steps = 2 ** bits;
      for (let i = 0; i < a.length; i++) {
        const x = (i * 2) / (a.length - 1) - 1,
          y = Math.tanh(x * drive) / Math.tanh(drive);
        a[i] = Math.round(y * steps) / steps;
      }
      this.sat.curve = a;
    }
    for (const k of DW.textures) glide(this.textureGains[k].gain, s[k]);
  }
  mix(song, s, muted, t) {
    for (const p in this.buses) {
      const balance =
        p === "bass"
          ? 1.3 - s.balance * 0.6
          : p === "melody"
            ? 0.7 + s.balance * 0.6
            : 1;
      this.buses[p].gain.setTargetAtTime(
        muted.has(p) ? 0 : song.levels[p] * balance,
        t,
        0.035,
      );
    }
  }
  surface(t, stepDuration, s) {
    if (this.random() < s.vinyl * 0.45) {
      this.noiseHit(
        t + this.random() * stepDuration,
        0.006 + this.random() * 0.018,
        0.035 + this.random() * 0.08,
        1400 + this.random() * 4000,
        "bandpass",
        this.textureGains.vinyl,
      );
    }
    if (s.rain > 0 && this.random() < 0.16)
      this.noiseHit(
        t,
        0.07,
        this.random() * 0.02,
        2600,
        "bandpass",
        this.textureGains.rain,
      );
  }
  needle() {
    const t = this.ctx.currentTime + 0.02;
    this.noiseHit(t, 0.19, 0.18, 900, "lowpass", this.input);
    this.toneHit(65, t, 0.16, 0.13, "sine", this.input, 30);
  }
  tapeStop() {
    const t = this.ctx.currentTime;
    for (const source of this.active) {
      if (source.frequency) {
        source.frequency.cancelScheduledValues(t);
        source.frequency.setTargetAtTime(12, t, 0.22);
      }
      if (source.playbackRate)
        source.playbackRate.setTargetAtTime(0.08, t, 0.22);
    }
    this.input.gain.setTargetAtTime(0.0001, t, 0.24);
  }
  cancelFrom(time) {
    for (const source of this.active) {
      if (source.scheduledAt >= time - 0.02) source.stop(time);
    }
    const params = [
      this.duck.gain,
      this.tone.frequency,
      this.wet.gain,
      this.dry.gain,
      ...this.modDepth.map((g) => g.gain),
      ...Object.values(this.textureGains).map((g) => g.gain),
      ...Object.values(this.buses).map((g) => g.gain),
    ];
    for (const param of params) param.cancelScheduledValues(time);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loops.forEach((o) => {
      try {
        o.stop();
      } catch {}
    });
    await this.ctx.close();
  }
}
