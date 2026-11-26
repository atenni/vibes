// Pure wave definitions: hand-authored waves 1–8, then a seeded generator.
//
// A wave is a grid of letters (one string per row):
//   B blob · S squid · C crab · D diver · E inkeater · . empty
// The grid is centred horizontally; `top` is the y of the first row.
// Inkeaters ("E") are placed by the grid but then drift freely.

import { createRng } from "./rng.mjs";

/** @typedef {"blob" | "squid" | "crab" | "diver" | "inkeater"} Kind */

/**
 * @typedef {object} WaveDef
 * @property {number} wave
 * @property {boolean} boss          Every 5th wave.
 * @property {number} bossLevel      1 for the first boss, 2 for the second…; 0 if no boss.
 * @property {string[]} rows         Formation grid (see above).
 * @property {number} top            y of the first row.
 * @property {number} fireInterval   Average seconds between enemy volleys.
 * @property {number} bulletSpeed    Base enemy bullet speed (u/s).
 * @property {number} stepBase       Seconds between formation steps at full strength.
 * @property {number | null} diveInterval  Average seconds between dives; null = none.
 */

export const CELL = { w: 34, h: 26 };
export const FIELD_MARGIN = 14;
export const MAX_COLS = 9;

/** Sprite hitbox sizes by kind. */
export const INVADER_SIZE = {
  blob: { w: 24, h: 16 },
  squid: { w: 22, h: 16 },
  crab: { w: 28, h: 18 },
  diver: { w: 24, h: 18 },
  inkeater: { w: 24, h: 20 },
};

export const BOSS_SIZE = { w: 90, h: 66 };

/** Letter → kind. */
export const KIND_BY_LETTER = {
  B: "blob",
  S: "squid",
  C: "crab",
  D: "diver",
  E: "inkeater",
};

export const BASE_POINTS = {
  blob: 10,
  squid: 20,
  crab: 30,
  diver: 40,
  inkeater: 50,
};
export const BASE_HP = { blob: 1, squid: 1, crab: 2, diver: 1, inkeater: 1 };

/** @param {number} wave */
export const isBossWave = (wave) => wave > 0 && wave % 5 === 0;

/** @type {Omit<WaveDef, "wave" | "boss" | "bossLevel">[]} */
const HAND = [
  // 1 — blobs only, slow fire.
  {
    rows: ["BBBBBBB", "BBBBBBB", "BBBBBBB"],
    top: 110,
    fireInterval: 2.8,
    bulletSpeed: 110,
    stepBase: 0.95,
    diveInterval: null,
  },
  // 2 — squids join: bullets worth bouncing.
  {
    rows: ["SSSSSSSS", "SSSSSSSS", "BBBBBBBB", "BBBBBBBB"],
    top: 104,
    fireInterval: 2.0,
    bulletSpeed: 135,
    stepBase: 0.85,
    diveInterval: null,
  },
  // 3 — crabs: spreads, ink shines.
  {
    rows: ["CCCCCCC", "CCCCCCC", "SSSSSSS", "BBBBBBB"],
    top: 104,
    fireInterval: 1.7,
    bulletSpeed: 140,
    stepBase: 0.8,
    diveInterval: null,
  },
  // 4 — divers, and the first lone inkeater.
  {
    rows: ["..E.....", "D.DDDD.D", "CCCCCCCC", "SSSSSSSS", "BBBBBBBB"],
    top: 96,
    fireInterval: 1.6,
    bulletSpeed: 145,
    stepBase: 0.75,
    diveInterval: 5,
  },
  // 5 — boss (Inkubus) with two inkeater escorts.
  {
    rows: ["E......E"],
    top: 210,
    fireInterval: 99,
    bulletSpeed: 150,
    stepBase: 0.9,
    diveInterval: null,
  },
  // 6
  {
    rows: ["..E..E..", "D.D..D.D", "CCCCCCCC", "SSSSSSSS", "BBBBBBBB"],
    top: 96,
    fireInterval: 1.4,
    bulletSpeed: 155,
    stepBase: 0.68,
    diveInterval: 4,
  },
  // 7
  {
    rows: ["E..DD..E", "DCCCCCCD", "CCCCCCCC", "SSSSSSSS", "SBSBSBSB"],
    top: 92,
    fireInterval: 1.3,
    bulletSpeed: 160,
    stepBase: 0.62,
    diveInterval: 3.6,
  },
  // 8
  {
    rows: [
      "E.DDDD.E",
      "CCCCCCCC",
      "CSCSCSCS",
      "SSSSSSSS",
      "BSBSBSBS",
      "BBBBBBBB",
    ],
    top: 88,
    fireInterval: 1.15,
    bulletSpeed: 165,
    stepBase: 0.56,
    diveInterval: 3.2,
  },
];

/**
 * Build the definition for a wave. Waves 1–8 are hand-authored; later ones
 * are generated from the seed and are deterministic for (wave, seed).
 * @param {number} wave  1-based
 * @param {number} [seed]
 * @returns {WaveDef}
 */
export function getWave(wave, seed = 1) {
  const boss = isBossWave(wave);
  const bossLevel = boss ? wave / 5 : 0;
  if (wave >= 1 && wave <= HAND.length) {
    return {
      wave,
      boss,
      bossLevel,
      ...HAND[wave - 1],
      rows: [...HAND[wave - 1].rows],
    };
  }
  return generateWave(wave, seed, boss, bossLevel);
}

/**
 * @param {number} wave
 * @param {number} seed
 * @param {boolean} boss
 * @param {number} bossLevel
 * @returns {WaveDef}
 */
function generateWave(wave, seed, boss, bossLevel) {
  const rng = createRng((seed * 7919 + wave * 104729) >>> 0);
  const level = wave - 8; // difficulty above the hand-authored waves
  const t = Math.min(1, level / 30);
  const cols = rng.int(7, MAX_COLS + 1);

  /** @type {string[]} */
  let rows;
  if (boss) {
    // Boss waves: just a handful of escorts.
    const row = Array.from({ length: 8 }, () => ".");
    const escorts = Math.min(4, 2 + Math.floor(bossLevel / 2));
    for (let i = 0; i < escorts; i++)
      row[rng.int(8)] = rng.chance(0.6) ? "E" : "D";
    rows = [row.join("")];
  } else {
    const rowCount = Math.min(7, 4 + Math.floor(level / 4) + rng.int(0, 2));
    const pool = ["B", "S", "C", "C", "D", "S"];
    rows = [];
    for (let r = 0; r < rowCount; r++) {
      // Weaker kinds at the bottom, nastier ones at the top.
      const bias = r / Math.max(1, rowCount - 1); // 0 top … 1 bottom
      let line = "";
      for (let c = 0; c < cols; c++) {
        let ch;
        if (bias > 0.7) ch = rng.chance(0.7) ? "B" : "S";
        else if (bias > 0.35) ch = rng.pick(pool);
        else ch = rng.chance(0.25 + t * 0.2) ? "D" : "C";
        if (r === 0 && rng.chance(0.12 + t * 0.12)) ch = "E";
        line += ch;
      }
      rows.push(line);
    }
  }

  return {
    wave,
    boss,
    bossLevel,
    rows,
    top: boss ? 210 : Math.max(70, 96 - rows.length * 2),
    fireInterval: Math.max(0.5, 1.15 - level * 0.03 - rng.float(0, 0.1)),
    bulletSpeed: Math.min(260, 165 + level * 4),
    stepBase: Math.max(0.3, 0.56 - level * 0.012),
    diveInterval: Math.max(1.6, 3.2 - level * 0.06),
  };
}

/**
 * Spawn layout for a wave: one entry per invader, with offsets relative to the
 * formation centre (x) and the formation top (y).
 * @param {WaveDef} def
 * @returns {{ kind: Kind, ox: number, oy: number, col: number, row: number }[]}
 */
export function layoutOf(def) {
  const out = [];
  const cols = Math.max(...def.rows.map((r) => r.length));
  def.rows.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const kind = KIND_BY_LETTER[line[col]];
      if (!kind) continue;
      out.push({
        kind,
        ox: (col - (cols - 1) / 2) * CELL.w,
        oy: row * CELL.h,
        col,
        row,
      });
    }
  });
  return out;
}

/** Width in units of the widest layout row, including sprite widths. */
export function layoutWidth(def) {
  const cols = Math.max(...def.rows.map((r) => r.length));
  return (cols - 1) * CELL.w + INVADER_SIZE.crab.w;
}

/** Boss hit points for a given boss level. */
export const bossHp = (level) => 110 + (level - 1) * 40;
