# Vibes

Small web experiments and useful browser applications, mostly written with LLMs.

**Site:** https://vibes.atenni.com

Each experiment lives in its own top-level folder and is served as static files.
The homepage is generated from each experiment's own HTML; see the site for the
current list. Experiments may have their own README with usage and test notes.

## Adding an experiment

Create a top-level folder with an `index.html`. That is all; it appears on the
homepage at the next deploy. Split the rest into whatever CSS files and ES
modules suit the experiment; there is no single-file requirement. Every field
has a default, and these standard `<head>` tags improve the card:

| Field       | Source                                                                                  | Default            |
| ----------- | --------------------------------------------------------------------------------------- | ------------------ |
| Name        | `<meta name="application-name">`, else `<title>` before `·` / `—` / `\|` / `-`          | Folder name        |
| Description | `<meta name="description">`, else `og:description`                                      | None               |
| Tags        | `<meta name="keywords" content="music, audio">`                                         | None               |
| Icon        | `icon.svg` or `icon.png` in the folder, else the page's own favicon if local or `data:` | Pixel icon by tag  |
| Updated     | Last git commit touching the folder                                                     | `index.html` mtime |
| Listed      | Hide with `<meta name="robots" content="noindex">`                                      | Listed             |

Folders starting with `.` or `_`, and `llm/`, `tmp/` and `scripts/`, are never
experiments. Every experiment's `<footer>` links back to the homepage with
`<a href="../">` (wording and styling are up to the experiment): the installed
app has no browser back button on iOS. `scripts/back-link.test.mjs` checks it.

## Local development

Serve the repository root over HTTP (JavaScript modules do not work via
`file://`):

```sh
uv run python -m http.server 8000
```

Open http://localhost:8000/<experiment>/. The root `index.html` is a template
with empty card regions; to preview the homepage as deployed:

```sh
node scripts/build-site.mjs
uv run python -m http.server 8000 --directory _site
```

## Tests

Node's built-in runner discovers `*.test.mjs`, `test.mjs` and similar files in
every folder. No manifests are needed:

```sh
node --test            # everything, as in CI
node --test cidr/      # one experiment
```

## Deployment

[Pages](.github/workflows/pages.yaml) runs `scripts/build-site.mjs` on pushes to
`main` and deploys `_site/` with GitHub Actions. The build:

- copies the repository, except tooling (`llm/`, `tmp/`, `scripts/`, dotfiles,
  `README.md`, `AGENTS.md`) and Node test files;
- renders the homepage cards, tag filters and count into `index.html`;
- writes `experiments.json`, including the SHA and GitHub link of the last
  commit to touch each experiment;
- generates the home-screen PNG icons and versions the service worker cache.

Experiment folders are published unchanged. The site is an installable PWA: on
iOS, Share → Add to Home Screen.

Each card shows the short SHA of the experiment's last commit. To show it in an
experiment's footer too, linked to the commit on GitHub, add:

```html
<a data-version hidden></a>
<script type="module" src="../version.mjs"></script>
```

[`version.mjs`](version.mjs) fills the link from `experiments.json` and adds a
`·` separator before it. Both stay hidden when serving the repository rather
than `_site/`.

## Formatting

Prettier uses its defaults with `proseWrap: always`. Install the Git hook and
run the same checks as GitHub Actions:

```sh
uvx pre-commit install
uvx pre-commit run --all-files
```
