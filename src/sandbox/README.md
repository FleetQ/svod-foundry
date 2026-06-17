# `src/sandbox/` — Docker sandbox executor (Milestone 3)

Owns safe execution of untrusted, generated code. Implements one function —
`executeInSandbox(request: SandboxRequest): Promise<SandboxResult>` (see `../types.js`) — used by
**both** `verify` and `run` (identical path; ADR-0003).

Container contract (ADR-0003):

- Ephemeral container, `AutoRemove: true`.
- Fixed base image per runtime (`python:3.12-slim`, `node:22-slim`).
- Tool dir mounted **read-only**; **tmpfs** scratch; **no** writable host bind mount.
- `--network none` unless the skill frontmatter `network` allowlist declares domains, in which case
  egress is forced through an allowlisting proxy.
- `--memory`, `--cpus`, `--pids-limit`, wall-clock timeout.

Imports shared types from `../types.js` and config from `../config.js`. Must **not** edit root
configs. Integration tests live under `tests/integration/sandbox.integration.test.ts` with samples
in `tests/fixtures/` (a known-good script that must pass, and a known-malicious one that must be
contained/denied).
