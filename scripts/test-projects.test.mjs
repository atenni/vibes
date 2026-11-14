import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import {
  discoverProjects,
  changedPathsSince,
  selectProjects,
  runProjects,
} from "./test-projects.mjs";

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "vibes-project-tests-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["alpha", "beta"]) {
    mkdirSync(path.join(root, name));
    writeFileSync(
      path.join(root, name, "project.json"),
      JSON.stringify({ test: [process.execPath, "-e", "process.exit(0)"] }),
    );
  }
  return root;
}

const names = (projects) => projects.map((project) => project.name);

/** @param {string} root @param {...string} args @returns {string} */
function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** @param {string} root */
function initGit(root) {
  git(root, "init");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "add", ".");
  git(root, "-c", "core.hooksPath=/dev/null", "commit", "-m", "initial");
  return git(root, "rev-parse", "HEAD");
}

/** @param {string} root */
function commit(root) {
  git(root, "add", "-A");
  git(root, "-c", "core.hooksPath=/dev/null", "commit", "-m", "change");
}

test("discovers sorted opt-in projects, ignoring undeclared folders and scratch files", (t) => {
  const root = fixture(t);
  for (const name of ["undeclared", "llm", "tmp", ".hidden", "node_modules"]) {
    mkdirSync(path.join(root, name));
    if (name !== "undeclared")
      writeFileSync(path.join(root, name, "project.json"), "invalid");
  }
  assert.deepEqual(names(discoverProjects(root)), ["alpha", "beta"]);
});

test("rejects malformed manifests rather than silently dropping tests", (t) => {
  const root = fixture(t),
    manifestPath = path.join(root, "alpha", "project.json");
  for (const value of [
    null,
    [],
    {},
    { test: "node test.mjs" },
    { test: [] },
    { test: [1] },
    { test: [""] },
    { test: ["node"], typo: true },
  ]) {
    writeFileSync(manifestPath, JSON.stringify(value));
    assert.throws(() => discoverProjects(root), /alpha\/project.json/);
  }
  writeFileSync(manifestPath, "{");
  assert.throws(() => discoverProjects(root), /alpha\/project.json/);
});

test("selects changed projects, ignores undeclared directories and handles an empty diff", (t) => {
  const projects = discoverProjects(fixture(t));
  assert.deepEqual(
    names(selectProjects(projects, ["beta/source.mjs", "beta/project.json"])),
    ["beta"],
  );
  assert.deepEqual(
    names(selectProjects(projects, ["unregistered/index.html"])),
    [],
  );
  assert.deepEqual(names(selectProjects(projects, [])), []);
  assert.deepEqual(
    names(selectProjects(projects, ["alpha/deleted.mjs", "beta/new.mjs"])),
    ["alpha", "beta"],
  );
});

test("shared code, workflows, root files and uncertain comparisons select every project", (t) => {
  const projects = discoverProjects(fixture(t));
  for (const changed of [
    null,
    ["scripts/test-projects.mjs"],
    ["scripts/test-projects.test.mjs"],
    [".github/workflows/project-tests.yaml"],
    [".node-version"],
    ["README.md"],
  ]) {
    assert.deepEqual(names(selectProjects(projects, changed)), [
      "alpha",
      "beta",
    ]);
  }
});

test("Git comparison includes deletions and both sides of cross-project renames", (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, "alpha", "old name.mjs"), "rename me\n");
  writeFileSync(path.join(root, "alpha", "deleted.mjs"), "delete me\n");
  const base = initGit(root);
  git(root, "mv", "alpha/old name.mjs", "beta/new name.mjs");
  rmSync(path.join(root, "alpha", "deleted.mjs"));
  commit(root);
  const changed = changedPathsSince(root, base);
  assert.deepEqual(changed.sort(), [
    "alpha/deleted.mjs",
    "alpha/old name.mjs",
    "beta/new name.mjs",
  ]);
  assert.deepEqual(names(selectProjects(discoverProjects(root), changed)), [
    "alpha",
    "beta",
  ]);
});

test("a completely deleted project is not scheduled", (t) => {
  const root = fixture(t),
    base = initGit(root);
  rmSync(path.join(root, "beta"), { recursive: true });
  commit(root);
  assert.deepEqual(
    names(
      selectProjects(discoverProjects(root), changedPathsSince(root, base)),
    ),
    [],
  );
});

test("missing Git bases fall back to all projects and do not accept Git options as refs", (t) => {
  const root = fixture(t);
  initGit(root);
  for (const ref of ["missing-ref", "--help"]) {
    const changed = changedPathsSince(root, ref);
    assert.equal(changed, null);
    assert.deepEqual(names(selectProjects(discoverProjects(root), changed)), [
      "alpha",
      "beta",
    ]);
  }
});

test("commands run in project directories with literal arguments, continuing after failures", (t) => {
  const root = fixture(t),
    literal = "hello; $(not-a-shell-command) with spaces";
  const projects = [
    { name: "alpha", test: [process.execPath, "-e", "process.exit(2)"] },
    {
      name: "beta",
      test: [
        process.execPath,
        "--input-type=module",
        "-e",
        "import fs from 'node:fs'; fs.writeFileSync('result.txt', process.argv[1])",
        literal,
      ],
    },
  ];
  assert.equal(runProjects(root, projects), 1);
  assert.equal(
    readFileSync(path.join(root, "beta", "result.txt"), "utf8"),
    literal,
  );
  assert.equal(runProjects(root, [projects[1]]), 0);
  assert.equal(runProjects(root, []), 0);
});

test("a missing executable fails rather than appearing to pass", (t) => {
  assert.equal(
    runProjects(fixture(t), [
      { name: "alpha", test: ["vibes-no-such-executable"] },
    ]),
    1,
  );
});

test("CLI lists machine-readable names and rejects typos", () => {
  const script = path.join(import.meta.dirname, "test-projects.mjs");
  const run = (args) =>
    spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  const listed = run(["--list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  const projects = JSON.parse(listed.stdout);
  assert.deepEqual(
    projects,
    names(discoverProjects(path.resolve(import.meta.dirname, ".."))),
  );
  if (projects.length) {
    const single = run([projects[0], "--list", "--json"]);
    assert.equal(single.status, 0, single.stderr);
    assert.deepEqual(JSON.parse(single.stdout), [projects[0]]);
  }
  for (const args of [
    ["--unknown"],
    ["--base"],
    ["--json"],
    ["--base", "HEAD", "some-project"],
    ["no-such-project"],
  ]) {
    assert.equal(run(args).status, 1, args.join(" "));
  }
});
