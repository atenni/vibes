// Wiring: settings, buttons, the rAF loop and accessibility status.

import { createDisplay } from "./display.mjs";
import { createMic } from "./mic.mjs";
import {
  MODES,
  MODE_LED,
  REFERENCE_DEFAULT,
  REFERENCE_MAX,
  REFERENCE_MIN,
} from "./notes.mjs";
import { detectPitch } from "./pitch.mjs";
import { createTuner } from "./tuner.mjs";

/** MODE cycle order, per the TU-2 manual. */
const MODE_ORDER = [
  "chromatic",
  "guitar",
  "guitar-flat",
  "guitar-double-flat",
  "bass-double-flat",
  "bass-flat",
  "bass",
];

const STORAGE_KEY = "tu-2:settings";
const FLASH_MS = 1200;
const ERROR_MS = 5000;
const HOLD_MS = 500;
const REPEAT_MS = 400;
/** Keep rendering after switching off so the LEDs fade rather than snap. */
const FADE_MS = 300;

const $ = (selector) => document.querySelector(selector);
const pedal = $("#pedal");
const stomp = $("#stomp");
const hint = $("#hint");
const readout = $("#readout");
const note = $("#note");
const status = $("#status");

const demo = new URLSearchParams(location.search).has("demo");
const mic = createMic({ demo });
const tuner = createTuner();
const display = createDisplay(pedal);

/** @typedef {{ mode: string, reference: number, style: "stream" | "cent" }} Settings */

/** @returns {Settings} */
function loadSettings() {
  const settings = {
    mode: "chromatic",
    reference: REFERENCE_DEFAULT,
    style: "stream",
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (MODES.some((m) => m.id === saved.mode)) settings.mode = saved.mode;
    if (saved.reference >= REFERENCE_MIN && saved.reference <= REFERENCE_MAX) {
      settings.reference = Math.round(saved.reference);
    }
    if (saved.style === "cent" || saved.style === "stream")
      settings.style = saved.style;
  } catch {
    // Corrupt or unavailable storage: use defaults.
  }
  return settings;
}

const settings = loadSettings();
const save = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode: settings simply won't persist.
  }
};

let listening = false;
let starting = false;
let raf = 0;
/** Keep the display lit until this time (flashes while the pedal is off). */
let litUntil = 0;
let checkBlinkUntil = 0;
let lastAnnounce = 0;
let lastAnnouncement = "";

const modeOf = () => MODES.find((m) => m.id === settings.mode) ?? MODES[0];

function updateReadout() {
  readout.textContent = `A=${settings.reference}Hz · ${modeOf().name}`;
}

function setNote(text) {
  note.textContent = text ?? "";
  note.hidden = !text;
}

function setPower(on) {
  listening = on;
  pedal.dataset.power = on ? "on" : "off";
  stomp.setAttribute("aria-pressed", String(on));
  hint.textContent = on ? "Tap to stop" : "Tap to tune";
}

const hood = $("#hood");
let released = 0;

/** Rotate the hood down about its hinge. */
function press() {
  clearTimeout(released);
  hood.classList.add("down");
}

/** Let the spring push it back up (CSS handles the overshoot). */
function release() {
  hood.classList.remove("down");
}

/** Toggle the tuner; the press itself is drawn by press() / release(). */
function toggle() {
  navigator.vibrate?.(12);
  if (listening) stopListening();
  else startListening();
}

/** Show a transient glyph on the 7-segment display, even when off. */
function flash(glyph, indicators, ms = FLASH_MS) {
  const now = performance.now();
  tuner.flash(glyph, indicators, ms, now);
  litUntil = Math.max(litUntil, now + ms);
  run();
}

function run() {
  if (!raf) raf = requestAnimationFrame(frame);
}

function frame() {
  raf = 0;
  const now = performance.now();

  let detection = null;
  if (listening) {
    const samples = mic.read();
    if (samples) detection = detectPitch(samples, mic.sampleRate);
  }
  const state = tuner.update({
    now,
    detection,
    mode: settings.mode,
    reference: settings.reference,
    style: settings.style,
  });
  const lit = listening || now < litUntil;
  const check =
    listening && (now > checkBlinkUntil || Math.floor(now / 150) % 2 === 0);
  display.render(state, { on: lit, check });
  if (listening) announce(state, now);

  if (listening || now < litUntil + FADE_MS || now < checkBlinkUntil) run();
}

/** Screen reader status: at most once a second, only when it changes. */
function announce(state, now) {
  if (now - lastAnnounce < 1000) return;
  let text = "";
  if (state.status !== "idle" && state.note) {
    const where = state.inTune
      ? "in tune"
      : state.cents == null
        ? ""
        : state.cents < 0
          ? "flat"
          : "sharp";
    text = state.string ? `String ${state.string}, ${state.note}` : state.note;
    if (where) text += `, ${where}`;
  }
  if (text && text !== lastAnnouncement) {
    lastAnnouncement = text;
    lastAnnounce = now;
    status.textContent = text;
  }
}

const ERRORS = {
  NotAllowedError:
    "Microphone access is blocked. Allow the microphone for this site in your browser settings, then tap the pedal again.",
  NotFoundError:
    "No microphone found. Plug one in or check your device settings, then tap the pedal again.",
  NotSupportedError:
    "This page can't use the microphone. Open it over HTTPS (or localhost) in a current browser.",
};

async function startListening() {
  if (starting) return;
  starting = true;
  setNote("");
  setPower(true);
  try {
    await mic.start();
    tuner.update({
      now: performance.now(),
      detection: null,
      mode: settings.mode,
      reference: settings.reference,
      style: settings.style,
    });
    run();
  } catch (error) {
    setPower(false);
    setNote(
      ERRORS[error?.name] ?? "Couldn't start the microphone. Please try again.",
    );
    flash("E", {}, ERROR_MS);
  } finally {
    starting = false;
  }
}

function stopListening() {
  mic.stop();
  setPower(false);
  status.textContent = "";
  lastAnnouncement = "";
  run();
}

// Pointer: dip on press, toggle and spring back on release. Same on desktop and iOS.
let pointerId = -1;
stomp.addEventListener("pointerdown", (event) => {
  if (event.button > 0 || pointerId !== -1) return;
  pointerId = event.pointerId;
  stomp.setPointerCapture(pointerId);
  press();
});
stomp.addEventListener("pointerup", (event) => {
  if (event.pointerId !== pointerId) return;
  pointerId = -1;
  release();
  toggle();
});
stomp.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== pointerId) return;
  pointerId = -1;
  release();
});
stomp.addEventListener("contextmenu", (event) => event.preventDefault());

// Keyboard (and assistive tech) clicks have detail 0: play the same press.
stomp.addEventListener("click", (event) => {
  if (event.detail !== 0) return;
  press();
  released = setTimeout(release, 110);
  toggle();
});

// Space/Enter on the focused pedal already clicks it; make it work anywhere
// else on the page too, on desktop.
document.addEventListener("keydown", (event) => {
  if (event.repeat || event.target instanceof HTMLButtonElement) return;
  if (event.code === "Space" || event.code === "Enter") {
    event.preventDefault();
    stomp.click();
  }
});

/**
 * Tap runs `onTap`; holding for HOLD_MS runs `onHold`, then repeats it.
 * A short tap never calls `onHold`, and a long press never taps.
 * @param {HTMLElement} button
 * @param {() => void} onTap
 * @param {() => void} onHold
 */
function pressKey(button, onTap, onHold) {
  let timer = 0;
  let held = false;
  const clear = () => clearTimeout(timer);
  const repeat = () => {
    held = true;
    onHold();
    timer = setTimeout(repeat, REPEAT_MS);
  };
  button.addEventListener("pointerdown", () => {
    held = false;
    clear();
    timer = setTimeout(repeat, HOLD_MS);
  });
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
    button.addEventListener(type, clear);
  }
  button.addEventListener("click", () => {
    // Keyboard clicks have detail 0 and never hold; pointer clicks after a hold are swallowed.
    if (held) {
      held = false;
      return;
    }
    onTap();
  });
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

function nudgePitch(step) {
  const next = Math.min(
    REFERENCE_MAX,
    Math.max(REFERENCE_MIN, settings.reference + step),
  );
  if (next === settings.reference) return;
  settings.reference = next;
  save();
  updateReadout();
  checkBlinkUntil = performance.now() + FLASH_MS;
  flash(String(next % 10), {});
}

pressKey(
  $("#mode-btn"),
  () => {
    // The pedal's order: right to left along the arc, then back to CHROMATIC.
    const ids = MODE_ORDER;
    const next = MODES.find(
      (m) => m.id === ids[(ids.indexOf(modeOf().id) + 1) % ids.length],
    );
    settings.mode = next.id;
    save();
    updateReadout();
    flash(next.code, { leds: [MODE_LED[next.id]] });
  },
  () => nudgePitch(1),
);

pressKey(
  $("#style-btn"),
  () => {
    settings.style = settings.style === "stream" ? "cent" : "stream";
    save();
    // Like the pedal, the meter shows the chosen style for about two seconds:
    // a frozen stream of pairs, or the single centre LED.
    flash(
      " ",
      { leds: settings.style === "stream" ? [0, 1, 6, 7] : [5] },
      2000,
    );
  },
  () => nudgePitch(-1),
);

// iOS stops the mic when the page is hidden; make the pedal match.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && listening) stopListening();
});
addEventListener("pagehide", () => {
  if (listening) stopListening();
});

updateReadout();
setPower(false);
run();
