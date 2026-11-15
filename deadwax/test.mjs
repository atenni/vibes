import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as DW from "./core.mjs";
import { HOUSE_RECORDS } from "./house-records.mjs";
import { runDeadWaxTests } from "./tests.mjs";

const records = HOUSE_RECORDS.map((file) => ({
  file,
  text: readFileSync(new URL(`examples/${file}`, import.meta.url), "utf8"),
}));

for (const result of runDeadWaxTests(DW, records))
  test(result.name, () => assert.ok(result.ok, result.message));

test("every example file is a house record", () => {
  const files = readdirSync(new URL("examples/", import.meta.url)).filter((f) =>
    f.endsWith(".deadwax"),
  );
  assert.deepEqual(files.sort(), [...HOUSE_RECORDS].sort());
});
