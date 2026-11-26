import test from "node:test";
import assert from "node:assert/strict";
import { createRng } from "./rng.mjs";

test("same seed gives the same sequence; values in range", () => {
  const a = createRng(7);
  const b = createRng(7);
  for (let i = 0; i < 100; i++) {
    const v = a.next();
    assert.equal(v, b.next());
    assert.ok(v >= 0 && v < 1);
  }
  assert.notEqual(createRng(1).next(), createRng(2).next());
});
