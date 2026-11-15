import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { discoverExperiments } from "./build-site.mjs";

// Installed as a PWA, iOS shows no back button, so every experiment's footer
// links back to the homepage. Wording and styling are up to the experiment.
const root = path.join(import.meta.dirname, "..");

for (const slug of discoverExperiments(root)) {
  test(`${slug} links back to the homepage from its footer`, () => {
    const html = readFileSync(path.join(root, slug, "index.html"), "utf8");
    const footers = html.match(/<footer\b[\s\S]*?<\/footer>/gi) ?? [];
    assert.ok(
      footers.some((footer) => /<a\b[^>]*\bhref=["']\.\.\/["']/i.test(footer)),
      `${slug}/index.html needs <a href="../"> inside a <footer>`,
    );
  });
}
