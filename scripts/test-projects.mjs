import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

/** @typedef {{name: string, test: string[]}} Project */

/** Discover opt-in, top-level projects; reject malformed declarations early.
 * @param {string} root
 * @returns {Project[]}
 */
export function discoverProjects(root) {
  const projects = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      ["node_modules", "llm", "tmp"].includes(entry.name)
    )
      continue;
    const manifestPath = path.join(root, entry.name, "project.json");
    let text;
    try {
      text = readFileSync(manifestPath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    let manifest;
    try {
      manifest = JSON.parse(text);
    } catch (error) {
      throw new Error(`${entry.name}/project.json: ${error.message}`);
    }
    if (
      !/^[a-z0-9][a-z0-9_-]*$/.test(entry.name) ||
      !manifest ||
      typeof manifest !== "object" ||
      Array.isArray(manifest) ||
      Object.keys(manifest).some((key) => key !== "test") ||
      !Array.isArray(manifest.test) ||
      manifest.test.length === 0 ||
      manifest.test.some((arg) => typeof arg !== "string" || arg.length === 0)
    ) {
      throw new Error(
        `${entry.name}/project.json must contain only a non-empty test command array; project names use lowercase letters, digits, hyphens or underscores.`,
      );
    }
    projects.push({ name: entry.name, test: manifest.test });
  }
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** null means uncertainty: conservatively run everything.
 * @param {string} root
 * @param {string} base
 * @returns {string[] | null}
 */
export function changedPathsSince(root, base) {
  try {
    const commit = execFileSync(
      "git",
      ["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    // No rename detection: both the old and new project paths must be selected.
    const output = execFileSync(
      "git",
      ["diff", "--no-renames", "--name-only", "-z", commit, "HEAD", "--"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return output.split("\0").filter(Boolean);
  } catch {
    console.error(
      `Could not compare ${base} with HEAD; testing all projects instead.`,
    );
    return null;
  }
}

/** Root-level files, CI and shared tooling can affect any project.
 * @param {Project[]} projects
 * @param {string[] | null} changedPaths
 * @returns {Project[]}
 */
export function selectProjects(projects, changedPaths) {
  if (
    changedPaths === null ||
    changedPaths.some(
      (file) =>
        !file.includes("/") ||
        file.startsWith("scripts/") ||
        file.startsWith(".github/"),
    )
  ) {
    return projects;
  }
  const changedDirectories = new Set(
    changedPaths.map((file) => file.split("/")[0]),
  );
  return projects.filter((project) => changedDirectories.has(project.name));
}

/** Run every selected project, even when another fails. No shell interpolation.
 * @param {string} root
 * @param {Project[]} projects
 * @returns {number} Process exit code.
 */
export function runProjects(root, projects) {
  let failures = 0;
  for (const project of projects) {
    console.log(`\nTesting ${project.name}: ${JSON.stringify(project.test)}`);
    const result = spawnSync(project.test[0], project.test.slice(1), {
      cwd: path.join(root, project.name),
      stdio: "inherit",
      shell: false,
    });
    if (result.error || result.status !== 0) {
      failures++;
      console.error(
        `${project.name} failed: ${result.error?.message ?? result.signal ?? `exit ${result.status}`}`,
      );
    }
  }
  console.log(`\n${projects.length} project(s) tested; ${failures} failed.`);
  return failures ? 1 : 0;
}

/** @param {string[]} args @returns {number} */
function main(args) {
  if (args.includes("--help")) {
    console.log(`Usage: node scripts/test-projects.mjs [project ...] [--list [--json]]
       node scripts/test-projects.mjs --base <git-ref> [--list [--json]]

With no project names or base, test all declared projects.
--base compares committed files between the given ref and HEAD (not working edits).
An unavailable base falls back to all projects. --list prints names without running tests.`);
    return 0;
  }
  let base,
    list = false,
    json = false;
  const names = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--base") {
      if (base !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) {
        throw new Error("Provide exactly one Git ref after --base.");
      }
      base = args[++i];
    } else if (arg === "--list") list = true;
    else if (arg === "--json") json = true;
    else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else names.push(arg);
  }
  if (json && !list) throw new Error("--json requires --list.");
  if (base !== undefined && names.length)
    throw new Error("Choose project names or --base, not both.");
  let projects = discoverProjects(repositoryRoot);
  if (names.length) {
    for (const name of names) {
      if (!projects.some((project) => project.name === name))
        throw new Error(`Unknown or undeclared project: ${name}`);
    }
    projects = projects.filter((project) => names.includes(project.name));
  } else if (base !== undefined) {
    projects = selectProjects(
      projects,
      changedPathsSince(repositoryRoot, base),
    );
  }
  if (list) {
    const selected = projects.map((project) => project.name);
    console.log(json ? JSON.stringify(selected) : selected.join("\n"));
    return 0;
  }
  return runProjects(repositoryRoot, projects);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
