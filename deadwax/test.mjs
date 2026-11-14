import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { runDeadWaxTests } from "./tests.mjs";
const html = fs.readFileSync(
  path.join(import.meta.dirname, "index.html"),
  "utf8",
);
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(
  (m) => m[1],
);
for (const script of scripts) new vm.Script(script); // Syntax-check every inline script.
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(scripts[0] + "\nglobalThis.DW = DW;", sandbox);
vm.runInContext(scripts[1] + "\nglobalThis.examples = EXAMPLES;", sandbox);
let failures = 0;
for (const example of sandbox.examples) {
  if (
    fs.readFileSync(
      path.join(import.meta.dirname, "examples", example.file),
      "utf8",
    ) !== example.text
  ) {
    console.error("FAIL embedded example differs from file:", example.file);
    failures++;
  }
}
for (const result of runDeadWaxTests(sandbox.DW, sandbox.examples)) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${result.name}${result.message ? ": " + result.message : ""}`,
  );
  if (!result.ok) failures++;
}
process.exitCode = failures ? 1 : 0;
// Native Node tests exercise audio policy and transport without a browser.
await import("./audio.test.mjs");
await import("./transport.test.mjs");
