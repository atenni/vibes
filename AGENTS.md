# Working in Vibes

- This is a monorepo of small, independent browser tools, each in its own
  top-level directory. Preserve unrelated projects.
- The site is static files on GitHub Pages. The only build step renders the
  homepage (`scripts/build-site.mjs`); experiment folders are published
  unchanged and must work when served as-is. Avoid runtime dependencies; shared
  infrastructure must earn its complexity.
- Target the latest browsers and Node. Use native ESM and, when useful, Node's
  native TypeScript type stripping; avoid legacy compatibility shims.
- Split an experiment into as many files as make it easy to read, test and edit:
  markup in `index.html`, styles in CSS files and logic in ES modules that tests
  import directly. Keep pure logic free of DOM and audio so Node can test it.
  There is no single-file requirement; experiments are served over HTTP, not
  opened from `file:` URLs.
- Read the affected project's documentation and run its tests. Run repository
  formatting checks with `uvx pre-commit run --all-files`.
- Use Conventional Commits with abbreviated project scopes where relevant: `dw`
  for Dead Wax, `cidr` for CIDR helper. Check history for existing scopes; omit
  the scope for repository-wide changes rather than inventing one.
- Keep infrastructure experiments separate from app changes so they can be
  reverted independently.

## Experiment metadata lives in each `index.html`

There is no registry or manifest. Any top-level folder with an `index.html` is
an experiment, except folders starting with `.` or `_`, and `llm/`, `tmp/` and
`scripts/`. The homepage card is read from standard `<head>` tags, and every
field has a default; never make the build fail for missing metadata.
`scripts/build-site.mjs` is the source of truth.

- **Name**: `<meta name="application-name">`, else the `<title>` text before the
  first `·`, `—`, `–`, `|` or `-`. Keep page titles in the form `Name · Vibes`
  or `Name — tagline`, or the card shows the whole title.
- **Description**: `<meta name="description">`. One or two plain sentences; this
  is the card text.
- **Tags**: `<meta name="keywords" content="music, audio">`, lowercase and
  comma-separated. Reuse existing tags (check other experiments) so filters stay
  useful. The first tag with a pixel icon (`network`, `music`, `time`, `text`,
  `colour`, `game`, `maths`, or an alias in `ICON_ALIASES`) picks the fallback
  icon.
- **Icon**: `icon.svg` or `icon.png` in the folder, else the page's own
  `<link rel="icon">` if it is a `data:` URI or a file inside the folder.
- **Updated** date and sort order: the last git commit touching the folder.
- **Unlisted**: `<meta name="robots" content="noindex">` hides it from the
  homepage; the folder is still deployed.

## Other conventions

- Tests: Node's built-in runner discovers `*.test.mjs`, `test.mjs` and similar
  names; run `node --test`. Don't add per-project test manifests. Files matching
  those names are not deployed, so keep browser code out of them.
- Root `index.html` is a template: content between `<!-- build:name -->` and
  `<!-- /build:name -->` is generated. Preview with
  `node scripts/build-site.mjs`, then serve `_site/`.
- The site is an installable PWA scoped to `/`. In standalone mode iOS has no
  back button, so every experiment's `<footer>` must contain a link to the
  homepage (`<a href="../">`). Wording, placement within the footer and styling
  are up to the experiment (for example `← Vibes`); extra header links are fine.
  `scripts/back-link.test.mjs` enforces this.
