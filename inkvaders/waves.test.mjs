import test from "node:test";
import assert from "node:assert/strict";
import {
  CELL,
  KIND_BY_LETTER,
  getWave,
  isBossWave,
  layoutOf,
  layoutWidth,
} from "./waves.mjs";

const kinds = (n) => new Set(layoutOf(getWave(n)).map((l) => l.kind));

test("waves 1–8 contain the expected kinds", () => {
  assert.deepEqual([...kinds(1)], ["blob"]);
  assert.ok(kinds(2).has("squid") && !kinds(2).has("crab"));
  assert.ok(kinds(3).has("crab"));
  assert.ok(kinds(4).has("diver"));
  assert.ok(kinds(5).has("inkeater") || kinds(6).has("inkeater"));
  assert.ok(kinds(8).has("inkeater") && kinds(8).has("diver"));
});

test("every 5th wave is a boss", () => {
  for (let n = 1; n <= 40; n++) {
    assert.equal(getWave(n, 3).boss, n % 5 === 0);
    assert.equal(isBossWave(n), n % 5 === 0);
  }
  assert.equal(getWave(10).bossLevel, 2);
});

test("procedural waves are deterministic and fit the field", () => {
  for (let n = 9; n <= 60; n++) {
    const a = getWave(n, 42);
    assert.deepEqual(a, getWave(n, 42));
    assert.ok(layoutWidth(a) <= 340, `wave ${n} too wide`);
    for (const row of a.rows)
      for (const ch of row) assert.ok(ch === "." || KIND_BY_LETTER[ch]);
    for (const l of layoutOf(a)) assert.ok(Math.abs(l.ox) <= (9 * CELL.w) / 2);
  }
  assert.notDeepEqual(getWave(12, 1).rows, getWave(12, 2).rows);
});

test("difficulty rises", () => {
  assert.ok(getWave(30, 1).fireInterval < getWave(9, 1).fireInterval);
  assert.ok(getWave(30, 1).stepBase < getWave(9, 1).stepBase);
});
