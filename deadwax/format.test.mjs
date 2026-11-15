import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as DW from "./core.mjs";

const page = readFileSync(new URL("format.html", import.meta.url), "utf8");
const decode = (text) =>
  text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

test("the format page's complete example is a valid Pressing", () => {
  const block = page.match(
    /<pre><code class="language-text">(deadwax 1[\s\S]*?)<\/code><\/pre>/,
  );
  assert.ok(block, "format.html has a complete example starting `deadwax 1`");
  assert.deepEqual(DW.parse(decode(block[1])).errors, []);
});

test("the format page documents every dimension and texture", () => {
  const missing = [
    ...Object.keys(DW.specs)
      .filter((name) => !DW.textures.includes(name))
      .filter((name) => !page.includes(`<td>${name}</td>`)),
    ...DW.textures.filter((name) => !page.includes(`texture ${name} `)),
  ];
  assert.deepEqual(missing, []);
});
