# Vibes

Small web experiments and useful browser applications, mostly written with LLMs.

**Site:** https://vibes.atenni.com

Each experiment lives in its own folder. Everything is served as static files by GitHub Pages; there is no build step.

## Tools

- [CIDR helper](https://vibes.atenni.com/cidr/) — IPv4 and IPv6 subnet calculator. [Documentation](cidr/README.md).

## Local development

Serve the repository root over HTTP (JavaScript modules do not work via `file://`):

```sh
uv run python -m http.server 8000
```

Open http://localhost:8000.
