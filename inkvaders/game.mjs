// Inkvaders — the pure, deterministic game simulation.
//
// No DOM, no clocks, no Math.random: the same seed and the same input
// sequence always produce the same state. The shell owns time (fixed 1/120 s
// steps), input and presentation. See llm/inkvaders/SPEC.md §4 and §7.
//
// ## Public API
//
//   FIELD                         playfield constants (360 × 640, dock, ship row)
//   createGame({ seed, wave })    → Game
//   step(game, dt, input)         → GameEvent[]   (mutates game)
//   isInDock(y)                   is a playfield y inside the dock?
//   spawnInvader(game, kind, x, y)  add an invader (tests / scripted demos)
//   INVADER_SIZE, BOSS_SIZE, BASE_POINTS   re-exported from waves.mjs
//   LIMITS                        tuning constants (max lives, stroke cap …)
//
// ## Types
//
// @typedef {"blob"|"squid"|"crab"|"diver"|"inkeater"} Kind
//
// @typedef {object} InputFrame   rebuilt by the shell every step
// @property {number|null} steerX   target x, or null when nobody is steering
// @property {number} steerDx       keyboard axis −1…1 (moves the target)
// @property {{id:number,x:number,y:number}[]} inkBegin  new ink pointers
// @property {{id:number,x:number,y:number}[]} inkMove   extra points, in order
// @property {{id:number}[]} inkEnd                      lifted ink pointers
// @property {boolean} bomb         flick or key detected this step
//
// @typedef {object} Game          read-only for the renderer
// @property {"playing"|"waveIntro"|"dying"|"over"} state
// @property {number} time wave score lives ink inkMax combo comboTimer
//   bestComboThisRun hitStop trauma
// @property {{x,y,vx,invuln,alive}} ship
// @property {Invader[]} invaders   { id, kind, x, y, w, h, hp, maxHp, frame,
//   flash, diving, stun }  (extra: ox, oy, col, row, mode — internal-ish)
// @property {{dir,stepTimer,stepInterval,bob}} formation   (extra: x, y)
// @property {null|{x,y,vx,hp}} mothership
// @property {null|{x,y,w,h,hp,maxHp,pattern,flash}} boss
// @property {Bullet[]} bullets     { id, x, y, vx, vy, r, friendly, ricochet,
//   kind, trail:[{x,y}] }   kind is "player", an invader kind or "boss"
// @property {Stroke[]} strokes     { id, points:[{x,y}], drawing, age, life,
//   hue0 }   (extra: retiring)
// @property {{x,y,vy,fuse}[]} bombs
// @property {{x,y,vx,vy,life}[]} droplets
// @property {null|{text,t,kind,dur}} banner   t = seconds shown so far
//   kinds: wave, boss, clear, ink, life
// @property {{steered:boolean,drew:boolean}} hints   shell seeds these
//
// @typedef {{type:string, [k:string]:any}} GameEvent
//   shot {x,y} · invaderHit {kind,x,y,damage} (hit but survived) ·
//   invaderKilled {kind,x,y,points,combo,byRicochet} · ricochet {x,y,combo} ·
//   inkEmpty · bombFired {x,y} · bombBurst {x,y,radius} · playerHit {x,y} ·
//   lifeLost {lives} · lifeGained {lives} · gameOver {score,wave,bestCombo} ·
//   waveStart {wave,boss} · waveClear {wave} · mothershipSpawn {x} ·
//   mothershipKilled {x,y,points} · bossHit {x,y,hp,damage,byRicochet} ·
//   bossKilled {x,y,points} · march {note} · inkRefill {reason} ·
//   inkEaten {x,y} · diveStart {x,y} · shockwave {x,y}

import { createRng } from "./rng.mjs";
import {
  clamp,
  closestOnSegment,
  circleHitsBox,
  reflect,
  segmentNormal,
  simplify,
} from "./geometry.mjs";
import {
  BASE_HP,
  BASE_POINTS,
  BOSS_SIZE,
  INVADER_SIZE,
  bossHp,
  getWave,
  layoutOf,
} from "./waves.mjs";

export { BASE_POINTS, BOSS_SIZE, INVADER_SIZE };

export const FIELD = { w: 360, h: 640, dockY: 500, shipY: 560 };

export const LIMITS = {
  maxLives: 5,
  startLives: 3,
  inkMax: 100,
  maxStrokes: 4,
  strokeLife: 2.2,
  strokeFade: 0.6,
  minPointGap: 6,
  inkPerUnit: 1 / 4,
  inkRegen: 12,
  inkPerKill: 4,
  fireInterval: 0.28,
  maxPlayerBullets: 3,
  playerBulletSpeed: 520,
  comboWindow: 2.5,
  maxCombo: 8,
  invuln: 1.5,
  introTime: 1.6,
  clearTime: 0.9,
};

/** @param {number} y */
export const isInDock = (y) => y >= FIELD.dockY;

const STEP_SIZE = 8;
const BOMB_RADIUS = 120;
const HOMING_RATE = 4; // rad/s, ricochet bullets only
const DROP = 14;
const EDGE = 10;
const SHIP_R = 9;
const EMPTY_INPUT = { steerX: null, steerDx: 0 };

/**
 * @param {{ seed?: number, wave?: number }} [options]
 */
export function createGame({ seed = 1, wave = 1 } = {}) {
  const g = {
    state: "waveIntro",
    time: 0,
    wave,
    score: 0,
    lives: LIMITS.startLives,
    ink: LIMITS.inkMax,
    inkMax: LIMITS.inkMax,
    combo: 0,
    comboTimer: 0,
    bestComboThisRun: 0,
    hitStop: 0,
    trauma: 0,
    ship: { x: FIELD.w / 2, y: FIELD.shipY, vx: 0, invuln: 0, alive: true },
    invaders: [],
    formation: {
      dir: 1,
      stepTimer: 1,
      stepInterval: 1,
      bob: 0,
      x: FIELD.w / 2,
      y: 100,
    },
    mothership: null,
    boss: null,
    bullets: [],
    strokes: [],
    bombs: [],
    droplets: [],
    banner: null,
    hints: { steered: false, drew: false },
    sim: {
      seed,
      rng: createRng(seed),
      events: [],
      nextId: 1,
      target: FIELD.w / 2,
      shotTimer: 0.2,
      fireTimer: 1.5,
      diveTimer: 4,
      mothershipTimer: 0,
      marchIdx: 0,
      total: 1,
      pointers: /** @type {Map<number, any>} */ (new Map()),
      def: getWave(wave, seed),
      introT: 0,
      clearT: -1,
      dyingT: 0,
      bossT: 0,
      bossPhaseT: 0,
      bossShotT: 0,
      bossSpiral: 0,
      bossBurst: 0,
      bossBurstT: 0,
      bossCharge: 0,
    },
  };
  g.sim.mothershipTimer = g.sim.rng.float(12, 20);
  startWave(g);
  return g;
}

/** @param {any} g */
const nextId = (g) => g.sim.nextId++;

/** @param {any} g @param {string} type @param {object} [data] */
function emit(g, type, data = {}) {
  g.sim.events.push({ type, ...data });
}

/** @param {any} g @param {number} amount */
function addTrauma(g, amount) {
  g.trauma = Math.min(1, g.trauma + amount);
}

/** @param {any} g @param {number} seconds */
function addHitStop(g, seconds) {
  g.hitStop = Math.max(g.hitStop, seconds);
}

// ---------------------------------------------------------------- waves ----

/** Spawn the formation / boss for g.wave and begin the intro. @param {any} g */
function startWave(g) {
  const s = g.sim;
  const def = getWave(g.wave, s.seed);
  s.def = def;
  g.state = "waveIntro";
  s.introT = 0;
  s.clearT = -1;
  g.bullets = g.bullets.filter((b) => b.friendly);
  g.invaders = [];
  g.boss = null;
  g.formation.dir = 1;
  g.formation.x = FIELD.w / 2;
  g.formation.y = def.top;
  for (const l of layoutOf(def)) {
    const inv = makeInvader(g, l.kind, 0, 0);
    inv.ox = l.ox;
    inv.oy = l.oy;
    inv.col = l.col;
    inv.row = l.row;
    g.invaders.push(inv);
  }
  s.total = Math.max(1, g.invaders.length);
  s.marchIdx = 0;
  s.fireTimer = def.fireInterval * 1.2;
  s.diveTimer = def.diveInterval ? def.diveInterval : 99;
  updateInterval(g);
  g.formation.stepTimer = g.formation.stepInterval;
  if (def.boss) {
    const size = BOSS_SIZE;
    const hp = bossHp(def.bossLevel);
    g.boss = {
      x: FIELD.w / 2,
      y: 120,
      w: size.w,
      h: size.h,
      hp,
      maxHp: hp,
      pattern: "fan",
      flash: 0,
      charging: false,
    };
    s.bossT = 0;
    s.bossPhaseT = 0;
    s.bossShotT = 1.2;
    s.bossSpiral = 0;
    s.bossBurst = 0;
    s.bossCharge = 0;
  }
  // Fresh ink; strokes still being drawn carry on, others fade out.
  for (const st of g.strokes) if (!st.drawing) fadeStroke(st, 0.6);
  if (g.ink < g.inkMax) {
    g.ink = g.inkMax;
    emit(g, "inkRefill", { reason: "wave" });
  }
  g.banner = def.boss
    ? { text: "INKUBUS!", t: 0, kind: "boss", dur: LIMITS.introTime }
    : { text: `WAVE ${g.wave}`, t: 0, kind: "wave", dur: LIMITS.introTime };
  layoutFormation(g);
  emit(g, "waveStart", { wave: g.wave, boss: def.boss });
}

/** @param {any} st @param {number} remaining */
function fadeStroke(st, remaining) {
  st.drawing = false;
  st.age = Math.max(st.age, st.life - Math.min(remaining, LIMITS.strokeFade));
}

/** @param {any} g @param {Kind} kind @param {number} x @param {number} y */
function makeInvader(g, kind, x, y) {
  const size = INVADER_SIZE[kind];
  return {
    id: nextId(g),
    kind,
    x,
    y,
    w: size.w,
    h: size.h,
    hp: BASE_HP[kind],
    maxHp: BASE_HP[kind],
    frame: 0,
    flash: 0,
    diving: false,
    stun: 0,
    // Formation slot (offsets from formation centre / top).
    ox: 0,
    oy: 0,
    col: 0,
    row: 0,
    mode: kind === "inkeater" ? "eater" : "formation", // formation|swoop|return|eater
    u: 0,
    stunCd: 0,
    side: 1,
    sx: 0,
    sy: 0,
    tx: 0,
  };
}

/**
 * Add an invader at an absolute position, attached to the formation.
 * @param {any} g @param {Kind} kind @param {number} x @param {number} y
 */
export function spawnInvader(g, kind, x, y) {
  const inv = makeInvader(g, kind, x, y);
  inv.ox = x - g.formation.x;
  inv.oy = y - g.formation.y;
  inv.col = Math.round(inv.ox / 34);
  inv.row = Math.round(inv.oy / 26);
  g.invaders.push(inv);
  g.sim.total = Math.max(g.sim.total, g.invaders.length);
  return inv;
}

/** Put formation-bound invaders at their slots. @param {any} g */
function layoutFormation(g) {
  const f = g.formation;
  const introP =
    g.state === "waveIntro" ? clamp(g.sim.introT / LIMITS.introTime, 0, 1) : 1;
  const slide = (1 - easeOut(introP)) * 260;
  const fy = f.y - slide;
  for (const inv of g.invaders) {
    if (inv.mode === "formation") {
      inv.x = f.x + inv.ox;
      inv.y = fy + inv.oy;
    } else if (inv.mode === "eater" && g.state === "waveIntro") {
      inv.x = f.x + inv.ox;
      inv.y = fy + inv.oy;
    }
  }
  if (g.boss && g.state === "waveIntro") g.boss.y = 120 - slide;
}

const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/** @param {any} g */
function updateInterval(g) {
  const f = g.formation;
  const alive = g.invaders.length;
  const frac = clamp(alive / g.sim.total, 0, 1);
  f.stepInterval = Math.max(0.06, g.sim.def.stepBase * (0.12 + 0.88 * frac));
}

// ----------------------------------------------------------------- step ----

/**
 * Advance the simulation by dt seconds.
 * @param {any} g
 * @param {number} dt
 * @param {any} [input]
 * @returns {any[]} events
 */
export function step(g, dt, input = EMPTY_INPUT) {
  const s = g.sim;
  if (g.state === "over") return flush(g);

  handleInput(g, input, dt);

  if (g.hitStop > 0) {
    g.hitStop = Math.max(0, g.hitStop - dt);
    return flush(g);
  }

  g.time += dt;
  g.trauma = Math.max(0, g.trauma - dt * 1.1);
  if (g.banner) {
    g.banner.t += dt;
    if (g.banner.t >= g.banner.dur) g.banner = null;
  }
  if (g.comboTimer > 0) {
    g.comboTimer -= dt;
    if (g.comboTimer <= 0) {
      g.comboTimer = 0;
      g.combo = 0;
    }
  }
  for (const inv of g.invaders) {
    if (inv.flash > 0) inv.flash = Math.max(0, inv.flash - dt);
  }
  if (g.boss && g.boss.flash > 0) g.boss.flash = Math.max(0, g.boss.flash - dt);
  g.formation.bob = Math.sin(g.time * 2.2) * 2;

  updateShip(g, dt);
  updateInk(g, dt);

  if (g.state === "waveIntro") {
    s.introT += dt;
    layoutFormation(g);
    updateBullets(g, dt);
    if (s.introT >= LIMITS.introTime) {
      g.state = "playing";
      g.formation.stepTimer = g.formation.stepInterval;
      layoutFormation(g);
    }
    return flush(g);
  }

  if (g.state === "dying") {
    s.dyingT -= dt;
    updateBullets(g, dt);
    updateWorld(g, dt, false);
    if (s.dyingT <= 0) {
      g.state = "over";
      emit(g, "gameOver", {
        score: g.score,
        wave: g.wave,
        bestCombo: g.bestComboThisRun,
      });
    }
    return flush(g);
  }

  // Playing.
  autoFire(g, dt);
  updateWorld(g, dt, true);
  updateBullets(g, dt);
  resolveHits(g);
  updateBombs(g, dt);
  checkShipHits(g);
  checkDock(g);
  checkWaveClear(g, dt);
  return flush(g);
}

/** @param {any} g */
function flush(g) {
  const out = g.sim.events;
  g.sim.events = [];
  return out;
}

// ---------------------------------------------------------------- input ----

/** @param {any} g @param {any} input @param {number} dt */
function handleInput(g, input, dt) {
  const s = g.sim;
  const acting = g.state !== "dying" && g.state !== "over";

  if (input.steerX != null) {
    s.target = clamp(input.steerX, 16, FIELD.w - 16);
    g.hints.steered = true;
  }
  if (input.steerDx) {
    s.target = clamp(s.target + input.steerDx * 340 * dt, 16, FIELD.w - 16);
    g.hints.steered = true;
  }

  for (const p of input.inkBegin ?? []) beginStroke(g, p);
  for (const p of input.inkMove ?? []) extendStroke(g, p);
  for (const p of input.inkEnd ?? []) endStroke(g, p.id);

  if (input.bomb && g.state === "playing" && g.ship.alive && acting)
    fireBomb(g);
}

/** @param {any} g @param {{id:number,x:number,y:number}} p */
function beginStroke(g, p) {
  const s = g.sim;
  if (g.state === "over" || g.state === "dying") return;
  if (g.ink < 1) {
    s.pointers.set(p.id, null);
    emit(g, "inkEmpty", {});
    return;
  }
  // Retire the oldest live stroke if we are at the cap.
  const live = g.strokes.filter((st) => !st.retiring);
  if (live.length >= LIMITS.maxStrokes) {
    const old = live[0];
    old.retiring = true;
    fadeStroke(old, 0.15);
    for (const [pid, st] of s.pointers)
      if (st === old) s.pointers.set(pid, null);
  }
  const stroke = {
    id: nextId(g),
    points: [{ x: p.x, y: p.y }],
    drawing: true,
    age: 0,
    life: LIMITS.strokeLife,
    hue0: 180,
    retiring: false,
  };
  g.strokes.push(stroke);
  s.pointers.set(p.id, stroke);
  g.hints.drew = true;
}

/** @param {any} g @param {{id:number,x:number,y:number}} p */
function extendStroke(g, p) {
  const stroke = g.sim.pointers.get(p.id);
  if (!stroke || !stroke.drawing) return;
  const last = stroke.points[stroke.points.length - 1];
  const d = Math.hypot(p.x - last.x, p.y - last.y);
  if (d < LIMITS.minPointGap) return;
  const cost = d * LIMITS.inkPerUnit;
  if (cost > g.ink) {
    g.ink = 0;
    emit(g, "inkEmpty", {});
    finishStroke(g, stroke);
    g.sim.pointers.set(p.id, null);
    return;
  }
  g.ink -= cost;
  stroke.points.push({ x: p.x, y: p.y });
}

/** @param {any} g @param {number} id */
function endStroke(g, id) {
  const stroke = g.sim.pointers.get(id);
  g.sim.pointers.delete(id);
  if (stroke) finishStroke(g, stroke);
}

/** @param {any} g @param {any} stroke */
function finishStroke(g, stroke) {
  stroke.drawing = false;
  if (stroke.points.length < 2) removeStroke(g, stroke);
}

/** @param {any} g @param {any} stroke */
function removeStroke(g, stroke) {
  const i = g.strokes.indexOf(stroke);
  if (i >= 0) g.strokes.splice(i, 1);
}

/** Ink metering and ageing. @param {any} g @param {number} dt */
function updateInk(g, dt) {
  const drawing = g.strokes.some((st) => st.drawing);
  if (!drawing && g.ink < g.inkMax)
    g.ink = Math.min(g.inkMax, g.ink + LIMITS.inkRegen * dt);
  for (let i = g.strokes.length - 1; i >= 0; i--) {
    const st = g.strokes[i];
    if (st.drawing) continue;
    st.age += dt;
    if (st.age >= st.life) g.strokes.splice(i, 1);
  }
}

// ----------------------------------------------------------------- ship ----

/** @param {any} g @param {number} dt */
function updateShip(g, dt) {
  const ship = g.ship;
  if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - dt);
  if (!ship.alive) {
    ship.vx = 0;
    return;
  }
  // Critically damped spring: settles in roughly 70 ms.
  const w = 48;
  const acc = w * w * (g.sim.target - ship.x) - 2 * w * ship.vx;
  ship.vx += acc * dt;
  ship.x = clamp(ship.x + ship.vx * dt, 16, FIELD.w - 16);
}

/** @param {any} g @param {number} dt */
function autoFire(g, dt) {
  const s = g.sim;
  if (!g.ship.alive) return;
  s.shotTimer -= dt;
  if (s.shotTimer > 0) return;
  const own = g.bullets.filter((b) => b.kind === "player").length;
  if (own >= LIMITS.maxPlayerBullets) {
    s.shotTimer = 0;
    return;
  }
  s.shotTimer += LIMITS.fireInterval;
  if (s.shotTimer < 0) s.shotTimer = LIMITS.fireInterval;
  g.bullets.push({
    id: nextId(g),
    x: g.ship.x,
    y: g.ship.y - 14,
    vx: 0,
    vy: -LIMITS.playerBulletSpeed,
    r: 3,
    friendly: true,
    ricochet: false,
    kind: "player",
    trail: [],
    cool: {},
    pierce: 1,
  });
  emit(g, "shot", { x: g.ship.x, y: g.ship.y - 14 });
}

// ---------------------------------------------------------------- world ----

/**
 * Formation, divers, eaters, boss, mothership and enemy fire.
 * @param {any} g @param {number} dt @param {boolean} combat  false while dying
 */
function updateWorld(g, dt, combat) {
  const s = g.sim;
  const f = g.formation;

  // Formation march.
  updateInterval(g);
  f.stepTimer -= dt;
  if (f.stepTimer <= 0 && g.invaders.length > 0) {
    marchStep(g);
    updateInterval(g);
    f.stepTimer += f.stepInterval;
    if (f.stepTimer < 0) f.stepTimer = f.stepInterval;
  }
  layoutFormation(g);

  for (const inv of g.invaders) {
    if (inv.mode === "swoop" || inv.mode === "return") moveDiver(g, inv, dt);
    else if (inv.mode === "eater") moveEater(g, inv, dt);
    if (inv.stunCd > 0) inv.stunCd = Math.max(0, inv.stunCd - dt);
  }

  if (!combat) return;

  // Dives.
  if (s.def.diveInterval) {
    s.diveTimer -= dt;
    if (s.diveTimer <= 0) {
      startDive(g);
      s.diveTimer = s.def.diveInterval * s.rng.float(0.7, 1.3);
    }
  }

  // Enemy fire from the formation.
  if (g.invaders.length > 0) {
    s.fireTimer -= dt;
    if (s.fireTimer <= 0) {
      enemyFire(g);
      s.fireTimer = s.def.fireInterval * s.rng.float(0.6, 1.4);
    }
  }

  if (g.boss) updateBoss(g, dt);
  updateMothership(g, dt);
}

/** One discrete formation step. @param {any} g */
function marchStep(g) {
  const f = g.formation;
  const members = g.invaders.filter((i) => i.mode === "formation");
  f.stepTimer = 0;
  g.sim.marchIdx++;
  emit(g, "march", { note: g.sim.marchIdx % 4 });
  for (const inv of g.invaders) inv.frame ^= 1;
  if (members.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const m of members) {
    minX = Math.min(minX, f.x + m.ox - m.w / 2);
    maxX = Math.max(maxX, f.x + m.ox + m.w / 2);
  }
  const blocked =
    (f.dir > 0 && maxX + STEP_SIZE > FIELD.w - EDGE) ||
    (f.dir < 0 && minX - STEP_SIZE < EDGE);
  if (blocked) {
    f.y += DROP;
    f.dir = -f.dir;
  } else {
    f.x += f.dir * STEP_SIZE;
  }
}

/** @param {any} g */
function startDive(g) {
  const s = g.sim;
  const candidates = g.invaders.filter(
    (i) => i.kind === "diver" && i.mode === "formation",
  );
  if (candidates.length === 0) return;
  const inv = s.rng.pick(candidates);
  inv.mode = "swoop";
  inv.diving = true;
  inv.u = 0;
  inv.sx = inv.x;
  inv.sy = inv.y;
  inv.tx = g.ship.x;
  inv.side = s.rng.chance(0.5) ? -1 : 1;
  emit(g, "diveStart", { x: inv.x, y: inv.y });
}

const bez = (a, b, c, u) =>
  (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c;

/** @param {any} g @param {any} inv @param {number} dt */
function moveDiver(g, inv, dt) {
  if (inv.stun > 0) {
    inv.stun = Math.max(0, inv.stun - dt);
    return;
  }
  if (inv.mode === "swoop") {
    const duration = 2.6 / (1 + g.wave * 0.03);
    inv.u += dt / duration;
    const endY = FIELD.h + 30;
    const ctrlX = (inv.sx + inv.tx) / 2 + inv.side * 110;
    const ctrlY = inv.sy + (FIELD.shipY - inv.sy) * 0.55;
    inv.x = bez(inv.sx, ctrlX, inv.tx, Math.min(1, inv.u));
    inv.y = bez(inv.sy, ctrlY, endY, Math.min(1, inv.u));
    // Ink stuns divers and pushes them back along their path.
    if (inv.stunCd <= 0 && touchingInk(g, inv.x, inv.y, 12 + inv.w / 2)) {
      inv.stun = 1;
      inv.stunCd = 1.8;
      inv.u = Math.max(0, inv.u - 0.18);
      inv.x = bez(inv.sx, ctrlX, inv.tx, inv.u);
      inv.y = bez(inv.sy, ctrlY, endY, inv.u);
      return;
    }
    if (inv.u >= 1) {
      inv.mode = "return";
      inv.x = inv.sx;
      inv.y = -30;
    }
  } else {
    // Return from the top to the home slot.
    const hx = g.formation.x + inv.ox;
    const hy = g.formation.y + inv.oy;
    const dx = hx - inv.x;
    const dy = hy - inv.y;
    const d = Math.hypot(dx, dy);
    const sp = 170 * dt;
    if (d <= sp) {
      inv.mode = "formation";
      inv.diving = false;
      inv.x = hx;
      inv.y = hy;
    } else {
      inv.x += (dx / d) * sp;
      inv.y += (dy / d) * sp;
    }
  }
}

/** Is (x, y) within `r` of any stroke segment? @param {any} g */
function touchingInk(g, x, y, r) {
  for (const st of g.strokes) {
    for (let i = 1; i < st.points.length; i++) {
      const a = st.points[i - 1];
      const b = st.points[i];
      const c = closestOnSegment(x, y, a.x, a.y, b.x, b.y);
      if (Math.hypot(x - c.x, y - c.y) <= r) return true;
    }
  }
  return false;
}

/** Inkeaters drift toward the nearest ink, or home when there is none. */
function moveEater(g, inv, dt) {
  if (g.state === "waveIntro") return;
  let tx = g.formation.x + inv.ox;
  let ty = g.formation.y + inv.oy;
  let best = Infinity;
  let target = null;
  for (const st of g.strokes) {
    for (const p of st.points) {
      const d = Math.hypot(p.x - inv.x, p.y - inv.y);
      if (d < best) {
        best = d;
        target = p;
      }
    }
  }
  if (target) {
    tx = target.x;
    ty = target.y;
  }
  const dx = tx - inv.x;
  const dy = ty - inv.y;
  const d = Math.hypot(dx, dy);
  const sp = (target ? 55 + g.wave * 2.5 : 45) * dt;
  if (d > 0.5) {
    const k = Math.min(1, sp / d);
    inv.x += dx * k;
    inv.y += dy * k;
  }
  inv.y = Math.min(inv.y, FIELD.dockY - 30);
  inv.x = clamp(inv.x, 12, FIELD.w - 12);
  // Chomp ink within reach.
  const radius = 14;
  for (let i = g.strokes.length - 1; i >= 0; i--) {
    if (eraseAround(g, g.strokes[i], inv.x, inv.y, radius)) {
      emit(g, "inkEaten", { x: inv.x, y: inv.y });
    }
  }
}

/**
 * Remove stroke points within r of (x, y), splitting the stroke if needed.
 * @returns {boolean} whether anything was erased
 */
function eraseAround(g, stroke, x, y, r) {
  const keep = stroke.points.map((p) => Math.hypot(p.x - x, p.y - y) > r);
  // Also catch segments that pass through the radius between kept points.
  for (let i = 1; i < stroke.points.length; i++) {
    if (!keep[i] || !keep[i - 1]) continue;
    const a = stroke.points[i - 1];
    const b = stroke.points[i];
    const c = closestOnSegment(x, y, a.x, a.y, b.x, b.y);
    if (Math.hypot(x - c.x, y - c.y) <= r) {
      keep[i] = false;
      keep[i - 1] = false;
    }
  }
  if (keep.every(Boolean)) return false;
  /** @type {{x:number,y:number}[][]} */
  const pieces = [];
  let cur = [];
  stroke.points.forEach((p, i) => {
    if (keep[i]) cur.push(p);
    else {
      if (cur.length) pieces.push(cur);
      cur = [];
    }
  });
  if (cur.length) pieces.push(cur);
  const lastKept = keep[keep.length - 1];
  const wasDrawing = stroke.drawing;
  const idx = g.strokes.indexOf(stroke);
  const owners = [...g.sim.pointers]
    .filter(([, st]) => st === stroke)
    .map(([pid]) => pid);
  for (const pid of owners) g.sim.pointers.set(pid, null);
  g.strokes.splice(idx, 1);
  let at = idx;
  pieces.forEach((pts, n) => {
    if (pts.length < 2 && !(wasDrawing && lastKept && n === pieces.length - 1))
      return;
    const isTail = wasDrawing && lastKept && n === pieces.length - 1;
    const piece = {
      id: nextId(g),
      points: pts,
      drawing: !!isTail,
      age: isTail ? 0 : stroke.age,
      life: stroke.life,
      hue0: stroke.hue0,
      retiring: stroke.retiring,
    };
    g.strokes.splice(at++, 0, piece);
    if (isTail) for (const pid of owners) g.sim.pointers.set(pid, piece);
  });
  return true;
}

/** Pick a bottom-most invader per column and shoot from it. @param {any} g */
function enemyFire(g) {
  const s = g.sim;
  /** @type {Map<number, any>} */
  const bottoms = new Map();
  for (const inv of g.invaders) {
    if (inv.mode !== "formation" || inv.kind === "diver") continue;
    const cur = bottoms.get(inv.col);
    if (!cur || inv.oy > cur.oy) bottoms.set(inv.col, inv);
  }
  const shooters = [...bottoms.values()].filter((i) => i.y > -10);
  if (shooters.length === 0) return;
  const inv = s.rng.pick(shooters);
  const speed = s.def.bulletSpeed;
  const toShip = Math.atan2(g.ship.y - inv.y, g.ship.x - inv.x);
  const down = Math.PI / 2;
  switch (inv.kind) {
    case "squid":
      pushEnemyBullet(g, inv, toShip + s.rng.float(-0.22, 0.22), speed * 1.2);
      break;
    case "crab": {
      const centre = down + (toShip - down) * 0.4;
      for (const off of [-0.34, 0, 0.34])
        pushEnemyBullet(g, inv, centre + off, speed);
      break;
    }
    default:
      pushEnemyBullet(g, inv, down, speed * 0.85);
  }
}

/** @param {any} g @param {any} from @param {number} angle @param {number} speed */
function pushEnemyBullet(g, from, angle, speed, r = 3, kind = from.kind) {
  g.bullets.push({
    id: nextId(g),
    x: from.x,
    y: from.y + (from.h ?? 10) / 2,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r,
    friendly: false,
    ricochet: false,
    kind,
    trail: [],
    cool: {},
    pierce: 1,
  });
}

// ----------------------------------------------------------------- boss ----

const BOSS_PATTERNS = ["fan", "spiral", "aimed"];

/** @param {any} g @param {number} dt */
function updateBoss(g, dt) {
  const s = g.sim;
  const b = g.boss;
  const level = s.def.bossLevel;
  const rage = b.hp < b.maxHp * 0.5 ? 0.75 : 1;
  s.bossT += dt;
  s.bossPhaseT += dt;
  b.x = FIELD.w / 2 + Math.sin(s.bossT * (0.65 + level * 0.05)) * 120;
  b.y = 118 + Math.sin(s.bossT * 1.3) * 8;
  if (s.bossPhaseT >= 4.5) {
    s.bossPhaseT = 0;
    b.pattern =
      BOSS_PATTERNS[
        (BOSS_PATTERNS.indexOf(b.pattern) + 1) % BOSS_PATTERNS.length
      ];
    s.bossShotT = 0.6;
    s.bossBurst = 0;
    s.bossCharge = 0;
    b.charging = false;
  }
  const speed = 125 + level * 12;
  const bullet = (angle, sp, r = 4) =>
    pushEnemyBullet(g, { x: b.x, y: b.y, h: b.h * 0.6 }, angle, sp, r, "boss");
  s.bossShotT -= dt;
  if (b.pattern === "fan") {
    if (s.bossShotT <= 0) {
      const n = 5 + Math.min(4, level) * 1;
      const spread = 1.35;
      for (let i = 0; i < n; i++) {
        bullet(Math.PI / 2 - spread / 2 + (spread * i) / (n - 1), speed);
      }
      s.bossShotT = 1.5 * rage;
    }
  } else if (b.pattern === "spiral") {
    if (s.bossShotT <= 0) {
      s.bossSpiral += 0.5;
      bullet(Math.PI / 2 + Math.sin(s.bossSpiral) * 1.1, speed * 0.95);
      bullet(
        Math.PI / 2 + Math.sin(s.bossSpiral + Math.PI) * 1.1,
        speed * 0.95,
      );
      s.bossShotT = 0.22 * rage;
    }
  } else {
    if (s.bossShotT <= 0 && s.bossBurst === 0 && s.bossCharge <= 0) {
      // Visible "tell" before the burst.
      s.bossCharge = 0.35;
      b.charging = true;
      s.bossShotT = 1.7 * rage;
    }
    if (s.bossCharge > 0) {
      s.bossCharge -= dt;
      if (s.bossCharge <= 0) {
        s.bossCharge = 0;
        b.charging = false;
        s.bossBurst = 3;
        s.bossBurstT = 0;
      }
    }
    if (s.bossBurst > 0) {
      s.bossBurstT -= dt;
      if (s.bossBurstT <= 0) {
        const a = Math.atan2(g.ship.y - b.y, g.ship.x - b.x);
        bullet(a, speed * 1.25);
        s.bossBurst--;
        s.bossBurstT = 0.13;
      }
    }
  }
}

// ----------------------------------------------------------- mothership ----

/** @param {any} g @param {number} dt */
function updateMothership(g, dt) {
  const s = g.sim;
  const m = g.mothership;
  if (m) {
    m.x += m.vx * dt;
    if (m.x < -40 || m.x > FIELD.w + 40) {
      g.mothership = null;
      s.mothershipTimer = s.rng.float(18, 28);
    }
    return;
  }
  s.mothershipTimer -= dt;
  if (s.mothershipTimer <= 0 && s.clearT < 0 && !g.boss) {
    const dir = s.rng.chance(0.5) ? 1 : -1;
    g.mothership = {
      x: dir > 0 ? -30 : FIELD.w + 30,
      y: 56,
      vx: dir * 75,
      hp: 1,
    };
    emit(g, "mothershipSpawn", { x: g.mothership.x });
  }
}

// -------------------------------------------------------------- bullets ----

/** Move bullets, trails and stroke reflection. @param {any} g @param {number} dt */
function updateBullets(g, dt) {
  const kept = [];
  for (const b of g.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.ricochet) {
      if (b.vy < 0) steerTowardTarget(g, b, dt);
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 12) b.trail.shift();
    }
    if (b.y < -20 || b.y > FIELD.h + 20 || b.x < -20 || b.x > FIELD.w + 20)
      continue;
    if (!b.friendly) reflectOffInk(g, b);
    kept.push(b);
  }
  g.bullets = kept;
}

/**
 * Gently bend a ricochet toward the nearest target above it. Speed unchanged.
 * @param {any} g @param {any} b @param {number} dt
 */
function steerTowardTarget(g, b, dt) {
  let best = null;
  let bestD = Infinity;
  /** @param {number} x @param {number} y */
  const consider = (x, y) => {
    if (y >= b.y - 4) return;
    const d = Math.hypot(x - b.x, y - b.y);
    // Prefer targets roughly ahead: penalise sideways offset.
    const score = d + Math.abs(x - b.x) * 0.5;
    if (score < bestD) {
      bestD = score;
      best = { x, y };
    }
  };
  for (const inv of g.invaders) if (inv.y > 0) consider(inv.x, inv.y);
  if (g.boss) consider(g.boss.x, g.boss.y);
  if (g.mothership) consider(g.mothership.x, g.mothership.y);
  if (!best) return;
  const speed = Math.hypot(b.vx, b.vy);
  const cur = Math.atan2(b.vy, b.vx);
  const want = Math.atan2(best.y - b.y, best.x - b.x);
  let diff = want - cur;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  const turn = clamp(diff, -HOMING_RATE * dt, HOMING_RATE * dt);
  let a = cur + turn;
  // Keep it travelling upward.
  const ny = Math.sin(a);
  if (ny > -0.2) a = Math.sign(Math.cos(a) || 1) > 0 ? -0.2 : -Math.PI + 0.2;
  b.vx = Math.cos(a) * speed;
  b.vy = Math.sin(a) * speed;
}

/** @param {any} g @param {any} b */
function reflectOffInk(g, b) {
  for (const st of g.strokes) {
    for (let i = 1; i < st.points.length; i++) {
      const key = st.id * 1000 + i;
      if (b.cool[key] > g.time) continue;
      const p = st.points[i - 1];
      const q = st.points[i];
      const c = closestOnSegment(b.x, b.y, p.x, p.y, q.x, q.y);
      const dx = b.x - c.x;
      const dy = b.y - c.y;
      if (Math.hypot(dx, dy) > b.r + 2.5) continue;

      const n = segmentNormal(p.x, p.y, q.x, q.y);
      const side =
        dx * n.x + dy * n.y !== 0
          ? Math.sign(dx * n.x + dy * n.y)
          : -Math.sign(b.vx * n.x + b.vy * n.y) || 1;
      let v = reflect(b.vx, b.vy, n.x, n.y);
      let speed = Math.max(Math.hypot(v.x, v.y) * 1.35, 280);
      speed = Math.min(speed, 700);
      let ux = v.x / (Math.hypot(v.x, v.y) || 1);
      let uy = v.y / (Math.hypot(v.x, v.y) || 1);
      if (uy > 0) uy = -uy; // ricochets always help
      if (-uy < 0.3) {
        // Never skim sideways: guarantee a decent upward component.
        uy = -0.3;
        ux = Math.sign(ux || 1) * Math.sqrt(1 - uy * uy);
      }
      b.vx = ux * speed;
      b.vy = uy * speed;
      b.x = c.x + n.x * side * (b.r + 3);
      b.y = c.y + n.y * side * (b.r + 3);
      b.friendly = true;
      b.ricochet = true;
      b.r = 4;
      b.pierce = 2;
      b.cool[key] = g.time + 0.08;
      const nextCombo =
        g.comboTimer > 0 ? Math.min(LIMITS.maxCombo, g.combo + 1) : 1;
      emit(g, "ricochet", { x: b.x, y: b.y, combo: nextCombo });
      return;
    }
  }
}

// ----------------------------------------------------------------- hits ----

/** Friendly bullets and droplets against invaders, boss, mothership. @param {any} g */
function resolveHits(g) {
  for (const b of g.bullets) {
    if (!b.friendly || b.dead) continue;
    const dmg = b.ricochet ? 2 : 1;
    const bossDmg = b.ricochet ? 5 : 1;
    if (hitTargets(g, b, dmg, bossDmg, b.ricochet)) {
      b.pierce--;
      if (b.pierce <= 0) b.dead = true;
    }
  }
  g.bullets = g.bullets.filter((b) => !b.dead);
}

/**
 * Apply one projectile to the first thing it overlaps.
 * @returns {boolean} whether it hit something
 */
function hitTargets(g, p, dmg, bossDmg, byRicochet) {
  const m = g.mothership;
  if (m && circleHitsBox(p.x, p.y, p.r, m.x, m.y, 34, 14)) {
    killMothership(g, byRicochet);
    return true;
  }
  const b = g.boss;
  if (
    b &&
    g.state === "playing" &&
    circleHitsBox(p.x, p.y, p.r, b.x, b.y, b.w * 0.85, b.h * 0.85)
  ) {
    hurtBoss(g, bossDmg, byRicochet, p.x, p.y);
    return true;
  }
  for (const inv of g.invaders) {
    if (inv.hp <= 0) continue;
    if (inv.y < -4) continue;
    if (!circleHitsBox(p.x, p.y, p.r, inv.x, inv.y, inv.w, inv.h)) continue;
    inv.hp -= dmg;
    if (inv.hp <= 0) killInvader(g, inv, byRicochet);
    else {
      inv.flash = 0.06;
      emit(g, "invaderHit", {
        kind: inv.kind,
        x: inv.x,
        y: inv.y,
        damage: dmg,
      });
    }
    return true;
  }
  return false;
}

/** @param {any} g @param {any} inv @param {boolean} byRicochet */
function killInvader(g, inv, byRicochet, award = true) {
  const i = g.invaders.indexOf(inv);
  if (i >= 0) g.invaders.splice(i, 1);
  const base = BASE_POINTS[inv.kind];
  let points = 0;
  if (award) {
    if (byRicochet) bumpCombo(g);
    points = base * (byRicochet ? Math.max(1, g.combo) : 1);
    g.score += points;
    g.ink = Math.min(g.inkMax, g.ink + LIMITS.inkPerKill);
    addHitStop(g, 0.045);
    addTrauma(g, byRicochet ? 0.22 : 0.12);
  }
  emit(g, "invaderKilled", {
    kind: inv.kind,
    x: inv.x,
    y: inv.y,
    points,
    combo: g.combo,
    byRicochet,
  });
  updateInterval(g);
}

/** @param {any} g */
function bumpCombo(g) {
  g.combo = g.comboTimer > 0 ? Math.min(LIMITS.maxCombo, g.combo + 1) : 1;
  g.comboTimer = LIMITS.comboWindow;
  g.bestComboThisRun = Math.max(g.bestComboThisRun, g.combo);
}

/** @param {any} g @param {boolean} byRicochet */
function killMothership(g, byRicochet) {
  const m = g.mothership;
  const points = g.sim.rng.pick([100, 150, 200, 300]);
  g.mothership = null;
  g.sim.mothershipTimer = g.sim.rng.float(18, 28);
  g.score += points;
  g.ink = g.inkMax;
  if (byRicochet) bumpCombo(g);
  addHitStop(g, 0.08);
  addTrauma(g, 0.35);
  g.banner = { text: "INK!", t: 0, kind: "ink", dur: 1.1 };
  emit(g, "mothershipKilled", { x: m.x, y: m.y, points });
  emit(g, "inkRefill", { reason: "mothership" });
}

/** @param {any} g @param {number} dmg @param {boolean} byRicochet */
function hurtBoss(g, dmg, byRicochet, x, y) {
  const b = g.boss;
  b.hp = Math.max(0, b.hp - dmg);
  b.flash = 0.06;
  if (byRicochet) {
    bumpCombo(g);
    g.score += 25 * g.combo;
    addTrauma(g, 0.3);
    addHitStop(g, 0.045);
  } else {
    g.score += 2;
  }
  emit(g, "bossHit", { x, y, hp: b.hp, damage: dmg, byRicochet });
  if (b.hp > 0) return;

  const level = g.sim.def.bossLevel;
  const points = 1000 * level;
  g.score += points;
  emit(g, "bossKilled", { x: b.x, y: b.y, points });
  g.boss = null;
  g.bullets = g.bullets.filter((bl) => bl.friendly);
  for (const inv of [...g.invaders]) killInvader(g, inv, false, false);
  if (g.lives < LIMITS.maxLives) {
    g.lives++;
    emit(g, "lifeGained", { lives: g.lives });
  }
  addHitStop(g, 0.25);
  addTrauma(g, 1);
  g.banner = { text: "BOSS DOWN!", t: 0, kind: "boss", dur: 1.6 };
}

// ---------------------------------------------------------------- bombs ----

/** @param {any} g */
function fireBomb(g) {
  if (g.ink < g.inkMax - 1e-6) return;
  if (g.bombs.length > 0) return;
  g.ink = 0;
  g.bombs.push({ x: g.ship.x, y: g.ship.y - 16, vy: -380, fuse: 0.8 });
  addTrauma(g, 0.35);
  emit(g, "bombFired", { x: g.ship.x, y: g.ship.y - 16 });
}

/** @param {any} g @param {number} dt */
function updateBombs(g, dt) {
  for (let i = g.bombs.length - 1; i >= 0; i--) {
    const bomb = g.bombs[i];
    bomb.y += bomb.vy * dt;
    bomb.fuse -= dt;
    let burst = bomb.fuse <= 0 || bomb.y < 40;
    if (!burst) {
      const probe = { x: bomb.x, y: bomb.y, r: 9 };
      burst =
        g.invaders.some((v) =>
          circleHitsBox(probe.x, probe.y, probe.r, v.x, v.y, v.w, v.h),
        ) ||
        (g.boss &&
          circleHitsBox(
            probe.x,
            probe.y,
            probe.r,
            g.boss.x,
            g.boss.y,
            g.boss.w * 0.85,
            g.boss.h * 0.85,
          )) ||
        (g.mothership &&
          circleHitsBox(
            probe.x,
            probe.y,
            probe.r,
            g.mothership.x,
            g.mothership.y,
            34,
            14,
          ));
    }
    if (burst) {
      g.bombs.splice(i, 1);
      burstBomb(g, bomb);
    }
  }
  // Droplets.
  const drag = Math.exp(-2.5 * dt);
  for (let i = g.droplets.length - 1; i >= 0; i--) {
    const d = g.droplets[i];
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    d.vx *= drag;
    d.vy *= drag;
    d.life -= dt;
    let used = d.life <= 0;
    if (!used) used = hitTargets(g, { x: d.x, y: d.y, r: 4 }, 2, 2, true);
    if (used) g.droplets.splice(i, 1);
  }
}

/** @param {any} g @param {{x:number,y:number}} bomb */
function burstBomb(g, bomb) {
  const rng = g.sim.rng;
  const count = 40;
  for (let i = 0; i < count; i++) {
    const a = ((i + rng.float(0, 1)) / count) * Math.PI * 2;
    const sp = rng.float(160, 400);
    g.droplets.push({
      x: bomb.x,
      y: bomb.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: rng.float(0.4, 0.6),
    });
  }
  // Enemy bullets caught in the blast are turned around.
  for (const b of g.bullets) {
    if (b.friendly) continue;
    if (Math.hypot(b.x - bomb.x, b.y - bomb.y) > 110) continue;
    const sp = Math.max(Math.hypot(b.vx, b.vy) * 1.35, 280);
    b.vx = (b.x - bomb.x) * 2;
    b.vy = -Math.abs(b.vy) - 60;
    const l = Math.hypot(b.vx, b.vy) || 1;
    b.vx = (b.vx / l) * sp;
    b.vy = (b.vy / l) * sp;
    b.friendly = true;
    b.ricochet = true;
    b.r = 4;
    b.pierce = 2;
  }
  addHitStop(g, 0.12);
  addTrauma(g, 0.9);
  emit(g, "bombBurst", { x: bomb.x, y: bomb.y, radius: BOMB_RADIUS });
}

// --------------------------------------------------------- player damage ----

/** @param {any} g */
function checkShipHits(g) {
  const ship = g.ship;
  if (!ship.alive || ship.invuln > 0) return;
  for (const b of g.bullets) {
    if (b.friendly) continue;
    if (Math.hypot(b.x - ship.x, b.y - ship.y) <= b.r + SHIP_R) {
      hurtPlayer(g);
      return;
    }
  }
  for (const inv of g.invaders) {
    if (inv.mode !== "swoop") continue;
    if (circleHitsBox(ship.x, ship.y, SHIP_R, inv.x, inv.y, inv.w, inv.h)) {
      killInvader(g, inv, false, false);
      hurtPlayer(g);
      return;
    }
  }
}

/** Lose a life: shockwave, invulnerability, or death. @param {any} g */
function hurtPlayer(g, shockwave = true) {
  const ship = g.ship;
  g.lives--;
  g.combo = 0;
  g.comboTimer = 0;
  emit(g, "playerHit", { x: ship.x, y: ship.y });
  emit(g, "lifeLost", { lives: g.lives });
  addHitStop(g, 0.12);
  addTrauma(g, 0.75);
  if (shockwave) emit(g, "shockwave", { x: ship.x, y: ship.y });
  g.bullets = g.bullets.filter((b) => b.friendly);
  if (g.lives <= 0) {
    g.lives = 0;
    ship.alive = false;
    g.state = "dying";
    g.sim.dyingT = 1.1;
    return;
  }
  ship.invuln = LIMITS.invuln;
}

/** Invaders reaching the dock cost a life and get pushed back. @param {any} g */
function checkDock(g) {
  if (!g.ship.alive) return;
  const reached = g.invaders.some(
    (i) => i.mode === "formation" && isInDock(i.y),
  );
  if (!reached) return;
  g.formation.y -= 80;
  layoutFormation(g);
  if (g.ship.invuln > 0) return; // pushed back, but no double penalty
  hurtPlayer(g, false);
}

// ----------------------------------------------------------- wave clear ----

/** @param {any} g @param {number} dt */
function checkWaveClear(g, dt) {
  const s = g.sim;
  if (s.clearT < 0) {
    if (g.invaders.length === 0 && !g.boss) {
      s.clearT = LIMITS.clearTime;
      g.banner = {
        text: "WAVE CLEAR",
        t: 0,
        kind: "clear",
        dur: LIMITS.clearTime,
      };
      emit(g, "waveClear", { wave: g.wave });
    }
    return;
  }
  s.clearT -= dt;
  if (s.clearT <= 0) {
    g.wave++;
    startWave(g);
  }
}
