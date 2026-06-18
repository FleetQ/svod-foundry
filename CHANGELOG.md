# Changelog

All notable changes to Svod Foundry are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-18

First alpha — feature-complete for v1 (MCP-only to agents).

### Added

- **Foundry MCP server** exposing four tools to agents: `synthesize`, `verify`, `run`, `promote`.
  Listing/recall is intentionally not a foundry tool — agents use Svod's `context_pack`/`search`.
  Streamable-HTTP transport (default) and stdio.
- **Svod MCP client** (`src/svod/`) — client to the Svod engine over streamable HTTP with bearer
  auth (the token is the identity). Wraps `context_pack`/`search`/`read`/`write`/`promote`/
  `history`/`diff`, with a `recallTools()` primitive and typed optimistic-concurrency conflicts
  (`SvodConflictError`) — never blind-overwrites.
- **Docker sandbox executor** (`src/sandbox/`) — one ephemeral, contained execution path shared by
  `verify` and `run`: read-only tool mount, tmpfs scratch, no writable host bind mount,
  deny-by-default egress (`--network none`) with an allowlisting egress proxy for declared domains,
  and `--memory`/`--cpus`/`--pids-limit`/wall-clock-timeout bounds.
- **Synthesis contract** (ADR-0005) — the calling agent generates the code; the foundry assembles
  the canonical Agent Skill, recall-dedups, writes a `provisional` draft, sandboxes it, and gates
  promotion. No LLM in the foundry.
- **Artifact format** — the open Agent Skills standard (`SKILL.md` + one script); a tool is a Svod
  typed-memory note (`type: tool`) moving `provisional → active`.
- **The foundry Skill** (`skill/SKILL.md`) — model-facing guidance: recall-first, verify-before-
  promote, never run unverified code outside the sandbox.
- **Worked example** (`examples/`) — the `json-extract` sample tool and `demo.mjs` driving the full
  `synthesize → verify → run → promote` loop.
- **Docs** — `docs/architecture.md` and ADR-0001 … ADR-0005.
- **Tooling** — Apache-2.0 license, `config.sample.json`, `Dockerfile`, `docker-compose.yml`
  (Svod + foundry), GitHub Actions CI (lint, typecheck, build, unit, integration), `SECURITY.md`,
  `CONTRIBUTING.md`.

### Security

- The foundry's HTTP surface defaults to a **loopback** bind, enables **DNS-rebinding protection**
  (Host/Origin allowlist), and enforces an optional **bearer token** (`server.authTokenRef`) with a
  constant-time comparison. A non-loopback bind without a token warns loudly at startup.
- Generated tool code is treated as untrusted and executed only in the sandbox; the integration
  suite asserts a known-malicious sample is contained across host-write, undeclared-egress, fork-bomb,
  and CPU-spin vectors.

### Notes

- Out of scope for v1 (by design): FleetQ coupling, signal/webhook → synthesize wiring, per-skill
  base images, encryption at rest, any App API/UI surface.

[Unreleased]: https://github.com/FleetQ/svod-foundry/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/FleetQ/svod-foundry/releases/tag/v0.1.0
