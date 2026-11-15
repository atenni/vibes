import * as DW from "./core.mjs";
import { AudioRack } from "./audio.mjs";

export class Transport {
  constructor(song, settings, onBar, onPause = () => {}) {
    this.song = song;
    this.settings = settings;
    this.onBar = onBar;
    this.onPause = onPause;
    this.seed = settings.seed;
    this.drift = DW.driftState(song);
    this.random = DW.rng(this.seed);
    this.human = DW.rng(this.seed ^ 0x1b873593);
    this.bar = 0;
    this.loop = 0;
    this.step = 0;
    this.previous = [];
    this.running = false;
    this.needsPlan = true;
    this.shouldAdvance = false;
    this.history = [];
    this.visual = [];
    this.pausedPosition = { bar: 0, offset: 0, loop: 0 };
    this.cuedBar = null;
    this.cueRequest = null;
    this.cueVersion = 0;
    this.pendingWrap = false;
  }
  /** Tests override this to schedule into a silent rack. */
  createRack(seed, volume) {
    return new AudioRack(seed, volume);
  }
  /** Start fresh, resume, or seek to a zero-based bar and fractional offset. */
  async start(position) {
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      if (position) this.seek(position.bar, position.offset ?? 0);
      const p = this.pausedPosition;
      this.startSnapshot = {
        song: this.song,
        seed: this.seed,
        drift: DW.copy(this.drift),
        random: this.random.state(),
        human: this.human.state(),
        previous: [...this.previous],
        plan: this.plan,
        checkpoint: this.checkpoint,
        needsPlan: this.needsPlan,
        shouldAdvance: this.shouldAdvance,
        pendingWrap: this.pendingWrap,
        tempo: this.tempo,
        audioState: this.audioState,
      };
      this.bar = p.bar;
      this.loop = p.loop;
      this.step = Math.ceil(p.offset * this.song.steps - 1e-8);
      this.rack = this.createRack(this.seed, this.settings.volume);
      const rack = this.rack;
      rack.setColour(this.drift.current, rack.ctx.currentTime);
      await rack.ctx.resume();
      rack.needle();
      if (this.audioState !== undefined) rack.random = DW.rng(this.audioState);
      this.running = true;
      this.history = [];
      this.visual = [];
      const start = rack.ctx.currentTime + 0.3;
      const dt = 60 / (this.tempo ?? this.drift.current.tempo) / 4;
      this.next = start + (this.step - p.offset * this.song.steps) * dt;
      if (this.step >= this.song.steps) {
        this.step = 0;
        this.bar = (p.bar + 1) % this.song.bars;
        this.pendingWrap = this.bar === 0;
        this.needsPlan = true;
        this.shouldAdvance = true;
      }
      this.visual.push({
        time: start,
        bar: p.bar,
        loop: p.loop,
        offset: p.offset,
        plan: this.plan ?? { state: DW.copy(this.drift.current) },
        origin: DW.copy(this.drift.origin),
        song: this.song,
      });
      rack.ctx.onstatechange = () => {
        if (
          this.running &&
          rack === this.rack &&
          rack.ctx.state !== "running"
        ) {
          this.pause();
          this.onPause();
        }
      };
      this.tick();
    } catch (error) {
      this.running = false;
      try {
        await this.rack?.dispose();
      } catch {}
      this.rack = null;
      throw error;
    } finally {
      this.starting = false;
    }
  }
  /** The audible position, not the lookahead scheduler's future cursor. */
  position() {
    if (!this.running) return { ...this.pausedPosition };
    const now = this.rack.ctx.currentTime;
    const record = this.history.findLast((r) => r.time <= now);
    if (!record) return { ...this.pausedPosition };
    const progress = DW.clamp((now - record.time) / record.dt, 0, 1);
    return {
      bar: record.bar,
      loop: record.loop,
      offset: (record.step + progress) / record.checkpoint.song.steps,
      record,
      progress,
    };
  }
  prepareBar() {
    if (this.pending) {
      this.song = this.pending;
      this.pending = null;
      this.seed = this.song.seed;
      this.drift = DW.driftState(this.song);
      this.random = DW.rng(this.seed);
      this.human = DW.rng(this.seed ^ 0x1b873593);
      this.bar = 0;
      this.loop = 0;
      this.pendingWrap = false;
      this.previous = [];
      this.shouldAdvance = false;
      this.cuedBar = this.cueRequest = null;
    }
    const before = {
      song: this.song,
      drift: DW.copy(this.drift),
      random: this.random.state(),
      human: this.human.state(),
      previous: [...this.previous],
      tempo: this.tempo,
      loop: this.loop,
      bar: this.bar,
      pendingWrap: this.pendingWrap,
      shouldAdvance: this.shouldAdvance,
      audio: this.rack.random.state(),
    };
    let cue;
    if (this.pendingWrap && this.cueRequest === null) this.loop++;
    this.pendingWrap = false;
    if (this.cueRequest !== null) {
      this.bar = this.cueRequest;
      this.cueRequest = null;
      cue = this.cueVersion;
    }
    if (this.shouldAdvance)
      DW.advance(
        this.drift,
        this.song,
        this.random,
        this.settings.wander,
        this.settings.drift,
      );
    this.plan = DW.planBar(
      this.song,
      this.drift.current,
      this.random,
      this.bar,
      this.previous,
    );
    this.previous = this.plan.last;
    this.checkpoint = {
      song: this.song,
      seed: this.seed,
      plan: this.plan,
      drift: DW.copy(this.drift),
      random: this.random.state(),
      previous: [...this.previous],
      before,
    };
    this.needsPlan = false;
    this.visual.push({
      time: this.next,
      bar: this.bar,
      loop: this.loop,
      offset: this.step / this.song.steps,
      plan: this.plan,
      origin: DW.copy(this.drift.origin),
      song: this.song,
      cue,
    });
  }
  tick() {
    if (!this.running) return;
    const c = this.rack.ctx;
    if (c.state !== "running") return;
    if (this.next < c.currentTime - 0.2) this.next = c.currentTime + 0.04;
    const horizon = globalThis.document?.hidden ? 1.25 : 0.14;
    while (this.next < c.currentTime + horizon) {
      if (this.needsPlan) this.prepareBar();
      const state = this.plan.state;
      this.tempo =
        this.tempo === undefined
          ? state.tempo
          : this.tempo + (state.tempo - this.tempo) * 0.1;
      const dt = 60 / this.tempo / 4,
        humanBefore = this.human.state(),
        audioBefore = this.rack.random.state();
      this.rack.setColour(state, this.next);
      this.rack.mix(this.song, state, this.settings.muted, this.next);
      for (const e of this.plan.events.filter((e) => e.step === this.step)) {
        const swing = this.step % 2 ? state.swing * dt : 0;
        const human = (this.human() - 0.5) * state.humanise * 0.032;
        const t = Math.max(c.currentTime + 0.005, this.next + swing + human);
        const duration = (e.duration * 60) / this.tempo;
        if (e.part === "drums") this.rack.drum(e.voice, t, e.velocity);
        else
          this.rack.instrument(
            this.plan.parts[e.part],
            e.notes,
            t,
            duration,
            e.velocity,
            e.part,
          );
      }
      this.rack.surface(this.next, dt, state);
      this.history.push({
        time: this.next,
        dt,
        tempo: this.tempo,
        bar: this.bar,
        loop: this.loop,
        step: this.step,
        checkpoint: this.checkpoint,
        humanBefore,
        humanAfter: this.human.state(),
        audioBefore,
        audioAfter: this.rack.random.state(),
      });
      this.next += dt;
      if (++this.step >= this.song.steps) {
        this.step = 0;
        this.bar++;
        if (this.bar >= this.song.bars) {
          this.bar = 0;
          this.pendingWrap = true;
        }
        this.needsPlan = true;
        this.shouldAdvance = true;
      }
    }
    while (this.visual[0]?.time <= c.currentTime) {
      const v = this.visual.shift();
      if (v.cue === this.cueVersion) this.cuedBar = null;
      this.onBar(v);
    }
    // Retain the audible step plus the scheduled future, not an unbounded session log.
    const active = this.history.findLastIndex((r) => r.time <= c.currentTime);
    if (active > 0) this.history.splice(0, active);
    this.timer = setTimeout(() => this.tick(), 25);
  }
  pause() {
    if (!this.running) return this.position();
    const p = this.position(),
      record = p.record;
    this.running = false;
    clearTimeout(this.timer);
    if (record) {
      const checkpoint = record.checkpoint,
        oldSong = this.song,
        controls = this.drift;
      this.song = checkpoint.song;
      this.seed = checkpoint.seed;
      if (this.song !== oldSong && !this.pending) this.pending = oldSong;
      this.drift = DW.copy(checkpoint.drift);
      // Rewind speculative musical steps, but retain controls changed since the bar began.
      if (oldSong === this.song) {
        for (const key of ["origin", "target", "home", "hold"])
          this.drift[key] = DW.copy(controls[key]);
      }
      this.random = DW.rng(checkpoint.random);
      this.previous = [...checkpoint.previous];
      this.plan = checkpoint.plan;
      this.checkpoint = checkpoint;
      this.needsPlan = false;
      this.shouldAdvance = false;
      this.pendingWrap = false;
      this.human = DW.rng(
        p.progress > 0 ? record.humanAfter : record.humanBefore,
      );
      this.audioState = p.progress > 0 ? record.audioAfter : record.audioBefore;
      this.tempo = record.tempo;
    } else if (this.startSnapshot) {
      const s = this.startSnapshot,
        controls = this.drift;
      for (const key of [
        "song",
        "seed",
        "tempo",
        "audioState",
        "plan",
        "checkpoint",
        "needsPlan",
        "shouldAdvance",
        "pendingWrap",
      ])
        this[key] = s[key];
      this.drift = DW.copy(s.drift);
      for (const key of ["origin", "target", "home", "hold"])
        this.drift[key] = DW.copy(controls[key]);
      this.random = DW.rng(s.random);
      this.human = DW.rng(s.human);
      this.previous = [...s.previous];
    }
    this.pausedPosition = { bar: p.bar, offset: p.offset, loop: p.loop };
    if (p.offset >= 1) {
      this.pausedPosition.offset = 0;
      this.pausedPosition.bar = (p.bar + 1) % this.song.bars;
      if (this.pausedPosition.bar === 0) this.pausedPosition.loop++;
      this.needsPlan = true;
      this.shouldAdvance = true;
      this.pendingWrap = false;
    }
    if (this.cuedBar !== null) this.cueRequest = this.cuedBar;
    this.history = [];
    this.visual = [];
    this.retireRack();
    return this.position();
  }
  retireRack() {
    const rack = this.rack;
    if (!rack) return;
    rack.tapeStop();
    // Capture this rack: a quick resume must not close the newly created context.
    setTimeout(() => rack.dispose(), 1100);
  }
  seek(bar, offset = 0) {
    if (this.running) throw new Error("Use jumpTo while playing.");
    this.pausedPosition = {
      bar: DW.clamp(Math.trunc(bar), 0, this.song.bars - 1),
      offset: DW.clamp(offset, 0, 1 - 1e-8),
      loop: this.pausedPosition.loop,
    };
    this.needsPlan = true;
    this.shouldAdvance = false;
    this.pendingWrap = false;
    this.plan = null;
    this.cuedBar = this.cueRequest = null;
    this.cueVersion++;
  }
  jumpTo(bar) {
    bar = DW.clamp(Math.trunc(bar), 0, this.song.bars - 1);
    if (!this.running) {
      this.seek(bar);
      return;
    }
    const cancel = bar === this.position().bar;
    this.cuedBar = cancel ? null : bar;
    this.cueRequest = this.cuedBar;
    this.cueVersion++;
    // If the next bar was already scheduled in the lookahead window, rewind it.
    const future = this.history.find(
      (r) => r.step === 0 && r.time > this.rack.ctx.currentTime + 0.01,
    );
    if (future) {
      const b = future.checkpoint.before,
        controls = this.drift;
      this.rack.cancelFrom(future.time);
      this.drift = DW.copy(b.drift);
      for (const k of ["target", "home", "hold", "origin"])
        this.drift[k] = DW.copy(controls[k]);
      this.random = DW.rng(b.random);
      this.human = DW.rng(b.human);
      this.rack.random = DW.rng(b.audio);
      this.previous = [...b.previous];
      this.tempo = b.tempo;
      this.bar = b.bar;
      this.loop = b.loop;
      this.pendingWrap = b.pendingWrap;
      this.step = 0;
      this.next = future.time;
      this.needsPlan = true;
      this.shouldAdvance = b.shouldAdvance;
      this.history = this.history.filter((r) => r.time < future.time);
      this.visual = this.visual.filter((v) => v.time < future.time);
      clearTimeout(this.timer);
      this.tick();
    }
  }
  setDimension(key, value) {
    const apply = (d) => {
      d.origin[key] = d.current[key] = d.target[key] = value;
      d.velocity[key] = 0;
    };
    apply(this.drift);
    for (const checkpoint of new Set(
      this.history.map((r) => r.checkpoint).concat(this.checkpoint ?? []),
    )) {
      apply(checkpoint.drift);
      apply(checkpoint.before.drift);
      checkpoint.plan.state[key] = value;
    }
    if (this.plan) this.plan.state[key] = value;
  }
  snapshot() {
    const p = this.position(),
      checkpoint = p.record?.checkpoint;
    const state = DW.copy(checkpoint?.plan.state ?? this.drift.current);
    const r = DW.rng(checkpoint?.random ?? this.random.state()),
      bars = [];
    let last = [];
    const s = checkpoint?.song ?? this.song;
    for (let i = 0; i < s.bars; i++) {
      const b = DW.planBar(s, state, r, i, last);
      last = b.last;
      bars.push(b);
    }
    return DW.capture(s, bars, state, this.seed);
  }
}
