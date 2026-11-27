import assert from "node:assert/strict";
import { test } from "node:test";
import { glyph } from "./segments.mjs";

const lit = (c) => [...glyph(c)].sort().join("");

test("every glyph the app uses exists", () => {
  for (const c of "0123456789AbCdEFGHLnoPrtU- BD") {
    assert.ok(glyph(c) instanceof Set, c);
  }
  for (const c of "ABCDEFG1234567") assert.ok(glyph(c).size > 0, `${c} lit`);
});

test("known shapes", () => {
  assert.equal(lit("8"), "abcdefg");
  assert.equal(lit("1"), "bc");
  assert.equal(lit("-"), "g");
  assert.equal(lit(" "), "");
  assert.equal(lit("E"), "adefg");
  assert.equal(lit("b"), "cdefg");
  assert.equal(lit("0"), "abcdef");
});

test("note letters are distinct from each other", () => {
  const shapes = ["A", "b", "C", "d", "E", "F", "G"].map(lit);
  assert.equal(new Set(shapes).size, shapes.length);
});

test("B and D fall back to b and d; unknown is blank", () => {
  assert.equal(lit("B"), lit("b"));
  assert.equal(lit("D"), lit("d"));
  assert.equal(lit("?"), "");
});
