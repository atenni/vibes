// Bootstrap: fixed-timestep loop, screen state machine (title → play → paused
// → over), settings, storage, wake lock, visibility and sharing.

import { createGame, step } from "./game.mjs";
import { createRenderer } from "./render.mjs";
import { createInput } from "./input.mjs";
import { createAudio } from "./audio.mjs";
import { createHaptics } from "./haptics.mjs";

const DT = 1 / 120;
const MAX_FRAME = 0.1;
const OVER_DELAY = 1.3; // seconds of fireworks before the game-over card

// ---- storage ----------------------------------------------------------------

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`inkvaders:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`inkvaders:${key}`, JSON.stringify(value));
    } catch {
      // Private mode or full storage: the game still works.
    }
  },
};

const settings = { sound: true, haptics: true, ...store.get("settings", {}) };
const hintsDone = {
  steered: false,
  drew: false,
  bomb: false,
  ...store.get("hints", {}),
};
let best = Number(store.get("best", 0)) || 0;
const stats = { bestCombo: 0, bestWave: 0, ...store.get("stats", {}) };

// ---- elements ---------------------------------------------------------------

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const canvas = /** @type {HTMLCanvasElement} */ ($("game"));
const screens = { title: $("title"), paused: $("pause"), over: $("over") };

const renderer = createRenderer(canvas);
const audio = createAudio();
const haptics = createHaptics();
audio.enabled = settings.sound;
haptics.enabled = settings.haptics;

// ---- state ------------------------------------------------------------------

/** @type {"title"|"play"|"paused"|"over"} */
let mode = "title";
let game = createGame({ seed: 7 });
let demo = makeDemo();
let overTimer = 0;
let endedRun = false;
let acc = 0;
let last = performance.now();
let inkSpeed = 0;
/** @type {WakeLockSentinel | null} */ let wakeLock = null;

const input = createInput(canvas, renderer, {
  onGesture: () => audio.unlock(),
  onPointerDown: () => {
    if (mode === "title") {
      startGame();
      return true;
    }
    return false;
  },
});

// ---- settings UI ------------------------------------------------------------

function syncToggles() {
  for (const el of document.querySelectorAll("[data-toggle]")) {
    const key = /** @type {HTMLElement} */ (el).dataset.toggle;
    el.setAttribute("aria-pressed", String(settings[key]));
  }
}

for (const el of document.querySelectorAll("[data-toggle]")) {
  el.addEventListener("click", () => {
    const key = /** @type {HTMLElement} */ (el).dataset.toggle;
    settings[key] = !settings[key];
    if (key === "sound") audio.enabled = settings.sound;
    if (key === "haptics") {
      haptics.enabled = settings.haptics;
      haptics.tap();
    }
    audio.unlock();
    if (key === "sound" && settings.sound) audio.ui("tap");
    store.set("settings", settings);
    syncToggles();
  });
}
if (!haptics.supported) {
  for (const el of document.querySelectorAll('[data-toggle="haptics"]'))
    el.hidden = true;
}
syncToggles();

function show(which) {
  document.body.dataset.screen = which;
  for (const [name, el] of Object.entries(screens)) el.hidden = name !== which;
  $("pause-btn").hidden = which !== "play";
}

function refreshBest() {
  $("best-title").textContent = best.toLocaleString("en-AU");
}
refreshBest();

// ---- demo (title screen) -----------------------------------------------------

/** A scripted bot on the real engine: it steers, spots a bullet and inks it. */
function makeDemo() {
  const g = createGame({ seed: 11 + Math.floor(Math.random() * 90) });
  return { game: g, stroke: null, cooldown: 1.2, id: 9000, ghost: null, t: 0 };
}

function demoFrame(d, dt) {
  const g = d.game;
  d.t += dt;
  g.lives = 3; // the demo never dies
  if (g.state === "over" || g.wave > 1) {
    Object.assign(d, makeDemo());
    return step(d.game, dt, {});
  }
  const targetX = 180 + 120 * Math.sin(d.t * 0.8);
  const frame = {
    steerX: targetX,
    steerDx: 0,
    inkBegin: [],
    inkMove: [],
    inkEnd: [],
    bomb: false,
  };
  d.cooldown -= dt;

  const ghost = { steer: { x: targetX, y: 585, down: true }, ink: null };

  if (d.stroke) {
    const s = d.stroke;
    s.t += dt;
    const k = Math.min(1, s.t / 0.22);
    const upto = Math.floor(k * (s.pts.length - 1));
    while (s.i < upto) {
      s.i++;
      frame.inkMove.push({ id: d.id, ...s.pts[s.i] });
    }
    const p = s.pts[s.i];
    ghost.ink = { x: p.x, y: p.y, down: true };
    if (k >= 1 && s.t > 0.3) {
      frame.inkEnd.push({ id: d.id });
      d.stroke = null;
      d.cooldown = 1.6;
    }
  } else if (d.cooldown <= 0 && g.state === "playing") {
    // Find a bullet that will cross y=430 near the ship, and slash it.
    const b = g.bullets.find(
      (b) =>
        !b.friendly &&
        b.vy > 0 &&
        b.y > 250 &&
        b.y < 400 &&
        Math.abs(b.x - g.ship.x) < 110,
    );
    if (b) {
      const tHit = (430 - b.y) / b.vy;
      const cx = b.x + b.vx * tHit;
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        pts.push({ x: cx - 40 + i * 10, y: 430 + 22 - i * 5.5 });
      }
      d.id++;
      d.stroke = { pts, i: 0, t: 0 };
      frame.inkBegin.push({ id: d.id, ...pts[0] });
      ghost.ink = { x: pts[0].x, y: pts[0].y, down: true };
    }
  }
  if (!d.stroke && !ghost.ink && d.cooldown < 0.6) {
    ghost.ink = {
      x: 180 + 60 * Math.sin(d.t * 1.3),
      y: 360 + 18 * Math.sin(d.t * 2.1),
      down: false,
    };
  }
  d.ghost = ghost;
  return step(g, dt, frame);
}

// ---- game flow --------------------------------------------------------------

function startGame() {
  audio.unlock();
  audio.ui("start");
  game = createGame({ seed: (Math.random() * 2 ** 31) | 0 });
  game.hints.steered = hintsDone.steered;
  game.hints.drew = hintsDone.drew;
  renderer.reset();
  input.reset();
  input.enabled = true;
  endedRun = false;
  overTimer = 0;
  acc = 0;
  mode = "play";
  show("play");
  requestWakeLock();
  document.activeElement?.blur?.();
}

function pauseGame() {
  if (mode !== "play") return;
  mode = "paused";
  input.enabled = false;
  show("paused");
  audio.ui("pause");
  audio.suspend();
  releaseWakeLock();
}

function resumeGame() {
  if (mode !== "paused") return;
  mode = "play";
  input.enabled = true;
  last = performance.now();
  show("play");
  audio.resume();
  requestWakeLock();
}

function toTitle() {
  mode = "title";
  input.enabled = false;
  input.reset();
  demo = makeDemo();
  renderer.reset();
  show("title");
  refreshBest();
  releaseWakeLock();
  audio.resume();
}

function finishRun() {
  endedRun = true;
  const score = game.score;
  const isNewBest = score > best;
  if (isNewBest) {
    best = score;
    store.set("best", best);
  }
  stats.bestCombo = Math.max(stats.bestCombo, game.bestComboThisRun);
  stats.bestWave = Math.max(stats.bestWave, game.wave);
  store.set("stats", stats);
  $("over-score").textContent = score.toLocaleString("en-AU");
  $("over-wave").textContent = String(game.wave);
  $("over-combo").textContent =
    `×${Math.max(1, Math.min(8, game.bestComboThisRun))}`;
  $("over-best").textContent = best.toLocaleString("en-AU");
  $("new-best").hidden = !(isNewBest && score > 0);
  mode = "over";
  input.enabled = false;
  show("over");
  releaseWakeLock();
  refreshBest();
}

$("play-btn").addEventListener("click", () => {
  if (mode === "title") startGame();
});
$("pause-btn").addEventListener("click", pauseGame);
$("resume-btn").addEventListener("click", resumeGame);
$("restart-btn").addEventListener("click", startGame);
$("quit-btn").addEventListener("click", toTitle);
$("again-btn").addEventListener("click", startGame);
$("title-btn").addEventListener("click", toTitle);
$("pause").addEventListener("click", (e) => {
  if (e.target === $("pause")) resumeGame(); // tap the backdrop to resume
});

// ---- share ------------------------------------------------------------------

let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2200);
}

$("share-btn").addEventListener("click", async () => {
  const url = new URL("./", location.href).href;
  const text = `I scored ${game.score.toLocaleString("en-AU")} on wave ${game.wave} in Inkvaders (best combo ×${Math.max(1, game.bestComboThisRun)}). Draw ink, bounce bullets. Can you beat it?`;
  try {
    if (navigator.share) {
      await navigator.share({ title: "Inkvaders", text, url });
      return;
    }
  } catch (err) {
    if (err?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast("Copied to clipboard");
  } catch {
    toast("Couldn't share on this device");
  }
});

// ---- wake lock & visibility ---------------------------------------------------

async function requestWakeLock() {
  try {
    if (!("wakeLock" in navigator) || wakeLock || document.hidden) return;
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {
    wakeLock = null; // denied (e.g. low battery); not essential
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    pauseGame();
    audio.suspend();
  } else {
    last = performance.now();
    if (mode !== "paused") audio.resume();
  }
});
window.addEventListener("blur", pauseGame);

// ---- keyboard ----------------------------------------------------------------

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "KeyM") {
    settings.sound = !settings.sound;
    audio.enabled = settings.sound;
    store.set("settings", settings);
    syncToggles();
    toast(settings.sound ? "Sound on" : "Sound off");
  } else if (e.code === "KeyP" || e.code === "Escape") {
    if (mode === "play") pauseGame();
    else if (mode === "paused") resumeGame();
  } else if (e.code === "Enter" || (e.code === "Space" && mode !== "play")) {
    if (document.activeElement instanceof HTMLButtonElement) return; // let the button act
    if (mode === "title" || mode === "over") {
      e.preventDefault();
      startGame();
    } else if (mode === "paused") {
      e.preventDefault();
      resumeGame();
    }
  }
});

// ---- loop -------------------------------------------------------------------

function handleEvents(g, events, live) {
  if (events.length === 0) return;
  renderer.handleEvents(g, events);
  if (!live) return;
  audio.handle(events);
  haptics.handle(events);
  for (const e of events) {
    if (e.type === "bombFired") {
      hintsDone.bomb = true;
      store.set("hints", hintsDone);
    } else if (e.type === "gameOver") {
      overTimer = OVER_DELAY;
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(MAX_FRAME, (now - last) / 1000);
  last = now;

  if (mode === "play" || mode === "over") {
    acc += real;
    let steps = 0;
    while (acc >= DT && steps < 40) {
      acc -= DT;
      steps++;
      const events = step(game, DT, mode === "play" ? input.frame() : {});
      handleEvents(game, events, true);
      if (game.hints.steered && !hintsDone.steered) {
        hintsDone.steered = true;
        store.set("hints", hintsDone);
      }
      if (game.hints.drew && !hintsDone.drew) {
        hintsDone.drew = true;
        store.set("hints", hintsDone);
      }
    }
    if (steps === 40) acc = 0;
    if (mode === "play" && game.state === "over") {
      overTimer -= real;
      if (overTimer <= 0 && !endedRun) finishRun();
    }
    inkSpeed +=
      (input.takeInkDistance() / Math.max(real, 0.001) - inkSpeed) * 0.5;
    renderer.update(real, game, { mode: "play" });
    audio.update(inkSpeed, Boolean(game.mothership), mode === "play");
  } else if (mode === "title") {
    acc += real;
    let steps = 0;
    while (acc >= DT && steps < 40) {
      acc -= DT;
      steps++;
      handleEvents(demo.game, demoFrame(demo, DT), false);
    }
    if (steps === 40) acc = 0;
    renderer.update(real, demo.game, { mode: "title" });
    audio.update(0, false, false);
  } else {
    renderer.update(0, game, { mode: "paused" });
    audio.update(0, false, false);
  }

  const shown = mode === "title" ? demo.game : game;
  renderer.draw(shown, {
    mode:
      mode === "paused"
        ? "paused"
        : mode === "title"
          ? "title"
          : mode === "over"
            ? "over"
            : "play",
    touches: mode === "play" ? input.touches() : [],
    ghost: mode === "title" ? demo.ghost : null,
    hintBomb: !hintsDone.bomb && game.wave >= 2,
  });
}

function resize() {
  renderer.resize();
}
window.addEventListener("resize", resize);
window.addEventListener("orientationchange", resize);
resize();
show("title");
requestAnimationFrame((now) => {
  last = now;
  frame(now);
});

// Handy for debugging and automated tests; read-only in spirit.
globalThis.__inkvaders = {
  get game() {
    return game;
  },
  get mode() {
    return mode;
  },
};
