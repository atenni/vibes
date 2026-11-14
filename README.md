# Vibes

Small web experiments and useful browser applications, mostly written with LLMs.

**Site:** https://vibes.atenni.com

Each experiment lives in its own folder and is served as static files. On
deploy, a small dependency-free script renders the homepage from each
experiment's own `<head>`; experiment folders are published unchanged.

## Tools

- [CIDR helper](https://vibes.atenni.com/cidr/) — IPv4 and IPv6 subnet
  calculator. [Documentation](cidr/README.md).
- [Dead Wax](https://vibes.atenni.com/deadwax/) — procedural lo-fi jazz loops,
  plain-text scores and steerable Drift. [Format and guide](deadwax/FORMAT.md).
  Self-contained; also works from a downloaded `deadwax/index.html`. Tests:
  `node --test deadwax/` or open `deadwax/tests.html`.

## Adding an experiment

Create a top-level folder with an `index.html`. That is all; it appears on the
homepage at the next deploy. Every field has a default, and these standard
`<head>` tags improve the card:

| Field       | Source                                                                                  | Default            |
| ----------- | --------------------------------------------------------------------------------------- | ------------------ |
| Name        | `<meta name="application-name">`, else `<title>` before `·` / `—` / `\|` / `-`          | Folder name        |
| Description | `<meta name="description">`, else `og:description`                                      | None               |
| Tags        | `<meta name="keywords" content="music, audio">`                                         | None               |
| Icon        | `icon.svg` or `icon.png` in the folder, else the page's own favicon if local or `data:` | Pixel icon by tag  |
| Updated     | Last git commit touching the folder                                                     | `index.html` mtime |
| Listed      | Hide with `<meta name="robots" content="noindex">`                                      | Listed             |

Folders starting with `.` or `_`, and `llm/`, `tmp/` and `scripts/`, are never
experiments.

## Local development

Serve the repository root over HTTP (JavaScript modules do not work via
`file://`):

```sh
uv run python -m http.server 8000
```

Open http://localhost:8000. Experiments work directly; the root `index.html` is
a template with empty card regions. To preview the homepage as deployed:

```sh
node scripts/build-site.mjs
uv run python -m http.server 8000 --directory _site
```

## Deployment

[Pages](.github/workflows/pages.yaml) runs `scripts/build-site.mjs` on pushes to
`main` and deploys `_site/` with GitHub Actions. The build copies the repository
except tooling (`llm/`, `tmp/`, `scripts/`, dotfiles, `README.md`, `AGENTS.md`)
and Node test files, renders the homepage cards, writes `experiments.json`, and
generates the home-screen PNG icons. The site is an installable PWA: Share → Add
to Home Screen on iOS.

## Tests

Node's built-in runner discovers `*.test.mjs`, `test.mjs` and similar files in
every folder. No manifests are needed:

```sh
node --test            # everything
node --test deadwax/   # one project
```

## Formatting

Prettier uses its defaults with `proseWrap: always`. Install the Git hook and
run the same checks as GitHub Actions:

```sh
uvx pre-commit install
uvx pre-commit run --all-files
```
