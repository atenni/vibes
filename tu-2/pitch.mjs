// Pitch detection: McLeod Pitch Method (MPM).
//
// 1. Remove DC, then compute the normalised square difference function
//    n(τ) = 2·r(τ) / m(τ), where r is the autocorrelation and m the energy of
//    the two overlapping windows. n is in −1…1 and is 1 for a perfect period.
// 2. Find the "key maxima": the highest peak within each positive lobe.
// 3. Take the first key maximum at least `PEAK_RATIO` of the tallest. This is
//    what stops octave errors: a strong 2nd harmonic makes a peak at τ = T/2
//    that is clearly lower than the one at T, and a weak fundamental still
//    beats the peak at 2T because that one comes later.
// 4. Refine with parabolic interpolation. The peak height is the clarity.
//
// Cost: the lag search runs on a decimated copy (≈ 8 samples per period at
// maxFrequency), then only ±(factor+1) lags are recomputed at full rate. Typed
// arrays throughout; working buffers are reused between calls (keyed by size).

/**
 * @typedef {{ frequency: number, clarity: number }} Detection
 * @typedef {{
 *   minFrequency?: number,
 *   maxFrequency?: number,
 *   rmsGate?: number,
 *   clarityThreshold?: number,
 * }} PitchOptions
 */

/** Key maximum must reach this fraction of the tallest to be chosen. */
const PEAK_RATIO = 0.9;

/**
 * Two passes keep this cheap enough for every animation frame on a phone:
 * a coarse search on a copy decimated by `factor` (box-filtered), then a
 * full-rate NSDF over just a few lags around the coarse peak for accuracy.
 * @typedef {{
 *   work: Float32Array, squares: Float64Array,
 *   coarse: Float32Array, coarseSquares: Float64Array, nsdf: Float64Array,
 *   fine: Float64Array,
 * }} Buffers
 */

/** @type {Map<string, Buffers>} */
const buffers = new Map();

/**
 * @param {number} size
 * @param {number} factor
 * @param {number} lags
 * @returns {Buffers}
 */
function getBuffers(size, factor, lags) {
  const key = `${size}/${factor}/${lags}`;
  let entry = buffers.get(key);
  if (!entry) {
    if (buffers.size > 8) buffers.clear();
    const coarseSize = Math.floor(size / factor);
    entry = {
      work: new Float32Array(size),
      squares: new Float64Array(size + 1),
      coarse: new Float32Array(coarseSize),
      coarseSquares: new Float64Array(coarseSize + 1),
      nsdf: new Float64Array(lags + 2),
      fine: new Float64Array(size),
    };
    buffers.set(key, entry);
  }
  return entry;
}

/**
 * Normalised square difference for lags `from`…`to` inclusive, into `out`.
 * @param {Float32Array} data
 * @param {Float64Array} squares cumulative sum of squares (length n + 1)
 * @param {number} n
 * @param {number} from
 * @param {number} to
 * @param {Float64Array} out
 */
function nsdfRange(data, squares, n, from, to, out) {
  const total = squares[n];
  for (let tau = from; tau <= to; tau++) {
    const m = n - tau;
    let r = 0;
    for (let j = 0; j < m; j++) r += data[j] * data[j + tau];
    const energy = squares[m] + (total - squares[tau]);
    out[tau] = energy > 0 ? (2 * r) / energy : 0;
  }
}

/** @param {Float32Array} data @param {Float64Array} squares @param {number} n */
function cumulativeSquares(data, squares, n) {
  squares[0] = 0;
  for (let i = 0; i < n; i++) squares[i + 1] = squares[i] + data[i] * data[i];
}

/**
 * Detect the fundamental frequency of a mono time-domain frame.
 * @param {Float32Array} frame
 * @param {number} sampleRate
 * @param {PitchOptions} [opts]
 * @returns {Detection | null} null for silence or an unclear pitch
 */
export function detectPitch(frame, sampleRate, opts = {}) {
  const {
    minFrequency = 25,
    maxFrequency = 1400,
    rmsGate = 0.01,
    clarityThreshold = 0.8,
  } = opts;
  const size = frame.length;
  // Decimate so the highest pitch still has ~8 coarse samples per period.
  const factor = Math.max(1, Math.floor(sampleRate / (maxFrequency * 8)));
  const coarseRate = sampleRate / factor;
  const n = Math.floor(size / factor);
  const minLag = Math.max(2, Math.floor(coarseRate / maxFrequency));
  // Keep at least a third of the frame overlapping at the longest lag.
  const maxLag = Math.min(
    Math.ceil(coarseRate / minFrequency),
    Math.floor((n * 2) / 3),
  );
  if (n < 16 || maxLag <= minLag + 2) return null;

  const { work, squares, coarse, coarseSquares, nsdf, fine } = getBuffers(
    size,
    factor,
    maxLag,
  );

  // Remove DC, then box-average down to the coarse rate.
  let mean = 0;
  for (let i = 0; i < size; i++) mean += frame[i];
  mean /= size;
  for (let i = 0; i < size; i++) work[i] = frame[i] - mean;
  cumulativeSquares(work, squares, size);
  if (Math.sqrt(squares[size] / size) < rmsGate) return null;

  if (factor === 1) coarse.set(work.subarray(0, n));
  else {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < factor; k++) sum += work[i * factor + k];
      coarse[i] = sum / factor;
    }
  }
  cumulativeSquares(coarse, coarseSquares, n);

  // Coarse NSDF for lags 1…maxLag+1 (the extra lag lets us interpolate).
  const lastLag = maxLag + 1;
  nsdfRange(coarse, coarseSquares, n, 1, lastLag, nsdf);

  // Skip the first positive lobe (the one around lag 0).
  let tau = 1;
  while (tau < lastLag && nsdf[tau] > 0) tau++;

  // Collect the key maximum of each positive lobe.
  /** @type {number[]} */
  const peakLags = [];
  let best = 0;
  while (tau < lastLag) {
    while (tau < lastLag && nsdf[tau] <= 0) tau++;
    let peak = 0;
    let peakValue = -1;
    while (tau < lastLag && nsdf[tau] > 0) {
      if (nsdf[tau] > peakValue) {
        peakValue = nsdf[tau];
        peak = tau;
      }
      tau++;
    }
    // Ignore peaks above maxFrequency, and on the very edge of the range.
    if (peak >= minLag && peak < lastLag - 1 && peakValue > 0) {
      peakLags.push(peak);
      if (peakValue > best) best = peakValue;
    }
  }
  if (peakLags.length === 0 || best < clarityThreshold - 0.1) return null;

  let chosen = peakLags[0];
  for (const lag of peakLags) {
    if (nsdf[lag] >= PEAK_RATIO * best) {
      chosen = lag;
      break;
    }
  }

  // Refine at full rate: search ±(factor + 1) lags around the coarse peak.
  const centre = chosen * factor;
  const fineFrom = Math.max(2, centre - factor - 1);
  const fineTo = Math.min(size - 8, centre + factor + 1);
  nsdfRange(work, squares, size, fineFrom - 1, fineTo + 1, fine);
  let peak = fineFrom;
  for (let t = fineFrom; t <= fineTo; t++) {
    if (fine[t] > fine[peak]) peak = t;
  }
  if (peak === fineFrom || peak === fineTo) {
    // The true peak is outside the window: not a clean periodic signal.
    if (fine[peak] < clarityThreshold) return null;
  }

  // Parabolic interpolation around the refined peak.
  const a = fine[peak - 1];
  const b = fine[peak];
  const c = fine[peak + 1];
  const denominator = a - 2 * b + c;
  let lag = peak;
  let clarity = b;
  if (denominator < 0) {
    const shift = (0.5 * (a - c)) / denominator;
    lag = peak + shift;
    clarity = b - 0.25 * (a - c) * shift;
  }
  if (clarity < clarityThreshold) return null;
  return { frequency: sampleRate / lag, clarity: Math.min(1, clarity) };
}
