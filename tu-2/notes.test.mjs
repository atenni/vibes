import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MODES,
  MODE_LED,
  analyse,
  frequencyToMidi,
  getMode,
  midiToFrequency,
  noteName,
  noteOctave,
} from "./notes.mjs";

const near = (a, b, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("A4 maps to MIDI 69 at any reference", () => {
  for (const ref of [438, 440, 445]) {
    near(frequencyToMidi(ref, ref), 69);
    near(midiToFrequency(69, ref), ref);
  }
});

test("440 Hz is sharp of A4 at 438 and flat of it at 445", () => {
  assert.ok(analyse(440, "chromatic", 438).cents > 7);
  assert.ok(analyse(440, "chromatic", 445).cents < -19);
  near(analyse(440, "chromatic", 440).cents, 0);
});

test("note names and octaves", () => {
  assert.equal(noteName(60), "C");
  assert.equal(noteName(61), "C#");
  assert.equal(noteName(69), "A");
  assert.equal(noteName(-1), "B");
  assert.equal(noteOctave(60), 4);
  assert.equal(noteOctave(40), 2);
  assert.equal(noteOctave(23), 0);
  const e2 = analyse(82.4069, "chromatic", 440);
  assert.equal(e2.note, "E");
  assert.equal(e2.octave, 2);
  assert.equal(e2.sharp, false);
  const cs = analyse(277.18, "chromatic", 440);
  assert.deepEqual(
    [cs.note, cs.sharp, cs.octave, cs.string],
    ["C#", true, 4, null],
  );
});

test("there are seven modes with the expected shape", () => {
  assert.deepEqual(
    MODES.map((m) => m.id),
    [
      "chromatic",
      "guitar",
      "guitar-flat",
      "guitar-double-flat",
      "bass",
      "bass-flat",
      "bass-double-flat",
    ],
  );
  assert.equal(MODES[0].strings, null);
  assert.equal(getMode("guitar").strings.length, 7);
  assert.equal(getMode("bass").strings.length, 5);
  assert.throws(() => getMode("banjo"));
});

test("guitar mode picks the nearest string with the right number", () => {
  const expected = [
    [82.41, 6],
    [110, 5],
    [146.83, 4],
    [196, 3],
    [246.94, 2],
    [329.63, 1],
    [61.74, 7],
  ];
  for (const [f, string] of expected) {
    const a = analyse(f, "guitar", 440);
    assert.equal(a.string, string, `${f} Hz`);
    assert.ok(Math.abs(a.cents) < 1);
  }
});

test("string modes measure cents from the string, unclamped", () => {
  const a = analyse(110 * 2 ** (-30 / 1200), "guitar", 440);
  assert.equal(a.string, 5);
  near(a.cents, -30, 1e-6);
  // Well flat of A2 but nearer to it than to E2.
  assert.equal(analyse(100, "guitar", 440).string, 5);
  assert.ok(analyse(100, "guitar", 440).cents < -100);
});

test("nearest string uses log distance, not Hz", () => {
  // Midpoint of E2 and A2 in Hz is 96.2; the log midpoint is 95.2 Hz.
  assert.equal(analyse(95.7, "guitar", 440).string, 5);
  assert.equal(analyse(94.7, "guitar", 440).string, 6);
});

test("flat modes transpose every string", () => {
  const e2 = 82.4069;
  assert.equal(analyse(e2 * 2 ** (-1 / 12), "guitar-flat", 440).string, 6);
  near(analyse(e2 * 2 ** (-1 / 12), "guitar-flat", 440).cents, 0, 1e-3);
  near(analyse(e2 * 2 ** (-2 / 12), "guitar-double-flat", 440).cents, 0, 1e-3);
  assert.equal(
    analyse(e2 * 2 ** (-2 / 12), "guitar-double-flat", 440).note,
    "D",
  );
  assert.equal(analyse(55 * 2 ** (-1 / 12), "bass-flat", 440).string, 3);
  assert.equal(analyse(55 * 2 ** (-2 / 12), "bass-double-flat", 440).string, 3);
  assert.deepEqual(
    MODES.map((m) => m.flats),
    [0, 0, 1, 2, 0, 1, 2],
  );
});

test("bass mode strings and low B", () => {
  const expected = [
    [30.87, 5],
    [41.2, 4],
    [55, 3],
    [73.42, 2],
    [98, 1],
  ];
  for (const [f, string] of expected)
    assert.equal(analyse(f, "bass", 440).string, string);
  assert.equal(analyse(30.87, "bass", 440).note, "B");
  assert.equal(analyse(30.87, "bass", 440).octave, 0);
});

test("sharp flag follows the target note name", () => {
  assert.equal(analyse(110, "guitar", 440).sharp, false);
  // Eb string in guitar-flat mode names the target note D#.
  const a = analyse(82.4069 * 2 ** (-1 / 12), "guitar-flat", 440);
  assert.deepEqual([a.note, a.sharp], ["D#", true]);
});

test("MODE_LED maps every mode to a distinct arc LED", () => {
  assert.deepEqual(Object.keys(MODE_LED).sort(), MODES.map((m) => m.id).sort());
  assert.equal(new Set(Object.values(MODE_LED)).size, MODES.length);
  assert.equal(MODE_LED.chromatic, 9);
  assert.equal(MODE_LED["bass-double-flat"], 0);
});
