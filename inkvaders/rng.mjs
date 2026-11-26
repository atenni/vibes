// Seeded random numbers (mulberry32). Pure and deterministic.

/**
 * @typedef {object} Rng
 * @property {() => number} next      Float in [0, 1).
 * @property {(a: number, b: number) => number} float  Float in [a, b).
 * @property {(a: number, b?: number) => number} int   Integer in [0, a) or [a, b).
 * @property {<T>(items: readonly T[]) => T} pick      Random element.
 * @property {(p: number) => boolean} chance           True with probability p.
 */

/**
 * @param {number} seed
 * @returns {Rng}
 */
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const float = (lo, hi) => lo + next() * (hi - lo);
  const int = (lo, hi) =>
    hi === undefined
      ? Math.floor(next() * lo)
      : lo + Math.floor(next() * (hi - lo));
  const pick = (items) => items[Math.floor(next() * items.length)];
  const chance = (p) => next() < p;
  return { next, float, int, pick, chance };
}
