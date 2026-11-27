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

/** LED centres traced from the reference photo, in panel units (91 × 57). */
const LEDS = [
  [8.9, 27.2],
  [16.3, 23.6],
  [23.1, 20.7],
  [30.4, 19.0],
  [38.3, 17.9],
  [46.3, 17.4],
  [53.9, 17.8],
  [61.6, 19.0],
  [69.2, 20.8],
  [76.4, 23.5],
  [83.5, 27.0],
];

/** White tick blocks under the arc: [x, y, rotation in degrees]. */
const TICKS = [
  [11.6, 31.3, -27],
  [18.3, 28.5, -22],
  [24.6, 25.9, -17],
  [38.3, 23.2, -6],
  [45.3, 22.6, 0],
  [52.4, 22.9, 5],
  [72.6, 28, 24],
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

/**
 * A glass LED bead: halo, unlit bead, lit bead, hot core and a specular
 * highlight, all driven by the group's --b.
 * @param {Element} parent
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {"red" | "green" | "pale"} kind  pale = white when off, red when lit
 */
function bead(parent, x, y, r, kind) {
  const lit = kind === "green" ? "green" : "red";
  const g = add("g", { class: "led" }, parent);
  const at = { cx: String(x), cy: String(y) };
  // The centre LED is bi-colour: red in stream style, green when in tune in
  // cent style. It carries both lit layers; CSS picks one via data-green.
  const colours = kind === "green" ? ["red", "green"] : [lit];
  for (const colour of colours) {
    add(
      "circle",
      {
        ...at,
        r: String(r * 2.7),
        class: `halo ${colour}`,
        fill: `url(#glow-${colour})`,
      },
      g,
    );
  }
  add(
    "circle",
    {
      ...at,
      r: String(r),
      fill: `url(#bead-off-${kind === "red" ? "red" : "pale"})`,
    },
    g,
  );
  for (const colour of colours) {
    add(
      "circle",
      {
        ...at,
        r: String(r),
        class: `on ${colour}`,
        fill: `url(#bead-on-${colour})`,
      },
      g,
    );
    add(
      "circle",
      {
        ...at,
        r: String(r * 0.8),
        class: `hot ${colour}`,
        fill: `url(#hot-${colour})`,
      },
      g,
    );
  }
  add(
    "ellipse",
    {
      cx: String(x - r * 0.3),
      cy: String(y - r * 0.42),
      rx: String(r * 0.28),
      ry: String(r * 0.17),
      class: "spec",
      fill: "url(#spec)",
    },
    g,
  );
  return g;
}

/**
 * An amber triangle lamp, same layers as a bead.
 * @param {Element} slot  a <g data-shape="x1,y1 x2,y2 x3,y3">
 */
function triangle(slot) {
  const points = slot.getAttribute("data-shape");
  const [a, b, c] = points.split(" ").map((p) => p.split(",").map(Number));
  const cx = (a[0] + b[0] + c[0]) / 3;
  const cy = (a[1] + b[1] + c[1]) / 3;
  const hot = [a, b, c]
    .map(([x, y]) => `${cx + (x - cx) * 0.55},${cy + (y - cy) * 0.55}`)
    .join(" ");
  slot.classList.add("led", "tri");
  add("polygon", { points, class: "off" }, slot);
  add(
    "circle",
    {
      cx: String(cx),
      cy: String(cy),
      r: "6.4",
      class: "halo",
      fill: "url(#glow-amber)",
    },
    slot,
  );
  add("polygon", { points, class: "on" }, slot);
  add("polygon", { points: hot, class: "hot" }, slot);
  return slot;
}

/** Quantise brightness so tiny float changes don't cause style writes. */
const level = (value) => Math.round(Math.min(1, Math.max(0, value)) * 50) / 50;

/**
 * @param {ParentNode} root  the pedal element
 */
export function createDisplay(root) {
  const arc = root.querySelector("[data-arc]");
  const digit = root.querySelector("[data-digit]");
  const sharpMark = root.querySelector("[data-sharp]");
  const tri = {
    flat: triangle(root.querySelector('[data-tri="flat"]')),
    sharp: triangle(root.querySelector('[data-tri="sharp"]')),
  };
  const check = bead(
    root.querySelector("[data-check]"),
    45.4,
    6.5,
    1.9,
    "pale",
  );

  // Light-pipe: a pale-bordered clear strip through the LED centres.
  const [x0, y0] = LEDS[0];
  const [x1] = LEDS[10];
  const k = (y0 - LEDS[5][1]) / (46.3 - x0) ** 2;
  let d = "";
  for (let i = 0; i <= 40; i++) {
    const x = x0 - 3.2 + (i / 40) * (x1 - x0 + 6.4);
    const y = LEDS[5][1] + k * (x - 46.3) ** 2;
    d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  add("path", { class: "pipe-edge", d }, arc);
  add("path", { class: "pipe", d }, arc);

  for (const [x, y, angle] of TICKS) {
    add(
      "rect",
      {
        class: "tick",
        x: "-1.65",
        y: "-1.2",
        width: "3.3",
        height: "2.4",
        transform: `translate(${x} ${y}) rotate(${angle})`,
      },
      arc,
    );
  }

  /** @type {SVGElement[]} */
  const leds = LEDS.map(([x, y], i) =>
    bead(arc, x, y, 2.3, i === 5 ? "green" : "red"),
  );

  // 7-segment digit, slightly italic like the real thing: halo, body, hot core.
  const group = svg("g", { transform: "translate(10 0) skewX(-5)" });
  /** @type {Record<string, SVGElement>} */
  const segs = {};
  for (const name of SEGMENTS) {
    const seg = add("g", { class: "seg" }, group);
    const points = SEGMENT_POINTS[name];
    add("polygon", { class: "seg-halo", points }, seg);
    add("polygon", { class: "seg-body", points }, seg);
    add(
      "polygon",
      {
        class: "seg-hot",
        points,
        fill: `url(#seg-${"adg".includes(name) ? "h" : "v"})`,
      },
      seg,
    );
    segs[name] = seg;
  }
  digit.append(group);

  /** Previous values, to skip redundant writes. */
  const prev = {
    leds: new Array(LED_COUNT).fill(0),
    tri: { flat: 0, sharp: 0 },
    glyph: "",
    sharp: false,
    check: 0,
    lock: false,
    green: false,
  };

  /** @param {Element} el @param {number} b */
  const setB = (el, b) => el.style.setProperty("--b", String(b));

  /**
   * @param {object} state  DisplayState from tuner.update
   * @param {{ on: boolean, check?: boolean }} opts
   */
  function render(state, { on, check: checkOn = on }) {
    // Arc LEDs: red; the centre one turns green in cent style when in tune.
    const green = on && Boolean(state.centreGreen);
    if (green !== prev.green) {
      prev.green = green;
      leds[5].toggleAttribute("data-green", green);
    }
    for (let i = 0; i < LED_COUNT; i++) {
      const b = on ? level(state.leds[i] ?? 0) : 0;
      if (b !== prev.leds[i]) {
        prev.leds[i] = b;
        setB(leds[i], b);
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
