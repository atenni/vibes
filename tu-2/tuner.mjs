// Stabiliser and meter state machine. Pure: time is always passed in.
//
//   detection ─▶ spike/octave guard ─▶ median of 5 ─▶ note/string hysteresis
//             ─▶ smoothed cents ─▶ in-tune hysteresis ─▶ LED stream / cent meter
//             ─▶ LED decay ─▶ DisplayState

import { analyse, getMode } from "./notes.mjs";

/**
 * @typedef {{ frequency: number, clarity: number }} Detection
 * @typedef {"idle" | "tuning" | "holding"} Status
 * @typedef {{
 *   status: Status,
 *   glyph: string,
 *   sharp: boolean,
 *   flat: boolean,
 *   flatBlink: boolean,
 *   leds: number[],
 *   guides: { flat: number, inTune: number, sharp: number },
 *   cents: number | null,
 *   inTune: boolean,
 *   note: string | null,
 *   string: number | null,
 *   frequency: number | null,
 * }} DisplayState
 * @typedef {{ flat?: boolean, sharp?: boolean, flatBlink?: boolean, leds?: number[] }} Indicators
 * @typedef {{
 *   now: number,
 *   detection: Detection | null,
 *   mode: string,
 *   reference: number,
 *   style: "stream" | "cent",
 * }} UpdateInput
 */

export const LED_COUNT = 11;
const CENTRE = 5;
/** LEDs plus a three-LED gap so the comet leaves and re-enters. */
export const TRACK_LENGTH = LED_COUNT + 3;
const COMET = [1, 0.55, 0.2];
const LOCK = [0.6, 1, 0.6];
const DIM = 0.35;

const DEFAULTS = {
  inTuneEnter: 3, // cents
  inTuneLeave: 5,
  speedK: 0.5,
  speedPower: 0.9,
  minSpeed: 1.2, // LEDs/s
  maxSpeed: 22,
  medianSize: 5,
  jumpCents: 700,
  jumpFrames: 3,
  switchFrames: 3,
  smoothingMs: 80,
  graceMs: 250, // short dropouts keep tuning
  holdMs: 1500, // then hold, then idle
  restartGapMs: 400, // a gap this long starts a fresh median window
  settleMs: 120,
  attackMs: 10,
  decayMs: 60,
};

/**
 * Stream speed in LEDs per second (signed: positive = sharp, left to right).
 * Always non-zero: the caller stops the stream when in tune (with hysteresis).
 * @param {number} cents
 * @param {Partial<typeof DEFAULTS>} [opts]
 */
export function streamSpeed(cents, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const magnitude = Math.abs(cents);
  const speed = Math.min(
    o.maxSpeed,
    Math.max(o.minSpeed, o.speedK * magnitude ** o.speedPower),
  );
  return Math.sign(cents) * speed;
}

/** @param {number} n @param {number} m */
const mod = (n, m) => ((n % m) + m) % m;

/** @param {number[]} values */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function createTuner(options = {}) {
  const o = { ...DEFAULTS, ...options };

  // Detection pipeline (log2 frequency, so a reference change doesn't matter).
  /** @type {number[]} */
  let history = [];
  let lastSignal = -Infinity;
  let hasData = false;
  let jumpCount = 0;
  let jumpValue = 0;

  // Target selection.
  /** @type {import("./notes.mjs").Analysis | null} */
  let displayed = null;
  let switchKey = null;
  let switchCount = 0;
  let medianFrequency = 0;
  let lastMode = "";
  let lastReference = 0;

  // Meter.
  let smoothed = 0;
  let inTune = false;
  /** @type {"free" | "settling" | "locked"} */
  let lock = "free";
  let phase = CENTRE;
  let direction = 1;
  let settleElapsed = 0;
  let settleFrom = CENTRE;
  let settleDistance = 0;

  let lastNow = /** @type {number | null} */ (null);
  const leds = new Array(LED_COUNT).fill(0);
  const guides = { flat: 0, inTune: 0, sharp: 0 };

  /** @type {{ glyph: string, indicators: Indicators, until: number } | null} */
  let overlay = null;

  function clearTracking() {
    history = [];
    hasData = false;
    jumpCount = 0;
    displayed = null;
    switchKey = null;
    switchCount = 0;
    inTune = false;
    lock = "free";
    phase = CENTRE;
    direction = 1;
  }

  /**
   * @param {Detection} detection
   * @param {number} now
   * @param {string} mode
   * @param {number} reference
   */
  function ingest(detection, now, mode, reference) {
    const value = Math.log2(detection.frequency);
    if (now - lastSignal > o.restartGapMs) {
      history = [];
      jumpCount = 0;
    }
    lastSignal = now;

    // Octave/spike guard: a big jump must repeat before we believe it.
    if (history.length > 0) {
      const previous = history[history.length - 1];
      if (Math.abs(value - previous) * 1200 > o.jumpCents) {
        if (jumpCount > 0 && Math.abs(value - jumpValue) * 1200 < 100)
          jumpCount++;
        else jumpCount = 1;
        jumpValue = value;
        if (jumpCount < o.jumpFrames) return;
        history = []; // believed: start over on the new pitch
      }
    }
    jumpCount = 0;

    history.push(value);
    if (history.length > o.medianSize) history.shift();
    medianFrequency = 2 ** median(history);
    hasData = true;
    pickTarget(mode, reference);
  }

  /**
   * @param {string} mode
   * @param {number} reference
   */
  function pickTarget(mode, reference) {
    const candidate = analyse(medianFrequency, mode, reference);
    const key = candidate.string ?? candidate.midi;
    const currentKey = displayed ? (displayed.string ?? displayed.midi) : null;
    if (displayed === null || key === currentKey) {
      switchCount = 0;
      switchKey = null;
      if (displayed === null) {
        displayed = candidate;
        smoothed = rawCents();
        inTune = false;
        lock = "free";
      } else {
        // Same target: refresh in case the mode's tuning table is the same.
        displayed = candidate;
      }
      return;
    }
    if (switchKey === key) switchCount++;
    else {
      switchKey = key;
      switchCount = 1;
    }
    if (switchCount >= o.switchFrames) {
      displayed = candidate;
      switchKey = null;
      switchCount = 0;
      smoothed = rawCents();
      inTune = false;
      lock = "free";
    }
  }

  function rawCents() {
    return displayed
      ? 1200 * Math.log2(medianFrequency / displayed.targetFrequency)
      : 0;
  }

  /**
   * @param {number[]} target
   * @param {number} dt
   */
  function decayLeds(target, dt) {
    const attack = 1 - Math.exp(-dt / o.attackMs);
    const decay = 1 - Math.exp(-dt / o.decayMs);
    for (let i = 0; i < LED_COUNT; i++) {
      leds[i] += (target[i] - leds[i]) * (target[i] > leds[i] ? attack : decay);
      if (leds[i] < 0.01) leds[i] = 0;
    }
  }

  /** @param {number} p unwrapped track position */
  function cometTarget(p, dir) {
    const target = new Array(LED_COUNT).fill(0);
    const head = Math.floor(p);
    for (let k = 0; k < COMET.length; k++) {
      const index = mod(head - dir * k, TRACK_LENGTH);
      if (index < LED_COUNT) target[index] = Math.max(target[index], COMET[k]);
    }
    return target;
  }

  /** @param {number} cents */
  function centTarget(cents) {
    const target = new Array(LED_COUNT).fill(0);
    const x = CENTRE + Math.max(-50, Math.min(50, cents)) / 10;
    const nearest = Math.round(x);
    const offset = x - nearest;
    target[nearest] = 1;
    const neighbour = nearest + (offset < 0 ? -1 : 1);
    if (neighbour >= 0 && neighbour < LED_COUNT)
      target[neighbour] = Math.abs(offset);
    return target;
  }

  /**
   * @param {UpdateInput} input
   * @returns {DisplayState}
   */
  function update({ now, detection, mode, reference, style }) {
    const dt =
      lastNow === null ? 16 : Math.min(100, Math.max(0, now - lastNow));
    lastNow = now;

    if (mode !== lastMode || reference !== lastReference) {
      // New target table or pitch: re-pick the target without waiting.
      lastMode = mode;
      lastReference = reference;
      if (hasData) {
        displayed = null;
        pickTarget(mode, reference);
      }
    }

    if (detection) ingest(detection, now, mode, reference);

    const sinceSignal = now - lastSignal;
    /** @type {Status} */
    let status = "idle";
    if (hasData) {
      if (sinceSignal > o.holdMs) clearTracking();
      else status = sinceSignal > o.graceMs ? "holding" : "tuning";
    }

    const active = status !== "idle";
    const moving = status === "tuning";
    let ledTarget = new Array(LED_COUNT).fill(0);

    if (active) {
      if (moving) {
        smoothed +=
          (rawCents() - smoothed) * (1 - Math.exp(-dt / o.smoothingMs));
        const magnitude = Math.abs(smoothed);
        if (inTune) inTune = magnitude <= o.inTuneLeave;
        else inTune = magnitude <= o.inTuneEnter;
      }

      if (style === "stream") {
        if (inTune) {
          if (lock === "free") {
            lock = "settling";
            settleElapsed = 0;
            settleFrom = phase;
            // Travel on in the current direction until we reach the centre.
            settleDistance = mod((CENTRE - phase) * direction, TRACK_LENGTH);
          }
          if (lock === "settling" && moving) {
            settleElapsed += dt;
            const t = Math.min(1, settleElapsed / o.settleMs);
            const next = settleFrom + direction * settleDistance * t;
            phase = next;
            if (t >= 1) {
              lock = "locked";
              phase = CENTRE;
            }
          }
        } else {
          if (lock !== "free") {
            lock = "free";
            phase = CENTRE;
          }
          if (moving) {
            direction = smoothed < 0 ? -1 : 1;
            const next = phase + (streamSpeed(smoothed, o) * dt) / 1000;
            phase = next;
          }
        }
        phase = mod(phase, TRACK_LENGTH);
        ledTarget =
          lock === "locked" ? lockTarget() : cometTarget(phase, direction);
      } else {
        lock = "free";
        phase = CENTRE;
        ledTarget = centTarget(inTune ? 0 : smoothed);
        if (inTune) ledTarget[CENTRE] = 1;
      }
      if (!moving) ledTarget = ledTarget.map((v) => v * DIM);
    } else {
      smoothed = 0;
    }

    const ledFlash = overlay && now < overlay.until && overlay.indicators.leds;
    if (ledFlash) {
      ledTarget = new Array(LED_COUNT).fill(0);
      for (const i of ledFlash) if (i >= 0 && i < LED_COUNT) ledTarget[i] = 1;
    }

    decayLeds(ledTarget, dt);

    // Guides.
    const lit = active ? (moving ? 1 : DIM) : 0;
    const settled = inTune && (style === "cent" || lock === "locked");
    const guideTarget = {
      flat: active && !inTune && smoothed < 0 ? lit : 0,
      sharp: active && !inTune && smoothed >= 0 ? lit : 0,
      inTune: active && settled ? lit : 0,
    };
    if (ledFlash) guideTarget.flat = guideTarget.sharp = guideTarget.inTune = 0;
    const attack = 1 - Math.exp(-dt / o.attackMs);
    const decay = 1 - Math.exp(-dt / o.decayMs);
    for (const name of /** @type {const} */ (["flat", "inTune", "sharp"])) {
      guides[name] +=
        (guideTarget[name] - guides[name]) *
        (guideTarget[name] > guides[name] ? attack : decay);
      if (guides[name] < 0.01) guides[name] = 0;
    }

    /** @type {DisplayState} */
    const state = {
      status,
      glyph: "-",
      sharp: false,
      flat: false,
      flatBlink: false,
      leds: leds.slice(),
      guides: { ...guides },
      cents: null,
      inTune: false,
      note: null,
      string: null,
      frequency: null,
    };

    if (active && displayed) {
      const flats = getMode(mode).flats;
      state.cents = smoothed;
      state.inTune = inTune;
      state.note = displayed.note;
      state.string = displayed.string;
      state.frequency = medianFrequency;
      if (displayed.string !== null) {
        state.glyph = String(displayed.string);
        state.flat = flats > 0;
        state.flatBlink = flats === 2;
      } else {
        state.glyph = displayed.note[0];
        state.sharp = displayed.sharp;
      }
    }

    if (overlay) {
      if (now >= overlay.until) overlay = null;
      else {
        state.glyph = overlay.glyph;
        state.sharp = overlay.indicators.sharp ?? false;
        state.flat = overlay.indicators.flat ?? false;
        state.flatBlink = overlay.indicators.flatBlink ?? false;
      }
    }
    return state;
  }

  function lockTarget() {
    const target = new Array(LED_COUNT).fill(0);
    for (let k = 0; k < LOCK.length; k++) target[CENTRE - 1 + k] = LOCK[k];
    return target;
  }

  /**
   * Temporarily override the 7-segment display (mode/pitch changes, errors).
   * @param {string} glyph
   * @param {Indicators} indicators
   * @param {number} durationMs
   * @param {number} now
   */
  function flash(glyph, indicators, durationMs, now) {
    overlay = { glyph, indicators: indicators ?? {}, until: now + durationMs };
  }

  return { update, flash };
}
