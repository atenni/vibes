// Pure music maths: reference pitch, notes, modes and nearest-string lookup.

export const REFERENCE_MIN = 438;
export const REFERENCE_MAX = 445;
export const REFERENCE_DEFAULT = 440;

/**
 * @typedef {{ number: number, midi: number }} StringDef
 * @typedef {{
 *   id: "chromatic" | "guitar" | "guitar-flat" | "guitar-double-flat" |
 *       "bass" | "bass-flat" | "bass-double-flat",
 *   name: string,
 *   code: string,
 *   flats: 0 | 1 | 2,
 *   strings: StringDef[] | null,
 * }} Mode
 * @typedef {{
 *   midi: number,
 *   note: string,
 *   sharp: boolean,
 *   octave: number,
 *   string: number | null,
 *   cents: number,
 *   targetFrequency: number,
 * }} Analysis
 */

// Open strings, low to high. MIDI numbers: A4 = 69.
const GUITAR = [
  { number: 7, midi: 35 }, // B1
  { number: 6, midi: 40 }, // E2
  { number: 5, midi: 45 }, // A2
  { number: 4, midi: 50 }, // D3
  { number: 3, midi: 55 }, // G3
  { number: 2, midi: 59 }, // B3
  { number: 1, midi: 64 }, // E4
];
const BASS = [
  { number: 5, midi: 23 }, // B0
  { number: 4, midi: 28 }, // E1
  { number: 3, midi: 33 }, // A1
  { number: 2, midi: 38 }, // D2
  { number: 1, midi: 43 }, // G2
];

/**
 * Strings in flat modes are stored already transposed down.
 * @param {StringDef[]} strings
 * @param {number} flats semitones to drop
 */
function lower(strings, flats) {
  return strings.map(({ number, midi }) => ({ number, midi: midi - flats }));
}

/** @type {Mode[]} */
export const MODES = [
  { id: "chromatic", name: "Chromatic", code: "C", flats: 0, strings: null },
  {
    id: "guitar",
    name: "Guitar",
    code: "G",
    flats: 0,
    strings: lower(GUITAR, 0),
  },
  {
    id: "guitar-flat",
    name: "Guitar ♭",
    code: "G",
    flats: 1,
    strings: lower(GUITAR, 1),
  },
  {
    id: "guitar-double-flat",
    name: "Guitar ♭♭",
    code: "G",
    flats: 2,
    strings: lower(GUITAR, 2),
  },
  { id: "bass", name: "Bass", code: "b", flats: 0, strings: lower(BASS, 0) },
  {
    id: "bass-flat",
    name: "Bass ♭",
    code: "b",
    flats: 1,
    strings: lower(BASS, 1),
  },
  {
    id: "bass-double-flat",
    name: "Bass ♭♭",
    code: "b",
    flats: 2,
    strings: lower(BASS, 2),
  },
];

/** Arc LED index (0–10) lit for each mode on the mode-select display. */
export const MODE_LED = {
  "bass-double-flat": 0,
  "bass-flat": 1,
  bass: 2,
  "guitar-double-flat": 4,
  "guitar-flat": 5,
  guitar: 6,
  chromatic: 9,
};

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * @param {string} id
 * @returns {Mode}
 */
export function getMode(id) {
  const mode = MODES.find((m) => m.id === id);
  if (!mode) throw new Error(`Unknown mode: ${id}`);
  return mode;
}

/**
 * Fractional MIDI number for a frequency (A4 = 69 at `reference` Hz).
 * @param {number} frequency
 * @param {number} [reference]
 */
export function frequencyToMidi(frequency, reference = REFERENCE_DEFAULT) {
  return 69 + 12 * Math.log2(frequency / reference);
}

/**
 * @param {number} midi
 * @param {number} [reference]
 */
export function midiToFrequency(midi, reference = REFERENCE_DEFAULT) {
  return reference * 2 ** ((midi - 69) / 12);
}

/**
 * Sharp-spelled note name of the nearest semitone, e.g. "C#".
 * @param {number} midi
 */
export function noteName(midi) {
  return NOTE_NAMES[((Math.round(midi) % 12) + 12) % 12];
}

/**
 * Scientific pitch octave of the nearest semitone (C4 = middle C = MIDI 60).
 * @param {number} midi
 */
export function noteOctave(midi) {
  return Math.floor(Math.round(midi) / 12) - 1;
}

/**
 * Work out the target note/string for a frequency and how far off it is.
 * Chromatic: the nearest semitone. String modes: the nearest string by
 * log-frequency distance. `midi` is the (integer) target, `cents` is the
 * signed deviation from it, unclamped.
 * @param {number} frequency
 * @param {string} modeId
 * @param {number} [reference]
 * @returns {Analysis}
 */
export function analyse(frequency, modeId, reference = REFERENCE_DEFAULT) {
  const mode = getMode(modeId);
  const measured = frequencyToMidi(frequency, reference);
  let midi = Math.round(measured);
  let string = null;
  if (mode.strings) {
    let best = mode.strings[0];
    for (const s of mode.strings) {
      if (Math.abs(measured - s.midi) < Math.abs(measured - best.midi))
        best = s;
    }
    midi = best.midi;
    string = best.number;
  }
  const note = noteName(midi);
  return {
    midi,
    note,
    sharp: note.includes("#"),
    octave: noteOctave(midi),
    string,
    cents: (measured - midi) * 100,
    targetFrequency: midiToFrequency(midi, reference),
  };
}
