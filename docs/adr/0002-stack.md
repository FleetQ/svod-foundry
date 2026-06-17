# ADR-0002: Implementation stack — TypeScript/Node + official MCP SDK

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Svod Foundry maintainers

## Context

The foundry is, structurally, a **thin MCP server** that does two things: it acts as an **MCP
client** to the Svod engine, and it **orchestrates Docker** to run generated code. It does almost
no heavy computation of its own — the weight is in I/O (MCP round-trips, Docker API calls) and in
correctly enforcing a safety contract. We need to choose a language/runtime and the core libraries.

## Decision

**TypeScript on Node.js, using the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk).**

| Concern | Choice | Why |
| --- | --- | --- |
| Language / runtime | TypeScript, Node.js ≥ 22, ESM | The foundry is both an MCP **server** (to agents) and an MCP **client** (to Svod). The official MCP SDK is TypeScript-first and covers both roles, including the streamable-HTTP transport Svod speaks. Lightest path to a correct MCP implementation. |
| MCP | `@modelcontextprotocol/sdk` | First-party, tracks the spec, provides `Server` + `Client` + `StreamableHTTPClientTransport`. No reason to hand-roll the protocol. |
| Docker orchestration | `dockerode` | Mature, typed Docker Engine API client. Lets us set `NetworkMode`, `Memory`, `NanoCpus`, `PidsLimit`, read-only mounts, and tmpfs precisely (the ADR-0003 contract) without shelling out to the `docker` CLI. |
| Schema / validation | `zod` (v4) | MCP SDK accepts zod schemas for tool inputs; we reuse it for config validation. |
| Frontmatter | `gray-matter` | Agent Skills are Markdown with YAML frontmatter (ADR-0004); `gray-matter` parses/serializes it. |
| Tests | `vitest` | Fast, TS-native, good watch mode; one tool for unit and integration (split by config). |
| Lint / format | `eslint` (flat config) + `prettier` | Standard, CI-enforced. |

### Why not the alternatives

- **Python.** The synthesized *tools* are often Python — but the *foundry* is not. Choosing Python
  for the host server would not reduce the Docker-orchestration or MCP work, and the MCP Python SDK
  is a heavier fit for the dual server+client role we need. Runtime choice for the foundry is
  independent of the runtimes it sandboxes.
- **Go / Rust.** More operational overhead for a component whose bottleneck is I/O and protocol
  correctness, not CPU. The official MCP SDK's TypeScript implementation is the most complete.
- **Shelling out to the `docker` CLI** instead of `dockerode`. Brittle (string parsing, quoting,
  argv injection risk when arguments derive from generated skills) and harder to enforce the exact
  security flags. The Engine API via `dockerode` is explicit and typed.

## Consequences

- One language across server and Svod client keeps the codebase small and the type contracts shared.
- We depend on the Docker Engine API being reachable (socket or TCP) wherever the foundry runs —
  acceptable, since Docker is a hard dependency of the safety model anyway (ADR-0003).
- We track the MCP SDK's evolution; the streamable-HTTP transport and tool-registration APIs are
  the parts we rely on, and both are first-party and stable enough for v1.
- zod v4 is used (the MCP SDK 1.29 accepts `^3.25 || ^4.0`); if the SDK ever narrows that range we
  pin accordingly.
