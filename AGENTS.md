# Working in Vibes

- This is a monorepo of small, independent browser tools, each in its own
  top-level directory. Preserve unrelated projects.
- The site is served as static files by GitHub Pages. Prefer no build step or
  runtime dependencies; shared infrastructure must earn its complexity.
- Target the latest browsers and Node. Use native ESM and, when useful, Node's
  native TypeScript type stripping; avoid legacy compatibility shims.
- Read the affected project's documentation and run its tests. Run repository
  formatting checks with `uvx pre-commit run --all-files`.
- Use Conventional Commits with abbreviated project scopes where relevant: `dw`
  for Dead Wax, `cidr` for CIDR helper. Check history for existing scopes; omit
  the scope for repository-wide changes rather than inventing one.
- Keep infrastructure experiments separate from app changes so they can be
  reverted independently.
