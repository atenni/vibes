import assert from "node:assert/strict";
import test from "node:test";
import {
  FONT,
  GLYPH_H,
  GLYPH_W,
  SPRITES,
  bitmapRects,
  glyphFor,
  spriteFrame,
  spriteSize,
  textWidth,
} from "./sprites.mjs";

test("every sprite row has the same width, across both frames", () => {
  for (const [name, frames] of Object.entries(SPRITES)) {
    const width = frames[0][0].length;
    const height = frames[0].length;
    for (const rows of frames) {
      assert.equal(rows.length, height, `${name} frame height`);
      for (const row of rows) {
        assert.equal(row.length, width, `${name}: "${row}"`);
        assert.match(row, /^[#.]+$/, `${name}: bad character`);
      }
    }
  }
});

test("every invader has two animation frames", () => {
  for (const name of ["blob", "squid", "crab", "diver", "inkeater"]) {
    assert.equal(SPRITES[name].length, 2, name);
    assert.notDeepEqual(SPRITES[name][0], SPRITES[name][1], name);
  }
});

test("the boss is 15×11", () => {
  assert.deepEqual(spriteSize("boss"), { w: 15, h: 11 });
});

test("every glyph is 5×7", () => {
  for (const [ch, rows] of Object.entries(FONT)) {
    assert.equal(rows.length, GLYPH_H, `${ch} height`);
    for (const row of rows) {
      assert.equal(row.length, GLYPH_W, `${ch} width: "${row}"`);
      assert.match(row, /^[#.]+$/);
    }
  }
});

test("the font covers the characters the spec asks for", () => {
  for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ×!?.:-+ ") {
    assert.ok(FONT[ch], `missing ${JSON.stringify(ch)}`);
  }
});

test("glyphFor falls back to lowercase-as-uppercase, then to ?", () => {
  assert.equal(glyphFor("a"), FONT.A);
  assert.equal(glyphFor("§"), FONT["?"]);
});

test("bitmapRects merges runs and covers every lit pixel", () => {
  assert.deepEqual(bitmapRects(["##.#", "...."]), [
    [0, 0, 2, 1],
    [3, 0, 1, 1],
  ]);
  for (const frames of Object.values(SPRITES)) {
    for (const rows of frames) {
      const lit = rows.join("").replaceAll(".", "").length;
      const covered = bitmapRects(rows).reduce((sum, r) => sum + r[2], 0);
      assert.equal(covered, lit);
    }
  }
});

test("spriteFrame wraps and textWidth counts spacing", () => {
  assert.equal(spriteFrame("ship", 1), SPRITES.ship[0]);
  assert.equal(spriteFrame("blob", 3), SPRITES.blob[1]);
  assert.equal(textWidth("", 3), 0);
  assert.equal(textWidth("AB", 2), 22);
});
