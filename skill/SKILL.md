---
name: svod-foundry
description: >-
  Synthesize, verify, run, and promote new tools at runtime when no existing tool covers a task.
  Use the foundry's MCP tools (synthesize/verify/run/promote) with recall-first discipline and
  verify-before-promote. Never run unverified generated code outside the sandbox.
---

# Svod Foundry — synthesizing tools at runtime

> M1 scaffold. The full operating guidance (worked recall queries, naming rules, failure handling)
> lands in M5 alongside the `examples/` end-to-end demo.

You have access to a **tool foundry**: when you hit a task no existing tool covers, you can have a
new tool *made*, instead of improvising. A synthesized tool is an Agent Skill (`SKILL.md` + one
script), runs only inside a sandbox, and is stored in Svod as a versioned, attributable note.

## The discipline (non-negotiable)

1. **Recall first.** Before synthesizing, check whether an active tool already does the job: query
   Svod with `context_pack` (`enumerate=true`, filter `type:tool`) — that returns the live tool
   registry verbatim. Do **not** synthesize a duplicate of something that already exists.
2. **Verify before you trust.** A freshly synthesized tool is `provisional`. Call `verify(name)` and
   read the result. A red verify means the tool is broken — fix the spec and re-synthesize; do not
   use it.
3. **Never run unverified code outside the sandbox.** `run(name, args)` executes inside the
   foundry's sandbox. There is no other execution path, and you must not copy generated code out and
   run it yourself.
4. **Promote only on green.** `promote(name)` publishes a tool (`messy/` → `vault/`, `status:
   active`) and is allowed only after a passing verify. Promotion is the draft→publish gate.

## The tools

- `synthesize(spec)` → recall-checks Svod, generates the skill, writes a provisional draft, returns
  `{ name, revision }`.
- `verify(name)` → runs the tool's self-test in the sandbox; returns pass/fail + exit code + stderr.
- `run(name, args)` → executes the tool in the sandbox; returns stdout/stderr/exit.
- `promote(name)` → on a green verify, publishes the tool as `active`.

Listing/recall is **not** a foundry tool — use Svod's `context_pack`/`search` directly.

## Secrets

A tool must reference secrets only as Svod secret refs (`env:` / `file:` / `keychain:`), never as
literal values. If a spec would require an inline secret, stop and reformulate it with a ref.
