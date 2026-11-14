# Vibes

Small web experiments and useful browser applications, mostly written with LLMs.

**Site:** https://vibes.atenni.com

Each experiment lives in its own folder. Everything is served as static files by
GitHub Pages; there is no build step.

## Tools

- [CIDR helper](https://vibes.atenni.com/cidr/) — IPv4 and IPv6 subnet
  calculator. [Documentation](cidr/README.md).
- [Dead Wax](https://vibes.atenni.com/deadwax/) — procedural lo-fi jazz loops,
  plain-text scores and steerable Drift. [Format and guide](deadwax/FORMAT.md).
  Self-contained; also works from a downloaded `deadwax/index.html`. Tests:
  `node deadwax/test.mjs` or open `deadwax/tests.html`.

## Local development

Serve the repository root over HTTP (JavaScript modules do not work via
`file://`):

```sh
uv run python -m http.server 8000
```

Open http://localhost:8000.

## Project tests (experimental)

This CI approach is an experiment to evaluate as the monorepo grows, not a
settled repository-wide framework. The runner, workflow and initial manifests
are isolated in a dedicated commit so the experiment can be reverted without
changing the applications or their project-local tests.

Projects opt in to testing with a `project.json` in their top-level directory.
The manifest declares a command and its arguments, run **from that directory**:

```json
{
  "test": ["node", "--test", "ip.test.mjs"]
}
```

No root package, dependency installation or build system is required. Commands
are executed directly, not through a shell; put multiple test steps in a
project-local script rather than using `&&` or shell expansions in the manifest.
Project directory names use lowercase letters, digits, hyphens or underscores.
The only supported manifest field is `test`. Projects without a manifest are not
scheduled. The current CI environment provides the latest Node on Ubuntu;
projects needing additional runtimes or dependencies will need explicit setup.

Use the same runner locally and in CI:

```sh
# All opted-in projects
node scripts/test-projects.mjs

# One or several projects
node scripts/test-projects.mjs cidr deadwax

# Projects changed between a Git ref and HEAD (committed changes only)
node scripts/test-projects.mjs --base main

# Preview selection without running commands
node scripts/test-projects.mjs --base main --list --json

# Test the shared runner itself
node --test scripts/test-projects.test.mjs
```

### CI selection and isolation

[Project tests](.github/workflows/project-tests.yaml) discovers manifests and
runs affected projects as independent matrix jobs. Adding a project does not
require editing the workflow. One failing project does not cancel the others.
The runner's own tests run on every workflow invocation.

- Pull requests compare their base commit with the PR head.
- Pushes compare the previous commit with the pushed head.
- Manual runs, new branches and unavailable base commits test all projects.
- Any root-level file, `scripts/` or `.github/` change tests all projects
  conservatively. Other changes select only their owning top-level project.
- Renames consider both old and new paths; deleted projects are not scheduled.
- No affected opted-in projects means no project jobs, not a CI failure.

The stable **Project tests** result aggregates discovery and matrix results; use
it for branch protection rather than requiring dynamically named project jobs.
Formatting remains a separate repository-wide check. This is a small runner for
independent projects, not a cross-project dependency graph: if shared code is
introduced elsewhere, extend selection rules and their tests.

### Undoing the experiment

Revert the commit titled `ci: trial project-local test discovery`. This removes
the shared runner, project-test workflow, initial manifests and this guide, and
restores the previous CI configuration. The original project-local test commands
still work; no application code depends on the runner. Keep unrelated changes
out of that commit so rollback remains straightforward.

If **Project tests** has been made a required branch-protection check, remove
that requirement before removing its workflow. No branch-protection settings are
changed by this experiment.

## Formatting

Prettier uses its defaults with `proseWrap: always`. Install the Git hook and
run the same checks as GitHub Actions:

```sh
uvx pre-commit install
uvx pre-commit run --all-files
```
