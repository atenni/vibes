/* Shared assertions: Node runner and browser test page. */
function runDeadWaxTests(DW, examples) {
  const results = [];
  const assert = (condition, message = "Assertion failed") => {
    if (!condition) throw new Error(message);
  };
  const test = (name, fn) => {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (error) {
      results.push({ name, ok: false, message: error.message });
    }
  };
  const valid = (text) => {
    const p = DW.parse(text);
    assert(!p.errors.length, JSON.stringify(p.errors));
    return p.song;
  };
  const source = examples[0].text;
  for (const example of examples) {
    test(`${example.file}: valid and stable canonical round-trip`, () => {
      const song = valid(example.text);
      const canonical = DW.serialize(song);
      assert(DW.serialize(valid(canonical)) === canonical);
    });
    test(`${example.file}: seeded plan, registers and captured round-trip`, () => {
      const song = valid(example.text);
      const plan = () => {
        const r = DW.rng(song.seed),
          bars = [];
        let last = [];
        for (let i = 0; i < song.bars; i++) {
          const b = DW.planBar(song, song.values, r, i, last);
          bars.push(b);
          last = b.last;
          for (const e of b.events) {
            assert(e.step >= 0 && e.step < song.steps);
            if (e.part === "chords")
              assert(e.notes.every((n) => n >= 46 && n <= 86));
          }
        }
        return bars;
      };
      assert(
        JSON.stringify(plan()) === JSON.stringify(plan()),
        "Non-deterministic plan",
      );
      const captured = DW.capture(song, plan(), song.values, song.seed);
      const text = DW.serialize(captured);
      assert(text === DW.serialize(valid(text)));
      const replay = valid(text),
        r = DW.rng(replay.seed);
      for (let i = 0; i < replay.bars; i++) {
        const bar = DW.planBar(replay, replay.values, r, i);
        const actual = bar.events
          .filter((e) => e.part === "chords")
          .map((e) => e.notes);
        const expected = plan()
          [i].events.filter((e) => e.part === "chords")
          .map((e) => e.notes);
        assert(
          JSON.stringify(actual) === JSON.stringify(expected),
          "Capture changed voicing",
        );
      }
    });
  }
  const invalid = [
    ["version", source.replace("deadwax 1", "deadwax 2")],
    ["unknown header", source + "\nvelocity 0.8"],
    ["tempo NaN", source.replace("tempo 72", "tempo NaN")],
    ["fractional bars", source.replace("bars 4", "bars 3.5")],
    ["unsupported meter", source.replace("meter 4/4", "meter 4/3")],
    ["invalid key", source.replace("key C minor", "key potato")],
    ["chord spelling", source.replace("Dm7b5:4", "Dpotato:4")],
    ["wrong duration total", source.replace("Dm7b5:4", "Dm9:3")],
    ["fractional step", source.replace("Dm7b5:4", "Dm9:0.3")],
    ["bad note", source.replace("F5:0.5", "H5:0.5")],
    ["bad grid symbol", source.replace("x..g", "x..z")],
    ["wrong grid length", source.replace("x..g", "x.g")],
    [
      "unknown instrument",
      source.replace("instrument bass upright", "instrument bass tuba"),
    ],
    ["drift min exceeds max", source + "\ndrift tempo 100 60"],
    ["drift excludes origin", source + "\ndrift tempo 80 90"],
    ["prototype-like drift name", source + "\ndrift __proto__ 0 1"],
    ["constructor-like drift name", source + "\ndrift constructor 0 1"],
    ["missing header", source.replace("swing 0.18", "")],
    ["duplicate title", source + "\ntitle Again"],
    ["chord-notes misaligned", source + "\nchord-notes C4:16"],
  ];
  for (const [name, text] of invalid)
    test(`reject ${name} with a source position`, () => {
      const p = DW.parse(text);
      assert(p.errors.length > 0, "Accepted invalid input");
      assert(
        p.errors.every(
          (e) =>
            Number.isInteger(e.line) &&
            e.line > 0 &&
            Number.isInteger(e.column) &&
            e.column > 0 &&
            e.message,
        ),
      );
    });
  test("exact token error column (including indentation)", () => {
    const errors = DW.parse(source + "\n  melody H4:16").errors;
    assert(
      errors.some((e) => e.column === 10 && e.message.includes("Invalid note")),
    );
  });
  test("comments do not eat sharps or alterations", () => {
    valid(source.replace("Abmaj7#11:4", "F#m7b5:4") + "\n; comment");
  });
  test("all requested chord symbols and slash bass", () => {
    for (const s of ["Dm9", "G13", "Cmaj7#11", "F#m7b5", "Bb7alt", "C9/E"])
      assert(DW.chord(s), s);
    assert(DW.chord("C9/E").bass === 4);
    assert(DW.chord("Cmaj7#11").ints.includes(18));
    assert(!DW.chord("Cwhatever"));
  });
  test("seeded random is repeatable and distinct", () => {
    const a = DW.rng(42),
      b = DW.rng(42),
      c = DW.rng(43);
    for (let i = 0; i < 20; i++) assert(a() === b());
    assert(a() !== c());
  });
  test("five minutes of drift remains bounded, changes and returns in two loops", () => {
    const s = valid(source),
      d = DW.driftState(s),
      r = DW.rng(42);
    DW.steer(d, s, "Dustier");
    for (let i = 0; i < 100; i++) {
      DW.advance(d, s, r, 0.8, true);
      for (const [k, [lo, hi]] of Object.entries(s.drift.limits))
        assert(d.current[k] >= lo && d.current[k] <= hi, k);
    }
    assert(d.current.vinyl > d.origin.vinyl + 0.1, "No meaningful drift");
    const before = JSON.stringify(d.current);
    d.hold = true;
    DW.advance(d, s, r, 1, true);
    assert(before === JSON.stringify(d.current), "Hold moved");
    DW.steer(d, s, "Home");
    for (let i = 0; i < s.bars * 2; i++) DW.advance(d, s, r, 1, true);
    for (const k in d.current) {
      const span = DW.specs[k][1] - DW.specs[k][0];
      assert(
        Math.abs(d.current[k] - d.origin[k]) < span * 0.025,
        `Not home: ${k}`,
      );
    }
  });
  test("drift-disabled dimensions never move", () => {
    const s = valid(source);
    s.drift.limits = {};
    const d = DW.driftState(s),
      r = DW.rng(1);
    DW.steer(d, s, "Busier");
    for (let i = 0; i < 100; i++) DW.advance(d, s, r, 1, true);
    assert(JSON.stringify(d.current) === JSON.stringify(d.origin));
  });
  test("unsteered default Drift changes meaningfully over five minutes", () => {
    const s = valid(source),
      d = DW.driftState(s),
      r = DW.rng(s.seed);
    const bars = Math.floor(300 / ((s.beats * 60) / s.tempo));
    for (let i = 0; i < bars; i++) {
      DW.advance(d, s, r, s.drift.rate, true);
      DW.planBar(s, d.current, r, i % s.bars);
    }
    const distance = Object.keys(d.current).reduce(
      (sum, k) =>
        sum +
        Math.abs(d.current[k] - d.origin[k]) /
          (DW.specs[k][1] - DW.specs[k][0]),
      0,
    );
    assert(distance > 1, "Default wandering was imperceptible");
  });
  test("Home converges within two loops for a one-bar score", () => {
    const s = valid(source),
      d = DW.driftState(s),
      r = DW.rng(11);
    s.bars = 1;
    d.current.tempo = 100;
    DW.steer(d, s, "Home");
    for (let i = 0; i < 2; i++) DW.advance(d, s, r, 0.35, true);
    assert(Math.abs(d.current.tempo - d.origin.tempo) < 1);
  });
  test("malformed directives never throw", () => {
    const r = DW.rng(19),
      keywords = [
        "drift",
        "dimension",
        "texture",
        "instrument",
        "level",
        "chords",
        "melody",
        "bass",
        "kick",
        "meter",
        "tempo",
      ];
    const tokens = [
      "__proto__",
      "constructor",
      "toString",
      "NaN",
      "Infinity",
      "-1",
      "1e99",
      "x",
      "0",
      "H9:4",
      "Dm9:3.7",
    ];
    for (let i = 0; i < 300; i++) {
      const pick = (list) => list[Math.floor(r() * list.length)];
      const line = [
        pick(keywords),
        pick(tokens),
        pick(tokens),
        pick(tokens),
      ].join(" ");
      const p = DW.parse(source + "\n" + line);
      assert(p.errors.length, "Malformed line was accepted: " + line);
    }
  });
  test("captured drift is valid for every direction", () => {
    for (const name of Object.keys(DW.directions)) {
      const s = valid(source),
        d = DW.driftState(s),
        r = DW.rng(73),
        bars = [];
      DW.steer(d, s, name);
      for (let i = 0; i < 60; i++) DW.advance(d, s, r, 1, true);
      let last = [];
      for (let i = 0; i < s.bars; i++) {
        const b = DW.planBar(s, d.current, r, i, last);
        bars.push(b);
        last = b.last;
      }
      valid(DW.serialize(DW.capture(s, bars, d.current, 73)));
    }
  });
  return results;
}
if (typeof module !== "undefined") module.exports = runDeadWaxTests;
