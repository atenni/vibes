// Microphone input: getUserMedia → AudioContext → AnalyserNode.
// `createMic({ demo: true })` swaps the microphone for a synthetic plucked
// string so the whole pipeline can be exercised without a guitar.

const FFT_SIZE = 4096;

/** Plucked-string demo notes (Hz): E2, A2, D3, G3. */
const DEMO_NOTES = [82.41, 110, 146.83, 196];
const DEMO_PLUCK_S = 3.5;

/**
 * @param {{ demo?: boolean }} [options]
 */
export function createMic({ demo = false } = {}) {
  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {AnalyserNode | null} */
  let analyser = null;
  /** @type {MediaStream | null} */
  let stream = null;
  /** @type {AudioNode[]} */
  let nodes = [];
  /** @type {number | null} */
  let demoTimer = null;
  /** @type {WakeLockSentinel | null} */
  let wakeLock = null;
  let wantWakeLock = false;
  let frame = new Float32Array(FFT_SIZE);

  /** Request the screen wake lock; failure is harmless. */
  async function lockScreen() {
    wantWakeLock = true;
    try {
      wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
      wakeLock?.addEventListener("release", () => (wakeLock = null));
    } catch {
      wakeLock = null;
    }
  }

  function releaseScreen() {
    wantWakeLock = false;
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }

  /** Wake locks drop when the page is hidden; ask again when it returns. */
  function onVisible() {
    if (document.visibilityState === "visible" && wantWakeLock && !wakeLock) {
      lockScreen();
    }
  }
  document.addEventListener("visibilitychange", onVisible);

  /** Synthetic string: a few decaying harmonics, slowly drifting in pitch. */
  function startDemo() {
    const osc = [1, 2, 3, 4].map((h) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      // Weak fundamental, strong 2nd harmonic: like a real plucked string.
      g.gain.value = [0.18, 0.3, 0.12, 0.05][h - 1];
      o.connect(g);
      return { o, g, h };
    });
    const env = ctx.createGain();
    env.gain.value = 0;
    for (const { g } of osc) g.connect(env);
    env.connect(analyser);
    for (const { o } of osc) o.start();
    nodes.push(env, ...osc.flatMap(({ o, g }) => [o, g]));

    let n = 0;
    const pluck = () => {
      const base = DEMO_NOTES[n++ % DEMO_NOTES.length];
      const now = ctx.currentTime;
      // Start about 45 cents flat or sharp and drift toward (and past) pitch.
      const from = base * 2 ** ((n % 2 ? -45 : 38) / 1200);
      const to = base * 2 ** ((n % 2 ? 6 : -8) / 1200);
      for (const { o, h } of osc) {
        o.frequency.cancelScheduledValues(now);
        o.frequency.setValueAtTime(from * h, now);
        o.frequency.linearRampToValueAtTime(to * h, now + DEMO_PLUCK_S * 0.9);
      }
      env.gain.cancelScheduledValues(now);
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(1, now + 0.01);
      env.gain.exponentialRampToValueAtTime(0.02, now + DEMO_PLUCK_S);
    };
    pluck();
    demoTimer = setInterval(pluck, DEMO_PLUCK_S * 1000);
  }

  const mic = {
    active: false,
    sampleRate: 48000,

    /** Must be called from a user gesture. Rejects with a named Error. */
    async start() {
      if (mic.active) return;
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) throw named("NotSupportedError", "Web Audio is not available");
      if (!demo && !navigator.mediaDevices?.getUserMedia) {
        throw named("NotSupportedError", "Microphone access is unavailable");
      }

      // Keep the context inside the user gesture, before any await.
      // "play-and-record" lets iOS use the mic and still make sound.
      if ("audioSession" in navigator) {
        try {
          navigator.audioSession.type = "play-and-record";
        } catch {
          // Unsupported value; keep the default session.
        }
      }
      ctx = new AC({ latencyHint: "interactive" });
      const resumed = ctx.resume();

      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        analyser.smoothingTimeConstant = 0;
        if (demo) {
          startDemo();
        } else {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            },
          });
          const source = ctx.createMediaStreamSource(stream);
          // Analyser only: nothing is routed to the speakers.
          source.connect(analyser);
          nodes.push(source);
        }
        await resumed;
      } catch (error) {
        teardown();
        throw error;
      }
      mic.sampleRate = ctx.sampleRate;
      frame = new Float32Array(analyser.fftSize);
      mic.active = true;
      lockScreen();
    },

    stop() {
      teardown();
    },

    /** Latest time-domain window, or null when not listening. */
    read() {
      if (!mic.active || !analyser) return null;
      analyser.getFloatTimeDomainData(frame);
      return frame;
    },
  };

  function teardown() {
    mic.active = false;
    releaseScreen();
    if (demoTimer !== null) clearInterval(demoTimer);
    demoTimer = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    for (const node of nodes) {
      try {
        node.disconnect();
        if (node instanceof OscillatorNode) node.stop();
      } catch {
        // Already stopped.
      }
    }
    nodes = [];
    analyser = null;
    ctx?.close().catch(() => {});
    ctx = null;
  }

  return mic;
}

/** @param {string} name @param {string} message */
function named(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}
