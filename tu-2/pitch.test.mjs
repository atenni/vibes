import assert from "node:assert/strict";
import { test } from "node:test";
import { detectPitch } from "./pitch.mjs";

const SIZE = 4096;

/** Small seeded PRNG (mulberry32) so noisy tests are deterministic. */
function prng(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sine(frequency, sampleRate, amplitude = 0.5, phase = 0.3) {
  const out = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    out[i] =
      amplitude * Math.sin(2 * Math.PI * frequency * (i / sampleRate) + phase);
  }
  return out;
}

/**
 * Plucked-string-ish: harmonics with their own decay, a weak fundamental when
 * `fundamental` is small, and a little noise.
 */
function pluck(
  frequency,
  sampleRate,
  { fundamental = 0.4, noise = 0.01, seed = 1 } = {},
) {
  const random = prng(seed);
  const amps = [fundamental, 1, 0.6, 0.35, 0.2, 0.12, 0.08];
  const out = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (let h = 0; h < amps.length; h++) {
      if (frequency * (h + 1) < sampleRate / 2.2) {
        v +=
          amps[h] *
          Math.sin(2 * Math.PI * frequency * (h + 1) * t + h) *
          Math.exp(-t * (3 + h));
      }
    }
    out[i] = 0.3 * v + noise * (random() * 2 - 1);
  }
  return out;
}

const cents = (measured, expected) => 1200 * Math.log2(measured / expected);

const E1 = 41.2034;
const NOTES = {
  B0: 30.8677,
  E1,
  A1: 55,
  E2: 82.4069,
  A2: 110,
  D3: 146.8324,
  G3: 195.9977,
  B3: 246.9417,
  E4: 329.6276,
  A4: 440,
  "1000 Hz": 1000,
};

for (const sampleRate of [44100, 48000]) {
  test(`sines are within ±1 cent at ${sampleRate} Hz`, () => {
    for (const [name, f] of Object.entries(NOTES)) {
      const d = detectPitch(sine(f, sampleRate), sampleRate);
      assert.ok(d, `${name} detected`);
      assert.ok(
        Math.abs(cents(d.frequency, f)) < 1,
        `${name}: ${cents(d.frequency, f)} cents`,
      );
      assert.ok(d.clarity > 0.95 && d.clarity <= 1);
    }
  });

  test(`plucked strings have no octave error at ${sampleRate} Hz`, () => {
    for (const [name, f] of Object.entries(NOTES)) {
      for (const fundamental of [0.4, 0.15]) {
        const d = detectPitch(
          pluck(f, sampleRate, { fundamental }),
          sampleRate,
        );
        assert.ok(d, `${name} (${fundamental}) detected`);
        assert.ok(
          Math.abs(cents(d.frequency, f)) < 3,
          `${name} (${fundamental}): ${d.frequency} Hz, ${cents(d.frequency, f)} cents`,
        );
      }
    }
  });
}

test("detects fine detuning around A4", () => {
  for (const offset of [-50, -12, -3, 0, 3, 12, 50]) {
    const f = 440 * 2 ** (offset / 1200);
    const d = detectPitch(sine(f, 48000), 48000);
    assert.ok(Math.abs(cents(d.frequency, f)) < 1, `offset ${offset}`);
  }
});

test("a DC offset does not matter", () => {
  const frame = sine(110, 48000);
  for (let i = 0; i < frame.length; i++) frame[i] += 0.2;
  const d = detectPitch(frame, 48000);
  assert.ok(Math.abs(cents(d.frequency, 110)) < 1);
});

test("silence returns null", () => {
  assert.equal(detectPitch(new Float32Array(SIZE), 48000), null);
  assert.equal(detectPitch(sine(220, 48000, 0.002), 48000), null);
});

test("white noise returns null", () => {
  const random = prng(42);
  const frame = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) frame[i] = (random() * 2 - 1) * 0.5;
  assert.equal(detectPitch(frame, 48000), null);
});

test("a tone buried in heavy noise is rejected rather than misread", () => {
  const random = prng(7);
  const frame = sine(220, 48000, 0.05);
  for (let i = 0; i < SIZE; i++) frame[i] += (random() * 2 - 1) * 0.8;
  const d = detectPitch(frame, 48000);
  assert.ok(d === null || Math.abs(cents(d.frequency, 220)) < 50);
});

test("minFrequency limits the lag range", () => {
  // B0 needs ~1555 samples of lag; capping at 40 Hz makes it undetectable
  // as itself (it may only be seen as nothing).
  const d = detectPitch(sine(NOTES.B0, 48000), 48000, { minFrequency: 40 });
  assert.ok(d === null || Math.abs(cents(d.frequency, NOTES.B0)) > 50);
});

test("options: lower clarity threshold and rmsGate apply", () => {
  assert.equal(
    detectPitch(sine(220, 48000, 0.2), 48000, { rmsGate: 0.5 }),
    null,
  );
  assert.equal(
    detectPitch(sine(220, 48000), 48000, { clarityThreshold: 1.1 }),
    null,
  );
});

test("works on a frame pulled from a longer buffer (subarray)", () => {
  const long = sine(196, 48000);
  const d = detectPitch(long.subarray(100, 4000), 48000);
  assert.ok(Math.abs(cents(d.frequency, 196)) < 1);
});
