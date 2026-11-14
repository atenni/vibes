const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const runTests = require("./tests.js");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
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
    fs.readFileSync(path.join(__dirname, "examples", example.file), "utf8") !==
    example.text
  ) {
    console.error("FAIL embedded example differs from file:", example.file);
    failures++;
  }
}
for (const result of runTests(sandbox.DW, sandbox.examples)) {
  console.log(
    `${result.ok ? "PASS" : "FAIL"} ${result.name}${result.message ? ": " + result.message : ""}`,
  );
  if (!result.ok) failures++;
}
process.exitCode = failures ? 1 : 0;
