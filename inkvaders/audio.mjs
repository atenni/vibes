// Web Audio synth: every sound is generated, nothing is fetched. The context
// is created on the first user gesture (browsers require one).

const MARCH_NOTES = [55.0, 51.91, 49.0, 46.25]; // the classic descending bassline
const KIND_PITCH = {
  blob: 330,
  squid: 392,
  crab: 262,
  diver: 440,
  inkeater: 494,
};
// Pentatonic ladder for ricochet "tings": a combo climbs the scale.
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16];

export function createAudio() {
  /** @type {AudioContext | null} */ let ctx = null;
  /** @type {GainNode | null} */ let master = null;
  /** @type {AudioBuffer | null} */ let noiseBuf = null;
  let enabled = true;

  // Continuous voices.
  /** @type {{ gain: GainNode, filter: BiquadFilterNode } | null} */ let inkVoice =
    null;
  /** @type {{ osc: OscillatorNode, gain: GainNode } | null} */ let mothership =
    null;
  let drawLevel = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext ?? window.webkitAudioContext;
    if (!AC) return null;
    // iOS routes Web Audio through the "ambient" session by default, which the
    // ring/silent switch mutes. A game is media the player chose to start, so
    // ask for the "playback" session like <video> uses (Safari 17+).
    if ("audioSession" in navigator) {
      try {
        navigator.audioSession.type = "playback";
      } catch {
        // Unsupported value; keep the default session.
      }
    }
    ctx = new AC({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = enabled ? 0.8 : 0;
    master.connect(comp).connect(ctx.destination);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Ink-drawing hiss: looped noise → band-pass → gain (volume follows speed).
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800;
    filter.Q.value = 2.5;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(master);
    src.start();
    inkVoice = { gain, filter };
    return ctx;
  }

  /** Call from inside a user gesture handler. */
  function unlock() {
    const c = ensure();
    if (c && c.state !== "running") c.resume().catch(() => {});
  }

  /** Suspend when hidden/paused so nothing hisses in the background. */
  function suspend() {
    if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
  }
  function resume() {
    if (ctx && ctx.state !== "running") ctx.resume().catch(() => {});
  }

  /** @param {number} freq @param {number} dur @param {OscillatorType} type @param {number} vol */
  function tone(freq, dur, type, vol, o = {}) {
    if (!ctx || !enabled) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (o.slideTo)
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, o.slideTo),
        t0 + dur,
      );
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, vol, freq, o = {}) {
    if (!ctx || !enabled || !noiseBuf) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? "lowpass";
    f.frequency.setValueAtTime(freq, t0);
    if (o.slideTo)
      f.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.03);
  }

  const semis = (base, n) => base * Math.pow(2, n / 12);

  const sounds = {
    shot() {
      tone(900 + Math.random() * 60, 0.045, "square", 0.018, { slideTo: 500 });
    },
    invaderHit() {
      tone(240, 0.07, "square", 0.09, { slideTo: 160 });
      noise(0.05, 0.08, 3000, { type: "highpass" });
    },
    invaderKilled(e) {
      const base = KIND_PITCH[e.kind] ?? 330;
      tone(base, 0.16, "sawtooth", 0.11, { slideTo: base * 0.3 });
      noise(0.14, 0.18, 2500, { slideTo: 300 });
      if (e.byRicochet)
        tone(
          semis(880, LADDER[Math.min(7, (e.combo ?? 1) - 1)]),
          0.18,
          "triangle",
          0.1,
          { delay: 0.03 },
        );
      if ((e.combo ?? 1) >= 3) {
        // A rising sparkle run for real combos; longer as the combo grows.
        const n = Math.min(6, e.combo);
        for (let i = 0; i < n; i++) {
          tone(semis(1047, LADDER[i]), 0.14, "triangle", 0.06, {
            delay: 0.05 + i * 0.045,
          });
        }
        tone(70, 0.25, "sine", 0.18, { slideTo: 40 });
      }
    },
    ricochet(e) {
      const step = LADDER[Math.min(7, Math.max(0, (e.combo ?? 1) - 1))];
      const f = semis(784, step);
      tone(f, 0.28, "sine", 0.17);
      tone(f * 2.01, 0.2, "triangle", 0.07, { delay: 0.006 });
      tone(f * 3, 0.09, "sine", 0.04);
    },
    inkEmpty() {
      tone(110, 0.16, "square", 0.14, { slideTo: 55 });
      noise(0.1, 0.12, 400);
    },
    bombFired() {
      tone(180, 0.35, "sine", 0.14, { slideTo: 700 });
      noise(0.3, 0.07, 600, { type: "bandpass", slideTo: 3000 });
    },
    bombBurst() {
      tone(120, 0.9, "sine", 0.55, { slideTo: 28, attack: 0.01 });
      tone(60, 0.7, "triangle", 0.3, { slideTo: 24 });
      noise(0.7, 0.45, 5000, { slideTo: 120 });
      tone(1500, 0.5, "triangle", 0.05, { slideTo: 300, delay: 0.02 });
    },
    playerHit() {
      tone(220, 0.6, "sawtooth", 0.25, { slideTo: 40 });
      noise(0.6, 0.35, 2800, { slideTo: 90 });
    },
    waveClear() {
      [0, 4, 7, 12, 16, 19].forEach((n, i) =>
        tone(semis(392, n), 0.22, "square", 0.07, { delay: i * 0.075 }),
      );
    },
    waveStart(e) {
      if (e.boss) {
        tone(70, 1.2, "sawtooth", 0.2, { slideTo: 45, attack: 0.1 });
        tone(74, 1.2, "sawtooth", 0.2, { slideTo: 48, attack: 0.1 });
      } else {
        tone(semis(330, 0), 0.1, "triangle", 0.1);
        tone(semis(330, 7), 0.16, "triangle", 0.1, { delay: 0.09 });
      }
    },
    mothershipKilled() {
      [0, 7, 12, 19].forEach((n, i) =>
        tone(semis(523, n), 0.2, "triangle", 0.12, { delay: i * 0.06 }),
      );
      noise(0.3, 0.2, 4000, { slideTo: 400 });
    },
    inkRefill() {
      tone(300, 0.4, "sine", 0.1, { slideTo: 1200 });
    },
    bossHit() {
      tone(130, 0.1, "square", 0.12, { slideTo: 80 });
    },
    bossKilled() {
      for (let i = 0; i < 6; i++) {
        tone(200 - i * 20, 0.5, "sawtooth", 0.12, {
          delay: i * 0.12,
          slideTo: 30,
        });
        noise(0.4, 0.3, 3000, { delay: i * 0.12, slideTo: 100 });
      }
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) =>
        tone(semis(262, n), 0.3, "square", 0.08, { delay: 0.8 + i * 0.09 }),
      );
    },
    lifeGained() {
      [0, 5, 9, 12].forEach((n, i) =>
        tone(semis(440, n), 0.14, "triangle", 0.12, { delay: i * 0.07 }),
      );
    },
    gameOver() {
      [0, -3, -7, -12].forEach((n, i) =>
        tone(semis(330, n), 0.45, "sawtooth", 0.14, {
          delay: i * 0.26,
          slideTo: semis(330, n) * 0.9,
        }),
      );
    },
    shockwave() {
      noise(0.35, 0.2, 2000, { slideTo: 200 });
    },
    inkEaten() {
      tone(500, 0.1, "square", 0.05, { slideTo: 200 });
    },
    diveStart() {
      tone(800, 0.3, "sawtooth", 0.04, { slideTo: 200 });
    },
    mothershipSpawn() {},
  };

  /** Play a short UI blip. */
  function ui(kind = "tap") {
    if (!ensure()) return;
    if (kind === "start") {
      [0, 7, 12].forEach((n, i) =>
        tone(semis(330, n), 0.12, "square", 0.08, { delay: i * 0.06 }),
      );
    } else if (kind === "pause") {
      tone(300, 0.08, "triangle", 0.1, { slideTo: 200 });
    } else {
      tone(660, 0.05, "triangle", 0.09);
    }
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(value) {
      enabled = Boolean(value);
      if (master && ctx)
        master.gain.setTargetAtTime(enabled ? 0.8 : 0, ctx.currentTime, 0.02);
    },
    unlock,
    suspend,
    resume,
    ui,

    /** Play the sound for each event, plus the marching bassline. */
    handle(events) {
      if (!ctx || !enabled) return;
      for (const e of events) {
        if (e.type === "march") {
          const f = MARCH_NOTES[e.note & 3];
          tone(f, 0.12, "square", 0.22);
          tone(f * 2, 0.08, "triangle", 0.1);
        } else {
          sounds[e.type]?.(e);
        }
      }
    },

    /**
     * Per-frame continuous voices.
     * @param {number} speed Ink drawing speed in units/s (0 when not drawing).
     * @param {boolean} mothershipPresent
     * @param {boolean} active False while paused/title: voices fall silent.
     */
    update(speed, mothershipPresent, active) {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (inkVoice) {
        const target = active && enabled ? Math.min(1, speed / 700) : 0;
        drawLevel += (target - drawLevel) * 0.35;
        inkVoice.gain.gain.setTargetAtTime(drawLevel * 0.22, now, 0.03);
        inkVoice.filter.frequency.setTargetAtTime(
          900 + drawLevel * 3200,
          now,
          0.04,
        );
      }
      const want = mothershipPresent && active && enabled;
      if (want && !mothership) {
        const osc = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = 620;
        lfo.frequency.value = 7;
        lfoGain.gain.value = 140;
        lfo.connect(lfoGain).connect(osc.frequency);
        gain.gain.value = 0.0001;
        gain.gain.setTargetAtTime(0.035, now, 0.1);
        osc.connect(gain).connect(master);
        osc.start();
        lfo.start();
        mothership = { osc, gain };
        mothership.lfo = lfo;
      } else if (!want && mothership) {
        const m = mothership;
        mothership = null;
        m.gain.gain.setTargetAtTime(0.0001, now, 0.05);
        m.osc.stop(now + 0.3);
        m.lfo?.stop(now + 0.3);
      }
    },
  };
}
