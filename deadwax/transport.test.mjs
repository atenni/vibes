import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the real inline transport with a deterministic clock and a silent rack.
// Browser smoke tests separately exercise the procedural Web Audio sources.
/** @param {{ resume?: () => Promise<void> }} [options] */
function harness({ resume = async () => {} } = {}) {
  const html = readFileSync(new URL("index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );
  const timers = [],
    sandbox = {
      document: { hidden: false },
      setTimeout(fn, delay) {
        const timer = { fn, delay };
        timers.push(timer);
        return timer;
      },
      clearTimeout(timer) {
        if (timer) timer.cancelled = true;
      },
    };
  vm.createContext(sandbox);
  vm.runInContext(scripts.slice(0, 3).join("\n"), sandbox);
  const DW = sandbox.DeadWax;
  class FakeRack {
    constructor(seed) {
      this.random = DW.rng(seed ^ 0xa5a5a5a5);
      this.ctx = { currentTime: 0, state: "running", resume };
      this.events = [];
      this.cancellations = [];
    }
    needle() {
      this.random();
    }
    setColour() {}
    mix() {}
    instrument(inst, notes, time) {
      this.random();
      this.events.push({ inst, notes: [...notes], time });
    }
    drum(voice, time) {
      this.random();
      this.events.push({ voice, time });
    }
    surface() {
      this.random();
    }
    tapeStop() {
      this.stopped = true;
    }
    cancelFrom(time) {
      this.cancellations.push(time);
      this.events = this.events.filter((e) => e.time < time);
    }
    async dispose() {
      this.disposed = true;
      this.ctx.state = "closed";
      this.ctx.onstatechange?.();
    }
  }
  sandbox.FakeRack = FakeRack;
  vm.runInContext("AudioRack = FakeRack;", sandbox);
  const song = DW.parse(vm.runInContext("EXAMPLES[0].text", sandbox)).song;
  const settings = {
    seed: song.seed,
    volume: 0.65,
    wander: 0.7,
    drift: true,
    muted: new Set(),
  };
  const bars = [],
    pauses = [];
  const transport = new sandbox.DeadWaxTransport(
    song,
    settings,
    (v) => bars.push(v),
    () => pauses.push(true),
  );
  function advance(time) {
    const c = transport.rack.ctx;
    while (c.currentTime < time - 1e-9) {
      c.currentTime = Math.min(time, c.currentTime + 0.025);
      transport.tick();
    }
  }
  return { DW, song, settings, transport, bars, pauses, timers, advance };
}
const json = (value) => JSON.stringify(value);

test("concurrent Play requests cannot open a second audio rack", async () => {
  let release;
  const h = harness({
    resume: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const t = h.transport,
    first = t.start(),
    rack = t.rack;
  await t.start();
  assert.equal(t.rack, rack);
  release();
  await first;
  assert.equal(t.running, true);
});

test("failed audio startup closes the rack and permits retry", async () => {
  let attempts = 0;
  const h = harness({
    resume: async () => {
      if (attempts++ === 0) throw new Error("Audio denied");
    },
  });
  const t = h.transport,
    first = t.start(),
    rack = t.rack;
  await assert.rejects(first, /Audio denied/);
  assert.equal(rack.disposed, true);
  assert.equal(t.rack, null);
  assert.equal(t.starting, false);
  assert.equal(t.running, false);
  await t.start();
  assert.equal(t.running, true);
});

test("pause retains the audible mid-bar playhead, drift, target, Hold and PRNG state", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(1.3);
  h.DW.steer(t.drift, h.song, "Dustier");
  t.drift.hold = true;
  const p = t.position(),
    random = p.record.checkpoint.random;
  t.pause();
  const drift = json(t.drift),
    human = t.human.state();
  assert.ok(p.offset > 0.2 && p.offset < 0.5);
  assert.equal(t.position().offset, p.offset);
  assert.equal(t.random.state(), random);
  assert.equal(t.drift.hold, true);
  assert.equal(t.drift.target.vinyl, 0.42);
  await t.start();
  assert.equal(json(t.drift), drift);
  assert.equal(t.human.state(), human);
  h.advance(0.32);
  assert.equal(t.position().bar, p.bar);
  assert.ok(
    t.history.every((r) => r.step >= Math.ceil(p.offset * h.song.steps - 1e-8)),
  );
});

test("pause rewinds speculative next-bar planning and resumes the same musical choices", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  const boundary = 0.3 + (h.song.beats * 60) / h.song.tempo;
  h.advance(boundary - 0.06);
  const future = t.history.find(
    (r) => r.step === 0 && r.time > t.rack.ctx.currentTime,
  );
  assert.ok(future, "No lookahead bar to rewind");
  const expected = json(future.checkpoint.plan),
    expectedRandom = future.checkpoint.random;
  assert.equal(t.position().bar, 0);
  t.pause();
  assert.equal(t.position().bar, 0);
  assert.equal(t.drift.current.tempo, h.song.tempo);
  await t.start();
  h.advance(0.6);
  assert.equal(t.position().bar, 1);
  assert.equal(json(t.plan), expected);
  assert.equal(t.random.state(), expectedRandom);
});

test("pausing during the needle drop does not consume a future plan twice", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(0.2);
  assert.ok(t.history.length);
  t.pause();
  assert.equal(t.position().offset, 0);
  assert.equal(t.random.state(), h.settings.seed);
  await t.start();
  h.advance(0.4);
  const expected = h.DW.planBar(
    h.song,
    h.song.values,
    h.DW.rng(h.settings.seed),
    0,
  );
  assert.equal(json(t.plan), json(expected));
});

test("paused seeking and fractional start schedule only notes at or after the requested offset", async () => {
  const h = harness(),
    t = h.transport;
  t.jumpTo(2);
  assert.equal(t.position().bar, 2);
  await t.start({ bar: 2, offset: 0.4 });
  h.advance(0.7);
  assert.equal(t.position().bar, 2);
  assert.ok(t.history.every((r) => r.step >= 7));
  assert.equal(t.drift.current.tempo, h.song.tempo);
});

test("a cue changes the next bar, never the current bar or loop count", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(1);
  t.jumpTo(3);
  assert.equal(t.position().bar, 0);
  assert.equal(t.cuedBar, 3);
  h.advance(3.8);
  assert.equal(t.position().bar, 3);
  assert.equal(t.cuedBar, null);
  assert.equal(t.position().loop, 0);
});

test("late cues replan already scheduled audio at the next boundary", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  const boundary = 0.3 + (h.song.beats * 60) / h.song.tempo;
  h.advance(boundary - 0.06);
  t.jumpTo(2);
  assert.equal(t.rack.cancellations.length, 1);
  assert.equal(t.position().bar, 0);
  h.advance(boundary + 0.05);
  assert.equal(t.position().bar, 2);
});

test("tapping the current bar cancels a cue, including one already in lookahead", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  const boundary = 0.3 + (h.song.beats * 60) / h.song.tempo;
  h.advance(boundary - 0.08);
  t.jumpTo(3);
  t.jumpTo(0);
  assert.equal(t.cuedBar, null);
  h.advance(boundary + 0.05);
  assert.equal(t.position().bar, 1);
});

test("a pending cue survives pause, while an explicit paused seek replaces it", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(1);
  t.jumpTo(3);
  t.pause();
  assert.equal(t.cuedBar, 3);
  t.jumpTo(2);
  assert.equal(t.cuedBar, null);
  await t.start();
  h.advance(0.4);
  assert.equal(t.position().bar, 2);
});

test("jumping from the last bar does not count as wrapping the loop", async () => {
  const h = harness(),
    t = h.transport;
  await t.start({ bar: 3 });
  h.advance(1);
  t.jumpTo(1);
  h.advance(3.8);
  assert.equal(t.position().bar, 1);
  assert.equal(t.position().loop, 0);
});

test("natural wrapping increments the loop and playback has no single-pass end state", async () => {
  const h = harness(),
    t = h.transport;
  h.settings.repeat = false;
  await t.start({ bar: 3 });
  h.advance(3.8);
  assert.equal(t.position().bar, 0);
  assert.equal(t.position().loop, 1);
  assert.equal(t.running, true);
});

test("rapid resume cannot dispose or pause the new audio rack", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(1);
  const old = t.rack;
  t.pause();
  await t.start();
  const fresh = t.rack;
  assert.notEqual(old, fresh);
  await h.timers.find((timer) => timer.delay === 1100).fn();
  assert.equal(old.disposed, true);
  assert.equal(fresh.disposed, undefined);
  assert.equal(t.running, true);
});

test("audio interruption pauses the transport instead of displaying a silent playing state", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(1);
  t.rack.ctx.state = "interrupted";
  t.rack.ctx.onstatechange();
  assert.equal(t.running, false);
  assert.equal(h.pauses.length, 1);
  assert.ok(t.position().offset > 0);
});

test("snapshot does not consume the live random stream and serialises to a valid new home", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(1.2);
  const before = t.random.state();
  const snapshot = t.snapshot();
  assert.equal(t.random.state(), before);
  assert.equal(h.DW.parse(h.DW.serialize(snapshot)).errors.length, 0);
  assert.equal(Object.keys(snapshot.drift.limits).length, 0);
});

test("timeline history stays bounded and live texture edits survive pause", async () => {
  const h = harness(),
    t = h.transport;
  await t.start();
  h.advance(120);
  assert.ok(t.history.length < 20);
  t.setDimension("rain", 0.33);
  t.pause();
  assert.equal(t.drift.current.rain, 0.33);
  assert.equal(t.drift.origin.rain, 0.33);
});
