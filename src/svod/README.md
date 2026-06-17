# `src/svod/` — Svod MCP client wrapper (Milestone 2)

Owns the MCP client to the Svod engine. Implements, over streamable HTTP with
`Authorization: Bearer <token>`:

- `contextPack(...)` — recall; with `enumerate=true` + `type:tool` filter returns the active tool
  registry verbatim.
- `search`, `read`, `write`, `promote`, `history`, `diff`.
- Optimistic concurrency: `write` takes `expectedRevision`; a stale write returns a structured
  `conflict` (with current content) to be re-read/merged/retried — never blind-overwritten.

Imports shared types from `../types.js` and config from `../config.js`. Must **not** edit root
configs (`package.json`, `tsconfig.json`, eslint/vitest configs) — all deps are already declared.

See [ADR-0001](../../docs/adr/0001-scope-and-svod-dependency.md).
