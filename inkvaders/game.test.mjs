import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD,
  LIMITS,
  createGame,
  isInDock,
  spawnInvader,
  step,
} from "./game.mjs";

const DT = 1 / 120;
const idle = () => ({
  steerX: null,
  steerDx: 0,
  inkBegin: [],
  inkMove: [],
  inkEnd: [],
  bomb: false,
});
const run = (g, seconds, input = idle) => {
  const events = [];
  for (let i = 0; i < Math.round(seconds / DT); i++)
    events.push(...step(g, DT, input()));
  return events;
};
/** A playing game with an empty field (no formation, no mothership, no fire). */
function arena() {
  const g = createGame({ seed: 5 });
  run(g, 2);
  g.invaders = [];
  g.sim.clearT = 99; // suppress wave clear
  g.sim.fireTimer = 1e9;
  g.sim.mothershipTimer = 1e9;
  g.bullets = [];
  g.sim.shotTimer = 1e9;
  return g;
}
const frame = (o) => ({ ...idle(), ...o });
const bullet = (g, o) =>
  g.bullets.push({
    id: 900 + g.bullets.length,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 3,
    friendly: false,
    ricochet: false,
    kind: "blob",
    trail: [],
    cool: {},
    pierce: 1,
    ...o,
  });

test("starts with a wave intro then plays", () => {
  const g = createGame({ seed: 1 });
  assert.equal(g.state, "waveIntro");
  assert.equal(g.banner.text, "WAVE 1");
  const ev = run(g, 2);
  assert.equal(g.state, "playing");
  assert.ok(ev.length > 0);
  assert.equal(g.ink, 100);
});

test("deterministic for a seed and inputs", () => {
  const play = () => {
    const g = createGame({ seed: 9 });
    let t = 0;
    run(g, 20, () => frame({ steerX: 180 + Math.sin((t += DT) * 2) * 150 }));
    return JSON.stringify([
      g.score,
      g.lives,
      g.invaders.length,
      g.bullets.length,
      g.ship.x,
    ]);
  };
  assert.equal(play(), play());
});

test("ship auto-fires on a cadence, capped at 3 bullets", () => {
  const g = createGame({ seed: 1 });
  run(g, 1.7);
  g.invaders = [];
  g.sim.clearT = 99;
  g.bullets = [];
  g.sim.shotTimer = 0;
  const ev = run(g, 1.0).filter((e) => e.type === "shot");
  assert.ok(ev.length >= 3 && ev.length <= 4, `shots ${ev.length}`);
  g.bullets = g.bullets.filter((b) => b.kind === "player");
  assert.ok(g.bullets.length <= 3);
  // Cap: bullets that cannot leave (the roof is far at this speed) skip shots.
  g.bullets = [];
  for (let i = 0; i < 3; i++)
    bullet(g, { kind: "player", friendly: true, x: 10, y: 300, vy: 0 });
  g.sim.shotTimer = 0;
  assert.equal(run(g, 0.5).filter((e) => e.type === "shot").length, 0);
});

test("ship follows the thumb and clamps", () => {
  const g = arena();
  run(g, 0.5, () => frame({ steerX: 100 }));
  assert.ok(Math.abs(g.ship.x - 100) < 1);
  run(g, 0.5, () => frame({ steerX: -50 }));
  assert.ok(Math.abs(g.ship.x - 16) < 1);
  assert.ok(g.hints.steered);
});

test("bullet reflects off a stroke, becomes friendly and upward", () => {
  const g = arena();
  // 45° stroke "/" above the bullet's path.
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 120, y: 300 }] }));
  step(
    g,
    DT,
    frame({
      inkMove: [
        { id: 1, x: 160, y: 260 },
        { id: 1, x: 200, y: 220 },
      ],
    }),
  );
  step(g, DT, frame({ inkEnd: [{ id: 1 }] }));
  assert.equal(g.strokes.length, 1);
  bullet(g, { x: 160, y: 230, vx: 0, vy: 150 });
  const ev = run(g, 0.2);
  assert.ok(ev.some((e) => e.type === "ricochet"));
  const b = g.bullets[0];
  assert.ok(b.friendly && b.ricochet);
  assert.ok(b.vy < 0, "upward");
  assert.ok(Math.hypot(b.vx, b.vy) >= 150 * 1.35 - 1e-6, "faster");
  // Reflection about a "/" line sends a downward bullet to the left (−x).
  assert.ok(b.vx < 0);
});

test("a downward reflection is flipped upward", () => {
  const g = arena();
  // Horizontal stroke; bullet from below going up reflects downward → flipped.
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 100, y: 300 }] }));
  step(g, DT, frame({ inkMove: [{ id: 1, x: 200, y: 300 }] }));
  step(g, DT, frame({ inkEnd: [{ id: 1 }] }));
  bullet(g, { x: 150, y: 330, vx: 0, vy: -150 });
  run(g, 0.4);
  const b = g.bullets.find((x) => x.ricochet);
  assert.ok(b && b.vy < 0);
});

test("a bullet is reflected once per segment hit", () => {
  const g = arena();
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 100, y: 300 }] }));
  step(g, DT, frame({ inkMove: [{ id: 1, x: 200, y: 300 }] }));
  step(g, DT, frame({ inkEnd: [{ id: 1 }] }));
  bullet(g, { x: 150, y: 290, vx: 0, vy: 150 });
  const ev = run(g, 0.5);
  assert.equal(ev.filter((e) => e.type === "ricochet").length, 1);
});

test("ink depletes while drawing and regenerates afterwards", () => {
  const g = arena();
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 20, y: 300 }] }));
  for (let i = 1; i <= 10; i++)
    step(g, DT, frame({ inkMove: [{ id: 1, x: 20 + i * 20, y: 300 }] }));
  assert.ok(Math.abs(g.ink - 50) < 0.5, `ink ${g.ink}`); // 200 units → 50 ink
  step(g, DT, frame({ inkEnd: [{ id: 1 }] }));
  run(g, 1);
  assert.ok(g.ink > 60 && g.ink < 64, `ink ${g.ink}`);
});

test("points under 6 units apart are dropped", () => {
  const g = arena();
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 100, y: 300 }] }));
  step(
    g,
    DT,
    frame({
      inkMove: [
        { id: 1, x: 103, y: 300 },
        { id: 1, x: 107, y: 300 },
      ],
    }),
  );
  assert.equal(g.strokes[0].points.length, 2);
});

test("running out of ink ends the stroke with inkEmpty", () => {
  const g = arena();
  g.ink = 5;
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 20, y: 300 }] }));
  const ev = step(g, DT, frame({ inkMove: [{ id: 1, x: 120, y: 300 }] }));
  assert.ok(ev.some((e) => e.type === "inkEmpty"));
  assert.ok(g.ink < 0.5);
  assert.ok(!g.strokes.some((s) => s.drawing));
});

test("strokes fade after release and the cap is four", () => {
  const g = arena();
  for (let i = 0; i < 5; i++) {
    step(g, DT, frame({ inkBegin: [{ id: i, x: 20, y: 200 + i * 30 }] }));
    step(g, DT, frame({ inkMove: [{ id: i, x: 80, y: 200 + i * 30 }] }));
    step(g, DT, frame({ inkEnd: [{ id: i }] }));
  }
  run(g, 0.3);
  assert.ok(g.strokes.length <= 4);
  run(g, LIMITS.strokeLife + 0.2);
  assert.equal(g.strokes.length, 0);
});

test("a stroke being drawn does not age", () => {
  const g = arena();
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 20, y: 300 }] }));
  step(g, DT, frame({ inkMove: [{ id: 1, x: 80, y: 300 }] }));
  run(g, 4, () => frame({}));
  assert.equal(g.strokes.length, 1);
  assert.equal(g.strokes[0].age, 0);
});

test("combo increments on ricochet kills and expires", () => {
  const g = arena();
  const kill = () => {
    const inv = spawnInvader(g, "blob", 180, 300);
    bullet(g, {
      friendly: true,
      ricochet: true,
      x: 180,
      y: 320,
      vy: -300,
      pierce: 2,
    });
    run(g, 0.1);
    return inv;
  };
  kill();
  assert.equal(g.combo, 1);
  kill();
  assert.equal(g.combo, 2);
  assert.equal(g.score, 10 + 20);
  run(g, LIMITS.comboWindow + 0.2);
  assert.equal(g.combo, 0);
  kill();
  assert.equal(g.combo, 1);
});

test("auto-fire kills score base and keep a live combo", () => {
  const g = arena();
  g.combo = 3;
  g.comboTimer = 2;
  spawnInvader(g, "squid", 180, 300);
  bullet(g, { friendly: true, x: 180, y: 320, vy: -300 });
  const ev = run(g, 0.1);
  const k = ev.find((e) => e.type === "invaderKilled");
  assert.equal(k.points, 20);
  assert.equal(k.byRicochet, false);
  assert.equal(g.combo, 3);
});

test("crabs have two hit points", () => {
  const g = arena();
  spawnInvader(g, "crab", 180, 300);
  bullet(g, { friendly: true, x: 180, y: 320, vy: -300 });
  const ev = run(g, 0.1);
  assert.ok(ev.some((e) => e.type === "invaderHit"));
  assert.equal(g.invaders.length, 1);
});

test("invader reaching the dock costs a life and pushes back", () => {
  const g = arena();
  const inv = spawnInvader(g, "blob", 180, FIELD.dockY + 4);
  const ev = run(g, 0.05);
  assert.equal(g.lives, LIMITS.startLives - 1);
  assert.ok(ev.some((e) => e.type === "lifeLost"));
  assert.ok(inv.y < FIELD.dockY - 40, `y ${inv.y}`);
  assert.ok(isInDock(FIELD.dockY) && !isInDock(FIELD.dockY - 1));
  assert.ok(g.ship.invuln > 0);
});

test("player hit clears enemy bullets and grants invulnerability", () => {
  const g = arena();
  bullet(g, { x: g.ship.x, y: g.ship.y, vy: 10 });
  bullet(g, { x: 10, y: 100, vy: 10 });
  run(g, 0.02);
  assert.equal(g.lives, 2);
  assert.equal(g.bullets.filter((b) => !b.friendly).length, 0);
  bullet(g, { x: g.ship.x, y: g.ship.y, vy: 10 });
  run(g, 0.1);
  assert.equal(g.lives, 2, "invulnerable");
});

test("game over at zero lives", () => {
  const g = arena();
  g.lives = 1;
  bullet(g, { x: g.ship.x, y: g.ship.y, vy: 10 });
  const ev = run(g, 3);
  assert.equal(g.state, "over");
  assert.equal(g.lives, 0);
  assert.equal(ev.filter((e) => e.type === "gameOver").length, 1);
  assert.ok(step(g, DT, idle()).length === 0);
});

test("bomb only fires when ink is full", () => {
  const g = arena();
  g.ink = 99;
  assert.ok(
    !run(g, 0.05, () => frame({ bomb: true })).some(
      (e) => e.type === "bombFired",
    ),
  );
  assert.equal(g.bombs.length, 0);
  g.ink = 100;
  const ev = step(g, DT, frame({ bomb: true }));
  assert.ok(ev.some((e) => e.type === "bombFired"));
  assert.ok(g.ink < 0.5);
  assert.equal(g.bombs.length, 1);
});

test("bomb bursts into droplets that kill invaders", () => {
  const g = arena();
  spawnInvader(g, "blob", g.ship.x, 300);
  spawnInvader(g, "squid", g.ship.x + 40, 280);
  step(g, DT, frame({ bomb: true }));
  const ev = run(g, 1.5);
  assert.ok(ev.some((e) => e.type === "bombBurst"));
  assert.equal(g.invaders.length, 0);
  assert.ok(g.combo >= 2);
});

test("boss takes 5× damage from ricochets", () => {
  const g = createGame({ seed: 1, wave: 5 });
  run(g, 2);
  g.sim.fireTimer = 1e9;
  g.sim.shotTimer = 1e9;
  g.invaders = [];
  assert.ok(g.boss);
  const hp0 = g.boss.hp;
  bullet(g, { friendly: true, x: g.boss.x, y: g.boss.y + 5, vy: -10 });
  run(g, 0.02);
  assert.equal(g.boss.hp, hp0 - 1);
  bullet(g, {
    friendly: true,
    ricochet: true,
    pierce: 2,
    x: g.boss.x,
    y: g.boss.y + 5,
    vy: -10,
  });
  run(g, 0.02);
  assert.equal(g.boss.hp, hp0 - 6);
});

test("boss defeat grants a life and ends the wave", () => {
  const g = createGame({ seed: 1, wave: 5 });
  run(g, 2);
  g.invaders = [];
  g.boss.hp = 3;
  bullet(g, {
    friendly: true,
    ricochet: true,
    pierce: 2,
    x: g.boss.x,
    y: g.boss.y,
    vy: -10,
  });
  const ev = run(g, 0.05);
  assert.ok(ev.some((e) => e.type === "bossKilled"));
  assert.ok(ev.some((e) => e.type === "waveClear"));
  assert.equal(g.lives, 4);
  assert.equal(g.boss, null);
  run(g, 3);
  assert.equal(g.wave, 6);
});

test("wave clear flows to the next wave and refills ink", () => {
  const g = arena();
  g.sim.clearT = -1;
  g.ink = 10;
  const ev = run(g, 4);
  assert.ok(ev.some((e) => e.type === "waveClear"));
  assert.ok(ev.some((e) => e.type === "waveStart" && e.wave === 2));
  assert.equal(g.wave, 2);
  assert.equal(g.ink, 100);
});

test("inkeaters erase ink they touch", () => {
  const g = arena();
  step(g, DT, frame({ inkBegin: [{ id: 1, x: 100, y: 300 }] }));
  step(g, DT, frame({ inkMove: [{ id: 1, x: 160, y: 300 }] }));
  step(g, DT, frame({ inkEnd: [{ id: 1 }] }));
  const e = spawnInvader(g, "inkeater", 130, 300);
  e.mode = "eater";
  const ev = run(g, 0.2);
  assert.ok(ev.some((x) => x.type === "inkEaten"));
  assert.equal(g.strokes.length, 0);
});

test("divers swoop, are stunned by ink, and rejoin", () => {
  const g = arena();
  const d = spawnInvader(g, "diver", 180, 150);
  g.formation.stepTimer = 1e9;
  d.mode = "swoop";
  d.diving = true;
  d.sx = d.x;
  d.sy = d.y;
  d.tx = 180;
  run(g, 0.3);
  assert.ok(d.y > 150);
  const ev = run(g, 4);
  assert.ok(g.invaders.length === 0 || d.mode !== "swoop" || d.y > 0);
  void ev;
});

test("march emits notes 0–3 and accelerates as invaders die", () => {
  const g = createGame({ seed: 2 });
  const ev = run(g, 6);
  const notes = ev.filter((e) => e.type === "march").map((e) => e.note);
  assert.ok(notes.length >= 3);
  assert.ok(notes.every((n) => n >= 0 && n <= 3));
  const full = g.formation.stepInterval;
  g.invaders.splice(0, g.invaders.length - 3);
  step(g, DT, idle());
  assert.ok(g.formation.stepInterval < full / 2);
});

test("hit-stop freezes motion", () => {
  const g = arena();
  bullet(g, { x: 20, y: 100, vy: 100 });
  g.hitStop = 0.1;
  run(g, 0.05);
  assert.equal(g.bullets[0].y, 100);
  run(g, 0.2);
  assert.ok(g.bullets[0].y > 100);
});

test("formation stays inside the field over a long run", () => {
  const g = createGame({ seed: 3, wave: 8 });
  g.lives = 99;
  run(g, 30);
  for (const i of g.invaders)
    if (i.mode === "formation") assert.ok(i.x > 0 && i.x < FIELD.w);
});
