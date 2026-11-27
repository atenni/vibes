import assert from "node:assert/strict";
import { test } from "node:test";
import { LED_COUNT, createTuner, streamSpeed } from "./tuner.mjs";

const freq = (cents, base = 440) => base * 2 ** (cents / 1200);
const det = (cents, base) => ({ frequency: freq(cents, base), clarity: 0.95 });
const STEP = 16;

/** Drive a tuner at ~60 fps; `detect(t)` gives the detection for each frame. */
function run(tuner, from, ms, detect, extra = {}) {
  let state;
  let t = from;
  for (; t < from + ms; t += STEP) {
    state = tuner.update({
      now: t,
      detection: detect(t),
      mode: "chromatic",
      reference: 440,
      style: "stream",
      ...extra,
    });
  }
  return { state, end: t };
}

const argmax = (a) => a.indexOf(Math.max(...a));

/** Net LED travel (in LEDs) over a run, from head positions on the 11-LED strip. */
function travel(cents, ms = 1000) {
  const tuner = createTuner();
  const heads = [];
  run(tuner, 0, 300, () => det(cents)); // settle smoothing
  let t = 300;
  for (; t < 300 + ms; t += STEP) {
    const s = tuner.update({
      now: t,
      detection: det(cents),
      mode: "chromatic",
      reference: 440,
      style: "stream",
    });
    heads.push(s.leds);
  }
  return heads;
}

/** Count how many frames the lit centroid moves, signed, ignoring the wrap gap. */
function signedSteps(frames) {
  let right = 0;
  let left = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = argmax(frames[i - 1]);
    const b = argmax(frames[i]);
    if (b > a && b - a < 6) right += b - a;
    if (b < a && a - b < 6) left += a - b;
  }
  return { right, left };
}

test("streamSpeed: signed, monotonic in |cents|, clamped", () => {
  assert.ok(streamSpeed(10) > 0 && streamSpeed(-10) < 0);
  let last = 0;
  for (const c of [3, 5, 10, 20, 30, 40, 50]) {
    const s = Math.abs(streamSpeed(c));
    assert.ok(s >= last, `speed at ${c}`);
    last = s;
  }
  assert.ok(Math.abs(streamSpeed(3)) < 2.5, "slow crawl near pitch");
  assert.ok(Math.abs(streamSpeed(40)) > 10, "fast when far out");
  assert.equal(Math.abs(streamSpeed(5000)), 22);
});

test("stream flows right when sharp and left when flat", () => {
  const sharp = signedSteps(travel(+30));
  const flat = signedSteps(travel(-30));
  assert.ok(
    sharp.right > 5 && sharp.left < sharp.right / 3,
    JSON.stringify(sharp),
  );
  assert.ok(flat.left > 5 && flat.right < flat.left / 3, JSON.stringify(flat));
});

test("further out of tune flows faster", () => {
  const flow = (c) => {
    const { right } = signedSteps(travel(c));
    return right;
  };
  assert.ok(flow(40) > flow(15));
  assert.ok(flow(15) > flow(6));
});

test("stream stops in tune and locks the centre", () => {
  const tuner = createTuner();
  const { state } = run(tuner, 0, 1000, () => det(1));
  assert.equal(state.inTune, true);
  assert.equal(state.status, "tuning");
  assert.equal(argmax(state.leds), 5);
  assert.ok(state.leds[4] > 0.4 && state.leds[6] > 0.4, "neighbours lit");
  assert.ok(state.leds[5] > 0.95);
  assert.equal(state.leds[0] + state.leds[10], 0);
  assert.ok(state.guides.inTune > 0.9);
  assert.equal(state.guides.flat + state.guides.sharp, 0);
  // And it stays put.
  const later = run(tuner, 1000, 500, () => det(1)).state;
  assert.deepEqual(
    later.leds.map((v) => +v.toFixed(2)),
    state.leds.map((v) => +v.toFixed(2)),
  );
});

test("settling into tune takes about 120 ms rather than snapping", () => {
  const tuner = createTuner();
  run(tuner, 0, 400, () => det(25)); // far out, streaming
  // Jump the pitch to perfect: the smoothed value takes time to reach 3 cents,
  // then the comet runs into the centre before locking.
  let lockedAt = null;
  for (let t = 400; t < 1500; t += STEP) {
    const s = tuner.update({
      now: t,
      detection: det(0),
      mode: "chromatic",
      reference: 440,
      style: "stream",
    });
    if (lockedAt === null && s.guides.inTune > 0.9) lockedAt = t;
  }
  assert.ok(
    lockedAt !== null && lockedAt - 400 > 120,
    `lock at +${lockedAt - 400} ms`,
  );
});

test("in-tune hysteresis: enter at ≤3, leave only beyond 5", () => {
  const tuner = createTuner({ medianSize: 1 });
  let t = 0;
  const hold = (cents) => {
    const r = run(tuner, t, 600, () => det(cents));
    t = r.end;
    return r.state;
  };
  assert.equal(hold(4).inTune, false);
  assert.equal(hold(3.5).inTune, false, "3.5 is still out");
  assert.equal(hold(2.5).inTune, true);
  assert.equal(hold(4.5).inTune, true, "4.5 stays in");
  assert.equal(hold(4.9).inTune, true);
  assert.equal(hold(5.5).inTune, false, "beyond 5 leaves");
  assert.equal(hold(4).inTune, false, "and 4 does not re-enter");
});

test("median rejects a single spike", () => {
  const tuner = createTuner({ medianSize: 5 });
  let t = 0;
  let state;
  for (let i = 0; i < 12; i++, t += STEP) {
    const spike = i === 8 ? det(40) : det(0);
    state = tuner.update({
      now: t,
      detection: spike,
      mode: "chromatic",
      reference: 440,
      style: "cent",
    });
    if (i >= 9)
      assert.ok(Math.abs(state.cents) < 3, `frame ${i}: ${state.cents}`);
    if (i === 8) assert.ok(Math.abs(state.cents) < 3, "spike frame itself");
  }
});

test("octave jump is ignored for one or two frames, accepted at three", () => {
  const tuner = createTuner();
  const input = (d, t) =>
    tuner.update({
      now: t,
      detection: d,
      mode: "chromatic",
      reference: 440,
      style: "cent",
    });
  let t = 0;
  for (let i = 0; i < 10; i++, t += STEP) input(det(0, 110), t);
  let state;
  for (let i = 0; i < 2; i++, t += STEP) state = input(det(0, 220), t);
  assert.equal(state.note, "A");
  assert.ok(Math.abs(state.frequency - 110) < 1, `still ${state.frequency}`);
  // The 110 Hz note returns: a blip, not a switch.
  state = input(det(0, 110), t);
  t += STEP;
  assert.ok(Math.abs(state.frequency - 110) < 1);
  // Now a persistent octave jump.
  for (let i = 0; i < 3; i++, t += STEP) state = input(det(0, 220), t);
  assert.ok(Math.abs(state.frequency - 220) < 1, `now ${state.frequency}`);
});

test("note switch needs three consecutive frames", () => {
  const tuner = createTuner({ medianSize: 1 });
  const input = (d, t) =>
    tuner.update({
      now: t,
      detection: d,
      mode: "chromatic",
      reference: 440,
      style: "cent",
    });
  let t = 0;
  let s;
  for (let i = 0; i < 5; i++, t += STEP) s = input(det(0, 440), t);
  assert.equal(s.note, "A");
  // 1 semitone up (small enough to not trip the octave guard).
  s = input(det(100, 440), t);
  t += STEP;
  assert.equal(s.note, "A");
  s = input(det(100, 440), t);
  t += STEP;
  assert.equal(s.note, "A");
  s = input(det(100, 440), t);
  t += STEP;
  assert.equal(s.note, "A#");
  assert.equal(s.sharp, true);
  assert.equal(s.glyph, "A");
});

test("note hysteresis: a flicker back resets the count", () => {
  const tuner = createTuner({ medianSize: 1 });
  const input = (d, t) =>
    tuner.update({
      now: t,
      detection: d,
      mode: "chromatic",
      reference: 440,
      style: "cent",
    });
  let t = 0;
  for (let i = 0; i < 5; i++, t += STEP) input(det(0), t);
  const seq = [100, 100, 0, 100, 100, 0, 100, 100];
  let s;
  for (const c of seq) {
    s = input(det(c), t);
    t += STEP;
  }
  assert.equal(s.note, "A");
});

test("hold: keeps the note dimmed for 1.5 s after dropout, then goes idle", () => {
  const tuner = createTuner();
  let { state, end } = run(tuner, 0, 500, () => det(20));
  assert.equal(state.status, "tuning");
  const live = state.guides.sharp;
  const frozen = state.cents;

  ({ state, end } = run(tuner, end, 150, () => null));
  assert.equal(state.status, "tuning", "brief dropout keeps tuning");

  ({ state, end } = run(tuner, end, 600, () => null));
  assert.equal(state.status, "holding");
  assert.equal(state.glyph, "A");
  assert.equal(state.cents, frozen, "meter frozen");
  assert.ok(state.guides.sharp > 0 && state.guides.sharp < live, "dimmed");

  ({ state, end } = run(tuner, end, 600, () => null)); // ~1.35 s of silence
  assert.equal(state.status, "holding");

  ({ state, end } = run(tuner, end, 400, () => null)); // ~1.75 s
  assert.equal(state.status, "idle");
  assert.equal(state.glyph, "-");
  assert.equal(state.cents, null);
  assert.equal(state.note, null);
  assert.equal(state.guides.flat + state.guides.sharp + state.guides.inTune, 0);
  assert.ok(
    state.leds.every((v) => v === 0),
    "LEDs dark once decayed",
  );
});

test("holding resumes cleanly when the note returns", () => {
  const tuner = createTuner();
  let r = run(tuner, 0, 500, () => det(20));
  r = run(tuner, r.end, 800, () => null);
  assert.equal(r.state.status, "holding");
  r = run(tuner, r.end, 200, () => det(-20));
  assert.equal(r.state.status, "tuning");
  assert.ok(r.state.cents < 0 || r.state.cents > -20);
});

test("idle: starts dark with guides off", () => {
  const tuner = createTuner();
  const { state } = run(tuner, 0, 100, () => null);
  assert.equal(state.status, "idle");
  assert.equal(state.glyph, "-");
  assert.equal(state.leds.length, LED_COUNT);
  assert.ok(state.leds.every((v) => v === 0));
});

test("cent meter LED position: −50, −25, 0, +12, +50, +80", () => {
  // Guitar mode on A2 so ±50 and beyond stay on the same string.
  const cases = [
    [-50, 0],
    [-26, 2.4],
    [0, 5],
    [12, 6.2],
    [50, 10],
    [80, 10],
  ];
  for (const [cents, position] of cases) {
    const tuner = createTuner({ medianSize: 1, smoothingMs: 1 });
    const { state } = run(tuner, 0, 600, () => det(cents, 110), {
      style: "cent",
      mode: "guitar",
    });
    const lit = state.leds.filter((v) => v > 0.01).length;
    assert.ok(lit <= 2, `${cents}: at most 2 lit`);
    assert.equal(
      argmax(state.leds),
      Math.round(position),
      `${cents}: brightest LED`,
    );
    assert.equal(Math.max(...state.leds), 1);
    // Spill goes to the neighbour on the side of the true value.
    if (position < 10 && position > 0 && position !== 5) {
      const side = position > Math.round(position) ? 1 : -1;
      assert.ok(
        state.leds[Math.round(position) + side] > 0.1,
        `${cents}: spill`,
      );
    }
  }
});

test("cent meter guides: flat, sharp, in tune; beyond ±50 still lit", () => {
  const at = (cents) =>
    run(
      createTuner({ medianSize: 1, smoothingMs: 1 }),
      0,
      600,
      () => det(cents, 110),
      {
        style: "cent",
        mode: "guitar",
      },
    ).state;
  const flat = at(-20);
  assert.ok(
    flat.guides.flat > 0.9 &&
      flat.guides.sharp === 0 &&
      flat.guides.inTune === 0,
  );
  const sharp = at(+80);
  assert.ok(sharp.guides.sharp > 0.9 && sharp.guides.flat === 0);
  assert.ok(sharp.cents > 70, "cents not clamped in state");
  const ok = at(1);
  assert.ok(ok.guides.inTune > 0.9 && ok.guides.flat + ok.guides.sharp === 0);
  assert.equal(ok.leds[5], 1);
});

test("string modes: glyph is the string number; ♭ indicators follow the mode", () => {
  const input = (mode, f) =>
    run(createTuner(), 0, 300, () => ({ frequency: f, clarity: 0.9 }), { mode })
      .state;
  const g = input("guitar", 110);
  assert.deepEqual(
    [g.glyph, g.string, g.note, g.flat, g.flatBlink],
    ["5", 5, "A", false, false],
  );
  const gf = input("guitar-flat", 110 * 2 ** (-1 / 12));
  assert.deepEqual([gf.glyph, gf.flat, gf.flatBlink], ["5", true, false]);
  const gff = input("guitar-double-flat", 110 * 2 ** (-2 / 12));
  assert.deepEqual([gff.glyph, gff.flat, gff.flatBlink], ["5", true, true]);
  const b = input("bass", 41.2);
  assert.deepEqual([b.glyph, b.string], ["4", 4]);
});

test("chromatic: sharps show # indicator, flat indicator off", () => {
  const s = run(createTuner(), 0, 300, () => det(0, 277.18)).state;
  assert.deepEqual([s.glyph, s.sharp, s.flat], ["C", true, false]);
  assert.equal(s.note, "C#");
});

test("a string far from any string still reports flat/sharp guides", () => {
  const s = run(createTuner(), 0, 600, () => det(-45, 110), {
    mode: "guitar",
  }).state;
  assert.equal(s.string, 5);
  assert.ok(s.guides.flat > 0.9);
});

test("changing mode re-targets immediately", () => {
  const tuner = createTuner();
  let r = run(tuner, 0, 300, () => det(0, 110), { mode: "chromatic" });
  assert.equal(r.state.glyph, "A");
  r = run(tuner, r.end, STEP, () => det(0, 110), { mode: "guitar" });
  assert.equal(r.state.glyph, "5");
});

test("flash overlays the 7-seg then expires", () => {
  const tuner = createTuner();
  tuner.flash("G", { flat: true, flatBlink: true }, 500, 1000);
  const at = (now) =>
    tuner.update({
      now,
      detection: null,
      mode: "chromatic",
      reference: 440,
      style: "stream",
    });
  let s = at(1016);
  assert.deepEqual(
    [s.glyph, s.flat, s.flatBlink, s.sharp],
    ["G", true, true, false],
  );
  s = at(1400);
  assert.equal(s.glyph, "G");
  s = at(1500);
  assert.equal(s.glyph, "-");
  assert.equal(s.flat, false);
  assert.equal(s.flatBlink, false);
});

test("flash overlays a live note too", () => {
  const tuner = createTuner();
  run(tuner, 0, 300, () => det(0));
  tuner.flash("8", {}, 400, 300);
  const s = tuner.update({
    now: 316,
    detection: det(0),
    mode: "chromatic",
    reference: 440,
    style: "stream",
  });
  assert.equal(s.glyph, "8");
  assert.equal(s.note, "A", "underlying note still reported");
});

test("LEDs have attack and decay rather than snapping", () => {
  const tuner = createTuner({ medianSize: 1, smoothingMs: 1 });
  const go = (cents, t) =>
    tuner.update({
      now: t,
      detection: det(cents, 110),
      mode: "guitar",
      reference: 440,
      style: "cent",
    });
  let t = 0;
  let s;
  for (; t < 400; t += STEP) s = go(-45, t);
  assert.equal(s.leds[0], 1);
  s = go(45, (t += STEP));
  s = go(45, (t += STEP));
  assert.ok(s.leds[0] > 0 && s.leds[0] < 1, "old LED fading");
  assert.ok(
    (s.leds[10] > 0 && s.leds[10] < 1) || s.leds[10] === 1,
    "new LED rising",
  );
  for (; t < 800; t += STEP) s = go(45, t);
  assert.equal(s.leds[0], 0);
});

test("the state is a snapshot: mutating it does not affect the tuner", () => {
  const tuner = createTuner();
  const { state, end } = run(tuner, 0, 300, () => det(0), { style: "cent" });
  state.leds.fill(0);
  const next = run(tuner, end, STEP, () => det(0), { style: "cent" }).state;
  assert.ok(next.leds[5] > 0.9);
});

test("a long idle gap does not leave stale history", () => {
  const tuner = createTuner();
  let r = run(tuner, 0, 300, () => det(0, 110));
  r = run(tuner, r.end, 3000, () => null);
  assert.equal(r.state.status, "idle");
  r = run(tuner, r.end, 200, () => det(0, 330));
  assert.equal(r.state.note, "E");
  assert.ok(Math.abs(r.state.frequency - 330) < 1);
});

test("flash with leds shows exactly those LEDs and no guides", () => {
  const tuner = createTuner();
  run(tuner, 0, 300, () => det(20));
  tuner.flash("G", { leds: [2, 6] }, 1500, 300);
  const r = run(tuner, 300, 600, () => det(20));
  r.state.leds.forEach((v, i) => {
    if (i === 2 || i === 6) assert.ok(v > 0.99, `led ${i}`);
    else assert.equal(v, 0, `led ${i}`);
  });
  assert.deepEqual(r.state.guides, { flat: 0, inTune: 0, sharp: 0 });
  const after = run(tuner, r.end, 1200, () => null);
  assert.equal(after.state.leds[2], 0);
});
