// Pointer and keyboard input → InputFrame (see game.mjs). DOM-bound.
//
// Each pointer is classified once, on pointerdown, by where it starts:
//   steer — in the dock (or the letterbox below the playfield)
//   ink   — anywhere above it
// and keeps that role until it lifts. Coordinates are converted to playfield
// units with the renderer's inverse transform.

import { FIELD } from "./game.mjs";

const FLICK_SPEED = 600; // units/s, upwards
const FLICK_MIN_RISE = 36; // units
const FLICK_WINDOW = 0.14; // seconds of history to look at
const FLICK_COOLDOWN = 0.5;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ toField: (x: number, y: number) => {x: number, y: number} }} view
 * @param {{ onGesture?: () => void, onPointerDown?: (e: PointerEvent) => boolean | void }} [hooks]
 *   `onPointerDown` may return true to say it consumed the pointer (e.g. the
 *   title screen starting a game), so it is not tracked.
 */
export function createInput(canvas, view, hooks = {}) {
  /** @type {Map<number, { role: "steer"|"ink", x: number, y: number, sx: number, sy: number, samples: Array<{t:number,y:number}> }>} */
  const pointers = new Map();

  let enabled = false;
  let hoverX = /** @type {number | null} */ (null);
  let keyAxis = 0;
  const keys = new Set();
  let bombQueued = false;
  let lastFlick = -1;
  let inkDistance = 0;

  /** @type {Array<{id:number,x:number,y:number}>} */ let inkBegin = [];
  /** @type {Array<{id:number,x:number,y:number}>} */ let inkMove = [];
  /** @type {Array<{id:number}>} */ let inkEnd = [];

  const field = (e) => {
    const p = view.toField(e.clientX, e.clientY);
    return { x: clamp(p.x, 0, FIELD.w), y: p.y };
  };
  const inkPoint = (p) => ({ x: p.x, y: clamp(p.y, 0, FIELD.dockY) });
  const now = () => performance.now() / 1000;

  function down(e) {
    hooks.onGesture?.();
    if (hooks.onPointerDown?.(e)) {
      e.preventDefault();
      return;
    }
    if (!enabled) return;
    e.preventDefault();
    const p = field(e);
    const role = p.y >= FIELD.dockY ? "steer" : "ink";
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer may already be gone; carry on.
    }
    pointers.set(e.pointerId, {
      role,
      x: p.x,
      y: p.y,
      sx: p.x,
      sy: p.y,
      samples: [{ t: now(), y: p.y }],
    });
    if (role === "ink") inkBegin.push({ id: e.pointerId, ...inkPoint(p) });
  }

  function move(e) {
    const st = pointers.get(e.pointerId);
    if (!st) {
      // Mouse hover in the dock steers without a click.
      if (enabled && e.pointerType === "mouse" && e.buttons === 0) {
        const p = field(e);
        if (p.y >= FIELD.dockY) hoverX = p.x;
      }
      return;
    }
    e.preventDefault();
    if (st.role === "steer") {
      const p = field(e);
      st.x = p.x;
      st.y = p.y;
      const t = now();
      st.samples.push({ t, y: p.y });
      while (st.samples.length > 2 && t - st.samples[0].t > FLICK_WINDOW * 2)
        st.samples.shift();
      detectFlick(st, t);
    } else {
      const events = e.getCoalescedEvents?.();
      const list = events && events.length ? events : [e];
      let last = { x: st.x, y: st.y };
      for (const ce of list) {
        const p = field(ce);
        inkMove.push({ id: e.pointerId, ...inkPoint(p) });
        inkDistance += Math.hypot(p.x - last.x, p.y - last.y);
        last = p;
      }
      st.x = last.x;
      st.y = last.y;
    }
  }

  function detectFlick(st, t) {
    if (t - lastFlick < FLICK_COOLDOWN) return;
    const recent = st.samples.filter((s) => t - s.t <= FLICK_WINDOW);
    if (recent.length < 2) return;
    const a = recent[0];
    const b = recent[recent.length - 1];
    const dt = b.t - a.t;
    const rise = a.y - b.y;
    if (dt > 0.005 && rise >= FLICK_MIN_RISE && rise / dt >= FLICK_SPEED) {
      bombQueued = true;
      lastFlick = t;
    }
  }

  function up(e) {
    const st = pointers.get(e.pointerId);
    if (!st) return;
    pointers.delete(e.pointerId);
    if (st.role === "ink") inkEnd.push({ id: e.pointerId });
    if (canvas.hasPointerCapture?.(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
  }

  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("lostpointercapture", up);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // Belts and braces on iOS: stop gestures and double-tap zoom.
  for (const type of ["gesturestart", "gesturechange", "dblclick"]) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  document.addEventListener("touchmove", (e) => e.preventDefault(), {
    passive: false,
  });

  const AXIS = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 };

  function keyDown(e) {
    if (e.repeat && !(e.code in AXIS)) return;
    if (e.code in AXIS) {
      if (!enabled) return;
      keys.add(e.code);
      keyAxis = [...keys].reduce((sum, k) => sum + AXIS[k], 0);
      e.preventDefault();
    } else if ((e.code === "Space" || e.code === "KeyB") && enabled) {
      bombQueued = true;
      e.preventDefault();
    }
  }
  function keyUp(e) {
    if (!(e.code in AXIS)) return;
    keys.delete(e.code);
    keyAxis = [...keys].reduce((sum, k) => sum + AXIS[k], 0);
  }
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);

  function clear() {
    for (const [id, st] of pointers) {
      if (st.role === "ink") inkEnd.push({ id });
    }
    pointers.clear();
    keys.clear();
    keyAxis = 0;
    bombQueued = false;
  }

  return {
    /** Only track gameplay pointers while enabled. Disabling lifts everything. */
    set enabled(value) {
      if (enabled && !value) clear();
      enabled = value;
    },
    get enabled() {
      return enabled;
    },
    /** Forget all queued ink and held pointers (new game). */
    reset() {
      clear();
      inkBegin = [];
      inkMove = [];
      inkEnd = [];
      hoverX = null;
    },

    /** Build the InputFrame for one fixed step, draining queued ink events. */
    frame() {
      let steerX = null;
      for (const st of pointers.values())
        if (st.role === "steer") steerX = st.x;
      if (steerX === null) steerX = hoverX;
      const f = {
        steerX,
        steerDx: keyAxis,
        inkBegin,
        inkMove,
        inkEnd,
        bomb: bombQueued,
      };
      inkBegin = [];
      inkMove = [];
      inkEnd = [];
      bombQueued = false;
      return f;
    },

    /** Ink path length (units) since the last call; for the drawing hiss. */
    takeInkDistance() {
      const d = inkDistance;
      inkDistance = 0;
      return d;
    },

    /** Active pointers in screen-independent playfield units, for overlays. */
    touches() {
      return [...pointers.values()].map((p) => ({
        role: p.role,
        x: p.x,
        y: p.y,
      }));
    },
  };
}
