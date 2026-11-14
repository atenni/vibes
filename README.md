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

## Formatting

Prettier uses its defaults with `proseWrap: always`. Install the Git hook and
run the same checks as GitHub Actions:

```sh
uvx pre-commit install
uvx pre-commit run --all-files
```
