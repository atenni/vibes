// Seven-segment glyph map. Segments follow the usual lettering:
//
//    aaa
//   f   b
//    ggg
//   e   c
//    ddd

export const SEGMENT_NAMES = ["a", "b", "c", "d", "e", "f", "g"];

/** @type {Record<string, string>} */
const TABLE = {
  0: "abcdef",
  1: "bc",
  2: "abdeg",
  3: "abcdg",
  4: "bcfg",
  5: "acdfg",
  6: "acdefg",
  7: "abc",
  8: "abcdefg",
  9: "abcdfg",
  A: "abcefg",
  b: "cdefg",
  C: "adef",
  d: "bcdeg",
  E: "adefg",
  F: "aefg",
  G: "acdef",
  H: "bcefg",
  L: "def",
  n: "ceg",
  o: "cdeg",
  P: "abefg",
  r: "eg",
  t: "defg",
  U: "bcdef",
  "-": "g",
  " ": "",
  // A seven-segment display can only draw these two one way.
  B: "cdefg",
  D: "bcdeg",
};

/** @type {Map<string, ReadonlySet<string>>} */
const CACHE = new Map();
const EMPTY = new Set();

/**
 * Segments to light for a character, as a set of "a".."g". Case is forgiven
 * where the glyph is unambiguous. Unknown characters are blank. The returned
 * set is shared: do not mutate it.
 * @param {string} char
 * @returns {ReadonlySet<string>}
 */
export function glyph(char) {
  const cached = CACHE.get(char);
  if (cached) return cached;
  const key = [char, char.toUpperCase(), char.toLowerCase()].find(
    (k) => k in TABLE,
  );
  const result = key === undefined ? EMPTY : new Set(TABLE[key]);
  CACHE.set(char, result);
  return result;
}
