// DOM renderer for the LED arc, tuning triangles, 7-segment digit and CHECK LED.
// Only touches the DOM when a (rounded) value changes.

import { glyph } from "./segments.mjs";

const SVG = "http://www.w3.org/2000/svg";
const LED_COUNT = 11;
const SEGMENTS = ["a", "b", "c", "d", "e", "f", "g"];

/** Hexagon points for a horizontal segment centred on y, tips at x1 and x2. */
function horizontal(x1, x2, y) {
  const h = 6;
  return `${x1},${y} ${x1 + h},${y - h} ${x2 - h},${y - h} ${x2},${y} ${x2 - h},${y + h} ${x1 + h},${y + h}`;
}

/** Hexagon points for a vertical segment centred on x, tips at y1 and y2. */
function vertical(x, y1, y2) {
  const h = 6;
  return `${x},${y1} ${x + h},${y1 + h} ${x + h},${y2 - h} ${x},${y2} ${x - h},${y2 - h} ${x - h},${y1 + h}`;
}

const SEGMENT_POINTS = {
  a: horizontal(12, 72, 10),
  b: vertical(74, 12, 70),
  c: vertical(74, 74, 132),
  d: horizontal(12, 72, 134),
  e: vertical(10, 74, 132),
  f: vertical(10, 12, 70),
  g: horizontal(12, 72, 72),
};

/**
 * @param {string} name
 * @param {Record<string, string>} attrs
 */
function svg(name, attrs) {
  const el = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/** Arc geometry in panel units (91 × 57): centre highest, ends lower. */
const arcX = (i) => 8.8 + i * 7.38;
const arcY = (i) => 16 + 10 * ((i - 5) / 5) ** 2;

/** Tick labels under the arc: [LED index, text, kind]. */
const TICKS = [
  [0, "♭♭", "small"],
  [1, "♭", "small"],
  [2, "BASS", "word"],
  [4, "♭♭", "small"],
  [5, "♭", "small"],
  [6, "GUITAR", "word"],
  [9, "CHROMATIC", "word"],
];

/**
 * @param {string} name
 * @param {Record<string, string>} attrs
 * @param {Element} [parent]
 */
function add(name, attrs, parent) {
  const el = svg(name, attrs);
  parent?.append(el);
  return el;
}

/** Quantise brightness so tiny float changes don't cause style writes. */
const level = (value) => Math.round(Math.min(1, Math.max(0, value)) * 50) / 50;

/**
 * @param {ParentNode} root  the pedal element
 */
export function createDisplay(root) {
  const arc = root.querySelector("[data-arc]");
  const digit = root.querySelector("[data-digit]");
  const check = root.querySelector("[data-check]");
  const sharpMark = root.querySelector("[data-sharp]");
  const tri = {
    flat: root.querySelector('[data-tri="flat"]'),
    sharp: root.querySelector('[data-tri="sharp"]'),
  };

  // Light-pipe: a pale-bordered clear strip following the LED curve.
  let d = "";
  for (let i = 0; i <= 40; i++) {
    const t = (i / 40) * 10;
    d += `${i ? "L" : "M"}${arcX(0) - 1.6 + (t / 10) * (arcX(10) - arcX(0) + 3.2)} ${arcY(t) + 0.2} `;
  }
  add("path", { class: "pipe-edge", d }, arc);
  add("path", { class: "pipe", d }, arc);

  // Ticks and mode silkscreen.
  for (const [i, text, kind] of TICKS) {
    const x = arcX(i);
    const y = arcY(i);
    // Slope of the arc at this LED (dy/dx), so labels follow the curve.
    const angle = (Math.atan((20 * (i - 5)) / 25 / 7.38) * 180) / Math.PI;
    add(
      "rect",
      {
        class: "tick",
        x: String(x - 0.5),
        y: String(y + 2.6),
        width: "1",
        height: "2",
      },
      arc,
    );
    const label = add(
      "text",
      {
        class: kind === "word" ? "silk word" : "silk",
        x: String(kind === "word" ? x + (i === 9 ? -6.5 : 1.2) : x),
        y: String(y + 7),
        "text-anchor": kind === "word" ? "start" : "middle",
        transform: `rotate(${angle.toFixed(1)} ${x} ${y + 7})`,
      },
      arc,
    );
    label.textContent = text;
  }

  // LEDs: a glow disc under a lamp, both driven by --b.
  /** @type {SVGElement[]} */
  const leds = [];
  for (let i = 0; i < LED_COUNT; i++) {
    const g = add("g", { class: "led" }, arc);
    if (i === 5) g.setAttribute("data-green", "");
    add(
      "circle",
      { class: "glow", cx: String(arcX(i)), cy: String(arcY(i)), r: "4.6" },
      g,
    );
    add(
      "circle",
      { class: "lamp", cx: String(arcX(i)), cy: String(arcY(i)), r: "1.5" },
      g,
    );
    leds.push(g);
  }

  // 7-segment digit, slightly italic like the real thing.
  const group = svg("g", { transform: "translate(10 0) skewX(-5)" });
  /** @type {Record<string, SVGElement>} */
  const segs = {};
  for (const name of SEGMENTS) {
    segs[name] = svg("polygon", { class: "seg", points: SEGMENT_POINTS[name] });
    group.append(segs[name]);
  }
  digit.append(group);

  // Glow discs for the triangles and CHECK LED.
  for (const [el, kind, r] of [
    [tri.flat, "amber", 7],
    [tri.sharp, "amber", 7],
    [check, "red", 4],
  ]) {
    const glow = add("circle", {
      class: `glow ${kind}`,
      cx: el.getAttribute("cx") ?? String(el === tri.flat ? 21.8 : 69.2),
      cy: el.getAttribute("cy") ?? "8",
      r: String(r),
    });
    el.before(glow);
    el.glow = glow;
  }

  /** Previous values, to skip redundant writes. */
  const prev = {
    leds: new Array(LED_COUNT).fill(0),
    tri: { flat: 0, sharp: 0 },
    glyph: "",
    sharp: false,
    check: 0,
    lock: false,
  };

  /** @param {Element} el @param {number} b */
  const setB = (el, b) => {
    el.style.setProperty("--b", String(b));
    if (el.glow) el.glow.style.setProperty("--b", String(b));
  };

  /**
   * @param {object} state  DisplayState from tuner.update
   * @param {{ on: boolean, check?: boolean }} opts
   */
  function render(state, { on, check: checkOn = on }) {
    // Arc LEDs: red, except the green centre one.
    for (let i = 0; i < LED_COUNT; i++) {
      const b = on ? level(state.leds[i] ?? 0) : 0;
      if (b !== prev.leds[i]) {
        prev.leds[i] = b;
        leds[i].style.setProperty("--b", String(b));
      }
    }

    // Triangles: ▶ lit when flat, ◀ when sharp, both when in tune.
    const flatB = on
      ? level(Math.max(state.guides.flat, state.guides.inTune))
      : 0;
    const sharpB = on
      ? level(Math.max(state.guides.sharp, state.guides.inTune))
      : 0;
    if (flatB !== prev.tri.flat) {
      prev.tri.flat = flatB;
      setB(tri.flat, flatB);
    }
    if (sharpB !== prev.tri.sharp) {
      prev.tri.sharp = sharpB;
      setB(tri.sharp, sharpB);
    }

    // Digit and sharp indicator.
    const char = on ? state.glyph || " " : " ";
    const sharp = on && state.sharp;
    if (char !== prev.glyph) {
      prev.glyph = char;
      const lit = glyph(char);
      for (const name of SEGMENTS)
        segs[name].classList.toggle("on", lit.has(name));
    }
    if (sharp !== prev.sharp) {
      prev.sharp = sharp;
      sharpMark.classList.toggle("on", sharp);
    }
    const lock = on && state.inTune;
    if (lock !== prev.lock) {
      prev.lock = lock;
      digit.toggleAttribute("data-lock", lock);
    }

    // CHECK LED.
    const c = checkOn ? 1 : 0;
    if (c !== prev.check) {
      prev.check = c;
      setB(check, c);
    }
  }

  return { render };
}
