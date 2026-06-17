# ADR-0005: Synthesis contract — the foundry assembles and governs; the agent generates

- **Status:** Accepted
- **Date:** 2026-06-18
- **Deciders:** Svod Foundry maintainers

## Context

`synthesize(spec)` must "generate a `SKILL.md` + script, recall-check Svod first, and write a
provisional draft." The open question: **who writes the actual code?** The foundry is a thin MCP
server (ADR-0002) with no LLM dependency, no model API keys in its config, and a hard requirement
that all generated code is untrusted and sandbox-only (ADR-0001/0003).

## Decision

**The calling agent is the code generator; the foundry assembles the canonical Agent Skill from the
agent's spec and governs its lifecycle.** The foundry does not embed or call an LLM.

`synthesize(spec)` receives a structured spec — including the script body and the self-test — from
the agent (which is itself the LLM doing the creative work). The foundry then:

1. **Recalls first.** Enumerates the active tool registry (`SvodClient.recallTools()` =
   `context_pack` enumerate + `type:tool`). If an **active** tool with the same `name` already
   exists, it does **not** rebuild — it returns the existing tool's name + revision with
   `skipped: true`. (Coverage matching is by name in v1; semantic "does an existing tool already do
   this?" matching is left to the agent's own recall reasoning and a possible future enhancement.)
2. **Assembles the canonical artifact.** Builds a spec-compliant `SKILL.md` (frontmatter per
   ADR-0004: `type: tool`, `status: provisional`, `runtime`, `entry`, `selftest`, `network`, `tags`,
   `secrets`) plus the single script file. The `selftest`/`entry` commands reference the in-container
   tool mount path so they run identically in the sandbox.
3. **Writes a provisional draft.** Writes `messy/tools/<name>/SKILL.md` and
   `messy/tools/<name>/<entry>` to Svod via `write` (optimistic concurrency). Returns
   `{ name, revision }`.

This is why "generate" is honest: the foundry **generates the canonical, verifiable Agent Skill
artifact** (frontmatter + script files + self-test wiring) from the spec. The unpredictable part —
the code — comes from the agent and is treated as hostile until a green verify (ADR-0003).

### Why this split

- **No LLM in the foundry.** Keeps it a thin, dependency-light, auditable MCP server. The model that
  is already in the loop (the calling agent) does the generation; the foundry does the governance the
  agent cannot safely do itself (dedup against the registry, write an attributed provisional draft,
  run it contained, gate promotion).
- **Trust boundary stays crisp.** The foundry never trusts the script — it only ever runs it in the
  sandbox. Whether the bytes came from a model, a poisoned prompt, or a human paste is irrelevant to
  containment.
- **Faithful to ADR-0001.** Don't reinvent what something else already provides: the agent provides
  generation; Svod provides persistence/audit; the foundry provides the safe synthesize→verify→
  promote→run loop.

## A tool's shape in Svod

```
messy/tools/<name>/SKILL.md   <- the typed note (type: tool, status: provisional); recall surfaces this
messy/tools/<name>/<entry>    <- the single script (e.g. tool.py)
        │ promote (revision-checked move; status -> active)
        ▼
vault/tools/<name>/SKILL.md
vault/tools/<name>/<entry>
```

`verify`/`run` read the `SKILL.md` (to learn `runtime`/`entry`/`selftest`/`network`), read the
script, materialize both to a host temp dir, and execute via the single sandbox path. `promote`
performs the Svod directory move and sets `status: active`, **only after a green verify**.

## Consequences

- The `synthesize` input schema carries the script and self-test; the foundry validates it
  (boundary validation) and rejects a spec missing the fields ADR-0004 marks required.
- The foundry has no model credentials and cannot "improve" code on its own — by design.
- `promote` re-runs `verify` internally so the "green verify required" guarantee is structural, not
  dependent on the caller having called `verify` first.
- Recall-dedup is name-based in v1; documented as a known limitation, not silently assumed complete.
