# ADR-0001: Scope, and Svod as the store of record

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Svod Foundry maintainers

## Context

We want an AI agent to be able to **synthesize new tools at runtime** — generate a capability it
doesn't already have, instead of being limited to a fixed, predefined toolbox. Two questions decide
the shape of the whole project:

1. Where do synthesized tools *live* — who owns their persistence, versioning, audit, and recall?
2. What is *in* this component versus deliberately left out?

A synthesized tool is a high-stakes artifact: it is machine-generated code that an agent may later
execute. Its provenance ("which agent made this, when, from what spec"), its history ("what did it
look like three revisions ago"), and its reversibility ("restore the prior version") matter as much
as the code itself.

## Decision

**1. Svod is the store of record. We do not build our own persistence, lifecycle, audit, or recall.**

[Svod](https://github.com/FleetQ/svod-engine) already provides exactly the substrate a synthesized
tool needs: git-backed, attributable, versioned, diffable Markdown+YAML notes behind a single safe
writer, with typed memory and a lifecycle (`provisional` → `active`), optimistic concurrency, and
`context_pack` recall. A synthesized tool is therefore **a Svod typed-memory note** with
`type: tool`, drafted under `messy/tools/<name>/` and promoted to `vault/tools/<name>/`.

We consume Svod purely as a **network MCP client** (`Authorization: Bearer <token>`). We do **not**:
- merge anything into the Svod engine,
- vendor or fork it,
- build a parallel database, audit log, or version history.

The bearer token **is the identity**: its `agentId` becomes the git commit author, and its role
(`WRITE` / `READ_ONLY`) gates every call. Recall ("what tools exist?") is Svod `context_pack` with
`enumerate=true` + `type:tool` filter — the foundry does not reimplement listing.

**2. This component is a thin, standalone foundry — not part of Svod, not a product brand.**

It is a small MCP server that (a) acts as an MCP client to Svod and (b) orchestrates Docker to run
generated code safely. Nothing more.

**3. Not coupled to FleetQ.** FleetQ is at most a *future* client of the foundry, behind a human
approval gate. No FleetQ code, config, or assumptions enter this repo.

## Scope

**In scope (v1):**

- An MCP tool surface for agents: `synthesize`, `verify`, `run`, `promote`.
- A Svod MCP client wrapper (`context_pack`, `search`, `read`, `write`, `promote`, `history`,
  `diff`) with optimistic concurrency.
- A Docker sandbox executor with deny-by-default egress and resource limits (ADR-0003).
- Tools authored in the open Agent Skills format (ADR-0004).
- The foundry Skill (`skill/SKILL.md`) teaching an agent when/how to use the foundry.
- Unit + integration tests; CI gating every change.

**Out of scope (v1) — deliberately, not by omission:**

- FleetQ coupling of any kind.
- Signal/webhook → synthesize wiring (no event-driven autosynthesis).
- Per-skill custom base images (fixed base image per runtime in v1; designed for later).
- Encryption at rest (delegated to Svod / the host).
- Any App API or UI surface — the foundry is **MCP-only to agents** in v1.
- Any GitHub push, publish, or deploy automation.

## Consequences

- The foundry is small and has no database of its own; if Svod is down, synthesis/promotion is
  unavailable by design (fail closed, not fall back to local persistence).
- Provenance, history, diff, and restore come "for free" from Svod and git — we must not duplicate
  or shadow them.
- Because identity flows from the Svod token, the foundry does not implement its own auth model; it
  forwards the configured token and relies on Svod's role gating.
- Leaving FleetQ and event-driven synthesis out keeps the trust boundary simple: a human or an
  agent explicitly calls `synthesize`, and nothing is auto-promoted.
