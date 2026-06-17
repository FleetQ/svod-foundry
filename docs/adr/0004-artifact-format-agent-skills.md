# ADR-0004: Artifact format — the open Agent Skills standard

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Svod Foundry maintainers

## Context

A synthesized tool needs a concrete on-disk shape: how the generated capability is described, how
its executable entry points are declared, and how it is stored in Svod. We could invent a bespoke
manifest format tuned exactly to the foundry. We should not.

## Decision

**A synthesized tool is an [Agent Skill](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills):
a `SKILL.md` plus one executable script.** We do not invent a format.

### Shape

```
messy/tools/<name>/            (in Svod; promoted to vault/tools/<name>/)
├── SKILL.md                   Markdown + YAML frontmatter: what it is, how to run it, its self-test
└── <script>                   one executable script (e.g. tool.py / tool.js)
```

### `SKILL.md` frontmatter (the fields the foundry relies on)

```yaml
---
name: <kebab-case-name>        # tool identity; matches the directory
description: <one line>        # model-facing: when to use this tool
type: tool                     # Svod typed-memory note type — always "tool"
status: provisional            # lifecycle: provisional -> active (set by promote)
runtime: python | node         # selects the sandbox base image (ADR-0003)
entry: tool.py                 # the script the sandbox executes for `run`
selftest: "python tool.py --selftest"   # deterministic self-test command for `verify`
network: []                    # egress allowlist; [] => --network none (ADR-0003)
tags: [<...>]                  # for Svod recall/filtering
secrets: []                    # Svod secret refs only (env:/file:/keychain:) — never literals
---
```

The body is human/model-readable guidance: what the tool does, its arguments, its output contract,
and a description of the self-test. The **self-test is deterministic** — given no external state it
returns a stable pass/fail — because `verify` is the gate everything hangs on.

### Why Agent Skills

- **It is an open, documented standard**, already understood by agent runtimes. A tool the foundry
  makes is portable; a tool made elsewhere is loadable.
- **It is Markdown + frontmatter** — exactly what Svod stores natively. The artifact *is* a Svod
  note; no impedance layer, no separate manifest DB.
- **`SKILL.md` is model-invocable.** The `description`/body is the same thing an agent reads to
  decide *when* to use the tool — synthesis and recall share one representation.
- **Inventing a format would violate ADR-0001's "don't reinvent what Svod/standards already give
  you."**

## Consequences

- The foundry parses and emits `SKILL.md` with `gray-matter` (ADR-0002); frontmatter is the
  contract between synthesis, the sandbox, and promotion.
- `runtime`, `entry`, `selftest`, and `network` are **required** for a tool to be verifiable; a
  synthesized skill missing them is rejected before any container starts.
- `status` is owned by the lifecycle: `synthesize` writes `provisional`; `promote` sets `active`.
  Code does not set `active` by any other route.
- One script per tool in v1 keeps the sandbox mount and entry-point story simple; multi-file skills
  are a possible later extension, not a v1 concern.
- Secrets appear only as Svod secret refs; a literal secret in a generated skill is a defect Svod's
  pre-commit scanning is expected to catch.
