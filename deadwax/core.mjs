/* Pure score/parser/planner core: no DOM or audio. */
/**
 * @typedef {{line: number, column: number, message: string}} ParseError
 * @typedef {Record<string, number>} Dimensions
 * @typedef {{at: number, duration: number, notes?: number[], symbol?: string}} ScoreEvent
 * @typedef {object} Pressing
 * @property {number} version
 * @property {string} title
 * @property {number} tempo
 * @property {string} meter
 * @property {string} key
 * @property {number} swing
 * @property {number} bars
 * @property {number} beats Quarter notes per bar.
 * @property {number} steps Sixteenths per bar.
 * @property {number} seed
 * @property {Record<string, string>} parts
 * @property {Record<string, number>} levels
 * @property {string[]} muted
 * @property {Dimensions} values
 * @property {ScoreEvent[]} chords
 * @property {ScoreEvent[]} chordNotes
 * @property {string | ScoreEvent[]} bass
 * @property {ScoreEvent[]} melody
 * @property {Record<string, string[]>} drums
 * @property {{rate: number, limits: Record<string, [number, number]>}} drift
 * @typedef {{origin: Dimensions, current: Dimensions, velocity: Dimensions,
 * target: Dimensions, home: boolean, hold: boolean}} DriftState
 */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)),
  copy = (v) => JSON.parse(JSON.stringify(v)),
  pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const instruments = ["epiano", "felt", "upright", "vibes", "pad"];
const voices = ["kick", "snare", "rim", "hats", "brushes", "perc"];
const textures = ["vinyl", "surface", "tape", "rumble", "rain", "room", "hum"];
const specs = {
  tempo: [45, 130, 76],
  swing: [0, 0.48, 0.16],
  humanise: [0, 1, 0.18],
  busyness: [0, 1, 0.35],
  embellish: [0, 1, 0.1],
  density: [0, 1, 0.55],
  register: [0, 1, 0.45],
  substitution: [0, 1, 0],
  rhythm: [0, 1, 0],
  timbre: [0, 1, 0],
  tone: [0, 1, 0.48],
  saturation: [0, 1, 0.25],
  wow: [0, 1, 0.2],
  crush: [0, 1, 0],
  reverb: [0, 0.85, 0.24],
  balance: [0, 1, 0.5],
  arrangement: [0, 1, 0],
  ...Object.fromEntries(
    textures.map((k) => [
      k,
      [0, 1, k === "vinyl" ? 0.12 : k === "tape" ? 0.05 : 0],
    ]),
  ),
};
function rng(seed) {
  let a = Number(seed) >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.state = () => a;
  return r;
}
function note(s) {
  const m = /^([A-G])([#b]?)([0-8])$/.exec(s);
  return m
    ? 12 * (+m[3] + 1) + pc[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0)
    : null;
}
const noteName = (n) =>
  ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][
    ((n % 12) + 12) % 12
  ] +
  (Math.floor(n / 12) - 1);
function chord(s) {
  const m =
    /^([A-G])([#b]?)(maj7|maj9|maj13|m7b5|mmaj7|m13|m11|m9|m7|m6|m|13|11|9|7|6|dim7|dim|aug|sus2|sus4|7sus4|7alt|alt|add9)?((?:[#b](?:5|9|11|13))*)(?:\/([A-G])([#b]?))?$/.exec(
      s,
    );
  if (!m) return null;
  const root =
      (pc[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + 12) % 12,
    q = m[3] || "",
    minor = q.startsWith("m") && !q.startsWith("maj");
  let ints = [0, minor || q.startsWith("dim") ? 3 : 4, 7];
  if (q.includes("sus")) ints[1] = q === "sus2" ? 2 : 5;
  if (q === "aug") ints[2] = 8;
  if (q.startsWith("dim") || q === "m7b5") ints[2] = 6;
  if (/7|9|11|13|alt/.test(q))
    ints.push(
      q.startsWith("maj") || q === "mmaj7" ? 11 : q === "dim7" ? 9 : 10,
    );
  if (q === "6" || q === "m6") ints.push(9);
  if (/9|11|13/.test(q)) ints.push(14);
  if (/11|13/.test(q)) ints.push(17);
  if (/13/.test(q)) ints.push(21);
  if (q.includes("alt")) ints = [0, 4, 10, 13, 15, 20];
  for (const a of m[4].matchAll(/([#b])(5|9|11|13)/g)) {
    const base = { 5: 7, 9: 14, 11: 17, 13: 21 }[a[2]];
    ints = ints.filter((i) => i !== base);
    ints.push(base + (a[1] === "#" ? 1 : -1));
  }
  const bass = m[5]
    ? (pc[m[5]] + (m[6] === "#" ? 1 : m[6] === "b" ? -1 : 0) + 12) % 12
    : root;
  return {
    symbol: s,
    root,
    bass,
    ints: [...new Set(ints)].sort((a, b) => a - b),
    minor,
    dominant: !minor && !q.startsWith("maj") && ints.includes(10),
  };
}
/** @param {string} text @returns {{song: Pressing, errors: ParseError[]}} */
function parse(text) {
  const errors = [],
    rows = String(text).split(/\r?\n/),
    s = {
      version: 1,
      title: "Untitled",
      tempo: 76,
      meter: "4/4",
      key: "C minor",
      swing: 0.16,
      bars: 4,
      seed: 104729,
      parts: { chords: "epiano", bass: "upright", melody: "vibes" },
      levels: { chords: 0.7, bass: 0.8, melody: 0.45, drums: 0.65 },
      muted: [],
      values: Object.fromEntries(
        Object.entries(specs).map(([k, v]) => [k, v[2]]),
      ),
      chords: [],
      chordNotes: [],
      bass: "auto roots",
      melody: [],
      drums: {},
      drift: { rate: 0.35, limits: {} },
    };
  const seen = new Set(),
    locations = {};
  let first = true;
  const err = (line, column, message) => errors.push({ line, column, message });
  const num = (t, a, b, line, col) => {
    const n = Number(t);
    if (t === "" || !Number.isFinite(n) || n < a || n > b) {
      err(line, col, `Expected a number from ${a} to ${b}; got “${t}”.`);
      return a;
    }
    return n;
  };
  rows.forEach((raw, i) => {
    const ln = i + 1,
      line = raw.replace(/\s+;.*$/, "").trim();
    if (!line || line.startsWith(";")) return;
    const ts = [...raw.replace(/\s+;.*$/, "").matchAll(/\S+/g)].map((m) => ({
      v: m[0],
      c: m.index + 1,
    }));
    const w = ts.map((t) => t.v),
      k = w[0],
      v = w.slice(1).join(" "),
      col = ts[1]?.c || raw.length + 1;
    locations[k] = ln;
    if (first) {
      first = false;
      if (line !== "deadwax 1")
        err(ln, ts[0].c, "First content line must be deadwax 1.");
      else {
        seen.add(k);
        return;
      }
    }
    if (
      seen.has(k) &&
      !["instrument", "level", "texture", "dimension", "drift"].includes(k)
    )
      err(ln, ts[0].c, `Duplicate ${k} line.`);
    seen.add(k);
    const count = (n) => {
      if (w.length !== n + 1)
        err(ln, col, `${k} needs ${n} value${n === 1 ? "" : "s"}.`);
    };
    if (k === "title") {
      if (!v) err(ln, col, "A title is required.");
      s.title = v;
    } else if (["tempo", "swing", "bars", "seed"].includes(k)) {
      count(1);
      const bounds = {
        tempo: [45, 130],
        swing: [0, 0.48],
        bars: [1, 64],
        seed: [0, 4294967295],
      }[k];
      s[k] = num(v, ...bounds, ln, col);
      if (["bars", "seed"].includes(k) && !Number.isInteger(s[k]))
        err(ln, col, `${k} must be an integer.`);
      s.values[k] = s[k];
    } else if (k === "meter") {
      count(1);
      if (!/^(?:[1-9]|1[0-2])\/(?:4|8)$/.test(v))
        err(ln, col, "Use a meter such as 4/4, 3/4 or 6/8 (1–12 over 4 or 8).");
      else s.meter = v;
    } else if (k === "key") {
      if (!/^[A-G][#b]? (major|minor|dorian|mixolydian)$/.test(v))
        err(ln, col, "Use a key such as Eb major or D dorian.");
      s.key = v;
    } else if (k === "instrument") {
      count(2);
      if (!Object.hasOwn(s.parts, w[1]))
        err(ln, col, "Part must be chords, bass or melody.");
      else if (!instruments.includes(w[2]))
        err(
          ln,
          ts[2]?.c || col,
          `Unknown instrument. Choose ${instruments.join(", ")}.`,
        );
      else s.parts[w[1]] = w[2];
    } else if (k === "level") {
      count(2);
      if (!Object.hasOwn(s.levels, w[1])) err(ln, col, "Unknown mix part.");
      else s.levels[w[1]] = num(w[2], 0, 1, ln, ts[2]?.c || col);
    } else if (k === "mute") {
      s.muted = w.slice(1);
      for (const p of s.muted)
        if (!Object.hasOwn(s.levels, p))
          err(ln, col, `Unknown muted part “${p}”.`);
    } else if (k === "texture" || k === "dimension") {
      count(2);
      if (
        !(
          k === "texture"
            ? textures
            : Object.keys(specs).filter(
                (x) => !["tempo", "swing", ...textures].includes(x),
              )
        ).includes(w[1])
      )
        err(ln, col, `Unknown ${k} “${w[1]}”.`);
      else
        s.values[w[1]] = num(
          w[2],
          specs[w[1]][0],
          specs[w[1]][1],
          ln,
          ts[2]?.c || col,
        );
    } else if (k === "drift") {
      if (w[1] === "rate") {
        count(2);
        s.drift.rate = num(w[2], 0, 1, ln, ts[2]?.c || col);
      } else if (Object.hasOwn(specs, w[1])) {
        count(3);
        const a = num(w[2], ...specs[w[1]].slice(0, 2), ln, ts[2]?.c || col),
          b = num(w[3], ...specs[w[1]].slice(0, 2), ln, ts[3]?.c || col);
        if (a > b) err(ln, col, "Drift minimum exceeds maximum.");
        s.drift.limits[w[1]] = [a, b];
      } else err(ln, col, "Unknown drift dimension (or use drift rate 0.35).");
    } else if (["chords", "chord-notes", "bass", "melody"].includes(k)) {
      if (k === "bass" && /^auto (roots|walking|root-fifth)$/.test(v)) {
        s.bass = v;
        return;
      }
      const events = [];
      let at = 0;
      for (const t of ts.slice(1)) {
        const m = /^(.+):([0-9]+(?:\.[0-9]+)?)$/.exec(t.v);
        if (!m) {
          err(ln, t.c, "Expected value:duration, e.g. Dm9:4 or D2:0.5.");
          continue;
        }
        const duration = num(m[2], 0.25, 768, ln, t.c + m[1].length + 1);
        if ((duration * 4) % 1)
          err(ln, t.c, "Durations must be multiples of 0.25 quarter notes.");
        const val = m[1];
        if (k === "chords") {
          if (!chord(val)) err(ln, t.c, `Unknown chord symbol “${val}”.`);
          events.push({ at, duration, symbol: val });
        } else {
          const notes = val === "-" ? [] : val.split("+").map(note);
          if (notes.some((n) => n === null))
            err(
              ln,
              t.c,
              `Invalid note “${val}”; use C4, F#3, Bb2 or - for rest.`,
            );
          events.push({ at, duration, notes });
        }
        at += duration;
      }
      s[k === "chord-notes" ? "chordNotes" : k] = events;
    } else if (voices.includes(k)) {
      const grids = v.split("|").map((x) => x.replace(/\s/g, ""));
      if (grids.some((x) => !x))
        err(ln, col, "Empty drum bar. Omit leading and trailing pipes.");
      for (const t of ts.slice(1)) {
        const bad = /[^.xXg|]/.exec(t.v);
        if (bad)
          err(
            ln,
            t.c + bad.index,
            "Drum steps use . x X g (rest, hit, accent, ghost).",
          );
      }
      s.drums[k] = grids;
    } else err(ln, ts[0].c, `Unknown directive “${k}”.`);
  });
  for (const k of [
    "deadwax",
    "title",
    "tempo",
    "meter",
    "key",
    "swing",
    "bars",
    "chords",
  ])
    if (!seen.has(k)) err(1, 1, `Missing required ${k} line.`);
  const [top, bottom] = s.meter.split("/").map(Number);
  s.beats = (top * 4) / bottom;
  s.steps = s.beats * 4;
  const total = s.beats * s.bars;
  if (Math.abs(s.chords.reduce((n, e) => n + e.duration, 0) - total) > 0.001)
    err(
      locations.chords || 1,
      1,
      `Chord durations must total ${total} quarter notes (${s.bars} bars).`,
    );
  for (const k of ["bass", "melody", "chordNotes"])
    if (Array.isArray(s[k]) && s[k].length) {
      const length = s[k].reduce((n, e) => n + e.duration, 0);
      if ((total / length) % 1)
        err(
          locations[k === "chordNotes" ? "chord-notes" : k] || 1,
          1,
          `${k} length must divide the ${total}-quarter-note loop exactly.`,
        );
      if (
        k === "chordNotes" &&
        (s[k].length !== s.chords.length ||
          s[k].some((e, i) => e.duration !== s.chords[i]?.duration))
      )
        err(
          locations["chord-notes"],
          1,
          "chord-notes must align one-to-one with chords.",
        );
    }
  for (const [k, grids] of Object.entries(s.drums)) {
    if (s.bars % grids.length)
      err(locations[k], 1, `Number of ${k} grid bars must divide loop length.`);
    if (grids.some((g) => g.length !== s.steps))
      err(
        locations[k],
        1,
        `${k}: each bar needs ${s.steps} sixteenth-note steps in ${s.meter}.`,
      );
  }
  for (const [k, [a, b]] of Object.entries(s.drift.limits))
    if (s.values[k] < a || s.values[k] > b)
      err(1, 1, `${k} origin must be inside its drift limits.`);
  s.values.tempo = s.tempo;
  s.values.swing = s.swing;
  delete s.values.bars;
  delete s.values.seed;
  return {
    song: s,
    errors: errors.sort((a, b) => a.line - b.line || a.column - b.column),
  };
}
const fmt = (n) => String(Math.round(n * 1000000) / 1000000);
const sequence = (es) =>
  es
    .map(
      (e) =>
        `${e.symbol || e.notes.map(noteName).join("+") || "-"}:${fmt(e.duration)}`,
    )
    .join(" ");
/** @param {Pressing} s @returns {string} */
function serialize(s) {
  return [
    "deadwax 1",
    `title ${s.title.replace(/[\r\n]/g, " ")}`,
    `tempo ${fmt(s.tempo)}`,
    `meter ${s.meter}`,
    `key ${s.key}`,
    `swing ${fmt(s.swing)}`,
    `bars ${s.bars}`,
    `seed ${s.seed}`,
    "",
    ...Object.entries(s.parts).map(([k, v]) => `instrument ${k} ${v}`),
    ...Object.entries(s.levels).map(([k, v]) => `level ${k} ${fmt(v)}`),
    ...(s.muted.length ? [`mute ${s.muted.join(" ")}`] : []),
    "",
    `chords ${sequence(s.chords)}`,
    ...(s.chordNotes.length ? [`chord-notes ${sequence(s.chordNotes)}`] : []),
    `bass ${typeof s.bass === "string" ? s.bass : sequence(s.bass)}`,
    ...(s.melody.length ? [`melody ${sequence(s.melody)}`] : []),
    ...Object.entries(s.drums).map(([k, v]) => `${k} ${v.join(" | ")}`),
    "",
    ...Object.entries(s.values)
      .filter(([k]) => !["tempo", "swing", ...textures].includes(k))
      .map(([k, v]) => `dimension ${k} ${fmt(v)}`),
    ...textures.map((k) => `texture ${k} ${fmt(s.values[k])}`),
    "",
    `drift rate ${fmt(s.drift.rate)}`,
    ...Object.entries(s.drift.limits).map(
      ([k, v]) => `drift ${k} ${v.map(fmt).join(" ")}`,
    ),
    "",
  ].join("\n");
}
function voicing(c, previous, state, r) {
  const centre = 54 + Math.round(state.register * 18),
    count = state.density < 0.25 ? 2 : state.density < 0.65 ? 4 : 5;
  let pool = c.ints.filter((n) => n !== 0);
  if (pool.length < 3) pool = [...new Set([...pool, c.minor ? 10 : 11, 14])];
  const third = pool.find((i) => [3, 4, 5].includes(i)) ?? pool[0];
  const seventh = pool.find((i) => i >= 9 && i <= 11) ?? pool[1];
  const extended = [
    ...new Set([
      ...pool,
      ...(c.dominant ? [14, 21] : c.minor ? [14, 17, 21] : [14, 18, 21]),
    ]),
  ];
  const shapes = [
    {
      kind: "rootless",
      ints: [third, seventh, ...pool.filter((i) => i > 11), ...pool],
    },
    { kind: "shell", ints: [third, seventh] },
    { kind: "drop2", ints: pool },
    {
      kind: "upper",
      ints: [third, seventh, ...extended.filter((i) => i > 11)],
    },
  ];
  // Search genuine stacks of fourths in a chord-compatible extended pitch set.
  const allowed = new Set([0, ...extended].map((i) => i % 12));
  for (const first of extended) {
    const stack = [first];
    while (stack.length < count && allowed.has((stack.at(-1) + 5) % 12))
      stack.push(stack.at(-1) + 5);
    if (stack.length >= Math.min(3, count))
      shapes.push({ kind: "quartal", ints: stack });
  }
  let best = null,
    cost = Infinity;
  for (const shape of shapes) {
    const ints = [...new Set(shape.ints)].slice(
      0,
      shape.kind === "shell" ? Math.min(count, 2) : count,
    );
    const bias = r() * 3;
    for (let inv = 0; inv < ints.length; inv++) {
      let ns = ints
        .map((i) => {
          let n = 48 + c.root + i;
          while (n < centre - 9) n += 12;
          while (n > centre + 10) n -= 12;
          return n;
        })
        .sort((a, b) => a - b);
      for (let j = 0; j < inv; j++) ns[j] += 12;
      ns.sort((a, b) => a - b);
      if (shape.kind === "drop2" && ns.length >= 4) ns[ns.length - 2] -= 12;
      ns = [...new Set(ns)].sort((a, b) => a - b);
      if (ns[0] < 46 || ns.at(-1) > 86) continue;
      const movement =
        ns.reduce((v, n, i) => v + Math.abs(n - (previous[i] ?? centre)), 0) /
        ns.length;
      const score =
        movement +
        Math.abs(ns.reduce((a, b) => a + b, 0) / ns.length - centre) * 0.7 +
        bias +
        (count - ns.length) * 0.5;
      if (score < cost) {
        cost = score;
        best = ns;
      }
    }
  }
  return best || [60 + c.root, 64 + c.root, 70 + c.root];
}
function origin(s) {
  return copy(s.values);
}
/** @param {Pressing} s @returns {DriftState} */
function driftState(s) {
  return {
    origin: origin(s),
    current: origin(s),
    velocity: Object.fromEntries(Object.keys(specs).map((k) => [k, 0])),
    target: origin(s),
    home: false,
    hold: false,
  };
}
const directions = {
  Darker: { tone: -0.32, register: -0.14, tempo: -8 },
  Brighter: { tone: 0.32, register: 0.15 },
  Busier: {
    busyness: 0.45,
    embellish: 0.45,
    density: 0.25,
    rhythm: 0.4,
  },
  Sparser: {
    busyness: -0.3,
    density: -0.3,
    arrangement: 0.35,
    embellish: -0.1,
  },
  Looser: { swing: 0.18, humanise: 0.45, wow: 0.2 },
  Tighter: { swing: -0.14, humanise: -0.18, wow: -0.15 },
  Dreamier: {
    reverb: 0.38,
    timbre: 0.75,
    tempo: -8,
    arrangement: 0.15,
  },
  Dustier: {
    vinyl: 0.3,
    tape: 0.2,
    saturation: 0.4,
    tone: -0.2,
    wow: 0.4,
    substitution: 0.3,
  },
};
function steer(d, s, name) {
  d.home = name === "Home";
  d.hold = false;
  for (const k in specs) {
    const [lo, hi] = s.drift.limits[k] || [d.origin[k], d.origin[k]];
    d.target[k] = clamp(d.origin[k] + (directions[name]?.[k] || 0), lo, hi);
    if (d.home) d.target[k] = d.origin[k];
  }
}
function advance(d, s, r, wander, enabled) {
  if (d.hold || (!enabled && !d.home) || (wander === 0 && !d.home)) return;
  for (const k in specs) {
    const [lo, hi] = s.drift.limits[k] || [d.origin[k], d.origin[k]],
      span = hi - lo;
    if (d.home) {
      d.current[k] +=
        (d.origin[k] - d.current[k]) *
        (1 - Math.pow(0.015, 1 / Math.min(8, s.bars * 2)));
      d.velocity[k] = 0;
      if (Math.abs(d.current[k] - d.origin[k]) < span * 0.004 + 0.00001)
        d.current[k] = d.origin[k];
      continue;
    }
    const noise = (r() + r() + r() - 1.5) * span * 0.14 * wander;
    d.velocity[k] =
      d.velocity[k] * 0.7 +
      (d.target[k] - d.current[k]) * (0.008 + 0.025 * wander) * wander +
      noise;
    d.current[k] = clamp(d.current[k] + d.velocity[k], lo, hi);
  }
}
function atSequence(es, beat) {
  if (!es.length) return [];
  const length = es.reduce((n, e) => n + e.duration, 0),
    phase = beat % length;
  return es.filter((e) => Math.abs(e.at - phase) < 0.0001);
}
function chordAt(s, beat) {
  return (
    s.chords.find((e) => beat >= e.at && beat < e.at + e.duration) ||
    s.chords[0]
  );
}
/* Each bar is an immutable, captureable list of events, in quarter-note units. */
/**
 * @param {Pressing} s
 * @param {Dimensions} state
 * @param {() => number} r Seeded musical random stream.
 * @param {number} bar Zero-based position in the loop.
 * @param {number[]} previous Previous keyboard voicing.
 */
function planBar(s, state, r, bar, previous = []) {
  const events = [],
    start = bar * s.beats,
    parts = { ...s.parts };
  if (state.timbre > 0.35) parts.chords = state.timbre > 0.72 ? "pad" : "felt";
  const grids = Object.fromEntries(
    voices.map((v) => [v, Array(s.steps).fill(".")]),
  );
  let last = previous;
  const drop = state.arrangement > 0.05 && r() < state.arrangement * 0.4,
    deltaBus = state.busyness - s.values.busyness,
    deltaEmb = state.embellish - s.values.embellish;
  for (let step = 0; step < s.steps; step++) {
    const beat = start + step / 4,
      base = chordAt(s, beat);
    let c = chord(base.symbol);
    const chordStart = Math.abs(base.at - beat) < 0.001;
    const rehit = state.rhythm > 0.25 && step === Math.floor(s.steps / 2);
    if (chordStart || step === 0 || rehit) {
      let sym = base.symbol;
      if (c.dominant && r() < state.substitution) {
        const root = (c.root + 6) % 12;
        sym = noteName(root + 60).replace(/\d/g, "") + "9";
        c = chord(sym);
      }
      const ix = s.chords.indexOf(base);
      const ns = s.chordNotes.length
        ? s.chordNotes[ix].notes
        : voicing(c, last, state, r);
      last = ns;
      const duration = Math.min(
        base.at + base.duration - beat,
        s.beats - step / 4,
        rehit ? 1 : 100,
      );
      events.push({
        part: "chords",
        step,
        duration,
        notes: drop ? [] : ns,
        symbol: sym,
        velocity: 0.65,
      });
    }
    if (typeof s.bass === "string") {
      const mode = s.bass.split(" ")[1],
        spacing = mode === "roots" ? 8 : 4;
      if (step % spacing === 0) {
        let n = 36 + c.bass;
        while (n > 47) n -= 12;
        if (mode === "root-fifth" && step % 8 === 4) n += 7;
        if (mode === "walking") {
          const tones = [0, c.minor ? 3 : 4, 7, 10];
          n = 36 + c.root + tones[(step / 4) % 4];
          if (step >= s.steps - 4) {
            let next =
              chord(chordAt(s, (start + s.beats) % (s.beats * s.bars)).symbol)
                .bass + 36;
            while (next > 47) next -= 12;
            n = next - 1;
          }
        }
        events.push({
          part: "bass",
          step,
          duration: Math.min(spacing / 4, s.beats - step / 4) * 0.85,
          notes: [n],
          velocity: 0.8,
        });
      }
    } else
      for (const e of atSequence(s.bass, beat))
        if (e.notes.length)
          events.push({ ...e, part: "bass", step, velocity: 0.8 });
    for (const e of atSequence(s.melody, beat))
      if (e.notes.length && !drop) {
        events.push({ ...e, part: "melody", step, velocity: 0.5 });
        if (deltaEmb > 0.05 && r() < deltaEmb * 0.6 && step + 1 < s.steps)
          events.push({
            part: "melody",
            step: step + 1,
            duration: 0.25,
            notes: [e.notes[0] + (r() < 0.5 ? -1 : 1)],
            velocity: 0.23,
          });
      }
    if (
      !s.melody.length &&
      deltaEmb > 0.1 &&
      step % 2 === 0 &&
      r() < deltaEmb * 0.28 &&
      !drop
    )
      events.push({
        part: "melody",
        step,
        duration: 0.4,
        notes: [
          60 + c.root + c.ints[1 + Math.floor(r() * (c.ints.length - 1))],
        ],
        velocity: 0.35,
      });
    for (const v of voices) {
      let mark = s.drums[v]?.[bar % s.drums[v].length]?.[step] || ".";
      if (
        deltaBus < 0 &&
        mark !== "." &&
        r() < -deltaBus * 0.85 &&
        mark !== "X"
      )
        mark = ".";
      if (
        deltaBus > 0 &&
        mark === "." &&
        r() < deltaBus * (v === "hats" ? 0.28 : 0.08)
      )
        mark = "g";
      grids[v][step] = mark;
      if (mark !== ".")
        events.push({
          part: "drums",
          voice: v,
          step,
          duration: 0.25,
          velocity: { X: 1, x: 0.68, g: 0.24 }[mark],
        });
    }
  }
  events.sort((a, b) => a.step - b.step);
  return { bar, events, grids, parts, state: copy(state), last };
}
/* Freeze actual notes/grids into a score. No new generative choices on replay. */
function capture(s, bars, state, seed) {
  const out = copy(s);
  out.title = s.title + " — capture";
  out.seed = seed;
  out.tempo = state.tempo;
  out.swing = state.swing;
  out.values = copy(state);
  out.drift.limits = {};
  out.chords = [];
  out.chordNotes = [];
  out.bass = [];
  out.melody = [];
  out.parts = { ...bars[0].parts };
  out.values.timbre = 0;
  out.values.arrangement = 0;
  out.values.substitution = 0;
  out.values.rhythm = 0;
  out.drums = Object.fromEntries(
    voices.map((v) => [v, bars.map((b) => b.grids[v].join(""))]),
  );
  const notesFor = (part) => {
    const es = bars
      .flatMap((b) =>
        b.events
          .filter((e) => e.part === part)
          .map((e) => ({ ...e, at: b.bar * s.beats + e.step / 4 })),
      )
      .sort((a, b) => a.at - b.at);
    const result = [];
    let pos = 0;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.at < pos - 0.001) continue;
      if (e.at > pos) result.push({ at: pos, duration: e.at - pos, notes: [] });
      const end = Math.min(
        es[i + 1]?.at ?? s.bars * s.beats,
        e.at + Math.max(0.25, Math.round(e.duration * 4) / 4),
        s.bars * s.beats,
      );
      result.push({ at: e.at, duration: end - e.at, notes: e.notes });
      pos = end;
    }
    if (pos < s.beats * s.bars)
      result.push({
        at: pos,
        duration: s.beats * s.bars - pos,
        notes: [],
      });
    return result;
  };
  const ce = bars.flatMap((b) =>
    b.events
      .filter((e) => e.part === "chords")
      .map((e) => ({ ...e, at: b.bar * s.beats + e.step / 4 })),
  );
  if (!ce.length) ce.push({ at: 0, symbol: s.chords[0].symbol, notes: [] });
  if (ce[0].at > 0)
    ce.unshift({ at: 0, symbol: s.chords[0].symbol, notes: [] });
  ce.forEach((e, i) => {
    const duration = (ce[i + 1]?.at ?? s.bars * s.beats) - e.at;
    out.chords.push({ at: e.at, duration, symbol: e.symbol });
    out.chordNotes.push({ at: e.at, duration, notes: e.notes });
  });
  out.bass = notesFor("bass");
  out.melody = notesFor("melody");
  return out;
}
export {
  clamp,
  copy,
  rng,
  note,
  noteName,
  chord,
  parse,
  serialize,
  voicing,
  specs,
  textures,
  voices,
  instruments,
  origin,
  driftState,
  directions,
  steer,
  advance,
  planBar,
  capture,
};
